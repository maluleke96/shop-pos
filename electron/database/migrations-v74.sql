-- Recipe access scoped to branch; ensure recipe/production branch columns indexed
ALTER TABLE recipe_user_access ADD COLUMN branch_id INTEGER REFERENCES branches(id);

-- Legacy DBs may have user_version >= 54 without recipe tables (skipped v54). Ensure they exist.
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
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  production_mode TEXT NOT NULL DEFAULT 'make_to_order',
  price_mode TEXT DEFAULT 'profit_pct',
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

CREATE TABLE IF NOT EXISTS production_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_profile_id INTEGER NOT NULL REFERENCES recipe_profiles(id),
  product_id INTEGER REFERENCES products(id),
  planned_qty REAL NOT NULL DEFAULT 1,
  produced_qty REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
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

CREATE INDEX IF NOT EXISTS idx_recipe_profiles_branch ON recipe_profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_branch ON production_batches(branch_id);
CREATE INDEX IF NOT EXISTS idx_recipe_activity_branch ON recipe_activity_log(branch_id);
