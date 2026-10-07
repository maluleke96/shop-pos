-- Salary claim windows (staff portal + admin payroll) — mirrors migrations-v70.sql

CREATE TABLE IF NOT EXISTS salary_claims (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  payroll_id INTEGER,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payment_date TEXT,
  claim_deadline TEXT NOT NULL,
  claim_opens_at TEXT,
  gross_amount DOUBLE PRECISION DEFAULT 0,
  net_amount DOUBLE PRECISION DEFAULT 0,
  amount DOUBLE PRECISION DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  employee_notes TEXT,
  admin_notes TEXT,
  claimed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by INTEGER,
  rejected_at TIMESTAMPTZ,
  rejected_by INTEGER,
  paid_at TIMESTAMPTZ,
  signature_snapshot TEXT,
  claim_data_json TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_claims_emp ON salary_claims(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_claims_deadline ON salary_claims(claim_deadline);

ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS resign_opens_at TEXT;
ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS resign_closes_at TEXT;
ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS renewed_from_id INTEGER;
ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS doc_paths_json TEXT;
ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS require_docs_on_resign INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_employee_contracts_expires ON employee_contracts(expires_at, status);
