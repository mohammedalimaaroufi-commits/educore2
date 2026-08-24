import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import Icon from './Icon.jsx';
import StudentAvatar from './StudentAvatar.jsx';
import StudentDetailModal from './StudentDetailModal.jsx';
import { POSITIVE_BEHAVIOR_ICONS, NEGATIVE_BEHAVIOR_ICONS } from '../constants.js';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, scheduleBackgroundSync } from '../utils/snapshotSync.js';
import { buildClassRoster, getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { readSettingsCache, writeSettingsCache } from '../utils/settingsCache.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';

function localId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatWhen(value, locale) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US', { month: 'short', day: 'numeric' });
}

const BEHAVIOR_FILTERS = [
  { id: 'all', key: 'allStudents' },
  { id: 'positive', key: 'hasPositives' },
  { id: 'negative', key: 'hasNegatives' },
  { id: 'notes', key: 'hasNotes' },
  { id: 'positive-notes', key: 'positiveNotes' },
  { id: 'negative-notes', key: 'negativeNotes' },
];

function buildSummary(snapshot, classId) {
  const roster = buildClassRoster(snapshot, classId);
  const typeMap = new Map((snapshot?.behavior_types || []).map((type) => [type.id, type]));
  const { students } = getClassData(snapshot, classId);
  return students.map((student) => {
    const logs = (snapshot?.behavior_logs || [])
      .filter((log) => log.student_id === student.id)
      .sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
    const enrichedLogs = logs.map((log) => ({ ...log, behavior: typeMap.get(log.behavior_type_id) }));
    const latestNoteLog = enrichedLogs.find((log) => String(log.note_text || '').trim());
    return {
      student_id: student.id,
      full_name: student.full_name,
      behavior_score: roster.find((row) => row.student_id === student.id)?.behaviorScore || 0,
      positive_count: logs.filter((log) => typeMap.get(log.behavior_type_id)?.polarity === 'positive').length,
      negative_count: logs.filter((log) => typeMap.get(log.behavior_type_id)?.polarity === 'negative').length,
      positive_points: logs.reduce((sum, log) => {
        const behavior = typeMap.get(log.behavior_type_id);
        return sum + (behavior?.polarity === 'positive' ? Math.abs(Number(behavior.points || 0)) : 0);
      }, 0),
      negative_points: logs.reduce((sum, log) => {
        const behavior = typeMap.get(log.behavior_type_id);
        return sum + (behavior?.polarity === 'negative' ? Math.abs(Number(behavior.points || 0)) : 0);
      }, 0),
      note_count: logs.filter((log) => String(log.note_text || '').trim()).length,
      positive_note_count: logs.filter((log) => typeMap.get(log.behavior_type_id)?.polarity === 'positive' && String(log.note_text || '').trim()).length,
      negative_note_count: logs.filter((log) => typeMap.get(log.behavior_type_id)?.polarity === 'negative' && String(log.note_text || '').trim()).length,
      latest_logs: enrichedLogs.slice(0, 3),
      latest_note: latestNoteLog?.note_text || '',
      latest_note_label: latestNoteLog?.behavior?.label || '',
    };
  });
}

export default function BehaviorTab({ classId }) {
  const { t, locale } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const teacherId = getTeacherId();
  const [snapshot, setSnapshot] = useState(null);
  const [students, setStudents] = useState([]);
  const [types, setTypes] = useState([]);
  const [query, setQuery] = useState('');
  const [behaviorFilter, setBehaviorFilter] = useState('all');
  const [behaviorSort, setBehaviorSort] = useState('score-desc');
  const [openStudent, setOpenStudent] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [summary, setSummary] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [newType, setNewType] = useState({ label: '', polarity: 'positive', points: 1, icon: 'star' });
  const [templates, setTemplates] = useState(() => readSettingsCache(teacherId, 'behavior-templates', []));
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const data = await getOrSyncSnapshot(teacherId);
    const classData = getClassData(data, classId);
    setSnapshot(data);
    setStudents(classData.students);
    setTypes((data.behavior_types || []).filter((type) => type.class_id === classId));
    setSummary(buildSummary(data, classId));
    try {
      const { data: templateData } = await api.get('/settings/behavior-templates');
      const nextTemplates = templateData.templates || [];
      setTemplates(nextTemplates);
      writeSettingsCache(teacherId, 'behavior-templates', nextTemplates);
    } catch {
      // Cached templates remain available when the teacher is offline.
    }
    setLoading(false);
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [classId]);

  const filteredStudents = useMemo(() => {
    const value = query.trim().toLowerCase();
    const rows = students
      .map((student) => ({ student, row: summary.find((item) => item.student_id === student.id) || {} }))
      .filter(({ student, row }) => {
        const matchesSearch = !value || student.full_name.toLowerCase().includes(value);
        const matchesFilter = behaviorFilter === 'all'
          || (behaviorFilter === 'positive' && row.positive_points > 0)
          || (behaviorFilter === 'negative' && row.negative_points > 0)
          || (behaviorFilter === 'notes' && row.note_count > 0)
          || (behaviorFilter === 'positive-notes' && row.positive_note_count > 0)
          || (behaviorFilter === 'negative-notes' && row.negative_note_count > 0);
        return matchesSearch && matchesFilter;
      });
    rows.sort((a, b) => {
      if (behaviorSort === 'positive-desc') return (b.row.positive_points || 0) - (a.row.positive_points || 0);
      if (behaviorSort === 'negative-desc') return (b.row.negative_points || 0) - (a.row.negative_points || 0);
      if (behaviorSort === 'notes-desc') return (b.row.note_count || 0) - (a.row.note_count || 0);
      if (behaviorSort === 'name') return a.student.full_name.localeCompare(b.student.full_name, locale === 'ar' ? 'ar' : 'en');
      return (b.row.behavior_score || 0) - (a.row.behavior_score || 0);
    });
    return rows.map(({ student }) => student);
  }, [students, query, summary, behaviorFilter, behaviorSort]);

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
    setFeedback(`${t('savedLocally')} ✓`);
    setTimeout(() => setFeedback(''), 1500);
    try {
      await api.post('/behavior/log', entry);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/behavior/log', data: entry });
    }
  };

  const deleteBehaviorLog = async (log) => {
    if (!log?.id) return;
    const accepted = await confirm({ title: t('deleteBehaviorLog'), message: t('deleteBehaviorLogConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    const next = { ...snapshot, behavior_logs: (snapshot?.behavior_logs || []).filter((item) => item.id !== log.id) };
    applySnapshot(next);
    setFeedback(t('behaviorLogDeleted'));
    try {
      await api.delete(`/behavior/log/${log.id}`);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/behavior/log/${log.id}` });
    }
  };

  const addType = async (event) => {
    event.preventDefault();
    const points = Math.abs(Number(newType.points || 0));
    const entry = { id: localId('behavior-type'), class_id: classId, ...newType, points: newType.polarity === 'negative' ? -points : points };
    const next = { ...snapshot, behavior_types: [...(snapshot?.behavior_types || []), entry] };
    applySnapshot(next);
    setNewType({ label: '', polarity: 'positive', points: 1, icon: 'star' });
    setShowTypeForm(false);
    try {
      await api.post('/behavior/types', entry);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/behavior/types', data: entry });
    }
  };

  const updateType = async (typeId) => {
    const type = types.find((item) => item.id === typeId);
    if (!type || Number(type.is_default)) return;
    const label = String(editingType?.label || '').trim();
    const polarity = editingType?.polarity === 'negative' ? 'negative' : 'positive';
    const points = Math.abs(Number(editingType?.points || 0));
    if (!label || !Number.isFinite(points) || points <= 0) return;
    const patch = { label, polarity, points, icon: editingType?.icon || type.icon || 'star' };
    const next = { ...snapshot, behavior_types: (snapshot?.behavior_types || []).map((item) => item.id === typeId ? { ...item, ...patch, points: polarity === 'negative' ? -points : points } : item) };
    applySnapshot(next);
    setEditingTypeId(null);
    setEditingType(null);
    setFeedback(t('behaviorTypeSaved'));
    try {
      await api.patch(`/behavior/types/${typeId}`, patch);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'PATCH', url: `/behavior/types/${typeId}`, data: patch });
    }
  };

  const deleteType = async (type) => {
    if (Number(type.is_default)) return;
    const hasLogs = (snapshot?.behavior_logs || []).some((log) => log.behavior_type_id === type.id);
    if (hasLogs) {
      setFeedback(t('behaviorTypeHasLogs'));
      return;
    }
    const accepted = await confirm({ title: t('deleteBehaviorType'), message: t('deleteBehaviorTypeConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    const next = { ...snapshot, behavior_types: (snapshot?.behavior_types || []).filter((item) => item.id !== type.id) };
    applySnapshot(next);
    setTypes((current) => current.filter((item) => item.id !== type.id));
    try {
      await api.delete(`/behavior/types/${type.id}`);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/behavior/types/${type.id}` });
    }
  };

  const applyTemplate = async () => {
    const template = templates.find((item) => String(item.id) === String(selectedTemplateId));
    if (!template) {
      setFeedback(t('noBehaviorTemplateSelected'));
      return;
    }
    const alreadyExists = types.some((type) => type.label.trim().toLowerCase() === String(template.label).trim().toLowerCase());
    if (alreadyExists) {
      setFeedback(t('behaviorAlreadyInClass'));
      return;
    }
    const points = Math.abs(Number(template.points || 1));
    const entry = { id: localId('behavior-type'), class_id: classId, label: template.label, polarity: template.polarity === 'negative' ? 'negative' : 'positive', points: template.polarity === 'negative' ? -points : points, icon: template.icon || 'star', is_default: 0 };
    const next = { ...snapshot, behavior_types: [...(snapshot?.behavior_types || []), entry] };
    applySnapshot(next);
    setSelectedTemplateId('');
    setFeedback(t('behaviorTemplateApplied'));
    try {
      await api.post('/behavior/types', entry);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/behavior/types', data: entry });
      setFeedback(t('behaviorTemplateQueued'));
    }
  };

  const iconOptions = newType.polarity === 'positive' ? POSITIVE_BEHAVIOR_ICONS : NEGATIVE_BEHAVIOR_ICONS;
  if (loading) return <p className="text-ink/50">{t('behaviorLoading')}</p>;

  return (
    <div className="behavior-workspace">
      {confirmDialog}
      <div className="card behavior-control-card">
        <div className="behavior-command-bar">
          <div className="behavior-command-title"><span className="behavior-command-icon"><Icon name="heart" className="w-4 h-4" /></span><div><h3>{t('behaviorEntryLabel')}</h3><span>{t('behaviorOneClick')}</span></div></div>
          <div className="behavior-command-feedback">{feedback && <span className="text-primary text-sm">{feedback}</span>}</div>
          <div className="behavior-command-controls">
            <button type="button" className="behavior-custom-trigger" onClick={() => setShowTypeForm(true)}><Icon name="plus" className="w-4 h-4" /><span>{t('addCustomBehavior')}</span></button>
            <label className="behavior-search-control"><Icon name="search" className="w-4 h-4" /><span className="sr-only">{t('searchStudent')}</span><input className="input text-sm" placeholder={t('searchStudent')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="behavior-select-control"><span>{t('filterBy')}</span><select className="input text-xs" value={behaviorFilter} onChange={(event) => setBehaviorFilter(event.target.value)} aria-label={t('filterBy')}>{BEHAVIOR_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{t(filter.key)}</option>)}</select></label>
            <label className="behavior-select-control"><span>{t('sortBy')}</span><select className="input text-xs" value={behaviorSort} onChange={(event) => setBehaviorSort(event.target.value)} aria-label={t('sortBy')}>
              <option value="score-desc">{t('highestNet')}</option>
              <option value="positive-desc">{t('mostPositive')}</option>
              <option value="negative-desc">{t('mostNegative')}</option>
              <option value="notes-desc">{t('mostNotes')}</option>
              <option value="name">{t('alphabetical')}</option>
            </select></label>
          </div>
        </div>
        <p className="behavior-results-summary">{t('displayCount', '', { visible: filteredStudents.length, total: students.length })} · {locale === 'ar' ? 'النقاط السلبية محسوبة بقيمتها المطلقة، والصافي يظهر بجانب اسم الطالب.' : 'Negative points use absolute values, and the net score appears beside the student name.'}</p>
        <div className="behavior-students-scroll" role="region" aria-label={t('students')}>
          <div className="behavior-student-grid">
          {filteredStudents.map((student) => {
              const row = summary.find((item) => item.student_id === student.id) || { behavior_score: 0, positive_count: 0, negative_count: 0, positive_points: 0, negative_points: 0, note_count: 0, latest_logs: [] };
            return (
              <div key={student.id} className="border border-line rounded-xl2 overflow-hidden">
                <button onClick={() => setOpenStudent((current) => (current === student.id ? null : student.id))} className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-right hover:bg-surface ${openStudent === student.id ? 'bg-surface' : ''}`}>
                  <StudentAvatar name={student.full_name} photoUrl={student.photo_url} size={26} />
                  <span className="flex-1 min-w-0 text-right"><span className="font-medium block truncate">{student.full_name}</span><span className="flex flex-wrap items-center gap-1 mt-1 text-[10px]"><span className={`px-1.5 py-0.5 rounded-full ${row.behavior_score >= 0 ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'}`}>{t('net')} {row.behavior_score > 0 ? '+' : ''}{row.behavior_score}</span><span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{t('positive')} +{row.positive_points || 0} ({row.positive_count})</span><span className="px-1.5 py-0.5 rounded-full bg-danger/10 text-danger">{t('negative')} -{row.negative_points || 0} ({row.negative_count})</span>{row.note_count > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700">{t('notes')} {row.note_count}</span>}{row.latest_logs[0]?.behavior?.label && <span className="text-ink/40 truncate">{t('latest')}: {row.latest_logs[0].behavior.label}</span>}{row.latest_note && <span className="behavior-latest-note" title={row.latest_note}>ملاحظة: {row.latest_note_label ? `${row.latest_note_label} — ` : ''}{row.latest_note}</span>}</span></span>
                  <Icon name={openStudent === student.id ? 'chevronUp' : 'chevronDown'} className="w-4 h-4 text-ink/40 shrink-0" />
                </button>
                {openStudent === student.id && (
                  <div className="px-3 pb-3 pt-1 border-t border-line bg-surface/50">
                    <p className="text-xs text-ink/50 mb-2">{t('clickBehavior', '', { name: student.full_name })}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">{types.map((type) => (
                      <div key={type.id} className="flex items-stretch gap-1 min-w-0">
                        <button type="button" onClick={() => logBehavior(student.id, type.id)} className={`min-w-0 flex-1 px-3 py-2 rounded-xl2 text-sm font-medium border flex items-center justify-center gap-2 ${type.polarity === 'positive' ? 'border-primary/40 text-primary hover:bg-primary/10' : 'border-danger/40 text-danger hover:bg-danger/10'}`}><Icon name={type.icon} className="w-4 h-4 shrink-0" /><span className="truncate">{type.label} ({type.points > 0 ? '+' : ''}{type.points})</span></button>
                        {!Number(type.is_default) && <div className="flex flex-col gap-1 shrink-0"><button type="button" className="px-1.5 rounded border border-line text-[10px] text-ink/55 hover:text-primary" title={t('editBehaviorType')} onClick={() => { setEditingTypeId(type.id); setEditingType({ label: type.label, polarity: type.polarity, points: Math.abs(Number(type.points || 1)), icon: type.icon || 'star' }); }}>{t('edit')}</button><button type="button" className="px-1.5 rounded border border-line text-danger text-sm leading-none hover:bg-danger/10" title={t('deleteBehaviorType')} onClick={() => deleteType(type)}>×</button></div>}
                      </div>
                    ))}</div>
                    <textarea className="input text-xs behavior-note-input" rows={2} placeholder={t('quickNote')} value={noteDrafts[student.id] || ''} onChange={(event) => setNoteDrafts((drafts) => ({ ...drafts, [student.id]: event.target.value }))} />
                    {row.latest_logs.length > 0 && <div className="mt-3 space-y-1"><p className="text-xs font-bold text-ink/60">{t('latestDetails')}</p>{row.latest_logs.map((log) => <div key={log.id} className="behavior-log-row flex items-start gap-2 text-xs border-b border-line/70 pb-1"><span className={log.behavior?.polarity === 'positive' ? 'text-primary' : 'text-danger'}>{log.behavior?.label || 'سلوك'}</span><span className="text-ink/50 flex-1">{log.note_text || t('noTextNote')}</span><span className="text-ink/30">{formatWhen(log.occurred_at, locale)}</span><button type="button" className="behavior-log-delete" title={t('deleteBehaviorLog')} aria-label={`${t('deleteBehaviorLog')} ${log.behavior?.label || ''}`} onClick={() => void deleteBehaviorLog(log)}>×</button></div>)}</div>}
                    <button className="text-primary text-xs mt-2" onClick={() => setDetailStudentId(student.id)}>{t('fullBehaviorRecord')}</button>
                  </div>
                )}
              </div>
            );
          })}
          {filteredStudents.length === 0 && <p className="behavior-empty-state text-ink/50 text-sm py-4 text-center">{t('noMatchingStudent')}</p>}
          </div>
        </div>
        {editingTypeId && editingType && <form className="behavior-type-editor mt-3 pt-3 border-t border-line space-y-2" onSubmit={(event) => { event.preventDefault(); void updateType(editingTypeId); }}>
          <div className="flex flex-wrap gap-2"><input className="input text-sm flex-1" value={editingType.label} onChange={(event) => setEditingType({ ...editingType, label: event.target.value })} aria-label={t('behaviorName')} required /><select className="input text-sm w-32" value={editingType.polarity} onChange={(event) => setEditingType({ ...editingType, polarity: event.target.value, icon: event.target.value === 'positive' ? 'star' : 'clock' })}><option value="positive">{t('positiveLabel')}</option><option value="negative">{t('negativeLabel')}</option></select><input className="input text-sm w-20" type="number" min="1" step="1" value={editingType.points} onChange={(event) => setEditingType({ ...editingType, points: Number(event.target.value) })} /></div>
          <div className="flex flex-wrap gap-2 items-center">{(editingType.polarity === 'positive' ? POSITIVE_BEHAVIOR_ICONS : NEGATIVE_BEHAVIOR_ICONS).map((icon) => <button key={icon} type="button" onClick={() => setEditingType({ ...editingType, icon })} className={`p-2 rounded-lg border ${editingType.icon === icon ? 'border-primary bg-primary/10' : 'border-line'}`}><Icon name={icon} className="w-4 h-4" /></button>)}<button className="btn-secondary text-sm mr-auto" type="submit">{t('saveBehavior')}</button><button className="text-ink/55 text-sm" type="button" onClick={() => { setEditingTypeId(null); setEditingType(null); }}>{t('cancel')}</button></div>
        </form>}
        {templates.length > 0 && <div className="behavior-template-adoption mt-3 pt-3 border-t border-line"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-ink/60">{t('adoptBehaviorTemplate')}</span><select className="input text-sm flex-1 min-w-[12rem]" value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} aria-label={t('selectBehaviorTemplate')}><option value="">{t('selectBehaviorTemplate')}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.label} ({template.points > 0 ? '+' : ''}{template.points})</option>)}</select><button className="btn-secondary text-sm" type="button" onClick={() => void applyTemplate()} disabled={!selectedTemplateId}>{t('applyBehaviorTemplate')}</button></div></div>}
        {showTypeForm && <div className="behavior-custom-modal-backdrop" role="presentation"><section className="behavior-custom-modal" role="dialog" aria-modal="true" aria-labelledby="behavior-custom-title"><header className="behavior-custom-modal__header"><div><span>{t('behaviorEntryLabel')}</span><h3 id="behavior-custom-title">{t('addCustomBehavior')}</h3></div><button type="button" className="behavior-custom-modal__close" onClick={() => setShowTypeForm(false)} aria-label={t('cancel')} title={t('cancel')}>×</button></header><form onSubmit={addType} className="behavior-custom-modal__body"><label className="behavior-modal-field"><span>{t('behaviorName')}</span><input className="input text-sm" placeholder={t('behaviorName')} required autoFocus value={newType.label} onChange={(event) => setNewType({ ...newType, label: event.target.value })} /></label><div className="behavior-modal-row"><label className="behavior-modal-field"><span>{t('behaviorPolarity')}</span><select className="input text-sm" value={newType.polarity} onChange={(event) => setNewType({ ...newType, polarity: event.target.value, icon: event.target.value === 'positive' ? 'star' : 'clock' })}><option value="positive">{t('positiveLabel')}</option><option value="negative">{t('negativeLabel')}</option></select></label><label className="behavior-modal-field"><span>{t('behaviorPoints')}</span><input className="input text-sm" type="number" min="1" step="1" value={newType.points} onChange={(event) => setNewType({ ...newType, points: Number(event.target.value) })} /></label></div><div className="behavior-modal-icons"><span>{t('behaviorIcon')}</span><div>{iconOptions.map((icon) => <button key={icon} type="button" onClick={() => setNewType({ ...newType, icon })} className={`behavior-modal-icon ${newType.icon === icon ? 'is-selected' : ''}`} aria-label={icon} title={icon}><Icon name={icon} className="w-4 h-4" /></button>)}</div></div><div className="behavior-modal-actions"><button className="btn-secondary text-sm" type="button" onClick={() => setShowTypeForm(false)}>{t('cancel')}</button><button className="btn-primary text-sm" type="submit"><Icon name="check" className="w-4 h-4" />{t('saveBehavior')}</button></div></form></section></div>}
      </div>
      <StudentDetailModal studentId={detailStudentId} onClose={() => setDetailStudentId(null)} />
    </div>
  );
}
