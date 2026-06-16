from __future__ import annotations

import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

# Порог релевантности: чанки с косинусным сходством ниже отсекаются.
# Эмбеддинги нормированы (см. embedder.normalize_embeddings=True), поэтому
# косинус == скалярное произведение в диапазоне ~[-1, 1].
RELEVANCE_THRESHOLD = 0.3

# Кэш матрицы эмбеддингов рядом со стором. Раньше матрица пересобиралась из
# списка dict на КАЖДЫЙ запрос. Теперь строится один раз и переиспользуется,
# пока стор не изменится. Ключ кэша — (id(chunks), len(chunks), dim): стор это
# синглтон, поэтому объект списка стабилен между запросами и подменяется только
# при реиндексации/reload_store (новый объект → новый id).
_cache_key: tuple[int, int, int] | None = None
_cache_matrix: np.ndarray | None = None
_cache_valid_indices: list[int] | None = None


def cosine_similarity(query: np.ndarray, vectors: np.ndarray) -> np.ndarray:
    """Возвращает массив косинусных сходств между query и каждым вектором."""
    # query: (dim,), vectors: (n, dim)
    dot = vectors @ query
    norm_q = np.linalg.norm(query)
    norm_v = np.linalg.norm(vectors, axis=1)
    return dot / (norm_q * norm_v + 1e-10)


def _build_matrix(chunks: list[dict[str, Any]], dim: int) -> tuple[np.ndarray, list[int]]:
    """Собирает float32-матрицу эмбеддингов, пропуская чанки с неверной размерностью.

    Возвращает (matrix, valid_indices), где valid_indices — индексы исходных
    чанков, попавших в матрицу. Защищает numpy от dtype=object при рассинхроне
    размерностей.
    """
    rows: list[list[float]] = []
    valid_indices: list[int] = []
    for i, c in enumerate(chunks):
        emb = c.get("embedding")
        if emb is None or len(emb) != dim:
            log.warning(
                "Skipping chunk %s: embedding dim %s != query dim %s",
                c.get("id", "?"),
                (len(emb) if emb is not None else None),
                dim,
            )
            continue
        rows.append(emb)
        valid_indices.append(i)
    if not rows:
        return np.empty((0, dim), dtype=np.float32), []
    return np.asarray(rows, dtype=np.float32), valid_indices


def find_top_k(query_embedding: np.ndarray, chunks: list[dict[str, Any]], top_k: int = 5) -> list[dict[str, Any]]:
    """Находит top_k наиболее похожих чанков на запрос (с порогом релевантности)."""
    global _cache_key, _cache_matrix, _cache_valid_indices

    if not chunks:
        return []

    dim = int(query_embedding.shape[0])

    cache_key = (id(chunks), len(chunks), dim)
    if _cache_key != cache_key or _cache_matrix is None or _cache_valid_indices is None:
        matrix, valid_indices = _build_matrix(chunks, dim)
        _cache_key = cache_key
        _cache_matrix = matrix
        _cache_valid_indices = valid_indices

    matrix = _cache_matrix
    valid_indices = _cache_valid_indices
    if matrix.shape[0] == 0:
        return []

    sims = cosine_similarity(query_embedding, matrix)
    order = np.argsort(sims)[::-1]

    results: list[dict[str, Any]] = []
    for row_idx in order:
        score = float(sims[int(row_idx)])
        if score < RELEVANCE_THRESHOLD:
            break  # порядок убывающий — дальше только меньше
        chunk = chunks[valid_indices[int(row_idx)]]
        results.append(
            {
                "id": chunk["id"],
                "text": chunk["text"],
                "source": chunk.get("source", ""),
                "score": score,
            }
        )
        if len(results) >= top_k:
            break
    return results
