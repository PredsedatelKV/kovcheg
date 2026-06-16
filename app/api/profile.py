from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet
from app.auth import current_user, is_admin
from app.db import get_db

router = APIRouter(prefix="/api/profile", tags=["profile"])


def _user_to_out(user: models.User) -> schemas.UserOut:
    return schemas.UserOut(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        photo_url=user.photo_url,
        role=user.role,
        restrictions=user.restrictions,
        balance=user.wallet.balance if user.wallet else 0,
        is_admin=is_admin(user),
    )


@router.get("/players", response_model=list[schemas.PlayerOut])
def list_players(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[schemas.PlayerOut]:
    """Все игроки кроме текущего — для выпадающего списка получателя при переводе."""
    rows = (
        db.query(models.User)
        .filter(models.User.id != user.id)
        .order_by(models.User.first_name)
        .all()
    )
    return [
        schemas.PlayerOut(
            id=p.id,
            telegram_id=p.telegram_id,
            username=p.username,
            first_name=p.first_name,
            role=p.role,
        )
        for p in rows
    ]


def _item_to_out(item: models.Item) -> schemas.ItemOut:
    return schemas.ItemOut(
        id=item.id,
        code=item.code,
        name=item.name,
        description=item.description,
        icon=item.icon,
        image_url=item.image_url,
        rarity=item.rarity,
        category=item.category,
        can_gift=item.can_gift,
        can_activate=item.can_activate,
    )


def _inventory_to_out(rows: list[models.InventoryItem]) -> list[schemas.InventoryItemOut]:
    return [
        schemas.InventoryItemOut(id=row.id, item=_item_to_out(row.item), quantity=row.quantity)
        for row in rows
        if row.quantity > 0
    ]


def _user_task_to_out(ut: models.UserTask) -> schemas.UserTaskOut:
    t = ut.task
    return schemas.UserTaskOut(
        id=ut.id,
        task=schemas.TaskOut(
            id=t.id,
            name=t.name,
            description=t.description,
            icon=t.icon,
            reward=t.reward,
            target_progress=t.target_progress,
            is_daily_plan=t.is_daily_plan,
        ),
        status=ut.status,
        progress=ut.progress,
        started_at=ut.started_at,
        finished_at=ut.finished_at,
    )


@router.get("/me", response_model=schemas.ProfilePayload)
def me(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> schemas.ProfilePayload:
    inventory = (
        db.query(models.InventoryItem).filter(models.InventoryItem.user_id == user.id, models.InventoryItem.quantity > 0).all()
    )
    user_tasks = (
        db.query(models.UserTask).filter(models.UserTask.user_id == user.id, models.UserTask.status == "in_progress").all()
    )
    daily_plan = db.query(models.Task).filter(models.Task.is_daily_plan.is_(True), models.Task.is_active.is_(True)).first()
    return schemas.ProfilePayload(
        user=_user_to_out(user),
        inventory=_inventory_to_out(inventory),
        user_tasks=[_user_task_to_out(ut) for ut in user_tasks],
        daily_plan=(
            schemas.TaskOut(
                id=daily_plan.id,
                name=daily_plan.name,
                description=daily_plan.description,
                icon=daily_plan.icon,
                reward=daily_plan.reward,
                target_progress=daily_plan.target_progress,
                is_daily_plan=True,
            )
            if daily_plan
            else None
        ),
    )


def _resolve_recipient(db: Session, recipient: str) -> models.User:
    recipient = recipient.strip().lstrip("@")
    user: models.User | None = None
    if recipient.startswith("uid:"):
        # internal user id (used by player picker)
        rest = recipient[4:]
        if rest.isdigit():
            user = db.query(models.User).filter(models.User.id == int(rest)).one_or_none()
    elif recipient.isdigit():
        user = db.query(models.User).filter(models.User.telegram_id == int(recipient)).one_or_none()
    else:
        user = db.query(models.User).filter(models.User.username == recipient).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден. Попроси его зайти в mini-app хотя бы раз.")
    return user


@router.post("/transfer", response_model=schemas.UserOut)
def transfer(
    payload: schemas.TransferRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    recipient = _resolve_recipient(db, payload.recipient)
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя перевести себе")
    sender_wallet = ensure_wallet(db, user)
    recipient_wallet = ensure_wallet(db, recipient)
    if sender_wallet.balance < payload.amount:
        raise HTTPException(status_code=400, detail="Недостаточно Ковбаксов")
    try:
        sender_wallet.balance -= payload.amount
        recipient_wallet.balance += payload.amount
        db.add(models.Transaction(sender_id=user.id, recipient_id=recipient.id, amount=payload.amount))
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Не удалось выполнить перевод")
    db.refresh(user)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"💸 <b>{user.first_name}</b> перевел(а) <b>{payload.amount} Ковбаксов</b> → <b>{recipient.first_name}</b>"
    )
    return _user_to_out(user)


@router.post("/inventory/gift", response_model=schemas.ProfilePayload)
def gift_item(
    payload: schemas.GiftRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.ProfilePayload:
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if inv is None or inv.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="Недостаточно предметов")
    if not inv.item.can_gift:
        raise HTTPException(status_code=400, detail="Этот предмет нельзя дарить")
    item_name = inv.item.name
    recipient = _resolve_recipient(db, payload.recipient)
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя дарить себе")
    inv.quantity -= payload.quantity
    recipient_inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == recipient.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if recipient_inv is None:
        db.add(models.InventoryItem(user_id=recipient.id, item_id=payload.item_id, quantity=payload.quantity))
    else:
        recipient_inv.quantity += payload.quantity
    if inv.quantity == 0:
        db.delete(inv)
    db.commit()
    db.refresh(user)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"🎁 <b>{user.first_name}</b> подарил(а) <b>{item_name}</b> ×{payload.quantity} → <b>{recipient.first_name}</b>"
    )
    return me(user=user, db=db)


@router.post("/inventory/sell", response_model=schemas.ProfilePayload)
def sell_item(
    payload: schemas.SellRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.ProfilePayload:
    """Выставить предмет на адресную продажу выбранному игроку.
    Предмет резервируется (списывается из инвентаря) и появляется у покупателя в Коверне с пометкой «Это для тебя»."""
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if inv is None or inv.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="Недостаточно предметов")
    if not inv.item.can_gift:
        raise HTTPException(status_code=400, detail="Этот предмет нельзя передавать/продавать")
    item_name = inv.item.name
    recipient = _resolve_recipient(db, payload.recipient)
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя продать себе")
    inv.quantity -= payload.quantity
    listing = models.MarketListing(
        seller_id=user.id,
        item_id=payload.item_id,
        quantity=payload.quantity,
        price=payload.price,
        is_active=True,
        target_user_id=recipient.id,
    )
    db.add(listing)
    if inv.quantity == 0:
        db.delete(inv)
    db.commit()
    db.refresh(user)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"🏷️ <b>{user.first_name}</b> выставил(а) на адресную продажу: <b>{item_name}</b> ×{payload.quantity} за {payload.price} Ковбаксов → <b>{recipient.first_name}</b>"
    )
    return me(user=user, db=db)


@router.post("/inventory/activate", response_model=schemas.ProfilePayload)
def activate_item(
    payload: schemas.GiftRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.ProfilePayload:
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if inv is None or inv.quantity < 1:
        raise HTTPException(status_code=400, detail="Нет предмета")
    if not inv.item.can_activate:
        raise HTTPException(status_code=400, detail="Этот предмет нельзя активировать")
    item_name = inv.item.name
    inv.quantity -= 1
    if inv.quantity == 0:
        db.delete(inv)
    db.commit()
    db.refresh(user)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"✨ <b>{user.first_name}</b> активировал(а) <b>{item_name}</b>"
    )
    return me(user=user, db=db)


@router.get("/transactions", response_model=list[schemas.TransactionOut])
def list_transactions(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[schemas.TransactionOut]:
    txns = (
        db.query(models.Transaction)
        .filter(
            (models.Transaction.sender_id == user.id) | (models.Transaction.recipient_id == user.id)
        )
        .order_by(models.Transaction.created_at.desc())
        .limit(100)
        .all()
    )
    user_ids = set()
    for t in txns:
        if t.sender_id:
            user_ids.add(t.sender_id)
        if t.recipient_id:
            user_ids.add(t.recipient_id)
    user_map = {}
    if user_ids:
        for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all():
            user_map[u.id] = u.first_name or "—"
    return [
        schemas.TransactionOut(
            id=t.id,
            sender_id=t.sender_id,
            sender_name=user_map.get(t.sender_id) if t.sender_id else None,
            recipient_id=t.recipient_id,
            recipient_name=user_map.get(t.recipient_id) if t.recipient_id else None,
            amount=t.amount,
            note=t.note,
            created_at=t.created_at,
        )
        for t in txns
    ]
