-- Marketing Command Centre (Postgres)
-- Marketing Command Centre — multi-business marketing, promotions, referral agents & commissions

CREATE TABLE IF NOT EXISTS public.mkt_businesses (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  description TEXT,
  logo_path TEXT,
  images_json TEXT DEFAULT '[]',
  contact_phone TEXT,
  contact_email TEXT,
  whatsapp_number TEXT,
  address TEXT,
  social_json TEXT DEFAULT '{}',
  operating_hours_json TEXT DEFAULT '{}',
  branding_json TEXT DEFAULT '{}',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW()),
  created_by INTEGER
);

ALTER TABLE branches ADD COLUMN IF NOT EXISTS business_id BIGINT;

CREATE TABLE IF NOT EXISTS public.mkt_promotions (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  branch_id INTEGER,
  name TEXT NOT NULL,
  promo_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL DEFAULT 0,
  buy_qty REAL DEFAULT 1,
  get_qty REAL DEFAULT 1,
  min_purchase REAL DEFAULT 0,
  max_discount REAL,
  product_ids_json TEXT DEFAULT '[]',
  branch_ids_json TEXT DEFAULT '[]',
  customer_groups_json TEXT DEFAULT '[]',
  usage_limit INTEGER,
  usage_per_customer INTEGER,
  requires_referral INTEGER DEFAULT 0,
  requires_coupon INTEGER DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'draft',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_campaigns_v2 (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT UNIQUE,
  business_id INTEGER,
  branch_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  promotion_id INTEGER,
  budget REAL DEFAULT 0,
  target_audience TEXT,
  product_ids_json TEXT DEFAULT '[]',
  channels_json TEXT DEFAULT '[]',
  commission_rule_id INTEGER,
  commission_rate REAL,
  commission_fixed REAL,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'draft',
  marketing_cost REAL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_campaign_channels (
  id BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  content TEXT,
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_social_posts (
  id BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER,
  business_id INTEGER,
  platform TEXT NOT NULL,
  caption TEXT,
  media_path TEXT,
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  expires_at TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_whatsapp_blasts (
  id BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER,
  business_id INTEGER,
  name TEXT NOT NULL,
  segment_key TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  sent_at TEXT,
  recipient_count INTEGER DEFAULT 0,
  opt_out_honored INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_customer_segments (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  rules_json TEXT DEFAULT '{}',
  is_auto INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_loyalty_rules (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  rule_type TEXT DEFAULT 'points',
  points_per_currency REAL DEFAULT 1,
  reward_threshold REAL DEFAULT 0,
  reward_description TEXT,
  tier_json TEXT DEFAULT '{}',
  birthday_reward TEXT,
  referral_bonus_points REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_loyalty_accounts (
  id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  business_id INTEGER,
  points REAL DEFAULT 0,
  tier TEXT DEFAULT 'standard',
  card_number TEXT,
  updated_at TEXT DEFAULT (NOW()),
  UNIQUE(customer_id, business_id)
);

CREATE TABLE IF NOT EXISTS public.mkt_loyalty_transactions (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  txn_type TEXT NOT NULL,
  points REAL NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_referral_agents (
  id BIGSERIAL PRIMARY KEY,
  agent_code TEXT UNIQUE,
  user_id INTEGER,
  business_id INTEGER,
  branch_id INTEGER,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  id_number TEXT,
  address TEXT,
  bank_json TEXT DEFAULT '{}',
  documents_json TEXT DEFAULT '[]',
  referral_code TEXT UNIQUE,
  referral_link TEXT,
  qr_payload TEXT,
  tier TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'pending',
  commission_rule_id INTEGER,
  application_date TEXT,
  approved_at TEXT,
  approved_by INTEGER,
  suspended_at TEXT,
  terminated_at TEXT,
  termination_reason TEXT,
  agreement_accepted INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_agent_status_history (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  actor_id INTEGER,
  actor_name TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_commission_rules (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  rule_type TEXT DEFAULT 'percent',
  percent_rate REAL DEFAULT 5,
  fixed_amount REAL DEFAULT 0,
  product_rates_json TEXT DEFAULT '{}',
  campaign_id INTEGER,
  agent_tier TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_referrals_v2 (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  customer_id INTEGER,
  marketing_customer_id INTEGER,
  campaign_id INTEGER,
  business_id INTEGER,
  branch_id INTEGER,
  referral_code TEXT,
  attribution_method TEXT,
  status TEXT DEFAULT 'registered',
  registered_at TEXT DEFAULT (NOW()),
  first_order_id INTEGER,
  first_order_total REAL DEFAULT 0,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_referral_clicks (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER,
  referral_code TEXT,
  campaign_id INTEGER,
  source TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_commissions (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  referral_id INTEGER,
  order_id INTEGER,
  sale_id INTEGER,
  campaign_id INTEGER,
  business_id INTEGER,
  branch_id INTEGER,
  sale_amount REAL DEFAULT 0,
  rate REAL DEFAULT 0,
  commission_amount REAL DEFAULT 0,
  rule_id INTEGER,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  approved_at TEXT,
  approved_by INTEGER,
  paid_at TEXT,
  reversed_at TEXT,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_commission_ledger (
  id BIGSERIAL PRIMARY KEY,
  commission_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  amount REAL,
  actor_id INTEGER,
  actor_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_agent_wallets (
  agent_id INTEGER PRIMARY KEY,
  pending REAL DEFAULT 0,
  approved REAL DEFAULT 0,
  payable REAL DEFAULT 0,
  paid REAL DEFAULT 0,
  reversed REAL DEFAULT 0,
  lifetime REAL DEFAULT 0,
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_agent_payments (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_date TEXT,
  payment_method TEXT,
  reference TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  admin_id INTEGER,
  admin_name TEXT,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_contract_templates (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  template_type TEXT DEFAULT 'general',
  body_html TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_agent_contracts (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  template_id INTEGER,
  business_id INTEGER,
  title TEXT,
  body_html TEXT,
  commission_summary TEXT,
  effective_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'draft',
  sent_at TEXT,
  accepted_at TEXT,
  signature_data TEXT,
  cancelled_at TEXT,
  terminated_at TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_agent_incentives (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  rules_json TEXT DEFAULT '{}',
  bonus_amount REAL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_qr_codes (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  branch_id INTEGER,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  label TEXT,
  payload TEXT NOT NULL,
  scan_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_coupons (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  business_id INTEGER,
  branch_id INTEGER,
  campaign_id INTEGER,
  promotion_id INTEGER,
  agent_id INTEGER,
  customer_id INTEGER,
  product_ids_json TEXT DEFAULT '[]',
  discount_type TEXT DEFAULT 'percent',
  discount_value REAL DEFAULT 0,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'generated',
  starts_at TEXT,
  expires_at TEXT,
  redeemed_at TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_calendar_events (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  branch_id INTEGER,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  start_at TEXT NOT NULL,
  end_at TEXT,
  color TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_notifications (
  id BIGSERIAL PRIMARY KEY,
  audience TEXT DEFAULT 'admin',
  agent_id INTEGER,
  user_id INTEGER,
  title TEXT NOT NULL,
  body TEXT,
  category TEXT,
  related_type TEXT,
  related_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_platform_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  previous_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS public.mkt_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_commission_percent REAL DEFAULT 5,
  auto_approve_commissions INTEGER DEFAULT 0,
  public_apply_enabled INTEGER DEFAULT 1,
  referral_base_url TEXT,
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (NOW())
);

INSERT INTO mkt_settings (id, default_commission_percent, referral_base_url) VALUES (1, 5, '/r/') ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_v2_status ON mkt_campaigns_v2(status);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_v2_biz ON mkt_campaigns_v2(business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_mkt_promotions_status ON mkt_promotions(status);
CREATE INDEX IF NOT EXISTS idx_mkt_agents_status ON mkt_referral_agents(status);
CREATE INDEX IF NOT EXISTS idx_mkt_agents_code ON mkt_referral_agents(referral_code);
CREATE INDEX IF NOT EXISTS idx_mkt_commissions_agent ON mkt_commissions(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_mkt_commissions_sale ON mkt_commissions(sale_id);
CREATE INDEX IF NOT EXISTS idx_mkt_referrals_agent ON mkt_referrals_v2(agent_id);
CREATE INDEX IF NOT EXISTS idx_mkt_coupons_code ON mkt_coupons(code);
CREATE INDEX IF NOT EXISTS idx_mkt_qr_entity ON mkt_qr_codes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);
