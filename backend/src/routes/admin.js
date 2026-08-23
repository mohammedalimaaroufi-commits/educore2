const express = require('express');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { signAdminToken, requireAdmin } = require('../middleware/auth');
const { getTrialDays, getPublicPlans, getPlanDefinitions, savePlanDefinitions, getBasePrices, normalizePlanId, resolvePlanId, isPaidPlanId, repairPaidSubscriptionPeriod, reconcileApprovedSubscription } = require('../utils/subscriptions');
const { getAdminPublicConfig, savePublicConfig } = require('../utils/publicConfig');
const { RESTRICTABLE_FEATURES, getConfiguredRestrictions, saveTeacherRestrictions, getEffectiveRestrictions } = require('../utils/restrictions');
const { getAccountStatus, saveAccountStatus } = require('../utils/accountStatus');

const router = express.Router();

const MESSAGE_RETENTION_HOURS = 24;
function purgeExpiredMessages() {
  db.prepare("DELETE FROM messages WHERE datetime(created_at) < datetime('now', ?)").run(`-${MESSAGE_RETENTION_HOURS} hours`);
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_this_admin_password';

function emitSubscriptionConfigUpdated(req) {
  const io = req.app.get('io');
  if (io) io.to('public').emit('subscription_config_updated', { updated_at: new Date().toISOString() });
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// POST /api/admin/login  { password }  -> private console, separate from teacher accounts
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  res.json({ token: signAdminToken() });
});

router.use(requireAdmin);

// GET /api/admin/public-config -> payment details and announcement editor state
router.get('/public-config', (req, res) => {
  res.json({ config: getAdminPublicConfig() });
});

// PATCH /api/admin/public-config -> saves payment details and announcement fields in app_settings
router.patch('/public-config', (req, res) => {
  const input = req.body || {};
  if (input.payment_phone !== undefined && String(input.payment_phone).trim().length < 3) return res.status(400).json({ error: 'رقم التحويل غير صالح' });
  if (input.announcement_enabled !== undefined && !['0', '1', 'true', 'false', true, false].includes(input.announcement_enabled)) return res.status(400).json({ error: 'حالة الإعلان غير صالحة' });
  if (input.announcement_starts_at && Number.isNaN(new Date(input.announcement_starts_at).getTime())) return res.status(400).json({ error: 'تاريخ بداية الإعلان غير صالح' });
  if (input.announcement_ends_at && Number.isNaN(new Date(input.announcement_ends_at).getTime())) return res.status(400).json({ error: 'تاريخ نهاية الإعلان غير صالح' });
  if (input.announcement_starts_at && input.announcement_ends_at && new Date(input.announcement_ends_at) < new Date(input.announcement_starts_at)) return res.status(400).json({ error: 'تاريخ نهاية الإعلان يجب أن يأتي بعد تاريخ البداية' });
  if (Array.isArray(input.announcement_notifications)) {
    for (const notification of input.announcement_notifications) {
      if (notification?.starts_at && Number.isNaN(new Date(notification.starts_at).getTime())) return res.status(400).json({ error: 'تاريخ بداية الإشعار غير صالح' });
      if (notification?.ends_at && Number.isNaN(new Date(notification.ends_at).getTime())) return res.status(400).json({ error: 'تاريخ نهاية الإشعار غير صالح' });
      if (notification?.starts_at && notification?.ends_at && new Date(notification.ends_at) < new Date(notification.starts_at)) return res.status(400).json({ error: 'تاريخ نهاية الإشعار يجب أن يأتي بعد تاريخ البداية' });
    }
  }
  const config = savePublicConfig(input);
  const io = req.app.get('io');
  if (io) {
    const announcementKeys = ['announcement_enabled', 'announcement_type', 'announcement_title_ar', 'announcement_title_en', 'announcement_message_ar', 'announcement_message_en', 'announcement_starts_at', 'announcement_ends_at', 'announcement_cta_label_ar', 'announcement_cta_label_en', 'announcement_cta_url'];
    io.to('public').emit('public_config_updated', {
      updated_at: new Date().toISOString(),
      announcement: announcementKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key)),
      notifications: Object.prototype.hasOwnProperty.call(input, 'announcement_notifications'),
    });
  }
  res.json({ config });
});

// GET /api/admin/subscription-config -> current trial setting, plans, and active offers
router.get('/subscription-config', (req, res) => {
  const offers = db.prepare('SELECT * FROM subscription_offers ORDER BY updated_at DESC, created_at DESC').all();
  res.json({ trial_days: getTrialDays(), plans: getPublicPlans(), plan_definitions: getPlanDefinitions(), offers });
});

// PATCH /api/admin/subscription-config { trial_days }
router.patch('/subscription-config', (req, res) => {
  if (req.body.trial_days !== undefined) {
    const trialDays = Number(req.body.trial_days);
    if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365) return res.status(400).json({ error: 'مدة التجربة يجب أن تكون بين يوم و365 يومًا' });
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('trial_days', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(String(trialDays));
  }
  if (req.body.plan_definitions !== undefined) {
    if (!Array.isArray(req.body.plan_definitions)) return res.status(400).json({ error: 'بيانات الباقات غير صالحة' });
    for (const plan of req.body.plan_definitions) {
      const price = Number(plan?.base_price_omr);
      if (!['6_months', 'yearly', 'lifetime'].includes(plan?.id) || !Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: 'تحقق من أسماء الباقات وأسعارها' });
      }
    }
    savePlanDefinitions(req.body.plan_definitions);
  }
  emitSubscriptionConfigUpdated(req);
  res.json({ trial_days: getTrialDays(), plans: getPublicPlans(), plan_definitions: getPlanDefinitions() });
});

router.post('/offers', (req, res) => {
  const { plan, title, description, original_price_omr, offer_price_omr, starts_at, ends_at, enabled } = req.body;
  const canonicalPlan = normalizePlanId(plan);
  const basePrices = getBasePrices();
  if (!isPaidPlanId(canonicalPlan) || !basePrices[canonicalPlan]) return res.status(400).json({ error: 'الخطة غير صالحة' });
  const original = Number(original_price_omr || basePrices[canonicalPlan]);
  const offer = Number(offer_price_omr);
  if (!Number.isFinite(original) || !Number.isFinite(offer) || original <= 0 || offer <= 0 || offer > original) return res.status(400).json({ error: 'تحقق من السعر الأصلي وسعر العرض' });
  const id = uuid();
  db.prepare(`INSERT INTO subscription_offers (id, plan, title, description, original_price_omr, offer_price_omr, starts_at, ends_at, enabled)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, canonicalPlan, title || 'عرض خاص', description || null, original, offer, starts_at || null, ends_at || null, enabled === false ? 0 : 1);
  emitSubscriptionConfigUpdated(req);
  res.status(201).json({ offer: db.prepare('SELECT * FROM subscription_offers WHERE id = ?').get(id) });
});

router.patch('/offers/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM subscription_offers WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'العرض غير موجود' });
  const next = { ...current, ...req.body };
  const canonicalPlan = normalizePlanId(next.plan);
  const basePrices = getBasePrices();
  if (!isPaidPlanId(canonicalPlan) || !basePrices[canonicalPlan]) return res.status(400).json({ error: 'الخطة غير صالحة' });
  const original = Number(next.original_price_omr);
  const offer = Number(next.offer_price_omr);
  if (!Number.isFinite(original) || !Number.isFinite(offer) || original <= 0 || offer <= 0 || offer > original) return res.status(400).json({ error: 'تحقق من السعر الأصلي وسعر العرض' });
  db.prepare(`UPDATE subscription_offers SET plan = ?, title = ?, description = ?, original_price_omr = ?, offer_price_omr = ?, starts_at = ?, ends_at = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(canonicalPlan, next.title || null, next.description || null, original, offer, next.starts_at || null, next.ends_at || null, next.enabled ? 1 : 0, current.id);
  emitSubscriptionConfigUpdated(req);
  res.json({ offer: db.prepare('SELECT * FROM subscription_offers WHERE id = ?').get(current.id) });
});

router.delete('/offers/:id', (req, res) => {
  const result = db.prepare('DELETE FROM subscription_offers WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'العرض غير موجود' });
  emitSubscriptionConfigUpdated(req);
  res.json({ success: true });
});

// Password reset requests are intentionally handled by the administrator. The reset link is
// generated only after review and returned to the private console for manual email delivery.
router.get('/password-reset-requests', (req, res) => {
  const status = req.query.status || 'pending';
  const where = status === 'all' ? '' : 'WHERE pr.status = ?';
  const params = status === 'all' ? [] : [status];
  const requests = db.prepare(`SELECT pr.*, t.full_name, t.email FROM password_reset_requests pr JOIN teachers t ON t.id = pr.teacher_id ${where} ORDER BY pr.created_at DESC`).all(...params);
  res.json({ requests });
});

router.post('/password-reset-requests/:id/generate-link', (req, res) => {
  const request = db.prepare(`SELECT pr.*, t.full_name, t.email FROM password_reset_requests pr JOIN teachers t ON t.id = pr.teacher_id WHERE pr.id = ?`).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'طلب إعادة التعيين غير موجود' });
  if (request.status === 'closed') return res.status(400).json({ error: 'تم إغلاق الطلب' });
  db.prepare('DELETE FROM password_resets WHERE teacher_id = ? AND used = 0').run(request.teacher_id);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (id, teacher_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuid(), request.teacher_id, token, expiresAt);
  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetLink = `${frontendBase}/reset-password?token=${token}`;
  db.prepare("UPDATE password_reset_requests SET status = 'link_generated', admin_note = ?, reviewed_at = datetime('now') WHERE id = ?").run(req.body.admin_note || null, request.id);
  res.json({ success: true, request: db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(request.id), reset_link: resetLink, expires_at: expiresAt });
});

router.post('/password-reset-requests/:id/close', (req, res) => {
  const result = db.prepare("UPDATE password_reset_requests SET status = 'closed', admin_note = COALESCE(?, admin_note), reviewed_at = datetime('now') WHERE id = ?").run(req.body.admin_note || null, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'طلب إعادة التعيين غير موجود' });
  res.json({ success: true });
});

// GET /api/admin/payment-requests?status=pending|approved|rejected&archived=1  -> incoming transfer receipts
// By default only non-archived requests are returned; pass archived=1 to view the archive instead.
router.get('/payment-requests', (req, res) => {
  const { status } = req.query;
  const archived = req.query.archived === '1' ? 1 : 0;
  const clauses = ['pr.archived = ?'];
  const params = [archived];
  if (status) { clauses.push('pr.status = ?'); params.push(status); }
  const query = `SELECT pr.*, t.full_name, t.email FROM payment_requests pr JOIN teachers t ON pr.teacher_id = t.id
                  WHERE ${clauses.join(' AND ')} ORDER BY pr.created_at DESC`;
  const definitions = getPlanDefinitions();
  const rows = db.prepare(query).all(...params).map((request) => {
    const plan = resolvePlanId(request.plan, {
      definitions,
      offerId: request.offer_id,
      amount: request.amount_omr,
      originalAmount: request.original_amount_omr,
    }) || request.plan;
    const definition = definitions.find((item) => item.id === plan);
    const offer = request.offer_id ? db.prepare('SELECT title, description FROM subscription_offers WHERE id = ?').get(request.offer_id) : null;
    return {
      ...request,
      plan,
      plan_title: definition?.title || request.plan || null,
      offer_title: offer?.title || null,
      offer_description: offer?.description || null,
    };
  });
  res.json({ requests: rows });
});

// POST /api/admin/payment-requests/:id/archive  -> hide from the main list, recoverable
router.post('/payment-requests/:id/archive', (req, res) => {
  const result = db.prepare('UPDATE payment_requests SET archived = 1 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ success: true });
});

// POST /api/admin/payment-requests/:id/restore  -> bring an archived request back to the main list
router.post('/payment-requests/:id/restore', (req, res) => {
  const result = db.prepare('UPDATE payment_requests SET archived = 0 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ success: true });
});

// DELETE /api/admin/payment-requests/:id  -> permanent delete (does not touch the teacher's subscription)
router.delete('/payment-requests/:id', (req, res) => {
  const result = db.prepare('DELETE FROM payment_requests WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ success: true });
});

// PATCH /api/admin/teachers/:teacherId/account-status { status: active|disabled|banned, note }
router.patch('/teachers/:teacherId/account-status', (req, res) => {
  const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(req.params.teacherId);
  if (!teacher) return res.status(404).json({ error: 'المعلم غير موجود' });
  const accountStatus = saveAccountStatus(teacher.id, { status: req.body?.status, note: req.body?.note });
  res.json({ account_status: accountStatus });
});

// DELETE /api/admin/teachers/:teacherId -> permanently remove a teacher and owned records
router.delete('/teachers/:teacherId', (req, res) => {
  const teacher = db.prepare('SELECT id, email FROM teachers WHERE id = ?').get(req.params.teacherId);
  if (!teacher) return res.status(404).json({ error: 'المعلم غير موجود' });
  const removeOwnedData = db.transaction(() => {
    const teacherId = teacher.id;
    db.prepare(`DELETE FROM grades WHERE assessment_id IN (
      SELECT a.id FROM assessments a
      JOIN grade_categories gc ON gc.id = a.category_id
      JOIN classes c ON c.id = gc.class_id
      WHERE c.teacher_id = ?
    ) OR student_id IN (SELECT s.id FROM students s JOIN classes c ON c.id = s.class_id WHERE c.teacher_id = ?)`).run(teacherId, teacherId);
    db.prepare(`DELETE FROM behavior_logs WHERE behavior_type_id IN (
      SELECT bt.id FROM behavior_types bt JOIN classes c ON c.id = bt.class_id WHERE c.teacher_id = ?
    ) OR student_id IN (SELECT s.id FROM students s JOIN classes c ON c.id = s.class_id WHERE c.teacher_id = ?)`).run(teacherId, teacherId);
    db.prepare(`DELETE FROM attendance_records WHERE session_id IN (SELECT ats.id FROM attendance_sessions ats JOIN classes c ON c.id = ats.class_id WHERE c.teacher_id = ?) OR student_id IN (SELECT s.id FROM students s JOIN classes c ON c.id = s.class_id WHERE c.teacher_id = ?)`).run(teacherId, teacherId);
    db.prepare('DELETE FROM assessments WHERE category_id IN (SELECT gc.id FROM grade_categories gc JOIN classes c ON c.id = gc.class_id WHERE c.teacher_id = ?)').run(teacherId);
    db.prepare('DELETE FROM grade_categories WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)').run(teacherId);
    db.prepare('DELETE FROM behavior_types WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)').run(teacherId);
    db.prepare('DELETE FROM attendance_sessions WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)').run(teacherId);
    db.prepare('DELETE FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)').run(teacherId);
    db.prepare('DELETE FROM classes WHERE teacher_id = ?').run(teacherId);
    db.prepare('DELETE FROM grading_scheme_categories WHERE scheme_id IN (SELECT id FROM grading_schemes WHERE teacher_id = ?)').run(teacherId);
    db.prepare('DELETE FROM grading_schemes WHERE teacher_id = ?').run(teacherId);
    for (const table of ['subscriptions', 'comment_templates', 'payment_requests', 'grade_recommendation_rules', 'messages', 'password_resets', 'password_reset_requests', 'behavior_type_templates']) {
      db.prepare(`DELETE FROM ${table} WHERE teacher_id = ?`).run(teacherId);
    }
    db.prepare('DELETE FROM app_settings WHERE key IN (?, ?)').run(`teacher_restrictions:${teacherId}`, `teacher_account_status:${teacherId}`);
    db.prepare('DELETE FROM teachers WHERE id = ?').run(teacherId);
  });
  removeOwnedData();
  res.json({ success: true, deleted_teacher_id: teacher.id, email: teacher.email });
});

// GET /api/admin/teachers/:teacherId/restrictions
router.get('/teachers/:teacherId/restrictions', (req, res) => {
  const teacher = db.prepare('SELECT id, full_name, email FROM teachers WHERE id = ?').get(req.params.teacherId);
  if (!teacher) return res.status(404).json({ error: 'المعلم غير موجود' });
  const rawSubscription = db.prepare(`SELECT * FROM subscriptions WHERE teacher_id = ? ORDER BY CASE WHEN plan IN ('6_months', 'yearly', 'lifetime') THEN 0 ELSE 1 END, CASE WHEN status = 'active' THEN 0 ELSE 1 END, datetime(COALESCE(updated_at, created_at)) DESC LIMIT 1`).get(teacher.id);
  const subscription = repairPaidSubscriptionPeriod(reconcileApprovedSubscription(teacher.id, rawSubscription), { definitions: getPlanDefinitions() });
  res.json({ teacher, restrictions: getConfiguredRestrictions(teacher.id), effective: getEffectiveRestrictions(teacher.id, subscription), features: RESTRICTABLE_FEATURES });
});

// PATCH /api/admin/teachers/:teacherId/restrictions
router.patch('/teachers/:teacherId/restrictions', (req, res) => {
  const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(req.params.teacherId);
  if (!teacher) return res.status(404).json({ error: 'المعلم غير موجود' });
  const restrictions = saveTeacherRestrictions(teacher.id, req.body?.restrictions || req.body || {});
  res.json({ restrictions, features: RESTRICTABLE_FEATURES });
});

// POST /api/admin/payment-requests/:id/approve  { admin_note }
// Activates the teacher's subscription for the requested plan immediately.
router.post('/payment-requests/:id/approve', (req, res) => {
  const request = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

  const now = new Date().toISOString();
  const definitions = getPlanDefinitions();
  const canonicalPlan = resolvePlanId(request.plan, {
    definitions,
    offerId: request.offer_id,
    amount: request.amount_omr,
    originalAmount: request.original_amount_omr,
  });
  if (!isPaidPlanId(canonicalPlan)) {
    return res.status(400).json({
      error: 'الباقة المرتبطة بالطلب غير موجودة أو غير صالحة للتفعيل',
      plan: request.plan || null,
      request_id: request.id,
    });
  }
  const selectedPlan = definitions.find((plan) => plan.id === canonicalPlan);
  if (!selectedPlan) return res.status(400).json({ error: 'تعذر العثور على تعريف الباقة. أعد حفظ الباقات الأساسية من لوحة المسؤول ثم أعد المحاولة.' });
  const periodEnd = selectedPlan.duration_days === null ? null : addDays(now, selectedPlan.duration_days);

  const activate = db.transaction(() => {
    const current = db.prepare(`SELECT id FROM subscriptions WHERE teacher_id = ? AND status = 'active' ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT 1`).get(request.teacher_id);
    let subscriptionId = current?.id;
    if (current?.id) {
      db.prepare(`UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE teacher_id = ? AND id <> ? AND status = 'active'`).run(now, request.teacher_id, current.id);
      db.prepare(`UPDATE subscriptions SET plan = ?, status = 'active', trial_start_date = NULL, trial_end_date = NULL,
                  current_period_start = ?, current_period_end = ?, payment_provider = 'bank_transfer', payment_reference = ?, updated_at = ? WHERE id = ?`)
        .run(canonicalPlan, now, periodEnd, request.reference_note || null, now, current.id);
    } else {
      subscriptionId = uuid();
      db.prepare(`INSERT INTO subscriptions (id, teacher_id, plan, status, trial_start_date, trial_end_date, current_period_start, current_period_end, payment_provider, payment_reference, updated_at)
                  VALUES (?, ?, ?, 'active', NULL, NULL, ?, ?, 'bank_transfer', ?, ?)`)
        .run(subscriptionId, request.teacher_id, canonicalPlan, now, periodEnd, request.reference_note || null, now);
    }
    // A teacher can have only one active subscription, even if legacy duplicate rows exist.
    db.prepare(`UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE teacher_id = ? AND id <> ? AND status = 'active'`).run(now, request.teacher_id, subscriptionId);
    db.prepare(`UPDATE payment_requests SET plan = ?, status = 'approved', admin_note = ?, reviewed_at = ? WHERE id = ?`)
      .run(canonicalPlan, req.body.admin_note || null, now, request.id);
  });
  activate();

  const subscription = db.prepare('SELECT * FROM subscriptions WHERE teacher_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1').get(request.teacher_id);
  res.json({ success: true, subscription, request: db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(request.id) });
});

// POST /api/admin/payment-requests/:id/reject  { admin_note }
router.post('/payment-requests/:id/reject', (req, res) => {
  const request = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
  db.prepare(`UPDATE payment_requests SET status = 'rejected', admin_note = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .run(req.body.admin_note || null, request.id);
  res.json({ success: true });
});

// GET /api/admin/teachers  -> quick overview of all registered teachers + their subscription state
// Keep this list route deliberately conservative for both SQLite and Turso/libSQL:
// use simple reads and aggregate in memory, while loading restrictions on demand.
router.get('/teachers', (req, res) => {
  let definitions = [];
  try { definitions = getPlanDefinitions(); } catch (error) { console.error('Unable to load subscription definitions for admin teachers list', error); }
  const teacherRows = db.prepare('SELECT id, full_name, email, school_name, created_at FROM teachers ORDER BY created_at DESC').all();
  let subscriptionRows = [];
  try {
    subscriptionRows = db.prepare('SELECT id, teacher_id, plan, status, trial_start_date, trial_end_date, current_period_start, current_period_end, updated_at, created_at FROM subscriptions').all();
  } catch (error) {
    console.error('Unable to load subscriptions for admin teachers list', error);
  }
  const subscriptionByTeacher = new Map();
  const subscriptionRank = (item) => [
    ['6_months', 'yearly', 'lifetime'].includes(item.plan) ? 0 : 1,
    item.status === 'active' ? 0 : 1,
    -(new Date(item.updated_at || item.created_at || 0).getTime() || 0),
  ];
  for (const item of subscriptionRows) {
    const key = String(item.teacher_id);
    const current = subscriptionByTeacher.get(key);
    if (!current || subscriptionRank(item).join('|') < subscriptionRank(current).join('|')) subscriptionByTeacher.set(key, item);
  }

  // Approved payments are still the display authority, but the list uses one plain
  // query and a map instead of a window function or one query per teacher.
  let approvedRows = [];
  try {
    approvedRows = db.prepare("SELECT teacher_id, plan, offer_id, amount_omr, original_amount_omr, reviewed_at, created_at FROM payment_requests WHERE status = 'approved' ORDER BY COALESCE(reviewed_at, created_at) DESC, created_at DESC, id DESC").all();
  } catch (error) {
    console.error('Unable to load approved payments for admin teachers list', error);
  }
  const approvedByTeacher = new Map();
  for (const item of approvedRows) {
    const key = String(item.teacher_id);
    if (!approvedByTeacher.has(key)) approvedByTeacher.set(key, item);
  }

  // Account status is a small key-value record. Read all such records once; the
  // detailed restriction document is deliberately excluded from this fast list.
  let statusRows = [];
  try {
    statusRows = db.prepare("SELECT key, value, updated_at FROM app_settings WHERE key LIKE 'teacher_account_status:%'").all();
  } catch (error) {
    console.error('Unable to load account statuses for admin teachers list', error);
  }
  const statusByTeacher = new Map();
  for (const item of statusRows) {
    const teacherId = item.key.slice('teacher_account_status:'.length);
    let parsed = {};
    try { parsed = JSON.parse(item.value || '{}'); } catch { parsed = {}; }
    const rawStatus = String(parsed.status || '').toLowerCase();
    const status = ['active', 'disabled', 'banned'].includes(rawStatus) ? rawStatus : 'active';
    statusByTeacher.set(String(teacherId), { status, note: String(parsed.note || '').trim().slice(0, 500), updated_at: item.updated_at || null });
  }

  const teachers = teacherRows.map((teacher) => {
    const subscription = subscriptionByTeacher.get(String(teacher.id));
    const row = {
      ...teacher,
      subscription_id: subscription?.id || null,
      plan: subscription?.plan || 'trial',
      status: subscription?.status || null,
      trial_start_date: subscription?.trial_start_date || null,
      trial_end_date: subscription?.trial_end_date || null,
      current_period_start: subscription?.current_period_start || null,
      current_period_end: subscription?.current_period_end || null,
    };
    const latestApproved = approvedByTeacher.get(String(teacher.id));
    const approvedPlan = latestApproved
      ? resolvePlanId(latestApproved.plan, {
        definitions,
        offerId: latestApproved.offer_id,
        amount: latestApproved.amount_omr,
        originalAmount: latestApproved.original_amount_omr,
      })
      : null;
    const approvedDefinition = definitions.find((item) => item.id === approvedPlan);
    const approvedStart = latestApproved ? (latestApproved.reviewed_at || latestApproved.created_at) : null;
    const approvedEnd = approvedDefinition?.duration_days === null
      ? null
      : approvedDefinition && approvedStart
        ? addDays(approvedStart, approvedDefinition.duration_days)
        : null;
    const hasApprovedPaidPlan = isPaidPlanId(approvedPlan);
    const rawPlan = row.plan || 'trial';
    const plan = hasApprovedPaidPlan ? approvedPlan : resolvePlanId(rawPlan, { definitions }) || rawPlan;
    const definition = definitions.find((item) => item.id === plan);
    const startDate = hasApprovedPaidPlan ? approvedStart : (plan === 'trial' ? row.trial_start_date : row.current_period_start);
    const endDate = hasApprovedPaidPlan ? approvedEnd : (plan === 'trial' ? row.trial_end_date : row.current_period_end);
    const daysLeft = endDate ? Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
    const accountStatus = statusByTeacher.get(String(teacher.id)) || { status: 'active', note: '', updated_at: null };
    return {
      ...row,
      plan,
      plan_title: definition?.title || plan,
      activated_at: startDate || null,
      expires_at: endDate || null,
      days_left: daysLeft,
      paid_amount: hasApprovedPaidPlan ? latestApproved.amount_omr : null,
      approved_at: hasApprovedPaidPlan ? latestApproved.reviewed_at || latestApproved.created_at : null,
      account_status: accountStatus.status,
      account_note: accountStatus.note,
    };
  });
  res.json({ teachers });
});

// ---------- Live chat with teachers ----------

// GET /api/admin/conversations  -> one row per teacher who has exchanged messages, with last message + unread count
router.get('/conversations', (req, res) => {
  purgeExpiredMessages();
  const rows = db.prepare(`
    WITH ranked_messages AS (
      SELECT
        m.teacher_id,
        m.text,
        m.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY m.teacher_id
          ORDER BY m.created_at DESC, m.id DESC
        ) AS message_rank,
        SUM(CASE WHEN m.sender = 'teacher' AND m.read_by_admin = 0 THEN 1 ELSE 0 END)
          OVER (PARTITION BY m.teacher_id) AS unread_count
      FROM messages m
      WHERE datetime(m.created_at) >= datetime('now', '-24 hours')
    )
    SELECT
      t.id AS teacher_id,
      t.full_name,
      t.email,
      r.text AS last_message,
      r.created_at AS last_message_at,
      r.unread_count
    FROM ranked_messages r
    JOIN teachers t ON t.id = r.teacher_id
    WHERE r.message_rank = 1
    ORDER BY r.created_at DESC
  `).all();
  res.json({ conversations: rows });
});

// GET /api/admin/messages/:teacherId  -> full conversation history with one teacher
router.get('/messages/:teacherId', (req, res) => {
  purgeExpiredMessages();
  const messages = db.prepare("SELECT * FROM messages WHERE teacher_id = ? AND datetime(created_at) >= datetime('now', '-24 hours') ORDER BY created_at ASC").all(req.params.teacherId);
  db.prepare("UPDATE messages SET read_by_admin = 1 WHERE teacher_id = ? AND sender = 'teacher' AND read_by_admin = 0").run(req.params.teacherId);
  res.json({ messages });
});

// POST /api/admin/messages/:teacherId  { text }  -> admin replies to a specific teacher
router.post('/messages/:teacherId', (req, res) => {
  purgeExpiredMessages();
  const { text, client_message_id } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'الرسالة لا يمكن أن تكون فارغة' });
  const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(req.params.teacherId);
  if (!teacher) return res.status(404).json({ error: 'المعلم غير موجود' });
  if (client_message_id) {
    const previous = db.prepare('SELECT * FROM messages WHERE teacher_id = ? AND sender = ? AND client_message_id = ?').get(req.params.teacherId, 'admin', client_message_id);
    if (previous) return res.json({ message: previous, reused: true });
  }

  const id = uuid();
  db.prepare(`INSERT INTO messages (id, teacher_id, sender, text, read_by_teacher, read_by_admin, client_message_id) VALUES (?, ?, 'admin', ?, 0, 1, ?)`)
    .run(id, req.params.teacherId, text.trim(), client_message_id || null);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${req.params.teacherId}`).emit('new_message', message);
    io.to('admin').emit('new_message', message);
  }

  res.status(201).json({ message });
});

// POST /api/admin/broadcast  { text }  -> sends one message to every registered teacher's conversation
router.post('/broadcast', (req, res) => {
  purgeExpiredMessages();
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'الرسالة لا يمكن أن تكون فارغة' });

  const teachers = db.prepare('SELECT id FROM teachers').all();
  const insert = db.prepare(`INSERT INTO messages (id, teacher_id, sender, text, read_by_teacher, read_by_admin) VALUES (?, ?, 'admin', ?, 0, 1)`);
  const io = req.app.get('io');

  const sendAll = db.transaction((rows) => {
    const sent = [];
    for (const t of rows) {
      const id = uuid();
      insert.run(id, t.id, text.trim());
      sent.push(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
    }
    return sent;
  });
  const sent = sendAll(teachers);

  if (io) {
    sent.forEach((message) => io.to(`chat:${message.teacher_id}`).emit('new_message', message));
    sent.forEach((message) => io.to('admin').emit('new_message', message));
  }

  res.status(201).json({ success: true, sentTo: sent.length });
});

module.exports = router;
