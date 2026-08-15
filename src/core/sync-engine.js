'use strict';

const fs = require('fs');
const path = require('path');
const { CloudApiError, DEFAULT_SERVER_URL, migrateLegacyServerUrl } = require('./cloud-api');

const SYNC_STATUS = {
  SIGNED_OUT: 'signed-out',
  SYNCED: 'synced',
  PENDING: 'pending',
  OFFLINE: 'offline',
  CONFLICT: 'conflict',
  ERROR: 'error',
};

const TRASH_RETENTION_DAYS = 30;
const PUSH_LIMIT = 200;
const PULL_LIMIT = 500;

const RETRY_DELAYS_MS = [5000, 15000, 45000, 120000, 300000, 900000];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return clone(fallback);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed ?? clone(fallback);
  } catch (_) {
    return clone(fallback);
  }
}

function writeJsonFile(filePath, value) {
  const tempFile = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tempFile, filePath);
    return true;
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (_) {
      // Best-effort cleanup only.
    }
    console.error('[SyncEngine] Failed to persist:', error);
    return false;
  }
}

function eventTypeName(event) {
  if (event.isDeadline) return 'deadline';
  if (event.isRecurring) return 'recurring';
  if (event.targetDurationMinutes) return 'timed';
  return 'normal';
}

function sanitizeQueueEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const eventId = String(value.eventId || '');
  const operationId = String(value.operationId || '');
  if (!eventId || !operationId) return null;
  const op = value.op === 'delete' ? 'delete' : 'upsert';
  return {
    eventId,
    operationId,
    op,
    data: op === 'delete' ? null : value.data && typeof value.data === 'object' ? value.data : null,
    version: Number(value.version) || 1,
    baseVersion: Number(value.baseVersion) || 0,
    attempts: Math.max(0, Number(value.attempts) || 0),
    nextRetryAt: Number(value.nextRetryAt) || 0,
  };
}

class SyncEngine {
  constructor(options = {}) {
    this.eventStore = options.eventStore;
    this.api = options.api;
    this.dataDir = options.dataDir;
    this.stateFile = options.stateFile || path.join(this.dataDir, 'sync-state.json');
    this.queueFile = options.queueFile || path.join(this.dataDir, 'sync-queue.json');
    this.credentialStore = options.credentialStore || {
      getRefreshToken: async () => null,
      setRefreshToken: async () => {},
      clearRefreshToken: async () => {},
    };
    this.deviceName = options.deviceName || '未知设备';
    this.onStateChange = options.onStateChange || (() => {});
    this.onAccountChange = options.onAccountChange || (() => {});
    this.onMigrationSummary = options.onMigrationSummary || (() => {});
    this.isOnline = options.isOnline || (() => true);
    this.state = readJsonFile(this.stateFile, {
      serverUrl: options.serverUrl || DEFAULT_SERVER_URL,
      cursor: 0,
      lastSyncAt: null,
      lastError: null,
      account: null,
      conflicts: [],
      migrationSummary: null,
      migrationDone: false,
    });
    this.state.serverUrl = migrateLegacyServerUrl(this.state.serverUrl);
    if (this.api) this.api.baseUrl = this.state.serverUrl;
    this.queue = this.loadQueue();
    this.account = this.state.account || null;
    this.flushTimer = null;
    this.heartbeatTimer = null;
    this.syncing = false;
    this.lastPullAt = 0;
  }

  persistState() {
    writeJsonFile(this.stateFile, this.state);
  }

  loadQueue() {
    let raw = null;
    try {
      if (fs.existsSync(this.queueFile)) {
        raw = JSON.parse(fs.readFileSync(this.queueFile, 'utf8'));
      }
    } catch (_) {
      raw = null;
    }

    let candidates = [];
    if (Array.isArray(raw)) {
      candidates = raw;
    } else if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.queue)) candidates = raw.queue;
      else if (Array.isArray(raw.items)) candidates = raw.items;
      else if (typeof raw.eventId === 'string' && typeof raw.operationId === 'string') {
        candidates = [raw];
      } else {
        candidates = Object.values(raw);
      }
    }

    const entries = candidates.map(sanitizeQueueEntry).filter((entry) => entry !== null);

    const byOperationId = new Map();
    for (const entry of entries) byOperationId.set(entry.operationId, entry);
    const byEventId = new Map();
    for (const entry of byOperationId.values()) byEventId.set(entry.eventId, entry);
    const deduped = [...byEventId.values()];

    const migrated = !Array.isArray(raw) || entries.length !== candidates.length || deduped.length !== entries.length;
    if (migrated && raw !== null) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupFile = path.join(this.dataDir, `sync-queue.backup-${stamp}.json`);
      try {
        if (!fs.existsSync(backupFile)) fs.copyFileSync(this.queueFile, backupFile);
      } catch (_) {
        // 备份失败不阻断队列迁移
      }
      this.queue = deduped;
      this.persistQueue();
    }
    return deduped;
  }

  persistQueue() {
    if (!Array.isArray(this.queue)) {
      console.error('[SyncEngine] Refusing to persist non-array queue:', typeof this.queue);
      return false;
    }
    return writeJsonFile(this.queueFile, this.queue);
  }

  getAccount() {
    return this.account ? { ...this.account } : null;
  }

  getStatus() {
    if (!this.account) return SYNC_STATUS.SIGNED_OUT;
    if (this.state.conflicts.length > 0) return SYNC_STATUS.CONFLICT;
    if (!this.isOnline()) return SYNC_STATUS.OFFLINE;
    if (this.queue.length > 0) return SYNC_STATUS.PENDING;
    if (this.state.lastError) return SYNC_STATUS.ERROR;
    return SYNC_STATUS.SYNCED;
  }

  getSnapshot() {
    return {
      status: this.getStatus(),
      account: this.getAccount(),
      serverUrl: this.state.serverUrl,
      cursor: this.state.cursor,
      lastSyncAt: this.state.lastSyncAt,
      lastError: this.state.lastError,
      queueLength: this.queue.length,
      conflictCount: this.state.conflicts.length,
      online: this.isOnline(),
      migrationSummary: this.state.migrationSummary,
      migrationDone: this.state.migrationDone,
    };
  }

  notify() {
    this.onStateChange(this.getSnapshot());
  }

  setServerUrl(url) {
    const next = String(url || '').trim() || DEFAULT_SERVER_URL;
    this.state.serverUrl = next;
    this.api.baseUrl = next;
    this.persistState();
    this.notify();
    return next;
  }

  // ------------------------------------------------------------------ auth

  async restoreSession() {
    const refreshToken = await this.credentialStore.getRefreshToken();
    if (!refreshToken) {
      this.notify();
      return false;
    }
    this.api.refreshToken = refreshToken;
    const refreshed = await this.api.refreshSession();
    if (!refreshed) {
      await this.credentialStore.clearRefreshToken();
      this.api.setTokens(null);
      this.notify();
      return false;
    }
    await this.activateSession({ notify: false });
    return true;
  }

  async activateSession(options = {}) {
    try {
      const profile = await this.api.me();
      this.account = { userId: profile.id, email: profile.email, status: profile.status };
      this.state.account = this.account;
      this.state.lastError = null;
      this.persistState();
      if (options.notify !== false) this.onAccountChange(this.getAccount());
      if (options.sync !== false) {
        await this.initialSync();
      }
      this.startHeartbeat();
      this.notify();
      return true;
    } catch (error) {
      if (error instanceof CloudApiError && error.status === 401) {
        await this.signOut();
      } else if (error instanceof CloudApiError && error.status === 403) {
        this.onAccountChange(null);
      }
      this.state.lastError = error.message || '登录后同步失败';
      this.persistState();
      this.notify();
      return false;
    }
  }

  async login(credentials) {
    const tokens = await this.api.login(credentials);
    await this.credentialStore.setRefreshToken(tokens.refresh_token);
    return this.activateSession();
  }

  async register(credentials) {
    const tokens = await this.api.register(credentials);
    await this.credentialStore.setRefreshToken(tokens.refresh_token);
    return this.activateSession();
  }

  async signOut() {
    const hadAccount = Boolean(this.account);
    if (this.account) {
      await this.api.logout();
    }
    await this.credentialStore.clearRefreshToken();
    this.api.setTokens(null);
    this.account = null;
    this.state.account = null;
    this.state.conflicts = [];
    this.state.lastError = null;
    this.state.migrationSummary = null;
    this.persistState();
    if (hadAccount) this.onAccountChange(null);
    this.stopHeartbeat();
    this.notify();
  }

  // ------------------------------------------------------------------ migration

  migrateLocalEvents() {
    const eventsFile = path.join(this.dataDir, 'events.json');
    let backupFile = this.state.migrationBackupFile || null;
    if (fs.existsSync(eventsFile) && !backupFile) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      backupFile = path.join(this.dataDir, `events.backup-${stamp}.json`);
      if (!fs.existsSync(backupFile)) {
        try {
          fs.copyFileSync(eventsFile, backupFile);
        } catch (_) {
          backupFile = null;
        }
      }
    }
    this.state.migrationBackupFile = backupFile;
    this.persistState();
    const migrated = this.eventStore.ensureSyncMetadata();
    this.eventStore.purgeTrash();
    return {
      total: migrated.total,
      assignedUuids: migrated.assignedUuids,
      backupFile,
    };
  }

  countTypes(events) {
    const types = { normal: 0, recurring: 0, deadline: 0, timed: 0 };
    for (const event of events) {
      const name = eventTypeName(event);
      if (types[name] !== undefined) types[name] += 1;
    }
    return types;
  }

  async initialSync() {
    this.state.migrationDone = true;
    this.persistState();
    try {
      const summary = await this.firstMerge();
      if (summary) {
        this.state.migrationSummary = summary;
        this.persistState();
        this.onMigrationSummary(clone(summary));
      }
      await this.syncNow({ pull: true });
    } catch (error) {
      this.state.lastError = error.message || '首次同步失败';
      this.persistState();
      this.notify();
    }
  }

  async firstMerge() {
    const serverEvents = await this.collectPull(0, PULL_LIMIT);
    const serverIds = new Set(serverEvents.map((event) => event.eventId));
    const localActive = this.eventStore.loadEvents();
    const localTrashed = this.eventStore.listTrash();
    const uploaded = [];
    const downloaded = [];
    const merged = [];
    const conflicts = [];

    for (const remote of serverEvents) {
      if (remote.deleted) {
        if (remote.data && !this.eventStore.findEventByUuid(remote.eventId)) {
          this.importRemoteTrashed(remote);
          merged.push(remote.eventId);
        }
        continue;
      }
      const local = this.eventStore.findEventByUuid(remote.eventId);
      if (!local) {
        if (remote.data) {
          this.eventStore.applyRemoteEvent(remote.eventId, remote.data, remote.version, remote.operationId);
          downloaded.push(remote.eventId);
        }
        continue;
      }
      if (String(local._opId) === String(remote.operationId)) {
        merged.push(remote.eventId);
        continue;
      }
      if (Number(remote.version) > Number(local._version || 0)) {
        this.addConflict(remote.eventId, local, remote.data, remote.version);
        conflicts.push(remote.eventId);
      } else {
        merged.push(remote.eventId);
      }
    }

    for (const local of localActive) {
      if (!serverIds.has(local._uuid)) {
        this.enqueueChange(local._uuid, local._opId, 'upsert', local);
        uploaded.push(local._uuid);
      }
    }
    for (const local of localTrashed) {
      if (!serverIds.has(local._uuid)) {
        this.enqueueChange(local._uuid, local._opId, 'delete', null);
      }
    }

    return {
      uploaded: uploaded.length,
      downloaded: downloaded.length,
      merged: merged.length,
      conflicts: conflicts.length,
      total: localActive.length,
      types: this.countTypes(localActive),
      backupFile: this.state.migrationBackupFile || null,
    };
  }

  // ------------------------------------------------------------------ queue & push

  enqueueChange(eventId, operationId, op, event) {
    const entry = {
      eventId,
      operationId,
      op,
      data: op === 'delete' ? null : this.eventStore.sanitizeForSync(event),
      version: Number(event?._version) || 1,
      baseVersion: Number(event?._baseVersion) || 0,
      attempts: 0,
      nextRetryAt: 0,
    };
    const index = this.queue.findIndex((item) => item.operationId === operationId);
    if (index >= 0) {
      this.queue[index] = entry;
    } else {
      const existing = this.queue.findIndex((item) => item.eventId === eventId);
      if (existing >= 0) this.queue.splice(existing, 1);
      this.queue.push(entry);
    }
    this.persistQueue();
    this.state.lastError = null;
    this.persistState();
    this.notify();
  }

  noteLocalChange(id, op) {
    const event = this.eventStore.getAnyEvent(id);
    if (!event || !event._uuid) return;
    this.enqueueChange(event._uuid, event._opId, op, event);
    this.schedulePush();
  }

  schedulePush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushPush();
    }, 3000);
  }

  async flushPush() {
    if (this.syncing || !this.account || !this.isOnline()) return;
    const now = Date.now();
    const due = this.queue.filter((entry) => entry.nextRetryAt <= now).slice(0, PUSH_LIMIT);
    if (!due.length) return;
    this.syncing = true;
    try {
      const result = await this.api.push(due);
      this.state.cursor = Math.max(this.state.cursor, Number(result.cursor) || 0);
      const doneIds = new Set();
      for (const item of result.results || []) {
        const entry = this.queue.find((queued) => queued.eventId === item.eventId);
        if (item.status === 'conflict') {
          const local = this.eventStore.findEventByUuid(item.eventId);
          this.addConflict(item.eventId, local, item.serverData, item.serverVersion);
          doneIds.add(item.eventId);
          continue;
        }
        if (item.status === 'error') {
          const pending = this.queue.find((queued) => queued.eventId === item.eventId);
          if (pending) pending.attempts += 1;
          continue;
        }
        this.eventStore.applySyncAck(
          item.eventId,
          item.version,
          entry?.operationId || undefined,
        );
        doneIds.add(item.eventId);
      }
      if (doneIds.size) {
        this.queue = this.queue.filter((entry) => !doneIds.has(entry.eventId));
        this.persistQueue();
      }
      this.state.lastError = null;
      this.state.lastSyncAt = new Date().toISOString();
      this.persistState();
      const remaining = this.queue.length;
      if (remaining) {
        for (const entry of due) {
          if (entry.nextRetryAt <= now) {
            const delayIndex = Math.min(entry.attempts, RETRY_DELAYS_MS.length - 1);
            entry.nextRetryAt = now + RETRY_DELAYS_MS[delayIndex];
          }
        }
        this.persistQueue();
      }
    } catch (error) {
      this.state.lastError = error.message || '同步失败';
      this.persistState();
      for (const entry of due) {
        entry.attempts += 1;
        const delayIndex = Math.min(entry.attempts - 1, RETRY_DELAYS_MS.length - 1);
        entry.nextRetryAt = Date.now() + RETRY_DELAYS_MS[delayIndex];
      }
      this.persistQueue();
    } finally {
      this.syncing = false;
      this.notify();
      this.scheduleNextRetry();
    }
  }

  scheduleNextRetry() {
    if (this.flushTimer) return;
    if (!this.account || this.queue.length === 0) return;
    const now = Date.now();
    const next = this.queue.reduce((earliest, entry) => Math.min(earliest, entry.nextRetryAt || now), Number.MAX_SAFE_INTEGER);
    const delay = Math.max(1000, next - now);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPush();
    }, Math.min(delay, 900000));
  }

  // ------------------------------------------------------------------ pull

  async collectPull(cursor, limit) {
    const events = [];
    let next = cursor;
    for (;;) {
      const page = await this.api.pull(next, limit);
      events.push(...(page.events || []));
      next = page.cursor ?? next;
      if (!page.hasMore) break;
    }
    return events;
  }

  async pullAll() {
    const events = await this.collectPull(this.state.cursor, PULL_LIMIT);
    this.state.cursor = events.length ? Math.max(this.state.cursor, events[events.length - 1].seq) : this.state.cursor;
    for (const remote of events) {
      this.applyCloudEvent(remote);
    }
    this.state.lastSyncAt = new Date().toISOString();
    this.persistState();
    return events;
  }

  applyCloudEvent(remote) {
    const eventId = remote.eventId;
    const local = this.eventStore.findEventByUuid(eventId);
    const pending = this.queue.some((entry) => entry.eventId === eventId);

    if (remote.deleted && !remote.data) {
      if (local) {
        if (pending && Number(remote.version) >= Number(local._version || 0)) {
          this.addConflict(eventId, local, null, remote.version);
        } else if (Number(remote.version) > Number(local._version || 0)) {
          this.eventStore.removeEventPermanently(local.id);
        }
      }
      return;
    }

    if (!local) {
      if (remote.deleted) {
        if (remote.data) this.importRemoteTrashed(remote);
        return;
      }
      if (remote.data) {
        this.eventStore.applyRemoteEvent(eventId, remote.data, remote.version, remote.operationId);
      }
      return;
    }

    if (String(local._opId) === String(remote.operationId)) return;

    if (pending) {
      if (Number(remote.version) >= Number(local._version || 0)) {
        this.addConflict(eventId, local, remote.data, remote.version);
      }
      return;
    }

    if (remote.deleted) {
      if (Number(remote.version) > Number(local._version || 0)) {
        if (remote.data) this.eventStore.markTrashedFromRemote(eventId, remote.trashUntil);
        else this.eventStore.removeEventPermanently(local.id);
      }
      return;
    }

    if (Number(remote.version) > Number(local._version || 0)) {
      this.eventStore.applyRemoteEvent(eventId, remote.data, remote.version, remote.operationId);
    } else if (Number(remote.version) === Number(local._version || 0)) {
      const events = this.eventStore.loadAllEvents();
      const index = events.findIndex((item) => item._uuid === eventId);
      if (index >= 0) {
        this.eventStore.applyRemoteMeta(events[index], { eventId, operationId: remote.operationId });
        this.eventStore.saveEvents(events);
      }
    }
  }

  importRemoteTrashed(remote) {
    const created = this.eventStore.applyRemoteEvent(remote.eventId, remote.data, remote.version, remote.operationId);
    if (created) {
      this.eventStore.markTrashedFromRemote(remote.eventId, remote.trashUntil);
    }
  }

  addConflict(eventId, local, serverData, serverVersion) {
    const existing = this.state.conflicts.findIndex((item) => item.eventId === eventId);
    const entry = {
      eventId,
      localId: local?.id || null,
      local: local ? this.eventStore.sanitizeForSync(local) : null,
      server: serverData || null,
      serverVersion: Number(serverVersion) || 0,
      at: new Date().toISOString(),
    };
    if (existing >= 0) this.state.conflicts[existing] = entry;
    else this.state.conflicts.push(entry);
    this.persistState();
    this.notify();
  }

  async resolveConflict(eventId, choice) {
    const conflict = this.state.conflicts.find((item) => item.eventId === eventId);
    if (!conflict) return false;
    this.state.conflicts = this.state.conflicts.filter((item) => item.eventId !== eventId);
    this.persistState();

    const local = this.eventStore.findEventByUuid(eventId);
    if (choice === 'server') {
      if (conflict.server) {
        if (local) {
          this.eventStore.applyRemoteEvent(
            eventId,
            conflict.server,
            conflict.serverVersion,
            this.eventStore.generateUuid(),
          );
        }
      } else if (local) {
        const trashUntil = new Date();
        trashUntil.setDate(trashUntil.getDate() + TRASH_RETENTION_DAYS);
        this.eventStore.markTrashedFromRemote(eventId, trashUntil.toISOString().slice(0, 10));
      }
    } else if (choice === 'local' && local) {
      const next = clone(local);
      next._baseVersion = conflict.serverVersion;
      next._version = conflict.serverVersion + 1;
      next._opId = this.eventStore.generateUuid();
      const events = this.eventStore.loadAllEvents();
      const index = events.findIndex((item) => item._uuid === eventId);
      if (index >= 0) {
        events[index] = next;
        this.eventStore.saveEvents(events);
        this.enqueueChange(eventId, next._opId, 'upsert', next);
      }
    }
    this.notify();
    this.schedulePush();
    return true;
  }

  listConflicts() {
    return clone(this.state.conflicts);
  }

  // ------------------------------------------------------------------ trash

  async listTrash() {
    const localTrash = this.eventStore.listTrash();
    let cloudItems = [];
    if (this.account && this.isOnline()) {
      try {
        const response = await this.api.trash();
        cloudItems = response.items || [];
      } catch (_) {
        // 云端回收站不可用时仅展示本地
      }
    }
    return { local: localTrash, cloud: cloudItems };
  }

  async restoreFromTrash(id, eventId) {
    if (eventId && this.account && this.isOnline()) {
      try {
        const restored = await this.api.restore(eventId);
        const local = this.eventStore.findEventByUuid(eventId);
        if (local) {
          this.eventStore.applyRemoteMeta(local, {
            eventId,
            version: restored.version,
            operationId: restored.operationId,
          });
          const events = this.eventStore.loadAllEvents();
          const index = events.findIndex((item) => item._uuid === eventId);
          if (index >= 0) {
            events[index] = local;
            this.eventStore.saveEvents(events);
          }
        } else if (restored.data) {
          this.eventStore.applyRemoteEvent(eventId, restored.data, restored.version, restored.operationId);
        }
        const existing = this.eventStore.findEventByUuid(eventId);
        if (existing) {
          this.eventStore.restoreFromTrash(existing.id);
        }
        this.notify();
        return { ok: true };
      } catch (_) {
        // 云端恢复失败时回退为本地恢复并排队推送
      }
    }
    const event = this.eventStore.getAnyEvent(id) || (eventId ? this.eventStore.findEventByUuid(eventId) : null);
    if (!event) return { ok: false };
    const restored = this.eventStore.restoreFromTrash(event.id);
    if (!restored) return { ok: false };
    this.enqueueChange(restored._uuid, restored._opId, 'upsert', restored);
    this.schedulePush();
    this.notify();
    return { ok: true };
  }

  purgeExpiredTrash() {
    const purged = this.eventStore.purgeTrash();
    if (purged > 0) this.notify();
    return purged;
  }

  // ------------------------------------------------------------------ agent

  async agentPlan(message, date) {
    if (!this.account) {
      throw new CloudApiError('登录后可使用云端日程助手', 401, null, 'signed_out');
    }
    const snapshot = this.eventStore.snapshotForAgent(500);
    const result = await this.api.agentPlan({ message, date, snapshot });
    return {
      message: result.message,
      actions: result.actions || [],
      usage: result.usage || {},
      budget: result.budget || {},
      configured: result.configured !== false,
    };
  }

  approveActions(actions, selectedIndices) {
    const approved = actions
      .filter((_action, index) => selectedIndices.has(index))
      .map((action) => {
        if (!action.id) return action;
        const local = this.eventStore.findEventByUuid(String(action.id));
        if (local) return { ...action, id: local.id };
        return action;
      });
    if (!approved.length) return [];
    const results = this.eventStore.applyActions(approved);
    for (const result of results) {
      if (result.success && result.event?.id) {
        this.noteLocalChange(result.event.id, result.type === 'delete' ? 'delete' : 'upsert');
      }
    }
    return results;
  }

  // ------------------------------------------------------------------ lifecycle

  async syncNow(options = {}) {
    if (!this.account) return false;
    if (options.pull !== false && this.isOnline()) {
      try {
        await this.pullAll();
      } catch (error) {
        this.state.lastError = error.message || '拉取失败';
        this.persistState();
      }
    }
    await this.flushPush();
    this.notify();
    return true;
  }

  async heartbeat() {
    if (!this.account || !this.isOnline()) {
      this.notify();
      return;
    }
    const now = Date.now();
    if (now - this.lastPullAt > 30000) {
      this.lastPullAt = now;
      await this.syncNow();
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, 60000);
    this.lastPullAt = Date.now();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  onNetworkChange(online) {
    if (online && this.account) {
      this.schedulePush();
      this.syncNow({ pull: true });
    } else {
      this.notify();
    }
  }
}

module.exports = { SyncEngine, SYNC_STATUS };
