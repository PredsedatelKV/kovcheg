from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, StrictBool, StrictInt, model_validator


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
    level: int = 1
    is_admin: bool = False
    can_use_clicker: bool = False
    maintenance_sections: list[str] = []


class PlayerOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None = None
    first_name: str
    role: str
    photo_url: str | None = None
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
    lootbox_reward_tier: Literal["normal", "special", "super_special"] = "normal"
    skin_slot: str | None = None


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
    xp_reward: int = 0
    reward_item_id: int | None = None
    reward_item_name: str | None = None
    reward_item_icon: str | None = None
    reward_item_quantity: int = 0
    target_progress: int
    is_daily_plan: bool


class UserTaskOut(BaseModel):
    id: int
    task: TaskOut
    status: str
    progress: int
    started_at: datetime
    finished_at: datetime | None = None
    xp_to_coins: int = 0


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
    server_epoch_ms: int
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
    is_active: bool = True


class BuyRequest(BaseModel):
    product_id: StrictInt = Field(gt=0)


class ShopRestockRequestCreate(BaseModel):
    text: str = Field(min_length=1, max_length=30)


class ShopRestockRequestAdminOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    text: str
    request_date: str
    created_at: datetime


class ListRequest(BaseModel):
    item_id: StrictInt = Field(gt=0)
    quantity: StrictInt = Field(ge=1, le=1_000_000)
    price: StrictInt = Field(ge=1, le=1_000_000_000)


class SellRequest(BaseModel):
    item_id: StrictInt = Field(gt=0)
    recipient: str = Field(min_length=1, max_length=128)  # "uid:<id>" or username/tg_id
    quantity: StrictInt = Field(ge=1, le=1_000_000, default=1)
    price: StrictInt = Field(ge=1, le=1_000_000_000)


class BuyListingRequest(BaseModel):
    listing_id: StrictInt = Field(gt=0)


class TransferRequest(BaseModel):
    recipient: str = Field(min_length=1, max_length=128)  # username or tg id
    amount: StrictInt = Field(ge=1, le=1_000_000_000)


class GiftRequest(BaseModel):
    recipient: str = Field(default="", max_length=128)
    item_id: StrictInt = Field(gt=0)
    quantity: StrictInt = Field(ge=1, le=1_000_000, default=1)


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


class LoginGiftOut(BaseModel):
    id: int
    kovbucks: int = 0
    xp: int = 0
    item_id: int | None = None
    item_name: str | None = None
    item_icon: str | None = None
    item_quantity: int = 0
    delivered_at: datetime | None = None


class LoginGiftClaimOut(BaseModel):
    user: UserOut
    gifts: list[LoginGiftOut] = Field(default_factory=list)


class SkinLoadoutOut(BaseModel):
    head: str | None = None
    torso: str | None = None
    legs: str | None = None
    feet: str | None = None


class SkinEquipRequest(BaseModel):
    item_id: StrictInt = Field(ge=1)
    slot: Literal["head", "torso", "legs", "feet"]


class SkinUnequipRequest(BaseModel):
    slot: Literal["head", "torso", "legs", "feet"]


class ProfilePayload(BaseModel):
    user: UserOut
    bp_level: int = 0
    fragment_assembly_cost: int = 10
    failure_fragment_cost: int = 10
    inventory: list[InventoryItemOut]
    skin_inventory: list[InventoryItemOut] = Field(default_factory=list)
    user_tasks: list[UserTaskOut]
    daily_plan: TaskOut | None = None
    login_gifts: list[LoginGiftOut] = Field(default_factory=list)
    skin_loadout: SkinLoadoutOut = Field(default_factory=SkinLoadoutOut)


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
    level: int = 1
    is_admin: bool = False
    pending_login_gifts: int = 0


class AdminLoginGiftBody(BaseModel):
    kovbucks: StrictInt = Field(default=0, ge=0, le=1_000_000_000)
    xp: StrictInt = Field(default=0, ge=0, le=1_000_000)
    item_id: StrictInt | None = Field(default=None, gt=0)
    item_quantity: StrictInt = Field(default=0, ge=0, le=1_000_000)

    @model_validator(mode="after")
    def validate_reward(self):
        if self.item_id is None and self.item_quantity != 0:
            raise ValueError("Количество предмета допустимо только при выбранном предмете")
        if self.item_id is not None and self.item_quantity < 1:
            raise ValueError("Укажите количество выбранного предмета")
        if self.kovbucks == 0 and self.xp == 0 and self.item_id is None:
            raise ValueError("Выберите хотя бы одну награду")
        return self


class AdminUserUpdate(BaseModel):
    first_name: str | None = None
    role: str | None = None
    restrictions: str | None = None


class AdminBalanceUpdate(BaseModel):
    delta: StrictInt = Field(ge=0, le=2_000_000_000)
    note: str | None = Field(default=None, max_length=256)
    mode: Literal["add", "sub", "set"] = "add"


class AdminInventoryUpdate(BaseModel):
    item_id: StrictInt = Field(gt=0)
    delta: StrictInt = Field(ge=-1_000_000, le=1_000_000)

    @model_validator(mode="after")
    def validate_delta(self):
        if self.delta == 0:
            raise ValueError("Изменение количества не может быть нулевым")
        return self


class AdminItemBody(BaseModel):
    code: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=128)
    icon: str = Field(default="/static/img/ui/box.svg", max_length=512)
    image_url: str | None = Field(default=None, max_length=512)
    rarity: str = Field(default="Обычный", min_length=1, max_length=32)
    category: str = Field(default="Ресурсы", min_length=1, max_length=32)
    can_gift: bool = True
    can_activate: bool = False
    lootbox_reward_tier: Literal["normal", "special", "super_special"] = "normal"
    skin_slot: Literal["head", "torso", "legs", "feet"] | None = None

class ItemCategoryOut(BaseModel):
    id: int
    name: str
    sort_order: int


class AdminItemCategoryBody(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    sort_order: StrictInt = Field(default=0, ge=-100_000, le=100_000)


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
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=4000)
    icon: str = "/static/img/tasks/scroll.svg"
    reward: StrictInt = Field(default=10, ge=0, le=1_000_000)
    xp_reward: StrictInt = Field(default=0, ge=0, le=1_000_000)
    reward_item_id: StrictInt | None = Field(default=None, gt=0)
    reward_item_quantity: StrictInt = Field(default=0, ge=0, le=1_000_000)
    target_progress: StrictInt = Field(default=1, ge=1, le=1_000_000)
    is_active: bool = True
    is_daily_plan: bool = False
    sort_order: StrictInt = Field(default=0, ge=-100_000, le=100_000)

    @model_validator(mode="after")
    def validate_rewards(self):
        if self.reward_item_id is None and self.reward_item_quantity != 0:
            raise ValueError("Для предметной награды выберите предмет")
        if self.reward_item_id is not None and self.reward_item_quantity < 1:
            raise ValueError("Количество предметов должно быть не меньше 1")
        if self.reward == 0 and self.xp_reward == 0 and self.reward_item_id is None:
            raise ValueError("У задания должна быть хотя бы одна награда")
        return self


class AdminShopProductBody(BaseModel):
    item_id: StrictInt = Field(gt=0)
    price: StrictInt = Field(ge=1, le=1_000_000_000)
    is_active: bool = True
    stock: StrictInt = Field(default=-1, ge=-1, le=1_000_000)


class AdminMarketListingBody(BaseModel):
    seller_id: StrictInt = Field(gt=0)
    item_id: StrictInt = Field(gt=0)
    quantity: StrictInt = Field(ge=1, le=1_000_000)
    price: StrictInt = Field(ge=1, le=2_000_000_000)
    is_active: bool = True


class AdminWheelPrizeBody(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    kind: Literal["coins", "xp", "item", "nothing"] = "coins"
    value: StrictInt = Field(default=0, ge=0, le=1_000_000)
    item_code: str | None = Field(default=None, max_length=64)
    # No icon input: it is derived from kind/item_code (see _helpers.prize_icon).
    # For the Wheel of Fortune this is a direct probability in percent, not a
    # relative weight.  Active sectors must add up to 100 on the server.
    weight: StrictInt = Field(ge=1, le=100, default=10)
    sort_order: StrictInt = Field(default=0, ge=-100_000, le=100_000)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_wheel_reward(self):
        if self.kind == "item" and not self.item_code:
            raise ValueError("Для предметного приза укажите item_code")
        if self.kind != "item" and self.item_code:
            raise ValueError("item_code допустим только для предметного приза")
        if self.kind == "nothing" and self.value != 0:
            raise ValueError("У пустого приза значение должно быть 0")
        if self.kind != "nothing" and self.value < 1:
            raise ValueError("Значение награды должно быть больше 0")
        return self


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
    categories: list[ItemCategoryOut] = Field(default_factory=list)


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
    text: str = Field(min_length=1, max_length=2000)
    option_a: str = Field(min_length=1, max_length=256)
    option_b: str = Field(min_length=1, max_length=256)
    option_c: str = Field(min_length=1, max_length=256)
    option_d: str = Field(min_length=1, max_length=256)
    correct_option: Literal["a", "b", "c", "d"]
    sort_order: StrictInt = Field(default=0, ge=-100_000, le=100_000)


class QuizReward(BaseModel):
    kind: Literal["xp", "kovbucks", "item"]
    amount: StrictInt = Field(default=1, ge=1, le=1_000_000)
    item_id: StrictInt | None = Field(default=None, gt=0)
    label: str = Field(default="", max_length=256)
    icon: str = Field(default="", max_length=512)

    @model_validator(mode="after")
    def validate_reward(self):
        if self.kind == "item" and self.item_id is None:
            raise ValueError("Для предметной награды выберите предмет")
        if self.kind != "item" and self.item_id is not None:
            raise ValueError("Предмет можно указывать только для предметной награды")
        return self


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
    time_limit_seconds: int = 0
    rewards_bad: list[QuizReward] = []
    rewards_good: list[QuizReward] = []
    rewards_excellent: list[QuizReward] = []
    questions: list[QuizQuestionOut] = []


class QuizBody(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=4000)
    is_active: bool = True
    prize_kind: Literal["coins", "item"] = "coins"
    prize_value: StrictInt = Field(default=0, ge=0, le=1_000_000)
    prize_item_code: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9_-]*$",
    )
    prize_label: str = Field(default="", max_length=128)
    threshold_good: StrictInt = Field(default=1, ge=1, le=1000)
    threshold_excellent: StrictInt = Field(default=1, ge=1, le=1000)
    time_limit_seconds: StrictInt = Field(default=0, ge=0, le=86_400)
    rewards_bad: list[QuizReward] = Field(default_factory=list, max_length=3)
    rewards_good: list[QuizReward] = Field(default_factory=list, max_length=3)
    rewards_excellent: list[QuizReward] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_quiz_config(self):
        if 0 < self.time_limit_seconds < 10:
            raise ValueError("Лимит времени должен быть не меньше 10 секунд")
        for rewards in (self.rewards_bad, self.rewards_good, self.rewards_excellent):
            kinds = [reward.kind for reward in rewards]
            if len(kinds) != len(set(kinds)):
                raise ValueError("Для каждой оценки можно выбрать каждый тип награды только один раз")
        return self


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
    time_limit_seconds: int = 0
    rewards_bad: list[QuizReward] = []
    rewards_good: list[QuizReward] = []
    rewards_excellent: list[QuizReward] = []


class QuizQuestionForUser(BaseModel):
    id: int
    text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str


class QuizStartOut(BaseModel):
    run_token: str
    questions: list[QuizQuestionForUser]
    time_limit_seconds: int = 0
    expires_at: datetime


class QuizSubmitRequest(BaseModel):
    quiz_id: StrictInt = Field(gt=0)
    run_token: str = Field(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    answers: dict[int, Literal["a", "b", "c", "d"]] = Field(max_length=1000)


class QuizResultOut(BaseModel):
    score: int
    total: int
    grade: str
    grade_label: str
    prize_label: str
    prize_awarded: bool
    xp_to_coins: int = 0
    rewards: list[QuizReward] = []


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


class ArcadeFirstWinClaim(BaseModel):
    """Server-verifiable result metadata for a first-win claim.

    Score and duration are optional for legacy mini-games, but the ping-pong
    endpoint requires all three fields and validates them against the
    server-issued round clock.  Strict integers keep values such as ``5.5`` or
    stringified numbers from being silently coerced into a plausible result.
    """

    game: str = Field(min_length=1, max_length=32)
    round_token: str = Field(min_length=1, max_length=128)
    player_score: StrictInt | None = Field(default=None, ge=0, le=100)
    opponent_score: StrictInt | None = Field(default=None, ge=0, le=100)
    duration_ms: StrictInt | None = Field(default=None, ge=0, le=7_200_000)


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
    level: StrictInt = Field(ge=1, le=1_000)


class AdminBattlePassSeasonBody(BaseModel):
    id: StrictInt | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=1, max_length=128)
    theme: str | None = Field(default=None, min_length=1, max_length=32)
    xp_per_level: StrictInt | None = Field(default=None, ge=1, le=1_000_000)
    total_levels: StrictInt | None = Field(default=None, ge=1, le=1_000)
    is_active: StrictBool | None = None


class AdminBattlePassRewardBody(BaseModel):
    id: StrictInt | None = Field(default=None, gt=0)
    season_id: StrictInt | None = Field(default=None, gt=0)
    level: StrictInt = Field(ge=1, le=1_000)
    kind: Literal["coins", "xp", "item", "lootbox"]
    value: StrictInt = Field(ge=1, le=1_000_000)
    item_code: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9_-]*$",
    )
    label: str = Field(default="", max_length=128)
    icon: str = Field(default="", max_length=256)

    @model_validator(mode="after")
    def validate_reward(self):
        item_reward = self.kind in {"item", "lootbox"}
        if item_reward and not self.item_code:
            raise ValueError("Для предметной награды укажите item_code")
        if not item_reward and self.item_code is not None:
            raise ValueError("item_code допустим только для предметной награды")
        return self


class AdminBattlePassSeedBody(BaseModel):
    name: str = Field(default="Новый сезон", min_length=1, max_length=128)
    theme: str = Field(default="summer", min_length=1, max_length=32)
    xp_per_level: StrictInt = Field(default=100, ge=1, le=1_000_000)
    total_levels: StrictInt = Field(default=100, ge=1, le=1_000)


class AdminBattlePassResetLevelBody(BaseModel):
    user_id: StrictInt = Field(gt=0)
    level: StrictInt = Field(ge=1, le=1_000)


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
    claimed_rewards: list[int]


class OpenLootboxRequest(BaseModel):
    item_id: StrictInt = Field(gt=0)
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ChooseLootboxRequest(BaseModel):
    opening_id: StrictInt = Field(gt=0)
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    choices: list[StrictInt] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def validate_choices(self):
        if any(choice not in (0, 1) for choice in self.choices):
            raise ValueError("Для каждого выбора укажите первую или вторую карточку")
        return self


class RouletteSpinRequest(BaseModel):
    amount: StrictInt = Field(ge=10, le=1_000_000)
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class LootboxRewardOut(BaseModel):
    kind: Literal["item", "kovbucks", "kovcoins", "xp"]
    amount: int = Field(gt=0)
    label: str
    item: ItemOut | None = None
    reveal_order: int = Field(default=0, ge=0)
    presentation_kind: Literal["fragment", "xp", "kovbucks", "kovcoins", "item"] = "item"
    icon: str = ""
    rarity: str = "Обычный"


class LootboxPresentationOut(BaseModel):
    code: str
    name: str
    rarity: str
    image_url: str
    open_image_url: str


class LootboxChoiceOptionOut(BaseModel):
    label: str
    icon: str
    rarity: str = "Обычный"
    presentation_kind: Literal["fragment", "xp", "kovbucks", "kovcoins", "item"] = "item"


class LootboxChoiceGroupOut(BaseModel):
    index: int = Field(ge=0)
    options: list[LootboxChoiceOptionOut]


class LootboxOpenResult(BaseModel):
    opening_id: int
    request_id: str
    pool: LootboxPresentationOut
    rewards: list[LootboxRewardOut]
    opening_mode: Literal["legacy_v1", "chest_v2", "choice_v2"] = "chest_v2"
    choice_groups: list[LootboxChoiceGroupOut] = []
    finalized: bool = True
    replayed: bool = False
    balance: int = 0
    xp: int = 0
    # Compatibility fields for the pre-editor client.
    item: ItemOut | None = None
    quantity: int = 0


class AdminLootboxEntryBody(BaseModel):
    reward_kind: Literal["item", "kovbucks", "kovcoins", "xp", "special_pool", "super_special_pool"] = "item"
    item_id: StrictInt | None = Field(default=None, gt=0)
    amount_min: StrictInt = Field(default=1, ge=1, le=1_000_000)
    amount_max: StrictInt = Field(default=1, ge=1, le=1_000_000)
    weight: StrictInt = Field(default=10, ge=1, le=100)
    is_guaranteed: bool = False
    is_active: bool = True
    sort_order: StrictInt = Field(default=0, ge=-100_000, le=100_000)

    @model_validator(mode="after")
    def validate_entry(self):
        if self.amount_max < self.amount_min:
            raise ValueError("Максимальное количество не может быть меньше минимального")
        if self.reward_kind == "item" and self.item_id is None:
            raise ValueError("Для предметной награды выберите предмет")
        if self.reward_kind != "item" and self.item_id is not None:
            raise ValueError("item_id допустим только для предметной награды")
        return self


class AdminLootboxBody(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=128)
    rarity: str = Field(default="Обычный", min_length=1, max_length=32)
    image_url: str = Field(default="/static/img/items/lootbox_common.png", min_length=1, max_length=512)
    # Optional on writes so an older admin client cannot accidentally switch a
    # chest_v2 pool back to the legacy roulette while saving unrelated fields.
    opening_mode: Literal["legacy_v1", "chest_v2", "choice_v2"] | None = None
    open_image_url: str | None = Field(default=None, max_length=512)
    bonus_item_chance: StrictInt | None = Field(default=None, ge=0, le=100)
    special_item_chance: StrictInt | None = Field(default=None, ge=0, le=100)
    super_special_item_chance: StrictInt | None = Field(default=None, ge=0, le=100)
    is_active: bool = True
    is_droppable: bool = True
    is_archived: bool = False
    assembly_weight: StrictInt = Field(default=10, ge=0, le=1_000_000)
    sale_price: StrictInt | None = Field(default=None, ge=1, le=1_000_000_000)
    # The current shop spends Kovbucks; accepting a second currency here would
    # create a misleading setting that no purchase endpoint honours.
    sale_currency: Literal["kovbucks"] = "kovbucks"
    min_user_level: StrictInt | None = Field(default=None, ge=0, le=100_000)
    max_user_level: StrictInt | None = Field(default=None, ge=0, le=100_000)
    sort_order: StrictInt = Field(default=0, ge=-100_000, le=100_000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    daily_open_limit: StrictInt = Field(default=0, ge=0, le=1000)
    guaranteed_slots: StrictInt = Field(default=1, ge=1, le=10)
    allow_duplicates: bool = True
    entries: list[AdminLootboxEntryBody] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_config(self):
        if self.min_user_level is not None and self.max_user_level is not None:
            if self.max_user_level < self.min_user_level:
                raise ValueError("Максимальный уровень не может быть меньше минимального")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("Дата окончания должна быть позже даты начала")
        active_entries = [entry for entry in self.entries if entry.is_active]
        if self.is_active and not active_entries:
            raise ValueError("Активный ковбокс не может иметь пустой список наград")
        random_total = sum(entry.weight for entry in active_entries if not entry.is_guaranteed)
        if self.opening_mode == "chest_v2":
            if random_total > 100:
                raise ValueError(f"Сумма шансов случайных наград не может превышать 100% (сейчас {random_total}%)")
            pool_total = (
                (self.bonus_item_chance or 0)
                + (self.special_item_chance or 0)
                + (self.super_special_item_chance or 0)
            )
            if pool_total > 100:
                raise ValueError(f"Сумма шансов пулов не может превышать 100% (сейчас {pool_total}%)")
        elif self.is_active and random_total != 100:
            raise ValueError(f"Сумма шансов обычных наград должна быть ровно 100% (сейчас {random_total}%)")
        if sum(1 for entry in active_entries if entry.is_guaranteed) > 10:
            raise ValueError("Гарантированных наград не может быть больше 10")
        # guaranteed_slots/allow_duplicates control pairs in the Mega box only.
        # A regular chest reveals every guaranteed row and therefore must not
        # be rejected when the admin leaves fewer than three guaranteed rows.
        if self.opening_mode == "choice_v2" and not self.allow_duplicates:
            guaranteed_count = sum(1 for entry in active_entries if entry.is_guaranteed)
            if guaranteed_count and self.guaranteed_slots > guaranteed_count:
                raise ValueError("Без дубликатов число гарантированных слотов превышает число гарантированных наград")
        return self


class AdminLootboxDuplicateBody(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=128)


class AdminLootboxEntryOut(BaseModel):
    id: int
    reward_kind: str
    item_id: int | None = None
    item_name: str | None = None
    item_icon: str | None = None
    amount_min: int
    amount_max: int
    weight: int
    normalized_percent: float
    is_guaranteed: bool
    is_active: bool
    sort_order: int


class AdminLootboxOut(BaseModel):
    id: int
    item_id: int
    item_code: str
    code: str
    name: str
    description: str
    rarity: str
    image_url: str
    opening_mode: str
    open_image_url: str
    bonus_item_chance: int
    special_item_chance: int
    super_special_item_chance: int
    is_active: bool
    is_droppable: bool
    is_archived: bool
    assembly_weight: int
    sale_price: int | None = None
    sale_currency: str
    min_user_level: int | None = None
    max_user_level: int | None = None
    sort_order: int
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    daily_open_limit: int
    guaranteed_slots: int
    allow_duplicates: bool
    version: int
    weight_total: int
    entries: list[AdminLootboxEntryOut]


class AwardXpRequest(BaseModel):
    user_id: StrictInt | None = Field(default=None, gt=0)  # None = текущий
    amount: StrictInt = Field(ge=0, le=1_000_000)
    reason: str = Field(default="", max_length=256)
    mode: Literal["add", "sub", "set"] = "add"

    @model_validator(mode="after")
    def validate_set_cap(self):
        if self.mode == "set" and self.amount > 99:
            raise ValueError("Текущий XP должен быть от 0 до 99")
        return self
