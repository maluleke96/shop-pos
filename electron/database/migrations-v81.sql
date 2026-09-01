-- v81 Cash-up compatibility: canonical table is cashup_sessions (migrations-v2).
-- Some integration code historically referenced "cashups"; expose a read-only view alias.
CREATE TABLE IF NOT EXISTS cashup_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER,
  user_id INTEGER,
  branch_id INTEGER DEFAULT 1,
  opening_cash REAL DEFAULT 0,
  cash_sales REAL DEFAULT 0,
  card_sales REAL DEFAULT 0,
  eft_sales REAL DEFAULT 0,
  mobile_sales REAL DEFAULT 0,
  expenses REAL DEFAULT 0,
  refunds REAL DEFAULT 0,
  expected_cash REAL DEFAULT 0,
  actual_cash REAL DEFAULT 0,
  difference REAL DEFAULT 0,
  manager_approved INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS cashups AS
SELECT
  id,
  shift_id,
  user_id,
  branch_id,
  opening_cash,
  cash_sales,
  card_sales,
  eft_sales,
  mobile_sales,
  expenses,
  refunds,
  expected_cash,
  actual_cash,
  difference,
  manager_approved,
  notes,
  created_at
FROM cashup_sessions;
