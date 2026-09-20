-- Referral & Commission Department (new — v109)
-- Permanent customer→agent attribution; recurring commission on every qualifying sale.

CREATE TABLE IF NOT EXISTS referral_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_commission_percent REAL NOT NULL DEFAULT 5,
  commission_basis TEXT NOT NULL DEFAULT 'after_discount_ex_delivery',
  public_apply_enabled INTEGER NOT NULL DEFAULT 1,
  pos_referral_enabled INTEGER NOT NULL DEFAULT 1,
  payout_frequency TEXT NOT NULL DEFAULT 'monthly',
  payout_day INTEGER NOT NULL DEFAULT 15,
  minimum_payout REAL NOT NULL DEFAULT 100,
  auto_approve_commissions INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO referral_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS referral_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  username TEXT,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  referral_code TEXT UNIQUE,
  referral_link TEXT,
  commission_percent REAL,
  preferred_contact TEXT,
  other_payout_info TEXT,
  terms_accepted_at TEXT,
  approved_at TEXT,
  approved_by INTEGER,
  rejected_at TEXT,
  rejection_reason TEXT,
  suspended_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_referral_agents_status ON referral_agents(status);
CREATE INDEX IF NOT EXISTS idx_referral_agents_code ON referral_agents(referral_code);

CREATE TABLE IF NOT EXISTS referral_bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  bank_name TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'cheque',
  branch_code TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES referral_agents(id)
);

CREATE TABLE IF NOT EXISTS referral_bank_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  old_bank_json TEXT,
  new_bank_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER,
  review_note TEXT,
  FOREIGN KEY (agent_id) REFERENCES referral_agents(id)
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  commission_percent REAL,
  customer_discount_percent REAL,
  customer_discount_amount REAL,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  campaign_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES referral_agents(id)
);

CREATE TABLE IF NOT EXISTS referral_link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  agent_id INTEGER,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referral_customer_attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER UNIQUE,
  web_customer_id INTEGER,
  agent_id INTEGER NOT NULL,
  referral_code TEXT,
  source TEXT,
  attributed_at TEXT DEFAULT (datetime('now')),
  changed_by INTEGER,
  change_reason TEXT,
  FOREIGN KEY (agent_id) REFERENCES referral_agents(id)
);

CREATE INDEX IF NOT EXISTS idx_referral_attr_agent ON referral_customer_attributions(agent_id);
CREATE INDEX IF NOT EXISTS idx_referral_attr_web ON referral_customer_attributions(web_customer_id);

CREATE TABLE IF NOT EXISTS referral_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  customer_id INTEGER,
  sale_id INTEGER NOT NULL UNIQUE,
  order_id INTEGER,
  referral_code TEXT,
  commission_percent REAL NOT NULL,
  qualifying_amount REAL NOT NULL,
  commission_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by INTEGER,
  available_at TEXT,
  paid_at TEXT,
  payout_id INTEGER,
  reversal_reason TEXT,
  reversed_at TEXT,
  notes TEXT,
  FOREIGN KEY (agent_id) REFERENCES referral_agents(id)
);

CREATE INDEX IF NOT EXISTS idx_referral_comm_agent ON referral_commissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_referral_comm_status ON referral_commissions(status);

CREATE TABLE IF NOT EXISTS referral_commission_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_id INTEGER,
  agent_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  actor_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referral_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payout_number TEXT UNIQUE,
  period_from TEXT,
  period_to TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_reference TEXT,
  processed_by INTEGER,
  approved_by INTEGER,
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS referral_payout_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payout_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  commission_ids_json TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  FOREIGN KEY (payout_id) REFERENCES referral_payouts(id),
  FOREIGN KEY (agent_id) REFERENCES referral_agents(id)
);

CREATE TABLE IF NOT EXISTS referral_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referral_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER,
  audience TEXT NOT NULL DEFAULT 'agent',
  title TEXT NOT NULL,
  message TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Optional sale columns for POS/online referral tagging
-- (safe: ignored if already present on some DBs)
-- ALTER TABLE sales ADD COLUMN referral_code TEXT;
-- ALTER TABLE sales ADD COLUMN referral_agent_id INTEGER;
