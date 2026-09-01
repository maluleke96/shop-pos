/**
 * Query Railway Postgres using discrete SHOP_POS_DB_* vars from railway variables.
 * Run: railway shell -- node scripts/railway-db-probe.js
 */
const { Client } = require('pg');

async function main() {
  const host = process.env.SHOP_POS_DB_HOST || process.env.PGHOST;
  const port = Number(process.env.SHOP_POS_DB_PORT || process.env.PGPORT || 5432);
  const database = process.env.SHOP_POS_DB_NAME || process.env.PGDATABASE || 'postgres';
  const user = process.env.SHOP_POS_DB_USER || process.env.PGUSER || 'postgres';
  const password = process.env.SHOP_POS_DB_PASSWORD || process.env.PGPASSWORD;
  if (!host || !password) {
    console.log(JSON.stringify({ error: 'Missing SHOP_POS_DB_HOST or SHOP_POS_DB_PASSWORD — run via: railway shell -- node scripts/railway-db-probe.js' }));
    process.exit(1);
  }
  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
  await client.connect();
  const out = {};
  const agents = await client.query(`
    SELECT id, full_name, status, referral_code, agent_code, referral_link
    FROM mkt_referral_agents ORDER BY id DESC LIMIT 15
  `);
  out.agents = agents.rows;
  const products = await client.query(`
    SELECT p.id, p.name, p.stock_quantity, bs.branch_id, bs.quantity AS branch_qty
    FROM products p
    LEFT JOIN branch_stock bs ON bs.product_id = p.id
    WHERE p.is_active = 1
    ORDER BY p.id LIMIT 10
  `);
  out.products = products.rows;
  const mig = await client.query('SELECT name FROM pg_schema_migrations ORDER BY name');
  out.migrations = mig.rows.map((r) => r.name);
  await client.end();
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
