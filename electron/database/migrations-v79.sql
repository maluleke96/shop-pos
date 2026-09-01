-- v79 Customer online ordering (branch-scoped web orders)

ALTER TABLE sales ADD COLUMN order_source TEXT;
ALTER TABLE products ADD COLUMN online_enabled INTEGER DEFAULT 1;
ALTER TABLE products ADD COLUMN online_description TEXT;
ALTER TABLE product_modifiers ADD COLUMN is_required INTEGER DEFAULT 0;
ALTER TABLE product_modifiers ADD COLUMN max_select INTEGER DEFAULT 1;

ALTER TABLE online_orders_local ADD COLUMN order_source TEXT DEFAULT 'ONLINE';
ALTER TABLE online_orders_local ADD COLUMN web_customer_id INTEGER;
ALTER TABLE online_orders_local ADD COLUMN customer_email TEXT;
ALTER TABLE online_orders_local ADD COLUMN delivery_address TEXT;
ALTER TABLE online_orders_local ADD COLUMN subtotal REAL DEFAULT 0;
ALTER TABLE online_orders_local ADD COLUMN discount REAL DEFAULT 0;
ALTER TABLE online_orders_local ADD COLUMN delivery_fee REAL DEFAULT 0;
ALTER TABLE online_orders_local ADD COLUMN tax_amount REAL DEFAULT 0;
ALTER TABLE online_orders_local ADD COLUMN coupon_code TEXT;
ALTER TABLE online_orders_local ADD COLUMN loyalty_points_used REAL DEFAULT 0;
ALTER TABLE online_orders_local ADD COLUMN payment_method TEXT;
ALTER TABLE online_orders_local ADD COLUMN payment_status TEXT DEFAULT 'pending';
ALTER TABLE online_orders_local ADD COLUMN scheduled_for TEXT;
ALTER TABLE online_orders_local ADD COLUMN fulfillment_type TEXT DEFAULT 'collection';
ALTER TABLE online_orders_local ADD COLUMN reject_reason TEXT;
ALTER TABLE online_orders_local ADD COLUMN idempotency_key TEXT;
ALTER TABLE online_orders_local ADD COLUMN audit_json TEXT DEFAULT '[]';
ALTER TABLE online_orders_local ADD COLUMN customer_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_online_orders_idempotency ON online_orders_local(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_online_orders_branch_status ON online_orders_local(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_online_orders_web_customer ON online_orders_local(web_customer_id);

CREATE TABLE IF NOT EXISTS web_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  profile_image TEXT,
  referral_code TEXT,
  referred_by_code TEXT,
  loyalty_points REAL DEFAULT 0,
  marketing_opt_in INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_customers_email ON web_customers(lower(email)) WHERE email IS NOT NULL AND email != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_customers_phone ON web_customers(phone) WHERE phone IS NOT NULL AND phone != '';

CREATE TABLE IF NOT EXISTS web_customer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_customer_id INTEGER NOT NULL REFERENCES web_customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_customer_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_customer_id INTEGER NOT NULL REFERENCES web_customers(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Home',
  line1 TEXT NOT NULL,
  line2 TEXT,
  suburb TEXT,
  city TEXT,
  postal_code TEXT,
  notes TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_customer_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_customer_id INTEGER NOT NULL REFERENCES web_customers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(web_customer_id, product_id, branch_id)
);

CREATE TABLE IF NOT EXISTS branch_online_settings (
  branch_id INTEGER PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  online_enabled INTEGER DEFAULT 1,
  delivery_enabled INTEGER DEFAULT 1,
  collection_enabled INTEGER DEFAULT 1,
  scheduled_enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'open',
  min_delivery_order REAL DEFAULT 0,
  delivery_fee REAL DEFAULT 0,
  free_delivery_above REAL DEFAULT 0,
  prep_minutes INTEGER DEFAULT 25,
  max_active_orders INTEGER DEFAULT 30,
  busy_mode INTEGER DEFAULT 0,
  opening_hours_json TEXT DEFAULT '{}',
  delivery_zones_json TEXT DEFAULT '[]',
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS online_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES online_orders_local(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  actor_type TEXT,
  actor_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_stock_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES online_orders_local(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  status TEXT DEFAULT 'reserved',
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_coupon_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES online_orders_local(id) ON DELETE SET NULL,
  coupon_code TEXT NOT NULL,
  web_customer_id INTEGER,
  branch_id INTEGER,
  discount_amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed branch online settings for existing branches
INSERT OR IGNORE INTO branch_online_settings (branch_id, online_enabled, delivery_enabled, collection_enabled)
SELECT id, 1, 1, 1 FROM branches;
