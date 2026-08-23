'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('account overlay header provides an × close button (same pattern as settings)', () => {
  const accountClose = indexHtml.match(/id="accountOverlay"[\s\S]*?data-close-overlay="accountOverlay"/);
  assert.ok(accountClose, 'accountOverlay should contain a button with data-close-overlay="accountOverlay"');
  assert.match(indexHtml, /<button class="icon-btn small" data-close-overlay="accountOverlay"/);
});

test('settings overlay uses the identical close-button convention', () => {
  assert.match(indexHtml, /<button class="icon-btn small" data-close-overlay="settingsOverlay"/);
});

test('× clicks are handled by document-level delegation for every overlay', () => {
  assert.match(
    rendererSource,
    /document\.addEventListener\('click', \(event\) => \{[\s\S]*?closest\('\[data-close-overlay\]'\)[\s\S]*?closeOverlay\(button\.dataset\.closeOverlay\)/,
  );
});

test('Escape key closes the account overlay along with the other overlays', () => {
  const escapeBlock = rendererSource.match(/event\.key === 'Escape'[\s\S]*?closeMobileDetails\(\)/);
  assert.ok(escapeBlock, 'Escape handler should exist');
  assert.match(escapeBlock[0], /closeOverlay\('accountOverlay'\)/);
});

test('backdrop click closes an overlay when the click lands on the overlay itself', () => {
  assert.match(
    rendererSource,
    /\$\$\('\.overlay'\)\.forEach[\s\S]*?if \(event\.target === overlay\) closeOverlay\(overlay\.id\)/,
  );
});

test('login mode is the default and register mode starts hidden', () => {
  assert.match(rendererSource, /<form class="account-form" id="loginForm" data-account-form="login">/);
  assert.match(rendererSource, /<form class="account-form hidden" id="registerForm" data-account-form="register">/);
});

test('mode tabs toggle visibility of exactly one form at a time', () => {
  const tabSwitch = rendererSource.match(
    /\$\$\('\[data-account-form\]', \$\('#accountContent'\)\)\.forEach[\s\S]*?\}\);/,
  );
  assert.ok(tabSwitch, 'tab switch should toggle the two account forms');
  assert.match(tabSwitch[0], /form\.classList\.toggle\('hidden', form\.dataset\.accountForm !== tab\.dataset\.accountTab\)/);
});

test('login mode shows only its own fields, primary button and error hint', () => {
  const loginForm = rendererSource.match(/<form class="account-form" id="loginForm"[^>]*>[\s\S]*?<\/form>/);
  assert.ok(loginForm);
  assert.match(loginForm[0], /name="email"/);
  assert.match(loginForm[0], /name="password"/);
  assert.match(loginForm[0], /id="accountError"/);
  assert.match(loginForm[0], /type="submit">登录<\/button>/);
  assert.doesNotMatch(loginForm[0], /name="inviteCode"/);
});

test('register mode shows only its own fields, primary button and error hint', () => {
  const registerForm = rendererSource.match(/<form class="account-form hidden" id="registerForm"[^>]*>[\s\S]*?<\/form>/);
  assert.ok(registerForm);
  assert.match(registerForm[0], /name="inviteCode"/);
  assert.match(registerForm[0], /name="email"/);
  assert.match(registerForm[0], /name="password"/);
  assert.match(registerForm[0], /id="registerError"/);
  assert.match(registerForm[0], /type="submit">注册并登录<\/button>/);
});

test('the hidden class is actually styled (display none) so modes do not stack', () => {
  assert.match(stylesSource, /\.hidden\s*\{[\s\S]*?display:\s*none\s*!important;\s*\}/);
  assert.match(stylesSource, /\[hidden\][\s\S]*?display:\s*none\s*!important;/);
});
