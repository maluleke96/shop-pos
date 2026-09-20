CREATE TABLE IF NOT EXISTS expense_invoices (
  expense_id INTEGER PRIMARY KEY,
  mime TEXT,
  data_base64 TEXT NOT NULL
);
