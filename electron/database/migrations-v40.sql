-- Customer auto gift reward rules & grant log

CREATE TABLE IF NOT EXISTS customer_reward_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enabled INTEGER DEFAULT 1,
  spend_threshold REAL NOT NULL,
  period_days INTEGER NOT NULL DEFAULT 30,
  gift_amount REAL NOT NULL,
  gift_expiry_days INTEGER DEFAULT 365,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_reward_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER REFERENCES sales(id),
  gift_card_id INTEGER REFERENCES gift_cards(id),
  rule_id INTEGER REFERENCES customer_reward_rules(id),
  spend_total REAL,
  granted_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reward_grants_customer ON customer_reward_grants(customer_id, rule_id, granted_at);
