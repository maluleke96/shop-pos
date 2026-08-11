-- Marketing flyer campaigns: goals, go-live modes, brand kit

ALTER TABLE promotion_flyers ADD COLUMN campaign_goal TEXT DEFAULT 'all';
ALTER TABLE promotion_flyers ADD COLUMN go_live_mode TEXT DEFAULT 'both';
ALTER TABLE promotion_flyers ADD COLUMN auto_go_live INTEGER DEFAULT 1;
ALTER TABLE promotion_flyers ADD COLUMN ended_at TEXT;
ALTER TABLE promotion_flyers ADD COLUMN live_at TEXT;

ALTER TABLE shop_settings ADD COLUMN marketing_brand_kit TEXT DEFAULT '{}';
