-- EduTechReady: SQLite schema for local development (mirrors db/schema.mysql.sql).
-- public/api/lib.php applies this file automatically when the configured DSN is
-- sqlite: and the submissions table does not exist yet, so db/dev.sqlite needs
-- no manual setup. Manual alternative: sqlite3 db/dev.sqlite < db/schema.sqlite.sql
-- IF NOT EXISTS keeps the file safe to apply more than once.

CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_code TEXT    NOT NULL,
  client_id    TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  UNIQUE (session_code, client_id)
);

CREATE INDEX IF NOT EXISTS idx_created ON submissions (created_at);

CREATE TABLE IF NOT EXISTS placements (
  submission_id INTEGER NOT NULL,
  character_id  TEXT    NOT NULL,
  axis          TEXT    NOT NULL,
  value         INTEGER NOT NULL,
  PRIMARY KEY (submission_id, character_id, axis)
);
