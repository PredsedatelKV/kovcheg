# Ковчег — Telegram Mini-App

Цифровая община «Ковчега» в Telegram. Мини-аппа с тремя вкладками: Главная, Профиль, Коверна (магазин и рынок), а также бот с командами модерации.

## Стек

- Python 3.11+ / FastAPI / SQLAlchemy / SQLite
- Aiogram 3 (Telegram bot, webhook)
- Vanilla JS + Telegram WebApp SDK на фронте
- Деплой: Fly.io (общий контейнер: бэкенд + статика)

## Структура

```
app/                  # бэкенд (FastAPI + бот)
  main.py             # сборка приложения, монтирование статиков, webhook
  bot.py              # обработчики aiogram
  api/                # роуты mini-app
  models.py           # ORM модели
  auth.py             # валидация Telegram initData
  seed.py             # стартовые данные
static/               # фронт (HTML/CSS/JS)
  index.html
  app.js
  pages/{home,profile,koverna}.js
```

## Переменные окружения

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Произвольная строка, часть URL вебхука |
| `PUBLIC_URL` | Публичный HTTPS URL приложения (для WebApp ссылок) |
| `ADMIN_IDS` | CSV Telegram ID админов, которые модерируют задания |
| `CHANNEL_URL` | URL ТГ-канала «Ковчега» |
| `DATA_DIR` | Папка для SQLite (по умолчанию `/data` на Fly, иначе `app/var`) |
| `SKIP_INIT_DATA_CHECK` | `true` → разрешить заголовок `X-Telegram-Init-Data: DEV` (только для локальной отладки) |

## Локальный запуск

```bash
pip install -e .
export TELEGRAM_BOT_TOKEN=...    # любое непустое для запуска
export SKIP_INIT_DATA_CHECK=true # чтобы открыть фронт в обычном браузере
uvicorn app.main:app --reload --port 8000
```

Открой `http://localhost:8000/` — фронт работает в режиме без Telegram, использует тестового пользователя.

## Команды бота

- `/start` — приветствие и кнопка для открытия mini-app
- `/help` — список команд
- `/me` — баланс и должность
- `/pending` (админ) — задания в процессе
- `/approve <user_task_id>` (админ) — подтвердить выполнение, начислить награду, уведомить
- `/reject <user_task_id> [причина]` (админ)
- `/spawn <tg_id> <item_code> <qty>` (админ) — выдать предмет
- `/coins <tg_id> <amount>` (админ) — выдать монеты
