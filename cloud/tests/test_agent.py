"""Agent gateway acceptance tests: action-plan only, no body retention,
schema validation, budget circuit breaker, admin master switch."""

import uuid

from .helpers import auth_headers, make_user


def _plan(client, user, message="创建明天的项目会议", snapshot=None):
    payload = {"message": message}
    if snapshot is not None:
        payload["snapshot"] = snapshot
    return client["api"].post(
        "/api/v1/agent/plan",
        json=payload,
        headers=auth_headers(user["access_token"]),
    )


def _set_agent_service_provider(plan):
    from app.modules.agent.router import _agent_service
    from app.modules.agent.provider import FakeProvider

    _agent_service.provider_override = FakeProvider(plan=plan)
    return _agent_service


def test_plan_returns_structured_actions(client):
    _set_agent_service_provider([
        {"tool_calls": [{"name": "create_event", "arguments": {"event": "云会议", "date": "2026-08-10", "time": "14:00"}}]},
        {"content": "已规划 1 项日程变更。"},
    ])
    user = make_user(client)
    resp = _plan(client, user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["configured"] is True
    assert len(body["actions"]) == 1
    action = body["actions"][0]
    assert action["type"] == "create"
    assert action["event"]["event"] == "云会议"


def test_agent_does_not_write_events(client):
    _set_agent_service_provider([
        {"tool_calls": [{"name": "create_event", "arguments": {"event": "不应落库", "date": "2026-08-10"}}]},
        {"content": "已规划。"},
    ])
    user = make_user(client)
    _plan(client, user)
    pulled = client["api"].get("/api/v1/sync/pull", headers=auth_headers(user["access_token"]))
    assert pulled.json()["events"] == []


def test_no_body_persisted_only_metadata(client):
    _set_agent_service_provider([
        {"tool_calls": [{"name": "create_event", "arguments": {"event": "秘密任务", "date": "2026-08-10"}}]},
        {"content": "这是模型回复正文，不应留存。"},
    ])
    user = make_user(client)
    _plan(client, user, message="帮我创建秘密任务")

    from app.database import get_session
    from app import models
    from sqlalchemy import select

    db = get_session()
    rows = db.execute(select(models.AiUsage)).scalars().all()
    db.close()
    assert len(rows) == 1
    usage = rows[0]
    assert usage.prompt_tokens >= 0
    assert usage.estimated_cost_usd is not None
    # No table in the schema stores message/snapshot/reply bodies.
    assert usage.model


def test_snapshot_and_message_not_in_usage_columns(client):
    _set_agent_service_provider([{"content": "查询完成。"}])
    user = make_user(client)
    _plan(client, user, message="查看日程")
    from app.database import get_session
    from app import models
    from sqlalchemy import select

    db = get_session()
    row = db.execute(select(models.AiUsage)).scalars().first()
    db.close()
    dumped = {c.name: getattr(row, c.name) for c in models.AiUsage.__table__.columns}
    assert "查看日程" not in str(dumped)
    assert "查询完成" not in str(dumped)


def test_plan_requires_message(client):
    user = make_user(client)
    resp = client["api"].post(
        "/api/v1/agent/plan",
        json={"message": ""},
        headers=auth_headers(user["access_token"]),
    )
    assert resp.status_code == 422


def test_plan_rejects_oversized_snapshot(client):
    user = make_user(client)
    snapshot = [{"event": f"e{i}"} for i in range(501)]
    resp = client["api"].post(
        "/api/v1/agent/plan",
        json={"message": "查看", "snapshot": snapshot},
        headers=auth_headers(user["access_token"]),
    )
    assert resp.status_code == 422


def test_budget_circuit_breaker_blocks_ai_only(client):
    from app.modules.agent.router import _agent_service
    from app.modules.agent.provider import FakeProvider

    _agent_service.provider_override = FakeProvider(plan=[{"content": "ok"}])
    user = make_user(client)
    token = client["admin"]
    admin_resp = token.post("/api/v1/admin/login", json={"username": "admin", "password": "correct-horse-battery-staple"})
    admin_token = admin_resp.json()["token"]
    set_resp = token.put(
        "/api/v1/admin/settings",
        json={"ai_enabled": True, "ai_monthly_budget_usd": 0.01},
        headers=auth_headers(admin_token),
    )
    assert set_resp.status_code == 200, set_resp.text

    # seed spend beyond the tiny budget
    from app.database import get_session
    from app import models

    db = get_session()
    me = client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"])).json()
    db.add(models.AiUsage(
        user_id=me["id"], model="test", prompt_tokens=1000,
        completion_tokens=1000, estimated_cost_usd=0.05, latency_ms=1,
        status="success",
    ))
    db.commit()
    db.close()

    agent_resp = _plan(client, user)
    assert agent_resp.status_code == 429

    # calendar and sync are unaffected
    assert client["api"].get("/healthz").status_code == 200
    assert client["api"].get("/api/v1/me", headers=auth_headers(user["access_token"])).status_code == 200


def test_admin_switch_disables_ai(client):
    from app.modules.agent.router import _agent_service
    from app.modules.agent.provider import FakeProvider

    _agent_service.provider_override = FakeProvider(plan=[{"content": "ok"}])
    user = make_user(client)
    admin_resp = client["admin"].post("/api/v1/admin/login", json={"username": "admin", "password": "correct-horse-battery-staple"})
    admin_token = admin_resp.json()["token"]
    set_resp = client["admin"].put(
        "/api/v1/admin/settings",
        json={"ai_enabled": False, "ai_monthly_budget_usd": 0.0},
        headers=auth_headers(admin_token),
    )
    assert set_resp.status_code == 200

    agent_resp = _plan(client, user)
    assert agent_resp.status_code == 503
    assert client["api"].get("/healthz").status_code == 200


def test_agent_requires_auth(client):
    resp = client["api"].post("/api/v1/agent/plan", json={"message": "hi"})
    assert resp.status_code == 401


def test_agent_not_configured_without_provider(client):
    from app.modules.agent.router import _agent_service

    _agent_service.provider_override = None
    user = make_user(client)
    resp = _plan(client, user)
    assert resp.status_code == 503
