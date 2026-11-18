-- LorelAI schema v1 (SQLite).
-- Kept to portable SQL so it translates directly to MySQL; the type mapping is in
-- docs/backend-report.md. Timestamps are UTC ISO-8601 text written by the API.

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,            -- stored lowercased
  password_hash  TEXT    NOT NULL,                   -- scrypt$N$r$p$salt$hash
  display_name   TEXT,
  role           TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  token_version  INTEGER NOT NULL DEFAULT 0,         -- bump to invalidate every access token for the user
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  last_login_at  TEXT
);

-- Refresh tokens are stored hashed (SHA-256). Each sign-in starts a family; every
-- refresh rotates to a new token in the same family. Presenting a revoked token
-- again means it was copied, so the whole family is revoked.
CREATE TABLE refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  family_id   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  user_agent  TEXT,
  ip          TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);

-- Every question asked through POST /api/ask, with the answer and citations returned.
CREATE TABLE questions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question            TEXT    NOT NULL,
  book_filter         TEXT,                          -- JSON array of book_ids, NULL = all books
  status              TEXT    NOT NULL CHECK (status IN ('answered', 'partial', 'insufficient', 'error')),
  error_code          TEXT,
  answer              TEXT    NOT NULL,
  citations           TEXT    NOT NULL,              -- JSON array
  statements          TEXT    NOT NULL,              -- JSON array
  conflicts           TEXT    NOT NULL,              -- JSON array
  not_covered         TEXT    NOT NULL,              -- JSON array
  passages_retrieved  INTEGER,
  books_retrieved     TEXT,                          -- JSON array
  latency_ms          INTEGER NOT NULL,
  created_at          TEXT    NOT NULL
);
CREATE INDEX idx_questions_user_created ON questions (user_id, created_at);
CREATE INDEX idx_questions_created ON questions (created_at);
CREATE INDEX idx_questions_status ON questions (status);

-- Admin actions (role changes, disabling, deleting, pipeline restarts).
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,
  target_type  TEXT,
  target_id    INTEGER,
  details      TEXT,                                 -- JSON object
  created_at   TEXT    NOT NULL
);
CREATE INDEX idx_audit_log_created ON audit_log (created_at);
