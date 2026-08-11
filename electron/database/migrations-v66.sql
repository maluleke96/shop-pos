-- Marketing Agent System — templates, sync conflicts, media status helpers

CREATE TABLE IF NOT EXISTS marketing_menu_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  title TEXT NOT NULL,
  menu_type TEXT DEFAULT 'main',
  pages_json TEXT,
  products_json TEXT,
  branding_json TEXT,
  page_size TEXT DEFAULT 'A4',
  is_locked INTEGER DEFAULT 0,
  created_by INTEGER,
  agent_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketing_sync_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_uid TEXT NOT NULL,
  local_version INTEGER,
  remote_version INTEGER,
  local_json TEXT,
  remote_json TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mkt_menu_templates_type ON marketing_menu_templates(menu_type);
CREATE INDEX IF NOT EXISTS idx_mkt_sync_conflicts_status ON marketing_sync_conflicts(status);
