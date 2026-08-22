import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import CommentPicker from './CommentPicker.jsx';
import { getTeacherId, readSessionCache } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, syncSnapshot } from '../utils/snapshotSync.js';
import { buildGradeMap, calculateAssessmentCoverage, calculateFinalGrade, getAssessmentMaxScore, getCategoryAssessments, getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { useLocale } from '../context/LocaleContext.jsx';

const CATEGORY_COLORS = ['#2E7D6B', '#3F6FB0', '#7A5CA1', '#C1553D', '#B98A2E', '#3F9C86'];

function downloadCSV(filename, rows, headers) {
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => `"${(row[header] ?? '').toString().replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
    const raw = localStorage.getItem('educore_teacher');
    const stored = raw ? JSON.parse(raw) : {};
    const session = stored?.id ? readSessionCache(stored.id) : null;
    return { ...(session?.teacher || {}), ...stored };
  } catch {
    return {};
  }
}

function gradeColor(grade) {
  if (grade === null) return 'text-ink/30';
  if (grade >= 90) return 'text-primary';
  if (grade >= 70) return 'text-primary/80';
  if (grade >= 60) return 'text-accent';
  return 'text-danger';
}

function snapshotWithGrade(snapshot, entry) {
  const key = `${entry.assessment_id}:${entry.student_id}`;
  const source = Array.isArray(snapshot.grades) ? snapshot.grades : Object.values(snapshot.grades || {});
  const old = source.filter((grade) => `${grade.assessment_id}:${grade.student_id}` !== key);
  return { ...snapshot, grades: [...old, { ...entry, id: `${entry.assessment_id}:${entry.student_id}` }] };
}

function snapshotWithoutAssessment(snapshot, assessmentId) {
  const source = Array.isArray(snapshot?.grades) ? snapshot.grades : Object.values(snapshot?.grades || {});
  const filtered = source.filter((grade) => String(grade.assessment_id) !== String(assessmentId));
  return { ...snapshot, grades: filtered };
}

export default function GradeMatrix({ classId, className }) {
  const { t, locale } = useLocale();
  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [grades, setGrades] = useState({});
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openComment, setOpenComment] = useState(null);
  const [newAssessment, setNewAssessment] = useState(null);
  const [editingAssessmentId, setEditingAssessmentId] = useState(null);
  const [assessmentForm, setAssessmentForm] = useState({ title: '', max_score: '', date: '' });
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const teacherId = getTeacherId();

  const load = async () => {
    setLoading(true);
    const data = await getOrSyncSnapshot(teacherId);
    const classData = getClassData(data, classId);
    setSnapshot(data);
    setStudents(classData.students);
    setCategories(classData.categories);
    setGrades(Object.fromEntries(buildGradeMap(data)));
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    load().catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [classId]);

  const cellKey = (assessmentId, studentId) => `${assessmentId}:${studentId}`;
  const categoryColor = (index) => CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  const gradeMap = useMemo(() => new Map(Object.entries(grades)), [grades]);
  const itemsFor = (category) => {
    const items = getCategoryAssessments(category);
    if (category?.grading_mode !== 'detailed') return items;
    // Keep an already-entered category-level score visible after the first detail is
    // added. The summary row is retained as a safe fallback until the teacher enters
    // at least one detail for that student; it is never deleted or silently discarded.
    const summary = (category.assessments || []).find((assessment) => Number(assessment.is_summary));
    const hasSavedSummary = summary && students.some((student) => {
      const value = gradeMap.get(cellKey(summary.id, student.id))?.score_numeric;
      return value !== null && value !== undefined && value !== '';
    });
    return hasSavedSummary ? [summary, ...items] : items;
  };
  const coverageFor = (category, assessment) => calculateAssessmentCoverage(category, assessment, students, gradeMap);
  const coverageLabel = (coverage) => coverage.percent === null ? t('noGrading') : t('gradingCoverage', '', { percent: coverage.percent, entered: coverage.entered_count, total: coverage.total_students });
  const detailTotalFor = (category) => (category.assessments || [])
    .filter((assessment) => !Number(assessment.is_summary))
    .reduce((sum, assessment) => sum + Number(assessment.max_score || 0), 0);
  const detailStatusFor = (category) => {
    const total = detailTotalFor(category);
    const weight = Number(category.weight_percent || 0);
    if (total > weight) return { tone: 'text-danger bg-danger/10', label: t('overBy', '', { value: (total - weight).toFixed(2) }) };
    if (total < weight) return { tone: 'text-accent bg-accent/10', label: t('remainingBy', '', { value: (weight - total).toFixed(2) }) };
    return { tone: 'text-primary bg-primary/10', label: t('balanced') };
  };

  const setCell = (assessmentId, studentId, field, value) => {
    setGrades((current) => ({
      ...current,
      [cellKey(assessmentId, studentId)]: {
        ...current[cellKey(assessmentId, studentId)],
        [field]: value,
      },
    }));
  };

  const saveCell = async (assessmentId, studentId) => {
    const key = cellKey(assessmentId, studentId);
    const cell = grades[key] || {};
    const entry = {
      assessment_id: assessmentId,
      student_id: studentId,
      score_numeric: cell.score_numeric === '' || cell.score_numeric == null ? null : Number(cell.score_numeric),
      comment: cell.comment || null,
    };
    setSavingKey(key);
    const nextSnapshot = snapshot ? snapshotWithGrade(snapshot, entry) : null;
    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
      void saveSnapshot(teacherId, nextSnapshot);
    }
    try {
      await api.post('/grades/matrix', { entries: [entry] });
      void syncSnapshot(teacherId, { force: true });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/grades/matrix', data: { entries: [entry] } });
    } finally {
      setSavingKey(null);
      setSavedKey(key);
      setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 1000);
    }
  };

  const startAdding = (category) => {
    setNewAssessment(category.id);
    setAssessmentForm({ title: '', max_score: '', date: '' });
  };

  const addAssessment = async (event) => {
    event.preventDefault();
    const category = categories.find((item) => item.id === newAssessment);
    const maxScore = Number(assessmentForm.max_score || 0);
    const payload = {
      id: `local-assessment-${Date.now()}`,
      category_id: newAssessment,
      title: assessmentForm.title.trim(),
      max_score: maxScore,
      date: assessmentForm.date || null,
      is_summary: 0,
    };
    if (!category || !payload.title || maxScore <= 0) return;
    const localAssessment = {
      ...payload,
      created_at: new Date().toISOString(),
    };
    setCategories((current) => current.map((item) => item.id === newAssessment
      ? { ...item, grading_mode: 'detailed', assessments: [...(item.assessments || []), localAssessment] }
      : item));
    if (snapshot) {
      const nextSnapshot = {
        ...snapshot,
        assessments: [...(snapshot.assessments || []), localAssessment],
        grade_categories: (snapshot.grade_categories || []).map((item) => item.id === newAssessment
          ? { ...item, grading_mode: 'detailed' }
          : item),
      };
      setSnapshot(nextSnapshot);
      void saveSnapshot(teacherId, nextSnapshot);
    }
    setAssessmentForm({ title: '', max_score: '', date: '' });
    setNewAssessment(null);
    try {
      const { data } = await api.post('/grades/assessments', payload);
      const savedAssessment = data?.assessment || localAssessment;
      setCategories((current) => current.map((item) => item.id === newAssessment
        ? { ...item, assessments: (item.assessments || []).map((assessment) => assessment.id === localAssessment.id ? savedAssessment : assessment) }
        : item));
      if (snapshot) {
        const syncedSnapshot = {
          ...snapshot,
          assessments: (snapshot.assessments || []).map((assessment) => assessment.id === localAssessment.id ? savedAssessment : assessment),
          grade_categories: (snapshot.grade_categories || []).map((item) => item.id === newAssessment
            ? { ...item, grading_mode: 'detailed' }
            : item),
        };
        setSnapshot(syncedSnapshot);
        void saveSnapshot(teacherId, syncedSnapshot);
      }
      void syncSnapshot(teacherId, { force: true });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/grades/assessments', data: payload });
    }
  };

  const updateAssessment = async (assessment, patch) => {
    const nextAssessment = { ...assessment, ...patch };
    setCategories((current) => current.map((category) => ({
      ...category,
      assessments: (category.assessments || []).map((item) => item.id === assessment.id ? nextAssessment : item),
    })));
    if (snapshot) {
      const nextSnapshot = {
        ...snapshot,
        assessments: (snapshot.assessments || []).map((item) => item.id === assessment.id ? nextAssessment : item),
      };
      setSnapshot(nextSnapshot);
      void saveSnapshot(teacherId, nextSnapshot);
    }
    try {
      await api.patch(`/grades/assessments/${assessment.id}`, patch);
      void syncSnapshot(teacherId, { force: true });
    } catch {
      await queueMutation(teacherId, { method: 'PATCH', url: `/grades/assessments/${assessment.id}`, data: patch });
    }
  };

  const deleteAssessment = async (assessment) => {
    if (Number(assessment.is_summary)) {
      alert(t('cannotDeleteSummary'));
      return;
    }
    if (!confirm(t('deleteAssessmentConfirm'))) return;
    setCategories((current) => current.map((category) => ({
      ...category,
      assessments: (category.assessments || []).filter((item) => item.id !== assessment.id),
    })));
    setGrades((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${assessment.id}:`))));
    if (snapshot) {
      const nextSnapshot = {
        ...snapshot,
        assessments: (snapshot.assessments || []).filter((item) => item.id !== assessment.id),
        grades: snapshotWithoutAssessment(snapshot, assessment.id).grades,
      };
      setSnapshot(nextSnapshot);
      void saveSnapshot(teacherId, nextSnapshot);
    }
    try {
      await api.delete(`/grades/assessments/${assessment.id}`);
      void syncSnapshot(teacherId, { force: true });
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/grades/assessments/${assessment.id}` });
    }
  };

  const finalGrade = (studentId) => calculateFinalGrade(studentId, categories, gradeMap);

  const categoryScore = (studentId, category) => {
    const items = itemsFor(category);
    const detailed = items.filter((assessment) => !Number(assessment.is_summary));
    const enteredDetails = detailed.filter((assessment) => {
      const value = gradeMap.get(cellKey(assessment.id, studentId))?.score_numeric;
      return value !== null && value !== undefined && value !== '';
    });
    if (enteredDetails.length > 0) {
      const maxTotal = detailed.reduce((sum, assessment) => sum + Number(assessment.max_score || 0), 0);
      const scoreTotal = detailed.reduce((sum, assessment) => sum + Number(gradeMap.get(cellKey(assessment.id, studentId))?.score_numeric || 0), 0);
      return maxTotal > 0 ? (scoreTotal / maxTotal) * Number(category.weight_percent || 0) : null;
    }
    const summary = items.find((assessment) => Number(assessment.is_summary));
    const score = gradeMap.get(cellKey(summary?.id, studentId))?.score_numeric;
    return score === '' || score == null ? null : Number(score);
  };

  const downloadGradebookPDF = () => {
    const profile = teacherProfile();
    const generatedAt = new Date().toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const categoryHeader = categories.map((category) => `<th>${escapeHtml(category.name)}<small>${escapeHtml(t('categoryTotal'))} · ${escapeHtml(category.weight_percent)}%</small></th>`).join('');
    const body = students.map((student, index) => {
      const cells = categories.map((category) => {
        const total = categoryScore(student.id, category);
        return `<td class="category-total">${total == null ? '—' : escapeHtml(Number(total).toFixed(2))}</td>`;
      });
      const final = finalGrade(student.id);
      return `<tr><td class="student-number">${index + 1}</td><td class="student-name">${escapeHtml(student.full_name)}</td>${cells.join('')}<td class="final-grade">${final == null ? '—' : escapeHtml(Number(final).toFixed(2))}</td></tr>`;
    }).join('');
    const html = `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${escapeHtml(t('gradebookTitle'))} ${escapeHtml(className || t('className'))}</title><style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font-family: "Noto Sans Arabic", "Arial", sans-serif; color: #182b36; margin: 0; font-size: 9px; }
      .masthead { border: 2px solid #2e7d6b; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; }
      .brand { color: #2e7d6b; font-size: 18px; font-weight: 800; margin-bottom: 3px; }
      h1 { font-size: 18px; margin: 0 0 10px; color: #152b36; }
      .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px 18px; border-top: 1px solid #dbe5e2; padding-top: 9px; }
      .meta span { color: #71818a; display: block; font-size: 8px; margin-bottom: 2px; }
      .meta strong { font-size: 10px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #b9cbc5; padding: 5px 4px; text-align: center; vertical-align: middle; word-break: break-word; }
      thead tr:first-child th { background: #2e7d6b; color: #fff; font-size: 10px; }
      thead tr:nth-child(2) th { background: #edf5f2; color: #23434a; font-weight: 700; }
      th small { display: block; font-size: 7px; font-weight: 400; opacity: .8; }
      tbody tr:nth-child(even) { background: #f7faf9; }
      .student-number { width: 28px; color: #71818a; }
      .student-name { width: 145px; text-align: right; font-weight: 700; }
      .category-total { background: #f0f6f3; font-weight: 700; }
      .category-total::before { content: ''; }
      .final-grade { background: #e9f3ef; color: #176652; font-weight: 800; width: 60px; }
      .muted { color: #829097; font-size: 7px; }
      .footer { display: flex; justify-content: space-between; margin-top: 12px; color: #687a82; font-size: 8px; border-top: 1px solid #dbe5e2; padding-top: 7px; }
      @media print { .no-print { display: none; } }
    </style></head><body>
      <section class="masthead"><div class="brand">EduCore Manager</div><h1>${escapeHtml(t('formalGradebook'))}</h1><div class="meta">
        <div><span>${escapeHtml(t('schoolName'))}</span><strong>${escapeHtml(profile.school_name || '—')}</strong></div>
        <div><span>${escapeHtml(t('teacherLabel'))}</span><strong>${escapeHtml(profile.full_name || '—')}</strong></div>
        <div><span>${escapeHtml(t('subject'))}</span><strong>${escapeHtml(profile.subject || '—')}</strong></div>
        <div><span>${escapeHtml(t('className'))}</span><strong>${escapeHtml(className || '—')}</strong></div>
        <div><span>${escapeHtml(t('schoolStage'))}</span><strong>${escapeHtml(profile.school_stage || '—')}</strong></div>
        <div><span>${escapeHtml(t('studentCountLabel'))}</span><strong>${students.length}</strong></div>
        <div><span>${escapeHtml(t('categoryCountLabel'))}</span><strong>${categories.length}</strong></div>
        <div><span>${escapeHtml(t('issuedAt'))}</span><strong>${escapeHtml(generatedAt)}</strong></div>
      </div></section>
      <table><thead><tr><th>${escapeHtml(t('indexLabel'))}</th><th>${escapeHtml(t('students'))}</th>${categoryHeader}<th>${escapeHtml(t('finalGrade'))}<br>%</th></tr></thead><tbody>${body}</tbody></table>
      <div class="footer"><span>${escapeHtml(t('pdfGeneratedBy'))}</span><span>${escapeHtml(t('teacherSignature'))}: ____________________</span><span>${escapeHtml(t('schoolApproval'))}: ____________________</span></div>
      <script>window.addEventListener('load', () => setTimeout(() => { window.print(); }, 250));</script>
    </body></html>`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const exportCSV = () => {
    const headers = [
      'الاسم',
      ...categories.flatMap((category) => itemsFor(category).map((assessment) => `${category.name} - ${assessment.title}`)),
      'الدرجة النهائية %',
    ];
    const rows = students.map((student) => {
      const row = { الاسم: student.full_name };
      categories.forEach((category) => itemsFor(category).forEach((assessment) => {
        row[`${category.name} - ${assessment.title}`] = grades[cellKey(assessment.id, student.id)]?.score_numeric ?? '';
      }));
      row['الدرجة النهائية %'] = finalGrade(student.id) ?? '';
      return row;
    });
    downloadCSV(`درجات_${className || 'الصف'}.csv`, rows, headers);
  };

  if (loading) return <p className="text-ink/50">{t('gradebookLoading')}</p>;
  if (categories.length === 0) return <div className="card p-10 text-center"><p className="text-ink/60 mb-1">{t('noCategories')}</p><p className="text-ink/40 text-sm">{t('openCategoriesToAdd')}</p></div>;
  if (students.length === 0) return <div className="card p-10 text-center text-ink/60">{t('addStudentsFirst')}</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 print:hidden">
        <div>
          <h3 className="font-bold">{t('fullGradeTable')}</h3>
          <p className="text-xs text-ink/50">{t('gradebookDescription')}</p><span className="grade-matrix-hint">{t('horizontalHint')}</span>
        </div>
        <div className="flex gap-2"><button className="btn-secondary text-sm" onClick={exportCSV}>{t('csvExport')}</button><button className="btn-primary text-sm" onClick={downloadGradebookPDF}>{t('downloadPdf')}</button></div>
      </div>
      <div className="card grade-matrix-card">
        <div className="grade-matrix-scroll" role="region" aria-label={t('scrollableGradeTable')}>
        <table className="grade-matrix-table text-xs border-collapse">
          <thead>
            <tr>
              <th className="grade-matrix-sticky grade-matrix-sticky--header text-right px-3 py-2 border-b-2 border-line min-w-[150px] z-20">{t('students')}</th>
              {categories.map((category, index) => <th key={category.id} colSpan={itemsFor(category).length + 1} className="text-center px-2 py-2 border-b-2 text-white font-bold" style={{ background: categoryColor(index), borderColor: categoryColor(index) }}>{category.name} <span className="opacity-80 font-normal">({category.weight_percent}%)</span></th>)}
              <th className="text-center px-3 py-2 border-b-2 border-ink min-w-[90px] bg-ink text-white">{t('finalGrade')} %</th>
            </tr>
            <tr>
              <th className="grade-matrix-sticky grade-matrix-sticky--subheader text-right px-3 py-2 text-[11px] text-ink/50 font-medium z-20">{t('subCategoryDetails')}</th>
              {categories.map((category, index) => (
                <React.Fragment key={category.id}>
                  {itemsFor(category).map((assessment) => (
                    <th key={assessment.id} className="grade-subassessment-head px-2 py-1.5 border-b border-line font-normal min-w-[82px]" style={{ background: `${categoryColor(index)}14` }}>
                      <div className="flex flex-col items-center justify-center gap-1">
                        {Number(assessment.is_summary) ? (
                          <>
                            <span className="font-medium">{t('categoryScore')} <span className="text-ink/40">({getAssessmentMaxScore(category, assessment)})</span></span>
                            <span className="text-[10px] text-primary">{coverageLabel(coverageFor(category, assessment))}</span>
                          </>
                        ) : editingAssessmentId === assessment.id ? (
                          <div className="grade-subassessment-editor">
                            <div className="flex items-center gap-1">
                              <input autoFocus className="input text-[11px] py-0.5 px-1 text-center w-24" defaultValue={assessment.title} aria-label={`${t('subAssessmentTitle')} ${assessment.title}`} onBlur={(event) => { const title = event.target.value.trim(); if (title && title !== assessment.title) updateAssessment(assessment, { title }); }} />
                              <button type="button" className="text-danger text-base leading-none font-bold print:hidden" title={t('deleteSubAssessment')} aria-label={`${t('deleteClass')} ${assessment.title}`} onClick={() => deleteAssessment(assessment)}>×</button>
                            </div>
                            <div className="text-[10px] text-primary">{coverageLabel(coverageFor(category, assessment))}</div>
                            <input className="input text-[11px] py-0.5 px-1 text-center w-14" type="number" min="0.01" step="any" defaultValue={assessment.max_score} aria-label={`${t('subAssessmentWeight')} ${assessment.title}`} onBlur={(event) => { const max_score = Number(event.target.value); if (max_score > 0 && max_score !== Number(assessment.max_score)) updateAssessment(assessment, { max_score }); }} />
                            <button type="button" className="text-[10px] text-primary" onClick={() => setEditingAssessmentId(null)}>{t('saveNote')}</button>
                          </div>
                        ) : (
                          <div className="grade-subassessment-chip-wrap">
                            <button type="button" className="grade-subassessment-chip" title={`${assessment.title} · ${assessment.max_score}`} onClick={() => setEditingAssessmentId(assessment.id)}>
                              <span>{assessment.title}</span><b>({assessment.max_score})</b>
                            </button>
                            <button type="button" className="grade-subassessment-delete print:hidden" title={t('deleteSubAssessment')} aria-label={`${t('deleteSubAssessment')} ${assessment.title}`} onClick={(event) => { event.stopPropagation(); deleteAssessment(assessment); }}>×</button>
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="grade-subassessment-add-cell px-2 py-1.5 border-b border-line print:hidden" style={{ background: `${categoryColor(index)}14` }}>
                    {newAssessment === category.id ? (
                      <form onSubmit={addAssessment} className="flex flex-col gap-1 p-1 min-w-[130px]">
                        <input className="input text-xs py-0.5" placeholder={t('addAssessmentName')} required autoFocus value={assessmentForm.title} onChange={(event) => setAssessmentForm({ ...assessmentForm, title: event.target.value })} />
                        <input className="input text-xs py-0.5" type="number" min="0.01" step="any" required placeholder={t('assessmentWeight')} value={assessmentForm.max_score} onChange={(event) => setAssessmentForm({ ...assessmentForm, max_score: event.target.value })} />
                        <div className="flex gap-1"><button className="btn-primary text-xs px-2 py-0.5" type="submit">{t('add')}</button><button className="btn-secondary text-xs px-2 py-0.5" type="button" onClick={() => setNewAssessment(null)}>{t('cancel')}</button></div>
                      </form>
                    ) : (() => {
                      const remaining = Number(category.weight_percent || 0) - detailTotalFor(category);
                      const remainingLabel = remaining >= 0 ? t('remainingBy', '', { value: remaining.toFixed(2).replace(/\.00$/, '') }) : t('overBy', '', { value: Math.abs(remaining).toFixed(2).replace(/\.00$/, '') });
                      return <button type="button" className="grade-subassessment-add" style={{ color: categoryColor(index) }} aria-label={`${t('add')} ${t('subAssessment')}`} title={`${t('add')} ${t('subAssessment')} · ${remainingLabel}`} onClick={() => startAdding(category)}>+</button>;
                    })()}
                  </th>
                </React.Fragment>
              ))}
              <th className="bg-surface"></th>
            </tr>
          </thead>
          <tbody>
            {students.map((student, rowIndex) => (
              <tr key={student.id} className={`border-t border-line ${rowIndex % 2 === 1 ? 'bg-surface/40' : ''}`}>
                <td className="grade-matrix-sticky grade-matrix-sticky--body px-3 py-2 font-medium z-10">{student.full_name}</td>
                {categories.map((category, categoryIndex) => (
                  <React.Fragment key={category.id}>
                    {itemsFor(category).map((assessment) => {
                      const key = cellKey(assessment.id, student.id);
                      const cell = grades[key] || {};
                      return (
                        <td key={assessment.id} className="px-1 py-1 border-r border-line" style={{ background: `${categoryColor(categoryIndex)}08` }}>
                          <div className="flex flex-col gap-0.5 items-center">
                            <div className="relative">
                              <input type="number" min="0" max={getAssessmentMaxScore(category, assessment)} className="input text-xs py-1.5 text-center w-16 font-medium" value={cell.score_numeric ?? ''} onChange={(event) => setCell(assessment.id, student.id, 'score_numeric', event.target.value)} onBlur={() => saveCell(assessment.id, student.id)} />
                              {savingKey === key && <span className="absolute -left-3 top-1/2 -translate-y-1/2 text-[10px] text-ink/30">⋯</span>}
                              {savedKey === key && <span className="absolute -left-3 top-1/2 -translate-y-1/2 text-[10px] text-primary">✓</span>}
                            </div>
                            <button className="text-[10px] text-ink/40 print:hidden" onClick={() => setOpenComment(openComment === key ? null : key)}>{cell.comment ? `📝 ${t('note')}` : `+ ${t('addNote')}`}</button>
                            {openComment === key && <div className="w-40"><CommentPicker value={cell.comment} onChange={(value) => setCell(assessment.id, student.id, 'comment', value)} category="grade" /><button className="text-[10px] text-primary mt-0.5" onClick={() => { saveCell(assessment.id, student.id); setOpenComment(null); }}>{t('saveNote')}</button></div>}
                          </div>
                        </td>
                      );
                    })}
                    <td></td>
                  </React.Fragment>
                ))}
                <td className={`px-3 py-2 text-center font-bold ${gradeColor(finalGrade(student.id))}`}>{finalGrade(student.id) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
