/**
 * SaaS Control Plane — contracts, activation, devices, offline license,
 * service fees, notifications, access messages.
 * Reuses platform_shops / entitlements / audit. Lab-only when PLATFORM_CONTROL_ENABLED.
 * Never targets Chisa Food production.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/db');

let platform;
try { platform = require('./platform-control'); } catch (_) { platform = null; }
let entitlements;
try { entitlements = require('./entitlements'); } catch (_) { entitlements = null; }

function shopsMod() {
  try { return require('./platform-shops'); } catch (_) { return null; }
}

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}
function hashSecret(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}
function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}
function requireEnabled() {
  if (!platform?.isEnabled?.()) throw new Error('Platform Control is disabled on this deployment');
}
function actorName(actor) {
  return actor?.username || actor?.email || 'platform';
}
function audit(actor, action, shopId, detail) {
  try {
    dbRun(
      `INSERT INTO platform_audit_logs (actor, action, entity_type, entity_id, detail_json, created_at)
       VALUES (?,?,?,?,?,?)`,
      [actorName(actor), action, 'shop', shopId || '', JSON.stringify(detail || {}), nowIso()]
    );
  } catch (_) { /* */ }
}
function assertNotChisa(data) {
  const shops = shopsMod();
  if (shops?.assertNotChisaFood) shops.assertNotChisaFood(data || {});
  else if (entitlements?.isChisaFoodProtected?.()) {
    throw new Error('Cannot manage SaaS control plane on protected Chisa Food production');
  }
}

const SHOP_EXTRA_COLS = [
  ['address', "TEXT DEFAULT ''"],
  ['subscription_start', 'TEXT'],
  ['subscription_expiry', 'TEXT'],
  ['grace_days', 'INTEGER DEFAULT 3'],
  ['suspended_at', 'TEXT'],
  ['activation_status', "TEXT DEFAULT 'pending'"],
  ['contract_required', 'INTEGER DEFAULT 1'],
  ['contact_admin_url', "TEXT DEFAULT ''"],
  ['suspension_message', "TEXT DEFAULT ''"]
];

let schemaReady = false;

function ensureSchema() {
  if (schemaReady) return;
  const files = [
    path.join(__dirname, '../database/migrations-v127.sql'),
    path.join(__dirname, '../../supabase/migrations/20260921_platform_control_plane.sql')
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      getDb().exec(fs.readFileSync(f, 'utf8'));
      break;
    } catch (e) {
      console.warn('[control-plane] schema:', e.message || e);
    }
  }
  for (const [col, def] of SHOP_EXTRA_COLS) {
    try {
      dbGet(`SELECT ${col} FROM platform_shops LIMIT 1`);
    } catch (_) {
      try { dbRun(`ALTER TABLE platform_shops ADD COLUMN ${col} ${def}`); } catch (__) { /* */ }
    }
  }
  try {
    dbGet(`SELECT service_fee FROM online_orders_local LIMIT 1`);
  } catch (_) {
    try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN service_fee REAL DEFAULT 0`); } catch (__) { /* */ }
    try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN service_fee_label TEXT DEFAULT ''`); } catch (__) { /* */ }
    try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN service_fee_config_json TEXT DEFAULT '{}'`); } catch (__) { /* */ }
  }
  seedDefaults();
  schemaReady = true;
}

function seedDefaults() {
  const now = nowIso();
  if (!dbGet('SELECT id FROM platform_access_messages WHERE message_key = ?', ['suspended'])) {
    dbRun(
      `INSERT INTO platform_access_messages (id, message_key, title, body_text, contact_label, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        uid('msg'), 'suspended',
        'Service Temporarily Unavailable',
        'Your shop access has been temporarily suspended.\n\nThis may be due to your subscription status or an administrative action.\n\nPlease contact your administrator for assistance.',
        'Contact Administrator', now, 'system'
      ]
    );
  }
  if (!dbGet('SELECT id FROM platform_access_messages WHERE message_key = ?', ['expired'])) {
    dbRun(
      `INSERT INTO platform_access_messages (id, message_key, title, body_text, contact_label, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        uid('msg'), 'expired',
        'Subscription Expired',
        'Your shop subscription has expired. Protected operations are unavailable until the subscription is renewed.\n\nPlease contact your administrator for assistance.',
        'Contact Administrator', now, 'system'
      ]
    );
  }
  if (!dbGet('SELECT id FROM platform_access_messages WHERE message_key = ?', ['offline_auth_expired'])) {
    dbRun(
      `INSERT INTO platform_access_messages (id, message_key, title, body_text, contact_label, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        uid('msg'), 'offline_auth_expired',
        'License Validation Required',
        'This device must reconnect to validate its license before creating new protected transactions.',
        'Contact Administrator', now, 'system'
      ]
    );
  }
  if (!dbGet('SELECT id FROM platform_service_fees WHERE scope = ? AND scope_id = ?', ['platform_default', ''])) {
    dbRun(
      `INSERT INTO platform_service_fees (id, scope, scope_id, enabled, fee_type, percent, fixed_amount, currency, label, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid('fee'), 'platform_default', '', 0, 'percent', 0, 0, 'ZAR', 'Platform service fee', now, 'system']
    );
  }
  const defaultRules = [
    [30, 'Your subscription expires in 30 days.'],
    [14, 'Your subscription expires in 14 days.'],
    [7, 'Your subscription expires in 7 days.'],
    [3, 'Your subscription expires in 3 days.'],
    [1, 'Your subscription expires tomorrow.'],
    [0, 'Your subscription has expired.']
  ];
  for (const [days, body] of defaultRules) {
    for (const channel of ['email', 'whatsapp', 'sms']) {
      const exists = dbGet(
        'SELECT id FROM platform_notification_rules WHERE channel = ? AND days_before = ?',
        [channel, days]
      );
      if (exists) continue;
      dbRun(
        `INSERT INTO platform_notification_rules (id, channel, days_before, enabled, template_subject, template_body, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        [
          uid('nrule'), channel, days,
          channel === 'email' ? 1 : 0,
          days === 0 ? 'Subscription expired' : `Subscription reminder (${days}d)`,
          body, now
        ]
      );
    }
  }
  if (!dbGet('SELECT id FROM platform_contract_versions WHERE is_active = 1')) {
    dbRun(
      `INSERT INTO platform_contract_versions (id, version_label, title, body_text, terms_json, is_active, created_at, created_by, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        uid('cver'), 'v1.0',
        'Shop POS Customer Agreement (Draft)',
        'DRAFT — Configurable customer agreement.\n\nThis text must be reviewed by a qualified South African legal professional before commercial use.\n\n1. Parties\nThis agreement is between the Platform Operator and the Customer named below.\n\n2. Services\nThe Platform provides Shop POS software and related hosted services according to the selected package and add-ons.\n\n3. Subscription & fees\nFees, billing periods, and platform service fees (if enabled) are as configured for the Customer.\n\n4. Acceptable use\nThe Customer must not misuse the service, share activation credentials improperly, or attempt to bypass access controls.\n\n5. Suspension\nThe Platform may suspend access for overdue payment, abuse, or administrative action. Customer data is retained and restored on reactivation.\n\n6. Data\nCustomer business data remains the Customer\'s. Platform does not delete historical records solely due to suspension.\n\n7. Governing law\nThis draft contemplates South African law. Final wording requires legal review.',
        JSON.stringify({
          subscription_terms: 'As configured per package',
          service_fee_terms: 'Displayed at checkout when enabled; never silently added'
        }),
        1, now, 'system', 'Draft placeholder — legal review required before commercial use'
      ]
    );
  }
}

/* ───────────── Access evaluation (server clock) ───────────── */

function serverNowMs() {
  return Date.now(); // Node process time — never trust client clock for expiry
}

function getAccessMessage(key) {
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_access_messages WHERE message_key = ?', [key]);
  if (!row) {
    return {
      message_key: key,
      title: 'Service Temporarily Unavailable',
      body_text: 'Please contact your administrator for assistance.',
      contact_label: 'Contact Administrator'
    };
  }
  return {
    message_key: row.message_key,
    title: row.title,
    body_text: row.body_text,
    contact_label: row.contact_label || 'Contact Administrator'
  };
}

function setAccessMessage(key, data, actor) {
  requireEnabled();
  ensureSchema();
  const existing = dbGet('SELECT id FROM platform_access_messages WHERE message_key = ?', [key]);
  const now = nowIso();
  if (existing) {
    dbRun(
      `UPDATE platform_access_messages SET title=?, body_text=?, contact_label=?, updated_at=?, updated_by=? WHERE message_key=?`,
      [data.title, data.body_text, data.contact_label || 'Contact Administrator', now, actorName(actor), key]
    );
  } else {
    dbRun(
      `INSERT INTO platform_access_messages (id, message_key, title, body_text, contact_label, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?)`,
      [uid('msg'), key, data.title, data.body_text, data.contact_label || 'Contact Administrator', now, actorName(actor)]
    );
  }
  audit(actor, 'access_message_changed', null, { message_key: key });
  return { success: true, data: getAccessMessage(key) };
}

function listAccessMessages() {
  requireEnabled();
  ensureSchema();
  return { success: true, data: dbAll('SELECT * FROM platform_access_messages ORDER BY message_key') };
}

/**
 * Evaluate shop access from server/DB state.
 * Returns { allowed, access_state, days_remaining, grace_active, message, contact_admin_url, ... }
 */
function evaluateShopAccess(shopRow, opts = {}) {
  ensureSchema();
  if (entitlements?.isChisaFoodProtected?.() && !opts.forceEvaluate) {
    return {
      allowed: true,
      access_state: 'ACTIVE',
      protected_production: true,
      days_remaining: null,
      grace_active: false
    };
  }
  const now = serverNowMs();
  const status = String(shopRow?.subscription_status || 'TRIAL').toUpperCase();
  const graceDays = Math.max(0, Number(shopRow?.grace_days != null ? shopRow.grace_days : 3) || 0);
  const expiryIso = shopRow?.subscription_expiry || shopRow?.trial_end || null;
  const expiryMs = expiryIso ? Date.parse(expiryIso) : NaN;
  let daysRemaining = null;
  if (!Number.isNaN(expiryMs)) {
    daysRemaining = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
  }

  const contactUrl = shopRow?.contact_admin_url || process.env.PLATFORM_CONTACT_ADMIN_URL || '';
  const customMsg = String(shopRow?.suspension_message || '').trim();

  const blockedPayload = (access_state, msgKey) => {
    const msg = getAccessMessage(msgKey);
    return {
      allowed: false,
      access_state,
      days_remaining: daysRemaining,
      grace_active: false,
      subscription_status: status,
      subscription_start: shopRow?.subscription_start || shopRow?.trial_start || null,
      subscription_expiry: expiryIso,
      grace_days: graceDays,
      suspended_at: shopRow?.suspended_at || null,
      activation_status: shopRow?.activation_status || 'pending',
      contact_admin_url: contactUrl,
      message: customMsg
        ? { title: msg.title, body_text: customMsg, contact_label: msg.contact_label }
        : msg,
      shop_id: shopRow?.id || null
    };
  };

  if (status === 'SUSPENDED') {
    return blockedPayload('SUSPENDED', 'suspended');
  }

  if (status === 'EXPIRED') {
    return blockedPayload('EXPIRED', 'expired');
  }

  // Inactive without an explicit EXPIRED status still blocks as suspended.
  if (Number(shopRow?.is_active) === 0) {
    return blockedPayload('SUSPENDED', 'suspended');
  }

  // Contract gate (activation path) — optional soft check
  if (opts.requireContract && Number(shopRow?.contract_required) !== 0) {
    const acc = dbGet(
      'SELECT id FROM platform_contract_acceptances WHERE shop_id = ? ORDER BY accepted_at DESC LIMIT 1',
      [shopRow.id]
    );
    if (!acc) {
      return {
        ...blockedPayload('CONTRACT_REQUIRED', 'suspended'),
        allowed: false,
        access_state: 'CONTRACT_REQUIRED',
        message: {
          title: 'Agreement Required',
          body_text: 'Please accept the customer agreement before activation.',
          contact_label: 'Contact Administrator'
        }
      };
    }
  }

  if (!Number.isNaN(expiryMs) && now > expiryMs) {
    const graceEnd = expiryMs + graceDays * 24 * 60 * 60 * 1000;
    if (now <= graceEnd && (status === 'ACTIVE' || status === 'TRIAL' || status === 'OVERDUE')) {
      return {
        allowed: true,
        access_state: 'OVERDUE',
        days_remaining: daysRemaining,
        grace_active: true,
        grace_ends_at: new Date(graceEnd).toISOString(),
        subscription_status: status,
        subscription_start: shopRow?.subscription_start || shopRow?.trial_start || null,
        subscription_expiry: expiryIso,
        grace_days: graceDays,
        suspended_at: shopRow?.suspended_at || null,
        contact_admin_url: contactUrl,
        shop_id: shopRow?.id || null
      };
    }
    return blockedPayload('EXPIRED', 'expired');
  }

  if (status === 'OVERDUE') {
    return {
      allowed: true,
      access_state: 'OVERDUE',
      days_remaining: daysRemaining,
      grace_active: !Number.isNaN(expiryMs) ? now <= expiryMs + graceDays * 86400000 : true,
      subscription_status: status,
      subscription_start: shopRow?.subscription_start || shopRow?.trial_start || null,
      subscription_expiry: expiryIso,
      grace_days: graceDays,
      contact_admin_url: contactUrl,
      shop_id: shopRow?.id || null
    };
  }

  return {
    allowed: true,
    access_state: status === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
    days_remaining: daysRemaining,
    grace_active: false,
    subscription_status: status,
    subscription_start: shopRow?.subscription_start || shopRow?.trial_start || null,
    subscription_expiry: expiryIso,
    grace_days: graceDays,
    suspended_at: shopRow?.suspended_at || null,
    activation_status: shopRow?.activation_status || 'pending',
    contact_admin_url: contactUrl,
    shop_id: shopRow?.id || null
  };
}

function getShopAccessById(shopId) {
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shopId)]);
  if (!row) throw new Error('Shop not found');
  return { success: true, data: evaluateShopAccess(row) };
}

function getCountdown(shopId) {
  const r = getShopAccessById(shopId);
  const a = r.data;
  return {
    success: true,
    data: {
      shop_id: shopId,
      start_date: a.subscription_start,
      expiry_date: a.subscription_expiry,
      days_remaining: a.days_remaining,
      status: a.subscription_status,
      access_state: a.access_state,
      grace_period_days: a.grace_days,
      grace_active: a.grace_active,
      suspension_date: a.suspended_at,
      calculated_at: nowIso()
    }
  };
}

function getCurrentShopAccess() {
  ensureSchema();
  if (entitlements?.isChisaFoodProtected?.()) {
    return { allowed: true, access_state: 'ACTIVE', protected_production: true };
  }
  const envStatus = String(process.env.SHOP_SUBSCRIPTION_STATUS || '').toUpperCase();
  const key = entitlements?.shopKey?.() || process.env.SHOP_ENTITLEMENT_KEY || 'lab';
  let row = null;
  try {
    row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [key]);
  } catch (_) { /* */ }

  // Prefer synced DB row over process env so reactivation works without waiting
  // for a full process restart after Railway env upsert.
  if (row) {
    return { ...evaluateShopAccess(row), has_record: true, source: 'db' };
  }
  if (envStatus) {
    row = {
      id: key,
      subscription_status: envStatus,
      is_active: (envStatus === 'SUSPENDED' || envStatus === 'EXPIRED') ? 0 : 1,
      grace_days: Number(process.env.SHOP_GRACE_DAYS || 3),
      subscription_expiry: process.env.SHOP_SUBSCRIPTION_EXPIRY || null,
      subscription_start: process.env.SHOP_SUBSCRIPTION_START || null,
      suspended_at: envStatus === 'SUSPENDED' ? (process.env.SHOP_SUSPENDED_AT || nowIso()) : null,
      contact_admin_url: process.env.PLATFORM_CONTACT_ADMIN_URL || '',
      suspension_message: process.env.SHOP_SUSPENSION_MESSAGE || ''
    };
    return { ...evaluateShopAccess(row), has_record: true, source: 'env' };
  }
  return { allowed: true, access_state: 'ACTIVE', shop_id: key, has_record: false };
}

function assertShopAccess(opts = {}) {
  if (entitlements?.isChisaFoodProtected?.()) return { allowed: true };
  const access = getCurrentShopAccess();
  if (!access.allowed) {
    const err = new Error('SHOP_ACCESS_BLOCKED');
    err.code = access.access_state === 'EXPIRED' ? 'SHOP_EXPIRED' : 'SHOP_SUSPENDED';
    err.status = 403;
    err.access = access;
    throw err;
  }
  if (opts.requireDeviceLicense) {
    assertDeviceLicense(opts.devicePublicId, opts.shopId);
  }
  return { allowed: true, access };
}

/* ───────────── Contracts ───────────── */

function listContractVersions() {
  requireEnabled();
  ensureSchema();
  return {
    success: true,
    data: dbAll('SELECT id, version_label, title, is_active, created_at, created_by, notes FROM platform_contract_versions ORDER BY created_at DESC')
  };
}

function getContractVersion(id, { includeBody = true } = {}) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_contract_versions WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Contract version not found');
  const out = {
    id: row.id,
    version_label: row.version_label,
    title: row.title,
    is_active: Number(row.is_active) === 1,
    created_at: row.created_at,
    created_by: row.created_by,
    notes: row.notes,
    terms: parseJson(row.terms_json, {})
  };
  if (includeBody) out.body_text = row.body_text;
  return { success: true, data: out };
}

function getActiveContract() {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_contract_versions WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1');
  if (!row) return { success: true, data: null };
  return getContractVersion(row.id);
}

function createContractVersion(data, actor) {
  requireEnabled();
  ensureSchema();
  const id = uid('cver');
  const now = nowIso();
  const activate = data.activate !== false;
  if (activate) {
    dbRun('UPDATE platform_contract_versions SET is_active = 0');
  }
  dbRun(
    `INSERT INTO platform_contract_versions (id, version_label, title, body_text, terms_json, is_active, created_at, created_by, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      String(data.version_label || `v${Date.now()}`).trim(),
      String(data.title || 'Customer Agreement').trim(),
      String(data.body_text || '').trim() || 'DRAFT — legal review required.',
      JSON.stringify(data.terms || {}),
      activate ? 1 : 0,
      now,
      actorName(actor),
      data.notes || 'Configurable agreement — review by SA legal professional before commercial use'
    ]
  );
  audit(actor, 'contract_version_changed', null, { contract_version_id: id, activate });
  return getContractVersion(id);
}

function getShopContractStatus(shopId) {
  requireEnabled();
  ensureSchema();
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shopId)]);
  if (!shop) throw new Error('Shop not found');
  const history = dbAll(
    `SELECT a.*, v.version_label, v.title
     FROM platform_contract_acceptances a
     LEFT JOIN platform_contract_versions v ON v.id = a.contract_version_id
     WHERE a.shop_id = ?
     ORDER BY a.accepted_at DESC`,
    [shopId]
  );
  const latest = history[0] || null;
  const active = dbGet('SELECT id, version_label, title FROM platform_contract_versions WHERE is_active = 1 LIMIT 1');
  const needsReaccept = !!(active && latest && latest.contract_version_id !== active.id);
  return {
    success: true,
    data: {
      shop_id: shopId,
      contract_required: Number(shop.contract_required) !== 0,
      accepted: !!latest,
      latest_acceptance: latest
        ? {
          id: latest.id,
          contract_version_id: latest.contract_version_id,
          version_label: latest.version_label,
          title: latest.title,
          accepted_at: latest.accepted_at,
          accepted_by_name: latest.accepted_by_name,
          accepted_by_email: latest.accepted_by_email,
          package_id: latest.package_id,
          addon_ids: parseJson(latest.addon_ids_json, []),
          subscription_terms: parseJson(latest.subscription_terms_json, {})
        }
        : null,
      active_version: active,
      needs_reacceptance: needsReaccept,
      history: history.map((h) => ({
        id: h.id,
        contract_version_id: h.contract_version_id,
        version_label: h.version_label,
        accepted_at: h.accepted_at,
        accepted_by_name: h.accepted_by_name,
        package_id: h.package_id
      }))
    }
  };
}

function acceptContract(shopId, data, meta = {}) {
  ensureSchema();
  assertNotChisa({ id: shopId });
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shopId)]);
  if (!shop) throw new Error('Shop not found');
  const versionId = data.contract_version_id
    || dbGet('SELECT id FROM platform_contract_versions WHERE is_active = 1 LIMIT 1')?.id;
  if (!versionId) throw new Error('No active contract version');
  const ver = dbGet('SELECT * FROM platform_contract_versions WHERE id = ?', [versionId]);
  if (!ver) throw new Error('Contract version not found');
  const id = uid('cacc');
  const now = nowIso();
  const addonIds = Array.isArray(data.addon_ids)
    ? data.addon_ids
    : dbAll('SELECT addon_id FROM platform_shop_addons WHERE shop_key = ?', [shopId]).map((r) => r.addon_id);
  dbRun(
    `INSERT INTO platform_contract_acceptances (
      id, shop_id, contract_version_id, accepted_at, accepted_by_name, accepted_by_email,
      package_id, addon_ids_json, subscription_terms_json, ip_hint, user_agent_hint, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, shopId, versionId, now,
      data.accepted_by_name || shop.owner_name || '',
      data.accepted_by_email || shop.owner_email || '',
      data.package_id || shop.package_id || null,
      JSON.stringify(addonIds),
      JSON.stringify(data.subscription_terms || parseJson(ver.terms_json, {})),
      String(meta.ip_hint || '').slice(0, 64),
      String(meta.user_agent_hint || '').slice(0, 200),
      now
    ]
  );
  // Never overwrite history — append only
  audit({ username: data.accepted_by_email || 'customer' }, 'contract_accepted', shopId, {
    acceptance_id: id,
    contract_version_id: versionId,
    version_label: ver.version_label
  });
  return { success: true, data: getShopContractStatus(shopId).data };
}

function getAcceptedAgreementPrintable(shopId, acceptanceId) {
  requireEnabled();
  ensureSchema();
  const acc = acceptanceId
    ? dbGet('SELECT * FROM platform_contract_acceptances WHERE id = ? AND shop_id = ?', [acceptanceId, shopId])
    : dbGet('SELECT * FROM platform_contract_acceptances WHERE shop_id = ? ORDER BY accepted_at DESC LIMIT 1', [shopId]);
  if (!acc) throw new Error('No acceptance record');
  const ver = dbGet('SELECT * FROM platform_contract_versions WHERE id = ?', [acc.contract_version_id]);
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [shopId]);
  return {
    success: true,
    data: {
      acceptance_id: acc.id,
      accepted_at: acc.accepted_at,
      accepted_by_name: acc.accepted_by_name,
      accepted_by_email: acc.accepted_by_email,
      shop_name: shop?.shop_name,
      shop_id: shopId,
      version_label: ver?.version_label,
      title: ver?.title,
      body_text: ver?.body_text,
      package_id: acc.package_id,
      addon_ids: parseJson(acc.addon_ids_json, []),
      subscription_terms: parseJson(acc.subscription_terms_json, {}),
      legal_notice: 'This agreement text is configurable and must be reviewed by a qualified South African legal professional before commercial use.'
    }
  };
}

/* ───────────── Activation ───────────── */

function generateReadableCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function createActivation(shopId, data = {}, actor) {
  requireEnabled();
  ensureSchema();
  assertNotChisa({ id: shopId });
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shopId)]);
  if (!shop) throw new Error('Shop not found');
  if (Number(shop.contract_required) !== 0) {
    const acc = dbGet(
      'SELECT id FROM platform_contract_acceptances WHERE shop_id = ? ORDER BY accepted_at DESC LIMIT 1',
      [shopId]
    );
    if (!acc) throw new Error('Contract must be accepted before generating activation');
  }
  const code = generateReadableCode();
  const linkToken = crypto.randomBytes(24).toString('base64url');
  const hours = Math.max(1, Number(data.expires_hours || 72) || 72);
  const expiresAt = new Date(serverNowMs() + hours * 3600 * 1000).toISOString();
  const id = uid('act');
  const now = nowIso();
  dbRun(
    `INSERT INTO platform_activations (
      id, shop_id, code_hash, code_hint, link_token_hash, expires_at, max_uses, use_count,
      status, created_at, created_by, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, shopId, hashSecret(code), code.slice(-4),
      hashSecret(linkToken), expiresAt,
      Math.max(1, Number(data.max_uses || 1) || 1), 0,
      'active', now, actorName(actor), data.notes || ''
    ]
  );
  audit(actor, 'activation_generated', shopId, {
    activation_id: id,
    expires_at: expiresAt,
    code_hint: code.slice(-4),
    max_uses: data.max_uses || 1
  });
  // Return secrets once — never stored plaintext
  const base = String(data.public_base_url || process.env.PLATFORM_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return {
    success: true,
    data: {
      id,
      shop_id: shopId,
      code,
      activation_link: base ? `${base}/activate?token=${encodeURIComponent(linkToken)}&shop=${encodeURIComponent(shopId)}` : null,
      link_token: linkToken,
      qr_payload: JSON.stringify({ t: 'shoppos_activate', shop_id: shopId, token: linkToken }),
      expires_at: expiresAt,
      status: 'active',
      code_hint: code.slice(-4)
    }
  };
}

function listActivations(shopId) {
  requireEnabled();
  ensureSchema();
  const rows = dbAll(
    `SELECT id, shop_id, code_hint, expires_at, max_uses, use_count, status, created_at, revoked_at, last_used_at, notes
     FROM platform_activations WHERE shop_id = ? ORDER BY created_at DESC`,
    [String(shopId)]
  );
  return { success: true, data: rows };
}

function revokeActivation(activationId, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_activations WHERE id = ?', [String(activationId)]);
  if (!row) throw new Error('Activation not found');
  dbRun(
    `UPDATE platform_activations SET status='revoked', revoked_at=?, revoked_by=? WHERE id=?`,
    [nowIso(), actorName(actor), activationId]
  );
  audit(actor, 'activation_revoked', row.shop_id, { activation_id: activationId });
  return { success: true, data: { id: activationId, status: 'revoked' } };
}

function regenerateActivation(shopId, data, actor) {
  requireEnabled();
  ensureSchema();
  const active = dbAll(
    `SELECT id FROM platform_activations WHERE shop_id = ? AND status = 'active'`,
    [String(shopId)]
  );
  for (const a of active) revokeActivation(a.id, actor);
  return createActivation(shopId, data || {}, actor);
}

function _consumeActivation(row) {
  const now = serverNowMs();
  if (row.status !== 'active') {
    const err = new Error('Activation is not active');
    err.code = 'ACTIVATION_INVALID';
    throw err;
  }
  if (Date.parse(row.expires_at) < now) {
    dbRun(`UPDATE platform_activations SET status='expired' WHERE id=?`, [row.id]);
    const err = new Error('Activation has expired');
    err.code = 'ACTIVATION_EXPIRED';
    throw err;
  }
  if (Number(row.use_count) >= Number(row.max_uses || 1)) {
    const err = new Error('Activation already used');
    err.code = 'ACTIVATION_USED';
    throw err;
  }
  const nextCount = Number(row.use_count) + 1;
  const done = nextCount >= Number(row.max_uses || 1);
  dbRun(
    `UPDATE platform_activations SET use_count=?, last_used_at=?, status=? WHERE id=?`,
    [nextCount, nowIso(), done ? 'used' : 'active', row.id]
  );
}

function redeemActivation({ code, link_token, shop_id, device }) {
  ensureSchema();
  assertNotChisa({ id: shop_id });
  if (!shop_id) throw new Error('shop_id required');
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shop_id)]);
  if (!shop) throw new Error('Shop not found');

  let row = null;
  if (code) {
    const hash = hashSecret(String(code).trim().toUpperCase());
    row = dbGet(
      `SELECT * FROM platform_activations WHERE shop_id = ? AND code_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [shop_id, hash]
    );
  } else if (link_token) {
    const hash = hashSecret(String(link_token).trim());
    row = dbGet(
      `SELECT * FROM platform_activations WHERE shop_id = ? AND link_token_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [shop_id, hash]
    );
  } else {
    throw new Error('code or link_token required');
  }
  if (!row) {
    const err = new Error('Invalid activation credentials');
    err.code = 'ACTIVATION_INVALID';
    throw err;
  }
  // Cross-shop misuse: hash is scoped to shop_id already
  _consumeActivation(row);

  const deviceResult = registerDevice(shop_id, device || {}, { username: 'activation' });
  dbRun(
    `UPDATE platform_shops SET activation_status=?, updated_at=? WHERE id=?`,
    ['activated', nowIso(), shop_id]
  );
  audit({ username: 'activation' }, 'device_activated', shop_id, {
    activation_id: row.id,
    device_id: deviceResult.data?.id,
    device_public_id: deviceResult.data?.device_public_id
  });

  const lease = issueLicenseLease(shop_id, deviceResult.data.id);

  return {
    success: true,
    data: {
      shop_id,
      shop_name: shop.shop_name,
      activation_status: 'activated',
      device: deviceResult.data,
      license: lease.data
    }
  };
}

/* ───────────── Devices ───────────── */

function registerDevice(shopId, data = {}, actor) {
  ensureSchema();
  assertNotChisa({ id: shopId });
  const publicId = String(data.device_public_id || uid('devpub')).trim();
  const existing = dbGet(
    'SELECT * FROM platform_devices WHERE shop_id = ? AND device_public_id = ?',
    [shopId, publicId]
  );
  const now = nowIso();
  if (existing) {
    if (existing.status === 'revoked') {
      const err = new Error('Device has been revoked');
      err.code = 'DEVICE_REVOKED';
      throw err;
    }
    dbRun(
      `UPDATE platform_devices SET device_name=?, device_type=?, app_version=?, last_seen_at=?, meta_json=? WHERE id=?`,
      [
        data.device_name != null ? data.device_name : existing.device_name,
        data.device_type || existing.device_type,
        data.app_version || existing.app_version,
        now,
        JSON.stringify({ ...parseJson(existing.meta_json, {}), ...(data.meta || {}) }),
        existing.id
      ]
    );
    return { success: true, data: mapDevice(dbGet('SELECT * FROM platform_devices WHERE id = ?', [existing.id])) };
  }
  const id = uid('pdev');
  dbRun(
    `INSERT INTO platform_devices (
      id, shop_id, device_public_id, device_name, device_type, app_version, status,
      registered_at, last_seen_at, meta_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id, shopId, publicId,
      data.device_name || 'Device',
      data.device_type || 'unknown',
      data.app_version || '',
      'active', now, now,
      JSON.stringify(data.meta || {})
    ]
  );
  audit(actor, 'device_registered', shopId, { device_id: id, device_public_id: publicId });
  return { success: true, data: mapDevice(dbGet('SELECT * FROM platform_devices WHERE id = ?', [id])) };
}

function mapDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    device_public_id: row.device_public_id,
    device_name: row.device_name,
    device_type: row.device_type,
    app_version: row.app_version,
    status: row.status,
    registered_at: row.registered_at,
    last_connection: row.last_seen_at,
    last_successful_license_validation: row.last_license_ok_at,
    license_expires_at: row.license_expires_at,
    revoked_at: row.revoked_at
  };
}

function listDevices(shopId) {
  requireEnabled();
  ensureSchema();
  const rows = dbAll(
    'SELECT * FROM platform_devices WHERE shop_id = ? ORDER BY registered_at DESC',
    [String(shopId)]
  );
  return { success: true, data: rows.map(mapDevice) };
}

function revokeDevice(deviceId, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_devices WHERE id = ?', [String(deviceId)]);
  if (!row) throw new Error('Device not found');
  const now = nowIso();
  dbRun(
    `UPDATE platform_devices SET status='revoked', revoked_at=?, revoked_by=? WHERE id=?`,
    [now, actorName(actor), deviceId]
  );
  dbRun(
    `UPDATE platform_license_leases SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL`,
    [now, deviceId]
  );
  audit(actor, 'device_revoked', row.shop_id, { device_id: deviceId, device_public_id: row.device_public_id });
  return { success: true, data: mapDevice(dbGet('SELECT * FROM platform_devices WHERE id = ?', [deviceId])) };
}

/* ───────────── Offline license (server-authoritative) ───────────── */

function offlineGraceHours() {
  return Math.max(1, Number(process.env.SAAS_OFFLINE_LICENSE_HOURS || 72) || 72);
}

function issueLicenseLease(shopId, deviceId) {
  ensureSchema();
  const device = dbGet('SELECT * FROM platform_devices WHERE id = ? AND shop_id = ?', [deviceId, shopId]);
  if (!device) throw new Error('Device not found');
  if (device.status === 'revoked') {
    const err = new Error('Device revoked');
    err.code = 'DEVICE_REVOKED';
    throw err;
  }
  const access = evaluateShopAccess(dbGet('SELECT * FROM platform_shops WHERE id = ?', [shopId]));
  if (!access.allowed) {
    const err = new Error('Shop access blocked');
    err.code = 'SHOP_SUSPENDED';
    err.access = access;
    throw err;
  }
  const issuedAt = nowIso();
  const expiresAt = new Date(serverNowMs() + offlineGraceHours() * 3600 * 1000).toISOString();
  const id = uid('lease');
  const nonce = crypto.randomBytes(16).toString('hex');
  dbRun(
    `INSERT INTO platform_license_leases (id, shop_id, device_id, issued_at, expires_at, last_validated_at, nonce)
     VALUES (?,?,?,?,?,?,?)`,
    [id, shopId, deviceId, issuedAt, expiresAt, issuedAt, nonce]
  );
  dbRun(
    `UPDATE platform_devices SET last_license_ok_at=?, license_expires_at=?, last_seen_at=? WHERE id=?`,
    [issuedAt, expiresAt, issuedAt, deviceId]
  );
  return {
    success: true,
    data: {
      lease_id: id,
      shop_id: shopId,
      device_id: deviceId,
      issued_at: issuedAt,
      expires_at: expiresAt,
      nonce,
      // Client stores these server timestamps — must not trust local clock for validity
      server_time: issuedAt
    }
  };
}

function validateLicense({ shop_id, device_public_id }) {
  ensureSchema();
  const device = dbGet(
    'SELECT * FROM platform_devices WHERE shop_id = ? AND device_public_id = ?',
    [String(shop_id), String(device_public_id)]
  );
  if (!device) {
    const err = new Error('Device not registered');
    err.code = 'DEVICE_UNKNOWN';
    throw err;
  }
  if (device.status === 'revoked') {
    const err = new Error('Device revoked');
    err.code = 'DEVICE_REVOKED';
    throw err;
  }
  return issueLicenseLease(shop_id, device.id);
}

function getActiveLease(deviceId) {
  return dbGet(
    `SELECT * FROM platform_license_leases
     WHERE device_id = ? AND revoked_at IS NULL
     ORDER BY issued_at DESC LIMIT 1`,
    [deviceId]
  );
}

/**
 * Offline check using stored server-issued expires_at compared to... we need a
 * monotonic reference. For true offline, the client must compare lease.expires_at
 * against the last known server_time advanced by elapsed wall time carefully.
 * Server enforcement: when online, always re-validate. When offline, client uses
 * issued server timestamps; this helper checks a claimed lease against server now
 * when connectivity exists.
 */
function assertDeviceLicense(devicePublicId, shopId) {
  if (!devicePublicId) return { skipped: true };
  ensureSchema();
  const sid = shopId || entitlements?.shopKey?.() || process.env.SHOP_ENTITLEMENT_KEY;
  if (!sid) return { skipped: true };
  const device = dbGet(
    'SELECT * FROM platform_devices WHERE shop_id = ? AND device_public_id = ?',
    [sid, String(devicePublicId)]
  );
  if (!device) return { skipped: true };
  if (device.status === 'revoked') {
    const err = new Error('DEVICE_REVOKED');
    err.code = 'DEVICE_REVOKED';
    err.status = 403;
    throw err;
  }
  const lease = getActiveLease(device.id);
  if (!lease) {
    const err = new Error('LICENSE_REQUIRED');
    err.code = 'LICENSE_REQUIRED';
    err.status = 403;
    throw err;
  }
  if (Date.parse(lease.expires_at) < serverNowMs()) {
    const err = new Error('LICENSE_EXPIRED');
    err.code = 'LICENSE_EXPIRED';
    err.status = 403;
    err.message_payload = getAccessMessage('offline_auth_expired');
    throw err;
  }
  return { allowed: true, expires_at: lease.expires_at };
}

/**
 * Client-side offline gate helper: given a lease issued by server, decide if
 * protected ops may continue. Uses last_server_time + elapsed_ms (from a
 * monotonic timer) rather than Date.now() on the device.
 */
function evaluateOfflineLease(lease, { elapsed_ms_since_last_server_sync } = {}) {
  if (!lease?.expires_at || !lease?.issued_at) {
    return { allowed: false, reason: 'no_lease' };
  }
  const issued = Date.parse(lease.issued_at);
  const expires = Date.parse(lease.expires_at);
  const elapsed = Math.max(0, Number(elapsed_ms_since_last_server_sync) || 0);
  const estimatedNow = issued + elapsed;
  if (estimatedNow >= expires) {
    return {
      allowed: false,
      reason: 'offline_auth_expired',
      message: getAccessMessage('offline_auth_expired')
    };
  }
  return { allowed: true, estimated_server_now: new Date(estimatedNow).toISOString(), expires_at: lease.expires_at };
}

/* ───────────── Service fees ───────────── */

function mapFee(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    scope_id: row.scope_id || '',
    enabled: Number(row.enabled) === 1,
    fee_type: row.fee_type,
    percent: Number(row.percent) || 0,
    fixed_amount: Number(row.fixed_amount) || 0,
    currency: row.currency || 'ZAR',
    label: row.label || 'Platform service fee',
    updated_at: row.updated_at
  };
}

function getEffectiveServiceFee({ package_id, shop_id } = {}) {
  ensureSchema();
  const pick = (scope, scopeId) =>
    dbGet('SELECT * FROM platform_service_fees WHERE scope = ? AND scope_id = ?', [scope, scopeId || '']);

  let row = shop_id ? pick('customer', shop_id) : null;
  if (!row || Number(row.enabled) === 0) {
    // customer override disabled → fall through; missing → fall through
    if (row && Number(row.enabled) === 0 && row.scope === 'customer') {
      /* explicit disable for customer */
      return { enabled: false, amount: 0, label: row.label, config: mapFee(row), source: 'customer_disabled' };
    }
    row = null;
  }
  if (!row && package_id) row = pick('package', package_id);
  if (!row) row = pick('platform_default', '');
  if (!row || Number(row.enabled) === 0) {
    return { enabled: false, amount: 0, label: 'Platform service fee', config: mapFee(row), source: row ? row.scope : 'none' };
  }
  return { enabled: true, config: mapFee(row), source: row.scope };
}

function calculateServiceFee(subtotal, opts = {}) {
  const eff = getEffectiveServiceFee(opts);
  if (!eff.enabled || !eff.config) {
    return {
      enabled: false,
      amount: 0,
      label: eff.label || 'Platform service fee',
      config: eff.config,
      source: eff.source,
      display: null
    };
  }
  const c = eff.config;
  const base = Math.max(0, Number(subtotal) || 0);
  let amount = 0;
  if (c.fee_type === 'fixed') amount = Number(c.fixed_amount) || 0;
  else if (c.fee_type === 'percent_plus_fixed') {
    amount = (base * (Number(c.percent) || 0)) / 100 + (Number(c.fixed_amount) || 0);
  } else {
    amount = (base * (Number(c.percent) || 0)) / 100;
  }
  amount = Math.round(amount * 100) / 100;
  return {
    enabled: true,
    amount,
    label: c.label,
    config: c,
    source: eff.source,
    display: {
      label: c.label,
      amount,
      currency: c.currency,
      fee_type: c.fee_type,
      percent: c.percent,
      fixed_amount: c.fixed_amount
    }
  };
}

function upsertServiceFee(data, actor) {
  requireEnabled();
  ensureSchema();
  const scope = String(data.scope || 'platform_default');
  const scopeId = data.scope_id || '';
  if (!['platform_default', 'package', 'customer'].includes(scope)) {
    throw new Error('Invalid fee scope');
  }
  const existing = dbGet(
    'SELECT id FROM platform_service_fees WHERE scope = ? AND scope_id = ?',
    [scope, scopeId]
  );
  const now = nowIso();
  const feeType = data.fee_type || 'percent';
  if (!['percent', 'fixed', 'percent_plus_fixed'].includes(feeType)) {
    throw new Error('Invalid fee_type');
  }
  if (existing) {
    dbRun(
      `UPDATE platform_service_fees SET enabled=?, fee_type=?, percent=?, fixed_amount=?, currency=?, label=?, updated_at=?, updated_by=?
       WHERE id=?`,
      [
        data.enabled === false || data.enabled === 0 ? 0 : 1,
        feeType,
        Number(data.percent) || 0,
        Number(data.fixed_amount) || 0,
        data.currency || 'ZAR',
        data.label || 'Platform service fee',
        now, actorName(actor), existing.id
      ]
    );
  } else {
    dbRun(
      `INSERT INTO platform_service_fees (id, scope, scope_id, enabled, fee_type, percent, fixed_amount, currency, label, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uid('fee'), scope, scopeId,
        data.enabled === false || data.enabled === 0 ? 0 : 1,
        feeType,
        Number(data.percent) || 0,
        Number(data.fixed_amount) || 0,
        data.currency || 'ZAR',
        data.label || 'Platform service fee',
        now, actorName(actor)
      ]
    );
  }
  audit(actor, 'service_fee_changed', scope === 'customer' ? scopeId : null, {
    scope, scope_id: scopeId, fee_type: feeType, enabled: data.enabled !== false
  });
  return { success: true, data: mapFee(dbGet('SELECT * FROM platform_service_fees WHERE scope = ? AND scope_id = ?', [scope, scopeId])) };
}

function listServiceFees() {
  requireEnabled();
  ensureSchema();
  return { success: true, data: dbAll('SELECT * FROM platform_service_fees ORDER BY scope, scope_id').map(mapFee) };
}

/* ───────────── Notifications ───────────── */

function listNotificationRules() {
  requireEnabled();
  ensureSchema();
  return { success: true, data: dbAll('SELECT * FROM platform_notification_rules ORDER BY days_before DESC, channel') };
}

function updateNotificationRule(id, data, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_notification_rules WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Rule not found');
  dbRun(
    `UPDATE platform_notification_rules SET enabled=?, template_subject=?, template_body=?, updated_at=? WHERE id=?`,
    [
      data.enabled === false || data.enabled === 0 ? 0 : (data.enabled != null ? 1 : row.enabled),
      data.template_subject != null ? data.template_subject : row.template_subject,
      data.template_body != null ? data.template_body : row.template_body,
      nowIso(), id
    ]
  );
  audit(actor, 'notification_rule_changed', null, { rule_id: id });
  return { success: true, data: dbGet('SELECT * FROM platform_notification_rules WHERE id = ?', [id]) };
}

function listNotificationLog(shopId, limit = 50) {
  requireEnabled();
  ensureSchema();
  const rows = shopId
    ? dbAll(
      'SELECT * FROM platform_notification_log WHERE shop_id = ? ORDER BY sent_at DESC LIMIT ?',
      [String(shopId), Math.min(Number(limit) || 50, 200)]
    )
    : dbAll('SELECT * FROM platform_notification_log ORDER BY sent_at DESC LIMIT ?', [Math.min(Number(limit) || 50, 200)]);
  return { success: true, data: rows };
}

/**
 * Process expiry reminders for all shops (or one). Deduped by shop+channel+days+expiry date.
 * Channels: email (logged as queued), whatsapp (logged), sms (architecture-ready stub).
 */
function processSubscriptionNotifications(opts = {}) {
  ensureSchema();
  const shopFilter = opts.shop_id ? [opts.shop_id] : null;
  const shopsList = shopFilter
    ? dbAll('SELECT * FROM platform_shops WHERE id = ?', shopFilter)
    : dbAll('SELECT * FROM platform_shops');
  const rules = dbAll('SELECT * FROM platform_notification_rules WHERE enabled = 1');
  const sent = [];
  const now = serverNowMs();

  for (const shop of shopsList) {
    if (shopsMod()?.assertNotChisaFood) {
      try { shopsMod().assertNotChisaFood(shop); } catch (_) { continue; }
    }
    const expiryIso = shop.subscription_expiry || shop.trial_end;
    if (!expiryIso) continue;
    const expiryMs = Date.parse(expiryIso);
    if (Number.isNaN(expiryMs)) continue;
    const daysLeft = Math.ceil((expiryMs - now) / 86400000);

    for (const rule of rules) {
      if (Number(rule.days_before) !== daysLeft && !(Number(rule.days_before) === 0 && daysLeft <= 0)) {
        // Exact day match; expired rule fires when daysLeft <= 0 once
        if (!(Number(rule.days_before) === 0 && daysLeft <= 0)) continue;
      }
      if (Number(rule.days_before) !== 0 && Number(rule.days_before) !== daysLeft) continue;

      const dayKey = Number(rule.days_before) === 0 ? 'expired' : String(rule.days_before);
      const dedupe = `${shop.id}:${rule.channel}:${dayKey}:${expiryIso.slice(0, 10)}`;
      if (dbGet('SELECT id FROM platform_notification_log WHERE dedupe_key = ?', [dedupe])) continue;

      const body = String(rule.template_body || '')
        .replace(/\{\{shop_name\}\}/g, shop.shop_name || '')
        .replace(/\{\{days\}\}/g, String(daysLeft))
        .replace(/\{\{expiry\}\}/g, expiryIso);

      // Delivery adapters — log only; SMS-ready architecture
      let status = 'queued';
      const detail = { to_email: shop.owner_email || '', to_phone: shop.contact_phone || '', body };
      if (rule.channel === 'email') {
        status = shop.owner_email ? 'queued_email' : 'skipped_no_email';
      } else if (rule.channel === 'whatsapp') {
        status = shop.contact_phone ? 'queued_whatsapp' : 'skipped_no_phone';
      } else if (rule.channel === 'sms') {
        status = 'sms_ready_stub';
      }

      const id = uid('nlog');
      dbRun(
        `INSERT INTO platform_notification_log (id, shop_id, channel, rule_id, days_before, sent_at, status, detail_json, dedupe_key)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, shop.id, rule.channel, rule.id, rule.days_before, nowIso(), status, JSON.stringify(detail), dedupe]
      );
      sent.push({ id, shop_id: shop.id, channel: rule.channel, days_before: rule.days_before, status });
      audit({ username: 'system' }, 'subscription_notification_sent', shop.id, {
        channel: rule.channel, days_before: rule.days_before, status
      });
    }
  }
  return { success: true, data: { sent_count: sent.length, sent } };
}

/* ───────────── Customer control aggregate ───────────── */

function getCustomerControl(shopId) {
  requireEnabled();
  ensureSchema();
  const shops = shopsMod();
  if (!shops?.getShop) throw new Error('platform-shops unavailable');
  const shop = shops.getShop(shopId).data;
  return {
    success: true,
    data: {
      customer: shop,
      contract: getShopContractStatus(shopId).data,
      package: shop.package_id,
      addons: shop.addon_ids,
      subscription: getCountdown(shopId).data,
      activation: listActivations(shopId).data,
      devices: listDevices(shopId).data,
      service_fee: getEffectiveServiceFee({ package_id: shop.package_id, shop_id: shopId }),
      notifications: listNotificationLog(shopId, 20).data,
      health: null,
      access: evaluateShopAccess(dbGet('SELECT * FROM platform_shops WHERE id = ?', [shopId])),
      audit: shops.listAuditForShop(shopId, 40).data
    }
  };
}

module.exports = {
  ensureSchema,
  // access
  evaluateShopAccess,
  getShopAccessById,
  getCountdown,
  getCurrentShopAccess,
  assertShopAccess,
  getAccessMessage,
  setAccessMessage,
  listAccessMessages,
  // contracts
  listContractVersions,
  getContractVersion,
  getActiveContract,
  createContractVersion,
  getShopContractStatus,
  acceptContract,
  getAcceptedAgreementPrintable,
  // activation
  createActivation,
  listActivations,
  revokeActivation,
  regenerateActivation,
  redeemActivation,
  // devices
  registerDevice,
  listDevices,
  revokeDevice,
  // license
  issueLicenseLease,
  validateLicense,
  assertDeviceLicense,
  evaluateOfflineLease,
  offlineGraceHours,
  // fees
  getEffectiveServiceFee,
  calculateServiceFee,
  upsertServiceFee,
  listServiceFees,
  // notifications
  listNotificationRules,
  updateNotificationRule,
  listNotificationLog,
  processSubscriptionNotifications,
  // aggregate
  getCustomerControl
};
