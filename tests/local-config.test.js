'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalConfig, deepMerge, defaultConfig, PROVIDER_DEFAULTS } = require('../src/core/local-config');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoyo-config-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('defaults are returned when the config file is missing', (t) => {
  const store = new LocalConfig(path.join(tempDir(t), 'config.json'));
  const config = store.load();
  assert.equal(config.ai.provider, 'doubao');
  assert.deepEqual(config.ai.doubao, PROVIDER_DEFAULTS.doubao);
});

test('load returns defaults when the file contains invalid JSON', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{not json', 'utf8');
  const store = new LocalConfig(file);
  assert.deepEqual(store.load(), defaultConfig());
});

test('save persists merged config and keeps defaults', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  const store = new LocalConfig(file);
  const saved = store.save({ cloud: { serverUrl: 'https://api.jianghaihaoyang.online' } });
  assert.equal(saved.cloud.serverUrl, 'https://api.jianghaihaoyang.online');
  assert.equal(saved.ai.provider, 'doubao');
  const reloaded = new LocalConfig(file).load();
  assert.equal(reloaded.cloud.serverUrl, 'https://api.jianghaihaoyang.online');
  assert.equal(reloaded.ai.provider, 'doubao');
});

test('save deep-merges nested updates without dropping existing keys', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  const store = new LocalConfig(file);
  store.save({ ai: { provider: 'openai' } });
  const saved = store.save({ cloud: { serverUrl: 'http://example.com' } });
  assert.equal(saved.ai.provider, 'openai');
  assert.equal(saved.cloud.serverUrl, 'http://example.com');
  assert.deepEqual(saved.ai.openai, PROVIDER_DEFAULTS.openai);
});

test('save ignores non-object updates', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  const store = new LocalConfig(file);
  const saved = store.save(null);
  assert.deepEqual(saved, defaultConfig());
});

test('deepMerge does not mutate the base object', () => {
  const base = { a: { b: 1 } };
  const merged = deepMerge(base, { a: { c: 2 } });
  assert.deepEqual(base, { a: { b: 1 } });
  assert.deepEqual(merged, { a: { b: 1, c: 2 } });
});

test('load merges stored config over defaults but tolerates unknown keys', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ cloud: { serverUrl: 'http://127.0.0.1:9000' }, custom: true }), 'utf8');
  const store = new LocalConfig(file);
  const config = store.load();
  assert.equal(config.cloud.serverUrl, 'http://127.0.0.1:9000');
  assert.equal(config.custom, true);
  assert.equal(config.ai.provider, 'doubao');
});

test('legacy loopback server url in stored config is migrated to the https default', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ cloud: { serverUrl: 'http://127.0.0.1:8000' } }), 'utf8');
  const store = new LocalConfig(file);
  const migrated = store.load();
  migrated.cloud.serverUrl = require('../src/core/cloud-api').migrateLegacyServerUrl(migrated.cloud.serverUrl);
  assert.equal(migrated.cloud.serverUrl, 'https://api.jianghaihaoyang.online');
});
