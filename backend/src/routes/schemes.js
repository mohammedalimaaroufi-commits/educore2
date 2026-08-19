const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function loadScheme(id, teacherId) {
  const scheme = db.prepare('SELECT * FROM grading_schemes WHERE id = ? AND teacher_id = ?').get(id, teacherId);
  if (!scheme) return null;
  const categories = db.prepare('SELECT * FROM grading_scheme_categories WHERE scheme_id = ? ORDER BY sort_order').all(id);
  return { ...scheme, categories };
}

// GET /api/schemes  -> list all saved schemes for this teacher
router.get('/', (req, res) => {
  const schemes = db.prepare('SELECT * FROM grading_schemes WHERE teacher_id = ? ORDER BY created_at DESC').all(req.teacherId);
  const withCategories = schemes.map((s) => ({
    ...s,
    categories: db.prepare('SELECT * FROM grading_scheme_categories WHERE scheme_id = ? ORDER BY sort_order').all(s.id),
  }));
  res.json({ schemes: withCategories });
});

// POST /api/schemes  { name, categories: [{name, weight_percent, grading_type}] }  -> create a scheme from scratch
router.post('/', (req, res) => {
  const { name, categories } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المخطط مطلوب' });
  const id = uuid();
  db.prepare('INSERT INTO grading_schemes (id, teacher_id, name) VALUES (?, ?, ?)').run(id, req.teacherId, name);
  const insertCat = db.prepare('INSERT INTO grading_scheme_categories (id, scheme_id, name, weight_percent, grading_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  (categories || []).forEach((c, i) => insertCat.run(uuid(), id, c.name, c.weight_percent || 0, c.grading_type || 'numeric', i));
  res.status(201).json({ scheme: loadScheme(id, req.teacherId) });
});

// POST /api/schemes/from-class  { class_id, name }  -> save an existing class's current categories as a new reusable scheme
router.post('/from-class', (req, res) => {
  const { class_id, name } = req.body;
  const owns = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(class_id, req.teacherId);
  if (!owns) return res.status(404).json({ error: 'الصف غير موجود' });
  if (!name) return res.status(400).json({ error: 'اسم المخطط مطلوب' });

  const classCategories = db.prepare('SELECT * FROM grade_categories WHERE class_id = ? ORDER BY sort_order').all(class_id);
  if (classCategories.length === 0) return res.status(400).json({ error: 'لا توجد فئات في هذا الصف لحفظها كمخطط' });

  const id = uuid();
  db.prepare('INSERT INTO grading_schemes (id, teacher_id, name) VALUES (?, ?, ?)').run(id, req.teacherId, name);
  const insertCat = db.prepare('INSERT INTO grading_scheme_categories (id, scheme_id, name, weight_percent, grading_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  classCategories.forEach((c, i) => insertCat.run(uuid(), id, c.name, c.weight_percent, c.grading_type, i));
  res.status(201).json({ scheme: loadScheme(id, req.teacherId) });
});

// PATCH /api/schemes/:id  (rename)
router.patch('/:id', (req, res) => {
  const scheme = db.prepare('SELECT * FROM grading_schemes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!scheme) return res.status(404).json({ error: 'المخطط غير موجود' });
  if (req.body.name) db.prepare('UPDATE grading_schemes SET name = ? WHERE id = ?').run(req.body.name, scheme.id);
  res.json({ scheme: loadScheme(scheme.id, req.teacherId) });
});

// PATCH /api/schemes/:id/categories/:catId  (edit a category within a scheme)
router.patch('/:id/categories/:catId', (req, res) => {
  const scheme = db.prepare('SELECT * FROM grading_schemes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!scheme) return res.status(404).json({ error: 'المخطط غير موجود' });
  const { name, weight_percent, grading_type } = req.body;
  db.prepare(`UPDATE grading_scheme_categories SET name = COALESCE(?, name), weight_percent = COALESCE(?, weight_percent), grading_type = COALESCE(?, grading_type)
              WHERE id = ? AND scheme_id = ?`).run(name, weight_percent, grading_type, req.params.catId, scheme.id);
  res.json({ scheme: loadScheme(scheme.id, req.teacherId) });
});

// POST /api/schemes/:id/categories  (add a category to an existing scheme)
router.post('/:id/categories', (req, res) => {
  const scheme = db.prepare('SELECT * FROM grading_schemes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!scheme) return res.status(404).json({ error: 'المخطط غير موجود' });
  const { name, weight_percent, grading_type } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم الفئة مطلوب' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM grading_scheme_categories WHERE scheme_id = ?').get(scheme.id).m;
  db.prepare('INSERT INTO grading_scheme_categories (id, scheme_id, name, weight_percent, grading_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), scheme.id, name, weight_percent || 0, grading_type || 'numeric', maxOrder + 1);
  res.status(201).json({ scheme: loadScheme(scheme.id, req.teacherId) });
});

// DELETE /api/schemes/:id/categories/:catId
router.delete('/:id/categories/:catId', (req, res) => {
  const scheme = db.prepare('SELECT * FROM grading_schemes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!scheme) return res.status(404).json({ error: 'المخطط غير موجود' });
  db.prepare('DELETE FROM grading_scheme_categories WHERE id = ? AND scheme_id = ?').run(req.params.catId, scheme.id);
  res.json({ scheme: loadScheme(scheme.id, req.teacherId) });
});

// POST /api/schemes/:id/set-default
// Marks this scheme as the one auto-applied to every new class the teacher creates from now on
// (only one scheme can be default at a time). Managed from الإعدادات العامة → فئات التقييم.
router.post('/:id/set-default', (req, res) => {
  const scheme = db.prepare('SELECT * FROM grading_schemes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!scheme) return res.status(404).json({ error: 'المخطط غير موجود' });
  const setDefault = db.transaction(() => {
    db.prepare('UPDATE grading_schemes SET is_default = 0 WHERE teacher_id = ?').run(req.teacherId);
    db.prepare('UPDATE grading_schemes SET is_default = 1 WHERE id = ?').run(scheme.id);
  });
  setDefault();
  res.json({ scheme: loadScheme(scheme.id, req.teacherId) });
});

// POST /api/schemes/:id/unset-default  -> no scheme is default; new classes fall back to the built-in starter categories
router.post('/:id/unset-default', (req, res) => {
  const scheme = db.prepare('SELECT * FROM grading_schemes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!scheme) return res.status(404).json({ error: 'المخطط غير موجود' });
  db.prepare('UPDATE grading_schemes SET is_default = 0 WHERE id = ?').run(scheme.id);
  res.json({ scheme: loadScheme(scheme.id, req.teacherId) });
});

// DELETE /api/schemes/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM grading_schemes WHERE id = ? AND teacher_id = ?').run(req.params.id, req.teacherId);
  if (result.changes === 0) return res.status(404).json({ error: 'المخطط غير موجود' });
  res.json({ success: true });
});

// POST /api/schemes/:id/apply  { class_id, replace: boolean }
// replace=true clears the class's current categories (and their assessments/grades!) before applying the scheme.
// replace=false (default) appends the scheme's categories to whatever the class already has.
router.post('/:id/apply', (req, res) => {
  const { class_id, replace } = req.body;
  const scheme = loadScheme(req.params.id, req.teacherId);
  if (!scheme) return res.status(404).json({ error: 'المخطط غير موجود' });
  const owns = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(class_id, req.teacherId);
  if (!owns) return res.status(404).json({ error: 'الصف غير موجود' });

  const apply = db.transaction(() => {
    if (replace) {
      db.prepare('DELETE FROM grade_categories WHERE class_id = ?').run(class_id); // cascades assessments & grades
    }
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM grade_categories WHERE class_id = ?').get(class_id).m;
    const insertCat = db.prepare('INSERT INTO grade_categories (id, class_id, name, weight_percent, grading_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    scheme.categories.forEach((c, i) => insertCat.run(uuid(), class_id, c.name, c.weight_percent, c.grading_type, maxOrder + 1 + i));
  });
  apply();

  res.json({ success: true, categories: db.prepare('SELECT * FROM grade_categories WHERE class_id = ? ORDER BY sort_order').all(class_id) });
});

module.exports = router;
