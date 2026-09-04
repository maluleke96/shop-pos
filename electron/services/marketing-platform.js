/**
 * Marketing Command Centre — multi-business marketing, promotions, campaigns,
 * loyalty, referral agents, commissions, payouts, contracts and analytics.
 *
 * Backed by the mkt_* tables created in migrations-v75.sql and integrated with
 * the existing POS tables (customers, sales, sale_items, products, branches,
 * shop_settings, users, promotion_flyers).
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const session = require('./session');
const { assertUserActor } = require('./authz');

const ADMIN_ROLES = ['owner', 'manager'];

const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled', 'archived'];
const PROMOTION_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'];
const SOCIAL_STATUSES = ['draft', 'scheduled', 'published', 'failed', 'archived'];
const BLAST_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'];
const AGENT_STATUSES = ['pending', 'active', 'rejected', 'suspended', 'terminated'];
const CONTRACT_STATUSES = ['draft', 'sent', 'accepted', 'active', 'declined', 'cancelled', 'terminated', 'expired'];
const PAYMENT_STATUSES = ['pending', 'processing', 'paid', 'failed', 'cancelled'];

const COMMISSION_FLOW = {
  pending: ['approved', 'cancelled', 'reversed'],
  approved: ['payable', 'pending', 'cancelled', 'reversed'],
  payable: ['paid', 'approved', 'cancelled', 'reversed'],
  paid: ['reversed'],
  reversed: [],
  cancelled: ['pending']
};

const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'x', 'twitter', 'linkedin', 'whatsapp_status', 'youtube'];
const DEFAULT_CAMPAIGN_CHANNELS = ['whatsapp', 'facebook', 'instagram', 'flyer', 'in_store'];

const ACTIVE_SALE_FILTER = `IFNULL(status, 'completed') NOT IN ('voided','void','returned')`;

/* ──────────────────────────────────────────────────────────────────────────
 * Low-level helpers
 * ────────────────────────────────────────────────────────────────────────── */

function bindValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function dbGet(sql, params = []) {
  return getDb().prepare(sql).get(...params.map(bindValue));
}

function dbAll(sql, params = []) {
  return getDb().prepare(sql).all(...params.map(bindValue));
}

function dbRun(sql, params = []) {
  return getDb().prepare(sql).run(...params.map(bindValue));
}

/**
 * Returns the row created by the preceding INSERT.
 * The sql.js wrapper persists by closing and reopening the database, which
 * resets last_insert_rowid() to 0, so fall back to the newest row.
 */
function fetchInserted(table, result) {
  const id = Number(result && result.lastInsertRowid) || 0;
  if (id) {
    const row = dbGet(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (row) return row;
  }
  return dbGet(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 1`) || null;
}

function scalar(sql, params = [], key = 'v', fallback = 0) {
  try {
    const row = dbGet(sql, params);
    if (!row) return fallback;
    const value = row[key];
    return value == null ? fallback : Number(value) || 0;
  } catch (_) {
    return fallback;
  }
}

function uid(prefix = 'mkt') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function toJsonText(value, fallback = '{}') {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch (_) {
      return JSON.stringify(trimmed);
    }
  }
  try {
    return JSON.stringify(value);
  } catch (_) {
    return fallback;
  }
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bool01(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  if (value === 0 || value === '0' || value === false || value === 'false') return 0;
  return 1;
}

function coalesce(next, current) {
  return next === undefined || next === null ? current : next;
}

function textOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(dateStr, days) {
  const d = dateStr ? new Date(`${String(dateStr).slice(0, 10)}T00:00:00`) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('en-CA');
}

function monthStart() {
  const d = new Date();
  d.setDate(1);
  return d.toLocaleDateString('en-CA');
}

function dateRange(filters = {}) {
  const to = String(filters.to || filters.date_to || today()).slice(0, 10);
  const from = String(filters.from || filters.date_from || monthStart()).slice(0, 10);
  return { from, to };
}

function pct(part, whole) {
  const w = Number(whole) || 0;
  if (!w) return 0;
  return Math.round((Number(part) / w) * 1000) / 10;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hashText(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

function limitOf(filters, fallback = 200, max = 1000) {
  const n = Number(filters?.limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), max);
}

/** Safe IN (...) fragment built only from numbers. */
function inFragment(column, ids) {
  const list = (ids || []).map(Number).filter(Number.isFinite);
  const safe = list.length ? list : [-1];
  return { sql: ` AND ${column} IN (${safe.map(() => '?').join(',')})`, params: safe };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Soft schema handling
 * ────────────────────────────────────────────────────────────────────────── */

const columnCache = new Map();

function hasColumn(table, column) {
  const key = `${table}.${column}`.toLowerCase();
  if (columnCache.has(key)) return columnCache.get(key);
  let exists = false;
  try {
    const rows = dbAll(`PRAGMA table_info(${table})`);
    exists = rows.some(r => String(r.name || '').toLowerCase() === String(column).toLowerCase());
  } catch (_) {
    exists = false;
  }
  if (!exists) {
    try {
      const row = dbGet(
        'SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?',
        [String(table).toLowerCase(), String(column).toLowerCase()]
      );
      exists = !!row;
    } catch (_) { /* not Postgres */ }
  }
  columnCache.set(key, exists);
  return exists;
}

function hasTable(table) {
  try {
    dbGet(`SELECT 1 AS v FROM ${table} LIMIT 1`);
    return true;
  } catch (_) {
    return false;
  }
}

function softAlter(sql) {
  const db = getDb();
  const withIfNotExists = sql.replace(/ADD COLUMN /i, 'ADD COLUMN IF NOT EXISTS ');
  try {
    db.exec(withIfNotExists);
    return true;
  } catch (_) { /* SQLite has no ADD COLUMN IF NOT EXISTS */ }
  try {
    db.exec(sql);
    return true;
  } catch (_) {
    return false;
  }
}

/** Adds the marketing attribution columns the platform relies on. */
function ensureMarketingColumns() {
  const alters = [
    'ALTER TABLE sales ADD COLUMN referral_code TEXT',
    'ALTER TABLE sales ADD COLUMN marketing_agent_id INTEGER',
    'ALTER TABLE sales ADD COLUMN mkt_campaign_id INTEGER',
    'ALTER TABLE branches ADD COLUMN business_id INTEGER',
    'ALTER TABLE customers ADD COLUMN referral_code TEXT',
    'ALTER TABLE customers ADD COLUMN referral_agent_id INTEGER',
    'ALTER TABLE customers ADD COLUMN marketing_opt_out INTEGER DEFAULT 0'
  ];
  for (const sql of alters) softAlter(sql);
  columnCache.clear();
}

/* ──────────────────────────────────────────────────────────────────────────
 * Bootstrapping / seed
 * ────────────────────────────────────────────────────────────────────────── */

let platformReady = false;

function ensureSettingsRow() {
  try {
    dbRun(
      `INSERT OR IGNORE INTO mkt_settings (id, default_commission_percent, auto_approve_commissions, public_apply_enabled, referral_base_url)
       VALUES (1, 5, 0, 1, '/r/')`
    );
  } catch (_) {
    try {
      const row = dbGet('SELECT id FROM mkt_settings WHERE id = 1');
      if (!row) {
        dbRun(
          `INSERT INTO mkt_settings (id, default_commission_percent, auto_approve_commissions, public_apply_enabled, referral_base_url)
           VALUES (1, 5, 0, 1, '/r/')`
        );
      }
    } catch (__) { /* table missing */ }
  }
}

/** Idempotent platform bootstrap. Safe to call before the DB is initialised. */
function ensureMarketingSchema() {
  try {
    dbGet('SELECT 1 FROM mkt_referral_agents LIMIT 1');
    return true;
  } catch (_) {
    try {
      const fs = require('fs');
      const path = require('path');
      const mig = path.join(__dirname, '../database/migrations-v75.sql');
      if (fs.existsSync(mig)) getDb().exec(fs.readFileSync(mig, 'utf8'));
      return true;
    } catch (err) {
      console.warn('[marketing] schema ensure failed:', err.message || err);
      return false;
    }
  }
}

function ensurePlatformReady() {
  if (platformReady) return true;
  try {
    getDb();
  } catch (_) {
    return false;
  }
  try {
    ensureMarketingSchema();
    ensureMarketingColumns();
    ensureSettingsRow();
    const business = ensureDefaultBusiness();
    ensureDefaultCommissionRule(business ? business.id : null);
    platformReady = true;
  } catch (err) {
    // Schema may not be migrated yet — retry on the next call.
    return false;
  }
  return platformReady;
}

/**
 * Seeds a business from shop_settings when none exist and links orphan branches.
 */
function ensureDefaultBusiness() {
  let business = null;
  try {
    business = dbGet('SELECT * FROM mkt_businesses ORDER BY id LIMIT 1');
  } catch (_) {
    return null;
  }

  if (!business) {
    let settings = null;
    try {
      settings = dbGet('SELECT shop_name, logo_path, address, phone FROM shop_settings WHERE id = 1');
    } catch (_) { /* optional */ }
    const name = textOrNull(settings && settings.shop_name) || 'My Business';
    const result = dbRun(
      `INSERT INTO mkt_businesses (name, code, description, logo_path, contact_phone, address, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,1, datetime('now'), datetime('now'))`,
      [
        name,
        generateBusinessCode(name),
        'Primary business (created automatically from shop settings)',
        settings ? settings.logo_path || null : null,
        settings ? settings.phone || null : null,
        settings ? settings.address || null : null
      ]
    );
    business = fetchInserted('mkt_businesses', result);
  }

  if (business) {
    try {
      dbRun('UPDATE branches SET business_id = ? WHERE business_id IS NULL', [business.id]);
    } catch (_) { /* branches.business_id may be missing */ }
  }
  return business ? hydrateBusiness(business) : null;
}

function ensureDefaultCommissionRule(businessId) {
  let rule = null;
  try {
    rule = dbGet(
      `SELECT * FROM mkt_commission_rules WHERE is_default = 1 AND IFNULL(is_active,1) = 1 ORDER BY id LIMIT 1`
    );
  } catch (_) {
    return null;
  }
  if (rule) return rule;

  let percent = 5;
  try {
    const settings = dbGet('SELECT default_commission_percent FROM mkt_settings WHERE id = 1');
    percent = num(settings && settings.default_commission_percent, 5);
  } catch (_) { /* defaults */ }

  const result = dbRun(
    `INSERT INTO mkt_commission_rules (business_id, name, rule_type, percent_rate, fixed_amount, product_rates_json, is_default, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,1,1, datetime('now'), datetime('now'))`,
    [intOrNull(businessId), 'Default Referral Commission', 'percent', percent, 0, '{}']
  );
  return fetchInserted('mkt_commission_rules', result);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Auth helpers
 * ────────────────────────────────────────────────────────────────────────── */

function isAdminUser(user) {
  return !!user && ADMIN_ROLES.includes(String(user.role || ''));
}

/** Owner / manager only. */
function requireMktAdmin(actor) {
  const user = assertUserActor(actor || session.getUserSession(), ADMIN_ROLES);
  ensurePlatformReady();
  return user;
}

/** Finance approvals & payouts — owner / manager. */
function requireFinanceOrAdmin(actor) {
  const user = assertUserActor(actor || session.getUserSession(), ADMIN_ROLES);
  ensurePlatformReady();
  return user;
}

/** Any authenticated POS user (used for shared read-only surfaces). */
function requirePlatformUser(actor) {
  const user = assertUserActor(actor || session.getUserSession(), []);
  ensurePlatformReady();
  return user;
}

/** Returns the referral agent row linked to the signed-in user. */
function requireReferralAgent(actor) {
  const user = assertUserActor(actor || session.getUserSession(), []);
  ensurePlatformReady();
  const agent = dbGet('SELECT * FROM mkt_referral_agents WHERE user_id = ? ORDER BY id LIMIT 1', [user.id]);
  if (!agent) throw new Error('No referral agent profile is linked to this account');
  if (String(agent.status) !== 'active') {
    throw new Error(`Referral agent access is ${agent.status || 'unavailable'}`);
  }
  return { ...agent, user, isAdmin: isAdminUser(user) };
}

/** Referral agent when linked, otherwise an admin acting on their behalf. */
function resolveAgentContext(actor, agentIdHint) {
  const user = requirePlatformUser(actor);
  const linked = dbGet('SELECT * FROM mkt_referral_agents WHERE user_id = ? ORDER BY id LIMIT 1', [user.id]);
  if (linked && String(linked.status) === 'active') {
    return { user, agent: linked, isAdmin: isAdminUser(user) };
  }
  if (isAdminUser(user)) {
    const agent = agentIdHint != null
      ? dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [agentIdHint])
      : null;
    return { user, agent: agent || linked || null, isAdmin: true };
  }
  if (linked) throw new Error(`Referral agent access is ${linked.status || 'unavailable'}`);
  throw new Error('No referral agent profile is linked to this account');
}

/* ──────────────────────────────────────────────────────────────────────────
 * Audit & notifications
 * ────────────────────────────────────────────────────────────────────────── */

function platformAudit(actor, action, entityType, entityId, prev, next) {
  try {
    dbRun(
      `INSERT INTO mkt_platform_audit (user_id, user_name, action, entity_type, entity_id, previous_value, new_value, created_at)
       VALUES (?,?,?,?,?,?,?, datetime('now'))`,
      [
        actor && actor.id != null ? Number(actor.id) : null,
        (actor && (actor.full_name || actor.username)) || null,
        String(action || 'unknown'),
        textOrNull(entityType),
        intOrNull(entityId),
        prev == null ? null : (typeof prev === 'string' ? prev : JSON.stringify(prev)),
        next == null ? null : (typeof next === 'string' ? next : JSON.stringify(next))
      ]
    );
  } catch (_) { /* auditing must never break a write */ }
  return true;
}

function notify(audience, payload = {}) {
  try {
    dbRun(
      `INSERT INTO mkt_notifications (audience, agent_id, user_id, title, body, category, related_type, related_id, is_read, created_at)
       VALUES (?,?,?,?,?,?,?,?,0, datetime('now'))`,
      [
        textOrNull(audience) || 'admin',
        intOrNull(payload.agent_id),
        intOrNull(payload.user_id),
        textOrNull(payload.title) || 'Marketing update',
        textOrNull(payload.body),
        textOrNull(payload.category),
        textOrNull(payload.related_type),
        intOrNull(payload.related_id)
      ]
    );
  } catch (_) { /* notifications are best-effort */ }
  return true;
}

function notifyAdmins(title, body, category, relatedType, relatedId) {
  return notify('admin', {
    title,
    body,
    category: category || 'admin',
    related_type: relatedType || null,
    related_id: relatedId || null
  });
}

function notifyAgent(agent, title, body, category, relatedType, relatedId) {
  if (!agent) return false;
  return notify('agent', {
    agent_id: agent.id,
    user_id: agent.user_id || null,
    title,
    body,
    category: category || 'agent',
    related_type: relatedType || null,
    related_id: relatedId || null
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Code generators
 * ────────────────────────────────────────────────────────────────────────── */

function slugBase(value, fallback, length = 6) {
  const base = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, length);
  return base || fallback;
}

function generateBusinessCode(name) {
  const base = slugBase(name, 'BIZ');
  let code = base;
  let suffix = 1;
  while (dbGet('SELECT id FROM mkt_businesses WHERE code = ?', [code])) {
    suffix += 1;
    code = `${base}${suffix}`;
    if (suffix > 500) return `${base}${Date.now().toString(36).toUpperCase()}`;
  }
  return code;
}

function generateUniqueReferralCode(baseName) {
  ensurePlatformReady();
  const base = slugBase(baseName, 'AGENT');
  for (let i = 0; i < 50; i += 1) {
    const code = `${base}${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}`;
    if (!dbGet('SELECT id FROM mkt_referral_agents WHERE referral_code = ?', [code])) return code;
  }
  return `${base}${Date.now().toString(36).toUpperCase()}`;
}

function generateAgentCode() {
  let max = 0;
  try {
    const rows = dbAll(`SELECT agent_code FROM mkt_referral_agents WHERE agent_code IS NOT NULL`);
    for (const row of rows) {
      const match = String(row.agent_code || '').match(/^RA-(\d+)$/);
      if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
    }
  } catch (_) { /* fall back to 1 */ }
  let next = max + 1;
  let code = `RA-${String(next).padStart(6, '0')}`;
  while (dbGet('SELECT id FROM mkt_referral_agents WHERE agent_code = ?', [code])) {
    next += 1;
    code = `RA-${String(next).padStart(6, '0')}`;
    if (next > max + 10000) return `RA-${Date.now().toString().slice(-6)}`;
  }
  return code;
}

function generateCouponCode(prefix) {
  const base = slugBase(prefix, 'PROMO');
  for (let i = 0; i < 50; i += 1) {
    const code = `${base}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    if (!dbGet('SELECT id FROM mkt_coupons WHERE code = ?', [code])) return code;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

function referralBaseUrl() {
  try {
    const settings = dbGet('SELECT referral_base_url FROM mkt_settings WHERE id = 1');
    const custom = textOrNull(settings && settings.referral_base_url);
    if (custom && /^https?:\/\//i.test(custom)) {
      return custom.endsWith('/') ? custom : `${custom}/`;
    }
    const pub = process.env.SHOP_POS_PUBLIC_URL || process.env.SHOP_POS_SYNC_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
      'https://chisafood.up.railway.app';
    if (pub) return `${String(pub).replace(/\/$/, '')}/r/`;
    return custom || '/r/';
  } catch (_) {
    return '/r/';
  }
}

function buildReferralLink(code) {
  const base = referralBaseUrl();
  if (!code) return null;
  return `${base}${base.endsWith('/') ? '' : '/'}${code}`.replace(/([^:])\/\//g, '$1/');
}

/* ──────────────────────────────────────────────────────────────────────────
 * Businesses
 * ────────────────────────────────────────────────────────────────────────── */

function hydrateBusiness(row) {
  if (!row) return null;
  return {
    ...row,
    images: parseJson(row.images_json, []),
    social: parseJson(row.social_json, {}),
    operating_hours: parseJson(row.operating_hours_json, {}),
    branding: parseJson(row.branding_json, {})
  };
}

function listBusinesses(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT b.*,
      (SELECT COUNT(*) FROM branches br WHERE br.business_id = b.id) AS branch_count,
      (SELECT COUNT(*) FROM mkt_campaigns_v2 c WHERE c.business_id = b.id) AS campaign_count,
      (SELECT COUNT(*) FROM mkt_referral_agents a WHERE a.business_id = b.id) AS agent_count
    FROM mkt_businesses b WHERE 1=1`;
  const params = [];
  if (filters.is_active != null && filters.is_active !== '') {
    sql += ' AND IFNULL(b.is_active,1) = ?';
    params.push(bool01(filters.is_active, 1));
  } else if (!filters.include_inactive) {
    sql += ' AND IFNULL(b.is_active,1) = 1';
  }
  if (textOrNull(filters.search)) {
    sql += ` AND (b.name LIKE ? OR IFNULL(b.code,'') LIKE ?)`;
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  sql += ' ORDER BY b.name';
  try {
    return dbAll(sql, params).map(hydrateBusiness);
  } catch (_) {
    return [];
  }
}

function getBusiness(id, actor) {
  requirePlatformUser(actor);
  const row = dbGet('SELECT * FROM mkt_businesses WHERE id = ?', [id]);
  if (!row) return null;
  const business = hydrateBusiness(row);
  business.branches = listBranchesForBusiness(row.id);
  business.stats = {
    campaigns: scalar('SELECT COUNT(*) AS v FROM mkt_campaigns_v2 WHERE business_id = ?', [row.id]),
    active_campaigns: scalar(`SELECT COUNT(*) AS v FROM mkt_campaigns_v2 WHERE business_id = ? AND status = 'active'`, [row.id]),
    promotions: scalar('SELECT COUNT(*) AS v FROM mkt_promotions WHERE business_id = ?', [row.id]),
    agents: scalar('SELECT COUNT(*) AS v FROM mkt_referral_agents WHERE business_id = ?', [row.id]),
    loyalty_members: scalar('SELECT COUNT(*) AS v FROM mkt_loyalty_accounts WHERE business_id = ?', [row.id])
  };
  return business;
}

function listBranchesForBusiness(businessId) {
  try {
    return dbAll('SELECT * FROM branches WHERE business_id = ? ORDER BY name', [businessId]);
  } catch (_) {
    return [];
  }
}

function saveBusiness(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Business name is required');

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_businesses WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Business not found');
    let code = textOrNull(data.code) || existing.code;
    if (code && code !== existing.code && dbGet('SELECT id FROM mkt_businesses WHERE code = ? AND id != ?', [code, existing.id])) {
      throw new Error('Another business already uses that code');
    }
    if (!code) code = generateBusinessCode(name);
    dbRun(
      `UPDATE mkt_businesses SET name=?, code=?, description=?, logo_path=?, images_json=?, contact_phone=?, contact_email=?,
         whatsapp_number=?, address=?, social_json=?, operating_hours_json=?, branding_json=?, is_active=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        name,
        code,
        coalesce(textOrNull(data.description), existing.description),
        coalesce(textOrNull(data.logo_path), existing.logo_path),
        data.images !== undefined || data.images_json !== undefined
          ? toJsonText(data.images !== undefined ? data.images : data.images_json, '[]')
          : (existing.images_json || '[]'),
        coalesce(textOrNull(data.contact_phone), existing.contact_phone),
        coalesce(textOrNull(data.contact_email), existing.contact_email),
        coalesce(textOrNull(data.whatsapp_number), existing.whatsapp_number),
        coalesce(textOrNull(data.address), existing.address),
        data.social !== undefined || data.social_json !== undefined
          ? toJsonText(data.social !== undefined ? data.social : data.social_json, '{}')
          : (existing.social_json || '{}'),
        data.operating_hours !== undefined || data.operating_hours_json !== undefined
          ? toJsonText(data.operating_hours !== undefined ? data.operating_hours : data.operating_hours_json, '{}')
          : (existing.operating_hours_json || '{}'),
        data.branding !== undefined || data.branding_json !== undefined
          ? toJsonText(data.branding !== undefined ? data.branding : data.branding_json, '{}')
          : (existing.branding_json || '{}'),
        data.is_active === undefined ? bool01(existing.is_active, 1) : bool01(data.is_active, 1),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_businesses WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_business', 'mkt_business', existing.id, existing, updated);
    return hydrateBusiness(updated);
  }

  const code = textOrNull(data.code) || generateBusinessCode(name);
  if (dbGet('SELECT id FROM mkt_businesses WHERE code = ?', [code])) {
    throw new Error('Another business already uses that code');
  }
  const result = dbRun(
    `INSERT INTO mkt_businesses (name, code, description, logo_path, images_json, contact_phone, contact_email, whatsapp_number,
       address, social_json, operating_hours_json, branding_json, is_active, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      name,
      code,
      textOrNull(data.description),
      textOrNull(data.logo_path),
      toJsonText(data.images !== undefined ? data.images : data.images_json, '[]'),
      textOrNull(data.contact_phone),
      textOrNull(data.contact_email),
      textOrNull(data.whatsapp_number),
      textOrNull(data.address),
      toJsonText(data.social !== undefined ? data.social : data.social_json, '{}'),
      toJsonText(data.operating_hours !== undefined ? data.operating_hours : data.operating_hours_json, '{}'),
      toJsonText(data.branding !== undefined ? data.branding : data.branding_json, '{}'),
      bool01(data.is_active, 1),
      admin.id
    ]
  );
  const created = fetchInserted('mkt_businesses', result);
  platformAudit(admin, 'create_business', 'mkt_business', created.id, null, created);
  return hydrateBusiness(created);
}

function setBusinessActive(id, isActive, actor) {
  const admin = requireMktAdmin(actor);
  const existing = dbGet('SELECT * FROM mkt_businesses WHERE id = ?', [id]);
  if (!existing) throw new Error('Business not found');
  dbRun(`UPDATE mkt_businesses SET is_active = ?, updated_at = datetime('now') WHERE id = ?`, [bool01(isActive, 1), id]);
  const updated = dbGet('SELECT * FROM mkt_businesses WHERE id = ?', [id]);
  platformAudit(admin, 'set_business_active', 'mkt_business', id, { is_active: existing.is_active }, { is_active: updated.is_active });
  return hydrateBusiness(updated);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Branches
 * ────────────────────────────────────────────────────────────────────────── */

function listMktBranches(filters = {}, actor) {
  requirePlatformUser(actor);
  const linked = hasColumn('branches', 'business_id');
  let sql = linked
    ? `SELECT b.*, biz.name AS business_name FROM branches b
       LEFT JOIN mkt_businesses biz ON biz.id = b.business_id WHERE 1=1`
    : 'SELECT b.*, NULL AS business_name FROM branches b WHERE 1=1';
  const params = [];
  if (linked && filters.business_id != null && filters.business_id !== '') {
    sql += ' AND b.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (linked && filters.unlinked_only) sql += ' AND b.business_id IS NULL';
  if (!filters.include_inactive) sql += ' AND IFNULL(b.is_active,1) = 1';
  if (textOrNull(filters.search)) {
    sql += ` AND (b.name LIKE ? OR IFNULL(b.code,'') LIKE ?)`;
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  sql += ' ORDER BY b.name';
  let rows = [];
  try {
    rows = dbAll(sql, params);
  } catch (_) {
    return [];
  }
  return rows.map(row => ({
    ...row,
    campaign_count: scalar('SELECT COUNT(*) AS v FROM mkt_campaigns_v2 WHERE branch_id = ?', [row.id]),
    promotion_count: scalar('SELECT COUNT(*) AS v FROM mkt_promotions WHERE branch_id = ?', [row.id]),
    agent_count: scalar('SELECT COUNT(*) AS v FROM mkt_referral_agents WHERE branch_id = ?', [row.id])
  }));
}

function saveBranchBusinessLink(branchId, businessId, actor) {
  const admin = requireMktAdmin(actor);
  const branch = dbGet('SELECT * FROM branches WHERE id = ?', [branchId]);
  if (!branch) throw new Error('Branch not found');
  const bizId = intOrNull(businessId);
  if (bizId != null && !dbGet('SELECT id FROM mkt_businesses WHERE id = ?', [bizId])) {
    throw new Error('Business not found');
  }
  softAlter('ALTER TABLE branches ADD COLUMN business_id INTEGER');
  dbRun('UPDATE branches SET business_id = ? WHERE id = ?', [bizId, branchId]);
  const updated = dbGet('SELECT * FROM branches WHERE id = ?', [branchId]);
  platformAudit(admin, 'link_branch_business', 'branch', branchId, { business_id: branch.business_id ?? null }, { business_id: bizId });
  return updated;
}

/** Branch ids in scope for the supplied filters (null = every branch). */
function resolveBranchIds(filters = {}) {
  if (filters.branch_id != null && filters.branch_id !== '') {
    const id = intOrNull(filters.branch_id);
    return id == null ? null : [id];
  }
  if (filters.business_id != null && filters.business_id !== '') {
    try {
      const ids = dbAll('SELECT id FROM branches WHERE business_id = ?', [intOrNull(filters.business_id)])
        .map(r => Number(r.id))
        .filter(Number.isFinite);
      // Empty list must NOT become IN (-1) — that blanks dashboards. Business filter
      // still applies via business_id columns on marketing tables.
      return ids.length ? ids : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function scopeClause(column, filters, branchIdsOverride) {
  const branchIds = branchIdsOverride !== undefined ? branchIdsOverride : resolveBranchIds(filters);
  if (!branchIds || !branchIds.length) return { sql: '', params: [] };
  return inFragment(column, branchIds);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Command Centre dashboard
 * ────────────────────────────────────────────────────────────────────────── */

function getCommandCentreDashboard(filters = {}, actor) {
  requireMktAdmin(actor);
  ensurePlatformReady();
  try { require('./branches').ensureBranchSchema?.(); } catch (_) { /* optional */ }
  const { from, to } = dateRange(filters);
  const businessId = intOrNull(filters.business_id);
  const branchIds = resolveBranchIds(filters);

  const bizClause = businessId != null ? ' AND business_id = ?' : '';
  const bizParams = businessId != null ? [businessId] : [];
  const branchScope = scopeClause('branch_id', filters, branchIds);

  const campaignWhere = `WHERE 1=1${bizClause}${branchScope.sql}`;
  const campaignParams = [...bizParams, ...branchScope.params];

  const campaigns = {
    total: scalar(`SELECT COUNT(*) AS v FROM mkt_campaigns_v2 ${campaignWhere}`, campaignParams),
    draft: scalar(`SELECT COUNT(*) AS v FROM mkt_campaigns_v2 ${campaignWhere} AND status = 'draft'`, campaignParams),
    scheduled: scalar(`SELECT COUNT(*) AS v FROM mkt_campaigns_v2 ${campaignWhere} AND status = 'scheduled'`, campaignParams),
    active: scalar(`SELECT COUNT(*) AS v FROM mkt_campaigns_v2 ${campaignWhere} AND status = 'active'`, campaignParams),
    paused: scalar(`SELECT COUNT(*) AS v FROM mkt_campaigns_v2 ${campaignWhere} AND status = 'paused'`, campaignParams),
    completed: scalar(`SELECT COUNT(*) AS v FROM mkt_campaigns_v2 ${campaignWhere} AND status = 'completed'`, campaignParams),
    budget: money(scalar(`SELECT COALESCE(SUM(budget),0) AS v FROM mkt_campaigns_v2 ${campaignWhere}`, campaignParams)),
    spend: money(scalar(`SELECT COALESCE(SUM(marketing_cost),0) AS v FROM mkt_campaigns_v2 ${campaignWhere}`, campaignParams)),
    launched_in_range: scalar(
      `SELECT COUNT(*) AS v FROM mkt_campaigns_v2 ${campaignWhere} AND date(created_at) BETWEEN date(?) AND date(?)`,
      [...campaignParams, from, to]
    )
  };

  const promotions = {
    total: scalar(`SELECT COUNT(*) AS v FROM mkt_promotions ${campaignWhere}`, campaignParams),
    active: scalar(`SELECT COUNT(*) AS v FROM mkt_promotions ${campaignWhere} AND status = 'active'`, campaignParams),
    scheduled: scalar(`SELECT COUNT(*) AS v FROM mkt_promotions ${campaignWhere} AND status = 'scheduled'`, campaignParams),
    expiring_soon: scalar(
      `SELECT COUNT(*) AS v FROM mkt_promotions ${campaignWhere} AND status = 'active'
         AND end_date IS NOT NULL AND date(end_date) BETWEEN date('now') AND date('now','+7 day')`,
      campaignParams
    )
  };

  const agentWhere = `WHERE 1=1${bizClause}`;
  const agents = {
    total: scalar(`SELECT COUNT(*) AS v FROM mkt_referral_agents ${agentWhere}`, bizParams),
    active: scalar(`SELECT COUNT(*) AS v FROM mkt_referral_agents ${agentWhere} AND status = 'active'`, bizParams),
    pending: scalar(`SELECT COUNT(*) AS v FROM mkt_referral_agents ${agentWhere} AND status = 'pending'`, bizParams),
    suspended: scalar(`SELECT COUNT(*) AS v FROM mkt_referral_agents ${agentWhere} AND status = 'suspended'`, bizParams),
    terminated: scalar(`SELECT COUNT(*) AS v FROM mkt_referral_agents ${agentWhere} AND status = 'terminated'`, bizParams),
    rejected: scalar(`SELECT COUNT(*) AS v FROM mkt_referral_agents ${agentWhere} AND status = 'rejected'`, bizParams),
    new_in_range: scalar(
      `SELECT COUNT(*) AS v FROM mkt_referral_agents ${agentWhere} AND date(created_at) BETWEEN date(?) AND date(?)`,
      [...bizParams, from, to]
    )
  };

  const commissionWhere = `WHERE 1=1${bizClause}${branchScope.sql}`;
  const commissionParams = [...bizParams, ...branchScope.params];
  const rangeParams = [...commissionParams, from, to];
  const rangeClause = ' AND date(created_at) BETWEEN date(?) AND date(?)';

  const commissions = {
    count: scalar(`SELECT COUNT(*) AS v FROM mkt_commissions ${commissionWhere}${rangeClause}`, rangeParams),
    pending: money(scalar(`SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions ${commissionWhere} AND status = 'pending'`, commissionParams)),
    approved: money(scalar(`SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions ${commissionWhere} AND status = 'approved'`, commissionParams)),
    payable: money(scalar(`SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions ${commissionWhere} AND status = 'payable'`, commissionParams)),
    paid: money(scalar(`SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions ${commissionWhere} AND status = 'paid'`, commissionParams)),
    reversed: money(scalar(`SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions ${commissionWhere} AND status = 'reversed'`, commissionParams)),
    pending_count: scalar(`SELECT COUNT(*) AS v FROM mkt_commissions ${commissionWhere} AND status = 'pending'`, commissionParams),
    payable_count: scalar(`SELECT COUNT(*) AS v FROM mkt_commissions ${commissionWhere} AND status = 'payable'`, commissionParams),
    earned_in_range: money(scalar(
      `SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions ${commissionWhere}
         AND status NOT IN ('reversed','cancelled')${rangeClause}`,
      rangeParams
    ))
  };

  const attributedRevenue = money(scalar(
    `SELECT COALESCE(SUM(sale_amount),0) AS v FROM mkt_commissions ${commissionWhere}
       AND status NOT IN ('reversed','cancelled')${rangeClause}`,
    rangeParams
  ));
  const attributedOrders = scalar(
    `SELECT COUNT(DISTINCT IFNULL(sale_id, id)) AS v FROM mkt_commissions ${commissionWhere}
       AND status NOT IN ('reversed','cancelled')${rangeClause}`,
    rangeParams
  );

  const referrals = {
    total: scalar(`SELECT COUNT(*) AS v FROM mkt_referrals_v2 ${commissionWhere}`, commissionParams),
    in_range: scalar(`SELECT COUNT(*) AS v FROM mkt_referrals_v2 ${commissionWhere}${rangeClause}`, rangeParams),
    converted: scalar(`SELECT COUNT(*) AS v FROM mkt_referrals_v2 ${commissionWhere} AND status = 'converted'`, commissionParams),
    clicks: scalar(`SELECT COUNT(*) AS v FROM mkt_referral_clicks WHERE date(created_at) BETWEEN date(?) AND date(?)`, [from, to])
  };
  referrals.conversion_rate = pct(referrals.converted, referrals.total);
  referrals.click_to_referral_rate = pct(referrals.in_range, referrals.clicks);

  const salesScope = hasColumn('sales', 'branch_id')
    ? scopeClause('branch_id', filters, branchIds)
    : { sql: '', params: [] };
  const sales = {
    orders: scalar(
      `SELECT COUNT(*) AS v FROM sales WHERE ${ACTIVE_SALE_FILTER} AND date(created_at) BETWEEN date(?) AND date(?)${salesScope.sql}`,
      [from, to, ...salesScope.params]
    ),
    revenue: money(scalar(
      `SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE ${ACTIVE_SALE_FILTER} AND date(created_at) BETWEEN date(?) AND date(?)${salesScope.sql}`,
      [from, to, ...salesScope.params]
    ))
  };
  sales.average_order_value = sales.orders ? money(sales.revenue / sales.orders) : 0;
  sales.attributed_share = pct(attributedRevenue, sales.revenue);

  const customers = {
    total: scalar('SELECT COUNT(*) AS v FROM customers'),
    new_in_range: scalar('SELECT COUNT(*) AS v FROM customers WHERE date(created_at) BETWEEN date(?) AND date(?)', [from, to]),
    with_phone: scalar(`SELECT COUNT(*) AS v FROM customers WHERE phone IS NOT NULL AND TRIM(phone) != ''`),
    segments: scalar(`SELECT COUNT(*) AS v FROM mkt_customer_segments ${agentWhere}`, bizParams)
  };

  const loyalty = {
    members: scalar(`SELECT COUNT(*) AS v FROM mkt_loyalty_accounts ${agentWhere}`, bizParams),
    points_outstanding: money(scalar(`SELECT COALESCE(SUM(points),0) AS v FROM mkt_loyalty_accounts ${agentWhere}`, bizParams)),
    rules: scalar(`SELECT COUNT(*) AS v FROM mkt_loyalty_rules ${agentWhere} AND IFNULL(is_active,1) = 1`, bizParams),
    points_issued_in_range: money(scalar(
      `SELECT COALESCE(SUM(points),0) AS v FROM mkt_loyalty_transactions
         WHERE txn_type IN ('earn','bonus','adjust_add') AND date(created_at) BETWEEN date(?) AND date(?)`,
      [from, to]
    ))
  };

  const coupons = {
    issued: scalar(`SELECT COUNT(*) AS v FROM mkt_coupons ${commissionWhere}`, commissionParams),
    redeemed: scalar(`SELECT COUNT(*) AS v FROM mkt_coupons ${commissionWhere} AND used_count > 0`, commissionParams),
    active: scalar(
      `SELECT COUNT(*) AS v FROM mkt_coupons ${commissionWhere} AND status IN ('generated','issued','active')
         AND (expires_at IS NULL OR date(expires_at) >= date('now'))`,
      commissionParams
    )
  };
  coupons.redemption_rate = pct(coupons.redeemed, coupons.issued);

  const qr = {
    codes: scalar(`SELECT COUNT(*) AS v FROM mkt_qr_codes ${commissionWhere}`, commissionParams),
    scans: scalar(`SELECT COALESCE(SUM(scan_count),0) AS v FROM mkt_qr_codes ${commissionWhere}`, commissionParams)
  };

  const social = {
    total: scalar(`SELECT COUNT(*) AS v FROM mkt_social_posts ${agentWhere}`, bizParams),
    scheduled: scalar(`SELECT COUNT(*) AS v FROM mkt_social_posts ${agentWhere} AND status = 'scheduled'`, bizParams),
    published_in_range: scalar(
      `SELECT COUNT(*) AS v FROM mkt_social_posts ${agentWhere} AND status = 'published'
         AND date(IFNULL(published_at, created_at)) BETWEEN date(?) AND date(?)`,
      [...bizParams, from, to]
    ),
    drafts: scalar(`SELECT COUNT(*) AS v FROM mkt_social_posts ${agentWhere} AND status = 'draft'`, bizParams)
  };

  const whatsapp = {
    blasts: scalar(`SELECT COUNT(*) AS v FROM mkt_whatsapp_blasts ${agentWhere}`, bizParams),
    sent_in_range: scalar(
      `SELECT COUNT(*) AS v FROM mkt_whatsapp_blasts ${agentWhere} AND status = 'sent'
         AND date(IFNULL(sent_at, created_at)) BETWEEN date(?) AND date(?)`,
      [...bizParams, from, to]
    ),
    recipients_in_range: scalar(
      `SELECT COALESCE(SUM(recipient_count),0) AS v FROM mkt_whatsapp_blasts ${agentWhere} AND status = 'sent'
         AND date(IFNULL(sent_at, created_at)) BETWEEN date(?) AND date(?)`,
      [...bizParams, from, to]
    ),
    scheduled: scalar(`SELECT COUNT(*) AS v FROM mkt_whatsapp_blasts ${agentWhere} AND status = 'scheduled'`, bizParams)
  };

  const payments = {
    pending: money(scalar(`SELECT COALESCE(SUM(amount),0) AS v FROM mkt_agent_payments WHERE status IN ('pending','processing')`)),
    paid_in_range: money(scalar(
      `SELECT COALESCE(SUM(amount),0) AS v FROM mkt_agent_payments WHERE status = 'paid'
         AND date(IFNULL(payment_date, created_at)) BETWEEN date(?) AND date(?)`,
      [from, to]
    ))
  };

  const marketingSpend = money(campaigns.spend + commissions.paid);
  const roi = {
    revenue: attributedRevenue,
    spend: marketingSpend,
    profit: money(attributedRevenue - marketingSpend),
    roi_percent: marketingSpend > 0 ? Math.round(((attributedRevenue - marketingSpend) / marketingSpend) * 1000) / 10 : 0,
    cost_per_order: attributedOrders ? money(marketingSpend / attributedOrders) : 0
  };

  const contracts = {
    total: scalar('SELECT COUNT(*) AS v FROM mkt_agent_contracts'),
    awaiting_signature: scalar(`SELECT COUNT(*) AS v FROM mkt_agent_contracts WHERE status = 'sent'`),
    active: scalar(`SELECT COUNT(*) AS v FROM mkt_agent_contracts WHERE status IN ('accepted','active')`),
    expiring_soon: scalar(
      `SELECT COUNT(*) AS v FROM mkt_agent_contracts WHERE status IN ('accepted','active')
         AND end_date IS NOT NULL AND date(end_date) BETWEEN date('now') AND date('now','+30 day')`
    )
  };

  const cards = [
    { key: 'active_campaigns', label: 'Active campaigns', value: campaigns.active, format: 'number', hint: `${campaigns.total} total`, tone: campaigns.active ? 'positive' : 'neutral' },
    { key: 'active_promotions', label: 'Live promotions', value: promotions.active, format: 'number', hint: `${promotions.expiring_soon} ending this week`, tone: 'neutral' },
    { key: 'attributed_revenue', label: 'Attributed revenue', value: attributedRevenue, format: 'money', hint: `${attributedOrders} attributed orders`, tone: 'positive' },
    { key: 'total_revenue', label: 'Total sales', value: sales.revenue, format: 'money', hint: `${sales.orders} orders`, tone: 'neutral' },
    { key: 'attributed_share', label: 'Marketing share of sales', value: sales.attributed_share, format: 'percent', hint: 'Revenue driven by referrals', tone: 'neutral' },
    { key: 'marketing_spend', label: 'Marketing spend', value: marketingSpend, format: 'money', hint: 'Campaign cost + paid commissions', tone: 'warning' },
    { key: 'marketing_roi', label: 'Marketing ROI', value: roi.roi_percent, format: 'percent', hint: `Profit ${money(roi.profit)}`, tone: roi.roi_percent >= 0 ? 'positive' : 'negative' },
    { key: 'active_agents', label: 'Active referral agents', value: agents.active, format: 'number', hint: `${agents.pending} awaiting approval`, tone: agents.pending ? 'warning' : 'neutral' },
    { key: 'pending_applications', label: 'Agent applications', value: agents.pending, format: 'number', hint: 'Needs review', tone: agents.pending ? 'warning' : 'neutral' },
    { key: 'referrals', label: 'Referrals', value: referrals.in_range, format: 'number', hint: `${referrals.conversion_rate}% converted`, tone: 'neutral' },
    { key: 'referral_clicks', label: 'Referral link clicks', value: referrals.clicks, format: 'number', hint: `${referrals.click_to_referral_rate}% became referrals`, tone: 'neutral' },
    { key: 'commissions_pending', label: 'Commissions pending', value: commissions.pending, format: 'money', hint: `${commissions.pending_count} to review`, tone: commissions.pending_count ? 'warning' : 'neutral' },
    { key: 'commissions_payable', label: 'Ready to pay', value: commissions.payable, format: 'money', hint: `${commissions.payable_count} commissions`, tone: commissions.payable ? 'warning' : 'neutral' },
    { key: 'commissions_paid', label: 'Commissions paid', value: commissions.paid, format: 'money', hint: `${money(payments.paid_in_range)} paid this period`, tone: 'positive' },
    { key: 'loyalty_members', label: 'Loyalty members', value: loyalty.members, format: 'number', hint: `${money(loyalty.points_outstanding)} points outstanding`, tone: 'neutral' },
    { key: 'new_customers', label: 'New customers', value: customers.new_in_range, format: 'number', hint: `${customers.total} total customers`, tone: 'neutral' },
    { key: 'coupons_redeemed', label: 'Coupons redeemed', value: coupons.redeemed, format: 'number', hint: `${coupons.redemption_rate}% of ${coupons.issued} issued`, tone: 'neutral' },
    { key: 'qr_scans', label: 'QR scans', value: qr.scans, format: 'number', hint: `${qr.codes} codes live`, tone: 'neutral' },
    { key: 'social_published', label: 'Social posts published', value: social.published_in_range, format: 'number', hint: `${social.scheduled} scheduled`, tone: 'neutral' },
    { key: 'whatsapp_reach', label: 'WhatsApp reach', value: whatsapp.recipients_in_range, format: 'number', hint: `${whatsapp.sent_in_range} blasts sent`, tone: 'neutral' },
    { key: 'contracts_awaiting', label: 'Contracts awaiting signature', value: contracts.awaiting_signature, format: 'number', hint: `${contracts.active} active`, tone: contracts.awaiting_signature ? 'warning' : 'neutral' }
  ];

  const alerts = [];
  if (agents.pending) alerts.push({ level: 'warning', message: `${agents.pending} referral agent application(s) awaiting review`, action: 'referral_agents' });
  if (commissions.pending_count) alerts.push({ level: 'warning', message: `${commissions.pending_count} commission(s) pending approval`, action: 'commissions' });
  if (commissions.payable_count) alerts.push({ level: 'info', message: `${money(commissions.payable)} ready to pay out`, action: 'payments' });
  if (promotions.expiring_soon) alerts.push({ level: 'info', message: `${promotions.expiring_soon} promotion(s) end within 7 days`, action: 'promotions' });
  if (contracts.expiring_soon) alerts.push({ level: 'info', message: `${contracts.expiring_soon} agent contract(s) expire within 30 days`, action: 'contracts' });
  if (!campaigns.total) alerts.push({ level: 'info', message: 'No campaigns yet — create your first campaign to start tracking ROI', action: 'campaigns' });

  const softList = (label, fn, fallback) => {
    try { return fn(); }
    catch (err) {
      console.warn('[mktp-dashboard]', label, err.message || err);
      return fallback;
    }
  };

  return {
    generated_at: nowIso(),
    range: { from, to },
    filters: { business_id: businessId, branch_id: intOrNull(filters.branch_id), from, to },
    businesses: softList('businesses', () => listBusinesses({ include_inactive: true }, actor), []),
    branches: softList('branches', () => listMktBranches({ business_id: businessId, include_inactive: true }, actor), []),
    cards,
    alerts,
    campaigns,
    promotions,
    agents,
    commissions,
    referrals,
    sales,
    customers,
    loyalty,
    coupons,
    qr,
    social,
    whatsapp,
    payments,
    contracts,
    roi,
    attributed: { revenue: attributedRevenue, orders: attributedOrders },
    top_agents: softList('top_agents', () => getLeaderboard({ ...filters, limit: 5, metric: 'revenue' }, actor).rows, []),
    top_campaigns: softList('top_campaigns', () => topCampaigns({ ...filters, from, to }, 5), []),
    upcoming_events: softList('upcoming_events', () => listCalendarEvents({ from: today(), to: addDays(today(), 30), limit: 12 }, actor), []),
    recent_activity: softList('recent_activity', () => listPlatformAudit({ limit: 15 }, actor), []),
    unread_notifications: scalar(`SELECT COUNT(*) AS v FROM mkt_notifications WHERE IFNULL(is_read,0) = 0 AND audience IN ('admin','all')`)
  };
}

function topCampaigns(filters = {}, limit = 5) {
  const { from, to } = dateRange(filters);
  const rows = dbAll(
    `SELECT c.id, c.name, c.status, c.budget, c.marketing_cost, c.start_date, c.end_date,
        (SELECT COALESCE(SUM(m.sale_amount),0) FROM mkt_commissions m
           WHERE m.campaign_id = c.id AND m.status NOT IN ('reversed','cancelled')) AS revenue,
        (SELECT COALESCE(SUM(m.commission_amount),0) FROM mkt_commissions m
           WHERE m.campaign_id = c.id AND m.status NOT IN ('reversed','cancelled')) AS commission,
        (SELECT COUNT(*) FROM mkt_referrals_v2 r WHERE r.campaign_id = c.id) AS referrals
     FROM mkt_campaigns_v2 c
     WHERE date(c.created_at) <= date(?)
     ORDER BY revenue DESC, c.id DESC LIMIT ?`,
    [to, Math.max(1, Number(limit) || 5)]
  );
  return rows.map(row => {
    const spend = money(num(row.marketing_cost) + num(row.commission));
    return {
      ...row,
      from,
      revenue: money(row.revenue),
      commission: money(row.commission),
      spend,
      roi_percent: spend > 0 ? Math.round(((num(row.revenue) - spend) / spend) * 1000) / 10 : 0
    };
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Campaigns
 * ────────────────────────────────────────────────────────────────────────── */

function hydrateCampaign(row) {
  if (!row) return null;
  return {
    ...row,
    product_ids: parseJson(row.product_ids_json, []),
    channels: parseJson(row.channels_json, [])
  };
}

function listCampaignsV2(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT c.*, b.name AS business_name, br.name AS branch_name, p.name AS promotion_name,
      (SELECT COUNT(*) FROM mkt_referrals_v2 r WHERE r.campaign_id = c.id) AS referral_count,
      (SELECT COUNT(*) FROM mkt_commissions m WHERE m.campaign_id = c.id) AS commission_count,
      (SELECT COALESCE(SUM(m.sale_amount),0) FROM mkt_commissions m
         WHERE m.campaign_id = c.id AND m.status NOT IN ('reversed','cancelled')) AS attributed_revenue,
      (SELECT COALESCE(SUM(m.commission_amount),0) FROM mkt_commissions m
         WHERE m.campaign_id = c.id AND m.status NOT IN ('reversed','cancelled')) AS commission_total,
      (SELECT COUNT(*) FROM mkt_referral_clicks k WHERE k.campaign_id = c.id) AS click_count
    FROM mkt_campaigns_v2 c
    LEFT JOIN mkt_businesses b ON b.id = c.business_id
    LEFT JOIN branches br ON br.id = c.branch_id
    LEFT JOIN mkt_promotions p ON p.id = c.promotion_id
    WHERE 1=1`;
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND c.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND c.branch_id = ?';
    params.push(intOrNull(filters.branch_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND c.status = ?';
    params.push(String(filters.status));
  }
  if (Array.isArray(filters.status_in) && filters.status_in.length) {
    sql += ` AND c.status IN (${filters.status_in.map(() => '?').join(',')})`;
    params.push(...filters.status_in.map(String));
  }
  if (filters.promotion_id != null && filters.promotion_id !== '') {
    sql += ' AND c.promotion_id = ?';
    params.push(intOrNull(filters.promotion_id));
  }
  if (textOrNull(filters.search)) {
    sql += ` AND (c.name LIKE ? OR IFNULL(c.description,'') LIKE ?)`;
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.from) {
    sql += ' AND date(IFNULL(c.end_date, c.created_at)) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(IFNULL(c.start_date, c.created_at)) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }
  sql += ' ORDER BY c.created_at DESC, c.id DESC LIMIT ?';
  params.push(limitOf(filters, 300));

  try {
    return dbAll(sql, params).map(row => ({
      ...hydrateCampaign(row),
      attributed_revenue: money(row.attributed_revenue),
      commission_total: money(row.commission_total)
    }));
  } catch (_) {
    return [];
  }
}

function getCampaignV2(id, actor) {
  requirePlatformUser(actor);
  const row = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [id]);
  if (!row) return null;
  const campaign = hydrateCampaign(row);
  campaign.business = row.business_id ? dbGet('SELECT id, name, code FROM mkt_businesses WHERE id = ?', [row.business_id]) || null : null;
  campaign.branch = row.branch_id ? dbGet('SELECT id, name, code FROM branches WHERE id = ?', [row.branch_id]) || null : null;
  campaign.promotion = row.promotion_id ? hydratePromotion(dbGet('SELECT * FROM mkt_promotions WHERE id = ?', [row.promotion_id])) : null;
  campaign.channel_rows = dbAll('SELECT * FROM mkt_campaign_channels WHERE campaign_id = ? ORDER BY id', [row.id]);
  campaign.social_posts = dbAll('SELECT * FROM mkt_social_posts WHERE campaign_id = ? ORDER BY id DESC', [row.id]);
  campaign.whatsapp_blasts = dbAll('SELECT * FROM mkt_whatsapp_blasts WHERE campaign_id = ? ORDER BY id DESC', [row.id]);
  campaign.coupons = dbAll('SELECT * FROM mkt_coupons WHERE campaign_id = ? ORDER BY id DESC LIMIT 100', [row.id]);
  campaign.qr_codes = dbAll(`SELECT * FROM mkt_qr_codes WHERE entity_type = 'campaign' AND entity_id = ? ORDER BY id DESC`, [row.id]);
  campaign.calendar_events = dbAll(`SELECT * FROM mkt_calendar_events WHERE related_type = 'campaign' AND related_id = ? ORDER BY start_at`, [row.id]);
  campaign.products = loadProducts(campaign.product_ids);
  campaign.analytics = getCampaignAnalytics(row.id, actor);
  return campaign;
}

function loadProducts(ids) {
  const list = (ids || []).map(v => intOrNull(typeof v === 'object' ? (v.product_id ?? v.id) : v)).filter(v => v != null);
  const products = [];
  for (const id of list) {
    try {
      const p = dbGet('SELECT id, name, selling_price, description, is_active, stock_quantity FROM products WHERE id = ?', [id]);
      if (p) products.push(p);
    } catch (_) { /* ignore */ }
  }
  return products;
}

function saveCampaignV2(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Campaign name is required');
  const status = textOrNull(data.status);
  if (status && !CAMPAIGN_STATUSES.includes(status)) throw new Error(`Invalid campaign status: ${status}`);

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Campaign not found');
    dbRun(
      `UPDATE mkt_campaigns_v2 SET business_id=?, branch_id=?, name=?, description=?, promotion_id=?, budget=?, target_audience=?,
         product_ids_json=?, channels_json=?, commission_rule_id=?, commission_rate=?, commission_fixed=?, start_date=?, end_date=?,
         status=?, marketing_cost=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        data.branch_id === undefined ? existing.branch_id : intOrNull(data.branch_id),
        name,
        coalesce(textOrNull(data.description), existing.description),
        data.promotion_id === undefined ? existing.promotion_id : intOrNull(data.promotion_id),
        data.budget === undefined ? num(existing.budget) : money(data.budget),
        coalesce(textOrNull(data.target_audience), existing.target_audience),
        data.product_ids !== undefined || data.product_ids_json !== undefined
          ? toJsonText(data.product_ids !== undefined ? data.product_ids : data.product_ids_json, '[]')
          : (existing.product_ids_json || '[]'),
        data.channels !== undefined || data.channels_json !== undefined
          ? toJsonText(data.channels !== undefined ? data.channels : data.channels_json, '[]')
          : (existing.channels_json || '[]'),
        data.commission_rule_id === undefined ? existing.commission_rule_id : intOrNull(data.commission_rule_id),
        data.commission_rate === undefined ? existing.commission_rate : (data.commission_rate === null || data.commission_rate === '' ? null : num(data.commission_rate)),
        data.commission_fixed === undefined ? existing.commission_fixed : (data.commission_fixed === null || data.commission_fixed === '' ? null : money(data.commission_fixed)),
        data.start_date === undefined ? existing.start_date : textOrNull(data.start_date),
        data.end_date === undefined ? existing.end_date : textOrNull(data.end_date),
        status || existing.status || 'draft',
        data.marketing_cost === undefined ? num(existing.marketing_cost) : money(data.marketing_cost),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_campaign', 'mkt_campaign', existing.id, existing, updated);
    syncCampaignCalendar(updated);
    return hydrateCampaign(updated);
  }

  const business = intOrNull(data.business_id) ?? defaultBusinessId();
  const result = dbRun(
    `INSERT INTO mkt_campaigns_v2 (uid, business_id, branch_id, name, description, promotion_id, budget, target_audience,
       product_ids_json, channels_json, commission_rule_id, commission_rate, commission_fixed, start_date, end_date, status,
       marketing_cost, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      uid('cmp'),
      business,
      intOrNull(data.branch_id),
      name,
      textOrNull(data.description),
      intOrNull(data.promotion_id),
      money(data.budget),
      textOrNull(data.target_audience),
      toJsonText(data.product_ids !== undefined ? data.product_ids : data.product_ids_json, '[]'),
      toJsonText(data.channels !== undefined ? data.channels : data.channels_json, '[]'),
      intOrNull(data.commission_rule_id),
      data.commission_rate == null || data.commission_rate === '' ? null : num(data.commission_rate),
      data.commission_fixed == null || data.commission_fixed === '' ? null : money(data.commission_fixed),
      textOrNull(data.start_date) || today(),
      textOrNull(data.end_date),
      status || 'draft',
      money(data.marketing_cost),
      admin.id
    ]
  );
  const created = fetchInserted('mkt_campaigns_v2', result);
  platformAudit(admin, 'create_campaign', 'mkt_campaign', created.id, null, created);
  syncCampaignCalendar(created);
  notifyAdmins('Campaign created', `${created.name} is now in ${created.status}`, 'campaign', 'campaign', created.id);
  return hydrateCampaign(created);
}

function defaultBusinessId() {
  try {
    const row = dbGet('SELECT id FROM mkt_businesses ORDER BY id LIMIT 1');
    if (row) return Number(row.id);
    const seeded = ensureDefaultBusiness();
    return seeded ? Number(seeded.id) : null;
  } catch (_) {
    return null;
  }
}

function syncCampaignCalendar(campaign) {
  if (!campaign) return;
  try {
    dbRun(`DELETE FROM mkt_calendar_events WHERE related_type = 'campaign' AND related_id = ?`, [campaign.id]);
    if (campaign.start_date) {
      dbRun(
        `INSERT INTO mkt_calendar_events (business_id, branch_id, event_type, title, related_type, related_id, start_at, end_at, color, created_at)
         VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`,
        [campaign.business_id, campaign.branch_id, 'campaign_start', `${campaign.name} starts`, 'campaign', campaign.id, campaign.start_date, campaign.start_date, '#2563eb']
      );
    }
    if (campaign.end_date) {
      dbRun(
        `INSERT INTO mkt_calendar_events (business_id, branch_id, event_type, title, related_type, related_id, start_at, end_at, color, created_at)
         VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`,
        [campaign.business_id, campaign.branch_id, 'campaign_end', `${campaign.name} ends`, 'campaign', campaign.id, campaign.end_date, campaign.end_date, '#f97316']
      );
    }
  } catch (_) { /* calendar is best-effort */ }
}

function duplicateCampaignV2(id, actor) {
  const admin = requireMktAdmin(actor);
  const source = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [id]);
  if (!source) throw new Error('Campaign not found');
  const result = dbRun(
    `INSERT INTO mkt_campaigns_v2 (uid, business_id, branch_id, name, description, promotion_id, budget, target_audience,
       product_ids_json, channels_json, commission_rule_id, commission_rate, commission_fixed, start_date, end_date, status,
       marketing_cost, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?, datetime('now'), datetime('now'))`,
    [
      uid('cmp'),
      source.business_id,
      source.branch_id,
      `${source.name} (Copy)`,
      source.description,
      source.promotion_id,
      num(source.budget),
      source.target_audience,
      source.product_ids_json || '[]',
      source.channels_json || '[]',
      source.commission_rule_id,
      source.commission_rate,
      source.commission_fixed,
      today(),
      source.end_date,
      num(source.marketing_cost),
      admin.id
    ]
  );
  const copy = fetchInserted('mkt_campaigns_v2', result);
  const channels = dbAll('SELECT * FROM mkt_campaign_channels WHERE campaign_id = ?', [source.id]);
  for (const channel of channels) {
    dbRun(
      `INSERT INTO mkt_campaign_channels (campaign_id, channel, content, status, scheduled_at, created_at)
       VALUES (?,?,?, 'draft', ?, datetime('now'))`,
      [copy.id, channel.channel, channel.content, channel.scheduled_at]
    );
  }
  platformAudit(admin, 'duplicate_campaign', 'mkt_campaign', copy.id, { source_id: source.id }, copy);
  syncCampaignCalendar(copy);
  return hydrateCampaign(copy);
}

function setCampaignStatus(id, status, actor) {
  const admin = requireMktAdmin(actor);
  const next = String(status || '').toLowerCase();
  if (!CAMPAIGN_STATUSES.includes(next)) throw new Error(`Invalid campaign status: ${status}`);
  const existing = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [id]);
  if (!existing) throw new Error('Campaign not found');
  dbRun(`UPDATE mkt_campaigns_v2 SET status = ?, updated_at = datetime('now') WHERE id = ?`, [next, id]);
  const updated = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [id]);
  platformAudit(admin, 'set_campaign_status', 'mkt_campaign', id, { status: existing.status }, { status: next });
  if (next === 'active') {
    notifyAdmins('Campaign live', `${updated.name} is now active`, 'campaign', 'campaign', id);
  }
  return hydrateCampaign(updated);
}

function listCampaignChannels(campaignId, actor) {
  requirePlatformUser(actor);
  if (campaignId == null || campaignId === '') {
    return dbAll('SELECT * FROM mkt_campaign_channels ORDER BY campaign_id, id LIMIT 500');
  }
  return dbAll('SELECT * FROM mkt_campaign_channels WHERE campaign_id = ? ORDER BY id', [campaignId]);
}

function saveCampaignChannel(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const campaignId = intOrNull(data.campaign_id);
  if (!campaignId) throw new Error('Campaign is required');
  const channel = textOrNull(data.channel);
  if (!channel) throw new Error('Channel is required');
  if (!dbGet('SELECT id FROM mkt_campaigns_v2 WHERE id = ?', [campaignId])) throw new Error('Campaign not found');

  const status = textOrNull(data.status) || 'draft';
  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_campaign_channels WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Campaign channel not found');
    dbRun(
      `UPDATE mkt_campaign_channels SET campaign_id=?, channel=?, content=?, status=?, scheduled_at=?, published_at=? WHERE id=?`,
      [
        campaignId,
        channel.toLowerCase(),
        coalesce(textOrNull(data.content), existing.content),
        status,
        data.scheduled_at === undefined ? existing.scheduled_at : textOrNull(data.scheduled_at),
        status === 'published' ? (existing.published_at || nowIso()) : (data.published_at === undefined ? existing.published_at : textOrNull(data.published_at)),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_campaign_channels WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_campaign_channel', 'mkt_campaign_channel', existing.id, existing, updated);
    return updated;
  }

  const result = dbRun(
    `INSERT INTO mkt_campaign_channels (campaign_id, channel, content, status, scheduled_at, published_at, created_at)
     VALUES (?,?,?,?,?,?, datetime('now'))`,
    [
      campaignId,
      channel.toLowerCase(),
      textOrNull(data.content),
      status,
      textOrNull(data.scheduled_at),
      status === 'published' ? nowIso() : textOrNull(data.published_at)
    ]
  );
  const created = fetchInserted('mkt_campaign_channels', result);
  platformAudit(admin, 'create_campaign_channel', 'mkt_campaign_channel', created.id, null, created);
  return created;
}

function campaignCopy(campaign) {
  const window = campaign.start_date || campaign.end_date
    ? ` Valid ${campaign.start_date || 'now'}${campaign.end_date ? ` to ${campaign.end_date}` : ''}.`
    : '';
  const body = textOrNull(campaign.description) || 'Great deals waiting for you.';
  return `${campaign.name} — ${body}${window}`;
}

/** Creates the draft assets (channels, social posts, blasts, QR, coupon, calendar) for a campaign. */
function generateCampaignAssets(campaignId, actor) {
  const admin = requireMktAdmin(actor);
  const campaign = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error('Campaign not found');

  const created = { channels: [], social_posts: [], whatsapp_blasts: [], qr_codes: [], coupons: [], calendar_events: [], flyers: [] };
  const configured = parseJson(campaign.channels_json, []);
  const rawChannels = Array.isArray(configured) && configured.length ? configured : DEFAULT_CAMPAIGN_CHANNELS;
  const channels = rawChannels
    .map(c => String((c && typeof c === 'object' ? c.channel || c.name : c) || '').trim().toLowerCase())
    .filter(Boolean);
  const copy = campaignCopy(campaign);

  for (const channel of channels) {
    const existing = dbGet('SELECT * FROM mkt_campaign_channels WHERE campaign_id = ? AND channel = ?', [campaign.id, channel]);
    if (!existing) {
      const result = dbRun(
        `INSERT INTO mkt_campaign_channels (campaign_id, channel, content, status, scheduled_at, created_at)
         VALUES (?,?,?, 'draft', ?, datetime('now'))`,
        [campaign.id, channel, copy, campaign.start_date || null]
      );
      created.channels.push(fetchInserted('mkt_campaign_channels', result));
    }

    if (SOCIAL_PLATFORMS.includes(channel)) {
      const post = dbGet(
        `SELECT id FROM mkt_social_posts WHERE campaign_id = ? AND platform = ? AND status = 'draft'`,
        [campaign.id, channel]
      );
      if (!post) {
        const result = dbRun(
          `INSERT INTO mkt_social_posts (campaign_id, business_id, platform, caption, status, scheduled_at, expires_at, created_by, created_at, updated_at)
           VALUES (?,?,?,?, 'draft', ?,?,?, datetime('now'), datetime('now'))`,
          [campaign.id, campaign.business_id, channel, copy, campaign.start_date || null, campaign.end_date || null, admin.id]
        );
        created.social_posts.push(fetchInserted('mkt_social_posts', result));
      }
    }

    if (channel === 'whatsapp') {
      const blast = dbGet(`SELECT id FROM mkt_whatsapp_blasts WHERE campaign_id = ? AND status = 'draft'`, [campaign.id]);
      if (!blast) {
        const audience = previewWhatsappAudience('all', campaign.business_id, campaign.branch_id);
        const result = dbRun(
          `INSERT INTO mkt_whatsapp_blasts (campaign_id, business_id, name, segment_key, message, status, scheduled_at, recipient_count, opt_out_honored, created_by, created_at)
           VALUES (?,?,?,?,?, 'draft', ?,?,1,?, datetime('now'))`,
          [campaign.id, campaign.business_id, `${campaign.name} — WhatsApp blast`, 'all', copy, campaign.start_date || null, audience.count, admin.id]
        );
        created.whatsapp_blasts.push(fetchInserted('mkt_whatsapp_blasts', result));
      }
    }
  }

  const existingQr = dbGet(`SELECT * FROM mkt_qr_codes WHERE entity_type = 'campaign' AND entity_id = ?`, [campaign.id]);
  if (!existingQr) {
    const payload = JSON.stringify({ type: 'campaign', campaign_id: campaign.id, uid: campaign.uid, name: campaign.name });
    const result = dbRun(
      `INSERT INTO mkt_qr_codes (business_id, branch_id, entity_type, entity_id, label, payload, scan_count, is_active, created_at)
       VALUES (?,?,?,?,?,?,0,1, datetime('now'))`,
      [campaign.business_id, campaign.branch_id, 'campaign', campaign.id, `${campaign.name} QR`, payload]
    );
    created.qr_codes.push(fetchInserted('mkt_qr_codes', result));
  }

  const existingCoupon = dbGet('SELECT * FROM mkt_coupons WHERE campaign_id = ? ORDER BY id LIMIT 1', [campaign.id]);
  if (!existingCoupon) {
    const promotion = campaign.promotion_id ? dbGet('SELECT * FROM mkt_promotions WHERE id = ?', [campaign.promotion_id]) : null;
    const code = generateCouponCode(campaign.name);
    const result = dbRun(
      `INSERT INTO mkt_coupons (code, business_id, branch_id, campaign_id, promotion_id, product_ids_json, discount_type,
         discount_value, max_uses, used_count, status, starts_at, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0, 'generated', ?,?, datetime('now'))`,
      [
        code,
        campaign.business_id,
        campaign.branch_id,
        campaign.id,
        campaign.promotion_id,
        campaign.product_ids_json || '[]',
        promotion ? promotion.promo_type || 'percent' : 'percent',
        promotion ? num(promotion.discount_value) : 10,
        1000,
        campaign.start_date || today(),
        campaign.end_date || null
      ]
    );
    created.coupons.push(fetchInserted('mkt_coupons', result));
  }

  // Draft flyer in Flyer Studio so Campaign → Flyer workflow is connected.
  try {
    const flyerExists = dbGet(
      `SELECT id FROM promotion_flyers WHERE title = ? AND IFNULL(status,'draft') = 'draft' ORDER BY id DESC LIMIT 1`,
      [campaign.name]
    );
    if (!flyerExists && hasTable('promotion_flyers')) {
      const flyers = require('./flyers');
      const flyer = flyers.saveFlyer({
        title: campaign.name,
        promotion_name: campaign.name,
        branch_id: campaign.branch_id || null,
        start_date: campaign.start_date || null,
        end_date: campaign.end_date || null,
        flyer_size: 'a4_portrait',
        status: 'draft',
        canvas_json: {
          headline: campaign.name,
          body: textOrNull(campaign.description) || '',
          campaign_id: campaign.id,
          mkt_campaign_uid: campaign.uid
        },
        products: [],
        branding: {},
        apply_pos_prices: false
      }, admin);
      if (flyer?.id) created.flyers.push(flyer);
    } else if (flyerExists) {
      created.flyers.push(flyerExists);
    }
  } catch (err) {
    console.warn('[mktp] generate flyer draft:', err.message || err);
  }

  syncCampaignCalendar(campaign);
  created.calendar_events = dbAll(
    `SELECT * FROM mkt_calendar_events WHERE related_type = 'campaign' AND related_id = ? ORDER BY start_at`,
    [campaign.id]
  );

  platformAudit(admin, 'generate_campaign_assets', 'mkt_campaign', campaign.id, null, {
    channels: created.channels.length,
    social_posts: created.social_posts.length,
    whatsapp_blasts: created.whatsapp_blasts.length,
    qr_codes: created.qr_codes.length,
    coupons: created.coupons.length,
    flyers: created.flyers.length
  });

  return {
    campaign: hydrateCampaign(campaign),
    created,
    summary: {
      channels: created.channels.length,
      social_posts: created.social_posts.length,
      whatsapp_blasts: created.whatsapp_blasts.length,
      qr_codes: created.qr_codes.length,
      coupons: created.coupons.length,
      flyers: created.flyers.length,
      calendar_events: created.calendar_events.length
    }
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Promotions
 * ────────────────────────────────────────────────────────────────────────── */

function hydratePromotion(row) {
  if (!row) return null;
  return {
    ...row,
    product_ids: parseJson(row.product_ids_json, []),
    branch_ids: parseJson(row.branch_ids_json, []),
    customer_groups: parseJson(row.customer_groups_json, [])
  };
}

function listPromotions(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT p.*, b.name AS business_name, br.name AS branch_name,
      (SELECT COUNT(*) FROM mkt_campaigns_v2 c WHERE c.promotion_id = p.id) AS campaign_count,
      (SELECT COUNT(*) FROM mkt_coupons cp WHERE cp.promotion_id = p.id) AS coupon_count
    FROM mkt_promotions p
    LEFT JOIN mkt_businesses b ON b.id = p.business_id
    LEFT JOIN branches br ON br.id = p.branch_id
    WHERE 1=1`;
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND p.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND p.branch_id = ?';
    params.push(intOrNull(filters.branch_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND p.status = ?';
    params.push(String(filters.status));
  }
  if (textOrNull(filters.promo_type)) {
    sql += ' AND p.promo_type = ?';
    params.push(String(filters.promo_type));
  }
  if (filters.active_now) {
    sql += ` AND p.status = 'active' AND (p.start_date IS NULL OR date(p.start_date) <= date('now'))
             AND (p.end_date IS NULL OR date(p.end_date) >= date('now'))`;
  }
  if (textOrNull(filters.search)) {
    sql += ' AND p.name LIKE ?';
    params.push(`%${filters.search}%`);
  }
  sql += ' ORDER BY p.created_at DESC, p.id DESC LIMIT ?';
  params.push(limitOf(filters, 300));
  try {
    return dbAll(sql, params).map(hydratePromotion);
  } catch (_) {
    return [];
  }
}

function getPromotion(id, actor) {
  requirePlatformUser(actor);
  const row = dbGet('SELECT * FROM mkt_promotions WHERE id = ?', [id]);
  if (!row) return null;
  const promotion = hydratePromotion(row);
  promotion.products = loadProducts(promotion.product_ids);
  promotion.campaigns = dbAll('SELECT id, name, status, start_date, end_date FROM mkt_campaigns_v2 WHERE promotion_id = ? ORDER BY id DESC', [row.id]);
  promotion.coupons = dbAll('SELECT * FROM mkt_coupons WHERE promotion_id = ? ORDER BY id DESC LIMIT 100', [row.id]);
  return promotion;
}

function savePromotion(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Promotion name is required');
  const status = textOrNull(data.status);
  if (status && !PROMOTION_STATUSES.includes(status)) throw new Error(`Invalid promotion status: ${status}`);

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_promotions WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Promotion not found');
    dbRun(
      `UPDATE mkt_promotions SET business_id=?, branch_id=?, name=?, promo_type=?, discount_value=?, buy_qty=?, get_qty=?,
         min_purchase=?, max_discount=?, product_ids_json=?, branch_ids_json=?, customer_groups_json=?, usage_limit=?,
         usage_per_customer=?, requires_referral=?, requires_coupon=?, start_date=?, end_date=?, status=?, notes=?,
         updated_at=datetime('now')
       WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        data.branch_id === undefined ? existing.branch_id : intOrNull(data.branch_id),
        name,
        textOrNull(data.promo_type) || existing.promo_type || 'percent',
        data.discount_value === undefined ? num(existing.discount_value) : num(data.discount_value),
        data.buy_qty === undefined ? num(existing.buy_qty, 1) : num(data.buy_qty, 1),
        data.get_qty === undefined ? num(existing.get_qty, 1) : num(data.get_qty, 1),
        data.min_purchase === undefined ? num(existing.min_purchase) : money(data.min_purchase),
        data.max_discount === undefined ? existing.max_discount : (data.max_discount === null || data.max_discount === '' ? null : money(data.max_discount)),
        data.product_ids !== undefined || data.product_ids_json !== undefined
          ? toJsonText(data.product_ids !== undefined ? data.product_ids : data.product_ids_json, '[]')
          : (existing.product_ids_json || '[]'),
        data.branch_ids !== undefined || data.branch_ids_json !== undefined
          ? toJsonText(data.branch_ids !== undefined ? data.branch_ids : data.branch_ids_json, '[]')
          : (existing.branch_ids_json || '[]'),
        data.customer_groups !== undefined || data.customer_groups_json !== undefined
          ? toJsonText(data.customer_groups !== undefined ? data.customer_groups : data.customer_groups_json, '[]')
          : (existing.customer_groups_json || '[]'),
        data.usage_limit === undefined ? existing.usage_limit : intOrNull(data.usage_limit),
        data.usage_per_customer === undefined ? existing.usage_per_customer : intOrNull(data.usage_per_customer),
        data.requires_referral === undefined ? bool01(existing.requires_referral, 0) : bool01(data.requires_referral, 0),
        data.requires_coupon === undefined ? bool01(existing.requires_coupon, 0) : bool01(data.requires_coupon, 0),
        data.start_date === undefined ? existing.start_date : textOrNull(data.start_date),
        data.end_date === undefined ? existing.end_date : textOrNull(data.end_date),
        status || existing.status || 'draft',
        data.notes === undefined ? existing.notes : textOrNull(data.notes),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_promotions WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_promotion', 'mkt_promotion', existing.id, existing, updated);
    return hydratePromotion(updated);
  }

  const result = dbRun(
    `INSERT INTO mkt_promotions (business_id, branch_id, name, promo_type, discount_value, buy_qty, get_qty, min_purchase,
       max_discount, product_ids_json, branch_ids_json, customer_groups_json, usage_limit, usage_per_customer,
       requires_referral, requires_coupon, start_date, end_date, status, notes, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      intOrNull(data.branch_id),
      name,
      textOrNull(data.promo_type) || 'percent',
      num(data.discount_value),
      num(data.buy_qty, 1),
      num(data.get_qty, 1),
      money(data.min_purchase),
      data.max_discount == null || data.max_discount === '' ? null : money(data.max_discount),
      toJsonText(data.product_ids !== undefined ? data.product_ids : data.product_ids_json, '[]'),
      toJsonText(data.branch_ids !== undefined ? data.branch_ids : data.branch_ids_json, '[]'),
      toJsonText(data.customer_groups !== undefined ? data.customer_groups : data.customer_groups_json, '[]'),
      intOrNull(data.usage_limit),
      intOrNull(data.usage_per_customer),
      bool01(data.requires_referral, 0),
      bool01(data.requires_coupon, 0),
      textOrNull(data.start_date) || today(),
      textOrNull(data.end_date),
      status || 'draft',
      textOrNull(data.notes),
      admin.id
    ]
  );
  const created = fetchInserted('mkt_promotions', result);
  platformAudit(admin, 'create_promotion', 'mkt_promotion', created.id, null, created);
  return hydratePromotion(created);
}

function setPromotionStatus(id, status, actor) {
  const admin = requireMktAdmin(actor);
  const next = String(status || '').toLowerCase();
  if (!PROMOTION_STATUSES.includes(next)) throw new Error(`Invalid promotion status: ${status}`);
  const existing = dbGet('SELECT * FROM mkt_promotions WHERE id = ?', [id]);
  if (!existing) throw new Error('Promotion not found');
  dbRun(`UPDATE mkt_promotions SET status = ?, updated_at = datetime('now') WHERE id = ?`, [next, id]);
  const updated = dbGet('SELECT * FROM mkt_promotions WHERE id = ?', [id]);
  platformAudit(admin, 'set_promotion_status', 'mkt_promotion', id, { status: existing.status }, { status: next });
  return hydratePromotion(updated);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Social posts
 * ────────────────────────────────────────────────────────────────────────── */

function listSocialPosts(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT s.*, c.name AS campaign_name, b.name AS business_name
    FROM mkt_social_posts s
    LEFT JOIN mkt_campaigns_v2 c ON c.id = s.campaign_id
    LEFT JOIN mkt_businesses b ON b.id = s.business_id
    WHERE 1=1`;
  const params = [];
  if (filters.campaign_id != null && filters.campaign_id !== '') {
    sql += ' AND s.campaign_id = ?';
    params.push(intOrNull(filters.campaign_id));
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND s.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (textOrNull(filters.platform)) {
    sql += ' AND s.platform = ?';
    params.push(String(filters.platform).toLowerCase());
  }
  if (textOrNull(filters.status)) {
    sql += ' AND s.status = ?';
    params.push(String(filters.status));
  }
  if (filters.from) {
    sql += ' AND date(IFNULL(s.published_at, IFNULL(s.scheduled_at, s.created_at))) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(IFNULL(s.published_at, IFNULL(s.scheduled_at, s.created_at))) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }
  sql += ' ORDER BY IFNULL(s.scheduled_at, s.created_at) DESC, s.id DESC LIMIT ?';
  params.push(limitOf(filters, 300));
  try {
    return dbAll(sql, params);
  } catch (_) {
    return [];
  }
}

function saveSocialPost(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const platform = textOrNull(data.platform);
  if (!platform) throw new Error('Platform is required');
  const status = textOrNull(data.status) || 'draft';
  if (!SOCIAL_STATUSES.includes(status)) throw new Error(`Invalid social post status: ${status}`);

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_social_posts WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Social post not found');
    dbRun(
      `UPDATE mkt_social_posts SET campaign_id=?, business_id=?, platform=?, caption=?, media_path=?, status=?, scheduled_at=?,
         published_at=?, expires_at=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        data.campaign_id === undefined ? existing.campaign_id : intOrNull(data.campaign_id),
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        platform.toLowerCase(),
        data.caption === undefined ? existing.caption : textOrNull(data.caption),
        data.media_path === undefined ? existing.media_path : textOrNull(data.media_path),
        status,
        data.scheduled_at === undefined ? existing.scheduled_at : textOrNull(data.scheduled_at),
        status === 'published' ? (existing.published_at || nowIso()) : (data.published_at === undefined ? existing.published_at : textOrNull(data.published_at)),
        data.expires_at === undefined ? existing.expires_at : textOrNull(data.expires_at),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_social_posts WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_social_post', 'mkt_social_post', existing.id, existing, updated);
    return updated;
  }

  const result = dbRun(
    `INSERT INTO mkt_social_posts (campaign_id, business_id, platform, caption, media_path, status, scheduled_at, published_at,
       expires_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      intOrNull(data.campaign_id),
      intOrNull(data.business_id) ?? defaultBusinessId(),
      platform.toLowerCase(),
      textOrNull(data.caption),
      textOrNull(data.media_path),
      status,
      textOrNull(data.scheduled_at),
      status === 'published' ? nowIso() : textOrNull(data.published_at),
      textOrNull(data.expires_at),
      admin.id
    ]
  );
  const created = fetchInserted('mkt_social_posts', result);
  platformAudit(admin, 'create_social_post', 'mkt_social_post', created.id, null, created);
  if (created.scheduled_at) {
    try {
      dbRun(
        `INSERT INTO mkt_calendar_events (business_id, event_type, title, related_type, related_id, start_at, color, created_at)
         VALUES (?,?,?,?,?,?,?, datetime('now'))`,
        [created.business_id, 'social_post', `${created.platform} post`, 'social_post', created.id, created.scheduled_at, '#8b5cf6']
      );
    } catch (_) { /* optional */ }
  }
  return created;
}

function setSocialPostStatus(id, status, actor) {
  const admin = requireMktAdmin(actor);
  const next = String(status || '').toLowerCase();
  if (!SOCIAL_STATUSES.includes(next)) throw new Error(`Invalid social post status: ${status}`);
  const existing = dbGet('SELECT * FROM mkt_social_posts WHERE id = ?', [id]);
  if (!existing) throw new Error('Social post not found');
  dbRun(
    `UPDATE mkt_social_posts SET status = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`,
    [next, next === 'published' ? (existing.published_at || nowIso()) : existing.published_at, id]
  );
  const updated = dbGet('SELECT * FROM mkt_social_posts WHERE id = ?', [id]);
  platformAudit(admin, 'set_social_post_status', 'mkt_social_post', id, { status: existing.status }, { status: next });
  return updated;
}

/**
 * Publish to Meta (Facebook / Instagram) when tokens are configured, then mark published.
 * Other platforms are marked published locally with a note.
 */
async function publishSocialPostLive(id, actor) {
  const admin = requireMktAdmin(actor);
  const existing = dbGet('SELECT * FROM mkt_social_posts WHERE id = ?', [id]);
  if (!existing) throw new Error('Social post not found');
  const socialPublish = require('./social-publish');
  let remote = null;
  let note = null;
  try {
    const result = await socialPublish.publishSocialPostRow(existing);
    remote = result.remote || null;
    note = result.reason || null;
    if (result.published === false && ['facebook', 'instagram'].includes(String(existing.platform || '').toLowerCase())) {
      throw new Error(result.reason || 'Publish failed');
    }
  } catch (err) {
    // If Meta credentials are missing, still allow local status for non-Meta platforms;
    // for FB/IG rethrow so the admin sees the real error.
    const platform = String(existing.platform || '').toLowerCase();
    if (platform === 'facebook' || platform === 'instagram') throw err;
    note = err.message;
  }
  dbRun(
    `UPDATE mkt_social_posts SET status = 'published', published_at = COALESCE(published_at, ?),
       updated_at = datetime('now') WHERE id = ?`,
    [nowIso(), id]
  );
  const updated = dbGet('SELECT * FROM mkt_social_posts WHERE id = ?', [id]);
  platformAudit(admin, 'publish_social_post', 'mkt_social_post', id,
    { status: existing.status },
    { status: 'published', remote_id: remote?.id || null, note }
  );
  return { ...updated, publish_remote: remote, publish_note: note };
}

/* ──────────────────────────────────────────────────────────────────────────
 * WhatsApp blasts & audiences
 * ────────────────────────────────────────────────────────────────────────── */

function optOutClause(alias = 'c') {
  return hasColumn('customers', 'marketing_opt_out') ? ` AND IFNULL(${alias}.marketing_opt_out,0) = 0` : '';
}

/**
 * Resolves the reachable audience for a segment key.
 * Supported keys: all, vip, new, lapsed, birthday, loyalty, top_spenders,
 * with_balance, referred, and `segment:<id>` for saved segments.
 */
function previewWhatsappAudience(segmentKey, businessId, branchId) {
  ensurePlatformReady();
  const key = String(segmentKey || 'all').trim().toLowerCase();
  const optOut = optOutClause('c');
  const base = `SELECT c.id, c.name, c.phone FROM customers c
    WHERE c.phone IS NOT NULL AND TRIM(c.phone) != ''${optOut}`;
  let sql = base;
  const params = [];

  if (key.startsWith('segment:')) {
    const segmentId = intOrNull(key.split(':')[1]);
    const evaluated = segmentId ? evaluateSegmentInternal(segmentId) : { customer_ids: [] };
    const ids = evaluated.customer_ids || [];
    if (!ids.length) return { segment_key: key, business_id: intOrNull(businessId), branch_id: intOrNull(branchId), count: 0, recipients: [] };
    const frag = inFragment('c.id', ids);
    sql = `${base}${frag.sql}`;
    params.push(...frag.params);
  } else {
    switch (key) {
      case 'vip':
        sql += hasColumn('customers', 'is_vip') ? ' AND IFNULL(c.is_vip,0) = 1' : ' AND 1=0';
        break;
      case 'new':
        sql += ` AND date(c.created_at) >= date('now','-30 day')`;
        break;
      case 'lapsed':
        sql += ` AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id
                   AND date(s.created_at) >= date('now','-60 day'))`;
        break;
      case 'birthday':
        sql += hasColumn('customers', 'birthday')
          ? ` AND c.birthday IS NOT NULL AND strftime('%m', c.birthday) = strftime('%m','now')`
          : ' AND 1=0';
        break;
      case 'loyalty':
        sql += ' AND EXISTS (SELECT 1 FROM mkt_loyalty_accounts la WHERE la.customer_id = c.id AND la.points > 0)';
        break;
      case 'with_balance':
        sql += ' AND IFNULL(c.balance,0) > 0';
        break;
      case 'referred':
        sql += ' AND EXISTS (SELECT 1 FROM mkt_referrals_v2 r WHERE r.customer_id = c.id)';
        break;
      case 'top_spenders':
        sql += ` AND (SELECT COALESCE(SUM(s.total),0) FROM sales s
                   WHERE s.customer_id = c.id AND IFNULL(s.status,'completed') NOT IN ('voided','void','returned')) > 0`;
        break;
      case 'all':
      default:
        break;
    }
  }

  // Customers are not tied to a branch, so business/branch scoping is inferred from
  // purchase history. Customers with no sales yet stay reachable so that welcome and
  // win-back blasts are not silently empty.
  if (branchId != null && branchId !== '') {
    sql += ` AND (NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id)
                  OR EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.branch_id = ?))`;
    params.push(intOrNull(branchId));
  } else if (businessId != null && businessId !== '') {
    const branchIds = resolveBranchIds({ business_id: businessId });
    if (branchIds && branchIds.length) {
      const frag = inFragment('s.branch_id', branchIds);
      sql += ` AND (NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id)
                    OR EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id${frag.sql}))`;
      params.push(...frag.params);
    }
  }

  if (key === 'top_spenders') {
    sql += ` ORDER BY (SELECT COALESCE(SUM(s.total),0) FROM sales s
               WHERE s.customer_id = c.id AND IFNULL(s.status,'completed') NOT IN ('voided','void','returned')) DESC LIMIT 100`;
  } else {
    sql += ' ORDER BY c.name LIMIT 2000';
  }

  let recipients = [];
  try {
    recipients = dbAll(sql, params);
  } catch (_) {
    recipients = [];
  }
  return {
    segment_key: key,
    business_id: intOrNull(businessId),
    branch_id: intOrNull(branchId),
    count: recipients.length,
    recipients: recipients.map(r => ({ id: r.id, name: r.name, phone: r.phone }))
  };
}

function listWhatsappBlasts(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT w.*, c.name AS campaign_name, b.name AS business_name
    FROM mkt_whatsapp_blasts w
    LEFT JOIN mkt_campaigns_v2 c ON c.id = w.campaign_id
    LEFT JOIN mkt_businesses b ON b.id = w.business_id
    WHERE 1=1`;
  const params = [];
  if (filters.campaign_id != null && filters.campaign_id !== '') {
    sql += ' AND w.campaign_id = ?';
    params.push(intOrNull(filters.campaign_id));
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND w.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND w.status = ?';
    params.push(String(filters.status));
  }
  if (textOrNull(filters.segment_key)) {
    sql += ' AND w.segment_key = ?';
    params.push(String(filters.segment_key));
  }
  sql += ' ORDER BY w.created_at DESC, w.id DESC LIMIT ?';
  params.push(limitOf(filters, 200));
  try {
    return dbAll(sql, params);
  } catch (_) {
    return [];
  }
}

function saveWhatsappBlast(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  const message = textOrNull(data.message);
  if (!name) throw new Error('Blast name is required');
  if (!message) throw new Error('Message body is required');
  const status = textOrNull(data.status) || 'draft';
  if (!BLAST_STATUSES.includes(status)) throw new Error(`Invalid blast status: ${status}`);

  const businessId = data.business_id === undefined ? defaultBusinessId() : intOrNull(data.business_id);
  const segmentKey = textOrNull(data.segment_key) || 'all';
  const audience = previewWhatsappAudience(segmentKey, businessId, data.branch_id);

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_whatsapp_blasts WHERE id = ?', [data.id]);
    if (!existing) throw new Error('WhatsApp blast not found');
    dbRun(
      `UPDATE mkt_whatsapp_blasts SET campaign_id=?, business_id=?, name=?, segment_key=?, message=?, status=?, scheduled_at=?,
         sent_at=?, recipient_count=?, opt_out_honored=?
       WHERE id=?`,
      [
        data.campaign_id === undefined ? existing.campaign_id : intOrNull(data.campaign_id),
        data.business_id === undefined ? existing.business_id : businessId,
        name,
        segmentKey,
        message,
        status,
        data.scheduled_at === undefined ? existing.scheduled_at : textOrNull(data.scheduled_at),
        status === 'sent' ? (existing.sent_at || nowIso()) : existing.sent_at,
        audience.count,
        data.opt_out_honored === undefined ? bool01(existing.opt_out_honored, 1) : bool01(data.opt_out_honored, 1),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_whatsapp_blasts WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_whatsapp_blast', 'mkt_whatsapp_blast', existing.id, existing, updated);
    return { ...updated, audience };
  }

  const result = dbRun(
    `INSERT INTO mkt_whatsapp_blasts (campaign_id, business_id, name, segment_key, message, status, scheduled_at, sent_at,
       recipient_count, opt_out_honored, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
    [
      intOrNull(data.campaign_id),
      businessId,
      name,
      segmentKey,
      message,
      status,
      textOrNull(data.scheduled_at),
      status === 'sent' ? nowIso() : null,
      audience.count,
      bool01(data.opt_out_honored, 1),
      admin.id
    ]
  );
  const created = fetchInserted('mkt_whatsapp_blasts', result);
  platformAudit(admin, 'create_whatsapp_blast', 'mkt_whatsapp_blast', created.id, null, created);
  return { ...created, audience };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Customers & segments
 * ────────────────────────────────────────────────────────────────────────── */

function listMktCustomers(filters = {}, actor) {
  requirePlatformUser(actor);
  const optOutSelect = hasColumn('customers', 'marketing_opt_out') ? 'IFNULL(c.marketing_opt_out,0)' : '0';
  let sql = `
    SELECT c.*,
      ${optOutSelect} AS marketing_opt_out_flag,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND IFNULL(s.status,'completed') NOT IN ('voided','void','returned')) AS order_count,
      (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id = c.id AND IFNULL(s.status,'completed') NOT IN ('voided','void','returned')) AS total_spent,
      (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id) AS last_purchase_at,
      (SELECT MIN(s.created_at) FROM sales s WHERE s.customer_id = c.id) AS first_purchase_at,
      (SELECT la.points FROM mkt_loyalty_accounts la WHERE la.customer_id = c.id ORDER BY la.id LIMIT 1) AS loyalty_balance,
      (SELECT la.tier FROM mkt_loyalty_accounts la WHERE la.customer_id = c.id ORDER BY la.id LIMIT 1) AS loyalty_tier,
      (SELECT r.agent_id FROM mkt_referrals_v2 r WHERE r.customer_id = c.id ORDER BY r.id LIMIT 1) AS referral_agent_id,
      (SELECT r.referral_code FROM mkt_referrals_v2 r WHERE r.customer_id = c.id ORDER BY r.id LIMIT 1) AS referred_by_code,
      (SELECT a.full_name FROM mkt_referrals_v2 r JOIN mkt_referral_agents a ON a.id = r.agent_id
         WHERE r.customer_id = c.id ORDER BY r.id LIMIT 1) AS referral_agent_name
    FROM customers c WHERE 1=1`;
  const params = [];

  if (textOrNull(filters.search)) {
    sql += ` AND (c.name LIKE ? OR IFNULL(c.phone,'') LIKE ? OR IFNULL(c.email,'') LIKE ?)`;
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.has_phone) sql += ` AND c.phone IS NOT NULL AND TRIM(c.phone) != ''`;
  if (filters.vip_only && hasColumn('customers', 'is_vip')) sql += ' AND IFNULL(c.is_vip,0) = 1';
  if (filters.opted_in_only && hasColumn('customers', 'marketing_opt_out')) sql += ' AND IFNULL(c.marketing_opt_out,0) = 0';
  if (filters.loyalty_only) sql += ' AND EXISTS (SELECT 1 FROM mkt_loyalty_accounts la WHERE la.customer_id = c.id)';
  if (filters.referred_only) sql += ' AND EXISTS (SELECT 1 FROM mkt_referrals_v2 r WHERE r.customer_id = c.id)';
  if (filters.agent_id != null && filters.agent_id !== '') {
    sql += ' AND EXISTS (SELECT 1 FROM mkt_referrals_v2 r WHERE r.customer_id = c.id AND r.agent_id = ?)';
    params.push(intOrNull(filters.agent_id));
  }
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.branch_id = ?)';
    params.push(intOrNull(filters.branch_id));
  }
  if (filters.from) {
    sql += ' AND date(c.created_at) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(c.created_at) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }

  const sortMap = {
    name: 'c.name',
    newest: 'c.created_at DESC',
    spend: 'total_spent DESC',
    orders: 'order_count DESC',
    loyalty: 'loyalty_balance DESC'
  };
  sql += ` ORDER BY ${sortMap[String(filters.sort || 'newest')] || 'c.created_at DESC'} LIMIT ?`;
  params.push(limitOf(filters, 500));

  try {
    return dbAll(sql, params).map(row => ({
      ...row,
      total_spent: money(row.total_spent),
      loyalty_balance: money(row.loyalty_balance),
      marketing_opt_out: Number(row.marketing_opt_out_flag) || 0
    }));
  } catch (_) {
    return [];
  }
}

function listCustomerSegments(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = 'SELECT s.*, b.name AS business_name FROM mkt_customer_segments s LEFT JOIN mkt_businesses b ON b.id = s.business_id WHERE 1=1';
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND s.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (textOrNull(filters.search)) {
    sql += ' AND s.name LIKE ?';
    params.push(`%${filters.search}%`);
  }
  sql += ' ORDER BY s.name LIMIT ?';
  params.push(limitOf(filters, 200));
  try {
    return dbAll(sql, params).map(row => ({
      ...row,
      rules: parseJson(row.rules_json, {}),
      member_count: filters.with_counts ? evaluateSegmentInternal(row.id).count : undefined
    }));
  } catch (_) {
    return [];
  }
}

function saveCustomerSegment(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Segment name is required');

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_customer_segments WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Segment not found');
    dbRun(
      `UPDATE mkt_customer_segments SET business_id=?, name=?, rules_json=?, is_auto=?, updated_at=datetime('now') WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        name,
        data.rules !== undefined || data.rules_json !== undefined
          ? toJsonText(data.rules !== undefined ? data.rules : data.rules_json, '{}')
          : (existing.rules_json || '{}'),
        data.is_auto === undefined ? bool01(existing.is_auto, 1) : bool01(data.is_auto, 1),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_customer_segments WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_segment', 'mkt_customer_segment', existing.id, existing, updated);
    return { ...updated, rules: parseJson(updated.rules_json, {}) };
  }

  const result = dbRun(
    `INSERT INTO mkt_customer_segments (business_id, name, rules_json, is_auto, created_at, updated_at)
     VALUES (?,?,?,?, datetime('now'), datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      name,
      toJsonText(data.rules !== undefined ? data.rules : data.rules_json, '{}'),
      bool01(data.is_auto, 1)
    ]
  );
  const created = fetchInserted('mkt_customer_segments', result);
  platformAudit(admin, 'create_segment', 'mkt_customer_segment', created.id, null, created);
  return { ...created, rules: parseJson(created.rules_json, {}) };
}

/** Runs a segment's rules and returns the matching customer ids. */
function evaluateSegmentInternal(segmentId) {
  const segment = dbGet('SELECT * FROM mkt_customer_segments WHERE id = ?', [segmentId]);
  if (!segment) throw new Error('Segment not found');
  const rules = parseJson(segment.rules_json, {}) || {};

  const activeSales = `IFNULL(s.status,'completed') NOT IN ('voided','void','returned')`;
  let sql = `
    SELECT c.id, c.name, c.phone, c.email,
      (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id = c.id AND ${activeSales}) AS total_spent,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND ${activeSales}) AS order_count,
      (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id AND ${activeSales}) AS last_purchase_at
    FROM customers c WHERE 1=1`;
  const params = [];

  if (rules.has_phone) sql += ` AND c.phone IS NOT NULL AND TRIM(c.phone) != ''`;
  if (rules.has_email) sql += ` AND c.email IS NOT NULL AND TRIM(c.email) != ''`;
  if (rules.is_vip != null && hasColumn('customers', 'is_vip')) {
    sql += ' AND IFNULL(c.is_vip,0) = ?';
    params.push(bool01(rules.is_vip, 0));
  }
  if (rules.opted_in && hasColumn('customers', 'marketing_opt_out')) {
    sql += ' AND IFNULL(c.marketing_opt_out,0) = 0';
  }
  if (rules.created_within_days != null && rules.created_within_days !== '') {
    sql += ` AND date(c.created_at) >= date('now', ?)`;
    params.push(`-${Math.max(0, Math.trunc(num(rules.created_within_days)))} day`);
  }
  if (rules.birthday_month != null && rules.birthday_month !== '' && hasColumn('customers', 'birthday')) {
    sql += ` AND c.birthday IS NOT NULL AND strftime('%m', c.birthday) = ?`;
    params.push(String(rules.birthday_month).padStart(2, '0'));
  }
  if (rules.birthday_this_month && hasColumn('customers', 'birthday')) {
    sql += ` AND c.birthday IS NOT NULL AND strftime('%m', c.birthday) = strftime('%m','now')`;
  }
  if (rules.loyalty_tier) {
    sql += ' AND EXISTS (SELECT 1 FROM mkt_loyalty_accounts la WHERE la.customer_id = c.id AND la.tier = ?)';
    params.push(String(rules.loyalty_tier));
  }
  if (rules.min_loyalty_points != null && rules.min_loyalty_points !== '') {
    sql += ' AND EXISTS (SELECT 1 FROM mkt_loyalty_accounts la WHERE la.customer_id = c.id AND la.points >= ?)';
    params.push(num(rules.min_loyalty_points));
  }
  if (rules.branch_id != null && rules.branch_id !== '') {
    sql += ` AND EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.branch_id = ? AND ${activeSales})`;
    params.push(intOrNull(rules.branch_id));
  }
  if (rules.referred_only) sql += ' AND EXISTS (SELECT 1 FROM mkt_referrals_v2 r WHERE r.customer_id = c.id)';
  if (rules.agent_id != null && rules.agent_id !== '') {
    sql += ' AND EXISTS (SELECT 1 FROM mkt_referrals_v2 r WHERE r.customer_id = c.id AND r.agent_id = ?)';
    params.push(intOrNull(rules.agent_id));
  }
  if (rules.min_spend != null && rules.min_spend !== '') {
    sql += ` AND (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id = c.id AND ${activeSales}) >= ?`;
    params.push(money(rules.min_spend));
  }
  if (rules.max_spend != null && rules.max_spend !== '') {
    sql += ` AND (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id = c.id AND ${activeSales}) <= ?`;
    params.push(money(rules.max_spend));
  }
  if (rules.min_orders != null && rules.min_orders !== '') {
    sql += ` AND (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND ${activeSales}) >= ?`;
    params.push(Math.max(0, Math.trunc(num(rules.min_orders))));
  }
  if (rules.days_since_last_purchase != null && rules.days_since_last_purchase !== '') {
    sql += ` AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND ${activeSales}
               AND date(s.created_at) >= date('now', ?))`;
    params.push(`-${Math.max(0, Math.trunc(num(rules.days_since_last_purchase)))} day`);
  }
  if (rules.purchased_within_days != null && rules.purchased_within_days !== '') {
    sql += ` AND EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND ${activeSales}
               AND date(s.created_at) >= date('now', ?))`;
    params.push(`-${Math.max(0, Math.trunc(num(rules.purchased_within_days)))} day`);
  }

  sql += ' ORDER BY c.name LIMIT ?';
  params.push(Math.min(5000, Math.max(1, Math.trunc(num(rules.limit, 2000)))));

  let rows = [];
  try {
    rows = dbAll(sql, params);
  } catch (_) {
    rows = [];
  }
  return {
    segment_id: segment.id,
    name: segment.name,
    rules,
    count: rows.length,
    customer_ids: rows.map(r => Number(r.id)),
    customers: rows.map(r => ({ ...r, total_spent: money(r.total_spent) }))
  };
}

function evaluateSegment(segmentId, actor) {
  requirePlatformUser(actor);
  return evaluateSegmentInternal(segmentId);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Loyalty
 * ────────────────────────────────────────────────────────────────────────── */

function hydrateLoyaltyRule(row) {
  if (!row) return null;
  return { ...row, tiers: parseJson(row.tier_json, {}) };
}

function listLoyaltyRules(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = 'SELECT r.*, b.name AS business_name FROM mkt_loyalty_rules r LEFT JOIN mkt_businesses b ON b.id = r.business_id WHERE 1=1';
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND r.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (!filters.include_inactive) sql += ' AND IFNULL(r.is_active,1) = 1';
  sql += ' ORDER BY r.name LIMIT ?';
  params.push(limitOf(filters, 100));
  try {
    return dbAll(sql, params).map(hydrateLoyaltyRule);
  } catch (_) {
    return [];
  }
}

function saveLoyaltyRule(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Loyalty rule name is required');

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_loyalty_rules WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Loyalty rule not found');
    dbRun(
      `UPDATE mkt_loyalty_rules SET business_id=?, name=?, rule_type=?, points_per_currency=?, reward_threshold=?,
         reward_description=?, tier_json=?, birthday_reward=?, referral_bonus_points=?, is_active=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        name,
        textOrNull(data.rule_type) || existing.rule_type || 'points',
        data.points_per_currency === undefined ? num(existing.points_per_currency, 1) : num(data.points_per_currency, 1),
        data.reward_threshold === undefined ? num(existing.reward_threshold) : num(data.reward_threshold),
        data.reward_description === undefined ? existing.reward_description : textOrNull(data.reward_description),
        data.tiers !== undefined || data.tier_json !== undefined
          ? toJsonText(data.tiers !== undefined ? data.tiers : data.tier_json, '{}')
          : (existing.tier_json || '{}'),
        data.birthday_reward === undefined ? existing.birthday_reward : textOrNull(data.birthday_reward),
        data.referral_bonus_points === undefined ? num(existing.referral_bonus_points) : num(data.referral_bonus_points),
        data.is_active === undefined ? bool01(existing.is_active, 1) : bool01(data.is_active, 1),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_loyalty_rules WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_loyalty_rule', 'mkt_loyalty_rule', existing.id, existing, updated);
    return hydrateLoyaltyRule(updated);
  }

  const result = dbRun(
    `INSERT INTO mkt_loyalty_rules (business_id, name, rule_type, points_per_currency, reward_threshold, reward_description,
       tier_json, birthday_reward, referral_bonus_points, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      name,
      textOrNull(data.rule_type) || 'points',
      num(data.points_per_currency, 1),
      num(data.reward_threshold),
      textOrNull(data.reward_description),
      toJsonText(data.tiers !== undefined ? data.tiers : data.tier_json, '{}'),
      textOrNull(data.birthday_reward),
      num(data.referral_bonus_points),
      bool01(data.is_active, 1)
    ]
  );
  const created = fetchInserted('mkt_loyalty_rules', result);
  platformAudit(admin, 'create_loyalty_rule', 'mkt_loyalty_rule', created.id, null, created);
  return hydrateLoyaltyRule(created);
}

function ensureLoyaltyAccount(customerId, businessId) {
  const custId = intOrNull(customerId);
  if (!custId) throw new Error('Customer is required');
  const bizId = intOrNull(businessId) ?? defaultBusinessId();
  let account = bizId == null
    ? dbGet('SELECT * FROM mkt_loyalty_accounts WHERE customer_id = ? AND business_id IS NULL', [custId])
    : dbGet('SELECT * FROM mkt_loyalty_accounts WHERE customer_id = ? AND business_id = ?', [custId, bizId]);
  if (account) return account;
  try {
    dbRun(
      `INSERT INTO mkt_loyalty_accounts (customer_id, business_id, points, tier, card_number, updated_at)
       VALUES (?,?,0,'standard',?, datetime('now'))`,
      [custId, bizId, `LY-${String(custId).padStart(6, '0')}`]
    );
  } catch (_) { /* unique race */ }
  account = bizId == null
    ? dbGet('SELECT * FROM mkt_loyalty_accounts WHERE customer_id = ? AND business_id IS NULL', [custId])
    : dbGet('SELECT * FROM mkt_loyalty_accounts WHERE customer_id = ? AND business_id = ?', [custId, bizId]);
  return account || { id: null, customer_id: custId, business_id: bizId, points: 0, tier: 'standard' };
}

function resolveLoyaltyTier(rule, points) {
  const tiers = parseJson(rule && rule.tier_json, {}) || {};
  const entries = Object.entries(tiers)
    .map(([name, threshold]) => ({ name, threshold: num(threshold) }))
    .filter(t => Number.isFinite(t.threshold))
    .sort((a, b) => b.threshold - a.threshold);
  for (const tier of entries) {
    if (num(points) >= tier.threshold) return tier.name;
  }
  return 'standard';
}

function getLoyaltyAccount(customerId, businessId, actor) {
  requirePlatformUser(actor);
  const account = ensureLoyaltyAccount(customerId, businessId);
  const customer = dbGet('SELECT id, name, phone, email FROM customers WHERE id = ?', [account.customer_id]) || null;
  const transactions = account.id
    ? dbAll('SELECT * FROM mkt_loyalty_transactions WHERE account_id = ? ORDER BY id DESC LIMIT 100', [account.id])
    : [];
  const rule = dbGet(
    `SELECT * FROM mkt_loyalty_rules WHERE IFNULL(is_active,1) = 1 AND (business_id = ? OR business_id IS NULL)
     ORDER BY business_id DESC, id LIMIT 1`,
    [account.business_id]
  );
  return {
    ...account,
    points: money(account.points),
    customer,
    rule: hydrateLoyaltyRule(rule),
    next_reward_at: rule ? money(num(rule.reward_threshold)) : 0,
    points_to_reward: rule ? Math.max(0, money(num(rule.reward_threshold) - num(account.points))) : 0,
    transactions
  };
}

function adjustLoyaltyPoints(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const points = num(data.points);
  if (!points) throw new Error('Points adjustment must not be zero');
  const account = ensureLoyaltyAccount(data.customer_id, data.business_id);
  if (!account.id) throw new Error('Could not open a loyalty account for this customer');

  const txnType = textOrNull(data.txn_type) || (points > 0 ? 'adjust_add' : 'adjust_remove');
  const nextPoints = money(num(account.points) + points);
  if (nextPoints < 0 && !data.allow_negative) throw new Error('Insufficient loyalty points');

  const rule = dbGet(
    `SELECT * FROM mkt_loyalty_rules WHERE IFNULL(is_active,1) = 1 AND (business_id = ? OR business_id IS NULL)
     ORDER BY business_id DESC, id LIMIT 1`,
    [account.business_id]
  );
  const tier = resolveLoyaltyTier(rule, nextPoints);

  dbRun(`UPDATE mkt_loyalty_accounts SET points = ?, tier = ?, updated_at = datetime('now') WHERE id = ?`, [nextPoints, tier, account.id]);
  dbRun(
    `INSERT INTO mkt_loyalty_transactions (account_id, txn_type, points, reference_type, reference_id, notes, created_at)
     VALUES (?,?,?,?,?,?, datetime('now'))`,
    [account.id, txnType, points, textOrNull(data.reference_type), intOrNull(data.reference_id), textOrNull(data.notes)]
  );

  try {
    if (hasColumn('customers', 'loyalty_points')) {
      dbRun('UPDATE customers SET loyalty_points = ? WHERE id = ?', [nextPoints, account.customer_id]);
    }
  } catch (_) { /* optional mirror */ }

  platformAudit(admin, 'adjust_loyalty_points', 'mkt_loyalty_account', account.id,
    { points: num(account.points) }, { points: nextPoints, delta: points, tier });

  return getLoyaltyAccount(account.customer_id, account.business_id, actor);
}

/** Internal accrual used by processSaleForMarketing. */
function accrueLoyaltyForSale(sale, businessId) {
  const customerId = intOrNull(sale && sale.customer_id);
  if (!customerId) return { points: 0, account_id: null };
  const bizId = intOrNull(businessId) ?? businessForBranch(sale.branch_id);
  const rule = dbGet(
    `SELECT * FROM mkt_loyalty_rules WHERE IFNULL(is_active,1) = 1 AND (business_id = ? OR business_id IS NULL)
     ORDER BY business_id DESC, id LIMIT 1`,
    [bizId]
  );
  if (!rule) return { points: 0, account_id: null };

  const account = ensureLoyaltyAccount(customerId, bizId);
  if (!account.id) return { points: 0, account_id: null };

  const already = dbGet(
    `SELECT id FROM mkt_loyalty_transactions WHERE account_id = ? AND reference_type = 'sale' AND reference_id = ?`,
    [account.id, sale.id]
  );
  if (already) return { points: 0, account_id: account.id, skipped: 'already_accrued' };

  const points = money(money(sale.total) * num(rule.points_per_currency, 1));
  if (points <= 0) return { points: 0, account_id: account.id };

  const nextPoints = money(num(account.points) + points);
  const tier = resolveLoyaltyTier(rule, nextPoints);
  dbRun(`UPDATE mkt_loyalty_accounts SET points = ?, tier = ?, updated_at = datetime('now') WHERE id = ?`, [nextPoints, tier, account.id]);
  dbRun(
    `INSERT INTO mkt_loyalty_transactions (account_id, txn_type, points, reference_type, reference_id, notes, created_at)
     VALUES (?, 'earn', ?, 'sale', ?, ?, datetime('now'))`,
    [account.id, points, sale.id, `Earned on receipt ${sale.receipt_number || sale.id}`]
  );
  try {
    if (hasColumn('customers', 'loyalty_points')) {
      dbRun('UPDATE customers SET loyalty_points = ? WHERE id = ?', [nextPoints, customerId]);
    }
  } catch (_) { /* optional mirror */ }
  return { points, account_id: account.id, balance: nextPoints, tier };
}

function businessForBranch(branchId) {
  const id = intOrNull(branchId);
  if (id == null) return defaultBusinessId();
  try {
    const row = dbGet('SELECT business_id FROM branches WHERE id = ?', [id]);
    return intOrNull(row && row.business_id) ?? defaultBusinessId();
  } catch (_) {
    return defaultBusinessId();
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Referral agents
 * ────────────────────────────────────────────────────────────────────────── */

function hydrateAgent(row) {
  if (!row) return null;
  return {
    ...row,
    bank: parseJson(row.bank_json, {}),
    documents: parseJson(row.documents_json, []),
    qr: parseJson(row.qr_payload, null)
  };
}

function getAgentByReferralCode(code) {
  const value = textOrNull(code);
  if (!value) return null;
  const trimmed = String(value).trim();
  const upper = trimmed.toUpperCase();
  return dbGet('SELECT * FROM mkt_referral_agents WHERE referral_code = ?', [trimmed])
    || dbGet('SELECT * FROM mkt_referral_agents WHERE UPPER(referral_code) = ?', [upper])
    || dbGet('SELECT * FROM mkt_referral_agents WHERE agent_code = ?', [trimmed])
    || dbGet('SELECT * FROM mkt_referral_agents WHERE UPPER(agent_code) = ?', [upper])
    || null;
}

function recordAgentStatusHistory(agentId, fromStatus, toStatus, reason, actor) {
  try {
    dbRun(
      `INSERT INTO mkt_agent_status_history (agent_id, from_status, to_status, reason, actor_id, actor_name, created_at)
       VALUES (?,?,?,?,?,?, datetime('now'))`,
      [
        agentId,
        textOrNull(fromStatus),
        String(toStatus),
        textOrNull(reason),
        actor && actor.id != null ? Number(actor.id) : null,
        (actor && (actor.full_name || actor.username)) || null
      ]
    );
  } catch (_) { /* history is best-effort */ }
}

/** Public application form — no session required. */
function applyAsReferralAgent(data = {}) {
  ensurePlatformReady();
  let settings = null;
  try {
    settings = dbGet('SELECT public_apply_enabled FROM mkt_settings WHERE id = 1');
  } catch (_) { /* default open */ }
  if (settings && Number(settings.public_apply_enabled) === 0) {
    throw new Error('Referral agent applications are currently closed');
  }

  const fullName = textOrNull(data.full_name || data.name);
  const phone = textOrNull(data.phone);
  if (!fullName) throw new Error('Full name is required');
  if (!phone) throw new Error('Phone number is required');

  const duplicate = dbGet(
    `SELECT id, status FROM mkt_referral_agents WHERE phone = ? AND status IN ('pending','active') ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  if (duplicate) {
    throw new Error(duplicate.status === 'active'
      ? 'This phone number is already registered as an active referral agent'
      : 'An application with this phone number is already awaiting review');
  }

  const result = dbRun(
    `INSERT INTO mkt_referral_agents (agent_code, user_id, business_id, branch_id, full_name, phone, email, id_number, address,
       bank_json, documents_json, tier, status, application_date, notes, created_at, updated_at)
     VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?,?, datetime('now'), datetime('now'))`,
    [
      intOrNull(data.user_id),
      intOrNull(data.business_id) ?? defaultBusinessId(),
      intOrNull(data.branch_id),
      fullName,
      phone,
      textOrNull(data.email),
      textOrNull(data.id_number),
      textOrNull(data.address),
      toJsonText(data.bank !== undefined ? data.bank : data.bank_json, '{}'),
      toJsonText(data.documents !== undefined ? data.documents : data.documents_json, '[]'),
      textOrNull(data.tier) || 'standard',
      today(),
      textOrNull(data.notes)
    ]
  );
  const created = fetchInserted('mkt_referral_agents', result);
  recordAgentStatusHistory(created.id, null, 'pending', 'Application submitted', { id: null, full_name: fullName });
  notifyAdmins('New referral agent application', `${fullName} (${phone}) applied to become a referral agent`, 'agent_application', 'referral_agent', created.id);
  platformAudit({ id: null, full_name: fullName }, 'apply_referral_agent', 'mkt_referral_agent', created.id, null, { full_name: fullName, phone });

  return {
    id: created.id,
    status: created.status,
    full_name: created.full_name,
    application_date: created.application_date,
    message: 'Application received. You will be notified once it has been reviewed.'
  };
}

function listReferralAgents(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT a.*, w.pending AS wallet_pending, w.approved AS wallet_approved, w.payable AS wallet_payable,
      w.paid AS wallet_paid, w.reversed AS wallet_reversed, w.lifetime AS wallet_lifetime,
      b.name AS business_name, br.name AS branch_name, u.username AS user_username,
      (SELECT COUNT(*) FROM mkt_referrals_v2 r WHERE r.agent_id = a.id) AS referral_count,
      (SELECT COUNT(*) FROM mkt_referrals_v2 r WHERE r.agent_id = a.id AND r.status = 'converted') AS conversion_count,
      (SELECT COUNT(*) FROM mkt_referral_clicks k WHERE k.agent_id = a.id) AS click_count,
      (SELECT COUNT(*) FROM mkt_commissions m WHERE m.agent_id = a.id) AS commission_count,
      (SELECT COALESCE(SUM(m.sale_amount),0) FROM mkt_commissions m
         WHERE m.agent_id = a.id AND m.status NOT IN ('reversed','cancelled')) AS attributed_revenue
    FROM mkt_referral_agents a
    LEFT JOIN mkt_agent_wallets w ON w.agent_id = a.id
    LEFT JOIN mkt_businesses b ON b.id = a.business_id
    LEFT JOIN branches br ON br.id = a.branch_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE 1=1`;
  const params = [];
  if (textOrNull(filters.status)) {
    sql += ' AND a.status = ?';
    params.push(String(filters.status));
  }
  if (Array.isArray(filters.status_in) && filters.status_in.length) {
    sql += ` AND a.status IN (${filters.status_in.map(() => '?').join(',')})`;
    params.push(...filters.status_in.map(String));
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND a.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND a.branch_id = ?';
    params.push(intOrNull(filters.branch_id));
  }
  if (textOrNull(filters.tier)) {
    sql += ' AND a.tier = ?';
    params.push(String(filters.tier));
  }
  if (textOrNull(filters.search)) {
    sql += ` AND (a.full_name LIKE ? OR IFNULL(a.phone,'') LIKE ? OR IFNULL(a.agent_code,'') LIKE ? OR IFNULL(a.referral_code,'') LIKE ?)`;
    const like = `%${filters.search}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY CASE a.status WHEN \'pending\' THEN 0 WHEN \'active\' THEN 1 ELSE 2 END, a.full_name LIMIT ?';
  params.push(limitOf(filters, 300));

  try {
    return dbAll(sql, params).map(row => ({
      ...hydrateAgent(row),
      wallet: {
        pending: money(row.wallet_pending),
        approved: money(row.wallet_approved),
        payable: money(row.wallet_payable),
        paid: money(row.wallet_paid),
        reversed: money(row.wallet_reversed),
        lifetime: money(row.wallet_lifetime)
      },
      attributed_revenue: money(row.attributed_revenue),
      conversion_rate: pct(row.conversion_count, row.referral_count)
    }));
  } catch (_) {
    return [];
  }
}

function getReferralAgent(id, actor) {
  requirePlatformUser(actor);
  const row = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [id]);
  if (!row) return null;
  const agent = hydrateAgent(row);
  agent.wallet = ensureAgentWallet(row.id);
  agent.business = row.business_id ? dbGet('SELECT id, name, code FROM mkt_businesses WHERE id = ?', [row.business_id]) || null : null;
  agent.branch = row.branch_id ? dbGet('SELECT id, name, code FROM branches WHERE id = ?', [row.branch_id]) || null : null;
  agent.commission_rule = row.commission_rule_id
    ? dbGet('SELECT * FROM mkt_commission_rules WHERE id = ?', [row.commission_rule_id])
    : ensureDefaultCommissionRule(row.business_id);
  agent.status_history = dbAll('SELECT * FROM mkt_agent_status_history WHERE agent_id = ? ORDER BY id DESC LIMIT 100', [row.id]);
  agent.referrals = dbAll(
    `SELECT r.*, c.name AS customer_name FROM mkt_referrals_v2 r
     LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.agent_id = ? ORDER BY r.id DESC LIMIT 200`,
    [row.id]
  );
  agent.commissions = dbAll('SELECT * FROM mkt_commissions WHERE agent_id = ? ORDER BY id DESC LIMIT 200', [row.id])
    .map(c => ({ ...c, sale_amount: money(c.sale_amount), commission_amount: money(c.commission_amount) }));
  agent.payments = dbAll('SELECT * FROM mkt_agent_payments WHERE agent_id = ? ORDER BY id DESC LIMIT 100', [row.id]);
  agent.contracts = dbAll('SELECT * FROM mkt_agent_contracts WHERE agent_id = ? ORDER BY id DESC LIMIT 50', [row.id]);
  agent.qr_codes = dbAll(`SELECT * FROM mkt_qr_codes WHERE entity_type = 'referral_agent' AND entity_id = ?`, [row.id]);
  agent.clicks = scalar('SELECT COUNT(*) AS v FROM mkt_referral_clicks WHERE agent_id = ?', [row.id]);
  agent.performance = agentStats(row, monthStart(), today());
  return agent;
}

function ensureAgentWallet(agentId) {
  const id = intOrNull(agentId);
  if (!id) throw new Error('Agent is required');
  let wallet = dbGet('SELECT * FROM mkt_agent_wallets WHERE agent_id = ?', [id]);
  if (!wallet) {
    try {
      dbRun(
        `INSERT INTO mkt_agent_wallets (agent_id, pending, approved, payable, paid, reversed, lifetime, updated_at)
         VALUES (?,0,0,0,0,0,0, datetime('now'))`,
        [id]
      );
    } catch (_) { /* already exists */ }
    wallet = dbGet('SELECT * FROM mkt_agent_wallets WHERE agent_id = ?', [id]);
  }
  return wallet || { agent_id: id, pending: 0, approved: 0, payable: 0, paid: 0, reversed: 0, lifetime: 0 };
}

function approveReferralAgent(id, data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const existing = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [id]);
  if (!existing) throw new Error('Referral agent not found');

  const agentCode = textOrNull(existing.agent_code) || generateAgentCode();
  const referralCode = textOrNull(existing.referral_code) || generateUniqueReferralCode(existing.full_name);
  const referralLink = buildReferralLink(referralCode);
  const qrPayload = JSON.stringify({
    type: 'referral_agent',
    agent_id: existing.id,
    agent_code: agentCode,
    referral_code: referralCode,
    link: referralLink
  });
  const business = intOrNull(data.business_id) ?? existing.business_id ?? defaultBusinessId();
  const rule = intOrNull(data.commission_rule_id)
    ?? existing.commission_rule_id
    ?? (ensureDefaultCommissionRule(business) || {}).id
    ?? null;

  dbRun(
    `UPDATE mkt_referral_agents SET agent_code=?, referral_code=?, referral_link=?, qr_payload=?, business_id=?, branch_id=?,
       tier=?, status='active', commission_rule_id=?, approved_at=datetime('now'), approved_by=?, suspended_at=NULL,
       terminated_at=NULL, termination_reason=NULL, updated_at=datetime('now')
     WHERE id=?`,
    [
      agentCode,
      referralCode,
      referralLink,
      qrPayload,
      business,
      data.branch_id === undefined ? existing.branch_id : intOrNull(data.branch_id),
      textOrNull(data.tier) || existing.tier || 'standard',
      rule,
      admin.id,
      existing.id
    ]
  );

  ensureAgentWallet(existing.id);
  recordAgentStatusHistory(existing.id, existing.status, 'active', textOrNull(data.reason) || 'Application approved', admin);

  try {
    const qrExists = dbGet(`SELECT id FROM mkt_qr_codes WHERE entity_type = 'referral_agent' AND entity_id = ?`, [existing.id]);
    if (!qrExists) {
      dbRun(
        `INSERT INTO mkt_qr_codes (business_id, branch_id, entity_type, entity_id, label, payload, scan_count, is_active, created_at)
         VALUES (?,?,?,?,?,?,0,1, datetime('now'))`,
        [business, existing.branch_id, 'referral_agent', existing.id, `${existing.full_name} referral QR`, qrPayload]
      );
    }
  } catch (_) { /* optional */ }

  const updated = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [existing.id]);
  notifyAgent(updated, 'Referral agent approved',
    `Welcome aboard! Your referral code is ${referralCode}. Share ${referralLink} to start earning.`,
    'agent_status', 'referral_agent', updated.id);
  notifyAdmins('Referral agent approved', `${updated.full_name} is now active (${agentCode})`, 'agent_status', 'referral_agent', updated.id);
  platformAudit(admin, 'approve_referral_agent', 'mkt_referral_agent', updated.id, existing, updated);

  // Ensure agent can open the Marketing Agent app (create/link a login user).
  let loginCreds = null;
  try {
    if (!updated.user_id) {
      loginCreds = ensureAgentLoginUser(updated, admin);
    }
  } catch (err) {
    console.warn('[mktp] ensureAgentLoginUser:', err.message || err);
  }

  const hydrated = hydrateAgent(dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [existing.id]));
  if (loginCreds?._temp_username) {
    hydrated.temp_username = loginCreds._temp_username;
    hydrated.temp_password = loginCreds._temp_password;
    hydrated.login_created = true;
  }
  return hydrated;
}

function linkAgentUser(agentId, userId, actor) {
  const admin = requireMktAdmin(actor);
  const agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [agentId]);
  if (!agent) throw new Error('Referral agent not found');
  const uid = intOrNull(userId);
  if (uid == null) throw new Error('User id is required');
  const user = dbGet('SELECT id, username, full_name, role FROM users WHERE id = ?', [uid]);
  if (!user) throw new Error('User not found');

  dbRun(
    `UPDATE mkt_referral_agents SET user_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [uid, agent.id]
  );
  try {
    dbRun(`UPDATE users SET role = 'marketing_agent' WHERE id = ? AND role NOT IN ('owner','manager')`, [uid]);
  } catch (_) { /* role column constraints */ }

  const updated = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [agent.id]);
  platformAudit(admin, 'link_agent_user', 'mkt_referral_agent', agent.id,
    { user_id: agent.user_id }, { user_id: uid, username: user.username });
  notifyAgent(updated, 'Account linked',
    `Your login (${user.username}) is linked. Open Marketing Agent to track referrals and earnings.`,
    'agent_status', 'referral_agent', updated.id);
  return hydrateAgent(updated);
}

/** Create a marketing_agent login for an approved agent when none exists. */
function ensureAgentLoginUser(agent, actor) {
  if (!agent?.id) return null;
  if (agent.user_id) return linkAgentUser(agent.id, agent.user_id, actor);

  const bcrypt = require('bcryptjs');
  const base = String(agent.agent_code || agent.phone || agent.full_name || 'agent')
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'agent';
  let username = base;
  let n = 1;
  while (dbGet('SELECT id FROM users WHERE username = ?', [username])) {
    username = `${base}${n++}`;
  }
  const tempPin = String(1000 + Math.floor(Math.random() * 9000));
  const password = `Agent@${tempPin}`;
  const hash = bcrypt.hashSync(password, 10);
  let pinHash = null;
  try {
    const { hashPin } = require('./pin');
    pinHash = hashPin(tempPin);
  } catch (_) { /* optional */ }

  const result = dbRun(
    `INSERT INTO users (username, password_hash, pin, full_name, role, is_active, permissions, branch_id)
     VALUES (?,?,?,?, 'marketing_agent', 1, '[]', ?)`,
    [username, hash, pinHash, agent.full_name || username, agent.branch_id || null]
  );
  const userId = Number(result.lastInsertRowid) || intOrNull(dbGet('SELECT MAX(id) AS id FROM users')?.id);
  const linked = linkAgentUser(agent.id, userId, actor);
  notifyAgent(linked, 'Login created',
    `Username: ${username}. Temporary password: ${password}. Change it after first login.`,
    'agent_status', 'referral_agent', agent.id);
  notifyAdmins('Agent login created',
    `${agent.full_name}: username ${username} (temp password shared to agent notifications)`,
    'agent_status', 'referral_agent', agent.id);
  return { ...linked, _temp_username: username, _temp_password: password };
}

/** Admin action: create or recreate login credentials for an agent by id. */
function ensureAgentLoginById(agentId, actor) {
  const admin = requireMktAdmin(actor);
  const agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [intOrNull(agentId)]);
  if (!agent) throw new Error('Referral agent not found');
  if (String(agent.status || '').toLowerCase() !== 'active') {
    throw new Error('Approve the agent before creating a portal login');
  }
  if (agent.user_id) {
    // Reset password for existing linked user
    const bcrypt = require('bcryptjs');
    const user = dbGet('SELECT id, username FROM users WHERE id = ?', [agent.user_id]);
    if (!user) {
      dbRun(`UPDATE mkt_referral_agents SET user_id = NULL WHERE id = ?`, [agent.id]);
      return ensureAgentLoginUser({ ...agent, user_id: null }, admin);
    }
    const tempPin = String(1000 + Math.floor(Math.random() * 9000));
    const password = `Agent@${tempPin}`;
    const hash = bcrypt.hashSync(password, 10);
    dbRun(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [hash, user.id]);
    notifyAgent(agent, 'Password reset',
      `Username: ${user.username}. New temporary password: ${password}`,
      'agent_status', 'referral_agent', agent.id);
    return {
      ...hydrateAgent(dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [agent.id])),
      _temp_username: user.username,
      _temp_password: password,
      password_reset: true
    };
  }
  return ensureAgentLoginUser(agent, admin);
}

function reverseCommissionsForSale(saleId, actor, notes) {
  const sid = intOrNull(saleId);
  if (sid == null) return { reversed: 0 };
  const rows = dbAll(
    `SELECT id, status FROM mkt_commissions
     WHERE sale_id = ? AND LOWER(IFNULL(status,'')) NOT IN ('reversed','cancelled')`,
    [sid]
  );
  let count = 0;
  const systemActor = actor || { id: null, full_name: 'system', role: 'owner' };
  for (const row of rows) {
    try {
      setCommissionStatus(row.id, 'reversed', systemActor, notes || 'Sale refunded or voided');
      count += 1;
    } catch (err) {
      console.warn('[mktp] reverse commission', row.id, err.message || err);
    }
  }
  return { reversed: count, sale_id: sid };
}

function setReferralAgentStatus(id, status, reason, actor) {
  const admin = requireMktAdmin(actor);
  const existing = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [id]);
  if (!existing) throw new Error('Referral agent not found');

  const requested = String(status || '').toLowerCase();
  const actionMap = {
    approve: 'active',
    approved: 'active',
    activate: 'active',
    reactivate: 'active',
    active: 'active',
    reject: 'rejected',
    rejected: 'rejected',
    suspend: 'suspended',
    suspended: 'suspended',
    terminate: 'terminated',
    terminated: 'terminated',
    pending: 'pending'
  };
  const next = actionMap[requested];
  if (!next || !AGENT_STATUSES.includes(next)) throw new Error(`Invalid referral agent status: ${status}`);

  if (next === 'active') {
    return approveReferralAgent(id, { reason }, actor);
  }

  const fields = {
    suspended: `status='suspended', suspended_at=datetime('now')`,
    terminated: `status='terminated', terminated_at=datetime('now'), termination_reason=?`,
    rejected: `status='rejected'`,
    pending: `status='pending'`
  };
  if (next === 'terminated') {
    dbRun(`UPDATE mkt_referral_agents SET ${fields.terminated}, updated_at=datetime('now') WHERE id=?`, [textOrNull(reason), id]);
  } else {
    dbRun(`UPDATE mkt_referral_agents SET ${fields[next]}, updated_at=datetime('now') WHERE id=?`, [id]);
  }

  recordAgentStatusHistory(existing.id, existing.status, next, reason, admin);
  const updated = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [id]);

  const messages = {
    rejected: 'Your referral agent application was not approved.',
    suspended: 'Your referral agent account has been suspended.',
    terminated: 'Your referral agent agreement has been terminated.',
    pending: 'Your referral agent account has been moved back to pending review.'
  };
  notifyAgent(updated, `Referral agent ${next}`, `${messages[next] || ''}${reason ? ` Reason: ${reason}` : ''}`.trim(),
    'agent_status', 'referral_agent', updated.id);
  platformAudit(admin, 'set_referral_agent_status', 'mkt_referral_agent', id,
    { status: existing.status }, { status: next, reason: textOrNull(reason) });

  return hydrateAgent(updated);
}

/** Public-facing referral landing profile. */
function getAgentPublicProfile(code) {
  if (!ensurePlatformReady()) {
    throw new Error('Referral system is not ready. Please try again shortly.');
  }
  const agent = getAgentByReferralCode(code);
  if (!agent) {
    throw new Error('Referral code not recognised');
  }
  if (String(agent.status) === 'pending') {
    throw new Error('This referral agent is awaiting admin approval');
  }
  if (String(agent.status) !== 'active') {
    throw new Error('Referral code not recognised');
  }
  const business = agent.business_id
    ? dbGet('SELECT name, logo_path, contact_phone, whatsapp_number, address, social_json FROM mkt_businesses WHERE id = ?', [agent.business_id])
    : null;
  const bizId = intOrNull(agent.business_id);
  const campaigns = bizId
    ? dbAll(
      `SELECT id, name, description, start_date, end_date FROM mkt_campaigns_v2
       WHERE status = 'active' AND business_id = ? ORDER BY id DESC LIMIT 10`,
      [bizId]
    )
    : dbAll(
      `SELECT id, name, description, start_date, end_date FROM mkt_campaigns_v2
       WHERE status = 'active' ORDER BY id DESC LIMIT 10`
    );
  const promotions = bizId
    ? dbAll(
      `SELECT id, name, promo_type, discount_value, start_date, end_date FROM mkt_promotions
       WHERE status = 'active' AND business_id = ?
         AND (end_date IS NULL OR date(end_date) >= date('now')) ORDER BY id DESC LIMIT 10`,
      [bizId]
    )
    : dbAll(
      `SELECT id, name, promo_type, discount_value, start_date, end_date FROM mkt_promotions
       WHERE status = 'active'
         AND (end_date IS NULL OR date(end_date) >= date('now')) ORDER BY id DESC LIMIT 10`
    );
  return {
    agent_code: agent.agent_code,
    full_name: agent.full_name,
    tier: agent.tier,
    referral_code: agent.referral_code,
    referral_link: agent.referral_link || buildReferralLink(agent.referral_code),
    qr: parseJson(agent.qr_payload, null),
    business: business ? { ...business, social: parseJson(business.social_json, {}) } : null,
    campaigns,
    promotions
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Referrals, clicks & attribution
 * ────────────────────────────────────────────────────────────────────────── */

function recordReferralClick(code, meta = {}) {
  ensurePlatformReady();
  const value = textOrNull(code);
  if (!value) throw new Error('Referral code is required');
  const agent = getAgentByReferralCode(value);
  try {
    dbRun(
      `INSERT INTO mkt_referral_clicks (agent_id, referral_code, campaign_id, source, ip_hash, user_agent, created_at)
       VALUES (?,?,?,?,?,?, datetime('now'))`,
      [
        agent ? agent.id : null,
        value,
        intOrNull(meta.campaign_id),
        textOrNull(meta.source) || 'link',
        hashText(meta.ip || meta.ip_address),
        textOrNull(meta.user_agent)
      ]
    );
  } catch (_) { /* click tracking is best-effort */ }

  if (!agent) return { ok: false, recognised: false, message: 'Referral code not recognised' };
  return {
    ok: true,
    recognised: true,
    agent_id: agent.id,
    agent_name: agent.full_name,
    agent_status: agent.status,
    referral_code: agent.referral_code,
    referral_link: agent.referral_link || buildReferralLink(agent.referral_code)
  };
}

function attributeReferral(data = {}, actor) {
  ensurePlatformReady();
  const code = textOrNull(data.code || data.referral_code);
  let agent = code ? getAgentByReferralCode(code) : null;
  if (!agent && data.agent_id != null) {
    agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [intOrNull(data.agent_id)]);
  }
  if (!agent) throw new Error('Referral code not recognised');
  if (String(agent.status) !== 'active') throw new Error('This referral agent is not active');

  const customerId = intOrNull(data.customer_id);
  if (customerId) {
    const existing = dbGet(
      'SELECT * FROM mkt_referrals_v2 WHERE customer_id = ? ORDER BY id LIMIT 1',
      [customerId]
    );
    if (existing) {
      if (Number(existing.agent_id) !== Number(agent.id)) {
        return { ...existing, already_attributed: true, message: 'Customer is already attributed to another agent' };
      }
      return { ...existing, already_attributed: true };
    }
  }

  const branchId = intOrNull(data.branch_id) ?? agent.branch_id ?? null;
  const businessId = intOrNull(data.business_id) ?? agent.business_id ?? businessForBranch(branchId);

  const result = dbRun(
    `INSERT INTO mkt_referrals_v2 (agent_id, customer_id, marketing_customer_id, campaign_id, business_id, branch_id,
       referral_code, attribution_method, status, registered_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'registered', datetime('now'), datetime('now'), datetime('now'))`,
    [
      agent.id,
      customerId,
      intOrNull(data.marketing_customer_id),
      intOrNull(data.campaign_id),
      businessId,
      branchId,
      agent.referral_code || code,
      textOrNull(data.method || data.attribution_method) || 'manual'
    ]
  );
  const referral = fetchInserted('mkt_referrals_v2', result);

  if (customerId) {
    try {
      if (hasColumn('customers', 'referral_code')) {
        dbRun('UPDATE customers SET referral_code = ? WHERE id = ? AND (referral_code IS NULL OR referral_code = \'\')',
          [agent.referral_code || code, customerId]);
      }
      if (hasColumn('customers', 'referral_agent_id')) {
        dbRun('UPDATE customers SET referral_agent_id = ? WHERE id = ? AND referral_agent_id IS NULL', [agent.id, customerId]);
      }
    } catch (_) { /* soft link */ }
  }

  notifyAgent(agent, 'New referral registered',
    `A new customer signed up with your code ${agent.referral_code}`, 'referral', 'referral', referral.id);
  platformAudit(actor, 'attribute_referral', 'mkt_referral', referral.id, null, referral);

  return referral;
}

/**
 * Processes a completed sale: attributes it to a referral agent, raises the
 * commission, updates the agent wallet and accrues loyalty points.
 * Safe to call repeatedly — commissions are unique per sale + agent.
 */
function processSaleForMarketing(saleId, actor) {
  const ready = ensurePlatformReady();
  const result = {
    sale_id: intOrNull(saleId),
    matched: false,
    referral_code: null,
    agent_id: null,
    referral_id: null,
    commission_id: null,
    commission_amount: 0,
    loyalty_points: 0,
    notes: []
  };
  if (!ready) {
    result.notes.push('Marketing platform tables are not available yet');
    return result;
  }

  let sale = null;
  try {
    sale = dbGet('SELECT * FROM sales WHERE id = ?', [saleId]);
  } catch (_) {
    result.notes.push('Sales table unavailable');
    return result;
  }
  if (!sale) {
    result.notes.push('Sale not found');
    return result;
  }
  if (['voided', 'void', 'returned'].includes(String(sale.status || '').toLowerCase())) {
    result.notes.push('Sale is voided or returned — skipped');
    return result;
  }

  const businessId = businessForBranch(sale.branch_id);

  try {
    const loyalty = accrueLoyaltyForSale(sale, businessId);
    result.loyalty_points = money(loyalty.points);
    result.loyalty_account_id = loyalty.account_id || null;
    if (loyalty.skipped) result.notes.push(`Loyalty: ${loyalty.skipped}`);
  } catch (err) {
    result.notes.push(`Loyalty accrual skipped: ${err.message}`);
  }

  let agent = null;
  let code = null;
  if (hasColumn('sales', 'referral_code') && textOrNull(sale.referral_code)) {
    code = textOrNull(sale.referral_code);
    agent = getAgentByReferralCode(code);
  }
  if (!agent && hasColumn('sales', 'marketing_agent_id') && sale.marketing_agent_id) {
    agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [intOrNull(sale.marketing_agent_id)]);
  }

  let referral = null;
  if (!agent && sale.customer_id) {
    referral = dbGet('SELECT * FROM mkt_referrals_v2 WHERE customer_id = ? ORDER BY id LIMIT 1', [sale.customer_id]);
    if (referral) agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [referral.agent_id]);
    if (!agent && hasColumn('customers', 'referral_code')) {
      const customer = dbGet('SELECT referral_code FROM customers WHERE id = ?', [sale.customer_id]);
      if (customer && textOrNull(customer.referral_code)) {
        code = textOrNull(customer.referral_code);
        agent = getAgentByReferralCode(code);
      }
    }
  }

  if (!agent) {
    result.notes.push('No referral attribution found for this sale');
    return result;
  }
  if (String(agent.status) !== 'active') {
    result.notes.push(`Referral agent is ${agent.status} — no commission raised`);
    return result;
  }

  result.matched = true;
  result.agent_id = agent.id;
  result.referral_code = agent.referral_code || code;

  const saleAmount = money(sale.total);
  const branchId = intOrNull(sale.branch_id);

  if (!referral && sale.customer_id) {
    referral = dbGet('SELECT * FROM mkt_referrals_v2 WHERE agent_id = ? AND customer_id = ? ORDER BY id LIMIT 1', [agent.id, sale.customer_id]);
  }
  if (!referral) {
    const inserted = dbRun(
      `INSERT INTO mkt_referrals_v2 (agent_id, customer_id, campaign_id, business_id, branch_id, referral_code,
         attribution_method, status, registered_at, first_order_id, first_order_total, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'sale', 'converted', datetime('now'), ?, ?, datetime('now'), datetime('now'))`,
      [agent.id, intOrNull(sale.customer_id), null, businessId, branchId, agent.referral_code || code, sale.id, saleAmount]
    );
    referral = fetchInserted('mkt_referrals_v2', inserted);
  } else if (!referral.first_order_id) {
    dbRun(
      `UPDATE mkt_referrals_v2 SET status = 'converted', first_order_id = ?, first_order_total = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [sale.id, saleAmount, referral.id]
    );
    referral = dbGet('SELECT * FROM mkt_referrals_v2 WHERE id = ?', [referral.id]);
  }
  result.referral_id = referral ? referral.id : null;

  const existingCommission = dbGet('SELECT * FROM mkt_commissions WHERE sale_id = ? AND agent_id = ?', [sale.id, agent.id]);
  if (existingCommission) {
    result.commission_id = existingCommission.id;
    result.commission_amount = money(existingCommission.commission_amount);
    result.notes.push('Commission already recorded for this sale');
    return result;
  }

  const campaignId = intOrNull(referral && referral.campaign_id)
    ?? (hasColumn('sales', 'mkt_campaign_id') ? intOrNull(sale.mkt_campaign_id) : null)
    ?? activeCampaignId(businessId, branchId);
  const campaign = campaignId ? dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [campaignId]) : null;
  const { rule, overrides } = resolveCommissionContext(agent, campaign);
  const computed = computeCommissionAmount(rule, saleAmount, sale.id, overrides);

  if (computed.commission_amount <= 0) {
    result.notes.push('Commission rule produced a zero amount — nothing recorded');
    return result;
  }

  let autoApprove = 0;
  try {
    const settings = dbGet('SELECT auto_approve_commissions FROM mkt_settings WHERE id = 1');
    autoApprove = Number(settings && settings.auto_approve_commissions) === 1 ? 1 : 0;
  } catch (_) { /* default manual */ }
  const status = autoApprove ? 'approved' : 'pending';

  const inserted = dbRun(
    `INSERT INTO mkt_commissions (agent_id, referral_id, order_id, sale_id, campaign_id, business_id, branch_id, sale_amount,
       rate, commission_amount, rule_id, status, notes, approved_at, approved_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      agent.id,
      referral ? referral.id : null,
      sale.id,
      sale.id,
      campaign ? campaign.id : null,
      businessId,
      branchId,
      saleAmount,
      computed.rate,
      computed.commission_amount,
      rule ? rule.id : null,
      status,
      `Receipt ${sale.receipt_number || sale.id}`,
      autoApprove ? nowIso() : null,
      autoApprove && actor && actor.id != null ? Number(actor.id) : null
    ]
  );
  const commission = fetchInserted('mkt_commissions', inserted);
  result.commission_id = commission.id;
  result.commission_amount = money(commission.commission_amount);
  result.campaign_id = campaign ? campaign.id : null;

  writeCommissionLedger(commission, 'created', null, status, money(commission.commission_amount), actor, 'Raised from sale');
  recalculateWallet(agent.id);

  notifyAgent(agent, 'Commission earned',
    `You earned ${money(commission.commission_amount)} on receipt ${sale.receipt_number || sale.id}`,
    'commission', 'commission', commission.id);
  if (!autoApprove) {
    notifyAdmins('Commission awaiting approval',
      `${agent.full_name} earned ${money(commission.commission_amount)} on receipt ${sale.receipt_number || sale.id}`,
      'commission', 'commission', commission.id);
  }
  platformAudit(actor, 'process_sale_marketing', 'sale', sale.id, null, {
    agent_id: agent.id,
    commission_id: commission.id,
    commission_amount: money(commission.commission_amount)
  });

  return result;
}

function activeCampaignId(businessId, branchId) {
  try {
    const row = dbGet(
      `SELECT id FROM mkt_campaigns_v2
       WHERE status = 'active'
         AND (business_id = ? OR business_id IS NULL)
         AND (branch_id IS NULL OR branch_id = ?)
         AND (start_date IS NULL OR date(start_date) <= date('now'))
         AND (end_date IS NULL OR date(end_date) >= date('now'))
       ORDER BY branch_id DESC, id DESC LIMIT 1`,
      [intOrNull(businessId), intOrNull(branchId)]
    );
    return row ? Number(row.id) : null;
  } catch (_) {
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Commission rules & calculation
 * ────────────────────────────────────────────────────────────────────────── */

function listCommissionRules(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = 'SELECT * FROM mkt_commission_rules WHERE 1=1';
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (!filters.include_inactive) sql += ' AND IFNULL(is_active,1) = 1';
  sql += ' ORDER BY is_default DESC, name LIMIT ?';
  params.push(limitOf(filters, 200));
  try {
    return dbAll(sql, params).map(row => ({ ...row, product_rates: parseJson(row.product_rates_json, {}) }));
  } catch (_) {
    return [];
  }
}

function saveCommissionRule(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Commission rule name is required');

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_commission_rules WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Commission rule not found');
    dbRun(
      `UPDATE mkt_commission_rules SET business_id=?, name=?, rule_type=?, percent_rate=?, fixed_amount=?, product_rates_json=?,
         campaign_id=?, agent_tier=?, is_default=?, is_active=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        name,
        textOrNull(data.rule_type) || existing.rule_type || 'percent',
        data.percent_rate === undefined ? num(existing.percent_rate) : num(data.percent_rate),
        data.fixed_amount === undefined ? num(existing.fixed_amount) : money(data.fixed_amount),
        data.product_rates !== undefined || data.product_rates_json !== undefined
          ? toJsonText(data.product_rates !== undefined ? data.product_rates : data.product_rates_json, '{}')
          : (existing.product_rates_json || '{}'),
        data.campaign_id === undefined ? existing.campaign_id : intOrNull(data.campaign_id),
        data.agent_tier === undefined ? existing.agent_tier : textOrNull(data.agent_tier),
        data.is_default === undefined ? bool01(existing.is_default, 0) : bool01(data.is_default, 0),
        data.is_active === undefined ? bool01(existing.is_active, 1) : bool01(data.is_active, 1),
        existing.id
      ]
    );
    if (bool01(data.is_default, bool01(existing.is_default, 0))) {
      dbRun('UPDATE mkt_commission_rules SET is_default = 0 WHERE id != ?', [existing.id]);
    }
    const updated = dbGet('SELECT * FROM mkt_commission_rules WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_commission_rule', 'mkt_commission_rule', existing.id, existing, updated);
    return { ...updated, product_rates: parseJson(updated.product_rates_json, {}) };
  }

  const result = dbRun(
    `INSERT INTO mkt_commission_rules (business_id, name, rule_type, percent_rate, fixed_amount, product_rates_json, campaign_id,
       agent_tier, is_default, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      name,
      textOrNull(data.rule_type) || 'percent',
      num(data.percent_rate, 5),
      money(data.fixed_amount),
      toJsonText(data.product_rates !== undefined ? data.product_rates : data.product_rates_json, '{}'),
      intOrNull(data.campaign_id),
      textOrNull(data.agent_tier),
      bool01(data.is_default, 0),
      bool01(data.is_active, 1)
    ]
  );
  const created = fetchInserted('mkt_commission_rules', result);
  if (bool01(data.is_default, 0)) {
    dbRun('UPDATE mkt_commission_rules SET is_default = 0 WHERE id != ?', [created.id]);
  }
  platformAudit(admin, 'create_commission_rule', 'mkt_commission_rule', created.id, null, created);
  return { ...created, product_rates: parseJson(created.product_rates_json, {}) };
}

function resolveCommissionContext(agent, campaign) {
  let rule = null;
  if (campaign && campaign.commission_rule_id) {
    rule = dbGet('SELECT * FROM mkt_commission_rules WHERE id = ?', [campaign.commission_rule_id]);
  }
  if (!rule && campaign && campaign.id) {
    rule = dbGet(`SELECT * FROM mkt_commission_rules WHERE campaign_id = ? AND IFNULL(is_active,1) = 1 ORDER BY id LIMIT 1`, [campaign.id]);
  }
  if (!rule && agent && agent.commission_rule_id) {
    rule = dbGet('SELECT * FROM mkt_commission_rules WHERE id = ?', [agent.commission_rule_id]);
  }
  if (!rule && agent && agent.tier) {
    rule = dbGet(
      `SELECT * FROM mkt_commission_rules WHERE agent_tier = ? AND IFNULL(is_active,1) = 1 ORDER BY is_default DESC, id LIMIT 1`,
      [agent.tier]
    );
  }
  if (!rule) {
    rule = ensureDefaultCommissionRule((agent && agent.business_id) || (campaign && campaign.business_id) || null);
  }

  const overrides = {};
  const hasRate = campaign && campaign.commission_rate != null && campaign.commission_rate !== '';
  const hasFixed = campaign && campaign.commission_fixed != null && campaign.commission_fixed !== '' && num(campaign.commission_fixed) > 0;
  if (hasRate) overrides.percent_rate = num(campaign.commission_rate);
  if (hasFixed) overrides.fixed_amount = money(campaign.commission_fixed);
  if (hasRate && hasFixed) overrides.rule_type = 'hybrid';
  else if (hasRate) overrides.rule_type = 'percent';
  else if (hasFixed) overrides.rule_type = 'fixed';

  return { rule, overrides };
}

function computeCommissionAmount(rule, saleAmount, saleId, overrides = {}) {
  const amount = money(saleAmount);
  const type = String(overrides.rule_type || (rule && rule.rule_type) || 'percent').toLowerCase();
  const fixed = overrides.fixed_amount != null ? money(overrides.fixed_amount) : money(rule && rule.fixed_amount);
  const percent = overrides.percent_rate != null ? num(overrides.percent_rate) : num(rule && rule.percent_rate);

  let commission = 0;
  let rate = 0;

  if (type === 'fixed') {
    commission = fixed;
    rate = amount > 0 ? money((commission / amount) * 100) : 0;
  } else if (type === 'hybrid') {
    rate = percent;
    commission = money(amount * (percent / 100) + fixed);
  } else if (type === 'product' || type === 'per_product') {
    const rates = parseJson(rule && rule.product_rates_json, {}) || {};
    let items = [];
    try {
      items = dbAll('SELECT product_id, quantity, total FROM sale_items WHERE sale_id = ?', [saleId]);
    } catch (_) {
      items = [];
    }
    let sum = 0;
    let covered = 0;
    for (const item of items) {
      const key = String(item.product_id);
      if (rates[key] == null) continue;
      covered += num(item.total);
      sum += num(item.total) * (num(rates[key]) / 100);
    }
    const uncovered = Math.max(0, amount - covered);
    sum += uncovered * (percent / 100);
    commission = money(sum);
    rate = amount > 0 ? money((commission / amount) * 100) : percent;
  } else {
    rate = percent;
    commission = money(amount * (percent / 100));
  }

  return { rate: money(rate), commission_amount: Math.max(0, money(commission)), rule_type: type };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Commissions
 * ────────────────────────────────────────────────────────────────────────── */

function writeCommissionLedger(commission, action, previousStatus, newStatus, amount, actor, notes) {
  try {
    dbRun(
      `INSERT INTO mkt_commission_ledger (commission_id, agent_id, action, previous_status, new_status, amount, actor_id,
         actor_name, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`,
      [
        commission.id,
        commission.agent_id,
        String(action),
        textOrNull(previousStatus),
        textOrNull(newStatus),
        money(amount),
        actor && actor.id != null ? Number(actor.id) : null,
        (actor && (actor.full_name || actor.username)) || null,
        textOrNull(notes)
      ]
    );
  } catch (_) { /* ledger is best-effort */ }
}

function listCommissions(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT m.*, a.full_name AS agent_name, a.agent_code, a.referral_code, c.name AS campaign_name,
      br.name AS branch_name, b.name AS business_name, s.receipt_number, s.created_at AS sale_date,
      cu.name AS customer_name
    FROM mkt_commissions m
    LEFT JOIN mkt_referral_agents a ON a.id = m.agent_id
    LEFT JOIN mkt_campaigns_v2 c ON c.id = m.campaign_id
    LEFT JOIN branches br ON br.id = m.branch_id
    LEFT JOIN mkt_businesses b ON b.id = m.business_id
    LEFT JOIN sales s ON s.id = m.sale_id
    LEFT JOIN customers cu ON cu.id = s.customer_id
    WHERE 1=1`;
  const params = [];
  if (filters.agent_id != null && filters.agent_id !== '') {
    sql += ' AND m.agent_id = ?';
    params.push(intOrNull(filters.agent_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND m.status = ?';
    params.push(String(filters.status));
  }
  if (Array.isArray(filters.status_in) && filters.status_in.length) {
    sql += ` AND m.status IN (${filters.status_in.map(() => '?').join(',')})`;
    params.push(...filters.status_in.map(String));
  }
  if (filters.campaign_id != null && filters.campaign_id !== '') {
    sql += ' AND m.campaign_id = ?';
    params.push(intOrNull(filters.campaign_id));
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND m.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND m.branch_id = ?';
    params.push(intOrNull(filters.branch_id));
  }
  if (filters.sale_id != null && filters.sale_id !== '') {
    sql += ' AND m.sale_id = ?';
    params.push(intOrNull(filters.sale_id));
  }
  if (filters.from) {
    sql += ' AND date(m.created_at) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(m.created_at) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }
  if (textOrNull(filters.search)) {
    sql += ` AND (IFNULL(a.full_name,'') LIKE ? OR IFNULL(s.receipt_number,'') LIKE ? OR IFNULL(m.notes,'') LIKE ?)`;
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY m.created_at DESC, m.id DESC LIMIT ?';
  params.push(limitOf(filters, 500));

  try {
    return dbAll(sql, params).map(row => ({
      ...row,
      sale_amount: money(row.sale_amount),
      commission_amount: money(row.commission_amount),
      rate: money(row.rate)
    }));
  } catch (_) {
    return [];
  }
}

function getCommission(id, actor) {
  requirePlatformUser(actor);
  const row = dbGet('SELECT * FROM mkt_commissions WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    sale_amount: money(row.sale_amount),
    commission_amount: money(row.commission_amount),
    rate: money(row.rate),
    agent: row.agent_id ? hydrateAgent(dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [row.agent_id])) : null,
    campaign: row.campaign_id ? dbGet('SELECT id, name, status FROM mkt_campaigns_v2 WHERE id = ?', [row.campaign_id]) : null,
    rule: row.rule_id ? dbGet('SELECT * FROM mkt_commission_rules WHERE id = ?', [row.rule_id]) : null,
    sale: row.sale_id ? dbGet('SELECT id, receipt_number, total, created_at, customer_id, branch_id FROM sales WHERE id = ?', [row.sale_id]) : null,
    referral: row.referral_id ? dbGet('SELECT * FROM mkt_referrals_v2 WHERE id = ?', [row.referral_id]) : null,
    ledger: dbAll('SELECT * FROM mkt_commission_ledger WHERE commission_id = ? ORDER BY id DESC', [row.id])
  };
}

function setCommissionStatus(id, status, actor, notes) {
  const admin = requireFinanceOrAdmin(actor);
  const next = String(status || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(COMMISSION_FLOW, next)) {
    throw new Error(`Invalid commission status: ${status}`);
  }
  const existing = dbGet('SELECT * FROM mkt_commissions WHERE id = ?', [id]);
  if (!existing) throw new Error('Commission not found');

  const current = String(existing.status || 'pending').toLowerCase();
  if (current === next) return getCommission(id, actor);
  const allowed = COMMISSION_FLOW[current] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Cannot move a commission from ${current} to ${next}`);
  }

  const approvedAt = next === 'approved' ? nowIso() : existing.approved_at;
  const approvedBy = next === 'approved' ? admin.id : existing.approved_by;
  const paidAt = next === 'paid' ? nowIso() : (next === 'reversed' ? existing.paid_at : existing.paid_at);
  const reversedAt = next === 'reversed' ? nowIso() : existing.reversed_at;

  dbRun(
    `UPDATE mkt_commissions SET status=?, approved_at=?, approved_by=?, paid_at=?, reversed_at=?, notes=?, updated_at=datetime('now')
     WHERE id=?`,
    [next, approvedAt, approvedBy, paidAt, reversedAt, textOrNull(notes) || existing.notes, id]
  );

  const updated = dbGet('SELECT * FROM mkt_commissions WHERE id = ?', [id]);
  writeCommissionLedger(updated, `status_${next}`, current, next, money(updated.commission_amount), admin, notes);
  recalculateWallet(updated.agent_id);

  const agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [updated.agent_id]);
  const messages = {
    approved: `Your commission of ${money(updated.commission_amount)} has been approved`,
    payable: `Your commission of ${money(updated.commission_amount)} is queued for payout`,
    paid: `Your commission of ${money(updated.commission_amount)} has been paid`,
    reversed: `A commission of ${money(updated.commission_amount)} has been reversed`,
    cancelled: `A commission of ${money(updated.commission_amount)} has been cancelled`
  };
  if (agent && messages[next]) {
    notifyAgent(agent, `Commission ${next}`, messages[next], 'commission', 'commission', updated.id);
  }
  platformAudit(admin, 'set_commission_status', 'mkt_commission', id, { status: current }, { status: next, notes: textOrNull(notes) });

  return getCommission(id, actor);
}

function recalculateWallet(agentId) {
  ensurePlatformReady();
  const id = intOrNull(agentId);
  if (!id) throw new Error('Agent is required');
  ensureAgentWallet(id);
  const sums = dbGet(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'pending'  THEN commission_amount ELSE 0 END),0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'approved' THEN commission_amount ELSE 0 END),0) AS approved,
       COALESCE(SUM(CASE WHEN status = 'payable'  THEN commission_amount ELSE 0 END),0) AS payable,
       COALESCE(SUM(CASE WHEN status = 'paid'     THEN commission_amount ELSE 0 END),0) AS paid,
       COALESCE(SUM(CASE WHEN status = 'reversed' THEN commission_amount ELSE 0 END),0) AS reversed,
       COALESCE(SUM(CASE WHEN status IN ('approved','payable','paid') THEN commission_amount ELSE 0 END),0) AS lifetime
     FROM mkt_commissions WHERE agent_id = ?`,
    [id]
  ) || {};
  dbRun(
    `UPDATE mkt_agent_wallets SET pending=?, approved=?, payable=?, paid=?, reversed=?, lifetime=?, updated_at=datetime('now')
     WHERE agent_id=?`,
    [
      money(sums.pending),
      money(sums.approved),
      money(sums.payable),
      money(sums.paid),
      money(sums.reversed),
      money(sums.lifetime),
      id
    ]
  );
  const wallet = dbGet('SELECT * FROM mkt_agent_wallets WHERE agent_id = ?', [id]);
  return {
    ...wallet,
    pending: money(wallet.pending),
    approved: money(wallet.approved),
    payable: money(wallet.payable),
    paid: money(wallet.paid),
    reversed: money(wallet.reversed),
    lifetime: money(wallet.lifetime),
    available: money(num(wallet.approved) + num(wallet.payable))
  };
}

function listCommissionLedger(agentId, filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT l.*, m.sale_id, m.commission_amount AS commission_total, s.receipt_number
    FROM mkt_commission_ledger l
    LEFT JOIN mkt_commissions m ON m.id = l.commission_id
    LEFT JOIN sales s ON s.id = m.sale_id
    WHERE 1=1`;
  const params = [];
  if (agentId != null && agentId !== '') {
    sql += ' AND l.agent_id = ?';
    params.push(intOrNull(agentId));
  }
  if (filters.commission_id != null && filters.commission_id !== '') {
    sql += ' AND l.commission_id = ?';
    params.push(intOrNull(filters.commission_id));
  }
  if (textOrNull(filters.action)) {
    sql += ' AND l.action LIKE ?';
    params.push(`%${filters.action}%`);
  }
  if (filters.from) {
    sql += ' AND date(l.created_at) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(l.created_at) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }
  sql += ' ORDER BY l.id DESC LIMIT ?';
  params.push(limitOf(filters, 300));
  try {
    return dbAll(sql, params).map(row => ({ ...row, amount: money(row.amount) }));
  } catch (_) {
    return [];
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Agent payments
 * ────────────────────────────────────────────────────────────────────────── */

function listAgentPayments(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT p.*, a.full_name AS agent_name, a.agent_code, a.bank_json
    FROM mkt_agent_payments p
    LEFT JOIN mkt_referral_agents a ON a.id = p.agent_id
    WHERE 1=1`;
  const params = [];
  if (filters.agent_id != null && filters.agent_id !== '') {
    sql += ' AND p.agent_id = ?';
    params.push(intOrNull(filters.agent_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND p.status = ?';
    params.push(String(filters.status));
  }
  if (filters.from) {
    sql += ' AND date(IFNULL(p.payment_date, p.created_at)) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(IFNULL(p.payment_date, p.created_at)) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }
  sql += ' ORDER BY p.created_at DESC, p.id DESC LIMIT ?';
  params.push(limitOf(filters, 300));
  try {
    return dbAll(sql, params).map(row => ({
      ...row,
      amount: money(row.amount),
      bank: parseJson(row.bank_json, {})
    }));
  } catch (_) {
    return [];
  }
}

function applyPaymentToCommissions(agentId, amount, paymentId, admin) {
  let remaining = money(amount);
  const settled = [];
  const rows = dbAll(
    `SELECT * FROM mkt_commissions WHERE agent_id = ? AND status IN ('payable','approved')
     ORDER BY CASE status WHEN 'payable' THEN 0 ELSE 1 END, created_at, id`,
    [agentId]
  );
  for (const row of rows) {
    if (remaining <= 0.009) break;
    const value = money(row.commission_amount);
    if (value <= 0) continue;
    if (value > remaining + 0.009) continue;
    dbRun(
      `UPDATE mkt_commissions SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [row.id]
    );
    const updated = dbGet('SELECT * FROM mkt_commissions WHERE id = ?', [row.id]);
    writeCommissionLedger(updated, 'paid', row.status, 'paid', value, admin, `Agent payment #${paymentId}`);
    settled.push(row.id);
    remaining = money(remaining - value);
  }
  return { settled, unallocated: money(remaining) };
}

function saveAgentPayment(data = {}, actor) {
  const admin = requireFinanceOrAdmin(actor);
  const agentId = intOrNull(data.agent_id);
  if (!agentId) throw new Error('Agent is required');
  const agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [agentId]);
  if (!agent) throw new Error('Referral agent not found');

  const amount = money(data.amount);
  if (!(amount > 0)) throw new Error('Payment amount must be greater than zero');
  const status = String(textOrNull(data.status) || 'pending').toLowerCase();
  if (!PAYMENT_STATUSES.includes(status)) throw new Error(`Invalid payment status: ${status}`);

  let payment;
  let previousStatus = null;
  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_agent_payments WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Payment not found');
    previousStatus = String(existing.status || 'pending').toLowerCase();
    if (previousStatus === 'paid' && status !== 'paid') {
      throw new Error('A completed payment cannot be reopened — reverse the commissions instead');
    }
    dbRun(
      `UPDATE mkt_agent_payments SET agent_id=?, amount=?, payment_date=?, payment_method=?, reference=?, status=?, notes=?,
         admin_id=?, admin_name=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        agentId,
        amount,
        textOrNull(data.payment_date) || existing.payment_date || today(),
        data.payment_method === undefined ? existing.payment_method : textOrNull(data.payment_method),
        data.reference === undefined ? existing.reference : textOrNull(data.reference),
        status,
        data.notes === undefined ? existing.notes : textOrNull(data.notes),
        admin.id,
        admin.full_name || admin.username || null,
        existing.id
      ]
    );
    payment = dbGet('SELECT * FROM mkt_agent_payments WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_agent_payment', 'mkt_agent_payment', payment.id, existing, payment);
  } else {
    const result = dbRun(
      `INSERT INTO mkt_agent_payments (agent_id, amount, payment_date, payment_method, reference, status, notes, admin_id,
         admin_name, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
      [
        agentId,
        amount,
        textOrNull(data.payment_date) || today(),
        textOrNull(data.payment_method) || 'eft',
        textOrNull(data.reference),
        status,
        textOrNull(data.notes),
        admin.id,
        admin.full_name || admin.username || null
      ]
    );
    payment = fetchInserted('mkt_agent_payments', result);
    platformAudit(admin, 'create_agent_payment', 'mkt_agent_payment', payment.id, null, payment);
  }

  let allocation = { settled: [], unallocated: amount };
  if (status === 'paid' && previousStatus !== 'paid') {
    allocation = applyPaymentToCommissions(agentId, amount, payment.id, admin);
    notifyAgent(agent, 'Payment sent',
      `${money(amount)} has been paid to you${payment.reference ? ` (ref ${payment.reference})` : ''}`,
      'payment', 'agent_payment', payment.id);
  }

  const wallet = recalculateWallet(agentId);
  return {
    ...payment,
    amount: money(payment.amount),
    wallet,
    settled_commissions: allocation.settled,
    unallocated_amount: allocation.unallocated
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Contracts
 * ────────────────────────────────────────────────────────────────────────── */

const DEFAULT_CONTRACT_HTML = `
<h1>Referral Agent Agreement</h1>
<p>This agreement is entered into between <strong>{{business_name}}</strong> ("the Company") and
<strong>{{agent_name}}</strong> ("the Agent"), agent code <strong>{{agent_code}}</strong>.</p>
<h2>1. Appointment</h2>
<p>The Company appoints the Agent as a non-exclusive referral agent effective {{effective_date}}.</p>
<h2>2. Referral code</h2>
<p>The Agent is issued the referral code <strong>{{referral_code}}</strong> and referral link {{referral_link}}.
All qualifying sales attributed to this code will be credited to the Agent.</p>
<h2>3. Commission</h2>
<p>{{commission_summary}}</p>
<h2>4. Payment</h2>
<p>Commissions are approved by the Company and become payable once the underlying sale is finalised.
Payments are made to the Agent's nominated bank account.</p>
<h2>5. Conduct</h2>
<p>The Agent will represent the Company honestly, will not make claims on the Company's behalf that are untrue,
and will comply with all applicable consumer and data-protection law.</p>
<h2>6. Term and termination</h2>
<p>This agreement runs from {{effective_date}} until {{end_date}} and may be terminated by either party on written notice.
Commissions already approved remain payable.</p>
<p>Issued {{date}}.</p>
`.trim();

function listContractTemplates(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = 'SELECT * FROM mkt_contract_templates WHERE 1=1';
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (textOrNull(filters.template_type)) {
    sql += ' AND template_type = ?';
    params.push(String(filters.template_type));
  }
  if (!filters.include_inactive) sql += ' AND IFNULL(is_active,1) = 1';
  sql += ' ORDER BY name LIMIT ?';
  params.push(limitOf(filters, 100));

  let rows = [];
  try {
    rows = dbAll(sql, params);
  } catch (_) {
    return [];
  }
  if (!rows.length && !filters.no_seed) {
    try {
      const result = dbRun(
        `INSERT INTO mkt_contract_templates (business_id, name, template_type, body_html, is_active, created_at, updated_at)
         VALUES (?,?,?,?,1, datetime('now'), datetime('now'))`,
        [defaultBusinessId(), 'Standard Referral Agent Agreement', 'referral_agent', DEFAULT_CONTRACT_HTML]
      );
      const seeded = fetchInserted('mkt_contract_templates', result);
      if (seeded) rows = [seeded];
    } catch (_) { /* seeding is optional */ }
  }
  return rows;
}

function saveContractTemplate(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Template name is required');

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_contract_templates WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Contract template not found');
    dbRun(
      `UPDATE mkt_contract_templates SET business_id=?, name=?, template_type=?, body_html=?, is_active=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        name,
        textOrNull(data.template_type) || existing.template_type || 'general',
        data.body_html === undefined ? existing.body_html : String(data.body_html || ''),
        data.is_active === undefined ? bool01(existing.is_active, 1) : bool01(data.is_active, 1),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_contract_templates WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_contract_template', 'mkt_contract_template', existing.id, existing, updated);
    return updated;
  }

  const result = dbRun(
    `INSERT INTO mkt_contract_templates (business_id, name, template_type, body_html, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      name,
      textOrNull(data.template_type) || 'referral_agent',
      String(data.body_html || DEFAULT_CONTRACT_HTML),
      bool01(data.is_active, 1)
    ]
  );
  const created = fetchInserted('mkt_contract_templates', result);
  platformAudit(admin, 'create_contract_template', 'mkt_contract_template', created.id, null, created);
  return created;
}

function listAgentContracts(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT c.*, a.full_name AS agent_name, a.agent_code, t.name AS template_name, b.name AS business_name
    FROM mkt_agent_contracts c
    LEFT JOIN mkt_referral_agents a ON a.id = c.agent_id
    LEFT JOIN mkt_contract_templates t ON t.id = c.template_id
    LEFT JOIN mkt_businesses b ON b.id = c.business_id
    WHERE 1=1`;
  const params = [];
  if (filters.agent_id != null && filters.agent_id !== '') {
    sql += ' AND c.agent_id = ?';
    params.push(intOrNull(filters.agent_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND c.status = ?';
    params.push(String(filters.status));
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND c.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  sql += ' ORDER BY c.created_at DESC, c.id DESC LIMIT ?';
  params.push(limitOf(filters, 200));
  try {
    return dbAll(sql, params);
  } catch (_) {
    return [];
  }
}

function renderTemplate(html, context) {
  return String(html || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = context[key];
    return value == null ? '' : String(value);
  });
}

function describeCommissionRule(rule) {
  if (!rule) return 'Commission is calculated using the default company rule.';
  const type = String(rule.rule_type || 'percent').toLowerCase();
  if (type === 'fixed') return `The Agent earns a fixed ${money(rule.fixed_amount)} per attributed sale.`;
  if (type === 'hybrid') return `The Agent earns ${num(rule.percent_rate)}% of each attributed sale plus ${money(rule.fixed_amount)} per sale.`;
  if (type === 'product' || type === 'per_product') return `The Agent earns product-specific rates, defaulting to ${num(rule.percent_rate)}% of each attributed sale.`;
  return `The Agent earns ${num(rule.percent_rate)}% of the value of each attributed sale.`;
}

function createAgentContractFromTemplate(agentId, templateId, data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [agentId]);
  if (!agent) throw new Error('Referral agent not found');

  let template = templateId ? dbGet('SELECT * FROM mkt_contract_templates WHERE id = ?', [templateId]) : null;
  if (!template) {
    const seeded = listContractTemplates({ include_inactive: false }, actor);
    template = seeded.length ? seeded[0] : null;
  }

  const businessId = intOrNull(data.business_id) ?? agent.business_id ?? defaultBusinessId();
  const business = businessId ? dbGet('SELECT name FROM mkt_businesses WHERE id = ?', [businessId]) : null;
  const rule = agent.commission_rule_id
    ? dbGet('SELECT * FROM mkt_commission_rules WHERE id = ?', [agent.commission_rule_id])
    : ensureDefaultCommissionRule(businessId);
  const commissionSummary = textOrNull(data.commission_summary) || describeCommissionRule(rule);
  const effectiveDate = textOrNull(data.effective_date) || today();
  const endDate = textOrNull(data.end_date) || addDays(effectiveDate, 365);

  const context = {
    business_name: (business && business.name) || 'The Company',
    agent_name: agent.full_name,
    agent_code: agent.agent_code || 'pending',
    referral_code: agent.referral_code || 'pending',
    referral_link: agent.referral_link || buildReferralLink(agent.referral_code) || '',
    agent_phone: agent.phone || '',
    agent_email: agent.email || '',
    agent_id_number: agent.id_number || '',
    commission_summary: commissionSummary,
    effective_date: effectiveDate,
    end_date: endDate,
    date: today()
  };

  const bodyHtml = renderTemplate(
    textOrNull(data.body_html) || (template && template.body_html) || DEFAULT_CONTRACT_HTML,
    context
  );

  const result = dbRun(
    `INSERT INTO mkt_agent_contracts (agent_id, template_id, business_id, title, body_html, commission_summary, effective_date,
       end_date, status, sent_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      agent.id,
      template ? template.id : null,
      businessId,
      textOrNull(data.title) || `Referral Agent Agreement — ${agent.full_name}`,
      bodyHtml,
      commissionSummary,
      effectiveDate,
      endDate,
      data.send ? 'sent' : 'draft',
      data.send ? nowIso() : null,
      admin.id
    ]
  );
  const contract = fetchInserted('mkt_agent_contracts', result);
  platformAudit(admin, 'create_agent_contract', 'mkt_agent_contract', contract.id, null, contract);
  if (data.send) {
    notifyAgent(agent, 'Agreement ready to sign',
      `Please review and accept your referral agent agreement.`, 'contract', 'agent_contract', contract.id);
  }
  return contract;
}

function setContractStatus(id, status, actor, notes) {
  const admin = requireMktAdmin(actor);
  const next = String(status || '').toLowerCase();
  if (!CONTRACT_STATUSES.includes(next)) throw new Error(`Invalid contract status: ${status}`);
  const existing = dbGet('SELECT * FROM mkt_agent_contracts WHERE id = ?', [id]);
  if (!existing) throw new Error('Contract not found');

  dbRun(
    `UPDATE mkt_agent_contracts SET status=?, sent_at=?, accepted_at=?, cancelled_at=?, terminated_at=?, updated_at=datetime('now')
     WHERE id=?`,
    [
      next,
      next === 'sent' ? (existing.sent_at || nowIso()) : existing.sent_at,
      next === 'accepted' || next === 'active' ? (existing.accepted_at || nowIso()) : existing.accepted_at,
      next === 'cancelled' ? nowIso() : existing.cancelled_at,
      next === 'terminated' ? nowIso() : existing.terminated_at,
      id
    ]
  );
  const updated = dbGet('SELECT * FROM mkt_agent_contracts WHERE id = ?', [id]);
  const agent = dbGet('SELECT * FROM mkt_referral_agents WHERE id = ?', [updated.agent_id]);
  if (agent && next === 'sent') {
    notifyAgent(agent, 'Agreement ready to sign', 'Please review and accept your referral agent agreement.',
      'contract', 'agent_contract', updated.id);
  }
  platformAudit(admin, 'set_contract_status', 'mkt_agent_contract', id,
    { status: existing.status }, { status: next, notes: textOrNull(notes) });
  return updated;
}

function acceptContract(contractId, data = {}, actor) {
  const context = resolveAgentContext(actor, data.agent_id);
  const contract = dbGet('SELECT * FROM mkt_agent_contracts WHERE id = ?', [contractId]);
  if (!contract) throw new Error('Contract not found');
  if (!context.isAdmin && (!context.agent || Number(context.agent.id) !== Number(contract.agent_id))) {
    throw new Error('This agreement does not belong to you');
  }
  if (['cancelled', 'terminated', 'expired'].includes(String(contract.status))) {
    throw new Error(`This agreement is ${contract.status} and can no longer be accepted`);
  }

  dbRun(
    `UPDATE mkt_agent_contracts SET status='accepted', accepted_at=datetime('now'), signature_data=?, updated_at=datetime('now')
     WHERE id=?`,
    [textOrNull(data.signature_data || data.signature) || `Accepted by ${context.user.full_name || context.user.username}`, contractId]
  );
  try {
    dbRun(`UPDATE mkt_referral_agents SET agreement_accepted = 1, updated_at = datetime('now') WHERE id = ?`, [contract.agent_id]);
  } catch (_) { /* optional */ }

  const updated = dbGet('SELECT * FROM mkt_agent_contracts WHERE id = ?', [contractId]);
  notifyAdmins('Agreement accepted',
    `${(context.agent && context.agent.full_name) || 'An agent'} accepted their referral agreement`,
    'contract', 'agent_contract', contractId);
  platformAudit(context.user, 'accept_contract', 'mkt_agent_contract', contractId,
    { status: contract.status }, { status: 'accepted' });
  return updated;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Incentives
 * ────────────────────────────────────────────────────────────────────────── */

function listIncentives(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = 'SELECT * FROM mkt_agent_incentives WHERE 1=1';
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND status = ?';
    params.push(String(filters.status));
  }
  if (filters.active_now) {
    sql += ` AND status = 'active' AND (start_date IS NULL OR date(start_date) <= date('now'))
             AND (end_date IS NULL OR date(end_date) >= date('now'))`;
  }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(limitOf(filters, 200));
  try {
    return dbAll(sql, params).map(row => ({ ...row, rules: parseJson(row.rules_json, {}) }));
  } catch (_) {
    return [];
  }
}

function saveIncentive(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const name = textOrNull(data.name);
  if (!name) throw new Error('Incentive name is required');

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_agent_incentives WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Incentive not found');
    dbRun(
      `UPDATE mkt_agent_incentives SET business_id=?, name=?, rules_json=?, bonus_amount=?, start_date=?, end_date=?, status=?
       WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        name,
        data.rules !== undefined || data.rules_json !== undefined
          ? toJsonText(data.rules !== undefined ? data.rules : data.rules_json, '{}')
          : (existing.rules_json || '{}'),
        data.bonus_amount === undefined ? num(existing.bonus_amount) : money(data.bonus_amount),
        data.start_date === undefined ? existing.start_date : textOrNull(data.start_date),
        data.end_date === undefined ? existing.end_date : textOrNull(data.end_date),
        textOrNull(data.status) || existing.status || 'active',
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_agent_incentives WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_incentive', 'mkt_agent_incentive', existing.id, existing, updated);
    return { ...updated, rules: parseJson(updated.rules_json, {}) };
  }

  const result = dbRun(
    `INSERT INTO mkt_agent_incentives (business_id, name, rules_json, bonus_amount, start_date, end_date, status, created_at)
     VALUES (?,?,?,?,?,?,?, datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      name,
      toJsonText(data.rules !== undefined ? data.rules : data.rules_json, '{}'),
      money(data.bonus_amount),
      textOrNull(data.start_date) || today(),
      textOrNull(data.end_date),
      textOrNull(data.status) || 'active'
    ]
  );
  const created = fetchInserted('mkt_agent_incentives', result);
  platformAudit(admin, 'create_incentive', 'mkt_agent_incentive', created.id, null, created);
  notify('agent', { title: 'New incentive', body: `${created.name} — earn ${money(created.bonus_amount)}`, category: 'incentive', related_type: 'incentive', related_id: created.id });
  return { ...created, rules: parseJson(created.rules_json, {}) };
}

/* ──────────────────────────────────────────────────────────────────────────
 * QR codes & coupons
 * ────────────────────────────────────────────────────────────────────────── */

function listQrCodes(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = 'SELECT q.*, b.name AS business_name, br.name AS branch_name FROM mkt_qr_codes q '
    + 'LEFT JOIN mkt_businesses b ON b.id = q.business_id LEFT JOIN branches br ON br.id = q.branch_id WHERE 1=1';
  const params = [];
  if (textOrNull(filters.entity_type)) {
    sql += ' AND q.entity_type = ?';
    params.push(String(filters.entity_type));
  }
  if (filters.entity_id != null && filters.entity_id !== '') {
    sql += ' AND q.entity_id = ?';
    params.push(intOrNull(filters.entity_id));
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND q.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (!filters.include_inactive) sql += ' AND IFNULL(q.is_active,1) = 1';
  sql += ' ORDER BY q.created_at DESC, q.id DESC LIMIT ?';
  params.push(limitOf(filters, 300));
  try {
    return dbAll(sql, params).map(row => ({ ...row, payload_data: parseJson(row.payload, null) }));
  } catch (_) {
    return [];
  }
}

function createQrCode(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const entityType = textOrNull(data.entity_type);
  if (!entityType) throw new Error('Entity type is required');
  const payload = data.payload != null && typeof data.payload !== 'string'
    ? JSON.stringify(data.payload)
    : (textOrNull(data.payload) || JSON.stringify({ type: entityType, entity_id: intOrNull(data.entity_id) }));

  const result = dbRun(
    `INSERT INTO mkt_qr_codes (business_id, branch_id, entity_type, entity_id, label, payload, scan_count, is_active, created_at)
     VALUES (?,?,?,?,?,?,0,?, datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      intOrNull(data.branch_id),
      entityType,
      intOrNull(data.entity_id),
      textOrNull(data.label) || `${entityType} QR`,
      payload,
      bool01(data.is_active, 1)
    ]
  );
  const created = fetchInserted('mkt_qr_codes', result);
  platformAudit(admin, 'create_qr_code', 'mkt_qr_code', created.id, null, created);
  return { ...created, payload_data: parseJson(created.payload, null) };
}

/** Public — records a scan by QR id or by raw payload string. */
function recordQrScan(idOrPayload, meta = {}) {
  ensurePlatformReady();
  let row = null;
  const asId = intOrNull(idOrPayload);
  if (asId != null) row = dbGet('SELECT * FROM mkt_qr_codes WHERE id = ?', [asId]);
  if (!row && textOrNull(idOrPayload)) row = dbGet('SELECT * FROM mkt_qr_codes WHERE payload = ?', [String(idOrPayload)]);
  if (!row) throw new Error('QR code not recognised');
  if (Number(row.is_active) === 0) throw new Error('This QR code is no longer active');

  dbRun('UPDATE mkt_qr_codes SET scan_count = IFNULL(scan_count,0) + 1 WHERE id = ?', [row.id]);

  const payload = parseJson(row.payload, {}) || {};
  if (row.entity_type === 'referral_agent' && payload.referral_code) {
    try {
      recordReferralClick(payload.referral_code, { ...meta, source: meta.source || 'qr' });
    } catch (_) { /* click already logged best-effort */ }
  }

  const updated = dbGet('SELECT * FROM mkt_qr_codes WHERE id = ?', [row.id]);
  return { ...updated, payload_data: payload, scanned_at: nowIso() };
}

function listCoupons(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT c.*, cam.name AS campaign_name, p.name AS promotion_name, a.full_name AS agent_name, cu.name AS customer_name
    FROM mkt_coupons c
    LEFT JOIN mkt_campaigns_v2 cam ON cam.id = c.campaign_id
    LEFT JOIN mkt_promotions p ON p.id = c.promotion_id
    LEFT JOIN mkt_referral_agents a ON a.id = c.agent_id
    LEFT JOIN customers cu ON cu.id = c.customer_id
    WHERE 1=1`;
  const params = [];
  if (textOrNull(filters.code)) {
    sql += ' AND c.code = ?';
    params.push(String(filters.code).trim().toUpperCase());
  }
  if (textOrNull(filters.status)) {
    sql += ' AND c.status = ?';
    params.push(String(filters.status));
  }
  if (filters.campaign_id != null && filters.campaign_id !== '') {
    sql += ' AND c.campaign_id = ?';
    params.push(intOrNull(filters.campaign_id));
  }
  if (filters.promotion_id != null && filters.promotion_id !== '') {
    sql += ' AND c.promotion_id = ?';
    params.push(intOrNull(filters.promotion_id));
  }
  if (filters.agent_id != null && filters.agent_id !== '') {
    sql += ' AND c.agent_id = ?';
    params.push(intOrNull(filters.agent_id));
  }
  if (filters.customer_id != null && filters.customer_id !== '') {
    sql += ' AND c.customer_id = ?';
    params.push(intOrNull(filters.customer_id));
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND c.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (filters.active_now) {
    sql += ` AND c.status IN ('generated','issued','active') AND (c.expires_at IS NULL OR date(c.expires_at) >= date('now'))
             AND c.used_count < IFNULL(c.max_uses, 1)`;
  }
  if (textOrNull(filters.search)) {
    sql += ' AND c.code LIKE ?';
    params.push(`%${String(filters.search).toUpperCase()}%`);
  }
  sql += ' ORDER BY c.created_at DESC, c.id DESC LIMIT ?';
  params.push(limitOf(filters, 300));
  try {
    return dbAll(sql, params).map(row => ({
      ...row,
      product_ids: parseJson(row.product_ids_json, []),
      discount_value: money(row.discount_value)
    }));
  } catch (_) {
    return [];
  }
}

function createCoupon(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  let code = textOrNull(data.code);
  if (code) {
    code = code.toUpperCase();
    if (dbGet('SELECT id FROM mkt_coupons WHERE code = ?', [code])) throw new Error('That coupon code already exists');
  } else {
    const campaign = data.campaign_id ? dbGet('SELECT name FROM mkt_campaigns_v2 WHERE id = ?', [intOrNull(data.campaign_id)]) : null;
    code = generateCouponCode(textOrNull(data.prefix) || (campaign && campaign.name) || 'PROMO');
  }

  const result = dbRun(
    `INSERT INTO mkt_coupons (code, business_id, branch_id, campaign_id, promotion_id, agent_id, customer_id, product_ids_json,
       discount_type, discount_value, max_uses, used_count, status, starts_at, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?, datetime('now'))`,
    [
      code,
      intOrNull(data.business_id) ?? defaultBusinessId(),
      intOrNull(data.branch_id),
      intOrNull(data.campaign_id),
      intOrNull(data.promotion_id),
      intOrNull(data.agent_id),
      intOrNull(data.customer_id),
      toJsonText(data.product_ids !== undefined ? data.product_ids : data.product_ids_json, '[]'),
      textOrNull(data.discount_type) || 'percent',
      money(data.discount_value),
      Math.max(1, Math.trunc(num(data.max_uses, 1))),
      textOrNull(data.status) || 'generated',
      textOrNull(data.starts_at) || today(),
      textOrNull(data.expires_at)
    ]
  );
  const created = fetchInserted('mkt_coupons', result);
  platformAudit(admin, 'create_coupon', 'mkt_coupon', created.id, null, created);
  return { ...created, product_ids: parseJson(created.product_ids_json, []) };
}

function redeemCoupon(code, data = {}, actor) {
  const user = requirePlatformUser(actor);
  const value = textOrNull(code);
  if (!value) throw new Error('Coupon code is required');
  const coupon = dbGet('SELECT * FROM mkt_coupons WHERE UPPER(code) = UPPER(?)', [value]);
  if (!coupon) throw new Error('Coupon not found');

  if (['redeemed', 'expired', 'cancelled', 'void'].includes(String(coupon.status))) {
    throw new Error(`This coupon is ${coupon.status}`);
  }
  if (coupon.starts_at && String(coupon.starts_at).slice(0, 10) > today()) {
    throw new Error(`This coupon is only valid from ${String(coupon.starts_at).slice(0, 10)}`);
  }
  if (coupon.expires_at && String(coupon.expires_at).slice(0, 10) < today()) {
    dbRun(`UPDATE mkt_coupons SET status = 'expired' WHERE id = ?`, [coupon.id]);
    throw new Error('This coupon has expired');
  }
  const maxUses = Math.max(1, Math.trunc(num(coupon.max_uses, 1)));
  const usedCount = Math.max(0, Math.trunc(num(coupon.used_count, 0)));
  if (usedCount >= maxUses) throw new Error('This coupon has already been fully redeemed');

  const nextUsed = usedCount + 1;
  const exhausted = nextUsed >= maxUses;
  dbRun(
    `UPDATE mkt_coupons SET used_count = ?, status = ?, redeemed_at = ?, customer_id = COALESCE(?, customer_id) WHERE id = ?`,
    [
      nextUsed,
      exhausted ? 'redeemed' : 'active',
      exhausted ? nowIso() : coupon.redeemed_at,
      intOrNull(data.customer_id),
      coupon.id
    ]
  );

  const saleAmount = money(data.amount || data.sale_total);
  const type = String(coupon.discount_type || 'percent').toLowerCase();
  const discount = type === 'percent'
    ? money(saleAmount * (num(coupon.discount_value) / 100))
    : money(coupon.discount_value);

  const updated = dbGet('SELECT * FROM mkt_coupons WHERE id = ?', [coupon.id]);
  platformAudit(user, 'redeem_coupon', 'mkt_coupon', coupon.id,
    { used_count: usedCount, status: coupon.status },
    { used_count: nextUsed, status: updated.status, sale_id: intOrNull(data.sale_id) });

  return {
    ...updated,
    product_ids: parseJson(updated.product_ids_json, []),
    discount_amount: discount,
    remaining_uses: Math.max(0, maxUses - nextUsed),
    applied_to_sale_id: intOrNull(data.sale_id)
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Calendar
 * ────────────────────────────────────────────────────────────────────────── */

function listCalendarEvents(filters = {}, actor) {
  requirePlatformUser(actor);
  let sql = `
    SELECT e.*, b.name AS business_name, br.name AS branch_name
    FROM mkt_calendar_events e
    LEFT JOIN mkt_businesses b ON b.id = e.business_id
    LEFT JOIN branches br ON br.id = e.branch_id
    WHERE 1=1`;
  const params = [];
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND e.business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND e.branch_id = ?';
    params.push(intOrNull(filters.branch_id));
  }
  if (textOrNull(filters.event_type)) {
    sql += ' AND e.event_type = ?';
    params.push(String(filters.event_type));
  }
  if (textOrNull(filters.related_type)) {
    sql += ' AND e.related_type = ?';
    params.push(String(filters.related_type));
  }
  if (filters.from) {
    sql += ' AND date(IFNULL(e.end_at, e.start_at)) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(e.start_at) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }
  sql += ' ORDER BY e.start_at LIMIT ?';
  params.push(limitOf(filters, 300));
  try {
    return dbAll(sql, params);
  } catch (_) {
    return [];
  }
}

function saveCalendarEvent(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  const title = textOrNull(data.title);
  const startAt = textOrNull(data.start_at);
  if (!title) throw new Error('Event title is required');
  if (!startAt) throw new Error('Event start date is required');

  if (data.id) {
    const existing = dbGet('SELECT * FROM mkt_calendar_events WHERE id = ?', [data.id]);
    if (!existing) throw new Error('Calendar event not found');
    dbRun(
      `UPDATE mkt_calendar_events SET business_id=?, branch_id=?, event_type=?, title=?, related_type=?, related_id=?,
         start_at=?, end_at=?, color=? WHERE id=?`,
      [
        data.business_id === undefined ? existing.business_id : intOrNull(data.business_id),
        data.branch_id === undefined ? existing.branch_id : intOrNull(data.branch_id),
        textOrNull(data.event_type) || existing.event_type || 'custom',
        title,
        data.related_type === undefined ? existing.related_type : textOrNull(data.related_type),
        data.related_id === undefined ? existing.related_id : intOrNull(data.related_id),
        startAt,
        data.end_at === undefined ? existing.end_at : textOrNull(data.end_at),
        data.color === undefined ? existing.color : textOrNull(data.color),
        existing.id
      ]
    );
    const updated = dbGet('SELECT * FROM mkt_calendar_events WHERE id = ?', [existing.id]);
    platformAudit(admin, 'update_calendar_event', 'mkt_calendar_event', existing.id, existing, updated);
    return updated;
  }

  const result = dbRun(
    `INSERT INTO mkt_calendar_events (business_id, branch_id, event_type, title, related_type, related_id, start_at, end_at, color, created_at)
     VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`,
    [
      intOrNull(data.business_id) ?? defaultBusinessId(),
      intOrNull(data.branch_id),
      textOrNull(data.event_type) || 'custom',
      title,
      textOrNull(data.related_type),
      intOrNull(data.related_id),
      startAt,
      textOrNull(data.end_at),
      textOrNull(data.color) || '#0ea5e9'
    ]
  );
  const created = fetchInserted('mkt_calendar_events', result);
  platformAudit(admin, 'create_calendar_event', 'mkt_calendar_event', created.id, null, created);
  return created;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Analytics
 * ────────────────────────────────────────────────────────────────────────── */

function getCampaignAnalytics(campaignId, actor) {
  requirePlatformUser(actor);
  const campaign = dbGet('SELECT * FROM mkt_campaigns_v2 WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error('Campaign not found');

  const clicks = scalar('SELECT COUNT(*) AS v FROM mkt_referral_clicks WHERE campaign_id = ?', [campaign.id]);
  const referrals = scalar('SELECT COUNT(*) AS v FROM mkt_referrals_v2 WHERE campaign_id = ?', [campaign.id]);
  const conversions = scalar(`SELECT COUNT(*) AS v FROM mkt_referrals_v2 WHERE campaign_id = ? AND status = 'converted'`, [campaign.id]);
  const orders = scalar(
    `SELECT COUNT(DISTINCT IFNULL(sale_id, id)) AS v FROM mkt_commissions WHERE campaign_id = ? AND status NOT IN ('reversed','cancelled')`,
    [campaign.id]
  );
  const revenue = money(scalar(
    `SELECT COALESCE(SUM(sale_amount),0) AS v FROM mkt_commissions WHERE campaign_id = ? AND status NOT IN ('reversed','cancelled')`,
    [campaign.id]
  ));
  const commission = money(scalar(
    `SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions WHERE campaign_id = ? AND status NOT IN ('reversed','cancelled')`,
    [campaign.id]
  ));
  const couponsIssued = scalar('SELECT COUNT(*) AS v FROM mkt_coupons WHERE campaign_id = ?', [campaign.id]);
  const couponsRedeemed = scalar('SELECT COALESCE(SUM(used_count),0) AS v FROM mkt_coupons WHERE campaign_id = ?', [campaign.id]);
  const qrScans = scalar(`SELECT COALESCE(SUM(scan_count),0) AS v FROM mkt_qr_codes WHERE entity_type = 'campaign' AND entity_id = ?`, [campaign.id]);

  const spend = money(num(campaign.marketing_cost) + commission);
  const budget = money(campaign.budget);

  const daily = dbAll(
    `SELECT date(created_at) AS day, COUNT(*) AS orders,
        COALESCE(SUM(sale_amount),0) AS revenue, COALESCE(SUM(commission_amount),0) AS commission
     FROM mkt_commissions
     WHERE campaign_id = ? AND status NOT IN ('reversed','cancelled')
     GROUP BY date(created_at) ORDER BY day`,
    [campaign.id]
  ).map(row => ({ ...row, revenue: money(row.revenue), commission: money(row.commission) }));

  const byAgent = dbAll(
    `SELECT m.agent_id, a.full_name AS agent_name, a.agent_code, COUNT(*) AS orders,
        COALESCE(SUM(m.sale_amount),0) AS revenue, COALESCE(SUM(m.commission_amount),0) AS commission
     FROM mkt_commissions m LEFT JOIN mkt_referral_agents a ON a.id = m.agent_id
     WHERE m.campaign_id = ? AND m.status NOT IN ('reversed','cancelled')
     GROUP BY m.agent_id, a.full_name, a.agent_code ORDER BY revenue DESC LIMIT 25`,
    [campaign.id]
  ).map(row => ({ ...row, revenue: money(row.revenue), commission: money(row.commission) }));

  const byChannel = dbAll(
    `SELECT channel, status, COUNT(*) AS count FROM mkt_campaign_channels WHERE campaign_id = ? GROUP BY channel, status`,
    [campaign.id]
  );

  return {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    status: campaign.status,
    start_date: campaign.start_date,
    end_date: campaign.end_date,
    clicks,
    referrals,
    conversions,
    conversion_rate: pct(conversions, referrals),
    click_conversion_rate: pct(conversions, clicks),
    orders,
    revenue,
    commission,
    budget,
    marketing_cost: money(campaign.marketing_cost),
    spend,
    budget_used_percent: pct(spend, budget),
    profit: money(revenue - spend),
    roi_percent: spend > 0 ? Math.round(((revenue - spend) / spend) * 1000) / 10 : 0,
    average_order_value: orders ? money(revenue / orders) : 0,
    cost_per_acquisition: conversions ? money(spend / conversions) : 0,
    coupons_issued: couponsIssued,
    coupons_redeemed: couponsRedeemed,
    coupon_redemption_rate: pct(couponsRedeemed, couponsIssued),
    qr_scans: qrScans,
    social_posts: scalar('SELECT COUNT(*) AS v FROM mkt_social_posts WHERE campaign_id = ?', [campaign.id]),
    whatsapp_recipients: scalar(
      `SELECT COALESCE(SUM(recipient_count),0) AS v FROM mkt_whatsapp_blasts WHERE campaign_id = ? AND status = 'sent'`,
      [campaign.id]
    ),
    daily,
    by_agent: byAgent,
    by_channel: byChannel
  };
}

function agentStats(agent, from, to) {
  const id = agent.id;
  const range = [id, from, to];
  const clicks = scalar(
    'SELECT COUNT(*) AS v FROM mkt_referral_clicks WHERE agent_id = ? AND date(created_at) BETWEEN date(?) AND date(?)',
    range
  );
  const referrals = scalar(
    'SELECT COUNT(*) AS v FROM mkt_referrals_v2 WHERE agent_id = ? AND date(created_at) BETWEEN date(?) AND date(?)',
    range
  );
  const conversions = scalar(
    `SELECT COUNT(*) AS v FROM mkt_referrals_v2 WHERE agent_id = ? AND status = 'converted' AND date(created_at) BETWEEN date(?) AND date(?)`,
    range
  );
  const orders = scalar(
    `SELECT COUNT(*) AS v FROM mkt_commissions WHERE agent_id = ? AND status NOT IN ('reversed','cancelled') AND date(created_at) BETWEEN date(?) AND date(?)`,
    range
  );
  const revenue = money(scalar(
    `SELECT COALESCE(SUM(sale_amount),0) AS v FROM mkt_commissions WHERE agent_id = ? AND status NOT IN ('reversed','cancelled') AND date(created_at) BETWEEN date(?) AND date(?)`,
    range
  ));
  const commission = money(scalar(
    `SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions WHERE agent_id = ? AND status NOT IN ('reversed','cancelled') AND date(created_at) BETWEEN date(?) AND date(?)`,
    range
  ));
  const wallet = ensureAgentWallet(id);

  return {
    agent_id: id,
    agent_code: agent.agent_code,
    full_name: agent.full_name,
    referral_code: agent.referral_code,
    tier: agent.tier,
    status: agent.status,
    business_id: agent.business_id,
    branch_id: agent.branch_id,
    from,
    to,
    clicks,
    referrals,
    conversions,
    conversion_rate: pct(conversions, referrals),
    click_conversion_rate: pct(conversions, clicks),
    orders,
    revenue,
    commission,
    average_order_value: orders ? money(revenue / orders) : 0,
    lifetime_referrals: scalar('SELECT COUNT(*) AS v FROM mkt_referrals_v2 WHERE agent_id = ?', [id]),
    lifetime_revenue: money(scalar(
      `SELECT COALESCE(SUM(sale_amount),0) AS v FROM mkt_commissions WHERE agent_id = ? AND status NOT IN ('reversed','cancelled')`,
      [id]
    )),
    wallet: {
      pending: money(wallet.pending),
      approved: money(wallet.approved),
      payable: money(wallet.payable),
      paid: money(wallet.paid),
      reversed: money(wallet.reversed),
      lifetime: money(wallet.lifetime),
      available: money(num(wallet.approved) + num(wallet.payable))
    }
  };
}

function getAgentPerformance(filters = {}, actor) {
  requirePlatformUser(actor);
  const { from, to } = dateRange(filters);
  let sql = 'SELECT * FROM mkt_referral_agents WHERE 1=1';
  const params = [];
  if (filters.agent_id != null && filters.agent_id !== '') {
    sql += ' AND id = ?';
    params.push(intOrNull(filters.agent_id));
  }
  if (textOrNull(filters.status)) {
    sql += ' AND status = ?';
    params.push(String(filters.status));
  } else if (!filters.include_inactive) {
    sql += ` AND status = 'active'`;
  }
  if (filters.business_id != null && filters.business_id !== '') {
    sql += ' AND business_id = ?';
    params.push(intOrNull(filters.business_id));
  }
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND branch_id = ?';
    params.push(intOrNull(filters.branch_id));
  }
  sql += ' ORDER BY full_name LIMIT ?';
  params.push(limitOf(filters, 200));

  let agents = [];
  try {
    agents = dbAll(sql, params);
  } catch (_) {
    return { range: { from, to }, rows: [], totals: emptyPerformanceTotals() };
  }

  const rows = agents.map(agent => agentStats(agent, from, to));
  const totals = rows.reduce((acc, row) => ({
    agents: acc.agents + 1,
    clicks: acc.clicks + row.clicks,
    referrals: acc.referrals + row.referrals,
    conversions: acc.conversions + row.conversions,
    orders: acc.orders + row.orders,
    revenue: money(acc.revenue + row.revenue),
    commission: money(acc.commission + row.commission)
  }), emptyPerformanceTotals());
  totals.conversion_rate = pct(totals.conversions, totals.referrals);
  totals.average_order_value = totals.orders ? money(totals.revenue / totals.orders) : 0;

  return { range: { from, to }, rows, totals };
}

function emptyPerformanceTotals() {
  return { agents: 0, clicks: 0, referrals: 0, conversions: 0, orders: 0, revenue: 0, commission: 0, conversion_rate: 0, average_order_value: 0 };
}

function getLeaderboard(filters = {}, actor) {
  requirePlatformUser(actor);
  const { from, to } = dateRange(filters);
  const metricKey = String(filters.metric || 'revenue').toLowerCase();
  const metricMap = {
    revenue: 'revenue',
    commission: 'commission',
    referrals: 'referrals',
    conversions: 'conversions',
    clicks: 'clicks',
    orders: 'orders'
  };
  const metric = metricMap[metricKey] || 'revenue';
  const performance = getAgentPerformance({ ...filters, from, to, limit: 500 }, actor);
  const rows = [...performance.rows]
    .sort((a, b) => num(b[metric]) - num(a[metric]) || num(b.revenue) - num(a.revenue))
    .slice(0, limitOf(filters, 10, 100))
    .map((row, index) => ({
      rank: index + 1,
      ...row,
      metric,
      metric_value: num(row[metric]),
      badge: index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : null
    }));
  return { range: { from, to }, metric, rows, totals: performance.totals };
}

function getMarketingRoi(filters = {}, actor) {
  requireMktAdmin(actor);
  const { from, to } = dateRange(filters);
  const businessId = intOrNull(filters.business_id);
  const branchIds = resolveBranchIds(filters);
  const bizClause = businessId != null ? ' AND business_id = ?' : '';
  const bizParams = businessId != null ? [businessId] : [];
  const branchScope = scopeClause('branch_id', filters, branchIds);
  const where = `WHERE 1=1${bizClause}${branchScope.sql}`;
  const baseParams = [...bizParams, ...branchScope.params];
  const rangeParams = [...baseParams, from, to];

  const revenue = money(scalar(
    `SELECT COALESCE(SUM(sale_amount),0) AS v FROM mkt_commissions ${where}
       AND status NOT IN ('reversed','cancelled') AND date(created_at) BETWEEN date(?) AND date(?)`,
    rangeParams
  ));
  const commission = money(scalar(
    `SELECT COALESCE(SUM(commission_amount),0) AS v FROM mkt_commissions ${where}
       AND status NOT IN ('reversed','cancelled') AND date(created_at) BETWEEN date(?) AND date(?)`,
    rangeParams
  ));
  const orders = scalar(
    `SELECT COUNT(DISTINCT IFNULL(sale_id, id)) AS v FROM mkt_commissions ${where}
       AND status NOT IN ('reversed','cancelled') AND date(created_at) BETWEEN date(?) AND date(?)`,
    rangeParams
  );
  const campaignCost = money(scalar(
    `SELECT COALESCE(SUM(marketing_cost),0) AS v FROM mkt_campaigns_v2 ${where}
       AND date(IFNULL(start_date, created_at)) <= date(?) AND (end_date IS NULL OR date(end_date) >= date(?))`,
    [...baseParams, to, from]
  ));
  const budget = money(scalar(`SELECT COALESCE(SUM(budget),0) AS v FROM mkt_campaigns_v2 ${where}`, baseParams));

  const totalSalesScope = scopeClause('branch_id', filters, branchIds);
  const totalRevenue = money(scalar(
    `SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE ${ACTIVE_SALE_FILTER}
       AND date(created_at) BETWEEN date(?) AND date(?)${totalSalesScope.sql}`,
    [from, to, ...totalSalesScope.params]
  ));

  const spend = money(campaignCost + commission);
  const profit = money(revenue - spend);

  return {
    range: { from, to },
    filters: { business_id: businessId, branch_id: intOrNull(filters.branch_id) },
    attributed_revenue: revenue,
    attributed_orders: orders,
    total_revenue: totalRevenue,
    attributed_share_percent: pct(revenue, totalRevenue),
    commission_cost: commission,
    campaign_cost: campaignCost,
    budget,
    budget_used_percent: pct(spend, budget),
    total_spend: spend,
    profit,
    roi_percent: spend > 0 ? Math.round((profit / spend) * 1000) / 10 : 0,
    return_per_rand: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
    cost_per_order: orders ? money(spend / orders) : 0,
    average_order_value: orders ? money(revenue / orders) : 0,
    by_campaign: topCampaigns({ ...filters, from, to }, limitOf(filters, 20, 100))
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Notifications
 * ────────────────────────────────────────────────────────────────────────── */

function listMktNotifications(filters = {}, actor) {
  const user = requirePlatformUser(actor);
  const agent = dbGet('SELECT id FROM mkt_referral_agents WHERE user_id = ? ORDER BY id LIMIT 1', [user.id]);
  const admin = isAdminUser(user);

  const clauses = ['n.user_id = ?', `n.audience = 'all'`];
  const params = [user.id];
  if (agent) {
    clauses.push('n.agent_id = ?');
    params.push(agent.id);
  }
  if (admin) clauses.push(`(n.audience = 'admin' AND n.user_id IS NULL AND n.agent_id IS NULL)`);

  let sql = `SELECT n.* FROM mkt_notifications n WHERE (${clauses.join(' OR ')})`;
  if (filters.unread_only) sql += ' AND IFNULL(n.is_read,0) = 0';
  if (textOrNull(filters.category)) {
    sql += ' AND n.category = ?';
    params.push(String(filters.category));
  }
  if (textOrNull(filters.related_type)) {
    sql += ' AND n.related_type = ?';
    params.push(String(filters.related_type));
  }
  sql += ' ORDER BY n.created_at DESC, n.id DESC LIMIT ?';
  params.push(limitOf(filters, 100));

  try {
    return dbAll(sql, params);
  } catch (_) {
    return [];
  }
}

function markMktNotificationRead(id, actor) {
  const user = requirePlatformUser(actor);
  const row = dbGet('SELECT * FROM mkt_notifications WHERE id = ?', [id]);
  if (!row) throw new Error('Notification not found');

  if (!isAdminUser(user)) {
    const agent = dbGet('SELECT id FROM mkt_referral_agents WHERE user_id = ? ORDER BY id LIMIT 1', [user.id]);
    const ownsIt = (row.user_id != null && Number(row.user_id) === Number(user.id))
      || (agent && row.agent_id != null && Number(row.agent_id) === Number(agent.id))
      || String(row.audience) === 'all';
    if (!ownsIt) throw new Error('This notification does not belong to you');
  }

  dbRun('UPDATE mkt_notifications SET is_read = 1 WHERE id = ?', [id]);
  return dbGet('SELECT * FROM mkt_notifications WHERE id = ?', [id]);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Settings
 * ────────────────────────────────────────────────────────────────────────── */

function getMktSettings(actor) {
  requirePlatformUser(actor);
  ensureSettingsRow();
  const row = dbGet('SELECT * FROM mkt_settings WHERE id = 1') || {};
  const settings = parseJson(row.settings_json, {});
  let social = {};
  try {
    social = require('./social-publish').getSocialSettings();
  } catch (_) {
    social = settings.social || {};
  }
  return {
    id: 1,
    default_commission_percent: num(row.default_commission_percent, 5),
    auto_approve_commissions: Number(row.auto_approve_commissions) === 1 ? 1 : 0,
    public_apply_enabled: Number(row.public_apply_enabled) === 0 ? 0 : 1,
    referral_base_url: textOrNull(row.referral_base_url) || '/r/',
    settings,
    social: {
      facebook_page_id: social.facebook_page_id || '',
      facebook_page_token: social.facebook_page_token ? '••••••••' : '',
      facebook_page_token_set: !!social.facebook_page_token,
      instagram_account_id: social.instagram_account_id || '',
      enabled: !!social.enabled
    },
    updated_at: row.updated_at || null,
    default_commission_rule: ensureDefaultCommissionRule(defaultBusinessId())
  };
}

function saveMktSettings(data = {}, actor) {
  const admin = requireMktAdmin(actor);
  ensureSettingsRow();
  const existing = dbGet('SELECT * FROM mkt_settings WHERE id = 1') || {};
  let settingsObj = parseJson(existing.settings_json, {});
  if (data.settings !== undefined || data.settings_json !== undefined) {
    settingsObj = parseJson(
      toJsonText(data.settings !== undefined ? data.settings : data.settings_json, '{}'),
      {}
    );
  }
  if (data.social && typeof data.social === 'object') {
    const social = { ...(settingsObj.social || {}), ...data.social };
    if (data.social.facebook_page_token === '' && settingsObj.social?.facebook_page_token) {
      social.facebook_page_token = settingsObj.social.facebook_page_token;
    }
    if (data.social.facebook_page_token === '••••••••' && settingsObj.social?.facebook_page_token) {
      social.facebook_page_token = settingsObj.social.facebook_page_token;
    }
    settingsObj = { ...settingsObj, social };
  }
  dbRun(
    `UPDATE mkt_settings SET default_commission_percent=?, auto_approve_commissions=?, public_apply_enabled=?,
       referral_base_url=?, settings_json=?, updated_at=datetime('now')
     WHERE id = 1`,
    [
      data.default_commission_percent === undefined ? num(existing.default_commission_percent, 5) : num(data.default_commission_percent, 5),
      data.auto_approve_commissions === undefined ? bool01(existing.auto_approve_commissions, 0) : bool01(data.auto_approve_commissions, 0),
      data.public_apply_enabled === undefined ? bool01(existing.public_apply_enabled, 1) : bool01(data.public_apply_enabled, 1),
      data.referral_base_url === undefined ? (existing.referral_base_url || '/r/') : (textOrNull(data.referral_base_url) || '/r/'),
      JSON.stringify(settingsObj || {})
    ]
  );
  const updated = dbGet('SELECT * FROM mkt_settings WHERE id = 1');
  platformAudit(admin, 'save_mkt_settings', 'mkt_settings', 1, existing, updated);
  return getMktSettings(actor);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Audit trail
 * ────────────────────────────────────────────────────────────────────────── */

function listPlatformAudit(filters = {}, actor) {
  requireMktAdmin(actor);
  let sql = 'SELECT * FROM mkt_platform_audit WHERE 1=1';
  const params = [];
  if (filters.user_id != null && filters.user_id !== '') {
    sql += ' AND user_id = ?';
    params.push(intOrNull(filters.user_id));
  }
  if (textOrNull(filters.action)) {
    sql += ' AND action LIKE ?';
    params.push(`%${filters.action}%`);
  }
  if (textOrNull(filters.entity_type)) {
    sql += ' AND entity_type = ?';
    params.push(String(filters.entity_type));
  }
  if (filters.entity_id != null && filters.entity_id !== '') {
    sql += ' AND entity_id = ?';
    params.push(intOrNull(filters.entity_id));
  }
  if (filters.from) {
    sql += ' AND date(created_at) >= date(?)';
    params.push(String(filters.from).slice(0, 10));
  }
  if (filters.to) {
    sql += ' AND date(created_at) <= date(?)';
    params.push(String(filters.to).slice(0, 10));
  }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limitOf(filters, 200, 2000));
  try {
    return dbAll(sql, params).map(row => ({
      ...row,
      previous: parseJson(row.previous_value, null),
      next: parseJson(row.new_value, null)
    }));
  } catch (_) {
    return [];
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Referral agent portal
 * ────────────────────────────────────────────────────────────────────────── */

function getReferralAgentDashboard(actor, agentId) {
  const context = resolveAgentContext(actor, agentId);
  const agent = context.agent;
  if (!agent) throw new Error('No referral agent profile is linked to this account');

  const from = monthStart();
  const to = today();
  const stats = agentStats(agent, from, to);
  const wallet = recalculateWallet(agent.id);

  const recentCommissions = dbAll(
    `SELECT m.*, s.receipt_number, s.created_at AS sale_date, c.name AS campaign_name
     FROM mkt_commissions m
     LEFT JOIN sales s ON s.id = m.sale_id
     LEFT JOIN mkt_campaigns_v2 c ON c.id = m.campaign_id
     WHERE m.agent_id = ? ORDER BY m.id DESC LIMIT 25`,
    [agent.id]
  ).map(row => ({ ...row, sale_amount: money(row.sale_amount), commission_amount: money(row.commission_amount) }));

  const recentReferrals = dbAll(
    `SELECT r.*, c.name AS customer_name FROM mkt_referrals_v2 r
     LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.agent_id = ? ORDER BY r.id DESC LIMIT 25`,
    [agent.id]
  );

  const payments = dbAll('SELECT * FROM mkt_agent_payments WHERE agent_id = ? ORDER BY id DESC LIMIT 25', [agent.id])
    .map(row => ({ ...row, amount: money(row.amount) }));

  const contracts = dbAll('SELECT * FROM mkt_agent_contracts WHERE agent_id = ? ORDER BY id DESC LIMIT 25', [agent.id]);

  const notifications = dbAll(
    `SELECT * FROM mkt_notifications WHERE agent_id = ? OR user_id = ? OR audience = 'all'
     ORDER BY created_at DESC, id DESC LIMIT 30`,
    [agent.id, agent.user_id || -1]
  );

  const activeCampaigns = dbAll(
    `SELECT id, name, description, start_date, end_date, target_audience FROM mkt_campaigns_v2
     WHERE status = 'active' AND (business_id = ? OR business_id IS NULL) ORDER BY id DESC LIMIT 10`,
    [agent.business_id]
  );
  const activePromotions = dbAll(
    `SELECT id, name, promo_type, discount_value, start_date, end_date FROM mkt_promotions
     WHERE status = 'active' AND (business_id = ? OR business_id IS NULL)
       AND (end_date IS NULL OR date(end_date) >= date('now')) ORDER BY id DESC LIMIT 10`,
    [agent.business_id]
  );
  const incentives = dbAll(
    `SELECT * FROM mkt_agent_incentives WHERE status = 'active'
       AND (start_date IS NULL OR date(start_date) <= date('now'))
       AND (end_date IS NULL OR date(end_date) >= date('now'))
     ORDER BY id DESC LIMIT 10`
  ).map(row => ({ ...row, rules: parseJson(row.rules_json, {}), bonus_amount: money(row.bonus_amount) }));

  let rank = null;
  try {
    const board = getLeaderboard({ from, to, limit: 100, metric: 'revenue' }, actor);
    const entry = board.rows.find(r => Number(r.agent_id) === Number(agent.id));
    rank = entry ? { position: entry.rank, of: board.rows.length, metric: 'revenue', value: entry.metric_value } : null;
  } catch (_) { /* leaderboard optional */ }

  const referralLink = agent.referral_link || buildReferralLink(agent.referral_code);
  const cards = [
    { key: 'available', label: 'Available to withdraw', value: wallet.available, format: 'money', hint: 'Approved + payable' },
    { key: 'pending', label: 'Pending approval', value: wallet.pending, format: 'money', hint: 'Awaiting admin review' },
    { key: 'paid', label: 'Paid to date', value: wallet.paid, format: 'money', hint: 'Lifetime payouts' },
    { key: 'revenue', label: 'Revenue this month', value: stats.revenue, format: 'money', hint: `${stats.orders} orders` },
    { key: 'referrals', label: 'Referrals this month', value: stats.referrals, format: 'number', hint: `${stats.conversion_rate}% converted` },
    { key: 'clicks', label: 'Link clicks', value: stats.clicks, format: 'number', hint: 'This month' }
  ];

  return {
    generated_at: nowIso(),
    range: { from, to },
    agent: {
      ...hydrateAgent(agent),
      referral_link: referralLink,
      share_message: `Shop with us and use my code ${agent.referral_code}: ${referralLink || ''}`.trim()
    },
    is_admin_view: !!context.isAdmin && Number(agent.user_id) !== Number(context.user.id),
    wallet,
    stats,
    cards,
    rank,
    recent_commissions: recentCommissions,
    recent_referrals: recentReferrals,
    payments,
    contracts,
    pending_contracts: contracts.filter(c => String(c.status) === 'sent'),
    notifications,
    unread_notifications: notifications.filter(n => !Number(n.is_read)).length,
    active_campaigns: activeCampaigns,
    active_promotions: activePromotions,
    incentives,
    qr_codes: dbAll(`SELECT * FROM mkt_qr_codes WHERE entity_type = 'referral_agent' AND entity_id = ?`, [agent.id])
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Module bootstrap (safe when the DB is not initialised yet)
 * ────────────────────────────────────────────────────────────────────────── */

try {
  ensurePlatformReady();
} catch (_) { /* database initialises later — ensurePlatformReady retries */ }

module.exports = {
  // helpers
  uid,
  parseJson,
  toJsonText,
  money,
  today,
  escapeHtml,

  // auth & audit
  requireMktAdmin,
  requireFinanceOrAdmin,
  requireReferralAgent,
  requirePlatformUser,
  platformAudit,
  notify,
  notifyAdmins,
  notifyAgent,

  // bootstrap
  ensurePlatformReady,
  ensureMarketingColumns,
  ensureDefaultBusiness,
  ensureDefaultCommissionRule,

  // businesses & branches
  listBusinesses,
  getBusiness,
  saveBusiness,
  setBusinessActive,
  listMktBranches,
  saveBranchBusinessLink,

  // dashboard
  getCommandCentreDashboard,

  // campaigns
  listCampaignsV2,
  getCampaignV2,
  saveCampaignV2,
  duplicateCampaignV2,
  setCampaignStatus,
  listCampaignChannels,
  saveCampaignChannel,
  generateCampaignAssets,

  // promotions
  listPromotions,
  getPromotion,
  savePromotion,
  setPromotionStatus,

  // social
  listSocialPosts,
  saveSocialPost,
  setSocialPostStatus,
  publishSocialPostLive,

  // whatsapp
  listWhatsappBlasts,
  saveWhatsappBlast,
  previewWhatsappAudience,

  // customers & segments
  listMktCustomers,
  listCustomerSegments,
  saveCustomerSegment,
  evaluateSegment,

  // loyalty
  listLoyaltyRules,
  saveLoyaltyRule,
  getLoyaltyAccount,
  adjustLoyaltyPoints,
  accrueLoyaltyForSale,

  // referral agents
  applyAsReferralAgent,
  listReferralAgents,
  getReferralAgent,
  approveReferralAgent,
  setReferralAgentStatus,
  linkAgentUser,
  ensureAgentLoginUser,
  ensureAgentLoginById,
  generateUniqueReferralCode,
  generateAgentCode,
  getAgentPublicProfile,
  getAgentByReferralCode,
  buildReferralLink,
  referralBaseUrl,

  // referrals & attribution
  recordReferralClick,
  attributeReferral,
  processSaleForMarketing,
  reverseCommissionsForSale,

  // commission rules & commissions
  listCommissionRules,
  saveCommissionRule,
  computeCommissionAmount,
  resolveCommissionContext,
  listCommissions,
  getCommission,
  setCommissionStatus,
  recalculateWallet,
  ensureAgentWallet,
  listCommissionLedger,

  // payments
  listAgentPayments,
  saveAgentPayment,

  // contracts
  listContractTemplates,
  saveContractTemplate,
  listAgentContracts,
  createAgentContractFromTemplate,
  setContractStatus,
  acceptContract,

  // incentives
  listIncentives,
  saveIncentive,

  // qr & coupons
  listQrCodes,
  createQrCode,
  recordQrScan,
  listCoupons,
  createCoupon,
  redeemCoupon,

  // calendar
  listCalendarEvents,
  saveCalendarEvent,

  // analytics
  getCampaignAnalytics,
  getAgentPerformance,
  getLeaderboard,
  getMarketingRoi,

  // notifications
  listMktNotifications,
  markMktNotificationRead,

  // settings & audit
  getMktSettings,
  saveMktSettings,
  listPlatformAudit,

  // agent portal
  getReferralAgentDashboard
};
