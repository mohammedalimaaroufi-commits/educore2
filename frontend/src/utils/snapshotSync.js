import api from '../api/client';
import {
  enqueueOutbox,
  getMeta,
  getSnapshot,
  listOutbox,
  removeOutbox,
  saveMeta,
  saveSnapshot,
  updateOutbox,
} from './localDb.js';

const SYNC_META_KEY = 'snapshot-sync-settings';
const LAST_SYNC_META_KEY = 'snapshot-last-sync';
const MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const SYNC_INTERVALS = {
  manual: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export const DEFAULT_SYNC_SETTINGS = {
  frequency: 'daily',
  enabled: true,
};

export async function getSyncSettings() {
  return getMeta(SYNC_META_KEY, DEFAULT_SYNC_SETTINGS);
}

export async function saveSyncSettings(settings) {
  const next = {
    ...DEFAULT_SYNC_SETTINGS,
    ...settings,
    frequency: SYNC_INTERVALS[settings?.frequency] === undefined ? 'daily' : settings.frequency,
  };
  await saveMeta(SYNC_META_KEY, next);
  return next;
}

export async function getLastSync(teacherId) {
  const all = await getMeta(LAST_SYNC_META_KEY, {});
  return Number(all?.[teacherId] || 0);
}

async function setLastSync(teacherId, timestamp) {
  const all = await getMeta(LAST_SYNC_META_KEY, {});
  await saveMeta(LAST_SYNC_META_KEY, { ...all, [teacherId]: timestamp });
}

export async function shouldSync(teacherId, settings = null) {
  if (!teacherId || typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const current = settings || await getSyncSettings();
  if (!current.enabled || current.frequency === 'manual') return false;
  const lastSync = await getLastSync(teacherId);
  return !lastSync || Date.now() - lastSync >= SYNC_INTERVALS[current.frequency];
}

function pruneExpiredMessages(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.messages)) return snapshot;
  return {
    ...snapshot,
    messages: snapshot.messages.filter((message) => {
      const createdAt = new Date(message?.created_at || 0).getTime();
      return Number.isFinite(createdAt) && Date.now() - createdAt < MESSAGE_RETENTION_MS;
    }),
  };
}

export async function loadLocalSnapshot(teacherId) {
  return pruneExpiredMessages(await getSnapshot(teacherId));
}

export async function syncSnapshot(teacherId, { force = false } = {}) {
  if (!teacherId || typeof navigator !== 'undefined' && !navigator.onLine) {
    return { snapshot: pruneExpiredMessages(await getSnapshot(teacherId)), fromLocal: true, skipped: true };
  }
  const settings = await getSyncSettings();
  if (!force && !(await shouldSync(teacherId, settings))) {
    return { snapshot: pruneExpiredMessages(await getSnapshot(teacherId)), fromLocal: true, skipped: true };
  }
  try {
    const { data } = await api.get('/sync/snapshot', { timeout: 45_000 });
    const cleaned = pruneExpiredMessages(data);
    await saveSnapshot(teacherId, cleaned);
    await setLastSync(teacherId, Date.now());
    return { snapshot: cleaned, fromLocal: false, skipped: false };
  } catch {
    return { snapshot: pruneExpiredMessages(await getSnapshot(teacherId)), fromLocal: true, skipped: true };
  }
}

export async function getOrSyncSnapshot(teacherId) {
  const local = pruneExpiredMessages(await getSnapshot(teacherId));
  if (local) return local;
  return (await syncSnapshot(teacherId, { force: true })).snapshot;
}

export async function queueMutation(teacherId, operation) {
  return enqueueOutbox(teacherId, operation);
}

export async function flushOutbox(teacherId) {
  if (!teacherId || typeof navigator !== 'undefined' && !navigator.onLine) return { sent: 0, failed: 0 };
  const items = await listOutbox(teacherId);
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await api.request({ method: item.method, url: item.url, data: item.data, params: item.params, timeout: 20_000 });
      await removeOutbox(item.id);
      sent += 1;
    } catch {
      failed += 1;
      await updateOutbox({ ...item, attempts: Number(item.attempts || 0) + 1, lastAttemptAt: Date.now() });
      break;
    }
  }
  if (sent > 0) await syncSnapshot(teacherId, { force: true });
  return { sent, failed };
}

export function getSyncIntervalLabel(frequency) {
  return {
    manual: 'عند الطلب فقط',
    daily: 'يوميًا',
    weekly: 'أسبوعيًا',
    monthly: 'شهريًا',
  }[frequency] || 'يوميًا';
}
