/**
 * Phase 3 verification: permissions, integration auth, finance NAV backends, delivery module.
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
  const session = require('../electron/services/session');
  const central = require('../electron/services/accounting-central');
  const acc = require('../electron/services/accounting-platform');
  const delivery = require('../electron/services/delivery-platform');
  const { hasUserPermission, assertUserPermission } = require('../electron/services/authz');
  acc.ensureReady();

  const owner = db.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  const manager = db.prepare("SELECT * FROM users WHERE role='manager' LIMIT 1").get();
  session.setUserSession(owner);
  const results = [];

  // 1. Integration auth — open when no key
  try {
    const prev = process.env.SHOP_POS_INTEGRATE_KEY;
    delete process.env.SHOP_POS_INTEGRATE_KEY;
    central.validateIntegrationAuth({ hook: 'postFromSale', local_id: 1 });
    results.push({ test: 'integrate_auth_open', pass: true });
    process.env.SHOP_POS_INTEGRATE_KEY = 'phase3-test-key';
    let failed = false;
    try { central.validateIntegrationAuth({ hook: 'postFromSale' }); } catch (_) { failed = true; }
    central.validateIntegrationAuth({ hook: 'postFromSale', integration_key: 'phase3-test-key' });
    results.push({ test: 'integrate_auth_key', pass: failed });
    if (prev) process.env.SHOP_POS_INTEGRATE_KEY = prev;
    else delete process.env.SHOP_POS_INTEGRATE_KEY;
  } catch (e) {
    results.push({ test: 'integrate_auth', pass: false, error: e.message });
  }

  // 2. Server permission helper
  try {
    const mgrPerm = manager ? hasUserPermission(manager, 'delivery') : true;
    const noSys = manager ? !hasUserPermission({ ...manager, permissions: JSON.stringify({ system_settings: false }) }, 'system_settings') : true;
    results.push({ test: 'server_permissions', pass: mgrPerm && noSys });
  } catch (e) {
    results.push({ test: 'server_permissions', pass: false, error: e.message });
  }

  // 3. Finance backends reachable
  try {
    const actor = { id: owner.id, role: owner.role, username: owner.username, full_name: owner.full_name };
    const income = acc.listOtherIncome(actor);
    const loans = acc.listLoans(actor);
    const ownerTx = acc.listOwnerTxns(actor);
    results.push({
      test: 'finance_backends',
      pass: Array.isArray(income) && Array.isArray(loans) && Array.isArray(ownerTx),
      income_count: income.length,
      loans_count: loans.length,
      owner_tx_count: ownerTx.length
    });
  } catch (e) {
    results.push({ test: 'finance_backends', pass: false, error: e.message });
  }

  // 4. Document file API
  try {
    const doc = db.prepare('SELECT id FROM acc_documents ORDER BY id DESC LIMIT 1').get();
    if (doc) {
      const file = acc.getDocumentFile(doc.id, { id: owner.id, role: 'owner' });
      results.push({ test: 'document_download', pass: !!file?.file_base64, doc_id: doc.id });
    } else {
      results.push({ test: 'document_download', pass: true, skipped: 'no documents' });
    }
  } catch (e) {
    results.push({ test: 'document_download', pass: false, error: e.message });
  }

  // 5. Delivery module
  try {
    delivery.ensureSchema();
    const orderNum = `PHASE3-DEL-${Date.now()}`;
    db.prepare(`INSERT INTO online_orders_local (order_number, branch_id, customer_name, customer_phone, items_json, total, status, order_source, fulfillment_type, delivery_address, payment_status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      orderNum, 1, 'Delivery Test', '0820000000', '[]', 99, 'pending', 'ONLINE', 'delivery', '123 Test St', 'paid'
    );
    const order = db.prepare('SELECT * FROM online_orders_local WHERE order_number=?').get(orderNum);
    const row = delivery.upsertFromOnlineOrder(order);
    const assigned = delivery.assignDriver(row.id, null, { id: owner.id, role: 'owner', full_name: owner.full_name });
    results.push({
      test: 'delivery_module',
      pass: row?.status === 'pending' && row?.delivery_address === '123 Test St',
      assignment_id: row?.id
    });
  } catch (e) {
    results.push({ test: 'delivery_module', pass: false, error: e.message });
  }

  // 6. Integration payload includes key when configured
  try {
    process.env.SHOP_POS_INTEGRATE_KEY = 'payload-key-test';
    const sale = db.prepare(`SELECT id FROM sales WHERE status='completed' ORDER BY id DESC LIMIT 1`).get();
    if (sale) {
      const payload = central.buildIntegrationPayload('postFromSale', [sale.id]);
      const wrapped = central.withIntegrationKey(payload);
      results.push({ test: 'payload_integration_key', pass: wrapped?.integration_key === 'payload-key-test' });
    } else {
      results.push({ test: 'payload_integration_key', pass: true, skipped: 'no sale' });
    }
    delete process.env.SHOP_POS_INTEGRATE_KEY;
  } catch (e) {
    results.push({ test: 'payload_integration_key', pass: false, error: e.message });
  }

  console.log(JSON.stringify({ phase: 3, results, all_pass: results.every((r) => r.pass) }, null, 2));
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
