-- Purchase VAT + POS tax display flag
ALTER TABLE purchase_orders ADD COLUMN subtotal REAL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN tax_amount REAL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN tax_rate REAL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN tax_amount REAL DEFAULT 0;
ALTER TABLE shop_settings ADD COLUMN tax_show_on_pos INTEGER DEFAULT 1;
