# HoYoCalendar V3.0.3

HoYoCalendar 是一款面向日常效率工作的 Windows 桌面日程工具。V3.0
采用本地优先架构：常见新增、查询、完成和恢复都在本机立即执行，AI 只处理
批量调整、模糊查询等复杂指令。

## 主要功能

- 日、周、月三种日历视图
- 宽屏工作区与紧凑悬浮窗口
- 已逾期、全天、时间安排、已完成分区
- 普通任务、重复任务与 Deadline 任务
- 自然语言快速新增，无需等待 AI
- 任务详情编辑、复制、删除与专注计时
- 农历信息、日历筛选、搜索和深浅主题
- 可选的日程助手，用于复杂查询和批量操作

## Deadline 模式

输入 `8月10号前写完论文` 会创建一条 Deadline：

- 从创建当天到 8 月 10 日每天出现
- 每天显示距截止日还剩多少天
- 第一次点击完成后进入当天的“已完成”区域
- 再次点击完成标记可以恢复
- 完成后不会继续出现在后续日期
- 原始数据保留，不会因完成而删除

## 快速输入

底部输入框会优先使用本地解析器，常见命令无需网络：

```text
明天9点项目会议45分钟
8月10号前写完论文
每天晚上9点复盘
每周三和周五健身
```

解析结果会在输入框上方显示日期、时间、时长、重复或截止标签。
涉及修改、删除、批量移动和复杂条件的命令会交给日程助手。

## 安装

从 [GitHub Releases](https://github.com/wujing1997/hoyoCalendarV1/releases)
下载 `HoYoCalendarV3.0.3-setup.exe` 并运行。

安装包内已包含 Electron 应用与 Python Agent 服务，普通使用不需要另外安装
Node.js 或 Python。

## 从源码运行

环境要求：

- Node.js 18+
- Python 3.9+

```bash
npm install
python -m pip install -r backend/requirements.txt
npm start
```

## AI 设置

日程助手是可选功能。未配置 AI 时，本地日程、Deadline、重复任务、搜索和
快速新增仍可正常使用。

设置中支持：

| 提供商 | 默认地址 | 配置 |
| --- | --- | --- |
| 豆包 | `https://ark.cn-beijing.volces.com/api/v3` | API Key、模型 |
| Ollama | `http://localhost:11434/v1` | 模型 |
| OpenAI/兼容服务 | `https://api.openai.com/v1` | API Key、模型 |

## 数据位置

所有数据保存在本机：

```text
%APPDATA%\HoyoCalendar\
  events.json
  config.json
```

V3.0 会读取并规范化旧版 `events.json`，不会主动删除旧任务。写入使用临时文件
替换，避免进程中断留下半份 JSON。

## V3 架构

```text
Renderer
  UI、日/周/月视图、详情编辑
       |
       v
Preload
  CommandRouter ---------> EventStore ---------> events.json
  本地意图路由             唯一数据写入层
       |
       | 仅复杂指令
       v
Python Agent Service
  工具裁剪、最多 3 轮调用、只返回 action plan
       |
       v
EventStore.applyActions()
  在本地事务式应用 AI 规划
```

关键约束：

- Python 后端不直接读写 `events.json`
- 所有事件写入统一经过 Electron 本地数据层
- 后端仅监听动态的 `127.0.0.1` 端口
- Agent 每次只获得与意图相关的工具
- 会话上下文有界，避免历史无限增长

## 项目结构

```text
backend/
  app.py                 本地 Agent HTTP 服务
  agent_service.py       工具路由与 action plan
  config_store.py        AI 配置存储
  tests/
src/core/
  command-router.js      本地/Agent 路由
  date-utils.js          日期工具
  event-store.js         统一事件模型与持久化
  quick-parser.js        本地自然语言解析
index.html               应用结构
styles.css               响应式效率型界面
renderer.js              视图与交互
preload.js               安全 API 桥接
main.js                  窗口和后端生命周期
tests/                   JavaScript 核心测试
```

## 测试与构建

```bash
npm test
npm run build
```

单独构建：

```bash
npm run build:backend
npm run build:electron
```

Windows 安装包输出到：

```text
dist/HoYoCalendarV3.0.3-setup.exe
```

## 发布记录

参见 [CHANGELOG.md](CHANGELOG.md)。
