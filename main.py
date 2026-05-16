"""Root-level entrypoint.

- Exposes ``app`` for deploy tools that expect ``main:app``.
- When run directly (``python main.py`` or PyCharm Run), starts a local
  development server on http://localhost:8000.
"""

from app.main import app

__all__ = ["app"]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
