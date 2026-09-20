-- Chisanyama Connection Radio — multi-station ready schema
-- Reuses existing users table; no duplicate auth accounts.

CREATE TABLE IF NOT EXISTS radio_stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER,
  name TEXT NOT NULL DEFAULT 'Chisanyama Connection Radio',
  slug TEXT NOT NULL DEFAULT 'main',
  public_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'off_air',
  programme_title TEXT,
  programme_upcoming TEXT,
  now_playing_json TEXT,
  stream_url TEXT,
  call_phone TEXT,
  settings_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_radio_stations_slug ON radio_stations(slug);

CREATE TABLE IF NOT EXISTS radio_app_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  station_id INTEGER,
  token_hash TEXT NOT NULL,
  device_name TEXT,
  platform TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_radio_app_sessions_token ON radio_app_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_radio_app_sessions_user ON radio_app_sessions(user_id);

CREATE TABLE IF NOT EXISTS radio_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  artist TEXT,
  duration_sec REAL,
  source_url TEXT,
  source_kind TEXT NOT NULL DEFAULT 'library',
  tags TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  shuffle INTEGER NOT NULL DEFAULT 0,
  repeat_mode TEXT NOT NULL DEFAULT 'off',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS radio_schedule_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  ref_id INTEGER,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL,
  status TEXT NOT NULL DEFAULT 'queued',
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_radio_schedule_station ON radio_schedule_items(station_id, sort_order);

CREATE TABLE IF NOT EXISTS radio_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  body TEXT,
  voice_kind TEXT NOT NULL DEFAULT 'ai',
  audio_url TEXT,
  duration_sec REAL,
  scheduled_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  is_staff INTEGER NOT NULL DEFAULT 0,
  staff_user_id INTEGER,
  moderated INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_radio_chat_station ON radio_chat_messages(station_id, id);

CREATE TABLE IF NOT EXISTS radio_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  caller_label TEXT,
  caller_phone TEXT,
  status TEXT NOT NULL DEFAULT 'ringing',
  on_air INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_social_destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL DEFAULT 1,
  platform TEXT NOT NULL,
  label TEXT,
  rtmp_url TEXT,
  stream_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS radio_broadcast_state (
  station_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'scheduled',
  go_live INTEGER NOT NULL DEFAULT 0,
  music_volume REAL NOT NULL DEFAULT 0.7,
  mic_active INTEGER NOT NULL DEFAULT 0,
  duck_level REAL NOT NULL DEFAULT 1,
  current_item_id INTEGER,
  play_now_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);
