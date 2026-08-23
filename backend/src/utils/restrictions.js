const db = require('../db');

const RESTRICTABLE_FEATURES = ['students', 'gradebook', 'behavior', 'attendance', 'analytics', 'reports'];
const GLOBAL_RESTRICTIONS_KEY = 'subscription_expiry_restrictions';
const DEFAULT_RESTRICTIONS = {
  enabled: false,
  apply_when_expired: true,
  blocked_features: [],
  note: '',
};

function parseStored(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRestrictions(input = {}) {
  const blocked = Array.isArray(input.blocked_features)
    ? [...new Set(input.blocked_features.map((feature) => String(feature)).filter((feature) => RESTRICTABLE_FEATURES.includes(feature)))]
    : [];
  return {
    enabled: Boolean(input.enabled),
    apply_when_expired: input.apply_when_expired === undefined ? true : Boolean(input.apply_when_expired),
    blocked_features: blocked,
    note: String(input.note || '').trim().slice(0, 500),
  };
}

function getGlobalRestrictions() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(GLOBAL_RESTRICTIONS_KEY);
  return { ...DEFAULT_RESTRICTIONS, ...normalizeRestrictions(parseStored(row?.value)) };
}

function saveGlobalRestrictions(input = {}) {
  const normalized = { ...DEFAULT_RESTRICTIONS, ...normalizeRestrictions(input) };
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(GLOBAL_RESTRICTIONS_KEY, JSON.stringify(normalized));
  return normalized;
}

// Compatibility aliases: the policy is intentionally global now. Legacy callers
// may still pass a teacher id, but that id is ignored and no per-teacher setting is written.
function getConfiguredRestrictions() {
  return getGlobalRestrictions();
}

function saveTeacherRestrictions(_teacherId, input) {
  return saveGlobalRestrictions(input);
}

function subscriptionHasExpired(subscription) {
  if (!subscription) return false;
  if (subscription.status === 'expired') return true;
  const end = subscription.plan === 'trial' ? subscription.trial_end_date : subscription.current_period_end;
  return Boolean(end && Number.isFinite(new Date(end).getTime()) && new Date(end).getTime() <= Date.now());
}

function getEffectiveRestrictions(_teacherId, subscription = null) {
  const configured = getGlobalRestrictions();
  const expired = subscriptionHasExpired(subscription);
  const autoActive = configured.apply_when_expired && expired;
  const active = configured.enabled || autoActive;
  return {
    ...configured,
    active,
    expired,
    reason: autoActive ? 'expired_subscription' : configured.enabled ? 'manual' : null,
    blocked_features: active ? configured.blocked_features : [],
  };
}

module.exports = {
  GLOBAL_RESTRICTIONS_KEY,
  RESTRICTABLE_FEATURES,
  DEFAULT_RESTRICTIONS,
  normalizeRestrictions,
  getGlobalRestrictions,
  saveGlobalRestrictions,
  getConfiguredRestrictions,
  saveTeacherRestrictions,
  getEffectiveRestrictions,
  subscriptionHasExpired,
};
