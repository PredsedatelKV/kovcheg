from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# The client receives this value through ProfilePayload and never chooses how
# many fragments the server consumes.
LOOTBOX_FRAGMENT_COST = 10
FAILURE_FRAGMENT_COST = 10


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
    login_gifts: Mapped[list["PendingLoginGift"]] = relationship(
        "PendingLoginGift",
        foreign_keys="PendingLoginGift.user_id",
        cascade="all, delete-orphan",
    )


class PendingLoginGift(Base):
    """Admin-configured reward delivered once on the user's next app load."""

    __tablename__ = "pending_login_gifts"
    __table_args__ = (
        CheckConstraint("kovbucks >= 0", name="ck_login_gift_kovbucks_nonnegative"),
        CheckConstraint("xp >= 0", name="ck_login_gift_xp_nonnegative"),
        CheckConstraint("item_quantity >= 0", name="ck_login_gift_item_quantity_nonnegative"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    kovbucks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    xp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    item_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    item: Mapped["Item | None"] = relationship("Item")


class WebLoginRequest(Base):
    """One-time browser login confirmation, approved by the Telegram bot."""

    __tablename__ = "web_login_requests"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class WebSession(Base):
    """Persistent, revocable browser session. Only a SHA-256 token digest is stored."""

    __tablename__ = "web_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class IdempotencyReceipt(Base):
    """Durable guard for one client-issued critical game mutation."""

    __tablename__ = "idempotency_receipts"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    method: Mapped[str] = mapped_column(String(8), nullable=False)
    path: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="processing", nullable=False)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    response_content_type: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TelegramUpdateReceipt(Base):
    """Telegram update IDs are globally unique and must be processed once."""

    __tablename__ = "telegram_update_receipts"

    update_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="processing", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_wallet_balance_nonnegative"),)

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


class ItemCategory(Base):
    """Admin-managed catalogue used by item editors and shop filters.

    ``Item.category`` intentionally stays a string for backwards compatibility
    with existing inventories and API payloads.  All new admin writes are
    validated against this dictionary.
    """

    __tablename__ = "item_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class InventoryItem(Base):
    __tablename__ = "inventory"
    __table_args__ = (
        UniqueConstraint("user_id", "item_id", name="uq_user_item"),
        CheckConstraint("quantity >= 0", name="ck_inventory_quantity_nonnegative"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    user: Mapped[User] = relationship("User", back_populates="inventory")
    item: Mapped[Item] = relationship("Item")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("reward >= 0", name="ck_task_kovbucks_nonnegative"),
        CheckConstraint("xp_reward >= 0", name="ck_task_xp_nonnegative"),
        CheckConstraint("reward_item_quantity >= 0", name="ck_task_item_quantity_nonnegative"),
    )

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
    reward_item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    reward_item_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    reward_item: Mapped[Item | None] = relationship("Item")


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
    icon: Mapped[str] = mapped_column(String(256), default="/static/img/ui/kovbaks.png")
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
    __table_args__ = (UniqueConstraint("quiz_id", "user_id", name="uq_quiz_attempt_user"),)

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


class QuizRun(Base):
    """Short-lived, single-use proof that a user actually opened a quiz."""

    __tablename__ = "quiz_runs"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    quiz_id: Mapped[int] = mapped_column(ForeignKey("quizzes.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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


class BattlePassClaim(Base):
    """One immutable claim fact per concrete reward and user."""
    __tablename__ = "battlepass_claims"
    __table_args__ = (UniqueConstraint("user_id", "reward_id", name="uq_bp_claim_reward"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    reward_id: Mapped[int] = mapped_column(ForeignKey("battlepass_rewards.id"), nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class LootboxPool(Base):
    """Server-owned configuration for one type of Kovbox.

    Existing inventory stacks point to an ``Item``.  ``item_id`` connects that
    item to this mutable configuration; archiving therefore stops new drops
    without invalidating boxes which players already own.
    """
    __tablename__ = "lootbox_pools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    rarity: Mapped[str] = mapped_column(String(32), default="Обычный", nullable=False)
    image_url: Mapped[str] = mapped_column(String(512), default="/static/img/items/lootbox_common.svg", nullable=False)
    open_image_url: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    opening_mode: Mapped[str] = mapped_column(String(16), default="legacy_v1", nullable=False)
    bonus_item_chance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_droppable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    assembly_weight: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    sale_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sale_currency: Mapped[str] = mapped_column(String(16), default="kovbucks", nullable=False)
    min_user_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_user_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    daily_open_limit: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    guaranteed_slots: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    allow_duplicates: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    entries: Mapped[list["LootboxPoolEntry"]] = relationship("LootboxPoolEntry", back_populates="pool", cascade="all, delete-orphan")
    item: Mapped["Item | None"] = relationship("Item")


class LootboxPoolEntry(Base):
    __tablename__ = "lootbox_pool_entries"
    __table_args__ = (
        CheckConstraint("weight > 0", name="ck_lootbox_entry_weight_positive"),
        CheckConstraint("amount_min > 0", name="ck_lootbox_entry_amount_min_positive"),
        CheckConstraint("amount_max >= amount_min", name="ck_lootbox_entry_amount_range"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pool_id: Mapped[int] = mapped_column(ForeignKey("lootbox_pools.id"), nullable=False)
    reward_kind: Mapped[str] = mapped_column(String(16), default="item", nullable=False)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    amount_min: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    amount_max: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    weight: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    is_guaranteed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    pool: Mapped["LootboxPool"] = relationship("LootboxPool", back_populates="entries")
    item: Mapped["Item | None"] = relationship("Item")


class LootboxOpen(Base):
    """Immutable, idempotent audit fact for consuming one Kovbox."""

    __tablename__ = "lootbox_opens"
    __table_args__ = (UniqueConstraint("user_id", "request_id", name="uq_lootbox_open_request"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    lootbox_item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False)
    pool_id: Mapped[int] = mapped_column(ForeignKey("lootbox_pools.id"), nullable=False)
    pool_version: Mapped[int] = mapped_column(Integer, nullable=False)
    pool_code_snapshot: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    pool_name_snapshot: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    pool_rarity_snapshot: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    pool_image_snapshot: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    pool_open_image_snapshot: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    choice_plan: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    choice_selection: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True, nullable=False)

    rewards: Mapped[list["LootboxOpenReward"]] = relationship(
        "LootboxOpenReward",
        back_populates="opening",
        cascade="all, delete-orphan",
        order_by="LootboxOpenReward.reveal_order",
    )
    pool: Mapped["LootboxPool"] = relationship("LootboxPool")
    lootbox_item: Mapped["Item"] = relationship("Item", foreign_keys=[lootbox_item_id])


class LootboxOpenReward(Base):
    """The exact rewards granted by a recorded Kovbox opening."""

    __tablename__ = "lootbox_open_rewards"
    __table_args__ = (
        UniqueConstraint("opening_id", "reveal_order", name="uq_lootbox_open_reward_order"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    opening_id: Mapped[int] = mapped_column(ForeignKey("lootbox_opens.id"), index=True, nullable=False)
    reward_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    reveal_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    presentation_kind: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    label_snapshot: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    icon_snapshot: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    rarity_snapshot: Mapped[str] = mapped_column(String(32), default="", nullable=False)

    opening: Mapped["LootboxOpen"] = relationship("LootboxOpen", back_populates="rewards")
    item: Mapped["Item | None"] = relationship("Item")


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
    progression_day: Mapped[int] = mapped_column(Integer, default=0)
    progression_date: Mapped[str] = mapped_column(String(10), default="")
    passive_fraction: Mapped[float] = mapped_column(default=0.0)
    tap_fraction: Mapped[float] = mapped_column(default=0.0)
    passive_earned_today: Mapped[int] = mapped_column(Integer, default=0)

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


class DailyReward(Base):
    """Tracks daily reward streak for each user."""
    __tablename__ = "daily_rewards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    streak: Mapped[int] = mapped_column(Integer, default=0)
    last_claim_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD


class ArcadeFirstWin(Base):
    """Tracks first win of the day per mini-game per user."""
    __tablename__ = "arcade_first_wins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    game: Mapped[str] = mapped_column(String(32), nullable=False)  # clicker, dice, slots, etc.
    win_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD

    __table_args__ = (UniqueConstraint("user_id", "game", "win_date", name="uq_arcade_first_win"),)


class ArcadeRound(Base):
    """Server-issued, single-use proof that a mini-game was actually started."""
    __tablename__ = "arcade_rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    game: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CasinoRound(Base):
    """A casino bet and its outcome, generated and settled by the server."""
    __tablename__ = "casino_rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    game: Mapped[str] = mapped_column(String(16), nullable=False)
    bet: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    payout: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    settled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
