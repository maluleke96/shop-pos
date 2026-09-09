ALTER TABLE public.delivery_driver_payouts ADD COLUMN IF NOT EXISTS delivery_count INTEGER DEFAULT 0;
ALTER TABLE public.delivery_driver_payouts ADD COLUMN IF NOT EXISTS details_json TEXT DEFAULT '[]';
