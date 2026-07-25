from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import award_xp, ensure_wallet, prize_icon
from app.auth import current_user
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/wheel", tags=["wheel"])
SYSTEM_RANDOM = secrets.SystemRandom()
WHEEL_KINDS = {"coins", "xp", "item", "nothing"}
MAX_WHEEL_VALUE = 1_000_000


def _load_sectors(db: Session) -> list[dict]:
    rows = (
        db.query(models.WheelPrize)
        .filter(models.WheelPrize.is_active.is_(True))
        .order_by(models.WheelPrize.sort_order, models.WheelPrize.id)
        .all()
    )
    sectors = []
    for p in rows:
        if p.kind not in WHEEL_KINDS:
            raise HTTPException(status_code=503, detail=f"Некорректный тип приза колеса: {p.label}")
        if p.weight is None or p.weight <= 0:
            raise HTTPException(status_code=503, detail=f"Некорректный вес приза колеса: {p.label}")
        if p.value is None or p.value < 0 or p.value > MAX_WHEEL_VALUE:
            raise HTTPException(status_code=503, detail=f"Некорректное значение приза колеса: {p.label}")
        item = None
        if p.kind == "item":
            if not p.item_code:
                raise HTTPException(status_code=503, detail=f"Для приза «{p.label}» не выбран предмет")
            item = db.query(models.Item).filter(models.Item.code == p.item_code).first()
            if item is None:
                raise HTTPException(status_code=503, detail=f"Предмет приза «{p.label}» не найден")
        sectors.append({
            "id": p.id,
            "label": p.label,
            "kind": p.kind,
            "value": p.value,
            "icon": prize_icon(p.kind, item),
            "item_code": p.item_code,
            # Lets the client paint a lootbox sector in that box's own colour.
            "lootbox_pool_code": item.lootbox_pool_code if item is not None else None,
            "weight": p.weight,
        })
    total_percent = sum(sector["weight"] for sector in sectors)
    if total_percent != 100:
        raise HTTPException(
            status_code=503,
            detail=f"Сумма шансов колеса должна быть ровно 100% (сейчас {total_percent}%)",
        )
    return sectors


def _pick_sector(sectors: list[dict]) -> tuple[int, dict]:
    ticket = SYSTEM_RANDOM.randrange(1, 101)
    current = 0
    for idx, sector in enumerate(sectors):
        current += sector["weight"]
        if ticket <= current:
            return idx, sector
    # Protected by _load_sectors; keep an explicit failure if DB data changes
    # between validation and picking.
    raise HTTPException(status_code=503, detail="Не удалось выбрать сектор колеса")


@router.get("/status")
def status(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    last = (
        db.query(models.WheelSpin)
        .filter(models.WheelSpin.user_id == user.id)
        .order_by(models.WheelSpin.created_at.desc())
        .first()
    )
    can_spin = True
    next_at: datetime | None = None
    next_spin_seconds = 0
    if last is not None and (datetime.utcnow() - last.created_at) < timedelta(hours=24):
        can_spin = False
        next_at = last.created_at + timedelta(hours=24)
        next_spin_seconds = max(0, int((next_at - datetime.utcnow()).total_seconds()))
    sectors = _load_sectors(db)
    return {
        "can_spin": can_spin,
        "next_spin_at": next_at.isoformat() if next_at else None,
        "next_spin_seconds": next_spin_seconds,
        "sectors": [
            {
                "label": s["label"],
                "icon": s["icon"],
                "kind": s["kind"],
                "value": s["value"],
                "item_code": s["item_code"],
                "lootbox_pool_code": s["lootbox_pool_code"],
            }
            for s in sectors
        ],
    }


@router.post("/spin")
def spin(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    begin_game_write(db)
    last = (
        db.query(models.WheelSpin)
        .filter(models.WheelSpin.user_id == user.id)
        .order_by(models.WheelSpin.created_at.desc())
        .first()
    )
    if last is not None and (datetime.utcnow() - last.created_at) < timedelta(hours=24):
        raise HTTPException(status_code=429, detail="Колесо доступно раз в сутки")

    sectors = _load_sectors(db)
    if not sectors:
        raise HTTPException(status_code=500, detail="Призы колеса не настроены")
    idx, sector = _pick_sector(sectors)

    wallet = ensure_wallet(db, user)
    xp_to_coins = 0
    if sector["kind"] == "coins":
        if wallet.balance < 0 or wallet.balance > 2_000_000_000 - sector["value"]:
            raise HTTPException(status_code=409, detail="Достигнут максимальный баланс ковбаксов")
        wallet.balance += sector["value"]
        db.add(
            models.Transaction(
                sender_id=None,
                recipient_id=user.id,
                amount=sector["value"],
                note="wheel",
            )
        )
    elif sector["kind"] == "xp":
        xp_to_coins += award_xp(db, user, sector["value"])["coins"]
    elif sector["kind"] == "nothing":
        pass
    else:
        item = db.query(models.Item).filter(models.Item.code == sector["item_code"]).one_or_none()
        if item is None:
            raise HTTPException(status_code=400, detail="Приз колеса не найден")
        inv = (
            db.query(models.InventoryItem)
            .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == item.id)
            .one_or_none()
        )
        if inv is None:
            db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=sector["value"]))
        else:
            if inv.quantity < 0 or inv.quantity > 2_000_000_000 - sector["value"]:
                raise HTTPException(status_code=409, detail="Достигнут максимальный размер стака предмета")
            inv.quantity += sector["value"]

    xp_to_coins += award_xp(db, user, 2)["coins"]
    db.add(
        models.WheelSpin(
            user_id=user.id,
            prize_kind=sector["kind"],
            prize_value=sector["value"],
            prize_label=sector["label"],
        )
    )
    db.commit()
    db.refresh(user)

    return {
        "sector_index": idx,
        "xp_to_coins": xp_to_coins,
        "result": schemas.SpinResult(
            prize_kind=sector["kind"],
            prize_value=sector["value"],
            prize_label=sector["label"],
            icon=sector["icon"],
            balance=user.wallet.balance,
        ).model_dump(),
    }
