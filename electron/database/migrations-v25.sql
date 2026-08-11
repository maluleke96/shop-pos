-- Donations & SARS tax records (v2.3.0)

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donation_number TEXT NOT NULL UNIQUE,
  donation_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  donation_type TEXT NOT NULL DEFAULT 'Cash',
  recipient_org TEXT,
  org_reg_number TEXT,
  tax_ref_number TEXT,
  purpose TEXT,
  payment_method TEXT DEFAULT 'Cash',
  branch_id INTEGER,
  employee_id INTEGER,
  recorded_by INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  manager_approved_by INTEGER,
  manager_approved_at TEXT,
  manager_comments TEXT,
  admin_approved_by INTEGER,
  admin_approved_at TEXT,
  admin_comments TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donation_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donation_id INTEGER NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT 'receipt',
  file_name TEXT NOT NULL,
  file_data TEXT,
  file_path TEXT,
  mime_type TEXT,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_donations_date ON donations(donation_date);
CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
CREATE INDEX IF NOT EXISTS idx_donations_branch ON donations(branch_id);
CREATE INDEX IF NOT EXISTS idx_donation_docs_donation ON donation_documents(donation_id);
