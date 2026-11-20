"""Regression checks for winter tables and their real purchase/open API.

Runnable with the standard library:
    python -m unittest discover -s tests -p test_winter_lootboxes.py
"""
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import profile, shop
from app.auth import current_user
from app.db import Base, get_db
from app.winter_economy import (
    WINTER_BOX_REWARDS, WINTER_BOX_REWARDS_KEY,
    configure_winter_box_rewards, seed_winter_catalog,
)

COPY_SOURCE = os.environ.get("WINTER_BOX_TEST_COPY")


class WinterLootboxTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="winter-box-test-")
        self.path = Path(self.tmp.name)/"copy.db"
        if COPY_SOURCE:
            with sqlite3.connect(COPY_SOURCE) as src, sqlite3.connect(self.path) as dst:
                src.backup(dst)
        self.engine = create_engine(f"sqlite:///{self.path}", connect_args={"check_same_thread": False})
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)
        with self.sessions() as db:
            db.execute(text("CREATE TABLE IF NOT EXISTS maintenance_migrations (key VARCHAR(128) PRIMARY KEY)"))
            user = models.User(telegram_id=900000000000001, first_name="Winter Test", level=10, xp=0)
            db.add(user); db.flush()
            self.uid = user.id
            db.add(models.Wallet(user_id=user.id, balance=1000))
            db.commit()

        def test_db():
            with self.sessions() as db:
                yield db

        def test_user(db=Depends(get_db)):
            return db.get(models.User, self.uid)

        app = FastAPI()
        app.include_router(profile.router)
        app.include_router(shop.router)
        app.dependency_overrides[get_db] = test_db
        app.dependency_overrides[current_user] = test_user
        self.client = TestClient(app)
        self.silent = patch("app.notify.log_player_action")
        self.silent.start()

    def tearDown(self):
        self.silent.stop()
        self.client.close()
        self.engine.dispose()
        self.tmp.cleanup()

    def seed(self):
        with self.sessions() as db:
            seed_winter_catalog(db); db.commit()
            snow = db.query(models.Item).filter_by(code="snowflake").one()
            db.add(models.InventoryItem(user_id=self.uid, item_id=snow.id, quantity=10000))
            db.commit()

    def test_legacy_120_percent_table_is_rejected_without_spending_then_repaired(self):
        self.seed()
        with self.sessions() as db:
            pool = db.query(models.LootboxPool).filter_by(code="winter-ice").one()
            for entry in pool.entries:
                entry.is_active = entry.reward_kind != "kovbucks"
                entry.weight = 55 if entry.item and entry.item.code=="snowflake" else (
                    45 if entry.reward_kind=="xp" else 5)
            iid = pool.item_id
            db.add(models.InventoryItem(user_id=self.uid, item_id=iid, quantity=2))
            db.execute(text("DELETE FROM maintenance_migrations WHERE key=:key"), {"key":WINTER_BOX_REWARDS_KEY})
            db.commit()
        payload = {"item_id":iid,"request_id":"bad-winter-120"}
        res = self.client.post("/api/profile/inventory/open-lootbox",json=payload)
        self.assertEqual(res.status_code,409,res.text)
        self.assertIn("100%",res.json()["detail"])
        with self.sessions() as db:
            self.assertEqual(db.query(models.InventoryItem).filter_by(user_id=self.uid,item_id=iid).one().quantity,2)
            configure_winter_box_rewards(db);db.commit()
        with patch.object(profile.secrets,"randbelow",side_effect=lambda n:n-1):
            res = self.client.post("/api/profile/inventory/open-lootbox",json=payload)
        self.assertEqual(res.status_code,200,res.text)
        self.assertEqual(len(res.json()["rewards"]),1)

    def test_purchase_every_reward_boundary_and_idempotent_open(self):
        self.seed()
        for code, rows in WINTER_BOX_REWARDS.items():
            with self.sessions() as db:
                pool=db.query(models.LootboxPool).filter_by(code=code).one()
                product=db.query(models.ShopProduct).filter_by(item_id=pool.item_id,is_active=True).one()
                iid,pid,price=pool.item_id,product.id,product.price
                self.assertEqual(sum(e.weight for e in pool.entries if e.is_active and not e.is_guaranteed),100)
                self.assertEqual((price,pool.sale_currency),(50 if code=="winter-ice" else 100,"snowflakes"))
            for order,(kind,item_code,low,high,_) in enumerate(rows):
                for boundary in ["min","max"]:
                    with self.subTest(code=code,reward=item_code or kind,boundary=boundary):
                        with self.sessions() as db:
                            before=profile.snowflake_balance(db.get(models.User,self.uid))
                        bought=self.client.post("/api/shop/buy",json={"product_id":pid})
                        self.assertEqual(bought.status_code,200,bought.text)
                        with self.sessions() as db:
                            self.assertEqual(profile.snowflake_balance(db.get(models.User,self.uid)),before-price)
                            inv=db.query(models.InventoryItem).filter_by(user_id=self.uid,item_id=iid).one().quantity
                        payload={"item_id":iid,"request_id":f"winter-{code}-{order}-{boundary}"}
                        def select(rows, **_):
                            return next(e for e in rows if e.sort_order==order)
                        with patch.object(profile,"_weighted_pick",side_effect=select), patch.object(
                            profile.secrets,"randbelow",side_effect=lambda n:0 if boundary=="min" else n-1
                        ):
                            opened=self.client.post("/api/profile/inventory/open-lootbox",json=payload)
                        self.assertEqual(opened.status_code,200,opened.text)
                        result=opened.json()
                        self.assertEqual(result["opening_mode"],"chest_v2")
                        self.assertEqual(len(result["star_sequence"]),3)
                        self.assertEqual(len(result["rewards"]),1)
                        reward=result["rewards"][0]
                        self.assertEqual(reward["kind"],kind)
                        self.assertEqual(reward["amount"],low if boundary=="min" else high)
                        if item_code:self.assertEqual(reward["item"]["code"],item_code)
                        with self.sessions() as db:
                            row=db.query(models.InventoryItem).filter_by(user_id=self.uid,item_id=iid).one_or_none()
                            self.assertEqual(row.quantity if row else 0,inv-1)
                            wallet_before=db.get(models.User,self.uid).wallet.balance
                            xp_before=db.get(models.User,self.uid).xp
                            snow_before=profile.snowflake_balance(db.get(models.User,self.uid))
                            n=db.query(models.LootboxOpen).filter_by(user_id=self.uid).count()
                        replay=self.client.post("/api/profile/inventory/open-lootbox",json=payload)
                        self.assertEqual(replay.status_code,200,replay.text)
                        self.assertTrue(replay.json()["replayed"])
                        self.assertEqual(replay.json()["rewards"],result["rewards"])
                        with self.sessions() as db:
                            self.assertEqual(db.query(models.LootboxOpen).filter_by(user_id=self.uid).count(),n)
                            u=db.get(models.User,self.uid)
                            self.assertEqual((u.wallet.balance,u.xp,profile.snowflake_balance(u)),(wallet_before,xp_before,snow_before))

    def test_migration_preserves_other_boxes_and_later_admin_edits(self):
        self.seed()
        with self.sessions() as db:
            pool=db.query(models.LootboxPool).filter_by(code="winter-seasonal").one()
            version=pool.version
            next(e for e in pool.entries if e.sort_order==0).amount_min=26
            db.commit()
            other=[(p.id,p.version,p.sale_price) for p in db.query(models.LootboxPool)
                   .filter(~models.LootboxPool.code.in_(WINTER_BOX_REWARDS)).order_by(models.LootboxPool.id)]
            seed_winter_catalog(db);db.commit()
            self.assertEqual(pool.version,version)
            self.assertEqual(next(e for e in pool.entries if e.sort_order==0).amount_min,26)
            self.assertEqual(other,[(p.id,p.version,p.sale_price) for p in db.query(models.LootboxPool)
                   .filter(~models.LootboxPool.code.in_(WINTER_BOX_REWARDS)).order_by(models.LootboxPool.id)])


if __name__=="__main__":
    unittest.main(verbosity=2)
