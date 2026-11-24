"""Catalogue and per-player state for independent Christmas-tree decorations."""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from app import models

CATALOG = tuple(json.loads(Path(__file__).with_name("tree_catalog.json").read_text(encoding="utf-8")))
TREE_CODES = {entry["code"] for entry in CATALOG}
LEGACY_SLOTS = ("tree_garland", "tree_toys", "tree_snow", "tree_gifts")


def seed_tree_catalog(db: Session) -> None:
    existing = {item.code: item for item in db.query(models.Item).filter(models.Item.code.in_(TREE_CODES))}
    for entry in CATALOG:
        code = entry["code"]
        if code not in existing:
            db.add(models.Item(
                code=code, name=entry["name"], rarity=entry["rarity"], category="Кастом",
                icon="/static/img/ui/box.svg", can_gift=False, can_activate=False,
            ))
        elif code == "tree_bauble_cube" and existing[code].name == "Шар «Белый куб»":
            existing[code].name = entry["name"]


def saved_tree_codes(db: Session, user_id: int) -> set[str]:
    arrangement = db.get(models.UserTreeLoadout, user_id)
    if arrangement is not None:
        return TREE_CODES.intersection(arrangement.decorations or ())
    old = db.query(models.UserSkinLoadout).filter_by(user_id=user_id).one_or_none()
    if not old:
        return set()
    old_ids = [getattr(old, f"{slot}_item_id") for slot in LEGACY_SLOTS]
    return TREE_CODES.intersection(code for (code,) in db.query(models.Item.code).filter(models.Item.id.in_(old_ids)))


def tree_catalog(db: Session) -> list[dict]:
    items = {item.code: item for item in db.query(models.Item).filter(models.Item.code.in_(TREE_CODES))}
    return [
        {**entry, "name": items[entry["code"]].name, "rarity": items[entry["code"]].rarity}
        for entry in CATALOG if entry["code"] in items
    ]
