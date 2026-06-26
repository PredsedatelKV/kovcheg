from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

# Один переиспользуемый AsyncClient на модуль (lazy-init) вместо нового на
# каждый запрос — экономит на установке TCP/TLS-соединений.
_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        async with _client_lock:
            if _client is None or _client.is_closed:
                _client = httpx.AsyncClient(timeout=60.0)
    return _client


def _safe_error_body(exc: httpx.HTTPStatusError) -> dict[str, Any]:
    """Безопасно парсит JSON-тело ошибки; при неудаче возвращает {} (текст в логах)."""
    try:
        return exc.response.json()
    except Exception:
        return {}


async def ask_llm(messages: list[dict[str, str]], max_tokens: int | None = None, temperature: float | None = None) -> str:
    """Универсальный клиент: OpenRouter, Gemini или Anthropic."""
    settings = get_settings()

    if not settings.llm_api_key:
        log.error("LLM_API_KEY is empty — check .env or env vars in Docker")
        return "⚠️ Агент не настроен: не указан API-ключ. Проверьте .env или переменные окружения."

    if settings.llm_provider == "gemini":
        return await _ask_gemini(messages, max_tokens, temperature)
    if settings.llm_provider == "anthropic":
        return await _ask_anthropic(messages, max_tokens, temperature)
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
        "max_tokens": max_tokens if max_tokens is not None else settings.llm_max_tokens,
        "temperature": temperature if temperature is not None else settings.llm_temperature,
    }

    client = await _get_client()
    for attempt in range(3):
        try:
            resp = await client.post(f"{settings.llm_base_url}/chat/completions", headers=headers, json=payload)
            # Ретрай с бэкоффом на 429/5xx
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt < 2:
                    wait = (attempt + 1) * 3
                    log.warning("OpenRouter HTTP %s, retry in %ds (attempt %d)", resp.status_code, wait, attempt + 1)
                    await asyncio.sleep(wait)
                    continue
            resp.raise_for_status()
            data = resp.json()
            if "choices" in data and len(data["choices"]) > 0:
                msg = data["choices"][0].get("message", {})
                content = (msg.get("content") or "").strip()
                if not content:
                    content = (msg.get("reasoning") or "").strip()
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
    return "⚠️ Не удалось получить ответ от языковой модели."


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
        text = m.get("content") or ""
        if role == "system":
            system_text = text
        elif role == "user":
            contents.append({"role": "user", "parts": [{"text": text}]})
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": text}]})

    payload: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": max_tokens if max_tokens is not None else settings.llm_max_tokens,
            "temperature": temperature if temperature is not None else settings.llm_temperature,
        },
    }
    if system_text:
        payload["systemInstruction"] = {"parts": [{"text": system_text}]}

    client = await _get_client()
    for attempt in range(3):
        try:
            resp = await client.post(url, json=payload)
            if (resp.status_code == 429 or resp.status_code >= 500) and attempt < 2:
                wait = (attempt + 1) * 3
                log.warning("Gemini HTTP %s, retry in %ds (attempt %d)", resp.status_code, wait, attempt + 1)
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return (parts[0].get("text") or "").strip()
            log.warning("Unexpected Gemini response: %s", data)
            return "⚠️ Агент получил пустой ответ."
        except httpx.HTTPStatusError as exc:
            log.error("Gemini HTTP %s: %s", exc.response.status_code, exc.response.text)
            if exc.response.status_code == 400:
                err = _safe_error_body(exc).get("error", {}).get("message", "")
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
    return "⚠️ Не удалось получить ответ от Gemini."


async def _ask_anthropic(messages: list[dict[str, str]], max_tokens: int | None, temperature: float | None) -> str:
    """Anthropic Claude API."""
    settings = get_settings()
    url = f"{settings.llm_base_url.rstrip('/')}/messages"
    headers = {
        "x-api-key": settings.llm_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    # Anthropic: system отдельно, messages только user/assistant
    system_text = ""
    anthro_messages: list[dict[str, str]] = []
    for m in messages:
        role = m.get("role", "user")
        text = m.get("content") or ""
        if role == "system":
            system_text = text
        elif role in ("user", "assistant"):
            anthro_messages.append({"role": role, "content": text})

    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "max_tokens": max_tokens if max_tokens is not None else settings.llm_max_tokens,
        "messages": anthro_messages,
    }
    if system_text:
        payload["system"] = system_text
    if temperature is not None:
        payload["temperature"] = temperature
    else:
        payload["temperature"] = settings.llm_temperature

    client = await _get_client()
    for attempt in range(3):
        try:
            resp = await client.post(url, headers=headers, json=payload)
            if (resp.status_code == 429 or resp.status_code >= 500) and attempt < 2:
                wait = (attempt + 1) * 3
                log.warning("Anthropic HTTP %s, retry in %ds (attempt %d)", resp.status_code, wait, attempt + 1)
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            content_blocks = data.get("content", [])
            for block in content_blocks:
                if block.get("type") == "text":
                    return (block.get("text") or "").strip()
            log.warning("Unexpected Anthropic response: %s", data)
            return "⚠️ Агент получил пустой ответ."
        except httpx.HTTPStatusError as exc:
            log.error("Anthropic HTTP %s: %s", exc.response.status_code, exc.response.text)
            if exc.response.status_code == 401:
                return "⚠️ Ошибка авторизации Anthropic. Проверь API-ключ."
            if exc.response.status_code == 429:
                return "⏳ Лимит запросов Anthropic исчерпан."
            return f"⚠️ Ошибка Anthropic (HTTP {exc.response.status_code})."
        except httpx.RequestError as exc:
            log.error("Anthropic request error: %s", exc)
            return "⚠️ Не удалось связаться с Anthropic."
        except Exception as exc:
            log.error("Anthropic error: %s", exc)
            return "⚠️ Ошибка при работе агента."
    return "⚠️ Не удалось получить ответ от Anthropic."
