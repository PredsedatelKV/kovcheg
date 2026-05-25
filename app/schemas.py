from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None = None
    first_name: str
    last_name: str | None = None
    photo_url: str | None = None
    role: str
    restrictions: str | None = None
    balance: int
    xp: int = 0
    is_admin: bool = False


class PlayerOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None = None
    first_name: str
    role: str
    is_online: bool = False


class ItemOut(BaseModel):
    id: int
    code: str
    name: str
    description: str
    icon: str
    image_url: str | None = None
    rarity: str
    category: str
    can_gift: bool
    can_activate: bool
    lootbox_pool_code: str | None = None


class InventoryItemOut(BaseModel):
    id: int
    item: ItemOut
    quantity: int


class TaskOut(BaseModel):
    id: int
    name: str
    description: str
    icon: str
    reward: int
    target_progress: int
    is_daily_plan: bool


class UserTaskOut(BaseModel):
    id: int
    task: TaskOut
    status: str
    progress: int
    started_at: datetime
    finished_at: datetime | None = None


class AdminUserTaskOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    task: TaskOut
    status: str
    progress: int
    started_at: datetime
    finished_at: datetime | None = None


class BannerOut(BaseModel):
    id: int
    image_url: str
    title: str


class NewsOut(BaseModel):
    id: int
    image_url: str
    title: str
    body: str
    published_at: datetime


class HomePayload(BaseModel):
    user: UserOut
    server_time_msk: str
    banners: list[BannerOut]
    news: list[NewsOut] = []
    daily_plan: TaskOut | None = None
    tasks: list[TaskOut]
    user_tasks: list[UserTaskOut]
    channel_url: str


class ShopProductOut(BaseModel):
    id: int
    item: ItemOut
    price: int
    stock: int = -1  # -1 = unlimited


class MarketListingOut(BaseModel):
    id: int
    seller_id: int
    seller_name: str
    item: ItemOut
    quantity: int
    price: int
    target_user_id: int | None = None
    target_user_name: str | None = None


class BuyRequest(BaseModel):
    product_id: int


class ListRequest(BaseModel):
    item_id: int
    quantity: int = Field(ge=1)
    price: int = Field(ge=1)


class SellRequest(BaseModel):
    item_id: int
    recipient: str  # "uid:<id>" or username/tg_id
    quantity: int = Field(ge=1, default=1)
    price: int = Field(ge=1)


class BuyListingRequest(BaseModel):
    listing_id: int


class TransferRequest(BaseModel):
    recipient: str  # username or tg id
    amount: int = Field(ge=1)


class GiftRequest(BaseModel):
    recipient: str
    item_id: int
    quantity: int = Field(ge=1, default=1)


class SpinResult(BaseModel):
    prize_kind: str
    prize_value: int
    prize_label: str
    icon: str
    balance: int


class LegalTextOut(BaseModel):
    slug: str
    title: str
    body: str


class ProfilePayload(BaseModel):
    user: UserOut
    inventory: list[InventoryItemOut]
    user_tasks: list[UserTaskOut]
    daily_plan: TaskOut | None = None


class KovernaPayload(BaseModel):
    shop_products: list[ShopProductOut]
    market_listings: list[MarketListingOut]
    my_listings: list[MarketListingOut]
    inventory: list[InventoryItemOut]


# ----- Admin DTOs -----

class AdminUserOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None = None
    first_name: str
    last_name: str | None = None
    role: str
    restrictions: str | None = None
    balance: int
    xp: int = 0
    is_admin: bool = False


class AdminUserUpdate(BaseModel):
    first_name: str | None = None
    role: str | None = None
    restrictions: str | None = None


class AdminBalanceUpdate(BaseModel):
    delta: int
    note: str | None = None
    mode: str = "add"  # "add", "sub", "set"


class AdminInventoryUpdate(BaseModel):
    item_id: int
    delta: int  # positive to add, negative to remove


class AdminItemBody(BaseModel):
    code: str
    name: str
    description: str = ""
    icon: str = "/static/img/ui/box.svg"
    image_url: str | None = None
    rarity: str = "Обычный"
    category: str = "Ресурсы"
    can_gift: bool = True
    can_activate: bool = False


class AdminNewsBody(BaseModel):
    image_url: str = ""
    title: str
    body: str = ""
    is_active: bool = True


class AdminBannerBody(BaseModel):
    image_url: str
    title: str = ""
    sort_order: int = 0
    is_active: bool = True


class AdminTaskBody(BaseModel):
    name: str
    description: str = ""
    icon: str = "/static/img/tasks/scroll.svg"
    reward: int = 10
    target_progress: int = 1
    is_active: bool = True
    is_daily_plan: bool = False
    sort_order: int = 0


class AdminShopProductBody(BaseModel):
    item_id: int
    price: int = Field(ge=0)
    is_active: bool = True
    stock: int = -1  # -1 = unlimited (default)


class AdminMarketListingBody(BaseModel):
    seller_id: int
    item_id: int
    quantity: int = Field(ge=1)
    price: int = Field(ge=1)
    is_active: bool = True


class AdminWheelPrizeBody(BaseModel):
    label: str
    kind: str = "coins"  # coins | item
    value: int = 0
    item_code: str | None = None
    icon: str = "/static/img/ui/coin.svg"
    weight: int = Field(ge=1, default=10)
    sort_order: int = 0
    is_active: bool = True


class AdminLegalBody(BaseModel):
    title: str
    body: str


class WheelPrizeOut(BaseModel):
    id: int
    label: str
    kind: str
    value: int
    item_code: str | None = None
    icon: str
    weight: int
    sort_order: int
    is_active: bool


class AdminMeta(BaseModel):
    items: list[ItemOut]
    users: list[AdminUserOut]


# ----- Quiz DTOs -----

class QuizQuestionOut(BaseModel):
    id: int
    quiz_id: int
    text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_option: str
    sort_order: int


class QuizQuestionBody(BaseModel):
    text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_option: str
    sort_order: int = 0


class QuizOut(BaseModel):
    id: int
    title: str
    description: str
    is_active: bool
    prize_kind: str
    prize_value: int
    prize_item_code: str | None = None
    prize_label: str
    threshold_good: int
    threshold_excellent: int
    questions: list[QuizQuestionOut] = []


class QuizBody(BaseModel):
    title: str
    description: str = ""
    is_active: bool = True
    prize_kind: str = "coins"
    prize_value: int = 0
    prize_item_code: str | None = None
    prize_label: str = ""
    threshold_good: int = 5
    threshold_excellent: int = 8


class QuizAttemptOut(BaseModel):
    id: int
    quiz_id: int
    user_id: int
    score: int
    total: int
    grade: str
    prize_awarded: bool
    created_at: datetime


class QuizForUser(BaseModel):
    id: int
    title: str
    description: str
    prize_label: str
    question_count: int
    already_passed: bool


class QuizQuestionForUser(BaseModel):
    id: int
    text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str


class QuizSubmitRequest(BaseModel):
    quiz_id: int
    answers: dict[int, str]  # question_id -> option letter (a/b/c/d)


class QuizResultOut(BaseModel):
    score: int
    total: int
    grade: str
    grade_label: str
    prize_label: str
    prize_awarded: bool


class ChatMessageOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    content: str
    message_type: str
    created_at: datetime
    created_at_msk: str | None = None


class ChatSendRequest(BaseModel):
    content: str
    message_type: str = "text"  # text | sticker


class GameInviteRequest(BaseModel):
    game: str  # tictactoe, checkers, pingpong
    to_user_id: int


class GameInviteAction(BaseModel):
    invite_id: int


class TransactionOut(BaseModel):
    id: int
    sender_id: int | None = None
    sender_name: str | None = None
    recipient_id: int | None = None
    recipient_name: str | None = None
    amount: int
    note: str | None = None
    created_at: datetime


class BattlePassRewardOut(BaseModel):
    id: int = 0
    level: int = 0
    kind: str = ""
    value: int = 0
    item_code: str | None = None
    label: str = ""
    icon: str = ""
    claimed: bool = False


class ClaimRewardRequest(BaseModel):
    level: int


class BattlePassSeasonOut(BaseModel):
    id: int
    name: str
    theme: str
    xp_per_level: int
    total_levels: int
    is_active: bool
    rewards: list[BattlePassRewardOut] = []


class UserBattlePassOut(BaseModel):
    season: BattlePassSeasonOut
    current_level: int
    current_xp: int
    xp_for_level: int
    claimed_rewards: list[list]


class OpenLootboxRequest(BaseModel):
    item_id: int


class LootboxOpenResult(BaseModel):
    item: ItemOut
    quantity: int


class AwardXpRequest(BaseModel):
    user_id: int | None = None  # None = текущий
    amount: int
    reason: str = ""
    mode: str = "add"  # "add", "sub", "set"
