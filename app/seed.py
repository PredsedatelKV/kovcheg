from __future__ import annotations

from sqlalchemy.orm import Session

from app import models


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
    )
    db.add(item)
    db.flush()
    return item


# Icons for existing rows are migrated to file paths on every startup so a
# user can drop new SVG/PNG files into static/img/* without touching the DB.
ITEM_ICON_BY_CODE: dict[str, str] = {
    "apples": "/static/img/items/apples.svg",
    "logs": "/static/img/items/logs.svg",
    "stone": "/static/img/items/stone.svg",
    "wheat": "/static/img/items/wheat.svg",
    "iron_ore": "/static/img/items/iron_ore.svg",
    "booster_1h": "/static/img/items/booster_1h.svg",
    "plot_5x5": "/static/img/items/plot_5x5.svg",
    "builders_chest": "/static/img/items/builders_chest.svg",
    "exp_scroll": "/static/img/items/exp_scroll.svg",
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


PLAYERS: list[dict] = [
    {
        "telegram_id": 10001,
        "username": "omarbutuev",
        "first_name": "Омар",
        "role": "Председатель",
    },
    {
        "telegram_id": 10002,
        "username": "magomet",
        "first_name": "Магомет",
        "role": "Гражданин",
    },
    {
        "telegram_id": 10003,
        "username": "ibragim",
        "first_name": "Ибрагим",
        "role": "Гражданин",
    },
]


def seed_players(db: Session) -> None:
    """Seed the three fixed citizens (Омар / Магомет / Ибрагим) and remove legacy 'Dev' user."""
    legacy_dev = db.query(models.User).filter(models.User.telegram_id == 1).one_or_none()
    if legacy_dev is not None:
        db.query(models.MarketListing).filter(models.MarketListing.seller_id == legacy_dev.id).delete()
        db.query(models.Transaction).filter(
            (models.Transaction.sender_id == legacy_dev.id) | (models.Transaction.recipient_id == legacy_dev.id)
        ).delete()
        db.query(models.WheelSpin).filter(models.WheelSpin.user_id == legacy_dev.id).delete()
        db.delete(legacy_dev)
        db.flush()
    for spec in PLAYERS:
        user = db.query(models.User).filter(models.User.telegram_id == spec["telegram_id"]).one_or_none()
        if user is None:
            user = models.User(
                telegram_id=spec["telegram_id"],
                username=spec["username"],
                first_name=spec["first_name"],
                role=spec["role"],
            )
            db.add(user)
            db.flush()
            db.add(models.Wallet(user_id=user.id, balance=0))
        else:
            user.username = spec["username"]
            if not user.first_name:
                user.first_name = spec["first_name"]
            if not user.role or user.role == "Гражданин" and spec["role"] != "Гражданин":
                user.role = spec["role"]
            if user.wallet is None:
                db.add(models.Wallet(user_id=user.id, balance=0))


WHEEL_PRIZES: list[dict] = [
    {"label": "50 монет", "kind": "coins", "value": 50, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 25, "sort_order": 0},
    {"label": "Сундук", "kind": "item", "value": 0, "item_code": "builders_chest", "icon": "/static/img/items/builders_chest.svg", "weight": 8, "sort_order": 1},
    {"label": "25 монет", "kind": "coins", "value": 25, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 30, "sort_order": 2},
    {"label": "200 монет", "kind": "coins", "value": 200, "item_code": None, "icon": "/static/img/ui/money_bag.svg", "weight": 5, "sort_order": 3},
    {"label": "50 монет", "kind": "coins", "value": 50, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 20, "sort_order": 4},
    {"label": "Ускоритель", "kind": "item", "value": 0, "item_code": "booster_1h", "icon": "/static/img/items/booster_1h.svg", "weight": 6, "sort_order": 5},
    {"label": "10 монет", "kind": "coins", "value": 10, "item_code": None, "icon": "/static/img/ui/coin.svg", "weight": 30, "sort_order": 6},
    {"label": "Свиток опыта", "kind": "item", "value": 0, "item_code": "exp_scroll", "icon": "/static/img/items/exp_scroll.svg", "weight": 6, "sort_order": 7},
]


def seed_wheel_prizes(db: Session) -> None:
    if db.query(models.WheelPrize).count() == 0:
        for spec in WHEEL_PRIZES:
            db.add(models.WheelPrize(**spec, is_active=True))


def seed(db: Session) -> None:
    seed_players(db)
    # Items
    apples = _get_or_create_item(
        db,
        "apples",
        name="Ящик яблок",
        icon="/static/img/items/apples.svg",
        description="Свежие яблоки из садов Ковчега.",
    )
    logs = _get_or_create_item(
        db,
        "logs",
        name="Связка брёвен",
        icon="/static/img/items/logs.svg",
        description="Древесина для строительства.",
    )
    stone = _get_or_create_item(
        db,
        "stone",
        name="Камень",
        icon="/static/img/items/stone.svg",
        description="Базовый строительный материал.",
    )
    wheat = _get_or_create_item(
        db,
        "wheat",
        name="Пшеница",
        icon="/static/img/items/wheat.svg",
        description="Зерно для запасов.",
    )
    iron = _get_or_create_item(
        db,
        "iron_ore",
        name="Железная руда",
        icon="/static/img/items/iron_ore.svg",
        description="Сырьё для кузницы.",
        rarity="Редкий",
    )
    booster = _get_or_create_item(
        db,
        "booster_1h",
        name="Ускорение 1ч",
        icon="/static/img/items/booster_1h.svg",
        description="Ускоряет выполнение задания на 1 час.",
        category="Ускорители",
        can_activate=True,
    )
    house = _get_or_create_item(
        db,
        "plot_5x5",
        name="Участок 5×5",
        icon="/static/img/items/plot_5x5.svg",
        description="Свободный участок для застройки.",
        category="Декор",
        rarity="Редкий",
    )
    chest = _get_or_create_item(
        db,
        "builders_chest",
        name="Сундук строителя",
        icon="/static/img/items/builders_chest.svg",
        description="Стартовый набор инструментов.",
        category="Декор",
    )
    scroll = _get_or_create_item(
        db,
        "exp_scroll",
        name="Свиток опыта",
        icon="/static/img/items/exp_scroll.svg",
        description="Даёт небольшой буст опыта.",
        category="Ускорители",
        rarity="Редкий",
        can_activate=True,
    )

    # Shop products
    shop_lines = [
        (apples, 100),
        (logs, 80),
        (stone, 50),
        (wheat, 70),
        (iron, 120),
        (booster, 150),
        (house, 800),
        (chest, 200),
        (scroll, 220),
    ]
    for item, price in shop_lines:
        existing = (
            db.query(models.ShopProduct)
            .filter(models.ShopProduct.item_id == item.id, models.ShopProduct.is_active.is_(True))
            .one_or_none()
        )
        if existing is None:
            db.add(models.ShopProduct(item_id=item.id, price=price, is_active=True))

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
            "Теперь на рынке можно выставлять любые предметы из инвентаря — и сразу получать монеты после продажи.",
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
    seed_wheel_prizes(db)
