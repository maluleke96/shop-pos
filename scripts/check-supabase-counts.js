require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
const { Pool } = require('pg');
const { databaseUrl } = require('../electron/database/pg-connection');

(async () => {
  const pool = new Pool({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 20000
  });
  try {
    const t = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1"
    );
    console.log('tables', t.rowCount);
    const names = t.rows.map((r) => r.tablename);
    console.log('has_users', names.includes('users'));
    console.log('has_products', names.includes('products'));
    console.log('has_sales', names.includes('sales'));
    for (const table of ['users', 'products', 'sales', 'shop_settings', 'branches']) {
      if (!names.includes(table)) continue;
      const r = await pool.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
      console.log(table + '_count', r.rows[0].c);
    }
  } catch (e) {
    console.error('ERROR', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
