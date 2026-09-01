-- Phase 3: delivery driver assignments
CREATE TABLE IF NOT EXISTS delivery_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  order_number TEXT,
  driver_employee_id INTEGER,
  driver_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  delivery_address TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  total REAL DEFAULT 0,
  notes TEXT,
  assigned_at TEXT,
  delivered_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_status ON delivery_assignments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_assignments_source ON delivery_assignments(source_type, source_id);
