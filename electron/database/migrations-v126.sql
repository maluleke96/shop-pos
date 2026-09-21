-- Phase 6: provisioning jobs + status fields (additive, lab). Never deletes business data.

CREATE TABLE IF NOT EXISTS platform_provision_jobs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_json TEXT,
  result_json TEXT,
  error_safe TEXT DEFAULT '',
  dry_run INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_provision_jobs_shop ON platform_provision_jobs(shop_id);
CREATE INDEX IF NOT EXISTS idx_platform_provision_jobs_status ON platform_provision_jobs(status);
