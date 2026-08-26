const express = require('express');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { canSchoolManagerManageSchool, canTeacherOperateClass, getSchoolMembership, isSchoolManagerAccount } = require('../utils/schoolAccess');

const router = express.Router();
router.use(requireAuth);

function clean(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function normalizeSubject(value) {
  return String(value || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '').trim().toLocaleLowerCase('en-US').replace(/^ال/u, '').replace(/\s+/g, ' ');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function getSchool(schoolId) {
  return db.prepare('SELECT * FROM schools WHERE id = ? AND status = \'active\'').get(schoolId);
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

function schoolSummary(schoolId, teacherId) {
  const school = getSchool(schoolId);
  if (!school) return null;
  const membership = getMembership(schoolId, teacherId);
  if (!membership) return null;
  const managerView = membership.role === 'school_admin' && isSchoolManagerAccount(teacherId);
  const members = managerView
    ? db.prepare(`
        SELECT sm.id, sm.teacher_id, sm.role, sm.status, sm.created_at, t.full_name, t.email, t.subject
        FROM school_memberships sm JOIN teachers t ON t.id = sm.teacher_id
        WHERE sm.school_id = ? AND sm.status = 'active'
        ORDER BY CASE WHEN sm.role = 'school_admin' THEN 0 ELSE 1 END, t.full_name COLLATE NOCASE
      `).all(schoolId)
    : db.prepare(`
        SELECT sm.id, sm.teacher_id, sm.role, sm.status, sm.created_at, t.full_name, t.email, t.subject
        FROM school_memberships sm JOIN teachers t ON t.id = sm.teacher_id
        WHERE sm.school_id = ? AND sm.teacher_id = ? AND sm.status = 'active'
      `).all(schoolId, teacherId);
  const classSelect = `
    SELECT c.*, a.id AS assignment_id, a.teacher_id AS assigned_teacher_id, at.full_name AS assigned_teacher_name,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.archived = 0) AS student_count,
      (SELECT COUNT(*) FROM grade_categories gc WHERE gc.class_id = c.id) AS category_count,
      (SELECT COUNT(*) FROM behavior_logs bl JOIN students s ON s.id = bl.student_id WHERE s.class_id = c.id) AS behavior_count,
      (SELECT COUNT(*) FROM attendance_sessions ats WHERE ats.class_id = c.id) AS attendance_session_count,
      (SELECT COUNT(*) FROM school_class_assignments aa WHERE aa.class_id = c.id AND aa.status = 'active') AS active_assignment_count
    FROM classes c
    LEFT JOIN school_class_assignments a ON a.class_id = c.id AND a.status = 'active'
    LEFT JOIN teachers at ON at.id = a.teacher_id
    WHERE c.school_id = ? AND c.archived = 0
  `;
  const classes = managerView
    ? db.prepare(`${classSelect} ORDER BY c.sort_order ASC, c.created_at DESC, c.id DESC`).all(schoolId)
    : db.prepare(`${classSelect} AND a.teacher_id = ? ORDER BY c.sort_order ASC, c.created_at DESC, c.id DESC`).all(schoolId, teacherId);
  return {
    school: {
      ...school,
      member_count: members.length,
      class_count: classes.length,
    },
    membership,
    members,
    classes,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, sm.role, sm.status AS membership_status,
      (SELECT COUNT(*) FROM school_memberships members WHERE members.school_id = s.id AND members.status = 'active') AS member_count,
      (SELECT COUNT(*) FROM classes c WHERE c.school_id = s.id AND c.archived = 0) AS class_count
    FROM schools s JOIN school_memberships sm ON sm.school_id = s.id
    WHERE sm.teacher_id = ? AND sm.status = 'active' AND s.status = 'active'
    ORDER BY datetime(s.created_at) DESC, s.id DESC
  `).all(req.teacherId);
  res.json({ schools: rows });
});

router.post('/', (req, res) => {
  // Schools and school-manager identities are provisioned by the global platform admin.
  // Existing teacher accounts must never self-promote into a school-management role.
  if (!isSchoolManagerAccount(req.teacherId)) return res.status(403).json({ error: 'يتم إنشاء المدارس ومديريها من لوحة المسؤول العام فقط', code: 'SCHOOL_PROVISIONING_ADMIN_ONLY' });
  return res.status(403).json({ error: 'أنشأ المسؤول العام المدرسة لهذا الحساب مسبقًا', code: 'SCHOOL_PROVISIONING_ADMIN_ONLY' });
});

router.get('/:schoolId', (req, res) => {
  const summary = schoolSummary(req.params.schoolId, req.teacherId);
  if (!summary) return res.status(404).json({ error: 'المدرسة غير موجودة أو لا تملك صلاحية الوصول', code: 'SCHOOL_NOT_FOUND' });
  res.json(summary);
});

router.get('/:schoolId/members', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const members = db.prepare(`
    SELECT sm.id, sm.teacher_id, sm.role, sm.status, sm.created_at, t.full_name, t.email, t.subject, t.school_stage
    FROM school_memberships sm JOIN teachers t ON t.id = sm.teacher_id
    WHERE sm.school_id = ? AND sm.status = 'active'
    ORDER BY CASE WHEN sm.role = 'school_admin' THEN 0 ELSE 1 END, t.full_name COLLATE NOCASE
  `).all(req.params.schoolId);
  res.json({ members });
});

router.post('/:schoolId/classes', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const school = getSchool(req.params.schoolId);
  const name = clean(req.body?.name, 120);
    const subject = clean(req.body?.subject, 160);

  const academicYear = clean(req.body?.academic_year, 40);
  const color = clean(req.body?.color, 20) || '#2E7D6B';
  if (name.length < 2) return res.status(400).json({ error: 'اسم الصف مطلوب', code: 'INVALID_CLASS_NAME' });
  if (!normalizeSubject(subject)) return res.status(400).json({ error: 'مادة الصف مطلوبة للإسناد', code: 'CLASS_SUBJECT_REQUIRED' });
  const classId = clean(req.body?.id, 100) || uuid();
  const existing = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
  if (existing) return res.status(409).json({ error: 'معرّف الصف مستخدم مسبقًا', code: 'CLASS_ID_EXISTS' });
  const nextOrder = Number(db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM classes WHERE school_id = ? AND archived = 0').get(req.params.schoolId)?.next_order || 0);
  db.prepare(`INSERT INTO classes (id, teacher_id, school_id, name, subject, academic_year, color, icon, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'book', ?)`).run(classId, req.teacherId, school.id, name, subject, academicYear || null, color, nextOrder);
  const behaviorDefaults = [
    ['مشاركة متميزة', 'positive', 2, 'star'], ['إحضار الأدوات', 'positive', 1, 'check'],
    ['تأخر عن الحصة', 'negative', -1, 'clock'], ['إزعاج الصف', 'negative', -2, 'alert'],
  ];
  const insertBehavior = db.prepare('INSERT INTO behavior_types (id, class_id, label, polarity, points, icon, is_default) VALUES (?, ?, ?, ?, ?, ?, 1)');
  behaviorDefaults.forEach(([label, polarity, points, icon]) => insertBehavior.run(uuid(), classId, label, polarity, points, icon));
  const categories = [
    ['مشاركة', 10], ['واجبات منزلية', 15], ['اختبارات قصيرة', 20], ['مشروع', 15], ['اختبار نهائي', 40],
  ];
  const insertCategory = db.prepare('INSERT INTO grade_categories (id, class_id, name, weight_percent, grading_type, grading_mode, sort_order) VALUES (?, ?, ?, ?, \'numeric\', \'direct\', ?)');
  const insertAssessment = db.prepare('INSERT INTO assessments (id, category_id, title, max_score, is_summary) VALUES (?, ?, ?, ?, 1)');
  categories.forEach(([label, weight], index) => { const categoryId = uuid(); insertCategory.run(categoryId, classId, label, weight, index); insertAssessment.run(uuid(), categoryId, label, weight); });
  const created = db.prepare(`SELECT c.*, NULL AS assigned_teacher_id, NULL AS assigned_teacher_name,
                                     0 AS student_count, 0 AS category_count, 0 AS behavior_count, 0 AS attendance_session_count, 0 AS active_assignment_count
                              FROM classes c WHERE c.id = ?`).get(classId);
  res.status(201).json({ class: created });
});

router.post('/:schoolId/classes/:classId/assignment-code', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const classData = db.prepare('SELECT * FROM classes WHERE id = ? AND school_id = ? AND archived = 0').get(req.params.classId, req.params.schoolId);
  if (!classData) return res.status(404).json({ error: 'الصف غير موجود في هذه المدرسة', code: 'SCHOOL_CLASS_NOT_FOUND' });
  // One active assignment per school class means the code is deliberately single-use.
  // Keeping this invariant explicit prevents a max_uses value from implying multi-teacher assignment.
  const maxUses = 1;
  const expiresDays = Math.min(Math.max(Number.parseInt(req.body?.expires_days, 10) || 7, 1), 30);
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE school_assignment_codes SET status = 'revoked', updated_at = datetime('now') WHERE class_id = ? AND status = 'active'").run(classData.id);
  let code;
  let codeHash;
  do {
    code = `EDU-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    codeHash = hashCode(code);
  } while (db.prepare('SELECT id FROM school_assignment_codes WHERE code_hash = ?').get(codeHash));
  const id = uuid();
  db.prepare(`INSERT INTO school_assignment_codes (id, school_id, class_id, created_by, code_hash, code_hint, status, max_uses, use_count, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?)`).run(id, classData.school_id, classData.id, req.teacherId, codeHash, code.slice(-4), maxUses, expiresAt);
  res.status(201).json({ code, code_hint: code.slice(-4), expires_at: expiresAt, max_uses: maxUses, class: classData });
});

router.post('/accept-assignment', (req, res) => {
  const code = clean(req.body?.code, 40).replace(/\s+/g, '').toUpperCase();
  if (!code) return res.status(400).json({ error: 'أدخل كود إسناد الصف', code: 'ASSIGNMENT_CODE_REQUIRED' });
  const assignmentCode = db.prepare(`
    SELECT ac.*, c.name AS class_name, c.subject AS class_subject, c.teacher_id AS current_teacher_id, c.archived AS class_archived, s.name AS school_name
    FROM school_assignment_codes ac JOIN classes c ON c.id = ac.class_id JOIN schools s ON s.id = ac.school_id
    WHERE ac.code_hash = ? AND ac.status = 'active' AND c.archived = 0
      AND datetime(ac.expires_at) > datetime('now') AND ac.use_count < ac.max_uses
  `).get(hashCode(code));
  if (!assignmentCode) return res.status(404).json({ error: 'الكود غير صالح أو منتهي الصلاحية أو استُخدم بالكامل', code: 'ASSIGNMENT_CODE_INVALID' });
  const teacher = db.prepare('SELECT id, subject FROM teachers WHERE id = ?').get(req.teacherId);
  if (!normalizeSubject(teacher?.subject)) return res.status(409).json({ error: 'أكمل مادة المعلم من الإعدادات قبل قبول الإسناد', code: 'TEACHER_SUBJECT_REQUIRED' });
  if (normalizeSubject(teacher.subject) !== normalizeSubject(assignmentCode.class_subject)) {
    return res.status(409).json({ error: 'مادة الصف لا تطابق مادة المعلم في الحساب', code: 'ASSIGNMENT_SUBJECT_MISMATCH' });
  }
  const existingAssignment = db.prepare("SELECT * FROM school_class_assignments WHERE class_id = ? AND status = 'active'").get(assignmentCode.class_id);
  if (existingAssignment && existingAssignment.teacher_id !== req.teacherId) return res.status(409).json({ error: 'هذا الصف مسند حاليًا إلى معلم آخر', code: 'CLASS_ALREADY_ASSIGNED' });
  if (existingAssignment && existingAssignment.teacher_id === req.teacherId) return res.json({ reused: true, school: schoolSummary(assignmentCode.school_id, req.teacherId), assignment: existingAssignment });

  try {
    const accept = db.transaction(() => {
      const consumed = db.prepare(`UPDATE school_assignment_codes
        SET use_count = use_count + 1,
            status = CASE WHEN use_count + 1 >= max_uses THEN 'consumed' ELSE status END,
            updated_at = datetime('now')
        WHERE id = ? AND status = 'active' AND use_count < max_uses AND datetime(expires_at) > datetime('now')`).run(assignmentCode.id);
      if (consumed.changes !== 1) {
        const invalid = new Error('ASSIGNMENT_CODE_INVALID');
        invalid.code = 'ASSIGNMENT_CODE_INVALID';
        throw invalid;
      }
      db.prepare("INSERT OR IGNORE INTO school_memberships (id, school_id, teacher_id, role, status, created_by) VALUES (?, ?, ?, 'teacher', 'active', ?)").run(uuid(), assignmentCode.school_id, req.teacherId, req.teacherId);
      const assignmentId = uuid();
      db.prepare(`INSERT INTO school_class_assignments (id, school_id, class_id, teacher_id, assigned_by, code_id, status)
                  VALUES (?, ?, ?, ?, ?, ?, 'active')`).run(assignmentId, assignmentCode.school_id, assignmentCode.class_id, req.teacherId, assignmentCode.created_by, assignmentCode.id);
      return db.prepare('SELECT * FROM school_class_assignments WHERE id = ?').get(assignmentId);
    });
    const assignment = accept();
    res.json({ success: true, school: schoolSummary(assignmentCode.school_id, req.teacherId), assignment });
  } catch (error) {
    if (error?.code === 'ASSIGNMENT_CODE_INVALID') return res.status(404).json({ error: 'الكود غير صالح أو منتهي الصلاحية أو استُخدم بالكامل', code: 'ASSIGNMENT_CODE_INVALID' });
    if (String(error?.message || '').includes('idx_school_one_active_assignment') || error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'هذا الصف مسند حاليًا إلى معلم آخر', code: 'CLASS_ALREADY_ASSIGNED' });
    throw error;
  }
});

router.get('/:schoolId/classes/:classId/overview', (req, res) => {
  const membership = getMembership(req.params.schoolId, req.teacherId);
  if (!membership) return res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى بيانات المدرسة', code: 'SCHOOL_ACCESS_DENIED' });
  const classData = db.prepare('SELECT * FROM classes WHERE id = ? AND school_id = ? AND archived = 0').get(req.params.classId, req.params.schoolId);
  if (!classData) return res.status(404).json({ error: 'الصف غير موجود', code: 'SCHOOL_CLASS_NOT_FOUND' });
  const canRead = (membership.role === 'school_admin' && isSchoolManagerAccount(req.teacherId)) || canTeacherOperateClass(classData.id, req.teacherId);
  if (!canRead) return res.status(403).json({ error: 'لا تملك إسنادًا نشطًا لهذا الصف', code: 'SCHOOL_CLASS_ACCESS_DENIED' });
  const studentCount = Number(db.prepare('SELECT COUNT(*) AS count FROM students WHERE class_id = ? AND archived = 0').get(classData.id)?.count || 0);
  const gradeCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM grades g JOIN students s ON s.id = g.student_id WHERE s.class_id = ? AND s.archived = 0 AND (g.score_numeric IS NOT NULL OR g.score_letter IS NOT NULL)`).get(classData.id)?.count || 0);
  const categoryCount = Number(db.prepare('SELECT COUNT(*) AS count FROM grade_categories WHERE class_id = ?').get(classData.id)?.count || 0);
  const behaviorCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM behavior_logs bl JOIN students s ON s.id = bl.student_id WHERE s.class_id = ? AND s.archived = 0`).get(classData.id)?.count || 0);
  const attendanceCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM attendance_records ar JOIN attendance_sessions ats ON ats.id = ar.session_id WHERE ats.class_id = ?`).get(classData.id)?.count || 0);
  const studentsNeedingAttention = db.prepare(`
    SELECT s.id, s.full_name, COALESCE(SUM(bt.points), 0) AS behavior_points
    FROM students s LEFT JOIN behavior_logs bl ON bl.student_id = s.id LEFT JOIN behavior_types bt ON bt.id = bl.behavior_type_id
    WHERE s.class_id = ? AND s.archived = 0 GROUP BY s.id ORDER BY behavior_points ASC, s.full_name COLLATE NOCASE LIMIT 10
  `).all(classData.id);
  res.json({
    class: classData,
    assigned_teacher: db.prepare(`SELECT t.id, t.full_name, t.email, t.subject
                                  FROM school_class_assignments a JOIN teachers t ON t.id = a.teacher_id
                                  WHERE a.class_id = ? AND a.status = 'active'`).get(classData.id) || null,
    metrics: { student_count: studentCount, category_count: categoryCount, grade_entries: gradeCount, behavior_entries: behaviorCount, attendance_entries: attendanceCount },
    students_needing_attention: studentsNeedingAttention,
  });
});

router.delete('/:schoolId/assignments/:assignmentId', (req, res) => {
  if (!requireManager(req.params.schoolId, req.teacherId, res)) return;
  const assignment = db.prepare("SELECT * FROM school_class_assignments WHERE id = ? AND school_id = ? AND status = 'active'").get(req.params.assignmentId, req.params.schoolId);
  if (!assignment) return res.status(404).json({ error: 'الإسناد غير موجود', code: 'ASSIGNMENT_NOT_FOUND' });
  db.prepare("UPDATE school_class_assignments SET status = 'revoked', revoked_at = datetime('now') WHERE id = ?").run(assignment.id);
  res.json({ success: true, assignment_id: assignment.id });
});

module.exports = router;
