-- Online order → POS sale link
ALTER TABLE online_orders_local ADD COLUMN sale_id INTEGER;
ALTER TABLE online_orders_local ADD COLUMN fulfillment TEXT;
CREATE INDEX IF NOT EXISTS idx_online_orders_local_sale ON online_orders_local(sale_id);
