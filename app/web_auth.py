from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import (
    WEB_LOGIN_TTL,
    WEB_SESSION_COOKIE,
    WEB_SESSION_TTL,
    consume_web_login,
    create_web_login_request,
    revoke_web_session,
)
from app.bot import get_bot
from app.db import get_db

router = APIRouter(prefix="/auth/web", tags=["web-auth"])


class LoginToken(BaseModel):
    token: str = Field(min_length=20, max_length=64)


@router.post("/start")
async def start_login(db: Session = Depends(get_db)) -> dict[str, str | int]:
    request = create_web_login_request(db)
    try:
        bot = await get_bot().get_me()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Telegram-бот временно недоступен") from exc
    if not bot.username:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="У бота не задан username")
    return {
        "token": request.token,
        "login_url": f"https://t.me/{bot.username}?start=web_{request.token}",
        "expires_in": int(WEB_LOGIN_TTL.total_seconds()),
    }


@router.post("/complete")
def complete_login(payload: LoginToken, db: Session = Depends(get_db)) -> JSONResponse:
    session_token = consume_web_login(db, payload.token)
    if session_token is None:
        return JSONResponse({"authenticated": False})
    response = JSONResponse({"authenticated": True})
    response.set_cookie(
        key=WEB_SESSION_COOKIE,
        value=session_token,
        max_age=int(WEB_SESSION_TTL.total_seconds()),
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return response


@router.post("/logout")
def logout(
    session_token: str | None = Cookie(default=None, alias=WEB_SESSION_COOKIE),
    db: Session = Depends(get_db),
) -> JSONResponse:
    revoke_web_session(db, session_token)
    response = JSONResponse({"ok": True})
    response.delete_cookie(WEB_SESSION_COOKIE, path="/")
    return response
