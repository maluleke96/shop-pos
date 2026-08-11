-- Payroll & Compliance (UIF, PAYE, SDL, COIDA, advances, loans, damage costs)

ALTER TABLE shop_settings ADD COLUMN payroll_settings TEXT DEFAULT '{}';

ALTER TABLE employees ADD COLUMN tax_number TEXT;
ALTER TABLE employees ADD COLUMN uif_number TEXT;
ALTER TABLE employees ADD COLUMN bank_name TEXT;
ALTER TABLE employees ADD COLUMN bank_account TEXT;
ALTER TABLE employees ADD COLUMN pension_contribution REAL DEFAULT 0;
ALTER TABLE employees ADD COLUMN medical_aid_contribution REAL DEFAULT 0;

ALTER TABLE employee_payroll ADD COLUMN gross_salary REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN paye REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN uif_employee REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN uif_employer REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN sdl REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN coida REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN advance_recovery REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN loan_recovery REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN damage_recovery REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN pension_deduction REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN medical_deduction REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN other_deductions REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN employer_pension REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN employer_medical REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN employer_other REAL DEFAULT 0;

CREATE TABLE IF NOT EXISTS employee_payroll_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_id INTEGER NOT NULL,
  deduction_type TEXT NOT NULL,
  reference_id INTEGER,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  is_employer INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (payroll_id) REFERENCES employee_payroll(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  advance_date TEXT DEFAULT (date('now')),
  reason TEXT,
  approved_by INTEGER,
  approved_by_name TEXT,
  balance REAL NOT NULL,
  recovery_per_period REAL DEFAULT 0,
  repayment_method TEXT DEFAULT 'salary_deduction',
  auto_deduct INTEGER DEFAULT 1,
  status TEXT DEFAULT 'outstanding',
  settled_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  loan_amount REAL NOT NULL,
  interest_rate REAL DEFAULT 0,
  loan_date TEXT DEFAULT (date('now')),
  monthly_deduction REAL NOT NULL,
  installments INTEGER DEFAULT 0,
  balance REAL NOT NULL,
  status TEXT DEFAULT 'active',
  settled_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_damage_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  product_name TEXT,
  quantity REAL DEFAULT 1,
  damage_value REAL NOT NULL,
  incident_date TEXT DEFAULT (date('now')),
  reason TEXT,
  approved_by INTEGER,
  approved_by_name TEXT,
  photo_path TEXT,
  deduction_method TEXT DEFAULT 'installments',
  recovery_per_period REAL DEFAULT 0,
  balance REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  settled_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_compliance_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_type TEXT NOT NULL,
  period_month TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  submitted_at TEXT,
  submitted_by TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compliance_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_type TEXT NOT NULL,
  file_path TEXT,
  file_name TEXT,
  expiry_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employee_advances_emp ON employee_advances(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_loans_emp ON employee_loans(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_damage_emp ON employee_damage_costs(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_payroll ON employee_payroll_deductions(payroll_id);
CREATE INDEX IF NOT EXISTS idx_compliance_submissions ON payroll_compliance_submissions(submission_type, period_month);
