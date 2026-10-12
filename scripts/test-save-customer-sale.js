/**
 * Customer phone and sale edits must stick when ids arrive as text.
 * Usage: node scripts/test-save-customer-sale.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'save-ids-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();
  const store = require('../electron/services/store');
  const audit = require('../electron/services/audit');

  const userId = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)`)
    .run('owner', 'x', 'Owner', 'owner').lastInsertRowid;
  const customerId = db.prepare(`INSERT INTO customers (name, phone) VALUES (?,?)`).run('Thabo', '0821111111').lastInsertRowid;
  const productId = db.prepare(`INSERT INTO products (name, selling_price, buying_price, stock_quantity) VALUES (?,?,?,?)`)
    .run('Pap', 20, 8, 10).lastInsertRowid;
  const saleId = db.prepare(`INSERT INTO sales (receipt_number, user_id, customer_id, subtotal, total, amount_paid, status, created_at)
    VALUES (?,?,?,?,?,?, 'completed', ?)`).run('R-1', userId, customerId, 20, 20, 20, new Date().toISOString()).lastInsertRowid;
  const itemId = db.prepare(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, total)
    VALUES (?,?,?,?,?,?)`).run(saleId, productId, 'Pap', 1, 20, 20).lastInsertRowid;
  db.prepare(`INSERT INTO sale_payments (sale_id, payment_type, amount) VALUES (?,?,?)`).run(saleId, 'cash', 20);

  const saved = store.saveCustomer({
    id: String(customerId),
    name: 'Thabo',
    phone: '0839990000',
    email: '',
    address: '',
    balance: 0,
    notes: '',
    is_vip: false,
    allow_on_account: false
  }, userId, 'owner');
  assert(String(saved.phone).includes('0839990000'), 'phone was not stored');

  const edited = audit.updateSaleRecord(String(saleId), {
    notes: 'Extra pap',
    customer_id: String(customerId),
    edit_reason: 'Customer asked for more',
    items: [{ id: String(itemId), product_id: String(productId), quantity: 2, unit_price: 20 }]
  }, userId, 'Owner');
  assert(edited.success, 'sale edit did not return success');
  const item = db.prepare('SELECT quantity FROM sale_items WHERE id = ?').get(itemId);
  const sale = db.prepare('SELECT notes FROM sales WHERE id = ?').get(saleId);
  assert(Number(item.quantity) === 2, 'sale quantity was not stored');
  assert(String(sale.notes).includes('Extra pap'), 'sale notes were not stored');
  console.log('SAVE_IDS_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
