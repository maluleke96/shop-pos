-- Platform Control packages (Postgres) — Phase 3 additive schema for saas-lab
-- Does not touch existing shop business tables.

CREATE TABLE IF NOT EXISTS platform_modules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  commercial_class TEXT NOT NULL DEFAULT 'sellable',
  sellable_addon INTEGER NOT NULL DEFAULT 0,
  default_status TEXT DEFAULT 'enabled_in_full_product',
  admin_menu TEXT,
  appears_in_json TEXT DEFAULT '[]',
  dependencies_json TEXT DEFAULT '[]',
  related_apis_json TEXT DEFAULT '[]',
  related_jobs_json TEXT DEFAULT '[]',
  database_tables_json TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  catalog_source TEXT DEFAULT 'MODULE-CATALOG',
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'ZAR',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_package_items (
  package_id TEXT NOT NULL REFERENCES platform_packages(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  PRIMARY KEY (package_id, module_id)
);

CREATE TABLE IF NOT EXISTS platform_addons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'ZAR',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_addon_items (
  addon_id TEXT NOT NULL REFERENCES platform_addons(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  PRIMARY KEY (addon_id, module_id)
);

CREATE TABLE IF NOT EXISTS platform_owners (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT DEFAULT 'Platform Owner',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id SERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
