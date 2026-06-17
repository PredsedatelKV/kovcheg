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


XP_MAX = 3000


def award_xp(db: Session, user: models.User, amount) -> dict:
    """Начисляет XP с лимитом 3000; излишек -> ковбаксы 10:1. Возвращает {'xp_added', 'coins'}."""
    amount = max(0, int(amount or 0))
    cur = user.xp or 0
    add = min(amount, max(0, XP_MAX - cur))
    user.xp = cur + add
    overflow = amount - add
    coins = overflow // 10
    if coins > 0:
        w = ensure_wallet(db, user)
        w.balance += coins
        db.add(models.Transaction(sender_id=None, recipient_id=user.id, amount=coins, note="xp_overflow"))
    return {"xp_added": add, "coins": coins}
