'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

// ------------------------------------------------------------------ return button

test('main header contains a return-today button with a mutable label', () => {
  assert.match(indexHtml, /id="returnTodayButton"/);
  assert.match(indexHtml, /id="returnTodayLabel"/);
  const block = indexHtml.match(/<button class="text-btn return-today-button" id="returnTodayButton"[\s\S]*?<\/button>/);
  assert.ok(block, 'return button markup should exist');
  assert.match(block[0], /data-lucide="undo-2"/);
});

test('return button is hidden by default via visibility so layout does not jump', () => {
  assert.match(stylesSource, /\.return-today-button\s*\{\s*visibility:\s*hidden;/);
  assert.match(stylesSource, /\.return-today-button\.visible\s*\{\s*visibility:\s*visible;/);
});

test('renderer toggles the return button visible only when today is outside the view range', () => {
  assert.match(
    rendererSource,
    /button\.classList\.toggle\('visible', !inRange\)/,
  );
  assert.match(
    rendererSource,
    /const inRange = viewRangeIncludesDateFor\(state\.currentView, state\.selectedDate, realToday\)/,
  );
});

test('return button label follows the view mode: 今天 / 本周 / 本月', () => {
  assert.match(rendererSource, /const VIEW_RETURN_LABELS = \{ day: '今天', week: '本周', month: '本月' \};/);
  assert.match(rendererSource, /`返回\$\{VIEW_RETURN_LABELS\[state\.currentView\] \|\| '今天'\}`/);
});

test('return button click goes back to today without changing the view mode', () => {
  assert.match(
    rendererSource,
    /\$\('#returnTodayButton'\)\.addEventListener\('click', \(\) => selectDate\(realToday\)\);/,
  );
});

test('view range helpers are exposed to the renderer through a preload bridge', () => {
  assert.match(preloadSource, /const \{ viewRange, viewRangeIncludesDate, viewRangeTitle \} = require\('\.\/src\/core\/date-utils'\);/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('viewUtils'/);
  assert.match(preloadSource, /viewRangeIncludesDate: \(view, value, target\) => viewRangeIncludesDate\(view, value, target\)/);
});

// ------------------------------------------------------------------ year in view titles

test('main view title always renders the year via viewRangeTitleFor', () => {
  assert.match(rendererSource, /\$\('#mainDateTitle'\)\.textContent = viewTitleText\(\);/);
  assert.match(rendererSource, /const base = viewRangeTitleFor\(state\.currentView, selected\);/);
  assert.match(rendererSource, /`\$\{start\.getFullYear\(\)\}年\$\{monthDay\(start\)\}`/);
});

test('cross-year week titles render both years in the renderer fallback', () => {
  assert.match(
    rendererSource,
    /if \(start\.getFullYear\(\) !== end\.getFullYear\(\)\) \{\s*return `\$\{start\.getFullYear\(\)\}年\$\{monthDay\(start\)\} – \$\{end\.getFullYear\(\)\}年\$\{monthDay\(end\)\}`;\s*\}/,
  );
});

test('day view title appends the weekday and a 今天 prefix on the current date', () => {
  assert.match(rendererSource, /const text = `\$\{base\} \$\{DAY_NAMES\[selected\.getDay\(\)\]\}`;/);
  assert.match(rendererSource, /sameDay\(selected, realToday\) \? `今天 · \$\{text\}` : text/);
});

// ------------------------------------------------------------------ task type in the detail dialog

test('detail dialog shows Deadline with explicit date and time', () => {
  assert.match(
    rendererSource,
    /`Deadline · 截止 \$\{dateText\}\$\{timeText\} · \$\{calendar\}`/,
  );
  assert.match(rendererSource, /const timeText = event\.time \? ` \$\{event\.time\}` : '';/);
  assert.match(rendererSource, /year: 'numeric', month: 'long', day: 'numeric'/);
});

test('detail dialog shows the recurrence rule and end date for recurring tasks', () => {
  assert.match(rendererSource, /`重复任务 · \$\{recurrenceLabel\(event\)\}\$\{until\} · \$\{calendar\}`/);
  assert.match(rendererSource, /const until = event\.endDate/);
});

test('normal tasks are labeled 普通任务 in the detail dialog', () => {
  assert.match(rendererSource, /return `普通任务 · \$\{calendar\}`;/);
});

test('recurrence label includes concrete weekly days', () => {
  assert.match(
    rendererSource,
    /const days = \(event\.recurringDays \|\| \[\]\)[\s\S]*?\.join\('、'\)/,
  );
  assert.match(rendererSource, /return days \? `每周\$\{days\}` : '每周';/);
});
