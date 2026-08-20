function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

export function getClassData(snapshot, classId) {
  const classData = snapshot?.classes?.find((item) => item.id === classId) || null;
  const students = (snapshot?.students || []).filter((item) => item.class_id === classId && !item.archived);
  const categories = (snapshot?.grade_categories || [])
    .filter((item) => item.class_id === classId)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((category) => ({
      ...category,
      assessments: (snapshot?.assessments || [])
        .filter((assessment) => assessment.category_id === category.id)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || ''))),
    }));
  return { classData, students, categories };
}

export function buildGradeMap(snapshot) {
  return new Map((snapshot?.grades || []).map((grade) => [`${grade.assessment_id}:${grade.student_id}`, grade]));
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
  if (weight > 0 && (Number(assessment?.is_summary) === 1 || onlyCategoryAssessment)) {
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
  const { students, categories } = getClassData(snapshot, classId);
  const gradeMap = buildGradeMap(snapshot);
  return categories.flatMap((category) => (
    getCategoryAssessments(category).map((assessment) => calculateAssessmentCoverage(category, assessment, students, gradeMap))
  ));
}

export function calculateCategoryPercent(studentId, category, gradeMap) {
  const assessments = getCategoryAssessments(category);
  let earned = 0;
  let possible = 0;
  assessments.forEach((assessment) => {
    const grade = gradeMap.get(`${assessment.id}:${studentId}`);
    if (grade && grade.score_numeric !== null && grade.score_numeric !== undefined && grade.score_numeric !== '') {
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

export function calculateBehaviorScore(studentId, snapshot) {
  const pointsByType = new Map((snapshot?.behavior_types || []).map((item) => [item.id, Number(item.points || 0)]));
  return (snapshot?.behavior_logs || [])
    .filter((log) => log.student_id === studentId)
    .reduce((sum, log) => sum + (pointsByType.get(log.behavior_type_id) || 0), 0);
}

export function calculateAttendanceRate(studentId, snapshot) {
  const sessions = new Map((snapshot?.attendance_sessions || []).map((session) => [session.id, session]));
  const records = (snapshot?.attendance_records || []).filter((record) => record.student_id === studentId && sessions.has(record.session_id));
  if (!records.length) return null;
  const present = records.filter((record) => record.status === 'present').length;
  return round((present / records.length) * 100, 1);
}

export function buildClassRoster(snapshot, classId) {
  const { students, categories } = getClassData(snapshot, classId);
  const gradeMap = buildGradeMap(snapshot);
  return students.map((student) => ({
    student_id: student.id,
    full_name: student.full_name,
    finalGrade: calculateFinalGrade(student.id, categories, gradeMap),
    behaviorScore: calculateBehaviorScore(student.id, snapshot),
    attendanceRate: calculateAttendanceRate(student.id, snapshot),
  }));
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
  const { students, categories } = getClassData(snapshot, classId);
  const gradeMap = buildGradeMap(snapshot);
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
  const assessmentMap = new Map((snapshot?.assessments || []).map((assessment) => [assessment.id, assessment]));
  const categoryMap = new Map((snapshot?.grade_categories || []).map((category) => [category.id, category]));
  return (snapshot?.grades || [])
    .filter((grade) => grade.student_id === studentId && grade.score_numeric !== null && assessmentMap.has(grade.assessment_id))
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

export function buildStudentReport(snapshot, studentId) {
  const student = snapshot?.students?.find((item) => item.id === studentId);
  if (!student) return null;
  const { classData, categories } = getClassData(snapshot, student.class_id);
  const gradeMap = buildGradeMap(snapshot);
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
  const behaviorTypeMap = new Map((snapshot.behavior_types || []).map((item) => [item.id, item]));
  const behaviorLogs = (snapshot.behavior_logs || []).filter((log) => log.student_id === student.id).map((log) => ({ ...log, ...(behaviorTypeMap.get(log.behavior_type_id) || {}) }));
  const sessions = new Map((snapshot.attendance_sessions || []).map((session) => [session.id, session]));
  const attendance = (snapshot.attendance_records || []).filter((record) => record.student_id === student.id && sessions.has(record.session_id)).map((record) => ({ ...record, session_date: sessions.get(record.session_id).session_date }));
  const finalGrade = calculateFinalGrade(student.id, categories, gradeMap);
  const rules = (snapshot.grade_recommendation_rules || []).filter((rule) => finalGrade !== null && finalGrade >= rule.min_score && finalGrade <= rule.max_score);
  return { student, class: classData, gradesByCategory, behaviorLogs, behaviorScore: calculateBehaviorScore(student.id, snapshot), attendance, attendanceTotals: attendance.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}), finalGrade, autoRecommendation: rules[0]?.text || null, generated_at: new Date().toISOString() };
}
