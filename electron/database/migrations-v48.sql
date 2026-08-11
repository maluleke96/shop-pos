-- v2.9.1: Add supervisor user role to CHECK constraint

PRAGMA foreign_keys=off;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pin TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'assistant_manager', 'supervisor', 'marketing_agent', 'cashier')),
  is_active INTEGER DEFAULT 1,
  permissions TEXT DEFAULT '{}',
  branch_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, username, password_hash, pin, full_name, role, is_active, permissions, branch_id, created_at, updated_at)
SELECT id, username, password_hash, pin, full_name, role, is_active, permissions, branch_id, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys=on;
