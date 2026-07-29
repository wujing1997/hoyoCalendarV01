'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuickCommand } = require('../src/core/quick-parser');

const now = new Date(2026, 6, 30);

test('parses a deadline without using the agent', () => {
  const result = parseQuickCommand('8月10号前写完论文', {
    now,
    contextDate: '2026-07-30',
  });
  assert.equal(result.intent, 'create');
  assert.equal(result.requiresAgent, false);
  assert.equal(result.event.event, '写完论文');
  assert.equal(result.event.startDate, '2026-07-30');
  assert.equal(result.event.deadlineDate, '2026-08-10');
  assert.equal(result.event.isDeadline, true);
});

test('parses a day-only deadline in the current month', () => {
  const result = parseQuickCommand('31号之前完成论文附录', {
    now,
    contextDate: '2026-07-30',
  });
  assert.equal(result.event.event, '完成论文附录');
  assert.equal(result.event.deadlineDate, '2026-07-31');
});

test('parses weekly recurrence and strips schedule words from title', () => {
  const result = parseQuickCommand('每周三和周五去健身房，持续到8月31号', {
    now,
    contextDate: '2026-07-30',
  });
  assert.equal(result.event.isRecurring, true);
  assert.equal(result.event.recurringType, 'weekly');
  assert.deepEqual(result.event.recurringDays, [3, 5]);
  assert.equal(result.event.endDate, '2026-08-31');
  assert.equal(result.event.event, '去健身房');
});

test('routes existing-event mutations to the agent', () => {
  const result = parseQuickCommand('把明天的会议改到后天', {
    now,
    contextDate: '2026-07-30',
  });
  assert.equal(result.intent, 'agent');
  assert.equal(result.requiresAgent, true);
});

test('recognizes a punctuated schedule question as a local query', () => {
  const result = parseQuickCommand('明天有什么安排？', {
    now,
    contextDate: '2026-07-30',
  });
  assert.equal(result.intent, 'query');
  assert.equal(result.date, '2026-07-31');
});

test('does not treat the word 前往 as a deadline marker', () => {
  const result = parseQuickCommand('明天前往图书馆', {
    now,
    contextDate: '2026-07-30',
  });
  assert.equal(result.event.isDeadline, undefined);
  assert.equal(result.event.event, '前往图书馆');
  assert.equal(result.event.date, '2026-07-31');
});

test('parses time and duration locally', () => {
  const result = parseQuickCommand('明天下午3点项目评审45分钟', {
    now,
    contextDate: '2026-07-30',
  });
  assert.equal(result.event.date, '2026-07-31');
  assert.equal(result.event.time, '15:00');
  assert.equal(result.event.targetDurationMinutes, 45);
  assert.equal(result.event.event, '项目评审');
});
