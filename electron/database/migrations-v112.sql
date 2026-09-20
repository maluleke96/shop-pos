-- Recipe restock save history (admin audit + profit preview)

CREATE TABLE IF NOT EXISTS recipe_restock_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  target_meals INTEGER,
  total_spend REAL NOT NULL DEFAULT 0,
  projected_meals INTEGER,
  projected_revenue REAL,
  projected_gross_profit REAL,
  projected_net_after_buy REAL,
  line_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipe_restock_batches_created
  ON recipe_restock_batches(created_at DESC);

CREATE TABLE IF NOT EXISTS recipe_restock_batch_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  quantity_purchased REAL,
  purchase_unit TEXT,
  quantity_stock REAL,
  total_cost REAL,
  stock_after REAL,
  FOREIGN KEY (batch_id) REFERENCES recipe_restock_batches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipe_restock_batch_lines_batch
  ON recipe_restock_batch_lines(batch_id);
