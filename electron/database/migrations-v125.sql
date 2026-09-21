-- Phase 5: Platform SaaS shop/customer records (additive, lab).
-- Does NOT provision Railway. Does NOT delete business data.

CREATE TABLE IF NOT EXISTS platform_shops (
  id TEXT PRIMARY KEY,
  shop_name TEXT NOT NULL,
  owner_name TEXT DEFAULT '',
  owner_email TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  shop_url TEXT DEFAULT '',
  railway_project_id TEXT DEFAULT '',
  railway_service_id TEXT DEFAULT '',
  railway_environment_id TEXT DEFAULT '',
  railway_deployment_id TEXT DEFAULT '',
  deployment_status TEXT DEFAULT 'not_provisioned',
  package_id TEXT,
  subscription_status TEXT DEFAULT 'TRIAL',
  trial_start TEXT,
  trial_end TEXT,
  is_active INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_shops_name ON platform_shops(shop_name);
CREATE INDEX IF NOT EXISTS idx_platform_shops_status ON platform_shops(subscription_status);
CREATE INDEX IF NOT EXISTS idx_platform_shops_email ON platform_shops(owner_email);
