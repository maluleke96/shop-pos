/**
 * Reset Postgres serial sequences after JSON upsert import (safe — no data loss).
 */
require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.SHOP_POS_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });
  const tables = await pool.query(`
    SELECT table_name, column_name, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE 'nextval%'
  `);
  let n = 0;
  for (const row of tables.rows) {
    const table = row.table_name;
    const col = row.column_name;
    const m = String(row.column_default || '').match(/nextval\('([^']+)'/);
    const seq = m ? m[1] : null;
    try {
      const max = await pool.query(`SELECT COALESCE(MAX("${col}"), 1)::bigint AS m FROM "${table}"`);
      const maxVal = max.rows[0].m;
      if (seq) {
        await pool.query(`SELECT setval($1::regclass, $2::bigint, true)`, [seq, maxVal]);
      } else {
        await pool.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), $3::bigint, true)`,
          [table, col, maxVal]
        );
      }
      n++;
    } catch (e) {
      console.warn('skip', table, col, e.message);
    }
  }
  console.log('sequences_reset', n);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
