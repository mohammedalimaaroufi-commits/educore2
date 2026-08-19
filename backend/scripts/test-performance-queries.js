const db = require('../src/db');

const rows = db.prepare(`
  WITH ranked_messages AS (
    SELECT
      m.teacher_id,
      m.text,
      m.created_at,
      ROW_NUMBER() OVER (
        PARTITION BY m.teacher_id
        ORDER BY m.created_at DESC, m.id DESC
      ) AS message_rank,
      SUM(CASE WHEN m.sender = 'teacher' AND m.read_by_admin = 0 THEN 1 ELSE 0 END)
        OVER (PARTITION BY m.teacher_id) AS unread_count
    FROM messages m
  )
  SELECT
    t.id AS teacher_id,
    t.full_name,
    t.email,
    r.text AS last_message,
    r.created_at AS last_message_at,
    r.unread_count
  FROM ranked_messages r
  JOIN teachers t ON t.id = r.teacher_id
  WHERE r.message_rank = 1
  ORDER BY r.created_at DESC
`).all();

console.log(JSON.stringify({ ok: true, conversations: rows.length }));
