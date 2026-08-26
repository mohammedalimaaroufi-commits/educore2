const db = require('../db');

function getTeacherAccount(teacherId) {
  return db.prepare('SELECT id, email, full_name, subject, account_role FROM teachers WHERE id = ?').get(teacherId) || null;
}

function getSchoolMembership(schoolId, teacherId) {
  return db.prepare(`SELECT sm.*, s.name AS school_name
                     FROM school_memberships sm
                     JOIN schools s ON s.id = sm.school_id
                     WHERE sm.school_id = ? AND sm.teacher_id = ? AND sm.status = 'active' AND s.status = 'active'`).get(schoolId, teacherId) || null;
}

function isSchoolManagerAccount(teacherId) {
  return getTeacherAccount(teacherId)?.account_role === 'school_manager';
}

function canSchoolManagerManageSchool(schoolId, teacherId) {
  if (!isSchoolManagerAccount(teacherId)) return false;
  return getSchoolMembership(schoolId, teacherId)?.role === 'school_admin';
}

function canSchoolManagerReadClass(classId, teacherId) {
  const classData = db.prepare('SELECT id, school_id FROM classes WHERE id = ? AND archived = 0').get(classId);
  if (!classData?.school_id) return false;
  const membership = getSchoolMembership(classData.school_id, teacherId);
  return Boolean(membership && membership.role === 'school_admin' && isSchoolManagerAccount(teacherId));
}

function canTeacherOperateClass(classId, teacherId) {
  const classData = db.prepare('SELECT id, teacher_id, school_id, archived FROM classes WHERE id = ?').get(classId);
  if (!classData || Number(classData.archived) === 1) return false;
  if (!classData.school_id) return classData.teacher_id === teacherId;
  return Boolean(db.prepare(`SELECT 1 FROM school_class_assignments
                             WHERE class_id = ? AND school_id = ? AND teacher_id = ? AND status = 'active'
                             LIMIT 1`).get(classId, classData.school_id, teacherId));
}

function getOperableClass(classId, teacherId) {
  if (!canTeacherOperateClass(classId, teacherId)) return null;
  return db.prepare('SELECT * FROM classes WHERE id = ? AND archived = 0').get(classId) || null;
}

function getReadableSchoolClass(classId, teacherId) {
  if (!canSchoolManagerReadClass(classId, teacherId) && !canTeacherOperateClass(classId, teacherId)) return null;
  return db.prepare('SELECT * FROM classes WHERE id = ? AND school_id IS NOT NULL AND archived = 0').get(classId) || null;
}

function listAssignedSchoolClassIds(teacherId) {
  return db.prepare(`SELECT c.id
                     FROM classes c
                     JOIN school_class_assignments a ON a.class_id = c.id AND a.status = 'active' AND a.teacher_id = ?
                     WHERE c.school_id IS NOT NULL AND c.archived = 0`).all(teacherId).map((row) => row.id);
}

module.exports = {
  getTeacherAccount,
  getSchoolMembership,
  isSchoolManagerAccount,
  canSchoolManagerManageSchool,
  canSchoolManagerReadClass,
  canTeacherOperateClass,
  getOperableClass,
  getReadableSchoolClass,
  listAssignedSchoolClassIds,
};
