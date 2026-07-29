from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import access, models
from app.api import arcade, battlepass, home, profile, shop, wheel
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
    app.include_router(shop.router)
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
    assert client.post("/api/home/daily-reward/claim", headers=_headers()).json()["reward"] == 10
    with sessions() as db:
        row = db.query(models.DailyReward).filter_by(user_id=1).one()
        row.streak = 7
        row.last_claim_date = "2026-07-01"
        db.commit()
    monkeypatch.setattr(home, "_today_str", lambda: "2026-07-02")
    monkeypatch.setattr(home, "_yesterday_str", lambda: "2026-07-01")
    assert client.post("/api/home/daily-reward/claim", headers=_headers()).json()["reward"] == 70
    monkeypatch.setattr(home, "_today_str", lambda: "2026-07-04")
    monkeypatch.setattr(home, "_yesterday_str", lambda: "2026-07-03")
    assert client.post("/api/home/daily-reward/claim", headers=_headers()).json()["reward"] == 10


def test_daily_reward_parallel_claim_only_once(game_api, monkeypatch):
    client, sessions = game_api
    monkeypatch.setattr(home, "_today_str", lambda: "2026-08-01")
    monkeypatch.setattr(home, "_yesterday_str", lambda: "2026-07-31")
    before = _balance(sessions)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: client.post("/api/home/daily-reward/claim", headers=_headers()).status_code, range(2)))
    assert sorted(statuses) == [200, 409]
    assert _balance(sessions) == before + 10


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
    assert first.status_code == 200 and first.json()["reward"] == 30
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
    assert _balance(sessions) == before + 30


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


def test_clicker_is_open_for_all_players(game_api):
    client, sessions = game_api
    for user_id in (1, 2, 3, 4):
        assert client.get("/api/arcade/clicker/state", headers=_headers(user_id)).status_code == 200
        with sessions() as db:
            assert access.can_use_clicker(db.get(models.User, user_id)) is True
    assert client.post("/api/arcade/round/start", json={"game": "clicker"}, headers=_headers(2)).status_code == 400


def test_clicker_progression_caps_are_5_to_30_kovbucks(game_api, monkeypatch):
    client, sessions = game_api
    clock = [datetime(2026, 7, 1, 9, 0, 0)]
    monkeypatch.setattr(arcade.models, "now_utc", lambda: clock[0])

    first = client.get("/api/arcade/clicker/state", headers=_headers()).json()
    assert first["progression_day"] == 1
    assert first["daily_cap"] == 10_000

    expected = [18_000, 26_000, 34_000, 42_000, 50_000, 60_000, 60_000]
    for offset, cap in enumerate(expected, start=1):
        with sessions() as db:
            state = db.query(models.ClickerState).filter_by(user_id=1).one()
            state.earned_today = int(arcade._clicker_daily_cap(state) * 0.8)
            db.commit()
        clock[0] = datetime(2026, 7, 1 + offset, 9, 0, 0)
        snapshot = client.get("/api/arcade/clicker/state", headers=_headers()).json()
        assert snapshot["daily_cap"] == cap
        assert snapshot["progression_day"] == min(7, offset + 1)
        assert snapshot["daily_cap"] // snapshot["cashout_rate"] <= 30


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
    assert response.json()["cashed_out"] == 20
    assert _balance(sessions) == before + 20


def test_shop_restock_request_is_limited_to_one_per_day(game_api):
    client, sessions = game_api
    assert client.get("/api/shop/restock-request/status", headers=_headers()).json()["can_submit"] is True
    first = client.post(
        "/api/shop/restock-request",
        json={"text": "  Мармелад   кислый  "},
        headers=_headers(),
    )
    assert first.status_code == 200
    assert client.get("/api/shop/restock-request/status", headers=_headers()).json()["can_submit"] is False
    assert client.post(
        "/api/shop/restock-request",
        json={"text": "Другой товар"},
        headers=_headers(),
    ).status_code == 409
    with sessions() as db:
        request = db.query(models.ShopRestockRequest).filter_by(user_id=1).one()
        assert request.text == "Мармелад кислый"


def test_legacy_casino_payout_is_rejected(game_api):
    client, sessions = game_api
    before = _balance(sessions)
    assert client.post("/api/arcade/win", json={"amount": 500, "game": "dice"}, headers=_headers()).status_code == 410
    assert _balance(sessions) == before


def test_casino_tables_have_exact_90_percent_rtp():
    assert sum(payout * weight for payout, weight in arcade.ROULETTE_PAYOUTS) == 90 * 10_000
    assert sum(weight for _, weight in arcade.ROULETTE_PAYOUTS) == 10_000
    assert sum(percent * chance for percent, chance in arcade.RISKWHEEL_PAYOUTS) == 90 * 100
    assert sum(chance for _, chance in arcade.RISKWHEEL_PAYOUTS) == 100
    assert sum(percent * chance for _, percent, chance in arcade.SLOTS_OUTCOMES) == 90 * 100
    assert sum(chance for _, _, chance in arcade.SLOTS_OUTCOMES) == 100
    assert arcade.DICE_EXACT_PAYOUT_PERCENT / 6 == 90
    assert arcade.DICE_EVEN_PAYOUT_PERCENT / 2 == 90


def test_rocket_has_ten_percent_immediate_bust_bucket(monkeypatch):
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "randrange", lambda *args, **kwargs: 9000)
    assert arcade._rocket_crash_point() == 1.0
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "randrange", lambda *args, **kwargs: 3000)
    assert arcade._rocket_crash_point() == 3.0


def test_roulette_is_atomic_idempotent_and_awards_failure_fragment(game_api, monkeypatch):
    client, sessions = game_api
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "randrange", lambda *args, **kwargs: 17)
    payload = {"amount": 100, "request_id": "roulette_low_0001"}
    first = client.post("/api/arcade/roulette/spin", json=payload, headers=_headers())
    assert first.status_code == 200, first.text
    assert first.json()["payout"] == 10
    assert first.json()["balance"] == 10
    assert first.json()["failure_fragment_awarded"] == 1
    replay = client.post("/api/arcade/roulette/spin", json=payload, headers=_headers())
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert _balance(sessions) == 10
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="failure_fragment").one()
        assert db.query(models.InventoryItem).filter_by(user_id=1, item_id=fragment.id).one().quantity == 1


def test_roulette_enforces_fixed_bet(game_api):
    client, _ = game_api
    assert client.post(
        "/api/arcade/roulette/spin",
        json={"amount": 99, "request_id": "roulette_min_001"},
        headers=_headers(),
    ).status_code == 422
    assert client.post(
        "/api/arcade/roulette/spin",
        json={"amount": 101, "request_id": "roulette_wrong_001"},
        headers=_headers(),
    ).status_code == 422
    assert client.post(
        "/api/arcade/roulette/spin",
        json={"amount": 100, "request_id": "roulette_fixed_001"},
        headers=_headers(),
    ).status_code == 200


def test_casino_has_no_round_count_limit(game_api, monkeypatch):
    client, _ = game_api
    # Билет 6000 попадает в сектор возврата 100, баланс не меняется.
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "randrange", lambda *args, **kwargs: 6000)
    for index in range(8):
        response = client.post(
            "/api/arcade/roulette/spin",
            json={"amount": 100, "request_id": f"unlimited_roulette_{index:02d}"},
            headers=_headers(),
        )
        assert response.status_code == 200, response.text


def test_casino_locks_for_six_hours_after_half_balance_loss(game_api, monkeypatch):
    client, sessions = game_api
    now = datetime(2026, 7, 26, 12, 0, 0)
    monkeypatch.setattr(arcade.models, "now_utc", lambda: now)
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "randrange", lambda *args, **kwargs: 1)

    # Один фиксированный спин возвращает 10 и теряет 90% стартового баланса.
    response = client.post(
        "/api/arcade/roulette/spin",
        json={"amount": 100, "request_id": "loss_lock_fixed"},
        headers=_headers(),
    )
    assert response.status_code == 200, response.text
    with sessions() as db:
        for stored in db.query(models.CasinoRound).all():
            stored.created_at = now
        db.commit()

    blocked = client.post(
        "/api/arcade/casino/start",
        json={"game": "dice", "amount": 100, "choice": "odd"},
        headers=_headers(),
    )
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) == 6 * 60 * 60

    monkeypatch.setattr(arcade.models, "now_utc", lambda: now + arcade.CASINO_LOCK_DURATION)
    with sessions() as db:
        db.get(models.Wallet, 1).balance = 100
        db.commit()
    allowed = client.post(
        "/api/arcade/casino/start",
        json={"game": "dice", "amount": 100, "choice": "odd"},
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


def test_previously_maintenance_players_have_open_sections(game_api):
    client, sessions = game_api
    koverna = _koverna_client(client)

    for user_id in MAINTENANCE_USERS:
        headers = {"X-Test-User": user_id}
        with sessions() as db:
            assert access.maintenance_sections(db.get(models.User, int(user_id))) == []

        assert koverna.get("/api/shop/products", headers=headers).status_code == 200
        assert koverna.get("/api/market/listings", headers=headers).status_code == 200
        assert client.post(
            "/api/arcade/casino/start", json={"game": "slots", "amount": 100}, headers=headers,
        ).status_code == 200
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
            "/api/arcade/casino/start", json={"game": "slots", "amount": 100}, headers=headers,
        ).status_code == 200
        assert client.get("/api/battlepass", headers=headers).status_code == 200


def _wheel_client(game_api_client):
    """Колесо живёт в отдельном роутере, которого нет в основной тестовой сборке."""
    app = FastAPI()
    app.include_router(wheel.router)
    app.dependency_overrides = dict(game_api_client.app.dependency_overrides)
    return TestClient(app)


def test_wheel_sector_icons_follow_kind_and_item(game_api):
    client, sessions = game_api
    with sessions() as db:
        db.add_all([
            models.WheelPrize(label="5 Ковбаксов", kind="coins", value=5, weight=40),
            models.WheelPrize(label="50 XP", kind="xp", value=50, weight=30),
            models.WheelPrize(
                label="Обычный ковбокс", kind="item", value=1,
                item_code="lootbox_common", weight=20,
            ),
            models.WheelPrize(
                label="Фрагмент", kind="item", value=3,
                item_code="box_fragment", weight=10,
            ),
        ])
        db.commit()

    sectors = _wheel_client(client).get("/api/wheel/status", headers=_headers()).json()["sectors"]
    by_kind = {(s["kind"], s.get("item_code")): s for s in sectors}

    # Иконка берётся из типа приза, а не из легаси-колонки icon.
    assert by_kind[("coins", None)]["icon"] == "/static/img/ui/kovbaks.png"
    assert by_kind[("xp", None)]["icon"] == "/static/img/ui/xp.png"
    # У предметных призов — картинка самого предмета.
    assert by_kind[("item", "lootbox_common")]["icon"] == "box.svg"
    assert by_kind[("item", "box_fragment")]["icon"] == "fragment.svg"
    # Пул нужен клиенту, чтобы покрасить сектор в цвет ковбокса.
    assert by_kind[("item", "lootbox_common")]["lootbox_pool_code"] == "common"
    assert by_kind[("item", "box_fragment")]["lootbox_pool_code"] is None


def _skin_client(game_api_client):
    """Профиль живёт в своём роутере — собираем отдельное приложение."""
    from app.api import profile as profile_api
    app = FastAPI()
    app.include_router(profile_api.router)
    app.dependency_overrides = dict(game_api_client.app.dependency_overrides)
    return TestClient(app)


def _make_skin(db, code, slot, rarity="Обычный"):
    item = models.Item(code=code, name=code, icon="", category="Скины",
                       rarity=rarity, skin_slot=slot)
    db.add(item)
    db.flush()
    return item


def test_equipping_a_skin_does_not_consume_it(game_api):
    client, sessions = game_api
    skins = _skin_client(client)
    with sessions() as db:
        helmet = _make_skin(db, "skin_head_test", "head", "Эпический")
        db.add(models.InventoryItem(user_id=1, item_id=helmet.id, quantity=1))
        db.commit()
        helmet_id = helmet.id

    equipped = skins.post("/api/profile/skins/equip",
                          json={"item_id": helmet_id, "slot": "head"}, headers=_headers())
    assert equipped.status_code == 200
    assert equipped.json()["skin_loadout"]["head"] == "skin_head_test"

    # Ключевое отличие от активации: предмет остаётся в инвентаре.
    with sessions() as db:
        row = db.query(models.InventoryItem).filter_by(user_id=1, item_id=helmet_id).one()
        assert row.quantity == 1

    # Комплект виден и в обычном профиле.
    assert skins.get("/api/profile/me", headers=_headers()).json()[
        "skin_loadout"]["head"] == "skin_head_test"

    unequipped = skins.post("/api/profile/skins/unequip",
                            json={"slot": "head"}, headers=_headers())
    assert unequipped.status_code == 200
    assert unequipped.json()["skin_loadout"]["head"] is None


def test_skin_cannot_be_equipped_into_a_foreign_slot(game_api):
    client, sessions = game_api
    skins = _skin_client(client)
    with sessions() as db:
        boots = _make_skin(db, "skin_feet_test", "feet")
        db.add(models.InventoryItem(user_id=1, item_id=boots.id, quantity=1))
        db.commit()
        boots_id = boots.id

    wrong_slot = skins.post("/api/profile/skins/equip",
                            json={"item_id": boots_id, "slot": "torso"}, headers=_headers())
    assert wrong_slot.status_code == 400


def test_skin_not_owned_cannot_be_equipped(game_api):
    client, sessions = game_api
    skins = _skin_client(client)
    with sessions() as db:
        # Предмет существует в каталоге, но игроку не выдан.
        crown = _make_skin(db, "skin_head_unowned", "head", "Легендарный")
        db.commit()
        crown_id = crown.id

    assert skins.post("/api/profile/skins/equip",
                      json={"item_id": crown_id, "slot": "head"},
                      headers=_headers()).status_code == 400


def test_non_skin_item_is_rejected(game_api):
    client, sessions = game_api
    skins = _skin_client(client)
    with sessions() as db:
        prize = db.query(models.Item).filter(models.Item.code == "prize").one()
        db.add(models.InventoryItem(user_id=1, item_id=prize.id, quantity=1))
        db.commit()
        prize_id = prize.id

    assert skins.post("/api/profile/skins/equip",
                      json={"item_id": prize_id, "slot": "head"},
                      headers=_headers()).status_code == 400
