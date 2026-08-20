import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, Cell } from 'recharts';
import StudentAvatar from './StudentAvatar.jsx';
import StudentDetailModal from './StudentDetailModal.jsx';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';
import {
  buildCategoryAverages,
  buildDistribution,
  buildGrowth,
  buildClassRoster,
} from '../utils/analyticsSelectors.js';

const SORT_OPTIONS = {
  name: (a, b) => a.full_name.localeCompare(b.full_name, 'ar'),
  grade: (a, b) => (b.finalGrade ?? -1) - (a.finalGrade ?? -1),
  behavior: (a, b) => b.behaviorScore - a.behaviorScore,
  attendance: (a, b) => (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1),
};

function ChartKey({ items, label }) {
  if (!items?.length) return null;
  return <div className="flex flex-wrap items-center gap-2 mb-3" aria-label={label}>
    <span className="text-xs text-ink/50">{label}:</span>
    {items.map((item) => <span key={item.id || item.label} className="px-2.5 py-1 rounded-full bg-surface border border-line text-xs text-ink/70">{item.label}{item.meta ? ` · ${item.meta}` : ''}</span>)}
  </div>;
}

export default function AnalyticsTab({ classId }) {
  const [snapshot, setSnapshot] = useState(null);
  const [sortBy, setSortBy] = useState('grade');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState('all');
  const [growth, setGrowth] = useState([]);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getOrSyncSnapshot(getTeacherId())
      .then((data) => { if (active) setSnapshot(data); })
      .catch(() => { if (active) setError('تعذر تحميل بيانات التحليلات. اضغط إعادة المحاولة.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [classId]);

  const roster = useMemo(() => buildClassRoster(snapshot, classId), [snapshot, classId]);
  const distribution = useMemo(() => Object.entries(buildDistribution(roster)).map(([range, count]) => ({ range, count })), [roster]);
  const categoryAverages = useMemo(() => buildCategoryAverages(snapshot, classId), [snapshot, classId]);
  const categoryKey = useMemo(() => categoryAverages.map((item) => ({ id: item.category, label: item.category, meta: `وزن ${item.weight_percent}% · ${item.averagePercent === null ? 'لا توجد درجات' : `متوسط ${item.averagePercent}%`}` })), [categoryAverages]);
  const students = useMemo(() => (snapshot?.students || []).filter((student) => student.class_id === classId && !student.archived), [snapshot, classId]);
  const filteredRoster = useMemo(() => {
    const needle = studentSearch.trim().toLocaleLowerCase();
    return roster.filter((row) => {
      const matchesSearch = !needle || row.full_name.toLocaleLowerCase().includes(needle);
      const matchesFilter = studentFilter === 'all'
        || (studentFilter === 'needs-grade' && row.finalGrade === null)
        || (studentFilter === 'low-grade' && row.finalGrade !== null && row.finalGrade < 60)
        || (studentFilter === 'attendance' && row.attendanceRate !== null && row.attendanceRate < 75)
        || (studentFilter === 'behavior' && row.behaviorScore < 0);
      return matchesSearch && matchesFilter;
    });
  }, [roster, studentSearch, studentFilter]);
  const sortedRoster = useMemo(() => [...filteredRoster].sort(SORT_OPTIONS[sortBy]), [filteredRoster, sortBy]);
  const analyticsKpis = useMemo(() => {
    const graded = roster.filter((row) => row.finalGrade !== null);
    const attendance = roster.filter((row) => row.attendanceRate !== null);
    return {
      students: roster.length,
      average: graded.length ? Math.round(graded.reduce((sum, row) => sum + row.finalGrade, 0) / graded.length) : null,
      attendance: attendance.length ? Math.round(attendance.reduce((sum, row) => sum + row.attendanceRate, 0) / attendance.length) : null,
      needsAttention: roster.filter((row) => row.finalGrade !== null && row.finalGrade < 60 || row.behaviorScore < 0).length,
    };
  }, [roster]);

  const growthCategories = useMemo(() => [...new Set(growth.map((item) => item.category).filter(Boolean))].map((label) => ({ id: label, label })), [growth]);

  const loadGrowth = (studentId) => {
    setSelectedStudent(studentId);
    if (!studentId) { setGrowth([]); return; }
    setGrowth(buildGrowth(snapshot, studentId));
  };

  if (loading && !snapshot) return <p className="text-ink/50">جارِ تجهيز التحليلات محليًا...</p>;
  if (error && !snapshot) return <div className="card p-6 text-center text-danger">{error}<button className="btn-secondary text-sm mr-3" onClick={() => window.location.reload()}>إعادة المحاولة</button></div>;

  return (
    <div className="space-y-5">
      <div className="analytics-kpi-grid">
        <div className="analytics-kpi"><span>إجمالي الطلاب</span><strong>{analyticsKpis.students}</strong><small>في الصف الحالي</small></div>
        <div className="analytics-kpi analytics-kpi--primary"><span>متوسط الدرجات</span><strong>{analyticsKpis.average === null ? '—' : `${analyticsKpis.average}%`}</strong><small>للطلبة المرصودين</small></div>
        <div className="analytics-kpi analytics-kpi--accent"><span>متوسط الحضور</span><strong>{analyticsKpis.attendance === null ? '—' : `${analyticsKpis.attendance}%`}</strong><small>من السجلات المتاحة</small></div>
        <div className="analytics-kpi analytics-kpi--danger"><span>يحتاجون متابعة</span><strong>{analyticsKpis.needsAttention}</strong><small>درجة منخفضة أو سلوك سلبي</small></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-4">
        <h3 className="font-bold mb-1">توزيع درجات الفصل</h3>
        <p className="text-xs text-ink/50 mb-3">يوضح عدد الطلاب داخل كل نطاق من الدرجة النهائية.</p>
        <ChartKey label="النطاقات" items={distribution.map((item) => ({ id: item.range, label: item.range, meta: `${item.count} طالب` }))} />
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={distribution}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" />
            <XAxis dataKey="range" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#2E7D6B" radius={[6, 6, 0, 0]} name="عدد الطلاب" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-4">
        <h3 className="font-bold mb-1">متوسط الأداء حسب فئة التقييم</h3>
        <p className="text-xs text-ink/50 mb-3">يُحسب محليًا من آخر snapshot محفوظ على جهاز المعلم.</p>
        <ChartKey label="الفئات" items={categoryKey} />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={categoryAverages} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="category" width={110} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v, n, p) => [v === null ? 'لا توجد درجات بعد' : `${v}%`, `متوسط ${p.payload.category}`]} />
            <Bar dataKey="averagePercent" radius={[0, 6, 6, 0]} name="المتوسط %">
              {categoryAverages.map((category, index) => (
                <Cell key={category.category || index} fill={category.averagePercent === null ? '#E4E1D8' : category.averagePercent >= 70 ? '#2E7D6B' : category.averagePercent >= 50 ? '#E0A548' : '#C1553D'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">النمو الأكاديمي للطالب</h3>
          <select className="input text-sm w-48" value={selectedStudent} onChange={(event) => loadGrowth(event.target.value)}>
            <option value="">اختر طالبًا</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}
          </select>
        </div>
        {growth.length === 0 ? (
          <p className="text-ink/50 text-sm">اختر طالبًا لعرض تطور درجاته عبر الفصل الدراسي.</p>
        ) : (
          <>
          <ChartKey label="الفئات الظاهرة" items={growthCategories} />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={growth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" />
              <XAxis dataKey="index" tick={{ fontSize: 12 }} label={{ value: 'التقييمات', position: 'insideBottom', offset: -2, fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value, name, payload) => [`${value}%`, payload.payload.title]} />
              <Legend />
              <Line type="monotone" dataKey="percent" stroke="#E0A548" strokeWidth={3} dot={{ r: 4 }} name="النسبة %" />
            </LineChart>
          </ResponsiveContainer>
          </>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-bold">ملخص شامل للفصل</h3>
          <div className="flex flex-wrap gap-2">
            <div className="analytics-search"><span>⌕</span><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="بحث عن طالب" /></div>
            <select className="input text-xs w-40" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}><option value="all">كل الحالات</option><option value="needs-grade">دون درجة</option><option value="low-grade">أقل من 60%</option><option value="attendance">حضور أقل من 75%</option><option value="behavior">سلوك يحتاج متابعة</option></select>
            <select className="input text-xs w-40" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="grade">ترتيب حسب الدرجة</option>
            <option value="behavior">ترتيب حسب السلوك</option>
            <option value="attendance">ترتيب حسب الحضور</option>
            <option value="name">ترتيب أبجدي</option>
            </select>
          </div>
        </div>
        <div className="mb-2 text-xs text-ink/50">عرض {sortedRoster.length} من {roster.length} طالب</div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface sticky top-0"><tr>
              <th className="text-right px-3 py-2">الطالب</th>
              <th className="text-right px-3 py-2">الدرجة النهائية</th>
              <th className="text-right px-3 py-2">نقاط السلوك</th>
              <th className="text-right px-3 py-2">نسبة الحضور</th>
            </tr></thead>
            <tbody>
              {sortedRoster.map((row) => (
                <tr key={row.student_id} className="border-t border-line cursor-pointer hover:bg-surface" onClick={() => setDetailStudentId(row.student_id)}>
                  <td className="px-3 py-2">{row.full_name}</td>
                  <td className="px-3 py-2 font-medium">{row.finalGrade === null ? '—' : `${row.finalGrade}%`}</td>
                  <td className={`px-3 py-2 font-medium ${row.behaviorScore >= 0 ? 'text-primary' : 'text-danger'}`}>{row.behaviorScore}</td>
                  <td className="px-3 py-2">{row.attendanceRate === null ? '—' : `${row.attendanceRate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4 lg:col-span-2">
        <h3 className="font-bold mb-3">تفاصيل شاملة لكل طالب</h3>
        <p className="text-xs text-ink/50 mb-3">اضغط على أي طالب لعرض درجاته وسلوكه وحضوره في مكان واحد.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {filteredRoster.map((row) => {
            const student = students.find((item) => item.id === row.student_id);
            return student ? (
            <button key={student.id} onClick={() => setDetailStudentId(student.id)} className="flex items-center gap-2 p-2 rounded-lg border border-line hover:bg-surface text-right">
              <StudentAvatar name={student.full_name} photoUrl={student.photo_url} size={28} />
              <span className="text-sm truncate">{student.full_name}</span>
            </button>
            ) : null;
          })}
        </div>
      </div>

      <StudentDetailModal studentId={detailStudentId} onClose={() => setDetailStudentId(null)} />
      </div>
    </div>
  );
}
