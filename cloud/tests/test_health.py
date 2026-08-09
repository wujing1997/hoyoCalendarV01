"""Health check and logging redaction tests."""


def test_health(client):
    resp = client["api"].get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database"] == "up"


def test_logs_redact_secrets(client):
    import io
    import logging

    from app.security import redact

    sample = (
        'password="SecurePass123!" token="abcdefg" '
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def '
        'api_key="sk-test-1234"'
    )
    cleaned = redact(sample)
    assert "SecurePass123" not in cleaned
    assert "sk-test-1234" not in cleaned
    assert "eyJhbGci" not in cleaned
    assert "Bearer [REDACTED]" in cleaned
