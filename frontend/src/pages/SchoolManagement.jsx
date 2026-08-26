import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getLocalFirst } from '../api/client';
import { getTeacherId } from '../utils/localCache.js';
import { getLastSync, syncTeacherData } from '../utils/snapshotSync.js';
import Icon from '../components/Icon.jsx';
import LoadingOverlay from '../components/LoadingOverlay.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

const CLASS_COLORS = ['#2E7D6B', '#E0A548', '#3F6FB0', '#C1553D', '#7A5CA1', '#3F9C86', '#2C8D9A', '#B05C78', '#6B7280', '#D27A2E'];
const EMPTY_CLASS_FORM = { name: '', subjects: '', academic_year: '', color: CLASS_COLORS[0] };
const EMPTY_STUDENT_FORM = { full_name: '', student_number: '' };

const MANAGER_TABS = [
  { id: 'classes', icon: 'school', key: 'schoolTabClasses' },
  { id: 'teachers', icon: 'users', key: 'schoolTabTeachers' },
  { id: 'assignments', icon: 'link', key: 'schoolTabAssignments' },
  { id: 'roster', icon: 'user', key: 'schoolTabRoster' },
  { id: 'attendance', icon: 'check', key: 'schoolTabAttendance' },
  { id: 'grades', icon: 'reports', key: 'schoolTabGrades' },
  { id: 'behavior', icon: 'heart', key: 'schoolTabBehavior' },
  { id: 'reports', icon: 'fileCheck', key: 'schoolTabReports' },
  { id: 'analytics', icon: 'analytics', key: 'schoolTabAnalytics' },
];

const TEACHER_TABS = [
  { id: 'classes', icon: 'school', key: 'schoolTabClasses' },
  { id: 'assignments', icon: 'link', key: 'schoolTabAssignments' },
];

function displayDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function displayDateTime(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale === 'ar' ? 'ar' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
}

function presentCount(session) {
  return Math.max(0, Number(session.record_count || 0) - Number(session.absent_count || 0) - Number(session.late_count || 0) - Number(session.excused_count || 0));
}

function apiMessage(error, t) {
  const code = error?.response?.data?.code;
  const messages = {
    ASSIGNMENT_CODE_INVALID: 'schoolCodeInvalid',
    ASSIGNMENT_SUBJECT_MISMATCH: 'schoolSubjectMismatch',
    SCHOOL_MANAGER_REQUIRED: 'schoolManagerOnly',
    SCHOOL_CLASS_STRUCTURE_LOCKED: 'schoolTeacherOperationalNote',
    SCHOOL_SUBJECT_ASSIGNMENT_REQUIRED: 'schoolSubjectAssignmentRequired',
    CLASS_SUBJECT_REQUIRED: 'schoolClassSubjectsHint',
    CLASS_SUBJECT_EXISTS: 'schoolSubjectAlreadyExists',
    STUDENT_DUPLICATE: 'schoolStudentDuplicate',
    STUDENT_NAME_REQUIRED: 'schoolStudentNameRequired',
    INVALID_CLASS_NAME: 'schoolClassNameRequired',
  };
  return messages[code] ? t(messages[code]) : t('schoolActionError');
}

function Metric({ icon, label, value }) {
  return <div className="school-shell__metric"><span className="school-shell__metric-icon"><Icon name={icon} className="w-4 h-4" /></span><span>{label}</span><strong>{value ?? 0}</strong></div>;
}

function EmptyState({ icon = 'school', title, description }) {
  return <div className="school-shell__empty"><span className="school-shell__empty-icon"><Icon name={icon} className="w-6 h-6" /></span><strong>{title}</strong>{description && <p>{description}</p>}</div>;
}

function SectionHeader({ icon, title, description, action }) {
  return <div className="school-shell__section-title"><span className="school-shell__section-icon"><Icon name={icon} className="w-5 h-5" /></span><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

function SubjectRow({ subject, isManager, busy, onGenerate, onRevoke, t }) {
  return <div className="school-shell__subject-row">
    <div className="school-shell__subject-main"><span className="school-shell__subject-icon"><Icon name="book" className="w-4 h-4" /></span><div><strong>{subject.subject_label || subject.subject_key}</strong><span>{subject.assigned_teacher_name || t('schoolNoTeacher')}</span></div></div>
    <div className="school-shell__subject-actions">
      {subject.assigned_teacher_name && <span className="school-shell__teacher-chip"><Icon name="user" className="w-3.5 h-3.5" />{subject.assigned_teacher_name}</span>}
      {isManager && subject.assignment_id && <button type="button" className="utility-icon utility-icon--danger" onClick={() => onRevoke(subject)} disabled={busy} aria-label={t('schoolRevokeAssignment')} title={t('schoolRevokeAssignment')}><Icon name="x" className="w-4 h-4" /></button>}
      {isManager && <button type="button" className="school-shell__code-button" onClick={() => onGenerate(subject)} disabled={busy}><Icon name="lock" className="w-4 h-4" />{t('schoolGenerateCode')}</button>}
    </div>
  </div>;
}

function SchoolDataHeader({ title, description, classes, selectedClassId, onSelect, onRefresh, loading, t }) {
  return <div className="school-shell__data-header"><div><span className="school-shell__eyebrow">{t('schoolManagerWorkspace')}</span><h2>{title}</h2>{description && <p>{description}</p>}</div><div className="school-shell__data-tools"><label><span>{t('schoolChooseClass')}</span><select value={selectedClassId} onChange={(event) => onSelect(event.target.value)}><option value="">{t('schoolAllSchool')}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="utility-icon" onClick={onRefresh} disabled={loading} aria-label={t('refresh')} title={t('refresh')}><Icon name="refresh" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div>;
}

export default function SchoolManagement() {
  const { teacher } = useAuth();
  const { t, locale, direction } = useLocale();
  const [schools, setSchools] = useState([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [school, setSchool] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('classes');
  const [assignmentCode, setAssignmentCode] = useState('');
  const [classForm, setClassForm] = useState(EMPTY_CLASS_FORM);
  const [showClassForm, setShowClassForm] = useState(false);
  const [subjectDrafts, setSubjectDrafts] = useState({});
  const [visibleCode, setVisibleCode] = useState(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [roster, setRoster] = useState([]);
  const [studentForm, setStudentForm] = useState(EMPTY_STUDENT_FORM);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [classQuery, setClassQuery] = useState('');
  const [editingClassId, setEditingClassId] = useState('');
  const [classEditForm, setClassEditForm] = useState({ name: '', academic_year: '', color: '' });
  const [reportMode, setReportMode] = useState('class');
  const [reportClassId, setReportClassId] = useState('');
  const [reportStudentId, setReportStudentId] = useState('');
  const [dataClassId, setDataClassId] = useState('');

  const selectedMembership = school?.membership;
  const isManager = teacher?.account_role === 'school_manager' && selectedMembership?.role === 'school_admin';
  const tabs = isManager ? MANAGER_TABS : TEACHER_TABS;
  const schoolClasses = school?.classes || [];
  const managerClasses = overview?.classes || schoolClasses;
  const sortedClasses = useMemo(() => [...managerClasses].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), locale === 'ar' ? 'ar' : 'en')), [managerClasses, locale]);
  const selectedClass = sortedClasses.find((item) => item.id === selectedClassId) || sortedClasses[0] || null;
  const members = school?.members || [];
  const centralStudents = overview?.students || [];
  const visibleStudents = useMemo(() => {
    const source = centralStudents.length ? centralStudents : roster.map((student) => ({ ...student, class_name: selectedClass?.name || '' }));
    return dataClassId ? source.filter((student) => student.class_id === dataClassId) : source;
  }, [centralStudents, roster, selectedClass?.name, dataClassId]);
  const assignments = useMemo(() => sortedClasses.flatMap((classItem) => (classItem.subjects || []).map((subject) => ({ ...subject, class_id: classItem.id, class_name: classItem.name }))), [sortedClasses]);
  const filteredMembers = useMemo(() => members.filter((member) => `${member.full_name || ''} ${member.email || ''} ${member.subject || ''}`.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en').includes(teacherQuery.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en'))), [members, teacherQuery, locale]);
  const filteredClasses = useMemo(() => sortedClasses.filter((item) => `${item.name || ''} ${item.academic_year || ''}`.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en').includes(classQuery.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en'))), [sortedClasses, classQuery, locale]);
  const selectedReportClass = sortedClasses.find((item) => item.id === reportClassId) || sortedClasses[0] || null;
  const selectedReportStudent = centralStudents.find((student) => student.id === reportStudentId) || centralStudents[0] || null;
  const reportClassIdValue = selectedReportClass?.id || '';
  const reportStudents = reportClassIdValue ? centralStudents.filter((student) => student.class_id === reportClassIdValue) : centralStudents;
  const attendanceToday = overview?.attendance_today || [];
  const grades = overview?.grades || [];
  const behaviors = overview?.behavior_by_student || [];
  const behaviorDetails = overview?.behavior_details || [];

  const setFailure = (requestError) => { setError(apiMessage(requestError, t)); setMessage(''); };

  const loadCentralOverview = async (schoolId) => {
    if (!schoolId) return;
    setOverviewLoading(true);
    try {
      const { data } = await api.get(`/schools/${schoolId}/overview`);
      setOverview(data);
      const nextClassId = data?.classes?.some((item) => item.id === selectedClassId) ? selectedClassId : data?.classes?.[0]?.id || '';
      setSelectedClassId(nextClassId);
      setReportClassId((current) => data?.classes?.some((item) => item.id === current) ? current : data?.classes?.[0]?.id || '');
      setReportStudentId((current) => data?.students?.some((item) => item.id === current) ? current : data?.students?.[0]?.id || '');
    } catch (requestError) {
      if (requestError?.response?.status !== 403) setFailure(requestError);
    } finally { setOverviewLoading(false); }
  };

  const loadSchool = async (schoolId) => {
    if (!schoolId) return;
    try {
      const { data } = await api.get(`/schools/${schoolId}`);
      setSchool(data);
      setSelectedSchoolId(schoolId);
      const nextClasses = data?.classes || [];
      setSelectedClassId((current) => nextClasses.some((item) => item.id === current) ? current : nextClasses[0]?.id || '');
      const managerAccess = teacher?.account_role === 'school_manager' && data?.membership?.role === 'school_admin';
      if (managerAccess) await loadCentralOverview(schoolId); else setOverview(null);
      setError('');
    } catch (requestError) { setFailure(requestError); }
  };

  const loadSchools = async (preferredId = '') => {
    setLoading(true);
    try {
      const response = await getLocalFirst('/schools');
      const items = response?.data?.schools || [];
      setSchools(items);
      const nextId = preferredId || selectedSchoolId || items[0]?.id || '';
      setSelectedSchoolId(nextId);
      if (response?.fromLocalCache) void response.revalidatePromise?.then((freshResponse) => setSchools(freshResponse?.data?.schools || []));
      if (nextId) await loadSchool(nextId); else setSchool(null);
    } catch (requestError) { setFailure(requestError); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadSchools(); void getLastSync(getTeacherId()).then(setLastSyncAt); }, []);

  const syncNow = async ({ silent = false } = {}) => {
    if (syncing) return null;
    const teacherId = getTeacherId();
    setSyncing(true);
    try {
      const result = await syncTeacherData(teacherId);
      setLastSyncAt(await getLastSync(teacherId));
      if (selectedSchoolId) await loadSchool(selectedSchoolId);
      if (!silent) {
        if (result?.successful) setMessage(t('syncCompleted'));
        else if (result?.rejected) setMessage(t('syncCompletedWithRejected', '', { count: result.rejected }));
        else if (result?.blocked) setMessage(t('syncCompletedWithBlocked', '', { count: result.blocked }));
        else setMessage(t('syncFailed'));
      }
      return result;
    } catch {
      if (!silent) setMessage(t('syncFailed'));
      return null;
    } finally { setSyncing(false); }
  };

  const selectTab = (tabId, classId = selectedClass?.id) => {
    setActiveTab(tabId);
    setMessage('');
    setError('');
    if (classId) setSelectedClassId(classId);
    if (tabId !== 'roster') setDataClassId('');
    if (tabId === 'roster' && !centralStudents.length && classId) void loadRoster(classId);
  };

  const loadRoster = async (classId = selectedClass?.id) => {
    if (!isManager || !selectedSchoolId || !classId) return;
    setBusy(`roster:${classId}`);
    try { const { data } = await api.get(`/schools/${selectedSchoolId}/classes/${classId}/students`); setRoster(data.students || []); setSelectedClassId(classId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const acceptAssignment = async (event) => {
    event.preventDefault();
    if (!assignmentCode.trim() || busy) return;
    setBusy('assignment');
    try {
      const { data } = await api.post('/schools/accept-assignment', { code: assignmentCode.trim() });
      setAssignmentCode('');
      await syncNow({ silent: true });
      setMessage(t('schoolAssignmentAccepted'));
      await loadSchools(data?.school?.school?.id || selectedSchoolId);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const createClass = async (event) => {
    event.preventDefault();
    const subjects = classForm.subjects.split(',').map((item) => item.trim()).filter(Boolean);
    if (!selectedSchoolId || busy || !classForm.name.trim()) return;
    setBusy('class');
    try {
      await api.post(`/schools/${selectedSchoolId}/classes`, { ...classForm, subject: subjects[0], subjects });
      setClassForm(EMPTY_CLASS_FORM);
      setShowClassForm(false);
      setMessage(t('schoolClassCreated'));
      await loadSchool(selectedSchoolId);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const addSubject = async (classId) => {
    const subject = String(subjectDrafts[classId] || '').trim();
    if (!subject || busy) return;
    setBusy(`subject:${classId}`);
    try { await api.post(`/schools/${selectedSchoolId}/classes/${classId}/subjects`, { subject_label: subject }); setSubjectDrafts((current) => ({ ...current, [classId]: '' })); setMessage(t('schoolSubjectAdded')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const generateCode = async (classId, subject) => {
    if (busy) return;
    setBusy(`code:${classId}:${subject.subject_key}`);
    try {
      const { data } = await api.post(`/schools/${selectedSchoolId}/classes/${classId}/assignment-code`, { subject_key: subject.subject_key, max_uses: 1, expires_days: 7 });
      const codeData = { ...data, class_name: `${selectedClass?.name || classId} · ${subject.subject_label}` };
      setVisibleCode(codeData);
      setMessage(t('schoolCodeGenerated'));
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const revokeAssignment = async (subject) => {
    if (!subject.assignment_id || busy) return;
    if (!window.confirm(t('schoolRevokeConfirm'))) return;
    setBusy(`revoke:${subject.assignment_id}`);
    try { await api.delete(`/schools/${selectedSchoolId}/assignments/${subject.assignment_id}`); setMessage(t('schoolAssignmentRevoked')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const openCreateClass = () => { setClassForm({ ...EMPTY_CLASS_FORM }); setShowClassForm(true); };
  const beginEditClass = (classItem) => { setEditingClassId(classItem.id); setClassEditForm({ name: classItem.name || '', academic_year: classItem.academic_year || '', color: classItem.color || CLASS_COLORS[0] }); };

  const saveClassEdit = async (event, classId) => {
    event.preventDefault();
    if (!classEditForm.name.trim() || busy) return;
    setBusy(`edit-class:${classId}`);
    try { await api.patch(`/schools/${selectedSchoolId}/classes/${classId}`, classEditForm); setEditingClassId(''); setMessage(t('schoolClassUpdated')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const archiveClass = async (classId) => {
    if (busy || !window.confirm(t('schoolArchiveClassConfirm'))) return;
    setBusy(`archive-class:${classId}`);
    try { await api.post(`/schools/${selectedSchoolId}/classes/${classId}/archive`); setMessage(t('schoolClassArchived')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const addStudent = async (event) => {
    event.preventDefault();
    if (!dataClassId || !studentForm.full_name.trim() || busy) return;
    setBusy('student');
    try { await api.post(`/schools/${selectedSchoolId}/classes/${dataClassId}/students`, studentForm); setStudentForm(EMPTY_STUDENT_FORM); setMessage(t('schoolStudentAdded')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const archiveStudent = async (student) => {
    if (busy || !student?.class_id) return;
    setBusy(`archive-student:${student.id}`);
    try { await api.patch(`/schools/${selectedSchoolId}/classes/${student.class_id}/students/${student.id}/archive`); setMessage(t('schoolStudentArchived')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const restoreStudent = async (student) => {
    if (busy || !student?.class_id) return;
    setBusy(`restore-student:${student.id}`);
    try { await api.patch(`/schools/${selectedSchoolId}/classes/${student.class_id}/students/${student.id}/restore`); setMessage(t('schoolStudentRestored')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const copyCode = async (code) => {
    try { await navigator.clipboard.writeText(code); setMessage(t('schoolCodeCopied')); } catch { setMessage(code); }
  };

  const renderNoSchool = () => <section className="school-shell__setup"><article className="school-shell__setup-card"><span className="school-shell__setup-icon"><Icon name="school" className="w-6 h-6" /></span><div><span className="school-shell__eyebrow">{t('schoolManagementEyebrow')}</span><h2>{t('schoolProvisioningTitle')}</h2><p>{t('schoolProvisioningHint')}</p></div><div className="school-shell__setup-note"><Icon name="secure" className="w-4 h-4" />{t('schoolPersonalClassesNote')}</div></article><form className="school-shell__setup-card school-shell__setup-card--accent" onSubmit={acceptAssignment}><span className="school-shell__setup-icon"><Icon name="lock" className="w-6 h-6" /></span><div><span className="school-shell__eyebrow">{t('schoolTabAssignments')}</span><h2>{t('schoolJoinTitle')}</h2><p>{t('schoolJoinHint')}</p></div><label><span>{t('schoolAssignmentCode')}</span><input value={assignmentCode} onChange={(event) => setAssignmentCode(event.target.value)} placeholder={t('schoolAssignmentCodePlaceholder')} maxLength={40} required /></label><button type="submit" className="btn-primary" disabled={busy === 'assignment'}>{busy === 'assignment' ? t('saving') : t('schoolAcceptAssignment')}</button></form></section>;

  const renderSchoolStats = () => {
    const metrics = overview?.metrics || {
      class_count: sortedClasses.length,
      student_count: sortedClasses.reduce((sum, item) => sum + Number(item.student_count || 0), 0),
      member_count: members.length,
      subject_count: sortedClasses.reduce((sum, item) => sum + Number(item.subject_count || 0), 0),
      grade_entries: 0,
      behavior_entries: 0,
      attendance_records_today: 0,
    };
    return <div className="school-shell__stats"><Metric icon="school" label={t('schoolClasses')} value={metrics.class_count} /><Metric icon="user" label={t('schoolStudents')} value={metrics.student_count} /><Metric icon="users" label={t('schoolMembers')} value={metrics.member_count} /><Metric icon="book" label={t('schoolClassSubjects')} value={metrics.subject_count} /><Metric icon="reports" label={t('schoolGrades')} value={metrics.grade_entries} /><Metric icon="heart" label={t('schoolBehavior')} value={metrics.behavior_entries} /><Metric icon="check" label={t('schoolAttendanceToday')} value={metrics.attendance_records_today} /></div>;
  };

  const renderClassesTab = () => <section className="school-shell__workspace">
    <SectionHeader icon="school" title={t('schoolClassesOverviewTitle')} description={t('schoolClassesOverviewHint')} action={isManager && <button type="button" className="btn-primary" onClick={openCreateClass}><Icon name="plus" className="w-4 h-4" />{t('schoolCreateClass')}</button>} />
    {renderSchoolStats()}
    <div className="school-shell__toolbar"><label className="school-shell__search"><Icon name="search" className="w-4 h-4" /><input value={classQuery} onChange={(event) => setClassQuery(event.target.value)} placeholder={t('schoolSearchClasses')} /></label></div>
    <div className="school-shell__table-card"><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolAcademicYear')}</th><th>{t('schoolStudents')}</th><th>{t('schoolClassSubjects')}</th><th>{t('schoolAssigned')}</th><th>{t('schoolAttendanceToday')}</th><th>{t('schoolActions')}</th></tr></thead><tbody>{filteredClasses.map((classItem) => <tr key={classItem.id}><td><span className="school-shell__class-cell"><span className="school-shell__class-dot" style={{ background: classItem.color || CLASS_COLORS[0] }} /><strong>{classItem.name}</strong></span></td><td>{classItem.academic_year || '—'}</td><td>{classItem.student_count || 0}</td><td>{classItem.subject_count || classItem.subjects?.length || 0}</td><td>{classItem.assigned_teacher_count || 0}</td><td>{classItem.attendance_session_count || 0}</td><td><div className="school-shell__table-actions"><button type="button" className="btn-secondary" onClick={() => selectTab('roster', classItem.id)}><Icon name="user" className="w-3.5 h-3.5" />{t('schoolManageRoster')}</button>{isManager && <><button type="button" className="utility-icon" onClick={() => beginEditClass(classItem)} aria-label={t('schoolEditClass')} title={t('schoolEditClass')}><Icon name="edit" className="w-4 h-4" /></button><button type="button" className="utility-icon utility-icon--danger" onClick={() => void archiveClass(classItem.id)} aria-label={t('schoolArchiveClass')} title={t('schoolArchiveClass')}><Icon name="archive" className="w-4 h-4" /></button></>}</div></td></tr>)}{filteredClasses.length === 0 && <tr><td colSpan="7"><EmptyState icon="school" title={t('schoolNoClasses')} description={t('schoolCreateClassTitle')} /></td></tr>}</tbody></table></div></div>
    {isManager && editingClassId && <form className="school-shell__inline-edit school-shell__inline-edit--standalone" onSubmit={(event) => void saveClassEdit(event, editingClassId)}><input value={classEditForm.name} onChange={(event) => setClassEditForm((current) => ({ ...current, name: event.target.value }))} aria-label={t('schoolClassName')} required /><input value={classEditForm.academic_year} onChange={(event) => setClassEditForm((current) => ({ ...current, academic_year: event.target.value }))} aria-label={t('schoolAcademicYear')} placeholder={t('schoolAcademicYearPlaceholder')} /><button type="submit" className="btn-primary" disabled={busy.startsWith('edit-class:')}>{t('save')}</button><button type="button" className="btn-secondary" onClick={() => setEditingClassId('')}>{t('cancel')}</button></form>}
    {showClassForm && <div className="school-shell__dialog-backdrop" role="presentation" onClick={() => { if (busy !== 'class') setShowClassForm(false); }}><form className="school-shell__dialog school-shell__dialog--form" onSubmit={createClass} onClick={(event) => event.stopPropagation()}><div className="create-class-form__heading"><div><span className="school-shell__eyebrow">{t('setupNew')}</span><h3>{t('schoolCreateClassTitle')}</h3></div><button type="button" className="utility-icon" onClick={() => setShowClassForm(false)} disabled={busy === 'class'} aria-label={t('close')}>×</button></div><div className="school-shell__form-grid school-shell__form-grid--modal"><label><span>{t('schoolClassName')}</span><input autoFocus value={classForm.name} onChange={(event) => setClassForm((current) => ({ ...current, name: event.target.value }))} placeholder={t('schoolClassNamePlaceholder')} required /></label><label><span>{t('schoolClassSubjects')}</span><input value={classForm.subjects} onChange={(event) => setClassForm((current) => ({ ...current, subjects: event.target.value }))} placeholder={t('schoolSubjectListPlaceholder')} /><small>{t('schoolClassSubjectsOptionalHint')}</small></label><label><span>{t('schoolAcademicYear')}</span><input value={classForm.academic_year} onChange={(event) => setClassForm((current) => ({ ...current, academic_year: event.target.value }))} placeholder={t('schoolAcademicYearPlaceholder')} /></label><label><span>{t('accentColor')}</span><div className="color-picker school-shell__color-picker">{CLASS_COLORS.map((color, index) => <button key={color} type="button" className={`color-swatch ${classForm.color === color ? 'is-selected' : ''}`} style={{ background: color }} onClick={() => setClassForm((current) => ({ ...current, color }))} aria-label={`${t('chooseColor')} ${index + 1}`} title={`${t('colorLabel')} ${index + 1}`} />)}</div></label></div><div className="create-class-form__actions"><button type="submit" className="btn-primary" disabled={busy === 'class'}><Icon name="plus" className="w-4 h-4" />{busy === 'class' ? t('saving') : t('schoolCreateClass')}</button><button type="button" className="btn-secondary" onClick={() => setShowClassForm(false)} disabled={busy === 'class'}>{t('cancel')}</button></div></form></div>}
  </section>;

  const renderTeachersTab = () => {
    const assignmentByTeacher = assignments.reduce((map, assignment) => {
      if (!assignment.assigned_teacher_id) return map;
      const rows = map.get(assignment.assigned_teacher_id) || [];
      rows.push(assignment);
      map.set(assignment.assigned_teacher_id, rows);
      return map;
    }, new Map());
    return <section className="school-shell__workspace"><SectionHeader icon="users" title={t('schoolTeachersBySubjectTitle')} description={t('schoolTeachersBySubjectHint')} /><div className="school-shell__toolbar"><label className="school-shell__search"><Icon name="search" className="w-4 h-4" /><input value={teacherQuery} onChange={(event) => setTeacherQuery(event.target.value)} placeholder={t('schoolSearchTeachers')} /></label></div><div className="school-shell__table-card"><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolTeacher')}</th><th>{t('schoolSubject')}</th><th>{t('schoolAssignedClasses')}</th><th>{t('schoolAssignmentStatus')}</th></tr></thead><tbody>{filteredMembers.map((member) => { const rows = assignmentByTeacher.get(member.teacher_id) || []; return <tr key={member.id}><td><span className="school-shell__person-cell"><span className="school-shell__avatar">{String(member.full_name || '?').trim().charAt(0)}</span><span><strong>{member.full_name}</strong><small>{member.email}</small></span></span></td><td>{member.subject || t('schoolNoSubject')}</td><td>{rows.length ? rows.map((row) => `${row.class_name} · ${row.subject_label}`).join('، ') : '—'}</td><td><span className={`school-shell__status ${rows.length ? 'is-active' : 'is-pending'}`}>{rows.length ? t('schoolAssigned') : t('schoolWaitingTeacher')}</span></td></tr>; })}{filteredMembers.length === 0 && <tr><td colSpan="4"><EmptyState icon="users" title={t('schoolNoMembers')} description={t('schoolTeachersBySubjectHint')} /></td></tr>}</tbody></table></div></div></section>;
  };

  const renderAssignmentsTab = () => <section className="school-shell__workspace">{!isManager && <form className="school-shell__join-card" onSubmit={acceptAssignment}><SectionHeader icon="lock" title={t('schoolJoinTitle')} description={t('schoolJoinHint')} /><div className="school-shell__join-form"><input value={assignmentCode} onChange={(event) => setAssignmentCode(event.target.value)} placeholder={t('schoolAssignmentCodePlaceholder')} maxLength={40} required /><button type="submit" className="btn-primary" disabled={busy === 'assignment'}>{busy === 'assignment' ? t('saving') : t('schoolAcceptAssignment')}</button></div></form>}{isManager && <><SchoolDataHeader title={t('schoolAssignmentWorkspace')} description={t('schoolAssignmentTableHint')} classes={sortedClasses} selectedClassId={selectedClass?.id || ''} onSelect={setSelectedClassId} onRefresh={() => void loadSchool(selectedSchoolId)} loading={overviewLoading} t={t} />{selectedClass ? <div className="school-shell__assignment-layout"><div className="school-shell__assignment-list">{(selectedClass.subjects || []).map((subject) => <SubjectRow key={subject.subject_key} subject={subject} isManager busy={busy === `code:${selectedClass.id}:${subject.subject_key}` || busy === `revoke:${subject.assignment_id}`} onGenerate={(item) => void generateCode(selectedClass.id, item)} onRevoke={revokeAssignment} t={t} />)}<div className="school-shell__add-subject"><input value={subjectDrafts[selectedClass.id] || ''} onChange={(event) => setSubjectDrafts((current) => ({ ...current, [selectedClass.id]: event.target.value }))} placeholder={t('schoolAddSubject')} /><button type="button" className="btn-secondary" onClick={() => void addSubject(selectedClass.id)} disabled={busy === `subject:${selectedClass.id}`}><Icon name="plus" className="w-4 h-4" />{t('schoolAddSubject')}</button></div></div><aside className="school-shell__helper-card"><Icon name="link" className="w-5 h-5" /><h3>{t('schoolCodeWorkflowTitle')}</h3><p>{t('schoolCodeWorkflowHint')}</p></aside></div> : <EmptyState icon="link" title={t('schoolNoClasses')} />}</>}</section>;

  const renderRosterTab = () => { const selectedRosterClass = sortedClasses.find((item) => item.id === dataClassId) || null; return <section className="school-shell__workspace"><SchoolDataHeader title={t('schoolStudentsManagedBySchool')} description={t('schoolRosterManagerHint')} classes={sortedClasses} selectedClassId={dataClassId} onSelect={(classId) => { setDataClassId(classId); setSelectedClassId(classId || selectedClass?.id || ''); if (classId) void loadRoster(classId); }} onRefresh={() => void loadCentralOverview(selectedSchoolId)} loading={overviewLoading || busy.startsWith('roster:')} t={t} />{isManager ? <><div className="school-shell__roster-card"><SectionHeader icon="user" title={t('schoolAddStudent')} description={t('schoolRosterClassContext', '', { className: selectedRosterClass?.name || t('schoolChooseClass') })} /><form className="school-shell__student-form" onSubmit={addStudent}><input value={studentForm.full_name} onChange={(event) => setStudentForm((current) => ({ ...current, full_name: event.target.value }))} placeholder={t('schoolStudentNamePlaceholder')} aria-label={t('schoolStudentName')} required /><input value={studentForm.student_number} onChange={(event) => setStudentForm((current) => ({ ...current, student_number: event.target.value }))} placeholder={t('schoolStudentNumberPlaceholder')} aria-label={t('schoolStudentNumber')} /><button type="submit" className="btn-primary" disabled={busy === 'student' || !selectedRosterClass}><Icon name="plus" className="w-4 h-4" />{t('schoolAddStudent')}</button></form></div><div className="school-shell__table-card"><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolStudentName')}</th><th>{t('schoolClassName')}</th><th>{t('schoolStudentNumber')}</th><th>{t('schoolActions')}</th></tr></thead><tbody>{visibleStudents.map((student) => <tr key={student.id}><td><strong>{student.full_name}</strong></td><td>{student.class_name || '—'}</td><td>{student.student_number || '—'}</td><td><button type="button" className="utility-icon utility-icon--danger" onClick={() => void archiveStudent(student)} disabled={busy === `archive-student:${student.id}`} aria-label={t('archive')} title={t('archive')}><Icon name="archive" className="w-4 h-4" /></button></td></tr>)}{!visibleStudents.length && <tr><td colSpan="4"><EmptyState icon="user" title={t('schoolNoStudents')} description={t('schoolRosterManagerHint')} /></td></tr>}</tbody></table></div></div></> : <div className="school-shell__notice"><Icon name="lock" className="w-4 h-4" />{t('schoolTeacherOperationalNote')}</div>}</section>; };

  const renderAttendanceTab = () => <section className="school-shell__workspace"><SchoolDataHeader title={t('schoolAttendanceDashboardTitle')} description={t('schoolAttendanceDashboardHint')} classes={sortedClasses} selectedClassId={dataClassId} onSelect={setDataClassId} onRefresh={() => void loadCentralOverview(selectedSchoolId)} loading={overviewLoading} t={t} /><div className="school-shell__table-card"><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolSubject')}</th><th>{t('schoolAttendancePeriod')}</th><th>{t('schoolAttendanceTime')}</th><th>{t('schoolAttendancePresent')}</th><th>{t('schoolAttendanceAbsent')}</th><th>{t('schoolAttendanceLate')}</th></tr></thead><tbody>{attendanceToday.filter((row) => !dataClassId || row.class_id === dataClassId).map((session) => <tr key={session.id}><td>{session.class_name}</td><td>{session.subject_label || session.subject_key || '—'}</td><td>{session.period_label || session.period_key || '—'}</td><td>{session.starts_at || displayDateTime(session.recorded_at, locale)}</td><td className="school-shell__positive">{presentCount(session)}</td><td className="school-shell__negative">{session.absent_count || 0}</td><td>{session.late_count || 0}</td></tr>)}{!attendanceToday.filter((row) => !dataClassId || row.class_id === dataClassId).length && <tr><td colSpan="7"><EmptyState icon="check" title={t('schoolNoAttendance')} description={t('schoolAttendanceDashboardHint')} /></td></tr>}</tbody></table></div></div></section>;

  const renderGradesTab = () => <section className="school-shell__workspace"><SchoolDataHeader title={t('schoolGradesDashboardTitle')} description={t('schoolGradesDashboardHint')} classes={sortedClasses} selectedClassId={dataClassId} onSelect={setDataClassId} onRefresh={() => void loadCentralOverview(selectedSchoolId)} loading={overviewLoading} t={t} /><div className="school-shell__table-card"><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolStudentName')}</th><th>{t('schoolSubject')}</th><th>{t('schoolTeacher')}</th><th>{t('schoolFinalGrade')}</th><th>{t('schoolGradeCoverage')}</th></tr></thead><tbody>{grades.filter((row) => !dataClassId || row.class_id === dataClassId).map((row) => <tr key={`${row.student_id}:${row.subject_key}`}><td>{row.class_name}</td><td><strong>{row.full_name}</strong></td><td>{row.subject_label}</td><td>{row.assigned_teacher_name || t('schoolNoTeacher')}</td><td className="school-shell__grade-value">{row.final_grade === null || row.final_grade === undefined ? '—' : `${row.final_grade}%`}</td><td>{row.weight_entered || 0}%</td></tr>)}{!grades.filter((row) => !dataClassId || row.class_id === dataClassId).length && <tr><td colSpan="6"><EmptyState icon="reports" title={t('schoolNoGrades')} description={t('schoolGradesDashboardHint')} /></td></tr>}</tbody></table></div></div></section>;

  const renderBehaviorTab = () => <section className="school-shell__workspace"><SchoolDataHeader title={t('schoolBehaviorDashboardTitle')} description={t('schoolBehaviorDashboardHint')} classes={sortedClasses} selectedClassId={dataClassId} onSelect={setDataClassId} onRefresh={() => void loadCentralOverview(selectedSchoolId)} loading={overviewLoading} t={t} /><div className="school-shell__table-card"><div className="school-shell__table-heading"><div><h2>{t('schoolBehaviorByStudent')}</h2><p>{t('schoolBehaviorDashboardHint')}</p></div></div><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolStudentName')}</th><th>{t('schoolPositivePoints')}</th><th>{t('schoolNegativePoints')}</th><th>{t('schoolBehaviorEntries')}</th></tr></thead><tbody>{behaviors.filter((row) => !dataClassId || row.class_id === dataClassId).map((row) => <tr key={row.student_id}><td>{row.class_name}</td><td><strong>{row.full_name}</strong></td><td className="school-shell__positive">{row.positive_points || 0}</td><td className="school-shell__negative">{row.negative_points || 0}</td><td>{row.behavior_count || 0}</td></tr>)}{!behaviors.filter((row) => !dataClassId || row.class_id === dataClassId).length && <tr><td colSpan="5"><EmptyState icon="heart" title={t('schoolNoBehavior')} description={t('schoolBehaviorDashboardHint')} /></td></tr>}</tbody></table></div></div><div className="school-shell__detail-card"><h2>{t('schoolBehaviorDetails')}</h2><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolStudentName')}</th><th>{t('schoolSubject')}</th><th>{t('schoolBehavior')}</th><th>{t('schoolPoints')}</th><th>{t('schoolRecordedAt')}</th><th>{t('schoolTeacher')}</th></tr></thead><tbody>{behaviorDetails.filter((row) => !dataClassId || row.class_id === dataClassId).slice(0, 100).map((row) => <tr key={row.id}><td>{row.class_name}</td><td>{row.full_name}</td><td>{row.subject_label}</td><td>{row.behavior_label}</td><td className={row.points > 0 ? 'school-shell__positive' : 'school-shell__negative'}>{row.points > 0 ? '+' : ''}{row.points}</td><td>{displayDate(row.occurred_at, locale)}</td><td>{row.recorded_by_name || t('schoolNoTeacher')}</td></tr>)}{!behaviorDetails.filter((row) => !dataClassId || row.class_id === dataClassId).length && <tr><td colSpan="7"><EmptyState icon="heart" title={t('schoolNoBehavior')} /></td></tr>}</tbody></table></div></div></section>;

  const renderClassReport = () => {
    const classReport = selectedReportClass;
    if (!classReport) return <EmptyState icon="fileCheck" title={t('schoolNoReportSelection')} />;
    const classStudents = centralStudents.filter((student) => student.class_id === classReport.id);
    const classBehaviors = behaviors.filter((row) => row.class_id === classReport.id);
    const classAttendance = attendanceToday.filter((row) => row.class_id === classReport.id);
    return <div className="school-shell__official-report school-shell__report-printable"><div className="school-shell__report-heading"><div><span className="school-shell__eyebrow">{t('schoolClassReport')}</span><h2>{classReport.name}</h2><p>{school?.school?.name} · {classReport.academic_year || '—'}</p></div><button type="button" className="btn-secondary no-print" onClick={() => window.print()}><Icon name="fileCheck" className="w-4 h-4" />{t('schoolPrintReport')}</button></div><div className="school-shell__report-kpis"><Metric icon="user" label={t('schoolStudents')} value={classStudents.length} /><Metric icon="book" label={t('schoolClassSubjects')} value={classReport.subjects?.length || 0} /><Metric icon="check" label={t('schoolAttendanceToday')} value={classAttendance.length} /><Metric icon="heart" label={t('schoolBehaviorEntries')} value={classBehaviors.reduce((sum, row) => sum + Number(row.behavior_count || 0), 0)} /></div><h3 className="school-shell__report-subtitle">{t('schoolFinalGradesBySubject')}</h3><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolSubject')}</th><th>{t('schoolTeacher')}</th><th>{t('schoolStudentName')}</th><th>{t('schoolFinalGrade')}</th></tr></thead><tbody>{(classReport.subjects || []).flatMap((subject) => (subject.student_grades || []).map((row) => ({ ...row, subject }))).map((row) => <tr key={`${row.subject.subject_key}:${row.student_id}`}><td>{row.subject.subject_label}</td><td>{row.subject.assigned_teacher_name || t('schoolNoTeacher')}</td><td>{row.full_name}</td><td>{row.final_grade === null ? '—' : `${row.final_grade}%`}</td></tr>)}</tbody></table></div><h3 className="school-shell__report-subtitle">{t('schoolAttendanceDashboardTitle')}</h3><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolSubject')}</th><th>{t('schoolAttendancePeriod')}</th><th>{t('schoolAttendancePresent')}</th><th>{t('schoolAttendanceAbsent')}</th><th>{t('schoolAttendanceLate')}</th></tr></thead><tbody>{classAttendance.map((session) => <tr key={session.id}><td>{session.subject_label}</td><td>{session.period_label || session.period_key}</td><td>{presentCount(session)}</td><td>{session.absent_count || 0}</td><td>{session.late_count || 0}</td></tr>)}{!classAttendance.length && <tr><td colSpan="5">{t('schoolNoAttendance')}</td></tr>}</tbody></table></div><h3 className="school-shell__report-subtitle">{t('schoolBehaviorByStudent')}</h3><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolStudentName')}</th><th>{t('schoolPositivePoints')}</th><th>{t('schoolNegativePoints')}</th><th>{t('schoolBehaviorEntries')}</th></tr></thead><tbody>{classBehaviors.map((row) => <tr key={row.student_id}><td>{row.full_name}</td><td>{row.positive_points || 0}</td><td>{row.negative_points || 0}</td><td>{row.behavior_count || 0}</td></tr>)}</tbody></table></div></div>;
  };

  const renderStudentReport = () => {
    const student = selectedReportStudent;
    if (!student) return <EmptyState icon="fileCheck" title={t('schoolNoReportSelection')} />;
    const behavior = student.behavior || {};
    const studentDetails = behaviorDetails.filter((row) => row.student_id === student.id);
    return <div className="school-shell__official-report school-shell__report-printable"><div className="school-shell__report-heading"><div><span className="school-shell__eyebrow">{t('schoolStudentReport')}</span><h2>{student.full_name}</h2><p>{school?.school?.name} · {student.class_name}</p></div><button type="button" className="btn-secondary no-print" onClick={() => window.print()}><Icon name="fileCheck" className="w-4 h-4" />{t('schoolPrintReport')}</button></div><div className="school-shell__report-kpis"><Metric icon="check" label={t('schoolAttendancePresent')} value={student.attendance?.present || 0} /><Metric icon="alert" label={t('schoolAttendanceAbsent')} value={student.attendance?.absent || 0} /><Metric icon="heart" label={t('schoolBehaviorEntries')} value={behavior.behavior_count || 0} /><Metric icon="reports" label={t('schoolGrades')} value={student.grades?.filter((row) => row.final_grade !== null).length || 0} /></div><h3 className="school-shell__report-subtitle">{t('schoolFinalGradesBySubject')}</h3><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolSubject')}</th><th>{t('schoolTeacher')}</th><th>{t('schoolFinalGrade')}</th></tr></thead><tbody>{(student.grades || []).map((row) => <tr key={`${row.subject_key}:${row.class_id}`}><td>{row.subject_label}</td><td>{row.assigned_teacher_name || t('schoolNoTeacher')}</td><td>{row.final_grade === null ? '—' : `${row.final_grade}%`}</td></tr>)}{!student.grades?.length && <tr><td colSpan="3">{t('schoolNoGrades')}</td></tr>}</tbody></table></div><h3 className="school-shell__report-subtitle">{t('schoolBehaviorDetails')}</h3><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolBehavior')}</th><th>{t('schoolSubject')}</th><th>{t('schoolPoints')}</th><th>{t('schoolRecordedAt')}</th></tr></thead><tbody>{studentDetails.map((row) => <tr key={row.id}><td>{row.behavior_label}</td><td>{row.subject_label}</td><td>{row.points > 0 ? '+' : ''}{row.points}</td><td>{displayDate(row.occurred_at, locale)}</td></tr>)}{!studentDetails.length && <tr><td colSpan="4">{t('schoolNoBehavior')}</td></tr>}</tbody></table></div></div>;
  };

  const renderReportsTab = () => <section className="school-shell__workspace"><SectionHeader icon="fileCheck" title={t('schoolReportsDashboardTitle')} description={t('schoolReportsDashboardHint')} /><div className="school-shell__report-selector"><div className="school-shell__report-mode"><button type="button" className={reportMode === 'class' ? 'is-active' : ''} onClick={() => setReportMode('class')}><Icon name="school" className="w-4 h-4" />{t('schoolClassReport')}</button><button type="button" className={reportMode === 'student' ? 'is-active' : ''} onClick={() => setReportMode('student')}><Icon name="user" className="w-4 h-4" />{t('schoolStudentReport')}</button></div><div className="school-shell__report-fields">{reportMode === 'class' ? <label><span>{t('schoolChooseClass')}</span><select value={reportClassIdValue} onChange={(event) => setReportClassId(event.target.value)}><option value="">{t('schoolChooseClass')}</option>{sortedClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <label><span>{t('schoolStudentName')}</span><select value={reportStudentId || ''} onChange={(event) => setReportStudentId(event.target.value)}><option value="">{t('schoolStudentName')}</option>{centralStudents.map((student) => <option key={student.id} value={student.id}>{student.full_name} · {student.class_name}</option>)}</select></label>}</div></div>{reportMode === 'class' ? renderClassReport() : renderStudentReport()}</section>;

  const renderAnalyticsTab = () => {
    const rows = sortedClasses.map((classItem) => {
      const finalGrades = (classItem.subjects || []).flatMap((subject) => subject.student_grades || []).map((row) => row.final_grade).filter((value) => value !== null && value !== undefined);
      const average = finalGrades.length ? finalGrades.reduce((sum, value) => sum + Number(value), 0) / finalGrades.length : null;
      return { ...classItem, average };
    });
    return <section className="school-shell__workspace"><SectionHeader icon="analytics" title={t('schoolAnalyticsDashboardTitle')} description={t('schoolAnalyticsDashboardHint')} />{renderSchoolStats()}<div className="school-shell__table-card"><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolStudents')}</th><th>{t('schoolClassSubjects')}</th><th>{t('schoolAssigned')}</th><th>{t('schoolFinalGrade')}</th><th>{t('schoolAttendanceToday')}</th><th>{t('schoolBehaviorEntries')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.student_count || 0}</td><td>{row.subject_count || row.subjects?.length || 0}</td><td>{row.assigned_teacher_count || 0}</td><td className="school-shell__grade-value">{row.average === null ? '—' : `${row.average.toFixed(1)}%`}</td><td>{row.attendance_today?.length || row.attendance_session_count || 0}</td><td>{(behaviors.filter((item) => item.class_id === row.id).reduce((sum, item) => sum + Number(item.behavior_count || 0), 0))}</td></tr>)}</tbody></table>{!rows.length && <EmptyState icon="analytics" title={t('schoolNoData')} description={t('schoolAnalyticsDashboardHint')} />}</div></div><div className="school-shell__attention-card"><SectionHeader icon="alert" title={t('schoolStudentsNeedingAttention')} description={t('schoolAnalyticsDashboardHint')} />{behaviors.filter((row) => Number(row.behavior_points || 0) < 0).slice(0, 30).map((row) => <div key={row.student_id} className="school-shell__attention-row"><span>{row.full_name} · {row.class_name}</span><b>{row.behavior_points} {t('schoolPoints')}</b><small>{row.behavior_count || 0} · {t('schoolBehaviorEntries')}</small></div>)}{!behaviors.some((row) => Number(row.behavior_points || 0) < 0) && <p>{t('schoolNoData')}</p>}</div></section>;
  };

  const renderTeacherClasses = () => <section className="school-shell__workspace"><SectionHeader icon="school" title={t('schoolTeacherClassesTitle')} description={t('schoolTeacherHeroHint')} />{schoolClasses.length ? <div className="school-shell__table-card"><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolAcademicYear')}</th><th>{t('schoolSubject')}</th><th>{t('schoolStudents')}</th><th>{t('schoolActions')}</th></tr></thead><tbody>{schoolClasses.map((classItem) => <tr key={classItem.id}><td><strong>{classItem.name}</strong></td><td>{classItem.academic_year || '—'}</td><td>{(classItem.subjects || []).map((subject) => subject.subject_label).join('، ') || classItem.subject || '—'}</td><td>{classItem.student_count || 0}</td><td><Link className="btn-primary" to={`/classes/${classItem.id}`}><Icon name="externalLink" className="w-4 h-4" />{t('schoolOpenClass')}</Link></td></tr>)}</tbody></table></div></div> : <EmptyState icon="school" title={t('schoolNoClasses')} description={t('schoolTeacherHeroHint')} />}</section>;

  const renderTab = () => { if (activeTab === 'classes') return isManager ? renderClassesTab() : renderTeacherClasses(); if (activeTab === 'teachers') return renderTeachersTab(); if (activeTab === 'assignments') return renderAssignmentsTab(); if (activeTab === 'roster') return renderRosterTab(); if (activeTab === 'attendance') return renderAttendanceTab(); if (activeTab === 'grades') return renderGradesTab(); if (activeTab === 'behavior') return renderBehaviorTab(); if (activeTab === 'reports') return renderReportsTab(); return renderAnalyticsTab(); };

  if (loading && !school && !schools.length) return <div className="school-shell" dir={direction}><LoadingOverlay /></div>;
  if (!schools.length) return <div className="school-shell" dir={direction}><div className="school-shell__topbar"><Link to="/" className="school-shell__back"><Icon name="arrowLeft" className="w-4 h-4" />{t('backToClasses')}</Link><span className="school-shell__brand"><Icon name="school" className="w-5 h-5" />EduCore</span></div>{renderNoSchool()}</div>;

  return <div className="school-shell" dir={direction}>
    <header className="school-shell__topbar"><div className="school-shell__topbar-main"><Link to="/" className="school-shell__back"><Icon name="arrowLeft" className="w-4 h-4" />{t('backToClasses')}</Link><span className="school-shell__brand"><Icon name="school" className="w-5 h-5" />EduCore</span></div><div className="school-shell__account"><span className="school-shell__account-avatar">{String(teacher?.full_name || teacher?.email || '?').trim().charAt(0)}</span><span>{isManager ? t('schoolRoleAdmin') : teacher?.subject || t('schoolRoleTeacher')}</span><small className="school-shell__sync-meta">{lastSyncAt ? displayDateTime(lastSyncAt, locale) : t('syncBackground')}</small><button type="button" className="school-shell__sync-button" onClick={() => void syncNow()} disabled={syncing} title={syncing ? t('syncing') : t('syncNow')}><Icon name="refresh" className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /><span>{syncing ? t('syncing') : t('syncNow')}</span></button></div></header>
    {message && <div className="school-shell__feedback school-shell__feedback--success" role="status"><Icon name="check" className="w-4 h-4" />{message}<button type="button" onClick={() => setMessage('')} aria-label={t('close')}>×</button></div>}
    {error && <div className="school-shell__feedback school-shell__feedback--error" role="alert"><Icon name="alert" className="w-4 h-4" />{error}<button type="button" onClick={() => { setError(''); void loadSchools(selectedSchoolId); }}>{t('retry')}</button></div>}
    <section className="school-shell__hero"><div><span className="school-shell__eyebrow">{t('schoolManagementEyebrow')}</span><h1>{school?.school?.name || t('schoolManagementTitle')}</h1><p>{isManager ? t('schoolManagerHeroHint') : t('schoolTeacherHeroHint')}</p></div><div className="school-shell__hero-meta"><span><Icon name="users" className="w-4 h-4" />{t('schoolMemberCount', '', { count: school?.school?.member_count || 0 })}</span><span><Icon name="school" className="w-4 h-4" />{t('schoolClassCount', '', { count: school?.school?.class_count || 0 })}</span></div></section>
    <nav className="school-shell__tabs" role="tablist" aria-label={t('schoolManagementTitle')}>{tabs.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab.id} key={tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => selectTab(tab.id)}><Icon name={tab.icon} className="w-4 h-4" /><span>{t(tab.key)}</span></button>)}</nav>
    {isManager && overviewLoading && !overview && <div className="school-shell__loading-note"><Icon name="refresh" className="w-4 h-4 animate-spin" />{t('loading')}</div>}
    {renderTab()}
    {visibleCode && <div className="school-shell__dialog-backdrop" role="presentation" onClick={() => setVisibleCode(null)}><section className="school-shell__dialog" role="dialog" aria-modal="true" aria-labelledby="school-code-dialog-title" onClick={(event) => event.stopPropagation()}><button type="button" className="school-shell__dialog-close utility-icon" onClick={() => setVisibleCode(null)} aria-label={t('schoolCodeDialogClose')} title={t('schoolCodeDialogClose')}>×</button><span className="school-shell__setup-icon"><Icon name="lock" className="w-6 h-6" /></span><span className="school-shell__eyebrow">{t('schoolCodeDialogEyebrow')}</span><h2 id="school-code-dialog-title">{t('schoolCodeDialogTitle')}</h2><p>{t('schoolCodeDialogHint', '', { className: visibleCode.class_name || t('schoolClasses') })}</p><code className="school-shell__code-value" dir="ltr">{visibleCode.code}</code><div className="school-shell__dialog-actions"><button type="button" className="btn-primary" onClick={() => void copyCode(visibleCode.code)}><Icon name="copy" className="w-4 h-4" />{t('schoolCopyCode')}</button><button type="button" className="btn-secondary" onClick={() => setVisibleCode(null)}>{t('schoolCodeDialogClose')}</button></div><small>{t('schoolCodeOneTimeNote')}</small></section></div>}
  </div>;
}
