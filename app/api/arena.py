"""Authenticated room lobby and a bounded, authoritative WebSocket arena."""
from __future__ import annotations
import asyncio
from collections import deque
from dataclasses import dataclass, field
import json
import logging
import math
import secrets
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field
from app import models
from app.auth import current_user
from app.api._helpers import require_open_section
from app.snow_arena import Actor, Battle, COVERS, MODES, PADS, WEAPONS, DT

log=logging.getLogger(__name__)
router=APIRouter(prefix="/api/arcade/arena",tags=["snow-arena"],
                 dependencies=[Depends(require_open_section("arcade"))])
socket_router=APIRouter()
ROOM_IDLE=15*60
REJOIN_GRACE=40
MAX_ROOMS=24
@dataclass
class Member:
    uid:int
    id:str
    name:str
    team:int
    joined:float
    connected:bool=False
    disconnected:float=0
    ws:WebSocket|None=None
    queue:asyncio.Queue=field(default_factory=lambda:asyncio.Queue(maxsize=1))
    seq:int=-1
@dataclass
class Room:
    code:str
    mode:str
    bots:bool
    owner:int
    members:dict[int,Member]=field(default_factory=dict)
    game:Battle|None=None
    created:float=field(default_factory=time.monotonic)
    touched:float=field(default_factory=time.monotonic)
    finished_at:float=0

class ArenaHub:
    modes=MODES
    free_for_all=frozenset({"waves"})

    def __init__(self):
        self.rooms={};self.membership={};self.tickets={};self.task=None
        self.running=True;self.failures=0
    def ensure_running(self):
        if self.task is None or self.task.done():
            self.running=True;self.task=asyncio.create_task(self.loop(),name="snow-arena-20hz")
    def room_for(self,uid):
        return self.rooms.get(self.membership.get(uid,""))
    def create(self,uid,name,mode,bots):
        if len(self.rooms)>=MAX_ROOMS:raise HTTPException(503,"Арены заняты. Попробуйте чуть позже")
        if self.room_for(uid):raise HTTPException(409,"Сначала выйдите из текущей комнаты")
        code="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        while code in self.rooms:code="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        room=Room(code,mode,bots,uid);self.rooms[code]=room
        self.join(uid,name,code);return room
    def join(self,uid,name,code):
        room=self.rooms.get(code)
        if room is None:raise HTTPException(404,"Комната не найдена")
        old=self.room_for(uid)
        if old is not None and old is not room:raise HTTPException(409,"Сначала выйдите из текущей комнаты")
        if uid in room.members:return room
        if room.game is not None:raise HTTPException(409,"Матч уже идёт. Дождитесь следующего")
        if len(room.members)>=self.modes[room.mode]["slots"]:raise HTTPException(409,"В комнате нет свободных мест")
        team=0
        if room.mode not in self.free_for_all:
            counts=[sum(m.team==t for m in room.members.values()) for t in [0,1]]
            team=0 if counts[0]<=counts[1] else 1
        used={m.id for m in room.members.values()}
        id=next("p"+str(i) for i in range(4) if "p"+str(i) not in used)
        room.members[uid]=Member(uid,id,(name or "Игрок")[:24],team,time.monotonic())
        self.membership[uid]=code;room.touched=time.monotonic();self.broadcast(room)
        return room
    def leave(self,uid):
        room=self.room_for(uid)
        if not room:return
        member=room.members.pop(uid,None);self.membership.pop(uid,None)
        if member and member.ws:
            try:member.queue.put_nowait({"type":"left"})
            except asyncio.QueueFull:
                member.queue.get_nowait();member.queue.put_nowait({"type":"left"})
        if not room.members:
            self.rooms.pop(room.code,None);return
        if room.owner==uid:room.owner=min(room.members.values(),key=lambda m:m.joined).uid
        if room.game and member:
            self.member_left(room,member)
        room.touched=time.monotonic();self.broadcast(room)
    def member_left(self,room,member):
        p=room.game.actors.get(member.id)
        if p:
            p.bot=True;p.connected=False;p.name="Снежный бот"
            if not room.bots:
                p.hp=0;p.respawn=99999
                if room.mode not in self.free_for_all:
                    active_teams={m.team for m in room.members.values()}
                    if len(active_teams)==1:room.game.finish(next(iter(active_teams)),"Соперник покинул арену")
    def set_connected(self,room,member,connected):
        p=room.game.actors.get(member.id) if room.game else None
        if p:
            p.connected=connected
            p.bot=not connected and room.bots
            if not connected:
                p.input={"mx":0,"mz":0,"ax":0,"az":-1,"fire":False}
    def start(self,uid):
        room=self.room_for(uid)
        if not room:raise HTTPException(404,"Комната не найдена")
        if room.owner!=uid:raise HTTPException(403,"Матч запускает создатель комнаты")
        if room.game is not None and room.game.phase!="finished":raise HTTPException(409,"Матч уже запущен")
        slots=self.modes[room.mode]["slots"]
        if room.mode not in self.free_for_all and not room.bots:
            per_team=slots//2
            if len(room.members)!=slots or any(sum(m.team==t for m in room.members.values())!=per_team for t in [0,1]):
                raise HTTPException(409,"Дождитесь полного состава или включите ботов")
        players=[Actor(m.id,m.name,m.team,connected=m.connected) for m in room.members.values()]
        if room.bots:
            for i in range(slots-len(players)):
                if room.mode in self.free_for_all:team=0
                else:team=0 if sum(p.team==0 for p in players)<=sum(p.team==1 for p in players) else 1
                players.append(Actor("b"+str(i),["Снежок","Иней","Вьюга","Полюс"][i],team,True))
        room.game=Battle(room.mode,players,secrets.randbits(32))
        room.finished_at=0;room.touched=time.monotonic()
        for m in room.members.values():m.seq=-1
        self.broadcast(room);return room
    def rematch_lobby(self,uid):
        room=self.room_for(uid)
        if not room or room.owner!=uid:raise HTTPException(403,"Только создатель комнаты")
        if room.game and room.game.phase!="finished":raise HTTPException(409,"Матч ещё идёт")
        room.game=None;room.finished_at=0;room.touched=time.monotonic();self.broadcast(room);return room
    def team(self,uid):
        room=self.room_for(uid)
        if not room or room.game:raise HTTPException(409,"Команды меняются в комнате до матча")
        if room.mode in self.free_for_all:return room
        m=room.members[uid];other=1-m.team
        if sum(p.team==other for p in room.members.values())>=self.modes[room.mode]["slots"]//2:
            raise HTTPException(409,"В этой команде нет свободного места")
        m.team=other;self.broadcast(room);return room
    def ticket(self,uid):
        room=self.room_for(uid)
        if not room:raise HTTPException(404,"Сначала создайте комнату или войдите по коду")
        # One current unused ticket per player; no credentials in URLs/access logs.
        self.tickets={t:v for t,v in self.tickets.items() if v[2]>time.monotonic() and v[0]!=uid}
        token=secrets.token_urlsafe(32);self.tickets[token]=(uid,room.code,time.monotonic()+45)
        return token
    def consume_ticket(self,token):
        ticket=self.tickets.pop(token,None)
        if not ticket or ticket[2]<time.monotonic():return None
        uid,code,_=ticket;room=self.rooms.get(code)
        if not room or uid not in room.members:return None
        return room,room.members[uid]
    def data(self,room,uid,game_state=None):
        members=[dict(id=m.id,name=m.name,team=m.team,connected=m.connected,owner=m.uid==room.owner) for m in room.members.values()]
        member=room.members.get(uid)
        return dict(type="state",room=room.code,mode=room.mode,bots=room.bots,slots=self.modes[room.mode]["slots"],
                    me=member.id if member else None,ack=member.seq if member else -1,owner=room.owner==uid,members=members,
                    game=(game_state if game_state is not None else room.game.data()) if room.game else None)
    def broadcast(self,room):
        if not any(m.connected for m in room.members.values()):return
        game_state=room.game.data() if room.game else None
        for m in room.members.values():
            if not m.connected:continue
            payload=self.data(room,m.uid,game_state)
            if m.queue.full():
                try:m.queue.get_nowait()
                except asyncio.QueueEmpty:pass
            m.queue.put_nowait(payload)
    async def loop(self):
        last=time.monotonic();acc=0.0;sent=0
        try:
            while self.running:
                now=time.monotonic();acc+=min(.25,now-last);last=now
                cycles=0
                while acc>=DT and cycles<5:
                    for room in list(self.rooms.values()):
                        try:
                            if room.game and room.game.phase!="finished":
                                room.game.advance()
                                if room.game.phase=="finished":room.finished_at=now
                        except Exception:
                            self.failures+=1;log.exception("Snow arena simulation failed")
                            if room.game:room.game.finish(None,"Матч остановлен сервером")
                        room.touched=now if any(m.connected for m in room.members.values()) else room.touched
                    cycles+=1;acc-=DT;sent+=1
                    if sent%2==0:
                        for room in list(self.rooms.values()):self.broadcast(room)
                for room in list(self.rooms.values()):
                    for m in list(room.members.values()):
                        if not m.connected and m.disconnected and now-m.disconnected>REJOIN_GRACE:self.leave(m.uid)
                        elif not m.connected and not m.disconnected and now-m.joined>90:self.leave(m.uid)
                    if now-room.touched>ROOM_IDLE:
                        for uid in list(room.members):self.leave(uid)
                self.tickets={t:v for t,v in self.tickets.items() if v[2]>now}
                await asyncio.sleep(max(.005,DT-acc))
        except asyncio.CancelledError:pass
    async def shutdown(self):
        self.running=False
        for room in list(self.rooms.values()):
            for m in list(room.members.values()):
                if m.ws:
                    try:await m.ws.close(1012,"Сервер обновляется")
                    except Exception:pass
        if self.task:
            self.task.cancel()
            try:await self.task
            except asyncio.CancelledError:pass
        self.task=None;self.rooms.clear();self.membership.clear();self.tickets.clear()

hub=ArenaHub()
class CreateBody(BaseModel):
    model_config=ConfigDict(extra="forbid")
    mode:str=Field(pattern="^(duel|teams|waves)$")
    bots:bool=True
class JoinBody(BaseModel):
    model_config=ConfigDict(extra="forbid")
    code:str=Field(pattern="^[A-Z2-9]{6}$")
class BotBody(BaseModel):
    model_config=ConfigDict(extra="forbid")
    bots:bool
def room_response(room,user):
    return hub.data(room,user.id)
@router.get("/status")
async def status(user:models.User=Depends(current_user)):
    room=hub.room_for(user.id)
    return dict(version=1,modes=MODES,map=dict(name="Полярный двор",limit=12.7,covers=COVERS,pads=PADS),
                weapons={k:{kk:vv for kk,vv in v.items() if kk in ["label","ammo"]} for k,v in WEAPONS.items()},
                current=hub.data(room,user.id) if room else None)
@router.post("/rooms")
async def create(body:CreateBody,user:models.User=Depends(current_user)):
    hub.ensure_running()
    return room_response(hub.create(user.id,user.first_name,body.mode,body.bots),user)
@router.post("/join")
async def join(body:JoinBody,user:models.User=Depends(current_user)):
    hub.ensure_running()
    return room_response(hub.join(user.id,user.first_name,body.code),user)
@router.post("/leave")
async def leave(user:models.User=Depends(current_user)):
    hub.leave(user.id);return dict(ok=True)
@router.post("/start")
async def start(user:models.User=Depends(current_user)):
    return room_response(hub.start(user.id),user)
@router.post("/lobby")
async def lobby(user:models.User=Depends(current_user)):
    return room_response(hub.rematch_lobby(user.id),user)
@router.post("/team")
async def team(user:models.User=Depends(current_user)):
    return room_response(hub.team(user.id),user)
@router.post("/bots")
async def bots(body:BotBody,user:models.User=Depends(current_user)):
    room=hub.room_for(user.id)
    if not room or room.owner!=user.id:raise HTTPException(403,"Настройка доступна создателю комнаты")
    if room.game:raise HTTPException(409,"Боты настраиваются перед матчем")
    room.bots=body.bots;hub.broadcast(room);return room_response(room,user)
@router.post("/ticket")
async def ticket(user:models.User=Depends(current_user)):
    hub.ensure_running();return dict(ticket=hub.ticket(user.id),path="/ws/arena",expires_in=45)

async def send_states(ws,queue):
    while True:
        payload=await queue.get()
        await asyncio.wait_for(ws.send_json(payload),timeout=3)
        if payload.get("type")=="left":
            await ws.close(1000);return

@socket_router.websocket("/ws/arena")
async def arena_socket(ws:WebSocket):
    await room_socket(ws,hub)

async def room_socket(ws:WebSocket,hub:ArenaHub):
    origin=ws.headers.get("origin")
    if origin and urlsplit(origin).netloc!=ws.headers.get("host"):
        await ws.close(1008);return
    await ws.accept()
    room=member=sender=None
    try:
        first=await asyncio.wait_for(ws.receive_text(),timeout=5)
        if len(first)>512:await ws.close(1009);return
        payload=json.loads(first)
        token=payload.get("ticket") if isinstance(payload,dict) else None
        if not isinstance(token,str) or not 32<=len(token)<=64:await ws.close(1008);return
        auth=hub.consume_ticket(token)
        if not auth:await ws.close(1008);return
        room,member=auth
        old_ws=member.ws
        member.ws=ws;member.connected=True;member.disconnected=0;member.seq=-1
        member.queue=asyncio.Queue(maxsize=1)
        hub.set_connected(room,member,True)
        if old_ws is not None and old_ws is not ws:
            try:await old_ws.close(4001,"Подключено другое окно")
            except Exception:pass
        if member.ws is not ws:return
        hub.ensure_running();hub.broadcast(room)
        sender=asyncio.create_task(send_states(ws,member.queue))
        samples=deque()
        while True:
            message=await asyncio.wait_for(ws.receive_text(),timeout=20)
            if member.ws is not ws:return
            now=time.monotonic();samples.append(now)
            while samples and samples[0]<now-1:samples.popleft()
            if len(samples)>65:await ws.close(1008,"Слишком много сообщений");return
            if len(message)>512:await ws.close(1009);return
            data=json.loads(message)
            if not isinstance(data,dict):await ws.close(1008);return
            if data.get("type")=="ping":
                continue
            if data.get("type")!="input":await ws.close(1008);return
            seq=data.get("seq")
            if isinstance(seq,bool) or not isinstance(seq,int) or not 0<=seq<=2**31:
                await ws.close(1008);return
            if seq<=member.seq:continue
            member.seq=seq
            if room.game and room.game.phase=="playing":
                values=[data.get(k,0) for k in ["mx","mz","ax","az","pitch"]]
                if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in values):
                    await ws.close(1008);return
                room.game.set_input(member.id,data)
    except (WebSocketDisconnect,asyncio.TimeoutError,ValueError,TypeError):
        try:await ws.close(1008)
        except Exception:pass
    except Exception:
        log.exception("Snow arena connection failed")
        try:await ws.close(1011)
        except Exception:pass
    finally:
        if sender:
            sender.cancel()
            try:await sender
            except (asyncio.CancelledError,Exception):pass
        if member and member.ws is ws:
            member.ws=None;member.connected=False;member.disconnected=time.monotonic()
            hub.set_connected(room,member,False)
            hub.broadcast(room)
