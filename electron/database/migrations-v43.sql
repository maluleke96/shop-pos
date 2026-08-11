-- v2.8.1: Checklist settings, HR training/probation/employment workflow, recruitment

ALTER TABLE shop_settings ADD COLUMN checklist_settings TEXT;

CREATE TABLE IF NOT EXISTS hr_training_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  start_date TEXT NOT NULL,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  evaluations_json TEXT,
  template_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_contract_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('training', 'probation', 'employment')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_staff_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  template_type TEXT NOT NULL CHECK (template_type IN ('training', 'probation', 'employment')),
  template_id INTEGER REFERENCES hr_contract_templates(id),
  filled_data TEXT,
  doc_paths TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'active', 'closed')),
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posting_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  location TEXT,
  cv_path TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  employ_request_by INTEGER REFERENCES users(id),
  employ_request_at TEXT,
  admin_decision TEXT,
  admin_decision_by INTEGER REFERENCES users(id),
  admin_decision_at TEXT,
  admin_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_training_emp ON hr_training_records(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_submissions_status ON hr_staff_submissions(status, template_type);
CREATE INDEX IF NOT EXISTS idx_job_postings_status ON job_postings(status);
CREATE INDEX IF NOT EXISTS idx_job_candidates_posting ON job_candidates(posting_id, status);
