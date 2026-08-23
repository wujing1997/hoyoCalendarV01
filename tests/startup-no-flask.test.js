'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

test('main.js no longer auto-starts the local Flask backend', () => {
  assert.doesNotMatch(mainSource, /startBackend/);
  assert.doesNotMatch(mainSource, /waitForBackend/);
  assert.doesNotMatch(mainSource, /stopBackend/);
  assert.doesNotMatch(mainSource, /backend\/app\.py/);
  assert.doesNotMatch(mainSource, /Backend readiness/);
  assert.doesNotMatch(mainSource, /backend-ready/);
  assert.doesNotMatch(mainSource, /get-backend-port/);
  assert.doesNotMatch(mainSource, /require\(['"]child_process['"]\)/);
});

test('preload.js no longer depends on a local backend process', () => {
  assert.doesNotMatch(preloadSource, /get-backend-port/);
  assert.doesNotMatch(preloadSource, /backend-ready/);
  assert.doesNotMatch(preloadSource, /onBackendReady/);
  assert.doesNotMatch(preloadSource, /require\(['"]http['"]\)/);
});

test('renderer.js no longer listens for backend readiness', () => {
  assert.doesNotMatch(rendererSource, /onBackendReady/);
});

test('main.js exposes local config IPC for cloud server settings', () => {
  assert.match(mainSource, /config-load/);
  assert.match(mainSource, /config-save/);
  assert.match(mainSource, /src\/core\/local-config/);
});

test('preload.js reads cloud config through IPC instead of a local HTTP service', () => {
  assert.match(preloadSource, /ipcRenderer\.invoke\(['"]config-load['"]\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\(['"]config-save['"]\s*,/);
  assert.doesNotMatch(preloadSource, /httpRequest/);
});
