/**
 * Chisanyama Connection Radio — platform service.
 * Separate module from Menu/Promo Studio. Reuses users + permissions JSON.
 * Multi-station ready via radio_stations.slug / branch_id.
 */
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, hashToken, newToken
} = require('./biz-modules-common');
const { hasUserPermission, loadUserById } = require('./authz');
const session = require('./session');
const ops = require('./radio-ops');

const PERM = {
  access: 'radio_studio_access',
  dashboard: 'radio_dashboard',
  mic: 'radio_live_mic',
  music: 'radio_music',
  playlists: 'radio_playlists',
  announcements: 'radio_announcements',
  mixer: 'radio_mixer',
  sfx: 'radio_sfx',
  calls: 'radio_calls',
  audience: 'radio_audience',
  broadcast: 'radio_broadcast',
  social: 'radio_social',
  schedule: 'radio_schedule',
  promotions: 'radio_promotions',
  analytics: 'radio_analytics',
  settings: 'radio_settings'
};

const ALL_FEATURE_KEYS = [
  'dashboard', 'mic', 'music', 'playlists', 'announcements', 'mixer', 'sfx',
  'calls', 'audience', 'broadcast', 'social', 'schedule', 'promotions', 'analytics', 'settings'
];

const MSG = {
  badCreds: 'Login unsuccessful. The details entered are incorrect. Please check your credentials and try again.',
  noAccess: 'Access not granted. Your account does not currently have permission to use Radio Studio. Please contact your administrator.',
  inactive: 'Account access unavailable. Your staff account is no longer active. Please contact your administrator for assistance.',
  revoked: 'Radio Studio access has been updated. Please sign in again.',
  sessionGone: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have permission for this Radio Studio action.'
};

function ensureSchema() {
  try {
    dbGet('SELECT 1 FROM radio_stations LIMIT 1');
  } catch (_) {
    try {
      const p = path.join(__dirname, '../database/migrations-v117-radio.sql');
      if (!fs.existsSync(p)) return;
      const sql = fs.readFileSync(p, 'utf8');
      const db = require('../database/db').getDb();
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { db.exec(`${stmt};`); } catch (e) {
          if (!/already exists|duplicate column/i.test(String(e.message))) { /* */ }
        }
      }
    } catch (_) { /* */ }
  }
  try { ops.ensureFunctionalSchema(); } catch (_) { /* */ }
  try { ensureDefaultStation(); } catch (_) { /* db may not be ready in unit tests */ }
}

function ensureDefaultStation() {
  const row = dbGet('SELECT id FROM radio_stations WHERE slug = ? LIMIT 1', ['main']);
  if (row) return row.id;
  try {
    const shop = shopBrand();
    dbRun(`
      INSERT INTO radio_stations (branch_id, name, slug, public_enabled, status, programme_title, programme_upcoming, settings_json)
      VALUES (NULL, ?, 'main', 1, 'off_air', 'Welcome to the Connection', 'Stay tuned for live shows', ?)
    `, [
      `${shop.shop_name || 'Chisanyama'} Connection Radio`,
      JSON.stringify({ tagline: 'Listen live · Order food · Stay connected' })
    ]);
  } catch (_) { /* */ }
  const created = dbGet('SELECT id FROM radio_stations WHERE slug = ? LIMIT 1', ['main']);
  if (created) {
    try {
      dbRun(`
        INSERT INTO radio_broadcast_state (station_id, mode, go_live, music_volume, mic_active, duck_level)
        VALUES (?, 'scheduled', 0, 0.7, 0, 1)
      `, [created.id]);
    } catch (_) { /* */ }
    seedSocialDefaults(created.id);
  }
  return created?.id || 1;
}

function seedSocialDefaults(stationId) {
  const existing = dbGet('SELECT id FROM radio_social_destinations WHERE station_id = ? LIMIT 1', [stationId]);
  if (existing) return;
  for (const [platform, label] of [
    ['youtube', 'YouTube Live'],
    ['facebook', 'Facebook Live'],
    ['tiktok', 'TikTok Live'],
    ['other', 'Custom RTMP']
  ]) {
    try {
      dbRun(`
        INSERT INTO radio_social_destinations (station_id, platform, label, enabled, status)
        VALUES (?, ?, ?, 0, 'disconnected')
      `, [stationId, platform, label]);
    } catch (_) { /* */ }
  }
}

function parsePermissions(user) {
  let perms = user?.permissions;
  if (typeof perms === 'string') {
    try { perms = JSON.parse(perms); } catch { perms = {}; }
  }
  return perms && typeof perms === 'object' ? perms : {};
}

function userIsActive(user) {
  if (!user) return false;
  if (String(user.role || '') === 'owner') return true;
  const v = user.is_active;
  if (v === false || v === 0 || v === '0' || v === 'f' || v === 'false' || v === 'n') return false;
  return true;
}

function radioFlags(user) {
  const empty = { access: false, any: false };
  ALL_FEATURE_KEYS.forEach((k) => { empty[k] = false; });
  if (!user) return empty;
  if (user.role === 'owner') {
    const all = { access: true, any: true };
    ALL_FEATURE_KEYS.forEach((k) => { all[k] = true; });
    return all;
  }
  const access = !!hasUserPermission(user, PERM.access);
  const flag = (key, legacyAlias) => {
    if (!access) return false;
    if (hasUserPermission(user, PERM[key])) return true;
    // Legacy: older grants without granular keys inherit from closest parent
    if (legacyAlias && hasUserPermission(user, PERM[legacyAlias])) return true;
    return false;
  };
  const flags = {
    access,
    dashboard: access && (flag('dashboard') || true),
    mic: flag('mic'),
    music: flag('music'),
    playlists: flag('playlists', 'music'),
    announcements: flag('announcements'),
    mixer: flag('mixer', 'mic'),
    sfx: flag('sfx', 'music'),
    calls: flag('calls'),
    audience: flag('audience'),
    broadcast: flag('broadcast', 'mic'),
    social: flag('social'),
    schedule: flag('schedule'),
    promotions: flag('promotions', 'announcements'),
    analytics: flag('analytics') || access,
    settings: flag('settings', 'schedule'),
    any: access
  };
  return flags;
}

function safeUser(user, flags) {
  const permissions = { radio_studio_access: !!flags.access };
  Object.keys(PERM).forEach((k) => {
    if (k === 'access') return;
    permissions[PERM[k]] = !!flags[k];
  });
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    branch_id: user.branch_id || null,
    permissions
  };
}

function requireFlag(flags, key) {
  if (!flags.any || !flags[key]) {
    const err = new Error(MSG.forbidden);
    err.code = 'RADIO_FORBIDDEN';
    throw err;
  }
}

function revokeUserSessions(userId) {
  ensureSchema();
  if (userId == null) return;
  dbRun('DELETE FROM radio_app_sessions WHERE user_id = ?', [userId]);
}

function resolveSession(token) {
  ensureSchema();
  if (!token) {
    const err = new Error(MSG.sessionGone);
    err.code = 'RADIO_SESSION';
    throw err;
  }
  const row = dbGet(`
    SELECT s.id AS session_id, s.expires_at, s.station_id AS session_station_id, u.*
    FROM radio_app_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, [hashToken(token), nowIso()]);
  if (!row) {
    const err = new Error(MSG.sessionGone);
    err.code = 'RADIO_SESSION';
    throw err;
  }
  if (!userIsActive(row)) {
    dbRun('DELETE FROM radio_app_sessions WHERE id = ?', [row.session_id]);
    const err = new Error(MSG.inactive);
    err.code = 'RADIO_INACTIVE';
    throw err;
  }
  const flags = radioFlags(row);
  if (!flags.any) {
    dbRun('DELETE FROM radio_app_sessions WHERE id = ?', [row.session_id]);
    const err = new Error(MSG.revoked);
    err.code = 'RADIO_REVOKED';
    throw err;
  }
  return { row, flags, stationId: row.session_station_id || defaultStationId() };
}

function defaultStationId() {
  ensureSchema();
  const row = dbGet('SELECT id FROM radio_stations WHERE slug = ? LIMIT 1', ['main']);
  return row?.id || ensureDefaultStation() || 1;
}

function getStation(stationIdOrSlug) {
  ensureSchema();
  if (stationIdOrSlug == null || stationIdOrSlug === '' || stationIdOrSlug === 'main') {
    return dbGet('SELECT * FROM radio_stations WHERE slug = ? LIMIT 1', ['main'])
      || dbGet('SELECT * FROM radio_stations ORDER BY id LIMIT 1');
  }
  if (Number.isFinite(Number(stationIdOrSlug)) && String(stationIdOrSlug).match(/^\d+$/)) {
    return dbGet('SELECT * FROM radio_stations WHERE id = ?', [Number(stationIdOrSlug)]);
  }
  return dbGet('SELECT * FROM radio_stations WHERE slug = ? LIMIT 1', [String(stationIdOrSlug)]);
}

function shopBrand() {
  try {
    const store = require('./store');
    const s = store.getSettingsParsed?.() || {};
    return {
      shop_name: s.shop_name || s.business_name || 'Chisanyama',
      currency: s.currency || 'R',
      logo_url: s.logo_url || s.logo || null,
      phone: s.phone || s.whatsapp || s.contact_phone || null,
      order_url: s.online_order_url || s.order_url || null,
      social_instagram: s.social_instagram || s.instagram || null,
      social_facebook: s.social_facebook || s.facebook || null,
      social_tiktok: s.social_tiktok || s.tiktok || null,
      social_youtube: s.social_youtube || s.youtube || null
    };
  } catch (_) {
    return { shop_name: 'Chisanyama', currency: 'R', logo_url: null };
  }
}

function listBranches() {
  try {
    return dbAll('SELECT id, name, address, phone FROM branches WHERE COALESCE(is_active,1) = 1 ORDER BY name') || [];
  } catch (_) {
    try {
      return dbAll('SELECT id, name, address, phone FROM branches ORDER BY name') || [];
    } catch {
      return [];
    }
  }
}

function listPromos() {
  try {
    const rows = dbAll(`
      SELECT id, name, description, price, promo_price, image_url
      FROM products
      WHERE COALESCE(is_active,1) = 1 AND (promo_price IS NOT NULL OR COALESCE(on_promo,0) = 1)
      ORDER BY updated_at DESC LIMIT 8
    `);
    return rows || [];
  } catch (_) {
    return [];
  }
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function broadcastState(stationId) {
  let st = dbGet('SELECT * FROM radio_broadcast_state WHERE station_id = ?', [stationId]);
  if (!st) {
    try {
      dbRun(`
        INSERT INTO radio_broadcast_state (station_id, mode, go_live, music_volume, mic_active, duck_level)
        VALUES (?, 'scheduled', 0, 0.7, 0, 1)
      `, [stationId]);
    } catch (_) { /* */ }
    st = dbGet('SELECT * FROM radio_broadcast_state WHERE station_id = ?', [stationId]);
  }
  return st || {
    station_id: stationId, mode: 'scheduled', go_live: 0, music_volume: 0.7,
    mic_active: 0, duck_level: 1, current_item_id: null, play_now_json: null
  };
}

function publicPayload(station) {
  const brand = shopBrand();
  const st = broadcastState(station.id);
  const settings = ops.parseStationSettings(station);
  const nowPlaying = parseJson(station.now_playing_json, null)
    || parseJson(st.play_now_json, null)
    || null;
  const live = station.status === 'live' || !!Number(st.go_live);
  const listeners = ops.countListeners(station.id);
  const prog = ops.currentProgramme(station.id, settings);
  const telephony = ops.telephonyStatus(settings);
  let playUrl = station.stream_url || null;
  if (nowPlaying?.audio_url) playUrl = nowPlaying.audio_url;
  else if (nowPlaying?.media_id) {
    const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [nowPlaying.media_id]);
    if (m) playUrl = ops.mediaPublicUrl(m.id, m.public_token);
  }
  const advert = parseJson(st.advert_json, null);
  let advertUrl = advert?.audio_url || null;
  if (!advertUrl && advert?.media_id) {
    const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [advert.media_id]);
    if (m) advertUrl = ops.mediaPublicUrl(m.id, m.public_token);
  }
  return {
    station: {
      id: station.id,
      slug: station.slug,
      name: station.name,
      status: live ? 'live' : 'off_air',
      programme_title: prog.active?.title || station.programme_title || 'Chisanyama Connection',
      programme_upcoming: prog.upcoming?.title || station.programme_upcoming || '',
      stream_url: station.stream_url || null,
      play_url: playUrl,
      call_phone: station.call_phone || brand.phone || null,
      logo_url: settings.logo_url || brand.logo_url || null,
      description: settings.description || null
    },
    now_playing: nowPlaying,
    advert: advert && advertUrl ? { ...advert, audio_url: advertUrl } : null,
    listeners,
    operator: {
      name: st.operator_name || null,
      user_id: st.operator_user_id || null
    },
    broadcast: {
      mode: st.mode,
      go_live: !!Number(st.go_live),
      mic_active: !!Number(st.mic_active),
      duck_level: Number(st.duck_level) || 1,
      music_volume: Number(st.music_volume) || 0.7,
      started_live_at: st.started_live_at || null,
      playback_state: st.playback_state || (live && playUrl ? 'playing' : 'stopped'),
      // Music via file URL; live voice via HTTP chunks (reliable) + optional WebRTC
      voice_live: !!(live && Number(st.mic_active)),
      voice_seq: Number(st.voice_seq) || 0,
      webrtc_voice: false
    },
    telephony,
    schedule_programme: prog,
    shop: brand,
    branches: listBranches(),
    promotions: listPromos(),
    social: {
      instagram: brand.social_instagram,
      facebook: brand.social_facebook,
      tiktok: brand.social_tiktok,
      youtube: brand.social_youtube
    },
    public_url_path: `/radio/${station.slug || 'main'}/`,
    studio_url_path: '/radio-studio/'
  };
}

/** Public — no auth */
function publicStatus(slug) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station || !Number(station.public_enabled)) {
    const err = new Error('Radio station is not available.');
    err.code = 'RADIO_OFF';
    throw err;
  }
  maybeTickAdsForStation(station.id);
  return publicPayload(station);
}

function publicChatList(slug, afterId) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) return { messages: [] };
  const aid = Number(afterId) || 0;
  const rows = dbAll(`
    SELECT id, author_name, body, is_staff, created_at
    FROM radio_chat_messages
    WHERE station_id = ? AND COALESCE(hidden,0) = 0 AND id > ?
    ORDER BY id ASC LIMIT 100
  `, [station.id, aid]) || [];
  return { messages: rows, station_id: station.id };
}

function publicChatPost(slug, payload) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station || !Number(station.public_enabled)) {
    const err = new Error('Chat is unavailable while the station is off.');
    err.code = 'RADIO_OFF';
    throw err;
  }
  const name = String(payload?.author_name || '').trim().slice(0, 40) || 'Listener';
  const body = String(payload?.body || '').trim().slice(0, 400);
  if (!body) throw new Error('Message cannot be empty');
  const authorKey = String(payload?.author_key || name).toLowerCase().slice(0, 80);
  const blocked = dbGet(
    'SELECT id FROM radio_chat_blocks WHERE station_id = ? AND author_key = ? LIMIT 1',
    [station.id, authorKey]
  );
  if (blocked) throw new Error('You are blocked from chat on this station.');
  dbRun(`
    INSERT INTO radio_chat_messages (station_id, author_name, body, is_staff, moderated, hidden, author_key)
    VALUES (?, ?, ?, 0, 0, 0, ?)
  `, [station.id, name, body, authorKey]);
  const row = dbGet('SELECT id, author_name, body, is_staff, created_at FROM radio_chat_messages WHERE station_id = ? ORDER BY id DESC LIMIT 1', [station.id]);
  return { message: row };
}

function publicListenerPing(slug, sessionKey, meta = {}) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station || !Number(station.public_enabled)) {
    return { listeners: 0 };
  }
  return ops.listenerPing(station.id, sessionKey, meta.user_agent || null);
}

function publicRequestCall(slug, payload = {}) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) throw new Error('Station not found');
  const settings = ops.parseStationSettings(station);
  const tel = ops.telephonyStatus(settings);
  if (!tel.configured) {
    const err = new Error(tel.message);
    err.code = 'RADIO_CALLS_UNCONFIGURED';
    throw err;
  }
  dbRun(`
    INSERT INTO radio_calls (station_id, caller_label, caller_phone, status, on_air, private_answer, started_at, provider)
    VALUES (?, ?, ?, 'ringing', 0, 0, ?, ?)
  `, [
    station.id,
    String(payload.caller_name || 'Listener').slice(0, 80),
    payload.caller_phone || station.call_phone || null,
    nowIso(),
    tel.provider
  ]);
  const call = dbGet('SELECT * FROM radio_calls WHERE station_id = ? ORDER BY id DESC LIMIT 1', [station.id]);
  return { call, telephony: tel };
}

function radioLogin(username, password, device = {}) {
  ensureSchema();
  const u = String(username || '').trim();
  const pass = String(password || '');
  const pin = device?.pin != null ? String(device.pin) : '';
  let user = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [u]);
  if (!user) {
    const err = new Error(MSG.badCreds);
    err.code = 'RADIO_BAD_CREDS';
    throw err;
  }
  if (!userIsActive(user)) {
    const err = new Error(MSG.inactive);
    err.code = 'RADIO_INACTIVE';
    throw err;
  }
  let passOk = false;
  try {
    passOk = !!(user.password_hash && bcrypt.compareSync(pass, user.password_hash));
  } catch (_) { passOk = false; }
  if (!passOk && user.pin && pass) {
    try {
      const { verifyPinWithUpgrade } = require('./pin');
      passOk = !!verifyPinWithUpgrade(user.pin, pass)?.ok;
    } catch (_) { /* */ }
  }
  if (!passOk) {
    const err = new Error(MSG.badCreds);
    err.code = 'RADIO_BAD_CREDS';
    throw err;
  }
  const flags = radioFlags(user);
  if (!flags.any) {
    const err = new Error(MSG.noAccess);
    err.code = 'RADIO_NO_ACCESS';
    throw err;
  }
  const stationId = defaultStationId();
  const token = newToken();
  const exp = nowPlusDays(14);
  dbRun(`
    INSERT INTO radio_app_sessions (user_id, station_id, token_hash, device_name, platform, expires_at)
    VALUES (?,?,?,?,?,?)
  `, [user.id, stationId, hashToken(token), device.device_name || null, device.platform || 'web', exp]);

  const { password_hash, pin: _pin, ...safe } = user;
  session.setUserSession(safe);

  return {
    token,
    user: safeUser(user, flags),
    access: flags,
    station: publicPayload(getStation(stationId)).station
  };
}

function radioLogout(token) {
  ensureSchema();
  if (token) dbRun('DELETE FROM radio_app_sessions WHERE token_hash = ?', [hashToken(token)]);
  return { success: true };
}

function radioProfile(token) {
  const { row, flags, stationId } = resolveSession(token);
  return {
    user: safeUser(row, flags),
    access: flags,
    shop: shopBrand(),
    station: publicPayload(getStation(stationId)),
    studio_url_path: '/radio-studio/',
    public_url_path: `/radio/${getStation(stationId)?.slug || 'main'}/`
  };
}

function radioCheck(token) {
  const { row, flags } = resolveSession(token);
  return { ok: true, access: flags, user: safeUser(row, flags) };
}

function studioSnapshot(token) {
  const { row, flags, stationId } = resolveSession(token);
  const station = getStation(stationId);
  const settings = ops.parseStationSettings(station);
  maybeTickAdsForStation(stationId);
  maybeApplyProgramme(stationId, settings);
  const st = broadcastState(stationId);
  const schedule = dbAll(`
    SELECT * FROM radio_schedule_items WHERE station_id = ? ORDER BY sort_order ASC, id ASC
  `, [stationId]) || [];
  const tracks = (dbAll(`
    SELECT * FROM radio_tracks WHERE station_id = ? AND COALESCE(enabled,1) = 1 ORDER BY id DESC LIMIT 200
  `, [stationId]) || []).map(ops.enrichTrack);
  const playlists = (dbAll(`SELECT * FROM radio_playlists WHERE station_id = ? ORDER BY id DESC`, [stationId]) || [])
    .map((pl) => ({ ...pl, items: ops.playlistItems(pl.id).map(ops.enrichTrack) }));
  const announcements = (dbAll(`
    SELECT * FROM radio_announcements WHERE station_id = ? ORDER BY id DESC LIMIT 50
  `, [stationId]) || []).map((a) => {
    if (a.media_id) {
      const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [a.media_id]);
      if (m) a.audio_url = ops.mediaPublicUrl(m.id, m.public_token);
    }
    return a;
  });
  const chat = dbAll(`
    SELECT * FROM radio_chat_messages WHERE station_id = ?
    ORDER BY id DESC LIMIT 80
  `, [stationId]) || [];
  const calls = dbAll(`
    SELECT * FROM radio_calls WHERE station_id = ? AND status NOT IN ('ended')
    ORDER BY id DESC LIMIT 20
  `, [stationId]) || [];
  const callHistory = dbAll(`
    SELECT * FROM radio_calls WHERE station_id = ? ORDER BY id DESC LIMIT 40
  `, [stationId]) || [];
  const socialRaw = dbAll(`SELECT * FROM radio_social_destinations WHERE station_id = ? ORDER BY id ASC`, [stationId]) || [];
  const social = socialRaw.map(ops.socialStatusRow);
  const folders = dbAll(`SELECT * FROM radio_folders WHERE station_id = ? ORDER BY name`, [stationId]) || [];
  const sfx = (dbAll(`SELECT * FROM radio_sfx WHERE station_id = ? ORDER BY id DESC`, [stationId]) || []).map((s) => {
    if (s.media_id) {
      const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [s.media_id]);
      if (m) s.audio_url = ops.mediaPublicUrl(m.id, m.public_token);
    }
    return s;
  });
  const programme = dbAll(`
    SELECT * FROM radio_programme_schedule WHERE station_id = ? ORDER BY start_time ASC
  `, [stationId]) || [];
  const audit = dbAll(`
    SELECT * FROM radio_audit WHERE station_id = ? ORDER BY id DESC LIMIT 40
  `, [stationId]) || [];
  const queue = parseJson(st.queue_json, { now: null, next: null, items: [] });
  const mixer = parseJson(st.mixer_json, {
    mic: 1, music: Number(st.music_volume) || 0.7, announcements: 1, sfx: 1, caller: 1, master: 0.9
  });

  return {
    user: safeUser(row, flags),
    access: flags,
    station: publicPayload(station),
    broadcast: { ...st, queue, mixer },
    schedule,
    tracks,
    playlists,
    announcements,
    chat: chat.reverse(),
    calls,
    call_history: callHistory,
    social,
    folders,
    sfx,
    programme,
    programme_now: ops.currentProgramme(stationId, settings),
    analytics: ops.analyticsSnapshot(stationId),
    telephony: ops.telephonyStatus(settings),
    ai_voice: ops.aiVoiceStatus(settings),
    audit,
    promotions_catalog: listPromos(),
    products_catalog: listProductsLite(),
    shop: shopBrand(),
    settings
  };
}

function listProductsLite() {
  try {
    return dbAll(`
      SELECT id, name, price, promo_price, description, image_url
      FROM products WHERE COALESCE(is_active,1) = 1
      ORDER BY name LIMIT 200
    `) || [];
  } catch (_) {
    return [];
  }
}

function maybeApplyProgramme(stationId, settings) {
  try {
    const st = broadcastState(stationId);
    if (Number(st.go_live) && st.mode === 'live_mic') return;
    const prog = ops.currentProgramme(stationId, settings);
    if (!prog.active) return;
    const station = getStation(stationId);
    if (station?.programme_title !== prog.active.title) {
      dbRun(`UPDATE radio_stations SET programme_title = ?, programme_upcoming = ?, updated_at = ? WHERE id = ?`, [
        prog.active.title,
        prog.upcoming?.title || null,
        nowIso(),
        stationId
      ]);
    }
    // Auto-start playlist for timed programme when nothing is playing
    const np = parseJson(station?.now_playing_json, null);
    if (!np && prog.active.playlist_id) {
      const items = ops.playlistItems(prog.active.playlist_id);
      if (items[0]) {
        const t = ops.enrichTrack(items[0]);
        setNowPlayingInternal(stationId, {
          title: t.title,
          artist: t.artist,
          kind: 'music',
          track_id: t.id,
          media_id: t.media_id,
          audio_url: t.audio_url,
          playlist_id: prog.active.playlist_id
        }, null);
      }
    }
  } catch (_) { /* */ }
}

function setNowPlayingInternal(stationId, np, userId) {
  const payload = { ...np, at: nowIso() };
  dbRun(`UPDATE radio_stations SET now_playing_json = ?, updated_at = ? WHERE id = ?`, [
    JSON.stringify(payload), nowIso(), stationId
  ]);
  dbRun(`
    UPDATE radio_broadcast_state SET play_now_json = ?, updated_at = ?, updated_by = ? WHERE station_id = ?
  `, [JSON.stringify(payload), nowIso(), userId || null, stationId]);
  return payload;
}

function setGoLive(token, on) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'broadcast');
  const live = !!on;
  const opName = row.full_name || row.username || 'Operator';
  dbRun(`
    UPDATE radio_broadcast_state
    SET go_live = ?, mode = ?, updated_at = ?, updated_by = ?,
        operator_name = ?, operator_user_id = ?,
        mic_active = CASE WHEN ? THEN mic_active ELSE 0 END,
        started_live_at = CASE WHEN ? THEN COALESCE(started_live_at, ?) ELSE NULL END,
        playback_state = CASE WHEN ? THEN COALESCE(playback_state, 'playing') ELSE 'stopped' END
    WHERE station_id = ?
  `, [
    live ? 1 : 0,
    live ? 'live' : 'scheduled',
    nowIso(),
    row.id,
    live ? opName : null,
    live ? row.id : null,
    live ? 1 : 0,
    live ? 1 : 0,
    nowIso(),
    live ? 1 : 0,
    stationId
  ]);
  dbRun(`
    UPDATE radio_stations SET status = ?, updated_at = ? WHERE id = ?
  `, [live ? 'live' : 'off_air', nowIso(), stationId]);
  if (live) {
    const dests = dbAll('SELECT * FROM radio_social_destinations WHERE station_id = ?', [stationId]) || [];
    dests.forEach((d) => {
      if (Number(d.enabled) && d.rtmp_url && d.stream_key) {
        dbRun(`UPDATE radio_social_destinations SET status = 'live', last_error = NULL, updated_at = ? WHERE id = ?`, [
          nowIso(), d.id
        ]);
      } else if (Number(d.enabled)) {
        dbRun(`UPDATE radio_social_destinations SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`, [
          'Stream credentials missing — configure RTMP URL and stream key.',
          nowIso(),
          d.id
        ]);
      }
    });
  } else {
    dbRun(`
      UPDATE radio_broadcast_state
      SET play_now_json = NULL, duck_level = 1, advert_json = NULL, mic_active = 0,
          playback_state = 'stopped', updated_at = ?
      WHERE station_id = ?
    `, [nowIso(), stationId]);
    dbRun(`
      UPDATE radio_social_destinations SET status = CASE
        WHEN rtmp_url IS NOT NULL AND rtmp_url != '' AND stream_key IS NOT NULL AND stream_key != '' AND enabled = 1 THEN 'ready'
        WHEN rtmp_url IS NOT NULL AND rtmp_url != '' AND stream_key IS NOT NULL AND stream_key != '' THEN 'configured'
        ELSE 'disconnected'
      END, updated_at = ? WHERE station_id = ?
    `, [nowIso(), stationId]);
    try { dbRun('DELETE FROM radio_live_peers WHERE station_id = ?', [stationId]); } catch (_) { /* */ }
  }
  ops.writeAudit(stationId, row, live ? 'started broadcast' : 'stopped broadcast', null);
  return studioSnapshot(token);
}

function setPlaybackState(token, state) {
  const { row, flags, stationId } = resolveSession(token);
  if (!flags.music && !flags.broadcast && !flags.mic) requireFlag(flags, 'music');
  const s = String(state || 'stopped');
  if (!['playing', 'paused', 'stopped'].includes(s)) throw new Error('Invalid playback state');
  dbRun(`
    UPDATE radio_broadcast_state
    SET playback_state = ?, updated_at = ?, updated_by = ?,
        operator_name = COALESCE(operator_name, ?),
        operator_user_id = COALESCE(operator_user_id, ?)
    WHERE station_id = ?
  `, [s, nowIso(), row.id, row.full_name || row.username, row.id, stationId]);
  if (s === 'playing') {
    dbRun(`UPDATE radio_broadcast_state SET go_live = 1, mode = 'music' WHERE station_id = ?`, [stationId]);
    dbRun(`UPDATE radio_stations SET status = 'live', updated_at = ? WHERE id = ?`, [nowIso(), stationId]);
  }
  return broadcastState(stationId);
}

function playAdvert(token, data = {}) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'announcements');
  let audioUrl = data.audio_url || null;
  let mediaId = data.media_id || null;
  if (data.file_data) {
    const media = ops.insertMedia(stationId, row.id, {
      kind: 'advert',
      title: data.title || 'Advert',
      filename: data.filename || 'advert.mp3',
      file_data: data.file_data,
      duration_sec: data.duration_sec
    });
    mediaId = media.id;
    audioUrl = ops.mediaPublicUrl(media.id, media.public_token);
  } else if (data.announcement_id) {
    const a = dbGet('SELECT * FROM radio_announcements WHERE id = ? AND station_id = ?', [
      Number(data.announcement_id), stationId
    ]);
    if (!a) throw new Error('Announcement not found');
    mediaId = a.media_id;
    audioUrl = a.audio_url;
    if (!audioUrl && mediaId) {
      const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [mediaId]);
      if (m) audioUrl = ops.mediaPublicUrl(m.id, m.public_token);
    }
    data.title = data.title || a.title;
  }
  if (!audioUrl) throw new Error('Advert needs an audio file');
  // Save into announcements library for reuse
  if (data.file_data) {
    dbRun(`
      INSERT INTO radio_announcements (station_id, title, body, voice_kind, audio_url, duration_sec, created_by, media_id, script_text)
      VALUES (?, ?, ?, 'advert', ?, ?, ?, ?, ?)
    `, [
      stationId,
      String(data.title || 'Advert').slice(0, 160),
      'Advert',
      audioUrl,
      data.duration_sec != null ? Number(data.duration_sec) : null,
      row.id,
      mediaId,
      'Advert'
    ]);
  }
  const musicMode = data.music_mode === 'stop' ? 'stop' : 'duck';
  const advert = {
    title: String(data.title || 'Advert').slice(0, 120),
    kind: 'advert',
    audio_url: audioUrl,
    media_id: mediaId,
    duck: musicMode === 'stop' ? 0 : (data.duck != null ? Number(data.duck) : 0.12),
    music_mode: musicMode,
    at: nowIso()
  };
  dbRun(`
    UPDATE radio_broadcast_state
    SET advert_json = ?, duck_level = ?, go_live = 1, playback_state = ?,
        updated_at = ?, updated_by = ?, operator_name = COALESCE(operator_name, ?), operator_user_id = COALESCE(operator_user_id, ?)
    WHERE station_id = ?
  `, [
    JSON.stringify(advert),
    advert.duck,
    musicMode === 'stop' ? 'paused' : 'playing',
    nowIso(),
    row.id,
    row.full_name || row.username,
    row.id,
    stationId
  ]);
  dbRun(`UPDATE radio_stations SET status = 'live', updated_at = ? WHERE id = ?`, [nowIso(), stationId]);
  ops.writeAudit(stationId, row, 'played advert', advert.title);
  return studioSnapshot(token);
}

function clearAdvert(token) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'announcements');
  dbRun(`
    UPDATE radio_broadcast_state SET advert_json = NULL, duck_level = 1, updated_at = ?, updated_by = ?
    WHERE station_id = ?
  `, [nowIso(), row.id, stationId]);
  // Resume music if it was stopped for advert
  const st = broadcastState(stationId);
  if (st.playback_state === 'stopped' && parseJson(st.play_now_json, null)?.title) {
    dbRun(`UPDATE radio_broadcast_state SET playback_state = 'playing' WHERE station_id = ?`, [stationId]);
  }
  return studioSnapshot(token);
}

/** Strong live voice — studio uploads short complete audio clips; listeners play them in order */
function pushVoiceChunk(token, data = {}) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'mic');
  if (!data.file_data) throw new Error('Voice chunk required');
  const st = broadcastState(stationId);
  const seq = (Number(st.voice_seq) || 0) + 1;
  const media = ops.insertMedia(stationId, row.id, {
    kind: 'voice',
    title: `voice-${seq}`,
    filename: data.filename || `voice_${seq}.webm`,
    file_data: data.file_data
  });
  dbRun(`INSERT INTO radio_voice_chunks (station_id, seq, media_id) VALUES (?, ?, ?)`, [
    stationId, seq, media.id
  ]);
  dbRun(`
    UPDATE radio_broadcast_state
    SET voice_seq = ?, voice_media_id = ?, mic_active = 1, go_live = 1,
        duck_level = ?, music_volume = ?, updated_at = ?, updated_by = ?,
        operator_name = COALESCE(operator_name, ?), operator_user_id = COALESCE(operator_user_id, ?)
    WHERE station_id = ?
  `, [
    seq,
    media.id,
    data.duck != null ? Number(data.duck) : 0.12,
    data.music_volume != null ? Number(data.music_volume) : 0.12,
    nowIso(),
    row.id,
    row.full_name || row.username,
    row.id,
    stationId
  ]);
  dbRun(`UPDATE radio_stations SET status = 'live', updated_at = ? WHERE id = ?`, [nowIso(), stationId]);
  // Keep only last ~40 chunks
  try {
    const old = dbAll(`
      SELECT id, media_id FROM radio_voice_chunks
      WHERE station_id = ? AND seq < ?
      ORDER BY seq ASC
    `, [stationId, seq - 40]) || [];
    old.forEach((o) => {
      dbRun('DELETE FROM radio_voice_chunks WHERE id = ?', [o.id]);
    });
  } catch (_) { /* */ }
  return {
    seq,
    audio_url: ops.mediaPublicUrl(media.id, media.public_token),
    listeners: ops.countListeners(stationId)
  };
}

function stopVoice(token) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'mic');
  dbRun(`
    UPDATE radio_broadcast_state
    SET mic_active = 0, duck_level = 1, music_volume = 0.85, updated_at = ?, updated_by = ?
    WHERE station_id = ?
  `, [nowIso(), row.id, stationId]);
  return { ok: true };
}

function publicVoiceChunks(slug, afterSeq) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) return { chunks: [], voice_live: false };
  maybeTickAdsForStation(station.id);
  const st = broadcastState(station.id);
  const after = Number(afterSeq) || 0;
  const rows = dbAll(`
    SELECT c.seq, c.media_id, m.public_token
    FROM radio_voice_chunks c
    JOIN radio_media_files m ON m.id = c.media_id
    WHERE c.station_id = ? AND c.seq > ?
    ORDER BY c.seq ASC LIMIT 12
  `, [station.id, after]) || [];
  return {
    voice_live: !!Number(st.mic_active),
    voice_seq: Number(st.voice_seq) || 0,
    duck_level: Number(st.duck_level) || 1,
    chunks: rows.map((r) => ({
      seq: r.seq,
      audio_url: ops.mediaPublicUrl(r.media_id, r.public_token)
    }))
  };
}

function scheduleAdvertJob(token, data = {}) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'announcements');
  const runAt = String(data.run_at || '').trim();
  if (!runAt) throw new Error('Schedule time required (date + hour:minute:second)');
  let mediaId = data.media_id || null;
  let announcementId = data.announcement_id || null;
  if (data.file_data) {
    const media = ops.insertMedia(stationId, row.id, {
      kind: 'advert',
      title: data.title || 'Advert',
      filename: data.filename || 'advert.mp3',
      file_data: data.file_data,
      duration_sec: data.duration_sec
    });
    mediaId = media.id;
    dbRun(`
      INSERT INTO radio_announcements (station_id, title, body, voice_kind, audio_url, duration_sec, created_by, media_id, schedule_at, music_mode)
      VALUES (?, ?, 'Advert', 'advert', ?, ?, ?, ?, ?, ?)
    `, [
      stationId,
      String(data.title || 'Advert').slice(0, 160),
      ops.mediaPublicUrl(media.id, media.public_token),
      data.duration_sec != null ? Number(data.duration_sec) : null,
      row.id,
      mediaId,
      runAt,
      data.music_mode === 'stop' ? 'stop' : 'duck'
    ]);
    announcementId = dbGet('SELECT id FROM radio_announcements WHERE station_id = ? ORDER BY id DESC LIMIT 1', [stationId])?.id;
  }
  if (!mediaId && !announcementId) throw new Error('Upload advert audio or pick an existing advert');
  dbRun(`
    INSERT INTO radio_advert_jobs (station_id, title, media_id, announcement_id, run_at, music_mode, duck_level, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
  `, [
    stationId,
    String(data.title || 'Advert').slice(0, 120),
    mediaId,
    announcementId,
    runAt,
    data.music_mode === 'stop' ? 'stop' : 'duck',
    data.duck_level != null ? Number(data.duck_level) : 0.12,
    row.id
  ]);
  ops.writeAudit(stationId, row, 'scheduled advert', `${data.title} @ ${runAt}`);
  return studioSnapshot(token);
}

function listAdvertJobs(token) {
  const { stationId } = resolveSession(token);
  tickAdvertJobs(stationId);
  return {
    jobs: dbAll(`
      SELECT * FROM radio_advert_jobs WHERE station_id = ?
      ORDER BY run_at ASC LIMIT 50
    `, [stationId]) || []
  };
}

function tickAdvertJobs(stationId) {
  const due = dbAll(`
    SELECT * FROM radio_advert_jobs
    WHERE station_id = ? AND status = 'scheduled' AND datetime(run_at) <= datetime('now')
    ORDER BY run_at ASC LIMIT 5
  `, [stationId]) || [];
  due.forEach((job) => {
    let audioUrl = null;
    let mediaId = job.media_id;
    if (job.announcement_id) {
      const a = dbGet('SELECT * FROM radio_announcements WHERE id = ?', [job.announcement_id]);
      if (a) {
        audioUrl = a.audio_url;
        mediaId = mediaId || a.media_id;
      }
    }
    if (!audioUrl && mediaId) {
      const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [mediaId]);
      if (m) audioUrl = ops.mediaPublicUrl(m.id, m.public_token);
    }
    if (!audioUrl) {
      dbRun(`UPDATE radio_advert_jobs SET status = 'error' WHERE id = ?`, [job.id]);
      return;
    }
    const musicMode = job.music_mode === 'stop' ? 'stop' : 'duck';
    const duck = musicMode === 'stop' ? 0 : (Number(job.duck_level) || 0.12);
    const advert = {
      title: job.title,
      kind: 'advert',
      audio_url: audioUrl,
      media_id: mediaId,
      duck,
      music_mode: musicMode,
      at: nowIso()
    };
    dbRun(`
      UPDATE radio_broadcast_state
      SET advert_json = ?, duck_level = ?, go_live = 1,
          playback_state = CASE WHEN ? = 'stop' THEN 'paused' ELSE playback_state END,
          updated_at = ?
      WHERE station_id = ?
    `, [JSON.stringify(advert), duck, musicMode, nowIso(), stationId]);
    dbRun(`UPDATE radio_stations SET status = 'live', updated_at = ? WHERE id = ?`, [nowIso(), stationId]);
    dbRun(`UPDATE radio_advert_jobs SET status = 'played' WHERE id = ?`, [job.id]);
  });
}

function maybeTickAdsForStation(stationId) {
  try { tickAdvertJobs(stationId); } catch (_) { /* */ }
}

function setMicDuck(token, payload) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'mic');
  const micActive = payload?.mic_active != null ? !!payload.mic_active : undefined;
  const duck = payload?.duck_level != null ? Math.max(0.05, Math.min(1, Number(payload.duck_level))) : undefined;
  const musicVol = payload?.music_volume != null ? Math.max(0, Math.min(1, Number(payload.music_volume))) : undefined;
  const st = broadcastState(stationId);
  dbRun(`
    UPDATE radio_broadcast_state
    SET mic_active = ?, duck_level = ?, music_volume = ?, updated_at = ?, updated_by = ?
    WHERE station_id = ?
  `, [
    micActive != null ? (micActive ? 1 : 0) : st.mic_active,
    duck != null ? duck : st.duck_level,
    musicVol != null ? musicVol : st.music_volume,
    nowIso(),
    row.id,
    stationId
  ]);
  return broadcastState(stationId);
}

function updateNowPlaying(token, payload) {
  const { row, flags, stationId } = resolveSession(token);
  if (!flags.music && !flags.announcements && !flags.broadcast && !flags.mic) {
    requireFlag(flags, 'music');
  }
  const np = setNowPlayingInternal(stationId, {
    title: String(payload?.title || 'On air').slice(0, 120),
    artist: String(payload?.artist || '').slice(0, 120),
    kind: String(payload?.kind || 'music'),
    track_id: payload?.track_id || null,
    media_id: payload?.media_id || null,
    audio_url: payload?.audio_url || null,
    playlist_id: payload?.playlist_id || null
  }, row.id);
  ops.writeAudit(stationId, row, 'changed now playing', np.title);
  return { now_playing: np };
}

function playNow(token, payload) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'announcements');
  let audioUrl = payload?.audio_url || null;
  if (payload?.media_id) {
    const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [Number(payload.media_id)]);
    if (m) audioUrl = ops.mediaPublicUrl(m.id, m.public_token);
  }
  const item = {
    title: String(payload?.title || 'Urgent announcement').slice(0, 120),
    kind: String(payload?.kind || 'announcement'),
    body: String(payload?.body || '').slice(0, 500),
    audio_url: audioUrl,
    media_id: payload?.media_id || null,
    at: nowIso()
  };
  dbRun(`
    UPDATE radio_broadcast_state
    SET mode = 'play_now', play_now_json = ?, go_live = 1, updated_at = ?, updated_by = ?
    WHERE station_id = ?
  `, [JSON.stringify(item), nowIso(), row.id, stationId]);
  dbRun(`UPDATE radio_stations SET now_playing_json = ?, status = 'live', updated_at = ? WHERE id = ?`, [
    JSON.stringify({ title: item.title, artist: 'Studio', kind: item.kind, audio_url: audioUrl, media_id: item.media_id, at: item.at }),
    nowIso(),
    stationId
  ]);
  ops.writeAudit(stationId, row, 'played announcement', item.title);
  return studioSnapshot(token);
}

function saveSchedule(token, items) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'schedule');
  const list = Array.isArray(items) ? items : [];
  dbRun('DELETE FROM radio_schedule_items WHERE station_id = ?', [stationId]);
  list.forEach((it, i) => {
    dbRun(`
      INSERT INTO radio_schedule_items (station_id, kind, ref_id, title, sort_order, duration_sec, status, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      stationId,
      String(it.kind || 'music'),
      it.ref_id != null ? Number(it.ref_id) : null,
      String(it.title || 'Item').slice(0, 160),
      i,
      it.duration_sec != null ? Number(it.duration_sec) : null,
      String(it.status || 'queued'),
      it.meta ? JSON.stringify(it.meta) : null
    ]);
  });
  return studioSnapshot(token);
}

function addTrack(token, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'music');
  let mediaId = data?.media_id || null;
  let sourceUrl = data?.source_url || null;
  let duration = data?.duration_sec != null ? Number(data.duration_sec) : null;
  if (data?.file_data) {
    const media = ops.insertMedia(stationId, row.id, {
      kind: 'music',
      title: data.title,
      artist: data.artist,
      filename: data.filename,
      file_data: data.file_data,
      duration_sec: duration,
      folder_id: data.folder_id
    });
    mediaId = media.id;
    sourceUrl = ops.mediaPublicUrl(media.id, media.public_token);
    duration = media.duration_sec || duration;
  }
  dbRun(`
    INSERT INTO radio_tracks (station_id, title, artist, duration_sec, source_url, source_kind, tags, enabled, media_id, folder_id, file_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `, [
    stationId,
    String(data?.title || 'Untitled').slice(0, 160),
    String(data?.artist || '').slice(0, 120),
    duration,
    sourceUrl,
    String(data?.source_kind || (mediaId ? 'upload' : 'library')),
    data?.tags || null,
    mediaId,
    data?.folder_id != null ? Number(data.folder_id) : null,
    mediaId ? 'ready' : (sourceUrl ? 'ready' : 'missing')
  ]);
  ops.writeAudit(stationId, row, 'uploaded music', data?.title);
  return studioSnapshot(token);
}

function deleteTrack(token, trackId) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'music');
  const t = dbGet('SELECT * FROM radio_tracks WHERE id = ? AND station_id = ?', [Number(trackId), stationId]);
  if (!t) throw new Error('Track not found');
  dbRun('DELETE FROM radio_playlist_items WHERE track_id = ?', [t.id]);
  dbRun('UPDATE radio_tracks SET enabled = 0 WHERE id = ?', [t.id]);
  ops.writeAudit(stationId, row, 'deleted music', t.title);
  return studioSnapshot(token);
}

function updateTrack(token, trackId, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'music');
  dbRun(`
    UPDATE radio_tracks SET
      title = COALESCE(?, title),
      artist = COALESCE(?, artist),
      tags = COALESCE(?, tags),
      folder_id = COALESCE(?, folder_id),
      duration_sec = COALESCE(?, duration_sec)
    WHERE id = ? AND station_id = ?
  `, [
    data?.title ?? null,
    data?.artist ?? null,
    data?.tags ?? null,
    data?.folder_id != null ? Number(data.folder_id) : null,
    data?.duration_sec != null ? Number(data.duration_sec) : null,
    Number(trackId),
    stationId
  ]);
  ops.writeAudit(stationId, row, 'edited music metadata', trackId);
  return studioSnapshot(token);
}

function addAnnouncement(token, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'announcements');
  const station = getStation(stationId);
  const settings = ops.parseStationSettings(station);
  let mediaId = data?.media_id || null;
  let audioUrl = data?.audio_url || null;
  let voiceKind = String(data?.voice_kind || 'upload');
  if (voiceKind === 'ai') {
    const ai = ops.aiVoiceStatus(settings);
    if (!ai.configured) {
      const err = new Error(ai.message);
      err.code = 'RADIO_AI_UNCONFIGURED';
      throw err;
    }
    // Integration hook — generation happens when provider credentials are set
    throw new Error('AI voice provider is configured but generation adapter is not connected yet. Upload or record audio.');
  }
  if (data?.file_data) {
    const media = ops.insertMedia(stationId, row.id, {
      kind: 'announcement',
      title: data.title || 'Announcement',
      filename: data.filename || 'announcement.webm',
      file_data: data.file_data,
      duration_sec: data.duration_sec
    });
    mediaId = media.id;
    audioUrl = ops.mediaPublicUrl(media.id, media.public_token);
    voiceKind = 'upload';
  }
  dbRun(`
    INSERT INTO radio_announcements (station_id, title, body, voice_kind, audio_url, duration_sec, scheduled_at, created_by, media_id, script_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    stationId,
    String(data?.title || 'Announcement').slice(0, 160),
    String(data?.body || data?.script || '').slice(0, 2000),
    voiceKind,
    audioUrl,
    data?.duration_sec != null ? Number(data.duration_sec) : null,
    data?.scheduled_at || null,
    row.id,
    mediaId,
    String(data?.script || data?.body || '').slice(0, 2000)
  ]);
  ops.writeAudit(stationId, row, 'saved announcement', data?.title);
  return studioSnapshot(token);
}

function hideChatMessage(token, messageId, hidden) {
  const { flags, stationId } = resolveSession(token);
  requireFlag(flags, 'audience');
  dbRun(`UPDATE radio_chat_messages SET hidden = ?, moderated = 1 WHERE id = ? AND station_id = ?`, [
    hidden ? 1 : 0, Number(messageId), stationId
  ]);
  return studioSnapshot(token);
}

function staffChatReply(token, body) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'audience');
  const text = String(body || '').trim().slice(0, 400);
  if (!text) throw new Error('Message cannot be empty');
  dbRun(`
    INSERT INTO radio_chat_messages (station_id, author_name, body, is_staff, staff_user_id, moderated, hidden)
    VALUES (?, ?, ?, 1, ?, 1, 0)
  `, [stationId, row.full_name || row.username || 'Studio', text, row.id]);
  return studioSnapshot(token);
}

function upsertCall(token, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'calls');
  const station = getStation(stationId);
  const tel = ops.telephonyStatus(ops.parseStationSettings(station));
  if (!tel.configured && !data?.id) {
    const err = new Error(tel.message);
    err.code = 'RADIO_CALLS_UNCONFIGURED';
    throw err;
  }
  if (data?.id) {
    const status = String(data.status || 'ringing');
    const onAir = !!data.on_air;
    const privateAnswer = !!data.private_answer || status === 'private';
    // Safety: never mark on_air unless explicitly requested; private ≠ on air
    if (privateAnswer && onAir) {
      throw new Error('A private answer cannot be on air. Put the caller on air as a separate action.');
    }
    dbRun(`
      UPDATE radio_calls SET status = ?, on_air = ?, private_answer = ?, ended_at = ?, caller_label = COALESCE(?, caller_label)
      WHERE id = ? AND station_id = ?
    `, [
      status,
      onAir ? 1 : 0,
      privateAnswer ? 1 : 0,
      status === 'ended' ? nowIso() : null,
      data.caller_label || null,
      Number(data.id),
      stationId
    ]);
    if (status === 'private' || privateAnswer) ops.writeAudit(stationId, row, 'answered call privately', data.id);
    else if (onAir) ops.writeAudit(stationId, row, 'put caller on air', data.id);
    else if (status === 'ended') ops.writeAudit(stationId, row, 'ended call', data.id);
    else if (status === 'answered') ops.writeAudit(stationId, row, 'answered call', data.id);
  } else {
    if (!tel.configured) {
      const err = new Error(tel.message);
      err.code = 'RADIO_CALLS_UNCONFIGURED';
      throw err;
    }
    dbRun(`
      INSERT INTO radio_calls (station_id, caller_label, caller_phone, status, on_air, private_answer, started_at, provider)
      VALUES (?, ?, ?, ?, 0, 0, ?, ?)
    `, [
      stationId,
      String(data?.caller_label || 'Caller').slice(0, 80),
      data?.caller_phone || null,
      String(data?.status || 'ringing'),
      nowIso(),
      tel.provider
    ]);
  }
  return studioSnapshot(token);
}

function saveSocialDestination(token, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'social');
  if (data?.id) {
    const existing = dbGet('SELECT * FROM radio_social_destinations WHERE id = ? AND station_id = ?', [Number(data.id), stationId]);
    if (!existing) throw new Error('Destination not found');
    const rtmp = data.rtmp_url != null ? data.rtmp_url : existing.rtmp_url;
    const key = data.stream_key != null ? data.stream_key : existing.stream_key;
    const enabled = data.enabled != null ? !!data.enabled : !!Number(existing.enabled);
    const hasKeys = !!(rtmp && key);
    let status = 'disconnected';
    if (hasKeys && enabled) status = 'ready';
    else if (hasKeys) status = 'configured';
    // Never mark connected/live without credentials
    if (data.status === 'live' && hasKeys && enabled && Number(broadcastState(stationId).go_live)) {
      status = 'live';
    }
    dbRun(`
      UPDATE radio_social_destinations
      SET label = COALESCE(?, label), rtmp_url = ?, stream_key = ?,
          enabled = ?, status = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND station_id = ?
    `, [
      data.label ?? null,
      rtmp || null,
      key || null,
      enabled ? 1 : 0,
      status,
      hasKeys ? null : 'Stream credentials missing',
      nowIso(),
      Number(data.id),
      stationId
    ]);
    ops.writeAudit(stationId, row, 'configured social destination', existing.platform);
  }
  return studioSnapshot(token);
}

function updateStationSettings(token, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'settings');
  const station = getStation(stationId);
  const prev = ops.parseStationSettings(station);
  const nextSettings = {
    ...prev,
    ...(data?.settings && typeof data.settings === 'object' ? data.settings : {}),
    description: data?.description ?? prev.description,
    logo_url: data?.logo_url ?? prev.logo_url,
    timezone: data?.timezone ?? prev.timezone ?? 'Africa/Johannesburg',
    duck_default: data?.duck_default ?? prev.duck_default ?? 0.35,
    operating_hours: data?.operating_hours ?? prev.operating_hours,
    chat_moderation: data?.chat_moderation ?? prev.chat_moderation,
    telephony_provider: data?.telephony_provider ?? prev.telephony_provider,
    telephony_api_key: data?.telephony_api_key ?? prev.telephony_api_key,
    telephony_from: data?.telephony_from ?? prev.telephony_from,
    ai_voice_provider: data?.ai_voice_provider ?? prev.ai_voice_provider,
    ai_voice_api_key: data?.ai_voice_api_key ?? prev.ai_voice_api_key,
    notifications: data?.notifications ?? prev.notifications
  };
  dbRun(`
    UPDATE radio_stations SET
      name = COALESCE(?, name),
      programme_title = COALESCE(?, programme_title),
      programme_upcoming = COALESCE(?, programme_upcoming),
      stream_url = COALESCE(?, stream_url),
      call_phone = COALESCE(?, call_phone),
      public_enabled = COALESCE(?, public_enabled),
      settings_json = ?,
      updated_at = ?
    WHERE id = ?
  `, [
    data?.name ?? null,
    data?.programme_title ?? null,
    data?.programme_upcoming ?? null,
    data?.stream_url ?? null,
    data?.call_phone ?? null,
    data?.public_enabled != null ? (data.public_enabled ? 1 : 0) : null,
    JSON.stringify(nextSettings),
    nowIso(),
    stationId
  ]);
  ops.writeAudit(stationId, row, 'updated station settings', null);
  return publicPayload(getStation(stationId));
}

/** Admin panel helpers (owner/manager session) */
function adminOverview() {
  ensureSchema();
  const station = getStation('main');
  const brand = shopBrand();
  const payload = station ? publicPayload(station) : null;
  return {
    station: payload,
    listeners: payload?.listeners || 0,
    online: payload?.station?.status === 'live',
    public_path: `/radio/${station?.slug || 'main'}/`,
    studio_path: '/radio-studio/',
    shop: brand,
    telephony: station ? ops.telephonyStatus(ops.parseStationSettings(station)) : { configured: false },
    permissions_catalog: [
      { key: PERM.access, label: 'Radio Studio Access' },
      { key: PERM.dashboard, label: 'Dashboard' },
      { key: PERM.music, label: 'Music Library' },
      { key: PERM.playlists, label: 'Playlists' },
      { key: PERM.announcements, label: 'Voice Announcements' },
      { key: PERM.mic, label: 'Live Microphone' },
      { key: PERM.mixer, label: 'Audio Mixer' },
      { key: PERM.sfx, label: 'Sound Effects' },
      { key: PERM.calls, label: 'Live Calls' },
      { key: PERM.audience, label: 'Audience Chat' },
      { key: PERM.broadcast, label: 'Live Broadcast' },
      { key: PERM.social, label: 'Social Broadcasting' },
      { key: PERM.schedule, label: 'Schedule' },
      { key: PERM.promotions, label: 'Promotions' },
      { key: PERM.analytics, label: 'Analytics' },
      { key: PERM.settings, label: 'Settings' }
    ]
  };
}

function adminSaveSettings(data) {
  ensureSchema();
  const stationId = defaultStationId();
  const station = getStation(stationId);
  const prev = ops.parseStationSettings(station);
  const nextSettings = {
    ...prev,
    ...(data?.settings && typeof data.settings === 'object' ? data.settings : {}),
    telephony_provider: data?.telephony_provider ?? prev.telephony_provider,
    telephony_api_key: data?.telephony_api_key ?? prev.telephony_api_key,
    telephony_from: data?.telephony_from ?? prev.telephony_from,
    ai_voice_provider: data?.ai_voice_provider ?? prev.ai_voice_provider,
    ai_voice_api_key: data?.ai_voice_api_key ?? prev.ai_voice_api_key,
    timezone: data?.timezone ?? prev.timezone,
    description: data?.description ?? prev.description,
    logo_url: data?.logo_url ?? prev.logo_url
  };
  dbRun(`
    UPDATE radio_stations SET
      name = COALESCE(?, name),
      programme_title = COALESCE(?, programme_title),
      programme_upcoming = COALESCE(?, programme_upcoming),
      stream_url = COALESCE(?, stream_url),
      call_phone = COALESCE(?, call_phone),
      public_enabled = COALESCE(?, public_enabled),
      settings_json = ?,
      updated_at = ?
    WHERE id = ?
  `, [
    data?.name ?? null,
    data?.programme_title ?? null,
    data?.programme_upcoming ?? null,
    data?.stream_url ?? null,
    data?.call_phone ?? null,
    data?.public_enabled != null ? (data.public_enabled ? 1 : 0) : null,
    JSON.stringify(nextSettings),
    nowIso(),
    stationId
  ]);
  return adminOverview();
}

function onUserPermissionsChanged(userId, permissionsObj) {
  ensureSchema();
  const user = loadUserById(userId);
  if (!user) {
    revokeUserSessions(userId);
    return;
  }
  const merged = { ...user, permissions: permissionsObj != null ? permissionsObj : user.permissions };
  if (!userIsActive(merged) || !radioFlags(merged).any) {
    revokeUserSessions(userId);
  }
}

/* ── Playlists ── */
function savePlaylist(token, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'playlists');
  let id = data?.id ? Number(data.id) : null;
  if (id) {
    dbRun(`
      UPDATE radio_playlists SET name = COALESCE(?, name), shuffle = COALESCE(?, shuffle), repeat_mode = COALESCE(?, repeat_mode)
      WHERE id = ? AND station_id = ?
    `, [
      data.name ?? null,
      data.shuffle != null ? (data.shuffle ? 1 : 0) : null,
      data.repeat_mode ?? null,
      id,
      stationId
    ]);
    ops.writeAudit(stationId, row, 'changed playlist', data.name || id);
  } else {
    dbRun(`
      INSERT INTO radio_playlists (station_id, name, shuffle, repeat_mode)
      VALUES (?, ?, ?, ?)
    `, [
      stationId,
      String(data?.name || 'Playlist').slice(0, 120),
      data?.shuffle ? 1 : 0,
      String(data?.repeat_mode || 'off')
    ]);
    id = dbGet('SELECT id FROM radio_playlists WHERE station_id = ? ORDER BY id DESC LIMIT 1', [stationId])?.id;
    ops.writeAudit(stationId, row, 'created playlist', data?.name);
  }
  if (Array.isArray(data?.track_ids)) {
    dbRun('DELETE FROM radio_playlist_items WHERE playlist_id = ?', [id]);
    data.track_ids.forEach((tid, i) => {
      dbRun(`INSERT INTO radio_playlist_items (playlist_id, track_id, sort_order) VALUES (?, ?, ?)`, [
        id, Number(tid), i
      ]);
    });
  }
  return studioSnapshot(token);
}

function deletePlaylist(token, playlistId) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'playlists');
  dbRun('DELETE FROM radio_playlist_items WHERE playlist_id = ?', [Number(playlistId)]);
  dbRun('DELETE FROM radio_playlists WHERE id = ? AND station_id = ?', [Number(playlistId), stationId]);
  ops.writeAudit(stationId, row, 'deleted playlist', playlistId);
  return studioSnapshot(token);
}

function duplicatePlaylist(token, playlistId) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'playlists');
  const src = dbGet('SELECT * FROM radio_playlists WHERE id = ? AND station_id = ?', [Number(playlistId), stationId]);
  if (!src) throw new Error('Playlist not found');
  dbRun(`INSERT INTO radio_playlists (station_id, name, shuffle, repeat_mode) VALUES (?, ?, ?, ?)`, [
    stationId, `${src.name} (copy)`, src.shuffle, src.repeat_mode
  ]);
  const neu = dbGet('SELECT id FROM radio_playlists WHERE station_id = ? ORDER BY id DESC LIMIT 1', [stationId]);
  const items = ops.playlistItems(src.id);
  items.forEach((it, i) => {
    dbRun(`INSERT INTO radio_playlist_items (playlist_id, track_id, sort_order) VALUES (?, ?, ?)`, [
      neu.id, it.id, i
    ]);
  });
  ops.writeAudit(stationId, row, 'duplicated playlist', src.name);
  return studioSnapshot(token);
}

function playTrack(token, trackId, opts = {}) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'music');
  const t = ops.enrichTrack(dbGet('SELECT * FROM radio_tracks WHERE id = ? AND station_id = ?', [Number(trackId), stationId]));
  if (!t) throw new Error('Track not found');
  if (!t.audio_url) throw new Error('Track has no playable audio file. Upload audio first.');
  const queue = opts.queue || null;
  setNowPlayingInternal(stationId, {
    title: t.title,
    artist: t.artist,
    kind: 'music',
    track_id: t.id,
    media_id: t.media_id,
    audio_url: t.audio_url,
    duration_sec: t.duration_sec || t.media_duration || null,
    playlist_id: opts.playlist_id || null
  }, row.id);
  if (queue) {
    dbRun(`UPDATE radio_broadcast_state SET queue_json = ?, updated_at = ? WHERE station_id = ?`, [
      JSON.stringify(queue), nowIso(), stationId
    ]);
  }
  if (opts.go_live) {
    dbRun(`
      UPDATE radio_broadcast_state
      SET go_live = 1, mode = 'music', playback_state = 'playing', updated_at = ?,
          operator_name = COALESCE(operator_name, ?), operator_user_id = COALESCE(operator_user_id, ?)
      WHERE station_id = ?
    `, [nowIso(), row.full_name || row.username, row.id, stationId]);
    dbRun(`UPDATE radio_stations SET status = 'live', updated_at = ? WHERE id = ?`, [nowIso(), stationId]);
  } else {
    dbRun(`UPDATE radio_broadcast_state SET playback_state = 'playing', updated_at = ? WHERE station_id = ?`, [
      nowIso(), stationId
    ]);
  }
  ops.writeAudit(stationId, row, 'played track', t.title);
  return studioSnapshot(token);
}

function playPlaylist(token, playlistId) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'playlists');
  const pl = dbGet('SELECT * FROM radio_playlists WHERE id = ? AND station_id = ?', [Number(playlistId), stationId]);
  if (!pl) throw new Error('Playlist not found');
  let items = ops.playlistItems(pl.id).map(ops.enrichTrack);
  if (!items.length) throw new Error('Playlist is empty');
  if (Number(pl.shuffle)) {
    items = items.slice().sort(() => Math.random() - 0.5);
  }
  const first = items[0];
  if (!first.audio_url) throw new Error('First track has no playable audio');
  const queue = {
    now: { track_id: first.id, title: first.title },
    next: items[1] ? { track_id: items[1].id, title: items[1].title } : null,
    items: items.map((t) => ({ track_id: t.id, title: t.title, audio_url: t.audio_url })),
    playlist_id: pl.id,
    repeat_mode: pl.repeat_mode
  };
  setNowPlayingInternal(stationId, {
    title: first.title,
    artist: first.artist,
    kind: 'music',
    track_id: first.id,
    media_id: first.media_id,
    audio_url: first.audio_url,
    playlist_id: pl.id
  }, row.id);
  dbRun(`UPDATE radio_broadcast_state SET queue_json = ?, mode = 'playlist', go_live = 1, updated_at = ? WHERE station_id = ?`, [
    JSON.stringify(queue), nowIso(), stationId
  ]);
  dbRun(`UPDATE radio_stations SET status = 'live', updated_at = ? WHERE id = ?`, [nowIso(), stationId]);
  ops.writeAudit(stationId, row, 'changed playlist', pl.name);
  return studioSnapshot(token);
}

function advanceQueue(token) {
  const { row, flags, stationId } = resolveSession(token);
  if (!flags.music && !flags.playlists) requireFlag(flags, 'music');
  const st = broadcastState(stationId);
  const queue = parseJson(st.queue_json, { items: [] });
  const items = queue.items || [];
  if (items.length < 2) {
    if (queue.repeat_mode === 'all' && items.length === 1) {
      return playTrack(token, items[0].track_id, { queue, go_live: true, playlist_id: queue.playlist_id });
    }
    throw new Error('Queue has no next item');
  }
  const rest = items.slice(1);
  const next = rest[0];
  const newQueue = {
    ...queue,
    now: { track_id: next.track_id, title: next.title },
    next: rest[1] ? { track_id: rest[1].track_id, title: rest[1].title } : null,
    items: rest
  };
  return playTrack(token, next.track_id, { queue: newQueue, go_live: true, playlist_id: queue.playlist_id });
}

function saveFolder(token, data) {
  const { flags, stationId } = resolveSession(token);
  requireFlag(flags, 'music');
  if (data?.id) {
    dbRun(`UPDATE radio_folders SET name = ? WHERE id = ? AND station_id = ?`, [
      String(data.name || 'Folder').slice(0, 80), Number(data.id), stationId
    ]);
  } else {
    dbRun(`INSERT INTO radio_folders (station_id, name, kind) VALUES (?, ?, ?)`, [
      stationId, String(data?.name || 'Folder').slice(0, 80), String(data?.kind || 'music')
    ]);
  }
  return studioSnapshot(token);
}

function saveSfx(token, data) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'sfx');
  let mediaId = data?.media_id || null;
  if (data?.file_data) {
    const media = ops.insertMedia(stationId, row.id, {
      kind: 'sfx',
      title: data.name || 'Effect',
      filename: data.filename || 'sfx.mp3',
      file_data: data.file_data
    });
    mediaId = media.id;
  }
  if (!mediaId) throw new Error('Upload a sound-effect file');
  dbRun(`INSERT INTO radio_sfx (station_id, name, category, media_id, volume) VALUES (?, ?, ?, ?, ?)`, [
    stationId,
    String(data?.name || 'Effect').slice(0, 80),
    String(data?.category || 'general').slice(0, 40),
    mediaId,
    data?.volume != null ? Math.max(0, Math.min(1, Number(data.volume))) : 1
  ]);
  ops.writeAudit(stationId, row, 'uploaded sound effect', data?.name);
  return studioSnapshot(token);
}

function playSfx(token, sfxId) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'sfx');
  const s = dbGet('SELECT * FROM radio_sfx WHERE id = ? AND station_id = ?', [Number(sfxId), stationId]);
  if (!s) throw new Error('Effect not found');
  const m = dbGet('SELECT * FROM radio_media_files WHERE id = ?', [s.media_id]);
  if (!m) throw new Error('Effect audio missing');
  const audioUrl = ops.mediaPublicUrl(m.id, m.public_token);
  // SFX overlays now_playing without replacing programme title permanently — store as play_now flash
  const flash = { title: s.name, kind: 'sfx', audio_url: audioUrl, volume: s.volume, at: nowIso() };
  dbRun(`UPDATE radio_broadcast_state SET play_now_json = ?, updated_at = ? WHERE station_id = ?`, [
    JSON.stringify(flash), nowIso(), stationId
  ]);
  ops.writeAudit(stationId, row, 'played sound effect', s.name);
  return { sfx: { ...s, audio_url: audioUrl }, flash };
}

function saveProgramme(token, items) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'schedule');
  dbRun('DELETE FROM radio_programme_schedule WHERE station_id = ?', [stationId]);
  (Array.isArray(items) ? items : []).forEach((it) => {
    dbRun(`
      INSERT INTO radio_programme_schedule
        (station_id, title, kind, start_time, end_time, days_mask, playlist_id, announcement_id, media_id, repeat_weekly, enabled, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      stationId,
      String(it.title || 'Programme').slice(0, 120),
      String(it.kind || 'music'),
      String(it.start_time || '08:00').slice(0, 5),
      it.end_time ? String(it.end_time).slice(0, 5) : null,
      String(it.days_mask || '1111111'),
      it.playlist_id != null ? Number(it.playlist_id) : null,
      it.announcement_id != null ? Number(it.announcement_id) : null,
      it.media_id != null ? Number(it.media_id) : null,
      it.repeat_weekly === false ? 0 : 1,
      it.enabled === false ? 0 : 1,
      it.meta ? JSON.stringify(it.meta) : null
    ]);
  });
  ops.writeAudit(stationId, row, 'updated programme schedule', null);
  return studioSnapshot(token);
}

function saveMixer(token, mixer) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'mixer');
  const clamp = (v, d = 1) => Math.max(0, Math.min(1, Number(v != null ? v : d)));
  const clean = {
    mic: clamp(mixer?.mic, 1),
    music: clamp(mixer?.music, 0.7),
    announcements: clamp(mixer?.announcements, 1),
    sfx: clamp(mixer?.sfx, 1),
    caller: clamp(mixer?.caller, 1),
    master: clamp(mixer?.master, 0.9),
    mute: mixer?.mute || {},
    solo: mixer?.solo || null
  };
  // Prevent uncontrolled clipping — master hard-capped at 0.95
  if (clean.master > 0.95) clean.master = 0.95;
  dbRun(`UPDATE radio_broadcast_state SET mixer_json = ?, music_volume = ?, updated_at = ?, updated_by = ? WHERE station_id = ?`, [
    JSON.stringify(clean), clean.music, nowIso(), row.id, stationId
  ]);
  return { mixer: clean };
}

function pinChatMessage(token, messageId, pinned) {
  const { flags, stationId } = resolveSession(token);
  requireFlag(flags, 'audience');
  dbRun(`UPDATE radio_chat_messages SET pinned = ? WHERE id = ? AND station_id = ?`, [
    pinned ? 1 : 0, Number(messageId), stationId
  ]);
  return studioSnapshot(token);
}

function handleChatMessage(token, messageId, handled) {
  const { flags, stationId } = resolveSession(token);
  requireFlag(flags, 'audience');
  dbRun(`UPDATE radio_chat_messages SET handled = ? WHERE id = ? AND station_id = ?`, [
    handled ? 1 : 0, Number(messageId), stationId
  ]);
  return studioSnapshot(token);
}

function blockChatAuthor(token, authorKey, reason) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'audience');
  const key = String(authorKey || '').toLowerCase().slice(0, 80);
  if (!key) throw new Error('Author key required');
  dbRun(`INSERT INTO radio_chat_blocks (station_id, author_key, reason, created_by) VALUES (?, ?, ?, ?)`, [
    stationId, key, reason || null, row.id
  ]);
  ops.writeAudit(stationId, row, 'blocked chat user', key);
  return studioSnapshot(token);
}

function createPromoAnnouncement(token, productId) {
  const { row, flags, stationId } = resolveSession(token);
  requireFlag(flags, 'promotions');
  const p = dbGet(`SELECT id, name, description, price, promo_price FROM products WHERE id = ?`, [Number(productId)]);
  if (!p) throw new Error('Product not found');
  const brand = shopBrand();
  const price = p.promo_price != null ? p.promo_price : p.price;
  const body = [
    `Promotion: ${p.name}`,
    p.description || '',
    price != null ? `Price: ${brand.currency || 'R'}${price}` : ''
  ].filter(Boolean).join('. ');
  dbRun(`
    INSERT INTO radio_announcements (station_id, title, body, voice_kind, script_text, created_by)
    VALUES (?, ?, ?, 'script', ?, ?)
  `, [stationId, `Promo — ${p.name}`.slice(0, 160), body.slice(0, 2000), body.slice(0, 2000), row.id]);
  ops.writeAudit(stationId, row, 'created promo announcement', p.name);
  return studioSnapshot(token);
}

function getMediaFile(mediaId, token) {
  ensureSchema();
  return ops.getMediaFile(mediaId, token);
}

/** WebRTC live room — studio mixes mic+music; listeners receive that stream */
function liveJoin(slug, sessionKey) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) throw new Error('Station not found');
  const key = String(sessionKey || '').slice(0, 80);
  if (!key) throw new Error('Session required');
  const existing = dbGet('SELECT * FROM radio_live_peers WHERE station_id = ? AND session_key = ?', [station.id, key]);
  if (existing) {
    dbRun(`UPDATE radio_live_peers SET status = 'joining', updated_at = ? WHERE id = ?`, [nowIso(), existing.id]);
    return { peer_id: existing.id, station_id: station.id };
  }
  dbRun(`
    INSERT INTO radio_live_peers (station_id, session_key, status, updated_at)
    VALUES (?, ?, 'joining', ?)
  `, [station.id, key, nowIso()]);
  const row = dbGet('SELECT id FROM radio_live_peers WHERE station_id = ? AND session_key = ?', [station.id, key]);
  return { peer_id: row.id, station_id: station.id };
}

function liveLeave(slug, sessionKey) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) return { ok: true };
  dbRun(`DELETE FROM radio_live_peers WHERE station_id = ? AND session_key = ?`, [station.id, String(sessionKey || '')]);
  return { ok: true };
}

function liveStudioPending(token) {
  const { stationId } = resolveSession(token);
  const rows = dbAll(`
    SELECT id, session_key, status, answer_sdp, peer_ice, offer_sdp
    FROM radio_live_peers
    WHERE station_id = ? AND status IN ('joining','offered','answered','connected')
    ORDER BY id ASC LIMIT 40
  `, [stationId]) || [];
  return { peers: rows };
}

function liveStudioSetOffer(token, peerId, offerSdp) {
  const { stationId } = resolveSession(token);
  dbRun(`
    UPDATE radio_live_peers
    SET offer_sdp = ?, status = 'offered', studio_ice = '[]', updated_at = ?
    WHERE id = ? AND station_id = ?
  `, [String(offerSdp || ''), nowIso(), Number(peerId), stationId]);
  return { ok: true };
}

function liveStudioSetIce(token, peerId, candidate) {
  const { stationId } = resolveSession(token);
  const row = dbGet('SELECT studio_ice FROM radio_live_peers WHERE id = ? AND station_id = ?', [Number(peerId), stationId]);
  if (!row) return { ok: false };
  let list = [];
  try { list = JSON.parse(row.studio_ice || '[]'); } catch { list = []; }
  if (candidate) list.push(candidate);
  if (list.length > 80) list = list.slice(-80);
  dbRun(`UPDATE radio_live_peers SET studio_ice = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(list), nowIso(), Number(peerId)]);
  return { ok: true };
}

function liveListenerPoll(slug, sessionKey) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) return { peer: null };
  const row = dbGet(`
    SELECT id, status, offer_sdp, studio_ice, answer_sdp
    FROM radio_live_peers WHERE station_id = ? AND session_key = ?
  `, [station.id, String(sessionKey || '')]);
  return { peer: row || null, live: station.status === 'live' };
}

function liveListenerAnswer(slug, sessionKey, answerSdp) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) throw new Error('Station not found');
  dbRun(`
    UPDATE radio_live_peers
    SET answer_sdp = ?, status = 'answered', updated_at = ?
    WHERE station_id = ? AND session_key = ?
  `, [String(answerSdp || ''), nowIso(), station.id, String(sessionKey || '')]);
  return { ok: true };
}

function liveListenerIce(slug, sessionKey, candidate) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) return { ok: false };
  const row = dbGet('SELECT peer_ice FROM radio_live_peers WHERE station_id = ? AND session_key = ?', [
    station.id, String(sessionKey || '')
  ]);
  if (!row) return { ok: false };
  let list = [];
  try { list = JSON.parse(row.peer_ice || '[]'); } catch { list = []; }
  if (candidate) list.push(candidate);
  if (list.length > 80) list = list.slice(-80);
  dbRun(`UPDATE radio_live_peers SET peer_ice = ?, updated_at = ? WHERE station_id = ? AND session_key = ?`, [
    JSON.stringify(list), nowIso(), station.id, String(sessionKey || '')
  ]);
  return { ok: true };
}

function liveStudioConsumeAnswer(token, peerId) {
  const { stationId } = resolveSession(token);
  const row = dbGet(`
    SELECT id, answer_sdp, peer_ice, status FROM radio_live_peers
    WHERE id = ? AND station_id = ?
  `, [Number(peerId), stationId]);
  if (!row || !row.answer_sdp) return { answer: null, ice: [] };
  let ice = [];
  try { ice = JSON.parse(row.peer_ice || '[]'); } catch { ice = []; }
  dbRun(`UPDATE radio_live_peers SET peer_ice = '[]', status = 'connected', updated_at = ? WHERE id = ?`, [nowIso(), row.id]);
  return { answer: row.answer_sdp, ice };
}

function liveListenerConsumeIce(slug, sessionKey) {
  ensureSchema();
  const station = getStation(slug || 'main');
  if (!station) return { ice: [] };
  const row = dbGet('SELECT studio_ice FROM radio_live_peers WHERE station_id = ? AND session_key = ?', [
    station.id, String(sessionKey || '')
  ]);
  if (!row) return { ice: [] };
  let ice = [];
  try { ice = JSON.parse(row.studio_ice || '[]'); } catch { ice = []; }
  dbRun(`UPDATE radio_live_peers SET studio_ice = '[]' WHERE station_id = ? AND session_key = ?`, [
    station.id, String(sessionKey || '')
  ]);
  return { ice };
}

module.exports = {
  PERM,
  MSG,
  ensureSchema,
  radioFlags,
  radioLogin,
  radioLogout,
  radioProfile,
  radioCheck,
  publicStatus,
  publicChatList,
  publicChatPost,
  publicListenerPing,
  publicRequestCall,
  studioSnapshot,
  setGoLive,
  setMicDuck,
  updateNowPlaying,
  playNow,
  playTrack,
  playPlaylist,
  advanceQueue,
  saveSchedule,
  saveProgramme,
  addTrack,
  updateTrack,
  deleteTrack,
  addAnnouncement,
  savePlaylist,
  deletePlaylist,
  duplicatePlaylist,
  saveFolder,
  saveSfx,
  playSfx,
  saveMixer,
  hideChatMessage,
  pinChatMessage,
  handleChatMessage,
  blockChatAuthor,
  staffChatReply,
  upsertCall,
  saveSocialDestination,
  updateStationSettings,
  createPromoAnnouncement,
  adminOverview,
  adminSaveSettings,
  revokeUserSessions,
  onUserPermissionsChanged,
  getMediaFile,
  liveJoin,
  liveLeave,
  liveStudioPending,
  liveStudioSetOffer,
  liveStudioSetIce,
  liveStudioConsumeAnswer,
  liveListenerPoll,
  liveListenerAnswer,
  liveListenerIce,
  liveListenerConsumeIce,
  setPlaybackState,
  playAdvert,
  clearAdvert,
  pushVoiceChunk,
  stopVoice,
  publicVoiceChunks,
  scheduleAdvertJob,
  listAdvertJobs,
  shopBrand,
  defaultStationId
};

