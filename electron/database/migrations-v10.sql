-- Payment settings persistence + on-account rules
ALTER TABLE shop_settings ADD COLUMN payment_settings TEXT;
ALTER TABLE shop_settings ADD COLUMN account_settings TEXT;
ALTER TABLE customers ADD COLUMN allow_on_account INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN credit_limit REAL;
