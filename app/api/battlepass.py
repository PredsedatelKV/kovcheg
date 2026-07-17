from __future__ import annotations

import json
import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import award_xp, ensure_wallet
from app.auth import current_user, is_admin
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/battlepass", tags=["battlepass"])


def _get_active_season(db: Session) -> models.BattlePassSeason | None:
    return db.query(models.BattlePassSeason).filter(models.BattlePassSeason.is_active.is_(True)).first()


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


def _normalize_claimed(claimed):
    """Normalize claimed_rewards: handle old [[lvl,track]] and new [lvl] formats."""
    if not claimed:
        return []
    result = []
    for c in claimed:
        if isinstance(c, (list, tuple)):
            result.append(c[0])
        else:
            result.append(c)
    return result


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
    claimed_raw: list = []
    if ubp.claimed_rewards:
        try:
            parsed = json.loads(ubp.claimed_rewards) if isinstance(ubp.claimed_rewards, str) else ubp.claimed_rewards
            if isinstance(parsed, list):
                claimed_raw = parsed
        except (json.JSONDecodeError, TypeError):
            claimed_raw = []
    claimed = set(_normalize_claimed(claimed_raw))
    claimed.update(
        level for (level,) in db.query(models.BattlePassReward.level)
        .join(models.BattlePassClaim, models.BattlePassClaim.reward_id == models.BattlePassReward.id)
        .filter(models.BattlePassClaim.user_id == user.id, models.BattlePassReward.season_id == season.id)
        .all()
    )

    rewards: list[schemas.BattlePassRewardOut] = []
    for r in season.rewards:
        if r.track != "free":
            continue
        rewards.append(_reward_out(r, claimed=r.level in claimed))

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
        claimed_rewards=sorted(claimed),
    )


@router.post("/claim")
def claim_reward(
    body: schemas.ClaimRewardRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    season = _get_active_season(db)
    if not season:
        raise HTTPException(404, "Нет активного сезона")
    ubp = _get_ubp(db, user.id, season)
    level_index, _ = _calc_level(user.xp, season.xp_per_level)
    # API stores a zero-based progress index, while rewards are numbered 1..N.
    achieved_level = min(level_index + 1, season.total_levels)

    reward = db.query(models.BattlePassReward).filter(
        models.BattlePassReward.season_id == season.id,
        models.BattlePassReward.level == body.level,
        models.BattlePassReward.track == "free",
    ).first()
    if not reward:
        raise HTTPException(404, "Награда не найдена")

    if reward.level > achieved_level:
        raise HTTPException(403, f"Уровень {reward.level} ещё не достигнут (текущий {achieved_level})")

    claimed_raw: list = []
    if ubp.claimed_rewards:
        try:
            parsed = json.loads(ubp.claimed_rewards) if isinstance(ubp.claimed_rewards, str) else ubp.claimed_rewards
            if isinstance(parsed, list):
                claimed_raw = parsed
        except (json.JSONDecodeError, TypeError):
            claimed_raw = []
    claimed = _normalize_claimed(claimed_raw)

    existing_claim = db.query(models.BattlePassClaim).filter(
        models.BattlePassClaim.user_id == user.id,
        models.BattlePassClaim.reward_id == reward.id,
    ).first()
    if reward.level in claimed or existing_claim:
        raise HTTPException(409, "Награда уже получена")

    # Сначала ВЫДАЁМ награду; claimed помечаем и коммитим ТОЛЬКО после успешной выдачи.
    def _grant_item(item_code: str) -> None:
        item = db.query(models.Item).filter(models.Item.code == item_code).first()
        if not item:
            raise HTTPException(400, "Предмет награды не найден")
        qty = (reward.value or 1) if reward.value and reward.value > 0 else 1
        inv = db.query(models.InventoryItem).filter(
            models.InventoryItem.user_id == user.id,
            models.InventoryItem.item_id == item.id,
        ).first()
        if inv:
            inv.quantity += qty
        else:
            db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=qty))

    xp_to_coins = 0
    reward_value = reward.value or 0
    if reward.kind == "coins" or reward.kind.startswith("coins_"):
        wallet = ensure_wallet(db, user)
        wallet.balance += reward_value
        db.add(models.Transaction(recipient_id=user.id, amount=reward_value, note=f"Battle Pass: {reward.label}"))
    elif reward.kind == "xp":
        xp_to_coins = award_xp(db, user, reward_value)["coins"]
    elif reward.kind == "item":
        if not reward.item_code:
            raise HTTPException(400, "У награды не задан предмет")
        _grant_item(reward.item_code)
    elif reward.kind == "lootbox" or reward.kind.startswith("lootbox"):
        if not reward.item_code:
            raise HTTPException(400, "У награды-лутбокса не задан предмет")
        _grant_item(reward.item_code)
    else:
        raise HTTPException(400, f"Неизвестный тип награды: {reward.kind}")

    db.add(models.BattlePassClaim(user_id=user.id, reward_id=reward.id))
    claimed.append(reward.level)
    ubp.claimed_rewards = json.dumps(claimed)

    db.commit()
    db.refresh(user)
    return {"ok": True, "balance": user.wallet.balance if user.wallet else 0, "xp_to_coins": xp_to_coins}


@router.post("/award-xp")
def award_xp_route(
    body: schemas.AwardXpRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    # ВАЖНО: имя функции не должно совпадать с импортированным хелпером award_xp
    # (иначе оно перекрывает его на уровне модуля и клейм наград-XP падает).
    if not is_admin(user):
        raise HTTPException(403, "Только для админов")

    target = user
    if body.user_id:
        target = db.query(models.User).filter(models.User.id == body.user_id).first()
        if not target:
            raise HTTPException(404, "Пользователь не найден")

    xp_to_coins = 0
    if body.mode == "set":
        target.xp = max(0, body.amount)
    elif body.mode == "sub":
        target.xp = max(0, target.xp - body.amount)
    else:
        xp_to_coins = award_xp(db, target, body.amount)["coins"]

    db.commit()
    return {"ok": True, "xp": target.xp, "xp_to_coins": xp_to_coins}


@router.post("/open-lootbox", response_model=schemas.LootboxOpenResult)
def open_lootbox(
    body: schemas.OpenLootboxRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
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
    total_weight = sum(max(0, e.weight) for e in entries)
    if total_weight <= 0:
        raise HTTPException(400, "Некорректные веса пула ковбокса")
    roll = random.randint(1, total_weight)
    cumulative = 0
    chosen = entries[0]
    for e in entries:
        cumulative += max(0, e.weight)
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
    # The old route had no game proof and could be called three times per hour
    # without playing. XP now comes only from verified game/task flows.
    raise HTTPException(status_code=410, detail="Устаревший способ начисления XP отключён")


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
