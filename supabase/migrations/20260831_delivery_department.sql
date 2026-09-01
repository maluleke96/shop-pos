-- Delivery Department — drivers, orders, settings, tracking (Postgres)

CREATE TABLE IF NOT EXISTS public.delivery_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  department_mode TEXT DEFAULT 'per_branch',
  default_assignment_mode TEXT DEFAULT 'manual',
  auto_assign_radius_km REAL DEFAULT 15,
  notify_admin_new INTEGER DEFAULT 1,
  notify_driver_assigned INTEGER DEFAULT 1,
  settings_json TEXT DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.delivery_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.delivery_branch_settings (
  branch_id BIGINT PRIMARY KEY,
  delivery_enabled INTEGER DEFAULT 1,
  assignment_mode TEXT DEFAULT 'manual',
  delivery_fee REAL DEFAULT 0,
  free_delivery_above REAL DEFAULT 0,
  min_order REAL DEFAULT 0,
  zones_json TEXT DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_drivers (
  id BIGSERIAL PRIMARY KEY,
  driver_code TEXT UNIQUE,
  employee_id BIGINT,
  linked_user_id BIGINT,
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
  approved_at TIMESTAMPTZ,
  approved_by BIGINT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_driver_branches (
  driver_id BIGINT NOT NULL REFERENCES public.delivery_drivers(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  PRIMARY KEY (driver_id, branch_id)
);

CREATE TABLE IF NOT EXISTS public.delivery_driver_sessions (
  id BIGSERIAL PRIMARY KEY,
  driver_id BIGINT NOT NULL REFERENCES public.delivery_drivers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_uid TEXT,
  device_name TEXT,
  platform TEXT DEFAULT 'web',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_status_history (
  id BIGSERIAL PRIMARY KEY,
  delivery_id BIGINT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT,
  actor_id BIGINT,
  actor_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_assignments (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id BIGINT NOT NULL,
  order_number TEXT,
  branch_id BIGINT,
  sale_id BIGINT,
  driver_employee_id BIGINT,
  driver_id BIGINT REFERENCES public.delivery_drivers(id) ON DELETE SET NULL,
  driver_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  delivery_address TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  items_json TEXT DEFAULT '[]',
  total REAL DEFAULT 0,
  delivery_fee REAL DEFAULT 0,
  payment_method TEXT,
  special_instructions TEXT,
  assignment_mode TEXT DEFAULT 'manual',
  tracking_token TEXT UNIQUE,
  notes TEXT,
  failed_reason TEXT,
  assigned_at TIMESTAMPTZ,
  driver_accepted_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  on_way_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_status ON public.delivery_assignments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_assignments_source ON public.delivery_assignments(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_branch ON public.delivery_assignments(branch_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_driver ON public.delivery_assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_tracking ON public.delivery_assignments(tracking_token);
CREATE INDEX IF NOT EXISTS idx_delivery_drivers_status ON public.delivery_drivers(status, availability);
