'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  safeStorage,
} = require('electron');
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

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
let backendProcess = null;
let backendPort = 5000;
let backendStopping = false;
let persistTimer = null;

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
    const width = Math.max(360, Number(state.width) || 1180);
    const height = Math.max(560, Number(state.height) || 760);
    return {
      width,
      height,
      x: Number.isFinite(state.x) ? state.x : undefined,
      y: Number.isFinite(state.y) ? state.y : undefined,
      isPinned: Boolean(state.isPinned),
      mode: state.mode === 'compact' ? 'compact' : 'wide',
    };
  } catch (_) {
    return {
      width: 1180,
      height: 760,
      x: undefined,
      y: undefined,
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
    mode: bounds.width <= 720 ? 'compact' : 'wide',
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
    mode: mainWindow.getBounds().width <= 720 ? 'compact' : 'wide',
  };
}

function publishWindowState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('window-state-changed', currentWindowState());
  }
}

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(findAvailablePort(startPort + 1)));
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function resolvePythonCommand() {
  const candidates = [
    { command: 'python', args: [] },
    { command: 'py', args: ['-3'] },
    { command: 'python3', args: [] },
  ];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

async function startBackend() {
  backendStopping = false;
  backendPort = await findAvailablePort(5000);
  let executable;
  let args;

  if (app.isPackaged) {
    executable = path.join(process.resourcesPath, 'backend_server', 'backend_server.exe');
    args = [String(backendPort)];
    if (!fs.existsSync(executable)) {
      logError('Packaged backend not found', executable);
      return false;
    }
  } else {
    const python = resolvePythonCommand();
    if (!python) {
      logError('Python runtime not found');
      return false;
    }
    executable = python.command;
    args = [
      ...python.args,
      path.join(__dirname, 'backend', 'app.py'),
      String(backendPort),
    ];
  }

  log('Starting backend', executable, `port=${backendPort}`);
  backendProcess = spawn(executable, args, {
    cwd: app.isPackaged ? process.resourcesPath : __dirname,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      HOYO_CALENDAR_VERSION: app.getVersion(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const child = backendProcess;
  child.stdout.on('data', (data) => log('[Backend]', data.toString().trim()));
  child.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (/\b(ERROR|Traceback|Exception)\b/i.test(message)) {
      logError('[Backend]', message);
    } else {
      log('[Backend]', message);
    }
  });
  child.on('error', (error) => logError('Backend process error', error));
  child.on('exit', (code) => {
    log('Backend exited', `code=${code}`);
    if (backendProcess === child) backendProcess = null;
    if (!backendStopping && !app.isQuitting) {
      setTimeout(async () => {
        if (app.isQuitting || backendProcess) return;
        await startBackend();
        const ready = await waitForBackend();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backend-ready', ready);
        }
      }, 2000);
    }
  });
  return true;
}

function waitForBackend(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const request = http.get(`http://127.0.0.1:${backendPort}/api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve(true);
        else retry();
      });
      request.setTimeout(800, () => request.destroy());
      request.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) resolve(false);
      else setTimeout(check, 250);
    };
    check();
  });
}

function stopBackend() {
  backendStopping = true;
  const child = backendProcess;
  backendProcess = null;
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch (_) {
    // The process may already have exited.
  }
}

function createWindow() {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 360,
    minHeight: 560,
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

app.whenReady().then(async () => {
  log('HoYoCalendar starting', `version=${app.getVersion()}`, `packaged=${app.isPackaged}`);
  await startBackend();
  createWindow();
  const ready = await waitForBackend();
  log('Backend readiness', ready);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend-ready', ready);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  clearTimeout(persistTimer);
  saveWindowStateNow();
  stopBackend();
});

ipcMain.handle('get-backend-port', () => backendPort);
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
  if (mode === 'compact') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(430, 720, true);
  } else {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(1180, 760, true);
  }
});
