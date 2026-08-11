-- Sales targets, enhanced shift close, new user roles

ALTER TABLE shop_settings ADD COLUMN sales_targets TEXT DEFAULT '{}';

ALTER TABLE shifts ADD COLUMN mobile_sales REAL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN other_sales REAL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN giftcard_sales REAL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN account_sales REAL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN actual_payments_json TEXT;
ALTER TABLE shifts ADD COLUMN payment_shortages_json TEXT;
ALTER TABLE shifts ADD COLUMN daily_target REAL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN sales_at_close REAL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN target_remaining REAL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN target_met INTEGER DEFAULT 0;

PRAGMA foreign_keys=off;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pin TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'assistant_manager', 'marketing_agent', 'cashier')),
  is_active INTEGER DEFAULT 1,
  permissions TEXT DEFAULT '{}',
  branch_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, username, password_hash, pin, full_name, role, is_active, permissions, branch_id, created_at, updated_at)
SELECT id, username, password_hash, pin, full_name, role, is_active, permissions, branch_id, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys=on;
