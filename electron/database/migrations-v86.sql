-- Digital Signage & Shop Media Centre v86

ALTER TABLE biz_module_settings ADD COLUMN signage_enabled INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS signage_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_slide_duration INTEGER DEFAULT 8,
  default_transition TEXT DEFAULT 'fade',
  default_volume INTEGER DEFAULT 80,
  ducking_volume INTEGER DEFAULT 25,
  duck_fade_ms INTEGER DEFAULT 800,
  heartbeat_interval_sec INTEGER DEFAULT 30,
  offline_stale_minutes INTEGER DEFAULT 3,
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO signage_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS signage_centre_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','media_manager','content_editor','screen_operator')),
  is_active INTEGER DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES signage_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_screen_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  music_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT UNIQUE,
  name TEXT NOT NULL,
  location TEXT,
  group_id INTEGER REFERENCES signage_screen_groups(id),
  status TEXT DEFAULT 'offline' CHECK (status IN ('online','offline','updating','error','revoked')),
  token_hash TEXT,
  pairing_meta TEXT DEFAULT '{}',
  orientation TEXT DEFAULT 'landscape',
  resolution TEXT,
  player_version TEXT,
  current_playlist_id INTEGER,
  current_playlist_name TEXT,
  current_audio_playlist_id INTEGER,
  current_music_track TEXT,
  music_volume INTEGER DEFAULT 80,
  last_heartbeat TEXT,
  last_online TEXT,
  last_sync TEXT,
  error_state TEXT,
  storage_json TEXT DEFAULT '{}',
  network_json TEXT DEFAULT '{}',
  is_revoked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_device_pairings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pairing_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  device_meta TEXT DEFAULT '{}',
  device_id INTEGER REFERENCES signage_devices(id),
  expires_at TEXT NOT NULL,
  approved_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image','video','audio','menu')),
  category TEXT DEFAULT 'general',
  title TEXT NOT NULL,
  file_path TEXT,
  thumbnail_path TEXT,
  mime_type TEXT,
  file_size INTEGER DEFAULT 0,
  duration_seconds REAL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  metadata_json TEXT DEFAULT '{}',
  version INTEGER DEFAULT 1,
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_key TEXT DEFAULT 'classic',
  title_text TEXT,
  logo_media_id INTEGER,
  background_media_id INTEGER,
  settings_json TEXT DEFAULT '{}',
  version INTEGER DEFAULT 1,
  sync_from_pos INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL REFERENCES signage_menus(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  price REAL DEFAULT 0,
  category TEXT,
  image_media_id INTEGER,
  is_promotion INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  loop_enabled INTEGER DEFAULT 1,
  shuffle INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES signage_playlists(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('media','menu')),
  media_id INTEGER,
  menu_id INTEGER,
  duration_seconds INTEGER DEFAULT 8,
  transition TEXT DEFAULT 'fade',
  sort_order INTEGER DEFAULT 0,
  use_video_audio INTEGER DEFAULT 0,
  video_volume INTEGER DEFAULT 100
);

CREATE TABLE IF NOT EXISTS signage_audio_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  shuffle INTEGER DEFAULT 0,
  repeat_mode TEXT DEFAULT 'all',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_audio_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audio_playlist_id INTEGER NOT NULL REFERENCES signage_audio_playlists(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES signage_media(id),
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS signage_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  text_content TEXT,
  audio_media_id INTEGER,
  volume INTEGER DEFAULT 100,
  speed REAL DEFAULT 1.0,
  schedule_type TEXT DEFAULT 'once',
  schedule_json TEXT DEFAULT '{}',
  target_type TEXT DEFAULT 'all',
  target_ids_json TEXT DEFAULT '[]',
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent','emergency')),
  is_active INTEGER DEFAULT 1,
  last_played_at TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('device','group','all')),
  target_id INTEGER,
  playlist_id INTEGER,
  audio_playlist_id INTEGER,
  priority TEXT DEFAULT 'normal',
  day_of_week TEXT,
  start_time TEXT,
  end_time TEXT,
  start_date TEXT,
  end_date TEXT,
  is_recurring INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  playlist_id INTEGER,
  audio_playlist_id INTEGER,
  target_type TEXT NOT NULL,
  target_ids_json TEXT DEFAULT '[]',
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','publishing','completed','partial','failed')),
  created_by INTEGER,
  created_by_name TEXT,
  published_at TEXT,
  result_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_publication_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL REFERENCES signage_publications(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES signage_devices(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','downloading','ready','playing','failed','offline')),
  error_message TEXT,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_device_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES signage_devices(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  payload_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','acked','failed')),
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  acked_at TEXT
);

CREATE TABLE IF NOT EXISTS signage_device_heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES signage_devices(id) ON DELETE CASCADE,
  status TEXT,
  payload_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signage_audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_signage_devices_status ON signage_devices(status);
CREATE INDEX IF NOT EXISTS idx_signage_devices_group ON signage_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_signage_pairing_code ON signage_device_pairings(pairing_code);
CREATE INDEX IF NOT EXISTS idx_signage_media_type ON signage_media(media_type);
CREATE INDEX IF NOT EXISTS idx_signage_pub_devices ON signage_publication_devices(publication_id, device_id);
