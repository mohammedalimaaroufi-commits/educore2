const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

let lastMessagePurgeAt = 0;
function purgeExpiredMessages() {
  const now = Date.now();
  if (now - lastMessagePurgeAt < 5 * 60 * 1000) return;
  lastMessagePurgeAt = now;
  db.prepare("DELETE FROM messages WHERE datetime(created_at) < datetime('now', '-24 hours')").run();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// One round trip for the teacher-owned data. The local-first client stores this
// snapshot in IndexedDB and uses it for analytics/reports while the network is slow.
router.get('/snapshot', (req, res) => {
  purgeExpiredMessages();
  const row = db.prepare(`
    WITH context AS (SELECT ? AS teacher_id),
    owned_classes AS (
      SELECT c.* FROM classes c, context
      WHERE (c.school_id IS NULL AND c.teacher_id = context.teacher_id)
         OR (c.school_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM school_class_assignments a
           WHERE a.class_id = c.id AND a.teacher_id = context.teacher_id AND a.status = 'active'
         ))
    ),
    owned_subjects AS (
      SELECT scs.* FROM school_class_subjects scs JOIN owned_classes c ON c.id = scs.class_id, context
      WHERE c.school_id IS NULL OR EXISTS (
        SELECT 1 FROM school_class_assignments a
        WHERE a.class_id = scs.class_id AND a.subject_key = scs.subject_key
          AND a.teacher_id = context.teacher_id AND a.status = 'active'
      )
    ),
    owned_assignments AS (
      SELECT a.* FROM school_class_assignments a JOIN owned_classes c ON c.id = a.class_id, context
      WHERE c.school_id IS NULL OR (a.teacher_id = context.teacher_id AND a.status = 'active')
    ),
    owned_students AS (
      SELECT s.* FROM students s JOIN owned_classes c ON c.id = s.class_id
    ),
    owned_categories AS (
      SELECT gc.* FROM grade_categories gc JOIN owned_classes c ON c.id = gc.class_id
      WHERE c.school_id IS NULL OR gc.subject_key IS NULL OR EXISTS (
        SELECT 1 FROM owned_subjects os WHERE os.class_id = gc.class_id AND os.subject_key = gc.subject_key
      )
    ),
    owned_assessments AS (
      SELECT a.* FROM assessments a JOIN owned_categories gc ON gc.id = a.category_id
    ),
    owned_behavior_types AS (
      SELECT bt.* FROM behavior_types bt JOIN owned_classes c ON c.id = bt.class_id
      WHERE c.school_id IS NULL OR bt.subject_key IS NULL OR EXISTS (
        SELECT 1 FROM owned_subjects os WHERE os.class_id = bt.class_id AND os.subject_key = bt.subject_key
      )
    ),
    owned_sessions AS (
      SELECT ats.* FROM attendance_sessions ats JOIN owned_classes c ON c.id = ats.class_id WHERE c.school_id IS NULL
    ),
    owned_school_sessions AS (
      SELECT sas.* FROM school_attendance_sessions sas JOIN owned_classes c ON c.id = sas.class_id
      WHERE c.school_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM owned_subjects os WHERE os.class_id = sas.class_id AND os.subject_key = sas.subject_key
      )
    )
    SELECT
      (SELECT json_object(
        'id', t.id, 'full_name', t.full_name, 'email', t.email,
        'subject', t.subject, 'school_stage', t.school_stage,
        'school_name', t.school_name, 'avatar_url', t.avatar_url, 'locale', t.locale, 'account_role', t.account_role,
        'created_at', t.created_at, 'updated_at', t.updated_at
      ) FROM teachers t, context WHERE t.id = context.teacher_id) AS teacher,
      (SELECT COALESCE(json_group_array(json_object(
        'id', s.id, 'teacher_id', s.teacher_id, 'plan', s.plan, 'status', s.status,
        'trial_start_date', s.trial_start_date, 'trial_end_date', s.trial_end_date,
        'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
        'payment_provider', s.payment_provider, 'payment_reference', s.payment_reference,
        'created_at', s.created_at, 'updated_at', s.updated_at
      )), '[]') FROM subscriptions s, context WHERE s.teacher_id = context.teacher_id) AS subscriptions,
      (SELECT COALESCE(json_group_array(json_object(
        'id', id, 'teacher_id', teacher_id, 'school_id', school_id, 'name', name, 'subject', subject,
        'academic_year', academic_year, 'color', color, 'icon', icon, 'sort_order', sort_order, 'archived', archived,
        'created_at', created_at, 'updated_at', updated_at
      )), '[]') FROM owned_classes) AS classes,
      (SELECT COALESCE(json_group_array(json_object(
        'id', s.id, 'class_id', s.class_id, 'full_name', s.full_name, 'student_number', s.student_number,
        'photo_url', s.photo_url,
        'guardian_name', CASE WHEN c.school_id IS NULL THEN s.guardian_name ELSE NULL END,
        'guardian_phone', CASE WHEN c.school_id IS NULL THEN s.guardian_phone ELSE NULL END,
        'guardian_email', CASE WHEN c.school_id IS NULL THEN s.guardian_email ELSE NULL END,
        'health_notes', CASE WHEN c.school_id IS NULL THEN s.health_notes ELSE NULL END,
        'private_notes', CASE WHEN c.school_id IS NULL THEN s.private_notes ELSE NULL END,
        'archived', s.archived, 'created_at', s.created_at, 'updated_at', s.updated_at
      )), '[]') FROM owned_students s JOIN owned_classes c ON c.id = s.class_id) AS students,
      (SELECT COALESCE(json_group_array(json_object(
        'id', id, 'class_id', class_id, 'subject_key', subject_key, 'name', name, 'weight_percent', weight_percent,
        'grading_type', grading_type, 'grading_mode', grading_mode, 'details_note', details_note,
        'sort_order', sort_order, 'created_at', created_at
      )), '[]') FROM owned_categories) AS grade_categories,
      (SELECT COALESCE(json_group_array(json_object(
        'id', id, 'category_id', category_id, 'title', title, 'max_score', max_score,
        'is_summary', is_summary, 'date', date, 'created_at', created_at
      )), '[]') FROM owned_assessments) AS assessments,
      (SELECT COALESCE(json_group_array(json_object(
        'id', g.id, 'assessment_id', g.assessment_id, 'student_id', g.student_id,
        'score_numeric', g.score_numeric, 'score_letter', g.score_letter,
        'rubric_json', g.rubric_json, 'comment', g.comment, 'updated_at', g.updated_at
      )), '[]') FROM grades g JOIN owned_assessments a ON a.id = g.assessment_id
        JOIN owned_students s ON s.id = g.student_id) AS grades,
      (SELECT COALESCE(json_group_array(json_object(
        'id', id, 'class_id', class_id, 'subject_key', subject_key, 'label', label, 'polarity', polarity,
        'points', points, 'icon', icon, 'is_default', is_default
      )), '[]') FROM owned_behavior_types) AS behavior_types,
      (SELECT COALESCE(json_group_array(json_object(
        'id', bl.id, 'student_id', bl.student_id, 'behavior_type_id', bl.behavior_type_id,
        'subject_key', bl.subject_key, 'recorded_by', bl.recorded_by,
        'note_text', bl.note_text, 'note_audio_url', bl.note_audio_url, 'occurred_at', bl.occurred_at
      )), '[]') FROM behavior_logs bl JOIN owned_students s ON s.id = bl.student_id) AS behavior_logs,
      (SELECT COALESCE(json_group_array(json_object(
        'id', id, 'class_id', class_id, 'session_date', session_date
      )), '[]') FROM owned_sessions) AS attendance_sessions,
      (SELECT COALESCE(json_group_array(json_object(
        'id', ar.id, 'session_id', ar.session_id, 'student_id', ar.student_id, 'status', ar.status
      )), '[]') FROM attendance_records ar JOIN owned_sessions ats ON ats.id = ar.session_id
        JOIN owned_students s ON s.id = ar.student_id) AS attendance_records,
      (SELECT COALESCE(json_group_array(json_object(
        'id', sas.id, 'class_id', sas.class_id, 'subject_key', sas.subject_key, 'session_date', sas.session_date,
        'period_key', sas.period_key, 'period_label', sas.period_label, 'starts_at', sas.starts_at,
        'recorded_at', sas.recorded_at, 'created_by', sas.created_by
      )), '[]') FROM owned_school_sessions sas) AS school_attendance_sessions,
      (SELECT COALESCE(json_group_array(json_object(
        'id', sar.id, 'session_id', sar.session_id, 'student_id', sar.student_id, 'status', sar.status, 'recorded_at', sar.recorded_at
      )), '[]') FROM school_attendance_records sar JOIN owned_school_sessions sas ON sas.id = sar.session_id) AS school_attendance_records,
      (SELECT COALESCE(json_group_array(json_object(
        'id', os.id, 'school_id', os.school_id, 'class_id', os.class_id, 'subject_key', os.subject_key,
        'subject_label', os.subject_label, 'sort_order', os.sort_order, 'status', os.status
      )), '[]') FROM owned_subjects os) AS school_class_subjects,
      (SELECT COALESCE(json_group_array(json_object(
        'id', oa.id, 'school_id', oa.school_id, 'class_id', oa.class_id, 'teacher_id', oa.teacher_id,
        'subject_key', oa.subject_key, 'subject_label', oa.subject_label, 'status', oa.status, 'accepted_at', oa.accepted_at
      )), '[]') FROM owned_assignments oa) AS school_class_assignments,
      (SELECT COALESCE(json_group_array(json_object(
        'id', gs.id, 'teacher_id', gs.teacher_id, 'name', gs.name, 'is_default', gs.is_default,
        'created_at', gs.created_at
      )), '[]') FROM grading_schemes gs, context WHERE gs.teacher_id = context.teacher_id) AS grading_schemes,
      (SELECT COALESCE(json_group_array(json_object(
        'id', gsc.id, 'scheme_id', gsc.scheme_id, 'name', gsc.name,
        'weight_percent', gsc.weight_percent, 'grading_type', gsc.grading_type, 'sort_order', gsc.sort_order
      )), '[]') FROM grading_scheme_categories gsc JOIN grading_schemes gs ON gs.id = gsc.scheme_id
        JOIN context ON gs.teacher_id = context.teacher_id) AS grading_scheme_categories,
      (SELECT COALESCE(json_group_array(json_object(
        'id', ct.id, 'teacher_id', ct.teacher_id, 'text', ct.text, 'category', ct.category, 'created_at', ct.created_at
      )), '[]') FROM comment_templates ct, context WHERE ct.teacher_id = context.teacher_id) AS comment_templates,
      (SELECT COALESCE(json_group_array(json_object(
        'id', rr.id, 'teacher_id', rr.teacher_id, 'min_score', rr.min_score, 'max_score', rr.max_score,
        'text', rr.text, 'sort_order', rr.sort_order
      )), '[]') FROM grade_recommendation_rules rr, context WHERE rr.teacher_id = context.teacher_id) AS grade_recommendation_rules,
      (SELECT COALESCE(json_group_array(json_object(
        'id', btt.id, 'teacher_id', btt.teacher_id, 'label', btt.label, 'polarity', btt.polarity,
        'points', btt.points, 'icon', btt.icon, 'sort_order', btt.sort_order, 'created_at', btt.created_at
      )), '[]') FROM behavior_type_templates btt, context WHERE btt.teacher_id = context.teacher_id) AS behavior_type_templates,
      (SELECT COALESCE(json_group_array(json_object(
        'id', m.id, 'teacher_id', m.teacher_id, 'sender', m.sender, 'text', m.text,
        'read_by_teacher', m.read_by_teacher, 'read_by_admin', m.read_by_admin, 'client_message_id', m.client_message_id, 'created_at', m.created_at
      )), '[]') FROM messages m, context WHERE m.teacher_id = context.teacher_id AND datetime(m.created_at) >= datetime('now', '-24 hours')) AS messages
  `).get(req.teacherId);

  if (!row || !row.teacher) return res.status(404).json({ error: 'بيانات المعلم غير موجودة' });

  const snapshot = {
    version: 4,
    generated_at: new Date().toISOString(),
    teacher: parseJson(row.teacher, null),
    subscriptions: parseJson(row.subscriptions, []),
    classes: parseJson(row.classes, []),
    students: parseJson(row.students, []),
    grade_categories: parseJson(row.grade_categories, []),
    assessments: parseJson(row.assessments, []),
    grades: parseJson(row.grades, []).map((grade) => ({
      ...grade,
      rubric_json: parseJson(grade.rubric_json, grade.rubric_json),
    })),
    behavior_types: parseJson(row.behavior_types, []),
    behavior_logs: parseJson(row.behavior_logs, []),
    attendance_sessions: parseJson(row.attendance_sessions, []),
    attendance_records: parseJson(row.attendance_records, []),
    school_attendance_sessions: parseJson(row.school_attendance_sessions, []),
    school_attendance_records: parseJson(row.school_attendance_records, []),
    school_class_subjects: parseJson(row.school_class_subjects, []),
    school_class_assignments: parseJson(row.school_class_assignments, []),
    grading_schemes: parseJson(row.grading_schemes, []),
    grading_scheme_categories: parseJson(row.grading_scheme_categories, []),
    comment_templates: parseJson(row.comment_templates, []),
    grade_recommendation_rules: parseJson(row.grade_recommendation_rules, []),
    behavior_type_templates: parseJson(row.behavior_type_templates, []),
    messages: parseJson(row.messages, []),
  };

  res.json(snapshot);
});

module.exports = router;
