#!/usr/bin/env node
/** One-shot: apply central accounting schema to Postgres (Railway). */
process.env.SHOP_POS_CLOUD = '1';

async function main() {
  const { initDatabase } = require('../electron/database/db');
  const { ensureAccSchema } = require('../electron/database/ensure-pg-schema');
  const { ensurePgMigrations } = require('../electron/database/ensure-pg-migrations');
  const db = await initDatabase();
  const mig = ensurePgMigrations(db);
  const acc = ensureAccSchema(db);
  console.log('migrations:', JSON.stringify(mig));
  console.log('accounting:', JSON.stringify(acc));
  const row = db.prepare(`
    SELECT 1 AS ok FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'acc_settings' LIMIT 1
  `).get();
  console.log('acc_settings exists:', !!row?.ok);
  process.exit(row?.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
