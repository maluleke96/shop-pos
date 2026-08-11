-- v2.8.6: Per-worker checklist assignment and item status

ALTER TABLE opening_checklist_templates ADD COLUMN assigned_employee_id INTEGER REFERENCES employees(id);
ALTER TABLE closing_checklist_templates ADD COLUMN assigned_employee_id INTEGER REFERENCES employees(id);
ALTER TABLE daily_checklist_items ADD COLUMN item_status TEXT DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_opening_tpl_employee ON opening_checklist_templates(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_closing_tpl_employee ON closing_checklist_templates(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_employee ON daily_checklist_runs(employee_id, run_date, run_type);
