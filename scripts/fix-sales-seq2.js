require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.SHOP_POS_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });
  const max = await pool.query('SELECT COALESCE(MAX(id), 1)::bigint AS m FROM sales');
  console.log('max', max.rows[0].m);
  await pool.query(`SELECT setval('sales_id_seq', $1::bigint, true)`, [max.rows[0].m]);
  const n1 = await pool.query(`SELECT nextval('sales_id_seq') AS n`);
  console.log('next', n1.rows[0].n);
  const ins = await pool.query(
    `INSERT INTO sales (receipt_number, order_number, user_id, subtotal, discount, tax_amount, total, amount_paid, change_amount, status)
     VALUES ($1,$2,1,1,0,0,1,1,0,'completed') RETURNING id, receipt_number`,
    ['SMOKE-DIRECT-' + Date.now(), 'O-DIR']
  );
  console.log('inserted', ins.rows[0]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
