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
  ['suspension_message', "TEXT DEFAULT ''"],
  ['owner_id_number', "TEXT DEFAULT ''"],
  ['whatsapp', "TEXT DEFAULT ''"],
  ['postal_address', "TEXT DEFAULT ''"],
  ['company_name', "TEXT DEFAULT ''"],
  ['company_registration', "TEXT DEFAULT ''"],
  ['shop_address', "TEXT DEFAULT ''"],
  ['shop_phone', "TEXT DEFAULT ''"],
  ['branch_info', "TEXT DEFAULT ''"]
];

const CONTRACT_VERSION_EXTRA_COLS = [
  ['status', "TEXT DEFAULT 'published'"],
  ['effective_at', 'TEXT'],
  ['require_reacceptance', 'INTEGER DEFAULT 1'],
  ['placeholders_json', "TEXT DEFAULT '{}'"]
];

const ACCEPTANCE_EXTRA_COLS = [
  ['signature_data', "TEXT DEFAULT ''"],
  ['body_text_snapshot', "TEXT DEFAULT ''"],
  ['placeholders_snapshot_json', "TEXT DEFAULT '{}'"],
  ['device_public_id', "TEXT DEFAULT ''"],
  ['signed_document_json', "TEXT DEFAULT '{}'"]
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
  for (const [col, def] of CONTRACT_VERSION_EXTRA_COLS) {
    try {
      dbGet(`SELECT ${col} FROM platform_contract_versions LIMIT 1`);
    } catch (_) {
      try { dbRun(`ALTER TABLE platform_contract_versions ADD COLUMN ${col} ${def}`); } catch (__) { /* */ }
    }
  }
  for (const [col, def] of ACCEPTANCE_EXTRA_COLS) {
    try {
      dbGet(`SELECT ${col} FROM platform_contract_acceptances LIMIT 1`);
    } catch (_) {
      try { dbRun(`ALTER TABLE platform_contract_acceptances ADD COLUMN ${col} ${def}`); } catch (__) { /* */ }
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
    try {
      dbRun(
        `INSERT INTO platform_contract_versions (id, version_label, title, body_text, terms_json, is_active, created_at, created_by, notes, status, effective_at, require_reacceptance, placeholders_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uid('cver'), 'v1.0',
          'SaaS Customer Service Agreement (Draft)',
          DEFAULT_CONTRACT_TEMPLATE,
          JSON.stringify({
            subscription_terms: 'As configured per package',
            service_fee_terms: 'Displayed at checkout when enabled; never silently added',
            legal_notice: 'Configurable draft — review by a qualified South African legal professional before commercial use.'
          }),
          1, now, 'system', 'Draft placeholder — legal review required before commercial use',
          'published', now, 1, JSON.stringify(DEFAULT_PROVIDER_PLACEHOLDERS)
        ]
      );
    } catch (_) {
      dbRun(
        `INSERT INTO platform_contract_versions (id, version_label, title, body_text, terms_json, is_active, created_at, created_by, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          uid('cver'), 'v1.0',
          'SaaS Customer Service Agreement (Draft)',
          DEFAULT_CONTRACT_TEMPLATE,
          JSON.stringify({ subscription_terms: 'As configured per package' }),
          1, now, 'system', 'Draft placeholder — legal review required before commercial use'
        ]
      );
    }
  }
}

const DEFAULT_PROVIDER_PLACEHOLDERS = {
  service_provider_name: 'Platform Operator',
  service_provider_registration: '[Registration number]',
  service_provider_address: '[Service provider address]',
  service_provider_contact: '[Service provider contact]',
  renewal_terms: 'Subscription renews for successive periods unless cancelled or suspended according to the package terms.'
};

const DEFAULT_CONTRACT_TEMPLATE = `SAAS CUSTOMER SERVICE AGREEMENT
Version: {{contract_version}}
Effective date: {{effective_date}}

DRAFT — This agreement is configurable and must be reviewed by a qualified South African legal professional before commercial use.

1. PARTIES
1.1 Service Provider: {{service_provider_name}} (Registration: {{service_provider_registration}})
    Address: {{service_provider_address}}
    Contact: {{service_provider_contact}}
1.2 Customer: {{customer_name}}
    ID / Company registration: {{customer_id_number}}
    Email: {{customer_email}}
    Phone: {{customer_phone}}
    Address: {{customer_address}}

2. SHOP
2.1 Shop name: {{shop_name}}
2.2 Shop ID: {{shop_id}}
2.3 Shop address: {{shop_address}}
2.4 Package: {{package_name}}
2.5 Add-ons: {{addons}}
2.6 Subscription period: {{subscription_start}} to {{subscription_expiry}}
2.7 Subscription price / package fee: {{subscription_price}}
2.8 Platform service fee (if enabled): {{service_fee_terms}}
2.9 Renewal terms: {{renewal_terms}}

3. SERVICES
The Service Provider provides Shop POS software and related hosted services according to the selected package and add-ons.

4. FEES AND PAYMENT
Fees, billing periods, and platform service fees (if enabled for this shop) are as configured for the Customer. Service fees, when enabled, are calculated server-side and displayed at checkout.

5. ACCEPTABLE USE
The Customer must not misuse the service, share activation credentials improperly, or attempt to bypass access controls.

6. SUSPENSION AND REACTIVATION
The Service Provider may suspend access for overdue payment, abuse, or administrative action. Customer business data is retained and restored on reactivation.

7. DATA
Customer business data remains the Customer's. The Service Provider does not delete historical records solely due to suspension.

8. CONTRACT VERSIONS
Published contract versions are retained. Acceptance of a version creates an immutable acceptance record. Later versions do not alter prior signed acceptances.

9. GOVERNING LAW
This draft contemplates South African law. Final wording requires legal review.

By signing electronically, the Customer confirms they have read and accept this Agreement for Shop {{shop_name}} ({{shop_id}}).
`;

function buildPlaceholderMap(shop, opts = {}) {
  const fee = opts.fee || getEffectiveServiceFee({ package_id: shop?.package_id, shop_id: shop?.id });
  const provider = {
    ...DEFAULT_PROVIDER_PLACEHOLDERS,
    ...(opts.provider || {}),
    ...(parseJson(opts.versionPlaceholders, {}))
  };
  let packageName = opts.package_name || shop?.package_name || shop?.package_id || '—';
  let addonNames = opts.addon_names;
  if (!addonNames && shop?.id) {
    try {
      const shops = shopsMod();
      const detail = shops?.getShop?.(shop.id)?.data;
      if (detail) {
        packageName = detail.package_name || packageName;
        addonNames = detail.addon_names || [];
      }
    } catch (_) { /* */ }
  }
  const feeTerms = fee?.enabled
    ? `${fee.config?.fee_type || fee.fee_type || 'percent'}: ${fee.config?.percent ?? fee.percent ?? 0}% + ${fee.config?.fixed_amount ?? fee.fixed_amount ?? 0} ${fee.config?.currency || fee.currency || 'ZAR'}`
    : 'Service fee OFF for this shop';
  return {
    ...provider,
    customer_name: shop?.owner_name || shop?.company_name || '—',
    customer_id_number: shop?.owner_id_number || shop?.company_registration || '—',
    customer_email: shop?.owner_email || '—',
    customer_phone: shop?.contact_phone || shop?.whatsapp || '—',
    customer_address: shop?.address || shop?.postal_address || '—',
    shop_name: shop?.shop_name || '—',
    shop_id: shop?.id || '—',
    shop_address: shop?.shop_address || shop?.address || '—',
    package_name: packageName,
    addons: Array.isArray(addonNames) && addonNames.length ? addonNames.join(', ') : 'None',
    subscription_price: opts.subscription_price || 'As per selected package',
    service_fee_terms: feeTerms,
    subscription_start: shop?.subscription_start || shop?.trial_start || '—',
    subscription_expiry: shop?.subscription_expiry || shop?.trial_end || '—',
    subscription_period: `${shop?.subscription_start || '—'} to ${shop?.subscription_expiry || '—'}`,
    effective_date: opts.effective_date || nowIso().slice(0, 10),
    contract_version: opts.version_label || '—'
  };
}

function renderContractBody(template, placeholders) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = placeholders?.[key];
    return v == null || v === '' ? '—' : String(v);
  });
}

/* ───────────── Access evaluation (server clock) ───────────── */

function serverNowMs() {
  return Date.now(); // Node process time — never trust client clock for expiry
}

function getAccessMessage(key) {
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_access_messages WHERE message_key = ?', [key]);
  if (!row) {
    const bodyText = 'Please contact your administrator for assistance.';
    return {
      message_key: key,
      title: 'Service Temporarily Unavailable',
      body: bodyText,
      body_text: bodyText,
      contact_label: 'Contact Administrator'
    };
  }
  const bodyText = row.body_text;
  return {
    message_key: row.message_key,
    title: row.title,
    body: bodyText,
    body_text: bodyText,
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
        ? { title: msg.title, body: customMsg, body_text: customMsg, contact_label: msg.contact_label }
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
          body: 'Please accept the customer agreement before activation.',
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
    data: dbAll(
      `SELECT id, version_label, title, is_active, status, effective_at, require_reacceptance,
              created_at, created_by, notes
       FROM platform_contract_versions ORDER BY created_at DESC`
    ).map((r) => ({
      ...r,
      is_active: Number(r.is_active) === 1,
      require_reacceptance: Number(r.require_reacceptance) !== 0,
      status: r.status || (Number(r.is_active) === 1 ? 'published' : 'draft')
    }))
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
    status: row.status || (Number(row.is_active) === 1 ? 'published' : 'draft'),
    effective_at: row.effective_at || null,
    require_reacceptance: Number(row.require_reacceptance) !== 0,
    created_at: row.created_at,
    created_by: row.created_by,
    notes: row.notes,
    terms: parseJson(row.terms_json, {}),
    placeholders: parseJson(row.placeholders_json, DEFAULT_PROVIDER_PLACEHOLDERS)
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
  const publish = data.publish === true || data.activate === true;
  const asDraft = data.draft === true || (!publish && data.activate === false);
  if (publish) {
    dbRun('UPDATE platform_contract_versions SET is_active = 0');
  }
  const placeholders = {
    ...DEFAULT_PROVIDER_PLACEHOLDERS,
    ...(data.placeholders && typeof data.placeholders === 'object' ? data.placeholders : {})
  };
  dbRun(
    `INSERT INTO platform_contract_versions (
      id, version_label, title, body_text, terms_json, is_active, created_at, created_by, notes,
      status, effective_at, require_reacceptance, placeholders_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      String(data.version_label || `v${Date.now()}`).trim(),
      String(data.title || 'SaaS Customer Service Agreement').trim(),
      String(data.body_text || '').trim() || DEFAULT_CONTRACT_TEMPLATE,
      JSON.stringify(data.terms || {}),
      publish ? 1 : 0,
      now,
      actorName(actor),
      data.notes || 'Configurable agreement — review by SA legal professional before commercial use',
      publish ? 'published' : 'draft',
      data.effective_at || (publish ? now : null),
      data.require_reacceptance === false || data.require_reacceptance === 0 ? 0 : 1,
      JSON.stringify(placeholders)
    ]
  );
  audit(actor, 'contract_version_changed', null, {
    contract_version_id: id,
    publish,
    draft: asDraft || !publish,
    require_reacceptance: data.require_reacceptance !== false
  });
  return getContractVersion(id);
}

function updateDraftContract(id, data, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_contract_versions WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Contract version not found');
  const status = row.status || (Number(row.is_active) === 1 ? 'published' : 'draft');
  if (status === 'published' || Number(row.is_active) === 1) {
    throw new Error('Published contracts cannot be edited — create a new version');
  }
  const placeholders = data.placeholders
    ? { ...DEFAULT_PROVIDER_PLACEHOLDERS, ...data.placeholders }
    : parseJson(row.placeholders_json, DEFAULT_PROVIDER_PLACEHOLDERS);
  dbRun(
    `UPDATE platform_contract_versions SET
      version_label=?, title=?, body_text=?, terms_json=?, notes=?,
      effective_at=?, require_reacceptance=?, placeholders_json=?, status='draft'
     WHERE id=?`,
    [
      data.version_label != null ? String(data.version_label).trim() : row.version_label,
      data.title != null ? String(data.title).trim() : row.title,
      data.body_text != null ? String(data.body_text) : row.body_text,
      JSON.stringify(data.terms != null ? data.terms : parseJson(row.terms_json, {})),
      data.notes != null ? data.notes : row.notes,
      data.effective_at !== undefined ? data.effective_at : row.effective_at,
      data.require_reacceptance === false || data.require_reacceptance === 0 ? 0
        : (data.require_reacceptance === true || data.require_reacceptance === 1 ? 1
          : (row.require_reacceptance != null ? Number(row.require_reacceptance) : 1)),
      JSON.stringify(placeholders),
      id
    ]
  );
  audit(actor, 'contract_draft_saved', null, { contract_version_id: id });
  return getContractVersion(id);
}

function publishContractVersion(id, data = {}, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_contract_versions WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Contract version not found');
  dbRun('UPDATE platform_contract_versions SET is_active = 0');
  const requireRe = data.require_reacceptance === false || data.require_reacceptance === 0
    ? 0
    : (data.require_reacceptance === true || data.require_reacceptance === 1
      ? 1
      : (row.require_reacceptance != null ? Number(row.require_reacceptance) : 1));
  const effective = data.effective_at || row.effective_at || nowIso();
  dbRun(
    `UPDATE platform_contract_versions SET
      is_active=1, status='published', effective_at=?, require_reacceptance=?
     WHERE id=?`,
    [effective, requireRe, id]
  );
  audit(actor, 'contract_published', null, {
    contract_version_id: id,
    require_reacceptance: !!requireRe,
    effective_at: effective
  });
  return getContractVersion(id);
}

function previewContract(id, shopId) {
  requireEnabled();
  ensureSchema();
  const ver = dbGet('SELECT * FROM platform_contract_versions WHERE id = ?', [String(id)]);
  if (!ver) throw new Error('Contract version not found');
  let shop = null;
  if (shopId) {
    shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shopId)]);
    if (!shop) throw new Error('Shop not found');
  }
  const placeholders = buildPlaceholderMap(shop || {
    shop_name: '[Shop name]',
    id: '[Shop ID]',
    owner_name: '[Customer name]'
  }, {
    version_label: ver.version_label,
    effective_date: (ver.effective_at || nowIso()).slice(0, 10),
    versionPlaceholders: ver.placeholders_json
  });
  return {
    success: true,
    data: {
      id: ver.id,
      version_label: ver.version_label,
      title: ver.title,
      placeholders,
      body_text: renderContractBody(ver.body_text, placeholders),
      template_body: ver.body_text
    }
  };
}

function listContractAcceptances({ contract_version_id, shop_id, limit = 100 } = {}) {
  requireEnabled();
  ensureSchema();
  let sql = `SELECT a.id, a.shop_id, a.contract_version_id, a.accepted_at, a.accepted_by_name,
                    a.accepted_by_email, a.package_id, a.device_public_id, a.created_at,
                    v.version_label, v.title, s.shop_name
             FROM platform_contract_acceptances a
             LEFT JOIN platform_contract_versions v ON v.id = a.contract_version_id
             LEFT JOIN platform_shops s ON s.id = a.shop_id
             WHERE 1=1`;
  const params = [];
  if (contract_version_id) {
    sql += ' AND a.contract_version_id = ?';
    params.push(String(contract_version_id));
  }
  if (shop_id) {
    sql += ' AND a.shop_id = ?';
    params.push(String(shop_id));
  }
  sql += ' ORDER BY a.accepted_at DESC LIMIT ?';
  params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
  return {
    success: true,
    data: dbAll(sql, params).map((r) => ({
      id: r.id,
      acceptance_id: r.id,
      shop_id: r.shop_id,
      shop_name: r.shop_name,
      contract_version_id: r.contract_version_id,
      version_label: r.version_label,
      title: r.title,
      accepted_at: r.accepted_at,
      accepted_by_name: r.accepted_by_name,
      accepted_by_email: r.accepted_by_email,
      package_id: r.package_id,
      device_public_id: r.device_public_id || null,
      has_signature: !!(dbGet('SELECT length(signature_data) AS n FROM platform_contract_acceptances WHERE id = ?', [r.id])?.n)
    }))
  };
}

function getShopContractStatus(shopId) {
  // Readable on customer instances after activation-bundle sync (no PLATFORM_CONTROL_ENABLED required).
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
  const active = dbGet(
    `SELECT id, version_label, title, require_reacceptance, effective_at, status
     FROM platform_contract_versions WHERE is_active = 1 LIMIT 1`
  );
  const requireRe = active ? Number(active.require_reacceptance) !== 0 : true;
  const needsReaccept = !!(active && latest && latest.contract_version_id !== active.id && requireRe);
  const neverAccepted = !!(active && !latest && Number(shop.contract_required) !== 0);
  return {
    success: true,
    data: {
      shop_id: shopId,
      contract_required: Number(shop.contract_required) !== 0,
      accepted: !!latest && !needsReaccept,
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
          subscription_terms: parseJson(latest.subscription_terms_json, {}),
          has_signature: !!(latest.signature_data && String(latest.signature_data).length > 40)
        }
        : null,
      active_version: active,
      needs_reacceptance: needsReaccept || neverAccepted,
      reacceptance_message: (needsReaccept || neverAccepted)
        ? 'Your Service Agreement has been updated. Please review and accept the new agreement to continue.'
        : null,
      history: history.map((h) => ({
        id: h.id,
        contract_version_id: h.contract_version_id,
        version_label: h.version_label,
        accepted_at: h.accepted_at,
        accepted_by_name: h.accepted_by_name,
        package_id: h.package_id,
        has_signature: !!(h.signature_data && String(h.signature_data).length > 40)
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

  const signature = String(data.signature_data || data.signature || '').trim();
  if (data.require_signature === true) {
    // Activation / customer sign path requires a drawn signature (data URL).
    if (!signature || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(signature) || signature.length < 80) {
      const err = new Error('Please draw your signature before accepting the contract');
      err.code = 'SIGNATURE_REQUIRED';
      throw err;
    }
    if (signature.length > 900000) {
      const err = new Error('Signature image is too large');
      err.code = 'SIGNATURE_TOO_LARGE';
      throw err;
    }
  }

  const id = uid('cacc');
  const now = nowIso();
  const addonIds = Array.isArray(data.addon_ids)
    ? data.addon_ids
    : dbAll('SELECT addon_id FROM platform_shop_addons WHERE shop_key = ?', [shopId]).map((r) => r.addon_id);
  const placeholders = buildPlaceholderMap(shop, {
    version_label: ver.version_label,
    effective_date: (ver.effective_at || now).slice(0, 10),
    versionPlaceholders: ver.placeholders_json,
    package_name: data.package_name,
    addon_names: data.addon_names,
    subscription_price: data.subscription_price
  });
  const renderedBody = renderContractBody(ver.body_text, placeholders);
  const signedDoc = {
    acceptance_id: id,
    shop_id: shopId,
    shop_name: shop.shop_name,
    customer_name: data.accepted_by_name || shop.owner_name || '',
    customer_email: data.accepted_by_email || shop.owner_email || '',
    contract_version_id: versionId,
    version_label: ver.version_label,
    title: ver.title,
    body_text: renderedBody,
    placeholders,
    package_id: data.package_id || shop.package_id || null,
    addon_ids: addonIds,
    accepted_at: now,
    device_public_id: data.device_public_id || '',
    has_signature: !!signature
  };

  dbRun(
    `INSERT INTO platform_contract_acceptances (
      id, shop_id, contract_version_id, accepted_at, accepted_by_name, accepted_by_email,
      package_id, addon_ids_json, subscription_terms_json, ip_hint, user_agent_hint, created_at,
      signature_data, body_text_snapshot, placeholders_snapshot_json, device_public_id, signed_document_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, shopId, versionId, now,
      data.accepted_by_name || shop.owner_name || '',
      data.accepted_by_email || shop.owner_email || '',
      data.package_id || shop.package_id || null,
      JSON.stringify(addonIds),
      JSON.stringify(data.subscription_terms || parseJson(ver.terms_json, {})),
      String(meta.ip_hint || data.ip_hint || '').slice(0, 64),
      String(meta.user_agent_hint || data.user_agent_hint || '').slice(0, 200),
      now,
      signature || '',
      renderedBody,
      JSON.stringify(placeholders),
      String(data.device_public_id || '').slice(0, 120),
      JSON.stringify(signedDoc)
    ]
  );
  // Never overwrite history — append only
  audit({ username: data.accepted_by_email || 'customer' }, 'contract_accepted', shopId, {
    acceptance_id: id,
    contract_version_id: versionId,
    version_label: ver.version_label,
    has_signature: !!signature
  });
  return {
    success: true,
    data: {
      ...getShopContractStatus(shopId).data,
      acceptance_id: id,
      message: 'Contract accepted successfully.'
    }
  };
}

function getAcceptedAgreementPrintable(shopId, acceptanceId, { includeSignature = true } = {}) {
  requireEnabled();
  ensureSchema();
  const acc = acceptanceId
    ? dbGet('SELECT * FROM platform_contract_acceptances WHERE id = ? AND shop_id = ?', [acceptanceId, shopId])
    : dbGet('SELECT * FROM platform_contract_acceptances WHERE shop_id = ? ORDER BY accepted_at DESC LIMIT 1', [shopId]);
  if (!acc) throw new Error('No acceptance record');
  const ver = dbGet('SELECT * FROM platform_contract_versions WHERE id = ?', [acc.contract_version_id]);
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [shopId]);
  const signed = parseJson(acc.signed_document_json, {});
  const body = acc.body_text_snapshot || signed.body_text || ver?.body_text || '';
  const placeholders = parseJson(acc.placeholders_snapshot_json, signed.placeholders || {});
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
      body_text: body,
      placeholders,
      package_id: acc.package_id,
      addon_ids: parseJson(acc.addon_ids_json, []),
      subscription_terms: parseJson(acc.subscription_terms_json, {}),
      device_public_id: acc.device_public_id || null,
      signature_data: includeSignature ? (acc.signature_data || null) : null,
      has_signature: !!(acc.signature_data && String(acc.signature_data).length > 40),
      legal_notice: 'This agreement text is configurable and must be reviewed by a qualified South African legal professional before commercial use. Historical accepted copies are immutable snapshots.'
    }
  };
}

function getDefaultContractTemplate() {
  return {
    success: true,
    data: {
      title: 'SaaS Customer Service Agreement',
      body_text: DEFAULT_CONTRACT_TEMPLATE,
      placeholders: DEFAULT_PROVIDER_PLACEHOLDERS
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

function buildActivationLink(shop, linkToken, shopId) {
  const shopUrl = String(shop?.shop_url || '').replace(/\/$/, '');
  const platformBase = String(process.env.PLATFORM_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  // Prefer customer shop URL so the customer stays on their app domain; fall back to platform public URL.
  const base = shopUrl || platformBase;
  if (!base) return null;
  return `${base}/activate?token=${encodeURIComponent(linkToken)}&shop=${encodeURIComponent(shopId)}`;
}

async function createActivation(shopId, data = {}, actor) {
  requireEnabled();
  ensureSchema();
  assertNotChisa({ id: shopId });
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shopId)]);
  if (!shop) throw new Error('Shop not found');
  // Contract is accepted by the customer on /activate (not required before generating the link).
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

  const overrideBase = String(data.public_base_url || '').replace(/\/$/, '');
  const activationLink = overrideBase
    ? `${overrideBase}/activate?token=${encodeURIComponent(linkToken)}&shop=${encodeURIComponent(shopId)}`
    : buildActivationLink(shop, linkToken, shopId);

  const contract = dbGet('SELECT * FROM platform_contract_versions WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1');
  const bundle = {
    activation: {
      id,
      shop_id: shopId,
      code_hash: hashSecret(code),
      code_hint: code.slice(-4),
      link_token_hash: hashSecret(linkToken),
      expires_at: expiresAt,
      max_uses: Math.max(1, Number(data.max_uses || 1) || 1),
      use_count: 0,
      status: 'active',
      created_at: now
    },
    contract: contract ? {
      id: contract.id,
      version_label: contract.version_label,
      title: contract.title,
      body_text: contract.body_text,
      terms_json: contract.terms_json,
      is_active: 1
    } : null,
    shop: {
      id: shopId,
      shop_name: shop.shop_name,
      owner_name: shop.owner_name,
      owner_email: shop.owner_email,
      contract_required: Number(shop.contract_required) !== 0 ? 1 : 0
    }
  };

  let customer_bundle = { ok: false, skipped: true, reason: 'not_attempted' };
  try {
    const pushResult = await pushActivationBundleToCustomer(shop, bundle);
    if (pushResult?.skipped) {
      customer_bundle = { ok: false, skipped: true, reason: pushResult.reason || 'skipped' };
    } else {
      customer_bundle = { ok: true, skipped: false };
    }
  } catch (e) {
    console.warn('[activation] customer bundle push:', e.message || e);
    customer_bundle = { ok: false, skipped: false, reason: String(e.message || e).slice(0, 200) };
  }

  return {
    success: true,
    data: {
      id,
      shop_id: shopId,
      code,
      activation_link: activationLink,
      link_token: linkToken,
      qr_payload: JSON.stringify({ t: 'shoppos_activate', shop_id: shopId, token: linkToken }),
      expires_at: expiresAt,
      status: 'active',
      code_hint: code.slice(-4),
      customer_bundle
    }
  };
}

async function pushActivationBundleToCustomer(shop, bundle) {
  const base = String(shop?.shop_url || '').replace(/\/$/, '');
  if (!base || !shop?.railway_project_id) return { skipped: true, reason: 'no_shop_url' };
  let secret = '';
  try {
    const railway = require('./railway-client');
    const vars = await railway.getVariables({
      projectId: shop.railway_project_id,
      environmentId: shop.railway_environment_id,
      serviceId: shop.railway_service_id
    });
    secret = String(vars.SAAS_SYNC_SECRET || '').trim();
  } catch (_) { /* */ }
  if (!secret) return { skipped: true, reason: 'no_sync_secret' };
  const res = await fetch(base + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'saas:applyActivationBundle', args: [secret, bundle] }),
    signal: AbortSignal.timeout(45000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `activation bundle HTTP ${res.status}`);
  }
  return json.data || json;
}

/** Apply activation + contract snapshot on a customer instance (secret-authenticated). */
function applyActivationBundle(bundle) {
  ensureSchema();
  const shop = bundle?.shop;
  const act = bundle?.activation;
  const contract = bundle?.contract;
  if (!shop?.id || !act?.id) throw new Error('activation bundle incomplete');
  assertNotChisa({ id: shop.id });
  const now = nowIso();
  try {
    dbRun(
      `INSERT INTO platform_shops (
         id, shop_name, owner_name, owner_email, subscription_status, is_active, package_id,
         created_at, updated_at, deployment_status, notes, contract_required, activation_status
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET shop_name=excluded.shop_name,
         owner_name=excluded.owner_name, owner_email=excluded.owner_email,
         contract_required=excluded.contract_required, updated_at=excluded.updated_at`,
      [
        shop.id, shop.shop_name || shop.id, shop.owner_name || '', shop.owner_email || '',
        'ACTIVE', 1, null, now, now, 'online', 'activation-bundle',
        shop.contract_required === 0 ? 0 : 1,
        'pending'
      ]
    );
  } catch (e) {
    try {
      dbRun(
        `UPDATE platform_shops SET shop_name=?, owner_name=?, owner_email=?, contract_required=?, updated_at=? WHERE id=?`,
        [shop.shop_name || shop.id, shop.owner_name || '', shop.owner_email || '', shop.contract_required === 0 ? 0 : 1, now, shop.id]
      );
    } catch (_) { /* */ }
  }
  if (contract?.id) {
    try {
      dbRun('UPDATE platform_contract_versions SET is_active = 0');
      dbRun(
        `INSERT INTO platform_contract_versions (id, version_label, title, body_text, terms_json, is_active, created_at, created_by, notes)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, body_text=excluded.body_text,
           version_label=excluded.version_label, is_active=1, terms_json=excluded.terms_json`,
        [
          contract.id,
          contract.version_label || 'v1',
          contract.title || 'Customer Agreement',
          contract.body_text || '',
          typeof contract.terms_json === 'string' ? contract.terms_json : JSON.stringify(contract.terms_json || {}),
          1, now, 'saas-sync', 'activation-bundle'
        ]
      );
    } catch (e) {
      console.warn('[activation] contract upsert:', e.message || e);
    }
  }
  dbRun(
    `INSERT INTO platform_activations (
      id, shop_id, code_hash, code_hint, link_token_hash, expires_at, max_uses, use_count,
      status, created_at, created_by, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      code_hash=excluded.code_hash, link_token_hash=excluded.link_token_hash,
      expires_at=excluded.expires_at, status=excluded.status, max_uses=excluded.max_uses`,
    [
      act.id, act.shop_id, act.code_hash, act.code_hint || '',
      act.link_token_hash, act.expires_at, act.max_uses || 1, act.use_count || 0,
      act.status || 'active', act.created_at || now, 'saas-sync', 'activation-bundle'
    ]
  );
  return { success: true, shop_id: shop.id, activation_id: act.id };
}

/** Public activation context for /activate (no secrets). */
function getActivationContext({ shop_id, code, link_token }) {
  ensureSchema();
  if (!shop_id) throw new Error('shop_id required');
  assertNotChisa({ id: shop_id });
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shop_id)]);
  if (!shop) throw new Error('Shop not found');

  let activation = null;
  if (code) {
    activation = dbGet(
      `SELECT id, shop_id, code_hint, expires_at, max_uses, use_count, status FROM platform_activations
       WHERE shop_id = ? AND code_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [shop_id, hashSecret(String(code).trim().toUpperCase())]
    );
  } else if (link_token) {
    activation = dbGet(
      `SELECT id, shop_id, code_hint, expires_at, max_uses, use_count, status FROM platform_activations
       WHERE shop_id = ? AND link_token_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [shop_id, hashSecret(String(link_token).trim())]
    );
  }

  const contractStatus = getShopContractStatus(shop_id).data;
  const active = dbGet(
    `SELECT * FROM platform_contract_versions WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
  );

  let token_ok = false;
  let token_error = null;
  if (activation) {
    if (activation.status === 'revoked') token_error = 'This activation link has been revoked';
    else if (activation.expires_at && Date.parse(activation.expires_at) < serverNowMs()) {
      token_error = 'This activation link has expired';
    } else if (activation.status === 'used' || Number(activation.use_count) >= Number(activation.max_uses || 1)) {
      token_error = 'This activation link has already been used';
    } else if (activation.status !== 'active') token_error = 'This activation link is not active';
    else token_ok = true;
  } else if (code || link_token) {
    token_error = 'Invalid activation credentials';
  }

  let contract = null;
  if (active) {
    const placeholders = buildPlaceholderMap(shop, {
      version_label: active.version_label,
      effective_date: (active.effective_at || nowIso()).slice(0, 10),
      versionPlaceholders: active.placeholders_json
    });
    contract = {
      id: active.id,
      version_label: active.version_label,
      title: active.title,
      body_text: renderContractBody(active.body_text, placeholders),
      effective_at: active.effective_at || null,
      placeholders
    };
  }

  return {
    success: true,
    data: {
      shop_id: shop.id,
      shop_name: shop.shop_name,
      owner_name: shop.owner_name,
      owner_email: shop.owner_email,
      owner_id_number: shop.owner_id_number || '',
      contact_phone: shop.contact_phone || '',
      whatsapp: shop.whatsapp || '',
      address: shop.address || '',
      postal_address: shop.postal_address || '',
      company_name: shop.company_name || '',
      company_registration: shop.company_registration || '',
      shop_address: shop.shop_address || shop.address || '',
      shop_phone: shop.shop_phone || shop.contact_phone || '',
      shop_url: shop.shop_url || null,
      activation_status: shop.activation_status,
      contract_required: Number(shop.contract_required) !== 0,
      contract_accepted: !!contractStatus.accepted && !contractStatus.needs_reacceptance,
      needs_reacceptance: !!contractStatus.needs_reacceptance,
      reacceptance_message: contractStatus.reacceptance_message || null,
      contract,
      token_ok,
      token_error,
      activation_hint: activation ? {
        status: activation.status,
        expires_at: activation.expires_at,
        uses: `${activation.use_count}/${activation.max_uses}`
      } : null
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

async function regenerateActivation(shopId, data, actor) {
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

  // Validate credentials before contract gate so cross-shop / invalid tokens
  // fail with ACTIVATION_* (not CONTRACT_REQUIRED).
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

  if (Number(shop.contract_required) !== 0) {
    const active = dbGet('SELECT id FROM platform_contract_versions WHERE is_active = 1 LIMIT 1');
    if (active) {
      const acc = dbGet(
        'SELECT id FROM platform_contract_acceptances WHERE shop_id = ? AND contract_version_id = ? LIMIT 1',
        [shop_id, active.id]
      );
      if (!acc) {
        const err = new Error('Please accept the customer agreement before activating this device');
        err.code = 'CONTRACT_REQUIRED';
        throw err;
      }
    }
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

function listLocalOrderFeeSnapshots({ from = null, to = null, limit = 100 } = {}) {
  ensureSchema();
  try {
    dbGet('SELECT service_fee FROM online_orders_local LIMIT 1');
  } catch (_) {
    return { success: true, data: { orders: [], totals: { order_count: 0, sales_total: 0, service_fees_total: 0 } } };
  }
  let sql = `SELECT id, order_number, created_at, subtotal, service_fee, service_fee_label,
                    service_fee_config_json, total, status
             FROM online_orders_local WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND created_at >= ?'; params.push(String(from)); }
  if (to) { sql += ' AND created_at <= ?'; params.push(String(to)); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
  const rows = dbAll(sql, params).map((r) => ({
    id: r.id,
    order_number: r.order_number,
    created_at: r.created_at,
    subtotal: Number(r.subtotal) || 0,
    service_fee: Number(r.service_fee) || 0,
    service_fee_label: r.service_fee_label || '',
    service_fee_config: parseJson(r.service_fee_config_json, {}),
    total: Number(r.total) || 0,
    status: r.status
  }));
  const totals = rows.reduce((acc, r) => {
    acc.order_count += 1;
    acc.sales_total += r.total;
    acc.service_fees_total += r.service_fee;
    return acc;
  }, { order_count: 0, sales_total: 0, service_fees_total: 0 });
  // Also compute range totals from DB when filters used
  try {
    let tSql = 'SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(service_fee),0) AS fees FROM online_orders_local WHERE 1=1';
    const tParams = [];
    if (from) { tSql += ' AND created_at >= ?'; tParams.push(String(from)); }
    if (to) { tSql += ' AND created_at <= ?'; tParams.push(String(to)); }
    const t = dbGet(tSql, tParams);
    if (t) {
      totals.order_count = Number(t.c) || 0;
      totals.sales_total = Number(t.sales) || 0;
      totals.service_fees_total = Number(t.fees) || 0;
    }
  } catch (_) { /* */ }
  return { success: true, data: { orders: rows, totals } };
}

async function fetchCustomerFeeReport(shopId, { from = null, to = null, limit = 50 } = {}) {
  requireEnabled();
  ensureSchema();
  assertNotChisa({ id: shopId });
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(shopId)]);
  if (!shop) throw new Error('Shop not found');
  const fee = getEffectiveServiceFee({ package_id: shop.package_id, shop_id: shopId });
  const base = String(shop.shop_url || '').replace(/\/$/, '');
  if (!base || !shop.railway_project_id) {
    return {
      success: true,
      data: {
        shop_id: shopId,
        shop_name: shop.shop_name,
        current_fee: fee,
        source: 'unavailable',
        orders: [],
        totals: { order_count: 0, sales_total: 0, service_fees_total: 0 },
        note: 'Customer shop URL not provisioned yet'
      }
    };
  }
  let secret = '';
  try {
    const railway = require('./railway-client');
    const vars = await railway.getVariables({
      projectId: shop.railway_project_id,
      environmentId: shop.railway_environment_id,
      serviceId: shop.railway_service_id
    });
    secret = String(vars.SAAS_SYNC_SECRET || '').trim();
  } catch (_) { /* */ }
  if (!secret) {
    return {
      success: true,
      data: {
        shop_id: shopId,
        current_fee: fee,
        source: 'unavailable',
        orders: [],
        totals: { order_count: 0, sales_total: 0, service_fees_total: 0 },
        note: 'Unable to read customer sync secret'
      }
    };
  }
  const res = await fetch(base + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'saas:listOrderFees',
      args: [secret, { from, to, limit }]
    }),
    signal: AbortSignal.timeout(45000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `fee report HTTP ${res.status}`);
  }
  const payload = json.data?.data || json.data || json;
  return {
    success: true,
    data: {
      shop_id: shopId,
      shop_name: shop.shop_name,
      current_fee: fee,
      source: 'customer',
      orders: payload.orders || [],
      totals: payload.totals || { order_count: 0, sales_total: 0, service_fees_total: 0 }
    }
  };
}

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
      audit: shops.listAuditForShop(shopId, 40).data,
      renewal: {
        package_id: shop.package_id,
        package_name: shop.package_name,
        addon_names: shop.addon_names,
        subscription_status: shop.subscription_status,
        subscription_start: shop.subscription_start,
        subscription_expiry: shop.subscription_expiry,
        days_remaining: getCountdown(shopId).data?.days_remaining,
        service_fee: getEffectiveServiceFee({ package_id: shop.package_id, shop_id: shopId }),
        contract: getShopContractStatus(shopId).data,
        show_contract_on_renewal: !!(getShopContractStatus(shopId).data?.needs_reacceptance)
      }
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
  updateDraftContract,
  publishContractVersion,
  previewContract,
  listContractAcceptances,
  getShopContractStatus,
  acceptContract,
  getAcceptedAgreementPrintable,
  getDefaultContractTemplate,
  renderContractBody,
  buildPlaceholderMap,
  // activation
  createActivation,
  listActivations,
  revokeActivation,
  regenerateActivation,
  redeemActivation,
  getActivationContext,
  applyActivationBundle,
  pushActivationBundleToCustomer,
  buildActivationLink,
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
  listLocalOrderFeeSnapshots,
  fetchCustomerFeeReport,
  // notifications
  listNotificationRules,
  updateNotificationRule,
  listNotificationLog,
  processSubscriptionNotifications,
  // aggregate
  getCustomerControl
};
