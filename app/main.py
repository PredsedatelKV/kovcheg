from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401  ensure models imported for create_all
from app.api import admin as admin_api
from app.api import content as content_api
from app.api import home as home_api
from app.api import market as market_api
from app.api import profile as profile_api
from app.api import shop as shop_api
from app.api import tasks as tasks_api
from app.api import wheel as wheel_api
from app.bot import configure_webhook, feed_update, set_menu_button
from app.config import get_settings
from app.db import Base, engine, session_scope
from app.seed import migrate_icons, migrate_schema, seed

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with session_scope() as db:
        migrate_schema(db)
        seed(db)
        migrate_icons(db)
    settings = get_settings()
    if settings.public_url and settings.telegram_bot_token:
        try:
            res = await configure_webhook(settings.public_url, settings.telegram_webhook_secret)
            log.info("Telegram webhook configured: %s", res)
            await set_menu_button(settings.public_url)
        except Exception as exc:  # noqa: BLE001
            log.warning("Не удалось настроить webhook/menu: %s", exc)
    yield


app = FastAPI(title="Ковчег Mini-App", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(home_api.router)
app.include_router(profile_api.router)
app.include_router(tasks_api.router)
app.include_router(wheel_api.router)
app.include_router(shop_api.router)
app.include_router(market_api.router)
app.include_router(content_api.router)
app.include_router(admin_api.router)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/telegram/webhook/{secret}")
async def telegram_webhook(secret: str, request: Request) -> JSONResponse:
    settings = get_settings()
    if secret != settings.telegram_webhook_secret:
        raise HTTPException(status_code=403, detail="bad secret")
    payload = await request.json()
    await feed_update(payload)
    return JSONResponse({"ok": True})


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    def root() -> FileResponse:
        return FileResponse(str(STATIC_DIR / "index.html"))

    @app.get("/manifest.json")
    def manifest() -> FileResponse:
        return FileResponse(str(STATIC_DIR / "manifest.json"))
