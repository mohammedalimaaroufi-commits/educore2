import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import CommentPicker from './CommentPicker.jsx';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, syncSnapshot } from '../utils/snapshotSync.js';
import { buildGradeMap, calculateFinalGrade, getAssessmentMaxScore, getCategoryAssessments, getClassData } from '../utils/analyticsSelectors.js';
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
  const [assessmentForm, setAssessmentForm] = useState({ title: '', max_score: 1, date: '' });
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
    setAssessmentForm({ title: '', max_score: Number(category.weight_percent || 1), date: '' });
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
    const existingDetails = (category.assessments || []).filter((assessment) => !Number(assessment.is_summary));
    const detailTotal = existingDetails.reduce((sum, assessment) => sum + Number(assessment.max_score || 0), 0);
    if (detailTotal + maxScore > Number(category.weight_percent || 0) + 0.0001) {
      alert(`لا يمكن تجاوز وزن الفئة (${category.weight_percent}). المتبقي: ${Math.max(0, Number(category.weight_percent || 0) - detailTotal)}`);
      return;
    }

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
    setAssessmentForm({ title: '', max_score: 1, date: '' });
    setNewAssessment(null);
    try {
      await api.post('/grades/assessments', payload);
      void syncSnapshot(teacherId, { force: true });
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/grades/assessments', data: payload });
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
          <p className="text-xs text-ink/50">قيمة كل تقييم من وزن فئته، والإجمالي النهائي يُحسب من 100%. تُحفظ الخانة محليًا فورًا ثم تُزامن.</p>
        </div>
        <div className="flex gap-2"><button className="btn-secondary text-sm" onClick={exportCSV}>تنزيل CSV</button><button className="btn-primary text-sm" onClick={() => window.print()}>تنزيل PDF (طباعة)</button></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky right-0 bg-white text-right px-3 py-2 border-b-2 border-line min-w-[150px] z-10">الطالب</th>
              {categories.map((category, index) => <th key={category.id} colSpan={itemsFor(category).length + 1} className="text-center px-2 py-2 border-b-2 text-white font-bold" style={{ background: categoryColor(index), borderColor: categoryColor(index) }}>{category.name} <span className="opacity-80 font-normal">({category.weight_percent}%)</span></th>)}
              <th className="text-center px-3 py-2 border-b-2 border-ink min-w-[90px] bg-ink text-white">النهائية %</th>
            </tr>
            <tr>
              <th className="sticky right-0 bg-surface"></th>
              {categories.map((category, index) => (
                <React.Fragment key={category.id}>
                  {itemsFor(category).map((assessment) => (
                    <th key={assessment.id} className="px-2 py-1.5 border-b border-line font-normal min-w-[85px]" style={{ background: `${categoryColor(index)}14` }}>
                      <div className="flex items-center justify-center gap-1">
                        <span>{assessment.title} <span className="text-ink/40">/{getAssessmentMaxScore(category, assessment)}</span></span>
                        {!Number(assessment.is_summary) && <button className="text-danger print:hidden" title="حذف التقييم" onClick={() => deleteAssessment(assessment)}>×</button>}
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-1.5 border-b border-line print:hidden" style={{ background: `${categoryColor(index)}14` }}>
                    {newAssessment === category.id ? (
                      <form onSubmit={addAssessment} className="flex flex-col gap-1 p-1">
                        <input className="input text-xs py-0.5" placeholder="عنوان" required autoFocus value={assessmentForm.title} onChange={(event) => setAssessmentForm({ ...assessmentForm, title: event.target.value })} />
                        <input className="input text-xs py-0.5" type="number" min="0.01" max={category.weight_percent} placeholder={`من ${category.weight_percent}`} value={assessmentForm.max_score} onChange={(event) => setAssessmentForm({ ...assessmentForm, max_score: Number(event.target.value) })} />
                        <div className="flex gap-1"><button className="btn-primary text-xs px-2 py-0.5" type="submit">إضافة</button><button className="btn-secondary text-xs px-2 py-0.5" type="button" onClick={() => setNewAssessment(null)}>إلغاء</button></div>
                      </form>
                    ) : <button className="font-medium hover:underline" style={{ color: categoryColor(index) }} onClick={() => startAdding(category)}>+ تقييم</button>}
                  </th>
                </React.Fragment>
              ))}
              <th className="bg-surface"></th>
            </tr>
          </thead>
          <tbody>
            {students.map((student, rowIndex) => (
              <tr key={student.id} className={`border-t border-line ${rowIndex % 2 === 1 ? 'bg-surface/40' : ''}`}>
                <td className="sticky right-0 bg-inherit px-3 py-2 font-medium">{student.full_name}</td>
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
  );
}
