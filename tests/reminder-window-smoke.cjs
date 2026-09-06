'use strict';
// Run with node_modules/.bin/electron tests/reminder-window-smoke.cjs.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hoyo-reminder-ui-'));
process.env.APPDATA = sandbox;
process.env.HOYO_ALLOW_MULTIPLE_INSTANCES = '1';
app.setPath('userData', path.join(sandbox, 'electron'));
const { EventStore } = require('../src/core/event-store');
const { formatDate } = require('../src/core/date-utils');
const store = new EventStore({ dataDir: path.join(sandbox, 'HoyoCalendar') });
const today = formatDate(new Date());
store.addEvent({ event: '项目会议：确认本周日程安排与任务进度', date: today, time: '00:00', calendar: '工作' });
store.addEvent({ event: '准备会议材料', date: today, time: '00:01', calendar: '个人' });
require('../main');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    await delay(2500);
    const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html') && !w.webContents.getURL().includes('/src/reminder/'));
    const popup = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/src/reminder/'));
    assert(main && popup);
    assert(popup.isVisible());
    assert(popup.isFocusable(), 'The reminder must accept real mouse clicks');
    assert(!popup.isFocused(), 'Showing a reminder must not steal keyboard focus');
    const bounds = popup.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    // Windows rounds physical pixels at fractional display scaling.
    assert(Math.abs(bounds.x + bounds.width + 16 - area.x - area.width) <= 1);
    assert(Math.abs(bounds.y - area.y - 16) <= 1);
    main.setBounds({ width: 430, height: 740 });
    screen.emit('display-metrics-changed');
    assert.deepEqual(popup.getBounds(), bounds);
    assert.equal(await popup.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
    await fs.promises.writeFile(path.join(sandbox, 'light.png'), (await popup.webContents.capturePage()).toPNG());
    await main.webContents.executeJavaScript('window.electronAPI.setReminderTheme("dark")');
    await delay(100);
    assert.equal(await popup.webContents.executeJavaScript('document.body.dataset.theme'), 'dark');
    await fs.promises.writeFile(path.join(sandbox, 'dark.png'), (await popup.webContents.capturePage()).toPNG());
    main.close();
    assert(!main.isDestroyed() && !main.isVisible());
    assert(popup.isVisible());
    if (process.env.HOYO_NATIVE_CLICK_TEST === '1') {
      console.log('Waiting for two native clicks on the reminder cards:', sandbox);
      const deadline = Date.now() + 120000;
      while (popup.isVisible() && Date.now() < deadline) await delay(250);
      assert(!popup.isVisible(), 'Native clicks must dismiss both reminders');
      assert(store.loadEvents().every((event) => !event.isCompleted), 'Acknowledgement must not complete tasks');
      assert.equal(JSON.parse(fs.readFileSync(path.join(sandbox, 'HoyoCalendar/reminder-confirmations.json'), 'utf8')).length, 2);
      console.log('Native click test passed; tasks remain incomplete');
      app.quit();
      return;
    }
    const click = async (x, y) => {
      popup.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      await delay(50);
      popup.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      popup.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await delay(400);
    };
    await click(170, 100);
    assert(popup.isVisible());
    assert.equal(await popup.webContents.executeJavaScript('document.querySelector("#remaining").textContent'), '');
    await click(12, 100);
    assert(!popup.isVisible());
    assert.equal(JSON.parse(fs.readFileSync(path.join(sandbox, 'HoyoCalendar/reminder-confirmations.json'), 'utf8')).length, 2);
    console.log('Reminder window smoke passed; screenshots:', sandbox);
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
