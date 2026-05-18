from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

# Многоязычная лёгкая модель для эмбеддингов (~120MB в памяти, хорошо работает на CPU)
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


@lru_cache(maxsize=1)
def _get_model() -> Any:
    """Ленивая загрузка модели sentence-transformers."""
    try:
        from sentence_transformers import SentenceTransformer

        log.info("Loading embedding model: %s", MODEL_NAME)
        model = SentenceTransformer(MODEL_NAME)
        log.info("Embedding model loaded")
        return model
    except Exception as exc:
        log.error("Failed to load sentence-transformers model: %s", exc)
        raise


def encode_texts(texts: list[str]) -> np.ndarray:
    """Превращает список текстов в матрицу эмбеддингов."""
    model = _get_model()
    return model.encode(texts, convert_to_numpy=True, show_progress_bar=False)


def encode_single(text: str) -> np.ndarray:
    """Превращает один текст в вектор эмбеддинга."""
    return encode_texts([text])[0]
