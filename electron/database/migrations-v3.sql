-- v3 Audit & sales management

ALTER TABLE returns ADD COLUMN return_number TEXT;
ALTER TABLE returns ADD COLUMN approved_by INTEGER;
ALTER TABLE returns ADD COLUMN approved_by_name TEXT;
ALTER TABLE returns ADD COLUMN return_to_stock INTEGER DEFAULT 1;
ALTER TABLE returns ADD COLUMN stock_reason TEXT;
ALTER TABLE returns ADD COLUMN status TEXT DEFAULT 'completed';
ALTER TABLE returns ADD COLUMN customer_id INTEGER;
ALTER TABLE returns ADD COLUMN refund_method TEXT DEFAULT 'cash';

CREATE TABLE IF NOT EXISTS price_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  old_price REAL,
  new_price REAL NOT NULL,
  changed_by INTEGER,
  changed_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO return_counter (id, last_number) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER REFERENCES returns(id),
  sale_id INTEGER REFERENCES sales(id),
  original_product_id INTEGER,
  new_product_id INTEGER,
  original_product_name TEXT,
  new_product_name TEXT,
  price_difference REAL DEFAULT 0,
  notes TEXT,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
