-- Promo channel placement: POS, Order Online, or both
ALTER TABLE product_promo_requests ADD COLUMN show_on_pos INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_promo_requests ADD COLUMN show_on_online INTEGER NOT NULL DEFAULT 1;
