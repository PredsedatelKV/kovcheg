from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import access, models
from app.api import arcade, battlepass, home, profile
from app.auth import current_user
from app.db import Base, get_db


@pytest.fixture()
def game_api(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def test_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    def test_user(request: Request, db: Session = Depends(get_db)):
        user = db.get(models.User, int(request.headers.get("X-Test-User", "1")))
        if not user:
            raise HTTPException(401, "test user missing")
        return user

    app = FastAPI()
    app.include_router(home.router)
    app.include_router(profile.router)
    app.include_router(battlepass.router)
    app.include_router(arcade.router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = test_user

    with sessions() as db:
        normal = models.User(id=1, telegram_id=111, first_name="Игрок", xp=0)
        omar = models.User(id=2, telegram_id=arcade.OMAR_TELEGRAM_ID, first_name="Омар", xp=0)
        magomet = models.User(id=3, telegram_id=837611803, first_name="Магомет", xp=0)
        ibrahim = models.User(id=4, telegram_id=7735808918, first_name="Ибрагим", xp=0)
        db.add_all([normal, omar, magomet, ibrahim])
        db.flush()
        db.add_all([
            models.Wallet(user_id=1, balance=100), models.Wallet(user_id=2, balance=100),
            models.Wallet(user_id=3, balance=100), models.Wallet(user_id=4, balance=100),
        ])
        season = models.BattlePassSeason(name="Тест", xp_per_level=100, total_levels=10, is_active=True)
        db.add(season)
        db.flush()
        db.add(models.BattlePassReward(
            season_id=season.id, level=1, track="free", kind="coins", value=7, label="7 К",
        ))
        fragment = models.Item(code="box_fragment", name="Фрагмент ковбокса", icon="fragment.svg")
        failure = models.Item(code="failure_fragment", name="Фрагмент неудачи", icon="failure.png", can_activate=True)
        prize = models.Item(code="prize", name="Приз", icon="prize.svg")
        lootbox = models.Item(
            code="lootbox_common", name="Обычный ковбокс", icon="box.svg",
            category="Ковбоксы", lootbox_pool_code="common",
        )
        db.add_all([fragment, failure, prize, lootbox])
        db.flush()
        pool = models.LootboxPool(code="common", name="Обычный", item_id=lootbox.id)
        db.add(pool)
        db.flush()
        db.add(models.LootboxPoolEntry(pool_id=pool.id, item_id=prize.id, weight=100))
        db.commit()

    yield TestClient(app), sessions
    engine.dispose()


def _headers(user_id=1):
    return {"X-Test-User": str(user_id)}


def _balance(sessions, user_id=1):
    with sessions() as db:
        return db.query(models.Wallet).filter_by(user_id=user_id).one().balance


def test_battlepass_claim_is_level_checked_and_idempotent(game_api):
    client, sessions = game_api
    first = client.post("/api/battlepass/claim", json={"level": 1}, headers=_headers())
    assert first.status_code == 200
    assert _balance(sessions) == 107
    second = client.post("/api/battlepass/claim", json={"level": 1}, headers=_headers())
    assert second.status_code == 409
    assert _balance(sessions) == 107


def test_battlepass_parallel_claim_only_once(game_api):
    client, sessions = game_api
    before = _balance(sessions)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: client.post(
            "/api/battlepass/claim", json={"level": 1}, headers=_headers(),
        ).status_code, range(2)))
    assert sorted(statuses) == [200, 409]
    assert _balance(sessions) == before + 7


def test_daily_reward_streak_reset_and_cap(game_api, monkeypatch):
    client, sessions = game_api
    monkeypatch.setattr(home, "_today_str", lambda: "2026-07-01")
    monkeypatch.setattr(home, "_yesterday_str", lambda: "2026-06-30")
    assert client.post("/api/home/daily-reward/claim", headers=_headers()).json()["reward"] == 1
    with sessions() as db:
        row = db.query(models.DailyReward).filter_by(user_id=1).one()
        row.streak = 7
        row.last_claim_date = "2026-07-01"
        db.commit()
    monkeypatch.setattr(home, "_today_str", lambda: "2026-07-02")
    monkeypatch.setattr(home, "_yesterday_str", lambda: "2026-07-01")
    assert client.post("/api/home/daily-reward/claim", headers=_headers()).json()["reward"] == 7
    monkeypatch.setattr(home, "_today_str", lambda: "2026-07-04")
    monkeypatch.setattr(home, "_yesterday_str", lambda: "2026-07-03")
    assert client.post("/api/home/daily-reward/claim", headers=_headers()).json()["reward"] == 1


def test_daily_reward_parallel_claim_only_once(game_api, monkeypatch):
    client, sessions = game_api
    monkeypatch.setattr(home, "_today_str", lambda: "2026-08-01")
    monkeypatch.setattr(home, "_yesterday_str", lambda: "2026-07-31")
    before = _balance(sessions)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: client.post("/api/home/daily-reward/claim", headers=_headers()).status_code, range(2)))
    assert sorted(statuses) == [200, 409]
    assert _balance(sessions) == before + 1


@pytest.mark.parametrize("game", sorted(arcade.FIRST_WIN_GAMES))
def test_each_arcade_first_win_requires_round_and_is_daily(game_api, game):
    client, sessions = game_api
    results = {
        "moshonka": {"player_score": 10, "opponent_score": 0, "duration_ms": 3_000},
        "tictactoe": {"player_score": 1, "opponent_score": 0, "duration_ms": 2_000},
        "minesweeper": {"player_score": 54, "opponent_score": 10, "duration_ms": 3_000},
        "harvest": {"player_score": 10, "opponent_score": 0, "duration_ms": 20_000},
        "checkers": {"player_score": 1, "opponent_score": 0, "duration_ms": 12_000},
        "pingpong": {"player_score": 5, "opponent_score": 2, "duration_ms": 12_000},
    }
    result = results[game]
    assert client.post("/api/arcade/first-win", json={"game": game, "round_token": "fake"}, headers=_headers()).status_code == 409
    token = client.post("/api/arcade/round/start", json={"game": game}, headers=_headers()).json()["token"]
    with sessions() as db:
        row = db.query(models.ArcadeRound).filter_by(token=token).one()
        row.started_at -= timedelta(seconds=20)
        db.commit()
    empty_result = client.post(
        "/api/arcade/first-win",
        json={"game": game, "round_token": token},
        headers=_headers(),
    )
    assert empty_result.status_code == 400
    assert _balance(sessions) == 100
    first = client.post(
        "/api/arcade/first-win",
        json={"game": game, "round_token": token, **result},
        headers=_headers(),
    )
    assert first.status_code == 200 and first.json()["reward"] == 3
    token2 = client.post("/api/arcade/round/start", json={"game": game}, headers=_headers()).json()["token"]
    with sessions() as db:
        row = db.query(models.ArcadeRound).filter_by(token=token2).one()
        row.started_at -= timedelta(seconds=20)
        db.commit()
    second = client.post(
        "/api/arcade/first-win",
        json={"game": game, "round_token": token2, **result},
        headers=_headers(),
    )
    assert second.status_code == 200 and second.json()["already_claimed"] is True


def test_first_win_parallel_request_cannot_double_credit(game_api):
    client, sessions = game_api
    token = client.post("/api/arcade/round/start", json={"game": "minesweeper"}, headers=_headers()).json()["token"]
    with sessions() as db:
        db.query(models.ArcadeRound).filter_by(token=token).one().started_at -= timedelta(seconds=20)
        db.commit()
    before = _balance(sessions)
    def claim(_):
        return client.post(
            "/api/arcade/first-win",
            json={
                "game": "minesweeper",
                "round_token": token,
                "player_score": 54,
                "opponent_score": 10,
                "duration_ms": 3_000,
            },
            headers=_headers(),
        ).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(claim, range(2)))
    assert sorted(statuses) == [200, 409]
    assert _balance(sessions) == before + 3


def test_fragment_assembly_and_parallel_safety(game_api):
    client, sessions = game_api
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        db.add(models.InventoryItem(user_id=1, item_id=fragment.id, quantity=20))
        db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: client.post("/api/profile/inventory/assemble-fragments", headers=_headers()).status_code, range(2)))
    assert statuses == [200, 200]
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        lootbox = db.query(models.Item).filter_by(code="lootbox_common").one()
        frag_inv = db.query(models.InventoryItem).filter_by(user_id=1, item_id=fragment.id).first()
        box_inv = db.query(models.InventoryItem).filter_by(user_id=1, item_id=lootbox.id).one()
        assert (frag_inv.quantity if frag_inv else 0) == 0
        assert box_inv.quantity == 2
    assert client.post("/api/profile/inventory/assemble-fragments", headers=_headers()).status_code == 400


def test_clicker_blocks_only_magomet_and_ibrahim(game_api):
    client, sessions = game_api
    assert client.get("/api/arcade/clicker/state", headers=_headers(1)).status_code == 200
    assert client.get("/api/arcade/clicker/state", headers=_headers(2)).status_code == 200
    # Аркада для Магомета и Ибрагима закрыта целиком, поэтому раздел отвечает 503
    # раньше, чем кликер успевает отдать свой 403. Сам запрет кликера при этом жив.
    assert client.get("/api/arcade/clicker/state", headers=_headers(3)).status_code == 503
    assert client.get("/api/arcade/clicker/state", headers=_headers(4)).status_code == 503
    with sessions() as db:
        assert access.can_use_clicker(db.get(models.User, 3)) is False
        assert access.can_use_clicker(db.get(models.User, 4)) is False
    assert client.post("/api/arcade/round/start", json={"game": "clicker"}, headers=_headers(2)).status_code == 400


def test_clicker_progression_caps_are_10k_to_40k(game_api, monkeypatch):
    client, sessions = game_api
    clock = [datetime(2026, 7, 1, 9, 0, 0)]
    monkeypatch.setattr(arcade.models, "now_utc", lambda: clock[0])

    first = client.get("/api/arcade/clicker/state", headers=_headers()).json()
    assert first["progression_day"] == 1
    assert first["daily_cap"] == 10_000

    expected = [15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 40_000]
    for offset, cap in enumerate(expected, start=1):
        with sessions() as db:
            state = db.query(models.ClickerState).filter_by(user_id=1).one()
            state.earned_today = int(arcade._clicker_daily_cap(state) * 0.8)
            db.commit()
        clock[0] = datetime(2026, 7, 1 + offset, 9, 0, 0)
        snapshot = client.get("/api/arcade/clicker/state", headers=_headers()).json()
        assert snapshot["daily_cap"] == cap
        assert snapshot["progression_day"] == min(7, offset + 1)


def test_clicker_flood_is_locked_without_energy_or_income(game_api, monkeypatch):
    client, sessions = game_api
    clock = [datetime(2026, 7, 1, 9, 0, 0)]
    monkeypatch.setattr(arcade.models, "now_utc", lambda: clock[0])
    initial = client.get("/api/arcade/clicker/state", headers=_headers()).json()
    flooded = client.post("/api/arcade/clicker/tap", json={"taps": 50}, headers=_headers())
    assert flooded.status_code == 200
    result = flooded.json()
    assert result["locked"] is True
    assert result["taps_processed"] == 0
    assert result["coins_earned"] == 0
    assert result["energy"] == initial["energy"]
    with sessions() as db:
        state = db.query(models.ClickerState).filter_by(user_id=1).one()
        assert state.kovcoins == initial["kovcoins"]


def test_clicker_passive_income_has_hard_daily_subcap(game_api, monkeypatch):
    client, sessions = game_api
    now = datetime(2026, 7, 1, 12, 0, 0)
    monkeypatch.setattr(arcade.models, "now_utc", lambda: now)
    client.get("/api/arcade/clicker/state", headers=_headers())
    with sessions() as db:
        state = db.query(models.ClickerState).filter_by(user_id=1).one()
        state.lvl_passive = arcade.CLICKER_MAX_LEVEL
        state.last_sync = now - timedelta(hours=24)
        state.kovcoins = 0
        db.commit()
    snapshot = client.get("/api/arcade/clicker/state", headers=_headers()).json()
    assert snapshot["passive_earned_today"] == 1_000
    assert snapshot["passive_daily_cap"] == 1_000
    assert client.get("/api/arcade/clicker/state", headers=_headers()).json()["kovcoins"] == 1_000


def test_clicker_cashout_uses_safe_rate(game_api, monkeypatch):
    client, sessions = game_api
    now = datetime(2026, 7, 1, 12, 0, 0)
    monkeypatch.setattr(arcade.models, "now_utc", lambda: now)
    client.get("/api/arcade/clicker/state", headers=_headers())
    with sessions() as db:
        state = db.query(models.ClickerState).filter_by(user_id=1).one()
        state.kovcoins = 4_000
        db.commit()
    before = _balance(sessions)
    response = client.post("/api/arcade/clicker/cashout", json={}, headers=_headers())
    assert response.status_code == 200
    assert response.json()["cashed_out"] == 2
    assert _balance(sessions) == before + 2


def test_legacy_casino_payout_is_rejected(game_api):
    client, sessions = game_api
    before = _balance(sessions)
    assert client.post("/api/arcade/win", json={"amount": 500, "game": "dice"}, headers=_headers()).status_code == 410
    assert _balance(sessions) == before


def test_roulette_table_has_exact_90_percent_rtp():
    assert sum(percent * chance for percent, chance in arcade.ROULETTE_PAYOUTS) == 90 * 100
    assert sum(chance for _, chance in arcade.ROULETTE_PAYOUTS) == 100


def test_roulette_is_atomic_idempotent_and_awards_failure_fragment(game_api, monkeypatch):
    client, sessions = game_api
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "choices", lambda *args, **kwargs: [50])
    payload = {"amount": 10, "request_id": "roulette_low_0001"}
    first = client.post("/api/arcade/roulette/spin", json=payload, headers=_headers())
    assert first.status_code == 200, first.text
    assert first.json()["payout"] == 5
    assert first.json()["balance"] == 95
    assert first.json()["failure_fragment_awarded"] == 1
    replay = client.post("/api/arcade/roulette/spin", json=payload, headers=_headers())
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert _balance(sessions) == 95
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="failure_fragment").one()
        assert db.query(models.InventoryItem).filter_by(user_id=1, item_id=fragment.id).one().quantity == 1


def test_roulette_enforces_minimum_and_twenty_percent_maximum(game_api):
    client, _ = game_api
    assert client.post(
        "/api/arcade/roulette/spin",
        json={"amount": 9, "request_id": "roulette_min_001"},
        headers=_headers(),
    ).status_code == 422
    assert client.post(
        "/api/arcade/roulette/spin",
        json={"amount": 21, "request_id": "roulette_max_001"},
        headers=_headers(),
    ).status_code == 400


def test_casino_cooldown_is_shared_across_all_games(game_api, monkeypatch):
    client, sessions = game_api
    now = datetime(2026, 7, 24, 12, 0, 0)
    monkeypatch.setattr(arcade.models, "now_utc", lambda: now)

    first = client.post(
        "/api/arcade/casino/start",
        json={"game": "slots", "amount": 1},
        headers=_headers(),
    )
    assert first.status_code == 200

    # created_at falls back to the real clock (the column default captured the
    # original now_utc), so pin the stored round to the frozen time under test.
    with sessions() as db:
        stored = db.query(models.CasinoRound).one()
        stored.created_at = now
        db.commit()

    blocked = client.post(
        "/api/arcade/roulette/spin",
        json={"amount": 10, "request_id": "roulette_cooldown_001"},
        headers=_headers(),
    )
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "3600"

    monkeypatch.setattr(
        arcade.models,
        "now_utc",
        lambda: now + arcade.CASINO_COOLDOWN,
    )
    allowed = client.post(
        "/api/arcade/casino/start",
        json={"game": "dice", "amount": 1, "choice": "odd"},
        headers=_headers(),
    )
    assert allowed.status_code == 200


MAINTENANCE_USERS = ("3", "4")  # Магомет и Ибрагим
OPEN_USERS = ("1", "2")  # обычный игрок и Омар


def _koverna_client(game_api_client):
    """Коверна живёт в роутерах shop/market, которых нет в основной тестовой сборке."""
    from app.api import market, shop
    app = FastAPI()
    app.include_router(shop.router)
    app.include_router(market.router)
    app.dependency_overrides = dict(game_api_client.app.dependency_overrides)
    return TestClient(app)


def test_closed_sections_are_rejected_for_the_listed_players(game_api):
    client, sessions = game_api
    koverna = _koverna_client(client)

    for user_id in MAINTENANCE_USERS:
        headers = {"X-Test-User": user_id}
        with sessions() as db:
            assert access.maintenance_sections(db.get(models.User, int(user_id))) == [
                "koverna", "arcade", "battlepass",
            ]

        assert koverna.get("/api/shop/products", headers=headers).status_code == 503
        assert koverna.get("/api/market/listings", headers=headers).status_code == 503
        assert client.post(
            "/api/arcade/casino/start", json={"game": "slots", "amount": 1}, headers=headers,
        ).status_code == 503

        blocked = client.post("/api/battlepass/claim", json={"level": 1}, headers=headers)
        assert blocked.status_code == 503
        assert blocked.json()["detail"] == access.MAINTENANCE_MESSAGE

        # Чтение пропуска остаётся открытым: Главная берёт из него уровень.
        assert client.get("/api/battlepass", headers=headers).status_code == 200


def test_open_sections_stay_open_for_everyone_else(game_api):
    client, sessions = game_api
    koverna = _koverna_client(client)

    for user_id in OPEN_USERS:
        headers = {"X-Test-User": user_id}
        with sessions() as db:
            assert access.maintenance_sections(db.get(models.User, int(user_id))) == []

        assert koverna.get("/api/shop/products", headers=headers).status_code == 200
        assert koverna.get("/api/market/listings", headers=headers).status_code == 200
        assert client.post(
            "/api/arcade/casino/start", json={"game": "slots", "amount": 1}, headers=headers,
        ).status_code == 200
        assert client.get("/api/battlepass", headers=headers).status_code == 200
