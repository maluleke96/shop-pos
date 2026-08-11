-- Optional recipe ingredients (include/skip based on POS option choices)
ALTER TABLE product_recipe_items ADD COLUMN include_rule TEXT DEFAULT 'always';
ALTER TABLE product_recipe_items ADD COLUMN option_name TEXT;
