/* One-shot: report largest tables + VACUUM to free Postgres space */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

async function main() {
  const pg = require('../electron/database/pg-db');
  const { getDb } = require('../electron/database/db');
  await pg.initPgDatabase();
  const db = getDb();

  const tables = db.prepare(`
    SELECT relname AS t,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
           pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 25
  `).all();
  console.log('TOP_TABLES', JSON.stringify(tables, null, 2));

  // Prune cheap, safe growth tables if present
  const prunes = [
    `DELETE FROM rpc_idempotency WHERE created_at < (NOW() - INTERVAL '7 days')::text`,
    `DELETE FROM rpc_idempotency WHERE created_at < datetime('now', '-7 days')`,
    `DELETE FROM web_customer_sessions WHERE expires_at < NOW()::text`,
    `DELETE FROM web_customer_sessions WHERE expires_at < datetime('now')`
  ];
  for (const sql of prunes) {
    try {
      const r = db.prepare(sql).run();
      console.log('PRUNE', sql.slice(0, 60), 'changes=', r?.changes);
    } catch (e) {
      console.log('PRUNE_SKIP', e.message);
    }
  }

  try {
    db.exec('VACUUM');
    console.log('VACUUM_OK');
  } catch (e) {
    console.log('VACUUM_FAIL', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
