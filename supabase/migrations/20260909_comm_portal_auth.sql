-- Communication Centre standalone portal login

CREATE TABLE IF NOT EXISTS comm_portal_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'marketing',
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER,
  created_by_name TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comm_portal_sessions (
  id SERIAL PRIMARY KEY,
  portal_user_id INTEGER REFERENCES comm_portal_users(id),
  shop_user_id INTEGER,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_portal_sessions_hash ON comm_portal_sessions(token_hash);
