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
from app.api import quiz
from app.auth import current_user
from app.db import Base, get_db


@pytest.fixture()
def quiz_api(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'quiz.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def test_db():
        with sessions() as db:
            yield db

    def test_user(request: Request, db: Session = Depends(get_db)):
        user = db.get(models.User, int(request.headers.get("X-Test-User", "1")))
        if user is None:
            raise HTTPException(status_code=401, detail="test user missing")
        return user

    app = FastAPI()
    app.include_router(quiz.router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = test_user

    with sessions() as db:
        user = models.User(id=1, telegram_id=101, first_name="Игрок", xp=0)
        db.add(user)
        db.flush()
        db.add(models.Wallet(user_id=user.id, balance=100))
        test = models.Quiz(
            title="Проверка",
            is_active=True,
            prize_kind="coins",
            prize_value=5,
            prize_label="5 ковбаксов",
            threshold_good=1,
            threshold_excellent=2,
            rewards_excellent=json.dumps([
                {"kind": "kovbucks", "amount": 50, "item_id": None},
            ]),
        )
        db.add(test)
        db.flush()
        db.add_all([
            models.QuizQuestion(
                quiz_id=test.id,
                text="Один?",
                option_a="Да",
                option_b="Нет",
                option_c="Возможно",
                option_d="Никогда",
                correct_option="a",
                sort_order=1,
            ),
            models.QuizQuestion(
                quiz_id=test.id,
                text="Два?",
                option_a="Нет",
                option_b="Да",
                option_c="Возможно",
                option_d="Никогда",
                correct_option="b",
                sort_order=2,
            ),
        ])
        db.commit()

    yield TestClient(app), sessions
    engine.dispose()


def _start(client: TestClient) -> dict:
    response = client.post("/api/quiz/1/start", headers={"X-Test-User": "1"})
    assert response.status_code == 200
    return response.json()


def _age_run(sessions, token: str) -> None:
    with sessions() as db:
        run = db.get(models.QuizRun, token)
        run.started_at -= timedelta(seconds=10)
        db.commit()


def _answers(started: dict) -> dict[str, str]:
    return {str(started["questions"][0]["id"]): "a", str(started["questions"][1]["id"]): "b"}


def test_quiz_requires_server_issued_run_and_plausible_time(quiz_api):
    client, sessions = quiz_api
    started = _start(client)
    body = {"quiz_id": 1, "run_token": started["run_token"], "answers": _answers(started)}

    too_fast = client.post("/api/quiz/submit", json=body, headers={"X-Test-User": "1"})
    assert too_fast.status_code == 409
    with sessions() as db:
        assert db.query(models.QuizAttempt).count() == 0
        assert db.get(models.QuizRun, started["run_token"]).consumed_at is None

    _age_run(sessions, started["run_token"])
    completed = client.post("/api/quiz/submit", json=body, headers={"X-Test-User": "1"})
    assert completed.status_code == 200
    assert completed.json()["score"] == 2
    with sessions() as db:
        assert db.query(models.Wallet).filter_by(user_id=1).one().balance == 150


def test_quiz_result_replay_and_parallel_submit_do_not_double_award(quiz_api):
    client, sessions = quiz_api
    started = _start(client)
    _age_run(sessions, started["run_token"])
    body = {"quiz_id": 1, "run_token": started["run_token"], "answers": _answers(started)}

    def submit(_):
        return client.post("/api/quiz/submit", json=body, headers={"X-Test-User": "1"}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(submit, range(2)))
    assert statuses.count(200) == 1
    assert all(status in {200, 400, 409} for status in statuses)
    assert client.post("/api/quiz/submit", json=body, headers={"X-Test-User": "1"}).status_code in {400, 409}
    with sessions() as db:
        assert db.query(models.QuizAttempt).filter_by(user_id=1, quiz_id=1).count() == 1
        assert db.query(models.Wallet).filter_by(user_id=1).one().balance == 150


def test_fixed_percentage_grades_ignore_removed_legacy_thresholds(quiz_api):
    client, sessions = quiz_api
    started = _start(client)
    _age_run(sessions, started["run_token"])
    with sessions() as db:
        configured = db.get(models.Quiz, 1)
        configured.threshold_good = 0
        configured.threshold_excellent = 1
        db.commit()

    response = client.post(
        "/api/quiz/submit",
        json={"quiz_id": 1, "run_token": started["run_token"], "answers": _answers(started)},
        headers={"X-Test-User": "1"},
    )
    assert response.status_code == 200
    with sessions() as db:
        assert db.query(models.QuizAttempt).count() == 1
        assert db.get(models.QuizRun, started["run_token"]).consumed_at is not None
        assert db.get(models.User, 1).xp == 0
        assert db.query(models.Wallet).filter_by(user_id=1).one().balance == 150


def test_item_stack_cap_rejects_reward_without_partial_changes(quiz_api):
    client, sessions = quiz_api
    with sessions() as db:
        configured = db.get(models.Quiz, 1)
        configured.prize_kind = "item"
        configured.prize_value = 1
        configured.prize_item_code = "quiz_reward"
        configured.prize_label = "Наградной предмет"
        item = models.Item(code="quiz_reward", name="Наградной предмет")
        db.add(item)
        db.flush()
        configured.rewards_excellent = json.dumps([
            {"kind": "item", "amount": 1, "item_id": item.id},
        ])
        db.add(models.InventoryItem(user_id=1, item_id=item.id, quantity=quiz.MAX_INVENTORY_QUANTITY))
        db.commit()

    started = _start(client)
    _age_run(sessions, started["run_token"])
    response = client.post(
        "/api/quiz/submit",
        json={"quiz_id": 1, "run_token": started["run_token"], "answers": _answers(started)},
        headers={"X-Test-User": "1"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Достигнут предел количества предмета"

    with sessions() as db:
        item = db.query(models.Item).filter_by(code="quiz_reward").one()
        inventory = db.query(models.InventoryItem).filter_by(user_id=1, item_id=item.id).one()
        assert inventory.quantity == quiz.MAX_INVENTORY_QUANTITY
        assert db.query(models.QuizAttempt).count() == 0
        assert db.get(models.QuizRun, started["run_token"]).consumed_at is None
        assert db.get(models.User, 1).xp == 0
        assert db.query(models.Wallet).filter_by(user_id=1).one().balance == 100
