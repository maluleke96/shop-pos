-- Loyalty point lots (expiry + reminder tracking)

CREATE TABLE IF NOT EXISTS loyalty_point_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  transaction_id INTEGER REFERENCES loyalty_transactions(id),
  points_remaining REAL NOT NULL,
  points_original REAL NOT NULL,
  earned_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_reminder_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_lots_customer ON loyalty_point_lots(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_lots_expiry ON loyalty_point_lots(expires_at);
