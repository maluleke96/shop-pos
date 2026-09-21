-- Phase 7+: SaaS control plane (SQLite). Additive. Lab only — never Chisa.
-- New columns on platform_shops are added by platform-control-plane ensureSchema (SQLite-safe).

CREATE TABLE IF NOT EXISTS platform_contract_versions (
  id TEXT PRIMARY KEY,
  version_label TEXT NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  terms_json TEXT DEFAULT '{}',
  is_active INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS platform_contract_acceptances (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  contract_version_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  accepted_by_name TEXT,
  accepted_by_email TEXT,
  package_id TEXT,
  addon_ids_json TEXT DEFAULT '[]',
  subscription_terms_json TEXT DEFAULT '{}',
  ip_hint TEXT DEFAULT '',
  user_agent_hint TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pca_shop ON platform_contract_acceptances(shop_id);

CREATE TABLE IF NOT EXISTS platform_activations (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_hint TEXT NOT NULL,
  link_token_hash TEXT,
  expires_at TEXT NOT NULL,
  max_uses INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  created_by TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  last_used_at TEXT,
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pa_shop ON platform_activations(shop_id);
CREATE INDEX IF NOT EXISTS idx_pa_status ON platform_activations(status);

CREATE TABLE IF NOT EXISTS platform_devices (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  device_public_id TEXT NOT NULL,
  device_name TEXT DEFAULT '',
  device_type TEXT DEFAULT 'unknown',
  app_version TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  registered_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_license_ok_at TEXT,
  license_expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  meta_json TEXT DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pd_shop_device ON platform_devices(shop_id, device_public_id);
CREATE INDEX IF NOT EXISTS idx_pd_shop ON platform_devices(shop_id);

CREATE TABLE IF NOT EXISTS platform_license_leases (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_validated_at TEXT,
  nonce TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pll_shop_device ON platform_license_leases(shop_id, device_id);

CREATE TABLE IF NOT EXISTS platform_access_messages (
  id TEXT PRIMARY KEY,
  message_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  contact_label TEXT DEFAULT 'Contact Administrator',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS platform_service_fees (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  fee_type TEXT NOT NULL DEFAULT 'percent',
  percent REAL DEFAULT 0,
  fixed_amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'ZAR',
  label TEXT DEFAULT 'Platform service fee',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_psf_scope ON platform_service_fees(scope, scope_id);

CREATE TABLE IF NOT EXISTS platform_notification_rules (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  days_before INTEGER NOT NULL,
  enabled INTEGER DEFAULT 1,
  template_subject TEXT DEFAULT '',
  template_body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_notification_log (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  rule_id TEXT,
  days_before INTEGER,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT DEFAULT '{}',
  dedupe_key TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pnl_dedupe ON platform_notification_log(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_pnl_shop ON platform_notification_log(shop_id);
