-- Radio functional layer: media files, listeners, schedule clock, SFX, audit, folders

CREATE TABLE IF NOT EXISTS radio_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'music',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_media_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  folder_id INTEGER,
  filename TEXT,
  mime TEXT,
  size_bytes INTEGER,
  duration_sec REAL,
  storage_path TEXT,
  public_token TEXT,
  meta_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_radio_media_station ON radio_media_files(station_id, kind, id);

CREATE TABLE IF NOT EXISTS radio_sfx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  category TEXT,
  media_id INTEGER,
  volume REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_programme_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'music',
  start_time TEXT NOT NULL,
  end_time TEXT,
  days_mask TEXT NOT NULL DEFAULT '1111111',
  playlist_id INTEGER,
  announcement_id INTEGER,
  media_id INTEGER,
  repeat_weekly INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_listeners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  session_key TEXT NOT NULL,
  user_agent TEXT,
  last_seen TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_radio_listeners_sess ON radio_listeners(station_id, session_key);
CREATE INDEX IF NOT EXISTS idx_radio_listeners_seen ON radio_listeners(station_id, last_seen);

CREATE TABLE IF NOT EXISTS radio_listen_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  session_key TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec REAL
);

CREATE TABLE IF NOT EXISTS radio_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_radio_audit_station ON radio_audit(station_id, id);

CREATE TABLE IF NOT EXISTS radio_chat_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  author_key TEXT NOT NULL,
  reason TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Extend tracks with folder / media link when columns missing (safe no-ops if present via app ensure)
-- App ensureSchema will ALTER as needed.
;