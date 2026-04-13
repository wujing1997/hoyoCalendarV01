const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');

// ==================== 文件日志（打包后无控制台，写入日志文件） ====================
const logDir = path.join(app.getPath('userData'), 'logs');
try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
const logFile = path.join(logDir, `main-${new Date().toISOString().slice(0,10)}.log`);
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch (e) {}
  console.log(...args);
}
function logError(...args) {
  const line = `[${new Date().toISOString()}] [ERROR] ${args.map(a => (a instanceof Error ? a.stack || a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch (e) {}
  console.error(...args);
}
log('========== HoyoCalendar 启动 ==========');
log('版本:', app.getVersion(), '打包:', app.isPackaged, '路径:', app.getAppPath());
log('日志文件:', logFile);

// ==================== 单实例锁 ====================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('已有实例运行，退出');
  app.quit();
  return;
}

// ==================== 全局异常捕获（防止闪退） ====================
process.on('uncaughtException', (err) => {
  logError('[Fatal] 未捕获异常:', err);
});
process.on('unhandledRejection', (reason) => {
  logError('[Fatal] 未处理的 Promise 拒绝:', reason);
});

// 保持窗口对象的全局引用，避免被垃圾回收
let mainWindow = null;
let backendProcess = null;
let backendPort = 5000;

// 聚焦已有窗口（第二个实例启动时）
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 查找可用端口
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

// 启动 Python Flask 后端（只启动进程，不等待就绪）
async function startBackend() {
  backendPort = await findAvailablePort(5000);
  log('[Backend] 使用端口:', backendPort);

  // 判断是否为打包后的生产环境
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, 'backend_server', 'backend_server.exe');
    log('[Backend] 使用打包后端:', exePath);
    // 检查文件是否存在
    if (!fs.existsSync(exePath)) {
      logError('[Backend] backend_server.exe 不存在:', exePath);
      return;
    }
    backendProcess = spawn(exePath, [String(backendPort)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    });
  } else {
    const pythonScript = path.join(__dirname, 'backend', 'app.py');
    const pythonCommands = ['python', 'python3', 'py'];
    let launched = false;
    for (const cmd of pythonCommands) {
      try {
        backendProcess = spawn(cmd, [pythonScript, String(backendPort)], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        });
        launched = true;
        break;
      } catch (e) {
        continue;
      }
    }
    if (!launched) {
      console.error('无法启动 Python 后端');
      return;
    }
  }

  backendProcess.stdout.on('data', (data) => {
    log('[Backend]', data.toString().trim());
  });
  backendProcess.stderr.on('data', (data) => {
    logError('[Backend ERR]', data.toString().trim());
  });
  backendProcess.on('error', (err) => {
    logError('[Backend] 启动失败:', err.message);
  });
  backendProcess.on('exit', (code) => {
    log('[Backend] 进程退出, code:', code);
    const wasStopping = backendProcess === null; // stopBackend 会先置 null
    backendProcess = null;
    // 非主动关闭时自动重启后端
    if (!wasStopping && !app.isQuitting) {
      log('[Backend] 意外退出，3秒后自动重启...');
      setTimeout(() => {
        if (!app.isQuitting) {
          startBackend().then(() => waitForBackend());
        }
      }, 3000);
    }
  });
}

// 等待后端就绪（轮询 /api/health）
function waitForBackend(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${backendPort}/api/health`, (res) => {
        if (res.statusCode === 200) {
          log('[Backend] 后端就绪');
          resolve(true);
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        logError('[Backend] 等待超时，继续启动窗口');
        resolve(false);
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

// 关闭后端（Windows 上杀进程树）
function stopBackend() {
  if (backendProcess) {
    const pid = backendProcess.pid;
    backendProcess = null;
    if (process.platform === 'win32' && pid) {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } catch (e) { /* 进程可能已退出 */ }
    } else if (pid) {
      try { process.kill(pid); } catch (e) { /* ignore */ }
    }
  }
}

function createWindow() {
  // 创建无边框透明窗口
  mainWindow = new BrowserWindow({
    width: 360,
    height: 600,
    minWidth: 360,
    maxWidth: 360,
    maxHeight: 780,
    frame: false,           // 无边框
    transparent: true,      // 透明背景
    alwaysOnTop: true,      // 始终置顶
    resizable: true,        // 高度可调整
    skipTaskbar: false,     // 显示在任务栏
    hasShadow: true,        // 启用窗口阴影
    roundedCorners: true,   // 圆角窗口 (Windows 11)
    backgroundColor: '#00000000', // 完全透明背景
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 设置窗口圆角（Windows 11+）
  if (process.platform === 'win32') {
    mainWindow.once('ready-to-show', () => {
      // 确保窗口背景完全透明
      mainWindow.setBackgroundColor('#00000000');
    });
  }

  // 加载主页面
  mainWindow.loadFile('index.html');

  // 捕获渲染进程日志到文件
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = ['[Renderer VERBOSE]', '[Renderer INFO]', '[Renderer WARN]', '[Renderer ERROR]'][level] || '[Renderer]';
    if (level >= 2) {
      logError(prefix, message);
    } else {
      log(prefix, message);
    }
  });

  // 页面加载失败记录
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logError('[Window] 页面加载失败:', errorCode, errorDescription);
  });

  // 开发模式下打开 DevTools
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 渲染进程崩溃时自动恢复
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logError('[Window] 渲染进程崩溃:', details.reason, 'exitCode:', details.exitCode);
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadFile('index.html');
        }
      }, 1000);
    }
  });

  // 窗口无响应 / 恢复响应
  mainWindow.on('unresponsive', () => logError('[Window] 窗口无响应'));
  mainWindow.on('responsive', () => log('[Window] 窗口恢复响应'));

  // 窗口关闭时清除引用
  mainWindow.on('close', (event) => {
    log('[Window] close 事件触发 (isQuitting:', !!app.isQuitting, ')');
  });
  mainWindow.on('closed', () => {
    log('[Window] closed 事件触发，窗口已销毁');
    mainWindow = null;
  });
}

// Electron 准备就绪后创建窗口
app.whenReady().then(async () => {
  log('[App] app.whenReady resolved');

  // 先启动后端进程（不阻塞）
  await startBackend();

  // 立即创建窗口，不等后端就绪
  createWindow();
  log('[App] 窗口已创建');

  // 后台等待后端就绪，就绪后通知渲染进程
  waitForBackend().then((ready) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-ready', ready);
    }
  });

  // macOS 特殊处理：点击 dock 图标重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  log('[App] window-all-closed 触发');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// GPU 进程信息
app.on('child-process-gone', (event, details) => {
  logError('[App] child-process-gone:', details.type, details.reason, 'exitCode:', details.exitCode);
});

// 主进程心跳（每30秒记录一次，便于判断何时退出）
let heartbeatCount = 0;
const heartbeat = setInterval(() => {
  heartbeatCount++;
  log('[Heartbeat]', heartbeatCount, '- 窗口存在:', !!mainWindow, '后端存在:', !!backendProcess);
}, 30000);

app.on('before-quit', () => {
  log('[App] before-quit');
  app.isQuitting = true;
  clearInterval(heartbeat);
});

app.on('will-quit', () => {
  log('[App] will-quit');
  app.isQuitting = true;
  stopBackend();
});

// IPC: 获取后端端口
ipcMain.handle('get-backend-port', () => backendPort);

// ==================== IPC 通信处理 ====================

// 窗口控制：最小化
ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

// 窗口控制：关闭
ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

// 窗口控制：切换置顶状态
ipcMain.on('window-toggle-pin', () => {
  if (mainWindow) {
    const isPinned = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!isPinned);
    mainWindow.webContents.send('pin-status-changed', !isPinned);
  }
});

// 调整窗口高度
ipcMain.on('resize-window', (event, height) => {
  if (mainWindow) {
    const [width] = mainWindow.getSize();
    const newHeight = Math.min(Math.max(height, 400), 780);
    mainWindow.setSize(width, newHeight);
  }
});

// ==================== 开机自启动 ====================

ipcMain.handle('get-auto-launch', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('set-auto-launch', (event, enable) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath,
  });
  return app.getLoginItemSettings().openAtLogin;
});
