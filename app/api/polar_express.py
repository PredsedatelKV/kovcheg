"""Authenticated Polar Express crews and cooperative train rooms."""
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from pydantic import BaseModel, ConfigDict, Field

from app import models
from app.api._helpers import require_open_section
from app.api.arena import ArenaHub, BotBody, JoinBody, room_socket
from app.auth import current_user
from app.polar_express import Journey, Passenger, map_data

router = APIRouter(prefix="/api/arcade/train", tags=["polar-express"],
                   dependencies=[Depends(require_open_section("arcade"))])
socket_router = APIRouter()
MODE = "journey"


class LeaveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str | None = Field(default=None, pattern="^[A-Z2-9]{6}$")


class TrainHub(ArenaHub):
    modes = {MODE: {"slots": 4}}
    free_for_all = frozenset({MODE})

    def create(self, uid, name, mode, bots):
        if len(self.rooms) >= 12:
            raise HTTPException(503, "Все поезда в пути. Попробуйте чуть позже")
        return super().create(uid, name, mode, bots)

    def start(self, uid):
        room = self.room_for(uid)
        if not room or room.owner != uid:
            raise HTTPException(403, "Рейс запускает создатель комнаты")
        if room.game is not None:
            raise HTTPException(409, "Вернитесь в лобби перед новым рейсом")
        players = [Passenger(m.id,m.name,bot=room.bots and not m.connected and m.uid != uid,
                             connected=m.connected) for m in room.members.values()]
        # A solo player can dispatch without bots or take a complete helper crew.
        if room.bots:
            for i in range(4-len(players)):
                players.append(Passenger(f"b{i}",("Иней","Искра","Фонарь")[i],bot=True))
        room.game = Journey(players,secrets.randbits(32),crew_size=len(room.members))
        room.touched = time.monotonic()
        room.finished_at = 0
        for m in room.members.values():
            m.seq = -1
        self.broadcast(room)
        return room

    def leave(self, uid):
        self.tickets = {token: ticket for token, ticket in self.tickets.items() if ticket[0] != uid}
        super().leave(uid)

    def member_left(self, room, member):
        p = room.game.actors.get(member.id)
        if p:
            room.game.connection(p,False,room.bots)
            if not room.bots:
                room.game.return_item(p.hand)
                del room.game.actors[member.id]

    def set_connected(self, room, member, connected):
        p = room.game.actors.get(member.id) if room.game else None
        if p:
            room.game.connection(p,connected,room.bots)


hub = TrainHub()


@router.get("/status")
async def status(user: models.User = Depends(current_user)):
    room = hub.room_for(user.id)
    return {"map":map_data(),"current":hub.data(room,user.id) if room else None}


@router.post("/rooms")
async def create(body: BotBody, user: models.User = Depends(current_user)):
    hub.ensure_running()
    return hub.data(hub.create(user.id,user.first_name,MODE,body.bots),user.id)


@router.post("/join")
async def join(body: JoinBody, user: models.User = Depends(current_user)):
    hub.ensure_running()
    return hub.data(hub.join(user.id,user.first_name,body.code),user.id)


@router.post("/bots")
async def bots(body: BotBody,user: models.User = Depends(current_user)):
    room = hub.room_for(user.id)
    if not room or room.owner != user.id:
        raise HTTPException(403,"Настройка доступна создателю комнаты")
    if room.game:
        raise HTTPException(409,"Экипаж настраивается до отправления")
    room.bots=body.bots
    hub.broadcast(room)
    return hub.data(room,user.id)


@router.post("/start")
async def start(user: models.User = Depends(current_user)):
    return hub.data(hub.start(user.id),user.id)


@router.post("/lobby")
async def lobby(user: models.User = Depends(current_user)):
    return hub.data(hub.rematch_lobby(user.id),user.id)


@router.post("/leave")
async def leave(body: LeaveBody | None = None, user: models.User = Depends(current_user)):
    room = hub.room_for(user.id)
    if room and (body is None or body.code is None or body.code == room.code):
        hub.leave(user.id)
    return {"ok":True}


@router.post("/ticket")
async def ticket(user: models.User = Depends(current_user)):
    hub.ensure_running()
    return {"ticket":hub.ticket(user.id),"path":"/ws/train","expires_in":45}


@socket_router.websocket("/ws/train")
async def train_socket(ws: WebSocket):
    await room_socket(ws,hub)
