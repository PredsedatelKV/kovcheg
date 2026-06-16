from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    telegram_bot_token: str = ""
    telegram_webhook_secret: str = "change-me"
    public_url: str = ""  # https://<app>.fly.dev — заполняется после деплоя
    admin_ids: str = ""  # CSV TG ID-шников
    admin_usernames: str = "omarbutuev"  # CSV TG usernames (без @)
    channel_url: str = "https://t.me/+2fe2Nsj0J9FiYzky"
    database_url: str = ""
    skip_init_data_check: bool = False  # для локальной отладки

    # --- LLM / Ассистент ---
    llm_provider: str = "openrouter"  # openrouter | gemini
    llm_api_key: str = ""  # ключ (OpenRouter или Gemini)
    llm_model: str = "google/gemini-2.0-flash"  # valid openrouter id (vendor-prefixed)
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_max_tokens: int = 800
    llm_temperature: float = 0.7
    assistant_max_chunks: int = 5  # сколько фрагментов подавать в контекст
    assistant_rate_limit_minutes: int = 0  # ограничение частоты вопросов (0 = без лимита)

    @property
    def admin_id_list(self) -> list[int]:
        return [int(x) for x in self.admin_ids.split(",") if x.strip().isdigit()]

    @property
    def admin_username_list(self) -> list[str]:
        return [x.strip().lower().lstrip("@") for x in self.admin_usernames.split(",") if x.strip()]

    def _data_dir(self) -> Path:
        """Resolve the sqlite data directory without any filesystem side-effects."""
        data_dir = Path(os.environ.get("DATA_DIR", "/data"))
        if not data_dir.exists():
            data_dir = Path(__file__).resolve().parent.parent / "var"
        return data_dir

    @property
    def resolved_database_url(self) -> str:
        """Pure getter — no filesystem side-effects (call ensure_db_dir() before engine creation)."""
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self._data_dir()}/kovcheg.db"

    def ensure_db_dir(self) -> None:
        """Idempotently create the local sqlite data directory if we're falling back to ./var."""
        if self.database_url:
            return
        self._data_dir().mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
