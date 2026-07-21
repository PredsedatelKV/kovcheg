# Stable Telegram identifiers. Display names and usernames are intentionally
# not used: both can be changed or duplicated.
CLICKER_BLOCKED_TELEGRAM_IDS = frozenset({837611803, 7735808918})
LIMITED_STOCK_LOOTBOX_TELEGRAM_IDS = CLICKER_BLOCKED_TELEGRAM_IDS


def can_use_clicker(user) -> bool:
    return bool(user and user.id and user.telegram_id not in CLICKER_BLOCKED_TELEGRAM_IDS)


def uses_limited_lootbox_stock(user) -> bool:
    return bool(user and user.telegram_id in LIMITED_STOCK_LOOTBOX_TELEGRAM_IDS)
