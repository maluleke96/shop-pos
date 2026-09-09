PRAGMA foreign_keys=OFF;
CREATE TABLE expenses_v101 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  user_id INTEGER REFERENCES users(id),
  expense_date TEXT DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now')),
  branch_id INTEGER,
  invoice_path TEXT,
  line_items_json TEXT
);
INSERT INTO expenses_v101 (id, category, description, amount, user_id, expense_date, created_at, branch_id, invoice_path, line_items_json)
  SELECT id, category, description, amount, user_id, expense_date, created_at, branch_id, invoice_path, line_items_json FROM expenses;
DROP TABLE expenses;
ALTER TABLE expenses_v101 RENAME TO expenses;
PRAGMA foreign_keys=ON;
