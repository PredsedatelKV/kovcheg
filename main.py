"""Root-level entrypoint to satisfy deploy tools expecting `main:app`."""

from app.main import app

__all__ = ["app"]
