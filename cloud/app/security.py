"""Security helpers: Argon2id, JWT, opaque tokens, rate limiting, redaction."""

import hashlib
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from .config import settings

_pw_hasher = PasswordHasher()


# --------------------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    return _pw_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _pw_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


# --------------------------------------------------------------------------- opaque tokens


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- JWT access tokens


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id, device_id=None, admin: bool = False) -> str:
    minutes = settings.admin_token_minutes if admin else settings.access_token_minutes
    payload = {
        "sub": str(user_id),
        "type": "admin" if admin else "access",
        "iat": int(_now().timestamp()),
        "exp": int((_now() + timedelta(minutes=minutes)).timestamp()),
    }
    if device_id is not None:
        payload["dev"] = str(device_id)
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str, expected_type: str) -> dict:
    """Return claims or raise jwt.PyJWTError / ValueError."""
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    if claims.get("type") != expected_type:
        raise ValueError("wrong token type")
    return claims


# --------------------------------------------------------------------------- admin bootstrap


def create_admin_password_hash(password: str) -> str:
    return hash_password(password)


# --------------------------------------------------------------------------- rate limiting


class RateLimiter:
    """In-process sliding window rate limiter (single process deployment)."""

    def __init__(self) -> None:
        self._buckets: dict = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        """Record a hit. Returns True when the request is allowed."""
        now = time.monotonic()
        with self._lock:
            entries = self._buckets.setdefault(key, [])
            entries = [ts for ts in entries if now - ts < window_seconds]
            self._buckets[key] = entries
            if len(entries) >= limit:
                return False
            entries.append(now)
            return True

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()


limiter = RateLimiter()


def allow_request(key: str, limit: int, window_seconds: int) -> bool:
    return limiter.hit(key, limit, window_seconds)


# --------------------------------------------------------------------------- redaction


_SECRET_PATTERNS = [
    re.compile(r"(Authorization:\s*Bearer\s+)[^\s,]+", re.IGNORECASE),
    re.compile(r"(password[\"']?\s*[:=]\s*[\"'])[^\"']+", re.IGNORECASE),
    re.compile(r"(api[_-]?key[\"']?\s*[:=]\s*[\"'])[^\"']+", re.IGNORECASE),
    re.compile(r"(invite[_-]?code[\"']?\s*[:=]\s*[\"'])[^\"']+", re.IGNORECASE),
    re.compile(r"(refresh[_-]?token[\"']?\s*[:=]\s*[\"'])[^\"']+", re.IGNORECASE),
    re.compile(r"(secret[\"']?\s*[:=]\s*[\"'])[^\"']+", re.IGNORECASE),
    re.compile(r"\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b"),
]


def redact(text: str) -> str:
    """Mask known secret shapes so logs never leak credentials or tokens."""
    if not isinstance(text, str):
        return text
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(r"\1[REDACTED]", text)
    return text


class RedactingFilter:
    """logging.Filter that redacts formatted messages and args."""

    def filter(self, record) -> bool:  # noqa: A003
        try:
            record.msg = redact(str(record.msg))
            record.args = _redact_args(record.args)
        except Exception:  # pragma: no cover - defensive
            pass
        return True


def _redact_args(args):
    if isinstance(args, dict):
        return {k: redact(str(v)) for k, v in args.items()}
    if isinstance(args, tuple):
        return tuple(redact(str(a)) for a in args)
    return args
