import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getLocalFirst } from '../api/client';
import CompactPageHeader from '../components/CompactPageHeader.jsx';
import Icon from '../components/Icon.jsx';
import LoadingOverlay from '../components/LoadingOverlay.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

const EMPTY_CLASS_FORM = { name: '', subject: '', academic_year: '' };

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
  };
  return messages[code] ? t(messages[code]) : t('schoolActionError');
}

function Metric({ icon, label, value }) {
  return <div className="school-management__metric"><Icon name={icon} className="w-4 h-4" /><span>{label}</span><strong>{value ?? 0}</strong></div>;
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
  const [schoolName, setSchoolName] = useState('');
  const [assignmentCode, setAssignmentCode] = useState('');
  const [classForm, setClassForm] = useState(EMPTY_CLASS_FORM);
  const [generatedCodes, setGeneratedCodes] = useState({});
  const [overview, setOverview] = useState(null);

  const selectedMembership = school?.membership;
  const isManager = teacher?.account_role === 'school_manager' && selectedMembership?.role === 'school_admin';
  const sortedClasses = useMemo(() => [...(school?.classes || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), locale === 'ar' ? 'ar' : 'en')), [school?.classes, locale]);

  const setFailure = (requestError) => {
    setError(apiMessage(requestError, t));
    setMessage('');
  };

  const loadSchools = async (preferredId = '') => {
    setLoading(true);
    try {
      const response = await getLocalFirst('/schools');
      const items = response?.data?.schools || [];
      setSchools(items);
      const nextId = preferredId || selectedSchoolId || items[0]?.id || '';
      setSelectedSchoolId(nextId);
      if (response?.fromLocalCache) {
        void response.revalidatePromise?.then((freshResponse) => {
          const freshItems = freshResponse?.data?.schools || [];
          setSchools(freshItems);
          const freshId = preferredId || nextId || freshItems[0]?.id || '';
          setSelectedSchoolId(freshId);
        });
      }
      if (nextId) await loadSchool(nextId);
      else setSchool(null);
      setError('');
    } catch (requestError) {
      setFailure(requestError);
    } finally {
      setLoading(false);
    }
  };

  const loadSchool = async (schoolId) => {
    if (!schoolId) return;
    try {
      const { data } = await api.get(`/schools/${schoolId}`);
      setSchool(data);
      setSelectedSchoolId(schoolId);
    } catch (requestError) {
      setFailure(requestError);
    }
  };

  useEffect(() => { void loadSchools(); }, []);

  const createSchool = async (event) => {
    event.preventDefault();
    if (!schoolName.trim() || busy) return;
    setBusy('school');
    try {
      const { data } = await api.post('/schools', { name: schoolName.trim() });
      setSchoolName('');
      setMessage(t('schoolCreated'));
      await loadSchools(data?.school?.id || data?.school?.id);
    } catch (requestError) {
      setFailure(requestError);
    } finally {
      setBusy('');
    }
  };

  const acceptAssignment = async (event) => {
    event.preventDefault();
    if (!assignmentCode.trim() || busy) return;
    setBusy('assignment');
    try {
      const { data } = await api.post('/schools/accept-assignment', { code: assignmentCode.trim() });
      setAssignmentCode('');
      setMessage(t('schoolAssignmentAccepted'));
      await loadSchools(data?.school?.school?.id || '');
    } catch (requestError) {
      setFailure(requestError);
    } finally {
      setBusy('');
    }
  };

  const createClass = async (event) => {
    event.preventDefault();
    if (!selectedSchoolId || busy || !classForm.name.trim()) return;
    setBusy('class');
    try {
      await api.post(`/schools/${selectedSchoolId}/classes`, classForm);
      setClassForm(EMPTY_CLASS_FORM);
      setMessage(t('schoolClassCreated'));
      await loadSchool(selectedSchoolId);
    } catch (requestError) {
      setFailure(requestError);
    } finally {
      setBusy('');
    }
  };

  const revokeAssignment = async (classItem) => {
    if (!isManager || !classItem.assignment_id || busy) return;
    if (!window.confirm(t('schoolRevokeConfirm'))) return;
    setBusy(`revoke:${classItem.id}`);
    try {
      await api.delete(`/schools/${selectedSchoolId}/assignments/${classItem.assignment_id}`);
      setMessage(t('schoolAssignmentRevoked'));
      await loadSchool(selectedSchoolId);
    } catch (requestError) {
      setFailure(requestError);
    } finally {
      setBusy('');
    }
  };

  const generateCode = async (classId) => {
    if (busy) return;
    setBusy(`code:${classId}`);
    try {
      const { data } = await api.post(`/schools/${selectedSchoolId}/classes/${classId}/assignment-code`, { max_uses: 1, expires_days: 7 });
      setGeneratedCodes((current) => ({ ...current, [classId]: data }));
      setMessage(t('schoolCodeGenerated'));
    } catch (requestError) {
      setFailure(requestError);
    } finally {
      setBusy('');
    }
  };

  const openOverview = async (classId) => {
    setBusy(`overview:${classId}`);
    try {
      const { data } = await api.get(`/schools/${selectedSchoolId}/classes/${classId}/overview`);
      setOverview(data);
    } catch (requestError) {
      setFailure(requestError);
    } finally {
      setBusy('');
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setMessage(t('schoolCodeCopied'));
    } catch {
      setMessage(code);
    }
  };

  const renderSetup = () => <section className="school-management__setup-grid">
    <article className="school-management__setup-card">
      <span className="school-management__card-icon"><Icon name="school" className="w-5 h-5" /></span>
      <div><span className="eyebrow">{t('schoolManagementEyebrow')}</span><h2>{t('schoolProvisioningTitle')}</h2><p>{t('schoolProvisioningHint')}</p></div>
      <div className="school-management__setup-note"><Icon name="secure" className="w-4 h-4" /><span>{t('schoolPersonalClassesNote')}</span></div>
    </article>
    <form className="school-management__setup-card school-management__setup-card--accent" onSubmit={acceptAssignment}>
      <span className="school-management__card-icon"><Icon name="lock" className="w-5 h-5" /></span>
      <div><span className="eyebrow">{t('schoolManagement')}</span><h2>{t('schoolJoinTitle')}</h2><p>{t('schoolJoinHint')}</p></div>
      <label><span>{t('schoolAssignmentCode')}</span><input value={assignmentCode} onChange={(event) => setAssignmentCode(event.target.value)} placeholder={t('schoolAssignmentCodePlaceholder')} maxLength={40} required /></label>
      <button type="submit" className="btn-primary" disabled={busy === 'assignment'}>{busy === 'assignment' ? t('saving') : t('schoolAcceptAssignment')}</button>
    </form>
  </section>;

  return <div className="school-management" dir={direction}>
    <CompactPageHeader backTo="/" backLabel={t('backToClasses')} eyebrow={t('schoolManagementEyebrow')} title={t('schoolManagementTitle')} subtitle={t('schoolManagementDescription')}>
      <div className="school-management__header-badge"><Icon name="school" className="w-4 h-4" /><span>{teacher?.subject || t('schoolManagement')}</span></div>
    </CompactPageHeader>

    {message && <div className="school-management__feedback school-management__feedback--success" role="status">{message}</div>}
    {error && <div className="school-management__feedback school-management__feedback--error" role="alert">{error}<button type="button" onClick={() => loadSchools(selectedSchoolId)}>{t('retry')}</button></div>}

    {loading && !school && schools.length === 0 ? <LoadingOverlay /> : schools.length === 0 ? <>{renderSetup()}<p className="school-management__privacy"><Icon name="secure" className="w-4 h-4" />{t('schoolPersonalClassesNote')}</p></> : <>
      <section className="school-management__selector-row">
        <label><span>{t('schoolChoose')}</span><select value={selectedSchoolId} onChange={(event) => { setSelectedSchoolId(event.target.value); void loadSchool(event.target.value); }}><option value="" disabled>{t('schoolChoose')}</option>{schools.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role === 'school_admin' ? t('schoolRoleAdmin') : t('schoolRoleTeacher')}</option>)}</select></label>
        <div className="school-management__role"><Icon name={isManager ? 'settings' : 'user'} className="w-4 h-4" />{isManager ? t('schoolRoleAdmin') : t('schoolRoleTeacher')}</div>
      </section>
      {school && <>
        <section className="school-management__school-banner"><div><span className="eyebrow">{t('schoolManagementEyebrow')}</span><h2>{school.school.name}</h2><p>{t('schoolPersonalClassesNote')}</p></div><div className="school-management__banner-stats"><span>{t('schoolMemberCount', '', { count: school.school.member_count })}</span><span>{t('schoolClassCount', '', { count: school.school.class_count })}</span></div></section>
        {isManager && <form className="school-management__class-form" onSubmit={createClass}><div><strong>{t('schoolCreateClassTitle')}</strong><span>{t('schoolCreateClassHint')}</span></div><label><span>{t('schoolClassName')}</span><input value={classForm.name} onChange={(event) => setClassForm((current) => ({ ...current, name: event.target.value }))} placeholder={t('schoolClassNamePlaceholder')} required /></label><label><span>{t('schoolClassSubject')}</span><input value={classForm.subject} onChange={(event) => setClassForm((current) => ({ ...current, subject: event.target.value }))} placeholder={t('schoolClassSubjectPlaceholder')} required /></label><label><span>{t('schoolAcademicYear')}</span><input value={classForm.academic_year} onChange={(event) => setClassForm((current) => ({ ...current, academic_year: event.target.value }))} placeholder={t('schoolAcademicYearPlaceholder')} /></label><button type="submit" className="btn-primary" disabled={busy === 'class'}>{busy === 'class' ? t('saving') : <><Icon name="plus" className="w-4 h-4" />{t('schoolCreateClass')}</>}</button></form>}
        <section className="school-management__main-grid">
          <div className="school-management__panel"><div className="school-management__panel-heading"><div><span className="eyebrow">{t('schoolClasses')}</span><h2>{t('schoolClasses')}</h2></div><span>{school.classes.length}</span></div><div className="school-management__classes">{sortedClasses.map((classItem) => { const code = generatedCodes[classItem.id]; return <article className="school-management__class-card" key={classItem.id}><div className="school-management__class-heading"><div><strong>{classItem.name}</strong><span>{classItem.subject || '—'} · {classItem.academic_year || '—'}</span></div><span className="school-management__class-dot" style={{ background: classItem.color || '#2E7D6B' }} /></div><div className="school-management__class-metrics"><Metric icon="user" label={t('schoolStudents')} value={classItem.student_count} /><Metric icon="reports" label={t('schoolCategories')} value={classItem.category_count} /><Metric icon="heart" label={t('schoolBehavior')} value={classItem.behavior_count} /><Metric icon="check" label={t('schoolAttendance')} value={classItem.attendance_session_count} /></div><div className="school-management__assignment"><span>{t('schoolAssignedTeacher')}</span><strong>{classItem.assigned_teacher_name || t('schoolUnassigned')}</strong></div><div className="school-management__class-actions"><button type="button" className="btn-secondary" onClick={() => openOverview(classItem.id)} disabled={busy === `overview:${classItem.id}`}><Icon name="analytics" className="w-4 h-4" />{t('schoolViewOverview')}</button>{classItem.assigned_teacher_id === teacher?.id && <Link className="btn-secondary" to={`/classes/${classItem.id}`}><Icon name="externalLink" className="w-4 h-4" />{t('schoolOpenClass')}</Link>}
{isManager && <>{classItem.assigned_teacher_id && <button type="button" className="btn-secondary" onClick={() => revokeAssignment(classItem)} disabled={busy === `revoke:${classItem.id}`}><Icon name="x" className="w-4 h-4" />{t('schoolRevokeAssignment')}</button>}<button type="button" className="school-management__code-button" onClick={() => generateCode(classItem.id)} disabled={busy === `code:${classItem.id}`}><Icon name="lock" className="w-4 h-4" />{t('schoolGenerateCode')}</button></>}
</div>{code && <div className="school-management__generated-code"><div><strong>{code.code}</strong><span>{t('schoolCodeExpires', '', { date: displayDate(code.expires_at, locale) })} · {t('schoolCodeUses', '', { used: 0, max: code.max_uses })}</span></div><button type="button" onClick={() => copyCode(code.code)}>{t('schoolCopyCode')}</button></div>}</article>; })}{sortedClasses.length === 0 && <div className="school-management__empty">{t('schoolNoClasses')}</div>}</div></div>
          {isManager && <div className="school-management__panel"><div className="school-management__panel-heading"><div><span className="eyebrow">{t('schoolMembers')}</span><h2>{t('schoolMembers')}</h2></div><span>{school.members.length}</span></div><div className="school-management__members">{school.members.map((member) => <div className="school-management__member" key={member.id}><span className="school-management__member-avatar">{String(member.full_name || '?').trim().charAt(0)}</span><div><strong>{member.full_name}</strong><span>{member.subject || '—'} · {member.role === 'school_admin' ? t('schoolRoleAdmin') : t('schoolRoleTeacher')}</span></div></div>)}{school.members.length === 0 && <div className="school-management__empty">{t('schoolNoMembers')}</div>}</div></div>}
        </section>
        {overview && <section className="school-management__overview"><div className="school-management__panel-heading"><div><span className="eyebrow">{t('schoolMetrics')}</span><h2>{overview.class?.name}</h2><p>{overview.assigned_teacher?.full_name || t('schoolUnassigned')}</p></div><button type="button" className="utility-icon" onClick={() => setOverview(null)} aria-label={t('close')} title={t('close')}>×</button></div><div className="school-management__overview-metrics"><Metric icon="user" label={t('schoolStudents')} value={overview.metrics?.student_count} /><Metric icon="reports" label={t('schoolCategories')} value={overview.metrics?.category_count} /><Metric icon="reports" label={t('schoolGrades')} value={overview.metrics?.grade_entries} /><Metric icon="heart" label={t('schoolBehavior')} value={overview.metrics?.behavior_entries} /><Metric icon="check" label={t('schoolAttendance')} value={overview.metrics?.attendance_entries} /></div><div className="school-management__attention"><strong>{t('schoolNeedsAttention')}</strong><div>{(overview.students_needing_attention || []).map((student) => <span key={student.id}>{student.full_name} · {Number(student.behavior_points || 0) > 0 ? '+' : ''}{student.behavior_points}</span>)}</div></div></section>}
      </>}
    </>}
  </div>;
}
