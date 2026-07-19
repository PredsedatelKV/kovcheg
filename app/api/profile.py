from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import award_xp, ensure_wallet
from app.auth import current_user, is_admin
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/profile", tags=["profile"])
MOSCOW_TZ = ZoneInfo("Europe/Moscow")
MAX_BATTLEPASS_LEVELS = 1_000


def _get_bp_level(db: Session, user: models.User) -> int:
    """Get battlepass level for a user from the active season."""
    season = db.query(models.BattlePassSeason).filter(models.BattlePassSeason.is_active.is_(True)).first()
    if not season:
        return 0
    # Legacy rows could predate admin validation.  A malformed season must not
    # crash profiles, inventory assembly, or any other page that shows a level.
    if not 1 <= season.xp_per_level <= 1_000_000:
        return 0
    if not 1 <= season.total_levels <= MAX_BATTLEPASS_LEVELS:
        return 0
    return min(max(0, user.xp) // season.xp_per_level, season.total_levels - 1) + 1


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
        xp=user.xp,
        is_admin=is_admin(user),
        can_use_clicker=user.telegram_id == 849162365,
    )


@router.get("/players", response_model=list[schemas.PlayerOut])
def list_players(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[schemas.PlayerOut]:
    """Все игроки кроме текущего — для выпадающего списка получателя при переводе."""
    from datetime import datetime, timedelta, timezone
    threshold = datetime.now(timezone.utc) - timedelta(minutes=5)
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
            photo_url=p.photo_url,
            is_online=p.last_seen is not None and p.last_seen.replace(tzinfo=timezone.utc) > threshold,
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
        lootbox_pool_code=item.lootbox_pool_code,
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
            xp_reward=t.xp_reward,
            reward_item_id=t.reward_item_id,
            reward_item_name=t.reward_item.name if t.reward_item else None,
            reward_item_icon=t.reward_item.icon if t.reward_item else None,
            reward_item_quantity=t.reward_item_quantity,
            target_progress=t.target_progress,
            is_daily_plan=t.is_daily_plan,
        ),
        status=ut.status,
        progress=ut.progress,
        started_at=ut.started_at,
        finished_at=ut.finished_at,
    )


def _deliver_pending_login_gifts(db: Session, user: models.User) -> list[schemas.LoginGiftOut]:
    """Deliver every pending admin gift once in one serialized transaction."""
    begin_game_write(db)
    gifts = (
        db.query(models.PendingLoginGift)
        .filter(
            models.PendingLoginGift.user_id == user.id,
            models.PendingLoginGift.delivered_at.is_(None),
        )
        .order_by(models.PendingLoginGift.id)
        .all()
    )
    if not gifts:
        db.rollback()
        return []
    delivered_at = models.now_utc()
    receipts: list[schemas.LoginGiftOut] = []
    for gift in gifts:
        item = gift.item
        if gift.kovbucks:
            wallet = ensure_wallet(db, user)
            if wallet.balance < 0 or wallet.balance > 2_000_000_000 - gift.kovbucks:
                raise HTTPException(409, "Подарок не помещается на баланс ковбаксов")
            wallet.balance += gift.kovbucks
            db.add(models.Transaction(
                sender_id=None,
                recipient_id=user.id,
                amount=gift.kovbucks,
                note=f"login_gift:{gift.id}",
            ))
        if gift.xp:
            award_xp(db, user, gift.xp)
        if gift.item_id is not None:
            if item is None or gift.item_quantity < 1:
                raise HTTPException(409, "Предмет в подарке настроен некорректно")
            inventory = db.query(models.InventoryItem).filter(
                models.InventoryItem.user_id == user.id,
                models.InventoryItem.item_id == gift.item_id,
            ).one_or_none()
            if inventory is None:
                db.add(models.InventoryItem(
                    user_id=user.id,
                    item_id=gift.item_id,
                    quantity=gift.item_quantity,
                ))
            else:
                if inventory.quantity < 0 or inventory.quantity > 2_000_000_000 - gift.item_quantity:
                    raise HTTPException(409, "Подарок не помещается в стек предмета")
                inventory.quantity += gift.item_quantity
        gift.delivered_at = delivered_at
        receipts.append(schemas.LoginGiftOut(
            id=gift.id,
            kovbucks=gift.kovbucks,
            xp=gift.xp,
            item_id=gift.item_id,
            item_name=item.name if item else None,
            item_icon=item.icon if item else None,
            item_quantity=gift.item_quantity,
            delivered_at=delivered_at,
        ))
    db.commit()
    db.refresh(user)
    return receipts


def _pending_login_gifts(db: Session, user: models.User) -> list[schemas.LoginGiftOut]:
    """Preview pending gifts without moving any value until the player claims."""
    gifts = (
        db.query(models.PendingLoginGift)
        .filter(
            models.PendingLoginGift.user_id == user.id,
            models.PendingLoginGift.delivered_at.is_(None),
        )
        .order_by(models.PendingLoginGift.id)
        .all()
    )
    return [
        schemas.LoginGiftOut(
            id=gift.id,
            kovbucks=gift.kovbucks,
            xp=gift.xp,
            item_id=gift.item_id,
            item_name=gift.item.name if gift.item else None,
            item_icon=gift.item.icon if gift.item else None,
            item_quantity=gift.item_quantity,
            delivered_at=None,
        )
        for gift in gifts
    ]


@router.get("/me", response_model=schemas.ProfilePayload)
def me(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> schemas.ProfilePayload:
    pending_gifts = _pending_login_gifts(db, user)
    inventory = (
        db.query(models.InventoryItem).filter(models.InventoryItem.user_id == user.id, models.InventoryItem.quantity > 0).all()
    )
    user_tasks = (
        db.query(models.UserTask).filter(models.UserTask.user_id == user.id, models.UserTask.status == "in_progress").all()
    )
    daily_plan = db.query(models.Task).filter(models.Task.is_daily_plan.is_(True), models.Task.is_active.is_(True)).first()
    return schemas.ProfilePayload(
        user=_user_to_out(user),
        bp_level=_get_bp_level(db, user),
        fragment_assembly_cost=models.LOOTBOX_FRAGMENT_COST,
        inventory=_inventory_to_out(inventory),
        user_tasks=[_user_task_to_out(ut) for ut in user_tasks],
        daily_plan=(
            schemas.TaskOut(
                id=daily_plan.id,
                name=daily_plan.name,
                description=daily_plan.description,
                icon=daily_plan.icon,
                reward=daily_plan.reward,
                xp_reward=daily_plan.xp_reward,
                reward_item_id=daily_plan.reward_item_id,
                reward_item_name=daily_plan.reward_item.name if daily_plan.reward_item else None,
                reward_item_icon=daily_plan.reward_item.icon if daily_plan.reward_item else None,
                reward_item_quantity=daily_plan.reward_item_quantity,
                target_progress=daily_plan.target_progress,
                is_daily_plan=True,
            )
            if daily_plan
            else None
        ),
        login_gifts=pending_gifts,
    )


@router.post("/login-gifts/claim", response_model=schemas.LoginGiftClaimOut)
def claim_login_gifts(
    user: models.User = Depends(current_user), db: Session = Depends(get_db)
) -> schemas.LoginGiftClaimOut:
    """Atomically grant gifts only after the player presses «Забрать»."""
    gifts = _deliver_pending_login_gifts(db, user)
    return schemas.LoginGiftClaimOut(user=_user_to_out(user), gifts=gifts)


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




# NB: статические пути (/transactions и т.п.) объявлены ВЫШЕ динамического
# `/{user_id}`, иначе FastAPI матчит их как user_id и отдаёт 422.
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


@router.get("/{user_id}")
def get_user_profile(
    user_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Получить публичный профиль игрока."""
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    last_seen = target.last_seen
    is_online = bool(
        last_seen and (now - last_seen.replace(tzinfo=timezone.utc)).total_seconds() < 300
    )
    return {
        "id": target.id,
        "first_name": target.first_name or "Игрок",
        "username": target.username,
        "photo_url": target.photo_url,
        "role": target.role,
        "balance": target.wallet.balance if target.wallet else 0,
        "is_online": is_online,
        "bp_level": _get_bp_level(db, target),
    }

@router.post("/transfer", response_model=schemas.UserOut)
def transfer(
    payload: schemas.TransferRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    begin_game_write(db)
    recipient = _resolve_recipient(db, payload.recipient)
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя перевести себе")
    sender_wallet = ensure_wallet(db, user)
    recipient_wallet = ensure_wallet(db, recipient)
    if sender_wallet.balance < payload.amount:
        raise HTTPException(status_code=400, detail="Недостаточно Ковбаксов")
    if recipient_wallet.balance > 2_000_000_000 - payload.amount:
        raise HTTPException(status_code=409, detail="Баланс получателя достиг максимума")
    try:
        sender_wallet.balance -= payload.amount
        recipient_wallet.balance += payload.amount
        db.add(models.Transaction(sender_id=user.id, recipient_id=recipient.id, amount=payload.amount))
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось выполнить перевод") from exc
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
    begin_game_write(db)
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if inv is None or inv.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="Недостаточно предметов")
    if not inv.item.can_gift:
        raise HTTPException(status_code=400, detail="Этот предмет нельзя дарить")
    recipient = _resolve_recipient(db, payload.recipient)
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя дарить себе")
    item_name = inv.item.name
    inv.quantity -= payload.quantity
    if inv.quantity == 0:
        db.delete(inv)
    recipient_inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == recipient.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if recipient_inv is None:
        db.add(models.InventoryItem(user_id=recipient.id, item_id=payload.item_id, quantity=payload.quantity))
    else:
        if recipient_inv.quantity > 2_000_000_000 - payload.quantity:
            raise HTTPException(status_code=409, detail="Стак предмета получателя достиг максимума")
        recipient_inv.quantity += payload.quantity
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
    begin_game_write(db)
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if inv is None or inv.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="Недостаточно предметов")
    if not inv.item.can_gift:
        raise HTTPException(status_code=400, detail="Этот предмет нельзя продавать")
    recipient = _resolve_recipient(db, payload.recipient)
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя продать себе")
    item_name = inv.item.name
    inv.quantity -= payload.quantity
    if inv.quantity == 0:
        db.delete(inv)
    listing = models.MarketListing(
        seller_id=user.id,
        item_id=payload.item_id,
        quantity=payload.quantity,
        price=payload.price,
        is_active=True,
        target_user_id=recipient.id,
    )
    db.add(listing)
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
    begin_game_write(db)
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if inv is None or inv.quantity < 1:
        raise HTTPException(status_code=400, detail="Нет предмета")
    if not inv.item.can_activate:
        raise HTTPException(status_code=400, detail="Этот предмет нельзя активировать")
    xp_by_code = {"exp_scroll": 50, "scroll_of_wisdom": 250}
    if inv.item.code not in xp_by_code:
        raise HTTPException(status_code=400, detail="Для предмета не настроен эффект")
    item_name = inv.item.name
    from app.api._helpers import award_xp
    award_xp(db, user, xp_by_code[inv.item.code])
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


def _weighted_pick(rows, weight_attr: str = "weight"):
    total = sum(getattr(row, weight_attr) for row in rows)
    if total <= 0:
        raise HTTPException(409, "У ковбокса некорректно настроены веса")
    ticket = secrets.randbelow(total)
    upto = 0
    for row in rows:
        upto += getattr(row, weight_attr)
        if ticket < upto:
            return row
    raise HTTPException(409, "Не удалось выбрать награду ковбокса")


def _lootbox_pool_for_item(db: Session, item: models.Item) -> models.LootboxPool | None:
    pool = db.query(models.LootboxPool).filter(models.LootboxPool.item_id == item.id).first()
    if pool is None and item.lootbox_pool_code:
        pool = db.query(models.LootboxPool).filter(models.LootboxPool.code == item.lootbox_pool_code).first()
    return pool


def _validate_openable_pool(db: Session, pool: models.LootboxPool, user: models.User) -> list[models.LootboxPoolEntry]:
    now = models.now_utc()
    if not pool.is_active:
        raise HTTPException(409, "Этот ковбокс временно отключён")
    if pool.starts_at and now < pool.starts_at:
        raise HTTPException(409, "Ковбокс ещё недоступен")
    if pool.ends_at and now >= pool.ends_at:
        raise HTTPException(409, "Срок открытия ковбокса закончился")
    level = _get_bp_level(db, user)
    if pool.min_user_level is not None and level < pool.min_user_level:
        raise HTTPException(403, f"Ковбокс доступен с уровня {pool.min_user_level}")
    if pool.max_user_level is not None and level > pool.max_user_level:
        raise HTTPException(403, f"Ковбокс доступен до уровня {pool.max_user_level}")
    entries = [entry for entry in pool.entries if entry.is_active]
    if not entries:
        raise HTTPException(409, "В ковбоксе не настроены награды")
    supported = {"item", "kovbucks", "kovcoins", "xp"}
    for entry in entries:
        if entry.reward_kind not in supported or entry.weight <= 0:
            raise HTTPException(409, "Конфигурация наград ковбокса некорректна")
        if entry.amount_min < 1 or entry.amount_max < entry.amount_min or entry.amount_max > 1_000_000:
            raise HTTPException(409, "Количество награды ковбокса настроено некорректно")
        if entry.reward_kind == "item" and (entry.item is None or entry.item.lootbox_pool_code):
            raise HTTPException(409, "Предмет награды ковбокса удалён или создаёт циклическую награду")
    if not 1 <= pool.guaranteed_slots <= 10:
        raise HTTPException(409, "Количество слотов ковбокса настроено некорректно")
    return entries


def _opening_day_bounds_utc() -> tuple[datetime, datetime]:
    now_moscow = datetime.now(MOSCOW_TZ)
    start_moscow = now_moscow.replace(hour=0, minute=0, second=0, microsecond=0)
    end_moscow = start_moscow + timedelta(days=1)
    return (
        start_moscow.astimezone(timezone.utc).replace(tzinfo=None),
        end_moscow.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _reward_label(kind: str, amount: int, item: models.Item | None = None) -> str:
    if kind == "item" and item:
        return f"{item.name} ×{amount}"
    units = {"kovbucks": "ковбаксов", "kovcoins": "ковкойнов", "xp": "XP"}
    return f"{amount} {units[kind]}"


def _opening_result(
    opening: models.LootboxOpen,
    user: models.User,
    *,
    replayed: bool,
) -> schemas.LootboxOpenResult:
    rewards = [
        schemas.LootboxRewardOut(
            kind=reward.reward_kind,
            amount=reward.amount,
            label=_reward_label(reward.reward_kind, reward.amount, reward.item),
            item=_item_to_out(reward.item) if reward.item else None,
        )
        for reward in opening.rewards
    ]
    first_item = next((reward for reward in rewards if reward.item), None)
    return schemas.LootboxOpenResult(
        request_id=opening.request_id,
        rewards=rewards,
        replayed=replayed,
        balance=user.wallet.balance if user.wallet else 0,
        xp=user.xp,
        item=first_item.item if first_item else None,
        quantity=first_item.amount if first_item else 0,
    )


def open_lootbox_for_user(
    body: schemas.OpenLootboxRequest,
    user: models.User,
    db: Session,
) -> schemas.LootboxOpenResult:
    """Consume and reward one box in a serialized, idempotent transaction."""
    begin_game_write(db)
    existing = db.query(models.LootboxOpen).filter(
        models.LootboxOpen.user_id == user.id,
        models.LootboxOpen.request_id == body.request_id,
    ).first()
    if existing:
        if existing.lootbox_item_id != body.item_id:
            raise HTTPException(409, "Этот идентификатор запроса уже использован для другого ковбокса")
        return _opening_result(existing, user, replayed=True)

    item = db.query(models.Item).filter(models.Item.id == body.item_id).first()
    if item is None or not item.lootbox_pool_code:
        raise HTTPException(404, "Ковбокс не найден")
    pool = _lootbox_pool_for_item(db, item)
    if pool is None:
        raise HTTPException(409, "Для ковбокса отсутствует серверная конфигурация")
    entries = _validate_openable_pool(db, pool, user)

    if pool.daily_open_limit:
        day_start, day_end = _opening_day_bounds_utc()
        opened_today = db.query(models.LootboxOpen).filter(
            models.LootboxOpen.user_id == user.id,
            models.LootboxOpen.pool_id == pool.id,
            models.LootboxOpen.created_at >= day_start,
            models.LootboxOpen.created_at < day_end,
        ).count()
        if opened_today >= pool.daily_open_limit:
            raise HTTPException(429, "Суточный лимит открытия этого ковбокса исчерпан")

    inventory = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == item.id,
    ).first()
    if inventory is None or inventory.quantity < 1:
        raise HTTPException(409, "У вас нет этого ковбокса")

    guaranteed = [entry for entry in entries if entry.is_guaranteed]
    random_entries = [entry for entry in entries if not entry.is_guaranteed]
    selected = []
    available = list(guaranteed)
    for _ in range(pool.guaranteed_slots if guaranteed else 0):
        if not available:
            break
        chosen = _weighted_pick(available)
        selected.append(chosen)
        if not pool.allow_duplicates:
            available.remove(chosen)
    if random_entries:
        selected.append(_weighted_pick(random_entries))
    if not selected:
        raise HTTPException(409, "У ковбокса нет доступных наград")

    inventory.quantity -= 1
    if inventory.quantity == 0:
        db.delete(inventory)
    opening = models.LootboxOpen(
        request_id=body.request_id,
        user_id=user.id,
        lootbox_item_id=item.id,
        pool_id=pool.id,
        pool_version=pool.version,
    )
    db.add(opening)
    db.flush()

    for entry in selected:
        amount = entry.amount_min + secrets.randbelow(entry.amount_max - entry.amount_min + 1)
        if entry.reward_kind == "item":
            reward_inventory = db.query(models.InventoryItem).filter(
                models.InventoryItem.user_id == user.id,
                models.InventoryItem.item_id == entry.item_id,
            ).first()
            if reward_inventory:
                if reward_inventory.quantity > 2_000_000_000 - amount:
                    raise HTTPException(409, "Достигнут максимальный размер стака предмета")
                reward_inventory.quantity += amount
            else:
                db.add(models.InventoryItem(user_id=user.id, item_id=entry.item_id, quantity=amount))
        elif entry.reward_kind == "kovbucks":
            wallet = ensure_wallet(db, user)
            if wallet.balance > 2_000_000_000 - amount:
                raise HTTPException(409, "Достигнут максимальный баланс ковбаксов")
            wallet.balance += amount
            db.add(models.Transaction(
                recipient_id=user.id,
                amount=amount,
                note=f"lootbox:{pool.code}:open:{opening.id}",
            ))
        elif entry.reward_kind == "xp":
            award_xp(db, user, amount)
        elif entry.reward_kind == "kovcoins":
            clicker = db.query(models.ClickerState).filter(models.ClickerState.user_id == user.id).first()
            if clicker:
                if clicker.kovcoins > 2_000_000_000 - amount:
                    raise HTTPException(409, "Достигнут максимальный баланс ковкойнов")
                clicker.kovcoins += amount
            else:
                db.add(models.ClickerState(user_id=user.id, kovcoins=amount))
        db.add(models.LootboxOpenReward(
            opening_id=opening.id,
            reward_kind=entry.reward_kind,
            item_id=entry.item_id if entry.reward_kind == "item" else None,
            amount=amount,
        ))
    db.commit()
    db.refresh(opening)
    db.refresh(user)
    return _opening_result(opening, user, replayed=False)


@router.post("/inventory/open-lootbox", response_model=schemas.LootboxOpenResult)
def open_inventory_lootbox(
    body: schemas.OpenLootboxRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.LootboxOpenResult:
    return open_lootbox_for_user(body=body, user=user, db=db)


@router.post("/inventory/assemble-fragments")
def assemble_fragments(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Assemble the fixed server-side fragment cost into one active Kovbox."""
    begin_game_write(db)
    fragment_item = db.query(models.Item).filter(models.Item.code == "box_fragment").first()
    if not fragment_item:
        raise HTTPException(404, "Предмет «Фрагмент ковбокса» не найден")
    inventory = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == fragment_item.id,
    ).first()
    cost = models.LOOTBOX_FRAGMENT_COST
    if not inventory or inventory.quantity < cost:
        raise HTTPException(400, f"Нужно {cost} фрагментов для сборки")

    now = models.now_utc()
    level = _get_bp_level(db, user)
    candidates = []
    for pool in db.query(models.LootboxPool).all():
        item = pool.item
        if (
            item is None
            or not pool.is_active
            or not pool.is_droppable
            or pool.is_archived
            or pool.assembly_weight <= 0
            or (pool.starts_at and now < pool.starts_at)
            or (pool.ends_at and now >= pool.ends_at)
            or (pool.min_user_level is not None and level < pool.min_user_level)
            or (pool.max_user_level is not None and level > pool.max_user_level)
        ):
            continue
        try:
            _validate_openable_pool(db, pool, user)
        except HTTPException:
            continue
        candidates.append(pool)
    if not candidates:
        raise HTTPException(503, "Нет активных ковбоксов для сборки")
    selected_pool = _weighted_pick(candidates, "assembly_weight")
    lootbox_item = selected_pool.item

    inventory.quantity -= cost
    remaining_fragments = inventory.quantity
    if inventory.quantity == 0:
        db.delete(inventory)
    target = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == lootbox_item.id,
    ).first()
    if target:
        if target.quantity >= 2_000_000_000:
            raise HTTPException(409, "Достигнут максимальный размер стака ковбоксов")
        target.quantity += 1
    else:
        db.add(models.InventoryItem(user_id=user.id, item_id=lootbox_item.id, quantity=1))
    db.commit()
    return {
        "ok": True,
        "item_name": lootbox_item.name,
        "item_icon": lootbox_item.icon,
        "remaining_fragments": remaining_fragments,
        "fragment_assembly_cost": cost,
    }
