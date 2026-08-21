const db = require('../db');

const DEFAULT_PAYMENT_PHONE = process.env.PAYMENT_PHONE || '00968737448';

const PUBLIC_CONFIG_KEYS = [
  'payment_phone',
  'payment_recipient',
  'payment_method',
  'payment_account',
  'payment_note_ar',
  'payment_note_en',
  'announcement_enabled',
  'announcement_type',
  'announcement_title_ar',
  'announcement_title_en',
  'announcement_message_ar',
  'announcement_message_en',
  'announcement_cta_label_ar',
  'announcement_cta_label_en',
  'announcement_cta_url',
  'announcement_starts_at',
  'announcement_ends_at',
];

const NOTIFICATIONS_KEY = 'announcement_notifications';

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function setSetting(key, value) {
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value === null || value === undefined ? '' : String(value));
}

function readNotifications() {
  const raw = getSetting(NOTIFICATIONS_KEY, '[]');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && (item.id || item.title_ar || item.title_en || item.message_ar || item.message_en)) : [];
  } catch {
    return [];
  }
}

function getAdminPublicConfig() {
  const config = {};
  for (const key of PUBLIC_CONFIG_KEYS) config[key] = getSetting(key, '');
  config.announcement_notifications = readNotifications();
  if (!config.payment_phone) config.payment_phone = DEFAULT_PAYMENT_PHONE;
  if (!config.announcement_type) config.announcement_type = 'maintenance';
  if (!config.announcement_enabled) config.announcement_enabled = '0';
  return config;
}

function isWithinWindow(now, startsAt, endsAt) {
  const current = now.getTime();
  if (startsAt) {
    const start = new Date(startsAt).getTime();
    if (Number.isFinite(start) && current < start) return false;
  }
  if (endsAt) {
    const end = new Date(endsAt).getTime();
    if (Number.isFinite(end) && current > end) return false;
  }
  return true;
}

function getPublicConfig() {
  const config = getAdminPublicConfig();
  const announcementEnabled = config.announcement_enabled === '1' || config.announcement_enabled === 'true';
  const hasMessage = Boolean(config.announcement_title_ar || config.announcement_title_en || config.announcement_message_ar || config.announcement_message_en);
  const announcement = announcementEnabled && hasMessage && isWithinWindow(new Date(), config.announcement_starts_at, config.announcement_ends_at)
    ? {
      enabled: true,
      type: config.announcement_type || 'maintenance',
      title_ar: config.announcement_title_ar,
      title_en: config.announcement_title_en,
      message_ar: config.announcement_message_ar,
      message_en: config.announcement_message_en,
      cta_label_ar: config.announcement_cta_label_ar,
      cta_label_en: config.announcement_cta_label_en,
      cta_url: config.announcement_cta_url,
      starts_at: config.announcement_starts_at,
      ends_at: config.announcement_ends_at,
    }
    : null;
  const notifications = config.announcement_notifications
    .filter((item) => item.enabled !== false && item.enabled !== '0' && item.enabled !== 0 && isWithinWindow(new Date(), item.starts_at, item.ends_at))
    .map((item) => ({ ...item, enabled: true }));
  return {
    payment: {
      phone: config.payment_phone || DEFAULT_PAYMENT_PHONE,
      recipient: config.payment_recipient,
      method: config.payment_method,
      account: config.payment_account,
      note_ar: config.payment_note_ar,
      note_en: config.payment_note_en,
    },
    announcement,
    notifications,
  };
}

function savePublicConfig(input = {}) {
  for (const key of PUBLIC_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) setSetting(key, input[key]);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'announcement_notifications')) {
    const notifications = Array.isArray(input.announcement_notifications) ? input.announcement_notifications : [];
    setSetting(NOTIFICATIONS_KEY, JSON.stringify(notifications.slice(0, 50)));
  }
  return getAdminPublicConfig();
}

module.exports = {
  PUBLIC_CONFIG_KEYS,
  getAdminPublicConfig,
  getPublicConfig,
  savePublicConfig,
};
