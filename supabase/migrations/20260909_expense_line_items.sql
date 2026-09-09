ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS line_items_json text;
