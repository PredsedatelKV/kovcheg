from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.api import game
from app.auth import current_user
from app.db import Base, get_db


@pytest.fixture()
def multiplayer_api(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'multiplayer.db'}",
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

    app = FastAPI()
    app.include_router(game.router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = test_user

    with sessions() as db:
        db.add_all([
            models.User(id=1, telegram_id=101, first_name="Первый"),
            models.User(id=2, telegram_id=102, first_name="Второй"),
            models.User(id=3, telegram_id=103, first_name="Посторонний"),
        ])
        db.commit()

    yield TestClient(app), sessions
    engine.dispose()


def _headers(user_id: int) -> dict[str, str]:
    return {"X-Test-User": str(user_id)}


def _invite(client: TestClient, game_name: str = "pingpong") -> int:
    response = client.post(
        "/api/game/invite",
        json={"game": game_name, "to_user_id": 2},
        headers=_headers(1),
    )
    assert response.status_code == 200
    return response.json()["id"]


def test_unknown_game_cannot_be_invited(multiplayer_api):
    client, _ = multiplayer_api
    response = client.post(
        "/api/game/invite",
        json={"game": "pingpong-copy", "to_user_id": 2},
        headers=_headers(1),
    )
    assert response.status_code == 400


def test_legacy_session_create_requires_owner_and_accepted_invite(multiplayer_api):
    client, _ = multiplayer_api
    invite_id = _invite(client)
    assert client.post(
        "/api/game/session/create", json={"invite_id": invite_id}, headers=_headers(3),
    ).status_code == 403
    assert client.post(
        "/api/game/session/create", json={"invite_id": invite_id}, headers=_headers(1),
    ).status_code == 400


def test_parallel_accept_creates_one_session(multiplayer_api):
    client, sessions = multiplayer_api
    invite_id = _invite(client)

    def accept(_):
        return client.post(
            "/api/game/accept", json={"invite_id": invite_id}, headers=_headers(2),
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(accept, range(2)))
    assert statuses.count(200) == 1
    with sessions() as db:
        assert db.query(models.GameSession).filter_by(invite_id=invite_id).count() == 1


def test_pong_rejects_score_jump_and_invalid_coordinates(multiplayer_api):
    client, _ = multiplayer_api
    invite_id = _invite(client)
    accepted = client.post(
        "/api/game/accept", json={"invite_id": invite_id}, headers=_headers(2),
    )
    session_id = accepted.json()["session_id"]
    bad_score = client.post(
        f"/api/game/session/{session_id}/pong",
        json={"ball": {"x": 0.5, "y": 0.5, "vx": 0.01, "vy": 0.01}, "px": 0.5, "sx": 5, "so": 0},
        headers=_headers(1),
    )
    assert bad_score.status_code == 400
    bad_paddle = client.post(
        f"/api/game/session/{session_id}/pong",
        json={"po": 5},
        headers=_headers(2),
    )
    assert bad_paddle.status_code == 400
