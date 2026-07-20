from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.api import admin, profile, shop
from app.auth import current_user, require_admin
from app.db import Base, get_db


@pytest.fixture()
def lootbox_api(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'lootboxes.db'}",
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
        user = db.get(models.User, int(request.headers.get("X-Test-User", "1")))
        if user is None or user.id != 2:
            raise HTTPException(403, "admin only")
        return user

    app = FastAPI()
    app.include_router(profile.router)
    app.include_router(shop.router)
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = test_user
    app.dependency_overrides[require_admin] = test_admin

    with sessions() as db:
        normal = models.User(id=1, telegram_id=111, first_name="Игрок", xp=0)
        administrator = models.User(id=2, telegram_id=222, first_name="Админ", xp=0)
        fragment = models.Item(code="box_fragment", name="Фрагмент ковбокса", icon="fragment.svg")
        prize = models.Item(code="prize", name="Предмет-приз", icon="prize.svg")
        db.add_all([normal, administrator, fragment, prize])
        db.flush()
        db.add_all([models.Wallet(user_id=1, balance=100), models.Wallet(user_id=2, balance=100)])
        db.add(models.BattlePassSeason(name="Тест", xp_per_level=100, total_levels=10, is_active=True))
        db.commit()

    yield TestClient(app), sessions
    engine.dispose()


def _headers(user_id=1):
    return {"X-Test-User": str(user_id)}


def _box_payload(
    prize_id: int,
    *,
    code="test",
    kind="item",
    amount=1,
    active=True,
    droppable=True,
    sale_price=None,
):
    return {
        "code": code,
        "name": f"Ковбокс {code}",
        "description": "Тестовая конфигурация",
        "rarity": "Обычный",
        "image_url": "/static/img/items/lootbox_common.svg",
        "is_active": active,
        "is_droppable": droppable,
        "is_archived": False,
        "assembly_weight": 10,
        "sale_price": sale_price,
        "sale_currency": "kovbucks",
        "min_user_level": None,
        "max_user_level": None,
        "sort_order": 0,
        "starts_at": None,
        "ends_at": None,
        "daily_open_limit": 0,
        "guaranteed_slots": 1,
        "allow_duplicates": True,
        "entries": [{
            "reward_kind": kind,
            "item_id": prize_id if kind == "item" else None,
            "amount_min": amount,
            "amount_max": amount,
            "weight": 100,
            "is_guaranteed": False,
            "is_active": True,
            "sort_order": 0,
        }],
    }


def _create_box(client, sessions, **kwargs):
    with sessions() as db:
        prize = db.query(models.Item).filter_by(code="prize").one()
        payload = _box_payload(prize.id, **kwargs)
    response = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))
    assert response.status_code == 200, response.text
    return response.json(), payload


def _grant_box(sessions, item_id: int, quantity=1):
    with sessions() as db:
        db.add(models.InventoryItem(user_id=1, item_id=item_id, quantity=quantity))
        db.commit()


def _quantity(sessions, code: str) -> int:
    with sessions() as db:
        item = db.query(models.Item).filter_by(code=code).one()
        row = db.query(models.InventoryItem).filter_by(user_id=1, item_id=item.id).first()
        return row.quantity if row else 0


def test_item_categories_drive_item_editor_and_public_filters(lootbox_api):
    client, sessions = lootbox_api
    admin_headers = _headers(2)

    category = client.post(
        "/api/admin/item-categories",
        json={"name": "Артефакты", "sort_order": 5},
        headers=admin_headers,
    )
    assert category.status_code == 200, category.text
    category_id = category.json()["id"]
    assert client.post(
        "/api/admin/item-categories",
        json={"name": "артефакты", "sort_order": 0},
        headers=admin_headers,
    ).status_code == 409

    item_payload = {
        "code": "test_artifact",
        "name": "Тестовый артефакт",
        "icon": "/static/img/ui/box.svg",
        "image_url": None,
        "rarity": "Обычный",
        "category": "Артефакты",
        "can_gift": True,
        "can_activate": False,
    }
    created = client.post("/api/admin/items", json=item_payload, headers=admin_headers)
    assert created.status_code == 200, created.text
    item_id = created.json()["id"]

    same_name = client.post("/api/admin/items", json=item_payload, headers=admin_headers)
    assert same_name.status_code == 200, same_name.text
    assert same_name.json()["code"] == "test_artifact-2"
    duplicate_item_id = same_name.json()["id"]

    invalid = dict(item_payload, code="bad_category_item", category="Несуществующая")
    assert client.post("/api/admin/items", json=invalid, headers=admin_headers).status_code == 400

    renamed = client.patch(
        f"/api/admin/item-categories/{category_id}",
        json={"name": "Реликвии", "sort_order": 2},
        headers=admin_headers,
    )
    assert renamed.status_code == 200, renamed.text
    with sessions() as db:
        assert db.get(models.Item, item_id).category == "Реликвии"

    public_categories = client.get("/api/shop/categories", headers=_headers())
    assert public_categories.status_code == 200
    assert any(row["name"] == "Реликвии" for row in public_categories.json())
    assert client.delete(f"/api/admin/item-categories/{category_id}", headers=admin_headers).status_code == 409

    fallback = client.post(
        "/api/admin/item-categories",
        json={"name": "Ресурсы", "sort_order": 0},
        headers=admin_headers,
    )
    assert fallback.status_code == 200, fallback.text
    moved = client.patch(
        f"/api/admin/items/{item_id}",
        json=dict(item_payload, category="Ресурсы"),
        headers=admin_headers,
    )
    assert moved.status_code == 200, moved.text
    moved_duplicate = client.patch(
        f"/api/admin/items/{duplicate_item_id}",
        json=dict(item_payload, code="test_artifact-2", category="Ресурсы"),
        headers=admin_headers,
    )
    assert moved_duplicate.status_code == 200, moved_duplicate.text
    assert client.delete(f"/api/admin/item-categories/{category_id}", headers=admin_headers).status_code == 200


def test_admin_create_and_normal_user_forbidden(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        prize_id = db.query(models.Item).filter_by(code="prize").one().id
    payload = _box_payload(prize_id)
    assert client.post("/api/admin/lootboxes", json=payload, headers=_headers(1)).status_code == 403
    created = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))
    assert created.status_code == 200
    data = created.json()
    assert data["item_code"] == "lootbox_test"
    assert data["entries"][0]["normalized_percent"] == 100.0
    assert client.post("/api/admin/lootboxes", json=payload, headers=_headers(2)).status_code == 409


def test_legacy_lootbox_without_item_is_repaired_in_editor(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        db.add(models.LootboxPool(code="bronze", name="Ковбокс bronze", item_id=None))
        db.commit()
    response = client.get("/api/admin/lootboxes", headers=_headers(2))
    assert response.status_code == 200, response.text
    bronze = next(row for row in response.json() if row["code"] == "bronze")
    assert bronze["item_code"] == "lootbox_bronze"
    with sessions() as db:
        pool = db.query(models.LootboxPool).filter_by(code="bronze").one()
        assert pool.item_id is not None


def test_invalid_weights_and_deleted_item_are_rejected(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        prize_id = db.query(models.Item).filter_by(code="prize").one().id
    bad_weight = _box_payload(prize_id)
    bad_weight["entries"][0]["weight"] = 0
    assert client.post("/api/admin/lootboxes", json=bad_weight, headers=_headers(2)).status_code == 422
    missing = _box_payload(999_999, code="missing")
    response = client.post("/api/admin/lootboxes", json=missing, headers=_headers(2))
    assert response.status_code == 400


def test_sale_settings_create_real_shop_product_and_disable_it(lootbox_api):
    client, sessions = lootbox_api
    box, payload = _create_box(client, sessions, code="for_sale", sale_price=25)
    with sessions() as db:
        product = db.query(models.ShopProduct).filter_by(item_id=box["item_id"]).one()
        product_id = product.id
        assert (product.price, product.stock, product.is_active) == (25, -1, True)

    bought = client.post("/api/shop/buy", json={"product_id": product_id}, headers=_headers())
    assert bought.status_code == 200
    assert bought.json()["balance"] == 75
    assert _quantity(sessions, box["item_code"]) == 1

    payload["sale_price"] = None
    disabled = client.patch(f"/api/admin/lootboxes/{box['id']}", json=payload, headers=_headers(2))
    assert disabled.status_code == 200
    with sessions() as db:
        product = db.get(models.ShopProduct, product_id)
        assert product.is_active is False
    assert all(row["id"] != product_id for row in client.get("/api/shop/products").json())


def test_admin_can_unlist_player_offer_once_and_item_is_returned(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        item = db.query(models.Item).filter_by(code="prize").one()
        listing = models.MarketListing(
            seller_id=1,
            item_id=item.id,
            quantity=3,
            price=17,
            is_active=True,
        )
        db.add(listing)
        db.commit()
        listing_id = listing.id

    assert client.post(f"/api/admin/market/{listing_id}/unlist", headers=_headers(1)).status_code == 403
    first = client.post(f"/api/admin/market/{listing_id}/unlist", headers=_headers(2))
    assert first.status_code == 200, first.text
    assert first.json()["is_active"] is False

    replay = client.post(f"/api/admin/market/{listing_id}/unlist", headers=_headers(2))
    assert replay.status_code == 400
    with sessions() as db:
        stack = db.query(models.InventoryItem).filter_by(user_id=1, item_id=item.id).one()
        assert stack.quantity == 3
        assert db.get(models.MarketListing, listing_id).is_active is False


def test_combined_login_gift_requires_explicit_claim_and_is_delivered_once(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        prize_id = db.query(models.Item.id).filter_by(code="prize").scalar()

    scheduled = client.post(
        "/api/admin/users/1/login-gifts",
        json={"kovbucks": 7, "xp": 11, "item_id": prize_id, "item_quantity": 3},
        headers=_headers(2),
    )
    assert scheduled.status_code == 200, scheduled.text
    assert scheduled.json()["delivered_at"] is None

    preview = client.get("/api/profile/me", headers=_headers(1))
    assert preview.status_code == 200, preview.text
    payload = preview.json()
    assert payload["user"]["balance"] == 100
    assert payload["user"]["xp"] == 0
    assert payload["login_gifts"] == [{
        "id": scheduled.json()["id"],
        "kovbucks": 7,
        "xp": 11,
        "item_id": prize_id,
        "item_name": "Предмет-приз",
        "item_icon": "prize.svg",
        "item_quantity": 3,
        "delivered_at": None,
    }]

    claim = client.post("/api/profile/login-gifts/claim", headers=_headers(1))
    assert claim.status_code == 200, claim.text
    assert claim.json()["user"]["balance"] == 107
    assert claim.json()["user"]["xp"] == 11
    assert len(claim.json()["gifts"]) == 1
    assert claim.json()["gifts"][0]["delivered_at"] is not None

    replay = client.post("/api/profile/login-gifts/claim", headers=_headers(1))
    assert replay.status_code == 200
    assert replay.json()["gifts"] == []
    assert replay.json()["user"]["balance"] == 107
    assert replay.json()["user"]["xp"] == 11
    assert _quantity(sessions, "prize") == 3


def test_empty_login_gift_is_rejected(lootbox_api):
    client, _sessions = lootbox_api
    response = client.post(
        "/api/admin/users/1/login-gifts",
        json={"kovbucks": 0, "xp": 0, "item_id": None, "item_quantity": 0},
        headers=_headers(2),
    )
    assert response.status_code == 422


@pytest.mark.parametrize("sale_price,sale_currency", [(0, "kovbucks"), (10, "kovcoins")])
def test_unsupported_lootbox_sale_config_is_rejected(lootbox_api, sale_price, sale_currency):
    client, sessions = lootbox_api
    with sessions() as db:
        prize_id = db.query(models.Item).filter_by(code="prize").one().id
    payload = _box_payload(prize_id, code=f"bad_sale_{sale_price}")
    payload["sale_price"] = sale_price
    payload["sale_currency"] = sale_currency
    assert client.post("/api/admin/lootboxes", json=payload, headers=_headers(2)).status_code == 422


def test_item_open_is_idempotent_and_one_box_is_consumed(lootbox_api):
    client, sessions = lootbox_api
    box, _ = _create_box(client, sessions)
    _grant_box(sessions, box["item_id"])
    request = {"item_id": box["item_id"], "request_id": "open_item_0001"}
    first = client.post("/api/profile/inventory/open-lootbox", json=request, headers=_headers())
    assert first.status_code == 200
    assert first.json()["replayed"] is False
    assert first.json()["rewards"][0]["kind"] == "item"
    second = client.post("/api/profile/inventory/open-lootbox", json=request, headers=_headers())
    assert second.status_code == 200
    assert second.json()["replayed"] is True
    assert _quantity(sessions, "lootbox_test") == 0
    assert _quantity(sessions, "prize") == 1
    with sessions() as db:
        assert db.query(models.LootboxOpen).count() == 1


def test_parallel_opening_cannot_consume_one_box_twice(lootbox_api):
    client, sessions = lootbox_api
    box, _ = _create_box(client, sessions, code="parallel")
    _grant_box(sessions, box["item_id"])

    def open_box(index):
        return client.post(
            "/api/profile/inventory/open-lootbox",
            json={"item_id": box["item_id"], "request_id": f"parallel_{index:04d}"},
            headers=_headers(),
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(open_box, range(2)))
    assert statuses == [200, 409]
    assert _quantity(sessions, "prize") == 1


@pytest.mark.parametrize("kind", ["kovbucks", "xp", "kovcoins"])
def test_server_grants_each_resource_category(lootbox_api, kind):
    client, sessions = lootbox_api
    box, _ = _create_box(client, sessions, code=f"resource_{kind}", kind=kind, amount=7)
    _grant_box(sessions, box["item_id"])
    response = client.post(
        "/api/profile/inventory/open-lootbox",
        json={"item_id": box["item_id"], "request_id": f"resource_{kind}_01"},
        headers=_headers(),
    )
    assert response.status_code == 200, response.text
    assert response.json()["rewards"][0]["kind"] == kind
    with sessions() as db:
        user = db.get(models.User, 1)
        if kind == "kovbucks":
            assert user.wallet.balance == 107
        elif kind == "xp":
            assert user.xp == 7
        else:
            assert db.query(models.ClickerState).filter_by(user_id=1).one().kovcoins == 7


def test_disabled_box_does_not_consume_inventory(lootbox_api):
    client, sessions = lootbox_api
    box, payload = _create_box(client, sessions, code="disabled")
    payload["is_active"] = False
    updated = client.patch(f"/api/admin/lootboxes/{box['id']}", json=payload, headers=_headers(2))
    assert updated.status_code == 200
    _grant_box(sessions, box["item_id"])
    response = client.post(
        "/api/profile/inventory/open-lootbox",
        json={"item_id": box["item_id"], "request_id": "disabled_0001"},
        headers=_headers(),
    )
    assert response.status_code == 409
    assert _quantity(sessions, "lootbox_disabled") == 1


def test_fragment_assembly_cost_insufficient_and_parallel(lootbox_api):
    client, sessions = lootbox_api
    box, _ = _create_box(client, sessions, code="assembly")
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        db.add(models.InventoryItem(user_id=1, item_id=fragment.id, quantity=19))
        db.commit()
    assert client.get("/api/profile/me", headers=_headers()).json()["fragment_assembly_cost"] == 10
    first = client.post("/api/profile/inventory/assemble-fragments", headers=_headers())
    assert first.status_code == 200
    assert first.json()["remaining_fragments"] == 9
    assert client.post("/api/profile/inventory/assemble-fragments", headers=_headers()).status_code == 400
    assert _quantity(sessions, box["item_code"]) == 1

    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        db.query(models.InventoryItem).filter_by(user_id=1, item_id=fragment.id).one().quantity = 20
        db.commit()
    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(
            lambda _: client.post("/api/profile/inventory/assemble-fragments", headers=_headers()).status_code,
            range(2),
        ))
    assert statuses == [200, 200]
    assert _quantity(sessions, "box_fragment") == 0
    assert _quantity(sessions, box["item_code"]) == 3


def test_same_open_request_is_parallel_idempotent(lootbox_api):
    client, sessions = lootbox_api
    box, _ = _create_box(client, sessions, code="same_request")
    _grant_box(sessions, box["item_id"])
    payload = {"item_id": box["item_id"], "request_id": "same_request_0001"}
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(
            lambda _: client.post("/api/profile/inventory/open-lootbox", json=payload, headers=_headers()),
            range(2),
        ))
    assert [response.status_code for response in responses] == [200, 200]
    assert sorted(response.json()["replayed"] for response in responses) == [False, True]
    assert _quantity(sessions, "prize") == 1
