require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.SHOP_POS_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });
  const max = await pool.query('SELECT MAX(id)::bigint AS m, COUNT(*)::int AS c FROM sales');
  console.log('sales_max', max.rows[0]);
  const seq = await pool.query("SELECT pg_get_serial_sequence('sales','id') AS s");
  console.log('sales_seq', seq.rows[0]);
  const name = seq.rows[0] && seq.rows[0].s;
  if (name) {
    await pool.query(`SELECT setval($1::regclass, $2::bigint, true)`, [
      name,
      Math.max(Number(max.rows[0].m) || 1, 1)
    ]);
    const n = await pool.query(`SELECT nextval($1::regclass) AS n`, [name]);
    console.log('next_id', n.rows[0].n);
  } else {
    console.log('No serial sequence — checking identity');
    const cols = await pool.query(`
      SELECT column_name, column_default, is_identity, identity_generation
      FROM information_schema.columns
      WHERE table_name='sales' AND column_name='id'
    `);
    console.log(cols.rows[0]);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
