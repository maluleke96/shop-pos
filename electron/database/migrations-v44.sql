-- v2.8.2: Owner salary compliance, owner draws, refund authorization

ALTER TABLE owner_salary_profile ADD COLUMN employee_id INTEGER REFERENCES employees(id);
ALTER TABLE owner_salary_profile ADD COLUMN uif_registration TEXT;
ALTER TABLE owner_salary_profile ADD COLUMN tax_number TEXT;
ALTER TABLE owner_salary_profile ADD COLUMN uif_enabled INTEGER DEFAULT 1;
ALTER TABLE owner_salary_profile ADD COLUMN paye_enabled INTEGER DEFAULT 1;

ALTER TABLE owner_salary_periods ADD COLUMN uif_employee REAL DEFAULT 0;
ALTER TABLE owner_salary_periods ADD COLUMN uif_employer REAL DEFAULT 0;
ALTER TABLE owner_salary_periods ADD COLUMN paye REAL DEFAULT 0;
ALTER TABLE owner_salary_periods ADD COLUMN sdl REAL DEFAULT 0;
ALTER TABLE owner_salary_periods ADD COLUMN draw_deductions REAL DEFAULT 0;
ALTER TABLE owner_salary_periods ADD COLUMN net_pay REAL DEFAULT 0;
ALTER TABLE owner_salary_periods ADD COLUMN deductions_detail TEXT;

CREATE TABLE IF NOT EXISTS owner_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  draw_date TEXT NOT NULL,
  draw_type TEXT NOT NULL DEFAULT 'cash' CHECK (draw_type IN ('cash', 'food', 'other')),
  amount REAL NOT NULL DEFAULT 0,
  description TEXT,
  period_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES owner_salary_profile(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_owner_draws_profile ON owner_draws(profile_id, draw_date);
