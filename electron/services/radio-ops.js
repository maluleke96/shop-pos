/**
 * Radio functional ops — media files, listeners, playlists, programme clock, audit.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dbGet, dbAll, dbRun, nowIso } = require('./biz-modules-common');

function assetsRoot() {
  let base;
  try { base = require('../database/db').getDbDir?.() || path.join(process.cwd(), 'data'); }
  catch (_) { base = path.join(process.cwd(), 'data'); }
  const dir = path.join(base, 'assets', 'radio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveRadioFile(subdir, filename, dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid file data — expected base64 data URL');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 80 * 1024 * 1024) throw new Error('File too large (max 80MB)');
  const safe = String(filename || 'audio').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const rel = path.join(subdir, `${Date.now()}_${safe}`);
  const full = path.join(assetsRoot(), rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return { rel: rel.replace(/\\/g, '/'), full, mime: m[1], size: buf.length };
}

function resolveRadioPath(storagePath) {
  if (!storagePath) return null;
  const full = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(assetsRoot(), storagePath);
  if (!fs.existsSync(full)) return null;
  return full;
}

function newPublicToken() {
  return crypto.randomBytes(18).toString('hex');
}

function ensureFunctionalSchema() {
  const alters = [
    `ALTER TABLE radio_tracks ADD COLUMN media_id INTEGER`,
    `ALTER TABLE radio_tracks ADD COLUMN folder_id INTEGER`,
    `ALTER TABLE radio_tracks ADD COLUMN file_status TEXT DEFAULT 'ready'`,
    `ALTER TABLE radio_announcements ADD COLUMN media_id INTEGER`,
    `ALTER TABLE radio_announcements ADD COLUMN script_text TEXT`,
    `ALTER TABLE radio_playlist_items ADD COLUMN sort_key REAL`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN mixer_json TEXT`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN queue_json TEXT`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN started_live_at TEXT`,
    `ALTER TABLE radio_chat_messages ADD COLUMN pinned INTEGER DEFAULT 0`,
    `ALTER TABLE radio_chat_messages ADD COLUMN handled INTEGER DEFAULT 0`,
    `ALTER TABLE radio_chat_messages ADD COLUMN author_key TEXT`,
    `ALTER TABLE radio_calls ADD COLUMN provider TEXT`,
    `ALTER TABLE radio_calls ADD COLUMN provider_sid TEXT`,
    `ALTER TABLE radio_calls ADD COLUMN private_answer INTEGER DEFAULT 0`,
    `ALTER TABLE radio_schedule_items ADD COLUMN start_at TEXT`,
    `ALTER TABLE radio_schedule_items ADD COLUMN end_at TEXT`
  ];
  for (const sql of alters) {
    try { dbRun(sql); } catch (_) { /* column may exist */ }
  }

  const tables = [
    `CREATE TABLE IF NOT EXISTS radio_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'music',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS radio_media_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      folder_id INTEGER,
      filename TEXT,
      mime TEXT,
      size_bytes INTEGER,
      duration_sec REAL,
      storage_path TEXT,
      public_token TEXT,
      meta_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS radio_sfx (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      category TEXT,
      media_id INTEGER,
      volume REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS radio_programme_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'music',
      start_time TEXT NOT NULL,
      end_time TEXT,
      days_mask TEXT NOT NULL DEFAULT '1111111',
      playlist_id INTEGER,
      announcement_id INTEGER,
      media_id INTEGER,
      repeat_weekly INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS radio_listeners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      session_key TEXT NOT NULL,
      user_agent TEXT,
      last_seen TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_radio_listeners_sess ON radio_listeners(station_id, session_key)`,
    `CREATE TABLE IF NOT EXISTS radio_listen_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      session_key TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_sec REAL
    )`,
    `CREATE TABLE IF NOT EXISTS radio_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS radio_chat_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      author_key TEXT NOT NULL,
      reason TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS radio_live_peers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      session_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'joining',
      offer_sdp TEXT,
      answer_sdp TEXT,
      studio_ice TEXT,
      peer_ice TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_radio_live_peers_sess ON radio_live_peers(station_id, session_key)`
  ];
  for (const sql of tables) {
    try { dbRun(sql); } catch (_) { /* */ }
  }

  const moreAlters = [
    `ALTER TABLE radio_broadcast_state ADD COLUMN playback_state TEXT DEFAULT 'stopped'`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN operator_name TEXT`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN operator_user_id INTEGER`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN advert_json TEXT`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN voice_seq INTEGER DEFAULT 0`,
    `ALTER TABLE radio_broadcast_state ADD COLUMN voice_media_id INTEGER`,
    `ALTER TABLE radio_announcements ADD COLUMN schedule_at TEXT`,
    `ALTER TABLE radio_announcements ADD COLUMN music_mode TEXT DEFAULT 'duck'`
  ];
  for (const sql of moreAlters) {
    try { dbRun(sql); } catch (_) { /* */ }
  }

  try {
    dbRun(`CREATE TABLE IF NOT EXISTS radio_voice_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      seq INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_radio_voice_seq ON radio_voice_chunks(station_id, seq)`);
  } catch (_) { /* */ }

  try {
    dbRun(`CREATE TABLE IF NOT EXISTS radio_advert_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      media_id INTEGER,
      announcement_id INTEGER,
      run_at TEXT NOT NULL,
      music_mode TEXT NOT NULL DEFAULT 'duck',
      duck_level REAL NOT NULL DEFAULT 0.15,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch (_) { /* */ }

  try {
    const p = path.join(__dirname, '../database/migrations-v118-radio-functional.sql');
    if (fs.existsSync(p)) {
      const sql = fs.readFileSync(p, 'utf8');
      const db = require('../database/db').getDb();
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { db.exec(`${stmt};`); } catch (e) {
          if (!/already exists|duplicate column/i.test(String(e.message || ''))) { /* */ }
        }
      }
    }
  } catch (_) { /* */ }
}

function writeAudit(stationId, user, action, details) {
  try {
    dbRun(`
      INSERT INTO radio_audit (station_id, user_id, user_name, action, details)
      VALUES (?, ?, ?, ?, ?)
    `, [
      stationId,
      user?.id || null,
      user?.full_name || user?.username || 'System',
      String(action || '').slice(0, 120),
      details ? (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 2000) : null
    ]);
  } catch (_) { /* */ }
  try {
    const store = require('./store');
    store.audit?.(user?.id, user?.username || user?.full_name, `radio:${action}`, 'radio', stationId, details);
  } catch (_) { /* */ }
}

function countListeners(stationId) {
  try {
    // Any device that pinged in the last 90 seconds counts
    const row = dbGet(`
      SELECT COUNT(*) AS c FROM radio_listeners
      WHERE station_id = ? AND datetime(last_seen) > datetime('now', '-90 seconds')
    `, [stationId]);
    return Number(row?.c) || 0;
  } catch (_) {
    return 0;
  }
}

function listenerPing(stationId, sessionKey, userAgent) {
  const key = String(sessionKey || '').slice(0, 80);
  if (!key) throw new Error('Listener session required');
  const existing = dbGet(
    'SELECT id, started_at FROM radio_listeners WHERE station_id = ? AND session_key = ?',
    [stationId, key]
  );
  const now = nowIso();
  if (existing) {
    dbRun('UPDATE radio_listeners SET last_seen = ?, user_agent = COALESCE(?, user_agent) WHERE id = ?', [
      now, userAgent || null, existing.id
    ]);
  } else {
    dbRun(`
      INSERT INTO radio_listeners (station_id, session_key, user_agent, last_seen, started_at)
      VALUES (?, ?, ?, ?, ?)
    `, [stationId, key, userAgent || null, now, now]);
    try {
      dbRun(`
        INSERT INTO radio_listen_sessions (station_id, session_key, started_at)
        VALUES (?, ?, ?)
      `, [stationId, key, now]);
    } catch (_) { /* */ }
  }
  // Prune very old rows so counts stay accurate
  try {
    dbRun(`DELETE FROM radio_listeners WHERE station_id = ? AND datetime(last_seen) < datetime('now', '-1 day')`, [stationId]);
  } catch (_) { /* */ }
  return { listeners: countListeners(stationId) };
}

function mediaPublicUrl(mediaId, token) {
  return `/radio-media/${mediaId}?token=${encodeURIComponent(token || '')}`;
}

function getMediaFile(mediaId, token) {
  const row = dbGet('SELECT * FROM radio_media_files WHERE id = ? AND COALESCE(enabled,1) = 1', [Number(mediaId)]);
  if (!row) throw new Error('Media not found');
  if (token && row.public_token && token !== row.public_token) {
    throw new Error('Invalid media token');
  }
  const full = resolveRadioPath(row.storage_path);
  if (!full) throw new Error('Media file missing');
  return { path: full, mime: row.mime || 'audio/mpeg', title: row.title };
}

function insertMedia(stationId, userId, data) {
  const kind = String(data.kind || 'music');
  const saved = saveRadioFile(kind, data.filename || `${kind}.mp3`, data.file_data);
  const token = newPublicToken();
  dbRun(`
    INSERT INTO radio_media_files
      (station_id, kind, title, artist, folder_id, filename, mime, size_bytes, duration_sec, storage_path, public_token, meta_json, enabled, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `, [
    stationId,
    kind,
    String(data.title || data.filename || 'Audio').slice(0, 160),
    data.artist ? String(data.artist).slice(0, 120) : null,
    data.folder_id != null ? Number(data.folder_id) : null,
    saved.rel.split('/').pop(),
    saved.mime,
    saved.size,
    data.duration_sec != null ? Number(data.duration_sec) : null,
    saved.rel,
    token,
    data.meta ? JSON.stringify(data.meta) : null,
    userId || null
  ]);
  const row = dbGet('SELECT * FROM radio_media_files WHERE station_id = ? ORDER BY id DESC LIMIT 1', [stationId]);
  return {
    ...row,
    audio_url: mediaPublicUrl(row.id, row.public_token)
  };
}

function playlistItems(playlistId) {
  return dbAll(`
    SELECT pi.id AS item_id, pi.sort_order, t.*,
           m.public_token, m.storage_path, m.mime, m.duration_sec AS media_duration
    FROM radio_playlist_items pi
    JOIN radio_tracks t ON t.id = pi.track_id
    LEFT JOIN radio_media_files m ON m.id = t.media_id
    WHERE pi.playlist_id = ?
    ORDER BY pi.sort_order ASC, pi.id ASC
  `, [Number(playlistId)]) || [];
}

function enrichTrack(t) {
  if (!t) return t;
  let audio_url = t.source_url || null;
  if (t.media_id) {
    const m = dbGet('SELECT id, public_token FROM radio_media_files WHERE id = ?', [t.media_id]);
    if (m) audio_url = mediaPublicUrl(m.id, m.public_token);
  }
  return { ...t, audio_url };
}

function currentProgramme(stationId, settings) {
  const tz = settings?.timezone || 'Africa/Johannesburg';
  let now;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
    }).formatToParts(new Date());
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    const wd = parts.find((p) => p.type === 'weekday')?.value || 'Mon';
    now = { hhmm: `${hour}:${minute}`, dayIdx: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) };
    if (now.dayIdx < 0) now.dayIdx = new Date().getDay();
  } catch (_) {
    const d = new Date();
    now = {
      hhmm: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      dayIdx: d.getDay()
    };
  }
  const rows = dbAll(`
    SELECT * FROM radio_programme_schedule
    WHERE station_id = ? AND COALESCE(enabled,1) = 1
    ORDER BY start_time ASC
  `, [stationId]) || [];
  const active = rows.find((r) => {
    const mask = String(r.days_mask || '1111111');
    if (mask[now.dayIdx] === '0') return false;
    const start = String(r.start_time || '00:00').slice(0, 5);
    const end = String(r.end_time || '23:59').slice(0, 5);
    return now.hhmm >= start && now.hhmm < end;
  }) || null;
  const upcoming = rows.find((r) => {
    const mask = String(r.days_mask || '1111111');
    if (mask[now.dayIdx] === '0') return false;
    return String(r.start_time || '').slice(0, 5) > now.hhmm;
  }) || rows[0] || null;
  return { active, upcoming, clock: now.hhmm };
}

function analyticsSnapshot(stationId) {
  const listeners = countListeners(stationId);
  let peak = listeners;
  let sessions = 0;
  let messages = 0;
  let callsTotal = 0;
  let callsAnswered = 0;
  try {
    const s = dbGet('SELECT COUNT(*) AS c FROM radio_listen_sessions WHERE station_id = ?', [stationId]);
    sessions = Number(s?.c) || 0;
  } catch (_) { /* */ }
  try {
    const m = dbGet('SELECT COUNT(*) AS c FROM radio_chat_messages WHERE station_id = ?', [stationId]);
    messages = Number(m?.c) || 0;
  } catch (_) { /* */ }
  try {
    const c = dbGet('SELECT COUNT(*) AS c FROM radio_calls WHERE station_id = ?', [stationId]);
    callsTotal = Number(c?.c) || 0;
    const a = dbGet(`
      SELECT COUNT(*) AS c FROM radio_calls
      WHERE station_id = ? AND status IN ('answered','private','on_air','ended')
    `, [stationId]);
    callsAnswered = Number(a?.c) || 0;
  } catch (_) { /* */ }
  const st = dbGet('SELECT * FROM radio_broadcast_state WHERE station_id = ?', [stationId]);
  let broadcast_duration_sec = 0;
  if (st?.started_live_at && Number(st.go_live)) {
    broadcast_duration_sec = Math.max(0, (Date.now() - new Date(st.started_live_at).getTime()) / 1000);
  }
  return {
    listeners_now: listeners,
    peak_listeners_session: peak,
    total_listen_sessions: sessions,
    audience_messages: messages,
    calls_received: callsTotal,
    calls_answered: callsAnswered,
    broadcast_duration_sec: Math.round(broadcast_duration_sec),
    collected: true
  };
}

function parseStationSettings(station) {
  let s = station?.settings_json;
  if (typeof s === 'string') {
    try { s = JSON.parse(s); } catch { s = {}; }
  }
  return s && typeof s === 'object' ? s : {};
}

function telephonyStatus(settings) {
  const provider = String(settings?.telephony_provider || '').trim().toLowerCase();
  const configured = !!(provider && settings?.telephony_api_key);
  return {
    configured,
    provider: configured ? provider : null,
    message: configured
      ? null
      : 'Calling service not configured — connect a supported provider in Radio Settings.'
  };
}

function aiVoiceStatus(settings) {
  const configured = !!(settings?.ai_voice_provider && settings?.ai_voice_api_key);
  return {
    configured,
    provider: configured ? settings.ai_voice_provider : null,
    message: configured
      ? null
      : 'AI voice not configured — upload or record a voice announcement instead.'
  };
}

function socialStatusRow(row) {
  const hasKeys = !!(row.rtmp_url && row.stream_key);
  let status = 'disconnected';
  if (hasKeys && Number(row.enabled)) status = 'ready';
  else if (hasKeys) status = 'configured';
  if (row.status === 'live' && hasKeys && Number(row.enabled)) status = 'live';
  if (row.status === 'error') status = 'error';
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    enabled: !!Number(row.enabled),
    has_credentials: hasKeys,
    status,
    last_error: row.last_error || null,
    updated_at: row.updated_at
  };
}

module.exports = {
  ensureFunctionalSchema,
  saveRadioFile,
  resolveRadioPath,
  writeAudit,
  countListeners,
  listenerPing,
  mediaPublicUrl,
  getMediaFile,
  insertMedia,
  playlistItems,
  enrichTrack,
  currentProgramme,
  analyticsSnapshot,
  parseStationSettings,
  telephonyStatus,
  aiVoiceStatus,
  socialStatusRow,
  assetsRoot
};
