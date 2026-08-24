const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/restrictions');
const { getStudentCount, getActiveStudentLimit } = require('../utils/subscriptions');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('students'));
const upload = multer({ storage: multer.memoryStorage() });

const HEADER_ALIASES = {
  full_name: ['full_name', 'fullname', 'name', 'student name', 'student_name', 'الاسم', 'اسم الطالب', 'إسم الطالب', 'الاسم الكامل', 'اسم الطالب الكامل'],
  student_number: ['student_number', 'student number', 'number', 'رقم القيد', 'رقم الطالب', 'الرقم'],
  guardian_name: ['guardian_name', 'guardian name', 'ولي الأمر', 'ولي الامر', 'اسم ولي الأمر', 'اسم ولي الامر'],
  guardian_phone: ['guardian_phone', 'guardian phone', 'phone', 'mobile', 'رقم الهاتف', 'هاتف ولي الأمر', 'هاتف ولي الامر'],
  guardian_email: ['guardian_email', 'guardian email', 'email', 'البريد الإلكتروني', 'البريد الالكتروني'],
};

function normalizeText(value) {
  return String(value ?? '').replace(/[\u200f\u200e]/g, '').replace(/[ـ]/g, '').trim().toLowerCase().normalize('NFKC');
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
}

function findField(header, aliases) {
  const normalized = normalizeHeader(header);
  return aliases.some((alias) => normalizeHeader(alias) === normalized);
}

function findHeaderRow(rows) {
  for (let index = 0; index < Math.min(rows.length, 80); index += 1) {
    const row = rows[index] || [];
    if (row.some((cell) => findField(cell, HEADER_ALIASES.full_name))) return index;
  }
  return -1;
}

function isStatisticsRow(value) {
  const text = normalizeText(value);
  return text.includes('احصائيات') || text.includes('إحصائيات') || text.includes('statistics') || text.includes('عدد الطلاب الحاصلين') || text.includes('students who');
}

function extractStudentRecords(buffer, filename, selectedSheet) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  const sheets = workbook.SheetNames || [];
  if (!sheets.length) throw new Error('الملف لا يحتوي على أوراق عمل');
  const sheetName = selectedSheet && sheets.includes(selectedSheet) ? selectedSheet : sheets[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) throw new Error('لم أجد عمود اسم الطالب. استخدم اسمًا مثل: اسم الطالب أو full_name');
  const headers = rows[headerIndex] || [];
  const columns = Object.entries(HEADER_ALIASES).reduce((result, [field, aliases]) => {
    const index = headers.findIndex((header) => findField(header, aliases));
    if (index >= 0) result[field] = index;
    return result;
  }, {});
  if (columns.full_name === undefined) throw new Error('عمود اسم الطالب مطلوب');

  const records = [];
  let skipped = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const fullName = String(row[columns.full_name] ?? '').trim();
    if (isStatisticsRow(fullName)) break;
    if (!fullName || /^[-–—]+$/.test(fullName)) {
      skipped += 1;
      continue;
    }
    const record = { row_number: index + 1, full_name: fullName };
    Object.entries(columns).forEach(([field, columnIndex]) => {
      if (field !== 'full_name') record[field] = String(row[columnIndex] ?? '').trim() || null;
    });
    records.push(record);
  }
  return {
    filename,
    sheets,
    selected_sheet: sheetName,
    headers: headers.map((header) => String(header ?? '').trim()).filter(Boolean),
    records,
    skipped,
  };
}

function uniqueStudentRecords(records, classId) {
  const existing = db.prepare('SELECT full_name, student_number FROM students WHERE class_id = ? AND archived = 0').all(classId);
  const seenNames = new Set(existing.map((student) => normalizeText(student.full_name)).filter(Boolean));
  const seenNumbers = new Set(existing.map((student) => normalizeText(student.student_number)).filter(Boolean));
  const unique = [];
  let duplicates = 0;
  for (const record of records) {
    const nameKey = normalizeText(record.full_name);
    const numberKey = normalizeText(record.student_number);
    if (!nameKey || seenNames.has(nameKey) || (numberKey && seenNumbers.has(numberKey))) {
      duplicates += 1;
      continue;
    }
    seenNames.add(nameKey);
    if (numberKey) seenNumbers.add(numberKey);
    unique.push(record);
  }
  return { unique, duplicates };
}

function assertClassOwnership(classId, teacherId) {
  return db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(classId, teacherId);
}

function getStudentCapacity(teacherId) {
  const limit = getActiveStudentLimit(teacherId);
  if (!limit) return null;
  const studentCount = getStudentCount(teacherId);
  return { ...limit, studentCount, remaining: Math.max(0, limit.includedStudents - studentCount) };
}

function studentLimitError(capacity) {
  const error = new Error('تم بلوغ حد الطلاب في الباقة النشطة');
  error.code = 'STUDENT_LIMIT_REACHED';
  error.capacity = capacity;
  return error;
}

function sendStudentLimitError(res, capacity) {
  return res.status(409).json({
    error: 'تم بلوغ حد الطلاب في الباقة النشطة. لا يمكن إضافة طلاب آخرين.',
    code: 'STUDENT_LIMIT_REACHED',
    current_count: capacity?.studentCount ?? 0,
    included_students: capacity?.includedStudents ?? 0,
    remaining: capacity?.remaining ?? 0,
    plan: capacity?.plan || null,
  });
}

// GET /api/students?class_id=...
router.get('/', (req, res) => {
  const { class_id } = req.query;
  if (!class_id || !assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  const students = db.prepare('SELECT * FROM students WHERE class_id = ? AND archived = 0 ORDER BY full_name COLLATE NOCASE').all(class_id);
  res.json({ students });
});

// POST /api/students  (manual add)
router.post('/', (req, res) => {
  const { id: requestedId, class_id, full_name, student_number, guardian_name, guardian_phone, guardian_email, health_notes, private_notes, photo_url } = req.body;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  if (!full_name) return res.status(400).json({ error: 'اسم الطالب مطلوب' });

  const id = requestedId || uuid();
  const existing = db.prepare('SELECT s.* FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ? AND c.teacher_id = ?').get(id, req.teacherId);
  if (existing) return res.json({ student: existing, reused: true });
  const insertStudent = db.transaction(() => {
    const capacity = getStudentCapacity(req.teacherId);
    if (capacity && capacity.remaining <= 0) throw studentLimitError(capacity);
    db.prepare(`INSERT INTO students (id, class_id, full_name, student_number, guardian_name, guardian_phone, guardian_email, health_notes, private_notes, photo_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, class_id, full_name, student_number || null, guardian_name || null, guardian_phone || null, guardian_email || null, health_notes || null, private_notes || null, photo_url || null);
    return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  });
  try {
    const student = insertStudent();
    res.status(201).json({ student });
  } catch (error) {
    if (error?.code === 'STUDENT_LIMIT_REACHED') return sendStudentLimitError(res, error.capacity);
    throw error;
  }
});

// POST /api/students/import  (CSV/XLSX/XLS file, field name "file", plus class_id)
// Supports ordinary header files and school workbooks where the student header is below a title row.
router.post('/import', upload.single('file'), (req, res) => {
  const { class_id, sheet_name: selectedSheet } = req.body;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  if (!req.file) return res.status(400).json({ error: 'الرجاء إرفاق ملف CSV أو Excel' });

  let parsed;
  try {
    parsed = extractStudentRecords(req.file.buffer, req.file.originalname, selectedSheet);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'تعذر قراءة الملف، تأكد من وجود عمود اسم الطالب' });
  }

  const { unique, duplicates } = uniqueStudentRecords(parsed.records, class_id);
  const capacity = getStudentCapacity(req.teacherId);
  const available = capacity ? capacity.remaining : unique.length;
  const importable = unique.slice(0, Math.max(0, available));
  const limitSkipped = capacity ? Math.max(0, unique.length - importable.length) : 0;
  if (String(req.body.preview || '') === '1') {
    return res.json({
      preview: true,
      filename: parsed.filename,
      sheets: parsed.sheets,
      selected_sheet: parsed.selected_sheet,
      headers: parsed.headers,
      rows: importable.slice(0, 12),
      total: parsed.records.length,
      valid: importable.length,
      valid_before_limit: unique.length,
      limit_skipped: limitSkipped,
      included_students: capacity?.includedStudents ?? null,
      current_student_count: capacity?.studentCount ?? null,
      remaining_slots: capacity?.remaining ?? null,
      skipped: parsed.skipped,
      duplicates,
    });
  }

  const insert = db.prepare(`INSERT INTO students (id, class_id, full_name, student_number, guardian_name, guardian_phone, guardian_email)
                              VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const importResult = db.transaction(() => {
    const fresh = uniqueStudentRecords(parsed.records, class_id);
    const currentCapacity = getStudentCapacity(req.teacherId);
    const rows = currentCapacity ? fresh.unique.slice(0, Math.max(0, currentCapacity.remaining)) : fresh.unique;
    const skippedByLimit = currentCapacity ? Math.max(0, fresh.unique.length - rows.length) : 0;
    rows.forEach((row) => insert.run(uuid(), class_id, row.full_name, row.student_number || null, row.guardian_name || null, row.guardian_phone || null, row.guardian_email || null));
    return { imported: rows.length, duplicates: fresh.duplicates, limitSkipped: skippedByLimit };
  })();
  res.json({ imported: importResult.imported, duplicates: importResult.duplicates, limit_skipped: importResult.limitSkipped, skipped: parsed.skipped, sheet: parsed.selected_sheet, students: db.prepare('SELECT * FROM students WHERE class_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT ?').all(class_id, importResult.imported) });
});

// PATCH /api/students/:id
router.patch('/:id', (req, res) => {
  const student = db.prepare('SELECT s.* FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ? AND c.teacher_id = ?').get(req.params.id, req.teacherId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });

  const fields = ['full_name', 'student_number', 'guardian_name', 'guardian_phone', 'guardian_email', 'health_notes', 'private_notes', 'photo_url'];
  const updates = {};
  fields.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  if (setClause) db.prepare(`UPDATE students SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: student.id });

  res.json({ student: db.prepare('SELECT * FROM students WHERE id = ?').get(student.id) });
});

// DELETE /api/students/:id (archive)
router.delete('/:id', (req, res) => {
  const student = db.prepare('SELECT s.* FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ? AND c.teacher_id = ?').get(req.params.id, req.teacherId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });
  db.prepare('UPDATE students SET archived = 1 WHERE id = ?').run(student.id);
  res.json({ success: true });
});

module.exports = router;
