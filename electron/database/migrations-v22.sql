-- Attendance-based payroll: employee work settings + payroll detail columns

ALTER TABLE employees ADD COLUMN work_schedule TEXT;

ALTER TABLE employee_attendance ADD COLUMN overtime_minutes INTEGER DEFAULT 0;
ALTER TABLE employee_attendance ADD COLUMN break_minutes INTEGER DEFAULT 0;
ALTER TABLE employee_attendance ADD COLUMN scheduled_hours REAL DEFAULT 0;
ALTER TABLE employee_attendance ADD COLUMN deduction_amount REAL DEFAULT 0;
ALTER TABLE employee_attendance ADD COLUMN is_paid_absence INTEGER DEFAULT 1;
ALTER TABLE employee_attendance ADD COLUMN edited_by INTEGER;
ALTER TABLE employee_attendance ADD COLUMN edited_at TEXT;

ALTER TABLE employee_payroll ADD COLUMN scheduled_hours REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN hours_worked REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN hours_missed REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN late_minutes INTEGER DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN overtime_hours REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN attendance_deductions REAL DEFAULT 0;
ALTER TABLE employee_payroll ADD COLUMN attendance_json TEXT;

CREATE TABLE IF NOT EXISTS employee_hr_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  html_content TEXT,
  incident_date TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_documents_emp ON employee_hr_documents(employee_id, created_at DESC);
