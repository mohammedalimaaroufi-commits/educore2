import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import CommentPicker from './CommentPicker.jsx';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, syncSnapshot } from '../utils/snapshotSync.js';
import { buildGradeMap, calculateAssessmentCoverage, calculateFinalGrade, getAssessmentMaxScore, getCategoryAssessments, getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';

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
    return raw ? JSON.parse(raw) : {};
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
  const old = (snapshot.grades || []).filter((grade) => `${grade.assessment_id}:${grade.student_id}` !== key);
  return { ...snapshot, grades: [...old, { ...entry, id: `${entry.assessment_id}:${entry.student_id}` }] };
}

export default function GradeMatrix({ classId, className }) {
  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [grades, setGrades] = useState({});
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openComment, setOpenComment] = useState(null);
  const [newAssessment, setNewAssessment] = useState(null);
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
  const itemsFor = (category) => getCategoryAssessments(category);
  const coverageFor = (category, assessment) => calculateAssessmentCoverage(category, assessment, students, gradeMap);
  const coverageLabel = (coverage) => coverage.percent === null ? 'لا يوجد رصد' : `الرصد ${coverage.percent}% (${coverage.entered_count}/${coverage.total_students})`;
  const detailTotalFor = (category) => (category.assessments || [])
    .filter((assessment) => !Number(assessment.is_summary))
    .reduce((sum, assessment) => sum + Number(assessment.max_score || 0), 0);
  const detailStatusFor = (category) => {
    const total = detailTotalFor(category);
    const weight = Number(category.weight_percent || 0);
    if (total > weight) return { tone: 'text-danger bg-danger/10', label: `متجاوز بـ ${(total - weight).toFixed(2)}` };
    if (total < weight) return { tone: 'text-accent bg-accent/10', label: `متبقٍ ${(weight - total).toFixed(2)}` };
    return { tone: 'text-primary bg-primary/10', label: 'متوازن' };
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
      category_id: newAssessment,
      title: assessmentForm.title.trim(),
      max_score: maxScore,
      date: assessmentForm.date || null,
      is_summary: 0,
    };
    if (!category || !payload.title || maxScore <= 0) return;
    const localAssessment = {
      id: `local-assessment-${Date.now()}`,
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
      await api.post('/grades/assessments', payload);
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
      alert('لا يمكن حذف خانة الفئة الأساسية. يمكنك حذف التقييمات الإضافية فقط.');
      return;
    }
    if (!confirm('حذف هذا التقييم وكل الدرجات المرتبطة به؟')) return;
    setCategories((current) => current.map((category) => ({
      ...category,
      assessments: (category.assessments || []).filter((item) => item.id !== assessment.id),
    })));
    setGrades((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${assessment.id}:`))));
    if (snapshot) {
      const nextSnapshot = {
        ...snapshot,
        assessments: (snapshot.assessments || []).filter((item) => item.id !== assessment.id),
        grades: (snapshot.grades || []).filter((grade) => grade.assessment_id !== assessment.id),
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
    if (detailed.length > 0) {
      const maxTotal = detailed.reduce((sum, assessment) => sum + Number(assessment.max_score || 0), 0);
      const scoreTotal = detailed.reduce((sum, assessment) => sum + Number(gradeMap.get(cellKey(assessment.id, studentId))?.score_numeric || 0), 0);
      return maxTotal > 0 ? (scoreTotal / maxTotal) * Number(category.weight_percent || 0) : null;
    }
    const summary = items[0];
    const score = gradeMap.get(cellKey(summary?.id, studentId))?.score_numeric;
    return score === '' || score == null ? null : Number(score);
  };

  const downloadGradebookPDF = () => {
    const profile = teacherProfile();
    const generatedAt = new Date().toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
    const columns = categories.flatMap((category) => [
      ...itemsFor(category).map((assessment) => ({
        key: assessment.id,
        label: assessment.title || (Number(assessment.is_summary) ? 'درجة الفئة' : 'تقييم فرعي'),
        category: category.name,
        max: getAssessmentMaxScore(category, assessment),
      })),
      { key: `${category.id}:total`, label: 'إجمالي الفئة', category: category.name, max: category.weight_percent },
    ]);
    const categoryHeader = categories.map((category) => `<th colspan="${itemsFor(category).length + 1}">${escapeHtml(category.name)}<small> (${escapeHtml(category.weight_percent)}%)</small></th>`).join('');
    const assessmentHeader = columns.map((column) => `<th>${escapeHtml(column.label)}<small>${column.max != null ? `<br>من ${escapeHtml(column.max)}` : ''}</small></th>`).join('');
    const body = students.map((student, index) => {
      const cells = categories.flatMap((category) => [
        ...itemsFor(category).map((assessment) => {
          const value = gradeMap.get(cellKey(assessment.id, student.id))?.score_numeric;
          const max = getAssessmentMaxScore(category, assessment);
          return `<td>${value === '' || value == null ? '—' : `${escapeHtml(value)}<span class="muted"> / ${escapeHtml(max)}</span>`}</td>`;
        }),
        `<td class="category-total">${categoryScore(student.id, category) == null ? '—' : Number(categoryScore(student.id, category)).toFixed(2)}</td>`,
      ]);
      const final = finalGrade(student.id);
      return `<tr><td class="student-number">${index + 1}</td><td class="student-name">${escapeHtml(student.full_name)}</td>${cells.join('')}<td class="final-grade">${final == null ? '—' : escapeHtml(Number(final).toFixed(2))}</td></tr>`;
    }).join('');
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل درجات ${escapeHtml(className || 'الصف')}</title><style>
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
      .final-grade { background: #e9f3ef; color: #176652; font-weight: 800; width: 60px; }
      .muted { color: #829097; font-size: 7px; }
      .footer { display: flex; justify-content: space-between; margin-top: 12px; color: #687a82; font-size: 8px; border-top: 1px solid #dbe5e2; padding-top: 7px; }
      @media print { .no-print { display: none; } }
    </style></head><body>
      <section class="masthead"><div class="brand">EduCore Manager</div><h1>سجل الدرجات الرسمي</h1><div class="meta">
        <div><span>اسم المدرسة</span><strong>${escapeHtml(profile.school_name || '—')}</strong></div>
        <div><span>المعلم</span><strong>${escapeHtml(profile.full_name || '—')}</strong></div>
        <div><span>المادة</span><strong>${escapeHtml(profile.subject || '—')}</strong></div>
        <div><span>الصف</span><strong>${escapeHtml(className || '—')}</strong></div>
        <div><span>المرحلة الدراسية</span><strong>${escapeHtml(profile.school_stage || '—')}</strong></div>
        <div><span>عدد الطلاب</span><strong>${students.length}</strong></div>
        <div><span>عدد الفئات</span><strong>${categories.length}</strong></div>
        <div><span>تاريخ الإصدار</span><strong>${escapeHtml(generatedAt)}</strong></div>
      </div></section>
      <table><thead><tr><th rowspan="2">م</th><th rowspan="2">اسم الطالب</th>${categoryHeader}<th rowspan="2">النهائية<br>%</th></tr><tr>${assessmentHeader}</tr></thead><tbody>${body}</tbody></table>
      <div class="footer"><span>تم إنشاء هذا السجل من EduCore Manager</span><span>توقيع المعلم: ____________________</span><span>اعتماد المدرسة: ____________________</span></div>
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

  if (loading) return <p className="text-ink/50">جارِ تجهيز دفتر الدرجات محليًا...</p>;
  if (categories.length === 0) return <div className="card p-10 text-center"><p className="text-ink/60 mb-1">لا توجد فئات تقييم لهذا الصف بعد.</p><p className="text-ink/40 text-sm">افتح تبويب "فئات التقييم" لإضافة فئة.</p></div>;
  if (students.length === 0) return <div className="card p-10 text-center text-ink/60">أضف طلابًا من تبويب "الطلاب" أولًا.</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 print:hidden">
        <div>
          <h3 className="font-bold">جدول الدرجات الكامل</h3>
          <p className="text-xs text-ink/50">قيمة كل تقييم من وزن فئته، والإجمالي النهائي يُحسب من 100%. تُحفظ الخانة محليًا فورًا ثم تُزامن.</p><span className="grade-matrix-hint">اسحب الجدول أفقيًا عند الحاجة — اسم الطالب ثابت</span>
        </div>
        <div className="flex gap-2"><button className="btn-secondary text-sm" onClick={exportCSV}>تنزيل CSV</button><button className="btn-primary text-sm" onClick={downloadGradebookPDF}>تنزيل PDF رسمي A4</button></div>
      </div>
      <div className="card grade-matrix-card">
        <div className="grade-matrix-scroll" role="region" aria-label="جدول الدرجات القابل للتمرير">
        <table className="grade-matrix-table text-xs border-collapse">
          <thead>
            <tr>
              <th className="grade-matrix-sticky grade-matrix-sticky--header text-right px-3 py-2 border-b-2 border-line min-w-[150px] z-20">الطالب</th>
              {categories.map((category, index) => <th key={category.id} colSpan={itemsFor(category).length + 1} className="text-center px-2 py-2 border-b-2 text-white font-bold" style={{ background: categoryColor(index), borderColor: categoryColor(index) }}>{category.name} <span className="opacity-80 font-normal">({category.weight_percent}%)</span></th>)}
              <th className="text-center px-3 py-2 border-b-2 border-ink min-w-[90px] bg-ink text-white">النهائية %</th>
            </tr>
            <tr>
              <th className="grade-matrix-sticky grade-matrix-sticky--subheader text-right px-3 py-2 text-[11px] text-ink/50 font-medium z-20">تفاصيل فرعية للفئة</th>
              {categories.map((category, index) => (
                <React.Fragment key={category.id}>
                  {itemsFor(category).map((assessment) => (
                    <th key={assessment.id} className="px-2 py-1.5 border-b border-line font-normal min-w-[85px]" style={{ background: `${categoryColor(index)}14` }}>
                      <div className="flex flex-col items-center justify-center gap-1">
                        {Number(assessment.is_summary) ? (
                          <>
                            <span className="font-medium">درجة الفئة <span className="text-ink/40">({getAssessmentMaxScore(category, assessment)})</span></span>
                            <span className="text-[10px] text-primary">{coverageLabel(coverageFor(category, assessment))}</span>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <input className="input text-[11px] py-0.5 px-1 text-center w-24" defaultValue={assessment.title} aria-label={`عنوان التقييم الفرعي ${assessment.title}`} onBlur={(event) => { const title = event.target.value.trim(); if (title && title !== assessment.title) updateAssessment(assessment, { title }); }} />
                              <button className="text-danger text-base leading-none font-bold print:hidden" title="حذف التقييم الفرعي" aria-label={`حذف ${assessment.title}`} onClick={() => deleteAssessment(assessment)}>×</button>
                            </div>
                            <div className="text-[10px] text-ink/50">تقييم فرعي ({assessment.max_score})</div>
                            <div className="text-[10px] text-primary">{coverageLabel(coverageFor(category, assessment))}</div>
                            <input className="input text-[11px] py-0.5 px-1 text-center w-14" type="number" min="0.01" step="any" defaultValue={assessment.max_score} aria-label={`وزن التقييم الفرعي ${assessment.title}`} onBlur={(event) => { const max_score = Number(event.target.value); if (max_score > 0 && max_score !== Number(assessment.max_score)) updateAssessment(assessment, { max_score }); }} />
                          </>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-1.5 border-b border-line print:hidden" style={{ background: `${categoryColor(index)}14` }}>
                    {Number(category.assessments?.some((assessment) => !Number(assessment.is_summary))) > 0 && (() => { const status = detailStatusFor(category); return <div className={`text-[10px] rounded px-1 py-0.5 mb-1 ${status.tone}`}>مجموع {detailTotalFor(category)} / {category.weight_percent} · {status.label}</div>; })()}
                    {newAssessment === category.id ? (
                      <form onSubmit={addAssessment} className="flex flex-col gap-1 p-1 min-w-[130px]">
                        <input className="input text-xs py-0.5" placeholder="اسم التقييم" required autoFocus value={assessmentForm.title} onChange={(event) => setAssessmentForm({ ...assessmentForm, title: event.target.value })} />
                        <input className="input text-xs py-0.5" type="number" min="0.01" step="any" required placeholder="وزن التقييم" value={assessmentForm.max_score} onChange={(event) => setAssessmentForm({ ...assessmentForm, max_score: event.target.value })} />
                        <div className="flex gap-1"><button className="btn-primary text-xs px-2 py-0.5" type="submit">إضافة</button><button className="btn-secondary text-xs px-2 py-0.5" type="button" onClick={() => setNewAssessment(null)}>إلغاء</button></div>
                      </form>
                    ) : (() => {
                      const remaining = Number(category.weight_percent || 0) - detailTotalFor(category);
                      const remainingLabel = remaining >= 0 ? `بقية ${remaining.toFixed(2).replace(/\.00$/, '')}` : `متجاوز ${Math.abs(remaining).toFixed(2).replace(/\.00$/, '')}`;
                      return <button className="btn-secondary text-xs px-2 py-1 leading-tight" style={{ color: categoryColor(index) }} title="إضافة تقييم فرعي لهذه الفئة" onClick={() => startAdding(category)}>تقييم فرعي ({remainingLabel}) +</button>;
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
                            <button className="text-[10px] text-ink/40 print:hidden" onClick={() => setOpenComment(openComment === key ? null : key)}>{cell.comment ? '📝 ملاحظة' : '+ ملاحظة'}</button>
                            {openComment === key && <div className="w-40"><CommentPicker value={cell.comment} onChange={(value) => setCell(assessment.id, student.id, 'comment', value)} category="grade" /><button className="text-[10px] text-primary mt-0.5" onClick={() => { saveCell(assessment.id, student.id); setOpenComment(null); }}>حفظ</button></div>}
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
