'use strict';

const fs = require('fs');
const path = require('path');
const {
  addDays,
  daysBetween,
  formatDate,
  parseDate,
  startOfDay,
} = require('./date-utils');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

class EventStore {
  constructor(options = {}) {
    const baseDir = options.dataDir
      || path.join(process.env.APPDATA || process.env.HOME || process.cwd(), 'HoyoCalendar');
    this.eventsFile = options.eventsFile || path.join(baseDir, 'events.json');
    this.dataDir = path.dirname(this.eventsFile);
    this.idCounter = 0;
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  generateId() {
    this.idCounter += 1;
    return Date.now() * 1000 + this.idCounter;
  }

  normalizeEvent(input) {
    const event = clone(input || {});
    const today = formatDate(new Date());
    event.id = event.id ?? this.generateId();
    event.event = String(event.event || event.title || '未命名任务').trim() || '未命名任务';
    delete event.title;
    event.time = this.normalizeTime(event.time);
    event.location = String(event.location || '').trim();
    event.urgency = event.urgency === 'high' ? 'high' : 'normal';
    event.calendar = String(event.calendar || '个人');
    event.note = String(event.note || '');
    event.timerRecords = event.timerRecords && typeof event.timerRecords === 'object'
      ? event.timerRecords
      : {};

    const targetDuration = asPositiveNumber(event.targetDurationMinutes);
    if (targetDuration) event.targetDurationMinutes = Math.round(targetDuration);
    else delete event.targetDurationMinutes;

    if (event.isDeadline) {
      const startDate = this.validDate(event.startDate || event.date) || today;
      const deadlineDate = this.validDate(event.deadlineDate || event.endDate || event.date) || startDate;
      event.isDeadline = true;
      event.date = startDate;
      event.startDate = startDate;
      event.deadlineDate = deadlineDate < startDate ? startDate : deadlineDate;
      event.isDeadlineCompleted = Boolean(event.isDeadlineCompleted);
      if (!event.isDeadlineCompleted) {
        delete event.deadlineCompletedDate;
        delete event.completedAt;
      }
      delete event.isRecurring;
      delete event.recurringType;
      delete event.recurringDays;
      delete event.completedDates;
      delete event.isCompleted;
      delete event.completedDate;
      return event;
    }

    if (event.isRecurring) {
      const startDate = this.validDate(event.startDate || event.date) || today;
      const fallbackEnd = formatDate(addDays(parseDate(startDate), 30));
      const endDate = this.validDate(event.endDate) || fallbackEnd;
      event.isRecurring = true;
      event.date = startDate;
      event.startDate = startDate;
      event.endDate = endDate < startDate ? startDate : endDate;
      event.recurringType = ['daily', 'weekly', 'monthly'].includes(event.recurringType)
        ? event.recurringType
        : 'daily';
      event.recurringDays = Array.isArray(event.recurringDays)
        ? [...new Set(event.recurringDays.map(Number).filter((day) => day >= 0 && day <= 6))]
        : [];
      event.completedDates = Array.isArray(event.completedDates)
        ? [...new Set(event.completedDates.filter((date) => this.validDate(date)))]
        : [];
      delete event.isDeadline;
      delete event.deadlineDate;
      delete event.isDeadlineCompleted;
      delete event.deadlineCompletedDate;
      delete event.isCompleted;
      delete event.completedDate;
      delete event.completedAt;
      return event;
    }

    event.date = this.validDate(event.date || event.startDate) || today;
    event.isCompleted = Boolean(event.isCompleted || event.completed);
    if (event.isCompleted) {
      const completedAtDate = event.completedAt
        ? this.validDate(new Date(event.completedAt))
        : '';
      event.completedDate = this.validDate(event.completedDate) || completedAtDate || event.date;
    } else {
      delete event.completedAt;
      delete event.completedDate;
    }
    delete event.completed;
    delete event.isDeadline;
    delete event.startDate;
    delete event.endDate;
    delete event.deadlineDate;
    delete event.isDeadlineCompleted;
    delete event.deadlineCompletedDate;
    delete event.isRecurring;
    delete event.recurringType;
    delete event.recurringDays;
    delete event.completedDates;
    return event;
  }

  normalizeTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  validDate(value) {
    const parsed = parseDate(value);
    return parsed ? formatDate(parsed) : '';
  }

  loadEvents() {
    try {
      if (!fs.existsSync(this.eventsFile)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.eventsFile, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.map((event) => this.normalizeEvent(event));
    } catch (error) {
      console.error('[EventStore] Failed to load events:', error);
      return [];
    }
  }

  saveEvents(events) {
    const normalized = (Array.isArray(events) ? events : []).map((event) => this.normalizeEvent(event));
    const tempFile = `${this.eventsFile}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(tempFile, JSON.stringify(normalized, null, 2), 'utf8');
      fs.renameSync(tempFile, this.eventsFile);
      return true;
    } catch (error) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (_) {
        // Best-effort cleanup only.
      }
      console.error('[EventStore] Failed to save events:', error);
      return false;
    }
  }

  addEvent(input) {
    const events = this.loadEvents();
    const now = new Date().toISOString();
    const event = this.normalizeEvent({
      ...input,
      id: input?.id ?? this.generateId(),
      createdAt: input?.createdAt || now,
      updatedAt: now,
    });
    events.push(event);
    return this.saveEvents(events) ? clone(event) : null;
  }

  updateEvent(id, updates) {
    const events = this.loadEvents();
    const index = events.findIndex((event) => String(event.id) === String(id));
    if (index < 0) return null;
    const next = this.normalizeEvent({
      ...events[index],
      ...clone(updates || {}),
      id: events[index].id,
      createdAt: events[index].createdAt,
      updatedAt: new Date().toISOString(),
    });
    events[index] = next;
    return this.saveEvents(events) ? clone(next) : null;
  }

  deleteEvent(id) {
    const events = this.loadEvents();
    const index = events.findIndex((event) => String(event.id) === String(id));
    if (index < 0) return null;
    const [removed] = events.splice(index, 1);
    return this.saveEvents(events) ? clone(removed) : null;
  }

  getEvent(id) {
    const event = this.loadEvents().find((item) => String(item.id) === String(id));
    return event ? clone(event) : null;
  }

  isRecurringOnDate(event, dateStr) {
    if (!event.isRecurring || dateStr < event.startDate || dateStr > event.endDate) return false;
    const date = parseDate(dateStr);
    const start = parseDate(event.startDate);
    if (!date || !start) return false;
    if (event.recurringType === 'weekly') {
      return (event.recurringDays || []).includes(date.getDay());
    }
    if (event.recurringType === 'monthly') {
      return date.getDate() === start.getDate();
    }
    return true;
  }

  isCompletedOnDate(event, dateStr) {
    if (event.isDeadline) {
      return Boolean(event.isDeadlineCompleted && event.deadlineCompletedDate === dateStr);
    }
    if (event.isRecurring) {
      return (event.completedDates || []).includes(dateStr);
    }
    return Boolean(event.isCompleted);
  }

  instanceForDate(event, dateStr) {
    const instance = {
      ...clone(event),
      date: dateStr,
      sourceDate: event.date,
      isCompleted: this.isCompletedOnDate(event, dateStr),
    };

    if (event.isDeadline) {
      instance.isDeadlineInstance = true;
      instance.deadlineParentId = event.id;
      instance.daysRemaining = daysBetween(parseDate(dateStr), parseDate(event.deadlineDate));
    }

    if (event.isRecurring) {
      instance.isRecurringInstance = true;
      instance.recurringParentId = event.id;
      instance.progress = this.calculateRecurringProgress(event, dateStr);
    }

    return instance;
  }

  getEventsByDate(dateStr, options = {}) {
    const date = this.validDate(dateStr);
    if (!date) return [];
    const includeOverdue = options.includeOverdue !== false;
    return this.eventsForDate(this.loadEvents(), date, includeOverdue);
  }

  eventsForDate(events, date, includeOverdue) {
    const result = [];

    for (const event of events) {
      if (event.isDeadline) {
        const active = !event.isDeadlineCompleted
          && date >= event.startDate
          && date <= event.deadlineDate;
        const completedHere = event.isDeadlineCompleted && event.deadlineCompletedDate === date;
        const overdue = includeOverdue && !event.isDeadlineCompleted && date > event.deadlineDate;
        if (active || completedHere || overdue) {
          const instance = this.instanceForDate(event, date);
          instance.isOverdue = overdue;
          result.push(instance);
        }
        continue;
      }

      if (event.isRecurring) {
        if (this.isRecurringOnDate(event, date)) result.push(this.instanceForDate(event, date));
        continue;
      }

      const scheduled = !event.isCompleted && event.date === date;
      const completedHere = event.isCompleted && event.completedDate === date;
      const overdue = includeOverdue && !event.isCompleted && event.date < date;
      if (scheduled || completedHere || overdue) {
        const instance = this.instanceForDate(event, date);
        instance.isOverdue = overdue;
        result.push(instance);
      }
    }

    return result;
  }

  getEventsBetween(startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end || start > end) return {};
    const result = {};
    const events = this.loadEvents();
    for (let cursor = startOfDay(start); cursor <= end; cursor = addDays(cursor, 1)) {
      const key = formatDate(cursor);
      result[key] = this.eventsForDate(events, key, false);
    }
    return result;
  }

  getTaskCounts(startDate, endDate) {
    const range = this.getEventsBetween(startDate, endDate);
    return Object.fromEntries(
      Object.entries(range).map(([date, events]) => [
        date,
        {
          total: events.length,
          open: events.filter((event) => !event.isCompleted).length,
          completed: events.filter((event) => event.isCompleted).length,
        },
      ]),
    );
  }

  calculateRecurringProgress(event, currentDateStr) {
    let total = 0;
    const start = parseDate(event.startDate);
    const end = parseDate(event.endDate);
    if (!start || !end) return { completed: 0, total: 0, percentage: 0 };
    for (let cursor = startOfDay(start); cursor <= end; cursor = addDays(cursor, 1)) {
      if (this.isRecurringOnDate(event, formatDate(cursor))) total += 1;
    }
    const completed = (event.completedDates || []).filter((date) => date <= currentDateStr).length;
    return {
      completed,
      total,
      percentage: total ? Math.min(100, Math.round((completed / total) * 100)) : 0,
    };
  }

  toggleComplete(id, dateStr) {
    const date = this.validDate(dateStr) || formatDate(new Date());
    const events = this.loadEvents();
    const index = events.findIndex((event) => String(event.id) === String(id));
    if (index < 0) return null;
    const event = events[index];
    const now = new Date().toISOString();

    if (event.isDeadline) {
      if (event.isDeadlineCompleted) {
        event.isDeadlineCompleted = false;
        delete event.deadlineCompletedDate;
        delete event.completedAt;
      } else {
        event.isDeadlineCompleted = true;
        event.deadlineCompletedDate = date;
        event.completedAt = now;
      }
    } else if (event.isRecurring) {
      const completedDates = event.completedDates || [];
      const position = completedDates.indexOf(date);
      if (position >= 0) completedDates.splice(position, 1);
      else completedDates.push(date);
      event.completedDates = completedDates;
    } else {
      event.isCompleted = !event.isCompleted;
      if (event.isCompleted) {
        event.completedDate = date;
        event.completedAt = now;
      } else {
        delete event.completedAt;
        delete event.completedDate;
      }
    }

    event.updatedAt = now;
    events[index] = this.normalizeEvent(event);
    return this.saveEvents(events) ? this.instanceForDate(events[index], date) : null;
  }

  getTimerRecord(id, dateStr) {
    const event = this.getEvent(id);
    if (!event) return null;
    return clone(event.timerRecords?.[dateStr] || { elapsedSeconds: 0, runningSince: null });
  }

  updateTimer(id, dateStr, shouldRun) {
    const events = this.loadEvents();
    const index = events.findIndex((event) => String(event.id) === String(id));
    if (index < 0) return null;
    const event = events[index];
    event.timerRecords ||= {};
    const record = event.timerRecords[dateStr] || { elapsedSeconds: 0, runningSince: null };

    if (shouldRun && !record.runningSince) {
      record.runningSince = new Date().toISOString();
    } else if (!shouldRun && record.runningSince) {
      const startedAt = new Date(record.runningSince).getTime();
      const elapsed = Number.isFinite(startedAt)
        ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
        : 0;
      record.elapsedSeconds = (Number(record.elapsedSeconds) || 0) + elapsed;
      record.runningSince = null;
    }

    event.timerRecords[dateStr] = record;
    event.updatedAt = new Date().toISOString();
    events[index] = this.normalizeEvent(event);
    return this.saveEvents(events) ? clone(record) : null;
  }

  applyActions(actions) {
    const events = this.loadEvents();
    const results = [];
    const now = new Date().toISOString();

    for (const action of Array.isArray(actions) ? actions : []) {
      if (action.type === 'create' && action.event) {
        const created = this.normalizeEvent({
          ...action.event,
          id: this.generateId(),
          createdAt: now,
          updatedAt: now,
        });
        events.push(created);
        results.push({ type: 'create', success: true, event: clone(created) });
        continue;
      }

      const index = events.findIndex((event) => String(event.id) === String(action.id));
      if (index < 0) {
        results.push({ type: action.type, success: false, id: action.id });
        continue;
      }

      if (action.type === 'update') {
        const updated = this.normalizeEvent({
          ...events[index],
          ...(action.updates || {}),
          id: events[index].id,
          createdAt: events[index].createdAt,
          updatedAt: now,
        });
        events[index] = updated;
        results.push({ type: 'update', success: true, event: clone(updated) });
      } else if (action.type === 'delete') {
        const [removed] = events.splice(index, 1);
        results.push({ type: 'delete', success: true, event: clone(removed) });
      }
    }

    if (!results.some((result) => result.success)) return results;
    if (!this.saveEvents(events)) {
      return results.map((result) => ({ ...result, success: false, error: 'save_failed' }));
    }
    return results;
  }
}

module.exports = { EventStore };
