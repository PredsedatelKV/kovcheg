from __future__ import annotations

import json
import math
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import StrictInt
from sqlalchemy.orm import Session

from app import models, schemas
from app.access import can_use_clicker
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


CASINO_GAMES = {"riskwheel", "slots", "dice", "rocket"}

# Целевая отдача казино. Каждая таблица ниже даёт РОВНО этот процент, поэтому
# ожидание казино положительно на любой дистанции и не зависит от того, какую
# игру и какую стратегию выбирает игрок.
CASINO_RTP_PERCENT = 90

# Лимит раундов: три игры в час на КАЖДУЮ игру отдельно.
CASINO_ROUNDS_PER_WINDOW = 3
CASINO_WINDOW = timedelta(hours=1)

# Все выплаты хранятся в процентах от ставки (целые числа), а не во float:
# payout = ставка * процент // 100 считается точно и не даёт копеечных
# расхождений между показанным множителем и реально зачисленной суммой.

# Колесо риска: 9 секторов, шансы в процентах, сумма шансов = 100.
# sum(процент выплаты * шанс) = 9000 => RTP ровно 90%.
RISKWHEEL_PAYOUTS = ((5, 15), (25, 13), (50, 15), (75, 16), (100, 15),
                     (150, 11), (200, 8), (250, 4), (300, 3))

# Рулетка: 11 секторов, та же схема, максимум x1.8.
ROULETTE_PAYOUTS = ((10, 8), (30, 8), (50, 10), (70, 12), (80, 2), (90, 14),
                    (100, 14), (120, 12), (140, 10), (160, 6), (180, 4))

# Слоты: выплата зависит от комбинации, а вероятности задаются напрямую,
# а не выводятся из случайных барабанов. Раньше барабаны крутились независимо
# по 7 символам, что давало 95.9% и джекпот x29; теперь исход выбирается по
# таблице, а барабаны лишь показывают уже выбранный результат.
SLOTS_OUTCOMES = (
    ("jackpot", 1000, 2),   # три одинаковых премиальных: x10
    ("triple", 500, 4),     # три одинаковых обычных: x5
    ("pair_high", 200, 14),  # две премиальные: x2
    ("pair", 100, 22),      # две одинаковых: возврат ставки
    ("miss", 0, 58),
)
SLOTS_PREMIUM_SYMBOLS = ("7\ufe0f\u20e3", "\U0001f48e")
SLOTS_COMMON_SYMBOLS = ("\U0001f352", "\U0001f34b", "\U0001f34a", "\U0001f347", "\u2b50")

# Кубик: выплата подобрана так, чтобы RTP каждой ставки был ровно 90%.
# Точное число: 1/6 * 540% = 90%. Чёт/нечет/больше/меньше: 1/2 * 180% = 90%.
DICE_EXACT_PAYOUT_PERCENT = 540
DICE_EVEN_PAYOUT_PERCENT = 180

# Ракетка: шанс дожить до множителя t равен 0.90 / t, поэтому ожидание выплаты
# t * 0.90/t = 90% при ЛЮБОЙ точке выхода. Прошлая версия брала экспоненту без
# привязки к множителю, и выход на x1.05 давал игроку 105% — казино уходило
# в минус тем вернее, чем аккуратнее играл игрок.
ROCKET_GROWTH_PER_SECOND = 0.25
ROCKET_MAX_MULTIPLIER = 5.0
ROCKET_MIN_MULTIPLIER = 1.0


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


def _rocket_crash_point() -> float:
    """Точка срыва с P(дожить до t) = RTP/t — отдача 90% на любой стратегии."""
    roll = SYSTEM_RANDOM.randrange(1, 10_001) / 10_000
    if roll >= CASINO_RTP_PERCENT / 100:
        # Мгновенный проигрыш необходим в 10% раундов. При минимуме x1.01
        # моментальный вывод на x1.00 всегда возвращал ставку и давал RTP 100%.
        return ROCKET_MIN_MULTIPLIER
    crash_at = (CASINO_RTP_PERCENT / 100) / roll
    return round(min(ROCKET_MAX_MULTIPLIER, max(ROCKET_MIN_MULTIPLIER, crash_at)), 2)


def _casino_round_games(game: str) -> tuple[str, ...]:
    """Имена раундов одной игры. Рулетка пишется как roulette_v2 с прошлой версии."""
    return ("roulette", "roulette_v2") if game == "roulette" else (game,)


def _format_wait(seconds: int) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours} ч {minutes} мин"
    if hours:
        return f"{hours} ч"
    return f"{minutes} мин"


def _require_casino_limit(db: Session, user_id: int, game: str) -> None:
    """Не больше трёх раундов в час, лимит считается для каждой игры отдельно.

    Окно скользящее: когда самый старый из трёх раундов выходит за час,
    освобождается ровно один слот, а не все три сразу.
    """
    window_start = models.now_utc() - CASINO_WINDOW
    recent = (
        db.query(models.CasinoRound)
        .filter(
            models.CasinoRound.user_id == user_id,
            models.CasinoRound.game.in_(_casino_round_games(game)),
            models.CasinoRound.created_at > window_start,
        )
        .order_by(models.CasinoRound.created_at.desc(), models.CasinoRound.id.desc())
        .limit(CASINO_ROUNDS_PER_WINDOW)
        .all()
    )
    if len(recent) < CASINO_ROUNDS_PER_WINDOW:
        return
    frees_at = recent[-1].created_at + CASINO_WINDOW
    remaining_seconds = max(1, math.ceil((frees_at - models.now_utc()).total_seconds()))
    raise HTTPException(
        status_code=429,
        detail=(
            f"Лимит {CASINO_ROUNDS_PER_WINDOW} игр в час исчерпан. "
            f"Следующая игра через {_format_wait(remaining_seconds)}"
        ),
        headers={"Retry-After": str(remaining_seconds)},
    )


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


def _slots_reels(combo: str) -> list[str]:
    """Барабаны, показывающие уже выбранный исход.

    Исход берётся из таблицы вероятностей, а барабаны только иллюстрируют его,
    иначе независимые барабаны задавали бы свой собственный RTP.
    """
    premium = list(SLOTS_PREMIUM_SYMBOLS)
    common = list(SLOTS_COMMON_SYMBOLS)
    if combo == "jackpot":
        symbol = SYSTEM_RANDOM.choice(premium)
        return [symbol, symbol, symbol]
    if combo == "triple":
        symbol = SYSTEM_RANDOM.choice(common)
        return [symbol, symbol, symbol]
    if combo in {"pair_high", "pair"}:
        pool = premium if combo == "pair_high" else common
        pair_symbol = SYSTEM_RANDOM.choice(pool)
        others = [s for s in premium + common if s != pair_symbol]
        reels = [pair_symbol, pair_symbol, SYSTEM_RANDOM.choice(others)]
        SYSTEM_RANDOM.shuffle(reels)
        return reels
    # Промах: три разных символа.
    return SYSTEM_RANDOM.sample(premium + common, 3)


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
    _require_casino_limit(db, user.id, game)
    wallet = ensure_wallet(db, user)
    if wallet.balance < amount:
        raise HTTPException(status_code=400, detail="Недостаточно Ковбаксов")
    outcome: dict = {}
    payout = 0
    if game == "riskwheel":
        payout_percent, index = _weighted_percent(RISKWHEEL_PAYOUTS)
        payout = amount * payout_percent // 100
        outcome = {"payout_percent": payout_percent, "index": index}
    elif game == "slots":
        payout_percent, index = _weighted_percent(
            tuple((percent, chance) for _, percent, chance in SLOTS_OUTCOMES)
        )
        combo = SLOTS_OUTCOMES[index][0]
        payout = amount * payout_percent // 100
        outcome = {"reels": _slots_reels(combo), "payout_percent": payout_percent, "combo": combo}
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
    else:
        outcome = {"crash_at": _rocket_crash_point()}

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


@router.post("/roulette/spin")
def roulette_spin(
    body: schemas.RouletteSpinRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Atomic, server-authoritative roulette with an exact 90% RTP table."""
    begin_game_write(db)
    existing = db.query(models.CasinoRound).filter(
        models.CasinoRound.user_id == user.id,
        models.CasinoRound.game == "roulette_v2",
        models.CasinoRound.token == body.request_id,
    ).first()
    if existing:
        if existing.bet != body.amount:
            raise HTTPException(409, "Этот запрос уже использован для другой ставки")
        outcome = json.loads(existing.outcome)
        fragment_item = db.query(models.Item).filter(models.Item.code == "failure_fragment").first()
        fragment_count = 0
        if fragment_item:
            row = db.query(models.InventoryItem).filter(
                models.InventoryItem.user_id == user.id,
                models.InventoryItem.item_id == fragment_item.id,
            ).first()
            fragment_count = row.quantity if row else 0
        db.rollback()
        return {
            "ok": True, "replayed": True, "payout": existing.payout,
            "payout_percent": outcome["payout_percent"], "index": outcome["index"],
            "balance": ensure_wallet(db, user).balance,
            "failure_fragment_awarded": outcome.get("failure_fragment_awarded", 0),
            "failure_fragment_count": fragment_count,
        }

    _require_casino_limit(db, user.id, "roulette")
    wallet = ensure_wallet(db, user)
    if body.amount < 10:
        raise HTTPException(400, "Минимальная ставка — 10 ковбаксов")
    if wallet.balance < body.amount:
        raise HTTPException(400, "Недостаточно ковбаксов")

    payout_percent, index = _weighted_percent(ROULETTE_PAYOUTS)
    payout = body.amount * payout_percent // 100
    awarded_fragment = 1 if payout_percent <= 50 else 0
    fragment_count = 0
    if awarded_fragment:
        fragment_item = db.query(models.Item).filter(models.Item.code == "failure_fragment").first()
        if fragment_item is None:
            raise HTTPException(503, "Фрагмент неудачи временно недоступен")
        stack = db.query(models.InventoryItem).filter(
            models.InventoryItem.user_id == user.id,
            models.InventoryItem.item_id == fragment_item.id,
        ).first()
        if stack:
            if stack.quantity >= 2_000_000_000:
                raise HTTPException(409, "Достигнут максимальный размер стака")
            stack.quantity += 1
        else:
            stack = models.InventoryItem(user_id=user.id, item_id=fragment_item.id, quantity=1)
            db.add(stack)
        fragment_count = stack.quantity

    wallet.balance = wallet.balance - body.amount + payout
    outcome = {
        "payout_percent": payout_percent,
        "index": index,
        "failure_fragment_awarded": awarded_fragment,
    }
    db.add(models.CasinoRound(
        token=body.request_id, user_id=user.id, game="roulette_v2", bet=body.amount,
        outcome=json.dumps(outcome), payout=payout, settled=True,
    ))
    db.add(models.Transaction(sender_id=user.id, amount=body.amount, note="casino:bet:roulette"))
    if payout:
        db.add(models.Transaction(recipient_id=user.id, amount=payout, note="casino:payout:roulette"))
    db.commit()
    return {
        "ok": True, "replayed": False, "payout": payout,
        "payout_percent": payout_percent, "index": index, "balance": wallet.balance,
        "failure_fragment_awarded": awarded_fragment,
        "failure_fragment_count": fragment_count,
    }


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
CLICKER_CRIT_MULT = 2
CLICKER_TAP_ENERGY_COST = 1
CLICKER_MAX_PASSIVE_HOURS = 4
CLICKER_PASSIVE_CAP_SHARE = 0.10
CLICKER_PROGRESSION_MAX_DAY = 7
CLICKER_PROGRESSION_MIN_EARNED = 0.80

# Внутриигровая валюта — «ковкойны». Тапаешь → копишь ковкойны → выводишь в ковбаксы.
CLICKER_START_KOVCOINS = 1        # стартовый баланс ковкойнов (сразу можно кликать)
CLICKER_CASHOUT_RATE = 2_000
CLICKER_CASHOUT_MIN = 2_000       # минимальная сумма к выводу (в ковкойнах)

# --- Дневной лимит заработка ---
# Семь активных дней: максимум 5, 9, 13, 17, 21, 25 и 30 ковбаксов.
# Активный и пассивный доход расходуют один общий серверный лимит.
CLICKER_DAILY_CAPS = (10_000, 18_000, 26_000, 34_000, 42_000, 50_000, 60_000)

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
    "click":   {"base_cost": 200, "mult": 1.15, "name": "Сила клика"},
    "passive": {"base_cost": 250, "mult": 1.15, "name": "Пассивный доход"},
    "energy":  {"base_cost": 220, "mult": 1.15, "name": "Макс. энергия"},
    "crit":    {"base_cost": 260, "mult": 1.15, "name": "Крит шанс"},
    "regen":   {"base_cost": 220, "mult": 1.15, "name": "Реген энергии"},
}


def _clicker_click_power(state):
    return 2.0 + state.lvl_click * 0.22         # 2.0 → 6.4


def _clicker_max_energy(state):
    return 1_200 + state.lvl_energy * 60         # 1200 → 2400


def _clicker_regen_rate(state):
    return 2.0 + state.lvl_regen * 0.15          # 2.0 → 5.0 /сек


def _clicker_crit_chance(state):
    return min(state.lvl_crit * 0.5, 10) / 100.0  # 0 → 10%


def _clicker_passive_per_min(state):
    return 0.25 + state.lvl_passive * 0.2        # 0.25 → 4.25 /мин


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
