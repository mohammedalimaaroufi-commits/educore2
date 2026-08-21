import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import Icon from './Icon.jsx';
import StudentDetailModal from './StudentDetailModal.jsx';
import { ATTENDANCE_STATUS } from '../constants.js';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, syncSnapshot } from '../utils/snapshotSync.js';
import { getClassData, calculateAttendanceRate } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { useLocale } from '../context/LocaleContext.jsx';

function localId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildSessionData(snapshot, classId, date) {
  const { students } = getClassData(snapshot, classId);
  let session = (snapshot?.attendance_sessions || []).find((item) => item.class_id === classId && item.session_date === date);
  if (!session) session = { id: localId('attendance-session'), class_id: classId, session_date: date };
  const records = new Map((snapshot?.attendance_records || []).filter((record) => record.session_id === session.id).map((record) => [record.student_id, record]));
  return { session, roster: students.map((student) => ({ student_id: student.id, full_name: student.full_name, status: records.get(student.id)?.status || 'present' })) };
}

function buildStats(snapshot, classId) {
  const { students } = getClassData(snapshot, classId);
  return students.map((student) => {
    const records = (snapshot?.attendance_records || []).filter((record) => record.student_id === student.id);
    return {
      student_id: student.id,
      full_name: student.full_name,
      present_count: records.filter((record) => record.status === 'present').length,
      absent_count: records.filter((record) => record.status === 'absent').length,
      late_count: records.filter((record) => record.status === 'late').length,
      excused_count: records.filter((record) => record.status === 'excused').length,
      total_sessions: records.length,
    };
  });
}

export default function AttendanceTab({ classId }) {
  const { t } = useLocale();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [session, setSession] = useState(null);
  const [roster, setRoster] = useState([]);
  const [stats, setStats] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const teacherId = getTeacherId();

  const refreshLocal = (data, selectedDate = date) => {
    const sessionData = buildSessionData(data, classId, selectedDate);
    setSnapshot(data);
    setSession(sessionData.session);
    setRoster(sessionData.roster);
    setStats(buildStats(data, classId));
  };

  useEffect(() => {
    let active = true;
    getOrSyncSnapshot(teacherId).then((data) => { if (active) { refreshLocal(data); setLoading(false); } }).catch(() => setLoading(false));
    return () => { active = false; };
  }, [classId]);

  const setStatus = (studentId, status) => setRoster((current) => current.map((student) => student.student_id === studentId ? { ...student, status } : student));

  const changeDate = (nextDate) => {
    setDate(nextDate);
    if (snapshot) {
      const sessionData = buildSessionData(snapshot, classId, nextDate);
      setSession(sessionData.session);
      setRoster(sessionData.roster);
    }
  };

  const save = async () => {
    if (!session) return;
    const records = roster.map((row) => ({ id: localId('attendance-record'), session_id: session.id, student_id: row.student_id, status: row.status }));
    const existingSession = (snapshot?.attendance_sessions || []).some((item) => item.id === session.id);
    const nextSnapshot = {
      ...snapshot,
      attendance_sessions: existingSession ? snapshot.attendance_sessions : [...(snapshot?.attendance_sessions || []), session],
      attendance_records: [...(snapshot?.attendance_records || []).filter((record) => !(record.session_id === session.id && records.some((item) => item.student_id === record.student_id))), ...records],
    };
    setSnapshot(nextSnapshot);
    setStats(buildStats(nextSnapshot, classId));
    void saveSnapshot(teacherId, nextSnapshot);
    const payload = { session_id: session.id, class_id: classId, session_date: date, records: records.map(({ student_id, status }) => ({ student_id, status })) };
    try {
      await api.post('/attendance/session', payload);
      void syncSnapshot(teacherId, { force: true });
      setFeedback(t('attendanceSaved'));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/attendance/session', data: payload });
      setFeedback(t('attendanceSavedLocally'));
    }
    setTimeout(() => setFeedback(''), 2500);
  };

  if (loading) return <p className="text-ink/50">{t('attendanceLoading')}</p>;
  const statusLabels = { present: t('present'), absent: t('absent'), late: t('late'), excused: t('excused') };
  return <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"><div className="card p-4 lg:col-span-2"><div className="flex items-center justify-between mb-4"><h3 className="font-bold">{t('attendanceTitle')}</h3><input type="date" className="input text-sm w-40" value={date} onChange={(event) => changeDate(event.target.value)} /></div><div className="space-y-2 max-h-96 overflow-y-auto">{roster.map((student) => <div key={student.student_id} className="flex items-center justify-between border-b border-line pb-2"><span className="text-sm font-medium">{student.full_name}</span><div className="flex gap-1">{Object.entries(ATTENDANCE_STATUS).map(([key, status]) => <button key={key} onClick={() => setStatus(student.student_id, key)} className={`px-2 py-1 rounded-md text-xs border flex items-center gap-1 ${student.status === key ? status.bg : 'border-line text-ink/60 hover:bg-surface'}`}><Icon name={status.icon} className="w-3 h-3" />{statusLabels[key]}</button>)}</div></div>)}</div><button className="btn-primary text-sm mt-4" onClick={save}>{t('saveAttendanceToday')}</button>{feedback && <p className="text-primary text-xs mt-2">{feedback}</p>}</div><div className="card p-4"><h3 className="font-bold mb-3">{t('attendanceStats')}</h3><div className="space-y-3 max-h-96 overflow-y-auto">{stats.map((student) => { const rate = student.total_sessions > 0 ? Math.round((student.present_count / student.total_sessions) * 100) : null; return <div key={student.student_id}><div className="flex justify-between text-xs mb-1"><button className="text-ink hover:text-primary" onClick={() => setDetailStudentId(student.student_id)}>{student.full_name}</button><span className="text-ink/60">{rate !== null ? `${rate}%` : '—'}</span></div><div className="w-full h-2 bg-line rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${rate ?? 0}%` }} /></div></div>; })}</div></div><StudentDetailModal studentId={detailStudentId} onClose={() => setDetailStudentId(null)} /></div>;
}
