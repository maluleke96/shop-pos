-- v4 Product options/extras + sale item modifiers

ALTER TABLE product_modifiers ADD COLUMN modifier_type TEXT DEFAULT 'extra';
ALTER TABLE sale_items ADD COLUMN item_type TEXT;
ALTER TABLE sale_items ADD COLUMN modifiers_text TEXT;
ALTER TABLE products ADD COLUMN requires_options INTEGER DEFAULT 0;
