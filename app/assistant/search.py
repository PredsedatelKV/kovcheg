from __future__ import annotations

import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)


def cosine_similarity(query: np.ndarray, vectors: np.ndarray) -> np.ndarray:
    """Возвращает массив косинусных сходств между query и каждым вектором."""
    # query: (dim,), vectors: (n, dim)
    dot = vectors @ query
    norm_q = np.linalg.norm(query)
    norm_v = np.linalg.norm(vectors, axis=1)
    return dot / (norm_q * norm_v + 1e-10)


def find_top_k(query_embedding: np.ndarray, chunks: list[dict[str, Any]], top_k: int = 5) -> list[dict[str, Any]]:
    """Находит top_k наиболее похожих чанков на запрос."""
    if not chunks:
        return []

    vectors = np.array([c["embedding"] for c in chunks])
    sims = cosine_similarity(query_embedding, vectors)
    top_indices = np.argsort(sims)[::-1][:top_k]

    results = []
    for idx in top_indices:
        chunk = chunks[int(idx)]
        results.append(
            {
                "id": chunk["id"],
                "text": chunk["text"],
                "source": chunk.get("source", ""),
                "score": float(sims[int(idx)]),
            }
        )
    return results
