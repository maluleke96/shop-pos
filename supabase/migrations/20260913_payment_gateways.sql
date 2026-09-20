-- Payment gateways (provider-independent) + transaction log + webhook idempotency
CREATE TABLE IF NOT EXISTS payment_gateways (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  test_mode INTEGER NOT NULL DEFAULT 1,
  public_key TEXT,
  secret_key_enc TEXT,
  webhook_secret_enc TEXT,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  webhook_id TEXT,
  last_successful_connection_at TIMESTAMPTZ,
  last_webhook_at TIMESTAMPTZ,
  last_error TEXT,
  status_message TEXT,
  extra_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id SERIAL PRIMARY KEY,
  order_id INTEGER,
  order_number TEXT,
  customer_name TEXT,
  customer_email TEXT,
  web_customer_id INTEGER,
  branch_id INTEGER,
  gateway_provider TEXT NOT NULL,
  gateway_checkout_id TEXT,
  gateway_payment_id TEXT,
  gateway_transaction_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'PENDING',
  refund_status TEXT,
  refunded_amount REAL DEFAULT 0,
  failure_reason TEXT,
  idempotency_key TEXT,
  metadata_json TEXT,
  gateway_response_json TEXT,
  accounting_posted INTEGER NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload_json TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_pay_txn_order ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_pay_txn_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pay_txn_gateway_checkout ON payment_transactions(gateway_checkout_id);
CREATE INDEX IF NOT EXISTS idx_pay_txn_gateway_payment ON payment_transactions(gateway_payment_id);

INSERT INTO payment_gateways (provider, name, enabled, test_mode, currency, status_message)
VALUES ('yoco', 'Yoco', 0, 1, 'ZAR', 'Not configured')
ON CONFLICT (provider) DO NOTHING;
