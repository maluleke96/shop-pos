/**
 * Finish remaining live verification.
 * Local installer tests run first (SQLite). Central ledger via bootRpc child process.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const initSqlJs = require('sql.js/dist/sql-asm.js');

process.env.SHOP_POS_LOCAL_INSTALLER = '1';
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);

const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const SHARED = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
const REPORT = { tests: {}, at: new Date().toISOString() };

function pass(name, detail) { REPORT.tests[name] = { result: 'PASS', ...detail }; }
function fail(name, detail) { REPORT.tests[name] = { result: 'FAIL', ...detail }; }
function log(msg) { console.log(`[verify] ${msg}`); }

async function readLocalSql(sql) {
  const dbPath = path.join(SHARED, 'shop-pos.db');
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const r = db.exec(sql);
    if (!r.length) return [];
    return r[0].values.map((row) => {
      const o = {};
      r[0].columns.forEach((c, i) => { o[c] = row[i]; });
      return o;
    });
  } finally { db.close(); }
}

async function initLocalStore() {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = SHARED;
  process.env.SHOP_POS_SYNC_URL = BASE;
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const store = require('../electron/services/store');
  const session = require('../electron/services/session');
  const raw = dbMod.getDb();
  const owner = raw.prepare("SELECT * FROM users WHERE role='owner' AND is_active=1 ORDER BY id LIMIT 1").get();
  session.setUserSession(owner);
  return { store, owner, raw };
}

async function inspectHistorical() {
  const journals = await readLocalSql('SELECT id, journal_number, journal_date, description, source_type, source_id, reference, notes, total_debit, total_credit FROM acc_journals ORDER BY id');
  const accTables = await readLocalSql("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'acc_%'");
  REPORT.historical = { acc_table_count: accTables.length, local_journals: journals };
  return journals;
}

async function testPosSalePath() {
  const { store, owner, raw } = await initLocalStore();
  const product = raw.prepare('SELECT * FROM products WHERE is_active=1 ORDER BY id LIMIT 1').get();
  const stockBefore = Number(product.stock_quantity);
  const price = Number(product.selling_price) || 1;
  const result = store.completeSale({
    items: [{ product_id: product.id, product_name: product.name, quantity: 1, unit_price: price, buying_price: Number(product.buying_price) || 0 }],
    discount: 0, amount_paid: price, payments: [{ type: 'cash', amount: price }],
    notes: 'VERIFY-POS-CASHIER-PATH'
  }, owner.id, owner.full_name, owner.role);
  const sale = raw.prepare('SELECT * FROM sales WHERE id = ?').get(result.saleId);
  const stockAfter = Number(raw.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(product.id).stock_quantity);
  const central = require('../electron/services/accounting-central');
  const flush = await central.flushIntegrationOutbox();
  const outbox = raw.prepare("SELECT id, synced_at, error FROM sync_outbox WHERE entity_type='acc_integrate' ORDER BY id DESC LIMIT 1").get();
  if (sale && stockAfter < stockBefore) pass('pos_ui_sale_path', { sale_id: sale.id, receipt: sale.receipt_number, total: sale.total, stock_before: stockBefore, stock_after: stockAfter, flush, outbox });
  else fail('pos_ui_sale_path', { sale, stockBefore, stockAfter });
  return sale;
}

async function testOfflineQueue() {
  const { store, owner, raw } = await initLocalStore();
  const central = require('../electron/services/accounting-central');
  const product = raw.prepare('SELECT * FROM products WHERE is_active=1 ORDER BY id LIMIT 1').get();
  const price = Number(product.selling_price) || 1;
  const prev = process.env.SHOP_POS_SYNC_URL;
  process.env.SHOP_POS_SYNC_URL = 'http://127.0.0.1:9';
  const result = store.completeSale({
    items: [{ product_id: product.id, product_name: product.name, quantity: 1, unit_price: price, buying_price: 0 }],
    discount: 0, amount_paid: price, payments: [{ type: 'cash', amount: price }],
    notes: 'VERIFY-OFFLINE-QUEUE'
  }, owner.id, owner.full_name, owner.role);
  const pending = raw.prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE entity_type='acc_integrate' AND synced_at IS NULL").get().c;
  process.env.SHOP_POS_SYNC_URL = prev || BASE;
  const flush1 = await central.flushIntegrationOutbox();
  const flush2 = await central.flushIntegrationOutbox();
  if (pending > 0 && flush1.flushed >= 1) pass('offline_queue', { sale_id: result.saleId, pending, flush1, flush2 });
  else fail('offline_queue', { sale_id: result.saleId, pending, flush1, flush2 });
  return result.saleId;
}

async function testOnlineOrderFlow() {
  const { store, owner, raw } = await initLocalStore();
  const sync = require('../electron/services/sync');
  const child = spawnSync(process.execPath, [path.join(__dirname, 'verify-central-snapshot.js')], { encoding: 'utf8', env: process.env });
  let centralData = {};
  try { centralData = JSON.parse(child.stdout || '{}'); } catch (_) { centralData = { error: child.stderr || child.stdout }; }

  const orders = centralData.orders || [];
  const target = orders.find((o) => o.order_number === 'ONLINE-1002') || orders.find((o) => o.status === 'pending');
  if (!target) { fail('online_order_flow', { reason: 'no pending order', centralData }); return; }

  sync.importCloudOrders([target]);
  const local = raw.prepare('SELECT * FROM online_orders_local WHERE order_number = ? OR remote_id = ? ORDER BY id DESC LIMIT 1').get(target.order_number, target.id);
  const stockBefore = {};
  for (const it of JSON.parse(local?.items_json || '[]')) {
    const pid = it.remote_id || it.product_id;
    const p = pid && raw.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(pid);
    if (p) stockBefore[pid] = Number(p.stock_quantity);
  }

  if (local?.status !== 'pending') {
    const sale = local.sale_id ? raw.prepare('SELECT * FROM sales WHERE id = ?').get(local.sale_id) : null;
    pass('online_order_flow', { note: `already ${local.status}`, trace: { order_number: local.order_number, order_source: sale?.order_source, pos_sale_id: sale?.id } });
    return;
  }

  const accept = await store.acceptOnlineOrderAsSale(local.id, owner, { fulfillment: local.fulfillment_type || 'pickup' });
  const localAfter = raw.prepare('SELECT * FROM online_orders_local WHERE id = ?').get(local.id);
  const sale = raw.prepare('SELECT * FROM sales WHERE id = ?').get(localAfter.sale_id);
  const stockAfter = {};
  for (const pid of Object.keys(stockBefore)) stockAfter[pid] = Number(raw.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(pid).stock_quantity);
  const central = require('../electron/services/accounting-central');
  await central.flushIntegrationOutbox();

  const trace = { online_order_id: local.remote_id, order_number: local.order_number, order_source: sale?.order_source, pos_sale_id: sale?.id, receipt: sale?.receipt_number };
  const stockOk = !Object.keys(stockBefore).length || Object.keys(stockBefore).every((pid) => stockAfter[pid] < stockBefore[pid]);
  if (sale?.order_source === 'ONLINE' && stockOk) pass('online_order_flow', { trace, accept_sale_id: accept.saleId, stockBefore, stockAfter });
  else fail('online_order_flow', { trace, sale, stockBefore, stockAfter });
}

async function main() {
  REPORT.health = await fetch(`${BASE}/health`).then((r) => r.json());
  log(`health handlers=${REPORT.health.handlers}`);

  log('historical local journals…');
  await inspectHistorical();

  log('POS sale (store.completeSale = POS UI backend)…');
  await testPosSalePath().catch((e) => fail('pos_ui_sale_path', { error: e.message }));
  log('offline queue…');
  await testOfflineQueue().catch((e) => fail('offline_queue', { error: e.message }));
  log('online order accept…');
  await testOnlineOrderFlow().catch((e) => fail('online_order_flow', { error: e.message }));

  log('central ledger snapshot (child)…');
  const child = spawnSync(process.execPath, [path.join(__dirname, 'verify-central-snapshot.js')], { encoding: 'utf8', env: process.env });
  let central = {};
  try { central = JSON.parse(child.stdout || '{}'); } catch (_) { central = { parse_error: child.stderr }; }
  REPORT.central = central;

  if (central.integrity?.allOk) pass('integration_integrity', central.integrity);
  else if (central.integrity) fail('integration_integrity', central.integrity);

  const analysis = (REPORT.historical.local_journals || []).map((j) => {
    const match = (central.journals || []).find((c) => String(c.source_type) === String(j.source_type) && String(c.source_id) === String(j.source_id));
    return { journal_id: j.id, journal_number: j.journal_number, date: j.journal_date, amount: j.total_debit, description: j.description, source: `${j.source_type}:${j.source_id}`, exists_centrally: !!match, migration_needed: !match };
  });
  REPORT.historical.analysis = analysis;
  pass('historical_local_journals', { acc_table_count: REPORT.historical.acc_table_count, analysis });

  console.log(JSON.stringify(REPORT, null, 2));
  process.exit(Object.values(REPORT.tests).some((t) => t.result === 'FAIL') ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
