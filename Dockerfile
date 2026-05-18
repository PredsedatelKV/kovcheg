FROM python:3.11-slim

WORKDIR /app

# Системные зависимости для сборки пакетов
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Копируем зависимости и устанавливаем
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e "."

# Предзагружаем модель эмбеддингов, чтобы не качать при каждом запуске контейнера
RUN python -c \
    "from sentence_transformers import SentenceTransformer; \
     SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

# Копируем код приложения
COPY app ./app
COPY static ./static
COPY main.py ./
COPY scripts ./scripts
COPY data ./data

# Переменные окружения
ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
