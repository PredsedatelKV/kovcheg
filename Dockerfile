FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY pyproject.toml ./
RUN mkdir -p app/api app/assistant app/utils && \
    touch app/__init__.py app/api/__init__.py app/assistant/__init__.py app/utils/__init__.py
RUN pip install --no-cache-dir "."

# Remove stubs before copying real code
RUN rm -rf app
COPY app ./app
COPY static ./static
COPY main.py ./
COPY scripts ./scripts
COPY data ./data
COPY .env ./.env

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
