const db = require('../db');

function getTeacherAccount(teacherId) {
  return db.prepare('SELECT id, email, full_name, subject, account_role FROM teachers WHERE id = ?').get(teacherId) || null;
}

function getSchoolMembership(schoolId, teacherId) {
  return db.prepare(`SELECT sm.*, s.name AS school_name
                     FROM school_memberships sm
                     JOIN schools s ON s.id = sm.school_id
                     WHERE sm.school_id = ? AND sm.teacher_id = ?
                       AND sm.status = 'active' AND s.status = 'active'`).get(schoolId, teacherId) || null;
}

function isSchoolManagerAccount(teacherId) {
  return getTeacherAccount(teacherId)?.account_role === 'school_manager';
}

function canSchoolManagerManageSchool(schoolId, teacherId) {
  if (!isSchoolManagerAccount(teacherId)) return false;
  return getSchoolMembership(schoolId, teacherId)?.role === 'school_admin';
}

function getSchoolClass(classId) {
  return db.prepare('SELECT * FROM classes WHERE id = ? AND school_id IS NOT NULL AND archived = 0').get(classId) || null;
}

function canSchoolManagerReadClass(classId, teacherId) {
  const classData = getSchoolClass(classId);
  if (!classData) return false;
  const membership = getSchoolMembership(classData.school_id, teacherId);
  return Boolean(membership && membership.role === 'school_admin' && isSchoolManagerAccount(teacherId));
}

function getActiveClassSubject(classId, subjectKey) {
  return db.prepare(`SELECT * FROM school_class_subjects
                     WHERE class_id = ? AND subject_key = ? AND status = 'active'`).get(classId, subjectKey) || null;
}

function getTeacherClassAssignments(classId, teacherId) {
  return db.prepare(`SELECT a.*, scs.subject_label AS catalog_subject_label
                     FROM school_class_assignments a
                     LEFT JOIN school_class_subjects scs
                       ON scs.class_id = a.class_id AND scs.subject_key = a.subject_key
                     WHERE a.class_id = ? AND a.teacher_id = ? AND a.status = 'active'`).all(classId, teacherId);
}

function canTeacherOperateClass(classId, teacherId) {
  const classData = db.prepare('SELECT id, teacher_id, school_id, archived FROM classes WHERE id = ?').get(classId);
  if (!classData || Number(classData.archived) === 1) return false;
  if (!classData.school_id) return classData.teacher_id === teacherId;
  return Boolean(db.prepare(`SELECT 1 FROM school_class_assignments
                             WHERE class_id = ? AND teacher_id = ? AND status = 'active'
                             LIMIT 1`).get(classId, teacherId));
}

function canTeacherOperateClassSubject(classId, subjectKey, teacherId) {
  const classData = getSchoolClass(classId);
  if (!classData || !subjectKey) return false;
  return Boolean(db.prepare(`SELECT 1 FROM school_class_assignments
                             WHERE class_id = ? AND subject_key = ? AND teacher_id = ? AND status = 'active'
                             LIMIT 1`).get(classId, subjectKey, teacherId));
}

function getOperableClass(classId, teacherId) {
  if (!canTeacherOperateClass(classId, teacherId)) return null;
  return db.prepare('SELECT * FROM classes WHERE id = ? AND archived = 0').get(classId) || null;
}

function getReadableSchoolClass(classId, teacherId) {
  if (!canSchoolManagerReadClass(classId, teacherId) && !canTeacherOperateClass(classId, teacherId)) return null;
  return getSchoolClass(classId);
}

function listAssignedSchoolClassIds(teacherId) {
  return db.prepare(`SELECT DISTINCT c.id
                     FROM classes c
                     JOIN school_class_assignments a
                       ON a.class_id = c.id AND a.status = 'active' AND a.teacher_id = ?
                     WHERE c.school_id IS NOT NULL AND c.archived = 0`).all(teacherId).map((row) => row.id);
}

function listAssignedSchoolSubjects(classId, teacherId) {
  return db.prepare(`SELECT a.subject_key, COALESCE(a.subject_label, scs.subject_label) AS subject_label,
                            a.id AS assignment_id, a.teacher_id, a.assigned_by, a.accepted_at
                     FROM school_class_assignments a
                     LEFT JOIN school_class_subjects scs
                       ON scs.class_id = a.class_id AND scs.subject_key = a.subject_key
                     WHERE a.class_id = ? AND a.teacher_id = ? AND a.status = 'active'
                     ORDER BY subject_label COLLATE NOCASE`).all(classId, teacherId);
}

module.exports = {
  getTeacherAccount,
  getSchoolMembership,
  isSchoolManagerAccount,
  canSchoolManagerManageSchool,
  getSchoolClass,
  getActiveClassSubject,
  getTeacherClassAssignments,
  canSchoolManagerReadClass,
  canTeacherOperateClass,
  canTeacherOperateClassSubject,
  getOperableClass,
  getReadableSchoolClass,
  listAssignedSchoolClassIds,
  listAssignedSchoolSubjects,
};
