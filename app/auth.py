from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any
from urllib.parse import parse_qsl

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.config import get_settings
from app.db import get_db
from app.players import binding_for, is_bound_admin


def is_admin(user: models.User) -> bool:
    # Жёсткая привязка по Telegram ID — главный источник правды для админ-прав.
    if is_bound_admin(user.telegram_id):
        return True
    settings = get_settings()
    if settings.admin_id_list and user.telegram_id in settings.admin_id_list:
        return True
    if user.username and user.username.lower().lstrip("@") in settings.admin_username_list:
        return True
    return False


def parse_init_data(init_data: str) -> dict[str, str]:
    return dict(parse_qsl(init_data, keep_blank_values=True))


def validate_init_data(init_data: str, bot_token: str, max_age_seconds: int = 60 * 60 * 24) -> dict[str, Any]:
    """
    Validate Telegram WebApp initData per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    Returns the parsed user dict on success, raises HTTPException(401) on failure.
    """
    if not init_data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing initData")

    data = parse_init_data(init_data)
    received_hash = data.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing hash")

    auth_date_str = data.get("auth_date", "0")
    try:
        auth_date = int(auth_date_str)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad auth_date") from exc

    if max_age_seconds and time.time() - auth_date > max_age_seconds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="initData expired")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad hash")

    user_raw = data.get("user")
    if not user_raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="no user in initData")
    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad user json") from exc

    return {"user": user, "auth_date": auth_date, "raw": data}


def _is_allowed_user(tg_user: dict[str, Any]) -> bool:
    """Check if this Telegram user is permitted to access the mini-app or bot."""
    return _is_allowed_tg_id(int(tg_user["id"]), tg_user.get("username", ""))


def _is_allowed_tg_id(tg_id: int, username: str = "") -> bool:
    # Привязанные игроки (Омар/Ибрагим/Магомет) всегда допущены.
    if binding_for(tg_id) is not None:
        return True
    settings = get_settings()
    if settings.admin_id_list and tg_id in settings.admin_id_list:
        return True
    username_clean = username.lower().lstrip("@") if username else ""
    if username_clean and username_clean in settings.admin_username_list:
        return True
    return False


def upsert_user(db: Session, tg_user: dict[str, Any]) -> models.User | None:
    """Return existing user or None (no auto-creation — restricted access).

    Admins (by telegram_id or username in config) can auto-register on first visit.
    """
    tg_id = int(tg_user["id"])
    binding = binding_for(tg_id)
    user = db.query(models.User).filter(models.User.telegram_id == tg_id).one_or_none()
    if user is not None:
        user.username = tg_user.get("username") or user.username
        user.first_name = tg_user.get("first_name") or user.first_name
        user.last_name = tg_user.get("last_name") or user.last_name
        # Аватарка всегда из актуального Telegram-профиля.
        user.photo_url = tg_user.get("photo_url") or user.photo_url
        if binding is not None:
            # Жёсткая привязка: роль и каноничное имя выдаются строго по ID.
            user.role = binding["role"]
            user.first_name = binding["first_name"]
        return user
    if binding is not None or _is_allowed_user(tg_user):
        user = models.User(
            telegram_id=tg_id,
            username=tg_user.get("username") or (binding or {}).get("username"),
            first_name=(binding or {}).get("first_name") or tg_user.get("first_name", ""),
            last_name=tg_user.get("last_name"),
            photo_url=tg_user.get("photo_url"),
            role=(binding or {}).get("role", "Гражданин"),
        )
        db.add(user)
        db.flush()
        db.add(models.Wallet(user_id=user.id, balance=0))
        db.flush()
        return user
    return None


def current_user(
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
    db: Session = Depends(get_db),
) -> models.User:
    settings = get_settings()
    if settings.skip_init_data_check and x_telegram_init_data == "DEV":
        tg_user = {"id": 849162365, "username": "omarbutuev", "first_name": "Омар"}
    else:
        if not settings.telegram_bot_token:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="bot token not configured")
        parsed = validate_init_data(x_telegram_init_data or "", settings.telegram_bot_token)
        tg_user = parsed["user"]

    user = upsert_user(db, tg_user)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для граждан Федерации Ковчега",
        )
    now = models.now_utc()
    # Throttle last_seen writes: only update (and commit) if more than ~60s have
    # elapsed since the last recorded value. This avoids a write+commit on every GET.
    if user.last_seen is None or (now - user.last_seen).total_seconds() > 60:
        user.last_seen = now
        db.commit()
        db.refresh(user)
    return user


def require_admin(
    user: models.User = Depends(current_user),
) -> models.User:
    if not is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только для администратора")
    return user
