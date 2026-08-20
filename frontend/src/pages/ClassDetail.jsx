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

const TABS = [
  { id: 'students', label: 'الطلاب', icon: 'user' },
  { id: 'gradebook', label: 'دفتر الدرجات', icon: 'fileCheck' },
  { id: 'behavior', label: 'السلوك', icon: 'heart' },
  { id: 'attendance', label: 'الحضور', icon: 'check' },
  { id: 'analytics', label: 'التحليلات', icon: 'analytics' },
  { id: 'reports', label: 'التقارير', icon: 'reports' },
];

export default function ClassDetail() {
  const { id } = useParams();
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

  return (
    <div className="class-page-shell">
      <div className="class-page-topline"><Link to="/" className="class-page-back"><span>→</span> العودة إلى لوحة الصفوف</Link><span className="class-page-status"><span className="class-page-status__dot" /> بيانات محفوظة محليًا</span></div>
      {loading && !cls && <div className="class-page-loading">جارِ فتح الصف محليًا...</div>}
      {cls && <header className="class-page-header" style={{ '--class-accent': cls.color || '#2E7D6B' }}>
        <div className="class-page-header__visual"><span className="class-page-header__symbol">▦</span><span className="class-page-header__eyebrow">مساحة الصف</span><h1>{cls.name}</h1><p>{cls.subject || 'مادة غير محددة'} {cls.academic_year ? `• ${cls.academic_year}` : ''}</p></div>
        <div className="class-page-header__side"><span className="class-page-header__tag">إدارة يومية</span><p>تابع الطلاب والدرجات والحضور والسلوك في لوحة واحدة.</p><div className="class-page-mini-stats"><span><strong>{studentsCount}</strong><small>طالب</small></span><span><strong>{categoriesCount}</strong><small>فئة</small></span><span><strong>{assessmentsCount}</strong><small>تقييم</small></span><span><strong>{attendanceSessionsCount}</strong><small>جلسة حضور</small></span></div></div>
      </header>}
      <TrialBanner />
      <nav className="class-tabs" aria-label="أقسام الصف">{TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-selected={tab === item.id} className={`class-tab ${tab === item.id ? 'is-active' : ''}`}><Icon name={item.icon} className="w-4 h-4" /><span>{item.label}</span></button>)}</nav>
      <main className={`class-tab-panel class-tab-panel--${tab}`}>
        <Suspense fallback={<div className="class-page-loading">جارِ تحميل التبويب...</div>}>
          {tab === 'students' && <StudentsTab classId={id} />}
          {tab === 'gradebook' && <GradebookTab classId={id} className={cls?.name} />}
          {tab === 'behavior' && <BehaviorTab classId={id} />}
          {tab === 'attendance' && <AttendanceTab classId={id} />}
          {tab === 'analytics' && <AnalyticsTab classId={id} />}
          {tab === 'reports' && <ReportsTab classId={id} className={cls?.name} />}
        </Suspense>
      </main>
    </div>
  );
}
