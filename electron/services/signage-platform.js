/**
 * Digital Signage & Shop Media Centre — devices, media, playlists, publishing, player API.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { assertUserActor } = require('./authz');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, parseJson, uid,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword, hashToken, newToken
} = require('./biz-modules-common');

const AUDIT = 'signage_audit_logs';
const ROLE_PERMS = {
  owner: { upload: true, playlist: true, menu: true, publish: true, pair: true, remote: true, users: true, settings: true, announce: true },
  admin: { upload: true, playlist: true, menu: true, publish: true, pair: true, remote: true, users: true, settings: true, announce: true },
  media_manager: { upload: true, playlist: true, menu: true, publish: true, pair: true, remote: true, announce: true },
  content_editor: { upload: true, playlist: true, menu: true, publish: false, pair: false, remote: false, announce: false },
  screen_operator: { upload: false, playlist: false, menu: false, publish: true, pair: false, remote: true, announce: true }
};

function ensureSignage() {
  try { dbGet('SELECT 1 FROM signage_settings LIMIT 1'); } catch (_) { /* */ }
  const files = ['migrations-v86.sql', 'migrations-v87.sql'];
  for (const file of files) {
    try {
      const p = path.join(__dirname, '../database', file);
      if (!fs.existsSync(p)) continue;
      const sql = fs.readFileSync(p, 'utf8');
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { getDb().exec(stmt + ';'); } catch (e) {
          if (!/duplicate column|already exists/i.test(String(e.message))) { /* ignore per-stmt */ }
        }
      }
    } catch (err) {
      console.warn(`[signage] ${file} ensure failed:`, err.message || err);
    }
  }
  try { dbGet('SELECT 1 FROM signage_settings LIMIT 1'); } catch (_) {
    try {
      const p = path.join(__dirname, '../database/migrations-v86.sql');
      if (fs.existsSync(p)) getDb().exec(fs.readFileSync(p, 'utf8'));
    } catch (__) { /* */ }
  }
  try { dbRun('INSERT OR IGNORE INTO signage_settings (id) VALUES (1)'); } catch (_) {
    try { dbRun('INSERT INTO signage_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING'); } catch (__) { /* */ }
  }
  try {
    const c = dbGet('SELECT COUNT(*) AS c FROM signage_centre_users')?.c || 0;
    if (c === 0) {
      dbRun('INSERT INTO signage_centre_users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
        ['signage', hashPassword('signage123'), 'Signage Administrator', 'admin']);
      console.log('[signage] Default admin created: signage / signage123');
    }
  } catch (_) { /* */ }
}

function getDb() { return require('../database/db').getDb(); }

function audit(row) {
  ensureSignage();
  try {
    dbRun(`INSERT INTO ${AUDIT} (user_id, user_name, device_id, action, entity_type, entity_id, details_json, result)
      VALUES (?,?,?,?,?,?,?,?)`,
      [row.user_id || null, row.user_name || null, row.device_id || null, row.action,
        row.entity_type || null, row.entity_id || null, JSON.stringify(row.details || {}), row.result || 'ok']);
  } catch (_) { /* */ }
}

function perms(role) { return ROLE_PERMS[role] || ROLE_PERMS.screen_operator; }

function assetsDir() {
  let base;
  try { base = require('../database/db').getDbDir?.() || path.join(process.cwd(), 'data'); } catch (_) {
    base = path.join(process.cwd(), 'data');
  }
  const dir = path.join(base, 'assets', 'signage');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveFileBase64(subdir, filename, dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid file data — expected base64 data URL');
  const buf = Buffer.from(m[2], 'base64');
  const safe = String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const rel = `signage/${subdir}/${Date.now()}_${safe}`;
  const full = path.join(assetsDir(), '..', rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return { rel, buf, mime: m[1], size: buf.length };
}

function resolvePortal(token) {
  ensureSignage();
  return resolveModuleSession('signage_sessions', 'signage_centre_users', token);
}

function requirePerm(token, perm) {
  const u = resolvePortal(token);
  if (!perms(u.role)[perm]) throw new Error('Permission denied');
  return u;
}

function resolveDevice(deviceToken) {
  ensureSignage();
  if (!deviceToken) throw new Error('Device authentication required');
  const row = dbGet(`SELECT * FROM signage_devices WHERE token_hash = ? AND is_revoked = 0`, [hashToken(deviceToken)]);
  if (!row) throw new Error('Device authentication failed');
  return row;
}

function mediaPublicPath(mediaId, token) {
  return `/signage-media/${mediaId}?token=${encodeURIComponent(token)}`;
}

// ─── Portal auth ─────────────────────────────────────────────────────────────

function signageLogin(username, password) {
  ensureSignage();
  const user = dbGet('SELECT * FROM signage_centre_users WHERE lower(username) = lower(?) AND is_active = 1', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('Invalid username or password');
  const sess = createModuleSession('signage_sessions', user.id);
  dbRun('UPDATE signage_centre_users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  audit({ user_id: user.id, user_name: user.username, action: 'login' });
  return {
    token: sess.token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions: perms(user.role) }
  };
}

function signageLogout(token) {
  try { dbRun('DELETE FROM signage_sessions WHERE token_hash = ?', [hashToken(token)]); } catch (_) { /* */ }
  return { success: true };
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

function requestPairing(meta = {}) {
  ensureSignage();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 600000).toISOString().slice(0, 19).replace('T', ' ');
  dbRun(`INSERT INTO signage_device_pairings (pairing_code, device_meta, expires_at) VALUES (?,?,?)`,
    [code, JSON.stringify(meta || {}), expires]);
  return { pairing_code: code, expires_in_seconds: 600 };
}

function pairingStatus(code) {
  ensureSignage();
  const row = dbGet('SELECT * FROM signage_device_pairings WHERE pairing_code = ? ORDER BY id DESC LIMIT 1', [code]);
  if (!row) return { status: 'not_found' };
  if (row.status === 'pending' && row.expires_at < nowIso()) {
    dbRun("UPDATE signage_device_pairings SET status = 'expired' WHERE id = ?", [row.id]);
    return { status: 'expired' };
  }
  if (row.status === 'approved' && row.device_id) {
    const meta = parseJson(row.device_meta, {});
    if (meta.device_token_once) {
      const deviceToken = meta.device_token_once;
      delete meta.device_token_once;
      dbRun('UPDATE signage_device_pairings SET device_meta = ? WHERE id = ?', [JSON.stringify(meta), row.id]);
      return { status: 'approved', device_id: row.device_id, device_token: deviceToken };
    }
    return { status: 'approved', device_id: row.device_id, device_token: null, message: 'Token already claimed — re-pair if needed' };
  }
  return { status: row.status };
}

function listPendingPairings(token) {
  requirePerm(token, 'pair');
  return dbAll(`SELECT * FROM signage_device_pairings WHERE status = 'pending' AND expires_at > ? ORDER BY id DESC`, [nowIso()]);
}

function approvePairing(code, data, portalToken) {
  const user = requirePerm(portalToken, 'pair');
  const row = dbGet('SELECT * FROM signage_device_pairings WHERE pairing_code = ? AND status = ?', [code, 'pending']);
  if (!row) throw new Error('Pairing code not found or expired');
  const deviceToken = newToken();
  const deviceCode = uid('TV');
  const meta = parseJson(row.device_meta, {});
  const name = String(data.name || meta.device_name || `Screen ${code}`).trim();
  const r = dbRun(`INSERT INTO signage_devices (device_code, name, location, group_id, status, token_hash, pairing_meta, orientation, player_version)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [deviceCode, name, data.location || null, data.group_id || null, 'online', hashToken(deviceToken),
      row.device_meta, data.orientation || 'landscape', meta.player_version || 'web']);
  const deviceId = r.lastInsertRowid;
  dbRun(`UPDATE signage_device_pairings SET status = 'approved', device_id = ?, approved_by = ?, device_meta = ? WHERE id = ?`,
    [deviceId, user.portal_user_id || user.id, JSON.stringify({ ...meta, device_token_once: deviceToken }), row.id]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, device_id: deviceId, action: 'device_paired', entity_type: 'device', entity_id: deviceId });
  return { device_id: deviceId, device_token: deviceToken, name };
}

function rejectPairing(code, portalToken) {
  const user = requirePerm(portalToken, 'pair');
  dbRun("UPDATE signage_device_pairings SET status = 'rejected', approved_by = ? WHERE pairing_code = ? AND status = 'pending'",
    [user.id, code]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'pairing_rejected', details: { code } });
  return { success: true };
}

function revokeDevice(deviceId, portalToken) {
  const user = requirePerm(portalToken, 'pair');
  dbRun(`UPDATE signage_devices SET is_revoked = 1, status = 'revoked', token_hash = NULL, updated_at = ? WHERE id = ?`, [nowIso(), deviceId]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, device_id: deviceId, action: 'device_revoked' });
  return { success: true };
}

// ─── Devices & dashboard ─────────────────────────────────────────────────────

function detectStaleDevices() {
  ensureSignage();
  const settings = dbGet('SELECT * FROM signage_settings WHERE id = 1') || {};
  const mins = Number(settings.offline_stale_minutes) || 3;
  const cutoff = new Date(Date.now() - mins * 60000).toISOString().slice(0, 19).replace('T', ' ');
  dbRun(`UPDATE signage_devices SET status = 'offline' WHERE is_revoked = 0 AND status = 'online' AND (last_heartbeat IS NULL OR last_heartbeat < ?)`, [cutoff]);
}

function signageDashboard(token) {
  resolvePortal(token);
  detectStaleDevices();
  const devices = dbAll('SELECT * FROM signage_devices WHERE is_revoked = 0 ORDER BY name');
  const total = devices.length;
  const online = devices.filter((d) => d.status === 'online').length;
  const media = dbGet('SELECT COUNT(*) AS c FROM signage_media WHERE is_active = 1') || {};
  const byType = dbAll('SELECT media_type, COUNT(*) AS c FROM signage_media WHERE is_active = 1 GROUP BY media_type');
  const lastPub = dbGet('SELECT * FROM signage_publications ORDER BY id DESC LIMIT 1');
  const pendingPub = dbGet("SELECT COUNT(*) AS c FROM signage_publication_devices WHERE status IN ('pending','downloading')")?.c || 0;
  const settings = dbGet('SELECT * FROM signage_settings WHERE id = 1') || {};
  return {
    screens: { total, online, offline: total - online, updating: devices.filter((d) => d.status === 'updating').length, error: devices.filter((d) => d.status === 'error').length },
    content: { total: media.c || 0, by_type: byType },
    devices,
    publishing: { last: lastPub, pending_devices: pendingPub },
    settings,
    groups: dbAll('SELECT * FROM signage_screen_groups ORDER BY name'),
    playlists: dbAll('SELECT id, name, version FROM signage_playlists ORDER BY name'),
    audio_playlists: dbAll('SELECT id, name FROM signage_audio_playlists ORDER BY name')
  };
}

function listDevices(token) {
  resolvePortal(token);
  detectStaleDevices();
  return dbAll('SELECT id, device_code, name, location, group_id, status, orientation, current_playlist_name, current_music_track, music_volume, last_heartbeat, last_online, error_state FROM signage_devices WHERE is_revoked = 0 ORDER BY name');
}

function saveDevice(data, token) {
  requirePerm(token, 'pair');
  if (!data.id) throw new Error('Device id required');
  dbRun(`UPDATE signage_devices SET name=?, location=?, group_id=?, orientation=?, music_volume=?, updated_at=? WHERE id=?`,
    [data.name, data.location || null, data.group_id || null, data.orientation || 'landscape', Number(data.music_volume) || 80, nowIso(), data.id]);
  return dbGet('SELECT * FROM signage_devices WHERE id = ?', [data.id]);
}

// ─── Media library ───────────────────────────────────────────────────────────

function listMedia(token, filters = {}) {
  resolvePortal(token);
  let sql = 'SELECT * FROM signage_media WHERE is_active = 1';
  const params = [];
  if (filters.media_type) { sql += ' AND media_type = ?'; params.push(filters.media_type); }
  if (filters.q) { sql += ' AND title LIKE ?'; params.push(`%${filters.q}%`); }
  sql += ' ORDER BY id DESC LIMIT 200';
  return dbAll(sql, params);
}

function uploadMedia(data, token) {
  const user = requirePerm(token, 'upload');
  const title = String(data.title || data.filename || 'Untitled').trim();
  const mediaType = data.media_type || guessMediaType(data.mime_type || data.filename);
  if (!data.file_data) throw new Error('File data required');
  const saved = saveFileBase64('media', data.filename || title, data.file_data);
  const r = dbRun(`INSERT INTO signage_media (media_type, category, title, file_path, mime_type, file_size, uploaded_by, uploaded_by_name)
    VALUES (?,?,?,?,?,?,?,?)`,
    [mediaType, data.category || 'general', title, saved.rel, saved.mime, saved.size, user.id, user.full_name || user.username]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'media_uploaded', entity_type: 'media', entity_id: r.lastInsertRowid, details: { title, size: saved.size } });
  return dbGet('SELECT * FROM signage_media WHERE id = ?', [r.lastInsertRowid]);
}

function guessMediaType(mimeOrName) {
  const s = String(mimeOrName || '').toLowerCase();
  if (s.includes('video')) return 'video';
  if (s.includes('audio')) return 'audio';
  return 'image';
}

function deleteMedia(id, token) {
  const user = requirePerm(token, 'upload');
  dbRun('UPDATE signage_media SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'media_deleted', entity_type: 'media', entity_id: id });
  return { success: true };
}

function getMediaFile(mediaId, authToken, isDevice = false) {
  ensureSignage();
  if (isDevice) resolveDevice(authToken);
  else resolvePortal(authToken);
  const m = dbGet('SELECT * FROM signage_media WHERE id = ? AND is_active = 1', [mediaId]);
  if (!m?.file_path) throw new Error('Media not found');
  const full = path.join(assetsDir(), '..', m.file_path);
  if (!fs.existsSync(full)) throw new Error('Media file missing on server');
  return { path: full, mime: m.mime_type || 'application/octet-stream', title: m.title };
}

// ─── Playlists ───────────────────────────────────────────────────────────────

function getPlaylist(id) {
  const p = dbGet('SELECT * FROM signage_playlists WHERE id = ?', [id]);
  if (!p) return null;
  p.items = dbAll(`SELECT pi.*, m.title AS media_title, m.media_type, m.file_path, m.mime_type, mn.name AS menu_name
    FROM signage_playlist_items pi
    LEFT JOIN signage_media m ON m.id = pi.media_id
    LEFT JOIN signage_menus mn ON mn.id = pi.menu_id
    WHERE pi.playlist_id = ? ORDER BY pi.sort_order, pi.id`, [id]);
  return p;
}

function savePlaylist(data, token) {
  const user = requirePerm(token, 'playlist');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Playlist name required');
  let playlistId = data.id;
  if (playlistId) {
    dbRun('UPDATE signage_playlists SET name=?, description=?, loop_enabled=?, shuffle=?, version=version+1, updated_at=? WHERE id=?',
      [name, data.description || null, data.loop_enabled !== false ? 1 : 0, data.shuffle ? 1 : 0, nowIso(), playlistId]);
    dbRun('DELETE FROM signage_playlist_items WHERE playlist_id = ?', [playlistId]);
  } else {
    const r = dbRun('INSERT INTO signage_playlists (name, description, loop_enabled, shuffle, created_by) VALUES (?,?,?,?,?)',
      [name, data.description || null, data.loop_enabled !== false ? 1 : 0, data.shuffle ? 1 : 0, user.id]);
    playlistId = r.lastInsertRowid;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  items.forEach((it, idx) => {
    dbRun(`INSERT INTO signage_playlist_items (playlist_id, item_type, media_id, menu_id, duration_seconds, transition, sort_order, use_video_audio, video_volume)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [playlistId, it.item_type || (it.menu_id ? 'menu' : 'media'), it.media_id || null, it.menu_id || null,
        Number(it.duration_seconds) || 8, it.transition || 'fade', idx, it.use_video_audio ? 1 : 0, Number(it.video_volume) || 100]);
  });
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'playlist_saved', entity_type: 'playlist', entity_id: playlistId });
  return getPlaylist(playlistId);
}

function listPlaylists(token) {
  resolvePortal(token);
  return dbAll('SELECT id, name, version, loop_enabled, shuffle, updated_at FROM signage_playlists ORDER BY name');
}

// ─── Menus ───────────────────────────────────────────────────────────────────

function getMenu(id) {
  const m = dbGet('SELECT * FROM signage_menus WHERE id = ?', [id]);
  if (!m) return null;
  m.items = dbAll('SELECT * FROM signage_menu_items WHERE menu_id = ? ORDER BY sort_order, id', [id]);
  m.settings = parseJson(m.settings_json, {});
  return m;
}

function saveMenu(data, token) {
  const user = requirePerm(token, 'menu');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Menu name required');
  let menuId = data.id;
  if (menuId) {
    dbRun(`UPDATE signage_menus SET name=?, template_key=?, title_text=?, settings_json=?, version=version+1, updated_at=? WHERE id=?`,
      [name, data.template_key || 'classic', data.title_text || name, JSON.stringify(data.settings || {}), nowIso(), menuId]);
    dbRun('DELETE FROM signage_menu_items WHERE menu_id = ?', [menuId]);
  } else {
    const r = dbRun('INSERT INTO signage_menus (name, template_key, title_text, settings_json) VALUES (?,?,?,?)',
      [name, data.template_key || 'classic', data.title_text || name, JSON.stringify(data.settings || {})]);
    menuId = r.lastInsertRowid;
  }
  for (const [idx, it] of (data.items || []).entries()) {
    dbRun(`INSERT INTO signage_menu_items (menu_id, product_id, name, description, price, category, image_media_id, is_promotion, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [menuId, it.product_id || null, it.name, it.description || null, Number(it.price) || 0, it.category || null,
        it.image_media_id || null, it.is_promotion ? 1 : 0, idx]);
  }
  return getMenu(menuId);
}

function syncMenuFromProducts(menuId, token) {
  const user = requirePerm(token, 'menu');
  const store = require('./store');
  const products = (store.getProducts?.({ active_only: true }) || []).filter((p) => p.is_active !== 0);
  const menu = getMenu(menuId);
  if (!menu) throw new Error('Menu not found');
  dbRun('DELETE FROM signage_menu_items WHERE menu_id = ?', [menuId]);
  products.slice(0, 100).forEach((p, idx) => {
    dbRun(`INSERT INTO signage_menu_items (menu_id, product_id, name, description, price, category, sort_order)
      VALUES (?,?,?,?,?,?,?)`,
      [menuId, p.id, p.name, p.description || null, Number(p.selling_price || p.price) || 0, p.category_name || p.category || null, idx]);
  });
  dbRun('UPDATE signage_menus SET sync_from_pos = 1, version = version + 1, updated_at = ? WHERE id = ?', [nowIso(), menuId]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'menu_synced_from_pos', entity_id: menuId, details: { count: products.length } });
  return getMenu(menuId);
}

function listMenus(token) {
  resolvePortal(token);
  return dbAll('SELECT id, name, version, title_text, updated_at FROM signage_menus ORDER BY name');
}

// ─── Audio playlists ─────────────────────────────────────────────────────────

function saveAudioPlaylist(data, token) {
  requirePerm(token, 'playlist');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Name required');
  let id = data.id;
  if (id) {
    dbRun('UPDATE signage_audio_playlists SET name=?, shuffle=?, repeat_mode=? WHERE id=?',
      [name, data.shuffle ? 1 : 0, data.repeat_mode || 'all', id]);
    dbRun('DELETE FROM signage_audio_items WHERE audio_playlist_id = ?', [id]);
  } else {
    const r = dbRun('INSERT INTO signage_audio_playlists (name, shuffle, repeat_mode) VALUES (?,?,?)',
      [name, data.shuffle ? 1 : 0, data.repeat_mode || 'all']);
    id = r.lastInsertRowid;
  }
  (data.items || []).forEach((mediaId, idx) => {
    dbRun('INSERT INTO signage_audio_items (audio_playlist_id, media_id, sort_order) VALUES (?,?,?)', [id, mediaId, idx]);
  });
  return { id, name };
}

function listAudioPlaylists(token) {
  resolvePortal(token);
  const rows = dbAll('SELECT * FROM signage_audio_playlists ORDER BY name');
  return rows.map((r) => ({ ...r, items: dbAll('SELECT media_id FROM signage_audio_items WHERE audio_playlist_id = ? ORDER BY sort_order', [r.id]) }));
}

// ─── Screen groups ───────────────────────────────────────────────────────────

function saveScreenGroup(data, token) {
  requirePerm(token, 'publish');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Group name required');
  if (data.id) {
    dbRun('UPDATE signage_screen_groups SET name=?, description=?, music_enabled=? WHERE id=?',
      [name, data.description || null, data.music_enabled !== false ? 1 : 0, data.id]);
    return dbGet('SELECT * FROM signage_screen_groups WHERE id = ?', [data.id]);
  }
  const r = dbRun('INSERT INTO signage_screen_groups (name, description, music_enabled) VALUES (?,?,?)',
    [name, data.description || null, data.music_enabled !== false ? 1 : 0]);
  return dbGet('SELECT * FROM signage_screen_groups WHERE id = ?', [r.lastInsertRowid]);
}

// ─── Publishing ──────────────────────────────────────────────────────────────

function resolveTargetDevices(targetType, targetIds) {
  if (targetType === 'all') return dbAll('SELECT id FROM signage_devices WHERE is_revoked = 0');
  if (targetType === 'group') {
    const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
    if (!ids.length) return [];
    return dbAll(`SELECT id FROM signage_devices WHERE is_revoked = 0 AND group_id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  if (targetType === 'devices') {
    const ids = (Array.isArray(targetIds) ? targetIds : [targetIds]).map(Number).filter(Boolean);
    if (!ids.length) return [];
    return dbAll(`SELECT id FROM signage_devices WHERE is_revoked = 0 AND id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
  return ids.map((id) => ({ id: Number(id) }));
}

function publishToScreens(data, token) {
  const user = requirePerm(token, 'publish');
  const playlistId = data.playlist_id;
  if (!playlistId) throw new Error('Playlist required');
  const playlist = getPlaylist(playlistId);
  if (!playlist?.items?.length) throw new Error('Playlist is empty or missing media');
  for (const it of playlist.items) {
    if (it.item_type === 'media' && it.media_id) {
      const m = dbGet('SELECT id, file_path FROM signage_media WHERE id = ? AND is_active = 1', [it.media_id]);
      if (!m?.file_path) throw new Error(`Playlist contains missing media (id ${it.media_id})`);
      const full = path.join(assetsDir(), '..', m.file_path);
      if (!fs.existsSync(full)) throw new Error(`Media file missing: ${m.file_path}`);
    }
  }
  const targetType = data.target_type || 'all';
  const targetIds = data.target_ids || [];
  const devices = resolveTargetDevices(targetType, targetIds);
  if (!devices.length) throw new Error('No target screens found');
  const r = dbRun(`INSERT INTO signage_publications (name, playlist_id, audio_playlist_id, target_type, target_ids_json, priority, status, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.name || playlist.name, playlistId, data.audio_playlist_id || null, targetType, JSON.stringify(targetIds),
      data.priority || 'normal', 'publishing', user.id, user.full_name || user.username]);
  const pubId = r.lastInsertRowid;
  let ok = 0; let fail = 0;
  for (const d of devices) {
    const dev = dbGet('SELECT status FROM signage_devices WHERE id = ?', [d.id]);
    const status = dev?.status === 'online' ? 'pending' : 'offline';
    if (status === 'offline') fail += 1; else ok += 1;
    dbRun('INSERT INTO signage_publication_devices (publication_id, device_id, status) VALUES (?,?,?)', [pubId, d.id, status]);
    dbRun(`UPDATE signage_devices SET current_playlist_id=?, current_playlist_name=?, current_audio_playlist_id=?, status='updating', updated_at=? WHERE id=?`,
      [playlistId, playlist.name, data.audio_playlist_id || null, nowIso(), d.id]);
    queueCommand(d.id, 'sync', { publication_id: pubId, playlist_id: playlistId, audio_playlist_id: data.audio_playlist_id || null }, user.id);
  }
  const finalStatus = fail === devices.length ? 'failed' : (fail > 0 ? 'partial' : 'completed');
  dbRun(`UPDATE signage_publications SET status=?, published_at=?, result_json=? WHERE id=?`,
    [finalStatus, nowIso(), JSON.stringify({ total: devices.length, online: ok, offline: fail }), pubId]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'published', entity_type: 'publication', entity_id: pubId, details: { playlist: playlist.name, devices: devices.length } });
  return {
    publication_id: pubId,
    status: finalStatus,
    devices: dbAll(`SELECT pd.*, d.name AS device_name FROM signage_publication_devices pd JOIN signage_devices d ON d.id = pd.device_id WHERE pd.publication_id = ?`, [pubId])
  };
}

function getPublicationStatus(pubId, token) {
  resolvePortal(token);
  return {
    publication: dbGet('SELECT * FROM signage_publications WHERE id = ?', [pubId]),
    devices: dbAll(`SELECT pd.*, d.name AS device_name, d.status AS device_status FROM signage_publication_devices pd JOIN signage_devices d ON d.id = pd.device_id WHERE pd.publication_id = ?`, [pubId])
  };
}

function queueCommand(deviceId, command, payload, userId) {
  dbRun('INSERT INTO signage_device_commands (device_id, command, payload_json, created_by) VALUES (?,?,?,?)',
    [deviceId, command, JSON.stringify(payload || {}), userId || null]);
  try {
    dbRun('UPDATE signage_devices SET command_version = COALESCE(command_version,0) + 1, updated_at = ? WHERE id = ?', [nowIso(), deviceId]);
    const { notifyDevice } = require('./signage-sse');
    notifyDevice(deviceId, 'command', { command, payload: payload || {} });
  } catch (_) { /* */ }
}

function remoteCommand(deviceId, command, payload, token) {
  const user = requirePerm(token, 'remote');
  queueCommand(deviceId, command, payload, user.id);
  audit({ user_id: user.id, user_name: user.full_name || user.username, device_id: deviceId, action: 'remote_command', details: { command } });
  return { success: true };
}

// ─── Player API ──────────────────────────────────────────────────────────────

function deviceHeartbeat(deviceToken, payload = {}) {
  const dev = resolveDevice(deviceToken);
  const now = nowIso();
  dbRun(`UPDATE signage_devices SET status='online', last_heartbeat=?, last_online=?, error_state=NULL,
    current_music_track=?, player_version=?, storage_json=?, network_json=?, updated_at=? WHERE id=?`,
    [now, now, payload.current_music_track || dev.current_music_track, payload.player_version || dev.player_version,
      JSON.stringify(payload.storage || {}), JSON.stringify(payload.network || {}), now, dev.id]);
  try {
    dbRun('INSERT INTO signage_device_heartbeats (device_id, status, payload_json) VALUES (?,?,?)',
      [dev.id, 'online', JSON.stringify(payload)]);
  } catch (_) { /* */ }
  return { success: true, server_time: now };
}

function getDeviceCommands(deviceToken) {
  const dev = resolveDevice(deviceToken);
  const cmds = dbAll(`SELECT id, command, payload_json FROM signage_device_commands WHERE device_id = ? AND status = 'pending' ORDER BY id LIMIT 20`, [dev.id]);
  return cmds.map((c) => ({ ...c, payload: parseJson(c.payload_json, {}) }));
}

function ackCommand(deviceToken, commandId, result = 'ok') {
  const dev = resolveDevice(deviceToken);
  dbRun(`UPDATE signage_device_commands SET status=?, acked_at=? WHERE id = ? AND device_id = ?`,
    [result === 'ok' ? 'acked' : 'failed', nowIso(), commandId, dev.id]);
  return { success: true };
}

function reportSync(deviceToken, publicationDeviceId, status, errorMessage) {
  const dev = resolveDevice(deviceToken);
  dbRun(`UPDATE signage_publication_devices SET status=?, error_message=?, synced_at=? WHERE id = ? AND device_id = ?`,
    [status, errorMessage || null, nowIso(), publicationDeviceId, dev.id]);
  if (status === 'playing' || status === 'ready') {
    dbRun(`UPDATE signage_devices SET status='online', last_sync=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), dev.id]);
  }
  return { success: true };
}

function listScreenGroups(token) {
  resolvePortal(token);
  const groups = dbAll('SELECT * FROM signage_screen_groups ORDER BY name');
  return groups.map((g) => ({
    ...g,
    device_count: dbGet('SELECT COUNT(*) AS c FROM signage_devices WHERE group_id = ? AND is_revoked = 0', [g.id])?.c || 0
  }));
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function scheduleMatchesNow(sch, now = new Date()) {
  if (!sch.is_active) return false;
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
  if (sch.day_of_week && !String(sch.day_of_week).toLowerCase().split(',').map((d) => d.trim()).includes(day)) return false;
  const dateStr = now.toISOString().slice(0, 10);
  if (sch.start_date && dateStr < sch.start_date) return false;
  if (sch.end_date && dateStr > sch.end_date) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes(sch.start_time);
  const end = timeToMinutes(sch.end_time);
  if (start != null && mins < start) return false;
  if (end != null && mins >= end) return false;
  return true;
}

const PRIORITY_RANK = { emergency: 4, urgent: 3, high: 2, normal: 1 };

function getActiveScheduleForDevice(dev) {
  const rows = dbAll(`SELECT * FROM signage_schedules WHERE is_active = 1 AND (
    target_type = 'all' OR (target_type = 'device' AND target_id = ?) OR (target_type = 'group' AND target_id = ?)
  )`, [dev.id, dev.group_id || -1]);
  const active = rows.filter((r) => scheduleMatchesNow(r));
  active.sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0));
  return active[0] || null;
}

function listSchedules(token) {
  resolvePortal(token);
  return dbAll('SELECT * FROM signage_schedules ORDER BY start_time, name');
}

function detectScheduleConflicts(data) {
  const conflicts = [];
  const rows = dbAll('SELECT * FROM signage_schedules WHERE is_active = 1');
  for (const other of rows) {
    if (data.id && other.id === data.id) continue;
    if (data.target_type !== other.target_type) continue;
    if (data.target_type !== 'all' && Number(data.target_id) !== Number(other.target_id)) continue;
    if (data.day_of_week && other.day_of_week && data.day_of_week !== other.day_of_week) continue;
    const a1 = timeToMinutes(data.start_time); const a2 = timeToMinutes(data.end_time);
    const b1 = timeToMinutes(other.start_time); const b2 = timeToMinutes(other.end_time);
    if (a1 == null || a2 == null || b1 == null || b2 == null) continue;
    if (a1 < b2 && b1 < a2) conflicts.push({ id: other.id, name: other.name });
  }
  return conflicts;
}

function saveSchedule(data, token) {
  const user = requirePerm(token, 'publish');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Schedule name required');
  const conflicts = detectScheduleConflicts(data);
  if (conflicts.length && !data.allow_conflict) {
    return { success: false, conflicts, message: 'Schedule conflict detected' };
  }
  const payload = {
    name, target_type: data.target_type || 'all', target_id: data.target_id || null,
    playlist_id: data.playlist_id || null, audio_playlist_id: data.audio_playlist_id || null,
    priority: data.priority || 'normal', day_of_week: data.day_of_week || null,
    start_time: data.start_time || null, end_time: data.end_time || null,
    start_date: data.start_date || null, end_date: data.end_date || null,
    is_recurring: data.is_recurring !== false ? 1 : 0, is_active: data.is_active !== false ? 1 : 0
  };
  if (data.id) {
    dbRun(`UPDATE signage_schedules SET name=?, target_type=?, target_id=?, playlist_id=?, audio_playlist_id=?, priority=?, day_of_week=?, start_time=?, end_time=?, start_date=?, end_date=?, is_recurring=?, is_active=? WHERE id=?`,
      [payload.name, payload.target_type, payload.target_id, payload.playlist_id, payload.audio_playlist_id,
        payload.priority, payload.day_of_week, payload.start_time, payload.end_time, payload.start_date, payload.end_date,
        payload.is_recurring, payload.is_active, data.id]);
    audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'schedule_updated', entity_id: data.id });
    return { success: true, schedule: dbGet('SELECT * FROM signage_schedules WHERE id = ?', [data.id]) };
  }
  const r = dbRun(`INSERT INTO signage_schedules (name, target_type, target_id, playlist_id, audio_playlist_id, priority, day_of_week, start_time, end_time, start_date, end_date, is_recurring, is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [payload.name, payload.target_type, payload.target_id, payload.playlist_id, payload.audio_playlist_id,
      payload.priority, payload.day_of_week, payload.start_time, payload.end_time, payload.start_date, payload.end_date,
      payload.is_recurring, payload.is_active]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'schedule_created', entity_id: r.lastInsertRowid });
  return { success: true, schedule: dbGet('SELECT * FROM signage_schedules WHERE id = ?', [r.lastInsertRowid]) };
}

function deleteSchedule(id, token) {
  const user = requirePerm(token, 'publish');
  dbRun('DELETE FROM signage_schedules WHERE id = ?', [id]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'schedule_deleted', entity_id: id });
  return { success: true };
}

function publishEmergency(data, token) {
  const user = requirePerm(token, 'publish');
  const playlistId = data.playlist_id;
  if (!playlistId) throw new Error('Emergency playlist required');
  const playlist = getPlaylist(playlistId);
  if (!playlist?.items?.length) throw new Error('Playlist empty');
  const targetType = data.target_type || 'all';
  const targetIds = data.target_ids || [];
  const devices = resolveTargetDevices(targetType, targetIds);
  const expiresAt = data.duration_minutes
    ? new Date(Date.now() + Number(data.duration_minutes) * 60000).toISOString().slice(0, 19).replace('T', ' ')
    : data.expires_at || null;
  const log = dbRun(`INSERT INTO signage_emergency_log (playlist_id, target_type, target_ids_json, started_by, expires_at) VALUES (?,?,?,?,?)`,
    [playlistId, targetType, JSON.stringify(targetIds), user.id, expiresAt]);
  for (const d of devices) {
    const dev = dbGet('SELECT * FROM signage_devices WHERE id = ?', [d.id]);
    dbRun(`UPDATE signage_devices SET saved_playlist_id=?, saved_audio_playlist_id=?, emergency_playlist_id=?, emergency_audio_playlist_id=?, emergency_until=?, updated_at=? WHERE id=?`,
      [dev.current_playlist_id, dev.current_audio_playlist_id, playlistId, data.audio_playlist_id || null, expiresAt, nowIso(), d.id]);
    queueCommand(d.id, 'sync', { emergency: true, playlist_id: playlistId }, user.id);
  }
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'emergency_published', entity_id: log.lastInsertRowid, details: { devices: devices.length } });
  return { success: true, devices: devices.length, expires_at: expiresAt };
}

function cancelEmergency(token, targetType = 'all', targetIds = []) {
  const user = requirePerm(token, 'publish');
  const devices = resolveTargetDevices(targetType, targetIds);
  for (const d of devices) {
    const dev = dbGet('SELECT * FROM signage_devices WHERE id = ?', [d.id]);
    if (dev.saved_playlist_id) {
      dbRun(`UPDATE signage_devices SET current_playlist_id=?, current_audio_playlist_id=?, emergency_playlist_id=NULL, emergency_until=NULL, saved_playlist_id=NULL, saved_audio_playlist_id=NULL, updated_at=? WHERE id=?`,
        [dev.saved_playlist_id, dev.saved_audio_playlist_id, nowIso(), d.id]);
    } else {
      dbRun(`UPDATE signage_devices SET emergency_playlist_id=NULL, emergency_until=NULL, updated_at=? WHERE id=?`, [nowIso(), d.id]);
    }
    queueCommand(d.id, 'sync', { emergency_cancelled: true }, user.id);
  }
  dbRun(`UPDATE signage_emergency_log SET status='cancelled', cancelled_at=? WHERE status='active'`, [nowIso()]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'emergency_cancelled' });
  return { success: true, devices: devices.length };
}

function clearExpiredEmergencies() {
  const now = nowIso();
  const expired = dbAll('SELECT id FROM signage_devices WHERE emergency_until IS NOT NULL AND emergency_until < ? AND is_revoked = 0', [now]);
  for (const d of expired) {
    const dev = dbGet('SELECT * FROM signage_devices WHERE id = ?', [d.id]);
    if (dev.saved_playlist_id) {
      dbRun(`UPDATE signage_devices SET current_playlist_id=?, current_audio_playlist_id=?, emergency_playlist_id=NULL, emergency_until=NULL, saved_playlist_id=NULL, saved_audio_playlist_id=NULL WHERE id=?`,
        [dev.saved_playlist_id, dev.saved_audio_playlist_id, d.id]);
    } else {
      dbRun('UPDATE signage_devices SET emergency_playlist_id=NULL, emergency_until=NULL WHERE id=?', [d.id]);
    }
    queueCommand(d.id, 'sync', {}, null);
  }
}

function getDeviceDiagnostics(deviceId, token) {
  resolvePortal(token);
  const dev = dbGet('SELECT * FROM signage_devices WHERE id = ?', [deviceId]);
  if (!dev) throw new Error('Device not found');
  return {
    device: dev,
    heartbeats: dbAll('SELECT * FROM signage_device_heartbeats WHERE device_id = ? ORDER BY id DESC LIMIT 20', [deviceId]),
    commands: dbAll('SELECT * FROM signage_device_commands WHERE device_id = ? ORDER BY id DESC LIMIT 20', [deviceId]),
    publications: dbAll(`SELECT pd.*, p.name AS pub_name FROM signage_publication_devices pd JOIN signage_publications p ON p.id = pd.publication_id WHERE pd.device_id = ? ORDER BY pd.id DESC LIMIT 10`, [deviceId])
  };
}

function listAuditLogs(token, limit = 100) {
  resolvePortal(token);
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  return dbAll('SELECT * FROM signage_audit_logs ORDER BY id DESC LIMIT ?', [lim]);
}

function buildPlaylistManifest(playlistId, audioPlaylistId, deviceToken, orientation) {
  let playlist = playlistId ? getPlaylist(playlistId) : null;
  let audioPlaylist = null;
  if (audioPlaylistId) {
    const ap = dbGet('SELECT * FROM signage_audio_playlists WHERE id = ?', [audioPlaylistId]);
    if (ap) {
      ap.tracks = dbAll(`SELECT m.* FROM signage_audio_items ai JOIN signage_media m ON m.id = ai.media_id WHERE ai.audio_playlist_id = ? ORDER BY ai.sort_order`, [audioPlaylistId]);
      audioPlaylist = ap;
    }
  }
  const mapMedia = (m) => m ? {
    id: m.id, title: m.title, media_type: m.media_type, mime_type: m.mime_type,
    url: deviceToken ? mediaPublicPath(m.id, deviceToken) : `/signage-media/${m.id}`,
    duration_seconds: m.duration_seconds, thumbnail_path: m.thumbnail_path
  } : null;
  const items = (playlist?.items || []).map((it) => {
    if (it.item_type === 'menu' && it.menu_id) {
      return { item_type: 'menu', duration_seconds: it.duration_seconds, transition: it.transition, menu: getMenu(it.menu_id) };
    }
    return {
      item_type: 'media', duration_seconds: it.duration_seconds, transition: it.transition,
      use_video_audio: !!it.use_video_audio, video_volume: it.video_volume,
      media: mapMedia(dbGet('SELECT * FROM signage_media WHERE id = ?', [it.media_id]))
    };
  });
  return {
    playlist: playlist ? { id: playlist.id, name: playlist.name, loop: !!playlist.loop_enabled, shuffle: !!playlist.shuffle, items } : null,
    audio_playlist: audioPlaylist ? {
      id: audioPlaylist.id, name: audioPlaylist.name, shuffle: !!audioPlaylist.shuffle,
      tracks: (audioPlaylist.tracks || []).map((t) => mapMedia(t))
    } : null,
    orientation: orientation || 'landscape'
  };
}

function previewPlaylist(playlistId, token, audioPlaylistId) {
  requirePerm(token, 'playlist');
  return buildPlaylistManifest(playlistId, audioPlaylistId, null, 'landscape');
}

function tryGenerateThumbnail(mediaId, token) {
  if (token) requirePerm(token, 'upload');
  let execSync;
  try {
    execSync = require('child_process').execSync;
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch (_) {
    return { success: false, status: 'NOT_AVAILABLE', message: 'FFmpeg not installed on server' };
  }
  const m = dbGet('SELECT * FROM signage_media WHERE id = ?', [mediaId]);
  if (!m?.file_path || m.media_type !== 'video') return { success: false, message: 'Not a video' };
  const full = path.join(assetsDir(), '..', m.file_path);
  const thumbRel = m.file_path.replace(/\.[^.]+$/, '_thumb.jpg');
  const thumbFull = path.join(assetsDir(), '..', thumbRel);
  try {
    execSync(`ffmpeg -y -i "${full}" -ss 00:00:01 -vframes 1 "${thumbFull}"`, { stdio: 'ignore' });
    dbRun('UPDATE signage_media SET thumbnail_path = ? WHERE id = ?', [thumbRel, mediaId]);
    return { success: true, thumbnail_path: thumbRel };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function runSignageTests() {
  ensureSignage();
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
  await add('schema', 'Database schema', async () => { dbGet('SELECT 1 FROM signage_settings LIMIT 1'); return { status: 'PASS' }; });
  await add('pairing', 'Pairing code generation', async () => {
    const p = requestPairing({ test: true });
    if (!p.pairing_code || p.pairing_code.length !== 6) throw new Error('Invalid code');
    return { status: 'PASS', message: `Code ${p.pairing_code}` };
  });
  await add('media_table', 'Media table', async () => {
    dbGet('SELECT COUNT(*) AS c FROM signage_media');
    return { status: 'PASS' };
  });
  await add('playlist_table', 'Playlist tables', async () => {
    dbGet('SELECT 1 FROM signage_playlists LIMIT 1');
    dbGet('SELECT 1 FROM signage_playlist_items LIMIT 1');
    return { status: 'PASS' };
  });
  await add('schedule_logic', 'Schedule matching', async () => {
    const ok = scheduleMatchesNow({ is_active: 1, start_time: '00:00', end_time: '23:59', day_of_week: 'sun,mon,tue,wed,thu,fri,sat' });
    if (!ok) throw new Error('Schedule should match');
    return { status: 'PASS' };
  });
  await add('permissions', 'Role permissions', async () => {
    if (!perms('screen_operator').remote) throw new Error('screen_operator should have remote');
    if (perms('content_editor').publish) throw new Error('content_editor should not publish');
    return { status: 'PASS' };
  });
  await add('ffmpeg', 'FFmpeg thumbnail', async () => {
    const r = tryGenerateThumbnail(-1);
    return { status: r.status === 'NOT_AVAILABLE' ? 'WARNING' : 'PASS', message: r.message || r.status };
  });
  await add('sse', 'SSE module', async () => {
    const sse = require('./signage-sse');
    if (typeof sse.notifyDevice !== 'function') throw new Error('SSE missing');
    return { status: 'PASS' };
  });
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  return { total: results.length, passed, failed, warnings, critical: failed, results, tested_at: nowIso() };
}

function resolveDeviceIdFromToken(deviceToken) {
  return resolveDevice(deviceToken).id;
}

function buildPlayerManifest(deviceToken) {
  clearExpiredEmergencies();
  const dev = resolveDevice(deviceToken);
  const settings = dbGet('SELECT * FROM signage_settings WHERE id = 1') || {};
  let playlistId = dev.current_playlist_id;
  let audioPlaylistId = dev.current_audio_playlist_id;
  let source = 'assigned';

  if (dev.emergency_playlist_id && (!dev.emergency_until || dev.emergency_until >= nowIso())) {
    playlistId = dev.emergency_playlist_id;
    audioPlaylistId = dev.emergency_audio_playlist_id || audioPlaylistId;
    source = 'emergency';
  } else {
    const sch = getActiveScheduleForDevice(dev);
    if (sch?.playlist_id) {
      playlistId = sch.playlist_id;
      audioPlaylistId = sch.audio_playlist_id || audioPlaylistId;
      source = 'schedule';
    }
  }

  const built = buildPlaylistManifest(playlistId, audioPlaylistId, deviceToken, dev.orientation);
  const emergency = dbGet(`SELECT * FROM signage_announcements WHERE is_active = 1 AND priority = 'emergency' ORDER BY id DESC LIMIT 1`);
  return {
    device: { id: dev.id, name: dev.name, orientation: dev.orientation, music_volume: dev.music_volume, status: dev.status },
    settings: {
      default_transition: settings.default_transition,
      ducking_volume: settings.ducking_volume,
      duck_fade_ms: settings.duck_fade_ms,
      heartbeat_interval_sec: settings.heartbeat_interval_sec,
      default_slide_duration: settings.default_slide_duration
    },
    playlist: built.playlist,
    audio_playlist: built.audio_playlist,
    content_source: source,
    emergency_announcement: emergency || null,
    command_version: dev.command_version || 0,
    server_time: nowIso()
  };
}

// ─── Announcements ───────────────────────────────────────────────────────────

async function generateAiVoice(text, token) {
  requirePerm(token, 'announce');
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, status: 'NOT_IMPLEMENTED', message: 'AI voice requires SHOP_POS_AI_API_KEY or OPENAI_API_KEY on server.' };
  }
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', input: String(text).slice(0, 4096), voice: 'alloy' })
  });
  if (!res.ok) throw new Error('TTS API failed');
  const buf = Buffer.from(await res.arrayBuffer());
  const b64 = `data:audio/mpeg;base64,${buf.toString('base64')}`;
  const saved = saveFileBase64('audio', 'ai-voice.mp3', b64);
  const r = dbRun(`INSERT INTO signage_media (media_type, category, title, file_path, mime_type, file_size) VALUES ('audio','announcement',?,?,?,?)`,
    [`AI: ${String(text).slice(0, 40)}`, saved.rel, saved.mime, saved.size]);
  return { success: true, media_id: r.lastInsertRowid };
}

function saveAnnouncement(data, token) {
  const user = requirePerm(token, 'announce');
  const title = String(data.title || 'Announcement').trim();
  let audioMediaId = data.audio_media_id;
  if (data.audio_data && !audioMediaId) {
    const saved = saveFileBase64('audio', data.filename || 'voice.webm', data.audio_data);
    const r = dbRun(`INSERT INTO signage_media (media_type, category, title, file_path, mime_type, file_size, uploaded_by) VALUES ('audio','announcement',?,?,?,?,?)`,
      [title, saved.rel, saved.mime, saved.size, user.id]);
    audioMediaId = r.lastInsertRowid;
  }
  const r = dbRun(`INSERT INTO signage_announcements (title, text_content, audio_media_id, volume, schedule_type, schedule_json, target_type, target_ids_json, priority, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [title, data.text_content || null, audioMediaId || null, Number(data.volume) || 100,
      data.schedule_type || 'once', JSON.stringify(data.schedule || {}), data.target_type || 'all',
      JSON.stringify(data.target_ids || []), data.priority || 'normal', user.id]);
  return dbGet('SELECT * FROM signage_announcements WHERE id = ?', [r.lastInsertRowid]);
}

function playNowAnnouncement(announcementId, token) {
  const user = requirePerm(token, 'announce');
  const ann = dbGet('SELECT * FROM signage_announcements WHERE id = ?', [announcementId]);
  if (!ann) throw new Error('Announcement not found');
  const devices = resolveTargetDevices(ann.target_type, parseJson(ann.target_ids_json, []));
  for (const d of devices) {
    queueCommand(d.id, 'play_announcement', { announcement_id: ann.id, audio_media_id: ann.audio_media_id, volume: ann.volume }, user.id);
  }
  dbRun('UPDATE signage_announcements SET last_played_at = ? WHERE id = ?', [nowIso(), announcementId]);
  audit({ user_id: user.id, user_name: user.full_name || user.username, action: 'announcement_play_now', entity_id: announcementId });
  return { success: true, devices: devices.length };
}

// ─── Users & settings ────────────────────────────────────────────────────────

function saveSignageUser(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureSignage();
  const username = String(data.username || '').trim();
  const fullName = String(data.full_name || username).trim();
  const role = data.role || 'screen_operator';
  if (!username) throw new Error('Username required');
  if (data.id) {
    const sets = ['full_name = ?', 'role = ?', 'is_active = ?', 'updated_at = ?'];
    const vals = [fullName, role, data.is_active !== false ? 1 : 0, nowIso()];
    if (data.password) { sets.push('password_hash = ?'); vals.push(hashPassword(data.password)); }
    vals.push(data.id);
    dbRun(`UPDATE signage_centre_users SET ${sets.join(', ')} WHERE id = ?`, vals);
    return dbGet('SELECT id, username, full_name, role, is_active FROM signage_centre_users WHERE id = ?', [data.id]);
  }
  if (!data.password || String(data.password).length < 6) throw new Error('Password min 6 chars required');
  const r = dbRun('INSERT INTO signage_centre_users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
    [username, hashPassword(data.password), fullName, role]);
  return dbGet('SELECT id, username, full_name, role, is_active FROM signage_centre_users WHERE id = ?', [r.lastInsertRowid]);
}

function listSignageUsers(actor) {
  assertUserActor(actor, ['owner', 'manager']);
  return dbAll('SELECT id, username, full_name, role, is_active, last_login_at FROM signage_centre_users ORDER BY full_name');
}

function getSignageSettings(token) {
  resolvePortal(token);
  return dbGet('SELECT * FROM signage_settings WHERE id = 1');
}

function saveSignageSettings(data, token) {
  requirePerm(token, 'settings');
  const fields = ['default_slide_duration', 'default_transition', 'default_volume', 'ducking_volume', 'duck_fade_ms', 'heartbeat_interval_sec', 'offline_stale_minutes'];
  const sets = []; const vals = [];
  for (const f of fields) {
    if (data[f] !== undefined) { sets.push(`${f} = ?`); vals.push(data[f]); }
  }
  if (sets.length) dbRun(`UPDATE signage_settings SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`, [...vals, nowIso()]);
  return getSignageSettings(token);
}

function signageSummary() {
  ensureSignage();
  detectStaleDevices();
  const total = dbGet('SELECT COUNT(*) AS c FROM signage_devices WHERE is_revoked = 0')?.c || 0;
  const online = dbGet("SELECT COUNT(*) AS c FROM signage_devices WHERE is_revoked = 0 AND status = 'online'")?.c || 0;
  const lastPub = dbGet('SELECT name, status, published_at FROM signage_publications ORDER BY id DESC LIMIT 1');
  return { total_screens: total, online_screens: online, offline_screens: total - online, last_publication: lastPub };
}

module.exports = {
  ensureSignage, signageLogin, signageLogout, signageDashboard, signageSummary,
  requestPairing, pairingStatus, listPendingPairings, approvePairing, rejectPairing, revokeDevice,
  listDevices, saveDevice, listMedia, uploadMedia, deleteMedia, getMediaFile,
  listPlaylists, getPlaylist, savePlaylist, listMenus, getMenu, saveMenu, syncMenuFromProducts,
  saveAudioPlaylist, listAudioPlaylists, saveScreenGroup, listScreenGroups, publishToScreens, getPublicationStatus,
  listSchedules, saveSchedule, deleteSchedule, detectScheduleConflicts,
  publishEmergency, cancelEmergency, previewPlaylist, getDeviceDiagnostics, listAuditLogs,
  deviceHeartbeat, getDeviceCommands, ackCommand, reportSync, buildPlayerManifest, resolveDeviceIdFromToken,
  generateAiVoice, saveAnnouncement, playNowAnnouncement, remoteCommand, tryGenerateThumbnail, runSignageTests,
  saveSignageUser, listSignageUsers, getSignageSettings, saveSignageSettings, mediaPublicPath
};
