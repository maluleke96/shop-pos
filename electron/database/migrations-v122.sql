-- Expenses smart features + owner personal funding
ALTER TABLE expenses ADD COLUMN vendor_name TEXT;
ALTER TABLE expenses ADD COLUMN purchase_order_id INTEGER;
ALTER TABLE expenses ADD COLUMN funding_source TEXT DEFAULT 'business';
ALTER TABLE expenses ADD COLUMN receipt_ocr_text TEXT;

CREATE TABLE IF NOT EXISTS expense_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  month_key TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  branch_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, month_key, branch_id)
);

CREATE TABLE IF NOT EXISTS expense_recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  vendor_name TEXT,
  payment_method TEXT DEFAULT 'eft',
  funding_source TEXT DEFAULT 'business',
  day_of_month INTEGER DEFAULT 1,
  next_due TEXT,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  last_posted_at TEXT,
  last_expense_id INTEGER
);

CREATE TABLE IF NOT EXISTS owner_fundings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  funding_date TEXT NOT NULL,
  amount REAL NOT NULL,
  funding_type TEXT NOT NULL DEFAULT 'purchase',
  description TEXT,
  expense_id INTEGER,
  payment_method TEXT,
  vendor_name TEXT,
  category TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_owner_fundings_date ON owner_fundings(funding_date);
CREATE INDEX IF NOT EXISTS idx_expense_recurring_due ON expense_recurring(next_due);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON expenses(vendor_name);
CREATE INDEX IF NOT EXISTS idx_expenses_funding ON expenses(funding_source);
