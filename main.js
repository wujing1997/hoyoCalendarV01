const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

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

// 启动 Python Flask 后端
async function startBackend() {
  backendPort = await findAvailablePort(5000);
  const pythonScript = path.join(__dirname, 'backend', 'app.py');

  // 尝试不同的 Python 命令
  const pythonCommands = ['python', 'python3', 'py'];
  for (const cmd of pythonCommands) {
    try {
      backendProcess = spawn(cmd, [pythonScript, String(backendPort)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      return new Promise((resolve, reject) => {
        let started = false;
        backendProcess.stdout.on('data', (data) => {
          const msg = data.toString();
          console.log('[Backend]', msg.trim());
          if (!started && msg.includes('starting on')) {
            started = true;
            // 等待服务就绪
            setTimeout(resolve, 500);
          }
        });
        backendProcess.stderr.on('data', (data) => {
          console.error('[Backend ERR]', data.toString().trim());
        });
        backendProcess.on('error', reject);
        backendProcess.on('exit', (code) => {
          if (!started) reject(new Error(`Backend exited with code ${code}`));
        });
        // 超时
        setTimeout(() => {
          if (!started) { started = true; resolve(); }
        }, 5000);
      });
    } catch (e) {
      continue;
    }
  }
  console.error('无法启动 Python 后端');
}

// 关闭后端
function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
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
  await startBackend();
  createWindow();

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
