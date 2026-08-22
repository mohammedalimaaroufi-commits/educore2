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
  '6 months': '6_months',
  '6months': '6_months',
  '6-months': '6_months',
  '6-month': '6_months',
  six_months: '6_months',
  six_month: '6_months',
  'six-months': '6_months',
  'six-month': '6_months',
  half_year: '6_months',
  'half-year': '6_months',
  semester: '6_months',
  semiannual: '6_months',
  '6 أشهر': '6_months',
  '6 اشهر': '6_months',
  '٦ أشهر': '6_months',
  '٦ اشهر': '6_months',
  yearly: 'yearly',
  annual: 'yearly',
  'annual plan': 'yearly',
  'yearly plan': 'yearly',
  year: 'yearly',
  '12 months': 'yearly',
  '12_months': 'yearly',
  '12months': 'yearly',
  '12-months': 'yearly',
  '12 month': 'yearly',
  سنوية: 'yearly',
  سنوي: 'yearly',
  'الباقة السنوية': 'yearly',
  lifetime: 'lifetime',
  'lifetime plan': 'lifetime',
  forever: 'lifetime',
  permanent: 'lifetime',
  'مدى الحياة': 'lifetime',
  'باقة مدى الحياة': 'lifetime',
  '6 أشهر': '6_months',
  'باقة 6 أشهر': '6_months',
  'باقة ستة أشهر': '6_months',
  'فترة تجريبية': 'trial',
  تجريبي: 'trial',
  trial: 'trial',
};

function normalizePlanId(value) {
  const raw = String(value ?? '').trim().toLowerCase().normalize('NFKC');
  if (!raw) return null;
  return PLAN_ID_ALIASES[raw]
    || PLAN_ID_ALIASES[raw.replace(/[–—−]/g, '-').replace(/\s+/g, ' ')]
    || PLAN_ID_ALIASES[raw.replace(/[\s-]+/g, '_')]
    || null;
}

function isPaidPlanId(value) {
  return ['6_months', 'yearly', 'lifetime'].includes(normalizePlanId(value));
}

// Requests created by older frontends sometimes stored the visible plan title or
// an offer id instead of the canonical plan id. Resolve those values at the
// server boundary so approval remains safe and deterministic.
function toWesternDigits(value) {
  return String(value ?? '').replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function resolvePlanId(value, options = {}) {
  const canonical = normalizePlanId(value);
  // A historical request may have stored `trial` even though it contains a paid
  // offer or amount. Resolve those stronger signals before accepting trial.
  if (canonical && canonical !== 'trial') return canonical;

  const definitions = options.definitions || getPlanDefinitions();
  const raw = String(value ?? '').trim().toLowerCase().normalize('NFKC');
  if (raw) {
    const byTitle = definitions.find((plan) => {
      const title = String(plan.title || '').trim().toLowerCase().normalize('NFKC');
      return title === raw || title.replace(/[\s-]+/g, '_') === raw.replace(/[\s-]+/g, '_');
    });
    if (byTitle) return byTitle.id;
  }

  if (options.offerId) {
    const offer = db.prepare('SELECT plan FROM subscription_offers WHERE id = ?').get(options.offerId);
    const offerPlan = normalizePlanId(offer?.plan);
    if (isPaidPlanId(offerPlan)) return offerPlan;
  }

  const rawNumeric = Number(toWesternDigits(raw).replace(/[^0-9.]+/g, ''));
  const amounts = [options.amount, options.originalAmount, ...(Array.isArray(options.amounts) ? options.amounts : []), rawNumeric]
    .map((amount) => Number(toWesternDigits(amount)))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  for (const amount of amounts) {
    const candidates = definitions.filter((plan) => {
      const base = Number(plan.base_price_omr);
      const activeOffer = getActiveOffer(plan.id);
      const offerPrice = activeOffer ? Number(activeOffer.offer_price_omr) : null;
      return base === amount || offerPrice === amount;
    });
    if (candidates.length === 1) return candidates[0].id;

    const historicalOffers = db.prepare('SELECT DISTINCT plan FROM subscription_offers WHERE offer_price_omr = ? OR original_price_omr = ?').all(amount, amount)
      .map((row) => normalizePlanId(row.plan)).filter((plan) => isPaidPlanId(plan));
    const uniqueHistoricalPlans = [...new Set(historicalOffers)];
    if (uniqueHistoricalPlans.length === 1) return uniqueHistoricalPlans[0];
  }

  return canonical === 'trial' ? 'trial' : null;
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

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result.toISOString();
}

function sameTimestamp(left, right) {
  if (!left || !right) return left === right;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && Math.abs(leftTime - rightTime) <= 1000;
}

/**
 * Repairs legacy paid subscription rows whose period fields are missing or do not
 * match the canonical plan duration. This is intentionally idempotent: valid rows
 * are returned unchanged, while a bad end date is corrected from the stored start.
 */
function repairPaidSubscriptionPeriod(rawSub, options = {}) {
  if (!rawSub || !isPaidPlanId(rawSub.plan) || rawSub.status === 'canceled') return rawSub;
  const definitions = options.definitions || getPlanDefinitions();
  const canonicalPlan = resolvePlanId(rawSub.plan, { definitions });
  const definition = definitions.find((item) => item.id === canonicalPlan);
  if (!definition) return rawSub;

  const requestedStart = options.startDate || null;
  const storedStart = rawSub.current_period_start;
  const fallbackStart = requestedStart || storedStart || rawSub.updated_at || rawSub.created_at || new Date().toISOString();
  const expectedEnd = definition.duration_days === null ? null : addDays(fallbackStart, definition.duration_days);
  const startIsValid = Boolean(storedStart) && Number.isFinite(new Date(storedStart).getTime());
  const startMatchesRequest = !requestedStart || sameTimestamp(storedStart, requestedStart);
  const endMatches = definition.duration_days === null
    ? !rawSub.current_period_end
    : Boolean(rawSub.current_period_end) && sameTimestamp(rawSub.current_period_end, expectedEnd);
  const needsRepair = rawSub.plan !== canonicalPlan
    || !startIsValid
    || !startMatchesRequest
    || !endMatches;
  if (!needsRepair) return rawSub;

  const now = new Date().toISOString();
  db.prepare(`UPDATE subscriptions SET plan = ?, trial_start_date = NULL, trial_end_date = NULL,
              current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ?`)
    .run(canonicalPlan, fallbackStart, expectedEnd, now, rawSub.id);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(rawSub.id);
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
  const now = Date.now();
  const rows = db.prepare('SELECT * FROM subscription_offers ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC').all();
  const wanted = plan ? normalizePlanId(plan) : null;
  return rows.filter((offer) => {
    const enabled = offer.enabled === 1 || offer.enabled === '1' || offer.enabled === true || String(offer.enabled).toLowerCase() === 'true';
    if (!enabled) return false;
    const startsAt = offer.starts_at ? new Date(offer.starts_at).getTime() : null;
    const endsAt = offer.ends_at ? new Date(offer.ends_at).getTime() : null;
    if (Number.isFinite(startsAt) && now < startsAt) return false;
    if (Number.isFinite(endsAt) && now > endsAt) return false;
    return !wanted || normalizePlanId(offer.plan) === wanted;
  });
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
      has_offer: Boolean(offer),
      offer_id: offer?.id || null,
      offer_title: offer?.title || null,
      offer_description: offer?.description || null,
      offer_starts_at: offer?.starts_at || null,
      offer_ends_at: offer?.ends_at || null,
      offer: offer ? {
        id: offer.id,
        title: offer.title,
        description: offer.description,
        original_price_omr: Number(offer.original_price_omr || definition.base_price_omr),
        offer_price_omr: Number(offer.offer_price_omr),
        starts_at: offer.starts_at,
        ends_at: offer.ends_at,
        enabled: true,
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
  resolvePlanId,
  isPaidPlanId,
  getPlanDefinition,
  repairPaidSubscriptionPeriod,
  savePlanDefinitions,
  getBasePrices,
  getTrialDays,
  getActiveOffers,
  getActiveOffer,
  getPublicPlans,
};
