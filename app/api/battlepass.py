from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.access import MAINTENANCE_MESSAGE, is_section_closed
from app.api._helpers import award_xp, ensure_wallet
from app.auth import current_user, is_admin
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/battlepass", tags=["battlepass"])
MAX_REWARD_AMOUNT = 1_000_000
MAX_GAME_BALANCE = 2_000_000_000
MAX_INVENTORY_QUANTITY = 2_000_000_000
MAX_BATTLEPASS_LEVELS = 1_000


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


def _validate_season(season: models.BattlePassSeason) -> None:
    """Reject malformed legacy/admin data before it reaches arithmetic or rewards."""
    if not 1 <= season.xp_per_level <= MAX_REWARD_AMOUNT:
        raise HTTPException(503, "Сезон пропуска настроен некорректно: проверьте XP за уровень")
    if not 1 <= season.total_levels <= MAX_BATTLEPASS_LEVELS:
        raise HTTPException(503, "Сезон пропуска настроен некорректно: проверьте число уровней")


def _calc_level(xp: int, xp_per_level: int) -> tuple[int, int]:
    if xp_per_level < 1:
        raise HTTPException(503, "Сезон пропуска настроен некорректно: XP за уровень должен быть больше нуля")
    xp = max(0, xp)
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
    _validate_season(season)
    ubp = _get_ubp(db, user.id, season)
    level = max(0, min(int(getattr(user, "level", 1) or 1) - 1, season.total_levels - 1))
    current_xp = 0 if user.level >= season.total_levels else max(0, min(int(user.xp or 0), season.xp_per_level - 1))
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
        current_level=level,
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
    if is_section_closed(user, "battlepass"):
        raise HTTPException(503, MAINTENANCE_MESSAGE)
    begin_game_write(db)
    season = _get_active_season(db)
    if not season:
        raise HTTPException(404, "Нет активного сезона")
    _validate_season(season)
    ubp = _get_ubp(db, user.id, season)
    level_index = max(0, min(int(getattr(user, "level", 1) or 1) - 1, season.total_levels - 1))
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
        if item.lootbox_pool_code:
            pool = db.query(models.LootboxPool).filter(models.LootboxPool.code == item.lootbox_pool_code).first()
            if not pool or not pool.is_active or not pool.is_droppable or pool.is_archived:
                raise HTTPException(409, "Этот ковбокс больше не доступен для новых наград")
        qty = (reward.value or 1) if reward.value and reward.value > 0 else 1
        if qty > MAX_REWARD_AMOUNT:
            raise HTTPException(503, "Количество предметов в награде настроено некорректно")
        inv = db.query(models.InventoryItem).filter(
            models.InventoryItem.user_id == user.id,
            models.InventoryItem.item_id == item.id,
        ).first()
        if inv:
            if inv.quantity < 0 or inv.quantity > MAX_INVENTORY_QUANTITY - qty:
                raise HTTPException(409, "Достигнут максимальный размер стака предмета")
            inv.quantity += qty
        else:
            db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=qty))

    xp_to_coins = 0
    reward_value = reward.value or 0
    if reward.kind == "coins" or reward.kind.startswith("coins_"):
        if not 1 <= reward_value <= MAX_REWARD_AMOUNT:
            raise HTTPException(503, "Сумма награды пропуска настроена некорректно")
        wallet = ensure_wallet(db, user)
        if wallet.balance < 0 or wallet.balance > MAX_GAME_BALANCE - reward_value:
            raise HTTPException(409, "Достигнут максимальный баланс ковбаксов")
        wallet.balance += reward_value
        db.add(models.Transaction(recipient_id=user.id, amount=reward_value, note=f"Battle Pass: {reward.label}"))
    elif reward.kind == "xp":
        if not 1 <= reward_value <= MAX_REWARD_AMOUNT:
            raise HTTPException(503, "Награда XP пропуска настроена некорректно")
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

    begin_game_write(db)
    target = user
    if body.user_id:
        target = db.query(models.User).filter(models.User.id == body.user_id).first()
        if not target:
            raise HTTPException(404, "Пользователь не найден")

    xp_to_coins = 0
    if body.mode == "set":
        target.xp = 0 if target.level >= 100 else min(99, max(0, body.amount))
    elif body.mode == "sub":
        target.xp = max(0, target.xp - body.amount)
    else:
        xp_to_coins = award_xp(db, target, body.amount)["coins"]

    db.commit()
    return {"ok": True, "xp": target.xp, "level": target.level, "xp_to_coins": xp_to_coins}


@router.post("/open-lootbox", response_model=schemas.LootboxOpenResult)
def open_lootbox(
    body: schemas.OpenLootboxRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    # Compatibility route: all clients now share the same atomic/idempotent
    # implementation, so the old URL cannot bypass the editor configuration.
    from app.api.profile import open_lootbox_for_user

    return open_lootbox_for_user(body=body, user=user, db=db)


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
    pools = db.query(models.LootboxPool).filter(models.LootboxPool.is_active.is_(True)).all()
    result = []
    for p in pools:
        result.append({
            "code": p.code,
            "name": p.name,
            "rarity": p.rarity,
            "image_url": p.image_url,
            "open_image_url": p.open_image_url or p.image_url,
            "opening_mode": p.opening_mode,
            "bonus_item_chance": p.bonus_item_chance,
            "entries": [
                {
                    "item_id": e.item_id,
                    "item_name": e.item.name if e.item else e.reward_kind,
                    "item_icon": e.item.icon if e.item else (
                        "/static/img/ui/xp.png" if e.reward_kind == "xp" else "/static/img/ui/kovbaks.png"
                    ),
                    "item_rarity": e.item.rarity if e.item else "Обычный",
                    "weight": e.weight,
                    "reward_kind": e.reward_kind,
                    "amount_min": e.amount_min,
                    "amount_max": e.amount_max,
                    "is_guaranteed": e.is_guaranteed,
                }
                for e in p.entries if e.is_active
            ],
        })
    return result
