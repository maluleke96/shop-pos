-- Communication Center — central notification / messaging / publishing engine
-- Reuses existing customers, staff, branches, notifications, whatsapp_* data.

CREATE TABLE IF NOT EXISTS cc_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO cc_settings (id, settings_json) VALUES (1, '{}');

CREATE TABLE IF NOT EXISTS cc_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL UNIQUE,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_ref TEXT,
  last_error TEXT,
  last_checked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS cc_event_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',
  description TEXT,
  default_channels_json TEXT NOT NULL DEFAULT '["inapp"]',
  default_recipients_json TEXT NOT NULL DEFAULT '["owner"]',
  fallback_channels_json TEXT NOT NULL DEFAULT '[]',
  is_transactional INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  source_modules_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS cc_routing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  channels_json TEXT NOT NULL DEFAULT '["whatsapp"]',
  fallback_json TEXT NOT NULL DEFAULT '[]',
  branch_scoped INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  template_id INTEGER,
  UNIQUE(event_key, recipient_type)
);

CREATE TABLE IF NOT EXISTS cc_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  channel TEXT NOT NULL DEFAULT 'any',
  subject TEXT,
  body TEXT NOT NULL,
  variables_json TEXT NOT NULL DEFAULT '[]',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cc_automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_key TEXT NOT NULL,
  condition_json TEXT NOT NULL DEFAULT '{}',
  actions_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_at TEXT,
  fire_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cc_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT,
  subject TEXT,
  media_id INTEGER,
  channels_json TEXT NOT NULL DEFAULT '["whatsapp"]',
  audience_json TEXT NOT NULL DEFAULT '{"type":"all_eligible"}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  sent_at TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cc_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT,
  event_key TEXT,
  source_module TEXT,
  channel TEXT NOT NULL,
  recipient_type TEXT,
  recipient_id INTEGER,
  recipient_name TEXT,
  recipient_address TEXT,
  branch_id INTEGER,
  subject TEXT,
  body TEXT NOT NULL,
  media_url TEXT,
  media_id INTEGER,
  template_slug TEXT,
  vars_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 50,
  scheduled_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  external_id TEXT,
  provider_meta_json TEXT,
  campaign_id INTEGER,
  automation_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  sent_at TEXT,
  delivered_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_queue_dedupe ON cc_queue(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','sent','delivered','retrying');
CREATE INDEX IF NOT EXISTS idx_cc_queue_status ON cc_queue(status, scheduled_at, priority);
CREATE INDEX IF NOT EXISTS idx_cc_queue_created ON cc_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_queue_channel ON cc_queue(channel, status);

CREATE TABLE IF NOT EXISTS cc_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',
  mime_type TEXT,
  file_path TEXT,
  public_url TEXT,
  source_module TEXT,
  source_ref TEXT,
  width INTEGER,
  height INTEGER,
  duration_sec REAL,
  bytes INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cc_branch_destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL UNIQUE,
  whatsapp_phone TEXT,
  sms_phone TEXT,
  email TEXT,
  manager_user_id INTEGER,
  notify_new_order INTEGER NOT NULL DEFAULT 1,
  notify_cancel INTEGER NOT NULL DEFAULT 1,
  notify_stock INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cc_customer_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  web_customer_id INTEGER,
  phone TEXT,
  whatsapp_marketing INTEGER NOT NULL DEFAULT 1,
  sms_marketing INTEGER NOT NULL DEFAULT 1,
  email_marketing INTEGER NOT NULL DEFAULT 1,
  promotions INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(phone)
);

CREATE TABLE IF NOT EXISTS cc_verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  phone TEXT,
  email TEXT,
  code_hash TEXT NOT NULL,
  channels_json TEXT NOT NULL DEFAULT '["whatsapp"]',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hint TEXT
);

CREATE INDEX IF NOT EXISTS idx_cc_verify_phone ON cc_verification_codes(phone, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS cc_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
