const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const RESOURCE_TYPES = new Set(['link', 'file', 'test', 'activity', 'game']);
const LANGUAGES = new Set(['ar', 'en']);
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_URL_LENGTH = 2048;
const MAX_FILE_NAME_LENGTH = 180;

function text(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeUrl(value) {
  const raw = text(value, MAX_URL_LENGTH);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function teacherLocale(teacherId) {
  return db.prepare('SELECT locale FROM teachers WHERE id = ?').get(teacherId)?.locale === 'en' ? 'en' : 'ar';
}

function publicPost(row) {
  return {
    id: row.id,
    client_post_id: row.client_post_id || null,
    author_name: row.author_name || '',
    language: row.language === 'en' ? 'en' : 'ar',
    resource_type: row.resource_type,
    title: row.title,
    description: row.description || '',
    resource_url: row.resource_url,
    file_name: row.file_name || '',
    mime_type: row.mime_type || '',
    file_size: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    created_at: row.created_at,
    updated_at: row.updated_at,
    teacher_id: row.teacher_id,
  };
}

function emitSpaceUpdate(req, action, post) {
  const io = req.app.get('io');
  if (io) io.to('teacher-space').emit('teacher_space_updated', { action, post: publicPost(post) });
}

router.get('/', (req, res) => {
  const search = text(req.query.search, 80);
  const requestedType = text(req.query.type, 20);
  const language = text(req.query.language, 2);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 50);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const conditions = ["p.status = 'published'"];
  const params = [];
  if (RESOURCE_TYPES.has(requestedType)) {
    conditions.push('p.resource_type = ?');
    params.push(requestedType);
  }
  if (LANGUAGES.has(language)) {
    conditions.push('p.language = ?');
    params.push(language);
  }
  if (search) {
    conditions.push('(p.title LIKE ? OR p.description LIKE ? OR p.file_name LIKE ?)');
    const pattern = `%${search.replace(/[%_]/g, '\\$&')}%`;
    params.push(pattern, pattern, pattern);
  }
  const rows = db.prepare(`
    SELECT p.*, t.full_name AS author_name
    FROM teacher_space_posts p
    JOIN teachers t ON t.id = p.teacher_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY datetime(p.created_at) DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ posts: rows.map(publicPost), limit, offset });
});

router.post('/', (req, res) => {
  const resourceType = text(req.body?.resource_type, 20) || 'link';
  const title = text(req.body?.title, MAX_TITLE_LENGTH);
  const description = text(req.body?.description, MAX_DESCRIPTION_LENGTH);
  const resourceUrl = safeUrl(req.body?.resource_url);
  const fileName = text(req.body?.file_name, MAX_FILE_NAME_LENGTH);
  const mimeType = text(req.body?.mime_type, 120);
  const fileSize = Number.isFinite(Number(req.body?.file_size)) && Number(req.body.file_size) >= 0 ? Math.floor(Number(req.body.file_size)) : null;
  const clientPostId = text(req.body?.client_post_id, 80) || null;
  const language = LANGUAGES.has(req.body?.language) ? req.body.language : teacherLocale(req.teacherId);
  if (!RESOURCE_TYPES.has(resourceType)) return res.status(400).json({ error: 'نوع المشاركة غير صالح', code: 'INVALID_RESOURCE_TYPE' });
  if (title.length < 3) return res.status(400).json({ error: 'اكتب عنوانًا واضحًا للمشاركة', code: 'INVALID_TITLE' });
  if (!resourceUrl) return res.status(400).json({ error: 'أضف رابطًا صالحًا يبدأ بـ http أو https', code: 'INVALID_RESOURCE_URL' });

  if (clientPostId) {
    const previous = db.prepare(`
      SELECT p.*, t.full_name AS author_name
      FROM teacher_space_posts p JOIN teachers t ON t.id = p.teacher_id
      WHERE p.teacher_id = ? AND p.client_post_id = ?
    `).get(req.teacherId, clientPostId);
    if (previous) return res.json({ post: publicPost(previous), reused: true });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO teacher_space_posts
      (id, teacher_id, client_post_id, resource_type, language, title, description, resource_url, file_name, mime_type, file_size, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', datetime('now'), datetime('now'))
  `).run(id, req.teacherId, clientPostId, resourceType, language, title, description || null, resourceUrl, fileName || null, mimeType || null, fileSize);
  const post = db.prepare(`SELECT p.*, t.full_name AS author_name FROM teacher_space_posts p JOIN teachers t ON t.id = p.teacher_id WHERE p.id = ?`).get(id);
  emitSpaceUpdate(req, 'created', post);
  res.status(201).json({ post: publicPost(post) });
});

router.delete('/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM teacher_space_posts WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!post) return res.status(404).json({ error: 'المشاركة غير موجودة أو لا تملك صلاحية حذفها', code: 'SPACE_POST_NOT_FOUND' });
  const result = db.prepare('DELETE FROM teacher_space_posts WHERE id = ? AND teacher_id = ?').run(req.params.id, req.teacherId);
  if (!result.changes) return res.status(404).json({ error: 'المشاركة غير موجودة', code: 'SPACE_POST_NOT_FOUND' });
  emitSpaceUpdate(req, 'deleted', { ...post, author_name: '' });
  res.json({ success: true, id: req.params.id });
});

module.exports = router;
