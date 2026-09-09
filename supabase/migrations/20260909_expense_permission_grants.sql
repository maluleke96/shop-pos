CREATE TABLE IF NOT EXISTS public.expense_permission_grants (
  id SERIAL PRIMARY KEY,
  grantee_user_id INTEGER NOT NULL,
  grantee_username TEXT NOT NULL,
  grantee_full_name TEXT,
  approver_user_id INTEGER NOT NULL,
  approver_username TEXT NOT NULL,
  approver_full_name TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  approver_branch_id INTEGER,
  photo_path TEXT,
  recording_path TEXT,
  device_info TEXT,
  granted_at TIMESTAMPTZ DEFAULT NOW()
);
