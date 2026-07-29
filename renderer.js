'use strict';

(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const SHORT_DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
  const realToday = startOfDay(new Date());

  const state = {
    selectedDate: realToday,
    calendarCursor: monthStart(realToday),
    currentView: 'day',
    events: [],
    selectedEventId: null,
    hideCompleted: false,
    completedCollapsed: false,
    activeCalendars: new Set(['个人', '工作']),
    menuTargetId: null,
    lastUndo: null,
    toastTimer: null,
    assistantBusy: false,
    settingsConfig: {},
    editingProvider: 'doubao',
    windowState: {
      isPinned: false,
      isMaximized: false,
      mode: window.innerWidth <= 720 ? 'compact' : 'wide',
    },
  };

  function startOfDay(value) {
    const date = value instanceof Date ? value : new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(value, amount) {
    const date = startOfDay(value);
    date.setDate(date.getDate() + amount);
    return date;
  }

  function monthStart(value) {
    const date = startOfDay(value);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function weekStart(value) {
    const date = startOfDay(value);
    return addDays(date, -date.getDay());
  }

  function dateKey(value) {
    const date = startOfDay(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return startOfDay(new Date());
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function sameDay(left, right) {
    return dateKey(left) === dateKey(right);
  }

  function formatDate(value, options) {
    return new Intl.DateTimeFormat('zh-CN', options).format(value);
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function refreshIcons() {
    if (window.lucide?.createIcons) {
      window.lucide.createIcons({
        attrs: {
          'stroke-width': 2,
        },
      });
    }
  }

  function icon(name) {
    return `<i data-lucide="${name}"></i>`;
  }

  function apiAvailable() {
    return Boolean(window.eventAPI);
  }

  function loadEvents() {
    state.events = apiAvailable() ? (window.eventAPI.loadEvents() || []) : [];
    if (
      state.selectedEventId !== null
      && !state.events.some((event) => String(event.id) === String(state.selectedEventId))
    ) {
      state.selectedEventId = null;
    }
    if (state.selectedEventId === null && state.events.length) {
      const todayEvents = getEventsForDate(dateKey(state.selectedDate));
      state.selectedEventId = todayEvents[0]?.id ?? state.events[0].id;
    }
  }

  function getSourceEvent(id) {
    return state.events.find((event) => String(event.id) === String(id)) || null;
  }

  function calendarIsVisible(event) {
    const calendar = event.calendar || '个人';
    if (!['个人', '工作'].includes(calendar)) return true;
    return state.activeCalendars.has(calendar);
  }

  function getEventsForDate(dayKey, options = {}) {
    if (!apiAvailable()) return [];
    return (window.eventAPI.getEventsByDate(dayKey, options) || [])
      .filter(calendarIsVisible);
  }

  function getEventsBetween(start, end) {
    if (!apiAvailable()) return {};
    const range = window.eventAPI.getEventsBetween(start, end) || {};
    return Object.fromEntries(
      Object.entries(range).map(([day, events]) => [
        day,
        events.filter(calendarIsVisible),
      ]),
    );
  }

  function eventTypeLabel(event) {
    if (event.isDeadline) return 'Deadline';
    if (event.isRecurring) return '重复任务';
    return event.time ? '定时日程' : '全天任务';
  }

  function recurrenceLabel(event) {
    if (!event.isRecurring) return '';
    if (event.recurringType === 'weekly') return '每周';
    if (event.recurringType === 'monthly') return '每月';
    return '每天';
  }

  function eventNavigationDate(event) {
    if (event.isDeadline) {
      if (event.isDeadlineCompleted && event.deadlineCompletedDate) {
        return parseDateKey(event.deadlineCompletedDate);
      }
      const todayKey = dateKey(realToday);
      if (todayKey >= event.startDate) return realToday;
      return parseDateKey(event.startDate || event.date);
    }
    if (event.isRecurring) {
      const todayKey = dateKey(realToday);
      if (todayKey >= event.startDate && todayKey <= event.endDate) return realToday;
      return parseDateKey(event.startDate || event.date);
    }
    return parseDateKey(event.date);
  }

  function sortEvents(events) {
    return [...events].sort((left, right) => {
      const leftTime = left.time || '99:99';
      const rightTime = right.time || '99:99';
      return leftTime.localeCompare(rightTime, 'zh-CN')
        || String(left.event).localeCompare(String(right.event), 'zh-CN');
    });
  }

  function statusForEvent(event) {
    if (event.isOverdue) {
      const reference = event.isDeadline ? event.deadlineDate : event.sourceDate;
      const overdueDays = Math.max(
        1,
        Math.round((state.selectedDate - parseDateKey(reference)) / 86400000),
      );
      return { text: `逾期 ${overdueDays} 天`, className: 'overdue' };
    }
    if (event.isDeadline) {
      const remaining = Number(event.daysRemaining);
      if (remaining === 0) return { text: '今天截止', className: 'deadline' };
      if (remaining > 0) return { text: `还剩 ${remaining} 天`, className: 'deadline' };
    }
    if (event.isRecurring) {
      return { text: recurrenceLabel(event), className: '' };
    }
    return null;
  }

  function renderAll(options = {}) {
    if (options.reload !== false) loadEvents();
    renderTopbar();
    renderMiniCalendar();
    renderCompactWeek();
    renderSidebar();
    renderCurrentView();
    renderDetails();
    renderSearchResults($('#searchInput').value);
    refreshIcons();
  }

  function renderTopbar() {
    const selected = state.selectedDate;
    const isToday = sameDay(selected, realToday);
    const compact = window.innerWidth <= 720;
    const dateLabel = isToday
      ? compact
        ? `今天 ${selected.getMonth() + 1}/${selected.getDate()}`
        : `今天 · ${formatDate(selected, { month: 'long', day: 'numeric' })}`
      : compact
        ? `${selected.getMonth() + 1}/${selected.getDate()}`
        : `${formatDate(selected, { month: 'long', day: 'numeric' })} ${DAY_NAMES[selected.getDay()]}`;
    $('#dateTitleButton').textContent = dateLabel;
    $('#mainDateTitle').textContent = isToday
      ? `今天，${DAY_NAMES[selected.getDay()]}`
      : `${formatDate(selected, { month: 'long', day: 'numeric' })}，${DAY_NAMES[selected.getDay()]}`;

    const visible = getEventsForDate(dateKey(selected));
    const completed = visible.filter((event) => event.isCompleted).length;
    const open = visible.length - completed;
    const lunar = window.lunarAPI?.fromSolar(
      selected.getFullYear(),
      selected.getMonth() + 1,
      selected.getDate(),
    );
    const lunarText = lunar ? ` · 农历${lunar.monthStr}${lunar.dayStr}` : '';
    $('#daySummary').textContent = `${open} 项待完成 · ${completed} 项已完成${lunarText}`;

    $$('[data-view]').forEach((button) => {
      const active = button.dataset.view === state.currentView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#focusButton').classList.toggle('active', state.hideCompleted);
    $('#focusButton').setAttribute('aria-pressed', String(state.hideCompleted));
  }

  function renderMiniCalendar() {
    const cursor = state.calendarCursor;
    $('#miniCalendarTitle').textContent = formatDate(cursor, {
      year: 'numeric',
      month: 'long',
    });
    const first = monthStart(cursor);
    const gridStart = addDays(first, -first.getDay());
    const gridEnd = addDays(gridStart, 41);
    const counts = apiAvailable()
      ? window.eventAPI.getTaskCounts(dateKey(gridStart), dateKey(gridEnd))
      : {};
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const day = addDays(gridStart, index);
      const dayKey = dateKey(day);
      const classes = [
        'mini-day',
        day.getMonth() !== cursor.getMonth() ? 'outside' : '',
        sameDay(day, realToday) ? 'today' : '',
        sameDay(day, state.selectedDate) ? 'selected' : '',
        counts?.[dayKey]?.total ? 'has-events' : '',
      ].filter(Boolean).join(' ');
      cells.push(`
        <button
          class="${classes}"
          data-mini-date="${dayKey}"
          title="${formatDate(day, { year: 'numeric', month: 'long', day: 'numeric' })}"
        >${day.getDate()}</button>
      `);
    }
    $('#miniDays').innerHTML = cells.join('');
  }

  function renderCompactWeek() {
    const start = weekStart(state.selectedDate);
    $('#compactWeek').innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(start, index);
      const classes = [
        'compact-day',
        sameDay(day, realToday) ? 'today' : '',
        sameDay(day, state.selectedDate) ? 'selected' : '',
      ].filter(Boolean).join(' ');
      return `
        <button class="${classes}" data-compact-date="${dateKey(day)}">
          <span class="compact-day-name">${SHORT_DAY_NAMES[day.getDay()]}</span>
          <span class="compact-day-number">${day.getDate()}</span>
        </button>
      `;
    }).join('');
  }

  function renderSidebar() {
    const todayEvents = getEventsForDate(dateKey(realToday));
    $('#todayCount').textContent = todayEvents.filter((event) => !event.isCompleted).length;

    const rangeStart = dateKey(realToday);
    const rangeEnd = dateKey(addDays(realToday, 7));
    const range = getEventsBetween(rangeStart, rangeEnd);
    const upcomingIds = new Set();
    Object.values(range).flat().forEach((event) => {
      if (!event.isCompleted) upcomingIds.add(String(event.id));
    });
    $('#upcomingCount').textContent = upcomingIds.size;
    $('#allCount').textContent = state.events.length;
  }

  function renderCurrentView() {
    if (state.currentView === 'week') renderWeekView();
    else if (state.currentView === 'month') renderMonthView();
    else renderDayView();
  }

  function renderDayView() {
    const dayKey = dateKey(state.selectedDate);
    const visible = getEventsForDate(dayKey);
    const overdue = sortEvents(visible.filter((event) => event.isOverdue && !event.isCompleted));
    const active = sortEvents(visible.filter((event) => !event.isOverdue && !event.isCompleted));
    const allDay = active.filter((event) => !event.time);
    const timed = active.filter((event) => event.time);
    const completed = sortEvents(visible.filter((event) => event.isCompleted));
    const sections = [];

    if (overdue.length) sections.push(renderTaskSection('已逾期', overdue, 'danger', false));
    sections.push(renderTaskSection('全天', allDay, '', false));
    sections.push(renderTaskSection('时间安排', timed, '', false));
    if (!state.hideCompleted) {
      sections.push(renderTaskSection('已完成', completed, '', true));
    }
    $('#viewContent').innerHTML = `<div class="day-view">${sections.join('')}</div>`;
  }

  function renderTaskSection(title, events, tone, collapsible) {
    const collapsed = collapsible && state.completedCollapsed;
    const head = collapsible
      ? `
        <button class="section-head section-toggle ${collapsed ? 'collapsed' : ''}" data-toggle-completed>
          <span>${title}</span>
          <span class="section-count">${events.length}</span>
          ${icon('chevron-down')}
        </button>
      `
      : `
        <div class="section-head ${tone}">
          <span>${title}</span>
          <span class="section-count">${events.length}</span>
        </div>
      `;
    const body = events.length
      ? `<div class="task-list ${collapsed ? 'hidden' : ''}">${events.map(renderTaskRow).join('')}</div>`
      : `<div class="empty-section ${collapsed ? 'task-list hidden' : ''}">暂无${title}任务</div>`;
    return `<section class="task-section">${head}${body}</section>`;
  }

  function renderTaskRow(event) {
    const completed = Boolean(event.isCompleted);
    const selected = String(event.id) === String(state.selectedEventId);
    const status = statusForEvent(event);
    const metadata = [];
    if (event.targetDurationMinutes) {
      metadata.push(`
        <span class="meta-item meta-duration">
          ${icon('timer')} ${event.targetDurationMinutes} 分钟
        </span>
      `);
    }
    if (event.isDeadline) {
      metadata.push(`
        <span class="meta-item meta-deadline">
          ${icon('flag')} 截止 ${formatDate(parseDateKey(event.deadlineDate), {
            month: 'numeric',
            day: 'numeric',
          })}
        </span>
      `);
    }
    if (event.isRecurring) {
      metadata.push(`<span class="meta-item">${icon('repeat')} ${recurrenceLabel(event)}</span>`);
    }
    if (event.location) {
      metadata.push(`
        <span class="meta-item meta-location">
          ${icon('map-pin')} ${escapeHtml(event.location)}
        </span>
      `);
    }
    return `
      <article
        class="task-row ${completed ? 'completed' : ''} ${event.isOverdue ? 'overdue' : ''} ${selected ? 'selected' : ''}"
        data-event-id="${escapeHtml(event.id)}"
      >
        <button
          class="task-check ${completed ? 'checked' : ''}"
          data-task-toggle="${escapeHtml(event.id)}"
          aria-label="${completed ? '恢复' : '完成'}${escapeHtml(event.event)}"
        >${icon('check')}</button>
        <span class="task-time ${event.time ? '' : 'all-day'}">${event.time || '全天'}</span>
        <button class="task-body" data-task-select="${escapeHtml(event.id)}">
          <span class="task-title">${escapeHtml(event.event)}</span>
          ${metadata.length ? `<span class="task-meta">${metadata.join('')}</span>` : ''}
        </button>
        ${status && !completed
          ? `<span class="task-status ${status.className}">${status.text}</span>`
          : '<span class="task-status-spacer" aria-hidden="true"></span>'}
        <button
          class="task-menu-button"
          data-task-menu="${escapeHtml(event.id)}"
          title="更多操作"
          aria-label="${escapeHtml(event.event)}的更多操作"
        >${icon('more-horizontal')}</button>
      </article>
    `;
  }

  function renderWeekView() {
    const start = weekStart(state.selectedDate);
    const end = addDays(start, 6);
    const range = getEventsBetween(dateKey(start), dateKey(end));
    const columns = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(start, index);
      const dayKey = dateKey(day);
      const events = sortEvents(range[dayKey] || []);
      return `
        <section class="week-column ${sameDay(day, realToday) ? 'today' : ''} ${sameDay(day, state.selectedDate) ? 'selected' : ''}">
          <button class="week-column-head" data-week-date="${dayKey}">
            <span class="week-day-name">${DAY_NAMES[day.getDay()]}</span>
            <span class="week-day-number">${day.getDate()}</span>
          </button>
          <div class="week-events">
            ${events.map((event) => `
              <button
                class="week-event ${event.isDeadline ? 'deadline' : ''} ${event.isCompleted ? 'completed' : ''}"
                data-week-event="${escapeHtml(event.id)}"
                data-week-event-date="${dayKey}"
              >
                <time>${event.time || '全天'}</time>
                <span>${escapeHtml(event.event)}</span>
              </button>
            `).join('')}
          </div>
        </section>
      `;
    });
    $('#viewContent').innerHTML = `
      <div class="week-view">
        <div class="week-grid">${columns.join('')}</div>
      </div>
    `;
  }

  function renderMonthView() {
    const first = monthStart(state.selectedDate);
    const gridStart = addDays(first, -first.getDay());
    const gridEnd = addDays(gridStart, 41);
    const range = getEventsBetween(dateKey(gridStart), dateKey(gridEnd));
    const days = Array.from({ length: 42 }, (_, index) => {
      const day = addDays(gridStart, index);
      const dayKey = dateKey(day);
      const events = sortEvents(range[dayKey] || []);
      const lines = events.slice(0, 2).map((event) => `
        <div class="month-event-line ${event.isDeadline ? 'deadline' : ''}">
          ${escapeHtml(event.event)}
        </div>
      `).join('');
      return `
        <button
          class="month-day ${day.getMonth() !== first.getMonth() ? 'outside' : ''} ${sameDay(day, realToday) ? 'today' : ''} ${sameDay(day, state.selectedDate) ? 'selected' : ''}"
          data-month-date="${dayKey}"
        >
          <span class="month-day-number">${day.getDate()}</span>
          ${lines}
          ${events.length > 2 ? `<div class="month-more">另有 ${events.length - 2} 项</div>` : ''}
        </button>
      `;
    }).join('');
    $('#viewContent').innerHTML = `
      <div class="month-view">
        <div class="month-weekdays">
          <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
        </div>
        <div class="month-grid">${days}</div>
      </div>
    `;
  }

  function timerRecordFor(event) {
    if (!event?.targetDurationMinutes || !apiAvailable()) return null;
    return window.eventAPI.getTimerRecord(event.id, dateKey(state.selectedDate));
  }

  function elapsedSeconds(record) {
    if (!record) return 0;
    const base = Number(record.elapsedSeconds) || 0;
    if (!record.runningSince) return base;
    return base + Math.max(0, Math.floor((Date.now() - new Date(record.runningSince).getTime()) / 1000));
  }

  function formatElapsed(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function detailMarkup(event, mobile = false) {
    if (!event) {
      return '<div class="detail-empty">选择一项任务后，可在这里直接修改安排和任务规则。</div>';
    }
    const type = event.isDeadline ? 'deadline' : (event.isRecurring ? 'recurring' : 'normal');
    const baseDate = event.startDate || event.date || dateKey(state.selectedDate);
    const record = timerRecordFor(event);
    const running = Boolean(record?.runningSince);
    return `
      <form class="details-content" data-detail-form="${escapeHtml(event.id)}">
        <div class="detail-status-line">
          <button
            class="task-check ${isSourceCompletedHere(event) ? 'checked' : ''}"
            type="button"
            data-detail-toggle="${escapeHtml(event.id)}"
            aria-label="${isSourceCompletedHere(event) ? '恢复任务' : '完成任务'}"
          >${icon('check')}</button>
          <div>
            <input
              class="detail-title-input"
              name="event"
              value="${escapeHtml(event.event)}"
              aria-label="任务标题"
            >
            <div class="detail-type">${eventTypeLabel(event)} · ${escapeHtml(event.calendar || '个人')}</div>
          </div>
        </div>

        <section class="detail-group">
          <p class="detail-group-title">安排</p>
          <label class="detail-field">
            ${icon('calendar')}
            <span>日期</span>
            <input class="detail-input" name="date" type="date" value="${baseDate}">
          </label>
          <label class="detail-field">
            ${icon('clock')}
            <span>时间</span>
            <input class="detail-input" name="time" type="time" value="${event.time || ''}">
          </label>
          <label class="detail-field">
            ${icon('timer')}
            <span>目标时长</span>
            <input
              class="detail-input"
              name="targetDurationMinutes"
              type="number"
              min="0"
              step="5"
              value="${event.targetDurationMinutes || 0}"
            >
          </label>
          <label class="detail-field">
            ${icon('map-pin')}
            <span>地点</span>
            <input
              class="detail-input"
              name="location"
              type="text"
              value="${escapeHtml(event.location || '')}"
              placeholder="添加地点"
            >
          </label>
          <label class="detail-field">
            ${icon('layers')}
            <span>日历</span>
            <select class="detail-select" name="calendar">
              <option value="个人" ${event.calendar !== '工作' ? 'selected' : ''}>个人</option>
              <option value="工作" ${event.calendar === '工作' ? 'selected' : ''}>工作</option>
            </select>
          </label>
        </section>

        <section class="detail-group">
          <p class="detail-group-title">规则</p>
          <label class="detail-field">
            ${icon('shapes')}
            <span>类型</span>
            <select class="detail-select" name="type" data-detail-type>
              <option value="normal" ${type === 'normal' ? 'selected' : ''}>普通任务</option>
              <option value="recurring" ${type === 'recurring' ? 'selected' : ''}>重复任务</option>
              <option value="deadline" ${type === 'deadline' ? 'selected' : ''}>Deadline</option>
            </select>
          </label>
          <label class="detail-field" data-recurring-field ${type === 'recurring' ? '' : 'hidden'}>
            ${icon('repeat')}
            <span>重复</span>
            <select class="detail-select" name="recurringType">
              <option value="daily" ${event.recurringType === 'daily' ? 'selected' : ''}>每天</option>
              <option value="weekly" ${event.recurringType === 'weekly' ? 'selected' : ''}>每周</option>
              <option value="monthly" ${event.recurringType === 'monthly' ? 'selected' : ''}>每月</option>
            </select>
          </label>
          <label class="detail-field" data-recurring-field ${type === 'recurring' ? '' : 'hidden'}>
            ${icon('calendar-range')}
            <span>结束</span>
            <input
              class="detail-input"
              name="endDate"
              type="date"
              value="${event.endDate || dateKey(addDays(parseDateKey(baseDate), 30))}"
            >
          </label>
          <label class="detail-field" data-deadline-field ${type === 'deadline' ? '' : 'hidden'}>
            ${icon('flag')}
            <span>截止</span>
            <input
              class="detail-input"
              name="deadlineDate"
              type="date"
              value="${event.deadlineDate || baseDate}"
            >
          </label>
        </section>

        ${record ? `
          <section class="detail-group">
            <p class="detail-group-title">专注计时</p>
            <div class="detail-field">
              ${icon(running ? 'pause' : 'play')}
              <span>今日</span>
              <button
                class="secondary-button"
                type="button"
                data-timer-toggle="${escapeHtml(event.id)}"
              >
                <span
                  class="timer-readout"
                  data-base-seconds="${Number(record.elapsedSeconds) || 0}"
                  data-running-since="${record.runningSince || ''}"
                >${formatElapsed(elapsedSeconds(record))}</span>
                <span>${running ? '暂停' : '开始'}</span>
              </button>
            </div>
          </section>
        ` : ''}

        <section class="detail-group">
          <p class="detail-group-title">备注</p>
          <textarea class="detail-note" name="note" placeholder="添加备注">${escapeHtml(event.note || '')}</textarea>
        </section>

        <footer class="detail-footer">
          ${mobile ? `
            <button class="text-btn detail-delete" type="button" data-detail-delete="${escapeHtml(event.id)}">
              删除
            </button>
          ` : ''}
          <button class="primary-button" type="submit">保存修改</button>
        </footer>
      </form>
    `;
  }

  function isSourceCompletedHere(event) {
    const selectedKey = dateKey(state.selectedDate);
    if (event.isDeadline) {
      return Boolean(event.isDeadlineCompleted && event.deadlineCompletedDate === selectedKey);
    }
    if (event.isRecurring) {
      return (event.completedDates || []).includes(selectedKey);
    }
    return Boolean(event.isCompleted);
  }

  function renderDetails() {
    const event = getSourceEvent(state.selectedEventId);
    $('#detailsContent').innerHTML = detailMarkup(event, false);
    $('#mobileDetailsContent').innerHTML = detailMarkup(event, true);
    $('#duplicateDetail').disabled = !event;
    $('#deleteDetail').disabled = !event;
  }

  function selectDate(value, options = {}) {
    state.selectedDate = typeof value === 'string' ? parseDateKey(value) : startOfDay(value);
    state.calendarCursor = monthStart(state.selectedDate);
    if (options.view) state.currentView = options.view;
    setActiveNav(sameDay(state.selectedDate, realToday) ? 'today' : '');
    renderAll();
  }

  function shiftDate(amount) {
    if (state.currentView === 'week') {
      state.selectedDate = addDays(state.selectedDate, amount * 7);
    } else if (state.currentView === 'month') {
      state.selectedDate = new Date(
        state.selectedDate.getFullYear(),
        state.selectedDate.getMonth() + amount,
        1,
      );
    } else {
      state.selectedDate = addDays(state.selectedDate, amount);
    }
    state.calendarCursor = monthStart(state.selectedDate);
    setActiveNav(sameDay(state.selectedDate, realToday) ? 'today' : '');
    renderAll();
  }

  function setView(view) {
    if (!['day', 'week', 'month'].includes(view)) return;
    state.currentView = view;
    renderAll({ reload: false });
  }

  function usesDetailSheet() {
    return window.innerWidth <= 980;
  }

  function selectTask(id, shouldOpen = true) {
    state.selectedEventId = id;
    renderCurrentView();
    renderDetails();
    refreshIcons();
    if (shouldOpen && usesDetailSheet()) openMobileDetails();
  }

  function toggleTask(id) {
    if (!apiAvailable()) return;
    const before = getSourceEvent(id);
    if (!before) return;
    const toggledDate = dateKey(state.selectedDate);
    const result = window.eventAPI.toggleComplete(id, toggledDate);
    if (!result) {
      showToast('更新任务失败');
      return;
    }
    state.lastUndo = () => {
      window.eventAPI.toggleComplete(id, toggledDate);
      renderAll();
    };
    renderAll();
    showToast(result.isCompleted ? '任务已完成' : '任务已恢复', true);
  }

  function duplicateTask(id) {
    const source = getSourceEvent(id);
    if (!source || !apiAvailable()) return;
    const copy = {
      ...source,
      id: undefined,
      event: `${source.event}（副本）`,
      isCompleted: false,
      isDeadlineCompleted: false,
      deadlineCompletedDate: undefined,
      completedDate: undefined,
      completedAt: undefined,
      completedDates: [],
      timerRecords: {},
    };
    const created = window.eventAPI.addEvent(copy);
    if (!created) return;
    state.selectedEventId = created.id;
    state.lastUndo = () => {
      window.eventAPI.deleteEvent(created.id);
      state.selectedEventId = source.id;
      renderAll();
    };
    renderAll();
    showToast('已复制任务', true);
  }

  function deleteTask(id) {
    if (!apiAvailable()) return;
    const removed = window.eventAPI.deleteEvent(id);
    if (!removed) return;
    state.selectedEventId = null;
    state.lastUndo = () => {
      const restored = window.eventAPI.addEvent(removed);
      state.selectedEventId = restored?.id ?? removed.id;
      renderAll();
    };
    closeTaskMenu();
    closeMobileDetails();
    renderAll();
    showToast(`已删除“${removed.event}”`, true);
  }

  function formUpdates(form, source) {
    const values = Object.fromEntries(new FormData(form).entries());
    const type = values.type;
    const date = values.date || dateKey(state.selectedDate);
    const updates = {
      event: values.event.trim() || '未命名任务',
      time: values.time || '',
      location: values.location.trim(),
      note: values.note,
      calendar: values.calendar,
      targetDurationMinutes: Number(values.targetDurationMinutes) || 0,
    };

    if (type === 'deadline') {
      Object.assign(updates, {
        isDeadline: true,
        isRecurring: false,
        date,
        startDate: date,
        deadlineDate: values.deadlineDate || date,
        isDeadlineCompleted: source.isDeadlineCompleted || false,
      });
    } else if (type === 'recurring') {
      Object.assign(updates, {
        isDeadline: false,
        isRecurring: true,
        date,
        startDate: date,
        endDate: values.endDate || dateKey(addDays(parseDateKey(date), 30)),
        recurringType: values.recurringType || 'daily',
        recurringDays: source.recurringDays || [],
        completedDates: source.completedDates || [],
      });
    } else {
      Object.assign(updates, {
        isDeadline: false,
        isRecurring: false,
        date,
        isCompleted: source.isCompleted || false,
      });
    }
    return updates;
  }

  function saveDetailForm(form) {
    const id = form.dataset.detailForm;
    const source = getSourceEvent(id);
    if (!source || !apiAvailable()) return;
    const updated = window.eventAPI.updateEvent(id, formUpdates(form, source));
    if (!updated) {
      showToast('保存修改失败');
      return;
    }
    state.selectedEventId = updated.id;
    renderAll();
    showToast('修改已保存');
  }

  function toggleTimer(id) {
    if (!apiAvailable()) return;
    const date = dateKey(state.selectedDate);
    const record = window.eventAPI.getTimerRecord(id, date);
    if (record?.runningSince) window.eventAPI.stopTimer(id, date);
    else window.eventAPI.startTimer(id, date);
    renderDetails();
    refreshIcons();
  }

  function updateTimerReadouts() {
    $$('.timer-readout').forEach((element) => {
      const base = Number(element.dataset.baseSeconds) || 0;
      const runningSince = element.dataset.runningSince;
      const seconds = runningSince
        ? base + Math.max(0, Math.floor((Date.now() - new Date(runningSince).getTime()) / 1000))
        : base;
      element.textContent = formatElapsed(seconds);
    });
  }

  function renderParsePreview() {
    const input = $('#quickInput');
    const container = $('#parsePreview');
    const text = input.value.trim();
    if (!text) {
      container.innerHTML = '<span>支持日期、时间、时长、重复与截止日期</span>';
      return;
    }
    const parsed = window.commandAPI?.preview(text, dateKey(state.selectedDate));
    if (!parsed) {
      container.innerHTML = '<span>等待解析</span>';
      return;
    }
    if (parsed.requiresAgent || parsed.intent === 'agent') {
      container.innerHTML = `<span class="parse-chip">${icon('sparkles')} 交给日程助手</span>`;
      refreshIcons();
      return;
    }
    if (parsed.intent === 'query') {
      container.innerHTML = `
        <span class="parse-chip">${icon('search')} 查询</span>
        <span class="parse-chip">${icon('calendar')} ${parsed.date}</span>
      `;
      refreshIcons();
      return;
    }
    const chips = [];
    if (parsed.tokens?.date) {
      chips.push(`<span class="parse-chip">${icon('calendar')} ${parsed.tokens.date}</span>`);
    }
    if (parsed.tokens?.time) {
      chips.push(`<span class="parse-chip">${icon('clock')} ${parsed.tokens.time}</span>`);
    }
    if (parsed.tokens?.duration) {
      chips.push(`<span class="parse-chip">${icon('timer')} ${parsed.tokens.duration} 分钟</span>`);
    }
    if (parsed.tokens?.deadline) {
      chips.push(`<span class="parse-chip">${icon('flag')} Deadline</span>`);
    }
    if (parsed.tokens?.recurring) {
      chips.push(`<span class="parse-chip">${icon('repeat')} 重复</span>`);
    }
    container.innerHTML = chips.join('') || '<span>将创建普通任务</span>';
    refreshIcons();
  }

  async function submitQuickCommand() {
    const input = $('#quickInput');
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const result = window.commandAPI?.execute(text, dateKey(state.selectedDate));
    input.value = '';
    renderParsePreview();

    if (!result || !result.handled) {
      openAssistant();
      await sendAssistantMessage(text);
      return;
    }
    if (result.route === 'local-query') {
      openAssistant();
      appendAssistantMessage('user', text);
      const detail = result.events?.length
        ? `\n${result.events.map((event) => `• ${event.time || '全天'} ${event.event}`).join('\n')}`
        : '';
      appendAssistantMessage('assistant', `${result.message}${detail}`);
      return;
    }
    if (!result.success || !result.event) {
      showToast(result.message || '添加日程失败');
      return;
    }

    const event = result.event;
    state.selectedEventId = event.id;
    state.selectedDate = event.isDeadline
      ? realToday
      : parseDateKey(event.startDate || event.date);
    state.calendarCursor = monthStart(state.selectedDate);
    state.currentView = 'day';
    state.lastUndo = () => {
      window.eventAPI.deleteEvent(event.id);
      state.selectedEventId = null;
      renderAll();
    };
    renderAll();
    showToast(result.message, true);
  }

  function showToast(message, allowUndo = false) {
    clearTimeout(state.toastTimer);
    $('#toastMessage').textContent = message;
    $('#toastUndo').style.display = allowUndo && state.lastUndo ? '' : 'none';
    $('#toast').classList.add('show');
    state.toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4200);
  }

  function openTaskMenu(button, id) {
    state.menuTargetId = id;
    const menu = $('#taskMenu');
    const rect = button.getBoundingClientRect();
    const width = 150;
    const estimatedHeight = 122;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
    const top = rect.bottom + estimatedHeight > window.innerHeight
      ? rect.top - estimatedHeight
      : rect.bottom + 4;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
  }

  function closeTaskMenu() {
    $('#taskMenu').classList.remove('open');
    $('#taskMenu').setAttribute('aria-hidden', 'true');
    state.menuTargetId = null;
  }

  function openOverlay(id) {
    const overlay = $(`#${id}`);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    if (id === 'searchOverlay') {
      renderSearchResults('');
      setTimeout(() => $('#searchInput').focus(), 0);
    }
    if (id === 'assistantOverlay') {
      checkAgentStatus();
      setTimeout(() => $('#assistantInput').focus(), 0);
    }
  }

  function closeOverlay(id) {
    const overlay = $(`#${id}`);
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function openMobileDetails() {
    $('#mobileDetailSheet').classList.add('open');
    $('#mobileDetailSheet').setAttribute('aria-hidden', 'false');
  }

  function closeMobileDetails() {
    $('#mobileDetailSheet').classList.remove('open');
    $('#mobileDetailSheet').setAttribute('aria-hidden', 'true');
  }

  function openAssistant() {
    openOverlay('assistantOverlay');
  }

  function appendAssistantMessage(role, text, options = {}) {
    const message = document.createElement('div');
    message.className = `assistant-message ${role === 'user' ? 'user' : ''} ${options.pending ? 'pending' : ''}`;
    message.textContent = text;
    if (options.id) message.id = options.id;
    $('#assistantBody').appendChild(message);
    $('#assistantBody').scrollTop = $('#assistantBody').scrollHeight;
  }

  async function sendAssistantMessage(override = '') {
    if (state.assistantBusy) return;
    const input = $('#assistantInput');
    const message = String(override || input.value).trim();
    if (!message) return;
    input.value = '';
    appendAssistantMessage('user', message);
    const pendingId = `assistant-pending-${Date.now()}`;
    appendAssistantMessage('assistant', '正在规划…', { pending: true, id: pendingId });
    state.assistantBusy = true;
    input.disabled = true;
    $('#assistantSend').disabled = true;

    const result = await window.aiAPI?.chat(message, 'main');
    $(`#${pendingId}`)?.remove();
    appendAssistantMessage('assistant', result?.message || '没有收到有效回复。');
    if (result?.events_changed) renderAll();

    state.assistantBusy = false;
    input.disabled = false;
    $('#assistantSend').disabled = false;
    input.focus();
  }

  async function checkAgentStatus() {
    const result = await window.aiAPI?.status();
    const status = result?.status || 'unavailable';
    const configured = Boolean(result?.configured);
    const label = $('#assistantStatus');
    const dot = $('#serviceDot');
    label.className = `status-label ${status === 'ready' && configured ? 'ready' : 'unavailable'}`;
    dot.className = `service-dot ${status === 'ready' && configured ? 'ready' : 'unavailable'}`;
    if (status !== 'ready') label.textContent = '服务不可用';
    else if (!configured) label.textContent = '尚未配置';
    else label.textContent = `${result.provider || 'AI'} 已就绪`;
  }

  function renderSearchResults(query = '') {
    const normalized = query.trim().toLowerCase();
    const results = state.events.filter((event) => {
      if (!normalized) return true;
      return [event.event, event.location, eventTypeLabel(event)]
        .some((value) => String(value || '').toLowerCase().includes(normalized));
    });
    $('#searchResults').innerHTML = results.length
      ? results.map((event) => {
        const navigationDate = eventNavigationDate(event);
        return `
          <button class="search-result" data-search-event="${escapeHtml(event.id)}">
            ${icon(event.isDeadline ? 'flag' : (event.isRecurring ? 'repeat' : 'calendar'))}
            <span>
              <span class="search-result-title">${escapeHtml(event.event)}</span>
              <span class="search-result-meta">
                ${formatDate(navigationDate, { month: 'long', day: 'numeric' })}
                ${event.time ? ` · ${event.time}` : ''}
              </span>
            </span>
            <span class="search-result-type">${eventTypeLabel(event)}</span>
          </button>
        `;
      }).join('')
      : '<div class="detail-empty">没有找到匹配的日程</div>';
    refreshIcons();
  }

  function setTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.body.dataset.theme = next;
    localStorage.setItem('hoyo-theme', next);
    $('#themeIcon').outerHTML = `<i data-lucide="${next === 'dark' ? 'sun' : 'moon'}" id="themeIcon"></i>`;
    $('#themeSelect').value = next;
    refreshIcons();
  }

  function providerDefaults(provider) {
    const defaults = {
      doubao: {
        apiKey: '',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        model: '',
      },
      ollama: {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2',
      },
      openai: {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: '',
      },
    };
    return defaults[provider];
  }

  function providerConfig(provider) {
    return {
      ...providerDefaults(provider),
      ...(state.settingsConfig.ai?.[provider] || {}),
    };
  }

  function captureProviderFields() {
    const provider = state.editingProvider;
    const baseUrl = $('#providerBaseUrl');
    const model = $('#providerModel');
    if (!baseUrl || !model) return;
    state.settingsConfig.ai ||= {};
    state.settingsConfig.ai[provider] = {
      ...providerConfig(provider),
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      apiKey: $('#providerApiKey')?.value || '',
    };
  }

  function renderProviderFields(provider) {
    state.editingProvider = provider;
    const config = providerConfig(provider);
    const apiKeyField = provider === 'ollama'
      ? ''
      : `
        <label class="settings-field">
          <span>API Key</span>
          <input id="providerApiKey" type="password" value="${escapeHtml(config.apiKey || '')}" autocomplete="off">
        </label>
      `;
    $('#providerFields').innerHTML = `
      ${apiKeyField}
      <label class="settings-field">
        <span>Base URL</span>
        <input id="providerBaseUrl" type="text" value="${escapeHtml(config.baseUrl || '')}">
      </label>
      <label class="settings-field">
        <span>模型</span>
        <input id="providerModel" type="text" value="${escapeHtml(config.model || '')}" placeholder="输入模型名称">
      </label>
    `;
  }

  async function openSettings() {
    state.settingsConfig = await window.configAPI?.load() || {};
    const provider = state.settingsConfig.ai?.provider || 'doubao';
    $('#aiProvider').value = provider;
    renderProviderFields(provider);
    $('#themeSelect').value = document.body.dataset.theme;
    state.windowState = await window.electronAPI?.getWindowState() || state.windowState;
    $('#windowModeSelect').value = state.windowState.mode || 'wide';
    $('#autoLaunchToggle').checked = Boolean(await window.electronAPI?.getAutoLaunch());
    const version = await window.electronAPI?.getAppVersion();
    $('#appVersion').textContent = `V${version || '3.0.0'}`;
    openOverlay('settingsOverlay');
  }

  async function saveSettings() {
    captureProviderFields();
    const provider = $('#aiProvider').value;
    state.settingsConfig.ai ||= {};
    state.settingsConfig.ai.provider = provider;
    const result = await window.configAPI?.save(state.settingsConfig);
    await window.electronAPI?.setAutoLaunch($('#autoLaunchToggle').checked);
    setTheme($('#themeSelect').value);
    window.electronAPI?.setWindowMode($('#windowModeSelect').value);
    closeOverlay('settingsOverlay');
    await checkAgentStatus();
    showToast(result?.success ? '设置已保存' : '部分设置未能保存');
  }

  function setActiveNav(name) {
    $$('[data-nav]').forEach((button) => {
      button.classList.toggle('active', button.dataset.nav === name);
    });
  }

  function handleNav(name) {
    setActiveNav(name);
    if (name === 'today') {
      state.selectedDate = realToday;
      state.currentView = 'day';
    } else if (name === 'upcoming') {
      state.selectedDate = realToday;
      state.currentView = 'week';
    } else if (name === 'all') {
      state.selectedDate = realToday;
      state.currentView = 'month';
    }
    state.calendarCursor = monthStart(state.selectedDate);
    renderAll();
  }

  function handleViewContentClick(event) {
    const toggle = event.target.closest('[data-task-toggle]');
    if (toggle) {
      toggleTask(toggle.dataset.taskToggle);
      return;
    }
    const select = event.target.closest('[data-task-select]');
    if (select) {
      selectTask(select.dataset.taskSelect);
      return;
    }
    const menu = event.target.closest('[data-task-menu]');
    if (menu) {
      openTaskMenu(menu, menu.dataset.taskMenu);
      return;
    }
    const completedToggle = event.target.closest('[data-toggle-completed]');
    if (completedToggle) {
      state.completedCollapsed = !state.completedCollapsed;
      renderDayView();
      refreshIcons();
      return;
    }
    const weekDate = event.target.closest('[data-week-date]');
    if (weekDate) {
      selectDate(weekDate.dataset.weekDate, { view: 'day' });
      return;
    }
    const weekEvent = event.target.closest('[data-week-event]');
    if (weekEvent) {
      state.selectedDate = parseDateKey(weekEvent.dataset.weekEventDate);
      state.currentView = 'day';
      selectTask(weekEvent.dataset.weekEvent);
      renderAll();
      return;
    }
    const monthDate = event.target.closest('[data-month-date]');
    if (monthDate) {
      selectDate(monthDate.dataset.monthDate, { view: 'day' });
    }
  }

  function handleDetailClick(event) {
    const toggle = event.target.closest('[data-detail-toggle]');
    if (toggle) {
      toggleTask(toggle.dataset.detailToggle);
      return;
    }
    const timer = event.target.closest('[data-timer-toggle]');
    if (timer) {
      toggleTimer(timer.dataset.timerToggle);
      return;
    }
    const remove = event.target.closest('[data-detail-delete]');
    if (remove) deleteTask(remove.dataset.detailDelete);
  }

  function handleDetailChange(event) {
    const typeSelect = event.target.closest('[data-detail-type]');
    if (!typeSelect) return;
    const form = typeSelect.closest('[data-detail-form]');
    $$('[data-recurring-field]', form).forEach((field) => {
      field.hidden = typeSelect.value !== 'recurring';
    });
    $$('[data-deadline-field]', form).forEach((field) => {
      field.hidden = typeSelect.value !== 'deadline';
    });
  }

  function bindEvents() {
    $('#previousDate').addEventListener('click', () => shiftDate(-1));
    $('#nextDate').addEventListener('click', () => shiftDate(1));
    $('#todayButton').addEventListener('click', () => selectDate(realToday, { view: 'day' }));
    $('#dateTitleButton').addEventListener('click', () => {
      if (window.innerWidth <= 720) setView('month');
      else $('#miniDays .selected')?.focus();
    });
    $('#previousMonth').addEventListener('click', () => {
      state.calendarCursor = new Date(
        state.calendarCursor.getFullYear(),
        state.calendarCursor.getMonth() - 1,
        1,
      );
      renderMiniCalendar();
    });
    $('#nextMonth').addEventListener('click', () => {
      state.calendarCursor = new Date(
        state.calendarCursor.getFullYear(),
        state.calendarCursor.getMonth() + 1,
        1,
      );
      renderMiniCalendar();
    });

    $('#viewSwitch').addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (button) setView(button.dataset.view);
    });
    $('.mobile-view-switch').addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (button) setView(button.dataset.view);
    });
    $('#miniDays').addEventListener('click', (event) => {
      const button = event.target.closest('[data-mini-date]');
      if (button) selectDate(button.dataset.miniDate, { view: 'day' });
    });
    $('#compactWeek').addEventListener('click', (event) => {
      const button = event.target.closest('[data-compact-date]');
      if (button) selectDate(button.dataset.compactDate, { view: 'day' });
    });
    $('#viewContent').addEventListener('click', handleViewContentClick);

    $('#focusButton').addEventListener('click', () => {
      state.hideCompleted = !state.hideCompleted;
      renderAll({ reload: false });
    });
    $('#quickInput').addEventListener('input', renderParsePreview);
    $('#quickInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitQuickCommand();
    });
    $('#quickSubmit').addEventListener('click', submitQuickCommand);
    $('#composerAssistant').addEventListener('click', openAssistant);

    $('#searchButton').addEventListener('click', () => openOverlay('searchOverlay'));
    $('#searchInput').addEventListener('input', (event) => renderSearchResults(event.target.value));
    $('#searchResults').addEventListener('click', (event) => {
      const result = event.target.closest('[data-search-event]');
      if (!result) return;
      const item = getSourceEvent(result.dataset.searchEvent);
      if (!item) return;
      state.selectedDate = eventNavigationDate(item);
      state.calendarCursor = monthStart(state.selectedDate);
      state.currentView = 'day';
      state.selectedEventId = item.id;
      closeOverlay('searchOverlay');
      renderAll();
      if (usesDetailSheet()) openMobileDetails();
    });

    $('#assistantButton').addEventListener('click', openAssistant);
    $('#sidebarAssistant').addEventListener('click', openAssistant);
    $('#assistantSend').addEventListener('click', () => sendAssistantMessage());
    $('#assistantInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendAssistantMessage();
    });
    $('.assistant-suggestions').addEventListener('click', (event) => {
      const button = event.target.closest('.suggestion-button');
      if (button) sendAssistantMessage(button.textContent);
    });
    $('#resetAssistant').addEventListener('click', async () => {
      await window.aiAPI?.resetChat('main');
      $('#assistantBody').innerHTML = '<div class="assistant-message">对话已清空。</div>';
    });

    $('#settingsButton').addEventListener('click', openSettings);
    $('#aiProvider').addEventListener('change', (event) => {
      captureProviderFields();
      renderProviderFields(event.target.value);
    });
    $('#saveSettings').addEventListener('click', saveSettings);
    $('#openLogsButton').addEventListener('click', () => window.electronAPI?.openLogsFolder());
    $('#themeButton').addEventListener('click', () => {
      setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
    });

    $$('[data-close-overlay]').forEach((button) => {
      button.addEventListener('click', () => closeOverlay(button.dataset.closeOverlay));
    });
    $$('.overlay').forEach((overlay) => {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeOverlay(overlay.id);
      });
    });

    $('#taskMenu').addEventListener('click', (event) => {
      const button = event.target.closest('[data-menu-action]');
      if (!button || state.menuTargetId === null) return;
      const id = state.menuTargetId;
      const action = button.dataset.menuAction;
      closeTaskMenu();
      if (action === 'edit') selectTask(id);
      if (action === 'duplicate') duplicateTask(id);
      if (action === 'delete') deleteTask(id);
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#taskMenu') && !event.target.closest('[data-task-menu]')) {
        closeTaskMenu();
      }
    });

    $('#detailsContent').addEventListener('click', handleDetailClick);
    $('#mobileDetailsContent').addEventListener('click', handleDetailClick);
    $('#detailsContent').addEventListener('change', handleDetailChange);
    $('#mobileDetailsContent').addEventListener('change', handleDetailChange);
    $('#detailsContent').addEventListener('submit', (event) => {
      event.preventDefault();
      saveDetailForm(event.target);
    });
    $('#mobileDetailsContent').addEventListener('submit', (event) => {
      event.preventDefault();
      saveDetailForm(event.target);
      closeMobileDetails();
    });
    $('#duplicateDetail').addEventListener('click', () => {
      if (state.selectedEventId !== null) duplicateTask(state.selectedEventId);
    });
    $('#deleteDetail').addEventListener('click', () => {
      if (state.selectedEventId !== null) deleteTask(state.selectedEventId);
    });
    $('#closeMobileDetail').addEventListener('click', closeMobileDetails);
    $('#mobileDetailSheet').addEventListener('click', (event) => {
      if (event.target === $('#mobileDetailSheet')) closeMobileDetails();
    });

    $$('[data-nav]').forEach((button) => {
      button.addEventListener('click', () => handleNav(button.dataset.nav));
    });
    $$('.calendar-source').forEach((button) => {
      button.addEventListener('click', () => {
        const calendar = button.dataset.calendar;
        if (state.activeCalendars.has(calendar)) state.activeCalendars.delete(calendar);
        else state.activeCalendars.add(calendar);
        button.classList.toggle('active', state.activeCalendars.has(calendar));
        renderAll({ reload: false });
      });
    });

    $('#toastUndo').addEventListener('click', () => {
      if (!state.lastUndo) return;
      const undo = state.lastUndo;
      state.lastUndo = null;
      undo();
      $('#toast').classList.remove('show');
    });

    $('#minimizeButton').addEventListener('click', () => window.electronAPI?.minimizeWindow());
    $('#maximizeButton').addEventListener('click', () => window.electronAPI?.maximizeWindow());
    $('#closeButton').addEventListener('click', () => window.electronAPI?.closeWindow());
    $('#pinButton').addEventListener('click', () => window.electronAPI?.togglePin());
    window.electronAPI?.onWindowStateChanged((nextState) => {
      state.windowState = nextState;
      $('#pinButton').classList.toggle('active', nextState.isPinned);
      $('#pinButton').setAttribute('aria-pressed', String(nextState.isPinned));
      $('#maximizeButton').title = nextState.isMaximized ? '还原' : '最大化';
    });
    window.electronAPI?.onBackendReady(() => checkAgentStatus());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeTaskMenu();
        closeOverlay('searchOverlay');
        closeOverlay('assistantOverlay');
        closeOverlay('settingsOverlay');
        closeMobileDetails();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openOverlay('searchOverlay');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        $('#quickInput').focus();
      }
      if ((event.ctrlKey || event.metaKey) && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        setView({ 1: 'day', 2: 'week', 3: 'month' }[event.key]);
      }
    });

    window.addEventListener('resize', () => {
      closeTaskMenu();
      renderTopbar();
      renderCompactWeek();
      if (!usesDetailSheet()) closeMobileDetails();
      refreshIcons();
    });
  }

  async function initialize() {
    const savedTheme = localStorage.getItem('hoyo-theme');
    document.body.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';
    bindEvents();
    loadEvents();
    renderAll({ reload: false });
    renderParsePreview();
    state.windowState = await window.electronAPI?.getWindowState() || state.windowState;
    $('#pinButton').classList.toggle('active', state.windowState.isPinned);
    $('#pinButton').setAttribute('aria-pressed', String(state.windowState.isPinned));
    await checkAgentStatus();
    setInterval(updateTimerReadouts, 1000);
  }

  initialize();
})();
