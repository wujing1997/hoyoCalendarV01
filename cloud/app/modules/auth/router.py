"""Auth HTTP routes."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...deps import rate_limit, require_user
from ...database import get_db
from ...schemas import (
    DeviceInfo,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserProfile,
)
from . import service

router = APIRouter(tags=["auth"])


def _auth_error(error: service.AuthError):
    from fastapi import HTTPException

    raise HTTPException(status_code=error.status_code, detail=error.detail)


@router.post(
    "/register",
    response_model=TokenResponse,
    responses={400: {"description": "invalid/used/expired invite or bad input"}, 409: {"description": "email taken"}, 429: {"description": "rate limited"}},
    dependencies=[Depends(rate_limit(limit=8, window_seconds=3600))],
)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    try:
        return service.register(
            db, payload.invite_code, payload.email, payload.password, payload.device_name
        )
    except service.AuthError as error:
        _auth_error(error)


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"description": "bad credentials"}, 403: {"description": "account disabled or device limit reached"}, 429: {"description": "rate limited"}},
    dependencies=[Depends(rate_limit(limit=10, window_seconds=900))],
)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        return service.login(db, payload.email, payload.password, payload.device_name)
    except service.AuthError as error:
        _auth_error(error)


@router.post(
    "/refresh",
    response_model=TokenResponse,
    responses={401: {"description": "invalid or expired refresh token"}},
    dependencies=[Depends(rate_limit(limit=30, window_seconds=900))],
)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    try:
        return service.refresh(db, payload.refresh_token)
    except service.AuthError as error:
        _auth_error(error)


@router.post("/logout", responses={204: {"description": "logged out"}})
def logout(
    current=Depends(require_user),
    body: dict = None,
    db: Session = Depends(get_db),
):
    device_id = None
    if body:
        raw = body.get("device_id")
        if raw:
            try:
                device_id = uuid.UUID(str(raw))
            except ValueError:
                device_id = None
    service.logout(db, current["user"].id, device_id or current["device_id"])
    return None


@router.get("/me", response_model=UserProfile)
def me(current=Depends(require_user), db: Session = Depends(get_db)):
    return service.profile(db, current["user"], current["device_id"])


@router.get("/devices", response_model=list[DeviceInfo])
def devices(current=Depends(require_user), db: Session = Depends(get_db)):
    user_id = current["user"].id
    current_device_id = current["device_id"]
    return [
        DeviceInfo(
            id=d.id,
            name=d.name,
            current=d.id == current_device_id,
            last_active_at=d.last_active_at,
            created_at=d.created_at,
        )
        for d in service.list_devices(db, user_id)
        if d.revoked_at is None
    ]


@router.delete("/devices/{device_id}", status_code=204, responses={204: {"description": "revoked"}, 404: {"description": "device not found"}})
def revoke_device(device_id: uuid.UUID, current=Depends(require_user), db: Session = Depends(get_db)):
    try:
        service.revoke_device(db, current["user"].id, device_id)
    except service.AuthError as error:
        _auth_error(error)
    return None
