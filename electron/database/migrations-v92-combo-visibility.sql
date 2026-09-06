-- Combo visibility: POS vs online ordering (v92)

ALTER TABLE combos ADD COLUMN show_on_pos INTEGER DEFAULT 1;
ALTER TABLE combos ADD COLUMN show_on_online INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_combos_show_on_pos ON combos(show_on_pos);
CREATE INDEX IF NOT EXISTS idx_combos_show_on_online ON combos(show_on_online);
