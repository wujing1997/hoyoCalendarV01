'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { CloudApi, CloudApiError, parseBaseUrl } = require('../src/core/cloud-api');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function jsonHandler(status, body) {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

test('parseBaseUrl normalizes host and scheme', () => {
  assert.deepEqual(parseBaseUrl('127.0.0.1:8000'), { origin: 'http://127.0.0.1:8000', isHttps: false });
  assert.deepEqual(parseBaseUrl('https://example.com'), { origin: 'https://example.com', isHttps: true });
  assert.equal(parseBaseUrl('').origin, 'http://127.0.0.1:8000');
});

test('login posts to /api/v1/auth/login and stores tokens', async () => {
  const { server, port } = await startServer((req, res) => {
    assert.equal(req.url, '/api/v1/auth/login');
    assert.equal(req.method, 'POST');
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      assert.equal(body.email, 'a@b.c');
      assert.equal(body.password, 'secret');
      assert.equal(body.device_name, '我的电脑');
      jsonHandler(200, { access_token: 'at', refresh_token: 'rt', expires_in: 900, device_id: 'd1' })(req, res);
    });
  });
  try {
    const api = new CloudApi({ baseUrl: `http://127.0.0.1:${port}` });
    const tokens = await api.login({ email: 'a@b.c', password: 'secret', deviceName: '我的电脑' });
    assert.equal(tokens.access_token, 'at');
    assert.equal(api.bearerToken, 'at');
    assert.equal(api.refreshToken, 'rt');
  } finally {
    server.close();
  }
});

test('register sends invite code and surfaces the server message on 400', async () => {
  const { server, port } = await startServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      assert.equal(body.invite_code, 'CODE-123');
      jsonHandler(400, { detail: '无效的邀请码' })(req, res);
    });
  });
  try {
    const api = new CloudApi({ baseUrl: `http://127.0.0.1:${port}` });
    await assert.rejects(
      () => api.register({ inviteCode: 'CODE-123', email: 'a@b.c', password: '12345678', deviceName: 'd' }),
      (error) => error instanceof CloudApiError && error.status === 400 && error.message === '无效的邀请码',
    );
  } finally {
    server.close();
  }
});

test('authenticated calls attach the bearer header', async () => {
  const { server, port } = await startServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer at-123');
    jsonHandler(200, { id: 'u1', email: 'a@b.c', status: 'active', created_at: '2026-01-01T00:00:00Z' })(req, res);
  });
  try {
    const api = new CloudApi({ baseUrl: `http://127.0.0.1:${port}` });
    api.bearerToken = 'at-123';
    const me = await api.me();
    assert.equal(me.email, 'a@b.c');
  } finally {
    server.close();
  }
});

test('401 on authenticated calls triggers refresh once then retries', async () => {
  let calls = 0;
  const { server, port } = await startServer((req, res) => {
    calls += 1;
    if (req.url === '/api/v1/auth/refresh') {
      jsonHandler(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 900, device_id: 'd1' })(req, res);
      return;
    }
    if (calls === 1) {
      jsonHandler(401, { detail: 'expired' })(req, res);
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer at-new');
    jsonHandler(200, { id: 'u1', email: 'a@b.c', status: 'active', created_at: '2026-01-01T00:00:00Z' })(req, res);
  });
  try {
    const api = new CloudApi({ baseUrl: `http://127.0.0.1:${port}` });
    api.bearerToken = 'at-old';
    api.refreshToken = 'rt-old';
    const me = await api.me();
    assert.equal(me.email, 'a@b.c');
    assert.equal(api.bearerToken, 'at-new');
    assert.equal(calls, 3);
  } finally {
    server.close();
  }
});

test('pull serializes cursor and limit query params', async () => {
  const { server, port } = await startServer((req, res) => {
    assert.equal(req.url, '/api/v1/sync/pull?cursor=42&limit=500');
    jsonHandler(200, { cursor: 42, hasMore: false, reconcileRequired: false, events: [] })(req, res);
  });
  try {
    const api = new CloudApi({ baseUrl: `http://127.0.0.1:${port}` });
    api.bearerToken = 'at';
    const result = await api.pull(42, 500);
    assert.equal(result.cursor, 42);
  } finally {
    server.close();
  }
});

test('push posts changes and maps conflict status without throwing', async () => {
  const { server, port } = await startServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      assert.equal(body.changes[0].eventId, 'e1');
      assert.equal(body.changes[0].op, 'upsert');
      jsonHandler(200, {
        results: [{ eventId: 'e1', status: 'conflict', version: 3, serverVersion: 3, serverData: { event: '云端' }, message: '版本冲突' }],
        cursor: 9,
      })(req, res);
    });
  });
  try {
    const api = new CloudApi({ baseUrl: `http://127.0.0.1:${port}` });
    api.bearerToken = 'at';
    const result = await api.push([{ eventId: 'e1', version: 2, baseVersion: 1, operationId: 'op1', op: 'upsert', data: { event: '本机' } }]);
    assert.equal(result.results[0].status, 'conflict');
  } finally {
    server.close();
  }
});

test('agent plan error carries the readable message and code', async () => {
  const { server, port } = await startServer(jsonHandler(503, { detail: 'AI 未配置或已禁用' }));
  try {
    const api = new CloudApi({ baseUrl: `http://127.0.0.1:${port}` });
    api.bearerToken = 'at';
    await assert.rejects(
      () => api.agentPlan({ message: 'hi' }),
      (error) => error instanceof CloudApiError && error.status === 503 && error.message === 'AI 未配置或已禁用',
    );
  } finally {
    server.close();
  }
});

test('network errors are reported gracefully by health()', async () => {
  const api = new CloudApi({ baseUrl: 'http://127.0.0.1:1' });
  const result = await api.health();
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
});
