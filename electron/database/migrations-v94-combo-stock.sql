-- Custom combo stock quantity (null = unlimited for custom; standard combos use component stock)
ALTER TABLE combos ADD COLUMN stock_quantity INTEGER;
