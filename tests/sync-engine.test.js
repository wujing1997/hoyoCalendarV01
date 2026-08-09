'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventStore } = require('../src/core/event-store');
const { SyncEngine, SYNC_STATUS } = require('../src/core/sync-engine');

function createEngine(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoyo-sync-test-'));
  const store = new EventStore({ dataDir });
  const api = new FakeCloudApi();
  const engine = new SyncEngine({
    eventStore: store,
    api,
    dataDir,
    deviceName: '测试机',
    isOnline: () => options.online !== false,
    credentialStore: {
      getRefreshToken: async () => options.refreshToken || null,
      setRefreshToken: async () => {},
      clearRefreshToken: async () => {},
    },
  });
  engine.__store = store;
  engine.__api = api;
  engine.__dataDir = dataDir;
  return engine;
}

class FakeCloudApi {
  constructor() {
    this.users = new Map();
    this.events = new Map();
    this.seq = 0;
    this.conflicts = new Map();
    this.pushResponses = [];
    this.failNext = null;
    this.refreshToken = 'test-refresh-token';
    this.authenticated = true;
  }

  setTokens() {}

  async me() {
    return { id: 'user-1', email: 'a@b.c', status: 'active' };
  }

  async refreshSession() {
    return this.authenticated;
  }

  async login() {
    return { access_token: 'a', refresh_token: 'r', expires_in: 900, device_id: 'd-1' };
  }

  async register() {
    return { access_token: 'a', refresh_token: 'r', expires_in: 900, device_id: 'd-1' };
  }

  async logout() {}

  seedServerEvent(eventId, data, version = 1, operationId = `op-${eventId}`, deleted = false) {
    this.seq += 1;
    this.events.set(eventId, {
      eventId,
      version,
      operationId,
      seq: this.seq,
      deleted,
      trashUntil: deleted ? '2099-12-31' : null,
      data,
    });
  }

  async pull(cursor, limit = 500) {
    if (this.failNext === 'pull') {
      this.failNext = null;
      throw new Error('ECONNREFUSED');
    }
    const all = [...this.events.values()].sort((a, b) => a.seq - b.seq);
    const events = all.filter((event) => event.seq > (cursor || 0)).slice(0, limit);
    return { cursor: events.length ? events[events.length - 1].seq : cursor || 0, hasMore: false, reconcileRequired: false, events };
  }

  async push(changes) {
    if (this.failNext === 'push') {
      this.failNext = null;
      throw new Error('ECONNREFUSED');
    }
    if (this.pushResponses.length) return this.pushResponses.shift();
    const results = [];
    for (const change of changes) {
      const server = this.events.get(change.eventId);
      if (server && server.version > change.baseVersion && server.operationId !== change.operationId) {
        results.push({
          eventId: change.eventId,
          status: 'conflict',
          version: server.version,
          serverVersion: server.version,
          data: change.data,
          serverData: server.data,
          deleted: server.deleted,
          message: '版本冲突',
        });
        continue;
      }
      this.seq += 1;
      const nextVersion = Math.max(change.baseVersion, server?.version || 0) + 1;
      this.events.set(change.eventId, {
        eventId: change.eventId,
        version: nextVersion,
        operationId: change.operationId,
        seq: this.seq,
        deleted: change.op === 'delete',
        trashUntil: change.op === 'delete' ? '2099-12-31' : null,
        data: change.op === 'delete' ? null : change.data,
      });
      results.push({ eventId: change.eventId, status: 'applied', version: nextVersion, serverVersion: nextVersion });
    }
    return { results, cursor: this.seq };
  }

  async trash() {
    return {
      items: [...this.events.values()]
        .filter((event) => event.deleted && event.data)
        .map((event) => ({
          eventId: event.eventId,
          version: event.version,
          deletedAt: '2026-08-01T00:00:00Z',
          trashUntil: event.trashUntil,
          data: event.data,
        })),
    };
  }

  async restore(eventId) {
    const event = this.events.get(eventId);
    if (!event || !event.deleted) throw new Error('not trashed');
    this.seq += 1;
    event.deleted = false;
    event.trashUntil = null;
    event.version += 1;
    event.operationId = `op-restore-${eventId}`;
    event.seq = this.seq;
    return { ...event };
  }

  async agentPlan() {
    return { message: 'ok', actions: [], usage: { model: 'x' }, budget: {} };
  }
}

function drainTimers(engine) {
  if (engine.flushTimer) clearTimeout(engine.flushTimer);
  engine.flushTimer = null;
  if (engine.heartbeatTimer) clearInterval(engine.heartbeatTimer);
  engine.heartbeatTimer = null;
}

async function withEngine(options, callback) {
  const engine = createEngine(options);
  try {
    await callback(engine);
  } finally {
    drainTimers(engine);
    fs.rmSync(engine.__dataDir, { recursive: true, force: true });
  }
}

test('migration assigns stable UUIDs and creates a backup once', () => {
  withEngine({}, (engine) => {
    const legacy = [
      { id: 1730000000001, event: '旧任务', date: '2026-08-01', time: '09:00', calendar: '个人' },
      { id: 1730000000002, event: '旧Deadline', date: '2026-08-01', startDate: '2026-08-01', deadlineDate: '2026-08-05', isDeadline: true },
    ];
    fs.writeFileSync(path.join(engine.__dataDir, 'events.json'), JSON.stringify(legacy), 'utf8');
    const first = engine.migrateLocalEvents();
    assert.equal(first.assignedUuids, 2);
    assert.ok(first.backupFile && fs.existsSync(first.backupFile));

    const stored = engine.__store.getAnyEvent(legacy[0].id);
    assert.ok(stored._uuid);
    assert.equal(stored._version, 1);
    assert.equal(stored.event, '旧任务');
    const second = engine.migrateLocalEvents();
    assert.equal(second.assignedUuids, 0);
    assert.equal(engine.__store.getAnyEvent(legacy[0].id)._uuid, stored._uuid);
  });
});

test('local changes enter the queue and status becomes pending', () => {
  withEngine({}, (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '任务', date: '2026-08-01' });
    engine.noteLocalChange(created.id, 'upsert');
    assert.equal(engine.queue.length, 1);
    assert.equal(engine.queue[0].eventId, created._uuid);
    assert.equal(engine.queue[0].op, 'upsert');
    assert.equal(engine.getStatus(), SYNC_STATUS.PENDING);
    assert.ok(!engine.queue[0].data._uuid);
  });
});

test('push applies changes, drains queue and acks versions locally', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '同步任务', date: '2026-08-01' });
    engine.noteLocalChange(created.id, 'upsert');
    await engine.flushPush();
    assert.equal(engine.queue.length, 0);
    const stored = engine.__store.getAnyEvent(created.id);
    assert.equal(stored._version, 1);
    assert.equal(stored._baseVersion, 1);
    assert.equal(engine.getStatus(), SYNC_STATUS.SYNCED);
    assert.equal(engine.__api.events.get(created._uuid).data.event, '同步任务');
  });
});

test('push conflict keeps both versions and sets conflict status', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '本机版本', date: '2026-08-01' });
    engine.__api.seedServerEvent(created._uuid, { event: '云端版本', date: '2026-08-01' }, 3, 'op-remote');
    engine.noteLocalChange(created.id, 'upsert');
    await engine.flushPush();
    assert.equal(engine.queue.length, 0);
    assert.equal(engine.state.conflicts.length, 1);
    assert.equal(engine.getStatus(), SYNC_STATUS.CONFLICT);
    const conflict = engine.state.conflicts[0];
    assert.equal(conflict.local.event, '本机版本');
    assert.equal(conflict.server.event, '云端版本');
    assert.equal(conflict.serverVersion, 3);
  });
});

test('resolving conflict with local wins writes a new explicit change', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '本机版本', date: '2026-08-01' });
    engine.__api.seedServerEvent(created._uuid, { event: '云端版本', date: '2026-08-01' }, 3, 'op-remote');
    engine.noteLocalChange(created.id, 'upsert');
    await engine.flushPush();
    await engine.resolveConflict(created._uuid, 'local');
    assert.equal(engine.state.conflicts.length, 0);
    assert.equal(engine.queue.length, 1);
    const entry = engine.queue[0];
    assert.equal(entry.baseVersion, 3);
    assert.equal(entry.version, 4);
    await engine.flushPush();
    assert.equal(engine.queue.length, 0);
    assert.equal(engine.__api.events.get(created._uuid).data.event, '本机版本');
    assert.equal(engine.__api.events.get(created._uuid).version, 4);
  });
});

test('resolving conflict with server adopts the cloud version', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '本机版本', date: '2026-08-01' });
    engine.__api.seedServerEvent(created._uuid, { event: '云端版本', date: '2026-08-01' }, 3, 'op-remote');
    engine.noteLocalChange(created.id, 'upsert');
    await engine.flushPush();
    await engine.resolveConflict(created._uuid, 'server');
    assert.equal(engine.state.conflicts.length, 0);
    assert.equal(engine.queue.length, 0);
    const stored = engine.__store.getAnyEvent(created.id);
    assert.equal(stored.event, '云端版本');
    assert.equal(stored._version, 3);
  });
});

test('pull downloads remote events and tracks the cursor', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    engine.__api.seedServerEvent('11111111-1111-4111-8111-111111111111', { event: '远端任务', date: '2026-08-02' }, 1, 'op-1');
    engine.__api.seedServerEvent('22222222-2222-4222-8222-222222222222', { event: '远端任务2', date: '2026-08-03' }, 1, 'op-2');
    await engine.pullAll();
    assert.equal(engine.__store.loadEvents().length, 2);
    assert.equal(engine.state.cursor, 2);
    const stored = engine.__store.findEventByUuid('11111111-1111-4111-8111-111111111111');
    assert.equal(stored._version, 1);
    assert.equal(stored.event, '远端任务');
  });
});

test('remote delete moves the event into local trash', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '将被删除', date: '2026-08-01' });
    engine.__api.seedServerEvent(created._uuid, { event: '将被删除', date: '2026-08-01' }, 2, 'op-del', true);
    await engine.pullAll();
    assert.equal(engine.__store.loadEvents().length, 0);
    assert.equal(engine.__store.listTrash().length, 1);
  });
});

test('remote tombstone without data removes the local event', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '将被清除', date: '2026-08-01' });
    engine.seq = 0;
    engine.__api.events.set(created._uuid, {
      eventId: created._uuid,
      version: 5,
      operationId: 'op-tomb',
      seq: 1,
      deleted: true,
      trashUntil: null,
      data: null,
    });
    await engine.pullAll();
    assert.equal(engine.__store.loadAllEvents().length, 0);
  });
});

test('local delete moves to trash, restore re-enqueues an upsert', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '删除测试', date: '2026-08-01' });
    engine.__store.deleteEvent(created.id);
    assert.equal(engine.__store.loadEvents().length, 0);
    assert.equal(engine.__store.listTrash().length, 1);
    engine.noteLocalChange(created.id, 'delete');
    assert.equal(engine.queue[0].op, 'delete');

    const restored = await engine.restoreFromTrash(created.id, created._uuid);
    assert.equal(restored.ok, true);
    assert.equal(engine.__store.loadEvents().length, 1);
    assert.ok(engine.queue.some((entry) => entry.op === 'upsert'));
  });
});

test('purge removes trash entries older than the retention window', () => {
  withEngine({}, (engine) => {
    const created = engine.__store.addEvent({ event: '过期回收', date: '2026-08-01' });
    engine.__store.deleteEvent(created.id);
    assert.equal(engine.__store.listTrash().length, 1);
    const future = new Date();
    future.setDate(future.getDate() + 40);
    assert.equal(engine.__store.purgeTrash(future), 1);
    assert.equal(engine.__store.listTrash().length, 0);
  });
});

test('firstMerge uploads local-only events when server is empty', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const a = engine.__store.addEvent({ event: '本地一', date: '2026-08-01' });
    const b = engine.__store.addEvent({ event: '本地二', date: '2026-08-02' });
    engine.__store.ensureSyncMetadata();
    const summary = await engine.firstMerge();
    assert.equal(summary.uploaded, 2);
    assert.equal(summary.downloaded, 0);
    assert.equal(engine.queue.length, 2);
    assert.equal(engine.__store.findEventByUuid(a._uuid).event, '本地一');
    assert.equal(engine.__store.findEventByUuid(b._uuid).event, '本地二');
  });
});

test('firstMerge downloads remote events when local is empty', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    engine.__api.seedServerEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { event: '远端', date: '2026-08-05' }, 1, 'op-x');
    const summary = await engine.firstMerge();
    assert.equal(summary.uploaded, 0);
    assert.equal(summary.downloaded, 1);
    assert.equal(engine.__store.loadEvents().length, 1);
  });
});

test('offline keeps local edits queued and reports offline status', () => {
  withEngine({ online: false }, (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const created = engine.__store.addEvent({ event: '离线编辑', date: '2026-08-01' });
    engine.noteLocalChange(created.id, 'upsert');
    assert.equal(engine.getStatus(), SYNC_STATUS.OFFLINE);
    assert.equal(engine.queue.length, 1);
  });
});

test('signed-out users keep local data untouched', async () => {
  await withEngine({}, async (engine) => {
    const created = engine.__store.addEvent({ event: '本地任务', date: '2026-08-01' });
    assert.equal(engine.getStatus(), SYNC_STATUS.SIGNED_OUT);
    assert.equal(engine.__store.getEvent(created.id).event, '本地任务');
    assert.equal(engine.queue.length, 0);
  });
});

test('agentPlan forwards the sanitized snapshot and returns the plan', async () => {
  await withEngine({}, async (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    engine.__store.addEvent({ event: '快照任务', date: '2026-08-01', note: '备注' });
    engine.__api.agentPlan = async (body) => {
      assert.ok(Array.isArray(body.snapshot));
      assert.equal(body.snapshot[0].event, '快照任务');
      assert.equal(body.snapshot[0]._uuid, undefined);
      return { message: '已规划', actions: [{ type: 'create', event: { event: '新任务', date: '2026-08-02' } }], usage: {}, budget: {} };
    };
    const plan = await engine.agentPlan('帮我创建新任务', '2026-08-01');
    assert.equal(plan.actions.length, 1);
    const results = engine.approveActions(plan.actions, new Set([0]));
    assert.equal(results[0].success, true);
    assert.equal(engine.__store.loadEvents().length, 2);
    assert.equal(engine.queue.length, 1);
  });
});

test('partial approval only applies selected actions', () => {
  withEngine({}, (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const existing = engine.__store.addEvent({ event: '待改', date: '2026-08-01' });
    engine.__store.ensureSyncMetadata();
    const actions = [
      { type: 'create', event: { event: '同意的新任务', date: '2026-08-03' } },
      { type: 'update', id: existing.id, updates: { event: '被拒绝的修改' } },
    ];
    const results = engine.approveActions(actions, new Set([0]));
    assert.equal(results.length, 1);
    assert.equal(results[0].type, 'create');
    assert.equal(engine.__store.loadEvents().length, 2);
    assert.equal(engine.__store.getEvent(existing.id).event, '待改');
  });
});

test('approval maps snapshot UUID ids back to local ids', () => {
  withEngine({}, (engine) => {
    engine.account = { userId: 'u1', email: 'a@b.c' };
    engine.state.account = engine.account;
    const existing = engine.__store.addEvent({ event: '待改', date: '2026-08-01' });
    const actions = [
      { type: 'update', id: existing._uuid, updates: { event: '已改' } },
    ];
    const results = engine.approveActions(actions, new Set([0]));
    assert.equal(results.length, 1);
    assert.equal(results[0].success, true);
    assert.equal(engine.__store.getEvent(existing.id).event, '已改');
    assert.equal(engine.queue.length, 1);
  });
});
