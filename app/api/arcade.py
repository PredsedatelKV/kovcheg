from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/arcade", tags=["arcade"])

MAX_WIN_MULTIPLIER = 5


@router.post("/win")
def arcade_win(
    amount: int = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    """Начислить выигрыш за мини-игру (привязан к последней ставке, ограничен)."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Некорректная сумма")
    wallet = ensure_wallet(db, user)

    last_bet = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.sender_id == user.id,
            models.Transaction.note == "arcade:bet",
        )
        .order_by(models.Transaction.created_at.desc())
        .first()
    )
    if last_bet is None:
        raise HTTPException(status_code=400, detail="Сначала сделайте ставку")

    already_won = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.recipient_id == user.id,
            models.Transaction.note == "arcade:win",
            models.Transaction.created_at >= last_bet.created_at,
        )
        .first()
    )
    if already_won is not None:
        raise HTTPException(status_code=400, detail="Выигрыш уже начислен")

    if amount > last_bet.amount * MAX_WIN_MULTIPLIER:
        raise HTTPException(status_code=400, detail="Слишком большой выигрыш")

    wallet.balance += amount
    db.add(
        models.Transaction(
            sender_id=None,
            recipient_id=user.id,
            amount=amount,
            note="arcade:win",
        )
    )
    db.commit()
    db.refresh(user)
    return schemas.UserOut(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        photo_url=user.photo_url,
        role=user.role,
        restrictions=user.restrictions,
        balance=user.wallet.balance,
        is_admin=False,
    )


@router.post("/bet")
def arcade_bet(
    amount: int = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    """Списать ставку для казино."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Некорректная сумма")
    wallet = ensure_wallet(db, user)
    if wallet.balance < amount:
        raise HTTPException(status_code=400, detail="Недостаточно K")
    wallet.balance -= amount
    db.add(
        models.Transaction(
            sender_id=user.id,
            recipient_id=None,
            amount=amount,
            note="arcade:bet",
        )
    )
    db.commit()
    db.refresh(user)
    return schemas.UserOut(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        photo_url=user.photo_url,
        role=user.role,
        restrictions=user.restrictions,
        balance=user.wallet.balance,
        is_admin=False,
    )
