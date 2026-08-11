-- HR Contracts & Probation Management

ALTER TABLE employees ADD COLUMN employee_number TEXT;

CREATE TABLE IF NOT EXISTS employee_contract_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position TEXT,
  clauses_json TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES employee_contract_templates(id),
  contract_data_json TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','pending_signatures','active','expired','terminated')),
  employee_signed_at TEXT,
  manager_signed_at TEXT,
  admin_signed_at TEXT,
  witness_signed_at TEXT,
  signature_data_json TEXT,
  pdf_path TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_probation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 90,
  manager_id INTEGER REFERENCES employees(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','extended','passed','failed','terminated')),
  rules_json TEXT,
  final_decision TEXT,
  decision_date TEXT,
  decision_by INTEGER,
  decision_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS probation_daily_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  probation_id INTEGER NOT NULL REFERENCES employee_probation(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  eval_date TEXT NOT NULL,
  manager_id INTEGER REFERENCES employees(id),
  scores_json TEXT,
  comments TEXT,
  overall_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(probation_id, eval_date)
);

CREATE TABLE IF NOT EXISTS probation_decision_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  min_overall_score REAL DEFAULT 3.5,
  min_attendance_pct REAL DEFAULT 90,
  max_late INTEGER DEFAULT 5,
  max_absences INTEGER DEFAULT 2,
  min_work_quality REAL DEFAULT 3,
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_contracts_emp ON employee_contracts(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_probation_emp ON employee_probation(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_probation_eval ON probation_daily_evaluations(probation_id, eval_date DESC);

INSERT OR IGNORE INTO probation_decision_rules (id, name, min_overall_score, min_attendance_pct, max_late, max_absences, min_work_quality, is_active)
VALUES (1, 'Standard Probation Pass', 3.5, 90, 5, 2, 3, 1);

INSERT OR IGNORE INTO employee_contract_templates (id, name, position, clauses_json, is_default)
VALUES (1, 'Standard Employment Contract', 'General Staff', '[]', 1);
