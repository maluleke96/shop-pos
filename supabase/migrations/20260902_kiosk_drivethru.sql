-- Kiosk + Drive-Thru v88 (Postgres mirror)
ALTER TABLE biz_module_settings ADD COLUMN IF NOT EXISTS kiosk_enabled INTEGER DEFAULT 1;
ALTER TABLE biz_module_settings ADD COLUMN IF NOT EXISTS drive_thru_enabled INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS kiosk_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  idle_timeout_sec INTEGER DEFAULT 120,
  payment_methods_json TEXT DEFAULT '["cash","card"]',
  system_pos_user_id INTEGER,
  welcome_message TEXT DEFAULT 'Welcome — tap to order',
  settings_json TEXT DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO kiosk_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS kiosk_centre_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'kiosk_operator',
  is_active INTEGER DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES kiosk_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kiosk_devices (
  id SERIAL PRIMARY KEY,
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
  last_heartbeat TIMESTAMPTZ,
  last_order_at TIMESTAMPTZ,
  error_state TEXT,
  settings_json TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kiosk_device_pairings (
  id SERIAL PRIMARY KEY,
  pairing_code TEXT NOT NULL,
  device_meta TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  device_id INTEGER REFERENCES kiosk_devices(id),
  approved_by INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kiosk_orders (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES kiosk_devices(id),
  sale_id INTEGER,
  order_number TEXT,
  status TEXT DEFAULT 'placed',
  total REAL DEFAULT 0,
  payment_method TEXT,
  items_json TEXT DEFAULT '[]',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kiosk_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  device_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drive_thru_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  system_pos_user_id INTEGER,
  default_station_prefix TEXT DEFAULT 'DT',
  ptt_mode TEXT DEFAULT 'push_to_talk',
  settings_json TEXT DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO drive_thru_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS drive_thru_centre_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'drive_thru_operator',
  pos_user_id INTEGER,
  is_active INTEGER DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drive_thru_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES drive_thru_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drive_thru_stations (
  id SERIAL PRIMARY KEY,
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
  last_heartbeat TIMESTAMPTZ,
  error_state TEXT,
  settings_json TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drive_thru_orders (
  id SERIAL PRIMARY KEY,
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
  arrived_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drive_thru_audio_signals (
  id SERIAL PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES drive_thru_stations(id),
  signal_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  from_role TEXT,
  consumed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drive_thru_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  station_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
