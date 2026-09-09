/**
 * Communication Centre — campaigns, automations, queue, loyalty expiry, admin logs.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');
const providers = require('./communication-providers');

const RETRY_DELAYS_MS = [0, 60_000, 300_000, 900_000];

const DEFAULT_TEMPLATES = [
  {
    slug: 'loyalty_expiry_7d', name: '7-Day Loyalty Expiry Reminder', category: 'expiry', channel: 'push',
    body: 'Hi {{first_name}}, you have {{points_expiring}} loyalty points that expire on {{expiry_date}}. Use them before they expire.'
  },
  {
    slug: 'loyalty_expiry_1d', name: '1-Day Loyalty Expiry Reminder', category: 'expiry', channel: 'push',
    body: 'Your {{points_expiring}} loyalty points expire tomorrow. Use them before they expire, {{first_name}}!'
  },
  {
    slug: 'welcome_customer', name: 'Welcome New Customer', category: 'welcome', channel: 'whatsapp',
    body: 'Welcome to {{business_name}}, {{first_name}}! We are glad to have you.'
  },
  {
    slug: 'order_ready', name: 'Order Ready', category: 'orders', channel: 'push',
    body: 'Hi {{first_name}}, your order {{order_number}} is ready for collection.'
  }
];

const DEFAULT_AUTOMATION = {
  name: '7-Day Loyalty Expiry Reminder',
  description: 'Daily at 09:00 — notify customers whose loyalty points expire within 7 days.',
  trigger_type: 'loyalty_expiring',
  trigger_config_json: { days_before: 7, run_time: '09:00' },
  conditions_json: { min_points: 1 },
  audience_json: { type: 'loyalty_expiring' },
  channel_strategy_json: { channels: ['push'], fallback: ['whatsapp'] },
  schedule_cron: 'daily_09:00',
  is_active: 0,
  is_transactional: 1
};

function db() { return getDb(); }
function dbGet(sql, p = []) { return db().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return db().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return db().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function uid(prefix = 'msg') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function parseJson(v, fb = {}) { try { return v ? (typeof v === 'string' ? JSON.parse(v) : v) : fb; } catch { return fb; } }
function toJson(v) { return JSON.stringify(v ?? null); }

function commRole(actor) {
  if (!actor) return null;
  if (actor.comm_role) return actor.comm_role;
  if (['owner', 'manager', 'supervisor'].includes(actor.role)) return 'admin';
  if (actor.role === 'marketing_agent') return 'marketing';
  if (actor.role === 'assistant_manager') return 'marketing';
  return 'viewer';
}

/** Works for standalone portal tokens AND admin-panel shop sessions. */
function normalizeCommActor(actor) {
  if (!actor?.username && actor?.id == null) throw new Error('Authentication required');
  if (actor.source === 'portal' || actor.comm_role) return actor;
  try {
    return assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'marketing_agent']);
  } catch (err) {
    if (actor.username) return actor;
    throw err;
  }
}

function requireCommAdmin(actor) {
  const a = normalizeCommActor(actor);
  if (commRole(a) !== 'admin') throw new Error('Admin access required');
  return a;
}

function requireCommView(actor) {
  const a = normalizeCommActor(actor);
  const r = commRole(a);
  if (!['admin', 'marketing', 'viewer'].includes(r)) throw new Error('You do not have permission');
  return a;
}

function requireCommSend(actor) {
  const a = normalizeCommActor(actor);
  if (!['admin', 'marketing'].includes(commRole(a))) throw new Error('You do not have permission to send');
  return a;
}

function ensureSchema() {
  const pgDb = require('../database/pg-db');
  if (pgDb.isPgMode()) {
    const mig = path.join(__dirname, '../../supabase/migrations/20260909_communication_centre.sql');
    if (fs.existsSync(mig)) {
      try {
        const { splitSqlStatements } = require('../database/ensure-pg-schema');
        const sql = fs.readFileSync(mig, 'utf8');
        for (const stmt of splitSqlStatements(sql)) {
          try { db().exec(stmt); } catch (e) {
            if (!/already exists|duplicate column/i.test(String(e.message || e))) {
              console.warn('[comm] PG schema:', String(e.message || e).slice(0, 120));
            }
          }
        }
      } catch (e) {
        console.warn('[comm] ensureSchema PG:', e.message || e);
      }
    }
  } else {
    const mig = path.join(__dirname, '../database/migrations-v103-communication-centre.sql');
    if (fs.existsSync(mig)) {
      try { db().exec(fs.readFileSync(mig, 'utf8')); } catch (_) { /* columns may exist */ }
    }
  }
  seedDefaults();
}

function seedDefaults() {
  for (const t of DEFAULT_TEMPLATES) {
    const exists = dbGet('SELECT id FROM comm_templates WHERE slug = ?', [t.slug]);
    if (!exists) {
      dbRun(`INSERT INTO comm_templates (slug, name, category, channel, body, is_builtin, is_active)
        VALUES (?,?,?,?,?,1,1)`, [t.slug, t.name, t.category, t.channel, t.body]);
    }
  }
  const auto = dbGet('SELECT id FROM comm_automations WHERE name = ?', [DEFAULT_AUTOMATION.name]);
  if (!auto) {
    const tpl = dbGet('SELECT id FROM comm_templates WHERE slug = ?', ['loyalty_expiry_7d']);
    dbRun(`INSERT INTO comm_automations
      (name, description, trigger_type, trigger_config_json, conditions_json, audience_json,
       channel_strategy_json, template_id, schedule_cron, is_active, is_transactional, next_run_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
      DEFAULT_AUTOMATION.name,
      DEFAULT_AUTOMATION.description,
      DEFAULT_AUTOMATION.trigger_type,
      toJson(DEFAULT_AUTOMATION.trigger_config_json),
      toJson(DEFAULT_AUTOMATION.conditions_json),
      toJson(DEFAULT_AUTOMATION.audience_json),
      toJson(DEFAULT_AUTOMATION.channel_strategy_json),
      tpl?.id || null,
      DEFAULT_AUTOMATION.schedule_cron,
      DEFAULT_AUTOMATION.is_active,
      DEFAULT_AUTOMATION.is_transactional,
      computeNextRun(DEFAULT_AUTOMATION.schedule_cron)
    ]);
  }
  for (const p of [
    { channel: 'sms', provider_key: 'console', name: 'Console (log only)' },
    { channel: 'whatsapp', provider_key: 'console', name: 'Console (log only)' },
    { channel: 'email', provider_key: 'console', name: 'Console (log only)' },
    { channel: 'push', provider_key: 'in_app', name: 'In-app push' }
  ]) {
    const ex = dbGet('SELECT id FROM comm_providers WHERE channel = ? AND provider_key = ?', [p.channel, p.provider_key]);
    if (!ex) {
      dbRun(`INSERT INTO comm_providers (channel, provider_key, name, is_active, is_default, config_json)
        VALUES (?,?,?,1,1,'{}')`, [p.channel, p.provider_key, p.name]);
    }
  }
}

function computeNextRun(scheduleCron) {
  const now = new Date();
  if (scheduleCron === 'daily_09:00') {
    const next = new Date(now);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString().slice(0, 19).replace('T', ' ');
  }
  return nowIso();
}

function getSettings() {
  const row = dbGet('SELECT settings_json FROM comm_settings WHERE id = 1');
  const defaults = {
    log_level: 'info',
    log_retention_days: 90,
    log_admin_actions: true,
    log_message_events: true,
    usage_limits: { sms: 5000, whatsapp: 5000, email: 10000, push: 50000 },
    loyalty_expiry_days: 365,
    default_timezone: 'Africa/Johannesburg'
  };
  return { ...defaults, ...parseJson(row?.settings_json, {}) };
}

function saveSettings(data, actor) {
  requireCommAdmin(actor);
  const cur = getSettings();
  const merged = { ...cur, ...(data || {}) };
  dbRun('UPDATE comm_settings SET settings_json = ?, updated_at = ?, updated_by = ? WHERE id = 1',
    [toJson(merged), nowIso(), actor?.id || null]);
  audit(actor, 'settings_changed', 'comm_settings', 1, { keys: Object.keys(data || {}) });
  return merged;
}

function audit(actor, action, entityType, entityId, details) {
  const settings = getSettings();
  if (!settings.log_admin_actions) return;
  dbRun(`INSERT INTO comm_audit_logs (user_id, username, action, entity_type, entity_id, details_json, created_at)
    VALUES (?,?,?,?,?,?,?)`, [
    actor?.id || null,
    actor?.username || actor?.name || 'system',
    action,
    entityType || null,
    entityId || null,
    details ? toJson(details) : null,
    nowIso()
  ]);
}

function getAdminLogs(filters = {}, actor) {
  requireCommAdmin(actor);
  const where = [];
  const params = [];
  if (filters.action) { where.push('action = ?'); params.push(filters.action); }
  if (filters.from) { where.push('created_at >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('created_at <= ?'); params.push(`${filters.to} 23:59:59`); }
  if (filters.username) { where.push('username LIKE ?'); params.push(`%${filters.username}%`); }
  const sql = `SELECT * FROM comm_audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ${Math.min(Number(filters.limit) || 200, 500)}`;
  return dbAll(sql, params).map((r) => ({ ...r, details: parseJson(r.details_json, {}) }));
}

function maskProvider(row) {
  if (!row) return null;
  return {
    ...row,
    config: providers.maskConfig(parseJson(row.config_json, {})),
    config_json: undefined
  };
}

function getProviders(actor) {
  requireCommView(actor);
  return dbAll('SELECT * FROM comm_providers ORDER BY channel, name').map(maskProvider);
}

function saveProvider(data, actor) {
  requireCommAdmin(actor);
  const id = data.id ? Number(data.id) : null;
  const existing = id ? dbGet('SELECT * FROM comm_providers WHERE id = ?', [id]) : null;
  let config = parseJson(data.config || data.config_json, {});
  if (existing) {
    const oldCfg = parseJson(existing.config_json, {});
    for (const [k, v] of Object.entries(config)) {
      if (v === '••••••••' && oldCfg[k]) config[k] = oldCfg[k];
    }
  }
  if (id) {
    dbRun(`UPDATE comm_providers SET channel=?, provider_key=?, name=?, config_json=?, is_active=?, is_default=?, updated_at=? WHERE id=?`, [
      data.channel, data.provider_key, data.name, toJson(config), data.is_active ? 1 : 0, data.is_default ? 1 : 0, nowIso(), id
    ]);
    audit(actor, 'provider_updated', 'comm_provider', id, { channel: data.channel });
    return maskProvider(dbGet('SELECT * FROM comm_providers WHERE id = ?', [id]));
  }
  const r = dbRun(`INSERT INTO comm_providers (channel, provider_key, name, config_json, is_active, is_default)
    VALUES (?,?,?,?,?,?)`, [
    data.channel, data.provider_key, data.name, toJson(config), data.is_active ? 1 : 0, data.is_default ? 1 : 0
  ]);
  audit(actor, 'provider_created', 'comm_provider', r.lastInsertRowid, { channel: data.channel });
  return maskProvider(dbGet('SELECT * FROM comm_providers WHERE id = ?', [r.lastInsertRowid]));
}

async function testProviderConnection(id, actor) {
  requireCommAdmin(actor);
  const row = dbGet('SELECT * FROM comm_providers WHERE id = ?', [Number(id)]);
  if (!row) throw new Error('Provider not found');
  const config = parseJson(row.config_json, {});
  const result = await providers.testProvider(row.channel, row.provider_key, config);
  dbRun('UPDATE comm_providers SET last_test_at = ?, last_test_status = ? WHERE id = ?',
    [nowIso(), result.ok ? 'ok' : 'failed', row.id]);
  audit(actor, 'provider_tested', 'comm_provider', row.id, { ok: result.ok });
  return result;
}

function getTemplates(filters = {}, actor) {
  requireCommView(actor);
  const where = [];
  const params = [];
  if (filters.channel) { where.push('channel = ?'); params.push(filters.channel); }
  if (filters.category) { where.push('category = ?'); params.push(filters.category); }
  if (filters.active_only) { where.push('is_active = 1'); }
  const sql = `SELECT * FROM comm_templates ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY category, name`;
  return dbAll(sql, params);
}

function saveTemplate(data, actor) {
  requireCommSend(actor);
  const id = data.id ? Number(data.id) : null;
  if (id) {
    dbRun(`UPDATE comm_templates SET name=?, slug=?, category=?, channel=?, subject=?, body=?, is_active=?, updated_at=? WHERE id=?`, [
      data.name, data.slug || null, data.category || 'general', data.channel, data.subject || null,
      data.body, data.is_active !== false ? 1 : 0, nowIso(), id
    ]);
    audit(actor, 'template_updated', 'comm_template', id, { name: data.name });
    return dbGet('SELECT * FROM comm_templates WHERE id = ?', [id]);
  }
  const r = dbRun(`INSERT INTO comm_templates (name, slug, category, channel, subject, body, is_active, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?,?)`, [
    data.name, data.slug || null, data.category || 'general', data.channel, data.subject || null,
    data.body, data.is_active !== false ? 1 : 0, actor?.id || null, actor?.username || null
  ]);
  audit(actor, 'template_created', 'comm_template', r.lastInsertRowid, { name: data.name });
  return dbGet('SELECT * FROM comm_templates WHERE id = ?', [r.lastInsertRowid]);
}

function deleteTemplate(id, actor) {
  requireCommAdmin(actor);
  dbRun('UPDATE comm_templates SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), Number(id)]);
  audit(actor, 'template_deactivated', 'comm_template', Number(id), {});
  return true;
}

function renderTemplate(body, vars = {}) {
  return String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key] ?? vars[key.toLowerCase()] ?? '';
    return String(v);
  });
}

function getBusinessName() {
  const s = dbGet('SELECT shop_name FROM shop_settings WHERE id = 1');
  return s?.shop_name || 'Shop POS';
}

function buildCustomerVars(customer, extra = {}) {
  const name = customer?.name || '';
  const parts = name.trim().split(/\s+/);
  return {
    customer_name: name,
    first_name: parts[0] || name,
    phone: customer?.phone || '',
    email: customer?.email || '',
    loyalty_points: customer?.loyalty_points ?? 0,
    business_name: getBusinessName(),
    ...extra
  };
}

function getPreferences(customerId) {
  const row = dbGet('SELECT * FROM comm_preferences WHERE customer_id = ?', [Number(customerId)]);
  return row || {
    customer_id: Number(customerId),
    sms_enabled: 1,
    whatsapp_enabled: 1,
    email_enabled: 1,
    push_enabled: 1,
    marketing_opt_in: 1
  };
}

function savePreferences(customerId, data, actor) {
  requireCommSend(actor);
  const cid = Number(customerId);
  const ex = dbGet('SELECT customer_id FROM comm_preferences WHERE customer_id = ?', [cid]);
  const vals = [
    data.sms_enabled !== false ? 1 : 0,
    data.whatsapp_enabled !== false ? 1 : 0,
    data.email_enabled !== false ? 1 : 0,
    data.push_enabled !== false ? 1 : 0,
    data.marketing_opt_in !== false ? 1 : 0,
    nowIso(),
    cid
  ];
  if (ex) {
    dbRun(`UPDATE comm_preferences SET sms_enabled=?, whatsapp_enabled=?, email_enabled=?, push_enabled=?, marketing_opt_in=?, updated_at=? WHERE customer_id=?`, vals);
  } else {
    dbRun(`INSERT INTO comm_preferences (sms_enabled, whatsapp_enabled, email_enabled, push_enabled, marketing_opt_in, updated_at, customer_id)
      VALUES (?,?,?,?,?,?,?)`, vals);
  }
  audit(actor, 'preferences_updated', 'customer', cid, data);
  return getPreferences(cid);
}

function getCustomerCommProfile(customerId, actor) {
  requireCommView(actor);
  const customer = dbGet('SELECT * FROM customers WHERE id = ?', [Number(customerId)]);
  if (!customer) throw new Error('Customer not found');
  const prefs = getPreferences(customerId);
  const lastMsg = dbGet(`SELECT * FROM comm_messages WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1`, [Number(customerId)]);
  const history = dbAll(`SELECT id, channel, status, subject, body, sent_at, delivered_at, failed_at, created_at
    FROM comm_messages WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`, [Number(customerId)]);
  const devices = dbAll('SELECT * FROM comm_devices WHERE customer_id = ? AND is_active = 1', [Number(customerId)]);
  return {
    customer,
    preferences: prefs,
    app_installed: devices.length > 0,
    push_enabled: !!prefs.push_enabled,
    whatsapp_available: !!customer.phone,
    last_message: lastMsg || null,
    history
  };
}

function getSegments(actor) {
  requireCommView(actor);
  return dbAll('SELECT * FROM comm_segments WHERE is_active = 1 ORDER BY name').map((s) => ({
    ...s, rules: parseJson(s.rules_json, {})
  }));
}

function saveSegment(data, actor) {
  requireCommSend(actor);
  const id = data.id ? Number(data.id) : null;
  const rules = toJson(data.rules || data.rules_json || {});
  if (id) {
    dbRun('UPDATE comm_segments SET name=?, description=?, rules_json=?, updated_at=? WHERE id=?',
      [data.name, data.description || null, rules, nowIso(), id]);
    return dbGet('SELECT * FROM comm_segments WHERE id = ?', [id]);
  }
  const r = dbRun('INSERT INTO comm_segments (name, description, rules_json, created_by) VALUES (?,?,?,?)',
    [data.name, data.description || null, rules, actor?.id || null]);
  return dbGet('SELECT * FROM comm_segments WHERE id = ?', [r.lastInsertRowid]);
}

function evaluateSegmentRules(rules = {}) {
  const customers = dbAll('SELECT * FROM customers WHERE phone IS NOT NULL OR email IS NOT NULL');
  return customers.filter((c) => {
    if (rules.min_points != null && Number(c.loyalty_points || 0) < Number(rules.min_points)) return false;
    if (rules.has_points && Number(c.loyalty_points || 0) <= 0) return false;
    if (rules.is_vip && !c.is_vip) return false;
    if (rules.inactive_days != null) {
      const last = dbGet('SELECT MAX(created_at) as d FROM sales WHERE customer_id = ?', [c.id]);
      if (!last?.d) return true;
      const days = (Date.now() - new Date(last.d).getTime()) / 86400000;
      if (days < Number(rules.inactive_days)) return false;
    }
    return true;
  });
}

function evaluateSegment(id) {
  const seg = dbGet('SELECT * FROM comm_segments WHERE id = ?', [Number(id)]);
  if (!seg) throw new Error('Segment not found');
  return evaluateSegmentRules(parseJson(seg.rules_json, {}));
}

function resolveAudience(audience = {}, segmentId = null) {
  if (segmentId) return evaluateSegment(segmentId);
  const type = audience.type || audience.audience_type || 'all';
  if (type === 'manual' && Array.isArray(audience.customer_ids)) {
    const ids = audience.customer_ids.map(Number);
    return dbAll(`SELECT * FROM customers WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  if (type === 'loyalty_expiring') {
    return getLoyaltyExpiringCustomers(Number(audience.days_before || 7));
  }
  if (type === 'loyalty_customers') {
    return dbAll('SELECT * FROM customers WHERE COALESCE(loyalty_points,0) > 0');
  }
  if (type === 'all') return dbAll('SELECT * FROM customers');
  return evaluateSegmentRules(audience);
}

function getLoyaltyExpiringCustomers(daysBefore = 7) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysBefore);
  const day = targetDate.toISOString().slice(0, 10);
  const rows = dbAll(`
    SELECT c.*, l.id as lot_id, l.points_remaining as points_expiring, l.expires_at as expiry_date
    FROM comm_loyalty_lots l
    JOIN customers c ON c.id = l.customer_id
    WHERE l.status IN ('active','partial') AND date(l.expires_at) = date(?)
      AND l.points_remaining > 0
  `, [day]);
  return rows;
}

function recordLoyaltyLot(customerId, points, saleId = null) {
  if (!customerId || !points || points <= 0) return null;
  const settings = getSettings();
  const days = Number(settings.loyalty_expiry_days) || 365;
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  const r = dbRun(`INSERT INTO comm_loyalty_lots
    (customer_id, sale_id, points_earned, points_remaining, expires_at, status, earned_at, updated_at)
    VALUES (?,?,?,?,?,'active',?,?)`, [
    customerId, saleId, points, points, expires.toISOString().slice(0, 10), nowIso(), nowIso()
  ]);
  return r.lastInsertRowid;
}

function expireDueLoyaltyLots() {
  const today = new Date().toISOString().slice(0, 10);
  const lots = dbAll(`SELECT * FROM comm_loyalty_lots WHERE status IN ('active','partial') AND date(expires_at) < date(?)`, [today]);
  for (const lot of lots) {
    const pts = Number(lot.points_remaining) || 0;
    if (pts > 0) {
      dbRun(`UPDATE customers SET loyalty_points = CASE WHEN COALESCE(loyalty_points,0) - ? < 0 THEN 0 ELSE COALESCE(loyalty_points,0) - ? END WHERE id = ?`, [pts, pts, lot.customer_id]);
      dbRun(`INSERT INTO loyalty_transactions (customer_id, points, type, notes) VALUES (?,?,?,?)`,
        [lot.customer_id, -pts, 'expire', `Points expired (${lot.expires_at})`]);
    }
    dbRun(`UPDATE comm_loyalty_lots SET status='expired', points_remaining=0, updated_at=? WHERE id=?`, [nowIso(), lot.id]);
  }
  return lots.length;
}

function getCampaigns(filters = {}, actor) {
  requireCommView(actor);
  return dbAll('SELECT * FROM comm_campaigns ORDER BY created_at DESC LIMIT 200').map((c) => ({
    ...c,
    audience: parseJson(c.audience_json, {}),
    channel_strategy: parseJson(c.channel_strategy_json, {})
  }));
}

function getCampaign(id, actor) {
  requireCommView(actor);
  const c = dbGet('SELECT * FROM comm_campaigns WHERE id = ?', [Number(id)]);
  if (!c) throw new Error('Campaign not found');
  return { ...c, audience: parseJson(c.audience_json, {}), channel_strategy: parseJson(c.channel_strategy_json, {}) };
}

function saveCampaign(data, actor) {
  requireCommSend(actor);
  const id = data.id ? Number(data.id) : null;
  const vals = [
    data.name,
    data.description || null,
    data.status || 'draft',
    data.audience_type || data.audience?.type || 'all',
    toJson(data.audience || data.audience_json || {}),
    data.segment_id || null,
    toJson(data.channel_strategy || data.channel_strategy_json || { channels: ['whatsapp'] }),
    data.template_id || null,
    data.schedule_type || 'immediate',
    data.scheduled_at || null,
    toJson(data.recurrence || data.recurrence_json || null),
    data.branch_id || null,
    actor?.id || null,
    actor?.username || null,
    nowIso()
  ];
  if (id) {
    dbRun(`UPDATE comm_campaigns SET name=?, description=?, status=?, audience_type=?, audience_json=?, segment_id=?,
      channel_strategy_json=?, template_id=?, schedule_type=?, scheduled_at=?, recurrence_json=?, branch_id=?, updated_at=? WHERE id=?`, [
      ...vals.slice(0, 12), vals[14], id
    ]);
    audit(actor, 'campaign_updated', 'comm_campaign', id, { name: data.name });
    return getCampaign(id, actor);
  }
  const r = dbRun(`INSERT INTO comm_campaigns
    (name, description, status, audience_type, audience_json, segment_id, channel_strategy_json, template_id,
     schedule_type, scheduled_at, recurrence_json, branch_id, created_by, created_by_name, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...vals, nowIso()]);
  audit(actor, 'campaign_created', 'comm_campaign', r.lastInsertRowid, { name: data.name });
  return getCampaign(r.lastInsertRowid, actor);
}

function getAutomations(actor) {
  requireCommView(actor);
  return dbAll('SELECT * FROM comm_automations ORDER BY name').map((a) => ({
    ...a,
    trigger_config: parseJson(a.trigger_config_json, {}),
    conditions: parseJson(a.conditions_json, {}),
    audience: parseJson(a.audience_json, {}),
    channel_strategy: parseJson(a.channel_strategy_json, {})
  }));
}

function saveAutomation(data, actor) {
  requireCommAdmin(actor);
  const id = data.id ? Number(data.id) : null;
  const nextRun = data.is_active ? computeNextRun(data.schedule_cron || 'daily_09:00') : null;
  const vals = [
    data.name,
    data.description || null,
    data.trigger_type,
    toJson(data.trigger_config || data.trigger_config_json || {}),
    toJson(data.conditions || data.conditions_json || {}),
    toJson(data.audience || data.audience_json || {}),
    toJson(data.channel_strategy || data.channel_strategy_json || { channels: ['push'] }),
    data.template_id || null,
    data.schedule_cron || null,
    data.is_active ? 1 : 0,
    data.is_transactional ? 1 : 0,
    nextRun,
    actor?.id || null,
    actor?.username || null,
    nowIso()
  ];
  if (id) {
    dbRun(`UPDATE comm_automations SET name=?, description=?, trigger_type=?, trigger_config_json=?, conditions_json=?,
      audience_json=?, channel_strategy_json=?, template_id=?, schedule_cron=?, is_active=?, is_transactional=?, next_run_at=?, updated_at=? WHERE id=?`, [
      ...vals.slice(0, 12), vals[14], id
    ]);
    audit(actor, data.is_active ? 'automation_enabled' : 'automation_disabled', 'comm_automation', id, { name: data.name });
    return dbGet('SELECT * FROM comm_automations WHERE id = ?', [id]);
  }
  const r = dbRun(`INSERT INTO comm_automations
    (name, description, trigger_type, trigger_config_json, conditions_json, audience_json, channel_strategy_json,
     template_id, schedule_cron, is_active, is_transactional, next_run_at, created_by, created_by_name, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...vals, nowIso()]);
  audit(actor, 'automation_created', 'comm_automation', r.lastInsertRowid, { name: data.name });
  return dbGet('SELECT * FROM comm_automations WHERE id = ?', [r.lastInsertRowid]);
}

function setAutomationActive(id, active, actor) {
  requireCommAdmin(actor);
  const nextRun = active ? computeNextRun(dbGet('SELECT schedule_cron FROM comm_automations WHERE id=?', [id])?.schedule_cron) : null;
  dbRun('UPDATE comm_automations SET is_active=?, next_run_at=?, updated_at=? WHERE id=?',
    [active ? 1 : 0, nextRun, nowIso(), Number(id)]);
  audit(actor, active ? 'automation_enabled' : 'automation_disabled', 'comm_automation', Number(id), {});
  return dbGet('SELECT * FROM comm_automations WHERE id = ?', [Number(id)]);
}

function chooseProvider(channel) {
  return dbGet('SELECT * FROM comm_providers WHERE channel = ? AND is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1', [channel]);
}

function canSendToCustomer(customer, channel, isMarketing) {
  const prefs = getPreferences(customer.id);
  if (isMarketing && !prefs.marketing_opt_in) return false;
  if (channel === 'sms' && !prefs.sms_enabled) return false;
  if (channel === 'whatsapp' && !prefs.whatsapp_enabled) return false;
  if (channel === 'email' && !prefs.email_enabled) return false;
  if (channel === 'push' && !prefs.push_enabled) return false;
  return true;
}

function recipientForChannel(customer, channel) {
  if (channel === 'email') return customer.email || '';
  if (channel === 'push') return String(customer.id);
  return customer.phone || '';
}

function queueMessage(payload) {
  const {
    customer, channel, body, subject, templateId, campaignId, automationId, automationRunId,
    isMarketing, idempotencyKey, metadata, providerKey
  } = payload;
  if (!customer || !channel || !body) throw new Error('Missing message fields');
  if (idempotencyKey) {
    const dup = dbGet('SELECT id FROM comm_messages WHERE idempotency_key = ?', [idempotencyKey]);
    if (dup) return dup.id;
    const sup = dbGet('SELECT id FROM comm_suppressions WHERE suppression_key = ?', [idempotencyKey]);
    if (sup) return null;
  }
  const address = recipientForChannel(customer, channel);
  if (!address) return null;
  if (!canSendToCustomer(customer, channel, isMarketing)) return null;
  const r = dbRun(`INSERT INTO comm_messages
    (message_uid, idempotency_key, customer_id, campaign_id, automation_id, automation_run_id, channel, provider_key,
     recipient_type, recipient_name, recipient_address, template_id, subject, body, status, is_marketing, metadata_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    uid('msg'),
    idempotencyKey || null,
    customer.id,
    campaignId || null,
    automationId || null,
    automationRunId || null,
    channel,
    providerKey || null,
    'customer',
    customer.name || null,
    address,
    templateId || null,
    subject || null,
    body,
    'pending',
    isMarketing ? 1 : 0,
    metadata ? toJson(metadata) : null,
    nowIso(),
    nowIso()
  ]);
  return r.lastInsertRowid;
}

function queueForCustomerStrategy(customer, template, strategy, ctx, refs) {
  const channels = strategy.channels || ['push'];
  const fallback = strategy.fallback || [];
  const order = [...channels, ...fallback.filter((c) => !channels.includes(c))];
  let queued = 0;
  for (const channel of order) {
    const address = recipientForChannel(customer, channel);
    if (!address) continue;
    if (!canSendToCustomer(customer, channel, refs.isMarketing)) continue;
    const vars = buildCustomerVars(customer, ctx);
    const body = renderTemplate(template.body, vars);
    const subject = template.subject ? renderTemplate(template.subject, vars) : null;
    const idempotencyKey = refs.idempotencyKey ? `${refs.idempotencyKey}_${channel}` : null;
    const id = queueMessage({
      customer,
      channel,
      body,
      subject,
      templateId: template.id,
      campaignId: refs.campaignId,
      automationId: refs.automationId,
      automationRunId: refs.automationRunId,
      isMarketing: refs.isMarketing,
      idempotencyKey
    });
    if (id) {
      queued += 1;
      if (!strategy.send_multiple) break;
    }
  }
  return queued;
}

async function processMessageRow(row) {
  dbRun(`UPDATE comm_messages SET status='processing', updated_at=? WHERE id=? AND status IN ('pending','failed')`, [nowIso(), row.id]);
  const providerRow = row.provider_key
    ? dbGet('SELECT * FROM comm_providers WHERE channel=? AND provider_key=? AND is_active=1', [row.channel, row.provider_key])
    : chooseProvider(row.channel);
  const config = parseJson(providerRow?.config_json, {});
  const payload = {
    to: row.recipient_address,
    subject: row.subject,
    body: row.body,
    html: row.body,
    customerId: row.customer_id
  };
  try {
    const result = await providers.sendMessage({
      channel: row.channel,
      providerKey: providerRow?.provider_key || 'console',
      config,
      payload,
      dbRun
    });
    dbRun(`UPDATE comm_messages SET status='sent', provider_key=?, provider_message_id=?, provider_response_json=?,
      sent_at=?, retry_count=?, failure_reason=NULL, updated_at=? WHERE id=?`, [
      providerRow?.provider_key || 'console',
      result.providerMessageId || null,
      toJson(result.response || {}),
      nowIso(),
      row.retry_count || 0,
      nowIso(),
      row.id
    ]);
    dbRun(`INSERT INTO comm_message_events (message_id, event_type, payload_json, created_at) VALUES (?,?,?,?)`,
      [row.id, 'sent', toJson(result.response || {}), nowIso()]);
    if (row.channel === 'push' || providerRow?.provider_key === 'console') {
      dbRun(`UPDATE comm_messages SET status='delivered', delivered_at=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), row.id]);
    }
    return { ok: true };
  } catch (err) {
    const retry = Number(row.retry_count || 0) + 1;
    const max = Number(row.max_retries ?? 4);
    const delay = RETRY_DELAYS_MS[Math.min(retry, RETRY_DELAYS_MS.length - 1)] || 900000;
    if (retry >= max) {
      dbRun(`UPDATE comm_messages SET status='failed', failed_at=?, failure_reason=?, retry_count=?, updated_at=? WHERE id=?`,
        [nowIso(), String(err.message || err).slice(0, 500), retry, nowIso(), row.id]);
    } else {
      const next = new Date(Date.now() + delay).toISOString().slice(0, 19).replace('T', ' ');
      dbRun(`UPDATE comm_messages SET status='pending', failure_reason=?, retry_count=?, next_retry_at=?, updated_at=? WHERE id=?`,
        [String(err.message || err).slice(0, 500), retry, next, nowIso(), row.id]);
    }
    return { ok: false, error: err.message };
  }
}

function processQueue(limit = 50) {
  const rows = dbAll(`
    SELECT * FROM comm_messages
    WHERE (status='pending' AND (next_retry_at IS NULL OR next_retry_at <= ?))
       OR (status='failed' AND retry_count < max_retries AND next_retry_at <= ?)
    ORDER BY priority DESC, id ASC LIMIT ?
  `, [nowIso(), nowIso(), limit]);
  let processed = 0;
  let sent = 0;
  for (const row of rows) {
    processed += 1;
    const r = processMessageRow(row);
    if (r?.ok) sent += 1;
  }
  return { processed, sent };
}

async function processQueueAsync(limit = 50) {
  const rows = dbAll(`
    SELECT * FROM comm_messages
    WHERE (status='pending' AND (next_retry_at IS NULL OR next_retry_at <= ?))
       OR (status='failed' AND retry_count < max_retries AND (next_retry_at IS NULL OR next_retry_at <= ?))
    ORDER BY priority DESC, id ASC LIMIT ?
  `, [nowIso(), nowIso(), limit]);
  let processed = 0;
  let sent = 0;
  for (const row of rows) {
    processed += 1;
    try {
      const r = await processMessageRow(row);
      if (r?.ok) sent += 1;
    } catch (_) { /* continue */ }
  }
  return { processed, sent };
}

function startCampaign(id, actor) {
  requireCommSend(actor);
  const campaign = getCampaign(id, actor);
  if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) throw new Error(`Cannot start campaign in status ${campaign.status}`);
  const template = dbGet('SELECT * FROM comm_templates WHERE id = ?', [campaign.template_id]);
  if (!template) throw new Error('Campaign template missing');
  const audience = resolveAudience(parseJson(campaign.audience_json, {}), campaign.segment_id);
  const strategy = parseJson(campaign.channel_strategy_json, { channels: ['whatsapp'] });
  let queued = 0;
  for (const customer of audience) {
    queued += queueForCustomerStrategy(customer, template, strategy, {}, {
      campaignId: campaign.id,
      automationRunId: null,
      isMarketing: true,
      idempotencyKey: `campaign_${campaign.id}_customer_${customer.id}`
    });
  }
  dbRun(`UPDATE comm_campaigns SET status='running', started_at=?, recipient_count=?, pending_count=?, updated_at=? WHERE id=?`,
    [nowIso(), audience.length, queued, nowIso(), campaign.id]);
  audit(actor, 'campaign_started', 'comm_campaign', campaign.id, { recipients: audience.length, queued });
  return { queued, recipients: audience.length };
}

function pauseCampaign(id, actor) {
  requireCommSend(actor);
  dbRun(`UPDATE comm_campaigns SET status='paused', updated_at=? WHERE id=?`, [nowIso(), Number(id)]);
  audit(actor, 'campaign_paused', 'comm_campaign', Number(id), {});
  return true;
}

function cancelCampaign(id, actor) {
  requireCommSend(actor);
  dbRun(`UPDATE comm_campaigns SET status='cancelled', updated_at=? WHERE id=?`, [nowIso(), Number(id)]);
  dbRun(`UPDATE comm_messages SET status='cancelled', updated_at=? WHERE campaign_id=? AND status='pending'`, [nowIso(), Number(id)]);
  audit(actor, 'campaign_cancelled', 'comm_campaign', Number(id), {});
  return true;
}

function runAutomation(automation, actor = null) {
  const template = dbGet('SELECT * FROM comm_templates WHERE id = ?', [automation.template_id]);
  if (!template) throw new Error(`Automation ${automation.id} missing template`);
  const trigger = parseJson(automation.trigger_config_json || automation.trigger_config, {});
  const audienceCfg = parseJson(automation.audience_json || automation.audience, { type: automation.trigger_type });
  if (automation.trigger_type === 'loyalty_expiring') {
    audienceCfg.type = 'loyalty_expiring';
    audienceCfg.days_before = trigger.days_before || 7;
  }
  const audience = resolveAudience(audienceCfg, null);
  const strategy = parseJson(automation.channel_strategy_json || automation.channel_strategy, { channels: ['push'] });
  const run = dbRun(`INSERT INTO comm_automation_runs (automation_id, status, started_at) VALUES (?, 'running', ?)`,
    [automation.id, nowIso()]);
  const runId = run.lastInsertRowid;
  let matched = 0;
  let queued = 0;
  for (const customer of audience) {
    matched += 1;
    const daysBefore = trigger.days_before || 7;
    const lotId = customer.lot_id || 'na';
    const expiry = customer.expiry_date || customer.expires_at || '';
    const idempotencyKey = `auto_${automation.id}_${customer.id}_${lotId}_${daysBefore}d_${expiry}`;
    const sup = dbGet('SELECT id FROM comm_suppressions WHERE suppression_key = ?', [idempotencyKey]);
    if (sup) continue;
    const ctx = {
      points_expiring: customer.points_expiring || customer.points_remaining || customer.loyalty_points || 0,
      expiry_date: expiry,
      points: customer.points_expiring || customer.loyalty_points || 0
    };
    const q = queueForCustomerStrategy(customer, template, strategy, ctx, {
      automationId: automation.id,
      automationRunId: runId,
      isMarketing: !automation.is_transactional,
      idempotencyKey
    });
    if (q > 0) {
      queued += q;
      try {
        dbRun(`INSERT INTO comm_suppressions (suppression_key, customer_id, automation_id, reason) VALUES (?,?,?,?)`,
          [idempotencyKey, customer.id, automation.id, 'automation_sent']);
      } catch (_) { /* duplicate suppression */ }
    }
  }
  dbRun(`UPDATE comm_automation_runs SET status=?, completed_at=?, matched_count=?, queued_count=? WHERE id=?`,
    [queued ? 'completed' : 'completed', nowIso(), matched, queued, runId]);
  dbRun(`UPDATE comm_automations SET last_run_at=?, next_run_at=?, success_count=success_count+1, updated_at=? WHERE id=?`,
    [nowIso(), computeNextRun(automation.schedule_cron), nowIso(), automation.id]);
  if (actor) audit(actor, 'automation_run', 'comm_automation', automation.id, { matched, queued });
  return { matched, queued, runId };
}

function processDueAutomations() {
  const rows = dbAll(`SELECT * FROM comm_automations WHERE is_active = 1 AND (next_run_at IS NULL OR next_run_at <= ?)`, [nowIso()]);
  const results = [];
  for (const row of rows) {
    try {
      results.push({ id: row.id, ...runAutomation(row) });
    } catch (err) {
      dbRun(`UPDATE comm_automations SET failure_count=failure_count+1, updated_at=? WHERE id=?`, [nowIso(), row.id]);
      results.push({ id: row.id, error: err.message });
    }
  }
  return results;
}

function processScheduledCampaigns() {
  const rows = dbAll(`SELECT id FROM comm_campaigns WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`, [nowIso()]);
  for (const row of rows) {
    try { startCampaign(row.id, { id: null, username: 'scheduler', role: 'owner' }); } catch (_) { /* log */ }
  }
  return rows.length;
}

function getMessages(filters = {}, actor) {
  requireCommView(actor);
  const where = [];
  const params = [];
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.channel) { where.push('channel = ?'); params.push(filters.channel); }
  if (filters.customer_id) { where.push('customer_id = ?'); params.push(Number(filters.customer_id)); }
  if (filters.campaign_id) { where.push('campaign_id = ?'); params.push(Number(filters.campaign_id)); }
  if (filters.from) { where.push('created_at >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('created_at <= ?'); params.push(`${filters.to} 23:59:59`); }
  if (filters.q) {
    where.push('(recipient_name LIKE ? OR recipient_address LIKE ? OR body LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  const limit = Math.min(Number(filters.limit) || 100, 500);
  const sql = `SELECT * FROM comm_messages ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${limit}`;
  return dbAll(sql, params);
}

function getDashboard(filters = {}, actor) {
  requireCommView(actor);
  const from = filters.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = filters.to || new Date().toISOString().slice(0, 10);
  const stats = dbGet(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='sent' OR status='delivered' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status='pending' OR status='processing' THEN 1 ELSE 0 END) as pending
    FROM comm_messages WHERE date(created_at) BETWEEN date(?) AND date(?)
  `, [from, to]) || {};
  const byChannel = dbAll(`
    SELECT channel, COUNT(*) as count,
      SUM(CASE WHEN status IN ('sent','delivered') THEN 1 ELSE 0 END) as sent
    FROM comm_messages WHERE date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY channel ORDER BY count DESC
  `, [from, to]);
  const campaigns = dbAll(`SELECT id, name, status, sent_count, delivered_count, failed_count, pending_count FROM comm_campaigns ORDER BY created_at DESC LIMIT 8`);
  const automations = dbAll(`SELECT id, name, is_active, last_run_at, next_run_at, success_count, failure_count FROM comm_automations ORDER BY name`);
  return {
    period: { from, to },
    stats,
    byChannel,
    campaigns,
    automations,
    settings: getSettings()
  };
}

function getAnalytics(filters = {}, actor) {
  return getDashboard(filters, actor);
}

function getUsage(filters = {}, actor) {
  requireCommView(actor);
  const from = filters.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = filters.to || new Date().toISOString().slice(0, 10);
  const rows = dbAll(`
    SELECT channel, COUNT(*) as total,
      SUM(CASE WHEN status IN ('sent','delivered') THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM comm_messages WHERE date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY channel ORDER BY total DESC
  `, [from, to]);
  const settings = getSettings();
  const limits = settings.usage_limits || {};
  return { period: { from, to }, channels: rows, limits };
}

function previewMessage(templateId, vars = {}, actor) {
  requireCommView(actor);
  const tpl = dbGet('SELECT * FROM comm_templates WHERE id = ?', [Number(templateId)]);
  if (!tpl) throw new Error('Template not found');
  return {
    subject: tpl.subject ? renderTemplate(tpl.subject, vars) : null,
    body: renderTemplate(tpl.body, vars)
  };
}

async function sendTest(data, actor) {
  requireCommSend(actor);
  const template = data.template_id
    ? dbGet('SELECT * FROM comm_templates WHERE id = ?', [Number(data.template_id)])
    : { body: data.body || 'Test message', subject: data.subject || 'Test', channel: data.channel || 'push' };
  const vars = data.vars || {};
  const body = renderTemplate(template.body, vars);
  const subject = template.subject ? renderTemplate(template.subject, vars) : (data.subject || 'Test');
  const channel = data.channel || template.channel || 'push';
  const fakeCustomer = {
    id: 0,
    name: vars.customer_name || 'Test Customer',
    phone: data.phone || data.to || '',
    email: data.email || '',
    loyalty_points: vars.loyalty_points || 0
  };
  const id = queueMessage({
    customer: fakeCustomer,
    channel,
    body,
    subject,
    templateId: template.id,
    isMarketing: false,
    idempotencyKey: `test_${Date.now()}`
  });
  if (id) await processQueueAsync(1);
  audit(actor, 'test_send', 'comm_message', id, { channel, to: data.phone || data.email });
  return { queued: !!id, message_id: id };
}

function handleWebhook(provider, payload = {}) {
  const providerMessageId = payload.message_id || payload.id || payload.MessageSid || payload.provider_message_id;
  const status = String(payload.status || payload.event || '').toLowerCase();
  if (!providerMessageId) return { ok: false, error: 'missing provider message id' };
  const msg = dbGet('SELECT * FROM comm_messages WHERE provider_message_id = ?', [providerMessageId]);
  if (!msg) return { ok: true, ignored: true };
  const eventId = payload.event_id || payload.id || status;
  const exists = dbGet('SELECT id FROM comm_message_events WHERE message_id=? AND event_type=? AND provider_event_id=?',
    [msg.id, status, eventId]);
  if (exists) return { ok: true, duplicate: true };
  dbRun('INSERT INTO comm_message_events (message_id, event_type, provider_event_id, payload_json, created_at) VALUES (?,?,?,?,?)',
    [msg.id, status, eventId, toJson(payload), nowIso()]);
  if (/delivered|read/.test(status)) {
    dbRun(`UPDATE comm_messages SET status='delivered', delivered_at=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), msg.id]);
  } else if (/failed|bounce|reject/.test(status)) {
    dbRun(`UPDATE comm_messages SET status='failed', failed_at=?, failure_reason=?, updated_at=? WHERE id=?`,
      [nowIso(), payload.reason || status, nowIso(), msg.id]);
  }
  return { ok: true };
}

function emitEvent(eventType, payload = {}) {
  const automations = dbAll(`SELECT * FROM comm_automations WHERE is_active=1 AND trigger_type=?`, [eventType]);
  const results = [];
  for (const auto of automations) {
    try { results.push({ id: auto.id, ...runAutomation(auto) }); } catch (err) {
      results.push({ id: auto.id, error: err.message });
    }
  }
  return results;
}

function runSchedulerTick() {
  expireDueLoyaltyLots();
  processDueAutomations();
  processScheduledCampaigns();
  return processQueueAsync(40);
}

module.exports = {
  ensureSchema,
  requireCommAdmin,
  requireCommView,
  requireCommSend,
  getSettings,
  saveSettings,
  getAdminLogs,
  audit,
  getProviders,
  saveProvider,
  testProviderConnection,
  getTemplates,
  saveTemplate,
  deleteTemplate,
  previewMessage,
  sendTest,
  getPreferences,
  savePreferences,
  getCustomerCommProfile,
  getSegments,
  saveSegment,
  evaluateSegment,
  getCampaigns,
  getCampaign,
  saveCampaign,
  startCampaign,
  pauseCampaign,
  cancelCampaign,
  getAutomations,
  saveAutomation,
  setAutomationActive,
  runAutomation,
  getMessages,
  getDashboard,
  getAnalytics,
  getUsage,
  queueMessage,
  processQueue,
  processQueueAsync,
  processDueAutomations,
  processScheduledCampaigns,
  expireDueLoyaltyLots,
  recordLoyaltyLot,
  handleWebhook,
  emitEvent,
  runSchedulerTick,
  renderTemplate,
  buildCustomerVars
};
