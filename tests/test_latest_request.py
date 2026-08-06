from __future__ import annotations

import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.access import can_use_clicker, maintenance_sections
from app.api._helpers import award_xp
from app.api import arcade, home, profile
from app.db import Base


def _session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'latest.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def test_xp_rolls_over_into_levels_and_caps_at_100(tmp_path):
    with _session(tmp_path) as db:
        user = models.User(telegram_id=1, first_name="Игрок", level=5, xp=95)
        db.add(user)
        db.flush()
        db.add(models.Wallet(user_id=user.id, balance=7))

        result = award_xp(db, user, 210)
        assert (user.level, user.xp) == (8, 5)
        assert result == {"xp_added": 210, "levels_gained": 3, "coins": 0}

        user.level = 99
        user.xp = 95
        result = award_xp(db, user, 125)
        assert (user.level, user.xp) == (100, 0)
        assert result == {"xp_added": 5, "levels_gained": 1, "coins": 120}
        assert user.wallet.balance == 127

        result = award_xp(db, user, 29)
        assert (user.level, user.xp) == (100, 0)
        assert result["coins"] == 20


def test_all_sections_are_open_and_clicker_rule_stays_independent(tmp_path):
    with _session(tmp_path) as db:
        user = models.User(telegram_id=837611803, first_name="Игрок")
        db.add(user)
        db.flush()
        assert can_use_clicker(user) is True
        assert maintenance_sections(user) == []


def test_quiz_reward_json_supports_each_grade(tmp_path):
    with _session(tmp_path) as db:
        item = models.Item(code="gift", name="Подарок")
        db.add(item)
        db.flush()
        quiz = models.Quiz(
            title="Тест",
            time_limit_seconds=90,
            rewards_bad=json.dumps([{"kind": "xp", "amount": 1, "item_id": None}]),
            rewards_good=json.dumps([{"kind": "kovbucks", "amount": 2, "item_id": None}]),
            rewards_excellent=json.dumps([{"kind": "item", "amount": 1, "item_id": item.id}]),
        )
        db.add(quiz)
        db.commit()

        from app.api.quiz import quiz_rewards_out

        assert quiz_rewards_out(db, quiz, "bad")[0].kind == "xp"
        assert quiz_rewards_out(db, quiz, "good")[0].kind == "kovbucks"
        assert quiz_rewards_out(db, quiz, "excellent")[0].item_id == item.id


def test_daily_economy_has_a_bounded_weekly_target():
    assert home.DAILY_REWARDS == (100, 150, 200, 250, 300, 350, 500)
    assert sum(arcade.FIRST_WIN_REWARDS.values()) == 400
    assert arcade.CLICKER_DAILY_CAPS == (15_000, 18_000, 22_000, 26_000, 30_000, 33_000, 35_000)
    assert profile.FRAGMENT_ASSEMBLY_WEIGHTS == {
        "common": 40, "rare": 30, "epic": 20, "seasonal": 10,
    }
    # Day seven: 500 K streak + 400 K arcade + ~200 K wheel + 350 K Clicker.
    assert 1_000 <= 500 + 400 + 200 + arcade.CLICKER_DAILY_CAPS[-1] // 100 <= 1_500
