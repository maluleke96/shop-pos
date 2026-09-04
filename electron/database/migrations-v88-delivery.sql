-- Delivery confirmation codes, pickup-at-store, sales delivery fee

ALTER TABLE delivery_assignments ADD COLUMN confirmation_code TEXT;
ALTER TABLE delivery_assignments ADD COLUMN pickup_at_store INTEGER DEFAULT 0;
ALTER TABLE delivery_assignments ADD COLUMN source_label TEXT;

ALTER TABLE sales ADD COLUMN delivery_fee REAL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_confirm ON delivery_assignments(confirmation_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_assignments_confirm_uq ON delivery_assignments(confirmation_code) WHERE confirmation_code IS NOT NULL;
