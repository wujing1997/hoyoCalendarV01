import os
import sys

import pytest

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg2://hoyo_test:hoyo_dev_only_local_pw@127.0.0.1:5432/hoyocalendar_test",
)
os.environ["JWT_SECRET"] = "test-jwt-secret-0123456789abcdef0123456789abcdef"
os.environ["ADMIN_TOKEN_SECRET"] = "test-admin-secret-0123456789abcdef0123456789abcdef"
os.environ["AI_ENABLED"] = "true"
os.environ["TRASH_RETENTION_DAYS"] = "30"
os.environ["TOMBSTONE_RETENTION_DAYS"] = "180"

CLOUD_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if CLOUD_DIR not in sys.path:
    sys.path.insert(0, CLOUD_DIR)

# Compute the admin hash BEFORE any app import so Settings picks it up.
from argon2 import PasswordHasher  # noqa: E402

ADMIN_PASSWORD = "correct-horse-battery-staple"
os.environ["ADMIN_PASSWORD_HASH"] = PasswordHasher().hash(ADMIN_PASSWORD)


@pytest.fixture(scope="session", autouse=True)
def _migrate():
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(CLOUD_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(CLOUD_DIR, "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean_tables(_migrate):
    from app.database import get_engine, init_engine
    from app.security import limiter

    init_engine()
    limiter.clear()
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            __import__("sqlalchemy").text(
                "TRUNCATE TABLE audit_logs, ai_usage, admin_settings, "
                "calendar_events, sync_cursors, devices, invite_codes, users "
                "RESTART IDENTITY CASCADE"
            )
        )
    yield
    with engine.begin() as conn:
        conn.execute(
            __import__("sqlalchemy").text(
                "TRUNCATE TABLE audit_logs, ai_usage, admin_settings, "
                "calendar_events, sync_cursors, devices, invite_codes, users "
                "RESTART IDENTITY CASCADE"
            )
        )
    engine.dispose()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import api_app, admin_app

    with TestClient(api_app) as api_client:
        with TestClient(admin_app) as admin_client:
            yield {"api": api_client, "admin": admin_client}
