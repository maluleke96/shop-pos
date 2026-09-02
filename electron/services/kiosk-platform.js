/**
 * Self-Service Kiosk — device pairing, catalog, cart, POS order integration.
 */
const fs = require('fs');
const path = require('path');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, parseJson, uid,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword, hashToken, newToken
} = require('./biz-modules-common');

const AUDIT = 'kiosk_audit_logs';
const ROLE_PERMS = {
  kiosk_admin: { devices: true, orders: true, settings: true, users: true, pair: true },
  kiosk_operator: { devices: true, orders: true, settings: false, users: false, pair: true },
  kiosk_device: { devices: false, orders: false, settings: false, users: false, pair: false }
};

function ensureKiosk() {
  try { dbGet('SELECT 1 FROM kiosk_settings LIMIT 1'); } catch (_) { /* */ }
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
  } catch (err) { console.warn('[kiosk] schema ensure failed:', err.message); }
  try { dbRun('INSERT OR IGNORE INTO kiosk_settings (id) VALUES (1)'); } catch (_) {
    try { dbRun('INSERT INTO kiosk_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING'); } catch (__) { /* */ }
  }
  try {
    const c = dbGet('SELECT COUNT(*) AS c FROM kiosk_centre_users')?.c || 0;
    if (c === 0) {
      dbRun('INSERT INTO kiosk_centre_users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
        ['kiosk', hashPassword('kiosk123'), 'Kiosk Administrator', 'kiosk_admin']);
      console.log('[kiosk] Default admin: kiosk / kiosk123');
    }
  } catch (_) { /* */ }
}

function perms(role) { return ROLE_PERMS[role] || ROLE_PERMS.kiosk_operator; }

function audit(row) {
  ensureKiosk();
  try {
    dbRun(`INSERT INTO ${AUDIT} (user_id, user_name, device_id, action, entity_type, entity_id, details_json, result)
      VALUES (?,?,?,?,?,?,?,?)`,
      [row.user_id || null, row.user_name || null, row.device_id || null, row.action,
        row.entity_type || null, row.entity_id || null, JSON.stringify(row.details || {}), row.result || 'ok']);
  } catch (_) { /* */ }
}

function resolvePortal(token) {
  ensureKiosk();
  return resolveModuleSession('kiosk_sessions', 'kiosk_centre_users', token);
}

function requirePerm(token, perm) {
  const u = resolvePortal(token);
  if (!perms(u.role)[perm]) throw new Error('Permission denied');
  return u;
}

function resolveDevice(deviceToken) {
  ensureKiosk();
  if (!deviceToken) throw new Error('Device authentication required');
  const row = dbGet('SELECT * FROM kiosk_devices WHERE token_hash = ? AND is_revoked = 0 AND is_active = 1', [hashToken(deviceToken)]);
  if (!row) throw new Error('Device authentication failed');
  return row;
}

function resolvePosActor() {
  const settings = dbGet('SELECT system_pos_user_id FROM kiosk_settings WHERE id = 1') || {};
  let userId = settings.system_pos_user_id;
  if (!userId) {
    const owner = dbGet("SELECT id FROM users WHERE role IN ('owner','manager') AND is_active = 1 ORDER BY id LIMIT 1");
    userId = owner?.id;
  }
  if (!userId) throw new Error('No POS user configured for kiosk orders — set system POS user in kiosk settings');
  const user = dbGet('SELECT id, full_name, username, role, is_active FROM users WHERE id = ?', [userId]);
  if (!user?.is_active) throw new Error('Configured POS user is inactive');
  return user;
}

function ensureShiftForActor(actor) {
  const store = require('./store');
  if (store.roleRequiresShift(actor.role) && !store.getOpenShift(actor.id)) {
    try { store.openShift(actor.id, 0); } catch (err) {
      throw new Error(err.message || 'Shift required for kiosk orders');
    }
  }
}

function detectStaleDevices() {
  const cutoff = new Date(Date.now() - 3 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  dbRun(`UPDATE kiosk_devices SET status = 'offline' WHERE is_revoked = 0 AND is_active = 1 AND status = 'online'
    AND (last_heartbeat IS NULL OR last_heartbeat < ?)`, [cutoff]);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function kioskLogin(username, password) {
  ensureKiosk();
  const user = dbGet('SELECT * FROM kiosk_centre_users WHERE lower(username) = lower(?) AND is_active = 1', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('Invalid username or password');
  const sess = createModuleSession('kiosk_sessions', user.id);
  dbRun('UPDATE kiosk_centre_users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  audit({ user_id: user.id, user_name: user.username, action: 'login' });
  return { token: sess.token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions: perms(user.role) } };
}

function kioskLogout(token) {
  try { dbRun('DELETE FROM kiosk_sessions WHERE token_hash = ?', [hashToken(token)]); } catch (_) { /* */ }
  return { success: true };
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

function requestPairing(meta = {}) {
  ensureKiosk();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 600000).toISOString().slice(0, 19).replace('T', ' ');
  dbRun('INSERT INTO kiosk_device_pairings (pairing_code, device_meta, expires_at) VALUES (?,?,?)',
    [code, JSON.stringify(meta || {}), expires]);
  return { pairing_code: code, expires_in_seconds: 600 };
}

function pairingStatus(code) {
  ensureKiosk();
  const row = dbGet('SELECT * FROM kiosk_device_pairings WHERE pairing_code = ? ORDER BY id DESC LIMIT 1', [code]);
  if (!row) return { status: 'not_found' };
  if (row.status === 'pending' && row.expires_at < nowIso()) {
    dbRun("UPDATE kiosk_device_pairings SET status = 'expired' WHERE id = ?", [row.id]);
    return { status: 'expired' };
  }
  if (row.status === 'approved' && row.device_id) {
    const meta = parseJson(row.device_meta, {});
    if (meta.device_token_once) {
      const deviceToken = meta.device_token_once;
      delete meta.device_token_once;
      dbRun('UPDATE kiosk_device_pairings SET device_meta = ? WHERE id = ?', [JSON.stringify(meta), row.id]);
      return { status: 'approved', device_id: row.device_id, device_token: deviceToken };
    }
    return { status: 'approved', device_id: row.device_id, device_token: null };
  }
  return { status: row.status };
}

function listPendingPairings(token) {
  requirePerm(token, 'pair');
  return dbAll('SELECT * FROM kiosk_device_pairings WHERE status = ? AND expires_at > ? ORDER BY id DESC', ['pending', nowIso()]);
}

function listPendingPairingsAdmin() {
  ensureKiosk();
  return dbAll('SELECT * FROM kiosk_device_pairings WHERE status = ? AND expires_at > ? ORDER BY id DESC', ['pending', nowIso()]);
}

function listDevicesAdmin() {
  ensureKiosk();
  detectStaleDevices();
  return dbAll(`SELECT id, device_code, name, location, branch_id, status, is_active, last_heartbeat, last_order_at, error_state
    FROM kiosk_devices WHERE is_revoked = 0 ORDER BY name`);
}

function approvePairingAdmin(code, data, actorName) {
  ensureKiosk();
  const row = dbGet('SELECT * FROM kiosk_device_pairings WHERE pairing_code = ? AND status = ?', [code, 'pending']);
  if (!row) throw new Error('Pairing code not found or expired');
  const deviceToken = newToken();
  const meta = parseJson(row.device_meta, {});
  const name = String(data.name || meta.device_name || `Kiosk ${code}`).trim();
  const r = dbRun(`INSERT INTO kiosk_devices (device_code, name, location, branch_id, status, token_hash, pairing_meta)
    VALUES (?,?,?,?,?,?,?)`,
    [uid('KSK'), name, data.location || null, data.branch_id || null, 'online', hashToken(deviceToken), row.device_meta]);
  const deviceId = r.lastInsertRowid;
  dbRun('UPDATE kiosk_device_pairings SET status = ?, device_id = ?, device_meta = ? WHERE id = ?',
    ['approved', deviceId, JSON.stringify({ ...meta, device_token_once: deviceToken }), row.id]);
  audit({ user_name: actorName, device_id: deviceId, action: 'device_paired_admin', entity_id: deviceId });
  return { device_id: deviceId, device_token: deviceToken, name };
}

function approvePairing(code, data, portalToken) {
  const user = requirePerm(portalToken, 'pair');
  const row = dbGet('SELECT * FROM kiosk_device_pairings WHERE pairing_code = ? AND status = ?', [code, 'pending']);
  if (!row) throw new Error('Pairing code not found or expired');
  const deviceToken = newToken();
  const meta = parseJson(row.device_meta, {});
  const name = String(data.name || meta.device_name || `Kiosk ${code}`).trim();
  const r = dbRun(`INSERT INTO kiosk_devices (device_code, name, location, branch_id, status, token_hash, pairing_meta)
    VALUES (?,?,?,?,?,?,?)`,
    [uid('KSK'), name, data.location || null, data.branch_id || null, 'online', hashToken(deviceToken), row.device_meta]);
  const deviceId = r.lastInsertRowid;
  dbRun('UPDATE kiosk_device_pairings SET status = ?, device_id = ?, approved_by = ?, device_meta = ? WHERE id = ?',
    ['approved', deviceId, user.portal_user_id || user.id, JSON.stringify({ ...meta, device_token_once: deviceToken }), row.id]);
  audit({ user_id: user.id, user_name: user.full_name, device_id: deviceId, action: 'device_paired', entity_id: deviceId });
  return { device_id: deviceId, device_token: deviceToken, name };
}

function rejectPairing(code, portalToken) {
  const user = requirePerm(portalToken, 'pair');
  dbRun("UPDATE kiosk_device_pairings SET status = 'rejected', approved_by = ? WHERE pairing_code = ? AND status = 'pending'",
    [user.id, code]);
  return { success: true };
}

function revokeDevice(deviceId, portalToken) {
  const user = requirePerm(portalToken, 'devices');
  dbRun('UPDATE kiosk_devices SET is_revoked = 1, is_active = 0, status = ?, token_hash = NULL, updated_at = ? WHERE id = ?',
    ['revoked', nowIso(), deviceId]);
  audit({ user_id: user.id, user_name: user.full_name, device_id: deviceId, action: 'device_revoked' });
  return { success: true };
}

function saveDevice(data, portalToken) {
  requirePerm(portalToken, 'devices');
  if (!data.id) throw new Error('Device id required');
  dbRun(`UPDATE kiosk_devices SET name=?, location=?, branch_id=?, is_active=?, idle_timeout_sec=?, payment_methods_json=?, updated_at=? WHERE id=?`,
    [data.name, data.location || null, data.branch_id || null, data.is_active !== false ? 1 : 0,
      data.idle_timeout_sec || null, data.payment_methods ? JSON.stringify(data.payment_methods) : null, nowIso(), data.id]);
  return dbGet('SELECT id, device_code, name, location, branch_id, status, is_active, idle_timeout_sec FROM kiosk_devices WHERE id = ?', [data.id]);
}

function listDevices(token) {
  resolvePortal(token);
  detectStaleDevices();
  return dbAll(`SELECT id, device_code, name, location, branch_id, status, is_active, last_heartbeat, last_order_at, error_state
    FROM kiosk_devices WHERE is_revoked = 0 ORDER BY name`);
}

function deviceHeartbeat(deviceToken, payload = {}) {
  const dev = resolveDevice(deviceToken);
  dbRun(`UPDATE kiosk_devices SET status='online', last_heartbeat=?, error_state=NULL, updated_at=? WHERE id=?`,
    [nowIso(), nowIso(), dev.id]);
  return { success: true, idle_timeout_sec: dev.idle_timeout_sec || dbGet('SELECT idle_timeout_sec FROM kiosk_settings WHERE id=1')?.idle_timeout_sec || 120 };
}

function remoteCommand(deviceId, command, payload, portalToken) {
  const user = requirePerm(portalToken, 'devices');
  audit({ user_id: user.id, user_name: user.full_name, device_id: deviceId, action: 'remote_command', details: { command } });
  return { success: true, command, device_id: deviceId, payload: payload || {} };
}

// ─── Catalog (uses existing POS products) ────────────────────────────────────

function dataRoot() {
  try {
    const db = require('../database/db');
    return path.dirname(db.getDbPathForBackup?.() || db.getDbPath?.() || path.join(process.cwd(), 'data'));
  } catch (_) {
    return path.join(process.cwd(), 'data');
  }
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[e] || 'image/jpeg';
}

function resolveProductPicture(product) {
  const pic = product?.picture_path || product?.image_path || null;
  if (!pic) return null;
  const raw = String(pic);
  if (raw.startsWith('data:image/')) {
    const m = raw.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!m) return null;
    return { kind: 'inline', mime: m[1], buffer: Buffer.from(m[2], 'base64') };
  }
  const root = path.resolve(dataRoot());
  const candidates = [
    raw,
    path.join(root, raw),
    path.join(root, 'assets', raw),
    path.join(root, 'assets', path.basename(raw))
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return { kind: 'file', path: resolved, mime: mimeFromExt(path.extname(resolved)) };
      }
    } catch (_) { /* */ }
  }
  return null;
}

function productHasImage(product) {
  return !!resolveProductPicture(product);
}

function getKioskProductImage(productId, deviceToken) {
  resolveDevice(deviceToken);
  const store = require('./store');
  const product = store.getProduct(productId);
  if (!product) throw new Error('Product not found');
  const avail = productAvailable(product, null);
  if (!avail.available) throw new Error('Product not available');
  const resolved = resolveProductPicture(product);
  if (!resolved) throw new Error('Image not available');
  if (resolved.kind === 'inline') return { mime: resolved.mime, buffer: resolved.buffer };
  return { path: resolved.path, mime: resolved.mime };
}

function productAvailable(product, branchId) {
  const store = require('./store');
  const qty = Number(product.stock_quantity) || 0;
  if (product.is_active === 0) return { available: false, reason: 'inactive' };
  if (product.show_on_pos === 0) return { available: false, reason: 'hidden' };
  if (product.has_recipe && product.production_mode !== 'make_to_stock') {
    try {
      const prodAvail = require('./production-availability');
      const cap = prodAvail.getProductCapacity?.(product.id, branchId);
      if (cap && cap.max_servings <= 0) return { available: false, reason: 'out_of_stock' };
    } catch (_) { /* */ }
  } else if (qty <= 0 && !store.getAllowOversell?.()) {
    return { available: false, reason: 'out_of_stock' };
  }
  return { available: true };
}

function getKioskCatalog(deviceToken) {
  const dev = resolveDevice(deviceToken);
  const store = require('./store');
  const settings = dbGet('SELECT * FROM kiosk_settings WHERE id = 1') || {};
  const categories = (store.getCategories({ for_pos: true, active_only: true }) || []).filter((c) => c.is_active !== 0);
  const products = (store.getProducts({ for_pos: true, active_only: true, branch_id: dev.branch_id }) || [])
    .map((p) => {
      const avail = productAvailable(p, dev.branch_id);
      const hasImage = productHasImage(p);
      return {
        id: p.id, name: p.name, description: p.description, selling_price: p.selling_price,
        category_id: p.category_id, category_name: p.category_name,
        has_image: hasImage, image_url: hasImage ? `/kiosk-media/product/${p.id}` : null,
        item_type: p.item_type, has_modifiers: !!(p.modifiers?.length || p.options?.length),
        modifiers: p.modifiers || [], options: p.options || [], extras: p.extras || [], removals: p.removals || [],
        available: avail.available, unavailable_reason: avail.reason || null
      };
    });
  const payments = parseJson(dev.payment_methods_json, null) || parseJson(settings.payment_methods_json, ['cash', 'card']);
  return {
    device: { id: dev.id, name: dev.name, location: dev.location },
    categories, products,
    settings: { idle_timeout_sec: dev.idle_timeout_sec || settings.idle_timeout_sec || 120, welcome_message: settings.welcome_message, payment_methods: payments }
  };
}

function validateKioskCart(device, cartData) {
  const store = require('./store');
  const lines = Array.isArray(cartData.items) ? cartData.items : [];
  if (!lines.length) throw new Error('Cart is empty');
  const saleItems = [];
  let subtotal = 0;
  const errors = [];

  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) { errors.push('Invalid quantity'); continue; }
    const product = store.getProduct(line.product_id);
    if (!product) { errors.push(`Product ${line.product_id} not found`); continue; }
    const avail = productAvailable(product, device.branch_id);
    if (!avail.available) { errors.push(`${product.name} is unavailable`); continue; }
    const modExtra = store.resolveModifierExtras(line.product_id, line.modifiers || []);
    const unitPrice = (Number(product.selling_price) || 0) + modExtra;
    const total = Math.round(unitPrice * qty * 100) / 100;
    subtotal += total;
    saleItems.push({
      product_id: product.id, product_name: product.name, quantity: qty,
      unit_price: unitPrice, buying_price: product.buying_price || 0,
      total, item_type: product.item_type || 'food',
      modifiers: line.modifiers || [], modifiers_text: formatModifiers(line.modifiers)
    });
  }
  if (errors.length) throw new Error(errors.join('; '));
  if (!saleItems.length) throw new Error('No valid items in cart');

  const settings = store.getSettingsParsed?.() || {};
  let taxAmount = 0;
  if (settings.tax_enabled && settings.tax_rate) {
    taxAmount = settings.tax_inclusive
      ? subtotal - (subtotal / (1 + settings.tax_rate / 100))
      : subtotal * (settings.tax_rate / 100);
    taxAmount = Math.round(taxAmount * 100) / 100;
  }
  const total = settings.tax_inclusive ? subtotal : Math.round((subtotal + taxAmount) * 100) / 100;

  return { saleItems, subtotal, taxAmount, total };
}

function formatModifiers(mods) {
  if (!mods?.length) return null;
  return mods.map((m) => (typeof m === 'string' ? m : m.name || m.label)).filter(Boolean).join(', ');
}

function placeKioskOrder(deviceToken, orderData) {
  const dev = resolveDevice(deviceToken);
  const store = require('./store');
  const features = require('./features');
  const cart = validateKioskCart(dev, orderData);
  const paymentMethod = String(orderData.payment_method || 'cash').toLowerCase();
  const settings = dbGet('SELECT payment_methods_json FROM kiosk_settings WHERE id = 1') || {};
  const allowed = parseJson(dev.payment_methods_json, null) || parseJson(settings.payment_methods_json, ['cash', 'card']);
  if (!allowed.map((p) => String(p).toLowerCase()).includes(paymentMethod)) {
    throw new Error(`Payment method "${paymentMethod}" not enabled on this kiosk`);
  }

  const actor = resolvePosActor();
  ensureShiftForActor(actor);
  const clientRequestId = orderData.client_request_id || `kiosk-${dev.id}-${Date.now()}`;

  const saleData = {
    items: cart.saleItems,
    subtotal: cart.subtotal,
    tax_amount: cart.taxAmount,
    total: cart.total,
    amount_paid: cart.total,
    change_amount: 0,
    payments: [{ type: paymentMethod, amount: cart.total }],
    order_type: 'takeaway',
    order_source: 'KIOSK',
    notes: `Kiosk order — ${dev.name}${dev.location ? ` (${dev.location})` : ''}`,
    client_request_id: clientRequestId,
    discount_authorized: false
  };

  const sale = store.completeSale(saleData, actor.id, actor.full_name || actor.username, actor.role);
  const saleId = sale.saleId || sale.sale?.id;
  const orderNumber = sale.orderNumber || sale.sale?.order_number;

  const kitchenItems = cart.saleItems.filter((it) => ['food', 'drink', 'combo', 'side'].includes(String(it.item_type || '').toLowerCase()));
  if (kitchenItems.length) {
    try {
      features.createKitchenOrder({
        sale_id: saleId, order_number: orderNumber, station: 'kiosk',
        items: kitchenItems.map((it) => ({ product_name: it.product_name, quantity: it.quantity, modifiers: it.modifiers_text }))
      }, actor.id);
    } catch (_) { /* kitchen optional */ }
  }

  const ko = dbRun(`INSERT INTO kiosk_orders (device_id, sale_id, order_number, status, total, payment_method, items_json, completed_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [dev.id, saleId, orderNumber, 'completed', cart.total, paymentMethod, JSON.stringify(cart.saleItems), nowIso()]);
  dbRun('UPDATE kiosk_devices SET last_order_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), dev.id]);
  audit({ device_id: dev.id, action: 'order_placed', entity_type: 'order', entity_id: ko.lastInsertRowid, details: { sale_id: saleId, order_number: orderNumber, total: cart.total } });

  return {
    success: true, order_id: ko.lastInsertRowid, sale_id: saleId, order_number: orderNumber,
    total: cart.total, payment_method: paymentMethod, status: 'completed', replayed: !!sale.replayed
  };
}

function listKioskOrders(token, filters = {}) {
  resolvePortal(token);
  let sql = `SELECT ko.*, d.name AS device_name FROM kiosk_orders ko JOIN kiosk_devices d ON d.id = ko.device_id WHERE 1=1`;
  const params = [];
  if (filters.device_id) { sql += ' AND ko.device_id = ?'; params.push(filters.device_id); }
  if (filters.today) { sql += " AND date(ko.created_at) = date('now')"; }
  sql += ' ORDER BY ko.id DESC LIMIT 200';
  return dbAll(sql, params);
}

function getKioskSettings(token) {
  resolvePortal(token);
  return dbGet('SELECT * FROM kiosk_settings WHERE id = 1');
}

function saveKioskSettings(data, token) {
  requirePerm(token, 'settings');
  const fields = ['idle_timeout_sec', 'welcome_message', 'system_pos_user_id'];
  const sets = []; const vals = [];
  for (const f of fields) {
    if (data[f] !== undefined) { sets.push(`${f} = ?`); vals.push(data[f]); }
  }
  if (data.payment_methods) { sets.push('payment_methods_json = ?'); vals.push(JSON.stringify(data.payment_methods)); }
  if (sets.length) dbRun(`UPDATE kiosk_settings SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`, [...vals, nowIso()]);
  return getKioskSettings(token);
}

function kioskDashboard(token) {
  resolvePortal(token);
  detectStaleDevices();
  const devices = dbAll('SELECT * FROM kiosk_devices WHERE is_revoked = 0 ORDER BY name');
  const today = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM kiosk_orders WHERE date(created_at) = date('now')`) || {};
  return {
    devices,
    screens: { total: devices.length, online: devices.filter((d) => d.status === 'online').length, offline: devices.filter((d) => d.status !== 'online').length },
    today: { orders: today.orders || 0, revenue: today.revenue || 0 },
    recent_orders: dbAll(`SELECT ko.*, d.name AS device_name FROM kiosk_orders ko JOIN kiosk_devices d ON d.id = ko.device_id ORDER BY ko.id DESC LIMIT 20`)
  };
}

function kioskSummary() {
  ensureKiosk();
  detectStaleDevices();
  const devices = dbAll('SELECT status FROM kiosk_devices WHERE is_revoked = 0 AND is_active = 1');
  const today = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM kiosk_orders WHERE date(created_at) = date('now')`) || {};
  return {
    total_kiosks: devices.length,
    online: devices.filter((d) => d.status === 'online').length,
    offline: devices.filter((d) => d.status !== 'online').length,
    orders_today: today.orders || 0,
    revenue_today: today.revenue || 0
  };
}

async function runKioskTests() {
  ensureKiosk();
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
  await add('schema', 'Database schema', async () => { dbGet('SELECT 1 FROM kiosk_settings LIMIT 1'); return { status: 'PASS' }; });
  await add('pairing', 'Pairing code', async () => {
    const p = requestPairing({ test: true });
    if (p.pairing_code?.length !== 6) throw new Error('Invalid code');
    return { status: 'PASS', message: p.pairing_code };
  });
  await add('permissions', 'Role permissions', async () => {
    if (!perms('kiosk_admin').devices) throw new Error('admin needs devices');
    if (perms('kiosk_device').orders) throw new Error('device should not have orders perm');
    return { status: 'PASS' };
  });
  await add('catalog', 'POS product integration', async () => {
    const store = require('./store');
    const prods = store.getProducts({ for_pos: true });
    return { status: 'PASS', message: `${(prods || []).length} products` };
  });
  await add('pos_actor', 'POS actor resolution', async () => {
    try { resolvePosActor(); return { status: 'PASS' }; }
    catch (e) { return { status: 'WARNING', message: e.message }; }
  });
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  return { total: results.length, passed, failed, warnings, results, tested_at: nowIso() };
}

module.exports = {
  ensureKiosk, kioskLogin, kioskLogout, kioskDashboard, kioskSummary,
  requestPairing, pairingStatus, listPendingPairings, listPendingPairingsAdmin, listDevicesAdmin, approvePairingAdmin,
  approvePairing, rejectPairing, revokeDevice, saveDevice, listDevices, deviceHeartbeat, remoteCommand,
  getKioskCatalog, getKioskProductImage, validateKioskCart, placeKioskOrder, listKioskOrders,
  getKioskSettings, saveKioskSettings, runKioskTests
};
