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


def test_client_ip_trusts_forwarding_only_from_configured_proxy():
    from app.security import get_client_ip

    class Client:
        def __init__(self, host):
            self.host = host

    class Request:
        def __init__(self, peer, forwarded=None):
            self.client = Client(peer)
            self.headers = {"x-forwarded-for": forwarded} if forwarded else {}

    assert get_client_ip(Request("127.0.0.1", "203.0.113.7, 10.0.0.1")) == "203.0.113.7"
    assert get_client_ip(Request("198.51.100.2", "203.0.113.7")) == "198.51.100.2"
    assert get_client_ip(Request("127.0.0.1", "not-an-ip")) == "127.0.0.1"
