/**
 * Probe Supabase Postgres via Session pooler (IPv4) when direct db.* is IPv6-only.
 * Does not print secrets.
 */
require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
const { Pool } = require('pg');

const password =
  process.env.SHOP_POS_DB_PASSWORD ||
  process.env.SUPABASE_DB_PASSWORD ||
  process.env.PGPASSWORD ||
  '';
const ref = 'khwohhrzlnmmrxwugtux';

const candidates = [
  process.env.SHOP_POS_DATABASE_URL,
  process.env.DATABASE_URL,
  // Session mode 5432 and transaction 6543 — common regions
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`
].filter(Boolean);

(async () => {
  for (const url of candidates) {
    const label = url.replace(/:[^:@/]+@/, ':***@');
    const pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connectionTimeoutMillis: 12000
    });
    try {
      const r = await pool.query('SELECT current_database() AS db, NOW() AS now');
      console.log('OK', label);
      console.log('db', r.rows[0].db);
      const t = await pool.query(
        "SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname='public'"
      );
      console.log('public_tables', t.rows[0].c);
      await pool.end();
      console.log('USE_THIS_URL_TEMPLATE=postgresql://postgres.' + ref + ':YOUR_PASSWORD@' + label.split('@')[1]);
      process.exit(0);
    } catch (e) {
      console.log('FAIL', label.split('@')[1] || label, '→', e.message);
      try {
        await pool.end();
      } catch (_) {}
    }
  }
  console.error('No working connection. In Supabase → Settings → Database → Connection string → Session pooler, copy URI into SHOP_POS_DATABASE_URL');
  process.exit(1);
})();
