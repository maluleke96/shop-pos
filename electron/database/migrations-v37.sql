-- Phase 6: Document Hub — menus, flyers, and shareable assets

CREATE TABLE IF NOT EXISTS document_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('menu', 'flyer', 'other')),
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  branch_id INTEGER REFERENCES branches(id),
  source_flyer_id INTEGER REFERENCES promotion_flyers(id) ON DELETE SET NULL,
  schedule_at TEXT,
  shared_at TEXT,
  share_mode TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'scheduled'))
);

CREATE INDEX IF NOT EXISTS idx_document_assets_type ON document_assets(doc_type, status);
CREATE INDEX IF NOT EXISTS idx_document_assets_branch ON document_assets(branch_id);
CREATE INDEX IF NOT EXISTS idx_document_assets_flyer ON document_assets(source_flyer_id);
CREATE INDEX IF NOT EXISTS idx_document_assets_schedule ON document_assets(status, schedule_at);
