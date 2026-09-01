-- Business Manager mobile app (same DB as POS / Admin)

CREATE TABLE IF NOT EXISTS public.mobile_app_users (
  id BIGSERIAL PRIMARY KEY,
  linked_user_id BIGINT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'branch_manager',
  permissions_json TEXT DEFAULT '{}',
  all_branches INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mobile_branch_access (
  user_id BIGINT NOT NULL REFERENCES public.mobile_app_users(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS public.mobile_devices (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.mobile_app_users(id) ON DELETE CASCADE,
  device_uid TEXT NOT NULL,
  device_name TEXT,
  platform TEXT DEFAULT 'android',
  push_token TEXT,
  status TEXT DEFAULT 'active',
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, device_uid)
);

CREATE TABLE IF NOT EXISTS public.mobile_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.mobile_app_users(id) ON DELETE CASCADE,
  device_id BIGINT REFERENCES public.mobile_devices(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mobile_notification_prefs (
  user_id BIGINT PRIMARY KEY REFERENCES public.mobile_app_users(id) ON DELETE CASCADE,
  prefs_json TEXT DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mobile_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES public.mobile_app_users(id) ON DELETE CASCADE,
  branch_id BIGINT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload_json TEXT DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_notifications_user ON public.mobile_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_devices_user ON public.mobile_devices (user_id, status);

CREATE TABLE IF NOT EXISTS public.pos_heartbeats (
  branch_id BIGINT NOT NULL,
  device_id TEXT NOT NULL,
  device_label TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'online',
  PRIMARY KEY (branch_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_heartbeats_seen ON public.pos_heartbeats (last_seen_at);
