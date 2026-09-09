-- Rejected online orders: track who rejected
ALTER TABLE online_orders_local ADD COLUMN rejected_by INTEGER;
ALTER TABLE online_orders_local ADD COLUMN rejected_at TEXT;
