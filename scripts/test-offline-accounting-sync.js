/**
 * Offline installer → central accounting integration smoke test.
 * Usage: node scripts/test-offline-accounting-sync.js [type]
 * Types: expense | return | purchase | supplier | payroll | credit | all
 */
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);

const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const SHARED = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
const TYPE = (process.argv[2] || 'all').toLowerCase();

async function rpc(method, args = []) {
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  });
  return res.json();
}

async function integratePayload(payload) {
  return rpc('acc:integrate', [payload]);
}

function journalExists(db, sourceType, sourceId, eventKey) {
  const row = db.prepare(
    `SELECT id, journal_number FROM acc_journals WHERE source_type=? AND source_id=? AND event_key=? AND status='posted' LIMIT 1`
  ).get(sourceType, sourceId, eventKey);
  return row;
}

async function testExpense(central, db, store, owner) {
  const exp = store.saveExpense({
    category: 'other', description: 'OFFLINE-TEST-EXP', amount: 12.5,
    expense_date: '2026-08-29', payment_method: 'cash'
  }, owner.id, owner.full_name);
  const id = exp.id || exp;
  const payload = central.buildIntegrationPayload('postFromExpense', [id]);
  const res = await integratePayload(payload);
  const sid = payload.stable_source_id;
  const j = journalExists(db, 'expense', sid, 'expense_main');
  return { type: 'expense', local_id: id, stable_source_id: sid, integrate: res, journal: j };
}

async function main() {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = SHARED;
  process.env.SHOP_POS_SYNC_URL = BASE;

  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const store = require('../electron/services/store');
  const session = require('../electron/services/session');
  const central = require('../electron/services/accounting-central');
  const owner = db.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);

  const results = [];

  if (TYPE === 'all' || TYPE === 'expense') {
    results.push(await testExpense(central, db, store, owner));
  }

  if (TYPE === 'all' || TYPE === 'return') {
    const ret = db.prepare(`SELECT id FROM returns WHERE status IN ('completed','reopened') ORDER BY id DESC LIMIT 1`).get();
    if (ret) {
      const payload = central.buildIntegrationPayload('postFromReturn', [ret.id]);
      const res = await integratePayload(payload);
      results.push({ type: 'return', local_id: ret.id, stable_source_id: payload?.stable_source_id, integrate: res, journal: journalExists(db, 'return', payload?.stable_source_id, 'return_main') });
    } else results.push({ type: 'return', skipped: 'no return row' });
  }

  if (TYPE === 'all' || TYPE === 'purchase') {
    const po = db.prepare(`SELECT id FROM purchase_orders WHERE status='received' ORDER BY id DESC LIMIT 1`).get();
    if (po) {
      const payload = central.buildIntegrationPayload('postFromPurchaseReceive', [po.id]);
      const res = await integratePayload(payload);
      results.push({ type: 'purchase', local_id: po.id, stable_source_id: payload?.stable_source_id, integrate: res, journal: journalExists(db, 'purchase_order', payload?.stable_source_id, 'po_receive') });
    } else results.push({ type: 'purchase', skipped: 'no received PO' });
  }

  if (TYPE === 'all' || TYPE === 'supplier') {
    const pay = db.prepare(`SELECT id FROM supplier_payments ORDER BY id DESC LIMIT 1`).get();
    if (pay) {
      const payload = central.buildIntegrationPayload('postFromSupplierPayment', [pay.id]);
      const res = await integratePayload(payload);
      results.push({ type: 'supplier_payment', local_id: pay.id, stable_source_id: payload?.stable_source_id, integrate: res, journal: journalExists(db, 'supplier_payment', payload?.stable_source_id, 'supplier_pay') });
    } else results.push({ type: 'supplier_payment', skipped: 'no payment' });
  }

  if (TYPE === 'all' || TYPE === 'payroll') {
    const pr = db.prepare(`SELECT id FROM employee_payroll WHERE status='paid' ORDER BY id DESC LIMIT 1`).get();
    if (pr) {
      const payload = central.buildIntegrationPayload('postFromPayroll', [pr.id]);
      const res = await integratePayload(payload);
      results.push({ type: 'payroll', local_id: pr.id, stable_source_id: payload?.stable_source_id, integrate: res, journal: journalExists(db, 'employee_payroll', payload?.stable_source_id, 'payroll_main') });
    } else results.push({ type: 'payroll', skipped: 'no paid payroll' });
  }

  if (TYPE === 'all' || TYPE === 'credit') {
    const led = db.prepare(`SELECT id FROM customer_credit_ledger WHERE type='payment' ORDER BY id DESC LIMIT 1`).get();
    if (led) {
      const payload = central.buildIntegrationPayload('postFromCustomerCreditPayment', [led.id]);
      const res = await integratePayload(payload);
      results.push({ type: 'customer_credit', local_id: led.id, stable_source_id: payload?.stable_source_id, integrate: res, journal: journalExists(db, 'customer_credit', payload?.stable_source_id, 'ccp_pay') });
    } else results.push({ type: 'customer_credit', skipped: 'no credit payment' });
  }

  // Idempotency: replay first expense payload twice
  if (results[0]?.stable_source_id && results[0]?.type === 'expense') {
    const payload = central.buildIntegrationPayload('postFromExpense', [results[0].local_id]);
    const r1 = await integratePayload(payload);
    const r2 = await integratePayload(payload);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM acc_journals WHERE source_type='expense' AND source_id=? AND event_key='expense_main'`).get(payload.stable_source_id)?.c;
    results.push({ type: 'idempotency_expense', replay1: r1?.success, replay2: r2?.success, journal_count: count });
  }

  console.log(JSON.stringify({ base: BASE, results }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
