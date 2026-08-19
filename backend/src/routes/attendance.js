const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function assertClassOwnership(classId, teacherId) {
  return db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(classId, teacherId);
}

// GET /api/attendance/session?class_id=...&date=YYYY-MM-DD  -> creates session if missing, returns roster+status
router.get('/session', (req, res) => {
  const { class_id, date } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const sessionDate = date || new Date().toISOString().slice(0, 10);

  let session = db.prepare('SELECT * FROM attendance_sessions WHERE class_id = ? AND session_date = ?').get(class_id, sessionDate);
  if (!session) {
    const id = uuid();
    db.prepare('INSERT INTO attendance_sessions (id, class_id, session_date) VALUES (?, ?, ?)').run(id, class_id, sessionDate);
    session = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(id);
  }

  const roster = db.prepare(`SELECT s.id as student_id, s.full_name, COALESCE(ar.status, 'present') as status
                              FROM students s LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.session_id = ?
                              WHERE s.class_id = ? AND s.archived = 0 ORDER BY s.full_name COLLATE NOCASE`)
    .all(session.id, class_id);

  res.json({ session, roster });
});

// POST /api/attendance/session  { session_id, records: [{student_id, status}] }
router.post('/session', (req, res) => {
  const { session_id, class_id, session_date, records } = req.body;
  let session = session_id
    ? db.prepare(`SELECT ats.* FROM attendance_sessions ats JOIN classes c ON ats.class_id = c.id WHERE ats.id = ? AND c.teacher_id = ?`).get(session_id, req.teacherId)
    : null;
  if (!session && class_id && session_date && assertClassOwnership(class_id, req.teacherId)) {
    const stableId = session_id || uuid();
    db.prepare('INSERT OR IGNORE INTO attendance_sessions (id, class_id, session_date) VALUES (?, ?, ?)').run(stableId, class_id, session_date);
    session = db.prepare('SELECT * FROM attendance_sessions WHERE class_id = ? AND session_date = ?').get(class_id, session_date);
  }
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  const upsert = db.prepare(`INSERT INTO attendance_records (id, session_id, student_id, status) VALUES (?, ?, ?, ?)
                              ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status`);
  const saveAll = db.transaction((items) => { for (const it of items) upsert.run(uuid(), session.id, it.student_id, it.status); });
  saveAll(records || []);
  res.json({ success: true, session });
});

// GET /api/attendance/stats?class_id=...  -> per-student attendance percentage breakdown
router.get('/stats', (req, res) => {
  const { class_id } = req.query;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });

  const rows = db.prepare(`SELECT s.id as student_id, s.full_name,
                              SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END) as present_count,
                              SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) as absent_count,
                              SUM(CASE WHEN ar.status='late' THEN 1 ELSE 0 END) as late_count,
                              SUM(CASE WHEN ar.status='excused' THEN 1 ELSE 0 END) as excused_count,
                              COUNT(ar.id) as total_sessions
                            FROM students s
                            LEFT JOIN attendance_records ar ON ar.student_id = s.id
                            LEFT JOIN attendance_sessions ats ON ar.session_id = ats.id AND ats.class_id = s.class_id
                            WHERE s.class_id = ? AND s.archived = 0
                            GROUP BY s.id ORDER BY s.full_name COLLATE NOCASE`).all(class_id);

  res.json({ stats: rows });
});

// GET /api/attendance/student/:id  -> full attendance history + totals for one student (used in analytics detail view)
router.get('/student/:id', (req, res) => {
  const student = db.prepare('SELECT s.* FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ? AND c.teacher_id = ?').get(req.params.id, req.teacherId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });

  const records = db.prepare(`SELECT ats.session_date, ar.status FROM attendance_records ar
                               JOIN attendance_sessions ats ON ar.session_id = ats.id
                               WHERE ar.student_id = ? ORDER BY ats.session_date DESC`).all(req.params.id);

  const totals = records.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, { present: 0, absent: 0, late: 0, excused: 0 });
  const total = records.length;
  const rate = total > 0 ? Number(((totals.present / total) * 100).toFixed(1)) : null;

  res.json({ records, totals, rate, total });
});

module.exports = router;
