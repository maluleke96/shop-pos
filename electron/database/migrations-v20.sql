-- Product option group rules (min/max/mandatory) + login/attendance tracking

ALTER TABLE products ADD COLUMN option_groups_meta TEXT;

CREATE TABLE IF NOT EXISTS user_login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  full_name TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'logout')),
  event_at TEXT DEFAULT (datetime('now')),
  scheduled_start TEXT,
  scheduled_end TEXT,
  late_minutes INTEGER DEFAULT 0,
  early_minutes INTEGER DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_login_events_at ON user_login_events(event_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_login_events_user ON user_login_events(user_id, event_at DESC);
