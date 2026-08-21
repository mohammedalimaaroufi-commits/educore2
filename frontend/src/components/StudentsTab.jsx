import React, { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import StudentAvatar from './StudentAvatar.jsx';
import { resizeImageFile } from '../utils/image.js';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, syncSnapshot } from '../utils/snapshotSync.js';
import { getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { useLocale } from '../context/LocaleContext.jsx';

const EMPTY_FORM = { full_name: '', student_number: '', guardian_name: '', guardian_phone: '', guardian_email: '', health_notes: '', private_notes: '', photo_url: '' };
const localId = () => `student-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function StudentsTab({ classId }) {
  const { t, locale } = useLocale();
  const [snapshot, setSnapshot] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const fileRef = useRef(null);
  const [importMsg, setImportMsg] = useState('');
  const [feedback, setFeedback] = useState('');
  const teacherId = getTeacherId();

  const load = async () => {
    setLoading(true);
    const data = await getOrSyncSnapshot(teacherId);
    setSnapshot(data);
    setStudents(getClassData(data, classId).students);
    setLoading(false);
  };
  useEffect(() => { load().catch(() => setLoading(false)); }, [classId]);

  const applySnapshot = (next) => {
    setSnapshot(next);
    setStudents(getClassData(next, classId).students);
    void saveSnapshot(teacherId, next);
  };

  const startAdd = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); };
  const startEdit = (student) => { setForm({ full_name: student.full_name, student_number: student.student_number || '', guardian_name: student.guardian_name || '', guardian_phone: student.guardian_phone || '', guardian_email: student.guardian_email || '', health_notes: student.health_notes || '', private_notes: student.private_notes || '', photo_url: student.photo_url || '' }); setEditingId(student.id); setShowForm(true); };
  const handlePhoto = async (event) => { const file = event.target.files[0]; if (!file) return; const dataUrl = await resizeImageFile(file); setForm((current) => ({ ...current, photo_url: dataUrl })); };

  const submit = async (event) => {
    event.preventDefault();
    const payload = editingId ? form : { id: localId(), class_id: classId, ...form };
    const nextStudent = { ...payload, id: editingId || payload.id, class_id: classId, archived: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const next = { ...snapshot, students: editingId ? (snapshot.students || []).map((student) => student.id === editingId ? { ...student, ...nextStudent } : student) : [...(snapshot.students || []), nextStudent] };
    applySnapshot(next);
    setForm(EMPTY_FORM); setShowForm(false); setEditingId(null);
    try {
      if (editingId) await api.patch(`/students/${editingId}`, form);
      else await api.post('/students', payload);
      void syncSnapshot(teacherId, { force: true });
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: editingId ? 'PATCH' : 'POST', url: editingId ? `/students/${editingId}` : '/students', data: payload });
      setFeedback(t('savedLocally'));
    }
    setTimeout(() => setFeedback(''), 2500);
  };

  const removeStudent = async (id) => {
    if (!confirm(t('confirmArchiveStudent'))) return;
    const next = { ...snapshot, students: (snapshot.students || []).map((student) => student.id === id ? { ...student, archived: 1 } : student) };
    applySnapshot(next);
    try { await api.delete(`/students/${id}`); void syncSnapshot(teacherId, { force: true }); } catch { await queueMutation(teacherId, { method: 'DELETE', url: `/students/${id}` }); }
  };

  const handleImport = async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file); fd.append('class_id', classId);
    try { const { data } = await api.post('/students/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); setImportMsg(t('importSuccess', '', { count: data.imported })); void syncSnapshot(teacherId, { force: true }); } catch { setImportMsg(t('importOffline')); }
    event.target.value = '';
  };

  return <div><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><h3 className="text-lg font-bold">{t('studentsTitle')} ({students.length})</h3><div className="flex gap-2"><a href="/students_import_template.csv" download className="btn-secondary text-sm">{t('downloadCsv')}</a><label className="btn-secondary text-sm cursor-pointer">{t('importFile')}<input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} /></label><button className="btn-primary text-sm" onClick={startAdd}>+ {t('addStudent')}</button></div></div>{(importMsg || feedback) && <p className="text-primary text-sm mb-3">{importMsg || feedback}</p>}{showForm && <form onSubmit={submit} className="card p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4"><div className="sm:col-span-2 flex items-center gap-4"><StudentAvatar name={form.full_name || '?'} photoUrl={form.photo_url} size={64} /><label className="btn-secondary text-sm cursor-pointer">{form.photo_url ? t('changePhoto') : t('addPhoto')}<input type="file" accept="image/*" className="hidden" onChange={handlePhoto} /></label>{form.photo_url && <button type="button" className="text-danger text-xs" onClick={() => setForm((current) => ({ ...current, photo_url: '' }))}>{t('removePhoto')}</button>}</div><div><label className="label">{t('fullStudentName')}</label><input className="input" required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></div><div><label className="label">{t('studentNumber')}</label><input className="input" value={form.student_number} onChange={(event) => setForm({ ...form, student_number: event.target.value })} /></div><div><label className="label">{t('guardianName')}</label><input className="input" value={form.guardian_name} onChange={(event) => setForm({ ...form, guardian_name: event.target.value })} /></div><div><label className="label">{t('guardianPhone')}</label><input className="input" value={form.guardian_phone} onChange={(event) => setForm({ ...form, guardian_phone: event.target.value })} /></div><div><label className="label">{t('healthNotes')}</label><input className="input" value={form.health_notes} onChange={(event) => setForm({ ...form, health_notes: event.target.value })} /></div><div><label className="label">{t('privateNotes')}</label><input className="input" value={form.private_notes} onChange={(event) => setForm({ ...form, private_notes: event.target.value })} /></div><div className="sm:col-span-2 flex gap-2"><button className="btn-primary" type="submit">{editingId ? t('saveChanges') : t('addStudent')}</button><button className="btn-secondary" type="button" onClick={() => { setShowForm(false); setEditingId(null); }}>{t('cancel')}</button></div></form>}{loading ? <p className="text-ink/50">{t('loadingStudents')}</p> : <div className="card overflow-x-auto"><table className="w-full text-sm"><thead className="bg-surface text-ink/60"><tr><th className="text-right px-4 py-3">{t('students')}</th><th className="text-right px-4 py-3">{t('studentNumber')}</th><th className="text-right px-4 py-3">{t('guardianName')}</th><th className="text-right px-4 py-3">{t('guardianPhone')}</th><th className="px-4 py-3"></th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-t border-line"><td className="px-4 py-3 font-medium"><div className="flex items-center gap-2"><StudentAvatar name={student.full_name} photoUrl={student.photo_url} size={32} />{student.full_name}</div></td><td className="px-4 py-3 text-ink/60">{student.student_number || '—'}</td><td className="px-4 py-3 text-ink/60">{student.guardian_name || '—'}</td><td className="px-4 py-3 text-ink/60">{student.guardian_phone || '—'}</td><td className="px-4 py-3 text-left whitespace-nowrap"><button className="text-primary text-xs ml-3" onClick={() => startEdit(student)}>{t('edit')}</button><button className="text-danger text-xs" onClick={() => removeStudent(student.id)}>{t('archiveClass')}</button></td></tr>)}{students.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/50">{t('noStudents')}</td></tr>}</tbody></table></div>}</div>;
}
