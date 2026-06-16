from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

DEFAULT_STORE_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "assistant" / "knowledge_store.json"

_store_lock = threading.Lock()

# Модульный синглтон стора + защита от гонок при первой инициализации.
_store_singleton: "KnowledgeStore | None" = None
_singleton_lock = threading.Lock()


class KnowledgeStore:
    """Простое JSON-хранилище чанков с эмбеддингами."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or DEFAULT_STORE_PATH
        self._data: dict[str, Any] = {"version": 1, "chunks": []}
        # Версия данных: увеличивается при любой мутации стора. Используется
        # потребителями (например search) для инвалидации кэшей.
        self.revision: int = 0
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
        self.revision += 1

    def _save(self) -> None:
        with _store_lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)

    def clear(self) -> None:
        self._data["chunks"] = []
        self.revision += 1
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
        self.revision += 1
        self._save()
        return chunk_id

    def add_chunks(self, items: list[tuple[str, str, list[float]]]) -> list[str]:
        """Массовое добавление чанков с одним вызовом _save() в конце.

        items: список (text, source, embedding). Избавляет от O(n²) записи
        файла при индексации, когда _save() вызывался бы на каждый чанк.
        """
        ids: list[str] = []
        now = datetime.now(timezone.utc).isoformat()
        for text, source, embedding in items:
            chunk_id = str(uuid.uuid4())
            self._data["chunks"].append(
                {
                    "id": chunk_id,
                    "text": text,
                    "source": source,
                    "created_at": now,
                    "embedding": embedding,
                }
            )
            ids.append(chunk_id)
        if ids:
            self.revision += 1
            self._save()
        return ids

    def get_chunks(self) -> list[dict[str, Any]]:
        return self._data.get("chunks", [])

    def is_empty(self) -> bool:
        return len(self._data.get("chunks", [])) == 0


def get_store(path: Path | None = None) -> KnowledgeStore:
    """Возвращает кэшированный синглтон стора.

    Раньше на каждый вызов конструировался новый KnowledgeStore и читался весь
    JSON-файл. Теперь стор кэшируется на уровне модуля. Для нестандартного пути
    (path задан явно) синглтон не используется — это специальный случай (тесты,
    альтернативное хранилище).
    """
    global _store_singleton
    if path is not None:
        return KnowledgeStore(path)
    if _store_singleton is None:
        with _singleton_lock:
            if _store_singleton is None:
                _store_singleton = KnowledgeStore()
    return _store_singleton


def reload_store() -> KnowledgeStore:
    """Сбрасывает кэшированный синглтон и перечитывает стор с диска.

    Вызывать после реиндексации, чтобы потребители увидели новые чанки.
    """
    global _store_singleton
    with _singleton_lock:
        _store_singleton = KnowledgeStore()
    return _store_singleton
