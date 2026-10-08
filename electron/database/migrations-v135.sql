-- Simple Phone Access: one-time codes for cellphone sign-in (customers + web_customers stay the identity tables)
CREATE TABLE IF NOT EXISTS phone_access_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  verified_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_phone_access_codes_phone ON phone_access_codes(phone);
