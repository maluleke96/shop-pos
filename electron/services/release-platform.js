/**
 * App Release Centre — preview testing, automated health checks, approval, publish log.
 */
const { assertUserActor } = require('./authz');
const {
  dbGet, dbAll, dbRun, nowIso, parseJson, moduleAudit,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword, ensureMigration
} = require('./biz-modules-common');

const AUDIT = 'release_audit_logs';
const ROLE_PERMS = {
  owner: { run_tests: true, approve: true, publish: true, manage_users: true },
  developer: { run_tests: true, approve: false, publish: false, manage_users: false },
  tester: { run_tests: true, approve: false, publish: false, manage_users: false },
  release_manager: { run_tests: true, approve: true, publish: true, manage_users: true }
};

function auditRelease(row) { moduleAudit(AUDIT, { module: 'release', ...row }); }
function perms(role) { return ROLE_PERMS[role] || ROLE_PERMS.tester; }

function releaseLogin(username, password) {
  ensureMigration();
  const user = dbGet('SELECT * FROM release_centre_users WHERE lower(username) = lower(?) AND is_active = 1', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('Invalid username or password');
  const sess = createModuleSession('release_sessions', user.id);
  dbRun('UPDATE release_centre_users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  auditRelease({ user_id: user.id, user_name: user.username, action: 'login' });
  return {
    token: sess.token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions: perms(user.role) }
  };
}

function releaseLogout(token) {
  try {
    const crypto = require('crypto');
    dbRun('DELETE FROM release_sessions WHERE token_hash = ?', [crypto.createHash('sha256').update(String(token)).digest('hex')]);
  } catch (_) { /* */ }
  return { success: true };
}

function resolveReleaseSession(token) {
  return resolveModuleSession('release_sessions', 'release_centre_users', token);
}

function requireReleasePerm(token, perm) {
  const row = resolveReleaseSession(token);
  if (!perms(row.role)[perm]) throw new Error('Permission denied');
  return row;
}

const TEST_SUITE = [
  { key: 'health', label: 'Server health', run: async () => {
    const { getDb } = require('../database/db');
    getDb().prepare('SELECT 1 AS ok').get();
    return { status: 'PASS', message: 'Server responding' };
  }},
  { key: 'database', label: 'Database connection', run: async () => {
    const { getDb } = require('../database/db');
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM shop_settings').get();
    if (!row) throw new Error('shop_settings unreachable');
    return { status: 'PASS', message: 'Postgres/SQLite connected' };
  }},
  { key: 'auth', label: 'Authentication', run: async () => {
    const { getDb } = require('../database/db');
    const u = getDb().prepare('SELECT id FROM users WHERE is_active = 1 LIMIT 1').get();
    if (!u) return { status: 'WARNING', message: 'No active users found' };
    return { status: 'PASS', message: 'User table accessible' };
  }},
  { key: 'settings', label: 'Shop settings', run: async () => {
    const store = require('./store');
    const s = store.getSettingsParsed?.() || store.getSettings?.();
    if (!s?.shop_name) return { status: 'WARNING', message: 'Shop name not configured' };
    return { status: 'PASS', message: `Shop: ${s.shop_name}` };
  }},
  { key: 'products', label: 'Products', run: async () => {
    const { getDb } = require('../database/db');
    const c = getDb().prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get()?.c || 0;
    return { status: c > 0 ? 'PASS' : 'WARNING', message: `${c} active products` };
  }},
  { key: 'stock', label: 'Stock', run: async () => {
    const { getDb } = require('../database/db');
    getDb().prepare('SELECT id, stock_quantity FROM products LIMIT 1').get();
    return { status: 'PASS', message: 'Stock columns readable' };
  }},
  { key: 'pos_sales', label: 'POS / Sales', run: async () => {
    const { getDb } = require('../database/db');
    const c = getDb().prepare("SELECT COUNT(*) AS c FROM sales WHERE status = 'completed'").get()?.c || 0;
    return { status: 'PASS', message: `${c} completed sales` };
  }},
  { key: 'online_orders', label: 'Online orders', run: async () => {
    const { getDb } = require('../database/db');
    try {
      const c = getDb().prepare('SELECT COUNT(*) AS c FROM online_orders_local').get()?.c || 0;
      return { status: 'PASS', message: `${c} online orders` };
    } catch (_) {
      return { status: 'WARNING', message: 'online_orders_local table not present' };
    }
  }},
  { key: 'accounting', label: 'Accounting', run: async () => {
    try {
      const { getDb } = require('../database/db');
      getDb().prepare('SELECT 1 FROM acc_settings LIMIT 1').get();
      return { status: 'PASS', message: 'Accounting module schema present' };
    } catch (_) {
      return { status: 'WARNING', message: 'Accounting tables not migrated' };
    }
  }},
  { key: 'payments', label: 'Payments', run: async () => {
    const { getDb } = require('../database/db');
    getDb().prepare('SELECT COUNT(*) AS c FROM sale_payments').get();
    return { status: 'PASS', message: 'Payment records accessible' };
  }},
  { key: 'users', label: 'Users & permissions', run: async () => {
    const { getDb } = require('../database/db');
    const c = getDb().prepare('SELECT COUNT(*) AS c FROM users').get()?.c || 0;
    return { status: c > 0 ? 'PASS' : 'FAIL', message: `${c} users` };
  }},
  { key: 'reports', label: 'Reports', run: async () => {
    const store = require('./store');
    if (typeof store.getDashboardStats !== 'function') return { status: 'WARNING', message: 'Dashboard stats unavailable' };
    const today = new Date().toISOString().slice(0, 10);
    store.getDashboardStats(today, today);
    return { status: 'PASS', message: 'Dashboard stats query OK' };
  }},
  { key: 'notifications', label: 'Notifications', run: async () => {
    const { getDb } = require('../database/db');
    getDb().prepare('SELECT COUNT(*) AS c FROM notifications').get();
    return { status: 'PASS', message: 'Notifications table OK' };
  }},
  { key: 'mobile', label: 'Mobile manager', run: async () => {
    try {
      const { getDb } = require('../database/db');
      getDb().prepare('SELECT 1 FROM mobile_app_users LIMIT 1').get();
      return { status: 'PASS', message: 'Mobile module present' };
    } catch (_) {
      return { status: 'WARNING', message: 'Mobile tables not present' };
    }
  }},
  { key: 'biz_modules', label: 'Business modules', run: async () => {
    ensureMigration();
    return { status: 'PASS', message: 'Business modules schema OK' };
  }}
];

async function runFullSystemTest(token, versionId = null) {
  const user = requireReleasePerm(token, 'run_tests');
  const t0 = Date.now();
  const results = [];
  let passed = 0; let failed = 0; let warnings = 0; let critical = 0;
  for (const test of TEST_SUITE) {
    const ts = Date.now();
    let status = 'NOT_TESTED';
    let message = '';
    try {
      const r = await test.run();
      status = r.status || 'PASS';
      message = r.message || '';
    } catch (err) {
      status = 'FAIL';
      message = err.message || String(err);
      critical += 1;
    }
    if (status === 'PASS') passed += 1;
    else if (status === 'WARNING') warnings += 1;
    else if (status === 'FAIL') { failed += 1; critical += 1; }
    results.push({ test_key: test.key, test_label: test.label, status, message, duration_ms: Date.now() - ts });
  }
  const duration_ms = Date.now() - t0;
  const r = dbRun(`INSERT INTO release_test_runs (version_id, run_by, run_by_name, total_tests, passed, failed, warnings, critical, duration_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [versionId || null, user.portal_user_id || user.id, user.full_name || user.username,
      results.length, passed, failed, warnings, critical, duration_ms]);
  const runId = r.lastInsertRowid;
  for (const row of results) {
    dbRun(`INSERT INTO release_test_results (run_id, test_key, test_label, status, message, duration_ms) VALUES (?,?,?,?,?,?)`,
      [runId, row.test_key, row.test_label, row.status, row.message, row.duration_ms]);
  }
  auditRelease({ user_id: user.id, user_name: user.full_name || user.username, action: 'test_run', entity_type: 'release_test_run', entity_id: runId, details: { passed, failed, warnings, critical } });
  return {
    run_id: runId, total: results.length, passed, failed, warnings, critical, duration_ms,
    tested_at: nowIso(), results
  };
}

function releaseDashboard(token) {
  resolveReleaseSession(token);
  const current = dbGet('SELECT * FROM release_versions ORDER BY id DESC LIMIT 1');
  const lastRun = dbGet('SELECT * FROM release_test_runs ORDER BY id DESC LIMIT 1');
  const settings = require('./biz-modules-common').getModuleSettings();
  let deployVersion = 'unknown';
  try {
    const fs = require('fs');
    const path = require('path');
    deployVersion = fs.readFileSync(path.join(__dirname, '../../deploy-version.txt'), 'utf8').trim();
  } catch (_) { /* */ }
  return {
    current_version: current?.version_number || deployVersion,
    last_test: lastRun,
    preview_url: settings.release_preview_url || null,
    recent_versions: dbAll('SELECT * FROM release_versions ORDER BY id DESC LIMIT 10'),
    recent_deployments: dbAll('SELECT * FROM release_deployments ORDER BY id DESC LIMIT 10')
  };
}

function createReleaseVersion(data, token) {
  const user = resolveReleaseSession(token);
  if (!data.version_number) throw new Error('Version number required');
  const r = dbRun(`INSERT INTO release_versions (version_number, release_name, description, changes_json, developer_id, developer_name)
    VALUES (?,?,?,?,?,?)`,
    [data.version_number, data.release_name || null, data.description || null,
      JSON.stringify(data.changes || []), user.id, user.full_name || user.username]);
  auditRelease({ user_id: user.id, user_name: user.full_name || user.username, action: 'version_created', entity_type: 'release_version', entity_id: r.lastInsertRowid });
  return dbGet('SELECT * FROM release_versions WHERE id = ?', [r.lastInsertRowid]);
}

async function approveRelease(versionId, token, confirm = false) {
  const user = requireReleasePerm(token, 'approve');
  if (!confirm) throw new Error('Confirmation required to approve release');
  const ver = dbGet('SELECT * FROM release_versions WHERE id = ?', [versionId]);
  if (!ver) throw new Error('Version not found');
  const lastRun = dbGet('SELECT * FROM release_test_runs WHERE version_id = ? OR version_id IS NULL ORDER BY id DESC LIMIT 1', [versionId]);
  if (lastRun && Number(lastRun.critical) > 0) throw new Error('Cannot approve — critical test failures exist');
  dbRun(`UPDATE release_versions SET approval_status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
    [user.id, nowIso(), nowIso(), versionId]);
  auditRelease({ user_id: user.id, user_name: user.full_name || user.username, action: 'release_approved', entity_type: 'release_version', entity_id: versionId });
  return dbGet('SELECT * FROM release_versions WHERE id = ?', [versionId]);
}

async function publishRelease(versionId, token, confirm = false) {
  const user = requireReleasePerm(token, 'publish');
  if (!confirm) throw new Error('Confirmation required to publish to production');
  const ver = dbGet('SELECT * FROM release_versions WHERE id = ?', [versionId]);
  if (!ver) throw new Error('Version not found');
  if (ver.approval_status !== 'approved') throw new Error('Release must be approved before publishing');
  const dep = dbRun(`INSERT INTO release_deployments (version_id, deployed_by, deployed_by_name, environment, result, started_at)
    VALUES (?,?,?,?,?,?)`,
    [versionId, user.id, user.full_name || user.username, 'production', 'in_progress', nowIso()]);
  const depId = dep.lastInsertRowid;
  let result = 'success';
  let log = 'Deployment recorded. Railway deploy must be triggered separately via `railway up` or CI pipeline.';
  try {
    const fs = require('fs');
    const path = require('path');
    const verFile = path.join(__dirname, '../../deploy-version.txt');
    fs.writeFileSync(verFile, `${ver.version_number}\n`);
    log += ` deploy-version.txt updated to ${ver.version_number}.`;
  } catch (err) {
    result = 'partial';
    log += ` Warning: ${err.message}`;
  }
  dbRun(`UPDATE release_deployments SET result = ?, log_text = ?, completed_at = ? WHERE id = ?`, [result, log, nowIso(), depId]);
  dbRun(`UPDATE release_versions SET published_status = 'published', published_at = ?, deployment_result = ?, updated_at = ? WHERE id = ?`,
    [nowIso(), result, nowIso(), versionId]);
  auditRelease({ user_id: user.id, user_name: user.full_name || user.username, action: 'release_published', entity_type: 'release_version', entity_id: versionId, details: { result } });
  return { success: result === 'success', result, log, deployment_id: depId, note: 'Full Railway deploy is not automatic — run railway up or your CI pipeline after approval.' };
}

function saveReleaseUser(data, actor) {
  assertUserActor(actor, ['owner']);
  ensureMigration();
  const username = String(data.username || '').trim();
  const fullName = String(data.full_name || username).trim();
  const role = data.role || 'tester';
  if (!username) throw new Error('Username required');
  if (data.id) {
    const sets = ['full_name = ?', 'role = ?', 'is_active = ?', 'updated_at = ?'];
    const vals = [fullName, role, data.is_active !== false ? 1 : 0, nowIso()];
    if (data.password) { sets.push('password_hash = ?'); vals.push(hashPassword(data.password)); }
    vals.push(data.id);
    dbRun(`UPDATE release_centre_users SET ${sets.join(', ')} WHERE id = ?`, vals);
    return dbGet('SELECT id, username, full_name, role, is_active FROM release_centre_users WHERE id = ?', [data.id]);
  }
  if (!data.password || String(data.password).length < 6) throw new Error('Password min 6 characters required');
  const r = dbRun(`INSERT INTO release_centre_users (username, password_hash, full_name, role) VALUES (?,?,?,?)`,
    [username, hashPassword(data.password), fullName, role]);
  return dbGet('SELECT id, username, full_name, role, is_active FROM release_centre_users WHERE id = ?', [r.lastInsertRowid]);
}

function listReleaseUsers(actor) {
  assertUserActor(actor, ['owner', 'manager']);
  return dbAll('SELECT id, username, full_name, role, is_active, last_login_at FROM release_centre_users ORDER BY full_name');
}

function releaseSummary() {
  ensureMigration();
  let currentVersion = '—';
  try {
    const fs = require('fs');
    const path = require('path');
    currentVersion = fs.readFileSync(path.join(__dirname, '../../deploy-version.txt'), 'utf8').trim();
  } catch (_) { /* */ }
  const lastRun = dbGet('SELECT * FROM release_test_runs ORDER BY id DESC LIMIT 1');
  const lastDep = dbGet('SELECT * FROM release_deployments ORDER BY id DESC LIMIT 1');
  return {
    current_version: currentVersion,
    last_test_status: lastRun ? (Number(lastRun.critical) > 0 ? 'FAIL' : Number(lastRun.failed) > 0 ? 'WARNING' : 'PASS') : 'NOT_TESTED',
    last_deployment: lastDep?.result || 'none'
  };
}

module.exports = {
  releaseLogin, releaseLogout, resolveReleaseSession, releaseDashboard,
  runFullSystemTest, createReleaseVersion, approveRelease, publishRelease,
  saveReleaseUser, listReleaseUsers, releaseSummary, TEST_SUITE
};
