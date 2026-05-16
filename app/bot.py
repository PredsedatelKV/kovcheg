from __future__ import annotations

import logging
from typing import Any

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from app import models
from app.config import get_settings
from app.db import session_scope

log = logging.getLogger(__name__)

_bot: Bot | None = None
_dp: Dispatcher | None = None


def get_bot() -> Bot:
    global _bot
    if _bot is None:
        settings = get_settings()
        _bot = Bot(
            token=settings.telegram_bot_token,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML),
        )
    return _bot


def get_dispatcher() -> Dispatcher:
    global _dp
    if _dp is None:
        _dp = Dispatcher()
        _register_handlers(_dp)
    return _dp


def _webapp_keyboard(public_url: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🌍 Открыть Ковчег", web_app=WebAppInfo(url=public_url))]
        ],
        resize_keyboard=True,
    )


def _inline_webapp_kb(public_url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🌍 Открыть Ковчег", web_app=WebAppInfo(url=public_url))]]
    )


def _is_admin(tg_id: int) -> bool:
    return tg_id in get_settings().admin_id_list


def _register_handlers(dp: Dispatcher) -> None:
    @dp.message(CommandStart())
    async def cmd_start(message: Message) -> None:
        settings = get_settings()
        if not settings.public_url:
            await message.answer(
                "Привет! Мини-аппа ещё не настроена (нет публичного URL). Скажи админу запустить деплой."
            )
            return
        text = (
            "Добро пожаловать в <b>Ковчег</b>! 🏰\n\n"
            "Это цифровая община — выполняй задания, торгуй на Коверне, крути колесо фортуны.\n"
            "Нажми кнопку ниже, чтобы открыть приложение."
        )
        await message.answer(text, reply_markup=_webapp_keyboard(settings.public_url))
        await message.answer("Или открой через кнопку:", reply_markup=_inline_webapp_kb(settings.public_url))

    @dp.message(Command("help"))
    async def cmd_help(message: Message) -> None:
        text = (
            "Команды:\n"
            "/start — открыть приложение\n"
            "/help — помощь\n"
            "/me — информация о тебе\n"
            "\n"
            "Админские команды (только для админов):\n"
            "/approve &lt;user_task_id&gt; — подтвердить выполнение задания\n"
            "/reject &lt;user_task_id&gt; — отклонить задание\n"
            "/spawn &lt;tg_id&gt; &lt;item_code&gt; &lt;qty&gt; — выдать предмет\n"
            "/coins &lt;tg_id&gt; &lt;amount&gt; — выдать монеты\n"
            "/pending — список заданий, ждущих подтверждения"
        )
        await message.answer(text)

    @dp.message(Command("me"))
    async def cmd_me(message: Message) -> None:
        if not message.from_user:
            return
        with session_scope() as db:
            user = db.query(models.User).filter(models.User.telegram_id == message.from_user.id).one_or_none()
            if user is None:
                await message.answer("Ты ещё не открывал mini-app — открой его через /start.")
                return
            balance = user.wallet.balance if user.wallet else 0
            await message.answer(
                f"<b>{user.first_name}</b>\nДолжность: {user.role}\nБаланс: {balance} монет"
            )

    @dp.message(Command("pending"))
    async def cmd_pending(message: Message) -> None:
        if not message.from_user or not _is_admin(message.from_user.id):
            return
        with session_scope() as db:
            rows = (
                db.query(models.UserTask)
                .filter(models.UserTask.status == "in_progress")
                .order_by(models.UserTask.started_at.desc())
                .limit(20)
                .all()
            )
            if not rows:
                await message.answer("Нет заданий в процессе.")
                return
            lines = []
            for ut in rows:
                u = ut.user
                lines.append(
                    f"#{ut.id} — {u.first_name} (@{u.username or '-'}, tg:{u.telegram_id}) → {ut.task.name} "
                    f"[награда {ut.task.reward}]"
                )
            await message.answer("\n".join(lines))

    @dp.message(Command("approve"))
    async def cmd_approve(message: Message) -> None:
        if not message.from_user or not _is_admin(message.from_user.id):
            return
        parts = (message.text or "").split()
        if len(parts) < 2 or not parts[1].isdigit():
            await message.answer("Использование: /approve &lt;user_task_id&gt;")
            return
        user_task_id = int(parts[1])
        notify_text: str | None = None
        notify_tg_id: int | None = None
        with session_scope() as db:
            ut = db.query(models.UserTask).filter(models.UserTask.id == user_task_id).one_or_none()
            if ut is None:
                await message.answer("Запись задания не найдена")
                return
            if ut.status != "in_progress":
                await message.answer(f"Статус: {ut.status} — изменить нельзя")
                return
            ut.status = "done"
            ut.progress = ut.task.target_progress
            ut.approved_by = message.from_user.id
            from datetime import datetime as _dt

            ut.finished_at = _dt.utcnow()
            ut.user.wallet.balance += ut.task.reward
            db.add(
                models.Transaction(
                    sender_id=None,
                    recipient_id=ut.user_id,
                    amount=ut.task.reward,
                    note=f"task:{ut.task.id}",
                )
            )
            notify_text = (
                f"🎉 Задание <b>{ut.task.name}</b> подтверждено!\nНаграда: {ut.task.reward} монет."
            )
            notify_tg_id = ut.user.telegram_id

        await message.answer(f"OK, задание #{user_task_id} подтверждено")
        if notify_tg_id and notify_text:
            try:
                await get_bot().send_message(notify_tg_id, notify_text)
            except Exception as exc:  # noqa: BLE001
                log.warning("Не смог уведомить пользователя %s: %s", notify_tg_id, exc)

    @dp.message(Command("reject"))
    async def cmd_reject(message: Message) -> None:
        if not message.from_user or not _is_admin(message.from_user.id):
            return
        parts = (message.text or "").split(maxsplit=2)
        if len(parts) < 2 or not parts[1].isdigit():
            await message.answer("Использование: /reject &lt;user_task_id&gt; [причина]")
            return
        user_task_id = int(parts[1])
        reason = parts[2] if len(parts) > 2 else "без причины"
        notify_tg_id: int | None = None
        with session_scope() as db:
            ut = db.query(models.UserTask).filter(models.UserTask.id == user_task_id).one_or_none()
            if ut is None:
                await message.answer("Запись задания не найдена")
                return
            ut.status = "cancelled"
            from datetime import datetime as _dt

            ut.finished_at = _dt.utcnow()
            notify_tg_id = ut.user.telegram_id

        await message.answer(f"OK, задание #{user_task_id} отклонено")
        if notify_tg_id:
            try:
                await get_bot().send_message(
                    notify_tg_id, f"❌ Задание #{user_task_id} отклонено. Причина: {reason}"
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("Не смог уведомить пользователя %s: %s", notify_tg_id, exc)

    @dp.message(Command("spawn"))
    async def cmd_spawn(message: Message) -> None:
        if not message.from_user or not _is_admin(message.from_user.id):
            return
        parts = (message.text or "").split()
        if len(parts) < 4:
            await message.answer("Использование: /spawn &lt;tg_id&gt; &lt;item_code&gt; &lt;qty&gt;")
            return
        try:
            tg_id = int(parts[1])
            qty = int(parts[3])
        except ValueError:
            await message.answer("tg_id и qty должны быть числами")
            return
        item_code = parts[2]
        with session_scope() as db:
            user = db.query(models.User).filter(models.User.telegram_id == tg_id).one_or_none()
            if user is None:
                await message.answer("Пользователь не найден (попроси открыть mini-app)")
                return
            item = db.query(models.Item).filter(models.Item.code == item_code).one_or_none()
            if item is None:
                await message.answer("Предмет с таким кодом не найден")
                return
            inv = (
                db.query(models.InventoryItem)
                .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == item.id)
                .one_or_none()
            )
            if inv is None:
                db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=qty))
            else:
                inv.quantity += qty
        await message.answer(f"Выдано {qty} × {item_code} пользователю {tg_id}")

    @dp.message(Command("coins"))
    async def cmd_coins(message: Message) -> None:
        if not message.from_user or not _is_admin(message.from_user.id):
            return
        parts = (message.text or "").split()
        if len(parts) < 3:
            await message.answer("Использование: /coins &lt;tg_id&gt; &lt;amount&gt;")
            return
        try:
            tg_id = int(parts[1])
            amount = int(parts[2])
        except ValueError:
            await message.answer("tg_id и amount должны быть числами")
            return
        with session_scope() as db:
            user = db.query(models.User).filter(models.User.telegram_id == tg_id).one_or_none()
            if user is None:
                await message.answer("Пользователь не найден")
                return
            user.wallet.balance += amount
            db.add(
                models.Transaction(
                    sender_id=None, recipient_id=user.id, amount=amount, note=f"admin:{message.from_user.id}"
                )
            )
        await message.answer(f"Выдано {amount} монет пользователю {tg_id}")

    @dp.message(F.web_app_data)
    async def on_webapp_data(message: Message) -> None:
        # На случай sendData из mini-app
        if message.web_app_data is None:
            return
        await message.answer(f"Принято из mini-app: {message.web_app_data.data}")


async def feed_update(payload: dict[str, Any]) -> None:
    from aiogram.types import Update

    dp = get_dispatcher()
    bot = get_bot()
    update = Update.model_validate(payload)
    await dp.feed_webhook_update(bot, update)


async def configure_webhook(public_url: str, secret: str) -> dict:
    bot = get_bot()
    webhook_url = f"{public_url.rstrip('/')}/telegram/webhook/{secret}"
    info = await bot.set_webhook(webhook_url, drop_pending_updates=True)
    return {"webhook_url": webhook_url, "ok": bool(info)}


async def set_menu_button(public_url: str) -> None:
    from aiogram.types import MenuButtonWebApp

    bot = get_bot()
    await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Ковчег", web_app=WebAppInfo(url=public_url)))
