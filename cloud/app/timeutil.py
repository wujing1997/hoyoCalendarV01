from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utcnow_naive() -> datetime:
    return datetime.utcnow()


def utcnow_iso() -> str:
    return utcnow().isoformat()
