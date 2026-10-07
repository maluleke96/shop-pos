/**
 * Self-Service Kiosk — device pairing, catalog, cart, POS order integration.
 */
const fs = require('fs');
const path = require('path');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, parseJson, uid,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword, hashToken, newToken,
  portalLoginWithPosFallback
} = require('./biz-modules-common');

const AUDIT = 'kiosk_audit_logs';
const ROLE_PERMS = {
  kiosk_admin: { devices: true, orders: true, settings: true, users: true, pair: true },
  kiosk_operator: { devices: true, orders: true, settings: false, users: false, pair: true },
  kiosk_device: { devices: false, orders: false, settings: false, users: false, pair: false }
};

let _kioskSchemaDb = null;

function ensureKiosk() {
  const dbMod = require('../database/db');
  const handle = dbMod.getDb();
  if (_kioskSchemaDb === handle) return;
  try {
    const p = path.join(__dirname, '../database/migrations-v88.sql');
    if (!dbMod.isPgMode() && fs.existsSync(p)) {
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
  ensureKioskExtras();
  _kioskSchemaDb = handle;
}

/** Additive columns for idempotency, health monitoring and error diagnostics. */
function ensureKioskExtras() {
  const alters = [
    'ALTER TABLE kiosk_orders ADD COLUMN client_request_id TEXT',
    'ALTER TABLE kiosk_orders ADD COLUMN client_created_at TEXT',
    'ALTER TABLE kiosk_orders ADD COLUMN sync_status TEXT',
    'ALTER TABLE kiosk_orders ADD COLUMN customer_id INTEGER',
    'ALTER TABLE kiosk_orders ADD COLUMN branch_id INTEGER',
    'ALTER TABLE kiosk_orders ADD COLUMN txn_seconds INTEGER',
    'ALTER TABLE kiosk_devices ADD COLUMN app_version TEXT',
    'ALTER TABLE kiosk_devices ADD COLUMN latency_ms INTEGER',
    'ALTER TABLE kiosk_devices ADD COLUMN pending_sync INTEGER DEFAULT 0',
    'ALTER TABLE kiosk_devices ADD COLUMN device_status_json TEXT',
    'ALTER TABLE kiosk_devices ADD COLUMN offline_notified_at TEXT'
  ];
  for (const sql of alters) { try { dbRun(sql); } catch (_) { /* exists */ } }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_kiosk_orders_client_req ON kiosk_orders (client_request_id)'); } catch (_) { /* */ }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_kiosk_orders_sale ON kiosk_orders (sale_id)'); } catch (_) { /* */ }
  try {
    dbRun(`CREATE TABLE IF NOT EXISTS kiosk_error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      branch_id INTEGER,
      error_type TEXT NOT NULL,
      message TEXT,
      context_json TEXT,
      app_version TEXT,
      client_occurred_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
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
  dbRun(`UPDATE kiosk_devices SET status = 'offline' WHERE is_revoked = 0 AND is_active = 1 AND status IN ('online', 'unstable')
    AND (last_heartbeat IS NULL OR last_heartbeat < ?)`, [cutoff]);
}

/** Stored timestamps are UTC ("YYYY-MM-DD HH:MM:SS" or Date from Postgres). */
function utcMs(v) {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Health per kiosk from real heartbeats, orders and errors. Status: online | unstable | offline.
 */
function kioskHealth(filters = {}) {
  ensureKiosk();
  detectStaleDevices();
  const today = String(filters.date || new Date().toLocaleDateString('en-CA')).slice(0, 10);
  const devices = dbAll(`SELECT id, device_code, name, location, branch_id, status, is_active, last_heartbeat, last_order_at,
    error_state, app_version, latency_ms, pending_sync, device_status_json FROM kiosk_devices WHERE is_revoked = 0 ORDER BY name`);
  if (!devices.length) return { date: today, devices: [] };
  const orders = dbAll(`SELECT device_id, COUNT(*) AS c, COALESCE(SUM(total),0) AS revenue FROM kiosk_orders
    WHERE substr(CAST(created_at AS TEXT), 1, 10) = ? GROUP BY device_id`, [today]);
  const errs = dbAll(`SELECT device_id, error_type, COUNT(*) AS c FROM kiosk_error_log
    WHERE substr(CAST(created_at AS TEXT), 1, 10) = ? GROUP BY device_id, error_type`, [today]);
  const byDev = Object.fromEntries(orders.map((o) => [o.device_id, o]));
  const now = Date.now();
  return {
    date: today,
    devices: devices.map((d) => {
      const e = errs.filter((x) => Number(x.device_id) === Number(d.id));
      const failed = e.filter((x) => ['order_submission_failure', 'payment_failure', 'sync_failure', 'kitchen_sync_failure'].includes(x.error_type))
        .reduce((s, x) => s + Number(x.c || 0), 0);
      const hb = utcMs(d.last_heartbeat);
      return {
        ...d,
        seconds_since_heartbeat: hb ? Math.max(0, Math.round((now - hb) / 1000)) : null,
        orders_today: Number(byDev[d.id]?.c) || 0,
        revenue_today: Math.round((Number(byDev[d.id]?.revenue) || 0) * 100) / 100,
        failed_transactions: failed,
        errors_today: e.reduce((s, x) => s + Number(x.c || 0), 0),
        error_breakdown: e.map((x) => ({ type: x.error_type, count: Number(x.c) || 0 }))
      };
    })
  };
}

function listKioskErrors(filters = {}) {
  ensureKiosk();
  const params = [];
  let sql = `SELECT el.*, d.name AS device_name FROM kiosk_error_log el LEFT JOIN kiosk_devices d ON d.id = el.device_id WHERE 1=1`;
  if (filters.device_id) { sql += ' AND el.device_id = ?'; params.push(Number(filters.device_id)); }
  if (filters.from) { sql += ' AND substr(CAST(el.created_at AS TEXT), 1, 10) >= ?'; params.push(String(filters.from).slice(0, 10)); }
  if (filters.to) { sql += ' AND substr(CAST(el.created_at AS TEXT), 1, 10) <= ?'; params.push(String(filters.to).slice(0, 10)); }
  sql += ' ORDER BY el.id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 100, 500));
  return dbAll(sql, params);
}

/** Kiosk devices that stopped sending heartbeats and have not been reported yet. */
function staleKiosksToNotify(minutes = 3) {
  ensureKiosk();
  detectStaleDevices();
  const cutoff = new Date(Date.now() - Math.max(1, minutes) * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = dbAll(`SELECT id, name, location, branch_id, last_heartbeat FROM kiosk_devices
    WHERE is_revoked = 0 AND is_active = 1 AND status = 'offline' AND offline_notified_at IS NULL
      AND last_heartbeat IS NOT NULL AND last_heartbeat < ?`, [cutoff]);
  for (const r of rows) {
    try { dbRun('UPDATE kiosk_devices SET offline_notified_at = ? WHERE id = ?', [nowIso(), r.id]); } catch (_) { /* */ }
  }
  return rows;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function kioskLogin(username, password) {
  ensureKiosk();
  const { user, sess } = portalLoginWithPosFallback({
    username,
    password,
    usersTable: 'kiosk_centre_users',
    sessionsTable: 'kiosk_sessions',
    portalRole: 'kiosk_admin',
    onSuccess: (u) => {
      try { dbRun('UPDATE kiosk_centre_users SET last_login_at = ? WHERE id = ?', [nowIso(), u.id]); } catch (_) { /* */ }
      audit({ user_id: u.id, user_name: u.username, action: 'login' });
    }
  });
  return {
    token: sess.token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions: perms(user.role) },
    hint: 'Use your Admin username/password, or kiosk / kiosk123. Customer kiosk screens use pairing codes (no login).'
  };
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

function revokeDeviceAdmin(deviceId, actorName) {
  ensureKiosk();
  const id = Number(deviceId);
  if (!id) throw new Error('Device id required');
  dbRun('UPDATE kiosk_devices SET is_revoked = 1, is_active = 0, status = ?, token_hash = NULL, updated_at = ? WHERE id = ?',
    ['revoked', nowIso(), id]);
  audit({ user_name: actorName || 'Admin', device_id: id, action: 'device_revoked_admin' });
  return { success: true };
}

function saveDeviceAdmin(data, actorName) {
  ensureKiosk();
  if (!data?.id) throw new Error('Device id required');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Name is required');
  dbRun(`UPDATE kiosk_devices SET name=?, location=?, branch_id=?, is_active=?, idle_timeout_sec=?, updated_at=? WHERE id=? AND is_revoked = 0`,
    [name, data.location || null, data.branch_id != null ? Number(data.branch_id) : null,
      data.is_active === false ? 0 : 1, data.idle_timeout_sec || null, nowIso(), data.id]);
  audit({ user_name: actorName || 'Admin', device_id: data.id, action: 'device_updated_admin' });
  return dbGet('SELECT id, device_code, name, location, branch_id, status, is_active, last_order_at FROM kiosk_devices WHERE id = ?', [data.id]);
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
  const p = payload || {};
  const latency = Number.isFinite(Number(p.latency_ms)) ? Math.max(0, Math.min(600000, Math.round(Number(p.latency_ms)))) : null;
  const pending = Number.isFinite(Number(p.pending_sync)) ? Math.max(0, Math.round(Number(p.pending_sync))) : 0;
  const status = latency != null && latency > 2500 ? 'unstable' : 'online';
  const deviceStatus = p.device_status && typeof p.device_status === 'object' ? JSON.stringify(p.device_status).slice(0, 2000) : null;
  if (dev.status === 'offline' && dev.last_heartbeat) {
    const offlineSec = Math.max(0, Math.round((Date.now() - utcMs(dev.last_heartbeat)) / 1000));
    logKioskError(dev, 'reconnected', 'Kiosk reconnected after being offline', { offline_seconds: offlineSec, pending_sync: pending });
  }
  dbRun(`UPDATE kiosk_devices SET status=?, last_heartbeat=?, error_state=?, app_version=COALESCE(?, app_version),
    latency_ms=?, pending_sync=?, device_status_json=COALESCE(?, device_status_json), offline_notified_at=NULL, updated_at=? WHERE id=?`,
    [status, nowIso(), p.last_error ? String(p.last_error).slice(0, 300) : null, p.app_version ? String(p.app_version).slice(0, 40) : null,
      latency, pending, deviceStatus, nowIso(), dev.id]);
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
  if (!product) return false;
  if (product.has_picture === 1 || product.has_picture === true || product._hasImage) return true;
  try {
    const lib = require('../../lib/product-images');
    if (lib.productHasPicturePath(product)) return true;
  } catch (_) { /* */ }
  const pic = resolveProductPicture(product);
  if (pic) return true;
  if (product.picture_path || product.image_path) {
    const raw = String(product.picture_path || product.image_path || '');
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:image/')) return true;
  }
  return false;
}

function getKioskProductImage(productId, deviceToken) {
  resolveDevice(deviceToken);
  const store = require('./store');
  const product = store.getProduct(productId);
  if (!product) throw new Error('Product not found');
  const avail = productAvailable(product, null);
  if (!avail.available) throw new Error('Product not available');
  try {
    const file = require('../../lib/product-images').getProductImage(productId);
    if (file.redirectUrl) return { redirectUrl: file.redirectUrl, mime: file.mime };
    if (file.buffer) return { mime: file.mime, buffer: file.buffer };
  } catch (_) { /* fallback */ }
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

const _catalogCache = new Map();
const CATALOG_TTL_MS = 20000;

function kioskPaymentMethodsFromSettings() {
  const store = require('./store');
  const s = store.getSettingsParsed?.() || {};
  const pcm = require('../../lib/payment-channel-methods');
  return pcm.formatMethodOptions(s.payment_settings || {}, 'kiosk');
}

function kioskPaymentMethodIdsFromSettings() {
  return kioskPaymentMethodsFromSettings().ids;
}

function getKioskCatalog(deviceToken) {
  const dev = resolveDevice(deviceToken);
  const settings = dbGet('SELECT * FROM kiosk_settings WHERE id = 1') || {};
  const key = String(dev.branch_id || 0);
  let cached = _catalogCache.get(key);
  if (!cached || cached.exp < Date.now()) {
    cached = { ...buildCatalogData(dev.branch_id), exp: Date.now() + CATALOG_TTL_MS };
    _catalogCache.set(key, cached);
  }
  const devicePay = parseJson(dev.payment_methods_json, null) || parseJson(settings.payment_methods_json, null);
  const fromSettings = kioskPaymentMethodsFromSettings();
  const paymentIds = Array.isArray(devicePay) && devicePay.length
    ? devicePay.map((x) => (typeof x === 'object' ? x.id : x)).filter(Boolean)
    : fromSettings.ids;
  const labels = { ...fromSettings.labels };
  for (const id of paymentIds) {
    if (!labels[id]) labels[id] = fromSettings.labels[id] || id;
  }
  return {
    device: { id: dev.id, name: dev.name, location: dev.location },
    categories: cached.categories, products: cached.products,
    catalog_version: cached.version,
    settings: {
      idle_timeout_sec: dev.idle_timeout_sec || settings.idle_timeout_sec || 120,
      welcome_message: settings.welcome_message,
      payment_methods: paymentIds,
      payment_method_labels: labels,
      payment_method_options: paymentIds.map((id) => ({ id, label: labels[id] || id }))
    }
  };
}

function buildCatalogData(branchId) {
  const store = require('./store');
  const categories = (store.getCategories({ for_pos: true, active_only: true }) || []).filter((c) => c.is_active !== 0);
  const dev = { branch_id: branchId };
  const products = (store.getProducts({ for_pos: true, active_only: true, branch_id: dev.branch_id }) || [])
    .map((p) => {
      const avail = productAvailable(p, dev.branch_id);
      const hasImage = productHasImage(p);
      const imageUrl = hasImage ? `/api/product-image/${p.id}` : null;
      return {
        id: p.id, name: p.name, description: p.description, selling_price: p.selling_price,
        category_id: p.category_id, category_name: p.category_name,
        has_image: hasImage,
        has_picture: hasImage,
        image_url: imageUrl,
        picture_path: p.picture_path || p.image_path || null,
        item_type: p.item_type, has_modifiers: !!(p.modifiers?.length || p.options?.length),
        modifiers: p.modifiers || [], options: p.options || [], extras: p.extras || [], removals: p.removals || [],
        available: avail.available, unavailable_reason: avail.reason || null
      };
    });
  return { categories, products, version: Date.now().toString(36) };
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

function kioskOrderResult(row, replayed) {
  return {
    success: true, order_id: row.id, sale_id: row.sale_id, order_number: row.order_number,
    total: Number(row.total) || 0, payment_method: row.payment_method, status: row.status || 'completed',
    replayed: !!replayed, client_request_id: row.client_request_id || null
  };
}

/** Existing customer only — the kiosk never creates customer records. */
function findKioskCustomer(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  const tail = digits.slice(-9);
  const rows = dbAll(`SELECT id, phone FROM customers WHERE phone IS NOT NULL AND phone LIKE ? LIMIT 20`, [`%${tail.slice(-4)}%`]);
  const hit = rows.find((r) => String(r.phone || '').replace(/\D/g, '').slice(-9) === tail);
  return hit ? hit.id : null;
}

function clientCreatedAt(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  if (t > now + 60000 || t < now - 24 * 3600000) return null;
  return new Date(t).toISOString();
}

function kioskCustomerLogin(deviceToken, login, password) {
  resolveDevice(deviceToken);
  const web = require('./online-ordering');
  return web.loginWebCustomer(login, password);
}

function kioskCustomerBenefits(deviceToken, webToken) {
  resolveDevice(deviceToken);
  const web = require('./online-ordering');
  const wc = web.resolveWebCustomer(webToken);
  if (!wc) throw new Error('Customer session expired — sign in again');
  const features = require('./features');
  const settings = web.getGlobalSettings?.() || {};
  let giftBalance = 0;
  let giftCode = null;
  if (wc.customer_id) {
    try {
      const cards = dbAll(
        "SELECT code, balance FROM gift_cards WHERE customer_id = ? AND status = 'active' ORDER BY balance DESC LIMIT 3",
        [wc.customer_id]
      );
      if (cards.length) {
        giftCode = cards[0].code;
        giftBalance = Number(cards[0].balance) || 0;
      }
    } catch (_) { /* */ }
  }
  let referralCode = wc.referral_code || wc.my_referral_code || null;
  if (!referralCode && wc.customer_id) {
    const c = dbGet('SELECT referral_code FROM customers WHERE id = ?', [wc.customer_id]);
    referralCode = c?.referral_code || null;
  }
  const loyaltyPoints = Math.floor(Number(wc.loyalty_points) || 0);
  const name = [wc.first_name, wc.last_name].filter(Boolean).join(' ') || wc.name || 'Customer';
  return {
    customer: { id: wc.id, name, phone: wc.phone, customer_id: wc.customer_id },
    loyalty_points: loyaltyPoints,
    referral_code: referralCode,
    gift_card: giftBalance > 0 ? { code: giftCode, balance: giftBalance } : null,
    vouchers_enabled: settings.online?.vouchers_enabled !== false,
    coupons_enabled: settings.online?.coupons_enabled !== false,
    loyalty_enabled: settings.online?.loyalty_enabled !== false && settings.loyalty?.enabled !== false
  };
}

function kioskValidateCoupon(deviceToken, code, opts, webToken) {
  resolveDevice(deviceToken);
  const web = require('./online-ordering');
  const wc = webToken ? web.resolveWebCustomer(webToken) : null;
  const dev = resolveDevice(deviceToken);
  return web.validateCoupon(code, dev.branch_id || null, opts || {}, wc?.id || null);
}

function kioskCheckGiftCard(deviceToken, code) {
  resolveDevice(deviceToken);
  const features = require('./features');
  return features.checkGiftCardBalance(code);
}

function placeKioskOrder(deviceToken, orderData) {
  const dev = resolveDevice(deviceToken);
  const store = require('./store');
  const features = require('./features');
  const web = require('./online-ordering');
  const requestedId = String(orderData.client_request_id || '').trim().slice(0, 80);
  if (requestedId) {
    const prior = dbGet('SELECT * FROM kiosk_orders WHERE client_request_id = ? AND device_id = ? ORDER BY id LIMIT 1', [requestedId, dev.id]);
    if (prior) return kioskOrderResult(prior, true);
  }
  const cart = validateKioskCart(dev, orderData);
  const paymentMethod = String(orderData.payment_method || 'cash').toLowerCase();
  const settings = dbGet('SELECT payment_methods_json FROM kiosk_settings WHERE id = 1') || {};
  const devicePay = parseJson(dev.payment_methods_json, null) || parseJson(settings.payment_methods_json, null);
  const allowedIds = Array.isArray(devicePay) && devicePay.length
    ? devicePay.map((x) => String(typeof x === 'object' ? x.id : x).toLowerCase()).filter(Boolean)
    : kioskPaymentMethodIdsFromSettings().map((x) => String(x).toLowerCase());
  if (!allowedIds.includes(paymentMethod)) {
    throw new Error(`Payment method "${paymentMethod}" not enabled on this kiosk`);
  }

  const actor = resolvePosActor();
  ensureShiftForActor(actor);
  const clientRequestId = requestedId || `kiosk-${dev.id}-${Date.now()}`;
  const createdAtClient = clientCreatedAt(orderData.client_created_at);
  let webCustomer = orderData.web_customer_token ? web.resolveWebCustomer(orderData.web_customer_token) : null;
  let customerId = webCustomer?.customer_id || (orderData.customer_phone ? findKioskCustomer(orderData.customer_phone) : null);
  if (webCustomer && !customerId) {
    try {
      const pos = store.getCustomers?.({ phone: webCustomer.phone, limit: 1 })?.[0];
      customerId = pos?.id || null;
    } catch (_) { /* */ }
  }

  let discount = 0;
  let voucherCode = null;
  if (orderData.voucher_code) {
    const vouchers = require('./discount-vouchers');
    const v = vouchers.validateVoucher(orderData.voucher_code, {
      subtotal: cart.subtotal,
      items: cart.saleItems || []
    });
    if (!v.ok) throw new Error(v.error || 'Invalid voucher');
    discount = Number(v.discount) || 0;
    voucherCode = v.code;
  }
  let couponCode = null;
  if (orderData.coupon_code) {
    const cRes = web.validateCoupon(orderData.coupon_code, dev.branch_id || null, {
      subtotal: cart.subtotal, items: cart.saleItems || []
    }, webCustomer?.id || null);
    if (cRes?.error) throw new Error(cRes.error);
    discount += Number(cRes.discount) || 0;
    couponCode = cRes.code || orderData.coupon_code;
  }
  let loyaltyDiscount = 0;
  let pointsUsed = 0;
  const requestedPoints = Math.max(0, Number(orderData.loyalty_points_used) || 0);
  if (requestedPoints > 0 && webCustomer?.id) {
    const cid = customerId || webCustomer.customer_id;
    if (!cid) throw new Error('Sign in to use loyalty points');
    const redemption = features.calcLoyaltyRedemption(cid, requestedPoints, Math.max(0, cart.subtotal - discount));
    pointsUsed = redemption.points;
    loyaltyDiscount = Number(redemption.discount) || 0;
    discount += loyaltyDiscount;
  }
  let giftCardAmount = 0;
  const giftCardCode = String(orderData.gift_card_code || '').trim().toUpperCase() || null;
  if (giftCardCode) {
    const bal = features.checkGiftCardBalance(giftCardCode);
    giftCardAmount = Math.min(Number(bal?.balance) || 0, Math.max(0, cart.total - discount));
  }
  const payable = Math.max(0, Math.round((cart.total - discount - giftCardAmount) * 100) / 100);
  const payments = [];
  if (giftCardAmount > 0) {
    payments.push({ type: 'giftcard', amount: giftCardAmount, gift_card_code: giftCardCode, gift_card_pre_redeemed: false });
  }
  payments.push({ type: paymentMethod, amount: payable });

  const saleData = {
    items: cart.saleItems,
    subtotal: cart.subtotal,
    discount,
    tax_amount: cart.taxAmount,
    total: Math.max(0, cart.total - discount),
    amount_paid: payable + giftCardAmount,
    change_amount: 0,
    payments,
    order_type: 'takeaway',
    order_source: 'KIOSK',
    notes: `Kiosk order — ${dev.name}${dev.location ? ` (${dev.location})` : ''}${voucherCode ? ` · voucher ${voucherCode}` : ''}${couponCode ? ` · coupon ${couponCode}` : ''}`,
    client_request_id: clientRequestId,
    discount_authorized: discount > 0,
    customer_id: customerId || undefined,
    kiosk_device_id: dev.id,
    sla_started_at: createdAtClient,
    referral_code: orderData.referral_code ? String(orderData.referral_code).trim().toUpperCase() : undefined,
    loyalty_points_used: pointsUsed || undefined
  };

  const sale = store.completeSale(saleData, actor.id, actor.full_name || actor.username, actor.role);
  const saleIdEarly = sale.saleId || sale.sale?.id;
  if (sale.replayed) {
    // The sale already exists (retry after a dropped response): never repeat kitchen, voucher or mirror side effects.
    const mirror = dbGet('SELECT * FROM kiosk_orders WHERE sale_id = ? ORDER BY id LIMIT 1', [saleIdEarly]);
    if (mirror) return kioskOrderResult(mirror, true);
  }
  if (voucherCode && !sale.replayed) {
    try {
      require('./discount-vouchers').redeemVoucher(voucherCode, {
        subtotal: cart.subtotal,
        items: cart.saleItems || [],
        channel: 'kiosk',
        actorId: actor.id,
        actorName: actor.full_name || actor.username
      });
    } catch (_) { /* already redeemed */ }
  }
  const saleId = sale.saleId || sale.sale?.id;
  const orderNumber = sale.orderNumber || sale.sale?.order_number;

  const kitchenItems = cart.saleItems.filter((it) => ['food', 'drink', 'combo', 'side'].includes(String(it.item_type || '').toLowerCase()));
  if (kitchenItems.length && !sale.replayed) {
    try {
      features.createKitchenOrder({
        sale_id: saleId, order_number: orderNumber, station: 'kiosk',
        items: kitchenItems.map((it) => ({ product_name: it.product_name, quantity: it.quantity, modifiers: it.modifiers_text }))
      }, actor.id);
    } catch (err) {
      logKioskError(dev, 'kitchen_sync_failure', err.message, { sale_id: saleId, order_number: orderNumber });
    }
  }

  const ko = dbRun(`INSERT INTO kiosk_orders (device_id, sale_id, order_number, status, total, payment_method, items_json, completed_at,
    client_request_id, client_created_at, sync_status, customer_id, branch_id, txn_seconds)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [dev.id, saleId, orderNumber, 'completed', payable, paymentMethod, JSON.stringify(cart.saleItems), nowIso(),
      clientRequestId, createdAtClient, orderData.queued_offline ? 'synced_after_offline' : 'synced', customerId, dev.branch_id || null,
      Number.isFinite(Number(orderData.txn_seconds)) ? Math.max(0, Math.min(86400, Math.round(Number(orderData.txn_seconds)))) : null]);
  dbRun('UPDATE kiosk_devices SET last_order_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), dev.id]);
  const koId = ko.lastInsertRowid
    || dbGet('SELECT id FROM kiosk_orders WHERE client_request_id = ? ORDER BY id DESC LIMIT 1', [clientRequestId])?.id;
  try { require('./order-sla').linkKioskOrder(saleId, koId, dev.id); } catch (_) { /* */ }
  audit({ device_id: dev.id, action: 'order_placed', entity_type: 'order', entity_id: koId, details: { sale_id: saleId, order_number: orderNumber, total: payable, client_request_id: clientRequestId } });

  let whatsappQueued = false;
  if (!sale.replayed) {
    try {
      const phone = webCustomer?.phone || (customerId ? store.getCustomer?.(customerId)?.phone : null);
      if (phone) {
        whatsappQueued = true;
        const shop = store.getSettingsParsed?.() || {};
        const cur = shop.currency || 'R';
        const lines = [
          `${shop.shop_name || 'Your order'}`,
          `Order #${orderNumber}`,
          `Total: ${cur}${Number(payable).toFixed(2)}`,
          `Payment: ${paymentMethod}`,
          '',
          ...(cart.saleItems || []).slice(0, 12).map((it) => `${it.quantity}× ${it.product_name}`),
          '',
          shop.receipt_footer || 'Thank you!'
        ];
        void web.sendCustomerWhatsApp(phone, lines.join('\n'), {
          message_type: 'sale_receipt',
          customer_id: customerId || webCustomer?.customer_id || null,
          recipient_name: webCustomer?.name || ''
        }).catch(() => {});
      }
    } catch (_) { /* receipt optional */ }
  }

  return {
    success: true, order_id: koId, sale_id: saleId, order_number: orderNumber,
    total: payable, payment_method: paymentMethod, status: 'completed', replayed: !!sale.replayed,
    client_request_id: clientRequestId, customer_linked: !!customerId,
    whatsapp_receipt: whatsappQueued
  };
}

function logKioskError(dev, type, message, context = {}, meta = {}) {
  try {
    ensureKiosk();
    dbRun(`INSERT INTO kiosk_error_log (device_id, branch_id, error_type, message, context_json, app_version, client_occurred_at)
      VALUES (?,?,?,?,?,?,?)`, [dev?.id || null, dev?.branch_id || null, String(type || 'unknown').slice(0, 60),
      String(message || '').slice(0, 1000), JSON.stringify(context || {}).slice(0, 4000), meta.app_version || null, meta.occurred_at || null]);
  } catch (_) { /* never block the kiosk on diagnostics */ }
}

const KIOSK_ERROR_TYPES = ['product_load_failure', 'payment_failure', 'api_timeout', 'network_failure', 'order_submission_failure',
  'sync_failure', 'printer_failure', 'receipt_failure', 'app_crash', 'kitchen_sync_failure', 'unknown'];

/** Device-reported diagnostics (batched); the kiosk sends these when it reconnects. */
function reportKioskErrors(deviceToken, errors = []) {
  const dev = resolveDevice(deviceToken);
  const list = Array.isArray(errors) ? errors.slice(0, 50) : [];
  for (const e of list) {
    const type = KIOSK_ERROR_TYPES.includes(e?.type) ? e.type : 'unknown';
    logKioskError(dev, type, e?.message, e?.context || {}, { app_version: e?.app_version, occurred_at: clientCreatedAt(e?.occurred_at) });
  }
  if (list.length) {
    try { dbRun('UPDATE kiosk_devices SET error_state = ?, updated_at = ? WHERE id = ?', [String(list[list.length - 1]?.message || 'error').slice(0, 300), nowIso(), dev.id]); } catch (_) { /* */ }
  }
  return { success: true, recorded: list.length };
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
  revokeDeviceAdmin, saveDeviceAdmin,
  approvePairing, rejectPairing, revokeDevice, saveDevice, listDevices, deviceHeartbeat, remoteCommand,
  getKioskCatalog, getKioskProductImage, validateKioskCart, placeKioskOrder, listKioskOrders,
  getKioskSettings, saveKioskSettings, runKioskTests,
  kioskHealth, listKioskErrors, reportKioskErrors, logKioskError, staleKiosksToNotify, utcMs,
  kioskCustomerLogin, kioskCustomerBenefits, kioskValidateCoupon, kioskCheckGiftCard,
  kioskPaymentMethodsFromSettings, kioskPaymentMethodIdsFromSettings, productHasImage, resolveProductPicture
};
