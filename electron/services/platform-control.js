/**
 * Platform Control — packages, modules, add-ons (Phase 3).
 * Definitions only. Does NOT enforce entitlements on shop UI/APIs.
 * Enabled only when PLATFORM_CONTROL_ENABLED=1|true.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}
function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}
function toJson(v) { return JSON.stringify(v == null ? [] : v); }
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function truthyEnv(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function isEnabled() {
  return truthyEnv(process.env.PLATFORM_CONTROL_ENABLED);
}

function requireEnabled() {
  if (!isEnabled()) throw new Error('Platform Control is disabled on this deployment');
}

function ensureSchema() {
  try {
    dbGet('SELECT 1 FROM platform_packages LIMIT 1');
  } catch (_) {
    const candidates = [
      path.join(__dirname, '../database/migrations-v123.sql'),
      path.join(__dirname, '../../supabase/migrations/20260920_platform_control_packages.sql')
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      try {
        getDb().exec(fs.readFileSync(p, 'utf8'));
        console.log('[platform] schema ensured from', path.basename(p));
        break;
      } catch (err) {
        console.warn('[platform] schema ensure:', err.message || err);
      }
    }
  }
  // Phase 4 assignment tables
  try {
    dbGet('SELECT 1 FROM platform_shop_assignments LIMIT 1');
  } catch (_) {
    const candidates = [
      path.join(__dirname, '../database/migrations-v124.sql'),
      path.join(__dirname, '../../supabase/migrations/20260921_platform_entitlements.sql')
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      try {
        getDb().exec(fs.readFileSync(p, 'utf8'));
        console.log('[platform] entitlement schema from', path.basename(p));
        break;
      } catch (err) {
        console.warn('[platform] entitlement schema:', err.message || err);
      }
    }
  }
  // Phase 5 shop records
  try {
    dbGet('SELECT 1 FROM platform_shops LIMIT 1');
  } catch (_) {
    const candidates = [
      path.join(__dirname, '../database/migrations-v125.sql'),
      path.join(__dirname, '../../supabase/migrations/20260921_platform_shops.sql')
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      try {
        getDb().exec(fs.readFileSync(p, 'utf8'));
        console.log('[platform] shops schema from', path.basename(p));
        break;
      } catch (err) {
        console.warn('[platform] shops schema:', err.message || err);
      }
    }
  }
  // Phase 6 provisioning jobs
  try {
    dbGet('SELECT 1 FROM platform_provision_jobs LIMIT 1');
  } catch (_) {
    const candidates = [
      path.join(__dirname, '../database/migrations-v126.sql'),
      path.join(__dirname, '../../supabase/migrations/20260921_platform_provisioning.sql')
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      try {
        getDb().exec(fs.readFileSync(p, 'utf8'));
        console.log('[platform] provision schema from', path.basename(p));
        break;
      } catch (err) {
        console.warn('[platform] provision schema:', err.message || err);
      }
    }
  }
  // Phase 7+ control plane
  try {
    require('./platform-control-plane').ensureSchema();
  } catch (err) {
    console.warn('[platform] control-plane schema:', err.message || err);
  }
  try {
    dbGet('SELECT 1 FROM platform_packages LIMIT 1');
  } catch (_) {
    throw new Error('Platform Control schema missing');
  }
}

function catalogPath() {
  const candidates = [
    path.join(__dirname, '../platform-catalog/MODULE-CATALOG.json'),
    path.join(__dirname, '../../docs/saas-safety/MODULE-CATALOG.json'),
    path.join(__dirname, '../../MODULE-CATALOG.json')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function loadCatalogFile() {
  const p = catalogPath();
  if (!fs.existsSync(p)) throw new Error('MODULE-CATALOG.json not found');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Extra hard dependency edges beyond catalog dependencies_json */
const EXTRA_DEPS = {
  'mod.signage': ['mod.signage_player'],
  'mod.signage_player': ['mod.signage'],
  'app.driver': ['app.delivery'],
  'mod.drive_thru': ['app.pos', 'core.catalog'],
  'mod.kiosk': ['core.catalog'],
  'mod.loyalty': ['app.pos'],
  'app.recipe': ['core.catalog'],
  'app.staff': ['core.auth'],
  'app.hr': ['app.staff'],
  'app.mgr_hr': ['app.staff', 'app.hr'],
  'app.referral_agent': ['mod.referral'],
  'app.referral_commission': ['mod.referral'],
  'mod.radio': ['mod.radio_studio'],
  'mod.customer_display': ['mod.kds'],
  'mod.kds': ['app.pos'],
  'mod.restaurant': ['app.pos'],
  'feat.loyalty.first_gift': ['mod.loyalty', 'mod.online'],
  'feat.hr.payroll_sars': ['app.hr'],
  'feat.meeting.ai_transcript': ['mod.meeting'],
  'feat.accounting.ocr': ['app.accounting'],
  'mod.employee_of_month': ['app.hr'],
  'feat.owner_salary': ['app.staff'],
  'mod.donations': ['app.hr'],
  'mod.careers': ['app.hr'],
  'mod.branding': ['mod.online'],
  'mod.web_analytics': ['mod.online'],
  'app.expenses': ['core.auth'],
  'app.accounting': ['core.catalog']
};

/** Always-satisfied module ids (shared core) — never need to be picked for deps */
function sharedCoreIds(modulesById) {
  const ids = new Set();
  for (const [id, m] of Object.entries(modulesById)) {
    if (m.kind === 'shared_core' || m.commercial_class === 'shared_core') ids.add(id);
  }
  // Always imply these even before sync
  ['core.auth', 'core.catalog', 'core.payments', 'core.settings', 'core.users_permissions', 'core.branches', 'core.rpc_server'].forEach((id) => ids.add(id));
  return ids;
}

/** Normalize legacy/alias ids from catalog text */
function canonicalModuleId(id) {
  const aliases = {
    'mod.hr': 'app.hr',
    'mod.staff': 'app.staff'
  };
  return aliases[id] || id;
}

function commercialClassFor(mod) {
  if (!mod) return 'sellable';
  if (mod.kind === 'shared_core') return 'shared_core';
  if (mod.id === 'feat.marketing_legacy' || /marketing_\*/.test(String(mod.notes || ''))) return 'legacy_compat';
  if (mod.kind === 'admin_submodule') return 'admin_submodule';
  if (mod.kind === 'feature') return 'feature';
  // Majors with dependencies are still sellable; dependency graph is enforced separately
  return 'sellable';
}

function audit(actor, action, entityType, entityId, detail) {
  try {
    dbRun(
      `INSERT INTO platform_audit_logs (actor, action, entity_type, entity_id, detail_json, created_at)
       VALUES (?,?,?,?,?,?)`,
      [actor || 'platform', action, entityType || null, entityId || null, detail ? JSON.stringify(detail) : null, nowIso()]
    );
  } catch (_) { /* */ }
}

function ensureOwnerSeed() {
  ensureSchema();
  const username = String(process.env.PLATFORM_OWNER_USERNAME || 'platform').trim() || 'platform';
  const password = String(process.env.PLATFORM_OWNER_PASSWORD || 'platform-lab-change-me');
  const existing = dbGet('SELECT id, username FROM platform_owners WHERE lower(username) = lower(?)', [username]);
  const hash = bcrypt.hashSync(password, 10);
  if (!existing) {
    try {
      dbRun(
        `INSERT INTO platform_owners (username, password_hash, full_name, is_active, created_at)
         VALUES (?,?,?,?,?)`,
        [username, hash, 'Platform Owner', 1, nowIso()]
      );
    } catch (_) {
      dbRun(
        `INSERT INTO platform_owners (username, password_hash, full_name, is_active)
         VALUES (?,?,?,1)`,
        [username, hash, 'Platform Owner']
      );
    }
    console.log('[platform] Seeded platform owner:', username);
  } else if (truthyEnv(process.env.PLATFORM_OWNER_RESET_PASSWORD)) {
    dbRun('UPDATE platform_owners SET password_hash = ? WHERE id = ?', [hash, existing.id]);
  }
}

function syncCatalogFromFile() {
  requireEnabled();
  ensureSchema();
  ensureOwnerSeed();
  const catalog = loadCatalogFile();
  const list = Array.isArray(catalog.modules) ? catalog.modules : [];
  let upserted = 0;
  for (const m of list) {
    if (!m?.id) continue;
    // Never register apprentice or legacy marketing as sellable catalog SKUs
    if (/apprentice/i.test(m.id) || /apprentice/i.test(m.name || '')) continue;
    const cls = commercialClassFor(m);
    const sellable = cls === 'shared_core' || cls === 'legacy_compat' ? 0 : (m.sellable_addon ? 1 : (cls === 'admin_submodule' || cls === 'sellable' || cls === 'dependent' || cls === 'feature' ? 1 : 0));
    const deps = Array.isArray(m.dependencies) ? m.dependencies : [];
    const row = {
      id: m.id,
      kind: m.kind || 'major',
      name: m.name || m.id,
      description: m.description || '',
      commercial_class: cls,
      sellable_addon: sellable,
      default_status: m.default_status || 'enabled_in_full_product',
      admin_menu: m.admin_menu || null,
      appears_in_json: toJson(m.appears_in || []),
      dependencies_json: toJson(deps),
      related_apis_json: toJson(m.related_apis || []),
      related_jobs_json: toJson(m.related_jobs || []),
      database_tables_json: toJson(m.database_tables || []),
      notes: m.notes || '',
      catalog_source: 'MODULE-CATALOG',
      is_active: 1,
      updated_at: nowIso()
    };
    const exists = dbGet('SELECT id FROM platform_modules WHERE id = ?', [row.id]);
    if (exists) {
      dbRun(
        `UPDATE platform_modules SET kind=?, name=?, description=?, commercial_class=?, sellable_addon=?,
         default_status=?, admin_menu=?, appears_in_json=?, dependencies_json=?, related_apis_json=?,
         related_jobs_json=?, database_tables_json=?, notes=?, catalog_source=?, is_active=?, updated_at=?
         WHERE id=?`,
        [row.kind, row.name, row.description, row.commercial_class, row.sellable_addon, row.default_status,
          row.admin_menu, row.appears_in_json, row.dependencies_json, row.related_apis_json, row.related_jobs_json,
          row.database_tables_json, row.notes, row.catalog_source, row.is_active, row.updated_at, row.id]
      );
    } else {
      dbRun(
        `INSERT INTO platform_modules (
          id, kind, name, description, commercial_class, sellable_addon, default_status, admin_menu,
          appears_in_json, dependencies_json, related_apis_json, related_jobs_json, database_tables_json,
          notes, catalog_source, is_active, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.id, row.kind, row.name, row.description, row.commercial_class, row.sellable_addon, row.default_status,
          row.admin_menu, row.appears_in_json, row.dependencies_json, row.related_apis_json, row.related_jobs_json,
          row.database_tables_json, row.notes, row.catalog_source, row.is_active, row.updated_at]
      );
    }
    upserted += 1;
  }
  audit('system', 'sync_catalog', 'platform_modules', null, { upserted, catalog_generated_at: catalog.generated_at });
  return { success: true, upserted, total_in_file: list.length };
}

function mapModuleRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    description: r.description,
    commercial_class: r.commercial_class,
    sellable_addon: !!r.sellable_addon,
    default_status: r.default_status,
    admin_menu: r.admin_menu,
    appears_in: parseJson(r.appears_in_json, []),
    dependencies: parseJson(r.dependencies_json, []),
    related_apis: parseJson(r.related_apis_json, []),
    related_jobs: parseJson(r.related_jobs_json, []),
    database_tables: parseJson(r.database_tables_json, []),
    notes: r.notes,
    is_active: !!r.is_active,
    updated_at: r.updated_at
  };
}

function listModules(filter = {}) {
  requireEnabled();
  ensureSchema();
  let rows = dbAll('SELECT * FROM platform_modules ORDER BY kind, name');
  if (!rows.length) {
    syncCatalogFromFile();
    rows = dbAll('SELECT * FROM platform_modules ORDER BY kind, name');
  }
  let list = rows.map(mapModuleRow);
  if (filter.kind) list = list.filter((m) => m.kind === filter.kind);
  if (filter.commercial_class) list = list.filter((m) => m.commercial_class === filter.commercial_class);
  if (filter.sellable_only) {
    list = list.filter((m) => m.commercial_class !== 'shared_core' && m.commercial_class !== 'legacy_compat');
  }
  if (filter.q) {
    const q = String(filter.q).toLowerCase();
    list = list.filter((m) => `${m.id} ${m.name} ${m.description}`.toLowerCase().includes(q));
  }
  return { success: true, data: list, counts: {
    total: list.length,
    shared_core: list.filter((m) => m.commercial_class === 'shared_core').length,
    sellable: list.filter((m) => m.commercial_class === 'sellable').length,
    dependent: list.filter((m) => m.commercial_class === 'dependent').length,
    admin_submodule: list.filter((m) => m.commercial_class === 'admin_submodule').length,
    feature: list.filter((m) => m.commercial_class === 'feature').length
  } };
}

function modulesByIdMap() {
  const { data } = listModules({});
  const map = {};
  for (const m of data) map[m.id] = m;
  return map;
}

function requiredDepsFor(moduleId, modulesById) {
  const out = new Set();
  const visit = (rawId) => {
    const id = canonicalModuleId(rawId);
    const m = modulesById[id];
    const fromCatalog = (m && Array.isArray(m.dependencies)) ? m.dependencies : [];
    const extra = EXTRA_DEPS[id] || EXTRA_DEPS[rawId] || [];
    for (const d0 of [...fromCatalog, ...extra]) {
      const d = canonicalModuleId(d0);
      if (!d || out.has(d)) continue;
      // Skip unknown non-catalog deps (treat as soft) except EXTRA_DEPS targets
      if (!modulesById[d] && !sharedCoreIds(modulesById).has(d)) continue;
      out.add(d);
      visit(d);
    }
  };
  visit(moduleId);
  return [...out];
}

/**
 * Validate a set of module ids for a package/add-on.
 * Shared core is always considered present.
 */
function validateModuleSelection(moduleIds) {
  const selected = [...new Set((moduleIds || []).map((x) => canonicalModuleId(String(x))).filter(Boolean))];
  const modulesById = modulesByIdMap();
  const shared = sharedCoreIds(modulesById);
  const errors = [];
  const warnings = [];

  for (const id of selected) {
    if (!modulesById[id] && !shared.has(id)) {
      errors.push(`Unknown module id: ${id}`);
    }
    if (modulesById[id]?.commercial_class === 'legacy_compat') {
      errors.push(`${id} is legacy compatibility and cannot be sold as a package item`);
    }
    if (modulesById[id]?.commercial_class === 'shared_core') {
      warnings.push(`${id} is shared/core — it is always available; no need to include it in a package`);
    }
  }

  const effective = new Set([...selected, ...shared]);
  for (const id of selected) {
    if (modulesById[id]?.commercial_class === 'shared_core') continue;
    const reqs = requiredDepsFor(id, modulesById);
    for (const dep of reqs) {
      if (shared.has(dep)) continue;
      if (!effective.has(dep)) {
        errors.push(`${id} requires ${dep}`);
      }
    }
  }

  // Accounting note for Phase 4 (warning only)
  if (selected.includes('app.accounting')) {
    warnings.push('Accounting included: Phase 4 entitlements should gate UI and journal-producing APIs/jobs.');
  }

  return { ok: errors.length === 0, errors, warnings, selected };
}

function login(username, password) {
  requireEnabled();
  ensureSchema();
  ensureOwnerSeed();
  const u = String(username || '').trim();
  const p = String(password || '');
  const row = dbGet('SELECT * FROM platform_owners WHERE lower(username) = lower(?) AND is_active = 1', [u]);
  if (!row || !bcrypt.compareSync(p, row.password_hash)) throw new Error('Invalid username or password');
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  dbRun(
    `INSERT INTO platform_sessions (token_hash, owner_id, expires_at, created_at) VALUES (?,?,?,?)`,
    [hashToken(token), row.id, expires, nowIso()]
  );
  audit(row.username, 'login', 'platform_session', String(row.id), null);
  return {
    success: true,
    token,
    expires_at: expires,
    user: { id: row.id, username: row.username, full_name: row.full_name, role: 'platform_owner' }
  };
}

function logout(token) {
  requireEnabled();
  ensureSchema();
  if (token) dbRun('DELETE FROM platform_sessions WHERE token_hash = ?', [hashToken(token)]);
  return { success: true };
}

function requireSession(token) {
  requireEnabled();
  ensureSchema();
  const th = hashToken(String(token || ''));
  const sess = dbGet('SELECT * FROM platform_sessions WHERE token_hash = ?', [th]);
  if (!sess) throw new Error('Not authenticated');
  if (new Date(sess.expires_at).getTime() < Date.now()) {
    dbRun('DELETE FROM platform_sessions WHERE token_hash = ?', [th]);
    throw new Error('Session expired');
  }
  const owner = dbGet('SELECT id, username, full_name FROM platform_owners WHERE id = ? AND is_active = 1', [sess.owner_id]);
  if (!owner) throw new Error('Not authenticated');
  return owner;
}

function getPackageItems(packageId) {
  return dbAll('SELECT module_id FROM platform_package_items WHERE package_id = ?', [packageId]).map((r) => r.module_id);
}

function getAddonItems(addonId) {
  return dbAll('SELECT module_id FROM platform_addon_items WHERE addon_id = ?', [addonId]).map((r) => r.module_id);
}

function mapPackage(row) {
  if (!row) return null;
  const module_ids = getPackageItems(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price || 0),
    currency: row.currency || 'ZAR',
    is_active: !!row.is_active,
    module_ids,
    modules: module_ids.map((id) => mapModuleRow(dbGet('SELECT * FROM platform_modules WHERE id = ?', [id]))).filter(Boolean),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function listPackages() {
  requireEnabled();
  ensureSchema();
  const rows = dbAll('SELECT * FROM platform_packages ORDER BY name');
  return { success: true, data: rows.map(mapPackage) };
}

function getPackage(id) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM platform_packages WHERE id = ?', [id]);
  if (!row) throw new Error('Package not found');
  return { success: true, data: mapPackage(row) };
}

function savePackage(data, actor) {
  requireEnabled();
  ensureSchema();
  const name = String(data?.name || '').trim();
  if (!name) throw new Error('Package name is required');
  const moduleIds = Array.isArray(data.module_ids) ? data.module_ids : [];
  const validation = validateModuleSelection(moduleIds);
  if (!validation.ok) {
    const err = new Error('Dependency validation failed: ' + validation.errors.join('; '));
    err.validation = validation;
    throw err;
  }
  const id = data.id ? String(data.id) : uid('pkg');
  const description = String(data.description || '');
  const price = Number(data.price != null ? data.price : 0) || 0;
  const currency = String(data.currency || 'ZAR').slice(0, 8);
  const isActive = data.is_active === false || data.is_active === 0 ? 0 : 1;
  const existing = dbGet('SELECT id FROM platform_packages WHERE id = ?', [id]);
  if (existing) {
    dbRun(
      `UPDATE platform_packages SET name=?, description=?, price=?, currency=?, is_active=?, updated_at=? WHERE id=?`,
      [name, description, price, currency, isActive, nowIso(), id]
    );
  } else {
    dbRun(
      `INSERT INTO platform_packages (id, name, description, price, currency, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, name, description, price, currency, isActive, nowIso(), nowIso()]
    );
  }
  dbRun('DELETE FROM platform_package_items WHERE package_id = ?', [id]);
  for (const mid of validation.selected) {
    if (modulesByIdMap()[mid]?.commercial_class === 'shared_core') continue;
    dbRun('INSERT INTO platform_package_items (package_id, module_id) VALUES (?,?)', [id, mid]);
  }
  audit(actor?.username || 'platform', existing ? 'update_package' : 'create_package', 'platform_package', id, {
    name, module_ids: validation.selected, warnings: validation.warnings
  });
  return { success: true, data: mapPackage(dbGet('SELECT * FROM platform_packages WHERE id = ?', [id])), validation };
}

function setPackageActive(id, active, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT id FROM platform_packages WHERE id = ?', [id]);
  if (!row) throw new Error('Package not found');
  dbRun('UPDATE platform_packages SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, nowIso(), id]);
  audit(actor?.username || 'platform', active ? 'activate_package' : 'deactivate_package', 'platform_package', id, null);
  return getPackage(id);
}

function deletePackage(id, actor) {
  requireEnabled();
  ensureSchema();
  const row = dbGet('SELECT id, name FROM platform_packages WHERE id = ?', [id]);
  if (!row) throw new Error('Package not found');
  dbRun('DELETE FROM platform_package_items WHERE package_id = ?', [id]);
  dbRun('DELETE FROM platform_packages WHERE id = ?', [id]);
  audit(actor?.username || 'platform', 'delete_package', 'platform_package', id, { name: row.name });
  return { success: true };
}

function mapAddon(row) {
  if (!row) return null;
  const module_ids = getAddonItems(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price || 0),
    currency: row.currency || 'ZAR',
    is_active: !!row.is_active,
    module_ids,
    modules: module_ids.map((id) => mapModuleRow(dbGet('SELECT * FROM platform_modules WHERE id = ?', [id]))).filter(Boolean),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function listAddons() {
  requireEnabled();
  ensureSchema();
  return { success: true, data: dbAll('SELECT * FROM platform_addons ORDER BY name').map(mapAddon) };
}

function saveAddon(data, actor) {
  requireEnabled();
  ensureSchema();
  const name = String(data?.name || '').trim();
  if (!name) throw new Error('Add-on name is required');
  const moduleIds = Array.isArray(data.module_ids) ? data.module_ids : [];
  if (!moduleIds.length) throw new Error('Add-on must include at least one module');
  const validation = validateModuleSelection(moduleIds);
  if (!validation.ok) {
    const err = new Error('Dependency validation failed: ' + validation.errors.join('; '));
    err.validation = validation;
    throw err;
  }
  const id = data.id ? String(data.id) : uid('addon');
  const description = String(data.description || '');
  const price = Number(data.price != null ? data.price : 0) || 0;
  const currency = String(data.currency || 'ZAR').slice(0, 8);
  const isActive = data.is_active === false || data.is_active === 0 ? 0 : 1;
  const existing = dbGet('SELECT id FROM platform_addons WHERE id = ?', [id]);
  if (existing) {
    dbRun(
      `UPDATE platform_addons SET name=?, description=?, price=?, currency=?, is_active=?, updated_at=? WHERE id=?`,
      [name, description, price, currency, isActive, nowIso(), id]
    );
  } else {
    dbRun(
      `INSERT INTO platform_addons (id, name, description, price, currency, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, name, description, price, currency, isActive, nowIso(), nowIso()]
    );
  }
  dbRun('DELETE FROM platform_addon_items WHERE addon_id = ?', [id]);
  for (const mid of validation.selected) {
    if (modulesByIdMap()[mid]?.commercial_class === 'shared_core') continue;
    dbRun('INSERT INTO platform_addon_items (addon_id, module_id) VALUES (?,?)', [id, mid]);
  }
  audit(actor?.username || 'platform', existing ? 'update_addon' : 'create_addon', 'platform_addon', id, {
    name, module_ids: validation.selected
  });
  return { success: true, data: mapAddon(dbGet('SELECT * FROM platform_addons WHERE id = ?', [id])), validation };
}

function deleteAddon(id, actor) {
  requireEnabled();
  ensureSchema();
  dbRun('DELETE FROM platform_addon_items WHERE addon_id = ?', [id]);
  dbRun('DELETE FROM platform_addons WHERE id = ?', [id]);
  audit(actor?.username || 'platform', 'delete_addon', 'platform_addon', id, null);
  return { success: true };
}

function status() {
  return {
    success: true,
    enabled: isEnabled(),
    phase: 3,
    enforcement: false,
    note: 'Package definitions only — entitlements not enforced yet'
  };
}

function bootstrapLabSamples(actor) {
  requireEnabled();
  ensureSchema();
  syncCatalogFromFile();
  // Example packages for lab testing — names are samples, not hard product limits
  const samples = [
    {
      name: 'Lab FREE',
      description: 'Free package via normal package system — limited modules, configurable entitlements',
      price: 0,
      module_ids: ['app.pos', 'app.admin', 'admin.pos-menu', 'admin.payments']
    },
    {
      name: 'Lab Starter Online',
      description: 'Sample: Online + light Admin online sections + branding',
      price: 499,
      module_ids: ['mod.online', 'mod.branding', 'admin.online-orders', 'admin.customize', 'admin.customer-reports']
    },
    {
      name: 'Lab Shop Floor',
      description: 'Sample: POS + Admin shell sections for till ops + Staff',
      price: 1499,
      module_ids: [
        'app.pos', 'app.admin', 'app.staff',
        'admin.salesmgmt', 'admin.pos-menu', 'admin.printer', 'admin.payments', 'admin.shifts', 'admin.staffportal'
      ]
    },
    {
      name: 'Lab Full',
      description: 'Sample fuller plan: Shop Floor + Online + Signage modules',
      price: 2999,
      module_ids: [
        'app.pos', 'app.admin', 'app.staff',
        'admin.salesmgmt', 'admin.pos-menu', 'admin.printer', 'admin.payments', 'admin.shifts', 'admin.staffportal',
        'mod.online', 'mod.branding', 'admin.online-orders', 'admin.customize',
        'mod.signage', 'mod.signage_player', 'admin.digital-signage'
      ]
    }
  ];
  const created = [];
  for (const s of samples) {
    const existing = dbGet('SELECT id FROM platform_packages WHERE name = ?', [s.name]);
    if (existing) continue;
    try {
      const r = savePackage(s, actor || { username: 'system' });
      created.push(r.data);
    } catch (e) {
      // If deps fail, expand selection with required deps once
      const mods = modulesByIdMap();
      const expanded = new Set(s.module_ids);
      for (const id of [...expanded]) {
        for (const d of requiredDepsFor(id, mods)) expanded.add(d);
      }
      const r = savePackage({ ...s, module_ids: [...expanded] }, actor || { username: 'system' });
      created.push(r.data);
    }
  }
  // Sample add-ons
  if (!dbGet('SELECT id FROM platform_addons WHERE name = ?', ['Lab Add-on Digital Signage'])) {
    try {
      saveAddon({
        name: 'Lab Add-on Digital Signage',
        description: 'Sample add-on: Signage Centre + Player + admin section',
        price: 399,
        module_ids: ['mod.signage', 'mod.signage_player', 'admin.digital-signage']
      }, actor || { username: 'system' });
    } catch (e) {
      console.warn('[platform] sample addon:', e.message);
    }
  }
  if (!dbGet('SELECT id FROM platform_addons WHERE name = ?', ['Lab Add-on Online Ordering'])) {
    try {
      const onlineIds = ['mod.online', 'mod.branding', 'admin.online-orders', 'admin.customize'];
      const mods = modulesByIdMap();
      const expanded = new Set(onlineIds);
      for (const id of [...expanded]) {
        for (const d of requiredDepsFor(id, mods)) expanded.add(d);
      }
      saveAddon({
        name: 'Lab Add-on Online Ordering',
        description: 'Sample add-on: Online Ordering + branding + admin online sections',
        price: 499,
        module_ids: [...expanded]
      }, actor || { username: 'system' });
    } catch (e) {
      console.warn('[platform] sample online addon:', e.message);
    }
  }
  if (!dbGet('SELECT id FROM platform_addons WHERE name = ?', ['Lab Add-on Expenses'])) {
    try {
      const expIds = ['app.expenses', 'app.accounting', 'admin.accounting-workspace'];
      const mods = modulesByIdMap();
      const expanded = new Set(expIds);
      for (const id of [...expanded]) {
        for (const d of requiredDepsFor(id, mods)) expanded.add(d);
      }
      saveAddon({
        name: 'Lab Add-on Expenses',
        description: 'Sample add-on: Expense capture module',
        price: 199,
        module_ids: [...expanded]
      }, actor || { username: 'system' });
    } catch (e) {
      console.warn('[platform] sample expenses addon:', e.message);
    }
  }
  return { success: true, created_packages: created.length, packages: listPackages().data, addons: listAddons().data };
}

module.exports = {
  isEnabled,
  status,
  syncCatalogFromFile,
  listModules,
  validateModuleSelection,
  login,
  logout,
  requireSession,
  listPackages,
  getPackage,
  savePackage,
  setPackageActive,
  deletePackage,
  listAddons,
  saveAddon,
  deleteAddon,
  bootstrapLabSamples,
  EXTRA_DEPS
};
