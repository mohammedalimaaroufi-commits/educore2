const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db');
require('dotenv').config();
const { signToken, requireAuth } = require('../middleware/auth');
const { getTrialDays, getPublicPlans, getActiveOffer, getBasePrices, getPlanDefinitions, normalizePlanId, resolvePlanId, isPaidPlanId } = require('../utils/subscriptions');
const { getPublicConfig } = require('../utils/publicConfig');

const router = express.Router();
const RESET_TOKEN_MINUTES = 30;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const VALID_PLANS = new Set(['trial', '6_months', 'yearly', 'lifetime']);

function ensureTrialSubscription(teacherId, rawSub = null) {
  const now = new Date().toISOString();
  const canonicalPlan = normalizePlanId(rawSub?.plan);
  const trialStart = rawSub?.trial_start_date || now;
  const trialEnd = rawSub?.trial_end_date || addDays(trialStart, getTrialDays());
  const hasLegacyTrialShape = rawSub?.trial_end_date && !rawSub.current_period_start && !rawSub.current_period_end;

  // Repair paid aliases without destroying their paid period.
  if (rawSub && isPaidPlanId(canonicalPlan) && canonicalPlan !== rawSub.plan && !hasLegacyTrialShape) {
    db.prepare("UPDATE subscriptions SET plan = ?, updated_at = ? WHERE id = ?").run(canonicalPlan, now, rawSub.id);
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(rawSub.id);
  }

  const shouldRepair = !rawSub
    || !VALID_PLANS.has(canonicalPlan)
    || (canonicalPlan === 'trial' && !rawSub.trial_end_date)
    || (canonicalPlan === 'lifetime' && hasLegacyTrialShape);

  if (!shouldRepair) return rawSub;

  if (!rawSub) {
    const id = uuid();
    db.prepare(`INSERT INTO subscriptions (id, teacher_id, plan, status, trial_start_date, trial_end_date)
                VALUES (?, ?, 'trial', 'active', ?, ?)`).run(id, teacherId, trialStart, trialEnd);
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  }

  db.prepare(`UPDATE subscriptions
              SET plan = 'trial', status = CASE WHEN status IN ('canceled', 'expired') THEN status ELSE 'active' END,
                  trial_start_date = ?, trial_end_date = ?, current_period_start = NULL, current_period_end = NULL,
                  updated_at = ?
              WHERE id = ?`).run(trialStart, trialEnd, now, rawSub.id);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(rawSub.id);
}

// POST /api/auth/register  (email/password, or google/apple with provider token in real impl)
router.post('/register', async (req, res) => {
  const { full_name, email, password, subject, school_stage, school_name, locale, auth_provider } = req.body;
  if (!full_name || !email) return res.status(400).json({ error: 'الاسم والبريد الإلكتروني مطلوبان' });

  const existing = db.prepare('SELECT id FROM teachers WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل مسبقاً' });

  const id = uuid();
  const password_hash = password ? await bcrypt.hash(password, 10) : null;

  const normalizedLocale = locale === 'en' ? 'en' : 'ar';
  db.prepare(`INSERT INTO teachers (id, full_name, email, password_hash, auth_provider, subject, school_stage, school_name, locale)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, full_name, email, password_hash, auth_provider || 'email', subject || null, school_stage || null, school_name || null, normalizedLocale);

  // Start the administrator-configured free trial automatically, with no card required.
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO subscriptions (id, teacher_id, plan, status, trial_start_date, trial_end_date)
              VALUES (?, ?, 'trial', 'active', ?, ?)`)
    .run(uuid(), id, now, addDays(now, getTrialDays()));

  // Seed default grade-based auto-recommendation phrases so reports have useful text from day one
  const defaultRules = [
    { min: 90, max: 100, text: 'أداء ممتاز، استمر بهذا التميز والانضباط.' },
    { min: 80, max: 89.99, text: 'أداء جيد جدًا، مع إمكانية جيدة لمزيد من التحسن.' },
    { min: 70, max: 79.99, text: 'أداء جيد، يُنصح بمتابعة إضافية لرفع المستوى.' },
    { min: 60, max: 69.99, text: 'أداء مقبول، يوصى بخطة مراجعة ودعم إضافي.' },
    { min: 0, max: 59.99, text: 'يحتاج الطالب دعمًا إضافيًا وتشجيعًا على المذاكرة المنتظمة.' },
  ];
  const insertRule = db.prepare(`INSERT INTO grade_recommendation_rules (id, teacher_id, min_score, max_score, text, sort_order)
                                  VALUES (?, ?, ?, ?, ?, ?)`);
  defaultRules.forEach((r, i) => insertRule.run(uuid(), id, r.min, r.max, r.text, i));

  const teacher = db.prepare('SELECT id, full_name, email, subject, school_stage, school_name, locale, avatar_url FROM teachers WHERE id = ?').get(id);
  const token = signToken(teacher);
  res.status(201).json({ token, teacher });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const teacher = db.prepare('SELECT * FROM teachers WHERE email = ?').get(email);
  if (!teacher || !teacher.password_hash) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

  const valid = await bcrypt.compare(password || '', teacher.password_hash);
  if (!valid) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

  const publicTeacher = db.prepare('SELECT id, full_name, email, subject, school_stage, school_name, locale, avatar_url FROM teachers WHERE id = ?').get(teacher.id);
  const token = signToken(publicTeacher);
  res.json({ token, teacher: publicTeacher });
});

// POST /api/auth/forgot-password { email }
// The teacher only creates a request. An administrator reviews it, generates a short-lived
// link from the private console, and sends that link manually to the subscriber's email.
router.post('/forgot-password', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

  const teacher = db.prepare('SELECT id, email FROM teachers WHERE lower(email) = ?').get(email);
  const genericMessage = 'تم استلام الطلب. إذا كان البريد مسجلاً لدينا فسيراجعه المسؤول ويرسل رابط إعادة التعيين يدويًا.';
  if (teacher) {
    const pending = db.prepare("SELECT id FROM password_reset_requests WHERE teacher_id = ? AND status = 'pending' LIMIT 1").get(teacher.id);
    if (!pending) {
      db.prepare(`INSERT INTO password_reset_requests (id, teacher_id, email, status) VALUES (?, ?, ?, 'pending')`)
        .run(uuid(), teacher.id, teacher.email);
    }
  }
  return res.json({ success: true, message: genericMessage });
});

// POST /api/auth/reset-password  { token, password }
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'الرابط وكلمة المرور الجديدة مطلوبان' });
  if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });

  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);
  if (!reset || new Date(reset.expires_at) < new Date()) {
    return res.status(400).json({ error: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد.' });
  }

  const password_hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE teachers SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(password_hash, reset.teacher_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);

  res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.' });
});

function getSubscriptionPresentation(teacherId, sub) {
  const definitions = getPlanDefinitions();
  const requests = db.prepare("SELECT * FROM payment_requests WHERE teacher_id = ? AND status = 'approved' ORDER BY datetime(COALESCE(reviewed_at, created_at)) DESC, created_at DESC").all(teacherId);
  const activePlan = resolvePlanId(sub?.plan, { definitions });
  const requestWithMatchingPlan = requests.find((candidate) => resolvePlanId(candidate.plan, {
    definitions,
    offerId: candidate.offer_id,
    amount: candidate.amount_omr,
    originalAmount: candidate.original_amount_omr,
  }) === activePlan);
  const request = requestWithMatchingPlan || requests[0] || null;
  const requestedPlan = request ? resolvePlanId(request.plan, {
    definitions,
    offerId: request.offer_id,
    amount: request.amount_omr,
    originalAmount: request.original_amount_omr,
  }) : null;
  const plan = isPaidPlanId(activePlan) ? activePlan : requestedPlan || activePlan || 'trial';
  const definition = definitions.find((item) => item.id === plan) || null;
  const offer = request?.offer_id ? db.prepare('SELECT * FROM subscription_offers WHERE id = ?').get(request.offer_id) : null;
  const isMatchingRequest = requestedPlan === plan;
  return {
    plan,
    planTitle: definition?.title || plan,
    offerId: isMatchingRequest ? request?.offer_id || null : null,
    offerTitle: isMatchingRequest ? offer?.title || null : null,
    amount: isMatchingRequest ? request?.amount_omr ?? null : null,
    originalAmount: isMatchingRequest ? request?.original_amount_omr ?? null : null,
    requestId: isMatchingRequest ? request?.id || null : null,
    approvedAt: isMatchingRequest ? request?.reviewed_at || null : null,
  };
}

function repairSubscriptionFromApprovedRequest(teacherId, rawSub) {
  const approved = db.prepare("SELECT * FROM payment_requests WHERE teacher_id = ? AND status = 'approved' ORDER BY datetime(COALESCE(reviewed_at, created_at)) DESC, created_at DESC LIMIT 1").get(teacherId);
  if (!approved) return rawSub;
  const definitions = getPlanDefinitions();
  const canonicalPlan = resolvePlanId(approved.plan, { definitions, offerId: approved.offer_id, amount: approved.amount_omr, originalAmount: approved.original_amount_omr });
  const selectedPlan = definitions.find((plan) => plan.id === canonicalPlan);
  if (!selectedPlan || !isPaidPlanId(canonicalPlan)) return rawSub;
  const approvedAt = approved.reviewed_at || approved.created_at || new Date().toISOString();
  const subscriptionUpdatedAt = rawSub?.updated_at ? new Date(rawSub.updated_at).getTime() : 0;
  const approvedTimestamp = new Date(approvedAt).getTime();
  const currentPlan = normalizePlanId(rawSub?.plan);
  const alreadyMatches = currentPlan === canonicalPlan
    && rawSub?.status === 'active'
    && rawSub?.current_period_start
    && (selectedPlan.duration_days === null || rawSub?.current_period_end);
  const isNewerApprovedRequest = Number.isFinite(approvedTimestamp) && approvedTimestamp > subscriptionUpdatedAt;
  if (alreadyMatches && !isNewerApprovedRequest) return rawSub;
  const end = selectedPlan.duration_days === null ? null : addDays(approvedAt, selectedPlan.duration_days);
  const now = new Date().toISOString();
  const values = [canonicalPlan, approvedAt, end, approved.reference_note || null, now];
  if (rawSub) {
    db.prepare(`UPDATE subscriptions SET plan = ?, status = 'active', trial_start_date = NULL, trial_end_date = NULL, current_period_start = ?, current_period_end = ?, payment_provider = 'bank_transfer', payment_reference = ?, updated_at = ? WHERE id = ?`).run(...values, rawSub.id);
  } else {
    db.prepare(`INSERT INTO subscriptions (id, teacher_id, plan, status, current_period_start, current_period_end, payment_provider, payment_reference, updated_at) VALUES (?, ?, ?, 'active', ?, ?, 'bank_transfer', ?, ?)`).run(uuid(), teacherId, canonicalPlan, approvedAt, end, approved.reference_note || null, now);
  }
  return db.prepare('SELECT * FROM subscriptions WHERE teacher_id = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT 1').get(teacherId);
}

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const teacher = db.prepare('SELECT id, full_name, email, subject, school_stage, school_name, locale, avatar_url FROM teachers WHERE id = ?').get(req.teacherId);
  const rawSub = db.prepare('SELECT * FROM subscriptions WHERE teacher_id = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT 1').get(req.teacherId);
  const repairedSub = repairSubscriptionFromApprovedRequest(req.teacherId, rawSub);
  // Always return a concrete subscription, but only fall back to trial when there is no
  // valid paid subscription and no approved paid request to reconcile.
  const sub = ensureTrialSubscription(req.teacherId, repairedSub);

  let trialInfo = null;
  if (sub && sub.plan === 'trial') {
    const daysLeft = Math.ceil((new Date(sub.trial_end_date) - new Date()) / (1000 * 60 * 60 * 24));
    trialInfo = {
      daysLeft,
      expired: daysLeft <= 0,
      alertLevel: daysLeft <= 1 ? 'critical' : daysLeft <= 4 ? 'warning' : 'none', // maps to day 10/13/14 style nudges
    };
  }

  // Generic activation details for ANY plan (trial or paid), used on "إدارة الاشتراك" to show
  // متبقي حتى الانتهاء regardless of which package the teacher is on.
  let subscriptionInfo = null;
  if (sub) {
    const startDate = sub.plan === 'trial' ? sub.trial_start_date : sub.current_period_start;
    const endDate = sub.plan === 'trial' ? sub.trial_end_date : sub.current_period_end;
    const daysLeft = endDate ? Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;
    subscriptionInfo = {
      ...getSubscriptionPresentation(req.teacherId, sub),
      plan: sub.plan,
      status: sub.status,
      startDate,
      endDate, // null for lifetime -> no expiry
      daysLeft, // null for lifetime
      expired: daysLeft !== null && daysLeft <= 0,
    };
  }

  res.json({ teacher, subscription: sub, trialInfo, subscriptionInfo });
});

// Package prices in OMR (Omani Rial). Activation is manual: the teacher transfers the amount
// to the app owner's phone number, then submits the receipt below for review.
const PAYMENT_PHONE = process.env.PAYMENT_PHONE || '00968737448';

// GET /api/auth/plans  -> public pricing info shown on the subscription page
router.get('/plans', (req, res) => {
  const plans = getPublicPlans();
  const publicConfig = getPublicConfig();
  res.json({
    plans,
    prices_omr: Object.fromEntries(plans.map((plan) => [plan.id, plan.price_omr])),
    base_prices_omr: getBasePrices(),
    payment_phone: publicConfig.payment.phone || PAYMENT_PHONE,
    payment: publicConfig.payment,
    announcement: publicConfig.announcement,
    trial_days: getTrialDays(),
  });
});

// GET /api/auth/public-config -> public announcement and payment display data
router.get('/public-config', (req, res) => {
  res.json(getPublicConfig());
});

// POST /api/auth/payment-requests  { plan, reference_note, receipt_image }
// Submits a bank-transfer receipt for manual review; does NOT activate the subscription immediately.
router.post('/payment-requests', requireAuth, (req, res) => {
  const { plan, offer_id, reference_note, receipt_image } = req.body;
  const canonicalPlan = resolvePlanId(plan, { offerId: offer_id });
  const basePrices = getBasePrices();
  if (!isPaidPlanId(canonicalPlan) || !basePrices[canonicalPlan]) return res.status(400).json({ error: 'باقة غير صالحة' });
  const offer = getActiveOffer(canonicalPlan);
  const originalAmount = offer ? Number(offer.original_price_omr || basePrices[canonicalPlan]) : basePrices[canonicalPlan];
  const amount = offer ? Number(offer.offer_price_omr) : basePrices[canonicalPlan];
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'سعر الباقة غير صالح' });

  const id = uuid();
  db.prepare(`INSERT INTO payment_requests (id, teacher_id, plan, amount_omr, original_amount_omr, offer_id, reference_note, receipt_image, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .run(id, req.teacherId, canonicalPlan, amount, originalAmount, offer?.id || null, reference_note || null, receipt_image || null);

  res.status(201).json({ request: db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(id) });
});

// GET /api/auth/payment-requests  -> this teacher's own submitted requests + status
router.get('/payment-requests', requireAuth, (req, res) => {
  const definitions = getPlanDefinitions();
  const requests = db.prepare('SELECT * FROM payment_requests WHERE teacher_id = ? ORDER BY created_at DESC').all(req.teacherId).map((request) => {
    const plan = resolvePlanId(request.plan, { definitions, offerId: request.offer_id, amount: request.amount_omr, originalAmount: request.original_amount_omr }) || request.plan;
    const definition = definitions.find((item) => item.id === plan);
    const offer = request.offer_id ? db.prepare('SELECT title, description FROM subscription_offers WHERE id = ?').get(request.offer_id) : null;
    return {
      ...request,
      plan,
      plan_title: definition?.title || request.plan,
      offer_title: offer?.title || null,
      offer_description: offer?.description || null,
    };
  });
  res.json({ requests });
});

module.exports = router;
