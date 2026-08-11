require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  const pool = new Pool({
    connectionString: process.env.SHOP_POS_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/07_railway_idempotency.sql'), 'utf8');
  await pool.query(sql);
  console.log('idempotency SQL applied (IF NOT EXISTS only)');
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
