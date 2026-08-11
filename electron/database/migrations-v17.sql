-- v17 Multi-branch sync & online orders

ALTER TABLE shop_settings ADD COLUMN sync_settings TEXT DEFAULT '{}';

ALTER TABLE users ADD COLUMN branch_id INTEGER;

CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  synced_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS online_orders_local (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id INTEGER,
  order_number TEXT,
  branch_id INTEGER DEFAULT 1,
  customer_name TEXT,
  customer_phone TEXT,
  items_json TEXT,
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
