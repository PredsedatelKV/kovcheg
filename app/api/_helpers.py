from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models


def ensure_wallet(db: Session, user: models.User) -> models.Wallet:
    """Гарантирует наличие кошелька у пользователя (самовосстановление для старых
    записей). Возвращает кошелёк, который можно безопасно мутировать."""
    if user.wallet is None:
        wallet = models.Wallet(user_id=user.id, balance=0)
        db.add(wallet)
        db.flush()
        user.wallet = wallet
    return user.wallet


XP_MAX = 3000
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
    """Начисляет XP с лимитом 3000; излишек -> ковбаксы 10:1. Возвращает {'xp_added', 'coins'}."""
    if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0 or amount > MAX_XP_AWARD:
        raise HTTPException(status_code=503, detail="Награда опыта настроена некорректно")
    cur = max(0, min(int(user.xp or 0), XP_MAX))
    add = min(amount, max(0, XP_MAX - cur))
    user.xp = cur + add
    overflow = amount - add
    coins = overflow // 10
    if coins > 0:
        w = ensure_wallet(db, user)
        if w.balance < 0 or w.balance > MAX_GAME_BALANCE - coins:
            raise HTTPException(status_code=409, detail="Достигнут предел баланса")
        w.balance += coins
        db.add(models.Transaction(sender_id=None, recipient_id=user.id, amount=coins, note="xp_overflow"))
    return {"xp_added": add, "coins": coins}
