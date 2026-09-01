-- Statement history + document metadata enhancements

CREATE TABLE IF NOT EXISTS acc_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type TEXT NOT NULL,
  party_id INTEGER NOT NULL,
  party_name TEXT,
  from_date TEXT,
  to_date TEXT,
  opening_balance REAL DEFAULT 0,
  closing_balance REAL DEFAULT 0,
  statement_json TEXT,
  pdf_path TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_statements_party ON acc_statements(party_type, party_id, created_at);

ALTER TABLE acc_documents ADD COLUMN document_number TEXT;
ALTER TABLE acc_documents ADD COLUMN issue_date TEXT;
ALTER TABLE acc_documents ADD COLUMN expiry_date TEXT;
ALTER TABLE acc_documents ADD COLUMN is_required INTEGER DEFAULT 0;
ALTER TABLE acc_documents ADD COLUMN employee_id INTEGER;
ALTER TABLE acc_documents ADD COLUMN file_size INTEGER;
ALTER TABLE acc_documents ADD COLUMN updated_at TEXT;
