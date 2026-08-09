'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  let adminToken = null;
  let adminUsername = null;

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (adminToken) headers.authorization = `Bearer ${adminToken}`;
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }
    return { ok: response.ok, status: response.status, data };
  }

  function showError(message) {
    const element = $('#globalError');
    element.textContent = message;
    element.hidden = false;
  }

  function clearError() {
    $('#globalError').hidden = true;
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function statusBadge(status) {
    const classes = { active: 'active', unused: 'unused', disabled: 'disabled', used: 'used', revoked: 'revoked', expired: 'expired' };
    const labels = { active: '启用', disabled: '禁用', unused: '未使用', used: '已使用', revoked: '已撤销', expired: '已过期' };
    return `<span class="badge ${classes[status] || ''}">${labels[status] || status}</span>`;
  }

  function requireLogin() {
    if (!adminToken) {
      $('#appPanel').hidden = true;
      $('#topbarRight').hidden = true;
      $('#loginPanel').hidden = false;
      return false;
    }
    return true;
  }

  async function handleAuthFailure(response) {
    if (response.status === 401) {
      adminToken = null;
      sessionStorage.removeItem('hoyo-admin-token');
      $('#loginPanel').hidden = false;
      $('#appPanel').hidden = true;
      $('#topbarRight').hidden = true;
      return true;
    }
    return false;
  }

  async function login(event) {
    event.preventDefault();
    clearError();
    const formData = Object.fromEntries(new FormData(event.target).entries());
    const button = event.target.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/v1/admin/login', {
        method: 'POST',
        body: { username: formData.username, password: formData.password },
      });
      if (!result.ok) {
        $('#loginError').textContent = result.data?.detail || '登录失败，请检查用户名与密码';
        $('#loginError').hidden = false;
        return;
      }
      adminToken = result.data.token;
      adminUsername = formData.username;
      sessionStorage.setItem('hoyo-admin-token', adminToken);
      sessionStorage.setItem('hoyo-admin-user', adminUsername);
      event.target.reset();
      enterApp();
    } catch (error) {
      $('#loginError').textContent = '无法连接管理 API，请确认已通过 SSH 隧道访问。';
      $('#loginError').hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try {
      await api('/api/v1/admin/logout', { method: 'POST', body: {} });
    } catch (_) {
      // 本地退出不受服务器状态影响
    }
    adminToken = null;
    sessionStorage.removeItem('hoyo-admin-token');
    sessionStorage.removeItem('hoyo-admin-user');
    $('#loginPanel').hidden = false;
    $('#appPanel').hidden = true;
    $('#topbarRight').hidden = true;
  }

  function enterApp() {
    $('#loginPanel').hidden = true;
    $('#appPanel').hidden = false;
    $('#topbarRight').hidden = false;
    $('#adminUser').textContent = adminUsername || '';
    clearError();
    switchTab('invites');
  }

  function switchTab(name) {
    $$('.tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === name);
    });
    $$('.tab-panel').forEach((panel) => {
      panel.hidden = panel.id !== `panel-${name}`;
    });
    if (name === 'invites') loadInvites();
    if (name === 'users') loadUsers();
    if (name === 'usage') loadUsage();
    if (name === 'settings') loadSettings();
    if (name === 'audit') loadAudit();
  }

  async function loadInvites() {
    const response = await api('/api/v1/admin/invites');
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '获取邀请码列表失败');
      return;
    }
    clearError();
    const body = $('#inviteTableBody');
    const items = response.data || [];
    body.innerHTML = items.length ? items.map((invite) => `
      <tr>
        <td>${invite.id}</td>
        <td>${statusBadge(invite.status)}</td>
        <td>${invite.use_count || 0} / ${invite.max_uses || 1}</td>
        <td>${invite.expires_at ? escapeHtml(String(invite.expires_at).slice(0, 10)) : '-'}</td>
        <td class="mono">${invite.used_by_user_id ? escapeHtml(String(invite.used_by_user_id).slice(0, 8)) : '-'}</td>
        <td>${formatDate(invite.created_at)}</td>
        <td>
          ${invite.status === 'unused' ? `<button class="btn danger" data-revoke-invite="${invite.id}">撤销</button>` : '-'}
        </td>
      </tr>
    `).join('') : '<tr><td colspan="7">暂无邀请码</td></tr>';
  }

  async function createInvite() {
    const maxUses = Number($('#inviteMaxUses').value) || 1;
    const expiresDays = Number($('#inviteExpiresDays').value) || 30;
    const response = await api('/api/v1/admin/invites', {
      method: 'POST',
      body: { max_uses: maxUses, expires_days: expiresDays },
    });
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '生成邀请码失败');
      return;
    }
    clearError();
    $('#inviteCodeText').textContent = response.data.code;
    $('#inviteResult').hidden = false;
    $('#inviteCreate').hidden = true;
    loadInvites();
  }

  async function revokeInvite(id) {
    const response = await api(`/api/v1/admin/invites/${id}`, { method: 'DELETE' });
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '撤销邀请码失败');
      return;
    }
    clearError();
    loadInvites();
  }

  async function loadUsers() {
    const response = await api('/api/v1/admin/users');
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '获取用户列表失败');
      return;
    }
    clearError();
    const body = $('#userTableBody');
    const items = response.data || [];
    body.innerHTML = items.length ? items.map((user) => `
      <tr>
        <td>${escapeHtml(user.email)}</td>
        <td>${statusBadge(user.status)}</td>
        <td>${user.device_count || 0}</td>
        <td>${formatDate(user.created_at)}</td>
        <td>
          <button class="btn ${user.status === 'active' ? 'danger' : ''}" data-toggle-user="${user.id}" data-user-status="${user.status}">
            ${user.status === 'active' ? '禁用' : '启用'}
          </button>
          <button class="btn" data-revoke-user-sessions="${user.id}">撤销会话</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5">暂无用户</td></tr>';
  }

  async function toggleUser(id, currentStatus) {
    const response = await api(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: { status: currentStatus === 'active' ? 'disabled' : 'active' },
    });
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '更新用户状态失败');
      return;
    }
    clearError();
    loadUsers();
  }

  async function revokeUserSessions(id) {
    const response = await api(`/api/v1/admin/users/${id}/revoke-sessions`, { method: 'POST', body: {} });
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '撤销会话失败');
      return;
    }
    clearError();
    loadUsers();
  }

  async function loadUsage() {
    const days = $('#usageDays').value;
    const response = await api(`/api/v1/admin/usage?days=${days}`);
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '获取用量失败');
      return;
    }
    clearError();
    const usage = response.data || {};
    $('#usageStats').innerHTML = `
      <div class="stat-card"><strong>${usage.total_request_count || 0}</strong><span>请求数</span></div>
      <div class="stat-card"><strong>${usage.total_prompt_tokens || 0}</strong><span>输入 tokens</span></div>
      <div class="stat-card"><strong>${usage.total_completion_tokens || 0}</strong><span>输出 tokens</span></div>
      <div class="stat-card"><strong>$${Number(usage.total_cost_usd || 0).toFixed(4)}</strong><span>估算费用</span></div>
    `;
    const perDay = usage.per_day || [];
    $('#usageDayBody').innerHTML = perDay.length ? perDay.map((day) => `
      <tr>
        <td>${escapeHtml(day.date)}</td>
        <td>${day.request_count || 0}</td>
        <td>${day.total_prompt_tokens || 0}</td>
        <td>${day.total_completion_tokens || 0}</td>
        <td>$${Number(day.estimated_cost_usd || 0).toFixed(4)}</td>
      </tr>
    `).join('') : '<tr><td colspan="5">暂无用量记录</td></tr>';
    const perUser = usage.per_user || [];
    $('#usageUserBody').innerHTML = perUser.length ? perUser.map((user) => `
      <tr>
        <td>${escapeHtml(user.email)}</td>
        <td>${user.request_count || 0}</td>
        <td>$${Number(user.total_cost_usd || 0).toFixed(4)}</td>
      </tr>
    `).join('') : '<tr><td colspan="3">暂无按用户用量</td></tr>';
  }

  async function loadSettings() {
    const response = await api('/api/v1/admin/settings');
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '获取设置失败');
      return;
    }
    clearError();
    $('#aiEnabled').checked = response.data.ai_enabled !== false;
    $('#aiBudget').value = response.data.ai_monthly_budget_usd ?? 0;
  }

  async function saveSettings(event) {
    event.preventDefault();
    const response = await api('/api/v1/admin/settings', {
      method: 'PUT',
      body: {
        ai_enabled: $('#aiEnabled').checked,
        ai_monthly_budget_usd: Number($('#aiBudget').value) || 0,
      },
    });
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '保存设置失败');
      return;
    }
    clearError();
    loadSettings();
  }

  async function loadAudit() {
    const limit = $('#auditLimit').value;
    const response = await api(`/api/v1/admin/audit?limit=${limit}`);
    if (await handleAuthFailure(response)) return;
    if (!response.ok) {
      showError(response.data?.detail || '获取审计日志失败');
      return;
    }
    clearError();
    const items = response.data || [];
    $('#auditBody').innerHTML = items.length ? items.map((entry) => `
      <tr>
        <td>${formatDate(entry.created_at)}</td>
        <td>${escapeHtml(entry.actor)}</td>
        <td>${escapeHtml(entry.action)}</td>
        <td>${entry.target_type ? escapeHtml(entry.target_type) : '-'}</td>
        <td class="mono">${entry.target_id ? escapeHtml(String(entry.target_id).slice(0, 8)) : '-'}</td>
      </tr>
    `).join('') : '<tr><td colspan="5">暂无审计记录</td></tr>';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function bindEvents() {
    $('#loginForm').addEventListener('submit', login);
    $('#logoutButton').addEventListener('click', logout);
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    $('#createInviteButton').addEventListener('click', () => {
      $('#inviteCreate').hidden = !$('#inviteCreate').hidden;
    });
    $('#inviteCreateConfirm').addEventListener('click', createInvite);
    $('#inviteCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('#inviteCodeText').textContent);
      } catch (_) {
        // 剪贴板不可用时用户可手动复制
      }
    });
    $('#inviteTableBody').addEventListener('click', (event) => {
      const button = event.target.closest('[data-revoke-invite]');
      if (button) revokeInvite(button.dataset.revokeInvite);
    });
    $('#userTableBody').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-user]');
      if (toggle) {
        toggleUser(toggle.dataset.toggleUser, toggle.dataset.userStatus);
        return;
      }
      const revoke = event.target.closest('[data-revoke-user-sessions]');
      if (revoke) revokeUserSessions(revoke.dataset.revokeUserSessions);
    });
    $('#usageDays').addEventListener('change', loadUsage);
    $('#auditLimit').addEventListener('change', loadAudit);
    $('#settingsForm').addEventListener('submit', saveSettings);
  }

  function bootstrap() {
    bindEvents();
    const savedToken = sessionStorage.getItem('hoyo-admin-token');
    const savedUser = sessionStorage.getItem('hoyo-admin-user');
    if (savedToken) {
      adminToken = savedToken;
      adminUsername = savedUser || 'admin';
      enterApp();
    }
  }

  bootstrap();
})();
