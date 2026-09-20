-- Waste / damage: support company property (no stock) + optional product/ingredient
ALTER TABLE waste_records ADD COLUMN damage_kind TEXT DEFAULT 'ingredient';
ALTER TABLE waste_records ADD COLUMN property_name TEXT;
ALTER TABLE waste_records ADD COLUMN photo_image_1 TEXT;
