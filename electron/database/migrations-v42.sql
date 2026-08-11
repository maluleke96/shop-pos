-- v2.8.0: Restaurant order types, KDS notification sound, Employee of the Month

ALTER TABLE sales ADD COLUMN order_type TEXT;
ALTER TABLE sales ADD COLUMN table_id INTEGER;
ALTER TABLE sales ADD COLUMN table_name TEXT;

ALTER TABLE shop_settings ADD COLUMN kds_notification_sound TEXT;

CREATE TABLE IF NOT EXISTS employee_of_month (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month_year TEXT NOT NULL,
  score REAL DEFAULT 0,
  photo_path TEXT,
  bonus_amount REAL DEFAULT 0,
  certificate_path TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(month_year)
);

CREATE TABLE IF NOT EXISTS employee_of_month_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month_year TEXT NOT NULL,
  sales_score REAL DEFAULT 0,
  shift_score REAL DEFAULT 0,
  checklist_score REAL DEFAULT 0,
  attendance_score REAL DEFAULT 0,
  total_score REAL DEFAULT 0,
  UNIQUE(employee_id, month_year)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_type ON sales(order_type, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_table_id ON sales(table_id);
