/**
 * Central OTP engine used by Phone Access, online registration and password recovery.
 * Codes are HMAC-hashed with a server-side secret, single use, expiring, attempt-limited,
 * and delivered via the configured OTP channel mode with an optional fallback channel.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const control = require('./cc-control');
const providers = require('./cc-providers');

function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }

let _ephemeralSecret = null;
function otpSecret() {
  if (process.env.OTP_SECRET) return String(process.env.OTP_SECRET);
  const dbUrl = process.env.DATABASE_URL || process.env.SHOP_POS_DATABASE_URL || '';
  if (dbUrl) return crypto.createHash('sha256').update(`shop-pos-otp:${dbUrl}`).digest('hex');
  if (!_ephemeralSecret) _ephemeralSecret = crypto.randomBytes(32).toString('hex');
  return _ephemeralSecret;
}

function hashCode(purpose, subject, code) {
  return crypto.createHmac('sha256', otpSecret()).update(`${purpose}:${subject}:${code}`).digest('hex');
}

/** One-way lookup key. Phone numbers and email addresses are never stored in clear text. */
function blindIndex(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  return crypto.createHmac('sha256', otpSecret()).update(`blind:${s}`).digest('hex');
}

function storedSubject(subject) {
  const s = String(subject || '').trim();
  const digits = s.replace(/\D/g, '');
  if (!s.includes(':') && !s.includes('@') && digits.length >= 8 && digits.length <= 15) return blindIndex(digits);
  if (s.includes('@')) return blindIndex(s.toLowerCase());
  return s;
}

function subjectKeys(subject) {
  const raw = String(subject || '').trim();
  const stored = storedSubject(raw);
  return stored === raw ? [raw] : [stored, raw];
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function reqCtx() {
  try { return require('../../lib/request-context').get(); } catch (_) { return {}; }
}

function normPhone(p) { return String(p || '').replace(/\D/g, ''); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

function logEvent(row) {
  try {
    dbRun(`INSERT INTO cc_otp_events (request_id, purpose, subject_masked, event, channel, detail, ip, device, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    [row.request_id || null, row.purpose || null, row.subject_masked || null, row.event, row.channel || null,
      row.detail ? String(row.detail).slice(0, 400) : null,
      row.ip ? blindIndex(row.ip) : null,
      row.device ? blindIndex(String(row.device).slice(0, 200)) : null,
      control.nowIso()]);
  } catch (_) { /* */ }
}

function countSince(sql, params) {
  try { return Number(dbGet(sql, params)?.c || 0); } catch (_) { return 0; }
}

function ago(seconds) { return control.nowIso(new Date(Date.now() - seconds * 1000)); }

function enforceLimits({ purpose, subject, phone, email, ip, cfg, masked }) {
  const fail = (event, msg) => {
    logEvent({ purpose, subject_masked: masked, event, detail: msg, ip, device: reqCtx().device });
    const err = new Error(msg);
    err.code = 'OTP_RATE_LIMIT';
    throw err;
  };
  const keys = subjectKeys(subject);
  const last = dbGet(`SELECT created_at FROM cc_otp_requests WHERE purpose = ? AND subject_key IN (${keys.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, [purpose, ...keys]);
  if (last?.created_at && last.created_at > ago(cfg.resend_cooldown_seconds)) {
    const wait = Math.max(1, cfg.resend_cooldown_seconds - Math.floor((Date.now() - Date.parse(`${last.created_at.replace(' ', 'T')}Z`)) / 1000));
    fail('blocked_cooldown', `Please wait ${wait} seconds before requesting another code.`);
  }
  const targets = [];
  const params = [];
  if (phone) { targets.push('(phone_hash = ? OR phone = ?)'); params.push(blindIndex(phone), phone); }
  if (email) { targets.push('(email_hash = ? OR email = ?)'); params.push(blindIndex(email), email); }
  targets.push(`subject_key IN (${keys.map(() => '?').join(',')})`); params.push(...keys);
  const where = `(${targets.join(' OR ')})`;
  if (countSince(`SELECT COUNT(*) AS c FROM cc_otp_requests WHERE ${where} AND created_at >= ?`, [...params, ago(3600)]) >= cfg.per_target_hour) {
    fail('blocked_target_hour', 'Too many code requests for this number or email. Please try again later.');
  }
  if (countSince(`SELECT COUNT(*) AS c FROM cc_otp_requests WHERE ${where} AND created_at >= ?`, [...params, ago(86400)]) >= cfg.per_target_day) {
    fail('blocked_target_day', 'Daily verification limit reached for this number or email. Please try again tomorrow.');
  }
  if (ip) {
    const ipHash = blindIndex(ip);
    if (countSince('SELECT COUNT(*) AS c FROM cc_otp_requests WHERE (ip_hash = ? OR ip = ?) AND created_at >= ?', [ipHash, ip, ago(3600)]) >= cfg.per_ip_hour) {
      fail('blocked_ip_hour', 'Too many code requests from this device. Please try again later.');
    }
    if (countSince('SELECT COUNT(*) AS c FROM cc_otp_requests WHERE (ip_hash = ? OR ip = ?) AND created_at >= ?', [ipHash, ip, ago(86400)]) >= cfg.per_ip_day) {
      fail('blocked_ip_day', 'Too many code requests from this device today.');
    }
  }
}

function logQueueRow({ channel, purpose, address, name, body, status, error, externalId }) {
  try {
    const r = dbRun(`INSERT INTO cc_queue (event_key, source_module, channel, recipient_type, recipient_name, recipient_address,
      body, status, priority, attempts, last_error, external_id, processed_at, sent_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['auth.otp', `otp:${purpose}`, channel, 'customer', name || null, address ? control.maskAddress(address) : null, body, status, 1, 1,
      error ? String(error).slice(0, 500) : null, externalId || null, control.nowIso(),
      status === 'sent' ? control.nowIso() : null, control.nowIso()]);
    return Number(r?.lastInsertRowid) || null;
  } catch (_) { return null; }
}

/**
 * Issue and deliver a code.
 * opts: { purpose, subject, phone, email, name, digits, expiryMinutes, buildText(code, minutes), emailSubject }
 * Returns { request_id, delivered:[channel], failed:[{channel,error}], expires_in_minutes, wa_link_code? }
 */
async function issue(opts = {}) {
  control.ensureSchema();
  const ctl = control.getControl();
  const cfg = ctl.otp;
  const purpose = String(opts.purpose || 'verification');
  const subject = String(opts.subject || '').trim();
  const phone = normPhone(opts.phone);
  const email = normEmail(opts.email);
  const ctx = reqCtx();
  const ip = ctx.ip || null;
  const masked = control.maskAddress(phone || email || subject);
  if (!subject) throw new Error('Verification subject required');
  if (!phone && !email) throw new Error('A phone number or email is required for verification');
  if (!ctl.otp_enabled) {
    logEvent({ purpose, subject_masked: masked, event: 'blocked_otp_off', ip, device: ctx.device });
    throw new Error('Verification codes are currently switched off by the shop. Please contact the shop.');
  }
  if (ctl.emergency_off && !ctl.emergency_allow_otp) {
    logEvent({ purpose, subject_masked: masked, event: 'blocked_emergency', ip, device: ctx.device });
    throw new Error('Messaging is temporarily paused by the shop. Please try again later.');
  }
  enforceLimits({ purpose, subject, phone, email, ip, cfg, masked });

  const digits = Number(opts.digits) || cfg.digits;
  const minutes = Number(opts.expiryMinutes) || cfg.expiry_minutes;
  const code = String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');
  const has = (ch) => (ch === 'email' ? !!email : !!phone);
  let channels = (control.OTP_MODES[cfg.mode] || ['whatsapp']).filter(has);
  const fallback = cfg.fallback !== 'none' && has(cfg.fallback) ? cfg.fallback : null;
  if (!channels.length && fallback) channels = [fallback];
  if (!channels.length) {
    logEvent({ purpose, subject_masked: masked, event: 'no_channel', detail: `mode=${cfg.mode}`, ip, device: ctx.device });
    throw new Error(cfg.mode === 'email'
      ? 'No email address on file for verification.'
      : 'No mobile number on file for verification.');
  }

  const now = control.nowIso();
  const subjectStored = storedSubject(subject);
  const priorKeys = subjectKeys(subject);
  dbRun(`UPDATE cc_otp_requests SET superseded_at = ? WHERE purpose = ? AND subject_key IN (${priorKeys.map(() => '?').join(',')}) AND used_at IS NULL AND superseded_at IS NULL`,
    [now, purpose, ...priorKeys]);
  const expiresAt = control.nowIso(new Date(Date.now() + minutes * 60000));
  const ins = dbRun(`INSERT INTO cc_otp_requests (purpose, subject_key, phone, email, phone_hash, email_hash, code_hash, channels_json, attempts, max_attempts,
    expires_at, ip, device, ip_hash, device_hash, created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
  [purpose, subjectStored, phone ? control.maskAddress(phone) : null, email ? control.maskAddress(email) : null,
    phone ? blindIndex(phone) : null, email ? blindIndex(email) : null,
    hashCode(purpose, subjectStored, code), JSON.stringify(channels),
    cfg.max_attempts, expiresAt, null, null, ip ? blindIndex(ip) : null, ctx.device ? blindIndex(String(ctx.device).slice(0, 200)) : null, now]);
  let requestId = Number(ins?.lastInsertRowid) || 0;
  if (!requestId) {
    requestId = Number(dbGet('SELECT id FROM cc_otp_requests WHERE purpose = ? AND subject_key = ? ORDER BY id DESC LIMIT 1', [purpose, subjectStored])?.id) || 0;
  }
  logEvent({ request_id: requestId, purpose, subject_masked: masked, event: 'issued', detail: `channels=${channels.join('+')}`, ip, device: ctx.device });

  const text = typeof opts.buildText === 'function'
    ? opts.buildText(code, minutes)
    : `Your verification code is ${code}. It expires in ${minutes} minutes. Do not share this code.`;
  const maskedText = text.split(code).join('•'.repeat(digits));
  const delivered = [];
  const failed = [];

  const deliverOne = async (ch) => {
    const address = ch === 'email' ? email : phone;
    const r = await providers.send(ch, {
      to: address, text, otpCode: code,
      subject: opts.emailSubject || 'Your verification code'
    });
    const qid = logQueueRow({
      channel: ch, purpose, address, name: opts.name, body: maskedText,
      status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, externalId: r.external_id
    });
    control.recordAttempt({ queue_id: qid, otp_request_id: requestId, channel: ch, provider: r.provider, recipient: address,
      status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, external_id: r.external_id });
    logEvent({ request_id: requestId, purpose, subject_masked: masked, event: r.ok ? 'sent' : 'send_failed', channel: ch,
      detail: r.ok ? r.provider : r.error, ip, device: ctx.device });
    if (r.ok) delivered.push(ch); else failed.push({ channel: ch, error: r.error });
  };

  await Promise.all(channels.map(deliverOne));
  if (!delivered.length && fallback && !channels.includes(fallback)) {
    await deliverOne(fallback);
  }
  dbRun('UPDATE cc_otp_requests SET delivered_json = ? WHERE id = ?', [JSON.stringify({ delivered, failed }), requestId]);

  const out = { request_id: requestId, delivered, failed, expires_in_minutes: minutes, channels };
  if (!delivered.length) {
    if (cfg.allow_wa_link_fallback && phone) {
      logEvent({ request_id: requestId, purpose, subject_masked: masked, event: 'wa_link_fallback', ip, device: ctx.device });
      out.wa_link_text = text;
    } else if (process.env.CC_DEV_RETURN_CODES === '1') {
      out._dev_code = code;
    } else {
      dbRun('UPDATE cc_otp_requests SET superseded_at = ? WHERE id = ?', [control.nowIso(), requestId]);
      const err = new Error('We could not send a verification code right now. Please try again shortly or ask the shop for help.');
      err.code = 'OTP_DELIVERY_FAILED';
      err.failed = failed;
      throw err;
    }
  }
  if (process.env.CC_DEV_RETURN_CODES === '1') out._dev_code = code;
  return out;
}

/** Verify a code; single use. Throws a user-safe error on failure. */
function verify({ purpose, subject, code }) {
  control.ensureSchema();
  const clean = String(code || '').replace(/\D/g, '');
  const ctx = reqCtx();
  const keys = subjectKeys(subject);
  const row = dbGet(`SELECT * FROM cc_otp_requests WHERE purpose = ? AND subject_key IN (${keys.map(() => '?').join(',')}) AND used_at IS NULL AND superseded_at IS NULL
    ORDER BY id DESC LIMIT 1`, [String(purpose), ...keys]);
  const masked = control.maskAddress(row?.phone || row?.email || subject);
  if (!clean) throw new Error('Enter the verification code');
  if (!row) {
    logEvent({ purpose, subject_masked: masked, event: 'verify_no_active', ip: ctx.ip, device: ctx.device });
    throw new Error('No active code — request a new one');
  }
  if (row.expires_at < control.nowIso()) {
    logEvent({ request_id: row.id, purpose, subject_masked: masked, event: 'verify_expired', ip: ctx.ip, device: ctx.device });
    throw new Error('Code expired — request a new one');
  }
  if (Number(row.attempts) >= Number(row.max_attempts)) {
    logEvent({ request_id: row.id, purpose, subject_masked: masked, event: 'verify_locked', ip: ctx.ip, device: ctx.device });
    throw new Error('Too many attempts — request a new code');
  }
  if (!safeEqualHex(hashCode(row.purpose, row.subject_key, clean), row.code_hash)) {
    dbRun('UPDATE cc_otp_requests SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    const left = Math.max(0, Number(row.max_attempts) - Number(row.attempts) - 1);
    logEvent({ request_id: row.id, purpose, subject_masked: masked, event: 'verify_failed', detail: `attempts_left=${left}`, ip: ctx.ip, device: ctx.device });
    throw new Error(left ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} left` : 'Incorrect code — request a new code');
  }
  const now = control.nowIso();
  const upd = dbRun('UPDATE cc_otp_requests SET used_at = ?, verified_at = ? WHERE id = ? AND used_at IS NULL', [now, now, row.id]);
  if (upd && upd.changes === 0) throw new Error('This code was already used — request a new one');
  logEvent({ request_id: row.id, purpose, subject_masked: masked, event: 'verified', ip: ctx.ip, device: ctx.device });
  return { ok: true, request_id: row.id, phone: row.phone, email: row.email };
}

function hasFreshVerification(purpose, subject, minutes = 15) {
  control.ensureSchema();
  const keys = subjectKeys(subject);
  const row = dbGet(`SELECT id FROM cc_otp_requests WHERE purpose = ? AND subject_key IN (${keys.map(() => '?').join(',')}) AND verified_at IS NOT NULL AND verified_at >= ?
    ORDER BY id DESC LIMIT 1`, [String(purpose), ...keys, ago(minutes * 60)]);
  return !!row;
}

function listEvents(filters = {}) {
  control.ensureSchema();
  const params = [];
  let sql = 'SELECT * FROM cc_otp_events WHERE 1=1';
  if (filters.event) { sql += ' AND event = ?'; params.push(filters.event); }
  if (filters.purpose) { sql += ' AND purpose = ?'; params.push(filters.purpose); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 500));
  return getDb().prepare(sql).all(...params) || [];
}

function stats() {
  control.ensureSchema();
  const since = ago(86400);
  const c = (ev) => countSince('SELECT COUNT(*) AS c FROM cc_otp_events WHERE event = ? AND created_at >= ?', [ev, since]);
  return {
    issued_24h: c('issued'),
    sent_24h: c('sent'),
    send_failed_24h: c('send_failed'),
    verified_24h: c('verified'),
    verify_failed_24h: c('verify_failed'),
    blocked_24h: countSince(`SELECT COUNT(*) AS c FROM cc_otp_events WHERE event LIKE 'blocked_%' AND created_at >= ?`, [since])
  };
}

function sign(value) {
  return crypto.createHmac('sha256', otpSecret()).update(String(value)).digest('hex');
}

module.exports = { issue, verify, hasFreshVerification, listEvents, stats, sign };
