from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models

SNOWFLAKE_CODE = "snowflake"
ART = "/static/releases/winter-2026-r2/media/"
MAX_STACK = 2_000_000_000


def snowflake_balance(user: models.User) -> int:
    return next((row.quantity for row in user.inventory
                 if row.item is not None and row.item.code == SNOWFLAKE_CODE), 0)


def credit_snowflakes(db: Session, user: models.User, amount: int) -> int:
    item = db.query(models.Item).filter_by(code=SNOWFLAKE_CODE).one_or_none()
    if item is None:
        return 0
    row = db.query(models.InventoryItem).filter_by(user_id=user.id, item_id=item.id).one_or_none()
    if row is None:
        db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=amount))
        return amount
    if not 0 <= row.quantity <= MAX_STACK - amount:
        return 0
    row.quantity += amount
    return amount


def spend_snowflakes(db: Session, user: models.User, product: models.ShopProduct) -> None:
    row = (db.query(models.InventoryItem).join(models.Item)
           .filter(models.InventoryItem.user_id == user.id, models.Item.code == SNOWFLAKE_CODE)
           .one_or_none())
    if row is None or row.quantity < product.price:
        raise HTTPException(400, "Недостаточно снежинок")
    row.quantity -= product.price
    if row.quantity == 0:
        db.delete(row)
    db.add(models.SnowflakeSpend(user_id=user.id, item_id=product.item_id, amount=product.price))


def seed_winter_catalog(db: Session) -> None:
    from app.api._helpers import sync_lootbox_shop_product

    key = "2026-11-winter-catalog-v1"
    if db.execute(text("SELECT 1 FROM maintenance_migrations WHERE key=:key"), {"key":key}).first():
        return

    snowflake = db.query(models.Item).filter_by(code=SNOWFLAKE_CODE).one_or_none()
    if snowflake is None:
        snowflake = models.Item(code=SNOWFLAKE_CODE, name="Снежинки", category="Валюта",
                                icon=ART+"snowflake.png", image_url=ART+"snowflake.png",
                                rarity="Сезонная", can_gift=True, can_activate=False)
        if db.query(models.ItemCategory).filter_by(name="Валюта").first() is None:
            db.add(models.ItemCategory(name="Валюта", sort_order=90))
        db.add(snowflake)
        db.flush()

    old = db.query(models.LootboxPool).filter_by(code="seasonal").one_or_none()
    if old and old.item:
        old.item.name = old.name = "Легендарный ковбокс"
        old.item.rarity = old.rarity = "Легендарный"
        old.version += 1
        for prize in db.query(models.WheelPrize).filter_by(item_code=old.item.code, label="Сезонный ковбокс"):
            prize.label = old.name
        for reward in db.query(models.BattlePassReward).filter_by(item_code=old.item.code, label="Сезонный ковбокс"):
            reward.label = old.name

    archived = db.query(models.LootboxPool).filter_by(code="legendary", is_archived=True).one_or_none()
    if archived and archived.item and archived.name == "Легендарный ковбокс":
        archived.item.name = archived.name = "Архивный легендарный ковбокс"

    boxes = (
        ("winter-ice", "Ледяной ковбокс", "Ледяной", "ice.webp", 350, "kovbucks", 4, 3, 7, 55),
        ("winter-seasonal", "Сезонный ковбокс", "Сезонный", "seasonal.webp", 15, "snowflakes", 5, 2, 4, 25),
    )
    for code, name, rarity, file, price, currency, order, low, high, weight in boxes:
        if db.query(models.LootboxPool).filter_by(code=code).first():
            continue
        image = ART+file
        item = models.Item(code="lootbox_"+code, name=name, rarity=rarity,
                           icon=image, image_url=image, category="Ковбоксы",
                           can_gift=True, can_activate=False, lootbox_pool_code=code)
        pool = models.LootboxPool(code=code, name=name, item=item, rarity=rarity, image_url=image,
                                  open_image_url=image, is_active=True, is_droppable=True,
                                  opening_mode="chest_v2", allow_duplicates=False,
                                  sale_price=price, sale_currency=currency, sort_order=order, assembly_weight=0)
        pool.entries = [
            models.LootboxPoolEntry(reward_kind="item", item_id=snowflake.id, amount_min=low, amount_max=high, weight=weight),
            models.LootboxPoolEntry(reward_kind="xp", amount_min=18, amount_max=28, weight=100-weight),
        ]
        db.add(pool)
        db.flush()
        sync_lootbox_shop_product(db, pool)

    db.execute(text("INSERT INTO maintenance_migrations(key) VALUES (:key)"), {"key":key})
