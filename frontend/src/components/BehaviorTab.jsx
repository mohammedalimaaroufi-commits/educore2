import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import Icon from './Icon.jsx';
import StudentAvatar from './StudentAvatar.jsx';
import StudentDetailModal from './StudentDetailModal.jsx';
import { POSITIVE_BEHAVIOR_ICONS, NEGATIVE_BEHAVIOR_ICONS } from '../constants.js';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, syncSnapshot } from '../utils/snapshotSync.js';
import { buildClassRoster, getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';

function localId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatWhen(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('ar', { month: 'short', day: 'numeric' });
}

function buildSummary(snapshot, classId) {
  const roster = buildClassRoster(snapshot, classId);
  const typeMap = new Map((snapshot?.behavior_types || []).map((type) => [type.id, type]));
  const { students } = getClassData(snapshot, classId);
  return students.map((student) => {
    const logs = (snapshot?.behavior_logs || [])
      .filter((log) => log.student_id === student.id)
      .sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
    const enrichedLogs = logs.map((log) => ({ ...log, behavior: typeMap.get(log.behavior_type_id) }));
    return {
      student_id: student.id,
      full_name: student.full_name,
      behavior_score: roster.find((row) => row.student_id === student.id)?.behaviorScore || 0,
      positive_count: logs.filter((log) => typeMap.get(log.behavior_type_id)?.polarity === 'positive').length,
      negative_count: logs.filter((log) => typeMap.get(log.behavior_type_id)?.polarity === 'negative').length,
      latest_logs: enrichedLogs.slice(0, 3),
    };
  });
}

export default function BehaviorTab({ classId }) {
  const [snapshot, setSnapshot] = useState(null);
  const [students, setStudents] = useState([]);
  const [types, setTypes] = useState([]);
  const [query, setQuery] = useState('');
  const [openStudent, setOpenStudent] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [summary, setSummary] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [newType, setNewType] = useState({ label: '', polarity: 'positive', points: 1, icon: 'star' });
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const teacherId = getTeacherId();

  const load = async () => {
    const data = await getOrSyncSnapshot(teacherId);
    const classData = getClassData(data, classId);
    setSnapshot(data);
    setStudents(classData.students);
    setTypes((data.behavior_types || []).filter((type) => type.class_id === classId));
    setSummary(buildSummary(data, classId));
    setLoading(false);
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [classId]);

  const filteredStudents = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? students.filter((student) => student.full_name.toLowerCase().includes(value)) : students;
  }, [students, query]);

  const applySnapshot = (next) => {
    setSnapshot(next);
    setTypes((next.behavior_types || []).filter((type) => type.class_id === classId));
    setSummary(buildSummary(next, classId));
    void saveSnapshot(teacherId, next);
  };

  const logBehavior = async (studentId, behaviorTypeId) => {
    const note = noteDrafts[studentId] || '';
    const entry = { id: localId('behavior'), student_id: studentId, behavior_type_id: behaviorTypeId, note_text: note || null, note_audio_url: null, occurred_at: new Date().toISOString() };
    const next = { ...snapshot, behavior_logs: [...(snapshot?.behavior_logs || []), entry] };
    applySnapshot(next);
    setNoteDrafts((drafts) => ({ ...drafts, [studentId]: '' }));
    setFeedback('تم رصد السلوك محليًا ✓');
    setTimeout(() => setFeedback(''), 1500);
    try {
      await api.post('/behavior/log', entry);
      void syncSnapshot(teacherId, { force: true });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/behavior/log', data: entry });
    }
  };

  const addType = async (event) => {
    event.preventDefault();
    const entry = { id: localId('behavior-type'), class_id: classId, ...newType };
    const next = { ...snapshot, behavior_types: [...(snapshot?.behavior_types || []), entry] };
    applySnapshot(next);
    setNewType({ label: '', polarity: 'positive', points: 1, icon: 'star' });
    setShowTypeForm(false);
    try {
      await api.post('/behavior/types', entry);
      void syncSnapshot(teacherId, { force: true });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/behavior/types', data: entry });
    }
  };

  const iconOptions = newType.polarity === 'positive' ? POSITIVE_BEHAVIOR_ICONS : NEGATIVE_BEHAVIOR_ICONS;
  if (loading) return <p className="text-ink/50">جارِ تجهيز السلوك محليًا...</p>;

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div><h3 className="font-bold">رصد سلوك بنقرة واحدة</h3><p className="text-xs text-ink/50 mt-1">تظهر النقاط وآخر التفاصيل بجانب اسم الطالب مباشرة.</p></div>
          {feedback && <span className="text-primary text-sm">{feedback}</span>}
        </div>
        <div className="relative mb-3"><input className="input text-sm pr-9" placeholder="بحث سريع عن طالب..." value={query} onChange={(event) => setQuery(event.target.value)} /><Icon name="search" className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink/30" /></div>
        <div className="space-y-2">
          {filteredStudents.map((student) => {
            const row = summary.find((item) => item.student_id === student.id) || { behavior_score: 0, positive_count: 0, negative_count: 0, latest_logs: [] };
            return (
              <div key={student.id} className="border border-line rounded-xl2 overflow-hidden">
                <button onClick={() => setOpenStudent((current) => (current === student.id ? null : student.id))} className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-right hover:bg-surface ${openStudent === student.id ? 'bg-surface' : ''}`}>
                  <StudentAvatar name={student.full_name} photoUrl={student.photo_url} size={26} />
                  <span className="flex-1 min-w-0 text-right"><span className="font-medium block truncate">{student.full_name}</span><span className="flex flex-wrap items-center gap-1 mt-1 text-[10px]"><span className={`px-1.5 py-0.5 rounded-full ${row.behavior_score >= 0 ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'}`}>النقاط {row.behavior_score > 0 ? '+' : ''}{row.behavior_score}</span><span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">إيجابي {row.positive_count}</span><span className="px-1.5 py-0.5 rounded-full bg-danger/10 text-danger">سلبي {row.negative_count}</span>{row.latest_logs[0]?.behavior?.label && <span className="text-ink/40 truncate">آخرًا: {row.latest_logs[0].behavior.label}</span>}</span></span>
                  <Icon name={openStudent === student.id ? 'chevronUp' : 'chevronDown'} className="w-4 h-4 text-ink/40 shrink-0" />
                </button>
                {openStudent === student.id && (
                  <div className="px-3 pb-3 pt-1 border-t border-line bg-surface/50">
                    <p className="text-xs text-ink/50 mb-2">اضغط على أي ملاحظة سلوكية محفوظة لرصدها فورًا لـ{student.full_name}:</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">{types.map((type) => <button key={type.id} onClick={() => logBehavior(student.id, type.id)} className={`px-3 py-2 rounded-xl2 text-sm font-medium border flex items-center justify-center gap-2 ${type.polarity === 'positive' ? 'border-primary/40 text-primary hover:bg-primary/10' : 'border-danger/40 text-danger hover:bg-danger/10'}`}><Icon name={type.icon} className="w-4 h-4" />{type.label} ({type.points > 0 ? '+' : ''}{type.points})</button>)}</div>
                    <input className="input text-xs" placeholder="ملاحظة سريعة (اختياري)" value={noteDrafts[student.id] || ''} onChange={(event) => setNoteDrafts((drafts) => ({ ...drafts, [student.id]: event.target.value }))} />
                    {row.latest_logs.length > 0 && <div className="mt-3 space-y-1"><p className="text-xs font-bold text-ink/60">آخر التفاصيل</p>{row.latest_logs.map((log) => <div key={log.id} className="flex items-start gap-2 text-xs border-b border-line/70 pb-1"><span className={log.behavior?.polarity === 'positive' ? 'text-primary' : 'text-danger'}>{log.behavior?.label || 'سلوك'}</span><span className="text-ink/50 flex-1">{log.note_text || 'بدون ملاحظة نصية'}</span><span className="text-ink/30">{formatWhen(log.occurred_at)}</span></div>)}</div>}
                    <button className="text-primary text-xs mt-2" onClick={() => setDetailStudentId(student.id)}>عرض كامل السجل السلوكي لهذا الطالب</button>
                  </div>
                )}
              </div>
            );
          })}
          {filteredStudents.length === 0 && <p className="text-ink/50 text-sm py-4 text-center">لا يوجد طالب مطابق للبحث.</p>}
        </div>
        {!showTypeForm ? <button className="text-primary text-sm mt-3" onClick={() => setShowTypeForm(true)}>+ إضافة سلوك مخصص لهذا الصف</button> : <form onSubmit={addType} className="space-y-2 mt-3 pt-3 border-t border-line"><div className="flex flex-wrap gap-2"><input className="input text-sm flex-1" placeholder="اسم السلوك" required value={newType.label} onChange={(event) => setNewType({ ...newType, label: event.target.value })} /><select className="input text-sm w-32" value={newType.polarity} onChange={(event) => setNewType({ ...newType, polarity: event.target.value, icon: event.target.value === 'positive' ? 'star' : 'clock' })}><option value="positive">إيجابي</option><option value="negative">سلبي</option></select><input className="input text-sm w-20" type="number" value={newType.points} onChange={(event) => setNewType({ ...newType, points: Number(event.target.value) })} /></div><div className="flex gap-2">{iconOptions.map((icon) => <button key={icon} type="button" onClick={() => setNewType({ ...newType, icon })} className={`p-2 rounded-lg border ${newType.icon === icon ? 'border-primary bg-primary/10' : 'border-line'}`}><Icon name={icon} className="w-4 h-4" /></button>)}<button className="btn-secondary text-sm mr-auto" type="submit">حفظ السلوك</button></div></form>}
      </div>
      <StudentDetailModal studentId={detailStudentId} onClose={() => setDetailStudentId(null)} />
    </div>
  );
}
