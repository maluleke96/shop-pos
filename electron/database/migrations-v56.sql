-- Production Availability Engine — cached meal capacity on products
ALTER TABLE products ADD COLUMN production_capacity REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN limiting_ingredient_id INTEGER;
ALTER TABLE products ADD COLUMN limiting_ingredient_name TEXT;
ALTER TABLE products ADD COLUMN production_oos INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN production_oos_reason TEXT;
ALTER TABLE products ADD COLUMN production_breakdown_json TEXT;
ALTER TABLE products ADD COLUMN production_capacity_updated_at TEXT;
