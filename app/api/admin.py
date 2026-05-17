from __future__ import annotations

import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import is_admin, require_admin
from app.db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])

UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _normalize_image_url(url: str | None) -> str | None:
    if url is None:
        return None
    trimmed = url.strip()
    return trimmed if trimmed else None


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
        is_admin=is_admin(u),
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
    )


def _shop_product_out(p: models.ShopProduct) -> schemas.ShopProductOut:
    return schemas.ShopProductOut(id=p.id, item=_item_out(p.item), price=p.price)


def _market_listing_out(l: models.MarketListing) -> schemas.MarketListingOut:
    return schemas.MarketListingOut(
        id=l.id,
        seller_id=l.seller_id,
        seller_name=l.seller.first_name if l.seller else "",
        item=_item_out(l.item),
        quantity=l.quantity,
        price=l.price,
    )


def _task_out(t: models.Task) -> schemas.TaskOut:
    return schemas.TaskOut(
        id=t.id,
        name=t.name,
        description=t.description,
        icon=t.icon,
        reward=t.reward,
        target_progress=t.target_progress,
        is_daily_plan=t.is_daily_plan,
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
    return schemas.AdminMeta(
        items=[_item_out(i) for i in items],
        users=[_admin_user_out(u) for u in users],
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


@router.post("/users/{user_id}/balance", response_model=schemas.AdminUserOut)
def adjust_balance(user_id: int, body: schemas.AdminBalanceUpdate, db: Session = Depends(get_db)) -> schemas.AdminUserOut:
    u = db.query(models.User).filter(models.User.id == user_id).one_or_none()
    if u is None or u.wallet is None:
        raise HTTPException(status_code=404, detail="Игрок не найден")
    new_balance = u.wallet.balance + body.delta
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Баланс не может быть отрицательным")
    u.wallet.balance = new_balance
    db.add(
        models.Transaction(
            sender_id=None if body.delta >= 0 else u.id,
            recipient_id=u.id if body.delta >= 0 else None,
            amount=abs(body.delta),
            note=body.note or "admin",
        )
    )
    db.commit()
    db.refresh(u)
    return _admin_user_out(u)


@router.post("/users/{user_id}/inventory", response_model=list[schemas.InventoryItemOut])
def adjust_inventory(user_id: int, body: schemas.AdminInventoryUpdate, db: Session = Depends(get_db)) -> list[schemas.InventoryItemOut]:
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


# ------- items (catalog) -------

@router.get("/items", response_model=list[schemas.ItemOut])
def list_items(db: Session = Depends(get_db)) -> list[schemas.ItemOut]:
    rows = db.query(models.Item).order_by(models.Item.name).all()
    return [_item_out(i) for i in rows]


@router.post("/items", response_model=schemas.ItemOut)
def create_item(body: schemas.AdminItemBody, db: Session = Depends(get_db)) -> schemas.ItemOut:
    if db.query(models.Item).filter(models.Item.code == body.code).one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Предмет с таким кодом уже есть")
    data = body.model_dump()
    data["image_url"] = _normalize_image_url(data.get("image_url"))
    item = models.Item(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.patch("/items/{item_id}", response_model=schemas.ItemOut)
def update_item(item_id: int, body: schemas.AdminItemBody, db: Session = Depends(get_db)) -> schemas.ItemOut:
    item = db.query(models.Item).filter(models.Item.id == item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    for k, v in body.model_dump().items():
        if k == "image_url":
            v = _normalize_image_url(v)
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return _item_out(item)


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

@router.get("/tasks", response_model=list[schemas.TaskOut])
def list_tasks(db: Session = Depends(get_db)) -> list[schemas.TaskOut]:
    rows = db.query(models.Task).order_by(models.Task.is_daily_plan.desc(), models.Task.sort_order, models.Task.id).all()
    return [_task_out(t) for t in rows]


@router.post("/tasks", response_model=schemas.TaskOut)
def create_task(body: schemas.AdminTaskBody, db: Session = Depends(get_db)) -> schemas.TaskOut:
    t = models.Task(**body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _task_out(t)


@router.patch("/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: int, body: schemas.AdminTaskBody, db: Session = Depends(get_db)) -> schemas.TaskOut:
    t = db.query(models.Task).filter(models.Task.id == task_id).one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _task_out(t)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    t = db.query(models.Task).filter(models.Task.id == task_id).one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    db.query(models.UserTask).filter(models.UserTask.task_id == t.id).delete()
    db.delete(t)
    db.commit()
    return {"ok": True}


# ------- shop -------

@router.get("/shop", response_model=list[schemas.ShopProductOut])
def list_shop(db: Session = Depends(get_db)) -> list[schemas.ShopProductOut]:
    rows = db.query(models.ShopProduct).order_by(models.ShopProduct.id).all()
    return [_shop_product_out(p) for p in rows]


@router.post("/shop", response_model=schemas.ShopProductOut)
def create_shop(body: schemas.AdminShopProductBody, db: Session = Depends(get_db)) -> schemas.ShopProductOut:
    item = db.query(models.Item).filter(models.Item.id == body.item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    p = models.ShopProduct(item_id=body.item_id, price=body.price, is_active=body.is_active)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _shop_product_out(p)


@router.patch("/shop/{product_id}", response_model=schemas.ShopProductOut)
def update_shop(product_id: int, body: schemas.AdminShopProductBody, db: Session = Depends(get_db)) -> schemas.ShopProductOut:
    p = db.query(models.ShopProduct).filter(models.ShopProduct.id == product_id).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Товар не найден")
    p.item_id = body.item_id
    p.price = body.price
    p.is_active = body.is_active
    db.commit()
    db.refresh(p)
    return _shop_product_out(p)


@router.delete("/shop/{product_id}")
def delete_shop(product_id: int, db: Session = Depends(get_db)) -> dict:
    p = db.query(models.ShopProduct).filter(models.ShopProduct.id == product_id).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Товар не найден")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ------- market -------

@router.get("/market", response_model=list[schemas.MarketListingOut])
def list_market(db: Session = Depends(get_db)) -> list[schemas.MarketListingOut]:
    rows = db.query(models.MarketListing).order_by(models.MarketListing.id.desc()).all()
    return [_market_listing_out(l) for l in rows]


@router.post("/market", response_model=schemas.MarketListingOut)
def create_market(body: schemas.AdminMarketListingBody, db: Session = Depends(get_db)) -> schemas.MarketListingOut:
    l = models.MarketListing(
        seller_id=body.seller_id,
        item_id=body.item_id,
        quantity=body.quantity,
        price=body.price,
        is_active=body.is_active,
    )
    db.add(l)
    db.commit()
    db.refresh(l)
    return _market_listing_out(l)


@router.patch("/market/{listing_id}", response_model=schemas.MarketListingOut)
def update_market(listing_id: int, body: schemas.AdminMarketListingBody, db: Session = Depends(get_db)) -> schemas.MarketListingOut:
    l = db.query(models.MarketListing).filter(models.MarketListing.id == listing_id).one_or_none()
    if l is None:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    l.seller_id = body.seller_id
    l.item_id = body.item_id
    l.quantity = body.quantity
    l.price = body.price
    l.is_active = body.is_active
    db.commit()
    db.refresh(l)
    return _market_listing_out(l)


@router.delete("/market/{listing_id}")
def delete_market(listing_id: int, db: Session = Depends(get_db)) -> dict:
    l = db.query(models.MarketListing).filter(models.MarketListing.id == listing_id).one_or_none()
    if l is None:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    db.delete(l)
    db.commit()
    return {"ok": True}


# ------- wheel prizes -------

@router.get("/wheel", response_model=list[schemas.WheelPrizeOut])
def list_wheel(db: Session = Depends(get_db)) -> list[schemas.WheelPrizeOut]:
    rows = db.query(models.WheelPrize).order_by(models.WheelPrize.sort_order, models.WheelPrize.id).all()
    return [_wheel_prize_out(p) for p in rows]


@router.post("/wheel", response_model=schemas.WheelPrizeOut)
def create_wheel(body: schemas.AdminWheelPrizeBody, db: Session = Depends(get_db)) -> schemas.WheelPrizeOut:
    p = models.WheelPrize(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _wheel_prize_out(p)


@router.patch("/wheel/{prize_id}", response_model=schemas.WheelPrizeOut)
def update_wheel(prize_id: int, body: schemas.AdminWheelPrizeBody, db: Session = Depends(get_db)) -> schemas.WheelPrizeOut:
    p = db.query(models.WheelPrize).filter(models.WheelPrize.id == prize_id).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Приз не найден")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _wheel_prize_out(p)


@router.delete("/wheel/{prize_id}")
def delete_wheel(prize_id: int, db: Session = Depends(get_db)) -> dict:
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
