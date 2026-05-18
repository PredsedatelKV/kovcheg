from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/arcade", tags=["arcade"])


@router.post("/win")
def arcade_win(
    amount: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    """Начислить выигрыш за мини-игру."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Некорректная сумма")
    user.wallet.balance += amount
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
    amount: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    """Списать ставку для казино."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Некорректная сумма")
    if user.wallet.balance < amount:
        raise HTTPException(status_code=400, detail="Недостаточно K")
    user.wallet.balance -= amount
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
