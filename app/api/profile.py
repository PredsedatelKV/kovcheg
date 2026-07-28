from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.access import can_use_clicker, maintenance_sections, uses_limited_lootbox_stock
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
    return min(max(1, int(getattr(user, "level", 1) or 1)), season.total_levels)


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
        level=user.level,
        is_admin=is_admin(user),
        can_use_clicker=can_use_clicker(user),
        maintenance_sections=maintenance_sections(user),
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
        lootbox_reward_tier=item.lootbox_reward_tier,
        skin_slot=item.skin_slot,
    )


SKIN_SLOTS = ("head", "torso", "legs", "feet")


def _get_or_create_loadout(db: Session, user_id: int) -> models.UserSkinLoadout:
    """Комплект скинов игрока, создаётся при первом обращении."""
    loadout = (
        db.query(models.UserSkinLoadout)
        .filter(models.UserSkinLoadout.user_id == user_id)
        .one_or_none()
    )
    if loadout is None:
        loadout = models.UserSkinLoadout(user_id=user_id)
        db.add(loadout)
        db.flush()
    return loadout


def _loadout_to_out(db: Session, loadout: models.UserSkinLoadout | None) -> schemas.SkinLoadoutOut:
    """Комплект в виде кодов предметов: по ним клиент и рисует персонажа.

    Предмет мог быть удалён из каталога после того, как его надели, поэтому
    отсутствующий предмет отдаётся как пустой слот, а не ломает ответ.
    """
    if loadout is None:
        return schemas.SkinLoadoutOut()
    item_ids = {
        slot: getattr(loadout, f"{slot}_item_id") for slot in SKIN_SLOTS
    }
    known = {
        row.id: row.code
        for row in db.query(models.Item).filter(
            models.Item.id.in_([i for i in item_ids.values() if i])
        ).all()
    } if any(item_ids.values()) else {}
    return schemas.SkinLoadoutOut(
        **{slot: known.get(item_id) for slot, item_id in item_ids.items()}
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
    owned_items = (
        db.query(models.InventoryItem).filter(models.InventoryItem.user_id == user.id, models.InventoryItem.quantity > 0).all()
    )
    inventory = [row for row in owned_items if not row.item.skin_slot]
    skin_inventory = [row for row in owned_items if row.item.skin_slot]
    user_tasks = (
        db.query(models.UserTask).filter(models.UserTask.user_id == user.id, models.UserTask.status == "in_progress").all()
    )
    daily_plan = db.query(models.Task).filter(models.Task.is_daily_plan.is_(True), models.Task.is_active.is_(True)).first()
    return schemas.ProfilePayload(
        user=_user_to_out(user),
        bp_level=_get_bp_level(db, user),
        fragment_assembly_cost=models.LOOTBOX_FRAGMENT_COST,
        failure_fragment_cost=models.FAILURE_FRAGMENT_COST,
        inventory=_inventory_to_out(inventory),
        skin_inventory=_inventory_to_out(skin_inventory),
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
        skin_loadout=_loadout_to_out(
            db,
            db.query(models.UserSkinLoadout)
            .filter(models.UserSkinLoadout.user_id == user.id)
            .one_or_none(),
        ),
    )


@router.get("/skins", response_model=schemas.SkinLoadoutOut)
def get_skins(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.SkinLoadoutOut:
    """Только комплект — для карточки персонажа на Главной, без всего инвентаря."""
    return _loadout_to_out(
        db,
        db.query(models.UserSkinLoadout)
        .filter(models.UserSkinLoadout.user_id == user.id)
        .one_or_none(),
    )


@router.post("/skins/equip", response_model=schemas.ProfilePayload)
def equip_skin(
    payload: schemas.SkinEquipRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Надеть скин. В отличие от активации предмет НЕ расходуется."""
    begin_game_write(db)
    inv = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == payload.item_id,
    ).one_or_none()
    if inv is None or inv.quantity < 1:
        raise HTTPException(status_code=400, detail="Этого скина нет в инвентаре")
    if not inv.item.skin_slot:
        raise HTTPException(status_code=400, detail="Этот предмет не является скином")
    if inv.item.skin_slot != payload.slot:
        raise HTTPException(status_code=400, detail="Скин не подходит для этого слота")
    loadout = _get_or_create_loadout(db, user.id)
    setattr(loadout, f"{payload.slot}_item_id", inv.item_id)
    loadout.updated_at = models.now_utc()
    db.commit()
    db.refresh(user)
    return me(user=user, db=db)


@router.post("/skins/unequip", response_model=schemas.ProfilePayload)
def unequip_skin(
    payload: schemas.SkinUnequipRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    loadout = _get_or_create_loadout(db, user.id)
    setattr(loadout, f"{payload.slot}_item_id", None)
    loadout.updated_at = models.now_utc()
    db.commit()
    db.refresh(user)
    return me(user=user, db=db)


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
    from app.notify import log_player_action
    log_player_action("Перевод ковбаксов", user.first_name, f"{payload.amount} ковбаксов → {recipient.first_name}")
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
    from app.notify import log_player_action
    log_player_action("Подарок предмета", user.first_name, f"{item_name} ×{payload.quantity} → {recipient.first_name}")
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
    from app.notify import log_player_action
    log_player_action(
        "Адресная продажа", user.first_name,
        f"{item_name} ×{payload.quantity} для {recipient.first_name} · {payload.price} ковбаксов",
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
    if inv.item.lootbox_pool_code or inv.item.code in {"box_fragment", "failure_fragment"}:
        raise HTTPException(status_code=400, detail="Этот предмет активируется отдельным действием")
    if not inv.item.can_activate:
        raise HTTPException(status_code=400, detail="Этот предмет нельзя активировать")
    xp_by_code = {"exp_scroll": 50, "scroll_of_wisdom": 250}
    xp_reward = xp_by_code.get(inv.item.code, 0)
    from app.api._helpers import award_xp
    if xp_reward:
        award_xp(db, user, xp_reward)
    inv.quantity -= 1
    if inv.quantity == 0:
        db.delete(inv)
    db.commit()
    db.refresh(user)
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
    supported = {"item", "kovbucks", "kovcoins", "xp", "special_pool", "super_special_pool"}
    for entry in entries:
        if entry.reward_kind not in supported or entry.weight <= 0:
            raise HTTPException(409, "Конфигурация наград ковбокса некорректна")
        if entry.amount_min < 1 or entry.amount_max < entry.amount_min or entry.amount_max > 1_000_000:
            raise HTTPException(409, "Количество награды ковбокса настроено некорректно")
        if entry.reward_kind == "item" and (entry.item is None or entry.item.lootbox_pool_code):
            raise HTTPException(409, "Предмет награды ковбокса удалён или создаёт циклическую награду")
    random_entries = [entry for entry in entries if not entry.is_guaranteed]
    random_total = sum(entry.weight for entry in random_entries)
    if pool.opening_mode == "chest_v2":
        pool_chances = (
            pool.bonus_item_chance,
            pool.special_item_chance,
            pool.super_special_item_chance,
        )
        if any(chance < 0 or chance > 100 for chance in pool_chances):
            raise HTTPException(409, "Шанс предметного пула настроен некорректно")
        if sum(pool_chances) > 100:
            raise HTTPException(409, "Сумма шансов предметных пулов превышает 100%")
        for entry in entries:
            if entry.reward_kind != "item":
                continue
            if entry.item is None or (entry.item.code != "box_fragment" and not entry.item.skin_slot):
                raise HTTPException(409, "Конкретной наградой сундука может быть только фрагмент или скин")
        if random_total > 100:
            raise HTTPException(409, "Сумма шансов случайных наград превышает 100%")
    elif pool.opening_mode == "choice_v2":
        if not 1 <= pool.guaranteed_slots <= 10:
            raise HTTPException(409, "Количество слотов ковбокса настроено некорректно")
        if any(entry.is_guaranteed for entry in entries):
            raise HTTPException(409, "В мегаковбоксе все награды должны участвовать в выборе")
        identities = {
            (entry.reward_kind, entry.item_id if entry.reward_kind == "item" else None)
            for entry in random_entries
        }
        if len(identities) < 2:
            raise HTTPException(409, "Для Мегаковбокса нужны минимум два разных типа призов")
    else:
        if not 1 <= pool.guaranteed_slots <= 10:
            raise HTTPException(409, "Количество слотов ковбокса настроено некорректно")
    if pool.opening_mode != "chest_v2" and random_entries and random_total != 100:
        raise HTTPException(409, f"Сумма шансов ковбокса должна быть ровно 100% (сейчас {random_total}%)")
    if pool.opening_mode != "chest_v2" and not random_entries:
        raise HTTPException(409, "У ковбокса отсутствует таблица случайных наград")
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


def _reward_presentation_kind(kind: str, item: models.Item | None = None) -> str:
    if kind == "item":
        return "fragment" if item is not None and item.code == "box_fragment" else "item"
    return kind


def _reward_icon(kind: str, item: models.Item | None = None) -> str:
    if item is not None:
        return item.image_url or item.icon or "/static/img/ui/box.svg"
    return {
        "xp": "/static/img/ui/xp.png",
        "kovbucks": "/static/img/ui/kovbaks.png",
        "kovcoins": "/static/img/ui/kovcoin.svg",
    }.get(kind, "/static/img/ui/box.svg")


def _reward_priority(kind: str, item: models.Item | None = None) -> int:
    presentation_kind = _reward_presentation_kind(kind, item)
    return {"fragment": 0, "xp": 1, "kovbucks": 2, "kovcoins": 2, "item": 3}[presentation_kind]


def _limited_stock_product(
    db: Session,
    user: models.User,
    item: models.Item | None,
) -> models.ShopProduct | None:
    if (
        item is None
        or not uses_limited_lootbox_stock(user)
        or item.code in {"box_fragment", "failure_fragment"}
        or item.lootbox_pool_code
    ):
        return None
    return db.query(models.ShopProduct).filter(
        models.ShopProduct.item_id == item.id,
        models.ShopProduct.is_active.is_(True),
    ).with_for_update().one_or_none()


def _entry_available_for_user(db: Session, user: models.User, entry: models.LootboxPoolEntry) -> bool:
    if entry.reward_kind != "item" or entry.item is None:
        return True
    if entry.item.code in {"box_fragment", "failure_fragment"}:
        return True
    product = db.query(models.ShopProduct).filter(
        models.ShopProduct.item_id == entry.item.id,
        models.ShopProduct.is_active.is_(True),
    ).one_or_none()
    if product is None:
        return not uses_limited_lootbox_stock(user)
    return product.stock != 0


def _fallback_shop_item(
    db: Session,
    user: models.User,
    *,
    exclude_ids: set[int] | None = None,
    tier: str | None = None,
) -> models.Item:
    excluded = exclude_ids or set()
    query = (
        db.query(models.Item)
        .join(models.ShopProduct, models.ShopProduct.item_id == models.Item.id)
        .filter(
            models.ShopProduct.is_active.is_(True),
            models.ShopProduct.stock != 0,
            models.Item.lootbox_pool_code.is_(None),
            ~models.Item.code.in_(["box_fragment", "failure_fragment"]),
        )
    )
    if tier is not None:
        query = query.filter(models.Item.lootbox_reward_tier == tier)
    rows = query.all()
    available = [item for item in rows if item.id not in excluded]
    if not available:
        labels = {
            "normal": "обычном",
            "special": "особом",
            "super_special": "сверхособом",
        }
        if tier in labels:
            raise HTTPException(409, f"В {labels[tier]} пуле не осталось доступных товаров")
        raise HTTPException(409, "В магазине не осталось доступных предметов для замены награды")
    return available[secrets.randbelow(len(available))]


def _resolved_reward_item(
    db: Session,
    user: models.User,
    item: models.Item,
    *,
    exclude_ids: set[int] | None = None,
) -> models.Item:
    if item.code in {"box_fragment", "failure_fragment"}:
        return item
    product = db.query(models.ShopProduct).filter(
        models.ShopProduct.item_id == item.id,
        models.ShopProduct.is_active.is_(True),
    ).one_or_none()
    unavailable = product is not None and product.stock == 0
    unavailable = unavailable or (product is None and uses_limited_lootbox_stock(user))
    return (
        _fallback_shop_item(
            db,
            user,
            exclude_ids=exclude_ids,
            tier=item.lootbox_reward_tier,
        )
        if unavailable
        else item
    )


def _roll_chest_pool_item(
    db: Session,
    user: models.User,
    pool: models.LootboxPool,
) -> models.Item | None:
    """Roll at most one global item pool, then pick uniformly from its stock."""
    roll = secrets.randbelow(100)
    cursor = pool.bonus_item_chance
    if roll < cursor:
        return _fallback_shop_item(db, user, tier="normal")
    cursor += pool.special_item_chance
    if roll < cursor:
        return _fallback_shop_item(db, user, tier="special")
    cursor += pool.super_special_item_chance
    if roll < cursor:
        return _fallback_shop_item(db, user, tier="super_special")
    return None


def _roll_chest_random_entry(entries: list[models.LootboxPoolEntry]) -> models.LootboxPoolEntry | None:
    """Each non-guaranteed row has a direct percentage; unused remainder is no reward."""
    roll = secrets.randbelow(100)
    cursor = 0
    for entry in sorted(entries, key=lambda value: (value.sort_order, value.id)):
        cursor += entry.weight
        if roll < cursor:
            return entry
    return None


def _decrement_limited_stock(
    db: Session,
    user: models.User,
    item: models.Item | None,
    amount: int,
) -> None:
    product = _limited_stock_product(db, user, item)
    if product is None:
        if uses_limited_lootbox_stock(user) and item is not None and item.code not in {
            "box_fragment", "failure_fragment"
        } and not item.lootbox_pool_code:
            raise HTTPException(409, "Этот предмет закончился в магазине")
        return
    if product.stock >= 0:
        if product.stock < amount:
            raise HTTPException(409, "Этот предмет закончился в магазине")
        product.stock -= amount


def _choice_option(
    db: Session,
    user: models.User,
    entry: models.LootboxPoolEntry,
    *,
    exclude_item_ids: set[int] | None = None,
) -> dict:
    amount = entry.amount_min + secrets.randbelow(entry.amount_max - entry.amount_min + 1)
    kind = entry.reward_kind
    item = entry.item
    if kind == "special_pool":
        kind, item = "item", _fallback_shop_item(db, user, tier="special", exclude_ids=exclude_item_ids)
    elif kind == "super_special_pool":
        kind, item = "item", _fallback_shop_item(db, user, tier="super_special", exclude_ids=exclude_item_ids)
    elif kind == "item" and item is not None:
        item = _resolved_reward_item(db, user, item, exclude_ids=exclude_item_ids)
    return {
        "kind": kind,
        "item_id": item.id if item else None,
        "amount": amount,
        "label": _reward_label(kind, amount, item),
        "icon": _reward_icon(kind, item),
        "rarity": item.rarity if item else "Обычный",
        "presentation_kind": _reward_presentation_kind(kind, item),
    }


def _choice_entry_identity(entry: models.LootboxPoolEntry) -> tuple[str, int | None]:
    """Identity used to keep both cards of a Mega choice meaningfully different."""
    return (
        entry.reward_kind,
        entry.item_id if entry.reward_kind == "item" else None,
    )


def _build_choice_plan(
    db: Session,
    user: models.User,
    pool: models.LootboxPool,
    entries: list[models.LootboxPoolEntry],
) -> list[list[dict]]:
    available = [entry for entry in entries if not entry.is_guaranteed]
    plan: list[list[dict]] = []
    for _ in range(pool.guaranteed_slots):
        first = _weighted_pick(available)
        first_identity = _choice_entry_identity(first)
        second_source = [
            entry for entry in available
            if _choice_entry_identity(entry) != first_identity
        ]
        if not second_source:
            raise HTTPException(409, "Для Мегаковбокса нужны минимум два разных типа призов")
        second = _weighted_pick(second_source)
        first_option = _choice_option(db, user, first)
        excluded: set[int] = set()
        if first_option.get("item_id"):
            excluded.add(first_option["item_id"])
        second_option = _choice_option(db, user, second, exclude_item_ids=excluded)
        plan.append([first_option, second_option])
    return plan


def _grant_reward_specs(
    db: Session,
    user: models.User,
    pool: models.LootboxPool,
    opening: models.LootboxOpen,
    specs: list[tuple[str, int, models.Item | None, int]],
) -> None:
    granted_rewards: list[tuple[str, int, models.Item | None, int]] = []
    total_kovbucks_for_presentation = 0
    for kind, amount, reward_item, selected_index in specs:
        if kind == "item":
            if reward_item is None:
                raise HTTPException(409, "Предмет награды удалён")
            reward_item = _resolved_reward_item(db, user, reward_item)
            _decrement_limited_stock(db, user, reward_item, amount)
            reward_inventory = db.query(models.InventoryItem).filter(
                models.InventoryItem.user_id == user.id,
                models.InventoryItem.item_id == reward_item.id,
            ).first()
            if reward_inventory:
                if reward_inventory.quantity > 2_000_000_000 - amount:
                    raise HTTPException(409, "Достигнут максимальный размер стака предмета")
                reward_inventory.quantity += amount
            else:
                db.add(models.InventoryItem(user_id=user.id, item_id=reward_item.id, quantity=amount))
            granted_rewards.append((kind, amount, reward_item, selected_index))
        elif kind == "kovbucks":
            wallet = ensure_wallet(db, user)
            if wallet.balance > 2_000_000_000 - amount:
                raise HTTPException(409, "Достигнут максимальный баланс ковбаксов")
            wallet.balance += amount
            db.add(models.Transaction(recipient_id=user.id, amount=amount, note=f"lootbox:{pool.code}:open:{opening.id}"))
            total_kovbucks_for_presentation += amount
        elif kind == "xp":
            xp_result = award_xp(db, user, amount)
            if xp_result["xp_added"] > 0:
                granted_rewards.append(("xp", xp_result["xp_added"], None, selected_index))
            total_kovbucks_for_presentation += xp_result["coins"]
        elif kind == "kovcoins":
            clicker = db.query(models.ClickerState).filter(models.ClickerState.user_id == user.id).first()
            if clicker:
                if clicker.kovcoins > 2_000_000_000 - amount:
                    raise HTTPException(409, "Достигнут максимальный баланс ковкойнов")
                clicker.kovcoins += amount
            else:
                db.add(models.ClickerState(user_id=user.id, kovcoins=amount))
            granted_rewards.append(("kovcoins", amount, None, selected_index))
    if total_kovbucks_for_presentation > 0:
        granted_rewards.append(("kovbucks", total_kovbucks_for_presentation, None, len(specs)))
    granted_rewards.sort(key=lambda reward: (_reward_priority(reward[0], reward[2]), reward[3]))
    for reveal_order, (kind, amount, reward_item, _) in enumerate(granted_rewards):
        db.add(models.LootboxOpenReward(
            opening_id=opening.id, reward_kind=kind,
            item_id=reward_item.id if reward_item else None, amount=amount,
            reveal_order=reveal_order, presentation_kind=_reward_presentation_kind(kind, reward_item),
            label_snapshot=_reward_label(kind, amount, reward_item),
            icon_snapshot=_reward_icon(kind, reward_item),
            rarity_snapshot=reward_item.rarity if reward_item else "Обычный",
        ))


def _opening_result(
    opening: models.LootboxOpen,
    user: models.User,
    *,
    replayed: bool,
) -> schemas.LootboxOpenResult:
    ordered_rewards = sorted(opening.rewards, key=lambda reward: (reward.reveal_order, reward.id))
    rewards = []
    for reward in ordered_rewards:
        presentation_kind = reward.presentation_kind or _reward_presentation_kind(
            reward.reward_kind, reward.item
        )
        rewards.append(schemas.LootboxRewardOut(
            kind=reward.reward_kind,
            amount=reward.amount,
            label=reward.label_snapshot or _reward_label(reward.reward_kind, reward.amount, reward.item),
            item=_item_to_out(reward.item) if reward.item else None,
            reveal_order=reward.reveal_order,
            presentation_kind=presentation_kind,
            icon=reward.icon_snapshot or _reward_icon(reward.reward_kind, reward.item),
            rarity=reward.rarity_snapshot or (reward.item.rarity if reward.item else "Обычный"),
        ))
    pool = opening.pool
    pool_code = opening.pool_code_snapshot or (pool.code if pool else "")
    pool_name = opening.pool_name_snapshot or (pool.name if pool else "Ковбокс")
    pool_rarity = opening.pool_rarity_snapshot or (pool.rarity if pool else "Обычный")
    pool_image = opening.pool_image_snapshot or (pool.image_url if pool else "/static/img/ui/box.svg")
    pool_open_image = (
        opening.pool_open_image_snapshot
        or (pool.open_image_url if pool else "")
        or pool_image
    )
    first_item = next(
        (reward for reward in rewards if reward.item and reward.item.code != "box_fragment"),
        next((reward for reward in rewards if reward.item), None),
    )
    try:
        stored_plan = json.loads(opening.choice_plan or "[]")
    except (TypeError, json.JSONDecodeError):
        stored_plan = []
    choice_groups = []
    for index, group in enumerate(stored_plan if isinstance(stored_plan, list) else []):
        if not isinstance(group, list):
            continue
        options = []
        for option in group[:2]:
            if not isinstance(option, dict):
                continue
            options.append(schemas.LootboxChoiceOptionOut(
                label=str(option.get("label") or "Награда"),
                icon=str(option.get("icon") or "/static/img/ui/box.svg"),
                rarity=str(option.get("rarity") or "Обычный"),
                presentation_kind=option.get("presentation_kind") or "item",
            ))
        if len(options) == 2:
            choice_groups.append(schemas.LootboxChoiceGroupOut(index=index, options=options))
    opening_mode = pool.opening_mode if pool else ("choice_v2" if choice_groups else "chest_v2")
    return schemas.LootboxOpenResult(
        opening_id=opening.id,
        request_id=opening.request_id,
        pool=schemas.LootboxPresentationOut(
            code=pool_code,
            name=pool_name,
            rarity=pool_rarity,
            image_url=pool_image,
            open_image_url=pool_open_image,
        ),
        rewards=rewards,
        opening_mode=opening_mode,
        choice_groups=choice_groups,
        finalized=opening.finalized_at is not None or opening_mode != "choice_v2",
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
    if db.get_bind().dialect.name != "sqlite":
        # One user row serializes inventory, wallet, XP and daily-limit writes
        # even when two different Kovboxes are opened concurrently.
        db.query(models.User).filter(models.User.id == user.id).with_for_update().one()
    existing = db.query(models.LootboxOpen).filter(
        models.LootboxOpen.user_id == user.id,
        models.LootboxOpen.request_id == body.request_id,
    ).first()
    if existing:
        if existing.lootbox_item_id != body.item_id:
            raise HTTPException(409, "Этот идентификатор запроса уже использован для другого ковбокса")
        result = _opening_result(existing, user, replayed=True)
        db.rollback()
        return result

    item = db.query(models.Item).filter(models.Item.id == body.item_id).first()
    if item is None or not item.lootbox_pool_code:
        raise HTTPException(404, "Ковбокс не найден")
    pool = _lootbox_pool_for_item(db, item)
    if pool is None:
        raise HTTPException(409, "Для ковбокса отсутствует серверная конфигурация")
    if pool.item_id != item.id:
        raise HTTPException(409, "Ковбокс связан с другой серверной конфигурацией")
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

    inventory = (
        db.query(models.InventoryItem)
        .filter(
            models.InventoryItem.user_id == user.id,
            models.InventoryItem.item_id == item.id,
        )
        .with_for_update()
        .one_or_none()
    )
    if inventory is None or inventory.quantity < 1:
        raise HTTPException(409, "У вас нет этого ковбокса")

    guaranteed = [entry for entry in entries if entry.is_guaranteed]
    random_entries = [entry for entry in entries if not entry.is_guaranteed]
    selected = []
    direct_specs: list[tuple[str, int, models.Item | None, int]] = []
    choice_plan: list[list[dict]] = []
    if pool.opening_mode == "chest_v2":
        selected.extend(sorted(guaranteed, key=lambda entry: (entry.sort_order, entry.id)))
        random_entry = _roll_chest_random_entry(random_entries) if random_entries else None
        if random_entry is not None:
            amount = random_entry.amount_min + secrets.randbelow(random_entry.amount_max - random_entry.amount_min + 1)
            if random_entry.reward_kind == "special_pool":
                direct_specs.append(("item", amount, _fallback_shop_item(db, user, tier="special"), len(selected)))
            elif random_entry.reward_kind == "super_special_pool":
                direct_specs.append(("item", amount, _fallback_shop_item(db, user, tier="super_special"), len(selected)))
            else:
                selected.append(random_entry)
        elif not random_entries:
            # Compatibility with pools saved before the simplified editor.
            pool_item = _roll_chest_pool_item(db, user, pool)
            if pool_item is not None:
                direct_specs.append(("item", 1, pool_item, len(selected)))
    elif pool.opening_mode == "choice_v2":
        choice_plan = _build_choice_plan(db, user, pool, entries)
    else:
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
    if not selected and not direct_specs and not choice_plan:
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
        pool_code_snapshot=pool.code,
        pool_name_snapshot=pool.name,
        pool_rarity_snapshot=pool.rarity,
        pool_image_snapshot=pool.image_url,
        pool_open_image_snapshot=pool.open_image_url or pool.image_url,
        choice_plan=json.dumps(choice_plan, ensure_ascii=False),
        choice_selection="[]",
        finalized_at=None if choice_plan else models.now_utc(),
    )
    db.add(opening)
    db.flush()

    if selected or direct_specs:
        specs = []
        for selected_index, entry in enumerate(selected):
            amount = entry.amount_min + secrets.randbelow(entry.amount_max - entry.amount_min + 1)
            kind = entry.reward_kind
            reward_item = entry.item
            if kind == "special_pool":
                kind, reward_item = "item", _fallback_shop_item(db, user, tier="special")
            elif kind == "super_special_pool":
                kind, reward_item = "item", _fallback_shop_item(db, user, tier="super_special")
            specs.append((kind, amount, reward_item, selected_index))
        specs.extend(direct_specs)
        _grant_reward_specs(db, user, pool, opening, specs)
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


@router.post("/inventory/choose-lootbox", response_model=schemas.LootboxOpenResult)
def choose_inventory_lootbox(
    body: schemas.ChooseLootboxRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.LootboxOpenResult:
    """Finalize all Mega Kovbox choices once and grant them atomically."""
    begin_game_write(db)
    opening = db.query(models.LootboxOpen).filter(
        models.LootboxOpen.id == body.opening_id,
        models.LootboxOpen.user_id == user.id,
        models.LootboxOpen.request_id == body.request_id,
    ).with_for_update().one_or_none()
    if opening is None:
        raise HTTPException(404, "Открытие мегаковбокса не найдено")
    pool = opening.pool
    if pool is None or pool.opening_mode != "choice_v2":
        raise HTTPException(409, "Это открытие не требует выбора")
    if opening.finalized_at is not None:
        try:
            stored = json.loads(opening.choice_selection or "[]")
        except json.JSONDecodeError:
            stored = []
        if stored != body.choices:
            raise HTTPException(409, "Выбор этого мегаковбокса уже зафиксирован")
        result = _opening_result(opening, user, replayed=True)
        db.rollback()
        return result
    try:
        plan = json.loads(opening.choice_plan or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(409, "План наград мегаковбокса повреждён") from exc
    if not isinstance(plan, list) or len(plan) != len(body.choices):
        raise HTTPException(409, "Количество выбранных наград не совпадает с мегаковбоксом")
    specs: list[tuple[str, int, models.Item | None, int]] = []
    for index, choice in enumerate(body.choices):
        group = plan[index]
        if not isinstance(group, list) or len(group) != 2 or not isinstance(group[choice], dict):
            raise HTTPException(409, "План наград мегаковбокса повреждён")
        option = group[choice]
        kind = option.get("kind")
        amount = option.get("amount")
        if kind not in {"item", "kovbucks", "kovcoins", "xp"} or type(amount) is not int or amount < 1:
            raise HTTPException(409, "План наград мегаковбокса повреждён")
        reward_item = None
        if kind == "item":
            item_id = option.get("item_id")
            if type(item_id) is not int:
                raise HTTPException(409, "Предмет награды мегаковбокса повреждён")
            reward_item = db.query(models.Item).filter(models.Item.id == item_id).one_or_none()
            if reward_item is None or reward_item.lootbox_pool_code:
                raise HTTPException(409, "Предмет награды мегаковбокса недоступен")
        specs.append((kind, amount, reward_item, index))
    _grant_reward_specs(db, user, pool, opening, specs)
    opening.choice_selection = json.dumps(body.choices)
    opening.finalized_at = models.now_utc()
    db.commit()
    db.refresh(opening)
    db.refresh(user)
    return _opening_result(opening, user, replayed=False)


@router.post("/inventory/assemble-failure-fragments")
def assemble_failure_fragments(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    fragment = db.query(models.Item).filter(models.Item.code == "failure_fragment").one_or_none()
    box = db.query(models.Item).filter(models.Item.code == "lootbox_consolation").one_or_none()
    pool = db.query(models.LootboxPool).filter(models.LootboxPool.code == "consolation").one_or_none()
    if fragment is None or box is None or pool is None or not pool.is_active or pool.item_id != box.id:
        raise HTTPException(503, "Утешительный ковбокс временно недоступен")
    stack = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == fragment.id,
    ).with_for_update().one_or_none()
    cost = models.FAILURE_FRAGMENT_COST
    if stack is None or stack.quantity < cost:
        raise HTTPException(400, f"Нужно {cost} фрагментов неудачи")
    target = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == box.id,
    ).one_or_none()
    if target and target.quantity >= 2_000_000_000:
        raise HTTPException(409, "Достигнут максимальный размер стака ковбоксов")
    stack.quantity -= cost
    remaining = stack.quantity
    if not stack.quantity:
        db.delete(stack)
    if target:
        target.quantity += 1
    else:
        db.add(models.InventoryItem(user_id=user.id, item_id=box.id, quantity=1))
    db.commit()
    return {
        "ok": True,
        "item_name": box.name,
        "item_icon": box.icon,
        "remaining_fragments": remaining,
        "fragment_assembly_cost": cost,
    }


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
            or pool.opening_mode == "choice_v2"
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
