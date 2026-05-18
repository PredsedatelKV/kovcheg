from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.profile import _item_to_out
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/shop", tags=["shop"])


@router.get("/products", response_model=list[schemas.ShopProductOut])
def list_products(db: Session = Depends(get_db)) -> list[schemas.ShopProductOut]:
    products = db.query(models.ShopProduct).filter(models.ShopProduct.is_active.is_(True)).order_by(models.ShopProduct.id).all()
    return [schemas.ShopProductOut(id=p.id, item=_item_to_out(p.item), price=p.price) for p in products]


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
    if user.wallet.balance < product.price:
        raise HTTPException(status_code=400, detail="Недостаточно Ковбаксов")
    user.wallet.balance -= product.price
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == product.item_id)
        .one_or_none()
    )
    if inv is None:
        db.add(models.InventoryItem(user_id=user.id, item_id=product.item_id, quantity=1))
    else:
        inv.quantity += 1
    db.add(models.Transaction(sender_id=user.id, recipient_id=None, amount=product.price, note=f"shop:{product.item.code}"))
    db.commit()
    db.refresh(user)
    from app.api.profile import _user_to_out  # avoid cycle at module load

    return _user_to_out(user)
