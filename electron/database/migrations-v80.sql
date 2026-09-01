-- v80 Business Manager mobile app — users, devices, sessions, notifications, POS heartbeats

CREATE TABLE IF NOT EXISTS mobile_app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linked_user_id INTEGER,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'branch_manager',
  permissions_json TEXT DEFAULT '{}',
  all_branches INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobile_branch_access (
  user_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS mobile_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_uid TEXT NOT NULL,
  device_name TEXT,
  platform TEXT DEFAULT 'android',
  push_token TEXT,
  status TEXT DEFAULT 'active',
  last_active_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, device_uid)
);

CREATE TABLE IF NOT EXISTS mobile_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id INTEGER,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobile_notification_prefs (
  user_id INTEGER PRIMARY KEY,
  prefs_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobile_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  branch_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload_json TEXT DEFAULT '{}',
  read_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mobile_notifications_user ON mobile_notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mobile_devices_user ON mobile_devices(user_id, status);

CREATE TABLE IF NOT EXISTS pos_heartbeats (
  branch_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_label TEXT,
  last_seen_at TEXT NOT NULL,
  status TEXT DEFAULT 'online',
  PRIMARY KEY (branch_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_heartbeats_seen ON pos_heartbeats(last_seen_at);
