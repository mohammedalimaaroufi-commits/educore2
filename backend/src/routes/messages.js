const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/messages  -> this teacher's full conversation with the admin console
router.get('/', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages WHERE teacher_id = ? ORDER BY created_at ASC').all(req.teacherId);
  db.prepare("UPDATE messages SET read_by_teacher = 1 WHERE teacher_id = ? AND sender = 'admin' AND read_by_teacher = 0").run(req.teacherId);
  res.json({ messages });
});

// POST /api/messages  { text }  -> teacher sends a message to the admin
router.post('/', (req, res) => {
  const { text, client_message_id } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'الرسالة لا يمكن أن تكون فارغة' });
  if (client_message_id) {
    const previous = db.prepare('SELECT * FROM messages WHERE teacher_id = ? AND sender = ? AND client_message_id = ?').get(req.teacherId, 'teacher', client_message_id);
    if (previous) return res.json({ message: previous, reused: true });
  }

  const id = uuid();
  db.prepare(`INSERT INTO messages (id, teacher_id, sender, text, read_by_teacher, read_by_admin, client_message_id) VALUES (?, ?, 'teacher', ?, 1, 0, ?)`)
    .run(id, req.teacherId, text.trim(), client_message_id || null);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${req.teacherId}`).emit('new_message', message);
    io.to('admin').emit('new_message', message);
  }

  res.status(201).json({ message });
});

module.exports = router;
