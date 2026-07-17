from __future__ import annotations

from types import SimpleNamespace

from app import auth, models


def test_mutable_username_never_grants_access_or_admin(monkeypatch):
    settings = SimpleNamespace(
        admin_id_list=[],
        admin_username_list=["omarbutuev"],
    )
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    impostor = models.User(
        telegram_id=999_999_999,
        username="omarbutuev",
        first_name="Не Омар",
    )

    assert auth.is_admin(impostor) is False
    assert auth._is_allowed_tg_id(impostor.telegram_id, impostor.username or "") is False


def test_omar_access_is_bound_to_immutable_telegram_id(monkeypatch):
    settings = SimpleNamespace(admin_id_list=[], admin_username_list=[])
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    omar = models.User(
        telegram_id=849162365,
        username="changed_username",
        first_name="Омар",
    )

    assert auth.is_admin(omar) is True
    assert auth._is_allowed_tg_id(omar.telegram_id, omar.username or "") is True
