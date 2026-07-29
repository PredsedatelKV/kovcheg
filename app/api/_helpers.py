from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.access import MAINTENANCE_MESSAGE, is_section_closed
from app.auth import current_user


def require_open_section(section: str) -> Callable:
    """Router dependency closing a whole section for the players it is hidden from.

    The client also hides the tab, but the check has to live on the server: a
    hidden tab is not a closed API.
    """

    def guard(user: models.User = Depends(current_user)) -> None:
        if is_section_closed(user, section):
            raise HTTPException(status_code=503, detail=MAINTENANCE_MESSAGE)

    return guard


PRIZE_KIND_ICONS = {
    "coins": "/static/img/ui/kovbaks.png",
    "xp": "/static/img/ui/xp.png",
}


def prize_icon(kind: str, item: models.Item | None = None) -> str:
    """Icon a prize should show, derived from what it actually gives.

    The wheel used to render an icon URL typed into the admin form, and that
    field defaulted to the Kovbaks image, so every sector looked like coins.
    The already-loaded item is passed in so this never issues its own query.
    """
    if kind in PRIZE_KIND_ICONS:
        return PRIZE_KIND_ICONS[kind]
    if kind == "item" and item is not None:
        return item.icon
    return ""


def ensure_wallet(db: Session, user: models.User) -> models.Wallet:
    """Гарантирует наличие кошелька у пользователя (самовосстановление для старых
    записей). Возвращает кошелёк, который можно безопасно мутировать."""
    if user.wallet is None:
        wallet = models.Wallet(user_id=user.id, balance=0)
        db.add(wallet)
        db.flush()
        user.wallet = wallet
    return user.wallet


XP_PER_LEVEL = 100
MAX_PLAYER_LEVEL = 100
# XP is the progress inside the current level and therefore is always 0..99.
XP_MAX = XP_PER_LEVEL - 1
MAX_XP_AWARD = 1_000_000
MAX_GAME_BALANCE = 2_000_000_000
MAX_SHOP_PRICE = 1_000_000_000
MAX_MARKET_LISTING_QUANTITY = 1_000_000
MAX_INVENTORY_STACK = 2_000_000_000
ACTIVATABLE_ITEM_XP = {"exp_scroll": 50, "scroll_of_wisdom": 250}


def sync_lootbox_shop_product(
    db: Session,
    pool: models.LootboxPool,
) -> models.ShopProduct | None:
    """Keep the Kovbox editor's sale settings and the real shop in sync.

    The shop currently spends Kovbucks only.  Existing duplicate rows are left
    for auditability but disabled, while one canonical row remains managed by
    the lootbox configuration.
    """
    rows = (
        db.query(models.ShopProduct)
        .filter(models.ShopProduct.item_id == pool.item_id)
        .order_by(models.ShopProduct.id)
        .all()
    ) if pool.item_id else []
    configured = pool.sale_price is not None
    if configured and (
        pool.sale_currency != "kovbucks"
        or pool.sale_price < 1
        or pool.sale_price > MAX_SHOP_PRICE
    ):
        raise HTTPException(status_code=400, detail="Цена продажи ковбокса настроена некорректно")

    should_be_active = bool(
        configured
        and pool.is_active
        and not pool.is_archived
        and pool.item_id
    )
    primary = rows[0] if rows else None
    if primary is None and should_be_active:
        primary = models.ShopProduct(
            item_id=pool.item_id,
            price=pool.sale_price,
            is_active=True,
            stock=-1,
        )
        db.add(primary)
    elif primary is not None:
        if configured:
            primary.price = pool.sale_price
        primary.is_active = should_be_active
    for duplicate in rows[1:]:
        duplicate.is_active = False
    return primary


def return_market_listing_to_seller(
    db: Session,
    listing: models.MarketListing,
) -> models.InventoryItem:
    """Atomically mark an active listing inactive and restore its reserved item.

    The caller owns the surrounding write transaction and commits only after
    this function succeeds. Replays fail before changing inventory.
    """
    if not listing.is_active:
        raise HTTPException(status_code=400, detail="Объявление уже снято")
    if not (1 <= listing.quantity <= MAX_MARKET_LISTING_QUANTITY):
        raise HTTPException(status_code=503, detail="Объявление настроено некорректно")
    inventory = (
        db.query(models.InventoryItem)
        .filter(
            models.InventoryItem.user_id == listing.seller_id,
            models.InventoryItem.item_id == listing.item_id,
        )
        .one_or_none()
    )
    if inventory is None:
        inventory = models.InventoryItem(
            user_id=listing.seller_id,
            item_id=listing.item_id,
            quantity=listing.quantity,
        )
        db.add(inventory)
    else:
        if inventory.quantity < 0 or inventory.quantity > MAX_INVENTORY_STACK - listing.quantity:
            raise HTTPException(status_code=409, detail="Достигнут максимальный размер стака предмета")
        inventory.quantity += listing.quantity
    listing.is_active = False
    return inventory


def award_xp(db: Session, user: models.User, amount: int) -> dict[str, int]:
    """Award level progress and convert XP received at level 100 to Kovbucks."""
    if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0 or amount > MAX_XP_AWARD:
        raise HTTPException(status_code=503, detail="Награда опыта настроена некорректно")
    level = max(1, min(int(getattr(user, "level", 1) or 1), MAX_PLAYER_LEVEL))
    current_xp = max(0, min(int(user.xp or 0), XP_MAX))
    if level >= MAX_PLAYER_LEVEL:
        user.level = MAX_PLAYER_LEVEL
        user.xp = 0
        consumed = 0
        levels_gained = 0
    else:
        xp_until_cap = (MAX_PLAYER_LEVEL - level) * XP_PER_LEVEL - current_xp
        consumed = min(amount, max(0, xp_until_cap))
        accumulated = current_xp + consumed
        levels_gained = accumulated // XP_PER_LEVEL
        user.level = min(MAX_PLAYER_LEVEL, level + levels_gained)
        user.xp = 0 if user.level >= MAX_PLAYER_LEVEL else accumulated % XP_PER_LEVEL
    overflow = amount - consumed
    # After the Kovbucks denomination, the old 1 K conversion is displayed
    # and stored as 10 K while preserving the same purchasing power.
    coins = (overflow // 10) * 10
    if coins > 0:
        w = ensure_wallet(db, user)
        if w.balance < 0 or w.balance > MAX_GAME_BALANCE - coins:
            raise HTTPException(status_code=409, detail="Достигнут предел баланса")
        w.balance += coins
        db.add(models.Transaction(sender_id=None, recipient_id=user.id, amount=coins, note="xp_overflow"))
    return {"xp_added": consumed, "levels_gained": levels_gained, "coins": coins}
