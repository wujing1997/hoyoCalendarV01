"""Admin HTTP routes (mounted only on the 127.0.0.1-bound admin app)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...database import get_db
from ...deps import rate_limit, require_admin
from ...schemas import (
    AdminLoginRequest,
    AdminTokenResponse,
    AuditLogView,
    InviteCreateRequest,
    InviteCreateResponse,
    InviteView,
    SettingsUpdate,
    SettingsView,
    UsageSummary,
    UserAdminView,
    UserStatusUpdate,
)
from . import service

router = APIRouter(tags=["admin"])

ALLOWED_SETTINGS = {"ai_enabled", "ai_monthly_budget_usd"}


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=AdminTokenResponse, responses={401: {"description": "bad credentials"}, 429: {"description": "rate limited"}}, dependencies=[Depends(rate_limit(limit=8, window_seconds=900))])
def login(payload: AdminLoginRequest):
    try:
        token = service.admin_login(payload.username, payload.password)
    except service.AdminError as error:
        service._handle_error(error)
    return {
        "token": token,
        "token_type": "bearer",
        "expires_in": 3600,
    }


@router.post("/logout", status_code=204, responses={204: {"description": "logged out"}})
def logout(admin=Depends(require_admin)):
    return None


@router.get("/invites", response_model=list[InviteView])
def list_invites(admin=Depends(require_admin), db: Session = Depends(get_db)):
    return [
        InviteView(
            id=i.id,
            status=i.status,
            expires_at=i.expires_at,
            max_uses=i.max_uses,
            use_count=i.use_count,
            used_by_user_id=i.used_by_user_id,
            created_at=i.created_at,
            used_at=i.used_at,
        )
        for i in service.list_invites(db)
    ]


@router.post("/invites", response_model=InviteCreateResponse)
def create_invite(
    payload: InviteCreateRequest,
    request: Request,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    result = service.create_invite(db, admin["username"], payload.expires_days, payload.max_uses)
    invite = result["invite"]
    return InviteCreateResponse(
        id=invite.id,
        status=invite.status,
        expires_at=invite.expires_at,
        used_by_user_id=invite.used_by_user_id,
        created_at=invite.created_at,
        used_at=invite.used_at,
        code=result["code"],
    )


@router.delete("/invites/{invite_id}", status_code=204, responses={204: {"description": "revoked"}, 404: {"description": "not found"}})
def revoke_invite(
    invite_id: int,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    try:
        service.revoke_invite(db, admin["username"], invite_id)
    except service.AdminError as error:
        service._handle_error(error)
    return None


@router.get("/users", response_model=list[UserAdminView])
def list_users(admin=Depends(require_admin), db: Session = Depends(get_db)):
    return [UserAdminView(**item) for item in service.list_users(db)]


@router.patch("/users/{user_id}", response_model=UserAdminView)
def update_user(
    user_id: uuid.UUID,
    payload: UserStatusUpdate,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    try:
        service.set_user_status(db, admin["username"], user_id, payload.status)
    except service.AdminError as error:
        service._handle_error(error)
    user = service.list_users(db)
    for item in user:
        if item["id"] == user_id:
            return UserAdminView(**item)
    raise HTTPException(status_code=404, detail="用户不存在")


@router.post("/users/{user_id}/revoke-sessions", status_code=204, responses={204: {"description": "revoked"}})
def revoke_sessions(
    user_id: uuid.UUID,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    service.revoke_all_sessions(db, admin["username"], user_id)
    return None


@router.get("/usage", response_model=UsageSummary)
def usage(days: int = 30, admin=Depends(require_admin), db: Session = Depends(get_db)):
    return service.usage_summary(db, days)


@router.get("/settings", response_model=SettingsView)
def get_settings(admin=Depends(require_admin), db: Session = Depends(get_db)):
    return service.get_settings(db)


@router.put("/settings", response_model=SettingsView)
def put_settings(
    payload: SettingsUpdate,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    updates = {k: v for k, v in payload.model_dump().items() if k in ALLOWED_SETTINGS}
    return service.update_settings(db, admin["username"], updates)


@router.get("/audit", response_model=list[AuditLogView])
def audit(limit: int = 100, admin=Depends(require_admin), db: Session = Depends(get_db)):
    return [
        AuditLogView(
            id=entry.id,
            actor=entry.actor,
            action=entry.action,
            target_type=entry.target_type,
            target_id=entry.target_id,
            created_at=entry.created_at,
        )
        for entry in service.list_audit(db, min(max(limit, 1), 500))
    ]
