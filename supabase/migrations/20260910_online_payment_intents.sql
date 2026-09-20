CREATE TABLE IF NOT EXISTS online_payment_intents (
  id SERIAL PRIMARY KEY,
  intent_token TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  branch_id INTEGER,
  web_customer_id INTEGER,
  payment_method TEXT,
  status TEXT DEFAULT 'pending',
  payment_reference TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_payment_intents_token ON online_payment_intents(intent_token);
