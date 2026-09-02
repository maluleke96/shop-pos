-- Kiosk + Drive-Thru modules v88

ALTER TABLE biz_module_settings ADD COLUMN kiosk_enabled INTEGER DEFAULT 1;
ALTER TABLE biz_module_settings ADD COLUMN drive_thru_enabled INTEGER DEFAULT 1;

-- ─── KIOSK ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kiosk_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  idle_timeout_sec INTEGER DEFAULT 120,
  payment_methods_json TEXT DEFAULT '["cash","card"]',
  system_pos_user_id INTEGER,
  welcome_message TEXT DEFAULT 'Welcome — tap to order',
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO kiosk_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS kiosk_centre_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'kiosk_operator',
  is_active INTEGER DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES kiosk_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kiosk_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT,
  branch_id INTEGER,
  status TEXT DEFAULT 'offline',
  token_hash TEXT,
  is_active INTEGER DEFAULT 1,
  is_revoked INTEGER DEFAULT 0,
  pairing_meta TEXT,
  idle_timeout_sec INTEGER,
  payment_methods_json TEXT,
  last_heartbeat TEXT,
  last_order_at TEXT,
  error_state TEXT,
  settings_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kiosk_device_pairings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pairing_code TEXT NOT NULL,
  device_meta TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  device_id INTEGER REFERENCES kiosk_devices(id),
  approved_by INTEGER,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kiosk_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES kiosk_devices(id),
  sale_id INTEGER,
  order_number TEXT,
  status TEXT DEFAULT 'placed',
  total REAL DEFAULT 0,
  payment_method TEXT,
  items_json TEXT DEFAULT '[]',
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS kiosk_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  device_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kiosk_devices_status ON kiosk_devices(status);
CREATE INDEX IF NOT EXISTS idx_kiosk_orders_device ON kiosk_orders(device_id, created_at);

-- ─── DRIVE-THRU ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drive_thru_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  system_pos_user_id INTEGER,
  default_station_prefix TEXT DEFAULT 'DT',
  ptt_mode TEXT DEFAULT 'push_to_talk',
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO drive_thru_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS drive_thru_centre_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'drive_thru_operator',
  pos_user_id INTEGER,
  is_active INTEGER DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drive_thru_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES drive_thru_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drive_thru_stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  lane_label TEXT,
  branch_id INTEGER,
  status TEXT DEFAULT 'offline',
  token_hash TEXT,
  is_active INTEGER DEFAULT 1,
  mic_device_id TEXT,
  speaker_device_id TEXT,
  mic_volume REAL DEFAULT 1.0,
  speaker_volume REAL DEFAULT 1.0,
  ptt_mode TEXT DEFAULT 'push_to_talk',
  audio_status_json TEXT DEFAULT '{}',
  active_order_id INTEGER,
  staff_user_id INTEGER,
  staff_name TEXT,
  last_heartbeat TEXT,
  error_state TEXT,
  settings_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drive_thru_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES drive_thru_stations(id),
  sale_id INTEGER,
  order_number TEXT,
  status TEXT DEFAULT 'arrived',
  staff_user_id INTEGER,
  staff_name TEXT,
  items_json TEXT DEFAULT '[]',
  subtotal REAL DEFAULT 0,
  total REAL DEFAULT 0,
  payment_method TEXT,
  payment_status TEXT DEFAULT 'pending',
  notes TEXT,
  arrived_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  confirmed_at TEXT,
  paid_at TEXT,
  ready_at TEXT,
  collected_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drive_thru_audio_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES drive_thru_stations(id),
  signal_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  from_role TEXT,
  consumed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drive_thru_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  station_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dt_orders_station ON drive_thru_orders(station_id, status);
CREATE INDEX IF NOT EXISTS idx_dt_audio_signals ON drive_thru_audio_signals(station_id, consumed);
