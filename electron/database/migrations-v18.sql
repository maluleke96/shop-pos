-- Performance indexes for POS catalog queries
CREATE INDEX IF NOT EXISTS idx_product_modifiers_product ON product_modifiers(product_id);
CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(is_active, sort_order, name);
