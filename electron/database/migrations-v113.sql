-- Payroll-adjusted clock times (grace rounding vs actual punch)

ALTER TABLE employee_attendance ADD COLUMN payroll_clock_in TEXT;
ALTER TABLE employee_attendance ADD COLUMN payroll_clock_out TEXT;
