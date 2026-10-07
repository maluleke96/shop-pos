/**
 * Kitchen Display + Customer Order Display — device pairing, heartbeat, secured board access.
 */
const fs = require('fs');
const path = require('path');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, parseJson, hashToken, newToken
} = require('./biz-modules-common');

let _schemaDb = null;

function ensureOpsDisplay() {
  const dbMod = require('../database/db');
  const handle = dbMod.getDb();
  if (_schemaDb === handle) return;
  const pg = dbMod.isPgMode?.();
  try {
    const file = pg
      ? path.join(__dirname, '../../supabase/migrations/20261007_ops_display_devices.sql')
      : path.join(__dirname, '../database/migrations-v136-ops-ecosystem.sql');
    if (fs.existsSync(file)) {
      for (const stmt of fs.readFileSync(file, 'utf8').split(';').map((s) => s.trim()).filter(Boolean)) {
        try { dbMod.getDb().exec(stmt + ';'); } catch (e) {
          if (!/already exists/i.test(String(e.message))) { /* */ }
        }
      }
    }
  } catch (err) { console.warn('[ops-display] schema ensure failed:', err.message); }
  _schemaDb = handle;
}

function resolveDevice(deviceToken) {
  ensureOpsDisplay();
  if (!deviceToken) throw new Error('Device authentication required');
  const row = dbGet(
    'SELECT * FROM ops_display_devices WHERE token_hash = ? AND is_revoked = 0 AND is_active = 1',
    [hashToken(deviceToken)]
  );
  if (!row) throw new Error('Display device authentication failed');
  return row;
}

function requestPairing(deviceType, meta = {}) {
  ensureOpsDisplay();
  const type = String(deviceType || '').toLowerCase();
  if (!['kds', 'cds', 'kitchen', 'customer_display'].includes(type)) {
    throw new Error('device_type must be kds or cds');
  }
  const normalized = type === 'kitchen' ? 'kds' : type === 'customer_display' ? 'cds' : type;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = nowPlusDays(0, 0, 15);
  dbRun(
    'INSERT INTO ops_display_pairings (pairing_code, device_type, device_meta, expires_at) VALUES (?,?,?,?)',
    [code, normalized, JSON.stringify(meta || {}), expires]
  );
  return { pairing_code: code, device_type: normalized, expires_at: expires };
}

function pairingStatus(code) {
  ensureOpsDisplay();
  const row = dbGet('SELECT * FROM ops_display_pairings WHERE pairing_code = ? ORDER BY id DESC LIMIT 1', [String(code || '').trim()]);
  if (!row) return { status: 'unknown' };
  if (row.status === 'approved' && row.device_id) {
    const dev = dbGet('SELECT id, name, device_type, branch_id FROM ops_display_devices WHERE id = ?', [row.device_id]);
    const tokenRow = dbGet('SELECT token_plain FROM ops_display_token_cache WHERE device_id = ?', [row.device_id]);
    return {
      status: 'approved',
      device: dev,
      device_token: tokenRow?.token_plain || null
    };
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    dbRun("UPDATE ops_display_pairings SET status = 'expired' WHERE id = ?", [row.id]);
    return { status: 'expired' };
  }
  return { status: row.status || 'pending', device_type: row.device_type };
}

function listPendingPairingsAdmin() {
  ensureOpsDisplay();
  return dbAll(
    "SELECT * FROM ops_display_pairings WHERE status = 'pending' AND expires_at > ? ORDER BY id DESC",
    [nowIso()]
  );
}

function approvePairingAdmin(code, data = {}, actor) {
  ensureOpsDisplay();
  const row = dbGet("SELECT * FROM ops_display_pairings WHERE pairing_code = ? AND status = 'pending'", [String(code || '').trim()]);
  if (!row) throw new Error('Pairing code not found or already used');
  if (Date.parse(row.expires_at) < Date.now()) throw new Error('Pairing code expired');
  const name = String(data.name || '').trim() || (row.device_type === 'cds' ? 'Customer Display' : 'Kitchen Display');
  const branchId = data.branch_id != null ? Number(data.branch_id) : null;
  const token = newToken();
  const deviceCode = `OPS-${row.device_type.toUpperCase()}-${Date.now().toString(36).slice(-6)}`;
  const ins = dbRun(
    `INSERT INTO ops_display_devices (device_code, device_type, name, branch_id, token_hash, status, pairing_meta, config_json)
     VALUES (?,?,?,?,?,?,?,?)`,
    [deviceCode, row.device_type, name, branchId, hashToken(token), 'online', row.device_meta || '{}',
      JSON.stringify(data.config || {})]
  );
  const deviceId = ins.lastInsertRowid || dbGet('SELECT id FROM ops_display_devices WHERE device_code = ?', [deviceCode])?.id;
  try {
    dbRun(`CREATE TABLE IF NOT EXISTS ops_display_token_cache (
      device_id INTEGER PRIMARY KEY,
      token_plain TEXT NOT NULL
    )`);
    dbRun('INSERT OR REPLACE INTO ops_display_token_cache (device_id, token_plain) VALUES (?,?)', [deviceId, token]);
  } catch (_) {
    try { dbRun('INSERT INTO ops_display_token_cache (device_id, token_plain) VALUES (?,?) ON CONFLICT (device_id) DO UPDATE SET token_plain = EXCLUDED.token_plain', [deviceId, token]); } catch (__) { /* */ }
  }
  dbRun("UPDATE ops_display_pairings SET status = 'approved', device_id = ? WHERE id = ?", [deviceId, row.id]);
  try {
    const audit = require('./store').logActivity;
    audit?.({ action: 'ops_display_pair', details: { device_id: deviceId, type: row.device_type, name }, user_id: actor?.id, user_name: actor?.full_name });
  } catch (_) { /* */ }
  return { device_id: deviceId, device_token: token, name, device_type: row.device_type, branch_id: branchId };
}

function revokeDeviceAdmin(deviceId, actor) {
  ensureOpsDisplay();
  dbRun('UPDATE ops_display_devices SET is_revoked = 1, is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), Number(deviceId)]);
  try { dbRun('DELETE FROM ops_display_token_cache WHERE device_id = ?', [Number(deviceId)]); } catch (_) { /* */ }
  return { success: true };
}

function saveDeviceAdmin(deviceId, data = {}) {
  ensureOpsDisplay();
  const sets = [];
  const vals = [];
  if (data.name != null) { sets.push('name = ?'); vals.push(String(data.name).trim()); }
  if (data.branch_id !== undefined) { sets.push('branch_id = ?'); vals.push(data.branch_id != null ? Number(data.branch_id) : null); }
  if (data.is_active !== undefined) { sets.push('is_active = ?'); vals.push(data.is_active ? 1 : 0); }
  if (data.config != null) { sets.push('config_json = ?'); vals.push(JSON.stringify(data.config)); }
  if (!sets.length) return dbGet('SELECT * FROM ops_display_devices WHERE id = ?', [Number(deviceId)]);
  sets.push('updated_at = ?');
  vals.push(nowIso(), Number(deviceId));
  dbRun(`UPDATE ops_display_devices SET ${sets.join(', ')} WHERE id = ?`, vals);
  return dbGet('SELECT id, device_code, device_type, name, branch_id, is_active, status, app_version, last_heartbeat, config_json FROM ops_display_devices WHERE id = ?', [Number(deviceId)]);
}

function listDevicesAdmin() {
  ensureOpsDisplay();
  detectStaleDevices();
  return dbAll(
    `SELECT id, device_code, device_type, name, branch_id, is_active, status, app_version, latency_ms,
            last_heartbeat, last_sync_at, config_json, created_at
     FROM ops_display_devices WHERE is_revoked = 0 ORDER BY device_type, name`
  );
}

function detectStaleDevices() {
  ensureOpsDisplay();
  const cutoff = new Date(Date.now() - 120000).toISOString();
  try {
    dbRun("UPDATE ops_display_devices SET status = 'offline' WHERE is_revoked = 0 AND is_active = 1 AND (last_heartbeat IS NULL OR last_heartbeat < ?)", [cutoff]);
  } catch (_) { /* */ }
}

function deviceHeartbeat(deviceToken, payload = {}) {
  const dev = resolveDevice(deviceToken);
  const latency = Number(payload.latency_ms);
  dbRun(
    'UPDATE ops_display_devices SET status = ?, app_version = ?, latency_ms = ?, last_heartbeat = ?, last_sync_at = ?, updated_at = ? WHERE id = ?',
    ['online', payload.app_version || dev.app_version || null,
      Number.isFinite(latency) ? latency : dev.latency_ms,
      nowIso(), nowIso(), nowIso(), dev.id]
  );
  return { ok: true, server_time: nowIso(), device_id: dev.id, branch_id: dev.branch_id };
}

function getCdsSettingsFromStore() {
  try {
    const store = require('./store');
    const s = store.getSettingsParsed?.() || {};
    const rs = s.restaurant_settings || {};
    const cds = rs.cds_display || {};
    const kds = s.kds_alert_settings || {};
    return {
      shop_name: s.shop_name,
      logo_path: s.logo_path,
      cds_ready_sound: cds.ready_sound || s.cds_ready_sound || s.kds_notification_sound,
      announce_ready: cds.announce_ready !== false,
      announce_voice: cds.announce_voice !== false,
      public_mode: cds.public_mode !== false,
      sections: cds.sections || { received: true, preparing: true, ready: true, completed: false },
      section_labels: cds.section_labels || {},
      font_scale: cds.font_scale || 1,
      promo_message: cds.promo_message || '',
      branch_id: cds.branch_id || null,
      kds_alert: {
        volume: kds.volume != null ? kds.volume : 0.9,
        repeat_sec: kds.repeat_sec != null ? kds.repeat_sec : 60,
        enabled: kds.enabled !== false
      }
    };
  } catch (_) {
    return {};
  }
}

function getDeviceConfig(deviceToken) {
  const dev = resolveDevice(deviceToken);
  const global = getCdsSettingsFromStore();
  const local = parseJson(dev.config_json, {});
  const merged = { ...global, ...local, device: { id: dev.id, name: dev.name, type: dev.device_type, branch_id: dev.branch_id } };
  if (dev.branch_id != null) merged.branch_id = dev.branch_id;
  return merged;
}

function filterBranch(orders, branchId) {
  if (branchId == null) return orders;
  return (orders || []).filter((o) => o.branch_id == null || Number(o.branch_id) === Number(branchId));
}

function stripForCds(orders) {
  return (orders || []).map((o) => ({
    id: o.id,
    order_number: o.order_number || o.receipt_number,
    status: o.status,
    branch_id: o.branch_id,
    created_at: o.created_at,
    sla: o.sla ? { state: o.sla.state, timer_text: o.sla.timer_text } : undefined
  }));
}

function bulkKitchenStatusForDevice(deviceToken, ids, status, meta = {}) {
  const dev = resolveDevice(deviceToken);
  if (dev.device_type !== 'kds') throw new Error('Kitchen display device required');
  const features = require('./features');
  const actor = { id: null, username: `kds:${dev.name}`, full_name: dev.name, role: 'system' };
  return features.bulkUpdateKitchenOrderStatus(ids, status, actor, { ...(meta || {}), device_id: dev.id });
}

function getKitchenOrdersForDevice(deviceToken, statusFilter) {
  const dev = resolveDevice(deviceToken);
  if (!['kds', 'cds'].includes(dev.device_type)) throw new Error('Invalid display device type');
  const features = require('./features');
  const list = features.getKitchenOrders(statusFilter || 'pending,preparing,ready,collection');
  let filtered = filterBranch(Array.isArray(list) ? list : [], dev.branch_id);
  filtered = filtered.filter((o) => !['completed', 'cancelled', 'done'].includes(o.status));
  if (dev.device_type === 'cds') return stripForCds(filtered);
  return filtered;
}

function listUnifiedOpsDevices() {
  ensureOpsDisplay();
  const kiosk = require('./kiosk-platform');
  kiosk.ensureKiosk?.();
  let kiosks = [];
  let dt = [];
  try { kiosks = dbAll('SELECT id, name, location, branch_id, status, last_heartbeat, last_order_at, app_version FROM kiosk_devices WHERE is_revoked = 0'); } catch (_) { /* */ }
  try { dt = dbAll('SELECT id, name, lane_label, branch_id, status, updated_at FROM drive_thru_stations WHERE is_active = 1'); } catch (_) { /* */ }
  const displays = listDevicesAdmin();
  const rows = [];
  for (const k of kiosks) {
    rows.push({ kind: 'kiosk', id: k.id, name: k.name, branch_id: k.branch_id, status: k.status, last_active: k.last_heartbeat || k.last_order_at, app_version: k.app_version });
  }
  for (const s of dt) {
    rows.push({ kind: 'drive_thru', id: s.id, name: s.name, branch_id: s.branch_id, status: s.status, last_active: s.updated_at, app_version: null });
  }
  for (const d of displays) {
    rows.push({
      kind: d.device_type === 'cds' ? 'customer_display' : 'kitchen_display',
      id: d.id, name: d.name, branch_id: d.branch_id, status: d.status,
      last_active: d.last_heartbeat, app_version: d.app_version, is_active: d.is_active
    });
  }
  return rows;
}

function saveCdsDisplaySettings(data, actor) {
  const store = require('./store');
  const s = store.getSettingsParsed?.() || {};
  const rs = { ...(s.restaurant_settings || {}) };
  rs.cds_display = { ...(rs.cds_display || {}), ...(data || {}) };
  const aid = actor?.id;
  const aname = actor?.full_name || actor?.username || 'Admin';
  store.saveJsonSetting('restaurant_settings', rs, aid, aname);
  if (data?.ready_sound != null) {
    store.saveSettings({ cds_ready_sound: data.ready_sound }, aid, aname);
  }
  if (data?.kds_alert != null) {
    store.saveJsonSetting('kds_alert_settings', { ...(s.kds_alert_settings || {}), ...data.kds_alert }, aid, aname);
  }
  return getCdsSettingsFromStore();
}

module.exports = {
  ensureOpsDisplay,
  requestPairing,
  pairingStatus,
  listPendingPairingsAdmin,
  approvePairingAdmin,
  revokeDeviceAdmin,
  saveDeviceAdmin,
  listDevicesAdmin,
  deviceHeartbeat,
  getDeviceConfig,
  getKitchenOrdersForDevice,
  bulkKitchenStatusForDevice,
  listUnifiedOpsDevices,
  getCdsSettingsFromStore,
  saveCdsDisplaySettings,
  resolveDevice
};
