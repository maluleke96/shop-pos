/**
 * Smoke: receipt/order numbers increment and stay identical.
 * Usage: node scripts/test-receipt-bump-once.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rcpt-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const store = require('../electron/services/store');
  const db = require('../electron/database/db').getDb();

  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS receipt_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1), last_number INTEGER DEFAULT 0)`).run();
    db.prepare('INSERT OR IGNORE INTO receipt_counter (id, last_number) VALUES (1, 0)').run();
    db.prepare('UPDATE receipt_counter SET last_number = 0 WHERE id = 1').run();
  } catch (_) { /* */ }

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('x', 4);
  try {
    db.prepare(
      'INSERT INTO users (username,password_hash,full_name,role,is_active) VALUES (?,?,?,?,1)'
    ).run('t', hash, 'T', 'owner');
  } catch (_) { /* */ }
  const u = db.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();

  try {
    db.prepare(`
      INSERT INTO sales (receipt_number, order_number, user_id, subtotal, discount, tax_amount, total, amount_paid, change_amount, status)
      VALUES ('RCP-TEST-00001', 'ORD-OLD-0001', ?, 10, 0, 0, 10, 10, 0, 'completed')
    `).run(u.id);
  } catch (e) {
    console.warn('seed sale skipped:', e.message);
  }

  let p = db.prepare('SELECT id FROM products LIMIT 1').get();
  if (!p) {
    db.prepare("INSERT INTO categories (name) VALUES ('Gen')").run();
    const c = db.prepare('SELECT id FROM categories LIMIT 1').get();
    db.prepare(
      'INSERT INTO products (name,selling_price,stock_quantity,category_id) VALUES (?,?,?,?)'
    ).run('Test', 10, 100, c.id);
    p = db.prepare('SELECT id FROM products LIMIT 1').get();
  }

  try {
    if (typeof store.openShift === 'function') {
      store.openShift({ opening_float: 0 }, u.id, u.full_name || u.username);
    } else {
      db.prepare(
        `INSERT INTO shifts (user_id, opened_at, status, opening_float) VALUES (?, datetime('now'), 'open', 0)`
      ).run(u.id);
    }
  } catch (e) {
    console.warn('shift open:', e.message);
    try {
      db.prepare(
        `INSERT INTO shifts (user_id, opened_at, status) VALUES (?, datetime('now'), 'open')`
      ).run(u.id);
    } catch (e2) {
      console.warn('shift insert:', e2.message);
    }
  }

  const nums = [];
  for (let i = 0; i < 3; i++) {
    const r = store.completeSale({
      items: [{ product_id: p.id, quantity: 1, unit_price: 10, total: 10, product_name: 'Test' }],
      payments: [{ type: 'cash', amount: 10 }],
      amount_paid: 10,
      discount: 0,
      order_type: 'takeaway'
    }, u.id, u.full_name || u.username);
    const sale = r.sale || r;
    nums.push({
      receipt: sale.receipt_number || r.receiptNumber,
      order: sale.order_number || r.orderNumber
    });
  }

  console.log(JSON.stringify(nums, null, 2));
  const same = nums.every((n) => n.receipt === n.order && n.receipt);
  const unique = new Set(nums.map((n) => n.receipt)).size === 3;
  if (!same) throw new Error('receipt != order');
  if (!unique) throw new Error('numbers not unique: ' + JSON.stringify(nums));
  const lastParts = nums.map((n) => {
    const m = String(n.receipt).match(/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
  });
  if (!(lastParts[0] >= 2 && lastParts[1] > lastParts[0] && lastParts[2] > lastParts[1])) {
    throw new Error('expected incrementing past seed: ' + JSON.stringify(lastParts));
  }
  // Seed row should have been synced to matching order_number
  const seed = db.prepare("SELECT order_number, receipt_number FROM sales WHERE receipt_number='RCP-TEST-00001'").get();
  if (seed && seed.order_number !== seed.receipt_number) {
    throw new Error('seed order_number not synced: ' + JSON.stringify(seed));
  }
  console.log('RECEIPT OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
