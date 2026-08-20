const db = require('../db');

const DEFAULT_PLAN_DEFINITIONS = [
  { id: '6_months', title: 'باقة 6 أشهر', base_price_omr: 4, duration_days: 182, note: 'وصول كامل لمدة نصف عام', features: ['دفتر درجات كامل', 'الحضور والسلوك', 'التحليلات والتقارير'], highlight: false },
  { id: 'yearly', title: 'الباقة السنوية', base_price_omr: 7, duration_days: 365, note: 'الأكثر توفيرًا للعام الدراسي', features: ['كل أدوات EduCore', 'نسخ محلية ومزامنة', 'دعم فني مباشر'], highlight: true },
  { id: 'lifetime', title: 'مدى الحياة', base_price_omr: 18, duration_days: null, note: 'دفعة واحدة ووصول دائم', features: ['وصول دائم', 'كل التحديثات المستقبلية', 'أولوية في الدعم'], highlight: false },
];

const PLAN_PRICES_OMR = Object.fromEntries(DEFAULT_PLAN_DEFINITIONS.map((plan) => [plan.id, plan.base_price_omr]));
const PLAN_DURATIONS_DAYS = Object.fromEntries(DEFAULT_PLAN_DEFINITIONS.map((plan) => [plan.id, plan.duration_days]));
const PLAN_SETTINGS_KEY = 'subscription_plans';

// Historical clients and imported rows used several aliases for the same plans.
// Keep one canonical ID in storage and normalize at every request boundary.
const PLAN_ID_ALIASES = {
  trial: 'trial',
  تجريبي: 'trial',
  'فترة تجريبية': 'trial',
  '6_months': '6_months',
  '6_month': '6_months',
  '6months': '6_months',
  '6-months': '6_months',
  six_months: '6_months',
  'six-months': '6_months',
  half_year: '6_months',
  semiannual: '6_months',
  '6 أشهر': '6_months',
  '6 اشهر': '6_months',
  yearly: 'yearly',
  annual: 'yearly',
  year: 'yearly',
  '12_months': 'yearly',
  '12months': 'yearly',
  سنوية: 'yearly',
  سنوي: 'yearly',
  lifetime: 'lifetime',
  forever: 'lifetime',
  permanent: 'lifetime',
  'مدى الحياة': 'lifetime',
};

function normalizePlanId(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PLAN_ID_ALIASES[raw] || null;
}

function isPaidPlanId(value) {
  return ['6_months', 'yearly', 'lifetime'].includes(normalizePlanId(value));
}


function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function normalizePlan(raw, fallback) {
  const source = { ...fallback, ...(raw || {}) };
  const basePrice = Number(source.base_price_omr);
  const duration = source.duration_days === null || source.duration_days === '' || source.duration_days === undefined
    ? null
    : Number(source.duration_days);
  return {
    id: fallback.id,
    title: String(source.title || fallback.title).trim() || fallback.title,
    base_price_omr: Number.isFinite(basePrice) && basePrice > 0 ? basePrice : fallback.base_price_omr,
    duration_days: duration === null ? null : (Number.isInteger(duration) && duration > 0 ? duration : fallback.duration_days),
    note: String(source.note || '').trim(),
    features: Array.isArray(source.features)
      ? source.features.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : fallback.features,
    highlight: Boolean(source.highlight),
  };
}

function getPlanDefinitions() {
  const raw = getSetting(PLAN_SETTINGS_KEY, null);
  if (!raw) return DEFAULT_PLAN_DEFINITIONS.map((plan) => ({ ...plan, features: [...plan.features] }));
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('invalid plan settings');
    return DEFAULT_PLAN_DEFINITIONS.map((fallback) => normalizePlan(parsed.find((plan) => plan?.id === fallback.id), fallback));
  } catch {
    return DEFAULT_PLAN_DEFINITIONS.map((plan) => ({ ...plan, features: [...plan.features] }));
  }
}

function getPlanDefinition(planId) {
  return getPlanDefinitions().find((plan) => plan.id === planId) || null;
}

function savePlanDefinitions(plans) {
  const incoming = Array.isArray(plans) ? plans : [];
  const normalized = DEFAULT_PLAN_DEFINITIONS.map((fallback) => normalizePlan(incoming.find((plan) => plan?.id === fallback.id), fallback));
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(PLAN_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function getBasePrices() {
  return Object.fromEntries(getPlanDefinitions().map((plan) => [plan.id, plan.base_price_omr]));
}

function getTrialDays() {
  const value = Number(getSetting('trial_days', process.env.TRIAL_DAYS || 14));
  return Number.isFinite(value) ? Math.min(365, Math.max(1, Math.round(value))) : 14;
}

function getActiveOffers(plan = null) {
  const now = new Date().toISOString();
  const clauses = ['enabled = 1', '(starts_at IS NULL OR starts_at <= ?)', '(ends_at IS NULL OR ends_at >= ?)'];
  const params = [now, now];
  if (plan) {
    clauses.push('plan = ?');
    params.push(plan);
  }
  return db.prepare(`SELECT * FROM subscription_offers WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, created_at DESC`).all(...params);
}

function getActiveOffer(plan) {
  return getActiveOffers(plan)[0] || null;
}

function getPublicPlans() {
  return getPlanDefinitions().map((definition) => {
    const offer = getActiveOffer(definition.id);
    return {
      ...definition,
      price_omr: offer ? Number(offer.offer_price_omr) : definition.base_price_omr,
      original_price_omr: offer ? Number(offer.original_price_omr || definition.base_price_omr) : definition.base_price_omr,
      offer: offer ? {
        id: offer.id,
        title: offer.title,
        description: offer.description,
        starts_at: offer.starts_at,
        ends_at: offer.ends_at,
      } : null,
    };
  });
}

module.exports = {
  DEFAULT_PLAN_DEFINITIONS,
  PLAN_PRICES_OMR,
  PLAN_DURATIONS_DAYS,
  getSetting,
  getPlanDefinitions,
  normalizePlanId,
  isPaidPlanId,
  getPlanDefinition,
  savePlanDefinitions,
  getBasePrices,
  getTrialDays,
  getActiveOffers,
  getActiveOffer,
  getPublicPlans,
};
