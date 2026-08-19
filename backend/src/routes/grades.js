const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function assertClassOwnership(classId, teacherId) {
  return db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(classId, teacherId);
}

// ---------- Grade Categories ----------

// GET /api/grades/categories?class_id=...
router.get('/categories', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const categories = db.prepare('SELECT * FROM grade_categories WHERE class_id = ? ORDER BY sort_order').all(class_id);
  const totalWeight = categories.reduce((sum, c) => sum + c.weight_percent, 0);
  res.json({ categories, totalWeight, isValid: Math.round(totalWeight) === 100 });
});

// POST /api/grades/categories
router.post('/categories', (req, res) => {
  const { class_id, name, weight_percent, grading_type } = req.body;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  if (!name) return res.status(400).json({ error: 'اسم الفئة مطلوب' });
  const id = uuid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM grade_categories WHERE class_id = ?').get(class_id).m;
  db.prepare(`INSERT INTO grade_categories (id, class_id, name, weight_percent, grading_type, sort_order)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, class_id, name, weight_percent || 0, grading_type || 'numeric', maxOrder + 1);
  // Open a ready-to-use grade column right away — no need to add an assessment manually before grading.
  db.prepare(`INSERT INTO assessments (id, category_id, title, max_score) VALUES (?, ?, ?, 100)`).run(uuid(), id, name);
  res.status(201).json({ category: db.prepare('SELECT * FROM grade_categories WHERE id = ?').get(id) });
});

// PATCH /api/grades/categories/:id  (rename / change weight - validated against 100% on the frontend + here)
router.patch('/categories/:id', (req, res) => {
  const cat = db.prepare('SELECT gc.* FROM grade_categories gc JOIN classes c ON gc.class_id = c.id WHERE gc.id = ? AND c.teacher_id = ?').get(req.params.id, req.teacherId);
  if (!cat) return res.status(404).json({ error: 'الفئة غير موجودة' });
  const { name, weight_percent, grading_type } = req.body;
  db.prepare(`UPDATE grade_categories SET name = COALESCE(?, name), weight_percent = COALESCE(?, weight_percent), grading_type = COALESCE(?, grading_type) WHERE id = ?`)
    .run(name, weight_percent, grading_type, cat.id);
  res.json({ category: db.prepare('SELECT * FROM grade_categories WHERE id = ?').get(cat.id) });
});

router.delete('/categories/:id', (req, res) => {
  const result = db.prepare(`DELETE FROM grade_categories WHERE id = ? AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`).run(req.params.id, req.teacherId);
  if (result.changes === 0) return res.status(404).json({ error: 'الفئة غير موجودة' });
  res.json({ success: true });
});

// ---------- Assessments (a gradable item within a category, e.g. "Quiz 1") ----------

// GET /api/grades/assessments?category_id=...
router.get('/assessments', (req, res) => {
  const { category_id } = req.query;
  const assessments = db.prepare(`SELECT a.* FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id
                                   JOIN classes c ON gc.class_id = c.id WHERE a.category_id = ? AND c.teacher_id = ?
                                   ORDER BY a.date DESC, a.created_at DESC`).all(category_id, req.teacherId);
  res.json({ assessments });
});

// POST /api/grades/assessments
router.post('/assessments', (req, res) => {
  const { id: requestedId, category_id, title, max_score, date } = req.body;
  const cat = db.prepare(`SELECT gc.* FROM grade_categories gc JOIN classes c ON gc.class_id = c.id WHERE gc.id = ? AND c.teacher_id = ?`).get(category_id, req.teacherId);
  if (!cat) return res.status(404).json({ error: 'الفئة غير موجودة' });
  if (!title) return res.status(400).json({ error: 'عنوان التقييم مطلوب' });
  const id = requestedId || uuid();
  const existing = db.prepare('SELECT a.* FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id JOIN classes c ON gc.class_id = c.id WHERE a.id = ? AND c.teacher_id = ?').get(id, req.teacherId);
  if (existing) return res.json({ assessment: existing, reused: true });
  db.prepare(`INSERT INTO assessments (id, category_id, title, max_score, date) VALUES (?, ?, ?, ?, ?)`)
    .run(id, category_id, title, max_score || 100, date || null);
  res.status(201).json({ assessment: db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) });
});

router.delete('/assessments/:id', (req, res) => {
  const result = db.prepare(`DELETE FROM assessments WHERE id = ? AND category_id IN
    (SELECT gc.id FROM grade_categories gc JOIN classes c ON gc.class_id = c.id WHERE c.teacher_id = ?)`).run(req.params.id, req.teacherId);
  if (result.changes === 0) return res.status(404).json({ error: 'التقييم غير موجود' });
  res.json({ success: true });
});

// ---------- Quick-Grid grade entry ----------

// GET /api/grades/grid?assessment_id=...  -> returns all students in the class with their grade (or null)
router.get('/grid', (req, res) => {
  const { assessment_id } = req.query;
  const assessment = db.prepare(`SELECT a.*, gc.class_id FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id
                                  JOIN classes c ON gc.class_id = c.id WHERE a.id = ? AND c.teacher_id = ?`).get(assessment_id, req.teacherId);
  if (!assessment) return res.status(404).json({ error: 'التقييم غير موجود' });

  const rows = db.prepare(`SELECT s.id as student_id, s.full_name, g.id as grade_id, g.score_numeric, g.score_letter, g.rubric_json, g.comment
                            FROM students s LEFT JOIN grades g ON g.student_id = s.id AND g.assessment_id = ?
                            WHERE s.class_id = ? AND s.archived = 0 ORDER BY s.full_name COLLATE NOCASE`)
    .all(assessment_id, assessment.class_id);

  res.json({ assessment, rows });
});

// POST /api/grades/grid  { assessment_id, entries: [{student_id, score_numeric | score_letter | rubric_json, comment}] }
router.post('/grid', (req, res) => {
  const { assessment_id, entries } = req.body;
  const assessment = db.prepare(`SELECT a.*, gc.class_id FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id
                                  JOIN classes c ON gc.class_id = c.id WHERE a.id = ? AND c.teacher_id = ?`).get(assessment_id, req.teacherId);
  if (!assessment) return res.status(404).json({ error: 'التقييم غير موجود' });

  const upsert = db.prepare(`INSERT INTO grades (id, assessment_id, student_id, score_numeric, score_letter, rubric_json, comment, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                              ON CONFLICT(assessment_id, student_id) DO UPDATE SET
                                score_numeric=excluded.score_numeric, score_letter=excluded.score_letter,
                                rubric_json=excluded.rubric_json, comment=excluded.comment, updated_at=datetime('now')`);
  const saveAll = db.transaction((items) => {
    for (const item of items) {
      upsert.run(uuid(), assessment_id, item.student_id, item.score_numeric ?? null, item.score_letter ?? null,
        item.rubric_json ? JSON.stringify(item.rubric_json) : null, item.comment ?? null);
    }
  });
  saveAll(entries || []);
  res.json({ success: true, saved: (entries || []).length });
});

// ---------- Full matrix (spreadsheet-style) view: all students x all assessments ----------

// GET /api/grades/matrix?class_id=...
router.get('/matrix', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });

  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE').all(class_id);
  const categories = db.prepare('SELECT * FROM grade_categories WHERE class_id = ? ORDER BY sort_order').all(class_id);

  // Self-heal: any category created before this behavior existed (or restored from an old backup)
  // gets its first grade column created on the fly, so grading never requires "+ تقييم" as a first step.
  const insertDefaultAssessment = db.prepare(`INSERT INTO assessments (id, category_id, title, max_score) VALUES (?, ?, ?, 100)`);
  categories.forEach((cat) => {
    const hasAny = db.prepare('SELECT 1 FROM assessments WHERE category_id = ? LIMIT 1').get(cat.id);
    if (!hasAny) insertDefaultAssessment.run(uuid(), cat.id, cat.name);
  });

  const categoriesWithAssessments = categories.map((cat) => ({
    ...cat,
    assessments: db.prepare('SELECT * FROM assessments WHERE category_id = ? ORDER BY date, created_at').all(cat.id),
  }));

  const allAssessmentIds = categoriesWithAssessments.flatMap((c) => c.assessments.map((a) => a.id));
  const grades = {};
  if (allAssessmentIds.length > 0) {
    const placeholders = allAssessmentIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM grades WHERE assessment_id IN (${placeholders})`).all(...allAssessmentIds);
    rows.forEach((g) => { grades[`${g.assessment_id}:${g.student_id}`] = g; });
  }

  res.json({ students, categories: categoriesWithAssessments, grades });
});

// POST /api/grades/matrix  { entries: [{assessment_id, student_id, score_numeric, comment}] }  -> bulk save from the spreadsheet view
router.post('/matrix', (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) return res.json({ success: true, saved: 0 });

  // Verify every assessment referenced belongs to this teacher before writing anything
  const assessmentIds = [...new Set(entries.map((e) => e.assessment_id))];
  const placeholders = assessmentIds.map(() => '?').join(',');
  const owned = db.prepare(`SELECT a.id FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id
                             JOIN classes c ON gc.class_id = c.id WHERE a.id IN (${placeholders}) AND c.teacher_id = ?`)
    .all(...assessmentIds, req.teacherId);
  const ownedSet = new Set(owned.map((o) => o.id));
  if (owned.length !== assessmentIds.length) return res.status(403).json({ error: 'لا تملك صلاحية على أحد هذه التقييمات' });

  const upsert = db.prepare(`INSERT INTO grades (id, assessment_id, student_id, score_numeric, comment, updated_at)
                              VALUES (?, ?, ?, ?, ?, datetime('now'))
                              ON CONFLICT(assessment_id, student_id) DO UPDATE SET
                                score_numeric=excluded.score_numeric, comment=excluded.comment, updated_at=datetime('now')`);
  const saveAll = db.transaction((items) => {
    let count = 0;
    for (const item of items) {
      if (!ownedSet.has(item.assessment_id)) continue;
      upsert.run(uuid(), item.assessment_id, item.student_id, item.score_numeric ?? null, item.comment ?? null);
      count += 1;
    }
    return count;
  });
  const saved = saveAll(entries);
  res.json({ success: true, saved });
});

// GET /api/grades/summary?class_id=...  -> weighted final grade per student across categories
router.get('/summary', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });

  const students = db.prepare('SELECT * FROM students WHERE class_id = ? AND archived = 0').all(class_id);
  const categories = db.prepare('SELECT * FROM grade_categories WHERE class_id = ?').all(class_id);

  const summary = students.map((student) => {
    let weightedTotal = 0;
    let weightUsed = 0;
    const perCategory = categories.map((cat) => {
      const assessments = db.prepare('SELECT * FROM assessments WHERE category_id = ?').all(cat.id);
      let earned = 0, possible = 0;
      assessments.forEach((a) => {
        const g = db.prepare('SELECT * FROM grades WHERE assessment_id = ? AND student_id = ?').get(a.id, student.id);
        if (g && g.score_numeric !== null && g.score_numeric !== undefined) {
          earned += g.score_numeric;
          possible += a.max_score;
        }
      });
      const pct = possible > 0 ? (earned / possible) * 100 : null;
      if (pct !== null) {
        weightedTotal += pct * (cat.weight_percent / 100);
        weightUsed += cat.weight_percent;
      }
      return { category_id: cat.id, category_name: cat.name, percent: pct };
    });
    const finalGrade = weightUsed > 0 ? Number(((weightedTotal / weightUsed) * 100).toFixed(2)) : null;
    return { student_id: student.id, full_name: student.full_name, perCategory, finalGrade };
  });

  res.json({ summary });
});

module.exports = router;
