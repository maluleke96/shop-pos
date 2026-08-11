-- v62: POS cash-out deadline penalties + waste return tracking

CREATE TABLE IF NOT EXISTS cashout_penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  employee_id INTEGER REFERENCES employees(id),
  shift_id INTEGER,
  work_date TEXT,
  amount REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled')),
  created_by_name TEXT,
  applied_payroll_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cashout_penalties_emp ON cashout_penalties(employee_id, status);

ALTER TABLE waste_records ADD COLUMN returned_to_stock INTEGER DEFAULT 0;
ALTER TABLE waste_records ADD COLUMN returned_at TEXT;
ALTER TABLE waste_records ADD COLUMN returned_by INTEGER;
