/**
 * HoyoCalendar - 渲染进程主脚本
 * 处理 UI 交互、视图切换、日期逻辑
 */

// 引入 lunar-javascript（通过预加载脚本或直接加载）
// 注意：在 Electron 中需要通过 preload 或 require 加载

// ==================== 农历工具类 ====================
const LunarHelper = {
  // 中国法定节假日配置（2026年示例，实际应从配置文件读取）
  holidays2026: {
    // 春节: 1月29日-2月4日
    '2026-01-29': { name: '除夕', type: 'rest' },
    '2026-01-30': { name: '春节', type: 'rest' },
    '2026-01-31': { name: '春节', type: 'rest' },
    '2026-02-01': { name: '春节', type: 'rest' },
    '2026-02-02': { name: '春节', type: 'rest' },
    '2026-02-03': { name: '春节', type: 'rest' },
    '2026-02-04': { name: '春节', type: 'rest' },
    '2026-01-25': { name: '春节调休', type: 'work' },
    '2026-02-08': { name: '春节调休', type: 'work' },
    // 清明节
    '2026-04-05': { name: '清明', type: 'rest' },
    '2026-04-06': { name: '清明', type: 'rest' },
    '2026-04-07': { name: '清明', type: 'rest' },
    // 劳动节
    '2026-05-01': { name: '劳动节', type: 'rest' },
    '2026-05-02': { name: '劳动节', type: 'rest' },
    '2026-05-03': { name: '劳动节', type: 'rest' },
    '2026-05-04': { name: '劳动节', type: 'rest' },
    '2026-05-05': { name: '劳动节', type: 'rest' },
    // 端午节
    '2026-05-31': { name: '端午', type: 'rest' },
    '2026-06-01': { name: '端午', type: 'rest' },
    '2026-06-02': { name: '端午', type: 'rest' },
    // 中秋节
    '2026-09-25': { name: '中秋', type: 'rest' },
    '2026-09-26': { name: '中秋', type: 'rest' },
    '2026-09-27': { name: '中秋', type: 'rest' },
    // 国庆节
    '2026-10-01': { name: '国庆', type: 'rest' },
    '2026-10-02': { name: '国庆', type: 'rest' },
    '2026-10-03': { name: '国庆', type: 'rest' },
    '2026-10-04': { name: '国庆', type: 'rest' },
    '2026-10-05': { name: '国庆', type: 'rest' },
    '2026-10-06': { name: '国庆', type: 'rest' },
    '2026-10-07': { name: '国庆', type: 'rest' },
    '2026-10-10': { name: '国庆调休', type: 'work' },
  },

  // 农历月份名称
  lunarMonths: ['正月', '二月', '三月', '四月', '五月', '六月', 
                '七月', '八月', '九月', '十月', '冬月', '腊月'],
  
  // 农历日期名称
  lunarDays: ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
              '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
              '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'],

  // 天干
  tianGan: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
  
  // 地支
  diZhi: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
  
  // 生肖
  shengXiao: ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'],

  // 农历节日
  lunarFestivals: {
    '1-1': '春节',
    '1-15': '元宵',
    '5-5': '端午',
    '7-7': '七夕',
    '7-15': '中元',
    '8-15': '中秋',
    '9-9': '重阳',
    '12-8': '腊八',
    '12-23': '小年',
    '12-30': '除夕',
  },

  // 公历节日
  solarFestivals: {
    '1-1': '元旦',
    '2-14': '情人节',
    '3-8': '妇女节',
    '3-12': '植树节',
    '4-1': '愚人节',
    '5-1': '劳动节',
    '5-4': '青年节',
    '6-1': '儿童节',
    '7-1': '建党节',
    '8-1': '建军节',
    '9-10': '教师节',
    '10-1': '国庆节',
    '12-25': '圣诞节',
  },

  // 简化的农历计算（基于查表法的近似实现）
  // 实际项目中应使用 lunar-javascript 库
  getLunarDate(solarDate) {
    const year = solarDate.getFullYear();
    const month = solarDate.getMonth() + 1;
    const day = solarDate.getDate();
    
    // 优先使用 lunar-javascript 库（通过 preload 暴露）
    if (window.lunarAPI && window.lunarAPI.isAvailable()) {
      const lunar = window.lunarAPI.fromSolar(year, month, day);
      if (lunar) {
        return {
          year: lunar.year,
          month: Math.abs(lunar.month),
          day: lunar.day,
          monthStr: lunar.monthStr,
          dayStr: lunar.dayStr,
          isLeapMonth: lunar.isLeapMonth,
          yearGanZhi: lunar.yearGanZhi,
          shengXiao: lunar.shengXiao,
          jieQi: lunar.jieQi,
          festivals: lunar.festivals,
        };
      }
    }
    
    // 回退到简化计算
    const lunarMonth = ((month + 10) % 12) || 12;
    const lunarDay = ((day + 10) % 30) || 30;
    
    return {
      year: year,
      month: lunarMonth,
      day: lunarDay,
      monthStr: this.lunarMonths[lunarMonth - 1],
      dayStr: this.lunarDays[lunarDay - 1],
      isLeapMonth: false,
      yearGanZhi: this.getGanZhiYear(year),
      shengXiao: this.getShengXiao(year),
      jieQi: null,
      festivals: [],
    };
  },

  // 获取节假日信息
  getHoliday(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    // 优先使用 lunar-javascript 的 HolidayUtil
    if (window.lunarAPI) {
      const holiday = window.lunarAPI.getHoliday(year, month, day);
      if (holiday) {
        return {
          name: holiday.name,
          type: holiday.isWork ? 'work' : 'rest',
        };
      }
    }
    
    // 回退到内置节假日配置
    const dateStr = this.formatDate(date);
    return this.holidays2026[dateStr] || null;
  },

  // 获取公历节日
  getSolarFestival(date) {
    // 优先使用 lunar-javascript
    if (window.lunarAPI) {
      const festivals = window.lunarAPI.getSolarFestivals(
        date.getFullYear(), 
        date.getMonth() + 1, 
        date.getDate()
      );
      if (festivals && festivals.length > 0) {
        return festivals[0];
      }
    }
    
    const key = `${date.getMonth() + 1}-${date.getDate()}`;
    return this.solarFestivals[key] || null;
  },

  // 获取农历节日
  getLunarFestival(lunarMonth, lunarDay) {
    const key = `${lunarMonth}-${lunarDay}`;
    return this.lunarFestivals[key] || null;
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 获取年份的天干地支
  getGanZhiYear(year) {
    const ganIndex = (year - 4) % 10;
    const zhiIndex = (year - 4) % 12;
    return this.tianGan[ganIndex] + this.diZhi[zhiIndex];
  },

  // 获取生肖
  getShengXiao(year) {
    const index = (year - 4) % 12;
    return this.shengXiao[index];
  },
};

// ==================== 全局状态 ====================
// 初始化当前日期（清除时间部分）
const initialDate = new Date();
initialDate.setHours(0, 0, 0, 0);

const state = {
  currentDate: initialDate,      // 当前选中日期
  currentView: 'today',         // 当前视图: 'today' | 'month' | 'year'
  isPinned: true,               // 是否置顶
  events: [],                   // 日程列表
  taskCounts: {},               // 每日任务数量缓存
  contextMenuTarget: null,      // 右键菜单目标
  collapsedTasks: {},           // 折叠状态 { eventId: true/false }
};

// 加载保存的折叠状态
function loadCollapsedState() {
  try {
    const saved = localStorage.getItem('hoyoCalendar_collapsedTasks');
    if (saved) {
      state.collapsedTasks = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('加载折叠状态失败:', e);
  }
}

// 保存折叠状态
function saveCollapsedState() {
  try {
    localStorage.setItem('hoyoCalendar_collapsedTasks', JSON.stringify(state.collapsedTasks));
  } catch (e) {
    console.warn('保存折叠状态失败:', e);
  }
}

// 切换任务折叠状态
function toggleTaskCollapsed(eventId) {
  const key = String(eventId);
  state.collapsedTasks[key] = !state.collapsedTasks[key];
  saveCollapsedState();
}

// 检查任务是否折叠
function isTaskCollapsed(eventId) {
  const key = String(eventId);
  return !!state.collapsedTasks[key];
}

// ==================== DOM 元素引用 ====================
const elements = {
  // 窗口控制
  pinBtn: document.getElementById('pinBtn'),
  minimizeBtn: document.getElementById('minimizeBtn'),
  closeBtn: document.getElementById('closeBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  
  // 日期显示
  yearLabel: document.getElementById('yearLabel'),
  monthLabel: document.getElementById('monthLabel'),
  lunarInfo: document.getElementById('lunarInfo'),
  holidayBadge: document.getElementById('holidayBadge'),
  
  // 视图容器
  todayView: document.getElementById('todayView'),
  monthView: document.getElementById('monthView'),
  yearView: document.getElementById('yearView'),
  
  // 今日视图元素
  weekPicker: document.getElementById('weekPicker'),
  agendaList: document.getElementById('agendaList'),
  emptyState: document.getElementById('emptyState'),
  taskInput: document.getElementById('taskInput'),
  imageInput: document.getElementById('imageInput'),
  uploadBtn: document.getElementById('uploadBtn'),
  
  // 月视图元素
  monthGrid: document.getElementById('monthGrid'),
  backFromMonth: document.getElementById('backFromMonth'),
  
  // 年视图元素
  yearGrid: document.getElementById('yearGrid'),
  backFromYear: document.getElementById('backFromYear'),
};

// ==================== 初始化 ====================

// 渲染进程全局错误捕获
window.onerror = (msg, src, line, col, err) => {
  console.error(`[Renderer Error] ${msg} at ${src}:${line}:${col}`, err);
};
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Renderer] Unhandled Promise rejection:', event.reason);
});

document.addEventListener('DOMContentLoaded', () => {
  console.log('🎮 HoyoCalendar 初始化中...');
  
  loadCollapsedState();  // 加载折叠状态
  loadStoredEvents();
  initWindowControls();
  initDateDisplay();
  initWeekPicker();
  initViewSwitching();
  initInputHandlers();
  initContextMenu();
  initSettings();
  initChat();

  // 后端就绪后自动刷新日程显示
  if (window.electronAPI?.onBackendReady) {
    window.electronAPI.onBackendReady((ready) => {
      if (ready) {
        console.log('🔄 后端就绪，刷新日程...');
        loadStoredEvents();
        switchView(state.currentView);
      }
    });
  }
  
  console.log('✅ HoyoCalendar 初始化完成');
});

// ==================== 数据存储 ====================
function loadStoredEvents() {
  if (window.eventAPI) {
    state.events = window.eventAPI.loadEvents() || [];
    state.taskCounts = window.eventAPI.getTaskCounts() || {};
    console.log(`📋 已加载 ${state.events.length} 条日程`);
  }
}

function saveEvents() {
  if (window.eventAPI) {
    window.eventAPI.saveEvents(state.events);
    state.taskCounts = window.eventAPI.getTaskCounts() || {};
  }
}

function refreshTaskCounts() {
  if (window.eventAPI) {
    state.taskCounts = window.eventAPI.getTaskCounts() || {};
  }
}

// ==================== 窗口控制 ====================
function initWindowControls() {
  // 最小化
  elements.minimizeBtn.addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
  });
  
  // 关闭
  elements.closeBtn.addEventListener('click', () => {
    window.electronAPI.closeWindow();
  });
  
  // 切换置顶
  elements.pinBtn.addEventListener('click', () => {
    window.electronAPI.togglePin();
  });
  
  // 监听置顶状态变化
  window.electronAPI.onPinStatusChanged((isPinned) => {
    state.isPinned = isPinned;
    elements.pinBtn.classList.toggle('pinned', isPinned);
  });
  
  // 初始状态
  elements.pinBtn.classList.add('pinned');
}

// ==================== 日期显示 ====================
function initDateDisplay() {
  updateDateDisplay(state.currentDate);
}

function updateDateDisplay(date) {
  elements.yearLabel.textContent = date.getFullYear();
  elements.monthLabel.textContent = date.getMonth() + 1;
  
  // 获取农历信息
  const lunar = LunarHelper.getLunarDate(date);
  const ganZhi = lunar.yearGanZhi || LunarHelper.getGanZhiYear(date.getFullYear());
  const shengXiao = lunar.shengXiao || LunarHelper.getShengXiao(date.getFullYear());
  
  // 检查节气
  const jieQi = lunar.jieQi;
  
  // 检查节日
  const solarFestival = LunarHelper.getSolarFestival(date);
  const lunarFestival = LunarHelper.getLunarFestival(lunar.month, lunar.day);
  const lunarLibFestivals = lunar.festivals && lunar.festivals.length > 0 ? lunar.festivals[0] : null;
  const festival = solarFestival || lunarLibFestivals || lunarFestival;
  
  // 显示农历信息
  if (jieQi) {
    elements.lunarInfo.textContent = `${lunar.monthStr}${lunar.dayStr} · ${jieQi}`;
  } else if (festival) {
    elements.lunarInfo.textContent = `${lunar.monthStr}${lunar.dayStr} · ${festival}`;
  } else {
    elements.lunarInfo.textContent = `农历 ${lunar.monthStr}${lunar.dayStr} · ${ganZhi}${shengXiao}年`;
  }
  
  // 节假日标记（休/班）
  const holiday = LunarHelper.getHoliday(date);
  if (holiday) {
    elements.holidayBadge.textContent = holiday.type === 'rest' ? '休' : '班';
    elements.holidayBadge.className = `holiday-badge ${holiday.type}`;
  } else {
    elements.holidayBadge.textContent = '';
    elements.holidayBadge.className = 'holiday-badge';
  }
}

// ==================== 周日期选择器 ====================
function initWeekPicker() {
  renderWeekPicker(state.currentDate);
}

function renderWeekPicker(centerDate) {
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // 获取本周的日期（周日开始）
  const centerDateCopy = new Date(centerDate);
  centerDateCopy.setHours(0, 0, 0, 0);
  const dayOfWeek = centerDateCopy.getDay();
  
  // 计算周日的日期
  const startOfWeek = new Date(centerDateCopy);
  startOfWeek.setDate(centerDateCopy.getDate() - dayOfWeek);
  
  elements.weekPicker.innerHTML = '';
  
  for (let i = 0; i < 7; i++) {
    // 为每个日期创建独立的 Date 对象，避免闭包问题
    const dateYear = startOfWeek.getFullYear();
    const dateMonth = startOfWeek.getMonth();
    const dateDay = startOfWeek.getDate() + i;
    const date = new Date(dateYear, dateMonth, dateDay);
    date.setHours(0, 0, 0, 0);
    
    const isToday = isSameDay(date, today);
    const isSelected = isSameDay(date, state.currentDate);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    
    // 获取该日期的真实任务数量
    const dateStr = LunarHelper.formatDate(date);
    const taskCount = Math.min(state.taskCounts[dateStr] || 0, 5); // 最多显示5个指示器
    
    const dayItem = document.createElement('div');
    dayItem.className = 'day-item';
    if (isToday) dayItem.classList.add('today');
    if (isSelected) dayItem.classList.add('selected');
    if (isWeekend) dayItem.classList.add('weekend');
    
    // 存储日期信息到 data 属性，避免闭包问题
    dayItem.dataset.year = date.getFullYear();
    dayItem.dataset.month = date.getMonth();
    dayItem.dataset.day = date.getDate();
    
    dayItem.innerHTML = `
      <span class="day-name">${weekDays[date.getDay()]}</span>
      <span class="day-number">${date.getDate()}</span>
      <div class="task-indicators">
        ${Array(taskCount).fill('<span class="task-indicator"></span>').join('')}
      </div>
    `;
    
    // 使用 data 属性重建日期，确保点击时获取正确的日期
    dayItem.addEventListener('click', function() {
      const clickedYear = parseInt(this.dataset.year);
      const clickedMonth = parseInt(this.dataset.month);
      const clickedDay = parseInt(this.dataset.day);
      const clickedDate = new Date(clickedYear, clickedMonth, clickedDay);
      clickedDate.setHours(0, 0, 0, 0);
      selectDate(clickedDate);
    });
    
    elements.weekPicker.appendChild(dayItem);
  }
}

function selectDate(date) {
  // 确保日期对象是新的副本
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  
  const oldDate = new Date(state.currentDate);
  oldDate.setHours(0, 0, 0, 0);
  
  state.currentDate = newDate;
  updateDateDisplay(newDate);
  
  // 计算新旧日期所在周的起始日期
  const oldWeekStart = getWeekStart(oldDate);
  const newWeekStart = getWeekStart(newDate);
  
  console.log('📅 selectDate:', {
    oldDate: oldDate.toISOString(),
    newDate: newDate.toISOString(),
    oldWeekStart: oldWeekStart.toISOString(),
    newWeekStart: newWeekStart.toISOString(),
    isSameWeek: oldWeekStart.getTime() === newWeekStart.getTime()
  });
  
  // 始终重新渲染周选择器，确保显示正确
  renderWeekPicker(newDate);
  
  renderAgendaList();
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function updateWeekPickerSelection() {
  const dayItems = elements.weekPicker.querySelectorAll('.day-item');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  dayItems.forEach((item) => {
    // 从 data 属性获取日期
    const itemYear = parseInt(item.dataset.year);
    const itemMonth = parseInt(item.dataset.month);
    const itemDay = parseInt(item.dataset.day);
    const itemDate = new Date(itemYear, itemMonth, itemDay);
    itemDate.setHours(0, 0, 0, 0);
    
    item.classList.toggle('selected', isSameDay(itemDate, state.currentDate));
    item.classList.toggle('today', isSameDay(itemDate, today));
  });
}

// ==================== 视图切换 ====================
function initViewSwitching() {
  // 点击年份 -> 年视图
  elements.yearLabel.addEventListener('click', () => {
    switchView('year');
  });
  
  // 点击月份 -> 月视图
  elements.monthLabel.addEventListener('click', () => {
    switchView('month');
  });
  
  // 返回按钮 - 回到真正的今天
  elements.backFromMonth.addEventListener('click', () => {
    goToToday();
  });
  
  elements.backFromYear.addEventListener('click', () => {
    goToToday();
  });
}

function goToToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  state.currentDate = today;
  updateDateDisplay(today);
  renderWeekPicker(today);
  switchView('today');
}

function switchView(view) {
  state.currentView = view;
  
  // 隐藏所有视图
  elements.todayView.classList.add('hidden');
  elements.monthView.classList.add('hidden');
  elements.yearView.classList.add('hidden');
  
  // 显示目标视图
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

// ==================== 月视图渲染 ====================
function renderMonthView() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  
  // 当月第一天
  const firstDay = new Date(year, month, 1);
  // 当月天数
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // 第一天是周几
  const startDayOfWeek = firstDay.getDay();
  
  elements.monthGrid.innerHTML = '';
  
  // 上月补位
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const dayEl = createMonthDayElement(prevMonthDays - i, true);
    elements.monthGrid.appendChild(dayEl);
  }
  
  // 当月日期
  const today = new Date();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const isToday = isSameDay(date, today);
    const dayEl = createMonthDayElement(day, false, isToday, date);
    elements.monthGrid.appendChild(dayEl);
  }
  
  // 下月补位
  const totalCells = elements.monthGrid.children.length;
  const remainingCells = 42 - totalCells; // 6 rows x 7 days
  for (let i = 1; i <= remainingCells; i++) {
    const dayEl = createMonthDayElement(i, true);
    elements.monthGrid.appendChild(dayEl);
  }
}

function createMonthDayElement(day, isOtherMonth, isToday = false, date = null) {
  const dayEl = document.createElement('div');
  dayEl.className = 'month-day';
  if (isOtherMonth) dayEl.classList.add('other-month');
  if (isToday) dayEl.classList.add('today');
  
  // 获取农历和节假日信息
  let lunarText = '--';
  let badgeHtml = '';
  
  if (date) {
    // 存储日期信息到 data 属性
    dayEl.dataset.year = date.getFullYear();
    dayEl.dataset.month = date.getMonth();
    dayEl.dataset.day = date.getDate();
    
    const lunar = LunarHelper.getLunarDate(date);
    const solarFestival = LunarHelper.getSolarFestival(date);
    const lunarFestival = LunarHelper.getLunarFestival(lunar.month, lunar.day);
    const holiday = LunarHelper.getHoliday(date);
    
    // 优先显示节日，否则显示农历
    if (solarFestival) {
      lunarText = solarFestival.length > 2 ? solarFestival.slice(0, 2) : solarFestival;
    } else if (lunarFestival) {
      lunarText = lunarFestival.length > 2 ? lunarFestival.slice(0, 2) : lunarFestival;
    } else {
      lunarText = lunar.day === 1 ? lunar.monthStr : lunar.dayStr;
    }
    
    // 休/班标记
    if (holiday) {
      badgeHtml = `<span class="badge ${holiday.type}">${holiday.type === 'rest' ? '休' : '班'}</span>`;
    }
  }
  
  dayEl.innerHTML = `
    <span class="solar">${day}</span>
    <span class="lunar">${lunarText}</span>
    ${badgeHtml}
  `;
  
  if (date && !isOtherMonth) {
    dayEl.addEventListener('click', function() {
      // 从 data 属性重建日期，避免闭包问题
      const clickedYear = parseInt(this.dataset.year);
      const clickedMonth = parseInt(this.dataset.month);
      const clickedDay = parseInt(this.dataset.day);
      const clickedDate = new Date(clickedYear, clickedMonth, clickedDay);
      clickedDate.setHours(0, 0, 0, 0);
      selectDate(clickedDate);
      switchView('today');
    });
  }
  
  return dayEl;
}

// ==================== 年视图渲染 ====================
function renderYearView() {
  const year = state.currentDate.getFullYear();
  const currentMonth = state.currentDate.getMonth();
  const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', 
                      '七月', '八月', '九月', '十月', '十一月', '十二月'];
  
  elements.yearGrid.innerHTML = '';
  
  for (let month = 0; month < 12; month++) {
    const monthEl = document.createElement('div');
    monthEl.className = 'year-month';
    if (month === currentMonth) monthEl.classList.add('current');
    
    // 存储年月信息到 data 属性
    monthEl.dataset.year = year;
    monthEl.dataset.month = month;
    
    monthEl.innerHTML = `
      <div class="year-month-name">${monthNames[month]}</div>
      <div class="year-month-mini">${generateMiniMonth(year, month)}</div>
    `;
    
    monthEl.addEventListener('click', function() {
      const clickedYear = parseInt(this.dataset.year);
      const clickedMonth = parseInt(this.dataset.month);
      state.currentDate = new Date(clickedYear, clickedMonth, 1);
      state.currentDate.setHours(0, 0, 0, 0);
      updateDateDisplay(state.currentDate);
      switchView('month');
    });
    
    elements.yearGrid.appendChild(monthEl);
  }
}

function generateMiniMonth(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  
  let html = '';
  // 补位
  for (let i = 0; i < firstDay; i++) {
    html += '<span></span>';
  }
  // 日期
  for (let day = 1; day <= daysInMonth; day++) {
    html += `<span>${day}</span>`;
  }
  return html;
}

// ==================== 日程列表渲染 ====================
function renderAgendaList() {
  const dateStr = LunarHelper.formatDate(state.currentDate);
  
  // 从存储中获取当天的事件，或从 state 中筛选
  let todayEvents;
  if (window.eventAPI) {
    todayEvents = window.eventAPI.getEventsByDate(dateStr) || [];
  } else {
    todayEvents = state.events.filter(e => e.date === dateStr);
  }
  
  // 按时间排序
  todayEvents.sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });
  
  // 清除所有任务项
  const existingItems = elements.agendaList.querySelectorAll('.task-item');
  existingItems.forEach(item => item.remove());
  
  if (todayEvents.length === 0) {
    elements.emptyState.style.display = 'flex';
  } else {
    elements.emptyState.style.display = 'none';
    
    // 渲染每个任务
    todayEvents.forEach(event => {
      const taskEl = createTaskElement(event);
      elements.agendaList.appendChild(taskEl);
    });
  }
}

function createTaskElement(event) {
  const taskEl = document.createElement('div');
  taskEl.className = 'task-item';
  taskEl.dataset.id = event.id;
  
  // 获取折叠状态的唯一标识符
  // 对于长期任务实例，使用 parentId + date 作为唯一标识
  const collapseKey = event.isRecurringInstance 
    ? `${event.recurringParentId}_${event.date}` 
    : event.id;
  taskEl.dataset.collapseKey = collapseKey;
  
  // 应用保存的折叠状态
  if (isTaskCollapsed(collapseKey)) {
    taskEl.classList.add('collapsed');
  }
  
  if (event.urgency === 'high' || event.urgency === 'urgent') {
    taskEl.classList.add('urgent');
  }
  
  // 长期任务标记
  if (event.isRecurringInstance || event.isRecurring) {
    taskEl.classList.add('recurring');
    if (event.isCompleted) {
      taskEl.classList.add('completed');
    }
  }
  
  const timeDisplay = event.time || '全天';
  const locationHtml = event.location 
    ? `<div class="task-location"><span class="location-icon">📍</span>${escapeHtml(event.location)}</div>` 
    : '';
  
  // 长期任务进度条（无论是否完成都显示）
  let progressHtml = '';
  if ((event.isRecurringInstance || event.isRecurring) && event.progress) {
    const progress = event.progress;
    progressHtml = `
      <div class="task-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress.percentage}%"></div>
        </div>
        <div class="progress-text">
          <span class="progress-count">${progress.completed}/${progress.total}</span>
          <span class="progress-percentage">${progress.percentage}%</span>
        </div>
      </div>
    `;
  }
  
  // 长期任务不再使用单独的勾选框，改为通过点击整个任务条完成
  let checkboxHtml = '';
  
  taskEl.innerHTML = `
    ${checkboxHtml}
    <div class="task-content">
      <div class="task-time">${timeDisplay}</div>
      <div class="task-title">${escapeHtml(event.event)}</div>
      <div class="task-details">
        ${locationHtml}
      </div>
      ${progressHtml}
    </div>
  `;
  
  // 长期任务：点击整个任务条即完成当日任务
  if (event.isRecurringInstance) {
    taskEl.addEventListener('click', function(e) {
      if (!e.target.closest('.context-menu')) {
        e.stopPropagation();
        const parentId = event.recurringParentId;
        const date = event.date;
        
        if (window.eventAPI && window.eventAPI.toggleRecurringDateComplete) {
          window.eventAPI.toggleRecurringDateComplete(parentId, date);
          refreshTaskCounts();
          renderAgendaList();
          renderWeekPicker(state.currentDate);
        }
      }
    });
  } else {
    // 非长期任务：单击折叠/展开
    taskEl.addEventListener('click', function(e) {
      if (!e.target.closest('.context-menu')) {
        const key = this.dataset.collapseKey;
        toggleTaskCollapsed(key);
        this.classList.toggle('collapsed');
      }
    });
  }
  
  // 右键菜单
  taskEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, event);
  });
  
  return taskEl;
}

// ==================== 右键菜单 ====================
let contextMenuEl = null;

function initContextMenu() {
  // 点击其他区域关闭菜单
  document.addEventListener('click', (e) => {
    if (contextMenuEl && !contextMenuEl.contains(e.target)) {
      hideContextMenu();
    }
  });
  
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.task-item')) {
      hideContextMenu();
    }
  });
}

function showContextMenu(x, y, event) {
  hideContextMenu();
  
  state.contextMenuTarget = event;
  
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'context-menu';
  
  // 判断是否为长期任务
  const isLongTerm = event.isRecurring || event.isRecurringInstance;
  
  if (isLongTerm) {
    // 长期任务：修改起止日期
    contextMenuEl.innerHTML = `
      <div class="context-menu-item" data-action="edit-dates">
        📅 修改起止日期
      </div>
      <div class="context-menu-item danger" data-action="delete">
        🗑️ 删除
      </div>
    `;
  } else {
    // 短期任务：编辑和删除
    contextMenuEl.innerHTML = `
      <div class="context-menu-item" data-action="edit">
        ✏️ 编辑
      </div>
      <div class="context-menu-item" data-action="convert-to-longterm">
        🔄 转为长期任务
      </div>
      <div class="context-menu-item danger" data-action="delete">
        🗑️ 删除
      </div>
    `;
  }
  
  // 处理菜单项点击
  contextMenuEl.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      handleContextMenuAction(action, state.contextMenuTarget);
      hideContextMenu();
    });
  });
  
  document.body.appendChild(contextMenuEl);
  
  // 确保菜单不超出窗口
  const rect = contextMenuEl.getBoundingClientRect();
  const adjustedX = Math.min(x, window.innerWidth - rect.width - 10);
  const adjustedY = Math.min(y, window.innerHeight - rect.height - 10);
  
  contextMenuEl.style.left = `${adjustedX}px`;
  contextMenuEl.style.top = `${adjustedY}px`;
}

function hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
  state.contextMenuTarget = null;
}

function handleContextMenuAction(action, event) {
  switch (action) {
    case 'edit':
      // 短期任务编辑：事件/时间/地点/紧急程度
      showEditModal(event, 'all');
      break;
      
    case 'convert-to-longterm':
      // 转为长期任务
      showConvertToLongTermModal(event);
      break;
      
    case 'edit-dates':
      // 长期任务修改起止日期
      showEditDatesModal(event);
      break;
      
    case 'delete':
      if (confirm('确定要删除这条日程吗？')) {
        deleteEvent(event.id);
      }
      break;
  }
}

// ==================== 编辑弹窗 ====================
let editModalEl = null;

function showEditModal(event, mode = 'all') {
  hideEditModal();
  
  const overlay = document.createElement('div');
  overlay.className = 'edit-modal-overlay';
  
  const dateValue = event.date || LunarHelper.formatDate(state.currentDate);
  
  overlay.innerHTML = `
    <div class="edit-modal">
      <div class="edit-modal-title">✏️ 编辑日程</div>
      
      <div class="edit-modal-field">
        <label class="edit-modal-label">事件内容</label>
        <input type="text" class="edit-modal-input" id="edit-event" 
               value="${escapeHtml(event.event || '')}" placeholder="输入事件内容">
      </div>
      
      <div class="edit-modal-row">
        <div class="edit-modal-field">
          <label class="edit-modal-label">日期</label>
          <input type="date" class="edit-modal-input" id="edit-date" 
                 value="${dateValue}">
        </div>
        <div class="edit-modal-field">
          <label class="edit-modal-label">时间</label>
          <input type="time" class="edit-modal-input" id="edit-time" 
                 value="${event.time || ''}" placeholder="如 14:30">
        </div>
      </div>
      
      <div class="edit-modal-field">
        <label class="edit-modal-label">地点</label>
        <input type="text" class="edit-modal-input" id="edit-location" 
               value="${escapeHtml(event.location || '')}" placeholder="输入地点（可选）">
      </div>
      
      <div class="edit-modal-field">
        <label class="edit-modal-label">紧急程度</label>
        <div class="edit-modal-urgency">
          <div class="urgency-option ${event.urgency !== 'high' ? 'selected' : ''}" data-urgency="normal">
            📋 普通
          </div>
          <div class="urgency-option urgent ${event.urgency === 'high' ? 'selected' : ''}" data-urgency="high">
            🔥 紧急
          </div>
        </div>
      </div>
      
      <div class="edit-modal-buttons">
        <button class="edit-modal-btn cancel">取消</button>
        <button class="edit-modal-btn save">保存</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  editModalEl = overlay;
  
  // 聚焦到对应输入框
  if (mode === 'time') {
    overlay.querySelector('#edit-time').focus();
  } else {
    overlay.querySelector('#edit-event').focus();
  }
  
  // 紧急程度选择
  let selectedUrgency = event.urgency || 'normal';
  overlay.querySelectorAll('.urgency-option').forEach(opt => {
    opt.addEventListener('click', () => {
      overlay.querySelectorAll('.urgency-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedUrgency = opt.dataset.urgency;
    });
  });
  
  // 取消按钮
  overlay.querySelector('.edit-modal-btn.cancel').addEventListener('click', hideEditModal);
  
  // 保存按钮
  overlay.querySelector('.edit-modal-btn.save').addEventListener('click', () => {
    const newEvent = overlay.querySelector('#edit-event').value.trim();
    const newDate = overlay.querySelector('#edit-date').value;
    const newTime = overlay.querySelector('#edit-time').value;
    const newLocation = overlay.querySelector('#edit-location').value.trim();
    
    if (!newEvent) {
      overlay.querySelector('#edit-event').focus();
      return;
    }
    
    updateEvent(event.id, {
      event: newEvent,
      date: newDate,
      time: newTime,
      location: newLocation,
      urgency: selectedUrgency
    });
    
    hideEditModal();
  });
  
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hideEditModal();
    }
  });
  
  // ESC 关闭
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      hideEditModal();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
  
  // Enter 保存
  overlay.querySelectorAll('.edit-modal-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        overlay.querySelector('.edit-modal-btn.save').click();
      }
    });
  });
}

function hideEditModal() {
  if (editModalEl) {
    editModalEl.remove();
    editModalEl = null;
  }
}

// ==================== 转换为长期任务弹窗 ====================
function showConvertToLongTermModal(event) {
  hideEditModal();
  
  const overlay = document.createElement('div');
  overlay.className = 'edit-modal-overlay';
  
  const today = LunarHelper.formatDate(new Date());
  const nextWeek = LunarHelper.formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  
  overlay.innerHTML = `
    <div class="edit-modal">
      <div class="edit-modal-title">🔄 转为长期任务</div>
      
      <div class="edit-modal-field">
        <label class="edit-modal-label">事件内容</label>
        <div class="edit-modal-readonly">${escapeHtml(event.event)}</div>
      </div>
      
      <div class="edit-modal-row">
        <div class="edit-modal-field">
          <label class="edit-modal-label">开始日期</label>
          <input type="date" class="edit-modal-input" id="convert-start-date" 
                 value="${event.date || today}">
        </div>
        <div class="edit-modal-field">
          <label class="edit-modal-label">结束日期</label>
          <input type="date" class="edit-modal-input" id="convert-end-date" 
                 value="${nextWeek}">
        </div>
      </div>
      
      <div class="edit-modal-field">
        <label class="edit-modal-label">重复类型</label>
        <div class="edit-modal-urgency">
          <div class="urgency-option selected" data-type="daily">
            📅 每天
          </div>
          <div class="urgency-option" data-type="weekly">
            📆 每周
          </div>
        </div>
      </div>
      
      <div class="edit-modal-buttons">
        <button class="edit-modal-btn cancel">取消</button>
        <button class="edit-modal-btn save">转换</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  editModalEl = overlay;
  
  // 重复类型选择
  let recurringType = 'daily';
  overlay.querySelectorAll('.urgency-option').forEach(opt => {
    opt.addEventListener('click', () => {
      overlay.querySelectorAll('.urgency-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      recurringType = opt.dataset.type;
    });
  });
  
  // 取消按钮
  overlay.querySelector('.edit-modal-btn.cancel').addEventListener('click', hideEditModal);
  
  // 保存按钮
  overlay.querySelector('.edit-modal-btn.save').addEventListener('click', () => {
    const startDate = overlay.querySelector('#convert-start-date').value;
    const endDate = overlay.querySelector('#convert-end-date').value;
    
    if (!startDate || !endDate) {
      alert('请选择开始和结束日期');
      return;
    }
    
    if (startDate > endDate) {
      alert('开始日期不能晚于结束日期');
      return;
    }
    
    // 删除原短期任务
    deleteEvent(event.id);
    
    // 创建长期任务
    const newEvent = {
      event: event.event,
      time: event.time || '',
      location: event.location || '',
      urgency: event.urgency || 'normal',
      isRecurring: true,
      recurringType: recurringType,
      recurringDays: null,
      startDate: startDate,
      endDate: endDate,
      completedDates: [],
    };
    
    if (window.eventAPI) {
      window.eventAPI.addEvent(newEvent);
      state.events = window.eventAPI.loadEvents();
    } else {
      newEvent.id = Date.now() + Math.random();
      state.events.push(newEvent);
    }
    
    refreshTaskCounts();
    renderAgendaList();
    renderWeekPicker(state.currentDate);
    
    hideEditModal();
  });
  
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hideEditModal();
    }
  });
  
  // ESC 关闭
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      hideEditModal();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
}

// ==================== 修改长期任务起止日期弹窗 ====================
function showEditDatesModal(event) {
  hideEditModal();
  
  const overlay = document.createElement('div');
  overlay.className = 'edit-modal-overlay';
  
  // 获取实际的长期任务（如果是实例，找到父任务）
  let actualEvent = event;
  if (event.isRecurringInstance && event.recurringParentId) {
    const parentEvent = state.events.find(e => e.id === event.recurringParentId);
    if (parentEvent) {
      actualEvent = parentEvent;
    }
  }
  
  overlay.innerHTML = `
    <div class="edit-modal">
      <div class="edit-modal-title">📅 修改起止日期</div>
      
      <div class="edit-modal-field">
        <label class="edit-modal-label">事件内容</label>
        <div class="edit-modal-readonly">${escapeHtml(actualEvent.event)}</div>
      </div>
      
      <div class="edit-modal-row">
        <div class="edit-modal-field">
          <label class="edit-modal-label">开始日期</label>
          <input type="date" class="edit-modal-input" id="edit-start-date" 
                 value="${actualEvent.startDate || ''}">
        </div>
        <div class="edit-modal-field">
          <label class="edit-modal-label">结束日期</label>
          <input type="date" class="edit-modal-input" id="edit-end-date" 
                 value="${actualEvent.endDate || ''}">
        </div>
      </div>
      
      <div class="edit-modal-buttons">
        <button class="edit-modal-btn cancel">取消</button>
        <button class="edit-modal-btn save">保存</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  editModalEl = overlay;
  
  // 取消按钮
  overlay.querySelector('.edit-modal-btn.cancel').addEventListener('click', hideEditModal);
  
  // 保存按钮
  overlay.querySelector('.edit-modal-btn.save').addEventListener('click', () => {
    const startDate = overlay.querySelector('#edit-start-date').value;
    const endDate = overlay.querySelector('#edit-end-date').value;
    
    if (!startDate || !endDate) {
      alert('请选择开始和结束日期');
      return;
    }
    
    if (startDate > endDate) {
      alert('开始日期不能晚于结束日期');
      return;
    }
    
    updateEvent(actualEvent.id, {
      startDate: startDate,
      endDate: endDate
    });
    
    hideEditModal();
  });
  
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hideEditModal();
    }
  });
  
  // ESC 关闭
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      hideEditModal();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
}

function updateEvent(id, updates) {
  if (window.eventAPI) {
    window.eventAPI.updateEvent(id, updates);
    state.events = window.eventAPI.loadEvents();
  } else {
    const index = state.events.findIndex(e => e.id === id);
    if (index !== -1) {
      state.events[index] = { ...state.events[index], ...updates };
    }
  }
  refreshTaskCounts();
  renderAgendaList();
  renderWeekPicker(state.currentDate);
}

function deleteEvent(id) {
  if (window.eventAPI) {
    window.eventAPI.deleteEvent(id);
    state.events = window.eventAPI.loadEvents();
  } else {
    state.events = state.events.filter(e => e.id !== id);
  }
  refreshTaskCounts();
  renderAgendaList();
  renderWeekPicker(state.currentDate);
}

// ==================== 输入处理 ====================
function initInputHandlers() {
  // 文本输入
  elements.taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && elements.taskInput.value.trim()) {
      addTask(elements.taskInput.value.trim());
      elements.taskInput.value = '';
    }
  });
  
  // 图片上传
  elements.imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleImageUpload(file);
    }
  });
  
  // 拖放支持
  const inputWrapper = elements.taskInput.parentElement;
  
  inputWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    inputWrapper.classList.add('drag-over');
  });
  
  inputWrapper.addEventListener('dragleave', () => {
    inputWrapper.classList.remove('drag-over');
  });
  
  inputWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    inputWrapper.classList.remove('drag-over');
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleImageUpload(file);
    }
  });
}

function addTask(text) {
  console.log('📝 用户输入:', text);
  // 通过 AI 对话管理日程（自动打开聊天面板显示结果）
  if (!chatEl) showChat();
  sendChatFromInput(text);
}

async function addTaskWithAI(text, dateStr) {
  showLoading('正在智能解析...');
  
  try {
    const parsed = await window.aiAPI.parseEvent(text);
    
    if (!parsed) {
      hideLoading();
      alert('AI 解析失败，请重试');
      return;
    }
    
    // 处理可能返回的数组
    const events = Array.isArray(parsed) ? parsed : [parsed];
    
    for (const event of events) {
      let newEvent;
      
      // 检查是否为长期任务
      if (event.isRecurring) {
        console.log('🔄 检测到长期任务:', event);
        newEvent = {
          event: event.event || text,
          time: event.time || '',
          location: event.location || '',
          urgency: event.urgency || 'normal',
          isRecurring: true,
          recurringType: event.recurringType || 'daily',
          recurringDays: event.recurringDays || null,
          startDate: event.startDate || dateStr,
          endDate: event.endDate || dateStr,
          completedDates: [],
        };
      } else {
        // 普通任务
        const eventDate = event.date || dateStr;
        newEvent = {
          event: event.event || text,
          date: eventDate,
          time: event.time || '',
          location: event.location || '',
          urgency: event.urgency || 'normal',
        };
      }
      
      if (window.eventAPI) {
        window.eventAPI.addEvent(newEvent);
      } else {
        newEvent.id = Date.now() + Math.random();
        state.events.push(newEvent);
      }
    }
    
    if (window.eventAPI) {
      state.events = window.eventAPI.loadEvents();
    }
    
    console.log(`✅ 智能解析完成，添加了 ${events.length} 条日程`);
  } catch (err) {
    console.error('AI 解析失败:', err);
    alert('AI 解析失败: ' + err.message);
  }
  
  hideLoading();
  refreshTaskCounts();
  renderAgendaList();
  renderWeekPicker(state.currentDate);
}

async function handleImageUpload(file) {
  console.log('📷 处理图片:', file.name);
  
  // 检查 AI 服务是否可用
  if (!window.aiAPI || !window.aiAPI.isAvailable()) {
    alert('AI 服务不可用，请检查配置');
    return;
  }
  
  showLoading('正在识别图片...');
  
  try {
    // 将文件转为 Base64
    const base64Data = await fileToBase64(file);
    
    // 使用 AI 直接解析图片
    const parsed = await window.aiAPI.parseImage(base64Data);
    
    if (!parsed) {
      hideLoading();
      alert('未能从图片中识别出有效的日程信息');
      return;
    }
    
    const dateStr = LunarHelper.formatDate(state.currentDate);
    const events = Array.isArray(parsed) ? parsed : [parsed];
    
    for (const event of events) {
      const eventDate = event.date || dateStr;
      
      const newEvent = {
        event: event.event || '从图片识别的任务',
        date: eventDate,
        time: event.time || '',
        location: event.location || '',
        urgency: event.urgency || 'normal',
        source: 'image',
      };
      
      if (window.eventAPI) {
        window.eventAPI.addEvent(newEvent);
      }
    }
    
    if (window.eventAPI) {
      state.events = window.eventAPI.loadEvents();
    }
    
    console.log(`✅ 从图片中提取了 ${events.length} 条日程`);
    
    refreshTaskCounts();
    renderAgendaList();
    renderWeekPicker(state.currentDate);
    
  } catch (err) {
    console.error('图片处理失败:', err);
    alert('图片处理失败: ' + err.message);
  }
  
  hideLoading();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== 加载状态 ====================
let loadingEl = null;

function showLoading(message = '加载中...') {
  hideLoading();
  
  loadingEl = document.createElement('div');
  loadingEl.className = 'loading-overlay';
  loadingEl.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <span class="loading-text">${message}</span>
    </div>
  `;
  
  document.body.appendChild(loadingEl);
}

function hideLoading() {
  if (loadingEl) {
    loadingEl.remove();
    loadingEl = null;
  }
}

// ==================== 工具函数 ====================
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== 设置面板 ====================
let settingsEl = null;

function initSettings() {
  if (elements.settingsBtn) {
    elements.settingsBtn.addEventListener('click', showSettings);
  }
}

function showSettings() {
  hideSettings();
  
  // 加载当前配置（异步）
  const defaultConfig = {
    ai: { provider: 'doubao', doubao: { apiKey: '', baseUrl: '', model: '' }, ollama: { baseUrl: 'http://localhost:11434', model: '', apiKey: '' }, openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: '' } }
  };

  (async () => {
    let config = defaultConfig;
    try {
      const loaded = await window.configAPI?.load();
      if (loaded && loaded.ai) config = loaded;
    } catch (e) { /* use default */ }

    // 读取开机自启状态
    let autoLaunch = false;
    try {
      autoLaunch = await window.electronAPI?.getAutoLaunch();
    } catch (e) { /* ignore */ }
  
  settingsEl = document.createElement('div');
  settingsEl.className = 'settings-overlay';
  settingsEl.innerHTML = `
    <div class="settings-panel">
      <div class="settings-header">
        <span class="settings-title">⚙️ 设置</span>
        <button class="settings-close" id="settingsClose">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
          </svg>
        </button>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <div class="settings-section-title">AI 服务配置</div>
          
          <div class="settings-item">
            <label class="settings-label">AI 服务提供商</label>
            <select class="settings-select" id="aiProvider">
              <option value="doubao" ${config.ai.provider === 'doubao' ? 'selected' : ''}>豆包 (火山引擎)</option>
              <option value="ollama" ${config.ai.provider === 'ollama' ? 'selected' : ''}>Ollama (本地)</option>
              <option value="openai" ${config.ai.provider === 'openai' ? 'selected' : ''}>OpenAI 兼容</option>
            </select>
          </div>
          
          <div id="doubaoSettings" style="${config.ai.provider !== 'doubao' ? 'display:none' : ''}">
            <div class="settings-item">
              <label class="settings-label">豆包 API Key</label>
              <input type="password" class="settings-input" id="doubaoApiKey" 
                     value="${config.ai.doubao?.apiKey || ''}" 
                     placeholder="输入你的 ARK API Key">
            </div>
            <div class="settings-item">
              <label class="settings-label">Base URL</label>
              <input type="text" class="settings-input" id="doubaoBaseUrl" 
                     value="${config.ai.doubao?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3'}" 
                     placeholder="https://ark.cn-beijing.volces.com/api/v3">
            </div>
            <div class="settings-item">
              <label class="settings-label">模型名称</label>
              <input type="text" class="settings-input" id="doubaoModel" 
                     value="${config.ai.doubao?.model || ''}" 
                     placeholder="如 ep-xxxxxxxx">
            </div>
          </div>
          
          <div id="ollamaSettings" style="${config.ai.provider !== 'ollama' ? 'display:none' : ''}">
            <div class="settings-item">
              <label class="settings-label">Ollama 地址</label>
              <input type="text" class="settings-input" id="ollamaUrl" 
                     value="${config.ai.ollama?.baseUrl || 'http://localhost:11434'}" 
                     placeholder="http://localhost:11434">
            </div>
            <div class="settings-item">
              <label class="settings-label">模型名称</label>
              <input type="text" class="settings-input" id="ollamaModel" 
                     value="${config.ai.ollama?.model || ''}" 
                     placeholder="如 qwen2.5:7b">
            </div>
          </div>
          
          <div id="openaiSettings" style="${config.ai.provider !== 'openai' ? 'display:none' : ''}">
            <div class="settings-item">
              <label class="settings-label">API Key</label>
              <input type="password" class="settings-input" id="openaiApiKey" 
                     value="${config.ai.openai?.apiKey || ''}" 
                     placeholder="输入 API Key">
            </div>
            <div class="settings-item">
              <label class="settings-label">API 地址</label>
              <input type="text" class="settings-input" id="openaiUrl" 
                     value="${config.ai.openai?.baseUrl || 'https://api.openai.com/v1'}" 
                     placeholder="https://api.openai.com/v1">
            </div>
            <div class="settings-item">
              <label class="settings-label">模型名称</label>
              <input type="text" class="settings-input" id="openaiModel" 
                     value="${config.ai.openai?.model || ''}" 
                     placeholder="如 gpt-4o-mini">
            </div>
          </div>
        </div>
        
        <div class="settings-section">
          <div class="settings-section-title">通用设置</div>
          <div class="settings-item" style="display:flex;align-items:center;justify-content:space-between;">
            <label class="settings-label" style="margin-bottom:0;">开机自启动</label>
            <label class="auto-launch-switch">
              <input type="checkbox" id="autoLaunchToggle" ${autoLaunch ? 'checked' : ''}>
              <span class="auto-launch-slider"></span>
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <div class="settings-section-title">关于</div>
          <div style="font-size:12px;color:var(--text-muted);line-height:1.6">
            <p>HoyoCalendar v1.0.0</p>
            <p>二次元风格玻璃拟态桌面日历</p>
          </div>
        </div>
        
        <button class="settings-btn" id="saveSettings">保存设置</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(settingsEl);
  
  // 绑定事件
  document.getElementById('settingsClose').addEventListener('click', hideSettings);
  settingsEl.addEventListener('click', (e) => {
    if (e.target === settingsEl) hideSettings();
  });
  
  // AI 提供商切换
  document.getElementById('aiProvider').addEventListener('change', (e) => {
    const provider = e.target.value;
    document.getElementById('doubaoSettings').style.display = provider === 'doubao' ? '' : 'none';
    document.getElementById('ollamaSettings').style.display = provider === 'ollama' ? '' : 'none';
    document.getElementById('openaiSettings').style.display = provider === 'openai' ? '' : 'none';
  });
  
  // 保存设置
  document.getElementById('saveSettings').addEventListener('click', saveSettingsData);
  
  // 开机自启动切换
  document.getElementById('autoLaunchToggle').addEventListener('change', async (e) => {
    try {
      await window.electronAPI?.setAutoLaunch(e.target.checked);
    } catch (err) {
      console.error('设置开机自启动失败:', err);
      e.target.checked = !e.target.checked;
    }
  });
  })();
}

function hideSettings() {
  if (settingsEl) {
    settingsEl.remove();
    settingsEl = null;
  }
}

async function saveSettingsData() {
  if (!window.configAPI) {
    alert('配置服务不可用');
    return;
  }
  
  const provider = document.getElementById('aiProvider').value;
  
  const config = {
    ai: {
      provider,
      doubao: {
        apiKey: document.getElementById('doubaoApiKey').value,
        baseUrl: document.getElementById('doubaoBaseUrl').value,
        model: document.getElementById('doubaoModel').value,
      },
      ollama: {
        baseUrl: document.getElementById('ollamaUrl').value,
        model: document.getElementById('ollamaModel').value,
      },
      openai: {
        apiKey: document.getElementById('openaiApiKey').value,
        baseUrl: document.getElementById('openaiUrl').value,
        model: document.getElementById('openaiModel').value,
      },
    }
  };
  
  await window.configAPI.save(config);
  
  console.log('✅ 设置已保存');
  hideSettings();
  alert('设置已保存！');
}

// ==================== AI 聊天面板 ====================
let chatEl = null;
let chatMessages = [];
const chatSessionId = 'main';

function initChat() {
  const btn = document.getElementById('chatBtn');
  if (btn) btn.addEventListener('click', toggleChat);
}

function toggleChat() {
  if (chatEl) {
    hideChat();
  } else {
    showChat();
  }
}

function showChat() {
  hideChat();
  chatEl = document.createElement('div');
  chatEl.className = 'chat-overlay';
  chatEl.innerHTML = `
    <div class="chat-panel">
      <div class="chat-header">
        <span class="chat-title">🤖 AI 日程助手</span>
        <div class="chat-header-actions">
          <button class="chat-action-btn" id="chatReset" title="清空对话">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/>
            </svg>
          </button>
          <button class="chat-action-btn" id="chatClose" title="关闭">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="chat-messages" id="chatMessages">
        <div class="chat-msg chat-msg-ai">
          <div class="chat-msg-content">你好！我是 AI 日程助手，可以帮你添加、查询、修改和删除日程。试试说"帮我看看明天的日程"吧！</div>
        </div>
      </div>
      <div class="chat-input-area">
        <input type="text" class="chat-input" id="chatInput" placeholder="输入消息..." autocomplete="off">
        <button class="chat-send-btn" id="chatSend">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(chatEl);

  // 重新渲染历史消息
  renderChatHistory();

  document.getElementById('chatClose').addEventListener('click', hideChat);
  document.getElementById('chatReset').addEventListener('click', resetChat);
  document.getElementById('chatSend').addEventListener('click', sendChatMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  chatEl.addEventListener('click', (e) => {
    if (e.target === chatEl) hideChat();
  });

  document.getElementById('chatInput').focus();
}

function hideChat() {
  if (chatEl) {
    chatEl.remove();
    chatEl = null;
  }
}

function renderChatHistory() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  // Keep welcome message, then append history
  chatMessages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg-${msg.role}`;
    div.innerHTML = `<div class="chat-msg-content">${escapeHtml(msg.content)}</div>`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.disabled = true;

  // 显示用户消息
  chatMessages.push({ role: 'user', content: message });
  appendChatMsg('user', message);

  // 显示加载中
  const loadingId = appendChatMsg('ai', '思考中...');

  try {
    const result = await window.aiAPI.chat(message, chatSessionId);
    // 替换加载消息
    removeChatMsg(loadingId);
    const reply = result.message || result.error || '操作完成';
    chatMessages.push({ role: 'ai', content: reply });
    appendChatMsg('ai', reply);

    // 如果日程有变化，刷新视图
    if (result.events_changed) {
      loadStoredEvents();
      refreshTaskCounts();
      renderAgendaList();
      renderWeekPicker(state.currentDate);
    }
  } catch (err) {
    removeChatMsg(loadingId);
    const errMsg = `出错了：${err.message}`;
    chatMessages.push({ role: 'ai', content: errMsg });
    appendChatMsg('ai', errMsg);
  }

  input.disabled = false;
  input.focus();
}

// 从底部输入框发送消息到聊天面板
async function sendChatFromInput(text) {
  chatMessages.push({ role: 'user', content: text });
  appendChatMsg('user', text);

  const loadingId = appendChatMsg('ai', '思考中...');

  try {
    const result = await window.aiAPI.chat(text, chatSessionId);
    removeChatMsg(loadingId);
    const reply = result.message || result.error || '操作完成';
    chatMessages.push({ role: 'ai', content: reply });
    appendChatMsg('ai', reply);

    if (result.events_changed) {
      loadStoredEvents();
      refreshTaskCounts();
      renderAgendaList();
      renderWeekPicker(state.currentDate);
    }
  } catch (err) {
    removeChatMsg(loadingId);
    const errMsg = `出错了：${err.message}`;
    chatMessages.push({ role: 'ai', content: errMsg });
    appendChatMsg('ai', errMsg);
  }
}

let _chatMsgId = 0;
function appendChatMsg(role, text) {
  const container = document.getElementById('chatMessages');
  if (!container) return null;
  const id = `chat-msg-${++_chatMsgId}`;
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg-${role}`;
  div.id = id;
  div.innerHTML = `<div class="chat-msg-content">${escapeHtml(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeChatMsg(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

async function resetChat() {
  chatMessages = [];
  try {
    await window.aiAPI.resetChat(chatSessionId);
  } catch (e) { /* ignore */ }
  const container = document.getElementById('chatMessages');
  if (container) {
    container.innerHTML = `
      <div class="chat-msg chat-msg-ai">
        <div class="chat-msg-content">对话已重置！有什么我能帮你的吗？</div>
      </div>
    `;
  }
}
