from __future__ import annotations

from sqlalchemy.orm import Session

from app import models


def ensure_wallet(db: Session, user: models.User) -> models.Wallet:
    """Гарантирует наличие кошелька у пользователя (самовосстановление для старых
    записей). Возвращает кошелёк, который можно безопасно мутировать."""
    if user.wallet is None:
        wallet = models.Wallet(user_id=user.id, balance=0)
        db.add(wallet)
        db.flush()
        user.wallet = wallet
    return user.wallet
