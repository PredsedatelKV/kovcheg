# Деплой на VPS

Пошаговая инструкция для развёртывания «Ковчега» на собственном сервере (VPS).

## Требования

- Сервер с Ubuntu 22.04+ (2 CPU, 2-4 GB RAM — достаточно)
- Docker + Docker Compose (v2)
- Домен (опционально, но настоятельно рекомендуется для webhook)

## 1. Подготовка сервера

```bash
# Обновление
sudo apt update && sudo apt upgrade -y

# Установка Docker
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
# Перелогинься или выполни:
newgrp docker
```

## 2. Клонирование и настройка

```bash
git clone https://github.com/PredsedatelKV/kovcheg.git
cd kovcheg

cp .env.example .env
nano .env
```

**Обязательно заполни в `.env`:**
- `TELEGRAM_BOT_TOKEN` — от @BotFather
- `TELEGRAM_WEBHOOK_SECRET` — случайная строка
- `PUBLIC_URL` — твой домен (или IP с https)
- `ADMIN_IDS` — твой Telegram ID
- `LLM_API_KEY` — ключ от OpenRouter (или другого API)

## 3. Материалы для агента

Положи текстовые файлы с материалами по Ковчегу в папку `data/knowledge/`:

```bash
# Пример: создай файл
cat > data/knowledge/ustav.txt << 'EOF'
Устав общины Ковчег.
Ковчег — это цифровая община для...
EOF
```

Проиндексируй (создаст JSON-хранилище эмбеддингов):

```bash
# При первом запуске модель скачается (~400MB) и закэшируется в образ
docker compose run --rm kovcheg python scripts/index_knowledge.py
```

## 4. Запуск приложения

```bash
# Сборка и запуск
docker compose up -d --build

# Проверка логов
docker compose logs -f kovcheg
```

Приложение будет доступно на `http://localhost:8000` внутри сервера.

## 5. Настройка Nginx + SSL (Let's Encrypt)

### 5.1 Получение сертификата

```bash
sudo apt install -y certbot

# Создаём папки для certbot
mkdir -p certbot/conf certbot/www

# Получаем сертификат (замени kovcheg.example.com на свой домен)
sudo certbot certonly --webroot \
  -w $(pwd)/certbot/www \
  -d kovcheg.example.com
```

### 5.2 Раскомментирование Nginx

Открой `docker-compose.yml` и убери `#` у блока `nginx:`.

Открой `nginx/nginx.conf` и замени `ВАШ_ДОМЕН` на свой домен.

```bash
# Перезапуск с nginx
docker compose up -d
```

## 6. Настройка webhook Telegram

```bash
# Замени URL и SECRET на свои
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://kovcheg.example.com/telegram/webhook/YOUR_SECRET"}'
```

Или открой в браузере:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://kovcheg.example.com/telegram/webhook/YOUR_SECRET
```

## 7. Обновление (после правок)

```bash
git pull  # если обновляешь с GitHub
docker compose up -d --build
```

## 8. Резервное копирование

Всё важное лежит в папке `data/`:

```bash
# Бэкап
tar czvf kovcheg-backup-$(date +%F).tar.gz data/

# Восстановление
tar xzvf kovcheg-backup-XXXX-XX-XX.tar.gz
```

## Полезные команды

```bash
# Перезапуск
docker compose restart kovcheg

# Полные логи
docker compose logs -f --tail=100 kovcheg

# Остановка
docker compose down

# Очистка хранилища знаний + переиндексация
docker compose run --rm kovcheg python scripts/index_knowledge.py --clear
```
