-- Online ordering — active table on Supabase (same DB as POS / Railway RPC)
-- Replaces archived legacy_online_orders_local for new customer website flow.

CREATE TABLE IF NOT EXISTS public.online_orders_local (
  id BIGSERIAL PRIMARY KEY,
  remote_id BIGINT,
  order_number TEXT,
  branch_id BIGINT DEFAULT 1,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  customer_id BIGINT,
  web_customer_id BIGINT,
  items_json TEXT,
  subtotal DOUBLE PRECISION DEFAULT 0,
  discount DOUBLE PRECISION DEFAULT 0,
  delivery_fee DOUBLE PRECISION DEFAULT 0,
  tax_amount DOUBLE PRECISION DEFAULT 0,
  total DOUBLE PRECISION DEFAULT 0,
  coupon_code TEXT,
  loyalty_points_used DOUBLE PRECISION DEFAULT 0,
  payment_method TEXT,
  payment_status TEXT DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ,
  fulfillment_type TEXT DEFAULT 'collection',
  fulfillment TEXT,
  delivery_address TEXT,
  status TEXT DEFAULT 'pending',
  reject_reason TEXT,
  notes TEXT,
  order_source TEXT DEFAULT 'ONLINE',
  sale_id BIGINT,
  idempotency_key TEXT,
  audit_json TEXT DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_online_orders_idempotency
  ON public.online_orders_local (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_online_orders_branch_status ON public.online_orders_local (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_online_orders_web_customer ON public.online_orders_local (web_customer_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_local_sale ON public.online_orders_local (sale_id);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS order_source TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS online_enabled INTEGER DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS online_description TEXT;
ALTER TABLE public.product_modifiers ADD COLUMN IF NOT EXISTS is_required INTEGER DEFAULT 0;
ALTER TABLE public.product_modifiers ADD COLUMN IF NOT EXISTS max_select INTEGER DEFAULT 1;
ALTER TABLE public.shop_settings ADD COLUMN IF NOT EXISTS online_settings_json TEXT;

CREATE TABLE IF NOT EXISTS public.web_customers (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  profile_image TEXT,
  referral_code TEXT,
  referred_by_code TEXT,
  loyalty_points DOUBLE PRECISION DEFAULT 0,
  marketing_opt_in INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_customers_email
  ON public.web_customers (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_customers_phone
  ON public.web_customers (phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS public.web_customer_sessions (
  id BIGSERIAL PRIMARY KEY,
  web_customer_id BIGINT NOT NULL REFERENCES public.web_customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.web_customer_addresses (
  id BIGSERIAL PRIMARY KEY,
  web_customer_id BIGINT NOT NULL REFERENCES public.web_customers(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Home',
  line1 TEXT NOT NULL,
  line2 TEXT,
  suburb TEXT,
  city TEXT,
  postal_code TEXT,
  notes TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.web_customer_favorites (
  id BIGSERIAL PRIMARY KEY,
  web_customer_id BIGINT NOT NULL REFERENCES public.web_customers(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (web_customer_id, product_id, branch_id)
);

CREATE TABLE IF NOT EXISTS public.branch_online_settings (
  branch_id BIGINT PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  online_enabled INTEGER DEFAULT 1,
  delivery_enabled INTEGER DEFAULT 1,
  collection_enabled INTEGER DEFAULT 1,
  scheduled_enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'open',
  min_delivery_order DOUBLE PRECISION DEFAULT 0,
  delivery_fee DOUBLE PRECISION DEFAULT 0,
  free_delivery_above DOUBLE PRECISION DEFAULT 0,
  prep_minutes INTEGER DEFAULT 25,
  max_active_orders INTEGER DEFAULT 30,
  busy_mode INTEGER DEFAULT 0,
  opening_hours_json TEXT DEFAULT '{}',
  delivery_zones_json TEXT DEFAULT '[]',
  settings_json TEXT DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.online_order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.online_orders_local(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  actor_type TEXT,
  actor_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.web_stock_reservations (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES public.online_orders_local(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'reserved',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.web_coupon_redemptions (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES public.online_orders_local(id) ON DELETE SET NULL,
  coupon_code TEXT NOT NULL,
  web_customer_id BIGINT,
  branch_id BIGINT,
  discount_amount DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.branch_online_settings (branch_id, online_enabled, delivery_enabled, collection_enabled)
SELECT id, 1, 1, 1 FROM public.branches
ON CONFLICT (branch_id) DO NOTHING;
