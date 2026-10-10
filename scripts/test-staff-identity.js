/**
 * Staff identity: block is global, archive keeps the sale, transfer keeps the original name.
 * Usage: node scripts/test-staff-identity.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-id-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const store = require('../electron/services/store');
  const identity = require('../electron/services/staff-identity');
  const db = require('../electron/database/db').getDb();
  const hash = bcrypt.hashSync('admin-pass', 8);

  const ownerId = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)'
  ).run('owner', hash, 'Main Admin', 'owner').lastInsertRowid;
  const cashierId = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)'
  ).run('thabo', hash, 'Thabo', 'cashier').lastInsertRowid;

  db.prepare(`INSERT INTO sales (receipt_number, user_id, subtotal, discount, tax_amount, total, amount_paid, change_amount, status)
    VALUES ('RCP-STAFF-1', ?, 50, 0, 0, 50, 50, 0, 'completed')`).run(cashierId);

  identity.ensureStaffIdentity();
  const thabo = db.prepare('SELECT * FROM users WHERE id = ?').get(cashierId);
  if (!/^EMP-\d+$/.test(thabo.staff_code)) throw new Error('missing staff code ' + thabo.staff_code);

  const actor = { id: ownerId, role: 'owner', username: 'owner' };
  identity.command(actor, { action: 'block', userId: cashierId, reason: 'Test block' });
  const blockedLogin = store.login('thabo', 'admin-pass', null);
  if (blockedLogin.success || blockedLogin.error !== 'ACCOUNT BLOCKED BY ADMIN') {
    throw new Error('block did not stop login: ' + JSON.stringify(blockedLogin));
  }
  const saleAfterBlock = db.prepare('SELECT user_id FROM sales WHERE receipt_number = ?').get('RCP-STAFF-1');
  if (Number(saleAfterBlock.user_id) !== Number(cashierId)) throw new Error('block changed the sale');

  identity.command(actor, { action: 'unblock', userId: cashierId, reason: 'Back' });
  const restored = store.login('thabo', 'admin-pass', null);
  if (!restored.success) throw new Error('unblock failed: ' + restored.error);

  identity.command(actor, {
    action: 'archive',
    userId: cashierId,
    mode: 'transfer',
    reason: 'Employee left business',
    password: 'admin-pass',
    confirmUsername: 'thabo'
  });
  const archived = db.prepare('SELECT id, full_name, access_status FROM users WHERE id = ?').get(cashierId);
  if (!archived) throw new Error('archive deleted the user row');
  if (archived.full_name !== 'Thabo') throw new Error('archive renamed the person');
  if (String(archived.access_status).toUpperCase() !== 'DELETED') throw new Error('status ' + archived.access_status);
  const saleAfter = db.prepare('SELECT user_id FROM sales WHERE receipt_number = ?').get('RCP-STAFF-1');
  if (Number(saleAfter.user_id) !== Number(cashierId)) throw new Error('archive unlinked the sale');
  const again = store.login('thabo', 'admin-pass', null);
  if (again.success) throw new Error('deleted staff could still log in');

  const sale = store.getSale(db.prepare('SELECT id FROM sales WHERE receipt_number = ?').get('RCP-STAFF-1').id);
  if (!sale.ownership_transferred) throw new Error('transfer flag missing');
  if (sale.original_staff_name !== 'Thabo') throw new Error('original name lost: ' + sale.original_staff_name);
  if (sale.current_owner_name !== 'Main Admin') throw new Error('owner name: ' + sale.current_owner_name);
  if (sale.cashier_name !== 'Thabo') throw new Error('cashier was replaced: ' + sale.cashier_name);

  let purged = false;
  try {
    identity.command(actor, { action: 'purge', table: 'sales', recordId: sale.id, reason: 'no', password: 'wrong' });
  } catch (err) {
    purged = /password/i.test(err.message);
  }
  if (!purged) throw new Error('purge accepted a bad password');
  const still = db.prepare('SELECT id FROM sales WHERE id = ?').get(sale.id);
  if (!still) throw new Error('sale disappeared');

  console.log('STAFF_IDENTITY_OK', thabo.staff_code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
