# Stable Telegram identifiers. Display names and usernames are intentionally
# not used: both can be changed or duplicated.
CLICKER_BLOCKED_TELEGRAM_IDS = frozenset()
LIMITED_STOCK_LOOTBOX_TELEGRAM_IDS = frozenset({
    7_735_808_918,  # Ибрагим
    837_611_803,    # Магомет
})


# Sections temporarily closed for individual players while their content is
# reworked. Keys match the client tab names in static/app.js.
MAINTENANCE_SECTIONS = ()
MAINTENANCE_TELEGRAM_IDS = frozenset()
MAINTENANCE_MESSAGE = "Ведутся технические работы"


def maintenance_sections(user) -> list[str]:
    """Sections this player must not see. Empty for everyone else."""
    if not user or user.telegram_id not in MAINTENANCE_TELEGRAM_IDS:
        return []
    return list(MAINTENANCE_SECTIONS)


def is_section_closed(user, section: str) -> bool:
    return section in maintenance_sections(user)


def can_use_clicker(user) -> bool:
    return bool(user and user.id and user.telegram_id not in CLICKER_BLOCKED_TELEGRAM_IDS)


def uses_limited_lootbox_stock(user) -> bool:
    return bool(user and user.telegram_id in LIMITED_STOCK_LOOTBOX_TELEGRAM_IDS)
