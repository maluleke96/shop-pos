-- Offline / retry idempotency for attendance clock actions (safe additive column)
ALTER TABLE employee_attendance ADD COLUMN client_request_id TEXT;
