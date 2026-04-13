# HoyoCalendar

> 玻璃拟态风格的桌面悬浮日历应用，支持 AI 对话式日程管理

一款基于 Electron + Python Flask 的桌面日历工具，拥有精致的毛玻璃 UI、农历/节假日显示、三级视图切换，以及通过自然语言对话即可管理日程的 AI 助手。

---

## 📖 使用指南

### 安装与启动

**环境要求**：Node.js 18+、Python 3.8+

**方式一：直接使用打包版（推荐）**

从 Releases 下载 `HoYoCalendarV1.5-setup.exe`，双击后按向导安装即可使用，无需手动配置运行环境。

**方式二：从源码运行**

```bash
# 1. 安装前端依赖
npm install

# 2. 安装后端依赖
pip install -r backend/requirements.txt

# 3. 启动应用
npm start
```

启动后，应用会自动运行 Python 后端服务并打开一个透明悬浮窗口。

### 窗口操作

应用窗口为无边框悬浮窗口，标题栏区域可以拖拽移动。右上角按钮从左到右依次为：

| 按钮 | 功能 |
|------|------|
| 💬 | 打开/关闭 AI 聊天面板 |
| ⚙️ | 打开/关闭设置面板 |
| 📌 | 切换窗口置顶/取消置顶 |
| ➖ | 最小化窗口 |
| ✕ | 关闭应用 |

### 日历视图

应用提供三级视图，点击日期头部区域切换：

- **今日视图（默认）**：顶部显示一周日期选择器，点击任意日期查看当天日程。每个日期下方的小短线表示当天有多少个任务。
- **月视图**：点击头部的「月份」进入。7×6 网格显示整月日历，同时展示农历日期和节假日标记（休/班）。点击某天可跳回今日视图查看该日日程。
- **年视图**：点击头部的「年份」进入。一次看到 12 个月的缩略日历，点击某月进入月视图。

每个视图都有「← 返回今日」按钮，一键回到当天。

### 添加日程

在底部输入框中输入内容，按回车即可。输入内容会自动发送到 AI 聊天面板，由 AI 助手理解你的意思并创建日程。

**示例**：
- `明天下午3点开会` → AI 会自动创建明天 15:00 的「开会」日程
- `每天背单词` → AI 会创建一个每日循环的长期任务
- `每周三和周五去健身房` → AI 会创建每周三、五循环的任务
- `删除明天的会议` → AI 会查找并删除对应日程
- `我后天有什么安排？` → AI 会查询并告诉你
- `我的论文报告deadline是什么时候？` → AI 会查询并告诉你

你也可以点击输入框右侧的 **＋** 按钮上传图片，如果你接入的大模型是多模态的。AI 会识别图片中的日程信息。

### AI 聊天面板

点击标题栏的 💬 按钮打开聊天面板。你可以在聊天中用自然语言管理所有日程：

- **创建日程**：「帮我加一个下周一的项目评审」
- **查询日程**：「这周五有什么安排」
- **修改日程**：「把明天的会议改到后天」
- **删除日程**：「取消周三的健身」
- **创建长期任务**：「从明天开始每天早上7点跑步，持续到6月底」
- **闲聊**：AI 也可以回答日程以外的问题

### 管理日程

- **右键日程项**：弹出菜单，可以编辑或删除日程
- **循环任务打卡**：长期循环任务在日程列表中会显示进度条，点击可标记当天已完成

### 设置 AI 服务

点击标题栏的 ⚙️ 按钮打开设置面板，配置 AI 提供商：

| 提供商 | 需要配置 | 说明 |
|--------|----------|------|
| **豆包 (Doubao)** | API Key + Model | 火山引擎的大模型服务 |
| **Ollama** | Model | 本地运行的开源大模型，无需 API Key |
| **OpenAI** | API Key + Model | OpenAI 官方或兼容 API |

1. 选择 AI 提供商
2. 填入对应的 API Key（Ollama 不需要）
3. 填入模型名称（如 `doubao-seed-1-8-251228`、`llama3.2`、`gpt-4o-mini`）
4. 点击保存

### 数据存储

所有日程和配置保存在本地：

```
Windows: %APPDATA%\HoyoCalendar\
  ├── events.json    # 日程数据
  └── config.json    # AI 配置
```

---

## 🐛 常见问题

### 聊天面板显示错误

- 确认 Python 已安装且 `pip install -r backend/requirements.txt` 已执行
- 重启应用让后端服务重新初始化

### AI 没有反应或回复出错

- 打开设置面板检查 API Key 和 Model 是否正确填写
- 豆包用户确认 API Key 有效且模型名称正确
- Ollama 用户确认本地服务运行中（`ollama serve`）

### 窗口透明效果不生效

- Windows 需要启用 Aero/桌面窗口管理器
- 某些显卡驱动可能不支持 `backdrop-filter`

### AI 无法创建长期/循环任务

- 使用明确的关键词如「每天」「每周」「每月」
- 示例：「每天晚上9点复习英语，从今天开始持续到5月底」

---

## 🔧 技术文档

<details>
<summary>点击展开技术实现细节</summary>

## 📁 项目结构

```
hoyoCalendar/
├── main.js              # Electron 主进程（窗口管理 + 启动 Flask 后端）
├── preload.js           # 预加载脚本（API 桥接，Node.js http 请求）
├── renderer.js          # 渲染进程逻辑（UI 交互、视图管理）
├── index.html           # 主页面 HTML
├── styles.css           # 玻璃拟态 CSS 样式
├── ai-service.js        # AI 服务模块（旧版，已由后端替代）
├── backend/
│   ├── app.py           # Python Flask 后端（AI 对话、Function Calling）
│   └── requirements.txt # Python 依赖
├── package.json         # 项目配置
└── README.md            # 本文档
```

---

## 🏗️ 架构设计

### 前后端分离架构

```
┌─────────────────────────────────────────────────────────┐
│              Python Flask Backend (backend/app.py)       │
│  - AI 对话 + Function Calling（增删改查日程）             │
│  - 多 AI 提供商（豆包/Ollama/OpenAI）                    │
│  - 日程 CRUD REST API                                    │
│  - 长期循环任务支持                                       │
│  - 配置管理 API                                          │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTP (127.0.0.1:动态端口)
┌─────────────────────▼───────────────────────────────────┐
│                    Main Process (main.js)                │
│  - 启动 Flask 后端（自动查找可用端口）                     │
│  - 窗口管理（无边框、透明、置顶）                          │
│  - IPC 通信处理                                          │
└─────────────────────┬───────────────────────────────────┘
                      │ IPC
┌─────────────────────▼───────────────────────────────────┐
│                 Preload Script (preload.js)              │
│  - contextBridge 暴露安全 API                            │
│  - Node.js http 模块与后端通信（非 fetch）                │
│  - electronAPI: 窗口控制                                 │
│  - eventAPI: 本地日程存储（fs 读写）                      │
│  - lunarAPI: 农历计算（lunar-javascript）                 │
│  - aiAPI: AI 对话/解析（→ Flask 后端）                    │
│  - configAPI: 配置管理（→ Flask 后端）                    │
└─────────────────────┬───────────────────────────────────┘
                      │ window.*API
┌─────────────────────▼───────────────────────────────────┐
│               Renderer Process (renderer.js)             │
│  - UI 渲染和交互                                         │
│  - 三级视图管理（今日/月/年）                              │
│  - AI 聊天面板（对话式日程管理）                           │
│  - 设置面板（AI 提供商配置）                              │
└─────────────────────────────────────────────────────────┘
```

---

## 📄 核心文件详解

### 1. main.js - 主进程

**职责**：启动 Flask 后端、创建和管理 Electron 窗口

**启动流程**：
1. `findAvailablePort(5000)` — 从 5000 开始查找可用端口
2. `startBackend()` — 依次尝试 `python`/`python3`/`py` 启动 `backend/app.py`
3. `createWindow()` — 创建 Electron 窗口
4. 应用退出时 `stopBackend()` 终止 Flask 进程

```javascript
// 窗口关键配置
const mainWindow = new BrowserWindow({
  width: 360, height: 600,
  frame: false,           // 无边框
  transparent: true,      // 透明背景
  alwaysOnTop: true,      // 始终置顶
  resizable: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false         // 允许 preload 使用 Node.js 模块
  }
});
```

**IPC 通信**：
- `get-backend-port`: 返回 Flask 后端的动态端口号
- `window-minimize`: 最小化窗口
- `window-close`: 关闭窗口
- `window-toggle-pin`: 切换置顶状态
- `resize-window`: 调整窗口高度

---

### 2. backend/app.py - Python Flask 后端

**职责**：AI 对话式日程管理 + 日程 CRUD API

#### 2.1 AI Function Calling

后端使用 OpenAI SDK 的 Function Calling 机制，为 AI 提供 4 个工具函数：

| 工具函数 | 说明 |
|----------|------|
| `list_events` | 查询日程，支持按日期/关键词过滤（含循环日程） |
| `create_event` | 创建日程（支持一次性 + 长期循环任务） |
| `update_event` | 修改日程信息 |
| `delete_event` | 删除日程 |

AI 对话最多进行 6 轮 Function Calling 迭代，确保复杂操作能正确完成。

#### 2.2 长期循环任务

`create_event` 支持创建循环任务，相关字段：

| 字段 | 说明 |
|------|------|
| `isRecurring` | 是否为循环任务 |
| `recurringType` | 循环类型：`daily`（每天）/ `weekly`（每周）/ `monthly`（每月） |
| `recurringDays` | 每周重复的日期，`0`=周日, `1`=周一, ..., `6`=周六 |
| `startDate` / `endDate` | 循环任务起止日期 |
| `completedDates` | 已完成日期列表（用于进度追踪） |

#### 2.3 REST API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/events` | GET | 获取日程列表（`?date=`按日期过滤，含循环展开） |
| `/api/events` | POST | 创建日程（含循环任务） |
| `/api/events/<id>` | PUT | 更新日程 |
| `/api/events/<id>` | DELETE | 删除日程 |
| `/api/events/<id>/toggle-complete` | POST | 标记循环任务某天完成/未完成 |
| `/api/chat` | POST | AI 对话（Function Calling） |
| `/api/chat/reset` | POST | 重置对话上下文 |
| `/api/parse` | POST | AI 自然语言解析为结构化日程 JSON |
| `/api/parse-image` | POST | AI 多模态图片日程识别 |
| `/api/config` | GET/PUT | 读取/保存配置 |

#### 2.4 多 AI 提供商支持

| 提供商 | 默认 Base URL | 备注 |
|--------|---------------|------|
| 豆包 (Doubao) | `https://ark.cn-beijing.volces.com/api/v3` | 火山引擎 |
| Ollama | `http://localhost:11434/v1` | 本地部署，自动补 `/v1` |
| OpenAI | `https://api.openai.com/v1` | 及兼容 API |

---

### 3. preload.js - 预加载脚本

**职责**：安全 API 桥梁 + 本地数据存储

**网络通信**：使用 Node.js 原生 `http` 模块（`httpRequest()` 封装）与 Flask 后端通信，而非 `fetch`（在 Electron preload 环境中不可靠）。

**暴露的 API**：

| API | 功能 |
|-----|------|
| `electronAPI` | 窗口控制（最小化、关闭、置顶） |
| `eventAPI` | 日程本地存储 CRUD + 长期任务管理 |
| `lunarAPI` | 农历转换、节假日、节气查询 |
| `aiAPI` | AI 对话 (`chat`)、文本解析 (`parseEvent`)、图片解析 (`parseImage`) |
| `configAPI` | 配置读写（→ Flask 后端） |

**EventStore 方法**：

```javascript
EventStore = {
  loadEvents()                         // 读取所有日程
  saveEvents(events)                   // 保存所有日程
  addEvent(event)                      // 添加日程（支持循环任务）
  updateEvent(id, data)                // 更新日程
  deleteEvent(id)                      // 删除日程
  getEventsByDate(date)                // 获取指定日期日程（展开循环实例）
  getTaskCounts()                      // 每日任务数量统计（含循环任务）
  toggleRecurringDateComplete(id, date) // 标记循环任务某天完成
  getRecurringEvents()                 // 获取所有循环任务
};
```

存储路径：`%APPDATA%\HoyoCalendar\events.json`

---

### 4. renderer.js - 渲染进程

**职责**：UI 渲染、视图管理、AI 聊天面板、设置面板

#### 4.1 三级视图系统

| 视图 | 内容 |
|------|------|
| **今日视图** | 周日期选择器 + 当天日程列表 + 任务指示器 |
| **月视图** | 7×6 日历网格，显示公历/农历/节假日标记 |
| **年视图** | 3×4 网格显示 12 个月缩略日历 |

#### 4.2 AI 聊天面板

底部输入框输入内容后统一通过 AI 对话管理日程：

```
用户输入文本 → addTask() → 打开聊天面板 → sendChatFromInput()
    → aiAPI.chat() → Flask /api/chat → AI Function Calling
    → 自动增删改查日程 → 返回自然语言回复 → 刷新日历 UI
```

#### 4.3 设置面板

支持在 UI 中切换 AI 提供商并配置 API Key / Base URL / Model。

---

### 5. styles.css - 玻璃拟态样式

#### CSS 变量

```css
:root {
  --primary-blue: #007AFF;
  --genshin-orange: #ff9f43;
  --starrail-blue: #54a0ff;
  --glass-bg: rgba(255, 255, 255, 0.15);
  --glass-blur: 30px;
  --glass-border: rgba(255, 255, 255, 0.3);
}
```

全局 `user-select: none` 保护 UI，输入框单独覆盖 `user-select: text`。

---

## 🔄 数据流

### AI 对话管理日程（主流程）

```
用户输入文本（底部输入框）
    │
    ▼
addTask() → 打开聊天面板
    │
    ▼
sendChatFromInput(text)
    │
    ▼
aiAPI.chat(message, sessionId)
    │  (Node.js http → Flask 后端)
    ▼
Flask /api/chat
    │
    ▼
OpenAI SDK + Function Calling（最多 6 轮）
    │
    ├── list_events() ──► 查询日程
    ├── create_event() ──► 创建日程（含循环任务）
    ├── update_event() ──► 修改日程
    └── delete_event() ──► 删除日程
    │
    ▼
返回 { message, events_changed }
    │
    ▼
显示 AI 回复 + 如果 events_changed 则刷新 UI
```

---

## ⚙️ 配置结构

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
  }
}
```

---

##  依赖说明

### 前端 (npm)

| 包名 | 用途 |
|------|------|
| electron | 桌面应用框架 |
| lunar-javascript | 农历计算、节假日、节气查询 |

### 后端 (pip)

| 包名 | 用途 |
|------|------|
| flask | Web 框架 |
| flask-cors | 跨域支持 |
| openai | AI SDK（兼容豆包/Ollama/OpenAI） |

---

##  版本历史

### v1.0.0 (2026-01-29)

- ✅ Electron 无边框透明窗口 + 玻璃拟态样式
- ✅ 集成 lunar-javascript 农历/节假日
- ✅ 任务增删改查及本地存储
- ✅ 三级视图切换（今日/月/年）

### v1.1.0 (2026-03-31)

- ✅ 重构为 Electron + Python Flask 前后端分离架构
- ✅ AI 对话式日程管理（Function Calling）
- ✅ 多 AI 提供商支持（豆包/Ollama/OpenAI）
- ✅ 长期循环任务支持（每天/每周/每月）
- ✅ 聊天面板 + 设置面板
- ✅ preload 使用 Node.js http 模块替代 fetch

### v0.1.0 (2026-03-31)

- ✅ 使用 PyInstaller + electron-builder 打包为单文件 portable exe
- ✅ 打包后无需安装 Python/Node.js 环境即可运行
- ✅ main.js 自动检测打包模式，生产环境使用编译后的 backend_server.exe

</details>
