CREATE TABLE IF NOT EXISTS ops_display_devices (
  id SERIAL PRIMARY KEY,
  device_code TEXT UNIQUE,
  device_type TEXT NOT NULL,
  name TEXT NOT NULL,
  branch_id INTEGER,
  token_hash TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  is_revoked BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'offline',
  app_version TEXT,
  latency_ms INTEGER,
  config_json TEXT,
  pairing_meta TEXT,
  last_heartbeat TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops_display_pairings (
  id SERIAL PRIMARY KEY,
  pairing_code TEXT NOT NULL,
  device_type TEXT NOT NULL,
  device_meta TEXT,
  status TEXT DEFAULT 'pending',
  device_id INTEGER REFERENCES ops_display_devices(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops_display_token_cache (
  device_id INTEGER PRIMARY KEY REFERENCES ops_display_devices(id),
  token_plain TEXT NOT NULL
);
