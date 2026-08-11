-- Staff login selfies + contract body templates

ALTER TABLE employee_contract_templates ADD COLUMN body_template TEXT;

CREATE TABLE IF NOT EXISTS staff_login_selfies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  photo_data TEXT NOT NULL,
  login_date TEXT NOT NULL,
  login_at TEXT DEFAULT (datetime('now')),
  device_info TEXT,
  is_edited INTEGER DEFAULT 0,
  edited_at TEXT,
  edited_by INTEGER,
  edited_by_name TEXT,
  edit_notes TEXT,
  original_photo_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_selfies_date ON staff_login_selfies(login_date DESC, employee_id);
CREATE INDEX IF NOT EXISTS idx_staff_selfies_emp ON staff_login_selfies(employee_id, login_at DESC);
