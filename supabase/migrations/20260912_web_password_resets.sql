-- Online customer forgot-password codes (email or full phone)

CREATE TABLE IF NOT EXISTS web_password_resets (
  id SERIAL PRIMARY KEY,
  web_customer_id INTEGER NOT NULL,
  contact TEXT,
  channel TEXT,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_password_resets_customer
  ON web_password_resets(web_customer_id);

CREATE TABLE IF NOT EXISTS attendance_list_hidden (
  employee_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  hidden_by INTEGER,
  hidden_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (employee_id, work_date)
);
