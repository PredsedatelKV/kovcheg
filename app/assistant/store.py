from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

DEFAULT_STORE_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "assistant" / "knowledge_store.json"

_store_lock = threading.Lock()


class KnowledgeStore:
    """Простое JSON-хранилище чанков с эмбеддингами."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or DEFAULT_STORE_PATH
        self._data: dict[str, Any] = {"version": 1, "chunks": []}
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
                log.info("KnowledgeStore loaded: %s chunks", len(self._data.get("chunks", [])))
            except Exception as exc:
                log.warning("Failed to load store, starting fresh: %s", exc)
                self._data = {"version": 1, "chunks": []}
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._save()

    def _save(self) -> None:
        with _store_lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)

    def clear(self) -> None:
        self._data["chunks"] = []
        self._save()

    def add_chunk(self, text: str, source: str, embedding: list[float]) -> str:
        chunk_id = str(uuid.uuid4())
        self._data["chunks"].append(
            {
                "id": chunk_id,
                "text": text,
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "embedding": embedding,
            }
        )
        self._save()
        return chunk_id

    def get_chunks(self) -> list[dict[str, Any]]:
        return self._data.get("chunks", [])

    def is_empty(self) -> bool:
        return len(self._data.get("chunks", [])) == 0


def get_store(path: Path | None = None) -> KnowledgeStore:
    return KnowledgeStore(path)
