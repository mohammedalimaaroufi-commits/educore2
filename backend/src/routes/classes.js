const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getStudentCount, getActiveStudentLimit } = require('../utils/subscriptions');

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

// Builds the "بطاقة الصف" quick-stats block: grading coverage per visible assessment, best/worst
// behavior this term, and whether attendance was actually marked for today's session.
// Kept in one place so both the classes list and (if needed later) the class detail header can reuse it.
function computeQuickStats(classId, studentCount) {
  const grading = db.prepare(`
    SELECT gc.id as category_id,
           gc.name as category_name,
           a.id as assessment_id,
           CASE WHEN a.is_summary = 1 THEN gc.name ELSE a.title END as title,
           a.max_score,
           a.is_summary,
           COUNT(g.id) as entered_count
    FROM grade_categories gc
    JOIN assessments a ON a.category_id = gc.id
    LEFT JOIN grades g ON g.assessment_id = a.id
      AND g.student_id IN (SELECT id FROM students WHERE class_id = ? AND archived = 0)
      AND (g.score_numeric IS NOT NULL OR g.score_letter IS NOT NULL)
    WHERE gc.class_id = ?
      AND (
        (
          a.is_summary = 0
          AND EXISTS (
            SELECT 1 FROM assessments detailed
            WHERE detailed.category_id = gc.id AND detailed.is_summary = 0
          )
        )
        OR (
          a.is_summary = 1
          AND NOT EXISTS (
            SELECT 1 FROM assessments detailed
            WHERE detailed.category_id = gc.id AND detailed.is_summary = 0
          )
        )
      )
    GROUP BY gc.id, a.id
    ORDER BY gc.sort_order, a.is_summary DESC, a.created_at
  `).all(classId, classId).map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    assessment_id: row.assessment_id,
    title: row.title,
    max_score: Number(row.max_score || 0),
    is_summary: Number(row.is_summary) === 1,
    entered_count: Number(row.entered_count || 0),
    total_students: Number(studentCount || 0),
    percent: studentCount > 0 ? Math.round((Number(row.entered_count || 0) / studentCount) * 100) : null,
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

function buildQuickStatsBatch(classIds, studentCountByClass) {
  if (!classIds.length) return new Map();
  const placeholders = classIds.map(() => '?').join(',');
  const today = new Date().toISOString().slice(0, 10);
  const gradingRows = db.prepare(`
    SELECT gc.class_id,
           gc.id as category_id,
           gc.name as category_name,
           a.id as assessment_id,
           CASE WHEN a.is_summary = 1 THEN gc.name ELSE a.title END as title,
           a.max_score,
           a.is_summary,
           COUNT(g.id) as entered_count
    FROM grade_categories gc
    JOIN assessments a ON a.category_id = gc.id
    LEFT JOIN grades g ON g.assessment_id = a.id
      AND (g.score_numeric IS NOT NULL OR g.score_letter IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM students s
        WHERE s.id = g.student_id AND s.class_id = gc.class_id AND s.archived = 0
      )
    WHERE gc.class_id IN (${placeholders})
      AND (
        (a.is_summary = 0 AND EXISTS (
          SELECT 1 FROM assessments detailed
          WHERE detailed.category_id = gc.id AND detailed.is_summary = 0
        ))
        OR (a.is_summary = 1 AND NOT EXISTS (
          SELECT 1 FROM assessments detailed
          WHERE detailed.category_id = gc.id AND detailed.is_summary = 0
        ))
      )
    GROUP BY gc.class_id, gc.id, a.id
    ORDER BY gc.class_id, gc.sort_order, a.is_summary DESC, a.created_at
  `).all(...classIds);
  const gradingByClass = new Map();
  gradingRows.forEach((row) => {
    const studentCount = Number(studentCountByClass.get(row.class_id) || 0);
    const rows = gradingByClass.get(row.class_id) || [];
    rows.push({
      category_id: row.category_id,
      category_name: row.category_name,
      assessment_id: row.assessment_id,
      title: row.title,
      max_score: Number(row.max_score || 0),
      is_summary: Number(row.is_summary) === 1,
      entered_count: Number(row.entered_count || 0),
      total_students: studentCount,
      percent: studentCount > 0 ? Math.round((Number(row.entered_count || 0) / studentCount) * 100) : null,
    });
    gradingByClass.set(row.class_id, rows);
  });

  const behaviorRows = db.prepare(`
    SELECT s.class_id, s.id as student_id, s.full_name, SUM(bt.points) as total_points
    FROM behavior_logs bl
    JOIN behavior_types bt ON bl.behavior_type_id = bt.id
    JOIN students s ON bl.student_id = s.id
    WHERE s.class_id IN (${placeholders}) AND s.archived = 0
    GROUP BY s.class_id, s.id
    ORDER BY s.class_id, total_points DESC
  `).all(...classIds);
  const behaviorByClass = new Map();
  behaviorRows.forEach((row) => {
    const rows = behaviorByClass.get(row.class_id) || [];
    rows.push(row);
    behaviorByClass.set(row.class_id, rows);
  });

  const attendanceRows = db.prepare(`
    SELECT ats.class_id, COUNT(ar.id) as record_count
    FROM attendance_sessions ats
    LEFT JOIN attendance_records ar ON ar.session_id = ats.id
    WHERE ats.class_id IN (${placeholders}) AND ats.session_date = ?
    GROUP BY ats.class_id
  `).all(...classIds, today);
  const attendanceByClass = new Map(attendanceRows.map((row) => [row.class_id, Number(row.record_count || 0) > 0]));

  return new Map(classIds.map((classId) => {
    const rows = behaviorByClass.get(classId) || [];
    const best = rows[0];
    const worst = rows.length > 1 ? rows[rows.length - 1] : null;
    return [classId, {
      grading: gradingByClass.get(classId) || [],
      behavior: best ? {
        best: { student_id: best.student_id, full_name: best.full_name, points: best.total_points },
        worst: worst ? { student_id: worst.student_id, full_name: worst.full_name, points: worst.total_points } : null,
      } : null,
      attendance_marked_today: Boolean(attendanceByClass.get(classId)),
    }];
  }));
}

// GET /api/classes
router.get('/', (req, res) => {
  const classes = db.prepare(`SELECT * FROM classes
                              WHERE teacher_id = ? AND archived = 0
                              ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END,
                                       sort_order ASC, created_at DESC, id DESC`).all(req.teacherId);
  const classIds = classes.map((item) => item.id);
  const countRows = classIds.length
    ? db.prepare(`SELECT class_id, COUNT(*) as count FROM students WHERE class_id IN (${classIds.map(() => '?').join(',')}) AND archived = 0 GROUP BY class_id`).all(...classIds)
    : [];
  const studentCountByClass = new Map(countRows.map((row) => [row.class_id, Number(row.count || 0)]));
  const quickStatsByClass = buildQuickStatsBatch(classIds, studentCountByClass);
  const withCounts = classes.map((c) => ({
    ...c,
    student_count: studentCountByClass.get(c.id) || 0,
    quick_stats: quickStatsByClass.get(c.id) || { grading: [], behavior: null, attendance_marked_today: false },
  }));
  res.json({ classes: withCounts });
});

// GET /api/classes/archived  -> list archived classes so the teacher can restore them
router.get('/archived', (req, res) => {
  const classes = db.prepare(`
    SELECT c.*, COUNT(s.id) AS student_count
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id
    WHERE c.teacher_id = ? AND c.archived = 1
    GROUP BY c.id
    ORDER BY c.updated_at DESC
  `).all(req.teacherId);
  res.json({ classes });
});

// POST /api/classes/:id/restore  -> un-archive a class
router.post('/:id/restore', (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!cls) return res.status(404).json({ error: 'الصف غير موجود' });

  const limit = getActiveStudentLimit(req.teacherId);
  const currentCount = getStudentCount(req.teacherId);
  const classStudentCount = Number(db.prepare('SELECT COUNT(*) AS count FROM students WHERE class_id = ? AND archived = 0').get(cls.id)?.count || 0);
  if (Number(cls.archived) === 1 && limit && currentCount + classStudentCount > limit.includedStudents) {
    return res.status(409).json({
      error: 'استعادة الصف ستتجاوز حد الطلاب في الباقة النشطة. أرشف أو احذف طلابًا أو رقِّ الباقة أولًا.',
      code: 'STUDENT_LIMIT_REACHED',
      current_count: currentCount,
      included_students: limit.includedStudents,
      requested_students: classStudentCount,
      remaining: Math.max(0, limit.includedStudents - currentCount),
      plan: limit.plan,
    });
  }

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
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM classes WHERE teacher_id = ? AND archived = 0').get(req.teacherId).next_order;
  db.prepare(`INSERT INTO classes (id, teacher_id, name, subject, academic_year, color, icon, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.teacherId, name, subject || null, academic_year || null, color || '#2E7D6B', icon || 'book', nextOrder);

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

// PATCH /api/classes/reorder { class_ids: string[] }
// Reordering changes presentation metadata only; all class-owned data remains untouched.
router.patch('/reorder', (req, res) => {
  const requestedIds = Array.isArray(req.body.class_ids) ? req.body.class_ids.map((id) => String(id)).filter(Boolean) : null;
  if (!requestedIds || requestedIds.length > 1000) return res.status(400).json({ error: 'ترتيب الصفوف غير صالح' });

  const existing = db.prepare(`SELECT id FROM classes
                               WHERE teacher_id = ? AND archived = 0
                               ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END,
                                        sort_order ASC, created_at DESC, id DESC`).all(req.teacherId);
  const allowed = new Set(existing.map((item) => item.id));
  const seen = new Set();
  const orderedIds = [];
  requestedIds.forEach((id) => {
    if (allowed.has(id) && !seen.has(id)) {
      orderedIds.push(id);
      seen.add(id);
    }
  });
  existing.forEach((item) => {
    if (!seen.has(item.id)) {
      orderedIds.push(item.id);
      seen.add(item.id);
    }
  });
  const update = db.prepare("UPDATE classes SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND teacher_id = ? AND archived = 0");
  db.transaction(() => orderedIds.forEach((id, index) => update.run(index, id, req.teacherId)))();
  res.json({ class_ids: orderedIds });
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

  const updates = {};
  if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
  if (req.body.subject !== undefined) updates.subject = String(req.body.subject).trim() || null;
  if (req.body.academic_year !== undefined) updates.academic_year = String(req.body.academic_year).trim() || null;
  if (req.body.color !== undefined) updates.color = String(req.body.color).trim() || cls.color || '#2E7D6B';
  if (req.body.icon !== undefined) updates.icon = String(req.body.icon).trim() || cls.icon || 'book';
  if (updates.name !== undefined && !updates.name) return res.status(400).json({ error: 'اسم الصف مطلوب' });

  const keys = Object.keys(updates);
  if (keys.length > 0) {
    const setClause = keys.map((key) => `${key} = @${key}`).join(', ');
    db.prepare(`UPDATE classes SET ${setClause}, updated_at = datetime('now') WHERE id = @id AND teacher_id = @teacher_id`)
      .run({ ...updates, id: cls.id, teacher_id: req.teacherId });
  }

  const saved = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(cls.id, req.teacherId);
  res.json({ class: saved, saved_fields: keys });
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
  const student = db.prepare(`SELECT s.*, c.teacher_id, c.archived AS source_class_archived
                             FROM students s JOIN classes c ON c.id = s.class_id
                             WHERE s.id = ? AND s.class_id = ? AND c.teacher_id = ?`)
    .get(student_id, req.params.id, req.teacherId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود في هذا الصف' });

  if (mode === 'archive') {
    db.prepare("UPDATE students SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(student_id);
    return res.json({ success: true, mode: 'archived' });
  }

  const targetClass = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(target_class_id, req.teacherId);
  if (!targetClass) return res.status(404).json({ error: 'الصف الهدف غير موجود' });

  // Moving from an archived class into an active class makes this student count toward the plan.
  const movesIntoCountedPool = Number(student.archived) === 0 && Number(targetClass.archived) === 0;
  const alreadyCounted = Number(student.archived) === 0 && Number(student.source_class_archived) === 0;
  if (movesIntoCountedPool && !alreadyCounted) {
    const limit = getActiveStudentLimit(req.teacherId);
    const currentCount = getStudentCount(req.teacherId);
    if (limit && currentCount >= limit.includedStudents) {
      return res.status(409).json({
        error: 'نقل الطالب سيتجاوز حد الطلاب في الباقة النشطة. أرشف أو احذف طالبًا أو رقِّ الباقة أولًا.',
        code: 'STUDENT_LIMIT_REACHED',
        current_count: currentCount,
        included_students: limit.includedStudents,
        remaining: 0,
        plan: limit.plan,
      });
    }
  }

  // Move student; behavior_logs & attendance stay linked to student_id (history preserved automatically)
  db.prepare('UPDATE students SET class_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(target_class_id, student_id);
  res.json({ success: true, mode: 'moved' });
});

module.exports = router;
