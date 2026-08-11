-- Staff / HR module
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  photo_path TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  id_number TEXT,
  date_of_birth TEXT,
  gender TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  position TEXT,
  department TEXT,
  branch TEXT,
  date_hired TEXT,
  employment_type TEXT DEFAULT 'Permanent',
  status TEXT DEFAULT 'Active',
  salary_type TEXT DEFAULT 'Monthly',
  basic_salary REAL DEFAULT 0,
  overtime_rate REAL DEFAULT 0,
  bonus REAL DEFAULT 0,
  commission REAL DEFAULT 0,
  allowances REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  pin TEXT,
  user_id INTEGER REFERENCES users(id),
  leave_annual REAL DEFAULT 15,
  leave_sick REAL DEFAULT 10,
  leave_family REAL DEFAULT 3,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  break_start TEXT,
  break_end TEXT,
  hours_worked REAL DEFAULT 0,
  late_minutes INTEGER DEFAULT 0,
  early_departure_minutes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'present',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_leave (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL DEFAULT 1,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  approved_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start TEXT,
  period_end TEXT,
  basic_salary REAL DEFAULT 0,
  overtime_pay REAL DEFAULT 0,
  bonus REAL DEFAULT 0,
  commission REAL DEFAULT 0,
  allowances REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  net_salary REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  status TEXT DEFAULT 'pending',
  paid_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type TEXT,
  file_path TEXT,
  file_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_disciplinary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  record_type TEXT,
  incident_date TEXT,
  description TEXT,
  action_taken TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_name TEXT,
  shift_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  is_rest_day INTEGER DEFAULT 0,
  branch TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employee_attendance_date ON employee_attendance(work_date, employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_leave_status ON employee_leave(status);
CREATE INDEX IF NOT EXISTS idx_employee_schedules_date ON employee_schedules(shift_date);
