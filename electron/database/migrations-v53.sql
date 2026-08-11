-- App display name (admin-renameable) + branding helpers
ALTER TABLE shop_settings ADD COLUMN app_display_name TEXT;

-- Employee of the month: active flag + display end date + bonus payroll month
ALTER TABLE employee_of_month ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE employee_of_month ADD COLUMN display_until TEXT;
ALTER TABLE employee_of_month ADD COLUMN bonus_payroll_month TEXT;
ALTER TABLE shop_settings ADD COLUMN eom_settings TEXT;

-- Combo approval workflow (mgr/sup create → admin approve for POS)
ALTER TABLE combos ADD COLUMN approval_status TEXT DEFAULT 'approved';
ALTER TABLE combos ADD COLUMN submitted_by INTEGER;
ALTER TABLE combos ADD COLUMN submitted_at TEXT;
ALTER TABLE combos ADD COLUMN approved_by INTEGER;
ALTER TABLE combos ADD COLUMN approved_at TEXT;
ALTER TABLE combos ADD COLUMN rejection_notes TEXT;
UPDATE combos SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = '';

-- On-account: freeze, payment period, late fee, pending approval
ALTER TABLE customers ADD COLUMN on_account_frozen INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN on_account_approved INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN on_account_period_days INTEGER;
ALTER TABLE customers ADD COLUMN on_account_due_date TEXT;
ALTER TABLE shop_settings ADD COLUMN account_settings_v2 TEXT;
