from __future__ import annotations

import hashlib
import json
import math
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import StrictInt
from sqlalchemy.orm import Session

from app import casino_slots, models, schemas
from app.access import FAILURE_FRAGMENTS_ENABLED, can_use_clicker
from app.api import _casino_wallet as casino_wallet
from app.api._helpers import ensure_wallet, require_open_section
from app.auth import current_user
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/arcade", tags=["arcade"], dependencies=[Depends(require_open_section("arcade"))])
SYSTEM_RANDOM = secrets.SystemRandom()

MSK = timezone(timedelta(hours=3))
# Kept as a stable historical account identifier for integrations/tests; it no
# longer grants exclusive access to the released Clicker.
OMAR_TELEGRAM_ID = 849162365


def _require_clicker_access(user: models.User) -> None:
    """Clicker is released for every authenticated player.

    Keeping this small gate in one place makes a future maintenance switch
    possible without re-introducing client-only access checks.
    """
    if not user or not user.id:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    if not can_use_clicker(user):
        raise HTTPException(status_code=403, detail="Кликер скоро станет доступен")


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
FIRST_WIN_GAMES = {"moshonka", "tictactoe", "minesweeper", "harvest", "checkers", "pingpong"}
FIRST_WIN_REWARDS = {
    "moshonka": 40,
    "tictactoe": 40,
    "harvest": 50,
    "checkers": 75,
    "pingpong": 75,
    "minesweeper": 120,
}
# Kept for old integrations; new clients use the per-game table above.
FIRST_WIN_REWARD = min(FIRST_WIN_REWARDS.values())
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
        "rewards": FIRST_WIN_REWARDS,
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
    reward = FIRST_WIN_REWARDS[game]
    if wallet.balance < 0 or wallet.balance > 2_000_000_000 - reward:
        raise HTTPException(status_code=409, detail="Достигнут максимальный баланс ковбаксов")
    wallet.balance += reward
    db.add(models.Transaction(recipient_id=user.id, amount=reward, note=f"first_win:{game}"))
    db.commit()
    db.refresh(user)
    return {"ok": True, "reward": reward, "balance": user.wallet.balance}


@router.post("/bet")
def arcade_bet(
    amount: StrictInt = Body(..., embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.UserOut:
    raise HTTPException(status_code=410, detail="Используйте серверный раунд казино")


CASINO_GAMES = {"riskwheel", "dice", "rocket", "vault"}

# Номинальная отдача до округления выплат до целых Ковбаксов.
CASINO_RTP_PERCENT = 90
CASINO_MIN_BET = 100
CASINO_MAX_BET = 10_000

# Ограничений по числу раундов нет. Защитная пауза включается только если
# чистый убыток за скользящий час достиг половины стартового баланса.

# Все выплаты хранятся в процентах от ставки (целые числа), а не во float:
# payout = ставка * процент // 100 считается точно и не даёт копеечных
# расхождений между показанным множителем и реально зачисленной суммой.

# Колесо риска: 9 секторов, шансы в процентах, сумма шансов = 100.
# sum(процент выплаты * шанс) = 9000.
RISKWHEEL_PAYOUTS = ((5, 15), (25, 13), (50, 15), (75, 16), (100, 15),
                     (150, 11), (200, 8), (250, 4), (300, 3))

# Рулетка имеет фиксированную ставку и показывает реальные суммы, а не
# множители. Шансы заданы в базисных пунктах (1/100 процента), чтобы редкие
# выплаты не приходилось грубо округлять. Сумма весов = 10_000, а
# sum(выплата * вес) / 10_000 = 90 при ставке 100.
ROULETTE_FIXED_BET = 100
FAILURE_FRAGMENT_MIN_BET = 100
ROULETTE_PAYOUTS = (
    (10, 900),
    (20, 1_100),
    (30, 1_000),
    (40, 1_000),
    (50, 1_000),
    (100, 3_490),
    (200, 1_200),
    (500, 300),
    (1_000, 10),
)

# Кубик: 1/6 × 540% = 1/2 × 180% = 90%.
DICE_EXACT_PAYOUT_PERCENT = 540
DICE_EVEN_PAYOUT_PERCENT = 180

# Вероятность дожить до множителя x равна RTP/x.
ROCKET_GROWTH_PER_SECOND = 0.25
ROCKET_MAX_MULTIPLIER = 5.0
ROCKET_MIN_MULTIPLIER = 1.0

# The four safe doors are uniformly shuffled. The mean offer is 90%.
# Guessing the key doubles the integer offer with probability 1/2.
VAULT_PAYOUTS = (45, 80, 100, 135)
VAULT_KEYS = ("left", "right")


def _weighted_percent(table: tuple) -> tuple[int, int]:
    """Выбрать (процент выплаты, индекс) по таблице (процент, шанс).

    Шансы — прямые проценты и обязаны давать в сумме 100: так таблица
    одновременно задаёт и вероятности, и RTP, который можно проверить глазами.
    """
    percents = [percent for percent, _ in table]
    chances = [chance for _, chance in table]
    if sum(chances) != 100:
        raise HTTPException(status_code=503, detail="Таблица шансов казино повреждена")
    ticket = SYSTEM_RANDOM.randrange(1, 101)
    current = 0
    for index, chance in enumerate(chances):
        current += chance
        if ticket <= current:
            return percents[index], index
    raise HTTPException(status_code=503, detail="Не удалось выбрать исход раунда")


def _weighted_basis_points(table: tuple[tuple[int, int], ...]) -> tuple[int, int]:
    """Return (value, index) from an exact 10,000-basis-point table."""
    if sum(weight for _, weight in table) != 10_000:
        raise HTTPException(status_code=503, detail="Таблица шансов казино повреждена")
    ticket = SYSTEM_RANDOM.randrange(1, 10_001)
    current = 0
    for index, (value, weight) in enumerate(table):
        current += weight
        if ticket <= current:
            return value, index
    raise HTTPException(status_code=503, detail="Не удалось выбрать исход раунда")


def _rocket_crash_point() -> float:
    """Draw the crash point. Round only the multiplier shown and paid."""
    roll = SYSTEM_RANDOM.random()
    rtp = CASINO_RTP_PERCENT / 100
    if roll >= rtp:
        return ROCKET_MIN_MULTIPLIER
    if roll <= rtp / ROCKET_MAX_MULTIPLIER:
        return ROCKET_MAX_MULTIPLIER
    return rtp / roll


def _new_rocket_outcome() -> dict:
    return {"crash_at": _rocket_crash_point(), "auto_cashout_at_cap": True}


def _grant_failure_fragment(db: Session, user: models.User, bet: int, payout: int) -> tuple[int, int]:
    """Grant one fragment for a meaningful loss, inside the round transaction."""
    if not FAILURE_FRAGMENTS_ENABLED or bet < FAILURE_FRAGMENT_MIN_BET or payout * 2 > bet:
        return 0, 0
    fragment = db.query(models.Item).filter(models.Item.code == "failure_fragment").one_or_none()
    if fragment is None:
        # A missing optional reward must never prevent settlement of the
        # player's already-paid casino round.
        return 0, 0
    stack = db.query(models.InventoryItem).filter(
        models.InventoryItem.user_id == user.id,
        models.InventoryItem.item_id == fragment.id,
    ).one_or_none()
    if stack is None:
        stack = models.InventoryItem(user_id=user.id, item_id=fragment.id, quantity=1)
        db.add(stack)
    else:
        if stack.quantity >= 2_000_000_000:
            raise HTTPException(409, "Достигнут максимальный размер стака")
        stack.quantity += 1
    db.flush()
    return 1, stack.quantity


def _rocket_progress(row: models.CasinoRound, now: datetime | None = None) -> dict:
    """Return server-authoritative progress without revealing a future crash."""
    try:
        outcome = json.loads(row.outcome)
        crash_at = float(outcome["crash_at"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=409, detail="Состояние раунда повреждено") from exc
    if not math.isfinite(crash_at) or not 1.0 <= crash_at <= ROCKET_MAX_MULTIPLIER:
        raise HTTPException(status_code=409, detail="Состояние раунда повреждено")

    current_time = now or models.now_utc()
    elapsed_seconds = max(0.0, (current_time - row.created_at).total_seconds())
    current_multiplier = min(
        ROCKET_MAX_MULTIPLIER,
        1.0 + elapsed_seconds * ROCKET_GROWTH_PER_SECOND,
    )
    capped = (
        outcome.get("auto_cashout_at_cap") is True
        and crash_at == ROCKET_MAX_MULTIPLIER
        and current_multiplier == ROCKET_MAX_MULTIPLIER
    )
    crashed = current_multiplier >= crash_at and not capped
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
        "capped": capped,
        # The crash point becomes public only after the server clock reaches it.
        "crash_multiplier": crash_at if crashed else None,
    }


def _active_vault_round(
    db: Session, user_id: int, *, lock: bool = False, token: str | None = None,
) -> models.CasinoRound | None:
    query = (
        db.query(models.CasinoRound)
        .filter(
            models.CasinoRound.user_id == user_id,
            models.CasinoRound.game == "vault",
            models.CasinoRound.settled.is_(False),
        )
        .order_by(models.CasinoRound.created_at.desc())
    )
    if token is not None:
        query = query.filter(models.CasinoRound.token == token)
    if lock:
        query = query.with_for_update()
    return query.first()


def _vault_round_response(row: models.CasinoRound) -> dict:
    outcome = json.loads(row.outcome)
    return {
        "game": "vault",
        "token": row.token,
        "amount": row.bet,
        "outcome": {"choice": outcome["choice"], "offer": outcome["offer"]},
    }


@router.get("/casino/wallet")
def casino_wallet_status(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return casino_wallet.snapshot(user, db.get(models.CasinoWallet, user.id))


@router.post("/casino/wallet/transfer")
def casino_wallet_transfer(
    body: schemas.CasinoTransferRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    account = casino_wallet.lock_account(db, user)
    return casino_wallet.transfer(db, user, account, body)


@router.post("/casino/slots/bonus")
def casino_slots_bonus(
    claim: bool = Body(False, embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not claim:
        raise HTTPException(status_code=400, detail="Нажмите «Забрать», чтобы получить бонус")
    begin_game_write(db)
    account = casino_wallet.lock_account(db, user)
    awarded = not account.bonus_claimed
    if awarded:
        if account.bonus > casino_wallet.LIMIT - casino_wallet.BONUS_AMOUNT:
            raise HTTPException(status_code=409, detail="Достигнут максимальный баланс бонусов")
        account.bonus += casino_wallet.BONUS_AMOUNT
        account.bonus_claimed = True
        db.commit()
    return {"awarded": awarded, "wallet": casino_wallet.snapshot(user, account)}


def _record_casino_funding(db: Session, row: models.CasinoRound, cash_used: int, bonus_used: int = 0):
    db.add(row)
    db.flush()
    db.add(models.CasinoFunding(token=row.token, cash_before=row.balance_before,
                                cash_used=cash_used, bonus_used=bonus_used))
    db.flush()


def _paid_spin(db: Session, user: models.User, account: models.CasinoWallet, *,
               game: str, amount: int, request_id: str) -> dict:
    token = hashlib.sha256(f"casino:ledger:{game}:{user.id}:{request_id}".encode()).hexdigest()
    row = db.query(models.CasinoRound).filter_by(token=token, user_id=user.id, game=game).first()
    if row is None and game == "roulette_v2":
        # Reloading a cached client can replay an already-paid pre-ledger spin.
        row = db.query(models.CasinoRound).filter_by(token=request_id, user_id=user.id, game=game).first()
    replayed = row is not None
    if replayed:
        if row.bet != amount:
            raise HTTPException(409, "Этот раунд уже проведён с другой ставкой")
        outcome = json.loads(row.outcome)
        payout = row.payout
        awarded = 0
        count = 0
    else:
        cash_before = account.cash
        cash_used, bonus_used = casino_wallet.spend(account, amount, use_bonus=game == "slots")
        if game == "slots":
            outcome = casino_slots.spin(SYSTEM_RANDOM)
            payout = amount * outcome["payout_percent"] // 100
        else:
            payout, index = _weighted_basis_points(ROULETTE_PAYOUTS)
            outcome = {"index": index, "payout_percent": payout}
        casino_wallet.credit(account, payout)
        row = models.CasinoRound(
            token=token, user_id=user.id, game=game, bet=amount, balance_before=cash_before,
            payout=payout, outcome=json.dumps(outcome), settled=True,
        )
        _record_casino_funding(db, row, cash_used, bonus_used)
        awarded, count = _grant_failure_fragment(db, user, amount, payout)
        db.commit()
    return {
        **outcome, "ok": True, "payout": payout, "wallet": casino_wallet.snapshot(user, account),
        "replayed": replayed, "failure_fragment_awarded": awarded, "failure_fragment_count": count,
    }


@router.post("/casino/slots/spin")
def casino_slots_spin(
    body: schemas.CasinoSlotSpinRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    account = casino_wallet.lock_account(db, user)
    return _paid_spin(db, user, account, game="slots", amount=body.amount, request_id=body.request_id)


@router.get("/casino/vault/active")
def casino_vault_active(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = _active_vault_round(db, user.id)
    return {"round": _vault_round_response(row) if row else None}


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
    if type(payload.get("ledger")) is not int or payload["ledger"] != 1:
        raise HTTPException(409, "Откройте мини-приложение заново, чтобы загрузить кошелёк казино")
    if game not in CASINO_GAMES or amount < CASINO_MIN_BET or amount > CASINO_MAX_BET:
        raise HTTPException(status_code=400, detail="Некорректный раунд")
    if game == "vault" and choice not in {"1", "2", "3", "4"}:
        raise HTTPException(status_code=400, detail="Выберите один из четырёх сейфов")
    begin_game_write(db)
    account = casino_wallet.lock_account(db, user)
    if game == "vault":
        existing = _active_vault_round(db, user.id)
        if existing:
            return {**_vault_round_response(existing), "wallet": casino_wallet.snapshot(user, account)}
    cash_before = account.cash
    cash_used, bonus_used = casino_wallet.spend(account, amount)
    outcome: dict = {}
    payout = 0
    if game == "riskwheel":
        payout_percent, index = _weighted_percent(RISKWHEEL_PAYOUTS)
        payout = amount * payout_percent // 100
        outcome = {"payout_percent": payout_percent, "index": index}
    elif game == "dice":
        allowed = {"odd", "even", "low", "high", "1", "2", "3", "4", "5", "6"}
        if choice not in allowed:
            raise HTTPException(status_code=400, detail="Некорректный выбор")
        roll = SYSTEM_RANDOM.randint(1, 6)
        won = ((choice == "odd" and roll % 2 == 1) or (choice == "even" and roll % 2 == 0)
               or (choice == "low" and roll <= 3) or (choice == "high" and roll >= 4) or choice == str(roll))
        payout_percent = DICE_EXACT_PAYOUT_PERCENT if choice.isdigit() else DICE_EVEN_PAYOUT_PERCENT
        payout = amount * payout_percent // 100 if won else 0
        outcome = {"roll": roll, "choice": choice, "payout_percent": payout_percent if won else 0}
    elif game == "vault":
        offers = list(VAULT_PAYOUTS)
        SYSTEM_RANDOM.shuffle(offers)
        payout = amount * offers[int(choice) - 1] // 100
        outcome = {"choice": choice, "offer": payout, "winning_key": SYSTEM_RANDOM.choice(VAULT_KEYS)}
    else:
        outcome = _new_rocket_outcome()

    token = secrets.token_urlsafe(32)
    round_row = models.CasinoRound(
        token=token, user_id=user.id, game=game, bet=amount,
        balance_before=cash_before, outcome=json.dumps(outcome), payout=payout,
    )
    _record_casino_funding(db, round_row, cash_used, bonus_used)
    db.commit()
    wallet = casino_wallet.snapshot(user, account)
    if game == "vault":
        return {**_vault_round_response(round_row), "wallet": wallet}

    public_outcome = outcome
    if game == "rocket":
        # Never disclose the pre-generated crash point while a cashout is still
        # possible. The client needs only the public growth parameters to draw
        # the animation; the server clock remains authoritative.
        public_outcome = {
            "growth_per_second": ROCKET_GROWTH_PER_SECOND,
            "max_multiplier": ROCKET_MAX_MULTIPLIER,
        }
    return {"token": token, "outcome": public_outcome, "wallet": wallet}


@router.post("/roulette/spin")
def roulette_spin(
    body: schemas.RouletteSpinRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if body.ledger != 1:
        raise HTTPException(409, "Откройте мини-приложение заново, чтобы загрузить кошелёк казино")
    begin_game_write(db)
    account = casino_wallet.lock_account(db, user)
    return _paid_spin(db, user, account, game="roulette_v2", amount=body.amount, request_id=body.request_id)


@router.get("/casino/rocket/status")
def rocket_status(
    token: str = Query(..., min_length=8, max_length=128),
    cap_aware: bool = Query(False),
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
    # Older clients use the crash flag as their only signal to settle.
    legacy_stop = progress["capped"] and not cap_aware
    return {
        "crashed": progress["crashed"] or legacy_stop,
        "capped": progress["capped"],
        "current_multiplier": progress["current_multiplier"],
        "crash_multiplier": ROCKET_MAX_MULTIPLIER if legacy_stop else progress["crash_multiplier"],
    }


@router.post("/casino/settle")
def casino_settle(
    token: str = Body(..., embed=True),
    multiplier: float | None = Body(None, embed=True),
    vault_key: str | None = Body(None, embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    row = db.query(models.CasinoRound).filter(
        models.CasinoRound.token == token, models.CasinoRound.user_id == user.id,
    ).with_for_update().first()
    if not row or row.settled:
        raise HTTPException(status_code=409, detail="Раунд уже завершён или не найден")
    return _settle_casino_round(db, user, row, multiplier=multiplier, vault_key=vault_key)


@router.post("/casino/vault/collect")
def casino_collect_vault(
    token: str | None = Body(None, embed=True),
    vault_key: str | None = Body(None, embed=True),
    resume: bool = Body(False, embed=True),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    begin_game_write(db)
    row = _active_vault_round(db, user.id, lock=True, token=None if resume else token)
    if row is None:
        return {"ok": True, "payout": 0,
                "wallet": casino_wallet.snapshot(user, db.get(models.CasinoWallet, user.id))}
    return _settle_casino_round(db, user, row, vault_key=vault_key if token == row.token else None)


def _settle_casino_round(
    db: Session, user: models.User, row: models.CasinoRound, *,
    multiplier: float | None = None, vault_key: str | None = None,
):
    if vault_key is not None and (row.game != "vault" or vault_key not in VAULT_KEYS):
        raise HTTPException(status_code=400, detail="Недопустимый ключ сейфа")
    payout = row.payout
    vault_key_won = None
    if row.game == "vault" and vault_key is not None:
        vault_key_won = vault_key == json.loads(row.outcome)["winning_key"]
        payout = 2 * payout if vault_key_won else 0

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
    funding = db.get(models.CasinoFunding, row.token)
    account = casino_wallet.lock_account(db, user) if funding else None
    row.settled = True
    row.payout = payout
    if account:
        casino_wallet.credit(account, payout)
    elif payout:
        # Old rounds were paid from the main wallet. Return their original
        # award to that wallet so the migration cannot strand pending payouts.
        wallet = ensure_wallet(db, user)
        if wallet.balance < 0 or wallet.balance > casino_wallet.LIMIT - payout:
            raise HTTPException(status_code=409, detail="Достигнут максимальный баланс ковбаксов")
        wallet.balance += payout
        db.add(models.Transaction(recipient_id=user.id, amount=payout, note=f"casino:win:{row.game}"))
    awarded_fragment, fragment_count = _grant_failure_fragment(db, user, row.bet, payout)
    db.flush()
    db.commit()
    response = {
        "ok": True,
        "payout": payout,
        "wallet": casino_wallet.snapshot(user, account or db.get(models.CasinoWallet, user.id)),
        "failure_fragment_awarded": awarded_fragment,
        "failure_fragment_count": fragment_count,
    }
    if not account:
        response["balance"] = response["wallet"]["main_balance"]
    if vault_key_won is not None:
        response["vault_key_won"] = vault_key_won
    if rocket_result is not None:
        response.update({
            "crashed": rocket_result["crashed"],
            "capped": rocket_result["capped"],
            "multiplier": rocket_result["current_multiplier"],
            "crash_multiplier": rocket_result["crash_multiplier"],
        })
    return response

# ============ CLICKER ============
CLICKER_MAX_LEVEL = 20
CLICKER_CRIT_MULT = 2
CLICKER_TAP_ENERGY_COST = 1
CLICKER_MAX_PASSIVE_HOURS = 4
CLICKER_PASSIVE_CAP_SHARE = 0.10
CLICKER_PROGRESSION_MAX_DAY = 7
CLICKER_PROGRESSION_MIN_EARNED = 0.80

# Внутриигровая валюта — «ковкойны». Тапаешь → копишь ковкойны → выводишь в ковбаксы.
CLICKER_START_KOVCOINS = 1        # стартовый баланс ковкойнов (сразу можно кликать)
CLICKER_CASHOUT_RATE = 100
CLICKER_CASHOUT_MIN = 100
CLICKER_CASHOUT_KOVBUCKS = 1

# --- Дневной лимит заработка ---
# Seven active days: 150–350 K from Clicker. Together with the daily streak,
# daily wheel and all validated arcade wins this stays in the 1,000–1,500 K
# target range instead of becoming an unlimited faucet.
# Активный и пассивный доход расходуют один общий серверный лимит.
CLICKER_DAILY_CAPS = (15_000, 18_000, 22_000, 26_000, 30_000, 33_000, 35_000)

# --- Активные бусты (бесплатные, с дневным лимитом) ---
CLICKER_TURBO_SECONDS = 30
CLICKER_TURBO_MULT = 2
CLICKER_TURBO_DAILY = 1

CLICKER_REFILL_DAILY = 2

CLICKER_PASSBOOST_SECONDS = 3600
CLICKER_PASSBOOST_MULT = 2
CLICKER_PASSBOOST_DAILY = 1

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

# --- Анти-фрод: серверный token bucket и временная блокировка за flood. ---
CLICKER_MAX_CPS = 6
CLICKER_TOKEN_BURST = 12
CLICKER_LOCK_SECONDS = (30, 60, 300)

# Ранги по суммарному заработку
CLICKER_RANKS = [
    (0, "Юнга"),
    (25_000, "Матрос"),
    (100_000, "Боцман"),
    (300_000, "Штурман"),
    (1_000_000, "Капитан"),
    (3_000_000, "Адмирал"),
    (10_000_000, "Легенда Ковчега"),
]

# Стоимость апгрейдов — в ковкойнах (реинвест заработка). Прокачка растянута на дни/недели.
CLICKER_UPGRADES = {
    "click":   {"base_cost": 1_500, "mult": 1.24, "name": "Сила клика"},
    "passive": {"base_cost": 1_800, "mult": 1.24, "name": "Пассивный доход"},
    "energy":  {"base_cost": 1_200, "mult": 1.22, "name": "Запас энергии"},
    "crit":    {"base_cost": 2_000, "mult": 1.25, "name": "Критический клик"},
    "regen":   {"base_cost": 1_400, "mult": 1.23, "name": "Восстановление"},
}


def _clicker_click_power(state):
    return 2.0 + state.lvl_click * 0.30         # 2.0 → 8.0


def _clicker_max_energy(state):
    return 1_200 + state.lvl_energy * 80          # 1200 → 2800


def _clicker_regen_rate(state):
    return 2.0 + state.lvl_regen * 0.20           # 2.0 → 6.0 /сек


def _clicker_crit_chance(state):
    return min(state.lvl_crit * 0.6, 12) / 100.0  # 0 → 12%


def _clicker_passive_per_min(state):
    return 0.5 + state.lvl_passive * 0.35         # 0.5 → 7.5 /мин


def _clicker_upgrade_cost(key, current_level):
    cfg = CLICKER_UPGRADES[key]
    return int(cfg["base_cost"] * (cfg["mult"] ** current_level))


def _clicker_daily_cap(state):
    """Predictable seven-day cap independent from purchases made mid-day."""
    day = max(1, min(CLICKER_PROGRESSION_MAX_DAY, int(state.progression_day or 1)))
    return CLICKER_DAILY_CAPS[day - 1]


def _clicker_next_daily_cap(state):
    day = max(1, min(CLICKER_PROGRESSION_MAX_DAY, int(state.progression_day or 1)))
    return CLICKER_DAILY_CAPS[min(day, len(CLICKER_DAILY_CAPS) - 1)]


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


def _clicker_msk_key(now):
    return now.replace(tzinfo=timezone.utc).astimezone(MSK).strftime("%Y-%m-%d")


def _clicker_msk_midnight_utc(now):
    local = now.replace(tzinfo=timezone.utc).astimezone(MSK)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(timezone.utc).replace(tzinfo=None)


def _prepare_clicker_day(state, now):
    """Reset daily ledgers at Moscow midnight and advance at most one stage.

    A stage is earned only by playing on consecutive calendar days and filling
    at least 80% of the previous cap. Device time never participates.
    """
    key = _clicker_msk_key(now)
    if not state.progression_day or state.progression_day < 1:
        state.progression_day = 1

    previous_key = state.progression_date or ""
    if previous_key != key:
        consecutive = False
        if previous_key:
            try:
                previous_date = datetime.strptime(previous_key, "%Y-%m-%d").date()
                current_date = datetime.strptime(key, "%Y-%m-%d").date()
                consecutive = (current_date - previous_date).days == 1
            except ValueError:
                consecutive = False
        previous_cap = _clicker_daily_cap(state)
        if (
            consecutive
            and (state.earned_today or 0) >= math.ceil(previous_cap * CLICKER_PROGRESSION_MIN_EARNED)
        ):
            state.progression_day = min(CLICKER_PROGRESSION_MAX_DAY, state.progression_day + 1)
        state.progression_date = key
        state.earned_today = 0
        state.passive_earned_today = 0
        state.passive_fraction = 0.0

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
        now = models.now_utc()
        state = models.ClickerState(
            user_id=user.id,
            kovcoins=CLICKER_START_KOVCOINS,
            energy=1_200.0,
            tap_tokens=float(CLICKER_TOKEN_BURST),
            progression_day=1,
            progression_date=_clicker_msk_key(now),
            boost_date=_clicker_msk_key(now),
            last_sync=now,
        )
        db.add(state)
        db.flush()
    return state


def _sync_clicker(db, state, user):
    """Regenerate resources and credit bounded passive income server-side."""
    now = models.now_utc()
    _prepare_clicker_day(state, now)
    if state.locked_until and state.locked_until <= now:
        state.locked_until = None
        state.suspicion = max(0, int(state.suspicion or 0) - 1)

    last_sync = state.last_sync or now
    elapsed = (now - last_sync).total_seconds()
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

    # Never attribute yesterday's offline interval to the new Moscow day.
    passive_start = max(last_sync, _clicker_msk_midnight_utc(now))
    passive_elapsed = min(max(0.0, (now - passive_start).total_seconds()), CLICKER_MAX_PASSIVE_HOURS * 3600)
    passive_rate = _clicker_passive_per_min(state) / 60.0
    earned = passive_rate * passive_elapsed
    if state.passive_boost_until:
        window_start = now - timedelta(seconds=passive_elapsed)
        b_end = min(now, state.passive_boost_until)
        b_start = max(window_start, passive_start)
        overlap = (b_end - b_start).total_seconds()
        if overlap > 0:
            earned += passive_rate * (CLICKER_PASSBOOST_MULT - 1) * overlap

    state.last_sync = now
    raw = max(0.0, earned + float(state.passive_fraction or 0.0))
    whole = int(raw)
    state.passive_fraction = raw - whole
    passive_cap = int(_clicker_daily_cap(state) * CLICKER_PASSIVE_CAP_SHARE)
    passive_room = max(0, passive_cap - int(state.passive_earned_today or 0))
    credited = _clicker_credit(state, min(whole, passive_room))
    state.passive_earned_today = int(state.passive_earned_today or 0) + credited
    if passive_room <= credited or (state.earned_today or 0) >= _clicker_daily_cap(state):
        state.passive_fraction = 0.0
    return credited


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
    cap = _clicker_daily_cap(state)
    earned_today = state.earned_today or 0
    passive_cap = int(cap * CLICKER_PASSIVE_CAP_SHARE)

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
        "cashout_kovbucks": CLICKER_CASHOUT_KOVBUCKS,
        # Дневной лимит
        "progression_day": max(1, int(state.progression_day or 1)),
        "daily_cap": cap,
        "next_daily_cap": _clicker_next_daily_cap(state),
        "progression_required": math.ceil(cap * CLICKER_PROGRESSION_MIN_EARNED),
        "earned_today": earned_today,
        "cap_left": max(0, cap - earned_today),
        "cap_reached": earned_today >= cap,
        "passive_earned_today": state.passive_earned_today or 0,
        "passive_daily_cap": passive_cap,
        "total_earned": state.total_earned or 0,
        "level": lvl,
        "rank": rank,
        "level_floor": cur_floor,
        "level_next": next_floor,
        "locked": locked,
        "locked_left": max(0, math.ceil((state.locked_until - now).total_seconds())) if locked else 0,
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
    """Credit a bounded tap batch and lock repeated machine-speed floods."""
    if taps <= 0 or taps > 200:
        raise HTTPException(status_code=400, detail="Некорректное количество тапов")

    _require_clicker_access(user)
    begin_game_write(db)
    state = _get_or_create_clicker_state(db, user)
    _sync_clicker(db, state, user)
    now = models.now_utc()

    def _tap_result(coins, actual, rejected, crits, turbo, mult, cap_reached):
        locked = _boost_active(state.locked_until, now)
        return {
            "coins_earned": coins,
            "taps_processed": actual,
            "rejected_taps": rejected,
            "crits": crits,
            "energy": round(state.energy, 1),
            "max_energy": _clicker_max_energy(state),
            "kovcoins": state.kovcoins or 0,
            "balance": state.kovcoins or 0,
            "turbo": turbo,
            "mult": mult,
            "locked": locked,
            "locked_left": max(0, math.ceil((state.locked_until - now).total_seconds())) if locked else 0,
            "total_earned": state.total_earned or 0,
            "daily_cap": _clicker_daily_cap(state),
            "earned_today": state.earned_today or 0,
            "cap_left": max(0, _clicker_daily_cap(state) - (state.earned_today or 0)),
            "cap_reached": cap_reached,
        }

    # Дневной лимит достигнут — не тратим энергию, просто сообщаем
    if (state.earned_today or 0) >= _clicker_daily_cap(state):
        db.commit()
        return _tap_result(0, 0, taps, 0, _boost_active(state.turbo_until, now), 1, True)

    # A lock never consumes energy and never grants currency. It is deliberately
    # a temporary gameplay throttle, not an account ban.
    if _boost_active(state.locked_until, now):
        db.commit()
        return _tap_result(0, 0, taps, 0, _boost_active(state.turbo_until, now), 1, False)

    turbo = _boost_active(state.turbo_until, now)
    tokens = int(state.tap_tokens or 0)
    speed_excess = max(0, taps - tokens)
    flood = taps > CLICKER_TOKEN_BURST * 2 or speed_excess >= CLICKER_TOKEN_BURST
    if flood:
        state.suspicion = int(state.suspicion or 0) + 3
    elif speed_excess:
        state.suspicion = int(state.suspicion or 0) + (2 if speed_excess >= 4 else 1)
    else:
        state.suspicion = max(0, int(state.suspicion or 0) - 1)

    should_lock = flood or int(state.suspicion or 0) >= 3
    if should_lock:
        suspicion = int(state.suspicion or 0)
        lock_seconds = CLICKER_LOCK_SECONDS[0 if suspicion < 5 else 1 if suspicion < 8 else 2]
        state.locked_until = now + timedelta(seconds=lock_seconds)
        state.tap_tokens = 0.0
        db.commit()
        return _tap_result(0, 0, taps, 0, turbo, CLICKER_TURBO_MULT if turbo else 1, False)

    # In turbo energy is not consumed, but the same server-side speed ceiling applies.
    energy_limit = taps if turbo else int(state.energy / CLICKER_TAP_ENERGY_COST)
    actual = max(0, min(taps, tokens, energy_limit))
    rejected = taps - actual

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

    raw_coins = max(0.0, coins_f + float(state.tap_fraction or 0.0))
    whole_coins = int(raw_coins)
    state.tap_fraction = raw_coins - whole_coins
    coins = _clicker_credit(state, whole_coins)
    cap_reached = (state.earned_today or 0) >= _clicker_daily_cap(state)
    if coins < whole_coins or cap_reached:
        state.tap_fraction = 0.0
    db.commit()

    return _tap_result(coins, actual, rejected, crits, turbo, mult, cap_reached)


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

    if _boost_active(state.locked_until, now):
        raise HTTPException(status_code=429, detail="Сначала дождитесь окончания блокировки кликов")
    if (state.earned_today or 0) >= _clicker_daily_cap(state):
        raise HTTPException(status_code=400, detail="Дневной лимит уже достигнут")

    used_attr = CLICKER_BOOST_USED_ATTR[boost]
    used = getattr(state, used_attr) or 0
    if used >= CLICKER_BOOST_DAILY[boost]:
        raise HTTPException(status_code=400, detail="Лимит буста на сегодня исчерпан")

    if boost == "turbo":
        if _boost_active(state.turbo_until, now):
            raise HTTPException(status_code=400, detail="Турбо уже активно")
        state.turbo_until = now + timedelta(seconds=CLICKER_TURBO_SECONDS)
    elif boost == "refill":
        if state.energy >= _clicker_max_energy(state) - 1:
            raise HTTPException(status_code=400, detail="Энергия уже полная")
        state.energy = float(_clicker_max_energy(state))
    elif boost == "passive":
        if _boost_active(state.passive_boost_until, now):
            raise HTTPException(status_code=400, detail="Ускорение пассива уже активно")
        passive_cap = int(_clicker_daily_cap(state) * CLICKER_PASSIVE_CAP_SHARE)
        if (state.passive_earned_today or 0) >= passive_cap:
            raise HTTPException(status_code=400, detail="Лимит пассивного дохода уже достигнут")
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
    """Вывод ковкойнов в ковбаксы по серверному курсу. amount — сколько ковкойнов вывести
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

    kovbaks = (spend // CLICKER_CASHOUT_RATE) * CLICKER_CASHOUT_KOVBUCKS
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
