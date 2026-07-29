'use strict';

const {
  addDays,
  formatDate,
  parseDate,
  startOfDay,
} = require('./date-utils');

const WEEKDAY_MAP = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

function parseTargetDate(text, now) {
  const today = startOfDay(now);
  if (/大后天/.test(text)) return { date: addDays(today, 3), token: '大后天' };
  if (/后天/.test(text)) return { date: addDays(today, 2), token: '后天' };
  if (/明天/.test(text)) return { date: addDays(today, 1), token: '明天' };
  if (/今天|今日/.test(text)) return { date: today, token: /今日/.test(text) ? '今日' : '今天' };

  const fullDate = text.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/);
  if (fullDate) {
    const explicitYear = Number(fullDate[1] || 0);
    const month = Number(fullDate[2]) - 1;
    const day = Number(fullDate[3]);
    let year = explicitYear || today.getFullYear();
    let candidate = new Date(year, month, day);
    if (!explicitYear && candidate < today) candidate = new Date(year + 1, month, day);
    if (!Number.isNaN(candidate.getTime())) {
      return { date: candidate, token: fullDate[0] };
    }
  }

  const weekday = text.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);
  if (weekday) {
    const targetDay = WEEKDAY_MAP[weekday[2]];
    let delta = (targetDay - today.getDay() + 7) % 7;
    if (weekday[1] === '下周') delta += 7;
    else if (delta === 0 && weekday[1] === '周') delta = 7;
    return { date: addDays(today, delta), token: weekday[0] };
  }

  const dayOnly = text.match(/(?:^|\s|在|到|截止)(\d{1,2})\s*(?:日|号)(?=\s|前|之前|截止|$)/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let candidate = new Date(today.getFullYear(), today.getMonth(), day);
    if (candidate < today) candidate = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return { date: candidate, token: dayOnly[0].trim() };
  }

  return { date: today, token: '' };
}

function parseTime(text) {
  const periodTime = text.match(/(?:(上午|下午|晚上|中午|早上|早晨)\s*)?(\d{1,2})\s*(?:点|时)(?:\s*(半|\d{1,2}\s*分?))?/);
  if (periodTime) {
    let hour = Number(periodTime[2]);
    const period = periodTime[1] || '';
    if ((period === '下午' || period === '晚上') && hour < 12) hour += 12;
    if (period === '中午' && hour < 11) hour += 12;
    const minuteText = periodTime[3] || '';
    const minute = minuteText.includes('半')
      ? 30
      : Number(minuteText.replace(/\D/g, '') || 0);
    if (hour <= 23 && minute <= 59) {
      return {
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        token: periodTime[0],
      };
    }
  }

  const colonTime = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (colonTime) {
    return {
      time: `${String(colonTime[1]).padStart(2, '0')}:${colonTime[2]}`,
      token: colonTime[0],
    };
  }
  return { time: '', token: '' };
}

function parseDuration(text) {
  const halfHour = text.match(/半\s*(?:个)?\s*小时/);
  if (halfHour) return { minutes: 30, token: halfHour[0] };
  const duration = text.match(/(\d+(?:\.\d+)?)\s*(小时|分钟)/);
  if (!duration) return { minutes: 0, token: '' };
  const value = Number(duration[1]);
  return {
    minutes: duration[2] === '小时' ? Math.round(value * 60) : Math.round(value),
    token: duration[0],
  };
}

function isDeadlineExpression(text) {
  if (/(?:截止|deadline|before|\bby\b)/i.test(text)) return true;
  return /(?:今天|明天|后天|大后天|(?:下周|本周|这周|周|星期)[一二三四五六日天]|(?:(?:\d{4})\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?|\d{1,2}\s*(?:日|号))\s*(?:之前|以前|前(?!往|进|面))/.test(text);
}

function cleanTitle(text, tokens, options = {}) {
  let title = String(text || '');
  for (const token of tokens.filter(Boolean).sort((a, b) => b.length - a.length)) {
    title = title.replace(token, ' ');
  }
  title = title
    .replace(/每周(?:周?[一二三四五六日天](?:和|、|,)?\s*)+/g, ' ')
    .replace(/(?:请|帮我|麻烦|添加|新增|创建|安排|记下|提醒我)/g, ' ')
    .replace(/(?:每天|每日|每晚|每周|每月)/g, ' ')
    .replace(/[，,。！？!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (options.isDeadline) {
    title = title
      .replace(/(?:截止前|之前|以前|截止|deadline|before|\bby\b|前)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (options.isRecurring) {
    title = title
      .replace(/(?:持续|一直到|直到|从今天开始|从现在开始)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return title || '新日程';
}

function parseQuickCommand(input, options = {}) {
  const text = String(input || '').trim();
  const now = options.now ? startOfDay(options.now) : startOfDay(new Date());
  const contextDate = parseDate(options.contextDate) || now;
  if (!text) return { intent: 'empty', confidence: 0, text };

  const asksQuestion = /(?:有什么|有哪些|几项|查询|查看|告诉我|空闲|冲突)/.test(text)
    || /(?:安排|日程)(?:吗|呢)?[?？]?\s*$/.test(text);
  const mutatesExisting = /(?:删除|取消|移到|改到|改成|推迟|提前|重命名|修改|批量|完成哪些)/.test(text);
  if (asksQuestion) {
    const target = parseTargetDate(text, contextDate);
    return {
      intent: 'query',
      confidence: 0.96,
      date: formatDate(target.date),
      text,
      requiresAgent: false,
    };
  }
  if (mutatesExisting) {
    return {
      intent: 'agent',
      confidence: 0.92,
      text,
      requiresAgent: true,
      reason: 'existing_event_mutation',
    };
  }

  const dateResult = parseTargetDate(text, contextDate);
  const timeResult = parseTime(text);
  const durationResult = parseDuration(text);
  const isDeadline = isDeadlineExpression(text);
  const isRecurring = !isDeadline && /(?:每天|每日|每晚|每周|每月)/.test(text);
  const recurringType = /每周/.test(text) ? 'weekly' : (/每月/.test(text) ? 'monthly' : 'daily');
  const recurringDays = [];
  if (recurringType === 'weekly') {
    for (const match of text.matchAll(/(?:周|星期)([一二三四五六日天])/g)) {
      recurringDays.push(WEEKDAY_MAP[match[1]]);
    }
  }

  let endDate = '';
  const endMatch = text.match(/(?:持续到|一直到|直到|到)\s*((?:(?:\d{4})\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?)/);
  if (endMatch) {
    endDate = formatDate(parseTargetDate(endMatch[1], now).date);
  }

  const title = cleanTitle(text, [
    isRecurring ? '' : dateResult.token,
    timeResult.token,
    durationResult.token,
    endMatch?.[0] || '',
  ], { isDeadline, isRecurring });
  const targetDate = formatDate(dateResult.date || contextDate);
  const event = {
    event: title,
    date: isDeadline ? formatDate(now) : targetDate,
    time: timeResult.time,
    location: '',
    urgency: /(?:紧急|重要|尽快)/.test(text) ? 'high' : 'normal',
  };

  if (durationResult.minutes > 0) event.targetDurationMinutes = durationResult.minutes;
  if (isDeadline) {
    event.isDeadline = true;
    event.startDate = formatDate(now);
    event.deadlineDate = targetDate;
  } else if (isRecurring) {
    event.isRecurring = true;
    event.startDate = targetDate;
    event.endDate = endDate || formatDate(addDays(dateResult.date || now, 30));
    event.recurringType = recurringType;
    if (recurringDays.length) event.recurringDays = [...new Set(recurringDays)];
  }

  return {
    intent: 'create',
    confidence: dateResult.token || timeResult.token || isDeadline || isRecurring ? 0.96 : 0.78,
    text,
    event,
    tokens: {
      date: targetDate,
      time: timeResult.time,
      duration: durationResult.minutes,
      deadline: isDeadline,
      recurring: isRecurring,
    },
    requiresAgent: false,
  };
}

module.exports = {
  parseQuickCommand,
};
