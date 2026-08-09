'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventStore } = require('../src/core/event-store');
const { CommandRouter } = require('../src/core/command-router');

function withStore(callback) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoyo-v3-test-'));
  const store = new EventStore({ dataDir });
  try {
    callback(store);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('normal tasks stay visible after completion and can be restored', () => {
  withStore((store) => {
    const event = store.addEvent({ event: '项目周会', date: '2026-07-30', time: '09:00' });
    let instance = store.toggleComplete(event.id, '2026-07-30');
    assert.equal(instance.isCompleted, true);
    assert.equal(store.getEventsByDate('2026-07-30')[0].isCompleted, true);

    instance = store.toggleComplete(event.id, '2026-07-30');
    assert.equal(instance.isCompleted, false);
    assert.equal(store.getEventsByDate('2026-07-30')[0].isCompleted, false);
  });
});

test('overdue normal tasks stay in the completion section on the day they are finished', () => {
  withStore((store) => {
    const event = store.addEvent({ event: '补交周报', date: '2026-07-29', time: '17:00' });
    assert.equal(store.getEventsByDate('2026-07-31')[0].isOverdue, true);

    store.toggleComplete(event.id, '2026-07-31');
    const completed = store.getEventsByDate('2026-07-31');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].isCompleted, true);
    assert.equal(store.getEventsByDate('2026-08-01').length, 0);

    store.toggleComplete(event.id, '2026-07-31');
    const restored = store.getEventsByDate('2026-07-31');
    assert.equal(restored.length, 1);
    assert.equal(restored[0].isOverdue, true);
  });
});

test('deadline completion remains restorable even when completed late', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '提交论文',
      date: '2026-07-30',
      startDate: '2026-07-30',
      deadlineDate: '2026-08-01',
      isDeadline: true,
    });

    const overdue = store.getEventsByDate('2026-08-05')[0];
    assert.equal(overdue.isOverdue, true);
    store.toggleComplete(event.id, '2026-08-05');

    const completed = store.getEventsByDate('2026-08-05');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].isCompleted, true);
    assert.equal(store.getEventsByDate('2026-08-06').length, 0);

    store.toggleComplete(event.id, '2026-08-05');
    const restored = store.getEventsByDate('2026-08-05');
    assert.equal(restored.length, 1);
    assert.equal(restored[0].isCompleted, false);
    assert.equal(restored[0].isOverdue, true);
  });
});

test('recurring completion only affects the selected date', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '晚间复盘',
      date: '2026-07-30',
      startDate: '2026-07-30',
      endDate: '2026-08-03',
      isRecurring: true,
      recurringType: 'daily',
    });
    store.toggleComplete(event.id, '2026-07-31');
    assert.equal(store.getEventsByDate('2026-07-31')[0].isCompleted, true);
    assert.equal(store.getEventsByDate('2026-08-01')[0].isCompleted, false);
  });
});

test('command router executes common creation and query locally', () => {
  withStore((store) => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const router = new CommandRouter(store);
    const created = router.execute('明天前写完论文', todayKey);
    assert.equal(created.route, 'local-create');
    assert.equal(created.success, true);
    const query = router.execute('今天有什么安排吗', todayKey);
    assert.equal(query.route, 'local-query');
    assert.equal(query.events.length, 1);
  });
});

test('agent actions are applied in one local transaction', () => {
  withStore((store) => {
    const first = store.addEvent({ event: '旧任务', date: '2026-07-30' });
    const results = store.applyActions([
      { type: 'update', id: first.id, updates: { event: '新标题' } },
      { type: 'create', event: { event: '新增任务', date: '2026-07-31' } },
    ]);
    assert.equal(results.filter((result) => result.success).length, 2);
    assert.equal(store.getEvent(first.id).event, '新标题');
    assert.equal(store.loadEvents().length, 2);
  });
});
