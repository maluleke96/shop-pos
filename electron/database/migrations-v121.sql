-- Discount vouchers (custom codes from Stock → Non-Selling Products Discount, usable on POS / Order Online / Kiosk)
CREATE TABLE IF NOT EXISTS discount_vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL NOT NULL DEFAULT 0,
  product_id INTEGER REFERENCES products(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  max_uses INTEGER DEFAULT 1,
  uses_count INTEGER DEFAULT 0,
  expires_at TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  last_used_channel TEXT
);

CREATE INDEX IF NOT EXISTS idx_discount_vouchers_code ON discount_vouchers(code);
CREATE INDEX IF NOT EXISTS idx_discount_vouchers_status ON discount_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_discount_vouchers_customer ON discount_vouchers(customer_id);
