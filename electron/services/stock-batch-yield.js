/**
 * Stock Batch & Yield — track purchase → portions → POS sales → revenue/profit/waste.
 * Consumed automatically from completeSale via consumeSalePortions().
 */
const { getDb } = require('../database/db');

const OPEN_STATUSES = ['active', 'near_completion', 'expected_yield_reached', 'exceeded_expected_yield'];

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayLocal() {
  return new Date().toLocaleDateString('en-CA');
}

function nowIso() {
  return new Date().toISOString();
}

function ensureSchema() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_number TEXT NOT NULL UNIQUE,
        stock_product_id INTEGER,
        stock_product_name TEXT NOT NULL,
        selling_product_id INTEGER NOT NULL,
        selling_product_name TEXT,
        supplier_name TEXT,
        purchase_date TEXT NOT NULL,
        invoice_ref TEXT,
        quantity_purchased REAL DEFAULT 0,
        unit TEXT DEFAULT 'kg',
        purchase_cost REAL NOT NULL DEFAULT 0,
        expected_yield REAL NOT NULL DEFAULT 0,
        actual_yield REAL,
        selling_price REAL NOT NULL DEFAULT 0,
        portions_sold REAL NOT NULL DEFAULT 0,
        portions_wasted REAL NOT NULL DEFAULT 0,
        portions_adjusted REAL NOT NULL DEFAULT 0,
        revenue REAL NOT NULL DEFAULT 0,
        consumed_cost REAL NOT NULL DEFAULT 0,
        branch_id INTEGER,
        branch_name TEXT,
        storage_location TEXT,
        notes TEXT,
        expense_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        fifo_rank INTEGER,
        closed_at TEXT,
        closed_by INTEGER,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS stock_batch_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        quantity REAL,
        sale_id INTEGER,
        sale_item_id INTEGER,
        reason TEXT,
        notes TEXT,
        user_id INTEGER,
        user_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS stock_batch_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fifo_enabled INTEGER NOT NULL DEFAULT 1,
        auto_link_expense INTEGER NOT NULL DEFAULT 1,
        near_completion_pct REAL NOT NULL DEFAULT 80,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  } catch (_) { /* */ }
  try {
    db.prepare('INSERT OR IGNORE INTO stock_batch_settings (id, fifo_enabled, auto_link_expense, near_completion_pct) VALUES (1, 1, 1, 80)').run();
  } catch (_) {
    try {
      db.prepare(`INSERT INTO stock_batch_settings (id, fifo_enabled, auto_link_expense, near_completion_pct)
        SELECT 1, 1, 1, 80 WHERE NOT EXISTS (SELECT 1 FROM stock_batch_settings WHERE id = 1)`).run();
    } catch (__) { /* */ }
  }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_stock_batches_selling ON stock_batches(selling_product_id, status, purchase_date, id)'); } catch (_) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_stock_batch_events_batch ON stock_batch_events(batch_id, id)'); } catch (_) { /* */ }
}

function getSettings() {
  ensureSchema();
  const row = getDb().prepare('SELECT * FROM stock_batch_settings WHERE id = 1').get();
  return {
    fifo_enabled: row?.fifo_enabled !== 0 && row?.fifo_enabled !== false,
    auto_link_expense: row?.auto_link_expense !== 0 && row?.auto_link_expense !== false,
    near_completion_pct: Number(row?.near_completion_pct) > 0 ? Number(row.near_completion_pct) : 80
  };
}

function saveSettings(data, actor) {
  ensureSchema();
  requireRole(actor);
  getDb().prepare(`
    UPDATE stock_batch_settings SET
      fifo_enabled = ?, auto_link_expense = ?, near_completion_pct = ?, updated_at = ?
    WHERE id = 1
  `).run(
    data.fifo_enabled === false || data.fifo_enabled === 0 ? 0 : 1,
    data.auto_link_expense === false || data.auto_link_expense === 0 ? 0 : 1,
    Number(data.near_completion_pct) > 0 ? Number(data.near_completion_pct) : 80,
    nowIso()
  );
  return getSettings();
}

function requireRole(actor) {
  const r = String(actor?.role || '').toLowerCase();
  if (!['owner', 'manager', 'assistant_manager', 'supervisor'].includes(r)) {
    throw new Error('Not authorized for Stock Batch & Yield');
  }
  return actor;
}

function yieldBase(batch) {
  const actual = batch.actual_yield != null && batch.actual_yield !== '' ? Number(batch.actual_yield) : null;
  if (actual != null && Number.isFinite(actual) && actual > 0) return actual;
  return Math.max(0, Number(batch.expected_yield) || 0);
}

function costPerPortion(batch) {
  const y = yieldBase(batch);
  const cost = Number(batch.purchase_cost) || 0;
  return y > 0 ? money(cost / y) : 0;
}

function computeDerived(batch) {
  const expected = Math.max(0, Number(batch.expected_yield) || 0);
  const actual = batch.actual_yield != null && batch.actual_yield !== '' ? Number(batch.actual_yield) : null;
  const sold = Math.max(0, Number(batch.portions_sold) || 0);
  const wasted = Math.max(0, Number(batch.portions_wasted) || 0);
  const adjusted = Number(batch.portions_adjusted) || 0;
  const base = yieldBase(batch);
  const remaining = money(base - sold - wasted - Math.max(0, adjusted));
  const price = Number(batch.selling_price) || 0;
  const purchaseCost = Number(batch.purchase_cost) || 0;
  const cpp = costPerPortion(batch);
  const revenue = money(Number(batch.revenue) || sold * price);
  const consumedCost = money(Number(batch.consumed_cost) != null && batch.consumed_cost !== ''
    ? batch.consumed_cost
    : (sold + wasted) * cpp);
  const grossProfit = money(revenue - consumedCost);
  const expectedRevenue = money(expected * price);
  const remainingPotential = money(Math.max(0, remaining) * price);
  const extraYield = money(Math.max(0, sold - expected));
  const progressPct = expected > 0 ? Math.min(999, Math.round((sold / expected) * 1000) / 10) : 0;
  return {
    expected_yield: expected,
    actual_yield: actual,
    portions_sold: sold,
    portions_wasted: wasted,
    portions_adjusted: adjusted,
    remaining,
    cost_per_portion: cpp,
    cost_per_expected_portion: expected > 0 ? money(purchaseCost / expected) : 0,
    cost_per_actual_portion: actual > 0 ? money(purchaseCost / actual) : null,
    revenue,
    expected_revenue: expectedRevenue,
    remaining_potential_revenue: remainingPotential,
    consumed_cost: consumedCost,
    gross_profit: grossProfit,
    extra_yield: extraYield,
    progress_pct: progressPct,
    purchase_cost: purchaseCost,
    selling_price: price
  };
}

function deriveStatus(batch, settings) {
  if (batch.status === 'cancelled') return 'cancelled';
  if (batch.status === 'finished' || batch.closed_at) return 'finished';
  const d = computeDerived(batch);
  const nearPct = settings?.near_completion_pct || 80;
  if (d.actual_yield != null && d.actual_yield > 0 && (d.portions_sold + d.portions_wasted) >= d.actual_yield - 0.0001) {
    return 'finished';
  }
  if (d.portions_sold > d.expected_yield + 0.0001) return 'exceeded_expected_yield';
  if (d.expected_yield > 0 && d.portions_sold >= d.expected_yield - 0.0001) return 'expected_yield_reached';
  if (d.expected_yield > 0 && d.progress_pct >= nearPct) return 'near_completion';
  return 'active';
}

function enrich(batch) {
  if (!batch) return null;
  const settings = getSettings();
  const derived = computeDerived(batch);
  const status = deriveStatus(batch, settings);
  return {
    ...batch,
    ...derived,
    status,
    status_label: statusLabel(status)
  };
}

function statusLabel(st) {
  const map = {
    active: 'Active',
    near_completion: 'Near Completion',
    expected_yield_reached: 'Expected Yield Reached',
    exceeded_expected_yield: 'Exceeded Expected Yield',
    finished: 'Finished',
    cancelled: 'Cancelled'
  };
  return map[st] || st;
}

function logEvent(batchId, action, opts = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO stock_batch_events (batch_id, action, old_value, new_value, quantity, sale_id, sale_item_id, reason, notes, user_id, user_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    batchId,
    action,
    opts.old_value != null ? String(opts.old_value) : null,
    opts.new_value != null ? String(opts.new_value) : null,
    opts.quantity != null ? Number(opts.quantity) : null,
    opts.sale_id || null,
    opts.sale_item_id || null,
    opts.reason || null,
    opts.notes || null,
    opts.user_id || null,
    opts.user_name || null
  );
}

function nextBatchNumber(stockName, purchaseDate) {
  const db = getDb();
  const d = String(purchaseDate || todayLocal()).replace(/-/g, '');
  const dd = d.length === 8 ? d.slice(6, 8) + d.slice(4, 6) + d.slice(0, 4) : d;
  const words = String(stockName || 'XX').trim().split(/\s+/).filter(Boolean);
  const prefix = (words.map((w) => w[0]).join('') || 'XX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'BB';
  const like = `${prefix}-${dd}-%`;
  const rows = db.prepare('SELECT batch_number FROM stock_batches WHERE batch_number LIKE ?').all(like);
  let max = 0;
  for (const r of rows) {
    const m = String(r.batch_number || '').match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${dd}-${String(max + 1).padStart(3, '0')}`;
}

function getProduct(id) {
  if (!id) return null;
  return getDb().prepare('SELECT id, name, selling_price, unit, stock_unit FROM products WHERE id = ?').get(id);
}

function linkExpense(data, actor) {
  const settings = getSettings();
  if (!settings.auto_link_expense) return data.expense_id || null;
  if (data.expense_id) return data.expense_id;
  if (data.skip_expense) return null;
  try {
    const store = require('./store');
    const exp = store.saveExpense({
      category: 'Stock Purchase',
      amount: Number(data.purchase_cost) || 0,
      expense_date: data.purchase_date || todayLocal(),
      description: `Stock batch: ${data.stock_product_name || data.stock_name || 'Stock'} (${data.expected_yield || 0} portions)`,
      vendor_name: data.supplier_name || null,
      payment_method: data.payment_method || 'cash',
      funding_source: data.funding_source || 'business',
      line_items: [{
        name: data.stock_product_name || data.stock_name || 'Stock',
        quantity: Number(data.quantity_purchased) || 1,
        unit_price: Number(data.purchase_cost) || 0,
        amount: Number(data.purchase_cost) || 0,
        product_id: data.stock_product_id || null
      }],
      notes: data.invoice_ref ? `Invoice/Ref: ${data.invoice_ref}` : (data.notes || null)
    }, actor?.id, actor?.full_name || actor?.username || 'system');
    return exp?.id || exp?.lastInsertRowid || null;
  } catch (e) {
    console.warn('[stock-batch] link expense:', e.message || e);
    return null;
  }
}

function createBatch(data, actor) {
  ensureSchema();
  requireRole(actor);
  const db = getDb();
  const stockProd = getProduct(data.stock_product_id);
  const sellProd = getProduct(data.selling_product_id);
  if (!data.selling_product_id && !sellProd) throw new Error('Select the selling product connected to this batch');
  const stockName = data.stock_product_name || stockProd?.name || data.stock_name;
  if (!stockName) throw new Error('Enter the stock / product name purchased');
  const expected = Number(data.expected_yield);
  if (!(expected > 0)) throw new Error('Expected yield (portions/plates) is required');
  const cost = Number(data.purchase_cost);
  if (!(cost >= 0) || Number.isNaN(cost)) throw new Error('Purchase cost is required');
  const sellPrice = Number(data.selling_price != null ? data.selling_price : sellProd?.selling_price);
  if (!(sellPrice >= 0) || Number.isNaN(sellPrice)) throw new Error('Selling price is required');
  const purchaseDate = data.purchase_date || todayLocal();
  const batchNumber = data.batch_number || nextBatchNumber(stockName, purchaseDate);
  const expenseId = linkExpense({
    ...data,
    stock_product_name: stockName,
    expected_yield: expected,
    purchase_cost: cost,
    purchase_date: purchaseDate
  }, actor);

  let branchName = data.branch_name || null;
  if (!branchName && data.branch_id) {
    try {
      branchName = db.prepare('SELECT name FROM branches WHERE id = ?').get(data.branch_id)?.name || null;
    } catch (_) { /* */ }
  }

  const r = db.prepare(`
    INSERT INTO stock_batches (
      batch_number, stock_product_id, stock_product_name, selling_product_id, selling_product_name,
      supplier_name, purchase_date, invoice_ref, quantity_purchased, unit, purchase_cost,
      expected_yield, actual_yield, selling_price, branch_id, branch_name, storage_location,
      notes, expense_id, status, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    batchNumber,
    data.stock_product_id || stockProd?.id || null,
    stockName,
    data.selling_product_id,
    data.selling_product_name || sellProd?.name || null,
    data.supplier_name || null,
    purchaseDate,
    data.invoice_ref || null,
    Number(data.quantity_purchased) || 0,
    data.unit || stockProd?.unit || stockProd?.stock_unit || 'kg',
    cost,
    expected,
    data.actual_yield != null && data.actual_yield !== '' ? Number(data.actual_yield) : null,
    sellPrice,
    data.branch_id || null,
    branchName,
    data.storage_location || null,
    data.notes || null,
    expenseId,
    'active',
    actor?.id || null,
    nowIso(),
    nowIso()
  );
  const id = r.lastInsertRowid;
  logEvent(id, 'batch_created', {
    new_value: JSON.stringify({ batch_number: batchNumber, purchase_cost: cost, expected_yield: expected, expense_id: expenseId }),
    user_id: actor?.id,
    user_name: actor?.full_name || actor?.username
  });
  if (expenseId) {
    logEvent(id, 'purchase_linked', {
      new_value: String(expenseId),
      user_id: actor?.id,
      user_name: actor?.full_name || actor?.username
    });
  }
  return getBatch(id);
}

function getBatch(id) {
  ensureSchema();
  const row = getDb().prepare('SELECT * FROM stock_batches WHERE id = ?').get(id);
  return enrich(row);
}

function listBatches(filters = {}) {
  ensureSchema();
  const params = [];
  let sql = 'SELECT * FROM stock_batches WHERE 1=1';
  if (filters.status) {
    if (filters.status === 'open') {
      sql += ` AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`;
      params.push(...OPEN_STATUSES);
    } else {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
  }
  if (filters.branch_id) { sql += ' AND branch_id = ?'; params.push(filters.branch_id); }
  if (filters.selling_product_id) { sql += ' AND selling_product_id = ?'; params.push(filters.selling_product_id); }
  if (filters.stock_product_id) { sql += ' AND stock_product_id = ?'; params.push(filters.stock_product_id); }
  if (filters.supplier) { sql += ' AND lower(supplier_name) LIKE lower(?)'; params.push(`%${filters.supplier}%`); }
  if (filters.q) {
    sql += ' AND (lower(batch_number) LIKE lower(?) OR lower(stock_product_name) LIKE lower(?) OR lower(selling_product_name) LIKE lower(?))';
    const q = `%${filters.q}%`;
    params.push(q, q, q);
  }
  if (filters.from) { sql += ' AND purchase_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND purchase_date <= ?'; params.push(filters.to); }
  sql += ' ORDER BY purchase_date DESC, id DESC';
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(Math.min(Number(filters.limit) || 200, 500));
  }
  return getDb().prepare(sql).all(...params).map(enrich);
}

function dashboard(filters = {}) {
  const rows = listBatches({ ...filters, limit: 500 });
  const open = rows.filter((b) => OPEN_STATUSES.includes(b.status));
  const finished = rows.filter((b) => b.status === 'finished');
  const near = open.filter((b) => b.status === 'near_completion' || b.status === 'expected_yield_reached');
  const sum = (arr, key) => money(arr.reduce((s, r) => s + (Number(r[key]) || 0), 0));
  return {
    active_batches: open.length,
    completed_batches: finished.length,
    near_completion: near.length,
    total_purchase_cost: sum(open, 'purchase_cost'),
    revenue_generated: sum(rows, 'revenue'),
    estimated_gross_profit: sum(rows, 'gross_profit'),
    expected_portions: sum(open, 'expected_yield'),
    portions_sold: sum(rows, 'portions_sold'),
    waste: sum(rows, 'portions_wasted'),
    settings: getSettings()
  };
}

function refreshBatchStatus(id) {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(id);
  if (!batch || batch.status === 'cancelled' || batch.closed_at) return enrich(batch);
  const next = deriveStatus(batch, getSettings());
  if (next !== batch.status) {
    if (next === 'finished') {
      db.prepare('UPDATE stock_batches SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?')
        .run(next, nowIso(), nowIso(), id);
    } else {
      db.prepare('UPDATE stock_batches SET status = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), id);
    }
    logEvent(id, 'status_changed', { old_value: batch.status, new_value: next });
  } else {
    db.prepare('UPDATE stock_batches SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  }
  return getBatch(id);
}

function applySaleToBatch(batchId, portions, revenueAdd, opts = {}) {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  if (!batch || batch.status === 'finished' || batch.status === 'cancelled') return null;

  const qty = Number(portions) || 0;
  if (qty <= 0) return null;
  const cpp = costPerPortion(batch);
  const rev = money(revenueAdd != null ? revenueAdd : qty * (Number(batch.selling_price) || 0));
  const costAdd = money(qty * cpp);
  const newSold = money((Number(batch.portions_sold) || 0) + qty);
  const newRev = money((Number(batch.revenue) || 0) + rev);
  const newCost = money((Number(batch.consumed_cost) || 0) + costAdd);

  db.prepare(`
    UPDATE stock_batches SET
      portions_sold = ?, revenue = ?, consumed_cost = ?, updated_at = ?
    WHERE id = ?
  `).run(newSold, newRev, newCost, nowIso(), batchId);

  logEvent(batchId, 'portion_sold', {
    old_value: String(batch.portions_sold),
    new_value: String(newSold),
    quantity: qty,
    sale_id: opts.sale_id,
    sale_item_id: opts.sale_item_id,
    user_id: opts.user_id,
    user_name: opts.user_name || 'POS'
  });
  return refreshBatchStatus(batchId);
}

/**
 * FIFO consume portions for a selling product from open batches.
 * Continues past expected yield (does not stop at expected).
 */
function consumeSalePortions(sellingProductId, quantity, opts = {}) {
  ensureSchema();
  const qtyTotal = Number(quantity) || 0;
  if (!sellingProductId || qtyTotal <= 0) return { consumed: 0, batches: [] };
  const settings = getSettings();
  const db = getDb();
  const order = settings.fifo_enabled !== false
    ? 'ORDER BY purchase_date ASC, id ASC'
    : 'ORDER BY id DESC';
  const open = db.prepare(`
    SELECT * FROM stock_batches
    WHERE selling_product_id = ?
      AND status NOT IN ('finished', 'cancelled')
    ${order}
  `).all(sellingProductId);

  let left = qtyTotal;
  const touched = [];
  const unitPrice = Number(opts.unit_price);
  for (const batch of open) {
    if (left <= 0) break;
    // Prefer consuming up to "remaining" based on actual yield if set; otherwise take all remaining sales into this batch (can exceed expected)
    const d = computeDerived(batch);
    let take;
    if (d.actual_yield != null && d.actual_yield > 0) {
      take = Math.min(left, Math.max(0, d.remaining));
      if (take <= 0) continue;
    } else {
      // No actual yield — keep pouring sales into oldest open batch until manually finished
      // If multiple open batches, still FIFO for "expected capacity" first then overflow to same batch (exceed)
      take = left;
      if (settings.fifo_enabled !== false && open.length > 1) {
        // Fill up to expected+waste capacity first on older batches before spilling to next? Spec says continue on SAME batch past expected.
        // So one active batch absorbs all; only move to next when batch is Finished.
        // Therefore: consume entirely into the first (oldest) non-finished batch.
        take = left;
      }
    }
    if (take <= 0) continue;
    const rev = Number.isFinite(unitPrice) ? money(take * unitPrice) : null;
    const updated = applySaleToBatch(batch.id, take, rev, opts);
    if (updated) {
      touched.push(updated);
      left = money(left - take);
      // With no actual_yield, oldest batch takes everything
      if (!(d.actual_yield > 0)) break;
    }
  }
  return { consumed: money(qtyTotal - left), remaining_unassigned: left, batches: touched };
}

function recordWaste(batchId, data, actor) {
  ensureSchema();
  requireRole(actor);
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');
  if (batch.status === 'cancelled') throw new Error('Batch is cancelled');
  const qty = Number(data.quantity);
  if (!(qty > 0)) throw new Error('Waste quantity is required');
  const cpp = costPerPortion(batch);
  const newWaste = money((Number(batch.portions_wasted) || 0) + qty);
  const newCost = money((Number(batch.consumed_cost) || 0) + qty * cpp);
  db.prepare(`
    UPDATE stock_batches SET portions_wasted = ?, consumed_cost = ?, updated_at = ? WHERE id = ?
  `).run(newWaste, newCost, nowIso(), batchId);
  logEvent(batchId, 'waste_recorded', {
    old_value: String(batch.portions_wasted),
    new_value: String(newWaste),
    quantity: qty,
    reason: data.reason || null,
    notes: data.notes || null,
    user_id: actor?.id,
    user_name: actor?.full_name || actor?.username || data.staff_name
  });
  return refreshBatchStatus(batchId);
}

function setActualYield(batchId, actualYield, actor) {
  ensureSchema();
  requireRole(actor);
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');
  const y = Number(actualYield);
  if (!(y > 0)) throw new Error('Actual yield must be greater than zero');
  db.prepare('UPDATE stock_batches SET actual_yield = ?, updated_at = ? WHERE id = ?').run(y, nowIso(), batchId);
  const updated = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  const cpp = costPerPortion(updated);
  const soldW = (Number(updated.portions_sold) || 0) + (Number(updated.portions_wasted) || 0);
  db.prepare('UPDATE stock_batches SET consumed_cost = ?, updated_at = ? WHERE id = ?')
    .run(money(soldW * cpp), nowIso(), batchId);
  logEvent(batchId, 'actual_yield_set', {
    old_value: batch.actual_yield != null ? String(batch.actual_yield) : null,
    new_value: String(y),
    user_id: actor?.id,
    user_name: actor?.full_name || actor?.username
  });
  return refreshBatchStatus(batchId);
}

function updateBatch(batchId, data, actor) {
  ensureSchema();
  requireRole(actor);
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');
  const fields = {
    supplier_name: data.supplier_name != null ? data.supplier_name : batch.supplier_name,
    invoice_ref: data.invoice_ref != null ? data.invoice_ref : batch.invoice_ref,
    quantity_purchased: data.quantity_purchased != null ? Number(data.quantity_purchased) : batch.quantity_purchased,
    unit: data.unit != null ? data.unit : batch.unit,
    purchase_cost: data.purchase_cost != null ? Number(data.purchase_cost) : batch.purchase_cost,
    expected_yield: data.expected_yield != null ? Number(data.expected_yield) : batch.expected_yield,
    selling_price: data.selling_price != null ? Number(data.selling_price) : batch.selling_price,
    storage_location: data.storage_location != null ? data.storage_location : batch.storage_location,
    notes: data.notes != null ? data.notes : batch.notes,
    branch_id: data.branch_id != null ? data.branch_id : batch.branch_id,
    branch_name: data.branch_name != null ? data.branch_name : batch.branch_name
  };
  if (!(fields.expected_yield > 0)) throw new Error('Expected yield must be greater than zero');
  db.prepare(`
    UPDATE stock_batches SET
      supplier_name=?, invoice_ref=?, quantity_purchased=?, unit=?, purchase_cost=?,
      expected_yield=?, selling_price=?, storage_location=?, notes=?, branch_id=?, branch_name=?, updated_at=?
    WHERE id=?
  `).run(
    fields.supplier_name, fields.invoice_ref, fields.quantity_purchased, fields.unit, fields.purchase_cost,
    fields.expected_yield, fields.selling_price, fields.storage_location, fields.notes,
    fields.branch_id, fields.branch_name, nowIso(), batchId
  );
  logEvent(batchId, 'batch_updated', {
    old_value: JSON.stringify({ purchase_cost: batch.purchase_cost, expected_yield: batch.expected_yield }),
    new_value: JSON.stringify({ purchase_cost: fields.purchase_cost, expected_yield: fields.expected_yield }),
    user_id: actor?.id,
    user_name: actor?.full_name || actor?.username
  });
  return refreshBatchStatus(batchId);
}

function closeBatch(batchId, actor, reason) {
  ensureSchema();
  requireRole(actor);
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');
  db.prepare(`
    UPDATE stock_batches SET status = 'finished', closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?
  `).run(nowIso(), actor?.id || null, nowIso(), batchId);
  logEvent(batchId, 'batch_closed', {
    old_value: batch.status,
    new_value: 'finished',
    reason: reason || null,
    user_id: actor?.id,
    user_name: actor?.full_name || actor?.username
  });
  return getBatch(batchId);
}

function reopenBatch(batchId, actor) {
  ensureSchema();
  requireRole(actor);
  const r = String(actor?.role || '').toLowerCase();
  if (!['owner', 'manager'].includes(r)) throw new Error('Only owners/managers can reopen a batch');
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');
  db.prepare(`
    UPDATE stock_batches SET status = 'active', closed_at = NULL, closed_by = NULL, updated_at = ? WHERE id = ?
  `).run(nowIso(), batchId);
  logEvent(batchId, 'batch_reopened', {
    old_value: batch.status,
    new_value: 'active',
    user_id: actor?.id,
    user_name: actor?.full_name || actor?.username
  });
  return refreshBatchStatus(batchId);
}

function cancelBatch(batchId, actor, reason) {
  ensureSchema();
  requireRole(actor);
  const db = getDb();
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');
  db.prepare(`
    UPDATE stock_batches SET status = 'cancelled', closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?
  `).run(nowIso(), actor?.id || null, nowIso(), batchId);
  logEvent(batchId, 'batch_cancelled', {
    old_value: batch.status,
    new_value: 'cancelled',
    reason: reason || null,
    user_id: actor?.id,
    user_name: actor?.full_name || actor?.username
  });
  return getBatch(batchId);
}

function listEvents(batchId, limit = 100) {
  ensureSchema();
  return getDb().prepare(`
    SELECT * FROM stock_batch_events WHERE batch_id = ? ORDER BY id DESC LIMIT ?
  `).all(batchId, Math.min(Number(limit) || 100, 500));
}

function productYieldAnalysis(filters = {}) {
  ensureSchema();
  const rows = listBatches({ ...filters, limit: 500 }).filter((b) => b.status !== 'cancelled');
  const byProduct = {};
  for (const b of rows) {
    const key = String(b.selling_product_id || b.selling_product_name || b.stock_product_name);
    if (!byProduct[key]) {
      byProduct[key] = {
        selling_product_id: b.selling_product_id,
        selling_product_name: b.selling_product_name || b.stock_product_name,
        batches: 0,
        expected_sum: 0,
        actual_sum: 0,
        actual_count: 0,
        sold_sum: 0,
        waste_sum: 0,
        cost_sum: 0,
        revenue_sum: 0,
        profit_sum: 0
      };
    }
    const g = byProduct[key];
    g.batches += 1;
    g.expected_sum += Number(b.expected_yield) || 0;
    if (b.actual_yield != null && Number(b.actual_yield) > 0) {
      g.actual_sum += Number(b.actual_yield);
      g.actual_count += 1;
    }
    g.sold_sum += Number(b.portions_sold) || 0;
    g.waste_sum += Number(b.portions_wasted) || 0;
    g.cost_sum += Number(b.purchase_cost) || 0;
    g.revenue_sum += Number(b.revenue) || 0;
    g.profit_sum += Number(b.gross_profit) || 0;
  }
  return Object.values(byProduct).map((g) => {
    const avgExpected = g.batches ? money(g.expected_sum / g.batches) : 0;
    const avgActual = g.actual_count ? money(g.actual_sum / g.actual_count) : null;
    const yieldForCost = avgActual || avgExpected;
    const avgCostPerPlate = yieldForCost > 0 ? money(g.cost_sum / Math.max(g.sold_sum || g.expected_sum, 1) * (g.sold_sum ? 1 : (g.batches / Math.max(g.batches, 1)))) : 0;
    // cleaner: total cost / total portions produced estimate
    const produced = g.actual_sum || g.expected_sum || g.sold_sum;
    const costPer = produced > 0 ? money(g.cost_sum / produced) : 0;
    const avgSell = g.sold_sum > 0 ? money(g.revenue_sum / g.sold_sum) : 0;
    return {
      ...g,
      average_expected_yield: avgExpected,
      average_actual_yield: avgActual,
      average_cost_per_plate: costPer,
      average_selling_price: avgSell,
      average_gross_profit_per_plate: money(avgSell - costPer),
      total_purchase_cost: money(g.cost_sum),
      total_revenue: money(g.revenue_sum),
      total_gross_profit: money(g.profit_sum)
    };
  });
}

function profitabilityReport(filters = {}) {
  return listBatches({ ...filters, limit: 500 }).map((b) => ({
    batch_number: b.batch_number,
    product: b.stock_product_name,
    selling_product: b.selling_product_name,
    purchase_cost: b.purchase_cost,
    expected_yield: b.expected_yield,
    actual_yield: b.actual_yield,
    portions_sold: b.portions_sold,
    waste: b.portions_wasted,
    revenue: b.revenue,
    consumed_cost: b.consumed_cost,
    gross_profit: b.gross_profit,
    profit_per_portion: b.portions_sold > 0 ? money(b.gross_profit / b.portions_sold) : 0,
    status: b.status_label,
    purchase_date: b.purchase_date
  }));
}

module.exports = {
  ensureSchema,
  getSettings,
  saveSettings,
  createBatch,
  getBatch,
  listBatches,
  dashboard,
  updateBatch,
  recordWaste,
  setActualYield,
  closeBatch,
  reopenBatch,
  cancelBatch,
  listEvents,
  consumeSalePortions,
  productYieldAnalysis,
  profitabilityReport,
  OPEN_STATUSES
};
