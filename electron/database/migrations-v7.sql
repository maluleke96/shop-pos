-- Advanced inventory & recipe management (v1.2.8)
ALTER TABLE products ADD COLUMN stock_unit_type TEXT DEFAULT 'piece';
ALTER TABLE products ADD COLUMN stock_unit TEXT DEFAULT 'each';
ALTER TABLE products ADD COLUMN purchase_unit TEXT;
ALTER TABLE products ADD COLUMN purchase_unit_qty REAL DEFAULT 1;
ALTER TABLE products ADD COLUMN purchase_unit_label TEXT;
ALTER TABLE products ADD COLUMN recipe_cost REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN food_cost_pct REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN gross_profit REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN profit_margin REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN alert_out_of_stock INTEGER DEFAULT 1;
ALTER TABLE products ADD COLUMN has_recipe INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS product_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_qty REAL NOT NULL DEFAULT 1,
  from_unit TEXT NOT NULL,
  to_qty REAL NOT NULL,
  to_unit TEXT NOT NULL,
  label TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_recipe_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'each',
  waste_pct REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_conversions_product ON product_conversions(product_id);
CREATE INDEX IF NOT EXISTS idx_product_recipe_product ON product_recipe_items(product_id);
CREATE INDEX IF NOT EXISTS idx_product_recipe_ingredient ON product_recipe_items(ingredient_product_id);
