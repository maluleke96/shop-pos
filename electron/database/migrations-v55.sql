-- Recipe system gaps: substitutions approval workflow

CREATE TABLE IF NOT EXISTS recipe_substitutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_profile_id INTEGER REFERENCES recipe_profiles(id) ON DELETE CASCADE,
  from_product_id INTEGER NOT NULL REFERENCES products(id),
  to_product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL,
  unit TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  requested_by INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipe_subs_status ON recipe_substitutions(status);
