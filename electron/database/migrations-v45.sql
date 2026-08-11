-- v2.8.5: Employee portal feed (EOM congratulations, etc.)

CREATE TABLE IF NOT EXISTS employee_portal_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  feed_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  photo_path TEXT,
  ref_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_portal_feed_employee ON employee_portal_feed(employee_id, created_at DESC);
