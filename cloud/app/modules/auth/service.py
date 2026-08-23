"""Auth business logic: invite codes, register, login, refresh, devices."""

import uuid
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ... import models
from ...config import settings
from ...security import (
    create_access_token,
    hash_password,
    new_opaque_token,
    sha256_hex,
    verify_password,
)
from ...timeutil import utcnow


class AuthError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _issue_tokens(db: Session, user: models.User, device: models.Device):
    return {
        "access_token": create_access_token(user.id, device.id),
        "refresh_token": _rotate_refresh_token(db, user, device),
        "token_type": "bearer",
        "expires_in": settings.access_token_minutes * 60,
        "device_id": device.id,
    }


def _rotate_refresh_token(db: Session, user: models.User, device: models.Device) -> str:
    token = new_opaque_token()
    device.refresh_token_hash = sha256_hex(token)
    device.refresh_expires_at = utcnow() + timedelta(days=settings.refresh_token_days)
    device.last_active_at = utcnow()
    db.add(device)
    db.commit()
    return token


def _consume_invite(db: Session, code: str, user: models.User) -> None:
    code_hash = sha256_hex(code)
    invite = db.execute(
        select(models.InviteCode).where(models.InviteCode.code_hash == code_hash)
    ).scalar_one_or_none()
    now = utcnow()
    if invite is None:
        raise AuthError(400, "无效的邀请码")
    if invite.status != "unused":
        raise AuthError(400, "邀请码已被使用或撤销")
    if invite.expires_at is not None and now > invite.expires_at:
        raise AuthError(400, "邀请码已过期")
    if invite.use_count >= invite.max_uses:
        raise AuthError(400, "邀请码可用次数已用完")
    invite.use_count += 1
    if invite.use_count >= invite.max_uses:
        invite.status = "used"
    invite.used_by_user_id = user.id
    invite.used_at = now
    db.add(invite)


def register(db: Session, invite_code: str, email: str, password: str, device_name: str) -> dict:
    email = normalize_email(email)
    existing = db.execute(
        select(models.User).where(models.User.email == email)
    ).scalar_one_or_none()
    if existing:
        # 防止账号枚举（权威方案 §4）：与通用注册失败返回相同文案与状态码。
        raise AuthError(400, "注册失败，请检查邀请码或稍后再试")

    user = models.User(
        email=email,
        password_hash=hash_password(password),
        status="active",
    )
    db.add(user)
    db.flush()
    _consume_invite(db, invite_code, user)

    device = models.Device(
        user_id=user.id,
        name=device_name.strip() or "未知设备",
        refresh_token_hash=sha256_hex(new_opaque_token()),
        refresh_expires_at=utcnow() + timedelta(days=settings.refresh_token_days),
    )
    db.add(device)
    db.flush()
    db.commit()
    return {"user": user, "device": device, **_issue_tokens(db, user, device)}


def login(db: Session, email: str, password: str, device_name: str) -> dict:
    email = normalize_email(email)
    user = db.execute(
        select(models.User).where(models.User.email == email)
    ).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError(401, "邮箱或密码错误")
    if user.status != "active":
        raise AuthError(403, "账号已被禁用")

    active_devices = db.execute(
        select(models.Device).where(
            models.Device.user_id == user.id,
            models.Device.revoked_at.is_(None),
        )
    ).scalars().all()

    device = next((d for d in active_devices if d.name == device_name.strip()), None)
    if device is None:
        if len(active_devices) >= settings.max_devices:
            raise AuthError(
                403,
                f"设备数量已达上限（{settings.max_devices} 台），请先在其他设备上退出登录",
            )
        device = models.Device(
            user_id=user.id,
            name=device_name.strip() or "未知设备",
            refresh_token_hash=sha256_hex(new_opaque_token()),
            refresh_expires_at=utcnow() + timedelta(days=settings.refresh_token_days),
        )
        db.add(device)
        db.flush()
        db.commit()

    return {"user": user, "device": device, **_issue_tokens(db, user, device)}


def refresh(db: Session, refresh_token: str) -> dict:
    token_hash = sha256_hex(refresh_token)
    device = db.execute(
        select(models.Device).where(models.Device.refresh_token_hash == token_hash)
    ).scalar_one_or_none()
    if device is None:
        raise AuthError(401, "刷新令牌无效")
    if device.revoked_at is not None:
        raise AuthError(401, "会话已撤销")
    now = utcnow()
    if device.refresh_expires_at is None or now > device.refresh_expires_at:
        raise AuthError(401, "刷新令牌已过期")
    user = db.get(models.User, device.user_id)
    if user is None or user.status != "active":
        raise AuthError(403, "账号已被禁用")
    return {"user": user, "device": device, **_issue_tokens(db, user, device)}


def logout(db: Session, user_id: uuid.UUID, device_id: Optional[uuid.UUID]) -> None:
    query = select(models.Device).where(models.Device.user_id == user_id)
    if device_id is not None:
        query = query.where(models.Device.id == device_id)
    for device in db.execute(query).scalars().all():
        if device.revoked_at is None:
            device.revoked_at = utcnow()
            db.add(device)
    db.commit()


def list_devices(db: Session, user_id: uuid.UUID) -> list:
    return db.execute(
        select(models.Device)
        .where(models.Device.user_id == user_id)
        .order_by(models.Device.created_at)
    ).scalars().all()


def revoke_device(db: Session, user_id: uuid.UUID, device_id: uuid.UUID) -> bool:
    device = db.execute(
        select(models.Device).where(
            models.Device.id == device_id,
            models.Device.user_id == user_id,
        )
    ).scalar_one_or_none()
    if device is None:
        raise AuthError(404, "设备不存在")
    if device.revoked_at is None:
        device.revoked_at = utcnow()
        db.add(device)
        db.commit()
    return True


def active_device_count(db: Session, user_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count(models.Device.id)).where(
            models.Device.user_id == user_id,
            models.Device.revoked_at.is_(None),
        )
    ).scalar() or 0


def profile(db: Session, user: models.User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "status": user.status,
        "email_verified_at": user.email_verified_at,
        "created_at": user.created_at,
    }
