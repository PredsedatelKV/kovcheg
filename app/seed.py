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


def seed(db: Session) -> None:
    # Items
    apples = _get_or_create_item(db, "apples", name="Ящик яблок", icon="🍎", description="Свежие яблоки из садов Ковчега.")
    logs = _get_or_create_item(db, "logs", name="Связка брёвен", icon="🪵", description="Древесина для строительства.")
    stone = _get_or_create_item(db, "stone", name="Камень", icon="🪨", description="Базовый строительный материал.")
    wheat = _get_or_create_item(db, "wheat", name="Пшеница", icon="🌾", description="Зерно для запасов.")
    iron = _get_or_create_item(db, "iron_ore", name="Железная руда", icon="⛏️", description="Сырьё для кузницы.", rarity="Редкий")
    booster = _get_or_create_item(
        db,
        "booster_1h",
        name="Ускорение 1ч",
        icon="⏳",
        description="Ускоряет выполнение задания на 1 час.",
        category="Ускорители",
        can_activate=True,
    )
    house = _get_or_create_item(
        db,
        "plot_5x5",
        name="Участок 5×5",
        icon="🏡",
        description="Свободный участок для застройки.",
        category="Декор",
        rarity="Редкий",
    )
    chest = _get_or_create_item(
        db,
        "builders_chest",
        name="Сундук строителя",
        icon="🧰",
        description="Стартовый набор инструментов.",
        category="Декор",
    )
    scroll = _get_or_create_item(
        db,
        "exp_scroll",
        name="Свиток опыта",
        icon="📜",
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
            "icon": "⛏️",
            "reward": 25,
            "target_progress": 80,
            "is_daily_plan": False,
            "sort_order": 1,
        },
        {
            "name": "Помощь жителям",
            "description": "Помогите соседям с их делами: посадите дерево, наколите дров или принесите воды.",
            "icon": "🧰",
            "reward": 30,
            "target_progress": 1,
            "is_daily_plan": False,
            "sort_order": 2,
        },
        {
            "name": "Защита поселения",
            "description": "Постойте на страже у врат Ковчега — отчитайтесь о смене в боте.",
            "icon": "🛡️",
            "reward": 20,
            "target_progress": 1,
            "is_daily_plan": False,
            "sort_order": 3,
        },
        {
            "name": "Посади 10 деревьев",
            "description": "Внесите вклад в развитие поселения — посадите 10 деревьев в лесу или на свободных участках.",
            "icon": "🌳",
            "reward": 25,
            "target_progress": 10,
            "is_daily_plan": False,
            "sort_order": 4,
        },
        {
            "name": "Добыть 50 камня",
            "description": "Соберите 50 единиц камня для строительства главного зала.",
            "icon": "🪨",
            "reward": 30,
            "target_progress": 50,
            "is_daily_plan": False,
            "sort_order": 5,
        },
        {
            "name": "Ежедневный план",
            "description": "Выполняйте задания каждый день и становитесь сильнее. Этот план обязателен для всех жителей Ковчега.",
            "icon": "📜",
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
    if not db.query(models.News).first():
        db.add(
            models.News(
                image_url="https://picsum.photos/seed/kovcheg-news/700/500",
                title="Новый сезон уже начался!",
                body="Исследуйте новые земли, выполняйте задания и получайте награды.",
            )
        )

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
