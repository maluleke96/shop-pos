-- Expense / wastage units + expense stock effect audit (additive)

CREATE TABLE IF NOT EXISTS units_catalog (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'count',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_stock_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL,
  line_index INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  branch_id INTEGER,
  qty_original REAL NOT NULL,
  unit_original TEXT,
  qty_stock REAL NOT NULL,
  stock_unit TEXT,
  stock_movement_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(expense_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_expense_stock_expense ON expense_stock_effects(expense_id);
