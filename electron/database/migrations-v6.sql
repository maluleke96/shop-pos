CREATE TABLE IF NOT EXISTS settings_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_by INTEGER NOT NULL,
  requested_by_name TEXT,
  settings_json TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  review_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS sale_payments_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  payment_type TEXT NOT NULL,
  amount REAL NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

INSERT INTO sale_payments_v2 (id, sale_id, payment_type, amount)
SELECT id, sale_id, payment_type, amount FROM sale_payments;

DROP TABLE sale_payments;

ALTER TABLE sale_payments_v2 RENAME TO sale_payments;
