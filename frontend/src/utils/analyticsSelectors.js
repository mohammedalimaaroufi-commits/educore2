function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

const snapshotIndexCache = new WeakMap();

function visibleSubjectKeys(snapshot, classId) {
  const classData = (snapshot?.classes || []).find((item) => item.id === classId);
  if (!classData?.school_id) return null;
  const teacherId = snapshot?.teacher?.id;
  const keys = (snapshot?.school_class_assignments || [])
    .filter((item) => item.class_id === classId && item.teacher_id === teacherId && item.status === 'active')
    .map((item) => item.subject_key)
    .filter(Boolean);
  return new Set(keys);
}

function isVisibleSubject(snapshot, classId, subjectKey) {
  const keys = visibleSubjectKeys(snapshot, classId);
  return keys === null || (keys.size > 0 && (!subjectKey || keys.has(subjectKey)));
}

export function buildSnapshotIndexes(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      classesById: new Map(),
      studentsById: new Map(),
      studentsByClass: new Map(),
      categoriesByClass: new Map(),
      assessmentsByCategory: new Map(),
      gradeMap: new Map(),
      gradesByStudent: new Map(),
      behaviorTypes: new Map(),
      schoolSubjectsByClass: new Map(),
      schoolAssignmentsByClass: new Map(),
      behaviorLogsByStudent: new Map(),
      sessionsById: new Map(),
      attendanceByStudent: new Map(),
      attendanceBySession: new Map(),
      classDataById: new Map(),
    };
  }
  const cached = snapshotIndexCache.get(snapshot);
  if (cached) return cached;
  const classesById = new Map((snapshot.classes || []).map((item) => [item.id, item]));
  const studentClassById = new Map((snapshot.students || []).map((item) => [item.id, item.class_id]));
  const index = {
    classesById,
    studentsById: new Map(),
    studentsByClass: new Map(),
    categoriesByClass: new Map(),
    assessmentsByCategory: new Map(),
    gradeMap: new Map(),
    gradesByStudent: new Map(),
    behaviorTypes: new Map((snapshot.behavior_types || []).filter((item) => isVisibleSubject(snapshot, item.class_id, item.subject_key)).map((item) => [item.id, item])),
    schoolSubjectsByClass: new Map(),
    schoolAssignmentsByClass: new Map(),
    behaviorLogsByStudent: new Map(),
    sessionsById: new Map([
      ...(snapshot.attendance_sessions || []),
      ...(snapshot.school_attendance_sessions || []).filter((item) => isVisibleSubject(snapshot, item.class_id, item.subject_key)),
    ].map((item) => [item.id, item])),
    attendanceByStudent: new Map(),
    attendanceBySession: new Map(),
    classDataById: new Map(),
  };
  (snapshot.school_class_subjects || []).forEach((subject) => {
    if (!isVisibleSubject(snapshot, subject.class_id, subject.subject_key)) return;
    const rows = index.schoolSubjectsByClass.get(subject.class_id) || [];
    rows.push(subject);
    index.schoolSubjectsByClass.set(subject.class_id, rows);
  });
  (snapshot.school_class_assignments || []).forEach((assignment) => {
    if (!isVisibleSubject(snapshot, assignment.class_id, assignment.subject_key)) return;
    const rows = index.schoolAssignmentsByClass.get(assignment.class_id) || [];
    rows.push(assignment);
    index.schoolAssignmentsByClass.set(assignment.class_id, rows);
  });
  (snapshot.students || []).forEach((student) => {
    index.studentsById.set(student.id, student);
    const rows = index.studentsByClass.get(student.class_id) || [];
    rows.push(student);
    index.studentsByClass.set(student.class_id, rows);
  });
  (snapshot.grade_categories || []).forEach((category) => {
    if (!isVisibleSubject(snapshot, category.class_id, category.subject_key)) return;
    const rows = index.categoriesByClass.get(category.class_id) || [];
    rows.push(category);
    index.categoriesByClass.set(category.class_id, rows);
  });
  (snapshot.assessments || []).forEach((assessment) => {
    const rows = index.assessmentsByCategory.get(assessment.category_id) || [];
    rows.push(assessment);
    index.assessmentsByCategory.set(assessment.category_id, rows);
  });
  (snapshot.grades || []).forEach((grade) => {
    index.gradeMap.set(`${grade.assessment_id}:${grade.student_id}`, grade);
    const rows = index.gradesByStudent.get(grade.student_id) || [];
    rows.push(grade);
    index.gradesByStudent.set(grade.student_id, rows);
  });
  (snapshot.behavior_logs || []).forEach((log) => {
    const classId = studentClassById.get(log.student_id);
    if (!isVisibleSubject(snapshot, classId, log.subject_key)) return;
    const rows = index.behaviorLogsByStudent.get(log.student_id) || [];
    rows.push(log);
    index.behaviorLogsByStudent.set(log.student_id, rows);
  });
  [...(snapshot.attendance_records || []), ...(snapshot.school_attendance_records || [])].forEach((record) => {
    if (!index.sessionsById.has(record.session_id)) return;
    const studentRows = index.attendanceByStudent.get(record.student_id) || [];
    studentRows.push(record);
    index.attendanceByStudent.set(record.student_id, studentRows);
    const sessionRows = index.attendanceBySession.get(record.session_id) || [];
    sessionRows.push(record);
    index.attendanceBySession.set(record.session_id, sessionRows);
  });
  snapshotIndexCache.set(snapshot, index);
  return index;
}

export function getClassData(snapshot, classId, indexes = buildSnapshotIndexes(snapshot)) {
  const cached = indexes.classDataById.get(classId);
  if (cached) return cached;
  const classData = indexes.classesById.get(classId) || null;
  const students = (indexes.studentsByClass.get(classId) || []).filter((item) => !item.archived);
  const categories = [...(indexes.categoriesByClass.get(classId) || [])]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((category) => ({
      ...category,
      assessments: [...(indexes.assessmentsByCategory.get(category.id) || [])]
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || ''))),
    }));
  const result = { classData, students, categories };
  indexes.classDataById.set(classId, result);
  return result;
}

export function buildGradeMap(snapshot) {
  return buildSnapshotIndexes(snapshot).gradeMap;
}

export function getCategoryAssessments(category) {
  const assessments = category?.assessments || [];
  const detailed = assessments.filter((assessment) => !Number(assessment.is_summary));
  const summaries = assessments.filter((assessment) => Number(assessment.is_summary));
  // A direct category always exposes its one category-level assessment. Detailed
  // rows are used only after the category has real detail entries.
  if (category?.grading_mode !== 'detailed' && summaries.length) return summaries;
  return detailed.length ? detailed : summaries.length ? summaries : assessments;
}

export function getAssessmentMaxScore(category, assessment) {
  const weight = Number(category?.weight_percent || 0);
  const onlyCategoryAssessment = (category?.assessments || []).length <= 1;
  const isDetailedCategory = category?.grading_mode === 'detailed';
  if (weight > 0 && (Number(assessment?.is_summary) === 1 || (onlyCategoryAssessment && !isDetailedCategory))) {
    return weight;
  }
  return Number(assessment?.max_score || 0);
}

function hasGradeValue(grade) {
  return Boolean(grade && (
    (grade.score_numeric !== null && grade.score_numeric !== undefined && grade.score_numeric !== '')
    || (grade.score_letter !== null && grade.score_letter !== undefined && grade.score_letter !== '')
  ));
}

export function calculateAssessmentCoverage(category, assessment, students, gradeMap) {
  const roster = students || [];
  const enteredCount = roster.reduce((count, student) => (
    count + (hasGradeValue(gradeMap.get(`${assessment.id}:${student.id}`)) ? 1 : 0)
  ), 0);
  const totalStudents = roster.length;
  return {
    assessment_id: assessment.id,
    category_id: category.id,
    category_name: category.name,
    title: Number(assessment.is_summary) ? category.name : assessment.title,
    max_score: getAssessmentMaxScore(category, assessment),
    entered_count: enteredCount,
    total_students: totalStudents,
    percent: totalStudents ? round((enteredCount / totalStudents) * 100) : null,
    is_summary: Number(assessment.is_summary) === 1,
  };
}

export function buildAssessmentCoverage(snapshot, classId) {
  const indexes = buildSnapshotIndexes(snapshot);
  const { students, categories } = getClassData(snapshot, classId, indexes);
  const gradeMap = indexes.gradeMap;
  return categories.flatMap((category) => (
    getCategoryAssessments(category).map((assessment) => calculateAssessmentCoverage(category, assessment, students, gradeMap))
  ));
}

export function calculateCategoryPercent(studentId, category, gradeMap) {
  const assessments = getCategoryAssessments(category);
  const detailed = assessments.filter((assessment) => !Number(assessment.is_summary));
  const enteredDetails = detailed.filter((assessment) => {
    const grade = gradeMap.get(`${assessment.id}:${studentId}`);
    return hasGradeValue(grade);
  });
  // Adding a detail must never blank an already-entered category score. Use the
  // summary value until this student has at least one real detail score; the
  // summary row remains stored and can be replaced naturally by detail scores.
  const rows = enteredDetails.length > 0
    ? detailed
    : (() => {
        const summary = (category?.assessments || []).find((assessment) => Number(assessment.is_summary));
        return summary && hasGradeValue(gradeMap.get(`${summary.id}:${studentId}`)) ? [summary] : detailed;
      })();
  let earned = 0;
  let possible = 0;
  rows.forEach((assessment) => {
    const grade = gradeMap.get(`${assessment.id}:${studentId}`);
    if (hasGradeValue(grade)) {
      earned += Number(grade.score_numeric);
      possible += getAssessmentMaxScore(category, assessment);
    }
  });
  return possible > 0 ? round((earned / possible) * 100) : null;
}

export function calculateCategoryPoints(studentId, category, gradeMap) {
  const percent = calculateCategoryPercent(studentId, category, gradeMap);
  return percent === null ? null : round((percent * Number(category.weight_percent || 0)) / 100);
}

export function calculateFinalGrade(studentId, categories, gradeMap) {
  let weightedTotal = 0;
  let weightUsed = 0;
  categories.forEach((category) => {
    const percent = calculateCategoryPercent(studentId, category, gradeMap);
    if (percent !== null) {
      const weight = Number(category.weight_percent || 0);
      weightedTotal += percent * (weight / 100);
      weightUsed += weight;
    }
  });
  return weightUsed > 0 ? round((weightedTotal / weightUsed) * 100) : null;
}

export function calculateBehaviorScore(studentId, snapshot, indexes = buildSnapshotIndexes(snapshot)) {
  const typeMap = indexes.behaviorTypes;
  return (indexes.behaviorLogsByStudent.get(studentId) || [])
    .reduce((sum, log) => {
      const behavior = typeMap.get(log.behavior_type_id);
      const points = Math.abs(Number(behavior?.points || 0));
      return sum + (behavior?.polarity === 'negative' ? -points : points);
    }, 0);
}

export function calculateAttendanceRate(studentId, snapshot, indexes = buildSnapshotIndexes(snapshot)) {
  const records = indexes.attendanceByStudent.get(studentId) || [];
  if (!records.length) return null;
  const present = records.filter((record) => record.status === 'present').length;
  return round((present / records.length) * 100, 1);
}

export function buildClassRoster(snapshot, classId, indexes = buildSnapshotIndexes(snapshot)) {
  const { students, categories } = getClassData(snapshot, classId, indexes);
  const gradeMap = indexes.gradeMap;
  return students.map((student) => {
    const attendanceRecords = indexes.attendanceByStudent.get(student.id) || [];
    return {
      student_id: student.id,
      full_name: student.full_name,
      finalGrade: calculateFinalGrade(student.id, categories, gradeMap),
      behaviorScore: calculateBehaviorScore(student.id, snapshot, indexes),
      attendanceRate: calculateAttendanceRate(student.id, snapshot, indexes),
      absentCount: attendanceRecords.filter((record) => record.status === 'absent').length,
      lateCount: attendanceRecords.filter((record) => record.status === 'late').length,
      attendanceRecords,
    };
  });
}

export const DEFAULT_FOLLOW_UP_SETTINGS = {
  enabled: { behavior: true, grade: true, missingGrade: true, absence: true, late: true },
  thresholds: { behaviorScore: -4, finalGrade: 60, absentDays: 3, lateDays: 3 },
};

export function normalizeFollowUpSettings(input = {}) {
  const source = input || {};
  const enabled = { ...DEFAULT_FOLLOW_UP_SETTINGS.enabled, ...(source.enabled || {}) };
  const thresholds = { ...DEFAULT_FOLLOW_UP_SETTINGS.thresholds, ...(source.thresholds || {}) };
  return {
    enabled,
    thresholds: Object.fromEntries(Object.entries(thresholds).map(([key, value]) => [key, Number.isFinite(Number(value)) ? Number(value) : DEFAULT_FOLLOW_UP_SETTINGS.thresholds[key]])),
  };
}

function formatFollowUpValue(value, suffix = '') {
  return `${value}${suffix}`;
}

export function buildFollowUpRows(snapshot, classId, settings = DEFAULT_FOLLOW_UP_SETTINGS, translate = null) {
  const normalized = normalizeFollowUpSettings(settings);
  const t = typeof translate === 'function' ? translate : (_key, fallback) => fallback;
  const indexes = buildSnapshotIndexes(snapshot);
  const { students } = getClassData(snapshot, classId, indexes);
  const roster = buildClassRoster(snapshot, classId, indexes);
  const rosterByStudent = new Map(roster.map((row) => [row.student_id, row]));
  return students.map((student) => {
    const base = rosterByStudent.get(student.id);
    const report = buildStudentReport(snapshot, student.id, indexes);
    if (!base || !report) return null;
    const reasons = [];
    const negativeLogs = report.behaviorLogs.filter((log) => log.polarity === 'negative');
    const gradeDetails = report.gradesByCategory.map((category) => ({
      category: category.category,
      percent: category.categoryPercent,
      weight: category.weight_percent,
      items: category.items.map((item) => ({ title: item.title, score: item.score, max: item.max_score, comment: item.comment })),
    }));
    const behaviorDetails = negativeLogs.slice(0, 8).map((log) => ({ label: log.label || t('analyticsNegativeBehavior', 'Negative behavior'), points: Math.abs(Number(log.points || 0)), note: log.note_text || '', occurred_at: log.occurred_at }));
    const attendanceDetails = report.attendance.slice().sort((a, b) => String(b.session_date || '').localeCompare(String(a.session_date || ''))).map((record) => ({ status: record.status, session_date: record.session_date, period_label: record.period_label, starts_at: record.starts_at }));

    if (normalized.enabled.behavior && base.behaviorScore <= normalized.thresholds.behaviorScore) {
      reasons.push({ key: 'behavior', label: t('analyticsNegativeBehavior', 'Negative behavior'), value: formatFollowUpValue(base.behaviorScore, ` ${t('analyticsPoints', 'points')}`), details: behaviorDetails });
    }
    if (normalized.enabled.grade && base.finalGrade !== null && base.finalGrade < normalized.thresholds.finalGrade) {
      reasons.push({ key: 'grade', label: t('analyticsOverallGrade', 'Overall grade'), value: formatFollowUpValue(base.finalGrade, '%'), details: gradeDetails });
    }
    if (normalized.enabled.missingGrade && base.finalGrade === null) {
      reasons.push({ key: 'missing-grade', label: t('analyticsMissingFinalGrade', 'No final grade'), value: t('analyticsIncomplete', 'Incomplete'), details: gradeDetails });
    }
    if (normalized.enabled.absence && base.absentCount >= normalized.thresholds.absentDays) {
      reasons.push({ key: 'absence', label: t('analyticsAbsence', 'Absence'), value: formatFollowUpValue(base.absentCount, ` ${t('analyticsDay', 'day')}`), details: attendanceDetails.filter((item) => item.status === 'absent').slice(0, 8) });
    }
    if (normalized.enabled.late && base.lateCount >= normalized.thresholds.lateDays) {
      reasons.push({ key: 'late', label: t('analyticsLate', 'Late records'), value: formatFollowUpValue(base.lateCount, ` ${t('analyticsDay', 'day')}`), details: attendanceDetails.filter((item) => item.status === 'late').slice(0, 8) });
    }
    return {
      ...base,
      student,
      reasons,
      gradeDetails,
      behaviorDetails,
      attendanceDetails,
      needsFollowUp: reasons.length > 0,
    };
  }).filter(Boolean).filter((row) => row.needsFollowUp);
}


export function buildDistribution(roster) {
  const buckets = { '0-59': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90-100': 0 };
  roster.forEach((student) => {
    if (student.finalGrade === null) return;
    if (student.finalGrade < 60) buckets['0-59'] += 1;
    else if (student.finalGrade < 70) buckets['60-69'] += 1;
    else if (student.finalGrade < 80) buckets['70-79'] += 1;
    else if (student.finalGrade < 90) buckets['80-89'] += 1;
    else buckets['90-100'] += 1;
  });
  return buckets;
}

export function buildCategoryAverages(snapshot, classId) {
  const indexes = buildSnapshotIndexes(snapshot);
  const { students, categories } = getClassData(snapshot, classId, indexes);
  const gradeMap = indexes.gradeMap;
  return categories.map((category) => {
    const rows = [];
    getCategoryAssessments(category).forEach((assessment) => {
      students.forEach((student) => {
        const grade = gradeMap.get(`${assessment.id}:${student.id}`);
        if (grade && grade.score_numeric !== null && grade.score_numeric !== undefined) {
          rows.push((Number(grade.score_numeric) / Math.max(1, getAssessmentMaxScore(category, assessment))) * 100);
        }
      });
    });
    return {
      category: category.name,
      weight_percent: category.weight_percent,
      averagePercent: rows.length ? round(rows.reduce((sum, value) => sum + value, 0) / rows.length, 1) : null,
      enteredCount: rows.length,
      studentCount: students.length,
    };
  });
}

export function buildGrowth(snapshot, studentId) {
  const indexes = buildSnapshotIndexes(snapshot);
  const student = indexes.studentsById.get(studentId);
  const classId = student?.class_id;
  const assessmentMap = new Map((snapshot?.assessments || []).map((assessment) => [assessment.id, assessment]));
  const categoryMap = new Map((snapshot?.grade_categories || []).map((category) => [category.id, category]));
  return (indexes.gradesByStudent.get(studentId) || [])
    .filter((grade) => grade.score_numeric !== null && assessmentMap.has(grade.assessment_id))
    .filter((grade) => isVisibleSubject(snapshot, classId, categoryMap.get(assessmentMap.get(grade.assessment_id)?.category_id)?.subject_key))
    .map((grade) => {
      const assessment = assessmentMap.get(grade.assessment_id);
      return {
        title: assessment.title,
        date: assessment.date,
        category: categoryMap.get(assessment.category_id)?.name,
        percent: round((Number(grade.score_numeric) / Math.max(1, getAssessmentMaxScore(categoryMap.get(assessment.category_id), assessment))) * 100),
        is_summary: Number(assessment.is_summary) === 1,
      };
    })
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .map((item, index) => ({ ...item, index: index + 1 }));
}

export function buildStudentReport(snapshot, studentId, indexes = buildSnapshotIndexes(snapshot)) {
  const student = indexes.studentsById.get(studentId);
  if (!student) return null;
  const { classData, categories } = getClassData(snapshot, student.class_id, indexes);
  const gradeMap = indexes.gradeMap;
  const gradesByCategory = categories.map((category) => {
    const items = getCategoryAssessments(category).map((assessment) => {
      const grade = gradeMap.get(`${assessment.id}:${student.id}`);
      return { title: assessment.title, max_score: getAssessmentMaxScore(category, assessment), score: grade?.score_numeric ?? null, comment: grade?.comment ?? null, is_summary: Number(assessment.is_summary) === 1 };
    });
    return {
      category: category.name,
      weight_percent: category.weight_percent,
      grading_mode: category.grading_mode || (items.some((item) => !item.is_summary) ? 'detailed' : 'direct'),
      categoryPercent: calculateCategoryPercent(student.id, category, gradeMap),
      weightedPoints: calculateCategoryPoints(student.id, category, gradeMap),
      items,
    };
  });
  const behaviorTypeMap = indexes.behaviorTypes;
  const behaviorLogs = (indexes.behaviorLogsByStudent.get(student.id) || []).map((log) => ({ ...log, ...(behaviorTypeMap.get(log.behavior_type_id) || {}) }));
  const attendance = (indexes.attendanceByStudent.get(student.id) || []).map((record) => {
    const session = indexes.sessionsById.get(record.session_id) || {};
    return { ...record, session_date: session.session_date, subject_key: session.subject_key, period_key: session.period_key, period_label: session.period_label, starts_at: session.starts_at };
  });
  const finalGrade = calculateFinalGrade(student.id, categories, gradeMap);
  const rules = (snapshot.grade_recommendation_rules || []).filter((rule) => finalGrade !== null && finalGrade >= rule.min_score && finalGrade <= rule.max_score);
  return { student, class: classData, gradesByCategory, behaviorLogs, behaviorScore: calculateBehaviorScore(student.id, snapshot, indexes), attendance, attendanceTotals: attendance.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}), finalGrade, autoRecommendation: rules[0]?.text || null, generated_at: new Date().toISOString() };
}
