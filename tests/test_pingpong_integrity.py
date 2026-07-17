from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.api import arcade
from app.auth import current_user
from app.db import Base, get_db


@pytest.fixture()
def pingpong_api(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pingpong.db'}",
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
    app.include_router(arcade.router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = test_user

    with sessions() as db:
        user = models.User(id=1, telegram_id=111, first_name="Игрок")
        db.add(user)
        db.flush()
        db.add(models.Wallet(user_id=user.id, balance=100))
        db.commit()

    yield TestClient(app), sessions
    engine.dispose()


def _start_round(client: TestClient, sessions, elapsed_seconds: int = 20) -> str:
    response = client.post("/api/arcade/round/start", json={"game": "pingpong"})
    assert response.status_code == 200
    token = response.json()["token"]
    with sessions() as db:
        game_round = db.query(models.ArcadeRound).filter_by(token=token).one()
        game_round.started_at -= timedelta(seconds=elapsed_seconds)
        db.commit()
    return token


def _claim(client: TestClient, token: str, **overrides):
    payload = {
        "game": "pingpong",
        "round_token": token,
        "player_score": 5,
        "opponent_score": 2,
        "duration_ms": 12_000,
    }
    payload.update(overrides)
    return client.post("/api/arcade/first-win", json=payload)


def _balance(sessions) -> int:
    with sessions() as db:
        return db.query(models.Wallet).filter_by(user_id=1).one().balance


def test_pingpong_valid_result_is_awarded_once(pingpong_api):
    client, sessions = pingpong_api
    token = _start_round(client, sessions)

    response = _claim(client, token)

    assert response.status_code == 200
    assert response.json()["reward"] == arcade.FIRST_WIN_REWARD
    assert _balance(sessions) == 100 + arcade.FIRST_WIN_REWARD
    assert _claim(client, token).status_code == 409
    assert _balance(sessions) == 100 + arcade.FIRST_WIN_REWARD


@pytest.mark.parametrize(
    ("overrides", "expected_status"),
    [
        ({"player_score": None}, 400),
        ({"player_score": 4}, 400),
        ({"opponent_score": 5}, 400),
        ({"duration_ms": 6_999, "opponent_score": 0}, 400),
        ({"duration_ms": 30_000}, 400),
        ({"player_score": 5.5}, 422),
        ({"duration_ms": "12000"}, 422),
    ],
)
def test_pingpong_rejects_impossible_or_coerced_results(pingpong_api, overrides, expected_status):
    client, sessions = pingpong_api
    token = _start_round(client, sessions)

    response = _claim(client, token, **overrides)

    assert response.status_code == expected_status
    assert _balance(sessions) == 100


def test_pingpong_rejects_win_immediately_after_start(pingpong_api):
    client, sessions = pingpong_api
    token = _start_round(client, sessions, elapsed_seconds=0)

    response = _claim(client, token, duration_ms=7_000, opponent_score=0)

    assert response.status_code == 400
    assert _balance(sessions) == 100


def test_pingpong_invalid_attempt_does_not_consume_round(pingpong_api):
    client, sessions = pingpong_api
    token = _start_round(client, sessions)

    assert _claim(client, token, player_score=4).status_code == 400
    assert _claim(client, token).status_code == 200
    assert _balance(sessions) == 100 + arcade.FIRST_WIN_REWARD


def test_pingpong_parallel_replay_cannot_double_credit(pingpong_api):
    client, sessions = pingpong_api
    token = _start_round(client, sessions)

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: _claim(client, token).status_code, range(2)))

    assert sorted(statuses) == [200, 409]
    assert _balance(sessions) == 100 + arcade.FIRST_WIN_REWARD


@pytest.mark.parametrize("multiplier", ["NaN", "Infinity", "-Infinity"])
def test_rocket_rejects_non_finite_multiplier_without_consuming_round(pingpong_api, multiplier):
    client, sessions = pingpong_api
    started = client.post(
        "/api/arcade/casino/start",
        json={"game": "rocket", "amount": 10},
    )
    assert started.status_code == 200
    token = started.json()["token"]

    response = client.post(
        "/api/arcade/casino/settle",
        content=f'{{"token":"{token}","multiplier":{multiplier}}}',
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 400
    with sessions() as db:
        game_round = db.query(models.CasinoRound).filter_by(token=token).one()
        assert game_round.settled is False
        assert db.query(models.Wallet).filter_by(user_id=1).one().balance == 90

    # The invalid attempt must roll back fully: the same round can still be
    # settled with a finite, currently reachable multiplier.
    valid = client.post(
        "/api/arcade/casino/settle",
        json={"token": token, "multiplier": 1.0},
    )
    assert valid.status_code == 200
    assert valid.json()["payout"] == 10


def test_rocket_start_and_live_status_hide_future_crash(pingpong_api, monkeypatch):
    client, sessions = pingpong_api
    # Keep the crash safely in the future even on a slow test runner.
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "expovariate", lambda _rate: 2.0)

    started = client.post(
        "/api/arcade/casino/start",
        json={"game": "rocket", "amount": 10},
    )

    assert started.status_code == 200
    body = started.json()
    assert "crash_at" not in body["outcome"]
    assert body["outcome"] == {
        "growth_per_second": arcade.ROCKET_GROWTH_PER_SECOND,
        "max_multiplier": arcade.ROCKET_MAX_MULTIPLIER,
    }
    with sessions() as db:
        game_round = db.query(models.CasinoRound).filter_by(token=body["token"]).one()
        assert json.loads(game_round.outcome)["crash_at"] == pytest.approx(3.05)

    status = client.get(
        "/api/arcade/casino/rocket/status",
        params={"token": body["token"]},
    )

    assert status.status_code == 200
    assert status.json()["crashed"] is False
    assert status.json()["crash_multiplier"] is None
    assert "_settlement_multiplier" not in status.json()


@pytest.mark.parametrize("amount", [1.5, "10", True])
def test_casino_rejects_non_integer_bets_without_spending(pingpong_api, amount):
    client, sessions = pingpong_api

    response = client.post(
        "/api/arcade/casino/start",
        json={"game": "dice", "amount": amount, "choice": "odd"},
    )

    assert response.status_code == 422
    assert _balance(sessions) == 100


def test_rocket_settlement_ignores_forged_client_multiplier(pingpong_api, monkeypatch):
    client, sessions = pingpong_api
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "expovariate", lambda _rate: 2.0)
    started = client.post(
        "/api/arcade/casino/start",
        json={"game": "rocket", "amount": 10},
    )
    assert started.status_code == 200
    token = started.json()["token"]
    with sessions() as db:
        game_round = db.query(models.CasinoRound).filter_by(token=token).one()
        game_round.created_at = models.now_utc() - timedelta(seconds=2)
        db.commit()

    settled = client.post(
        "/api/arcade/casino/settle",
        # A legacy or malicious client may still send this value. It must not
        # influence a payout derived exclusively from server elapsed time.
        json={"token": token, "multiplier": 4.99},
    )

    assert settled.status_code == 200
    body = settled.json()
    assert body["crashed"] is False
    assert 1.5 <= body["multiplier"] < 2.0
    assert 15 <= body["payout"] < 20
    assert body["payout"] != 49
    assert _balance(sessions) == 90 + body["payout"]


def test_rocket_displayed_multiplier_matches_integer_payout(pingpong_api, monkeypatch):
    client, sessions = pingpong_api
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "expovariate", lambda _rate: 2.0)
    with sessions() as db:
        # The casino enforces the same 20% max-bet rule as the client; a 500
        # balance permits the round 100 wager used for an exact cents check.
        db.query(models.Wallet).filter_by(user_id=1).one().balance = 500
        db.commit()
    started = client.post(
        "/api/arcade/casino/start",
        json={"game": "rocket", "amount": 100},
    )
    assert started.status_code == 200
    token = started.json()["token"]
    fixed_now = models.now_utc()
    with sessions() as db:
        game_round = db.query(models.CasinoRound).filter_by(token=token).one()
        # Raw growth is x1.49975. The public game works in integer
        # hundredths, so it must show and pay exactly x1.49, never show x1.50
        # while crediting only 149.
        game_round.created_at = fixed_now - timedelta(seconds=1.999)
        db.commit()
    monkeypatch.setattr(arcade.models, "now_utc", lambda: fixed_now)

    status = client.get(
        "/api/arcade/casino/rocket/status",
        params={"token": token},
    )
    settled = client.post("/api/arcade/casino/settle", json={"token": token})

    assert status.status_code == 200
    assert status.json()["current_multiplier"] == 1.49
    assert settled.status_code == 200
    assert settled.json()["multiplier"] == 1.49
    assert settled.json()["payout"] == 149
    assert _balance(sessions) == 549


def test_rocket_cannot_cash_out_after_server_crash(pingpong_api, monkeypatch):
    client, sessions = pingpong_api
    monkeypatch.setattr(arcade.SYSTEM_RANDOM, "expovariate", lambda _rate: 0.05)
    started = client.post(
        "/api/arcade/casino/start",
        json={"game": "rocket", "amount": 10},
    )
    assert started.status_code == 200
    token = started.json()["token"]
    with sessions() as db:
        game_round = db.query(models.CasinoRound).filter_by(token=token).one()
        crash_at = float(json.loads(game_round.outcome)["crash_at"])
        seconds_to_crash = (crash_at - 1.0) / arcade.ROCKET_GROWTH_PER_SECOND
        game_round.created_at = models.now_utc() - timedelta(seconds=seconds_to_crash + 1)
        db.commit()

    status = client.get(
        "/api/arcade/casino/rocket/status",
        params={"token": token},
    )
    assert status.status_code == 200
    assert status.json()["crashed"] is True
    assert status.json()["crash_multiplier"] == pytest.approx(crash_at)

    settled = client.post(
        "/api/arcade/casino/settle",
        json={"token": token, "multiplier": 1.0},
    )

    assert settled.status_code == 200
    assert settled.json()["crashed"] is True
    assert settled.json()["payout"] == 0
    assert _balance(sessions) == 90
