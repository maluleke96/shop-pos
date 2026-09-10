-- Online registration verification codes (link existing POS customers securely)

CREATE TABLE IF NOT EXISTS web_registration_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  email TEXT,
  customer_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_web_reg_codes_customer ON web_registration_codes(customer_id);
