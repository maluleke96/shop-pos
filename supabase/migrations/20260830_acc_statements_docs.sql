CREATE TABLE IF NOT EXISTS acc_statements (
  id SERIAL PRIMARY KEY,
  party_type TEXT NOT NULL,
  party_id INTEGER NOT NULL,
  party_name TEXT,
  from_date TEXT,
  to_date TEXT,
  opening_balance NUMERIC DEFAULT 0,
  closing_balance NUMERIC DEFAULT 0,
  statement_json TEXT,
  pdf_path TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_statements_party ON acc_statements(party_type, party_id, created_at DESC);

ALTER TABLE acc_documents ADD COLUMN IF NOT EXISTS document_number TEXT;
ALTER TABLE acc_documents ADD COLUMN IF NOT EXISTS issue_date TEXT;
ALTER TABLE acc_documents ADD COLUMN IF NOT EXISTS expiry_date TEXT;
ALTER TABLE acc_documents ADD COLUMN IF NOT EXISTS is_required INTEGER DEFAULT 0;
ALTER TABLE acc_documents ADD COLUMN IF NOT EXISTS employee_id INTEGER;
ALTER TABLE acc_documents ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE acc_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
