from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.api import admin
from app.auth import require_admin
from app.db import Base, get_db


@pytest.fixture()
def task_api(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'tasks.db'}",
        connect_args={"check_same_thread": False},
    )
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def test_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    def test_admin(request: Request, db: Session = Depends(get_db)):
        user = db.get(models.User, 2)
        if user is None:
            raise HTTPException(403)
        return user

    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[require_admin] = test_admin

    with sessions() as db:
        player = models.User(id=1, telegram_id=101, first_name="Игрок", xp=0)
        administrator = models.User(id=2, telegram_id=202, first_name="Админ", xp=0)
        fragment = models.Item(code="box_fragment", name="Фрагмент ковбокса", icon="fragment.svg")
        db.add_all([player, administrator, fragment])
        db.flush()
        db.add_all([models.Wallet(user_id=1, balance=0), models.Wallet(user_id=2, balance=0)])
        db.commit()

    yield TestClient(app), sessions
    engine.dispose()


def test_task_can_grant_kovbucks_xp_and_item_atomically(task_api):
    client, sessions = task_api
    with sessions() as db:
        item_id = db.query(models.Item.id).filter_by(code="box_fragment").scalar()

    created = client.post("/api/admin/tasks", json={
        "name": "Комбинированная награда",
        "description": "",
        "reward": 7,
        "xp_reward": 11,
        "reward_item_id": item_id,
        "reward_item_quantity": 3,
        "target_progress": 1,
        "is_active": True,
        "is_daily_plan": False,
        "sort_order": 0,
    })
    assert created.status_code == 200
    assert created.json()["reward_item_name"] == "Фрагмент ковбокса"

    with sessions() as db:
        user_task = models.UserTask(user_id=1, task_id=created.json()["id"], status="in_progress")
        db.add(user_task)
        db.commit()
        user_task_id = user_task.id

    approved = client.post(f"/api/admin/tasks/user/{user_task_id}/approve")
    assert approved.status_code == 200
    with sessions() as db:
        assert db.query(models.Wallet).filter_by(user_id=1).one().balance == 7
        assert db.get(models.User, 1).xp == 11
        stack = db.query(models.InventoryItem).filter_by(user_id=1, item_id=item_id).one()
        assert stack.quantity == 3
        assert db.get(models.UserTask, user_task_id).status == "done"


def test_task_reward_configuration_rejects_incomplete_item_and_empty_reward(task_api):
    client, _sessions = task_api
    base = {
        "name": "Неверное задание",
        "description": "",
        "reward": 0,
        "xp_reward": 0,
        "target_progress": 1,
        "is_active": True,
        "is_daily_plan": False,
        "sort_order": 0,
    }
    assert client.post("/api/admin/tasks", json=base).status_code == 422
    assert client.post("/api/admin/tasks", json={
        **base,
        "reward_item_id": 1,
        "reward_item_quantity": 0,
    }).status_code == 422


def test_wheel_uses_direct_percentages_and_rejects_total_above_100(task_api):
    client, _sessions = task_api
    first = {
        "label": "70 ковбаксов",
        "kind": "coins",
        "value": 70,
        "item_code": None,
        "icon": "/coin.svg",
        "weight": 70,
        "sort_order": 0,
        "is_active": True,
    }
    assert client.post("/api/admin/wheel", json=first).status_code == 200
    too_much = {**first, "label": "Ещё 31", "weight": 31}
    rejected = client.post("/api/admin/wheel", json=too_much)
    assert rejected.status_code == 400
    assert "100%" in rejected.json()["detail"]
    assert client.post("/api/admin/wheel", json={**first, "label": "Остальные 30", "weight": 30}).status_code == 200
    assert client.post("/api/admin/wheel", json={**first, "label": "101", "weight": 101}).status_code == 422
