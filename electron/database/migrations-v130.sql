-- Manager Operations & Daily Tasks (mod.manager_operations)
-- Historical rows are NEVER deleted when the module is locked/downgraded.

CREATE TABLE IF NOT EXISTS mo_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  daily_sales_target_override REAL,
  notify_owner_on_report INTEGER NOT NULL DEFAULT 1,
  notify_owner_on_urgent INTEGER NOT NULL DEFAULT 1,
  notify_manager_remaining INTEGER NOT NULL DEFAULT 1,
  auto_generate_tasks INTEGER NOT NULL DEFAULT 1,
  verification_role TEXT NOT NULL DEFAULT 'owner,manager',
  settings_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO mo_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS mo_task_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  assigned_role TEXT NOT NULL DEFAULT 'assistant_manager',
  is_primary INTEGER NOT NULL DEFAULT 1,
  is_required INTEGER NOT NULL DEFAULT 1,
  photo_mode TEXT NOT NULL DEFAULT 'none',
  verification_required INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'medium',
  sort_order INTEGER NOT NULL DEFAULT 0,
  schedule_offset_minutes INTEGER,
  schedule_anchor TEXT,
  recurrence TEXT NOT NULL DEFAULT 'daily',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'opening',
  assigned_role TEXT NOT NULL DEFAULT 'assistant_manager',
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 1,
  photo_mode TEXT NOT NULL DEFAULT 'none',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (template_id) REFERENCES mo_checklist_templates(id)
);

CREATE TABLE IF NOT EXISTS mo_daily_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_key TEXT,
  branch_id INTEGER,
  work_date TEXT NOT NULL,
  template_id INTEGER,
  checklist_template_id INTEGER,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  assigned_role TEXT NOT NULL DEFAULT 'assistant_manager',
  assigned_user_id INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 1,
  is_required INTEGER NOT NULL DEFAULT 1,
  photo_mode TEXT NOT NULL DEFAULT 'none',
  verification_required INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'not_started',
  due_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  completed_by INTEGER,
  completed_by_name TEXT,
  verified_at TEXT,
  verified_by INTEGER,
  verified_by_name TEXT,
  notes TEXT,
  helper_user_id INTEGER,
  helper_name TEXT,
  overdue_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mo_tasks_date ON mo_daily_tasks(work_date);
CREATE INDEX IF NOT EXISTS idx_mo_tasks_status ON mo_daily_tasks(status);
CREATE INDEX IF NOT EXISTS idx_mo_tasks_role ON mo_daily_tasks(assigned_role);
CREATE INDEX IF NOT EXISTS idx_mo_tasks_user ON mo_daily_tasks(assigned_user_id);

CREATE TABLE IF NOT EXISTS mo_checklist_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  checklist_item_id INTEGER,
  label TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 1,
  photo_mode TEXT NOT NULL DEFAULT 'none',
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_by INTEGER,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES mo_daily_tasks(id)
);

CREATE TABLE IF NOT EXISTS mo_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_key TEXT,
  task_id INTEGER,
  incident_id INTEGER,
  report_id INTEGER,
  user_id INTEGER,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  caption TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mo_evidence_task ON mo_evidence(task_id);
CREATE INDEX IF NOT EXISTS idx_mo_evidence_incident ON mo_evidence(incident_id);

CREATE TABLE IF NOT EXISTS mo_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_key TEXT,
  branch_id INTEGER,
  work_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  action_taken TEXT,
  requires_owner INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  reported_by INTEGER,
  reported_by_name TEXT,
  voice_note_path TEXT,
  resolved_at TEXT,
  resolved_by INTEGER,
  owner_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mo_incidents_date ON mo_incidents(work_date);

CREATE TABLE IF NOT EXISTS mo_team_help (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  requester_user_id INTEGER,
  requester_name TEXT,
  requester_role TEXT,
  helper_user_id INTEGER,
  helper_name TEXT,
  task_id INTEGER,
  need_label TEXT,
  status TEXT NOT NULL DEFAULT 'needed',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  helped_at TEXT
);

CREATE TABLE IF NOT EXISTS mo_daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_key TEXT,
  branch_id INTEGER,
  work_date TEXT NOT NULL,
  submitted_by INTEGER,
  submitted_by_name TEXT,
  sales_amount REAL NOT NULL DEFAULT 0,
  sales_target REAL NOT NULL DEFAULT 0,
  target_achieved INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  tasks_total INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  marketing_total INTEGER NOT NULL DEFAULT 0,
  marketing_completed INTEGER NOT NULL DEFAULT 0,
  incidents_count INTEGER NOT NULL DEFAULT 0,
  complaints_count INTEGER NOT NULL DEFAULT 0,
  stock_problems INTEGER NOT NULL DEFAULT 0,
  photos_count INTEGER NOT NULL DEFAULT 0,
  outstanding_count INTEGER NOT NULL DEFAULT 0,
  kitchen_status TEXT,
  closing_status TEXT,
  manager_comments TEXT,
  report_json TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  submitted_at TEXT DEFAULT (datetime('now')),
  owner_viewed_at TEXT,
  UNIQUE(work_date, branch_id)
);

CREATE TABLE IF NOT EXISTS mo_owner_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER,
  work_date TEXT,
  from_user_id INTEGER,
  from_name TEXT,
  to_user_id INTEGER,
  message TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES mo_daily_reports(id)
);

CREATE TABLE IF NOT EXISTS mo_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mo_audit_created ON mo_audit(created_at);
