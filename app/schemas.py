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


class ItemOut(BaseModel):
    id: int
    code: str
    name: str
    description: str
    icon: str
    rarity: str
    category: str
    can_gift: bool
    can_activate: bool


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
    news: NewsOut | None = None
    daily_plan: TaskOut | None = None
    tasks: list[TaskOut]
    user_tasks: list[UserTaskOut]
    channel_url: str


class ShopProductOut(BaseModel):
    id: int
    item: ItemOut
    price: int


class MarketListingOut(BaseModel):
    id: int
    seller_id: int
    seller_name: str
    item: ItemOut
    quantity: int
    price: int


class BuyRequest(BaseModel):
    product_id: int


class ListRequest(BaseModel):
    item_id: int
    quantity: int = Field(ge=1)
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
