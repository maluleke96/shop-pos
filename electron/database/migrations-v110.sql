-- Manager & Supervisor HR / Disciplinary Portal (v110)
-- Reuses employees, users, branches, employee_disciplinary — does not duplicate staff records.

CREATE TABLE IF NOT EXISTS manager_hr_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  portal_role TEXT NOT NULL DEFAULT 'supervisor',
  branch_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  can_create_warnings INTEGER NOT NULL DEFAULT 0,
  can_recommend_recovery INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mgr_hr_assign_user ON manager_hr_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_assign_branch ON manager_hr_assignments(branch_id);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_assign_active ON manager_hr_assignments(is_active);

CREATE TABLE IF NOT EXISTS manager_hr_assignment_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  UNIQUE(assignment_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_mgr_hr_scope_emp ON manager_hr_assignment_employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_scope_asg ON manager_hr_assignment_employees(assignment_id);

CREATE TABLE IF NOT EXISTS manager_hr_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL,
  branch_id INTEGER,
  reported_by_user_id INTEGER NOT NULL,
  reporter_portal_role TEXT,
  incident_date TEXT,
  incident_time TEXT,
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT,
  description TEXT,
  what_happened TEXT,
  witnesses TEXT,
  recommended_action TEXT,
  additional_notes TEXT,
  status TEXT NOT NULL DEFAULT 'REPORTED',
  evidence_paths TEXT,
  warning_id INTEGER,
  hr_case_id INTEGER,
  final_decision TEXT,
  final_decision_notes TEXT,
  decided_by INTEGER,
  decided_at TEXT,
  closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mgr_hr_cases_emp ON manager_hr_cases(employee_id);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_cases_branch ON manager_hr_cases(branch_id);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_cases_status ON manager_hr_cases(status);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_cases_reporter ON manager_hr_cases(reported_by_user_id);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_cases_number ON manager_hr_cases(case_number);

CREATE TABLE IF NOT EXISTS manager_hr_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  actor_role TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  notes TEXT,
  meta_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mgr_hr_events_case ON manager_hr_case_events(case_id);

CREATE TABLE IF NOT EXISTS manager_hr_case_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  response_text TEXT,
  agree_disagree TEXT,
  explanation TEXT,
  supporting_info TEXT,
  attachment_paths TEXT,
  is_locked INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT DEFAULT (datetime('now')),
  UNIQUE(case_id, version)
);

CREATE INDEX IF NOT EXISTS idx_mgr_hr_resp_case ON manager_hr_case_responses(case_id);

CREATE TABLE IF NOT EXISTS manager_hr_case_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  recommended_by INTEGER NOT NULL,
  recommendation_text TEXT,
  recommended_warning_type TEXT,
  recommended_recovery_amount REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mgr_hr_rec_case ON manager_hr_case_recommendations(case_id);

CREATE TABLE IF NOT EXISTS manager_hr_case_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL UNIQUE,
  reported_loss REAL NOT NULL DEFAULT 0,
  recommended_recovery REAL NOT NULL DEFAULT 0,
  approved_recovery REAL NOT NULL DEFAULT 0,
  actual_payroll_deduction REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'R',
  notes TEXT,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS manager_hr_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audience TEXT NOT NULL,
  user_id INTEGER,
  employee_id INTEGER,
  case_id INTEGER,
  title TEXT NOT NULL,
  message TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mgr_hr_notif_user ON manager_hr_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_mgr_hr_notif_emp ON manager_hr_notifications(employee_id, is_read);
