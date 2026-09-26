-- Stock Batch & Yield tracking (Expenses → Stock Batch & Yield)
CREATE TABLE IF NOT EXISTS stock_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_number TEXT NOT NULL UNIQUE,
  stock_product_id INTEGER,
  stock_product_name TEXT NOT NULL,
  selling_product_id INTEGER NOT NULL,
  selling_product_name TEXT,
  supplier_name TEXT,
  purchase_date TEXT NOT NULL,
  invoice_ref TEXT,
  quantity_purchased REAL DEFAULT 0,
  unit TEXT DEFAULT 'kg',
  purchase_cost REAL NOT NULL DEFAULT 0,
  expected_yield REAL NOT NULL DEFAULT 0,
  actual_yield REAL,
  selling_price REAL NOT NULL DEFAULT 0,
  portions_sold REAL NOT NULL DEFAULT 0,
  portions_wasted REAL NOT NULL DEFAULT 0,
  portions_adjusted REAL NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  consumed_cost REAL NOT NULL DEFAULT 0,
  branch_id INTEGER,
  branch_name TEXT,
  storage_location TEXT,
  notes TEXT,
  expense_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  fifo_rank INTEGER,
  closed_at TEXT,
  closed_by INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_batches_selling ON stock_batches(selling_product_id, status, purchase_date, id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_status ON stock_batches(status);
CREATE INDEX IF NOT EXISTS idx_stock_batches_branch ON stock_batches(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_expense ON stock_batches(expense_id);

CREATE TABLE IF NOT EXISTS stock_batch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  quantity REAL,
  sale_id INTEGER,
  sale_item_id INTEGER,
  reason TEXT,
  notes TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_batch_events_batch ON stock_batch_events(batch_id, id);

CREATE TABLE IF NOT EXISTS stock_batch_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fifo_enabled INTEGER NOT NULL DEFAULT 1,
  auto_link_expense INTEGER NOT NULL DEFAULT 1,
  near_completion_pct REAL NOT NULL DEFAULT 80,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO stock_batch_settings (id, fifo_enabled, auto_link_expense, near_completion_pct)
VALUES (1, 1, 1, 80);
