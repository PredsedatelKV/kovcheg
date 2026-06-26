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
from app.api import arcade as arcade_api
from app.api import battlepass as battlepass_api
from app.api import chat as chat_api
from app.api import content as content_api
from app.api import game as game_api
from app.api import home as home_api
from app.api import market as market_api
from app.api import profile as profile_api
from app.api import quiz as quiz_api
from app.api import shop as shop_api
from app.api import tasks as tasks_api
from app.api import wheel as wheel_api
from app.assistant.api import router as assistant_api
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
    # Warm up the embeddings model so the first assistant request isn't slow.
    try:
        from app.assistant.embedder import warmup
        warmup()
    except Exception as exc:  # noqa: BLE001
        log.warning("embedder warmup failed: %s", exc)
    settings = get_settings()
    if settings.public_url and settings.telegram_bot_token:
        import asyncio
        for attempt in range(5):
            try:
                res = await asyncio.wait_for(configure_webhook(settings.public_url, settings.telegram_webhook_secret), timeout=10)
                if res.get("skipped"):
                    log.info("Webhook already correct, skipping")
                else:
                    log.info("Telegram webhook configured: %s", res)
                await asyncio.wait_for(set_menu_button(settings.public_url), timeout=10)
                break
            except asyncio.TimeoutError:
                log.warning("Webhook attempt %d/5 timed out", attempt + 1)
            except Exception as exc:
                log.warning("Не удалось настроить webhook/menu (попытка %d/5): %s", attempt + 1, exc)
            if attempt < 4:
                await asyncio.sleep(5)
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
app.include_router(chat_api.router)
app.include_router(tasks_api.router)
app.include_router(quiz_api.router)
app.include_router(wheel_api.router)
app.include_router(shop_api.router)
app.include_router(market_api.router)
app.include_router(content_api.router)
app.include_router(arcade_api.router)
app.include_router(battlepass_api.router)
app.include_router(admin_api.router)
app.include_router(game_api.router)
app.include_router(assistant_api)


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
    # No-cache headers are applied by the no_cache_static middleware below,
    # so a plain StaticFiles mount is sufficient here.
    sf = StaticFiles(directory=str(STATIC_DIR))
    app.mount("/static", sf, name="static")

    @app.middleware("http")
    async def no_cache_static(request, call_next):
        resp = await call_next(request)
        if request.url.path.startswith("/static/") or request.url.path == "/" or request.url.path == "/manifest.json":
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            resp.headers["Pragma"] = "no-cache"
            resp.headers["Expires"] = "0"
        return resp

    @app.get("/")
    def root() -> FileResponse:
        return FileResponse(str(STATIC_DIR / "index.html"))

    @app.get("/manifest.json")
    def manifest() -> FileResponse:
        return FileResponse(str(STATIC_DIR / "manifest.json"))
