import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client';
import TrialBanner from '../components/TrialBanner.jsx';
const StudentsTab = lazy(() => import('../components/StudentsTab.jsx'));
const GradebookTab = lazy(() => import('../components/GradebookTab.jsx'));
const BehaviorTab = lazy(() => import('../components/BehaviorTab.jsx'));
const AttendanceTab = lazy(() => import('../components/AttendanceTab.jsx'));
const AnalyticsTab = lazy(() => import('../components/AnalyticsTab.jsx'));
const ReportsTab = lazy(() => import('../components/ReportsTab.jsx'));
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';
import Icon from '../components/Icon.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const TAB_KEYS = [
  { id: 'students', key: 'students', icon: 'user', feature: 'students' },
  { id: 'gradebook', key: 'gradebook', icon: 'fileCheck', feature: 'gradebook' },
  { id: 'behavior', key: 'behavior', icon: 'heart', feature: 'behavior' },
  { id: 'attendance', key: 'attendance', icon: 'check', feature: 'attendance' },
  { id: 'analytics', key: 'analytics', icon: 'analytics', feature: 'analytics' },
  { id: 'reports', key: 'reports', icon: 'reports', feature: 'reports' },
];

const RESTRICTION_LABELS = {
  students: 'featureStudents',
  gradebook: 'featureGradebook',
  behavior: 'featureBehavior',
  attendance: 'featureAttendance',
  analytics: 'featureAnalytics',
  reports: 'featureReports',
};

export default function ClassDetail() {
  const { id } = useParams();
  const { t, locale, direction } = useLocale();
  const { restrictions } = useAuth();
  const [cls, setCls] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [tab, setTab] = useState('students');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const local = await getOrSyncSnapshot(getTeacherId());
      if (active) {
        setSnapshot(local || null);
        setCls(local?.classes?.find((item) => item.id === id) || null);
        setLoading(false);
      }
      try {
        const { data } = await api.get(`/classes/${id}`);
        if (active && data.class) setCls(data.class);
      } catch {
        // The local snapshot remains the source for offline navigation.
      }
    };
    load();
    return () => { active = false; };
  }, [id]);

  const studentsCount = (snapshot?.students || []).filter((student) => student.class_id === id && !student.archived).length;
  const categoriesCount = (snapshot?.grade_categories || []).filter((category) => category.class_id === id).length;
  const assessmentsCount = (snapshot?.assessments || []).filter((assessment) => (snapshot?.grade_categories || []).some((category) => category.id === assessment.category_id && category.class_id === id)).length;
  const attendanceSessionsCount = (snapshot?.attendance_sessions || []).filter((session) => session.class_id === id).length;
  const isArabic = locale === 'ar';
  const blockedFeatures = new Set(restrictions?.active ? (restrictions.blocked_features || []) : []);
  const visibleTabs = TAB_KEYS.filter((item) => !blockedFeatures.has(item.feature));
  const isBlockedTab = (tabId) => blockedFeatures.has(TAB_KEYS.find((item) => item.id === tabId)?.feature);
  useEffect(() => {
    if (isBlockedTab(tab)) setTab(visibleTabs[0]?.id || null);
  }, [tab, restrictions?.active, restrictions?.blocked_features?.join(','), visibleTabs.length]);

  return (
    <div className="class-page-shell" dir={direction}>
      <div className="class-page-fixed-header">
        <div className="class-page-topline"><Link to="/" className="class-page-back"><span>{isArabic ? '→' : '←'}</span> {isArabic ? 'العودة إلى لوحة الصفوف' : 'Back to classes'}</Link><span className="class-page-status"><span className="class-page-status__dot" /> {isArabic ? 'بيانات محفوظة محليًا' : 'Data saved locally'}</span></div>
        {loading && !cls && <div className="class-page-loading">{isArabic ? 'جارِ فتح الصف محليًا...' : 'Opening class locally...'}</div>}
        {cls && <header className="class-page-header" style={{ '--class-accent': cls.color || '#2E7D6B' }}>
          <div className="class-page-header__visual"><span className="class-page-header__symbol">▦</span><span className="class-page-header__eyebrow">{isArabic ? 'مساحة الصف' : 'Class workspace'}</span><h1>{cls.name}</h1><p>{cls.subject || (isArabic ? 'مادة غير محددة' : 'Subject not specified')} {cls.academic_year ? `• ${cls.academic_year}` : ''}</p></div>
          <div className="class-page-header__side"><span className="class-page-header__tag">{isArabic ? 'إدارة يومية' : 'Daily management'}</span><p>{isArabic ? 'تابع الطلاب والدرجات والحضور والسلوك في لوحة واحدة.' : 'Track students, grades, attendance, and behavior in one workspace.'}</p><div className="class-page-mini-stats"><span><strong>{studentsCount}</strong><small>{isArabic ? 'طالب' : 'Students'}</small></span><span><strong>{categoriesCount}</strong><small>{isArabic ? 'فئة' : 'Categories'}</small></span><span><strong>{assessmentsCount}</strong><small>{isArabic ? 'تقييم' : 'Assessments'}</small></span><span><strong>{attendanceSessionsCount}</strong><small>{isArabic ? 'جلسة حضور' : 'Attendance sessions'}</small></span></div></div>
        </header>}
        <TrialBanner />
        {blockedFeatures.size > 0 && <div className="class-page-restriction-banner" role="status"><strong>{t('restrictionsTitle')}</strong><span>{t('restrictionsNotice')}</span><small>{[...blockedFeatures].map((feature) => t(RESTRICTION_LABELS[feature] || feature)).join(' · ')}</small></div>}
        <nav className="class-tabs" aria-label={isArabic ? 'أقسام الصف' : 'Class sections'}>{visibleTabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-selected={tab === item.id} className={`class-tab ${tab === item.id ? 'is-active' : ''}`}><Icon name={item.icon} className="w-4 h-4" /><span>{t(item.key)}</span></button>)}</nav>
      </div>
      <main className={`class-tab-panel class-tab-panel--${tab || 'restricted'}`}>
        {visibleTabs.length === 0 ? <div className="class-page-restricted-empty"><strong>{t('restrictedFeature')}</strong><span>{t('restrictionsNotice')}</span></div> : <Suspense fallback={<div className="class-page-loading">{isArabic ? 'جارِ تحميل التبويب...' : 'Loading section...'}</div>}>
          {tab === 'students' && <StudentsTab classId={id} />}
          {tab === 'gradebook' && <GradebookTab classId={id} className={cls?.name} />}
          {tab === 'behavior' && <BehaviorTab classId={id} />}
          {tab === 'attendance' && <AttendanceTab classId={id} />}
          {tab === 'analytics' && <AnalyticsTab classId={id} />}
          {tab === 'reports' && <ReportsTab classId={id} className={cls?.name} />}
        </Suspense>}
      </main>
    </div>
  );
}
