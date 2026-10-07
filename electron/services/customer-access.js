/**
 * Simple Phone Access — identify customers by cellphone on top of the existing
 * customers (POS master) + web_customers (online login) records.
 * Full registration/login in online-ordering.js is untouched.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }

const web = () => require('./online-ordering');

const MODES = ['full', 'phone', 'guest'];
const DEFAULTS = {
  mode: 'full',
  phone_matching: true,
  require_otp: false,
  allow_new_customers: true,
  allow_guest_ordering: false,
  allow_guest_browsing: false,
  otp_expiry_minutes: 10
};
let _schemaReady = false;
function ensureSchema() {
  if (_schemaReady) return;
  try {
    dbRun(`CREATE TABLE IF NOT EXISTS phone_access_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      verified_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT
    )`);
  } catch (_) { /* exists */ }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_phone_access_codes_phone ON phone_access_codes(phone)'); } catch (_) { /* */ }
  _schemaReady = true;
}

function truthy(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

function readOnlineJson() {
  try {
    const row = dbGet('SELECT online_settings_json FROM shop_settings WHERE id = 1');
    const v = row?.online_settings_json;
    if (!v) return {};
    return typeof v === 'object' ? v : JSON.parse(v);
  } catch (_) {
    return {};
  }
}

function getAccessSettings() {
  const raw = readOnlineJson().customer_access || {};
  const mode = MODES.includes(raw.mode) ? raw.mode : DEFAULTS.mode;
  return {
    mode,
    phone_matching: truthy(raw.phone_matching, DEFAULTS.phone_matching),
    require_otp: truthy(raw.require_otp, DEFAULTS.require_otp),
    allow_new_customers: truthy(raw.allow_new_customers, DEFAULTS.allow_new_customers),
    allow_guest_ordering: truthy(raw.allow_guest_ordering, mode === 'guest'),
    allow_guest_browsing: truthy(raw.allow_guest_browsing, mode === 'guest'),
    otp_expiry_minutes: Math.min(30, Math.max(3, Number(raw.otp_expiry_minutes) || DEFAULTS.otp_expiry_minutes))
  };
}

function saveAccessSettings(data = {}) {
  const cur = getAccessSettings();
  const next = {
    mode: MODES.includes(data.mode) ? data.mode : cur.mode,
    phone_matching: truthy(data.phone_matching, cur.phone_matching),
    require_otp: truthy(data.require_otp, cur.require_otp),
    allow_new_customers: truthy(data.allow_new_customers, cur.allow_new_customers),
    allow_guest_ordering: truthy(data.allow_guest_ordering, cur.allow_guest_ordering),
    allow_guest_browsing: truthy(data.allow_guest_browsing, cur.allow_guest_browsing),
    otp_expiry_minutes: Math.min(30, Math.max(3, Number(data.otp_expiry_minutes) || cur.otp_expiry_minutes))
  };
  try { dbGet('SELECT online_settings_json FROM shop_settings LIMIT 0'); } catch (_) {
    try { dbRun('ALTER TABLE shop_settings ADD COLUMN online_settings_json TEXT'); } catch (__) { /* */ }
  }
  const online = { ...readOnlineJson(), customer_access: next, updated_at: nowIso() };
  dbRun('UPDATE shop_settings SET online_settings_json = ? WHERE id = 1', [JSON.stringify(online)]);
  return getAccessSettings();
}

/** South African numbers: 0821234567 / 27821234567 / +27 82 123 4567 → +27821234567 */
function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 && d.startsWith('0')) return `+27${d.slice(1)}`;
  if (d.length === 11 && d.startsWith('27')) return `+27${d.slice(2)}`;
  if (d.length === 9 && !d.startsWith('0')) return `+27${d}`;
  if (d.length >= 10 && d.length <= 15 && !d.startsWith('0')) return `+${d}`;
  return '';
}

function requirePhone(raw) {
  const phone = normalizePhone(raw);
  if (!phone) throw new Error('Please enter a valid cellphone number, e.g. 082 123 4567');
  return phone;
}

function isActive(row) {
  return !!(row && row.is_active !== 0 && row.is_active !== false && row.is_active !== '0');
}

function customersByPhone(phone) {
  const core = web().phoneDigits(phone);
  if (!core) return [];
  let rows = [];
  try {
    rows = dbAll("SELECT id, name, phone, email, loyalty_points FROM customers WHERE phone IS NOT NULL AND TRIM(phone) != ''");
  } catch (_) { rows = []; }
  return rows.filter((c) => web().phonesMatch(phone, c.phone));
}

function webRowsByPhone(phone) {
  let rows = [];
  try {
    rows = dbAll("SELECT * FROM web_customers WHERE phone IS NOT NULL AND TRIM(phone) != ''");
  } catch (_) { rows = []; }
  return rows.filter((r) => web().phonesMatch(phone, r.phone));
}

/**
 * Resolve the one master customer for a phone. Prefers the customer already
 * linked to an online account, then the richest loyalty record, then the oldest.
 */
function findCustomerByPhone(phone) {
  const webRows = webRowsByPhone(phone);
  const posRows = customersByPhone(phone);
  const linkedWeb = webRows.find((r) => r.customer_id);
  let customer = null;
  if (linkedWeb) {
    customer = dbGet('SELECT id, name, phone, email, loyalty_points FROM customers WHERE id = ?', [linkedWeb.customer_id]) || null;
  }
  if (!customer && posRows.length) {
    customer = [...posRows].sort((a, b) =>
      (Number(b.loyalty_points) || 0) - (Number(a.loyalty_points) || 0) || Number(a.id) - Number(b.id)
    )[0];
  }
  const webRow = (customer && webRows.find((r) => Number(r.customer_id) === Number(customer.id)))
    || linkedWeb || webRows[0] || null;
  return {
    customer,
    webRow,
    duplicate_count: posRows.length > 1 ? posRows.length : 0
  };
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: 'Customer', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function lastId(r, sql, params) {
  return r?.lastInsertRowid || dbGet(sql, params)?.id || null;
}

/** Ensure there is exactly one active web_customers row for this master customer. */
function ensureWebRow(customer, phone, existingWeb) {
  const points = Math.floor(Number(customer.loyalty_points) || 0);
  let row = existingWeb || web().findWebCustomerRow(phone, null, customer.id);
  if (row) {
    if (row.customer_id && Number(row.customer_id) !== Number(customer.id)) {
      return row.id;
    }
    dbRun(`UPDATE web_customers SET customer_id = ?, is_active = 1,
      loyalty_points = CASE WHEN COALESCE(loyalty_points, 0) > ? THEN loyalty_points ELSE ? END,
      updated_at = ? WHERE id = ?`, [customer.id, points, points, nowIso(), row.id]);
    return row.id;
  }
  const { first, last } = splitName(customer.name);
  const r = dbRun(`INSERT INTO web_customers (customer_id, first_name, last_name, email, phone, password_hash, loyalty_points)
    VALUES (?,?,?,?,?,?,?)`, [customer.id, first, last, customer.email || null, phone, '', points]);
  return lastId(r, 'SELECT id FROM web_customers WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [customer.id]);
}

function linkPosCustomerForWebRow(webRow, phone) {
  const name = `${webRow.first_name || ''} ${webRow.last_name || ''}`.trim() || 'Customer';
  const r = dbRun('INSERT INTO customers (name, phone, email) VALUES (?,?,?)', [name, phone, webRow.email || null]);
  const id = lastId(r, 'SELECT id FROM customers WHERE phone = ? ORDER BY id DESC LIMIT 1', [phone]);
  dbRun('UPDATE web_customers SET customer_id = ?, updated_at = ? WHERE id = ?', [id, nowIso(), webRow.id]);
  return dbGet('SELECT id, name, phone, email, loyalty_points FROM customers WHERE id = ?', [id]);
}

function summaryFor(customer, webId) {
  let orders = 0;
  let lastOrderAt = null;
  try {
    const s = dbGet('SELECT COUNT(*) AS c, MAX(created_at) AS last_at FROM sales WHERE customer_id = ?', [customer.id]) || {};
    orders += Number(s.c) || 0;
    lastOrderAt = s.last_at || null;
  } catch (_) { /* */ }
  try {
    const o = dbGet(`SELECT COUNT(*) AS c, MAX(created_at) AS last_at FROM online_orders_local
      WHERE (customer_id = ? OR web_customer_id = ?) AND (sale_id IS NULL)`, [customer.id, webId || -1]) || {};
    orders += Number(o.c) || 0;
    if (o.last_at && (!lastOrderAt || String(o.last_at) > String(lastOrderAt))) lastOrderAt = o.last_at;
  } catch (_) { /* */ }
  let promotions = 0;
  try {
    promotions = (require('./app-notifications').listActivePromotions({}) || []).length;
  } catch (_) { /* optional */ }
  let pointValue = 1;
  try { pointValue = Number(web().getGlobalSettings().loyalty?.point_value) || 1; } catch (_) { /* */ }
  const points = Math.floor(Number(customer.loyalty_points) || 0);
  return {
    first_name: splitName(customer.name).first,
    loyalty_points: points,
    points_value: Math.round(points * pointValue * 100) / 100,
    orders,
    last_order_at: lastOrderAt,
    promotions
  };
}

function signIn(customer, phone, existingWeb) {
  const webId = ensureWebRow(customer, phone, existingWeb);
  const session = web().createWebSession(webId);
  const wc = web().resolveWebCustomer(session.token);
  return {
    status: 'signed_in',
    token: session.token,
    expires_at: session.expires_at,
    customer: wc,
    summary: summaryFor(customer, webId)
  };
}

function assertPhoneModeEnabled() {
  const cfg = getAccessSettings();
  if (cfg.mode === 'full') throw new Error('Phone access is not enabled — please sign in with your account');
  return cfg;
}

const OTP_PURPOSE = 'phone_access';

async function sendOtp(phone, cfg) {
  let shopName = 'Shop';
  try { shopName = web().getGlobalSettings().shop_name || 'Shop'; } catch (_) { /* */ }
  const r = await require('./cc-otp').issue({
    purpose: OTP_PURPOSE,
    subject: phone,
    phone,
    digits: 4,
    expiryMinutes: cfg.otp_expiry_minutes,
    emailSubject: `${shopName} verification code`,
    buildText: (code, minutes) => `${shopName}: your verification code is ${code}. It expires in ${minutes} minutes. Do not share this code.`
  });
  if (!r.delivered.length && !r._dev_code) {
    throw new Error('We could not send a verification code right now. Please try again shortly or ask the shop for help.');
  }
  return { via: r.delivered.join('+') || 'dev', _dev_code: r._dev_code };
}

function consumeOtp(phone, code) {
  require('./cc-otp').verify({ purpose: OTP_PURPOSE, subject: phone, code });
  return true;
}

/** Recent verified code for this phone (used by create-profile after OTP). */
function hasFreshVerification(phone) {
  return require('./cc-otp').hasFreshVerification(OTP_PURPOSE, phone, 15);
}

/**
 * Step 1 — customer enters their number.
 * With OTP on, nothing about the account is revealed until the code is verified.
 */
async function start(data = {}) {
  const cfg = assertPhoneModeEnabled();
  const phone = requirePhone(data.phone);
  const masked = web().maskPhone(phone);
  if (cfg.require_otp) {
    const sent = await sendOtp(phone, cfg);
    return {
      status: 'otp_sent',
      phone_masked: masked,
      via: sent.via,
      expires_in_minutes: cfg.otp_expiry_minutes,
      _dev_code: sent._dev_code
    };
  }
  return identify(phone, cfg);
}

function identify(phone, cfg) {
  const found = findCustomerByPhone(phone);
  let customer = found.customer;
  if (!customer && found.webRow && isActive(found.webRow)) {
    customer = linkPosCustomerForWebRow(found.webRow, phone);
  }
  if (customer) return { ...signIn(customer, phone, found.webRow), welcome_back: true };
  return {
    status: cfg.allow_new_customers ? 'not_found' : 'not_allowed',
    phone: phone,
    phone_masked: web().maskPhone(phone),
    message: cfg.allow_new_customers
      ? 'We could not find an account for this number. Create your profile — it only takes your name.'
      : 'We could not find an account for this number. Please ask the shop to register you.'
  };
}

/** Step 2 (OTP only) — verify the code, then identify. */
function verify(data = {}) {
  const cfg = assertPhoneModeEnabled();
  const phone = requirePhone(data.phone);
  consumeOtp(phone, data.code);
  return identify(phone, cfg);
}

/** Not found → name + phone only. Never creates a second record for a known phone. */
function createProfile(data = {}) {
  const cfg = assertPhoneModeEnabled();
  const phone = requirePhone(data.phone);
  const name = String(data.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new Error('Please enter your name');
  if (cfg.require_otp && !hasFreshVerification(phone)) {
    throw new Error('Please verify your number first');
  }
  const found = findCustomerByPhone(phone);
  if (found.customer || (found.webRow && isActive(found.webRow))) {
    return identify(phone, cfg);
  }
  if (!cfg.allow_new_customers) throw new Error('New customer sign-up is not available — please ask the shop');
  let customer;
  try {
    const r = dbRun('INSERT INTO customers (name, phone) VALUES (?,?)', [name, phone]);
    const id = lastId(r, 'SELECT id FROM customers WHERE phone = ? ORDER BY id DESC LIMIT 1', [phone]);
    customer = dbGet('SELECT id, name, phone, email, loyalty_points FROM customers WHERE id = ?', [id]);
  } catch (err) {
    const again = findCustomerByPhone(phone);
    if (!again.customer) throw err;
    return identify(phone, cfg);
  }
  return { ...signIn(customer, phone, found.webRow), created: true };
}

function logout(token) {
  if (!token) return { ok: true };
  try {
    const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
    dbRun('DELETE FROM web_customer_sessions WHERE token_hash = ?', [hash]);
  } catch (_) { /* */ }
  return { ok: true };
}

/** POS / admin lookup by phone — staff-only callers. */
function posLookup(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { found: false };
  const found = findCustomerByPhone(phone);
  if (!found.customer) return { found: false, phone };
  return {
    found: true,
    phone,
    customer: found.customer,
    loyalty_points: Math.floor(Number(found.customer.loyalty_points) || 0),
    duplicate_count: found.duplicate_count
  };
}

function appStatus(customerId, phone) {
  let row = null;
  try {
    row = dbGet('SELECT id, password_hash, is_active, marketing_opt_in, created_at FROM web_customers WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [customerId]);
    if (!row && phone) row = webRowsByPhone(phone)[0] || null;
  } catch (_) { row = null; }
  if (!row) return { status: 'none', label: 'No app account' };
  let lastSeen = null;
  try {
    lastSeen = dbGet('SELECT MAX(created_at) AS t FROM web_customer_sessions WHERE web_customer_id = ?', [row.id])?.t || null;
  } catch (_) { /* */ }
  let prefs = null;
  try {
    prefs = dbGet('SELECT special_offers, loyalty_rewards, new_products, branch_announcements, order_updates, os_permission FROM app_notification_prefs WHERE web_customer_id = ?', [row.id]) || null;
  } catch (_) { /* */ }
  const active = isActive(row);
  return {
    status: !active ? 'inactive' : (row.password_hash ? 'full' : 'phone'),
    label: !active ? 'Deactivated' : (row.password_hash ? 'Full account (password)' : 'Simple phone access'),
    web_customer_id: row.id,
    marketing_opt_in: !!(row.marketing_opt_in && row.marketing_opt_in !== '0'),
    last_sign_in: lastSeen,
    app_notification_prefs: prefs
  };
}

/** Admin → Customers search by name, phone, customer ID, or order/receipt number. */
function adminSearch(q) {
  const term = String(q || '').trim();
  if (!term) return [];
  const ids = new Set();
  const idMatch = term.replace(/^#/, '');
  if (/^\d{1,8}$/.test(idMatch)) {
    const byId = dbGet('SELECT id FROM customers WHERE id = ?', [Number(idMatch)]);
    if (byId) ids.add(byId.id);
  }
  const phone = normalizePhone(term);
  if (phone) customersByPhone(phone).forEach((c) => ids.add(c.id));
  try {
    const sale = dbGet('SELECT customer_id FROM sales WHERE receipt_number = ? AND customer_id IS NOT NULL', [term]);
    if (sale?.customer_id) ids.add(sale.customer_id);
  } catch (_) { /* */ }
  try {
    const oo = dbGet('SELECT customer_id, web_customer_id FROM online_orders_local WHERE order_number = ?', [term]);
    if (oo?.customer_id) ids.add(oo.customer_id);
    else if (oo?.web_customer_id) {
      const w = dbGet('SELECT customer_id FROM web_customers WHERE id = ?', [oo.web_customer_id]);
      if (w?.customer_id) ids.add(w.customer_id);
    }
  } catch (_) { /* */ }
  if (term.length >= 2 && ids.size < 30) {
    try {
      dbAll('SELECT id FROM customers WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 30', [`%${term.toLowerCase()}%`])
        .forEach((r) => ids.add(r.id));
    } catch (_) { /* */ }
  }
  const cc = (() => { try { return require('./communication-center'); } catch (_) { return null; } })();
  return [...ids].slice(0, 30).map((id) => {
    const c = dbGet('SELECT id, name, phone, email, balance, loyalty_points, created_at FROM customers WHERE id = ?', [id]);
    if (!c) return null;
    const summary = summaryFor(c, null);
    let comm = null;
    try { comm = c.phone && cc ? cc.getCustomerPrefs(c.phone) : null; } catch (_) { comm = null; }
    const dupes = c.phone ? customersByPhone(c.phone).filter((d) => Number(d.id) !== Number(c.id)).map((d) => d.id) : [];
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      phone_normalized: normalizePhone(c.phone),
      email: c.email,
      balance: Number(c.balance) || 0,
      loyalty_points: summary.loyalty_points,
      orders: summary.orders,
      last_order_at: summary.last_order_at,
      communication: comm ? {
        whatsapp_marketing: !!Number(comm.whatsapp_marketing),
        sms_marketing: !!Number(comm.sms_marketing),
        email_marketing: !!Number(comm.email_marketing),
        promotions: !!Number(comm.promotions)
      } : null,
      app: appStatus(c.id, c.phone),
      possible_duplicates: dupes
    };
  }).filter(Boolean);
}

module.exports = {
  getAccessSettings,
  saveAccessSettings,
  normalizePhone,
  findCustomerByPhone,
  start,
  verify,
  createProfile,
  logout,
  posLookup,
  adminSearch
};
