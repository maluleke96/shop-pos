-- Phase 4: No-sell / promo approval workflow

CREATE TABLE IF NOT EXISTS product_promo_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  proposed_price REAL NOT NULL,
  original_price REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'expired')),
  proposed_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_promo_requests_product ON product_promo_requests(product_id, status);
CREATE INDEX IF NOT EXISTS idx_promo_requests_status ON product_promo_requests(status, start_date, end_date);

ALTER TABLE sale_items ADD COLUMN original_unit_price REAL;
ALTER TABLE sale_items ADD COLUMN promo_request_id INTEGER REFERENCES product_promo_requests(id);
