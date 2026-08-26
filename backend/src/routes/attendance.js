const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/restrictions');
const { canTeacherOperateClass, canTeacherOperateClassSubject } = require('../utils/schoolAccess');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('attendance'));

function getClass(classId) {
  return db.prepare('SELECT id, school_id, archived FROM classes WHERE id = ?').get(classId) || null;
}

function isSchoolClass(classId) {
  return Boolean(getClass(classId)?.school_id);
}

function normalizePeriod(value) {
  return String(value || 'daily').trim().slice(0, 60) || 'daily';
}

function resolveSchoolSubject(classId, teacherId, requestedSubject) {
  const active = db.prepare("SELECT subject_key, subject_label FROM school_class_assignments WHERE class_id = ? AND teacher_id = ? AND status = 'active' ORDER BY subject_key").all(classId, teacherId);
  if (!active.length) return null;
  const key = String(requestedSubject || '').trim();
  if (key) return active.find((item) => item.subject_key === key) || null;
  return active[0];
}

function assertClassOwnership(classId, teacherId) {
  const classData = getClass(classId);
  return classData && Number(classData.archived) !== 1 && canTeacherOperateClass(classId, teacherId) ? classData : null;
}

function assertSchoolSubject(classId, teacherId, requestedSubject) {
  const subject = resolveSchoolSubject(classId, teacherId, requestedSubject);
  return subject && canTeacherOperateClassSubject(classId, subject.subject_key, teacherId) ? subject : null;
}

function loadSchoolSession(classId, teacherId, sessionId, sessionDate, periodKey, subjectKey, periodLabel = '', startsAt = null) {
  let session = sessionId
    ? db.prepare('SELECT * FROM school_attendance_sessions WHERE id = ? AND class_id = ?').get(sessionId, classId)
    : null;
  if (session && session.subject_key !== subjectKey) session = null;
  if (!session) {
    session = db.prepare('SELECT * FROM school_attendance_sessions WHERE class_id = ? AND subject_key = ? AND session_date = ? AND period_key = ?').get(classId, subjectKey, sessionDate, periodKey);
  }
  if (!session) {
    const id = sessionId || uuid();
    db.prepare(`INSERT OR IGNORE INTO school_attendance_sessions (id, class_id, subject_key, session_date, period_key, period_label, starts_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, classId, subjectKey, sessionDate, periodKey, periodLabel || (periodKey === 'daily' ? 'اليومي' : periodKey), startsAt || null, teacherId);
    session = db.prepare('SELECT * FROM school_attendance_sessions WHERE class_id = ? AND subject_key = ? AND session_date = ? AND period_key = ?').get(classId, subjectKey, sessionDate, periodKey);
  }
  if (session && (periodLabel || startsAt)) {
    db.prepare(`UPDATE school_attendance_sessions SET period_label = COALESCE(?, period_label), starts_at = COALESCE(?, starts_at), recorded_at = datetime('now') WHERE id = ?`).run(periodLabel || null, startsAt || null, session.id);
    session = db.prepare('SELECT * FROM school_attendance_sessions WHERE id = ?').get(session.id);
  }
  return session;
}

function schoolRoster(session, classId) {
  return db.prepare(`SELECT s.id AS student_id, s.full_name,
                            COALESCE(sar.status, 'present') AS status
                     FROM students s
                     LEFT JOIN school_attendance_records sar ON sar.student_id = s.id AND sar.session_id = ?
                     WHERE s.class_id = ? AND s.archived = 0 ORDER BY s.full_name COLLATE NOCASE`).all(session.id, classId);
}

// GET /api/attendance/session?class_id=...&date=YYYY-MM-DD&period_key=...
router.get('/session', (req, res) => {
  const { class_id } = req.query;
  const classData = assertClassOwnership(class_id, req.teacherId);
  if (!classData) return res.status(404).json({ error: 'الصف غير موجود' });
  const sessionDate = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (classData.school_id) {
    const subject = assertSchoolSubject(class_id, req.teacherId, req.query.subject_key);
    if (!subject) return res.status(403).json({ error: 'لا تملك إسناد مادة لهذا الصف', code: 'SCHOOL_SUBJECT_ASSIGNMENT_REQUIRED' });
    const session = loadSchoolSession(class_id, req.teacherId, null, sessionDate, normalizePeriod(req.query.period_key), subject.subject_key, req.query.period_label, req.query.starts_at);
    return res.json({ session, roster: schoolRoster(session, class_id), subject });
  }
  let session = db.prepare('SELECT * FROM attendance_sessions WHERE class_id = ? AND session_date = ?').get(class_id, sessionDate);
  if (!session) {
    const id = uuid();
    db.prepare('INSERT INTO attendance_sessions (id, class_id, session_date) VALUES (?, ?, ?)').run(id, class_id, sessionDate);
    session = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(id);
  }
  const roster = db.prepare(`SELECT s.id AS student_id, s.full_name, COALESCE(ar.status, 'present') AS status
                             FROM students s LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.session_id = ?
                             WHERE s.class_id = ? AND s.archived = 0 ORDER BY s.full_name COLLATE NOCASE`).all(session.id, class_id);
  res.json({ session, roster });
});

// POST /api/attendance/session { session_id, class_id, session_date, subject_key?, period_key?, records }
router.post('/session', (req, res) => {
  const { session_id, class_id, session_date, records } = req.body;
  let classData = class_id ? assertClassOwnership(class_id, req.teacherId) : null;
  let session = null;
  if (session_id) {
    session = db.prepare('SELECT * FROM school_attendance_sessions WHERE id = ?').get(session_id)
      || db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(session_id);
    if (session) classData = assertClassOwnership(session.class_id, req.teacherId);
  }
  if (!classData) return res.status(404).json({ error: 'الجلسة أو الصف غير موجود' });
  const date = String(session_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  let schoolSubject = null;
  if (classData.school_id) {
    schoolSubject = assertSchoolSubject(classData.id, req.teacherId, req.body?.subject_key || session?.subject_key);
    if (!schoolSubject) return res.status(403).json({ error: 'لا تملك إسناد مادة لهذا الصف', code: 'SCHOOL_SUBJECT_ASSIGNMENT_REQUIRED' });
    session = loadSchoolSession(classData.id, req.teacherId, session?.id, date, normalizePeriod(req.body?.period_key || session?.period_key), schoolSubject.subject_key, req.body?.period_label || session?.period_label, req.body?.starts_at || session?.starts_at);
  } else if (!session && class_id && session_date) {
    const stableId = session_id || uuid();
    db.prepare('INSERT OR IGNORE INTO attendance_sessions (id, class_id, session_date) VALUES (?, ?, ?)').run(stableId, class_id, date);
    session = db.prepare('SELECT * FROM attendance_sessions WHERE class_id = ? AND session_date = ?').get(class_id, date);
  }
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  const schoolSession = Boolean(classData.school_id);
  const upsert = schoolSession
    ? db.prepare(`INSERT INTO school_attendance_records (id, session_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?, datetime('now'))
                  ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, recorded_at = datetime('now')`)
    : db.prepare(`INSERT INTO attendance_records (id, session_id, student_id, status) VALUES (?, ?, ?, ?)
                  ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status`);
  const saveAll = db.transaction((items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const student = db.prepare('SELECT id FROM students WHERE id = ? AND class_id = ? AND archived = 0').get(item.student_id, classData.id);
      if (!student) { const error = new Error('الطالب غير موجود في هذا الصف'); error.code = 'STUDENT_NOT_IN_CLASS'; throw error; }
      const status = ['present', 'absent', 'late', 'excused'].includes(item.status) ? item.status : 'present';
      upsert.run(uuid(), session.id, item.student_id, status);
    }
  });
  try { saveAll(records); } catch (error) {
    if (error?.code === 'STUDENT_NOT_IN_CLASS') return res.status(400).json({ error: error.message, code: error.code });
    throw error;
  }
  res.json({ success: true, session, subject: schoolSubject });
});

// GET /api/attendance/stats?class_id=...
router.get('/stats', (req, res) => {
  const { class_id } = req.query;
  const classData = assertClassOwnership(class_id, req.teacherId);
  if (!classData) return res.status(404).json({ error: 'الصف غير موجود' });
  const schoolSubject = classData.school_id ? assertSchoolSubject(class_id, req.teacherId, req.query.subject_key) : null;
  if (classData.school_id && !schoolSubject) return res.status(403).json({ error: 'لا تملك إسناد مادة لهذا الصف', code: 'SCHOOL_SUBJECT_ASSIGNMENT_REQUIRED' });
  const rows = classData.school_id
    ? db.prepare(`SELECT s.id AS student_id, s.full_name,
                        SUM(CASE WHEN sar.status = 'present' THEN 1 ELSE 0 END) AS present_count,
                        SUM(CASE WHEN sar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
                        SUM(CASE WHEN sar.status = 'late' THEN 1 ELSE 0 END) AS late_count,
                        SUM(CASE WHEN sar.status = 'excused' THEN 1 ELSE 0 END) AS excused_count,
                        COUNT(sar.id) AS total_sessions
                 FROM students s LEFT JOIN school_attendance_records sar ON sar.student_id = s.id
                 LEFT JOIN school_attendance_sessions sas ON sar.session_id = sas.id AND sas.class_id = s.class_id AND sas.subject_key = ?
                 WHERE s.class_id = ? AND s.archived = 0 GROUP BY s.id ORDER BY s.full_name COLLATE NOCASE`).all(schoolSubject.subject_key, class_id)
    : db.prepare(`SELECT s.id AS student_id, s.full_name,
                        SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END) AS present_count,
                        SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) AS absent_count,
                        SUM(CASE WHEN ar.status='late' THEN 1 ELSE 0 END) AS late_count,
                        SUM(CASE WHEN ar.status='excused' THEN 1 ELSE 0 END) AS excused_count,
                        COUNT(ar.id) AS total_sessions
                 FROM students s LEFT JOIN attendance_records ar ON ar.student_id = s.id
                 LEFT JOIN attendance_sessions ats ON ar.session_id = ats.id AND ats.class_id = s.class_id
                 WHERE s.class_id = ? AND s.archived = 0 GROUP BY s.id ORDER BY s.full_name COLLATE NOCASE`).all(class_id);
  res.json({ stats: rows, subject: schoolSubject });
});

// GET /api/attendance/student/:id
router.get('/student/:id', (req, res) => {
  const student = db.prepare('SELECT s.* FROM students s WHERE s.id = ?').get(req.params.id);
  if (!student || !assertClassOwnership(student.class_id, req.teacherId)) return res.status(404).json({ error: 'الطالب غير موجود' });
  const classData = getClass(student.class_id);
  const subject = classData.school_id ? assertSchoolSubject(student.class_id, req.teacherId, req.query.subject_key) : null;
  if (classData.school_id && !subject) return res.status(403).json({ error: 'لا تملك إسناد مادة لهذا الصف', code: 'SCHOOL_SUBJECT_ASSIGNMENT_REQUIRED' });
  const records = classData.school_id
    ? db.prepare(`SELECT sas.session_date, sas.period_key, sas.period_label, sas.starts_at, sar.status
                 FROM school_attendance_records sar JOIN school_attendance_sessions sas ON sar.session_id = sas.id
                 WHERE sar.student_id = ? AND sas.subject_key = ? ORDER BY sas.session_date DESC, sas.starts_at DESC`).all(req.params.id, subject.subject_key)
    : db.prepare(`SELECT ats.session_date, 'daily' AS period_key, 'اليومي' AS period_label, NULL AS starts_at, ar.status
                 FROM attendance_records ar JOIN attendance_sessions ats ON ar.session_id = ats.id
                 WHERE ar.student_id = ? ORDER BY ats.session_date DESC`).all(req.params.id);
  const totals = records.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, { present: 0, absent: 0, late: 0, excused: 0 });
  const total = records.length;
  const rate = total > 0 ? Number(((totals.present / total) * 100).toFixed(1)) : null;
  res.json({ records, totals, rate, total, subject });
});

module.exports = router;
