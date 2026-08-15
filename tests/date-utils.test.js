'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addDays,
  monthEnd,
  monthStart,
  startOfDay,
  viewRange,
  viewRangeIncludesDate,
  viewRangeTitle,
  weekStart,
} = require('../src/core/date-utils');

function d(iso) {
  return startOfDay(new Date(iso));
}

test('day view range is the selected date itself', () => {
  const { start, end } = viewRange('day', d('2026-08-15'));
  assert.deepEqual(start, d('2026-08-15'));
  assert.deepEqual(end, d('2026-08-15'));
});

test('week view range spans Sunday to Saturday around the selected date', () => {
  const { start, end } = viewRange('week', d('2026-08-15'));
  assert.deepEqual(start, d('2026-08-09'));
  assert.deepEqual(end, d('2026-08-15'));
});

test('week view on a Sunday keeps that week', () => {
  const { start, end } = viewRange('week', d('2026-08-09'));
  assert.deepEqual(start, d('2026-08-09'));
  assert.deepEqual(end, d('2026-08-15'));
});

test('week view on a Saturday keeps that week', () => {
  const { start, end } = viewRange('week', d('2026-08-15'));
  assert.deepEqual(end, d('2026-08-15'));
});

test('month view range spans the full month', () => {
  const { start, end } = viewRange('month', d('2026-08-15'));
  assert.deepEqual(start, monthStart(d('2026-08-15')));
  assert.deepEqual(end, monthEnd(d('2026-08-15')));
  assert.equal(end.getDate(), 31);
});

test('viewRangeIncludesDate is true inside the day/week/month range and false outside', () => {
  assert.equal(viewRangeIncludesDate('day', d('2026-08-15'), d('2026-08-15')), true);
  assert.equal(viewRangeIncludesDate('day', d('2026-08-15'), d('2026-08-14')), false);
  assert.equal(viewRangeIncludesDate('week', d('2026-08-15'), d('2026-08-12')), true);
  assert.equal(viewRangeIncludesDate('week', d('2026-08-15'), d('2026-08-08')), false);
  assert.equal(viewRangeIncludesDate('week', d('2026-08-15'), d('2026-08-16')), false);
  assert.equal(viewRangeIncludesDate('month', d('2026-08-15'), d('2026-08-01')), true);
  assert.equal(viewRangeIncludesDate('month', d('2026-08-15'), d('2026-08-31')), true);
  assert.equal(viewRangeIncludesDate('month', d('2026-08-15'), d('2026-07-31')), false);
});

test('week range edge includes the first day of a boundary week', () => {
  assert.equal(viewRangeIncludesDate('week', d('2026-08-01'), d('2026-07-26')), true);
  assert.equal(viewRangeIncludesDate('week', d('2026-08-01'), d('2026-08-01')), true);
  assert.equal(viewRangeIncludesDate('week', d('2026-08-01'), d('2026-08-02')), false);
});

test('day view title always includes the year', () => {
  assert.equal(viewRangeTitle('day', d('2026-08-15')), '2026年8月15日');
  assert.equal(viewRangeTitle('day', d('2027-01-01')), '2027年1月1日');
});

test('month view title includes the year', () => {
  assert.equal(viewRangeTitle('month', d('2026-08-15')), '2026年8月');
  assert.equal(viewRangeTitle('month', d('2026-01-01')), '2026年1月');
  assert.equal(viewRangeTitle('month', d('2026-12-31')), '2026年12月');
});

test('same-year week title includes the year once', () => {
  assert.equal(viewRangeTitle('week', d('2026-08-15')), '2026年8月9日 – 8月15日');
});

test('cross-month week title keeps the single year', () => {
  assert.equal(viewRangeTitle('week', d('2026-08-01')), '2026年7月26日 – 8月1日');
});

test('cross-year week title shows both years to avoid ambiguity', () => {
  const newYearWeek = viewRange('week', d('2027-01-01'));
  assert.deepEqual(newYearWeek.start, d('2026-12-27'));
  assert.deepEqual(newYearWeek.end, d('2027-01-02'));
  assert.equal(viewRangeTitle('week', d('2027-01-01')), '2026年12月27日 – 2027年1月2日');
});

test('cross-year week title when the week starts in the new year', () => {
  assert.equal(viewRangeTitle('week', d('2027-01-04')), '2027年1月3日 – 1月9日');
});

test('weekStart and monthStart helpers behave at year boundaries', () => {
  assert.deepEqual(weekStart(d('2027-01-01')), d('2026-12-27'));
  assert.deepEqual(monthStart(d('2026-12-15')), d('2026-12-01'));
  assert.deepEqual(addDays(d('2026-12-31'), 1), d('2027-01-01'));
});
