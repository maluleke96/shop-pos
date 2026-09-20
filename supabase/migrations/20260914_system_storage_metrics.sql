-- System Health: Database & Storage historical metrics (monitoring only — no business data)
CREATE TABLE IF NOT EXISTS system_storage_metrics (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  database_size_bytes BIGINT,
  volume_used_bytes BIGINT,
  volume_total_bytes BIGINT,
  table_count INTEGER,
  index_size_bytes BIGINT,
  toast_size_bytes BIGINT,
  engine TEXT,
  database_name TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_storage_metrics_recorded
  ON system_storage_metrics (recorded_at DESC);
