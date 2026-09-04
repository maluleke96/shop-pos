-- Signage v87 — emergency override, device command version, emergency log (Postgres mirror)

ALTER TABLE signage_devices ADD COLUMN IF NOT EXISTS emergency_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN IF NOT EXISTS emergency_audio_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN IF NOT EXISTS emergency_until TIMESTAMPTZ;
ALTER TABLE signage_devices ADD COLUMN IF NOT EXISTS saved_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN IF NOT EXISTS saved_audio_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN IF NOT EXISTS command_version INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS signage_emergency_log (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER,
  target_type TEXT,
  target_ids_json TEXT DEFAULT '[]',
  started_by INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active'
);
