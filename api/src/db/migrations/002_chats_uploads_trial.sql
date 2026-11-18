-- v2: chats vanish unless saved, readers can upload books, visitors get a 3-question trial.
--
-- Questions and answers are no longer logged. The old `questions` table stored every
-- answer; now content is stored only when a reader saves a chat. Usage is still
-- measured, without content, in ask_events.

DROP TABLE IF EXISTS questions;

-- Saved chats only. An unsaved chat lives in the browser and is gone when the tab closes.
CREATE TABLE chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX idx_chats_user_updated ON chats (user_id, updated_at);

CREATE TABLE chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT    NOT NULL,
  response    TEXT,                                  -- JSON: the full answer (citations etc.) for assistant messages
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_chat_messages_chat ON chat_messages (chat_id, id);

-- A reader's own uploaded books. The PDF is deleted once its text is indexed;
-- the passages live in the worker's uploads vector store, tagged with user_id.
CREATE TABLE user_books (
  id          TEXT    PRIMARY KEY,                   -- "up_" + 12 hex characters
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  author      TEXT,
  year        INTEGER,
  filename    TEXT,
  size_bytes  INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  error       TEXT,                                  -- shown to the reader when status = 'failed'
  pages       INTEGER,
  chunks      INTEGER,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX idx_user_books_user ON user_books (user_id);

-- Anonymous visitors on the landing page. The browser holds a random token in an
-- httpOnly cookie; only its hash is stored. IPs are stored as salted hashes.
CREATE TABLE trial_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT    NOT NULL UNIQUE,
  ip_hash       TEXT    NOT NULL,
  questions     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  last_used_at  TEXT    NOT NULL
);
CREATE INDEX idx_trial_sessions_ip ON trial_sessions (ip_hash, last_used_at);

-- One row per question asked, with no question or answer text: usage, cost and quality stats.
CREATE TABLE ask_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  channel             TEXT    NOT NULL CHECK (channel IN ('app', 'trial')),
  status              TEXT    NOT NULL CHECK (status IN ('answered', 'partial', 'insufficient', 'error')),
  error_code          TEXT,
  citations           INTEGER NOT NULL DEFAULT 0,
  books_cited         INTEGER NOT NULL DEFAULT 0,
  passages_retrieved  INTEGER,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  model               TEXT,
  cached              INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0, 1)),
  saved               INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  latency_ms          INTEGER NOT NULL,
  created_at          TEXT    NOT NULL
);
CREATE INDEX idx_ask_events_created ON ask_events (created_at);
CREATE INDEX idx_ask_events_user ON ask_events (user_id, created_at);
