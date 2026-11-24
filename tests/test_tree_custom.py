import tempfile
import unittest
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import profile
from app.auth import current_user
from app.db import Base, get_db
from app.tree_custom import CATALOG, seed_tree_catalog


class TreeCustomTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = Path(self.temp.name) / "tree.db"
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            seed_tree_catalog(db)
            user = models.User(telegram_id=9460000000040, first_name="Tree test")
            db.add(user)
            db.flush()
            self.uid = user.id
            db.commit()

        def session():
            with self.sessions() as db:
                yield db

        def current(db=Depends(get_db)):
            return db.get(models.User, self.uid)

        api = FastAPI()
        api.include_router(profile.router)
        api.dependency_overrides[get_db] = session
        api.dependency_overrides[current_user] = current
        self.client = TestClient(api)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()
        self.temp.cleanup()

    def toggle(self, code, equipped):
        response = self.client.post("/api/profile/tree/decorations", json={"code": code, "equipped": equipped})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["equipped"]

    def test_catalog_legacy_migration_and_twenty_layers(self):
        old_code = "tree_garland_aurora"
        with self.sessions() as db:
            item = db.query(models.Item).filter_by(code=old_code).one()
            db.add(models.UserSkinLoadout(user_id=self.uid, tree_garland_item_id=item.id))
            item.name = "Обновлённая гирлянда"
            db.commit()
            seed_tree_catalog(db)
            db.commit()
        first = self.client.get("/api/profile/me").json()
        self.assertEqual(first["tree_loadout"]["equipped"], [old_code])
        self.assertEqual(len(first["tree_catalog"]), 20)
        self.assertEqual(next(item["name"] for item in first["tree_catalog"] if item["code"] == old_code), "Обновлённая гирлянда")
        self.assertEqual(self.toggle(old_code, False), [])
        self.assertEqual(self.client.get("/api/profile/me").json()["tree_loadout"]["equipped"], [])
        for entry in CATALOG:
            equipped = self.toggle(entry["code"], True)
        self.assertEqual(set(equipped), {entry["code"] for entry in CATALOG})
        self.assertEqual(self.toggle(old_code, True), equipped)
        self.assertEqual(len(self.client.get("/api/profile/me").json()["tree_loadout"]["equipped"]), 20)

    def test_foreign_model_cannot_be_equipped_on_tree(self):
        response = self.client.post("/api/profile/tree/decorations", json={"code": "skin_head_crown", "equipped": True})
        self.assertEqual(response.status_code, 404)
