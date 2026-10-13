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

  const mine = connect.home(token).profile;
  const other = connect.home(otherToken).profile;
  const ownerProfile = connect.home(owner.token).profile;
  const cashierProfile = connect.home(cashier.token).profile;
  assert(/^CC-\d{6}$/.test(mine.connectCode) && mine.connectCode !== other.connectCode, 'Connect numbers are missing or not unique');
  assert(connect.home(token).profile.connectCode === mine.connectCode, 'Connect number changed');
  assert(ownerProfile.canModerate && !mine.canModerate && !cashierProfile.canModerate, 'moderation is not limited to the owner or manager');
  connect.addStory(token, 'Braai tonight');
  assert(!connect.stories(otherToken).some((row) => row.body === 'Braai tonight'), 'a stranger saw the status');
  const chat = connect.saveContact(otherToken, mine.connectCode);
  connect.send(otherToken, chat.id, 'Hello privately');
  assert(connect.messages(token, chat.id).messages.some((row) => row.body === 'Hello privately'), 'private chat did not arrive');
  assert(connect.stories(otherToken).some((row) => row.body === 'Braai tonight'), 'a saved number could not see the status');
  connect.publish(token, 'Short clip', 'data:video/mp4;base64,AAAA', 'video');
  assert(connect.posts(otherToken).some((row) => row.mediaKind === 'video'), 'video post was not shared with the connection');
  const staffChat = connect.saveContact(owner.token, cashierProfile.connectCode);
  connect.send(owner.token, staffChat.id, 'Please open the till');
  assert(connect.messages(cashier.token, staffChat.id).messages.some((row) => row.body === 'Please open the till'), 'owner could not message staff by Connect number');
  connect.publish(token, 'this is porn');
  const flagged = connect.adminFeed(owner.token).posts.find((row) => row.flagged && /porn/.test(row.body));
  assert(flagged, 'admin did not see the reported post');
  connect.adminHide(owner.token, 'post', flagged.id, true);
  assert(!connect.posts(otherToken).some((row) => /porn/.test(row.body)), 'a hidden post was still visible');
  let cashierBlocked = false;
  try { connect.adminPeople(cashier.token); } catch (err) { cashierBlocked = /owner or manager/i.test(err.message); }
  assert(cashierBlocked, 'cashier opened the monitor');
  connect.adminPerson(owner.token, mine.connectCode, 'block');
  let stopped = false;
  try { connect.send(token, chat.id, 'again'); } catch (err) { stopped = /blocked/i.test(err.message); }
  assert(stopped, 'a blocked person could still send');
  assert(!connect.stories(otherToken).some((row) => row.body === 'Braai tonight'), 'a blocked person status stayed visible');
  connect.adminPerson(owner.token, mine.connectCode, 'approve');
  connect.send(token, chat.id, 'I am back');
  assert(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n === beforeCustomers, 'Connect numbers created another customer');

  console.log('CONNECT_PLATFORM_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
