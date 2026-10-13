/**
 * Chisanyama Connect uses the existing customer and does not change orders.
 * Usage: node scripts/test-connect-platform.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();
  const connect = require('../electron/services/connect-platform');
  const online = require('../electron/services/online-ordering');

  db.prepare('UPDATE shop_settings SET shop_name = ? WHERE id = 1').run('Chisanyama Connect');
  db.prepare('INSERT INTO branches (name, code) VALUES (?, ?)').run('Maungani', 'MAU');
  db.prepare('INSERT INTO branches (name, code) VALUES (?, ?)').run('Vuwani', 'VUW');
  const ownerId = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)`)
    .run('owner', 'x', 'Owner', 'owner').lastInsertRowid;
  const cashierId = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)`)
    .run('cashier', 'x', 'Vuwani Cashier', 'cashier').lastInsertRowid;
  const customerId = db.prepare('INSERT INTO customers (name, phone, email) VALUES (?,?,?)')
    .run('Happy Maluleke', '0831112222', 'happy@example.com').lastInsertRowid;
  const webId = db.prepare(`INSERT INTO web_customers (customer_id, first_name, last_name, email, phone, password_hash, marketing_opt_in, is_active)
    VALUES (?,?,?,?,?,?,0,1)`).run(customerId, 'Happy', 'Maluleke', 'happy@example.com', '0831112222', 'x').lastInsertRowid;
  const otherWeb = db.prepare(`INSERT INTO web_customers (first_name, phone, password_hash, marketing_opt_in, is_active)
    VALUES (?,?,?,1,1)`).run('Other', '0833334444', 'x').lastInsertRowid;
  const token = online.createWebSession(webId).token;
  const otherToken = online.createWebSession(otherWeb).token;
  const orderId = db.prepare(`INSERT INTO online_orders_local (order_number, status, total, web_customer_id, customer_id, branch_id, customer_name)
    VALUES ('CH-1234', 'pending', 95, ?, ?, 2, 'Happy Maluleke')`).run(webId, customerId).lastInsertRowid;
  db.prepare(`INSERT INTO delivery_assignments (source_type, source_id, order_number, driver_name, status, customer_name)
    VALUES ('online', ?, 'CH-1234', 'Sipho Driver', 'assigned', 'Happy Maluleke')`).run(orderId);

  const beforeCustomers = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  const home = connect.home(token);
  assert(home.profile.name === 'Happy Maluleke', 'profile did not use the Chisanyama customer name');
  assert(Number(home.profile.customerId) === Number(customerId), 'profile did not keep the customer id');
  assert(home.profile.marketingOptIn === false, 'marketing choice was not read from the existing account');
  assert(home.branches.some((row) => row.name === 'Maungani') && home.branches.some((row) => row.name === 'Vuwani'), 'branches did not come from Chisanyama');

  const orders = connect.orderContext(token);
  assert(orders[0].orderNumber === 'CH-1234' && orders[0].driver === 'Sipho Driver', 'order context missing');
  const thread = connect.openOrder(token, orderId);
  connect.send(token, thread.id, 'Where is my order?');
  const status = db.prepare('SELECT status FROM online_orders_local WHERE id = ?').get(orderId).status;
  assert(status === 'pending', 'a chat message changed the order');
  assert(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n === beforeCustomers, 'chat created another customer');
  assert(Number(db.prepare('SELECT marketing_opt_in FROM web_customers WHERE id = ?').get(webId).marketing_opt_in) === 0, 'chat changed marketing consent');

  let hidden = false;
  try { connect.messages(otherToken, thread.id); } catch (err) { hidden = /not in this conversation/i.test(err.message); }
  assert(hidden, 'another customer read the order conversation');

  const owner = connect.staffEnter({ id: ownerId, role: 'owner', name: 'Owner', username: 'owner' });
  const cashier = connect.staffEnter({ id: cashierId, role: 'cashier', name: 'Vuwani Cashier', username: 'cashier' });
  const maungani = db.prepare("SELECT id FROM branches WHERE name = 'Maungani'").get().id;
  const vuwani = db.prepare("SELECT id FROM branches WHERE name = 'Vuwani'").get().id;
  db.prepare('UPDATE users SET branch_id = ? WHERE id = ?').run(vuwani, cashierId);
  connect.openBranch(owner.token, maungani);
  connect.openBranch(cashier.token, vuwani);
  let blocked = false;
  try { connect.openBranch(cashier.token, maungani); } catch (err) { blocked = /branch/i.test(err.message); }
  assert(blocked, 'cashier opened another branch');

  const call = connect.startCall(token, thread.id, 'voice');
  assert(connect.calls(token).some((row) => Number(row.id) === Number(call.id)), 'call was not saved');
  const notices = connect.notices(owner.token);
  assert(notices.some((row) => /order/i.test(row.body) || /message/i.test(row.kind)), 'staff were not notified');

  console.log('CONNECT_PLATFORM_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
