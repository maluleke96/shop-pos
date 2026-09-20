-- v116: Menu & Promo Studio app sessions (Windows / Android)
CREATE TABLE IF NOT EXISTS studio_app_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  device_name TEXT,
  platform TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_studio_app_sessions_token ON studio_app_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_studio_app_sessions_user ON studio_app_sessions(user_id);
