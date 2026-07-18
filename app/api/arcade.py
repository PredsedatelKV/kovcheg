from __future__ import annotations

import json
import math
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import StrictInt
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet
from app.auth import current_user
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/arcade", tags=["arcade"])
SYSTEM_RANDOM = secrets.SystemRandom()

MSK = timezone(timedelta(hours=3))
OMAR_TELEGRAM_ID = 849162365


def _require_clicker_access(user: models.User) -> None:
    """Кликер временно доступен только Омару (админу). Проверяется на сервере,
    чтобы обычный пользователь не мог открыть игру обходным путём (через API)."""
    if user.telegram_id != OMAR_TELEGRAM_ID:
        raise HTTPException(status_code=403, detail="Кликер временно недоступен")


@router.post("/win")
def arcade_win(
    amount: StrictInt = Body(..., embed=True),
    game: str = Body("unknown", embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Removed insecure legacy endpoint that trusted a client payout."""
    raise HTTPException(status_code=410, detail="Используйте серверный раунд казино")


# Награда за первую победу дня в мини-игре (в ковбаксах). Только для 6 мини-игр Аркады.
FIRST_WIN_REWARD = 3
FIRST_WIN_GAMES = {"moshonka", "tictactoe", "minesweeper", "harvest", "checkers", "pingpong"}
FIRST_WIN_MIN_SECONDS = {
    "moshonka": 2.0, "tictactoe": 1.0, "minesweeper": 2.0,
    "harvest": 18.0, "checkers": 10.0, "pingpong": 6.0,
}
PINGPONG_WIN_SCORE = 5
PINGPONG_MIN_POINT_MS = 1_400
PINGPONG_CLOCK_TOLERANCE_MS = 2_000


def _validate_pingpong_result(payload: schemas.ArcadeFirstWinClaim, server_elapsed_seconds: float) -> None:
    """Reject scores that the client could not plausibly have produced.

    The server clock remains authoritative.  Client duration is accepted only
    as corroborating telemetry: it cannot exceed elapsed server time (apart
    from a small transport/rendering tolerance), and every scored point must
    account for at least one physically plausible serve/travel interval.
    """
    if payload.player_score is None or payload.opponent_score is None or payload.duration_ms is None:
        raise HTTPException(
            status_code=400,
            detail="Для результата пинг-понга не хватает данных",
        )
    if payload.player_score != PINGPONG_WIN_SCORE or not 0 <= payload.opponent_score < PINGPONG_WIN_SCORE:
        raise HTTPException(status_code=400, detail="Некорректный счёт пинг-понга")

    point_count = payload.player_score + payload.opponent_score
    minimum_duration_ms = point_count * PINGPONG_MIN_POINT_MS
    server_elapsed_ms = max(0, int(server_elapsed_seconds * 1000))
    if payload.duration_ms < minimum_duration_ms:
        raise HTTPException(
            status_code=400,
            detail="Матч завершён за физически невозможное время",
        )
    if payload.duration_ms > server_elapsed_ms + PINGPONG_CLOCK_TOLERANCE_MS:
        raise HTTPException(
            status_code=400,
            detail="Длительность матча не совпадает с серверным временем",
        )


def _validate_first_win_result(
    game: str,
    payload: schemas.ArcadeFirstWinClaim,
    server_elapsed_seconds: float,
) -> None:
    """Validate the concrete win telemetry for every rewarded mini-game.

    These games still run in the WebView, so telemetry cannot make a modified
    client trusted. It does, however, reject the previous empty-result exploit,
    impossible scores and instant/direct claims while keeping the server clock
    authoritative.
    """
    if game == "pingpong":
        _validate_pingpong_result(payload, server_elapsed_seconds)
        return
    if payload.player_score is None or payload.opponent_score is None or payload.duration_ms is None:
        raise HTTPException(status_code=400, detail="Для подтверждения победы не хватает данных")
    server_elapsed_ms = max(0, int(server_elapsed_seconds * 1000))
    if payload.duration_ms < int(FIRST_WIN_MIN_SECONDS[game] * 1000):
        raise HTTPException(status_code=400, detail="Игра завершена за невозможное время")
    if payload.duration_ms > server_elapsed_ms + PINGPONG_CLOCK_TOLERANCE_MS:
        raise HTTPException(status_code=400, detail="Длительность игры не совпадает с серверным временем")

    score = payload.player_score
    opponent = payload.opponent_score
    valid = {
        "moshonka": opponent == 0 and 10 <= score <= 10_000,
        "tictactoe": score == 1 and opponent == 0,
        "minesweeper": score == 54 and opponent == 10,
        "harvest": opponent == 0 and 10 <= score <= 70,
        "checkers": opponent == 0 and 1 <= score <= 12,
    }.get(game, False)
    if not valid:
        raise HTTPException(status_code=400, detail="Невозможный результат игры")


@router.post("/round/start")
def start_arcade_round(
    game: str = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if game not in FIRST_WIN_GAMES:
        raise HTTPException(status_code=400, detail="Неизвестная мини-игра")
    token = secrets.token_urlsafe(32)
    now = models.now_utc()
    db.add(models.ArcadeRound(
        token=token, user_id=user.id, game=game,
        started_at=now, expires_at=now + timedelta(hours=2),
    ))
    db.commit()
    return {"token": token, "game": game, "server_time": now.isoformat()}


@router.get("/first-win-status")
def first_win_status(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    now = datetime.now(MSK)
    today = now.strftime("%Y-%m-%d")
    wins = db.query(models.ArcadeFirstWin).filter(
        models.ArcadeFirstWin.user_id == user.id,
        models.ArcadeFirstWin.win_date == today,
    ).all()
    won = [w.game for w in wins if w.game in FIRST_WIN_GAMES]
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "won_games": won,
        "reward": FIRST_WIN_REWARD,
        "server_time": now.isoformat(),
        "next_reset_seconds": max(0, int((tomorrow - now).total_seconds())),
    }


@router.post("/first-win")
def claim_first_win(
    payload: schemas.ArcadeFirstWinClaim,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = payload.game
    round_token = payload.round_token
    if game not in FIRST_WIN_GAMES:
        raise HTTPException(status_code=400, detail="Неизвестная мини-игра")
    begin_game_write(db)
    now = models.now_utc()
    game_round = db.query(models.ArcadeRound).filter(
        models.ArcadeRound.token == round_token,
        models.ArcadeRound.user_id == user.id,
        models.ArcadeRound.game == game,
    ).first()
    if not game_round or game_round.consumed_at or game_round.expires_at < now:
        raise HTTPException(status_code=409, detail="Игровой раунд недействителен")
    server_elapsed_seconds = (now - game_round.started_at).total_seconds()
    if server_elapsed_seconds < FIRST_WIN_MIN_SECONDS[game]:
        raise HTTPException(status_code=400, detail="Невозможный результат игры")
    _validate_first_win_result(game, payload, server_elapsed_seconds)
    game_round.consumed_at = now
    today = datetime.now(MSK).strftime("%Y-%m-%d")
    existing = db.query(models.ArcadeFirstWin).filter(
        models.ArcadeFirstWin.user_id == user.id,
        models.ArcadeFirstWin.game == game,
        models.ArcadeFirstWin.win_date == today,
    ).first()
    if existing:
        db.commit()
        return {"ok": False, "already_claimed": True}

    db.add(models.ArcadeFirstWin(user_id=user.id, game=game, win_date=today))
    wallet = ensure_wallet(db, user)
    if wallet.balance < 0 or wallet.balance > 2_000_000_000 - FIRST_WIN_REWARD:
        raise HTTPException(status_code=409, detail="Достигнут максимальный баланс ковбаксов")
    wallet.balance += FIRST_WIN_REWARD
    db.add(models.Transaction(recipient_id=user.id, amount=FIRST_WIN_REWARD, note=f"first_win:{game}"))
    db.commit()
    db.refresh(user)
    return {"ok": True, "reward": FIRST_WIN_REWARD, "balance": user.wallet.balance}


@router.post("/bet")
def arcade_bet(
    amount: StrictInt = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    raise HTTPException(status_code=410, detail="Используйте серверный раунд казино")


CASINO_GAMES = {"roulette", "slots", "dice", "rocket"}
ROULETTE_MULTS = [(0.05, 16), (0.25, 11), (0.5, 15), (0.75, 15), (1.0, 15), (1.5, 12), (2.0, 8), (2.5, 5), (3.0, 3)]
ROCKET_GROWTH_PER_SECOND = 0.25
ROCKET_MAX_MULTIPLIER = 5.0


def _rocket_progress(row: models.CasinoRound, now: datetime | None = None) -> dict:
    """Return server-authoritative progress without revealing a future crash."""
    try:
        outcome = json.loads(row.outcome)
        crash_at = float(outcome["crash_at"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=409, detail="Состояние раунда повреждено") from exc
    if not math.isfinite(crash_at) or not 1.0 < crash_at <= ROCKET_MAX_MULTIPLIER:
        raise HTTPException(status_code=409, detail="Состояние раунда повреждено")

    current_time = now or models.now_utc()
    elapsed_seconds = max(0.0, (current_time - row.created_at).total_seconds())
    current_multiplier = min(
        ROCKET_MAX_MULTIPLIER,
        1.0 + elapsed_seconds * ROCKET_GROWTH_PER_SECOND,
    )
    crashed = current_multiplier >= crash_at
    # The game displays two decimal places. Use integer hundredths for both
    # display and payout so x1.50 can never pay as x1.49 because of rounding or
    # binary floating-point representation. Flooring also never exposes a
    # multiplier the server clock has not reached yet.
    settlement_hundredths = max(
        100,
        min(
            int(ROCKET_MAX_MULTIPLIER * 100),
            math.floor(min(current_multiplier, crash_at) * 100 + 1e-9),
        ),
    )
    return {
        "crashed": crashed,
        "current_multiplier": settlement_hundredths / 100,
        "_settlement_hundredths": settlement_hundredths,
        # The crash point becomes public only after the server clock reaches it.
        "crash_multiplier": crash_at if crashed else None,
    }


@router.post("/casino/start")
def casino_start(
    payload: dict = Body(...),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = payload.get("game")
    amount = payload.get("amount")
    choice = payload.get("choice")
    if type(game) is not str or type(amount) is not int or (choice is not None and type(choice) is not str):
        raise HTTPException(status_code=422, detail="Некорректный формат раунда")
    if game not in CASINO_GAMES or amount <= 0 or amount > 1_000_000:
        raise HTTPException(status_code=400, detail="Некорректный раунд")
    begin_game_write(db)
    wallet = ensure_wallet(db, user)
    if wallet.balance < amount:
        raise HTTPException(status_code=400, detail="Недостаточно Ковбаксов")
    max_bet = max(1, wallet.balance // 5)
    if amount > max_bet:
        raise HTTPException(status_code=400, detail=f"Максимальная ставка — {max_bet} ковбаксов")
    outcome: dict = {}
    payout = 0
    if game == "roulette":
        mult = SYSTEM_RANDOM.choices([m for m, _ in ROULETTE_MULTS], weights=[w for _, w in ROULETTE_MULTS], k=1)[0]
        outcome = {"multiplier": mult, "index": [m for m, _ in ROULETTE_MULTS].index(mult)}
        payout = int(amount * mult)
    elif game == "slots":
        symbols = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"]
        reels = [SYSTEM_RANDOM.choice(symbols) for _ in range(3)]
        payout = amount * 29 if len(set(reels)) == 1 else amount if len(set(reels)) == 2 else 0
        outcome = {"reels": reels}
    elif game == "dice":
        allowed = {"odd", "even", "low", "high", "1", "2", "3", "4", "5", "6"}
        if choice not in allowed:
            raise HTTPException(status_code=400, detail="Некорректный выбор")
        roll = SYSTEM_RANDOM.randint(1, 6)
        won = ((choice == "odd" and roll % 2 == 1) or (choice == "even" and roll % 2 == 0)
               or (choice == "low" and roll <= 3) or (choice == "high" and roll >= 4) or choice == str(roll))
        payout = (amount * 5 if choice and choice.isdigit() else int(amount * 1.8)) if won else 0
        outcome = {"roll": roll, "choice": choice}
    else:
        # Deterministic growth on the client; server-owned crash point prevents
        # a forged multiplier. Cap 5x keeps the game economy bounded.
        crash_at = round(min(ROCKET_MAX_MULTIPLIER, 1.05 + SYSTEM_RANDOM.expovariate(1.1)), 2)
        outcome = {"crash_at": crash_at}

    token = secrets.token_urlsafe(32)
    wallet.balance -= amount
    db.add(models.CasinoRound(token=token, user_id=user.id, game=game, bet=amount,
                              outcome=json.dumps(outcome), payout=payout))
    db.add(models.Transaction(sender_id=user.id, amount=amount, note=f"casino:bet:{game}"))
    db.commit()
    public_outcome = outcome
    if game == "rocket":
        # Never disclose the pre-generated crash point while a cashout is still
        # possible. The client needs only the public growth parameters to draw
        # the animation; the server clock remains authoritative.
        public_outcome = {
            "growth_per_second": ROCKET_GROWTH_PER_SECOND,
            "max_multiplier": ROCKET_MAX_MULTIPLIER,
        }
    return {"token": token, "outcome": public_outcome, "balance": wallet.balance}


@router.get("/casino/rocket/status")
def rocket_status(
    token: str = Query(..., min_length=8, max_length=128),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Poll a rocket round without leaking its future crash multiplier."""
    row = db.query(models.CasinoRound).filter(
        models.CasinoRound.token == token,
        models.CasinoRound.user_id == user.id,
        models.CasinoRound.game == "rocket",
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Раунд не найден")
    if row.settled:
        raise HTTPException(status_code=409, detail="Раунд уже завершён")
    progress = _rocket_progress(row)
    return {
        "crashed": progress["crashed"],
        "current_multiplier": progress["current_multiplier"],
        "crash_multiplier": progress["crash_multiplier"],
    }


@router.post("/casino/settle")
def casino_settle(
    token: str = Body(..., embed=True),
    multiplier: float | None = Body(None, embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    row = db.query(models.CasinoRound).filter(
        models.CasinoRound.token == token, models.CasinoRound.user_id == user.id,
    ).first()
    if not row or row.settled:
        raise HTTPException(status_code=409, detail="Раунд уже завершён или не найден")
    payout = row.payout
    rocket_result = None
    if row.game == "rocket":
        # Older clients send this field. It is validation-only now and can
        # never influence the payout; current clients omit it entirely.
        if multiplier is not None and not math.isfinite(multiplier):
            raise HTTPException(status_code=400, detail="Некорректный множитель")
        rocket_result = _rocket_progress(row)
        if rocket_result["crashed"]:
            payout = 0
        else:
            payout = min(
                row.bet * int(ROCKET_MAX_MULTIPLIER),
                row.bet * rocket_result["_settlement_hundredths"] // 100,
            )
    row.settled = True
    row.payout = payout
    wallet = ensure_wallet(db, user)
    if payout > 0:
        if wallet.balance < 0 or wallet.balance > 2_000_000_000 - payout:
            raise HTTPException(status_code=409, detail="Достигнут максимальный баланс ковбаксов")
        wallet.balance += payout
        db.add(models.Transaction(recipient_id=user.id, amount=payout, note=f"casino:win:{row.game}"))
    db.commit()
    response = {"ok": True, "payout": payout, "balance": wallet.balance}
    if rocket_result is not None:
        response.update({
            "crashed": rocket_result["crashed"],
            "multiplier": rocket_result["current_multiplier"],
            "crash_multiplier": rocket_result["crash_multiplier"],
        })
    return response

# ============ CLICKER ============
CLICKER_MAX_LEVEL = 20
CLICKER_CRIT_MULT = 4
CLICKER_TAP_ENERGY_COST = 1
CLICKER_MAX_PASSIVE_HOURS = 8

# Внутриигровая валюта — «ковкойны». Тапаешь → копишь ковкойны → выводишь в ковбаксы.
CLICKER_START_KOVCOINS = 1        # стартовый баланс ковкойнов (сразу можно кликать)
CLICKER_CASHOUT_RATE = 100        # 100 ковкойнов = 1 ковбакс (~1 ₽)
CLICKER_CASHOUT_MIN = 100         # минимальная сумма к выводу (в ковкойнах)

# --- Дневной лимит заработка ---
# Гарантирует «потолок» дохода: свежий игрок ~20 ₽/день, макс. прокачка ~100 ₽/день.
# 1 ковбакс ≈ 1 ₽, 100 ковкойнов = 1 ковбакс → 2000 ковкойнов = 20 ₽, 10000 = 100 ₽.
CLICKER_DAILY_CAP_MIN = 2000      # свежий игрок: ~20 ₽/день
CLICKER_DAILY_CAP_MAX = 10000     # полностью прокачанный: ~100 ₽/день

# --- Активные бусты (бесплатные, с дневным лимитом) ---
CLICKER_TURBO_SECONDS = 15        # длительность турбо
CLICKER_TURBO_MULT = 5            # множитель монет за тап в турбо (энергия не тратится)
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

# --- Анти-фрод (защита от автокликера), мягкий ---
# Защита неблокирующая: token-bucket просто НЕ ЗАСЧИТЫВАЕТ тапы быстрее «человеческого»
# темпа (лишние тапы за пачку отбрасываются). Живому игроку это не мешает — он и так
# не тапает быстрее, а автокликер не получает никакого преимущества: заработок сверх
# лимита скорости + энергии + дневного потолка просто невозможен. Никаких банов/пауз.
CLICKER_MAX_CPS = 20              # максимально «человеческая» скорость тапов (в сек)
CLICKER_TOKEN_BURST = 80          # ёмкость bucket-а (щедрый запас на всплеск/паузу)

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

# Стоимость апгрейдов — в ковкойнах (реинвест заработка). Прокачка растянута на дни/недели.
CLICKER_UPGRADES = {
    "click":   {"base_cost": 120, "mult": 1.28, "name": "Сила клика"},
    "passive": {"base_cost": 180, "mult": 1.28, "name": "Пассивный доход"},
    "energy":  {"base_cost": 150, "mult": 1.28, "name": "Макс. энергия"},
    "crit":    {"base_cost": 200, "mult": 1.30, "name": "Крит шанс"},
    "regen":   {"base_cost": 140, "mult": 1.28, "name": "Реген энергии"},
}


# Формулы прогрессии подобраны «пологими» (~5x от старта к максимуму), чтобы дневной
# лимит заполнялся сопоставимым усилием на любом уровне, а доход рос 20 → 100 ₽/день.
def _clicker_click_power(state):
    return 1.0 + state.lvl_click * 0.2          # 1.0 → 5.0


def _clicker_max_energy(state):
    return 500 + state.lvl_energy * 75          # 500 → 2000


def _clicker_regen_rate(state):
    return 1.0 + state.lvl_regen * 0.2          # 1.0 → 5.0 /сек


def _clicker_crit_chance(state):
    return min(state.lvl_crit * 1.0, 20) / 100.0  # 0 → 20%


def _clicker_passive_per_min(state):
    return 0.5 + state.lvl_passive * 0.3        # 0.5 → 6.5 /мин


def _clicker_upgrade_cost(key, current_level):
    cfg = CLICKER_UPGRADES[key]
    return int(cfg["base_cost"] * (cfg["mult"] ** current_level))


def _clicker_total_levels(state):
    return (
        state.lvl_click + state.lvl_passive + state.lvl_energy
        + state.lvl_crit + state.lvl_regen
    )


def _clicker_daily_cap(state):
    """Дневной лимит заработка в ковкойнах — растёт линейно с суммарной прокачкой."""
    frac = _clicker_total_levels(state) / (5.0 * CLICKER_MAX_LEVEL)
    return int(CLICKER_DAILY_CAP_MIN + frac * (CLICKER_DAILY_CAP_MAX - CLICKER_DAILY_CAP_MIN))


def _clicker_credit(state, amount):
    """Начисляет ковкойны с учётом дневного лимита. Возвращает реально начисленное."""
    amount = int(amount)
    if amount <= 0:
        return 0
    cap = _clicker_daily_cap(state)
    room = max(0, cap - (state.earned_today or 0))
    gain = min(amount, room)
    if gain > 0:
        state.kovcoins = (state.kovcoins or 0) + gain
        state.earned_today = (state.earned_today or 0) + gain
        state.total_earned = (state.total_earned or 0) + gain
    return gain


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
    """Reset clicker limits on the same Moscow calendar boundary as rewards."""
    key = now.replace(tzinfo=timezone.utc).astimezone(MSK).strftime("%Y-%m-%d")
    if (state.boost_date or "") != key:
        state.boost_date = key
        state.turbo_used = 0
        state.refill_used = 0
        state.passboost_used = 0
        state.earned_today = 0


def _get_or_create_clicker_state(db, user):
    state = (
        db.query(models.ClickerState)
        .filter(models.ClickerState.user_id == user.id)
        .first()
    )
    if not state:
        state = models.ClickerState(
            user_id=user.id,
            kovcoins=CLICKER_START_KOVCOINS,
            energy=500.0,
        )
        db.add(state)
        db.flush()
    return state


def _sync_clicker(db, state, user):
    """Реген энергии + токенов + пассивный доход (в ковкойны, с дневным лимитом).
    Возвращает passive_earned — реально начисленные ковкойны."""
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

    state.last_sync = now

    # Ковкойны — внутриигровая валюта, в кошелёк (ковбаксы) не попадают до вывода.
    return _clicker_credit(state, int(earned))


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
    # Блокировки отключены (мягкий анти-фрод). Гасим возможные старые блокировки.
    if state.locked_until is not None:
        state.locked_until = None
    if state.suspicion:
        state.suspicion = 0
    locked = False
    cap = _clicker_daily_cap(state)
    earned_today = state.earned_today or 0

    def _left(kind):
        return max(0, CLICKER_BOOST_DAILY[kind] - (getattr(state, CLICKER_BOOST_USED_ATTR[kind]) or 0))

    return {
        "levels": levels,
        "energy": round(state.energy, 1),
        "max_energy": _clicker_max_energy(state),
        "click_power": round(_clicker_click_power(state), 2),
        "passive_per_min": round(_clicker_passive_per_min(state), 2),
        "crit_chance": round(_clicker_crit_chance(state) * 100, 1),
        "regen_per_sec": round(_clicker_regen_rate(state), 1),
        "passive_earned": passive_earned,
        "upgrade_costs": {k: _clicker_upgrade_cost(k, levels[k]) for k in CLICKER_UPGRADES},
        "max_level": CLICKER_MAX_LEVEL,
        # Валюты
        "kovcoins": state.kovcoins or 0,          # внутриигровая (ковкойны)
        "balance": state.kovcoins or 0,           # алиас для совместимости
        "wallet": wallet.balance,                 # ковбаксы (после вывода)
        "cashout_rate": CLICKER_CASHOUT_RATE,
        "cashout_min": CLICKER_CASHOUT_MIN,
        # Дневной лимит
        "daily_cap": cap,
        "earned_today": earned_today,
        "cap_left": max(0, cap - earned_today),
        "cap_reached": earned_today >= cap,
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
    _require_clicker_access(user)
    begin_game_write(db)
    state = _get_or_create_clicker_state(db, user)
    passive_earned = _sync_clicker(db, state, user)
    wallet = ensure_wallet(db, user)
    now = models.now_utc()
    db.commit()
    return _clicker_payload(state, wallet, now, passive_earned)


@router.post("/clicker/tap")
def clicker_tap(
    taps: StrictInt = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Пачка тапов — списывает энергию, начисляет ковкойны (крит/турбо).
    Мягкий анти-фрод: лишние тапы сверх «человеческого» темпа просто не засчитываются."""
    if taps <= 0 or taps > 500:
        raise HTTPException(status_code=400, detail="Некорректное количество тапов")

    _require_clicker_access(user)
    begin_game_write(db)
    state = _get_or_create_clicker_state(db, user)
    _sync_clicker(db, state, user)
    now = models.now_utc()

    def _tap_result(coins, actual, crits, turbo, mult, cap_reached):
        return {
            "coins_earned": coins,
            "taps_processed": actual,
            "crits": crits,
            "energy": round(state.energy, 1),
            "max_energy": _clicker_max_energy(state),
            "kovcoins": state.kovcoins or 0,
            "balance": state.kovcoins or 0,
            "turbo": turbo,
            "mult": mult,
            "locked": False,
            "locked_left": 0,
            "total_earned": state.total_earned or 0,
            "daily_cap": _clicker_daily_cap(state),
            "earned_today": state.earned_today or 0,
            "cap_left": max(0, _clicker_daily_cap(state) - (state.earned_today or 0)),
            "cap_reached": cap_reached,
        }

    # Дневной лимит достигнут — не тратим энергию, просто сообщаем
    if (state.earned_today or 0) >= _clicker_daily_cap(state):
        db.commit()
        return _tap_result(0, 0, 0, _boost_active(state.turbo_until, now), 1, True)

    turbo = _boost_active(state.turbo_until, now)
    tokens = int(state.tap_tokens or 0)
    # В турбо энергия не тратится. Мягкий клэмп: не быстрее человеческого темпа.
    energy_limit = taps if turbo else int(state.energy / CLICKER_TAP_ENERGY_COST)
    actual = max(0, min(taps, tokens, energy_limit))

    state.tap_tokens = max(0.0, (state.tap_tokens or 0.0) - actual)
    if not turbo:
        state.energy = max(0.0, state.energy - actual * CLICKER_TAP_ENERGY_COST)

    power = _clicker_click_power(state)
    crit = _clicker_crit_chance(state)
    mult = CLICKER_TURBO_MULT if turbo else 1
    coins_f = 0.0
    crits = 0
    for _ in range(actual):
        if SYSTEM_RANDOM.random() < crit:
            coins_f += power * CLICKER_CRIT_MULT * mult
            crits += 1
        else:
            coins_f += power * mult

    coins = _clicker_credit(state, int(coins_f))
    cap_reached = (state.earned_today or 0) >= _clicker_daily_cap(state)
    db.commit()

    return _tap_result(coins, actual, crits, turbo, mult, cap_reached)


@router.post("/clicker/boost")
def clicker_boost(
    boost: str = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Активация буста: turbo (x-множитель тапа), refill (полная энергия), passive (x2 пассив)."""
    if boost not in CLICKER_BOOST_DAILY:
        raise HTTPException(status_code=400, detail="Неизвестный буст")

    _require_clicker_access(user)
    begin_game_write(db)
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


@router.post("/clicker/cashout")
def clicker_cashout(
    amount: StrictInt | None = Body(None, embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Вывод ковкойнов в ковбаксы по курсу 100:1. amount — сколько ковкойнов вывести
    (по умолчанию — максимум, кратный курсу)."""
    _require_clicker_access(user)
    begin_game_write(db)
    state = _get_or_create_clicker_state(db, user)
    _sync_clicker(db, state, user)
    now = models.now_utc()
    wallet = ensure_wallet(db, user)

    kc = state.kovcoins or 0
    if amount is None:
        spend = (kc // CLICKER_CASHOUT_RATE) * CLICKER_CASHOUT_RATE
    else:
        spend = (min(amount, kc) // CLICKER_CASHOUT_RATE) * CLICKER_CASHOUT_RATE

    if spend < CLICKER_CASHOUT_MIN:
        raise HTTPException(
            status_code=400,
            detail=f"Минимум для вывода — {CLICKER_CASHOUT_MIN} ковкойнов",
        )

    kovbaks = spend // CLICKER_CASHOUT_RATE
    if wallet.balance < 0 or wallet.balance > 2_000_000_000 - kovbaks:
        raise HTTPException(status_code=409, detail="Достигнут максимальный баланс ковбаксов")
    state.kovcoins = kc - spend
    wallet.balance += kovbaks
    db.add(
        models.Transaction(
            sender_id=None,
            recipient_id=user.id,
            amount=kovbaks,
            note="clicker:cashout",
        )
    )
    db.commit()

    payload = _clicker_payload(state, wallet, now)
    payload["cashed_out"] = kovbaks
    payload["spent_kovcoins"] = spend
    return payload


@router.post("/clicker/upgrade")
def clicker_upgrade(
    upgrade: str = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Покупка апгрейда за ковкойны (реинвест заработка)."""
    if upgrade not in CLICKER_UPGRADES:
        raise HTTPException(status_code=400, detail="Неизвестный апгрейд")

    _require_clicker_access(user)
    begin_game_write(db)
    state = _get_or_create_clicker_state(db, user)
    _sync_clicker(db, state, user)

    current_level = getattr(state, f"lvl_{upgrade}")
    if current_level >= CLICKER_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="Максимальный уровень достигнут")

    cost = _clicker_upgrade_cost(upgrade, current_level)

    if (state.kovcoins or 0) < cost:
        raise HTTPException(status_code=400, detail="Недостаточно ковкойнов")

    state.kovcoins = (state.kovcoins or 0) - cost
    setattr(state, f"lvl_{upgrade}", current_level + 1)
    db.commit()

    new_level = current_level + 1
    return {
        "upgrade": upgrade,
        "name": CLICKER_UPGRADES[upgrade]["name"],
        "new_level": new_level,
        "cost": cost,
        "kovcoins": state.kovcoins or 0,
        "balance": state.kovcoins or 0,
        "next_cost": _clicker_upgrade_cost(upgrade, new_level) if new_level < CLICKER_MAX_LEVEL else None,
        "max_reached": new_level >= CLICKER_MAX_LEVEL,
        "click_power": round(_clicker_click_power(state), 2),
        "max_energy": _clicker_max_energy(state),
        "passive_per_min": round(_clicker_passive_per_min(state), 2),
        "crit_chance": round(_clicker_crit_chance(state) * 100, 1),
        "regen_per_sec": round(_clicker_regen_rate(state), 1),
        "daily_cap": _clicker_daily_cap(state),
        "earned_today": state.earned_today or 0,
        "cap_left": max(0, _clicker_daily_cap(state) - (state.earned_today or 0)),
    }
