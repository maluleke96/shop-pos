/**
 * Verify export inventory row counts against live Supabase Postgres.
 * Read-only. Does not modify data.
 *
 *   $env:SHOP_POS_DATABASE_URL="postgresql://..."
 *   node scripts/verify-supabase-counts.js "path/to/export/inventory.json"
 */
const fs = require('fs');
const { Client } = require('pg');

const ARCHIVE = {
  online_orders_local: 'legacy_online_orders_local',
  sync_outbox: 'legacy_sync_outbox'
};

async function main() {
  const invPath = process.argv[2];
  if (!invPath || !fs.existsSync(invPath)) {
    console.error('Usage: node scripts/verify-supabase-counts.js <export/inventory.json>');
    process.exit(1);
  }
  const url = process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set SHOP_POS_DATABASE_URL');
    process.exit(1);
  }
  const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  const client = new Client({
    connectionString: url,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
  await client.connect();

  const mismatches = [];
  let checked = 0;
  let matched = 0;

  for (const [sqliteName, expected] of Object.entries(inv.tables || {})) {
    if (typeof expected !== 'number') continue;
    const pgName = ARCHIVE[sqliteName] || sqliteName;
    checked += 1;
    try {
      const res = await client.query(`SELECT COUNT(*)::int AS c FROM public."${pgName.replace(/"/g, '""')}"`);
      const actual = res.rows[0].c;
      if (actual !== expected) {
        mismatches.push({ table: pgName, expected, actual });
        console.log(`MISMATCH ${pgName}: export=${expected} supabase=${actual}`);
      } else {
        matched += 1;
        console.log(`OK ${pgName}: ${actual}`);
      }
    } catch (e) {
      mismatches.push({ table: pgName, expected, actual: null, error: e.message });
      console.log(`ERROR ${pgName}: ${e.message}`);
    }
  }

  await client.end();
  console.log(`\nChecked ${checked}, matched ${matched}, mismatches ${mismatches.length}`);
  if (mismatches.length) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
