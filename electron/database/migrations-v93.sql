-- Custom combos: optional product link, item images, pap choice, gallery (v93)

ALTER TABLE combos ADD COLUMN combo_kind TEXT DEFAULT 'standard';
ALTER TABLE combos ADD COLUMN gallery_paths TEXT;

ALTER TABLE combo_items ADD COLUMN custom_name TEXT;
ALTER TABLE combo_items ADD COLUMN custom_image_path TEXT;
ALTER TABLE combo_items ADD COLUMN allow_pap_choice INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS combo_items_v93 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity REAL NOT NULL DEFAULT 1,
  custom_name TEXT,
  custom_image_path TEXT,
  allow_pap_choice INTEGER DEFAULT 0
);

INSERT INTO combo_items_v93 (id, combo_id, product_id, quantity, custom_name, custom_image_path, allow_pap_choice)
  SELECT id, combo_id, product_id, quantity, custom_name, custom_image_path, COALESCE(allow_pap_choice, 0)
  FROM combo_items;

DROP TABLE combo_items;

ALTER TABLE combo_items_v93 RENAME TO combo_items;

CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON combo_items(combo_id);
