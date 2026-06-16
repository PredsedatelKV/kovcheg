from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet
from app.api.profile import _item_to_out
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/shop", tags=["shop"])


@router.get("/products", response_model=list[schemas.ShopProductOut])
def list_products(db: Session = Depends(get_db)) -> list[schemas.ShopProductOut]:
    products = db.query(models.ShopProduct).filter(models.ShopProduct.is_active.is_(True)).order_by(models.ShopProduct.id).all()
    return [schemas.ShopProductOut(id=p.id, item=_item_to_out(p.item), price=p.price, stock=p.stock) for p in products]


@router.post("/buy", response_model=schemas.UserOut)
def buy(
    payload: schemas.BuyRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    product = (
        db.query(models.ShopProduct).filter(models.ShopProduct.id == payload.product_id, models.ShopProduct.is_active.is_(True)).one_or_none()
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if product.stock == 0:
        raise HTTPException(status_code=400, detail="Товар закончился")
    wallet = ensure_wallet(db, user)
    if wallet.balance < product.price:
        raise HTTPException(status_code=400, detail="Недостаточно Ковбаксов")
    wallet.balance -= product.price
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == product.item_id)
        .one_or_none()
    )
    if inv is None:
        db.add(models.InventoryItem(user_id=user.id, item_id=product.item_id, quantity=1))
    else:
        inv.quantity += 1
    if product.stock > 0:
        product.stock -= 1
    db.add(models.Transaction(sender_id=user.id, recipient_id=None, amount=product.price, note=f"shop:{product.item.code}"))
    # Сохраняем строки ДО commit (expire_on_commit аннулирует product).
    buyer_name = user.first_name
    item_name = product.item.name
    product_price = product.price
    product_stock = product.stock
    db.commit()
    db.refresh(user)
    from app.api.profile import _user_to_out  # avoid cycle at module load
    from app.notify import notify_admins_bg

    notify_admins_bg(
        f"🛒 <b>{buyer_name}</b> купил(а) <b>{item_name}</b> за {product_price} Ковбаксов"
        + (f" · осталось: {product_stock}" if product_stock >= 0 else "")
    )
    return _user_to_out(user)
