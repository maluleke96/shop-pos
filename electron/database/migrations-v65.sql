-- Marketing Agent System (standalone + admin control)

CREATE TABLE IF NOT EXISTS marketing_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  branch_id INTEGER,
  referral_code TEXT UNIQUE,
  status TEXT DEFAULT 'active',
  permissions_json TEXT DEFAULT '{}',
  targets_json TEXT DEFAULT '{}',
  device_id TEXT,
  last_activity_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS marketing_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  device_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,
  FOREIGN KEY (agent_id) REFERENCES marketing_agents(id)
);

CREATE TABLE IF NOT EXISTS marketing_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT DEFAULT 'general',
  branch_id INTEGER,
  target_value REAL DEFAULT 0,
  actual_value REAL DEFAULT 0,
  status TEXT DEFAULT 'not_started',
  due_date TEXT,
  assigned_by INTEGER,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'synced',
  uid TEXT UNIQUE,
  FOREIGN KEY (agent_id) REFERENCES marketing_agents(id)
);

CREATE TABLE IF NOT EXISTS marketing_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  customer_id INTEGER,
  agent_id INTEGER,
  full_name TEXT NOT NULL,
  phone TEXT,
  branch_id INTEGER,
  source TEXT,
  customer_type TEXT DEFAULT 'new',
  group_tag TEXT,
  marketing_consent INTEGER DEFAULT 1,
  referral_code TEXT,
  notes TEXT,
  first_purchase_at TEXT,
  conversion_status TEXT DEFAULT 'recruited',
  favourite_products_json TEXT,
  last_purchase_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,
  updated_by INTEGER,
  device_id TEXT,
  sync_status TEXT DEFAULT 'synced',
  version INTEGER DEFAULT 1,
  FOREIGN KEY (agent_id) REFERENCES marketing_agents(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS marketing_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  agent_id INTEGER NOT NULL,
  referral_code TEXT NOT NULL,
  marketing_customer_id INTEGER,
  customer_id INTEGER,
  status TEXT DEFAULT 'pending',
  first_purchase_total REAL DEFAULT 0,
  repeat_purchases INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'synced',
  FOREIGN KEY (agent_id) REFERENCES marketing_agents(id)
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  name TEXT NOT NULL,
  objective TEXT,
  start_date TEXT,
  end_date TEXT,
  branch_id INTEGER,
  agent_id INTEGER,
  products_json TEXT,
  target_group TEXT,
  offer_text TEXT,
  flyer_id INTEGER,
  menu_id INTEGER,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,
  updated_by INTEGER,
  device_id TEXT,
  sync_status TEXT DEFAULT 'synced',
  version INTEGER DEFAULT 1,
  FOREIGN KEY (agent_id) REFERENCES marketing_agents(id)
);

CREATE TABLE IF NOT EXISTS marketing_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  agent_id INTEGER,
  campaign_id INTEGER,
  template_key TEXT,
  audience_json TEXT,
  message_body TEXT NOT NULL,
  recipient_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'synced',
  FOREIGN KEY (agent_id) REFERENCES marketing_agents(id)
);

CREATE TABLE IF NOT EXISTS marketing_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  menu_number TEXT,
  title TEXT NOT NULL,
  menu_type TEXT DEFAULT 'main',
  branch_id INTEGER,
  agent_id INTEGER,
  pages_json TEXT,
  products_json TEXT,
  branding_json TEXT,
  status TEXT DEFAULT 'draft',
  approval_status TEXT DEFAULT 'draft',
  approval_notes TEXT,
  submitted_at TEXT,
  approved_by INTEGER,
  approved_at TEXT,
  price_snapshot_json TEXT,
  digital_slug TEXT,
  qr_payload TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,
  updated_by INTEGER,
  device_id TEXT,
  sync_status TEXT DEFAULT 'synced',
  version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS marketing_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  agent_id INTEGER NOT NULL,
  period_label TEXT,
  work_completed TEXT,
  customers_recruited INTEGER DEFAULT 0,
  campaigns_count INTEGER DEFAULT 0,
  flyers_count INTEGER DEFAULT 0,
  menus_count INTEGER DEFAULT 0,
  messages_count INTEGER DEFAULT 0,
  referrals_count INTEGER DEFAULT 0,
  customer_feedback TEXT,
  problems TEXT,
  recommendations TEXT,
  next_steps TEXT,
  attachments_json TEXT,
  status TEXT DEFAULT 'submitted',
  admin_response TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'synced',
  FOREIGN KEY (agent_id) REFERENCES marketing_agents(id)
);

CREATE TABLE IF NOT EXISTS marketing_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  agent_id INTEGER,
  customer_name TEXT,
  phone TEXT,
  feedback_type TEXT DEFAULT 'suggestion',
  product_request TEXT,
  notes TEXT,
  branch_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'synced'
);

CREATE TABLE IF NOT EXISTS marketing_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  title TEXT,
  file_path TEXT NOT NULL,
  media_type TEXT DEFAULT 'image',
  tags_json TEXT,
  approval_status TEXT DEFAULT 'approved',
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'synced'
);

CREATE TABLE IF NOT EXISTS marketing_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  agent_id INTEGER,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT DEFAULT 'info',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketing_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  agent_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT,
  device_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketing_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  op TEXT DEFAULT 'upsert',
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketing_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO marketing_message_templates (template_key, title, body) VALUES
('welcome', 'Welcome message', 'Hi {{name}}! Welcome to {{shop}}. Reply STOP to opt out.'),
('weekly_special', 'Weekly special', 'This week at {{shop}}: {{offer}}. Valid {{dates}}. {{branch}}'),
('weekend_special', 'Weekend special', 'Weekend specials at {{shop}}! {{offer}}. See you soon.'),
('new_customer', 'New customer', 'Thanks for joining {{shop}}, {{name}}! Show this message for a welcome treat.'),
('loyalty_reminder', 'Loyalty reminder', 'Hi {{name}}, we miss you at {{shop}}. Come back this week for {{offer}}.'),
('review_request', 'Review request', 'Hi {{name}}, how was your visit to {{shop}}? We would love your feedback.'),
('appreciation', 'Customer appreciation', 'Thank you {{name}} for supporting {{shop}}!'),
('reengagement', 'Re-engagement', 'Hi {{name}}, it has been a while. Enjoy {{offer}} at {{shop}}.'),
('referral_invite', 'Referral invitation', 'Share code {{code}} with friends and earn rewards at {{shop}}.'),
('delivery_promo', 'Delivery promotion', 'Order delivery from {{shop}}: {{offer}}. {{contact}}'),
('new_product', 'New product', 'New at {{shop}}: {{product}} for {{price}}. Try it today!');
