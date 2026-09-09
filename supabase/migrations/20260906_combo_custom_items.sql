-- Custom combos: nullable product_id, item fields, combo stock & visibility (Postgres / Supabase)

ALTER TABLE public."combo_items" ALTER COLUMN "product_id" DROP NOT NULL;

ALTER TABLE public."combo_items" ADD COLUMN IF NOT EXISTS "custom_name" text;
ALTER TABLE public."combo_items" ADD COLUMN IF NOT EXISTS "custom_image_path" text;
ALTER TABLE public."combo_items" ADD COLUMN IF NOT EXISTS "allow_pap_choice" integer DEFAULT 0;

ALTER TABLE public."combos" ADD COLUMN IF NOT EXISTS "combo_kind" text DEFAULT 'standard';
ALTER TABLE public."combos" ADD COLUMN IF NOT EXISTS "gallery_paths" text;
ALTER TABLE public."combos" ADD COLUMN IF NOT EXISTS "stock_quantity" integer;
ALTER TABLE public."combos" ADD COLUMN IF NOT EXISTS "show_on_pos" integer DEFAULT 1;
ALTER TABLE public."combos" ADD COLUMN IF NOT EXISTS "show_on_online" integer DEFAULT 1;
