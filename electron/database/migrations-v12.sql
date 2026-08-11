-- Operating hours settings + open/close session log
ALTER TABLE shop_settings ADD COLUMN operating_hours_settings TEXT DEFAULT '{}';

CREATE TABLE IF NOT EXISTS shop_operating_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('open', 'close')),
  user_id INTEGER,
  username TEXT,
  full_name TEXT,
  notes TEXT,
  event_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_shop_operating_log_date ON shop_operating_log(event_at);
