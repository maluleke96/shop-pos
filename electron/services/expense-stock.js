/**
 * Expense ↔ inventory integration (single stock source of truth).
 * Reverses prior stock effects on edit/delete, then applies corrected quantities in product stock units.
 */
const { getDb } = require('../database/db');
const units = require('../../lib/units-catalog');
const li = require('../../lib/expense-line-items');

function ensureSchema() {
  units.ensureSchema();
  const db = getDb();
  const stmts = [
    `CREATE TABLE IF NOT EXISTS expense_stock_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      line_index INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      branch_id INTEGER,
      qty_original REAL NOT NULL,
      unit_original TEXT,
      qty_stock REAL NOT NULL,
      stock_unit TEXT,
      stock_movement_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(expense_id, line_index)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_expense_stock_expense ON expense_stock_effects(expense_id)',
    'CREATE INDEX IF NOT EXISTS idx_expense_stock_product ON expense_stock_effects(product_id)'
  ];
  for (const sql of stmts) {
    try { db.exec(sql); } catch (_) { /* pg migration */ }
  }
  try { db.exec('ALTER TABLE waste_records ADD COLUMN unit TEXT'); } catch (_) { /* */ }
  try { db.exec('ALTER TABLE waste_records ADD COLUMN qty_stock REAL'); } catch (_) { /* */ }
  try { db.exec('ALTER TABLE waste_records ADD COLUMN stock_unit TEXT'); } catch (_) { /* */ }
  try { db.exec('ALTER TABLE waste_records ADD COLUMN stock_movement_id INTEGER'); } catch (_) { /* */ }
  try { db.exec('ALTER TABLE waste_records ADD COLUMN stock_before REAL'); } catch (_) { /* */ }
  try { db.exec('ALTER TABLE waste_records ADD COLUMN stock_after REAL'); } catch (_) { /* */ }
}

function getEffects(expenseId) {
  ensureSchema();
  return getDb().prepare('SELECT * FROM expense_stock_effects WHERE expense_id = ? ORDER BY line_index')
    .all(Number(expenseId));
}

function lastMovementId(productId) {
  const row = getDb().prepare(
    'SELECT id FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1'
  ).get(Number(productId));
  return row?.id || null;
}

function reverseEffect(effect, adjustStockFn, actorId, note) {
  if (!effect?.product_id || !(effect.qty_stock > 0)) return;
  adjustStockFn(
    effect.product_id,
    effect.qty_stock,
    'remove',
    note || `Expense #${effect.expense_id} correction (reverse +${effect.qty_stock} ${effect.stock_unit || ''})`.trim(),
    actorId,
    'expense_reverse',
    effect.expense_id,
    effect.branch_id
  );
}

function applyLineStock(line, lineIndex, expenseId, branchId, adjustStockFn, actorId) {
  const productId = line.product_id != null ? Number(line.product_id) : null;
  if (!productId) return null;
  const product = getDb().prepare('SELECT id, name, item_type, stock_unit, unit FROM products WHERE id = ?').get(productId);
  if (!product) return null;
  if (line.stock_receive === false) return null;
  const qtyOrig = Math.max(Number(line.quantity) || 0, 0);
  if (!(qtyOrig > 0)) return null;
  const unitOrig = String(line.unit || line.stock_unit || product.stock_unit || product.unit || 'each').trim();
  const stockUnit = units.stockUnitOfProduct(productId);
  const conv = units.convertForProduct(productId, qtyOrig, unitOrig, stockUnit);
  if (!conv.ok) {
    throw new Error(`${product.name}: ${conv.reason || 'Cannot convert units for stock'}`);
  }
  const qtyStock = conv.qty;
  if (!(qtyStock > 0)) return null;
  const newStock = adjustStockFn(
    productId,
    qtyStock,
    'add',
    `Expense #${expenseId} purchase: ${qtyOrig} ${unitOrig}`,
    actorId,
    'expense',
    expenseId,
    branchId
  );
  const movId = lastMovementId(productId);
  getDb().prepare(`
    INSERT INTO expense_stock_effects (expense_id, line_index, product_id, branch_id, qty_original, unit_original, qty_stock, stock_unit, stock_movement_id)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(expenseId, lineIndex, productId, branchId, qtyOrig, unitOrig, qtyStock, stockUnit, movId);
  try {
    const rfc = require('./recipe-food-cost');
    if (line.unit_price > 0) {
      rfc.ensureSchema?.();
      getDb().prepare(`INSERT INTO rfc_ingredient_cost_history (product_id, unit_cost, stock_unit, source, note, observed_at, created_by)
        VALUES (?,?,?,?,?,?,?)`).run(productId, line.unit_price, stockUnit, 'expense', `Expense #${expenseId}`, new Date().toISOString(), actorId);
    }
  } catch (_) { /* optional */ }
  return { product_id: productId, qty_stock: qtyStock, stock_unit: stockUnit, new_stock: newStock };
}

function reconcileExpenseStock(expenseId, lineItems, branchId, adjustStockFn, actorId, auditMeta = {}) {
  ensureSchema();
  const prev = getEffects(expenseId);
  for (const eff of prev) {
    reverseEffect(eff, adjustStockFn, actorId, `Reconcile expense #${expenseId} line ${eff.line_index}`);
  }
  getDb().prepare('DELETE FROM expense_stock_effects WHERE expense_id = ?').run(Number(expenseId));
  const normalized = li.normalizeLineItems(lineItems);
  const applied = [];
  normalized.forEach((line, idx) => {
    const raw = lineItems[idx] || line;
    const merged = { ...line, product_id: raw.product_id ?? line.product_id, unit: raw.unit ?? line.unit, stock_receive: raw.stock_receive };
    const r = applyLineStock(merged, idx, expenseId, branchId, adjustStockFn, actorId);
    if (r) applied.push(r);
  });
  if (auditMeta.audit) {
    try {
      getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
        VALUES (?,?,?,?,?,?)`).run(
        actorId, auditMeta.username || null, 'expense_stock_reconcile', 'expense', expenseId,
        JSON.stringify({ applied, reversed: prev.length, reason: auditMeta.reason || null })
      );
    } catch (_) { /* */ }
  }
  return { applied, reversed: prev.length };
}

function reverseAllExpenseStock(expenseId, adjustStockFn, actorId) {
  ensureSchema();
  const prev = getEffects(expenseId);
  for (const eff of prev) {
    reverseEffect(eff, adjustStockFn, actorId, `Expense #${expenseId} deleted`);
  }
  getDb().prepare('DELETE FROM expense_stock_effects WHERE expense_id = ?').run(Number(expenseId));
  return prev.length;
}

function searchIngredients(query, limit = 25) {
  const q = String(query || '').trim();
  if (!q) return [];
  const like = `%${q.replace(/%/g, '')}%`;
  return getDb().prepare(`
    SELECT id, name, stock_unit, unit, stock_quantity, buying_price, item_type
    FROM products
    WHERE COALESCE(is_active, 1) = 1
      AND (item_type = 'ingredient' OR id IN (SELECT DISTINCT ingredient_product_id FROM product_recipe_items))
      AND name LIKE ?
    ORDER BY CASE WHEN item_type = 'ingredient' THEN 0 ELSE 1 END, name
    LIMIT ?
  `).all(like, Math.min(Math.max(Number(limit) || 25, 1), 100));
}

/** Wastage: convert qty+unit to stock unit qty for adjustStock */
function wasteQtyInStockUnit(productId, quantity, unit) {
  const stockUnit = units.stockUnitOfProduct(productId);
  const conv = units.convertForProduct(productId, Number(quantity) || 0, unit || stockUnit, stockUnit);
  if (!conv.ok) throw new Error(conv.reason || 'Invalid wastage unit');
  return { qty_stock: conv.qty, stock_unit: stockUnit, unit_original: unit || stockUnit, qty_original: Number(quantity) || 0 };
}

function applyApprovedWasteStock(row, adjustStockFn, actorId) {
  const wu = wasteQtyInStockUnit(row.product_id, row.quantity, row.unit || row.stock_unit);
  const db = getDb();
  const branchId = row.branch_id || null;
  let stockBefore = null;
  try {
    const branches = require('./branches');
    const bid = branchId || branches.resolveBranchScope({ id: actorId }, { forceTill: true }).stampId;
    const bs = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(row.product_id, bid);
    stockBefore = bs?.quantity ?? db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(row.product_id)?.stock_quantity;
  } catch (_) {
    stockBefore = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(row.product_id)?.stock_quantity;
  }
  const stockAfter = adjustStockFn(
    row.product_id,
    wu.qty_stock,
    'remove',
    `Waste approved: ${row.reason || 'Wastage'} (${wu.qty_original} ${wu.unit_original})`,
    actorId,
    'waste',
    row.id,
    branchId
  );
  db.prepare(`UPDATE waste_records SET unit=?, qty_stock=?, stock_unit=?, stock_before=?, stock_after=?, stock_movement_id=?
    WHERE id=?`).run(
    wu.unit_original, wu.qty_stock, wu.stock_unit, stockBefore, stockAfter, lastMovementId(row.product_id), row.id
  );
  return { ...wu, stock_before: stockBefore, stock_after: stockAfter };
}

function reverseApprovedWasteStock(row, adjustStockFn, actorId) {
  const qty = Number(row.qty_stock ?? row.quantity) || 0;
  if (!(qty > 0) || !row.product_id) return;
  adjustStockFn(
    row.product_id,
    qty,
    'add',
    `Waste correction restore #${row.id}`,
    actorId,
    'waste_reverse',
    row.id,
    row.branch_id
  );
}

function updateWasteRecord(id, data, adjustStockFn, actorId, actorName) {
  ensureSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM waste_records WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Waste record not found');
  const wasApproved = (row.status || '') === 'approved';
  if (wasApproved && row.product_id && String(row.damage_kind || '') !== 'property') {
    reverseApprovedWasteStock(row, adjustStockFn, actorId);
  }
  const qty = data.quantity != null ? Number(data.quantity) : Number(row.quantity);
  const unit = data.unit != null ? String(data.unit) : (row.unit || null);
  const productId = data.product_id != null ? Number(data.product_id) : Number(row.product_id);
  const reason = data.reason != null ? String(data.reason) : row.reason;
  const notes = data.notes != null ? data.notes : row.notes;
  db.prepare(`UPDATE waste_records SET product_id=?, quantity=?, unit=?, reason=?, notes=?, updated_at=datetime('now') WHERE id=?`)
    .run(productId, qty, unit, reason, notes, id);
  const next = db.prepare('SELECT * FROM waste_records WHERE id = ?').get(id);
  if (wasApproved && next.product_id && String(next.damage_kind || '') !== 'property') {
    applyApprovedWasteStock(next, adjustStockFn, actorId);
  }
  try {
    db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (?,?,?,?,?,?)`).run(actorId, actorName, 'update_waste', 'waste_records', id,
      JSON.stringify({ before: { quantity: row.quantity, unit: row.unit, product_id: row.product_id }, after: data, edit_reason: data.edit_reason || null }));
  } catch (_) { /* */ }
  return next;
}

module.exports = {
  ensureSchema,
  getEffects,
  reconcileExpenseStock,
  reverseAllExpenseStock,
  searchIngredients,
  wasteQtyInStockUnit,
  applyApprovedWasteStock,
  reverseApprovedWasteStock,
  updateWasteRecord
};
