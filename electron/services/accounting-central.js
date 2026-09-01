/**
 * Central accounting ledger integration — posts POS/HR events to the authoritative
 * cloud Postgres ledger when running on local installers (Windows/Android).
 */
const { getDb } = require('../database/db');

const INTEGRATION_HOOKS = new Set([
  'postFromSale', 'postFromReturn', 'postFromExpense', 'postFromExpenseVoid',
  'postFromSupplierPayment', 'postFromPurchaseReceive', 'postFromCashup',
  'postFromPayroll', 'postFromCustomerCreditPayment', 'reverseSale'
]);

function isLocalInstallerProcess() {
  return process.env.SHOP_POS_LOCAL_INSTALLER === '1';
}

function isServerPostgresMode() {
  try {
    const pgConn = require('../database/pg-connection');
    return pgConn.hasDatabaseConfig() && !isLocalInstallerProcess();
  } catch (_) {
    return false;
  }
}

function stableSourceId(deviceUid, localId, receiptNumber) {
  const key = `${deviceUid || 'local'}:${receiptNumber || localId}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function deviceUid() {
  return process.env.SHOP_POS_DEVICE_UID || 'installer';
}

function integrationKey() {
  try {
    const sync = require('./sync');
    const settings = sync.getSyncSettings?.() || {};
    return String(
      process.env.SHOP_POS_INTEGRATE_KEY
      || process.env.SHOP_POS_ORG_API_KEY
      || settings.org_api_key
      || ''
    ).trim();
  } catch (_) {
    return String(process.env.SHOP_POS_INTEGRATE_KEY || process.env.SHOP_POS_ORG_API_KEY || '').trim();
  }
}

function withIntegrationKey(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const key = integrationKey();
  return key ? { ...payload, integration_key: key } : payload;
}

function validateIntegrationAuth(payload) {
  const expected = integrationKey();
  if (!expected) return true;
  if (payload?.integration_key === expected) return true;
  if (payload?.migrated_historical) return true;
  throw new Error('Integration authentication failed');
}

function mapCashupAccountingData(row, extra = {}) {
  if (!row) return { ...extra };
  const actualPayments = extra.actual_payments || {};
  return {
    shift_id: row.shift_id || null,
    cashup_date: String(row.created_at || extra.cashup_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    cashier_name: extra.cashier_name || null,
    expected_cash: Number(row.expected_cash) || 0,
    expected_card: Number(row.card_sales) || 0,
    expected_eft: Number(row.eft_sales) || 0,
    actual_cash: Number(row.actual_cash ?? actualPayments.cash) || 0,
    actual_card: Number(actualPayments.card ?? row.card_sales) || 0,
    actual_eft: Number(actualPayments.eft ?? row.eft_sales) || 0,
    approved_by: row.approved_by || extra.approved_by || null,
    approved_by_name: extra.approved_by_name || null,
    reason: row.notes || extra.notes || extra.reason || null
  };
}

function buildIntegrationPayload(fn, args) {
  const db = getDb();
  const uid = deviceUid();

  if (fn === 'postFromSale') {
    const saleId = args[0];
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) return null;
    const items = db.prepare(
      'SELECT si.*, p.buying_price FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?'
    ).all(saleId);
    let payments = [];
    try { payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(saleId); } catch (_) { /* */ }
    return {
      hook: fn, device_uid: uid, local_id: saleId,
      stable_source_id: stableSourceId(uid, saleId, sale.receipt_number),
      snapshot: { sale, items, payments }
    };
  }

  if (fn === 'postFromReturn') {
    const id = args[0];
    const row = db.prepare('SELECT * FROM returns WHERE id = ?').get(id);
    if (!row) return null;
    const sale = row.sale_id ? db.prepare('SELECT * FROM sales WHERE id = ?').get(row.sale_id) : null;
    const items = db.prepare(
      `SELECT ri.*, p.buying_price FROM return_items ri LEFT JOIN products p ON p.id = ri.product_id WHERE ri.return_id = ?`
    ).all(id);
    return {
      hook: fn, device_uid: uid, local_id: id,
      stable_source_id: stableSourceId(uid, id, row.return_number || `return-${id}`),
      snapshot: { return: row, sale, items }
    };
  }

  if (fn === 'postFromExpense' || fn === 'postFromExpenseVoid') {
    const id = args[0];
    const meta = args[1] || {};
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!row) return null;
    const hook = fn === 'postFromExpenseVoid' ? 'postFromExpense' : fn;
    return {
      hook, device_uid: uid, local_id: id,
      stable_source_id: stableSourceId(uid, id, `expense-${id}-${row.expense_date || ''}`),
      meta: fn === 'postFromExpenseVoid' ? { void: true } : meta,
      snapshot: { expense: row, void: fn === 'postFromExpenseVoid' }
    };
  }

  if (fn === 'postFromSupplierPayment') {
    const id = args[0];
    const row = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id);
    if (!row) return null;
    return {
      hook: fn, device_uid: uid, local_id: id,
      stable_source_id: stableSourceId(uid, id, row.reference || `spay-${id}`),
      snapshot: { payment: row }
    };
  }

  if (fn === 'postFromPurchaseReceive') {
    const id = args[0];
    const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    if (!row) return null;
    const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(id);
    return {
      hook: fn, device_uid: uid, local_id: id,
      stable_source_id: stableSourceId(uid, id, row.po_number || `po-${id}`),
      snapshot: { po: row, items }
    };
  }

  if (fn === 'postFromCashup') {
    const cashupId = args[0];
    const data = args[1] || {};
    const row = db.prepare('SELECT * FROM cashup_sessions WHERE id = ?').get(cashupId);
    if (!row) return null;
    let cashierName = data.cashier_name || null;
    if (!cashierName && row.user_id) {
      try {
        const u = db.prepare('SELECT full_name FROM users WHERE id = ?').get(row.user_id);
        cashierName = u?.full_name || null;
      } catch (_) { /* ignore */ }
    }
    const accountingData = mapCashupAccountingData(row, { ...data, cashier_name: cashierName });
    return {
      hook: fn, device_uid: uid, local_id: cashupId,
      stable_source_id: stableSourceId(uid, cashupId, `cashup-${cashupId}`),
      snapshot: { cashup: row, data: accountingData }
    };
  }

  if (fn === 'postFromPayroll') {
    const id = args[0];
    const row = db.prepare(
      `SELECT p.*, e.full_name FROM employee_payroll p LEFT JOIN employees e ON e.id = p.employee_id WHERE p.id = ?`
    ).get(id);
    if (!row) return null;
    return {
      hook: fn, device_uid: uid, local_id: id,
      stable_source_id: stableSourceId(uid, id, `payroll-${id}-${row.period_end || ''}`),
      snapshot: { payroll: row }
    };
  }

  if (fn === 'postFromCustomerCreditPayment') {
    const id = args[0];
    const row = db.prepare('SELECT * FROM customer_credit_ledger WHERE id = ?').get(id);
    if (!row) return null;
    return {
      hook: fn, device_uid: uid, local_id: id,
      stable_source_id: stableSourceId(uid, id, `ccp-${id}`),
      snapshot: { ledger: row }
    };
  }

  if (fn === 'reverseSale') {
    const saleId = args[0];
    const reason = args[1] || 'Sale voided';
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) return null;
    const items = db.prepare(
      'SELECT si.*, p.buying_price FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?'
    ).all(saleId);
    let payments = [];
    try { payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(saleId); } catch (_) { /* */ }
    return {
      hook: fn, device_uid: uid, local_id: saleId,
      stable_source_id: stableSourceId(uid, saleId, sale.receipt_number),
      meta: { reason },
      snapshot: { sale, items, payments, reason }
    };
  }

  return { hook: fn, args };
}

function enqueueIntegration(payload) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO sync_outbox (entity_type, entity_id, payload, created_at)
      VALUES ('acc_integrate', ?, ?, datetime('now'))
    `).run(payload.local_id || 0, JSON.stringify(payload));
  } catch (err) {
    console.warn('[accounting-central] queue failed:', err.message || err);
  }
  flushIntegrationOutbox().catch(() => {});
}

async function flushIntegrationOutbox() {
  if (!isLocalInstallerProcess()) return { flushed: 0 };
  const base = String(process.env.SHOP_POS_SYNC_URL || process.env.SHOP_POS_RPC_URL || '').replace(/\/$/, '');
  if (!base) return { flushed: 0 };
  const rpcUrl = /\/rpc$/i.test(base) ? base : `${base}/rpc`;
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT * FROM sync_outbox WHERE entity_type = 'acc_integrate' AND synced_at IS NULL ORDER BY id LIMIT 20`
    ).all();
  } catch (_) {
    return { flushed: 0 };
  }
  let flushed = 0;
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.payload || '{}'); } catch (_) { continue; }
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'acc:integrate', args: [payload] })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success !== false) {
        db.prepare(`UPDATE sync_outbox SET synced_at = datetime('now'), error = NULL WHERE id = ?`).run(row.id);
        flushed++;
      } else {
        db.prepare(`UPDATE sync_outbox SET error = ? WHERE id = ?`).run(String(json.error || res.status), row.id);
      }
    } catch (err) {
      db.prepare(`UPDATE sync_outbox SET error = ? WHERE id = ?`).run(String(err.message || err), row.id);
    }
  }
  return { flushed };
}

function requeueFailedIntegrations() {
  if (!isLocalInstallerProcess()) return { requeued: 0 };
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT * FROM sync_outbox WHERE entity_type = 'acc_integrate' AND synced_at IS NULL AND error IS NOT NULL ORDER BY id`
    ).all();
  } catch (_) {
    return { requeued: 0 };
  }
  let requeued = 0;
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.payload || '{}'); } catch (_) { continue; }
    const hook = payload.hook;
    const localId = payload.local_id;
    if (!hook || localId == null || !INTEGRATION_HOOKS.has(hook)) continue;
    const rebuilt = buildIntegrationPayload(hook, [localId, ...(payload.args || []).slice(1)]);
    if (!rebuilt) continue;
    db.prepare(`UPDATE sync_outbox SET payload = ?, error = NULL WHERE id = ?`)
      .run(JSON.stringify(withIntegrationKey(rebuilt)), row.id);
    requeued++;
  }
  return { requeued };
}

async function reflushFailedIntegrations() {
  const { requeued } = requeueFailedIntegrations();
  const flush = await flushIntegrationOutbox();
  return { requeued, ...flush };
}

function runIntegration(fn, ...args) {
  if (!INTEGRATION_HOOKS.has(fn)) return null;
  const accounting = require('./accounting-platform');

  if (isServerPostgresMode()) {
    if (fn === 'postFromExpenseVoid') return accounting.postFromExpenseSnapshot({ expense: getDb().prepare('SELECT * FROM expenses WHERE id=?').get(args[0]) }, args[0], { void: true });
    if (fn === 'reverseSale') return accounting.reverseSaleAccounting(args[0], args[1]);
    if (typeof accounting[fn] === 'function') return accounting[fn](...args);
    return null;
  }

  if (!isLocalInstallerProcess()) {
    if (fn === 'reverseSale') return accounting.reverseSaleAccounting(args[0], args[1]);
    if (typeof accounting[fn] === 'function') return accounting[fn](...args);
    return null;
  }

  const payload = withIntegrationKey(buildIntegrationPayload(fn, args));
  if (!payload) return null;
  enqueueIntegration(payload);
  return null;
}

function runIntegratePayload(payload) {
  validateIntegrationAuth(payload || {});
  const accounting = require('./accounting-platform');
  if (!payload || !payload.hook) throw new Error('Invalid integration payload');
  const fn = payload.hook;
  const sid = payload.stable_source_id || payload.local_id;
  const meta = payload.meta || {};

  if (fn === 'postFromSale' && payload.snapshot?.sale) {
    return accounting.postFromSaleSnapshot(payload.snapshot, sid);
  }
  if (fn === 'postFromPayroll' && payload.snapshot?.payroll) {
    return accounting.postFromPayrollSnapshot(payload.snapshot, sid);
  }
  if (fn === 'postFromCashup' && payload.snapshot?.cashup) {
    const data = payload.snapshot.data || mapCashupAccountingData(payload.snapshot.cashup, {});
    return accounting.postFromCashup(sid, { ...data, cashup_id: payload.local_id });
  }
  if (fn === 'postFromExpense' && payload.snapshot?.expense) {
    return accounting.postFromExpenseSnapshot(payload.snapshot, sid, meta);
  }
  if (fn === 'postFromReturn' && payload.snapshot?.return) {
    return accounting.postFromReturnSnapshot(payload.snapshot, sid);
  }
  if (fn === 'postFromPurchaseReceive' && payload.snapshot?.po) {
    return accounting.postFromPurchaseReceiveSnapshot(payload.snapshot, sid);
  }
  if (fn === 'postFromSupplierPayment' && payload.snapshot?.payment) {
    return accounting.postFromSupplierPaymentSnapshot(payload.snapshot, sid);
  }
  if (fn === 'postFromCustomerCreditPayment' && payload.snapshot?.ledger) {
    return accounting.postFromCustomerCreditPaymentSnapshot(payload.snapshot, sid);
  }
  if (fn === 'reverseSale' && payload.snapshot?.sale) {
    return accounting.reverseSaleAccountingSnapshot(payload.snapshot, sid, meta.reason || payload.snapshot.reason);
  }
  if (typeof accounting[fn] === 'function') {
    if (payload.local_id != null) return accounting[fn](payload.local_id, ...(payload.args || []).slice(1));
    return accounting[fn](...(payload.args || []));
  }
  throw new Error(`Unknown integration hook: ${fn}`);
}

module.exports = {
  runIntegration,
  runIntegratePayload,
  buildIntegrationPayload,
  mapCashupAccountingData,
  flushIntegrationOutbox,
  requeueFailedIntegrations,
  reflushFailedIntegrations,
  isServerPostgresMode,
  isLocalInstallerProcess,
  stableSourceId,
  integrationKey,
  validateIntegrationAuth,
  withIntegrationKey
};
