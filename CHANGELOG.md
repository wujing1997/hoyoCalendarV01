# Changelog

## 3.0.2 - 2026-08-14

### Changed

- 默认云端服务器地址改为公网 HTTPS `https://api.jianghaihaoyang.online`，
  客户端无需 SSH 隧道即可直连用户 API（管理后台仍保持私有）。
- 新增幂等迁移：仅当已保存地址规范化后恰好是旧默认 `http://127.0.0.1:8000`
  时自动迁移到新 HTTPS 地址；用户自定义地址与显式本地开发配置不受影响。

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
