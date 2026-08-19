const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/settings/comment-templates?category=grade|behavior|attendance|general
router.get('/comment-templates', (req, res) => {
  const { category } = req.query;
  const templates = category
    ? db.prepare('SELECT * FROM comment_templates WHERE teacher_id = ? AND category = ? ORDER BY created_at DESC').all(req.teacherId, category)
    : db.prepare('SELECT * FROM comment_templates WHERE teacher_id = ? ORDER BY created_at DESC').all(req.teacherId);
  res.json({ templates });
});

// POST /api/settings/comment-templates  { text, category }
router.post('/comment-templates', (req, res) => {
  const { text, category } = req.body;
  if (!text) return res.status(400).json({ error: 'نص العبارة مطلوب' });
  const id = uuid();
  db.prepare('INSERT INTO comment_templates (id, teacher_id, text, category) VALUES (?, ?, ?, ?)').run(id, req.teacherId, text, category || 'general');
  res.status(201).json({ template: db.prepare('SELECT * FROM comment_templates WHERE id = ?').get(id) });
});

// PATCH /api/settings/comment-templates/:id
router.patch('/comment-templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM comment_templates WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!t) return res.status(404).json({ error: 'العبارة غير موجودة' });
  const { text, category } = req.body;
  db.prepare('UPDATE comment_templates SET text = COALESCE(?, text), category = COALESCE(?, category) WHERE id = ?').run(text, category, t.id);
  res.json({ template: db.prepare('SELECT * FROM comment_templates WHERE id = ?').get(t.id) });
});

// DELETE /api/settings/comment-templates/:id
router.delete('/comment-templates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM comment_templates WHERE id = ? AND teacher_id = ?').run(req.params.id, req.teacherId);
  if (result.changes === 0) return res.status(404).json({ error: 'العبارة غير موجودة' });
  res.json({ success: true });
});

// PATCH /api/settings/profile  (edit teacher profile fields)
router.patch('/profile', (req, res) => {
  const fields = ['full_name', 'subject', 'school_stage', 'school_name', 'avatar_url', 'locale'];
  const updates = {};
  fields.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  if (setClause) db.prepare(`UPDATE teachers SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: req.teacherId });
  res.json({ teacher: db.prepare('SELECT id, full_name, email, subject, school_stage, school_name, locale, avatar_url FROM teachers WHERE id = ?').get(req.teacherId) });
});

// ---------- Grade-based auto-recommendation rules ----------
// A rule maps a final-grade range to a ready-made descriptive phrase, so student reports
// can auto-suggest wording proportional to the final grade instead of the teacher typing it each time.

// GET /api/settings/grade-recommendations
router.get('/grade-recommendations', (req, res) => {
  const rules = db.prepare('SELECT * FROM grade_recommendation_rules WHERE teacher_id = ? ORDER BY sort_order').all(req.teacherId);
  res.json({ rules });
});

// POST /api/settings/grade-recommendations  { min_score, max_score, text }
router.post('/grade-recommendations', (req, res) => {
  const { min_score, max_score, text } = req.body;
  if (min_score === undefined || max_score === undefined || !text) return res.status(400).json({ error: 'الحقول مطلوبة' });
  const id = uuid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM grade_recommendation_rules WHERE teacher_id = ?').get(req.teacherId).m;
  db.prepare('INSERT INTO grade_recommendation_rules (id, teacher_id, min_score, max_score, text, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.teacherId, min_score, max_score, text, maxOrder + 1);
  res.status(201).json({ rule: db.prepare('SELECT * FROM grade_recommendation_rules WHERE id = ?').get(id) });
});

// PATCH /api/settings/grade-recommendations/:id
router.patch('/grade-recommendations/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM grade_recommendation_rules WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!rule) return res.status(404).json({ error: 'القاعدة غير موجودة' });
  const { min_score, max_score, text } = req.body;
  db.prepare(`UPDATE grade_recommendation_rules SET min_score = COALESCE(?, min_score), max_score = COALESCE(?, max_score), text = COALESCE(?, text) WHERE id = ?`)
    .run(min_score, max_score, text, rule.id);
  res.json({ rule: db.prepare('SELECT * FROM grade_recommendation_rules WHERE id = ?').get(rule.id) });
});

// DELETE /api/settings/grade-recommendations/:id
router.delete('/grade-recommendations/:id', (req, res) => {
  const result = db.prepare('DELETE FROM grade_recommendation_rules WHERE id = ? AND teacher_id = ?').run(req.params.id, req.teacherId);
  if (result.changes === 0) return res.status(404).json({ error: 'القاعدة غير موجودة' });
  res.json({ success: true });
});

// ---------- Behavior presets ("تحرير السلوك المخصص") ----------
// A teacher-level starter list of behavior types, applied automatically to every new class
// instead of the built-in defaults. Managed from الإعدادات العامة, separate from a class's
// own live behavior list (which stays editable per-class from تبويب السلوك).

// GET /api/settings/behavior-templates
router.get('/behavior-templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM behavior_type_templates WHERE teacher_id = ? ORDER BY sort_order').all(req.teacherId);
  res.json({ templates });
});

// POST /api/settings/behavior-templates  { label, polarity, points, icon }
router.post('/behavior-templates', (req, res) => {
  const { label, polarity, points, icon } = req.body;
  if (!label) return res.status(400).json({ error: 'اسم السلوك مطلوب' });
  const id = uuid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM behavior_type_templates WHERE teacher_id = ?').get(req.teacherId).m;
  db.prepare(`INSERT INTO behavior_type_templates (id, teacher_id, label, polarity, points, icon, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.teacherId, label, polarity || 'positive', points ?? (polarity === 'negative' ? -1 : 1), icon || 'star', maxOrder + 1);
  res.status(201).json({ template: db.prepare('SELECT * FROM behavior_type_templates WHERE id = ?').get(id) });
});

// PATCH /api/settings/behavior-templates/:id
router.patch('/behavior-templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM behavior_type_templates WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!t) return res.status(404).json({ error: 'السلوك غير موجود' });
  const { label, polarity, points, icon } = req.body;
  db.prepare(`UPDATE behavior_type_templates SET label = COALESCE(?, label), polarity = COALESCE(?, polarity),
              points = COALESCE(?, points), icon = COALESCE(?, icon) WHERE id = ?`)
    .run(label, polarity, points, icon, t.id);
  res.json({ template: db.prepare('SELECT * FROM behavior_type_templates WHERE id = ?').get(t.id) });
});

// DELETE /api/settings/behavior-templates/:id
router.delete('/behavior-templates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM behavior_type_templates WHERE id = ? AND teacher_id = ?').run(req.params.id, req.teacherId);
  if (result.changes === 0) return res.status(404).json({ error: 'السلوك غير موجود' });
  res.json({ success: true });
});

module.exports = router;
