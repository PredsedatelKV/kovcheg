#!/bin/bash
# Локальный запуск Ковчега с Мошонкой

set -a
source .env
set +a

source .venv/bin/activate

echo "Запуск Ковчега на http://localhost:8000"
echo "Открой в браузере: http://localhost:8000"
echo ""

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
