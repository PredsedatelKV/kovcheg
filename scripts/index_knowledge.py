#!/usr/bin/env python3
"""Скрипт для индексации материалов Ковчега в JSON-хранилище агента.

Использование:
    python scripts/index_knowledge.py
    python scripts/index_knowledge.py --clear
    python scripts/index_knowledge.py --dir /path/to/docs
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PyPDF2 import PdfReader

from app.assistant.embedder import encode_texts
from app.assistant.store import KnowledgeStore, reload_store

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KNOWLEDGE_DIR = DATA_DIR / "knowledge"


def read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_pdf_file(path: Path) -> str:
    reader = PdfReader(str(path))
    texts = []
    for page in reader.pages:
        texts.append(page.extract_text() or "")
    return "\n".join(texts)


def split_into_chunks(text: str, max_length: int = 800, overlap: int = 100) -> list[str]:
    """Разбивает текст на перекрывающиеся чанки для лучшего поиска."""
    text = text.strip()
    if len(text) <= max_length:
        return [text] if text else []

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_length, len(text))
        if end < len(text):
            # Ищем ближайший разделитель для красивого разбиения.
            # Начинаем с end-1, т.к. text[end] — это уже следующий за границей
            # символ (а при end == len(text) это вообще выход за пределы строки).
            for split_point in range(end - 1, start + max_length // 2, -1):
                if text[split_point] in "\n\r ":
                    end = split_point
                    break
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        # Гарантируем прогресс: даже если end - overlap <= start (короткий чанк
        # с большим overlap), сдвигаемся минимум на 1 символ, иначе зациклимся.
        start = max(end - overlap, start + 1)
        if start >= len(text):
            break
    return chunks


def main() -> int:
    parser = argparse.ArgumentParser(description="Индексация материалов Ковчега")
    parser.add_argument("--clear", action="store_true", help="Очистить хранилище перед индексацией")
    parser.add_argument("--dir", type=Path, default=KNOWLEDGE_DIR, help="Папка с материалами")
    args = parser.parse_args()

    store = KnowledgeStore()
    if args.clear:
        print("Очистка хранилища...")
        store.clear()

    if not args.dir.exists():
        print(f"Папка не найдена: {args.dir}")
        print("Создай папку data/knowledge/ и положи туда .txt, .md или .pdf файлы.")
        return 1

    # Регистронезависимый подбор расширений (.TXT/.PDF/.MD тоже подхватываются).
    allowed_suffixes = {".txt", ".md", ".pdf"}
    files = [
        p for p in args.dir.iterdir()
        if p.is_file() and p.suffix.lower() in allowed_suffixes
    ]
    if not files:
        print(f"Нет файлов (.txt/.md/.pdf) в {args.dir}")
        return 1

    all_chunks: list[tuple[str, str]] = []
    for file in sorted(files):
        print(f"Чтение: {file.name}")
        try:
            if file.suffix.lower() == ".pdf":
                text = read_pdf_file(file)
            else:
                text = read_text_file(file)
        except Exception as exc:
            print(f"  Ошибка чтения: {exc}")
            continue

        if not text.strip():
            print(f"  Пропуск (пустой)")
            continue

        chunks = split_into_chunks(text)
        print(f"  Разбито на {len(chunks)} фрагментов")
        for ch in chunks:
            all_chunks.append((ch, file.name))

    if not all_chunks:
        print("Нет данных для индексации")
        return 1

    print(f"\nГенерация эмбеддингов для {len(all_chunks)} фрагментов...")
    texts = [ch[0] for ch in all_chunks]
    embeddings = encode_texts(texts)

    print("Сохранение в хранилище...")
    # Массовая запись: один _save() в конце вместо O(n²) записи файла.
    items = [
        (text, source, embeddings[i].tolist())
        for i, (text, source) in enumerate(all_chunks)
    ]
    store.add_chunks(items)

    # Инвалидируем кэшированный синглтон стора, чтобы запущенное приложение
    # увидело свежие чанки без перезапуска.
    reload_store()

    print(f"Готово! Всего фрагментов в хранилище: {len(store.get_chunks())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
