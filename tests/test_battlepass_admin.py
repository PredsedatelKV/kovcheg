from __future__ import annotations

import json

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.api import admin, battlepass, profile
from app.auth import current_user, require_admin
from app.db import Base, get_db


@pytest.fixture()
def battlepass_api(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'battlepass.db'}",
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
        if user is None:
            raise HTTPException(401, "test user missing")
        return user

    def test_admin(request: Request, db: Session = Depends(get_db)):
        user = db.get(models.User, int(request.headers.get("X-Test-User", "2")))
        if user is None or user.id != 2:
            raise HTTPException(403, "admin only")
        return user

    app = FastAPI()
    app.include_router(battlepass.router)
    app.include_router(profile.router)
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = test_user
    app.dependency_overrides[require_admin] = test_admin

    with sessions() as db:
        player = models.User(id=1, telegram_id=111, first_name="Игрок", xp=250)
        administrator = models.User(id=2, telegram_id=222, first_name="Админ", xp=0)
        prize = models.Item(code="prize", name="Предмет-приз", icon="prize.svg")
        db.add_all([player, administrator, prize])
        db.flush()
        db.add_all([models.Wallet(user_id=1, balance=100), models.Wallet(user_id=2, balance=100)])
        season = models.BattlePassSeason(name="Тест", xp_per_level=100, total_levels=10, is_active=True)
        db.add(season)
        db.flush()
        db.add_all([
            models.BattlePassReward(
                season_id=season.id, level=1, track="free", kind="coins", value=7, label="7 К",
            ),
            models.BattlePassReward(
                season_id=season.id, level=10, track="free", kind="xp", value=10, label="10 XP",
            ),
        ])
        db.commit()

    yield TestClient(app), sessions
    engine.dispose()


def _headers(user_id: int = 2) -> dict[str, str]:
    return {"X-Test-User": str(user_id)}


def test_season_dto_rejects_coercion_and_invalid_bounds(battlepass_api):
    client, sessions = battlepass_api
    with sessions() as db:
        season_id = db.query(models.BattlePassSeason.id).filter_by(is_active=True).scalar()

    assert client.post(
        "/api/admin/battlepass/season",
        json={"id": season_id, "xp_per_level": "100"},
        headers=_headers(),
    ).status_code == 422
    assert client.post(
        "/api/admin/battlepass/season",
        json={"id": season_id, "xp_per_level": 0},
        headers=_headers(),
    ).status_code == 422
    assert client.post(
        "/api/admin/battlepass/season",
        json={"id": season_id, "total_levels": 1001},
        headers=_headers(),
    ).status_code == 422

    shrinking = client.post(
        "/api/admin/battlepass/season",
        json={"id": season_id, "total_levels": 9},
        headers=_headers(),
    )
    assert shrinking.status_code == 409
    with sessions() as db:
        assert db.get(models.BattlePassSeason, season_id).total_levels == 10


def test_reward_configuration_is_consistent_and_references_existing_item(battlepass_api):
    client, sessions = battlepass_api
    with sessions() as db:
        season_id = db.query(models.BattlePassSeason.id).filter_by(is_active=True).scalar()

    base = {
        "season_id": season_id,
        "level": 2,
        "kind": "item",
        "value": 1,
        "item_code": "missing",
        "label": "Приз",
        "icon": "prize.svg",
    }
    assert client.post("/api/admin/battlepass/reward", json=base, headers=_headers()).status_code == 400
    assert client.post(
        "/api/admin/battlepass/reward",
        json={**base, "level": 11, "item_code": "prize"},
        headers=_headers(),
    ).status_code == 400
    assert client.post(
        "/api/admin/battlepass/reward",
        json={**base, "kind": "coins", "item_code": "prize"},
        headers=_headers(),
    ).status_code == 422
    assert client.post(
        "/api/admin/battlepass/reward",
        json={**base, "value": 0, "item_code": "prize"},
        headers=_headers(),
    ).status_code == 422

    saved = client.post(
        "/api/admin/battlepass/reward",
        json={**base, "item_code": "prize"},
        headers=_headers(),
    )
    assert saved.status_code == 200
    with sessions() as db:
        reward = db.query(models.BattlePassReward).filter_by(season_id=season_id, level=2).one()
        assert (reward.kind, reward.value, reward.item_code) == ("item", 1, "prize")


def test_seed_dto_is_strict_and_creates_bounded_season(battlepass_api):
    client, sessions = battlepass_api
    assert client.post(
        "/api/admin/battlepass/seed",
        json={"total_levels": "3", "xp_per_level": 100},
        headers=_headers(),
    ).status_code == 422
    assert client.post(
        "/api/admin/battlepass/seed",
        json={"total_levels": 3, "xp_per_level": 0},
        headers=_headers(),
    ).status_code == 422

    response = client.post(
        "/api/admin/battlepass/seed",
        json={"name": "Новый", "theme": "winter", "total_levels": 3, "xp_per_level": 50},
        headers=_headers(),
    )
    assert response.status_code == 200
    with sessions() as db:
        season = db.get(models.BattlePassSeason, response.json()["id"])
        assert season is not None and season.is_active
        assert (season.total_levels, season.xp_per_level) == (3, 50)
        assert db.query(models.BattlePassReward).filter_by(season_id=season.id).count() == 3


def test_legacy_invalid_season_cannot_crash_or_issue_rewards(battlepass_api):
    client, sessions = battlepass_api
    with sessions() as db:
        season = db.query(models.BattlePassSeason).filter_by(is_active=True).one()
        season.xp_per_level = 0
        db.commit()

    pass_response = client.get("/api/battlepass", headers=_headers(1))
    assert pass_response.status_code == 503
    claim_response = client.post("/api/battlepass/claim", json={"level": 1}, headers=_headers(1))
    assert claim_response.status_code == 503
    profile_response = client.get("/api/profile/me", headers=_headers(1))
    assert profile_response.status_code == 200
    assert profile_response.json()["bp_level"] == 0


def test_reset_level_clears_claim_table_and_both_json_formats(battlepass_api):
    client, sessions = battlepass_api
    with sessions() as db:
        season = db.query(models.BattlePassSeason).filter_by(is_active=True).one()
        reward_one = db.query(models.BattlePassReward).filter_by(season_id=season.id, level=1).one()
        reward_ten = db.query(models.BattlePassReward).filter_by(season_id=season.id, level=10).one()
        db.add(models.UserBattlePass(
            user_id=1,
            season_id=season.id,
            claimed_rewards=json.dumps([1, [1, "free"], 10, [10, "free"]]),
        ))
        db.add_all([
            models.BattlePassClaim(user_id=1, reward_id=reward_one.id),
            models.BattlePassClaim(user_id=1, reward_id=reward_ten.id),
        ])
        db.commit()

    assert client.post(
        "/api/admin/battlepass/reset-level",
        json={"user_id": "1", "level": 1},
        headers=_headers(),
    ).status_code == 422
    response = client.post(
        "/api/admin/battlepass/reset-level",
        json={"user_id": 1, "level": 1},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["deleted_claims"] == 1
    with sessions() as db:
        ubp = db.query(models.UserBattlePass).filter_by(user_id=1).one()
        assert json.loads(ubp.claimed_rewards) == [10, [10, "free"]]
        remaining_levels = {
            claim.reward_id for claim in db.query(models.BattlePassClaim).filter_by(user_id=1).all()
        }
        assert reward_ten.id in remaining_levels
        assert reward_one.id not in remaining_levels


def test_full_reset_clears_all_claim_state_and_xp(battlepass_api):
    client, sessions = battlepass_api
    with sessions() as db:
        first_season = db.query(models.BattlePassSeason).filter_by(is_active=True).one()
        first_reward = db.query(models.BattlePassReward).filter_by(season_id=first_season.id, level=1).one()
        second_season = models.BattlePassSeason(
            name="Архив", xp_per_level=200, total_levels=2, is_active=False,
        )
        db.add(second_season)
        db.flush()
        second_reward = models.BattlePassReward(
            season_id=second_season.id, level=1, track="free", kind="xp", value=5,
        )
        db.add(second_reward)
        db.flush()
        db.add_all([
            models.UserBattlePass(user_id=1, season_id=first_season.id, claimed_rewards="[1]"),
            models.UserBattlePass(user_id=1, season_id=second_season.id, claimed_rewards="[[1, \"free\"]]"),
            models.BattlePassClaim(user_id=1, reward_id=first_reward.id),
            models.BattlePassClaim(user_id=1, reward_id=second_reward.id),
        ])
        db.commit()

    response = client.post("/api/admin/battlepass/reset/1", headers=_headers())
    assert response.status_code == 200
    with sessions() as db:
        assert db.get(models.User, 1).xp == 0
        assert db.query(models.UserBattlePass).filter_by(user_id=1).count() == 0
        assert db.query(models.BattlePassClaim).filter_by(user_id=1).count() == 0
