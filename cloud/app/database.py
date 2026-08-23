"""SQLAlchemy engine/session management.

Tests call `init_engine` with the test database URL before importing the app.
The deployed process calls `init_engine` at startup from `settings.database_url`.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

Base = declarative_base()

engine = None
SessionLocal = None


def init_engine(url: str = None):
    global engine, SessionLocal
    url = url or settings.database_url
    engine = create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    if SessionLocal is None:
        init_engine()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_session():
    """Return a new session, initializing the engine if needed."""
    if SessionLocal is None:
        init_engine()
    return SessionLocal()


def get_engine():
    """Return the current engine, initializing it if needed."""
    global engine
    if engine is None:
        init_engine()
    return engine
