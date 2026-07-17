from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.resolved_database_url,
    connect_args={"check_same_thread": False} if settings.resolved_database_url.startswith("sqlite") else {},
    future=True,
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    """Keep game-data invariants enabled for every SQLite connection."""
    if settings.resolved_database_url.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def begin_game_write(db: Session) -> None:
    """Serialize a complete read/validate/write game operation on SQLite.

    ``current_user`` has already read from this session, so SQLAlchemy may have
    opened a deferred transaction.  Restart it as ``BEGIN IMMEDIATE`` before
    reading mutable balances/inventory.  Other databases use row locks in the
    endpoint queries and do not need this SQLite-specific statement.
    """
    if db.get_bind().dialect.name == "sqlite":
        db.rollback()
        db.execute(text("BEGIN IMMEDIATE"))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
