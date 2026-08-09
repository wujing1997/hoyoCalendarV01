"""Shared test helpers."""

import secrets
import uuid


def make_invite(admin_client):
    resp = admin_client.post("/api/admin/login", json={
        "username": "admin",
        "password": "correct-horse-battery-staple",
    })
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    created = admin_client.post(
        "/api/admin/invites",
        json={"expires_days": 7},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert created.status_code == 200, created.text
    return created.json()["code"]


def make_user(client, email=None, device_name="TestPC"):
    invite = make_invite(client["admin"])
    email = email or f"user-{secrets.token_hex(4)}@example.com"
    resp = client["api"].post("/api/auth/register", json={
        "invite_code": invite,
        "email": email,
        "password": "SecurePass123!",
        "device_name": device_name,
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return {
        "email": email,
        "password": "SecurePass123!",
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "device_id": data["device_id"],
    }


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def new_event_id() -> str:
    return str(uuid.uuid4())


def upsert_change(event_id, version, base_version, data, op="upsert"):
    return {
        "event_id": event_id,
        "version": version,
        "base_version": base_version,
        "operation_id": str(uuid.uuid4()),
        "op": op,
        "data": data,
    }
