-- Phase 4: shop entitlement assignments (Postgres additive)

CREATE TABLE IF NOT EXISTS platform_shop_assignments (
  shop_key TEXT PRIMARY KEY,
  package_id TEXT,
  notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS platform_shop_addons (
  shop_key TEXT NOT NULL,
  addon_id TEXT NOT NULL,
  PRIMARY KEY (shop_key, addon_id)
);

CREATE TABLE IF NOT EXISTS platform_shop_overrides (
  shop_key TEXT NOT NULL,
  module_id TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  PRIMARY KEY (shop_key, module_id)
);

CREATE TABLE IF NOT EXISTS platform_entitlement_cache (
  shop_key TEXT PRIMARY KEY,
  entitlements_json TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT
);
