-- Signage v87 — emergency override, schedule metadata, device diagnostics

ALTER TABLE signage_devices ADD COLUMN emergency_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN emergency_audio_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN emergency_until TEXT;
ALTER TABLE signage_devices ADD COLUMN saved_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN saved_audio_playlist_id INTEGER;
ALTER TABLE signage_devices ADD COLUMN command_version INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS signage_emergency_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER,
  target_type TEXT,
  target_ids_json TEXT DEFAULT '[]',
  started_by INTEGER,
  started_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  cancelled_at TEXT,
  status TEXT DEFAULT 'active'
);
