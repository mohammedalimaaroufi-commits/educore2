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

function ClassReport({ snapshot, classId, className }) {
  const classData = snapshot?.classes?.find((item) => item.id === classId);
  const roster = useMemo(() => buildClassRoster(snapshot, classId), [snapshot, classId]);
  const gradeChart = roster.filter((row) => row.finalGrade !== null).map((row) => ({ name: row.full_name, grade: row.finalGrade }));

  const exportCSV = () => downloadCSV(`تقرير_${className}.csv`, roster.map((row) => ({
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
      <div className="card p-6 mb-6">
        <h2 className="text-xl font-bold mb-1">{classData?.name || className}</h2>
        <p className="text-ink/60 text-sm mb-4">تاريخ التقرير: {new Date().toLocaleDateString('ar')} — محسوب محليًا</p>
        <table className="w-full text-sm"><thead className="bg-surface"><tr><th className="text-right px-4 py-2">الطالب</th><th className="text-right px-4 py-2">الدرجة النهائية</th><th className="text-right px-4 py-2">نقاط السلوك</th><th className="text-right px-4 py-2">نسبة الحضور</th></tr></thead><tbody>{roster.map((row) => <tr key={row.student_id} className="border-t border-line"><td className="px-4 py-2">{row.full_name}</td><td className="px-4 py-2 font-bold text-primary">{row.finalGrade !== null ? `${row.finalGrade}%` : '—'}</td><td className={`px-4 py-2 ${row.behaviorScore >= 0 ? 'text-primary' : 'text-danger'}`}>{row.behaviorScore}</td><td className="px-4 py-2">{row.attendanceRate !== null ? `${row.attendanceRate}%` : '—'}</td></tr>)}</tbody></table>
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
    return { name: category.category, percent: Number(average.toFixed(1)) };
  });

  return <div>
    <div className="flex items-center justify-between mb-4 print:hidden"><h3 className="text-lg font-bold">تقرير الطالب الموحّد</h3><button className="btn-primary text-sm" onClick={() => window.print()}>تصدير PDF (طباعة)</button></div>
    <div className="card p-6 mb-6"><h2 className="text-xl font-bold mb-1">{report.student.full_name}</h2><p className="text-ink/60 text-sm mb-4">{report.class?.name} — تقرير محلي</p><div className="grid grid-cols-4 gap-3"><div className="text-center"><p className="text-xs text-ink/50">الدرجة النهائية</p><p className="text-2xl font-bold text-primary">{report.finalGrade !== null ? `${report.finalGrade}%` : '—'}</p></div><div className="text-center"><p className="text-xs text-ink/50">نقاط السلوك</p><p className="text-2xl font-bold text-primary">{report.behaviorScore}</p></div><div className="text-center"><p className="text-xs text-ink/50">سجلات الحضور</p><p className="text-2xl font-bold text-ink">{report.attendance.length}</p></div><div className="text-center"><p className="text-xs text-ink/50">فئات التقييم</p><p className="text-2xl font-bold text-ink">{report.gradesByCategory.length}</p></div></div>{report.autoRecommendation && <div className="mt-4 bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm"><span className="font-bold text-primary">توصية المعلم التلقائية: </span>{report.autoRecommendation}</div>}</div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div className="card p-4"><h4 className="font-bold text-sm mb-3">متوسط الدرجات حسب الفئة</h4><ResponsiveContainer width="100%" height={220}><BarChart data={categoryBars}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="percent" fill="#2E7D6B" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>{growth.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-3">النمو الأكاديمي عبر الزمن</h4><ResponsiveContainer width="100%" height={220}><LineChart data={growth}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="index" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="percent" stroke="#E0A548" strokeWidth={3} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>}{behaviorPie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-3">توزيع السلوك</h4><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={behaviorPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>{behaviorPie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}{attendancePie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-3">توزيع الحضور</h4><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={attendancePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>{attendancePie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}</div>
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
