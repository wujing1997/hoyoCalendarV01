# 长期任务与全局专注计时 — 已批准设计（HOY-4 / v3.0.4）

> 状态:用户已批准(2026-08-15)。本文件为唯一权威规格,实施与验收均以本文件为准。

## 1. 目标

1. 新增任务类型「长期任务」:从开始日起、完成之前每天显示,始终是**同一条任务**(同一 ID);
   完成后不再出现在未来日期,完成日及此前历史保留。
2. 长期任务拥有**跨天累计**的总专注计时:总专注秒数不按日重置,随同步持久化。
3. 主界面任务行为设置了专注目标的任务提供**固定占位**的开始/暂停控件,与详情面板、进度条、
   重启状态共用同一数据源。
4. 专注目标(目标时长)的输入与显示精确到 `时:分:秒`。
5. 旧数据与普通任务按日计时行为完全不变;版本统一递增至 3.0.4。

## 2. 数据模型(全部为新增可选字段,零迁移)

| 字段 | 类型 | 语义 |
|---|---|---|
| `isLongTerm` | boolean | 长期任务标记;缺省 false |
| `startDate` | string YYYY-MM-DD | 开始日(已有字段,长期任务必须存在) |
| `focusTotalSeconds` | number | 跨天累计专注秒数(≥0 整数),长期任务专用 |
| `focusRunningSince` | string\|null | 计时运行中开始时间(ISO),停止时置 null |
| `targetDurationSeconds` | number | 目标时长(秒,≥0;0/缺省=无目标);所有任务通用 |
| `targetDurationMinutes` | number | 兼容保留:按秒数四舍五入分钟,供旧客户端读取 |

完成语义复用普通任务字段:`isCompleted` / `completedDate` / `completedAt`。

### 归一化规则(`normalizeEvent`, isLongTerm 分支)

- `isLongTerm` 与 deadline/recurring **互斥**:置为长期任务时删除
  `isDeadline/deadlineDate/isDeadlineCompleted/deadlineCompletedDate/isRecurring/
  recurringType/recurringDays/recurringMonthDays/completedDates`;反之删除
  `isLongTerm/focusTotalSeconds/focusRunningSince`(切回普通类型时清除全局计时)。
- `date = startDate`(开始日即长期任务的基准日期);`startDate` 非法时回退当天。
- `focusTotalSeconds` 归一为 `Math.max(0, Math.floor(Number(...)||0))`。
- `focusRunningSince`:仅当为合法 ISO 时间字符串时保留,否则 null。
- `targetDurationSeconds`:非负整数;`targetDurationMinutes = Math.round(seconds/60)`(仅当 >0)。
- 读取回退:目标时长 = `targetDurationSeconds ?? targetDurationMinutes*60 ?? 0`。

### 计时语义

- 长期任务:`updateTimer(id, date, shouldRun)` 操作全局字段
  `focusTotalSeconds` + `focusRunningSince`(跨天累计,不按日重置);
  `getTimerRecord(id, date)` 对长期任务返回
  `{ elapsedSeconds: focusTotalSeconds, runningSince: focusRunningSince }`
  (渲染层 live 增量逻辑复用现有 `elapsedSeconds()`)。
- 普通任务/其他类型:维持现有 `timerRecords[dateStr]` 按日行为,不改动。
- 计时状态随事件 data 整体同步(无 `_` 前缀字段全部进入 push 载荷),服务端 JSON 透传,零后端改动。

## 3. 显示语义(`eventsForDate` 新增 isLongTerm 分支)

```
active        = !isCompleted && date >= startDate            // 每天显示,同一条(同 ID 派生实例)
completedHere = isCompleted && startDate <= date <= completedDate  // 完成日及此前全部历史保留
```

- 未完成:自开始日起每天显示;完成后:开始日→完成日的全部日期保留(已完成实例),
  完成后的未来日期不再出现。
- 无 deadline、无 overdue 语义。
- `toggleComplete` 走普通分支(设置/清除 isCompleted + completedDate)。

## 4. 主界面交互

- 任务行网格新增固定列(所有行恒占位,避免布局跳动):
  - 设置了专注目标(`targetDurationSeconds > 0`)的任务行显示 ⏵/⏸ 按钮;
  - 无目标任务显示空占位;
  - 按钮状态(运行中/暂停)与详情面板、进度条一致,点击调 `toggleTimer`。
- 进度条:总时长取 `targetDurationSeconds ?? targetDurationMinutes*60`,其余逻辑不变。
- 详情面板:
  - 类型选择器新增「长期任务」选项;选择后隐藏重复/截止相关字段,显示开始日期与目标时长;
  - 目标时长输入改为 `时:分:秒`(接受 `H:MM:SS` / `MM:SS` / `SS` 形式),保存转秒,
    详情计时读数与进度条均以 `时:分:秒` 显示;
  - 类型标注:长期任务显示「长期任务 · 开始 YYYY年M月D日」(含累计/目标时长元信息)。
- 快速输入:识别「长期任务」关键词创建长期任务(增强项)。

## 5. 同步与兼容

- 新字段自动进入同步载荷;旧客户端(≤3.0.3)忽略未知字段,长期任务降级为单日普通任务显示,不崩溃;
  旧数据无新字段时按缺省处理。已知取舍:双端同时运行计时时 `focusRunningSince` 以最后写入为准,
  不做复杂合并(单设备使用为主)。

## 6. 版本与发布

- 版本统一 3.0.4(package.json 含 productName/artifactName、package-lock.json、index.html、
  renderer.js 缺省、backend/app.py、README、CHANGELOG 新增 3.0.4 条目)。
- 本阶段仅本地 Git commit;独立复验通过、用户确认后再推送并发布(PR → tag v3.0.4 →
  Release Latest,资产 exe/blockmap/.sha256,旧 Release 不动)。
