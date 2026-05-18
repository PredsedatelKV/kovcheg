from __future__ import annotations

import logging

from app.assistant.client import ask_llm
from app.assistant.embedder import encode_single
from app.assistant.prompts import SYSTEM_PROMPT
from app.assistant.search import find_top_k
from app.assistant.store import get_store
from app.config import get_settings

log = logging.getLogger(__name__)


async def ask(question: str, history: list[dict[str, str]] | None = None) -> dict:
    """Главная функция: принимает вопрос + историю, возвращает ответ Мошонки."""
    settings = get_settings()
    store = get_store()

    # 1. Эмбеддинг вопроса
    try:
        query_emb = encode_single(question)
    except Exception as exc:
        log.error("Embedding failed: %s", exc)
        return {"answer": "⚠️ Мошонка запнулся о корягу. Попробуй ещё раз, сосед.", "sources": []}

    # 2. Поиск релевантных чанков
    chunks = store.get_chunks()
    top_chunks = find_top_k(query_emb, chunks, top_k=settings.assistant_max_chunks)

    # 3. Формируем контекст (даже если пусто — Мошонка ответит в роли)
    if top_chunks:
        context_parts = []
        sources = []
        for i, ch in enumerate(top_chunks, 1):
            context_parts.append(f"[Фрагмент {i}]\n{ch['text']}")
            sources.append({"source": ch["source"], "score": round(ch["score"], 3)})
        context = "\n\n".join(context_parts)
    else:
        context = "(пока ничего не знаю по этому, но что-нибудь придумаю)"
        sources = []

    prompt = SYSTEM_PROMPT.format(context=context, question=question)

    # 4. Формируем messages с историей
    messages: list[dict[str, str]] = []

    # Добавляем историю (последние 10 сообщений, чтобы не переполнять контекст)
    if history:
        for msg in history[-10:]:
            role = msg.get("role", "user")
            # Переводим наше хранение в формат LLM
            llm_role = "user" if role == "user" else "assistant"
            messages.append({"role": llm_role, "content": msg.get("text", "")})

    # Добавляем текущий вопрос (если его ещё нет в истории)
    if not history or history[-1].get("text") != question:
        messages.append({"role": "user", "content": prompt})

    # 5. Запрос к LLM
    answer = await ask_llm(messages)

    return {"answer": answer, "sources": sources}
