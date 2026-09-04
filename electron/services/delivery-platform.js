/** Delivery platform — restored after disk recovery */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function parseJson(v, fb) { try { return v ? JSON.parse(v) : fb; } catch (_) { return fb; } }

function ensureSchema() {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['migrations-v83.sql', 'migrations-v84.sql', 'migrations-v88-delivery.sql', 'migrations-v89-driver-payouts.sql']) {
    const mig = path.join(__dirname, '../database', f);
    if (fs.existsSync(mig)) {
      try { getDb().exec(fs.readFileSync(mig, 'utf8')); } catch (_) { /* columns may exist */ }
    }
  }
}

function trackingToken() { return crypto.randomBytes(16).toString('hex'); }
function nextConfirmationCode() {
  const d = new Date();
  const prefix = `DLV${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const row = dbGet(`SELECT confirmation_code FROM delivery_assignments WHERE confirmation_code LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}%`]);
  const seq = row?.confirmation_code ? (parseInt(String(row.confirmation_code).slice(-4), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function branchFee(branchId) {
  const row = dbGet('SELECT delivery_fee FROM delivery_branch_settings WHERE branch_id=?', [branchId]);
  return Number(row?.delivery_fee) || 0;
}

function formatRow(row, opts = {}) {
  if (!row) return null;
  const items = parseJson(row.items_json, []);
  const out = {
    id: row.id, order_number: row.order_number, status: row.status,
    delivery_address: row.delivery_address, customer_name: row.customer_name,
    customer_phone: row.customer_phone, branch_id: row.branch_id,
    branch_name: row.branch_name, driver_id: row.driver_id, driver_name: row.driver_name,
    delivery_fee: Number(row.delivery_fee) || 0, payment_method: row.payment_method,
    special_instructions: row.special_instructions, tracking_token: row.tracking_token,
    confirmation_code: row.confirmation_code, pickup_at_store: !!row.pickup_at_store,
    source_type: row.source_type, source_label: row.source_label,
    assigned_at: row.assigned_at, picked_up_at: row.picked_up_at, on_way_at: row.on_way_at,
    delivered_at: row.delivered_at, created_at: row.created_at
  };
  if (opts.admin) {
    out.total = Number(row.total) || 0;
    out.items = items;
    out.sale_id = row.sale_id;
  } else if (opts.driver) {
    out.delivery_number = row.confirmation_code;
    out.items = items.map((i) => ({ name: i.name || i.product_name, quantity: i.quantity || 1 }));
    delete out.order_number;
    if (opts.maskCustomer || (opts.history && ['delivered', 'failed', 'cancelled'].includes(row.status))) {
      delete out.customer_phone;
      out.customer_name = out.customer_name ? 'Customer' : '';
    }
  } else {
    out.items = items.map((i) => ({ name: i.name || i.product_name, quantity: i.quantity || 1 }));
  }
  return out;
}

function recordHistory(deliveryId, fromStatus, toStatus, actor, notes) {
  dbRun(`INSERT INTO delivery_status_history (delivery_id, from_status, to_status, actor_type, actor_id, actor_name, notes)
    VALUES (?,?,?,?,?,?,?)`, [
    deliveryId, fromStatus || null, toStatus,
    actor?.role || actor?.type || 'system', actor?.id || null, actor?.full_name || actor?.name || null, notes || null
  ]);
}

function notifyCustomer(row, event, extra = {}) {
  try {
    const phone = row.customer_phone;
    if (!phone) return;
    const store = require('./store');
    const msgs = {
      assigned: `Your order ${row.confirmation_code || row.order_number} has been assigned to a driver.`,
      driver_accepted: `Driver accepted your delivery ${row.confirmation_code || ''}.`,
      pickup_at_store: `No driver available. Please collect order ${row.confirmation_code || row.order_number} at the store.`,
      picked_up: `Your order ${row.confirmation_code || ''} has been picked up.`,
      on_way: `Your order ${row.confirmation_code || ''} is on the way.`,
      delivered: `Your order ${row.confirmation_code || ''} has been delivered. Thank you!`
    };
    const body = extra.message || msgs[event];
    if (!body) return;
    store.sendMessage?.({ phone, body, template_key: `delivery_${event}` }, { id: 0, role: 'system' });
  } catch (_) { /* optional */ }
}

function upsertDelivery(data) {
  ensureSchema();
  const existing = dbGet('SELECT * FROM delivery_assignments WHERE source_type=? AND source_id=?', [data.source_type, data.source_id]);
  const fee = Number(data.delivery_fee) || branchFee(data.branch_id) || 0;
  if (existing) {
    dbRun(`UPDATE delivery_assignments SET order_number=?, branch_id=?, sale_id=?, delivery_address=?, customer_name=?,
      customer_phone=?, total=?, delivery_fee=?, payment_method=?, special_instructions=?, items_json=?, source_label=?, updated_at=?
      WHERE id=?`, [
      data.order_number || existing.order_number, data.branch_id || existing.branch_id, data.sale_id || existing.sale_id,
      data.delivery_address || existing.delivery_address, data.customer_name || existing.customer_name,
      data.customer_phone || existing.customer_phone, data.total ?? existing.total, fee,
      data.payment_method || existing.payment_method, data.special_instructions || existing.special_instructions,
      JSON.stringify(data.items || parseJson(existing.items_json, [])), data.source_label || existing.source_label,
      nowIso(), existing.id
    ]);
    return getDelivery(existing.id);
  }
  const confirm = data.confirmation_code || nextConfirmationCode();
  const token = data.tracking_token || trackingToken();
  const r = dbRun(`INSERT INTO delivery_assignments (source_type, source_id, order_number, branch_id, sale_id, status,
    delivery_address, customer_name, customer_phone, total, delivery_fee, payment_method, special_instructions,
    items_json, tracking_token, confirmation_code, source_label, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    data.source_type, data.source_id, data.order_number || confirm, data.branch_id || null, data.sale_id || null, 'pending',
    data.delivery_address || '', data.customer_name || '', data.customer_phone || '', Number(data.total) || 0, fee,
    data.payment_method || '', data.special_instructions || '', JSON.stringify(data.items || []), token, confirm,
    data.source_label || data.source_type, nowIso(), nowIso()
  ]);
  recordHistory(r.lastInsertRowid, null, 'pending', { type: 'system' });
  releaseToDriverPoolIfAuto(r.lastInsertRowid);
  return getDelivery(r.lastInsertRowid);
}

function releaseToDriverPoolIfAuto(deliveryId) {
  const settings = getSettings();
  if (settings.default_assignment_mode !== 'auto') return;
  dbRun("UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, updated_at=? WHERE id=? AND driver_id IS NULL", [nowIso(), deliveryId]);
}

function releaseToDriverPool(id, actor) {
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
  if (!row) throw new Error('Delivery not found');
  dbRun("UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, updated_at=? WHERE id=?", [nowIso(), id]);
  recordHistory(id, row.status, 'awaiting_driver', actor, 'Released to driver pool');
  return getDelivery(id);
}

function upsertFromSale(sale) {
  const isDelivery = sale && (sale.order_type === 'delivery'
    || (sale.delivery_address && String(sale.delivery_address).trim()));
  if (!isDelivery) return null;
  const items = dbAll('SELECT product_name, quantity FROM sale_items WHERE sale_id=?', [sale.id]).map((i) => ({
    name: i.product_name, quantity: i.quantity
  }));
  return upsertDelivery({
    source_type: 'sale', source_id: sale.id, sale_id: sale.id, order_number: sale.receipt_number || sale.invoice_number,
    branch_id: sale.branch_id, delivery_address: sale.delivery_address || sale.notes,
    customer_name: sale.customer_name, customer_phone: sale.customer_phone,
    total: sale.total, delivery_fee: sale.delivery_fee ?? branchFee(sale.branch_id),
    payment_method: sale.payment_method, items, source_label: sale.source === 'online' ? 'online' : 'pos'
  });
}

function upsertFromOnlineOrder(order) {
  const fulfillment = order.fulfillment_type || order.fulfillment || order.fulfilment || order.order_type;
  if (!order || fulfillment !== 'delivery') return null;
  const items = parseJson(order.items_json, order.items || []);
  return upsertDelivery({
    source_type: 'online_order', source_id: order.id, order_number: order.order_number,
    branch_id: order.branch_id, delivery_address: order.delivery_address,
    customer_name: order.customer_name, customer_phone: order.customer_phone,
    total: order.total, delivery_fee: order.delivery_fee ?? branchFee(order.branch_id),
    payment_method: order.payment_method, special_instructions: order.notes, items,
    source_label: 'online', confirmation_code: order.confirmation_code || null,
    tracking_token: order.tracking_token || null
  });
}

function getDelivery(id) {
  const row = dbGet(`SELECT da.*, b.name AS branch_name FROM delivery_assignments da
    LEFT JOIN branches b ON b.id = da.branch_id WHERE da.id=?`, [id]);
  return formatRow(row, { admin: true });
}

function listDeliveries(filters = {}, actor) {
  ensureSchema();
  const where = ["da.status NOT IN ('cancelled')"];
  const params = [];
  if (filters.status) { where.push('da.status=?'); params.push(filters.status); }
  if (filters.branch_id) { where.push('da.branch_id=?'); params.push(filters.branch_id); }
  where.push("(da.source_type IN ('sale','online_order') AND (da.delivery_address IS NOT NULL AND da.delivery_address != ''))");
  const limit = Math.min(Number(filters.limit) || 100, 500);
  const rows = dbAll(`SELECT da.*, b.name AS branch_name FROM delivery_assignments da
    LEFT JOIN branches b ON b.id = da.branch_id WHERE ${where.join(' AND ')} ORDER BY da.id DESC LIMIT ${limit}`, params);
  return rows.map((r) => formatRow(r, { admin: true }));
}

function deliveryDashboard(filters = {}, actor) {
  const branchId = filters.branch_id || null;
  const p = branchId ? [branchId] : [];
  const b = branchId ? ' AND branch_id=?' : '';
  const stats = {
    pending: dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE status='pending'${b}`, p)?.c || 0,
    waiting: dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE status IN ('awaiting_driver','assigned')${b}`, p)?.c || 0,
    active: dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE status IN ('driver_accepted','picked_up','on_way')${b}`, p)?.c || 0,
    delivered_today: dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE status='delivered' AND date(delivered_at)=date('now')${b}`, p)?.c || 0,
    fees_today: dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s FROM delivery_assignments WHERE status='delivered' AND date(delivered_at)=date('now')${b}`, p)?.s || 0
  };
  const drivers_total = dbGet("SELECT COUNT(*) AS c FROM delivery_drivers WHERE status='active'")?.c || 0;
  const drivers_online = dbGet("SELECT COUNT(*) AS c FROM delivery_drivers WHERE status='active' AND availability='online'")?.c || 0;
  return { stats, drivers_total, drivers_online, recent: listDeliveries({ limit: 15, branch_id: branchId }, actor) };
}

function listDrivers(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM delivery_drivers WHERE 1=1';
  const p = [];
  if (filters.status) { sql += ' AND status=?'; p.push(filters.status); }
  if (filters.branch_id) {
    sql += ' AND (all_branches=1 OR id IN (SELECT driver_id FROM delivery_driver_branches WHERE branch_id=?))';
    p.push(filters.branch_id);
  }
  sql += ' ORDER BY full_name';
  return dbAll(sql, p).map((d) => {
    d.branches = dbAll('SELECT branch_id FROM delivery_driver_branches WHERE driver_id=?', [d.id]).map((r) => r.branch_id);
    return d;
  });
}

function getDriver(id) {
  const d = dbGet('SELECT * FROM delivery_drivers WHERE id=?', [id]);
  if (!d) return null;
  d.branches = dbAll('SELECT branch_id FROM delivery_driver_branches WHERE driver_id=?', [id]).map((r) => r.branch_id);
  return d;
}

function saveDriver(data, actor) {
  ensureSchema();
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const branches = Array.isArray(data.branches) ? data.branches : [];
  if (data.id) {
    const status = data.status || undefined;
    dbRun(`UPDATE delivery_drivers SET full_name=?, phone=?, email=?, vehicle_info=?, notes=?, all_branches=?,
      bank_name=COALESCE(?, bank_name), bank_account=COALESCE(?, bank_account), bank_branch_code=COALESCE(?, bank_branch_code),
      status=COALESCE(?, status), updated_at=? WHERE id=?`, [
      data.full_name, data.phone, data.email || null, data.vehicle_info || null, data.notes || null,
      data.all_branches ? 1 : 0,
      data.bank_name != null ? data.bank_name : null,
      data.bank_account != null ? data.bank_account : null,
      data.bank_branch_code != null ? data.bank_branch_code : null,
      status || null, nowIso(), data.id
    ]);
    dbRun('DELETE FROM delivery_driver_branches WHERE driver_id=?', [data.id]);
    branches.forEach((bid) => dbRun('INSERT OR IGNORE INTO delivery_driver_branches (driver_id, branch_id) VALUES (?,?)', [data.id, bid]));
    return getDriver(data.id);
  }
  const code = data.driver_code || `DRV${Date.now().toString(36).toUpperCase()}`;
  const hash = data.password ? bcrypt.hashSync(data.password, 10) : null;
  const r = dbRun(`INSERT INTO delivery_drivers (driver_code, full_name, phone, email, password_hash, vehicle_info, bank_name, bank_account, bank_branch_code, status, all_branches)
    VALUES (?,?,?,?,?,?,?,?,?, 'active', ?)`, [
    code, data.full_name, data.phone, data.email || null, hash, data.vehicle_info || null,
    data.bank_name || null, data.bank_account || null, data.bank_branch_code || null,
    data.all_branches ? 1 : 0
  ]);
  const id = r.lastInsertRowid;
  branches.forEach((bid) => dbRun('INSERT OR IGNORE INTO delivery_driver_branches (driver_id, branch_id) VALUES (?,?)', [id, bid]));
  return getDriver(id);
}

function registerDriver(data) {
  ensureSchema();
  const code = `DRV${Date.now().toString(36).toUpperCase()}`;
  const hash = bcrypt.hashSync(data.password || 'driver123', 10);
  const r = dbRun(`INSERT INTO delivery_drivers (driver_code, full_name, phone, email, password_hash, id_number, address, vehicle_info, documents_json, status)
    VALUES (?,?,?,?,?,?,?,?,?, 'pending')`, [
    code, data.full_name, data.phone, data.email || null, hash, data.id_number || null, data.address || null,
    data.vehicle_info || null, JSON.stringify(data.documents || [])
  ]);
  const insertId = r.lastInsertRowid || dbGet('SELECT id FROM delivery_drivers WHERE driver_code=?', [code])?.id;
  return { id: insertId, driver_code: code, status: 'pending' };
}

function approveDriver(id, actor) {
  dbRun("UPDATE delivery_drivers SET status='active', approved_at=?, approved_by=? WHERE id=?", [nowIso(), actor?.id, id]);
  return getDriver(id);
}

function rejectDriver(id, reason, actor) {
  dbRun("UPDATE delivery_drivers SET status='rejected', notes=? WHERE id=?", [reason || 'Rejected', id]);
  return getDriver(id);
}

function driversForBranch(branchId) {
  return listDrivers({ status: 'active', branch_id: branchId }).filter((d) => d.availability === 'online' || d.availability === 'busy');
}

function assignDriver(id, driverId, actor, opts = {}) {
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
  const driver = getDriver(driverId);
  if (!row || !driver) throw new Error('Delivery or driver not found');
  if (!driver.all_branches && row.branch_id) {
    const ok = dbGet('SELECT 1 FROM delivery_driver_branches WHERE driver_id=? AND branch_id=?', [driverId, row.branch_id]);
    if (!ok) throw new Error('Driver is not registered for this branch');
  }
  const fee = opts.delivery_fee != null ? Number(opts.delivery_fee) : (Number(row.delivery_fee) || branchFee(row.branch_id));
  dbRun(`UPDATE delivery_assignments SET driver_id=?, driver_name=?, driver_employee_id=?, delivery_fee=?, status='assigned', assigned_at=?, updated_at=? WHERE id=?`, [
    driverId, driver.full_name, driver.employee_id || null, fee, nowIso(), nowIso(), id
  ]);
  recordHistory(id, row.status, 'assigned', actor);
  notifyCustomer({ ...row, confirmation_code: row.confirmation_code }, 'assigned');
  try {
    if (driver.phone && row.confirmation_code) {
      const whatsapp = require('./whatsapp');
      const body = `New delivery assigned: ${row.confirmation_code}\nCustomer handoff code: *${row.confirmation_code}*\n${row.delivery_address || ''}`;
      dbRun(`INSERT INTO whatsapp_messages (recipient_type, phone, message_type, body, status, sender_name, metadata_json)
        VALUES ('driver',?,?,?,'pending','delivery',?)`, [
        driver.phone.trim(), 'delivery_assigned', body, JSON.stringify({ url: whatsapp.buildWaUrl(driver.phone, body), via: 'wa.me' })
      ]);
    }
  } catch (_) { /* optional */ }
  return getDelivery(id);
}

function autoAssignDriver(id, actor) {
  const settings = getSettings();
  if (settings.default_assignment_mode === 'auto') {
    return releaseToDriverPool(id, actor);
  }
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
  if (!row) throw new Error('Delivery not found');
  const candidates = driversForBranch(row.branch_id);
  if (!candidates.length) throw new Error('No online drivers for this branch');
  return assignDriver(id, candidates[0].id, actor);
}

function assignMultipleOrders(orderIds, driverId, actor, opts = {}) {
  const ids = (Array.isArray(orderIds) ? orderIds : []).map(Number).filter(Boolean);
  if (!ids.length) throw new Error('Select at least one order');
  return ids.map((id) => assignDriver(id, driverId, actor, opts));
}

function updateDeliveryStatus(id, status, actor, opts = {}) {
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
  if (!row) throw new Error('Delivery not found');
  const ts = nowIso();
  const patch = { status, updated_at: ts };
  if (status === 'picked_up') patch.picked_up_at = ts;
  if (status === 'on_way') patch.on_way_at = ts;
  if (status === 'delivered') patch.delivered_at = ts;
  dbRun(`UPDATE delivery_assignments SET status=?, picked_up_at=COALESCE(?, picked_up_at), on_way_at=COALESCE(?, on_way_at),
    delivered_at=COALESCE(?, delivered_at), notes=COALESCE(?, notes), updated_at=? WHERE id=?`, [
    status, patch.picked_up_at || null, patch.on_way_at || null, patch.delivered_at || null, opts.notes || null, ts, id
  ]);
  recordHistory(id, row.status, status, actor, opts.notes);
  notifyCustomer(row, status);
  if (status === 'delivered' && row.driver_id) {
    dbRun('UPDATE delivery_drivers SET total_deliveries=total_deliveries+1 WHERE id=?', [row.driver_id]);
  }
  return getDelivery(id);
}

function getSettings() {
  ensureSchema();
  return dbGet('SELECT * FROM delivery_settings WHERE id=1') || {};
}

function saveSettings(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  dbRun(`UPDATE delivery_settings SET department_mode=?, default_assignment_mode=?, auto_assign_radius_km=?,
    payout_cycle_days=COALESCE(?, payout_cycle_days), payout_day_of_week=COALESCE(?, payout_day_of_week), updated_at=? WHERE id=1`, [
    data.department_mode || 'per_branch', data.default_assignment_mode || 'manual', Number(data.auto_assign_radius_km) || 15,
    data.payout_cycle_days != null ? Number(data.payout_cycle_days) : null,
    data.payout_day_of_week != null ? Number(data.payout_day_of_week) : null,
    nowIso()
  ]);
  return getSettings();
}

function getBranchSettings(branchId) {
  ensureSchema();
  return dbGet('SELECT * FROM delivery_branch_settings WHERE branch_id=?', [branchId]) || { branch_id: branchId, delivery_fee: 0 };
}

function syncBranchFeesToOnline(branchId, data) {
  try {
    const web = require('./online-ordering');
    web.ensureSchema?.();
    const fee = Number(data.delivery_fee) || 0;
    const freeAbove = Number(data.free_delivery_above) || 0;
    const minOrder = Number(data.min_order) || 0;
    const existing = dbGet('SELECT branch_id FROM branch_online_settings WHERE branch_id=?', [branchId]);
    if (existing) {
      dbRun(`UPDATE branch_online_settings SET delivery_fee=?, free_delivery_above=?, min_delivery_order=?, delivery_enabled=1, updated_at=datetime('now') WHERE branch_id=?`,
        [fee, freeAbove, minOrder, branchId]);
    } else {
      dbRun(`INSERT INTO branch_online_settings (branch_id, online_enabled, delivery_enabled, collection_enabled, status, min_delivery_order, delivery_fee, free_delivery_above, prep_minutes)
        VALUES (?,?,1,1,'open',?,?,?,25)`, [branchId, 1, minOrder, fee, freeAbove]);
    }
  } catch (_) { /* optional */ }
}

function listAllBranchSettings() {
  ensureSchema();
  return dbAll(`SELECT dbs.*, b.name AS branch_name FROM delivery_branch_settings dbs
    LEFT JOIN branches b ON b.id = dbs.branch_id ORDER BY b.name`);
}

function deleteBranchSettings(branchId, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  dbRun('DELETE FROM delivery_branch_settings WHERE branch_id=?', [branchId]);
  return { deleted: true, branch_id: branchId };
}

function saveBranchSettings(branchId, data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  dbRun(`INSERT INTO delivery_branch_settings (branch_id, delivery_enabled, assignment_mode, delivery_fee, free_delivery_above, min_order, updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(branch_id) DO UPDATE SET delivery_enabled=excluded.delivery_enabled, assignment_mode=excluded.assignment_mode,
    delivery_fee=excluded.delivery_fee, free_delivery_above=excluded.free_delivery_above, min_order=excluded.min_order, updated_at=excluded.updated_at`, [
    branchId, data.delivery_enabled != null ? (data.delivery_enabled ? 1 : 0) : 1, data.assignment_mode || 'manual',
    Number(data.delivery_fee) || 0, Number(data.free_delivery_above) || 0, Number(data.min_order) || 0, nowIso()
  ]);
  syncBranchFeesToOnline(branchId, data);
  return getBranchSettings(branchId);
}

function suspendDriver(id, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  dbRun("UPDATE delivery_drivers SET status='suspended', updated_at=? WHERE id=?", [nowIso(), id]);
  dbRun('DELETE FROM delivery_driver_sessions WHERE driver_id=?', [id]);
  return getDriver(id);
}

function deleteDriver(id, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  dbRun("UPDATE delivery_drivers SET status='deleted', updated_at=? WHERE id=?", [nowIso(), id]);
  dbRun('DELETE FROM delivery_driver_sessions WHERE driver_id=?', [id]);
  return { deleted: true, id };
}

function deliveryReports(filters = {}, actor) {
  const from = filters.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = filters.to || new Date().toISOString().slice(0, 10);
  const params = [from, to];
  let driverSql = '';
  if (filters.driver_id) {
    driverSql = ' AND da.driver_id=?';
    params.push(Number(filters.driver_id));
  }
  const rows = dbAll(`SELECT da.id, da.order_number, da.confirmation_code, da.customer_name, da.driver_name, da.driver_id, da.status,
    da.delivery_fee, da.delivered_at, da.branch_id, b.name AS branch_name
    FROM delivery_assignments da LEFT JOIN branches b ON b.id=da.branch_id
    WHERE date(da.created_at) BETWEEN date(?) AND date(?)${driverSql} ORDER BY da.id DESC`, params);
  const summary = {
    total: rows.length,
    delivered: rows.filter((r) => r.status === 'delivered').length,
    fees: rows.filter((r) => r.status === 'delivered').reduce((s, r) => s + (Number(r.delivery_fee) || 0), 0)
  };
  const shop = dbGet('SELECT shop_name, address, phone, logo_path FROM shop_settings WHERE id=1') || {};
  return { from, to, summary, rows, shop };
}

function driverEarningsReport(driverId, filters = {}) {
  const driver = getDriver(driverId);
  if (!driver) throw new Error('Driver not found');
  const from = filters.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = filters.to || new Date().toISOString().slice(0, 10);
  const rows = dbAll(`SELECT da.confirmation_code, da.order_number, da.customer_name, da.delivery_address, da.delivery_fee,
    da.delivered_at, da.status, b.name AS branch_name FROM delivery_assignments da
    LEFT JOIN branches b ON b.id=da.branch_id
    WHERE da.driver_id=? AND da.status='delivered' AND date(da.delivered_at) BETWEEN date(?) AND date(?)
    ORDER BY da.delivered_at DESC`, [driverId, from, to]);
  const total = rows.reduce((s, r) => s + (Number(r.delivery_fee) || 0), 0);
  const shop = dbGet('SELECT shop_name, address, phone FROM shop_settings WHERE id=1') || {};
  return { driver, from, to, rows, total, shop };
}

function getDeliveryByTracking(token) {
  const row = dbGet(`SELECT da.*, b.name AS branch_name FROM delivery_assignments da
    LEFT JOIN branches b ON b.id = da.branch_id WHERE da.tracking_token=?`, [token]);
  if (!row) return null;
  const pub = formatRow(row, {});
  delete pub.customer_phone;
  pub.confirmation_code = row.confirmation_code;
  pub.status_label = ({ pending: 'Order received', assigned: 'Driver assigned', driver_accepted: 'Driver confirmed',
    picked_up: 'Picked up', on_way: 'On the way', delivered: 'Delivered', pickup_at_store: 'Collect at store' })[row.status] || row.status;
  if (row.pickup_at_store) pub.status_label = 'Please collect at store';
  const steps = [
    { key: 'received', label: 'Order received', done: true },
    { key: 'assigned', label: 'Driver assigned', done: ['assigned', 'driver_accepted', 'picked_up', 'on_way', 'delivered'].includes(row.status) },
    { key: 'picked_up', label: 'Picked up from store', done: ['picked_up', 'on_way', 'delivered'].includes(row.status) },
    { key: 'on_way', label: 'On the way', done: ['on_way', 'delivered'].includes(row.status) },
    { key: 'delivered', label: 'Delivered', done: row.status === 'delivered' }
  ];
  if (row.pickup_at_store) {
    pub.timeline = [{ key: 'pickup', label: 'Collect at store', done: false, active: true }];
  } else {
    pub.timeline = steps.map((s) => ({
      ...s,
      active: s.done && steps[steps.indexOf(s) + 1] && !steps[steps.indexOf(s) + 1].done
        || (!s.done && steps.slice(0, steps.indexOf(s)).every((x) => x.done))
    }));
  }
  return pub;
}

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function driverFromToken(token) {
  if (!token) throw new Error('Not authenticated');
  const row = dbGet(`SELECT d.* FROM delivery_driver_sessions s JOIN delivery_drivers d ON d.id=s.driver_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')`, [hashToken(token)]);
  if (!row) throw new Error('Session expired');
  return row;
}

function driverLogin(username, password, device = {}) {
  ensureSchema();
  const driver = dbGet(`SELECT * FROM delivery_drivers WHERE (phone=? OR email=? OR driver_code=?)`, [username, username, username]);
  if (!driver) throw new Error('Invalid credentials');
  if (driver.status === 'suspended') throw new Error('Your driver account is suspended. Contact the shop administrator.');
  if (driver.status !== 'active') throw new Error('Your driver account is not active yet.');
  if (!driver.password_hash || !bcrypt.compareSync(password, driver.password_hash)) throw new Error('Invalid credentials');
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  dbRun('INSERT INTO delivery_driver_sessions (driver_id, token_hash, device_uid, device_name, platform, expires_at) VALUES (?,?,?,?,?,?)', [
    driver.id, hashToken(token), device.device_uid || null, device.device_name || null, device.platform || 'web', exp
  ]);
  dbRun('UPDATE delivery_drivers SET last_login_at=? WHERE id=?', [nowIso(), driver.id]);
  return { token, driver: { id: driver.id, full_name: driver.full_name, availability: driver.availability } };
}

function driverLogout(token) {
  dbRun('DELETE FROM delivery_driver_sessions WHERE token_hash=?', [hashToken(token)]);
  return true;
}

function driverBranchIds(driver) {
  if (driver.all_branches) {
    return dbAll('SELECT id FROM branches WHERE is_active=1').map((r) => r.id);
  }
  return dbAll('SELECT branch_id FROM delivery_driver_branches WHERE driver_id=?', [driver.id]).map((r) => r.branch_id);
}

function driverAvailableOrders(driver) {
  const branchIds = driverBranchIds(driver);
  if (!branchIds.length) return [];
  const placeholders = branchIds.map(() => '?').join(',');
  const rows = dbAll(`SELECT da.* FROM delivery_assignments da
    WHERE da.status='awaiting_driver' AND da.driver_id IS NULL AND da.branch_id IN (${placeholders})
    ORDER BY da.id ASC`, branchIds);
  return rows.map((r) => formatRow(r, { driver: true }));
}

function driverDashboard(token) {
  const driver = driverFromToken(token);
  const assigned = dbAll(`SELECT da.* FROM delivery_assignments da WHERE da.driver_id=? AND da.status NOT IN ('delivered','failed','cancelled') ORDER BY da.id DESC`, [driver.id]);
  const available = driver.availability === 'online' ? driverAvailableOrders(driver) : [];
  const completed_today = dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE driver_id=? AND status='delivered' AND date(delivered_at)=date('now')`, [driver.id])?.c || 0;
  const fees_today = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s FROM delivery_assignments WHERE driver_id=? AND status='delivered' AND date(delivered_at)=date('now')`, [driver.id])?.s || 0;
  const earnings_total = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s FROM delivery_assignments WHERE driver_id=? AND status='delivered'`, [driver.id])?.s || 0;
  const owed = driverOwedAmount(driver.id);
  const shop = dbGet('SELECT shop_name, logo_path FROM shop_settings WHERE id=1') || {};
  return {
    driver: {
      id: driver.id, full_name: driver.full_name, availability: driver.availability, phone: driver.phone,
      bank_name: driver.bank_name, bank_account: driver.bank_account, bank_branch_code: driver.bank_branch_code
    },
    shop_name: shop.shop_name,
    shop_logo: shop.logo_path ? '/api/logo' : null,
    assigned_count: assigned.length,
    assigned: assigned.map((r) => formatRow(r, { driver: true })),
    available: available.map((r) => formatRow(r, { driver: true })),
    completed_today, fees_today, earnings_total,
    owed_amount: owed.amount,
    owed_from: owed.from,
    owed_to: owed.to
  };
}

function lastPayoutForDriver(driverId) {
  return dbGet(`SELECT * FROM delivery_driver_payouts WHERE driver_id=? ORDER BY id DESC LIMIT 1`, [driverId]);
}

function driverOwedAmount(driverId) {
  const last = lastPayoutForDriver(driverId);
  const from = last?.period_to || last?.paid_at?.slice(0, 10) || '1970-01-01';
  const to = nowIso().slice(0, 10);
  const row = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s, COUNT(*) AS c FROM delivery_assignments
    WHERE driver_id=? AND status='delivered' AND date(COALESCE(delivered_at, updated_at)) > date(?)`, [driverId, from]);
  return { amount: Number(row?.s) || 0, count: row?.c || 0, from, to };
}

function driverHistory(token, filters = {}) {
  const driver = driverFromToken(token);
  const limit = Math.min(Number(filters.limit) || 80, 300);
  let sql = `SELECT da.* FROM delivery_assignments da WHERE da.driver_id=? AND da.status IN ('delivered','failed','cancelled')`;
  const params = [driver.id];
  if (filters.from) { sql += ` AND date(COALESCE(da.delivered_at, da.updated_at)) >= date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(COALESCE(da.delivered_at, da.updated_at)) <= date(?)`; params.push(filters.to); }
  sql += ` ORDER BY da.id DESC LIMIT ${limit}`;
  const rows = dbAll(sql, params);
  return rows.map((r) => formatRow(r, { driver: true, history: true }));
}

function driverEarnings(token, filters = {}) {
  const driver = driverFromToken(token);
  const from = filters.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = filters.to || new Date().toISOString().slice(0, 10);
  const rows = dbAll(`SELECT da.* FROM delivery_assignments da WHERE da.driver_id=? AND da.status='delivered'
    AND date(COALESCE(da.delivered_at, da.updated_at)) BETWEEN date(?) AND date(?) ORDER BY da.delivered_at DESC`, [driver.id, from, to]);
  const total = rows.reduce((s, r) => s + (Number(r.delivery_fee) || 0), 0);
  const owed = driverOwedAmount(driver.id);
  return {
    from, to, total, count: rows.length, rows: rows.map((r) => formatRow(r, { driver: true, history: true })),
    owed_amount: owed.amount, owed_from: owed.from, owed_to: owed.to
  };
}

function driverPayments(token) {
  const driver = driverFromToken(token);
  const rows = dbAll(`SELECT * FROM delivery_driver_payouts WHERE driver_id=? ORDER BY id DESC LIMIT 100`, [driver.id]);
  const owed = driverOwedAmount(driver.id);
  return { payouts: rows, owed_amount: owed.amount, owed_from: owed.from, owed_to: owed.to };
}

function listDriverPaymentSummary(actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const drivers = listDrivers({ status: 'active' });
  return drivers.map((d) => {
    const owed = driverOwedAmount(d.id);
    return {
      id: d.id, full_name: d.full_name, phone: d.phone,
      bank_name: d.bank_name, bank_account: d.bank_account, bank_branch_code: d.bank_branch_code,
      owed_amount: owed.amount, owed_from: owed.from, owed_to: owed.to, delivered_count: owed.count
    };
  });
}

function recordDriverPayout(driverId, data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  const driver = getDriver(driverId);
  if (!driver) throw new Error('Driver not found');
  const owed = driverOwedAmount(driverId);
  const amount = data.amount != null ? Number(data.amount) : owed.amount;
  if (amount <= 0) throw new Error('Nothing to pay — no delivered fees in this period');
  const from = data.period_from || owed.from;
  const to = data.period_to || owed.to;
  const r = dbRun(`INSERT INTO delivery_driver_payouts (driver_id, amount, period_from, period_to, paid_at, paid_by, paid_by_name, notes)
    VALUES (?,?,?,?,?,?,?,?)`, [
    driverId, amount, from, to, nowIso(), actor?.id || null, actor?.full_name || actor?.username || 'Admin', data.notes || null
  ]);
  return dbGet('SELECT * FROM delivery_driver_payouts WHERE id=?', [r.lastInsertRowid]);
}

function driverListOrders(token, filters = {}) {
  driverFromToken(token);
  return [];
}

function driverAcceptDelivery(token, id) {
  const driver = driverFromToken(token);
  if (driver.availability !== 'online') throw new Error('Go online to accept deliveries');
  let row = dbGet('SELECT * FROM delivery_assignments WHERE id=? AND driver_id=?', [id, driver.id]);
  if (!row) {
    const branchIds = driverBranchIds(driver);
    if (!branchIds.includes(Number(dbGet('SELECT branch_id FROM delivery_assignments WHERE id=?', [id])?.branch_id))) {
      throw new Error('Delivery not available for your branches');
    }
    const claim = dbRun(`UPDATE delivery_assignments SET driver_id=?, driver_name=?, status='assigned', assigned_at=?, updated_at=?
      WHERE id=? AND driver_id IS NULL AND status='awaiting_driver'`, [driver.id, driver.full_name, nowIso(), nowIso(), id]);
    if (!claim.changes) throw new Error('Another driver already accepted this delivery');
    row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
    recordHistory(id, 'awaiting_driver', 'assigned', { type: 'driver', id: driver.id, full_name: driver.full_name }, 'Driver claimed from pool');
    notifyCustomer(row, 'assigned');
  }
  dbRun("UPDATE delivery_assignments SET status='driver_accepted', driver_accepted_at=?, updated_at=? WHERE id=?", [nowIso(), nowIso(), id]);
  recordHistory(id, row.status, 'driver_accepted', { type: 'driver', id: driver.id, full_name: driver.full_name });
  notifyCustomer(row, 'driver_accepted');
  return getDelivery(id);
}

function driverRejectDelivery(token, id, reason) {
  const driver = driverFromToken(token);
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=? AND driver_id=?', [id, driver.id]);
  if (!row) throw new Error('Delivery not found');
  dbRun(`UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, pickup_at_store=1, failed_reason=?, updated_at=? WHERE id=?`, [
    reason || 'Driver rejected', nowIso(), id
  ]);
  recordHistory(id, row.status, 'awaiting_driver', { type: 'driver', id: driver.id, full_name: driver.full_name }, reason);
  notifyCustomer(row, 'pickup_at_store');
  return getDelivery(id);
}

function driverUpdateStatus(token, id, status, opts = {}) {
  const driver = driverFromToken(token);
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=? AND driver_id=?', [id, driver.id]);
  if (!row) throw new Error('Delivery not found');
  return updateDeliveryStatus(id, status, { type: 'driver', id: driver.id, full_name: driver.full_name, role: 'driver' }, opts);
}

function setDriverAvailability(token, availability) {
  const driver = driverFromToken(token);
  dbRun('UPDATE delivery_drivers SET availability=?, updated_at=? WHERE id=?', [availability, nowIso(), driver.id]);
  return { availability };
}

module.exports = {
  ensureSchema, nextConfirmationCode, upsertFromSale, upsertFromOnlineOrder, getDelivery, listDeliveries, deliveryDashboard,
  listDrivers, getDriver, saveDriver, registerDriver, approveDriver, rejectDriver, suspendDriver, deleteDriver,
  assignDriver, assignMultipleOrders, autoAssignDriver, releaseToDriverPool, updateDeliveryStatus, getSettings, saveSettings,
  getBranchSettings, saveBranchSettings, listAllBranchSettings, deleteBranchSettings, deliveryReports, driverEarningsReport,
  getDeliveryByTracking, driverLogin, driverLogout, driverDashboard, driverListOrders, driverHistory, driverEarnings, driverPayments,
  listDriverPaymentSummary, recordDriverPayout, driverAcceptDelivery,
  driverRejectDelivery, driverUpdateStatus, setDriverAvailability
};
