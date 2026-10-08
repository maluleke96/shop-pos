-- App Notifications, Promotions & Ratings (customer mobile channel)
-- Uses existing web_customers / customers — no separate customer DB.

CREATE TABLE IF NOT EXISTS app_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_customer_id INTEGER,
  customer_id INTEGER,
  device_token TEXT NOT NULL,
  platform TEXT DEFAULT 'web',
  device_name TEXT,
  is_active INTEGER DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_token)
);

CREATE TABLE IF NOT EXISTS app_notification_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_customer_id INTEGER,
  customer_id INTEGER,
  phone TEXT,
  special_offers INTEGER DEFAULT 1,
  loyalty_rewards INTEGER DEFAULT 1,
  new_products INTEGER DEFAULT 1,
  branch_announcements INTEGER DEFAULT 1,
  order_updates INTEGER DEFAULT 1,
  os_permission INTEGER DEFAULT 0,
  prompt_shown INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(web_customer_id)
);

CREATE TABLE IF NOT EXISTS app_promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  price REAL,
  description TEXT,
  image_url TEXT,
  branch_id INTEGER,
  branch_ids_json TEXT,
  start_date TEXT,
  end_date TEXT,
  terms TEXT,
  button_text TEXT DEFAULT 'ORDER NOW',
  destination_type TEXT DEFAULT 'product',
  destination_id TEXT,
  destination_url TEXT,
  status TEXT DEFAULT 'draft',
  show_in_promotions INTEGER DEFAULT 1,
  show_on_home INTEGER DEFAULT 0,
  show_on_branch INTEGER DEFAULT 0,
  send_push INTEGER DEFAULT 0,
  add_to_inbox INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS app_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  button_text TEXT,
  destination_type TEXT DEFAULT 'home',
  destination_id TEXT,
  destination_url TEXT,
  category TEXT DEFAULT 'special_offers',
  audience_type TEXT DEFAULT 'all_app_users',
  audience_json TEXT,
  branch_id INTEGER,
  branch_ids_json TEXT,
  promotion_id INTEGER,
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  sent_at TEXT,
  cancelled_at TEXT,
  recipients_count INTEGER DEFAULT 0,
  eligible_count INTEGER DEFAULT 0,
  excluded_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  revenue_total REAL DEFAULT 0,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  content_json TEXT
);

CREATE TABLE IF NOT EXISTS app_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_customer_id INTEGER,
  customer_id INTEGER,
  campaign_id INTEGER,
  promotion_id INTEGER,
  category TEXT DEFAULT 'special_offers',
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  button_text TEXT,
  destination_type TEXT,
  destination_id TEXT,
  destination_url TEXT,
  status TEXT DEFAULT 'sent',
  delivered_at TEXT,
  read_at TEXT,
  clicked_at TEXT,
  action_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_campaign_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  web_customer_id INTEGER,
  device_id INTEGER,
  status TEXT DEFAULT 'queued',
  error TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  order_id INTEGER,
  revenue REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  sale_id INTEGER,
  web_customer_id INTEGER,
  customer_id INTEGER,
  customer_name TEXT,
  branch_id INTEGER,
  rating INTEGER NOT NULL,
  liked_json TEXT,
  review_text TEXT,
  status TEXT DEFAULT 'pending',
  admin_reply TEXT,
  admin_reply_by INTEGER,
  admin_reply_at TEXT,
  report_count INTEGER DEFAULT 0,
  moderation_reason TEXT,
  moderated_by INTEGER,
  moderated_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  reported_by_web_customer_id INTEGER,
  reported_by_user_id INTEGER,
  reason TEXT,
  status TEXT DEFAULT 'open',
  resolved_by INTEGER,
  resolved_at TEXT,
  resolution_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  detail_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_devices_customer ON app_devices(web_customer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_app_inbox_customer ON app_inbox(web_customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_inbox_unread ON app_inbox(web_customer_id, read_at);
CREATE INDEX IF NOT EXISTS idx_app_campaigns_status ON app_campaigns(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_app_promotions_status ON app_promotions(status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_app_reviews_status ON app_reviews(status, created_at);
CREATE INDEX IF NOT EXISTS idx_app_deliveries_campaign ON app_campaign_deliveries(campaign_id, status);
