import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { invalidateApiCache } from '../api/client';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, scheduleBackgroundSync } from '../utils/snapshotSync.js';
import { buildGradeMap, calculateAssessmentCoverage, getCategoryAssessments, getClassData, buildClassRoster } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import TrialBanner from '../components/TrialBanner.jsx';
import Icon from '../components/Icon.jsx';
import NotificationBell from '../components/NotificationBell.jsx';
import { useConfirmDialog } from '../components/ConfirmDialog.jsx';
import { APP_NAME } from '../constants.js';

const COLORS = ['#2E7D6B', '#E0A548', '#3F6FB0', '#C1553D', '#7A5CA1', '#3F9C86'];
const EMPTY_FORM = { name: '', subject: '', academic_year: '', color: COLORS[0] };

const VISUAL_LABELS = ['كتب وتعلّم', 'متابعة وتقدّم', 'نشاط وتطبيق'];

function localId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function classVisualIndex(classData) {
  const value = String(classData.id || classData.name || 'class');
  return Math.abs([...value].reduce((hash, char) => hash + char.charCodeAt(0), 0)) % VISUAL_LABELS.length;
}

function cardForClass(snapshot, classData) {
  const { students, categories } = getClassData(snapshot, classData.id);
  const roster = buildClassRoster(snapshot, classData.id);
  const gradeMap = buildGradeMap(snapshot);
  const grading = categories.flatMap((category) => (
    getCategoryAssessments(category).map((assessment) => calculateAssessmentCoverage(category, assessment, students, gradeMap))
  ));
  const ordered = [...roster].sort((a, b) => b.behaviorScore - a.behaviorScore);
  const sessionsToday = (snapshot.attendance_sessions || []).filter((session) => session.class_id === classData.id && session.session_date === new Date().toISOString().slice(0, 10));
  const attendance_marked_today = sessionsToday.some((session) => (snapshot.attendance_records || []).some((record) => record.session_id === session.id));
  return { ...classData, student_count: students.length, quick_stats: { grading, behavior: ordered.length ? { best: { student_id: ordered[0].student_id, full_name: ordered[0].full_name, points: ordered[0].behaviorScore }, worst: ordered.length > 1 ? { student_id: ordered[ordered.length - 1].student_id, full_name: ordered[ordered.length - 1].full_name, points: ordered[ordered.length - 1].behaviorScore } : null } : null, attendance_marked_today } };
}

function gradingPillClasses(percent) {
  if (percent === null) return 'bg-ink/5 text-ink/40';
  if (percent >= 100) return 'bg-primary/15 text-primary';
  if (percent > 0) return 'bg-accent/15 text-accent';
  return 'bg-ink/5 text-ink/40';
}

// Compact "بطاقة الصف" stats: how much of each visible assessment has been recorded,
// who's leading/needs support on behavior, and whether today's attendance was taken.
function ClassQuickStats({ stats }) {
  const { t } = useLocale();
  if (!stats) return null;
  const { grading = [], behavior, attendance_marked_today } = stats;

  return (
    <div className="class-card__stats">
      {grading.length > 0 && (
        <div className="class-card__pills">
              {grading.map((g) => (
            <span key={g.assessment_id} className={`class-stat-pill ${gradingPillClasses(g.percent)}`} title={`${g.category_name} · ${t('weight')} ${g.max_score}%`}>
              <strong>{g.title}</strong><b>{g.percent === null ? '—' : `${g.percent}%`}</b><small>{g.entered_count}/{g.total_students} · {t('weight')} {g.max_score}%</small>
            </span>
          ))}
        </div>
      )}

      {behavior && (
        <div className="class-card__behavior">
          <span><span className="status-dot status-dot--good" />{behavior.best.full_name} ({behavior.best.points > 0 ? '+' : ''}{behavior.best.points})</span>
          {behavior.worst && <span><span className="status-dot status-dot--bad" />{behavior.worst.full_name} ({behavior.worst.points > 0 ? '+' : ''}{behavior.worst.points})</span>}
        </div>
      )}

      <div className={`class-card__attendance ${attendance_marked_today ? 'is-marked' : ''}`}>
        <Icon name={attendance_marked_today ? 'check' : 'clock'} className="w-3.5 h-3.5" />
        <span>{attendance_marked_today ? t('attendanceMarkedToday') : t('attendanceNotMarked')}</span>
      </div>
    </div>
  );
}

function ArchivedClassesPanel({ onClose, onRestored }) {
  const { t } = useLocale();
  const [archived, setArchived] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const snapshot = await getOrSyncSnapshot(getTeacherId());
      const students = snapshot?.students || [];
      setArchived((snapshot?.classes || [])
        .filter((classData) => Number(classData.archived) === 1)
        .map((classData) => ({
          ...classData,
          student_count: students.filter((student) => student.class_id === classData.id && !student.archived).length,
        })));
    } catch {
      setArchived([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const restore = async (id) => {
    const teacherId = getTeacherId();
    const snapshot = await getOrSyncSnapshot(teacherId);
    const nextSnapshot = {
      ...snapshot,
      classes: (snapshot?.classes || []).map((classData) => classData.id === id ? { ...classData, archived: 0 } : classData),
    };
    await saveSnapshot(teacherId, nextSnapshot);
    await invalidateApiCache('/classes');
    await invalidateApiCache(`/classes/${id}`);
    await load();
    onRestored?.();
    try {
      await api.post(`/classes/${id}/restore`);
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: `/classes/${id}/restore` });
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl2 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-line flex items-center justify-between">
          <h3 className="font-bold text-lg">{t('archivedClassesTitle')}</h3>
          <button className="text-ink/50 text-xl" onClick={onClose}>×</button>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-ink/50 text-sm">{t('appLoading')}</p>
          ) : archived.length === 0 ? (
            <p className="text-ink/50 text-sm text-center py-6">{t('noArchived')}</p>
          ) : (
            <div className="space-y-2">
              {archived.map((c) => (
                <div key={c.id} className="flex items-center justify-between border border-line rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg" style={{ background: c.color }} />
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-ink/50">{t('studentsCount', '', { count: c.student_count })}</p>
                    </div>
                  </div>
                    <button className="btn-secondary text-xs flex items-center gap-1" onClick={() => restore(c.id)}>
                    <Icon name="restore" className="w-3.5 h-3.5" /> {t('restore')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { teacher, logout } = useAuth();
  const { t, direction, locale } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [completionFilter, setCompletionFilter] = useState('all');
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [saveState, setSaveState] = useState('idle');
  const [expandedClasses, setExpandedClasses] = useState({});

  const load = async () => {
    setLoading(true);
    const data = await getOrSyncSnapshot(getTeacherId());
    setClasses((data?.classes || []).filter((classData) => !classData.archived).map((classData) => cardForClass(data, classData)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  const subjects = [...new Set(classes.map((classData) => classData.subject).filter(Boolean))];
  const years = [...new Set(classes.map((classData) => classData.academic_year).filter(Boolean))];
  const visibleClasses = classes.filter((classData) => {
    const needle = searchTerm.trim().toLocaleLowerCase();
    const matchesSearch = !needle || `${classData.name} ${classData.subject || ''} ${classData.academic_year || ''}`.toLocaleLowerCase().includes(needle);
    const matchesSubject = subjectFilter === 'all' || classData.subject === subjectFilter;
    const matchesYear = yearFilter === 'all' || classData.academic_year === yearFilter;
    const coverage = classData.quick_stats?.grading || [];
    const averageCoverage = coverage.length ? coverage.reduce((sum, item) => sum + (item.percent || 0), 0) / coverage.length : 0;
    const matchesCompletion = completionFilter === 'all'
      || (completionFilter === 'complete' && averageCoverage >= 100)
      || (completionFilter === 'progress' && averageCoverage > 0 && averageCoverage < 100)
      || (completionFilter === 'empty' && averageCoverage === 0);
    return matchesSearch && matchesSubject && matchesYear && matchesCompletion;
  });

  const startAdd = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); };
  const startEdit = (e, c) => {
    e.preventDefault(); e.stopPropagation();
    setForm({ name: c.name, subject: c.subject || '', academic_year: c.academic_year || '', color: c.color });
    setEditingId(c.id);
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const teacherId = getTeacherId();
    const isEditing = Boolean(editingId);
    const classId = editingId || localId('class');
    const formPayload = { name: form.name.trim(), subject: form.subject.trim(), academic_year: form.academic_year.trim(), color: form.color };
    const payload = isEditing ? formPayload : { id: classId, ...formPayload };
    const next = await getOrSyncSnapshot(teacherId);
    const now = new Date().toISOString();
    const existingClass = (next.classes || []).find((item) => item.id === classId);
    const localClass = { ...(existingClass || {}), id: classId, teacher_id: teacherId, ...formPayload, archived: 0, created_at: existingClass?.created_at || now, updated_at: now };
    const defaultCategories = [
      ['مشاركة', 10], ['واجبات منزلية', 15], ['اختبارات قصيرة', 20], ['مشروع', 15], ['اختبار نهائي', 40],
    ];
    const localCategories = defaultCategories.map(([name, weight_percent], index) => ({ id: localId('category'), class_id: classId, name, weight_percent, grading_type: 'numeric', grading_mode: 'direct', sort_order: index, created_at: now }));
    const localAssessments = localCategories.map((category) => ({ id: localId('assessment'), category_id: category.id, title: category.name, max_score: category.weight_percent, is_summary: 1, date: null, created_at: now }));
    const behaviorDefaults = [
      ['مشاركة متميزة', 'positive', 2, 'star'], ['إحضار الأدوات', 'positive', 1, 'check'], ['مساعدة زميل', 'positive', 1, 'heart'],
      ['تأخر عن الحصة', 'negative', -1, 'clock'], ['إزعاج الصف', 'negative', -2, 'alert'], ['عدم إحضار الواجب', 'negative', -1, 'x'],
    ].map(([label, polarity, points, icon]) => ({ id: localId('behavior-type'), class_id: classId, label, polarity, points, icon, is_default: 1 }));
    const nextClasses = isEditing
      ? (next.classes || []).some((item) => item.id === classId)
        ? (next.classes || []).map((item) => item.id === classId ? localClass : item)
        : [...(next.classes || []), localClass]
      : [...(next.classes || []), localClass];
    const nextSnapshot = isEditing ? { ...next, classes: nextClasses } : {
      ...next,
      classes: nextClasses,
      grade_categories: [...(next.grade_categories || []), ...localCategories],
      assessments: [...(next.assessments || []), ...localAssessments],
      behavior_types: [...(next.behavior_types || []), ...behaviorDefaults],
    };
    await saveSnapshot(teacherId, nextSnapshot);
    setClasses(nextClasses.filter((item) => !item.archived).map((item) => cardForClass(nextSnapshot, item)));
    setSaveState('saving');
    setForm(EMPTY_FORM); setShowForm(false); setEditingId(null);
    try {
      const response = isEditing ? await api.patch(`/classes/${classId}`, formPayload) : await api.post('/classes', payload);
      const serverClass = response?.data?.class;
      const serverSnapshot = serverClass
        ? { ...nextSnapshot, classes: nextSnapshot.classes.map((item) => item.id === classId ? { ...item, ...serverClass } : item) }
        : nextSnapshot;
      await saveSnapshot(teacherId, serverSnapshot);
      setClasses(serverSnapshot.classes.filter((item) => !item.archived).map((item) => cardForClass(serverSnapshot, item)));
      await invalidateApiCache('/classes');
      await invalidateApiCache(`/classes/${classId}`);
      // The PATCH response is authoritative for this edit. Do not immediately
      // force a snapshot GET here: on Turso a read can briefly lag behind the
      // write and would overwrite the freshly saved local-first value.
      await load();
      setSaveState('saved');
    } catch {
      await queueMutation(teacherId, { method: isEditing ? 'PATCH' : 'POST', url: isEditing ? `/classes/${classId}` : '/classes', data: payload });
      setSaveState('queued');
      await load();
    } finally {
      window.setTimeout(() => setSaveState('idle'), 2500);
    }
  };

  const archiveClass = async (e, id) => {
    e.preventDefault(); e.stopPropagation();
    const accepted = await confirm({ title: t('archiveClass'), message: t('confirmArchive'), confirmLabel: t('archive'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    const teacherId = getTeacherId();
    const snapshot = await getOrSyncSnapshot(teacherId);
    await saveSnapshot(teacherId, { ...snapshot, classes: (snapshot.classes || []).map((item) => item.id === id ? { ...item, archived: 1, updated_at: new Date().toISOString() } : item) });
    await invalidateApiCache('/classes');
    await invalidateApiCache(`/classes/${id}`);
    await load();
    try { await api.delete(`/classes/${id}`); scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 }); } catch { await queueMutation(teacherId, { method: 'DELETE', url: `/classes/${id}` }); }
  };

  const deleteClassPermanently = async (e, id) => {
    e.preventDefault(); e.stopPropagation();
    const accepted = await confirm({ title: t('deleteClass'), message: t('confirmDeleteClass'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    const teacherId = getTeacherId();
    const snapshot = await getOrSyncSnapshot(teacherId);
    const studentIds = new Set((snapshot.students || []).filter((student) => student.class_id === id).map((student) => student.id));
    const categoryIds = new Set((snapshot.grade_categories || []).filter((category) => category.class_id === id).map((category) => category.id));
    const assessmentIds = new Set((snapshot.assessments || []).filter((assessment) => categoryIds.has(assessment.category_id)).map((assessment) => assessment.id));
    const behaviorTypeIds = new Set((snapshot.behavior_types || []).filter((type) => type.class_id === id).map((type) => type.id));
    const sessionIds = new Set((snapshot.attendance_sessions || []).filter((session) => session.class_id === id).map((session) => session.id));
    const nextSnapshot = {
      ...snapshot,
      classes: (snapshot.classes || []).filter((item) => item.id !== id),
      students: (snapshot.students || []).filter((student) => !studentIds.has(student.id)),
      grade_categories: (snapshot.grade_categories || []).filter((category) => !categoryIds.has(category.id)),
      assessments: (snapshot.assessments || []).filter((assessment) => !assessmentIds.has(assessment.id)),
      grades: (snapshot.grades || []).filter((grade) => !assessmentIds.has(grade.assessment_id)),
      behavior_types: (snapshot.behavior_types || []).filter((type) => !behaviorTypeIds.has(type.id)),
      behavior_logs: (snapshot.behavior_logs || []).filter((log) => !studentIds.has(log.student_id) && !behaviorTypeIds.has(log.behavior_type_id)),
      attendance_sessions: (snapshot.attendance_sessions || []).filter((session) => !sessionIds.has(session.id)),
      attendance_records: (snapshot.attendance_records || []).filter((record) => !sessionIds.has(record.session_id) && !studentIds.has(record.student_id)),
    };
    await saveSnapshot(teacherId, nextSnapshot);
    await invalidateApiCache('/classes');
    await invalidateApiCache(`/classes/${id}`);
    await load();
    try { await api.delete(`/classes/${id}?permanent=1`); scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 }); } catch { await queueMutation(teacherId, { method: 'DELETE', url: `/classes/${id}?permanent=1` }); }
  };

  const initials = (teacher?.full_name || 'س').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const hasFilters = Boolean(searchTerm || subjectFilter !== 'all' || yearFilter !== 'all' || completionFilter !== 'all');
  const toggleClassDetails = (classId) => setExpandedClasses((current) => ({ ...current, [classId]: !current[classId] }));

  return (
    <div className="dashboard-shell" dir={direction}>
      {confirmDialog}
      <div className="dashboard-topbar">
        <div className="brand-lockup">
          <div className="brand-mark brand-mark--image"><img src="/educore-logo.webp" alt="EduCore" /></div>
          <div>
            <div className="brand-title">{APP_NAME}</div>
            <div className="brand-subtitle">{t('appSubtitle')}</div>
          </div>
        </div>
        <label className="dashboard-search" aria-label={t('searchClasses')}>
          <Icon name="search" className="w-4 h-4" />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('searchClasses')} />
          <kbd>⌘ K</kbd>
        </label>
        <div className="dashboard-utilities">
          <span className={`offline-chip ${isOnline ? 'is-online' : ''}`}><span className="offline-dot" />{isOnline ? t('online') : t('offlineMode')}</span>
          <span className="utility-date">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span>
          <nav className="dashboard-nav-actions" aria-label={locale === 'ar' ? 'إجراءات الحساب' : 'Account actions'}>
            <NotificationBell />
            <Link to="/subscription" className="topbar-icon-action" aria-label={t('subscription')} title={t('subscription')}><Icon name="subscription" className="w-5 h-5" /></Link>
            <Link to="/settings" className="topbar-icon-action" aria-label={t('settings')} title={t('settings')}><Icon name="settings" className="w-5 h-5" /></Link>
            <button type="button" className="topbar-icon-action topbar-icon-action--danger" onClick={logout} aria-label={t('logout')} title={t('logout')}><Icon name="logout" className="w-5 h-5" /></button>
          </nav>
          <span className="teacher-avatar" title={teacher?.full_name || 'المعلم'}>{initials}</span>
        </div>
      </div>

      <main className="dashboard-content">
        <section className="dashboard-hero">
          <div>
            <span className="eyebrow">{t('teacherBoard')}</span>
            <h1>{t('smartRecord')}</h1>
            <p>{t('helloTeacher', '', { name: teacher?.full_name || (locale === 'ar' ? 'معلمنا العزيز' : 'teacher') })}</p>
          </div>
          <div className="hero-note">
            <span className="hero-note__mark">✓</span>
            <div><strong>{t('localDataSaved')}</strong><span>{isOnline ? t('syncBackground') : t('continueOffline')}</span></div>
          </div>
        </section>

        <TrialBanner />

        <div className="dashboard-section-head">
              <div>
            <span className="eyebrow">{t('workspace')}</span>
            <h2>{t('myClasses')}</h2>
          </div>
          <div className="dashboard-actions">
            {saveState === 'saving' && <span className="save-feedback">{t('savingEdit')}</span>}
            {saveState === 'saved' && <span className="save-feedback save-feedback--success">{t('savedEdit')}</span>}
            {saveState === 'queued' && <span className="save-feedback">{t('savedLocallyQueued')}</span>}
            <button className="btn-secondary action-button" onClick={() => setShowArchived(true)}><Icon name="archive" className="w-4 h-4" /> {t('archivedClasses')}</button>
            <button className="btn-primary action-button" onClick={startAdd}><span className="action-plus">+</span> {t('newClass')}</button>
          </div>
        </div>

        <section className="dashboard-filters" aria-label="بحث وفلاتر الصفوف">
          <div className="dashboard-filter-search"><Icon name="search" className="w-4 h-4" /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('searchClassesQuick')} /></div>
          <label className="dashboard-filter-select"><span>{t('subject')}</span><select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="all">{t('allSubjects')}</option>{subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></label>
          <label className="dashboard-filter-select"><span>{t('academicYear')}</span><select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}><option value="all">{t('allYears')}</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label className="dashboard-filter-select"><span>{t('gradingStatus')}</span><select value={completionFilter} onChange={(event) => setCompletionFilter(event.target.value)}><option value="all">{t('allStatuses')}</option><option value="complete">{t('complete')}</option><option value="progress">{t('inProgress')}</option><option value="empty">{t('notStarted')}</option></select></label>
          {hasFilters && <button type="button" className="filter-reset" onClick={() => { setSearchTerm(''); setSubjectFilter('all'); setYearFilter('all'); setCompletionFilter('all'); }}><Icon name="refresh" className="w-3.5 h-3.5" /> {t('clear')}</button>}
          <span className="filter-result-count">{t('classCount', '', { visible: visibleClasses.length, total: classes.length })}</span>
        </section>

        {showForm && (
          <form onSubmit={submit} className="surface-panel create-class-form">
            <div className="create-class-form__heading"><div><span className="eyebrow">{t('setupNew')}</span><h3>{editingId ? t('editClass') : t('createClass')}</h3></div><button type="button" className="utility-icon" onClick={() => { setShowForm(false); setEditingId(null); }} aria-label={t('cancel')}>×</button></div>
            <div className="create-class-form__grid">
              <div><label className="label">{t('className')}</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={locale === 'ar' ? 'مثال: الصف الثامن - أ' : 'e.g. Grade 8 - A'} /></div>
              <div><label className="label">{t('subject')}</label><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder={locale === 'ar' ? 'مثال: الرياضيات' : 'e.g. Mathematics'} /></div>
              <div><label className="label">{t('academicYear')}</label><input className="input" value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="2025-2026" /></div>
              <div><label className="label">{t('accentColor')}</label><div className="color-picker">{COLORS.map((c) => <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className={`color-swatch ${form.color === c ? 'is-selected' : ''}`} style={{ background: c }} aria-label={`اختيار اللون ${c}`} />)}</div></div>
            </div>
            <div className="create-class-form__actions"><button className="btn-primary action-button" type="submit" disabled={saveState === 'saving'}>{saveState === 'saving' ? t('saving') : editingId ? t('saveChanges') : t('createClass')}</button><button className="btn-secondary action-button" type="button" onClick={() => { setShowForm(false); setEditingId(null); }}>{t('cancel')}</button>{saveState === 'saved' && <span className="save-feedback save-feedback--success">{t('saved')}</span>}{saveState === 'queued' && <span className="save-feedback">{t('savedLocallyQueued')}</span>}</div>
          </form>
        )}

        {loading ? (
          <div className="class-grid">{[1, 2, 3].map((item) => <div className="class-card class-card--skeleton" key={item}><div className="skeleton-block" /><div className="skeleton-line skeleton-line--long" /><div className="skeleton-line" /></div>)}</div>
        ) : classes.length === 0 ? (
          <div className="empty-state"><div className="empty-state__icon">＋</div><h3>{t('noClasses')}</h3><p>{t('noClassesText')}</p><button className="btn-primary action-button" onClick={startAdd}>{t('createClass')}</button></div>
        ) : visibleClasses.length === 0 ? (
          <div className="empty-state"><div className="empty-state__icon">⌕</div><h3>{t('noResults')}</h3><p>{t('noResultsText')}</p></div>
        ) : (
          <div className="class-grid">
            {visibleClasses.map((c) => {
              const visualIndex = classVisualIndex(c);
              const accent = c.color || COLORS[visualIndex];
              const expanded = Boolean(expandedClasses[c.id]);
              return (
                <article key={c.id} className={`class-card ${expanded ? 'is-expanded' : ''}`} style={{ '--card-accent': accent }}>
                  <div className="class-card__compact">
                    <Link to={`/classes/${c.id}`} className="class-card__compact-main" aria-label={`${t('openClass')}: ${c.name}`}>
                      <span className="class-card__accent-dot" style={{ background: accent }} aria-hidden="true" />
                      <span className="class-card__compact-copy"><strong>{c.name}</strong><small>{t('studentsCount', '', { count: c.student_count })}</small></span>
                    </Link>
                    <div className="class-card__compact-actions">
                      <Link to={`/classes/${c.id}`} className="class-card__compact-open" aria-label={`${t('openClass')}: ${c.name}`} title={t('openClass')}>
                        <Icon name="externalLink" className="w-4 h-4" /><span>{t('openClass')}</span>
                      </Link>
                      <button type="button" className="class-card__details-toggle" onClick={() => toggleClassDetails(c.id)} aria-expanded={expanded} aria-controls={`class-details-${c.id}`}>
                        <span>{expanded ? t('showLess') : t('details')}</span><Icon name={expanded ? 'chevronUp' : 'chevronDown'} className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {expanded && <div id={`class-details-${c.id}`} className="class-card__content">
                    <div className="class-card__detail-grid">
                      <div><span>{t('subject')}</span><strong>{c.subject || t('noSubject')}</strong></div>
                      <div><span>{t('academicYear')}</span><strong>{c.academic_year || '—'}</strong></div>
                      <div><span>{t('assessmentsCount', '', { count: c.quick_stats?.grading?.length || 0 })}</span><strong>{c.quick_stats?.grading?.filter((item) => item.percent !== null && item.percent > 0).length || 0}</strong></div>
                    </div>
                    <ClassQuickStats stats={c.quick_stats} />
                    <div className="class-card__footer">
                      <Link to={`/classes/${c.id}`} className="class-card__open"><Icon name="externalLink" className="w-4 h-4" /><span>{t('openClass')}</span><span>{locale === 'ar' ? '←' : '→'}</span></Link>
                      <div className="class-card__actions">
                        <button className="class-card__icon-action" onClick={(e) => startEdit(e, c)} title={t('editClass')} aria-label={t('editClass')}><Icon name="edit" className="w-4 h-4" /><span>{locale === 'ar' ? 'تعديل' : 'Edit'}</span></button>
                        <button className="class-card__icon-action" onClick={(e) => archiveClass(e, c.id)} title={t('archiveClass')} aria-label={t('archiveClass')}><Icon name="archive" className="w-4 h-4" /><span>{t('archiveClass')}</span></button>
                        <button className="class-card__icon-action class-card__icon-action--danger" onClick={(e) => deleteClassPermanently(e, c.id)} title={t('deleteClass')} aria-label={t('deleteClass')}><Icon name="trash" className="w-4 h-4" /><span>{t('deleteClass')}</span></button>
                      </div>
                    </div>
                  </div>}
                </article>
              );
            })}
          </div>
        )}
      </main>

      {showArchived && <ArchivedClassesPanel onClose={() => setShowArchived(false)} onRestored={load} />}
    </div>
  );
}
