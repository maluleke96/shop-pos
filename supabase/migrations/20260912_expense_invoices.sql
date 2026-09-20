CREATE TABLE IF NOT EXISTS public.expense_invoices (
  expense_id INTEGER PRIMARY KEY,
  mime TEXT,
  data_base64 TEXT NOT NULL
);
