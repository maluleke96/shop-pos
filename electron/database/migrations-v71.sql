-- Recipe allergens, yield variance tracking
ALTER TABLE recipe_profiles ADD COLUMN allergens TEXT;
ALTER TABLE products ADD COLUMN allergens TEXT;
ALTER TABLE production_batches ADD COLUMN yield_variance_pct REAL;
ALTER TABLE production_batch_items ADD COLUMN planned_quantity REAL;
