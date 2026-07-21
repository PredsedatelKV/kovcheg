from __future__ import annotations

import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import (
    award_xp,
    ensure_wallet,
    return_market_listing_to_seller,
    sync_lootbox_shop_product,
)
from app.auth import is_admin, require_admin
from app.db import begin_game_write, get_db
from app.models import now_utc

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])

UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _coerce_int(body: dict, field: str, default=None):
    """Безопасно достаёт числовое поле из произвольного dict-body и приводит к int.
    Возвращает default, если поля нет. Кидает 400 при неконвертируемом значении."""
    if field not in body or body[field] is None:
        return default
    val = body[field]
    if isinstance(val, bool):
        # bool — подкласс int, но в этих полях это почти всегда ошибка
        raise HTTPException(status_code=400, detail=f"Поле '{field}' должно быть числом")
    try:
        return int(val)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Поле '{field}' должно быть числом") from exc


# ------- helpers -------

def _admin_user_out(u: models.User) -> schemas.AdminUserOut:
    return schemas.AdminUserOut(
        id=u.id,
        telegram_id=u.telegram_id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        role=u.role,
        restrictions=u.restrictions,
        balance=u.wallet.balance if u.wallet else 0,
        xp=u.xp,
        is_admin=is_admin(u),
        pending_login_gifts=sum(1 for gift in u.login_gifts if gift.delivered_at is None),
    )


def _item_out(i: models.Item) -> schemas.ItemOut:
    return schemas.ItemOut(
        id=i.id,
        code=i.code,
        name=i.name,
        description=i.description,
        icon=i.icon,
        image_url=i.image_url,
        rarity=i.rarity,
        category=i.category,
        can_gift=i.can_gift,
        can_activate=i.can_activate,
        lootbox_pool_code=i.lootbox_pool_code,
    )


def _category_out(category: models.ItemCategory) -> schemas.ItemCategoryOut:
    return schemas.ItemCategoryOut(id=category.id, name=category.name, sort_order=category.sort_order)


def _require_item_category(db: Session, name: str) -> models.ItemCategory:
    normalized = name.strip()
    # SQLite's lower() only handles ASCII, so use Python casefold for Russian
    # category names too.
    category = next(
        (row for row in db.query(models.ItemCategory).all() if row.name.casefold() == normalized.casefold()),
        None,
    )
    if category is None:
        raise HTTPException(status_code=400, detail="Сначала создайте эту категорию предметов")
    return category


def _shop_product_out(p: models.ShopProduct) -> schemas.ShopProductOut:
    return schemas.ShopProductOut(id=p.id, item=_item_out(p.item), price=p.price, stock=p.stock)


def _market_listing_out(listing: models.MarketListing) -> schemas.MarketListingOut:
    target_name = None
    if listing.target_user_id is not None and listing.target_user is not None:
        target_name = listing.target_user.first_name or f"Игрок #{listing.target_user.id}"
    return schemas.MarketListingOut(
        id=listing.id,
        seller_id=listing.seller_id,
        seller_name=listing.seller.first_name if listing.seller else "",
        item=_item_out(listing.item),
        quantity=listing.quantity,
        price=listing.price,
        target_user_id=listing.target_user_id,
        target_user_name=target_name,
        is_active=listing.is_active,
    )


def _task_out(t: models.Task) -> schemas.TaskOut:
    return schemas.TaskOut(
        id=t.id,
        name=t.name,
        description=t.description,
        icon=t.icon,
        reward=t.reward,
        xp_reward=t.xp_reward,
        reward_item_id=t.reward_item_id,
        reward_item_name=t.reward_item.name if t.reward_item else None,
        reward_item_icon=t.reward_item.icon if t.reward_item else None,
        reward_item_quantity=t.reward_item_quantity,
        target_progress=t.target_progress,
        is_daily_plan=t.is_daily_plan,
    )


def _user_task_out(ut: models.UserTask) -> schemas.AdminUserTaskOut:
    return schemas.AdminUserTaskOut(
        id=ut.id,
        user_id=ut.user_id,
        user_name=ut.user.first_name if ut.user else "",
        task=_task_out(ut.task),
        status=ut.status,
        progress=ut.progress,
        started_at=ut.started_at,
        finished_at=ut.finished_at,
    )


def _wheel_prize_out(p: models.WheelPrize) -> schemas.WheelPrizeOut:
    return schemas.WheelPrizeOut(
        id=p.id,
        label=p.label,
        kind=p.kind,
        value=p.value,
        item_code=p.item_code,
        icon=p.icon,
        weight=p.weight,
        sort_order=p.sort_order,
        is_active=p.is_active,
    )


# ------- meta (used to populate dropdowns in admin UI) -------

@router.get("/meta", response_model=schemas.AdminMeta)
def meta(db: Session = Depends(get_db)) -> schemas.AdminMeta:
    items = db.query(models.Item).order_by(models.Item.name).all()
    users = db.query(models.User).order_by(models.User.first_name).all()
    categories = db.query(models.ItemCategory).order_by(models.ItemCategory.sort_order, models.ItemCategory.name).all()
    return schemas.AdminMeta(
        items=[_item_out(i) for i in items],
        users=[_admin_user_out(u) for u in users],
        categories=[_category_out(category) for category in categories],
    )


# ------- users -------

@router.get("/users", response_model=list[schemas.AdminUserOut])
def list_users(db: Session = Depends(get_db)) -> list[schemas.AdminUserOut]:
    rows = db.query(models.User).order_by(models.User.first_name).all()
    return [_admin_user_out(u) for u in rows]


@router.patch("/users/{user_id}", response_model=schemas.AdminUserOut)
def update_user(user_id: int, body: schemas.AdminUserUpdate, db: Session = Depends(get_db)) -> schemas.AdminUserOut:
    u = db.query(models.User).filter(models.User.id == user_id).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    if body.first_name is not None:
        u.first_name = body.first_name
    if body.role is not None:
        u.role = body.role
    if body.restrictions is not None:
        u.restrictions = body.restrictions or None
    db.commit()
    db.refresh(u)
    return _admin_user_out(u)


@router.post("/users/{user_id}/login-gifts", response_model=schemas.LoginGiftOut)
def schedule_login_gift(
    user_id: int,
    body: schemas.AdminLoginGiftBody,
    admin_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> schemas.LoginGiftOut:
    begin_game_write(db)
    target = db.query(models.User).filter(models.User.id == user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    item = None
    if body.item_id is not None:
        item = db.query(models.Item).filter(models.Item.id == body.item_id).one_or_none()
        if item is None:
            raise HTTPException(status_code=404, detail="Предмет не найден")
    gift = models.PendingLoginGift(
        user_id=target.id,
        created_by_id=admin_user.id,
        kovbucks=body.kovbucks,
        xp=body.xp,
        item_id=item.id if item else None,
        item_quantity=body.item_quantity if item else 0,
    )
    db.add(gift)
    db.commit()
    db.refresh(gift)
    return schemas.LoginGiftOut(
        id=gift.id,
        kovbucks=gift.kovbucks,
        xp=gift.xp,
        item_id=gift.item_id,
        item_name=item.name if item else None,
        item_icon=item.icon if item else None,
        item_quantity=gift.item_quantity,
        delivered_at=gift.delivered_at,
    )


@router.post("/users/{user_id}/balance", response_model=schemas.AdminUserOut)
def adjust_balance(user_id: int, body: schemas.AdminBalanceUpdate, db: Session = Depends(get_db)) -> schemas.AdminUserOut:
    begin_game_write(db)
    u = db.query(models.User).filter(models.User.id == user_id).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    wallet = ensure_wallet(db, u)
    old_balance = wallet.balance
    if body.mode == "set":
        new_balance = body.delta
        # Логируем фактическую дельту относительно старого баланса, а не
        # «начисление» на всю новую сумму. Знак дельты задаёт направление.
        change = new_balance - old_balance
        tx_amount = abs(change)
        tx_sender = None if change >= 0 else u.id
        tx_recipient = u.id if change >= 0 else None
    elif body.mode == "sub":
        new_balance = old_balance - body.delta
        tx_amount = body.delta
        tx_sender = u.id
        tx_recipient = None
    else:
        new_balance = old_balance + body.delta
        tx_amount = body.delta
        tx_sender = None if body.delta >= 0 else u.id
        tx_recipient = u.id if body.delta >= 0 else None
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Баланс не может быть отрицательным")
    if new_balance > 2_000_000_000:
        raise HTTPException(status_code=400, detail="Баланс превышает допустимый максимум")
    wallet.balance = new_balance
    if tx_amount > 0:
        db.add(
            models.Transaction(
                sender_id=tx_sender,
                recipient_id=tx_recipient,
                amount=abs(tx_amount),
                note=body.note or "admin",
            )
        )
    db.commit()
    db.refresh(u)
    return _admin_user_out(u)


@router.post("/users/{user_id}/inventory", response_model=list[schemas.InventoryItemOut])
def adjust_inventory(user_id: int, body: schemas.AdminInventoryUpdate, db: Session = Depends(get_db)) -> list[schemas.InventoryItemOut]:
    begin_game_write(db)
    u = db.query(models.User).filter(models.User.id == user_id).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    item = db.query(models.Item).filter(models.Item.id == body.item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == u.id, models.InventoryItem.item_id == item.id)
        .one_or_none()
    )
    if inv is None:
        if body.delta <= 0:
            raise HTTPException(status_code=400, detail="Предмета и так нет")
        inv = models.InventoryItem(user_id=u.id, item_id=item.id, quantity=body.delta)
        db.add(inv)
    else:
        inv.quantity += body.delta
        if inv.quantity < 0:
            raise HTTPException(status_code=400, detail="Недостаточно предметов")
        if inv.quantity > 2_000_000_000:
            raise HTTPException(status_code=400, detail="Количество предметов превышает допустимый максимум")
        if inv.quantity == 0:
            db.delete(inv)
    db.commit()
    rows = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == u.id, models.InventoryItem.quantity > 0)
        .all()
    )
    return [
        schemas.InventoryItemOut(id=r.id, item=_item_out(r.item), quantity=r.quantity)
        for r in rows
    ]


@router.get("/users/{user_id}/inventory", response_model=list[schemas.InventoryItemOut])
def view_user_inventory(user_id: int, db: Session = Depends(get_db)) -> list[schemas.InventoryItemOut]:
    u = db.query(models.User).filter(models.User.id == user_id).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    rows = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == u.id, models.InventoryItem.quantity > 0)
        .all()
    )
    return [
        schemas.InventoryItemOut(id=r.id, item=_item_out(r.item), quantity=r.quantity)
        for r in rows
    ]


@router.delete("/users/{user_id}/inventory/{inv_id}")
def remove_from_inventory(user_id: int, inv_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    u = db.query(models.User).filter(models.User.id == user_id).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.id == inv_id, models.InventoryItem.user_id == u.id)
        .one_or_none()
    )
    if inv is None:
        raise HTTPException(status_code=404, detail="Запись инвентаря не найдена")
    db.delete(inv)
    db.commit()
    return {"ok": True}


# ------- items (catalog) -------

@router.get("/item-categories", response_model=list[schemas.ItemCategoryOut])
def list_item_categories(db: Session = Depends(get_db)) -> list[schemas.ItemCategoryOut]:
    rows = db.query(models.ItemCategory).order_by(models.ItemCategory.sort_order, models.ItemCategory.name).all()
    return [_category_out(row) for row in rows]


@router.post("/item-categories", response_model=schemas.ItemCategoryOut)
def create_item_category(
    body: schemas.AdminItemCategoryBody, db: Session = Depends(get_db)
) -> schemas.ItemCategoryOut:
    begin_game_write(db)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Название категории обязательно")
    duplicate = next(
        (row for row in db.query(models.ItemCategory).all() if row.name.casefold() == name.casefold()),
        None,
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Такая категория уже существует")
    category = models.ItemCategory(name=name, sort_order=body.sort_order)
    db.add(category)
    db.commit()
    db.refresh(category)
    return _category_out(category)


@router.patch("/item-categories/{category_id}", response_model=schemas.ItemCategoryOut)
def update_item_category(
    category_id: int, body: schemas.AdminItemCategoryBody, db: Session = Depends(get_db)
) -> schemas.ItemCategoryOut:
    begin_game_write(db)
    category = db.get(models.ItemCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Категория не найдена")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Название категории обязательно")
    duplicate = next(
        (
            row for row in db.query(models.ItemCategory).all()
            if row.id != category.id and row.name.casefold() == name.casefold()
        ),
        None,
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Такая категория уже существует")
    old_name = category.name
    if old_name != name:
        db.query(models.Item).filter(models.Item.category == old_name).update(
            {models.Item.category: name}, synchronize_session=False
        )
    category.name = name
    category.sort_order = body.sort_order
    db.commit()
    db.refresh(category)
    return _category_out(category)


@router.delete("/item-categories/{category_id}")
def delete_item_category(category_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    category = db.get(models.ItemCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Категория не найдена")
    if db.query(models.Item).filter(models.Item.category == category.name).first():
        raise HTTPException(status_code=409, detail="Сначала перенесите предметы в другую категорию")
    db.delete(category)
    db.commit()
    return {"ok": True}

@router.get("/items", response_model=list[schemas.ItemOut])
def list_items(db: Session = Depends(get_db)) -> list[schemas.ItemOut]:
    rows = db.query(models.Item).order_by(models.Item.name).all()
    return [_item_out(i) for i in rows]


@router.post("/items", response_model=schemas.ItemOut)
def create_item(body: schemas.AdminItemBody, db: Session = Depends(get_db)) -> schemas.ItemOut:
    begin_game_write(db)
    # The editor derives the internal code from the visible name. Names can
    # legitimately repeat, so pick a free suffix instead of rejecting it.
    base_code = body.code
    code = base_code
    suffix_number = 2
    while db.query(models.Item).filter(models.Item.code == code).one_or_none() is not None:
        suffix = f"-{suffix_number}"
        code = f"{base_code[:64 - len(suffix)]}{suffix}"
        suffix_number += 1
    category = _require_item_category(db, body.category)
    item = models.Item(
        description="",
        **body.model_dump(exclude={"category", "code"}),
        code=code,
        category=category.name,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.patch("/items/{item_id}", response_model=schemas.ItemOut)
def update_item(item_id: int, body: schemas.AdminItemBody, db: Session = Depends(get_db)) -> schemas.ItemOut:
    begin_game_write(db)
    item = db.query(models.Item).filter(models.Item.id == item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    if item.lootbox_pool_code:
        raise HTTPException(409, "Ковбоксы изменяются только через редактор ковбоксов")
    category = _require_item_category(db, body.category)
    for k, v in body.model_dump(exclude={"category"}).items():
        setattr(item, k, v)
    item.category = category.name
    item.description = ""
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)) -> dict:
    """Delete only an unused catalog row; never cascade player value."""
    begin_game_write(db)
    item = db.query(models.Item).filter(models.Item.id == item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    if item.lootbox_pool_code:
        raise HTTPException(409, "Ковбокс можно только архивировать в редакторе ковбоксов")
    references = (
        db.query(models.InventoryItem).filter(models.InventoryItem.item_id == item.id).first()
        or db.query(models.ShopProduct).filter(models.ShopProduct.item_id == item.id).first()
        or db.query(models.MarketListing).filter(models.MarketListing.item_id == item.id).first()
        or db.query(models.LootboxPoolEntry).filter(models.LootboxPoolEntry.item_id == item.id).first()
        or db.query(models.BattlePassReward).filter(models.BattlePassReward.item_code == item.code).first()
        or db.query(models.Quiz).filter(models.Quiz.prize_item_code == item.code).first()
        or db.query(models.WheelPrize).filter(models.WheelPrize.item_code == item.code).first()
    )
    if references is not None:
        raise HTTPException(409, "Предмет используется в игре и не может быть удалён")
    db.delete(item)
    db.commit()
    return {"ok": True}


# ------- uploads (images for products / items) -------

@router.post("/uploads")
async def upload_image(file: UploadFile) -> dict:
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Файл не передан")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(status_code=400, detail=f"Расширение {ext} не поддерживается")
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Файл пустой")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 5 МБ)")
    stem = SAFE_NAME_RE.sub("-", Path(file.filename).stem)[:48] or "image"
    safe_name = f"{int(time.time())}-{uuid.uuid4().hex[:8]}-{stem}{ext}"
    dest = UPLOADS_DIR / safe_name
    dest.write_bytes(data)
    return {"url": f"/static/uploads/{safe_name}", "filename": safe_name, "size": len(data)}


# ------- news -------

@router.get("/news", response_model=list[schemas.NewsOut])
def list_news(db: Session = Depends(get_db)) -> list[schemas.NewsOut]:
    rows = db.query(models.News).order_by(models.News.published_at.desc()).all()
    return [
        schemas.NewsOut(id=n.id, image_url=n.image_url, title=n.title, body=n.body, published_at=n.published_at)
        for n in rows
    ]


@router.post("/news", response_model=schemas.NewsOut)
def create_news(body: schemas.AdminNewsBody, db: Session = Depends(get_db)) -> schemas.NewsOut:
    n = models.News(image_url=body.image_url, title=body.title, body=body.body, is_active=body.is_active)
    db.add(n)
    db.commit()
    db.refresh(n)
    return schemas.NewsOut(id=n.id, image_url=n.image_url, title=n.title, body=n.body, published_at=n.published_at)


@router.patch("/news/{news_id}", response_model=schemas.NewsOut)
def update_news(news_id: int, body: schemas.AdminNewsBody, db: Session = Depends(get_db)) -> schemas.NewsOut:
    n = db.query(models.News).filter(models.News.id == news_id).one_or_none()
    if n is None:
        raise HTTPException(status_code=404, detail="Новость не найдена")
    n.image_url = body.image_url
    n.title = body.title
    n.body = body.body
    n.is_active = body.is_active
    db.commit()
    db.refresh(n)
    return schemas.NewsOut(id=n.id, image_url=n.image_url, title=n.title, body=n.body, published_at=n.published_at)


@router.delete("/news/{news_id}")
def delete_news(news_id: int, db: Session = Depends(get_db)) -> dict:
    n = db.query(models.News).filter(models.News.id == news_id).one_or_none()
    if n is None:
        raise HTTPException(status_code=404, detail="Новость не найдена")
    db.delete(n)
    db.commit()
    return {"ok": True}


# ------- banners -------

@router.get("/banners", response_model=list[schemas.BannerOut])
def list_banners(db: Session = Depends(get_db)) -> list[schemas.BannerOut]:
    rows = db.query(models.Banner).order_by(models.Banner.sort_order, models.Banner.id).all()
    return [schemas.BannerOut(id=b.id, image_url=b.image_url, title=b.title) for b in rows]


@router.post("/banners", response_model=schemas.BannerOut)
def create_banner(body: schemas.AdminBannerBody, db: Session = Depends(get_db)) -> schemas.BannerOut:
    b = models.Banner(
        image_url=body.image_url, title=body.title, sort_order=body.sort_order, is_active=body.is_active
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return schemas.BannerOut(id=b.id, image_url=b.image_url, title=b.title)


@router.patch("/banners/{banner_id}", response_model=schemas.BannerOut)
def update_banner(banner_id: int, body: schemas.AdminBannerBody, db: Session = Depends(get_db)) -> schemas.BannerOut:
    b = db.query(models.Banner).filter(models.Banner.id == banner_id).one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail="Баннер не найден")
    b.image_url = body.image_url
    b.title = body.title
    b.sort_order = body.sort_order
    b.is_active = body.is_active
    db.commit()
    db.refresh(b)
    return schemas.BannerOut(id=b.id, image_url=b.image_url, title=b.title)


@router.delete("/banners/{banner_id}")
def delete_banner(banner_id: int, db: Session = Depends(get_db)) -> dict:
    b = db.query(models.Banner).filter(models.Banner.id == banner_id).one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail="Баннер не найден")
    db.delete(b)
    db.commit()
    return {"ok": True}


# ------- tasks -------

def _validate_task_reward_item(db: Session, body: schemas.AdminTaskBody) -> None:
    if body.reward_item_id is None:
        return
    item = db.query(models.Item).filter(models.Item.id == body.reward_item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=400, detail="Предмет награды не найден")

@router.get("/tasks", response_model=list[schemas.TaskOut])
def list_tasks(db: Session = Depends(get_db)) -> list[schemas.TaskOut]:
    rows = db.query(models.Task).order_by(models.Task.is_daily_plan.desc(), models.Task.sort_order, models.Task.id).all()
    return [_task_out(t) for t in rows]


@router.post("/tasks", response_model=schemas.TaskOut)
def create_task(body: schemas.AdminTaskBody, db: Session = Depends(get_db)) -> schemas.TaskOut:
    begin_game_write(db)
    _validate_task_reward_item(db, body)
    t = models.Task(**body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _task_out(t)


@router.patch("/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: int, body: schemas.AdminTaskBody, db: Session = Depends(get_db)) -> schemas.TaskOut:
    begin_game_write(db)
    t = db.query(models.Task).filter(models.Task.id == task_id).one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    _validate_task_reward_item(db, body)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _task_out(t)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    t = db.query(models.Task).filter(models.Task.id == task_id).one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    db.query(models.UserTask).filter(models.UserTask.task_id == t.id).delete()
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.get("/tasks/user", response_model=list[schemas.AdminUserTaskOut])
def list_user_tasks(db: Session = Depends(get_db)) -> list[schemas.AdminUserTaskOut]:
    rows = (
        db.query(models.UserTask)
        .order_by(models.UserTask.started_at.desc())
        .all()
    )
    return [_user_task_out(ut) for ut in rows]


@router.post("/tasks/user/{user_task_id}/approve", response_model=schemas.AdminUserTaskOut)
def approve_user_task(
    user_task_id: int, db: Session = Depends(get_db)
) -> schemas.AdminUserTaskOut:
    begin_game_write(db)
    ut = db.query(models.UserTask).filter(models.UserTask.id == user_task_id).one_or_none()
    if ut is None:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    if ut.status != "in_progress":
        raise HTTPException(status_code=400, detail="Задание не в процессе")
    ut.status = "done"
    ut.progress = ut.task.target_progress
    ut.finished_at = now_utc()
    wallet = ensure_wallet(db, ut.user)
    if not 0 <= ut.task.reward <= 1_000_000 or not 0 <= ut.task.xp_reward <= 1_000_000:
        raise HTTPException(status_code=503, detail="Награда задания настроена некорректно")
    if wallet.balance < 0 or wallet.balance > 2_000_000_000 - ut.task.reward:
        raise HTTPException(status_code=409, detail="Достигнут максимальный баланс ковбаксов")
    reward_item = ut.task.reward_item
    reward_inventory = None
    if ut.task.reward_item_id is not None:
        if reward_item is None or not 1 <= ut.task.reward_item_quantity <= 1_000_000:
            raise HTTPException(status_code=503, detail="Предметная награда задания настроена некорректно")
        reward_inventory = db.query(models.InventoryItem).filter(
            models.InventoryItem.user_id == ut.user_id,
            models.InventoryItem.item_id == reward_item.id,
        ).one_or_none()
        if reward_inventory and reward_inventory.quantity > 2_000_000_000 - ut.task.reward_item_quantity:
            raise HTTPException(status_code=409, detail="Достигнут максимальный размер стака предмета")
    wallet.balance += ut.task.reward
    if ut.task.xp_reward:
        award_xp(db, ut.user, ut.task.xp_reward)
    if ut.task.reward:
        db.add(
            models.Transaction(
                sender_id=None,
                recipient_id=ut.user_id,
                amount=ut.task.reward,
                note=f"task:{ut.task.id}:admin_approved",
            )
        )
    if reward_item is not None:
        if reward_inventory is None:
            db.add(models.InventoryItem(
                user_id=ut.user_id,
                item_id=reward_item.id,
                quantity=ut.task.reward_item_quantity,
            ))
        else:
            reward_inventory.quantity += ut.task.reward_item_quantity
    db.commit()
    db.refresh(ut)
    return _user_task_out(ut)


# ------- shop -------

@router.get("/shop", response_model=list[schemas.ShopProductOut])
def list_shop(db: Session = Depends(get_db)) -> list[schemas.ShopProductOut]:
    rows = db.query(models.ShopProduct).order_by(models.ShopProduct.id).all()
    return [_shop_product_out(p) for p in rows]


@router.post("/shop", response_model=schemas.ShopProductOut)
def create_shop(body: schemas.AdminShopProductBody, db: Session = Depends(get_db)) -> schemas.ShopProductOut:
    begin_game_write(db)
    item = db.query(models.Item).filter(models.Item.id == body.item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    if item.lootbox_pool_code:
        raise HTTPException(409, "Продажа ковбокса настраивается в редакторе ковбоксов")
    # stock: -1 = безлимит, 0 = распродано, >0 = остаток. Меньше -1 — некорректно.
    if body.stock < -1:
        raise HTTPException(status_code=400, detail="Некорректный остаток (stock >= -1, где -1 = безлимит)")
    p = models.ShopProduct(item_id=body.item_id, price=body.price, is_active=body.is_active, stock=body.stock)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _shop_product_out(p)


@router.patch("/shop/{product_id}", response_model=schemas.ShopProductOut)
def update_shop(product_id: int, body: schemas.AdminShopProductBody, db: Session = Depends(get_db)) -> schemas.ShopProductOut:
    begin_game_write(db)
    p = db.query(models.ShopProduct).filter(models.ShopProduct.id == product_id).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Товар не найден")
    next_item = db.query(models.Item).filter(models.Item.id == body.item_id).one_or_none()
    if next_item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    if p.item.lootbox_pool_code or next_item.lootbox_pool_code:
        raise HTTPException(409, "Продажа ковбокса настраивается в редакторе ковбоксов")
    if body.stock < -1:
        raise HTTPException(status_code=400, detail="Некорректный остаток (stock >= -1, где -1 = безлимит)")
    p.item_id = body.item_id
    p.price = body.price
    p.is_active = body.is_active
    p.stock = body.stock
    db.commit()
    db.refresh(p)
    return _shop_product_out(p)


@router.delete("/shop/{product_id}")
def delete_shop(product_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    p = db.query(models.ShopProduct).filter(models.ShopProduct.id == product_id).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if p.item.lootbox_pool_code:
        raise HTTPException(409, "Продажа ковбокса настраивается в редакторе ковбоксов")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ------- market -------

@router.get("/market", response_model=list[schemas.MarketListingOut])
def list_market(db: Session = Depends(get_db)) -> list[schemas.MarketListingOut]:
    rows = db.query(models.MarketListing).order_by(models.MarketListing.id.desc()).all()
    return [_market_listing_out(listing) for listing in rows]


@router.post("/market/{listing_id}/unlist", response_model=schemas.MarketListingOut)
def admin_unlist_market(listing_id: int, db: Session = Depends(get_db)) -> schemas.MarketListingOut:
    begin_game_write(db)
    listing = db.query(models.MarketListing).filter(models.MarketListing.id == listing_id).one_or_none()
    if listing is None:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    item_name = listing.item.name
    seller_name = listing.seller.first_name or f"Игрок #{listing.seller_id}"
    quantity = listing.quantity
    return_market_listing_to_seller(db, listing)
    db.commit()
    db.refresh(listing)
    from app.notify import notify_admins_bg

    notify_admins_bg(
        f"↩️ Администратор снял лот <b>{seller_name}</b>: <b>{item_name}</b> ×{quantity}. Предмет возвращён игроку."
    )
    return _market_listing_out(listing)


@router.post("/market", response_model=schemas.MarketListingOut)
def create_market(body: schemas.AdminMarketListingBody, db: Session = Depends(get_db)) -> schemas.MarketListingOut:
    raise HTTPException(410, "Лот создаётся только игроком с атомарным резервированием предмета")


@router.patch("/market/{listing_id}", response_model=schemas.MarketListingOut)
def update_market(listing_id: int, body: schemas.AdminMarketListingBody, db: Session = Depends(get_db)) -> schemas.MarketListingOut:
    begin_game_write(db)
    listing = db.query(models.MarketListing).filter(models.MarketListing.id == listing_id).one_or_none()
    if listing is None:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    if body.is_active != listing.is_active:
        raise HTTPException(400, "Статус лота меняется только через безопасное действие продавца")
    if (body.seller_id, body.item_id, body.quantity) != (
        listing.seller_id, listing.item_id, listing.quantity
    ):
        raise HTTPException(400, "Продавца, предмет и количество активного лота менять нельзя")
    listing.price = body.price
    db.commit()
    db.refresh(listing)
    return _market_listing_out(listing)


@router.delete("/market/{listing_id}")
def delete_market(listing_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    listing = db.query(models.MarketListing).filter(models.MarketListing.id == listing_id).one_or_none()
    if listing is None:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    if listing.is_active:
        raise HTTPException(400, "Сначала снимите активный лот через безопасный возврат предмета")
    db.delete(listing)
    db.commit()
    return {"ok": True}


# ------- wheel prizes -------

def _validate_wheel_percent_total(
    db: Session,
    body: schemas.AdminWheelPrizeBody,
    replacing_id: int | None = None,
) -> None:
    """Keep Wheel of Fortune sectors as real percentages, never weights."""
    rows = db.query(models.WheelPrize).filter(models.WheelPrize.is_active.is_(True)).all()
    total = sum(row.weight for row in rows if row.id != replacing_id)
    if body.is_active:
        total += body.weight
    if total > 100:
        raise HTTPException(400, f"Сумма шансов активных секторов не может быть больше 100% (сейчас {total}%)")

@router.get("/wheel", response_model=list[schemas.WheelPrizeOut])
def list_wheel(db: Session = Depends(get_db)) -> list[schemas.WheelPrizeOut]:
    rows = db.query(models.WheelPrize).order_by(models.WheelPrize.sort_order, models.WheelPrize.id).all()
    return [_wheel_prize_out(p) for p in rows]


@router.post("/wheel", response_model=schemas.WheelPrizeOut)
def create_wheel(body: schemas.AdminWheelPrizeBody, db: Session = Depends(get_db)) -> schemas.WheelPrizeOut:
    begin_game_write(db)
    if body.kind == "item" and not db.query(models.Item).filter(models.Item.code == body.item_code).first():
        raise HTTPException(400, "Предмет приза не найден")
    _validate_wheel_percent_total(db, body)
    p = models.WheelPrize(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _wheel_prize_out(p)


@router.patch("/wheel/{prize_id}", response_model=schemas.WheelPrizeOut)
def update_wheel(prize_id: int, body: schemas.AdminWheelPrizeBody, db: Session = Depends(get_db)) -> schemas.WheelPrizeOut:
    begin_game_write(db)
    if body.kind == "item" and not db.query(models.Item).filter(models.Item.code == body.item_code).first():
        raise HTTPException(400, "Предмет приза не найден")
    p = db.query(models.WheelPrize).filter(models.WheelPrize.id == prize_id).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Приз не найден")
    _validate_wheel_percent_total(db, body, replacing_id=p.id)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _wheel_prize_out(p)


@router.delete("/wheel/{prize_id}")
def delete_wheel(prize_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    p = db.query(models.WheelPrize).filter(models.WheelPrize.id == prize_id).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Приз не найден")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ------- legal texts -------

@router.get("/legal", response_model=list[schemas.LegalTextOut])
def list_legal(db: Session = Depends(get_db)) -> list[schemas.LegalTextOut]:
    rows = db.query(models.LegalText).all()
    return [schemas.LegalTextOut(slug=t.slug, title=t.title, body=t.body) for t in rows]


@router.patch("/legal/{slug}", response_model=schemas.LegalTextOut)
def update_legal(slug: str, body: schemas.AdminLegalBody, db: Session = Depends(get_db)) -> schemas.LegalTextOut:
    t = db.query(models.LegalText).filter(models.LegalText.slug == slug).one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Текст не найден")
    t.title = body.title
    t.body = body.body
    db.commit()
    db.refresh(t)
    return schemas.LegalTextOut(slug=t.slug, title=t.title, body=t.body)


# ------- quizzes -------

def _validate_quiz_config(
    db: Session,
    body: schemas.QuizBody,
    *,
    question_count: int,
) -> None:
    if body.prize_kind == "item":
        item = db.query(models.Item).filter(models.Item.code == body.prize_item_code).one_or_none()
        if item is None:
            raise HTTPException(400, "Предмет-награда теста не найден")
    if body.is_active and (
        question_count < 1
        or body.threshold_good > question_count
        or body.threshold_excellent > question_count
    ):
        raise HTTPException(400, "Активный тест должен иметь достаточно вопросов для заданных порогов")

def _quiz_out(q: models.Quiz) -> schemas.QuizOut:
    return schemas.QuizOut(
        id=q.id,
        title=q.title,
        description=q.description,
        is_active=q.is_active,
        prize_kind=q.prize_kind,
        prize_value=q.prize_value,
        prize_item_code=q.prize_item_code,
        prize_label=q.prize_label,
        threshold_good=q.threshold_good,
        threshold_excellent=q.threshold_excellent,
        questions=[
            schemas.QuizQuestionOut(
                id=qq.id,
                quiz_id=qq.quiz_id,
                text=qq.text,
                option_a=qq.option_a,
                option_b=qq.option_b,
                option_c=qq.option_c,
                option_d=qq.option_d,
                correct_option=qq.correct_option,
                sort_order=qq.sort_order,
            )
            for qq in sorted(q.questions, key=lambda x: x.sort_order)
        ],
    )


@router.get("/quizzes", response_model=list[schemas.QuizOut])
def list_quizzes(db: Session = Depends(get_db)) -> list[schemas.QuizOut]:
    rows = db.query(models.Quiz).order_by(models.Quiz.id).all()
    return [_quiz_out(q) for q in rows]


@router.post("/quizzes", response_model=schemas.QuizOut)
def create_quiz(body: schemas.QuizBody, db: Session = Depends(get_db)) -> schemas.QuizOut:
    begin_game_write(db)
    _validate_quiz_config(db, body, question_count=0)
    q = models.Quiz(**body.model_dump())
    db.add(q)
    db.commit()
    db.refresh(q)
    return _quiz_out(q)


@router.patch("/quizzes/{quiz_id}", response_model=schemas.QuizOut)
def update_quiz(quiz_id: int, body: schemas.QuizBody, db: Session = Depends(get_db)) -> schemas.QuizOut:
    begin_game_write(db)
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    _validate_quiz_config(db, body, question_count=len(q.questions))
    for k, v in body.model_dump().items():
        setattr(q, k, v)
    db.commit()
    db.refresh(q)
    return _quiz_out(q)


@router.delete("/quizzes/{quiz_id}")
def delete_quiz(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    db.query(models.QuizRun).filter(models.QuizRun.quiz_id == quiz_id).delete(synchronize_session=False)
    db.delete(q)
    db.commit()
    return {"ok": True}


@router.post("/quizzes/{quiz_id}/questions", response_model=schemas.QuizQuestionOut)
def add_question(quiz_id: int, body: schemas.QuizQuestionBody, db: Session = Depends(get_db)) -> schemas.QuizQuestionOut:
    begin_game_write(db)
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    if len(q.questions) >= 1000:
        raise HTTPException(400, "В тесте не может быть больше 1000 вопросов")
    qq = models.QuizQuestion(quiz_id=quiz_id, **body.model_dump())
    db.add(qq)
    db.commit()
    db.refresh(qq)
    return schemas.QuizQuestionOut(
        id=qq.id, quiz_id=qq.quiz_id, text=qq.text,
        option_a=qq.option_a, option_b=qq.option_b, option_c=qq.option_c, option_d=qq.option_d,
        correct_option=qq.correct_option, sort_order=qq.sort_order,
    )


@router.patch("/quizzes/{quiz_id}/questions/{q_id}", response_model=schemas.QuizQuestionOut)
def update_question(quiz_id: int, q_id: int, body: schemas.QuizQuestionBody, db: Session = Depends(get_db)) -> schemas.QuizQuestionOut:
    begin_game_write(db)
    qq = db.query(models.QuizQuestion).filter(models.QuizQuestion.id == q_id, models.QuizQuestion.quiz_id == quiz_id).one_or_none()
    if qq is None:
        raise HTTPException(status_code=404, detail="Вопрос не найден")
    for k, v in body.model_dump().items():
        setattr(qq, k, v)
    db.commit()
    db.refresh(qq)
    return schemas.QuizQuestionOut(
        id=qq.id, quiz_id=qq.quiz_id, text=qq.text,
        option_a=qq.option_a, option_b=qq.option_b, option_c=qq.option_c, option_d=qq.option_d,
        correct_option=qq.correct_option, sort_order=qq.sort_order,
    )


@router.delete("/quizzes/{quiz_id}/questions/{q_id}")
def delete_question(quiz_id: int, q_id: int, db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    qq = db.query(models.QuizQuestion).filter(models.QuizQuestion.id == q_id, models.QuizQuestion.quiz_id == quiz_id).one_or_none()
    if qq is None:
        raise HTTPException(status_code=404, detail="Вопрос не найден")
    quiz = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one()
    remaining = len(quiz.questions) - 1
    if quiz.is_active and (
        remaining < 1
        or quiz.threshold_good > remaining
        or quiz.threshold_excellent > remaining
    ):
        raise HTTPException(409, "Сначала отключите тест или уменьшите пороги")
    db.delete(qq)
    db.commit()
    return {"ok": True}


@router.get("/quizzes/{quiz_id}/attempts", response_model=list[schemas.QuizAttemptOut])
def list_quiz_attempts(quiz_id: int, db: Session = Depends(get_db)) -> list[schemas.QuizAttemptOut]:
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    rows = db.query(models.QuizAttempt).filter(models.QuizAttempt.quiz_id == quiz_id).order_by(models.QuizAttempt.created_at.desc()).all()
    return [
        schemas.QuizAttemptOut(
            id=a.id, quiz_id=a.quiz_id, user_id=a.user_id,
            score=a.score, total=a.total, grade=a.grade,
            prize_awarded=a.prize_awarded, created_at=a.created_at,
        )
        for a in rows
    ]


# ── Battle Pass ─────────────────────────────────────────────────

MAX_BATTLEPASS_LEVELS = 1_000
MAX_BATTLEPASS_REWARD = 1_000_000


def _validate_bp_season_values(xp_per_level: int, total_levels: int) -> None:
    """Also protects partial edits of malformed rows created by legacy code."""
    if not 1 <= xp_per_level <= MAX_BATTLEPASS_REWARD:
        raise HTTPException(400, "XP за уровень должен быть от 1 до 1 000 000")
    if not 1 <= total_levels <= MAX_BATTLEPASS_LEVELS:
        raise HTTPException(400, "Количество уровней должно быть от 1 до 1 000")


def _claimed_bp_level(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if (
        isinstance(value, list)
        and value
        and isinstance(value[0], int)
        and not isinstance(value[0], bool)
    ):
        return value[0]
    return None


@router.get("/battlepass/seasons")
def admin_list_bp_seasons(db: Session = Depends(get_db)):
    seasons = db.query(models.BattlePassSeason).order_by(models.BattlePassSeason.created_at.desc()).all()
    result = []
    for s in seasons:
        rewards = [
            {"id": r.id, "level": r.level, "track": r.track, "kind": r.kind,
             "value": r.value, "item_code": r.item_code, "label": r.label, "icon": r.icon}
            for r in s.rewards
        ]
        result.append({
            "id": s.id, "name": s.name, "theme": s.theme,
            "xp_per_level": s.xp_per_level, "total_levels": s.total_levels,
            "is_active": s.is_active, "created_at": str(s.created_at),
            "rewards": rewards,
        })
    return result


@router.post("/battlepass/season")
def admin_save_bp_season(body: schemas.AdminBattlePassSeasonBody, db: Session = Depends(get_db)):
    season_id = body.id
    if season_id:
        s = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.id == season_id).first()
        if not s:
            raise HTTPException(404, "Сезон не найден")
    else:
        s = models.BattlePassSeason(name=body.name or "Новый сезон")
        db.add(s)
        db.flush()

    next_xp_per_level = body.xp_per_level if body.xp_per_level is not None else s.xp_per_level
    next_total_levels = body.total_levels if body.total_levels is not None else s.total_levels
    _validate_bp_season_values(next_xp_per_level, next_total_levels)
    highest_reward_level = db.query(models.BattlePassReward.level).filter(
        models.BattlePassReward.season_id == s.id,
    ).order_by(models.BattlePassReward.level.desc()).first()
    if highest_reward_level and highest_reward_level[0] > next_total_levels:
        raise HTTPException(
            409,
            f"Сначала удалите или перенесите награды выше уровня {next_total_levels}",
        )

    if body.name is not None:
        s.name = body.name
    if body.theme is not None:
        s.theme = body.theme
    s.xp_per_level = next_xp_per_level
    s.total_levels = next_total_levels
    if body.is_active is not None:
        s.is_active = body.is_active
    # Только один активный сезон: при активации деактивируем остальные.
    if s.is_active:
        db.query(models.BattlePassSeason).filter(
            models.BattlePassSeason.id != s.id,
            models.BattlePassSeason.is_active.is_(True),
        ).update({models.BattlePassSeason.is_active: False})
    db.commit()
    return {"ok": True, "id": s.id}


@router.delete("/battlepass/season/{season_id}")
def admin_delete_bp_season(season_id: int, db: Session = Depends(get_db)):
    s = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.id == season_id).first()
    if not s:
        raise HTTPException(404, "Сезон не найден")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/battlepass/reward")
def admin_save_bp_reward(body: schemas.AdminBattlePassRewardBody, db: Session = Depends(get_db)):
    reward_id = body.id
    reward = None
    if reward_id is not None:
        reward = db.query(models.BattlePassReward).filter(models.BattlePassReward.id == reward_id).first()
        if reward is None:
            raise HTTPException(404, "Награда не найдена")
        if body.season_id is not None and body.season_id != reward.season_id:
            raise HTTPException(400, "Нельзя перенести награду в другой сезон")
        season_id = reward.season_id
    else:
        season_id = body.season_id

    if season_id is None:
        season = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.is_active.is_(True)).first()
        if not season:
            raise HTTPException(400, "Нет активного сезона")
        season_id = season.id
    else:
        season = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.id == season_id).first()
        if season is None:
            raise HTTPException(404, "Сезон не найден")

    _validate_bp_season_values(season.xp_per_level, season.total_levels)
    if body.level > season.total_levels:
        raise HTTPException(400, "Уровень награды выше максимального уровня сезона")

    if body.item_code is not None:
        item = db.query(models.Item).filter(models.Item.code == body.item_code).first()
        if item is None:
            raise HTTPException(400, "Предмет награды не найден")
        if body.kind == "lootbox":
            pool = db.query(models.LootboxPool).filter(models.LootboxPool.code == item.lootbox_pool_code).first()
            if item.lootbox_pool_code is None or pool is None:
                raise HTTPException(400, "Для награды-ковбокса выберите предмет с настроенным ковбоксом")

    occupied = db.query(models.BattlePassReward).filter(
        models.BattlePassReward.season_id == season_id,
        models.BattlePassReward.level == body.level,
        models.BattlePassReward.track == "free",
    ).first()
    if reward is not None and occupied is not None and occupied.id != reward.id:
        raise HTTPException(409, "На этом уровне уже есть награда")

    if reward is None:
        # Upsert по (season_id, level, free): не плодим дубли на занятом уровне
        # — иначе UniqueConstraint(season_id, level, track) даёт 500.
        reward = occupied
        if reward is None:
            reward = models.BattlePassReward(season_id=season_id, track="free")
            db.add(reward)
    reward.track = "free"
    reward.level = body.level
    reward.kind = body.kind
    reward.value = body.value
    reward.item_code = body.item_code
    reward.label = body.label
    reward.icon = body.icon
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(400, "Не удалось сохранить награду (проверьте уровень/значения)") from exc
    return {"ok": True, "id": reward.id}


@router.delete("/battlepass/reward/{reward_id}")
def admin_delete_bp_reward(reward_id: int, db: Session = Depends(get_db)):
    r = db.query(models.BattlePassReward).filter(models.BattlePassReward.id == reward_id).first()
    if not r:
        raise HTTPException(404, "Награда не найдена")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/battlepass/seed")
def admin_seed_bp_season(body: schemas.AdminBattlePassSeedBody, db: Session = Depends(get_db)):
    """Создать сезон с автозаполнением наград для всех уровней."""
    levels = body.total_levels
    xp_per_level = body.xp_per_level

    # Только один активный сезон: деактивируем прочие перед активацией нового.
    db.query(models.BattlePassSeason).filter(
        models.BattlePassSeason.is_active.is_(True)
    ).update({models.BattlePassSeason.is_active: False})

    season = models.BattlePassSeason(
        name=body.name, theme=body.theme,
        xp_per_level=xp_per_level, total_levels=levels,
        is_active=True,
    )
    db.add(season)
    db.flush()

    for lvl in range(1, levels + 1):
        if lvl % 2 == 0:
            kind, icon, label = "coins", "/static/img/ui/kovbaks.png", f"{lvl * 15} монет"
            value = lvl * 15
        else:
            kind, icon, label = "xp", "/static/img/ui/xp.png", f"{xp_per_level} XP"
            value = xp_per_level

        db.add(models.BattlePassReward(
            season_id=season.id, level=lvl, track="free",
            kind=kind, value=value, label=label, icon=icon,
        ))

    db.commit()
    return {"ok": True, "id": season.id, "total_levels": levels}


@router.post("/battlepass/reset/{user_id}")
def admin_reset_bp(user_id: int, db: Session = Depends(get_db)):
    """Сбросить прогресс пропуска игроку: обнулить XP и все награды."""
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(404, "Пользователь не найден")
    u.xp = 0
    db.query(models.BattlePassClaim).filter(models.BattlePassClaim.user_id == user_id).delete(
        synchronize_session=False,
    )
    db.query(models.UserBattlePass).filter(models.UserBattlePass.user_id == user_id).delete()
    db.commit()
    return {"ok": True}


@router.post("/battlepass/reset-level")
def admin_reset_level(body: schemas.AdminBattlePassResetLevelBody, db: Session = Depends(get_db)):
    """Сбросить конкретный уровень пропуска у игрока."""
    user_id = body.user_id
    level = body.level
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    season = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.is_active.is_(True)).first()
    if not season:
        raise HTTPException(400, "Нет активного сезона")
    _validate_bp_season_values(season.xp_per_level, season.total_levels)
    if level > season.total_levels:
        raise HTTPException(400, "Уровень выше максимального уровня сезона")
    ubp = db.query(models.UserBattlePass).filter(
        models.UserBattlePass.user_id == user_id,
        models.UserBattlePass.season_id == season.id,
    ).first()
    if ubp is not None:
        try:
            claimed = json.loads(ubp.claimed_rewards) if ubp.claimed_rewards else []
        except (json.JSONDecodeError, TypeError) as exc:
            raise HTTPException(409, "Список полученных наград повреждён") from exc
        if not isinstance(claimed, list):
            raise HTTPException(409, "Список полученных наград повреждён")
        ubp.claimed_rewards = json.dumps([
            entry for entry in claimed if _claimed_bp_level(entry) != level
        ])

    reward_ids = [reward_id for (reward_id,) in db.query(models.BattlePassReward.id).filter(
        models.BattlePassReward.season_id == season.id,
        models.BattlePassReward.level == level,
    ).all()]
    deleted_claims = 0
    if reward_ids:
        deleted_claims = db.query(models.BattlePassClaim).filter(
            models.BattlePassClaim.user_id == user_id,
            models.BattlePassClaim.reward_id.in_(reward_ids),
        ).delete(synchronize_session=False)
    if ubp is None and deleted_claims == 0:
        raise HTTPException(404, "У игрока нет прогресса на этом уровне")
    db.commit()
    return {"ok": True, "deleted_claims": deleted_claims}


def _naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _lootbox_item_code(code: str) -> str:
    return code if code.startswith("lootbox_") else f"lootbox_{code}"


CANONICAL_CHEST_CODES = {"common", "rare", "epic", "legendary", "seasonal", "consolation"}


def _validate_managed_lootbox_mode(code: str, opening_mode: str) -> None:
    if code in CANONICAL_CHEST_CODES and opening_mode != "chest_v2":
        raise HTTPException(400, "Основные ковбоксы должны использовать механику сундука")
    if code == "mega" and opening_mode != "choice_v2":
        raise HTTPException(400, "Мегаковбокс зарезервирован для механики выбора предметов")


def _ensure_lootbox_item_link(db: Session, pool: models.LootboxPool) -> models.Item:
    """Repair pre-editor pools that were created without their inventory item."""
    if pool.item is not None:
        return pool.item
    item_code = _lootbox_item_code(pool.code)
    item = db.query(models.Item).filter(models.Item.code == item_code).one_or_none()
    if item is None:
        item = models.Item(
            code=item_code,
            name=pool.name,
            icon=pool.image_url or "/static/img/items/lootbox_common.svg",
            image_url=pool.image_url or "/static/img/items/lootbox_common.svg",
            description="",
            rarity=pool.rarity or "Обычный",
            category="Ковбоксы",
            can_gift=True,
            can_activate=False,
            lootbox_pool_code=pool.code,
        )
        db.add(item)
        db.flush()
    elif item.lootbox_pool_code not in (None, pool.code):
        raise HTTPException(409, f"Предмет {item.code} уже связан с другим ковбоксом")
    pool.item_id = item.id
    item.lootbox_pool_code = pool.code
    item.category = "Ковбоксы"
    item.description = ""
    return item


def _lootbox_out(db: Session, pool: models.LootboxPool) -> schemas.AdminLootboxOut:
    active_random = [entry for entry in pool.entries if entry.is_active and not entry.is_guaranteed]
    active_guaranteed = [entry for entry in pool.entries if entry.is_active and entry.is_guaranteed]
    total = sum(entry.weight for entry in active_random)
    guaranteed_total = sum(entry.weight for entry in active_guaranteed)
    entries = []
    for entry in sorted(pool.entries, key=lambda row: (row.sort_order, row.id)):
        denominator = guaranteed_total if entry.is_guaranteed else total
        percent = (entry.weight / denominator * 100) if denominator else 0.0
        entries.append(schemas.AdminLootboxEntryOut(
            id=entry.id,
            reward_kind=entry.reward_kind,
            item_id=entry.item_id,
            item_name=entry.item.name if entry.item else None,
            item_icon=entry.item.icon if entry.item else None,
            amount_min=entry.amount_min,
            amount_max=entry.amount_max,
            weight=entry.weight,
            normalized_percent=round(percent, 3),
            is_guaranteed=entry.is_guaranteed,
            is_active=entry.is_active,
            sort_order=entry.sort_order,
        ))
    item = _ensure_lootbox_item_link(db, pool)
    return schemas.AdminLootboxOut(
        id=pool.id,
        item_id=item.id,
        item_code=item.code,
        code=pool.code,
        name=pool.name,
        description=pool.description,
        rarity=pool.rarity,
        image_url=pool.image_url,
        opening_mode=pool.opening_mode,
        open_image_url=pool.open_image_url or pool.image_url,
        bonus_item_chance=pool.bonus_item_chance,
        is_active=pool.is_active,
        is_droppable=pool.is_droppable,
        is_archived=pool.is_archived,
        assembly_weight=pool.assembly_weight,
        sale_price=pool.sale_price,
        sale_currency=pool.sale_currency,
        min_user_level=pool.min_user_level,
        max_user_level=pool.max_user_level,
        sort_order=pool.sort_order,
        starts_at=pool.starts_at,
        ends_at=pool.ends_at,
        daily_open_limit=pool.daily_open_limit,
        guaranteed_slots=pool.guaranteed_slots,
        allow_duplicates=pool.allow_duplicates,
        version=pool.version,
        weight_total=total,
        entries=entries,
    )


def _validate_lootbox_entries(
    db: Session,
    entries: list[schemas.AdminLootboxEntryBody],
    *,
    opening_mode: str | None = None,
    bonus_item_chance: int = 0,
    is_active: bool = False,
    guaranteed_slots: int = 1,
    allow_duplicates: bool = True,
) -> None:
    item_ids = {entry.item_id for entry in entries if entry.reward_kind == "item" and entry.item_id}
    items = db.query(models.Item).filter(models.Item.id.in_(item_ids)).all() if item_ids else []
    item_map = {item.id: item for item in items}
    missing = item_ids - item_map.keys()
    if missing:
        raise HTTPException(400, f"Предмет награды не найден: ID {min(missing)}")
    for item in items:
        if item.lootbox_pool_code:
            raise HTTPException(400, "Ковбокс не может выпадать из ковбокса: это создаёт циклическую награду")
    if not is_active:
        return

    active = [entry for entry in entries if entry.is_active]
    guaranteed = [entry for entry in active if entry.is_guaranteed]
    optional = [entry for entry in active if not entry.is_guaranteed]
    if opening_mode == "choice_v2":
        if guaranteed:
            raise HTTPException(400, "В мегаковбоксе все варианты должны участвовать в выборе")
        if len(optional) < 2:
            raise HTTPException(400, "Для выбора нужны минимум две разные награды")
        if not 1 <= guaranteed_slots <= 10:
            raise HTTPException(400, "Количество выборов должно быть от 1 до 10")
        if not allow_duplicates and len(optional) < guaranteed_slots * 2:
            raise HTTPException(400, "Для выборов без повторов нужно по две разные награды на каждый выбор")
        if sum(entry.weight for entry in optional) != 100:
            raise HTTPException(400, "Сумма шансов вариантов должна быть ровно 100%")
        return
    if opening_mode != "chest_v2":
        return
    fragment_entries = [
        entry for entry in guaranteed
        if entry.reward_kind == "item" and item_map.get(entry.item_id) is not None
        and item_map[entry.item_id].code == "box_fragment"
    ]
    xp_entries = [entry for entry in guaranteed if entry.reward_kind == "xp"]
    kovbucks_entries = [entry for entry in guaranteed if entry.reward_kind == "kovbucks"]
    if len(guaranteed) != 3 or len(fragment_entries) != 1 or len(xp_entries) != 1 or len(kovbucks_entries) != 1:
        raise HTTPException(
            400,
            "Сундук должен иметь ровно три гарантированные награды: фрагменты, XP и ковбаксы",
        )
    for entry in optional:
        item = item_map.get(entry.item_id) if entry.reward_kind == "item" else None
        if item is None or item.code == "box_fragment" or item.lootbox_pool_code:
            raise HTTPException(400, "Дополнительной наградой сундука может быть только обычный предмет")
    if not 0 <= bonus_item_chance <= 100:
        raise HTTPException(400, "Шанс дополнительного предмета должен быть от 0 до 100%")
    if bonus_item_chance > 0 and not optional:
        raise HTTPException(400, "Для заданного шанса добавьте хотя бы один обычный предмет")


def _replace_lootbox_entries(
    db: Session,
    pool: models.LootboxPool,
    entries: list[schemas.AdminLootboxEntryBody],
) -> None:
    _validate_lootbox_entries(db, entries)
    pool.entries.clear()
    for entry in entries:
        pool.entries.append(models.LootboxPoolEntry(**entry.model_dump()))


def _apply_lootbox_body(pool: models.LootboxPool, body: schemas.AdminLootboxBody) -> None:
    for field in (
        "name", "rarity", "image_url", "is_active", "is_droppable",
        "is_archived", "assembly_weight", "sale_price", "sale_currency", "min_user_level",
        "max_user_level", "sort_order", "daily_open_limit", "guaranteed_slots", "allow_duplicates",
    ):
        setattr(pool, field, getattr(body, field))
    if body.opening_mode is not None:
        pool.opening_mode = body.opening_mode
    if body.open_image_url is not None:
        pool.open_image_url = body.open_image_url or body.image_url
    elif not pool.open_image_url:
        pool.open_image_url = body.image_url
    if body.bonus_item_chance is not None:
        pool.bonus_item_chance = body.bonus_item_chance
    pool.description = ""
    pool.starts_at = _naive_utc(body.starts_at)
    pool.ends_at = _naive_utc(body.ends_at)
    if pool.is_archived:
        pool.is_droppable = False


@router.get("/lootboxes", response_model=list[schemas.AdminLootboxOut])
def admin_list_lootboxes(
    q: str | None = None,
    active: bool | None = None,
    rarity: str | None = None,
    db: Session = Depends(get_db),
) -> list[schemas.AdminLootboxOut]:
    query = db.query(models.LootboxPool)
    if q:
        term = f"%{q.strip()}%"
        query = query.filter((models.LootboxPool.name.ilike(term)) | (models.LootboxPool.code.ilike(term)))
    if active is not None:
        query = query.filter(models.LootboxPool.is_active.is_(active))
    if rarity:
        query = query.filter(models.LootboxPool.rarity == rarity)
    pools = query.order_by(models.LootboxPool.sort_order, models.LootboxPool.id).all()
    repaired = False
    for pool in pools:
        repaired = repaired or pool.item is None
    result = [_lootbox_out(db, pool) for pool in pools]
    if repaired:
        db.commit()
    return result


@router.post("/lootboxes", response_model=schemas.AdminLootboxOut)
def admin_create_lootbox(
    body: schemas.AdminLootboxBody,
    db: Session = Depends(get_db),
) -> schemas.AdminLootboxOut:
    begin_game_write(db)
    if db.query(models.LootboxPool).filter(models.LootboxPool.code == body.code).first():
        raise HTTPException(409, "Ковбокс с таким внутренним ID уже существует")
    effective_mode = body.opening_mode or "legacy_v1"
    effective_bonus_chance = body.bonus_item_chance or 0
    _validate_managed_lootbox_mode(body.code, effective_mode)
    _validate_lootbox_entries(
        db, body.entries,
        opening_mode=effective_mode,
        bonus_item_chance=effective_bonus_chance,
        is_active=body.is_active,
        guaranteed_slots=body.guaranteed_slots,
        allow_duplicates=body.allow_duplicates,
    )
    item_code = _lootbox_item_code(body.code)
    item = db.query(models.Item).filter(models.Item.code == item_code).first()
    if item and item.lootbox_pool_code not in (None, body.code):
        raise HTTPException(409, "Код предмета уже занят другим ковбоксом")
    if item is None:
        item = models.Item(code=item_code, name=body.name, category="Ковбоксы")
        db.add(item)
        db.flush()
    pool = models.LootboxPool(code=body.code, name=body.name, item_id=item.id)
    db.add(pool)
    db.flush()
    _apply_lootbox_body(pool, body)
    item.name = body.name
    item.description = ""
    item.icon = body.image_url
    item.rarity = body.rarity
    item.category = "Ковбоксы"
    item.lootbox_pool_code = body.code
    sync_lootbox_shop_product(db, pool)
    _replace_lootbox_entries(db, pool, body.entries)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(409, "Не удалось сохранить ковбокс: проверьте уникальный ID") from exc
    return _lootbox_out(db, pool)


@router.patch("/lootboxes/{pool_id}", response_model=schemas.AdminLootboxOut)
def admin_update_lootbox(
    pool_id: int,
    body: schemas.AdminLootboxBody,
    db: Session = Depends(get_db),
) -> schemas.AdminLootboxOut:
    begin_game_write(db)
    pool = db.query(models.LootboxPool).filter(models.LootboxPool.id == pool_id).first()
    if pool is None:
        raise HTTPException(404, "Ковбокс не найден")
    if body.code != pool.code:
        raise HTTPException(400, "Внутренний ID нельзя менять; используйте дублирование")
    effective_mode = body.opening_mode or pool.opening_mode
    effective_bonus_chance = (
        body.bonus_item_chance
        if body.bonus_item_chance is not None
        else pool.bonus_item_chance
    )
    _validate_managed_lootbox_mode(pool.code, effective_mode)
    _validate_lootbox_entries(
        db, body.entries,
        opening_mode=effective_mode,
        bonus_item_chance=effective_bonus_chance,
        is_active=body.is_active,
        guaranteed_slots=body.guaranteed_slots,
        allow_duplicates=body.allow_duplicates,
    )
    _apply_lootbox_body(pool, body)
    if pool.item is None:
        raise HTTPException(409, "У конфигурации отсутствует предмет ковбокса")
    pool.item.name = body.name
    pool.item.description = ""
    pool.item.icon = body.image_url
    pool.item.rarity = body.rarity
    pool.item.lootbox_pool_code = pool.code
    sync_lootbox_shop_product(db, pool)
    pool.version += 1
    _replace_lootbox_entries(db, pool, body.entries)
    db.commit()
    return _lootbox_out(db, pool)


@router.post("/lootboxes/{pool_id}/duplicate", response_model=schemas.AdminLootboxOut)
def admin_duplicate_lootbox(
    pool_id: int,
    body: schemas.AdminLootboxDuplicateBody,
    db: Session = Depends(get_db),
) -> schemas.AdminLootboxOut:
    source = db.query(models.LootboxPool).filter(models.LootboxPool.id == pool_id).first()
    if source is None:
        raise HTTPException(404, "Ковбокс не найден")
    copied = schemas.AdminLootboxBody(
        code=body.code,
        name=body.name,
        rarity=source.rarity,
        image_url=source.image_url,
        opening_mode=source.opening_mode,
        open_image_url=source.open_image_url,
        bonus_item_chance=source.bonus_item_chance,
        is_active=False,
        is_droppable=False,
        assembly_weight=source.assembly_weight,
        sale_price=source.sale_price,
        sale_currency=source.sale_currency,
        min_user_level=source.min_user_level,
        max_user_level=source.max_user_level,
        sort_order=source.sort_order,
        starts_at=source.starts_at,
        ends_at=source.ends_at,
        daily_open_limit=source.daily_open_limit,
        guaranteed_slots=source.guaranteed_slots,
        allow_duplicates=source.allow_duplicates,
        entries=[
            schemas.AdminLootboxEntryBody(
                reward_kind=entry.reward_kind,
                item_id=entry.item_id,
                amount_min=entry.amount_min,
                amount_max=entry.amount_max,
                weight=entry.weight,
                is_guaranteed=entry.is_guaranteed,
                is_active=entry.is_active,
                sort_order=entry.sort_order,
            )
            for entry in source.entries
        ],
    )
    return admin_create_lootbox(body=copied, db=db)


@router.post("/lootboxes/{pool_id}/archive", response_model=schemas.AdminLootboxOut)
def admin_archive_lootbox(pool_id: int, db: Session = Depends(get_db)) -> schemas.AdminLootboxOut:
    begin_game_write(db)
    pool = db.query(models.LootboxPool).filter(models.LootboxPool.id == pool_id).first()
    if pool is None:
        raise HTTPException(404, "Ковбокс не найден")
    pool.is_archived = True
    pool.is_droppable = False
    pool.version += 1
    sync_lootbox_shop_product(db, pool)
    db.commit()
    return _lootbox_out(db, pool)


# Unsafe row-by-row pool mutation was removed: it allowed temporarily empty or
# negative-weight active pools.  Keep explicit responses so old admin clients
# cannot silently bypass the validated atomic editor.
@router.get("/lootbox/pools")
def legacy_admin_list_lootbox_pools():
    raise HTTPException(410, "Используйте редактор /api/admin/lootboxes")


@router.post("/lootbox/pool")
@router.post("/lootbox/entry")
def legacy_admin_mutate_lootbox():
    raise HTTPException(410, "Устаревшее редактирование ковбоксов отключено")


@router.delete("/lootbox/entry/{entry_id}")
def legacy_admin_delete_lootbox_entry(entry_id: int):
    del entry_id
    raise HTTPException(410, "Устаревшее редактирование ковбоксов отключено")
