-- Ensure employee statutory registration flags exist on Postgres
ALTER TABLE employees ADD COLUMN IF NOT EXISTS paye_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uif_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sdl_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS medical_registered INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uif_number TEXT;
