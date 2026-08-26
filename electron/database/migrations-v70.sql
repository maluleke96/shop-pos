-- Contract expiry + re-sign window; salary claim records
ALTER TABLE employee_contracts ADD COLUMN expires_at TEXT;
ALTER TABLE employee_contracts ADD COLUMN resign_opens_at TEXT;
ALTER TABLE employee_contracts ADD COLUMN resign_closes_at TEXT;
ALTER TABLE employee_contracts ADD COLUMN renewed_from_id INTEGER;
ALTER TABLE employee_contracts ADD COLUMN doc_paths_json TEXT;
ALTER TABLE employee_contracts ADD COLUMN require_docs_on_resign INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS salary_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  payroll_id INTEGER,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payment_date TEXT,
  claim_deadline TEXT NOT NULL,
  claim_opens_at TEXT,
  gross_amount REAL DEFAULT 0,
  net_amount REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  employee_notes TEXT,
  admin_notes TEXT,
  claimed_at TEXT,
  approved_at TEXT,
  approved_by INTEGER,
  rejected_at TEXT,
  rejected_by INTEGER,
  paid_at TEXT,
  signature_snapshot TEXT,
  claim_data_json TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_salary_claims_emp ON salary_claims(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_claims_deadline ON salary_claims(claim_deadline);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_expires ON employee_contracts(expires_at, status);
