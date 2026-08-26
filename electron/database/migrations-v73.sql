-- Multi-branch isolation: stock, expenses, employees, view scope, branch tax overrides
CREATE TABLE IF NOT EXISTS branch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 0,
  min_stock REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, branch_id)
);

CREATE TABLE IF NOT EXISTS branch_settings (
  branch_id INTEGER PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  tax_enabled INTEGER DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_inclusive INTEGER DEFAULT 1,
  tax_show_on_pos INTEGER DEFAULT 1,
  vat_number TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE expenses ADD COLUMN branch_id INTEGER REFERENCES branches(id);
ALTER TABLE employees ADD COLUMN branch_id INTEGER REFERENCES branches(id);
ALTER TABLE shop_settings ADD COLUMN view_branch_id INTEGER;
ALTER TABLE stock_movements ADD COLUMN branch_id INTEGER;

-- Seed branch_stock from current product quantities onto Main / active branch
INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity, min_stock)
SELECT p.id, COALESCE((SELECT branch_id FROM shop_settings WHERE id = 1), 1),
  COALESCE(p.stock_quantity, 0), COALESCE(p.min_stock, 0)
FROM products p;

UPDATE expenses SET branch_id = COALESCE((SELECT branch_id FROM shop_settings WHERE id = 1), 1)
WHERE branch_id IS NULL;
