'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventStore } = require('../src/core/event-store');
const { CommandRouter } = require('../src/core/command-router');

function tempStore(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoyo-command-test-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return new EventStore({ dataDir });
}

test('quick create persists locally and notifies local change once (logged-in online path)', (t) => {
  const store = tempStore(t);
  const changes = [];
  const router = new CommandRouter(store, { onLocalChange: (id, op) => changes.push({ id, op }) });
  const result = router.execute('明天9点项目会议45分钟', '2026-08-10');
  assert.equal(result.handled, true);
  assert.equal(result.route, 'local-create');
  assert.equal(result.success, true);
  assert.ok(result.event.id);
  assert.equal(store.getEvent(result.event.id).event, '项目会议');
  assert.deepEqual(changes, [{ id: result.event.id, op: 'upsert' }]);
});

test('quick create notifies even when offline or signed out so the change stays queued', (t) => {
  const store = tempStore(t);
  let notified = 0;
  const router = new CommandRouter(store, { onLocalChange: () => { notified += 1; } });
  const result = router.execute('周三交周报', '2026-08-10');
  assert.equal(result.success, true);
  assert.equal(notified, 1);
  assert.equal(store.getEvent(result.event.id).event, '交周报');
});

test('create failure does not notify local change and reports failure', (t) => {
  const store = {
    addEvent: () => null,
    getEventsByDate: () => [],
  };
  let notified = 0;
  const router = new CommandRouter(store, { onLocalChange: () => { notified += 1; } });
  const result = router.execute('明天9点开会', '2026-08-10');
  assert.equal(result.handled, true);
  assert.equal(result.success, false);
  assert.equal(result.event, undefined);
  assert.equal(notified, 0);
});

test('without a hook the router still creates locally (backward compatible)', (t) => {
  const store = tempStore(t);
  const router = new CommandRouter(store);
  const result = router.execute('后天去体检', '2026-08-10');
  assert.equal(result.success, true);
  assert.equal(store.getEvent(result.event.id).event, '去体检');
});

test('other command routes do not create events or fire local change notifications', (t) => {
  const store = tempStore(t);
  let notified = 0;
  const router = new CommandRouter(store, { onLocalChange: () => { notified += 1; } });
  const empty = router.execute('   ', '2026-08-10');
  assert.equal(empty.handled, false);
  assert.equal(empty.route, 'empty');
  const query = router.execute('8月10号有什么安排', '2026-08-10');
  assert.equal(query.handled, true);
  assert.equal(query.route, 'local-query');
  const agent = router.execute('把明天的会议改到后天', '2026-08-10');
  assert.equal(agent.handled, false);
  assert.equal(agent.route, 'agent');
  assert.equal(notified, 0);
  assert.equal(store.loadEvents().length, 0);
});
