const { getDb } = require('../database/db');
const { verifyPin, verifyPinWithUpgrade } = require('./pin');
const branchesSvc = require('./branches');

function getSalesList(filters = {}) {
  const db = getDb();
  const flags = branchesSvc.ensureBranchSchema();
  const branchSelect = flags.sales ? 's.branch_id' : 'NULL as branch_id';
  let sql = `
    SELECT s.id, s.receipt_number, s.order_number, s.created_at, s.subtotal, s.discount, s.tax_amount, s.total,
      s.amount_paid, s.change_amount, s.status, s.void_reason, ${branchSelect}, s.notes, s.order_type, s.table_name, s.delivery_address,
      u.full_name as cashier_name, c.name as customer_name,
      (SELECT GROUP_CONCAT(payment_type || ' ' || amount) FROM sale_payments WHERE sale_id = s.id) as payment_methods,
      (SELECT payment_type FROM sale_payments WHERE sale_id = s.id LIMIT 1) as primary_payment,
      (SELECT GROUP_CONCAT(product_name || ' x' || quantity, ', ') FROM sale_items WHERE sale_id = s.id LIMIT 5) as item_summary,
      (SELECT COALESCE(SUM(amount), 0) FROM sale_payments WHERE sale_id = s.id AND payment_type = 'giftcard') as gift_card_amount,
      (SELECT COALESCE(SUM(ABS(points)), 0) FROM loyalty_transactions WHERE sale_id = s.id AND type = 'redeem') as loyalty_points_redeemed
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (filters.from) { sql += " AND date(s.created_at, 'localtime') >= date(?)"; params.push(filters.from); }
  if (filters.to) { sql += " AND date(s.created_at, 'localtime') <= date(?)"; params.push(filters.to); }
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
    sql += " AND (COALESCE(s.order_type, '') != 'online' AND COALESCE(s.order_source, '') NOT IN ('ONLINE','WEB'))";
  }
  if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all' && flags.sales) {
    sql += ' AND s.branch_id = ?';
    params.push(Number(filters.branch_id));
  }
  sql += ' ORDER BY s.created_at DESC';
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

function getUnifiedSalesList(filters = {}) {
  const limit = filters.limit || 500;
  const sales = getSalesList({ ...filters, limit });
  if (filters.pos_only) return sales;
  const pendingOnline = getPendingOnlineOrdersForSales({ ...filters, limit: Math.min(limit, 200) })
    .map(mapOnlineOrderAsSaleRow);
  return [...sales, ...pendingOnline]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, limit);
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
    try {
      require('./marketing-platform').reverseCommissionsForSale(saleId, { id: actorId, full_name: actorName, role: 'owner' }, 'Sale voided');
    } catch (_) { /* best effort */ }
  })();
  try {
    require('./accounting-platform').reverseSaleAccounting(saleId, reason || 'Sale voided');
  } catch (err) {
    console.warn('[voidSale] accounting reversal:', err.message || err);
  }
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'void_sale', 'sale', saleId, JSON.stringify({ receipt_number: sale.receipt_number, reason, total: sale.total }));
  return { success: true };
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
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleDateString('en-CA');
  const saleDate = "date(created_at, 'localtime')";
  const saleItemDate = "date(s.created_at, 'localtime')";
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

  const mostReturned = soft('mostReturned', () => db.prepare(`
    SELECT ri.product_name, SUM(ri.quantity) as qty, SUM(ri.total) as refund_total
    FROM return_items ri JOIN returns r ON ri.return_id=r.id
    WHERE date(r.created_at, 'localtime') >= date('now', 'localtime', '-30 days')
    GROUP BY ri.product_name ORDER BY qty DESC LIMIT 10
  `).all(), []);

  const onlinePendingStats = soft('onlinePendingStats', () => db.prepare(`
    SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM online_orders_local
    WHERE date(created_at, 'localtime') BETWEEN date(?) AND date(?)
      AND status NOT IN ('cancelled','rejected') AND (sale_id IS NULL OR sale_id = 0)
      ${canScopeSales ? 'AND branch_id = ?' : ''}
  `).get(...(canScopeSales ? [rangeFrom, rangeTo, branchId] : [rangeFrom, rangeTo])), { total: 0, count: 0 });

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

  const recentSales = soft('recentSales', () => getUnifiedSalesList({
    from: rangeFrom,
    to: rangeTo,
    limit: 20,
    ...(canScopeSales ? { branch_id: branchId } : {})
  }), []);
  const hourlySales = rangeFrom === rangeTo
    ? soft('hourlySales', () => db.prepare(`
        SELECT strftime('%H', created_at, 'localtime') as hour, SUM(total) as total FROM sales
        WHERE ${saleDate}=date(?) AND status='completed'${saleBranch} GROUP BY hour ORDER BY hour
      `).all(rangeFrom, ...saleBranchParams), [])
    : [];
  const recentActivity = soft('activity', () => getActivityTimeline(rangeFrom, rangeTo).slice(0, 15), []);
  const alerts = soft('alerts', () => getAdminAlerts(), []);

  return {
    from: rangeFrom, to: rangeTo,
    today: {
      sales: periodSales?.total || 0,
      orders: periodSales?.count || 0,
      items: periodItems?.qty || 0,
      grossProfit,
      netProfit,
      expenses: periodExpenses?.total || 0,
      refunds: periodRefunds?.total || 0,
      discounts: periodDiscounts?.total || 0,
      avgOrder: periodSales?.count ? periodSales.total / periodSales.count : 0
    },
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
    channels: {
      pos: { sales: posChannelStats?.total || 0, orders: posChannelStats?.count || 0 },
      online: { sales: onlineChannelStats?.total || 0, orders: onlineChannelStats?.count || 0 },
      online_pending: { sales: onlinePendingStats?.total || 0, orders: onlinePendingStats?.count || 0 }
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

  const sales = db.prepare(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales WHERE date(created_at)=date(?) AND status='completed'`).get(d);
  const paymentsByType = db.prepare(`
    SELECT sp.payment_type, COALESCE(SUM(sp.amount),0) as total, COUNT(*) as count
    FROM sale_payments sp JOIN sales s ON sp.sale_id=s.id
    WHERE date(s.created_at)=date(?) AND s.status='completed'
    GROUP BY sp.payment_type ORDER BY total DESC
  `).all(d);
  const byOrderType = db.prepare(`
    SELECT COALESCE(order_type, 'walk_in') as order_type, COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE date(created_at)=date(?) AND status='completed'
    GROUP BY COALESCE(order_type, 'walk_in') ORDER BY total DESC
  `).all(d);
  const saleRows = db.prepare(`
    SELECT s.id, s.receipt_number, s.order_number, s.created_at, s.total, s.discount, s.tax_amount, s.status,
      s.order_type, s.table_name, u.full_name as cashier_name, c.name as customer_name,
      (SELECT GROUP_CONCAT(payment_type || ' ' || amount, ', ') FROM sale_payments WHERE sale_id = s.id) as payments
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE date(s.created_at)=date(?) AND s.status IN ('completed','voided','void')
    ORDER BY s.created_at ASC
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
  const totalSpent = sales.reduce((s, x) => s + x.total, 0);
  const fav = db.prepare(`
    SELECT si.product_name, SUM(si.quantity) as qty FROM sale_items si
    JOIN sales s ON si.sale_id=s.id WHERE s.customer_id=? AND s.status='completed'
    GROUP BY si.product_name ORDER BY qty DESC LIMIT 1
  `).get(customerId);
  return {
    sales, totalSpent, orderCount: sales.length,
    avgPurchase: sales.length ? totalSpent / sales.length : 0,
    favouriteProduct: fav?.product_name || '—',
    lastVisit: sales[0]?.created_at || null
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
    SELECT id, name, phone, email,
      SUM(pos_spent) AS pos_spent,
      SUM(online_spent) AS online_spent,
      SUM(total_spent) AS total_spent,
      SUM(visits) AS visits
    FROM (
      SELECT c.id, c.name, c.phone, c.email,
        COALESCE(SUM(CASE WHEN COALESCE(s.order_type,'') = 'online' OR UPPER(COALESCE(s.order_source,'')) IN ('ONLINE','WEB') THEN 0 ELSE s.total END), 0) AS pos_spent,
        COALESCE(SUM(CASE WHEN COALESCE(s.order_type,'') = 'online' OR UPPER(COALESCE(s.order_source,'')) IN ('ONLINE','WEB') THEN s.total ELSE 0 END), 0) AS online_spent,
        COALESCE(SUM(s.total), 0) AS total_spent, COUNT(s.id) AS visits
      FROM customers c
      INNER JOIN sales s ON s.customer_id = c.id AND s.status = 'completed'
        AND date(s.created_at, 'localtime') BETWEEN date(?) AND date(?)
      GROUP BY c.id
      UNION ALL
      SELECT NULL AS id, COALESCE(s.customer_name, 'Walk-in') AS name, s.customer_phone AS phone, NULL AS email,
        COALESCE(SUM(s.total), 0) AS pos_spent, 0 AS online_spent,
        COALESCE(SUM(s.total), 0) AS total_spent, COUNT(s.id) AS visits
      FROM sales s
      WHERE s.status = 'completed' AND s.customer_id IS NULL AND s.customer_phone IS NOT NULL AND TRIM(s.customer_phone) != ''
        AND date(s.created_at, 'localtime') BETWEEN date(?) AND date(?)
      GROUP BY s.customer_phone, s.customer_name
      UNION ALL
      SELECT NULL AS id, COALESCE(o.customer_name, 'Online customer') AS name, o.customer_phone AS phone, o.customer_email AS email,
        0 AS pos_spent, COALESCE(SUM(o.total), 0) AS online_spent,
        COALESCE(SUM(o.total), 0) AS total_spent, COUNT(o.id) AS visits
      FROM online_orders_local o
      WHERE o.status NOT IN ('cancelled', 'rejected')
        AND (o.sale_id IS NULL OR o.sale_id = 0)
        AND date(o.created_at, 'localtime') BETWEEN date(?) AND date(?)
        AND o.customer_phone IS NOT NULL AND TRIM(o.customer_phone) != ''
      GROUP BY o.customer_phone, o.customer_name, o.customer_email
    ) combined
    GROUP BY COALESCE(id, phone), name, phone, email
    HAVING total_spent > 0
    ORDER BY total_spent DESC
    LIMIT ?
  `).all(rangeFrom, rangeTo, rangeFrom, rangeTo, rangeFrom, rangeTo, lim);
  return rows.map((r, i) => ({
    ...r,
    rank: i + 1,
    pos_spent: Math.round((Number(r.pos_spent) || 0) * 100) / 100,
    online_spent: Math.round((Number(r.online_spent) || 0) * 100) / 100,
    total_spent: Math.round((Number(r.total_spent) || 0) * 100) / 100
  }));
}

module.exports = {
  getSalesList, getUnifiedSalesList, getPendingOnlineOrdersForSales, searchSalesExplorer, voidSale,
  getSoldProductsReport, getLowPerformanceProducts,
  getReturnDetail, getReturnsList, getReturnReasonsReport, reopenReturn, verifyManagerPin,
  getPriceChangeHistory, logPriceChange,
  getActivityTimeline, getExceptionReport, getAdminAlerts,
  getAdminDashboardFull, getDailyClosingReport, getCustomerPurchaseSummary, getTopCustomers
};
