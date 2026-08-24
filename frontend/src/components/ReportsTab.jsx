import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, LabelList } from 'recharts';
import { getTeacherId, readSessionCache, readStoredTeacher } from '../utils/localCache.js';
import { readSettingsCache } from '../utils/settingsCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';
import { buildClassRoster, buildGrowth, buildStudentReport, getClassData, DEFAULT_FOLLOW_UP_SETTINGS, normalizeFollowUpSettings } from '../utils/analyticsSelectors.js';
import { useLocale } from '../context/LocaleContext.jsx';

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

function openFormalReport({ title, subtitle, meta = [], columns = [], rows = [], sections = [], landscape = false, labels = {} }) {
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
  </style></head><body><header class="masthead"><div class="brand">${escapeHtml(labels.appName || 'EduCore Manager')}</div><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle || '')}</p><div class="meta">${meta.map((item) => `<div class="meta-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value || '—')}</strong></div>`).join('')}</div></header>${columns.length ? renderTable(columns, rows) : ''}${sectionMarkup}<footer class="footer"><span>${escapeHtml(labels.generatedBy || 'Generated by EduCore Manager')}</span><span>${escapeHtml(labels.issuedAt || 'Issued')}: ${escapeHtml(generatedAt)}</span><span>${escapeHtml(labels.teacherSignature || 'Teacher signature')}: __________________</span></footer><script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script></body></html>`;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
}

function ClassReport({ snapshot, classId, className }) {
  const { t, locale } = useLocale();
  const isEnglish = locale === 'en';
  const classData = snapshot?.classes?.find((item) => item.id === classId);
  const roster = useMemo(() => buildClassRoster(snapshot, classId), [snapshot, classId]);
  const followUpSettings = useMemo(() => normalizeFollowUpSettings(readSettingsCache(getTeacherId(), 'follow-up-rules', DEFAULT_FOLLOW_UP_SETTINGS)), []);
  const followUpIds = useMemo(() => new Set(roster.filter((row) => {
    const { enabled, thresholds } = followUpSettings;
    return (enabled.behavior && row.behaviorScore <= thresholds.behaviorScore)
      || (enabled.grade && row.finalGrade !== null && row.finalGrade < thresholds.finalGrade)
      || (enabled.missingGrade && row.finalGrade === null)
      || (enabled.absence && row.absentCount >= thresholds.absentDays)
      || (enabled.late && row.lateCount >= thresholds.lateDays);
  }).map((row) => row.student_id)), [roster, followUpSettings]);
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
      alerts: followUpIds.size,
    };
  }, [roster, followUpIds]);

  const printClassReport = () => {
    const profile = teacherProfile();
    openFormalReport({
      title: t('reportsOfficialClassTitle'),
      subtitle: t('reportsClassSubtitle'),
      labels: { appName: t('appName'), generatedBy: t('pdfGeneratedBy'), issuedAt: t('issuedAt'), teacherSignature: t('teacherSignature') },
      landscape: true,
      meta: [
                { label: t('reportsSchool'), value: profile.school_name },
        { label: t('reportsTeacher'), value: profile.full_name },
        { label: t('reportsSubject'), value: profile.subject },
        { label: t('reportsStage'), value: profile.school_stage },
        { label: t('reportsClass'), value: className },
        { label: t('reportsStudents'), value: roster.length },
      ],
      columns: [
        { key: 'index', label: '#' },
        { key: 'name', label: t('reportsStudent') },
        { key: 'grade', label: t('reportsGrade'), emphasis: true },
        { key: 'behavior', label: t('reportsBehaviorPoints') },
        { key: 'attendance', label: t('reportsAttendanceRate') },
        { key: 'followUp', label: t('reportsFollowUp') },
      ],
      rows: visibleRoster.map((row, index) => ({
        index: index + 1,
        name: row.full_name,
        grade: row.finalGrade === null ? '—' : `${row.finalGrade}%`,
        behavior: row.behaviorScore,
        attendance: row.attendanceRate === null ? '—' : `${row.attendanceRate}%`,
        followUp: followUpIds.has(row.student_id) ? t('reportsNeedsFollowUp') : '—',
      })),
    });
  };

  const exportCSV = () => {
    const headers = [t('reportsStudent'), t('reportsGrade'), t('reportsBehaviorPoints'), t('reportsAttendanceRate')];
    const rows = visibleRoster.map((row) => ({ [headers[0]]: row.full_name, [headers[1]]: row.finalGrade ?? '', [headers[2]]: row.behaviorScore, [headers[3]]: row.attendanceRate ?? '' }));
    downloadCSV(`${t('csvClassReportPrefix')}_${className}.csv`, rows, headers);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h3 className="text-lg font-bold">{t('reportsClassTitle')}</h3>
        <div className="flex gap-2"><button className="btn-secondary text-sm" onClick={exportCSV}>{t('reportsExportCsv')}</button><button className="btn-primary text-sm" onClick={printClassReport}>{t('reportsExportPdf')}</button></div>
      </div>
      <div className="report-kpi-grid print:hidden"><div><span>{t('reportsStudents')}</span><strong>{reportKpis.students}</strong></div><div><span>{t('reportsAverageGrade')}</span><strong>{reportKpis.average === null ? '—' : `${reportKpis.average}%`}</strong></div><div><span>{t('reportsAverageAttendance')}</span><strong>{reportKpis.attendance === null ? '—' : `${reportKpis.attendance}%`}</strong></div><div><span>{t('reportsFollowUpAlerts')}</span><strong>{reportKpis.alerts}</strong></div></div>
      <div className="report-filters print:hidden"><div className="analytics-search"><span>⌕</span><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder={t('reportsSearchPlaceholder')} /></div><select className="input text-sm" value={reportFilter} onChange={(event) => setReportFilter(event.target.value)}><option value="all">{t('reportsAllStudents')}</option><option value="graded">{t('reportsGraded')}</option><option value="missing">{t('reportsMissingGrade')}</option><option value="low-attendance">{t('reportsLowAttendance')}</option><option value="negative-behavior">{t('reportsNegativeBehavior')}</option><option value="follow-up">{t('reportsNeedsFollowUp')}</option></select><span>{t('reportsDisplaying', '', { visible: visibleRoster.length, total: roster.length })}</span></div>
      <div className="card p-6 mb-6">
        <h2 className="text-xl font-bold mb-1">{classData?.name || className}</h2>
        <p className="text-ink/60 text-sm mb-4">{t('reportsDate')}: {new Date().toLocaleDateString(isEnglish ? 'en-US' : 'ar')} — {t('reportsCalculatedLocally')}</p>
        <div className="table-scroll-sticky max-h-80"><table className="table-head-sticky w-full text-sm"><thead><tr><th className="text-right px-4 py-2">{t('reportsStudent')}</th><th className="text-right px-4 py-2">{t('reportsGrade')}</th><th className="text-right px-4 py-2">{t('reportsBehaviorPoints')}</th><th className="text-right px-4 py-2">{t('reportsAttendanceRate')}</th></tr></thead><tbody>{visibleRoster.map((row) => <tr key={row.student_id} className="border-t border-line"><td className="px-4 py-2">{row.full_name}</td><td className="px-4 py-2 font-bold text-primary">{row.finalGrade !== null ? `${row.finalGrade}%` : '—'}</td><td className={`px-4 py-2 ${row.behaviorScore >= 0 ? 'text-primary' : 'text-danger'}`}>{row.behaviorScore}</td><td className="px-4 py-2">{row.attendanceRate !== null ? `${row.attendanceRate}%` : '—'}</td></tr>)}</tbody></table></div>
      </div>
      {gradeChart.length > 0 && <div className="card p-4"><h3 className="font-bold mb-3">{t('reportsCompareGrades')}</h3><ResponsiveContainer width="100%" height={Math.max(220, gradeChart.length * 36)}><BarChart data={gradeChart} layout="vertical" margin={{ top: 12, right: 48, left: 20, bottom: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="grade" fill="#2E7D6B" radius={[0, 6, 6, 0]} name={`${t('reportsGrade')} %`}><LabelList dataKey="grade" position="right" formatter={(value) => `${value}%`} fill="#1B2430" fontSize={11} fontWeight={700} /></Bar></BarChart></ResponsiveContainer></div>}
    </div>
  );
}

function StudentReport({ snapshot, studentId }) {
  const { t, locale } = useLocale();
  const isEnglish = locale === 'en';
  const report = useMemo(() => buildStudentReport(snapshot, studentId), [snapshot, studentId]);
  const growth = useMemo(() => buildGrowth(snapshot, studentId), [snapshot, studentId]);
  if (!studentId) return <p className="text-ink/50">{t('reportsStudentPrompt')}</p>;
  if (!report) return <p className="text-danger">{t('reportsStudentMissing')}</p>;

  const behaviorPie = [{ name: t('positive'), value: report.behaviorLogs.filter((log) => log.polarity === 'positive').length }, { name: t('negative'), value: report.behaviorLogs.filter((log) => log.polarity === 'negative').length }].filter((item) => item.value > 0);
  const attendanceLabels = { present: t('reportsPresent'), absent: t('reportsAbsent'), late: t('reportsLate'), excused: t('reportsExcused') };
  const attendancePie = Object.entries(report.attendanceTotals).map(([name, value]) => ({ name: attendanceLabels[name] || name, value })).filter((item) => item.value > 0);
  const categoryBars = report.gradesByCategory.map((category) => {
    const scored = category.items.filter((item) => item.score !== null);
    const average = scored.length ? scored.reduce((sum, item) => sum + (item.score / item.max_score) * 100, 0) / scored.length : 0;
    return { name: category.category, percent: Number(average.toFixed(1)), weight: category.weight_percent };
  });

  const printStudentReport = () => {
    const profile = teacherProfile();
    const gradeRows = report.gradesByCategory.flatMap((category) => category.items.map((item) => ({
      category: category.category,
      assessment: item.title || item.assessment || '—',
      score: item.score === null || item.score === undefined ? '—' : `${item.score} / ${item.max_score}`,
    })));
    const behaviorRows = report.behaviorLogs.map((log) => ({
      behavior: log.label || log.behavior?.label || '—',
      polarity: log.polarity === 'negative' ? t('negative') : t('positive'),
      note: log.note_text || '—',
      date: log.occurred_at ? new Date(log.occurred_at).toLocaleDateString(isEnglish ? 'en-US' : 'ar') : '—',
    }));
    openFormalReport({
      title: t('reportsOfficialStudentTitle'),
      subtitle: t('reportsStudentSubtitle'),
      labels: { appName: t('appName'), generatedBy: t('pdfGeneratedBy'), issuedAt: t('issuedAt'), teacherSignature: t('teacherSignature') },
      meta: [
        { label: t('reportsSchool'), value: profile.school_name },
        { label: t('reportsTeacher'), value: profile.full_name },
        { label: t('reportsSubject'), value: profile.subject },
        { label: t('reportsStage'), value: profile.school_stage },
        { label: t('reportsClass'), value: report.class?.name },
        { label: t('reportsStudent'), value: report.student.full_name },
      ],
      columns: [
        { key: 'category', label: t('reportsCategory') },
        { key: 'assessment', label: t('reportsAssessment') },
        { key: 'score', label: t('reportsScore'), emphasis: true },
      ],
      rows: gradeRows,
      sections: [
        { title: t('reportsSummary'), columns: [
          { key: 'metric', label: t('reportsMetric') },
          { key: 'value', label: t('reportsValue'), emphasis: true },
        ], rows: [
          { metric: t('reportsGrade'), value: report.finalGrade === null ? '—' : `${report.finalGrade}%` },
          { metric: t('reportsBehaviorPoints'), value: report.behaviorScore },
          { metric: t('reportsAttendanceRecords'), value: report.attendance.length },
        ] },
        { title: t('reportsBehaviorRecord'), columns: [
          { key: 'behavior', label: t('behavior') },
          { key: 'polarity', label: t('reportsType') },
          { key: 'note', label: t('noteLabel') },
          { key: 'date', label: t('reportsDateLabel') },
        ], rows: behaviorRows },
        ...(report.autoRecommendation ? [{ title: t('reportsTeacherRecommendation'), text: report.autoRecommendation }] : []),
      ],
    });
  };

  return <div>
    <div className="flex items-center justify-between mb-4 print:hidden"><h3 className="text-lg font-bold">{t('reportsUnifiedStudent')}</h3><button className="btn-primary text-sm" onClick={printStudentReport}>{t('reportsExportPdf')}</button></div>
    <div className="card p-6 mb-6"><h2 className="text-xl font-bold mb-1">{report.student.full_name}</h2><p className="text-ink/60 text-sm mb-4">{report.class?.name} — {t('reportsLocalReport')}</p><div className="grid grid-cols-4 gap-3"><div className="text-center"><p className="text-xs text-ink/50">{t('reportsGrade')}</p><p className="text-2xl font-bold text-primary">{report.finalGrade !== null ? `${report.finalGrade}%` : '—'}</p></div><div className="text-center"><p className="text-xs text-ink/50">{t('reportsBehaviorPoints')}</p><p className="text-2xl font-bold text-primary">{report.behaviorScore}</p></div><div className="text-center"><p className="text-xs text-ink/50">{t('reportsAttendanceRecords')}</p><p className="text-2xl font-bold text-ink">{report.attendance.length}</p></div><div className="text-center"><p className="text-xs text-ink/50">{t('reportsCategories')}</p><p className="text-2xl font-bold text-ink">{report.gradesByCategory.length}</p></div></div>{report.autoRecommendation && <div className="mt-4 bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm"><span className="font-bold text-primary">{t('reportsTeacherRecommendation')}: </span>{report.autoRecommendation}</div>}</div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div className="card p-4"><h4 className="font-bold text-sm mb-1">{t('reportsAverageByCategory')}</h4><ResponsiveContainer width="100%" height={250}><BarChart data={categoryBars} margin={{ top: 22, right: 18, left: 8, bottom: 44 }}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="name" interval={0} angle={-24} textAnchor="end" height={56} tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="percent" fill="#2E7D6B" radius={[6, 6, 0, 0]} name={`${t('reportsAverageGrade')} %`}><LabelList dataKey="percent" position="top" formatter={(value) => `${value}%`} fill="#1B2430" fontSize={10} fontWeight={700} /></Bar></BarChart></ResponsiveContainer></div>{growth.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">{t('reportsAcademicGrowth')}</h4><ResponsiveContainer width="100%" height={240}><LineChart data={growth} margin={{ top: 24, right: 18, left: 8, bottom: 18 }}><CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" /><XAxis dataKey="index" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="percent" stroke="#E0A548" strokeWidth={3} dot={{ r: 3 }}><LabelList dataKey="percent" position="top" formatter={(value) => `${value}%`} fill="#1B2430" fontSize={10} fontWeight={700} /></Line></LineChart></ResponsiveContainer></div>}{behaviorPie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">{t('reportsBehaviorDistribution')}</h4><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={behaviorPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62} label={renderPieLabel} labelLine={{ stroke: '#8DAAA1', strokeWidth: 1 }}>{behaviorPie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}{attendancePie.length > 0 && <div className="card p-4"><h4 className="font-bold text-sm mb-1">{t('reportsAttendanceDistribution')}</h4><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={attendancePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62} label={renderPieLabel} labelLine={{ stroke: '#8DAAA1', strokeWidth: 1 }}>{attendancePie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}</div>
  </div>;
}

export default function ReportsTab({ classId, className }) {
  const { t } = useLocale();
  const [mode, setMode] = useState('class');
  const [snapshot, setSnapshot] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState('');

  useEffect(() => {
    let active = true;
    getOrSyncSnapshot(getTeacherId()).then((data) => { if (active) setSnapshot(data); });
    return () => { active = false; };
  }, [classId]);

  const { students } = useMemo(() => getClassData(snapshot, classId), [snapshot, classId]);
  if (!snapshot) return <p className="text-ink/50">{t('reportsPrepareLocally')}</p>;

  return <div><div className="flex flex-wrap items-center gap-2 mb-5 print:hidden"><button onClick={() => setMode('class')} className={`px-3 py-1.5 rounded-full text-sm border ${mode === 'class' ? 'bg-primary text-white border-primary' : 'border-line'}`}>{t('reportsClassMode')}</button><button onClick={() => setMode('student')} className={`px-3 py-1.5 rounded-full text-sm border ${mode === 'student' ? 'bg-primary text-white border-primary' : 'border-line'}`}>{t('reportsStudentMode')}</button>{mode === 'student' && <select className="input text-sm w-56" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)}><option value="">{t('reportsSelectStudent')}</option>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>}</div>{mode === 'class' ? <ClassReport snapshot={snapshot} classId={classId} className={className} /> : <StudentReport snapshot={snapshot} studentId={selectedStudent} />}</div>;
}
