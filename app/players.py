"""Жёсткая привязка игроков по Telegram ID.

Единственный источник правды: роль и каноничное имя выдаются строго по
Telegram-ID, аватарка берётся из Telegram-профиля (photo_url в initData).
Эти трое — единственные граждане Федерации Ковчега.
"""

from __future__ import annotations

PLAYER_BINDINGS: dict[int, dict] = {
    849162365: {"first_name": "Омар", "username": "omarbutuev", "role": "Председатель", "is_admin": True},
    7735808918: {"first_name": "Ибрагим", "username": None, "role": "Гражданин", "is_admin": False},
    837611803: {"first_name": "Магомет", "username": None, "role": "Гражданин", "is_admin": False},
}


def binding_for(telegram_id: int) -> dict | None:
    return PLAYER_BINDINGS.get(int(telegram_id))


def is_bound_admin(telegram_id: int) -> bool:
    b = PLAYER_BINDINGS.get(int(telegram_id))
    return bool(b and b.get("is_admin"))
