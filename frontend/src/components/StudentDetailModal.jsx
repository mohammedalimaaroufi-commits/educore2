import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import StudentAvatar from './StudentAvatar.jsx';
import { ATTENDANCE_STATUS } from '../constants.js';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot } from '../utils/snapshotSync.js';
import { buildStudentReport } from '../utils/analyticsSelectors.js';
import { useLocale } from '../context/LocaleContext.jsx';

const TAB_KEYS = [
  { id: 'overview', key: 'studentDetailOverview' },
  { id: 'grades', key: 'studentDetailGrades' },
  { id: 'behavior', key: 'studentDetailBehavior' },
  { id: 'attendance', key: 'studentDetailAttendance' },
];

export default function StudentDetailModal({ studentId, onClose }) {
  const { t, locale } = useLocale();
  const [tab, setTab] = useState('overview');
  const [report, setReport] = useState(null);

  useEffect(() => {
    let active = true;
    if (!studentId) return undefined;
    setReport(null);
    getOrSyncSnapshot(getTeacherId()).then((snapshot) => {
      if (active) setReport(buildStudentReport(snapshot, studentId));
    }).catch(() => {
      if (active) setReport(null);
    });
    return () => { active = false; };
  }, [studentId]);

  if (!studentId) return null;

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl2 max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        {!report ? (
          <div className="p-8 text-center text-ink/50">{t('studentDetailLoading')}</div>
        ) : (
          <>
            <div className="p-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StudentAvatar name={report.student.full_name} photoUrl={report.student.photo_url} size={48} />
                <div>
                  <h3 className="font-bold text-lg">{report.student.full_name}</h3>
                  <p className="text-xs text-ink/50">{report.class?.name}</p>
                </div>
              </div>
              <button className="text-ink/50 text-xl" onClick={onClose} aria-label={t('studentDetailClose')}>×</button>
            </div>

            <div className="flex gap-2 px-5 pt-3">
              {TAB_KEYS.map((item) => (
                <button key={item.id} onClick={() => setTab(item.id)} className={`px-3 py-1.5 rounded-full text-xs border ${tab === item.id ? 'bg-primary text-white border-primary' : 'border-line'}`}>
                  {t(item.key)}
                </button>
              ))}
            </div>

            <div className="p-5">
              {tab === 'overview' && (
                <div className="grid grid-cols-4 gap-3">
                  <div className="card p-3 text-center"><p className="text-xs text-ink/50 mb-1">{t('reportsGrade')}</p><p className="text-2xl font-bold text-primary">{report.finalGrade !== null ? `${report.finalGrade}%` : '—'}</p></div>
                  <div className="card p-3 text-center"><p className="text-xs text-ink/50 mb-1">{t('reportsBehaviorPoints')}</p><p className={`text-2xl font-bold ${report.behaviorScore >= 0 ? 'text-primary' : 'text-danger'}`}>{report.behaviorScore}</p></div>
                  <div className="card p-3 text-center"><p className="text-xs text-ink/50 mb-1">{t('reportsAttendanceRate')}</p><p className="text-2xl font-bold text-primary">{report.attendance.length > 0 ? `${Math.round(((report.attendanceTotals.present || 0) / report.attendance.length) * 100)}%` : '—'}</p></div>
                  <div className="card p-3 text-center"><p className="text-xs text-ink/50 mb-1">{t('studentDetailBehavior')}</p><p className="text-2xl font-bold text-ink">{report.behaviorLogs.length}</p></div>
                  {report.autoRecommendation && <div className="col-span-4 bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm"><span className="font-bold text-primary">{t('reportsTeacherRecommendation')}: </span>{report.autoRecommendation}</div>}
                  {(report.student.health_notes || report.student.private_notes) && <div className="col-span-4 card p-3 text-sm space-y-1">{report.student.health_notes && <p><span className="font-medium">{t('studentDetailHealthNotes')}:</span> {report.student.health_notes}</p>}{report.student.private_notes && <p><span className="font-medium">{t('studentDetailPrivateNotes')}:</span> {report.student.private_notes}</p>}</div>}
                </div>
              )}

              {tab === 'grades' && (
                <div className="space-y-3">
                  {report.gradesByCategory.map((category) => (
                    <div key={category.category} className="border border-line rounded-lg p-3">
                      <p className="font-medium text-sm mb-2">{category.category} ({category.weight_percent}%)</p>
                      {category.items.length === 0 ? <p className="text-xs text-ink/40">{t('studentDetailNoGrades')}</p> : <div className="space-y-1">{category.items.map((item, index) => <div key={index} className="flex justify-between text-xs"><span>{item.title}</span><span className="font-medium">{item.score !== null ? `${item.score}/${item.max_score}` : '—'}</span></div>)}</div>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'behavior' && (
                <div className="space-y-2">
                  {report.behaviorLogs.length === 0 && <p className="text-ink/50 text-sm">{t('studentDetailNoBehavior')}</p>}
                  {report.behaviorLogs.map((log, index) => (
                    <div key={index} className={`flex items-center gap-2 text-sm border-b border-line pb-2 ${log.polarity === 'positive' ? 'text-primary' : 'text-danger'}`}>
                      <Icon name="star" className="w-4 h-4 shrink-0" /><span className="font-medium">{log.label}</span><span className="text-ink/40 text-xs">({log.points > 0 ? '+' : ''}{log.points})</span>{log.note_text && <span className="text-ink/60 text-xs">— {log.note_text}</span>}<span className="text-ink/30 text-xs mr-auto">{new Date(log.occurred_at).toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US')}</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'attendance' && (
                <div className="space-y-2">
                  {report.attendance.length === 0 && <p className="text-ink/50 text-sm">{t('studentDetailNoAttendance')}</p>}
                  {report.attendance.map((attendance, index) => {
                    const status = ATTENDANCE_STATUS[attendance.status] || ATTENDANCE_STATUS.present;
                    return <div key={index} className="flex items-center gap-2 text-sm border-b border-line pb-2"><Icon name={status.icon} className={`w-4 h-4 ${status.color}`} /><span>{attendance.session_date}</span><span className={`text-xs mr-auto px-2 py-0.5 rounded-full ${status.bg}`}>{t({ present: 'reportsPresent', absent: 'reportsAbsent', late: 'reportsLate', excused: 'reportsExcused' }[attendance.status] || 'reportsPresent')}</span></div>;
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
