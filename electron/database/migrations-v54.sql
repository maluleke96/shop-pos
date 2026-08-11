-- Recipe & Production Management System (v2.9.12+)

ALTER TABLE products ADD COLUMN is_new_arrival INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN new_arrival_until TEXT;
ALTER TABLE products ADD COLUMN menu_flags TEXT;
ALTER TABLE products ADD COLUMN production_mode TEXT DEFAULT 'make_to_order';
ALTER TABLE products ADD COLUMN available_today INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS recipe_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  prep_time_minutes INTEGER DEFAULT 0,
  cook_time_minutes INTEGER DEFAULT 0,
  serving_size REAL DEFAULT 1,
  yield_qty REAL DEFAULT 1,
  yield_unit TEXT DEFAULT 'portion',
  image_path TEXT,
  instructions TEXT,
  video_url TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','approved','rejected','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  production_mode TEXT NOT NULL DEFAULT 'make_to_order'
    CHECK (production_mode IN ('make_to_order','make_to_stock')),
  price_mode TEXT DEFAULT 'profit_pct'
    CHECK (price_mode IN ('profit_pct','markup_pct','gross_margin','manual')),
  target_profit_pct REAL DEFAULT 40,
  suggested_price REAL DEFAULT 0,
  override_price REAL,
  selling_price REAL DEFAULT 0,
  recipe_cost REAL DEFAULT 0,
  food_cost_pct REAL DEFAULT 0,
  gross_profit REAL DEFAULT 0,
  profit_margin REAL DEFAULT 0,
  available_today INTEGER DEFAULT 0,
  new_arrival_days INTEGER DEFAULT 14,
  new_arrival_until TEXT,
  branch_id INTEGER,
  rejection_notes TEXT,
  created_by INTEGER,
  updated_by INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_profile_id INTEGER NOT NULL REFERENCES recipe_profiles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  recipe_cost REAL,
  selling_price REAL,
  changed_by INTEGER,
  change_notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_user_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  recipe_role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (recipe_role IN ('administrator','production_manager','kitchen_manager','supervisor','viewer')),
  enabled INTEGER NOT NULL DEFAULT 1,
  granted_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS production_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_profile_id INTEGER NOT NULL REFERENCES recipe_profiles(id),
  product_id INTEGER REFERENCES products(id),
  planned_qty REAL NOT NULL DEFAULT 1,
  produced_qty REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','completed','cancelled')),
  production_cost REAL DEFAULT 0,
  limiting_ingredient TEXT,
  max_capacity REAL,
  notes TEXT,
  branch_id INTEGER,
  created_by INTEGER,
  completed_by INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS production_batch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  ingredient_product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit TEXT,
  unit_cost REAL DEFAULT 0,
  line_cost REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipe_waste_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waste_type TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id),
  recipe_profile_id INTEGER REFERENCES recipe_profiles(id),
  quantity REAL NOT NULL,
  unit TEXT,
  cost REAL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  recorded_by INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  branch_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  promo_type TEXT NOT NULL
    CHECK (promo_type IN ('percent','fixed','combo','bogo','happy_hour','weekend','holiday','flash','limited')),
  discount_value REAL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  product_ids_json TEXT,
  recipe_ids_json TEXT,
  branch_ids_json TEXT,
  customer_groups_json TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','ended','cancelled')),
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  branch_id INTEGER,
  device_id TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipe_profiles_status ON recipe_profiles(status);
CREATE INDEX IF NOT EXISTS idx_recipe_profiles_product ON recipe_profiles(product_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_date ON production_batches(created_at);
CREATE INDEX IF NOT EXISTS idx_recipe_waste_status ON recipe_waste_logs(status);
CREATE INDEX IF NOT EXISTS idx_recipe_activity_created ON recipe_activity_log(created_at);
