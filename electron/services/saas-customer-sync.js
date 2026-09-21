/**
 * SaaS customer entitlement sync — applies Platform catalog + assignment
 * into THIS shop's database (never Chisa Food).
 *
 * Used by:
 * - Customer boot (env SHOP_PACKAGE_ID / SHOP_ADDON_IDS)
 * - RPC saas:applyEntitlementSnapshot (platform → customer push)
 * - Lab provisioner after READY
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }

function truthyEnv(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function getSyncSecret() {
  return String(process.env.SAAS_SYNC_SECRET || '').trim();
}

function assertSyncSecret(provided) {
  const expected = getSyncSecret();
  if (!expected) throw new Error('SAAS_SYNC_SECRET not configured on this shop');
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid sync secret');
  }
}

function ensureEntitlementTables() {
  try {
    const entitlements = require('./entitlements');
    entitlements.getEntitlements?.(true);
  } catch (_) { /* */ }
  // Minimal tables if migrations not yet applied
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS platform_modules (
      id TEXT PRIMARY KEY, name TEXT, description TEXT, kind TEXT, commercial_class TEXT,
      parent_id TEXT, depends_on_json TEXT, nav_keys_json TEXT, rpc_prefixes_json TEXT,
      http_mounts_json TEXT, jobs_json TEXT, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS platform_packages (
      id TEXT PRIMARY KEY, name TEXT, description TEXT, price REAL, currency TEXT,
      is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_package_items (
      package_id TEXT NOT NULL, module_id TEXT NOT NULL, PRIMARY KEY (package_id, module_id)
    );
    CREATE TABLE IF NOT EXISTS platform_addons (
      id TEXT PRIMARY KEY, name TEXT, description TEXT, price REAL, currency TEXT,
      is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_addon_items (
      addon_id TEXT NOT NULL, module_id TEXT NOT NULL, PRIMARY KEY (addon_id, module_id)
    );
    CREATE TABLE IF NOT EXISTS platform_shop_assignments (
      shop_key TEXT PRIMARY KEY, package_id TEXT, notes TEXT, updated_at TEXT, updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_shop_addons (
      shop_key TEXT NOT NULL, addon_id TEXT NOT NULL, PRIMARY KEY (shop_key, addon_id)
    );
    CREATE TABLE IF NOT EXISTS platform_shop_overrides (
      shop_key TEXT NOT NULL, module_id TEXT NOT NULL, enabled INTEGER NOT NULL,
      reason TEXT, updated_at TEXT, updated_by TEXT, PRIMARY KEY (shop_key, module_id)
    );
    CREATE TABLE IF NOT EXISTS platform_shops (
      id TEXT PRIMARY KEY, shop_name TEXT, owner_name TEXT, owner_email TEXT,
      subscription_status TEXT, is_active INTEGER DEFAULT 1, package_id TEXT,
      updated_at TEXT
    );
  `);
}

/**
 * Apply a full snapshot from Platform (catalog + this shop assignment + subscription).
 * Does NOT delete business data.
 */
function applyEntitlementSnapshot(snapshot, actor = 'saas-sync') {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot required');
  ensureEntitlementTables();
  const shopKey = String(snapshot.shop_key || process.env.SHOP_ENTITLEMENT_KEY || '').trim();
  if (!shopKey) throw new Error('shop_key required');
  if (/chisa/i.test(shopKey + (snapshot.shop_name || ''))) {
    throw new Error('Refusing to apply snapshot related to Chisa Food');
  }

  const modules = Array.isArray(snapshot.modules) ? snapshot.modules : [];
  for (const m of modules) {
    if (!m?.id) continue;
    dbRun(
      `INSERT INTO platform_modules (id, name, description, kind, commercial_class, parent_id, depends_on_json, nav_keys_json, rpc_prefixes_json, http_mounts_json, jobs_json, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
         kind=excluded.kind, commercial_class=excluded.commercial_class, parent_id=excluded.parent_id,
         depends_on_json=excluded.depends_on_json, is_active=excluded.is_active`,
      [
        m.id, m.name || m.id, m.description || '', m.kind || '', m.commercial_class || '',
        m.parent_id || null,
        JSON.stringify(m.depends_on || m.depends_on_json || []),
        JSON.stringify(m.nav_keys || []),
        JSON.stringify(m.rpc_prefixes || []),
        JSON.stringify(m.http_mounts || []),
        JSON.stringify(m.jobs || []),
        m.is_active === 0 ? 0 : 1
      ]
    );
  }

  const packages = Array.isArray(snapshot.packages) ? snapshot.packages : [];
  for (const p of packages) {
    if (!p?.id) continue;
    dbRun(
      `INSERT INTO platform_packages (id, name, description, price, currency, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
         price=excluded.price, currency=excluded.currency, is_active=excluded.is_active, updated_at=excluded.updated_at`,
      [p.id, p.name || p.id, p.description || '', p.price || 0, p.currency || 'ZAR', p.is_active === 0 ? 0 : 1, nowIso(), nowIso()]
    );
    if (Array.isArray(p.module_ids)) {
      dbRun('DELETE FROM platform_package_items WHERE package_id = ?', [p.id]);
      for (const mid of p.module_ids) {
        dbRun('INSERT OR IGNORE INTO platform_package_items (package_id, module_id) VALUES (?,?)', [p.id, mid]);
      }
    }
  }

  const addons = Array.isArray(snapshot.addons) ? snapshot.addons : [];
  for (const a of addons) {
    if (!a?.id) continue;
    dbRun(
      `INSERT INTO platform_addons (id, name, description, price, currency, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
         price=excluded.price, currency=excluded.currency, is_active=excluded.is_active, updated_at=excluded.updated_at`,
      [a.id, a.name || a.id, a.description || '', a.price || 0, a.currency || 'ZAR', a.is_active === 0 ? 0 : 1, nowIso(), nowIso()]
    );
    if (Array.isArray(a.module_ids)) {
      dbRun('DELETE FROM platform_addon_items WHERE addon_id = ?', [a.id]);
      for (const mid of a.module_ids) {
        dbRun('INSERT OR IGNORE INTO platform_addon_items (addon_id, module_id) VALUES (?,?)', [a.id, mid]);
      }
    }
  }

  const packageId = snapshot.package_id || null;
  const addonIds = Array.isArray(snapshot.addon_ids) ? snapshot.addon_ids : [];
  const overrides = Array.isArray(snapshot.overrides) ? snapshot.overrides : [];

  dbRun(
    `INSERT INTO platform_shop_assignments (shop_key, package_id, notes, updated_at, updated_by)
     VALUES (?,?,?,?,?)
     ON CONFLICT(shop_key) DO UPDATE SET package_id=excluded.package_id, notes=excluded.notes,
       updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    [shopKey, packageId, snapshot.notes || 'saas-sync', nowIso(), actor]
  );
  dbRun('DELETE FROM platform_shop_addons WHERE shop_key = ?', [shopKey]);
  for (const aid of addonIds) {
    dbRun('INSERT OR IGNORE INTO platform_shop_addons (shop_key, addon_id) VALUES (?,?)', [shopKey, aid]);
  }
  dbRun('DELETE FROM platform_shop_overrides WHERE shop_key = ?', [shopKey]);
  for (const o of overrides) {
    if (!o?.module_id) continue;
    dbRun(
      `INSERT INTO platform_shop_overrides (shop_key, module_id, enabled, reason, updated_at, updated_by)
       VALUES (?,?,?,?,?,?)`,
      [shopKey, o.module_id, Number(o.enabled) ? 1 : 0, o.reason || '', nowIso(), actor]
    );
  }

  const sub = String(snapshot.subscription_status || process.env.SHOP_SUBSCRIPTION_STATUS || 'TRIAL').toUpperCase();
  const isActive = sub === 'SUSPENDED' ? 0 : 1;
  dbRun(
    `INSERT INTO platform_shops (id, shop_name, owner_name, owner_email, subscription_status, is_active, package_id, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET shop_name=excluded.shop_name, subscription_status=excluded.subscription_status,
       is_active=excluded.is_active, package_id=excluded.package_id, updated_at=excluded.updated_at`,
    [
      shopKey,
      snapshot.shop_name || shopKey,
      snapshot.owner_name || '',
      snapshot.owner_email || '',
      sub,
      isActive,
      packageId,
      nowIso()
    ]
  );

  try {
    const entitlements = require('./entitlements');
    entitlements.invalidateCache?.();
  } catch (_) { /* */ }

  return {
    success: true,
    shop_key: shopKey,
    package_id: packageId,
    addon_ids: addonIds,
    subscription_status: sub,
    modules_synced: modules.length,
    packages_synced: packages.length,
    addons_synced: addons.length
  };
}

/** Boot-time: apply assignment from env when catalog already present or minimal. */
function applyFromEnvIfConfigured() {
  if (!truthyEnv(process.env.ENTITLEMENTS_ENFORCE)) return { skipped: true, reason: 'enforcement_off' };
  if (truthyEnv(process.env.PLATFORM_CONTROL_ENABLED)) return { skipped: true, reason: 'platform_host' };
  const shopKey = String(process.env.SHOP_ENTITLEMENT_KEY || '').trim();
  const packageId = String(process.env.SHOP_PACKAGE_ID || '').trim() || null;
  if (!shopKey || !packageId) return { skipped: true, reason: 'missing_env' };
  const addonIds = String(process.env.SHOP_ADDON_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sub = String(process.env.SHOP_SUBSCRIPTION_STATUS || 'TRIAL').toUpperCase();
  ensureEntitlementTables();
  // Only upsert assignment row — catalog should arrive via snapshot
  return applyEntitlementSnapshot({
    shop_key: shopKey,
    shop_name: process.env.SHOP_NAME || shopKey,
    package_id: packageId,
    addon_ids: addonIds,
    subscription_status: sub,
    modules: [],
    packages: packageId ? [{ id: packageId, name: packageId, module_ids: [] }] : [],
    addons: addonIds.map((id) => ({ id, name: id, module_ids: [] }))
  }, 'env-boot');
}

function applyEntitlementSnapshotAuthenticated(secret, snapshot) {
  assertSyncSecret(secret);
  return applyEntitlementSnapshot(snapshot, 'platform-push');
}

/**
 * Build snapshot from Platform (lab) DB for a shop id.
 */
function buildSnapshotForShop(shopId) {
  const id = String(shopId);
  const shop = dbGet('SELECT * FROM platform_shops WHERE id = ?', [id]);
  if (!shop) throw new Error('Shop not found on platform');
  if (/chisa/i.test(shop.shop_name + id)) throw new Error('Refusing snapshot for Chisa Food');

  const modules = dbAll('SELECT * FROM platform_modules').map((m) => ({
    ...m,
    depends_on: (() => { try { return JSON.parse(m.depends_on_json || '[]'); } catch (_) { return []; } })()
  }));
  const packages = dbAll('SELECT * FROM platform_packages').map((p) => ({
    ...p,
    module_ids: dbAll('SELECT module_id FROM platform_package_items WHERE package_id = ?', [p.id]).map((r) => r.module_id)
  }));
  const addons = dbAll('SELECT * FROM platform_addons').map((a) => ({
    ...a,
    module_ids: dbAll('SELECT module_id FROM platform_addon_items WHERE addon_id = ?', [a.id]).map((r) => r.module_id)
  }));
  const asg = dbGet('SELECT * FROM platform_shop_assignments WHERE shop_key = ?', [id]);
  const addonIds = dbAll('SELECT addon_id FROM platform_shop_addons WHERE shop_key = ?', [id]).map((r) => r.addon_id);
  const overrides = dbAll('SELECT module_id, enabled, reason FROM platform_shop_overrides WHERE shop_key = ?', [id]);

  return {
    shop_key: id,
    shop_name: shop.shop_name,
    owner_name: shop.owner_name,
    owner_email: shop.owner_email,
    package_id: asg?.package_id || shop.package_id,
    addon_ids: addonIds,
    overrides,
    subscription_status: shop.subscription_status || 'TRIAL',
    notes: asg?.notes || '',
    modules,
    packages,
    addons
  };
}

async function pushSnapshotToCustomerUrl(shopUrl, secret, snapshot) {
  const base = String(shopUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('shop_url required');
  const res = await fetch(base + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'saas:applyEntitlementSnapshot',
      args: [secret, snapshot]
    }),
    signal: AbortSignal.timeout(60000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `sync HTTP ${res.status}`);
  }
  return json.data || json;
}

module.exports = {
  applyEntitlementSnapshot,
  applyEntitlementSnapshotAuthenticated,
  applyFromEnvIfConfigured,
  buildSnapshotForShop,
  pushSnapshotToCustomerUrl,
  getSyncSecret,
  ensureEntitlementTables
};
