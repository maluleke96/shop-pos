-- v61: Attendance shift gating, auto-close, admin entries, clock-out penalties

ALTER TABLE employee_attendance ADD COLUMN auto_closed INTEGER DEFAULT 0;
ALTER TABLE employee_attendance ADD COLUMN admin_entered INTEGER DEFAULT 0;
ALTER TABLE employee_attendance ADD COLUMN created_by INTEGER;
ALTER TABLE employee_attendance ADD COLUMN created_by_name TEXT;

CREATE TABLE IF NOT EXISTS attendance_penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_id INTEGER REFERENCES employee_attendance(id) ON DELETE SET NULL,
  work_date TEXT,
  penalty_type TEXT NOT NULL CHECK (penalty_type IN ('money', 'hours')),
  amount REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_by_name TEXT,
  applied_payroll_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_penalties_emp ON attendance_penalties(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_attendance_open ON employee_attendance(work_date, clock_out);
