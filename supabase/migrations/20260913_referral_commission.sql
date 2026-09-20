-- Referral & Commission department (live Postgres)
CREATE TABLE IF NOT EXISTS public.referral_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  default_commission_percent numeric NOT NULL DEFAULT 5,
  commission_basis text NOT NULL DEFAULT 'after_discount_ex_delivery',
  public_apply_enabled integer NOT NULL DEFAULT 1,
  pos_referral_enabled integer NOT NULL DEFAULT 1,
  payout_frequency text NOT NULL DEFAULT 'monthly',
  payout_day integer NOT NULL DEFAULT 15,
  minimum_payout numeric NOT NULL DEFAULT 100,
  auto_approve_commissions integer NOT NULL DEFAULT 0,
  settings_json text,
  updated_at text DEFAULT now()::text
);

INSERT INTO public.referral_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.referral_agents (
  id bigserial PRIMARY KEY,
  user_id bigint UNIQUE,
  full_name text NOT NULL,
  phone text,
  email text,
  address text,
  username text,
  password_hash text,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL',
  referral_code text UNIQUE,
  referral_link text,
  commission_percent numeric,
  preferred_contact text,
  other_payout_info text,
  terms_accepted_at text,
  approved_at text,
  approved_by bigint,
  rejected_at text,
  rejection_reason text,
  suspended_at text,
  created_at text DEFAULT now()::text,
  updated_at text DEFAULT now()::text
);

CREATE INDEX IF NOT EXISTS idx_referral_agents_status ON public.referral_agents(status);
CREATE INDEX IF NOT EXISTS idx_referral_agents_code ON public.referral_agents(referral_code);

CREATE TABLE IF NOT EXISTS public.referral_bank_accounts (
  id bigserial PRIMARY KEY,
  agent_id bigint NOT NULL,
  bank_name text NOT NULL,
  account_holder text NOT NULL,
  account_number text NOT NULL,
  account_type text NOT NULL DEFAULT 'cheque',
  branch_code text NOT NULL,
  is_current integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at text DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS public.referral_bank_change_requests (
  id bigserial PRIMARY KEY,
  agent_id bigint NOT NULL,
  old_bank_json text,
  new_bank_json text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  requested_at text DEFAULT now()::text,
  reviewed_at text,
  reviewed_by bigint,
  review_note text
);

CREATE TABLE IF NOT EXISTS public.referral_codes (
  id bigserial PRIMARY KEY,
  agent_id bigint NOT NULL,
  code text NOT NULL UNIQUE,
  is_primary integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  commission_percent numeric,
  customer_discount_percent numeric,
  customer_discount_amount numeric,
  usage_limit integer,
  usage_count integer NOT NULL DEFAULT 0,
  expires_at text,
  campaign_name text,
  created_at text DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS public.referral_link_clicks (
  id bigserial PRIMARY KEY,
  code text,
  agent_id bigint,
  ip_hash text,
  user_agent text,
  created_at text DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS public.referral_customer_attributions (
  id bigserial PRIMARY KEY,
  customer_id bigint UNIQUE,
  web_customer_id bigint,
  agent_id bigint NOT NULL,
  referral_code text,
  source text,
  attributed_at text DEFAULT now()::text,
  changed_by bigint,
  change_reason text
);

CREATE INDEX IF NOT EXISTS idx_referral_attr_agent ON public.referral_customer_attributions(agent_id);
CREATE INDEX IF NOT EXISTS idx_referral_attr_web ON public.referral_customer_attributions(web_customer_id);

CREATE TABLE IF NOT EXISTS public.referral_commissions (
  id bigserial PRIMARY KEY,
  agent_id bigint NOT NULL,
  customer_id bigint,
  sale_id bigint NOT NULL UNIQUE,
  order_id bigint,
  referral_code text,
  commission_percent numeric NOT NULL,
  qualifying_amount numeric NOT NULL,
  commission_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  created_at text DEFAULT now()::text,
  approved_at text,
  approved_by bigint,
  available_at text,
  paid_at text,
  payout_id bigint,
  reversal_reason text,
  reversed_at text,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_referral_comm_agent ON public.referral_commissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_referral_comm_status ON public.referral_commissions(status);

CREATE TABLE IF NOT EXISTS public.referral_commission_ledger (
  id bigserial PRIMARY KEY,
  commission_id bigint,
  agent_id bigint NOT NULL,
  entry_type text NOT NULL,
  amount numeric NOT NULL,
  note text,
  actor_id bigint,
  created_at text DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS public.referral_payouts (
  id bigserial PRIMARY KEY,
  payout_number text UNIQUE,
  period_from text,
  period_to text,
  status text NOT NULL DEFAULT 'DRAFT',
  total_amount numeric NOT NULL DEFAULT 0,
  payment_method text,
  payment_reference text,
  processed_by bigint,
  approved_by bigint,
  paid_at text,
  created_at text DEFAULT now()::text,
  notes text
);

CREATE TABLE IF NOT EXISTS public.referral_payout_items (
  id bigserial PRIMARY KEY,
  payout_id bigint NOT NULL,
  agent_id bigint NOT NULL,
  amount numeric NOT NULL,
  commission_ids_json text,
  status text NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS public.referral_audit_logs (
  id bigserial PRIMARY KEY,
  actor_id bigint,
  actor_name text,
  action text NOT NULL,
  entity_type text,
  entity_id bigint,
  before_json text,
  after_json text,
  created_at text DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS public.referral_notifications (
  id bigserial PRIMARY KEY,
  agent_id bigint,
  audience text NOT NULL DEFAULT 'agent',
  title text NOT NULL,
  message text,
  is_read integer NOT NULL DEFAULT 0,
  created_at text DEFAULT now()::text
);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS referral_agent_id bigint;
