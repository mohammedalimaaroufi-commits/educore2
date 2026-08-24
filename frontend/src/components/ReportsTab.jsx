import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, LabelList } from 'recharts';
import { getTeacherId, readSessionCache, readStoredTeacher } from '../utils/localCache.js';
import { readSettingsCache } from '../utils/settingsCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';
import { buildClassRoster, buildGrowth, buildStudentReport, getClassData, buildFollowUpRows, DEFAULT_FOLLOW_UP_SETTINGS, normalizeFollowUpSettings } from '../utils/analyticsSelectors.js';

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

function renderPieLabel({ cx, cy, midAngle, outerRadius, percent, name }) {
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 18;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return <text x={x} y={y} fill="#1B2430" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight={700}>{`${name} ${Math.round((percent || 0) * 100)}%`}</text>;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function teacherProfile() {
  try {
    const stored = readStoredTeacher() || {};
    const session = stored?.id ? readSessionCache(stored.id) : null;
    return { ...(session?.teacher || {}), ...stored };
  } catch {
    return {};
  }
}

function openFormalReport({ title, subtitle, meta = [], columns = [], rows = [], sections = [], landscape = false }) {
  const isEnglish = document.documentElement.lang === 'en';
  const lang = isEnglish ? 'en' : 'ar';
  const dir = isEnglish ? 'ltr' : 'rtl';
  const generatedAt = new Date().toLocaleDateString(isEnglish ? 'en-US' : 'ar', { year: 'numeric', month: 'long', day: 'numeric' });
  const renderTable = (tableColumns, tableRows) => `<table><thead><tr>${tableColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${tableRows.map((row) => `<tr>${tableColumns.map((column) => `<td class="${column.emphasis ? 'emphasis' : ''}">${escapeHtml(row[column.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const sectionMarkup = sections.map((section) => `<section class="report-section"><h2>${escapeHtml(section.title)}</h2>${section.text ? `<p class="section-text">${escapeHtml(section.text)}</p>` : ''}${section.columns ? renderTable(section.columns, section.rows || []) : ''}</section>`).join('');
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 13mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1b2d36; background: #fff; font-family: "Noto Sans Arabic", "Tajawal", Arial, sans-serif; font-size: 10px; line-height: 1.55; }
    .masthead { padding: 16px 18px 13px; margin-bottom: 14px; border: 2px solid #2e7d6b; border-radius: 12px; }
    .brand { color: #2e7d6b; font-size: 12px; font-weight: 800; letter-spacing: .04em; }
    h1 { margin: 4px 0 2px; color: #162a34; font-size: 21px; line-height: 1.25; }
    .subtitle { margin: 0 0 11px; color: #667980; font-size: 10px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px 14px; padding-top: 10px; border-top: 1px solid #dce8e3; }
    .meta-item span { display: block; color: #71838a; font-size: 8px; }
    .meta-item strong { display: block; color: #1b2d36; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 8px; }
    th, td { padding: 6px 5px; border: 1px solid #b9cbc5; text-align: ${dir === 'rtl' ? 'right' : 'left'}; vertical-align: middle; overflow-wrap: anywhere; }
    th { color: #fff; background: #2e7d6b; font-size: 9px; font-weight: 800; }
    td { background: #fff; font-size: 9px; }
    tbody tr:nth-child(even) td { background: #f5faf7; }
    td.emphasis { color: #176652; font-weight: 800; }
    .report-section { margin-top: 14px; break-inside: avoid; }
    .report-section h2 { margin: 0; padding-bottom: 5px; color: #1d5e51; border-bottom: 2px solid #d7e8e1; font-size: 13px; }
    .section-text { margin: 7px 0; color: #556b73; }
    .footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; padding-top: 8px; color: #71838a; border-top: 1px solid #dce8e3; font-size: 8px; }
  </style></head><body><header class="masthead"><div class="brand">EduCore Manager</div><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle || '')}</p><div class="meta">${meta.map((item) => `<div class="meta-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value || '—')}</strong></div>`).join('')}</div></header>${columns.length ? renderTable(columns, rows) : ''}${sectionMarkup}<footer class="footer"><span>${escapeHtml(isEnglish ? 'Generated by EduCore Manager' : 'تم إنشاء هذا التقرير من EduCore Manager')}</span><span>${escapeHtml(isEnglish ? 'Issued' : 'تاريخ الإصدار')}: ${escapeHtml(generatedAt)}</span><span>${escapeHtml(isEnglish ? 'Teacher signature' : 'توقيع المعلم')}: __________________</span></footer><script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script></body></html>`;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
}

function ClassReport({ snapshot, classId, className }) {
  const classData = snapshot?.classes?.find((item) => item.id === classId);
  const roster = useMemo(() => buildClassRoster(snapshot, classId), [snapshot, classId]);
  const followUpSettings = useMemo(() => normalizeFollowUpSettings(readSettingsCache(getTeacherId(), 'follow-up-rules', DEFAULT_FOLLOW_UP_SETTINGS)), []);
  const followUpRows = useMemo(() => buildFollowUpRows(snapshot, classId, followUpSettings), [snapshot, classId, followUpSettings]);
  const followUpIds = useMemo(() => new Set(followUpRows.map((row) => row.student_id)), [followUpRows]);
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
        || (reportFilter === 'negative-behavior' && row.behaviorScore < 0)
        || (reportFilter === 'follow-up' && followUpIds.has(row.student_id));
      return matchesSearch && matchesFilter;
    });
  }, [roster, studentSearch, reportFilter, followUpIds]);
  const gradeChart = visibleRoster.filter((row) => row.finalGrade !== null).map((row) => ({ name: row.full_name, grade: row.finalGrade }));
  const reportKpis = useMemo(() => {
    const graded = roster.filter((row) => row.finalGrade !== null);
    const attendance = roster.filter((row) => row.attendanceRate !== null);
    return {
      students: roster.length,
      average: graded.length ? Math.round(graded.reduce((sum, row) => sum + row.finalGrade, 0) / graded.length) : null,
      attendance: attendance.length ? Math.round(attendance.reduce((sum, row) => sum + row.attendanceRate, 0) / attendance.length) : null,
      alerts: followUpRows.length,
    };
  }, [roster, followUpRows]);

  const printClassReport = () => {
    const profile = teacherProfile();
    const isEnglish = document.documentElement.lang === 'en';
    openFormalReport({
      title: isEnglish ? 'Official class report' : 'التقرير الرسمي للصف',
      subtitle: isEnglish ? 'Academic, behavior, and attendance overview' : 'ملخص أكاديمي وسلوكي وحضور رسمي',
      landscape: true,
      meta: [
        { label: isEnglish ? 'School' : 'المدرسة', value: profile.school_name },
        { label: isEnglish ? 'Teacher' : 'المعلم', value: profile.full_name },
        { label: isEnglish ? 'Subject' : 'المادة', value: profile.subject },
        { label: isEnglish ? 'Stage' : 'المرحلة', value: profile.school_stage },
        { label: isEnglish ? 'Class' : 'الصف', value: className },
        { label: isEnglish ? 'Students' : 'عدد الطلاب', value: roster.length },
      ],
      columns: [
        { key: 'index', label: isEnglish ? '#' : 'م' },
        { key: 'name', label: isEnglish ? 'Student' : 'الطالب' },
        { key: 'grade', label: isEnglish ? 'Final grade' : 'الدرجة النهائية', emphasis: true },
        { key: 'behavior', label: isEnglish ? 'Behavior points' : 'نقاط السلوك' },
        { key: 'attendance', label: isEnglish ? 'Attendance' : 'نسبة الحضور' },
        { key: 'followUp', label: isEnglish ? 'Follow-up' : 'المتابعة' },
      ],
      rows: visibleRoster.map((row, index) => ({
        index: index + 1,
        name: row.full_name,
        grade: row.finalGrade === null ? '—' : `${row.finalGrade}%`,
        behavior: row.behaviorScore,
        attendance: row.attendanceRate === null ? '—' : `${row.attendanceRate}%`,
        followUp: followUpIds.has(row.student_id) ? (isEnglish ? 'Required' : 'يحتاج متابعة') : '—',
      })),
    });
  };

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
        <div className="flex gap-2"><button className="btn-secondary text-sm" onClick={exportCSV}>تصدير Excel/CSV</button><button className="btn-primary text-sm" onClick={printClassReport}>تصدير PDF رسمي A4</button></div>
      </div>
      <div className="report-kpi-grid print:hidden"><div><span>الطلاب</span><strong>{reportKpis.students}</strong></div><div><span>متوسط الدرجة</span><strong>{reportKpis.average === null ? '—' : `${reportKpis.average}%`}</strong></div><div><span>متوسط الحضور</span><strong>{reportKpis.attendance === null ? '—' : `${reportKpis.attendance}%`}</strong></div><div><span>تنبيهات متابعة</span><strong>{reportKpis.alerts}</strong></div></div>
      <div className="report-filters print:hidden"><div className="analytics-search"><span>⌕</span><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="بحث سريع عن طالب" /></div><select className="input text-sm" value={reportFilter} onChange={(event) => setReportFilter(event.target.value)}><option value="all">كل الطلاب</option><option value="graded">تم رصد الدرجة</option><option value="missing">دون درجة نهائية</option><option value="low-attendance">حضور أقل من 75%</option><option value="negative-behavior">سلوك سلبي</option><option value="follow-up">يحتاجون متابعة</option></select><span>عرض {visibleRoster.length} من {roster.length}</span></div>
      <div className="card p-6 mb-6">
        <h2 className="text-xl font-bold mb-1">{classData?.name || className}</h2>
        <p className="text-ink/60 text-sm mb-4">تاريخ التقرير: {new Date().toLocaleDateString('ar')} — محسوب محليًا</p>
        <div className="table-scroll-sticky max-h-80"><table className="table-head-sticky w-full text-sm"><thead><tr><th className="text-right px-4 py-2">الطالب</th><th className="text-right px-4 py-2">الدرجة النهائية</th><th className="text-right px-4 py-2">نقاط السلوك</th><th className="text-right px-4 py-2">نسبة الحضور</th></tr></thead><tbody>{visibleRoster.map((row) => <tr key={row.student_id} className="border-t border-line"><td className="px-4 py-2">{row.full_name}</td><td className="px-4 py-2 font-bold text-primary">{row.finalGrade !== null ? `${row.finalGrade}%` : '—'}</td><td className={`px-4 py-2 ${row.behaviorScore >= 0 ? 'text-primary' : 'text-danger'}`}>{row.behaviorScore}</td><td className="px-4 py-2">{row.attendanceRate !== null ? `${row.attendanceRate}%` : '—'}</td></tr>)}</tbody></table></div>
      </div>
      {gradeChart.length > 0 && <div className="card p-4"><h3 className="font-bold mb-3">مقارنة الدرجات النهائية بين الطلاب</h3><ResponsiveContainer width="100%" height={Math.max(220, gradeChart.length * 36)}><BarChart data={gradeChart} layout="vertical" margin={{ top: 12, right: 48, left: 20, bottom: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="grade" fill="#2E7D6B" radius={[0, 6, 6, 0]} name="الدرجة %"><LabelList dataKey="grade" position="right" formatter={(value) => `${value}%`} fill="#1B2430" fontSize={11} fontWeight={700} /></Bar></BarChart></ResponsiveContainer></div>}
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

  const printStudentReport = () => {
    const profile = teacherProfile();
    const isEnglish = document.documentElement.lang === 'en';
    const gradeRows = report.gradesByCategory.flatMap((category) => category.items.map((item) => ({
      category: category.category,
      assessment: item.title || item.assessment || '—',
      score: item.score === null || item.score === undefined ? '—' : `${item.score} / ${item.max_score}`,
    })));
    const behaviorRows = report.behaviorLogs.map((log) => ({
      behavior: log.label || log.behavior?.label || '—',
      polarity: log.polarity === 'negative' ? (isEnglish ? 'Negative' : 'سلبي') : (isEnglish ? 'Positive' : 'إيجابي'),
      note: log.note_text || '—',
      date: log.occurred_at ? new Date(log.occurred_at).toLocaleDateString(isEnglish ? 'en-US' : 'ar') : '—',
    }));
    openFormalReport({
      title: isEnglish ? 'Official student report' : 'التقرير الرسمي للطالب',
      subtitle: isEnglish ? 'Unified academic, behavior, and attendance record' : 'السجل الأكاديمي والسلوكي والحضور الموحّد',
      meta: [
        { label: isEnglish ? 'School' : 'المدرسة', value: profile.school_name },
        { label: isEnglish ? 'Teacher' : 'المعلم', value: profile.full_name },
        { label: isEnglish ? 'Subject' : 'المادة', value: profile.subject },
        { label: isEnglish ? 'Stage' : 'المرحلة', value: profile.school_stage },
        { label: isEnglish ? 'Class' : 'الصف', value: report.class?.name },
        { label: isEnglish ? 'Student' : 'الطالب', value: report.student.full_name },
      ],
      columns: [
        { key: 'category', label: isEnglish ? 'Category' : 'الفئة' },
        { key: 'assessment', label: isEnglish ? 'Assessment' : 'التقييم' },
        { key: 'score', label: isEnglish ? 'Score' : 'الدرجة', emphasis: true },
      ],
      rows: gradeRows,
      sections: [
        { title: isEnglish ? 'Summary' : 'الملخص', columns: [
          { key: 'metric', label: isEnglish ? 'Metric' : 'المؤشر' },
          { key: 'value', label: isEnglish ? 'Value' : 'القيمة', emphasis: true },
        ], rows: [
          { metric: isEnglish ? 'Final grade' : 'الدرجة النهائية', value: report.finalGrade === null ? '—' : `${report.finalGrade}%` },
          { metric: isEnglish ? 'Behavior points' : 'نقاط السلوك', value: report.behaviorScore },
          { metric: isEnglish ? 'Attendance records' : 'سجلات الحضور', value: report.attendance.length },
        ] },
        { title: isEnglish ? 'Behavior record' : 'السجل السلوكي', columns: [
          { key: 'behavior', label: isEnglish ? 'Behavior' : 'السلوك' },
          { key: 'polarity', label: isEnglish ? 'Type' : 'النوع' },
          { key: 'note', label: isEnglish ? 'Note' : 'الملاحظة' },
          { key: 'date', label: isEnglish ? 'Date' : 'التاريخ' },
        ], rows: behaviorRows },
        ...(report.autoRecommendation ? [{ title: isEnglish ? 'Teacher recommendation' : 'توصية المعلم', text: report.autoRecommendation }] : []),
      ],
    });
  };

  return <div>
    <div className="flex items-center justify-between mb-4 print:hidden"><h3 className="text-lg font-bold">تقرير الطالب الموحّد</h3><button className="btn-primary text-sm" onClick={printStudentReport}>تصدير PDF رسمي A4</button></div>
    <div className="card p-6 mb-6"><h2 className="text-xl font-bold mb-1">{report.student.full_name}</h2><p className="text-ink/60 text-sm mb-4">{report.class?.name} — تقرير محلي</p><div className="grid grid-cols-4 gap-3"><div className="text-center"><p className="text-xs text-ink/50">الدرجة النهائية</p><p className="text-2xl font-bold text-primary">{report.finalGrade !== null ? `${report.finalGrade}%` : '—'}</p></div><div className="text-center"><p className="text-xs text-ink/50">نقاط السلوك</p><p className="text-2xl font-bold text-primary">{report.behaviorScore}</p></div><div className="text-center"><p className="text-xs text-ink/50">سجلات الحضور</p><p className="text-2xl font-bold text-ink">{report.attendance.length}</p></div><div className="text-center"><p className="text-xs text-ink/50">فئات التقييم</p><p className="text-2xl font-bold text-ink">{report.gradesByCategory.length}</p></div></div>{report.autoRecommendation && <div className="mt-4 bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm"><span className="font-bold text-primary">توصية المعلم التلقائية: </span>{report.autoRecommendation}</div>}</div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div className="card p-4"><h4 className="font-bold text-sm mb-1">متوسط الدرجات حسب الفئة</h4><ResponsiveContainer width="100%" height={250}><BarChart data={categoryBars} margin={{ top: 22, right: 18, left: 8, bottom: 44 }}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="name" interval={0} angle={-24} textAnchor="end" height={56} tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="percent" fill="#2E7D6B" radius={[6, 6, 0, 0]} name="المتوسط %"><LabelList dataKey="percent" position="top" formatter={(value) => `${value}%`} fill="#1B2430" fontSize={10} fontWeight={700} /></Bar></BarChart></ResponsiveContainer></div>{growth.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">النمو الأكاديمي عبر الزمن</h4><ResponsiveContainer width="100%" height={240}><LineChart data={growth} margin={{ top: 24, right: 18, left: 8, bottom: 18 }}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="index" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="percent" stroke="#E0A548" strokeWidth={3} dot={{ r: 3 }}><LabelList dataKey="percent" position="top" formatter={(value) => `${value}%`} fill="#1B2430" fontSize={10} fontWeight={700} /></Line></LineChart></ResponsiveContainer></div>}{behaviorPie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">توزيع السلوك</h4><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={behaviorPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62} label={renderPieLabel} labelLine={{ stroke: '#8DAAA1', strokeWidth: 1 }}>{behaviorPie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}{attendancePie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">توزيع الحضور</h4><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={attendancePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62} label={renderPieLabel} labelLine={{ stroke: '#8DAAA1', strokeWidth: 1 }}>{attendancePie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}</div>
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
