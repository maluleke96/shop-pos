/**
 * Communication Center control plane: master switches, emergency OFF, categories,
 * rate limits + auto-pause, marketing send windows, costs and the extra CC tables.
 * Provider secrets never live here — see cc-providers.js (environment variables only).
 */
const { getDb } = require('../database/db');

const MESSAGE_CHANNELS = ['sms', 'whatsapp', 'email'];
const CATEGORIES = ['transaction', 'points', 'reminder', 'marketing', 'scheduled', 'internal'];
const OTP_MODES = {
  sms: ['sms'],
  whatsapp: ['whatsapp'],
  email: ['email'],
  sms_whatsapp: ['sms', 'whatsapp'],
  sms_email: ['sms', 'email'],
  whatsapp_email: ['whatsapp', 'email'],
  all: ['sms', 'whatsapp', 'email']
};

const DEFAULT_CONTROL = {
  emergency_off: false,
  emergency_allow_otp: false,
  channels: { sms: true, whatsapp: true, email: true },
  otp_enabled: true,
  categories: { transaction: true, points: false, reminder: true, marketing: true, scheduled: true, internal: true },
  limits: {
    sms: { hour: 200, day: 1000 },
    whatsapp: { hour: 500, day: 3000 },
    email: { hour: 300, day: 2000 }
  },
  auto_pause: true,
  paused: {},
  costs: { sms: 0, whatsapp: 0, email: 0 },
  retry: { max_attempts: 3, backoff_seconds: 60 },
  marketing_window: { enabled: true },
  points: { channels: ['whatsapp'], fallback: 'none', notify_redeem: false },
  otp: {
    mode: 'whatsapp',
    fallback: 'none',
    digits: 6,
    expiry_minutes: 10,
    max_attempts: 5,
    resend_cooldown_seconds: 60,
    per_target_hour: 5,
    per_target_day: 10,
    per_ip_hour: 20,
    per_ip_day: 60,
    allow_wa_link_fallback: true
  },
  email: { primary: 'smtp', fallback: 'none', from_name: '', from_email: '', reply_to: '' }
};

let _schemaReady = false;

function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }

function nowIso(d = new Date()) {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

function tryRun(sql) {
  try { dbRun(sql); return true; } catch (err) {
    const msg = String(err.message || err);
    if (!/already exists|duplicate column/i.test(msg)) console.warn('[cc-control] schema:', msg.slice(0, 160));
    return false;
  }
}

function ensureSchema() {
  if (_schemaReady) return;
  tryRun(`CREATE TABLE IF NOT EXISTS cc_dedupe (
    dedupe_key TEXT PRIMARY KEY,
    queue_id INTEGER,
    created_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS cc_delivery_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER,
    otp_request_id INTEGER,
    channel TEXT NOT NULL,
    provider TEXT,
    recipient_masked TEXT,
    status TEXT NOT NULL,
    error TEXT,
    external_id TEXT,
    created_at TEXT
  )`);
  tryRun('CREATE INDEX IF NOT EXISTS idx_cc_attempts_queue ON cc_delivery_attempts(queue_id)');
  tryRun('CREATE INDEX IF NOT EXISTS idx_cc_attempts_created ON cc_delivery_attempts(created_at)');
  tryRun(`CREATE TABLE IF NOT EXISTS cc_channel_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT,
    kind TEXT NOT NULL,
    message TEXT,
    resolved_at TEXT,
    resolved_by INTEGER,
    created_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS cc_otp_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purpose TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    code_hash TEXT NOT NULL,
    channels_json TEXT,
    delivered_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    verified_at TEXT,
    superseded_at TEXT,
    ip TEXT,
    device TEXT,
    created_at TEXT
  )`);
  ['phone_hash TEXT', 'email_hash TEXT', 'ip_hash TEXT', 'device_hash TEXT'].forEach((col) => {
    tryRun(`ALTER TABLE cc_otp_requests ADD COLUMN ${col}`);
  });
  tryRun('CREATE INDEX IF NOT EXISTS idx_cc_otp_subject ON cc_otp_requests(purpose, subject_key)');
  tryRun('CREATE INDEX IF NOT EXISTS idx_cc_otp_created ON cc_otp_requests(created_at)');
  tryRun(`CREATE TABLE IF NOT EXISTS cc_otp_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER,
    purpose TEXT,
    subject_masked TEXT,
    event TEXT NOT NULL,
    channel TEXT,
    detail TEXT,
    ip TEXT,
    device TEXT,
    created_at TEXT
  )`);
  tryRun('CREATE INDEX IF NOT EXISTS idx_cc_otp_events_created ON cc_otp_events(created_at)');
  tryRun(`CREATE TABLE IF NOT EXISTS cc_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_id INTEGER,
    body TEXT,
    subject TEXT,
    channels_json TEXT NOT NULL,
    audience_json TEXT NOT NULL,
    branch_id INTEGER,
    category TEXT NOT NULL DEFAULT 'scheduled',
    send_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    recipient_count INTEGER DEFAULT 0,
    queued_count INTEGER DEFAULT 0,
    confirmed_by INTEGER,
    confirmed_at TEXT,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT,
    run_at TEXT,
    error TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS cc_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom',
    template_id INTEGER,
    body TEXT,
    subject TEXT,
    channels_json TEXT NOT NULL,
    audience_json TEXT NOT NULL,
    branch_id INTEGER,
    repeat TEXT NOT NULL DEFAULT 'once',
    next_run_at TEXT,
    last_run_at TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`);
  [
    'sms_body TEXT', 'wa_template_name TEXT', 'wa_language TEXT', 'wa_variables_json TEXT',
    'wa_approval_status TEXT', 'email_subject TEXT', 'email_html TEXT', 'email_text TEXT'
  ].forEach((col) => tryRun(`ALTER TABLE cc_templates ADD COLUMN ${col}`));
  [
    'sms INTEGER DEFAULT 1', 'whatsapp INTEGER DEFAULT 1', 'email INTEGER DEFAULT 1',
    'marketing INTEGER DEFAULT 1', 'loyalty INTEGER DEFAULT 1', 'reminders INTEGER DEFAULT 1',
    'transactional INTEGER DEFAULT 1', 'security INTEGER DEFAULT 1', 'email_address TEXT',
    'opt_out_token TEXT', 'opted_out_at TEXT'
  ].forEach((col) => tryRun(`ALTER TABLE cc_customer_prefs ADD COLUMN ${col}`));
  _schemaReady = true;
}

function rawSettings() {
  try {
    return parseJson(dbGet('SELECT settings_json FROM cc_settings WHERE id = 1')?.settings_json, {});
  } catch (_) { return {}; }
}

function writeRawSettings(next) {
  const json = JSON.stringify(next);
  const r = dbRun('UPDATE cc_settings SET settings_json = ?, updated_at = ? WHERE id = 1', [json, nowIso()]);
  if (!Number(r?.changes)) {
    try { dbRun('INSERT INTO cc_settings (id, settings_json, updated_at) VALUES (1, ?, ?)', [json, nowIso()]); } catch (_) { /* */ }
  }
}

function mergeDeep(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...(base || {}) };
  Object.keys(over).forEach((k) => {
    const b = base ? base[k] : undefined;
    const o = over[k];
    out[k] = (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b))
      ? mergeDeep(b, o) : o;
  });
  return out;
}

function getControl() {
  ensureSchema();
  return mergeDeep(DEFAULT_CONTROL, rawSettings().control || {});
}

function clampInt(v, min, max, fb) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fb;
  return Math.min(max, Math.max(min, n));
}

function sanitizeControl(c) {
  const out = mergeDeep(DEFAULT_CONTROL, c || {});
  out.emergency_off = !!out.emergency_off;
  out.emergency_allow_otp = !!out.emergency_allow_otp;
  out.otp_enabled = !!out.otp_enabled;
  out.auto_pause = !!out.auto_pause;
  MESSAGE_CHANNELS.forEach((ch) => {
    out.channels[ch] = !!out.channels[ch];
    out.limits[ch] = {
      hour: clampInt(out.limits[ch]?.hour, 1, 100000, DEFAULT_CONTROL.limits[ch].hour),
      day: clampInt(out.limits[ch]?.day, 1, 1000000, DEFAULT_CONTROL.limits[ch].day)
    };
    const cost = Number(out.costs[ch]);
    out.costs[ch] = Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 10000) / 10000 : 0;
  });
  CATEGORIES.forEach((k) => { out.categories[k] = !!out.categories[k]; });
  out.retry = {
    max_attempts: clampInt(out.retry.max_attempts, 1, 10, 3),
    backoff_seconds: clampInt(out.retry.backoff_seconds, 5, 3600, 60)
  };
  out.marketing_window = { enabled: !!out.marketing_window?.enabled };
  const pc = (Array.isArray(out.points.channels) ? out.points.channels : []).filter((x) => MESSAGE_CHANNELS.includes(x));
  out.points = {
    channels: pc.length ? [...new Set(pc)] : ['whatsapp'],
    fallback: MESSAGE_CHANNELS.includes(out.points.fallback) ? out.points.fallback : 'none',
    notify_redeem: !!out.points.notify_redeem
  };
  const o = out.otp;
  out.otp = {
    mode: OTP_MODES[o.mode] ? o.mode : 'whatsapp',
    fallback: MESSAGE_CHANNELS.includes(o.fallback) ? o.fallback : 'none',
    digits: clampInt(o.digits, 4, 8, 6),
    expiry_minutes: clampInt(o.expiry_minutes, 2, 30, 10),
    max_attempts: clampInt(o.max_attempts, 1, 10, 5),
    resend_cooldown_seconds: clampInt(o.resend_cooldown_seconds, 15, 900, 60),
    per_target_hour: clampInt(o.per_target_hour, 1, 50, 5),
    per_target_day: clampInt(o.per_target_day, 1, 200, 10),
    per_ip_hour: clampInt(o.per_ip_hour, 1, 500, 20),
    per_ip_day: clampInt(o.per_ip_day, 1, 5000, 60),
    allow_wa_link_fallback: !!o.allow_wa_link_fallback
  };
  const e = out.email;
  const provs = ['smtp', 'api'];
  out.email = {
    primary: provs.includes(e.primary) ? e.primary : 'smtp',
    fallback: provs.includes(e.fallback) && e.fallback !== e.primary ? e.fallback : 'none',
    from_name: String(e.from_name || '').slice(0, 120),
    from_email: String(e.from_email || '').trim().slice(0, 200),
    reply_to: String(e.reply_to || '').trim().slice(0, 200)
  };
  const paused = {};
  MESSAGE_CHANNELS.forEach((ch) => { if (out.paused?.[ch]) paused[ch] = out.paused[ch]; });
  out.paused = paused;
  return out;
}

function diffKeys(a, b, prefix = '') {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const changes = [];
  keys.forEach((k) => {
    const av = a ? a[k] : undefined;
    const bv = b ? b[k] : undefined;
    const p = prefix ? `${prefix}.${k}` : k;
    if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av) && !Array.isArray(bv)) {
      changes.push(...diffKeys(av, bv, p));
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      changes.push({ key: p, before: av === undefined ? null : av, after: bv === undefined ? null : bv });
    }
  });
  return changes;
}

function ccAudit(actor, action, entityType, entityId, details) {
  try {
    dbRun(`INSERT INTO cc_audit (actor_id, actor_name, action, entity_type, entity_id, details_json)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [actor?.id || null, actor?.full_name || actor?.username || 'system', action, entityType || null,
      entityId || null, details ? JSON.stringify(details) : null]);
  } catch (_) { /* */ }
}

function saveControl(partial, actor) {
  ensureSchema();
  const before = getControl();
  const patch = { ...(partial || {}) };
  delete patch.paused;
  const next = sanitizeControl(mergeDeep(before, patch));
  if (next.emergency_off !== before.emergency_off) {
    next.emergency_changed_at = nowIso();
    next.emergency_changed_by = actor?.full_name || actor?.username || null;
  }
  const raw = rawSettings();
  raw.control = next;
  writeRawSettings(raw);
  const changes = diffKeys(before, next).filter((c) => !/^emergency_changed_/.test(c.key));
  if (changes.length) ccAudit(actor, 'control_change', 'cc_settings', 1, { changes });
  if (next.emergency_off && !before.emergency_off) holdAllPending('emergency_off');
  return next;
}

function setEmergency(on, actor) {
  return saveControl({ emergency_off: !!on }, actor);
}

function holdAllPending(reason) {
  try {
    dbRun(`UPDATE cc_queue SET status = 'held', last_error = ? WHERE status IN ('pending','retrying')`, [reason]);
  } catch (_) { /* */ }
}

function releaseHeld(actor, { channel, cancel } = {}) {
  ensureSchema();
  const params = [];
  let where = `status = 'held'`;
  if (channel) { where += ' AND channel = ?'; params.push(channel); }
  const count = Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE ${where}`, params)?.c || 0);
  if (cancel) dbRun(`UPDATE cc_queue SET status = 'cancelled', last_error = 'cancelled_by_admin' WHERE ${where}`, params);
  else dbRun(`UPDATE cc_queue SET status = 'pending', last_error = NULL WHERE ${where}`, params);
  ccAudit(actor, cancel ? 'held_cancelled' : 'held_released', 'cc_queue', null, { channel: channel || 'all', count });
  return { ok: true, count };
}

function pauseChannel(channel, reason, actor) {
  const c = getControl();
  const raw = rawSettings();
  c.paused = { ...(c.paused || {}), [channel]: { at: nowIso(), reason, by: actor?.full_name || actor?.username || 'system' } };
  raw.control = c;
  writeRawSettings(raw);
  addAlert(channel, 'auto_pause', reason);
  ccAudit(actor, 'channel_paused', 'cc_settings', 1, { channel, reason });
}

function resumeChannel(channel, actor) {
  if (!MESSAGE_CHANNELS.includes(channel)) throw new Error('Unknown channel');
  const c = getControl();
  const raw = rawSettings();
  const next = { ...(c.paused || {}) };
  delete next[channel];
  c.paused = next;
  raw.control = c;
  writeRawSettings(raw);
  try {
    dbRun(`UPDATE cc_channel_alerts SET resolved_at = ?, resolved_by = ? WHERE channel = ? AND resolved_at IS NULL`,
      [nowIso(), actor?.id || null, channel]);
  } catch (_) { /* */ }
  ccAudit(actor, 'channel_resumed', 'cc_settings', 1, { channel });
  return c;
}

function addAlert(channel, kind, message) {
  try {
    dbRun('INSERT INTO cc_channel_alerts (channel, kind, message, created_at) VALUES (?,?,?,?)',
      [channel || null, kind, String(message || '').slice(0, 500), nowIso()]);
  } catch (_) { /* */ }
  try {
    require('./store').addNotification('cc_alert', `Communication alert — ${channel || 'system'}`, String(message || ''), {
      entity_type: 'communication', audience_roles: 'owner', _from_cc: true
    });
  } catch (_) { /* in-app alert optional */ }
}

function listAlerts(limit = 50) {
  ensureSchema();
  return dbAll('SELECT * FROM cc_channel_alerts ORDER BY id DESC LIMIT ?', [limit]) || [];
}

function categoryFor(eventKey, sourceModule) {
  const k = String(eventKey || '');
  if (k.startsWith('auth.')) return 'security';
  if (k.startsWith('loyalty.')) return 'points';
  if (k.startsWith('reminder.')) return 'reminder';
  if (k.startsWith('schedule.')) return 'scheduled';
  if (k.startsWith('promo.') || k === 'builder.share' || sourceModule === 'campaign') return 'marketing';
  if (/^(order|payment|refund|delivery)\./.test(k)) return 'transaction';
  if (k === 'manual.message') return 'transaction';
  return 'internal';
}

function sentCount(channel, sinceIso) {
  try {
    return Number(dbGet(`SELECT COUNT(*) AS c FROM cc_delivery_attempts
      WHERE channel = ? AND status = 'sent' AND created_at >= ?`, [channel, sinceIso])?.c || 0);
  } catch (_) { return 0; }
}

/** Returns null when under the limit; otherwise the reason (and pauses the channel when auto-pause is on). */
function checkRateLimit(channel, control) {
  const lim = control.limits?.[channel];
  if (!lim) return null;
  const hour = sentCount(channel, nowIso(new Date(Date.now() - 3600 * 1000)));
  const day = sentCount(channel, nowIso(new Date(Date.now() - 24 * 3600 * 1000)));
  let reason = null;
  if (hour >= lim.hour) reason = `${channel.toUpperCase()} hourly limit reached (${hour}/${lim.hour})`;
  else if (day >= lim.day) reason = `${channel.toUpperCase()} daily limit reached (${day}/${lim.day})`;
  if (reason && control.auto_pause && !control.paused?.[channel]) pauseChannel(channel, reason, null);
  return reason;
}

// South African public holidays (Public Holidays Act) incl. Sunday → Monday rule.
function easterSunday(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function saHolidays(year) {
  const ymd = (d) => d.toISOString().slice(0, 10);
  const fixed = ['01-01', '03-21', '04-27', '05-01', '06-16', '08-09', '09-24', '12-16', '12-25', '12-26'];
  const set = new Set();
  fixed.forEach((md) => {
    const d = new Date(`${year}-${md}T00:00:00Z`);
    set.add(ymd(d));
    if (d.getUTCDay() === 0) set.add(ymd(new Date(d.getTime() + 86400000)));
  });
  const easter = easterSunday(year);
  set.add(ymd(new Date(easter.getTime() - 2 * 86400000)));
  set.add(ymd(new Date(easter.getTime() + 86400000)));
  return set;
}

/** SA local (UTC+2) wall-clock parts for a Date. */
function saParts(d) {
  const t = new Date(d.getTime() + 2 * 3600 * 1000);
  return { ymd: t.toISOString().slice(0, 10), dow: t.getUTCDay(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), year: t.getUTCFullYear() };
}

/**
 * Consumer Protection Act reg. 4: direct marketing Mon–Fri 08:00–20:00, Sat 09:00–13:00,
 * never Sundays or public holidays.
 */
function inMarketingWindow(d = new Date()) {
  const p = saParts(d);
  if (p.dow === 0 || saHolidays(p.year).has(p.ymd)) return false;
  if (p.dow === 6) return p.hour >= 9 && p.hour < 13;
  return p.hour >= 8 && p.hour < 20;
}

function nextMarketingWindow(from = new Date()) {
  let t = new Date(Math.ceil(from.getTime() / 900000) * 900000);
  for (let i = 0; i < 24 * 4 * 10; i += 1) {
    if (inMarketingWindow(t)) return t;
    t = new Date(t.getTime() + 900000);
  }
  return t;
}

/**
 * Gate for a queued (non-OTP) message. Result:
 *  { allow:true } | { action:'hold'|'block'|'defer', reason, until? }
 */
function gateJob(job, control = getControl()) {
  const metaCategory = parseJson(job.provider_meta_json, {})?.category;
  const category = CATEGORIES.includes(metaCategory) && metaCategory !== 'security'
    ? metaCategory : categoryFor(job.event_key, job.source_module);
  if (job.channel === 'inapp') return { allow: true, category };
  if (control.emergency_off) return { action: 'hold', reason: 'emergency_off', category };
  if (MESSAGE_CHANNELS.includes(job.channel)) {
    if (!control.channels[job.channel]) return { action: 'block', reason: `${job.channel}_off`, category };
  }
  if (category !== 'security' && control.categories[category] === false) {
    return { action: 'block', reason: `category_${category}_off`, category };
  }
  if (MESSAGE_CHANNELS.includes(job.channel) && control.paused?.[job.channel]) {
    return { action: 'hold', reason: `${job.channel}_paused`, category };
  }
  if ((category === 'marketing' || category === 'scheduled') && control.marketing_window?.enabled && !inMarketingWindow()) {
    return { action: 'defer', reason: 'outside_marketing_hours', until: nextMarketingWindow(), category };
  }
  if (MESSAGE_CHANNELS.includes(job.channel)) {
    const limited = checkRateLimit(job.channel, control);
    if (limited) return { action: 'hold', reason: limited, category };
  }
  return { allow: true, category };
}

function recordAttempt(row) {
  try {
    dbRun(`INSERT INTO cc_delivery_attempts (queue_id, otp_request_id, channel, provider, recipient_masked, status, error, external_id, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    [row.queue_id || null, row.otp_request_id || null, row.channel, row.provider || null,
      maskAddress(row.recipient), row.status, row.error ? String(row.error).slice(0, 500) : null,
      row.external_id || null, nowIso()]);
  } catch (_) { /* */ }
}

function maskAddress(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.includes('@')) {
    const [name, domain] = s.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  const d = s.replace(/\D/g, '');
  return d.length > 4 ? `${'*'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : '****';
}

/** DB-enforced duplicate guard (primary key on dedupe_key). */
function claimDedupe(key) {
  if (!key) return true;
  ensureSchema();
  try {
    const r = dbRun('INSERT OR IGNORE INTO cc_dedupe (dedupe_key, created_at) VALUES (?, ?)', [String(key).slice(0, 400), nowIso()]);
    return Number(r?.changes) > 0;
  } catch (err) {
    if (/unique|duplicate/i.test(String(err.message || ''))) return false;
    throw err;
  }
}

function linkDedupe(key, queueId) {
  if (!key || !queueId) return;
  try { dbRun('UPDATE cc_dedupe SET queue_id = ? WHERE dedupe_key = ?', [queueId, String(key).slice(0, 400)]); } catch (_) { /* */ }
}

function releaseDedupe(key) {
  if (!key) return;
  try { dbRun('DELETE FROM cc_dedupe WHERE dedupe_key = ?', [String(key).slice(0, 400)]); } catch (_) { /* */ }
}

function usage() {
  ensureSchema();
  const control = getControl();
  const today = saParts(new Date()).ymd;
  const monthStart = `${today.slice(0, 7)}-01`;
  // SA midnight in UTC text form
  const toUtc = (ymd) => nowIso(new Date(Date.parse(`${ymd}T00:00:00Z`) - 2 * 3600 * 1000));
  const out = {};
  MESSAGE_CHANNELS.forEach((ch) => {
    const t = sentCount(ch, toUtc(today));
    const m = sentCount(ch, toUtc(monthStart));
    let failedToday = 0;
    try {
      failedToday = Number(dbGet(`SELECT COUNT(*) AS c FROM cc_delivery_attempts WHERE channel = ? AND status = 'failed' AND created_at >= ?`,
        [ch, toUtc(today)])?.c || 0);
    } catch (_) { /* */ }
    const cost = Number(control.costs?.[ch] || 0);
    out[ch] = {
      sent_today: t, sent_month: m, failed_today: failedToday,
      cost_per_message: cost,
      cost_today: Math.round(t * cost * 100) / 100,
      cost_month: Math.round(m * cost * 100) / 100,
      limit_hour: control.limits[ch].hour, limit_day: control.limits[ch].day,
      sent_last_hour: sentCount(ch, nowIso(new Date(Date.now() - 3600 * 1000))),
      paused: control.paused?.[ch] || null,
      enabled: !!control.channels[ch]
    };
  });
  return { today, month: today.slice(0, 7), channels: out };
}

module.exports = {
  MESSAGE_CHANNELS, CATEGORIES, OTP_MODES, DEFAULT_CONTROL,
  ensureSchema, getControl, saveControl, setEmergency, releaseHeld, pauseChannel, resumeChannel,
  listAlerts, addAlert, categoryFor, gateJob, checkRateLimit, recordAttempt, maskAddress,
  claimDedupe, linkDedupe, releaseDedupe, usage, inMarketingWindow, nextMarketingWindow,
  saHolidays, ccAudit, nowIso, rawSettings, writeRawSettings, parseJson
};
