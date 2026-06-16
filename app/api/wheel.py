from __future__ import annotations

import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet
from app.auth import current_user
from app.db import get_db
from app.models import now_utc

router = APIRouter(prefix="/api/wheel", tags=["wheel"])


def _load_sectors(db: Session) -> list[dict]:
    rows = (
        db.query(models.WheelPrize)
        .filter(models.WheelPrize.is_active.is_(True))
        .order_by(models.WheelPrize.sort_order, models.WheelPrize.id)
        .all()
    )
    return [
        {
            "id": p.id,
            "label": p.label,
            "kind": p.kind,
            "value": p.value,
            "icon": p.icon,
            "item_code": p.item_code,
            "weight": p.weight,
        }
        for p in rows
    ]


def _pick_sector(sectors: list[dict]) -> tuple[int, dict]:
    weights = [max(1, s["weight"]) for s in sectors]
    idx = random.choices(range(len(sectors)), weights=weights, k=1)[0]
    return idx, sectors[idx]


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
    if last is not None and (now_utc() - last.created_at) < timedelta(hours=24):
        can_spin = False
        next_at = last.created_at + timedelta(hours=24)
    sectors = _load_sectors(db)
    return {
        "can_spin": can_spin,
        "next_spin_at": next_at.isoformat() if next_at else None,
        "sectors": [{"label": s["label"], "icon": s["icon"], "kind": s["kind"]} for s in sectors],
    }


@router.post("/spin")
def spin(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    last = (
        db.query(models.WheelSpin)
        .filter(models.WheelSpin.user_id == user.id)
        .order_by(models.WheelSpin.created_at.desc())
        .first()
    )
    if last is not None and (now_utc() - last.created_at) < timedelta(hours=24):
        raise HTTPException(status_code=429, detail="Колесо доступно раз в сутки")

    sectors = _load_sectors(db)
    if not sectors:
        raise HTTPException(status_code=500, detail="Призы колеса не настроены")
    idx, sector = _pick_sector(sectors)

    wallet = ensure_wallet(db, user)

    # Нормализуем результат: невыданный/некорректный приз трактуем как «ничего».
    result_kind = sector["kind"]
    result_value = sector["value"]
    result_label = sector["label"]

    if sector["kind"] == "coins":
        if sector["value"] > 0:
            wallet.balance += sector["value"]
            db.add(
                models.Transaction(
                    sender_id=None,
                    recipient_id=user.id,
                    amount=sector["value"],
                    note="wheel",
                )
            )
        else:
            result_kind = "nothing"
            result_value = 0
    elif sector["kind"] == "item":
        item = None
        if sector["item_code"]:
            item = db.query(models.Item).filter(models.Item.code == sector["item_code"]).one_or_none()
        if item is None:
            # Приз-предмет не настроен/не найден — не падаем 500, считаем «ничего».
            result_kind = "nothing"
            result_value = 0
            result_label = "Ничего"
        else:
            inv = (
                db.query(models.InventoryItem)
                .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == item.id)
                .one_or_none()
            )
            if inv is None:
                db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=1))
            else:
                inv.quantity += 1
    else:
        # "nothing" или неизвестный kind — ничего не начисляем.
        result_kind = "nothing"
        result_value = 0

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

    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"🎰 <b>{user.first_name}</b> крутанул(а) колесо — выпало: <b>{result_label}</b>"
    )

    return {
        "sector_index": idx,
        "result": schemas.SpinResult(
            prize_kind=result_kind,
            prize_value=result_value,
            prize_label=result_label,
            icon=sector["icon"],
            balance=wallet.balance,
        ).model_dump(),
    }
