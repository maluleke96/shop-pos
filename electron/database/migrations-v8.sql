-- Product options: groups and display style
ALTER TABLE product_modifiers ADD COLUMN option_group TEXT;
ALTER TABLE products ADD COLUMN options_style TEXT DEFAULT 'radio';
