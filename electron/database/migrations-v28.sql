-- Flyer designer + employee payment date

ALTER TABLE employees ADD COLUMN payment_date TEXT;

CREATE TABLE IF NOT EXISTS promotion_flyers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flyer_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  promotion_name TEXT,
  branch_id INTEGER,
  start_date TEXT,
  end_date TEXT,
  flyer_size TEXT DEFAULT 'a4_portrait',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','expired','archived')),
  canvas_json TEXT,
  products_json TEXT,
  branding_json TEXT,
  apply_pos_prices INTEGER DEFAULT 0,
  original_prices_json TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flyer_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  canvas_json TEXT,
  is_builtin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flyers_status ON promotion_flyers(status, start_date);
CREATE INDEX IF NOT EXISTS idx_flyers_branch ON promotion_flyers(branch_id);
