-- Cash-up approval audit + waste/damage photos & approval workflow
ALTER TABLE cashup_sessions ADD COLUMN approved_by INTEGER;
ALTER TABLE cashup_sessions ADD COLUMN approved_at TEXT;
ALTER TABLE cashup_sessions ADD COLUMN approval_notes TEXT;

ALTER TABLE waste_records ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE waste_records ADD COLUMN photo_path_1 TEXT;
ALTER TABLE waste_records ADD COLUMN photo_path_2 TEXT;
ALTER TABLE waste_records ADD COLUMN approved_by INTEGER;
ALTER TABLE waste_records ADD COLUMN approved_at TEXT;
ALTER TABLE waste_records ADD COLUMN rejection_notes TEXT;

-- Existing waste already removed stock — treat as approved (no photos on legacy rows)
UPDATE waste_records SET status = 'approved' WHERE photo_path_1 IS NULL;