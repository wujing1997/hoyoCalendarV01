"""Auth acceptance tests: invite one-time use, argon2 storage, device cap,
session revocation, rate limiting, user isolation basics."""

import secrets

from .helpers import auth_headers, make_invite, make_user


def test_invite_code_is_one_time(client):
    code = make_invite(client["admin"])
    first = client["api"].post("/api/v1/auth/register", json={
        "invite_code": code,
        "email": "alice@example.com",
        "password": "SecurePass123!",
        "device_name": "PC-A",
    })
    assert first.status_code == 200, first.text
    second = client["api"].post("/api/v1/auth/register", json={
        "invite_code": code,
        "email": "bob@example.com",
        "password": "SecurePass123!",
        "device_name": "PC-B",
    })
    assert second.status_code == 400, second.text


def test_register_rejects_invalid_invite(client):
    resp = client["api"].post("/api/v1/auth/register", json={
        "invite_code": "HOYO-NOTEXIST",
        "email": "eve@example.com",
        "password": "SecurePass123!",
        "device_name": "PC",
    })
    assert resp.status_code == 400


def test_password_not_stored_in_plaintext(client):
    user = make_user(client)
    from app.database import get_session
    from app import models
    from app.security import verify_password
    from sqlalchemy import select

    db = get_session()
    row = db.execute(select(models.User).where(models.User.email == user["email"])).scalar_one()
    stored = row.password_hash
    db.close()
    assert stored != "SecurePass123!"
    assert stored.startswith("$argon2")
    assert verify_password("SecurePass123!", stored)
    assert not verify_password("wrong-password", stored)


def test_duplicate_email_rejected(client):
    make_user(client, email="dup@example.com")
    invite = make_invite(client["admin"])
    resp = client["api"].post("/api/v1/auth/register", json={
        "invite_code": invite,
        "email": "DUP@example.com",
        "password": "SecurePass123!",
        "device_name": "PC",
    })
    # 防止账号枚举：重复邮箱与通用注册失败返回相同状态码与文案
    assert resp.status_code == 400


def test_login_wrong_password(client):
    user = make_user(client)
    resp = client["api"].post("/api/v1/auth/login", json={
        "email": user["email"],
        "password": "WrongPass999!",
        "device_name": "PC-A",
    })
    assert resp.status_code == 401


def test_sixth_device_rejected(client):
    user = make_user(client, device_name="device-1")
    for index in range(2, 7):
        resp = client["api"].post("/api/v1/auth/login", json={
            "email": user["email"],
            "password": user["password"],
            "device_name": f"device-{index}",
        })
        if index <= 5:
            assert resp.status_code == 200, resp.text
        else:
            assert resp.status_code == 403, resp.text


def test_reuse_same_device_name_does_not_count(client):
    user = make_user(client, device_name="work-laptop")
    for _ in range(3):
        resp = client["api"].post("/api/v1/auth/login", json={
            "email": user["email"],
            "password": user["password"],
            "device_name": "work-laptop",
        })
        assert resp.status_code == 200
    # still only one device
    sessions = client["api"].get("/api/v1/sessions", headers=auth_headers(user["access_token"]))
    assert len(sessions.json()) == 1


def test_revoked_session_immediately_invalid(client):
    user = make_user(client, device_name="revocable")
    me = client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"]))
    assert me.status_code == 200
    device_id = user["device_id"]
    resp = client["api"].delete(
        f"/api/v1/sessions/{device_id}",
        headers=auth_headers(user["access_token"]),
    )
    assert resp.status_code == 204
    # same access token now rejected
    after = client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"]))
    assert after.status_code == 401


def test_logout_revokes_refresh_token(client):
    user = make_user(client)
    resp = client["api"].post("/api/v1/auth/logout", headers=auth_headers(user["access_token"]))
    assert resp.status_code == 204
    refresh = client["api"].post("/api/v1/auth/refresh", json={"refresh_token": user["refresh_token"]})
    assert refresh.status_code == 401


def test_refresh_rotation(client):
    user = make_user(client)
    first = client["api"].post("/api/v1/auth/refresh", json={"refresh_token": user["refresh_token"]})
    assert first.status_code == 200
    new_refresh = first.json()["refresh_token"]
    assert new_refresh != user["refresh_token"]
    # old refresh token no longer valid after rotation
    old = client["api"].post("/api/v1/auth/refresh", json={"refresh_token": user["refresh_token"]})
    assert old.status_code == 401
    # new one works
    again = client["api"].post("/api/v1/auth/refresh", json={"refresh_token": new_refresh})
    assert again.status_code == 200


def test_login_rate_limited(client):
    user = make_user(client)
    last = None
    for _ in range(15):
        last = client["api"].post("/api/v1/auth/login", json={
            "email": user["email"],
            "password": "wrongpass",
            "device_name": "x",
        })
    assert last.status_code == 429


def test_database_rate_limit_is_atomic_across_workers(client):
    from concurrent.futures import ThreadPoolExecutor

    from app.database import get_session
    from app.security import allow_request_db

    def hit(_):
        db = get_session()
        try:
            return allow_request_db(db, "concurrent-bucket", 1, 60)
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(hit, (1, 2)))

    assert sorted(results) == [False, True]


def test_me_requires_auth(client):
    resp = client["api"].get("/api/v1/me")
    assert resp.status_code == 401


def test_register_rejects_short_password(client):
    invite = make_invite(client["admin"])
    resp = client["api"].post("/api/v1/auth/register", json={
        "invite_code": invite,
        "email": f"short-{secrets.token_hex(2)}@example.com",
        "password": "short",
        "device_name": "PC",
    })
    assert resp.status_code == 422
