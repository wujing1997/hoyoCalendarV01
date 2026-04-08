const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// 引入 lunar-javascript 库
let Lunar, Solar, HolidayUtil;
try {
  const lunarJS = require('lunar-javascript');
  Lunar = lunarJS.Lunar;
  Solar = lunarJS.Solar;
  HolidayUtil = lunarJS.HolidayUtil;
  console.log('✅ lunar-javascript 加载成功');
} catch (err) {
  console.warn('⚠️ lunar-javascript 加载失败，使用内置农历计算:', err.message);
}

// 引入 AI 服务 — 通过 Flask 后端 HTTP API
let backendPort = 5000;
const backendReady = (async () => {
  try {
    backendPort = await ipcRenderer.invoke('get-backend-port');
  } catch (e) {
    console.warn('⚠️ 获取后端端口失败，使用默认 5000');
  }
})();

function backendUrl(path) {
  return `http://127.0.0.1:${backendPort}${path}`;
}

// Node.js http 请求封装（preload 中 fetch 不可靠）
function httpRequest(urlPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: backendPort,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 数据存储路径
const userDataPath = process.env.APPDATA || process.env.HOME;
const dataDir = path.join(userDataPath, 'HoyoCalendar');
const eventsFile = path.join(dataDir, 'events.json');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 事件存储工具
let _idCounter = 0;
function generateUniqueId() {
  _idCounter++;
  return Date.now() * 1000 + _idCounter;
}

const EventStore = {
  // 读取所有事件
  loadEvents() {
    try {
      if (fs.existsSync(eventsFile)) {
        const data = fs.readFileSync(eventsFile, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (err) {
      console.error('读取事件失败:', err);
      return [];
    }
  },
  
  // 保存所有事件
  saveEvents(events) {
    try {
      fs.writeFileSync(eventsFile, JSON.stringify(events, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('保存事件失败:', err);
      return false;
    }
  },
  
  // 添加事件（支持长期任务）
  addEvent(event) {
    const events = this.loadEvents();
    event.id = generateUniqueId();
    event.createdAt = new Date().toISOString();
    
    // 如果是长期任务，保存原始任务并展开为子任务
    if (event.isRecurring) {
      event.recurringParentId = event.id; // 自身作为父任务
      event.completedDates = []; // 记录已完成的日期
      events.push(event);
    } else {
      events.push(event);
    }
    
    return this.saveEvents(events) ? event : null;
  },
  
  // 更新事件
  updateEvent(id, updates) {
    const events = this.loadEvents();
    const index = events.findIndex(e => e.id === id);
    if (index !== -1) {
      events[index] = { ...events[index], ...updates, updatedAt: new Date().toISOString() };
      return this.saveEvents(events) ? events[index] : null;
    }
    return null;
  },
  
  // 删除事件
  deleteEvent(id) {
    const events = this.loadEvents();
    const filtered = events.filter(e => e.id !== id);
    const deletedCount = events.length - filtered.length;
    if (deletedCount > 0) {
      console.log(`🗑️ 删除了 ${deletedCount} 条日程 (id: ${id})`);
      return this.saveEvents(filtered);
    }
    console.log(`⚠️ 未找到要删除的日程 (id: ${id})`);
    return false;
  },
  
  // 获取指定日期的事件（包括长期任务的当日实例）
  getEventsByDate(dateStr) {
    const events = this.loadEvents();
    const result = [];
    
    events.forEach(e => {
      if (e.isRecurring) {
        // 长期任务：检查该日期是否在范围内
        if (this.isDateInRecurringRange(dateStr, e)) {
          // 创建当日实例，保留父任务引用
          const instance = {
            ...e,
            date: dateStr,
            isRecurringInstance: true,
            recurringParentId: e.id,
            isCompleted: (e.completedDates || []).includes(dateStr),
            // 计算进度信息
            progress: this.calculateRecurringProgress(e, dateStr),
          };
          result.push(instance);
        }
      } else if (e.date === dateStr) {
        result.push(e);
      }
    });
    
    return result;
  },
  
  // 检查日期是否在长期任务范围内
  isDateInRecurringRange(dateStr, event) {
    const date = new Date(dateStr);
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    
    if (date < startDate || date > endDate) {
      return false;
    }
    
    // 检查重复类型
    if (event.recurringType === 'daily') {
      return true;
    } else if (event.recurringType === 'weekly' && event.recurringDays) {
      const dayOfWeek = date.getDay();
      return event.recurringDays.includes(dayOfWeek);
    } else if (event.recurringType === 'monthly') {
      // 每月同一天
      const startDay = startDate.getDate();
      return date.getDate() === startDay;
    }
    
    return true;
  },
  
  // 计算长期任务进度
  calculateRecurringProgress(event, currentDateStr) {
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    const currentDate = new Date(currentDateStr);
    const completedDates = event.completedDates || [];
    
    // 计算总天数（根据重复类型）
    let totalDays = 0;
    let passedDays = 0;
    
    if (event.recurringType === 'daily') {
      totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
      passedDays = Math.ceil((currentDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    } else if (event.recurringType === 'weekly' && event.recurringDays) {
      // 计算周期内的特定天数
      let d = new Date(startDate);
      while (d <= endDate) {
        if (event.recurringDays.includes(d.getDay())) {
          totalDays++;
          if (d <= currentDate) passedDays++;
        }
        d.setDate(d.getDate() + 1);
      }
    }
    
    return {
      completed: completedDates.length,
      total: totalDays,
      passed: passedDays,
      percentage: totalDays > 0 ? Math.round((completedDates.length / totalDays) * 100) : 0,
    };
  },
  
  // 标记长期任务某天完成/未完成
  toggleRecurringDateComplete(parentId, dateStr) {
    const events = this.loadEvents();
    const index = events.findIndex(e => e.id === parentId);
    
    if (index !== -1 && events[index].isRecurring) {
      const completedDates = events[index].completedDates || [];
      const dateIndex = completedDates.indexOf(dateStr);
      
      if (dateIndex === -1) {
        completedDates.push(dateStr);
      } else {
        completedDates.splice(dateIndex, 1);
      }
      
      events[index].completedDates = completedDates;
      events[index].updatedAt = new Date().toISOString();
      
      return this.saveEvents(events) ? events[index] : null;
    }
    return null;
  },
  
  // 获取所有长期任务
  getRecurringEvents() {
    const events = this.loadEvents();
    return events.filter(e => e.isRecurring);
  },
  
  // 获取日期范围内的事件
  getEventsInRange(startDate, endDate) {
    const events = this.loadEvents();
    return events.filter(e => e.date >= startDate && e.date <= endDate);
  },
  
  // 获取每日任务数量统计（包括长期任务）
  getTaskCounts() {
    const events = this.loadEvents();
    const counts = {};
    
    events.forEach(e => {
      if (e.isRecurring) {
        // 长期任务：统计范围内的每一天
        const startDate = new Date(e.startDate);
        const endDate = new Date(e.endDate);
        let d = new Date(startDate);
        
        while (d <= endDate) {
          const dateStr = this.formatDate(d);
          if (this.isDateInRecurringRange(dateStr, e)) {
            counts[dateStr] = (counts[dateStr] || 0) + 1;
          }
          d.setDate(d.getDate() + 1);
        }
      } else {
        counts[e.date] = (counts[e.date] || 0) + 1;
      }
    });
    
    return counts;
  },
  
  // 格式化日期为 YYYY-MM-DD
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
};

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  togglePin: () => ipcRenderer.send('window-toggle-pin'),
  resizeWindow: (height) => ipcRenderer.send('resize-window', height),

  // 监听置顶状态变化
  onPinStatusChanged: (callback) => {
    ipcRenderer.on('pin-status-changed', (event, isPinned) => callback(isPinned));
  },

  // 监听后端就绪
  onBackendReady: (callback) => {
    ipcRenderer.on('backend-ready', (event, ready) => callback(ready));
  },

  // 开机自启动
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),
});

// 暴露 AI 服务 API（通过 Flask 后端）
contextBridge.exposeInMainWorld('aiAPI', {
  isAvailable: () => true,

  parseEvent: async (text) => {
    try {
      await backendReady;
      const resp = await httpRequest('/api/parse', 'POST', { text });
      if (!resp.ok) throw new Error(JSON.stringify(resp.data));
      return resp.data;
    } catch (err) {
      console.error('❌ AI 解析失败:', err.message);
      return null;
    }
  },

  parseImage: async (base64Data) => {
    try {
      await backendReady;
      const resp = await httpRequest('/api/parse-image', 'POST', { image: base64Data });
      if (!resp.ok) throw new Error(JSON.stringify(resp.data));
      return resp.data;
    } catch (err) {
      console.error('❌ AI 图片解析失败:', err.message);
      return null;
    }
  },

  chat: async (message, sessionId) => {
    try {
      await backendReady;
      const resp = await httpRequest('/api/chat', 'POST', { message, session_id: sessionId || 'default' });
      return resp.data;
    } catch (err) {
      console.error('❌ AI 对话失败:', err.message);
      return { message: `出错了：${err.message}`, events_changed: false };
    }
  },

  resetChat: async (sessionId) => {
    try {
      await backendReady;
      await httpRequest('/api/chat/reset', 'POST', { session_id: sessionId || 'default' });
    } catch (e) { /* ignore */ }
  },
});

// 暴露配置 API（通过 Flask 后端）
contextBridge.exposeInMainWorld('configAPI', {
  load: async () => {
    try {
      await backendReady;
      const resp = await httpRequest('/api/config', 'GET');
      return resp.data;
    } catch (e) {
      console.error('加载配置失败:', e);
      return {};
    }
  },
  save: async (config) => {
    try {
      await backendReady;
      const resp = await httpRequest('/api/config', 'PUT', config);
      return resp.data;
    } catch (e) {
      console.error('保存配置失败:', e);
      return { success: false };
    }
  },
});

// 暴露事件存储 API
contextBridge.exposeInMainWorld('eventAPI', {
  loadEvents: () => EventStore.loadEvents(),
  saveEvents: (events) => EventStore.saveEvents(events),
  addEvent: (event) => EventStore.addEvent(event),
  updateEvent: (id, updates) => EventStore.updateEvent(id, updates),
  deleteEvent: (id) => EventStore.deleteEvent(id),
  getEventsByDate: (dateStr) => EventStore.getEventsByDate(dateStr),
  getEventsInRange: (startDate, endDate) => EventStore.getEventsInRange(startDate, endDate),
  getTaskCounts: () => EventStore.getTaskCounts(),
  // 长期任务相关
  toggleRecurringDateComplete: (parentId, dateStr) => EventStore.toggleRecurringDateComplete(parentId, dateStr),
  getRecurringEvents: () => EventStore.getRecurringEvents(),
});

// 暴露农历 API
contextBridge.exposeInMainWorld('lunarAPI', {
  // 检查库是否可用
  isAvailable: () => !!Lunar,
  
  // 从公历获取农历
  fromSolar: (year, month, day) => {
    if (!Lunar) return null;
    try {
      const solar = Solar.fromYmd(year, month, day);
      const lunar = solar.getLunar();
      return {
        year: lunar.getYear(),
        month: lunar.getMonth(),
        day: lunar.getDay(),
        monthStr: lunar.getMonthInChinese() + '月',
        dayStr: lunar.getDayInChinese(),
        isLeapMonth: lunar.getMonth() < 0,
        yearGanZhi: lunar.getYearInGanZhi(),
        monthGanZhi: lunar.getMonthInGanZhi(),
        dayGanZhi: lunar.getDayInGanZhi(),
        shengXiao: lunar.getYearShengXiao(),
        jieQi: lunar.getJieQi() || null,
        festivals: lunar.getFestivals() || [],
        otherFestivals: lunar.getOtherFestivals() || [],
      };
    } catch (err) {
      console.error('农历转换错误:', err);
      return null;
    }
  },
  
  // 获取公历节日
  getSolarFestivals: (year, month, day) => {
    if (!Solar) return [];
    try {
      const solar = Solar.fromYmd(year, month, day);
      return solar.getFestivals() || [];
    } catch (err) {
      return [];
    }
  },
  
  // 获取节假日信息（调休/放假）
  getHoliday: (year, month, day) => {
    if (!HolidayUtil) return null;
    try {
      const holiday = HolidayUtil.getHoliday(year, month, day);
      if (!holiday) return null;
      return {
        name: holiday.getName(),
        isWork: holiday.isWork(),
        target: holiday.getTarget(),
      };
    } catch (err) {
      return null;
    }
  },
});

// 控制台提示
console.log('🚀 HoyoCalendar Preload Script Loaded');
