-- Combo & promotional products (v2.3.0)

CREATE TABLE IF NOT EXISTS combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_path TEXT,
  category TEXT,
  branch_id INTEGER,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  pricing_type TEXT NOT NULL DEFAULT 'fixed',
  normal_price REAL DEFAULT 0,
  discount_value REAL DEFAULT 0,
  final_price REAL DEFAULT 0,
  max_uses INTEGER,
  promo_type TEXT,
  valid_time_start TEXT,
  valid_time_end TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS combo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS combo_sale_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER NOT NULL REFERENCES combos(id),
  sale_id INTEGER REFERENCES sales(id),
  sale_item_id INTEGER,
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  total REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_combos_status ON combos(status);
CREATE INDEX IF NOT EXISTS idx_combos_branch ON combos(branch_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON combo_items(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_sale_log_combo ON combo_sale_log(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_sale_log_sale ON combo_sale_log(sale_id);

ALTER TABLE sale_items ADD COLUMN combo_id INTEGER;
