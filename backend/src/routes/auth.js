const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('../db');
require('dotenv').config();
const { signToken, requireAuth } = require('../middleware/auth');
const { sendPasswordResetEmail, emailIsConfigured } = require('../utils/mailer');

const router = express.Router();
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '14', 10);
const RESET_TOKEN_MINUTES = 30;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// POST /api/auth/register  (email/password, or google/apple with provider token in real impl)
router.post('/register', async (req, res) => {
  const { full_name, email, password, subject, school_stage, school_name, auth_provider } = req.body;
  if (!full_name || !email) return res.status(400).json({ error: 'الاسم والبريد الإلكتروني مطلوبان' });

  const existing = db.prepare('SELECT id FROM teachers WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل مسبقاً' });

  const id = uuid();
  const password_hash = password ? await bcrypt.hash(password, 10) : null;

  db.prepare(`INSERT INTO teachers (id, full_name, email, password_hash, auth_provider, subject, school_stage, school_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, full_name, email, password_hash, auth_provider || 'email', subject || null, school_stage || null, school_name || null);

  // Start 14-day free trial automatically, full feature access, no card required
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO subscriptions (id, teacher_id, plan, status, trial_start_date, trial_end_date)
              VALUES (?, ?, 'trial', 'active', ?, ?)`)
    .run(uuid(), id, now, addDays(now, TRIAL_DAYS));

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

  const teacher = db.prepare('SELECT id, full_name, email, locale FROM teachers WHERE id = ?').get(id);
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

  const token = signToken(teacher);
  res.json({ token, teacher: { id: teacher.id, full_name: teacher.full_name, email: teacher.email, locale: teacher.locale } });
});

// POST /api/auth/forgot-password  { email }
// Always responds with a generic success message (never reveals whether the email exists).
// If SMTP is configured (see backend/src/utils/mailer.js), the reset link is emailed.
// Otherwise (local/dev use with no mail server) the link is returned directly in the response
// so "نسيت كلمة المرور" still works out of the box without any extra setup.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

  const teacher = db.prepare('SELECT * FROM teachers WHERE email = ?').get(email);
  const genericMessage = 'إذا كان هذا البريد الإلكتروني مسجلاً لدينا، فستصلك رسالة تحتوي على رابط إعادة تعيين كلمة المرور خلال دقائق.';

  if (!teacher) {
    // Same response whether or not the account exists, to avoid leaking which emails are registered.
    return res.json({ success: true, message: genericMessage });
  }

  // Invalidate any previous unused tokens for this teacher, then issue a fresh one.
  db.prepare('DELETE FROM password_resets WHERE teacher_id = ? AND used = 0').run(teacher.id);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (id, teacher_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), teacher.id, token, expiresAt);

  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetLink = `${frontendBase}/reset-password?token=${token}`;

  if (emailIsConfigured()) {
    await sendPasswordResetEmail(teacher.email, teacher.full_name, resetLink);
    return res.json({ success: true, message: genericMessage });
  }

  // Dev fallback: no SMTP configured, so hand back the link directly instead of silently failing.
  console.log(`[password reset] لا يوجد إعداد بريد (SMTP) — رابط إعادة التعيين لـ ${teacher.email}:\n${resetLink}`);
  return res.json({ success: true, message: genericMessage, devMode: true, resetLink });
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

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const teacher = db.prepare('SELECT id, full_name, email, subject, school_stage, school_name, locale, avatar_url FROM teachers WHERE id = ?').get(req.teacherId);
  const sub = db.prepare('SELECT * FROM subscriptions WHERE teacher_id = ? ORDER BY created_at DESC LIMIT 1').get(req.teacherId);

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
const PLAN_PRICES_OMR = { '6_months': 4, yearly: 7, lifetime: 18 };
const PAYMENT_PHONE = '00968737448';

// GET /api/auth/plans  -> public pricing info shown on the subscription page
router.get('/plans', (req, res) => {
  res.json({ prices_omr: PLAN_PRICES_OMR, payment_phone: PAYMENT_PHONE });
});

// POST /api/auth/payment-requests  { plan, reference_note, receipt_image }
// Submits a bank-transfer receipt for manual review; does NOT activate the subscription immediately.
router.post('/payment-requests', requireAuth, (req, res) => {
  const { plan, reference_note, receipt_image } = req.body;
  if (!PLAN_PRICES_OMR[plan]) return res.status(400).json({ error: 'باقة غير صالحة' });

  const id = uuid();
  db.prepare(`INSERT INTO payment_requests (id, teacher_id, plan, amount_omr, reference_note, receipt_image, status)
              VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
    .run(id, req.teacherId, plan, PLAN_PRICES_OMR[plan], reference_note || null, receipt_image || null);

  res.status(201).json({ request: db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(id) });
});

// GET /api/auth/payment-requests  -> this teacher's own submitted requests + status
router.get('/payment-requests', requireAuth, (req, res) => {
  const requests = db.prepare('SELECT * FROM payment_requests WHERE teacher_id = ? ORDER BY created_at DESC').all(req.teacherId);
  res.json({ requests });
});

module.exports = router;
