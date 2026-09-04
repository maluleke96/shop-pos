-- Driver bank details and admin payout records

ALTER TABLE delivery_drivers ADD COLUMN bank_name TEXT;
ALTER TABLE delivery_drivers ADD COLUMN bank_account TEXT;
ALTER TABLE delivery_drivers ADD COLUMN bank_branch_code TEXT;

ALTER TABLE delivery_settings ADD COLUMN payout_cycle_days INTEGER DEFAULT 7;
ALTER TABLE delivery_settings ADD COLUMN payout_day_of_week INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS delivery_driver_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  period_from TEXT,
  period_to TEXT,
  paid_at TEXT,
  paid_by INTEGER,
  paid_by_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_payouts_driver ON delivery_driver_payouts(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_paid ON delivery_driver_payouts(paid_at);
