import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';
import { buildClassRoster, buildGrowth, buildStudentReport, getClassData } from '../utils/analyticsSelectors.js';

function downloadCSV(filename, rows, headers) {
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => `"${(row[header] ?? '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const PIE_COLORS = ['#2E7D6B', '#C1553D', '#E0A548', '#7A5CA1'];

function ReportChartKey({ items, label }) {
  if (!items?.length) return null;
  return <div className="flex flex-wrap items-center gap-2 mb-3" aria-label={label}>
    <span className="text-xs text-ink/50">{label}:</span>
    {items.map((item) => <span key={item.id || item.label} className="px-2.5 py-1 rounded-full bg-surface border border-line text-xs text-ink/70">{item.label}{item.meta ? ` · ${item.meta}` : ''}</span>)}
  </div>;
}

function ClassReport({ snapshot, classId, className }) {
  const classData = snapshot?.classes?.find((item) => item.id === classId);
  const roster = useMemo(() => buildClassRoster(snapshot, classId), [snapshot, classId]);
  const [studentSearch, setStudentSearch] = useState('');
  const [reportFilter, setReportFilter] = useState('all');
  const visibleRoster = useMemo(() => {
    const needle = studentSearch.trim().toLocaleLowerCase();
    return roster.filter((row) => {
      const matchesSearch = !needle || row.full_name.toLocaleLowerCase().includes(needle);
      const matchesFilter = reportFilter === 'all'
        || (reportFilter === 'graded' && row.finalGrade !== null)
        || (reportFilter === 'missing' && row.finalGrade === null)
        || (reportFilter === 'low-attendance' && row.attendanceRate !== null && row.attendanceRate < 75)
        || (reportFilter === 'negative-behavior' && row.behaviorScore < 0);
      return matchesSearch && matchesFilter;
    });
  }, [roster, studentSearch, reportFilter]);
  const gradeChart = visibleRoster.filter((row) => row.finalGrade !== null).map((row) => ({ name: row.full_name, grade: row.finalGrade }));
  const reportKpis = useMemo(() => {
    const graded = roster.filter((row) => row.finalGrade !== null);
    const attendance = roster.filter((row) => row.attendanceRate !== null);
    return {
      students: roster.length,
      average: graded.length ? Math.round(graded.reduce((sum, row) => sum + row.finalGrade, 0) / graded.length) : null,
      attendance: attendance.length ? Math.round(attendance.reduce((sum, row) => sum + row.attendanceRate, 0) / attendance.length) : null,
      alerts: roster.filter((row) => row.finalGrade === null || row.behaviorScore < 0 || row.attendanceRate !== null && row.attendanceRate < 75).length,
    };
  }, [roster]);

  const exportCSV = () => downloadCSV(`تقرير_${className}.csv`,     visibleRoster.map((row) => ({
    الاسم: row.full_name,
    الدرجة_النهائية: row.finalGrade ?? '',
    نقاط_السلوك: row.behaviorScore,
    نسبة_الحضور: row.attendanceRate ?? '',
  })), ['الاسم', 'الدرجة_النهائية', 'نقاط_السلوك', 'نسبة_الحضور']);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h3 className="text-lg font-bold">تقرير الفصل الشامل</h3>
        <div className="flex gap-2"><button className="btn-secondary text-sm" onClick={exportCSV}>تصدير Excel/CSV</button><button className="btn-primary text-sm" onClick={() => window.print()}>تصدير PDF (طباعة)</button></div>
      </div>
      <div className="report-kpi-grid print:hidden"><div><span>الطلاب</span><strong>{reportKpis.students}</strong></div><div><span>متوسط الدرجة</span><strong>{reportKpis.average === null ? '—' : `${reportKpis.average}%`}</strong></div><div><span>متوسط الحضور</span><strong>{reportKpis.attendance === null ? '—' : `${reportKpis.attendance}%`}</strong></div><div><span>تنبيهات متابعة</span><strong>{reportKpis.alerts}</strong></div></div>
      <div className="report-filters print:hidden"><div className="analytics-search"><span>⌕</span><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="بحث سريع عن طالب" /></div><select className="input text-sm" value={reportFilter} onChange={(event) => setReportFilter(event.target.value)}><option value="all">كل الطلاب</option><option value="graded">تم رصد الدرجة</option><option value="missing">دون درجة نهائية</option><option value="low-attendance">حضور أقل من 75%</option><option value="negative-behavior">سلوك سلبي</option></select><span>عرض {visibleRoster.length} من {roster.length}</span></div>
      <div className="card p-6 mb-6">
        <h2 className="text-xl font-bold mb-1">{classData?.name || className}</h2>
        <p className="text-ink/60 text-sm mb-4">تاريخ التقرير: {new Date().toLocaleDateString('ar')} — محسوب محليًا</p>
        <table className="w-full text-sm"><thead className="bg-surface"><tr><th className="text-right px-4 py-2">الطالب</th><th className="text-right px-4 py-2">الدرجة النهائية</th><th className="text-right px-4 py-2">نقاط السلوك</th><th className="text-right px-4 py-2">نسبة الحضور</th></tr></thead><tbody>{visibleRoster.map((row) => <tr key={row.student_id} className="border-t border-line"><td className="px-4 py-2">{row.full_name}</td><td className="px-4 py-2 font-bold text-primary">{row.finalGrade !== null ? `${row.finalGrade}%` : '—'}</td><td className={`px-4 py-2 ${row.behaviorScore >= 0 ? 'text-primary' : 'text-danger'}`}>{row.behaviorScore}</td><td className="px-4 py-2">{row.attendanceRate !== null ? `${row.attendanceRate}%` : '—'}</td></tr>)}</tbody></table>
      </div>
      {gradeChart.length > 0 && <div className="card p-4"><h3 className="font-bold mb-3">مقارنة الدرجات النهائية بين الطلاب</h3><ResponsiveContainer width="100%" height={Math.max(200, gradeChart.length * 34)}><BarChart data={gradeChart} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="grade" fill="#2E7D6B" radius={[0, 6, 6, 0]} name="الدرجة %" /></BarChart></ResponsiveContainer></div>}
    </div>
  );
}

function StudentReport({ snapshot, studentId }) {
  const report = useMemo(() => buildStudentReport(snapshot, studentId), [snapshot, studentId]);
  const growth = useMemo(() => buildGrowth(snapshot, studentId), [snapshot, studentId]);
  if (!studentId) return <p className="text-ink/50">اختر طالبًا من القائمة أعلاه لعرض تقريره الموحّد.</p>;
  if (!report) return <p className="text-danger">تعذر العثور على بيانات الطالب المحلية.</p>;

  const behaviorPie = [{ name: 'إيجابي', value: report.behaviorLogs.filter((log) => log.polarity === 'positive').length }, { name: 'سلبي', value: report.behaviorLogs.filter((log) => log.polarity === 'negative').length }].filter((item) => item.value > 0);
  const attendancePie = Object.entries(report.attendanceTotals).map(([name, value]) => ({ name, value })).filter((item) => item.value > 0);
  const categoryBars = report.gradesByCategory.map((category) => {
    const scored = category.items.filter((item) => item.score !== null);
    const average = scored.length ? scored.reduce((sum, item) => sum + (item.score / item.max_score) * 100, 0) / scored.length : 0;
    return { name: category.category, percent: Number(average.toFixed(1)), weight: category.weight_percent };
  });
  const categoryKey = categoryBars.map((item) => ({ id: item.name, label: item.name, meta: `وزن ${item.weight}% · متوسط ${item.percent}%` }));
  const growthKey = [...new Set(growth.map((item) => item.category).filter(Boolean))].map((label) => ({ id: label, label }));

  return <div>
    <div className="flex items-center justify-between mb-4 print:hidden"><h3 className="text-lg font-bold">تقرير الطالب الموحّد</h3><button className="btn-primary text-sm" onClick={() => window.print()}>تصدير PDF (طباعة)</button></div>
    <div className="card p-6 mb-6"><h2 className="text-xl font-bold mb-1">{report.student.full_name}</h2><p className="text-ink/60 text-sm mb-4">{report.class?.name} — تقرير محلي</p><div className="grid grid-cols-4 gap-3"><div className="text-center"><p className="text-xs text-ink/50">الدرجة النهائية</p><p className="text-2xl font-bold text-primary">{report.finalGrade !== null ? `${report.finalGrade}%` : '—'}</p></div><div className="text-center"><p className="text-xs text-ink/50">نقاط السلوك</p><p className="text-2xl font-bold text-primary">{report.behaviorScore}</p></div><div className="text-center"><p className="text-xs text-ink/50">سجلات الحضور</p><p className="text-2xl font-bold text-ink">{report.attendance.length}</p></div><div className="text-center"><p className="text-xs text-ink/50">فئات التقييم</p><p className="text-2xl font-bold text-ink">{report.gradesByCategory.length}</p></div></div>{report.autoRecommendation && <div className="mt-4 bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm"><span className="font-bold text-primary">توصية المعلم التلقائية: </span>{report.autoRecommendation}</div>}</div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div className="card p-4"><h4 className="font-bold text-sm mb-1">متوسط الدرجات حسب الفئة</h4><ReportChartKey label="الفئات" items={categoryKey} /><ResponsiveContainer width="100%" height={220}><BarChart data={categoryBars}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="percent" fill="#2E7D6B" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>{growth.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">النمو الأكاديمي عبر الزمن</h4><ReportChartKey label="الفئات الظاهرة" items={growthKey} /><ResponsiveContainer width="100%" height={220}><LineChart data={growth}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="index" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="percent" stroke="#E0A548" strokeWidth={3} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>}{behaviorPie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">توزيع السلوك</h4><ReportChartKey label="الفئات" items={behaviorPie.map((item) => ({ id: item.name, label: item.name, meta: `${item.value} سجل` }))} /><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={behaviorPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>{behaviorPie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}{attendancePie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">توزيع الحضور</h4><ReportChartKey label="الحالات" items={attendancePie.map((item) => ({ id: item.name, label: item.name, meta: `${item.value} سجل` }))} /><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={attendancePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>{attendancePie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}</div>
  </div>;
}

export default function ReportsTab({ classId, className }) {
  const [mode, setMode] = useState('class');
  const [snapshot, setSnapshot] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState('');

  useEffect(() => {
    let active = true;
    getOrSyncSnapshot(getTeacherId()).then((data) => { if (active) setSnapshot(data); });
    return () => { active = false; };
  }, [classId]);

  const { students } = useMemo(() => getClassData(snapshot, classId), [snapshot, classId]);
  if (!snapshot) return <p className="text-ink/50">جارِ تجهيز التقرير محليًا...</p>;

  return <div><div className="flex flex-wrap items-center gap-2 mb-5 print:hidden"><button onClick={() => setMode('class')} className={`px-3 py-1.5 rounded-full text-sm border ${mode === 'class' ? 'bg-primary text-white border-primary' : 'border-line'}`}>تقرير الصف</button><button onClick={() => setMode('student')} className={`px-3 py-1.5 rounded-full text-sm border ${mode === 'student' ? 'bg-primary text-white border-primary' : 'border-line'}`}>تقرير طالب محدد</button>{mode === 'student' && <select className="input text-sm w-56" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)}><option value="">اختر طالبًا</option>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>}</div>{mode === 'class' ? <ClassReport snapshot={snapshot} classId={classId} className={className} /> : <StudentReport snapshot={snapshot} studentId={selectedStudent} />}</div>;
}
