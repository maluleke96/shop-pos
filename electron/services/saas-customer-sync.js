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
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'sellable',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      commercial_class TEXT NOT NULL DEFAULT 'sellable',
      sellable_addon INTEGER NOT NULL DEFAULT 0,
      default_status TEXT DEFAULT 'enabled_in_full_product',
      admin_menu TEXT,
      appears_in_json TEXT DEFAULT '[]',
      dependencies_json TEXT DEFAULT '[]',
      related_apis_json TEXT DEFAULT '[]',
      related_jobs_json TEXT DEFAULT '[]',
      database_tables_json TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      catalog_source TEXT DEFAULT 'MODULE-CATALOG',
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_packages (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      price NUMERIC DEFAULT 0, currency TEXT DEFAULT 'ZAR',
      is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_package_items (
      package_id TEXT NOT NULL, module_id TEXT NOT NULL, PRIMARY KEY (package_id, module_id)
    );
    CREATE TABLE IF NOT EXISTS platform_addons (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      price NUMERIC DEFAULT 0, currency TEXT DEFAULT 'ZAR',
      is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_addon_items (
      addon_id TEXT NOT NULL, module_id TEXT NOT NULL, PRIMARY KEY (addon_id, module_id)
    );
    CREATE TABLE IF NOT EXISTS platform_shop_assignments (
      shop_key TEXT PRIMARY KEY, package_id TEXT, notes TEXT DEFAULT '',
      updated_at TEXT, updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_shop_addons (
      shop_key TEXT NOT NULL, addon_id TEXT NOT NULL, PRIMARY KEY (shop_key, addon_id)
    );
    CREATE TABLE IF NOT EXISTS platform_shop_overrides (
      shop_key TEXT NOT NULL, module_id TEXT NOT NULL, enabled INTEGER NOT NULL,
      reason TEXT DEFAULT '', updated_at TEXT, updated_by TEXT,
      PRIMARY KEY (shop_key, module_id)
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
    const deps = m.dependencies_json != null
      ? (typeof m.dependencies_json === 'string' ? m.dependencies_json : JSON.stringify(m.dependencies_json))
      : JSON.stringify(m.depends_on || []);
    dbRun(
      `INSERT INTO platform_modules (
         id, kind, name, description, commercial_class, sellable_addon, default_status,
         admin_menu, appears_in_json, dependencies_json, related_apis_json, related_jobs_json,
         database_tables_json, notes, catalog_source, is_active, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         kind=excluded.kind, name=excluded.name, description=excluded.description,
         commercial_class=excluded.commercial_class, dependencies_json=excluded.dependencies_json,
         is_active=excluded.is_active, updated_at=excluded.updated_at`,
      [
        m.id,
        m.kind || 'sellable',
        m.name || m.id,
        m.description || '',
        m.commercial_class || 'sellable',
        m.sellable_addon ? 1 : 0,
        m.default_status || 'enabled_in_full_product',
        m.admin_menu || null,
        typeof m.appears_in_json === 'string' ? m.appears_in_json : JSON.stringify(m.appears_in || []),
        deps,
        typeof m.related_apis_json === 'string' ? m.related_apis_json : JSON.stringify(m.related_apis || []),
        typeof m.related_jobs_json === 'string' ? m.related_jobs_json : JSON.stringify(m.jobs || m.related_jobs || []),
        typeof m.database_tables_json === 'string' ? m.database_tables_json : JSON.stringify(m.database_tables || []),
        m.notes || '',
        m.catalog_source || 'MODULE-CATALOG',
        m.is_active === 0 ? 0 : 1,
        nowIso()
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
  const isActive = (sub === 'SUSPENDED' || sub === 'EXPIRED') ? 0 : 1;
  const ts = nowIso();
  try {
    dbRun(
      `INSERT INTO platform_shops (
         id, shop_name, owner_name, owner_email, subscription_status, is_active, package_id,
         created_at, updated_at, deployment_status, notes
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET shop_name=excluded.shop_name,
         subscription_status=excluded.subscription_status, is_active=excluded.is_active,
         package_id=excluded.package_id, updated_at=excluded.updated_at`,
      [
        shopKey,
        snapshot.shop_name || shopKey,
        snapshot.owner_name || '',
        snapshot.owner_email || '',
        sub,
        isActive,
        packageId,
        ts,
        ts,
        'online',
        'saas-sync'
      ]
    );
  } catch (e) {
    // Assignment/catalog already applied; shops row is for local suspension checks
    console.warn('[saas-sync] platform_shops upsert:', e.message || e);
  }

  // Service fees (for /order checkout display — same calc as Platform)
  const serviceFees = Array.isArray(snapshot.service_fees) ? snapshot.service_fees : [];
  if (serviceFees.length) {
    try {
      dbRun(`CREATE TABLE IF NOT EXISTS platform_service_fees (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0,
        fee_type TEXT NOT NULL DEFAULT 'percent',
        percent REAL NOT NULL DEFAULT 0,
        fixed_amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'ZAR',
        label TEXT NOT NULL DEFAULT 'Platform service fee',
        updated_at TEXT,
        updated_by TEXT
      )`);
      dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_psf_scope ON platform_service_fees(scope, scope_id)`);
    } catch (_) { /* */ }
    for (const f of serviceFees) {
      if (!f?.scope) continue;
      const scopeId = f.scope_id == null ? '' : String(f.scope_id);
      const feeId = f.id || `fee_${f.scope}_${scopeId || 'default'}`;
      try {
        dbRun('DELETE FROM platform_service_fees WHERE scope = ? AND scope_id = ?', [f.scope, scopeId]);
        dbRun(
          `INSERT INTO platform_service_fees (
             id, scope, scope_id, enabled, fee_type, percent, fixed_amount, currency, label, updated_at, updated_by
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            feeId,
            f.scope,
            scopeId,
            Number(f.enabled) ? 1 : 0,
            f.fee_type || 'percent',
            Number(f.percent) || 0,
            Number(f.fixed_amount) || 0,
            f.currency || 'ZAR',
            f.label || 'Platform service fee',
            f.updated_at || nowIso(),
            actor
          ]
        );
      } catch (e) {
        console.warn('[saas-sync] service fee upsert:', e.message || e);
      }
    }
  }

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
    addons_synced: addons.length,
    service_fees_synced: serviceFees.length
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
  // Only upsert assignment row — do NOT pass empty module_ids arrays (that would wipe package_items on redeploy/boot)
  return applyEntitlementSnapshot({
    shop_key: shopKey,
    shop_name: process.env.SHOP_NAME || shopKey,
    package_id: packageId,
    addon_ids: addonIds,
    subscription_status: sub,
    modules: [],
    packages: packageId ? [{ id: packageId, name: packageId }] : [],
    addons: addonIds.map((id) => ({ id, name: id }))
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

  const modules = dbAll('SELECT * FROM platform_modules').map((m) => ({ ...m }));
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

  // Push effective fee configs so customer checkout can display the same fee as Platform.
  let serviceFees = [];
  try {
    const packageId = asg?.package_id || shop.package_id || '';
    serviceFees = dbAll(
      `SELECT * FROM platform_service_fees
       WHERE (scope = 'customer' AND scope_id = ?)
          OR (scope = 'package' AND scope_id = ?)
          OR (scope = 'platform_default' AND (scope_id = '' OR scope_id IS NULL))`,
      [id, packageId]
    );
  } catch (_) { /* control-plane fees optional */ }

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
    addons,
    service_fees: serviceFees
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
