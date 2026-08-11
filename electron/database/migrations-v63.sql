-- v63: main recipe ingredient, POS category/product visibility, best seller flag

ALTER TABLE product_recipe_items ADD COLUMN is_primary INTEGER DEFAULT 0;

ALTER TABLE categories ADD COLUMN show_on_pos INTEGER DEFAULT 1;

ALTER TABLE products ADD COLUMN is_best_seller INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN show_on_pos INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_products_best_seller ON products(is_best_seller);
CREATE INDEX IF NOT EXISTS idx_products_show_on_pos ON products(show_on_pos);
CREATE INDEX IF NOT EXISTS idx_categories_show_on_pos ON categories(show_on_pos);
