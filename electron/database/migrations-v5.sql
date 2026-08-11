CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  payment_number TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  notes TEXT,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS supervisor_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  code_date TEXT NOT NULL,
  purpose TEXT DEFAULT 'void',
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_supervisor_codes_date ON supervisor_codes(code_date, purpose);

ALTER TABLE gift_cards ADD COLUMN customer_phone TEXT;
