const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/restrictions');
const { canTeacherOperateClass } = require('../utils/schoolAccess');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('gradebook'));

function assertClassOwnership(classId, teacherId) {
  return canTeacherOperateClass(classId, teacherId)
    ? db.prepare('SELECT id FROM classes WHERE id = ? AND archived = 0').get(classId)
    : null;
}

function getOperableCategory(categoryId, teacherId) {
  const category = db.prepare('SELECT * FROM grade_categories WHERE id = ?').get(categoryId);
  return category && canTeacherOperateClass(category.class_id, teacherId) ? category : null;
}

function getOperableAssessment(assessmentId, teacherId) {
  const assessment = db.prepare(`SELECT a.*, gc.class_id, gc.weight_percent, gc.grading_mode
                                 FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id
                                 WHERE a.id = ?`).get(assessmentId);
  return assessment && canTeacherOperateClass(assessment.class_id, teacherId) ? assessment : null;
}

function categoryAssessments(categoryId) {
  return db.prepare('SELECT * FROM assessments WHERE category_id = ? ORDER BY is_summary DESC, date, created_at').all(categoryId);
}

function detailTotal(categoryId) {
  return Number(db.prepare('SELECT COALESCE(SUM(max_score), 0) AS total FROM assessments WHERE category_id = ? AND is_summary = 0').get(categoryId).total || 0);
}

function effectiveAssessmentMax(assessment) {
  const weight = Number(assessment?.weight_percent || 0);
  const onlyCategoryAssessment = Number(assessment?.assessment_count || 0) <= 1;
  if (weight > 0 && (Number(assessment?.is_summary) === 1 || onlyCategoryAssessment)) return weight;
  return Number(assessment?.max_score || 0);
}

function validateScore(scoreValue, maxScore) {
  if (scoreValue === null || scoreValue === undefined || scoreValue === '') return null;
  const score = Number(scoreValue);
  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    return `الدرجة يجب أن تكون بين 0 و${maxScore}`;
  }
  return null;
}

function ensureSummaryAssessment(category) {
  let summary = db.prepare('SELECT * FROM assessments WHERE category_id = ? AND is_summary = 1 LIMIT 1').get(category.id);
  if (!summary) {
    const id = uuid();
    db.prepare(`INSERT INTO assessments (id, category_id, title, max_score, is_summary) VALUES (?, ?, ?, ?, 1)`)
      .run(id, category.id, category.name, Number(category.weight_percent || 0));
    summary = db.prepare('SELECT * FROM assessments WHERE id = ?').get(id);
  }
  return summary;
}

function weightedPercentFromMemory(studentId, category, assessments, gradeMap) {
  const direct = category?.grading_mode !== 'detailed';
  const details = direct ? [] : assessments.filter((assessment) => Number(assessment.is_summary) === 0);
  const hasEnteredDetail = details.some((assessment) => {
    const score = gradeMap.get(`${assessment.id}:${studentId}`)?.score_numeric;
    return score !== null && score !== undefined && score !== '';
  });
  const rows = hasEnteredDetail ? details : assessments.filter((assessment) => Number(assessment.is_summary) === 1);
  let earned = 0;
  let possible = 0;
  rows.forEach((assessment) => {
    const score = gradeMap.get(`${assessment.id}:${studentId}`)?.score_numeric;
    if (score !== null && score !== undefined && score !== '') {
      earned += Number(score);
      possible += direct ? Number(category.weight_percent || 0) : Number(assessment.max_score || 0);
    }
  });
  return possible > 0 ? (earned / possible) * 100 : null;
}

// ---------- Grade Categories ----------

// GET /api/grades/categories?class_id=...
router.get('/categories', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const categories = db.prepare(`SELECT gc.*,
      (SELECT COUNT(*) FROM assessments a WHERE a.category_id = gc.id AND a.is_summary = 0) AS detail_count,
      (SELECT COALESCE(SUM(a.max_score), 0) FROM assessments a WHERE a.category_id = gc.id AND a.is_summary = 0) AS detail_total
    FROM grade_categories gc WHERE gc.class_id = ? ORDER BY gc.sort_order`).all(class_id);
  const totalWeight = categories.reduce((sum, c) => sum + Number(c.weight_percent || 0), 0);
  res.json({ categories, totalWeight, isValid: Math.round(totalWeight) === 100 });
});

// POST /api/grades/categories
router.post('/categories', (req, res) => {
  const { class_id, name, weight_percent, grading_type, grading_mode, details_note } = req.body;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  if (!name) return res.status(400).json({ error: 'اسم الفئة مطلوب' });
  const weight = Number(weight_percent || 0);
  if (weight < 0) return res.status(400).json({ error: 'وزن الفئة لا يمكن أن يكون سالبًا' });
  const mode = grading_mode === 'detailed' ? 'detailed' : 'direct';
  const id = uuid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM grade_categories WHERE class_id = ?').get(class_id).m;
  db.prepare(`INSERT INTO grade_categories (id, class_id, name, weight_percent, grading_type, grading_mode, details_note, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, class_id, name, weight, grading_type || 'numeric', mode, details_note || null, maxOrder + 1);
  // The summary column lets a teacher grade the whole category immediately. It is hidden
  // automatically once one or more detailed assessments are added.
  db.prepare(`INSERT INTO assessments (id, category_id, title, max_score, is_summary) VALUES (?, ?, ?, ?, 1)`)
    .run(uuid(), id, name, weight);
  res.status(201).json({ category: db.prepare('SELECT * FROM grade_categories WHERE id = ?').get(id) });
});

// PATCH /api/grades/categories/:id  (rename / change weight - validated against 100% on the frontend + here)
router.patch('/categories/:id', (req, res) => {
  const cat = getOperableCategory(req.params.id, req.teacherId);
  if (!cat) return res.status(404).json({ error: 'الفئة غير موجودة' });
  const { name, weight_percent, grading_type, grading_mode, details_note } = req.body;
  const nextWeight = weight_percent === undefined || weight_percent === null ? Number(cat.weight_percent || 0) : Number(weight_percent);
  if (nextWeight < 0) return res.status(400).json({ error: 'وزن الفئة لا يمكن أن يكون سالبًا' });
  const nextMode = grading_mode === 'detailed' ? 'detailed' : grading_mode === 'direct' ? 'direct' : cat.grading_mode;
  if (nextMode === 'detailed' && detailTotal(cat.id) > nextWeight + 0.0001) return res.status(400).json({ error: 'وزن الفئة أقل من مجموع تقييماتها التفصيلية' });
  const nextName = name || cat.name;
  if (nextMode === 'direct') {
    // Direct approval is non-destructive: keep detail assessments and their grades
    // stored so the teacher can switch back later, but use the summary column now.
    ensureSummaryAssessment({ ...cat, name: nextName, weight_percent: nextWeight });
  }
  db.prepare(`UPDATE grade_categories SET name = COALESCE(?, name), weight_percent = ?, grading_type = COALESCE(?, grading_type), grading_mode = ?, details_note = COALESCE(?, details_note) WHERE id = ?`)
    .run(name, nextWeight, grading_type, nextMode || 'direct', details_note, cat.id);
  if (nextMode === 'direct') {
    db.prepare('UPDATE assessments SET title = ?, max_score = ?, is_summary = 1 WHERE category_id = ? AND is_summary = 1')
      .run(nextName, nextWeight, cat.id);
  }
  res.json({ category: db.prepare('SELECT * FROM grade_categories WHERE id = ?').get(cat.id) });
});

router.delete('/categories/:id', (req, res) => {
  const category = getOperableCategory(req.params.id, req.teacherId);
  if (!category) return res.status(404).json({ error: 'الفئة غير موجودة' });
  const result = db.prepare('DELETE FROM grade_categories WHERE id = ?').run(category.id);
  if (result.changes === 0) return res.status(404).json({ error: 'الفئة غير موجودة' });
  res.json({ success: true });
});

// ---------- Assessments (a gradable item within a category, e.g. "Quiz 1") ----------

// GET /api/grades/assessments?category_id=...
router.get('/assessments', (req, res) => {
  const { category_id } = req.query;
  if (!getOperableCategory(category_id, req.teacherId)) return res.status(404).json({ error: 'الفئة غير موجودة' });
  const assessments = db.prepare(`SELECT a.* FROM assessments a WHERE a.category_id = ? ORDER BY a.date DESC, a.created_at DESC`).all(category_id);
  res.json({ assessments });
});

// POST /api/grades/assessments
router.post('/assessments', (req, res) => {
  const { id: requestedId, category_id, title, max_score, date, is_summary } = req.body;
  const cat = getOperableCategory(category_id, req.teacherId);
  if (!cat) return res.status(404).json({ error: 'الفئة غير موجودة' });
  if (!title) return res.status(400).json({ error: 'عنوان التقييم مطلوب' });
  const summary = Boolean(is_summary);
  const max = Number(max_score || 0);
  if (max <= 0) return res.status(400).json({ error: 'الدرجة القصوى يجب أن تكون أكبر من صفر' });
  // The teacher may design a rubric above or below the category weight.
  // The UI shows a warning, but the API does not block the draft rubric.
  const detailTotalBefore = detailTotal(category_id);
  const id = requestedId || uuid();
  const existing = db.prepare('SELECT a.*, gc.class_id FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id WHERE a.id = ?').get(id);
  if (existing && !canTeacherOperateClass(existing.class_id, req.teacherId)) return res.status(404).json({ error: 'التقييم غير موجود' });
  if (existing) return res.json({ assessment: existing, reused: true });
  db.prepare(`INSERT INTO assessments (id, category_id, title, max_score, is_summary, date) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, category_id, title, max, summary ? 1 : 0, date || null);
  if (!summary) db.prepare("UPDATE grade_categories SET grading_mode = 'detailed' WHERE id = ?").run(category_id);
  const detailTotalAfter = summary ? detailTotalBefore : detailTotal(category_id);
  const weight = Number(cat.weight_percent || 0);
  const warning = detailTotalAfter > weight
    ? `مجموع التقييمات يتجاوز وزن الفئة بمقدار ${(detailTotalAfter - weight).toFixed(2)}`
    : detailTotalAfter < weight
      ? `يتبقى ${(weight - detailTotalAfter).toFixed(2)} من وزن الفئة`
      : 'مجموع التقييمات يساوي وزن الفئة';
  res.status(201).json({ assessment: db.prepare('SELECT * FROM assessments WHERE id = ?').get(id), detail_total: detailTotalAfter, warning });
});

// PATCH /api/grades/assessments/:id  -> edit a detail title, maximum, or date
router.patch('/assessments/:id', (req, res) => {
  const assessment = getOperableAssessment(req.params.id, req.teacherId);
  if (!assessment) return res.status(404).json({ error: 'التقييم غير موجود' });
  if (Number(assessment.is_summary)) return res.status(400).json({ error: 'لا يمكن تعديل خانة الفئة الأساسية من هنا' });
  const title = req.body.title === undefined ? assessment.title : String(req.body.title || '').trim();
  const max = req.body.max_score === undefined ? Number(assessment.max_score) : Number(req.body.max_score);
  if (!title) return res.status(400).json({ error: 'عنوان التقييم مطلوب' });
  if (!Number.isFinite(max) || max <= 0) return res.status(400).json({ error: 'قيمة التقييم يجب أن تكون أكبر من صفر' });
  db.prepare('UPDATE assessments SET title = ?, max_score = ?, date = COALESCE(?, date) WHERE id = ?')
    .run(title, max, req.body.date === undefined ? null : req.body.date, assessment.id);
  const detailTotalAfter = detailTotal(assessment.category_id);
  const weight = Number(assessment.weight_percent || 0);
  const warning = detailTotalAfter > weight
    ? `مجموع التقييمات يتجاوز وزن الفئة بمقدار ${(detailTotalAfter - weight).toFixed(2)}`
    : detailTotalAfter < weight
      ? `يتبقى ${(weight - detailTotalAfter).toFixed(2)} من وزن الفئة`
      : 'مجموع التقييمات يساوي وزن الفئة';
  res.json({ assessment: db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessment.id), detail_total: detailTotalAfter, warning });
});

router.delete('/assessments/:id', (req, res) => {
  const assessment = getOperableAssessment(req.params.id, req.teacherId);
  if (!assessment) return res.status(404).json({ error: 'التقييم غير موجود' });
  const result = db.prepare('DELETE FROM assessments WHERE id = ?').run(assessment.id);
  if (result.changes === 0) return res.status(404).json({ error: 'التقييم غير موجود' });
  res.json({ success: true });
});

// ---------- Quick-Grid grade entry ----------

// GET /api/grades/grid?assessment_id=...  -> returns all students in the class with their grade (or null)
router.get('/grid', (req, res) => {
  const { assessment_id } = req.query;
  const assessment = getOperableAssessment(assessment_id, req.teacherId);
  if (!assessment) return res.status(404).json({ error: 'التقييم غير موجود' });

  const assessmentWithLimit = db.prepare(`SELECT a.*, gc.weight_percent, gc.grading_mode,
      (SELECT COUNT(*) FROM assessments a2 WHERE a2.category_id = gc.id AND a2.is_summary = 0) AS detail_count,
      (SELECT COUNT(*) FROM assessments a3 WHERE a3.category_id = gc.id) AS assessment_count
    FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id WHERE a.id = ?`).get(assessment_id);
  const rows = db.prepare(`SELECT s.id as student_id, s.full_name, g.id as grade_id, g.score_numeric, g.score_letter, g.rubric_json, g.comment
                            FROM students s LEFT JOIN grades g ON g.student_id = s.id AND g.assessment_id = ?
                            WHERE s.class_id = ? AND s.archived = 0 ORDER BY s.full_name COLLATE NOCASE`)
    .all(assessment_id, assessment.class_id);

  res.json({ assessment: { ...assessmentWithLimit, max_score: effectiveAssessmentMax(assessmentWithLimit) }, rows });
});

// POST /api/grades/grid  { assessment_id, entries: [{student_id, score_numeric | score_letter | rubric_json, comment}] }
router.post('/grid', (req, res) => {
  const { assessment_id, entries } = req.body;
  const assessment = getOperableAssessment(assessment_id, req.teacherId);
  if (!assessment) return res.status(404).json({ error: 'التقييم غير موجود' });

  const upsert = db.prepare(`INSERT INTO grades (id, assessment_id, student_id, score_numeric, score_letter, rubric_json, comment, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                              ON CONFLICT(assessment_id, student_id) DO UPDATE SET
                                score_numeric=excluded.score_numeric, score_letter=excluded.score_letter,
                                rubric_json=excluded.rubric_json, comment=excluded.comment, updated_at=datetime('now')`);
  const assessmentLimit = db.prepare(`SELECT a.*, gc.weight_percent, gc.grading_mode,
      (SELECT COUNT(*) FROM assessments a2 WHERE a2.category_id = gc.id AND a2.is_summary = 0) AS detail_count,
      (SELECT COUNT(*) FROM assessments a3 WHERE a3.category_id = gc.id) AS assessment_count
    FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id WHERE a.id = ?`).get(assessment_id);
  const maxScore = effectiveAssessmentMax(assessmentLimit);
  const saveAll = db.transaction((items) => {
    for (const item of items) {
      const student = db.prepare('SELECT id FROM students WHERE id = ? AND class_id = ? AND archived = 0').get(item.student_id, assessment.class_id);
      if (!student) throw new Error('الطالب غير موجود في هذا الصف');
      const validationError = validateScore(item.score_numeric, maxScore);
      if (validationError) throw new Error(validationError);
      upsert.run(uuid(), assessment_id, item.student_id, item.score_numeric ?? null, item.score_letter ?? null,
        item.rubric_json ? JSON.stringify(item.rubric_json) : null, item.comment ?? null);
    }
  });
  try {
    saveAll(entries || []);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'الدرجة غير صالحة' });
  }
  res.json({ success: true, saved: (entries || []).length });
});

// ---------- Full matrix (spreadsheet-style) view: all students x all assessments ----------

// GET /api/grades/matrix?class_id=...
router.get('/matrix', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });

  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE').all(class_id);
  const categories = db.prepare('SELECT * FROM grade_categories WHERE class_id = ? ORDER BY sort_order').all(class_id);

  // Self-heal categories in one read/write batch. The previous implementation did
  // two existence queries plus one assessment query per category on every matrix load.
  const categoryIds = categories.map((cat) => cat.id);
  const placeholders = categoryIds.map(() => '?').join(',');
  const existingAssessments = categoryIds.length
    ? db.prepare(`SELECT id, category_id, is_summary FROM assessments WHERE category_id IN (${placeholders})`).all(...categoryIds)
    : [];
  const existingByCategory = new Map();
  existingAssessments.forEach((assessment) => {
    const rows = existingByCategory.get(assessment.category_id) || [];
    rows.push(assessment);
    existingByCategory.set(assessment.category_id, rows);
  });
  const repairs = categories.flatMap((cat) => {
    const rows = existingByCategory.get(cat.id) || [];
    return rows.length === 0 || !rows.some((assessment) => Number(assessment.is_summary) === 1) ? [cat] : [];
  });
  if (repairs.length > 0) {
    const insertDefaultAssessment = db.prepare(`INSERT INTO assessments (id, category_id, title, max_score, is_summary) VALUES (?, ?, ?, ?, 1)`);
    const repairAll = db.transaction((items) => {
      items.forEach((cat) => insertDefaultAssessment.run(uuid(), cat.id, cat.name, Number(cat.weight_percent || 0)));
    });
    repairAll(repairs);
  }

  const allAssessments = categoryIds.length
    ? db.prepare(`SELECT * FROM assessments WHERE category_id IN (${placeholders}) ORDER BY category_id, is_summary DESC, date, created_at`).all(...categoryIds)
    : [];
  const assessmentsByCategory = new Map();
  allAssessments.forEach((assessment) => {
    const rows = assessmentsByCategory.get(assessment.category_id) || [];
    rows.push(assessment);
    assessmentsByCategory.set(assessment.category_id, rows);
  });
  const categoriesWithAssessments = categories.map((cat) => ({
    ...cat,
    assessments: assessmentsByCategory.get(cat.id) || [],
  }));

  const allAssessmentIds = allAssessments.map((assessment) => assessment.id);
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
  const ownedRows = db.prepare(`SELECT a.id, a.max_score, a.is_summary, gc.class_id, gc.weight_percent, gc.grading_mode,
                               (SELECT COUNT(*) FROM assessments a2 WHERE a2.category_id = gc.id AND a2.is_summary = 0) AS detail_count,
                               (SELECT COUNT(*) FROM assessments a3 WHERE a3.category_id = gc.id) AS assessment_count
                             FROM assessments a JOIN grade_categories gc ON a.category_id = gc.id
                             WHERE a.id IN (${placeholders})`)
    .all(...assessmentIds);
  const owned = ownedRows.filter((row) => canTeacherOperateClass(row.class_id, req.teacherId));
  const ownedMap = new Map(owned.map((o) => [o.id, o]));
  if (owned.length !== assessmentIds.length) return res.status(403).json({ error: 'لا تملك صلاحية على أحد هذه التقييمات' });

  const upsert = db.prepare(`INSERT INTO grades (id, assessment_id, student_id, score_numeric, comment, updated_at)
                              VALUES (?, ?, ?, ?, ?, datetime('now'))
                              ON CONFLICT(assessment_id, student_id) DO UPDATE SET
                                score_numeric=excluded.score_numeric, comment=excluded.comment, updated_at=datetime('now')`);
  const saveAll = db.transaction((items) => {
    let count = 0;
    for (const item of items) {
      const assessment = ownedMap.get(item.assessment_id);
      if (!assessment) continue;
      const maxScore = effectiveAssessmentMax(assessment);
      const validationError = validateScore(item.score_numeric, maxScore);
      if (validationError) throw new Error(validationError);
      const student = db.prepare('SELECT id FROM students WHERE id = ? AND class_id = ? AND archived = 0').get(item.student_id, assessment.class_id);
      if (!student) throw new Error('الطالب غير موجود في هذا الصف');
      upsert.run(uuid(), item.assessment_id, item.student_id, item.score_numeric ?? null, item.comment ?? null);
      count += 1;
    }
    return count;
  });
  let saved;
  try {
    saved = saveAll(entries);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'الدرجة غير صالحة' });
  }
  res.json({ success: true, saved });
});

// GET /api/grades/summary?class_id=...  -> weighted final grade per student across categories
router.get('/summary', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });

  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? AND archived = 0').all(class_id);
  const categories = db.prepare('SELECT * FROM grade_categories WHERE class_id = ? ORDER BY sort_order').all(class_id);
  const categoryIds = categories.map((category) => category.id);
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  const assessments = categoryIds.length
    ? db.prepare(`SELECT id, category_id, max_score, is_summary FROM assessments WHERE category_id IN (${categoryPlaceholders})`).all(...categoryIds)
    : [];
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const gradePlaceholders = assessmentIds.map(() => '?').join(',');
  const studentIds = students.map((student) => student.id);
  const studentPlaceholders = studentIds.map(() => '?').join(',');
  const gradeRows = assessmentIds.length && studentIds.length
    ? db.prepare(`SELECT assessment_id, student_id, score_numeric FROM grades WHERE assessment_id IN (${gradePlaceholders}) AND student_id IN (${studentPlaceholders})`).all(...assessmentIds, ...studentIds)
    : [];
  const assessmentsByCategory = new Map();
  assessments.forEach((assessment) => {
    const rows = assessmentsByCategory.get(assessment.category_id) || [];
    rows.push(assessment);
    assessmentsByCategory.set(assessment.category_id, rows);
  });
  const gradeMap = new Map(gradeRows.map((grade) => [`${grade.assessment_id}:${grade.student_id}`, grade]));

  const summary = students.map((student) => {
    let weightedTotal = 0;
    let weightUsed = 0;
    const perCategory = categories.map((cat) => {
      const pct = weightedPercentFromMemory(student.id, cat, assessmentsByCategory.get(cat.id) || [], gradeMap);
      if (pct !== null) {
        weightedTotal += pct * (Number(cat.weight_percent || 0) / 100);
        weightUsed += Number(cat.weight_percent || 0);
      }
      return { category_id: cat.id, category_name: cat.name, weight_percent: cat.weight_percent, percent: pct,
        weighted_points: pct === null ? null : Number(((pct * Number(cat.weight_percent || 0)) / 100).toFixed(2)) };
    });
    const finalGrade = weightUsed > 0 ? Number(((weightedTotal / weightUsed) * 100).toFixed(2)) : null;
    return { student_id: student.id, full_name: student.full_name, perCategory, finalGrade };
  });

  res.json({ summary });
});

module.exports = router;
