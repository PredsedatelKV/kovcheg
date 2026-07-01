from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def now_utc() -> datetime:
    """Naive UTC datetime (tz-aware -> naive) to remove the deprecated datetime.utcnow()
    while staying consistent with the existing naive datetime columns/comparisons."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# Backwards-compatible alias used as column default throughout the models.
utcnow = now_utc


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    role: Mapped[str] = mapped_column(String(64), default="Гражданин")
    restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    xp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    wallet: Mapped[Wallet] = relationship("Wallet", back_populates="user", uselist=False, cascade="all, delete-orphan")
    inventory: Mapped[list[InventoryItem]] = relationship(
        "InventoryItem", back_populates="user", cascade="all, delete-orphan"
    )
    user_tasks: Mapped[list[UserTask]] = relationship(
        "UserTask", back_populates="user", cascade="all, delete-orphan"
    )


class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    balance: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[User] = relationship("User", back_populates="wallet")


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="📦")  # эмодзи или ключ ассета
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)  # фото товара (если загружено)
    rarity: Mapped[str] = mapped_column(String(32), default="Обычный")  # Обычный/Редкий/Эпический
    category: Mapped[str] = mapped_column(String(32), default="Ресурсы")  # Ресурсы/Ускорители/Декор/Другое
    can_gift: Mapped[bool] = mapped_column(Boolean, default=True)
    can_activate: Mapped[bool] = mapped_column(Boolean, default=False)
    lootbox_pool_code: Mapped[str | None] = mapped_column(String(64), nullable=True)  # bronze/silver/gold


class InventoryItem(Base):
    __tablename__ = "inventory"
    __table_args__ = (UniqueConstraint("user_id", "item_id", name="uq_user_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    user: Mapped[User] = relationship("User", back_populates="inventory")
    item: Mapped[Item] = relationship("Item")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="🪓")
    reward: Mapped[int] = mapped_column(Integer, default=10)
    target_progress: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_daily_plan: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    xp_reward: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class UserTask(Base):
    __tablename__ = "user_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="in_progress")  # in_progress/done/cancelled
    progress: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approved_by: Mapped[int | None] = mapped_column(Integer, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="user_tasks")
    task: Mapped[Task] = relationship("Task")


class ShopProduct(Base):
    __tablename__ = "shop_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    stock: Mapped[int] = mapped_column(Integer, default=-1, nullable=False)  # -1 = unlimited, 0 = sold out, >0 = remaining

    item: Mapped[Item] = relationship("Item")


class MarketListing(Base):
    __tablename__ = "market_listings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    target_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    seller: Mapped[User] = relationship("User", foreign_keys=[seller_id])
    target_user: Mapped["User | None"] = relationship("User", foreign_keys=[target_user_id])
    item: Mapped[Item] = relationship("Item")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    recipient_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WheelSpin(Base):
    __tablename__ = "wheel_spins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    prize_kind: Mapped[str] = mapped_column(String(32), default="coins")  # coins/item/nothing
    prize_value: Mapped[int] = mapped_column(Integer, default=0)
    prize_label: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Banner(Base):
    __tablename__ = "banners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    image_url: Mapped[str] = mapped_column(String(512), nullable=False)
    title: Mapped[str] = mapped_column(String(128), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class News(Base):
    __tablename__ = "news"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    image_url: Mapped[str] = mapped_column(String(512), default="")
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="")
    published_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class LegalText(Base):
    __tablename__ = "legal_texts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # constitution | laws
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WheelPrize(Base):
    __tablename__ = "wheel_prizes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), default="coins")  # coins | item
    value: Mapped[int] = mapped_column(Integer, default=0)
    item_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    icon: Mapped[str] = mapped_column(String(256), default="/static/img/ui/coin.svg")
    weight: Mapped[int] = mapped_column(Integer, default=10)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Quiz(Base):
    __tablename__ = "quizzes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    prize_kind: Mapped[str] = mapped_column(String(32), default="coins")  # coins | item
    prize_value: Mapped[int] = mapped_column(Integer, default=0)
    prize_item_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prize_label: Mapped[str] = mapped_column(String(128), default="")
    threshold_good: Mapped[int] = mapped_column(Integer, default=5)  # min correct for "good"
    threshold_excellent: Mapped[int] = mapped_column(Integer, default=8)  # min correct for "excellent"

    questions: Mapped[list["QuizQuestion"]] = relationship("QuizQuestion", back_populates="quiz", cascade="all, delete-orphan")
    attempts: Mapped[list["QuizAttempt"]] = relationship("QuizAttempt", back_populates="quiz", cascade="all, delete-orphan")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quiz_id: Mapped[int] = mapped_column(ForeignKey("quizzes.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    option_a: Mapped[str] = mapped_column(String(256), nullable=False)
    option_b: Mapped[str] = mapped_column(String(256), nullable=False)
    option_c: Mapped[str] = mapped_column(String(256), nullable=False)
    option_d: Mapped[str] = mapped_column(String(256), nullable=False)
    correct_option: Mapped[str] = mapped_column(String(1), nullable=False)  # a, b, c, d
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    quiz: Mapped["Quiz"] = relationship("Quiz", back_populates="questions")


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quiz_id: Mapped[int] = mapped_column(ForeignKey("quizzes.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    score: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    grade: Mapped[str] = mapped_column(String(16), default="bad")  # bad | good | excellent
    prize_awarded: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    quiz: Mapped["Quiz"] = relationship("Quiz", back_populates="attempts")
    user: Mapped["User"] = relationship("User")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(String(16), default="text")  # text | sticker
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped["User"] = relationship("User")


class GameInvite(Base):
    __tablename__ = "game_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    game: Mapped[str] = mapped_column(String(32), nullable=False)  # tictactoe, checkers, pingpong
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending, accepted, declined
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    from_user: Mapped["User"] = relationship("User", foreign_keys=[from_user_id])
    to_user: Mapped["User"] = relationship("User", foreign_keys=[to_user_id])


class GameSession(Base):
    __tablename__ = "game_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invite_id: Mapped[int] = mapped_column(ForeignKey("game_invites.id"), nullable=True)
    game: Mapped[str] = mapped_column(String(32), nullable=False)
    player_x_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    player_o_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    board: Mapped[str] = mapped_column(String(64), default="_________")  # 9 chars, _ = empty, X, O
    current_turn: Mapped[str] = mapped_column(String(1), default="X")  # X or O
    status: Mapped[str] = mapped_column(String(16), default="playing")  # playing, x_won, o_won, draw
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    state: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON для checkers/pong
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    player_x: Mapped["User"] = relationship("User", foreign_keys=[player_x_id])
    player_o: Mapped["User"] = relationship("User", foreign_keys=[player_o_id])


class BattlePassSeason(Base):
    __tablename__ = "battlepass_seasons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)  # "Сезон 1: Лето"
    theme: Mapped[str] = mapped_column(String(32), default="summer")  # summer/winter/...
    xp_per_level: Mapped[int] = mapped_column(Integer, default=100)
    total_levels: Mapped[int] = mapped_column(Integer, default=30)
    price_current: Mapped[int] = mapped_column(Integer, default=499)
    price_old: Mapped[int] = mapped_column(Integer, default=799)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    rewards: Mapped[list["BattlePassReward"]] = relationship("BattlePassReward", back_populates="season", cascade="all, delete-orphan")


class BattlePassReward(Base):
    __tablename__ = "battlepass_rewards"
    __table_args__ = (UniqueConstraint("season_id", "level", "track", name="uq_bp_reward"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("battlepass_seasons.id"), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    track: Mapped[str] = mapped_column(String(16), nullable=False)  # free | premium
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # coins | xp | item | lootbox
    value: Mapped[int] = mapped_column(Integer, default=0)
    item_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    label: Mapped[str] = mapped_column(String(128), default="")
    icon: Mapped[str] = mapped_column(String(256), default="")

    season: Mapped["BattlePassSeason"] = relationship("BattlePassSeason", back_populates="rewards")


class UserBattlePass(Base):
    __tablename__ = "user_battlepass"
    __table_args__ = (UniqueConstraint("user_id", "season_id", name="uq_user_season"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    season_id: Mapped[int] = mapped_column(ForeignKey("battlepass_seasons.id"), nullable=False)
    has_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    claimed_rewards: Mapped[str] = mapped_column(Text, default="[]")  # JSON [[level, track], ...]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LootboxPool(Base):
    """Пул призов для лутбокса (по code: bronze/silver/gold)."""
    __tablename__ = "lootbox_pools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)

    entries: Mapped[list["LootboxPoolEntry"]] = relationship("LootboxPoolEntry", back_populates="pool", cascade="all, delete-orphan")


class LootboxPoolEntry(Base):
    __tablename__ = "lootbox_pool_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pool_id: Mapped[int] = mapped_column(ForeignKey("lootbox_pools.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False)
    weight: Mapped[int] = mapped_column(Integer, default=10)

    pool: Mapped["LootboxPool"] = relationship("LootboxPool", back_populates="entries")
    item: Mapped["Item"] = relationship("Item")


class ClickerState(Base):
    """Состояние кликера для каждого пользователя."""
    __tablename__ = "clicker_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)

    # Уровни апгрейдов (0 = не куплен)
    lvl_click: Mapped[int] = mapped_column(Integer, default=0)      # сила клика
    lvl_passive: Mapped[int] = mapped_column(Integer, default=0)    # пассивный доход
    lvl_energy: Mapped[int] = mapped_column(Integer, default=0)     # макс энергия
    lvl_crit: Mapped[int] = mapped_column(Integer, default=0)       # крит шанс
    lvl_regen: Mapped[int] = mapped_column(Integer, default=0)      # скорость регена

    # Энергия — хранится как float чтобы аккуратно считать реген
    energy: Mapped[float] = mapped_column(default=100.0)
    last_sync: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    # Внутриигровая валюта — ковкойны (в ковбаксы выводятся отдельно)
    kovcoins: Mapped[int] = mapped_column(Integer, default=1)       # текущий баланс ковкойнов
    earned_today: Mapped[int] = mapped_column(Integer, default=0)   # заработано за текущие сутки (дневной лимит)

    # Прогресс игрока
    total_earned: Mapped[int] = mapped_column(Integer, default=0)   # суммарно заработано в кликере (уровни/ранги)

    # Анти-фрод (защита от автокликера): token-bucket + счётчик подозрительности
    tap_tokens: Mapped[float] = mapped_column(default=45.0)          # «токены» тапов, копятся со скоростью человека
    suspicion: Mapped[int] = mapped_column(Integer, default=0)       # накопленная подозрительность
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # временная блокировка тапов

    # Активные бусты (с дневным лимитом)
    turbo_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)          # турбо-режим до
    passive_boost_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # ускорение пассива до
    boost_date: Mapped[str] = mapped_column(String(16), default="")  # дата (UTC) для сброса дневных лимитов
    turbo_used: Mapped[int] = mapped_column(Integer, default=0)
    refill_used: Mapped[int] = mapped_column(Integer, default=0)
    passboost_used: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped["User"] = relationship("User")
