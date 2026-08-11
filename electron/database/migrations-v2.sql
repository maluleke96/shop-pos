-- v2 Professional POS features — safe to re-run

ALTER TABLE shop_settings ADD COLUMN branch_id INTEGER DEFAULT 1;
ALTER TABLE shop_settings ADD COLUMN date_format TEXT DEFAULT 'DD/MM/YYYY';
ALTER TABLE shop_settings ADD COLUMN time_format TEXT DEFAULT '24h';
ALTER TABLE shop_settings ADD COLUMN invoice_prefix TEXT DEFAULT 'INV';
ALTER TABLE shop_settings ADD COLUMN quote_prefix TEXT DEFAULT 'QT';
ALTER TABLE shop_settings ADD COLUMN automation_settings TEXT DEFAULT '[]';
ALTER TABLE shop_settings ADD COLUMN format_settings TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN license_settings TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN scanner_settings TEXT DEFAULT '{}';

ALTER TABLE sales ADD COLUMN branch_id INTEGER DEFAULT 1;
ALTER TABLE sales ADD COLUMN device_id TEXT;
ALTER TABLE sales ADD COLUMN status TEXT DEFAULT 'completed';
ALTER TABLE sales ADD COLUMN void_reason TEXT;

ALTER TABLE products ADD COLUMN branch_id INTEGER DEFAULT 1;
ALTER TABLE stock_movements ADD COLUMN branch_id INTEGER DEFAULT 1;
ALTER TABLE shifts ADD COLUMN branch_id INTEGER DEFAULT 1;
ALTER TABLE customers ADD COLUMN loyalty_points REAL DEFAULT 0;
ALTER TABLE customers ADD COLUMN is_vip INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN birthday TEXT;
ALTER TABLE held_orders ADD COLUMN branch_id INTEGER DEFAULT 1;
ALTER TABLE held_orders ADD COLUMN customer_id INTEGER;
ALTER TABLE held_orders ADD COLUMN label TEXT;

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  address TEXT,
  phone TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO branches (id, name, code) VALUES (1, 'Main Branch', 'MAIN');

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id),
  branch_id INTEGER DEFAULT 1,
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','converted','expired','cancelled')),
  valid_until TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  converted_sale_id INTEGER
);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  discount REAL DEFAULT 0,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS laybyes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layby_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id),
  branch_id INTEGER DEFAULT 1,
  total REAL NOT NULL,
  amount_paid REAL DEFAULT 0,
  balance REAL NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS layby_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layby_id INTEGER NOT NULL REFERENCES laybyes(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS layby_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layby_id INTEGER NOT NULL REFERENCES laybyes(id),
  amount REAL NOT NULL,
  payment_type TEXT DEFAULT 'cash',
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gift_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  initial_balance REAL NOT NULL,
  balance REAL NOT NULL,
  customer_id INTEGER,
  branch_id INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','redeemed','expired','cancelled')),
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id),
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('issue','redeem','reload')),
  sale_id INTEGER,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  points REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn','redeem','birthday','adjust')),
  sale_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('charge','payment','adjust')),
  balance_after REAL NOT NULL,
  sale_id INTEGER,
  notes TEXT,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_number TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  branch_id INTEGER DEFAULT 1,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  system_qty REAL NOT NULL,
  counted_qty REAL NOT NULL,
  difference REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS waste_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  reason TEXT NOT NULL,
  employee_id INTEGER,
  branch_id INTEGER DEFAULT 1,
  notes TEXT,
  cost_value REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  condition_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT DEFAULT 'text',
  options_json TEXT DEFAULT '[]',
  is_required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_number TEXT NOT NULL,
  seats INTEGER DEFAULT 4,
  status TEXT DEFAULT 'available' CHECK (status IN ('available','occupied','reserved','merged')),
  waiter_id INTEGER,
  branch_id INTEGER DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS kitchen_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL,
  sale_id INTEGER,
  table_id INTEGER,
  waiter_id INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','completed','cancelled')),
  station TEXT DEFAULT 'kitchen',
  branch_id INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kitchen_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kitchen_order_id INTEGER NOT NULL REFERENCES kitchen_orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  modifiers TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS po_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  user_id INTEGER,
  received_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS po_receipt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
  po_item_id INTEGER NOT NULL,
  product_id INTEGER,
  quantity_received REAL NOT NULL,
  quantity_backordered REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT DEFAULT 'info',
  source TEXT,
  message TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS archived_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  archived_data TEXT,
  archived_at TEXT DEFAULT (datetime('now')),
  user_id INTEGER
);

CREATE TABLE IF NOT EXISTS cashup_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER REFERENCES shifts(id),
  user_id INTEGER,
  branch_id INTEGER DEFAULT 1,
  opening_cash REAL DEFAULT 0,
  cash_sales REAL DEFAULT 0,
  card_sales REAL DEFAULT 0,
  eft_sales REAL DEFAULT 0,
  mobile_sales REAL DEFAULT 0,
  expenses REAL DEFAULT 0,
  refunds REAL DEFAULT 0,
  expected_cash REAL DEFAULT 0,
  actual_cash REAL DEFAULT 0,
  difference REAL DEFAULT 0,
  manager_approved INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE purchase_order_items ADD COLUMN received_qty REAL DEFAULT 0;

CREATE TABLE IF NOT EXISTS quote_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO quote_counter (id, last_number) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS layby_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO layby_counter (id, last_number) VALUES (1, 0);
