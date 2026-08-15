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

test('monthly recurring events occur on the selected day numbers only', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '账单日',
      date: '2026-08-01',
      startDate: '2026-08-01',
      endDate: '2026-10-31',
      isRecurring: true,
      recurringType: 'monthly',
      recurringMonthDays: [1, 15],
    });
    for (const day of ['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15', '2026-10-01', '2026-10-15']) {
      const instances = store.getEventsByDate(day);
      assert.equal(instances.length, 1, `${day} should have one instance`);
      assert.equal(instances[0].isRecurringInstance, true);
    }
    assert.equal(store.getEventsByDate('2026-08-02').length, 0);
    assert.equal(store.getEventsByDate('2026-09-16').length, 0);
  });
});

test('monthly recurring events skip non-existent days in short months', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '月末结账',
      date: '2026-08-29',
      startDate: '2026-08-29',
      endDate: '2027-04-30',
      isRecurring: true,
      recurringType: 'monthly',
      recurringMonthDays: [29, 30, 31],
    });
    assert.equal(store.getEventsByDate('2027-01-29').length, 1);
    assert.equal(store.getEventsByDate('2027-01-30').length, 1);
    assert.equal(store.getEventsByDate('2027-01-31').length, 1);
    assert.equal(store.getEventsByDate('2027-02-28').length, 0);
    assert.equal(store.getEventsByDate('2027-03-01').length, 0);
    assert.equal(store.getEventsByDate('2027-03-29').length, 1);
    assert.equal(store.getEventsByDate('2027-03-31').length, 1);
  });
});

test('monthly recurring events without explicit days fall back to the start day', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '月度总结',
      date: '2026-08-10',
      startDate: '2026-08-10',
      endDate: '2026-10-31',
      isRecurring: true,
      recurringType: 'monthly',
    });
    assert.equal(store.getEventsByDate('2026-08-10').length, 1);
    assert.equal(store.getEventsByDate('2026-09-10').length, 1);
    assert.equal(store.getEventsByDate('2026-09-11').length, 0);
  });
});

test('recurringMonthDays are normalized, deduped and clamped to 1-31', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '多日期任务',
      date: '2026-08-05',
      startDate: '2026-08-05',
      endDate: '2026-12-31',
      isRecurring: true,
      recurringType: 'monthly',
      recurringMonthDays: [5, 5, 20, 0, 32, 15],
    });
    assert.deepEqual(event.recurringMonthDays, [5, 20, 15]);
    const weekly = store.addEvent({
      event: '周任务',
      date: '2026-08-05',
      startDate: '2026-08-05',
      endDate: '2026-12-31',
      isRecurring: true,
      recurringType: 'weekly',
      recurringMonthDays: [5, 20],
    });
    assert.equal(weekly.recurringMonthDays, undefined);
  });
});

// ------------------------------------------------------------------ long-term tasks

test('long-term tasks appear every day from start until completion, same id', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '备考',
      date: '2026-08-10',
      startDate: '2026-08-10',
      isLongTerm: true,
    });
    assert.equal(event.isLongTerm, true);
    for (const day of ['2026-08-10', '2026-08-11', '2026-09-01', '2026-12-31']) {
      const instances = store.getEventsByDate(day);
      assert.equal(instances.length, 1, `${day} should show the long-term task`);
      assert.equal(instances[0].id, event.id);
      assert.equal(instances[0].isLongTermInstance, undefined);
    }
    assert.equal(store.getEventsByDate('2026-08-09').length, 0);
  });
});

test('completed long-term tasks stay on the completion day and vanish from future dates', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '备考',
      date: '2026-08-10',
      startDate: '2026-08-10',
      isLongTerm: true,
    });
    store.toggleComplete(event.id, '2026-08-20');
    const completed = store.getEventsByDate('2026-08-20');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].isCompleted, true);
    assert.equal(store.getEventsByDate('2026-08-21').length, 0);
    assert.equal(store.getEventsByDate('2026-08-19').length, 1);
    const restored = store.toggleComplete(event.id, '2026-08-20');
    assert.equal(restored.isCompleted, false);
    assert.equal(store.getEventsByDate('2026-08-21').length, 1);
  });
});

test('long-term flag is mutually exclusive with deadline and recurring fields', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '长期项目',
      date: '2026-08-10',
      startDate: '2026-08-10',
      isLongTerm: true,
      isDeadline: true,
      deadlineDate: '2026-09-01',
      isRecurring: true,
      recurringType: 'daily',
      recurringDays: [1],
      recurringMonthDays: [5],
      completedDates: ['2026-08-11'],
      focusTotalSeconds: 3600,
      focusRunningSince: '2026-08-15T10:00:00.000Z',
    });
    assert.equal(event.isLongTerm, true);
    assert.equal(event.isDeadline, undefined);
    assert.equal(event.isRecurring, undefined);
    assert.equal(event.recurringDays, undefined);
    assert.equal(event.recurringMonthDays, undefined);
    assert.equal(event.completedDates, undefined);
    assert.equal(event.focusTotalSeconds, 3600);
    assert.equal(event.focusRunningSince, '2026-08-15T10:00:00.000Z');

    const normal = store.addEvent({
      event: '普通任务',
      date: '2026-08-10',
      isLongTerm: false,
      focusTotalSeconds: 120,
      focusRunningSince: 'bad-date',
      isCompleted: false,
    });
    assert.equal(normal.isLongTerm, undefined);
    assert.equal(normal.focusTotalSeconds, undefined);
    assert.equal(normal.focusRunningSince, undefined);
  });
});

test('focus fields are sanitized and target duration derives minutes from seconds', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '健身',
      date: '2026-08-10',
      startDate: '2026-08-10',
      isLongTerm: true,
      targetDurationSeconds: 5430,
      focusTotalSeconds: -5,
      focusRunningSince: 'not-a-date',
    });
    assert.equal(event.targetDurationSeconds, 5430);
    assert.equal(event.targetDurationMinutes, 91);
    assert.equal(event.focusTotalSeconds, 0);
    assert.equal(event.focusRunningSince, null);

    const legacy = store.addEvent({
      event: '旧任务',
      date: '2026-08-10',
      targetDurationMinutes: 30,
    });
    assert.equal(legacy.targetDurationMinutes, 30);
    assert.equal(legacy.targetDurationSeconds, undefined);
  });
});

test('long-term focus timer accumulates across days without touching per-day records', () => {
  withStore((store) => {
    const event = store.addEvent({
      event: '备考',
      date: '2026-08-10',
      startDate: '2026-08-10',
      isLongTerm: true,
    });
    const start = Date.now();
    store.updateTimer(event.id, '2026-08-10', true);
    store.updateTimer(event.id, '2026-08-10', false);
    const first = store.getTimerRecord(event.id, '2026-08-10');
    assert.ok(first.elapsedSeconds >= 0);
    assert.equal(first.runningSince, null);

    store.updateTimer(event.id, '2026-08-12', true);
    store.updateTimer(event.id, '2026-08-12', false);
    const second = store.getTimerRecord(event.id, '2026-08-12');
    assert.ok(second.elapsedSeconds >= first.elapsedSeconds);
    assert.equal(store.getTimerRecord(event.id, '2026-08-11').elapsedSeconds, second.elapsedSeconds);
    const persisted = store.getEvent(event.id);
    assert.ok(persisted.focusTotalSeconds >= 0);
    assert.equal(persisted.focusRunningSince, null);
    assert.deepEqual(persisted.timerRecords || {}, {});
    assert.ok(Date.now() - start < 100000);
  });
});

test('normal tasks keep per-day timer behavior', () => {
  withStore((store) => {
    const event = store.addEvent({ event: '会议', date: '2026-08-10', targetDurationMinutes: 30 });
    store.updateTimer(event.id, '2026-08-10', true);
    store.updateTimer(event.id, '2026-08-10', false);
    assert.ok(store.getTimerRecord(event.id, '2026-08-10').elapsedSeconds >= 0);
    assert.equal(store.getTimerRecord(event.id, '2026-08-11').elapsedSeconds, 0);
    const persisted = store.getEvent(event.id);
    assert.ok(persisted.timerRecords?.['2026-08-10']);
    assert.equal(persisted.focusTotalSeconds, undefined);
  });
});

test('long-term focus state survives a store restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoyo-longterm-'));
  try {
    const first = new EventStore({ dataDir });
    const event = first.addEvent({
      event: '备考',
      date: '2026-08-10',
      startDate: '2026-08-10',
      isLongTerm: true,
      targetDurationSeconds: 7200,
    });
    first.updateTimer(event.id, '2026-08-10', true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    first.updateTimer(event.id, '2026-08-10', false);

    const second = new EventStore({ dataDir });
    const reloaded = second.getEvent(event.id);
    assert.equal(reloaded.isLongTerm, true);
    assert.equal(reloaded.targetDurationSeconds, 7200);
    assert.ok(reloaded.focusTotalSeconds > 0);
    assert.equal(second.getEventsByDate('2026-08-11').length, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
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
