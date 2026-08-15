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

// ------------------------------------------------------------------ recurring weekday editing

test('detail dialog renders a weekday picker with all seven days', () => {
  assert.match(rendererSource, /data-weekday-picker/);
  assert.match(rendererSource, /SHORT_DAY_NAMES\.map\(\(name, day\) =>/);
  assert.match(rendererSource, /data-weekday="\$\{day\}"/);
});

test('weekday picker prefills the selected days from the recurring rule', () => {
  assert.match(
    rendererSource,
    /class="weekday-chip \$\{\(event\.recurringDays \|\| \[\]\)\.includes\(day\) \? 'selected' : ''\}"/,
  );
  assert.match(
    rendererSource,
    /aria-pressed="\$\{\(event\.recurringDays \|\| \[\]\)\.includes\(day\)\}"/,
  );
});

test('weekday picker field is visible only for weekly recurring type', () => {
  assert.match(
    rendererSource,
    /data-recurring-weekday-field[\s\S]*?\$\{type === 'recurring' && event\.recurringType === 'weekly' \? '' : 'hidden'\}/,
  );
});

test('changing the recurring type toggles the weekday field visibility', () => {
  assert.match(
    rendererSource,
    /\$\$\('\[data-recurring-weekday-field\]', form\)\.forEach\(\(field\) => \{\s*field\.hidden = !weekly;\s*\}\)/,
  );
  assert.match(
    rendererSource,
    /const recurringType = form\.querySelector\('\[name="recurringType"\]'\)\?\.value \|\| 'daily';/,
  );
});

test('clicking a weekday chip toggles its selected state', () => {
  assert.match(
    rendererSource,
    /const weekdayChip = event\.target\.closest\('\[data-weekday\]'\);/,
  );
  assert.match(
    rendererSource,
    /const selected = weekdayChip\.classList\.toggle\('selected'\);/,
  );
  assert.match(
    rendererSource,
    /weekdayChip\.setAttribute\('aria-pressed', String\(selected\)\);/,
  );
});

test('saving a weekly recurring task persists the selected weekdays', () => {
  assert.match(
    rendererSource,
    /const selectedDays = \$\$\('\[data-weekday\]', form\)[\s\S]*?\.filter\(\(chip\) => chip\.classList\.contains\('selected'\)\)[\s\S]*?\.map\(\(chip\) => Number\(chip\.dataset\.weekday\)\)/,
  );
  assert.match(
    rendererSource,
    /recurringDays: recurringType === 'weekly' \? selectedDays : \[\],/,
  );
});

// ------------------------------------------------------------------ monthly day picker

test('detail dialog renders a 1-31 day picker for monthly recurring tasks', () => {
  assert.match(rendererSource, /data-monthday-picker/);
  assert.match(rendererSource, /Array\.from\(\{ length: 31 \}, \(_, index\) => index \+ 1\)/);
  assert.match(rendererSource, /data-monthday="\$\{day\}"/);
});

test('month day picker prefills existing days or the start day', () => {
  assert.match(
    rendererSource,
    /const monthDays = Array\.isArray\(event\.recurringMonthDays\) && event\.recurringMonthDays\.length[\s\S]*?\? event\.recurringMonthDays[\s\S]*?: \[parseDateKey\(baseDate\)\.getDate\(\)\]/,
  );
  assert.match(
    rendererSource,
    /class="weekday-chip \$\{monthDays\.includes\(day\) \? 'selected' : ''\}"/,
  );
});

test('month day picker field is visible only for monthly recurring type', () => {
  assert.match(
    rendererSource,
    /data-recurring-monthday-field[\s\S]*?\$\{type === 'recurring' && event\.recurringType === 'monthly' \? '' : 'hidden'\}/,
  );
});

test('changing recurring type toggles both weekday and month-day fields', () => {
  assert.match(
    rendererSource,
    /\$\$\('\[data-recurring-monthday-field\]', form\)\.forEach\(\(field\) => \{\s*field\.hidden = !monthly;\s*\}\)/,
  );
  assert.match(rendererSource, /const monthly = recurringTypeSelect\.value === 'monthly';/);
});

test('clicking a month-day chip toggles its selected state', () => {
  assert.match(
    rendererSource,
    /const monthdayChip = event\.target\.closest\('\[data-monthday\]'\);/,
  );
  assert.match(rendererSource, /monthdayChip\.classList\.toggle\('selected'\)/);
});

test('saving a monthly recurring task persists the selected day numbers', () => {
  assert.match(
    rendererSource,
    /const selectedMonthDays = \$\$\('\[data-monthday\]', form\)[\s\S]*?\.map\(\(chip\) => Number\(chip\.dataset\.monthday\)\)/,
  );
  assert.match(
    rendererSource,
    /recurringMonthDays: recurringType === 'monthly' \? selectedMonthDays : \[\],/,
  );
});

test('recurrence label shows monthly day numbers', () => {
  assert.match(
    rendererSource,
    /const days = \(event\.recurringMonthDays \|\| \[\]\)[\s\S]*?\.sort\(\(a, b\) => a - b\)/,
  );
  assert.match(rendererSource, /return days\.length \? `每月\$\{days\.join\('、'\)\}日` : '每月';/);
});

// ------------------------------------------------------------------ focus timer progress bar

test('task rows render a focus-timer progress bar between title and meta', () => {
  assert.match(
    rendererSource,
    /\$\{event\.targetDurationMinutes \? timerBarMarkup\(event\) : ''\}/,
  );
  assert.match(rendererSource, /data-timer-progress/);
  assert.match(rendererSource, /class="timer-progress-fill" style="width: \$\{pct\}%"/);
});

test('progress bar reads persisted timer state and caps at 100%', () => {
  assert.match(
    rendererSource,
    /const total = Math\.max\(1, Number\(event\.targetDurationMinutes\) \* 60\);/,
  );
  assert.match(
    rendererSource,
    /const pct = completed \? 100 : Math\.min\(100, Math\.round\(\(used \/ total\) \* 100\)\);/,
  );
  assert.match(
    rendererSource,
    /data-base-seconds="\$\{Number\(record\?\.elapsedSeconds\) \|\| 0\}"/,
  );
  assert.match(rendererSource, /data-completed="\$\{completed\}"/);
});

test('timer tick updates progress fills in real time and stops when paused', () => {
  assert.match(
    rendererSource,
    /\$\$\('\[data-timer-progress\]'\)\.forEach\(\(element\) => \{/,
  );
  assert.match(
    rendererSource,
    /const pct = element\.dataset\.completed === 'true'\s*\?\s*100\s*:\s*Math\.min\(100, Math\.round\(\(seconds \/ total\) \* 100\)\);/,
  );
  assert.match(rendererSource, /fill\.style\.width = `\$\{pct\}%`;/);
  assert.match(rendererSource, /setInterval\(updateTimerReadouts, 1000\)/);
});

// ------------------------------------------------------------------ login persistence wiring

test('startup restores the session before sync can run', () => {
  const initCloud = preloadSource.match(/async function initCloud\(\) \{[\s\S]*?\n\}/);
  assert.ok(initCloud, 'initCloud should exist in preload');
  assert.match(initCloud[0], /syncEngine\.restoreSession\(\)/);
});

test('preload event bridge clears credentials on logout via signOut', () => {
  assert.match(preloadSource, /logout: async \(\) => \{[\s\S]*?syncEngine\.signOut\(\)/);
});
