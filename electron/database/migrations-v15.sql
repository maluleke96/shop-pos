-- Bookkeeping & Financial Management (v15)

CREATE TABLE IF NOT EXISTS bookkeeping_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cash_opening_balance REAL DEFAULT 0,
  bank_opening_balance REAL DEFAULT 0,
  bank_name TEXT,
  bank_account_number TEXT,
  vat_rate REAL DEFAULT 15,
  vat_registered INTEGER DEFAULT 0,
  fiscal_year_start TEXT DEFAULT '03-01',
  low_cash_threshold REAL DEFAULT 500,
  notification_settings TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO bookkeeping_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_number TEXT NOT NULL,
  txn_date TEXT NOT NULL,
  txn_type TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  description TEXT,
  amount REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  payment_method TEXT,
  account_type TEXT DEFAULT 'cash',
  reference_type TEXT,
  reference_id INTEGER,
  employee_id INTEGER,
  customer_id INTEGER,
  supplier_id INTEGER,
  branch TEXT DEFAULT 'main',
  is_auto INTEGER DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  approved_by INTEGER,
  approved_by_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_entries(reference_type, reference_id, txn_type, COALESCE(subcategory,''));

CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(txn_date);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(txn_type);
CREATE INDEX IF NOT EXISTS idx_ledger_category ON ledger_entries(category);

CREATE TABLE IF NOT EXISTS income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  income_type TEXT NOT NULL,
  category TEXT,
  description TEXT,
  amount REAL NOT NULL,
  income_date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  account_type TEXT DEFAULT 'cash',
  customer_id INTEGER,
  reference TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_date TEXT NOT NULL,
  txn_type TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  bank_reference TEXT,
  reconciled INTEGER DEFAULT 0,
  reconciled_date TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS financial_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  title TEXT,
  file_path TEXT,
  file_name TEXT,
  amount REAL,
  doc_date TEXT,
  reference_type TEXT,
  reference_id INTEGER,
  employee_id INTEGER,
  customer_id INTEGER,
  supplier_id INTEGER,
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_month TEXT NOT NULL,
  category TEXT NOT NULL,
  department TEXT DEFAULT 'general',
  amount REAL NOT NULL,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_unique ON budgets(budget_month, category, department);

CREATE TABLE IF NOT EXISTS financial_audit_trail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  field_name TEXT,
  previous_value TEXT,
  new_value TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
