-- v2.7.5: Quote expiry, employee tax registration flags, quote status expansion

ALTER TABLE shop_settings ADD COLUMN quote_expiry_hours INTEGER DEFAULT 168;
ALTER TABLE shop_settings ADD COLUMN quote_expiry_unit TEXT DEFAULT 'hours';

ALTER TABLE quotes ADD COLUMN expires_at TEXT;

ALTER TABLE employees ADD COLUMN paye_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN uif_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN pension_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN medical_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN sdl_registered INTEGER DEFAULT 0;

PRAGMA foreign_keys=off;

CREATE TABLE quotes_v41 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id),
  branch_id INTEGER DEFAULT 1,
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','converted','expired','cancelled','held_admin')),
  valid_until TEXT,
  expires_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  converted_sale_id INTEGER
);

INSERT INTO quotes_v41 (id, quote_number, customer_id, user_id, branch_id, subtotal, discount, tax_amount, total, status, valid_until, expires_at, notes, created_at, converted_sale_id)
SELECT id, quote_number, customer_id, user_id, branch_id, subtotal, discount, tax_amount, total, status, valid_until, expires_at, notes, created_at, converted_sale_id FROM quotes;

DROP TABLE quotes;
ALTER TABLE quotes_v41 RENAME TO quotes;

PRAGMA foreign_keys=on;

CREATE INDEX IF NOT EXISTS idx_quotes_status_expires ON quotes(status, expires_at);
