-- Schema migrations — safe to re-run (ALTER ignores if column exists via app logic)

-- Categories: image support
ALTER TABLE categories ADD COLUMN image_path TEXT;

-- Products: extended fields
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN subcategory TEXT;
ALTER TABLE products ADD COLUMN supplier_id INTEGER;
ALTER TABLE products ADD COLUMN max_stock REAL;
ALTER TABLE products ADD COLUMN reorder_level REAL;
ALTER TABLE products ADD COLUMN opening_stock REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN stock_location TEXT;
ALTER TABLE products ADD COLUMN batch_number TEXT;
ALTER TABLE products ADD COLUMN expiry_date TEXT;
ALTER TABLE products ADD COLUMN item_type TEXT DEFAULT 'retail';
ALTER TABLE products ADD COLUMN is_archived INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN qr_code TEXT;

-- Shop settings: extended admin config (stored as JSON text where noted)
ALTER TABLE shop_settings ADD COLUMN email TEXT;
ALTER TABLE shop_settings ADD COLUMN website TEXT;
ALTER TABLE shop_settings ADD COLUMN vat_number TEXT;
ALTER TABLE shop_settings ADD COLUMN social_media TEXT;
ALTER TABLE shop_settings ADD COLUMN return_policy TEXT;
ALTER TABLE shop_settings ADD COLUMN thank_you_message TEXT;
ALTER TABLE shop_settings ADD COLUMN business_type TEXT DEFAULT 'retail';
ALTER TABLE shop_settings ADD COLUMN currency_name TEXT DEFAULT 'Rand';
ALTER TABLE shop_settings ADD COLUMN decimal_places INTEGER DEFAULT 2;
ALTER TABLE shop_settings ADD COLUMN thousands_sep TEXT DEFAULT ',';
ALTER TABLE shop_settings ADD COLUMN tax_inclusive INTEGER DEFAULT 0;
ALTER TABLE shop_settings ADD COLUMN printer_settings TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN receipt_design TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN security_settings TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN customization TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN device_settings TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN discount_settings TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN backup_settings TEXT DEFAULT '{}';

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  opened_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  opening_float REAL DEFAULT 0,
  closing_balance REAL DEFAULT 0,
  cash_counted REAL DEFAULT 0,
  expected_cash REAL DEFAULT 0,
  cash_difference REAL DEFAULT 0,
  total_sales REAL DEFAULT 0,
  total_cash REAL DEFAULT 0,
  total_card REAL DEFAULT 0,
  total_eft REAL DEFAULT 0,
  total_mobile REAL DEFAULT 0,
  customer_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  variant_type TEXT,
  selling_price REAL,
  barcode TEXT,
  stock_quantity REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  extra_price REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cash_drawer_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  amount REAL DEFAULT 0,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
