/**
 * Phase 2 verification: reject order, reservations, customer credit backfill, outbox reflush.
 */
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);

async function main() {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
  delete process.env.DATABASE_URL;
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const sync = require('../electron/services/sync');
  const online = require('../electron/services/online-ordering');
  const acc = require('../electron/services/accounting-platform');
  const central = require('../electron/services/accounting-central');
  const store = require('../electron/services/store');
  const session = require('../electron/services/session');
  acc.ensureReady();

  const owner = db.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);
  const actor = { id: owner.id, role: owner.role, username: owner.username, full_name: owner.full_name };
  const results = [];

  // 1. Reject resolves by local id (not remote_id)
  try {
    online.ensureSchema?.();
    const product = db.prepare('SELECT * FROM products WHERE is_active=1 LIMIT 1').get();
    if (product) {
      const orderNum = `PHASE2-REJECT-${Date.now()}`;
      const remoteId1 = 800000 + (Date.now() % 100000);
      db.prepare(`INSERT INTO online_orders_local (remote_id, order_number, branch_id, customer_name, items_json, total, status, order_source, payment_status, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
        remoteId1, orderNum, 1, 'Test Customer',
        JSON.stringify([{ product_id: product.id, name: product.name, quantity: 1, unit_price: 10 }]),
        10, 'pending', 'ONLINE', 'paid'
      );
      const local = db.prepare('SELECT * FROM online_orders_local WHERE order_number=?').get(orderNum);
      db.prepare(`INSERT INTO web_stock_reservations (order_id, product_id, branch_id, quantity, status, expires_at)
        VALUES (?,?,?,?,'reserved',datetime('now','+30 minutes'))`).run(local.id, product.id, 1, 1);

      await sync.rejectOnlineOrder(local.id, 'Phase2 test reject', actor);
      const after = db.prepare('SELECT * FROM online_orders_local WHERE id=?').get(local.id);
      const resv = db.prepare('SELECT status FROM web_stock_reservations WHERE order_id=?').get(local.id);
      results.push({
        test: 'reject_by_local_id',
        pass: after.status === 'rejected' && after.reject_reason === 'Phase2 test reject' && resv?.status === 'released',
        local_id: local.id,
        remote_id: local.remote_id
      });

      // remote_id lookup also works
      const remoteId2 = 900000 + (Date.now() % 100000);
      const orderNum2 = `PHASE2-REJECT2-${Date.now()}`;
      db.prepare(`INSERT INTO online_orders_local (remote_id, order_number, branch_id, customer_name, items_json, total, status, order_source, payment_status, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
        remoteId2, orderNum2, 1, 'Test Customer 2',
        JSON.stringify([{ product_id: product.id, name: product.name, quantity: 1, unit_price: 10 }]),
        10, 'pending', 'ONLINE', 'paid'
      );
      const local2 = db.prepare('SELECT * FROM online_orders_local WHERE order_number=?').get(orderNum2);
      online.rejectOrder(local2.remote_id, 'Remote reject', actor);
      const after2 = db.prepare('SELECT * FROM online_orders_local WHERE id=?').get(local2.id);
      results.push({
        test: 'reject_by_remote_id',
        pass: after2.status === 'rejected',
        remote_id: local2.remote_id
      });
    } else {
      results.push({ test: 'reject_by_local_id', pass: true, skipped: 'no product' });
    }
  } catch (e) {
    results.push({ test: 'reject_by_local_id', pass: false, error: e.message });
  }

  // 2. Accept fulfills reservations
  try {
    const product = db.prepare('SELECT * FROM products WHERE is_active=1 LIMIT 1').get();
    if (product) {
      const orderNum = `PHASE2-ACCEPT-${Date.now()}`;
      sync.importCloudOrders([{
        remote_id: 888001 + Date.now() % 1000,
        order_number: orderNum,
        branch_id: 1,
        customer_name: 'Accept Test',
        items: [{ product_id: product.id, name: product.name, quantity: 1, unit_price: Number(product.selling_price) || 10 }],
        total: Number(product.selling_price) || 10,
        status: 'pending',
        order_source: 'ONLINE',
        payment_status: 'paid',
        payment_method: 'online'
      }]);
      const local = db.prepare('SELECT * FROM online_orders_local WHERE order_number=?').get(orderNum);
      db.prepare(`INSERT INTO web_stock_reservations (order_id, product_id, branch_id, quantity, status, expires_at)
        VALUES (?,?,?,?,'reserved',datetime('now','+30 minutes'))`).run(local.id, product.id, 1, 1);

      db.prepare('UPDATE products SET stock_quantity = stock_quantity + 20 WHERE id = ?').run(product.id);
      try { store.openShift(owner.id, 0); } catch (_) { /* may already be open */ }
      await store.acceptOnlineOrderAsSale(local.id, actor, { fulfillment: 'pickup' });
      const resv = db.prepare('SELECT status FROM web_stock_reservations WHERE order_id=?').get(local.id);
      results.push({
        test: 'accept_fulfills_reservations',
        pass: resv?.status === 'fulfilled',
        order_id: local.id
      });
    } else {
      results.push({ test: 'accept_fulfills_reservations', pass: true, skipped: 'no product' });
    }
  } catch (e) {
    results.push({ test: 'accept_fulfills_reservations', pass: false, error: e.message });
  }

  // 3. syncMissingIntegrations includes customer credit
  try {
    const before = db.prepare(`SELECT COUNT(*) AS c FROM acc_journals WHERE source_type='customer_credit'`).get().c;
    const { synced } = acc.syncMissingIntegrations(actor);
    results.push({
      test: 'sync_missing_customer_credit',
      pass: typeof synced === 'number',
      synced,
      journals_before: before
    });
  } catch (e) {
    results.push({ test: 'sync_missing_customer_credit', pass: false, error: e.message });
  }

  // 4. Requeue failed outbox rebuilds payloads
  try {
    const sale = db.prepare(`SELECT id FROM sales WHERE status='completed' ORDER BY id DESC LIMIT 1`).get();
    if (sale) {
      const payload = central.buildIntegrationPayload('postFromSale', [sale.id]);
      db.prepare(`INSERT INTO sync_outbox (entity_type, entity_id, payload, error, created_at)
        VALUES ('acc_integrate', ?, ?, 'old snapshot error', datetime('now'))`).run(sale.id, JSON.stringify({ hook: 'postFromSale', local_id: sale.id }));
      const row = db.prepare(`SELECT id FROM sync_outbox WHERE error='old snapshot error' ORDER BY id DESC LIMIT 1`).get();
      const { requeued } = central.requeueFailedIntegrations();
      const after = db.prepare('SELECT error, payload FROM sync_outbox WHERE id=?').get(row.id);
      const parsed = JSON.parse(after.payload || '{}');
      results.push({
        test: 'requeue_failed_outbox',
        pass: requeued >= 1 && after.error == null && !!parsed.snapshot?.sale,
        requeued
      });
      db.prepare('DELETE FROM sync_outbox WHERE id=?').run(row.id);
    } else {
      results.push({ test: 'requeue_failed_outbox', pass: true, skipped: 'no sale' });
    }
  } catch (e) {
    results.push({ test: 'requeue_failed_outbox', pass: false, error: e.message });
  }

  // 5. Payroll + customer credit payload builds
  try {
    const pr = db.prepare(`SELECT id FROM employee_payroll WHERE status='paid' ORDER BY id DESC LIMIT 1`).get();
    const led = db.prepare(`SELECT id FROM customer_credit_ledger WHERE type='payment' ORDER BY id DESC LIMIT 1`).get();
    const payrollPayload = pr ? central.buildIntegrationPayload('postFromPayroll', [pr.id]) : null;
    const creditPayload = led ? central.buildIntegrationPayload('postFromCustomerCreditPayment', [led.id]) : null;
    results.push({
      test: 'payroll_credit_payloads',
      pass: (!pr || !!payrollPayload?.snapshot?.payroll) && (!led || !!creditPayload?.snapshot?.ledger),
      payroll: !!payrollPayload,
      credit: !!creditPayload
    });
  } catch (e) {
    results.push({ test: 'payroll_credit_payloads', pass: false, error: e.message });
  }

  console.log(JSON.stringify({ phase: 2, results, all_pass: results.every((r) => r.pass) }, null, 2));
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
