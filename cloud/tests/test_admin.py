"""Admin acceptance tests: separate auth, admin routes absent from public app,
invite/user/session/settings management, audit logging, no secrets in logs."""

import uuid
import logging

from .helpers import auth_headers, make_user


def _admin_token(client):
    resp = client["admin"].post("/api/v1/admin/login", json={
        "username": "admin",
        "password": "correct-horse-battery-staple",
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def test_admin_wrong_password(client):
    resp = client["admin"].post("/api/v1/admin/login", json={
        "username": "admin",
        "password": "nope",
    })
    assert resp.status_code == 401


def test_admin_routes_not_exposed_on_public_app(client):
    for path in ("/api/v1/admin/users", "/api/v1/admin/invites", "/api/v1/admin/usage", "/api/v1/admin/audit"):
        resp = client["api"].get(path, headers=auth_headers("whatever"))
        assert resp.status_code in (404, 401), (path, resp.status_code)
    # the admin-only routes exist on the admin app
    resp = client["admin"].get("/api/v1/admin/users", headers=auth_headers("bogus"))
    assert resp.status_code == 401  # auth enforced, not 404


def test_invite_created_and_usable(client):
    token = _admin_token(client)
    created = client["admin"].post(
        "/api/v1/admin/invites",
        json={"expires_days": 7},
        headers=auth_headers(token),
    )
    assert created.status_code == 200, created.text
    code = created.json()["code"]
    assert code.startswith("HOYO-")
    listed = client["admin"].get("/api/v1/admin/invites", headers=auth_headers(token))
    assert listed.status_code == 200
    assert listed.json()[0]["status"] == "unused"
    # list response must not contain the plaintext code again
    assert "code" not in listed.json()[0]

    resp = client["api"].post("/api/v1/auth/register", json={
        "invite_code": code,
        "email": "invitee@example.com",
        "password": "SecurePass123!",
        "device_name": "PC",
    })
    assert resp.status_code == 200


def test_revoke_invite_blocks_use(client):
    token = _admin_token(client)
    created = client["admin"].post("/api/v1/admin/invites", json={}, headers=auth_headers(token))
    invite_id = created.json()["id"]
    code = created.json()["code"]
    revoked = client["admin"].delete(f"/api/v1/admin/invites/{invite_id}", headers=auth_headers(token))
    assert revoked.status_code == 204
    resp = client["api"].post("/api/v1/auth/register", json={
        "invite_code": code,
        "email": "revoked@example.com",
        "password": "SecurePass123!",
        "device_name": "PC",
    })
    assert resp.status_code == 400


def test_invite_multi_use_consumes_max_uses(client):
    token = _admin_token(client)
    created = client["admin"].post(
        "/api/v1/admin/invites",
        json={"expires_days": 7, "max_uses": 2},
        headers=auth_headers(token),
    )
    code = created.json()["code"]
    for index in range(2):
        resp = client["api"].post("/api/v1/auth/register", json={
            "invite_code": code,
            "email": f"multi-{index}@example.com",
            "password": "SecurePass123!",
            "device_name": f"PC-{index}",
        })
        assert resp.status_code == 200, resp.text
    third = client["api"].post("/api/v1/auth/register", json={
        "invite_code": code,
        "email": "multi-2@example.com",
        "password": "SecurePass123!",
        "device_name": "PC-2",
    })
    assert third.status_code == 400


def test_disable_user_revokes_sessions(client):
    token = _admin_token(client)
    user = make_user(client)
    assert client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"])).status_code == 200

    user_id = client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"])).json()["id"]
    resp = client["admin"].patch(
        f"/api/v1/admin/users/{user_id}",
        json={"status": "disabled"},
        headers=auth_headers(token),
    )
    assert resp.status_code == 200
    # access token now rejected and refresh fails
    assert client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"])).status_code == 403
    assert client["api"].post("/api/v1/auth/refresh", json={"refresh_token": user["refresh_token"]}).status_code in (401, 403)
    assert client["api"].post("/api/v1/auth/login", json={
        "email": user["email"], "password": user["password"], "device_name": "PC2",
    }).status_code == 403


def test_revoke_sessions_endpoint(client):
    token = _admin_token(client)
    user = make_user(client)
    me = client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"])).json()
    user_id = me["id"]
    resp = client["admin"].post(
        f"/api/v1/admin/users/{user_id}/revoke-sessions",
        headers=auth_headers(token),
    )
    assert resp.status_code == 204
    assert client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"])).status_code == 401


def test_usage_summary_aggregates(client):
    token = _admin_token(client)
    user = make_user(client)
    from app.modules.agent.router import _agent_service
    from app.modules.agent.provider import FakeProvider

    _agent_service.provider_override = FakeProvider(plan=[{"content": "ok"}])
    client["api"].post(
        "/api/v1/agent/plan",
        json={"message": "查看日程"},
        headers=auth_headers(user["access_token"]),
    )
    resp = client["admin"].get("/api/v1/admin/usage?days=7", headers=auth_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_request_count"] == 1
    assert body["total_prompt_tokens"] >= 0
    assert len(body["per_user"]) == 1


def test_settings_roundtrip_and_audit(client):
    token = _admin_token(client)
    set_resp = client["admin"].put(
        "/api/v1/admin/settings",
        json={"ai_enabled": True, "ai_monthly_budget_usd": 5.0},
        headers=auth_headers(token),
    )
    assert set_resp.status_code == 200
    assert set_resp.json()["ai_monthly_budget_usd"] == 5.0

    audit = client["admin"].get("/api/v1/admin/audit", headers=auth_headers(token))
    assert audit.status_code == 200
    actions = [entry["action"] for entry in audit.json()]
    assert "settings.update" in actions

    # no password or token strings leak into audit entries
    for entry in audit.json():
        dumped = str(entry)
        assert "correct-horse-battery-staple" not in dumped
        assert "SecurePass123" not in dumped
        assert token not in dumped


def test_key_admin_ops_are_audited(client):
    token = _admin_token(client)
    created = client["admin"].post("/api/v1/admin/invites", json={}, headers=auth_headers(token))
    invite_id = created.json()["id"]
    client["admin"].delete(f"/api/v1/admin/invites/{invite_id}", headers=auth_headers(token))
    audit = client["admin"].get("/api/v1/admin/audit", headers=auth_headers(token)).json()
    actions = [entry["action"] for entry in audit]
    assert "invite.create" in actions
    assert "invite.revoke" in actions


def test_admin_endpoints_require_auth(client):
    assert client["admin"].get("/api/v1/admin/users").status_code == 401
    assert client["admin"].get("/api/v1/admin/audit").status_code == 401
