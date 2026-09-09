-- Panel features: rejected order tracking
ALTER TABLE public.online_orders ADD COLUMN IF NOT EXISTS rejected_by bigint;
ALTER TABLE public.online_orders ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
