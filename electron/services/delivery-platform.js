/** Delivery platform — restored after disk recovery */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function todayLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseJson(v, fb) { try { return v ? JSON.parse(v) : fb; } catch (_) { return fb; } }

function ensureSchema() {
  const fs = require('fs');
  const path = require('path');
  const pgDb = require('../database/pg-db');
  const runPgMig = (file) => {
    const mig = path.join(__dirname, '../../supabase/migrations', file);
    if (!fs.existsSync(mig)) return;
    try {
      const { splitSqlStatements } = require('../database/ensure-pg-schema');
      const sql = fs.readFileSync(mig, 'utf8');
      for (const stmt of splitSqlStatements(sql)) {
        try { getDb().exec(stmt); } catch (e) {
          if (!/already exists|duplicate column/i.test(String(e.message || e))) {
            console.warn('[delivery] PG schema:', String(e.message || e).slice(0, 120));
          }
        }
      }
    } catch (e) {
      console.warn('[delivery] ensureSchema PG:', e.message || e);
    }
  };
  if (pgDb.isPgMode()) {
    runPgMig('20260905_driver_payouts_online_tracking.sql');
    runPgMig('20260905_driver_claims_profile.sql');
    runPgMig('20260907_driver_payout_schedule.sql');
    runPgMig('20260907_driver_payout_details.sql');
    backfillZeroDeliveryFees();
    return;
  }
  for (const f of ['migrations-v83.sql', 'migrations-v84.sql', 'migrations-v88-delivery.sql', 'migrations-v89-driver-payouts.sql', 'migrations-v90-driver-claims.sql', 'migrations-v95-driver-payout-schedule.sql', 'migrations-v96-driver-payout-details.sql']) {
    const mig = path.join(__dirname, '../database', f);
    if (fs.existsSync(mig)) {
      try { getDb().exec(fs.readFileSync(mig, 'utf8')); } catch (_) { /* columns may exist */ }
    }
  }
  backfillZeroDeliveryFees();
}

function backfillZeroDeliveryFees() {
  try {
    dbRun(`UPDATE delivery_assignments SET delivery_fee = (
      SELECT COALESCE(dbs.delivery_fee, 0) FROM delivery_branch_settings dbs WHERE dbs.branch_id = delivery_assignments.branch_id
    ) WHERE COALESCE(delivery_fee, 0) = 0 AND branch_id IS NOT NULL AND driver_id IS NOT NULL
      AND status IN ('delivered','assigned','driver_accepted','picked_up','on_way','awaiting_driver')`);
  } catch (_) { /* optional */ }
}

function ensureAssignmentFee(row) {
  if (!row || Number(row.delivery_fee) > 0) return Number(row.delivery_fee) || 0;
  const fee = branchFee(row.branch_id);
  if (fee > 0) {
    dbRun('UPDATE delivery_assignments SET delivery_fee=?, updated_at=? WHERE id=?', [fee, nowIso(), row.id]);
    return fee;
  }
  return 0;
}

function driverDocs() {
  try { return require('../../lib/driver-documents'); } catch (_) { return null; }
}

function enrichDriver(d, opts = {}) {
  if (!d) return null;
  const docs = parseJson(d.documents_json, {});
  const dd = driverDocs();
  const urls = dd ? dd.driverDocumentUrls({ ...d, documents_json: docs }) : {};
  const reg = d.vehicle_registration || docs.vehicle_registration || null;
  return {
    ...d,
    documents: docs,
    vehicle_registration: reg,
    profile_photo_url: urls.selfie || (d.profile_photo_path ? `/api/driver-doc/${d.id}/selfie` : null),
    document_urls: urls,
    ...(opts.admin ? {
      bank_details: {
        bank_name: d.bank_name || null,
        bank_account: d.bank_account || null,
        bank_branch_code: d.bank_branch_code || null
      }
    } : {})
  };
}

function driverPublicInfo(driverId) {
  if (!driverId) return null;
  const d = enrichDriver(getDriver(driverId));
  if (!d) return null;
  return {
    id: d.id,
    name: d.full_name,
    phone: d.phone,
    vehicle_registration: d.vehicle_registration,
    vehicle_info: d.vehicle_info,
    photo_url: d.profile_photo_url
  };
}

function driverPayoutDayOfWeek(driverOrId) {
  let driver = driverOrId;
  if (driverOrId != null && typeof driverOrId !== 'object') {
    driver = dbGet('SELECT payout_day_of_week FROM delivery_drivers WHERE id=?', [driverOrId]);
  }
  if (driver?.payout_day_of_week != null && driver.payout_day_of_week !== '') {
    const n = Number(driver.payout_day_of_week);
    if (!Number.isNaN(n)) return n;
  }
  const settings = getSettings();
  const globalDay = settings.payout_day_of_week;
  if (globalDay == null || globalDay === '') return null;
  const n = Number(globalDay);
  return Number.isNaN(n) ? null : n;
}

function isClaimWindowOpen(driverOrId) {
  const payoutDay = driverPayoutDayOfWeek(driverOrId);
  if (payoutDay == null) return true;
  const today = new Date().getDay();
  const daysUntil = (payoutDay - today + 7) % 7;
  return daysUntil <= 1;
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
    receipt_number: row.receipt_number || null,
    assigned_at: row.assigned_at, picked_up_at: row.picked_up_at, on_way_at: row.on_way_at,
    delivered_at: row.delivered_at, created_at: row.created_at, updated_at: row.updated_at
  };
  if (opts.admin) {
    out.total = Number(row.total) || 0;
    out.items = items;
    out.sale_id = row.sale_id;
    if (row.driver_id) out.driver = driverPublicInfo(row.driver_id);
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
    const whatsapp = require('./whatsapp');
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
    void whatsapp.sendMessage(
      { phone, body, template_key: `delivery_${event}`, message_type: 'delivery_update' },
      { id: 0, role: 'system' }
    ).catch((err) => {
      console.warn('[delivery] notifyCustomer:', err?.message || err);
    });
  } catch (err) {
    console.warn('[delivery] notifyCustomer:', err?.message || err);
  }
}

function upsertDelivery(data) {
  ensureSchema();
  const existing = dbGet('SELECT * FROM delivery_assignments WHERE source_type=? AND source_id=?', [data.source_type, data.source_id]);
  const fee = Number(data.delivery_fee) || branchFee(data.branch_id) || 0;
  if (existing) {
    dbRun(`UPDATE delivery_assignments SET order_number=?, branch_id=?, sale_id=?, delivery_address=?, customer_name=?,
      customer_phone=?, total=?, delivery_fee=?, payment_method=?, special_instructions=?, items_json=?, source_label=?,
      confirmation_code=COALESCE(?, confirmation_code), tracking_token=COALESCE(?, tracking_token), updated_at=?
      WHERE id=?`, [
      data.order_number || existing.order_number, data.branch_id || existing.branch_id, data.sale_id || existing.sale_id,
      data.delivery_address || existing.delivery_address, data.customer_name || existing.customer_name,
      data.customer_phone || existing.customer_phone, data.total ?? existing.total, fee,
      data.payment_method || existing.payment_method, data.special_instructions || existing.special_instructions,
      JSON.stringify(data.items || parseJson(existing.items_json, [])), data.source_label || existing.source_label,
      data.confirmation_code || null, data.tracking_token || null,
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
  if (data.source_type !== 'online_order') {
    releaseToDriverPoolIfAuto(r.lastInsertRowid);
  }
  return getDelivery(r.lastInsertRowid);
}

function releaseToDriverPoolIfAuto(deliveryId) {
  const settings = getSettings();
  if (settings.default_assignment_mode !== 'auto') return;
  dbRun("UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, updated_at=? WHERE id=? AND driver_id IS NULL", [nowIso(), deliveryId]);
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [deliveryId]);
  if (row?.status === 'awaiting_driver') notifyOnlineDriversPoolOrder(row);
}

function releaseToDriverPool(id, actor) {
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
  if (!row) throw new Error('Delivery not found');
  dbRun("UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, updated_at=? WHERE id=?", [nowIso(), id]);
  recordHistory(id, row.status, 'awaiting_driver', actor, 'Released to driver pool');
  notifyOnlineDriversPoolOrder(row);
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
  const where = [];
  const params = [];
  if (filters.history) {
    where.push("da.status IN ('delivered','failed','cancelled')");
  } else if (filters.active) {
    where.push("da.status NOT IN ('delivered','failed','cancelled')");
  } else if (!filters.status && !filters.include_cancelled) {
    where.push("da.status NOT IN ('cancelled')");
  }
  if (filters.status) { where.push('da.status=?'); params.push(filters.status); }
  if (filters.branch_id) { where.push('da.branch_id=?'); params.push(filters.branch_id); }
  where.push("(da.source_type IN ('sale','online_order') AND (da.delivery_address IS NOT NULL AND da.delivery_address != ''))");
  const limit = Math.min(Number(filters.limit) || 100, 500);
  const rows = dbAll(`SELECT da.*, b.name AS branch_name, s.receipt_number FROM delivery_assignments da
    LEFT JOIN branches b ON b.id = da.branch_id
    LEFT JOIN sales s ON s.id = da.sale_id
    WHERE ${where.join(' AND ')} ORDER BY da.id DESC LIMIT ${limit}`, params);
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
    delivered_today: dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE status='delivered' AND date(COALESCE(delivered_at, updated_at))=date(?)${b}`, [todayLocalDate(), ...p])?.c || 0,
    fees_today: dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s FROM delivery_assignments WHERE status='delivered' AND date(COALESCE(delivered_at, updated_at))=date(?)${b}`, [todayLocalDate(), ...p])?.s || 0
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
    return enrichDriver(d, { admin: true });
  });
}

function getDriver(id) {
  const d = dbGet('SELECT * FROM delivery_drivers WHERE id=?', [id]);
  if (!d) return null;
  d.branches = dbAll('SELECT branch_id FROM delivery_driver_branches WHERE driver_id=?', [id]).map((r) => r.branch_id);
  return enrichDriver(d, { admin: true });
}

function saveDriver(data, actor) {
  ensureSchema();
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const branches = Array.isArray(data.branches) ? data.branches : [];
  if (data.id) {
    const existing = dbGet('SELECT * FROM delivery_drivers WHERE id=?', [data.id]);
    if (!existing) throw new Error('Driver not found');
    const status = data.status != null ? data.status : existing.status;
    const payoutDay = data.payout_day_of_week !== undefined
      ? (data.payout_day_of_week === '' || data.payout_day_of_week == null ? null : Number(data.payout_day_of_week))
      : existing.payout_day_of_week;
    const params = [
      data.full_name, data.phone, data.email || null, data.vehicle_info || null,
      data.vehicle_registration != null ? String(data.vehicle_registration).trim() || null : existing.vehicle_registration,
      data.id_number != null ? String(data.id_number).trim() || null : existing.id_number,
      data.address != null ? String(data.address).trim() || null : existing.address,
      data.notes != null ? data.notes : existing.notes,
      data.all_branches ? 1 : 0,
      data.bank_name != null ? data.bank_name : null,
      data.bank_account != null ? data.bank_account : null,
      data.bank_branch_code != null ? data.bank_branch_code : null,
      payoutDay != null && !Number.isNaN(payoutDay) ? payoutDay : null,
      status, nowIso(), data.id
    ];
    let sql = `UPDATE delivery_drivers SET full_name=?, phone=?, email=?, vehicle_info=?, vehicle_registration=?, id_number=?, address=?, notes=?, all_branches=?,
      bank_name=COALESCE(?, bank_name), bank_account=COALESCE(?, bank_account), bank_branch_code=COALESCE(?, bank_branch_code),
      payout_day_of_week=?, status=?, updated_at=?`;
    if (data.password) {
      sql += ', password_hash=?';
      params.splice(params.length - 1, 0, bcrypt.hashSync(data.password, 10));
    }
    sql += ' WHERE id=?';
    dbRun(sql, params);
    dbRun('DELETE FROM delivery_driver_branches WHERE driver_id=?', [data.id]);
    branches.forEach((bid) => dbRun('INSERT OR IGNORE INTO delivery_driver_branches (driver_id, branch_id) VALUES (?,?)', [data.id, bid]));
    return applyDriverDocuments(data.id, data);
  }
  const code = data.driver_code || `DRV${Date.now().toString(36).toUpperCase()}`;
  const hash = data.password ? bcrypt.hashSync(data.password, 10) : null;
  const r = dbRun(`INSERT INTO delivery_drivers (driver_code, full_name, phone, email, password_hash, id_number, address, vehicle_info, vehicle_registration, bank_name, bank_account, bank_branch_code, status, all_branches, documents_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, '[]')`, [
    code, data.full_name, data.phone, data.email || null, hash,
    data.id_number ? String(data.id_number).trim() || null : null,
    data.address ? String(data.address).trim() || null : null,
    data.vehicle_info || null,
    data.vehicle_registration ? String(data.vehicle_registration).trim() || null : null,
    data.bank_name || null, data.bank_account || null, data.bank_branch_code || null,
    data.status || 'active', data.all_branches ? 1 : 0
  ]);
  const id = r.lastInsertRowid;
  branches.forEach((bid) => dbRun('INSERT OR IGNORE INTO delivery_driver_branches (driver_id, branch_id) VALUES (?,?)', [id, bid]));
  return applyDriverDocuments(id, data);
}

function applyDriverDocuments(driverId, data) {
  const dd = driverDocs();
  if (dd && driverId && (data.selfie || data.id_photo || data.vehicle_photos?.length)) {
    const saved = dd.saveRegistrationDocuments(driverId, data);
    dbRun('UPDATE delivery_drivers SET documents_json=?, profile_photo_path=? WHERE id=?', [
      JSON.stringify(saved.meta), saved.profile_photo_path, driverId
    ]);
  }
  return getDriver(driverId);
}

function registerDriver(data, opts = {}) {
  ensureSchema();
  const phone = String(data.phone || '').trim();
  if (phone) {
    const existing = dbGet('SELECT * FROM delivery_drivers WHERE phone=? ORDER BY id DESC LIMIT 1', [phone]);
    if (existing) {
      if (existing.status === 'active' && !opts.allowResubmit) {
        throw new Error('A driver with this phone number is already registered.');
      }
      if (['pending', 'rejected', 'suspended'].includes(existing.status) || opts.allowResubmit) {
        const hash = data.password ? bcrypt.hashSync(data.password, 10) : existing.password_hash;
        const vehicleReg = String(data.vehicle_registration || '').trim() || existing.vehicle_registration || null;
        dbRun(`UPDATE delivery_drivers SET full_name=?, phone=?, email=?, password_hash=?, id_number=?, address=?, vehicle_info=?, vehicle_registration=?,
          bank_name=?, bank_account=?, bank_branch_code=?, status='pending', notes=NULL, updated_at=? WHERE id=?`, [
          data.full_name || existing.full_name, phone, data.email || existing.email || null, hash,
          data.id_number || existing.id_number || null, data.address || existing.address || null,
          data.vehicle_info || existing.vehicle_info || null, vehicleReg,
          data.bank_name || existing.bank_name || null, data.bank_account || existing.bank_account || null,
          data.bank_branch_code || existing.bank_branch_code || null, nowIso(), existing.id
        ]);
        return applyDriverDocuments(existing.id, data);
      }
    }
  }
  const code = `DRV${Date.now().toString(36).toUpperCase()}`;
  const hash = bcrypt.hashSync(data.password || 'driver123', 10);
  const vehicleReg = String(data.vehicle_registration || '').trim() || null;
  const r = dbRun(`INSERT INTO delivery_drivers (driver_code, full_name, phone, email, password_hash, id_number, address, vehicle_info, vehicle_registration, bank_name, bank_account, bank_branch_code, documents_json, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`, [
    code, data.full_name, data.phone, data.email || null, hash, data.id_number || null, data.address || null,
    data.vehicle_info || null, vehicleReg, data.bank_name || null, data.bank_account || null, data.bank_branch_code || null, '[]'
  ]);
  const insertId = r.lastInsertRowid || dbGet('SELECT id FROM delivery_drivers WHERE driver_code=?', [code])?.id;
  return applyDriverDocuments(insertId, data);
}

function adminRegisterDriver(data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const branches = Array.isArray(data.branches) ? data.branches : [];
  const autoApprove = !!data.auto_approve;
  const driver = registerDriver(data, { allowResubmit: true });
  if (autoApprove) approveDriver(driver.id, actor);
  if (branches.length || data.all_branches) {
    dbRun('UPDATE delivery_drivers SET all_branches=? WHERE id=?', [data.all_branches ? 1 : 0, driver.id]);
    dbRun('DELETE FROM delivery_driver_branches WHERE driver_id=?', [driver.id]);
    branches.forEach((bid) => dbRun('INSERT OR IGNORE INTO delivery_driver_branches (driver_id, branch_id) VALUES (?,?)', [driver.id, bid]));
  }
  return getDriver(driver.id);
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
  notifyDriverAssigned(driver, { ...row, delivery_fee: fee, confirmation_code: row.confirmation_code });
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
  if (status === 'delivered' && row.driver_id) ensureAssignmentFee(row);
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

function updateDeliveryAdmin(id, data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
  if (!row) throw new Error('Delivery not found');
  dbRun(`UPDATE delivery_assignments SET
    delivery_fee=COALESCE(?, delivery_fee),
    delivery_address=COALESCE(?, delivery_address),
    customer_name=COALESCE(?, customer_name),
    customer_phone=COALESCE(?, customer_phone),
    special_instructions=COALESCE(?, special_instructions),
    total=COALESCE(?, total),
    updated_at=? WHERE id=?`, [
    data.delivery_fee != null ? Number(data.delivery_fee) : null,
    data.delivery_address != null ? String(data.delivery_address) : null,
    data.customer_name != null ? String(data.customer_name) : null,
    data.customer_phone != null ? String(data.customer_phone) : null,
    data.notes != null ? String(data.notes) : null,
    data.total != null ? Number(data.total) : null,
    nowIso(), id
  ]);
  recordHistory(id, row.status, row.status, actor, 'Admin updated delivery');
  return getDelivery(id);
}

function cancelDeliveryAdmin(id, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  return updateDeliveryStatus(id, 'cancelled', actor, { notes: 'Cancelled by admin' });
}

function ensureDeliverySettingsRow() {
  try {
    dbRun(`INSERT OR IGNORE INTO delivery_settings (id, department_mode, default_assignment_mode, payout_cycle_days) VALUES (1, 'per_branch', 'manual', 7)`);
  } catch (_) { /* row may exist */ }
}

function normalizeSettingsInput(data = {}) {
  const out = { ...data };
  if (out.payout_day_of_week === '' || out.payout_day_of_week == null) {
    out.payout_day_of_week = null;
  } else {
    const n = Number(out.payout_day_of_week);
    out.payout_day_of_week = Number.isNaN(n) ? null : n;
  }
  const cycle = Number(out.payout_cycle_days);
  out.payout_cycle_days = Number.isNaN(cycle) ? 7 : Math.max(1, Math.min(90, cycle));
  out.department_mode = out.department_mode === 'central' ? 'central' : 'per_branch';
  out.default_assignment_mode = out.default_assignment_mode === 'auto' ? 'auto' : 'manual';
  return out;
}

function deliverySettingsForDriver(driver) {
  const s = getSettings();
  const payoutDay = driverPayoutDayOfWeek(driver);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    department_mode: s.department_mode || 'per_branch',
    assignment_mode: s.default_assignment_mode || 'manual',
    payout_cycle_days: Number(s.payout_cycle_days) || 7,
    payout_day_of_week: payoutDay,
    payout_day_label: payoutDay != null ? dayNames[payoutDay] : null,
    claim_window_open: isClaimWindowOpen(driver)
  };
}

function getSettings() {
  ensureSchema();
  ensureDeliverySettingsRow();
  return dbGet('SELECT * FROM delivery_settings WHERE id=1') || {
    id: 1,
    department_mode: 'per_branch',
    default_assignment_mode: 'manual',
    payout_cycle_days: 7,
    payout_day_of_week: null
  };
}

function saveSettings(data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'delivery_manager']);
  ensureSchema();
  ensureDeliverySettingsRow();
  const d = normalizeSettingsInput(data);
  const existing = getSettings();
  dbRun(`UPDATE delivery_settings SET department_mode=?, default_assignment_mode=?, auto_assign_radius_km=?,
    payout_cycle_days=?, payout_day_of_week=?, updated_at=? WHERE id=1`, [
    d.department_mode,
    d.default_assignment_mode,
    d.auto_assign_radius_km != null ? Number(d.auto_assign_radius_km) : (Number(existing.auto_assign_radius_km) || 15),
    d.payout_cycle_days,
    d.payout_day_of_week,
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
  if (row.driver_id) pub.driver = driverPublicInfo(row.driver_id);
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
  if (getSettings().default_assignment_mode !== 'auto') return [];
  const settings = getSettings();
  let sql = `SELECT da.* FROM delivery_assignments da
    LEFT JOIN online_orders_local o ON da.source_type='online_order' AND da.source_id=o.id
    WHERE da.status='awaiting_driver' AND da.driver_id IS NULL
      AND (da.source_type != 'online_order' OR o.status IN ('accepted','completed') OR da.sale_id IS NOT NULL)`;
  const params = [];
  if (settings.department_mode !== 'central') {
    const branchIds = driverBranchIds(driver);
    if (!branchIds.length) return [];
    sql += ` AND da.branch_id IN (${branchIds.map(() => '?').join(',')})`;
    params.push(...branchIds);
  }
  sql += ' ORDER BY da.id ASC';
  return dbAll(sql, params).map((r) => formatRow(r, { driver: true }));
}

function getDeliveryByOnlineOrder(onlineOrderId) {
  ensureSchema();
  return dbGet('SELECT * FROM delivery_assignments WHERE source_type=? AND source_id=?', ['online_order', onlineOrderId]);
}

/** After POS accepts an online delivery order, release to driver pool. */
function releaseOnlineDeliveryAfterPosAccept(onlineOrderId, saleId) {
  ensureSchema();
  const row = getDeliveryByOnlineOrder(onlineOrderId);
  if (!row) return null;
  if (saleId) {
    dbRun('UPDATE delivery_assignments SET sale_id=?, updated_at=? WHERE id=?', [saleId, nowIso(), row.id]);
  }
  if (getSettings().default_assignment_mode !== 'auto') {
    return getDelivery(row.id);
  }
  if (row.status === 'pending' || row.status === 'assigned') {
    dbRun("UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, updated_at=? WHERE id=?", [nowIso(), row.id]);
    recordHistory(row.id, row.status, 'awaiting_driver', { type: 'system', role: 'system', full_name: 'POS accept' }, 'Released after POS accepted online order');
  } else if (row.status !== 'awaiting_driver') {
    releaseToDriverPoolIfAuto(row.id);
  }
  return getDelivery(row.id);
}

function driverDashboard(token) {
  const driver = driverFromToken(token);
  const deptSettings = deliverySettingsForDriver(driver);
  const assignmentMode = deptSettings.assignment_mode;
  const assigned = dbAll(`SELECT da.* FROM delivery_assignments da WHERE da.driver_id=? AND da.status NOT IN ('delivered','failed','cancelled') ORDER BY da.id DESC`, [driver.id]);
  const available = assignmentMode === 'auto' && driver.availability === 'online' ? driverAvailableOrders(driver) : [];
  const today = todayLocalDate();
  const completed_today = dbGet(`SELECT COUNT(*) AS c FROM delivery_assignments WHERE driver_id=? AND status='delivered' AND date(COALESCE(delivered_at, updated_at))=date(?)`, [driver.id, today])?.c || 0;
  const fees_today = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s FROM delivery_assignments WHERE driver_id=? AND status='delivered' AND date(COALESCE(delivered_at, updated_at))=date(?)`, [driver.id, today])?.s || 0;
  const earnings_total = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s FROM delivery_assignments WHERE driver_id=? AND status='delivered'`, [driver.id])?.s || 0;
  const owed = driverOwedAmount(driver.id);
  const shop = dbGet('SELECT shop_name, logo_path FROM shop_settings WHERE id=1') || {};
  const enriched = enrichDriver(driver);
  let pendingClaim = null;
  try {
    pendingClaim = dbGet(`SELECT * FROM delivery_driver_payout_claims WHERE driver_id=? AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1`, [driver.id]);
  } catch (_) { /* table may not exist yet */ }
  const claimOpen = isClaimWindowOpen(driver);
  return {
    driver: {
      id: driver.id, full_name: driver.full_name, availability: driver.availability, phone: driver.phone,
      bank_name: driver.bank_name, bank_account: driver.bank_account, bank_branch_code: driver.bank_branch_code,
      payout_day_of_week: driver.payout_day_of_week,
      profile_photo_url: enriched.profile_photo_url,
      vehicle_registration: enriched.vehicle_registration,
      vehicle_info: driver.vehicle_info
    },
    shop_name: shop.shop_name,
    shop_logo: shop.logo_path ? '/api/logo' : null,
    assignment_mode: assignmentMode,
    department_mode: deptSettings.department_mode,
    payout_cycle_days: deptSettings.payout_cycle_days,
    payout_day_of_week: deptSettings.payout_day_of_week,
    payout_day_label: deptSettings.payout_day_label,
    delivery_settings: deptSettings,
    assigned_count: assigned.length,
    assigned: assigned.map((r) => formatRow(r, { driver: true })),
    available: available.map((r) => formatRow(r, { driver: true })),
    completed_today, fees_today, earnings_total,
    owed_amount: owed.amount,
    owed_from: owed.from,
    owed_to: owed.to,
    claim_window_open: claimOpen,
    can_claim: claimOpen && owed.amount > 0 && !pendingClaim,
    pending_claim: pendingClaim ? {
      id: pendingClaim.id, amount: Number(pendingClaim.amount), status: pendingClaim.status,
      period_from: pendingClaim.period_from, period_to: pendingClaim.period_to,
      claimed_at: pendingClaim.claimed_at, delivery_count: pendingClaim.delivery_count
    } : null
  };
}

function lastPayoutForDriver(driverId) {
  try {
    return dbGet(`SELECT * FROM delivery_driver_payouts WHERE driver_id=? ORDER BY id DESC LIMIT 1`, [driverId]);
  } catch (e) {
    if (/does not exist|relation.*delivery_driver_payouts/i.test(String(e.message || e))) return null;
    throw e;
  }
}

function driverOwedAmount(driverId, opts = {}) {
  try {
    const to = opts.to || todayLocalDate();
    if (opts.from && opts.to) {
      const row = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s, COUNT(*) AS c FROM delivery_assignments
        WHERE driver_id=? AND status='delivered'
        AND date(COALESCE(delivered_at, updated_at)) >= date(?) AND date(COALESCE(delivered_at, updated_at)) <= date(?)`,
        [driverId, opts.from, opts.to]);
      return { amount: Number(row?.s) || 0, count: Number(row?.c) || 0, from: opts.from, to: opts.to };
    }
    const last = lastPayoutForDriver(driverId);
    let row;
    let from;
    if (last?.paid_at) {
      from = last.period_to || String(last.period_from || last.paid_at).slice(0, 10);
      row = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s, COUNT(*) AS c FROM delivery_assignments
        WHERE driver_id=? AND status='delivered' AND COALESCE(delivered_at, updated_at) > ?`,
        [driverId, last.paid_at]);
    } else {
      from = '1970-01-01';
      row = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s, COUNT(*) AS c FROM delivery_assignments
        WHERE driver_id=? AND status='delivered'`, [driverId]);
    }
    return { amount: Number(row?.s) || 0, count: Number(row?.c) || 0, from, to };
  } catch (e) {
    if (/does not exist|relation.*delivery_driver_payouts/i.test(String(e.message || e))) {
      const row = dbGet(`SELECT COALESCE(SUM(delivery_fee),0) AS s, COUNT(*) AS c FROM delivery_assignments
        WHERE driver_id=? AND status='delivered'`, [driverId]);
      return { amount: Number(row?.s) || 0, count: Number(row?.c) || 0, from: '1970-01-01', to: todayLocalDate() };
    }
    throw e;
  }
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

function driverPayments(token, filters = {}) {
  const driver = driverFromToken(token);
  let rows = [];
  try {
    let sql = `SELECT * FROM delivery_driver_payouts WHERE driver_id=?`;
    const params = [driver.id];
    if (filters.from) { sql += ` AND date(paid_at) >= date(?)`; params.push(filters.from); }
    if (filters.to) { sql += ` AND date(paid_at) <= date(?)`; params.push(filters.to); }
    sql += ` ORDER BY id DESC LIMIT 100`;
    rows = dbAll(sql, params);
  } catch (e) {
    if (!/does not exist|relation.*delivery_driver_payouts/i.test(String(e.message || e))) throw e;
  }
  const owed = driverOwedAmount(driver.id);
  let pendingClaim = null;
  try {
    pendingClaim = dbGet(`SELECT * FROM delivery_driver_payout_claims WHERE driver_id=? AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1`, [driver.id]);
  } catch (_) { /* optional */ }
  const claimOpen = isClaimWindowOpen(driver);
  return {
    payouts: rows.map(enrichPayoutRow),
    owed_amount: owed.amount,
    owed_from: owed.from,
    owed_to: owed.to,
    claim_window_open: claimOpen,
    can_claim: claimOpen && owed.amount > 0 && !pendingClaim,
    delivery_settings: deliverySettingsForDriver(driver),
    pending_claim: pendingClaim ? {
      id: pendingClaim.id, amount: Number(pendingClaim.amount), status: pendingClaim.status,
      period_from: pendingClaim.period_from, period_to: pendingClaim.period_to,
      claimed_at: pendingClaim.claimed_at, delivery_count: pendingClaim.delivery_count
    } : null
  };
}

function driverGetProfile(token) {
  const driver = driverFromToken(token);
  const enriched = enrichDriver(driver);
  return {
    id: driver.id,
    driver_code: driver.driver_code,
    full_name: driver.full_name,
    phone: driver.phone,
    email: driver.email || '',
    id_number: driver.id_number || '',
    address: driver.address || '',
    vehicle_info: driver.vehicle_info || '',
    vehicle_registration: enriched.vehicle_registration || '',
    bank_name: driver.bank_name || '',
    bank_account: driver.bank_account || '',
    bank_branch_code: driver.bank_branch_code || '',
    profile_photo_url: enriched.profile_photo_url,
    document_urls: enriched.document_urls || {},
    availability: driver.availability,
    status: driver.status
  };
}

function driverUpdateProfile(token, data = {}) {
  const driver = driverFromToken(token);
  if (data.new_password) {
    const current = String(data.current_password || '');
    if (!current || !bcrypt.compareSync(current, driver.password_hash || '')) {
      throw new Error('Current password is incorrect');
    }
    if (String(data.new_password).length < 6) throw new Error('New password must be at least 6 characters');
  }
  const fullName = data.full_name != null ? String(data.full_name).trim() : driver.full_name;
  const phone = data.phone != null ? String(data.phone).trim() : driver.phone;
  if (!fullName || !phone) throw new Error('Name and phone are required');
  dbRun(`UPDATE delivery_drivers SET full_name=?, phone=?, email=?, vehicle_info=?, vehicle_registration=?,
    id_number=?, address=?, bank_name=?, bank_account=?, bank_branch_code=?,
    password_hash=COALESCE(?, password_hash), updated_at=? WHERE id=?`, [
    fullName, phone,
    data.email != null ? String(data.email).trim() || null : driver.email,
    data.vehicle_info != null ? String(data.vehicle_info).trim() || null : driver.vehicle_info,
    data.vehicle_registration != null ? String(data.vehicle_registration).trim() || null : driver.vehicle_registration,
    data.id_number != null ? String(data.id_number).trim() || null : driver.id_number,
    data.address != null ? String(data.address).trim() || null : driver.address,
    data.bank_name != null ? String(data.bank_name).trim() || null : driver.bank_name,
    data.bank_account != null ? String(data.bank_account).trim() || null : driver.bank_account,
    data.bank_branch_code != null ? String(data.bank_branch_code).trim() || null : driver.bank_branch_code,
    data.new_password ? bcrypt.hashSync(String(data.new_password), 10) : null,
    nowIso(), driver.id
  ]);
  if (data.selfie || data.id_photo || (data.vehicle_photos && data.vehicle_photos.length)) {
    applyDriverDocuments(driver.id, data);
  }
  return driverGetProfile(token);
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

function formatPayoutDeliveryDetail(row) {
  if (!row) return null;
  const items = parseJson(row.items_json, []);
  return {
    id: row.id,
    order_number: row.order_number || row.confirmation_code || null,
    confirmation_code: row.confirmation_code || null,
    receipt_number: row.receipt_number || null,
    customer_name: row.customer_name || null,
    customer_phone: row.customer_phone || null,
    delivery_address: row.delivery_address || null,
    branch_name: row.branch_name || null,
    branch_id: row.branch_id || null,
    delivery_fee: Number(row.delivery_fee) || 0,
    order_total: Number(row.total) || 0,
    payment_method: row.payment_method || null,
    delivered_at: row.delivered_at || row.updated_at || null,
    items: items.map((i) => ({
      name: i.name || i.product_name || 'Item',
      quantity: Number(i.quantity) || 1
    }))
  };
}

function getDeliveriesForPayoutPeriod(driverId, from, to) {
  if (!from || !to) return [];
  const rows = dbAll(`SELECT da.*, b.name AS branch_name, s.receipt_number FROM delivery_assignments da
    LEFT JOIN branches b ON b.id = da.branch_id
    LEFT JOIN sales s ON s.id = da.sale_id
    WHERE da.driver_id=? AND da.status='delivered'
    AND date(COALESCE(da.delivered_at, da.updated_at)) >= date(?)
    AND date(COALESCE(da.delivered_at, da.updated_at)) <= date(?)
    ORDER BY COALESCE(da.delivered_at, da.updated_at) ASC`, [driverId, from, to]);
  return rows.map(formatPayoutDeliveryDetail).filter(Boolean);
}

function enrichPayoutRow(payout) {
  if (!payout) return null;
  const deliveries = parseJson(payout.details_json, []);
  return {
    ...payout,
    amount: Number(payout.amount) || 0,
    delivery_count: Number(payout.delivery_count) || deliveries.length || 0,
    deliveries
  };
}

function buildDriverPayoutHtml(payout, driver, shop = {}) {
  const p = enrichPayoutRow(payout);
  const deliveries = p.deliveries || [];
  const shopName = shop.shop_name || 'Delivery payment';
  const rows = deliveries.map((d, i) => {
    const items = (d.items || []).map((it) => `${it.quantity}× ${it.name}`).join(', ') || '—';
    return `<tr>
      <td>${i + 1}</td>
      <td>${d.confirmation_code || d.order_number || '—'}</td>
      <td>${d.delivered_at ? String(d.delivered_at).slice(0, 16) : '—'}</td>
      <td>${d.branch_name || '—'}</td>
      <td>${d.customer_name || '—'}</td>
      <td>${d.delivery_address || '—'}</td>
      <td>${items}</td>
      <td style="text-align:right">R${(Number(d.delivery_fee) || 0).toFixed(2)}</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Driver payment</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f4f6}
    h1{margin:0 0 8px} .muted{color:#555;font-size:13px}</style></head><body>
    <h1>${shopName}</h1>
    <p class="muted">Driver payment statement</p>
    <p><strong>Driver:</strong> ${driver?.full_name || '—'}<br>
    <strong>Phone:</strong> ${driver?.phone || '—'}<br>
    <strong>Period:</strong> ${p.period_from || '—'} → ${p.period_to || '—'}<br>
    <strong>Paid:</strong> ${p.paid_at ? String(p.paid_at).slice(0, 16) : '—'}<br>
    <strong>Paid by:</strong> ${p.paid_by_name || 'Admin'}<br>
    ${p.notes ? `<strong>Notes:</strong> ${p.notes}<br>` : ''}
    <strong>Total:</strong> R${p.amount.toFixed(2)} (${p.delivery_count} deliveries)</p>
    <table><thead><tr><th>#</th><th>Code</th><th>Completed</th><th>Branch</th><th>Customer</th><th>Address</th><th>Items</th><th>Fee</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8">No delivery lines saved</td></tr>'}</tbody>
    <tfoot><tr><td colspan="7" style="text-align:right"><strong>Total</strong></td><td style="text-align:right"><strong>R${p.amount.toFixed(2)}</strong></td></tr></tfoot></table>
    </body></html>`;
}

function buildDriverPayoutWhatsAppText(payout, driver, shop = {}) {
  const p = enrichPayoutRow(payout);
  const lines = [
    `${shop.shop_name || 'Payment'} — delivery fees paid`,
    `Driver: ${driver?.full_name || '—'}`,
    `Amount: R${p.amount.toFixed(2)}`,
    `Period: ${p.period_from || '—'} → ${p.period_to || '—'}`,
    `Paid: ${p.paid_at ? String(p.paid_at).slice(0, 16) : '—'}`,
    p.notes ? `Note: ${p.notes}` : null,
    '',
    `Deliveries (${p.delivery_count}):`
  ].filter(Boolean);
  (p.deliveries || []).forEach((d, i) => {
    const items = (d.items || []).map((it) => `${it.quantity}× ${it.name}`).join(', ');
    lines.push(`${i + 1}. ${d.confirmation_code || d.order_number || 'Delivery'} · R${(Number(d.delivery_fee) || 0).toFixed(2)}`);
    lines.push(`   ${d.delivered_at ? String(d.delivered_at).slice(0, 16) : ''} · ${d.branch_name || ''}`);
    lines.push(`   ${d.customer_name || 'Customer'} · ${d.delivery_address || ''}`);
    if (items) lines.push(`   ${items}`);
  });
  lines.push('', 'Thank you for your deliveries.');
  return lines.join('\n');
}

function getDriverPayoutDetail(payoutId, actor) {
  ensureSchema();
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const payout = dbGet('SELECT * FROM delivery_driver_payouts WHERE id=?', [payoutId]);
  if (!payout) throw new Error('Payment not found');
  const driver = getDriver(payout.driver_id);
  const shop = dbGet('SELECT shop_name, phone, address FROM shop_settings WHERE id=1') || {};
  return { payout: enrichPayoutRow(payout), driver, shop };
}

function driverPayoutDetailForDriver(token, payoutId) {
  const driver = driverFromToken(token);
  const payout = dbGet('SELECT * FROM delivery_driver_payouts WHERE id=? AND driver_id=?', [payoutId, driver.id]);
  if (!payout) throw new Error('Payment not found');
  const shop = dbGet('SELECT shop_name, phone, address FROM shop_settings WHERE id=1') || {};
  return { payout: enrichPayoutRow(payout), driver: enrichDriver(driver), shop };
}

function buildDriverPayoutPdf(payoutId, actor) {
  const { payout, driver, shop } = actor
    ? getDriverPayoutDetail(payoutId, actor)
    : (() => { throw new Error('Actor required'); })();
  const { htmlToPdf } = require('./html-pdf-server');
  const html = buildDriverPayoutHtml(payout, driver, shop);
  return htmlToPdf(html, { widthMm: 210, heightMm: 297 });
}

function buildDriverPayoutPdfForDriver(token, payoutId) {
  const { payout, driver, shop } = driverPayoutDetailForDriver(token, payoutId);
  const { htmlToPdf } = require('./html-pdf-server');
  return htmlToPdf(buildDriverPayoutHtml(payout, driver, shop), { widthMm: 210, heightMm: 297 });
}

function notifyDriverAssigned(driver, row) {
  if (!driver?.phone || !row) return;
  try {
    const whatsapp = require('./whatsapp');
    const code = row.confirmation_code || row.order_number || 'Delivery';
    const body = `You have been assigned a delivery: ${code}\nAddress: ${row.delivery_address || '—'}\nHandoff code: *${row.confirmation_code || code}*\nFee: R${(Number(row.delivery_fee) || 0).toFixed(2)}`;
    dbRun(`INSERT INTO whatsapp_messages (recipient_type, phone, message_type, body, status, sender_name, metadata_json)
      VALUES ('driver',?,?,?,'pending','delivery',?)`, [
      driver.phone.trim(), 'delivery_assigned', body, JSON.stringify({ url: whatsapp.buildWaUrl(driver.phone, body), via: 'wa.me' })
    ]);
  } catch (_) { /* optional */ }
}

function notifyOnlineDriversPoolOrder(row) {
  if (getSettings().default_assignment_mode !== 'auto' || !row?.branch_id) return;
  try {
    const settings = getSettings();
    let drivers = listDrivers({ status: 'active' }).filter((d) => d.availability === 'online');
    if (settings.department_mode !== 'central') {
      drivers = drivers.filter((d) => d.all_branches || (d.branches || []).includes(Number(row.branch_id)));
    }
    const whatsapp = require('./whatsapp');
    const code = row.confirmation_code || row.order_number || 'Delivery';
    for (const d of drivers) {
      if (!d.phone) continue;
      const body = `New delivery available: ${code}\n${row.delivery_address || ''}\nOpen your driver app to accept.`;
      dbRun(`INSERT INTO whatsapp_messages (recipient_type, phone, message_type, body, status, sender_name, metadata_json)
        VALUES ('driver',?,?,?,'pending','delivery',?)`, [
        d.phone.trim(), 'delivery_pool', body, JSON.stringify({ url: whatsapp.buildWaUrl(d.phone, body), via: 'wa.me', delivery_id: row.id })
      ]);
    }
  } catch (_) { /* optional */ }
}

function previewDriverPayout(driverId, from, to, actor) {
  ensureSchema();
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const driver = getDriver(driverId);
  if (!driver) throw new Error('Driver not found');
  const deliveries = getDeliveriesForPayoutPeriod(driverId, from, to);
  const total = deliveries.reduce((s, d) => s + (Number(d.delivery_fee) || 0), 0);
  return { driver, from, to, deliveries, total, count: deliveries.length };
}

function getDriverPayoutHistory(driverId, filters = {}, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  let rows = [];
  try {
    let sql = `SELECT * FROM delivery_driver_payouts WHERE driver_id=?`;
    const params = [driverId];
    if (filters.from) { sql += ` AND date(paid_at) >= date(?)`; params.push(filters.from); }
    if (filters.to) { sql += ` AND date(paid_at) <= date(?)`; params.push(filters.to); }
    sql += ` ORDER BY id DESC LIMIT 100`;
    rows = dbAll(sql, params);
  } catch (e) {
    if (!/does not exist|relation.*delivery_driver_payouts/i.test(String(e.message || e))) throw e;
  }
  return rows.map(enrichPayoutRow);
}

function recordDriverPayout(driverId, data, actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  const driver = getDriver(driverId);
  if (!driver) throw new Error('Driver not found');
  const owed = data.period_from && data.period_to
    ? driverOwedAmount(driverId, { from: data.period_from, to: data.period_to })
    : driverOwedAmount(driverId);
  const amount = data.amount != null ? Number(data.amount) : owed.amount;
  if (amount <= 0) throw new Error('Nothing to pay — no delivered fees in this period');
  const from = data.period_from || owed.from;
  const to = data.period_to || owed.to;
  const deliveries = getDeliveriesForPayoutPeriod(driverId, from, to);
  const detailsJson = JSON.stringify(deliveries);
  const deliveryCount = deliveries.length || owed.count || 0;
  const r = dbRun(`INSERT INTO delivery_driver_payouts (driver_id, amount, period_from, period_to, paid_at, paid_by, paid_by_name, notes, delivery_count, details_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [
    driverId, amount, from, to, nowIso(), actor?.id || null, actor?.full_name || actor?.username || 'Admin',
    data.notes || null, deliveryCount, detailsJson
  ]);
  const payout = enrichPayoutRow(dbGet('SELECT * FROM delivery_driver_payouts WHERE id=?', [r.lastInsertRowid]));
  return payout;
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
    if (getSettings().default_assignment_mode !== 'auto') {
      throw new Error('This delivery was not assigned to you. Wait for admin to assign you manually.');
    }
    const poolRow = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
    if (!poolRow || poolRow.status !== 'awaiting_driver' || poolRow.driver_id) {
      throw new Error('Delivery not available');
    }
    if (getSettings().department_mode !== 'central') {
      const branchIds = driverBranchIds(driver);
      if (!branchIds.includes(Number(poolRow.branch_id))) {
        throw new Error('Delivery not available for your branches');
      }
    }
    const claim = dbRun(`UPDATE delivery_assignments SET driver_id=?, driver_name=?, status='assigned', assigned_at=?, updated_at=?
      WHERE id=? AND driver_id IS NULL AND status='awaiting_driver'`, [driver.id, driver.full_name, nowIso(), nowIso(), id]);
    if (!claim.changes) throw new Error('Another driver already accepted this delivery');
    row = dbGet('SELECT * FROM delivery_assignments WHERE id=?', [id]);
    ensureAssignmentFee(row);
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

function driverReleaseDelivery(token, id, reason) {
  const driver = driverFromToken(token);
  const row = dbGet('SELECT * FROM delivery_assignments WHERE id=? AND driver_id=?', [id, driver.id]);
  if (!row) throw new Error('Delivery not found');
  if (['delivered', 'failed', 'cancelled'].includes(String(row.status || '').toLowerCase())) {
    throw new Error('This delivery is already completed');
  }
  const manual = getSettings().default_assignment_mode !== 'auto';
  if (manual) {
    dbRun(`UPDATE delivery_assignments SET status='pending', driver_id=NULL, driver_name=NULL, driver_employee_id=NULL, pickup_at_store=0, failed_reason=?, updated_at=? WHERE id=?`, [
      reason || 'Driver released — awaiting admin reassignment', nowIso(), id
    ]);
    recordHistory(id, row.status, 'pending', { type: 'driver', id: driver.id, full_name: driver.full_name }, reason || 'Released — admin must reassign');
    return getDelivery(id);
  }
  dbRun(`UPDATE delivery_assignments SET status='awaiting_driver', driver_id=NULL, driver_name=NULL, driver_employee_id=NULL, pickup_at_store=0, failed_reason=NULL, updated_at=? WHERE id=?`, [
    nowIso(), id
  ]);
  recordHistory(id, row.status, 'awaiting_driver', { type: 'driver', id: driver.id, full_name: driver.full_name }, reason || 'Released for another driver');
  notifyOnlineDriversPoolOrder(row);
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

function submitPayoutClaim(token) {
  ensureSchema();
  const driver = driverFromToken(token);
  if (!isClaimWindowOpen(driver)) {
    throw new Error('Claim window is not open yet. You can claim from the day before your scheduled payout day.');
  }
  let existing = null;
  try {
    existing = dbGet(`SELECT id FROM delivery_driver_payout_claims WHERE driver_id=? AND status IN ('pending','approved')`, [driver.id]);
  } catch (_) { /* */ }
  if (existing) throw new Error('You already have a claim waiting for admin approval.');
  const owed = driverOwedAmount(driver.id);
  if (owed.amount <= 0) throw new Error('No delivery fees to claim for this period.');
  const r = dbRun(`INSERT INTO delivery_driver_payout_claims (driver_id, amount, delivery_count, period_from, period_to, status, claimed_at)
    VALUES (?,?,?,?,?,?,?)`, [
    driver.id, owed.amount, owed.count, owed.from, owed.to, 'pending', nowIso()
  ]);
  return dbGet('SELECT * FROM delivery_driver_payout_claims WHERE id=?', [r.lastInsertRowid]);
}

function listPayoutClaims(filters = {}, actor) {
  ensureSchema();
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'delivery_manager']);
  let sql = `SELECT c.*, d.full_name AS driver_name, d.phone AS driver_phone FROM delivery_driver_payout_claims c
    JOIN delivery_drivers d ON d.id=c.driver_id WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND c.status=?'; params.push(filters.status); }
  sql += ' ORDER BY c.id DESC LIMIT 100';
  const rows = dbAll(sql, params);
  return rows.map((c) => ({
    ...c,
    amount: Number(c.amount) || 0,
    driver: getDriver(c.driver_id)
  }));
}

function approvePayoutClaim(claimId, actor, notes) {
  ensureSchema();
  assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  const claim = dbGet('SELECT * FROM delivery_driver_payout_claims WHERE id=?', [claimId]);
  if (!claim || claim.status !== 'pending') throw new Error('Claim not found or already processed');
  const payout = recordDriverPayout(claim.driver_id, {
    amount: claim.amount,
    period_from: claim.period_from,
    period_to: claim.period_to,
    notes: notes || `Approved claim #${claimId}`
  }, actor);
  dbRun(`UPDATE delivery_driver_payout_claims SET status='paid', reviewed_at=?, reviewed_by=?, reviewed_by_name=?, admin_notes=?, payout_id=? WHERE id=?`, [
    nowIso(), actor?.id || null, actor?.full_name || actor?.username || 'Admin', notes || null, payout.id, claimId
  ]);
  return { claim: dbGet('SELECT * FROM delivery_driver_payout_claims WHERE id=?', [claimId]), payout };
}

function rejectPayoutClaim(claimId, actor, reason) {
  ensureSchema();
  assertUserActor(actor, ['owner', 'manager', 'supervisor']);
  const claim = dbGet('SELECT * FROM delivery_driver_payout_claims WHERE id=?', [claimId]);
  if (!claim || claim.status !== 'pending') throw new Error('Claim not found or already processed');
  dbRun(`UPDATE delivery_driver_payout_claims SET status='rejected', reviewed_at=?, reviewed_by=?, reviewed_by_name=?, admin_notes=? WHERE id=?`, [
    nowIso(), actor?.id || null, actor?.full_name || actor?.username || 'Admin', reason || 'Rejected', claimId
  ]);
  return dbGet('SELECT * FROM delivery_driver_payout_claims WHERE id=?', [claimId]);
}

module.exports = {
  ensureSchema, nextConfirmationCode, upsertFromSale, upsertFromOnlineOrder, getDelivery, listDeliveries, deliveryDashboard,
  listDrivers, getDriver, saveDriver, registerDriver, adminRegisterDriver, approveDriver, rejectDriver, suspendDriver, deleteDriver,
  assignDriver, assignMultipleOrders, autoAssignDriver, releaseToDriverPool, updateDeliveryStatus, updateDeliveryAdmin, cancelDeliveryAdmin,
  getSettings, saveSettings,
  getBranchSettings, saveBranchSettings, listAllBranchSettings, deleteBranchSettings, deliveryReports, driverEarningsReport,
  getDeliveryByTracking, driverLogin, driverLogout, driverDashboard, driverListOrders, driverHistory, driverEarnings, driverPayments,
  driverGetProfile, driverUpdateProfile,
  listDriverPaymentSummary, recordDriverPayout, getDriverPayoutHistory, previewDriverPayout, getDriverPayoutDetail, buildDriverPayoutHtml, buildDriverPayoutWhatsAppText, buildDriverPayoutPdf, buildDriverPayoutPdfForDriver, driverPayoutDetailForDriver, submitPayoutClaim, listPayoutClaims, approvePayoutClaim, rejectPayoutClaim,
  driverPublicInfo, enrichDriver, isClaimWindowOpen, driverAcceptDelivery,
  driverRejectDelivery, driverReleaseDelivery, driverUpdateStatus, setDriverAvailability,
  getDeliveryByOnlineOrder, releaseOnlineDeliveryAfterPosAccept
};
