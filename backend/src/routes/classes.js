const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DEFAULT_BEHAVIORS = [
  { label: 'مشاركة متميزة', polarity: 'positive', points: 2, icon: 'star' },
  { label: 'إحضار الأدوات', polarity: 'positive', points: 1, icon: 'check' },
  { label: 'مساعدة زميل', polarity: 'positive', points: 1, icon: 'heart' },
  { label: 'تأخر عن الحصة', polarity: 'negative', points: -1, icon: 'clock' },
  { label: 'إزعاج الصف', polarity: 'negative', points: -2, icon: 'alert' },
  { label: 'عدم إحضار الواجب', polarity: 'negative', points: -1, icon: 'x' },
];

// Builds the "بطاقة الصف" quick-stats block: grading coverage per category, best/worst
// behavior this term, and whether attendance was actually marked for today's session.
// Kept in one place so both the classes list and (if needed later) the class detail header can reuse it.
function computeQuickStats(classId, studentCount) {
  const grading = db.prepare(`
    SELECT gc.id as category_id, gc.name,
           COUNT(a.id) * ? as total_possible,
           COUNT(g.id) as entered
    FROM grade_categories gc
    LEFT JOIN assessments a ON a.category_id = gc.id
    LEFT JOIN grades g ON g.assessment_id = a.id
      AND g.student_id IN (SELECT id FROM students WHERE class_id = ? AND archived = 0)
      AND (g.score_numeric IS NOT NULL OR g.score_letter IS NOT NULL)
    WHERE gc.class_id = ?
    GROUP BY gc.id
    ORDER BY gc.sort_order
  `).all(studentCount, classId, classId).map((row) => ({
    category_id: row.category_id,
    name: row.name,
    percent: row.total_possible > 0 ? Math.round((row.entered / row.total_possible) * 100) : null,
  }));

  const behaviorRows = db.prepare(`
    SELECT s.id as student_id, s.full_name, SUM(bt.points) as total_points
    FROM behavior_logs bl
    JOIN behavior_types bt ON bl.behavior_type_id = bt.id
    JOIN students s ON bl.student_id = s.id
    WHERE s.class_id = ? AND s.archived = 0
    GROUP BY s.id
    ORDER BY total_points DESC
  `).all(classId);
  let behavior = null;
  if (behaviorRows.length > 0) {
    const best = behaviorRows[0];
    const worst = behaviorRows[behaviorRows.length - 1];
    behavior = {
      best: { student_id: best.student_id, full_name: best.full_name, points: best.total_points },
      worst: (worst.student_id !== best.student_id)
        ? { student_id: worst.student_id, full_name: worst.full_name, points: worst.total_points }
        : null,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const session = db.prepare('SELECT id FROM attendance_sessions WHERE class_id = ? AND session_date = ?').get(classId, today);
  const attendanceMarkedToday = session
    ? db.prepare('SELECT COUNT(*) as count FROM attendance_records WHERE session_id = ?').get(session.id).count > 0
    : false;

  return { grading, behavior, attendance_marked_today: attendanceMarkedToday };
}

// GET /api/classes
router.get('/', (req, res) => {
  const classes = db.prepare('SELECT * FROM classes WHERE teacher_id = ? AND archived = 0 ORDER BY created_at DESC').all(req.teacherId);
  const withCounts = classes.map((c) => {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM students WHERE class_id = ? AND archived = 0').get(c.id);
    return { ...c, student_count: count, quick_stats: computeQuickStats(c.id, count) };
  });
  res.json({ classes: withCounts });
});

// GET /api/classes/archived  -> list archived classes so the teacher can restore them
router.get('/archived', (req, res) => {
  const classes = db.prepare('SELECT * FROM classes WHERE teacher_id = ? AND archived = 1 ORDER BY updated_at DESC').all(req.teacherId);
  const withCounts = classes.map((c) => {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM students WHERE class_id = ?').get(c.id);
    return { ...c, student_count: count };
  });
  res.json({ classes: withCounts });
});

// POST /api/classes/:id/restore  -> un-archive a class
router.post('/:id/restore', (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!cls) return res.status(404).json({ error: 'الصف غير موجود' });
  db.prepare("UPDATE classes SET archived = 0, updated_at = datetime('now') WHERE id = ?").run(cls.id);
  res.json({ class: db.prepare('SELECT * FROM classes WHERE id = ?').get(cls.id) });
});

// POST /api/classes
router.post('/', (req, res) => {
  const { id: requestedId, name, subject, academic_year, color, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم الصف مطلوب' });
  const id = requestedId || uuid();
  const existing = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(id, req.teacherId);
  if (existing) return res.json({ class: existing, reused: true });
  db.prepare(`INSERT INTO classes (id, teacher_id, name, subject, academic_year, color, icon)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.teacherId, name, subject || null, academic_year || null, color || '#2E7D6B', icon || 'book');

  // Seed starter behavior types: use the teacher's own saved presets from الإعدادات العامة
  // ("تحرير السلوك المخصص") if they've configured any, otherwise fall back to the built-ins.
  const insertBehavior = db.prepare(`INSERT INTO behavior_types (id, class_id, label, polarity, points, icon, is_default)
                                      VALUES (?, ?, ?, ?, ?, ?, 1)`);
  const behaviorTemplates = db.prepare('SELECT * FROM behavior_type_templates WHERE teacher_id = ? ORDER BY sort_order').all(req.teacherId);
  const behaviorSeed = behaviorTemplates.length > 0 ? behaviorTemplates : DEFAULT_BEHAVIORS;
  behaviorSeed.forEach((b) => insertBehavior.run(uuid(), id, b.label, b.polarity, b.points, b.icon));

  // Seed starter grade categories: use the teacher's default مخطط جاهز ("فئات التقييم" في الإعدادات)
  // if one is set, otherwise the built-in starter distribution.
  const defaultScheme = db.prepare('SELECT * FROM grading_schemes WHERE teacher_id = ? AND is_default = 1').get(req.teacherId);
  const defaultCategories = defaultScheme
    ? db.prepare('SELECT name, weight_percent FROM grading_scheme_categories WHERE scheme_id = ? ORDER BY sort_order').all(defaultScheme.id)
    : [
        { name: 'مشاركة', weight_percent: 10 },
        { name: 'واجبات منزلية', weight_percent: 15 },
        { name: 'اختبارات قصيرة', weight_percent: 20 },
        { name: 'مشروع', weight_percent: 15 },
        { name: 'اختبار نهائي', weight_percent: 40 },
      ];
  const insertCategory = db.prepare(`INSERT INTO grade_categories (id, class_id, name, weight_percent, grading_type, grading_mode, sort_order)
                                      VALUES (?, ?, ?, ?, 'numeric', 'direct', ?)`);
  // Each category gets a ready-to-use summary column whose maximum is the category weight.
  const insertAssessment = db.prepare(`INSERT INTO assessments (id, category_id, title, max_score, is_summary) VALUES (?, ?, ?, ?, 1)`);
  defaultCategories.forEach((c, i) => {
    const categoryId = uuid();
    insertCategory.run(categoryId, id, c.name, c.weight_percent, i);
    insertAssessment.run(uuid(), categoryId, c.name, Number(c.weight_percent || 0));
  });

  const created = db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
  res.status(201).json({ class: created });
});

// GET /api/classes/:id
router.get('/:id', (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!cls) return res.status(404).json({ error: 'الصف غير موجود' });
  res.json({ class: cls });
});

// PATCH /api/classes/:id
router.patch('/:id', (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!cls) return res.status(404).json({ error: 'الصف غير موجود' });
  const fields = ['name', 'subject', 'academic_year', 'color', 'icon'];
  const updates = {};
  fields.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  if (setClause) {
    db.prepare(`UPDATE classes SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: cls.id });
  }
  res.json({ class: db.prepare('SELECT * FROM classes WHERE id = ?').get(cls.id) });
});

// DELETE /api/classes/:id            -> archive (soft delete, recoverable)
// DELETE /api/classes/:id?permanent=1 -> hard delete (removes class + all students/grades/behavior/attendance permanently)
router.delete('/:id', (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!cls) return res.status(404).json({ error: 'الصف غير موجود' });

  if (req.query.permanent === '1' || req.query.permanent === 'true') {
    db.prepare('DELETE FROM classes WHERE id = ?').run(cls.id); // ON DELETE CASCADE removes students/categories/behavior/attendance
    return res.json({ success: true, mode: 'deleted' });
  }

  db.prepare('UPDATE classes SET archived = 1 WHERE id = ?').run(cls.id);
  res.json({ success: true, mode: 'archived' });
});

// POST /api/classes/:id/transfer-student  { student_id, target_class_id, mode: 'move' | 'archive' }
router.post('/:id/transfer-student', (req, res) => {
  const { student_id, target_class_id, mode } = req.body;
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND class_id = ?').get(student_id, req.params.id);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود في هذا الصف' });

  if (mode === 'archive') {
    db.prepare('UPDATE students SET archived = 1 WHERE id = ?').run(student_id);
    return res.json({ success: true, mode: 'archived' });
  }

  const targetClass = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(target_class_id, req.teacherId);
  if (!targetClass) return res.status(404).json({ error: 'الصف الهدف غير موجود' });

  // Move student; behavior_logs & attendance stay linked to student_id (history preserved automatically)
  db.prepare('UPDATE students SET class_id = ? WHERE id = ?').run(target_class_id, student_id);
  res.json({ success: true, mode: 'moved' });
});

module.exports = router;
