"""Regression: numeric event ids in client snapshots must not 500 /plan.

The model may echo a numeric id (legacy migrated client data) back in an
update/delete action. AgentAction.id is Optional[str]; strict validation
rejected numbers, so /plan returned 500 after a successful upstream call.
"""

from .helpers import auth_headers, make_user


def _plan(client, user, message="更新日程", snapshot=None):
    payload = {"message": message}
    if snapshot is not None:
        payload["snapshot"] = snapshot
    return client["api"].post(
        "/api/v1/agent/plan",
        json=payload,
        headers=auth_headers(user["access_token"]),
    )


def test_numeric_action_id_from_snapshot_update(client):
    from app.modules.agent.router import _agent_service
    from app.modules.agent.provider import FakeProvider

    _agent_service.provider_override = FakeProvider(plan=[
        {"tool_calls": [{"name": "list_events", "arguments": {"keyword": "旧标题"}}]},
        {"tool_calls": [{"name": "update_event", "arguments": {
            "id": 1786787598130001, "event": "改标题", "scope": "all",
        }}]},
        {"content": "已规划。"},
    ])
    user = make_user(client)
    snapshot = [
        {"id": 1786787598130001, "event": "旧标题", "date": "2026-08-10"},
        {"id": "uuid-string-id", "event": "另一条", "date": "2026-08-11"},
    ]
    resp = _plan(client, user, snapshot=snapshot)
    assert resp.status_code == 200, resp.text
    actions = resp.json()["actions"]
    assert len(actions) == 1
    assert actions[0]["type"] == "update"
    assert actions[0]["id"] in ("1786787598130001", 1786787598130001)


def test_numeric_action_id_from_snapshot_delete(client):
    from app.modules.agent.router import _agent_service
    from app.modules.agent.provider import FakeProvider

    _agent_service.provider_override = FakeProvider(plan=[
        {"tool_calls": [{"name": "list_events", "arguments": {"keyword": "旧标题"}}]},
        {"tool_calls": [{"name": "delete_event", "arguments": {
            "id": 1786787598130001, "scope": "all",
        }}]},
        {"content": "已规划。"},
    ])
    user = make_user(client)
    snapshot = [{"id": 1786787598130001, "event": "旧标题", "date": "2026-08-10"}]
    resp = _plan(client, user, snapshot=snapshot)
    assert resp.status_code == 200, resp.text
    actions = resp.json()["actions"]
    assert len(actions) == 1
    assert actions[0]["type"] == "delete"
    assert actions[0]["id"] in ("1786787598130001", 1786787598130001)
