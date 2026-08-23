'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  safeStorage,
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalConfig } = require('./src/core/local-config');

const allowMultipleInstances = process.env.HOYO_ALLOW_MULTIPLE_INSTANCES === '1';
const gotLock = allowMultipleInstances || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

const logDir = path.join(app.getPath('userData'), 'logs');
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `main-${new Date().toISOString().slice(0, 10)}.log`);

function serializeLogValue(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

function log(...values) {
  const line = `[${new Date().toISOString()}] ${values.map(serializeLogValue).join(' ')}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch (_) {
    // Logging must never interrupt the app.
  }
  console.log(...values);
}

function logError(...values) {
  log('[ERROR]', ...values);
}

process.on('uncaughtException', (error) => logError('uncaughtException', error));
process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));

let mainWindow = null;
let persistTimer = null;
let currentMode = 'wide';

const COMPACT_WIDTH = 430;
const COMPACT_MIN_WIDTH = 360;
const WIDE_DEFAULT_WIDTH = 1180;
const WIDE_DEFAULT_HEIGHT = 760;
const WIDE_MIN_WIDTH = 720;
const WIDE_MIN_HEIGHT = 560;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function displayForBounds(bounds) {
  if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    return screen.getDisplayMatching(bounds);
  }
  return screen.getPrimaryDisplay();
}

function compactBounds(baseBounds = {}) {
  const area = displayForBounds(baseBounds).workArea;
  const width = clamp(COMPACT_WIDTH, Math.min(COMPACT_MIN_WIDTH, area.width), area.width);
  return { x: area.x + area.width - width, y: area.y, width, height: area.height };
}

function wideBounds(baseBounds = {}) {
  const area = displayForBounds(baseBounds).workArea;
  const width = Math.min(Math.max(WIDE_MIN_WIDTH, Number(baseBounds.width) || WIDE_DEFAULT_WIDTH), area.width);
  const height = Math.min(Math.max(WIDE_MIN_HEIGHT, Number(baseBounds.height) || WIDE_DEFAULT_HEIGHT), area.height);
  const x = Number.isFinite(baseBounds.x)
    ? clamp(baseBounds.x, area.x, area.x + area.width - width)
    : Math.round(area.x + (area.width - width) / 2);
  const y = Number.isFinite(baseBounds.y)
    ? clamp(baseBounds.y, area.y, area.y + area.height - height)
    : Math.round(area.y + (area.height - height) / 2);
  return { x, y, width, height };
}

function widePresetBounds(baseBounds = {}) {
  const area = displayForBounds(baseBounds).workArea;
  const width = Math.min(WIDE_DEFAULT_WIDTH, area.width);
  const height = Math.min(WIDE_DEFAULT_HEIGHT, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function boundsForMode(mode, baseBounds = {}) {
  return mode === 'compact' ? compactBounds(baseBounds) : wideBounds(baseBounds);
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
    const mode = state.mode === 'compact' ? 'compact' : 'wide';
    return {
      ...boundsForMode(mode, state),
      isPinned: Boolean(state.isPinned),
      mode,
    };
  } catch (_) {
    return {
      ...wideBounds(),
      isPinned: false,
      mode: 'wide',
    };
  }
}

function saveWindowStateNow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const state = {
    ...bounds,
    isPinned: mainWindow.isAlwaysOnTop(),
    mode: currentMode,
  };
  try {
    fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    logError('Failed to persist window state', error);
  }
}

function persistWindowState() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(saveWindowStateNow, 250);
}

function currentWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { isPinned: false, isMaximized: false, mode: 'wide' };
  }
  return {
    isPinned: mainWindow.isAlwaysOnTop(),
    isMaximized: mainWindow.isMaximized(),
    mode: currentMode,
  };
}

function publishWindowState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('window-state-changed', currentWindowState());
  }
}

function refitCompactWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || currentMode !== 'compact') return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setBounds(compactBounds(mainWindow.getBounds()), true);
  persistWindowState();
  publishWindowState();
}

function createWindow() {
  const saved = loadWindowState();
  currentMode = saved.mode;
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: COMPACT_MIN_WIDTH,
    minHeight: 360,
    frame: false,
    transparent: false,
    backgroundColor: '#eef1f5',
    alwaysOnTop: saved.isPinned,
    resizable: true,
    show: false,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    publishWindowState();
  });

  mainWindow.on('resize', () => {
    persistWindowState();
    publishWindowState();
  });
  mainWindow.on('move', persistWindowState);
  mainWindow.on('maximize', publishWindowState);
  mainWindow.on('unmaximize', publishWindowState);
  mainWindow.on('always-on-top-changed', () => {
    persistWindowState();
    publishWindowState();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('unresponsive', () => logError('Renderer became unresponsive'));

  mainWindow.webContents.on('console-message', (_event, detailsOrLevel, legacyMessage) => {
    const isStructured = detailsOrLevel && typeof detailsOrLevel === 'object';
    const level = isStructured ? detailsOrLevel.level : Number(detailsOrLevel);
    const message = isStructured
      ? detailsOrLevel.message
      : String(legacyMessage || '');
    if (level === 'error' || Number(level) >= 3) logError('[Renderer]', message);
    else log('[Renderer]', message);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('Renderer process gone', details);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    logError('Page failed to load', code, description);
  });

  if (!app.isPackaged && process.env.HOYO_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  log('HoYoCalendar starting', `version=${app.getVersion()}`, `packaged=${app.isPackaged}`);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  screen.on('display-metrics-changed', refitCompactWindow);
  screen.on('display-added', refitCompactWindow);
  screen.on('display-removed', refitCompactWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  clearTimeout(persistTimer);
  saveWindowStateNow();
});

ipcMain.handle('get-window-state', () => currentWindowState());
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('open-logs-folder', async () => shell.openPath(logDir));
ipcMain.handle('get-auto-launch', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-auto-launch', (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});

const credentialFile = path.join(app.getPath('userData'), 'cloud-credentials.bin');

function credentialStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

ipcMain.handle('cloud-credential-get-refresh-token', async () => {
  try {
    if (!fs.existsSync(credentialFile)) return null;
    const raw = fs.readFileSync(credentialFile);
    if (credentialStorageAvailable()) {
      return safeStorage.decryptString(raw);
    }
    return raw.toString('utf8');
  } catch (error) {
    logError('Failed to read cloud credentials', error);
    return null;
  }
});

ipcMain.handle('cloud-credential-set-refresh-token', async (_event, token) => {
  try {
    if (!token) {
      if (fs.existsSync(credentialFile)) fs.unlinkSync(credentialFile);
      return true;
    }
    let payload;
    if (credentialStorageAvailable()) {
      payload = safeStorage.encryptString(String(token));
    } else {
      payload = Buffer.from(String(token), 'utf8');
      log('safeStorage unavailable, cloud refresh token stored with OS file permissions only');
    }
    fs.writeFileSync(credentialFile, payload, { mode: 0o600 });
    return true;
  } catch (error) {
    logError('Failed to store cloud credentials', error);
    return false;
  }
});

ipcMain.handle('cloud-credential-clear', async () => {
  try {
    if (fs.existsSync(credentialFile)) fs.unlinkSync(credentialFile);
    return true;
  } catch (error) {
    logError('Failed to clear cloud credentials', error);
    return false;
  }
});

ipcMain.handle('cloud-device-name', () => os.hostname() || '未知设备');

const localConfig = new LocalConfig(
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'HoyoCalendar', 'config.json'),
);

ipcMain.handle('config-load', () => localConfig.load());

ipcMain.handle('config-save', (_event, updates) => {
  try {
    return { success: true, config: localConfig.save(updates) };
  } catch (error) {
    logError('Failed to save local config', error);
    return { success: false };
  }
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.on('window-toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-toggle-pin', () => {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop());
});
ipcMain.on('window-set-mode', (_event, mode) => {
  if (!mainWindow) return;
  currentMode = mode === 'compact' ? 'compact' : 'wide';
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  const currentBounds = mainWindow.getBounds();
  const nextBounds = currentMode === 'compact'
    ? compactBounds(currentBounds)
    : widePresetBounds(currentBounds);
  mainWindow.setBounds(nextBounds, true);
  persistWindowState();
  publishWindowState();
});
