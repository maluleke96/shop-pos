require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
process.env.SHOP_POS_CLOUD = '1';
const { initDatabase, getDb } = require('../electron/database/db');

(async () => {
  await initDatabase();
  const db = getDb();
  try {
    const r = db.prepare(
      `INSERT INTO sales (receipt_number, order_number, user_id, subtotal, discount, tax_amount, total, amount_paid, change_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`
    ).run('SMOKE-TEST-' + Date.now(), 'O-SMOKE', 1, 1, 0, 0, 1, 1, 0);
    console.log('insert_ok', r);
    const c = db.prepare('SELECT COUNT(*) as c FROM sales').get();
    console.log('sales', c);
  } catch (e) {
    console.error('FAIL', e.message);
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
