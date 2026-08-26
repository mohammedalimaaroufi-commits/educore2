import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getLocalFirst } from '../api/client';
import CompactPageHeader from '../components/CompactPageHeader.jsx';
import Icon from '../components/Icon.jsx';
import LoadingOverlay from '../components/LoadingOverlay.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

const EMPTY_CLASS_FORM = { name: '', subjects: '', academic_year: '', color: '#2E7D6B' };
const EMPTY_STUDENT_FORM = { full_name: '', student_number: '' };

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
    CLASS_SUBJECT_REQUIRED: 'schoolClassSubjectsHint',
  };
  return messages[code] ? t(messages[code]) : t('schoolActionError');
}

function Metric({ icon, label, value }) {
  return <div className="school-management__metric"><Icon name={icon} className="w-4 h-4" /><span>{label}</span><strong>{value ?? 0}</strong></div>;
}

function SubjectRow({ subject, isManager, busy, onGenerate, onRevoke, t }) {
  return <div className="school-management__subject-row">
    <div className="school-management__subject-main"><span className="school-management__subject-icon"><Icon name="book" className="w-4 h-4" /></span><div><strong>{subject.subject_label || subject.subject_key}</strong><span>{subject.assigned_teacher_name || t('schoolNoTeacher')}</span></div></div>
    <div className="school-management__subject-actions">
      {subject.assigned_teacher_name && <span className="school-management__assigned-chip"><Icon name="user" className="w-3.5 h-3.5" />{subject.assigned_teacher_name}</span>}
      {isManager && subject.assignment_id && <button type="button" className="utility-icon utility-icon--danger" onClick={() => onRevoke(subject)} disabled={busy} aria-label={t('schoolRevokeAssignment')} title={t('schoolRevokeAssignment')}><Icon name="x" className="w-4 h-4" /></button>}
      {isManager && <button type="button" className="school-management__code-button" onClick={() => onGenerate(subject)} disabled={busy}><Icon name="lock" className="w-4 h-4" />{t('schoolGenerateCode')}</button>}
    </div>
  </div>;
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
  const [assignmentCode, setAssignmentCode] = useState('');
  const [classForm, setClassForm] = useState(EMPTY_CLASS_FORM);
  const [subjectDrafts, setSubjectDrafts] = useState({});
  const [generatedCodes, setGeneratedCodes] = useState({});
  const [visibleCode, setVisibleCode] = useState(null);
  const [overview, setOverview] = useState(null);
  const [rosterClassId, setRosterClassId] = useState('');
  const [roster, setRoster] = useState([]);
  const [studentForm, setStudentForm] = useState(EMPTY_STUDENT_FORM);
  const [editingClassId, setEditingClassId] = useState('');
  const [classEditForm, setClassEditForm] = useState({ name: '', academic_year: '', color: '' });

  const selectedMembership = school?.membership;
  const isManager = teacher?.account_role === 'school_manager' && selectedMembership?.role === 'school_admin';
  const sortedClasses = useMemo(() => [...(school?.classes || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), locale === 'ar' ? 'ar' : 'en')), [school?.classes, locale]);
  const rosterClass = sortedClasses.find((item) => item.id === rosterClassId) || sortedClasses[0] || null;

  const setFailure = (requestError) => { setError(apiMessage(requestError, t)); setMessage(''); };

  const loadSchool = async (schoolId) => {
    if (!schoolId) return;
    try {
      const { data } = await api.get(`/schools/${schoolId}`);
      setSchool(data);
      setSelectedSchoolId(schoolId);
      if (data?.classes?.length && !rosterClassId) setRosterClassId(data.classes[0].id);
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
      setError('');
    } catch (requestError) { setFailure(requestError); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadSchools(); }, []);

  const loadRoster = async (classId = rosterClass?.id) => {
    if (!isManager || !selectedSchoolId || !classId) return;
    setBusy(`roster:${classId}`);
    try {
      const { data } = await api.get(`/schools/${selectedSchoolId}/classes/${classId}/students`);
      setRoster(data.students || []);
      setRosterClassId(classId);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  useEffect(() => { if (isManager && rosterClass?.id) void loadRoster(rosterClass.id); }, [isManager, rosterClass?.id, selectedSchoolId]);

  const acceptAssignment = async (event) => {
    event.preventDefault();
    if (!assignmentCode.trim() || busy) return;
    setBusy('assignment');
    try {
      const { data } = await api.post('/schools/accept-assignment', { code: assignmentCode.trim() });
      setAssignmentCode(''); setMessage(t('schoolAssignmentAccepted')); await loadSchools(data?.school?.school?.id || selectedSchoolId);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const createClass = async (event) => {
    event.preventDefault();
    const subjects = classForm.subjects.split(',').map((item) => item.trim()).filter(Boolean);
    if (!selectedSchoolId || busy || !classForm.name.trim() || !subjects.length) return;
    setBusy('class');
    try {
      await api.post(`/schools/${selectedSchoolId}/classes`, { ...classForm, subject: subjects[0], subjects });
      setClassForm(EMPTY_CLASS_FORM); setMessage(t('schoolClassCreated')); await loadSchool(selectedSchoolId);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const addSubject = async (classId) => {
    const subject = String(subjectDrafts[classId] || '').trim();
    if (!subject || busy) return;
    setBusy(`subject:${classId}`);
    try {
      await api.post(`/schools/${selectedSchoolId}/classes/${classId}/subjects`, { subject_label: subject });
      setSubjectDrafts((current) => ({ ...current, [classId]: '' })); setMessage(t('schoolAddSubject')); await loadSchool(selectedSchoolId);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const generateCode = async (classId, subject) => {
    const key = `${classId}:${subject.subject_key}`;
    if (busy) return;
    setBusy(`code:${key}`);
    try {
      const { data } = await api.post(`/schools/${selectedSchoolId}/classes/${classId}/assignment-code`, { subject_key: subject.subject_key, max_uses: 1, expires_days: 7 });
      const codeData = { ...data, class_name: `${classId}:${subject.subject_label}` };
      setGeneratedCodes((current) => ({ ...current, [key]: codeData })); setVisibleCode(codeData); setMessage(t('schoolCodeGenerated'));
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const revokeAssignment = async (classId, subject) => {
    if (!subject.assignment_id || busy) return;
    if (!window.confirm(t('schoolRevokeConfirm'))) return;
    setBusy(`revoke:${subject.assignment_id}`);
    try {
      await api.delete(`/schools/${selectedSchoolId}/assignments/${subject.assignment_id}`); setMessage(t('schoolAssignmentRevoked')); await loadSchool(selectedSchoolId);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const openOverview = async (classId) => {
    setBusy(`overview:${classId}`);
    try { const { data } = await api.get(`/schools/${selectedSchoolId}/classes/${classId}/overview`); setOverview(data); }
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
    if (!rosterClass?.id || !studentForm.full_name.trim() || busy) return;
    setBusy('student');
    try {
      await api.post(`/schools/${selectedSchoolId}/classes/${rosterClass.id}/students`, studentForm);
      setStudentForm(EMPTY_STUDENT_FORM); setMessage(t('schoolStudentAdded')); await Promise.all([loadRoster(rosterClass.id), loadSchool(selectedSchoolId)]);
    } catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const archiveStudent = async (student) => {
    if (busy) return;
    setBusy(`archive-student:${student.id}`);
    try { await api.patch(`/schools/${selectedSchoolId}/classes/${rosterClass.id}/students/${student.id}/archive`); setMessage(t('schoolStudentArchived')); await loadRoster(rosterClass.id); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const restoreStudent = async (student) => {
    if (busy) return;
    setBusy(`restore-student:${student.id}`);
    try { await api.patch(`/schools/${selectedSchoolId}/classes/${rosterClass.id}/students/${student.id}/restore`); setMessage(t('schoolStudentRestored')); await loadRoster(rosterClass.id); }
    catch (requestError) { setFailure(requestError); }
    finally { setBusy(''); }
  };

  const copyCode = async (code) => {
    try { await navigator.clipboard.writeText(code); setMessage(t('schoolCodeCopied')); } catch { setMessage(code); }
  };

  const renderSetup = () => <section className="school-management__setup-grid"><article className="school-management__setup-card"><span className="school-management__card-icon"><Icon name="school" className="w-5 h-5" /></span><div><span className="eyebrow">{t('schoolManagementEyebrow')}</span><h2>{t('schoolProvisioningTitle')}</h2><p>{t('schoolProvisioningHint')}</p></div><div className="school-management__setup-note"><Icon name="secure" className="w-4 h-4" /><span>{t('schoolPersonalClassesNote')}</span></div></article><form className="school-management__setup-card school-management__setup-card--accent" onSubmit={acceptAssignment}><span className="school-management__card-icon"><Icon name="lock" className="w-5 h-5" /></span><div><span className="eyebrow">{t('schoolManagement')}</span><h2>{t('schoolJoinTitle')}</h2><p>{t('schoolJoinHint')}</p></div><label><span>{t('schoolAssignmentCode')}</span><input value={assignmentCode} onChange={(event) => setAssignmentCode(event.target.value)} placeholder={t('schoolAssignmentCodePlaceholder')} maxLength={40} required /></label><button type="submit" className="btn-primary" disabled={busy === 'assignment'}>{busy === 'assignment' ? t('saving') : t('schoolAcceptAssignment')}</button></form></section>;

  return <div className="school-management" dir={direction}>
    <CompactPageHeader backTo="/" backLabel={t('backToClasses')} eyebrow={t('schoolManagementEyebrow')} title={t('schoolManagementTitle')} subtitle={t('schoolManagementDescription')}><div className="school-management__header-badge"><Icon name="school" className="w-4 h-4" /><span>{isManager ? t('schoolRoleAdmin') : teacher?.subject || t('schoolManagement')}</span></div></CompactPageHeader>
    {message && <div className="school-management__feedback school-management__feedback--success" role="status">{message}</div>}
    {error && <div className="school-management__feedback school-management__feedback--error" role="alert">{error}<button type="button" onClick={() => loadSchools(selectedSchoolId)}>{t('retry')}</button></div>}
    {loading && !school && schools.length === 0 ? <LoadingOverlay /> : schools.length === 0 ? <>{renderSetup()}<p className="school-management__privacy"><Icon name="secure" className="w-4 h-4" />{t('schoolPersonalClassesNote')}</p></> : <>
      <section className="school-management__selector-row"><label><span>{t('schoolChoose')}</span><select value={selectedSchoolId} onChange={(event) => { setSelectedSchoolId(event.target.value); void loadSchool(event.target.value); }}><option value="" disabled>{t('schoolChoose')}</option>{schools.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role === 'school_admin' ? t('schoolRoleAdmin') : t('schoolRoleTeacher')}</option>)}</select></label><div className="school-management__role"><Icon name={isManager ? 'settings' : 'user'} className="w-4 h-4" />{isManager ? t('schoolRoleAdmin') : t('schoolRoleTeacher')}</div></section>
      {school && <>
        <section className="school-management__school-banner"><div><span className="eyebrow">{t('schoolManagementEyebrow')}</span><h2>{school.school.name}</h2><p>{isManager ? t('schoolStudentsManagedBySchool') : t('schoolPersonalClassesNote')}</p></div><div className="school-management__banner-stats"><span>{t('schoolMemberCount', '', { count: school.school.member_count })}</span><span>{t('schoolClassCount', '', { count: school.school.class_count })}</span></div></section>
        {isManager && <form className="school-management__class-form" onSubmit={createClass}><div><strong>{t('schoolCreateClassTitle')}</strong><span>{t('schoolClassSubjectsHint')}</span></div><label><span>{t('schoolClassName')}</span><input value={classForm.name} onChange={(event) => setClassForm((current) => ({ ...current, name: event.target.value }))} placeholder={t('schoolClassNamePlaceholder')} required /></label><label><span>{t('schoolClassSubjects')}</span><input value={classForm.subjects} onChange={(event) => setClassForm((current) => ({ ...current, subjects: event.target.value }))} placeholder={t('schoolSubjectListPlaceholder')} required /></label><label><span>{t('schoolAcademicYear')}</span><input value={classForm.academic_year} onChange={(event) => setClassForm((current) => ({ ...current, academic_year: event.target.value }))} placeholder={t('schoolAcademicYearPlaceholder')} /></label><button type="submit" className="btn-primary" disabled={busy === 'class'}>{busy === 'class' ? t('saving') : <><Icon name="plus" className="w-4 h-4" />{t('schoolCreateClass')}</>}</button></form>}
        <section className="school-management__main-grid"><div className="school-management__panel"><div className="school-management__panel-heading"><div><span className="eyebrow">{t('schoolClasses')}</span><h2>{t('schoolClasses')}</h2></div><span>{school.classes.length}</span></div><div className="school-management__classes">{sortedClasses.map((classItem) => <article className="school-management__class-card" key={classItem.id}><div className="school-management__class-heading"><div><strong>{classItem.name}</strong><span><Icon name="school" className="w-3.5 h-3.5" />{t('schoolManagedClass')} · {classItem.academic_year || '—'}</span></div><span className="school-management__class-dot" style={{ background: classItem.color || '#2E7D6B' }} /></div>{isManager && <div className="school-management__class-admin-actions"><button type="button" className="utility-icon" onClick={() => beginEditClass(classItem)} aria-label={t('schoolEditClass')} title={t('schoolEditClass')}><Icon name="edit" className="w-4 h-4" /></button><button type="button" className="utility-icon utility-icon--danger" onClick={() => void archiveClass(classItem.id)} aria-label={t('schoolArchiveClass')} title={t('schoolArchiveClass')}><Icon name="archive" className="w-4 h-4" /></button></div>}{editingClassId === classItem.id && <form className="school-management__class-edit" onSubmit={(event) => void saveClassEdit(event, classItem.id)}><input value={classEditForm.name} onChange={(event) => setClassEditForm((current) => ({ ...current, name: event.target.value }))} aria-label={t('schoolClassName')} required /><input value={classEditForm.academic_year} onChange={(event) => setClassEditForm((current) => ({ ...current, academic_year: event.target.value }))} aria-label={t('schoolAcademicYear')} placeholder={t('schoolAcademicYearPlaceholder')} /><div><button type="submit" className="btn-primary" disabled={busy === `edit-class:${classItem.id}`}>{t('save')}</button><button type="button" className="btn-secondary" onClick={() => setEditingClassId('')}>{t('cancel')}</button></div></form>}<div className="school-management__class-metrics"><Metric icon="user" label={t('schoolStudents')} value={classItem.student_count} /><Metric icon="book" label={t('schoolClassSubjects')} value={classItem.subject_count} /><Metric icon="user" label={t('schoolMembers')} value={classItem.assigned_teacher_count} /><Metric icon="check" label={t('schoolAttendanceToday')} value={classItem.attendance_session_count} /></div><div className="school-management__subjects-heading"><strong>{t('schoolClassSubjects')}</strong><span>{t('schoolAssignedTeacherCount', '', { count: classItem.assigned_teacher_count })}</span></div><div className="school-management__subjects">{(classItem.subjects || []).map((subject) => <SubjectRow key={subject.subject_key} subject={subject} isManager={isManager} busy={busy === `code:${classItem.id}:${subject.subject_key}` || busy === `revoke:${subject.assignment_id}`} onGenerate={(item) => void generateCode(classItem.id, item)} onRevoke={(item) => void revokeAssignment(classItem.id, item)} t={t} />)}</div>{isManager && <div className="school-management__add-subject"><input value={subjectDrafts[classItem.id] || ''} onChange={(event) => setSubjectDrafts((current) => ({ ...current, [classItem.id]: event.target.value }))} placeholder={t('schoolAddSubject')} /><button type="button" className="btn-secondary" onClick={() => void addSubject(classItem.id)} disabled={busy === `subject:${classItem.id}`}><Icon name="plus" className="w-4 h-4" />{t('schoolAddSubject')}</button></div>}<div className="school-management__class-actions"><button type="button" className="btn-secondary" onClick={() => void openOverview(classItem.id)} disabled={busy === `overview:${classItem.id}`}><Icon name="analytics" className="w-4 h-4" />{t('schoolViewOverview')}</button>{!isManager && classItem.assigned_teacher_id === teacher?.id && <Link className="btn-secondary" to={`/classes/${classItem.id}`}><Icon name="externalLink" className="w-4 h-4" />{t('schoolOpenClass')}</Link>}{isManager && <button type="button" className="btn-secondary" onClick={() => void loadRoster(classItem.id)}><Icon name="user" className="w-4 h-4" />{t('schoolStudentsManagedBySchool')}</button>}</div>{(classItem.subjects || []).map((subject) => { const key = `${classItem.id}:${subject.subject_key}`; const code = generatedCodes[key]; return code ? <div className="school-management__generated-code" key={key}><div><strong>{subject.subject_label}: {code.code}</strong><span>{t('schoolCodeExpires', '', { date: displayDate(code.expires_at, locale) })}</span></div><button type="button" onClick={() => copyCode(code.code)}>{t('schoolCopyCode')}</button></div> : null; })}</article>)}{sortedClasses.length === 0 && <div className="school-management__empty">{t('schoolNoClasses')}</div>}</div></div>{isManager && <div className="school-management__panel"><div className="school-management__panel-heading"><div><span className="eyebrow">{t('schoolMembers')}</span><h2>{t('schoolMembers')}</h2></div><span>{school.members.length}</span></div><div className="school-management__members">{school.members.map((member) => <div className="school-management__member" key={member.id}><span className="school-management__member-avatar">{String(member.full_name || '?').trim().charAt(0)}</span><div><strong>{member.full_name}</strong><span>{member.subject || '—'} · {member.role === 'school_admin' ? t('schoolRoleAdmin') : t('schoolRoleTeacher')}</span></div></div>)}{school.members.length === 0 && <div className="school-management__empty">{t('schoolNoMembers')}</div>}</div></div>}</section>
        {isManager && rosterClass && <section className="school-management__roster-panel school-management__panel"><div className="school-management__panel-heading"><div><span className="eyebrow">{t('schoolStudentsManagedBySchool')}</span><h2>{rosterClass.name}</h2></div><select value={rosterClass.id} onChange={(event) => void loadRoster(event.target.value)} aria-label={t('schoolChoose')}>{sortedClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><form className="school-management__student-form" onSubmit={addStudent}><input value={studentForm.full_name} onChange={(event) => setStudentForm((current) => ({ ...current, full_name: event.target.value }))} placeholder={t('schoolStudentNamePlaceholder')} aria-label={t('schoolStudentName')} required /><input value={studentForm.student_number} onChange={(event) => setStudentForm((current) => ({ ...current, student_number: event.target.value }))} placeholder={t('schoolStudentNumberPlaceholder')} aria-label={t('schoolStudentNumber')} /><button type="submit" className="btn-primary" disabled={busy === 'student'}><Icon name="plus" className="w-4 h-4" />{t('schoolAddStudent')}</button></form><div className="school-management__roster-list">{roster.map((student) => <div className={`school-management__roster-row ${student.archived ? 'is-archived' : ''}`} key={student.id}><div><strong>{student.full_name}</strong><span>{student.student_number || '—'}</span></div>{student.archived ? <button type="button" className="btn-secondary" onClick={() => void restoreStudent(student)}>{t('restore')}</button> : <button type="button" className="utility-icon utility-icon--danger" onClick={() => void archiveStudent(student)} aria-label={t('archive')} title={t('archive')}><Icon name="archive" className="w-4 h-4" /></button>}</div>)}{!roster.length && <div className="school-management__empty">{t('schoolNoData')}</div>}</div></section>}
        {overview && <section className="school-management__overview school-management__panel"><div className="school-management__panel-heading"><div><span className="eyebrow">{t('schoolMetrics')}</span><h2>{overview.class?.name}</h2><p>{t('schoolSubjectGradeOverview')}</p></div><button type="button" className="utility-icon" onClick={() => setOverview(null)} aria-label={t('close')} title={t('close')}>×</button></div><div className="school-management__overview-metrics"><Metric icon="user" label={t('schoolStudents')} value={overview.metrics?.student_count} /><Metric icon="reports" label={t('schoolGrades')} value={overview.metrics?.grade_entries} /><Metric icon="heart" label={t('schoolBehavior')} value={overview.metrics?.behavior_entries} /><Metric icon="check" label={t('schoolAttendanceToday')} value={overview.metrics?.attendance_entries_today} /></div><div className="school-management__report-grid"><div><h3>{t('schoolSubjectGradeOverview')}</h3>{(overview.subjects || []).map((subject) => <div className="school-management__report-card" key={subject.subject_key}><strong>{subject.subject_label}</strong><span>{subject.assigned_teacher_name || t('schoolNoTeacher')}</span><small>{t('schoolGradeCoverage')}: {subject.graded_students}/{subject.student_grades?.length || 0} · {t('schoolGrades')}: {subject.grade_entries}</small><div className="school-management__report-table">{(subject.student_grades || []).slice(0, 12).map((row) => <div key={row.student_id}><span>{row.full_name}</span><strong>{row.final_grade === null ? '—' : `${row.final_grade}%`}</strong></div>)}</div></div>)}{!overview.subjects?.length && <p>{t('schoolNoData')}</p>}</div><div><h3>{t('schoolAttendanceToday')}</h3>{(overview.attendance_today || []).map((session) => <div className="school-management__report-card" key={session.id}><strong>{session.subject_label} · {session.period_label || session.period_key}</strong><span>{session.starts_at || t('schoolRecordedAt')}</span><small>{t('schoolAttendanceAbsent')}: {session.absent_count} · {t('schoolAttendanceLate')}: {session.late_count} · {t('schoolStudents')}: {session.record_count}</small></div>)}{!overview.attendance_today?.length && <p>{t('schoolNoData')}</p>}<h3>{t('schoolBehaviorDetails')}</h3><div className="school-management__report-table">{(overview.behavior_details || []).slice(0, 20).map((row) => <div key={row.id}><span>{row.full_name} · {row.behavior_label}</span><small>{row.note_text || '—'} · {displayDate(row.occurred_at, locale)}</small></div>)}{!overview.behavior_details?.length && <p>{t('schoolNoData')}</p>}</div></div></div></section>}
      </>}
    </>}
    {visibleCode && <div className="school-code-dialog-backdrop" role="presentation" onClick={() => setVisibleCode(null)}><section className="school-code-dialog" role="dialog" aria-modal="true" aria-labelledby="school-code-dialog-title" onClick={(event) => event.stopPropagation()}><button type="button" className="school-code-dialog__close utility-icon" onClick={() => setVisibleCode(null)} aria-label={t('schoolCodeDialogClose')} title={t('schoolCodeDialogClose')}>×</button><span className="school-management__card-icon"><Icon name="lock" className="w-5 h-5" /></span><span className="eyebrow">{t('schoolCodeDialogEyebrow')}</span><h2 id="school-code-dialog-title">{t('schoolCodeDialogTitle')}</h2><p>{t('schoolCodeDialogHint', '', { className: visibleCode.class_name || t('schoolClasses') })}</p><code className="school-code-dialog__value" dir="ltr">{visibleCode.code}</code><div className="school-code-dialog__actions"><button type="button" className="btn-primary" onClick={() => copyCode(visibleCode.code)}><Icon name="copy" className="w-4 h-4" />{t('schoolCopyCode')}</button><button type="button" className="btn-secondary" onClick={() => setVisibleCode(null)}>{t('schoolCodeDialogClose')}</button></div><small>{t('schoolCodeOneTimeNote')}</small></section></div>}
  </div>;
}
