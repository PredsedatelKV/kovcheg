from __future__ import annotations

import json
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import current_user, is_admin
from app.db import get_db

router = APIRouter(prefix="/api/battlepass", tags=["battlepass"])


def _get_active_season(db: Session) -> models.BattlePassSeason | None:
    return db.query(models.BattlePassSeason).filter(models.BattlePassSeason.is_active == True).first()


def _get_ubp(db: Session, user_id: int, season: models.BattlePassSeason) -> models.UserBattlePass:
    ubp = db.query(models.UserBattlePass).filter(
        models.UserBattlePass.user_id == user_id,
        models.UserBattlePass.season_id == season.id,
    ).first()
    if not ubp:
        ubp = models.UserBattlePass(user_id=user_id, season_id=season.id)
        db.add(ubp)
        db.flush()
    return ubp


def _calc_level(xp: int, xp_per_level: int) -> tuple[int, int]:
    level = xp // xp_per_level
    current_xp = xp % xp_per_level
    return level, current_xp


def _add_xp(user: models.User, amount: int, db: Session) -> None:
    user.xp += amount
    db.commit()


def _reward_out(r: models.BattlePassReward, claimed: bool = False) -> schemas.BattlePassRewardOut:
    return schemas.BattlePassRewardOut(
        id=r.id, level=r.level, kind=r.kind,
        value=r.value, item_code=r.item_code, label=r.label, icon=r.icon,
        claimed=claimed,
    )


@router.get("", response_model=schemas.UserBattlePassOut | None)
def get_battlepass(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    season = _get_active_season(db)
    if not season:
        return None
    ubp = _get_ubp(db, user.id, season)
    level, current_xp = _calc_level(user.xp, season.xp_per_level)
    claimed: list[list] = json.loads(ubp.claimed_rewards) if isinstance(ubp.claimed_rewards, str) else ubp.claimed_rewards

    rewards: list[schemas.BattlePassRewardOut] = []
    for r in season.rewards:
        rewards.append(_reward_out(r, claimed=r.level in [c[0] for c in claimed]))

    season_out = schemas.BattlePassSeasonOut(
        id=season.id, name=season.name, theme=season.theme,
        xp_per_level=season.xp_per_level, total_levels=season.total_levels,
        is_active=season.is_active, rewards=rewards,
    )

    return schemas.UserBattlePassOut(
        season=season_out,
        current_level=min(level, season.total_levels - 1),
        current_xp=current_xp,
        xp_for_level=season.xp_per_level,
        claimed_rewards=claimed,
    )


@router.post("/claim")
def claim_reward(
    body: schemas.ClaimRewardRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    season = _get_active_season(db)
    if not season:
        raise HTTPException(404, "Нет активного сезона")
    ubp = _get_ubp(db, user.id, season)
    level, _ = _calc_level(user.xp, season.xp_per_level)

    reward = db.query(models.BattlePassReward).filter(
        models.BattlePassReward.season_id == season.id,
        models.BattlePassReward.level == body.level,
    ).first()
    if not reward:
        raise HTTPException(404, "Награда не найдена")

    if reward.level > level:
        raise HTTPException(403, f"Уровень {reward.level} ещё не достигнут (текущий {level})")

    claimed: list = json.loads(ubp.claimed_rewards) if isinstance(ubp.claimed_rewards, str) else ubp.claimed_rewards
    if reward.level in claimed:
        raise HTTPException(409, "Награда уже получена")

    claimed.append(reward.level)
    ubp.claimed_rewards = json.dumps(claimed)

    if reward.kind == "coins" or reward.kind.startswith("coins_"):
        user.wallet.balance += reward.value
        db.add(models.Transaction(recipient_id=user.id, amount=reward.value, note=f"Battle Pass: {reward.label}"))
    elif reward.kind == "xp":
        _add_xp(user, reward.value, db)
    elif reward.kind == "item" and reward.item_code:
        item = db.query(models.Item).filter(models.Item.code == reward.item_code).first()
        if item:
            inv = db.query(models.InventoryItem).filter(
                models.InventoryItem.user_id == user.id,
                models.InventoryItem.item_id == item.id,
            ).first()
            if inv:
                inv.quantity += reward.value
            else:
                db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=reward.value))

    db.commit()
    db.refresh(user)
    return {"ok": True, "balance": user.wallet.balance if user.wallet else 0}


@router.post("/award-xp")
def award_xp(
    body: schemas.AwardXpRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not is_admin(user):
        raise HTTPException(403, "Только для админов")

    target = user
    if body.user_id:
        target = db.query(models.User).filter(models.User.id == body.user_id).first()
        if not target:
            raise HTTPException(404, "Пользователь не найден")

    if body.mode == "set":
        target.xp = body.amount
    elif body.mode == "sub":
        target.xp = max(0, target.xp - body.amount)
    else:
        _add_xp(target, body.amount, db)

    if body.mode != "add":
        db.commit()
    return {"ok": True, "xp": target.xp}


@router.post("/open-lootbox", response_model=schemas.LootboxOpenResult)
def open_lootbox(
    body: schemas.OpenLootboxRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = db.query(models.Item).filter(models.Item.id == body.item_id).first()
    if not item or not item.lootbox_pool_code:
        raise HTTPException(404, "Лутбокс не найден")

    inv = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == item.id,
    ).first()
    if not inv or inv.quantity < 1:
        raise HTTPException(409, "У вас нет этого ковбокса")

    pool = db.query(models.LootboxPool).filter(models.LootboxPool.code == item.lootbox_pool_code).first()
    if not pool or not pool.entries:
        raise HTTPException(500, "Пул ковбокса пуст")

    entries = pool.entries
    total_weight = sum(e.weight for e in entries)
    roll = random.randint(1, total_weight)
    cumulative = 0
    chosen = entries[0]
    for e in entries:
        cumulative += e.weight
        if roll <= cumulative:
            chosen = e
            break

    inv.quantity -= 1
    if inv.quantity <= 0:
        db.delete(inv)

    target_inv = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == chosen.item_id,
    ).first()
    if target_inv:
        target_inv.quantity += 1
    else:
        db.add(models.InventoryItem(user_id=user.id, item_id=chosen.item_id, quantity=1))

    db.commit()

    return schemas.LootboxOpenResult(item=schemas.ItemOut(
        id=chosen.item.id, code=chosen.item.code, name=chosen.item.name,
        description=chosen.item.description, icon=chosen.item.icon,
        image_url=chosen.item.image_url, rarity=chosen.item.rarity,
        category=chosen.item.category, can_gift=chosen.item.can_gift,
        can_activate=chosen.item.can_activate,
    ), quantity=1)


@router.post("/arcade-xp")
def award_arcade_xp(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    from datetime import timedelta
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_xp = db.query(models.Transaction).filter(
        models.Transaction.recipient_id == user.id,
        models.Transaction.note == "arcade_xp",
        models.Transaction.created_at >= one_hour_ago,
    ).count()
    if recent_xp >= 3:
        raise HTTPException(429, "Лимит XP за аркаду: 3 раза в час")
    user.xp += 5
    db.add(models.Transaction(recipient_id=user.id, amount=5, note="arcade_xp"))
    db.commit()
    return {"ok": True, "xp": user.xp}


@router.get("/lootbox-pools")
def list_lootbox_pools(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    pools = db.query(models.LootboxPool).all()
    result = []
    for p in pools:
        result.append({
            "code": p.code,
            "name": p.name,
            "entries": [
                {"item_id": e.item_id, "item_name": e.item.name, "item_icon": e.item.icon, "item_rarity": e.item.rarity, "weight": e.weight}
                for e in p.entries
            ],
        })
    return result
