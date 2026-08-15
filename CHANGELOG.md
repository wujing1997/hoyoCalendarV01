# Changelog

## 3.0.4 - 2026-08-15

### New

- 新增「长期任务」类型：自开始日起、完成之前每天显示（始终同一任务），完成后
  未来日期不再出现，开始日到完成日的全部历史保留；完成语义与普通任务一致。
- 长期任务拥有跨天累计的总专注计时（不按日重置），随同步持久化；普通任务保持
  现有按日计时行为不变，旧数据无需迁移。
- 主界面任务行为设置了专注目标的任务提供固定占位的开始/暂停按钮，与详情面板、
  进度条、重启状态共用同一数据源。
- 目标时长输入与显示统一为 `时:分:秒`（秒级精度），旧分钟数据自动兼容。
- 快速输入支持「长期任务」关键词。

### Fixed

- 专注计时实时状态不再依赖渲染时的过期快照：任务行按钮、进度条与详情读数每秒
  从 EventStore 真实计时记录刷新，从主界面或详情任意入口开始/暂停均即时生效，
  暂停冻结、完成/封顶、重渲染与重启恢复一致，长期任务跨日总计时无状态漂移。

## 3.0.3 - 2026-08-15

### Added

- 任务详情对话框按类型明确标注：Deadline 显示截止日期（含年份）与时间，
  重复任务显示循环规则（每周具体到星期几）与结束日期，普通任务标注为普通任务。
- 日/周/月视图当前日期范围不包含今天时，标题区显示「返回今天 / 返回本周 /
  返回本月」按钮，点击回到当前范围并保持视图模式；位于当前范围时自动隐藏，
  通过 visibility 切换不引起布局跳动。
- 日/周/月视图日期标题一律显示年份；跨年周两端均标注年份，避免歧义。
- 重复任务编辑：每周重复时显示星期选择器，预填当前已选星期，可直接增删
  （如「周三、四、五、六、日」改为「周三、四、五」）；每月重复时显示
  1-31 日选择器，可多选日期，短月份不存在的日期自动跳过、不顺延；保存
  更新该重复系列规则及后续实例/同步数据，不产生重复实例，保留其他字段并
  正确处理结束日期，重启后规则保留。
- 专注计时进度条：设置目标时长的任务在标题与标签之间显示实时进度条，
  按已用/总时长更新，暂停时停止、完成后到 100%，与持久化计时状态一致，
  固定占位不引起布局跳动。

### Fixed

- 登录态持久化：刷新凭据在网络上暂时不可用时不再被清除（此前网络失败会被
  误判为失效并删除本地凭据，导致重启后账号丢失）；只有服务端明确判定刷新
  凭据失效或用户主动退出才回到登录界面。客户端不再发送缺少 `Authorization`
  的请求——未持有访问令牌时同步直接跳过并在恢复后自动续期，杜绝
  `missing authorization header`；启动阶段先恢复会话再启动同步。
- 同步队列加载不再信任文件任意结构：旧版/损坏的 `sync-queue.json`（如对象
  映射、`{queue:[...]}` 包装、混入无效条目）会在启动时被兼容迁移为合法数组，
  可恢复条目无损保留并继续补推，原始文件自动备份为
  `sync-queue.backup-<时间戳>.json`；修复此前 `this.queue.filter is not a
  function` 导致登录后同步报错的类型异常。

## 3.0.2 - 2026-08-14

### Changed

- 默认云端服务器地址改为公网 HTTPS `https://api.jianghaihaoyang.online`，
  客户端无需 SSH 隧道即可直连用户 API（管理后台仍保持私有）。
- 新增幂等迁移：仅当已保存地址规范化后恰好是旧默认 `http://127.0.0.1:8000`
  时自动迁移到新 HTTPS 地址；用户自定义地址与显式本地开发配置不受影响。

### Fixed

- 快捷输入（quick input）新增日程不再只写本地：复用与详情表单一致的
  `notifyLocalChange` 同步接入机制，创建成功后进入同步队列（离线/未登录时
  保留在本地队列，恢复在线后自动补推）；同步失败不会回滚已成功的本地创建，
  重复通知不会重复入队。

## 3.0.1 - 2026-08-10

### Fixed

- 登录弹窗的 `×` 无法关闭：关闭按钮统一改为 document 级事件委托，与设置弹窗
  一致，`×`、Esc、遮罩点击均可关闭账号弹窗。
- 登录与注册同屏展示：补齐 `.hidden` 类样式规则，登录/邀请码注册改为明确
  模式切换，各模式仅显示自身字段、主按钮与提示，输入内容互不串扰。

## 3.0.0 - 2026-07-30

### New

- Rebuilt the interface as a focused productivity workspace with day, week and
  month views.
- Added responsive wide, compact and minimum-size layouts.
- Added local natural-language parsing for common dates, times, durations,
  recurring tasks and deadlines.
- Added searchable task details, calendar filters, theme switching, timers and
  saved window preferences.

### Changed

- Moved all event writes into one atomic local `EventStore`.
- Changed the Python service into a planning-only Agent that returns actions for
  the local store to apply.
- Reduced Agent latency with intent-based tool selection, bounded history and a
  maximum of three tool rounds.
- Made AI optional: core calendar workflows continue to work when the Agent is
  unavailable or unconfigured.
- Replaced raw connection errors with clear in-app status messages.

### Fixed

- Deadline completion now moves the task into the completion section instead of
  making it vanish immediately.
- Clicking a completed Deadline again restores it to the active schedule.
- A completed Deadline no longer appears on later dates.
- Ordinary recurring tasks still complete independently for each date.
- Window state is saved reliably during application shutdown.

## 2.3.0

- Introduced Deadline tasks and daily remaining-day labels.
- Added initial AI creation support for deadline expressions.
