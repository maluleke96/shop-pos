-- v128: Customer profile fields + signed contract snapshots (SQLite-safe ALTERs also in ensureSchema).
-- Lab / saas-web only — never Chisa Food.

-- Acceptance signature + immutable snapshot (columns added via ensureSchema ALTER if missing)
-- platform_contract_acceptances:
--   signature_data, body_text_snapshot, placeholders_snapshot_json, device_public_id, signed_document_json

-- Contract version lifecycle:
--   status (draft|published), effective_at, require_reacceptance, placeholders_json

-- Customer/shop profile extras on platform_shops:
--   owner_id_number, whatsapp, postal_address, company_name, company_registration,
--   shop_address, shop_phone, branch_info
