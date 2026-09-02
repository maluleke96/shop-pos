/**
 * Drive-Thru — stations, order workflow, POS integration, audio signaling.
 */
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, parseJson, uid,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword, hashToken, newToken
} = require('./biz-modules-common');

const AUDIT = 'drive_thru_audit_logs';
const ROLE_PERMS = {
  drive_thru_admin: { stations: true, orders: true, settings: true, users: true, audio: true, cancel: true },
  drive_thru_manager: { stations: true, orders: true, settings: true, users: false, audio: true, cancel: true },
  drive_thru_operator: { stations: true, orders: true, settings: false, users: false, audio: true, cancel: false },
  drive_thru_device: { stations: false, orders: false, settings: false, users: false, audio: false, cancel: false }
};

const ORDER_STATUSES = ['arrived', 'ordering', 'confirmed', 'paid', 'preparing', 'ready', 'collected', 'cancelled'];

function ensureDriveThru() {
  try { dbGet('SELECT 1 FROM drive_thru_settings LIMIT 1'); } catch (_) { /* */ }
  try {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(__dirname, '../database/migrations-v88.sql');
    if (fs.existsSync(p)) {
      for (const stmt of fs.readFileSync(p, 'utf8').split(';').map((s) => s.trim()).filter(Boolean)) {
        try { require('../database/db').getDb().exec(stmt + ';'); } catch (e) {
          if (!/duplicate column|already exists/i.test(String(e.message))) { /* */ }
        }
      }
    }
  } catch (err) { console.warn('[drive-thru] schema ensure failed:', err.message); }
  try { dbRun('INSERT OR IGNORE INTO drive_thru_settings (id) VALUES (1)'); } catch (_) {
    try { dbRun('INSERT INTO drive_thru_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING'); } catch (__) { /* */ }
  }
  try {
    const c = dbGet('SELECT COUNT(*) AS c FROM drive_thru_centre_users')?.c || 0;
    if (c === 0) {
      dbRun('INSERT INTO drive_thru_centre_users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
        ['drivethru', hashPassword('dt123456'), 'Drive-Thru Manager', 'drive_thru_admin']);
      console.log('[drive-thru] Default admin: drivethru / dt123456');
    }
  } catch (_) { /* */ }
}

function perms(role) { return ROLE_PERMS[role] || ROLE_PERMS.drive_thru_operator; }

function audit(row) {
  ensureDriveThru();
  try {
    dbRun(`INSERT INTO ${AUDIT} (user_id, user_name, station_id, action, entity_type, entity_id, details_json, result)
      VALUES (?,?,?,?,?,?,?,?)`,
      [row.user_id || null, row.user_name || null, row.station_id || null, row.action,
        row.entity_type || null, row.entity_id || null, JSON.stringify(row.details || {}), row.result || 'ok']);
  } catch (_) { /* */ }
}

function resolvePortal(token) {
  ensureDriveThru();
  return resolveModuleSession('drive_thru_sessions', 'drive_thru_centre_users', token);
}

function requirePerm(token, perm) {
  const u = resolvePortal(token);
  if (!perms(u.role)[perm]) throw new Error('Permission denied');
  return u;
}

function resolveStation(stationToken) {
  ensureDriveThru();
  if (!stationToken) throw new Error('Station authentication required');
  const row = dbGet('SELECT * FROM drive_thru_stations WHERE token_hash = ? AND is_active = 1', [hashToken(stationToken)]);
  if (!row) throw new Error('Station authentication failed');
  return row;
}

function resolvePosActor(portalUser) {
  const settings = dbGet('SELECT system_pos_user_id FROM drive_thru_settings WHERE id = 1') || {};
  let userId = portalUser?.pos_user_id || settings.system_pos_user_id;
  if (!userId) {
    const owner = dbGet("SELECT id FROM users WHERE role IN ('owner','manager') AND is_active = 1 ORDER BY id LIMIT 1");
    userId = owner?.id;
  }
  if (!userId) throw new Error('No POS user configured for drive-thru orders');
  const user = dbGet('SELECT id, full_name, username, role, is_active FROM users WHERE id = ?', [userId]);
  if (!user?.is_active) throw new Error('Configured POS user is inactive');
  return user;
}

function ensureShiftForActor(actor) {
  const store = require('./store');
  if (store.roleRequiresShift(actor.role) && !store.getOpenShift(actor.id)) {
    try { store.openShift(actor.id, 0); } catch (err) {
      throw new Error(err.message || 'Shift required');
    }
  }
}

function detectStaleStations() {
  const cutoff = new Date(Date.now() - 3 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  dbRun(`UPDATE drive_thru_stations SET status = 'offline' WHERE is_active = 1 AND status = 'online'
    AND (last_heartbeat IS NULL OR last_heartbeat < ?)`, [cutoff]);
}

function productAvailable(product, branchId) {
  const store = require('./store');
  if (product.is_active === 0) return false;
  if (product.show_on_pos === 0) return false;
  const qty = Number(product.stock_quantity) || 0;
  if (product.has_recipe && product.production_mode !== 'make_to_stock') {
    try {
      const cap = require('./production-availability').getProductCapacity?.(product.id, branchId);
      if (cap && cap.max_servings <= 0) return false;
    } catch (_) { /* */ }
  } else if (qty <= 0 && !store.getAllowOversell?.()) return false;
  return true;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function driveThruLogin(username, password) {
  ensureDriveThru();
  const user = dbGet('SELECT * FROM drive_thru_centre_users WHERE lower(username) = lower(?) AND is_active = 1', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('Invalid username or password');
  const sess = createModuleSession('drive_thru_sessions', user.id);
  dbRun('UPDATE drive_thru_centre_users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  audit({ user_id: user.id, user_name: user.username, action: 'login' });
  return { token: sess.token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions: perms(user.role) } };
}

function driveThruLogout(token) {
  try { dbRun('DELETE FROM drive_thru_sessions WHERE token_hash = ?', [hashToken(token)]); } catch (_) { /* */ }
  return { success: true };
}

// ─── Stations ────────────────────────────────────────────────────────────────

function listStations(token) {
  resolvePortal(token);
  detectStaleStations();
  return dbAll('SELECT id, station_code, name, lane_label, branch_id, status, is_active, mic_device_id, speaker_device_id, active_order_id, staff_name, last_heartbeat, error_state FROM drive_thru_stations ORDER BY name');
}

function listStationsAdmin() {
  ensureDriveThru();
  detectStaleStations();
  return dbAll(`SELECT id, station_code, name, lane_label, status, is_active, staff_name, last_heartbeat, error_state, audio_status_json
    FROM drive_thru_stations ORDER BY name`);
}

function saveStationAdmin(data) {
  ensureDriveThru();
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Station name required');
  const stationToken = newToken();
  const code = uid('DT');
  const r = dbRun(`INSERT INTO drive_thru_stations (station_code, name, lane_label, branch_id, token_hash, status)
    VALUES (?,?,?,?,?,?)`, [code, name, data.lane_label || null, data.branch_id || null, hashToken(stationToken), 'offline']);
  return { ...dbGet('SELECT * FROM drive_thru_stations WHERE id = ?', [r.lastInsertRowid]), station_token: stationToken };
}

function saveStation(data, token) {
  requirePerm(token, 'stations');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Station name required');
  if (data.id) {
    dbRun(`UPDATE drive_thru_stations SET name=?, lane_label=?, branch_id=?, is_active=?, mic_device_id=?, speaker_device_id=?,
      mic_volume=?, speaker_volume=?, ptt_mode=?, updated_at=? WHERE id=?`,
      [name, data.lane_label || null, data.branch_id || null, data.is_active !== false ? 1 : 0,
        data.mic_device_id || null, data.speaker_device_id || null,
        Number(data.mic_volume) || 1, Number(data.speaker_volume) || 1, data.ptt_mode || 'push_to_talk', nowIso(), data.id]);
    return dbGet('SELECT * FROM drive_thru_stations WHERE id = ?', [data.id]);
  }
  const stationToken = newToken();
  const code = uid('DT');
  const r = dbRun(`INSERT INTO drive_thru_stations (station_code, name, lane_label, branch_id, token_hash, status)
    VALUES (?,?,?,?,?,?)`, [code, name, data.lane_label || null, data.branch_id || null, hashToken(stationToken), 'offline']);
  return { ...dbGet('SELECT * FROM drive_thru_stations WHERE id = ?', [r.lastInsertRowid]), station_token: stationToken };
}

function stationHeartbeat(stationToken, payload = {}) {
  const st = resolveStation(stationToken);
  const audioStatus = payload.audio_status || {};
  dbRun(`UPDATE drive_thru_stations SET status='online', last_heartbeat=?, audio_status_json=?, error_state=?, updated_at=? WHERE id=?`,
    [nowIso(), JSON.stringify(audioStatus), payload.error_state || null, nowIso(), st.id]);
  return { success: true, station_id: st.id };
}

function stationLogin(stationToken, portalToken) {
  const user = resolvePortal(portalToken);
  const st = resolveStation(stationToken);
  dbRun('UPDATE drive_thru_stations SET staff_user_id=?, staff_name=?, updated_at=? WHERE id=?',
    [user.portal_user_id || user.id, user.full_name || user.username, nowIso(), st.id]);
  audit({ user_id: user.id, user_name: user.full_name, station_id: st.id, action: 'station_login' });
  return { success: true, station: { id: st.id, name: st.name } };
}

function saveAudioConfig(stationToken, config, portalToken) {
  if (portalToken) requirePerm(portalToken, 'audio');
  const st = resolveStation(stationToken);
  dbRun(`UPDATE drive_thru_stations SET mic_device_id=?, speaker_device_id=?, mic_volume=?, speaker_volume=?, ptt_mode=?, updated_at=? WHERE id=?`,
    [config.mic_device_id || st.mic_device_id, config.speaker_device_id || st.speaker_device_id,
      Number(config.mic_volume) ?? st.mic_volume, Number(config.speaker_volume) ?? st.speaker_volume,
      config.ptt_mode || st.ptt_mode, nowIso(), st.id]);
  audit({ station_id: st.id, action: 'audio_config_saved', details: config });
  return dbGet('SELECT mic_device_id, speaker_device_id, mic_volume, speaker_volume, ptt_mode, audio_status_json FROM drive_thru_stations WHERE id = ?', [st.id]);
}

function getAudioConfig(stationToken) {
  const st = resolveStation(stationToken);
  return {
    mic_device_id: st.mic_device_id, speaker_device_id: st.speaker_device_id,
    mic_volume: st.mic_volume, speaker_volume: st.speaker_volume, ptt_mode: st.ptt_mode,
    audio_status: parseJson(st.audio_status_json, {})
  };
}

function postAudioSignal(stationToken, signalType, payload, fromRole = 'station') {
  const st = resolveStation(stationToken);
  dbRun('INSERT INTO drive_thru_audio_signals (station_id, signal_type, payload_json, from_role) VALUES (?,?,?,?)',
    [st.id, signalType, JSON.stringify(payload || {}), fromRole]);
  return { success: true };
}

function pollAudioSignals(stationToken, sinceId = 0) {
  const st = resolveStation(stationToken);
  const rows = dbAll('SELECT * FROM drive_thru_audio_signals WHERE station_id = ? AND id > ? AND consumed = 0 ORDER BY id LIMIT 50',
    [st.id, sinceId || 0]);
  for (const r of rows) dbRun('UPDATE drive_thru_audio_signals SET consumed = 1 WHERE id = ?', [r.id]);
  return rows.map((r) => ({ id: r.id, signal_type: r.signal_type, payload: parseJson(r.payload_json, {}), from_role: r.from_role }));
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

function getDriveThruCatalog(stationToken) {
  const st = resolveStation(stationToken);
  const store = require('./store');
  const categories = store.getCategories({ for_pos: true, active_only: true }) || [];
  const products = (store.getProducts({ for_pos: true, active_only: true, branch_id: st.branch_id }) || [])
    .map((p) => ({
      id: p.id, name: p.name, selling_price: p.selling_price, category_id: p.category_id,
      item_type: p.item_type, modifiers: p.modifiers || [], options: p.options || [],
      extras: p.extras || [], removals: p.removals || [],
      available: productAvailable(p, st.branch_id)
    }));
  return { station: { id: st.id, name: st.name, lane_label: st.lane_label }, categories, products };
}

function buildCartLines(items) {
  const store = require('./store');
  const saleItems = [];
  let subtotal = 0;
  for (const line of items || []) {
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) continue;
    const product = store.getProduct(line.product_id);
    if (!product) throw new Error(`Product ${line.product_id} not found`);
    const modExtra = store.resolveModifierExtras(line.product_id, line.modifiers || []);
    const unitPrice = (Number(product.selling_price) || 0) + modExtra;
    const total = Math.round(unitPrice * qty * 100) / 100;
    subtotal += total;
    saleItems.push({
      product_id: product.id, product_name: product.name, quantity: qty,
      unit_price: unitPrice, buying_price: product.buying_price || 0, total,
      item_type: product.item_type || 'food',
      modifiers: line.modifiers || [],
      modifiers_text: (line.modifiers || []).map((m) => m.name || m).join(', ') || null
    });
  }
  if (!saleItems.length) throw new Error('Order must include at least one item');
  return { saleItems, subtotal, total: Math.round(subtotal * 100) / 100 };
}

// ─── Orders ──────────────────────────────────────────────────────────────────

function startOrder(stationToken, portalToken) {
  const user = resolvePortal(portalToken);
  const st = resolveStation(stationToken);
  const r = dbRun(`INSERT INTO drive_thru_orders (station_id, staff_user_id, staff_name, status, arrived_at, started_at)
    VALUES (?,?,?,?,?,?)`,
    [st.id, user.portal_user_id || user.id, user.full_name || user.username, 'arrived', nowIso(), nowIso()]);
  dbRun('UPDATE drive_thru_stations SET active_order_id=?, updated_at=? WHERE id=?', [r.lastInsertRowid, nowIso(), st.id]);
  audit({ user_id: user.id, station_id: st.id, action: 'order_started', entity_id: r.lastInsertRowid });
  return getOrder(r.lastInsertRowid);
}

function updateOrder(orderId, data, portalToken) {
  resolvePortal(portalToken);
  const order = dbGet('SELECT * FROM drive_thru_orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (['collected', 'cancelled'].includes(order.status)) throw new Error('Order is closed');
  const cart = buildCartLines(data.items);
  dbRun(`UPDATE drive_thru_orders SET items_json=?, subtotal=?, total=?, notes=?, status='ordering', updated_at=? WHERE id=?`,
    [JSON.stringify(cart.saleItems), cart.subtotal, cart.total, data.notes || order.notes, nowIso(), orderId]);
  return getOrder(orderId);
}

function confirmOrder(orderId, portalToken) {
  const user = resolvePortal(portalToken);
  const order = dbGet('SELECT * FROM drive_thru_orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  const items = parseJson(order.items_json, []);
  if (!items.length) throw new Error('Add items before confirming');
  dbRun(`UPDATE drive_thru_orders SET status='confirmed', confirmed_at=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), orderId]);
  audit({ user_id: user.id, station_id: order.station_id, action: 'order_confirmed', entity_id: orderId });
  return getOrder(orderId);
}

function takePayment(orderId, paymentData, portalToken) {
  const user = resolvePortal(portalToken);
  const order = dbGet('SELECT * FROM drive_thru_orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status === 'cancelled') throw new Error('Order cancelled');
  const st = dbGet('SELECT * FROM drive_thru_stations WHERE id = ?', [order.station_id]);
  const portalUser = dbGet('SELECT * FROM drive_thru_centre_users WHERE id = ?', [user.portal_user_id || user.id]);
  const actor = resolvePosActor(portalUser);
  ensureShiftForActor(actor);

  const items = parseJson(order.items_json, []);
  const cart = { saleItems: items, subtotal: order.subtotal, total: order.total };
  const paymentMethod = String(paymentData.payment_method || 'cash').toLowerCase();
  const clientRequestId = paymentData.client_request_id || `dt-${orderId}-${Date.now()}`;

  const store = require('./store');
  const saleData = {
    items: cart.saleItems, subtotal: cart.subtotal, tax_amount: 0, total: cart.total,
    amount_paid: cart.total, change_amount: Number(paymentData.change_amount) || 0,
    payments: [{ type: paymentMethod, amount: cart.total }],
    order_type: 'takeaway', order_source: 'DRIVE_THRU',
    notes: `Drive-Thru ${st?.name || ''} — ${order.notes || ''}`.trim(),
    client_request_id: clientRequestId
  };

  const sale = store.completeSale(saleData, actor.id, actor.full_name || actor.username, actor.role);
  const saleId = sale.saleId || sale.sale?.id;
  const orderNumber = sale.orderNumber || sale.sale?.order_number;

  const features = require('./features');
  const kitchenItems = cart.saleItems.filter((it) => ['food', 'drink', 'combo', 'side'].includes(String(it.item_type || '').toLowerCase()));
  if (kitchenItems.length) {
    features.createKitchenOrder({
      sale_id: saleId, order_number: orderNumber, station: 'drive_thru',
      items: kitchenItems.map((it) => ({ product_name: it.product_name, quantity: it.quantity, modifiers: it.modifiers_text, notes: order.notes }))
    }, actor.id);
  }

  dbRun(`UPDATE drive_thru_orders SET sale_id=?, order_number=?, status='paid', payment_method=?, payment_status='paid', paid_at=?, updated_at=? WHERE id=?`,
    [saleId, orderNumber, paymentMethod, nowIso(), nowIso(), orderId]);
  audit({ user_id: user.id, station_id: order.station_id, action: 'order_paid', entity_id: orderId, details: { sale_id: saleId } });
  return { ...getOrder(orderId), sale_id: saleId };
}

function sendToKitchen(orderId, portalToken) {
  const user = resolvePortal(portalToken);
  dbRun(`UPDATE drive_thru_orders SET status='preparing', updated_at=? WHERE id=?`, [nowIso(), orderId]);
  audit({ user_id: user.id, action: 'sent_to_kitchen', entity_id: orderId });
  return getOrder(orderId);
}

function markReady(orderId, portalToken) {
  resolvePortal(portalToken);
  dbRun(`UPDATE drive_thru_orders SET status='ready', ready_at=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), orderId]);
  return getOrder(orderId);
}

function markCollected(orderId, portalToken) {
  resolvePortal(portalToken);
  const order = getOrder(orderId);
  dbRun(`UPDATE drive_thru_orders SET status='collected', collected_at=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), orderId]);
  dbRun('UPDATE drive_thru_stations SET active_order_id=NULL WHERE active_order_id=?', [orderId]);
  return getOrder(orderId);
}

function cancelOrder(orderId, reason, portalToken) {
  const user = requirePerm(portalToken, 'cancel');
  const order = dbGet('SELECT * FROM drive_thru_orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.sale_id) throw new Error('Cannot cancel — order already paid. Process refund in POS.');
  dbRun(`UPDATE drive_thru_orders SET status='cancelled', cancelled_at=?, cancel_reason=?, updated_at=? WHERE id=?`,
    [nowIso(), reason || null, nowIso(), orderId]);
  dbRun('UPDATE drive_thru_stations SET active_order_id=NULL WHERE active_order_id=?', [orderId]);
  audit({ user_id: user.id, station_id: order.station_id, action: 'order_cancelled', entity_id: orderId, details: { reason } });
  return getOrder(orderId);
}

function getOrder(orderId) {
  const o = dbGet(`SELECT o.*, s.name AS station_name FROM drive_thru_orders o
    JOIN drive_thru_stations s ON s.id = o.station_id WHERE o.id = ?`, [orderId]);
  if (o) o.items = parseJson(o.items_json, []);
  return o;
}

function listOrders(token, filters = {}) {
  resolvePortal(token);
  let sql = `SELECT o.*, s.name AS station_name FROM drive_thru_orders o JOIN drive_thru_stations s ON s.id = o.station_id WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND o.status = ?'; params.push(filters.status); }
  if (filters.station_id) { sql += ' AND o.station_id = ?'; params.push(filters.station_id); }
  if (filters.active) { sql += " AND o.status NOT IN ('collected','cancelled')"; }
  if (filters.today) { sql += " AND date(o.created_at) = date('now')"; }
  sql += ' ORDER BY o.id DESC LIMIT 200';
  return dbAll(sql, params).map((o) => ({ ...o, items: parseJson(o.items_json, []) }));
}

function avgServiceMinutesToday() {
  // JS average — avoids SQLite julianday() which Postgres rejects for timestamptz
  const rows = dbAll(`SELECT arrived_at, collected_at FROM drive_thru_orders
    WHERE collected_at IS NOT NULL AND date(created_at)=date('now')`);
  if (!rows.length) return 0;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const a = Date.parse(String(r.arrived_at).replace(' ', 'T'));
    const c = Date.parse(String(r.collected_at).replace(' ', 'T'));
    if (Number.isFinite(a) && Number.isFinite(c) && c >= a) {
      sum += (c - a) / 60000;
      n += 1;
    }
  }
  return n ? Math.round((sum / n) * 10) / 10 : 0;
}

function driveThruDashboard(token) {
  resolvePortal(token);
  detectStaleStations();
  const stations = dbAll('SELECT * FROM drive_thru_stations ORDER BY name');
  const active = listOrders(token, { active: true });
  const today = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM drive_thru_orders WHERE date(created_at)=date('now') AND status NOT IN ('cancelled')`) || {};
  const audioErrors = stations.filter((s) => {
    const st = parseJson(s.audio_status_json, {});
    return st.mic_error || st.speaker_error;
  }).length;
  return {
    stations,
    active_orders: active,
    stats: {
      stations_total: stations.length,
      stations_online: stations.filter((s) => s.status === 'online').length,
      active_orders: active.length,
      orders_today: today.orders || 0,
      revenue_today: today.revenue || 0,
      avg_service_minutes: avgServiceMinutesToday(),
      audio_errors: audioErrors
    }
  };
}

function driveThruSummary() {
  ensureDriveThru();
  detectStaleStations();
  const stations = dbAll('SELECT status, audio_status_json, error_state FROM drive_thru_stations WHERE is_active = 1');
  const today = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM drive_thru_orders WHERE date(created_at)=date('now') AND status NOT IN ('cancelled')`) || {};
  const active = dbGet(`SELECT COUNT(*) AS c FROM drive_thru_orders WHERE status NOT IN ('collected','cancelled')`)?.c || 0;
  const audioErrors = stations.filter((s) => {
    const st = parseJson(s.audio_status_json, {});
    return st.mic_error || st.speaker_error || s.error_state;
  }).length;
  return {
    stations: stations.length,
    online: stations.filter((s) => s.status === 'online').length,
    offline: stations.filter((s) => s.status !== 'online').length,
    active_orders: active,
    orders_today: today.orders || 0,
    revenue_today: today.revenue || 0,
    avg_service_minutes: avgServiceMinutesToday(),
    audio_errors: audioErrors
  };
}

function getDriveThruSettings(token) {
  resolvePortal(token);
  return dbGet('SELECT * FROM drive_thru_settings WHERE id = 1');
}

function saveDriveThruSettings(data, token) {
  requirePerm(token, 'settings');
  const sets = []; const vals = [];
  if (data.system_pos_user_id !== undefined) { sets.push('system_pos_user_id = ?'); vals.push(data.system_pos_user_id); }
  if (data.ptt_mode) { sets.push('ptt_mode = ?'); vals.push(data.ptt_mode); }
  if (sets.length) dbRun(`UPDATE drive_thru_settings SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`, [...vals, nowIso()]);
  return getDriveThruSettings(token);
}

function listAuditLogs(token, limit = 100) {
  resolvePortal(token);
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  return dbAll('SELECT * FROM drive_thru_audit_logs ORDER BY id DESC LIMIT ?', [lim]);
}

async function runDriveThruTests() {
  ensureDriveThru();
  const results = [];
  async function add(key, label, fn) {
    const t0 = Date.now();
    try {
      const r = await fn();
      results.push({ key, label, status: r?.status || 'PASS', message: r?.message || 'OK', duration_ms: Date.now() - t0 });
    } catch (err) {
      results.push({ key, label, status: 'FAIL', message: err.message || String(err), duration_ms: Date.now() - t0 });
    }
  }
  await add('schema', 'Database schema', async () => { dbGet('SELECT 1 FROM drive_thru_settings LIMIT 1'); return { status: 'PASS' }; });
  await add('permissions', 'Role permissions', async () => {
    if (!perms('drive_thru_admin').stations) throw new Error('admin needs stations');
    if (perms('drive_thru_operator').cancel) throw new Error('operator should not cancel');
    return { status: 'PASS' };
  });
  await add('catalog', 'POS integration', async () => {
    const store = require('./store');
    return { status: 'PASS', message: `${(store.getProducts({ for_pos: true }) || []).length} products` };
  });
  await add('audio_signals', 'Audio signal table', async () => {
    dbGet('SELECT 1 FROM drive_thru_audio_signals LIMIT 1');
    return { status: 'PASS' };
  });
  await add('mic_hardware', 'Microphone hardware test', async () => ({ status: 'NOT TESTED', message: 'Requires browser with microphone' }));
  await add('speaker_hardware', 'Speaker hardware test', async () => ({ status: 'NOT TESTED', message: 'Requires browser with audio output' }));
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  const notTested = results.filter((r) => r.status === 'NOT TESTED').length;
  return { total: results.length, passed, failed, warnings, not_tested: notTested, results, tested_at: nowIso() };
}

module.exports = {
  ensureDriveThru, driveThruLogin, driveThruLogout, driveThruDashboard, driveThruSummary,
  listStations, listStationsAdmin, saveStation, saveStationAdmin, stationHeartbeat, stationLogin,
  saveAudioConfig, getAudioConfig, postAudioSignal, pollAudioSignals,
  getDriveThruCatalog, startOrder, updateOrder, confirmOrder, takePayment,
  sendToKitchen, markReady, markCollected, cancelOrder, getOrder, listOrders,
  getDriveThruSettings, saveDriveThruSettings, listAuditLogs, runDriveThruTests
};
