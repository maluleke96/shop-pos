/**
 * Acceptance tests for expense ↔ stock units (local DB).
 * Usage: node scripts/test-expense-stock-units.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-units-'));
process.env.SHOP_POS_DATA = tmp;
process.env.ENTITLEMENTS_ENFORCE = 'false';
delete process.env.DATABASE_URL;
delete process.env.SHOP_POS_DATABASE_URL;

const { getDb } = require('../electron/database/db');
const store = require('../electron/services/store');
const expStock = require('../electron/services/expense-stock');
const rfc = require('../electron/services/recipe-food-cost');
const units = require('../lib/units-catalog');

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

function setupIngredient(name, stockUnit = 'kg') {
  const db = getDb();
  const r = db.prepare(`INSERT INTO products (name, selling_price, buying_price, stock_quantity, min_stock, unit, stock_unit, item_type, is_active)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(name, 0, 30, 0, 0, stockUnit, stockUnit, 'ingredient');
  const id = Number(r.lastInsertRowid) || Number(db.prepare('SELECT MAX(id) AS id FROM products').get()?.id);
  return id;
}

(async () => {
  await require('../electron/database/db').initDatabase();
  units.ensureSchema();
  expStock.ensureSchema();
  const ingId = setupIngredient('Test Green Pepper', 'kg');
  log('TEST 1 ingredient created', ingId > 0, `id=${ingId}`);

  const conv = rfc.convertUnits(ingId, 10, 'kg', 'g');
  log('TEST 4 kg→g', conv.ok && Math.abs(conv.qty - 10000) < 0.01, JSON.stringify(conv));

  const convL = rfc.convertUnits(ingId, 2.5, 'L', 'mL');
  log('TEST 5 L→mL (product without volume stock may fail)', !convL.ok || convL.qty === 2500, convL.reason || convL.qty);

  const actor = { id: 1, username: 'test', role: 'owner' };
  const eid = store.saveExpense({
    category: 'other',
    expense_date: new Date().toLocaleDateString('en-CA'),
    line_items: [{ name: 'Test Green Pepper', quantity: 10, unit: 'kg', unit_price: 30, amount: 300, product_id: ingId }],
    approval_status: 'approved'
  }, 1, 'test');
  log('TEST 1 purchase expense', eid > 0, `expense=${eid}`);
  const stock = getDb().prepare('SELECT stock_quantity FROM products WHERE id = ?').get(ingId);
  log('TEST 1 stock +10kg', Number(stock?.stock_quantity) === 10, stock?.stock_quantity);

  store.saveExpense({
    id: eid,
    category: 'other',
    expense_date: new Date().toLocaleDateString('en-CA'),
    line_items: [{ name: 'Test Green Pepper', quantity: 15, unit: 'kg', unit_price: 30, amount: 450, product_id: ingId }],
    approval_status: 'approved',
    stock_edit_reason: 'qty correction'
  }, 1, 'test');
  const stock2 = getDb().prepare('SELECT stock_quantity FROM products WHERE id = ?').get(ingId);
  log('TEST 12 edit qty 10→15 (+5 only)', Number(stock2?.stock_quantity) === 15, stock2?.stock_quantity);

  const manualId = store.saveExpense({
    category: 'other',
    expense_date: new Date().toLocaleDateString('en-CA'),
    line_items: [{ name: 'Cleaning Chemicals', quantity: 2.5, unit: 'L', unit_price: 100, amount: 250 }],
    approval_status: 'approved'
  }, 1, 'test');
  const chem = getDb().prepare("SELECT id FROM products WHERE name = 'Cleaning Chemicals'").get();
  log('TEST 2 manual no ingredient', manualId > 0 && !chem, chem ? 'duplicate created' : 'no product');

  const dec = rfc.convertUnits(ingId, 0.5, 'kg', 'g');
  log('TEST 3 decimal 0.5kg→g', dec.ok && dec.qty === 500, dec.qty);

  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
