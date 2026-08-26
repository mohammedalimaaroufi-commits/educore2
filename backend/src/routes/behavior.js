const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/restrictions');
const { canTeacherOperateClass, canTeacherOperateClassSubject } = require('../utils/schoolAccess');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('behavior'));

function isSchoolClass(classId) {
  return Boolean(db.prepare('SELECT id FROM classes WHERE id = ? AND school_id IS NOT NULL').get(classId));
}

function visibleSubjectKeys(classId, teacherId) {
  return db.prepare("SELECT subject_key FROM school_class_assignments WHERE class_id = ? AND teacher_id = ? AND status = 'active'").all(classId, teacherId).map((item) => item.subject_key).filter(Boolean);
}

function canTeacherUseType(type, teacherId) {
  if (!type || !canTeacherOperateClass(type.class_id, teacherId)) return false;
  return !isSchoolClass(type.class_id) || !type.subject_key || canTeacherOperateClassSubject(type.class_id, type.subject_key, teacherId);
}

function requirePersonalBehaviorCatalog(classId, teacherId, res) {
  if (!canTeacherOperateClass(classId, teacherId)) { res.status(404).json({ error: 'الصف غير موجود' }); return null; }
  if (isSchoolClass(classId)) { res.status(403).json({ error: 'قاموس السلوك المدرسي تديره الإدارة، ويمكن للمعلم تسجيل السلوك فقط', code: 'SCHOOL_CLASS_STRUCTURE_LOCKED' }); return null; }
  return true;
}

// GET /api/behavior/types?class_id=...
router.get('/types', (req, res) => {
  const { class_id } = req.query;
  if (!canTeacherOperateClass(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const keys = visibleSubjectKeys(class_id, req.teacherId);
  const allTypes = db.prepare('SELECT * FROM behavior_types WHERE class_id = ? ORDER BY is_default DESC, label').all(class_id);
  const types = isSchoolClass(class_id) ? allTypes.filter((type) => !type.subject_key || keys.includes(type.subject_key)) : allTypes;
  res.json({ types });
});

// POST /api/behavior/types  (custom behavior)
router.post('/types', (req, res) => {
  const { id: requestedId, class_id, label, polarity, points, icon } = req.body;
  if (!requirePersonalBehaviorCatalog(class_id, req.teacherId, res)) return;
  if (!label) return res.status(400).json({ error: 'اسم السلوك مطلوب' });
  const id = requestedId || uuid();
  const existing = db.prepare('SELECT bt.* FROM behavior_types bt WHERE bt.id = ?').get(id);
  if (existing && !canTeacherUseType(existing, req.teacherId)) return res.status(404).json({ error: 'نوع السلوك غير موجود' });
  if (existing) return res.json({ type: existing, reused: true });
  db.prepare(`INSERT INTO behavior_types (id, class_id, label, polarity, points, icon, is_default)
              VALUES (?, ?, ?, ?, ?, ?, 0)`)
    .run(id, class_id, label, polarity || 'positive', points ?? (polarity === 'negative' ? -1 : 1), icon || 'star');
  res.status(201).json({ type: db.prepare('SELECT * FROM behavior_types WHERE id = ?').get(id) });
});

function getOwnedType(id, teacherId) {
  const type = db.prepare('SELECT bt.* FROM behavior_types bt WHERE bt.id = ?').get(id);
  return canTeacherUseType(type, teacherId) ? type : null;
}

// PATCH /api/behavior/types/:id  -> edit a custom type owned by the teacher
router.patch('/types/:id', (req, res) => {
  const type = getOwnedType(req.params.id, req.teacherId);
  if (!type) return res.status(404).json({ error: 'نوع السلوك غير موجود' });
  if (!requirePersonalBehaviorCatalog(type.class_id, req.teacherId, res)) return;
  if (Number(type.is_default)) return res.status(400).json({ error: 'الأنواع الافتراضية لا يمكن تعديلها من دفتر الصف' });
  const label = req.body.label === undefined ? type.label : String(req.body.label || '').trim();
  const polarity = req.body.polarity === undefined ? type.polarity : (req.body.polarity === 'negative' ? 'negative' : 'positive');
  const points = req.body.points === undefined ? Math.abs(Number(type.points || 1)) : Math.abs(Number(req.body.points || 0));
  const icon = req.body.icon === undefined ? type.icon : String(req.body.icon || 'star');
  if (!label) return res.status(400).json({ error: 'اسم السلوك مطلوب' });
  if (!Number.isFinite(points) || points <= 0) return res.status(400).json({ error: 'نقاط السلوك يجب أن تكون أكبر من صفر' });
  db.prepare('UPDATE behavior_types SET label = ?, polarity = ?, points = ?, icon = ? WHERE id = ?')
    .run(label, polarity, polarity === 'negative' ? -points : points, icon, type.id);
  res.json({ type: db.prepare('SELECT * FROM behavior_types WHERE id = ?').get(type.id) });
});

// DELETE /api/behavior/types/:id  -> remove a custom type only when it has no historical logs
router.delete('/types/:id', (req, res) => {
  const type = getOwnedType(req.params.id, req.teacherId);
  if (!type) return res.status(404).json({ error: 'نوع السلوك غير موجود' });
  if (!requirePersonalBehaviorCatalog(type.class_id, req.teacherId, res)) return;
  if (Number(type.is_default)) return res.status(400).json({ error: 'الأنواع الافتراضية لا يمكن حذفها من دفتر الصف' });
  const logs = db.prepare('SELECT COUNT(*) AS count FROM behavior_logs WHERE behavior_type_id = ?').get(type.id).count;
  if (Number(logs) > 0) return res.status(409).json({ error: 'لا يمكن حذف سلوك مرتبط بسجلات طلاب. يمكنك تعديل اسمه أو تركه محفوظًا للتاريخ.', log_count: Number(logs) });
  db.prepare('DELETE FROM behavior_types WHERE id = ?').run(type.id);
  res.json({ success: true });
});

// POST /api/behavior/log  (one-tap log, optional note text/audio)
router.post('/log', (req, res) => {
  const { id: requestedId, student_id, behavior_type_id, note_text, note_audio_url } = req.body;
  const student = db.prepare('SELECT s.* FROM students s WHERE s.id = ?').get(student_id);
  if (!student || !canTeacherOperateClass(student.class_id, req.teacherId)) return res.status(404).json({ error: 'الطالب غير موجود' });
  const behaviorType = getOwnedType(behavior_type_id, req.teacherId);
  if (!behaviorType || behaviorType.class_id !== student.class_id) return res.status(404).json({ error: 'نوع السلوك غير موجود في هذا الصف' });
  const id = requestedId || uuid();
  const existing = db.prepare('SELECT bl.* FROM behavior_logs bl JOIN students s ON bl.student_id = s.id WHERE bl.id = ?').get(id);
  if (existing && !canTeacherOperateClass(db.prepare('SELECT class_id FROM students WHERE id = ?').get(existing.student_id)?.class_id, req.teacherId)) return res.status(404).json({ error: 'السجل غير موجود' });
  if (existing) return res.json({ log: existing, reused: true });
  db.prepare(`INSERT INTO behavior_logs (id, student_id, behavior_type_id, subject_key, recorded_by, note_text, note_audio_url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, student_id, behavior_type_id, behaviorType.subject_key || null, req.teacherId, note_text || null, note_audio_url || null);
  res.status(201).json({ log: db.prepare('SELECT * FROM behavior_logs WHERE id = ?').get(id) });
});

// DELETE /api/behavior/log/:id  -> remove one student behavior log only
router.delete('/log/:id', (req, res) => {
  const log = db.prepare(`SELECT bl.* FROM behavior_logs bl
                          JOIN students s ON bl.student_id = s.id
                          WHERE bl.id = ?`).get(req.params.id);
  if (log && (!canTeacherOperateClass(db.prepare('SELECT class_id FROM students WHERE id = ?').get(log.student_id)?.class_id, req.teacherId) || !getOwnedType(log.behavior_type_id, req.teacherId))) return res.status(404).json({ error: 'سجل السلوك غير موجود' });
  if (!log) return res.status(404).json({ error: 'سجل السلوك غير موجود' });
  db.prepare('DELETE FROM behavior_logs WHERE id = ?').run(log.id);
  res.json({ success: true, deleted_log_id: log.id });
});

// GET /api/behavior/log?student_id=...  (full history for a student)
router.get('/log', (req, res) => {
  const { student_id } = req.query;
  const student = db.prepare('SELECT s.* FROM students s WHERE s.id = ?').get(student_id);
  if (!student || !canTeacherOperateClass(student.class_id, req.teacherId)) return res.status(404).json({ error: 'الطالب غير موجود' });
  const keys = visibleSubjectKeys(student.class_id, req.teacherId);
  const subjectFilter = isSchoolClass(student.class_id) && keys.length ? ` AND (bt.subject_key IS NULL OR bt.subject_key IN (${keys.map(() => '?').join(',')}))` : isSchoolClass(student.class_id) ? ' AND 1 = 0' : '';
  const logs = db.prepare(`SELECT bl.*, bt.label, bt.polarity, bt.points, bt.icon FROM behavior_logs bl
                            JOIN behavior_types bt ON bl.behavior_type_id = bt.id
                            WHERE bl.student_id = ?${subjectFilter} ORDER BY bl.occurred_at DESC`).all(student_id, ...(isSchoolClass(student.class_id) ? keys : []));
  const score = logs.reduce((sum, l) => sum + l.points, 0);
  res.json({ logs, score });
});

// GET /api/behavior/class-summary?class_id=...  (behavior score per student, for charts)
router.get('/class-summary', (req, res) => {
  const { class_id } = req.query;
  const owns = canTeacherOperateClass(class_id, req.teacherId)
    ? db.prepare('SELECT id FROM classes WHERE id = ? AND archived = 0').get(class_id)
    : null;
  if (!owns) return res.status(404).json({ error: 'الصف غير موجود' });
  const keys = visibleSubjectKeys(class_id, req.teacherId);
  const subjectFilter = isSchoolClass(class_id) && keys.length ? ` AND (bt.subject_key IS NULL OR bt.subject_key IN (${keys.map(() => '?').join(',')}))` : '';
  const rows = db.prepare(`SELECT s.id as student_id, s.full_name,
                              COALESCE(SUM(bt.points), 0) as behavior_score,
                              SUM(CASE WHEN bt.polarity='positive' THEN 1 ELSE 0 END) as positive_count,
                              SUM(CASE WHEN bt.polarity='negative' THEN 1 ELSE 0 END) as negative_count
                            FROM students s
                            LEFT JOIN behavior_logs bl ON bl.student_id = s.id
                            LEFT JOIN behavior_types bt ON bl.behavior_type_id = bt.id
                            WHERE s.class_id = ? AND s.archived = 0${subjectFilter}
                            GROUP BY s.id ORDER BY s.full_name COLLATE NOCASE`).all(class_id, ...(isSchoolClass(class_id) && keys.length ? keys : []));
  res.json({ summary: rows });
});

module.exports = router;
