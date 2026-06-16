from __future__ import annotations

import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

# Минимальный косинусный score, ниже которого чанк считается нерелевантным
# и не попадает в контекст.
RELEVANCE_THRESHOLD = 0.2


def cosine_similarity(query: np.ndarray, vectors: np.ndarray) -> np.ndarray:
    """Возвращает массив косинусных сходств между query и каждым вектором."""
    # query: (dim,), vectors: (n, dim)
    dot = vectors @ query
    norm_q = np.linalg.norm(query)
    norm_v = np.linalg.norm(vectors, axis=1)
    return dot / (norm_q * norm_v + 1e-10)


def find_top_k(query_embedding: np.ndarray, chunks: list[dict[str, Any]], top_k: int = 5) -> list[dict[str, Any]]:
    """Находит top_k наиболее похожих чанков на запрос (с порогом релевантности)."""
    if not chunks:
        return []

    query = np.asarray(query_embedding, dtype=np.float32)
    dim = query.shape[0]

    # Защита от рассинхрона размерностей: оставляем только чанки с эмбеддингом
    # нужной длины, чтобы np не падал с невнятной ошибкой на dtype=object.
    valid_vectors: list[list[float]] = []
    valid_chunks: list[dict[str, Any]] = []
    skipped = 0
    for ch in chunks:
        emb = ch.get("embedding")
        if emb is None or len(emb) != dim:
            skipped += 1
            continue
        valid_vectors.append(emb)
        valid_chunks.append(ch)

    if skipped:
        log.warning("find_top_k: skipped %d chunk(s) with mismatched embedding dim (expected %d)", skipped, dim)

    if not valid_chunks:
        return []

    vectors = np.asarray(valid_vectors, dtype=np.float32)
    sims = cosine_similarity(query, vectors)

    # Берём top_k индексов через argpartition (быстрее полной сортировки),
    # затем сортируем только их по убыванию score.
    k = min(top_k, len(valid_chunks))
    if k <= 0:
        return []
    part_idx = np.argpartition(sims, -k)[-k:]
    top_indices = part_idx[np.argsort(sims[part_idx])[::-1]]

    results: list[dict[str, Any]] = []
    for idx in top_indices:
        score = float(sims[int(idx)])
        if score < RELEVANCE_THRESHOLD:
            continue
        chunk = valid_chunks[int(idx)]
        results.append(
            {
                "id": chunk["id"],
                "text": chunk["text"],
                "source": chunk.get("source", ""),
                "score": score,
            }
        )
    return results
