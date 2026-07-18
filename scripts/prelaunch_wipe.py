"""One-time, explicitly confirmed pre-launch economy reset.

Run inside the application container only after making a database backup:
    python scripts/prelaunch_wipe.py --confirm PRELAUNCH-WIPE
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import models
from app.db import SessionLocal, begin_game_write


KEEP_ITEM_CODES = {
    "lootbox_common",
    "lootbox_rare",
    "lootbox_epic",
    "lootbox_legendary",
    "box_fragment",
}

DEFAULT_POOL_REWARDS = {
    "common": (("kovbucks", 1, 3, 70), ("xp", 5, 10, 30)),
    "rare": (("kovbucks", 3, 6, 65), ("xp", 10, 20, 35)),
    "epic": (("kovbucks", 6, 12, 60), ("xp", 20, 40, 40)),
    "legendary": (("kovbucks", 12, 25, 55), ("xp", 40, 80, 45)),
}


def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    if args.confirm != "PRELAUNCH-WIPE":
        raise SystemExit("Refusing to wipe: invalid confirmation value")

    db = SessionLocal()
    try:
        begin_game_write(db)
        before = {
            "users": db.query(models.User).count(),
            "inventory_stacks": db.query(models.InventoryItem).count(),
            "items": db.query(models.Item).count(),
            "wallet_total": sum(row.balance for row in db.query(models.Wallet).all()),
            "xp_total": sum(row.xp for row in db.query(models.User).all()),
            "battlepass_claims": db.query(models.BattlePassClaim).count(),
        }

        db.query(models.InventoryItem).delete(synchronize_session=False)
        db.query(models.MarketListing).delete(synchronize_session=False)
        db.query(models.BattlePassClaim).delete(synchronize_session=False)
        db.query(models.Wallet).update({models.Wallet.balance: 0}, synchronize_session=False)
        db.query(models.User).update({models.User.xp: 0}, synchronize_session=False)
        db.query(models.UserBattlePass).update(
            {models.UserBattlePass.has_premium: False, models.UserBattlePass.claimed_rewards: "[]"},
            synchronize_session=False,
        )

        extra_items = db.query(models.Item).filter(~models.Item.code.in_(KEEP_ITEM_CODES)).all()
        extra_ids = {item.id for item in extra_items}
        extra_codes = {item.code for item in extra_items}

        if extra_ids:
            db.query(models.ShopProduct).filter(models.ShopProduct.item_id.in_(extra_ids)).delete(synchronize_session=False)
            db.query(models.LootboxPoolEntry).filter(models.LootboxPoolEntry.item_id.in_(extra_ids)).delete(synchronize_session=False)
            db.query(models.LootboxOpenReward).filter(models.LootboxOpenReward.item_id.in_(extra_ids)).delete(synchronize_session=False)
            db.query(models.Task).filter(models.Task.reward_item_id.in_(extra_ids)).update(
                {models.Task.reward_item_id: None, models.Task.reward_item_quantity: 0},
                synchronize_session=False,
            )
        if extra_codes:
            db.query(models.BattlePassReward).filter(models.BattlePassReward.item_code.in_(extra_codes)).delete(synchronize_session=False)
            db.query(models.Quiz).filter(models.Quiz.prize_item_code.in_(extra_codes)).update(
                {models.Quiz.prize_kind: "coins", models.Quiz.prize_value: 1, models.Quiz.prize_item_code: None},
                synchronize_session=False,
            )
            db.query(models.WheelPrize).filter(models.WheelPrize.item_code.in_(extra_codes)).delete(synchronize_session=False)

        # Audit history is pre-launch data and can retain foreign keys to removed rewards.
        db.query(models.LootboxOpenReward).delete(synchronize_session=False)
        db.query(models.LootboxOpen).delete(synchronize_session=False)
        if extra_ids:
            for pool in db.query(models.LootboxPool).filter(models.LootboxPool.item_id.in_(extra_ids)).all():
                db.delete(pool)
            db.flush()
        for item in extra_items:
            db.delete(item)

        for item in db.query(models.Item).all():
            item.description = ""
        for pool in db.query(models.LootboxPool).all():
            pool.description = ""
            if not pool.entries:
                for order, (kind, amount_min, amount_max, weight) in enumerate(DEFAULT_POOL_REWARDS.get(pool.code, DEFAULT_POOL_REWARDS["common"])):
                    pool.entries.append(models.LootboxPoolEntry(
                        reward_kind=kind,
                        item_id=None,
                        amount_min=amount_min,
                        amount_max=amount_max,
                        weight=weight,
                        is_active=True,
                        sort_order=order,
                    ))

        db.commit()
        after = {
            "inventory_stacks": db.query(models.InventoryItem).count(),
            "items": db.query(models.Item).count(),
            "item_codes": [row.code for row in db.query(models.Item).order_by(models.Item.code).all()],
            "wallet_total": sum(row.balance for row in db.query(models.Wallet).all()),
            "xp_total": sum(row.xp for row in db.query(models.User).all()),
            "battlepass_claims": db.query(models.BattlePassClaim).count(),
        }
        print({"before": before, "after": after})
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
