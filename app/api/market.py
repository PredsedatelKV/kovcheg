from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.api.profile import _inventory_to_out, _item_to_out, _user_to_out
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/market", tags=["market"])


def _listing_to_out(listing: models.MarketListing) -> schemas.MarketListingOut:
    seller_name = listing.seller.username or listing.seller.first_name or f"id{listing.seller.telegram_id}"
    return schemas.MarketListingOut(
        id=listing.id,
        seller_id=listing.seller_id,
        seller_name=seller_name,
        item=_item_to_out(listing.item),
        quantity=listing.quantity,
        price=listing.price,
    )


@router.get("/listings", response_model=list[schemas.MarketListingOut])
def listings(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> list[schemas.MarketListingOut]:
    rows = (
        db.query(models.MarketListing)
        .options(joinedload(models.MarketListing.item), joinedload(models.MarketListing.seller))
        .filter(models.MarketListing.is_active.is_(True), models.MarketListing.seller_id != user.id)
        .order_by(models.MarketListing.created_at.desc())
        .all()
    )
    return [_listing_to_out(r) for r in rows]


@router.get("/my", response_model=list[schemas.MarketListingOut])
def my_listings(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> list[schemas.MarketListingOut]:
    rows = (
        db.query(models.MarketListing)
        .filter(models.MarketListing.is_active.is_(True), models.MarketListing.seller_id == user.id)
        .order_by(models.MarketListing.created_at.desc())
        .all()
    )
    return [_listing_to_out(r) for r in rows]


@router.post("/list", response_model=schemas.MarketListingOut)
def create_listing(
    payload: schemas.ListRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.MarketListingOut:
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == payload.item_id)
        .one_or_none()
    )
    if inv is None or inv.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="Недостаточно предметов в инвентаре")
    inv.quantity -= payload.quantity
    listing = models.MarketListing(
        seller_id=user.id,
        item_id=payload.item_id,
        quantity=payload.quantity,
        price=payload.price,
        is_active=True,
    )
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return _listing_to_out(listing)


@router.post("/unlist/{listing_id}", response_model=schemas.MarketListingOut)
def unlist(
    listing_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.MarketListingOut:
    listing = db.query(models.MarketListing).filter(models.MarketListing.id == listing_id).one_or_none()
    if listing is None or listing.seller_id != user.id:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    if not listing.is_active:
        raise HTTPException(status_code=400, detail="Объявление уже снято")
    listing.is_active = False
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == listing.item_id)
        .one_or_none()
    )
    if inv is None:
        db.add(models.InventoryItem(user_id=user.id, item_id=listing.item_id, quantity=listing.quantity))
    else:
        inv.quantity += listing.quantity
    db.commit()
    db.refresh(listing)
    return _listing_to_out(listing)


@router.post("/buy", response_model=schemas.UserOut)
def buy_listing(
    payload: schemas.BuyListingRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    listing = db.query(models.MarketListing).filter(models.MarketListing.id == payload.listing_id).one_or_none()
    if listing is None or not listing.is_active:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    if listing.seller_id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя купить у себя")
    if user.wallet.balance < listing.price:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    seller = db.query(models.User).filter(models.User.id == listing.seller_id).one()
    user.wallet.balance -= listing.price
    seller.wallet.balance += listing.price
    inv = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == listing.item_id)
        .one_or_none()
    )
    if inv is None:
        db.add(models.InventoryItem(user_id=user.id, item_id=listing.item_id, quantity=listing.quantity))
    else:
        inv.quantity += listing.quantity
    listing.is_active = False
    db.add(
        models.Transaction(
            sender_id=user.id,
            recipient_id=seller.id,
            amount=listing.price,
            note=f"market:{listing.item.code}",
        )
    )
    db.commit()
    db.refresh(user)
    return _user_to_out(user)


@router.get("/inventory", response_model=list[schemas.InventoryItemOut])
def my_inventory(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> list[schemas.InventoryItemOut]:
    rows = (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.quantity > 0)
        .all()
    )
    return _inventory_to_out(rows)
