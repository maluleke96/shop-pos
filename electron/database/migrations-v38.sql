-- Phase 7: Gift card polish & admin override metadata

ALTER TABLE gift_cards ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE gift_cards ADD COLUMN notes TEXT;

ALTER TABLE opening_checklist_templates ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE closing_checklist_templates ADD COLUMN created_by INTEGER REFERENCES users(id);
