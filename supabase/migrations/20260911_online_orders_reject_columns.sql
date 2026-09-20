-- Rejection audit columns for online_orders_local (Postgres / Railway)
ALTER TABLE public.online_orders_local ADD COLUMN IF NOT EXISTS rejected_by BIGINT;
ALTER TABLE public.online_orders_local ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
