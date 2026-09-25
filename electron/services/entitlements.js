/**
 * Entitlement engine (Phase 4) — ONE source of truth for module access.
 *
 * Calculation: package modules + add-ons + overrides + auto-expanded dependencies.
 * Enforcement only when ENTITLEMENTS_ENFORCE is on AND host is NOT Chisa Food protected.
 * Turning modules OFF never deletes data.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/db');

let platform;
try { platform = require('./platform-control'); } catch (_) { platform = null; }

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }
function truthyEnv(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}

/** Explicit safeguard: never enforce on Chisa Food production. */
function isChisaFoodProtected() {
  if (truthyEnv(process.env.SHOP_POS_ENTITLEMENT_PROTECTED)) return true;
  const hay = [
    process.env.SHOP_POS_PUBLIC_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.RAILWAY_STATIC_URL,
    process.env.RAILWAY_SERVICE_PEACEFUL_MOTIVATION_URL,
    process.env.SHOP_POS_CLOUD,
    process.env.SHOP_POS_SYNC_URL
  ].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes('chisafood')) return true;
  // Known production project id from Phase 0 docs
  if (String(process.env.RAILWAY_PROJECT_ID || '') === '0296f469-4b4e-4b3f-99fb-063b03535e39') return true;
  return false;
}

function enforcementEnabled() {
  if (isChisaFoodProtected()) return false;
  return truthyEnv(process.env.ENTITLEMENTS_ENFORCE);
}

function shopKey() {
  return String(process.env.SHOP_ENTITLEMENT_KEY || 'lab').trim() || 'lab';
}

function ensureSchema() {
  try {
    dbGet('SELECT 1 FROM platform_shop_assignments LIMIT 1');
    return;
  } catch (_) { /* */ }
  const files = [
    path.join(__dirname, '../database/migrations-v124.sql'),
    path.join(__dirname, '../../supabase/migrations/20260921_platform_entitlements.sql')
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      getDb().exec(fs.readFileSync(f, 'utf8'));
      console.log('[entitlements] schema ensured from', path.basename(f));
      return;
    } catch (e) {
      console.warn('[entitlements] schema:', e.message || e);
    }
  }
}

function audit(actor, action, detail) {
  try {
    if (platform?.isEnabled?.()) {
      // reuse platform audit table when present
      dbRun(
        `INSERT INTO platform_audit_logs (actor, action, entity_type, entity_id, detail_json, created_at)
         VALUES (?,?,?,?,?,?)`,
        [actor || 'system', action, 'entitlement', shopKey(), JSON.stringify(detail || {}), nowIso()]
      );
    }
  } catch (_) { /* */ }
}

/** Short flag aliases used by UI / tests */
const FLAG_ALIASES = {
  pos: 'app.pos',
  admin: 'app.admin',
  staff: 'app.staff',
  inventory: 'core.catalog',
  online: 'mod.online',
  delivery: 'app.delivery',
  driver: 'app.driver',
  signage: 'mod.signage',
  signage_player: 'mod.signage_player',
  branding: 'mod.branding',
  kiosk: 'mod.kiosk',
  drive_thru: 'mod.drive_thru',
  recipe: 'app.recipe',
  hr: 'app.hr',
  accounting: 'app.accounting',
  expenses: 'app.expenses',
  loyalty: 'mod.loyalty',
  communication: 'mod.communication',
  radio: 'mod.radio',
  meeting: 'mod.meeting',
  investor: 'mod.investor',
  release: 'mod.release',
  referral: 'mod.referral',
  manager: 'app.manager',
  manager_operations: 'mod.manager_operations',
  restaurant: 'mod.restaurant',
  kds: 'mod.kds'
};

/**
 * RPC namespace → required module ids (from Phase 2 catalog + platforms).
 * Shared/core namespaces are always allowed.
 */
const RPC_NAMESPACE_MODULES = {
  auth: [],
  settings: [],
  categories: ['core.catalog'],
  products: ['core.catalog'],
  stock: ['core.catalog'],
  inventory: ['core.catalog'],
  customers: ['core.customers_suppliers'],
  suppliers: ['core.customers_suppliers'],
  branches: ['core.branches'],
  print: ['core.device_print'],
  printers: ['core.device_print'],
  backup: ['core.audit_security'],
  audit: ['core.audit_security'],
  db: ['core.audit_security'],
  dev: ['core.audit_security'],
  sync: ['core.sync_notify'],
  notifications: ['core.sync_notify'],
  search: [],
  file: [],
  export: [],
  app: [],
  dashboard: ['app.admin'],
  sales: ['app.pos'],
  shifts: ['app.pos'],
  held: ['app.pos'],
  returns: ['app.pos'],
  store: ['app.pos'],
  cashup: ['mod.ops_compliance'],
  operating: ['core.settings'],
  analytics: ['mod.reports'],
  reports: ['mod.reports'],
  quotes: ['mod.layby_quotes'],
  layby: ['mod.layby_quotes'],
  giftcards: ['mod.loyalty'],
  loyalty: ['mod.loyalty'],
  rewards: ['mod.loyalty'],
  vouchers: ['mod.combos'],
  combos: ['mod.combos'],
  credit: ['mod.on_account'],
  taken: ['mod.on_account'],
  po: ['mod.purchase_orders'],
  expenses: ['app.expenses'],
  bookkeeping: ['app.accounting'],
  acc: ['app.accounting'],
  staff: ['app.staff'],
  hr: ['app.hr'],
  payroll: ['app.hr'],
  jobs: ['mod.careers'],
  mgrHr: ['app.mgr_hr'],
  recipe: ['app.recipe'],
  waste: ['app.recipe'],
  delivery: ['app.delivery'],
  driver: ['app.driver'],
  web: ['mod.online'],
  customer: ['mod.customer_display'],
  kitchen: ['mod.kds'],
  tables: ['mod.restaurant'],
  signage: ['mod.signage'],
  kiosk: ['mod.kiosk'],
  radio: ['mod.radio'],
  meeting: ['mod.meeting'],
  investor: ['mod.investor'],
  release: ['mod.release'],
  referral: ['mod.referral'],
  mobile: ['app.manager'],
  whatsapp: ['mod.communication'],
  cc: ['mod.communication'],
  donations: ['mod.donations'],
  automation: ['mod.automation'],
  customfields: ['core.settings'],
  security: ['core.audit_security'],
  ops: ['mod.ops_compliance'],
  mo: ['mod.manager_operations'],
  managerOps: ['mod.manager_operations'],
  entitlements: [], // shop entitlement snapshot — always allowed
  platform: [], // platform control itself
  saas: [] // platform→customer sync (authenticated by secret inside handler)
};

/** Method-level requirements (finer than namespace). */
const RPC_METHOD_MODULES = {
  'settings:saveMenuHighlights': ['mod.branding'],
  'settings:getMenuHighlights': ['mod.branding', 'mod.online', 'app.admin']
};

/** Admin section id → module entitlement id */
function adminSectionModuleId(sectionId) {
  return `admin.${sectionId}`;
}

/** Main nav page → module */
const NAV_PAGE_MODULES = {
  dashboard: ['app.admin'],
  admin: ['app.admin'],
  pos: ['app.pos'],
  staff: ['app.staff'],
  products: ['core.catalog'],
  categories: ['core.catalog'],
  stock: ['core.catalog'],
  customers: ['core.customers_suppliers'],
  suppliers: ['core.customers_suppliers'],
  expenses: ['app.expenses'],
  quotes: ['mod.layby_quotes'],
  returns: ['app.pos'],
  layby: ['mod.layby_quotes'],
  giftcards: ['mod.loyalty'],
  'document-hub': ['mod.document_hub'],
  whatsapp: ['mod.communication'],
  operations: ['mod.ops_compliance'],
  'manager-ops': ['mod.manager_operations'],
  restaurant: ['mod.restaurant'],
  recipe: ['app.recipe'],
  'purchase-orders': ['mod.purchase_orders'],
  reports: ['mod.reports'],
  bookkeeping: ['app.accounting'],
  users: ['core.users_permissions'],
  audit: ['core.audit_security']
};

/** HTTP portal mounts → modules */
const HTTP_MOUNT_MODULES = {
  '/order': ['mod.online'],
  '/signage': ['mod.signage'],
  '/signage-player': ['mod.signage_player'],
  '/signage-media': ['mod.signage'],
  '/signage-sse': ['mod.signage'],
  '/kiosk': ['mod.kiosk'],
  '/drive-thru': ['mod.drive_thru'],
  '/driver': ['app.driver'],
  '/meeting': ['mod.meeting'],
  '/investor': ['mod.investor'],
  '/release': ['mod.release'],
  '/radio': ['mod.radio'],
  '/radio-studio': ['mod.radio_studio'],
  '/radio-media': ['mod.radio'],
  '/manager': ['app.manager'],
  '/manager-ops': ['mod.manager_operations'],
  '/expenses': ['app.expenses'],
  '/studio': ['app.studio'],
  '/kitchen-display.html': ['mod.kds'],
  '/customer-display.html': ['mod.customer_display'],
  '/apply': ['mod.careers']
};

function modulesById() {
  // Prefer platform-control when available (lab); fall back to local synced catalog (customer shops).
  if (platform) {
    try {
      const r = platform.listModules({});
      const map = {};
      for (const m of r.data || []) map[m.id] = m;
      if (Object.keys(map).length) return map;
    } catch (_) { /* */ }
  }
  try {
    const rows = dbAll('SELECT * FROM platform_modules WHERE is_active = 1 OR is_active IS NULL');
    const map = {};
    for (const m of rows) map[m.id] = m;
    return map;
  } catch (_) {
    return {};
  }
}

function sharedCoreSet(map) {
  const s = new Set();
  for (const [id, m] of Object.entries(map)) {
    if (m.kind === 'shared_core' || m.commercial_class === 'shared_core') s.add(id);
  }
  ['core.auth', 'core.catalog', 'core.payments', 'core.settings', 'core.users_permissions',
    'core.branches', 'core.rpc_server', 'core.device_print', 'core.audit_security',
    'core.sync_notify', 'core.customers_suppliers', 'app.admin'].forEach((id) => s.add(id));
  return s;
}

function expandDeps(ids, map) {
  const out = new Set(ids);
  const EXTRA = platform?.EXTRA_DEPS || {};
  const alias = (id) => (id === 'mod.hr' ? 'app.hr' : id === 'mod.staff' ? 'app.staff' : id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...out]) {
      const m = map[id];
      const deps = [
        ...(Array.isArray(m?.dependencies) ? m.dependencies : []),
        ...(EXTRA[id] || [])
      ].map(alias);
      for (const d of deps) {
        if (!d) continue;
        if (!out.has(d)) {
          // only add if known or shared
          if (map[d] || sharedCoreSet(map).has(d)) {
            out.add(d);
            changed = true;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Compute effective entitlements for a shop.
 * Behavior for missing deps: AUTO-INCLUDE required dependencies (documented).
 */
function computeEffectiveEntitlements(key = shopKey()) {
  ensureSchema();
  const map = modulesById();
  const shared = sharedCoreSet(map);
  const enabled = new Set(shared);

  // Fail-safe: if enforcement on but catalog empty / platform broken → core only
  const failClosedSellable = enforcementEnabled();

  let packageId = null;
  let addonIds = [];
  let overrides = [];

  try {
    const asg = dbGet('SELECT * FROM platform_shop_assignments WHERE shop_key = ?', [key]);
    packageId = asg?.package_id || null;
    addonIds = dbAll('SELECT addon_id FROM platform_shop_addons WHERE shop_key = ?', [key]).map((r) => r.addon_id);
    overrides = dbAll('SELECT module_id, enabled, reason FROM platform_shop_overrides WHERE shop_key = ?', [key]);
  } catch (e) {
    if (failClosedSellable) {
      return buildResult(key, enabled, shared, {
        package_id: null,
        addon_ids: [],
        overrides: [],
        fail_safe: 'schema_or_read_error_core_only',
        error: String(e.message || e)
      });
    }
    // enforcement off → full access
    return fullAccessResult(key, map, shared);
  }

  if (!enforcementEnabled()) {
    return fullAccessResult(key, map, shared);
  }

  // No assignment → fail closed (core only), not full grant
  if (!packageId && !addonIds.length && !overrides.length) {
    return buildResult(key, enabled, shared, {
      package_id: null,
      addon_ids: [],
      overrides: [],
      fail_safe: 'no_assignment_core_only'
    });
  }

  if (packageId) {
    try {
      const items = dbAll('SELECT module_id FROM platform_package_items WHERE package_id = ?', [packageId]);
      for (const it of items) enabled.add(it.module_id);
    } catch (_) { /* */ }
  }
  for (const aid of addonIds) {
    try {
      const items = dbAll('SELECT module_id FROM platform_addon_items WHERE addon_id = ?', [aid]);
      for (const it of items) enabled.add(it.module_id);
    } catch (_) { /* */ }
  }

  // Overrides: enabled=1 force on, enabled=0 force off (applied after expand for offs)
  const forceOn = [];
  const forceOff = [];
  for (const o of overrides) {
    if (Number(o.enabled) === 1) forceOn.push(o.module_id);
    else forceOff.push(o.module_id);
  }
  for (const id of forceOn) enabled.add(id);

  // Auto-include dependencies
  const expanded = expandDeps(enabled, map);
  // Manager Operations ships with Admin on every shop (Chisa + city SaaS)
  if (expanded.has('app.admin') || enabled.has('app.admin')) {
    if (map['mod.manager_operations']) expanded.add('mod.manager_operations');
    if (map['admin.manager-ops']) expanded.add('admin.manager-ops');
  }
  for (const id of expanded) enabled.add(id);

  // Force off last (cannot turn off shared core)
  for (const id of forceOff) {
    if (!shared.has(id)) enabled.delete(id);
  }

  return buildResult(key, enabled, shared, {
    package_id: packageId,
    addon_ids: addonIds,
    overrides,
    dependency_behavior: 'auto_include_required_dependencies'
  });
}

function fullAccessResult(key, map, shared) {
  const enabled = new Set(shared);
  for (const id of Object.keys(map)) enabled.add(id);
  return buildResult(key, enabled, shared, {
    package_id: null,
    addon_ids: [],
    overrides: [],
    fail_safe: 'enforcement_disabled_full_access'
  });
}

function buildResult(key, enabledSet, shared, meta) {
  const modules = {};
  for (const id of enabledSet) modules[id] = true;
  // Explicit false for known sellable not enabled (helps UI)
  try {
    const all = modulesById();
    for (const id of Object.keys(all)) {
      if (modules[id] == null) modules[id] = false;
    }
  } catch (_) { /* */ }

  const flags = {};
  for (const [flag, mid] of Object.entries(FLAG_ALIASES)) {
    flags[flag] = !!modules[mid] || shared.has(mid);
  }
  flags.inventory = !!modules['core.catalog'];

  const pages = {};
  for (const [pageId, mods] of Object.entries(NAV_PAGE_MODULES)) {
    pages[pageId] = mods.some((m) => !!modules[m] || shared.has(m));
  }
  pages.settings = true;

  const admin_sections = {};
  try {
    const all = modulesById();
    for (const id of Object.keys(all)) {
      if (!id.startsWith('admin.')) continue;
      const sectionId = id.slice('admin.'.length);
      admin_sections[sectionId] = !!modules[id];
    }
  } catch (_) { /* */ }
  // Core admin shell sections stay available when app.admin is on
  if (modules['app.admin'] || shared.has('app.admin')) {
    ['permissions', 'cashiers', 'branches', 'device', 'printer', 'receipt', 'payments',
      'security', 'backup', 'database', 'system-health', 'developer', 'formats', 'tax',
      'operating', 'shifts', 'customize', 'approvals', 'importexport', 'customfields', 'overview',
      'manager-ops'
    ].forEach((s) => {
      if (admin_sections[s] == null) admin_sections[s] = true;
    });
  }
  if (modules['mod.manager_operations'] || modules['admin.manager-ops']) {
    admin_sections['manager-ops'] = true;
  }

  const payload = {
    shop_key: key,
    enforcement: enforcementEnabled(),
    protected_production: isChisaFoodProtected(),
    computed_at: nowIso(),
    modules,
    flags,
    pages,
    admin_sections,
    shared_core: [...shared],
    meta: meta || {}
  };

  // cache
  try {
    ensureSchema();
    const hash = crypto.createHash('sha256').update(JSON.stringify({
      p: meta?.package_id, a: meta?.addon_ids, o: meta?.overrides, m: [...enabledSet].sort()
    })).digest('hex').slice(0, 16);
    dbRun(
      `INSERT INTO platform_entitlement_cache (shop_key, entitlements_json, computed_at, source_hash)
       VALUES (?,?,?,?)
       ON CONFLICT (shop_key) DO UPDATE SET entitlements_json=excluded.entitlements_json,
         computed_at=excluded.computed_at, source_hash=excluded.source_hash`,
      [key, JSON.stringify(payload), payload.computed_at, hash]
    );
  } catch (_) {
    try {
      dbRun('DELETE FROM platform_entitlement_cache WHERE shop_key = ?', [key]);
      dbRun(
        `INSERT INTO platform_entitlement_cache (shop_key, entitlements_json, computed_at, source_hash)
         VALUES (?,?,?,?)`,
        [key, JSON.stringify(payload), payload.computed_at, 'x']
      );
    } catch (__) { /* */ }
  }

  return payload;
}

let memoryCache = { at: 0, key: '', data: null };
const CACHE_MS = 5000;

function getEntitlements(force = false) {
  const key = shopKey();
  if (!force && memoryCache.data && memoryCache.key === key && (Date.now() - memoryCache.at) < CACHE_MS) {
    return memoryCache.data;
  }
  try {
    const data = computeEffectiveEntitlements(key);
    memoryCache = { at: Date.now(), key, data };
    return data;
  } catch (e) {
    // Fail-safe: do NOT grant all modules when enforcement is on
    if (enforcementEnabled()) {
      const shared = sharedCoreSet({});
      const enabled = new Set(shared);
      const data = buildResult(key, enabled, shared, {
        fail_safe: 'compute_error_core_only',
        error: String(e.message || e)
      });
      memoryCache = { at: Date.now(), key, data };
      return data;
    }
    return fullAccessResult(key, modulesById(), sharedCoreSet(modulesById()));
  }
}

function invalidateCache() {
  memoryCache = { at: 0, key: '', data: null };
}

function isModuleEnabled(moduleId) {
  if (!enforcementEnabled()) return true;
  if (!moduleId) return true;
  const ent = getEntitlements();
  if (ent.shared_core?.includes(moduleId)) return true;
  if (ent.modules?.[moduleId] === true) return true;
  // alias flags
  for (const [flag, mid] of Object.entries(FLAG_ALIASES)) {
    if (moduleId === flag || moduleId === mid) return !!ent.flags?.[flag] || !!ent.modules?.[mid];
  }
  return false;
}

function requireModule(moduleId, label) {
  if (isModuleEnabled(moduleId)) return true;
  const err = new Error(`FEATURE_NOT_INCLUDED: ${label || moduleId} is not in this shop's plan`);
  err.code = 'FEATURE_NOT_INCLUDED';
  err.status = 403;
  err.module_id = moduleId;
  throw err;
}

function requireAnyModule(moduleIds, label) {
  if (!enforcementEnabled()) return true;
  if (!moduleIds?.length) return true;
  if (moduleIds.some((id) => isModuleEnabled(id))) return true;
  const err = new Error(`FEATURE_NOT_INCLUDED: ${label || moduleIds.join('|')} is not in this shop's plan`);
  err.code = 'FEATURE_NOT_INCLUDED';
  err.status = 403;
  throw err;
}

function assertRpcAllowed(method) {
  if (!enforcementEnabled()) return { allowed: true };
  const m = String(method || '').trim();
  const ns = m.split(':')[0];
  if (!ns) return { allowed: true };
  if (ns === 'platform') return { allowed: true };
  if (ns === 'saas') return { allowed: true };

  // Method-level branding / customize gates
  if (RPC_METHOD_MODULES[m]) {
    try {
      requireAnyModule(RPC_METHOD_MODULES[m], m);
    } catch (e) {
      return { allowed: false, error: e };
    }
  }
  // Gate settings saves that touch branding when mod.branding is sellable and off
  // (handler also checks; this is belt-and-suspenders for known method names)

  const required = RPC_NAMESPACE_MODULES[ns];
  if (required == null) {
    return { allowed: true, note: 'unmapped_namespace_allowed' };
  }
  if (!required.length) return { allowed: true };
  try {
    requireAnyModule(required, ns);
    return { allowed: true };
  } catch (e) {
    return { allowed: false, error: e };
  }
}

function assertHttpMountAllowed(urlPath) {
  if (!enforcementEnabled()) return { allowed: true };
  const p = String(urlPath || '');
  for (const [mount, mods] of Object.entries(HTTP_MOUNT_MODULES)) {
    if (p === mount || p.startsWith(mount + '/') || p.startsWith(mount + '?')) {
      try {
        requireAnyModule(mods, mount);
        return { allowed: true };
      } catch (e) {
        return { allowed: false, error: e };
      }
    }
  }
  return { allowed: true };
}

function isAdminSectionAllowed(sectionId) {
  if (!enforcementEnabled()) return true;
  const mid = adminSectionModuleId(sectionId);
  // If admin submodule not in catalog / not explicitly false, fall back to parent app modules
  const ent = getEntitlements();
  if (ent.modules?.[mid] === true) return true;
  if (ent.modules?.[mid] === false) return false;
  // Core admin sections that map to shared
  const coreSections = new Set([
    'permissions', 'cashiers', 'branches', 'device', 'printer', 'receipt', 'payments',
    'security', 'backup', 'database', 'system-health', 'developer', 'formats', 'tax',
    'operating', 'shifts', 'approvals', 'importexport', 'customfields', 'overview'
  ]);
  if (coreSections.has(sectionId)) return true;
  // Online branding / POS customize requires mod.branding (sellable)
  if (sectionId === 'customize' || sectionId === 'online-branding') {
    return isModuleEnabled('mod.branding');
  }
  // If package never listed this admin.* id, infer from related major module when possible
  const infer = {
    'online-orders': 'mod.online',
    'digital-signage': 'mod.signage',
    'delivery-dept': 'app.delivery',
    recipe: 'app.recipe',
    'accounting-workspace': 'app.accounting',
    staffhr: 'app.staff',
    staffportal: 'app.staff',
    'hr-workspace': 'app.hr',
    payroll: 'app.hr',
    loyalty: 'mod.loyalty',
    combos: 'mod.combos',
    radio: 'mod.radio',
    'communication-center': 'mod.communication',
    'business-modules': 'mod.biz_modules_pack',
    'referral-dept': 'mod.referral',
    'business-manager': 'app.manager',
    'mobile-app': 'app.manager',
    'manager-ops': 'mod.manager_operations',
    opscompliance: 'mod.ops_compliance'
  };
  if (infer[sectionId]) return isModuleEnabled(infer[sectionId]);
  // Default when enforcement on and section unknown: allow only if app.admin
  return isModuleEnabled('app.admin');
}

function isNavPageAllowed(pageId) {
  if (!enforcementEnabled()) return true;
  const mods = NAV_PAGE_MODULES[pageId];
  if (!mods) return true;
  return mods.some((m) => isModuleEnabled(m));
}

function shouldRunJob(jobModuleIds) {
  if (!enforcementEnabled()) return true;
  if (!jobModuleIds?.length) return true; // shared/core jobs
  return jobModuleIds.some((m) => isModuleEnabled(m));
}

/* —— Assignment API (platform) —— */

function getShopAssignment(key = shopKey()) {
  ensureSchema();
  const asg = dbGet('SELECT * FROM platform_shop_assignments WHERE shop_key = ?', [key]) || {
    shop_key: key, package_id: null, notes: ''
  };
  const addon_ids = dbAll('SELECT addon_id FROM platform_shop_addons WHERE shop_key = ?', [key]).map((r) => r.addon_id);
  const overrides = dbAll('SELECT * FROM platform_shop_overrides WHERE shop_key = ?', [key]);
  const entitlements = computeEffectiveEntitlements(key);
  return { success: true, data: { ...asg, addon_ids, overrides, entitlements } };
}

function saveShopAssignment(data, actor) {
  if (isChisaFoodProtected()) throw new Error('Cannot assign entitlements on protected Chisa Food production');
  ensureSchema();
  const key = String(data.shop_key || shopKey());
  if (key === 'chisafood' || /chisa/i.test(key)) {
    throw new Error('Shop key reserved/protected — cannot target Chisa Food');
  }
  const prev = getShopAssignment(key);
  const packageId = data.package_id || null;
  const addonIds = Array.isArray(data.addon_ids) ? data.addon_ids : [];
  const overrides = Array.isArray(data.overrides) ? data.overrides : null;

  // Validate package modules + addons together
  if (platform) {
    const moduleIds = [];
    if (packageId) {
      moduleIds.push(...dbAll('SELECT module_id FROM platform_package_items WHERE package_id = ?', [packageId]).map((r) => r.module_id));
    }
    for (const aid of addonIds) {
      moduleIds.push(...dbAll('SELECT module_id FROM platform_addon_items WHERE addon_id = ?', [aid]).map((r) => r.module_id));
    }
    if (overrides) {
      for (const o of overrides) {
        if (Number(o.enabled) === 1) moduleIds.push(o.module_id);
      }
    }
    const v = platform.validateModuleSelection(moduleIds);
    if (!v.ok) {
      const err = new Error('Invalid entitlement combination: ' + v.errors.join('; '));
      err.validation = v;
      throw err;
    }
  }

  const existing = dbGet('SELECT shop_key FROM platform_shop_assignments WHERE shop_key = ?', [key]);
  if (existing) {
    dbRun(
      `UPDATE platform_shop_assignments SET package_id=?, notes=?, updated_at=?, updated_by=? WHERE shop_key=?`,
      [packageId, data.notes || '', nowIso(), actor?.username || 'platform', key]
    );
  } else {
    dbRun(
      `INSERT INTO platform_shop_assignments (shop_key, package_id, notes, updated_at, updated_by) VALUES (?,?,?,?,?)`,
      [key, packageId, data.notes || '', nowIso(), actor?.username || 'platform']
    );
  }
  dbRun('DELETE FROM platform_shop_addons WHERE shop_key = ?', [key]);
  for (const aid of addonIds) {
    dbRun('INSERT INTO platform_shop_addons (shop_key, addon_id) VALUES (?,?)', [key, aid]);
  }
  if (overrides) {
    dbRun('DELETE FROM platform_shop_overrides WHERE shop_key = ?', [key]);
    for (const o of overrides) {
      dbRun(
        `INSERT INTO platform_shop_overrides (shop_key, module_id, enabled, reason, updated_at, updated_by)
         VALUES (?,?,?,?,?,?)`,
        [key, o.module_id, Number(o.enabled) ? 1 : 0, o.reason || '', nowIso(), actor?.username || 'platform']
      );
    }
  }

  invalidateCache();
  const next = getShopAssignment(key);
  audit(actor?.username || 'platform', 'save_shop_assignment', {
    shop_key: key,
    previous: { package_id: prev.data?.package_id, addon_ids: prev.data?.addon_ids },
    next: { package_id: next.data.package_id, addon_ids: next.data.addon_ids },
    flags_before: prev.data?.entitlements?.flags,
    flags_after: next.data.entitlements?.flags
  });
  return next;
}

function status() {
  return {
    success: true,
    enforcement: enforcementEnabled(),
    protected_production: isChisaFoodProtected(),
    shop_key: shopKey(),
    phase: 4
  };
}

/**
 * Public feature catalog for customer UI (visibility + lock metadata).
 * Does NOT grant access — server RPC/HTTP gates remain authoritative.
 * Safe to call without platform operator privileges.
 */
function getFeatureCatalog(force = false) {
  ensureSchema();
  const ent = getEntitlements(force);
  const key = shopKey();
  const map = modulesById();

  let packageRow = null;
  let packageId = ent.meta?.package_id || null;
  try {
    if (!packageId) {
      packageId = dbGet('SELECT package_id FROM platform_shop_assignments WHERE shop_key = ?', [key])?.package_id || null;
    }
    if (packageId) {
      packageRow = dbGet('SELECT id, name, description FROM platform_packages WHERE id = ?', [packageId]);
    }
  } catch (_) { /* */ }

  let currentAddons = [];
  try {
    const aids = Array.isArray(ent.meta?.addon_ids)
      ? ent.meta.addon_ids
      : dbAll('SELECT addon_id FROM platform_shop_addons WHERE shop_key = ?', [key]).map((r) => r.addon_id);
    currentAddons = aids.map((id) => {
      const row = dbGet('SELECT id, name, description FROM platform_addons WHERE id = ?', [id]);
      return row ? { id: row.id, name: row.name, description: row.description || '' } : { id, name: id };
    });
  } catch (_) { /* */ }

  // package_id → modules; module → packages/addons that provide it
  const packageByModule = {};
  const addonByModule = {};
  try {
    for (const row of dbAll(
      `SELECT pi.module_id, p.id AS package_id, p.name AS package_name
       FROM platform_package_items pi
       JOIN platform_packages p ON p.id = pi.package_id
       WHERE p.is_active = 1 OR p.is_active IS NULL`
    )) {
      if (!packageByModule[row.module_id]) packageByModule[row.module_id] = [];
      packageByModule[row.module_id].push({ id: row.package_id, name: row.package_name });
    }
  } catch (_) { /* */ }
  try {
    for (const row of dbAll(
      `SELECT ai.module_id, a.id AS addon_id, a.name AS addon_name
       FROM platform_addon_items ai
       JOIN platform_addons a ON a.id = ai.addon_id
       WHERE a.is_active = 1 OR a.is_active IS NULL`
    )) {
      if (!addonByModule[row.module_id]) addonByModule[row.module_id] = [];
      addonByModule[row.module_id].push({ id: row.addon_id, name: row.addon_name });
    }
  } catch (_) { /* */ }

  const parseDeps = (m) => {
    const raw = m?.dependencies_json ?? m?.depends_on ?? [];
    const list = typeof raw === 'string' ? parseJson(raw, []) : (Array.isArray(raw) ? raw : []);
    return list.map((d) => String(d)).filter(Boolean);
  };

  const modules = [];
  let included = 0;
  let locked = 0;
  for (const id of Object.keys(map).sort()) {
    const m = map[id];
    if (!m || Number(m.is_active) === 0) continue;
    // Skip pure shared_core noise in explorer? Keep them as included for honesty.
    const isOn = !ent.enforcement || !!ent.modules?.[id] || !!ent.shared_core?.includes(id);
    const deps = parseDeps(m);
    const missing_deps = deps.filter((d) => ent.enforcement && !(ent.modules?.[d] || ent.shared_core?.includes(d)));
    const status = isOn ? 'included' : (missing_deps.length && !isOn ? 'locked' : 'locked');
    if (status === 'included') included += 1;
    else locked += 1;
    modules.push({
      id,
      name: m.name || id,
      description: m.description || '',
      kind: m.kind || 'sellable',
      commercial_class: m.commercial_class || 'sellable',
      sellable_addon: !!Number(m.sellable_addon),
      status,
      included: status === 'included',
      dependencies: deps,
      missing_dependencies: missing_deps,
      available_in_packages: packageByModule[id] || [],
      available_as_addons: addonByModule[id] || []
    });
  }

  const nav_pages = Object.entries(NAV_PAGE_MODULES).map(([page, mods]) => {
    const entitled = !ent.enforcement || !!ent.pages?.[page];
    const primary = mods[0];
    const mod = modules.find((x) => x.id === primary) || null;
    return {
      page,
      module_ids: mods,
      status: entitled ? 'included' : 'locked',
      included: entitled,
      name: mod?.name || page,
      description: mod?.description || '',
      available_in_packages: mod?.available_in_packages || [],
      available_as_addons: mod?.available_as_addons || [],
      missing_dependencies: mod?.missing_dependencies || []
    };
  });

  const admin_sections = Object.entries(ent.admin_sections || {}).map(([section, on]) => {
    const mid = adminSectionModuleId(section);
    const mod = modules.find((x) => x.id === mid) || null;
    const includedSec = !ent.enforcement || !!on;
    return {
      section,
      module_id: mid,
      status: includedSec ? 'included' : 'locked',
      included: includedSec,
      name: mod?.name || section,
      description: mod?.description || '',
      available_in_packages: mod?.available_in_packages || [],
      available_as_addons: mod?.available_as_addons || [],
      missing_dependencies: mod?.missing_dependencies || []
    };
  });

  return {
    success: true,
    enforcement: !!ent.enforcement,
    protected_production: !!ent.protected_production,
    shop_key: key,
    computed_at: ent.computed_at || nowIso(),
    current_package: packageRow
      ? { id: packageRow.id, name: packageRow.name, description: packageRow.description || '' }
      : (packageId ? { id: packageId, name: packageId } : null),
    current_addons: currentAddons,
    summary: {
      total: modules.length,
      included,
      locked,
      available_additional: locked
    },
    modules,
    nav_pages,
    admin_sections,
    upgrade_instruction:
      'Contact your administrator or Platform operator to upgrade your package or add-ons. Self-service billing is not enabled in this shop.'
  };
}

module.exports = {
  isChisaFoodProtected,
  enforcementEnabled,
  shopKey,
  getEntitlements,
  getFeatureCatalog,
  computeEffectiveEntitlements,
  invalidateCache,
  isModuleEnabled,
  requireModule,
  requireAnyModule,
  assertRpcAllowed,
  assertHttpMountAllowed,
  isAdminSectionAllowed,
  isNavPageAllowed,
  shouldRunJob,
  getShopAssignment,
  saveShopAssignment,
  status,
  RPC_NAMESPACE_MODULES,
  RPC_METHOD_MODULES,
  NAV_PAGE_MODULES,
  HTTP_MOUNT_MODULES,
  FLAG_ALIASES,
  adminSectionModuleId
};
