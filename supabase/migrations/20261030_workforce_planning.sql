-- Workforce planning (Postgres): staffing, lock/publish columns, performance rewards

ALTER TABLE employee_schedules ADD COLUMN IF NOT EXISTS is_locked INTEGER DEFAULT 0;
ALTER TABLE employee_schedules ADD COLUMN IF NOT EXISTS is_published INTEGER DEFAULT 1;
ALTER TABLE employee_schedules ADD COLUMN IF NOT EXISTS published_at TEXT;
ALTER TABLE employee_schedules ADD COLUMN IF NOT EXISTS job_role TEXT;
ALTER TABLE employee_schedules ADD COLUMN IF NOT EXISTS schedule_status TEXT DEFAULT 'published';

CREATE TABLE IF NOT EXISTS staffing_requirements (
  id SERIAL PRIMARY KEY,
  branch TEXT,
  day_of_week INTEGER NOT NULL,
  min_workers INTEGER NOT NULL DEFAULT 1,
  target_workers INTEGER NOT NULL DEFAULT 1,
  max_workers INTEGER,
  classification TEXT NOT NULL DEFAULT 'normal',
  shift_slot TEXT NOT NULL DEFAULT 'all',
  role_requirements_json TEXT,
  special_date TEXT,
  notes TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_staffing_req_day ON staffing_requirements(day_of_week);
CREATE INDEX IF NOT EXISTS idx_staffing_req_date ON staffing_requirements(special_date);

CREATE TABLE IF NOT EXISTS staff_performance_reward_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT NOT NULL,
  require_approval INTEGER NOT NULL DEFAULT 1,
  eligible_roles_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS staff_performance_rewards (
  id SERIAL PRIMARY KEY,
  reward_date TEXT NOT NULL,
  branch TEXT,
  employee_id INTEGER NOT NULL,
  sales_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  target_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  reward_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  tier_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  calc_key TEXT NOT NULL UNIQUE,
  payroll_id INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_perf_rewards_date ON staff_performance_rewards(reward_date);
CREATE INDEX IF NOT EXISTS idx_staff_perf_rewards_emp ON staff_performance_rewards(employee_id);

CREATE TABLE IF NOT EXISTS employee_schedule_history (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER,
  employee_id INTEGER,
  shift_date TEXT,
  action TEXT NOT NULL,
  previous_json TEXT,
  new_json TEXT,
  actor_id INTEGER,
  actor_name TEXT,
  created_at TEXT
);
