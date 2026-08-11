-- Phase 3: Signed PDFs & checklist admin-confirm workflow

ALTER TABLE shop_settings ADD COLUMN admin_signature_path TEXT;

ALTER TABLE daily_checklist_runs ADD COLUMN submitted_at TEXT;
ALTER TABLE daily_checklist_runs ADD COLUMN submitted_by INTEGER;
ALTER TABLE daily_checklist_runs ADD COLUMN confirmed_by INTEGER;
ALTER TABLE daily_checklist_runs ADD COLUMN confirmed_at TEXT;
ALTER TABLE daily_checklist_runs ADD COLUMN admin_notes TEXT;

CREATE TABLE IF NOT EXISTS compliance_checklist_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,
  run_date TEXT NOT NULL,
  run_id INTEGER,
  employee_id INTEGER,
  manager_user_id INTEGER,
  manager_name TEXT,
  warning_type TEXT NOT NULL DEFAULT 'not_submitted',
  message TEXT,
  whatsapp_url TEXT,
  whatsapp_body TEXT,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compliance_warnings_date ON compliance_checklist_warnings(run_date, run_type);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_status ON daily_checklist_runs(status, run_date);
