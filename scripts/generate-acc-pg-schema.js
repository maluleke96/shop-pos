/** Generate Postgres acc_* schema from migrations-v77.sql */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'migrations-v77.sql'), 'utf8');
let pg = src
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
  .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
  .replace(/datetime\('now'\)/g, 'NOW()')
  .replace(/DEFAULT \(NOW\(\)\)/g, 'DEFAULT NOW()')
  .replace(/INSERT OR IGNORE/g, 'INSERT')
  .replace(/date\('now','start of year'\)/g, "date_trunc('year', CURRENT_DATE)::date")
  .replace(
    /date\('now','start of year','\+1 year','-1 day'\)/g,
    "(date_trunc('year', CURRENT_DATE) + INTERVAL '1 year' - INTERVAL '1 day')::date"
  );

const lines = pg.split(/;\s*\n/);
const out = [];
for (let stmt of lines) {
  stmt = stmt.trim();
  if (!stmt) continue;
  if (/^INSERT INTO acc_/.test(stmt) && !/ON CONFLICT/i.test(stmt)) {
    if (/acc_settings/.test(stmt)) stmt += ' ON CONFLICT (id) DO NOTHING';
    else if (/acc_tax_rates/.test(stmt)) stmt += ' ON CONFLICT (id) DO NOTHING';
    else if (/acc_accounts/.test(stmt)) stmt += ' ON CONFLICT (id) DO NOTHING';
    else if (/acc_bank_accounts/.test(stmt)) stmt += ' ON CONFLICT (id) DO NOTHING';
    else if (/acc_cash_accounts/.test(stmt)) stmt += ' ON CONFLICT (id) DO NOTHING';
    else if (/acc_periods/.test(stmt)) stmt += ' ON CONFLICT (id) DO NOTHING';
  }
  out.push(stmt);
}

const dest = path.join(__dirname, '..', 'supabase', 'migrations', '20260829_accounting.sql');
const header = '-- Central accounting ledger (Postgres)\n-- Generated from migrations-v77.sql\n\n';
fs.writeFileSync(dest, header + out.join(';\n\n') + ';\n');
console.log('Wrote', dest, '-', out.length, 'statements');
