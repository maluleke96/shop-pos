-- Backdated / Missed Order Recovery
-- sale_datetime = business sale time; created_at = entry/sync time (immutable)

ALTER TABLE sales ADD COLUMN sale_datetime TEXT;
ALTER TABLE sales ADD COLUMN is_backdated INTEGER DEFAULT 0;
ALTER TABLE sales ADD COLUMN backdated_reason TEXT;
ALTER TABLE sales ADD COLUMN entered_by_user_id INTEGER;
ALTER TABLE sales ADD COLUMN authorized_by_user_id INTEGER;
ALTER TABLE sales ADD COLUMN authorized_at TEXT;
ALTER TABLE sales ADD COLUMN pos_terminal_id TEXT;
ALTER TABLE sales ADD COLUMN backdated_correction_of INTEGER;

UPDATE sales SET sale_datetime = created_at WHERE sale_datetime IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_sale_datetime ON sales(sale_datetime);
CREATE INDEX IF NOT EXISTS idx_sales_backdated_entered ON sales(is_backdated, created_at);
