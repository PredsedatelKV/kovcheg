from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models
from app.api._helpers import return_market_listing_to_seller, sync_lootbox_shop_product
from app.players import PLAYER_BINDINGS


def _get_or_create_item(
    db: Session,
    code: str,
    *,
    name: str,
    icon: str,
    description: str = "",
    rarity: str = "Обычный",
    category: str = "Ресурсы",
    can_gift: bool = True,
    can_activate: bool = False,
    lootbox_pool_code: str | None = None,
) -> models.Item:
    item = db.query(models.Item).filter(models.Item.code == code).one_or_none()
    if item:
        return item
    item = models.Item(
        code=code,
        name=name,
        icon=icon,
        description=description,
        rarity=rarity,
        category=category,
        can_gift=can_gift,
        can_activate=can_activate,
        lootbox_pool_code=lootbox_pool_code,
    )
    db.add(item)
    db.flush()
    return item


CATALOG_SNACKS = (
)

CATALOG_SWEETS = (
    ("milky_way", "Шоколадный батончик Milky Way", "milky_way.jpeg", 380, 3),
    ("orbit_white_mint", "Жевательная резинка Orbit White Нежная мята без сахара", "orbit_white_mint.jpeg", 380, 2),
    ("orion_fresh_pie_passionfruit", "Пирожное бисквитное с начинкой Маракуйя Orion Fresh Pie", "orion_fresh_pie_passionfruit.jpeg", 230, 7),
    ("mms_peanut", "Драже с арахисом и молочным шоколадом M&M’s", "mms_peanut.jpeg", 680, 2),
    ("babyfox_hippos", "Мармелад жевательный бегемоты Babyfox", "babyfox_hippos.jpeg", 530, 3),
    ("zerfer_marshmallow_duo", "Маршмэллоу Duo клубника-ваниль Zerfer", "zerfer_marshmallow_duo.jpeg", 900, 2),
)


def _ensure_item_category(db: Session, name: str, sort_order: int) -> models.ItemCategory:
    category = next(
        (row for row in db.query(models.ItemCategory).all() if row.name.casefold() == name.casefold()),
        None,
    )
    if category is None:
        category = models.ItemCategory(name=name, sort_order=sort_order)
        db.add(category)
        db.flush()
    return category


# Скины: код -> (слот, название, редкость). Персонаж рисуется на клиенте по
# коду предмета (static/pages/character.js), поэтому картинки-ассеты не нужны —
# в инвентаре показывается общая иконка слота.
SKIN_SLOT_ICONS = {
    "head": "/static/img/ui/skin_head.svg",
    "torso": "/static/img/ui/skin_torso.svg",
    "legs": "/static/img/ui/skin_legs.svg",
    "feet": "/static/img/ui/skin_feet.svg",
}

SKIN_DEFINITIONS = (
    ("skin_head_hair", "head", "Причёска", "Обычный"),
    ("skin_head_ushanka", "head", "Ушанка", "Редкий"),
    ("skin_head_iron_helm", "head", "Железный шлем", "Эпический"),
    ("skin_head_crown", "head", "Корона Ковчега", "Легендарный"),
    ("skin_torso_tshirt", "torso", "Футболка", "Обычный"),
    ("skin_torso_telnyashka", "torso", "Тельняшка", "Редкий"),
    ("skin_torso_chainmail", "torso", "Кольчуга", "Эпический"),
    ("skin_torso_mantle", "torso", "Мантия председателя", "Легендарный"),
    ("skin_legs_jeans", "legs", "Джинсы", "Обычный"),
    ("skin_legs_vatniki", "legs", "Ватники", "Редкий"),
    ("skin_legs_plates", "legs", "Латы", "Эпический"),
    ("skin_legs_parade", "legs", "Парадные брюки", "Легендарный"),
    ("skin_feet_sneakers", "feet", "Кроссовки", "Обычный"),
    ("skin_feet_sapogi", "feet", "Сапоги", "Редкий"),
    ("skin_feet_bercy", "feet", "Берцы", "Эпический"),
    ("skin_feet_golden", "feet", "Золотые сапоги", "Легендарный"),
)


def _seed_skins(db: Session) -> None:
    """Скины как обычные предметы категории «Скины».

    Слот проставляется и существующим строкам: колонка skin_slot добавляется
    миграцией уже после того, как предметы могли быть созданы.
    """
    _ensure_item_category(db, "Скины", 40)
    for code, slot, name, rarity in SKIN_DEFINITIONS:
        item = _get_or_create_item(
            db, code,
            name=name,
            icon=SKIN_SLOT_ICONS[slot],
            category="Скины",
            rarity=rarity,
            can_gift=True,
        )
        if item.skin_slot != slot:
            item.skin_slot = slot


def _seed_catalog_snacks(db: Session, fragment: models.Item) -> None:
    """Add the pre-launch snack catalogue once, without refilling sold stock."""
    snack_category = _ensure_item_category(db, "Снеки", 20)
    sweets_category = _ensure_item_category(db, "Сладости", 30)
    fragment_category = _ensure_item_category(db, "Фрагменты", 10)
    if fragment.category != fragment_category.name:
        fragment.category = fragment_category.name

    for code, name, filename, price, stock in (*CATALOG_SNACKS, *CATALOG_SWEETS):
        category = snack_category if code.startswith("solonina_") else sweets_category
        image_url = f"/static/img/items/catalog/{filename}"
        item = db.query(models.Item).filter(models.Item.code == code).one_or_none()
        if item is None:
            # Two items may have been created manually before this catalogue.
            # Match by public name to preserve their IDs and player inventory.
            item = db.query(models.Item).filter(models.Item.name == name).one_or_none()
        changed = item is None
        if item is None:
            item = models.Item(
                code=code,
                name=name,
                description="",
                icon=image_url,
                image_url=image_url,
                rarity="Обычный",
                category=category.name,
                can_gift=True,
                can_activate=True,
                lootbox_reward_tier="special",
            )
            db.add(item)
            db.flush()
        else:
            changed = any((
                item.name != name,
                item.icon != image_url,
                item.image_url != image_url,
                item.category != category.name,
            ))
            item.name = name
            item.icon = image_url
            item.image_url = image_url
            item.category = category.name
            item.description = ""
            item.can_activate = True

        products = db.query(models.ShopProduct).filter(models.ShopProduct.item_id == item.id).order_by(models.ShopProduct.id).all()
        product = products[0] if products else None
        if product is None:
            db.add(models.ShopProduct(item_id=item.id, price=price, stock=stock, is_active=True))
        elif changed:
            # Apply the requested initial stock once; later starts preserve
            # purchases and administrator changes.
            product.price = price
            product.stock = stock
            product.is_active = True
        for duplicate in products[1:]:
            duplicate.is_active = False


# Icons for existing rows are migrated to file paths on every startup so a
# user can drop new SVG/PNG files into static/img/* without touching the DB.
ITEM_ICON_BY_CODE: dict[str, str] = {
    "lootbox_common": "/static/img/items/lootbox_common.png",
    "lootbox_rare": "/static/img/items/lootbox_rare.png",
    "lootbox_epic": "/static/img/items/lootbox_epic.png",
    "lootbox_legendary": "/static/img/items/lootbox_legendary.png",
    "lootbox_seasonal": "/static/img/items/lootbox_seasonal.png",
    "lootbox_mega": "/static/img/items/lootbox_mega.png",
    "lootbox_consolation": "/static/img/items/lootbox_consolation.png",
    "box_fragment": "/static/img/items/box_fragment.svg",
    "failure_fragment": "/static/img/items/failure_fragment.png",
}

TASK_ICON_BY_NAME: dict[str, str] = {
    "Добыча ресурсов": "/static/img/tasks/mining.svg",
    "Помощь жителям": "/static/img/tasks/helping.svg",
    "Защита поселения": "/static/img/tasks/defense.svg",
    "Посади 10 деревьев": "/static/img/tasks/trees.svg",
    "Добыть 50 камня": "/static/img/tasks/stone.svg",
    "Ежедневный план": "/static/img/tasks/scroll.svg",
}


def migrate_icons(db: Session) -> None:
    """Force icons to current paths on each boot so existing rows pick up new assets."""
    for code, path in ITEM_ICON_BY_CODE.items():
        item = db.query(models.Item).filter(models.Item.code == code).one_or_none()
        if item is not None:
            if item.icon != path:
                item.icon = path
            # Keep bundled lootbox images in sync with their current assets,
            # while preserving a custom image uploaded through the editor.
            if code.startswith("lootbox_") and (
                not item.image_url
                or str(item.image_url).startswith("/static/img/items/lootbox_")
            ):
                item.image_url = path
    for name, path in TASK_ICON_BY_NAME.items():
        task = db.query(models.Task).filter(models.Task.name == name).one_or_none()
        if task is not None and task.icon != path:
            task.icon = path
    for item in db.query(models.Item).all():
        item.description = ""
    existing_categories = {
        category.name.casefold(): category
        for category in db.query(models.ItemCategory).all()
    }
    used_names = sorted({item.category.strip() for item in db.query(models.Item).all() if item.category.strip()})
    for order, name in enumerate(used_names):
        if name.casefold() not in existing_categories:
            db.add(models.ItemCategory(name=name, sort_order=order))
    for pool in db.query(models.LootboxPool).all():
        sync_lootbox_shop_product(db, pool)
    for reward in db.query(models.BattlePassReward).all():
        if reward.kind == "xp":
            reward.icon = "/static/img/ui/xp.png"
        elif reward.kind == "kovbucks" or reward.kind.startswith("coins"):
            reward.icon = "/static/img/ui/kovbaks.png"


def migrate_schema(db: Session) -> None:
    """Lightweight in-place migrations for SQLite (add columns to existing tables)."""
    from sqlalchemy import text  # local import to keep startup cheap

    # Successful critical mutations persist their small HTTP response so a
    # client that lost the first response can safely retry without executing
    # the value-moving endpoint again.
    idempotency_cols = {
        row[1] for row in db.execute(text("PRAGMA table_info(idempotency_receipts)")).fetchall()
    }
    if idempotency_cols:
        idempotency_response_columns = [
            ("response_status", "INTEGER"),
            ("response_body", "BLOB"),
            ("response_content_type", "VARCHAR(256)"),
        ]
        added = False
        for column, ddl in idempotency_response_columns:
            if column not in idempotency_cols:
                db.execute(text(f"ALTER TABLE idempotency_receipts ADD COLUMN {column} {ddl}"))
                added = True
        if added:
            db.commit()

    # items.image_url — добавлено в PR #5 (фото товаров в админке)
    cols = {row[1] for row in db.execute(text("PRAGMA table_info(items)")).fetchall()}
    if "image_url" not in cols:
        db.execute(text("ALTER TABLE items ADD COLUMN image_url VARCHAR(512)"))
        db.commit()

    task_cols = {row[1] for row in db.execute(text("PRAGMA table_info(tasks)")).fetchall()}
    if task_cols:
        if "reward_item_id" not in task_cols:
            db.execute(text("ALTER TABLE tasks ADD COLUMN reward_item_id INTEGER REFERENCES items(id)"))
        if "reward_item_quantity" not in task_cols:
            db.execute(text("ALTER TABLE tasks ADD COLUMN reward_item_quantity INTEGER NOT NULL DEFAULT 0"))
        db.commit()

    # market_listings.target_user_id — добавлено в PR #6 (адресные объявления при продаже из инвентаря)
    mcols = {row[1] for row in db.execute(text("PRAGMA table_info(market_listings)")).fetchall()}
    if "target_user_id" not in mcols:
        db.execute(text("ALTER TABLE market_listings ADD COLUMN target_user_id INTEGER REFERENCES users(id)"))
        db.commit()

    # shop_products.stock — складские остатки в магазине (-1 = безлимит)
    scols = {row[1] for row in db.execute(text("PRAGMA table_info(shop_products)")).fetchall()}
    if "stock" not in scols:
        db.execute(text("ALTER TABLE shop_products ADD COLUMN stock INTEGER NOT NULL DEFAULT -1"))
        db.commit()

    # users.last_seen — дата/время последнего запроса (online-индикатор)
    ucols = {row[1] for row in db.execute(text("PRAGMA table_info(users)")).fetchall()}
    if "last_seen" not in ucols:
        db.execute(text("ALTER TABLE users ADD COLUMN last_seen DATETIME"))
        db.commit()

    # users.xp — опыт игрока (battle pass)
    ucols = {row[1] for row in db.execute(text("PRAGMA table_info(users)")).fetchall()}
    if "xp" not in ucols:
        db.execute(text("ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0"))
        db.commit()
    if "level" not in ucols:
        # Legacy XP was cumulative. Preserve progress while moving to the
        # explicit level + 0..99 XP representation.
        db.execute(text("ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1"))
        db.execute(text("""
            UPDATE users
            SET level = MIN(100, MAX(1, CAST(xp / 100 AS INTEGER) + 1)),
                xp = CASE
                    WHEN CAST(xp / 100 AS INTEGER) + 1 >= 100 THEN 0
                    ELSE MAX(0, xp % 100)
                END
        """))
        db.commit()
    if "casino_locked_until" not in ucols:
        db.execute(text("ALTER TABLE users ADD COLUMN casino_locked_until DATETIME"))
        db.commit()

    casino_cols = {row[1] for row in db.execute(text("PRAGMA table_info(casino_rounds)")).fetchall()}
    if casino_cols and "balance_before" not in casino_cols:
        db.execute(text("ALTER TABLE casino_rounds ADD COLUMN balance_before INTEGER NOT NULL DEFAULT 0"))
        db.commit()

    # tasks.xp_reward — XP за выполнение задания
    tcols = {row[1] for row in db.execute(text("PRAGMA table_info(tasks)")).fetchall()}
    if "xp_reward" not in tcols:
        db.execute(text("ALTER TABLE tasks ADD COLUMN xp_reward INTEGER NOT NULL DEFAULT 0"))
        db.commit()

    # items.lootbox_pool_code — если предмет является лутбоксом, указывает на пул
    icols = {row[1] for row in db.execute(text("PRAGMA table_info(items)")).fetchall()}
    if "lootbox_pool_code" not in icols:
        db.execute(text("ALTER TABLE items ADD COLUMN lootbox_pool_code VARCHAR(64)"))
        db.commit()
    reward_tier_added = "lootbox_reward_tier" not in icols
    if reward_tier_added:
        db.execute(text(
            "ALTER TABLE items ADD COLUMN lootbox_reward_tier "
            "VARCHAR(24) NOT NULL DEFAULT 'normal'"
        ))
        # Existing sweets and snacks become the initial special pool. The
        # administrator can move any item between pools afterwards.
        db.execute(text(
            "UPDATE items SET lootbox_reward_tier = 'special' "
            "WHERE category IN ('Сладости', 'Снеки', 'Арахис')"
        ))
        db.commit()
    db.execute(text(
        "UPDATE items SET lootbox_reward_tier = 'normal' "
        "WHERE lootbox_reward_tier IS NULL "
        "OR lootbox_reward_tier NOT IN ('normal', 'special', 'super_special')"
    ))
    db.commit()

    # Tests use fixed percentage grades and independent multi-reward sets.
    qcols = {row[1] for row in db.execute(text("PRAGMA table_info(quizzes)")).fetchall()}
    if qcols:
        quiz_columns = [
            ("time_limit_seconds", "INTEGER NOT NULL DEFAULT 0"),
            ("rewards_bad", "TEXT NOT NULL DEFAULT '[]'"),
            ("rewards_good", "TEXT NOT NULL DEFAULT '[]'"),
            ("rewards_excellent", "TEXT NOT NULL DEFAULT '[]'"),
        ]
        quiz_columns_added = False
        for col, ddl in quiz_columns:
            if col not in qcols:
                db.execute(text(f"ALTER TABLE quizzes ADD COLUMN {col} {ddl}"))
                quiz_columns_added = True
        if quiz_columns_added:
            # Preserve the configured legacy prize for both passing grades,
            # without retaining the old hidden automatic XP bonus.
            legacy_quizzes = db.query(models.Quiz).all()
            for quiz in legacy_quizzes:
                rewards = []
                if quiz.prize_value > 0:
                    if quiz.prize_kind == "coins":
                        rewards.append({"kind": "kovbucks", "amount": quiz.prize_value})
                    elif quiz.prize_kind == "item" and quiz.prize_item_code:
                        item = db.query(models.Item).filter(models.Item.code == quiz.prize_item_code).one_or_none()
                        if item:
                            rewards.append({"kind": "item", "amount": quiz.prize_value, "item_id": item.id})
                quiz.rewards_bad = "[]"
                quiz.rewards_good = json.dumps(rewards, ensure_ascii=False)
                quiz.rewards_excellent = json.dumps(rewards, ensure_ascii=False)
            db.commit()

    # One-time pre-launch catalogue cleanup requested before release.
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS maintenance_migrations (
            key VARCHAR(128) PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """))
    denomination_key = "2026-07-29-kovbucks-denomination-x10"
    denomination_done = db.execute(
        text("SELECT 1 FROM maintenance_migrations WHERE key = :key"),
        {"key": denomination_key},
    ).first()
    if denomination_done is None:
        # One atomic denomination: stored Kovbucks, their prices and historical
        # monetary facts all move together, preserving every player's buying
        # power and keeping audit reports comparable. XP, Kovcoins, quantities,
        # stock and probability weights are intentionally untouched.
        monetary_updates = (
            ("wallets", ("balance",), "UPDATE wallets SET balance = balance * 10"),
            ("transactions", ("amount",), "UPDATE transactions SET amount = amount * 10"),
            ("tasks", ("reward",), "UPDATE tasks SET reward = reward * 10"),
            ("shop_products", ("price",), "UPDATE shop_products SET price = price * 10"),
            ("market_listings", ("price",), "UPDATE market_listings SET price = price * 10"),
            ("pending_login_gifts", ("kovbucks",), "UPDATE pending_login_gifts SET kovbucks = kovbucks * 10"),
            ("wheel_prizes", ("value", "kind"), "UPDATE wheel_prizes SET value = value * 10 WHERE kind = 'coins'"),
            ("wheel_spins", ("prize_value", "prize_kind"), "UPDATE wheel_spins SET prize_value = prize_value * 10 WHERE prize_kind = 'coins'"),
            ("quizzes", ("prize_value", "prize_kind"), "UPDATE quizzes SET prize_value = prize_value * 10 WHERE prize_kind = 'coins'"),
            ("battlepass_rewards", ("value", "kind"), "UPDATE battlepass_rewards SET value = value * 10 WHERE kind = 'coins' OR kind LIKE 'coins_%'"),
            ("battlepass_seasons", ("price_current", "price_old"), "UPDATE battlepass_seasons SET price_current = price_current * 10, price_old = price_old * 10"),
            ("lootbox_pools", ("sale_price",), "UPDATE lootbox_pools SET sale_price = sale_price * 10 WHERE sale_price IS NOT NULL"),
            ("lootbox_pool_entries", ("amount_min", "amount_max", "reward_kind"), "UPDATE lootbox_pool_entries SET amount_min = amount_min * 10, amount_max = amount_max * 10 WHERE reward_kind = 'kovbucks'"),
            ("lootbox_open_rewards", ("amount", "reward_kind"), "UPDATE lootbox_open_rewards SET amount = amount * 10 WHERE reward_kind = 'kovbucks'"),
            ("casino_rounds", ("bet", "payout", "balance_before"), "UPDATE casino_rounds SET bet = bet * 10, payout = payout * 10, balance_before = balance_before * 10"),
        )
        for table_name, required_columns, statement in monetary_updates:
            columns = {
                row[1] for row in db.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            }
            if all(column in columns for column in required_columns):
                db.execute(text(statement))
        quiz_reward_columns = {
            row[1] for row in db.execute(text("PRAGMA table_info(quizzes)")).fetchall()
        }
        for quiz in db.query(models.Quiz).all() if {
            "rewards_bad", "rewards_good", "rewards_excellent"
        } <= quiz_reward_columns else []:
            for attr in ("rewards_bad", "rewards_good", "rewards_excellent"):
                try:
                    rewards = json.loads(getattr(quiz, attr) or "[]")
                except (TypeError, json.JSONDecodeError):
                    rewards = []
                if not isinstance(rewards, list):
                    rewards = []
                for reward in rewards:
                    if isinstance(reward, dict) and reward.get("kind") == "kovbucks":
                        amount = reward.get("amount")
                        if type(amount) is int and amount >= 0:
                            reward["amount"] = amount * 10
                setattr(quiz, attr, json.dumps(rewards, ensure_ascii=False))
        db.execute(
            text("INSERT INTO maintenance_migrations(key) VALUES (:key)"),
            {"key": denomination_key},
        )
        db.commit()
    cleanup_key = "2026-07-26-prelaunch-market-and-peanuts"
    cleanup_done = db.execute(
        text("SELECT 1 FROM maintenance_migrations WHERE key = :key"),
        {"key": cleanup_key},
    ).first()
    if cleanup_done is None:
        for listing in db.query(models.MarketListing).filter(models.MarketListing.is_active.is_(True)).all():
            return_market_listing_to_seller(db, listing)

        retired_codes = (
            "solonina_flavour_mix",
            "solonina_crayfish_dill",
            "solonina_sourcream_onion",
            "solonina_cheese",
        )
        retired = db.query(models.Item).filter(models.Item.code.in_(retired_codes)).all()
        retired_ids = [item.id for item in retired]
        if retired_ids:
            db.query(models.LootboxOpenReward).filter(
                models.LootboxOpenReward.item_id.in_(retired_ids)
            ).update({models.LootboxOpenReward.item_id: None}, synchronize_session=False)
            db.query(models.LootboxPoolEntry).filter(
                models.LootboxPoolEntry.item_id.in_(retired_ids)
            ).delete(synchronize_session=False)
            db.query(models.ShopProduct).filter(
                models.ShopProduct.item_id.in_(retired_ids)
            ).delete(synchronize_session=False)
            db.query(models.MarketListing).filter(
                models.MarketListing.item_id.in_(retired_ids)
            ).delete(synchronize_session=False)
            db.query(models.InventoryItem).filter(
                models.InventoryItem.item_id.in_(retired_ids)
            ).delete(synchronize_session=False)
            for gift in db.query(models.PendingLoginGift).filter(
                models.PendingLoginGift.item_id.in_(retired_ids)
            ).all():
                if gift.kovbucks == 0 and gift.xp == 0:
                    db.delete(gift)
                else:
                    gift.item_id = None
                    gift.item_quantity = 0
            for task in db.query(models.Task).filter(models.Task.reward_item_id.in_(retired_ids)).all():
                task.reward_item_id = None
                task.reward_item_quantity = 0
            for prize in db.query(models.WheelPrize).filter(models.WheelPrize.item_code.in_(retired_codes)).all():
                prize.kind = "nothing"
                prize.item_code = None
                prize.value = 0
            for quiz in db.query(models.Quiz).all():
                for attr in ("rewards_bad", "rewards_good", "rewards_excellent"):
                    try:
                        rewards = json.loads(getattr(quiz, attr) or "[]")
                    except (TypeError, json.JSONDecodeError):
                        rewards = []
                    filtered = [reward for reward in rewards if reward.get("item_id") not in retired_ids]
                    setattr(quiz, attr, json.dumps(filtered, ensure_ascii=False))
                if quiz.prize_item_code in retired_codes:
                    quiz.prize_item_code = None
                    quiz.prize_kind = "coins"
                    quiz.prize_value = 0
                    quiz.prize_label = ""
            for item in retired:
                db.delete(item)
        db.execute(
            text("INSERT INTO maintenance_migrations(key) VALUES (:key)"),
            {"key": cleanup_key},
        )
        db.commit()

    # Expand legacy prize-only pools into complete, server-owned Kovbox
    # configurations.  SQLite does not alter existing tables during
    # ``create_all``, so columns are added explicitly and old item entries are
    # rebuilt once to allow currency/XP rewards where item_id is nullable.
    item_pool_chances_added = False
    lpcols = {row[1] for row in db.execute(text("PRAGMA table_info(lootbox_pools)")).fetchall()}
    if lpcols:
        item_pool_chances_added = "special_item_chance" not in lpcols
        lootbox_pool_columns = [
            ("description", "TEXT NOT NULL DEFAULT ''"),
            ("rarity", "VARCHAR(32) NOT NULL DEFAULT 'Обычный'"),
            ("image_url", "VARCHAR(512) NOT NULL DEFAULT '/static/img/items/lootbox_common.png'"),
            ("open_image_url", "VARCHAR(512) NOT NULL DEFAULT ''"),
            ("opening_mode", "VARCHAR(16) NOT NULL DEFAULT 'legacy_v1'"),
            ("bonus_item_chance", "INTEGER NOT NULL DEFAULT 0"),
            ("special_item_chance", "INTEGER NOT NULL DEFAULT 0"),
            ("super_special_item_chance", "INTEGER NOT NULL DEFAULT 0"),
            ("item_id", "INTEGER REFERENCES items(id)"),
            ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
            ("is_droppable", "BOOLEAN NOT NULL DEFAULT 1"),
            ("is_archived", "BOOLEAN NOT NULL DEFAULT 0"),
            ("assembly_weight", "INTEGER NOT NULL DEFAULT 10"),
            ("sale_price", "INTEGER"),
            ("sale_currency", "VARCHAR(16) NOT NULL DEFAULT 'kovbucks'"),
            ("min_user_level", "INTEGER"),
            ("max_user_level", "INTEGER"),
            ("sort_order", "INTEGER NOT NULL DEFAULT 0"),
            ("starts_at", "DATETIME"),
            ("ends_at", "DATETIME"),
            ("daily_open_limit", "INTEGER NOT NULL DEFAULT 0"),
            ("guaranteed_slots", "INTEGER NOT NULL DEFAULT 1"),
            ("allow_duplicates", "BOOLEAN NOT NULL DEFAULT 1"),
            ("version", "INTEGER NOT NULL DEFAULT 1"),
            ("updated_at", "DATETIME"),
        ]
        added = False
        for col, ddl in lootbox_pool_columns:
            if col not in lpcols:
                db.execute(text(f"ALTER TABLE lootbox_pools ADD COLUMN {col} {ddl}"))
                added = True
        if added:
            db.execute(text("UPDATE lootbox_pools SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL"))
            db.commit()
        if item_pool_chances_added:
            # Preserve the previous effective item-drop chance, but route it
            # through the new special pool where sweets and snacks live.
            db.execute(text(
                "UPDATE lootbox_pools "
                "SET special_item_chance = bonus_item_chance, bonus_item_chance = 0 "
                "WHERE opening_mode = 'chest_v2'"
            ))
            db.commit()
        db.execute(text(
            "UPDATE lootbox_pools SET open_image_url = image_url "
            "WHERE open_image_url IS NULL OR open_image_url = ''"
        ))
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lootbox_pools_item_id "
            "ON lootbox_pools(item_id) WHERE item_id IS NOT NULL"
        ))
        db.commit()

    lecols = {row[1] for row in db.execute(text("PRAGMA table_info(lootbox_pool_entries)")).fetchall()}
    if lecols and "reward_kind" not in lecols:
        db.execute(text("""
            CREATE TABLE lootbox_pool_entries_new (
                id INTEGER NOT NULL PRIMARY KEY,
                pool_id INTEGER NOT NULL REFERENCES lootbox_pools(id),
                reward_kind VARCHAR(16) NOT NULL DEFAULT 'item',
                item_id INTEGER REFERENCES items(id),
                amount_min INTEGER NOT NULL DEFAULT 1 CHECK (amount_min > 0),
                amount_max INTEGER NOT NULL DEFAULT 1 CHECK (amount_max >= amount_min),
                weight INTEGER NOT NULL DEFAULT 10 CHECK (weight > 0),
                is_guaranteed BOOLEAN NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
        """))
        db.execute(text("""
            INSERT INTO lootbox_pool_entries_new
                (id, pool_id, reward_kind, item_id, amount_min, amount_max, weight,
                 is_guaranteed, is_active, sort_order)
            SELECT id, pool_id, 'item', item_id, 1, 1,
                   CASE WHEN weight > 0 THEN weight ELSE 1 END, 0, 1, id
            FROM lootbox_pool_entries
        """))
        db.execute(text("DROP TABLE lootbox_pool_entries"))
        db.execute(text("ALTER TABLE lootbox_pool_entries_new RENAME TO lootbox_pool_entries"))
        db.commit()
    if lecols:
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_lootbox_pool_entries_pool_id ON lootbox_pool_entries(pool_id)"
        ))
        if item_pool_chances_added:
            # Legacy per-item rows are no longer used by chest_v2. Guaranteed
            # fragments/XP/Kovbucks remain untouched.
            db.execute(text(
                "DELETE FROM lootbox_pool_entries "
                "WHERE is_guaranteed = 0 AND pool_id IN "
                "(SELECT id FROM lootbox_pools WHERE opening_mode = 'chest_v2')"
            ))
        db.commit()

    # Preserve the exact reveal order and visuals selected by the server.  Old
    # openings are backfilled deterministically without changing their value.
    locols = {row[1] for row in db.execute(text("PRAGMA table_info(lootbox_opens)")).fetchall()}
    if locols:
        opening_columns = [
            ("pool_code_snapshot", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("pool_name_snapshot", "VARCHAR(128) NOT NULL DEFAULT ''"),
            ("pool_rarity_snapshot", "VARCHAR(32) NOT NULL DEFAULT ''"),
            ("pool_image_snapshot", "VARCHAR(512) NOT NULL DEFAULT ''"),
            ("pool_open_image_snapshot", "VARCHAR(512) NOT NULL DEFAULT ''"),
            ("choice_plan", "TEXT NOT NULL DEFAULT '[]'"),
            ("choice_selection", "TEXT NOT NULL DEFAULT '[]'"),
            ("finalized_at", "DATETIME"),
        ]
        for col, ddl in opening_columns:
            if col not in locols:
                db.execute(text(f"ALTER TABLE lootbox_opens ADD COLUMN {col} {ddl}"))
        db.execute(text("""
            UPDATE lootbox_opens
            SET pool_code_snapshot = COALESCE(NULLIF(pool_code_snapshot, ''),
                    (SELECT code FROM lootbox_pools WHERE id = lootbox_opens.pool_id), ''),
                pool_name_snapshot = COALESCE(NULLIF(pool_name_snapshot, ''),
                    (SELECT name FROM lootbox_pools WHERE id = lootbox_opens.pool_id), ''),
                pool_rarity_snapshot = COALESCE(NULLIF(pool_rarity_snapshot, ''),
                    (SELECT rarity FROM lootbox_pools WHERE id = lootbox_opens.pool_id), 'Обычный'),
                pool_image_snapshot = COALESCE(NULLIF(pool_image_snapshot, ''),
                    (SELECT image_url FROM lootbox_pools WHERE id = lootbox_opens.pool_id), ''),
                pool_open_image_snapshot = COALESCE(NULLIF(pool_open_image_snapshot, ''),
                    (SELECT open_image_url FROM lootbox_pools WHERE id = lootbox_opens.pool_id),
                    (SELECT image_url FROM lootbox_pools WHERE id = lootbox_opens.pool_id), '')
        """))
        db.execute(text("""
            UPDATE lootbox_opens
            SET choice_plan = COALESCE(choice_plan, '[]'),
                choice_selection = COALESCE(choice_selection, '[]'),
                finalized_at = COALESCE(finalized_at, created_at)
            WHERE COALESCE(choice_plan, '[]') = '[]'
        """))
        db.commit()

    lorcols = {row[1] for row in db.execute(text("PRAGMA table_info(lootbox_open_rewards)")).fetchall()}
    if lorcols:
        reward_columns = [
            ("reveal_order", "INTEGER NOT NULL DEFAULT 0"),
            ("presentation_kind", "VARCHAR(16) NOT NULL DEFAULT ''"),
            ("label_snapshot", "VARCHAR(256) NOT NULL DEFAULT ''"),
            ("icon_snapshot", "VARCHAR(512) NOT NULL DEFAULT ''"),
            ("rarity_snapshot", "VARCHAR(32) NOT NULL DEFAULT ''"),
        ]
        reveal_order_added = "reveal_order" not in lorcols
        for col, ddl in reward_columns:
            if col not in lorcols:
                db.execute(text(f"ALTER TABLE lootbox_open_rewards ADD COLUMN {col} {ddl}"))
        invalid_order = db.execute(text("""
            SELECT 1
            FROM lootbox_open_rewards
            GROUP BY opening_id
            HAVING MIN(reveal_order) != 0
                OR MAX(reveal_order) != COUNT(*) - 1
                OR COUNT(DISTINCT reveal_order) != COUNT(*)
            LIMIT 1
        """)).first()
        if reveal_order_added or invalid_order:
            db.execute(text("""
                UPDATE lootbox_open_rewards AS reward
                SET reveal_order = (
                    SELECT COUNT(*) - 1
                    FROM lootbox_open_rewards AS earlier
                    WHERE earlier.opening_id = reward.opening_id AND earlier.id <= reward.id
                )
            """))
        db.execute(text("""
            UPDATE lootbox_open_rewards
            SET presentation_kind = CASE
                    WHEN reward_kind = 'item' AND item_id = (SELECT id FROM items WHERE code = 'box_fragment') THEN 'fragment'
                    WHEN reward_kind = 'item' THEN 'item'
                    ELSE reward_kind
                END
            WHERE presentation_kind IS NULL OR presentation_kind = ''
        """))
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lootbox_open_reward_order "
            "ON lootbox_open_rewards(opening_id, reveal_order)"
        ))
        db.commit()

    # game_sessions.state — JSON-состояние для шашек/пинг-понга
    gcols = {row[1] for row in db.execute(text("PRAGMA table_info(game_sessions)")).fetchall()}
    if gcols and "state" not in gcols:
        db.execute(text("ALTER TABLE game_sessions ADD COLUMN state TEXT"))
        db.commit()

    # clicker_states — новые поля: прогресс/ранги, бусты и анти-фрод (доработка кликера)
    cc = {row[1] for row in db.execute(text("PRAGMA table_info(clicker_states)")).fetchall()}
    if cc:
        clicker_new_cols = [
            ("kovcoins", "INTEGER NOT NULL DEFAULT 1"),
            ("earned_today", "INTEGER NOT NULL DEFAULT 0"),
            ("total_earned", "INTEGER NOT NULL DEFAULT 0"),
            ("progression_day", "INTEGER NOT NULL DEFAULT 0"),
            ("progression_date", "VARCHAR(10) NOT NULL DEFAULT ''"),
            ("passive_fraction", "REAL NOT NULL DEFAULT 0"),
            ("tap_fraction", "REAL NOT NULL DEFAULT 0"),
            ("passive_earned_today", "INTEGER NOT NULL DEFAULT 0"),
            ("tap_tokens", "REAL NOT NULL DEFAULT 45.0"),
            ("suspicion", "INTEGER NOT NULL DEFAULT 0"),
            ("locked_until", "DATETIME"),
            ("turbo_until", "DATETIME"),
            ("passive_boost_until", "DATETIME"),
            ("boost_date", "VARCHAR(16) NOT NULL DEFAULT ''"),
            ("turbo_used", "INTEGER NOT NULL DEFAULT 0"),
            ("refill_used", "INTEGER NOT NULL DEFAULT 0"),
            ("passboost_used", "INTEGER NOT NULL DEFAULT 0"),
        ]
        added = False
        for col, ddl in clicker_new_cols:
            if col not in cc:
                db.execute(text(f"ALTER TABLE clicker_states ADD COLUMN {col} {ddl}"))
                added = True
        if added:
            db.commit()

    # Бэкфилл: награды Battle Pass с kind='lootbox' исторически создавались без item_code,
    # из-за чего их клейм ничего не выдавал. Восстанавливаем код предмета из имени иконки
    # (lootbox_common/rare/epic/legendary).
    bp_cols = {row[1] for row in db.execute(text("PRAGMA table_info(battlepass_rewards)")).fetchall()}
    if bp_cols and {"item_code", "icon", "kind"} <= bp_cols:
        broken = db.query(models.BattlePassReward).filter(
            models.BattlePassReward.kind == "lootbox",
            (models.BattlePassReward.item_code.is_(None)) | (models.BattlePassReward.item_code == ""),
        ).all()
        for r in broken:
            if r.icon and "lootbox_" in r.icon:
                r.item_code = r.icon.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        if broken:
            db.commit()

    # Move legacy JSON claim markers to immutable rows with a database unique
    # constraint.  Keep the JSON field during the compatibility window because
    # old admin tooling still reads it.
    if db.get_bind().dialect.name == "sqlite":
        duplicate_quiz_attempts = db.execute(text(
            "SELECT COUNT(*) FROM ("
            "SELECT quiz_id, user_id FROM quiz_attempts "
            "GROUP BY quiz_id, user_id HAVING COUNT(*) > 1)"
        )).scalar_one()
        if duplicate_quiz_attempts:
            raise RuntimeError("Нарушена целостность тестов: найдены повторные попытки")
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempt_user "
            "ON quiz_attempts(quiz_id, user_id)"
        ))
        for ubp in db.query(models.UserBattlePass).all():
            try:
                raw = json.loads(ubp.claimed_rewards or "[]")
            except (TypeError, json.JSONDecodeError):
                raw = []
            levels: set[int] = set()
            for marker in raw:
                value = marker[0] if isinstance(marker, list) and marker else marker
                if isinstance(value, int):
                    levels.add(value)
            if not levels:
                continue
            rewards = db.query(models.BattlePassReward).filter(
                models.BattlePassReward.season_id == ubp.season_id,
                models.BattlePassReward.track == "free",
                models.BattlePassReward.level.in_(levels),
            ).all()
            for reward in rewards:
                exists = db.query(models.BattlePassClaim).filter(
                    models.BattlePassClaim.user_id == ubp.user_id,
                    models.BattlePassClaim.reward_id == reward.id,
                ).first()
                if not exists:
                    db.add(models.BattlePassClaim(user_id=ubp.user_id, reward_id=reward.id))
        db.commit()

        # items.skin_slot — слот скина (head/torso/legs/feet), NULL у обычных предметов.
        itcols = {row[1] for row in db.execute(text("PRAGMA table_info(items)")).fetchall()}
        if itcols and "skin_slot" not in itcols:
            db.execute(text("ALTER TABLE items ADD COLUMN skin_slot VARCHAR(16)"))
            db.commit()

        # ``create_all`` cannot retrofit CHECK constraints into an existing
        # SQLite table.  Production started before these model constraints were
        # introduced, so durable triggers provide the same last-line defence
        # for legacy databases and direct writes.
        integrity_checks = {
            "wallets": "SELECT COUNT(*) FROM wallets WHERE balance < 0 OR balance > 2000000000",
            "inventory": "SELECT COUNT(*) FROM inventory WHERE quantity < 0 OR quantity > 2000000000",
            "users.xp": "SELECT COUNT(*) FROM users WHERE xp < 0 OR xp >= 100 OR level < 1 OR level > 100 OR (level = 100 AND xp != 0)",
            "shop_products": "SELECT COUNT(*) FROM shop_products WHERE price <= 0 OR stock < -1",
            "market_listings": "SELECT COUNT(*) FROM market_listings WHERE quantity <= 0 OR price <= 0",
        }
        for label, sql in integrity_checks.items():
            if db.execute(text(sql)).scalar_one() != 0:
                raise RuntimeError(f"Нарушена целостность игровой экономики: {label}")

        guarded_tables = {
            "wallets": "NEW.balance < 0 OR NEW.balance > 2000000000",
            "inventory": "NEW.quantity < 0 OR NEW.quantity > 2000000000",
            "users": "NEW.xp < 0 OR NEW.xp >= 100 OR NEW.level < 1 OR NEW.level > 100 OR (NEW.level = 100 AND NEW.xp != 0)",
            "shop_products": "NEW.price <= 0 OR NEW.stock < -1",
            "market_listings": "NEW.quantity <= 0 OR NEW.price <= 0",
        }
        for table_name, condition in guarded_tables.items():
            for operation in ("INSERT", "UPDATE"):
                trigger_name = f"guard_{table_name}_{operation.lower()}"
                # Conditions evolve with the economy rules; rebuild instead of
                # keeping the first historical IF NOT EXISTS definition.
                db.execute(text(f"DROP TRIGGER IF EXISTS {trigger_name}"))
                db.execute(text(
                    f"CREATE TRIGGER {trigger_name} "
                    f"BEFORE {operation} ON {table_name} "
                    f"WHEN {condition} BEGIN "
                    "SELECT RAISE(ABORT, 'game economy integrity violation'); END"
                ))
        db.commit()


# Старые фейковые seed-аккаунты (нереальные Telegram ID) — удаляются на старте,
# чтобы в игре остались строго трое привязанных граждан.
_LEGACY_FAKE_TG_IDS = (1, 10001, 10002, 10003)


def _purge_user(db: Session, user: models.User) -> None:
    """Удаляет пользователя и все ссылки на него (для чистки фейковых аккаунтов)."""
    uid = user.id
    db.query(models.ChatMessage).filter(models.ChatMessage.user_id == uid).delete(synchronize_session=False)
    db.query(models.MarketListing).filter(
        (models.MarketListing.seller_id == uid) | (models.MarketListing.target_user_id == uid)
    ).delete(synchronize_session=False)
    db.query(models.Transaction).filter(
        (models.Transaction.sender_id == uid) | (models.Transaction.recipient_id == uid)
    ).delete(synchronize_session=False)
    db.query(models.WheelSpin).filter(models.WheelSpin.user_id == uid).delete(synchronize_session=False)
    db.query(models.QuizAttempt).filter(models.QuizAttempt.user_id == uid).delete(synchronize_session=False)
    db.query(models.GameInvite).filter(
        (models.GameInvite.from_user_id == uid) | (models.GameInvite.to_user_id == uid)
    ).delete(synchronize_session=False)
    db.query(models.GameSession).filter(
        (models.GameSession.player_x_id == uid) | (models.GameSession.player_o_id == uid)
    ).delete(synchronize_session=False)
    db.query(models.UserBattlePass).filter(models.UserBattlePass.user_id == uid).delete(synchronize_session=False)
    db.delete(user)  # каскадом удалит wallet/inventory/user_tasks
    db.flush()


def seed_players(db: Session) -> None:
    """Жёсткая привязка: ровно трое граждан по Telegram ID. Удаляет старые
    фейковые seed-аккаунты и приводит реальных игроков к привязке (роль + имя)."""
    # 1. Чистим легаси-фейки (id 1/10001/10002/10003) — реальных TG-юзеров с такими ID нет.
    for fake in db.query(models.User).filter(models.User.telegram_id.in_(_LEGACY_FAKE_TG_IDS)).all():
        _purge_user(db, fake)
    # 2. Приводим реальных игроков к привязке. Роль и каноничное имя — строго по Telegram ID.
    for tg_id, spec in PLAYER_BINDINGS.items():
        user = db.query(models.User).filter(models.User.telegram_id == tg_id).one_or_none()
        if user is None:
            user = models.User(
                telegram_id=tg_id,
                username=spec.get("username"),
                first_name=spec["first_name"],
                role=spec["role"],
            )
            db.add(user)
            db.flush()
            db.add(models.Wallet(user_id=user.id, balance=0))
        else:
            user.first_name = spec["first_name"]
            user.role = spec["role"]
            if spec.get("username"):
                user.username = spec["username"]
            if user.wallet is None:
                db.add(models.Wallet(user_id=user.id, balance=0))


def seed(db: Session) -> None:
    seed_players(db)
    # Pre-launch catalog intentionally starts with Kovboxes and their fragments
    # only. New items may still be created later through the editor.

    # Tasks, banners and news are fully admin-managed.  Do not recreate rows
    # after an administrator deliberately deletes them.

    # Legal texts (placeholders)
    if not db.query(models.LegalText).filter(models.LegalText.slug == "constitution").first():
        db.add(
            models.LegalText(
                slug="constitution",
                title="Конституция Ковчега",
                body=(
                    "Глава 1. Общие положения\n\n"
                    "1.1 Ковчег — добровольное сообщество жителей цифрового мира.\n"
                    "1.2 Каждый гражданин обладает равными правами и обязанностями.\n\n"
                    "Глава 2. Права и обязанности\n\n"
                    "2.1 Гражданин имеет право на труд, защиту и участие в делах общины.\n"
                    "2.2 Гражданин обязан соблюдать законы и помогать соседям.\n\n"
                    "(Это плейсхолдер. Пришли мне финальный текст — я заменю.)"
                ),
            )
        )
    if not db.query(models.LegalText).filter(models.LegalText.slug == "laws").first():
        db.add(
            models.LegalText(
                slug="laws",
                title="Законодательство Ковчега",
                body=(
                    "Раздел 1. Хозяйственное право\n\n"
                    "Статья 1. Сделки между гражданами осуществляются через рынок Коверны.\n"
                    "Статья 2. Запрещены сделки с применением обмана.\n\n"
                    "Раздел 2. Уголовное право\n\n"
                    "Статья 3. Нарушение правил карается ограничением доступа к функциям.\n\n"
                    "(Это плейсхолдер. Пришли мне финальный текст — я заменю.)"
                ),
            )
        )

    # Seed lootbox items.  Existing rows belong to the editor: defaults are
    # applied only on first creation, never again on application restart.
    canonical_item_codes = (
        "lootbox_common", "lootbox_rare", "lootbox_epic",
        "lootbox_legendary", "lootbox_seasonal", "lootbox_mega",
    )
    existing_canonical_item_codes = {
        row[0]
        for row in db.query(models.Item.code).filter(models.Item.code.in_(canonical_item_codes)).all()
    }
    lootbox_common = _get_or_create_item(
        db, "lootbox_common",
        name="Бронзовый ковбокс",
        icon="/static/img/items/lootbox_common.png",
        category="Ковбоксы",
        rarity="Бронзовый",
        lootbox_pool_code="common",
    )
    lootbox_rare = _get_or_create_item(
        db, "lootbox_rare",
        name="Серебряный ковбокс",
        icon="/static/img/items/lootbox_rare.png",
        category="Ковбоксы",
        rarity="Серебряный",
        lootbox_pool_code="rare",
    )
    lootbox_epic = _get_or_create_item(
        db, "lootbox_epic",
        name="Золотой ковбокс",
        icon="/static/img/items/lootbox_epic.png",
        category="Ковбоксы",
        rarity="Золотой",
        lootbox_pool_code="epic",
    )
    lootbox_legendary = _get_or_create_item(
        db, "lootbox_legendary",
        name="Легендарный ковбокс",
        icon="/static/img/items/lootbox_legendary.png",
        category="Ковбоксы",
        rarity="Легендарный",
        lootbox_pool_code="legendary",
    )
    lootbox_seasonal = _get_or_create_item(
        db, "lootbox_seasonal",
        name="Сезонный ковбокс",
        icon="/static/img/items/lootbox_seasonal.png",
        category="Ковбоксы",
        rarity="Сезонный",
        lootbox_pool_code="seasonal",
    )
    lootbox_mega = _get_or_create_item(
        db, "lootbox_mega",
        name="Мегаковбокс с выбором предметов",
        icon="/static/img/items/lootbox_mega.png",
        category="Ковбоксы",
        rarity="Мега",
        lootbox_pool_code="mega",
    )
    fragment = _get_or_create_item(
        db, "box_fragment",
        name="Фрагмент ковбокса",
        icon="/static/img/items/box_fragment.svg",
        category="Ресурсы",
        rarity="Обычный",
    )
    fragment.description = ""
    failure_fragment = _get_or_create_item(
        db, "failure_fragment",
        name="Фрагмент неудачи",
        icon="/static/img/items/failure_fragment.png",
        category="Фрагменты",
        rarity="Редкий",
        can_gift=True,
        can_activate=True,
    )
    failure_fragment.description = ""
    failure_fragment.image_url = "/static/img/items/failure_fragment.png"
    _seed_skins(db)
    consolation_item = _get_or_create_item(
        db, "lootbox_consolation",
        name="Утешительный ковбокс",
        icon="/static/img/items/lootbox_consolation.png",
        category="Ковбоксы",
        rarity="Секретный",
        can_gift=True,
        can_activate=False,
        lootbox_pool_code="consolation",
    )
    consolation_item.description = ""
    consolation_item.image_url = "/static/img/items/lootbox_consolation.png"
    canonical_lootbox_items = {
        "common": (lootbox_common, "Бронзовый ковбокс", "Бронзовый", "/static/img/items/lootbox_common.png"),
        "rare": (lootbox_rare, "Серебряный ковбокс", "Серебряный", "/static/img/items/lootbox_rare.png"),
        "epic": (lootbox_epic, "Золотой ковбокс", "Золотой", "/static/img/items/lootbox_epic.png"),
        "legendary": (lootbox_legendary, "Легендарный ковбокс", "Легендарный", "/static/img/items/lootbox_legendary.png"),
        "seasonal": (lootbox_seasonal, "Сезонный ковбокс", "Сезонный", "/static/img/items/lootbox_seasonal.png"),
        "mega": (lootbox_mega, "Мегаковбокс с выбором предметов", "Мега", "/static/img/items/lootbox_mega.png"),
    }
    for code, (item, name, rarity, image_url) in canonical_lootbox_items.items():
        if item.code not in existing_canonical_item_codes:
            item.name = name
            item.icon = image_url
            item.image_url = image_url
            item.rarity = rarity
            item.can_gift = True
            item.can_activate = False
        item.description = ""
        item.category = "Ковбоксы"
        item.lootbox_pool_code = code
    seeded_lootbox_items = {
        "common": lootbox_common,
        "rare": lootbox_rare,
        "epic": lootbox_epic,
        "legendary": lootbox_legendary,
        "seasonal": lootbox_seasonal,
        "mega": lootbox_mega,
    }
    for code, lootbox_item in seeded_lootbox_items.items():
        lootbox_item.lootbox_pool_code = code
        lootbox_item.category = "Ковбоксы"
    db.flush()
    _seed_catalog_snacks(db, fragment)

    # Seed lootbox pools
    created_pool_codes: set[str] = set()

    def _fill_pool(code: str) -> models.LootboxPool:
        pool = db.query(models.LootboxPool).filter(models.LootboxPool.code == code).first()
        if pool:
            return pool
        pool = models.LootboxPool(code=code, name=code.capitalize())
        db.add(pool)
        db.flush()
        created_pool_codes.add(code)
        return pool

    pools = {
        "common": _fill_pool("common"),
        "rare": _fill_pool("rare"),
        "epic": _fill_pool("epic"),
        "legendary": _fill_pool("legendary"),
        "seasonal": _fill_pool("seasonal"),
        "mega": _fill_pool("mega"),
        "consolation": _fill_pool("consolation"),
    }
    # Canonical pre-launch prices. These managed products are synced to
    # the real shop below, so purchase price never comes from the client.
    default_sale_prices = {
        "common": 100,
        "rare": 150,
        "epic": 250,
        "legendary": 1_180,
        "seasonal": 450,
        "mega": 1_580,
        "consolation": None,
    }
    for code in created_pool_codes:
        pools[code].sale_price = default_sale_prices[code]
        pools[code].sale_currency = "kovbucks"

    # chest_v2 is a one-time, explicit migration.  Once a canonical pool has
    # this mode, later starts preserve every administrator change instead of
    # silently restoring seed values.
    chest_defaults = {
        "common": ((1, 1), (1, 3), (10, 30), 5),
        "rare": ((1, 2), (3, 6), (30, 60), 15),
        "epic": ((2, 3), (6, 13), (60, 120), 30),
        "legendary": ((3, 4), (13, 26), (120, 250), 100),
        "seasonal": ((2, 3), (10, 20), (80, 180), 50),
        "consolation": ((1, 2), (3, 8), (30, 70), 25),
    }
    prize_codes = [row[0] for row in (*CATALOG_SNACKS, *CATALOG_SWEETS)]
    prize_items = (
        db.query(models.Item)
        .filter(models.Item.code.in_(prize_codes))
        .order_by(models.Item.id)
        .all()
    )

    def _migrate_chest_pool(code: str, pool: models.LootboxPool) -> None:
        if pool.opening_mode == "chest_v2":
            return
        fragment_range, xp_range, kovbucks_range, bonus_chance = chest_defaults[code]
        pool.entries.clear()
        pool.entries.extend([
            models.LootboxPoolEntry(
                reward_kind="item", item_id=fragment.id,
                amount_min=fragment_range[0], amount_max=fragment_range[1],
                weight=100, is_guaranteed=True, is_active=True, sort_order=0,
            ),
            models.LootboxPoolEntry(
                reward_kind="xp", item_id=None,
                amount_min=xp_range[0], amount_max=xp_range[1],
                weight=100, is_guaranteed=True, is_active=True, sort_order=1,
            ),
            models.LootboxPoolEntry(
                reward_kind="kovbucks", item_id=None,
                amount_min=kovbucks_range[0], amount_max=kovbucks_range[1],
                weight=100, is_guaranteed=True, is_active=True, sort_order=2,
            ),
        ])
        pool.opening_mode = "chest_v2"
        pool.bonus_item_chance = 0
        pool.special_item_chance = bonus_chance
        pool.super_special_item_chance = 0
        pool.guaranteed_slots = 3  # retained only for legacy-client display
        pool.allow_duplicates = False
        pool.open_image_url = pool.open_image_url or pool.image_url
        if code not in created_pool_codes:
            pool.version += 1

    for code in chest_defaults:
        _migrate_chest_pool(code, pools[code])

    mega_pool = pools["mega"]
    if mega_pool.opening_mode != "chest_v2":
        mega_pool.opening_mode = "chest_v2"
        mega_pool.bonus_item_chance = 0
        mega_pool.open_image_url = mega_pool.open_image_url or mega_pool.image_url
        mega_pool.is_droppable = False
        if "mega" not in created_pool_codes:
            mega_pool.version += 1
    mega_placeholder = (
        len(mega_pool.entries) == 1
        and mega_pool.entries[0].reward_kind == "kovbucks"
        and mega_pool.entries[0].amount_min == 1
        and mega_pool.entries[0].amount_max == 1
    )
    if not mega_pool.entries or mega_placeholder:
        mega_pool.entries.clear()
        mega_pool.guaranteed_slots = 3
        mega_pool.allow_duplicates = False
        defaults = [
            ("item", fragment.id, 2, 4, 20),
            ("xp", None, 10, 23, 20),
            ("kovbucks", None, 100, 250, 20),
        ]
        selected_prizes = prize_items[:4]
        remaining_weight = 40
        if selected_prizes:
            base, remainder = divmod(remaining_weight, len(selected_prizes))
            defaults.extend(
                ("item", prize.id, 1, 1, base + (1 if index < remainder else 0))
                for index, prize in enumerate(selected_prizes)
            )
        else:
            defaults[-1] = ("kovbucks", None, 100, 250, 60)
        for index, (kind, item_id, low, high, weight) in enumerate(defaults):
            mega_pool.entries.append(models.LootboxPoolEntry(
                reward_kind=kind, item_id=item_id, amount_min=low, amount_max=high,
                weight=weight, is_guaranteed=False, is_active=True, sort_order=index,
            ))
        if "mega" not in created_pool_codes:
            mega_pool.version += 1

    consolation_pool = pools["consolation"]
    consolation_pool.item_id = consolation_item.id
    consolation_item.lootbox_pool_code = "consolation"
    consolation_pool.sale_price = None
    consolation_pool.sale_currency = "kovbucks"
    consolation_pool.is_droppable = False
    consolation_pool.assembly_weight = 0
    consolation_pool.is_archived = False
    if "consolation" in created_pool_codes:
        consolation_pool.name = "Утешительный ковбокс"
        consolation_pool.rarity = "Секретный"
        consolation_pool.image_url = "/static/img/items/lootbox_consolation.png"
        consolation_pool.open_image_url = "/static/img/items/lootbox_consolation_open.png"
        consolation_pool.sort_order = 99
    pool_defaults = {
        code: (name, rarity, image_url)
        for code, (_, name, rarity, image_url) in canonical_lootbox_items.items()
    }
    for code, pool in pools.items():
        item = seeded_lootbox_items.get(code)
        if item:
            pool.item_id = item.id
            if code in created_pool_codes:
                pool.name = pool_defaults[code][0]
                pool.description = ""
                pool.rarity = pool_defaults[code][1]
                pool.image_url = pool_defaults[code][2]
                pool.open_image_url = pool.image_url
                pool.is_active = True
                pool.is_archived = False
                pool.sort_order = tuple(pools).index(code)
                if code == "mega":
                    pool.is_droppable = False

    # Keep bundled visuals current while preserving custom images uploaded
    # through the editor (they live under /static/uploads).
    visual_paths = {
        code: (
            f"/static/img/items/lootbox_{code}.png",
            (
                f"/static/img/items/lootbox_{code}.png"
                if code in {"common", "rare", "epic", "seasonal"}
                else f"/static/img/items/lootbox_{code}_open.png"
            ),
        )
        for code in ("common", "rare", "epic", "legendary", "seasonal", "mega", "consolation")
    }
    for code, (closed_path, open_path) in visual_paths.items():
        pool = pools[code]
        if not pool.image_url or str(pool.image_url).startswith("/static/img/items/lootbox_"):
            pool.image_url = closed_path
        if not pool.open_image_url or str(pool.open_image_url).startswith("/static/img/items/lootbox_"):
            pool.open_image_url = open_path

    # Replace the pre-launch catalogue with exactly four user-facing Kovboxes.
    # Stable internal codes preserve opening history and external references;
    # retired inventory is merged into the closest current box instead of
    # deleting value from players.
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS maintenance_migrations (
            key VARCHAR(128) PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """))
    four_boxes_key = "2026-07-29-four-star-kovboxes-v1"
    four_boxes_done = db.execute(
        text("SELECT 1 FROM maintenance_migrations WHERE key = :key"),
        {"key": four_boxes_key},
    ).first()
    if four_boxes_done is None:
        active_specs = {
            "common": ("Бронзовый ковбокс", "Бронзовый", 100, 0, 55, 8, 12, 1),
            "rare": ("Серебряный ковбокс", "Серебряный", 150, 1, 28, 18, 25, 2),
            "epic": ("Золотой ковбокс", "Золотой", 250, 2, 12, 18, 25, 2),
            "seasonal": ("Сезонный ковбокс", "Сезонный", 450, 3, 5, 18, 25, 2),
        }
        for code, (name, rarity, price, order, assembly_weight, xp_low, xp_high, fragments) in active_specs.items():
            pool = pools[code]
            item = seeded_lootbox_items[code]
            image = f"/static/img/items/lootbox_{code}.png"
            item.name = name
            item.rarity = rarity
            item.icon = image
            item.image_url = image
            item.category = "Ковбоксы"
            item.description = ""
            item.can_gift = True
            item.can_activate = False
            item.lootbox_pool_code = code
            pool.name = name
            pool.rarity = rarity
            pool.description = ""
            pool.image_url = image
            pool.open_image_url = image
            pool.opening_mode = "chest_v2"
            pool.is_active = True
            pool.is_droppable = True
            pool.is_archived = False
            pool.sale_price = price
            pool.sale_currency = "kovbucks"
            pool.sort_order = order
            pool.assembly_weight = assembly_weight
            pool.guaranteed_slots = 1
            pool.allow_duplicates = False
            pool.bonus_item_chance = 0
            pool.special_item_chance = 0
            pool.super_special_item_chance = 0
            pool.entries.clear()
            pool.entries.extend([
                models.LootboxPoolEntry(
                    reward_kind="xp", amount_min=xp_low, amount_max=xp_high,
                    weight=70, is_guaranteed=False, is_active=True, sort_order=0,
                ),
                models.LootboxPoolEntry(
                    reward_kind="item", item_id=fragment.id,
                    amount_min=fragments, amount_max=fragments,
                    weight=30, is_guaranteed=False, is_active=True, sort_order=1,
                ),
            ])
            pool.version += 1

        retired_map = {
            "legendary": "epic",
            "mega": "seasonal",
            "consolation": "common",
        }

        def _merge_inventory(source: models.Item, target: models.Item) -> None:
            for row in db.query(models.InventoryItem).filter(
                models.InventoryItem.item_id == source.id
            ).all():
                current = db.query(models.InventoryItem).filter(
                    models.InventoryItem.user_id == row.user_id,
                    models.InventoryItem.item_id == target.id,
                ).one_or_none()
                if current is None:
                    row.item_id = target.id
                else:
                    current.quantity += row.quantity
                    db.delete(row)

        for old_code, target_code in retired_map.items():
            old_pool = pools[old_code]
            old_item = old_pool.item
            target_item = seeded_lootbox_items[target_code]
            if old_item is not None:
                _merge_inventory(old_item, target_item)
                for listing in db.query(models.MarketListing).filter(
                    models.MarketListing.item_id == old_item.id
                ).all():
                    listing.item_id = target_item.id
                for gift in db.query(models.PendingLoginGift).filter(
                    models.PendingLoginGift.item_id == old_item.id
                ).all():
                    gift.item_id = target_item.id
                for task in db.query(models.Task).filter(
                    models.Task.reward_item_id == old_item.id
                ).all():
                    task.reward_item_id = target_item.id
            old_pool.is_active = False
            old_pool.is_droppable = False
            old_pool.is_archived = True
            old_pool.sale_price = None
            old_pool.assembly_weight = 0
            old_pool.version += 1

            old_item_code = f"lootbox_{old_code}"
            target_item_code = f"lootbox_{target_code}"
            for prize in db.query(models.WheelPrize).filter(
                models.WheelPrize.item_code == old_item_code
            ).all():
                prize.item_code = target_item_code
                prize.label = target_item.name
            for reward in db.query(models.BattlePassReward).filter(
                models.BattlePassReward.item_code == old_item_code
            ).all():
                reward.item_code = target_item_code
                reward.label = target_item.name
                reward.icon = target_item.icon

        for code, item in seeded_lootbox_items.items():
            if code not in active_specs:
                continue
            for reward in db.query(models.BattlePassReward).filter(
                models.BattlePassReward.item_code == item.code
            ).all():
                reward.label = item.name
                reward.icon = item.icon
            for prize in db.query(models.WheelPrize).filter(
                models.WheelPrize.item_code == item.code
            ).all():
                prize.label = item.name

        db.execute(
            text("INSERT INTO maintenance_migrations(key) VALUES (:key)"),
            {"key": four_boxes_key},
        )
        db.flush()

    # The consolation box is assembled from failure fragments and must remain
    # separate from the four boxes sold in the shop.  The previous four-box
    # migration retired it together with obsolete commercial boxes; restore it
    # once without touching any player inventory.
    consolation_key = "2026-08-01-consolation-kovbox-v1"
    consolation_done = db.execute(
        text("SELECT 1 FROM maintenance_migrations WHERE key = :key"),
        {"key": consolation_key},
    ).first()
    if consolation_done is None:
        consolation_item.name = "Утешительный ковбокс"
        consolation_item.icon = "/static/img/items/lootbox_consolation.png"
        consolation_item.image_url = "/static/img/items/lootbox_consolation.png"
        consolation_item.category = "Ковбоксы"
        consolation_item.rarity = "Утешительный"
        consolation_item.description = ""
        consolation_item.can_gift = True
        consolation_item.can_activate = False
        consolation_item.lootbox_pool_code = "consolation"
        consolation_pool.item_id = consolation_item.id
        consolation_pool.name = "Утешительный ковбокс"
        consolation_pool.description = ""
        consolation_pool.rarity = "Утешительный"
        consolation_pool.image_url = "/static/img/items/lootbox_consolation.png"
        consolation_pool.open_image_url = "/static/img/items/lootbox_consolation.png"
        consolation_pool.opening_mode = "chest_v2"
        consolation_pool.is_active = True
        consolation_pool.is_archived = False
        consolation_pool.is_droppable = False
        consolation_pool.sale_price = None
        consolation_pool.assembly_weight = 0
        consolation_pool.sort_order = 99
        consolation_pool.guaranteed_slots = 1
        consolation_pool.allow_duplicates = False
        consolation_pool.version += 1
        db.execute(
            text("INSERT INTO maintenance_migrations(key) VALUES (:key)"),
            {"key": consolation_key},
        )
        db.flush()

    # Canonical four-box editor: independent low-star ranges and per-transition
    # star-upgrade chances. The rows are server-owned configuration records;
    # the player still receives exactly one reward per opening.
    star_editor_key = "2026-08-02-kovbox-star-editor-v1"
    star_editor_done = db.execute(
        text("SELECT 1 FROM maintenance_migrations WHERE key = :key"),
        {"key": star_editor_key},
    ).first()
    if star_editor_done is None:
        for code in ("common", "rare", "epic", "seasonal"):
            pool = pools[code]
            pool.bonus_item_chance = 50
            pool.special_item_chance = 4
            pool.super_special_item_chance = 1
            pool.entries.clear()
            pool.entries.extend([
                models.LootboxPoolEntry(
                    reward_kind="xp", amount_min=8, amount_max=12,
                    weight=100, is_guaranteed=True, is_active=True, sort_order=101,
                ),
                models.LootboxPoolEntry(
                    reward_kind="item", item_id=fragment.id, amount_min=1, amount_max=1,
                    weight=100, is_guaranteed=True, is_active=True, sort_order=102,
                ),
                models.LootboxPoolEntry(
                    reward_kind="xp", amount_min=18, amount_max=25,
                    weight=100, is_guaranteed=True, is_active=True, sort_order=201,
                ),
                models.LootboxPoolEntry(
                    reward_kind="item", item_id=fragment.id, amount_min=2, amount_max=2,
                    weight=100, is_guaranteed=True, is_active=True, sort_order=202,
                ),
            ])
            pool.version += 1
        db.execute(
            text("INSERT INTO maintenance_migrations(key) VALUES (:key)"),
            {"key": star_editor_key},
        )
        db.flush()

    # Economy calibration for the canonical four Kovboxes. Rewards are valued
    # around 600 K for a special item and 1,000 K for a super-special one.
    # Bronze and Silver remain affordable, so their paths to high tiers are
    # deliberately rarer; Gold and Seasonal retain premium pricing.
    # This one-time migration preserves later administrator edits.
    balanced_kovboxes_key = "2026-08-03-balanced-kovboxes-v1"
    balanced_kovboxes_done = db.execute(
        text("SELECT 1 FROM maintenance_migrations WHERE key = :key"),
        {"key": balanced_kovboxes_key},
    ).first()
    if balanced_kovboxes_done is None:
        balanced_kovboxes = {
            "common": {
                "price": 85,
                "upgrades": (30, 7, 1),
                "ranges": {101: (5, 10), 102: (1, 2), 201: (12, 20), 202: (2, 3)},
            },
            "rare": {
                "price": 275,
                "upgrades": (0, 10, 1),
                "ranges": {101: (5, 10), 102: (1, 2), 201: (15, 25), 202: (2, 4)},
            },
            "epic": {
                "price": 1100,
                "upgrades": (0, 0, 8),
                "ranges": {101: (5, 10), 102: (1, 2), 201: (15, 25), 202: (2, 4)},
            },
            "seasonal": {
                "price": 1550,
                "upgrades": (0, 0, 0),
                "ranges": {101: (5, 10), 102: (1, 2), 201: (15, 25), 202: (2, 4)},
            },
        }
        for code, config in balanced_kovboxes.items():
            pool = pools.get(code)
            if pool is None:
                continue
            pool.sale_price = config["price"]
            (
                pool.bonus_item_chance,
                pool.special_item_chance,
                pool.super_special_item_chance,
            ) = config["upgrades"]
            entries_by_order = {entry.sort_order: entry for entry in pool.entries}
            for sort_order, (amount_min, amount_max) in config["ranges"].items():
                entry = entries_by_order.get(sort_order)
                if entry is not None:
                    entry.amount_min = amount_min
                    entry.amount_max = amount_max
            if pool.item is not None:
                product = db.query(models.ShopProduct).filter(
                    models.ShopProduct.item_id == pool.item.id,
                ).one_or_none()
                if product is not None:
                    product.price = config["price"]
            pool.version += 1
        db.execute(
            text("INSERT INTO maintenance_migrations(key) VALUES (:key)"),
            {"key": balanced_kovboxes_key},
        )
        db.flush()

    # Remove obsolete editor-created duplicates. The live data is checked
    # before this migration: these pools/items have no inventory, listings,
    # shop rows, pass rewards or opening history.
    legacy_codes = ("bronze", "silver", "gold")
    for legacy_pool in db.query(models.LootboxPool).filter(models.LootboxPool.code.in_(legacy_codes)).all():
        db.delete(legacy_pool)
    db.flush()
    legacy_item_codes = tuple(f"lootbox_{code}" for code in legacy_codes)
    for legacy_item in db.query(models.Item).filter(models.Item.code.in_(legacy_item_codes)).all():
        db.delete(legacy_item)
    db.flush()

    # Older editor versions could create a pool without its inventory item.
    # Repair every custom row which was created without an inventory item.
    for pool in db.query(models.LootboxPool).filter(models.LootboxPool.item_id.is_(None)).all():
        item_code = pool.code if pool.code.startswith("lootbox_") else f"lootbox_{pool.code}"
        item = db.query(models.Item).filter(models.Item.code == item_code).one_or_none()
        if item is None:
            item = models.Item(
                code=item_code, name=pool.name, description="",
                icon=pool.image_url or "/static/img/items/lootbox_common.png",
                image_url=pool.image_url or "/static/img/items/lootbox_common.png",
                rarity=pool.rarity or "Обычный", category="Ковбоксы",
                can_gift=True, can_activate=False, lootbox_pool_code=pool.code,
            )
            db.add(item)
            db.flush()
        if item.lootbox_pool_code in (None, pool.code):
            item.lootbox_pool_code = pool.code
            item.category = "Ковбоксы"
            item.description = ""
            pool.item_id = item.id

    # Seed Battle Pass season. Rewards are intentionally NOT seeded: the level
    # ladder is filled in from the admin panel with the current season prizes.
    if db.query(models.BattlePassSeason).count() == 0:
        db.add(models.BattlePassSeason(
            name="Сезон 1: Лето",
            theme="summer",
            xp_per_level=100,
            total_levels=100,
            is_active=True,
        ))
        db.flush()

    # Create UserBattlePass for every existing user
    season = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.is_active.is_(True)).first()
    if season:
        for user in db.query(models.User).all():
            ubp = db.query(models.UserBattlePass).filter(
                models.UserBattlePass.user_id == user.id,
                models.UserBattlePass.season_id == season.id,
            ).first()
            if not ubp:
                db.add(models.UserBattlePass(user_id=user.id, season_id=season.id))

    # clicker_states — таблица кликера
    existing_tables = {row[0] for row in db.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
    if "clicker_states" not in existing_tables:
        db.execute(text("""
            CREATE TABLE clicker_states (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                lvl_click INTEGER NOT NULL DEFAULT 0,
                lvl_passive INTEGER NOT NULL DEFAULT 0,
                lvl_energy INTEGER NOT NULL DEFAULT 0,
                lvl_crit INTEGER NOT NULL DEFAULT 0,
                lvl_regen INTEGER NOT NULL DEFAULT 0,
                energy REAL NOT NULL DEFAULT 100.0,
                last_sync DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        db.commit()
