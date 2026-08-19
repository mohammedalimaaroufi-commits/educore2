import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { getLocalFirst } from '../api/client';
import TrialBanner from '../components/TrialBanner.jsx';
const StudentsTab = lazy(() => import('../components/StudentsTab.jsx'));
const GradebookTab = lazy(() => import('../components/GradebookTab.jsx'));
const BehaviorTab = lazy(() => import('../components/BehaviorTab.jsx'));
const AttendanceTab = lazy(() => import('../components/AttendanceTab.jsx'));
const AnalyticsTab = lazy(() => import('../components/AnalyticsTab.jsx'));
const ReportsTab = lazy(() => import('../components/ReportsTab.jsx'));
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';

const TABS = [
  { id: 'students', label: 'الطلاب' },
  { id: 'gradebook', label: 'دفتر الدرجات' },
  { id: 'behavior', label: 'السلوك' },
  { id: 'attendance', label: 'الحضور' },
  { id: 'analytics', label: 'التحليلات' },
  { id: 'reports', label: 'التقارير' },
];

export default function ClassDetail() {
  const { id } = useParams();
  const [cls, setCls] = useState(null);
  const [tab, setTab] = useState('students');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const local = await getOrSyncSnapshot(getTeacherId());
      if (active) {
        setCls(local?.classes?.find((item) => item.id === id) || null);
        setLoading(false);
      }
      try {
        const { data } = await getLocalFirst(`/classes/${id}`);
        if (active && data.class) setCls(data.class);
      } catch {
        // The local snapshot remains the source for offline navigation.
      }
    };
    load();
    return () => { active = false; };
  }, [id]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link to="/" className="text-primary text-sm">→ العودة للوحة التحكم</Link>
      {loading && !cls && <p className="text-ink/50 mt-4">جارِ فتح الصف محليًا...</p>}
      {cls && <div className="flex items-center gap-3 mt-3 mb-4"><div className="w-10 h-10 rounded-lg" style={{ background: cls.color }} /><div><h1 className="text-2xl font-bold">{cls.name}</h1><p className="text-ink/60 text-sm">{cls.subject} {cls.academic_year ? `• ${cls.academic_year}` : ''}</p></div></div>}
      <TrialBanner />
      <div className="flex gap-2 border-b border-line mb-6 overflow-x-auto">{TABS.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${tab === item.id ? 'border-primary text-primary' : 'border-transparent text-ink/60 hover:text-ink'}`}>{item.label}</button>)}</div>
      <Suspense fallback={<p className="text-ink/50">جارِ تحميل التبويب...</p>}>
        {tab === 'students' && <StudentsTab classId={id} />}
        {tab === 'gradebook' && <GradebookTab classId={id} className={cls?.name} />}
        {tab === 'behavior' && <BehaviorTab classId={id} />}
        {tab === 'attendance' && <AttendanceTab classId={id} />}
        {tab === 'analytics' && <AnalyticsTab classId={id} />}
        {tab === 'reports' && <ReportsTab classId={id} className={cls?.name} />}
      </Suspense>
    </div>
  );
}
