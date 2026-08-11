-- Optional extras for Railway online mode (safe to run anytime)
-- Idempotency for offline sale replay

CREATE TABLE IF NOT EXISTS rpc_idempotency (
  request_id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id
  ON sales (client_request_id)
  WHERE client_request_id IS NOT NULL;
