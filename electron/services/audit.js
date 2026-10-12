const { getDb } = require('../database/db');
const { verifyPin, verifyPinWithUpgrade } = require('./pin');
const branchesSvc = require('./branches');

const _salesColCache = new Map();

function salesHasColumn(name) {
  if (_salesColCache.has(name)) return _salesColCache.get(name);
  try {
    getDb().prepare(`SELECT ${name} FROM sales LIMIT 0`).get();
    _salesColCache.set(name, true);
    return true;
  } catch (_) {
    _salesColCache.set(name, false);
    return false;
  }
}

function ensureSalesListSchema() {
  try { require('./taken-orders').ensureSchema(); } catch (_) { /* optional */ }
  try {
    require('./backdated-orders').ensureBackdatedColumns();
    // Columns may have been added — allow re-probe
    for (const k of ['sale_datetime', 'order_source', 'delivery_fee', 'delivery_place']) {
      _salesColCache.delete(k);
    }
  } catch (_) { /* optional */ }
  try { ensureSaleEditColumns(); } catch (_) { /* optional */ }
}

function editedSelectSql() {
  return salesHasColumn('edited_at')
    ? 's.edited_at, s.edited_by_name, s.edit_count'
    : 'NULL as edited_at, NULL as edited_by_name, 0 as edit_count';
}

function saleBusinessDateExpr() {
  return salesHasColumn('sale_datetime')
    ? "COALESCE(s.sale_datetime, s.created_at)"
    : 's.created_at';
}

function getSalesList(filters = {}) {
  const db = getDb();
  ensureSalesListSchema();
  const flags = branchesSvc.ensureBranchSchema();
  const branchSelect = flags.sales ? 's.branch_id' : 'NULL as branch_id';
  const bizDt = saleBusinessDateExpr();
  let takenFlagSql = '0 as is_taken_unpaid';
  try {
    db.prepare('SELECT 1 FROM taken_orders LIMIT 1').get();
    takenFlagSql = `EXISTS (
        SELECT 1 FROM taken_orders t
        WHERE t.sale_id = s.id AND UPPER(COALESCE(t.status,'')) = 'UNPAID'
      ) as is_taken_unpaid`;
  } catch (_) { /* table missing */ }
  const hasOrderSource = salesHasColumn('order_source');
  const hasDeliveryFee = salesHasColumn('delivery_fee');
  const hasDeliveryPlace = salesHasColumn('delivery_place');
  const hasSaleDt = salesHasColumn('sale_datetime');
  const hasIsBd = salesHasColumn('is_backdated');
  const hasBdReason = salesHasColumn('backdated_reason');
  let sql = `
    SELECT s.id, s.receipt_number, s.order_number, s.created_at, s.subtotal, s.discount, s.tax_amount, s.total,
      s.amount_paid, s.change_amount, s.status, s.void_reason, ${branchSelect}, s.notes, s.order_type, s.table_name, s.delivery_address,
      ${hasDeliveryFee ? 's.delivery_fee' : '0 as delivery_fee'},
      ${hasDeliveryPlace ? 's.delivery_place' : 'NULL as delivery_place'},
      ${hasOrderSource ? 's.order_source' : "NULL as order_source"},
      ${hasSaleDt ? 's.sale_datetime' : 's.created_at as sale_datetime'},
      ${hasIsBd ? 's.is_backdated' : '0 as is_backdated'},
      ${hasBdReason ? 's.backdated_reason' : 'NULL as backdated_reason'},
      ${editedSelectSql()},
      u.full_name as cashier_name, c.name as customer_name,
      (SELECT GROUP_CONCAT(payment_type || ' ' || amount) FROM sale_payments WHERE sale_id = s.id) as payment_methods,
      (SELECT payment_type FROM sale_payments WHERE sale_id = s.id LIMIT 1) as primary_payment,
      (SELECT GROUP_CONCAT(product_name || ' x' || quantity, ', ') FROM sale_items WHERE sale_id = s.id LIMIT 5) as item_summary,
      (SELECT COALESCE(SUM(amount), 0) FROM sale_payments WHERE sale_id = s.id AND payment_type = 'giftcard') as gift_card_amount,
      (SELECT COALESCE(SUM(ABS(points)), 0) FROM loyalty_transactions WHERE sale_id = s.id AND type = 'redeem') as loyalty_points_redeemed,
      ${takenFlagSql}
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (filters.from) { sql += ` AND date(${bizDt}, 'localtime') >= date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(${bizDt}, 'localtime') <= date(?)`; params.push(filters.to); }
  if (filters.status) { sql += ' AND s.status = ?'; params.push(filters.status); }
  if (filters.cashier_id) { sql += ' AND s.user_id = ?'; params.push(filters.cashier_id); }
  if (filters.customer_id) { sql += ' AND s.customer_id = ?'; params.push(filters.customer_id); }
  if (filters.receipt) { sql += ' AND (s.receipt_number LIKE ? OR s.order_number LIKE ?)'; params.push(`%${filters.receipt}%`, `%${filters.receipt}%`); }
  if (filters.customer) { sql += ' AND c.name LIKE ?'; params.push(`%${filters.customer}%`); }
  if (filters.cashier) { sql += ' AND u.full_name LIKE ?'; params.push(`%${filters.cashier}%`); }
  if (filters.min_amount) { sql += ' AND s.total >= ?'; params.push(filters.min_amount); }
  if (filters.max_amount) { sql += ' AND s.total <= ?'; params.push(filters.max_amount); }
  if (filters.time_from) { sql += " AND time(s.created_at) >= time(?)"; params.push(filters.time_from); }
  if (filters.time_to) { sql += " AND time(s.created_at) <= time(?)"; params.push(filters.time_to); }
  if (filters.payment_type) {
    sql += ' AND EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.payment_type = ?)';
    params.push(filters.payment_type);
  }
  if (filters.product) {
    sql += ' AND EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_name LIKE ?)';
    params.push(`%${filters.product}%`);
  }
  if (filters.pos_only) {
    if (hasOrderSource) {
      sql += " AND (COALESCE(s.order_type, '') != 'online' AND COALESCE(s.order_source, '') NOT IN ('ONLINE','WEB'))";
    } else {
      sql += " AND COALESCE(s.order_type, '') != 'online'";
    }
  }
  if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all' && flags.sales) {
    sql += ' AND s.branch_id = ?';
    params.push(Number(filters.branch_id));
  }
  if (filters.q) {
    const q = `%${String(filters.q).trim()}%`;
    sql += ` AND (
      s.receipt_number LIKE ? OR s.order_number LIKE ? OR IFNULL(c.name,'') LIKE ?
      OR IFNULL(u.full_name,'') LIKE ? OR IFNULL(s.notes,'') LIKE ?
      OR IFNULL(s.table_name,'') LIKE ? OR IFNULL(s.delivery_address,'') LIKE ?
      OR CAST(s.total AS TEXT) LIKE ?
    )`;
    params.push(q, q, q, q, q, q, q, q);
  }
  sql += ` ORDER BY ${bizDt} DESC`;
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  return db.prepare(sql).all(...params);
}

function getPendingOnlineOrdersForSales(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT o.id, o.order_number, o.created_at, o.total, o.discount, o.tax_amount, o.status,
      o.customer_name, o.customer_phone, o.payment_method, o.items_json, o.branch_id, o.fulfillment_type
    FROM online_orders_local o
    WHERE o.status NOT IN ('cancelled', 'rejected')
      AND (o.sale_id IS NULL OR o.sale_id = 0)
  `;
  const params = [];
  if (filters.from) { sql += " AND date(o.created_at, 'localtime') >= date(?)"; params.push(filters.from); }
  if (filters.to) { sql += " AND date(o.created_at, 'localtime') <= date(?)"; params.push(filters.to); }
  if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all') {
    sql += ' AND o.branch_id = ?';
    params.push(Number(filters.branch_id));
  }
  sql += ' ORDER BY o.created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  return db.prepare(sql).all(...params);
}

function mapOnlineOrderAsSaleRow(order) {
  let itemSummary = '—';
  try {
    const items = JSON.parse(order.items_json || '[]');
    itemSummary = items.slice(0, 5).map((i) => `${i.quantity || 1}× ${i.name || 'Item'}`).join(', ') || '—';
  } catch (_) { /* ignore */ }
  return {
    id: `online-${order.id}`,
    online_order_id: order.id,
    order_number: order.order_number,
    receipt_number: '—',
    created_at: order.created_at,
    subtotal: order.total,
    discount: Number(order.discount) || 0,
    tax_amount: Number(order.tax_amount) || 0,
    total: Number(order.total) || 0,
    status: order.status,
    order_type: 'online',
    order_source: 'ONLINE',
    customer_name: order.customer_name || 'Online customer',
    customer_phone: order.customer_phone || null,
    primary_payment: order.payment_method || 'Online',
    payment_methods: order.payment_method || 'Online',
    cashier_name: '—',
    item_summary: itemSummary,
    gift_card_amount: 0,
    loyalty_points_redeemed: 0,
    is_online_pending: true,
    branch_id: order.branch_id
  };
}

function getSalesListLite(filters = {}) {
  const db = getDb();
  ensureSalesListSchema();
  const flags = branchesSvc.ensureBranchSchema();
  const branchSelect = flags.sales ? 's.branch_id' : 'NULL as branch_id';
  const bizDt = saleBusinessDateExpr();
  const hasOrderSource = salesHasColumn('order_source');
  const hasDeliveryFee = salesHasColumn('delivery_fee');
  const hasDeliveryPlace = salesHasColumn('delivery_place');
  let takenFlagSql = '0 as is_taken_unpaid';
  try {
    db.prepare('SELECT 1 FROM taken_orders LIMIT 1').get();
    takenFlagSql = `EXISTS (
        SELECT 1 FROM taken_orders t
        WHERE t.sale_id = s.id AND UPPER(COALESCE(t.status,'')) = 'UNPAID'
      ) as is_taken_unpaid`;
  } catch (_) { /* table missing */ }
  const hasSaleDt = salesHasColumn('sale_datetime');
  const hasIsBd = salesHasColumn('is_backdated');
  const hasBdReason = salesHasColumn('backdated_reason');
  let sql = `
    SELECT s.id, s.receipt_number, s.order_number, s.created_at, s.subtotal, s.discount, s.tax_amount, s.total,
      s.status, ${branchSelect}, s.notes, s.order_type,
      ${hasOrderSource ? 's.order_source' : "NULL as order_source"},
      s.table_name, s.delivery_address,
      ${hasDeliveryFee ? 's.delivery_fee' : '0 as delivery_fee'},
      ${hasDeliveryPlace ? 's.delivery_place' : 'NULL as delivery_place'},
      ${hasSaleDt ? 's.sale_datetime' : 's.created_at as sale_datetime'},
      ${hasIsBd ? 's.is_backdated' : '0 as is_backdated'},
      ${hasBdReason ? 's.backdated_reason' : 'NULL as backdated_reason'},
      ${editedSelectSql()},
      u.full_name as cashier_name, c.name as customer_name,
      (SELECT payment_type FROM sale_payments WHERE sale_id = s.id LIMIT 1) as primary_payment,
      (SELECT GROUP_CONCAT(product_name || ' x' || quantity, ', ') FROM sale_items WHERE sale_id = s.id LIMIT 3) as item_summary,
      ${takenFlagSql}
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (filters.from) { sql += ` AND date(${bizDt}, 'localtime') >= date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(${bizDt}, 'localtime') <= date(?)`; params.push(filters.to); }
  if (filters.status) { sql += ' AND s.status = ?'; params.push(filters.status); }
  if (filters.cashier_id) { sql += ' AND s.user_id = ?'; params.push(filters.cashier_id); }
  if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all' && flags.sales) {
    sql += ' AND s.branch_id = ?';
    params.push(Number(filters.branch_id));
  }
  if (filters.pos_only) {
    if (hasOrderSource) {
      sql += " AND (COALESCE(s.order_type, '') != 'online' AND COALESCE(s.order_source, '') NOT IN ('ONLINE','WEB'))";
    } else {
      sql += " AND COALESCE(s.order_type, '') != 'online'";
    }
  }
  if (filters.q) {
    const q = `%${String(filters.q).trim()}%`;
    sql += ` AND (
      s.receipt_number LIKE ? OR s.order_number LIKE ? OR IFNULL(c.name,'') LIKE ?
      OR IFNULL(u.full_name,'') LIKE ? OR IFNULL(s.notes,'') LIKE ?
      OR IFNULL(s.table_name,'') LIKE ? OR IFNULL(s.delivery_address,'') LIKE ?
      OR CAST(s.total AS TEXT) LIKE ?
    )`;
    params.push(q, q, q, q, q, q, q, q);
  }
  sql += ` ORDER BY ${bizDt} DESC`;
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  return db.prepare(sql).all(...params);
}

function getUnifiedSalesList(filters = {}) {
  const limit = filters.limit || 200;
  const useLite = filters.lite !== false;
  let sales = [];
  try {
    sales = useLite
      ? getSalesListLite({ ...filters, limit })
      : getSalesList({ ...filters, limit });
  } catch (err) {
    console.warn('[getUnifiedSalesList] primary query failed, retrying minimal:', err.message || err);
    try {
      // Last-resort fallback if unexpected column/schema issues remain
      const db = getDb();
      const params = [];
      let sql = `
        SELECT s.id, s.receipt_number, s.order_number, s.created_at, s.subtotal, s.discount, s.tax_amount, s.total,
          s.status, s.notes, s.order_type, s.table_name, s.delivery_address,
          u.full_name as cashier_name, c.name as customer_name,
          (SELECT payment_type FROM sale_payments WHERE sale_id = s.id LIMIT 1) as primary_payment,
          0 as is_taken_unpaid
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE 1=1`;
      if (filters.from) { sql += " AND date(s.created_at, 'localtime') >= date(?)"; params.push(filters.from); }
      if (filters.to) { sql += " AND date(s.created_at, 'localtime') <= date(?)"; params.push(filters.to); }
      if (filters.cashier_id) { sql += ' AND s.user_id = ?'; params.push(filters.cashier_id); }
      sql += ' ORDER BY s.created_at DESC';
      if (limit) { sql += ' LIMIT ?'; params.push(limit); }
      sales = db.prepare(sql).all(...params);
    } catch (err2) {
      console.error('[getUnifiedSalesList] fallback failed:', err2.message || err2);
      throw err;
    }
  }
  if (filters.pos_only) return sales;
  let pendingOnline = [];
  try {
    pendingOnline = getPendingOnlineOrdersForSales({ ...filters, limit: Math.min(limit, 100) })
      .map(mapOnlineOrderAsSaleRow);
  } catch (err) {
    console.warn('[getUnifiedSalesList] pending online orders skipped:', err.message || err);
  }
  const q = String(filters.q || '').trim().toLowerCase();
  const merged = [...sales, ...pendingOnline]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const filtered = q
    ? merged.filter((s) => {
      const hay = [
        s.order_number, s.receipt_number, s.cashier_name, s.customer_name,
        s.primary_payment, s.payment_methods, s.order_type, s.status,
        s.table_name, s.delivery_address, s.item_summary, s.total
      ].map((v) => String(v || '').toLowerCase()).join(' ');
      return hay.includes(q);
    })
    : merged;
  return filtered.slice(0, limit);
}

function getSalesByCashier(filters = {}) {
  const db = getDb();
  ensureSalesListSchema();
  const flags = branchesSvc.ensureBranchSchema();
  const bizDt = saleBusinessDateExpr();
  let sql = `
    SELECT s.user_id AS cashier_id, COALESCE(u.full_name, u.username, 'Unknown') AS cashier_name,
      COUNT(*) AS sale_count, COALESCE(SUM(s.total), 0) AS total
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE s.status IN ('completed', 'partial_return', 'returned')
  `;
  const params = [];
  if (filters.from) { sql += ` AND date(${bizDt}, 'localtime') >= date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(${bizDt}, 'localtime') <= date(?)`; params.push(filters.to); }
  if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all' && flags.sales) {
    sql += ' AND s.branch_id = ?';
    params.push(Number(filters.branch_id));
  }
  sql += ' GROUP BY s.user_id, u.full_name, u.username ORDER BY total DESC';
  const rows = db.prepare(sql).all(...params).map((r) => ({
    cashier_id: r.cashier_id,
    cashier_name: r.cashier_name,
    sale_count: Number(r.sale_count) || 0,
    total: Math.round((Number(r.total) || 0) * 100) / 100
  }));
  const grand = rows.reduce((a, r) => ({ sale_count: a.sale_count + r.sale_count, total: a.total + r.total }), { sale_count: 0, total: 0 });
  grand.total = Math.round(grand.total * 100) / 100;
  return { cashiers: rows, grand_total: grand };
}

function searchSalesExplorer(filters) {
  return getSalesList({ ...filters, limit: filters.limit || 500 });
}

function voidSale(saleId, reason, actorId, actorName) {
  const db = getDb();
  const inventory = require('./inventory');
  const features = require('./features');
  const combosSvc = require('./combos');
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) throw new Error('Sale not found');
  if (sale.status === 'voided' || sale.status === 'void') throw new Error('Sale already voided');
  const returnsCount = db.prepare(`
    SELECT COUNT(*) as c FROM returns WHERE sale_id = ? AND status IN ('completed', 'reopened')
  `).get(saleId);
  if ((Number(returnsCount?.c) || 0) > 0) {
    throw new Error('Cannot void a sale that already has returns — process a return instead');
  }
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
  const adjustStock = (...args) => require('./store').adjustStock(...args);
  db.transaction(() => {
    db.prepare(`UPDATE sales SET status='voided', void_reason=? WHERE id=?`).run(reason || 'Voided', saleId);
    for (const item of items) {
      const note = `Void ${sale.receipt_number}`;
      if (item.combo_id) {
        combosSvc.restoreComboSale(item.combo_id, item.quantity, note, actorId, 'void', saleId, adjustStock);
        continue;
      }
      if (!item.product_id) continue;
      const selectedMods = item.modifiers_text
        ? String(item.modifiers_text).split(',').map(s => ({ name: s.trim() })).filter(m => m.name)
        : [];
      const storeMod = require('./store');
      if (typeof storeMod.restoreProductStockAfterSale === 'function') {
        storeMod.restoreProductStockAfterSale(
          item.product_id, item.quantity, note, actorId, 'void', saleId, selectedMods
        );
      } else {
        const prodMeta = db.prepare('SELECT has_recipe, production_mode FROM products WHERE id = ?').get(item.product_id);
        const makeToStock = prodMeta?.production_mode === 'make_to_stock';
        if (makeToStock || !prodMeta?.has_recipe) {
          adjustStock(item.product_id, item.quantity, 'return', note, actorId, 'void', saleId);
        } else {
          const recipeRestored = inventory.restoreRecipeIngredients(
            item.product_id, item.quantity, note, actorId, 'void', saleId, adjustStock, selectedMods
          );
          if (!recipeRestored) {
            adjustStock(item.product_id, item.quantity, 'return', note, actorId, 'void', saleId);
          }
        }
      }
    }
    features.reverseSaleBenefits(saleId, actorId, 1);
  })();
  try {
    require('./referral-commission').reverseCommissionForSale(saleId, 1, reason || 'void', { id: actorId, full_name: actorName });
  } catch (_) { /* optional */ }
  try {
    require('./accounting-platform').reverseSaleAccounting(saleId, reason || 'Sale voided');
  } catch (err) {
    console.warn('[voidSale] accounting reversal:', err.message || err);
  }
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'void_sale', 'sale', saleId, JSON.stringify({
      receipt_number: sale.receipt_number,
      order_number: sale.order_number,
      reason,
      total: sale.total
    }));
  // Mark matching taken-order unpaid row cancelled so it never hits cash-up
  try {
    db.prepare(`
      UPDATE taken_orders SET status='CANCELLED', updated_at=datetime('now'), notes=COALESCE(notes,'') || ' [voided]'
      WHERE sale_id=? AND UPPER(status)='UNPAID'
    `).run(saleId);
  } catch (_) { /* optional */ }
  return {
    success: true,
    id: saleId,
    receipt_number: sale.receipt_number,
    order_number: sale.order_number || sale.receipt_number,
    status: 'voided',
    void_reason: reason || 'Voided'
  };
}

let _saleEditColsReady = false;
function ensureSaleEditColumns() {
  if (_saleEditColsReady) return;
  const db = getDb();
  for (const [name, type] of [
    ['edited_at', 'TEXT'], ['edited_by_user_id', 'INTEGER'], ['edited_by_name', 'TEXT'], ['edit_count', 'INTEGER DEFAULT 0']
  ]) {
    try { db.exec(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS ${name} ${type}`); } catch (_) {
      try { db.exec(`ALTER TABLE sales ADD COLUMN ${name} ${type}`); } catch (__) { /* exists */ }
    }
    _salesColCache.delete(name);
  }
  _saleEditColsReady = true;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function deductStockForEdit(productId, qty, modifiersText, note, actorId, saleId, branchId) {
  const store = require('./store');
  const inventory = require('./inventory');
  const adjust = (pid, q, type, n, uid, refType, refId) => store.adjustStock(pid, q, type, n, uid, refType, refId, branchId);
  const meta = getDb().prepare('SELECT has_recipe, production_mode FROM products WHERE id = ?').get(productId);
  if (!meta || meta.production_mode === 'make_to_stock' || !meta.has_recipe) {
    adjust(productId, qty, 'sale', note, actorId, 'sale_edit', saleId);
    return;
  }
  const mods = String(modifiersText || '').split(',').map((s) => ({ name: s.trim() })).filter((m) => m.name);
  if (!inventory.deductRecipeIngredients(productId, qty, `${note} (recipe)`, actorId, 'sale_edit', saleId, adjust, mods)) {
    adjust(productId, qty, 'sale', note, actorId, 'sale_edit', saleId);
  }
}

function restoreStockForEdit(item, qty, note, actorId, saleId) {
  const store = require('./store');
  if (item.combo_id) {
    require('./combos').restoreComboSale(item.combo_id, qty, note, actorId, 'sale_edit', saleId, (...a) => store.adjustStock(...a));
    return;
  }
  if (!item.product_id) return;
  const mods = String(item.modifiers_text || '').split(',').map((s) => ({ name: s.trim() })).filter((m) => m.name);
  store.restoreProductStockAfterSale(item.product_id, qty, note, actorId, 'sale_edit', saleId, mods);
}

/** Push edited sale details to delivery jobs and the linked online order so every screen shows the same order. */
function syncEditedSaleEverywhere(saleId) {
  const db = getDb();
  const full = require('./store').getSale(saleId);
  if (!full) return;
  const payMethod = (full.payments || []).map((p) => p.payment_type).join(', ');
  try {
    const dp = require('./delivery-platform');
    dp.ensureSchema();
    const linked = db.prepare(`SELECT id, source_type FROM delivery_assignments
      WHERE sale_id = ? OR (source_type = 'sale' AND source_id = ?)`).all(saleId, saleId);
    const isDelivery = full.order_type === 'delivery' || String(full.delivery_address || '').trim();
    if (linked.some((r) => r.source_type === 'sale') || (!linked.length && isDelivery)) {
      dp.upsertFromSale({ ...full, payment_method: payMethod });
    }
    const items = JSON.stringify((full.items || []).map((i) => ({ name: i.product_name, quantity: i.quantity })));
    for (const row of linked.filter((r) => r.source_type !== 'sale')) {
      db.prepare(`UPDATE delivery_assignments SET order_number = ?, delivery_address = COALESCE(NULLIF(?, ''), delivery_address),
        customer_name = COALESCE(NULLIF(?, ''), customer_name), customer_phone = COALESCE(NULLIF(?, ''), customer_phone),
        total = ?, delivery_fee = ?, payment_method = ?, items_json = ?, updated_at = ? WHERE id = ?`)
        .run(full.receipt_number || full.order_number, full.delivery_address || '', full.customer_name || '', full.customer_phone || '',
          Number(full.total) || 0, Number(full.delivery_fee) || 0, payMethod, items, new Date().toISOString(), row.id);
    }
  } catch (err) {
    console.warn('[updateSale] delivery sync:', err.message || err);
  }
  try {
    const onlineItems = JSON.stringify((full.items || []).map((i) => ({
      name: i.product_name, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0,
      product_id: i.product_id || null, modifiers_text: i.modifiers_text || null
    })));
    db.prepare(`UPDATE online_orders_local SET total = ?, items_json = ?,
      delivery_address = COALESCE(NULLIF(?, ''), delivery_address), notes = ? WHERE sale_id = ?`)
      .run(Number(full.total) || 0, onlineItems, full.delivery_address || '', full.notes || null, saleId);
  } catch (err) {
    console.warn('[updateSale] online order sync:', err.message || err);
  }
}

function asId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function updateSaleRecord(saleId, patch, actorId, actorName) {
  const db = getDb();
  ensureSalesListSchema();
  ensureSaleEditColumns();
  saleId = asId(saleId);
  if (!saleId) throw new Error('Sale not found');
  patch = patch || {};
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) throw new Error('Sale not found');
  const immutable = [
    'sale_datetime', 'created_at', 'is_backdated', 'backdated_reason',
    'entered_by_user_id', 'authorized_by_user_id', 'authorized_at',
    'pos_terminal_id', 'backdated_correction_of', 'user_id', 'total', 'branch_id'
  ];
  for (const key of immutable) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      throw new Error(`Cannot change ${key} on a sale — create a correction instead`);
    }
  }

  const updates = {};
  for (const key of ['notes', 'table_name', 'delivery_address', 'receipt_number', 'order_type', 'delivery_place']) {
    if (patch[key] === undefined) continue;
    if (key === 'delivery_place' && !salesHasColumn('delivery_place')) continue;
    const v = patch[key] == null ? '' : String(patch[key]).trim();
    updates[key] = v || null;
  }
  if (patch.customer_id !== undefined) {
    const cid = patch.customer_id ? Number(patch.customer_id) : null;
    if (cid && !db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw new Error('Customer not found');
    updates.customer_id = cid;
  }
  if (patch.receipt_number !== undefined) {
    if (!updates.receipt_number) throw new Error('Receipt number cannot be empty');
    const dup = db.prepare('SELECT id FROM sales WHERE receipt_number = ? AND id != ?').get(updates.receipt_number, saleId);
    if (dup) throw new Error('Receipt number already in use');
    // Keep order_number in lockstep so POS / Admin / voids always share one slip id
    updates.order_number = updates.receipt_number;
  }

  const wantsItems = Array.isArray(patch.items);
  const wantsPayments = Array.isArray(patch.payments);
  const wantsTotals = wantsItems || patch.discount !== undefined || patch.delivery_fee !== undefined;
  const wantsMoney = wantsTotals || wantsPayments;
  const isVoided = ['void', 'voided'].includes(String(sale.status || '').toLowerCase());
  if (wantsMoney) {
    if (isVoided) throw new Error('This sale is voided — only its details (customer, notes, address) can be edited');
    const ret = db.prepare(`SELECT COUNT(*) AS c FROM returns WHERE sale_id = ? AND status IN ('completed', 'reopened')`).get(saleId);
    if ((Number(ret?.c) || 0) > 0) throw new Error('This sale has returns — items and payments can no longer be edited');
    if (!String(patch.edit_reason || '').trim()) throw new Error('Give a reason for changing items, prices or payments');
  }

  const oldItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
  const oldPays = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(saleId);
  const itemOps = { update: [], insert: [], remove: [] };
  const stockOps = [];
  let lineTotals = oldItems.map((i) => Number(i.total) || 0);

  if (wantsItems) {
    if (!patch.items.length) throw new Error('A sale needs at least one item — void it instead');
    const byId = new Map(oldItems.map((i) => [Number(i.id), i]));
    const seen = new Set();
    lineTotals = [];
    for (const raw of patch.items) {
      const qty = Number(raw.quantity);
      const price = Number(raw.unit_price);
      if (!(qty > 0)) throw new Error('Every item needs a quantity above 0 — remove the line instead');
      if (!(price >= 0)) throw new Error('Item price cannot be negative');
      const old = raw.id ? byId.get(Number(raw.id)) : null;
      if (old) {
        seen.add(Number(old.id));
        const oldQty = Number(old.quantity) || 0;
        if (old.combo_id && (qty !== oldQty || round2(price) !== round2(old.unit_price))) {
          throw new Error(`Combo "${old.product_name}" can only be kept or removed, not changed`);
        }
        const total = Math.max(0, round2(qty * price - (Number(old.discount) || 0)));
        lineTotals.push(total);
        itemOps.update.push({ id: asId(old.id), quantity: qty, unit_price: price, total });
        if (qty > oldQty && old.product_id && !old.combo_id) stockOps.push({ kind: 'deduct', item: old, qty: qty - oldQty });
        if (qty < oldQty) stockOps.push({ kind: 'restore', item: old, qty: oldQty - qty });
      } else {
        const pid = Number(raw.product_id);
        const product = pid ? db.prepare('SELECT id, name, buying_price FROM products WHERE id = ?').get(pid) : null;
        if (!product) throw new Error('Pick a product for every new line');
        const total = round2(qty * price);
        lineTotals.push(total);
        const row = {
          product_id: product.id, product_name: product.name, quantity: qty, unit_price: price,
          buying_price: Number(product.buying_price) || 0, total, modifiers_text: raw.modifiers_text || null
        };
        itemOps.insert.push(row);
        stockOps.push({ kind: 'deduct', item: row, qty });
      }
    }
    for (const old of oldItems) {
      if (seen.has(Number(old.id))) continue;
      itemOps.remove.push(old);
      stockOps.push({ kind: 'restore', item: old, qty: Number(old.quantity) || 0 });
    }
  }

  let newTotal = Number(sale.total) || 0;
  if (wantsTotals) {
    const gross = round2(lineTotals.reduce((n, t) => n + t, 0));
    const discount = patch.discount !== undefined ? round2(patch.discount) : round2(sale.discount);
    if (discount < 0) throw new Error('Discount cannot be negative');
    if (discount > gross + 0.01) throw new Error('Discount cannot be more than the items total');
    const deliveryFee = patch.delivery_fee !== undefined ? round2(patch.delivery_fee) : round2(sale.delivery_fee);
    if (deliveryFee < 0) throw new Error('Delivery fee cannot be negative');
    const store = require('./store');
    const settings = store.getSettingsParsed();
    const hadTax = Number(sale.tax_amount) > 0;
    const taxRate = hadTax && settings.tax_enabled ? (Number(settings.tax_rate) || 0) : 0;
    const afterDiscount = round2(Math.max(0, gross - discount));
    let subtotal = afterDiscount;
    let tax = 0;
    let taxedTotal = afterDiscount;
    if (taxRate) {
      const inclusive = settings.tax_inclusive !== false && settings.tax_inclusive !== 0 && settings.tax_inclusive !== '0';
      if (inclusive) {
        tax = round2(afterDiscount - afterDiscount / (1 + taxRate / 100));
        subtotal = round2(afterDiscount - tax);
      } else {
        tax = round2(afterDiscount * taxRate / 100);
        taxedTotal = round2(afterDiscount + tax);
      }
    }
    newTotal = round2(taxedTotal + deliveryFee);
    Object.assign(updates, { subtotal, discount, tax_amount: tax, total: newTotal });
    if (salesHasColumn('delivery_fee')) updates.delivery_fee = deliveryFee;
  }

  let payOps = null;
  if (wantsPayments) {
    const rows = patch.payments.map((p) => ({
      id: asId(p.id),
      payment_type: String(p.payment_type || '').trim().toLowerCase(),
      amount: round2(p.amount)
    })).filter((p) => p.amount > 0);
    if (!rows.length) throw new Error('Add at least one payment');
    if (rows.some((p) => !p.payment_type)) throw new Error('Choose a payment method for every payment');
    payOps = rows;
  } else if (wantsTotals && Math.abs(newTotal - (Number(sale.total) || 0)) > 0.001 && oldPays.length) {
    // Keep payments equal to the new total: move the difference onto the last non-gift-card payment
    const rows = oldPays.map((p) => ({ id: asId(p.id), payment_type: p.payment_type, amount: round2(p.amount) }));
    const target = [...rows].reverse().find((p) => String(p.payment_type).toLowerCase() !== 'giftcard') || rows[rows.length - 1];
    const others = round2(rows.filter((p) => p !== target).reduce((n, p) => n + p.amount, 0));
    target.amount = round2(newTotal - others);
    if (target.amount < 0) throw new Error('The new total is lower than the other payments — edit the payments too');
    payOps = rows.filter((p) => p.amount > 0 || p === target);
  }
  if (payOps) {
    const paid = round2(payOps.reduce((n, p) => n + p.amount, 0));
    if (paid < newTotal - 0.01) throw new Error(`Payments (${paid.toFixed(2)}) are less than the sale total (${newTotal.toFixed(2)})`);
    updates.amount_paid = paid;
    updates.change_amount = Math.max(0, round2(paid - newTotal));
  }

  if (!Object.keys(updates).length && !wantsItems) throw new Error('Nothing to update');

  const nowIso = new Date().toISOString();
  updates.edited_at = nowIso;
  updates.edited_by_user_id = actorId || null;
  updates.edited_by_name = actorName || null;
  const slip = updates.receipt_number || sale.receipt_number;
  const note = `Sale edit ${slip}`;

  db.transaction(() => {
    for (const u of itemOps.update) {
      db.prepare('UPDATE sale_items SET quantity = ?, unit_price = ?, total = ? WHERE id = ?').run(u.quantity, u.unit_price, u.total, u.id);
    }
    for (const r of itemOps.remove) db.prepare('DELETE FROM sale_items WHERE id = ?').run(asId(r.id));
    for (const n of itemOps.insert) {
      db.prepare(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, buying_price, discount, total, modifiers_text)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(saleId, asId(n.product_id), n.product_name, n.quantity, n.unit_price, n.buying_price, n.total, n.modifiers_text);
    }
    for (const op of stockOps) {
      if (op.kind === 'deduct') deductStockForEdit(op.item.product_id, op.qty, op.item.modifiers_text, note, actorId, saleId, sale.branch_id);
      else restoreStockForEdit(op.item, op.qty, note, actorId, saleId);
    }
    if (payOps) {
      const keep = new Set(payOps.filter((p) => p.id).map((p) => p.id));
      for (const old of oldPays) {
        if (!keep.has(asId(old.id))) db.prepare('DELETE FROM sale_payments WHERE id = ?').run(asId(old.id));
      }
      for (const p of payOps) {
        if (p.id && oldPays.some((o) => Number(o.id) === p.id)) {
          db.prepare('UPDATE sale_payments SET payment_type = ?, amount = ? WHERE id = ?').run(p.payment_type, p.amount, p.id);
        } else {
          db.prepare('INSERT INTO sale_payments (sale_id, payment_type, amount) VALUES (?, ?, ?)').run(saleId, p.payment_type, p.amount);
        }
      }
    }
    const cols = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE sales SET ${cols}, edit_count = COALESCE(edit_count, 0) + 1 WHERE id = ?`).run(...Object.values(updates), saleId);
  })();

  if (wantsMoney) {
    const acc = require('./accounting-platform');
    try {
      acc.reverseSaleAccounting(saleId, `Sale edited: ${patch.edit_reason}`);
    } catch (err) {
      console.warn('[updateSale] accounting reverse:', err.message || err);
    }
    try {
      // The unique (source_type, source_id, event_key) index also covers reversed journals
      db.prepare(`UPDATE acc_journals SET event_key = ? WHERE source_type = 'sale' AND event_key = 'sale_main'
        AND status = 'reversed' AND (source_id = ? OR reference = ?)`)
        .run(`sale_main_superseded_${Date.now()}`, saleId, sale.receipt_number || '');
    } catch (err) {
      console.warn('[updateSale] accounting key release:', err.message || err);
    }
    try {
      acc.postFromSale(saleId);
    } catch (err) {
      console.warn('[updateSale] accounting repost:', err.message || err);
    }
  }
  syncEditedSaleEverywhere(saleId);

  let loyalty = null;
  if (wantsTotals) {
    const features = require('./features');
    const eligibleBefore = features.loyaltyEarnBase(sale.total, sale.delivery_fee);
    const eligibleAfter = features.loyaltyEarnBase(newTotal, updates.delivery_fee !== undefined ? updates.delivery_fee : sale.delivery_fee);
    if (Math.abs(eligibleAfter - eligibleBefore) > 0.001) {
      try {
        loyalty = features.recalcSaleLoyaltyAfterEdit(saleId, {
          actorId, actorName, reason: patch.edit_reason, eligibleBefore
        });
      } catch (err) {
        console.warn('[updateSale] loyalty recalc:', err.message || err);
        loyalty = { error: err.message || String(err), message: `Loyalty could not be recalculated: ${err.message || err}` };
      }
    }
  }

  const changes = { ...updates };
  delete changes.edited_at; delete changes.edited_by_user_id; delete changes.edited_by_name;
  try {
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'update_sale', 'sale', saleId, JSON.stringify({
      receipt_number: slip,
      reason: patch.edit_reason ? String(patch.edit_reason).trim() : null,
      before: { ...sale, items: wantsItems ? oldItems : undefined, payments: payOps ? oldPays : undefined },
      updates: changes,
      items_added: itemOps.insert.map((i) => `${i.product_name} x${i.quantity}`),
      items_removed: itemOps.remove.map((i) => `${i.product_name} x${i.quantity}`),
      items_changed: itemOps.update.length,
      items_changed_detail: itemOps.update.map((u) => {
        const old = oldItems.find((i) => Number(i.id) === Number(u.id));
        if (!old) return null;
        const parts = [];
        if (Number(old.quantity) !== Number(u.quantity)) parts.push(`qty ${Number(old.quantity)} → ${Number(u.quantity)}`);
        if (round2(old.unit_price) !== round2(u.unit_price)) parts.push(`price ${round2(old.unit_price).toFixed(2)} → ${round2(u.unit_price).toFixed(2)}`);
        return parts.length ? `${old.product_name}: ${parts.join(', ')}` : null;
      }).filter(Boolean),
      payments_before: payOps ? oldPays.map((p) => `${p.payment_type} ${round2(p.amount).toFixed(2)}`) : undefined,
      payments_after: payOps ? payOps.map((p) => `${p.payment_type} ${round2(p.amount).toFixed(2)}`) : undefined,
      loyalty: loyalty ? {
        original_points: loyalty.original_points, new_points: loyalty.new_points,
        adjustment: loyalty.adjustment, applied: loyalty.applied, shortfall: loyalty.shortfall, message: loyalty.message
      } : undefined
    }));
  } catch (err) {
    console.warn('[updateSale] audit:', err.message || err);
  }
  return { success: true, sale_id: saleId, total: newTotal, edited_at: nowIso, edited_by_name: actorName || null, loyalty };
}

const SALE_EDIT_LABELS = {
  receipt_number: 'Receipt no.', order_type: 'Order type', customer_id: 'Customer', table_name: 'Table',
  delivery_address: 'Delivery address', delivery_place: 'Delivery place', delivery_fee: 'Delivery fee',
  discount: 'Discount', total: 'Total', notes: 'Notes'
};
const SALE_EDIT_MONEY = new Set(['delivery_fee', 'discount', 'total']);

/** Human-readable "field: before → after" lines for one update_sale audit entry. */
function describeSaleEdit(d) {
  const before = d.before || {};
  const updates = d.updates || {};
  const lines = [];
  const customerLabel = (id) => {
    if (!id) return 'Walk-in';
    try {
      const c = getDb().prepare('SELECT name, phone FROM customers WHERE id = ?').get(Number(id));
      return c ? `${c.name || 'Customer'}${c.phone ? ` (${c.phone})` : ''}` : `#${id}`;
    } catch (_) { return `#${id}`; }
  };
  const fmt = (key, v) => {
    if (key === 'customer_id') return customerLabel(v);
    if (SALE_EDIT_MONEY.has(key)) return `R${round2(v).toFixed(2)}`;
    const s = v == null || v === '' ? '—' : String(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  };
  for (const key of Object.keys(SALE_EDIT_LABELS)) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    const a = before[key];
    const b = updates[key];
    const same = SALE_EDIT_MONEY.has(key)
      ? round2(a) === round2(b)
      : String(a ?? '') === String(b ?? '');
    if (same) continue;
    lines.push(`${SALE_EDIT_LABELS[key]}: ${fmt(key, a)} → ${fmt(key, b)}`);
  }
  const added = d.items_added || [];
  const removed = d.items_removed || [];
  if (added.length === 1 && removed.length === 1) {
    lines.push(`Product replaced: ${removed[0]} → ${added[0]}`);
  } else {
    for (const r of removed) lines.push(`Product removed: ${r}`);
    for (const a of added) lines.push(`Product added: ${a}`);
  }
  for (const c of d.items_changed_detail || []) lines.push(`Item changed — ${c}`);
  if (d.payments_before && d.payments_after && d.payments_before.join('|') !== d.payments_after.join('|')) {
    lines.push(`Payments: ${d.payments_before.join(' + ') || '—'} → ${d.payments_after.join(' + ') || '—'}`);
  }
  if (!lines.length) lines.push('Re-saved — no values changed');
  if (d.loyalty?.message) lines.push(d.loyalty.message);
  return lines;
}

function getSaleEditHistory(saleId) {
  try {
    return getDb().prepare(`SELECT id, username, details, created_at FROM audit_log
      WHERE entity_type = 'sale' AND action = 'update_sale' AND entity_id = ? ORDER BY id DESC LIMIT 20`).all(Number(saleId))
      .map((r) => {
        let d = {};
        try { d = JSON.parse(r.details || '{}'); } catch (_) { /* */ }
        return {
          id: r.id, by: r.username, at: r.created_at, reason: d.reason || null,
          changed: Object.keys(d.updates || {}).filter((k) => k !== 'order_number'),
          items_added: d.items_added || [], items_removed: d.items_removed || [], items_changed: d.items_changed || 0,
          changes: describeSaleEdit(d)
        };
      });
  } catch (_) {
    return [];
  }
}

function deleteSaleRecord(saleId, reason, actorId, actorName) {
  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) throw new Error('Sale not found');
  const returnsCount = db.prepare(`
    SELECT COUNT(*) as c FROM returns WHERE sale_id = ? AND status IN ('completed', 'reopened')
  `).get(saleId);
  if ((Number(returnsCount?.c) || 0) > 0) {
    throw new Error('Cannot delete a sale that has returns — remove returns first');
  }
  if (sale.status === 'completed') {
    voidSale(saleId, reason || 'Deleted by admin', actorId, actorName);
  }
  db.transaction(() => {
    try {
      require('./loyalty-points').purgeLotsForSale(saleId);
    } catch (_) { /* optional */ }
    db.prepare('DELETE FROM loyalty_transactions WHERE sale_id = ?').run(saleId);
    db.prepare('DELETE FROM sale_payments WHERE sale_id = ?').run(saleId);
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
    db.prepare('UPDATE online_orders_local SET sale_id = NULL WHERE sale_id = ?').run(saleId);
    db.prepare('DELETE FROM sales WHERE id = ?').run(saleId);
  })();
  try {
    const mobileMgr = require('./mobile-manager');
    mobileMgr.purgeAlertsForSale(saleId);
  } catch (_) { /* optional */ }
  try {
    const store = require('./store');
    store.purgeNotificationsForEntity?.('sale', saleId);
  } catch (_) { /* optional */ }
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'delete_sale', 'sale', saleId, JSON.stringify({
      receipt_number: sale.receipt_number, order_number: sale.order_number, total: sale.total, reason: reason || null
    }));
  return { success: true };
}

function deleteSalesBulk(saleIds, reason, actorId, actorName) {
  const ids = [...new Set((Array.isArray(saleIds) ? saleIds : []).map((id) => Number(id)).filter(Boolean))];
  if (!ids.length) throw new Error('No sales selected');
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw new Error('Reason required');
  const deleted = [];
  const failed = [];
  for (const id of ids) {
    try {
      deleteSaleRecord(id, trimmedReason, actorId, actorName);
      deleted.push(id);
    } catch (err) {
      failed.push({ id, error: err.message || String(err) });
    }
  }
  return {
    success: failed.length === 0,
    deleted,
    failed,
    deleted_count: deleted.length,
    failed_count: failed.length
  };
}

function getSoldProductsReport(from, to) {
  return getDb().prepare(`
    SELECT si.product_id, si.product_name,
      SUM(si.quantity) as qty_sold,
      SUM(si.total) as revenue,
      SUM(si.total - si.buying_price * si.quantity) as profit
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    WHERE date(s.created_at) BETWEEN date(?) AND date(?) AND s.status = 'completed'
    GROUP BY si.product_id, si.product_name
    ORDER BY qty_sold DESC
  `).all(from, to);
}

function getLowPerformanceProducts(days = 30) {
  const n = Math.max(1, Number(days) || 30);
  return getDb().prepare(`
    SELECT p.id, p.name, p.stock_quantity, p.selling_price,
      (SELECT MAX(s.created_at) FROM sale_items si JOIN sales s ON si.sale_id=s.id
       WHERE si.product_id=p.id AND s.status='completed') as last_sold
    FROM products p WHERE p.is_active=1 AND (p.is_archived=0 OR p.is_archived IS NULL)
    AND p.id NOT IN (
      SELECT DISTINCT si.product_id FROM sale_items si
      JOIN sales s ON si.sale_id=s.id
      WHERE date(s.created_at) >= date('now', ?) AND s.status='completed' AND si.product_id IS NOT NULL
    )
    ORDER BY p.stock_quantity DESC LIMIT 20
  `).all(`-${n} days`);
}

function getReturnDetail(id) {
  const db = getDb();
  const ret = db.prepare(`
    SELECT r.*, u.full_name as user_name, s.total as original_total, s.created_at as sale_date
    FROM returns r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN sales s ON r.sale_id = s.id
    WHERE r.id = ?
  `).get(id);
  if (!ret) return null;
  ret.items = db.prepare('SELECT * FROM return_items WHERE return_id = ?').all(id);
  if (ret.sale_id) {
    ret.original_items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(ret.sale_id);
  }
  return ret;
}

function getReturnsList(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT r.*, u.full_name as user_name, c.name as customer_name
    FROM returns r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN customers c ON r.customer_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (filters.from) { sql += ' AND date(r.created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(r.created_at) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY r.created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  return db.prepare(sql).all(...params);
}

function getPriceChangeHistory(limit = 100) {
  return getDb().prepare(`
    SELECT * FROM price_change_history ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

function logPriceChange(productId, productName, oldPrice, newPrice, actorId, actorName) {
  if (oldPrice === newPrice) return;
  getDb().prepare(`
    INSERT INTO price_change_history (product_id, product_name, old_price, new_price, changed_by, changed_by_name)
    VALUES (?,?,?,?,?,?)
  `).run(productId, productName, oldPrice, newPrice, actorId, actorName);
}

function getActivityTimeline(from, to) {
  const db = getDb();
  const audit = db.prepare(`
    SELECT created_at, username, action, entity_type, entity_id, details
    FROM audit_log WHERE date(created_at, 'localtime') BETWEEN date(?) AND date(?)
    ORDER BY created_at DESC LIMIT 200
  `).all(from, to);

  const sales = db.prepare(`
    SELECT created_at, receipt_number, total, 'sale_completed' as action
    FROM sales WHERE date(created_at, 'localtime') BETWEEN date(?) AND date(?)
    ORDER BY created_at DESC LIMIT 100
  `).all(from, to);

  const events = [
    ...audit.map(a => ({ time: a.created_at, user: a.username, action: a.action, detail: a.details, type: 'audit' })),
    ...sales.map(s => ({ time: s.created_at, user: '—', action: 'Sale Completed', detail: `${s.receipt_number} — ${s.total}`, type: 'sale' }))
  ].sort((a, b) => new Date(b.time) - new Date(a.time));
  return events.slice(0, 200);
}

function getExceptionReport(from, to) {
  const db = getDb();
  return {
    highDiscounts: db.prepare(`
      SELECT receipt_number, discount, total, created_at FROM sales
      WHERE discount > total * 0.2 AND date(created_at) BETWEEN date(?) AND date(?) AND status='completed'
      ORDER BY discount DESC LIMIT 20
    `).all(from, to),
    voidedSales: db.prepare(`
      SELECT receipt_number, total, void_reason, created_at FROM sales
      WHERE status IN ('void', 'voided') AND date(created_at) BETWEEN date(?) AND date(?)
    `).all(from, to),
    largeRefunds: db.prepare(`
      SELECT r.return_number, r.receipt_number, r.total_refund, r.reason, r.created_at, u.full_name as user_name
      FROM returns r LEFT JOIN users u ON r.user_id=u.id
      WHERE r.total_refund > 500 AND date(r.created_at) BETWEEN date(?) AND date(?)
      ORDER BY r.total_refund DESC LIMIT 20
    `).all(from, to),
    negativeStock: db.prepare(`
      SELECT name, stock_quantity FROM products WHERE stock_quantity < 0 AND is_active=1
    `).all(),
    stockAdjustments: db.prepare(`
      SELECT sm.*, p.name as product_name, u.full_name as user_name FROM stock_movements sm
      JOIN products p ON sm.product_id=p.id LEFT JOIN users u ON sm.user_id=u.id
      WHERE sm.movement_type IN ('adjust','set') AND date(sm.created_at) BETWEEN date(?) AND date(?)
      ORDER BY sm.created_at DESC LIMIT 30
    `).all(from, to),
    priceChanges: db.prepare(`
      SELECT * FROM price_change_history WHERE date(created_at) BETWEEN date(?) AND date(?)
      ORDER BY created_at DESC LIMIT 20
    `).all(from, to)
  };
}

function getAdminAlerts() {
  const db = getDb();
  const alerts = [];
  const outOfStock = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_active=1 AND stock_quantity <= 0').get().c;
  if (outOfStock > 0) alerts.push({ level: 'red', message: `${outOfStock} products are out of stock`, action: 'inventory' });

  const lowStock = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_active=1 AND stock_quantity > 0 AND stock_quantity <= min_stock').get().c;
  if (lowStock > 0) alerts.push({ level: 'yellow', message: `${lowStock} products are below minimum stock`, action: 'inventory' });

  const openShift = db.prepare("SELECT COUNT(*) as c FROM shifts WHERE status='open'").get().c;
  const oldOpenShifts = db.prepare("SELECT COUNT(*) as c FROM shifts WHERE status='open' AND date(opened_at) < date('now')").get().c;
  if (oldOpenShifts > 0) alerts.push({ level: 'red', message: `${oldOpenShifts} shift(s) not closed from previous day`, action: 'shifts' });

  const todayRefunds = db.prepare("SELECT COUNT(*) as c FROM returns WHERE date(created_at)=date('now')").get().c;
  if (todayRefunds >= 5) alerts.push({ level: 'yellow', message: `${todayRefunds} refunds processed today`, action: 'returns' });

  const pendingPO = db.prepare("SELECT COUNT(*) as c FROM purchase_orders WHERE status IN ('pending','partial')").get().c;
  if (pendingPO > 0) alerts.push({ level: 'yellow', message: `${pendingPO} purchase orders pending`, action: 'po' });

  let settings = null;
  try {
    settings = db.prepare('SELECT last_backup, backup_settings FROM shop_settings WHERE id=1').get();
  } catch (_) {
    try { settings = db.prepare('SELECT last_backup FROM shop_settings WHERE id=1').get(); } catch (__) { settings = null; }
  }
  if (!settings?.last_backup) {
    alerts.push({ level: 'red', message: 'Database backup has never been done', action: 'backup' });
  } else {
    const daysSince = (Date.now() - new Date(settings.last_backup).getTime()) / 86400000;
    if (daysSince > 7) alerts.push({ level: 'red', message: `Database backup overdue (${Math.floor(daysSince)} days)`, action: 'backup' });
  }

  const expiring = db.prepare(`
    SELECT COUNT(*) as c FROM products WHERE expiry_date IS NOT NULL
    AND date(expiry_date) <= date('now', '+30 days') AND date(expiry_date) >= date('now') AND is_active=1
  `).get().c;
  if (expiring > 0) alerts.push({ level: 'yellow', message: `${expiring} products expiring within 30 days`, action: 'inventory' });

  return alerts;
}

function getAdminDashboardFull(from, to, branchId) {
  const db = getDb();
  const flags = branchesSvc.ensureBranchSchema();
  const today = new Date().toLocaleDateString('en-CA');
  const rangeFrom = from || today;
  const rangeTo = to || today;
  const rangeAnchor = new Date(`${rangeFrom}T12:00:00`);
  const yesterday = new Date(rangeAnchor.getFullYear(), rangeAnchor.getMonth(), rangeAnchor.getDate() - 1)
    .toLocaleDateString('en-CA');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleDateString('en-CA');
  ensureSalesListSchema();
  // Same business date as POS targets and the Business Manager app (backdated orders use sale_datetime)
  const hasSaleDt = salesHasColumn('sale_datetime');
  const saleDate = hasSaleDt ? "date(COALESCE(sale_datetime, created_at), 'localtime')" : "date(created_at, 'localtime')";
  const saleItemDate = hasSaleDt ? "date(COALESCE(s.sale_datetime, s.created_at), 'localtime')" : "date(s.created_at, 'localtime')";
  const returnDate = "date(created_at, 'localtime')";
  const canScopeSales = !!(branchId && flags.sales);
  const canScopeExpenses = !!(branchId && flags.expenses);
  const canScopeStock = !!(branchId && flags.branch_stock);
  const saleBranch = canScopeSales ? ' AND branch_id = ?' : '';
  const saleBranchJoin = canScopeSales ? ' AND s.branch_id = ?' : '';
  const saleBranchParams = canScopeSales ? [branchId] : [];
  const soft = (label, fn, fallback) => {
    try { return fn(); }
    catch (err) {
      console.warn('[admin-dashboard]', label, err.message || err);
      return fallback;
    }
  };

  const coreQueries = [
    { method: 'get', sql: `SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales WHERE ${saleDate} BETWEEN date(?) AND date(?) AND status='completed'${saleBranch}`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'get', sql: `SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales WHERE ${saleDate}=date(?) AND status='completed'${saleBranch}`, params: [yesterday, ...saleBranchParams] },
    { method: 'get', sql: `SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales WHERE ${saleDate}>=date(?) AND status='completed'${saleBranch}`, params: [monthStart, ...saleBranchParams] },
    { method: 'get', sql: `SELECT COALESCE(SUM(si.quantity),0) as qty FROM sale_items si JOIN sales s ON si.sale_id=s.id WHERE ${saleItemDate} BETWEEN date(?) AND date(?) AND s.status='completed'${saleBranchJoin}`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'get', sql: `SELECT COALESCE(SUM(si.buying_price * si.quantity),0) as cost FROM sale_items si JOIN sales s ON si.sale_id=s.id WHERE ${saleItemDate} BETWEEN date(?) AND date(?) AND s.status='completed'${saleBranchJoin}`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'get', sql: `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)${canScopeExpenses ? ' AND branch_id = ?' : ''}`, params: canScopeExpenses ? [rangeFrom, rangeTo, branchId] : [rangeFrom, rangeTo] },
    { method: 'get', sql: `SELECT COALESCE(SUM(r.total_refund),0) as total FROM returns r LEFT JOIN sales s ON s.id=r.sale_id WHERE ${returnDate.replace('created_at', 'r.created_at')} BETWEEN date(?) AND date(?)${canScopeSales ? ' AND s.branch_id = ?' : ''}`, params: canScopeSales ? [rangeFrom, rangeTo, branchId] : [rangeFrom, rangeTo] },
    { method: 'get', sql: `SELECT COALESCE(SUM(discount),0) as total FROM sales WHERE ${saleDate} BETWEEN date(?) AND date(?) AND status='completed'${saleBranch}`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'all', sql: `SELECT si.product_name, SUM(si.quantity) as qty, SUM(si.total) as revenue FROM sale_items si JOIN sales s ON si.sale_id=s.id WHERE ${saleItemDate} BETWEEN date(?) AND date(?) AND s.status='completed'${saleBranchJoin} GROUP BY si.product_name ORDER BY qty DESC LIMIT 10`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'all', sql: `SELECT COALESCE(c.name, 'Uncategorised') as category_name, SUM(si.total) as revenue, SUM(si.quantity) as qty FROM sale_items si JOIN sales s ON si.sale_id=s.id LEFT JOIN products p ON si.product_id=p.id LEFT JOIN categories c ON p.category_id=c.id WHERE ${saleItemDate} BETWEEN date(?) AND date(?) AND s.status='completed'${saleBranchJoin} GROUP BY COALESCE(c.name, 'Uncategorised') ORDER BY revenue DESC LIMIT 10`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'all', sql: canScopeStock
      ? `SELECT p.name, bs.quantity as stock_quantity, bs.min_stock as min_stock FROM branch_stock bs JOIN products p ON p.id=bs.product_id WHERE bs.branch_id=? AND p.is_active=1 AND bs.quantity <= bs.min_stock AND bs.quantity > 0 ORDER BY bs.quantity LIMIT 10`
      : `SELECT name, stock_quantity, min_stock FROM products WHERE is_active=1 AND stock_quantity <= min_stock AND stock_quantity > 0 ORDER BY stock_quantity LIMIT 10`, params: canScopeStock ? [branchId] : [] },
    { method: 'all', sql: canScopeStock
      ? `SELECT p.name FROM branch_stock bs JOIN products p ON p.id=bs.product_id WHERE bs.branch_id=? AND p.is_active=1 AND bs.quantity <= 0 LIMIT 10`
      : `SELECT name FROM products WHERE is_active=1 AND stock_quantity <= 0 LIMIT 10`, params: canScopeStock ? [branchId] : [] },
    { method: 'all', sql: `SELECT sp.payment_type, SUM(sp.amount) as total FROM sale_payments sp JOIN sales s ON sp.sale_id=s.id WHERE ${saleItemDate} BETWEEN date(?) AND date(?) AND s.status='completed'${saleBranchJoin} GROUP BY sp.payment_type`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'all', sql: `SELECT u.full_name, COUNT(s.id) as orders, SUM(s.total) as revenue FROM sales s JOIN users u ON s.user_id=u.id WHERE ${saleItemDate} BETWEEN date(?) AND date(?) AND s.status='completed'${saleBranchJoin} GROUP BY u.id, u.full_name ORDER BY revenue DESC`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'get', sql: canScopeStock
      ? `SELECT COALESCE(SUM(bs.quantity * p.buying_price),0) as val FROM branch_stock bs JOIN products p ON p.id=bs.product_id WHERE bs.branch_id=? AND p.is_active=1`
      : `SELECT COALESCE(SUM(stock_quantity * buying_price),0) as val FROM products WHERE is_active=1`, params: canScopeStock ? [branchId] : [] },
    { method: 'get', sql: `SELECT COUNT(*) as c FROM shifts WHERE status='open'`, params: [] },
    { method: 'get', sql: `SELECT COUNT(*) as c FROM shifts WHERE status='closed' AND date(closed_at, 'localtime')=date(?)`, params: [rangeTo] },
    { method: 'all', sql: `SELECT ${saleDate} as day, SUM(total) as total FROM sales WHERE ${saleDate} BETWEEN date(?) AND date(?) AND status='completed'${saleBranch} GROUP BY ${saleDate} ORDER BY day`, params: [rangeFrom, rangeTo, ...saleBranchParams] },
    { method: 'get', sql: `SELECT COUNT(*) as c FROM employee_leave WHERE status='pending'`, params: [] }
  ];

  // Run per-query so one missing table/column cannot blank the whole dashboard.
  const core = coreQueries.map((q, idx) => soft(`core[${idx}]`, () => {
    const st = db.prepare(q.sql);
    return q.method === 'get' ? st.get(...(q.params || [])) : st.all(...(q.params || []));
  }, q.method === 'get' ? {} : []));

  const [
    periodSales, yesterdaySales, monthSales, periodItems, periodCost, periodExpenses, periodRefunds, periodDiscounts,
    topProducts, topCategories, lowStock, outOfStock, paymentBreakdown, cashierPerf, inventoryValue, openShiftsRow,
    closedShiftsRow, salesGraph, pendingLeaveRow
  ] = core;

  const grossProfit = (periodSales?.total || 0) - (periodCost?.cost || 0);
  const netProfit = grossProfit - (periodExpenses?.total || 0) - (periodRefunds?.total || 0);

  const posChannelStats = soft('posChannelStats', () => db.prepare(`
    SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM sales
    WHERE ${saleDate} BETWEEN date(?) AND date(?) AND status='completed'${saleBranch}
      AND COALESCE(order_type,'') != 'online' AND COALESCE(order_source,'') NOT IN ('ONLINE','WEB')
  `).get(rangeFrom, rangeTo, ...saleBranchParams), { total: 0, count: 0 });

  const onlineChannelStats = soft('onlineChannelStats', () => db.prepare(`
    SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM sales
    WHERE ${saleDate} BETWEEN date(?) AND date(?) AND status='completed'${saleBranch}
      AND (COALESCE(order_type,'') = 'online' OR COALESCE(order_source,'') IN ('ONLINE','WEB'))
  `).get(rangeFrom, rangeTo, ...saleBranchParams), { total: 0, count: 0 });

  const onlinePendingStats = soft('onlinePendingStats', () => db.prepare(`
    SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM online_orders_local
    WHERE date(created_at, 'localtime') BETWEEN date(?) AND date(?)
      AND status NOT IN ('cancelled','rejected') AND (sale_id IS NULL OR sale_id = 0)
      ${canScopeSales ? 'AND branch_id = ?' : ''}
  `).get(...(canScopeSales ? [rangeFrom, rangeTo, branchId] : [rangeFrom, rangeTo])), { total: 0, count: 0 });

  const voidedStats = soft('voidedStats', () => db.prepare(`
    SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM sales
    WHERE ${saleDate} BETWEEN date(?) AND date(?) AND status IN ('voided','void')${saleBranch}
  `).get(rangeFrom, rangeTo, ...saleBranchParams), { total: 0, count: 0 });

  const mostReturned = soft('mostReturned', () => db.prepare(`
    SELECT ri.product_name, SUM(ri.quantity) as qty, SUM(ri.total) as refund_total
    FROM return_items ri JOIN returns r ON ri.return_id=r.id
    WHERE date(r.created_at, 'localtime') >= date('now', 'localtime', '-30 days')
    GROUP BY ri.product_name ORDER BY qty DESC LIMIT 10
  `).all(), []);

  const recentSales = soft('recentSales', () => getUnifiedSalesList({
    from: rangeFrom,
    to: rangeTo,
    limit: 20,
    ...(canScopeSales ? { branch_id: branchId } : {})
  }), []);
  const hourlySales = rangeFrom === rangeTo
    ? soft('hourlySales', () => db.prepare(`
        SELECT strftime('%H', ${hasSaleDt ? 'COALESCE(sale_datetime, created_at)' : 'created_at'}, 'localtime') as hour, SUM(total) as total FROM sales
        WHERE ${saleDate}=date(?) AND status='completed'${saleBranch} GROUP BY hour ORDER BY hour
      `).all(rangeFrom, ...saleBranchParams), [])
    : [];
  const recentActivity = soft('activity', () => getActivityTimeline(rangeFrom, rangeTo).slice(0, 15), []);
  const alerts = soft('alerts', () => getAdminAlerts(), []);

  const posOrders = Number(posChannelStats?.count) || 0;
  const onlineAcceptedOrders = Number(onlineChannelStats?.count) || 0;
  const onlinePendingOrders = Number(onlinePendingStats?.count) || 0;
  const posSales = Number(posChannelStats?.total) || 0;
  const onlineAcceptedSales = Number(onlineChannelStats?.total) || 0;
  const onlinePendingSales = Number(onlinePendingStats?.total) || 0;
  const periodOrderCount = posOrders + onlineAcceptedOrders + onlinePendingOrders;
  const periodSalesTotal = posSales + onlineAcceptedSales + onlinePendingSales;

  return {
    from: rangeFrom, to: rangeTo,
    today: {
      sales: periodSalesTotal,
      orders: periodOrderCount,
      items: periodItems?.qty || 0,
      grossProfit,
      netProfit,
      expenses: periodExpenses?.total || 0,
      refunds: periodRefunds?.total || 0,
      discounts: periodDiscounts?.total || 0,
      avgOrder: periodOrderCount ? periodSalesTotal / periodOrderCount : 0
    },
    voided: { sales: Number(voidedStats?.total) || 0, orders: Number(voidedStats?.count) || 0 },
    yesterday: { sales: yesterdaySales?.total || 0, orders: yesterdaySales?.count || 0 },
    month: { sales: monthSales?.total || 0, orders: monthSales?.count || 0 },
    topProducts: topProducts || [],
    topCategories: topCategories || [],
    mostReturned,
    lowStock: lowStock || [],
    outOfStock: outOfStock || [],
    recentSales,
    hourlySales,
    paymentBreakdown: paymentBreakdown || [],
    cashierPerf: cashierPerf || [],
    inventoryValue: inventoryValue?.val || 0,
    openShifts: openShiftsRow?.c || 0,
    closedShifts: closedShiftsRow?.c || 0,
    salesGraph: salesGraph || [],
    recentActivity,
    alerts,
    pendingLeave: pendingLeaveRow?.c || 0,
    ownerFundingMonth: soft('ownerFundingMonth', () => {
      try {
        const extras = require('./expense-extras');
        extras.ensureExpenseExtrasSchema();
        const mk = extras.monthKey();
        const rows = extras.listOwnerFundings({ from: `${mk}-01`, to: rangeTo, limit: 500 });
        return (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      } catch (_) {
        return 0;
      }
    }, 0),
    channels: {
      pos: { sales: posSales, orders: posOrders },
      online: { sales: onlineAcceptedSales, orders: onlineAcceptedOrders },
      online_pending: { sales: onlinePendingSales, orders: onlinePendingOrders }
    },
    widgetErrors: []
  };
}

function getDailyClosingReport(date) {
  const db = getDb();
  const d = date || new Date().toLocaleDateString('en-CA');
  const shift = db.prepare(`
    SELECT sh.*, u.full_name as user_name FROM shifts sh LEFT JOIN users u ON sh.user_id=u.id
    WHERE date(sh.opened_at)=date(?) ORDER BY sh.opened_at DESC LIMIT 1
  `).get(d);

  const sales = db.prepare(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales WHERE date(COALESCE(sale_datetime, created_at))=date(?) AND status='completed'`).get(d);
  const paymentsByType = db.prepare(`
    SELECT sp.payment_type, COALESCE(SUM(sp.amount),0) as total, COUNT(*) as count
    FROM sale_payments sp JOIN sales s ON sp.sale_id=s.id
    WHERE date(COALESCE(s.sale_datetime, s.created_at))=date(?) AND s.status='completed'
    GROUP BY sp.payment_type ORDER BY total DESC
  `).all(d);
  const byOrderType = db.prepare(`
    SELECT COALESCE(order_type, 'walk_in') as order_type, COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE date(COALESCE(sale_datetime, created_at))=date(?) AND status='completed'
    GROUP BY COALESCE(order_type, 'walk_in') ORDER BY total DESC
  `).all(d);
  const saleRows = db.prepare(`
    SELECT s.id, s.receipt_number, s.order_number, s.created_at, s.sale_datetime, s.is_backdated, s.total, s.discount, s.tax_amount, s.status,
      s.order_type, s.table_name, u.full_name as cashier_name, c.name as customer_name,
      (SELECT GROUP_CONCAT(payment_type || ' ' || amount, ', ') FROM sale_payments WHERE sale_id = s.id) as payments
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE date(COALESCE(s.sale_datetime, s.created_at))=date(?) AND s.status IN ('completed','voided','void')
    ORDER BY COALESCE(s.sale_datetime, s.created_at) ASC
  `).all(d);
  const cash = paymentsByType.find(p => p.payment_type === 'cash')?.total || 0;
  const card = paymentsByType.find(p => p.payment_type === 'card')?.total || 0;
  const eft = paymentsByType.find(p => p.payment_type === 'eft')?.total || 0;
  const mobile = paymentsByType.find(p => p.payment_type === 'mobile')?.total || 0;
  const account = paymentsByType.find(p => p.payment_type === 'account')?.total || 0;
  const giftcard = paymentsByType.find(p => p.payment_type === 'giftcard')?.total || 0;
  const refunds = db.prepare(`SELECT COALESCE(SUM(total_refund),0) as total FROM returns WHERE date(created_at)=date(?)`).get(d);
  const discounts = db.prepare(`SELECT COALESCE(SUM(discount),0) as total FROM sales WHERE date(created_at)=date(?) AND status='completed'`).get(d);
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date(expense_date)=date(?)`).get(d);
  const profit = db.prepare(`
    SELECT COALESCE(SUM(si.total - si.buying_price * si.quantity),0) as p FROM sale_items si
    JOIN sales s ON si.sale_id=s.id WHERE date(s.created_at)=date(?) AND s.status='completed'
  `).get(d);

  const openingFloat = shift?.opening_float || 0;
  const expectedCash = openingFloat + cash - refunds.total - expenses.total;
  const actualCash = shift?.cash_counted || 0;
  const cashDiff = shift ? (actualCash - expectedCash) : 0;

  return {
    date: d, shift, openingFloat, totalSales: sales.total, orderCount: sales.count,
    cashSales: cash, cardSales: card, eftSales: eft, mobileSales: mobile, accountSales: account, giftCardSales: giftcard,
    paymentsByType, byOrderType, sales: saleRows,
    refunds: refunds.total, discounts: discounts.total, expenses: expenses.total,
    profit: profit.p - expenses.total, expectedCash, actualCash, cashDifference: cashDiff,
    closedAt: shift?.closed_at, closedBy: shift?.user_name
  };
}

function getCustomerPurchaseSummary(customerId) {
  const db = getDb();
  const sales = db.prepare(`
    SELECT s.*, u.full_name as cashier_name FROM sales s
    LEFT JOIN users u ON s.user_id=u.id
    WHERE s.customer_id=? AND s.status='completed' ORDER BY s.created_at DESC
  `).all(customerId);
  let onlineRows = [];
  try {
    onlineRows = db.prepare(`
      SELECT o.* FROM online_orders_local o
      WHERE o.customer_id = ? AND o.status NOT IN ('cancelled')
      ORDER BY o.created_at DESC LIMIT 50
    `).all(customerId);
  } catch (_) { /* optional */ }
  const onlineAsHistory = onlineRows.map((o) => ({
    id: `online-${o.id}`,
    online_order_id: o.id,
    receipt_number: o.order_number,
    order_number: o.order_number,
    total: Number(o.total) || 0,
    created_at: o.created_at,
    cashier_name: 'Online',
    status: o.status,
    order_source: 'ONLINE',
    source: 'online'
  }));
  const posHistory = sales.map((s) => ({ ...s, source: 'pos' }));
  const merged = [...posHistory, ...onlineAsHistory]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const onlineSpent = onlineRows
    .filter((o) => !['rejected', 'cancelled'].includes(String(o.status).toLowerCase()))
    .reduce((n, o) => n + (Number(o.total) || 0), 0);
  const totalSpent = sales.reduce((s, x) => s + (Number(x.total) || 0), 0) + onlineSpent;
  const orderCount = sales.length + onlineRows.filter((o) => !['rejected', 'cancelled'].includes(String(o.status).toLowerCase())).length;
  const fav = db.prepare(`
    SELECT si.product_name, SUM(si.quantity) as qty FROM sale_items si
    JOIN sales s ON si.sale_id=s.id WHERE s.customer_id=? AND s.status='completed'
    GROUP BY si.product_name ORDER BY qty DESC LIMIT 1
  `).get(customerId);
  return {
    sales: merged,
    posSales: sales,
    onlineOrders: onlineRows,
    totalSpent,
    orderCount,
    avgPurchase: orderCount ? totalSpent / orderCount : 0,
    favouriteProduct: fav?.product_name || '—',
    lastVisit: merged[0]?.created_at || null
  };
}

function getReturnReasonsReport(from, to) {
  return getDb().prepare(`
    SELECT reason, COUNT(*) as count, SUM(total_refund) as total_refund
    FROM returns WHERE date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY reason ORDER BY count DESC
  `).all(from, to);
}

function reopenReturn(returnId, actorId, actorName) {
  const db = getDb();
  const inventory = require('./inventory');
  const combosSvc = require('./combos');
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(returnId);
  if (!ret) throw new Error('Return not found');
  if (ret.status !== 'completed') throw new Error('Return is not in completed status');
  const items = db.prepare('SELECT * FROM return_items WHERE return_id = ?').all(returnId);
  const adjustStock = (...args) => require('./store').adjustStock(...args);
  db.transaction(() => {
    // Reverse stock that was restored by the return (undo the return)
    if (ret.return_to_stock) {
      for (const item of items) {
        const note = `Reopen/cancel return ${ret.return_number || returnId}`;
        if (item.combo_id) {
          const combo = combosSvc.getCombo(item.combo_id);
          for (const ci of combo?.items || []) {
            const qty = (Number(ci.quantity) || 1) * (Number(item.quantity) || 0);
            if (qty > 0) adjustStock(ci.product_id, qty, 'sale', note, actorId, 'return_reopen', returnId);
          }
        } else if (item.product_id) {
          let selectedMods = [];
          if (item.sale_item_id) {
            const si = db.prepare('SELECT modifiers_text FROM sale_items WHERE id = ?').get(item.sale_item_id);
            if (si?.modifiers_text) {
              selectedMods = String(si.modifiers_text).split(',').map(s => ({ name: s.trim() })).filter(m => m.name);
            }
          }
          const recipeDeducted = inventory.deductRecipeIngredients(
            item.product_id, item.quantity, note, actorId, 'return_reopen', returnId, adjustStock, selectedMods
          );
          if (!recipeDeducted) {
            adjustStock(item.product_id, Number(item.quantity) || 0, 'sale', note, actorId, 'return_reopen', returnId);
          }
        }
      }
    }
    db.prepare("UPDATE returns SET status = 'cancelled', notes = COALESCE(notes,'') || ' Cancelled/reopened by ' || ? WHERE id = ?")
      .run(actorName, returnId);
    // Restore sale status based on remaining completed returns
    if (ret.sale_id) {
      const remaining = db.prepare(`
        SELECT COALESCE(SUM(ri.quantity), 0) as qty FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ? AND r.status IN ('completed', 'reopened')
      `).get(ret.sale_id);
      const sold = db.prepare(`SELECT COALESCE(SUM(quantity), 0) as qty FROM sale_items WHERE sale_id = ?`).get(ret.sale_id);
      const remQty = Number(remaining?.qty) || 0;
      const soldQty = Number(sold?.qty) || 0;
      let status = 'completed';
      if (remQty > 0.001 && remQty >= soldQty - 0.001) status = 'returned';
      else if (remQty > 0.001) status = 'partial_return';
      db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(status, ret.sale_id);
    }
  })();
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'reopen_return', 'return', returnId, JSON.stringify({ return_number: ret.return_number, status: 'cancelled' }));
  return { success: true };
}

function verifyManagerPin(pin) {
  const users = getDb().prepare("SELECT id, full_name, role, pin FROM users WHERE role IN ('owner','manager') AND is_active=1").all();
  for (const u of users) {
    if (!u.pin) continue;
    const check = verifyPinWithUpgrade(u.pin, pin);
    if (!check.ok) continue;
    if (check.needsUpgrade && check.hash) {
      try { getDb().prepare('UPDATE users SET pin = ? WHERE id = ?').run(check.hash, u.id); } catch (_) { /* ignore */ }
    }
    return { id: u.id, full_name: u.full_name, role: u.role };
  }
  throw new Error('Invalid manager PIN');
}

function getTopCustomers(from, to, limit = 50) {
  const db = getDb();
  const rangeFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const rangeTo = to || new Date().toLocaleDateString('en-CA');
  const lim = Math.min(Number(limit) || 50, 200);
  const rows = db.prepare(`
    SELECT MAX(id) AS id, name, phone, email,
      MAX(loyalty_points) AS loyalty_points,
      MAX(balance) AS balance,
      SUM(pos_spent) AS pos_spent,
      SUM(online_spent) AS online_spent,
      SUM(total_spent) AS total_spent,
      SUM(visits) AS visits
    FROM (
      SELECT c.id, c.name, c.phone, c.email, c.loyalty_points, c.balance,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(s.order_type, '')) IN ('online', 'delivery') THEN 0 ELSE s.total END), 0) AS pos_spent,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(s.order_type, '')) IN ('online', 'delivery') THEN s.total ELSE 0 END), 0) AS online_spent,
        COALESCE(SUM(s.total), 0) AS total_spent, COUNT(s.id) AS visits
      FROM customers c
      INNER JOIN sales s ON s.customer_id = c.id AND s.status = 'completed'
        AND date(s.created_at, 'localtime') BETWEEN date(?) AND date(?)
      GROUP BY c.id, c.name, c.phone, c.email, c.loyalty_points, c.balance
      UNION ALL
      SELECT NULL AS id, COALESCE(o.customer_name, 'Online customer') AS name, o.customer_phone AS phone, o.customer_email AS email,
        NULL AS loyalty_points, NULL AS balance,
        0 AS pos_spent, COALESCE(SUM(o.total), 0) AS online_spent,
        COALESCE(SUM(o.total), 0) AS total_spent, COUNT(o.id) AS visits
      FROM online_orders_local o
      WHERE o.status NOT IN ('cancelled', 'rejected')
        AND (o.sale_id IS NULL OR o.sale_id = 0)
        AND date(o.created_at, 'localtime') BETWEEN date(?) AND date(?)
        AND o.customer_phone IS NOT NULL AND TRIM(o.customer_phone) != ''
      GROUP BY o.customer_phone, o.customer_name, o.customer_email
    ) combined
    GROUP BY COALESCE(CAST(id AS TEXT), phone), name, phone, email
    HAVING SUM(total_spent) > 0
    ORDER BY SUM(total_spent) DESC
    LIMIT ?
  `).all(rangeFrom, rangeTo, rangeFrom, rangeTo, lim);
  const ids = rows.map((r) => r.id).filter(Boolean);
  const loyaltyByCustomer = {};
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    getDb().prepare(`
      SELECT customer_id, COALESCE(SUM(points), 0) AS balance
      FROM loyalty_transactions WHERE customer_id IN (${ph}) GROUP BY customer_id
    `).all(...ids).forEach((r) => {
      loyaltyByCustomer[r.customer_id] = Math.max(0, Math.floor(Number(r.balance) || 0));
    });
  }
  return rows.map((r, i) => ({
    ...r,
    rank: i + 1,
    loyalty_points: r.id && loyaltyByCustomer[r.id] != null
      ? loyaltyByCustomer[r.id]
      : Math.max(0, Math.floor(Number(r.loyalty_points) || 0)),
    pos_spent: Math.round((Number(r.pos_spent) || 0) * 100) / 100,
    online_spent: Math.round((Number(r.online_spent) || 0) * 100) / 100,
    total_spent: Math.round((Number(r.total_spent) || 0) * 100) / 100
  }));
}

module.exports = {
  getSalesList, getSalesListLite, getUnifiedSalesList, getSalesByCashier, getPendingOnlineOrdersForSales, searchSalesExplorer,
  voidSale, updateSaleRecord, deleteSaleRecord, deleteSalesBulk, ensureSaleEditColumns, getSaleEditHistory,
  getSoldProductsReport, getLowPerformanceProducts,
  getReturnDetail, getReturnsList, getReturnReasonsReport, reopenReturn, verifyManagerPin,
  getPriceChangeHistory, logPriceChange,
  getActivityTimeline, getExceptionReport, getAdminAlerts,
  getAdminDashboardFull, getDailyClosingReport, getCustomerPurchaseSummary, getTopCustomers
};
