const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getStudentCount, getActiveStudentLimit } = require('../utils/subscriptions');
const { isSchoolManagerAccount } = require('../utils/schoolAccess');

const router = express.Router();
router.use(requireAuth);

const BACKUP_VERSION = 1;

// Generic "insert this row if its id doesn't already exist" helper, schema-aware so a backup
// taken from one app version still imports cleanly even if columns were added/renamed later —
// it only ever writes columns that actually exist in the current table, and ignores the rest.
const tableColumnsCache = {};
function tableColumns(table) {
  if (!tableColumnsCache[table]) {
    tableColumnsCache[table] = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  }
  return tableColumnsCache[table];
}
function insertIfMissing(table, row) {
  if (!row || !row.id) return false;
  if (db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(row.id)) return false;
  const cols = tableColumns(table).filter((c) => Object.prototype.hasOwnProperty.call(row, c));
  const placeholders = cols.map((c) => `@${c}`).join(', ');
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(row);
  return true;
}

// GET /api/backup/export
// Bundles everything owned by this teacher (classes, students, grades, behavior, attendance,
// schemes, templates, rules) into one JSON file the browser downloads and the teacher keeps
// locally ("حفظ نسخة اختياطية محليًا") — no cloud storage involved; the SQLite database itself
// is already 100% local, this is just a portable snapshot of it.
router.get('/export', (req, res) => {
  const teacherId = req.teacherId;
  if (isSchoolManagerAccount(teacherId)) return res.status(403).json({ error: 'النسخ الاحتياطي متاح للصفوف الشخصية فقط', code: 'PERSONAL_BACKUP_ONLY' });
  const teacher = db.prepare('SELECT id, full_name, email, subject, school_stage, school_name FROM teachers WHERE id = ?').get(teacherId);

  const classes = db.prepare('SELECT * FROM classes WHERE teacher_id = ? AND school_id IS NULL').all(teacherId);
  const data = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    teacher,
    classes: classes.map((cls) => {
      const students = db.prepare('SELECT * FROM students WHERE class_id = ?').all(cls.id);
      const categories = db.prepare('SELECT * FROM grade_categories WHERE class_id = ?').all(cls.id).map((cat) => ({
        ...cat,
        assessments: db.prepare('SELECT * FROM assessments WHERE category_id = ?').all(cat.id).map((a) => ({
          ...a,
          grades: db.prepare('SELECT * FROM grades WHERE assessment_id = ?').all(a.id),
        })),
      }));
      const behaviorTypes = db.prepare('SELECT * FROM behavior_types WHERE class_id = ?').all(cls.id);
      const behaviorLogs = db.prepare(`SELECT bl.* FROM behavior_logs bl JOIN students s ON bl.student_id = s.id WHERE s.class_id = ?`).all(cls.id);
      const attendanceSessions = db.prepare('SELECT * FROM attendance_sessions WHERE class_id = ?').all(cls.id).map((sess) => ({
        ...sess,
        records: db.prepare('SELECT * FROM attendance_records WHERE session_id = ?').all(sess.id),
      }));
      return { ...cls, students, categories, behaviorTypes, behaviorLogs, attendanceSessions };
    }),
    schemes: db.prepare('SELECT * FROM grading_schemes WHERE teacher_id = ?').all(teacherId).map((s) => ({
      ...s,
      categories: db.prepare('SELECT * FROM grading_scheme_categories WHERE scheme_id = ?').all(s.id),
    })),
    behaviorTemplates: db.prepare('SELECT * FROM behavior_type_templates WHERE teacher_id = ?').all(teacherId),
    commentTemplates: db.prepare('SELECT * FROM comment_templates WHERE teacher_id = ?').all(teacherId),
    gradeRecommendationRules: db.prepare('SELECT * FROM grade_recommendation_rules WHERE teacher_id = ?').all(teacherId),
  };

  res.json(data);
});

// POST /api/backup/import  (body = the JSON produced by /export)
// Restores rows that don't already exist (matched by id) — importing the same backup twice is
// safe and won't duplicate anything. Existing data is never overwritten or deleted, only added to.
router.post('/import', (req, res) => {
  const backup = req.body;
  if (isSchoolManagerAccount(req.teacherId)) return res.status(403).json({ error: 'النسخ الاحتياطي متاح للصفوف الشخصية فقط', code: 'PERSONAL_BACKUP_ONLY' });
  if (!backup || !Array.isArray(backup.classes)) {
    return res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح' });
  }

  const teacherId = req.teacherId;
  const schoolClasses = (backup.classes || []).filter((cls) => cls.school_id);
  if (schoolClasses.length > 0) return res.status(400).json({ error: 'لا يمكن استيراد صفوف مدرسية إلى النسخة الشخصية', code: 'SCHOOL_CLASSES_NOT_IN_PERSONAL_BACKUP' });
  const counts = { classes: 0, students: 0, grades: 0, behaviorLogs: 0, attendanceRecords: 0 };
  const activeLimit = getActiveStudentLimit(teacherId);
  if (activeLimit) {
    const existingIds = new Set(db.prepare(`SELECT s.id FROM students s JOIN classes c ON c.id = s.class_id WHERE c.teacher_id = ? AND c.school_id IS NULL
`).all(teacherId).map((row) => row.id));
    const backupClassIds = new Set((backup.classes || []).filter((cls) => Number(cls.archived) !== 1).map((cls) => cls.id));
    const incomingActiveStudents = (backup.classes || []).reduce((total, cls) => {
      if (!backupClassIds.has(cls.id)) return total;
      return total + (cls.students || []).filter((student) => Number(student.archived) !== 1 && !existingIds.has(student.id)).length;
    }, 0);
    const currentStudentCount = getStudentCount(teacherId);
    if (currentStudentCount + incomingActiveStudents > activeLimit.includedStudents) {
      return res.status(409).json({
        error: 'استيراد النسخة الاحتياطية سيتجاوز حد الطلاب في الباقة النشطة.',
        code: 'STUDENT_LIMIT_REACHED',
        current_count: currentStudentCount,
        included_students: activeLimit.includedStudents,
        requested_students: incomingActiveStudents,
        remaining: Math.max(0, activeLimit.includedStudents - currentStudentCount),
        plan: activeLimit.plan,
      });
    }
  }

  const restore = db.transaction(() => {
    (backup.classes || []).forEach((cls) => {
      if (insertIfMissing('classes', { ...cls, teacher_id: teacherId })) counts.classes++;
      (cls.students || []).forEach((s) => { if (insertIfMissing('students', s)) counts.students++; });
      (cls.categories || []).forEach((cat) => {
        insertIfMissing('grade_categories', cat);
        (cat.assessments || []).forEach((a) => {
          insertIfMissing('assessments', a);
          (a.grades || []).forEach((g) => { if (insertIfMissing('grades', g)) counts.grades++; });
        });
      });
      (cls.behaviorTypes || []).forEach((bt) => insertIfMissing('behavior_types', bt));
      (cls.behaviorLogs || []).forEach((bl) => { if (insertIfMissing('behavior_logs', bl)) counts.behaviorLogs++; });
      (cls.attendanceSessions || []).forEach((sess) => {
        insertIfMissing('attendance_sessions', sess);
        (sess.records || []).forEach((r) => { if (insertIfMissing('attendance_records', r)) counts.attendanceRecords++; });
      });
    });

    (backup.schemes || []).forEach((s) => {
      if (insertIfMissing('grading_schemes', { ...s, teacher_id: teacherId })) {
        (s.categories || []).forEach((c) => insertIfMissing('grading_scheme_categories', c));
      }
    });
    (backup.behaviorTemplates || []).forEach((t) => insertIfMissing('behavior_type_templates', { ...t, teacher_id: teacherId }));
    (backup.commentTemplates || []).forEach((t) => insertIfMissing('comment_templates', { ...t, teacher_id: teacherId }));
    (backup.gradeRecommendationRules || []).forEach((r) => insertIfMissing('grade_recommendation_rules', { ...r, teacher_id: teacherId }));
  });

  try {
    restore();
  } catch (err) {
    return res.status(400).json({ error: 'تعذّرت استعادة الملف. تأكد أنه ملف نسخة احتياطية صادر من هذا التطبيق.' });
  }

  res.json({ success: true, counts });
});

module.exports = router;
