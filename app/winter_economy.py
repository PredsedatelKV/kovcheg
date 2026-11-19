from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models

SNOWFLAKE_CODE = "snowflake"
ART = "/static/releases/winter-2026-r2/media/"


def snowflake_balance(user: models.User) -> int:
    return next((row.quantity for row in user.inventory
                 if row.item is not None and row.item.code == SNOWFLAKE_CODE), 0)


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


def _seed_winter_catalog_v1(db: Session) -> None:
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


WINTER_SHOP_UPDATE_KEY = "2026-11-winter-shop-v2"


def update_winter_shop(db: Session) -> None:
    from app.api._helpers import sync_lootbox_shop_product

    if db.execute(text("SELECT 1 FROM maintenance_migrations WHERE key=:key"), {"key": WINTER_SHOP_UPDATE_KEY}).first():
        return

    for code, name, price in (
        ("winter-ice", "Ледяной ковбокс", 50),
        ("winter-seasonal", "Новогодний ковбокс", 100),
    ):
        pool = db.query(models.LootboxPool).filter_by(code=code).one_or_none()
        if pool is None or pool.item is None:
            raise RuntimeError(f"Winter shop pool is missing its item: {code}")
        if pool.item.name != name:
            previous_name = pool.item.name
            for model in (models.WheelPrize, models.BattlePassReward):
                for reward in db.query(model).filter_by(item_code=pool.item.code, label=previous_name):
                    reward.label = name
        pool.name = pool.item.name = name
        pool.sale_price = price
        pool.sale_currency = "snowflakes"
        sync_lootbox_shop_product(db, pool)

    db.execute(text("INSERT INTO maintenance_migrations(key) VALUES (:key)"), {"key": WINTER_SHOP_UPDATE_KEY})


def seed_winter_catalog(db: Session) -> None:
    _seed_winter_catalog_v1(db)
    db.flush()
    update_winter_shop(db)
    seed_tree_custom(db)

TREE_CUSTOM = (
    ("tree_garland_aurora", "tree_garland", "Гирлянда «Северное сияние»", 120),
    ("tree_toys_crystal", "tree_toys", "Ледяные игрушки", 150),
    ("tree_snow_soft", "tree_snow", "Пушистый снег", 80),
    ("tree_gifts_festive", "tree_gifts", "Подарки под ёлкой", 180),
)


def seed_tree_custom(db: Session) -> None:
    key = "2026-11-tree-custom-v1"
    if db.execute(text("SELECT 1 FROM maintenance_migrations WHERE key=:key"), {"key": key}).first():
        return
    category = db.query(models.ItemCategory).filter_by(name="Кастом").first()
    if category is None:
        db.add(models.ItemCategory(name="Кастом", sort_order=40))
    for item in db.query(models.Item).filter_by(category="Скины"):
        item.category = "Кастом"
    old = db.query(models.ItemCategory).filter_by(name="Скины").first()
    if old is not None:
        db.delete(old)
    for code, slot, name, price in TREE_CUSTOM:
        item = db.query(models.Item).filter_by(code=code).one_or_none()
        if item is None:
            art = "/static/releases/winter-2026-r9/media/" + slot + ".svg"
            item = models.Item(code=code, name=name, skin_slot=slot, category="Кастом",
                rarity="Редкий", icon=art, image_url=art, can_gift=True, can_activate=False)
            db.add(item)
            db.flush()
            db.add(models.ShopProduct(item_id=item.id, price=price, stock=-1, is_active=True))
        # Seasonal box entries are additive, leaving current prizes available.
        for pool in db.query(models.LootboxPool).filter(models.LootboxPool.code.in_(["winter-ice", "winter-seasonal"])):
            if not db.query(models.LootboxPoolEntry).filter_by(pool_id=pool.id, item_id=item.id).first():
                db.add(models.LootboxPoolEntry(pool_id=pool.id, reward_kind="item", item_id=item.id,
                    amount_min=1, amount_max=1, weight=5))
    db.execute(text("INSERT INTO maintenance_migrations(key) VALUES (:key)"), {"key": key})
