/**
 * Shared helpers for Business Modules (Investor, Release, Meeting).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function nowPlusDays(d) { return new Date(Date.now() + d * 86400000).toISOString().slice(0, 19).replace('T', ' '); }
function parseJson(v, fb = null) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function ensureMigration() {
  try { dbGet('SELECT 1 FROM biz_module_settings LIMIT 1'); } catch (_) {
    try {
      const fs = require('fs');
      const path = require('path');
      const p = path.join(__dirname, '../database/migrations-v85.sql');
      if (fs.existsSync(p)) getDb().exec(fs.readFileSync(p, 'utf8'));
    } catch (err) {
      console.warn('[biz-modules] schema ensure failed:', err.message || err);
    }
  }
  try { dbRun('INSERT OR IGNORE INTO biz_module_settings (id) VALUES (1)'); } catch (_) {
    try { dbRun('INSERT INTO biz_module_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING'); } catch (__) { /* */ }
  }
}

function getModuleSettings() {
  ensureMigration();
  return dbGet('SELECT * FROM biz_module_settings WHERE id = 1') || {};
}

function saveModuleSettings(data, actor) {
  ensureMigration();
  const fields = ['investor_enabled', 'release_enabled', 'meeting_enabled', 'meeting_retention_days', 'release_preview_url'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (data[f] !== undefined) { sets.push(`${f} = ?`); vals.push(data[f]); }
  }
  if (!sets.length) return getModuleSettings();
  dbRun(`UPDATE biz_module_settings SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`, [...vals, nowIso()]);
  return getModuleSettings();
}

function moduleAudit(table, row) {
  ensureMigration();
  const cols = [];
  const vals = [];
  const add = (c, v) => { cols.push(c); vals.push(v); };
  if (table === 'investor_audit_logs' && row.investor_id != null) add('investor_id', row.investor_id);
  if (table === 'meeting_audit_logs' && row.meeting_id != null) add('meeting_id', row.meeting_id);
  add('user_id', row.user_id || null);
  add('user_name', row.user_name || null);
  add('action', row.action);
  add('module', row.module || 'system');
  add('entity_type', row.entity_type || null);
  add('entity_id', row.entity_id || null);
  add('details_json', JSON.stringify(row.details || {}));
  add('result', row.result || 'ok');
  try {
    dbRun(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  } catch (_) { /* */ }
}

function createModuleSession(table, userId, days = 14) {
  const token = newToken();
  dbRun(`INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?,?,?)`,
    [userId, hashToken(token), nowPlusDays(days)]);
  return { token, expires_at: nowPlusDays(days) };
}

function resolveModuleSession(table, usersTable, token) {
  if (!token) throw new Error('Not authenticated');
  const row = dbGet(`SELECT s.*, u.*, s.id AS session_id, u.id AS portal_user_id
    FROM ${table} s JOIN ${usersTable} u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    [hashToken(token), nowIso()]);
  if (!row) throw new Error('Session expired or access revoked');
  return row;
}

function hashPassword(p) { return bcrypt.hashSync(String(p), 10); }
function verifyPassword(p, hash) { return bcrypt.compareSync(String(p), hash); }

/**
 * Verify POS staff credentials (owner/manager/supervisor/assistant_manager).
 * Returns the POS user row (without password) or null.
 */
function tryPosAdminLogin(username, password) {
  const u = String(username || '').trim();
  const pass = String(password || '');
  if (!u || !pass) return null;
  let user;
  try {
    user = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [u]);
  } catch (_) {
    return null;
  }
  if (!user) return null;
  const active = user.is_active !== 0 && user.is_active !== '0' && user.status !== 'inactive';
  if (!active) return null;
  const role = String(user.role || '').toLowerCase();
  const allowed = new Set(['owner', 'manager', 'supervisor', 'assistant_manager']);
  if (!allowed.has(role)) return null;

  let passOk = false;
  try {
    if (user.password_hash) passOk = bcrypt.compareSync(pass, user.password_hash);
  } catch (_) { passOk = false; }
  if (!passOk && user.pin) {
    try {
      const { verifyPinWithUpgrade } = require('./pin');
      passOk = !!verifyPinWithUpgrade(user.pin, pass)?.ok;
    } catch (_) { /* */ }
  }
  if (!passOk) return null;
  const { password_hash, pin, ...safe } = user;
  return safe;
}

/**
 * Ensure a portal admin row exists for a POS user (same username + synced password).
 * opts: { usersTable, role, password } — password used to set/update hash when provided.
 */
function upsertPortalAdminFromPos(usersTable, posUser, opts = {}) {
  const username = String(posUser.username || '').trim();
  if (!username || !usersTable) throw new Error('Invalid portal user upsert');
  const role = opts.role || 'admin';
  const fullName = posUser.full_name || posUser.username || 'Admin';
  const existing = dbGet(`SELECT * FROM ${usersTable} WHERE lower(username) = lower(?)`, [username]);
  const password = opts.password != null ? String(opts.password) : null;
  if (existing) {
    if (password) {
      try {
        dbRun(`UPDATE ${usersTable} SET password_hash = ?, full_name = ?, role = ?, is_active = 1 WHERE id = ?`,
          [hashPassword(password), fullName, role, existing.id]);
      } catch (_) {
        dbRun(`UPDATE ${usersTable} SET password_hash = ?, full_name = ?, is_active = 1 WHERE id = ?`,
          [hashPassword(password), fullName, existing.id]);
      }
      return dbGet(`SELECT * FROM ${usersTable} WHERE id = ?`, [existing.id]);
    }
    return existing;
  }
  if (!password) throw new Error('Password required to create portal admin');
  try {
    dbRun(`INSERT INTO ${usersTable} (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)`,
      [username, hashPassword(password), fullName, role]);
  } catch (_) {
    dbRun(`INSERT INTO ${usersTable} (username, password_hash, full_name, role) VALUES (?,?,?,?)`,
      [username, hashPassword(password), fullName, role]);
  }
  return dbGet(`SELECT * FROM ${usersTable} WHERE lower(username) = lower(?)`, [username]);
}

/**
 * Portal login with POS admin fallback.
 * Tries module users first; if that fails, accepts owner/manager POS password and upserts a portal admin.
 */
function portalLoginWithPosFallback({
  username,
  password,
  usersTable,
  sessionsTable,
  portalRole = 'admin',
  findPortalUser,
  onSuccess
}) {
  const u = String(username || '').trim();
  const pass = String(password || '');
  let user = typeof findPortalUser === 'function'
    ? findPortalUser(u)
    : dbGet(`SELECT * FROM ${usersTable} WHERE lower(username) = lower(?) AND is_active = 1`, [u]);

  if (user && verifyPassword(pass, user.password_hash)) {
    const sess = createModuleSession(sessionsTable, user.id);
    if (onSuccess) onSuccess(user, sess, false);
    return { user, sess, via_pos: false };
  }

  const pos = tryPosAdminLogin(u, pass);
  if (!pos) throw new Error('Invalid username or password');

  user = upsertPortalAdminFromPos(usersTable, pos, { role: portalRole, password: pass });
  if (!user) throw new Error('Could not create portal access for Admin');
  const sess = createModuleSession(sessionsTable, user.id);
  if (onSuccess) onSuccess(user, sess, true);
  return { user, sess, via_pos: true };
}

module.exports = {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, parseJson, hashToken, newToken, uid,
  ensureMigration, getModuleSettings, saveModuleSettings, moduleAudit,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword,
  tryPosAdminLogin, upsertPortalAdminFromPos, portalLoginWithPosFallback
};
