-- Accounting Command Centre — double-entry financial layer (v77)

CREATE TABLE IF NOT EXISTS acc_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT,
  registration_number TEXT,
  vat_number TEXT,
  tax_registered INTEGER DEFAULT 0,
  fiscal_year_start TEXT DEFAULT '03-01',
  accounting_basis TEXT DEFAULT 'accrual',
  currency TEXT DEFAULT 'R',
  invoice_prefix TEXT DEFAULT 'INV-',
  invoice_next INTEGER DEFAULT 1,
  receipt_prefix TEXT DEFAULT 'RCP-',
  receipt_next INTEGER DEFAULT 1,
  credit_note_prefix TEXT DEFAULT 'CN-',
  credit_note_next INTEGER DEFAULT 1,
  debit_note_prefix TEXT DEFAULT 'DN-',
  debit_note_next INTEGER DEFAULT 1,
  journal_prefix TEXT DEFAULT 'JE-',
  journal_next INTEGER DEFAULT 1,
  bill_prefix TEXT DEFAULT 'BILL-',
  bill_next INTEGER DEFAULT 1,
  payment_terms_days INTEGER DEFAULT 30,
  default_tax_rate_id INTEGER,
  default_ar_account_id INTEGER,
  default_ap_account_id INTEGER,
  default_sales_account_id INTEGER,
  default_cogs_account_id INTEGER,
  default_inventory_account_id INTEGER,
  default_cash_account_id INTEGER,
  default_bank_account_id INTEGER,
  default_vat_output_id INTEGER,
  default_vat_input_id INTEGER,
  approval_expense_threshold REAL DEFAULT 5000,
  approval_payment_threshold REAL DEFAULT 10000,
  two_factor_enabled INTEGER DEFAULT 0,
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO acc_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS acc_tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 0,
  tax_type TEXT DEFAULT 'vat',
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','cogs','expense')),
  subtype TEXT,
  parent_id INTEGER,
  is_system INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_accounts_type ON acc_accounts(type);
CREATE INDEX IF NOT EXISTS idx_acc_accounts_parent ON acc_accounts(parent_id);

CREATE TABLE IF NOT EXISTS acc_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at TEXT,
  closed_by INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_number TEXT NOT NULL UNIQUE,
  journal_date TEXT NOT NULL,
  journal_type TEXT DEFAULT 'general',
  description TEXT,
  reference TEXT,
  source_type TEXT,
  source_id INTEGER,
  event_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','posted','reversed')),
  total_debit REAL NOT NULL DEFAULT 0,
  total_credit REAL NOT NULL DEFAULT 0,
  branch_id INTEGER,
  business_id INTEGER,
  document_path TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  approved_by INTEGER,
  approved_by_name TEXT,
  posted_at TEXT,
  reversed_journal_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_journals_source ON acc_journals(source_type, source_id, event_key) WHERE source_type IS NOT NULL AND event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acc_journals_date ON acc_journals(journal_date);
CREATE INDEX IF NOT EXISTS idx_acc_journals_status ON acc_journals(status);

CREATE TABLE IF NOT EXISTS acc_journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER NOT NULL,
  description TEXT,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  customer_id INTEGER,
  supplier_id INTEGER,
  product_id INTEGER,
  tax_rate_id INTEGER,
  tax_amount REAL DEFAULT 0,
  FOREIGN KEY (journal_id) REFERENCES acc_journals(id),
  FOREIGN KEY (account_id) REFERENCES acc_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_acc_jlines_journal ON acc_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_acc_jlines_account ON acc_journal_lines(account_id);

CREATE TABLE IF NOT EXISTS acc_bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  account_type TEXT DEFAULT 'cheque',
  currency TEXT DEFAULT 'R',
  opening_balance REAL DEFAULT 0,
  gl_account_id INTEGER,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_bank_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL,
  txn_date TEXT NOT NULL,
  description TEXT,
  reference TEXT,
  amount REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  txn_type TEXT DEFAULT 'transfer',
  status TEXT DEFAULT 'unreconciled',
  journal_id INTEGER,
  source_type TEXT,
  source_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_bank_txns_acct ON acc_bank_txns(bank_account_id, txn_date);

CREATE TABLE IF NOT EXISTS acc_bank_stmt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL,
  statement_date TEXT,
  line_date TEXT NOT NULL,
  description TEXT,
  reference TEXT,
  amount REAL NOT NULL,
  match_status TEXT DEFAULT 'unmatched',
  matched_txn_id INTEGER,
  import_batch TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL,
  statement_date TEXT NOT NULL,
  statement_balance REAL NOT NULL DEFAULT 0,
  book_balance REAL NOT NULL DEFAULT 0,
  difference REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'in_progress',
  notes TEXT,
  completed_by INTEGER,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_cash_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gl_account_id INTEGER,
  opening_balance REAL DEFAULT 0,
  branch_id INTEGER,
  is_petty INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_cash_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_account_id INTEGER NOT NULL,
  txn_date TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  txn_type TEXT,
  journal_id INTEGER,
  reference TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  customer_name TEXT,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'draft',
  subtotal REAL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  discount_total REAL DEFAULT 0,
  total REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  payment_terms TEXT,
  notes TEXT,
  journal_id INTEGER,
  sale_id INTEGER,
  branch_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_invoices_customer ON acc_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_acc_invoices_status ON acc_invoices(status);

CREATE TABLE IF NOT EXISTS acc_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax_rate_id INTEGER,
  tax_amount REAL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS acc_credit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_note_number TEXT NOT NULL UNIQUE,
  invoice_id INTEGER,
  customer_id INTEGER,
  note_date TEXT NOT NULL,
  reason TEXT,
  total REAL NOT NULL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',
  journal_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_debit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debit_note_number TEXT NOT NULL UNIQUE,
  bill_id INTEGER,
  supplier_id INTEGER,
  note_date TEXT NOT NULL,
  reason TEXT,
  total REAL NOT NULL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',
  journal_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER,
  supplier_name TEXT,
  bill_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'draft',
  subtotal REAL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  total REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  po_id INTEGER,
  journal_id INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_bills_supplier ON acc_bills(supplier_id);

CREATE TABLE IF NOT EXISTS acc_bill_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  product_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  tax_rate_id INTEGER,
  tax_amount REAL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  is_inventory INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS acc_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_number TEXT,
  payment_date TEXT NOT NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier','other')),
  customer_id INTEGER,
  supplier_id INTEGER,
  amount REAL NOT NULL,
  payment_method TEXT DEFAULT 'eft',
  bank_account_id INTEGER,
  cash_account_id INTEGER,
  reference TEXT,
  status TEXT DEFAULT 'posted',
  journal_id INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  doc_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_number TEXT,
  sale_id INTEGER,
  invoice_id INTEGER,
  customer_id INTEGER,
  refund_date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT,
  reason TEXT,
  status TEXT DEFAULT 'posted',
  journal_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  expense_account_id INTEGER,
  payee TEXT,
  amount REAL NOT NULL,
  tax_rate_id INTEGER,
  frequency TEXT DEFAULT 'monthly',
  next_due TEXT,
  auto_post INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  last_posted TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_other_income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  income_date TEXT NOT NULL,
  income_type TEXT,
  account_id INTEGER,
  description TEXT,
  amount REAL NOT NULL,
  tax_amount REAL DEFAULT 0,
  payment_method TEXT,
  journal_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT,
  description TEXT NOT NULL,
  category TEXT,
  purchase_date TEXT,
  purchase_cost REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER,
  useful_life_months INTEGER DEFAULT 60,
  depreciation_method TEXT DEFAULT 'straight_line',
  salvage_value REAL DEFAULT 0,
  accumulated_depreciation REAL DEFAULT 0,
  book_value REAL DEFAULT 0,
  gl_asset_account_id INTEGER,
  gl_accum_account_id INTEGER,
  gl_expense_account_id INTEGER,
  disposal_date TEXT,
  disposal_value REAL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lender TEXT NOT NULL,
  principal REAL NOT NULL,
  interest_rate REAL DEFAULT 0,
  start_date TEXT,
  term_months INTEGER,
  installment_amount REAL DEFAULT 0,
  outstanding_balance REAL NOT NULL DEFAULT 0,
  gl_liability_account_id INTEGER,
  gl_interest_account_id INTEGER,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_loan_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL,
  payment_date TEXT NOT NULL,
  principal_amount REAL DEFAULT 0,
  interest_amount REAL DEFAULT 0,
  total_amount REAL NOT NULL,
  journal_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_owner_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_date TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('capital','drawing','loan_to_business','loan_to_owner')),
  amount REAL NOT NULL,
  description TEXT,
  journal_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  category TEXT,
  file_path TEXT,
  mime_type TEXT,
  linked_type TEXT,
  linked_id INTEGER,
  customer_id INTEGER,
  supplier_id INTEGER,
  ocr_json TEXT,
  ocr_status TEXT,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_docs_linked ON acc_documents(linked_type, linked_id);

CREATE TABLE IF NOT EXISTS acc_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  amount REAL,
  status TEXT DEFAULT 'pending',
  requested_by INTEGER,
  requested_by_name TEXT,
  decided_by INTEGER,
  decided_by_name TEXT,
  decided_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_approvals_status ON acc_approvals(status);

CREATE TABLE IF NOT EXISTS acc_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audience TEXT DEFAULT 'accounting',
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT DEFAULT 'info',
  link_section TEXT,
  link_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_integration_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_system TEXT NOT NULL,
  source_type TEXT,
  source_id INTEGER,
  error_message TEXT,
  payload_json TEXT,
  retry_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'failed',
  last_retry_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  previous_json TEXT,
  new_json TEXT,
  ip_info TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_audit_created ON acc_audit(created_at);

CREATE TABLE IF NOT EXISTS acc_login_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  success INTEGER DEFAULT 0,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acc_cashup_finance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cashup_id INTEGER,
  shift_id INTEGER,
  cashup_date TEXT NOT NULL,
  cashier_name TEXT,
  expected_cash REAL DEFAULT 0,
  expected_card REAL DEFAULT 0,
  expected_eft REAL DEFAULT 0,
  actual_cash REAL DEFAULT 0,
  actual_card REAL DEFAULT 0,
  actual_eft REAL DEFAULT 0,
  difference REAL DEFAULT 0,
  reason TEXT,
  approved_by INTEGER,
  approved_by_name TEXT,
  journal_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed default tax rate (SA VAT 15% — editable in settings)
INSERT OR IGNORE INTO acc_tax_rates (id, name, rate, tax_type, is_default, is_active)
VALUES (1, 'VAT Standard', 15, 'vat', 1, 1);

-- Seed Chart of Accounts
INSERT OR IGNORE INTO acc_accounts (id, code, name, type, subtype, is_system) VALUES
(1,  '1000', 'Cash on Hand', 'asset', 'cash', 1),
(2,  '1010', 'Petty Cash', 'asset', 'cash', 1),
(3,  '1100', 'Bank Account', 'asset', 'bank', 1),
(4,  '1200', 'Accounts Receivable', 'asset', 'receivable', 1),
(5,  '1300', 'Inventory', 'asset', 'inventory', 1),
(6,  '1400', 'VAT Receivable (Input)', 'asset', 'tax', 1),
(7,  '1500', 'Equipment', 'asset', 'fixed', 1),
(8,  '1510', 'Vehicles', 'asset', 'fixed', 1),
(9,  '1520', 'Furniture', 'asset', 'fixed', 1),
(10, '1530', 'Computers', 'asset', 'fixed', 1),
(11, '1590', 'Accumulated Depreciation', 'asset', 'contra_asset', 1),
(12, '2000', 'Accounts Payable', 'liability', 'payable', 1),
(13, '2100', 'VAT Payable (Output)', 'liability', 'tax', 1),
(14, '2200', 'Loans Payable', 'liability', 'loan', 1),
(15, '2300', 'Accrued Expenses', 'liability', 'accrual', 1),
(16, '2400', 'Payroll Liabilities', 'liability', 'payroll', 1),
(17, '3000', 'Owner Capital', 'equity', 'capital', 1),
(18, '3100', 'Owner Drawings', 'equity', 'drawings', 1),
(19, '3200', 'Retained Earnings', 'equity', 'retained', 1),
(20, '4000', 'Product Sales', 'income', 'sales', 1),
(21, '4010', 'Food Sales', 'income', 'sales', 1),
(22, '4100', 'Service Income', 'income', 'other', 1),
(23, '4200', 'Delivery Income', 'income', 'other', 1),
(24, '4900', 'Other Income', 'income', 'other', 1),
(25, '5000', 'Cost of Goods Sold', 'cogs', 'cogs', 1),
(26, '5010', 'Food Cost', 'cogs', 'cogs', 1),
(27, '5100', 'Direct Production Costs', 'cogs', 'cogs', 1),
(28, '6000', 'Rent', 'expense', 'operating', 1),
(29, '6010', 'Electricity', 'expense', 'operating', 1),
(30, '6020', 'Water', 'expense', 'operating', 1),
(31, '6030', 'Fuel', 'expense', 'operating', 1),
(32, '6100', 'Salaries', 'expense', 'payroll', 1),
(33, '6110', 'Wages', 'expense', 'payroll', 1),
(34, '6200', 'Advertising', 'expense', 'operating', 1),
(35, '6210', 'Internet', 'expense', 'operating', 1),
(36, '6220', 'Telephone', 'expense', 'operating', 1),
(37, '6300', 'Repairs & Maintenance', 'expense', 'operating', 1),
(38, '6400', 'Bank Charges', 'expense', 'operating', 1),
(39, '6500', 'Insurance', 'expense', 'operating', 1),
(40, '6600', 'Professional Fees', 'expense', 'operating', 1),
(41, '6700', 'Stationery', 'expense', 'operating', 1),
(42, '6800', 'Depreciation Expense', 'expense', 'operating', 1),
(43, '6900', 'Other Expenses', 'expense', 'operating', 1),
(44, '1150', 'Card Clearing', 'asset', 'clearing', 1);

UPDATE acc_settings SET
  default_tax_rate_id = 1,
  default_ar_account_id = 4,
  default_ap_account_id = 12,
  default_sales_account_id = 20,
  default_cogs_account_id = 25,
  default_inventory_account_id = 5,
  default_cash_account_id = 1,
  default_bank_account_id = 3,
  default_vat_output_id = 13,
  default_vat_input_id = 6
WHERE id = 1;

INSERT OR IGNORE INTO acc_bank_accounts (id, name, bank_name, gl_account_id, opening_balance)
VALUES (1, 'Main Business Account', 'Primary Bank', 3, 0);

INSERT OR IGNORE INTO acc_cash_accounts (id, name, gl_account_id, is_petty, opening_balance)
VALUES (1, 'Till Cash', 1, 0, 0), (2, 'Petty Cash', 2, 1, 0);

-- Current fiscal year period
INSERT OR IGNORE INTO acc_periods (id, name, start_date, end_date, status)
VALUES (1, 'Current Year', date('now','start of year'), date('now','start of year','+1 year','-1 day'), 'open');
