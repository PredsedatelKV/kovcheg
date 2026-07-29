from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app import idempotency, models
from app import main as main_module
from app import seed as seed_module
from app.db import Base


@pytest.fixture()
def guarded_api(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'receipts.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(idempotency, "SessionLocal", sessions)

    calls = {
        "ok": 0,
        "bad": 0,
        "created": 0,
        "large": 0,
        "slow": 0,
        "uncertain": 0,
        "slow_entered": Event(),
        "slow_release": Event(),
    }
    app = FastAPI()
    app.middleware("http")(idempotency.protect_game_mutation)

    @app.post("/api/tasks/claim")
    def claim():
        calls["ok"] += 1
        return {"ok": True}

    @app.post("/api/tasks/bad")
    def bad():
        calls["bad"] += 1
        return JSONResponse({"detail": "bad"}, status_code=400)

    @app.post("/api/tasks/created")
    def created():
        calls["created"] += 1
        return Response(
            content=b'{"token":"durable-outcome"}',
            status_code=201,
            media_type="application/vnd.kovcheg.result+json",
        )

    @app.post("/api/tasks/large")
    def large():
        calls["large"] += 1
        return Response(content=b"x" * 17, media_type="application/octet-stream")

    @app.post("/api/tasks/slow")
    def slow():
        calls["slow"] += 1
        calls["slow_entered"].set()
        calls["slow_release"].wait(timeout=5)
        return {"ok": True, "outcome": "once"}

    @app.post("/api/tasks/uncertain")
    def uncertain():
        calls["uncertain"] += 1
        raise RuntimeError("response lost after an uncertain endpoint outcome")

    yield TestClient(app, raise_server_exceptions=False), calls, sessions
    engine.dispose()


def _headers(key: str) -> dict[str, str]:
    return {"X-Idempotency-Key": key, "X-Telegram-Init-Data": "signed-user-scope"}


def test_emergency_freeze_still_blocks_everyone_except_bound_omar(guarded_api, monkeypatch):
    client, calls, _ = guarded_api
    monkeypatch.setenv("EMERGENCY_ECONOMY_FREEZE", "1")

    monkeypatch.setattr(idempotency, "_authenticated_telegram_id", lambda request: 7735808918)
    blocked = client.post("/api/tasks/claim")
    assert blocked.status_code == 423
    assert calls["ok"] == 0

    monkeypatch.setattr(idempotency, "_authenticated_telegram_id", lambda request: 849162365)
    allowed = client.post(
        "/api/tasks/claim",
        headers=_headers("01010101-0101-4101-8101-010101010101"),
    )
    assert allowed.status_code == 200
    assert calls["ok"] == 1


def test_critical_mutation_requires_key_and_success_is_replayed(guarded_api):
    client, calls, sessions = guarded_api
    assert client.post("/api/tasks/claim").status_code == 400
    headers = _headers("11111111-1111-4111-8111-111111111111")
    first = client.post("/api/tasks/claim", headers=headers)
    replay = client.post("/api/tasks/claim", headers=headers)
    assert first.status_code == replay.status_code == 200
    assert first.content == replay.content == b'{"ok":true}'
    assert first.headers["content-type"] == replay.headers["content-type"] == "application/json"
    assert calls["ok"] == 1
    with sessions() as db:
        receipt = db.query(models.IdempotencyReceipt).one()
        assert receipt.status == "completed"
        assert receipt.response_status == 200
        assert receipt.response_body == b'{"ok":true}'
        assert receipt.response_content_type == "application/json"


def test_lost_response_retry_restores_status_body_and_content_type(guarded_api):
    client, calls, _ = guarded_api
    headers = _headers("12121212-1212-4212-8212-121212121212")

    # Treat the first response as lost after the endpoint committed. The same
    # client key must recover its outcome without entering the endpoint again.
    client.post("/api/tasks/created", headers=headers)
    recovered = client.post("/api/tasks/created", headers=headers)

    assert recovered.status_code == 201
    assert recovered.content == b'{"token":"durable-outcome"}'
    assert recovered.headers["content-type"] == "application/vnd.kovcheg.result+json"
    assert calls["created"] == 1


def test_same_client_key_is_isolated_by_path_and_auth_scope(guarded_api):
    client, calls, _ = guarded_api
    key = "13131313-1313-4313-8313-131313131313"
    first_scope = _headers(key)
    other_scope = {**first_scope, "X-Telegram-Init-Data": "another-signed-user-scope"}

    assert client.post("/api/tasks/claim", headers=first_scope).status_code == 200
    assert client.post("/api/tasks/claim", headers=other_scope).status_code == 200
    assert client.post("/api/tasks/created", headers=first_scope).status_code == 201
    assert calls["ok"] == 2
    assert calls["created"] == 1


def test_parallel_mutation_enters_endpoint_once(guarded_api):
    client, calls, _ = guarded_api
    headers = _headers("22222222-2222-4222-8222-222222222222")
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.post, "/api/tasks/slow", headers=headers)
        assert calls["slow_entered"].wait(timeout=2)
        concurrent = pool.submit(client.post, "/api/tasks/slow", headers=headers).result(timeout=2)
        assert concurrent.status_code == 409
        calls["slow_release"].set()
        assert first.result(timeout=2).status_code == 200

    replay = client.post("/api/tasks/slow", headers=headers)
    assert replay.status_code == 200
    assert replay.json() == {"ok": True, "outcome": "once"}
    assert calls["slow"] == 1


def test_failed_request_keeps_receipt_and_corrected_action_uses_new_key(guarded_api):
    client, calls, sessions = guarded_api
    headers = _headers("33333333-3333-4333-8333-333333333333")
    assert client.post("/api/tasks/bad", headers=headers).status_code == 400
    assert client.post("/api/tasks/bad", headers=headers).status_code == 409
    corrected_headers = _headers("44444444-4444-4444-8444-444444444444")
    assert client.post("/api/tasks/bad", headers=corrected_headers).status_code == 400
    assert calls["bad"] == 2
    with sessions() as db:
        assert db.query(models.IdempotencyReceipt).filter_by(status="failed").count() == 2


def test_uncertain_server_failure_is_never_reexecuted(guarded_api):
    client, calls, sessions = guarded_api
    headers = _headers("43434343-4343-4343-8343-434343434343")

    assert client.post("/api/tasks/uncertain", headers=headers).status_code == 500
    assert client.post("/api/tasks/uncertain", headers=headers).status_code == 409
    assert calls["uncertain"] == 1
    with sessions() as db:
        receipt = db.query(models.IdempotencyReceipt).one()
        assert receipt.status == "failed"
        assert receipt.response_body is None


def test_oversized_success_is_guarded_but_not_stored_or_reexecuted(guarded_api, monkeypatch):
    client, calls, sessions = guarded_api
    monkeypatch.setattr(idempotency, "MAX_STORED_RESPONSE_BYTES", 16)
    headers = _headers("45454545-4545-4545-8545-454545454545")

    first = client.post("/api/tasks/large", headers=headers)
    replay = client.post("/api/tasks/large", headers=headers)

    assert first.status_code == 200
    assert first.content == b"x" * 17
    assert replay.status_code == 409
    assert calls["large"] == 1
    with sessions() as db:
        receipt = db.query(models.IdempotencyReceipt).one()
        assert receipt.status == "unreplayable"
        assert receipt.response_body is None


def test_idempotency_response_columns_are_migrated_for_existing_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE idempotency_receipts"))
        conn.execute(text("""
            CREATE TABLE idempotency_receipts (
                key VARCHAR(128) NOT NULL PRIMARY KEY,
                method VARCHAR(8) NOT NULL,
                path VARCHAR(256) NOT NULL,
                status VARCHAR(16) NOT NULL,
                created_at DATETIME NOT NULL,
                completed_at DATETIME
            )
        """))

    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        seed_module.migrate_schema(db)
        columns = {row[1] for row in db.execute(text("PRAGMA table_info(idempotency_receipts)"))}
    assert {"response_status", "response_body", "response_content_type"} <= columns
    engine.dispose()


def test_telegram_update_is_processed_once(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'telegram.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(main_module, "SessionLocal", sessions)
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(telegram_webhook_secret="test-secret"),
    )
    processed: list[int] = []

    async def fake_feed(payload):
        processed.append(payload["update_id"])

    monkeypatch.setattr(main_module, "feed_update", fake_feed)
    app = FastAPI()
    app.add_api_route(
        "/telegram/webhook/{secret}",
        main_module.telegram_webhook,
        methods=["POST"],
    )
    client = TestClient(app)

    payload = {"update_id": 987654, "message": {"text": "/coins 5"}}
    assert client.post("/telegram/webhook/test-secret", json=payload).status_code == 200
    duplicate = client.post("/telegram/webhook/test-secret", json=payload)
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    assert processed == [987654]
    with sessions() as db:
        receipt = db.get(models.TelegramUpdateReceipt, 987654)
        assert receipt.status == "completed"
    engine.dispose()


def test_failed_telegram_update_is_not_replayed(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'telegram-failed.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(main_module, "SessionLocal", sessions)
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(telegram_webhook_secret="test-secret"),
    )
    calls = 0

    async def failing_feed(_payload):
        nonlocal calls
        calls += 1
        raise RuntimeError("confirmation failed after an uncertain handler outcome")

    monkeypatch.setattr(main_module, "feed_update", failing_feed)
    app = FastAPI()
    app.add_api_route("/telegram/webhook/{secret}", main_module.telegram_webhook, methods=["POST"])
    client = TestClient(app, raise_server_exceptions=False)
    payload = {"update_id": 123456, "message": {"text": "/coins 5"}}

    assert client.post("/telegram/webhook/test-secret", json=payload).status_code == 500
    assert client.post("/telegram/webhook/test-secret", json=payload).json()["duplicate"] is True
    assert calls == 1
    with sessions() as db:
        assert db.get(models.TelegramUpdateReceipt, 123456).status == "failed"
    engine.dispose()
