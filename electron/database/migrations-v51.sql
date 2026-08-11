-- Gift card approval workflow + auto-approve setting
ALTER TABLE gift_cards ADD COLUMN approval_status TEXT DEFAULT 'approved';
ALTER TABLE gift_cards ADD COLUMN approved_by INTEGER;
ALTER TABLE gift_cards ADD COLUMN approved_at TEXT;
ALTER TABLE shop_settings ADD COLUMN gift_card_settings TEXT;

UPDATE gift_cards SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = '';
