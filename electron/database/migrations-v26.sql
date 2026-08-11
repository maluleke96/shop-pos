-- Operations & Compliance module (v2.3.0)

CREATE TABLE IF NOT EXISTS company_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_number TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  description TEXT,
  effective_date TEXT,
  version INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  attachments_json TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_rule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES company_rules(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  previous_json TEXT,
  new_json TEXT,
  user_id INTEGER,
  username TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opening_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_required INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS closing_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_required INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS daily_checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,
  run_date TEXT NOT NULL,
  branch_id INTEGER,
  employee_id INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress',
  completed_at TEXT,
  report_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES daily_checklist_runs(id) ON DELETE CASCADE,
  template_id INTEGER,
  task_name TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  comments TEXT,
  completed_at TEXT,
  employee_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_rules_status ON company_rules(status);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_date ON daily_checklist_runs(run_date, run_type);
CREATE INDEX IF NOT EXISTS idx_checklist_items_run ON daily_checklist_items(run_id);

ALTER TABLE products ADD COLUMN promo_flag INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN promo_notes TEXT;
ALTER TABLE products ADD COLUMN last_sale_date TEXT;

INSERT OR IGNORE INTO opening_checklist_templates (id, task_name, sort_order, is_required) VALUES
  (1, 'Unlock premises and disarm alarm', 1, 1),
  (2, 'Turn on lights, POS and equipment', 2, 1),
  (3, 'Verify cash float matches expected amount', 3, 1),
  (4, 'Check refrigeration / freezer temperatures', 4, 1),
  (5, 'Inspect front-of-store display and signage', 5, 0),
  (6, 'Brief staff on daily specials and tasks', 6, 0),
  (7, 'Check restrooms and customer areas are clean', 7, 0);

INSERT OR IGNORE INTO closing_checklist_templates (id, task_name, sort_order, is_required) VALUES
  (1, 'Complete cash-up and reconcile drawer', 1, 1),
  (2, 'Secure cash in safe or deposit bag', 2, 1),
  (3, 'Turn off non-essential equipment', 3, 1),
  (4, 'Clean work surfaces and floor areas', 4, 0),
  (5, 'Lock stock room and secure high-value items', 5, 1),
  (6, 'Set alarm and lock all entry points', 6, 1),
  (7, 'Submit closing report to manager', 7, 0);
