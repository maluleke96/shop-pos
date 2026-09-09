ALTER TABLE delivery_driver_payouts ADD COLUMN delivery_count INTEGER DEFAULT 0;
ALTER TABLE delivery_driver_payouts ADD COLUMN details_json TEXT DEFAULT '[]';
