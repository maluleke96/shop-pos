-- Communication Centre standalone portal logins

CREATE TABLE IF NOT EXISTS comm_portal_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'marketing' CHECK (role IN ('admin','marketing','viewer')),
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_by_name TEXT,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_portal_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal_user_id INTEGER REFERENCES comm_portal_users(id),
  shop_user_id INTEGER,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comm_portal_sessions_hash ON comm_portal_sessions(token_hash);
