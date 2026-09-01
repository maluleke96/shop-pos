-- Delivery Department — drivers, orders, settings, tracking (SQLite)

CREATE TABLE IF NOT EXISTS delivery_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  department_mode TEXT DEFAULT 'per_branch',
  default_assignment_mode TEXT DEFAULT 'manual',
  auto_assign_radius_km REAL DEFAULT 15,
  notify_admin_new INTEGER DEFAULT 1,
  notify_driver_assigned INTEGER DEFAULT 1,
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO delivery_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS delivery_branch_settings (
  branch_id INTEGER PRIMARY KEY,
  delivery_enabled INTEGER DEFAULT 1,
  assignment_mode TEXT DEFAULT 'manual',
  delivery_fee REAL DEFAULT 0,
  free_delivery_above REAL DEFAULT 0,
  min_order REAL DEFAULT 0,
  zones_json TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_code TEXT UNIQUE,
  employee_id INTEGER,
  linked_user_id INTEGER,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  password_hash TEXT,
  id_number TEXT,
  address TEXT,
  vehicle_info TEXT,
  documents_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending',
  availability TEXT DEFAULT 'offline',
  all_branches INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  total_deliveries INTEGER DEFAULT 0,
  failed_deliveries INTEGER DEFAULT 0,
  notes TEXT,
  approved_at TEXT,
  approved_by INTEGER,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_driver_branches (
  driver_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  PRIMARY KEY (driver_id, branch_id)
);

CREATE TABLE IF NOT EXISTS delivery_driver_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  device_uid TEXT,
  device_name TEXT,
  platform TEXT DEFAULT 'web',
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT,
  actor_id INTEGER,
  actor_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Extend delivery_assignments
ALTER TABLE delivery_assignments ADD COLUMN branch_id INTEGER;
ALTER TABLE delivery_assignments ADD COLUMN sale_id INTEGER;
ALTER TABLE delivery_assignments ADD COLUMN items_json TEXT DEFAULT '[]';
ALTER TABLE delivery_assignments ADD COLUMN delivery_fee REAL DEFAULT 0;
ALTER TABLE delivery_assignments ADD COLUMN payment_method TEXT;
ALTER TABLE delivery_assignments ADD COLUMN special_instructions TEXT;
ALTER TABLE delivery_assignments ADD COLUMN driver_id INTEGER;
ALTER TABLE delivery_assignments ADD COLUMN assignment_mode TEXT DEFAULT 'manual';
ALTER TABLE delivery_assignments ADD COLUMN tracking_token TEXT;
ALTER TABLE delivery_assignments ADD COLUMN picked_up_at TEXT;
ALTER TABLE delivery_assignments ADD COLUMN on_way_at TEXT;
ALTER TABLE delivery_assignments ADD COLUMN failed_reason TEXT;
ALTER TABLE delivery_assignments ADD COLUMN driver_accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_branch ON delivery_assignments(branch_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_driver ON delivery_assignments(driver_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_assignments_tracking ON delivery_assignments(tracking_token) WHERE tracking_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_drivers_status ON delivery_drivers(status, availability);
