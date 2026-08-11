-- v2.8.8: HR template keys, manager assignment for staff submissions

ALTER TABLE hr_contract_templates ADD COLUMN template_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_tpl_key ON hr_contract_templates(template_key) WHERE template_key IS NOT NULL;

ALTER TABLE hr_staff_submissions ADD COLUMN assigned_to_user_id INTEGER REFERENCES users(id);
ALTER TABLE hr_staff_submissions ADD COLUMN submitted_by INTEGER REFERENCES users(id);
ALTER TABLE hr_staff_submissions ADD COLUMN submitted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_hr_submissions_assigned ON hr_staff_submissions(assigned_to_user_id, status);
