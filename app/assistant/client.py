from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


async def ask_llm(messages: list[dict[str, str]], max_tokens: int | None = None, temperature: float | None = None) -> str:
    """Отправляет запрос к LLM API (OpenRouter по умолчанию)."""
    settings = get_settings()

    if not settings.llm_api_key:
        return "⚠️ Агент не настроен: не указан API-ключ для языковой модели. Обратитесь к администратору."

    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.public_url or "https://kovcheg.app",
        "X-Title": "Kovcheg Assistant",
    }

    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "max_tokens": max_tokens or settings.llm_max_tokens,
        "temperature": temperature or settings.llm_temperature,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(f"{settings.llm_base_url}/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

            if "choices" in data and len(data["choices"]) > 0:
                content = data["choices"][0].get("message", {}).get("content", "")
                return content.strip()

            log.warning("Unexpected LLM response structure: %s", data)
            return "⚠️ Агент получил неожиданный ответ от языковой модели."

        except httpx.HTTPStatusError as exc:
            log.error("LLM HTTP error %s: %s", exc.response.status_code, exc.response.text)
            if exc.response.status_code == 401:
                return "⚠️ Ошибка авторизации языковой модели. Проверьте API-ключ."
            return f"⚠️ Ошибка при обращении к языковой модели (HTTP {exc.response.status_code})."
        except httpx.RequestError as exc:
            log.error("LLM request error: %s", exc)
            return "⚠️ Не удалось связаться с языковой моделью. Проверьте подключение к интернету."
        except Exception as exc:
            log.error("Unexpected LLM error: %s", exc)
            return "⚠️ Произошла непредвиденная ошибка при работе агента."
