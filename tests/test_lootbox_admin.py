from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.api import admin, profile, shop
from app.auth import current_user, require_admin
from app.db import Base, get_db
from app.seed import migrate_schema, seed


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
        prize = models.Item(
            code="prize", name="Предмет-приз", icon="prize.svg",
            skin_slot="body",
        )
        db.add_all([normal, administrator, fragment, prize])
        db.flush()
        db.add_all([models.Wallet(user_id=1, balance=100), models.Wallet(user_id=2, balance=100)])
        db.add(models.ShopProduct(item_id=prize.id, price=10, stock=-1, is_active=True))
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


def _chest_payload(fragment_id: int, prize_id: int, *, code="chest", bonus_item_chance=100):
    payload = _box_payload(prize_id, code=code)
    payload.update({
        "opening_mode": "chest_v2",
        "open_image_url": f"/static/img/items/{code}_open.svg",
        "bonus_item_chance": bonus_item_chance,
        "guaranteed_slots": 3,
        "allow_duplicates": False,
        "entries": [
            {
                "reward_kind": "item", "item_id": fragment_id,
                "amount_min": 1, "amount_max": 1, "weight": 100,
                "is_guaranteed": True, "is_active": True, "sort_order": 0,
            },
            {
                "reward_kind": "xp", "item_id": None,
                "amount_min": 5, "amount_max": 5, "weight": 100,
                "is_guaranteed": True, "is_active": True, "sort_order": 1,
            },
            {
                "reward_kind": "kovbucks", "item_id": None,
                "amount_min": 4, "amount_max": 4, "weight": 100,
                "is_guaranteed": True, "is_active": True, "sort_order": 2,
            },
            {
                "reward_kind": "item", "item_id": prize_id,
                "amount_min": 1, "amount_max": 1, "weight": 100,
                "is_guaranteed": False, "is_active": True, "sort_order": 3,
            },
        ],
    })
    return payload


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


def test_chest_v2_contract_is_validated_by_server(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        prize = db.query(models.Item).filter_by(code="prize").one()
        payload = _chest_payload(fragment.id, prize.id, code="invalid_chest")
    payload["bonus_item_chance"] = 80
    payload["special_item_chance"] = 30
    response = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))
    assert response.status_code == 422


def test_chest_v2_can_have_only_guaranteed_rewards_when_bonus_is_disabled(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        prize = db.query(models.Item).filter_by(code="prize").one()
        payload = _chest_payload(fragment.id, prize.id, code="guaranteed_only", bonus_item_chance=0)
    payload["entries"] = [entry for entry in payload["entries"] if entry["is_guaranteed"]]

    response = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))

    assert response.status_code == 200, response.text
    assert response.json()["weight_total"] == 0


def test_sold_out_lootbox_prize_is_replaced_with_available_shop_item(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        prize = db.query(models.Item).filter_by(code="prize").one()
        fallback = models.Item(
            code="fallback_prize", name="Запасной приз", icon="fallback.svg",
            skin_slot="body",
        )
        db.add(fallback)
        db.flush()
        db.query(models.ShopProduct).filter_by(item_id=prize.id).one().stock = 0
        db.add(models.ShopProduct(item_id=fallback.id, price=10, stock=2, is_active=True))
        payload = _box_payload(prize.id, code="fallback_chest")
        payload.update({
            "opening_mode": "chest_v2",
            "open_image_url": "/static/img/items/fallback_chest_open.svg",
            "bonus_item_chance": 0,
            "guaranteed_slots": 1,
            "allow_duplicates": False,
        })
        db.commit()
    created = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2)).json()
    _grant_box(sessions, created["item_id"])
    opened = client.post(
        "/api/profile/inventory/open-lootbox",
        json={"item_id": created["item_id"], "request_id": "fallback_chest_0001"},
        headers=_headers(),
    )
    assert opened.status_code == 200, opened.text
    item_codes = [reward["item"]["code"] for reward in opened.json()["rewards"] if reward["item"]]
    assert "fallback_prize" in item_codes
    assert "prize" not in item_codes


def test_chest_global_special_pool_and_limited_player_stock(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        prize = models.Item(
            code="special_prize",
            name="Особый приз",
            icon="special.svg",
            lootbox_reward_tier="special",
        )
        ibrahim = models.User(id=3, telegram_id=7_735_808_918, first_name="Ибрагим", xp=0)
        db.add_all([prize, ibrahim])
        db.flush()
        db.add_all([
            models.Wallet(user_id=3, balance=0),
            models.ShopProduct(item_id=prize.id, price=50, stock=2, is_active=True),
        ])
        payload = _chest_payload(
            fragment.id,
            prize.id,
            code="special_pool_chest",
            bonus_item_chance=0,
        )
        payload["special_item_chance"] = 100
        payload["rarity"] = "Легендарный"
        payload["entries"] = [entry for entry in payload["entries"] if entry["is_guaranteed"]]
        db.commit()

    created = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))
    assert created.status_code == 200, created.text
    box = created.json()
    with sessions() as db:
        db.add(models.InventoryItem(user_id=3, item_id=box["item_id"], quantity=1))
        db.commit()

    opened = client.post(
        "/api/profile/inventory/open-lootbox",
        json={"item_id": box["item_id"], "request_id": "special_pool_0001"},
        headers=_headers(3),
    )
    assert opened.status_code == 200, opened.text
    assert any(
        reward["item"] and reward["item"]["code"] == "special_prize"
        for reward in opened.json()["rewards"]
    )
    with sessions() as db:
        product = (
            db.query(models.ShopProduct)
            .join(models.Item)
            .filter(models.Item.code == "special_prize")
            .one()
        )
        assert product.stock == 1


def test_chest_v2_returns_ordered_presentation_and_stable_replay(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        prize = db.query(models.Item).filter_by(code="prize").one()
        payload = _chest_payload(fragment.id, prize.id, code="ordered_chest")
    created = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))
    assert created.status_code == 200, created.text
    box = created.json()
    _grant_box(sessions, box["item_id"])
    request = {"item_id": box["item_id"], "request_id": "ordered_chest_0001"}

    first = client.post("/api/profile/inventory/open-lootbox", json=request, headers=_headers())
    assert first.status_code == 200, first.text
    result = first.json()
    assert result["pool"] == {
        "code": "ordered_chest",
        "name": "Ковбокс ordered_chest",
        "rarity": "Обычный",
        "image_url": "/static/img/items/lootbox_common.svg",
        "open_image_url": "/static/img/items/ordered_chest_open.svg",
    }
    assert len(result["rewards"]) == 1
    assert result["opening_mode"] == "chest_v2"
    assert len(result["star_sequence"]) == 3
    assert result["rewards"][0]["reveal_order"] == 0

    with sessions() as db:
        pool = db.query(models.LootboxPool).filter_by(code="ordered_chest").one()
        pool.name = "Новое имя после открытия"
        pool.open_image_url = "new-open.svg"
        prize = db.query(models.Item).filter_by(code="prize").one()
        prize.name = "Новое имя приза"
        prize.icon = "new-prize.svg"
        db.commit()

    replay = client.post("/api/profile/inventory/open-lootbox", json=request, headers=_headers())
    assert replay.status_code == 200, replay.text
    replayed = replay.json()
    assert replayed["replayed"] is True
    assert replayed["pool"] == result["pool"]
    assert [reward["label"] for reward in replayed["rewards"]] == [
        reward["label"] for reward in result["rewards"]
    ]
    assert [reward["icon"] for reward in replayed["rewards"]] == [
        reward["icon"] for reward in result["rewards"]
    ]


def test_chest_v2_reports_actual_xp_and_overflow_kovbucks(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        fragment = db.query(models.Item).filter_by(code="box_fragment").one()
        prize = db.query(models.Item).filter_by(code="prize").one()
        payload = _box_payload(
            prize.id, code="xp_overflow_chest", kind="xp", amount=25,
        )
        payload.update({
            "opening_mode": "chest_v2",
            "open_image_url": "/static/img/items/xp_overflow_chest_open.svg",
            "bonus_item_chance": 0,
            "guaranteed_slots": 1,
            "allow_duplicates": False,
        })
        db.get(models.User, 1).level = 100
        db.get(models.User, 1).xp = 0
        db.commit()
    created = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))
    assert created.status_code == 200, created.text
    box = created.json()
    _grant_box(sessions, box["item_id"])

    response = client.post(
        "/api/profile/inventory/open-lootbox",
        json={"item_id": box["item_id"], "request_id": "xp_overflow_0001"},
        headers=_headers(),
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert [reward["presentation_kind"] for reward in result["rewards"]] == ["kovbucks"]
    assert [reward["amount"] for reward in result["rewards"]] == [20]
    assert result["xp"] == 0
    assert result["balance"] == 120
    assert _quantity(sessions, "prize") == 0


def test_seed_migrates_to_four_canonical_chests_once_and_preserves_admin_edits(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        seed(db)
        canonical = {
            pool.code: pool
            for pool in db.query(models.LootboxPool).filter(
                models.LootboxPool.code.in_((
                    "common", "rare", "epic", "legendary", "seasonal", "mega", "consolation",
                ))
            )
        }
        assert set(canonical) == {
            "common", "rare", "epic", "legendary", "seasonal", "mega", "consolation",
        }
        expected = {
            "common": ("Бронзовый ковбокс", 100),
            "rare": ("Серебряный ковбокс", 150),
            "epic": ("Золотой ковбокс", 250),
            "seasonal": ("Сезонный ковбокс", 450),
        }
        for code, (name, price) in expected.items():
            pool = canonical[code]
            assert pool.name == name
            assert pool.sale_price == price
            assert pool.opening_mode == "chest_v2"
            assert pool.open_image_url == f"/static/img/items/lootbox_{code}.png"
            assert {entry.reward_kind for entry in pool.entries} == {"item", "xp"}
            assert next(entry for entry in pool.entries if entry.reward_kind == "item").item.code == "box_fragment"
        for code in ("legendary", "mega"):
            assert canonical[code].is_active is False
            assert canonical[code].is_archived is True
            assert canonical[code].sale_price is None
        assert canonical["consolation"].is_active is True
        assert canonical["consolation"].is_archived is False
        assert canonical["consolation"].sale_price is None

        common = canonical["common"]
        common.name = "Настроенный администратором"
        common.sale_price = 777
        common.is_active = False
        common.bonus_item_chance = 88
        common.open_image_url = "/static/img/items/admin-custom-open.svg"
        common.item.name = "Кастомный предмет ковбокса"
        common.item.icon = "/static/img/items/admin-custom-closed.svg"
        xp_entry = next(entry for entry in common.entries if entry.reward_kind == "xp")
        xp_entry.amount_min = xp_entry.amount_max = 333
        db.commit()

    with sessions() as db:
        seed(db)
        common = db.query(models.LootboxPool).filter_by(code="common").one()
        assert common.name == "Настроенный администратором"
        assert common.sale_price == 777
        assert common.is_active is False
        assert common.bonus_item_chance == 88
        assert common.open_image_url == "/static/img/items/admin-custom-open.svg"
        assert common.item.name == "Кастомный предмет ковбокса"
        assert common.item.icon == "/static/img/items/admin-custom-closed.svg"
        xp_entry = next(entry for entry in common.entries if entry.reward_kind == "xp")
        assert (xp_entry.amount_min, xp_entry.amount_max) == (333, 333)

    common_body = next(
        row for row in client.get("/api/admin/lootboxes", headers=_headers(2)).json()
        if row["code"] == "common"
    )
    common_body["opening_mode"] = "legacy_v1"
    downgrade = client.patch(
        f"/api/admin/lootboxes/{common_body['id']}",
        json=common_body,
        headers=_headers(2),
    )
    assert downgrade.status_code == 400


def test_chest_and_clicker_columns_migrate_existing_sqlite_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'lootbox-migration.db'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add(models.User(id=1, telegram_id=1, first_name="Игрок", xp=0))
        db.add(models.Item(id=1, code="box_fragment", name="Фрагмент", icon="fragment.svg"))
        db.commit()
    with engine.begin() as connection:
        for table in (
            "lootbox_open_rewards", "lootbox_opens", "lootbox_pool_entries",
            "lootbox_pools", "clicker_states",
        ):
            connection.execute(text(f"DROP TABLE {table}"))
        connection.execute(text("""
            CREATE TABLE lootbox_pools (
                id INTEGER PRIMARY KEY, code VARCHAR(64) NOT NULL, name VARCHAR(128) NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE lootbox_pool_entries (
                id INTEGER PRIMARY KEY, pool_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
                weight INTEGER NOT NULL DEFAULT 10
            )
        """))
        connection.execute(text("""
            CREATE TABLE lootbox_opens (
                id INTEGER PRIMARY KEY, request_id VARCHAR(64) NOT NULL, user_id INTEGER NOT NULL,
                lootbox_item_id INTEGER NOT NULL, pool_id INTEGER NOT NULL,
                pool_version INTEGER NOT NULL, created_at DATETIME NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE lootbox_open_rewards (
                id INTEGER PRIMARY KEY, opening_id INTEGER NOT NULL, reward_kind VARCHAR(16) NOT NULL,
                item_id INTEGER, amount INTEGER NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE clicker_states (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE
            )
        """))
        connection.execute(text("INSERT INTO lootbox_pools (id, code, name) VALUES (1, 'old', 'Старый')"))
        connection.execute(text(
            "INSERT INTO lootbox_pool_entries (id, pool_id, item_id, weight) VALUES (1, 1, 1, 100)"
        ))
        connection.execute(text(
            "INSERT INTO lootbox_opens "
            "(id, request_id, user_id, lootbox_item_id, pool_id, pool_version, created_at) "
            "VALUES (1, 'old_open_1', 1, 1, 1, 1, CURRENT_TIMESTAMP)"
        ))
        connection.execute(text(
            "INSERT INTO lootbox_open_rewards (id, opening_id, reward_kind, item_id, amount) "
            "VALUES (1, 1, 'item', 1, 2), (2, 1, 'xp', NULL, 5)"
        ))
        connection.execute(text("INSERT INTO clicker_states (id, user_id) VALUES (1, 1)"))

    with sessions() as db:
        migrate_schema(db)
        pool_columns = {row[1] for row in db.execute(text("PRAGMA table_info(lootbox_pools)"))}
        assert {"opening_mode", "open_image_url", "bonus_item_chance"} <= pool_columns
        entry_columns = {row[1] for row in db.execute(text("PRAGMA table_info(lootbox_pool_entries)"))}
        assert {"reward_kind", "amount_min", "amount_max", "is_guaranteed"} <= entry_columns
        opening = db.execute(text(
            "SELECT pool_code_snapshot, pool_name_snapshot, pool_rarity_snapshot "
            "FROM lootbox_opens WHERE id = 1"
        )).one()
        assert tuple(opening) == ("old", "Старый", "Обычный")
        rewards = db.execute(text(
            "SELECT reveal_order, presentation_kind FROM lootbox_open_rewards ORDER BY id"
        )).all()
        assert [tuple(row) for row in rewards] == [(0, "fragment"), (1, "xp")]
        clicker_columns = {row[1] for row in db.execute(text("PRAGMA table_info(clicker_states)"))}
        assert {
            "progression_day", "progression_date", "passive_fraction",
            "tap_fraction", "passive_earned_today",
        } <= clicker_columns
    engine.dispose()


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
    assert len(first.json()["rewards"]) == 1
    assert first.json()["opening_mode"] == "chest_v2"
    assert first.json()["starting_stars"] == 1
    assert len(first.json()["star_sequence"]) == 3
    assert all(1 <= value <= 4 for value in first.json()["star_sequence"])
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


@pytest.mark.parametrize(
    ("code", "stars"),
    [("common", 1), ("rare", 2), ("epic", 3), ("seasonal", 4)],
)
def test_four_canonical_boxes_have_expected_starting_stars(code, stars):
    pool = models.LootboxPool(code=code, name=code, rarity=code)
    starting, sequence = profile._roll_lootbox_stars(pool)
    assert starting == stars
    assert len(sequence) == 3
    assert all(stars <= value <= 4 for value in sequence)


def test_fragment_assembly_uses_exact_current_box_probabilities():
    assert profile.FRAGMENT_ASSEMBLY_WEIGHTS == {
        "common": 50,
        "rare": 30,
        "epic": 15,
        "seasonal": 5,
    }
    assert sum(profile.FRAGMENT_ASSEMBLY_WEIGHTS.values()) == 100


def test_fragment_assembly_cost_insufficient_and_parallel(lootbox_api):
    client, sessions = lootbox_api
    box, _ = _create_box(client, sessions, code="assembly")
    with sessions() as db:
        pool = db.query(models.LootboxPool).filter_by(id=box["id"]).one()
        pool.code = "common"
        pool.item.lootbox_pool_code = "common"
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


def test_canonical_editor_persists_star_ranges_chances_and_price(lootbox_api):
    client, sessions = lootbox_api
    with sessions() as db:
        prize_id = db.query(models.Item).filter_by(code="prize").one().id
        fragment_id = db.query(models.Item).filter_by(code="box_fragment").one().id
    payload = _box_payload(prize_id, code="common", sale_price=100)
    payload.update({
        "opening_mode": "chest_v2",
        "star1_xp_min": 6,
        "star1_xp_max": 9,
        "star1_fragment_min": 1,
        "star1_fragment_max": 2,
        "star2_xp_min": 14,
        "star2_xp_max": 20,
        "star2_fragment_min": 2,
        "star2_fragment_max": 4,
        "star1_upgrade_chance": 61,
        "star2_upgrade_chance": 17,
        "star3_upgrade_chance": 3,
    })
    created = client.post("/api/admin/lootboxes", json=payload, headers=_headers(2))
    assert created.status_code == 200, created.text
    data = created.json()
    assert data["sale_price"] == 100
    assert data["star1_xp_min"] == 6
    assert data["star1_xp_max"] == 9
    assert data["star2_fragment_min"] == 2
    assert data["star2_fragment_max"] == 4
    assert [data[f"star{index}_upgrade_chance"] for index in range(1, 4)] == [61, 17, 3]

    by_order = {entry["sort_order"]: entry for entry in data["entries"]}
    assert set(by_order) == {101, 102, 201, 202}
    assert (by_order[101]["reward_kind"], by_order[101]["amount_min"], by_order[101]["amount_max"]) == ("xp", 6, 9)
    assert (by_order[102]["item_id"], by_order[102]["amount_min"], by_order[102]["amount_max"]) == (fragment_id, 1, 2)

    with sessions() as db:
        pool = db.query(models.LootboxPool).filter_by(code="common").one()
        assert (pool.bonus_item_chance, pool.special_item_chance, pool.super_special_item_chance) == (61, 17, 3)


def test_consolation_editor_is_server_managed(lootbox_api):
    client, sessions = lootbox_api
    box, payload = _create_box(client, sessions, code="consolation")
    response = client.patch(
        f"/api/admin/lootboxes/{box['id']}",
        json=payload,
        headers=_headers(2),
    )
    assert response.status_code == 400
    assert "бронзового" in response.json()["detail"].lower()
