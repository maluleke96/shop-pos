/**
 * POS "Buy list" — items cashiers note for tomorrow's stock.
 * Confirmed in Expenses when purchased → existing expense stock flow.
 */
const { getDb } = require('../database/db');

function ensureSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tomorrow_stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity REAL DEFAULT 1,
      unit TEXT,
      product_id INTEGER,
      note TEXT,
      for_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      branch_id INTEGER,
      created_by INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      bought_at TEXT,
      expense_id INTEGER
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tomorrow_stock_status ON tomorrow_stock_items(status, for_date)'); } catch (_) { /* */ }
}

function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

function listItems(filters = {}) {
  ensureSchema();
  const db = getDb();
  const status = filters.status || 'open';
  const forDate = filters.for_date || null;
  let sql = `SELECT * FROM tomorrow_stock_items WHERE 1=1`;
  const params = [];
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (forDate) {
    sql += ' AND for_date = ?';
    params.push(forDate);
  }
  if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all') {
    sql += ' AND (branch_id IS NULL OR branch_id = ?)';
    params.push(Number(filters.branch_id));
  }
  sql += ' ORDER BY for_date ASC, id DESC';
  return db.prepare(sql).all(...params);
}

function addItem(data, actor = {}) {
  ensureSchema();
  const name = String(data?.name || '').trim();
  if (!name) throw new Error('Item name is required');
  const qty = Math.max(Number(data.quantity) || 1, 0.0001);
  const unit = String(data.unit || '').trim() || null;
  const note = String(data.note || '').trim() || null;
  const forDate = String(data.for_date || todayKey()).slice(0, 10);
  const productId = data.product_id != null && data.product_id !== '' ? Number(data.product_id) : null;
  const branchId = data.branch_id != null && data.branch_id !== '' ? Number(data.branch_id) : null;
  const r = getDb().prepare(`
    INSERT INTO tomorrow_stock_items
      (name, quantity, unit, product_id, note, for_date, status, branch_id, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    name,
    qty,
    unit,
    productId,
    note,
    forDate,
    branchId,
    actor.id || null,
    actor.full_name || actor.username || null
  );
  return getDb().prepare('SELECT * FROM tomorrow_stock_items WHERE id = ?').get(r.lastInsertRowid);
}

function updateItem(id, data = {}) {
  ensureSchema();
  const row = getDb().prepare('SELECT * FROM tomorrow_stock_items WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Buy-list item not found');
  const name = data.name != null ? String(data.name).trim() : row.name;
  if (!name) throw new Error('Item name is required');
  const qty = data.quantity != null ? Math.max(Number(data.quantity) || 1, 0.0001) : row.quantity;
  const unit = data.unit !== undefined ? (String(data.unit || '').trim() || null) : row.unit;
  const note = data.note !== undefined ? (String(data.note || '').trim() || null) : row.note;
  const forDate = data.for_date != null ? String(data.for_date).slice(0, 10) : row.for_date;
  const productId = data.product_id !== undefined
    ? (data.product_id != null && data.product_id !== '' ? Number(data.product_id) : null)
    : row.product_id;
  const status = data.status != null ? String(data.status) : row.status;
  getDb().prepare(`
    UPDATE tomorrow_stock_items SET
      name = ?, quantity = ?, unit = ?, product_id = ?, note = ?, for_date = ?, status = ?
    WHERE id = ?
  `).run(name, qty, unit, productId, note, forDate, status, Number(id));
  return getDb().prepare('SELECT * FROM tomorrow_stock_items WHERE id = ?').get(Number(id));
}

function removeItem(id) {
  ensureSchema();
  getDb().prepare('DELETE FROM tomorrow_stock_items WHERE id = ?').run(Number(id));
  return true;
}

function markBought(ids, expenseId = null) {
  ensureSchema();
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  if (!list.length) return { updated: 0 };
  const stmt = getDb().prepare(`
    UPDATE tomorrow_stock_items
    SET status = 'bought', bought_at = datetime('now'), expense_id = COALESCE(?, expense_id)
    WHERE id = ? AND status = 'open'
  `);
  let updated = 0;
  const exp = expenseId != null ? Number(expenseId) : null;
  for (const id of list) {
    const r = stmt.run(exp, id);
    updated += r.changes || 0;
  }
  return { updated };
}

module.exports = {
  ensureSchema,
  listItems,
  addItem,
  updateItem,
  removeItem,
  markBought,
  todayKey
};
