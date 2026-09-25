/**
 * Platform Shop Management (Phase 5) — SaaS customer records (lab only).
 * Creates PLATFORM records only — no Railway provisioning.
 * Uses Phase 4 entitlements engine for package/add-on/overrides.
 * Never registers or targets Chisa Food.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/db');

let entitlements;
try { entitlements = require('./entitlements'); } catch (_) { entitlements = null; }
let platform;
try { platform = require('./platform-control'); } catch (_) { platform = null; }

const SUB_STATUSES = new Set(['TRIAL', 'ACTIVE', 'OVERDUE', 'SUSPENDED', 'EXPIRED']);
const DEPLOY_STATUSES = new Set([
  'not_provisioned', 'pending', 'provisioning', 'online', 'offline', 'error', 'unknown',
  'NOT_STARTED', 'DRY_RUN', 'PROVISIONING', 'DATABASE_CREATING', 'DEPLOYING', 'HEALTH_CHECK', 'READY', 'FAILED',
  'WAITING_HEALTH', 'SYNCING_ENTITLEMENTS'
]);

let controlPlane;
try { controlPlane = require('./platform-control-plane'); } catch (_) { controlPlane = null; }

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }
function uid(prefix = 'shop') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function ensureSchema() {
  try {
    dbGet('SELECT 1 FROM platform_shops LIMIT 1');
  } catch (_) {
    const files = [
      path.join(__dirname, '../database/migrations-v125.sql'),
      path.join(__dirname, '../../supabase/migrations/20260921_platform_shops.sql')
    ];
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      try {
        getDb().exec(fs.readFileSync(f, 'utf8'));
        console.log('[platform-shops] schema from', path.basename(f));
        break;
      } catch (e) {
        console.warn('[platform-shops] schema:', e.message || e);
      }
    }
  }
  try { controlPlane?.ensureSchema?.(); } catch (_) { /* */ }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_ps_shops_created ON platform_shops(created_at)'); } catch (_) { /* */ }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_ps_shops_status ON platform_shops(subscription_status)'); } catch (_) { /* */ }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_ps_shops_active ON platform_shops(is_active)'); } catch (_) { /* */ }
}

function audit(actor, action, shopId, detail) {
  try {
    dbRun(
      `INSERT INTO platform_audit_logs (actor, action, entity_type, entity_id, detail_json, created_at)
       VALUES (?,?,?,?,?,?)`,
      [actor || 'system', action, 'shop', shopId || '', JSON.stringify(detail || {}), nowIso()]
    );
  } catch (_) { /* */ }
}

/** Reject Chisa Food / reserved production identities. */
function assertNotChisaFood(data = {}) {
  if (entitlements?.isChisaFoodProtected?.()) {
    throw new Error('Cannot manage SaaS shops on protected Chisa Food production');
  }
  const hay = [
    data.id, data.shop_name, data.owner_name, data.owner_email,
    data.shop_url, data.railway_project_id, data.notes
  ].filter(Boolean).join(' ').toLowerCase();
  if (/\bchisa\b|chisafood|chisa.?food/.test(hay)) {
    throw new Error('Chisa Food is protected and cannot be registered as a SaaS customer');
  }
  if (String(data.railway_project_id || '') === '0296f469-4b4e-4b3f-99fb-063b03535e39') {
    throw new Error('Chisa Food Railway project is protected — cannot link as SaaS shop');
  }
}

function requireEnabled() {
  if (!platform?.isEnabled?.()) throw new Error('Platform Control is disabled on this deployment');
}

function mapShop(row) {
  if (!row) return null;
  const addon_ids = dbAll('SELECT addon_id FROM platform_shop_addons WHERE shop_key = ?', [row.id])
    .map((r) => r.addon_id);
  const overrides = dbAll('SELECT * FROM platform_shop_overrides WHERE shop_key = ?', [row.id]);
  let package_name = null;
  if (row.package_id) {
    try {
      package_name = dbGet('SELECT name FROM platform_packages WHERE id = ?', [row.package_id])?.name || null;
    } catch (_) { /* */ }
  }
  const addon_names = [];
  for (const aid of addon_ids) {
    try {
      const n = dbGet('SELECT name FROM platform_addons WHERE id = ?', [aid])?.name;
      if (n) addon_names.push(n);
    } catch (_) { /* */ }
  }
  let access = null;
  let countdown = null;
  try {
    if (controlPlane?.evaluateShopAccess) {
      access = controlPlane.evaluateShopAccess(row);
      countdown = {
        start_date: access.subscription_start,
        expiry_date: access.subscription_expiry,
        days_remaining: access.days_remaining,
        status: access.subscription_status,
        access_state: access.access_state,
        grace_period_days: access.grace_days,
        grace_active: access.grace_active,
        suspension_date: access.suspended_at
      };
    }
  } catch (_) { /* */ }
  return {
    id: row.id,
    shop_name: row.shop_name,
    owner_name: row.owner_name || '',
    owner_email: row.owner_email || '',
    owner_id_number: row.owner_id_number || '',
    contact_phone: row.contact_phone || '',
    whatsapp: row.whatsapp || '',
    address: row.address || '',
    postal_address: row.postal_address || '',
    company_name: row.company_name || '',
    company_registration: row.company_registration || '',
    shop_address: row.shop_address || row.address || '',
    shop_phone: row.shop_phone || row.contact_phone || '',
    branch_info: row.branch_info || '',
    shop_url: row.shop_url || '',
    railway_project_id: row.railway_project_id || '',
    railway_service_id: row.railway_service_id || '',
    railway_environment_id: row.railway_environment_id || '',
    railway_deployment_id: row.railway_deployment_id || '',
    deployment_status: row.deployment_status || 'not_provisioned',
    package_id: row.package_id || null,
    package_name,
    addon_ids,
    addon_names,
    overrides,
    subscription_status: row.subscription_status || 'TRIAL',
    subscription_start: row.subscription_start || row.trial_start || null,
    subscription_expiry: row.subscription_expiry || row.trial_end || null,
    grace_days: row.grace_days != null ? Number(row.grace_days) : 3,
    suspended_at: row.suspended_at || null,
    activation_status: row.activation_status || 'pending',
    contract_required: Number(row.contract_required) !== 0,
    contact_admin_url: row.contact_admin_url || '',
    suspension_message: row.suspension_message || '',
    trial_start: row.trial_start || null,
    trial_end: row.trial_end || null,
    is_active: Number(row.is_active) !== 0,
    notes: row.notes || '',
    registered_date: row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by || '',
    updated_by: row.updated_by || '',
    access,
    countdown
  };
}

function mapShopListItem(row, packageNameById = {}) {
  if (!row) return null;
  return {
    id: row.id,
    shop_name: row.shop_name,
    owner_name: row.owner_name || '',
    owner_email: row.owner_email || '',
    contact_phone: row.contact_phone || '',
    whatsapp: row.whatsapp || '',
    shop_url: row.shop_url || '',
    railway_project_id: row.railway_project_id || '',
    deployment_status: row.deployment_status || 'not_provisioned',
    package_id: row.package_id || null,
    package_name: row.package_id ? (packageNameById[row.package_id] || null) : null,
    addon_ids: [],
    addon_names: [],
    subscription_status: row.subscription_status || 'TRIAL',
    subscription_start: row.subscription_start || null,
    subscription_expiry: row.subscription_expiry || null,
    trial_start: row.trial_start || null,
    trial_end: row.trial_end || null,
    grace_days: row.grace_days != null ? Number(row.grace_days) : 3,
    is_active: Number(row.is_active) !== 0,
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    activation_status: row.activation_status || 'pending',
    address: row.address || '',
    branch_info: row.branch_info || ''
  };
}

function listShops(filter = {}) {
  requireEnabled();
  ensureSchema();
  const q = String(filter.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const params = [];
  let where = ' WHERE 1=1';
  if (q) {
    where += ` AND (
      LOWER(COALESCE(shop_name,'')) LIKE ? OR LOWER(COALESCE(owner_name,'')) LIKE ?
      OR LOWER(COALESCE(owner_email,'')) LIKE ? OR LOWER(COALESCE(id,'')) LIKE ?
      OR LOWER(COALESCE(shop_url,'')) LIKE ? OR LOWER(COALESCE(subscription_status,'')) LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  if (filter.subscription_status) {
    where += ' AND subscription_status = ?';
    params.push(filter.subscription_status);
  }
  if (filter.deployment_status) {
    where += ' AND deployment_status = ?';
    params.push(filter.deployment_status);
  }
  if (filter.active_only) {
    where += ` AND COALESCE(is_active,1) != 0 AND subscription_status != 'SUSPENDED'`;
  }
  const countRow = dbGet(`SELECT COUNT(*) AS c FROM platform_shops${where}`, params) || { c: 0 };
  const total = Number(countRow.c) || 0;
  const rows = dbAll(
    `SELECT id, shop_name, owner_name, owner_email, contact_phone, whatsapp, shop_url,
            railway_project_id, deployment_status, package_id, subscription_status,
            subscription_start, subscription_expiry, trial_start, trial_end, grace_days,
            is_active, notes, created_at, updated_at, activation_status, address, branch_info
     FROM platform_shops${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const packageNameById = {};
  try {
    dbAll('SELECT id, name FROM platform_packages').forEach((p) => { packageNameById[p.id] = p.name; });
  } catch (_) { /* */ }
  const page = (rows || []).map((r) => mapShopListItem(r, packageNameById));
  return { success: true, data: page, total, limit, offset };
}

function getShop(id) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Shop not found');
  const shop = mapShop(row);
  let entitlementsPayload = null;
  if (entitlements?.computeEffectiveEntitlements) {
    entitlementsPayload = entitlements.computeEffectiveEntitlements(row.id);
  }
  return { success: true, data: { ...shop, entitlements: entitlementsPayload } };
}

function createShop(data, actor) {
  requireEnabled();
  ensureSchema();
  assertNotChisaFood(data || {});
  const name = String(data.shop_name || '').trim();
  if (!name) throw new Error('Shop name is required');
  if (/chisa/i.test(name)) throw new Error('Chisa Food is protected and cannot be registered as a SaaS customer');

  const id = String(data.id || uid('shop')).trim();
  assertNotChisaFood({ ...data, id });
  if (dbGet('SELECT id FROM platform_shops WHERE id = ?', [id])) {
    throw new Error('Shop ID already exists');
  }

  const status = String(data.subscription_status || 'TRIAL').toUpperCase();
  if (!SUB_STATUSES.has(status)) throw new Error('Invalid subscription status');
  const packageId = data.package_id || null;
  const addonIds = Array.isArray(data.addon_ids) ? data.addon_ids : [];
  const now = nowIso();
  const trialStart = data.trial_start || (status === 'TRIAL' ? now : null);
  const trialEnd = data.trial_end || null;
  const by = actor?.username || 'platform';

  const subStart = data.subscription_start || trialStart;
  const subExpiry = data.subscription_expiry || trialEnd || null;
  const graceDays = data.grace_days != null ? Number(data.grace_days) : 3;

  dbRun(
    `INSERT INTO platform_shops (
      id, shop_name, owner_name, owner_email, contact_phone, shop_url,
      railway_project_id, railway_service_id, railway_environment_id, railway_deployment_id,
      deployment_status, package_id, subscription_status, trial_start, trial_end,
      is_active, notes, created_at, updated_at, created_by, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, name, data.owner_name || '', data.owner_email || '', data.contact_phone || '', data.shop_url || '',
      data.railway_project_id || '', data.railway_service_id || '', data.railway_environment_id || '',
      data.railway_deployment_id || '',
      DEPLOY_STATUSES.has(data.deployment_status) ? data.deployment_status : 'not_provisioned',
      packageId, status, trialStart, trialEnd,
      data.is_active === false || data.is_active === 0 ? 0 : 1,
      data.notes || '', now, now, by, by
    ]
  );

  // Optional registration / calendar fields (control-plane columns)
  try {
    dbRun(
      `UPDATE platform_shops SET
        address=?, subscription_start=?, subscription_expiry=?, grace_days=?,
        activation_status=?, contract_required=?, contact_admin_url=?, suspension_message=?,
        owner_id_number=?, whatsapp=?, postal_address=?, company_name=?, company_registration=?,
        shop_address=?, shop_phone=?, branch_info=?
       WHERE id=?`,
      [
        data.address || '',
        subStart,
        subExpiry,
        Number.isFinite(graceDays) ? graceDays : 3,
        data.activation_status || 'pending',
        data.contract_required === false || data.contract_required === 0 ? 0 : 1,
        data.contact_admin_url || '',
        data.suspension_message || '',
        data.owner_id_number || '',
        data.whatsapp || data.contact_phone || '',
        data.postal_address || '',
        data.company_name || '',
        data.company_registration || '',
        data.shop_address || data.address || '',
        data.shop_phone || data.contact_phone || '',
        data.branch_info || '',
        id
      ]
    );
  } catch (_) { /* columns may not exist yet */ }

  // Sync Phase 4 assignment tables (same shop id = shop_key)
  if (entitlements?.saveShopAssignment) {
    entitlements.saveShopAssignment({
      shop_key: id,
      package_id: packageId,
      addon_ids: addonIds,
      overrides: Array.isArray(data.overrides) ? data.overrides : [],
      notes: data.notes || ''
    }, actor);
  } else {
    // minimal assignment row if engine unavailable
    dbRun(
      `INSERT INTO platform_shop_assignments (shop_key, package_id, notes, updated_at, updated_by) VALUES (?,?,?,?,?)`,
      [id, packageId, data.notes || '', now, by]
    );
  }

  // Keep package_id on shop row in sync
  dbRun('UPDATE platform_shops SET package_id = ?, updated_at = ? WHERE id = ?', [packageId, now, id]);

  audit(by, 'shop_created', id, {
    shop_name: name,
    owner_email: data.owner_email || '',
    package_id: packageId,
    addon_ids: addonIds,
    subscription_status: status
  });

  return getShop(id);
}

function updateShopMeta(id, data, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Shop not found');
  assertNotChisaFood({ ...row, ...data, id });
  const by = actor?.username || 'platform';
  const next = {
    shop_name: data.shop_name != null ? String(data.shop_name).trim() : row.shop_name,
    owner_name: data.owner_name != null ? data.owner_name : row.owner_name,
    owner_email: data.owner_email != null ? data.owner_email : row.owner_email,
    owner_id_number: data.owner_id_number != null ? data.owner_id_number : (row.owner_id_number || ''),
    contact_phone: data.contact_phone != null ? data.contact_phone : row.contact_phone,
    whatsapp: data.whatsapp != null ? data.whatsapp : (row.whatsapp || ''),
    address: data.address != null ? data.address : (row.address || ''),
    postal_address: data.postal_address != null ? data.postal_address : (row.postal_address || ''),
    company_name: data.company_name != null ? data.company_name : (row.company_name || ''),
    company_registration: data.company_registration != null ? data.company_registration : (row.company_registration || ''),
    shop_address: data.shop_address != null ? data.shop_address : (row.shop_address || ''),
    shop_phone: data.shop_phone != null ? data.shop_phone : (row.shop_phone || ''),
    branch_info: data.branch_info != null ? data.branch_info : (row.branch_info || ''),
    shop_url: data.shop_url != null ? data.shop_url : row.shop_url,
    railway_project_id: data.railway_project_id != null ? data.railway_project_id : row.railway_project_id,
    railway_service_id: data.railway_service_id != null ? data.railway_service_id : row.railway_service_id,
    railway_environment_id: data.railway_environment_id != null ? data.railway_environment_id : row.railway_environment_id,
    railway_deployment_id: data.railway_deployment_id != null ? data.railway_deployment_id : row.railway_deployment_id,
    deployment_status: data.deployment_status && DEPLOY_STATUSES.has(data.deployment_status)
      ? data.deployment_status : row.deployment_status,
    trial_start: data.trial_start !== undefined ? data.trial_start : row.trial_start,
    trial_end: data.trial_end !== undefined ? data.trial_end : row.trial_end,
    subscription_start: data.subscription_start !== undefined ? data.subscription_start : (row.subscription_start || null),
    subscription_expiry: data.subscription_expiry !== undefined ? data.subscription_expiry : (row.subscription_expiry || null),
    grace_days: data.grace_days !== undefined ? Number(data.grace_days) : (row.grace_days != null ? Number(row.grace_days) : 3),
    activation_status: data.activation_status != null ? data.activation_status : (row.activation_status || 'pending'),
    contract_required: data.contract_required === false || data.contract_required === 0 ? 0
      : (data.contract_required === true || data.contract_required === 1 ? 1
        : (row.contract_required != null ? Number(row.contract_required) : 1)),
    contact_admin_url: data.contact_admin_url != null ? data.contact_admin_url : (row.contact_admin_url || ''),
    suspension_message: data.suspension_message != null ? data.suspension_message : (row.suspension_message || ''),
    notes: data.notes != null ? data.notes : row.notes,
    is_active: data.is_active === false || data.is_active === 0 ? 0
      : (data.is_active === true || data.is_active === 1 ? 1 : row.is_active)
  };
  if (!next.shop_name) throw new Error('Shop name is required');
  assertNotChisaFood(next);

  dbRun(
    `UPDATE platform_shops SET
      shop_name=?, owner_name=?, owner_email=?, contact_phone=?, shop_url=?,
      railway_project_id=?, railway_service_id=?, railway_environment_id=?, railway_deployment_id=?,
      deployment_status=?, trial_start=?, trial_end=?, notes=?, is_active=?,
      updated_at=?, updated_by=?
     WHERE id=?`,
    [
      next.shop_name, next.owner_name, next.owner_email, next.contact_phone, next.shop_url,
      next.railway_project_id, next.railway_service_id, next.railway_environment_id, next.railway_deployment_id,
      next.deployment_status, next.trial_start, next.trial_end, next.notes, next.is_active,
      nowIso(), by, id
    ]
  );
  try {
    dbRun(
      `UPDATE platform_shops SET
        address=?, subscription_start=?, subscription_expiry=?, grace_days=?,
        activation_status=?, contract_required=?, contact_admin_url=?, suspension_message=?,
        owner_id_number=?, whatsapp=?, postal_address=?, company_name=?, company_registration=?,
        shop_address=?, shop_phone=?, branch_info=?
       WHERE id=?`,
      [
        next.address, next.subscription_start, next.subscription_expiry, next.grace_days,
        next.activation_status, next.contract_required, next.contact_admin_url, next.suspension_message,
        next.owner_id_number, next.whatsapp, next.postal_address, next.company_name, next.company_registration,
        next.shop_address, next.shop_phone, next.branch_info,
        id
      ]
    );
  } catch (_) { /* */ }
  audit(by, 'shop_updated', id, { previous: mapShop(row), next: getShop(id).data });
  return getShop(id);
}

/**
 * Delete a shop from Platform Control.
 * Safety: shop must be SUSPENDED first (cannot delete an online/active customer).
 * Does not destroy the Railway project — only removes platform registration records.
 */
function deleteShop(id, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Shop not found');
  assertNotChisaFood(row);
  const status = String(row.subscription_status || '').toUpperCase();
  if (status !== 'SUSPENDED') {
    throw new Error('Suspend this shop first. Online / active shops cannot be deleted until subscription status is SUSPENDED.');
  }
  const by = actor?.username || 'platform';
  const snap = mapShop(row);

  // Related platform rows (best-effort; tables may vary)
  const tables = [
    ['platform_shop_addons', 'shop_key'],
    ['platform_shop_overrides', 'shop_key'],
    ['platform_shop_assignments', 'shop_key'],
    ['platform_shop_activations', 'shop_id'],
    ['platform_devices', 'shop_id'],
    ['platform_contract_acceptances', 'shop_id'],
    ['platform_service_fees', 'scope_id'],
    ['platform_provision_jobs', 'shop_id'],
    ['platform_audit_log', 'shop_id']
  ];
  for (const [table, col] of tables) {
    try {
      dbRun(`DELETE FROM ${table} WHERE ${col} = ?`, [id]);
    } catch (_) { /* table/column may not exist */ }
  }
  dbRun('DELETE FROM platform_shops WHERE id = ?', [id]);
  audit(by, 'shop_deleted', id, {
    shop_name: snap.shop_name,
    owner_email: snap.owner_email,
    shop_url: snap.shop_url,
    railway_project_id: snap.railway_project_id || '',
    note: 'Platform record removed after SUSPENDED. Railway project not destroyed.'
  });
  return { success: true, data: { id, deleted: true, shop_name: snap.shop_name } };
}

function assignPackageAndAddons(id, data, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Shop not found');
  assertNotChisaFood(row);
  const by = actor?.username || 'platform';
  const prev = entitlements?.getShopAssignment?.(id);

  const packageId = data.package_id !== undefined ? (data.package_id || null) : row.package_id;
  const addonIds = Array.isArray(data.addon_ids)
    ? data.addon_ids
    : (prev?.data?.addon_ids || []);
  const overrides = Array.isArray(data.overrides)
    ? data.overrides
    : (prev?.data?.overrides || []).map((o) => ({
      module_id: o.module_id, enabled: o.enabled, reason: o.reason
    }));

  if (!entitlements?.saveShopAssignment) throw new Error('Entitlement engine unavailable');
  const saved = entitlements.saveShopAssignment({
    shop_key: id,
    package_id: packageId,
    addon_ids: addonIds,
    overrides,
    notes: data.notes != null ? data.notes : row.notes
  }, actor);

  dbRun(
    `UPDATE platform_shops SET package_id=?, updated_at=?, updated_by=? WHERE id=?`,
    [packageId, nowIso(), by, id]
  );

  const prevPkg = prev?.data?.package_id;
  const prevAddons = prev?.data?.addon_ids || [];
  if (prevPkg !== packageId) {
    audit(by, prevPkg ? 'package_changed' : 'package_assigned', id, {
      previous: prevPkg, next: packageId
    });
  }
  const added = addonIds.filter((a) => !prevAddons.includes(a));
  const removed = prevAddons.filter((a) => !addonIds.includes(a));
  for (const a of added) audit(by, 'addon_added', id, { addon_id: a });
  for (const a of removed) audit(by, 'addon_removed', id, { addon_id: a });

  const sync = queueCustomerEntitlementSync(id);
  return {
    success: true,
    data: { ...getShop(id).data, assignment: saved.data, customer_sync: sync }
  };
}

function setOverrides(id, overrides, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Shop not found');
  assertNotChisaFood(row);
  const by = actor?.username || 'platform';
  const prev = entitlements?.getShopAssignment?.(id);
  const prevOv = prev?.data?.overrides || [];
  const nextOv = Array.isArray(overrides) ? overrides : [];
  const asg = entitlements.saveShopAssignment({
    shop_key: id,
    package_id: row.package_id,
    addon_ids: (prev?.data?.addon_ids) || [],
    overrides: nextOv,
    notes: row.notes || ''
  }, actor);

  const prevMap = new Map(prevOv.map((o) => [o.module_id, o]));
  const nextMap = new Map(nextOv.map((o) => [o.module_id, o]));
  for (const [mid, o] of nextMap) {
    const p = prevMap.get(mid);
    if (!p) audit(by, 'module_override_added', id, { module_id: mid, enabled: o.enabled, reason: o.reason });
    else if (Number(p.enabled) !== Number(o.enabled)) {
      audit(by, 'module_override_changed', id, {
        module_id: mid, previous: p.enabled, next: o.enabled, reason: o.reason
      });
    }
  }
  for (const [mid, o] of prevMap) {
    if (!nextMap.has(mid)) {
      audit(by, 'module_override_removed', id, { module_id: mid, previous: o.enabled });
    }
  }

  return { success: true, data: { ...getShop(id).data, assignment: asg.data, customer_sync: queueCustomerEntitlementSync(id) } };
}

function setSubscriptionStatus(id, status, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_shops WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Shop not found');
  assertNotChisaFood(row);
  const next = String(status || '').toUpperCase();
  if (!SUB_STATUSES.has(next)) throw new Error('Invalid subscription status. Use TRIAL|ACTIVE|OVERDUE|SUSPENDED|EXPIRED');
  const by = actor?.username || 'platform';
  const prev = row.subscription_status;
  const isActive = (next === 'SUSPENDED' || next === 'EXPIRED') ? 0 : 1;
  const now = nowIso();
  let suspendedAt = row.suspended_at || null;
  if ((next === 'SUSPENDED' || next === 'EXPIRED') && prev !== next) suspendedAt = now;
  if (next !== 'SUSPENDED' && next !== 'EXPIRED') suspendedAt = null;
  dbRun(
    `UPDATE platform_shops SET subscription_status=?, is_active=?, updated_at=?, updated_by=? WHERE id=?`,
    [next, isActive, now, by, id]
  );
  try {
    dbRun('UPDATE platform_shops SET suspended_at=? WHERE id=?', [suspendedAt, id]);
  } catch (_) { /* */ }
  audit(by, 'subscription_status_changed', id, { previous: prev, next });
  if (next === 'SUSPENDED' && prev !== 'SUSPENDED') {
    audit(by, 'shop_suspended', id, { previous: prev, next });
  }
  if (next === 'EXPIRED' && prev !== 'EXPIRED') {
    audit(by, 'shop_expired', id, { previous: prev, next });
  }
  if ((prev === 'SUSPENDED' || prev === 'EXPIRED') && next !== 'SUSPENDED' && next !== 'EXPIRED') {
    audit(by, 'shop_reactivated', id, { previous: prev, next });
  }
  const sync = queueCustomerEntitlementSync(id);
  const result = getShop(id);
  result.data = { ...result.data, customer_sync: sync };
  return result;
}

/**
 * Push package/subscription snapshot to the customer Railway app (server-side only).
 * Never exposes SAAS_SYNC_SECRET to the browser.
 */
async function syncCustomerEntitlements(shopId) {
  const shop = getShop(shopId).data;
  if (!shop?.shop_url) return { ok: false, skipped: true, reason: 'no_shop_url' };
  if (!shop.railway_project_id || !shop.railway_service_id || !shop.railway_environment_id) {
    return { ok: false, skipped: true, reason: 'not_provisioned' };
  }
  const sync = require('./saas-customer-sync');
  const railway = require('./railway-client');
  const snapshot = sync.buildSnapshotForShop(shopId);
  let secret = '';
  let secretCreated = false;
  let prevEnvStatus = '';
  try {
    const vars = await railway.getVariables({
      projectId: shop.railway_project_id,
      environmentId: shop.railway_environment_id,
      serviceId: shop.railway_service_id
    });
    secret = String(vars.SAAS_SYNC_SECRET || '').trim();
    prevEnvStatus = String(vars.SHOP_SUBSCRIPTION_STATUS || '').toUpperCase();
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
  if (!secret) {
    secret = crypto.randomBytes(24).toString('base64url');
    secretCreated = true;
  }
  await railway.upsertVariables({
    projectId: shop.railway_project_id,
    environmentId: shop.railway_environment_id,
    serviceId: shop.railway_service_id,
    variables: {
      SAAS_SYNC_SECRET: secret,
      SHOP_PACKAGE_ID: snapshot.package_id || '',
      SHOP_ADDON_IDS: (snapshot.addon_ids || []).join(','),
      SHOP_SUBSCRIPTION_STATUS: snapshot.subscription_status || 'TRIAL',
      SHOP_ENTITLEMENT_KEY: shop.id,
      ENTITLEMENTS_ENFORCE: 'true'
    },
    skipDeploys: true
  });

  // Redeploy only when env must change (new secret or subscription status flip).
  // Redeploying on every ACTIVE sync races the HTTP snapshot onto a dying instance
  // and leaves package_items empty on the replacement.
  const status = String(snapshot.subscription_status || '').toUpperCase();
  const statusChanged = !!prevEnvStatus && prevEnvStatus !== status;
  const needsStatusRedeploy = secretCreated || statusChanged || ['SUSPENDED', 'EXPIRED'].includes(status);
  if (needsStatusRedeploy) {
    try {
      await railway.deployService({
        environmentId: shop.railway_environment_id,
        serviceId: shop.railway_service_id
      });
      const healthOk = await waitCustomerHealth(shop.shop_url, secretCreated ? 24 : 18);
      if (!healthOk) {
        console.warn('[shops] customer health not ready after redeploy; will still attempt snapshot push');
      }
    } catch (e) {
      if (secretCreated) {
        return { ok: false, error: 'secret set but redeploy failed: ' + String(e.message || e).slice(0, 120) };
      }
      console.warn('[shops] status redeploy:', e.message || e);
    }
  }

  let pushed = null;
  let lastPushErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      pushed = await sync.pushSnapshotToCustomerUrl(shop.shop_url, secret, snapshot);
      lastPushErr = null;
      break;
    } catch (e) {
      lastPushErr = e;
      const msg = String(e.message || e);
      if (/SHOP_SUSPENDED|SHOP_EXPIRED/i.test(msg) && ['SUSPENDED', 'EXPIRED'].includes(status)) {
        audit('system', 'customer_entitlement_sync_deferred', shopId, { error: msg.slice(0, 160), via: 'env_redeploy' });
        return { ok: true, deferred_http_sync: true, reason: msg.slice(0, 160), subscription_status: status };
      }
      if (!/starting|502|503|fetch failed|ECONNREFUSED|timeout|HEALTH|UNAVAILABLE/i.test(msg) && attempt >= 2) {
        break;
      }
      console.warn(`[shops] snapshot push attempt ${attempt} failed:`, msg.slice(0, 120));
      await new Promise((r) => setTimeout(r, 8000 * attempt));
      await waitCustomerHealth(shop.shop_url, 6);
    }
  }
  if (lastPushErr) {
    const msg = String(lastPushErr.message || lastPushErr);
    if (/SHOP_SUSPENDED|SHOP_EXPIRED|starting|502|503/i.test(msg)) {
      audit('system', 'customer_entitlement_sync_deferred', shopId, { error: msg.slice(0, 160), via: 'env_redeploy' });
      return { ok: true, deferred_http_sync: true, reason: msg.slice(0, 160), subscription_status: status };
    }
    throw lastPushErr;
  }
  audit('system', 'customer_entitlement_synced', shopId, {
    package_id: snapshot.package_id,
    addon_ids: snapshot.addon_ids,
    subscription_status: snapshot.subscription_status,
    redeployed: !!needsStatusRedeploy
  });
  return { ok: true, pushed: railway.redact ? require('./railway-client').redact(pushed) : pushed };
}

async function waitCustomerHealth(shopUrl, attempts = 12) {
  const base = String(shopUrl || '').replace(/\/$/, '');
  if (!base) return false;
  for (let i = 1; i <= attempts; i++) {
    try {
      const h = await fetch(base + '/health', { signal: AbortSignal.timeout(12000) }).then((r) => r.json());
      if (h && h.ok) return true;
    } catch (_) { /* */ }
    await new Promise((r) => setTimeout(r, 10000));
  }
  return false;
}

function queueCustomerEntitlementSync(shopId) {
  const job = { queued: true, shop_id: shopId, at: nowIso() };
  Promise.resolve()
    .then(() => syncCustomerEntitlements(shopId))
    .then((r) => { job.result = r; job.queued = false; })
    .catch((e) => {
      job.queued = false;
      job.error = String(e.message || e).slice(0, 200);
      audit('system', 'customer_entitlement_sync_failed', shopId, { error: job.error });
    });
  return job;
}

/** Current deployment shop suspension / access check (lab or customer instance). */
function getCurrentShopSuspension() {
  ensureSchema();
  if (controlPlane?.getCurrentShopAccess) {
    const access = controlPlane.getCurrentShopAccess();
    return {
      suspended: !access.allowed,
      shop_id: access.shop_id || null,
      shop_name: access.shop_name || null,
      subscription_status: access.subscription_status || access.access_state,
      access_state: access.access_state,
      has_record: access.has_record !== false,
      source: access.source || 'access',
      message: access.message || null,
      contact_admin_url: access.contact_admin_url || '',
      days_remaining: access.days_remaining,
      grace_active: access.grace_active,
      protected_production: !!access.protected_production
    };
  }
  if (entitlements?.isChisaFoodProtected?.()) {
    return { suspended: false, protected_production: true };
  }
  // Prefer DB (updated by saas sync) over stale process.env after reactivation.
  const key = entitlements?.shopKey?.() || process.env.SHOP_ENTITLEMENT_KEY || 'lab';
  try {
    const row = dbGet('SELECT id, shop_name, subscription_status, is_active FROM platform_shops WHERE id = ?', [key]);
    if (row) {
      const suspended = row.subscription_status === 'SUSPENDED' || row.subscription_status === 'EXPIRED' || Number(row.is_active) === 0;
      return {
        suspended,
        shop_id: row.id,
        shop_name: row.shop_name,
        subscription_status: row.subscription_status,
        access_state: row.subscription_status,
        has_record: true,
        source: 'db'
      };
    }
  } catch (_) { /* */ }
  const envStatus = String(process.env.SHOP_SUBSCRIPTION_STATUS || '').toUpperCase();
  if (envStatus === 'SUSPENDED' || envStatus === 'EXPIRED') {
    return {
      suspended: true,
      shop_id: key,
      subscription_status: envStatus,
      access_state: envStatus,
      has_record: true,
      source: 'env'
    };
  }
  return { suspended: false, shop_id: key, has_record: false };
}

function assertShopNotSuspended() {
  if (entitlements?.isChisaFoodProtected?.()) return { allowed: true };
  if (controlPlane?.assertShopAccess) {
    try {
      return controlPlane.assertShopAccess();
    } catch (err) {
      if (err.code === 'SHOP_SUSPENDED' || err.code === 'SHOP_EXPIRED' || err.code === 'SHOP_ACCESS_BLOCKED') {
        const access = err.access || controlPlane.getCurrentShopAccess?.() || {};
        const msg = access.message;
        const friendly = msg
          ? `${msg.title || 'Service Temporarily Unavailable'}: ${(msg.body || msg.body_text || '').split('\n')[0]}`
          : 'SHOP_SUSPENDED: Your shop access has been temporarily suspended. Please contact your administrator.';
        const e = new Error(friendly);
        e.code = err.code === 'SHOP_EXPIRED' ? 'SHOP_EXPIRED' : 'SHOP_SUSPENDED';
        e.status = 403;
        e.access = access;
        throw e;
      }
      throw err;
    }
  }
  const s = getCurrentShopSuspension();
  if (s.suspended) {
    const err = new Error('SHOP_SUSPENDED: Your shop access has been temporarily suspended. Please contact your administrator.');
    err.code = 'SHOP_SUSPENDED';
    err.status = 403;
    err.access = s;
    throw err;
  }
  return { allowed: true };
}

function listAuditForShop(shopId, limit = 50) {
  requireEnabled();
  ensureSchema();
  const rows = dbAll(
    `SELECT * FROM platform_audit_logs
     WHERE entity_type = 'shop' AND entity_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [String(shopId), Math.min(Number(limit) || 50, 200)]
  );
  return {
    success: true,
    data: rows.map((r) => ({
      ...r,
      detail: (() => { try { return JSON.parse(r.detail_json || '{}'); } catch (_) { return {}; } })()
    }))
  };
}

function bootstrapLabCustomers(actor) {
  requireEnabled();
  ensureSchema();
  if (platform?.bootstrapLabSamples) platform.bootstrapLabSamples(actor);

  const pkgs = dbAll('SELECT id, name FROM platform_packages');
  const floor = pkgs.find((p) => /Shop Floor/i.test(p.name)) || pkgs[0];
  const starter = pkgs.find((p) => /Starter/i.test(p.name)) || pkgs.find((p) => p.id !== floor?.id) || floor;
  const addons = dbAll('SELECT id, name FROM platform_addons');
  const online = addons.find((a) => /Online Ordering/i.test(a.name));

  const created = [];
  const ensure = (wantedName, payload) => {
    const existing = dbGet('SELECT id FROM platform_shops WHERE shop_name = ?', [wantedName]);
    if (existing) {
      created.push(getShop(existing.id).data);
      return;
    }
    const r = createShop({ ...payload, shop_name: wantedName }, actor);
    created.push(r.data);
  };

  ensure('LAB CUSTOMER A', {
    owner_name: 'Lab Owner A',
    owner_email: 'lab-a@example.test',
    contact_phone: '+27000000001',
    package_id: floor?.id || null,
    addon_ids: online ? [online.id] : [],
    subscription_status: 'ACTIVE',
    notes: 'Phase 5 isolation test A — Shop Floor + Online'
  });
  ensure('LAB CUSTOMER B', {
    owner_name: 'Lab Owner B',
    owner_email: 'lab-b@example.test',
    contact_phone: '+27000000002',
    // Starter-like: Shop Floor base only (no Online). Avoid Lab Starter Online which embeds mod.online.
    package_id: floor?.id || starter?.id || null,
    addon_ids: [],
    subscription_status: 'TRIAL',
    notes: 'Phase 5 isolation test B — floor only, no Online add-on'
  });

  return { success: true, data: created };
}

module.exports = {
  SUB_STATUSES,
  ensureSchema,
  listShops,
  getShop,
  createShop,
  updateShopMeta,
  deleteShop,
  assignPackageAndAddons,
  setOverrides,
  setSubscriptionStatus,
  syncCustomerEntitlements,
  queueCustomerEntitlementSync,
  getCurrentShopSuspension,
  assertShopNotSuspended,
  listAuditForShop,
  bootstrapLabCustomers,
  assertNotChisaFood,
  mapShop
};
