const { getDb } = require('../database/db');

function getBranches() {
  return getDb().prepare('SELECT * FROM branches ORDER BY name').all();
}

function getBranch(id) {
  return getDb().prepare('SELECT * FROM branches WHERE id = ?').get(id);
}

function getBranchByCode(code) {
  return getDb().prepare('SELECT * FROM branches WHERE code = ?').get(String(code).toUpperCase());
}

function saveBranch(data) {
  const db = getDb();
  if (data.id) {
    db.prepare('UPDATE branches SET name=?, code=?, address=?, phone=?, is_active=? WHERE id=?')
      .run(data.name, String(data.code).toUpperCase(), data.address || null, data.phone || null, data.is_active !== false && data.is_active !== 0 ? 1 : 0, data.id);
    return getBranchDetail(data.id);
  }
  const r = db.prepare('INSERT INTO branches (name, code, address, phone) VALUES (?, ?, ?, ?)')
    .run(data.name, String(data.code).toUpperCase(), data.address || null, data.phone || null);
  const id = r.lastInsertRowid;
  try {
    const shop = db.prepare('SELECT tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number FROM shop_settings WHERE id = 1').get() || {};
    db.prepare(`
      INSERT OR IGNORE INTO branch_settings (branch_id, tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, shop.tax_enabled ? 1 : 0, Number(shop.tax_rate) || 0, shop.tax_inclusive !== 0 ? 1 : 0, shop.tax_show_on_pos !== 0 ? 1 : 0, shop.vat_number || null);
  } catch (_) { /* ignore */ }
  return getBranchDetail(id);
}

function setActiveBranch(branchId) {
  const id = Number(branchId);
  if (!getBranch(id)) throw new Error('Branch not found');
  getDb().prepare('UPDATE shop_settings SET branch_id = ? WHERE id = 1').run(id);
  return getBranchDetail(id);
}

function getActiveBranch() {
  const settings = getDb().prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get();
  const id = settings?.branch_id || 1;
  return getBranchDetail(id) || { id: 1, name: 'Main Branch', code: 'MAIN' };
}

function setViewBranch(branchId) {
  const db = getDb();
  try {
    db.exec('ALTER TABLE shop_settings ADD COLUMN view_branch_id INTEGER');
  } catch (_) { /* exists */ }
  const v = branchId == null || branchId === '' || branchId === 'all' ? null : Number(branchId);
  if (v != null && !getBranch(v)) throw new Error('Branch not found');
  db.prepare('UPDATE shop_settings SET view_branch_id = ? WHERE id = 1').run(v);
  return { view_branch_id: v, branch: v ? getBranchDetail(v) : null };
}

function getViewBranch() {
  const db = getDb();
  let row;
  try {
    row = db.prepare('SELECT branch_id, view_branch_id FROM shop_settings WHERE id = 1').get();
  } catch (_) {
    row = db.prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get();
  }
  const viewId = row?.view_branch_id != null ? Number(row.view_branch_id) : null;
  return {
    till_branch_id: row?.branch_id || 1,
    view_branch_id: viewId,
    view_all: viewId == null,
    branch: viewId ? getBranchDetail(viewId) : null,
    till_branch: getBranchDetail(row?.branch_id || 1)
  };
}

function resolveBranchScope(actor = null, opts = {}) {
  const db = getDb();
  const tillId = (() => {
    try {
      return db.prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get()?.branch_id || 1;
    } catch (_) {
      return 1;
    }
  })();

  let viewId = null;
  try {
    viewId = db.prepare('SELECT view_branch_id FROM shop_settings WHERE id = 1').get()?.view_branch_id;
    if (viewId != null) viewId = Number(viewId);
  } catch (_) {
    viewId = null;
  }

  const user = actor?.id
    ? db.prepare('SELECT id, role, branch_id FROM users WHERE id = ?').get(actor.id)
    : null;
  const role = user?.role || actor?.role || null;

  if (role === 'marketing_agent') {
    return { branchId: null, allBranches: true, tillId, role, stampId: tillId };
  }

  if (role === 'owner' || !role) {
    if (opts.forceTill) {
      return { branchId: tillId, allBranches: false, tillId, role: role || 'owner', stampId: tillId };
    }
    if (opts.branchId != null && opts.branchId !== '' && opts.branchId !== 'all') {
      return { branchId: Number(opts.branchId), allBranches: false, tillId, role: role || 'owner', stampId: Number(opts.branchId) };
    }
    if (viewId != null) {
      return { branchId: viewId, allBranches: false, tillId, role: role || 'owner', stampId: tillId };
    }
    return { branchId: null, allBranches: true, tillId, role: role || 'owner', stampId: tillId };
  }

  const bound = user?.branch_id != null ? Number(user.branch_id) : tillId;
  return { branchId: bound, allBranches: false, tillId, role, stampId: bound };
}

function getBranchStaffSummary(branchId) {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, username, full_name, role, is_active, branch_id
    FROM users WHERE is_active = 1 AND branch_id = ?
    ORDER BY
      CASE role WHEN 'manager' THEN 1 WHEN 'supervisor' THEN 2 WHEN 'cashier' THEN 3 ELSE 4 END,
      full_name
  `).all(branchId);
  const managers = users.filter((u) => u.role === 'manager');
  const supervisors = users.filter((u) => u.role === 'supervisor');
  const cashiers = users.filter((u) => u.role === 'cashier');
  const others = users.filter((u) => !['manager', 'supervisor', 'cashier'].includes(u.role));
  return { managers, supervisors, cashiers, others, users };
}

function getBranchDetail(id) {
  const b = getBranch(id);
  if (!b) return null;
  const staff = getBranchStaffSummary(id);
  let settings = null;
  try {
    settings = getDb().prepare('SELECT * FROM branch_settings WHERE branch_id = ?').get(id) || null;
  } catch (_) { /* ignore */ }
  let stockSku = 0;
  try {
    stockSku = getDb().prepare('SELECT COUNT(*) as c FROM branch_stock WHERE branch_id = ? AND quantity > 0').get(id)?.c || 0;
  } catch (_) { /* ignore */ }
  let salesToday = 0;
  try {
    salesToday = getDb().prepare(`
      SELECT COALESCE(SUM(total),0) as v FROM sales
      WHERE branch_id = ? AND status='completed' AND date(created_at,'localtime') = date('now','localtime')
    `).get(id)?.v || 0;
  } catch (_) { /* ignore */ }
  return {
    ...b,
    staff,
    settings,
    stock_skus: stockSku,
    sales_today: salesToday,
    manager: staff.managers[0] || null,
    supervisor: staff.supervisors[0] || null,
    cashier_count: staff.cashiers.length
  };
}

function getBranchesDetailed() {
  return getBranches().map((b) => getBranchDetail(b.id));
}

function saveBranchSettings(branchId, data) {
  const id = Number(branchId);
  if (!getBranch(id)) throw new Error('Branch not found');
  const db = getDb();
  const existing = db.prepare('SELECT branch_id FROM branch_settings WHERE branch_id = ?').get(id);
  const patch = {
    tax_enabled: data.tax_enabled ? 1 : 0,
    tax_rate: Number(data.tax_rate) || 0,
    tax_inclusive: data.tax_inclusive !== false && data.tax_inclusive !== 0 ? 1 : 0,
    tax_show_on_pos: data.tax_show_on_pos !== false && data.tax_show_on_pos !== 0 ? 1 : 0,
    vat_number: data.vat_number || null
  };
  if (existing) {
    db.prepare(`
      UPDATE branch_settings SET tax_enabled=?, tax_rate=?, tax_inclusive=?, tax_show_on_pos=?, vat_number=?, updated_at=datetime('now')
      WHERE branch_id=?
    `).run(patch.tax_enabled, patch.tax_rate, patch.tax_inclusive, patch.tax_show_on_pos, patch.vat_number, id);
  } else {
    db.prepare(`
      INSERT INTO branch_settings (branch_id, tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, patch.tax_enabled, patch.tax_rate, patch.tax_inclusive, patch.tax_show_on_pos, patch.vat_number);
  }
  return getBranchDetail(id);
}

function ensureBranchStockRow(productId, branchId) {
  const db = getDb();
  const pid = Number(productId);
  const bid = Number(branchId) || 1;
  let row = null;
  try {
    row = db.prepare('SELECT * FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(pid, bid);
  } catch (_) {
    return { product_id: pid, branch_id: bid, quantity: 0, min_stock: 0 };
  }
  if (row) return row;
  const product = db.prepare('SELECT stock_quantity, min_stock FROM products WHERE id = ?').get(pid);
  const qty = Number(product?.stock_quantity) || 0;
  const min = Number(product?.min_stock) || 0;
  try {
    db.prepare(`
      INSERT INTO branch_stock (product_id, branch_id, quantity, min_stock) VALUES (?, ?, ?, ?)
    `).run(pid, bid, qty, min);
  } catch (_) { /* race */ }
  return db.prepare('SELECT * FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(pid, bid)
    || { product_id: pid, branch_id: bid, quantity: qty, min_stock: min };
}

function getBranchStockQuantity(productId, branchId) {
  const row = ensureBranchStockRow(productId, branchId);
  return Number(row?.quantity) || 0;
}

function adjustBranchStock(productId, quantity, type, notes, userId, refType, refId, branchId) {
  const db = getDb();
  const bid = Number(branchId) || resolveBranchScope(null, { forceTill: true }).stampId;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');
  const row = ensureBranchStockRow(productId, bid);
  const prev = Number(row.quantity) || 0;
  let newStock;
  let moveQty = Math.abs(Number(quantity) || 0);
  if (type === 'set') {
    newStock = Number(quantity) || 0;
    moveQty = Math.abs(newStock - prev);
  } else if (type === 'remove' || type === 'sale') {
    newStock = prev - (Number(quantity) || 0);
  } else {
    newStock = prev + (Number(quantity) || 0);
  }
  db.prepare(`
    UPDATE branch_stock SET quantity = ?, updated_at = datetime('now') WHERE product_id = ? AND branch_id = ?
  `).run(newStock, productId, bid);
  try {
    const sum = db.prepare('SELECT COALESCE(SUM(quantity),0) as v FROM branch_stock WHERE product_id = ?').get(productId)?.v || 0;
    db.prepare(`UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(sum, productId);
  } catch (_) {
    db.prepare(`UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(newStock, productId);
  }
  try {
    db.prepare(`
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes, user_id, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(productId, type === 'set' ? 'adjust' : type, moveQty, prev, newStock, refType, refId, notes, userId, bid);
  } catch (_) {
    db.prepare(`
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(productId, type === 'set' ? 'adjust' : type, moveQty, prev, newStock, refType, refId, notes, userId);
  }
  return newStock;
}

function assertBranchRoleSlot(role, branchId, excludeUserId = null) {
  if (!branchId) return;
  if (role !== 'manager' && role !== 'supervisor') return;
  const db = getDb();
  let sql = `SELECT COUNT(*) as c FROM users WHERE role = ? AND is_active = 1 AND branch_id = ?`;
  const params = [role, branchId];
  if (excludeUserId) {
    sql += ' AND id != ?';
    params.push(excludeUserId);
  }
  const c = db.prepare(sql).get(...params)?.c || 0;
  if (c >= 1) {
    throw new Error(`This branch already has a ${role}. Only one is allowed per branch.`);
  }
}

module.exports = {
  getBranches,
  getBranch,
  getBranchByCode,
  saveBranch,
  setActiveBranch,
  getActiveBranch,
  setViewBranch,
  getViewBranch,
  resolveBranchScope,
  getBranchStaffSummary,
  getBranchDetail,
  getBranchesDetailed,
  saveBranchSettings,
  ensureBranchStockRow,
  getBranchStockQuantity,
  adjustBranchStock,
  assertBranchRoleSlot
};
