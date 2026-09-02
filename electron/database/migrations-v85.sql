-- Business Modules v85 — Investor Management, App Release Centre, AI Meeting Centre
-- Each module has isolated users/sessions; centrally managed via biz_module_settings.

CREATE TABLE IF NOT EXISTS biz_module_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  investor_enabled INTEGER DEFAULT 1,
  release_enabled INTEGER DEFAULT 1,
  meeting_enabled INTEGER DEFAULT 1,
  meeting_retention_days INTEGER DEFAULT 365,
  meeting_ai_provider TEXT DEFAULT 'none',
  meeting_ai_api_key_set INTEGER DEFAULT 0,
  release_preview_url TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO biz_module_settings (id) VALUES (1);

-- ─── INVESTOR MANAGEMENT ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS investors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_code TEXT UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  investment_amount REAL DEFAULT 0,
  equity_percent REAL DEFAULT 0,
  profit_share_percent REAL DEFAULT 0,
  agreement_date TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','pending','terminated')),
  terms_json TEXT DEFAULT '{}',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_portal_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  is_active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES investor_portal_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investment_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER REFERENCES investors(id),
  title TEXT NOT NULL,
  business_info TEXT,
  amount_requested REAL DEFAULT 0,
  amount_offered REAL DEFAULT 0,
  percent_offered REAL DEFAULT 0,
  return_arrangement TEXT,
  duration TEXT,
  investor_responsibilities TEXT,
  business_responsibilities TEXT,
  terms TEXT,
  risks TEXT,
  notes TEXT,
  status TEXT DEFAULT 'draft',
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investment_agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  proposal_id INTEGER REFERENCES investment_proposals(id),
  title TEXT NOT NULL,
  file_path TEXT,
  status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','VIEWED','SIGNED','ACTIVE','EXPIRED','TERMINATED')),
  sent_at TEXT,
  viewed_at TEXT,
  signed_at TEXT,
  expires_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  agreement_id INTEGER REFERENCES investment_agreements(id),
  doc_type TEXT DEFAULT 'general',
  title TEXT NOT NULL,
  file_path TEXT,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  payment_type TEXT DEFAULT 'contribution',
  reference TEXT,
  notes TEXT,
  paid_at TEXT,
  recorded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  distribution_type TEXT DEFAULT 'return',
  reference TEXT,
  notes TEXT,
  paid_at TEXT,
  recorded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER,
  title TEXT NOT NULL,
  body TEXT,
  is_global INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT DEFAULT 'investor',
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── APP RELEASE CENTRE ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS release_centre_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','developer','tester','release_manager')),
  is_active INTEGER DEFAULT 1,
  permissions_json TEXT DEFAULT '{}',
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES release_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_number TEXT NOT NULL,
  release_name TEXT,
  description TEXT,
  changes_json TEXT DEFAULT '[]',
  developer_id INTEGER,
  developer_name TEXT,
  test_run_id INTEGER,
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  published_status TEXT DEFAULT 'draft' CHECK (published_status IN ('draft','published','rolled_back')),
  approved_by INTEGER,
  approved_at TEXT,
  published_at TEXT,
  deployment_result TEXT,
  rollback_of INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER REFERENCES release_versions(id),
  run_by INTEGER,
  run_by_name TEXT,
  total_tests INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  warnings INTEGER DEFAULT 0,
  critical INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  environment TEXT DEFAULT 'preview',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES release_test_runs(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL,
  test_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','WARNING','NOT_TESTED')),
  message TEXT,
  duration_ms INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES release_versions(id),
  deployed_by INTEGER,
  deployed_by_name TEXT,
  environment TEXT DEFAULT 'production',
  result TEXT DEFAULT 'pending',
  log_text TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT DEFAULT 'release',
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── AI MEETING CENTRE ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting_centre_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'meeting_user' CHECK (role IN ('owner','admin','meeting_user','viewer')),
  is_active INTEGER DEFAULT 1,
  permissions_json TEXT DEFAULT '{}',
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES meeting_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_code TEXT UNIQUE,
  title TEXT NOT NULL,
  meeting_date TEXT,
  meeting_time TEXT,
  location TEXT,
  category TEXT,
  agenda TEXT,
  notes TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','recording','processing','completed','archived','cancelled')),
  organizer_id INTEGER,
  organizer_name TEXT,
  join_token TEXT,
  recording_consent INTEGER DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id INTEGER,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'participant',
  joined_at TEXT,
  left_at TEXT
);

CREATE TABLE IF NOT EXISTS meeting_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  file_path TEXT,
  mime_type TEXT DEFAULT 'audio/webm',
  size_bytes INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  storage_status TEXT DEFAULT 'stored',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  recording_id INTEGER REFERENCES meeting_recordings(id),
  content_json TEXT DEFAULT '[]',
  raw_text TEXT,
  ai_processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  content_html TEXT,
  content_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  finalized_by INTEGER,
  finalized_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_extracted_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  point_type TEXT NOT NULL,
  speaker_name TEXT,
  content TEXT NOT NULL,
  amount REAL,
  deadline TEXT,
  responsible_person TEXT,
  timestamp_ms INTEGER,
  confidence TEXT DEFAULT 'medium',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  person TEXT,
  task TEXT NOT NULL,
  deadline TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sender_name TEXT,
  message TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT DEFAULT 'meeting',
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_investors_status ON investors(status);
CREATE INDEX IF NOT EXISTS idx_investment_agreements_status ON investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_release_versions_number ON release_versions(version_number);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);
CREATE INDEX IF NOT EXISTS idx_meeting_extracted_type ON meeting_extracted_points(point_type);
