from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
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
        db.add_all([normal, omar])
        db.flush()
        db.add_all([models.Wallet(user_id=1, balance=100), models.Wallet(user_id=2, balance=100)])
        season = models.BattlePassSeason(name="Тест", xp_per_level=100, total_levels=10, is_active=True)
        db.add(season)
        db.flush()
        db.add(models.BattlePassReward(
            season_id=season.id, level=1, track="free", kind="coins", value=7, label="7 К",
        ))
        fragment = models.Item(code="box_fragment", name="Фрагмент ковбокса", icon="fragment.svg")
        prize = models.Item(code="prize", name="Приз", icon="prize.svg")
        lootbox = models.Item(
            code="lootbox_common", name="Обычный ковбокс", icon="box.svg",
            category="Ковбоксы", lootbox_pool_code="common",
        )
        db.add_all([fragment, prize, lootbox])
        db.flush()
        pool = models.LootboxPool(code="common", name="Обычный")
        db.add(pool)
        db.flush()
        db.add(models.LootboxPoolEntry(pool_id=pool.id, item_id=prize.id, weight=1))
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
    assert client.post("/api/arcade/first-win", json={"game": game, "round_token": "fake"}, headers=_headers()).status_code == 409
    token = client.post("/api/arcade/round/start", json={"game": game}, headers=_headers()).json()["token"]
    with sessions() as db:
        row = db.query(models.ArcadeRound).filter_by(token=token).one()
        row.started_at -= timedelta(seconds=20)
        db.commit()
    first = client.post("/api/arcade/first-win", json={"game": game, "round_token": token}, headers=_headers())
    assert first.status_code == 200 and first.json()["reward"] == 3
    token2 = client.post("/api/arcade/round/start", json={"game": game}, headers=_headers()).json()["token"]
    with sessions() as db:
        row = db.query(models.ArcadeRound).filter_by(token=token2).one()
        row.started_at -= timedelta(seconds=20)
        db.commit()
    second = client.post("/api/arcade/first-win", json={"game": game, "round_token": token2}, headers=_headers())
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
            json={"game": "minesweeper", "round_token": token},
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
        db.add(models.InventoryItem(user_id=1, item_id=fragment.id, quantity=6))
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


def test_clicker_is_stable_id_only_and_cannot_claim_first_win(game_api):
    client, _ = game_api
    assert client.get("/api/arcade/clicker/state", headers=_headers(1)).status_code == 403
    assert client.get("/api/arcade/clicker/state", headers=_headers(2)).status_code == 200
    assert client.post("/api/arcade/round/start", json={"game": "clicker"}, headers=_headers(2)).status_code == 400


def test_legacy_casino_payout_is_rejected(game_api):
    client, sessions = game_api
    before = _balance(sessions)
    assert client.post("/api/arcade/win", json={"amount": 500, "game": "dice"}, headers=_headers()).status_code == 410
    assert _balance(sessions) == before
