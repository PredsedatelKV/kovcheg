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
    channel_url: str = "https://t.me/telegram"  # placeholder, заменим
    database_url: str = ""
    skip_init_data_check: bool = False  # для локальной отладки

    @property
    def admin_id_list(self) -> list[int]:
        return [int(x) for x in self.admin_ids.split(",") if x.strip().isdigit()]

    @property
    def admin_username_list(self) -> list[str]:
        return [x.strip().lower().lstrip("@") for x in self.admin_usernames.split(",") if x.strip()]

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        data_dir = Path(os.environ.get("DATA_DIR", "/data"))
        if not data_dir.exists():
            data_dir = Path(__file__).resolve().parent.parent / "var"
            data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{data_dir}/kovcheg.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
