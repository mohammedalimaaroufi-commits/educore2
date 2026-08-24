import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, Cell, LabelList } from 'recharts';
import StudentAvatar from './StudentAvatar.jsx';
import StudentDetailModal from './StudentDetailModal.jsx';
import { getTeacherId } from '../utils/localCache.js';
import { readSettingsCache } from '../utils/settingsCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';
import { useLocale } from '../context/LocaleContext.jsx';
import {
  buildCategoryAverages,
  buildDistribution,
  buildGrowth,
  buildClassRoster,
  buildFollowUpRows,
  DEFAULT_FOLLOW_UP_SETTINGS,
  normalizeFollowUpSettings,
} from '../utils/analyticsSelectors.js';

const SORT_OPTIONS = {
  name: (a, b) => a.full_name.localeCompare(b.full_name, 'ar'),
  grade: (a, b) => (b.finalGrade ?? -1) - (a.finalGrade ?? -1),
  behavior: (a, b) => b.behaviorScore - a.behaviorScore,
  attendance: (a, b) => (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1),
};

function FollowUpReason({ reason, locale, t }) {
  const details = reason.details || [];
  return <div className="rounded-lg border border-line bg-white/70 p-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <strong className="text-danger">{reason.label}</strong><span className="font-bold text-ink/70">{reason.value}</span>
    </div>
    {details.length > 0 && <div className="mt-2 space-y-1 text-[11px] text-ink/60">
      {reason.key === 'behavior' && details.map((item, index) => <div key={`${item.occurred_at || 'behavior'}-${index}`} className="flex flex-wrap gap-1 border-t border-line/60 pt-1"><span className="font-medium text-danger">{item.label}</span><span>−{item.points} {t('analyticsPoints')}</span>{item.note && <span>· {item.note}</span>}{item.occurred_at && <time className="text-ink/35">· {new Date(item.occurred_at).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US')}</time>}</div>)}
      {(reason.key === 'grade' || reason.key === 'missing-grade') && details.map((category) => <div key={category.category} className="border-t border-line/60 pt-1"><div className="flex flex-wrap justify-between gap-1"><span className="font-medium">{category.category}</span><span>{category.percent === null ? t('analyticsNoGrades') : `${category.percent}%`} · {t('analyticsWeight')} {category.weight}%</span></div><div className="flex flex-wrap gap-x-2 gap-y-1 text-ink/45">{category.items.map((item) => <span key={`${category.category}-${item.title}`}>{item.title}: {item.score === null ? '—' : `${item.score}/${item.max}`}{item.comment ? ` · ${item.comment}` : ''}</span>)}</div></div>)}
      {(reason.key === 'absence' || reason.key === 'late') && details.map((item, index) => <span key={`${item.session_date || reason.key}-${index}`} className="inline-block border-t border-line/60 pt-1 ml-2">{item.session_date || '—'}</span>)}
    </div>}
  </div>;
}

function FollowUpList({ rows, onOpenStudent, locale, settings, t }) {
  const thresholds = settings.thresholds;
  const activeRules = [
    settings.enabled.behavior && t('analyticsRuleBehavior', '', { value: thresholds.behaviorScore }),
    settings.enabled.grade && t('analyticsRuleGrade', '', { value: thresholds.finalGrade }),
    settings.enabled.missingGrade && t('analyticsRuleMissingGrade'),
    settings.enabled.absence && t('analyticsRuleAbsence', '', { value: thresholds.absentDays }),
    settings.enabled.late && t('analyticsRuleLate', '', { value: thresholds.lateDays }),
  ].filter(Boolean).join(t('analyticsListSeparator'));
  if (!rows.length) return <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 text-center text-sm text-primary">{t('analyticsNoMatches')}</div>;
  return <div className="space-y-2">
    {rows.map((row) => <article key={row.student_id} className="rounded-xl2 border border-line bg-white/80 p-3">
      <div className="flex flex-wrap items-start gap-3"><StudentAvatar name={row.full_name} photoUrl={row.student.photo_url} size={34} /><div className="min-w-0 flex-1"><button type="button" onClick={() => onOpenStudent(row.student_id)} className="font-bold text-right hover:text-primary">{row.full_name}</button><div className="mt-1 flex flex-wrap gap-1 text-[11px]"><span className="rounded-full bg-danger/10 px-2 py-0.5 text-danger">{t('analyticsReasons')} {row.reasons.length}</span><span className="rounded-full bg-surface px-2 py-0.5 text-ink/60">{row.finalGrade === null ? '—' : `${row.finalGrade}%`}</span><span className="rounded-full bg-surface px-2 py-0.5 text-ink/60">{row.attendanceRate === null ? '—' : `${row.attendanceRate}%`}</span></div></div><button type="button" className="btn-secondary text-xs" onClick={() => onOpenStudent(row.student_id)}>{t('analyticsOpenStudent')}</button></div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">{row.reasons.map((reason) => <FollowUpReason key={reason.key} reason={reason} locale={locale} t={t} />)}</div>
    </article>)}
    <p className="text-[11px] text-ink/45">{t('analyticsActiveRulesSummary', '', { label: t('analyticsActiveRules'), rules: activeRules || t('analyticsNoRules') })}</p>
  </div>;
}

export default function AnalyticsTab({ classId }) {
  const { t, locale } = useLocale();
  const [snapshot, setSnapshot] = useState(null);
  const [sortBy, setSortBy] = useState('grade');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState('all');
  const [growth, setGrowth] = useState([]);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpSettings, setFollowUpSettings] = useState(() => normalizeFollowUpSettings(readSettingsCache(getTeacherId(), 'follow-up-rules', DEFAULT_FOLLOW_UP_SETTINGS)));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const refreshFollowUpRules = () => setFollowUpSettings(normalizeFollowUpSettings(readSettingsCache(getTeacherId(), 'follow-up-rules', DEFAULT_FOLLOW_UP_SETTINGS)));
    window.addEventListener('educore-follow-up-rules-updated', refreshFollowUpRules);
    return () => window.removeEventListener('educore-follow-up-rules-updated', refreshFollowUpRules);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getOrSyncSnapshot(getTeacherId())
      .then((data) => { if (active) setSnapshot(data); })
      .catch(() => { if (active) setError(t('analyticsLoadError')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [classId]);

  const roster = useMemo(() => buildClassRoster(snapshot, classId), [snapshot, classId]);
  const distribution = useMemo(() => Object.entries(buildDistribution(roster)).map(([range, count]) => ({ range, count })), [roster]);
  const categoryAverages = useMemo(() => buildCategoryAverages(snapshot, classId), [snapshot, classId]);
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
  const followUpCount = useMemo(() => {
    const { enabled, thresholds } = followUpSettings;
    return roster.filter((row) => (
      (enabled.behavior && row.behaviorScore <= thresholds.behaviorScore)
      || (enabled.grade && row.finalGrade !== null && row.finalGrade < thresholds.finalGrade)
      || (enabled.missingGrade && row.finalGrade === null)
      || (enabled.absence && row.absentCount >= thresholds.absentDays)
      || (enabled.late && row.lateCount >= thresholds.lateDays)
    )).length;
  }, [roster, followUpSettings]);
  const followUpRows = useMemo(() => (
    followUpOpen ? buildFollowUpRows(snapshot, classId, followUpSettings, t) : []
  ), [snapshot, classId, followUpSettings, t, followUpOpen]);
  const analyticsKpis = useMemo(() => {
    const graded = roster.filter((row) => row.finalGrade !== null);
    const attendance = roster.filter((row) => row.attendanceRate !== null);
    return {
      students: roster.length,
      average: graded.length ? Math.round(graded.reduce((sum, row) => sum + row.finalGrade, 0) / graded.length) : null,
      attendance: attendance.length ? Math.round(attendance.reduce((sum, row) => sum + row.attendanceRate, 0) / attendance.length) : null,
      needsAttention: followUpCount,
    };
  }, [roster, followUpCount]);

  const loadGrowth = (studentId) => {
    setSelectedStudent(studentId);
    if (!studentId) { setGrowth([]); return; }
    setGrowth(buildGrowth(snapshot, studentId));
  };

  if (loading && !snapshot) return <p className="text-ink/50">{t('analyticsLoading')}</p>;
  if (error && !snapshot) return <div className="card p-6 text-center text-danger">{error}<button className="btn-secondary text-sm mr-3" onClick={() => window.location.reload()}>{t('analyticsRetry')}</button></div>;

  return (
    <div className="space-y-5">
      <div className="analytics-kpi-grid">
        <div className="analytics-kpi"><span>{t('analyticsTotalStudents')}</span><strong>{analyticsKpis.students}</strong><small>{t('analyticsCurrentClass')}</small></div>
        <div className="analytics-kpi analytics-kpi--primary"><span>{t('analyticsAverageGrades')}</span><strong>{analyticsKpis.average === null ? '—' : `${analyticsKpis.average}%`}</strong><small>{t('analyticsGradedStudents')}</small></div>
        <div className="analytics-kpi analytics-kpi--accent"><span>{t('analyticsAverageAttendance')}</span><strong>{analyticsKpis.attendance === null ? '—' : `${analyticsKpis.attendance}%`}</strong><small>{t('analyticsAvailableRecords')}</small></div>
        <button type="button" className={`analytics-kpi analytics-kpi--danger text-right ${followUpOpen ? 'ring-2 ring-danger/20' : ''}`} onClick={() => setFollowUpOpen((open) => !open)}><span>{t('analyticsNeedsFollowUp')}</span><strong>{analyticsKpis.needsAttention}</strong><small>{t('analyticsFollowUpHint')}</small></button>
      </div>
      {followUpOpen && <div className="card p-4 border-t-3 border-danger/70">
        <div className="flex items-start justify-between gap-3 mb-3"><div><h3 className="font-bold">{t('analyticsFollowUpTitle')}</h3><p className="text-xs text-ink/50 mt-1">{t('analyticsFollowUpDescription')}</p></div><button type="button" className="btn-secondary text-xs" onClick={() => setFollowUpOpen(false)}>{t('close')}</button></div>
        <FollowUpList rows={followUpRows} onOpenStudent={setDetailStudentId} locale={locale} settings={followUpSettings} t={t} />
      </div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-4">
        <h3 className="font-bold mb-1">{t('analyticsGradeDistribution')}</h3>
        <p className="text-xs text-ink/50 mb-3">{t('analyticsGradeDistributionDescription')}</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={distribution} margin={{ top: 22, right: 14, left: 4, bottom: 12 }} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" />
            <XAxis dataKey="range" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#2E7D6B" radius={[6, 6, 0, 0]} name={t('analyticsStudentCount')}><LabelList dataKey="count" position="top" formatter={(value) => `${value}`} fill="#1B2430" fontSize={12} fontWeight={700} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-4">
        <h3 className="font-bold mb-1">{t('analyticsAverageByCategory')}</h3>
        <p className="text-xs text-ink/50 mb-3">{t('analyticsAverageByCategoryDescription')}</p>
        <div className="analytics-category-chart-shell" dir="ltr">
          <div className="analytics-category-labels" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-label={t('analyticsCategoryNames')}>
            {categoryAverages.map((category, index) => (
              <div key={category.category || index} className="analytics-category-label" title={category.category}>
                <span>{category.category || '—'}</span>
              </div>
            ))}
          </div>
          <div className="analytics-category-bars">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryAverages} layout="vertical" margin={{ top: 12, right: 58, left: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="category" width={0} tick={false} tickLine={false} axisLine={false} interval={0} />
                <Tooltip formatter={(v, n, p) => [v === null ? t('analyticsNoGrades') : `${v}%`, `${t('analyticsAverage')} ${p.payload.category}`]} />
                <Bar dataKey="averagePercent" radius={[0, 6, 6, 0]} name={t('analyticsAverage')}>
                  {categoryAverages.map((category, index) => (
                    <Cell key={category.category || index} fill={category.averagePercent === null ? '#E4E1D8' : category.averagePercent >= 70 ? '#2E7D6B' : category.averagePercent >= 50 ? '#E0A548' : '#C1553D'} />
                  ))}
                  <LabelList dataKey="averagePercent" position="right" formatter={(value) => value === null ? '—' : `${value}%`} fill="#1B2430" fontSize={11} fontWeight={700} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">{t('analyticsStudentGrowth')}</h3>
          <select className="input text-sm w-48" value={selectedStudent} onChange={(event) => loadGrowth(event.target.value)}>
            <option value="">{t('analyticsChooseStudent')}</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}
          </select>
        </div>
        {growth.length === 0 ? (
          <p className="text-ink/50 text-sm">{t('analyticsChooseStudentHint')}</p>
        ) : (
          <>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={growth} margin={{ top: 22, right: 22, left: 8, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E1D8" />
              <XAxis dataKey="index" tick={{ fontSize: 12 }} label={{ value: t('analyticsAssessments'), position: 'insideBottom', offset: -2, fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value, name, payload) => [`${value}%`, payload.payload.title]} />
              <Legend />
              <Line type="monotone" dataKey="percent" stroke="#E0A548" strokeWidth={3} dot={{ r: 4 }} name={t('analyticsPercentage')}><LabelList dataKey="percent" position="top" formatter={(value) => `${value}%`} fill="#1B2430" fontSize={10} fontWeight={700} /></Line>
            </LineChart>
          </ResponsiveContainer>
          </>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-bold">{t('analyticsTermSummary')}</h3>
          <div className="flex flex-wrap gap-2">
            <div className="analytics-search"><span>⌕</span><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder={t('analyticsSearchStudent')} /></div>
            <select className="input text-xs w-40" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}><option value="all">{t('analyticsAllStatuses')}</option><option value="needs-grade">{t('analyticsWithoutGrade')}</option><option value="low-grade">{t('analyticsBelow60')}</option><option value="attendance">{t('analyticsAttendanceBelow75')}</option><option value="behavior">{t('analyticsBehaviorFollowUp')}</option></select>
            <select className="input text-xs w-40" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="grade">{t('analyticsSortGrade')}</option>
            <option value="behavior">{t('analyticsSortBehavior')}</option>
            <option value="attendance">{t('analyticsSortAttendance')}</option>
            <option value="name">{t('analyticsSortName')}</option>
            </select>
          </div>
        </div>
        <div className="mb-2 text-xs text-ink/50">{t('analyticsShowing', '', { visible: sortedRoster.length, total: roster.length })}</div>
        <div className="table-scroll-sticky max-h-72">
          <table className="table-head-sticky w-full text-sm">
            <thead><tr>
              <th className="text-right px-3 py-2">{t('analyticsStudent')}</th>
              <th className="text-right px-3 py-2">{t('analyticsFinalGrade')}</th>
              <th className="text-right px-3 py-2">{t('analyticsBehaviorPoints')}</th>
              <th className="text-right px-3 py-2">{t('analyticsAttendanceRate')}</th>
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
        <h3 className="font-bold mb-3">{t('analyticsAllStudentDetails')}</h3>
        <p className="text-xs text-ink/50 mb-3">{t('analyticsAllStudentDetailsDescription')}</p>
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
