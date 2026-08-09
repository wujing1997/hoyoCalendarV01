"""Environment-driven settings for the HoYoCalendar cloud backend.

No secrets are hard-coded here. Every sensitive value must come from the
environment (`.env` on the deployment host). Placeholders are only defined in
`.env.example` with empty values.
"""

import os
from typing import Optional


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


class Settings:
    """Read once at import time; tests override via environment before import."""

    def __init__(self) -> None:
        self.database_url: str = os.environ.get(
            "DATABASE_URL",
            "postgresql+psycopg2://hoyo:hoyo@127.0.0.1:5432/hoyocalendar",
        )
        self.jwt_secret: str = os.environ.get("JWT_SECRET", "")
        self.access_token_minutes: int = _int("ACCESS_TOKEN_MINUTES", 15)
        self.refresh_token_days: int = _int("REFRESH_TOKEN_DAYS", 30)
        self.max_devices: int = _int("MAX_DEVICES", 5)
        self.invite_expires_days: int = _int("INVITE_EXPIRES_DAYS", 30)

        self.trash_retention_days: int = _int("TRASH_RETENTION_DAYS", 30)
        self.tombstone_retention_days: int = _int("TOMBSTONE_RETENTION_DAYS", 180)

        self.ai_enabled_default: bool = _bool("AI_ENABLED", True)
        self.ai_base_url: str = os.environ.get("AI_BASE_URL", "")
        self.ai_api_key: str = os.environ.get("AI_API_KEY", "")
        self.ai_model: str = os.environ.get("AI_MODEL", "")
        self.ai_timeout_seconds: float = _float("AI_TIMEOUT_SECONDS", 45.0)
        self.ai_max_concurrency: int = _int("AI_MAX_CONCURRENCY", 4)
        self.ai_monthly_budget_usd: float = _float("AI_MONTHLY_BUDGET_USD", 0.0)
        self.ai_input_price_per_1k: float = _float("AI_INPUT_PRICE_PER_1K", 0.002)
        self.ai_output_price_per_1k: float = _float("AI_OUTPUT_PRICE_PER_1K", 0.008)
        self.ai_max_snapshot_events: int = _int("AI_MAX_SNAPSHOT_EVENTS", 500)

        self.admin_username: str = os.environ.get("ADMIN_USERNAME", "admin")
        self.admin_password_hash: str = os.environ.get("ADMIN_PASSWORD_HASH", "")
        self.admin_token_secret: str = os.environ.get("ADMIN_TOKEN_SECRET", "")
        self.admin_token_minutes: int = _int("ADMIN_TOKEN_MINUTES", 60)

        self.log_level: str = os.environ.get("LOG_LEVEL", "INFO")
        self.api_host: str = os.environ.get("API_HOST", "127.0.0.1")
        self.api_port: int = _int("API_PORT", 8000)
        self.admin_host: str = os.environ.get("ADMIN_HOST", "127.0.0.1")
        self.admin_port: int = _int("ADMIN_PORT", 8001)
        self.version: str = "0.1.0"

    def require(self) -> None:
        """Fail fast when required secrets are missing (never in tests)."""
        if not self.jwt_secret:
            raise RuntimeError("JWT_SECRET must be set")
        if not self.admin_password_hash:
            raise RuntimeError("ADMIN_PASSWORD_HASH must be set")
        if not self.admin_token_secret:
            raise RuntimeError("ADMIN_TOKEN_SECRET must be set")


settings = Settings()
