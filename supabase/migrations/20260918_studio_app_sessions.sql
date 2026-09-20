-- Studio app sessions (Menu & Promo Studio Windows/Android)
CREATE TABLE IF NOT EXISTS public.studio_app_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id),
  token_hash TEXT NOT NULL,
  device_name TEXT,
  platform TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_studio_app_sessions_token ON public.studio_app_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_studio_app_sessions_user ON public.studio_app_sessions(user_id);
