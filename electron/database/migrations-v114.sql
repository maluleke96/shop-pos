-- Reusable ingredient mix groups (Pap, Chakalaka, Cabbage, etc.)

CREATE TABLE IF NOT EXISTS recipe_ingredient_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  default_include_rule TEXT DEFAULT 'always',
  default_option_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_ingredient_groups_name
  ON recipe_ingredient_groups(name);

CREATE TABLE IF NOT EXISTS recipe_ingredient_group_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  ingredient_product_id INTEGER NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'g',
  waste_pct REAL DEFAULT 0,
  include_rule TEXT DEFAULT 'always',
  option_name TEXT,
  is_primary INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (group_id) REFERENCES recipe_ingredient_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipe_ing_group_items_group
  ON recipe_ingredient_group_items(group_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ing_group_items_ing
  ON recipe_ingredient_group_items(ingredient_product_id);
