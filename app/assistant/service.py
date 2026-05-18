from __future__ import annotations

import logging

from app.assistant.client import ask_llm
from app.assistant.embedder import encode_single
from app.assistant.prompts import NO_KNOWLEDGE_PROMPT, SYSTEM_PROMPT
from app.assistant.search import find_top_k
from app.assistant.store import get_store
from app.config import get_settings

log = logging.getLogger(__name__)


async def ask(question: str) -> dict:
    """Главная функция: принимает вопрос, возвращает ответ и источники."""
    settings = get_settings()
    store = get_store()

    if store.is_empty():
        prompt = NO_KNOWLEDGE_PROMPT.format(question=question)
        answer = await ask_llm([{"role": "user", "content": prompt}])
        return {"answer": answer, "sources": []}

    # 1. Эмбеддинг вопроса
    try:
        query_emb = encode_single(question)
    except Exception as exc:
        log.error("Embedding failed: %s", exc)
        return {"answer": "⚠️ Ошибка при анализе вопроса. Попробуйте позже.", "sources": []}

    # 2. Поиск релевантных чанков
    chunks = store.get_chunks()
    top_chunks = find_top_k(query_emb, chunks, top_k=settings.assistant_max_chunks)

    if not top_chunks:
        prompt = NO_KNOWLEDGE_PROMPT.format(question=question)
        answer = await ask_llm([{"role": "user", "content": prompt}])
        return {"answer": answer, "sources": []}

    # 3. Формируем контекст
    context_parts = []
    sources = []
    for i, ch in enumerate(top_chunks, 1):
        context_parts.append(f"[Фрагмент {i}]\n{ch['text']}")
        sources.append({"source": ch["source"], "score": round(ch["score"], 3)})

    context = "\n\n".join(context_parts)
    prompt = SYSTEM_PROMPT.format(context=context, question=question)

    # 4. Запрос к LLM
    messages = [
        {"role": "system", "content": "Ты — полезный ассистент общины Ковчег. Отвечай честно и по существу."},
        {"role": "user", "content": prompt},
    ]

    answer = await ask_llm(messages)

    return {"answer": answer, "sources": sources}
