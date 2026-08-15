'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(value) {
  const date = startOfDay(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (value instanceof Date) return startOfDay(value);
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

function addDays(value, amount) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + Number(amount || 0));
  return date;
}

function daysBetween(from, to) {
  const left = startOfDay(from);
  const right = startOfDay(to);
  return Math.round((right.getTime() - left.getTime()) / DAY_MS);
}

function clampDate(value, minimum, maximum) {
  const date = startOfDay(value);
  const min = startOfDay(minimum);
  const max = startOfDay(maximum);
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

function weekStart(value) {
  const date = startOfDay(value);
  return addDays(date, -date.getDay());
}

function monthStart(value) {
  const date = startOfDay(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(value) {
  const date = startOfDay(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function viewRange(view, value) {
  const date = startOfDay(value);
  if (view === 'week') {
    const start = weekStart(date);
    return { start, end: addDays(start, 6) };
  }
  if (view === 'month') {
    return { start: monthStart(date), end: monthEnd(date) };
  }
  return { start: date, end: date };
}

function viewRangeIncludesDate(view, value, target) {
  const { start, end } = viewRange(view, value);
  const targetDate = startOfDay(target);
  return targetDate >= start && targetDate <= end;
}

function viewRangeTitle(view, value) {
  const { start, end } = viewRange(view, value);
  const monthDay = (date) => `${date.getMonth() + 1}月${date.getDate()}日`;
  if (view === 'month') {
    return `${start.getFullYear()}年${start.getMonth() + 1}月`;
  }
  if (view === 'week') {
    if (start.getFullYear() !== end.getFullYear()) {
      return `${start.getFullYear()}年${monthDay(start)} – ${end.getFullYear()}年${monthDay(end)}`;
    }
    return `${start.getFullYear()}年${monthDay(start)} – ${monthDay(end)}`;
  }
  return `${start.getFullYear()}年${monthDay(start)}`;
}

module.exports = {
  DAY_MS,
  addDays,
  clampDate,
  daysBetween,
  formatDate,
  monthEnd,
  monthStart,
  parseDate,
  startOfDay,
  viewRange,
  viewRangeIncludesDate,
  viewRangeTitle,
  weekStart,
};
