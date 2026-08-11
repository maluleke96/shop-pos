-- Owner Salary Management

CREATE TABLE IF NOT EXISTS owner_salary_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_name TEXT NOT NULL,
  position TEXT DEFAULT 'Owner',
  salary_type TEXT NOT NULL DEFAULT 'monthly' CHECK (salary_type IN ('monthly', 'weekly')),
  basic_salary REAL NOT NULL DEFAULT 0,
  payment_day INTEGER DEFAULT 25,
  custom_pay_date TEXT,
  default_bonus REAL DEFAULT 0,
  default_allowances REAL DEFAULT 0,
  default_deductions REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS owner_salary_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  period_type TEXT NOT NULL,
  basic_salary REAL NOT NULL DEFAULT 0,
  bonus REAL DEFAULT 0,
  allowances REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  carried_forward REAL DEFAULT 0,
  gross_amount REAL NOT NULL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  outstanding_balance REAL DEFAULT 0,
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partially_paid', 'paid')),
  due_date TEXT,
  payslip_number TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES owner_salary_profile(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS owner_salary_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  payment_reference TEXT,
  total_amount REAL NOT NULL,
  notes TEXT,
  paid_by_user_id INTEGER,
  paid_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES owner_salary_profile(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS owner_salary_payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES owner_salary_payments(id) ON DELETE CASCADE,
  FOREIGN KEY (period_id) REFERENCES owner_salary_periods(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_owner_salary_periods_profile ON owner_salary_periods(profile_id, period_end);
CREATE INDEX IF NOT EXISTS idx_owner_salary_periods_status ON owner_salary_periods(status);
CREATE INDEX IF NOT EXISTS idx_owner_salary_payments_profile ON owner_salary_payments(profile_id, payment_date);
