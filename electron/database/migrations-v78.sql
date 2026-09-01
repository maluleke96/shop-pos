-- v78: HR, Payroll & Documents unified platform tables

CREATE TABLE IF NOT EXISTS hr_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  version TEXT NOT NULL DEFAULT '1.0',
  body TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  requires_ack INTEGER NOT NULL DEFAULT 1,
  applies_to TEXT,
  effective_date TEXT,
  review_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_policy_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL REFERENCES hr_policies(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  acknowledged_at TEXT DEFAULT (datetime('now')),
  signature_data TEXT,
  ip_address TEXT,
  created_by INTEGER REFERENCES users(id),
  UNIQUE(policy_id, employee_id, policy_version)
);

CREATE TABLE IF NOT EXISTS hr_business_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  title TEXT NOT NULL,
  body TEXT,
  applies_to TEXT DEFAULT 'all',
  position TEXT,
  department TEXT,
  branch_id INTEGER REFERENCES branches(id),
  employment_type TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_number TEXT,
  employee_id INTEGER REFERENCES employees(id),
  reporter_id INTEGER REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  incident_type TEXT NOT NULL DEFAULT 'other',
  incident_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'reported',
  severity TEXT DEFAULT 'medium',
  evidence_paths TEXT,
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_disciplinary_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  incident_id INTEGER REFERENCES hr_incidents(id),
  status TEXT NOT NULL DEFAULT 'investigation',
  stage TEXT DEFAULT 'investigation',
  allegation TEXT,
  employee_response TEXT,
  outcome TEXT,
  warning_id INTEGER REFERENCES employee_disciplinary(id),
  hearing_date TEXT,
  reviewer_id INTEGER REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  appeal_status TEXT,
  appeal_notes TEXT,
  evidence_paths TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_onboarding_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  employment_type TEXT DEFAULT 'casual',
  checklist_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_onboarding_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES hr_onboarding_templates(id),
  progress_json TEXT,
  completion_pct REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  completed_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, template_id)
);

CREATE TABLE IF NOT EXISTS hr_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  title TEXT NOT NULL,
  form_type TEXT NOT NULL DEFAULT 'general',
  schema_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES hr_forms(id),
  employee_id INTEGER REFERENCES employees(id),
  external_token TEXT,
  filled_data TEXT,
  doc_paths TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_notes TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_type TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  employee_id INTEGER REFERENCES employees(id),
  contract_id INTEGER REFERENCES employee_contracts(id),
  form_id INTEGER REFERENCES hr_forms(id),
  payload_json TEXT,
  expires_at TEXT,
  used_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number TEXT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  request_type TEXT NOT NULL,
  title TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  requested_at TEXT DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_notes TEXT,
  effective_date TEXT,
  payload_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_employer_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL,
  title TEXT NOT NULL,
  reference_number TEXT,
  value_json TEXT,
  doc_path TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_compliance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  reminder_days TEXT DEFAULT '30,14,7,1',
  status TEXT NOT NULL DEFAULT 'pending',
  related_entity_type TEXT,
  related_entity_id INTEGER,
  assigned_to INTEGER REFERENCES users(id),
  completed_at TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_salary_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,
  previous_amount REAL DEFAULT 0,
  new_amount REAL NOT NULL,
  salary_type TEXT,
  reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  requested_by INTEGER REFERENCES users(id),
  doc_path TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_offboarding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  exit_type TEXT NOT NULL DEFAULT 'resignation',
  effective_date TEXT NOT NULL,
  final_working_date TEXT,
  reason TEXT,
  checklist_json TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  final_payroll_id INTEGER REFERENCES employee_payroll(id),
  approved_by INTEGER REFERENCES users(id),
  completed_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_policies_status ON hr_policies(status, category);
CREATE INDEX IF NOT EXISTS idx_hr_policy_ack_emp ON hr_policy_acknowledgements(employee_id, policy_id);
CREATE INDEX IF NOT EXISTS idx_hr_incidents_emp ON hr_incidents(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_disc_cases_emp ON hr_disciplinary_cases(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_onboard_emp ON hr_onboarding_progress(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_requests_emp ON hr_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_requests_type ON hr_requests(request_type, status);
CREATE INDEX IF NOT EXISTS idx_hr_compliance_due ON hr_compliance_events(due_date, status);
CREATE INDEX IF NOT EXISTS idx_hr_salary_hist_emp ON hr_salary_history(employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_hr_external_token ON hr_external_links(token, status);

ALTER TABLE shop_settings ADD COLUMN hr_platform_settings TEXT;

INSERT OR IGNORE INTO hr_onboarding_templates (id, name, employment_type, checklist_json) VALUES (
  1,
  'Casual Worker Onboarding',
  'casual',
  '["Personal information","ID document","Bank details","Contract","Signature","Code of conduct","Business rules","Safety acknowledgement","Payroll setup","Admin approval"]'
);

INSERT OR IGNORE INTO hr_policies (id, code, title, category, version, body, requires_ack) VALUES
  (1, 'CODE_OF_CONDUCT', 'Code of Conduct', 'conduct', '1.0', 'Employees must maintain professional conduct at all times.', 1),
  (2, 'CASH_HANDLING', 'Cash Handling Policy', 'operations', '1.0', 'All cash must be handled according to POS procedures.', 1);
