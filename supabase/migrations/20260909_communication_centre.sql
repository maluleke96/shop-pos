-- Communication Centre (Postgres / Supabase)

CREATE TABLE IF NOT EXISTS comm_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INTEGER
);

INSERT INTO comm_settings (id, settings_json) VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS comm_providers (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push')),
  provider_key TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE,
  last_test_at TIMESTAMPTZ,
  last_test_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel, provider_key)
);

CREATE TABLE IF NOT EXISTS comm_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  category TEXT NOT NULL DEFAULT 'general',
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push','multi')),
  subject TEXT,
  body TEXT NOT NULL,
  variables_json JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  is_builtin BOOLEAN DEFAULT FALSE,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_segments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  audience_type TEXT NOT NULL DEFAULT 'all',
  audience_json JSONB,
  segment_id INTEGER REFERENCES comm_segments(id),
  channel_strategy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id INTEGER REFERENCES comm_templates(id),
  schedule_type TEXT NOT NULL DEFAULT 'immediate',
  scheduled_at TIMESTAMPTZ,
  recurrence_json JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  recipient_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  pending_count INTEGER DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  branch_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_automations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel_strategy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id INTEGER REFERENCES comm_templates(id),
  schedule_cron TEXT,
  is_active BOOLEAN DEFAULT FALSE,
  is_transactional BOOLEAN DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_automation_runs (
  id SERIAL PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES comm_automations(id),
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  matched_count INTEGER DEFAULT 0,
  queued_count INTEGER DEFAULT 0,
  error_message TEXT,
  details_json JSONB
);

CREATE TABLE IF NOT EXISTS comm_messages (
  id SERIAL PRIMARY KEY,
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
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 4,
  next_retry_at TIMESTAMPTZ,
  failure_reason TEXT,
  provider_message_id TEXT,
  provider_response_json JSONB,
  metadata_json JSONB,
  is_marketing BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_message_events (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES comm_messages(id),
  event_type TEXT NOT NULL,
  provider_event_id TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, event_type, provider_event_id)
);

CREATE TABLE IF NOT EXISTS comm_preferences (
  customer_id INTEGER PRIMARY KEY,
  sms_enabled BOOLEAN DEFAULT TRUE,
  whatsapp_enabled BOOLEAN DEFAULT TRUE,
  email_enabled BOOLEAN DEFAULT TRUE,
  push_enabled BOOLEAN DEFAULT TRUE,
  marketing_opt_in BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_devices (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER,
  user_id INTEGER,
  platform TEXT,
  device_token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_suppressions (
  id SERIAL PRIMARY KEY,
  suppression_key TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  automation_id INTEGER,
  channel TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_loyalty_lots (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  sale_id INTEGER,
  points_earned INTEGER NOT NULL,
  points_remaining INTEGER NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_jobs (
  id SERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  run_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB,
  result_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_messages_status ON comm_messages(status);
CREATE INDEX IF NOT EXISTS idx_comm_messages_customer ON comm_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_comm_messages_retry ON comm_messages(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_comm_campaigns_status ON comm_campaigns(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_comm_automations_active ON comm_automations(is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_comm_loyalty_lots_expiry ON comm_loyalty_lots(status, expires_at, customer_id);
CREATE INDEX IF NOT EXISTS idx_comm_audit_created ON comm_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_comm_jobs_run ON comm_jobs(status, run_at);
