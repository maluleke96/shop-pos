-- Promo channel placement: POS, Order Online, or both
ALTER TABLE public.product_promo_requests ADD COLUMN IF NOT EXISTS show_on_pos INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.product_promo_requests ADD COLUMN IF NOT EXISTS show_on_online INTEGER NOT NULL DEFAULT 1;
