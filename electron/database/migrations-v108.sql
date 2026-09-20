CREATE TABLE IF NOT EXISTS customer_issue_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_customer_id INTEGER,
  order_id INTEGER,
  sale_id INTEGER,
  name TEXT,
  phone TEXT,
  message TEXT NOT NULL,
  photo_data TEXT,
  photo_name TEXT,
  status TEXT DEFAULT 'new',
  pos_cashier_name TEXT,
  pos_user_id INTEGER,
  admin_reply TEXT,
  replied_by INTEGER,
  replied_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
