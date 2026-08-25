import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';
import CommentPicker from './CommentPicker.jsx';
import { getTeacherId, readSessionCache, readStoredTeacher } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, scheduleBackgroundSync } from '../utils/snapshotSync.js';
import { buildGradeMap, calculateAssessmentCoverage, calculateFinalGrade, getAssessmentMaxScore, getCategoryAssessments, getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';
import Icon from './Icon.jsx';

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
    const stored = readStoredTeacher() || {};
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

export default function GradeMatrix({ classId, className, viewOptions = {}, onActionsChange }) {
  const { t, locale } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const showNotes = viewOptions.showNotes !== false;
  const showSubDetails = viewOptions.showSubDetails !== false;
  const categoryUnit = viewOptions.categoryUnit === 'points' ? 'points' : 'percentage';
  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [grades, setGrades] = useState({});
  const [collapsedCategories, setCollapsedCategories] = useState(() => new Set());
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openComment, setOpenComment] = useState(null);
  const [newAssessment, setNewAssessment] = useState(null);
  const [editingAssessmentId, setEditingAssessmentId] = useState(null);
  const [assessmentForm, setAssessmentForm] = useState({ title: '', max_score: '', date: '' });
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [quickAssessmentId, setQuickAssessmentId] = useState('');
  const [quickStudentIndex, setQuickStudentIndex] = useState(0);
  const [quickScore, setQuickScore] = useState('');
  const [quickError, setQuickError] = useState('');
  const quickScoreRef = useRef(null);
  const actionsRef = useRef(null);
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
    const assessments = category?.assessments || [];
    const details = assessments.filter((assessment) => !Number(assessment.is_summary));
    const summary = assessments.find((assessment) => Number(assessment.is_summary));
    // Once a category has details, show only those details in the editable grid.
    // The summary assessment and its grades remain in the snapshot as a safe fallback
    // for students without detail scores; they are deliberately not rendered twice.
    if (details.length > 0) return details;
    return summary ? [summary] : getCategoryAssessments(category);
  };
  const visibleItemsFor = (category) => {
    if (showSubDetails) return itemsFor(category);
    const summary = (category?.assessments || []).find((assessment) => Number(assessment.is_summary));
    return summary ? [summary] : itemsFor(category).slice(0, 1);
  };
  const categoryLimitLabel = (category) => categoryUnit === 'points'
    ? String(Number(category?.weight_percent || 0)).replace(/\.00$/, '')
    : `${category?.weight_percent || 0}%`;
  const categoryHasDetails = (category) => (category?.assessments || []).some((assessment) => !Number(assessment.is_summary));
  const isCategoryCollapsed = (category) => categoryHasDetails(category) && (!showSubDetails || collapsedCategories.has(String(category.id)));
  const toggleCategory = (categoryId) => setCollapsedCategories((current) => {
    const next = new Set(current);
    const key = String(categoryId);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const coverageFor = (category, assessment) => calculateAssessmentCoverage(category, assessment, students, gradeMap);
  const coverageLabel = (coverage) => coverage.percent === null ? t('noGrading') : t('gradingCoverage', '', { percent: coverage.percent, entered: coverage.entered_count, total: coverage.total_students });
  const quickOptions = useMemo(() => categories.flatMap((category) => visibleItemsFor(category).map((assessment) => ({ category, assessment }))), [categories, showSubDetails]);
  const quickSelection = quickOptions.find((option) => String(option.assessment.id) === String(quickAssessmentId)) || null;
  const quickStudent = students[quickStudentIndex] || null;

  useEffect(() => {
    if (!showNotes) setOpenComment(null);
  }, [showNotes]);

  useEffect(() => {
    if (!quickEntryOpen || quickOptions.length === 0) return;
    if (!quickOptions.some((option) => String(option.assessment.id) === String(quickAssessmentId))) {
      setQuickAssessmentId(String(quickOptions[0].assessment.id));
    }
  }, [quickEntryOpen, quickOptions, quickAssessmentId]);

  useEffect(() => {
    if (!quickEntryOpen || !quickSelection || !quickStudent) return;
    const current = grades[cellKey(quickSelection.assessment.id, quickStudent.id)]?.score_numeric;
    setQuickScore(current ?? '');
    setQuickError('');
    window.requestAnimationFrame(() => quickScoreRef.current?.focus());
  }, [quickEntryOpen, quickSelection?.assessment.id, quickStudent?.id]);

  useEffect(() => {
    if (!quickEntryOpen) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') setQuickEntryOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickEntryOpen]);
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

  const saveCell = async (assessmentId, studentId, overrides = {}) => {
    const key = cellKey(assessmentId, studentId);
    const cell = { ...(grades[key] || {}), ...overrides };
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
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/grades/matrix', data: { entries: [entry] } });
    } finally {
      setSavingKey(null);
      setSavedKey(key);
      setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 1000);
    }
  };

  const openQuickEntry = () => {
    if (!quickOptions.length) return;
    setQuickAssessmentId(String(quickSelection?.assessment.id || quickOptions[0].assessment.id));
    setQuickStudentIndex(0);
    setQuickError('');
    setQuickEntryOpen(true);
  };

  const persistQuickScore = async () => {
    if (!quickSelection || !quickStudent) return false;
    const max = Number(getAssessmentMaxScore(quickSelection.category, quickSelection.assessment));
    const value = quickScore === '' ? null : Number(quickScore);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > max)) {
      setQuickError(t('quickGradeInvalid', '', { max }));
      return false;
    }
    const key = cellKey(quickSelection.assessment.id, quickStudent.id);
    const currentValue = grades[key]?.score_numeric ?? null;
    if (String(currentValue ?? '') !== String(value ?? '')) {
      setCell(quickSelection.assessment.id, quickStudent.id, 'score_numeric', value ?? '');
      await saveCell(quickSelection.assessment.id, quickStudent.id, { score_numeric: value });
    }
    setQuickError('');
    return true;
  };

  const moveQuickStudent = async (delta) => {
    const saved = await persistQuickScore();
    if (!saved) return;
    setQuickStudentIndex((current) => Math.min(Math.max(current + delta, 0), students.length - 1));
  };

  const saveQuickGrade = async (event) => {
    event?.preventDefault();
    const saved = await persistQuickScore();
    if (!saved) return;
    if (quickStudentIndex + 1 < students.length) {
      setQuickStudentIndex((current) => current + 1);
      setQuickScore('');
    } else {
      setQuickEntryOpen(false);
      setQuickScore('');
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
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
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
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'PATCH', url: `/grades/assessments/${assessment.id}`, data: patch });
    }
  };

  const deleteAssessment = async (assessment) => {
    if (Number(assessment.is_summary)) {
      await confirm({ title: t('cannotDeleteSummaryTitle'), message: t('cannotDeleteSummary'), confirmLabel: t('understood'), cancelLabel: t('close'), danger: false });
      return;
    }
    const accepted = await confirm({ title: t('deleteAssessmentTitle'), message: t('deleteAssessmentConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
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
      scheduleBackgroundSync(teacherId, { force: true, delayMs: 700 });
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/grades/assessments/${assessment.id}` });
    }
  };

  const categoryScores = useMemo(() => {
    const scores = new Map();
    students.forEach((student) => categories.forEach((category) => {
      const assessments = category?.assessments || [];
      const details = assessments.filter((assessment) => !Number(assessment.is_summary));
      const summary = assessments.find((assessment) => Number(assessment.is_summary));
      const items = details.length > 0 ? details : summary ? [summary] : getCategoryAssessments(category);
      const enteredDetails = details.filter((assessment) => {
        const value = gradeMap.get(cellKey(assessment.id, student.id))?.score_numeric;
        return value !== null && value !== undefined && value !== '';
      });
      let score = null;
      if (enteredDetails.length > 0) {
        const maxTotal = details.reduce((sum, assessment) => sum + Number(assessment.max_score || 0), 0);
        const scoreTotal = details.reduce((sum, assessment) => sum + Number(gradeMap.get(cellKey(assessment.id, student.id))?.score_numeric || 0), 0);
        score = maxTotal > 0 ? (scoreTotal / maxTotal) * Number(category.weight_percent || 0) : null;
      } else {
        const fallback = summary || items.find((assessment) => Number(assessment.is_summary));
        const value = gradeMap.get(cellKey(fallback?.id, student.id))?.score_numeric;
        score = value === '' || value == null ? null : Number(value);
      }
      scores.set(`${student.id}:${category.id}`, score);
    }));
    return scores;
  }, [students, categories, gradeMap]);
  const finalGrades = useMemo(() => new Map(students.map((student) => (
    [student.id, calculateFinalGrade(student.id, categories, gradeMap)]
  ))), [students, categories, gradeMap]);
  const finalGrade = (studentId) => finalGrades.get(studentId) ?? null;
  const categoryScore = (studentId, category) => categoryScores.get(`${studentId}:${category.id}`) ?? null;

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
    const nameHeader = t('students');
    const finalHeader = `${t('finalGrade')} %`;
    const headers = [
      nameHeader,
      ...categories.flatMap((category) => itemsFor(category).map((assessment) => `${category.name} - ${assessment.title}`)),
      finalHeader,
    ];
    const rows = students.map((student) => {
      const row = { [nameHeader]: student.full_name };
      categories.forEach((category) => itemsFor(category).forEach((assessment) => {
        row[`${category.name} - ${assessment.title}`] = grades[cellKey(assessment.id, student.id)]?.score_numeric ?? '';
      }));
      row[finalHeader] = finalGrade(student.id) ?? '';
      return row;
    });
    downloadCSV(`${t('csvGradebookPrefix')}_${className || t('className')}.csv`, rows, headers);
  };

  actionsRef.current = { openQuickEntry, exportCSV, downloadGradebookPDF, canQuickEntry: quickOptions.length > 0 };
  useEffect(() => {
    if (!onActionsChange) return undefined;
    onActionsChange({
      openQuickEntry: () => actionsRef.current?.openQuickEntry(),
      exportCSV: () => actionsRef.current?.exportCSV(),
      downloadGradebookPDF: () => actionsRef.current?.downloadGradebookPDF(),
      canQuickEntry: Boolean(actionsRef.current?.canQuickEntry),
    });
    return () => onActionsChange(null);
  }, [onActionsChange, quickOptions.length]);

  if (loading) return <p className="text-ink/50">{t('gradebookLoading')}</p>;
  if (categories.length === 0) return <div className="card p-10 text-center"><p className="text-ink/60 mb-1">{t('noCategories')}</p><p className="text-ink/40 text-sm">{t('openCategoriesToAdd')}</p></div>;
  if (students.length === 0) return <div className="card p-10 text-center text-ink/60">{t('addStudentsFirst')}</div>;

  return (
    <div>
      {confirmDialog}
      <div className="gradebook-local-strip print:hidden"><span>{savedKey ? `${t('savedLocally')} ✓` : t('localDataSaved')}</span><span>{t('horizontalHint')}</span></div>
      {quickEntryOpen && quickSelection && quickStudent && <div className="quick-grade-backdrop" role="presentation">
        <section className="quick-grade-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-grade-title" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <header className="quick-grade-dialog__header">
            <div><span className="quick-grade-dialog__eyebrow">{t('quickEntry')}</span><h3 id="quick-grade-title">{t('quickEntryTitle')}</h3></div>
            <button type="button" className="quick-grade-dialog__close" onClick={() => setQuickEntryOpen(false)} aria-label={t('quickClose')} title={t('quickClose')}><Icon name="x" className="w-5 h-5" /></button>
          </header>
          <div className="quick-grade-dialog__body">
            <div className="quick-grade-top-grid">
              <label className="quick-grade-field"><span>{t('quickAssessment')}</span><select className="input" value={quickAssessmentId} onChange={(event) => { setQuickAssessmentId(event.target.value); setQuickStudentIndex(0); setQuickError(''); }}>
                {quickOptions.map(({ category, assessment }) => <option key={assessment.id} value={assessment.id}>{category.name} — {Number(assessment.is_summary) ? t('categoryScore') : assessment.title} ({getAssessmentMaxScore(category, assessment)})</option>)}
              </select></label>
              <div className="quick-grade-progress"><div><span>{t('quickStudentLabel')}</span><strong>{quickStudentIndex + 1} / {students.length}</strong></div><div className="quick-grade-progress__track"><span style={{ width: `${((quickStudentIndex + 1) / students.length) * 100}%` }} /></div></div>
              <div className="quick-grade-student-column">
                <button type="button" className="quick-grade-student-nav quick-grade-student-nav--previous" onClick={() => void moveQuickStudent(-1)} disabled={quickStudentIndex === 0} aria-label={t('quickPreviousStudent')} title={t('quickPreviousStudent')}><Icon name="chevronUp" className="w-4 h-4" /><span>{t('quickPreviousStudent')}</span></button>
                <div className="quick-grade-student"><span className="quick-grade-student__index">{quickStudentIndex + 1}</span><div><span>{t('student')}</span><strong>{quickStudent.full_name}</strong></div></div>
                <button type="button" className="quick-grade-student-nav quick-grade-student-nav--next" onClick={() => void moveQuickStudent(1)} disabled={quickStudentIndex === students.length - 1} aria-label={t('quickNextStudent')} title={t('quickNextStudent')}><Icon name="chevronDown" className="w-4 h-4" /><span>{t('quickNextStudent')}</span></button>
              </div>
            </div>
            <form className="quick-grade-form" onSubmit={saveQuickGrade}>
              <label className="quick-grade-field"><span>{t('quickScore')}</span><div className="quick-grade-input-wrap"><input ref={quickScoreRef} className="quick-grade-input" type="number" min="0" max={getAssessmentMaxScore(quickSelection.category, quickSelection.assessment)} step="any" inputMode="decimal" value={quickScore} onChange={(event) => { setQuickScore(event.target.value); setQuickError(''); }} aria-label={`${quickStudent.full_name} — ${quickSelection.assessment.title}`} /><b>/ {getAssessmentMaxScore(quickSelection.category, quickSelection.assessment)}</b></div></label>
              {quickError && <p className="quick-grade-error" role="alert">{quickError}</p>}
              <button className="quick-grade-save" type="submit"><Icon name="check" className="w-4 h-4" /><span>{quickStudentIndex + 1 < students.length ? t('quickSaveNext') : t('quickFinish')}</span></button>
            </form>
            <p className="quick-grade-tip">{t('quickEntryHint')}</p>
          </div>
        </section>
      </div>}
      <div className="card grade-matrix-card">
        <div className="grade-matrix-scroll" role="region" aria-label={t('scrollableGradeTable')}>
        <table className="grade-matrix-table text-xs border-collapse">
          <thead>
            <tr>
              <th className="grade-matrix-sticky grade-matrix-sticky--header text-right px-3 py-2 border-b-2 border-line min-w-[132px] z-20">{t('students')}</th>
              {categories.map((category, index) => {
                const collapsed = isCategoryCollapsed(category);
                const hasDetails = showSubDetails && categoryHasDetails(category);
                return <th key={category.id} colSpan={collapsed ? 1 : visibleItemsFor(category).length + 1} className="grade-category-header text-center px-2 py-2 border-b-2 text-white font-bold" style={{ background: categoryColor(index), borderColor: categoryColor(index) }}>
                  <div className="grade-category-header__content"><span>{category.name} <span className="opacity-80 font-normal">({categoryLimitLabel(category)})</span></span>{hasDetails && <button type="button" className="grade-category-toggle" onClick={() => toggleCategory(category.id)} aria-expanded={!collapsed} aria-label={collapsed ? t('expandDetails') : t('collapseDetails')} title={collapsed ? t('expandDetails') : t('collapseDetails')}><Icon name={collapsed ? 'chevronDown' : 'chevronUp'} className="w-4 h-4" /></button>}</div>
                </th>;
              })}
              <th className="text-center px-2 py-1.5 border-b-2 border-ink min-w-[72px] bg-ink text-white">{t('finalGrade')} %</th>
            </tr>
            <tr>
              <th className="grade-matrix-sticky grade-matrix-sticky--subheader text-right px-3 py-2 text-[11px] text-ink/50 font-medium z-20">{t('subCategoryDetails')}</th>
              {categories.map((category, index) => (
                <React.Fragment key={category.id}>
                  {isCategoryCollapsed(category) ? <th className="grade-category-summary-head px-2 py-1.5 border-b border-line" style={{ background: `${categoryColor(index)}14` }}><span>{t('categoryScore')}</span><small>({categoryLimitLabel(category)})</small></th> : <>{visibleItemsFor(category).map((assessment) => (
                    <th key={assessment.id} className="grade-subassessment-head px-1 py-1 border-b border-line font-normal min-w-[64px]" style={{ background: `${categoryColor(index)}14` }}>
                      <div className="flex flex-col items-center justify-center gap-1">
                        {Number(assessment.is_summary) ? (
                          <>
                            <span className="font-medium">{t('categoryScore')} <span className="text-ink/40">({categoryLimitLabel(category)})</span></span>
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
                  </th></>}
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
                    {isCategoryCollapsed(category) ? <td className="grade-category-summary-cell px-2 py-2 border-r border-line" style={{ background: `${categoryColor(categoryIndex)}08` }}><strong className={gradeColor(categoryScore(student.id, category))}>{categoryScore(student.id, category) ?? '—'}</strong><small>{t('categoryScore')}</small></td> : <>{visibleItemsFor(category).map((assessment) => {
                      const key = cellKey(assessment.id, student.id);
                      const cell = grades[key] || {};
                      return (
                        <td key={assessment.id} className="px-0.5 py-1 border-r border-line" style={{ background: `${categoryColor(categoryIndex)}08` }}>
                          <div className="flex flex-col gap-0.5 items-center">
                            <div className="relative">
                              <input type="number" min="0" max={getAssessmentMaxScore(category, assessment)} step="any" inputMode="decimal" autoComplete="off" aria-label={`${student.full_name} — ${assessment.title}`} className="input text-xs py-1 text-center w-14 font-medium" value={cell.score_numeric ?? ''} onChange={(event) => setCell(assessment.id, student.id, 'score_numeric', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} onBlur={() => saveCell(assessment.id, student.id)} />
                              {savingKey === key && <span className="absolute -left-3 top-1/2 -translate-y-1/2 text-[10px] text-ink/30">⋯</span>}
                              {savedKey === key && <span className="absolute -left-3 top-1/2 -translate-y-1/2 text-[10px] text-primary">✓</span>}
                            </div>
                            {showNotes && <>
                              <button className="text-[10px] text-ink/40 print:hidden" onClick={() => setOpenComment(openComment === key ? null : key)}>{cell.comment ? `📝 ${t('note')}` : `+ ${t('addNote')}`}</button>
                              {openComment === key && <div className="w-40"><CommentPicker value={cell.comment} onChange={(value) => setCell(assessment.id, student.id, 'comment', value)} category="grade" /><button className="text-[10px] text-primary mt-0.5" onClick={() => { saveCell(assessment.id, student.id); setOpenComment(null); }}>{t('saveNote')}</button></div>}
                            </>}
                          </div>
                        </td>
                      );
                    })}
                    <td className="grade-matrix-add-spacer" aria-hidden="true"></td>
                  </>}
                  </React.Fragment>
                ))}
                <td className={`grade-matrix-final-cell px-2 py-2 text-center font-bold ${gradeColor(finalGrade(student.id))}`}>{finalGrade(student.id) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
