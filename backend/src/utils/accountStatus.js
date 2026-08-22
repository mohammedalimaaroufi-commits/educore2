const db = require('../db');

const ACCOUNT_STATUS_PREFIX = 'teacher_account_status:';
const VALID_ACCOUNT_STATUSES = new Set(['active', 'disabled', 'banned']);

function keyFor(teacherId) {
  return `${ACCOUNT_STATUS_PREFIX}${teacherId}`;
}

function normalizeAccountStatus(value) {
  const raw = typeof value === 'string' ? { status: value } : (value || {});
  const status = VALID_ACCOUNT_STATUSES.has(String(raw.status || '').toLowerCase())
    ? String(raw.status).toLowerCase()
    : 'active';
  return {
    status,
    note: String(raw.note || '').trim().slice(0, 500),
    updated_at: raw.updated_at || null,
  };
}

function getAccountStatus(teacherId) {
  const row = db.prepare('SELECT value, updated_at FROM app_settings WHERE key = ?').get(keyFor(teacherId));
  if (!row?.value) return { status: 'active', note: '', updated_at: null };
  try {
    return normalizeAccountStatus({ ...JSON.parse(row.value), updated_at: row.updated_at });
  } catch {
    return { status: 'active', note: '', updated_at: row.updated_at || null };
  }
}

function saveAccountStatus(teacherId, input = {}) {
  const next = normalizeAccountStatus(input);
  db.prepare(`INSERT INTO app_settings (key, value, updated_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(keyFor(teacherId), JSON.stringify({ status: next.status, note: next.note }));
  return getAccountStatus(teacherId);
}

function isAccountBlocked(status) {
  return status === 'disabled' || status === 'banned';
}

function accountStatusMessage(status) {
  return status === 'banned' ? 'تم حظر هذا الحساب من قبل المسؤول' : 'تم تعطيل هذا الحساب من قبل المسؤول';
}

module.exports = {
  ACCOUNT_STATUS_PREFIX,
  VALID_ACCOUNT_STATUSES,
  normalizeAccountStatus,
  getAccountStatus,
  saveAccountStatus,
  isAccountBlocked,
  accountStatusMessage,
};
