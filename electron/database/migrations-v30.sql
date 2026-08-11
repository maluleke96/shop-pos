-- WhatsApp Communication Center

ALTER TABLE shop_settings ADD COLUMN whatsapp_settings TEXT;

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('customer', 'employee')),
  body TEXT NOT NULL,
  is_builtin INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_id INTEGER REFERENCES whatsapp_templates(id),
  audience_filter TEXT NOT NULL,
  audience_json TEXT,
  scheduled_at TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'cancelled')),
  sent_count INTEGER DEFAULT 0,
  branch_id INTEGER,
  created_by INTEGER,
  created_by_name TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'employee')),
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

CREATE INDEX IF NOT EXISTS idx_wa_messages_date ON whatsapp_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_type ON whatsapp_messages(message_type);
CREATE INDEX IF NOT EXISTS idx_wa_messages_branch ON whatsapp_messages(branch_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_status ON whatsapp_messages(status);
CREATE INDEX IF NOT EXISTS idx_wa_campaigns_status ON whatsapp_campaigns(status);
