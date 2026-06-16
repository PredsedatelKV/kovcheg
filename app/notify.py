"""Notifications to admins via Telegram bot.

Endpoints call notify_admins_bg("html message") to push action logs to ALL admin
telegram chats (configured via ADMIN_IDS in .env, plus any User where
is_admin=True if they have a known telegram_id and have opened the mini-app).

The actual send is fire-and-forget: we schedule a background task on the running
event loop so HTTP endpoints stay snappy.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Iterable

from app.config import get_settings
from app.db import session_scope
from app import models

log = logging.getLogger(__name__)

# Keep strong references to fire-and-forget tasks so the event loop's weak
# bookkeeping doesn't let the GC cancel them mid-flight.
_background_tasks: set[asyncio.Task] = set()


def _resolve_admin_chat_ids() -> list[int]:
    settings = get_settings()
    ids: set[int] = set(settings.admin_id_list)

    # Plus any user whose username is in the admin allowlist (resolved once
    # they have logged in at least once).
    try:
        usernames = settings.admin_username_list
        if usernames:
            with session_scope() as db:
                admin_users = (
                    db.query(models.User)
                    .filter(models.User.username.in_(usernames))
                    .all()
                )
                for u in admin_users:
                    if u.telegram_id:
                        ids.add(int(u.telegram_id))
    except Exception as exc:  # noqa: BLE001
        log.warning("notify._resolve_admin_chat_ids db query failed: %s", exc)

    return list(ids)


async def _send_to_chats(chat_ids: Iterable[int], text: str) -> None:
    # Import lazily to avoid circular imports during app startup.
    from app.bot import get_bot

    try:
        bot = get_bot()
    except Exception as exc:  # noqa: BLE001
        log.warning("notify: bot unavailable: %s", exc)
        return
    for chat_id in chat_ids:
        try:
            await bot.send_message(chat_id, text)
        except Exception as exc:  # noqa: BLE001
            log.warning("notify: send to %s failed: %s", chat_id, exc)


async def _send_to_user(telegram_id: int, text: str, web_app_url: str | None) -> None:
    from app.bot import get_bot

    try:
        bot = get_bot()
    except Exception as exc:  # noqa: BLE001
        log.warning("notify: bot unavailable: %s", exc)
        return
    reply_markup = None
    if web_app_url:
        from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

        reply_markup = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="🎮 Открыть Ковчег", web_app=WebAppInfo(url=web_app_url))]]
        )
    try:
        await bot.send_message(telegram_id, text, reply_markup=reply_markup)
    except Exception as exc:  # noqa: BLE001
        log.warning("notify: send to user %s failed: %s", telegram_id, exc)


def notify_user_bg(telegram_id: int, text: str, web_app_url: str | None = None) -> None:
    """Отправить одному пользователю Telegram-сообщение (с кнопкой WebApp) не блокируя запрос."""
    if not telegram_id:
        return
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(_send_to_user(int(telegram_id), text, web_app_url))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    except RuntimeError:
        try:
            asyncio.run(_send_to_user(int(telegram_id), text, web_app_url))
        except Exception as exc:  # noqa: BLE001
            log.warning("notify: sync user send failed: %s", exc)


def notify_admins_bg(text: str) -> None:
    """Schedule an admin broadcast without blocking the request."""
    chat_ids = _resolve_admin_chat_ids()
    if not chat_ids:
        log.info("notify: no admin chat ids configured — message dropped: %s", text)
        return
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(_send_to_chats(chat_ids, text))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    except RuntimeError:
        # No running loop (e.g. unit test, sync context) — run synchronously.
        try:
            asyncio.run(_send_to_chats(chat_ids, text))
        except Exception as exc:  # noqa: BLE001
            log.warning("notify: sync send failed: %s", exc)
