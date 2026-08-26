import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import Icon from './Icon.jsx';
import StudentDetailModal from './StudentDetailModal.jsx';
import { ATTENDANCE_STATUS } from '../constants.js';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, scheduleBackgroundSync } from '../utils/snapshotSync.js';
import { buildSnapshotIndexes, getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { useLocale } from '../context/LocaleContext.jsx';

function localId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSchoolAssignment(snapshot, classId, teacherId, requestedKey = '') {
  const rows = (snapshot?.school_class_assignments || []).filter((item) => item.class_id === classId && item.teacher_id === teacherId && item.status === 'active');
  return rows.find((item) => item.subject_key === requestedKey) || rows[0] || null;
}

function buildSessionData(snapshot, classId, date, indexes = buildSnapshotIndexes(snapshot), subjectKey = '', periodKey = 'daily') {
  const { students } = getClassData(snapshot, classId, indexes);
  const classData = indexes.classesById.get(classId);
  const school = Boolean(classData?.school_id);
  const sourceSessions = school ? (snapshot?.school_attendance_sessions || []) : (snapshot?.attendance_sessions || []);
  let session = school
    ? sourceSessions.find((item) => item.class_id === classId && item.session_date === date && item.subject_key === subjectKey && item.period_key === periodKey)
    : sourceSessions.find((item) => item.class_id === classId && item.session_date === date);
  if (!session) session = school
    ? { id: localId('school-attendance-session'), class_id: classId, subject_key: subjectKey, session_date: date, period_key: periodKey, period_label: periodKey === 'daily' ? 'اليومي' : periodKey, starts_at: null }
    : { id: localId('attendance-session'), class_id: classId, session_date: date };
  const records = new Map((indexes.attendanceBySession.get(session.id) || []).map((record) => [record.student_id, record]));
  return { session, roster: students.map((student) => ({ student_id: student.id, full_name: student.full_name, status: records.get(student.id)?.status || 'present' })) };
}

function buildStats(snapshot, classId, indexes = buildSnapshotIndexes(snapshot), subjectKey = '') {
  const { students } = getClassData(snapshot, classId, indexes);
  const classData = indexes.classesById.get(classId);
  return students.map((student) => {
    const records = (indexes.attendanceByStudent.get(student.id) || []).filter((record) => {
      if (!classData?.school_id || !subjectKey) return true;
      return indexes.sessionsById.get(record.session_id)?.subject_key === subjectKey;
    });
    const counts = records.reduce((result, record) => {
      if (result[`${record.status}_count`] !== undefined) result[`${record.status}_count`] += 1;
      return result;
    }, { present_count: 0, absent_count: 0, late_count: 0, excused_count: 0 });
    return { student_id: student.id, full_name: student.full_name, ...counts, total_sessions: records.length };
  });
}

export default function AttendanceTab({ classId }) {
  const { t } = useLocale();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [periodKey, setPeriodKey] = useState('daily');
  const [periodLabel, setPeriodLabel] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [subjectKey, setSubjectKey] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [session, setSession] = useState(null);
  const [roster, setRoster] = useState([]);
  const [stats, setStats] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const teacherId = getTeacherId();

  const refreshLocal = (data, selectedDate = date, selectedSubject = subjectKey, selectedPeriod = periodKey, selectedLabel = periodLabel, selectedStartsAt = startsAt) => {
    const indexes = buildSnapshotIndexes(data);
    const classData = indexes.classesById.get(classId);
    const assignments = classData?.school_id ? (data.school_class_assignments || []).filter((item) => item.class_id === classId && item.teacher_id === teacherId && item.status === 'active') : [];
    const activeSubject = assignments.find((item) => item.subject_key === selectedSubject) || assignments[0] || null;
    setSubjects(assignments);
    if (activeSubject && activeSubject.subject_key !== selectedSubject) setSubjectKey(activeSubject.subject_key);
    const sessionData = buildSessionData(data, classId, selectedDate, indexes, activeSubject?.subject_key || '', selectedPeriod);
    setSnapshot(data);
    setSession({ ...sessionData.session, period_label: selectedLabel || sessionData.session.period_label, starts_at: selectedStartsAt || sessionData.session.starts_at || null });
    setRoster(sessionData.roster);
    setStats(buildStats(data, classId, indexes, activeSubject?.subject_key || ''));
  };

  useEffect(() => {
    let active = true;
    getOrSyncSnapshot(teacherId).then((data) => { if (active) { refreshLocal(data); setLoading(false); } }).catch(() => setLoading(false));
    return () => { active = false; };
  }, [classId]);

  const classData = useMemo(() => snapshot ? buildSnapshotIndexes(snapshot).classesById.get(classId) : null, [snapshot, classId]);
  const isSchoolClass = Boolean(classData?.school_id);
  const setStatus = (studentId, status) => setRoster((current) => current.map((student) => student.student_id === studentId ? { ...student, status } : student));

  const reloadForSelection = (nextDate = date, nextSubject = subjectKey, nextPeriod = periodKey) => {
    if (snapshot) refreshLocal(snapshot, nextDate, nextSubject, nextPeriod);
  };
  const changeDate = (nextDate) => { setDate(nextDate); reloadForSelection(nextDate); };
  const changeSubject = (nextSubject) => { setSubjectKey(nextSubject); reloadForSelection(date, nextSubject); };
  const changePeriod = (nextPeriod) => { setPeriodKey(nextPeriod); setPeriodLabel(''); setStartsAt(''); reloadForSelection(date, subjectKey, nextPeriod); };

  const updateSessionTiming = (patch) => setSession((current) => current ? { ...current, ...patch } : current);

  const save = async () => {
    if (!session) return;
    const records = roster.map((row) => ({ id: localId('attendance-record'), session_id: session.id, student_id: row.student_id, status: row.status }));
    const schoolSession = isSchoolClass;
    const sessionKey = schoolSession ? 'school_attendance_sessions' : 'attendance_sessions';
    const recordKey = schoolSession ? 'school_attendance_records' : 'attendance_records';
    const existingSession = (snapshot?.[sessionKey] || []).some((item) => item.id === session.id);
    const nextSnapshot = {
      ...snapshot,
      [sessionKey]: existingSession ? snapshot[sessionKey] : [...(snapshot?.[sessionKey] || []), session],
      [recordKey]: [...(snapshot?.[recordKey] || []).filter((record) => !(record.session_id === session.id && records.some((item) => item.student_id === record.student_id))), ...records],
    };
    setSnapshot(nextSnapshot);
    setStats(buildStats(nextSnapshot, classId, buildSnapshotIndexes(nextSnapshot), subjectKey));
    void saveSnapshot(teacherId, nextSnapshot);
    const payload = { session_id: session.id, class_id: classId, session_date: date, subject_key: session.subject_key, period_key: session.period_key, records: records.map(({ student_id, status }) => ({ student_id, status })) };
    try {
      await api.post('/attendance/session', payload);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
      setFeedback(t('attendanceSaved'));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/attendance/session', data: payload });
      setFeedback(t('attendanceSavedLocally'));
    }
    setTimeout(() => setFeedback(''), 2500);
  };

  if (loading) return <p className="text-ink/50">{t('attendanceLoading')}</p>;
  const statusLabels = { present: t('present'), absent: t('absent'), late: t('late'), excused: t('excused') };
  return <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"><div className="card p-4 lg:col-span-2"><div className="flex flex-wrap items-center justify-between gap-2 mb-4"><h3 className="font-bold">{t('attendanceTitle')}</h3><div className="flex flex-wrap gap-2"><input type="date" className="input text-sm w-40" value={date} onChange={(event) => changeDate(event.target.value)} />{isSchoolClass && <><select className="input text-sm min-w-36" value={subjectKey} onChange={(event) => changeSubject(event.target.value)} aria-label={t('attendanceSubject')}><option value="">{t('attendanceSubject')}</option>{subjects.map((subject) => <option key={subject.subject_key} value={subject.subject_key}>{subject.subject_label}</option>)}</select><input className="input text-sm w-32" value={periodKey} onChange={(event) => changePeriod(event.target.value)} placeholder={t('attendancePeriod')} aria-label={t('attendancePeriod')} /><input className="input text-sm w-36" value={periodLabel} onChange={(event) => { setPeriodLabel(event.target.value); updateSessionTiming({ period_label: event.target.value }); }} placeholder={t('schoolAttendancePeriod')} aria-label={t('schoolAttendancePeriod')} /><input type="time" className="input text-sm w-32" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); updateSessionTiming({ starts_at: event.target.value }); }} aria-label={t('schoolAttendanceTime')} /></>}
</div></div><div className="space-y-2 max-h-96 overflow-y-auto">{roster.map((student) => <div key={student.student_id} className="flex items-center justify-between border-b border-line pb-2"><span className="text-sm font-medium">{student.full_name}</span><div className="flex gap-1">{Object.entries(ATTENDANCE_STATUS).map(([key, status]) => <button key={key} onClick={() => setStatus(student.student_id, key)} className={`px-2 py-1 rounded-md text-xs border flex items-center gap-1 ${student.status === key ? status.bg : 'border-line text-ink/60 hover:bg-surface'}`}><Icon name={status.icon} className="w-3 h-3" />{statusLabels[key]}</button>)}</div></div>)}</div><button className="btn-primary text-sm mt-4" onClick={save}>{t('saveAttendanceToday')}</button>{feedback && <p className="text-primary text-xs mt-2">{feedback}</p>}</div><div className="card p-4"><h3 className="font-bold mb-3">{t('attendanceStats')}</h3><div className="space-y-3 max-h-96 overflow-y-auto">{stats.map((student) => { const rate = student.total_sessions > 0 ? Math.round((student.present_count / student.total_sessions) * 100) : null; return <div key={student.student_id}><div className="flex justify-between text-xs mb-1"><button className="text-ink hover:text-primary" onClick={() => setDetailStudentId(student.student_id)}>{student.full_name}</button><span className="text-ink/60">{rate !== null ? `${rate}%` : '—'}</span></div><div className="w-full h-2 bg-line rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${rate ?? 0}%` }} /></div></div>; })}</div></div><StudentDetailModal studentId={detailStudentId} onClose={() => setDetailStudentId(null)} /></div>;
}
