-- Communication Centre — multi-channel messaging, automation & queue

CREATE TABLE IF NOT EXISTS comm_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by INTEGER
);

INSERT OR IGNORE INTO comm_settings (id, settings_json) VALUES (1, '{}');

CREATE TABLE IF NOT EXISTS comm_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push')),
  provider_key TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  last_test_at TEXT,
  last_test_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel, provider_key)
);

CREATE TABLE IF NOT EXISTS comm_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  category TEXT NOT NULL DEFAULT 'general',
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push','multi')),
  subject TEXT,
  body TEXT NOT NULL,
  variables_json TEXT,
  is_active INTEGER DEFAULT 1,
  is_builtin INTEGER DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  rules_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','completed','paused','cancelled','failed')),
  audience_type TEXT NOT NULL DEFAULT 'all',
  audience_json TEXT,
  segment_id INTEGER REFERENCES comm_segments(id),
  channel_strategy_json TEXT NOT NULL DEFAULT '{}',
  template_id INTEGER REFERENCES comm_templates(id),
  schedule_type TEXT NOT NULL DEFAULT 'immediate' CHECK (schedule_type IN ('immediate','once','recurring','event')),
  scheduled_at TEXT,
  recurrence_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  recipient_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  pending_count INTEGER DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  branch_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config_json TEXT NOT NULL DEFAULT '{}',
  conditions_json TEXT NOT NULL DEFAULT '{}',
  audience_json TEXT NOT NULL DEFAULT '{}',
  channel_strategy_json TEXT NOT NULL DEFAULT '{}',
  template_id INTEGER REFERENCES comm_templates(id),
  schedule_cron TEXT,
  is_active INTEGER DEFAULT 0,
  is_transactional INTEGER DEFAULT 0,
  last_run_at TEXT,
  next_run_at TEXT,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES comm_automations(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','partial')),
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  matched_count INTEGER DEFAULT 0,
  queued_count INTEGER DEFAULT 0,
  error_message TEXT,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS comm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_uid TEXT UNIQUE,
  idempotency_key TEXT UNIQUE,
  customer_id INTEGER,
  campaign_id INTEGER REFERENCES comm_campaigns(id),
  automation_id INTEGER REFERENCES comm_automations(id),
  automation_run_id INTEGER REFERENCES comm_automation_runs(id),
  channel TEXT NOT NULL,
  provider_key TEXT,
  recipient_type TEXT DEFAULT 'customer',
  recipient_name TEXT,
  recipient_address TEXT NOT NULL,
  template_id INTEGER REFERENCES comm_templates(id),
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','delivered','failed','cancelled')),
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 4,
  next_retry_at TEXT,
  failure_reason TEXT,
  provider_message_id TEXT,
  provider_response_json TEXT,
  metadata_json TEXT,
  is_marketing INTEGER DEFAULT 0,
  sent_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_message_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES comm_messages(id),
  event_type TEXT NOT NULL,
  provider_event_id TEXT,
  payload_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(message_id, event_type, provider_event_id)
);

CREATE TABLE IF NOT EXISTS comm_preferences (
  customer_id INTEGER PRIMARY KEY,
  sms_enabled INTEGER DEFAULT 1,
  whatsapp_enabled INTEGER DEFAULT 1,
  email_enabled INTEGER DEFAULT 1,
  push_enabled INTEGER DEFAULT 1,
  marketing_opt_in INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  user_id INTEGER,
  platform TEXT,
  device_token TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_token)
);

CREATE TABLE IF NOT EXISTS comm_suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suppression_key TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  automation_id INTEGER,
  channel TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_loyalty_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  sale_id INTEGER,
  points_earned INTEGER NOT NULL,
  points_remaining INTEGER NOT NULL,
  earned_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','partial','expired','redeemed')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  run_at TEXT NOT NULL,
  payload_json TEXT,
  result_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comm_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comm_messages_status ON comm_messages(status);
CREATE INDEX IF NOT EXISTS idx_comm_messages_customer ON comm_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_comm_messages_campaign ON comm_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_comm_messages_retry ON comm_messages(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_comm_campaigns_status ON comm_campaigns(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_comm_automations_active ON comm_automations(is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_comm_loyalty_lots_expiry ON comm_loyalty_lots(status, expires_at, customer_id);
CREATE INDEX IF NOT EXISTS idx_comm_audit_created ON comm_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_comm_jobs_run ON comm_jobs(status, run_at);
