const express = require('express');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  canSchoolManagerManageSchool,
  canTeacherOperateClass,
  getSchoolMembership,
  isSchoolManagerAccount,
} = require('../utils/schoolAccess');

const router = express.Router();
router.use(requireAuth);

const DEFAULT_BEHAVIORS = [
  ['مشاركة متميزة', 'positive', 2, 'star'],
  ['إحضار الأدوات', 'positive', 1, 'check'],
  ['مساعدة زميل', 'positive', 1, 'heart'],
  ['تأخر عن الحصة', 'negative', -1, 'clock'],
  ['إزعاج الصف', 'negative', -2, 'alert'],
  ['عدم إحضار الواجب', 'negative', -1, 'x'],
];
const DEFAULT_CATEGORIES = [
  ['مشاركة', 10],
  ['واجبات منزلية', 15],
  ['اختبارات قصيرة', 20],
  ['مشروع', 15],
  ['اختبار نهائي', 40],
];

function clean(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeSubject(value) {
  return String(value || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '').trim().toLocaleLowerCase('en-US').replace(/^ال/u, '').replace(/\s+/g, ' ');
}

function subjectInputs(body) {
  const source = Array.isArray(body?.subjects)
    ? body.subjects
    : String(body?.subjects || body?.subject || '').split(',');
  const seen = new Set();
  return source.map((item) => ({ label: clean(item, 160), key: normalizeSubject(item) }))
    .filter((item) => item.label && item.key && !seen.has(item.key) && seen.add(item.key));
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function getSchool(schoolId) {
  return db.prepare("SELECT * FROM schools WHERE id = ? AND status = 'active'").get(schoolId) || null;
}

function getMembership(schoolId, teacherId) {
  return getSchoolMembership(schoolId, teacherId);
}

function requireManager(schoolId, teacherId, res) {
  const membership = getMembership(schoolId, teacherId);
  if (!membership || membership.role !== 'school_admin' || !canSchoolManagerManageSchool(schoolId, teacherId)) {
    res.status(403).json({ error: 'هذه العملية متاحة لمدير المدرسة فقط', code: 'SCHOOL_MANAGER_REQUIRED' });
    return null;
  }
  return membership;
}

function requireManagedClass(schoolId, classId, teacherId, res) {
  if (!requireManager(schoolId, teacherId, res)) return null;
  const classData = db.prepare("SELECT * FROM classes WHERE id = ? AND school_id = ? AND archived = 0").get(classId, schoolId);
  if (!classData) {
    res.status(404).json({ error: 'الصف غير موجود في هذه المدرسة', code: 'SCHOOL_CLASS_NOT_FOUND' });
    return null;
  }
  return classData;
}

function seedSubjectResources(classId, subjectKey) {
  const behaviorInsert = db.prepare(`INSERT INTO behavior_types (id, class_id, subject_key, label, polarity, points, icon, is_default)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
  DEFAULT_BEHAVIORS.forEach(([label, polarity, points, icon]) => behaviorInsert.run(uuid(), classId, subjectKey, label, polarity, points, icon));
  const categoryInsert = db.prepare(`INSERT INTO grade_categories (id, class_id, subject_key, name, weight_percent, grading_type, grading_mode, sort_order)
                                     VALUES (?, ?, ?, ?, ?, 'numeric', 'direct', ?)`);
  const assessmentInsert = db.prepare(`INSERT INTO assessments (id, category_id, title, max_score, is_summary) VALUES (?, ?, ?, ?, 1)`);
  DEFAULT_CATEGORIES.forEach(([name, weight], index) => {
    const categoryId = uuid();
    categoryInsert.run(categoryId, classId, subjectKey, name, weight, index);
    assessmentInsert.run(uuid(), categoryId, name, weight);
  });
}

function addClassSubject(classData, subject, managerId) {
  const id = uuid();
  db.prepare(`INSERT INTO school_class_subjects (id, school_id, class_id, subject_key, subject_label, sort_order, created_by)
              VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM school_class_subjects WHERE class_id = ?), 0), ?)`)
    .run(id, classData.school_id, classData.id, subject.key, subject.label, classData.id, managerId);
  seedSubjectResources(classData.id, subject.key);
  return db.prepare('SELECT * FROM school_class_subjects WHERE id = ?').get(id);
}

function getClassSubjects(classId, managerView, teacherId) {
  const sql = managerView
    ? `SELECT scs.*, a.id AS assignment_id, a.teacher_id AS assigned_teacher_id, a.assigned_by,
              a.accepted_at, t.full_name AS assigned_teacher_name, t.email AS assigned_teacher_email
       FROM school_class_subjects scs
       LEFT JOIN school_class_assignments a
         ON a.class_id = scs.class_id AND a.subject_key = scs.subject_key AND a.status = 'active'
       LEFT JOIN teachers t ON t.id = a.teacher_id
       WHERE scs.class_id = ? AND scs.status = 'active'
       ORDER BY scs.sort_order, scs.subject_label COLLATE NOCASE`
    : `SELECT scs.*, a.id AS assignment_id, a.teacher_id AS assigned_teacher_id, a.assigned_by,
              a.accepted_at, t.full_name AS assigned_teacher_name, t.email AS assigned_teacher_email
       FROM school_class_subjects scs
       JOIN school_class_assignments a
         ON a.class_id = scs.class_id AND a.subject_key = scs.subject_key AND a.status = 'active' AND a.teacher_id = ?
       LEFT JOIN teachers t ON t.id = a.teacher_id
       WHERE scs.class_id = ? AND scs.status = 'active'
       ORDER BY scs.sort_order, scs.subject_label COLLATE NOCASE`;
  return managerView ? db.prepare(sql).all(classId) : db.prepare(sql).all(teacherId, classId);
}

function schoolSummary(schoolId, teacherId) {
  const school = getSchool(schoolId);
  if (!school) return null;
  const membership = getMembership(schoolId, teacherId);
  if (!membership) return null;
  const managerView = membership.role === 'school_admin' && isSchoolManagerAccount(teacherId);
  const members = managerView
    ? db.prepare(`SELECT sm.id, sm.teacher_id, sm.role, sm.status, sm.created_at, t.full_name, t.email, t.subject, t.school_stage
                  FROM school_memberships sm JOIN teachers t ON t.id = sm.teacher_id
                  WHERE sm.school_id = ? AND sm.status = 'active'
                  ORDER BY CASE WHEN sm.role = 'school_admin' THEN 0 ELSE 1 END, t.full_name COLLATE NOCASE`).all(schoolId)
    : db.prepare(`SELECT sm.id, sm.teacher_id, sm.role, sm.status, sm.created_at, t.full_name, t.email, t.subject, t.school_stage
                  FROM school_memberships sm JOIN teachers t ON t.id = sm.teacher_id
                  WHERE sm.school_id = ? AND sm.teacher_id = ? AND sm.status = 'active'`).all(schoolId, teacherId);
  const classSql = managerView
    ? `SELECT c.*,
         (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.archived = 0) AS student_count,
         (SELECT COUNT(*) FROM grade_categories gc WHERE gc.class_id = c.id AND (gc.subject_key IS NOT NULL OR NOT EXISTS (SELECT 1 FROM school_class_subjects scx WHERE scx.class_id = c.id))) AS category_count,
         (SELECT COUNT(*) FROM behavior_logs bl JOIN students s ON s.id = bl.student_id WHERE s.class_id = c.id) AS behavior_count,
         (SELECT COUNT(*) FROM school_attendance_sessions sas WHERE sas.class_id = c.id AND sas.session_date = date('now')) AS attendance_session_count,
         (SELECT COUNT(*) FROM school_class_assignments aa WHERE aa.class_id = c.id AND aa.status = 'active') AS active_assignment_count
       FROM classes c WHERE c.school_id = ? AND c.archived = 0
       ORDER BY c.sort_order ASC, c.created_at DESC, c.id DESC`
    : `SELECT c.*,
         (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.archived = 0) AS student_count,
         (SELECT COUNT(*) FROM grade_categories gc WHERE gc.class_id = c.id AND (gc.subject_key IS NOT NULL OR NOT EXISTS (SELECT 1 FROM school_class_subjects scx WHERE scx.class_id = c.id))) AS category_count,
         (SELECT COUNT(*) FROM behavior_logs bl JOIN students s ON s.id = bl.student_id WHERE s.class_id = c.id) AS behavior_count,
         (SELECT COUNT(*) FROM school_attendance_sessions sas WHERE sas.class_id = c.id AND sas.session_date = date('now')) AS attendance_session_count,
         (SELECT COUNT(*) FROM school_class_assignments aa WHERE aa.class_id = c.id AND aa.status = 'active' AND aa.teacher_id = ?) AS active_assignment_count
       FROM classes c WHERE c.school_id = ? AND c.archived = 0
         AND EXISTS (SELECT 1 FROM school_class_assignments ax WHERE ax.class_id = c.id AND ax.teacher_id = ? AND ax.status = 'active')
       ORDER BY c.sort_order ASC, c.created_at DESC, c.id DESC`;
  const classes = managerView ? db.prepare(classSql).all(schoolId) : db.prepare(classSql).all(teacherId, schoolId, teacherId);
  const classSubjectMap = new Map();
  classes.forEach((item) => {
    const subjects = getClassSubjects(item.id, managerView, teacherId);
    classSubjectMap.set(item.id, subjects);
  });
  const enrichedClasses = classes.map((item) => {
    const subjects = classSubjectMap.get(item.id) || [];
    const assigned = subjects.filter((subject) => subject.assigned_teacher_id);
    return {
      ...item,
      school_class: true,
      subjects,
      subject_count: subjects.length,
      assigned_teacher_count: assigned.length,
      assigned_teacher_id: assigned[0]?.assigned_teacher_id || null,
      assigned_teacher_name: assigned[0]?.assigned_teacher_name || null,
    };
  });
  return {
    school: { ...school, member_count: members.length, class_count: enrichedClasses.length },
    membership,
    members,
    classes: enrichedClasses,
  };
}

function classSubjectsForTeacher(classId, teacherId) {
  return db.prepare(`SELECT a.subject_key, COALESCE(a.subject_label, scs.subject_label) AS subject_label,
                            a.id AS assignment_id
                     FROM school_class_assignments a
                     LEFT JOIN school_class_subjects scs ON scs.class_id = a.class_id AND scs.subject_key = a.subject_key
                     WHERE a.class_id = ? AND a.teacher_id = ? AND a.status = 'active'
                     ORDER BY subject_label COLLATE NOCASE`).all(classId, teacherId);
}

function subjectGradeMetrics(classId, subject) {
  const categories = db.prepare(`SELECT * FROM grade_categories WHERE class_id = ? AND (subject_key = ? OR subject_key IS NULL) ORDER BY sort_order`).all(classId, subject.subject_key);
  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE').all(classId);
  const categoryIds = categories.map((item) => item.id);
  const assessments = categoryIds.length
    ? db.prepare(`SELECT * FROM assessments WHERE category_id IN (${categoryIds.map(() => '?').join(',')}) ORDER BY category_id, is_summary DESC, created_at`).all(...categoryIds)
    : [];
  const assessmentIds = assessments.map((item) => item.id);
  const grades = assessmentIds.length
    ? db.prepare(`SELECT assessment_id, student_id, score_numeric, score_letter FROM grades WHERE assessment_id IN (${assessmentIds.map(() => '?').join(',')})`).all(...assessmentIds)
    : [];
  const assessmentMap = new Map();
  assessments.forEach((item) => {
    const rows = assessmentMap.get(item.category_id) || [];
    rows.push(item);
    assessmentMap.set(item.category_id, rows);
  });
  const gradeMap = new Map(grades.map((item) => [`${item.assessment_id}:${item.student_id}`, item]));
  const studentGrades = students.map((student) => {
    let finalGrade = 0;
    let weightEntered = 0;
    const perCategory = categories.map((category) => {
      const rows = assessmentMap.get(category.id) || [];
      const details = rows.filter((item) => Number(item.is_summary) !== 1);
      const enteredDetails = details.map((item) => ({ assessment: item, grade: gradeMap.get(`${item.id}:${student.id}`) })).filter((item) => item.grade?.score_numeric !== null && item.grade?.score_numeric !== undefined && item.grade?.score_numeric !== '');
      const summary = rows.find((item) => Number(item.is_summary) === 1);
      const summaryGrade = summary ? gradeMap.get(`${summary.id}:${student.id}`) : null;
      const source = enteredDetails.length ? enteredDetails : summaryGrade?.score_numeric !== null && summaryGrade?.score_numeric !== undefined && summaryGrade?.score_numeric !== '' ? [{ assessment: summary, grade: summaryGrade }] : [];
      const possible = source.reduce((sum, item) => sum + Number(item.assessment?.max_score || 0), 0);
      const earned = source.reduce((sum, item) => sum + Number(item.grade?.score_numeric || 0), 0);
      const percent = possible > 0 ? (earned / possible) * 100 : null;
      const weight = Number(category.weight_percent || 0);
      if (percent !== null) { finalGrade += percent * weight / 100; weightEntered += weight; }
      return { category_id: category.id, category_name: category.name, percent: percent === null ? null : Number(percent.toFixed(2)) };
    });
    return {
      student_id: student.id,
      full_name: student.full_name,
      final_grade: weightEntered > 0 ? Number(finalGrade.toFixed(2)) : null,
      weight_entered: Number(weightEntered.toFixed(2)),
      per_category: perCategory,
    };
  });
  return {
    subject_key: subject.subject_key,
    subject_label: subject.subject_label,
    assignment_id: subject.assignment_id || null,
    assigned_teacher_id: subject.assigned_teacher_id || null,
    assigned_teacher_name: subject.assigned_teacher_name || null,
    category_count: categories.length,
    grade_entries: grades.filter((item) => item.score_numeric !== null || item.score_letter !== null).length,
    graded_students: studentGrades.filter((item) => item.final_grade !== null).length,
    student_grades: studentGrades,
  };
}

function attendanceToday(classId) {
  const sessions = db.prepare(`SELECT sas.id, sas.subject_key, sas.period_key, sas.period_label, sas.starts_at, sas.recorded_at,
                                      COALESCE(scs.subject_label, sas.subject_key) AS subject_label,
                                      COUNT(sar.id) AS record_count,
                                      SUM(CASE WHEN sar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
                                      SUM(CASE WHEN sar.status = 'late' THEN 1 ELSE 0 END) AS late_count,
                                      SUM(CASE WHEN sar.status = 'excused' THEN 1 ELSE 0 END) AS excused_count
                               FROM school_attendance_sessions sas
                               LEFT JOIN school_attendance_records sar ON sar.session_id = sas.id
                               LEFT JOIN school_class_subjects scs ON scs.class_id = sas.class_id AND scs.subject_key = sas.subject_key
                               WHERE sas.class_id = ? AND sas.session_date = date('now')
                               GROUP BY sas.id ORDER BY COALESCE(sas.starts_at, ''), sas.period_key`).all(classId);
  const legacy = db.prepare(`SELECT ats.id, 'general' AS subject_key, 'daily' AS period_key, 'اليومي' AS period_label, NULL AS starts_at,
                                    NULL AS recorded_at, 'عام' AS subject_label, COUNT(ar.id) AS record_count,
                                    SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
                                    SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) AS late_count,
                                    SUM(CASE WHEN ar.status = 'excused' THEN 1 ELSE 0 END) AS excused_count
                             FROM attendance_sessions ats LEFT JOIN attendance_records ar ON ar.session_id = ats.id
                             WHERE ats.class_id = ? AND ats.session_date = date('now') GROUP BY ats.id`).all(classId);
  return [...sessions, ...legacy].map((row) => ({ ...row, record_count: Number(row.record_count || 0), absent_count: Number(row.absent_count || 0), late_count: Number(row.late_count || 0), excused_count: Number(row.excused_count || 0) }));
}

function behaviorMetrics(classId) {
  const rows = db.prepare(`SELECT s.id AS student_id, s.full_name,
                                  COALESCE(SUM(CASE WHEN COALESCE(bl.subject_key, bt.subject_key) IS NOT NULL AND bt.points > 0 THEN bt.points ELSE 0 END), 0) AS positive_points,
                                  COALESCE(SUM(CASE WHEN COALESCE(bl.subject_key, bt.subject_key) IS NOT NULL AND bt.points < 0 THEN ABS(bt.points) ELSE 0 END), 0) AS negative_points,
                                  COUNT(bl.id) AS behavior_count
                           FROM students s
                           LEFT JOIN behavior_logs bl ON bl.student_id = s.id
                           LEFT JOIN behavior_types bt ON bt.id = bl.behavior_type_id
                           WHERE s.class_id = ? AND s.archived = 0
                           GROUP BY s.id ORDER BY (positive_points - negative_points) ASC, s.full_name COLLATE NOCASE`).all(classId);
  const details = db.prepare(`SELECT bl.id, bl.student_id, s.full_name, COALESCE(bl.subject_key, bt.subject_key, 'general') AS subject_key,
                                     bt.label AS behavior_label, bt.polarity, bt.points, bl.note_text, bl.occurred_at
                              FROM behavior_logs bl JOIN students s ON s.id = bl.student_id
                              JOIN behavior_types bt ON bt.id = bl.behavior_type_id
                              WHERE s.class_id = ? AND s.archived = 0
                              ORDER BY datetime(bl.occurred_at) DESC LIMIT 100`).all(classId);
  return { students: rows, details };
}

function managerClassOverview(classData) {
  const subjects = db.prepare(`SELECT scs.*, a.id AS assignment_id, a.teacher_id AS assigned_teacher_id,
                                      t.full_name AS assigned_teacher_name, t.email AS assigned_teacher_email
                               FROM school_class_subjects scs
                               LEFT JOIN school_class_assignments a ON a.class_id = scs.class_id AND a.subject_key = scs.subject_key AND a.status = 'active'
                               LEFT JOIN teachers t ON t.id = a.teacher_id
                               WHERE scs.class_id = ? AND scs.status = 'active'
                               ORDER BY scs.sort_order, scs.subject_label COLLATE NOCASE`).all(classData.id);
  const subjectMetrics = subjects.map((subject) => subjectGradeMetrics(classData.id, subject));
  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE').all(classData.id);
  const behavior = behaviorMetrics(classData.id);
  const todayAttendance = attendanceToday(classData.id);
  const attention = new Map(behavior.students.map((row) => [row.student_id, { id: row.student_id, full_name: row.full_name, behavior_points: Number(row.positive_points || 0) - Number(row.negative_points || 0), behavior_count: Number(row.behavior_count || 0) }]));
  subjectMetrics.forEach((metric) => metric.student_grades.forEach((row) => {
    const target = attention.get(row.student_id);
    if (target) {
      target.subject_grades = target.subject_grades || [];
      target.subject_grades.push({ subject_key: metric.subject_key, subject_label: metric.subject_label, final_grade: row.final_grade });
    }
  }));
  return {
    class: { id: classData.id, name: classData.name, academic_year: classData.academic_year, color: classData.color, school_id: classData.school_id },
    subjects: subjectMetrics,
    metrics: {
      student_count: students.length,
      category_count: subjectMetrics.reduce((sum, item) => sum + item.category_count, 0),
      grade_entries: subjectMetrics.reduce((sum, item) => sum + item.grade_entries, 0),
      behavior_entries: behavior.details.length,
      attendance_entries_today: todayAttendance.reduce((sum, item) => sum + item.record_count, 0),
      attendance_sessions_today: todayAttendance.length,
    },
    attendance_today: todayAttendance,
    behavior_by_student: [...attention.values()],
    behavior_details: behavior.details,
    students_needing_attention: [...attention.values()].filter((row) => row.behavior_points < 0).sort((a, b) => a.behavior_points - b.behavior_points).slice(0, 20),
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT s.*, sm.role, sm.status AS membership_status,
      (SELECT COUNT(*) FROM school_memberships members WHERE members.school_id = s.id AND members.status = 'active') AS member_count,
      (SELECT COUNT(*) FROM classes c WHERE c.school_id = s.id AND c.archived = 0) AS class_count
    FROM schools s JOIN school_memberships sm ON sm.school_id = s.id
    WHERE sm.teacher_id = ? AND sm.status = 'active' AND s.status = 'active'
    ORDER BY datetime(s.created_at) DESC, s.id DESC`).all(req.teacherId);
  res.json({ schools: rows });
});

router.post('/', (req, res) => res.status(403).json({ error: 'يتم إنشاء المدارس ومديريها من لوحة المسؤول العام فقط', code: 'SCHOOL_PROVISIONING_ADMIN_ONLY' }));

router.get('/:schoolId', (req, res) => {
  const summary = schoolSummary(req.params.schoolId, req.teacherId);
  if (!summary) return res.status(404).json({ error: 'المدرسة غير موجودة أو لا تملك صلاحية الوصول', code: 'SCHOOL_NOT_FOUND' });
  res.json(summary);
});

router.get('/:schoolId/members', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const members = db.prepare(`SELECT sm.id, sm.teacher_id, sm.role, sm.status, sm.created_at, t.full_name, t.email, t.subject, t.school_stage
                              FROM school_memberships sm JOIN teachers t ON t.id = sm.teacher_id
                              WHERE sm.school_id = ? AND sm.status = 'active'
                              ORDER BY CASE WHEN sm.role = 'school_admin' THEN 0 ELSE 1 END, t.full_name COLLATE NOCASE`).all(req.params.schoolId);
  res.json({ members });
});

router.post('/:schoolId/classes', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const school = getSchool(req.params.schoolId);
  const name = clean(req.body?.name, 120);
  const subjects = subjectInputs(req.body);
  const academicYear = clean(req.body?.academic_year, 40);
  const color = clean(req.body?.color, 20) || '#2E7D6B';
  if (name.length < 2) return res.status(400).json({ error: 'اسم الصف مطلوب', code: 'INVALID_CLASS_NAME' });
  if (!subjects.length) return res.status(400).json({ error: 'أدخل مادة واحدة على الأقل للصف', code: 'CLASS_SUBJECT_REQUIRED' });
  const classId = clean(req.body?.id, 100) || uuid();
  if (db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) return res.status(409).json({ error: 'معرّف الصف مستخدم مسبقًا', code: 'CLASS_ID_EXISTS' });
  const insertClass = db.prepare(`INSERT INTO classes (id, teacher_id, school_id, name, subject, academic_year, color, icon, sort_order)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, 'school', ?)`);
  const nextOrder = Number(db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM classes WHERE school_id = ? AND archived = 0').get(school.id)?.next_order || 0);
  const create = db.transaction(() => {
    insertClass.run(classId, req.teacherId, school.id, name, subjects[0].label, academicYear || null, color, nextOrder);
    const classData = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    subjects.forEach((subject) => addClassSubject(classData, subject, req.teacherId));
    return classData;
  });
  const created = create();
  res.status(201).json({ class: { ...created, subjects: getClassSubjects(created.id, true, req.teacherId) } });
});

router.patch('/:schoolId/classes/:classId', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const updates = {};
  if (req.body?.name !== undefined) updates.name = clean(req.body.name, 120);
  if (req.body?.academic_year !== undefined) updates.academic_year = clean(req.body.academic_year, 40) || null;
  if (req.body?.color !== undefined) updates.color = clean(req.body.color, 20) || '#2E7D6B';
  if (updates.name !== undefined && updates.name.length < 2) return res.status(400).json({ error: 'اسم الصف مطلوب', code: 'INVALID_CLASS_NAME' });
  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'لا توجد بيانات للتعديل', code: 'CLASS_UPDATE_EMPTY' });
  db.prepare(`UPDATE classes SET ${keys.map((key) => `${key} = @${key}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: classData.id });
  res.json({ class: db.prepare('SELECT * FROM classes WHERE id = ?').get(classData.id) });
});

router.post('/:schoolId/classes/:classId/archive', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const archive = db.transaction(() => {
    db.prepare("UPDATE classes SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(classData.id);
    db.prepare("UPDATE school_class_assignments SET status = 'revoked', revoked_at = datetime('now') WHERE class_id = ? AND status = 'active'").run(classData.id);
    db.prepare("UPDATE school_assignment_codes SET status = 'revoked', updated_at = datetime('now') WHERE class_id = ? AND status = 'active'").run(classData.id);
  });
  archive();
  res.json({ success: true, class_id: classData.id });
});

router.post('/:schoolId/classes/:classId/subjects', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const subject = subjectInputs({ subject: req.body?.subject_label || req.body?.subject }).at(0);
  if (!subject) return res.status(400).json({ error: 'مادة الصف مطلوبة', code: 'CLASS_SUBJECT_REQUIRED' });
  if (db.prepare("SELECT id FROM school_class_subjects WHERE class_id = ? AND subject_key = ? AND status = 'active'").get(classData.id, subject.key)) return res.status(409).json({ error: 'هذه المادة موجودة في الصف مسبقًا', code: 'CLASS_SUBJECT_EXISTS' });
  const created = addClassSubject(classData, subject, req.teacherId);
  res.status(201).json({ subject: created });
});

router.delete('/:schoolId/classes/:classId/subjects/:subjectKey', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const subject = db.prepare("SELECT * FROM school_class_subjects WHERE class_id = ? AND subject_key = ? AND status = 'active'").get(classData.id, normalizeSubject(req.params.subjectKey));
  if (!subject) return res.status(404).json({ error: 'المادة غير موجودة في هذا الصف', code: 'CLASS_SUBJECT_NOT_FOUND' });
  if (db.prepare("SELECT id FROM school_class_assignments WHERE class_id = ? AND subject_key = ? AND status = 'active'").get(classData.id, subject.subject_key)) return res.status(409).json({ error: 'ألغِ إسناد المعلم قبل إيقاف المادة', code: 'CLASS_SUBJECT_ASSIGNED' });
  db.prepare("UPDATE school_class_subjects SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(subject.id);
  res.json({ success: true, subject_key: subject.subject_key });
});

router.get('/:schoolId/classes/:classId/students', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const students = db.prepare(`SELECT id, class_id, full_name, student_number, photo_url, archived, created_at, updated_at
                               FROM students WHERE class_id = ? ORDER BY archived ASC, full_name COLLATE NOCASE`).all(classData.id);
  res.json({ students });
});

router.post('/:schoolId/classes/:classId/students', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const fullName = clean(req.body?.full_name, 180);
  if (!fullName) return res.status(400).json({ error: 'اسم الطالب مطلوب', code: 'STUDENT_NAME_REQUIRED' });
  const id = clean(req.body?.id, 100) || uuid();
  const duplicate = db.prepare(`SELECT s.id FROM students s WHERE s.class_id = ? AND s.archived = 0 AND (lower(trim(s.full_name)) = lower(trim(?)) OR (? <> '' AND trim(COALESCE(s.student_number, '')) = trim(?)))`).get(classData.id, fullName, clean(req.body?.student_number, 80), clean(req.body?.student_number, 80));
  if (duplicate) return res.status(409).json({ error: 'الطالب موجود في هذا الصف مسبقًا', code: 'STUDENT_DUPLICATE' });
  db.prepare(`INSERT INTO students (id, class_id, full_name, student_number, photo_url) VALUES (?, ?, ?, ?, ?)`)
    .run(id, classData.id, fullName, clean(req.body?.student_number, 80) || null, clean(req.body?.photo_url, 500) || null);
  res.status(201).json({ student: db.prepare('SELECT id, class_id, full_name, student_number, photo_url, archived, created_at, updated_at FROM students WHERE id = ?').get(id) });
});

router.post('/:schoolId/classes/:classId/students/bulk', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  if (!Array.isArray(req.body?.students)) return res.status(400).json({ error: 'قائمة الطلاب غير صالحة', code: 'STUDENT_LIST_INVALID' });
  const insert = db.prepare('INSERT INTO students (id, class_id, full_name, student_number, photo_url) VALUES (?, ?, ?, ?, ?)');
  let imported = 0;
  const add = db.transaction(() => {
    for (const item of req.body.students.slice(0, 1000)) {
      const fullName = clean(item?.full_name || item?.name, 180);
      if (!fullName) continue;
      const number = clean(item?.student_number || item?.number, 80);
      const exists = db.prepare(`SELECT id FROM students WHERE class_id = ? AND archived = 0 AND (lower(trim(full_name)) = lower(trim(?)) OR (? <> '' AND trim(COALESCE(student_number, '')) = trim(?)))`).get(classData.id, fullName, number, number);
      if (exists) continue;
      insert.run(uuid(), classData.id, fullName, number || null, clean(item?.photo_url, 500) || null);
      imported += 1;
    }
  });
  add();
  res.status(201).json({ imported, students: db.prepare(`SELECT id, class_id, full_name, student_number, photo_url, archived, created_at, updated_at FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE`).all(classData.id) });
});

router.patch('/:schoolId/classes/:classId/students/:studentId', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const student = db.prepare('SELECT id FROM students WHERE id = ? AND class_id = ?').get(req.params.studentId, classData.id);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود في هذا الصف', code: 'STUDENT_NOT_FOUND' });
  const updates = {};
  if (req.body?.full_name !== undefined) updates.full_name = clean(req.body.full_name, 180);
  if (req.body?.student_number !== undefined) updates.student_number = clean(req.body.student_number, 80) || null;
  if (req.body?.photo_url !== undefined) updates.photo_url = clean(req.body.photo_url, 500) || null;
  const keys = Object.keys(updates);
  if (updates.full_name !== undefined && !updates.full_name) return res.status(400).json({ error: 'اسم الطالب مطلوب', code: 'STUDENT_NAME_REQUIRED' });
  if (keys.length) db.prepare(`UPDATE students SET ${keys.map((key) => `${key} = @${key}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: student.id });
  res.json({ student: db.prepare('SELECT id, class_id, full_name, student_number, photo_url, archived, created_at, updated_at FROM students WHERE id = ?').get(student.id) });
});

router.patch('/:schoolId/classes/:classId/students/:studentId/archive', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const result = db.prepare("UPDATE students SET archived = 1, updated_at = datetime('now') WHERE id = ? AND class_id = ?").run(req.params.studentId, classData.id);
  if (!result.changes) return res.status(404).json({ error: 'الطالب غير موجود في هذا الصف', code: 'STUDENT_NOT_FOUND' });
  res.json({ success: true });
});

router.patch('/:schoolId/classes/:classId/students/:studentId/restore', (req, res) => {
  const classData = requireManagedClass(req.params.schoolId, req.params.classId, req.teacherId, res);
  if (!classData) return;
  const result = db.prepare("UPDATE students SET archived = 0, updated_at = datetime('now') WHERE id = ? AND class_id = ?").run(req.params.studentId, classData.id);
  if (!result.changes) return res.status(404).json({ error: 'الطالب غير موجود في هذا الصف', code: 'STUDENT_NOT_FOUND' });
  res.json({ success: true });
});

router.post('/:schoolId/classes/:classId/assignment-code', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const classData = db.prepare("SELECT * FROM classes WHERE id = ? AND school_id = ? AND archived = 0").get(req.params.classId, req.params.schoolId);
  if (!classData) return res.status(404).json({ error: 'الصف غير موجود في هذه المدرسة', code: 'SCHOOL_CLASS_NOT_FOUND' });
  const subjectKey = normalizeSubject(req.body?.subject_key);
  const subject = db.prepare("SELECT * FROM school_class_subjects WHERE class_id = ? AND subject_key = ? AND status = 'active'").get(classData.id, subjectKey);
  if (!subject) return res.status(400).json({ error: 'اختر مادة فعالة للصف قبل توليد الكود', code: 'CLASS_SUBJECT_REQUIRED' });
  const expiresDays = Math.min(Math.max(Number.parseInt(req.body?.expires_days, 10) || 7, 1), 30);
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE school_assignment_codes SET status = 'revoked', updated_at = datetime('now') WHERE class_id = ? AND subject_key = ? AND status = 'active'").run(classData.id, subject.subject_key);
  let code;
  let codeHash;
  do {
    code = `EDU-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    codeHash = hashCode(code);
  } while (db.prepare('SELECT id FROM school_assignment_codes WHERE code_hash = ?').get(codeHash));
  const id = uuid();
  db.prepare(`INSERT INTO school_assignment_codes (id, school_id, class_id, subject_key, subject_label, created_by, code_hash, code_hint, status, max_uses, use_count, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 0, ?)`).run(id, classData.school_id, classData.id, subject.subject_key, subject.subject_label, req.teacherId, codeHash, code.slice(-4), expiresAt);
  res.status(201).json({ code, code_hint: code.slice(-4), expires_at: expiresAt, max_uses: 1, class: classData, subject });
});

router.post('/accept-assignment', (req, res) => {
  const code = clean(req.body?.code, 40).replace(/\s+/g, '').toUpperCase();
  if (!code) return res.status(400).json({ error: 'أدخل كود إسناد الصف', code: 'ASSIGNMENT_CODE_REQUIRED' });
  const assignmentCode = db.prepare(`SELECT ac.*, c.name AS class_name, c.subject AS class_subject, c.archived AS class_archived, s.name AS school_name
                                     FROM school_assignment_codes ac JOIN classes c ON c.id = ac.class_id JOIN schools s ON s.id = ac.school_id
                                     WHERE ac.code_hash = ? AND ac.status = 'active' AND c.archived = 0
                                       AND datetime(ac.expires_at) > datetime('now') AND ac.use_count < ac.max_uses`).get(hashCode(code));
  if (!assignmentCode) return res.status(404).json({ error: 'الكود غير صالح أو منتهي الصلاحية أو استُخدم بالكامل', code: 'ASSIGNMENT_CODE_INVALID' });
  const teacher = db.prepare('SELECT id, subject FROM teachers WHERE id = ?').get(req.teacherId);
  if (!normalizeSubject(teacher?.subject)) return res.status(409).json({ error: 'أكمل مادة المعلم من الإعدادات قبل قبول الإسناد', code: 'TEACHER_SUBJECT_REQUIRED' });
  if (normalizeSubject(teacher.subject) !== normalizeSubject(assignmentCode.subject_key) && normalizeSubject(teacher.subject) !== normalizeSubject(assignmentCode.subject_label)) {
    return res.status(409).json({ error: 'مادة الصف لا تطابق مادة المعلم في الحساب', code: 'ASSIGNMENT_SUBJECT_MISMATCH' });
  }
  const existing = db.prepare("SELECT * FROM school_class_assignments WHERE class_id = ? AND subject_key = ? AND status = 'active'").get(assignmentCode.class_id, assignmentCode.subject_key);
  if (existing && existing.teacher_id !== req.teacherId) return res.status(409).json({ error: 'هذه المادة مسندة حاليًا إلى معلم آخر', code: 'SUBJECT_ALREADY_ASSIGNED' });
  if (existing && existing.teacher_id === req.teacherId) return res.json({ reused: true, school: schoolSummary(assignmentCode.school_id, req.teacherId), assignment: existing });
  try {
    const accept = db.transaction(() => {
      const consumed = db.prepare(`UPDATE school_assignment_codes SET use_count = use_count + 1, status = 'consumed', updated_at = datetime('now')
                                    WHERE id = ? AND status = 'active' AND use_count < max_uses AND datetime(expires_at) > datetime('now')`).run(assignmentCode.id);
      if (consumed.changes !== 1) { const error = new Error('ASSIGNMENT_CODE_INVALID'); error.code = 'ASSIGNMENT_CODE_INVALID'; throw error; }
      db.prepare("INSERT OR IGNORE INTO school_memberships (id, school_id, teacher_id, role, status, created_by) VALUES (?, ?, ?, 'teacher', 'active', ?)").run(uuid(), assignmentCode.school_id, req.teacherId, req.teacherId);
      const assignmentId = uuid();
      db.prepare(`INSERT INTO school_class_assignments (id, school_id, class_id, teacher_id, subject_key, subject_label, assigned_by, code_id, status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run(assignmentId, assignmentCode.school_id, assignmentCode.class_id, req.teacherId, assignmentCode.subject_key, assignmentCode.subject_label, assignmentCode.created_by, assignmentCode.id);
      return db.prepare('SELECT * FROM school_class_assignments WHERE id = ?').get(assignmentId);
    });
    const assignment = accept();
    res.json({ success: true, school: schoolSummary(assignmentCode.school_id, req.teacherId), assignment });
  } catch (error) {
    if (error?.code === 'ASSIGNMENT_CODE_INVALID') return res.status(404).json({ error: 'الكود غير صالح أو منتهي الصلاحية أو استُخدم بالكامل', code: 'ASSIGNMENT_CODE_INVALID' });
    if (String(error?.message || '').includes('idx_school_active_assignment_subject') || error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'هذه المادة مسندة حاليًا إلى معلم آخر', code: 'SUBJECT_ALREADY_ASSIGNED' });
    throw error;
  }
});

router.get('/:schoolId/classes/:classId/overview', (req, res) => {
  const membership = getMembership(req.params.schoolId, req.teacherId);
  if (!membership) return res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى بيانات المدرسة', code: 'SCHOOL_ACCESS_DENIED' });
  const classData = db.prepare('SELECT * FROM classes WHERE id = ? AND school_id = ? AND archived = 0').get(req.params.classId, req.params.schoolId);
  if (!classData) return res.status(404).json({ error: 'الصف غير موجود', code: 'SCHOOL_CLASS_NOT_FOUND' });
  const managerView = membership.role === 'school_admin' && isSchoolManagerAccount(req.teacherId);
  const teacherAccess = canTeacherOperateClass(classData.id, req.teacherId);
  if (!managerView && !teacherAccess) return res.status(403).json({ error: 'لا تملك إسنادًا نشطًا لهذا الصف', code: 'SCHOOL_CLASS_ACCESS_DENIED' });
  if (managerView) return res.json(managerClassOverview(classData));
  const assignedSubjects = classSubjectsForTeacher(classData.id, req.teacherId);
  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE').all(classData.id);
  res.json({
    class: { id: classData.id, name: classData.name, academic_year: classData.academic_year, color: classData.color, school_id: classData.school_id },
    subjects: assignedSubjects,
    metrics: { student_count: students.length },
  });
});

router.delete('/:schoolId/assignments/:assignmentId', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const assignment = db.prepare("SELECT * FROM school_class_assignments WHERE id = ? AND school_id = ? AND status = 'active'").get(req.params.assignmentId, req.params.schoolId);
  if (!assignment) return res.status(404).json({ error: 'الإسناد غير موجود', code: 'ASSIGNMENT_NOT_FOUND' });
  db.prepare("UPDATE school_class_assignments SET status = 'revoked', revoked_at = datetime('now') WHERE id = ?").run(assignment.id);
  res.json({ success: true, assignment_id: assignment.id, subject_key: assignment.subject_key });
});

module.exports = router;
