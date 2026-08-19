// EduCore Manager - Database layer (SQLite via better-sqlite3)
// This single file defines the full schema (ERD) and exports a ready connection.
const path = require('path');
const fs = require('fs');
const LocalDatabase = require('better-sqlite3');
const RemoteDatabase = require('libsql');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const isRemote = Boolean(process.env.LIBSQL_URL);
const db = isRemote
  ? new RemoteDatabase(process.env.LIBSQL_URL, {
      authToken: process.env.LIBSQL_AUTH_TOKEN,
    })
  : new LocalDatabase(path.join(DATA_DIR, 'educore.sqlite'));

// `libsql` exposes a better-sqlite3-shaped transaction helper, but its remote
// Hrana implementation can issue a rollback after the remote transaction has
// already ended. That produces `cannot rollback - no transaction is active`
// and makes an otherwise valid request fail. Keep real transactions locally;
// for remote Turso, execute the existing callback sequentially so requests do
// not crash. A later async batch migration can restore atomic batching.
if (isRemote) {
  db.transaction = (callback) => (...args) => callback(...args);
}

if (!isRemote) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000');
  db.pragma('temp_store = MEMORY');
}

// ------------------------------------------------------------------
// SCHEMA (ERD)
// teachers(1) --- (N) subscriptions [current sub referenced on teacher]
// teachers(1) --- (N) classes
// classes(1)  --- (N) students
// classes(1)  --- (N) grade_categories
// grade_categories(1) --- (N) assessments
// assessments(1) --- (N) grades  (grades.student_id)
// classes(1) --- (N) behavior_types (default + custom)
// students(1) --- (N) behavior_logs
// students(1) --- (N) attendance_records
// classes(1) --- (N) attendance_sessions (one per date)
// ------------------------------------------------------------------

db.exec(`
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  auth_provider TEXT DEFAULT 'email', -- email | google | apple
  subject TEXT,
  school_stage TEXT,
  school_name TEXT,
  avatar_url TEXT,
  locale TEXT DEFAULT 'ar', -- ar | en (drives RTL/LTR)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial', -- trial | 6_months | yearly | lifetime
  status TEXT NOT NULL DEFAULT 'active', -- active | expired | canceled
  trial_start_date TEXT,
  trial_end_date TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  payment_provider TEXT, -- stripe | local_gateway
  payment_reference TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  academic_year TEXT,
  color TEXT DEFAULT '#2E7D6B',
  icon TEXT DEFAULT 'book',
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  student_number TEXT,
  photo_url TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  guardian_email TEXT,
  health_notes TEXT,
  private_notes TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grade_categories (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g. quizzes, participation, homework, project, final
  weight_percent REAL NOT NULL DEFAULT 0,
  grading_type TEXT NOT NULL DEFAULT 'numeric', -- numeric | letter | rubric
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES grade_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  max_score REAL NOT NULL DEFAULT 100,
  date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score_numeric REAL,
  score_letter TEXT,
  rubric_json TEXT, -- JSON blob for rubric-based scoring
  comment TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(assessment_id, student_id)
);

CREATE TABLE IF NOT EXISTS behavior_types (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  label TEXT NOT NULL, -- e.g. مشاركة متميزة، تأخر
  polarity TEXT NOT NULL DEFAULT 'positive', -- positive | negative
  points INTEGER NOT NULL DEFAULT 1,
  icon TEXT DEFAULT 'star',
  is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS behavior_logs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  behavior_type_id TEXT NOT NULL REFERENCES behavior_types(id) ON DELETE CASCADE,
  note_text TEXT,
  note_audio_url TEXT,
  occurred_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  UNIQUE(class_id, session_date)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'present', -- present | absent | late | excused
  UNIQUE(session_id, student_id)
);

-- Reusable grade-category templates ("مخطط") a teacher can define once and apply to any class
CREATE TABLE IF NOT EXISTS grading_schemes (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grading_scheme_categories (
  id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0,
  grading_type TEXT NOT NULL DEFAULT 'numeric',
  sort_order INTEGER DEFAULT 0
);

-- Reusable descriptive comment bank ("عبارات وصفية جاهزة") managed from Settings
CREATE TABLE IF NOT EXISTS comment_templates (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  category TEXT DEFAULT 'general', -- general | grade | behavior | attendance
  created_at TEXT DEFAULT (datetime('now'))
);

-- Manual bank-transfer payment requests, reviewed from the private admin console
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  plan TEXT NOT NULL, -- 6_months | yearly | lifetime
  amount_omr REAL NOT NULL,
  reference_note TEXT, -- sender name / transfer reference the teacher provides
  receipt_image TEXT, -- base64 data URI of the transfer receipt screenshot (optional)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);

-- Grade-based auto-recommendation rules ("عبارة تلقائية بالقياس مع الدرجة النهائية")
CREATE TABLE IF NOT EXISTS grade_recommendation_rules (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  min_score REAL NOT NULL,
  max_score REAL NOT NULL,
  text TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Direct messaging between a teacher and the private admin console ("محادثة فورية")
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, -- identifies the conversation
  sender TEXT NOT NULL, -- 'teacher' | 'admin'
  text TEXT NOT NULL,
  read_by_teacher INTEGER DEFAULT 0,
  read_by_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- "نسيت كلمة المرور" — short-lived single-use tokens for self-service password reset
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Reusable teacher-level behavior presets ("تحرير السلوك المخصص" في الإعدادات العامة).
-- Applied automatically to every new class instead of the hardcoded starter list, once the
-- teacher has saved at least one. Distinct from behavior_types, which stay per-class (a class's
-- actual live behavior list can still be edited independently after creation).
CREATE TABLE IF NOT EXISTS behavior_type_templates (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  polarity TEXT NOT NULL DEFAULT 'positive',
  points INTEGER NOT NULL DEFAULT 1,
  icon TEXT DEFAULT 'star',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ------------------------------------------------------------------
// Small additive migrations for columns introduced after the initial release.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so guard each with a PRAGMA table_info check —
// safe to run every startup, and keeps existing local .sqlite files working without wiping data.
// ------------------------------------------------------------------
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
if (!hasColumn('grading_schemes', 'is_default')) {
  db.exec('ALTER TABLE grading_schemes ADD COLUMN is_default INTEGER DEFAULT 0');
}
if (!hasColumn('payment_requests', 'archived')) {
  db.exec('ALTER TABLE payment_requests ADD COLUMN archived INTEGER DEFAULT 0');
}
if (!hasColumn('messages', 'client_message_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN client_message_id TEXT');
}

// ------------------------------------------------------------------
// INDICES — the tables above are queried heavily by foreign key (every list screen
// filters by class_id / student_id / teacher_id). SQLite doesn't index FKs automatically,
// so without these every such query was a full table scan. Matters once a teacher has a
// few classes with real rosters and a term's worth of grades/behavior/attendance.
// ------------------------------------------------------------------
db.exec(`
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id, archived);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id, archived);
CREATE INDEX IF NOT EXISTS idx_grade_categories_class ON grade_categories(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_category ON assessments(category_id);
CREATE INDEX IF NOT EXISTS idx_grades_assessment ON grades(assessment_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id ON messages(teacher_id, sender, client_message_id);
CREATE INDEX IF NOT EXISTS idx_behavior_types_class ON behavior_types(class_id);
CREATE INDEX IF NOT EXISTS idx_behavior_logs_student ON behavior_logs(student_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class ON attendance_sessions(class_id, session_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_grading_scheme_categories_scheme ON grading_scheme_categories(scheme_id);
CREATE INDEX IF NOT EXISTS idx_comment_templates_teacher ON comment_templates(teacher_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_teacher ON payment_requests(teacher_id, status);
CREATE INDEX IF NOT EXISTS idx_grade_recommendation_rules_teacher ON grade_recommendation_rules(teacher_id);
CREATE INDEX IF NOT EXISTS idx_messages_teacher ON messages(teacher_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(teacher_id, sender, read_by_admin, created_at);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_behavior_type_templates_teacher ON behavior_type_templates(teacher_id);
`);

module.exports = db;
