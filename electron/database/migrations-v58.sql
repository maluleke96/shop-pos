-- Delivery address on sales + supplier bank/account details
ALTER TABLE sales ADD COLUMN delivery_address TEXT;
ALTER TABLE suppliers ADD COLUMN bank_name TEXT;
ALTER TABLE suppliers ADD COLUMN bank_account_name TEXT;
ALTER TABLE suppliers ADD COLUMN bank_account_number TEXT;
ALTER TABLE suppliers ADD COLUMN bank_branch_code TEXT;
