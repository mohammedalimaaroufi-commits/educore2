import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getLocalFirst } from '../api/client';
import Icon from '../components/Icon.jsx';
import LoadingOverlay from '../components/LoadingOverlay.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

const EMPTY_CLASS_FORM = { name: '', subjects: '', academic_year: '', color: '#2E7D6B' };
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

function DataHeader({ title, description, classes, selectedClassId, onSelect, onRefresh, loading, t }) {
  return <div className="school-shell__data-header"><div><span className="school-shell__eyebrow">{t('schoolManagerWorkspace')}</span><h2>{title}</h2>{description && <p>{description}</p>}</div><div className="school-shell__data-tools"><label><span>{t('schoolChooseClass')}</span><select value={selectedClassId} onChange={(event) => onSelect(event.target.value)}><option value="">{t('schoolChooseClass')}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="utility-icon" onClick={onRefresh} disabled={loading} aria-label={t('refresh')} title={t('refresh')}><Icon name="refresh" className="w-4 h-4" /></button></div></div>;
}

export default function SchoolManagement() {
  const { teacher } = useAuth();
  const { t, locale, direction } = useLocale();
  const [schools, setSchools] = useState([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [school, setSchool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('classes');
  const [assignmentCode, setAssignmentCode] = useState('');
  const [classForm, setClassForm] = useState(EMPTY_CLASS_FORM);
  const [subjectDrafts, setSubjectDrafts] = useState({});
  const [generatedCodes, setGeneratedCodes] = useState({});
  const [visibleCode, setVisibleCode] = useState(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [roster, setRoster] = useState([]);
  const [studentForm, setStudentForm] = useState(EMPTY_STUDENT_FORM);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [editingClassId, setEditingClassId] = useState('');
  const [classEditForm, setClassEditForm] = useState({ name: '', academic_year: '', color: '' });

  const selectedMembership = school?.membership;
  const isManager = teacher?.account_role === 'school_manager' && selectedMembership?.role === 'school_admin';
  const tabs = isManager ? MANAGER_TABS : TEACHER_TABS;
  const classes = school?.classes || [];
  const sortedClasses = useMemo(() => [...classes].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), locale === 'ar' ? 'ar' : 'en')), [classes, locale]);
  const selectedClass = sortedClasses.find((item) => item.id === selectedClassId) || sortedClasses[0] || null;
  const totalStudents = useMemo(() => sortedClasses.reduce((sum, item) => sum + Number(item.student_count || 0), 0), [sortedClasses]);
  const totalSubjects = useMemo(() => sortedClasses.reduce((sum, item) => sum + Number(item.subject_count || 0), 0), [sortedClasses]);
  const totalAssignedTeachers = useMemo(() => sortedClasses.reduce((sum, item) => sum + Number(item.assigned_teacher_count || 0), 0), [sortedClasses]);
  const filteredMembers = useMemo(() => (school?.members || []).filter((member) => `${member.full_name || ''} ${member.email || ''} ${member.subject || ''}`.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en').includes(teacherQuery.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en'))), [school?.members, teacherQuery, locale]);

  const setFailure = (requestError) => { setError(apiMessage(requestError, t)); setMessage(''); };

  const loadSchool = async (schoolId) => {
    if (!schoolId) return;
    try {
      const { data } = await api.get(`/schools/${schoolId}`);
      setSchool(data);
      setSelectedSchoolId(schoolId);
      const nextClasses = data?.classes || [];
      setSelectedClassId((current) => nextClasses.some((item) => item.id === current) ? current : nextClasses[0]?.id || '');
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

  useEffect(() => { void loadSchools(); }, []);
  useEffect(() => { if (isManager && activeTab !== 'classes' && activeTab !== 'teachers' && activeTab !== 'assignments' && activeTab !== 'roster' && selectedClass?.id) void loadOverview(selectedClass.id); }, [activeTab, isManager, selectedClass?.id]);

  const loadOverview = async (classId = selectedClass?.id) => {
    if (!isManager || !selectedSchoolId || !classId) return;
    setOverviewLoading(true);
    if (overview?.class?.id !== classId) setOverview(null);
    try { const { data } = await api.get(`/schools/${selectedSchoolId}/classes/${classId}/overview`); setOverview(data); }
    catch (requestError) { setFailure(requestError); }
    finally { setOverviewLoading(false); }
  };

  const loadRoster = async (classId = selectedClass?.id) => {
    if (!isManager || !selectedSchoolId || !classId) return;
    setBusy(`roster:${classId}`);
    try { const { data } = await api.get(`/schools/${selectedSchoolId}/classes/${classId}/students`); setRoster(data.students || []); setSelectedClassId(classId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const selectTab = (tabId, classId = selectedClass?.id) => {
    setActiveTab(tabId);
    setMessage('');
    setError('');
    if (tabId === 'roster' && isManager && classId) void loadRoster(classId);
  };

  const acceptAssignment = async (event) => {
    event.preventDefault();
    if (!assignmentCode.trim() || busy) return;
    setBusy('assignment');
    try { const { data } = await api.post('/schools/accept-assignment', { code: assignmentCode.trim() }); setAssignmentCode(''); setMessage(t('schoolAssignmentAccepted')); await loadSchools(data?.school?.school?.id || selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const createClass = async (event) => {
    event.preventDefault();
    const subjects = classForm.subjects.split(',').map((item) => item.trim()).filter(Boolean);
    if (!selectedSchoolId || busy || !classForm.name.trim() || !subjects.length) return;
    setBusy('class');
    try { await api.post(`/schools/${selectedSchoolId}/classes`, { ...classForm, subject: subjects[0], subjects }); setClassForm(EMPTY_CLASS_FORM); setMessage(t('schoolClassCreated')); await loadSchool(selectedSchoolId); }
    catch (requestError) { setFailure(requestError); }
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
    const key = `${classId}:${subject.subject_key}`;
    if (busy) return;
    setBusy(`code:${key}`);
    try { const { data } = await api.post(`/schools/${selectedSchoolId}/classes/${classId}/assignment-code`, { subject_key: subject.subject_key, max_uses: 1, expires_days: 7 }); const codeData = { ...data, class_name: `${selectedClass?.name || classId} · ${subject.subject_label}` }; setGeneratedCodes((current) => ({ ...current, [key]: codeData })); setVisibleCode(codeData); setMessage(t('schoolCodeGenerated')); }
    catch (requestError) { setFailure(requestError); }
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

  const beginEditClass = (classItem) => { setEditingClassId(classItem.id); setClassEditForm({ name: classItem.name || '', academic_year: classItem.academic_year || '', color: classItem.color || '#2E7D6B' }); };

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
    if (!selectedClass?.id || !studentForm.full_name.trim() || busy) return;
    setBusy('student');
    try { await api.post(`/schools/${selectedSchoolId}/classes/${selectedClass.id}/students`, studentForm); setStudentForm(EMPTY_STUDENT_FORM); setMessage(t('schoolStudentAdded')); await Promise.all([loadRoster(selectedClass.id), loadSchool(selectedSchoolId)]); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const archiveStudent = async (student) => {
    if (busy || !selectedClass?.id) return;
    setBusy(`archive-student:${student.id}`);
    try { await api.patch(`/schools/${selectedSchoolId}/classes/${selectedClass.id}/students/${student.id}/archive`); setMessage(t('schoolStudentArchived')); await loadRoster(selectedClass.id); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const restoreStudent = async (student) => {
    if (busy || !selectedClass?.id) return;
    setBusy(`restore-student:${student.id}`);
    try { await api.patch(`/schools/${selectedSchoolId}/classes/${selectedClass.id}/students/${student.id}/restore`); setMessage(t('schoolStudentRestored')); await loadRoster(selectedClass.id); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const copyCode = async (code) => {
    try { await navigator.clipboard.writeText(code); setMessage(t('schoolCodeCopied')); } catch { setMessage(code); }
  };

  const renderNoSchool = () => <section className="school-shell__setup"><article className="school-shell__setup-card"><span className="school-shell__setup-icon"><Icon name="school" className="w-6 h-6" /></span><div><span className="school-shell__eyebrow">{t('schoolManagementEyebrow')}</span><h2>{t('schoolProvisioningTitle')}</h2><p>{t('schoolProvisioningHint')}</p></div><div className="school-shell__setup-note"><Icon name="secure" className="w-4 h-4" />{t('schoolPersonalClassesNote')}</div></article><form className="school-shell__setup-card school-shell__setup-card--accent" onSubmit={acceptAssignment}><span className="school-shell__setup-icon"><Icon name="lock" className="w-6 h-6" /></span><div><span className="school-shell__eyebrow">{t('schoolTabAssignments')}</span><h2>{t('schoolJoinTitle')}</h2><p>{t('schoolJoinHint')}</p></div><label><span>{t('schoolAssignmentCode')}</span><input value={assignmentCode} onChange={(event) => setAssignmentCode(event.target.value)} placeholder={t('schoolAssignmentCodePlaceholder')} maxLength={40} required /></label><button type="submit" className="btn-primary" disabled={busy === 'assignment'}>{busy === 'assignment' ? t('saving') : t('schoolAcceptAssignment')}</button></form></section>;

  const renderSchoolStats = () => <div className="school-shell__stats"><Metric icon="school" label={t('schoolClasses')} value={sortedClasses.length} /><Metric icon="user" label={t('schoolStudents')} value={totalStudents} /><Metric icon="book" label={t('schoolClassSubjects')} value={totalSubjects} /><Metric icon="users" label={t('schoolMembers')} value={isManager ? school?.members?.length : totalAssignedTeachers} /></div>;

  const renderClassCards = () => <div className="school-shell__class-grid">{sortedClasses.map((classItem) => <article className="school-shell__class-card" key={classItem.id}><div className="school-shell__class-top"><div><span className="school-shell__class-badge"><Icon name="school" className="w-3.5 h-3.5" />{t('schoolManagedClass')}</span><h3>{classItem.name}</h3><p>{classItem.academic_year || t('schoolAcademicYearPlaceholder')}</p></div><span className="school-shell__class-dot" style={{ background: classItem.color || '#2E7D6B' }} /></div><div className="school-shell__class-metrics"><Metric icon="user" label={t('schoolStudents')} value={classItem.student_count} /><Metric icon="book" label={t('schoolClassSubjects')} value={classItem.subject_count} /><Metric icon="users" label={t('schoolMembers')} value={classItem.assigned_teacher_count} /><Metric icon="check" label={t('schoolAttendanceToday')} value={classItem.attendance_session_count} /></div><div className="school-shell__subject-preview">{(classItem.subjects || []).map((subject) => <span key={subject.subject_key}><Icon name="book" className="w-3 h-3" />{subject.subject_label}<b>{subject.assigned_teacher_name || t('schoolNoTeacher')}</b></span>)}</div>{isManager && editingClassId === classItem.id && <form className="school-shell__inline-edit" onSubmit={(event) => void saveClassEdit(event, classItem.id)}><input value={classEditForm.name} onChange={(event) => setClassEditForm((current) => ({ ...current, name: event.target.value }))} aria-label={t('schoolClassName')} required /><input value={classEditForm.academic_year} onChange={(event) => setClassEditForm((current) => ({ ...current, academic_year: event.target.value }))} aria-label={t('schoolAcademicYear')} placeholder={t('schoolAcademicYearPlaceholder')} /><button type="submit" className="btn-primary" disabled={busy === `edit-class:${classItem.id}`}>{t('save')}</button><button type="button" className="btn-secondary" onClick={() => setEditingClassId('')}>{t('cancel')}</button></form>}<div className="school-shell__class-actions">{isManager && <button type="button" className="btn-secondary" onClick={() => { setSelectedClassId(classItem.id); selectTab('roster', classItem.id); }}><Icon name="user" className="w-4 h-4" />{t('schoolManageRoster')}</button>}<button type="button" className="btn-secondary" onClick={() => { setSelectedClassId(classItem.id); selectTab(isManager ? 'analytics' : 'assignments', classItem.id); }}><Icon name="analytics" className="w-4 h-4" />{t('schoolViewOverview')}</button>{!isManager && <Link className="btn-primary" to={`/classes/${classItem.id}`}><Icon name="externalLink" className="w-4 h-4" />{t('schoolOpenClass')}</Link>}{isManager && <><button type="button" className="utility-icon" onClick={() => beginEditClass(classItem)} aria-label={t('schoolEditClass')} title={t('schoolEditClass')}><Icon name="edit" className="w-4 h-4" /></button><button type="button" className="utility-icon utility-icon--danger" onClick={() => void archiveClass(classItem.id)} aria-label={t('schoolArchiveClass')} title={t('schoolArchiveClass')}><Icon name="archive" className="w-4 h-4" /></button></>}</div></article>)}{sortedClasses.length === 0 && <EmptyState icon="school" title={t('schoolNoClasses')} description={t('schoolCreateClassTitle')} />}</div>;

  const renderClassesTab = () => <section className="school-shell__workspace">{renderSchoolStats()}{isManager && <form className="school-shell__create-card" onSubmit={createClass}><div className="school-shell__section-title"><span className="school-shell__section-icon"><Icon name="plus" className="w-5 h-5" /></span><div><h2>{t('schoolCreateClassTitle')}</h2><p>{t('schoolClassSubjectsHint')}</p></div></div><div className="school-shell__form-grid"><label><span>{t('schoolClassName')}</span><input value={classForm.name} onChange={(event) => setClassForm((current) => ({ ...current, name: event.target.value }))} placeholder={t('schoolClassNamePlaceholder')} required /></label><label><span>{t('schoolClassSubjects')}</span><input value={classForm.subjects} onChange={(event) => setClassForm((current) => ({ ...current, subjects: event.target.value }))} placeholder={t('schoolSubjectListPlaceholder')} required /></label><label><span>{t('schoolAcademicYear')}</span><input value={classForm.academic_year} onChange={(event) => setClassForm((current) => ({ ...current, academic_year: event.target.value }))} placeholder={t('schoolAcademicYearPlaceholder')} /></label><button type="submit" className="btn-primary" disabled={busy === 'class'}><Icon name="plus" className="w-4 h-4" />{busy === 'class' ? t('saving') : t('schoolCreateClass')}</button></div></form>}{!isManager && <div className="school-shell__notice"><Icon name="lock" className="w-4 h-4" /><span>{t('schoolTeacherOperationalNote')}</span></div>}{renderClassCards()}</section>;

  const renderTeachersTab = () => { const assignments = sortedClasses.flatMap((classItem) => (classItem.subjects || []).map((subject) => ({ ...subject, class_name: classItem.name }))); return <section className="school-shell__workspace"><div className="school-shell__toolbar"><div><span className="school-shell__eyebrow">{t('schoolTabTeachers')}</span><h2>{t('schoolMembers')}</h2><p>{t('schoolTeachersBySubjectHint')}</p></div><label className="school-shell__search"><Icon name="search" className="w-4 h-4" /><input value={teacherQuery} onChange={(event) => setTeacherQuery(event.target.value)} placeholder={t('schoolSearchTeachers')} /></label></div><div className="school-shell__teacher-summary"><Metric icon="users" label={t('schoolMembers')} value={filteredMembers.length} /><Metric icon="book" label={t('schoolClassSubjects')} value={assignments.length} /><Metric icon="link" label={t('schoolAssigned')} value={assignments.filter((item) => item.assigned_teacher_id).length} /></div><div className="school-shell__teacher-grid">{filteredMembers.map((member) => <article className="school-shell__teacher-card" key={member.id}><span className="school-shell__avatar">{String(member.full_name || '?').trim().charAt(0)}</span><div><h3>{member.full_name}</h3><p>{member.email}</p><span>{member.subject || t('schoolNoSubject')} · {member.role === 'school_admin' ? t('schoolRoleAdmin') : t('schoolRoleTeacher')}</span></div></article>)}{filteredMembers.length === 0 && <EmptyState icon="users" title={t('schoolNoMembers')} description={teacherQuery ? t('schoolNoData') : t('schoolTeachersBySubjectHint')} />}</div><div className="school-shell__table-card"><div className="school-shell__table-heading"><div><h2>{t('schoolAssignmentsBySubject')}</h2><p>{t('schoolAssignmentTableHint')}</p></div></div><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolClassName')}</th><th>{t('schoolSubject')}</th><th>{t('schoolTeacher')}</th><th>{t('schoolAssignmentStatus')}</th></tr></thead><tbody>{assignments.map((item) => <tr key={`${item.class_id}:${item.subject_key}`}><td>{item.class_name}</td><td>{item.subject_label}</td><td>{item.assigned_teacher_name || t('schoolNoTeacher')}</td><td><span className={`school-shell__status ${item.assignment_id ? 'is-active' : 'is-pending'}`}>{item.assignment_id ? t('schoolAssigned') : t('schoolWaitingTeacher')}</span></td></tr>)}</tbody></table>{!assignments.length && <EmptyState icon="link" title={t('schoolNoAssignments')} />}</div></div></section>; };

  const renderAssignmentsTab = () => <section className="school-shell__workspace">{!isManager && <form className="school-shell__join-card" onSubmit={acceptAssignment}><div className="school-shell__section-title"><span className="school-shell__section-icon"><Icon name="lock" className="w-5 h-5" /></span><div><h2>{t('schoolJoinTitle')}</h2><p>{t('schoolJoinHint')}</p></div></div><div className="school-shell__join-form"><input value={assignmentCode} onChange={(event) => setAssignmentCode(event.target.value)} placeholder={t('schoolAssignmentCodePlaceholder')} maxLength={40} required /><button type="submit" className="btn-primary" disabled={busy === 'assignment'}>{busy === 'assignment' ? t('saving') : t('schoolAcceptAssignment')}</button></div></form>}{isManager && <><div className="school-shell__toolbar"><div><span className="school-shell__eyebrow">{t('schoolTabAssignments')}</span><h2>{t('schoolAssignmentWorkspace')}</h2><p>{t('schoolAssignmentTableHint')}</p></div><label><span>{t('schoolChooseClass')}</span><select value={selectedClass?.id || ''} onChange={(event) => setSelectedClassId(event.target.value)}><option value="">{t('schoolChooseClass')}</option>{sortedClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>{selectedClass ? <div className="school-shell__assignment-layout"><div className="school-shell__assignment-list">{(selectedClass.subjects || []).map((subject) => <SubjectRow key={subject.subject_key} subject={subject} isManager busy={busy === `code:${selectedClass.id}:${subject.subject_key}` || busy === `revoke:${subject.assignment_id}`} onGenerate={(item) => void generateCode(selectedClass.id, item)} onRevoke={revokeAssignment} t={t} />)}<div className="school-shell__add-subject"><input value={subjectDrafts[selectedClass.id] || ''} onChange={(event) => setSubjectDrafts((current) => ({ ...current, [selectedClass.id]: event.target.value }))} placeholder={t('schoolAddSubject')} /><button type="button" className="btn-secondary" onClick={() => void addSubject(selectedClass.id)} disabled={busy === `subject:${selectedClass.id}`}><Icon name="plus" className="w-4 h-4" />{t('schoolAddSubject')}</button></div></div><aside className="school-shell__helper-card"><Icon name="link" className="w-5 h-5" /><h3>{t('schoolCodeWorkflowTitle')}</h3><p>{t('schoolCodeWorkflowHint')}</p></aside></div> : <EmptyState icon="link" title={t('schoolNoClasses')} />}</>}</section>;

  const renderRosterTab = () => <section className="school-shell__workspace"><DataHeader title={t('schoolStudentsManagedBySchool')} description={t('schoolRosterManagerHint')} classes={sortedClasses} selectedClassId={selectedClass?.id || ''} onSelect={(classId) => { setSelectedClassId(classId); void loadRoster(classId); }} onRefresh={() => void loadRoster()} loading={busy.startsWith('roster:')} t={t} />{selectedClass ? <div className="school-shell__roster-layout"><div className="school-shell__roster-card"><form className="school-shell__student-form" onSubmit={addStudent}><input value={studentForm.full_name} onChange={(event) => setStudentForm((current) => ({ ...current, full_name: event.target.value }))} placeholder={t('schoolStudentNamePlaceholder')} aria-label={t('schoolStudentName')} required /><input value={studentForm.student_number} onChange={(event) => setStudentForm((current) => ({ ...current, student_number: event.target.value }))} placeholder={t('schoolStudentNumberPlaceholder')} aria-label={t('schoolStudentNumber')} /><button type="submit" className="btn-primary" disabled={busy === 'student'}><Icon name="plus" className="w-4 h-4" />{t('schoolAddStudent')}</button></form><div className="school-shell__roster-list">{roster.map((student) => <div className={`school-shell__roster-row ${student.archived ? 'is-archived' : ''}`} key={student.id}><div><strong>{student.full_name}</strong><span>{student.student_number || '—'}</span></div>{student.archived ? <button type="button" className="btn-secondary" onClick={() => void restoreStudent(student)}>{t('restore')}</button> : <button type="button" className="utility-icon utility-icon--danger" onClick={() => void archiveStudent(student)} aria-label={t('archive')} title={t('archive')}><Icon name="archive" className="w-4 h-4" /></button>}</div>)}{!roster.length && <EmptyState icon="user" title={t('schoolNoData')} description={t('schoolRosterManagerHint')} />}</div></div><aside className="school-shell__helper-card"><Icon name="secure" className="w-5 h-5" /><h3>{t('schoolRosterOwnershipTitle')}</h3><p>{t('schoolRosterOwnershipHint')}</p></aside></div> : <EmptyState icon="school" title={t('schoolNoClasses')} />}</section>;

  const renderOverviewData = (tabId) => { const titles = { attendance: ['schoolAttendanceDashboardTitle', 'schoolAttendanceDashboardHint'], grades: ['schoolGradesDashboardTitle', 'schoolGradesDashboardHint'], behavior: ['schoolBehaviorDashboardTitle', 'schoolBehaviorDashboardHint'], reports: ['schoolReportsDashboardTitle', 'schoolReportsDashboardHint'], analytics: ['schoolAnalyticsDashboardTitle', 'schoolAnalyticsDashboardHint'] }; const [titleKey, hintKey] = titles[tabId]; const attendance = overview?.attendance_today || []; const behaviors = overview?.behavior_by_student || []; const subjects = overview?.subjects || []; return <section className="school-shell__workspace"><DataHeader title={t(titleKey)} description={t(hintKey)} classes={sortedClasses} selectedClassId={selectedClass?.id || ''} onSelect={(classId) => { setSelectedClassId(classId); void loadOverview(classId); }} onRefresh={() => void loadOverview()} loading={overviewLoading} t={t} />{overviewLoading && !overview ? <LoadingOverlay /> : !overview ? <EmptyState icon="analytics" title={t('schoolNoData')} /> : <><div className="school-shell__stats school-shell__stats--data"><Metric icon="user" label={t('schoolStudents')} value={overview.metrics?.student_count} /><Metric icon="reports" label={t('schoolGrades')} value={overview.metrics?.grade_entries} /><Metric icon="heart" label={t('schoolBehavior')} value={overview.metrics?.behavior_entries} /><Metric icon="check" label={t('schoolAttendanceToday')} value={overview.metrics?.attendance_entries_today} /></div>{tabId === 'attendance' && <div className="school-shell__report-grid">{attendance.map((session) => <article className="school-shell__data-card" key={session.id}><div className="school-shell__data-card-top"><span className="school-shell__mini-icon"><Icon name="check" className="w-4 h-4" /></span><div><h3>{session.subject_label} · {session.period_label || session.period_key}</h3><p>{session.starts_at || t('schoolRecordedAt')}</p></div></div><div className="school-shell__data-card-stats"><span>{t('schoolAttendancePresent')}: <b>{Math.max(0, Number(session.record_count || 0) - Number(session.absent_count || 0) - Number(session.late_count || 0) - Number(session.excused_count || 0))}</b></span><span>{t('schoolAttendanceAbsent')}: <b>{session.absent_count || 0}</b></span><span>{t('schoolAttendanceLate')}: <b>{session.late_count || 0}</b></span></div></article>)}{!attendance.length && <EmptyState icon="check" title={t('schoolNoData')} description={t('schoolAttendanceDashboardHint')} />}</div>}{tabId === 'grades' && <div className="school-shell__subject-report-grid">{subjects.map((subject) => <article className="school-shell__data-card" key={subject.subject_key}><div className="school-shell__data-card-top"><span className="school-shell__mini-icon"><Icon name="book" className="w-4 h-4" /></span><div><h3>{subject.subject_label}</h3><p>{subject.assigned_teacher_name || t('schoolNoTeacher')}</p></div></div><div className="school-shell__data-card-stats"><span>{t('schoolGradeCoverage')}: <b>{subject.graded_students}/{subject.student_grades?.length || 0}</b></span><span>{t('schoolGrades')}: <b>{subject.grade_entries}</b></span></div><div className="school-shell__final-grade-table">{(subject.student_grades || []).map((row) => <div key={row.student_id}><span>{row.full_name}</span><strong>{row.final_grade === null ? '—' : `${row.final_grade}%`}</strong></div>)}</div></article>)}{!subjects.length && <EmptyState icon="reports" title={t('schoolNoData')} />}</div>}{tabId === 'behavior' && <div className="school-shell__behavior-layout"><div className="school-shell__table-card"><div className="school-shell__table-heading"><div><h2>{t('schoolBehaviorByStudent')}</h2><p>{t('schoolBehaviorDashboardHint')}</p></div></div><div className="school-shell__table-wrap"><table><thead><tr><th>{t('schoolStudentName')}</th><th>{t('schoolPositivePoints')}</th><th>{t('schoolNegativePoints')}</th><th>{t('schoolBehaviorEntries')}</th></tr></thead><tbody>{behaviors.map((row) => <tr key={row.student_id}><td>{row.full_name}</td><td className="school-shell__positive">{row.behavior_points > 0 ? row.behavior_points : 0}</td><td className="school-shell__negative">{row.behavior_points < 0 ? Math.abs(row.behavior_points) : 0}</td><td>{row.behavior_count || 0}</td></tr>)}</tbody></table></div></div><div className="school-shell__detail-card"><h2>{t('schoolBehaviorDetails')}</h2>{(overview.behavior_details || []).slice(0, 30).map((row) => <div key={row.id}><strong>{row.full_name}</strong><span>{row.behavior_label} · {row.points > 0 ? '+' : ''}{row.points}</span><small>{row.note_text || '—'} · {displayDate(row.occurred_at, locale)}</small></div>)}{!overview.behavior_details?.length && <p>{t('schoolNoData')}</p>}</div></div>}{tabId === 'reports' && <div className="school-shell__official-report"><div><span className="school-shell__eyebrow">{t('schoolReportsDashboardTitle')}</span><h2>{overview.class?.name}</h2><p>{school?.school?.name} · {overview.class?.academic_year || '—'}</p></div><div className="school-shell__report-kpis"><Metric icon="user" label={t('schoolStudents')} value={overview.metrics?.student_count} /><Metric icon="book" label={t('schoolClassSubjects')} value={subjects.length} /><Metric icon="check" label={t('schoolAttendanceToday')} value={overview.metrics?.attendance_entries_today} /></div><div className="school-shell__subject-report-grid">{subjects.map((subject) => <article className="school-shell__data-card" key={subject.subject_key}><h3>{subject.subject_label}</h3><p>{t('schoolTeacher')}: {subject.assigned_teacher_name || t('schoolNoTeacher')}</p><div className="school-shell__final-grade-table">{(subject.student_grades || []).map((row) => <div key={row.student_id}><span>{row.full_name}</span><strong>{row.final_grade === null ? '—' : `${row.final_grade}%`}</strong></div>)}</div></article>)}</div></div>}{tabId === 'analytics' && <div className="school-shell__analytics-layout"><div className="school-shell__analytics-kpis"><Metric icon="school" label={t('schoolClasses')} value={1} /><Metric icon="user" label={t('schoolStudents')} value={overview.metrics?.student_count} /><Metric icon="link" label={t('schoolGrades')} value={overview.metrics?.grade_entries} /></div><div className="school-shell__attention-card"><div className="school-shell__table-heading"><div><h2>{t('schoolStudentsNeedingAttention')}</h2><p>{t('schoolAnalyticsDashboardHint')}</p></div></div>{(overview.students_needing_attention || []).map((row) => <div key={row.id || row.student_id} className="school-shell__attention-row"><span>{row.full_name}</span><b>{row.behavior_points} {t('schoolPoints')}</b><small>{row.behavior_count || 0} · {t('schoolBehaviorEntries')}</small></div>)}{!overview.students_needing_attention?.length && <p>{t('schoolNoData')}</p>}</div></div>}</>}</section>; };

  const renderTab = () => { if (activeTab === 'classes') return renderClassesTab(); if (activeTab === 'teachers') return renderTeachersTab(); if (activeTab === 'assignments') return renderAssignmentsTab(); if (activeTab === 'roster') return renderRosterTab(); return renderOverviewData(activeTab); };

  if (loading && !school && !schools.length) return <div className="school-shell" dir={direction}><LoadingOverlay /></div>;
  if (!schools.length) return <div className="school-shell" dir={direction}><div className="school-shell__topbar"><Link to="/" className="school-shell__back"><Icon name="arrowLeft" className="w-4 h-4" />{t('backToClasses')}</Link><span className="school-shell__brand"><Icon name="school" className="w-5 h-5" />EduCore</span></div>{renderNoSchool()}</div>;

  return <div className="school-shell" dir={direction}>
    <header className="school-shell__topbar"><div className="school-shell__topbar-main"><Link to="/" className="school-shell__back"><Icon name="arrowLeft" className="w-4 h-4" />{t('backToClasses')}</Link><span className="school-shell__brand"><Icon name="school" className="w-5 h-5" />EduCore</span></div><div className="school-shell__account"><span className="school-shell__account-avatar">{String(teacher?.full_name || teacher?.email || '?').trim().charAt(0)}</span><span>{isManager ? t('schoolRoleAdmin') : teacher?.subject || t('schoolRoleTeacher')}</span></div></header>
    {message && <div className="school-shell__feedback school-shell__feedback--success" role="status"><Icon name="check" className="w-4 h-4" />{message}<button type="button" onClick={() => setMessage('')} aria-label={t('close')}>×</button></div>}
    {error && <div className="school-shell__feedback school-shell__feedback--error" role="alert"><Icon name="alert" className="w-4 h-4" />{error}<button type="button" onClick={() => { setError(''); void loadSchools(selectedSchoolId); }}>{t('retry')}</button></div>}
    <section className="school-shell__hero"><div><span className="school-shell__eyebrow">{t('schoolManagementEyebrow')}</span><h1>{school?.school?.name || t('schoolManagementTitle')}</h1><p>{isManager ? t('schoolManagerHeroHint') : t('schoolTeacherHeroHint')}</p></div><div className="school-shell__hero-meta"><span><Icon name="users" className="w-4 h-4" />{t('schoolMemberCount', '', { count: school?.school?.member_count || 0 })}</span><span><Icon name="school" className="w-4 h-4" />{t('schoolClassCount', '', { count: school?.school?.class_count || 0 })}</span></div></section>
    <nav className="school-shell__tabs" role="tablist" aria-label={t('schoolManagementTitle')}>{tabs.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab.id} key={tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => selectTab(tab.id)}><Icon name={tab.icon} className="w-4 h-4" /><span>{t(tab.key)}</span></button>)}</nav>
    {renderTab()}
    {visibleCode && <div className="school-shell__dialog-backdrop" role="presentation" onClick={() => setVisibleCode(null)}><section className="school-shell__dialog" role="dialog" aria-modal="true" aria-labelledby="school-code-dialog-title" onClick={(event) => event.stopPropagation()}><button type="button" className="school-shell__dialog-close utility-icon" onClick={() => setVisibleCode(null)} aria-label={t('schoolCodeDialogClose')} title={t('schoolCodeDialogClose')}>×</button><span className="school-shell__setup-icon"><Icon name="lock" className="w-6 h-6" /></span><span className="school-shell__eyebrow">{t('schoolCodeDialogEyebrow')}</span><h2 id="school-code-dialog-title">{t('schoolCodeDialogTitle')}</h2><p>{t('schoolCodeDialogHint', '', { className: visibleCode.class_name || t('schoolClasses') })}</p><code className="school-shell__code-value" dir="ltr">{visibleCode.code}</code><div className="school-shell__dialog-actions"><button type="button" className="btn-primary" onClick={() => void copyCode(visibleCode.code)}><Icon name="copy" className="w-4 h-4" />{t('schoolCopyCode')}</button><button type="button" className="btn-secondary" onClick={() => setVisibleCode(null)}>{t('schoolCodeDialogClose')}</button></div><small>{t('schoolCodeOneTimeNote')}</small></section></div>}
  </div>;
}
