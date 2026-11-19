from pathlib import Path
import os

from fastapi import HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from app.auth import WEB_SESSION_COOKIE, validate_init_data, web_session_user
from app.config import get_settings
from app.db import SessionLocal
from app.players import is_bound_admin


def preview_enabled() -> bool:
    return (Path(os.environ.get("DATA_DIR", "/app/data")) / "winter-preview-only").is_file()


def is_preview_owner(request: Request) -> bool:
    init_data = request.headers.get("X-Telegram-Init-Data")
    if init_data:
        token = get_settings().telegram_bot_token
        if not token:
            return False
        try:
            return is_bound_admin(int(validate_init_data(init_data, token)["user"]["id"]))
        except (HTTPException, KeyError, TypeError, ValueError):
            return False
    session = request.cookies.get(WEB_SESSION_COOKIE)
    if not session:
        return False
    with SessionLocal() as db:
        user = web_session_user(db, session)
        return user is not None and is_bound_admin(user.telegram_id)


async def preview_gate(request: Request, call_next):
    if request.url.path.startswith("/api/") and preview_enabled():
        if not await run_in_threadpool(is_preview_owner, request):
            return JSONResponse(
                {"detail": "Ковчег готовится к зимнему сезону", "code": "winter_preview"},
                status_code=423,
                headers={"Cache-Control": "no-store"},
            )
    return await call_next(request)
