-- Ops ecosystem: Kitchen Display + Customer Order Display device registry
CREATE TABLE IF NOT EXISTS ops_display_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT UNIQUE,
  device_type TEXT NOT NULL,
  name TEXT NOT NULL,
  branch_id INTEGER,
  token_hash TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  is_revoked INTEGER DEFAULT 0,
  status TEXT DEFAULT 'offline',
  app_version TEXT,
  latency_ms INTEGER,
  config_json TEXT,
  pairing_meta TEXT,
  last_heartbeat TEXT,
  last_sync_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ops_display_pairings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pairing_code TEXT NOT NULL,
  device_type TEXT NOT NULL,
  device_meta TEXT,
  status TEXT DEFAULT 'pending',
  device_id INTEGER REFERENCES ops_display_devices(id),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ops_display_devices_type ON ops_display_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_ops_display_pairings_code ON ops_display_pairings(pairing_code);
