-- Notification navigation fields (entity link + action page)

ALTER TABLE notifications ADD COLUMN entity_type TEXT;
ALTER TABLE notifications ADD COLUMN entity_id INTEGER;
ALTER TABLE notifications ADD COLUMN action_page TEXT;
