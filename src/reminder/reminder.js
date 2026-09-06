'use strict';
const card = document.querySelector('#card');
let currentKey = null;
let closing = false;
window.reminderAPI.subscribe(({ reminder, remaining, theme }) => {
  document.body.dataset.theme = theme;
  if (!reminder) { currentKey = null; return; }
  const changed = currentKey !== reminder.key;
  currentKey = reminder.key;
  document.querySelector('#title').textContent = reminder.title;
  document.querySelector('#title').title = reminder.title;
  document.querySelector('#time').textContent = reminder.time;
  document.querySelector('#calendar').textContent = reminder.calendar;
  document.querySelector('#remaining').textContent = remaining ? `还有 ${remaining} 条` : '';
  if (changed) {
    closing = false;
    card.className = '';
    void card.offsetWidth;
    card.className = 'enter';
  }
});
card.addEventListener('click', async () => {
  if (closing || !currentKey) return;
  closing = true;
  const key = currentKey;
  card.className = 'leave';
  await new Promise((resolve) => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 160));
  try { await window.reminderAPI.acknowledge(key); }
  catch (_) { document.querySelector('#hint').textContent = '保存失败，请再次单击'; }
  if (currentKey === key) { closing = false; card.className = ''; }
});
window.reminderAPI.ready();
