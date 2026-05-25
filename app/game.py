from __future__ import annotations
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db import get_db
from app import models, schemas
from app.auth import current_user
from app.config import get_settings
from app.bot import get_bot
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

router = APIRouter(prefix="/api/game", tags=["game"])

MSK = timezone(timedelta(hours=3))


@router.get("/online")
def get_online_players(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    players = db.query(models.User).filter(models.User.id != user.id).all()
    return {"online": [{"id": p.id, "first_name": p.first_name} for p in players]}


@router.post("/invite")
def send_invite(
    payload: schemas.GameInviteRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    to_user = db.query(models.User).filter(models.User.id == payload.to_user_id).first()
    if not to_user:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    
    existing = db.query(models.GameInvite).filter(
        models.GameInvite.from_user_id == user.id,
        models.GameInvite.to_user_id == to_user.id,
        models.GameInvite.status == "pending",
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Уже есть активное приглашение этому игроку")

    game_invite = models.GameInvite(
        from_user_id=user.id,
        to_user_id=to_user.id,
        game=payload.game,
        status="pending",
    )
    db.add(game_invite)
    db.commit()
    db.refresh(game_invite)

    from app.notify import notify_admins_bg
    game_names = {"tictactoe": "Крестики-нолики", "checkers": "Шашки", "pingpong": "Пинг-понг"}
    notify_admins_bg(
        f"⚔️ <b>{user.first_name}</b> пригласил(а) <b>{to_user.first_name}</b> "
        f"в игру <b>{game_names.get(payload.game, payload.game)}</b>"
    )

    return {"id": game_invite.id, "status": "pending"}


@router.post("/invite-telegram")
async def invite_telegram(
    payload: schemas.GameInviteRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Отправить приглашение через Telegram пользователю, который не в сети."""
    to_user = db.query(models.User).filter(models.User.id == payload.to_user_id).first()
    if not to_user:
        raise HTTPException(status_code=404, detail="Игрок не найден")

    settings = get_settings()
    game_names = {
        "tictactoe": "Крестики-нолики",
        "checkers": "Шашки",
        "pingpong": "Пинг-понг",
    }
    game_name = game_names.get(payload.game, payload.game)
    text = (
        f"⚔️ <b>{user.first_name}</b> вызывает вас на бой в игру "
        f"<b>{game_name}</b>!\n\nОткройте Ковчег, чтобы принять вызов."
    )
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🌍 Открыть Ковчег", web_app=WebAppInfo(url=settings.public_url))]
        ]
    )
    try:
        await get_bot().send_message(to_user.telegram_id, text, reply_markup=kb)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Не удалось отправить уведомление в Telegram") from exc

    return {"status": "sent"}


@router.post("/accept")
def accept_invite(
    payload: schemas.GameInviteAction,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    invite = db.query(models.GameInvite).filter(
        models.GameInvite.id == payload.invite_id,
        models.GameInvite.to_user_id == user.id,
        models.GameInvite.status == "pending",
    ).first()
    
    if not invite:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")

    invite.status = "accepted"
    db.commit()

    return {"status": "accepted", "game": invite.game}


@router.post("/decline")
def decline_invite(
    payload: schemas.GameInviteAction,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    invite = db.query(models.GameInvite).filter(
        models.GameInvite.id == payload.invite_id,
        models.GameInvite.to_user_id == user.id,
        models.GameInvite.status == "pending",
    ).first()
    
    if not invite:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")

    invite.status = "declined"
    db.commit()

    return {"status": "declined"}


@router.get("/my-invites")
def get_my_invites(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    invites = db.query(models.GameInvite).filter(
        (models.GameInvite.to_user_id == user.id) | 
        (models.GameInvite.from_user_id == user.id)
    ).order_by(models.GameInvite.created_at.desc()).limit(20).all()
    
    game_names = {
        "tictactoe": "Крестики-нолики",
        "checkers": "Шашки",
        "pingpong": "Пинг-понг",
    }
    
    return {"invites": [{
        "id": i.id,
        "game": i.game,
        "game_name": game_names.get(i.game, i.game),
        "from_user_id": i.from_user_id,
        "from_user_name": i.from_user.first_name if i.from_user else "Игрок",
        "to_user_id": i.to_user_id,
        "to_user_name": i.to_user.first_name if i.to_user else "Игрок",
        "status": i.status,
        "created_at_msk": _to_msk(i.created_at),
    } for i in invites]}


def _to_msk(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    msk = dt.astimezone(MSK)
    return msk.strftime("%H:%M")