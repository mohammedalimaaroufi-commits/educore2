const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/restrictions');
const { canTeacherOperateClass } = require('../utils/schoolAccess');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('reports'));

function assertClassOwnership(classId, teacherId) {
  return canTeacherOperateClass(classId, teacherId)
    ? db.prepare('SELECT id FROM classes WHERE id = ? AND archived = 0').get(classId)
    : null;
}

function hasScore(row) {
  return row && row.score_numeric !== null && row.score_numeric !== undefined && row.score_numeric !== '';
}

function effectiveCategoryRows(category, rows = []) {
  const detailed = rows.filter((row) => !Number(row.is_summary));
  const summaries = rows.filter((row) => Number(row.is_summary));
  if (category?.grading_mode === 'detailed' && detailed.some(hasScore)) return detailed;
  if (summaries.some(hasScore)) return summaries;
  return category?.grading_mode === 'detailed' ? detailed : (summaries.length ? summaries : rows);
}

function buildClassRoster(classId) {
  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE').all(classId);
  const categories = db.prepare('SELECT id, name, weight_percent, grading_mode, sort_order FROM grade_categories WHERE class_id = ? ORDER BY sort_order').all(classId);
  const gradeRows = db.prepare(`
    SELECT g.student_id, gc.id as category_id, gc.weight_percent, gc.grading_mode,
           a.max_score, a.is_summary, g.score_numeric
    FROM assessments a
    JOIN grade_categories gc ON gc.id = a.category_id
    LEFT JOIN grades g ON g.assessment_id = a.id
    JOIN students s ON s.id = g.student_id AND s.class_id = ? AND s.archived = 0
    WHERE gc.class_id = ?
  `).all(classId, classId);
  const gradeByStudent = new Map();
  gradeRows.forEach((row) => {
    if (!gradeByStudent.has(row.student_id)) gradeByStudent.set(row.student_id, new Map());
    const categoryRows = gradeByStudent.get(row.student_id).get(row.category_id) || [];
    categoryRows.push(row);
    gradeByStudent.get(row.student_id).set(row.category_id, categoryRows);
  });
  const behaviorRows = db.prepare(`
    SELECT bl.student_id, COALESCE(SUM(bt.points), 0) as score
    FROM behavior_logs bl
    JOIN behavior_types bt ON bt.id = bl.behavior_type_id
    JOIN students s ON s.id = bl.student_id AND s.class_id = ? AND s.archived = 0
    GROUP BY bl.student_id
  `).all(classId);
  const behaviorByStudent = new Map(behaviorRows.map((row) => [row.student_id, Number(row.score || 0)]));
  const attendanceRows = db.prepare(`
    SELECT ar.student_id,
           COUNT(*) as total,
           SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) as present
    FROM attendance_records ar
    JOIN attendance_sessions ats ON ats.id = ar.session_id AND ats.class_id = ?
    JOIN students s ON s.id = ar.student_id AND s.class_id = ? AND s.archived = 0
    GROUP BY ar.student_id
  `).all(classId, classId);
  const attendanceByStudent = new Map(attendanceRows.map((row) => [row.student_id, row]));

  return students.map((student) => {
    const categoryMap = gradeByStudent.get(student.id) || new Map();
    let weightedTotal = 0;
    let weightUsed = 0;
    categories.forEach((category) => {
      const rows = effectiveCategoryRows(category, categoryMap.get(category.id) || []);
      const scored = rows.filter(hasScore);
      const possible = scored.reduce((sum, row) => sum + Number(row.max_score || 0), 0);
      const earned = scored.reduce((sum, row) => sum + Number(row.score_numeric || 0), 0);
      if (possible > 0) {
        const percent = (earned / possible) * 100;
        weightedTotal += percent * (Number(category.weight_percent) / 100);
        weightUsed += Number(category.weight_percent);
      }
    });
    const finalGrade = weightUsed > 0 ? Number(((weightedTotal / weightUsed) * 100).toFixed(2)) : null;
    const attendance = attendanceByStudent.get(student.id);
    const attendanceRate = attendance && Number(attendance.total) > 0 ? Number(((Number(attendance.present || 0) / Number(attendance.total)) * 100).toFixed(1)) : null;
    return {
      student_id: student.id,
      full_name: student.full_name,
      finalGrade,
      behaviorScore: behaviorByStudent.get(student.id) || 0,
      attendanceRate,
    };
  });
}

router.get('/grade-distribution', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const roster = buildClassRoster(class_id);
  const buckets = { '0-59': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90-100': 0 };
  roster.forEach((row) => {
    if (row.finalGrade === null) return;
    if (row.finalGrade < 60) buckets['0-59'] += 1;
    else if (row.finalGrade < 70) buckets['60-69'] += 1;
    else if (row.finalGrade < 80) buckets['70-79'] += 1;
    else if (row.finalGrade < 90) buckets['80-89'] += 1;
    else buckets['90-100'] += 1;
  });
  res.json({ buckets, finals: roster });
});

router.get('/category-averages', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const studentCount = db.prepare('SELECT COUNT(*) as c FROM students WHERE class_id = ? AND archived = 0').get(class_id).c;
  const rows = db.prepare(`
    SELECT gc.id, gc.name as category, gc.weight_percent,
           AVG(CASE WHEN g.score_numeric IS NOT NULL THEN (g.score_numeric / a.max_score) * 100 END) as average_percent,
           COUNT(CASE WHEN g.score_numeric IS NOT NULL THEN 1 END) as entered_count
    FROM grade_categories gc
    LEFT JOIN assessments a ON a.category_id = gc.id
    LEFT JOIN grades g ON g.assessment_id = a.id
    LEFT JOIN students s ON s.id = g.student_id AND s.class_id = ? AND s.archived = 0
    WHERE gc.class_id = ?
    GROUP BY gc.id, gc.name, gc.weight_percent, gc.sort_order
    ORDER BY gc.sort_order
  `).all(class_id, class_id);
  res.json({ categories: rows.map((row) => ({ category: row.category, weight_percent: row.weight_percent, averagePercent: row.average_percent === null ? null : Number(Number(row.average_percent).toFixed(1)), enteredCount: Number(row.entered_count || 0), studentCount })) });
});

router.get('/growth', (req, res) => {
  const { student_id } = req.query;
  const student = db.prepare('SELECT s.* FROM students s WHERE s.id = ?').get(student_id);
  if (!student || !canTeacherOperateClass(student.class_id, req.teacherId)) return res.status(404).json({ error: 'الطالب غير موجود' });
  const rows = db.prepare(`SELECT a.title, a.date, a.max_score, g.score_numeric, gc.name as category_name
                            FROM grades g JOIN assessments a ON g.assessment_id = a.id
                            JOIN grade_categories gc ON a.category_id = gc.id
                            WHERE g.student_id = ? AND g.score_numeric IS NOT NULL
                            ORDER BY a.date ASC, a.created_at ASC`).all(student_id);
  res.json({ series: rows.map((row) => ({ title: row.title, date: row.date, category: row.category_name, percent: Number(((row.score_numeric / row.max_score) * 100).toFixed(2)) })) });
});

router.get('/student/:id', (req, res) => {
  const student = db.prepare('SELECT s.* FROM students s WHERE s.id = ?').get(req.params.id);
  if (!student || !canTeacherOperateClass(student.class_id, req.teacherId)) return res.status(404).json({ error: 'الطالب غير موجود' });
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(student.class_id);
  const gradeRows = db.prepare(`
    SELECT gc.id as category_id, gc.name as category, gc.weight_percent, gc.grading_mode,
           a.id as assessment_id, a.title, a.max_score, a.date, a.created_at,
           g.score_numeric, g.comment
    FROM grade_categories gc
    LEFT JOIN assessments a ON a.category_id = gc.id
    LEFT JOIN grades g ON g.assessment_id = a.id AND g.student_id = ?
    WHERE gc.class_id = ?
    ORDER BY gc.sort_order, a.date, a.created_at
  `).all(student.id, student.class_id);
  const categoryMap = new Map();
  gradeRows.forEach((row) => {
    if (!categoryMap.has(row.category_id)) categoryMap.set(row.category_id, { category: row.category, weight_percent: row.weight_percent, grading_mode: row.grading_mode, items: [] });
    if (row.assessment_id) categoryMap.get(row.category_id).items.push({ title: row.title, max_score: row.max_score, score: row.score_numeric ?? null, score_numeric: row.score_numeric ?? null, is_summary: row.is_summary, comment: row.comment ?? null });
  });
  const gradesByCategory = [...categoryMap.values()];
  const behaviorLogs = db.prepare(`SELECT bl.occurred_at, bt.label, bt.polarity, bt.points, bl.note_text FROM behavior_logs bl JOIN behavior_types bt ON bl.behavior_type_id = bt.id WHERE bl.student_id = ? ORDER BY bl.occurred_at DESC`).all(student.id);
  const behaviorScore = behaviorLogs.reduce((sum, row) => sum + Number(row.points || 0), 0);
  const attendance = db.prepare(`SELECT ats.session_date, ar.status FROM attendance_records ar JOIN attendance_sessions ats ON ar.session_id = ats.id WHERE ar.student_id = ? ORDER BY ats.session_date DESC`).all(student.id);
  const attendanceTotals = attendance.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
  let weightedTotal = 0;
  let weightUsed = 0;
  gradesByCategory.forEach((category) => {
    const scored = effectiveCategoryRows(category, category.items).filter((item) => item.score !== null);
    const possible = scored.reduce((sum, item) => sum + Number(item.max_score || 0), 0);
    const earned = scored.reduce((sum, item) => sum + Number(item.score || 0), 0);
    if (possible > 0) { weightedTotal += (earned / possible) * 100 * (Number(category.weight_percent) / 100); weightUsed += Number(category.weight_percent); }
  });
  const finalGrade = weightUsed > 0 ? Number(((weightedTotal / weightUsed) * 100).toFixed(2)) : null;
  const rules = db.prepare('SELECT * FROM grade_recommendation_rules WHERE teacher_id = ? ORDER BY sort_order').all(req.teacherId);
  const match = rules.find((rule) => finalGrade !== null && finalGrade >= rule.min_score && finalGrade <= rule.max_score);
  res.json({ student, class: cls, gradesByCategory, behaviorLogs, behaviorScore, attendance, attendanceTotals, finalGrade, autoRecommendation: match?.text || null, generated_at: new Date().toISOString() });
});

router.get('/class/:id', (req, res) => {
  if (!assertClassOwnership(req.params.id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  res.json({ class: cls, roster: buildClassRoster(req.params.id), generated_at: new Date().toISOString() });
});

module.exports = router;
