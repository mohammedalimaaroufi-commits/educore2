const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage() });

function assertClassOwnership(classId, teacherId) {
  return db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(classId, teacherId);
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
  db.prepare(`INSERT INTO students (id, class_id, full_name, student_number, guardian_name, guardian_phone, guardian_email, health_notes, private_notes, photo_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, class_id, full_name, student_number || null, guardian_name || null, guardian_phone || null, guardian_email || null, health_notes || null, private_notes || null, photo_url || null);

  res.status(201).json({ student: db.prepare('SELECT * FROM students WHERE id = ?').get(id) });
});

// POST /api/students/import  (CSV file, field name "file", plus class_id in body)
// Expected CSV columns: full_name, student_number, guardian_name, guardian_phone, guardian_email
router.post('/import', upload.single('file'), (req, res) => {
  const { class_id } = req.body;
  if (!assertClassOwnership(class_id, req.teacherId)) return res.status(404).json({ error: 'الصف غير موجود' });
  if (!req.file) return res.status(400).json({ error: 'الرجاء إرفاق ملف CSV' });

  let records;
  try {
    records = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: 'تعذر قراءة الملف، تأكد من اتباع القالب المحدد' });
  }

  const insert = db.prepare(`INSERT INTO students (id, class_id, full_name, student_number, guardian_name, guardian_phone, guardian_email)
                              VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertMany = db.transaction((rows) => {
    let count = 0;
    for (const row of rows) {
      const full_name = row.full_name || row['الاسم الكامل'] || row.name;
      if (!full_name) continue;
      insert.run(uuid(), class_id, full_name, row.student_number || row['رقم القيد'] || null,
        row.guardian_name || row['ولي الأمر'] || null, row.guardian_phone || row['رقم الهاتف'] || null, row.guardian_email || null);
      count += 1;
    }
    return count;
  });

  const imported = insertMany(records);
  res.json({ imported, students: db.prepare('SELECT * FROM students WHERE class_id = ? ORDER BY created_at DESC LIMIT ?').all(class_id, imported) });
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
