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


ONLINE_WINDOW = timedelta(minutes=10)


@router.get("/online")
def get_online_players(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    cutoff = models.now_utc() - ONLINE_WINDOW
    players = (
        db.query(models.User)
        .filter(
            models.User.id != user.id,
            models.User.last_seen.isnot(None),
            models.User.last_seen >= cutoff,
        )
        .all()
    )
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



@router.post("/session/create")
def create_game_session(
    payload: dict,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Создать игровую сессию после принятия приглашения."""
    invite_id = payload.get("invite_id")
    if not invite_id:
        raise HTTPException(400, "invite_id обязателен")
    
    invite = db.query(models.GameInvite).filter(models.GameInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(404, "Приглашение не найдено")
    if invite.status != "accepted":
        raise HTTPException(400, "Приглашение не принято")
    
    # Check if session already exists
    existing = db.query(models.GameSession).filter(models.GameSession.invite_id == invite_id).first()
    if existing:
        return {"session_id": existing.id, "game": existing.game}
    
    session = models.GameSession(
        invite_id=invite_id,
        game=invite.game,
        player_x_id=invite.from_user_id,
        player_o_id=invite.to_user_id,
        board="_________",
        current_turn="X",
        status="playing",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"session_id": session.id, "game": session.game}


@router.get("/session/{session_id}")
def get_game_session(
    session_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Получить состояние игровой сессии."""
    session = db.query(models.GameSession).filter(models.GameSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    
    my_symbol = "X" if session.player_x_id == user.id else "O" if session.player_o_id == user.id else None
    opponent_id = session.player_o_id if my_symbol == "X" else session.player_x_id
    opponent = db.query(models.User).filter(models.User.id == opponent_id).first()
    
    return {
        "id": session.id,
        "game": session.game,
        "board": session.board,
        "current_turn": session.current_turn,
        "status": session.status,
        "my_symbol": my_symbol,
        "winner_id": session.winner_id,
        "player_x_id": session.player_x_id,
        "player_o_id": session.player_o_id,
        "opponent_name": opponent.first_name if opponent else "Игрок",
        "opponent_id": opponent_id,
    }


@router.post("/session/{session_id}/move")
def make_move(
    session_id: int,
    payload: dict,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Сделать ход в игре."""
    session = db.query(models.GameSession).filter(models.GameSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    if session.status != "playing":
        raise HTTPException(400, "Игра завершена")
    
    my_symbol = "X" if session.player_x_id == user.id else "O" if session.player_o_id == user.id else None
    if not my_symbol:
        raise HTTPException(403, "Вы не участник этой игры")
    if session.current_turn != my_symbol:
        raise HTTPException(400, "Не ваш ход")
    
    pos = payload.get("position")
    if isinstance(pos, bool) or not isinstance(pos, int):
        raise HTTPException(400, "Неверная позиция")
    if pos < 0 or pos > 8:
        raise HTTPException(400, "Неверная позиция")
    
    board = list(session.board)
    if board[pos] != "_":
        raise HTTPException(400, "Клетка занята")
    
    board[pos] = my_symbol
    session.board = "".join(board)
    
    # Check win
    wins = [(0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)]
    for a, b, c in wins:
        if board[a] == board[b] == board[c] and board[a] != "_":
            session.status = "x_won" if board[a] == "X" else "o_won"
            session.winner_id = session.player_x_id if board[a] == "X" else session.player_o_id
            break
    else:
        if "_" not in board:
            session.status = "draw"
        else:
            session.current_turn = "O" if my_symbol == "X" else "X"
    
    db.commit()
    return {"ok": True, "board": session.board, "status": session.status, "current_turn": session.current_turn}


@router.get("/session/{session_id}/poll")
def poll_session(
    session_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Опрос состояния сессии (для реалтайм обновлений)."""
    return get_game_session(session_id, user, db)


@router.get("/my-sessions")
def get_my_sessions(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Получить активные игровые сессии."""
    sessions = db.query(models.GameSession).filter(
        (models.GameSession.player_x_id == user.id) | (models.GameSession.player_o_id == user.id),
        models.GameSession.status == "playing",
    ).all()
    return {"sessions": [{
        "id": s.id, "game": s.game, "board": s.board,
        "current_turn": s.current_turn, "status": s.status,
        "my_symbol": "X" if s.player_x_id == user.id else "O",
    } for s in sessions]}


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