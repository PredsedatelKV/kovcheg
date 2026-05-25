from __future__ import annotations

import re
import time
import uuid
from datetime import datetime
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
    return schemas.ShopProductOut(id=p.id, item=_item_out(p.item), price=p.price, stock=p.stock)


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
    if body.mode == "set":
        new_balance = body.delta
        tx_amount = body.delta
        tx_sender = None
        tx_recipient = u.id
    elif body.mode == "sub":
        new_balance = u.wallet.balance - body.delta
        tx_amount = body.delta
        tx_sender = u.id
        tx_recipient = None
    else:
        new_balance = u.wallet.balance + body.delta
        tx_amount = body.delta
        tx_sender = None if body.delta >= 0 else u.id
        tx_recipient = u.id if body.delta >= 0 else None
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Баланс не может быть отрицательным")
    u.wallet.balance = new_balance
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

@router.get("/items", response_model=list[schemas.ItemOut])
def list_items(db: Session = Depends(get_db)) -> list[schemas.ItemOut]:
    rows = db.query(models.Item).order_by(models.Item.name).all()
    return [_item_out(i) for i in rows]


@router.post("/items", response_model=schemas.ItemOut)
def create_item(body: schemas.AdminItemBody, db: Session = Depends(get_db)) -> schemas.ItemOut:
    if db.query(models.Item).filter(models.Item.code == body.code).one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Предмет с таким кодом уже есть")
    item = models.Item(**body.model_dump())
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
    ut = db.query(models.UserTask).filter(models.UserTask.id == user_task_id).one_or_none()
    if ut is None:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    if ut.status != "in_progress":
        raise HTTPException(status_code=400, detail="Задание не в процессе")
    ut.status = "done"
    ut.progress = ut.task.target_progress
    ut.finished_at = datetime.utcnow()
    ut.user.wallet.balance += ut.task.reward
    if ut.task.xp_reward:
        ut.user.xp += ut.task.xp_reward
    db.add(
        models.Transaction(
            sender_id=None,
            recipient_id=ut.user_id,
            amount=ut.task.reward,
            note=f"task:{ut.task.id}:admin_approved",
        )
    )
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
    item = db.query(models.Item).filter(models.Item.id == body.item_id).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Предмет не найден")
    p = models.ShopProduct(item_id=body.item_id, price=body.price, is_active=body.is_active, stock=body.stock)
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
    p.stock = body.stock
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


# ------- quizzes -------

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
    q = models.Quiz(**body.model_dump())
    db.add(q)
    db.commit()
    db.refresh(q)
    return _quiz_out(q)


@router.patch("/quizzes/{quiz_id}", response_model=schemas.QuizOut)
def update_quiz(quiz_id: int, body: schemas.QuizBody, db: Session = Depends(get_db)) -> schemas.QuizOut:
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    for k, v in body.model_dump().items():
        setattr(q, k, v)
    db.commit()
    db.refresh(q)
    return _quiz_out(q)


@router.delete("/quizzes/{quiz_id}")
def delete_quiz(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    db.delete(q)
    db.commit()
    return {"ok": True}


@router.post("/quizzes/{quiz_id}/questions", response_model=schemas.QuizQuestionOut)
def add_question(quiz_id: int, body: schemas.QuizQuestionBody, db: Session = Depends(get_db)) -> schemas.QuizQuestionOut:
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
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
    qq = db.query(models.QuizQuestion).filter(models.QuizQuestion.id == q_id, models.QuizQuestion.quiz_id == quiz_id).one_or_none()
    if qq is None:
        raise HTTPException(status_code=404, detail="Вопрос не найден")
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

@router.get("/battlepass/seasons")
def admin_list_bp_seasons(db: Session = Depends(get_db)):
    seasons = db.query(models.BattlePassSeason).order_by(models.BattlePassSeason.created_at.desc()).all()
    result = []
    for s in seasons:
        rewards = [
            {"id": r.id, "level": r.level, "kind": r.kind,
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
def admin_save_bp_season(body: dict, db: Session = Depends(get_db)):
    season_id = body.get("id")
    if season_id:
        s = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.id == season_id).first()
        if not s:
            raise HTTPException(404, "Сезон не найден")
    else:
        s = models.BattlePassSeason(name="Новый сезон")
        db.add(s)
        db.flush()
    for field in ("name", "theme", "xp_per_level", "total_levels", "is_active"):
        if field in body:
            setattr(s, field, body[field])
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
def admin_save_bp_reward(body: dict, db: Session = Depends(get_db)):
    reward_id = body.get("id")
    season_id = body.get("season_id")
    if not season_id:
        season = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.is_active == True).first()
        if not season:
            raise HTTPException(400, "Нет активного сезона")
        season_id = season.id

    if reward_id:
        r = db.query(models.BattlePassReward).filter(models.BattlePassReward.id == reward_id).first()
        if not r:
            raise HTTPException(404, "Награда не найдена")
    else:
        r = models.BattlePassReward(season_id=season_id, track="free")
        db.add(r)
        db.flush()
    for field in ("level", "kind", "value", "item_code", "label", "icon"):
        if field in body:
            setattr(r, field, body[field])
    db.commit()
    return {"ok": True, "id": r.id}


@router.delete("/battlepass/reward/{reward_id}")
def admin_delete_bp_reward(reward_id: int, db: Session = Depends(get_db)):
    r = db.query(models.BattlePassReward).filter(models.BattlePassReward.id == reward_id).first()
    if not r:
        raise HTTPException(404, "Награда не найдена")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/battlepass/seed")
def admin_seed_bp_season(body: dict, db: Session = Depends(get_db)):
    """Создать сезон с автозаполнением наград для всех уровней."""
    levels = body.get("total_levels", 100)
    xp_per_level = body.get("xp_per_level", 100)
    name = body.get("name", "Новый сезон")

    season = models.BattlePassSeason(
        name=name, theme=body.get("theme", "summer"),
        xp_per_level=xp_per_level, total_levels=levels,
        is_active=True,
    )
    db.add(season)
    db.flush()

    for lvl in range(1, levels + 1):
        if lvl % 2 == 0:
            kind, icon, label = "coins", "/static/img/ui/coin.svg", f"{lvl * 15} монет"
            value = lvl * 15
        else:
            kind, icon, label = "xp", "/static/img/item_icons/xp.svg", f"{xp_per_level} XP"
            value = xp_per_level

        db.add(models.BattlePassReward(
            season_id=season.id, level=lvl, track="free",
            kind=kind, value=value, label=label, icon=icon,
        ))

    db.commit()
    return {"ok": True, "id": season.id, "total_levels": levels}


@router.post("/battlepass/reset/{user_id}")
def admin_reset_bp(user_id: int, db: Session = Depends(get_db)):
    """Сбросить прогресс пропуска игроку: обнулить XP."""
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(404, "Пользователь не найден")
    u.xp = 0
    db.query(models.UserBattlePass).filter(models.UserBattlePass.user_id == user_id).delete()
    db.commit()
    return {"ok": True}
