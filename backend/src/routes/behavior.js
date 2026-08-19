const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/behavior/types?class_id=...
router.get('/types', (req, res) => {
  const { class_id } = req.query;
  const owns = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(class_id, req.teacherId);
  if (!owns) return res.status(404).json({ error: 'الصف غير موجود' });
  const types = db.prepare('SELECT * FROM behavior_types WHERE class_id = ? ORDER BY is_default DESC, label').all(class_id);
  res.json({ types });
});

// POST /api/behavior/types  (custom behavior)
router.post('/types', (req, res) => {
  const { id: requestedId, class_id, label, polarity, points, icon } = req.body;
  const owns = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(class_id, req.teacherId);
  if (!owns) return res.status(404).json({ error: 'الصف غير موجود' });
  if (!label) return res.status(400).json({ error: 'اسم السلوك مطلوب' });
  const id = requestedId || uuid();
  const existing = db.prepare('SELECT bt.* FROM behavior_types bt JOIN classes c ON bt.class_id = c.id WHERE bt.id = ? AND c.teacher_id = ?').get(id, req.teacherId);
  if (existing) return res.json({ type: existing, reused: true });
  db.prepare(`INSERT INTO behavior_types (id, class_id, label, polarity, points, icon, is_default)
              VALUES (?, ?, ?, ?, ?, ?, 0)`)
    .run(id, class_id, label, polarity || 'positive', points ?? (polarity === 'negative' ? -1 : 1), icon || 'star');
  res.status(201).json({ type: db.prepare('SELECT * FROM behavior_types WHERE id = ?').get(id) });
});

// POST /api/behavior/log  (one-tap log, optional note text/audio)
router.post('/log', (req, res) => {
  const { id: requestedId, student_id, behavior_type_id, note_text, note_audio_url } = req.body;
  const student = db.prepare('SELECT s.* FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ? AND c.teacher_id = ?').get(student_id, req.teacherId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });
  const id = requestedId || uuid();
  const existing = db.prepare('SELECT bl.* FROM behavior_logs bl JOIN students s ON bl.student_id = s.id JOIN classes c ON s.class_id = c.id WHERE bl.id = ? AND c.teacher_id = ?').get(id, req.teacherId);
  if (existing) return res.json({ log: existing, reused: true });
  db.prepare(`INSERT INTO behavior_logs (id, student_id, behavior_type_id, note_text, note_audio_url) VALUES (?, ?, ?, ?, ?)`)
    .run(id, student_id, behavior_type_id, note_text || null, note_audio_url || null);
  res.status(201).json({ log: db.prepare('SELECT * FROM behavior_logs WHERE id = ?').get(id) });
});

// GET /api/behavior/log?student_id=...  (full history for a student)
router.get('/log', (req, res) => {
  const { student_id } = req.query;
  const student = db.prepare('SELECT s.* FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ? AND c.teacher_id = ?').get(student_id, req.teacherId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });
  const logs = db.prepare(`SELECT bl.*, bt.label, bt.polarity, bt.points, bt.icon FROM behavior_logs bl
                            JOIN behavior_types bt ON bl.behavior_type_id = bt.id
                            WHERE bl.student_id = ? ORDER BY bl.occurred_at DESC`).all(student_id);
  const score = logs.reduce((sum, l) => sum + l.points, 0);
  res.json({ logs, score });
});

// GET /api/behavior/class-summary?class_id=...  (behavior score per student, for charts)
router.get('/class-summary', (req, res) => {
  const { class_id } = req.query;
  const owns = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(class_id, req.teacherId);
  if (!owns) return res.status(404).json({ error: 'الصف غير موجود' });
  const rows = db.prepare(`SELECT s.id as student_id, s.full_name,
                              COALESCE(SUM(bt.points), 0) as behavior_score,
                              SUM(CASE WHEN bt.polarity='positive' THEN 1 ELSE 0 END) as positive_count,
                              SUM(CASE WHEN bt.polarity='negative' THEN 1 ELSE 0 END) as negative_count
                            FROM students s
                            LEFT JOIN behavior_logs bl ON bl.student_id = s.id
                            LEFT JOIN behavior_types bt ON bl.behavior_type_id = bt.id
                            WHERE s.class_id = ? AND s.archived = 0
                            GROUP BY s.id ORDER BY s.full_name COLLATE NOCASE`).all(class_id);
  res.json({ summary: rows });
});

module.exports = router;
