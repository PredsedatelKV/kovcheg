from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


async def ask_llm(messages: list[dict[str, str]], max_tokens: int | None = None, temperature: float | None = None) -> str:
    """Универсальный клиент: OpenRouter или Gemini."""
    settings = get_settings()

    if not settings.llm_api_key:
        log.error("LLM_API_KEY is empty — check .env or env vars in Docker")
        return "⚠️ Агент не настроен: не указан API-ключ. Проверьте .env или переменные окружения."

    if settings.llm_provider == "gemini":
        return await _ask_gemini(messages, max_tokens, temperature)
    return await _ask_openrouter(messages, max_tokens, temperature)


async def _ask_openrouter(messages: list[dict[str, str]], max_tokens: int | None, temperature: float | None) -> str:
    settings = get_settings()
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
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
                msg = data["choices"][0].get("message", {})
                content = msg.get("content", "").strip()
                if not content:
                    content = msg.get("reasoning", "").strip()
                return content
            log.warning("Unexpected OpenRouter response: %s", data)
            return "⚠️ Агент получил неожиданный ответ."
        except httpx.HTTPStatusError as exc:
            log.error("OpenRouter HTTP %s: %s", exc.response.status_code, exc.response.text)
            if exc.response.status_code == 401:
                return "⚠️ Ошибка авторизации. Проверь API-ключ."
            return f"⚠️ Ошибка сети (HTTP {exc.response.status_code})."
        except httpx.RequestError as exc:
            log.error("OpenRouter request error: %s", exc)
            return "⚠️ Не удалось связаться с языковой моделью."
        except Exception as exc:
            log.error("OpenRouter error: %s", exc)
            return "⚠️ Ошибка при работе агента."


async def _ask_gemini(messages: list[dict[str, str]], max_tokens: int | None, temperature: float | None) -> str:
    """Google Gemini API — бесплатный tier."""
    settings = get_settings()
    model = settings.llm_model or "gemini-2.0-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.llm_api_key}"

    # Выделяем system prompt и историю
    system_text = ""
    contents: list[dict[str, Any]] = []

    for m in messages:
        role = m.get("role", "user")
        text = m.get("content", "")
        if role == "system":
            system_text = text
        elif role == "user":
            contents.append({"role": "user", "parts": [{"text": text}]})
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": text}]})

    payload: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": max_tokens or settings.llm_max_tokens,
            "temperature": temperature or settings.llm_temperature,
        },
    }
    if system_text:
        payload["systemInstruction"] = {"parts": [{"text": system_text}]}

    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(3):
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 429 and attempt < 2:
                    wait = (attempt + 1) * 3
                    log.warning("Gemini rate limit, retry in %ds (attempt %d)", wait, attempt + 1)
                    import asyncio
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        return parts[0].get("text", "").strip()
                log.warning("Unexpected Gemini response: %s", data)
                return "⚠️ Агент получил пустой ответ."
            except httpx.HTTPStatusError as exc:
                log.error("Gemini HTTP %s: %s", exc.response.status_code, exc.response.text)
                if exc.response.status_code == 400:
                    err = exc.response.json().get("error", {}).get("message", "")
                    if "API key not valid" in err:
                        return "⚠️ Неверный Gemini API-ключ."
                if exc.response.status_code == 429:
                    return "⏳ Лимит запросов исчерпан. Подожди минутку, сосед."
                return f"⚠️ Ошибка Gemini (HTTP {exc.response.status_code})."
            except httpx.RequestError as exc:
                log.error("Gemini request error: %s", exc)
                return "⚠️ Не удалось связаться с Gemini."
            except Exception as exc:
                log.error("Gemini error: %s", exc)
                return "⚠️ Ошибка при работе агента."
