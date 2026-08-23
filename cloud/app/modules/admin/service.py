"""Admin business logic: invites, users, sessions, usage, settings, audit."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ... import models
from ...config import settings
from ...security import (
    create_access_token,
    hash_password,
    sha256_hex,
    verify_password,
)
from ...timeutil import utcnow


class AdminError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _handle_error(error: AdminError):
    raise HTTPException(status_code=error.status_code, detail=error.detail)


def admin_login(username: str, password: str) -> str:
    if username != settings.admin_username:
        raise AdminError(401, "管理员账号或密码错误")
    if not settings.admin_password_hash or not verify_password(password, settings.admin_password_hash):
        raise AdminError(401, "管理员账号或密码错误")
    return create_access_token(username, admin=True)


def add_audit(
    db: Session,
    actor: str,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    db.add(models.AuditLog(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id else None,
        ip=ip,
    ))
    db.commit()


# -------------------------------------------------------------------- invites


def generate_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "HOYO-" + "".join(secrets.choice(alphabet) for _ in range(12))


def create_invite(db: Session, actor: str, expires_days: Optional[int], max_uses: int = 1) -> dict:
    code = generate_code()
    invite = models.InviteCode(
        code_hash=sha256_hex(code),
        status="unused",
        max_uses=max_uses,
        expires_at=(
            utcnow() + timedelta(days=expires_days)
            if expires_days
            else utcnow() + timedelta(days=settings.invite_expires_days)
        ),
    )
    db.add(invite)
    db.flush()
    db.commit()
    add_audit(db, actor, "invite.create", "invite", invite.id)
    return {"invite": invite, "code": code}


def list_invites(db: Session) -> list:
    return db.execute(
        select(models.InviteCode).order_by(models.InviteCode.created_at.desc())
    ).scalars().all()


def revoke_invite(db: Session, actor: str, invite_id: int) -> None:
    invite = db.get(models.InviteCode, invite_id)
    if invite is None:
        raise AdminError(404, "邀请码不存在")
    if invite.status == "unused":
        invite.status = "revoked"
        db.add(invite)
        db.commit()
        add_audit(db, actor, "invite.revoke", "invite", invite.id)


# -------------------------------------------------------------------- users


def list_users(db: Session) -> list:
    rows = db.execute(
        select(
            models.User,
            func.count(models.Device.id).label("device_count"),
        )
        .outerjoin(models.Device, models.Device.user_id == models.User.id)
        .group_by(models.User.id)
        .order_by(models.User.created_at.desc())
    ).all()
    return [
        {
            "id": user.id,
            "email": user.email,
            "status": user.status,
            "created_at": user.created_at,
            "device_count": device_count,
        }
        for user, device_count in rows
    ]


def set_user_status(db: Session, actor: str, user_id: uuid.UUID, status: str) -> None:
    user = db.get(models.User, user_id)
    if user is None:
        raise AdminError(404, "用户不存在")
    if user.status != status:
        user.status = status
        db.add(user)
        db.commit()
        add_audit(db, actor, "user.status", "user", user.id)
    if status == "disabled":
        revoke_all_sessions(db, actor, user_id)


def revoke_all_sessions(db: Session, actor: str, user_id: uuid.UUID) -> None:
    devices = db.execute(
        select(models.Device).where(models.Device.user_id == user_id)
    ).scalars().all()
    changed = False
    for device in devices:
        if device.revoked_at is None:
            device.revoked_at = utcnow()
            db.add(device)
            changed = True
    if changed:
        db.commit()
    add_audit(db, actor, "user.revoke_sessions", "user", user_id)


# -------------------------------------------------------------------- usage


def usage_summary(db: Session, days: int) -> dict:
    since = utcnow() - timedelta(days=days)
    rows = db.execute(
        select(models.AiUsage).where(models.AiUsage.created_at >= since)
    ).scalars().all()

    total_count = len(rows)
    total_prompt = sum(r.prompt_tokens for r in rows)
    total_completion = sum(r.completion_tokens for r in rows)
    total_cost = sum(float(r.estimated_cost_usd or 0) for r in rows)

    per_day = {}
    per_user = {}
    for row in rows:
        day_key = row.created_at.date().isoformat()
        bucket = per_day.setdefault(day_key, {
            "request_count": 0, "prompt": 0, "completion": 0, "cost": 0.0,
        })
        bucket["request_count"] += 1
        bucket["prompt"] += row.prompt_tokens
        bucket["completion"] += row.completion_tokens
        bucket["cost"] += float(row.estimated_cost_usd or 0)

        if row.user_id:
            user_bucket = per_user.setdefault(str(row.user_id), {
                "user_id": row.user_id, "request_count": 0, "cost": 0.0,
            })
            user_bucket["request_count"] += 1
            user_bucket["cost"] += float(row.estimated_cost_usd or 0)

    emails = {}
    if per_user:
        ids = [uuid.UUID(uid) for uid in per_user]
        for user in db.execute(
            select(models.User).where(models.User.id.in_(ids))
        ).scalars().all():
            emails[str(user.id)] = user.email

    return {
        "total_request_count": total_count,
        "total_prompt_tokens": total_prompt,
        "total_completion_tokens": total_completion,
        "total_cost_usd": round(total_cost, 6),
        "per_day": [
            {
                "date": key,
                "request_count": value["request_count"],
                "total_prompt_tokens": value["prompt"],
                "total_completion_tokens": value["completion"],
                "estimated_cost_usd": round(value["cost"], 6),
            }
            for key, value in sorted(per_day.items())
        ],
        "per_user": [
            {
                "user_id": value["user_id"],
                "email": emails.get(key, ""),
                "request_count": value["request_count"],
                "total_cost_usd": round(value["cost"], 6),
            }
            for key, value in per_user.items()
        ],
    }


# -------------------------------------------------------------------- settings


def get_settings(db: Session) -> dict:
    def get_bool(key, default):
        row = db.get(models.AdminSetting, key)
        if row is None:
            return default
        return row.value.strip().lower() in ("1", "true", "yes", "on")

    def get_float(key, default):
        row = db.get(models.AdminSetting, key)
        if row is None:
            return default
        try:
            return float(row.value)
        except ValueError:
            return default

    return {
        "ai_enabled": get_bool("ai_enabled", settings.ai_enabled_default),
        "ai_monthly_budget_usd": get_float("ai_monthly_budget_usd", settings.ai_monthly_budget_usd),
    }


def update_settings(db: Session, actor: str, updates: dict) -> dict:
    for key, value in updates.items():
        row = db.get(models.AdminSetting, key)
        if row is None:
            row = models.AdminSetting(key=key, value="")
            db.add(row)
        row.value = str(value).lower()
        db.flush()
    db.commit()
    add_audit(db, actor, "settings.update", "settings", ",".join(sorted(updates.keys())))
    return get_settings(db)


# -------------------------------------------------------------------- audit


def list_audit(db: Session, limit: int) -> list:
    return db.execute(
        select(models.AuditLog)
        .order_by(models.AuditLog.created_at.desc())
        .limit(limit)
    ).scalars().all()
