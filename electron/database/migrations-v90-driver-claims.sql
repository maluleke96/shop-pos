-- Driver profile + payout claims (SQLite local)
ALTER TABLE delivery_drivers ADD COLUMN profile_photo_path TEXT;
ALTER TABLE delivery_drivers ADD COLUMN vehicle_registration TEXT;

CREATE TABLE IF NOT EXISTS delivery_driver_payout_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  delivery_count INTEGER DEFAULT 0,
  period_from TEXT,
  period_to TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_at TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  admin_notes TEXT,
  payout_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_payout_claims_driver ON delivery_driver_payout_claims(driver_id, status);
