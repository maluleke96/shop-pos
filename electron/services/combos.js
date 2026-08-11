const { getDb } = require('../database/db');
const { buildExcelBuffer, buildPdfBuffer } = require('./export');
const inventory = require('./inventory');

function audit(actorId, actorName, action, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, 'combo', entityId || null, details ? JSON.stringify(details) : null);
}

function requireRole(actor, roles) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, roles);
}

function nextComboCode() {
  const count = getDb().prepare('SELECT COUNT(*) AS c FROM combos').get().c || 0;
  return `COMBO-${String(count + 1).padStart(5, '0')}`;
}

function calcComboPrices(items, pricingType, discountValue) {
  const db = getDb();
  let normal = 0;
  let cost = 0;
  for (const item of items) {
    const p = db.prepare('SELECT selling_price, buying_price FROM products WHERE id = ?').get(item.product_id);
    if (!p) continue;
    const qty = Number(item.quantity) || 1;
    normal += (Number(p.selling_price) || 0) * qty;
    cost += (Number(p.buying_price) || 0) * qty;
  }
  let finalPrice = normal;
  if (pricingType === 'percent') {
    finalPrice = normal * (1 - (Number(discountValue) || 0) / 100);
  } else if (pricingType === 'fixed_discount') {
    finalPrice = Math.max(0, normal - (Number(discountValue) || 0));
  } else if (pricingType === 'fixed') {
    finalPrice = Number(discountValue) || normal;
  }
  return { normal_price: Math.round(normal * 100) / 100, final_price: Math.round(finalPrice * 100) / 100, cost };
}

function comboWithItems(row) {
  if (!row) return null;
  const items = getDb().prepare(`
    SELECT ci.*, p.name AS product_name, p.selling_price, p.stock_quantity, p.picture_path
    FROM combo_items ci JOIN products p ON p.id = ci.product_id WHERE ci.combo_id = ?`).all(row.id);
  return { ...row, items };
}

function isComboActive(combo) {
  if (combo.status !== 'active') return false;
  const today = new Date().toLocaleDateString('en-CA');
  if (combo.start_date && combo.start_date > today) return false;
  if (combo.end_date && combo.end_date < today) return false;
  if (combo.valid_time_start && combo.valid_time_end) {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const start = combo.valid_time_start;
    const end = combo.valid_time_end;
    if (start <= end) {
      if (hhmm < start || hhmm > end) return false;
    } else if (hhmm < start && hhmm > end) {
      return false;
    }
  }
  if (combo.max_uses) {
    const used = getDb().prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM combo_sale_log WHERE combo_id = ?').get(combo.id).q;
    if (used >= combo.max_uses) return false;
  }
  return true;
}

function getCombos(filters = {}, actor) {
  const db = getDb();
  let sql = 'SELECT * FROM combos WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.approval_status) { sql += ' AND COALESCE(approval_status, \'approved\') = ?'; params.push(filters.approval_status); }
  if (filters.branch_id) { sql += ' AND (branch_id IS NULL OR branch_id = ?)'; params.push(filters.branch_id); }
  if (filters.active_only) {
    sql += ' AND status = ? AND COALESCE(approval_status, \'approved\') = ?';
    params.push('active', 'approved');
  }
  sql += ' ORDER BY created_at DESC';
  let rows = db.prepare(sql).all(...params).map(comboWithItems);
  if (filters.active_only) rows = rows.filter(isComboActive);
  return rows;
}

function getCombo(id) {
  return comboWithItems(getDb().prepare('SELECT * FROM combos WHERE id = ?').get(id));
}

function saveCombo(data, actor) {
  requireRole(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const db = getDb();
  const items = data.items || [];
  const prices = calcComboPrices(items, data.pricing_type || 'fixed', data.discount_value ?? data.final_price);
  const isOwner = actor?.role === 'owner';
  const approvalStatus = isOwner
    ? (data.approval_status || 'approved')
    : (data.approval_status === 'approved' && isOwner ? 'approved' : 'pending');
  const status = isOwner ? (data.status || 'draft') : 'draft';
  const payload = {
    name: data.name, description: data.description || null, image_path: data.image_path || null,
    category: data.category || null, branch_id: data.branch_id || null,
    start_date: data.start_date || null, end_date: data.end_date || null,
    status, pricing_type: data.pricing_type || 'fixed',
    normal_price: prices.normal_price, discount_value: Number(data.discount_value) || 0,
    final_price: data.pricing_type === 'fixed' && data.final_price != null ? Number(data.final_price) : prices.final_price,
    max_uses: data.max_uses || null, promo_type: data.promo_type || null,
    valid_time_start: data.valid_time_start || null, valid_time_end: data.valid_time_end || null,
    approval_status: approvalStatus
  };
  if (data.id) {
    const existing = getCombo(data.id);
    const keepApproval = isOwner ? payload.approval_status : (existing?.approval_status === 'approved' ? 'pending' : (existing?.approval_status || 'pending'));
    try {
      db.prepare(`
        UPDATE combos SET name=?, description=?, image_path=?, category=?, branch_id=?, start_date=?, end_date=?,
          status=?, pricing_type=?, normal_price=?, discount_value=?, final_price=?, max_uses=?, promo_type=?,
          valid_time_start=?, valid_time_end=?, approval_status=?, submitted_by=?, submitted_at=datetime('now') WHERE id=?`).run(
        payload.name, payload.description, payload.image_path, payload.category, payload.branch_id,
        payload.start_date, payload.end_date, isOwner ? payload.status : existing?.status || 'draft',
        payload.pricing_type, payload.normal_price,
        payload.discount_value, payload.final_price, payload.max_uses, payload.promo_type,
        payload.valid_time_start, payload.valid_time_end, keepApproval, actor?.id, data.id
      );
    } catch (_) {
      db.prepare(`
        UPDATE combos SET name=?, description=?, image_path=?, category=?, branch_id=?, start_date=?, end_date=?,
          status=?, pricing_type=?, normal_price=?, discount_value=?, final_price=?, max_uses=?, promo_type=?,
          valid_time_start=?, valid_time_end=? WHERE id=?`).run(
        payload.name, payload.description, payload.image_path, payload.category, payload.branch_id,
        payload.start_date, payload.end_date, payload.status, payload.pricing_type, payload.normal_price,
        payload.discount_value, payload.final_price, payload.max_uses, payload.promo_type,
        payload.valid_time_start, payload.valid_time_end, data.id
      );
    }
    db.prepare('DELETE FROM combo_items WHERE combo_id = ?').run(data.id);
    items.forEach(item => {
      db.prepare('INSERT INTO combo_items (combo_id, product_id, quantity) VALUES (?,?,?)').run(
        data.id, item.product_id, Number(item.quantity) || 1
      );
    });
    audit(actor?.id, actor?.username, 'update_combo', data.id, { name: payload.name, approval_status: keepApproval });
    return getCombo(data.id);
  }
  const code = nextComboCode();
  let comboId;
  try {
    const r = db.prepare(`
      INSERT INTO combos (combo_code, name, description, image_path, category, branch_id, start_date, end_date,
        status, pricing_type, normal_price, discount_value, final_price, max_uses, promo_type,
        valid_time_start, valid_time_end, created_by, approval_status, submitted_by, submitted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      code, payload.name, payload.description, payload.image_path, payload.category, payload.branch_id,
      payload.start_date, payload.end_date, payload.status, payload.pricing_type, payload.normal_price,
      payload.discount_value, payload.final_price, payload.max_uses, payload.promo_type,
      payload.valid_time_start, payload.valid_time_end, actor?.id, payload.approval_status, actor?.id
    );
    comboId = r.lastInsertRowid;
  } catch (_) {
    const r = db.prepare(`
      INSERT INTO combos (combo_code, name, description, image_path, category, branch_id, start_date, end_date,
        status, pricing_type, normal_price, discount_value, final_price, max_uses, promo_type,
        valid_time_start, valid_time_end, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code, payload.name, payload.description, payload.image_path, payload.category, payload.branch_id,
      payload.start_date, payload.end_date, payload.status, payload.pricing_type, payload.normal_price,
      payload.discount_value, payload.final_price, payload.max_uses, payload.promo_type,
      payload.valid_time_start, payload.valid_time_end, actor?.id
    );
    comboId = r.lastInsertRowid;
  }
  items.forEach(item => {
    db.prepare('INSERT INTO combo_items (combo_id, product_id, quantity) VALUES (?,?,?)').run(
      comboId, item.product_id, Number(item.quantity) || 1
    );
  });
  audit(actor?.id, actor?.username, 'create_combo', comboId, { combo_code: code, approval_status: payload.approval_status });
  return getCombo(comboId);
}

function approveCombo(id, actor) {
  requireRole(actor, ['owner']);
  const db = getDb();
  try {
    db.prepare(`UPDATE combos SET approval_status='approved', approved_by=?, approved_at=datetime('now'),
      status='active', rejection_notes=NULL WHERE id=?`).run(actor?.id, id);
  } catch (_) {
    db.prepare('UPDATE combos SET status = ? WHERE id = ?').run('active', id);
  }
  audit(actor?.id, actor?.username, 'approve_combo', id, null);
  return getCombo(id);
}

function rejectCombo(id, notes, actor) {
  requireRole(actor, ['owner']);
  const db = getDb();
  try {
    db.prepare(`UPDATE combos SET approval_status='rejected', approved_by=?, approved_at=datetime('now'),
      status='draft', rejection_notes=? WHERE id=?`).run(actor?.id, notes || null, id);
  } catch (_) {
    db.prepare('UPDATE combos SET status = ? WHERE id = ?').run('draft', id);
  }
  audit(actor?.id, actor?.username, 'reject_combo', id, { notes });
  return getCombo(id);
}

function setComboStatus(id, status, actor) {
  requireRole(actor, ['owner', 'manager']);
  const combo = getCombo(id);
  if (status === 'active' && (combo?.approval_status || 'approved') !== 'approved' && actor?.role !== 'owner') {
    throw new Error('Combo must be approved by admin before it can go live on POS');
  }
  if (status === 'active' && actor?.role === 'owner') {
    try {
      getDb().prepare(`UPDATE combos SET status = ?, approval_status='approved', approved_by=?, approved_at=datetime('now') WHERE id = ?`)
        .run(status, actor?.id, id);
    } catch (_) {
      getDb().prepare('UPDATE combos SET status = ? WHERE id = ?').run(status, id);
    }
  } else {
    getDb().prepare('UPDATE combos SET status = ? WHERE id = ?').run(status, id);
  }
  audit(actor?.id, actor?.username, status === 'active' ? 'activate_combo' : 'deactivate_combo', id, { status });
  return getCombo(id);
}

function deleteCombo(id, actor) {
  requireRole(actor, ['owner', 'manager']);
  getDb().prepare('DELETE FROM combo_items WHERE combo_id = ?').run(id);
  getDb().prepare('DELETE FROM combos WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_combo', id, null);
  return true;
}

function processComboSale(comboId, quantity, saleId, saleItemId, adjustStockFn, actorId, receiptNumber) {
  const combo = getCombo(comboId);
  if (!combo) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO combo_sale_log (combo_id, sale_id, sale_item_id, quantity, unit_price, total)
    VALUES (?,?,?,?,?,?)`).run(
    comboId, saleId, saleItemId, quantity, combo.final_price,
    (Number(combo.final_price) || 0) * quantity
  );
  for (const item of combo.items || []) {
    const qty = (Number(item.quantity) || 1) * quantity;
    const note = `Combo ${combo.name} — Sale ${receiptNumber}`;
    const recipeDeducted = inventory.deductRecipeIngredients(
      item.product_id, qty, note, actorId, 'sale', saleId, adjustStockFn
    );
    if (!recipeDeducted) {
      adjustStockFn(item.product_id, qty, 'sale', note, actorId, 'sale', saleId);
    }
    db.prepare('UPDATE products SET last_sale_date = date(\'now\') WHERE id = ?').run(item.product_id);
  }
}

function restoreComboSale(comboId, quantity, note, actorId, refType, refId, adjustStockFn) {
  const combo = getCombo(comboId);
  if (!combo) return false;
  for (const item of combo.items || []) {
    const qty = (Number(item.quantity) || 1) * (Number(quantity) || 1);
    const recipeRestored = inventory.restoreRecipeIngredients(
      item.product_id, qty, note, actorId, refType, refId, adjustStockFn
    );
    if (!recipeRestored) {
      adjustStockFn(item.product_id, qty, 'return', note, actorId, refType, refId);
    }
  }
  return true;
}

function getComboReports(filters = {}) {
  const db = getDb();
  const from = filters.from || new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA');
  const to = filters.to || new Date().toLocaleDateString('en-CA');
  const rows = db.prepare(`
    SELECT c.id, c.combo_code, c.name, c.final_price, c.normal_price,
      COALESCE(SUM(l.quantity), 0) AS sold_count,
      COALESCE(SUM(l.total), 0) AS revenue
    FROM combos c
    LEFT JOIN combo_sale_log l ON l.combo_id = c.id AND date(l.created_at) BETWEEN date(?) AND date(?)
    GROUP BY c.id ORDER BY sold_count DESC`).all(from, to);

  const enriched = rows.map(r => {
    const combo = getCombo(r.id);
    let cost = 0;
    (combo?.items || []).forEach(i => {
      const p = db.prepare('SELECT buying_price FROM products WHERE id = ?').get(i.product_id);
      cost += (Number(p?.buying_price) || 0) * (Number(i.quantity) || 1);
    });
    const profit = (Number(r.revenue) || 0) - cost * (Number(r.sold_count) || 0);
    return { ...r, unit_cost: cost, profit: Math.round(profit * 100) / 100 };
  });
  return { from, to, combos: enriched, totals: {
    sold: enriched.reduce((s, r) => s + r.sold_count, 0),
    revenue: enriched.reduce((s, r) => s + (Number(r.revenue) || 0), 0),
    profit: enriched.reduce((s, r) => s + (Number(r.profit) || 0), 0)
  }};
}

function buildComboReportPdf(filters, shopName, currency) {
  const report = getComboReports(filters);
  const headers = ['Code', 'Name', 'Sold', 'Revenue', 'Profit'];
  const rows = report.combos.map(r => [
    r.combo_code, r.name, String(r.sold_count),
    `${currency}${Number(r.revenue).toFixed(2)}`, `${currency}${Number(r.profit).toFixed(2)}`
  ]);
  return buildPdfBuffer('Combo Sales Report', headers, rows, {
    shop_name: shopName, dateRange: `${report.from} to ${report.to}`
  });
}

function buildComboReportExcel(filters) {
  const report = getComboReports(filters);
  return buildExcelBuffer([{
    name: 'Combos',
    data: report.combos.map(r => ({
      Code: r.combo_code, Name: r.name, Sold: r.sold_count,
      Revenue: r.revenue, Profit: r.profit
    }))
  }]);
}

module.exports = {
  getCombos, getCombo, saveCombo, setComboStatus, deleteCombo, approveCombo, rejectCombo, calcComboPrices,
  isComboActive, processComboSale, restoreComboSale, getComboReports, buildComboReportPdf, buildComboReportExcel
};
