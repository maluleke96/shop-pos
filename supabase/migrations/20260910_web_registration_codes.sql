-- Online registration verification codes

CREATE TABLE IF NOT EXISTS web_registration_codes (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  email TEXT,
  customer_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_reg_codes_customer ON web_registration_codes(customer_id);
