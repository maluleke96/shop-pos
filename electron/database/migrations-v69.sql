-- Stable business identity for update/migration (never BACKUP-AND-RESTORE / Android update safety)
ALTER TABLE shop_settings ADD COLUMN business_id TEXT;
ALTER TABLE shop_settings ADD COLUMN migration_status TEXT;
ALTER TABLE shop_settings ADD COLUMN migration_version INTEGER DEFAULT 0;
