-- v16: disciplinary worker responses, notification settings, quote date filters support
ALTER TABLE employee_disciplinary ADD COLUMN worker_response TEXT;
ALTER TABLE employee_disciplinary ADD COLUMN worker_response_at TEXT;
ALTER TABLE employee_disciplinary ADD COLUMN requires_response INTEGER DEFAULT 0;
ALTER TABLE employee_disciplinary ADD COLUMN status TEXT DEFAULT 'open';
ALTER TABLE shop_settings ADD COLUMN notification_settings TEXT DEFAULT '{}';
ALTER TABLE shop_settings ADD COLUMN staff_portal_settings TEXT DEFAULT '{}';
