'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const http = require('http');
const { EventStore } = require('./src/core/event-store');
const { CommandRouter } = require('./src/core/command-router');

let Lunar;
let Solar;
let HolidayUtil;
try {
  const lunar = require('lunar-javascript');
  Lunar = lunar.Lunar;
  Solar = lunar.Solar;
  HolidayUtil = lunar.HolidayUtil;
} catch (error) {
  console.warn('[Preload] Lunar calendar support unavailable:', error.message);
}

const dataDir = path.join(process.env.APPDATA || process.env.HOME, 'HoyoCalendar');
const eventStore = new EventStore({ dataDir });
const commandRouter = new CommandRouter(eventStore);

let backendPort = 5000;
let backendStatus = 'starting';
const backendPortReady = ipcRenderer.invoke('get-backend-port')
  .then((port) => {
    backendPort = Number(port) || 5000;
    return backendPort;
  })
  .catch(() => backendPort);

function httpRequest(urlPath, method = 'GET', body = null, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port: backendPort,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: timeoutMs,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        let data = raw;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (_) {
          // Preserve a non-JSON error body for diagnostics.
        }
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          data,
        });
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('backend_timeout'));
    });
    if (payload) request.write(payload);
    request.end();
  });
}

function compactAgentSnapshot(events) {
  return events.slice(-1000).map((event) => ({
    id: event.id,
    event: event.event,
    date: event.date,
    time: event.time,
    location: event.location,
    urgency: event.urgency,
    note: event.note,
    calendar: event.calendar,
    isCompleted: event.isCompleted,
    isRecurring: event.isRecurring,
    recurringType: event.recurringType,
    recurringDays: event.recurringDays,
    startDate: event.startDate,
    endDate: event.endDate,
    completedDates: event.completedDates,
    isDeadline: event.isDeadline,
    deadlineDate: event.deadlineDate,
    isDeadlineCompleted: event.isDeadlineCompleted,
    deadlineCompletedDate: event.deadlineCompletedDate,
    targetDurationMinutes: event.targetDurationMinutes,
  }));
}

function friendlyBackendError(error) {
  const code = String(error?.code || error?.message || '');
  if (/ECONNREFUSED|backend_timeout|ETIMEDOUT/.test(code)) {
    return 'AI 服务仍在启动或暂时不可用，本地日程功能不受影响。';
  }
  return 'AI 服务请求失败，请检查设置后重试。';
}

ipcRenderer.on('backend-ready', (_event, ready) => {
  backendStatus = ready ? 'ready' : 'unavailable';
});

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  togglePin: () => ipcRenderer.send('window-toggle-pin'),
  setWindowMode: (mode) => ipcRenderer.send('window-set-mode', mode),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  onWindowStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window-state-changed', listener);
    return () => ipcRenderer.removeListener('window-state-changed', listener);
  },
  onBackendReady: (callback) => {
    const listener = (_event, ready) => callback(ready);
    ipcRenderer.on('backend-ready', listener);
    return () => ipcRenderer.removeListener('backend-ready', listener);
  },
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', Boolean(enabled)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
});

contextBridge.exposeInMainWorld('eventAPI', {
  loadEvents: () => eventStore.loadEvents(),
  addEvent: (event) => eventStore.addEvent(event),
  updateEvent: (id, updates) => eventStore.updateEvent(id, updates),
  deleteEvent: (id) => eventStore.deleteEvent(id),
  getEvent: (id) => eventStore.getEvent(id),
  getEventsByDate: (date, options) => eventStore.getEventsByDate(date, options),
  getEventsBetween: (startDate, endDate) => eventStore.getEventsBetween(startDate, endDate),
  getTaskCounts: (startDate, endDate) => eventStore.getTaskCounts(startDate, endDate),
  toggleComplete: (id, date) => eventStore.toggleComplete(id, date),
  toggleRecurringDateComplete: (id, date) => eventStore.toggleComplete(id, date),
  completeDeadlineEvent: (id, date) => eventStore.toggleComplete(id, date),
  getTimerRecord: (id, date) => eventStore.getTimerRecord(id, date),
  startTimer: (id, date) => eventStore.updateTimer(id, date, true),
  stopTimer: (id, date) => eventStore.updateTimer(id, date, false),
  applyActions: (actions) => eventStore.applyActions(actions),
});

contextBridge.exposeInMainWorld('commandAPI', {
  preview: (text, contextDate) => commandRouter.preview(text, contextDate),
  execute: (text, contextDate) => commandRouter.execute(text, contextDate),
});

contextBridge.exposeInMainWorld('aiAPI', {
  status: async () => {
    try {
      await backendPortReady;
      const response = await httpRequest('/api/health', 'GET', null, 3000);
      backendStatus = response.ok ? 'ready' : 'unavailable';
      return {
        status: backendStatus,
        ...(response.data && typeof response.data === 'object' ? response.data : {}),
      };
    } catch (_) {
      backendStatus = 'unavailable';
      return { status: backendStatus, configured: false };
    }
  },

  chat: async (message, sessionId = 'main') => {
    try {
      await backendPortReady;
      const response = await httpRequest('/api/agent/chat', 'POST', {
        message,
        session_id: sessionId,
        today: eventStore.validDate(new Date()) || undefined,
        events: compactAgentSnapshot(eventStore.loadEvents()),
      }, 90000);
      if (!response.ok) {
        const detail = response.data?.message || response.data?.error;
        throw new Error(detail || `backend_${response.status}`);
      }

      const actions = Array.isArray(response.data.actions) ? response.data.actions : [];
      const actionResults = actions.length ? eventStore.applyActions(actions) : [];
      const successfulActions = actionResults.filter((result) => result.success);
      return {
        ...response.data,
        events_changed: successfulActions.length > 0,
        action_results: actionResults,
        created_count: successfulActions.filter((result) => result.type === 'create').length,
        deleted_count: successfulActions.filter((result) => result.type === 'delete').length,
      };
    } catch (error) {
      console.error('[Preload] Agent request failed:', error.message);
      return {
        message: friendlyBackendError(error),
        events_changed: false,
        error_code: 'agent_unavailable',
      };
    }
  },

  resetChat: async (sessionId = 'main') => {
    try {
      await backendPortReady;
      await httpRequest('/api/agent/reset', 'POST', { session_id: sessionId }, 5000);
      return true;
    } catch (_) {
      return false;
    }
  },
});

contextBridge.exposeInMainWorld('configAPI', {
  load: async () => {
    try {
      await backendPortReady;
      const response = await httpRequest('/api/config', 'GET', null, 5000);
      return response.ok ? response.data : {};
    } catch (_) {
      return {};
    }
  },
  save: async (config) => {
    try {
      await backendPortReady;
      const response = await httpRequest('/api/config', 'PUT', config, 5000);
      return response.ok ? response.data : { success: false };
    } catch (_) {
      return { success: false };
    }
  },
});

contextBridge.exposeInMainWorld('lunarAPI', {
  isAvailable: () => Boolean(Lunar),
  fromSolar: (year, month, day) => {
    if (!Solar) return null;
    try {
      const solar = Solar.fromYmd(year, month, day);
      const lunar = solar.getLunar();
      return {
        year: lunar.getYear(),
        month: lunar.getMonth(),
        day: lunar.getDay(),
        monthStr: `${lunar.getMonthInChinese()}月`,
        dayStr: lunar.getDayInChinese(),
        isLeapMonth: lunar.getMonth() < 0,
        yearGanZhi: lunar.getYearInGanZhi(),
        shengXiao: lunar.getYearShengXiao(),
        jieQi: lunar.getJieQi() || null,
        festivals: lunar.getFestivals() || [],
        otherFestivals: lunar.getOtherFestivals() || [],
      };
    } catch (_) {
      return null;
    }
  },
  getSolarFestivals: (year, month, day) => {
    if (!Solar) return [];
    try {
      return Solar.fromYmd(year, month, day).getFestivals() || [];
    } catch (_) {
      return [];
    }
  },
  getHoliday: (year, month, day) => {
    if (!HolidayUtil) return null;
    try {
      const holiday = HolidayUtil.getHoliday(year, month, day);
      if (!holiday) return null;
      return {
        name: holiday.getName(),
        isWork: holiday.isWork(),
        target: holiday.getTarget(),
      };
    } catch (_) {
      return null;
    }
  },
});
