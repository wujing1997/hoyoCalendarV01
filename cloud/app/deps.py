"""FastAPI dependencies: auth extraction, admin auth, rate limiting."""

import uuid
from typing import Optional

import jwt as pyjwt
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .security import decode_token


def bearer_token(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="missing authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="invalid authorization header")
    return token


def require_user(
    token: str = Depends(bearer_token),
    db: Session = Depends(get_db),
):
    try:
        claims = decode_token(token, "access")
    except (pyjwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="invalid or expired token")

    user_id = claims.get("sub")
    device_id = claims.get("dev")
    user = None
    try:
        user = db.get(models.User, uuid.UUID(user_id))
    except (ValueError, TypeError):
        user = None
    if user is None:
        raise HTTPException(status_code=401, detail="user not found")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="account disabled")

    device = None
    if device_id:
        try:
            device = db.get(models.Device, uuid.UUID(device_id))
        except (ValueError, TypeError):
            device = None
        if device is None or device.user_id != user.id or device.revoked_at is not None:
            raise HTTPException(status_code=401, detail="session revoked")

    return {"user": user, "device_id": (device.id if device else None)}


def require_admin(
    token: str = Depends(bearer_token),
):
    try:
        claims = decode_token(token, "admin")
    except (pyjwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="invalid or expired admin token")
    username = claims.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="invalid admin token")
    return {"username": username}


def rate_limit(limit: int, window_seconds: int):
    from .security import allow_request

    def dependency(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        key = f"{request.url.path}:{client_ip}"
        if not allow_request(key, limit, window_seconds):
            raise HTTPException(
                status_code=429,
                detail="too many requests, please slow down",
            )

    return dependency
