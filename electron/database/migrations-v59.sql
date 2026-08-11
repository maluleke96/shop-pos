-- v59: WhatsApp supplier category + cash drops to admin + checklist fail tracking

-- Expand whatsapp_templates.category CHECK to include supplier
CREATE TABLE IF NOT EXISTS whatsapp_templates_v59 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('customer', 'employee', 'supplier')),
  body TEXT NOT NULL,
  is_builtin INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO whatsapp_templates_v59
  (id, slug, name, category, body, is_builtin, is_active, created_by, created_at, updated_at)
SELECT id, slug, name,
  CASE WHEN category IN ('customer', 'employee', 'supplier') THEN category ELSE 'customer' END,
  body, is_builtin, is_active, created_by, created_at, updated_at
FROM whatsapp_templates;
DROP TABLE IF EXISTS whatsapp_templates;
ALTER TABLE whatsapp_templates_v59 RENAME TO whatsapp_templates;

-- Expand whatsapp_messages.recipient_type CHECK to include supplier
CREATE TABLE IF NOT EXISTS whatsapp_messages_v59 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'employee', 'supplier')),
  recipient_id INTEGER,
  recipient_name TEXT,
  phone TEXT NOT NULL,
  message_type TEXT NOT NULL,
  template_id INTEGER REFERENCES whatsapp_templates(id),
  campaign_id INTEGER REFERENCES whatsapp_campaigns(id),
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'opened')),
  sender_id INTEGER,
  sender_name TEXT,
  branch_id INTEGER,
  sale_id INTEGER,
  metadata_json TEXT,
  sent_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO whatsapp_messages_v59
  (id, recipient_type, recipient_id, recipient_name, phone, message_type, template_id,
   campaign_id, body, status, sender_id, sender_name, branch_id, sale_id, metadata_json, sent_at, created_at)
SELECT id,
  CASE WHEN recipient_type IN ('customer', 'employee', 'supplier') THEN recipient_type ELSE 'customer' END,
  recipient_id, recipient_name, phone, message_type, template_id,
  campaign_id, body, status, sender_id, sender_name, branch_id, sale_id, metadata_json, sent_at, created_at
FROM whatsapp_messages;
DROP TABLE IF EXISTS whatsapp_messages;
ALTER TABLE whatsapp_messages_v59 RENAME TO whatsapp_messages;

CREATE INDEX IF NOT EXISTS idx_wa_messages_date ON whatsapp_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_type ON whatsapp_messages(message_type);
CREATE INDEX IF NOT EXISTS idx_wa_messages_branch ON whatsapp_messages(branch_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_status ON whatsapp_messages(status);

-- Cash sent to admin/safe during a shift (small drops + proof until cash-out)
CREATE TABLE IF NOT EXISTS cash_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  user_id INTEGER,
  user_name TEXT,
  amount REAL NOT NULL,
  proof_path TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  confirmed_by INTEGER,
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_drops_shift ON cash_drops(shift_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_drops_date ON cash_drops(created_at);

-- Checklist late / failed submit tracking (for EOM scoring)
ALTER TABLE daily_checklist_runs ADD COLUMN failed_at TEXT;
ALTER TABLE daily_checklist_runs ADD COLUMN failure_reason TEXT;
