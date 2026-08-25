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
const MAX_COMMENT_LENGTH = 500;

function normalizeSubject(value) {
  return String(value || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '').trim().toLocaleLowerCase('en-US').replace(/^ال/u, '').replace(/\s+/g, ' ');
}

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

function teacherProfile(teacherId) {
  return db.prepare('SELECT locale, subject FROM teachers WHERE id = ?').get(teacherId) || { locale: 'ar', subject: '' };
}

function publicComment(row, viewerTeacherId) {
  return {
    id: row.id,
    client_comment_id: row.client_comment_id || null,
    teacher_id: row.teacher_id,
    author_name: row.author_name || '',
    body: row.body || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    can_delete: row.teacher_id === viewerTeacherId,
    pending: Boolean(row.pending),
  };
}

function publicPost(row) {
  return {
    id: row.id,
    client_post_id: row.client_post_id || null,
    author_name: row.author_name || '',
    language: row.language === 'en' ? 'en' : 'ar',
    subject: row.subject || '',
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
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    liked_by_me: row.liked_by_me === null || row.liked_by_me === undefined ? false : Boolean(Number(row.liked_by_me)),
  };
}

function visiblePost(postId, viewerTeacherId) {
  const viewerSubjectKey = normalizeSubject(teacherProfile(viewerTeacherId).subject);
  if (!viewerSubjectKey) return null;
  return db.prepare(`
    SELECT p.*, t.full_name AS author_name,
      (SELECT COUNT(*) FROM teacher_space_post_likes l WHERE l.post_id = p.id) AS like_count,
      EXISTS (SELECT 1 FROM teacher_space_post_likes l WHERE l.post_id = p.id AND l.teacher_id = ?) AS liked_by_me,
      (SELECT COUNT(*) FROM teacher_space_comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count
    FROM teacher_space_posts p
    JOIN teachers t ON t.id = p.teacher_id
    WHERE p.id = ? AND p.subject_key = ? AND p.status = 'published'
  `).get(viewerTeacherId, postId, viewerSubjectKey);
}

function emitSpaceUpdate(req, action, post, extra = {}) {
  const io = req.app.get('io');
  if (io) io.to('teacher-space').emit('teacher_space_updated', { action, post: publicPost(post), ...extra });
}

router.get('/', (req, res) => {
  const search = text(req.query.search, 80);
  const requestedType = text(req.query.type, 20);
  const language = text(req.query.language, 2);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 50);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const conditions = ["p.status = 'published'"];
  const params = [];
  const viewerSubjectKey = normalizeSubject(teacherProfile(req.teacherId).subject);
  if (!viewerSubjectKey) return res.json({ posts: [], limit, offset, subject_required: true });
  conditions.push('p.subject_key = ?');
  params.push(viewerSubjectKey);
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
    SELECT p.*, t.full_name AS author_name,
      (SELECT COUNT(*) FROM teacher_space_post_likes l WHERE l.post_id = p.id) AS like_count,
      EXISTS (SELECT 1 FROM teacher_space_post_likes l WHERE l.post_id = p.id AND l.teacher_id = ?) AS liked_by_me,
      (SELECT COUNT(*) FROM teacher_space_comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count
    FROM teacher_space_posts p
    JOIN teachers t ON t.id = p.teacher_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY like_count DESC, datetime(p.created_at) DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(req.teacherId, ...params, limit, offset);
  res.json({ posts: rows.map(publicPost), limit, offset, sort: 'likes' });
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
  const profile = teacherProfile(req.teacherId);
  const subject = text(profile.subject, 160);
  const subjectKey = normalizeSubject(subject);
  const language = LANGUAGES.has(req.body?.language) ? req.body.language : profile.locale === 'en' ? 'en' : 'ar';
  if (!RESOURCE_TYPES.has(resourceType)) return res.status(400).json({ error: 'نوع المشاركة غير صالح', code: 'INVALID_RESOURCE_TYPE' });
  if (title.length < 3) return res.status(400).json({ error: 'اكتب عنوانًا واضحًا للمشاركة', code: 'INVALID_TITLE' });
  if (!subjectKey) return res.status(400).json({ error: 'أكمل مادة المعلم من الإعدادات قبل المشاركة', code: 'TEACHER_SUBJECT_REQUIRED' });
  if (!resourceUrl) return res.status(400).json({ error: 'أضف رابطًا صالحًا يبدأ بـ http أو https', code: 'INVALID_RESOURCE_URL' });

  if (clientPostId) {
    const previous = db.prepare(`
      SELECT p.*, t.full_name AS author_name,
        (SELECT COUNT(*) FROM teacher_space_post_likes l WHERE l.post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM teacher_space_comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count
      FROM teacher_space_posts p JOIN teachers t ON t.id = p.teacher_id
      WHERE p.teacher_id = ? AND p.client_post_id = ?
    `).get(req.teacherId, clientPostId);
    if (previous) return res.json({ post: publicPost(previous), reused: true });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO teacher_space_posts
      (id, teacher_id, client_post_id, subject, subject_key, resource_type, language, title, description, resource_url, file_name, mime_type, file_size, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', datetime('now'), datetime('now'))
  `).run(id, req.teacherId, clientPostId, subject, subjectKey, resourceType, language, title, description || null, resourceUrl, fileName || null, mimeType || null, fileSize);
  const post = visiblePost(id, req.teacherId);
  emitSpaceUpdate(req, 'created', post);
  res.status(201).json({ post: publicPost(post) });
});

router.put('/:id/like', (req, res) => {
  const post = visiblePost(req.params.id, req.teacherId);
  if (!post) return res.status(404).json({ error: 'المورد غير موجود ضمن مادة معلمك', code: 'SPACE_POST_NOT_FOUND' });
  db.prepare('INSERT OR IGNORE INTO teacher_space_post_likes (post_id, teacher_id, created_at) VALUES (?, ?, datetime(\'now\'))').run(req.params.id, req.teacherId);
  const updated = visiblePost(req.params.id, req.teacherId);
  emitSpaceUpdate(req, 'liked', updated);
  res.json({ like_count: Number(updated.like_count || 0), liked_by_me: true });
});

router.delete('/:id/like', (req, res) => {
  const post = visiblePost(req.params.id, req.teacherId);
  if (!post) return res.status(404).json({ error: 'المورد غير موجود ضمن مادة معلمك', code: 'SPACE_POST_NOT_FOUND' });
  db.prepare('DELETE FROM teacher_space_post_likes WHERE post_id = ? AND teacher_id = ?').run(req.params.id, req.teacherId);
  const updated = visiblePost(req.params.id, req.teacherId);
  emitSpaceUpdate(req, 'unliked', updated);
  res.json({ like_count: Number(updated.like_count || 0), liked_by_me: false });
});

router.get('/:id/comments', (req, res) => {
  const post = visiblePost(req.params.id, req.teacherId);
  if (!post) return res.status(404).json({ error: 'المورد غير موجود ضمن مادة معلمك', code: 'SPACE_POST_NOT_FOUND' });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const rows = db.prepare(`
    SELECT c.*, t.full_name AS author_name
    FROM teacher_space_comments c JOIN teachers t ON t.id = c.teacher_id
    WHERE c.post_id = ? AND c.status = 'published'
    ORDER BY datetime(c.created_at) ASC, c.id ASC
    LIMIT ?
  `).all(req.params.id, limit);
  res.json({ comments: rows.map((row) => publicComment(row, req.teacherId)), count: Number(post.comment_count || 0) });
});

router.post('/:id/comments', (req, res) => {
  const post = visiblePost(req.params.id, req.teacherId);
  if (!post) return res.status(404).json({ error: 'المورد غير موجود ضمن مادة معلمك', code: 'SPACE_POST_NOT_FOUND' });
  const body = text(req.body?.body, MAX_COMMENT_LENGTH);
  const clientCommentId = text(req.body?.client_comment_id, 80) || null;
  if (!body) return res.status(400).json({ error: 'اكتب تعليقًا قبل النشر', code: 'INVALID_COMMENT' });
  if (clientCommentId) {
    const previous = db.prepare('SELECT c.*, t.full_name AS author_name FROM teacher_space_comments c JOIN teachers t ON t.id = c.teacher_id WHERE c.teacher_id = ? AND c.client_comment_id = ?').get(req.teacherId, clientCommentId);
    if (previous) return res.json({ comment: publicComment(previous, req.teacherId), post: publicPost(post), reused: true });
  }
  const id = uuid();
  db.prepare(`INSERT INTO teacher_space_comments (id, post_id, teacher_id, client_comment_id, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'published', datetime('now'), datetime('now'))`).run(id, req.params.id, req.teacherId, clientCommentId, body);
  const comment = db.prepare('SELECT c.*, t.full_name AS author_name FROM teacher_space_comments c JOIN teachers t ON t.id = c.teacher_id WHERE c.id = ?').get(id);
  const updated = visiblePost(req.params.id, req.teacherId);
  emitSpaceUpdate(req, 'commented', updated, { comment: publicComment(comment, null) });
  res.status(201).json({ comment: publicComment(comment, req.teacherId), post: publicPost(updated) });
});

router.delete('/:id/comments/:commentId', (req, res) => {
  const post = visiblePost(req.params.id, req.teacherId);
  if (!post) return res.status(404).json({ error: 'المورد غير موجود ضمن مادة معلمك', code: 'SPACE_POST_NOT_FOUND' });
  const comment = db.prepare('SELECT * FROM teacher_space_comments WHERE id = ? AND post_id = ? AND teacher_id = ?').get(req.params.commentId, req.params.id, req.teacherId);
  if (!comment) return res.status(404).json({ error: 'التعليق غير موجود أو لا تملك صلاحية حذفه', code: 'SPACE_COMMENT_NOT_FOUND' });
  db.prepare('DELETE FROM teacher_space_comments WHERE id = ? AND teacher_id = ?').run(req.params.commentId, req.teacherId);
  const updated = visiblePost(req.params.id, req.teacherId);
  emitSpaceUpdate(req, 'comment_deleted', updated, { comment_id: req.params.commentId });
  res.json({ success: true, post: publicPost(updated) });
});

router.delete('/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM teacher_space_posts WHERE id = ? AND teacher_id = ?').get(req.params.id, req.teacherId);
  if (!post) return res.status(404).json({ error: 'المشاركة غير موجودة أو لا تملك صلاحية حذفها', code: 'SPACE_POST_NOT_FOUND' });
  db.prepare('DELETE FROM teacher_space_comments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM teacher_space_post_likes WHERE post_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM teacher_space_posts WHERE id = ? AND teacher_id = ?').run(req.params.id, req.teacherId);
  if (!result.changes) return res.status(404).json({ error: 'المشاركة غير موجودة', code: 'SPACE_POST_NOT_FOUND' });
  emitSpaceUpdate(req, 'deleted', { ...post, author_name: '', like_count: 0, comment_count: 0 });
  res.json({ success: true, id: req.params.id });
});

module.exports = router;
