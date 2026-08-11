-- Flyer studio approval/analytics + ops product performance fields

ALTER TABLE promotion_flyers ADD COLUMN approval_status TEXT DEFAULT 'draft';
ALTER TABLE promotion_flyers ADD COLUMN approved_by INTEGER;
ALTER TABLE promotion_flyers ADD COLUMN approved_at TEXT;
ALTER TABLE promotion_flyers ADD COLUMN rejection_notes TEXT;
ALTER TABLE promotion_flyers ADD COLUMN pages_json TEXT;
ALTER TABLE promotion_flyers ADD COLUMN analytics_json TEXT;
ALTER TABLE promotion_flyers ADD COLUMN submitted_at TEXT;
