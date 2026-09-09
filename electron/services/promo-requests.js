const { getDb } = require('../database/db');
const adminOverride = require('./admin-override');

const PROPOSER_ROLES = ['owner', 'manager', 'assistant_manager'];
const ADMIN_ROLES = ['owner'];

function audit(actorId, actorName, action, entityId, details) {
  getDb().prepare(`
    INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
    VALUES (?,?,?,?,?,?)`).run(
    actorId || null, actorName || 'system', action, 'product_promo_request', entityId || null,
    details ? JSON.stringify(details) : null
  );
}

function addNotification(type, title, message, opts = {}) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM notifications WHERE type = ? AND message = ? AND is_read = 0 AND date(created_at) = date(\'now\')'
  ).get(type, message);
  if (!existing) {
    db.prepare(`
      INSERT INTO notifications (type, title, message, entity_type, entity_id, action_page)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      type, title, message,
      opts.entity_type || 'product_promo_request',
      opts.entity_id || null,
      opts.action_page || 'admin:opscompliance'
    );
  }
}

function requireRole(actor, roles) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, roles);
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function resolveStatusForDates(startDate, endDate, baseStatus) {
  const todayStr = today();
  if (baseStatus === 'rejected' || baseStatus === 'expired') return baseStatus;
  if (endDate < todayStr) return 'expired';
  if (baseStatus === 'pending') return 'pending';
  if (startDate <= todayStr && endDate >= todayStr) return 'active';
  if (baseStatus === 'approved' || baseStatus === 'active') return startDate > todayStr ? 'approved' : 'active';
  return baseStatus;
}

let _lastPromoSyncAt = 0;
function syncPromoStatuses() {
  // Throttle status sync — called on every products:get otherwise.
  if (Date.now() - _lastPromoSyncAt < 60 * 1000) return;
  const db = getDb();
  const todayStr = today();
  db.prepare(`
    UPDATE product_promo_requests SET status = 'active', updated_at = datetime('now')
    WHERE status = 'approved' AND date(?) BETWEEN date(start_date) AND date(end_date)
  `).run(todayStr);
  db.prepare(`
    UPDATE product_promo_requests SET status = 'expired', updated_at = datetime('now')
    WHERE status IN ('active', 'approved', 'pending') AND date(end_date) < date(?)
  `).run(todayStr);
  _lastPromoSyncAt = Date.now();
}

function mapRequestRow(row) {
  if (!row) return null;
  return {
    ...row,
    display_status: resolveStatusForDates(row.start_date, row.end_date, row.status)
  };
}

function getPromoRequest(id) {
  const row = getDb().prepare(`
    SELECT pr.*, p.name AS product_name, p.sku, p.barcode, p.picture_path,
      u1.full_name AS proposed_by_name, u2.full_name AS approved_by_name
    FROM product_promo_requests pr
    JOIN products p ON p.id = pr.product_id
    LEFT JOIN users u1 ON u1.id = pr.proposed_by
    LEFT JOIN users u2 ON u2.id = pr.approved_by
    WHERE pr.id = ?
  `).get(id);
  return mapRequestRow(row);
}

function getLatestPromoForProduct(productId) {
  const row = getDb().prepare(`
    SELECT * FROM product_promo_requests
    WHERE product_id = ? AND status IN ('pending', 'approved', 'active')
    ORDER BY created_at DESC LIMIT 1
  `).get(productId);
  return mapRequestRow(row);
}

function attachPromoStatus(product) {
  const latest = getLatestPromoForProduct(product.id);
  return {
    ...product,
    promo_request: latest,
    promo_request_status: latest?.display_status || latest?.status || null,
    promo_proposed_price: latest?.proposed_price ?? null
  };
}

function getActivePromosMap() {
  syncPromoStatuses();
  const todayStr = today();
  const rows = getDb().prepare(`
    SELECT * FROM product_promo_requests
    WHERE status = 'active' AND date(?) BETWEEN date(start_date) AND date(end_date)
  `).all(todayStr);
  const map = {};
  for (const row of rows) map[row.product_id] = row;
  return map;
}

function applyPromoPricesToProducts(products, preloadedMap) {
  const promos = preloadedMap || (() => {
    syncPromoStatuses();
    return getActivePromosMap();
  })();
  return products.map(p => {
    const promo = promos[p.id];
    if (!promo) return p;
    const original = Number(promo.original_price) || Number(p.selling_price);
    const promoPrice = Number(promo.proposed_price);
    return {
      ...p,
      selling_price: promoPrice,
      original_price: original,
      promo_active: true,
      promo_request_id: promo.id,
      promo_end_date: promo.end_date
    };
  });
}

function proposeProductPromo(productId, data, actor) {
  requireRole(actor, PROPOSER_ROLES);
  const db = getDb();
  const product = db.prepare('SELECT id, name, selling_price, buying_price, is_active FROM products WHERE id = ?').get(productId);
  if (!product || !product.is_active) throw new Error('Product not found or inactive');

  const proposedPrice = Number(data.proposed_price);
  const startDate = String(data.start_date || '').trim();
  const endDate = String(data.end_date || '').trim();
  const notes = data.notes?.trim() || null;

  if (!proposedPrice || proposedPrice <= 0) throw new Error('Proposed sale price must be greater than 0');
  const cost = Math.max(0, Number(product.buying_price) || 0);
  const targetProfit = Math.max(0, Number(data.target_profit_pct) || 40);
  if (cost > 0 && proposedPrice < cost && !data.force_below_cost) {
    throw new Error(`Sale price cannot go below cost (${cost}). Reduce discount or enable force override.`);
  }
  const margin = proposedPrice > 0 ? Math.round(((proposedPrice - cost) / proposedPrice) * 10000) / 100 : 0;
  if (cost > 0 && margin + 0.01 < targetProfit && !data.force_below_profit) {
    const suggested = Math.round((cost / (1 - Math.min(targetProfit, 95) / 100)) * 100) / 100;
    return {
      needs_confirm: true,
      error: `Price is below ${targetProfit}% profit (margin ${margin}%). Suggested: ${suggested}`,
      suggested_price: suggested,
      cost,
      margin
    };
  }
  if (!startDate || !endDate) throw new Error('Start date and end date are required');
  if (endDate < startDate) throw new Error('End date must be on or after start date');
  if (endDate < today()) throw new Error('End date cannot be in the past');

  const existing = db.prepare(`
    SELECT id FROM product_promo_requests
    WHERE product_id = ? AND status IN ('pending', 'approved', 'active')
  `).get(productId);
  if (existing) throw new Error('This product already has a pending or active promo request');

  const originalPrice = Number(product.selling_price) || 0;
  const r = db.prepare(`
    INSERT INTO product_promo_requests
      (product_id, proposed_price, original_price, start_date, end_date, status, proposed_by, notes)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(productId, proposedPrice, originalPrice, startDate, endDate, actor?.id || null, notes);

  const requestId = r.lastInsertRowid;
  audit(actor?.id, actor?.username, 'propose_product_promo', requestId, {
    product_id: productId, product_name: product.name, proposed_price: proposedPrice,
    original_price: originalPrice, start_date: startDate, end_date: endDate, notes
  });

  addNotification(
    'promo_approval_pending',
    'Promo Approval Needed',
    `${actor?.full_name || actor?.username || 'Manager'} proposed promo for "${product.name}" at ${proposedPrice} (${startDate} to ${endDate})`,
    { entity_id: requestId, action_page: 'admin:combos:promos' }
  );

  db.prepare('UPDATE products SET promo_flag = 1, promo_notes = ? WHERE id = ?').run(
    `Promo proposed: ${proposedPrice} (${startDate} to ${endDate})`, productId
  );

  if (ADMIN_ROLES.includes(actor?.role)) {
    return approvePromoRequest(requestId, actor);
  }
  return getPromoRequest(requestId);
}

function getPendingPromoRequests() {
  syncPromoStatuses();
  return getDb().prepare(`
    SELECT pr.*, p.name AS product_name, p.sku, p.barcode, p.stock_quantity,
      u1.full_name AS proposed_by_name
    FROM product_promo_requests pr
    JOIN products p ON p.id = pr.product_id
    LEFT JOIN users u1 ON u1.id = pr.proposed_by
    WHERE pr.status = 'pending'
    ORDER BY pr.created_at ASC
  `).all().map(mapRequestRow);
}

function getPromoRequestHistory(filters = {}) {
  syncPromoStatuses();
  let sql = `
    SELECT pr.*, p.name AS product_name, p.sku, p.barcode,
      u1.full_name AS proposed_by_name, u2.full_name AS approved_by_name
    FROM product_promo_requests pr
    JOIN products p ON p.id = pr.product_id
    LEFT JOIN users u1 ON u1.id = pr.proposed_by
    LEFT JOIN users u2 ON u2.id = pr.approved_by
    WHERE 1=1
  `;
  const params = [];
  if (filters.status) { sql += ' AND pr.status = ?'; params.push(filters.status); }
  if (filters.product_id) { sql += ' AND pr.product_id = ?'; params.push(filters.product_id); }
  sql += ' ORDER BY pr.created_at DESC LIMIT 200';
  return getDb().prepare(sql).all(...params).map(mapRequestRow);
}

function approvePromoRequest(id, actor) {
  requireRole(actor, ADMIN_ROLES);
  const db = getDb();
  const req = db.prepare('SELECT * FROM product_promo_requests WHERE id = ?').get(id);
  if (!req) throw new Error('Promo request not found');
  if (req.status !== 'pending') throw new Error('Only pending requests can be approved');

  const todayStr = today();
  if (req.end_date < todayStr) throw new Error('Cannot approve — promo end date has passed');

  const newStatus = req.start_date <= todayStr && req.end_date >= todayStr ? 'active' : 'approved';
  db.prepare(`
    UPDATE product_promo_requests
    SET status = ?, approved_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, actor?.id || null, id);

  const product = db.prepare('SELECT name FROM products WHERE id = ?').get(req.product_id);
  audit(actor?.id, actor?.username, 'approve_product_promo', id, {
    product_id: req.product_id, status: newStatus, proposed_price: req.proposed_price
  });

  if (req.proposed_by) {
    addNotification(
      'promo_approved',
      'Promo Approved',
      `Your promo for "${product?.name || 'product'}" was approved (${req.start_date} to ${req.end_date})`,
      { entity_id: id, action_page: 'operations:non-selling' }
    );
  }

  return getPromoRequest(id);
}

function rejectPromoRequest(id, notes, actor) {
  requireRole(actor, ADMIN_ROLES);
  const db = getDb();
  const req = db.prepare('SELECT * FROM product_promo_requests WHERE id = ?').get(id);
  if (!req) throw new Error('Promo request not found');
  if (req.status !== 'pending') throw new Error('Only pending requests can be rejected');

  const rejectionNotes = notes?.trim() || null;
  db.prepare(`
    UPDATE product_promo_requests
    SET status = 'rejected', approved_by = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
    WHERE id = ?
  `).run(actor?.id || null, rejectionNotes, id);

  const product = db.prepare('SELECT name FROM products WHERE id = ?').get(req.product_id);
  audit(actor?.id, actor?.username, 'reject_product_promo', id, {
    product_id: req.product_id, notes: rejectionNotes
  });

  if (req.proposed_by) {
    addNotification(
      'promo_rejected',
      'Promo Rejected',
      `Your promo for "${product?.name || 'product'}" was rejected${rejectionNotes ? `: ${rejectionNotes}` : ''}`,
      { entity_id: id, action_page: 'operations:non-selling' }
    );
  }

  return getPromoRequest(id);
}

function cancelPromoRequest(id, actor) {
  requireRole(actor, ['owner']);
  const db = getDb();
  const req = db.prepare('SELECT * FROM product_promo_requests WHERE id = ?').get(id);
  if (!req) throw new Error('Promo request not found');
  if (!['pending', 'approved', 'active'].includes(req.status)) {
    throw new Error('Only pending, approved, or active promos can be cancelled');
  }
  const overrideMeta = adminOverride.assertCanModify(actor, req.proposed_by, { override_reason: actor?.override_reason });
  if (overrideMeta.override) {
    adminOverride.logAdminOverride(actor, 'admin_override_cancel_promo', 'product_promo_request', id, {
      reason: overrideMeta.reason,
      record_owner_id: req.proposed_by,
      product_id: req.product_id,
      status: req.status
    });
  }
  db.prepare(`
    UPDATE product_promo_requests
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  db.prepare('UPDATE products SET promo_flag = 0, promo_notes = NULL WHERE id = ?').run(req.product_id);
  audit(actor?.id, actor?.username, 'cancel_product_promo', id, {
    product_id: req.product_id,
    previous_status: req.status,
    override: overrideMeta.override || false
  });
  return getPromoRequest(id);
}

function deletePromoRequest(id, actor) {
  requireRole(actor, ['owner']);
  const db = getDb();
  const req = db.prepare('SELECT * FROM product_promo_requests WHERE id = ?').get(id);
  if (!req) throw new Error('Promo request not found');
  const overrideMeta = adminOverride.assertCanModify(actor, req.proposed_by, { override_reason: actor?.override_reason });
  if (overrideMeta.override) {
    adminOverride.logAdminOverride(actor, 'admin_override_delete_promo', 'product_promo_request', id, {
      reason: overrideMeta.reason,
      record_owner_id: req.proposed_by,
      product_id: req.product_id,
      status: req.status
    });
  }
  db.prepare('DELETE FROM product_promo_requests WHERE id = ?').run(id);
  db.prepare('UPDATE products SET promo_flag = 0, promo_notes = NULL WHERE id = ?').run(req.product_id);
  audit(actor?.id, actor?.username, 'delete_product_promo', id, {
    product_id: req.product_id,
    status: req.status,
    override: overrideMeta.override || false
  });
  return { success: true };
}

function updatePromoRequest(id, data, actor) {
  requireRole(actor, ADMIN_ROLES);
  const db = getDb();
  const req = db.prepare('SELECT * FROM product_promo_requests WHERE id = ?').get(id);
  if (!req) throw new Error('Promo request not found');
  if (!['pending', 'approved', 'active'].includes(req.status)) {
    throw new Error('Only pending or active promos can be edited');
  }

  const proposedPrice = data.proposed_price != null ? Number(data.proposed_price) : Number(req.proposed_price);
  const startDate = data.start_date != null ? String(data.start_date).trim() : req.start_date;
  const endDate = data.end_date != null ? String(data.end_date).trim() : req.end_date;
  const notes = data.notes != null ? (String(data.notes).trim() || null) : req.notes;

  if (!proposedPrice || proposedPrice <= 0) throw new Error('Sale price must be greater than 0');
  if (!startDate || !endDate) throw new Error('Start date and end date are required');
  if (endDate < startDate) throw new Error('End date must be on or after start date');

  const product = db.prepare('SELECT id, name, selling_price, buying_price FROM products WHERE id = ?').get(req.product_id);
  const cost = Math.max(0, Number(product?.buying_price) || 0);
  if (cost > 0 && proposedPrice < cost && !data.force_below_cost) {
    throw new Error(`Sale price cannot go below cost (${cost})`);
  }

  const todayStr = today();
  let newStatus = req.status;
  if (endDate < todayStr) newStatus = 'expired';
  else if (startDate <= todayStr && endDate >= todayStr) newStatus = 'active';
  else if (req.status !== 'pending') newStatus = 'approved';

  db.prepare(`
    UPDATE product_promo_requests
    SET proposed_price = ?, start_date = ?, end_date = ?, notes = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(proposedPrice, startDate, endDate, notes, newStatus, id);

  db.prepare('UPDATE products SET promo_flag = 1, promo_notes = ? WHERE id = ?').run(
    `Promo: ${proposedPrice} (${startDate} to ${endDate})`, req.product_id
  );

  audit(actor?.id, actor?.username, 'update_product_promo', id, {
    product_id: req.product_id, proposed_price: proposedPrice, start_date: startDate, end_date: endDate, status: newStatus
  });

  return getPromoRequest(id);
}

function buildPromoWhatsAppMessage(promo, shopName) {
  const name = shopName || 'Our store';
  const product = promo.product_name || 'Product';
  const oldPrice = Number(promo.original_price) || 0;
  const newPrice = Number(promo.proposed_price) || 0;
  const lines = [
    `🔥 *SALE — ${name}*`,
    '',
    `*${product}*`,
    oldPrice > newPrice ? `Was ${oldPrice.toFixed(2)} → Now *${newPrice.toFixed(2)}*` : `Special price: *${newPrice.toFixed(2)}*`,
    `Valid: ${promo.start_date} to ${promo.end_date}`,
    '',
    'Order in-store or online today!'
  ];
  return lines.join('\n');
}

function getPromoSalesLog(filters = {}) {
  syncPromoStatuses();
  let sql = `
    SELECT si.id, si.sale_id, si.product_id, si.product_name, si.quantity,
      si.unit_price, si.original_unit_price, si.promo_request_id, si.total,
      s.receipt_number, s.created_at AS sale_date,
      pr.proposed_price, pr.original_price AS promo_original_price,
      pr.start_date, pr.end_date, pr.status AS promo_status
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN product_promo_requests pr ON pr.id = si.promo_request_id
    WHERE si.promo_request_id IS NOT NULL AND s.status = 'completed'
  `;
  const params = [];
  if (filters.from) { sql += ' AND date(s.created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(s.created_at) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY s.created_at DESC LIMIT 500';
  return getDb().prepare(sql).all(...params);
}

function enrichNonSellingProducts(products) {
  return (products || []).map(attachPromoStatus);
}

module.exports = {
  today,
  syncPromoStatuses,
  applyPromoPricesToProducts,
  attachPromoStatus,
  enrichNonSellingProducts,
  proposeProductPromo,
  getPendingPromoRequests,
  getPromoRequestHistory,
  getPromoRequest,
  approvePromoRequest,
  rejectPromoRequest,
  cancelPromoRequest,
  deletePromoRequest,
  updatePromoRequest,
  buildPromoWhatsAppMessage,
  getPromoSalesLog,
  getActivePromosMap
};
