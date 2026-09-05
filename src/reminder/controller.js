'use strict';
const { BrowserWindow, Tray, Menu, screen, powerMonitor, ipcMain } = require('electron');
const path = require('path');
const { EventStore } = require('../core/event-store');
const { ReminderScheduler } = require('../core/reminder-scheduler');

function startReminders({ app, getMainWindow, showCalendar, onError }) {
  let theme = 'light';
  let ready = false;
  const tray = new Tray(path.join(__dirname, '../../assets/app-icon.ico'));
  tray.setToolTip('HoYoCalendar · 到时提醒运行中');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开日历', click: showCalendar },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('click', showCalendar);
  const window = new BrowserWindow({
    width: 356, height: 206, frame: false, transparent: true, show: false,
    resizable: false, movable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true, { forward: true });
  function position() {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(356, area.width - 16);
    window.setBounds({ x: area.x + area.width - width - 8, y: area.y + 8, width, height: 206 });
  }
  position();
  function publish() {
    if (!ready || window.isDestroyed()) return;
    const snapshot = scheduler.snapshot();
    window.webContents.send('reminder-state', { ...snapshot, theme });
    if (snapshot.reminder) {
      if (!window.isVisible()) {
        window.setIgnoreMouseEvents(true, { forward: true });
        window.showInactive();
      }
    } else window.hide();
  }
  const dataDir = path.join(process.env.APPDATA || process.env.HOME, 'HoyoCalendar');
  const scheduler = new ReminderScheduler({ store: new EventStore({ dataDir }), stateFile: path.join(dataDir, 'reminder-confirmations.json'), onChange: publish });
  const handlers = {
    'reminder-ready': (event) => {
      if (event.sender !== window.webContents) return;
      ready = true;
      publish();
    },
    'reminder-hover': (event, inside) => {
      if (event.sender === window.webContents) window.setIgnoreMouseEvents(!inside, { forward: true });
    },
    'reminder-theme': (event, value) => {
      if (event.sender !== getMainWindow()?.webContents) return;
      theme = value === 'dark' ? 'dark' : 'light';
      publish();
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.on(channel, handler);
  ipcMain.handle('reminder-acknowledge', (event, key) => {
    if (event.sender !== window.webContents) return false;
    return scheduler.acknowledge(key);
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  const tick = () => { try { scheduler.tick(); } catch (error) { onError(error); } };
  tick();
  const timer = setInterval(tick, 1000);
  powerMonitor.on('resume', tick);
  powerMonitor.on('unlock-screen', tick);
  const displayEvents = ['display-metrics-changed', 'display-added', 'display-removed'];
  displayEvents.forEach((event) => screen.on(event, position));
  return {
    dispose() {
      clearInterval(timer);
      powerMonitor.removeListener('resume', tick);
      powerMonitor.removeListener('unlock-screen', tick);
      displayEvents.forEach((event) => screen.removeListener(event, position));
      for (const [channel, handler] of Object.entries(handlers)) ipcMain.removeListener(channel, handler);
      ipcMain.removeHandler('reminder-acknowledge');
      tray.destroy();
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
module.exports = { startReminders };
