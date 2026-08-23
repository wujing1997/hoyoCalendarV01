# 长期任务与全局专注计时 — 实施计划（HOY-4 / v3.0.4）

> 规格见 `../specs/long-term-tasks-and-focus-timer.md`。TDD:先写测试,再实现,最后跑全量回归。

## 步骤

1. **docs**:提交规格与本文档(单独 commit)。
2. **event-store.js(TDD)**
   - 测试:`tests/event-store.test.js` 新增——
     - 长期任务开始日起每天显示且同 ID;完成日保留、完成日后隐藏;
     - 归一化:isLongTerm 与 deadline/recurring 互斥、focusTotalSeconds 非负取整、
       focusRunningSince 非法置 null、targetDurationSeconds→Minutes 同步、
       读取回退(仅 minutes 的旧数据);
     - 计时:长期任务跨天累计(focusTotalSeconds 跨日不重置、按日 timerRecords 不动)、
       getTimerRecord 长期任务形状、普通任务按日行为不变;
     - 重启:同一 dataDir 重新打开 EventStore 后字段保留。
   - 实现:`normalizeEvent` isLongTerm 分支;`eventsForDate` isLongTerm 分支;
     `updateTimer`/`getTimerRecord` 长期任务分支;`targetDurationSecondsFor` 辅助。
3. **quick-parser.js(TDD)**
   - 测试:「长期任务:学英语」→ isLongTerm、标题清洗、非互斥类型不受影响。
   - 实现:`isLongTerm` 识别与 cleanTitle 清洗。
4. **renderer.js(TDD,源码级测试 `tests/view-features.test.js`)**
   - 测试:类型选择含 longterm 选项;时:分:秒输入解析/格式化;行固定列与 ⏵/⏸ 按钮标记
     (data-task-timer)、仅目标任务显示、空占位;meta 目标时长 HH:MM:SS;进度条总时长取秒;
     detailTypeText 长期任务标注。
   - 实现:detailMarkup 类型分支与时长输入、formUpdates 秒级转换、
     renderTaskRow 计时列、handleViewContentClick 行按钮委托、进度条/元信息秒级。
5. **styles.css**:行网格 6 列固定占位;计时按钮样式(运行中高亮)。
6. **sync-engine.test.js(TDD)**:长期任务创建/编辑后队列载荷含新字段;flushPush 后服务端
   data 含 focusTotalSeconds/targetDurationSeconds;旧格式事件(仅 minutes)同步不变。
7. **版本 3.0.4**:package.json(version/productName/artifactName)、package-lock.json(2 处)、
   index.html(title/appVersion)、renderer.js 缺省、backend/app.py、README(3 处)、
   CHANGELOG(新增 3.0.4 条目,含长期任务与计时改动)。
8. **全量回归**:`npm run test:core` 全部通过;`node --check` 全部改动文件。
9. **本地提交**(按模块拆分,不 push)。
10. **构建与手测**:重建候选(后端+electron+`.sha256`),正常退出旧候选进程后启动新版,
    验证窗口 3.0.4、日志无错误、asar 与源码逐字节一致,保持打开供用户手测。

## 验收清单(对应总管验收范围)

- [ ] 主界面为设置专注目标的任务提供固定占位开始/暂停控件,布局不跳;
- [ ] 目标输入与显示精确到时:分:秒,与详情、进度条、重启状态一致;
- [ ] 长期任务:开始日起完成前每天显示、同一 ID;完成日及历史保留、未来隐藏;
- [ ] 总专注秒数跨日累计并随同步持久化;旧数据与普通任务按日计时行为不变;
- [ ] 版本字段统一 3.0.4;
- [ ] 模型/边界/同步/重启/布局/回归测试补齐;
- [ ] 仅本地 Git commit,无 push/PR/tag/Release/远端改动。
