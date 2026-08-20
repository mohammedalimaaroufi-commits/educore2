const db = require('../db');

const PLAN_PRICES_OMR = { '6_months': 4, yearly: 7, lifetime: 18 };
const PLAN_DURATIONS_DAYS = { '6_months': 182, yearly: 365, lifetime: null };

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
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
  return Object.entries(PLAN_PRICES_OMR).map(([id, basePrice]) => {
    const offer = getActiveOffer(id);
    return {
      id,
      base_price_omr: basePrice,
      price_omr: offer ? Number(offer.offer_price_omr) : basePrice,
      original_price_omr: offer ? Number(offer.original_price_omr || basePrice) : basePrice,
      duration_days: PLAN_DURATIONS_DAYS[id],
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
  PLAN_PRICES_OMR,
  PLAN_DURATIONS_DAYS,
  getSetting,
  getTrialDays,
  getActiveOffers,
  getActiveOffer,
  getPublicPlans,
};
