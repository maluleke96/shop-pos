-- Waste / damage: support company property (no stock) + optional product/ingredient
ALTER TABLE waste_records ADD COLUMN IF NOT EXISTS damage_kind TEXT DEFAULT 'ingredient';
ALTER TABLE waste_records ADD COLUMN IF NOT EXISTS property_name TEXT;
ALTER TABLE waste_records ADD COLUMN IF NOT EXISTS photo_image_1 TEXT;

-- Allow property damage without a product (Postgres)
DO $$
BEGIN
  ALTER TABLE waste_records ALTER COLUMN product_id DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;
