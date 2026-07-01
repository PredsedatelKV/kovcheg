from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/arcade", tags=["arcade"])

MAX_WIN_MULTIPLIER = 5


@router.post("/win")
def arcade_win(
    amount: int = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    """Начислить выигрыш за мини-игру (привязан к последней ставке, ограничен)."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Некорректная сумма")
    wallet = ensure_wallet(db, user)

    last_bet = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.sender_id == user.id,
            models.Transaction.note == "arcade:bet",
        )
        .order_by(models.Transaction.created_at.desc())
        .first()
    )
    if last_bet is None:
        raise HTTPException(status_code=400, detail="Сначала сделайте ставку")

    already_won = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.recipient_id == user.id,
            models.Transaction.note == "arcade:win",
            models.Transaction.created_at >= last_bet.created_at,
        )
        .first()
    )
    if already_won is not None:
        raise HTTPException(status_code=400, detail="Выигрыш уже начислен")

    if amount > last_bet.amount * MAX_WIN_MULTIPLIER:
        raise HTTPException(status_code=400, detail="Слишком большой выигрыш")

    wallet.balance += amount
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
    amount: int = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    """Списать ставку для казино."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Некорректная сумма")
    wallet = ensure_wallet(db, user)
    if wallet.balance < amount:
        raise HTTPException(status_code=400, detail="Недостаточно K")
    wallet.balance -= amount
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

# ============ CLICKER ============
import random
from datetime import timedelta

CLICKER_MAX_LEVEL = 20
CLICKER_CRIT_MULT = 10
CLICKER_TAP_ENERGY_COST = 1
CLICKER_MAX_PASSIVE_HOURS = 8

# --- Активные бусты (бесплатные, с дневным лимитом) ---
CLICKER_TURBO_SECONDS = 20        # длительность турбо
CLICKER_TURBO_MULT = 7            # множитель монет за тап в турбо (энергия не тратится)
CLICKER_TURBO_DAILY = 3           # запусков турбо в день

CLICKER_REFILL_DAILY = 3          # «полная заправка» энергии в день

CLICKER_PASSBOOST_SECONDS = 4 * 3600   # ускорение пассивного дохода
CLICKER_PASSBOOST_MULT = 2             # x2 к пассиву на время
CLICKER_PASSBOOST_DAILY = 2

CLICKER_BOOST_DAILY = {
    "turbo": CLICKER_TURBO_DAILY,
    "refill": CLICKER_REFILL_DAILY,
    "passive": CLICKER_PASSBOOST_DAILY,
}
CLICKER_BOOST_USED_ATTR = {
    "turbo": "turbo_used",
    "refill": "refill_used",
    "passive": "passboost_used",
}

# --- Анти-фрод (защита от автокликера) ---
# Экономику ограничивает энергия, а token-bucket не даёт засчитать тапы быстрее,
# чем это физически способен сделать человек. Слишком «нечеловеческий» темп копит
# подозрительность и приводит к временной блокировке тапов.
CLICKER_MAX_CPS = 15              # максимально «человеческая» скорость тапов (в сек)
CLICKER_TOKEN_BURST = 45          # ёмкость bucket-а (запас на короткий всплеск)
CLICKER_SUSPICION_LOCK = 12       # порог подозрительности → блокировка
CLICKER_LOCK_SECONDS = 120        # длительность блокировки тапов

# Ранги по суммарному заработку
CLICKER_RANKS = [
    (0, "Юнга"),
    (5_000, "Матрос"),
    (25_000, "Боцман"),
    (100_000, "Штурман"),
    (400_000, "Капитан"),
    (1_500_000, "Адмирал"),
    (6_000_000, "Легенда Ковчега"),
]

CLICKER_UPGRADES = {
    "click":   {"base_cost": 100, "mult": 1.5, "name": "Сила клика"},
    "passive": {"base_cost": 200, "mult": 1.5, "name": "Пассивный доход"},
    "energy":  {"base_cost": 150, "mult": 1.5, "name": "Макс. энергия"},
    "crit":    {"base_cost": 300, "mult": 1.6, "name": "Крит шанс"},
    "regen":   {"base_cost": 120, "mult": 1.5, "name": "Реген энергии"},
}


def _clicker_click_power(state):
    return 1 + state.lvl_click


def _clicker_max_energy(state):
    return 100 + state.lvl_energy * 50


def _clicker_regen_rate(state):
    return 1.0 + state.lvl_regen * 0.5


def _clicker_crit_chance(state):
    return min(state.lvl_crit * 3, 75) / 100.0


def _clicker_passive_per_min(state):
    return state.lvl_passive * 0.5


def _clicker_upgrade_cost(key, current_level):
    cfg = CLICKER_UPGRADES[key]
    return int(cfg["base_cost"] * (cfg["mult"] ** current_level))


def _clicker_level(total_earned):
    """Уровень кликера по суммарному заработку. Порог уровня n = 500 * n²."""
    total = max(0, int(total_earned or 0))
    lvl = int((total / 500) ** 0.5)
    cur_floor = 500 * lvl * lvl
    next_floor = 500 * (lvl + 1) * (lvl + 1)
    rank = CLICKER_RANKS[0][1]
    for thr, name in CLICKER_RANKS:
        if total >= thr:
            rank = name
    return lvl, rank, cur_floor, next_floor


def _boost_active(until, now):
    return bool(until) and until > now


def _reset_daily_boosts(state, now):
    """Сбрасывает дневные лимиты бустов при смене суток (UTC)."""
    key = now.strftime("%Y-%m-%d")
    if (state.boost_date or "") != key:
        state.boost_date = key
        state.turbo_used = 0
        state.refill_used = 0
        state.passboost_used = 0


def _get_or_create_clicker_state(db, user):
    state = (
        db.query(models.ClickerState)
        .filter(models.ClickerState.user_id == user.id)
        .first()
    )
    if not state:
        state = models.ClickerState(user_id=user.id)
        db.add(state)
        db.flush()
    return state


def _sync_clicker(db, state, user):
    """Реген энергии + токенов + пассивный доход. Возвращает passive_earned (зачислен в кошелёк)."""
    now = models.now_utc()
    _reset_daily_boosts(state, now)

    elapsed = (now - state.last_sync).total_seconds()
    if elapsed <= 0:
        return 0

    max_e = _clicker_max_energy(state)
    regen = _clicker_regen_rate(state)
    state.energy = max(0.0, min(float(max_e), (state.energy or 0.0) + regen * elapsed))

    # Пополнение token-bucket анти-фрода
    state.tap_tokens = min(
        float(CLICKER_TOKEN_BURST),
        (state.tap_tokens or 0.0) + CLICKER_MAX_CPS * elapsed,
    )

    # Пассивный доход (с учётом кэпа офлайна и возможного буста x2)
    passive_elapsed = min(elapsed, CLICKER_MAX_PASSIVE_HOURS * 3600)
    passive_rate = _clicker_passive_per_min(state) / 60.0
    earned = passive_rate * passive_elapsed
    if state.passive_boost_until:
        window_start = now - timedelta(seconds=passive_elapsed)
        b_end = min(now, state.passive_boost_until)
        b_start = max(window_start, state.last_sync)
        overlap = (b_end - b_start).total_seconds()
        if overlap > 0:
            earned += passive_rate * (CLICKER_PASSBOOST_MULT - 1) * overlap
    passive_earned = int(earned)

    state.last_sync = now

    if passive_earned > 0:
        wallet = ensure_wallet(db, user)
        wallet.balance += passive_earned
        state.total_earned = (state.total_earned or 0) + passive_earned
        db.add(
            models.Transaction(
                sender_id=None,
                recipient_id=user.id,
                amount=passive_earned,
                note="clicker:passive",
            )
        )

    return passive_earned


def _clicker_payload(state, wallet, now, passive_earned=0):
    """Единый снимок состояния кликера для фронтенда."""
    levels = {
        "click": state.lvl_click,
        "passive": state.lvl_passive,
        "energy": state.lvl_energy,
        "crit": state.lvl_crit,
        "regen": state.lvl_regen,
    }
    lvl, rank, cur_floor, next_floor = _clicker_level(state.total_earned)
    turbo_active = _boost_active(state.turbo_until, now)
    passive_active = _boost_active(state.passive_boost_until, now)
    locked = _boost_active(state.locked_until, now)

    def _left(kind):
        return max(0, CLICKER_BOOST_DAILY[kind] - (getattr(state, CLICKER_BOOST_USED_ATTR[kind]) or 0))

    return {
        "levels": levels,
        "energy": round(state.energy, 1),
        "max_energy": _clicker_max_energy(state),
        "click_power": _clicker_click_power(state),
        "passive_per_min": round(_clicker_passive_per_min(state), 1),
        "crit_chance": round(_clicker_crit_chance(state) * 100, 1),
        "regen_per_sec": round(_clicker_regen_rate(state), 1),
        "passive_earned": passive_earned,
        "upgrade_costs": {k: _clicker_upgrade_cost(k, levels[k]) for k in CLICKER_UPGRADES},
        "max_level": CLICKER_MAX_LEVEL,
        "balance": wallet.balance,
        "total_earned": state.total_earned or 0,
        "level": lvl,
        "rank": rank,
        "level_floor": cur_floor,
        "level_next": next_floor,
        "locked": locked,
        "locked_left": int((state.locked_until - now).total_seconds()) if locked else 0,
        "boosts": {
            "turbo": {
                "active": turbo_active,
                "left_sec": int((state.turbo_until - now).total_seconds()) if turbo_active else 0,
                "uses_left": _left("turbo"),
                "daily": CLICKER_TURBO_DAILY,
                "mult": CLICKER_TURBO_MULT,
                "duration": CLICKER_TURBO_SECONDS,
            },
            "refill": {
                "uses_left": _left("refill"),
                "daily": CLICKER_REFILL_DAILY,
            },
            "passive": {
                "active": passive_active,
                "left_sec": int((state.passive_boost_until - now).total_seconds()) if passive_active else 0,
                "uses_left": _left("passive"),
                "daily": CLICKER_PASSBOOST_DAILY,
                "mult": CLICKER_PASSBOOST_MULT,
                "duration": CLICKER_PASSBOOST_SECONDS,
            },
        },
    }


@router.get("/clicker/state")
def clicker_state(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Состояние кликера + синхронизация энергии/пассива."""
    state = _get_or_create_clicker_state(db, user)
    passive_earned = _sync_clicker(db, state, user)
    wallet = ensure_wallet(db, user)
    now = models.now_utc()
    db.commit()
    return _clicker_payload(state, wallet, now, passive_earned)


@router.post("/clicker/tap")
def clicker_tap(
    taps: int = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Пачка тапов — списывает энергию, начисляет монеты (крит/турбо), анти-фрод по CPS."""
    if taps <= 0 or taps > 200:
        raise HTTPException(status_code=400, detail="Некорректное количество тапов")

    state = _get_or_create_clicker_state(db, user)
    _sync_clicker(db, state, user)
    now = models.now_utc()
    wallet = ensure_wallet(db, user)

    # Анти-фрод: активная блокировка — тапы не засчитываются
    if _boost_active(state.locked_until, now):
        db.commit()
        return {
            "coins_earned": 0,
            "taps_processed": 0,
            "crits": 0,
            "energy": round(state.energy, 1),
            "max_energy": _clicker_max_energy(state),
            "balance": wallet.balance,
            "turbo": _boost_active(state.turbo_until, now),
            "locked": True,
            "locked_left": int((state.locked_until - now).total_seconds()),
            "total_earned": state.total_earned or 0,
        }

    turbo = _boost_active(state.turbo_until, now)
    tokens = int(state.tap_tokens or 0)
    # В турбо энергия не тратится
    energy_limit = taps if turbo else int(state.energy / CLICKER_TAP_ENERGY_COST)
    allowed = max(0, min(taps, tokens, energy_limit))

    # Подозрительность: клиент заявил ощутимо больше тапов, чем позволяет «человеческий» темп
    if taps > tokens + 5:
        state.suspicion = (state.suspicion or 0) + 1
    else:
        state.suspicion = max(0, (state.suspicion or 0) - 1)

    locked_now = False
    if state.suspicion >= CLICKER_SUSPICION_LOCK:
        state.locked_until = now + timedelta(seconds=CLICKER_LOCK_SECONDS)
        state.suspicion = 0
        allowed = 0
        locked_now = True

    actual = allowed
    state.tap_tokens = max(0.0, (state.tap_tokens or 0.0) - actual)
    if not turbo:
        state.energy = max(0.0, state.energy - actual * CLICKER_TAP_ENERGY_COST)

    power = _clicker_click_power(state)
    crit = _clicker_crit_chance(state)
    mult = CLICKER_TURBO_MULT if turbo else 1
    coins = 0
    crits = 0
    for _ in range(actual):
        if random.random() < crit:
            coins += power * CLICKER_CRIT_MULT * mult
            crits += 1
        else:
            coins += power * mult

    if coins > 0:
        wallet.balance += coins
        state.total_earned = (state.total_earned or 0) + coins
        db.add(
            models.Transaction(
                sender_id=None,
                recipient_id=user.id,
                amount=coins,
                note="clicker:tap",
            )
        )
    db.commit()

    locked = _boost_active(state.locked_until, now)
    return {
        "coins_earned": coins,
        "taps_processed": actual,
        "crits": crits,
        "energy": round(state.energy, 1),
        "max_energy": _clicker_max_energy(state),
        "balance": wallet.balance,
        "turbo": turbo,
        "mult": mult,
        "locked": locked or locked_now,
        "locked_left": int((state.locked_until - now).total_seconds()) if locked else 0,
        "total_earned": state.total_earned or 0,
    }


@router.post("/clicker/boost")
def clicker_boost(
    boost: str = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Активация буста: turbo (x-множитель тапа), refill (полная энергия), passive (x2 пассив)."""
    if boost not in CLICKER_BOOST_DAILY:
        raise HTTPException(status_code=400, detail="Неизвестный буст")

    state = _get_or_create_clicker_state(db, user)
    _sync_clicker(db, state, user)
    now = models.now_utc()

    used_attr = CLICKER_BOOST_USED_ATTR[boost]
    used = getattr(state, used_attr) or 0
    if used >= CLICKER_BOOST_DAILY[boost]:
        raise HTTPException(status_code=400, detail="Лимит буста на сегодня исчерпан")

    if boost == "turbo":
        if _boost_active(state.turbo_until, now):
            raise HTTPException(status_code=400, detail="Турбо уже активно")
        state.turbo_until = now + timedelta(seconds=CLICKER_TURBO_SECONDS)
    elif boost == "refill":
        state.energy = float(_clicker_max_energy(state))
    elif boost == "passive":
        if _boost_active(state.passive_boost_until, now):
            raise HTTPException(status_code=400, detail="Ускорение пассива уже активно")
        state.passive_boost_until = now + timedelta(seconds=CLICKER_PASSBOOST_SECONDS)

    setattr(state, used_attr, used + 1)
    wallet = ensure_wallet(db, user)
    db.commit()

    payload = _clicker_payload(state, wallet, now)
    payload["activated"] = boost
    return payload


@router.post("/clicker/upgrade")
def clicker_upgrade(
    upgrade: str = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Buy an upgrade — deduct coins, increment level."""
    if upgrade not in CLICKER_UPGRADES:
        raise HTTPException(status_code=400, detail="Неизвестный апгрейд")

    state = _get_or_create_clicker_state(db, user)
    _sync_clicker(db, state, user)

    current_level = getattr(state, f"lvl_{upgrade}")
    if current_level >= CLICKER_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="Максимальный уровень достигнут")

    cost = _clicker_upgrade_cost(upgrade, current_level)
    wallet = ensure_wallet(db, user)

    if wallet.balance < cost:
        raise HTTPException(status_code=400, detail="Недостаточно K")

    wallet.balance -= cost
    setattr(state, f"lvl_{upgrade}", current_level + 1)

    db.add(
        models.Transaction(
            sender_id=user.id,
            recipient_id=None,
            amount=cost,
            note=f"clicker:upgrade:{upgrade}",
        )
    )
    db.commit()

    new_level = current_level + 1
    return {
        "upgrade": upgrade,
        "name": CLICKER_UPGRADES[upgrade]["name"],
        "new_level": new_level,
        "cost": cost,
        "balance": wallet.balance,
        "next_cost": _clicker_upgrade_cost(upgrade, new_level) if new_level < CLICKER_MAX_LEVEL else None,
        "max_reached": new_level >= CLICKER_MAX_LEVEL,
        "click_power": _clicker_click_power(state),
        "max_energy": _clicker_max_energy(state),
        "passive_per_min": round(_clicker_passive_per_min(state), 1),
        "crit_chance": round(_clicker_crit_chance(state) * 100, 1),
        "regen_per_sec": round(_clicker_regen_rate(state), 1),
    }
