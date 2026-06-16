from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import games_checkers as checkers
from app import models, schemas
from app.auth import current_user
from app.config import get_settings
from app.db import get_db

router = APIRouter(prefix="/api/game", tags=["game"])

MSK = timezone(timedelta(hours=3))
ONLINE_WINDOW = timedelta(minutes=2)

GAME_NAMES = {"tictactoe": "Крестики-нолики", "checkers": "Шашки", "pingpong": "Пинг-понг"}
PONG_WIN_SCORE = 5


def _is_online(u: models.User) -> bool:
    return u.last_seen is not None and (models.now_utc() - u.last_seen) <= ONLINE_WINDOW


def _to_msk(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MSK).strftime("%H:%M")


def _new_session_state(game: str) -> tuple[str, str | None]:
    """Возвращает (board, state_json) для начального состояния игры."""
    if game == "checkers":
        return checkers.initial_board(), None
    if game == "pingpong":
        st = {"ball": {"x": 0.5, "y": 0.5, "vx": 0.012, "vy": 0.009}, "px": 0.5, "po": 0.5, "sx": 0, "so": 0}
        return "", json.dumps(st)
    return "_________", None  # tictactoe


def _session_view(session: models.GameSession, user: models.User, db: Session) -> dict:
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
        "state": json.loads(session.state) if session.state else None,
    }


# ----------------------------- Приглашения -----------------------------

@router.post("/invite")
def send_invite(
    payload: schemas.GameInviteRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if payload.to_user_id == user.id:
        raise HTTPException(400, "Нельзя пригласить самого себя")
    to_user = db.query(models.User).filter(models.User.id == payload.to_user_id).first()
    if not to_user:
        raise HTTPException(404, "Игрок не найден")

    # Закрываем прежние свои pending-приглашения этому игроку (чтобы не плодить).
    db.query(models.GameInvite).filter(
        models.GameInvite.from_user_id == user.id,
        models.GameInvite.to_user_id == to_user.id,
        models.GameInvite.status == "pending",
    ).update({"status": "cancelled"}, synchronize_session=False)

    invite = models.GameInvite(
        from_user_id=user.id, to_user_id=to_user.id, game=payload.game, status="pending"
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    game_name = GAME_NAMES.get(payload.game, payload.game)
    # Оффлайн-игроку — сразу пуш в Telegram. Онлайн увидит приглашение в приложении (поллер).
    delivered = "app"
    if not _is_online(to_user):
        from app.notify import notify_user_bg
        settings = get_settings()
        notify_user_bg(
            to_user.telegram_id,
            f"⚔️ <b>{user.first_name}</b> вызывает вас на бой в «<b>{game_name}</b>»!\n"
            f"Откройте Ковчег, чтобы принять вызов.",
            web_app_url=settings.public_url,
        )
        delivered = "telegram"

    from app.notify import notify_admins_bg
    notify_admins_bg(f"⚔️ <b>{user.first_name}</b> пригласил(а) <b>{to_user.first_name}</b> в «<b>{game_name}</b>»")

    return {"id": invite.id, "status": "pending", "delivered": delivered}


@router.get("/state")
def game_state(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Лёгкий эндпоинт для глобального поллера: входящие приглашения + активные сессии."""
    invites = (
        db.query(models.GameInvite)
        .filter(models.GameInvite.to_user_id == user.id, models.GameInvite.status == "pending")
        .order_by(models.GameInvite.created_at.desc())
        .all()
    )
    sessions = (
        db.query(models.GameSession)
        .filter(
            (models.GameSession.player_x_id == user.id) | (models.GameSession.player_o_id == user.id),
            models.GameSession.status == "playing",
        )
        .all()
    )
    return {
        "incoming_invites": [
            {
                "id": i.id,
                "game": i.game,
                "game_name": GAME_NAMES.get(i.game, i.game),
                "from_user_id": i.from_user_id,
                "from_user_name": i.from_user.first_name if i.from_user else "Игрок",
            }
            for i in invites
        ],
        "sessions": [{"id": s.id, "game": s.game, "status": s.status} for s in sessions],
    }


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
        raise HTTPException(404, "Приглашение не найдено")

    invite.status = "accepted"

    # Сразу создаём общую сессию — оба игрока попадут в неё (через поллер/ответ).
    existing = db.query(models.GameSession).filter(models.GameSession.invite_id == invite.id).first()
    if existing:
        session = existing
    else:
        board, state = _new_session_state(invite.game)
        session = models.GameSession(
            invite_id=invite.id,
            game=invite.game,
            player_x_id=invite.from_user_id,
            player_o_id=invite.to_user_id,
            board=board,
            current_turn="X",
            status="playing",
            state=state,
        )
        db.add(session)
    db.commit()
    db.refresh(session)

    # Уведомляем пригласившего, если он оффлайн.
    inviter = db.query(models.User).filter(models.User.id == invite.from_user_id).first()
    if inviter and not _is_online(inviter):
        from app.notify import notify_user_bg
        settings = get_settings()
        notify_user_bg(
            inviter.telegram_id,
            f"✅ <b>{user.first_name}</b> принял(а) ваш вызов в «<b>{GAME_NAMES.get(invite.game, invite.game)}</b>»! "
            f"Откройте Ковчег — игра уже идёт.",
            web_app_url=settings.public_url,
        )

    return {"status": "accepted", "game": invite.game, "session_id": session.id}


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
        raise HTTPException(404, "Приглашение не найдено")
    invite.status = "declined"
    db.commit()
    return {"status": "declined"}


@router.get("/my-invites")
def get_my_invites(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    invites = db.query(models.GameInvite).filter(
        (models.GameInvite.to_user_id == user.id) | (models.GameInvite.from_user_id == user.id)
    ).order_by(models.GameInvite.created_at.desc()).limit(20).all()
    return {"invites": [
        {
            "id": i.id,
            "game": i.game,
            "game_name": GAME_NAMES.get(i.game, i.game),
            "from_user_id": i.from_user_id,
            "from_user_name": i.from_user.first_name if i.from_user else "Игрок",
            "to_user_id": i.to_user_id,
            "to_user_name": i.to_user.first_name if i.to_user else "Игрок",
            "status": i.status,
            "created_at_msk": _to_msk(i.created_at),
        }
        for i in invites
    ]}


# ----------------------------- Сессии -----------------------------

def _get_session_for(session_id: int, user: models.User, db: Session) -> models.GameSession:
    session = db.query(models.GameSession).filter(models.GameSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    if user.id not in (session.player_x_id, session.player_o_id):
        raise HTTPException(403, "Вы не участник этой игры")
    return session


@router.get("/session/{session_id}")
def get_game_session(
    session_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return _session_view(_get_session_for(session_id, user, db), user, db)


@router.get("/session/{session_id}/poll")
def poll_session(
    session_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return _session_view(_get_session_for(session_id, user, db), user, db)


@router.post("/session/{session_id}/move")
def make_move(
    session_id: int,
    payload: dict,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Ход в крестики-нолики."""
    session = _get_session_for(session_id, user, db)
    if session.game != "tictactoe":
        raise HTTPException(400, "Не та игра")
    if session.status != "playing":
        raise HTTPException(400, "Игра завершена")
    my_symbol = "X" if session.player_x_id == user.id else "O"
    if session.current_turn != my_symbol:
        raise HTTPException(400, "Не ваш ход")

    pos = payload.get("position")
    if isinstance(pos, bool) or not isinstance(pos, int) or pos < 0 or pos > 8:
        raise HTTPException(400, "Неверная позиция")
    board = list(session.board)
    if board[pos] != "_":
        raise HTTPException(400, "Клетка занята")
    board[pos] = my_symbol
    session.board = "".join(board)

    wins = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]
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
    session.updated_at = models.now_utc()
    db.commit()
    return _session_view(session, user, db)


@router.post("/session/{session_id}/checkers-move")
def checkers_move(
    session_id: int,
    payload: dict,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Ход в шашки: {from, to}. При продолжении боя ход остаётся за тем же игроком."""
    session = _get_session_for(session_id, user, db)
    if session.game != "checkers":
        raise HTTPException(400, "Не та игра")
    if session.status != "playing":
        raise HTTPException(400, "Игра завершена")
    my_symbol = "X" if session.player_x_id == user.id else "O"
    if session.current_turn != my_symbol:
        raise HTTPException(400, "Не ваш ход")

    frm, to = payload.get("from"), payload.get("to")
    if not all(isinstance(v, int) for v in (frm, to)):
        raise HTTPException(400, "Неверный ход")
    side = "x" if my_symbol == "X" else "o"
    try:
        res = checkers.apply_move(session.board, side, frm, to)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    session.board = res["board"]
    if res["status"] != "playing":
        session.status = res["status"]
        session.winner_id = session.player_x_id if res["status"] == "x_won" else session.player_o_id
    elif not res["more"]:
        session.current_turn = "O" if my_symbol == "X" else "X"
    session.updated_at = models.now_utc()
    db.commit()
    out = _session_view(session, user, db)
    out["more"] = res["more"]
    return out


@router.post("/session/{session_id}/pong")
def pong_sync(
    session_id: int,
    payload: dict,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Синхронизация пинг-понга. Хост (X) шлёт полное состояние, гость (O) — свою ракетку."""
    session = _get_session_for(session_id, user, db)
    if session.game != "pingpong":
        raise HTTPException(400, "Не та игра")
    st = json.loads(session.state) if session.state else {}
    is_host = session.player_x_id == user.id

    if is_host:
        ball = payload.get("ball")
        if isinstance(ball, dict):
            st["ball"] = {k: float(ball.get(k, 0)) for k in ("x", "y", "vx", "vy")}
        if isinstance(payload.get("px"), (int, float)):
            st["px"] = float(payload["px"])
        if isinstance(payload.get("sx"), int):
            st["sx"] = max(0, payload["sx"])
        if isinstance(payload.get("so"), int):
            st["so"] = max(0, payload["so"])
    else:
        if isinstance(payload.get("po"), (int, float)):
            st["po"] = float(payload["po"])

    # Победа по очкам (авторитет — хост, он шлёт счёт).
    if session.status == "playing":
        if st.get("sx", 0) >= PONG_WIN_SCORE:
            session.status = "x_won"
            session.winner_id = session.player_x_id
        elif st.get("so", 0) >= PONG_WIN_SCORE:
            session.status = "o_won"
            session.winner_id = session.player_o_id

    session.state = json.dumps(st)
    session.updated_at = models.now_utc()
    db.commit()
    return _session_view(session, user, db)


@router.get("/my-sessions")
def get_my_sessions(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    sessions = db.query(models.GameSession).filter(
        (models.GameSession.player_x_id == user.id) | (models.GameSession.player_o_id == user.id),
        models.GameSession.status == "playing",
    ).all()
    return {"sessions": [{"id": s.id, "game": s.game, "status": s.status} for s in sessions]}


# Совместимость: старый клиент мог создавать сессию вручную после accept.
@router.post("/session/create")
def create_game_session(
    payload: dict,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    invite_id = payload.get("invite_id")
    if not invite_id:
        raise HTTPException(400, "invite_id обязателен")
    invite = db.query(models.GameInvite).filter(models.GameInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(404, "Приглашение не найдено")
    existing = db.query(models.GameSession).filter(models.GameSession.invite_id == invite_id).first()
    if existing:
        return {"session_id": existing.id, "game": existing.game}
    board, state = _new_session_state(invite.game)
    session = models.GameSession(
        invite_id=invite_id, game=invite.game, player_x_id=invite.from_user_id,
        player_o_id=invite.to_user_id, board=board, current_turn="X", status="playing", state=state,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"session_id": session.id, "game": session.game}


@router.get("/online")
def get_online_players(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    cutoff = models.now_utc() - ONLINE_WINDOW
    players = (
        db.query(models.User)
        .filter(models.User.id != user.id, models.User.last_seen.isnot(None), models.User.last_seen >= cutoff)
        .all()
    )
    return {"online": [{"id": p.id, "first_name": p.first_name} for p in players]}
