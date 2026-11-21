"""Thin Ice rooms, using the same authentication and transport as Snow Front."""
import secrets

from fastapi import APIRouter, Depends, HTTPException, WebSocket

from app import models
from app.api._helpers import require_open_section
from app.api.arena import ArenaHub, BotBody, JoinBody, room_socket
from app.auth import current_user
from app.thin_ice import IceMatch, Skater

router = APIRouter(prefix="/api/arcade/ice", tags=["thin-ice"],
                   dependencies=[Depends(require_open_section("arcade"))])
socket_router = APIRouter()
MODE = "survival"


class IceHub(ArenaHub):
    modes = {MODE: {"slots": 4}}
    free_for_all = frozenset({MODE})

    def start(self, uid):
        room = self.room_for(uid)
        if not room or room.owner != uid:
            raise HTTPException(403, "Раунд запускает создатель комнаты")
        if room.game:
            raise HTTPException(409, "Сначала вернитесь в лобби")
        players = [Skater(m.id, m.name, connected=m.connected) for m in room.members.values()]
        if len(players) < 2 and not room.bots:
            raise HTTPException(409, "Нужен хотя бы один соперник")
        if room.bots:
            for i in range(4 - len(players)):
                players.append(Skater(f"b{i}", ("Иней", "Наст", "Метель")[i], bot=True))
        room.game = IceMatch(players, secrets.randbits(32))
        room.finished_at = 0
        self.broadcast(room)
        return room

    def member_left(self, room, member):
        p = room.game.actors.get(member.id)
        if p:
            room.game.eliminate(p, "abandon")

    def set_connected(self, room, member, connected):
        p = room.game.actors.get(member.id) if room.game else None
        if p:
            room.game.connection(p, connected, room.bots)


hub = IceHub()


@router.get("/status")
async def status(user: models.User = Depends(current_user)):
    room = hub.room_for(user.id)
    return {"current": hub.data(room, user.id) if room else None}


@router.post("/rooms")
async def create(body: BotBody, user: models.User = Depends(current_user)):
    hub.ensure_running()
    return hub.data(hub.create(user.id, user.first_name, MODE, body.bots), user.id)


@router.post("/join")
async def join(body: JoinBody, user: models.User = Depends(current_user)):
    hub.ensure_running()
    return hub.data(hub.join(user.id, user.first_name, body.code), user.id)


@router.post("/bots")
async def bots(body: BotBody, user: models.User = Depends(current_user)):
    room = hub.room_for(user.id)
    if not room or room.owner != user.id:
        raise HTTPException(403, "Настройка доступна создателю комнаты")
    if room.game:
        raise HTTPException(409, "Настройка доступна перед раундом")
    room.bots = body.bots
    hub.broadcast(room)
    return hub.data(room, user.id)


@router.post("/start")
async def start(user: models.User = Depends(current_user)):
    return hub.data(hub.start(user.id), user.id)


@router.post("/lobby")
async def lobby(user: models.User = Depends(current_user)):
    return hub.data(hub.rematch_lobby(user.id), user.id)


@router.post("/leave")
async def leave(user: models.User = Depends(current_user)):
    hub.leave(user.id)
    return {"ok": True}


@router.post("/ticket")
async def ticket(user: models.User = Depends(current_user)):
    hub.ensure_running()
    return {"ticket": hub.ticket(user.id), "path": "/ws/ice", "expires_in": 45}


@socket_router.websocket("/ws/ice")
async def ice_socket(ws: WebSocket):
    await room_socket(ws, hub)
