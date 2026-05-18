from __future__ import annotations

import logging

from app.assistant.client import ask_llm
from app.assistant.embedder import encode_single
from app.assistant.prompts import SYSTEM_PROMPT
from app.assistant.search import find_top_k
from app.assistant.store import get_store
from app.config import get_settings

log = logging.getLogger(__name__)

# Базовая роль Мошонки для system-сообщения (краткая, LLM поймёт)
MOSHONKA_SYSTEM = (
    "Ты — Мошонка, деревенский житель из Minecraft. "
    "Живёшь в канаве у стены базы Ковчега, охраняешь тыквенную грядку. "
    "Говори просто, с крестьянским юмором, коротко. "
    "Не ломай четвёртую стену, не говори что ты ИИ."
)


async def ask(question: str, history: list[dict[str, str]] | None = None) -> dict:
    """Главная функция: принимает вопрос + историю, возвращает ответ Мошонки."""
    settings = get_settings()
    store = get_store()

    # Пробуем найти релевантные чанки, но если не получится — ничего страшного
    context = ""
    sources = []

    try:
        query_emb = encode_single(question)
        chunks = store.get_chunks()
        if chunks:
            top_chunks = find_top_k(query_emb, chunks, top_k=settings.assistant_max_chunks)
            if top_chunks:
                context_parts = []
                for i, ch in enumerate(top_chunks, 1):
                    context_parts.append(f"[Фрагмент {i}]\n{ch['text']}")
                    sources.append({"source": ch["source"], "score": round(ch["score"], 3)})
                context = "\n\n".join(context_parts)
    except Exception as exc:
        log.warning("Embedding/search failed (will answer without chunks): %s", exc)
        # Продолжаем без контекста — Мошонка ответит как житель

    # Формируем prompt
    if context:
        prompt = SYSTEM_PROMPT.format(context=context, question=question)
    else:
        # Нет материалов — просто спрашиваем в роли
        prompt = f"Вопрос гражданина: {question}\n\nОтветь как Мошонка, житель Ковчега:"

    # Формируем messages для LLM
    messages: list[dict[str, str]] = []

    # System prompt с ролью (важно для OpenRouter и Gemini)
    messages.append({"role": "system", "content": MOSHONKA_SYSTEM})

    # История чата (последние 10 сообщений)
    if history:
        for msg in history[-10:]:
            role = msg.get("role", "user")
            llm_role = "user" if role == "user" else "assistant"
            messages.append({"role": llm_role, "content": msg.get("text", "")})

    # Текущий вопрос
    messages.append({"role": "user", "content": prompt})

    # Запрос к LLM
    answer = await ask_llm(messages)

    return {"answer": answer, "sources": sources}
