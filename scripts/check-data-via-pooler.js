require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
const { Pool } = require('pg');

const password =
  process.env.SHOP_POS_DB_PASSWORD ||
  process.env.SUPABASE_DB_PASSWORD ||
  process.env.PGPASSWORD ||
  '';
const ref = 'khwohhrzlnmmrxwugtux';
const url =
  process.env.SHOP_POS_DATABASE_URL ||
  process.env.DATABASE_URL ||
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;

(async () => {
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 1
  });
  try {
    for (const table of [
      'users',
      'products',
      'sales',
      'sale_items',
      'shop_settings',
      'branches',
      'customers',
      'employees',
      'categories',
      'stock_movements'
    ]) {
      try {
        const r = await pool.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
        console.log(table, r.rows[0].c);
      } catch (e) {
        console.log(table, 'MISSING', e.message.split('\n')[0]);
      }
    }
    try {
      const u = await pool.query(
        "SELECT id, username, role, is_active FROM users ORDER BY id LIMIT 10"
      );
      console.log('sample_users', JSON.stringify(u.rows));
    } catch (_) {}
    try {
      const s = await pool.query('SELECT id, shop_name, setup_complete FROM shop_settings LIMIT 1');
      console.log('settings', JSON.stringify(s.rows[0] || null));
    } catch (_) {}
  } finally {
    await pool.end();
  }
})();
