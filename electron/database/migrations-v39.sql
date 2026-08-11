-- HR: leave proof workflow & disciplinary PDF paths

ALTER TABLE employee_leave ADD COLUMN proof_path TEXT;
ALTER TABLE employee_leave ADD COLUMN proof_submitted_at TEXT;
ALTER TABLE employee_leave ADD COLUMN proof_confirmed_by INTEGER;
ALTER TABLE employee_leave ADD COLUMN proof_confirmed_at TEXT;
ALTER TABLE employee_leave ADD COLUMN pdf_path TEXT;
ALTER TABLE employee_leave ADD COLUMN approved_at TEXT;

ALTER TABLE employee_disciplinary ADD COLUMN pdf_path TEXT;
ALTER TABLE employee_disciplinary ADD COLUMN staff_pdf_path TEXT;
ALTER TABLE employee_disciplinary ADD COLUMN whatsapp_sent_at TEXT;
