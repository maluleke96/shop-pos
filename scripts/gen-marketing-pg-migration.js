const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../electron/database/migrations-v75.sql'), 'utf8');
let out = src
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY')
  .replace(/datetime\('now'\)/g, 'NOW()')
  .replace(/INSERT OR IGNORE/g, 'INSERT')
  .replace(
    /ALTER TABLE branches ADD COLUMN business_id INTEGER REFERENCES mkt_businesses\(id\);/,
    'ALTER TABLE branches ADD COLUMN IF NOT EXISTS business_id BIGINT;'
  );

out = out.replace(
  /INSERT INTO mkt_settings \(id, default_commission_percent, referral_base_url\)\s*VALUES \(1, 5, '\/r\/'\);/,
  "INSERT INTO mkt_settings (id, default_commission_percent, referral_base_url) VALUES (1, 5, '/r/') ON CONFLICT (id) DO NOTHING;"
);

out = '-- Marketing Command Centre (Postgres)\n' + out.replace(/CREATE TABLE IF NOT EXISTS /g, 'CREATE TABLE IF NOT EXISTS public.');

const dest = path.join(__dirname, '../supabase/migrations/20260830_marketing_platform.sql');
fs.writeFileSync(dest, out, 'utf8');
console.log('Written', dest, out.length, 'bytes');
