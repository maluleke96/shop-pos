CREATE TABLE IF NOT EXISTS customer_issue_reports (
  id SERIAL PRIMARY KEY,
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
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_issue_reports_status
  ON customer_issue_reports(status, id DESC);
