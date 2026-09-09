CREATE TABLE IF NOT EXISTS expense_permission_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  granted_at TEXT DEFAULT (datetime('now'))
);
