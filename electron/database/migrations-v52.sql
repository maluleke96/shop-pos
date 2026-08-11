-- Order numbers on sales + counter
ALTER TABLE sales ADD COLUMN order_number TEXT;
CREATE TABLE IF NOT EXISTS order_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO order_counter (id, last_number) VALUES (1, 0);
CREATE INDEX IF NOT EXISTS idx_sales_order_number ON sales(order_number);

-- Kitchen / customer display: allow collection status
PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS kitchen_orders_v52 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL,
  sale_id INTEGER,
  table_id INTEGER,
  waiter_id INTEGER,
  station TEXT DEFAULT 'kitchen',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','collection','completed','cancelled')),
  branch_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO kitchen_orders_v52 (id, order_number, sale_id, table_id, waiter_id, station, status, branch_id, created_at, updated_at)
  SELECT id, order_number, sale_id, table_id, waiter_id, station,
    CASE WHEN status = 'done' THEN 'completed' ELSE status END,
    branch_id, created_at, updated_at
  FROM kitchen_orders;
DROP TABLE kitchen_orders;
ALTER TABLE kitchen_orders_v52 RENAME TO kitchen_orders;
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status ON kitchen_orders(status);
PRAGMA foreign_keys = ON;

-- Laybuy duration + refund fee settings
ALTER TABLE shop_settings ADD COLUMN layby_settings TEXT;
ALTER TABLE laybyes ADD COLUMN expires_at TEXT;
ALTER TABLE laybyes ADD COLUMN refund_fee REAL DEFAULT 0;
ALTER TABLE laybyes ADD COLUMN refunded_amount REAL DEFAULT 0;
ALTER TABLE laybyes ADD COLUMN cancelled_at TEXT;
