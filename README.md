# HoyoCalendar 技术实现文档

> 基于 Electron 的二次元风格（Glassmorphism 玻璃拟态）桌面悬浮日历应用

## 📁 项目结构

```
hoyoCalendar/
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本（API 桥接）
├── renderer.js          # 渲染进程逻辑
├── index.html           # 主页面 HTML
├── styles.css           # 玻璃拟态 CSS 样式
├── ai-service.js        # AI 服务模块
├── ocr-service.js       # OCR 服务模块
├── package.json         # 项目配置
└── README.md            # 本文档
```

---

## 🏗️ 架构设计

### Electron 进程通信架构

```
┌─────────────────────────────────────────────────────────┐
│                    Main Process (main.js)                │
│  - 窗口管理（无边框、透明、置顶）                          │
│  - IPC 通信处理                                          │
└─────────────────────┬───────────────────────────────────┘
                      │ IPC
┌─────────────────────▼───────────────────────────────────┐
│                 Preload Script (preload.js)              │
│  - contextBridge 暴露安全 API                            │
│  - electronAPI: 窗口控制                                 │
│  - eventAPI: 日程存储                                    │
│  - lunarAPI: 农历计算                                    │
│  - aiAPI: AI 服务                                        │
│  - ocrAPI: OCR 服务                                      │
│  - configAPI: 配置管理                                   │
└─────────────────────┬───────────────────────────────────┘
                      │ window.*API
┌─────────────────────▼───────────────────────────────────┐
│               Renderer Process (renderer.js)             │
│  - UI 渲染和交互                                         │
│  - 三级视图管理                                          │
│  - 日期选择和日程展示                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 📄 核心文件详解

### 1. main.js - 主进程

**职责**：创建和管理 Electron 窗口

```javascript
// 关键配置
const mainWindow = new BrowserWindow({
  width: 360,
  height: 600,
  frame: false,           // 无边框
  transparent: true,      // 透明背景
  alwaysOnTop: true,      // 始终置顶
  resizable: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  }
});
```

**IPC 通信**：
- `window-minimize`: 最小化窗口
- `window-close`: 关闭窗口
- `window-toggle-pin`: 切换置顶状态
- `resize-window`: 调整窗口高度

---

### 2. preload.js - 预加载脚本

**职责**：作为主进程和渲染进程之间的安全桥梁

**暴露的 API**：

| API | 功能 |
|-----|------|
| `electronAPI` | 窗口控制（最小化、关闭、置顶） |
| `eventAPI` | 日程 CRUD 操作 |
| `lunarAPI` | 农历转换、节假日查询 |
| `aiAPI` | AI 日程解析 |
| `ocrAPI` | OCR 图片识别 |
| `configAPI` | 配置读写 |

**日程存储实现**：

```javascript
const EventStore = {
  loadEvents()           // 读取所有日程
  saveEvents(events)     // 保存所有日程
  addEvent(event)        // 添加日程
  updateEvent(id, data)  // 更新日程
  deleteEvent(id)        // 删除日程
  getEventsByDate(date)  // 获取指定日期的日程
  getTaskCounts()        // 获取每日任务数量统计
};
```

存储路径：`%APPDATA%\HoyoCalendar\events.json`

---

### 3. renderer.js - 渲染进程逻辑

**职责**：处理所有 UI 交互和视图渲染

#### 3.1 全局状态

```javascript
const state = {
  currentDate: new Date(),      // 当前选中日期
  currentView: 'today',         // 当前视图: 'today' | 'month' | 'year'
  isPinned: true,               // 是否置顶
  events: [],                   // 日程列表（内存缓存）
  taskCounts: {},               // 每日任务数量缓存
  contextMenuTarget: null,      // 右键菜单目标
};
```

#### 3.2 初始化流程

```javascript
document.addEventListener('DOMContentLoaded', () => {
  loadStoredEvents();      // 1. 从文件加载日程
  initWindowControls();    // 2. 初始化窗口控制按钮
  initDateDisplay();       // 3. 初始化日期显示
  initWeekPicker();        // 4. 初始化周日期选择器
  initViewSwitching();     // 5. 初始化视图切换
  initInputHandlers();     // 6. 初始化输入处理
  initContextMenu();       // 7. 初始化右键菜单
  initSettings();          // 8. 初始化设置面板
});
```

#### 3.3 三级视图系统

**今日视图 (Today View)**：
- 周日期选择器：水平展示一周，每个日期下方显示任务指示器
- 日程列表：展示当天任务，支持折叠/展开
- 输入区：文本输入 + 图片上传

**月视图 (Month View)**：
- 7x6 网格显示
- 每个日期显示公历 + 农历
- 节假日标记（休/班）
- 点击日期跳回今日视图

**年视图 (Year View)**：
- 3x4 网格显示 12 个月
- 每月显示缩略日历
- 点击月份进入月视图

#### 3.4 视图切换逻辑

```javascript
function switchView(view) {
  state.currentView = view;
  
  // 隐藏所有视图
  elements.todayView.classList.add('hidden');
  elements.monthView.classList.add('hidden');
  elements.yearView.classList.add('hidden');
  
  // 显示目标视图并渲染
  switch (view) {
    case 'today':
      elements.todayView.classList.remove('hidden');
      renderAgendaList();
      break;
    case 'month':
      elements.monthView.classList.remove('hidden');
      renderMonthView();
      break;
    case 'year':
      elements.yearView.classList.remove('hidden');
      renderYearView();
      break;
  }
}
```

#### 3.5 "返回今日"逻辑

```javascript
function goToToday() {
  const today = new Date();           // 获取真正的今天
  state.currentDate = today;          // 更新状态
  updateDateDisplay(today);           // 更新头部显示
  renderWeekPicker(today);            // 渲染包含今天的那一周
  switchView('today');                // 切换到今日视图
}
```

**注意**：`goToToday()` 会将日期重置为系统当前日期，而不是保持用户之前选择的日期。

#### 3.6 周选择器优化

为避免点击同一周内的日期时蓝色短线跳动，采用了优化策略：

```javascript
function selectDate(date) {
  const oldDate = state.currentDate;
  state.currentDate = date;
  
  // 计算新旧日期的周起始
  const oldWeekStart = getWeekStart(oldDate);
  const newWeekStart = getWeekStart(date);
  
  // 只有切换到不同周时才完全重新渲染
  if (oldWeekStart.getTime() !== newWeekStart.getTime()) {
    renderWeekPicker(date);
  } else {
    // 同一周内只更新选中状态
    updateWeekPickerSelection();
  }
}
```

---

### 4. ai-service.js - AI 服务模块

**职责**：调用大模型 API 进行智能日程解析

#### 4.1 支持的 AI 服务

| 服务 | 配置项 |
|------|--------|
| 豆包 (火山引擎) | `apiKey`, `baseUrl`, `model` |
| Ollama (本地) | `baseUrl`, `model` |
| OpenAI 兼容 | `apiKey`, `baseUrl`, `model` |

#### 4.2 日程解析 Prompt

```javascript
const PARSE_PROMPT = `你是一个智能日程助手。请将用户输入的文字解析为结构化的日程信息。

今天的日期是：${getTodayStr()}

要求：
1. 提取事件名称、日期、时间、地点、紧急程度
2. 日期格式为 YYYY-MM-DD，必须根据今天日期推断：
   - "今天" → 今天的日期
   - "明天" → 今天+1天
   - "后天" → 今天+2天
   - "下周一" → 计算下周一的日期
   - "1月30日" → 补全年份
   - 如果无法理解日期，默认为今天
3. 时间格式为 HH:mm（24小时制）
4. 紧急程度：normal（普通）、high（紧急）
5. 只返回 JSON 格式

输出格式：
{
  "event": "事件名称",
  "date": "2026-01-29",
  "time": "14:30",
  "location": "地点",
  "urgency": "normal"
}`;
```

#### 4.3 简单解析（无 AI 回退）

当 AI 服务不可用时，使用本地规则解析：

```javascript
simpleParse(text) {
  // 解析相对日期
  if (text.includes('明天')) {
    targetDate.setDate(today.getDate() + 1);
  } else if (text.includes('后天')) {
    targetDate.setDate(today.getDate() + 2);
  } else if (text.includes('下周')) {
    // 计算下周的日期...
  }
  
  // 解析时间 (HH:mm)
  const timeMatch = text.match(/(\d{1,2})[:\：](\d{2})/);
  
  // 检测紧急关键词
  const urgentKeywords = ['紧急', '急', '重要', 'urgent', 'asap'];
  
  // 提取地点
  const locationMatch = event.match(/(?:在|@|地点[：:])(.+?)(?:$|[，,。])/);
  
  return { event, date, time, location, urgency };
}
```

---

### 5. ocr-service.js - OCR 服务模块

**职责**：使用 Tesseract.js 进行本地 OCR 识别

#### 5.1 初始化

```javascript
async initialize(language = 'chi_sim+eng') {
  worker = await Tesseract.createWorker(language, 1, {
    logger: (m) => {
      console.log(`OCR [${m.status}]: ${Math.round((m.progress || 0) * 100)}%`);
    },
  });
}
```

**支持的语言**：
- `chi_sim`: 简体中文
- `chi_tra`: 繁体中文
- `eng`: 英语
- 可组合使用：`chi_sim+eng`

#### 5.2 识别方法

```javascript
// 从 Base64 数据识别
async recognizeBase64(base64Data) {
  const result = await worker.recognize(base64Data);
  return {
    text: result.data.text,
    confidence: result.data.confidence,
    words: result.data.words,
    lines: result.data.lines,
  };
}

// 从文件路径识别
async recognizeImage(imagePath) {
  const result = await worker.recognize(imagePath);
  // ...
}
```

---

### 6. styles.css - 玻璃拟态样式

#### 6.1 CSS 变量定义

```css
:root {
  /* 主题色 */
  --primary-blue: #007AFF;      /* iOS Blue */
  --genshin-orange: #ff9f43;    /* 原神橙 */
  --starrail-blue: #54a0ff;     /* 崩铁蓝 */
  --code-green: #10ac84;        /* 代码绿 */
  
  /* 玻璃效果 */
  --glass-bg: rgba(255, 255, 255, 0.15);
  --glass-blur: 30px;
  --glass-border: rgba(255, 255, 255, 0.3);
}
```

#### 6.2 玻璃拟态核心

```css
.glass-container {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
```

#### 6.3 任务指示器（一任务一杠）

```css
.task-indicators {
  display: flex;
  gap: 2px;
  min-height: 4px;
}

.task-indicator {
  width: 6px;
  height: 3px;
  border-radius: 1px;
  background: var(--starrail-blue);
}
```

---

## 🔄 数据流

### 添加任务流程

```
用户输入文本
    │
    ▼
addTask(text)
    │
    ├─── AI 可用? ──Yes──► addTaskWithAI()
    │                         │
    │                         ▼
    │                    AI 解析返回 JSON
    │                    { event, date, time, location, urgency }
    │                         │
    │                         ▼
    │                    eventAPI.addEvent()
    │                         │
    No                        │
    │                         │
    ▼                         │
addTaskSimple()               │
    │                         │
    ▼                         ▼
本地正则解析           ◄──────┘
    │
    ▼
保存到 events.json
    │
    ▼
刷新 UI
```

### OCR + AI 流程

```
用户上传图片
    │
    ▼
fileToBase64(file)
    │
    ▼
ocrAPI.recognizeBase64()
    │
    ▼
OCR 结果文本
    │
    ├─── AI 可用? ──Yes──► aiAPI.parseOCRResult()
    │                         │
    │                         ▼
    │                    解析为结构化日程
    │                         │
    No                        │
    │                         │
    ▼                         ▼
addTaskSimple()    ◄──────────┘
    │
    ▼
保存并刷新 UI
```

---

## ⚙️ 配置说明

### 配置文件位置

```
Windows: %APPDATA%\HoyoCalendar\config.json
macOS:   ~/Library/Application Support/HoyoCalendar/config.json
Linux:   ~/.config/HoyoCalendar/config.json
```

### 配置结构

```json
{
  "ai": {
    "provider": "doubao",
    "doubao": {
      "apiKey": "your-api-key",
      "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
      "model": "doubao-seed-1-8-251228"
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "model": "llama3.2"
    },
    "openai": {
      "apiKey": "",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o-mini"
    }
  },
  "ocr": {
    "language": "chi_sim+eng"
  }
}
```

---

## 🚀 启动和运行

```bash
# 安装依赖
npm install

# 启动应用
npm start

# 开发模式（打开 DevTools）
# 在 main.js 中取消注释：
# mainWindow.webContents.openDevTools({ mode: 'detach' });
```

---

## 📦 依赖说明

| 包名 | 版本 | 用途 |
|------|------|------|
| electron | ^40.1.0 | 桌面应用框架 |
| lunar-javascript | ^1.6.12 | 农历计算、节假日查询 |
| axios | ^1.6.0 | HTTP 请求（AI API 调用） |
| tesseract.js | ^5.0.0 | 本地 OCR 识别 |
| electron-store | ^8.1.0 | 本地数据存储 |

---

## 🐛 常见问题

### 1. OCR 识别不到文字

- 确保图片清晰、文字对比度高
- 检查控制台日志查看 OCR 初始化状态
- 第一次使用需要下载语言包，请耐心等待

### 2. AI 解析失败

- 检查 API Key 是否正确配置
- 检查网络连接
- 查看控制台错误信息

### 3. 透明效果不生效

- Windows: 需要启用 Aero 效果
- 某些 GPU 可能不支持 `backdrop-filter`

---

## 📝 版本历史

### v1.0.0 (2026-01-29)

- ✅ 初始化 Electron 项目，无边框透明窗口
- ✅ 玻璃拟态 CSS 样式实现
- ✅ 集成 lunar-javascript，实现农历/节假日
- ✅ 任务增删改查及本地存储
- ✅ 三级视图切换（今日/月/年）
- ✅ OCR + AI 智能日程提取
- ✅ 一任务一杠动态渲染
