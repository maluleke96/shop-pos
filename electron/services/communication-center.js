/**
 * Communication Center — single outbound engine for the whole app.
 * Reuses WhatsApp (whatsapp.js), in-app notifications (store), customers/staff/branches.
 */
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');
const control = require('./cc-control');
const providers = require('./cc-providers');

const SECRET_KEYS = ['api_key', 'smtp_pass', 'access_token', 'client_secret', 'password', 'secret', 'token'];
// Rows written only as a record of an immediate send; their stored address is masked.
const LOG_ONLY_EVENTS = ['auth.otp', 'manual.test'];
const RETRYABLE_STATUSES = ['failed', 'held', 'blocked', 'cancelled'];

const SOCIAL_CHANNELS = ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin'];
const CHANNELS = ['whatsapp', 'sms', 'email', 'inapp', ...SOCIAL_CHANNELS];

const DEFAULT_EVENT_TYPES = [
  { event_key: 'order.new', label: 'New Order', category: 'orders', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["customer","shop","owner"]', is_transactional: 1 },
  { event_key: 'order.accepted', label: 'Order Accepted', category: 'orders', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'order.ready', label: 'Order Ready', category: 'orders', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'order.driver_assigned', label: 'Driver Assigned', category: 'delivery', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer","driver"]', is_transactional: 1 },
  { event_key: 'order.on_the_way', label: 'Driver On The Way', category: 'delivery', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'order.delivered', label: 'Order Delivered', category: 'delivery', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'order.cancelled', label: 'Order Cancelled', category: 'orders', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["customer","shop","owner"]', is_transactional: 1 },
  { event_key: 'payment.confirmed', label: 'Payment Confirmation', category: 'payments', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'payment.failed', label: 'Failed Payment', category: 'payments', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["owner","customer"]', is_transactional: 1 },
  { event_key: 'refund.issued', label: 'Refund', category: 'payments', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["customer","owner"]', is_transactional: 1 },
  { event_key: 'stock.low', label: 'Low Stock', category: 'inventory', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["manager","owner"]', is_transactional: 1 },
  { event_key: 'stock.out', label: 'Out Of Stock', category: 'inventory', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["manager","owner"]', is_transactional: 1 },
  { event_key: 'auth.password_recovery', label: 'Password Recovery', category: 'auth', default_channels_json: '["whatsapp","sms","email"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'auth.verification', label: 'Verification Code', category: 'auth', default_channels_json: '["whatsapp","sms","email"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'auth.registration', label: 'Registration Confirmation', category: 'auth', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 1 },
  { event_key: 'auth.security', label: 'Security Notification', category: 'auth', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["customer","owner"]', is_transactional: 1 },
  { event_key: 'loyalty.reward', label: 'Loyalty Reward', category: 'loyalty', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 0 },
  { event_key: 'promo.publish', label: 'Promotion', category: 'marketing', default_channels_json: '["whatsapp","sms","email"]', default_recipients_json: '["customer_group"]', is_transactional: 0 },
  { event_key: 'sales.target_met', label: 'Sales Target Reached', category: 'sales', default_channels_json: '["whatsapp","email","inapp"]', default_recipients_json: '["owner"]', is_transactional: 1 },
  { event_key: 'sales.target_missed', label: 'Sales Target Missed', category: 'sales', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["owner"]', is_transactional: 1 },
  { event_key: 'sales.daily_report', label: 'Daily Sales Report', category: 'sales', default_channels_json: '["whatsapp","email"]', default_recipients_json: '["owner"]', is_transactional: 1 },
  { event_key: 'pos.offline', label: 'POS Offline', category: 'system', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["owner"]', is_transactional: 1 },
  { event_key: 'pos.online', label: 'POS Online', category: 'system', default_channels_json: '["inapp"]', default_recipients_json: '["owner"]', is_transactional: 1 },
  { event_key: 'system.error', label: 'System Error', category: 'system', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["owner"]', is_transactional: 1 },
  { event_key: 'supplier.invoice', label: 'Supplier Invoice', category: 'suppliers', default_channels_json: '["whatsapp","email","inapp"]', default_recipients_json: '["owner","manager"]', is_transactional: 1 },
  { event_key: 'delivery.failed', label: 'Failed Delivery', category: 'delivery', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["owner","manager","customer"]', is_transactional: 1 },
  { event_key: 'cash.variance', label: 'Cash Variance', category: 'ops', default_channels_json: '["whatsapp","inapp"]', default_recipients_json: '["owner","manager"]', is_transactional: 1 },
  { event_key: 'order.sla_warning', label: 'Order SLA — Supervisor Warning', category: 'ops', default_channels_json: '["inapp"]', default_recipients_json: '["manager"]', is_transactional: 1 },
  { event_key: 'order.sla_overdue', label: 'Order SLA — Overdue', category: 'ops', default_channels_json: '["inapp"]', default_recipients_json: '["manager"]', is_transactional: 1 },
  { event_key: 'order.sla_escalation', label: 'Order SLA — Manager Escalation', category: 'ops', default_channels_json: '["inapp"]', default_recipients_json: '["manager","owner"]', is_transactional: 1 },
  { event_key: 'order.sla_critical', label: 'Order SLA — Critical', category: 'ops', default_channels_json: '["inapp"]', default_recipients_json: '["manager","owner"]', is_transactional: 1 },
  { event_key: 'kiosk.offline', label: 'Kiosk Offline', category: 'system', default_channels_json: '["inapp"]', default_recipients_json: '["manager","owner"]', is_transactional: 1 },
  { event_key: 'builder.share', label: 'Share / Publish Content', category: 'marketing', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer_group"]', is_transactional: 0 },
  { event_key: 'manual.message', label: 'Manual Message', category: 'manual', default_channels_json: '["whatsapp"]', default_recipients_json: '["customer"]', is_transactional: 0 }
];

const DEFAULT_TEMPLATES = [
  { slug: 'cc_password_recovery', name: 'Password Recovery Code', category: 'auth', body: 'Your verification code is {{verification_code}}. This code expires in {{expiry}} minutes. Do not share this code.' },
  { slug: 'cc_order_new_customer', name: 'Order Received (Customer)', category: 'orders', body: 'Hi {{customer_name}}, we received your order #{{order_number}} ({{order_total}}) at {{branch}}. Thank you!' },
  { slug: 'cc_order_new_shop', name: 'New Order (Shop)', category: 'orders', body: 'NEW ORDER #{{order_number}} — {{customer_name}} — {{order_total}} at {{branch}}.' },
  { slug: 'cc_order_ready', name: 'Order Ready', category: 'orders', body: 'Hi {{customer_name}}, your order #{{order_number}} is ready at {{branch}}.' },
  { slug: 'cc_low_stock', name: 'Low Stock Alert', category: 'inventory', body: 'LOW STOCK: {{product_name}} at {{branch}}. Please restock.' },
  { slug: 'cc_promo', name: 'Promotion', category: 'marketing', body: 'Hi {{customer_name}}! {{promotion_name}} at {{branch}}. {{announcement}}' },
  { slug: 'cc_driver_assigned', name: 'Driver Assigned', category: 'delivery', body: 'Hi {{customer_name}}, driver {{driver_name}} is assigned to order #{{order_number}}. Delivery to {{delivery_address}}.' }
];

let _schemaReady = false;
let _queueTimer = null;
let _processing = false;

function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

function nowIso(d = new Date()) {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function dbRun(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}
function dbGet(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}
function dbAll(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function ensureSchema() {
  if (_schemaReady) return;
  try {
    const row = dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name='cc_queue'`);
    if (!row) {
      const mig = path.join(__dirname, '../database/migrations-v119-communication-center.sql');
      if (fs.existsSync(mig)) getDb().exec(fs.readFileSync(mig, 'utf8'));
    }
  } catch (_) { /* */ }
  control.ensureSchema();
  seedDefaults();
  scrubStoredSecrets();
  _schemaReady = true;
  startQueueWorker();
}

/** Provider secrets must live in server environment variables, never in the database. */
function scrubStoredSecrets() {
  try {
    const raw = control.rawSettings();
    const removed = [];
    ['sms', 'email'].forEach((k) => {
      if (raw[k] && typeof raw[k] === 'object') {
        SECRET_KEYS.forEach((s) => { if (raw[k][s] != null) { delete raw[k][s]; removed.push(`${k}.${s}`); } });
      }
    });
    if (removed.length) {
      control.writeRawSettings(raw);
      control.ccAudit(null, 'secrets_removed_from_db', 'cc_settings', 1, { keys: removed });
    }
    (dbAll(`SELECT id, channel, config_json FROM cc_connections WHERE channel IN ('sms','email')`) || []).forEach((c) => {
      const cfg = parseJson(c.config_json, {});
      const gone = SECRET_KEYS.filter((s) => cfg[s] != null);
      if (!gone.length) return;
      gone.forEach((s) => delete cfg[s]);
      dbRun('UPDATE cc_connections SET config_json = ? WHERE id = ?', [JSON.stringify(cfg), c.id]);
      control.ccAudit(null, 'secrets_removed_from_db', 'cc_connections', c.id, { channel: c.channel, keys: gone });
    });
  } catch (_) { /* */ }
}

function seedDefaults() {
  DEFAULT_EVENT_TYPES.forEach((e) => {
    try {
      dbRun(`INSERT OR IGNORE INTO cc_event_types
        (event_key, label, category, default_channels_json, default_recipients_json, is_transactional, enabled)
        VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [e.event_key, e.label, e.category, e.default_channels_json, e.default_recipients_json, e.is_transactional]);
    } catch (_) { /* */ }
  });
  DEFAULT_TEMPLATES.forEach((t) => {
    try {
      dbRun(`INSERT OR IGNORE INTO cc_templates (slug, name, category, channel, body, is_builtin, enabled)
        VALUES (?, ?, ?, 'any', ?, 1, 1)`, [t.slug, t.name, t.category, t.body]);
    } catch (_) { /* */ }
  });
  ['whatsapp', 'sms', 'email', ...SOCIAL_CHANNELS].forEach((ch) => {
    try { dbRun(`INSERT OR IGNORE INTO cc_connections (channel, status, config_json) VALUES (?, 'disconnected', '{}')`, [ch]); }
    catch (_) { /* */ }
  });
  syncWhatsAppConnectionStatus();
}

function audit(actor, action, entityType, entityId, details) {
  try {
    dbRun(`INSERT INTO cc_audit (actor_id, actor_name, action, entity_type, entity_id, details_json)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [actor?.id || null, actor?.full_name || actor?.username || 'system', action, entityType || null, entityId || null, details ? JSON.stringify(details) : null]);
  } catch (_) { /* */ }
}

function getSettings() {
  ensureSchema();
  return parseJson(dbGet('SELECT settings_json FROM cc_settings WHERE id = 1')?.settings_json, {});
}

function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (SECRET_KEYS.includes(k)) return;
    out[k] = stripSecrets(obj[k]);
  });
  return out;
}

function saveSettings(partial, actor) {
  ensureSchema();
  const clean = stripSecrets({ ...(partial || {}) });
  delete clean.control;
  const next = { ...getSettings(), ...clean, updated_at: nowIso() };
  dbRun('UPDATE cc_settings SET settings_json = ?, updated_at = ? WHERE id = 1', [JSON.stringify(next), nowIso()]);
  audit(actor, 'save_settings', 'cc_settings', 1, { keys: Object.keys(clean) });
  return maskSettings(next);
}

function maskSettings(s) {
  return stripSecrets({ ...s });
}

function syncWhatsAppConnectionStatus() {
  try {
    const wa = require('./whatsapp');
    const settings = wa.getWhatsAppSettings?.() || {};
    const connected = !!(settings.api_key_configured || settings.phone_number_id);
    const status = connected ? 'connected' : (settings.default_branch_phone ? 'needs_attention' : 'disconnected');
    dbRun(`UPDATE cc_connections SET status = ?, last_checked_at = ?, config_json = ? WHERE channel = 'whatsapp'`,
      [status, nowIso(), JSON.stringify({
        phone_number_id: settings.phone_number_id || '',
        business_account_id: settings.business_account_id || '',
        default_branch_phone: settings.default_branch_phone || '',
        cloud_api: !!settings.api_key_configured
      })]);
  } catch (_) { /* */ }
}

/** Supports both {{var}} and {var} placeholders. */
function renderTemplate(body, vars = {}) {
  let out = String(body || '');
  Object.keys(vars || {}).forEach((k) => {
    if (!/^[A-Za-z0-9_]+$/.test(k)) return;
    const val = vars[k] != null && typeof vars[k] !== 'object' ? String(vars[k]) : '';
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'gi'), () => val);
    out = out.replace(new RegExp(`\\{${k}\\}`, 'gi'), () => val);
  });
  return out.replace(/\{\{[A-Za-z0-9_]+\}\}/g, '').replace(/\{[a-z][a-z0-9_]*\}/g, '').trim();
}

const SHOP_VARS = ['shop_name', 'branch_name', 'shop_phone', 'shop_address', 'website', 'order_link'];

/** Shop / branch variables resolved server-side for the job's branch. */
function shopVars(branchId) {
  const s = dbGet('SELECT * FROM shop_settings WHERE id = 1') || {};
  let online = {};
  try { online = parseJson(s.online_settings_json, {}) || {}; } catch (_) { online = {}; }
  let branch = null;
  if (branchId) {
    try { branch = dbGet('SELECT * FROM branches WHERE id = ?', [branchId]) || null; } catch (_) { branch = null; }
  }
  const base = String(process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || online.public_url || online.website || '').replace(/\/$/, '');
  const now = new Date(Date.now() + 2 * 3600 * 1000);
  return {
    shop_name: s.shop_name || '',
    branch_name: branch?.name || '',
    branch: branch?.name || s.shop_name || '',
    shop_phone: branch?.phone || s.phone || '',
    shop_address: branch?.address || s.address || '',
    website: base,
    order_link: base ? `${base}/order` : '',
    date: now.toISOString().slice(0, 10),
    time: now.toISOString().slice(11, 16)
  };
}

/** Block messages whose template needs a shop/branch detail that is missing. */
function missingShopDetails(text, vars) {
  const s = String(text || '');
  return SHOP_VARS.filter((k) => (s.includes(`{${k}}`) || s.includes(`{{${k}}}`)) && !String(vars[k] || '').trim());
}

function getTemplate(slug) {
  ensureSchema();
  return dbGet('SELECT * FROM cc_templates WHERE slug = ?', [slug]) || null;
}

function listTemplates(filter = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM cc_templates WHERE 1=1';
  const params = [];
  if (filter.category) { sql += ' AND category = ?'; params.push(filter.category); }
  sql += ' ORDER BY category, name';
  return dbAll(sql, params);
}

function saveTemplate(data, actor) {
  ensureSchema();
  if (data.id) {
    dbRun(`UPDATE cc_templates SET name=?, category=?, channel=?, subject=?, body=?, enabled=?, updated_at=? WHERE id=?`,
      [data.name, data.category || 'general', data.channel || 'any', data.subject || null, data.body,
        data.enabled != null ? (data.enabled ? 1 : 0) : 1, nowIso(), data.id]);
    audit(actor, 'update_template', 'cc_templates', data.id);
    return dbGet('SELECT * FROM cc_templates WHERE id = ?', [data.id]);
  }
  dbRun(`INSERT INTO cc_templates (slug, name, category, channel, subject, body, is_builtin, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
  [String(data.slug || `tpl_${Date.now()}`).slice(0, 80), data.name || 'Template', data.category || 'general',
    data.channel || 'any', data.subject || null, data.body || '']);
  const id = dbGet('SELECT id FROM cc_templates ORDER BY id DESC LIMIT 1')?.id;
  audit(actor, 'create_template', 'cc_templates', id);
  return dbGet('SELECT * FROM cc_templates WHERE id = ?', [id]);
}

function listEventTypes() {
  ensureSchema();
  return dbAll('SELECT * FROM cc_event_types ORDER BY category, label');
}

function saveEventType(data, actor) {
  ensureSchema();
  dbRun(`UPDATE cc_event_types SET label=COALESCE(?,label),
    default_channels_json=COALESCE(?,default_channels_json),
    default_recipients_json=COALESCE(?,default_recipients_json),
    fallback_channels_json=COALESCE(?,fallback_channels_json),
    enabled=COALESCE(?,enabled) WHERE event_key=?`,
  [data.label || null,
    data.default_channels ? JSON.stringify(data.default_channels) : null,
    data.default_recipients ? JSON.stringify(data.default_recipients) : null,
    data.fallback_channels ? JSON.stringify(data.fallback_channels) : null,
    data.enabled != null ? (data.enabled ? 1 : 0) : null,
    data.event_key]);
  audit(actor, 'save_event_type', 'cc_event_types', null, { event_key: data.event_key });
  return dbGet('SELECT * FROM cc_event_types WHERE event_key = ?', [data.event_key]);
}

function listRoutingRules() {
  ensureSchema();
  return dbAll('SELECT * FROM cc_routing_rules ORDER BY event_key, recipient_type');
}

function saveRoutingRule(data, actor) {
  ensureSchema();
  const existing = dbGet('SELECT id FROM cc_routing_rules WHERE event_key = ? AND recipient_type = ?',
    [data.event_key, data.recipient_type]);
  if (existing) {
    dbRun(`UPDATE cc_routing_rules SET channels_json=?, fallback_json=?, enabled=?, branch_scoped=?, template_id=? WHERE id=?`,
      [JSON.stringify(data.channels || ['whatsapp']), JSON.stringify(data.fallback || []),
        data.enabled != null ? (data.enabled ? 1 : 0) : 1,
        data.branch_scoped != null ? (data.branch_scoped ? 1 : 0) : 1,
        data.template_id || null, existing.id]);
    return dbGet('SELECT * FROM cc_routing_rules WHERE id = ?', [existing.id]);
  }
  dbRun(`INSERT INTO cc_routing_rules (event_key, recipient_type, channels_json, fallback_json, enabled, branch_scoped, template_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [data.event_key, data.recipient_type, JSON.stringify(data.channels || ['whatsapp']),
    JSON.stringify(data.fallback || []), data.enabled != null ? (data.enabled ? 1 : 0) : 1,
    data.branch_scoped != null ? (data.branch_scoped ? 1 : 0) : 1, data.template_id || null]);
  audit(actor, 'save_routing', 'cc_routing_rules', null, data);
  return dbGet('SELECT * FROM cc_routing_rules WHERE event_key = ? AND recipient_type = ?',
    [data.event_key, data.recipient_type]);
}

function resolveRecipients(recipientType, ctx = {}) {
  const out = [];
  const settings = dbGet('SELECT phone, shop_name FROM shop_settings WHERE id = 1') || {};
  let waSettings = {};
  try { waSettings = require('./whatsapp').getWhatsAppSettings() || {}; } catch { /* */ }

  if (recipientType === 'customer' && (ctx.customer_phone || ctx.phone)) {
    out.push({
      recipient_type: 'customer', recipient_id: ctx.customer_id || null,
      recipient_name: ctx.customer_name || 'Customer',
      recipient_address: ctx.customer_phone || ctx.phone,
      email: ctx.customer_email || ctx.email || null
    });
  }
  if (recipientType === 'owner' || recipientType === 'admin') {
    let owners = [];
    try {
      owners = dbAll(`SELECT id, full_name, username FROM users WHERE role = 'owner' AND COALESCE(is_active,1)=1 LIMIT 5`) || [];
    } catch (_) {
      try {
        owners = dbAll(`SELECT id, full_name, username FROM users WHERE role = 'owner' LIMIT 5`) || [];
      } catch (__) { owners = []; }
    }
    owners.forEach((u) => out.push({
      recipient_type: 'owner', recipient_id: u.id, recipient_name: u.full_name || u.username,
      recipient_address: waSettings.cashout_whatsapp_phone || waSettings.default_branch_phone || settings.phone || null,
      email: null
    }));
    if (!owners.length) {
      out.push({
        recipient_type: 'owner', recipient_id: null, recipient_name: 'Owner',
        recipient_address: waSettings.cashout_whatsapp_phone || waSettings.default_branch_phone || settings.phone || null,
        email: null
      });
    }
  }
  if (recipientType === 'shop' || recipientType === 'branch') {
    let phone = settings.phone; let email = null; let name = settings.shop_name || 'Shop';
    if (ctx.branch_id) {
      try {
        const dest = dbGet('SELECT * FROM cc_branch_destinations WHERE branch_id = ?', [ctx.branch_id]);
        const branch = dbGet('SELECT * FROM branches WHERE id = ?', [ctx.branch_id]);
        if (branch) name = branch.name || name;
        if (dest?.whatsapp_phone) phone = dest.whatsapp_phone;
        else if (branch?.phone) phone = branch.phone;
        if (dest?.email) email = dest.email;
      } catch (_) { /* */ }
    }
    out.push({ recipient_type: 'shop', recipient_id: ctx.branch_id || null, recipient_name: name, recipient_address: phone, email });
  }
  if (recipientType === 'manager') {
    let managers = [];
    try {
      if (ctx.branch_id) {
        const dest = dbGet('SELECT manager_user_id FROM cc_branch_destinations WHERE branch_id = ?', [ctx.branch_id]);
        if (dest?.manager_user_id) {
          managers = dbAll(`SELECT id, full_name, username FROM users WHERE id = ?`, [dest.manager_user_id]) || [];
        }
      }
      if (!managers.length) {
        managers = dbAll(`SELECT id, full_name, username FROM users WHERE role IN ('manager','assistant_manager') AND COALESCE(is_active,1)=1 LIMIT 10`) || [];
      }
    } catch (_) {
      try {
        managers = dbAll(`SELECT id, full_name, username FROM users WHERE role IN ('manager','assistant_manager') LIMIT 10`) || [];
      } catch (__) { managers = []; }
    }
    managers.forEach((u) => out.push({
      recipient_type: 'manager', recipient_id: u.id, recipient_name: u.full_name || u.username,
      recipient_address: waSettings.default_branch_phone || settings.phone || null, email: null
    }));
    if (!managers.length) {
      out.push({
        recipient_type: 'manager', recipient_id: null, recipient_name: 'Manager',
        recipient_address: waSettings.default_branch_phone || settings.phone || null, email: null
      });
    }
  }
  if (recipientType === 'staff' && ctx.staff_id) {
    let u = null;
    try { u = dbGet(`SELECT id, full_name, username FROM users WHERE id = ?`, [ctx.staff_id]); } catch (_) { /* */ }
    if (u) out.push({ recipient_type: 'staff', recipient_id: u.id, recipient_name: u.full_name || u.username, recipient_address: null, email: null });
  }
  if (recipientType === 'driver' && (ctx.driver_id || ctx.driver_phone)) {
    out.push({
      recipient_type: 'driver', recipient_id: ctx.driver_id || null, recipient_name: ctx.driver_name || 'Driver',
      recipient_address: ctx.driver_phone, email: ctx.driver_email || null
    });
  }
  return out.filter((r) => r.recipient_address || r.email || r.recipient_type === 'owner' || r.recipient_type === 'manager' || r.recipient_type === 'shop');
}

function findPrefs(address) {
  const a = String(address || '').trim();
  if (!a) return null;
  try {
    if (a.includes('@')) return dbGet('SELECT * FROM cc_customer_prefs WHERE LOWER(email_address) = ? LIMIT 1', [a.toLowerCase()]) || null;
    const phone = a.replace(/\D/g, '');
    if (!phone) return null;
    return dbGet('SELECT * FROM cc_customer_prefs WHERE phone = ? OR phone = ? OR phone = ? LIMIT 1',
      [phone, phone.slice(-9), phone.startsWith('27') ? `0${phone.slice(2)}` : phone]) || null;
  } catch (_) { return null; }
}

const flagOn = (v) => v == null || Number(v) !== 0;

/** Customer consent check per channel + message category (security/internal always allowed). */
function prefsAllow(address, channel, category) {
  if (!['whatsapp', 'sms', 'email'].includes(channel)) return true;
  if (category === 'security' || category === 'internal') return true;
  const prefs = findPrefs(address);
  if (!prefs) {
    if (category !== 'marketing' && category !== 'scheduled') return true;
    try {
      const phone = String(address || '').replace(/\D/g, '');
      if (!phone) return true;
      const wc = dbGet(`SELECT marketing_opt_in FROM web_customers WHERE REPLACE(REPLACE(phone,' ',''),'+','') LIKE ? LIMIT 1`, [`%${phone.slice(-9)}`]);
      if (wc && Number(wc.marketing_opt_in) === 0) return false;
    } catch (_) { /* */ }
    return true;
  }
  if (!flagOn(prefs[channel])) return false;
  if (category === 'transaction') return flagOn(prefs.transactional);
  if (category === 'points') return flagOn(prefs.loyalty);
  if (category === 'reminder') return flagOn(prefs.reminders);
  if (prefs.opted_out_at) return false;
  if (!flagOn(prefs.marketing) || !flagOn(prefs.promotions)) return false;
  if (!flagOn(prefs[`${channel}_marketing`])) return false;
  return true;
}

function outboundBody(body, opts, channel, tpl, vars, rec, isTransactional) {
  let text = !opts.body && channel === 'sms' && tpl?.sms_body
    ? renderTemplate(tpl.sms_body, { ...vars, customer_name: rec.recipient_name || vars.customer_name })
    : body;
  if (isTransactional || !['sms', 'whatsapp', 'email'].includes(channel)) return text;
  if (String(text).includes('/cc/unsubscribe')) return text;
  try {
    const link = require('./cc-scheduler').optOutLink(rec.recipient_address);
    if (link) text += `\n\nOpt out: ${link}`;
  } catch (_) { /* */ }
  return text;
}

function presentQueueRow(row) {
  if (!row) return row;
  return { ...row, recipient_address: control.maskAddress(row.recipient_address) };
}

/** Email consent can be recorded against the email address or the customer's phone; both must allow it. */
function consentAllows(address, phone, channel, category) {
  if (!prefsAllow(address, channel, category)) return false;
  if (channel === 'email' && phone && phone !== address && !prefsAllow(phone, channel, category)) return false;
  return true;
}

function respectsMarketingOptOut(recipient, channel, isTransactional) {
  const address = channel === 'email' ? (recipient.email || recipient.recipient_address) : recipient.recipient_address;
  return consentAllows(address, recipient.recipient_address, channel, isTransactional ? 'transaction' : 'marketing');
}

/** Send-time category must match the enqueue decision (a non-transactional manual message is marketing). */
function queuedCategory(eventKey, sourceModule, isTransactional) {
  const base = control.categoryFor(eventKey, sourceModule);
  return !isTransactional && base === 'transaction' ? 'marketing' : base;
}

function emit(eventKey, payload = {}, opts = {}) {
  ensureSchema();
  const event = dbGet('SELECT * FROM cc_event_types WHERE event_key = ?', [eventKey]);
  if (event && !Number(event.enabled)) return { ok: false, reason: 'event_disabled', queued: 0 };

  const channels = opts.channels || parseJson(event?.default_channels_json, ['inapp']);
  const recipientTypes = opts.recipients || parseJson(event?.default_recipients_json, ['owner']);
  const fallback = opts.fallback || parseJson(event?.fallback_channels_json, []);
  const isTransactional = event ? !!Number(event.is_transactional) : !!opts.transactional;
  const branchId = payload.branch_id || opts.branch_id || null;
  const vars = { ...shopVars(branchId), ...(payload.vars || {}), ...payload };
  const tpl = opts.template_slug ? getTemplate(opts.template_slug) : null;
  const bodyTemplate = opts.body || tpl?.body || event?.label || eventKey;
  const missing = missingShopDetails(`${bodyTemplate} ${opts.subject || ''}`, vars);
  if (missing.length) {
    audit(opts.actor, 'blocked_missing_shop_details', 'cc_event', null, { event_key: eventKey, missing, branch_id: branchId });
    return { ok: false, reason: 'missing_shop_details', missing, queued: 0 };
  }
  const body = renderTemplate(bodyTemplate, vars);
  const subject = opts.subject ? renderTemplate(opts.subject, vars) : null;
  const scheduledAt = opts.scheduled_at || null;
  const sourceModule = opts.source_module || payload.source_module || 'system';

  try { fireAutomations(eventKey, payload); } catch (_) { /* */ }

  let queued = 0;
  const ids = [];

  recipientTypes.forEach((rtype) => {
    const rule = dbGet('SELECT * FROM cc_routing_rules WHERE event_key = ? AND recipient_type = ? AND enabled = 1', [eventKey, rtype]);
    const useChannels = rule ? parseJson(rule.channels_json, channels) : channels;
    const useFallback = rule ? parseJson(rule.fallback_json, fallback) : fallback;
    let recipients = resolveRecipients(rtype, payload);
    if (!recipients.length && useChannels.includes('inapp')) {
      recipients = [{ recipient_type: rtype, recipient_id: null, recipient_name: rtype, recipient_address: null }];
    }
    recipients.forEach((rec) => {
      useChannels.forEach((channel) => {
        if (!CHANNELS.includes(channel)) return;
        if (!respectsMarketingOptOut(rec, channel, isTransactional)) return;
        const dedupe = opts.dedupe_key
          ? `${opts.dedupe_key}:${channel}:${rec.recipient_type}:${rec.recipient_id || rec.recipient_address || ''}`
          : null;
        const id = enqueue({
          dedupe_key: dedupe, event_key: eventKey, source_module: sourceModule, channel,
          recipient_type: rec.recipient_type, recipient_id: rec.recipient_id,
          recipient_name: rec.recipient_name,
          recipient_address: channel === 'email' ? (rec.email || rec.recipient_address) : rec.recipient_address,
          branch_id: branchId,
          subject: channel === 'email' && !subject && tpl?.email_subject ? renderTemplate(tpl.email_subject, { ...vars, customer_name: rec.recipient_name || vars.customer_name }) : subject,
          body: outboundBody(body, opts, channel, tpl, vars, rec, isTransactional),
          media_url: opts.media_url || payload.media_url || null, media_id: opts.media_id || null,
          template_slug: opts.template_slug || null, vars_json: JSON.stringify(vars),
          scheduled_at: scheduledAt, priority: opts.priority != null ? Number(opts.priority) : (isTransactional ? 20 : 50),
          campaign_id: opts.campaign_id || null, automation_id: opts.automation_id || null,
          created_by: opts.actor?.id || null,
          provider_meta_json: JSON.stringify({
            fallback: useFallback, phone: rec.recipient_address || null, email: rec.email || null,
            category: queuedCategory(eventKey, sourceModule, isTransactional)
          })
        });
        if (id) { queued += 1; ids.push(id); }
      });
    });
  });

  setImmediate(() => { try { processQueue(12); } catch (_) { /* */ } });
  return { ok: true, queued, ids };
}

function enqueue(row) {
  ensureSchema();
  if (row.dedupe_key && !control.claimDedupe(row.dedupe_key)) return null;
  try {
    const r = dbRun(`INSERT INTO cc_queue (
      dedupe_key, event_key, source_module, channel, recipient_type, recipient_id,
      recipient_name, recipient_address, branch_id, subject, body, media_url, media_id,
      template_slug, vars_json, status, priority, scheduled_at, campaign_id, automation_id,
      created_by, provider_meta_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.dedupe_key || null, row.event_key || null, row.source_module || null, row.channel,
      row.recipient_type || null, row.recipient_id || null, row.recipient_name || null,
      row.recipient_address || null, row.branch_id || null, row.subject || null, row.body,
      row.media_url || null, row.media_id || null, row.template_slug || null, row.vars_json || '{}',
      row.status || 'pending', row.priority != null ? row.priority : 50, row.scheduled_at || null,
      row.campaign_id || null, row.automation_id || null, row.created_by || null, row.provider_meta_json || null]);
    let id = Number(r?.lastInsertRowid) || 0;
    if (!id) {
      id = Number(dbGet(`SELECT id FROM cc_queue ORDER BY id DESC LIMIT 1`)?.id) || 0;
    }
    control.linkDedupe(row.dedupe_key, id);
    return id || true;
  } catch (err) {
    control.releaseDedupe(row.dedupe_key);
    if (String(err.message || '').includes('UNIQUE')) return null;
    throw err;
  }
}

function startQueueWorker() {
  if (_queueTimer) return;
  _queueTimer = setInterval(() => { try { processQueue(20); } catch (_) { /* */ } }, 4000);
  if (typeof _queueTimer.unref === 'function') _queueTimer.unref();
}

async function processQueue(limit = 15) {
  try {
    const entitlements = require('./entitlements');
    if (!entitlements.shouldRunJob(['mod.communication'])) {
      return { processed: 0, skipped: 'FEATURE_NOT_INCLUDED' };
    }
  } catch (_) { /* */ }
  if (_processing) return { processed: 0 };
  _processing = true;
  let processed = 0;
  try {
    ensureSchema();
    try { require('./cc-scheduler').runDue(); } catch (_) { /* scheduler optional */ }
    const due = dbAll(`SELECT * FROM cc_queue WHERE status IN ('pending','retrying')
      AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime('now'))
      ORDER BY priority ASC, id ASC LIMIT ?`, [limit]) || [];
    for (const job of due) {
      const ctl = control.getControl();
      const gate = control.gateJob(job, ctl);
      if (!gate.allow) {
        if (gate.action === 'defer') {
          dbRun(`UPDATE cc_queue SET scheduled_at = ?, last_error = ? WHERE id = ?`, [nowIso(gate.until), gate.reason, job.id]);
        } else {
          dbRun(`UPDATE cc_queue SET status = ?, last_error = ? WHERE id = ?`,
            [gate.action === 'hold' ? 'held' : 'blocked', gate.reason, job.id]);
        }
        continue;
      }
      const jobMeta = parseJson(job.provider_meta_json, {});
      if (job.recipient_type === 'customer' && !consentAllows(job.recipient_address, jobMeta.phone, job.channel, gate.category)) {
        dbRun(`UPDATE cc_queue SET status = 'blocked', last_error = 'customer_opted_out' WHERE id = ?`, [job.id]);
        continue;
      }
      dbRun(`UPDATE cc_queue SET status = 'processing', attempts = attempts + 1, processed_at = ? WHERE id = ?`, [nowIso(), job.id]);
      try {
        const result = await deliverJob(job);
        if (job.channel !== 'inapp') {
          control.recordAttempt({ queue_id: job.id, channel: job.channel, provider: result.provider, recipient: job.recipient_address,
            status: result.ok ? 'sent' : 'failed', error: result.ok ? null : result.error, external_id: result.external_id });
        }
        if (result.ok) {
          dbRun(`UPDATE cc_queue SET status = ?, sent_at = ?, external_id = ?, last_error = NULL WHERE id = ?`,
            [result.delivered ? 'delivered' : 'sent', nowIso(), result.external_id || null, job.id]);
        } else await failOrRetry(job, result.error || 'Delivery failed', ctl, !!result.not_configured);
      } catch (err) {
        await failOrRetry(job, err.message || String(err), control.getControl(), false);
      }
      processed += 1;
    }
  } catch (err) {
    if (!/not initialized/i.test(String(err.message || ''))) throw err;
  } finally { _processing = false; }
  return { processed };
}

async function failOrRetry(job, error, ctl = control.getControl(), notConfigured = false) {
  const attempts = Number(job.attempts || 0) + 1;
  const max = Math.min(Number(job.max_attempts || 3), Number(ctl.retry?.max_attempts || 3));
  const meta = parseJson(job.provider_meta_json, {});
  const fallback = Array.isArray(meta.fallback) ? meta.fallback : [];
  if (attempts < max && !notConfigured) {
    const backoff = Number(ctl.retry?.backoff_seconds || 60) * attempts;
    dbRun(`UPDATE cc_queue SET status = 'retrying', last_error = ?, attempts = ?, scheduled_at = ? WHERE id = ?`,
      [String(error).slice(0, 500), attempts, nowIso(new Date(Date.now() + backoff * 1000)), job.id]);
    return;
  }
  const phoneOf = () => meta.phone || (job.channel !== 'email' ? job.recipient_address : null);
  const emailOf = () => meta.email || (job.channel === 'email' ? job.recipient_address : null);
  const next = fallback.find((c) => c && c !== job.channel && (c === 'email' ? emailOf() : phoneOf()));
  if (next) {
    enqueue({
      dedupe_key: job.dedupe_key ? `${job.dedupe_key}:fb:${next}` : null,
      event_key: job.event_key, source_module: job.source_module, channel: next,
      recipient_type: job.recipient_type, recipient_id: job.recipient_id,
      recipient_name: job.recipient_name, recipient_address: next === 'email' ? emailOf() : phoneOf(),
      branch_id: job.branch_id, subject: job.subject, body: job.body,
      media_url: job.media_url, media_id: job.media_id, template_slug: job.template_slug,
      vars_json: job.vars_json, priority: Math.max(1, Number(job.priority || 50) - 5),
      campaign_id: job.campaign_id, automation_id: job.automation_id, created_by: job.created_by,
      provider_meta_json: JSON.stringify({ fallback: fallback.filter((c) => c !== next), from_fallback_of: job.channel, phone: phoneOf(), email: emailOf() })
    });
  }
  dbRun(`UPDATE cc_queue SET status = 'failed', last_error = ?, attempts = ? WHERE id = ?`, [String(error).slice(0, 500), attempts, job.id]);
}

async function deliverJob(job) {
  if (job.channel === 'inapp') {
    try {
      require('./store').addNotification(job.event_key || 'cc_message', job.subject || job.event_key || 'Notification', job.body, {
        entity_type: job.source_module || 'communication', entity_id: job.id,
        audience_roles: job.recipient_type === 'owner' ? 'owner' : job.recipient_type === 'manager' ? 'owner,manager' : null,
        _from_cc: true
      });
      return { ok: true, delivered: true };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  if (job.channel === 'whatsapp') return deliverWhatsApp(job);
  if (job.channel === 'sms') return deliverSms(job);
  if (job.channel === 'email') return deliverEmail(job);
  if (SOCIAL_CHANNELS.includes(job.channel)) return deliverSocial(job, job.channel);
  return { ok: false, error: `Unknown channel: ${job.channel}` };
}

function jobTemplate(job) {
  if (!job.template_slug) return null;
  try { return getTemplate(job.template_slug); } catch (_) { return null; }
}

async function deliverWhatsApp(job) {
  if (!job.recipient_address) return { ok: false, provider: 'whatsapp_cloud', error: 'No WhatsApp phone' };
  const tpl = jobTemplate(job);
  let template = null;
  if (tpl?.wa_template_name && String(tpl.wa_approval_status || '').toLowerCase() === 'approved') {
    const vars = parseJson(job.vars_json, {});
    const order = parseJson(tpl.wa_variables_json, []);
    template = {
      name: tpl.wa_template_name,
      language: tpl.wa_language || 'en',
      params: (Array.isArray(order) ? order : []).map((k) => (vars[k] != null ? String(vars[k]) : ''))
    };
  }
  return providers.sendWhatsApp({ to: job.recipient_address, text: job.body, template });
}

async function deliverSms(job) {
  return providers.sendSms({ to: job.recipient_address, text: job.body });
}

async function deliverEmail(job) {
  const tpl = jobTemplate(job);
  const vars = parseJson(job.vars_json, {});
  const html = tpl?.email_html ? renderTemplate(tpl.email_html, vars) : null;
  const text = tpl?.email_text ? renderTemplate(tpl.email_text, vars) : job.body;
  const shop = vars.shop_name || '';
  return providers.sendEmail({
    to: job.recipient_address,
    subject: job.subject || (tpl?.email_subject ? renderTemplate(tpl.email_subject, vars) : (shop ? `Message from ${shop}` : 'Message')),
    text,
    html
  });
}

async function deliverSocial(job, channel) {
  const conn = dbGet('SELECT * FROM cc_connections WHERE channel = ?', [channel]);
  if (!conn || conn.status !== 'connected') return { ok: false, error: `${channel} not connected` };
  const cfg = parseJson(conn.config_json, {});
  if (!cfg.access_token || !cfg.publish_url) {
    return { ok: false, error: `${channel} needs OAuth / publish URL (approval may be required)` };
  }
  try {
    const res = await fetch(cfg.publish_url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: job.body, media_url: job.media_url || undefined })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error?.message || json?.error || `Social HTTP ${res.status}` };
    return { ok: true, delivered: true, external_id: json?.id || null };
  } catch (err) { return { ok: false, error: err.message || String(err) }; }
}

function fireAutomations(eventKey, payload) {
  ensureSchema();
  const rules = dbAll(`SELECT * FROM cc_automations WHERE enabled = 1 AND event_key = ?`, [eventKey]) || [];
  rules.forEach((rule) => {
    const cond = parseJson(rule.condition_json, {});
    if (cond.min_total != null && Number(payload.order_total || payload.total || 0) < Number(cond.min_total)) return;
    const actions = parseJson(rule.actions_json, []);
    (Array.isArray(actions) ? actions : [actions]).forEach((act) => {
      emit(act.event_key || eventKey, payload, {
        channels: act.channels, recipients: act.recipients, body: act.body,
        template_slug: act.template_slug, source_module: 'automation', automation_id: rule.id,
        dedupe_key: `auto:${rule.id}:${eventKey}:${payload.order_number || payload.entity_id || Date.now()}`
      });
    });
    dbRun(`UPDATE cc_automations SET last_fired_at = ?, fire_count = fire_count + 1 WHERE id = ?`, [nowIso(), rule.id]);
  });
}

function createMessage(data, actor) {
  ensureSchema();
  const channels = data.channels || ['whatsapp'];
  const mode = data.mode || 'now';
  if (mode === 'draft') {
    const r = dbRun(`INSERT INTO cc_campaigns (name, body, subject, media_id, channels_json, audience_json, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [data.name || data.subject || 'Draft message', data.body || '', data.subject || null, data.media_id || null,
      JSON.stringify(channels), JSON.stringify(data.audience || { type: 'manual' }), actor?.id || null]);
    audit(actor, 'save_draft', 'cc_campaigns', r.lastInsertRowid);
    return { ok: true, draft_id: r.lastInsertRowid, status: 'draft' };
  }
  return emit(data.event_key || 'manual.message', {
    customer_name: data.recipient_name, customer_phone: data.recipient_phone || data.phone,
    customer_email: data.recipient_email, customer_id: data.customer_id, branch_id: data.branch_id,
    media_url: data.media_url, announcement: data.body, promotion_name: data.name
  }, {
    channels, recipients: data.recipients || ['customer'], body: data.body, subject: data.subject,
    scheduled_at: mode === 'schedule' ? data.scheduled_at : null, media_url: data.media_url,
    media_id: data.media_id, source_module: data.source_module || 'manual', actor,
    transactional: !!data.transactional, priority: 40
  });
}

function expandAudience(audience) {
  const type = audience?.type || 'all_eligible';
  let rows = [];
  let fromWeb = false;
  try {
    if (type === 'selected' && Array.isArray(audience.ids) && audience.ids.length) {
      const ph = audience.ids.map(() => '?').join(',');
      rows = dbAll(`SELECT id, name, phone, email FROM customers WHERE id IN (${ph})`, audience.ids) || [];
    } else if (type === 'branch' && audience.branch_id) {
      rows = dbAll(`SELECT id, name, phone, email FROM customers WHERE branch_id = ? AND phone IS NOT NULL LIMIT 5000`, [audience.branch_id]) || [];
    } else if (type === 'loyalty') {
      rows = dbAll(`SELECT id, name, phone, email FROM customers WHERE COALESCE(loyalty_points,0) > 0 AND phone IS NOT NULL LIMIT 5000`) || [];
    } else if (type === 'recent') {
      rows = dbAll(`SELECT DISTINCT c.id, c.name, c.phone, c.email FROM customers c JOIN sales s ON s.customer_id = c.id
        WHERE date(s.created_at) >= date('now', '-30 days') AND c.phone IS NOT NULL LIMIT 5000`) || [];
    } else if (type === 'inactive') {
      rows = dbAll(`SELECT c.id, c.name, c.phone, c.email FROM customers c WHERE c.phone IS NOT NULL AND c.id NOT IN (
        SELECT DISTINCT customer_id FROM sales WHERE customer_id IS NOT NULL AND date(created_at) >= date('now', '-60 days')) LIMIT 5000`) || [];
    } else if (type === 'manual' && audience.phone) {
      return [{ recipient_type: 'customer', recipient_id: null, recipient_name: audience.name || 'Recipient', recipient_address: audience.phone, email: audience.email || null }];
    } else {
      try {
        rows = dbAll(`SELECT id, full_name AS name, phone, email FROM web_customers WHERE phone IS NOT NULL AND COALESCE(marketing_opt_in,1)=1 LIMIT 5000`) || [];
      } catch (_) { rows = []; }
      fromWeb = rows.length > 0;
      if (!rows.length) rows = dbAll(`SELECT id, name, phone, email FROM customers WHERE phone IS NOT NULL AND phone != '' LIMIT 5000`) || [];
    }
  } catch (_) { rows = []; }
  return rows.map((r) => ({
    recipient_type: 'customer', recipient_id: r.id, recipient_name: r.name || 'Customer',
    recipient_address: r.phone, email: r.email || null, ...(fromWeb ? { web_customer: true } : {})
  }));
}

function previewAudienceCount(audience) {
  return expandAudience(audience || { type: 'all_eligible' }).length;
}

function sharePublish(data, actor) {
  ensureSchema();
  let mediaId = data.media_id || null;
  if (data.media_url || data.file_path) {
    const m = addMedia({
      title: data.title || data.name || 'Shared content', kind: data.media_kind || 'image',
      public_url: data.media_url || null, file_path: data.file_path || null,
      source_module: data.source_module || 'builder', source_ref: data.source_ref || null, mime_type: data.mime_type || null
    }, actor);
    mediaId = m?.id || mediaId;
  }
  const audience = data.audience || { type: data.audience_type || 'all_eligible' };
  const campaign = dbRun(`INSERT INTO cc_campaigns (name, body, subject, media_id, channels_json, audience_json, status, scheduled_at, created_by, recipient_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [data.title || data.name || 'Share / Publish', data.body || data.message || '', data.subject || null, mediaId,
    JSON.stringify(data.channels || ['whatsapp']), JSON.stringify(audience),
    data.mode === 'schedule' ? 'scheduled' : (data.mode === 'draft' ? 'draft' : 'sending'),
    data.scheduled_at || null, actor?.id || null, 0]);
  let campaignId = Number(campaign?.lastInsertRowid) || 0;
  if (!campaignId) campaignId = Number(dbGet('SELECT id FROM cc_campaigns ORDER BY id DESC LIMIT 1')?.id) || 0;
  if (data.mode === 'draft') return { ok: true, campaign_id: campaignId, status: 'draft' };

  const recipients = expandAudience(audience);
  let queued = 0;
  recipients.forEach((rec) => {
    (data.channels || ['whatsapp']).forEach((channel) => {
      if (SOCIAL_CHANNELS.includes(channel)) return;
      if (!respectsMarketingOptOut(rec, channel, false)) return;
      const id = enqueue({
        dedupe_key: `share:${campaignId}:${channel}:${rec.recipient_id || rec.recipient_address}`,
        event_key: 'builder.share', source_module: data.source_module || 'builder', channel,
        recipient_type: rec.recipient_type || 'customer', recipient_id: rec.recipient_id,
        recipient_name: rec.recipient_name, recipient_address: channel === 'email' ? rec.email : rec.recipient_address,
        body: outboundBody(data.body || data.message || data.title || 'New update from us!', { body: true }, channel, null, {}, rec, false),
        subject: data.subject || data.title,
        provider_meta_json: JSON.stringify({ phone: rec.recipient_address || null, email: rec.email || null }),
        media_url: data.media_url, media_id: mediaId,
        scheduled_at: data.mode === 'schedule' ? data.scheduled_at : null,
        campaign_id: campaignId, created_by: actor?.id || null, priority: 55
      });
      if (id) queued += 1;
    });
  });
  (data.channels || []).filter((c) => SOCIAL_CHANNELS.includes(c)).forEach((channel) => {
    const id = enqueue({
      dedupe_key: `share:${campaignId}:${channel}:social`, event_key: 'builder.share',
      source_module: data.source_module || 'builder', channel, recipient_type: 'social', recipient_name: channel,
      body: data.body || data.message || data.title || '', media_url: data.media_url, media_id: mediaId,
      scheduled_at: data.mode === 'schedule' ? data.scheduled_at : null, campaign_id: campaignId,
      created_by: actor?.id || null, priority: 55
    });
    if (id) queued += 1;
  });
  dbRun(`UPDATE cc_campaigns SET recipient_count = ?, status = ? WHERE id = ?`,
    [recipients.length, data.mode === 'schedule' ? 'scheduled' : 'queued', campaignId]);
  audit(actor, 'share_publish', 'cc_campaigns', campaignId, { queued, channels: data.channels });
  setImmediate(() => { try { processQueue(25); } catch (_) { /* */ } });
  return { ok: true, campaign_id: campaignId, queued, recipients: recipients.length };
}

function addMedia(data, actor) {
  ensureSchema();
  const r = dbRun(`INSERT INTO cc_media (title, kind, mime_type, file_path, public_url, source_module, source_ref, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [data.title || 'Media', data.kind || 'image', data.mime_type || null, data.file_path || null,
    data.public_url || null, data.source_module || null, data.source_ref || null, actor?.id || null]);
  return dbGet('SELECT * FROM cc_media WHERE id = ?', [r.lastInsertRowid]);
}

function listMedia(limit = 100) {
  ensureSchema();
  return dbAll(`SELECT * FROM cc_media ORDER BY id DESC LIMIT ?`, [limit]) || [];
}

function listHistory(filters = {}) {
  ensureSchema();
  let sql = `SELECT * FROM cc_queue WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ` AND status = ?`; params.push(filters.status); }
  if (filters.channel) { sql += ` AND channel = ?`; params.push(filters.channel); }
  if (filters.event_key) { sql += ` AND event_key = ?`; params.push(filters.event_key); }
  if (filters.branch_id) { sql += ` AND branch_id = ?`; params.push(filters.branch_id); }
  if (filters.q) {
    sql += ` AND (recipient_name LIKE ? OR recipient_address LIKE ? OR body LIKE ? OR event_key LIKE ?)`;
    const q = `%${filters.q}%`; params.push(q, q, q, q);
  }
  if (filters.from) { sql += ` AND date(created_at) >= date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(created_at) <= date(?)`; params.push(filters.to); }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(Number(filters.limit) || 200, 500));
  return (dbAll(sql, params) || []).map(presentQueueRow);
}

function listFailed() { return listHistory({ status: 'failed', limit: 200 }); }
function listScheduled() {
  ensureSchema();
  return (dbAll(`SELECT * FROM cc_queue WHERE status IN ('pending','retrying') AND scheduled_at IS NOT NULL ORDER BY scheduled_at ASC LIMIT 200`) || []).map(presentQueueRow);
}

function retryJob(id, actor) {
  ensureSchema();
  const job = dbGet('SELECT id, event_key, status FROM cc_queue WHERE id = ?', [id]);
  if (!job) throw new Error('Message not found');
  if (LOG_ONLY_EVENTS.includes(job.event_key)) throw new Error('Verification codes and test messages cannot be resent from the log');
  if (!RETRYABLE_STATUSES.includes(job.status)) throw new Error(`Cannot retry — status is ${job.status}`);
  dbRun(`UPDATE cc_queue SET status = 'pending', last_error = NULL, attempts = 0 WHERE id = ?`, [id]);
  audit(actor, 'retry', 'cc_queue', id);
  setImmediate(() => { try { processQueue(5); } catch (_) { /* */ } });
  return { ok: true };
}

function cancelJob(id, actor) {
  ensureSchema();
  dbRun(`UPDATE cc_queue SET status = 'cancelled' WHERE id = ? AND status IN ('pending','retrying')`, [id]);
  audit(actor, 'cancel', 'cc_queue', id);
  return { ok: true };
}

function sendJobNow(id, actor) {
  ensureSchema();
  const job = dbGet('SELECT id, event_key, status FROM cc_queue WHERE id = ?', [id]);
  if (!job) throw new Error('Message not found');
  if (LOG_ONLY_EVENTS.includes(job.event_key) || !['pending', 'retrying'].includes(job.status)) {
    throw new Error(`Cannot send now — status is ${job.status}`);
  }
  dbRun(`UPDATE cc_queue SET scheduled_at = NULL WHERE id = ? AND status IN ('pending','retrying')`, [id]);
  audit(actor, 'send_now', 'cc_queue', id);
  setImmediate(() => { try { processQueue(5); } catch (_) { /* */ } });
  return { ok: true };
}

function listAutomations() { ensureSchema(); return dbAll(`SELECT * FROM cc_automations ORDER BY id DESC`) || []; }

function saveAutomation(data, actor) {
  ensureSchema();
  if (data.id) {
    dbRun(`UPDATE cc_automations SET name=?, event_key=?, condition_json=?, actions_json=?, enabled=?, updated_at=? WHERE id=?`,
      [data.name, data.event_key, JSON.stringify(data.condition || {}), JSON.stringify(data.actions || []),
        data.enabled != null ? (data.enabled ? 1 : 0) : 1, nowIso(), data.id]);
    audit(actor, 'update_automation', 'cc_automations', data.id);
    return dbGet('SELECT * FROM cc_automations WHERE id = ?', [data.id]);
  }
  const r = dbRun(`INSERT INTO cc_automations (name, event_key, condition_json, actions_json, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [data.name || 'Automation', data.event_key, JSON.stringify(data.condition || {}), JSON.stringify(data.actions || []),
      data.enabled != null ? (data.enabled ? 1 : 0) : 1, actor?.id || null]);
  let id = Number(r?.lastInsertRowid) || 0;
  if (!id) id = Number(dbGet('SELECT id FROM cc_automations ORDER BY id DESC LIMIT 1')?.id) || 0;
  audit(actor, 'create_automation', 'cc_automations', id);
  return dbGet('SELECT * FROM cc_automations WHERE id = ?', [id]);
}

function setAutomationEnabled(id, enabled, actor) {
  ensureSchema();
  dbRun(`UPDATE cc_automations SET enabled = ?, updated_at = ? WHERE id = ?`, [enabled ? 1 : 0, nowIso(), id]);
  audit(actor, enabled ? 'enable_automation' : 'disable_automation', 'cc_automations', id);
  return dbGet('SELECT * FROM cc_automations WHERE id = ?', [id]);
}

function listCampaigns() { ensureSchema(); return dbAll(`SELECT * FROM cc_campaigns ORDER BY id DESC LIMIT 100`) || []; }

function listConnections() {
  ensureSchema();
  syncWhatsAppConnectionStatus();
  return (dbAll(`SELECT id, channel, provider, status, config_json, last_error, last_checked_at, updated_at FROM cc_connections ORDER BY channel`) || [])
    .map((c) => {
      const cfg = parseJson(c.config_json, {});
      delete cfg.api_key; delete cfg.access_token; delete cfg.client_secret; delete cfg.smtp_pass;
      return { id: c.id, channel: c.channel, provider: c.provider, status: c.status, config: cfg, last_error: c.last_error, last_checked_at: c.last_checked_at, updated_at: c.updated_at };
    });
}

function saveConnection(data, actor) {
  ensureSchema();
  const channel = data.channel;
  if (!channel) throw new Error('Channel required');
  const existing = dbGet('SELECT * FROM cc_connections WHERE channel = ?', [channel]);
  const prev = parseJson(existing?.config_json, {});
  const incoming = { ...(data.config || {}) };
  const offered = SECRET_KEYS.filter((k) => incoming[k] && !String(incoming[k]).includes('••'));
  if (offered.length && ['whatsapp', 'sms', 'email'].includes(channel)) {
    throw new Error('Provider keys and passwords cannot be saved here. Add them as server environment variables (Railway → Variables).');
  }
  SECRET_KEYS.forEach((k) => { if (['whatsapp', 'sms', 'email'].includes(channel)) delete incoming[k]; });
  ['access_token', 'client_secret'].forEach((k) => {
    if (incoming[k] && String(incoming[k]).includes('••')) incoming[k] = prev[k];
    if (incoming[k] === '' || incoming[k] == null) delete incoming[k];
  });
  const merged = { ...prev, ...incoming };

  if (channel === 'whatsapp') {
    if (incoming.phone_number_id || incoming.business_account_id) {
      try {
        const wa = require('./whatsapp');
        const cur = wa.getWhatsAppSettings() || {};
        wa.saveWhatsAppSettings({
          phone_number_id: incoming.phone_number_id || cur.phone_number_id,
          business_account_id: incoming.business_account_id || cur.business_account_id
        }, actor);
      } catch (_) { /* */ }
    }
    syncWhatsAppConnectionStatus();
    return listConnections().find((c) => c.channel === 'whatsapp');
  }

  let status = 'disconnected';
  if (merged.api_key || merged.access_token || merged.api_url) status = 'connected';
  else if (merged.client_id && !merged.access_token) status = 'needs_attention';

  if (existing) {
    dbRun(`UPDATE cc_connections SET provider=?, status=?, config_json=?, last_error=NULL, last_checked_at=?, updated_at=?, updated_by=? WHERE channel=?`,
      [data.provider || existing.provider, status, JSON.stringify(merged), nowIso(), nowIso(), actor?.id || null, channel]);
  } else {
    dbRun(`INSERT INTO cc_connections (channel, provider, status, config_json, updated_by) VALUES (?, ?, ?, ?, ?)`,
      [channel, data.provider || null, status, JSON.stringify(merged), actor?.id || null]);
  }
  if (channel === 'sms') saveSettings({ sms: { ...getSettings().sms, ...merged, provider: data.provider || merged.provider } }, actor);
  if (channel === 'email') saveSettings({ email: { ...getSettings().email, ...merged, provider: data.provider || merged.provider } }, actor);
  audit(actor, 'save_connection', 'cc_connections', null, { channel, status });
  return listConnections().find((c) => c.channel === channel);
}

function getBranchDestinations() {
  ensureSchema();
  return (dbAll(`SELECT id, name, code, phone, address FROM branches ORDER BY name`) || []).map((b) => ({
    ...b, destination: dbGet('SELECT * FROM cc_branch_destinations WHERE branch_id = ?', [b.id]) || {}
  }));
}

function saveBranchDestination(data, actor) {
  ensureSchema();
  const existing = dbGet('SELECT id FROM cc_branch_destinations WHERE branch_id = ?', [data.branch_id]);
  if (existing) {
    dbRun(`UPDATE cc_branch_destinations SET whatsapp_phone=?, sms_phone=?, email=?, manager_user_id=?,
      notify_new_order=?, notify_cancel=?, notify_stock=?, updated_at=? WHERE branch_id=?`,
    [data.whatsapp_phone || null, data.sms_phone || null, data.email || null, data.manager_user_id || null,
      data.notify_new_order != null ? (data.notify_new_order ? 1 : 0) : 1,
      data.notify_cancel != null ? (data.notify_cancel ? 1 : 0) : 1,
      data.notify_stock != null ? (data.notify_stock ? 1 : 0) : 1, nowIso(), data.branch_id]);
  } else {
    dbRun(`INSERT INTO cc_branch_destinations (branch_id, whatsapp_phone, sms_phone, email, manager_user_id, notify_new_order, notify_cancel, notify_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.branch_id, data.whatsapp_phone || null, data.sms_phone || null, data.email || null, data.manager_user_id || null,
      data.notify_new_order != null ? (data.notify_new_order ? 1 : 0) : 1,
      data.notify_cancel != null ? (data.notify_cancel ? 1 : 0) : 1,
      data.notify_stock != null ? (data.notify_stock ? 1 : 0) : 1]);
  }
  audit(actor, 'save_branch_destination', 'cc_branch_destinations', data.branch_id);
  return getBranchDestinations().find((b) => b.id === data.branch_id);
}

function otpSubject(data) {
  const phone = String(data.phone || '').replace(/\D/g, '');
  const email = String(data.email || '').trim().toLowerCase();
  return phone || email;
}

async function createVerificationCode(data, actor) {
  ensureSchema();
  const purpose = String(data.purpose || 'verification');
  const subject = otpSubject(data);
  if (!subject) throw new Error('Phone or email required');
  const shop = shopVars(null).shop_name || 'Shop';
  const r = await require('./cc-otp').issue({
    purpose: `cc:${purpose}`, subject, phone: data.phone, email: data.email, name: data.customer_name,
    emailSubject: `${shop} verification code`,
    buildText: (code, minutes) => `${shop}: your verification code is ${code}. It expires in ${minutes} minutes. Do not share this code.`
  });
  audit(actor, 'create_verification', 'cc_otp_requests', r.request_id, { purpose, delivered: r.delivered, failed: r.failed.map((f) => f.channel) });
  return { ok: r.delivered.length > 0, delivered: r.delivered, failed: r.failed, expires_in_minutes: r.expires_in_minutes, _dev_code: r._dev_code };
}

function verifyCode(data) {
  ensureSchema();
  const purpose = String(data.purpose || 'verification');
  return require('./cc-otp').verify({ purpose: `cc:${purpose}`, subject: otpSubject(data), code: data.code });
}

function last7DaysSeries() {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const row = dbGet(`SELECT date('now','localtime','-${i} days') AS d`)?.d;
    const channels = {};
    ['whatsapp', 'sms', 'email', 'facebook', 'instagram', 'tiktok'].forEach((ch) => {
      channels[ch] = Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE date(created_at,'localtime') = date(?) AND channel = ? AND status IN ('sent','delivered')`, [row, ch])?.c || 0);
    });
    days.push({ date: row, ...channels });
  }
  return days;
}

function dashboard() {
  ensureSchema();
  syncWhatsAppConnectionStatus();
  const countWhere = (extra) => Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE date(created_at,'localtime') = date('now','localtime') ${extra || ''}`)?.c || 0);
  const byChannel = {};
  CHANNELS.forEach((ch) => { byChannel[ch] = countWhere(`AND channel = '${ch}' AND status IN ('sent','delivered')`); });
  return {
    today: dbGet(`SELECT date('now','localtime') AS d`)?.d,
    totals: {
      sent_today: countWhere(`AND status IN ('sent','delivered')`),
      whatsapp: byChannel.whatsapp, sms: byChannel.sms, email: byChannel.email, inapp: byChannel.inapp,
      social: byChannel.facebook + byChannel.instagram + byChannel.tiktok + byChannel.youtube + byChannel.x,
      customer: countWhere(`AND recipient_type = 'customer' AND status IN ('sent','delivered')`),
      owner: countWhere(`AND recipient_type IN ('owner','admin') AND status IN ('sent','delivered')`),
      shop: countWhere(`AND recipient_type IN ('shop','branch') AND status IN ('sent','delivered')`),
      manager: countWhere(`AND recipient_type IN ('manager','staff') AND status IN ('sent','delivered')`),
      scheduled: Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE status IN ('pending','retrying') AND scheduled_at IS NOT NULL`)?.c || 0),
      pending: Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE status IN ('pending','retrying','processing')`)?.c || 0),
      failed: Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE status = 'failed' AND date(created_at) = date('now','localtime')`)?.c || 0),
      automations_active: Number(dbGet(`SELECT COUNT(*) AS c FROM cc_automations WHERE enabled = 1`)?.c || 0)
    },
    by_channel: byChannel,
    recent: dbAll(`SELECT id, created_at, event_key, recipient_type, recipient_name, channel, status, body, source_module, last_error FROM cc_queue ORDER BY id DESC LIMIT 25`) || [],
    connections: listConnections(),
    overview_7d: last7DaysSeries()
  };
}

function bridgeInAppNotification(type, title, message, opts = {}) {
  try {
    ensureSchema();
    const map = {
      low_stock: 'stock.low', out_of_stock: 'stock.out', reorder: 'stock.low',
      target_met: 'sales.target_met', target_missed: 'sales.target_missed',
      delivery_order: 'order.new', cashout: 'cash.variance', cashup: 'cash.variance'
    };
    const eventKey = map[type];
    if (!eventKey) return;
    if (getSettings().bridge_inapp === false) return;
    emit(eventKey, { product_name: title, announcement: message, branch_id: opts.branch_id, entity_id: opts.entity_id }, {
      channels: ['whatsapp'],
      recipients: /stock|target|cash/.test(type) ? ['owner', 'manager'] : ['owner'],
      body: `${title}\n${message}`, source_module: 'store.notifications', transactional: true,
      dedupe_key: `bridge:${type}:${opts.entity_type || ''}:${opts.entity_id || title}:${new Date().toISOString().slice(0, 10)}`
    });
  } catch (_) { /* never break POS */ }
}

function getCustomerPrefs(phone) {
  ensureSchema();
  const digits = String(phone || '').replace(/\D/g, '');
  return dbGet(`SELECT * FROM cc_customer_prefs WHERE phone = ? OR phone = ?`, [digits, digits.slice(-9)]) || null;
}

function saveCustomerPrefs(data, actor) {
  ensureSchema();
  const phone = String(data.phone || '').replace(/\D/g, '');
  if (!phone) throw new Error('Phone required');
  const existing = getCustomerPrefs(phone);
  if (existing) {
    dbRun(`UPDATE cc_customer_prefs SET whatsapp_marketing=?, sms_marketing=?, email_marketing=?, promotions=?,
      customer_id=COALESCE(?,customer_id), web_customer_id=COALESCE(?,web_customer_id), updated_at=? WHERE id=?`,
    [data.whatsapp_marketing != null ? (data.whatsapp_marketing ? 1 : 0) : existing.whatsapp_marketing,
      data.sms_marketing != null ? (data.sms_marketing ? 1 : 0) : existing.sms_marketing,
      data.email_marketing != null ? (data.email_marketing ? 1 : 0) : existing.email_marketing,
      data.promotions != null ? (data.promotions ? 1 : 0) : existing.promotions,
      data.customer_id || null, data.web_customer_id || null, nowIso(), existing.id]);
  } else {
    dbRun(`INSERT INTO cc_customer_prefs (customer_id, web_customer_id, phone, whatsapp_marketing, sms_marketing, email_marketing, promotions)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.customer_id || null, data.web_customer_id || null, phone,
      data.whatsapp_marketing != null ? (data.whatsapp_marketing ? 1 : 0) : 1,
      data.sms_marketing != null ? (data.sms_marketing ? 1 : 0) : 1,
      data.email_marketing != null ? (data.email_marketing ? 1 : 0) : 1,
      data.promotions != null ? (data.promotions ? 1 : 0) : 1]);
  }
  audit(actor, 'save_customer_prefs', 'cc_customer_prefs', null, { phone: phone.slice(-4) });
  return getCustomerPrefs(phone);
}

/** Meta WhatsApp webhook: provider-confirmed delivered / read / failed statuses. */
function applyWhatsAppStatuses(payload) {
  ensureSchema();
  let updated = 0;
  (payload?.entry || []).forEach((e) => (e.changes || []).forEach((ch) => (ch.value?.statuses || []).forEach((st) => {
    if (!st?.id) return;
    const s = String(st.status || '');
    if (s === 'delivered' || s === 'read') {
      const r = dbRun(`UPDATE cc_queue SET status = 'delivered', last_error = NULL WHERE external_id = ? AND status IN ('sent','delivered')`, [st.id]);
      updated += Number(r?.changes || 0);
    } else if (s === 'failed') {
      const err = st.errors?.[0]?.title || st.errors?.[0]?.message || 'WhatsApp delivery failed';
      const r = dbRun(`UPDATE cc_queue SET status = 'failed', last_error = ? WHERE external_id = ?`, [String(err).slice(0, 400), st.id]);
      updated += Number(r?.changes || 0);
      control.recordAttempt({ channel: 'whatsapp', provider: 'whatsapp_cloud', recipient: st.recipient_id, status: 'failed', error: err, external_id: st.id });
    }
  })));
  return { updated };
}

function controlDashboard() {
  ensureSchema();
  return {
    control: control.getControl(),
    providers: providers.providerStatus(),
    usage: control.usage(),
    alerts: control.listAlerts(20),
    otp: require('./cc-otp').stats(),
    held: Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE status = 'held'`)?.c || 0),
    blocked_today: Number(dbGet(`SELECT COUNT(*) AS c FROM cc_queue WHERE status = 'blocked' AND datetime(created_at) >= datetime(?)`,
      [nowIso(new Date(Date.now() - 86400000))])?.c || 0)
  };
}

function listDeliveryAttempts(limit = 200) {
  ensureSchema();
  return dbAll('SELECT * FROM cc_delivery_attempts ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 200, 500)]) || [];
}

function listAudit(limit = 200) {
  ensureSchema();
  return dbAll('SELECT * FROM cc_audit ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 200, 500)]) || [];
}

/** Admin test send through the real provider (goes through switches + logs). */
async function testSend(data, actor) {
  ensureSchema();
  const channel = String(data.channel || '');
  if (!control.MESSAGE_CHANNELS.includes(channel)) throw new Error('Choose SMS, WhatsApp or Email');
  const to = String(data.to || '').trim();
  if (!to) throw new Error('Enter a recipient');
  const ctl = control.getControl();
  if (ctl.emergency_off) throw new Error('Emergency OFF is active — nothing can be sent');
  if (!ctl.channels[channel]) throw new Error(`${channel.toUpperCase()} is switched off`);
  const shop = shopVars(null).shop_name || 'Shop';
  const text = String(data.text || `Test message from ${shop} Communication Center.`).slice(0, 1000);
  const r = await providers.send(channel, { to, text, subject: `${shop} — test message` });
  const q = dbRun(`INSERT INTO cc_queue (event_key, source_module, channel, recipient_type, recipient_name, recipient_address, body, status,
    priority, attempts, last_error, external_id, processed_at, sent_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ['manual.test', 'admin_test', channel, 'staff', actor?.full_name || actor?.username || 'admin', control.maskAddress(to), text, r.ok ? 'sent' : 'failed', 1, 1,
    r.ok ? null : String(r.error || '').slice(0, 500), r.external_id || null, nowIso(), r.ok ? nowIso() : null, actor?.id || null, nowIso()]);
  control.recordAttempt({ queue_id: Number(q?.lastInsertRowid) || null, channel, provider: r.provider, recipient: to,
    status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, external_id: r.external_id });
  audit(actor, 'test_send', 'cc_queue', Number(q?.lastInsertRowid) || null, { channel, to: control.maskAddress(to), ok: !!r.ok, provider: r.provider });
  return { ok: !!r.ok, provider: r.provider, error: r.ok ? null : r.error, external_id: r.external_id || null, used_fallback: !!r.used_fallback };
}

/** Read-only webhook status for the admin UI. Never returns the verify token or app secret. */
function webhookStatus() {
  ensureSchema();
  let callbackUrl = '/api/webhooks/whatsapp';
  try { callbackUrl = require('./whatsapp-webhook').webhookPublicInfo().callback_url || callbackUrl; } catch (_) { /* */ }
  const count = (sql, params) => { try { return Number(dbGet(sql, params || [])?.c || 0); } catch (_) { return 0; } };
  const statusRows = (() => { try { return dbAll(`SELECT status, COUNT(*) AS c FROM cc_queue WHERE channel = 'whatsapp' GROUP BY status`) || []; } catch (_) { return []; } })();
  return {
    endpoints: [{
      name: 'WhatsApp Cloud API (Meta)', method: 'GET + POST', path: '/api/webhooks/whatsapp', callback_url: callbackUrl,
      purpose: 'Meta verification (GET) and inbound messages + delivered/read/failed receipts (POST)',
      verify_token_set: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      app_secret_set: !!process.env.WHATSAPP_APP_SECRET,
      subscribe_fields: ['messages']
    }, {
      name: 'SMS delivery receipts (Vodacom)', method: '—', path: null, callback_url: null,
      purpose: 'UNVERIFIED — pending official API specification. No SMS webhook is exposed until the provider specification is confirmed.',
      verify_token_set: null, app_secret_set: null
    }],
    whatsapp_status_counts: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.c || 0)])),
    whatsapp_delivered_total: count(`SELECT COUNT(*) AS c FROM cc_queue WHERE channel = 'whatsapp' AND status = 'delivered'`),
    note: 'Receipts marked "delivered" only come from the provider webhook. Without the webhook, WhatsApp messages stay "sent" (accepted by Meta).'
  };
}

/** Read-only role access matrix for Communication Center actions (mirrors the RPC handler checks). */
function permissionsMatrix() {
  const rows = [
    ['View dashboard and message log', ['owner', 'manager', 'supervisor']],
    ['Share / publish to social, view media library', ['owner', 'manager', 'supervisor']],
    ['Failed and scheduled messages, retry / cancel / send now', ['owner', 'manager']],
    ['Create / send messages and campaigns', ['owner', 'manager']],
    ['Templates, automation, reminders, routing', ['owner', 'manager']],
    ['Provider status, connections and test sends', ['owner', 'manager']],
    ['Settings, branch destinations, OTP events', ['owner', 'manager']],
    ['Emergency OFF / resume a channel', ['owner', 'manager']],
    ['Control switches and releasing held messages', ['owner']],
    ['Customer message preferences / opt-out', ['owner', 'manager', 'supervisor', 'cashier']],
    ['Audit trail', ['owner']]
  ];
  return {
    roles: ['owner', 'manager', 'supervisor', 'cashier'],
    rows: rows.map(([action, roles]) => ({ action, roles })),
    secrets_note: 'Provider keys are server environment variables only (Railway → Variables). No role can view or enter them in the app.',
    marketing_note: 'Marketing Center campaigns are delivered through the Communication Center and require the Marketing send/approve permissions (Users → Permissions).'
  };
}

module.exports = {
  webhookStatus, permissionsMatrix, SOCIAL_CHANNELS,
  applyWhatsAppStatuses, controlDashboard, listDeliveryAttempts, listAudit, testSend, prefsAllow,
  CHANNELS, ensureSchema, emit, enqueue, processQueue, createMessage, sharePublish,
  previewAudienceCount, expandAudience, dashboard, listHistory, listFailed, listScheduled,
  retryJob, cancelJob, sendJobNow, listTemplates, saveTemplate, getTemplate, listEventTypes,
  saveEventType, listRoutingRules, saveRoutingRule, listAutomations, saveAutomation,
  setAutomationEnabled, listCampaigns, listConnections, saveConnection, listMedia, addMedia,
  getSettings, saveSettings, getBranchDestinations, saveBranchDestination, createVerificationCode,
  verifyCode, bridgeInAppNotification, getCustomerPrefs, saveCustomerPrefs, renderTemplate
};
