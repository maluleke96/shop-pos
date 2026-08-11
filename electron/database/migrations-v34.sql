-- Shift enforcement settings (which roles must open a shift on POS)

ALTER TABLE shop_settings ADD COLUMN shift_settings TEXT DEFAULT '{}';
