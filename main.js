const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const net = require('net');
const http = require('http');

// 保持窗口对象的全局引用，避免被垃圾回收
let mainWindow = null;
let backendProcess = null;
let backendPort = 5000;

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

  // 判断是否为打包后的生产环境
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, 'backend_server', 'backend_server.exe');
    console.log('[Backend] 使用打包后端:', exePath);
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
    console.log('[Backend]', data.toString().trim());
  });
  backendProcess.stderr.on('data', (data) => {
    console.error('[Backend ERR]', data.toString().trim());
  });
  backendProcess.on('error', (err) => {
    console.error('[Backend] 启动失败:', err.message);
  });
  backendProcess.on('exit', (code) => {
    console.log('[Backend] 进程退出, code:', code);
    backendProcess = null;
  });
}

// 等待后端就绪（轮询 /api/health）
function waitForBackend(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${backendPort}/api/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('[Backend] 后端就绪');
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
        console.warn('[Backend] 等待超时，继续启动窗口');
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

  // 开发模式下打开 DevTools
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 窗口关闭时清除引用
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Electron 准备就绪后创建窗口
app.whenReady().then(async () => {
  // 先启动后端进程（不阻塞）
  await startBackend();

  // 立即创建窗口，不等后端就绪
  createWindow();

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
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
