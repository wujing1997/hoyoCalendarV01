# HoyoCalendar 项目面试 Q&A

> 本文档梳理了 HoyoCalendar 项目在设计、实现和优化过程中涉及的核心技术点，适用于面试前快速复习。

---

## 一、项目概述

### Q1: 请简要介绍一下 HoyoCalendar 项目
**A:** HoyoCalendar 是一款基于 Electron + Python Flask 的桌面端智能日程管理应用。它支持传统的手动增删改查日程，同时集成了大语言模型（LLM），用户可以通过自然语言对话来管理日程。核心亮点包括：
- AI 对话式日程管理（基于 Function Calling）
- 自然语言快速添加日程
- 图片识别日程（多模态 AI）
- 长期循环任务支持（每日/每周/每月）
- 多 AI 提供商切换（豆包/Ollama/OpenAI）
- 毛玻璃风格（Glassmorphism）UI 设计

### Q2: 项目的技术架构是怎样的？
**A:** 采用前后端分离架构：
- **前端**：Electron 桌面应用，渲染层使用原生 HTML/CSS/JavaScript
- **后端**：Python Flask RESTful API 服务，负责数据存储和 AI 交互
- **AI 层**：通过 OpenAI Python SDK 兼容接口对接多种 LLM 提供商
- **通信**：前端通过 HTTP 请求调用后端 API
- **数据存储**：JSON 文件持久化，存储在用户 AppData 目录

### Q3: 为什么选择 Electron + Python Flask 而不是纯 Electron？
**A:** 
1. Python 生态在 AI/NLP 领域更成熟，OpenAI SDK 的 Python 版本功能最完善
2. Flask 轻量且易于扩展，适合本地桌面应用的后端服务
3. 前后端分离使得 AI 逻辑与 UI 逻辑解耦，方便独立迭代
4. 后续如果要迁移到 Web 端，后端可以直接复用

---

## 二、AI 对话与 Function Calling

### Q4: 什么是 Function Calling？在项目中如何使用？
**A:** Function Calling 是 LLM 的一种能力，允许模型在对话过程中决定调用预定义的函数。流程如下：
1. 向 LLM 发送用户消息，同时传入可用的工具函数定义（JSON Schema）
2. LLM 分析用户意图，决定是否需要调用函数
3. 如果需要，LLM 返回函数名和参数（而非直接生成文本）
4. 后端执行函数，将结果回传给 LLM
5. LLM 根据函数执行结果生成最终自然语言回复

### Q5: 项目中定义了哪些 Tool Functions？
**A:** 定义了 4 个工具函数：
- `list_events`：查询日程列表，支持按日期和关键词过滤
- `create_event`：创建新日程，包含名称、日期、时间、地点、紧急程度等字段
- `update_event`：修改已有日程（需先通过 list_events 获取 ID）
- `delete_event`：删除指定日程（需先确认 ID）

### Q6: Function Calling 的循环调用是如何控制的？
**A:** 在 `/api/chat` 接口中设置了最多 6 轮工具调用的限制：
```python
for _ in range(6):  # 最多 6 轮工具调用
    response = client.chat.completions.create(...)
    if choice.finish_reason == 'tool_calls':
        # 执行函数，将结果追加到 messages，继续循环
    else:
        # finish_reason 不是 tool_calls，说明 LLM 给出了最终回复
        break
```
这样既允许 LLM 进行多步操作（如先查询再修改），又防止无限循环。

### Q7: 如果 LLM 返回的函数参数格式不正确怎么办？
**A:** 代码中对参数解析做了异常处理：
```python
try:
    func_args = json.loads(tool_call.function.arguments)
except Exception:
    func_args = {}
```
即使 JSON 解析失败，也会传入空字典，让 `execute_function` 根据缺失参数返回合理的错误信息，而不是崩溃。

### Q8: 对话上下文是如何管理的？
**A:** 使用内存中的字典 `conversations` 存储各会话的消息历史：
- 每个 `session_id` 对应一个消息列表
- 包含 system prompt、用户消息、assistant 回复、tool call 和 tool result
- 提供 `/api/chat/reset` 接口清空指定会话
- System prompt 包含当前日期和星期信息，确保 LLM 能正确理解相对日期

### Q9: System Prompt 是如何设计的？
**A:** System Prompt 动态生成，包含：
1. 角色定义：智能日程助手
2. 当前日期和星期（每次对话时实时计算）
3. 行为约束：需要操作时使用工具函数，先查询再修改
4. 输出要求：简洁友好的中文回复

这样设计让 LLM 能正确处理"明天"、"下周一"等相对日期表述。

### Q10: 自然语言快速添加日程（/api/parse）的实现原理？
**A:** 与 Function Calling 不同，`/api/parse` 直接让 LLM 将自然语言解析为 JSON：
1. 构建 prompt，包含当前日期、相对日期映射表（明天→具体日期 等）
2. 要求 LLM 返回 `{event, date, time, location, urgency}` 格式的 JSON
3. 使用正则 `re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', content)` 从回复中提取 JSON
4. 支持一次识别多个日程（返回数组）

---

## 三、多 AI 提供商支持

### Q11: 如何实现多提供商支持？
**A:** 通过统一的 OpenAI SDK 兼容接口：
- 豆包（火山引擎）、OpenAI 本身都兼容 OpenAI API 格式
- Ollama 本地模型也提供了 OpenAI 兼容端点
- 后端维护 `PROVIDER_DEFAULTS` 字典存储各提供商默认 Base URL
- `get_ai_config()` 根据用户选择的 provider 返回对应配置
- `make_client()` 创建统一的 OpenAI 客户端实例

### Q12: Ollama 接入时遇到了什么问题？如何解决？
**A:** 遇到了 404 错误。原因是 Ollama 服务地址是 `http://localhost:11434`，但 OpenAI SDK 需要 `/v1` 路径前缀。解决方案：
```python
if provider == 'ollama' and base_url and not base_url.rstrip('/').endswith('/v1'):
    base_url = base_url.rstrip('/') + '/v1'
```
在 `get_ai_config()` 中自动为 Ollama 补全 `/v1` 后缀，对用户透明。

### Q13: 配置是如何存储和管理的？
**A:** 
- 配置以 JSON 文件存储在 `%APPDATA%/HoyoCalendar/config.json`
- 提供 `GET /api/config` 和 `PUT /api/config` 两个接口
- 前端设置面板读写完整配置对象
- 结构示例：`{ ai: { provider: "ollama", ollama: { baseUrl: "...", model: "...", apiKey: "..." } } }`

### Q14: 如果用户未配置模型会怎样？
**A:** 在 `/api/chat` 中增加了前置校验：
```python
if not cfg['model']:
    return jsonify({
        'error': '未配置模型',
        'message': '请先在设置中配置 AI 模型名称',
        'events_changed': False
    }), 400
```
返回 400 状态码和友好提示，避免向 LLM 发送空模型名导致不可预测的错误。

---

## 四、数据管理

### Q15: 为什么使用 JSON 文件而不是数据库？
**A:** 
1. 桌面端应用数据量不大，JSON 文件足够
2. 无需安装额外数据库服务，降低部署复杂度
3. 数据文件可读可编辑，方便调试
4. 存储在用户 AppData 目录，跟随系统用户隔离

### Q16: ID 生成策略是什么？如何避免冲突？
**A:** 使用时间戳 + 计数器的组合策略：
```python
_id_lock = threading.Lock()
_id_counter = 0

def generate_id() -> int:
    global _id_counter
    with _id_lock:
        _id_counter += 1
        return int(time.time() * 1000) * 1000 + _id_counter
```
- `time.time() * 1000` 提供毫秒级时间戳
- 乘以 1000 再加递增计数器，确保同一毫秒内多次调用也不重复
- 使用线程锁保证并发安全

### Q17: 循环日程是如何实现的？
**A:** 循环日程存储为一条记录，包含额外字段：
- `isRecurring`: 标记为循环日程
- `recurringType`: 类型（daily/weekly/monthly）
- `recurringDays`: 每周哪几天（weekly 类型，使用 JS getDay 格式）
- `startDate` / `endDate`: 有效日期范围
- `completedDates`: 已完成的日期数组

查询时通过 `is_date_in_recurring_range()` 判断某天是否在循环范围内，动态生成实例。

### Q18: 循环日程的进度如何计算？
**A:** `calculate_recurring_progress()` 函数：
1. 根据类型计算总天数（daily 直接算天差，weekly/monthly 逐日遍历）
2. 计算已过天数
3. 已完成次数从 `completedDates` 数组长度获取
4. 百分比 = 已完成 / 总天数 × 100

### Q19: 为什么循环日程使用 `completedDates` 数组而不是布尔值？
**A:** 因为循环日程在不同日期有不同的完成状态。例如一个每日任务，周一完成了但周二没有。用日期数组可以精确追踪每一天的完成情况。

---

## 五、Electron 桌面应用

### Q20: Electron 主进程做了哪些事情？
**A:** `main.js` 负责：
1. 启动 Python Flask 后端子进程
2. 创建 BrowserWindow 并加载 `index.html`
3. 管理应用生命周期（启动、退出时清理子进程）
4. 配置窗口参数（尺寸、图标、preload 脚本等）

### Q21: preload.js 的作用是什么？
**A:** preload 脚本在渲染进程加载前执行，运行在 Node.js 环境中。它通过 `contextBridge` 安全地向渲染进程暴露有限的 API：
- 避免直接在渲染进程中使用 Node.js API（安全风险）
- 只暴露必要的接口（如后端端口号）
- 遵循 Electron 安全最佳实践

### Q22: 前端如何与后端通信？
**A:** 纯 HTTP 通信：
- 渲染进程通过 `fetch()` 调用 Flask 后端的 REST API
- 后端地址：`http://127.0.0.1:{port}`
- 端口号通过 preload 脚本传递给渲染进程
- 所有请求/响应使用 JSON 格式

### Q23: 应用退出时如何确保后端进程被清理？
**A:** 在 Electron 的 `will-quit` 事件中：
1. 发送 kill 信号给 Python 子进程
2. 使用 `process.kill()` 或 `child_process.kill()` 终止
3. 设置超时强制终止，避免僵尸进程

---

## 六、UI 设计

### Q24: Glassmorphism（毛玻璃）效果是如何实现的？
**A:** 主要使用 CSS 属性：
```css
background: rgba(255, 255, 255, 0.05);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 16px;
```
通过半透明背景 + 模糊滤镜实现玻璃质感，配合微弱的边框增加层次感。

### Q25: 设置面板是如何动态切换提供商表单的？
**A:** 使用 JavaScript 控制显示/隐藏：
1. 下拉框 `change` 事件监听器
2. 根据选中的 provider 值，显示对应的输入区块，隐藏其他区块
3. 每个提供商有独立的输入字段组（API Key、Base URL、Model）
4. 保存时收集所有提供商的配置，而非仅当前可见的

### Q26: 进度条是如何实现的？
**A:** 长期任务的进度条使用 CSS 渐变和动态宽度：
- 外层容器设置固定高度和背景色
- 内层 div 的 `width` 属性绑定到完成百分比
- 使用 CSS transition 实现平滑动画

---

## 七、安全与开源准备

### Q27: 开源前做了哪些安全检查？
**A:** 
1. **代码审计**：确保无硬编码 API Key 或密码
2. **Git 历史清理**：使用 `git-filter-repo` 从所有提交历史中移除含敏感信息的文件
3. **创建 .gitignore**：排除 node_modules、dist、__pycache__、.env 等
4. **从历史中移除的文件**：Doubao.py（含硬编码 API Key）、dist/（含个人路径）、node_modules/

### Q28: 为什么使用 git-filter-repo 而不是 git filter-branch？
**A:** 
- `git-filter-repo` 是 Git 官方推荐的替代工具
- 比 `filter-branch` 快几十到几百倍
- API 更简洁，不易出错
- 能完整清理 reflog 和备份引用

### Q29: API Key 泄露后应该怎么做？
**A:** 
1. 立即在提供商控制台**吊销/重新生成** API Key
2. 使用 `git-filter-repo` 从 Git 历史中彻底删除
3. 如果已推送到远端，需要 `--force` 推送并通知协作者
4. 检查是否有未授权使用记录

### Q30: 配置文件如何避免泄露？
**A:** 
- 配置文件存储在 `%APPDATA%` 而非项目目录
- `.gitignore` 排除了 `.env` 和其他可能的配置文件
- API Key 由用户在运行时通过设置面板输入
- 代码中不包含任何默认 API Key 值

---

## 八、Flask 后端细节

### Q31: 为什么使用 Flask 而不是 FastAPI？
**A:** 
1. Flask 更轻量，对于本地桌面应用的简单 API 足够
2. 不需要异步特性（AI 调用是同步阻塞的，一次一个请求）
3. Flask 生态更成熟，社区资源更多
4. 学习成本更低，代码更直观

### Q32: `flask_cors` 的作用是什么？
**A:** 解决跨域问题。Electron 渲染进程使用 `file://` 协议加载 HTML，对 `http://127.0.0.1:5000` 的 API 请求属于跨域。`CORS(app)` 允许所有来源的请求。在桌面应用场景下这是安全的，因为只有本地渲染进程会调用。

### Q33: 后端 threaded=True 的含义？
**A:** Flask 的 `threaded=True` 让服务器对每个请求创建独立线程处理，而非串行。这确保：
- AI 对话请求（耗时较长）不会阻塞日程 CRUD 请求
- 多个前端请求可以并行处理

### Q34: `/api/parse-image` 图片识别是如何实现的？
**A:** 利用多模态 LLM 能力：
1. 前端将图片转为 Base64 Data URL
2. 后端构建多模态消息（包含 image_url 和 text）
3. 发送给支持视觉能力的 LLM
4. LLM 识别图片中的日程信息并返回 JSON
5. 后端用正则提取 JSON 并返回给前端

### Q35: 为什么 parse 接口的 temperature 设为 0.3？
**A:** 低 temperature 让 LLM 输出更确定性、更结构化。日程解析需要精确的日期和时间提取，不需要创造性回复。0.3 在准确性和灵活性之间取得平衡。

---

## 九、LLM 基础原理

### Q36: 什么是大语言模型（LLM）？
**A:** LLM 是基于 Transformer 架构的大规模神经网络，通过在海量文本上预训练学习语言模式。核心特点：
- 自回归生成：逐 token 预测下一个词
- 上下文学习（In-context Learning）：无需微调即可通过 prompt 完成新任务
- 涌现能力：模型规模足够大时出现推理、规划等高级能力

### Q37: Transformer 的自注意力机制是什么？
**A:** Self-Attention 允许模型在处理每个 token 时关注输入序列中所有位置：
- 计算 Query、Key、Value 矩阵
- 注意力权重 = softmax(QK^T / √d_k)
- 输出 = 权重 × V
- 多头注意力让模型从不同表示子空间捕获信息

### Q38: Temperature 参数的作用原理？
**A:** Temperature 控制 softmax 概率分布的锐度：
- $P(x_i) = \frac{e^{z_i / T}}{\sum_j e^{z_j / T}}$
- T → 0：趋向贪心选择（确定性高）
- T = 1：标准概率分布
- T > 1：更平坦的分布（更随机/有创造性）

### Q39: Token 是什么？为什么不是按字/词切分？
**A:** Token 是模型处理文本的基本单位，通常使用 BPE（Byte Pair Encoding）等子词算法：
- 平衡词汇表大小和表达能力
- 常见词作为整体 token，罕见词拆分为子词
- 中文通常 1-2 字对应 1 个 token
- Token 数量直接影响计算成本和上下文窗口限制

### Q40: 什么是 RAG（检索增强生成）？
**A:** RAG 在 LLM 生成前先从外部知识库检索相关文档：
1. 用户查询 → 向量化 → 在向量数据库中检索相似文档
2. 将检索到的文档作为上下文注入 prompt
3. LLM 基于检索内容生成回答
- 优势：减少幻觉、知识可更新、可追溯来源

---

## 十、工程实践

### Q41: 项目中用到了哪些设计模式？
**A:** 
- **工厂模式**：`make_client()` 根据配置创建不同提供商的客户端
- **策略模式**：`PROVIDER_DEFAULTS` + `get_ai_config()` 根据 provider 选择不同配置策略
- **RESTful 设计**：标准的 CRUD API 路由设计
- **会话模式**：`conversations` 字典管理多会话状态

### Q42: 如何处理并发安全？
**A:** 
- ID 生成使用 `threading.Lock()` 保护
- Flask `threaded=True` 多线程处理请求
- JSON 文件读写是原子操作（写入时直接覆盖整个文件）
- 内存中的 `conversations` 字典在 CPython 下由 GIL 保护基本操作

### Q43: 错误处理策略是什么？
**A:** 分层处理：
1. **参数校验**：API 入口处检查必要字段，返回 400
2. **配置校验**：AI 调用前检查模型配置，返回 400 有友好提示
3. **执行异常**：try-except 捕获 AI 调用和数据操作异常，返回 500
4. **JSON 解析**：对 LLM 返回内容做正则提取，容忍非标准格式

### Q44: 如果要将这个项目扩展为 Web 应用，需要哪些改动？
**A:** 
1. **后端**：基本无需改动，Flask API 可直接服务 Web 前端
2. **前端**：去除 Electron 依赖，改为标准 Web 应用
3. **配置存储**：从文件系统改为数据库
4. **认证**：添加用户登录系统
5. **数据隔离**：多用户数据分离
6. **部署**：添加 WSGI 服务器（Gunicorn）和反向代理（Nginx）

### Q45: 为什么 Ollama 的默认 api_key 设为 'ollama' 而不是空字符串？
**A:** OpenAI SDK 要求 `api_key` 参数非空，否则会抛出异常。Ollama 本地服务实际上不校验 API Key，但 SDK 层面需要一个非空值通过校验。设为 `'ollama'` 比 `'sk-placeholder'` 更语义化。

### Q46: 正则表达式提取 JSON 为什么用 `[\s\S]*` 而不是 `.*`？
**A:** `[\s\S]*` 匹配包括换行符在内的任意字符，而 `.` 默认不匹配换行符。LLM 返回的 JSON 通常是多行的，用 `[\s\S]*` 才能正确匹配完整的 JSON 块。

### Q47: 如何测试 Function Calling 的多轮调用？
**A:** 
1. 发送一条需要先查询再修改的消息，如"把明天的会议改到后天"
2. 预期 LLM 先调用 `list_events` 查询，再调用 `update_event` 修改
3. 验证循环次数不超过 6 次
4. 验证最终回复是自然语言而非 JSON

### Q48: 项目有哪些可以优化的方向？
**A:** 
1. **性能**：添加事件缓存避免频繁文件 IO
2. **数据**：迁移到 SQLite 支持更复杂查询
3. **AI**：增加 streaming 流式回复提升用户体验
4. **UI**：添加日历月视图、拖拽排序
5. **功能**：日程提醒/通知、数据导入导出

### Q49: 为什么选择在 AppData 而不是项目目录存数据？
**A:** 
1. AppData 是 Windows 推荐的用户数据存储位置
2. 不受项目目录权限限制
3. 卸载/更新应用时数据可以保留
4. 不会被 Git 误跟踪
5. 多实例运行时数据统一

### Q50: 如何确保 Git 开源仓库没有敏感信息泄露？
**A:** 
1. 使用 `git log -S "关键词" --all` 搜索所有提交
2. 使用 `git-filter-repo --invert-paths` 从历史中彻底移除文件
3. 使用 `git grep "pattern" $(git rev-list --all)` 搜索所有历史版本
4. 创建完善的 `.gitignore` 防止未来误提交
5. 代码审查确认无硬编码密钥或个人信息
6. 不在代码中存储默认 API Key，所有密钥由用户运行时配置
