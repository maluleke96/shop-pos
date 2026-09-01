/**
 * Delivery Department — orders, drivers, assignment, tracking, notifications.
 * Connects: Online Ordering → POS sale → delivery_assignments → Driver App
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { assertUserActor, assertUserPermission } = require('./authz');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function nowPlusDays(d) { return new Date(Date.now() + d * 86400000).toISOString().slice(0, 19).replace('T', ' '); }
function parseJson(v, fb = {}) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function uid(prefix = 'DRV') { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

const STATUSES = [
  'pending', 'awaiting_driver', 'assigned', 'driver_accepted', 'picking_up',
  'picked_up', 'on_way', 'delivered', 'failed', 'cancelled', 'returned'
];

function ensureSchema() {
  try { dbGet('SELECT 1 FROM delivery_drivers LIMIT 1'); } catch (_) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(__dirname, '../database');
      for (const f of ['migrations-v83.sql', 'migrations-v84.sql']) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) getDb().exec(fs.readFileSync(p, 'utf8'));
      }
    } catch (err) {
      console.warn('[delivery] schema ensure failed:', err.message || err);
    }
  }
  try { dbRun('INSERT OR IGNORE INTO delivery_settings (id) VALUES (1)'); } catch (_) {
    try { dbRun('INSERT INTO delivery_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING'); } catch (__) { /* */ }
  }
}

function softAlter(sql) {
  try { getDb().exec(sql); } catch (_) { /* column exists */ }
}

function recordStatus(deliveryId, fromStatus, toStatus, actor = {}, notes = null) {
  ensureSchema();
  try {
    dbRun(`INSERT INTO delivery_status_history (delivery_id, from_status, to_status, actor_type, actor_id, actor_name, notes)
      VALUES (?,?,?,?,?,?,?)`,
      [deliveryId, fromStatus, toStatus, actor.type || actor.role || 'system', actor.id || null, actor.name || actor.full_name || null, notes]);
  } catch (_) { /* */ }
}

function formatRow(row) {
  if (!row) return null;
  return {
    ...row,
    total: Number(row.total) || 0,
    delivery_fee: Number(row.delivery_fee) || 0,
    items: parseJson(row.items_json, [])
  };
}

function trackingToken() { return crypto.randomBytes(16).toString('hex'); }

function getSettings() {
  ensureSchema();
  return dbGet('SELECT * FROM delivery_settings WHERE id = 1') || { department_mode: 'per_branch', default_assignment_mode: 'manual' };
}

function saveSettings(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureSchema();
  dbRun(`UPDATE delivery_settings SET department_mode=?, default_assignment_mode=?, auto_assign_radius_km=?,
    notify_admin_new=?, notify_driver_assigned=?, settings_json=?, updated_at=? WHERE id=1`,
    [data.department_mode || 'per_branch', data.default_assignment_mode || 'manual',
      Number(data.auto_assign_radius_km) || 15, data.notify_admin_new ? 1 : 0, data.notify_driver_assigned ? 1 : 0,
      JSON.stringify(data.settings_json || {}), nowIso()]);
  return getSettings();
}

function getBranchSettings(branchId) {
  ensureSchema();
  let row = dbGet('SELECT * FROM delivery_branch_settings WHERE branch_id=?', [branchId]);
  if (!row) {
    const global = getSettings();
    row = { branch_id: branchId, delivery_enabled: 1, assignment_mode: global.default_assignment_mode || 'manual', delivery_fee: 0 };
  }
  return { ...row, zones: parseJson(row.zones_json, []) };
}

function saveBranchSettings(branchId, data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  ensureSchema();
  dbRun(`INSERT INTO delivery_branch_settings (branch_id, delivery_enabled, assignment_mode, delivery_fee, free_delivery_above, min_order, zones_json, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(branch_id) DO UPDATE SET delivery_enabled=excluded.delivery_enabled, assignment_mode=excluded.assignment_mode,
    delivery_fee=excluded.delivery_fee, free_delivery_above=excluded.free_delivery_above, min_order=excluded.min_order,
    zones_json=excluded.zones_json, updated_at=excluded.updated_at`,
    [branchId, data.delivery_enabled ? 1 : 0, data.assignment_mode || 'manual', Number(data.delivery_fee) || 0,
      Number(data.free_delivery_above) || 0, Number(data.min_order) || 0, JSON.stringify(data.zones || []), nowIso()]);
  return getBranchSettings(branchId);
}

function notifyDelivery(audience, payload) {
  try {
    const mm = require('./mobile-manager');
    if (audience === 'admin' && mm.notifyAdmins) {
      mm.notifyAdmins(payload.type || 'delivery', payload.title, payload.body, payload);
    }
  } catch (_) { /* */ }
  try {
    const mkt = require('./marketing-platform');
    if (mkt.notifyAdmins) mkt.notifyAdmins(payload.title, payload.body, payload.category || 'delivery');
  } catch (_) { /* */ }
}

function createDeliveryFromSource(sourceType, sourceId, data = {}) {
  ensureSchema();
  const existing = dbGet(`SELECT * FROM delivery_assignments WHERE source_type=? AND source_id=?`, [sourceType, sourceId]);
  if (existing) return formatRow(existing);
  const branchId = data.branch_id || null;
  const branchSettings = branchId ? getBranchSettings(branchId) : null;
  const token = trackingToken();
  dbRun(`INSERT INTO delivery_assignments (
    source_type, source_id, order_number, branch_id, sale_id, status, delivery_address,
    customer_name, customer_phone, items_json, total, delivery_fee, payment_method,
    special_instructions, tracking_token, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [sourceType, sourceId, data.order_number || `${sourceType}-${sourceId}`, branchId, data.sale_id || null,
      'pending', data.delivery_address || null, data.customer_name || null, data.customer_phone || null,
      JSON.stringify(data.items || []), Number(data.total) || 0, Number(data.delivery_fee) || 0,
      data.payment_method || null, data.special_instructions || data.notes || null, token, data.notes || null,
      nowIso(), nowIso()]);
  const row = dbGet(`SELECT * FROM delivery_assignments WHERE source_type=? AND source_id=?`, [sourceType, sourceId]);
  recordStatus(row.id, null, 'pending', { type: 'system', name: 'System' });
  notifyDelivery('admin', { type: 'new_delivery', title: 'New delivery order', body: `${row.order_number} — ${row.customer_name || 'Customer'}` });
  if (branchSettings?.assignment_mode === 'auto') {
    try { autoAssignDriver(row.id, { type: 'system' }); } catch (_) { /* manual fallback */ }
  }
  return formatRow(row);
}

function upsertFromSale(sale) {
  if (!sale?.id) return null;
  const orderType = String(sale.order_type || '').toLowerCase();
  const hasAddress = !!(sale.delivery_address && String(sale.delivery_address).trim());
  if (orderType !== 'delivery' && !hasAddress) return null;
  let items = [];
  try { items = dbAll('SELECT product_name AS name, quantity, unit_price, total FROM sale_items WHERE sale_id=?', [sale.id]); } catch (_) { /* */ }
  let customerName = sale.customer_name;
  let customerPhone = sale.customer_phone;
  if (sale.customer_id && (!customerName || !customerPhone)) {
    const c = dbGet('SELECT name, phone FROM customers WHERE id=?', [sale.customer_id]);
    if (c) { customerName = customerName || c.name; customerPhone = customerPhone || c.phone; }
  }
  let paymentMethod = null;
  try {
    const pays = dbAll('SELECT payment_type FROM sale_payments WHERE sale_id=?', [sale.id]);
    paymentMethod = pays.map((p) => p.payment_type).join(', ') || null;
  } catch (_) { /* */ }
  return createDeliveryFromSource('sale', sale.id, {
    order_number: sale.receipt_number || sale.order_number || `SALE-${sale.id}`,
    branch_id: sale.branch_id,
    sale_id: sale.id,
    delivery_address: sale.delivery_address,
    customer_name: customerName,
    customer_phone: customerPhone,
    items,
    total: sale.total,
    delivery_fee: sale.delivery_fee,
    payment_method: paymentMethod,
    notes: sale.notes
  });
}

function upsertFromOnlineOrder(order) {
  if (!order?.id) return null;
  const fulfillment = String(order.fulfillment_type || order.fulfillment || '').toLowerCase();
  if (fulfillment !== 'delivery') return null;
  return createDeliveryFromSource('online_order', order.id, {
    order_number: order.order_number || `ONLINE-${order.id}`,
    branch_id: order.branch_id,
    sale_id: order.sale_id || null,
    delivery_address: order.delivery_address,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    items: parseJson(order.items_json, []),
    total: order.total,
    delivery_fee: order.delivery_fee,
    payment_method: order.payment_method,
    notes: order.notes
  });
}

function listDeliveries(filters = {}, actor = null) {
  ensureSchema();
  if (actor) assertUserPermission(actor, 'delivery', ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier', 'delivery_manager']);
  let sql = `SELECT d.*, b.name AS branch_name FROM delivery_assignments d LEFT JOIN branches b ON b.id = d.branch_id WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ` AND d.status=?`; params.push(filters.status); }
  if (filters.branch_id) { sql += ` AND d.branch_id=?`; params.push(filters.branch_id); }
  if (filters.driver_id) { sql += ` AND d.driver_id=?`; params.push(filters.driver_id); }
  if (filters.driver_employee_id) { sql += ` AND d.driver_employee_id=?`; params.push(filters.driver_employee_id); }
  if (filters.from) { sql += ` AND d.created_at >= ?`; params.push(filters.from); }
  if (filters.to) { sql += ` AND d.created_at <= ?`; params.push(filters.to); }
  sql += ` ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'awaiting_driver' THEN 1 WHEN 'assigned' THEN 2 WHEN 'driver_accepted' THEN 3 WHEN 'picked_up' THEN 4 WHEN 'on_way' THEN 5 ELSE 6 END, d.created_at DESC LIMIT ?`;
  params.push(Math.min(Number(filters.limit) || 200, 500));
  return dbAll(sql, params).map(formatRow);
}

function getDelivery(id) {
  ensureSchema();
  const row = dbGet(`SELECT d.*, b.name AS branch_name FROM delivery_assignments d LEFT JOIN branches b ON b.id = d.branch_id WHERE d.id=?`, [id]);
  return formatRow(row);
}

function getDeliveryByTracking(token) {
  ensureSchema();
  const row = dbGet(`SELECT id, order_number, status, delivery_address, customer_name, created_at, picked_up_at, on_way_at, delivered_at, tracking_token FROM delivery_assignments WHERE tracking_token=?`, [token]);
  if (!row) throw new Error('Tracking link not found');
  return {
    order_number: row.order_number,
    status: row.status,
    status_label: statusLabel(row.status),
    timeline: buildTimeline(row),
    updated_at: row.delivered_at || row.on_way_at || row.picked_up_at || row.created_at
  };
}

function statusLabel(s) {
  const map = {
    pending: 'Order Confirmed', awaiting_driver: 'Waiting for Driver', assigned: 'Driver Assigned',
    driver_accepted: 'Driver Accepted', picking_up: 'Preparing', picked_up: 'Picked Up',
    on_way: 'On the Way', delivered: 'Delivered', failed: 'Failed', cancelled: 'Cancelled', returned: 'Returned'
  };
  return map[s] || s;
}

function buildTimeline(row) {
  const steps = ['pending', 'picking_up', 'assigned', 'picked_up', 'on_way', 'delivered'];
  const current = row.status;
  return steps.map((s) => ({
    step: s,
    label: statusLabel(s),
    done: steps.indexOf(s) <= steps.indexOf(current) || current === 'delivered',
    active: s === current || (current === 'driver_accepted' && s === 'assigned')
  }));
}

function listDrivers(filters = {}) {
  ensureSchema();
  let sql = `SELECT * FROM delivery_drivers WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ` AND status=?`; params.push(filters.status); }
  if (filters.availability) { sql += ` AND availability=?`; params.push(filters.availability); }
  if (filters.branch_id) {
    sql += ` AND (all_branches=1 OR EXISTS (SELECT 1 FROM delivery_driver_branches db WHERE db.driver_id=delivery_drivers.id AND db.branch_id=?))`;
    params.push(filters.branch_id);
  }
  sql += ` ORDER BY full_name LIMIT 200`;
  return dbAll(sql, params);
}

function getDriver(id) {
  ensureSchema();
  const d = dbGet('SELECT * FROM delivery_drivers WHERE id=?', [id]);
  if (!d) throw new Error('Driver not found');
  const branches = d.all_branches ? dbAll('SELECT id, name FROM branches WHERE COALESCE(is_active,1)!=0') :
    dbAll(`SELECT b.id, b.name FROM delivery_driver_branches db JOIN branches b ON b.id=db.branch_id WHERE db.driver_id=?`, [id]);
  return { ...d, branches, documents: parseJson(d.documents_json, []) };
}

function saveDriver(data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  ensureSchema();
  const id = data.id;
  let passwordHash = null;
  if (data.password) passwordHash = bcrypt.hashSync(String(data.password), 10);
  if (id) {
    const prev = dbGet('SELECT * FROM delivery_drivers WHERE id=?', [id]);
    if (!prev) throw new Error('Driver not found');
    dbRun(`UPDATE delivery_drivers SET full_name=?, phone=?, email=?, employee_id=?, vehicle_info=?,
      status=?, availability=?, all_branches=?, notes=?, updated_at=?${passwordHash ? ', password_hash=?' : ''} WHERE id=?`,
      passwordHash
        ? [data.full_name, data.phone, data.email, data.employee_id || null, data.vehicle_info || null,
          data.status || prev.status, data.availability || prev.availability, data.all_branches ? 1 : 0,
          data.notes || null, nowIso(), passwordHash, id]
        : [data.full_name, data.phone, data.email, data.employee_id || null, data.vehicle_info || null,
          data.status || prev.status, data.availability || prev.availability, data.all_branches ? 1 : 0,
          data.notes || null, nowIso(), id]);
  } else {
    const code = data.driver_code || uid('DRV');
    const r = dbRun(`INSERT INTO delivery_drivers (driver_code, full_name, phone, email, password_hash, employee_id, vehicle_info, status, availability, all_branches, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [code, data.full_name, data.phone, data.email || null, passwordHash || bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 10),
        data.employee_id || null, data.vehicle_info || null, data.status || 'active', data.availability || 'offline',
        data.all_branches ? 1 : 0, data.notes || null]);
    data.id = r.lastInsertRowid || dbGet('SELECT id FROM delivery_drivers WHERE driver_code=?', [code])?.id;
  }
  if (Array.isArray(data.branch_ids) && !data.all_branches) {
    dbRun('DELETE FROM delivery_driver_branches WHERE driver_id=?', [data.id]);
    for (const bid of data.branch_ids) {
      dbRun('INSERT OR IGNORE INTO delivery_driver_branches (driver_id, branch_id) VALUES (?,?)', [data.id, bid]);
    }
  }
  return getDriver(data.id);
}

function approveDriver(id, actor) {
  assertUserActor(actor, ['owner', 'manager', 'delivery_manager']);
  ensureSchema();
  dbRun(`UPDATE delivery_drivers SET status='active', approved_at=?, approved_by=?, updated_at=? WHERE id=?`,
    [nowIso(), actor.id, nowIso(), id]);
  return getDriver(id);
}

function rejectDriver(id, reason, actor) {
  assertUserActor(actor, ['owner', 'manager', 'delivery_manager']);
  ensureSchema();
  dbRun(`UPDATE delivery_drivers SET status='rejected', notes=?, updated_at=? WHERE id=?`, [reason || 'Rejected', nowIso(), id]);
  return getDriver(id);
}

function registerDriver(data) {
  ensureSchema();
  const settings = getSettings();
  const existing = dbGet('SELECT id FROM delivery_drivers WHERE lower(phone)=lower(?) OR lower(email)=lower(?)',
    [data.phone || '', data.email || '']);
  if (existing) throw new Error('A driver with this phone or email already exists');
  const hash = bcrypt.hashSync(String(data.password || crypto.randomBytes(8).toString('hex')), 10);
  const code = uid('DRV');
  const r = dbRun(`INSERT INTO delivery_drivers (driver_code, full_name, phone, email, password_hash, id_number, address, vehicle_info, documents_json, status)
    VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
    [code, data.full_name, data.phone, data.email || null, hash, data.id_number || null, data.address || null,
      data.vehicle_info || null, JSON.stringify(data.documents || [])]);
  const insertId = r.lastInsertRowid || dbGet('SELECT id FROM delivery_drivers WHERE driver_code=?', [code])?.id;
  notifyDelivery('admin', { type: 'driver_registration', title: 'New driver registration', body: `${data.full_name} — pending approval` });
  return { id: insertId, driver_code: code, status: 'pending' };
}

function resolveDriverSession(token) {
  ensureSchema();
  if (!token) throw new Error('Not authenticated');
  const row = dbGet(`SELECT s.*, d.*, s.id AS session_id, d.id AS driver_id
    FROM delivery_driver_sessions s JOIN delivery_drivers d ON d.id=s.driver_id
    WHERE s.token_hash=? AND s.expires_at > ? AND d.status='active'`, [hashToken(token), nowIso()]);
  if (!row) throw new Error('Session expired');
  if (row.status !== 'active') throw new Error('Driver account is not active');
  return { driver: row, token };
}

function driverLogin(username, password, deviceInfo = {}) {
  ensureSchema();
  const id = String(username || '').trim();
  const driver = dbGet(`SELECT * FROM delivery_drivers WHERE (lower(phone)=lower(?) OR lower(email)=lower(?) OR lower(driver_code)=lower(?)) AND status='active'`, [id, id, id]);
  if (!driver || !bcrypt.compareSync(String(password), driver.password_hash)) throw new Error('Invalid credentials');
  if (driver.status !== 'active') throw new Error('Your driver account is not approved yet');
  const token = newToken();
  dbRun(`INSERT INTO delivery_driver_sessions (driver_id, token_hash, device_uid, device_name, platform, expires_at) VALUES (?,?,?,?,?,?)`,
    [driver.id, hashToken(token), deviceInfo.device_uid || null, deviceInfo.device_name || 'Driver App', deviceInfo.platform || 'web', nowPlusDays(30)]);
  dbRun('UPDATE delivery_drivers SET last_login_at=?, availability=?, updated_at=? WHERE id=?', [nowIso(), 'online', nowIso(), driver.id]);
  return { token, driver: { id: driver.id, full_name: driver.full_name, driver_code: driver.driver_code, availability: 'online' } };
}

function driverLogout(token) {
  try { dbRun('DELETE FROM delivery_driver_sessions WHERE token_hash=?', [hashToken(token)]); } catch (_) { /* */ }
  return { success: true };
}

function setDriverAvailability(token, availability) {
  const { driver } = resolveDriverSession(token);
  const allowed = ['online', 'offline', 'busy'];
  if (!allowed.includes(availability)) throw new Error('Invalid availability');
  dbRun('UPDATE delivery_drivers SET availability=?, updated_at=? WHERE id=?', [availability, nowIso(), driver.driver_id || driver.id]);
  return { availability };
}

function driverDashboard(token) {
  const { driver } = resolveDriverSession(token);
  const did = driver.driver_id || driver.id;
  const today = nowIso().slice(0, 10);
  const assigned = dbAll(`SELECT * FROM delivery_assignments WHERE driver_id=? AND status NOT IN ('delivered','cancelled','failed','returned') ORDER BY created_at DESC`, [did]).map(formatRow);
  const completedToday = dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE driver_id=? AND status='delivered' AND date(delivered_at)=date(?)`, [did, today])?.c || 0;
  const feesToday = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s FROM delivery_assignments WHERE driver_id=? AND status='delivered' AND date(delivered_at)=date(?)`, [did, today])?.s || 0;
  return {
    driver: { id: did, full_name: driver.full_name, availability: driver.availability, status: driver.status },
    assigned_count: assigned.length,
    active: assigned[0] || null,
    assigned,
    completed_today: completedToday,
    fees_today: Number(feesToday) || 0
  };
}

function driverListOrders(token, filters = {}) {
  const { driver } = resolveDriverSession(token);
  const did = driver.driver_id || driver.id;
  return listDeliveries({ ...filters, driver_id: did });
}

function assignDriver(assignmentId, driverId, actor, opts = {}) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
  ensureSchema();
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [assignmentId]);
  if (!row) throw new Error('Delivery not found');
  const driver = dbGet(`SELECT * FROM delivery_drivers WHERE id=? AND status='active'`, [driverId]);
  if (!driver) throw new Error('Active driver not found');
  const prev = row.status;
  dbRun(`UPDATE delivery_assignments SET driver_id=?, driver_name=?, driver_employee_id=?, status='assigned',
    assignment_mode=?, assigned_at=?, updated_at=? WHERE id=?`,
    [driverId, driver.full_name, driver.employee_id || null, opts.mode || 'manual', nowIso(), nowIso(), assignmentId]);
  recordStatus(assignmentId, prev, 'assigned', { type: 'admin', id: actor.id, name: actor.full_name }, `Assigned to ${driver.full_name}`);
  notifyDelivery('admin', { type: 'driver_assigned', title: 'Driver assigned', body: `${row.order_number} → ${driver.full_name}` });
  return formatRow(dbGet('SELECT * FROM delivery_assignments WHERE id=?', [assignmentId]));
}

function autoAssignDriver(assignmentId, actor = {}) {
  ensureSchema();
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [assignmentId]);
  if (!row) throw new Error('Delivery not found');
  const drivers = listDrivers({ branch_id: row.branch_id, status: 'active', availability: 'online' });
  if (!drivers.length) {
    dbRun(`UPDATE delivery_assignments SET status='awaiting_driver', updated_at=? WHERE id=?`, [nowIso(), assignmentId]);
    return formatRow(dbGet('SELECT * FROM delivery_assignments WHERE id=?', [assignmentId]));
  }
  const workloads = drivers.map((d) => {
    const active = dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE driver_id=? AND status IN ('assigned','driver_accepted','picked_up','on_way')`, [d.id])?.c || 0;
    return { ...d, active };
  }).sort((a, b) => a.active - b.active);
  return assignDriver(assignmentId, workloads[0].id, { id: 0, role: 'system', full_name: 'Auto Assign' }, { mode: 'auto' });
}

function driverAcceptDelivery(token, deliveryId) {
  const { driver } = resolveDriverSession(token);
  const did = driver.driver_id || driver.id;
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=? AND driver_id=?', [deliveryId, did]);
  if (!row) throw new Error('Delivery not assigned to you');
  dbRun(`UPDATE delivery_assignments SET status='driver_accepted', driver_accepted_at=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), deliveryId]);
  recordStatus(deliveryId, row.status, 'driver_accepted', { type: 'driver', id: did, name: driver.full_name });
  return formatRow(dbGet('SELECT * FROM delivery_assignments WHERE id=?', [deliveryId]));
}

function driverRejectDelivery(token, deliveryId, reason) {
  const { driver } = resolveDriverSession(token);
  const did = driver.driver_id || driver.id;
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=? AND driver_id=?', [deliveryId, did]);
  if (!row) throw new Error('Delivery not assigned to you');
  dbRun(`UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, failed_reason=?, updated_at=? WHERE id=?`,
    [reason || 'Driver rejected', nowIso(), deliveryId]);
  recordStatus(deliveryId, row.status, 'awaiting_driver', { type: 'driver', id: did, name: driver.full_name }, reason);
  return formatRow(dbGet('SELECT * FROM delivery_assignments WHERE id=?', [deliveryId]));
}

function driverUpdateStatus(token, deliveryId, status, opts = {}) {
  const { driver } = resolveDriverSession(token);
  const did = driver.driver_id || driver.id;
  const allowed = ['picked_up', 'on_way', 'delivered', 'failed'];
  if (!allowed.includes(status)) throw new Error('Invalid status');
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=? AND driver_id=?', [deliveryId, did]);
  if (!row) throw new Error('Delivery not found');
  const ts = nowIso();
  const extra = status === 'picked_up' ? ', picked_up_at=?' : status === 'on_way' ? ', on_way_at=?' : status === 'delivered' ? ', delivered_at=?' : '';
  const params = status === 'delivered'
    ? [status, opts.notes || null, ts, ts, deliveryId]
    : status === 'failed'
      ? [status, opts.reason || opts.notes || 'Failed', ts, deliveryId]
      : [status, opts.notes || null, ts, deliveryId];
  if (status === 'picked_up') {
    dbRun(`UPDATE delivery_assignments SET status=?, notes=COALESCE(?,notes), picked_up_at=?, updated_at=? WHERE id=?`, [status, opts.notes || null, ts, ts, deliveryId]);
  } else if (status === 'on_way') {
    dbRun(`UPDATE delivery_assignments SET status=?, notes=COALESCE(?,notes), on_way_at=?, updated_at=? WHERE id=?`, [status, opts.notes || null, ts, ts, deliveryId]);
  } else if (status === 'delivered') {
    dbRun(`UPDATE delivery_assignments SET status=?, notes=COALESCE(?,notes), delivered_at=?, updated_at=? WHERE id=?`, [status, opts.notes || null, ts, ts, deliveryId]);
    dbRun('UPDATE delivery_drivers SET total_deliveries=total_deliveries+1, updated_at=? WHERE id=?', [ts, did]);
  } else {
    dbRun(`UPDATE delivery_assignments SET status=?, failed_reason=?, updated_at=? WHERE id=?`, [status, opts.reason || opts.notes, ts, deliveryId]);
    dbRun('UPDATE delivery_drivers SET failed_deliveries=failed_deliveries+1, updated_at=? WHERE id=?', [ts, did]);
  }
  recordStatus(deliveryId, row.status, status, { type: 'driver', id: did, name: driver.full_name }, opts.notes || opts.reason);
  return formatRow(dbGet('SELECT * FROM delivery_assignments WHERE id=?', [deliveryId]));
}

function updateDeliveryStatus(assignmentId, status, actor, opts = {}) {
  if (actor) assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier', 'delivery_manager']);
  ensureSchema();
  if (!STATUSES.includes(status)) throw new Error('Invalid delivery status');
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [assignmentId]);
  if (!row) throw new Error('Delivery not found');
  const deliveredAt = status === 'delivered' ? nowIso() : row.delivered_at;
  dbRun(`UPDATE delivery_assignments SET status=?, notes=COALESCE(?, notes), failed_reason=?, delivered_at=?, updated_at=? WHERE id=?`,
    [status, opts.notes || null, opts.reason || null, deliveredAt, nowIso(), assignmentId]);
  recordStatus(assignmentId, row.status, status, { type: 'admin', id: actor?.id, name: actor?.full_name }, opts.notes);
  return formatRow(dbGet('SELECT * FROM delivery_assignments WHERE id=?', [assignmentId]));
}

function deliveryDashboard(filters = {}, actor = null) {
  if (actor) assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
  ensureSchema();
  const today = nowIso().slice(0, 10);
  const stats = dbGet(`SELECT
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status IN ('awaiting_driver','assigned','driver_accepted') THEN 1 ELSE 0 END) AS waiting,
    SUM(CASE WHEN status IN ('picked_up','on_way') THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status='delivered' AND date(delivered_at)=date(?) THEN 1 ELSE 0 END) AS delivered_today,
    SUM(CASE WHEN status IN ('failed','cancelled') AND date(updated_at)=date(?) THEN 1 ELSE 0 END) AS problems_today,
    COALESCE(SUM(CASE WHEN status='delivered' AND date(delivered_at)=date(?) THEN delivery_fee ELSE 0 END),0) AS fees_today
    FROM delivery_assignments`, [today, today, today]) || {};
  const recent = listDeliveries({ limit: 20 }, actor);
  const drivers = listDrivers({ status: 'active' });
  return {
    stats: {
      pending: Number(stats.pending) || 0,
      waiting: Number(stats.waiting) || 0,
      active: Number(stats.active) || 0,
      delivered_today: Number(stats.delivered_today) || 0,
      problems_today: Number(stats.problems_today) || 0,
      fees_today: Number(stats.fees_today) || 0
    },
    recent,
    drivers_online: drivers.filter((d) => d.availability === 'online').length,
    drivers_total: drivers.length,
    settings: getSettings()
  };
}

function deliveryReports(filters = {}, actor = null) {
  if (actor) assertUserActor(actor, ['owner', 'manager', 'delivery_manager']);
  ensureSchema();
  const period = filters.period || 'today';
  const today = new Date();
  let from = today.toISOString().slice(0, 10);
  if (period === 'week') {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    from = d.toISOString().slice(0, 10);
  } else if (period === 'month') {
    from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  }
  const rows = dbAll(`SELECT status, COUNT(*) AS count, COALESCE(SUM(delivery_fee),0) AS fees, branch_id
    FROM delivery_assignments WHERE date(created_at) >= date(?) GROUP BY status, branch_id`, [from]);
  const byDriver = dbAll(`SELECT driver_id, driver_name, COUNT(*) AS deliveries,
    SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status IN ('failed','cancelled') THEN 1 ELSE 0 END) AS problems
    FROM delivery_assignments WHERE date(created_at) >= date(?) AND driver_id IS NOT NULL GROUP BY driver_id, driver_name`, [from]);
  return { period, from, by_status: rows, by_driver: byDriver };
}

// Backward compat — listDrivers for employees
function listEmployeeDrivers() {
  try {
    return dbAll(`SELECT id, full_name, phone FROM employees WHERE COALESCE(status, 'active') = 'active' ORDER BY full_name`);
  } catch (_) {
    try { return dbAll(`SELECT id, full_name, phone FROM employees WHERE is_active = 1 ORDER BY full_name`); } catch (__) { return []; }
  }
}

module.exports = {
  ensureSchema, STATUSES,
  getSettings, saveSettings, getBranchSettings, saveBranchSettings,
  upsertFromSale, upsertFromOnlineOrder, createDeliveryFromSource,
  listDeliveries, getDelivery, getDeliveryByTracking, deliveryDashboard, deliveryReports,
  assignDriver, autoAssignDriver, updateDeliveryStatus,
  listDrivers, getDriver, saveDriver, approveDriver, rejectDriver, registerDriver,
  driverLogin, driverLogout, resolveDriverSession, setDriverAvailability,
  driverDashboard, driverListOrders, driverAcceptDelivery, driverRejectDelivery, driverUpdateStatus,
  listEmployeeDrivers
};
