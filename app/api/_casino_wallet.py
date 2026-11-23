from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet

FEE_DIVISOR = 40
BONUS_AMOUNT = 1_000
LIMIT = 2_000_000_000


def lock_account(db: Session, user: models.User) -> models.CasinoWallet:
    db.query(models.User.id).filter(models.User.id == user.id).with_for_update().one()
    account = db.get(models.CasinoWallet, user.id)
    if account is None:
        account = models.CasinoWallet(user_id=user.id, cash=0, bonus=0, bonus_claimed=False)
        db.add(account)
        db.flush()
    return account


def transfer_fee(amount: int) -> int:
    return (amount + FEE_DIVISOR - 1) // FEE_DIVISOR


def snapshot(user: models.User, account: models.CasinoWallet | None) -> dict:
    cash = account.cash if account else 0
    return {
        "cash": cash,
        "bonus": account.bonus if account else 0,
        "bonus_claimed": account.bonus_claimed if account else False,
        "withdrawable": cash,
        "withdraw_net": cash - transfer_fee(cash),
        "main_balance": user.wallet.balance if user.wallet else 0,
    }


def spend(account: models.CasinoWallet, amount: int, *, use_bonus: bool = False) -> tuple[int, int]:
    bonus_used = min(account.bonus, amount) if use_bonus else 0
    cash_used = amount - bonus_used
    if cash_used > account.cash:
        raise HTTPException(400, "Недостаточно ковбаксов на балансе казино")
    account.cash -= cash_used
    account.bonus -= bonus_used
    return cash_used, bonus_used


def credit(account: models.CasinoWallet, amount: int) -> None:
    if account.cash > LIMIT - amount:
        raise HTTPException(409, "Достигнут максимальный баланс казино")
    account.cash += amount


def transfer(db: Session, user: models.User, account: models.CasinoWallet,
             request: schemas.CasinoTransferRequest) -> dict:
    existing = db.query(models.CasinoTransfer).filter_by(
        user_id=user.id, request_id=request.request_id,
    ).first()
    if existing:
        if existing.direction != request.direction or existing.amount != request.amount:
            raise HTTPException(409, "Этот перевод уже сохранён с другой суммой или направлением")
        amount, fee = existing.amount, existing.fee
        return {"wallet": snapshot(user, account), "fee": fee, "net": amount - fee, "replayed": True}

    main = ensure_wallet(db, user)
    amount = request.amount
    fee = transfer_fee(amount)
    net = amount - fee
    if request.direction == "deposit":
        if main.balance < amount:
            raise HTTPException(400, "Недостаточно ковбаксов на основном балансе")
        credit(account, net)
        main.balance -= amount
        txn = models.Transaction(sender_id=user.id, amount=amount, note="casino:transfer:deposit")
    else:
        if account.cash < amount:
            raise HTTPException(400, "Вывести можно только доступные ковбаксы казино")
        if main.balance > LIMIT - net:
            raise HTTPException(409, "Достигнут максимальный основной баланс")
        account.cash -= amount
        main.balance += net
        txn = models.Transaction(recipient_id=user.id, amount=net, note="casino:transfer:withdraw")
    db.add(txn)
    db.add(models.CasinoTransfer(
        user_id=user.id, request_id=request.request_id, direction=request.direction,
        amount=amount, fee=fee,
    ))
    db.commit()
    return {"wallet": snapshot(user, account), "fee": fee, "net": net, "replayed": False}
