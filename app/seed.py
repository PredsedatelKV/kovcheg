from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models
from app.api._helpers import sync_lootbox_shop_product
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


# Icons for existing rows are migrated to file paths on every startup so a
# user can drop new SVG/PNG files into static/img/* without touching the DB.
ITEM_ICON_BY_CODE: dict[str, str] = {
    "lootbox_common": "/static/img/items/lootbox_common.svg",
    "lootbox_rare": "/static/img/items/lootbox_rare.svg",
    "lootbox_epic": "/static/img/items/lootbox_epic.svg",
    "lootbox_legendary": "/static/img/items/lootbox_legendary.svg",
    "box_fragment": "/static/img/items/box_fragment.svg",
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
        if item is not None and item.icon != path:
            item.icon = path
    for name, path in TASK_ICON_BY_NAME.items():
        task = db.query(models.Task).filter(models.Task.name == name).one_or_none()
        if task is not None and task.icon != path:
            task.icon = path
    for item in db.query(models.Item).all():
        item.description = ""
    for pool in db.query(models.LootboxPool).all():
        sync_lootbox_shop_product(db, pool)


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

    # Expand legacy prize-only pools into complete, server-owned Kovbox
    # configurations.  SQLite does not alter existing tables during
    # ``create_all``, so columns are added explicitly and old item entries are
    # rebuilt once to allow currency/XP rewards where item_id is nullable.
    lpcols = {row[1] for row in db.execute(text("PRAGMA table_info(lootbox_pools)")).fetchall()}
    if lpcols:
        lootbox_pool_columns = [
            ("description", "TEXT NOT NULL DEFAULT ''"),
            ("rarity", "VARCHAR(32) NOT NULL DEFAULT 'Обычный'"),
            ("image_url", "VARCHAR(512) NOT NULL DEFAULT '/static/img/items/lootbox_common.svg'"),
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
        import json
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

        # ``create_all`` cannot retrofit CHECK constraints into an existing
        # SQLite table.  Production started before these model constraints were
        # introduced, so durable triggers provide the same last-line defence
        # for legacy databases and direct writes.
        integrity_checks = {
            "wallets": "SELECT COUNT(*) FROM wallets WHERE balance < 0 OR balance > 2000000000",
            "inventory": "SELECT COUNT(*) FROM inventory WHERE quantity < 0 OR quantity > 2000000000",
            "users.xp": "SELECT COUNT(*) FROM users WHERE xp < 0 OR xp > 3000",
            "shop_products": "SELECT COUNT(*) FROM shop_products WHERE price <= 0 OR stock < -1",
            "market_listings": "SELECT COUNT(*) FROM market_listings WHERE quantity <= 0 OR price <= 0",
        }
        for label, sql in integrity_checks.items():
            if db.execute(text(sql)).scalar_one() != 0:
                raise RuntimeError(f"Нарушена целостность игровой экономики: {label}")

        guarded_tables = {
            "wallets": "NEW.balance < 0 OR NEW.balance > 2000000000",
            "inventory": "NEW.quantity < 0 OR NEW.quantity > 2000000000",
            "users": "NEW.xp < 0 OR NEW.xp > 3000",
            "shop_products": "NEW.price <= 0 OR NEW.stock < -1",
            "market_listings": "NEW.quantity <= 0 OR NEW.price <= 0",
        }
        for table_name, condition in guarded_tables.items():
            for operation in ("INSERT", "UPDATE"):
                trigger_name = f"guard_{table_name}_{operation.lower()}"
                db.execute(text(
                    f"CREATE TRIGGER IF NOT EXISTS {trigger_name} "
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


WHEEL_PRIZES: list[dict] = [
    {"label": "50 Ковбаксов", "kind": "coins", "value": 50, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 25, "sort_order": 0},
    {"label": "5 Ковбаксов", "kind": "coins", "value": 5, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 35, "sort_order": 1},
    {"label": "25 Ковбаксов", "kind": "coins", "value": 25, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 30, "sort_order": 2},
    {"label": "200 Ковбаксов", "kind": "coins", "value": 200, "item_code": None, "icon": "/static/img/ui/money_bag.svg", "weight": 5, "sort_order": 3},
    {"label": "50 Ковбаксов", "kind": "coins", "value": 50, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 20, "sort_order": 4},
    {"label": "75 Ковбаксов", "kind": "coins", "value": 75, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 12, "sort_order": 5},
    {"label": "10 Ковбаксов", "kind": "coins", "value": 10, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 30, "sort_order": 6},
    {"label": "15 Ковбаксов", "kind": "coins", "value": 15, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 25, "sort_order": 7},
]


def seed_wheel_prizes(db: Session) -> None:
    if db.query(models.WheelPrize).count() == 0:
        for spec in WHEEL_PRIZES:
            db.add(models.WheelPrize(**spec, is_active=True))


def seed(db: Session) -> None:
    seed_players(db)
    # Pre-launch catalog intentionally starts with Kovboxes and their fragments
    # only. New items may still be created later through the editor.

    # Tasks
    task_defs = [
        {
            "name": "Добыча ресурсов",
            "description": "Отправляйтесь в шахты и леса, добывайте ресурсы для развития вашего поселения. Соберите 50 единиц камня и 30 единиц дерева.",
            "icon": "/static/img/tasks/mining.svg",
            "reward": 25,
            "target_progress": 80,
            "is_daily_plan": False,
            "sort_order": 1,
        },
        {
            "name": "Помощь жителям",
            "description": "Помогите соседям с их делами: посадите дерево, наколите дров или принесите воды.",
            "icon": "/static/img/tasks/helping.svg",
            "reward": 30,
            "target_progress": 1,
            "is_daily_plan": False,
            "sort_order": 2,
        },
        {
            "name": "Защита поселения",
            "description": "Постойте на страже у врат Ковчега — отчитайтесь о смене в боте.",
            "icon": "/static/img/tasks/defense.svg",
            "reward": 20,
            "target_progress": 1,
            "is_daily_plan": False,
            "sort_order": 3,
        },
        {
            "name": "Посади 10 деревьев",
            "description": "Внесите вклад в развитие поселения — посадите 10 деревьев в лесу или на свободных участках.",
            "icon": "/static/img/tasks/trees.svg",
            "reward": 25,
            "target_progress": 10,
            "is_daily_plan": False,
            "sort_order": 4,
        },
        {
            "name": "Добыть 50 камня",
            "description": "Соберите 50 единиц камня для строительства главного зала.",
            "icon": "/static/img/tasks/stone.svg",
            "reward": 30,
            "target_progress": 50,
            "is_daily_plan": False,
            "sort_order": 5,
        },
        {
            "name": "Ежедневный план",
            "description": "Выполняйте задания каждый день и становитесь сильнее. Этот план обязателен для всех жителей Ковчега.",
            "icon": "/static/img/tasks/scroll.svg",
            "reward": 0,
            "target_progress": 5,
            "is_daily_plan": True,
            "sort_order": 0,
        },
    ]
    for spec in task_defs:
        existing = db.query(models.Task).filter(models.Task.name == spec["name"]).one_or_none()
        if existing is None:
            db.add(models.Task(**spec))

    # Banners
    banner_defs = [
        ("https://picsum.photos/seed/kovcheg-castle/1280/720", "Замок Ковчега"),
        ("https://picsum.photos/seed/kovcheg-island/1280/720", "Парящий остров"),
        ("https://picsum.photos/seed/kovcheg-mountain/1280/720", "Горные земли"),
    ]
    for order, (url, title) in enumerate(banner_defs):
        existing = db.query(models.Banner).filter(models.Banner.image_url == url).one_or_none()
        if existing is None:
            db.add(models.Banner(image_url=url, title=title, sort_order=order, is_active=True))

    # News
    news_defs = [
        (
            "https://picsum.photos/seed/kovcheg-news/700/500",
            "Новый сезон уже начался!",
            "Исследуйте новые земли, выполняйте задания и получайте награды.",
        ),
        (
            "https://picsum.photos/seed/kovcheg-news-2/700/500",
            "Открыты заявки в Совет",
            "Жителям Ковчега доступны выборы в Совет. Подайте заявку через бота, чтобы войти в число кандидатов.",
        ),
        (
            "https://picsum.photos/seed/kovcheg-news-3/700/500",
            "Рынок расширен",
            "Теперь на рынке можно выставлять любые предметы из инвентаря — и сразу получать Ковбаксы после продажи.",
        ),
    ]
    for url, title, body in news_defs:
        existing = db.query(models.News).filter(models.News.image_url == url).one_or_none()
        if existing is None:
            db.add(models.News(image_url=url, title=title, body=body))

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

    # Chat messages
    if db.query(models.ChatMessage).count() == 0:
        ibragim = db.query(models.User).filter(models.User.first_name == "Ибрагим").first()
        if ibragim:
            db.add(models.ChatMessage(user_id=ibragim.id, content="Привет всем!", message_type="text"))

    # Seed lootbox items
    lootbox_common = _get_or_create_item(
        db, "lootbox_common",
        name="Обычный ковбокс",
        icon="/static/img/items/lootbox_common.svg",
        category="Ковбоксы",
        rarity="Обычный",
        lootbox_pool_code="common",
    )
    lootbox_rare = _get_or_create_item(
        db, "lootbox_rare",
        name="Редкий ковбокс",
        icon="/static/img/items/lootbox_rare.svg",
        category="Ковбоксы",
        rarity="Редкий",
        lootbox_pool_code="rare",
    )
    lootbox_epic = _get_or_create_item(
        db, "lootbox_epic",
        name="Эпический ковбокс",
        icon="/static/img/items/lootbox_epic.svg",
        category="Ковбоксы",
        rarity="Эпический",
        lootbox_pool_code="epic",
    )
    lootbox_legendary = _get_or_create_item(
        db, "lootbox_legendary",
        name="Легендарный ковбокс",
        icon="/static/img/items/lootbox_legendary.svg",
        category="Ковбоксы",
        rarity="Легендарный",
        lootbox_pool_code="legendary",
    )
    fragment = _get_or_create_item(
        db, "box_fragment",
        name="Фрагмент ковбокса",
        icon="/static/img/items/box_fragment.svg",
        category="Ресурсы",
        rarity="Обычный",
    )
    fragment.description = ""
    for item in (lootbox_common, lootbox_rare, lootbox_epic, lootbox_legendary):
        item.description = ""
    seeded_lootbox_items = {
        "common": lootbox_common,
        "rare": lootbox_rare,
        "epic": lootbox_epic,
        "legendary": lootbox_legendary,
    }
    for code, lootbox_item in seeded_lootbox_items.items():
        lootbox_item.lootbox_pool_code = code
        lootbox_item.category = "Ковбоксы"
    db.flush()

    # Seed lootbox pools
    def _fill_pool(code: str) -> models.LootboxPool:
        pool = db.query(models.LootboxPool).filter(models.LootboxPool.code == code).first()
        if pool:
            return pool
        pool = models.LootboxPool(code=code, name=code.capitalize())
        db.add(pool)
        db.flush()
        return pool

    pools = {
        "common": _fill_pool("common"),
        "rare": _fill_pool("rare"),
        "epic": _fill_pool("epic"),
        "legendary": _fill_pool("legendary"),
    }
    default_pool_rewards = {
        "common": (("kovbucks", 1, 3, 70), ("xp", 5, 10, 30)),
        "rare": (("kovbucks", 3, 6, 65), ("xp", 10, 20, 35)),
        "epic": (("kovbucks", 6, 12, 60), ("xp", 20, 40, 40)),
        "legendary": (("kovbucks", 12, 25, 55), ("xp", 40, 80, 45)),
    }
    for code, pool in pools.items():
        if not pool.entries:
            for order, (kind, amount_min, amount_max, weight) in enumerate(default_pool_rewards[code]):
                pool.entries.append(models.LootboxPoolEntry(
                    reward_kind=kind,
                    item_id=None,
                    amount_min=amount_min,
                    amount_max=amount_max,
                    weight=weight,
                    is_active=True,
                    sort_order=order,
                ))
    pool_defaults = {
        "common": ("Обычный", "/static/img/items/lootbox_common.svg"),
        "rare": ("Редкий", "/static/img/items/lootbox_rare.svg"),
        "epic": ("Эпический", "/static/img/items/lootbox_epic.svg"),
        "legendary": ("Легендарный", "/static/img/items/lootbox_legendary.svg"),
    }
    for code, pool in pools.items():
        item = seeded_lootbox_items.get(code)
        if item:
            needs_backfill = pool.item_id is None
            pool.item_id = item.id
            pool.description = ""
            if needs_backfill and (not pool.image_url or pool.image_url == "/static/img/items/lootbox_common.svg"):
                pool.image_url = item.icon
            if needs_backfill and (not pool.rarity or pool.rarity == "Обычный"):
                pool.rarity = pool_defaults[code][0]

    # Seed Battle Pass season
    if db.query(models.BattlePassSeason).count() == 0:
        season = models.BattlePassSeason(
            name="Сезон 1: Лето",
            theme="summer",
            xp_per_level=100,
            total_levels=30,
            is_active=True,
        )
        db.add(season)
        db.flush()

        # Free rewards — coins/xp/item/lootbox every few levels
        rewards: dict[int, tuple[str, int, str, str]] = {
            1: ("coins", 50, "50 монет", "/static/img/ui/coin.svg"),
            2: ("xp", 25, "25 опыта", "/static/img/ui/spark.svg"),
            3: ("lootbox", 1, "Обычный ковбокс", "/static/img/items/lootbox_common.svg"),
            4: ("coins", 75, "75 монет", "/static/img/ui/coin.svg"),
            5: ("xp", 50, "50 опыта", "/static/img/ui/spark.svg"),
            6: ("coins", 100, "100 монет", "/static/img/ui/coin.svg"),
            7: ("lootbox", 1, "Обычный ковбокс", "/static/img/items/lootbox_common.svg"),
            8: ("xp", 75, "75 опыта", "/static/img/ui/spark.svg"),
            9: ("coins", 150, "150 монет", "/static/img/ui/coin.svg"),
            10: ("lootbox", 1, "Редкий ковбокс", "/static/img/items/lootbox_rare.svg"),
            12: ("coins", 200, "200 монет", "/static/img/ui/coin.svg"),
            14: ("xp", 100, "100 опыта", "/static/img/ui/spark.svg"),
            15: ("lootbox", 1, "Редкий ковбокс", "/static/img/items/lootbox_rare.svg"),
            18: ("coins", 300, "300 монет", "/static/img/ui/coin.svg"),
            20: ("lootbox", 1, "Эпический ковбокс", "/static/img/items/lootbox_epic.svg"),
            22: ("xp", 150, "150 опыта", "/static/img/ui/spark.svg"),
            25: ("lootbox", 1, "Эпический ковбокс", "/static/img/items/lootbox_epic.svg"),
            28: ("coins", 500, "500 монет", "/static/img/ui/coin.svg"),
            30: ("lootbox", 1, "Легендарный ковбокс", "/static/img/items/lootbox_legendary.svg"),
        }

        for lvl, (kind, val, label, icon) in rewards.items():
            # Для наград-лутбоксов код предмета берётся из иконки
            # (lootbox_common/rare/epic/legendary), иначе клейм ничего не выдаёт.
            item_code = None
            if kind == "lootbox":
                item_code = icon.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            db.add(models.BattlePassReward(
                season_id=season.id, level=lvl, track="free",
                kind=kind, value=val, label=label, icon=icon, item_code=item_code,
            ))

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

    seed_wheel_prizes(db)

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
