-- HR Command Centre tables (v78) + employee_documents.expiry_date for Railway Postgres

ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS expiry_date TEXT;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'on_file';
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS required INTEGER DEFAULT 0;
ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS hr_platform_settings TEXT;

CREATE TABLE IF NOT EXISTS hr_policies (
  id SERIAL PRIMARY KEY,
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
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_policy_acknowledgements (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES hr_policies(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
  signature_data TEXT,
  ip_address TEXT,
  created_by INTEGER,
  UNIQUE(policy_id, employee_id, policy_version)
);

CREATE TABLE IF NOT EXISTS hr_business_rules (
  id SERIAL PRIMARY KEY,
  code TEXT,
  title TEXT NOT NULL,
  body TEXT,
  applies_to TEXT DEFAULT 'all',
  position TEXT,
  department TEXT,
  branch_id INTEGER,
  employment_type TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_incidents (
  id SERIAL PRIMARY KEY,
  incident_number TEXT,
  employee_id INTEGER,
  reporter_id INTEGER,
  branch_id INTEGER,
  incident_type TEXT NOT NULL DEFAULT 'other',
  incident_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'reported',
  severity TEXT DEFAULT 'medium',
  evidence_paths TEXT,
  resolution TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_disciplinary_cases (
  id SERIAL PRIMARY KEY,
  case_number TEXT,
  employee_id INTEGER NOT NULL,
  incident_id INTEGER REFERENCES hr_incidents(id),
  status TEXT NOT NULL DEFAULT 'investigation',
  stage TEXT DEFAULT 'investigation',
  allegation TEXT,
  employee_response TEXT,
  outcome TEXT,
  warning_id INTEGER,
  hearing_date TEXT,
  reviewer_id INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  appeal_status TEXT,
  appeal_notes TEXT,
  evidence_paths TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_onboarding_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  employment_type TEXT DEFAULT 'casual',
  checklist_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_onboarding_progress (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  template_id INTEGER REFERENCES hr_onboarding_templates(id),
  progress_json TEXT,
  completion_pct REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  completed_at TEXT,
  approved_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, template_id)
);

CREATE TABLE IF NOT EXISTS hr_forms (
  id SERIAL PRIMARY KEY,
  code TEXT,
  title TEXT NOT NULL,
  form_type TEXT NOT NULL DEFAULT 'general',
  schema_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_form_submissions (
  id SERIAL PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES hr_forms(id),
  employee_id INTEGER,
  external_token TEXT,
  filled_data TEXT,
  doc_paths TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_external_links (
  id SERIAL PRIMARY KEY,
  link_type TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  employee_id INTEGER,
  contract_id INTEGER,
  form_id INTEGER REFERENCES hr_forms(id),
  payload_json TEXT,
  expires_at TEXT,
  used_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_requests (
  id SERIAL PRIMARY KEY,
  request_number TEXT,
  employee_id INTEGER NOT NULL,
  request_type TEXT NOT NULL,
  title TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  effective_date TEXT,
  payload_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_employer_records (
  id SERIAL PRIMARY KEY,
  record_type TEXT NOT NULL,
  title TEXT NOT NULL,
  reference_number TEXT,
  value_json TEXT,
  doc_path TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_compliance_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  reminder_days TEXT DEFAULT '30,14,7,1',
  status TEXT NOT NULL DEFAULT 'pending',
  related_entity_type TEXT,
  related_entity_id INTEGER,
  assigned_to INTEGER,
  completed_at TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_salary_history (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  previous_amount REAL DEFAULT 0,
  new_amount REAL NOT NULL,
  salary_type TEXT,
  reason TEXT,
  approved_by INTEGER,
  requested_by INTEGER,
  doc_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_offboarding (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  exit_type TEXT NOT NULL DEFAULT 'resignation',
  effective_date TEXT NOT NULL,
  final_working_date TEXT,
  reason TEXT,
  checklist_json TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  final_payroll_id INTEGER,
  approved_by INTEGER,
  completed_at TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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

INSERT INTO hr_onboarding_templates (id, name, employment_type, checklist_json)
VALUES (
  1,
  'Casual Worker Onboarding',
  'casual',
  '["Personal information","ID document","Bank details","Contract","Signature","Code of conduct","Business rules","Safety acknowledgement","Payroll setup","Admin approval"]'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO hr_policies (id, code, title, category, version, body, requires_ack)
VALUES
  (1, 'CODE_OF_CONDUCT', 'Code of Conduct', 'conduct', '1.0', 'Employees must maintain professional conduct at all times.', 1),
  (2, 'CASH_HANDLING', 'Cash Handling Policy', 'operations', '1.0', 'All cash must be handled according to POS procedures.', 1)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('hr_policies', 'id'), COALESCE((SELECT MAX(id) FROM hr_policies), 1));
SELECT setval(pg_get_serial_sequence('hr_onboarding_templates', 'id'), COALESCE((SELECT MAX(id) FROM hr_onboarding_templates), 1));
