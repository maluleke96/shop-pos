-- Fix Free Table: restaurant_tables.updated_at missing on Postgres
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
