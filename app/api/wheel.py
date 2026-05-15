from __future__ import annotations

import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/wheel", tags=["wheel"])

# Призы для колеса. Должны совпадать по порядку и количеству с фронтом.
SECTORS: list[dict] = [
    {"label": "50 монет", "kind": "coins", "value": 50, "icon": "🪙", "weight": 25},
    {"label": "Сундук", "kind": "item", "value": 0, "icon": "🧰", "item_code": "builders_chest", "weight": 8},
    {"label": "25 монет", "kind": "coins", "value": 25, "icon": "🪙", "weight": 30},
    {"label": "200 монет", "kind": "coins", "value": 200, "icon": "💰", "weight": 5},
    {"label": "50 монет", "kind": "coins", "value": 50, "icon": "🪙", "weight": 20},
    {"label": "Ускоритель", "kind": "item", "value": 0, "icon": "⏳", "item_code": "booster_1h", "weight": 6},
    {"label": "10 монет", "kind": "coins", "value": 10, "icon": "🪙", "weight": 30},
    {"label": "Свиток опыта", "kind": "item", "value": 0, "icon": "📜", "item_code": "exp_scroll", "weight": 6},
]


def _pick_sector() -> tuple[int, dict]:
    weights = [s["weight"] for s in SECTORS]
    idx = random.choices(range(len(SECTORS)), weights=weights, k=1)[0]
    return idx, SECTORS[idx]


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
    if last is not None and (datetime.utcnow() - last.created_at) < timedelta(hours=24):
        can_spin = False
        next_at = last.created_at + timedelta(hours=24)
    return {
        "can_spin": can_spin,
        "next_spin_at": next_at.isoformat() if next_at else None,
        "sectors": [{"label": s["label"], "icon": s["icon"], "kind": s["kind"]} for s in SECTORS],
    }


@router.post("/spin")
def spin(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    last = (
        db.query(models.WheelSpin)
        .filter(models.WheelSpin.user_id == user.id)
        .order_by(models.WheelSpin.created_at.desc())
        .first()
    )
    if last is not None and (datetime.utcnow() - last.created_at) < timedelta(hours=24):
        raise HTTPException(status_code=429, detail="Колесо доступно раз в сутки")

    idx, sector = _pick_sector()

    if sector["kind"] == "coins":
        user.wallet.balance += sector["value"]
        db.add(
            models.Transaction(
                sender_id=None,
                recipient_id=user.id,
                amount=sector["value"],
                note="wheel",
            )
        )
    else:
        item = db.query(models.Item).filter(models.Item.code == sector["item_code"]).one_or_none()
        if item is None:
            raise HTTPException(status_code=500, detail="prize item missing")
        inv = (
            db.query(models.InventoryItem)
            .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == item.id)
            .one_or_none()
        )
        if inv is None:
            db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=1))
        else:
            inv.quantity += 1

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
        "result": schemas.SpinResult(
            prize_kind=sector["kind"],
            prize_value=sector["value"],
            prize_label=sector["label"],
            icon=sector["icon"],
            balance=user.wallet.balance,
        ).model_dump(),
    }
