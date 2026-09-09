/**
 * Communication Centre standalone portal — login, sessions, portal user admin.
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');
const { hashToken, newToken } = require('./biz-modules-common');

const SHOP_ROLES = new Set(['owner', 'manager', 'supervisor', 'marketing_agent']);

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function nowPlusDays(d) { return new Date(Date.now() + d * 86400000).toISOString().slice(0, 19).replace('T', ' '); }

function ensurePortalSchema() {
  try {
    const comm = require('./communication-centre');
    comm.ensureSchema();
  } catch (_) { /* */ }
  const fs = require('fs');
  const path = require('path');
  const pgDb = require('../database/pg-db');
  if (pgDb.isPgMode()) {
    const mig = path.join(__dirname, '../../supabase/migrations/20260909_comm_portal.sql');
    if (fs.existsSync(mig)) {
      try {
        const { splitSqlStatements } = require('../database/ensure-pg-schema');
        for (const stmt of splitSqlStatements(fs.readFileSync(mig, 'utf8'))) {
          try { getDb().exec(stmt); } catch (e) {
            if (!/already exists/i.test(String(e.message || e))) console.warn('[comm-portal]', e.message);
          }
        }
      } catch (_) { /* */ }
    }
  } else {
    const mig = path.join(__dirname, '../database/migrations-v104-comm-portal.sql');
    if (fs.existsSync(mig)) {
      try { getDb().exec(fs.readFileSync(mig, 'utf8')); } catch (_) { /* */ }
    }
  }
}

function mapPortalRole(role) {
  if (role === 'owner' || role === 'manager') return 'admin';
  if (role === 'marketing_agent') return 'marketing';
  if (role === 'supervisor') return 'admin';
  return role;
}

function sessionActor(row) {
  if (row.portal_user_id) {
    const u = dbGet('SELECT * FROM comm_portal_users WHERE id = ?', [row.portal_user_id]);
    if (!u || !u.is_active) throw new Error('Portal account inactive');
    return {
      id: u.id,
      username: u.username,
      full_name: u.full_name || u.username,
      role: u.role === 'admin' ? 'owner' : u.role,
      comm_role: u.role,
      source: 'portal'
    };
  }
  if (row.shop_user_id) {
    const u = dbGet('SELECT * FROM users WHERE id = ?', [row.shop_user_id]);
    if (!u || u.is_active === 0 || u.is_active === false) throw new Error('Account inactive');
    if (!SHOP_ROLES.has(u.role)) throw new Error('Not authorised for Communication Centre');
    return {
      id: u.id,
      username: u.username,
      full_name: u.full_name || u.username,
      role: u.role,
      comm_role: mapPortalRole(u.role),
      source: 'shop'
    };
  }
  throw new Error('Invalid session');
}

function resolveSession(token) {
  ensurePortalSchema();
  if (!token) throw new Error('Sign in required');
  const row = dbGet(`
    SELECT * FROM comm_portal_sessions
    WHERE token_hash = ? AND expires_at > ?
  `, [hashToken(token), nowIso()]);
  if (!row) throw new Error('Session expired — please sign in again');
  return sessionActor(row);
}

function login(username, password, device = {}) {
  ensurePortalSchema();
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) throw new Error('Username and password required');

  let actor = null;
  let portalUserId = null;
  let shopUserId = null;

  const portal = dbGet('SELECT * FROM comm_portal_users WHERE lower(username) = lower(?)', [u]);
  if (portal) {
    if (!portal.is_active) throw new Error('This portal account is disabled');
    if (!portal.password_hash || !bcrypt.compareSync(p, portal.password_hash)) {
      throw new Error('Invalid username or password');
    }
    portalUserId = portal.id;
    actor = {
      id: portal.id,
      username: portal.username,
      full_name: portal.full_name || portal.username,
      role: portal.role === 'admin' ? 'owner' : portal.role,
      comm_role: portal.role,
      source: 'portal'
    };
    dbRun('UPDATE comm_portal_users SET last_login_at = ?, updated_at = ? WHERE id = ?',
      [nowIso(), nowIso(), portal.id]);
  } else {
    const shop = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [u]);
    if (!shop || !shop.password_hash || !bcrypt.compareSync(p, shop.password_hash)) {
      throw new Error('Invalid username or password');
    }
    if (shop.is_active === 0 || shop.is_active === false) throw new Error('Account deactivated');
    if (!SHOP_ROLES.has(shop.role)) {
      throw new Error('Your account cannot access Communication Centre. Ask admin for a portal login.');
    }
    shopUserId = shop.id;
    actor = {
      id: shop.id,
      username: shop.username,
      full_name: shop.full_name || shop.username,
      role: shop.role,
      comm_role: mapPortalRole(shop.role),
      source: 'shop'
    };
  }

  const token = newToken();
  dbRun(`INSERT INTO comm_portal_sessions (portal_user_id, shop_user_id, token_hash, expires_at)
    VALUES (?,?,?,?)`, [portalUserId, shopUserId, hashToken(token), nowPlusDays(30)]);

  try {
    require('./communication-centre').audit(
      { id: actor.id, username: actor.username },
      'portal_login',
      'comm_portal',
      portalUserId || shopUserId,
      { source: actor.source, device: device.platform || 'web' }
    );
  } catch (_) { /* */ }

  return { token, user: actor };
}

function logout(token) {
  ensurePortalSchema();
  dbRun('DELETE FROM comm_portal_sessions WHERE token_hash = ?', [hashToken(token)]);
  return { success: true };
}

function profile(token) {
  const u = resolveSession(token);
  const settings = dbGet('SELECT shop_name, phone FROM shop_settings WHERE id = 1') || {};
  return { user: u, shop_name: settings.shop_name || 'Shop POS', phone: settings.phone || '' };
}

function requirePortalAdmin(actor) {
  const comm = require('./communication-centre');
  comm.requireCommAdmin(actor);
}

function listPortalUsers(actor) {
  requirePortalAdmin(actor);
  ensurePortalSchema();
  return dbAll(`
    SELECT id, username, full_name, role, is_active, last_login_at, created_at, created_by_name
    FROM comm_portal_users ORDER BY username
  `);
}

function savePortalUser(data, actor) {
  requirePortalAdmin(actor);
  ensurePortalSchema();
  const id = data.id ? Number(data.id) : null;
  const username = String(data.username || '').trim();
  const fullName = String(data.full_name || data.fullName || '').trim() || username;
  const role = ['admin', 'marketing', 'viewer'].includes(data.role) ? data.role : 'marketing';
  if (!username) throw new Error('Username required');

  if (id) {
    const existing = dbGet('SELECT * FROM comm_portal_users WHERE id = ?', [id]);
    if (!existing) throw new Error('Portal user not found');
    const params = [username, fullName, role, data.is_active !== false ? 1 : 0, nowIso(), id];
    if (data.password && String(data.password).length >= 4) {
      dbRun(`UPDATE comm_portal_users SET username=?, full_name=?, role=?, is_active=?, password_hash=?, updated_at=? WHERE id=?`, [
        username, fullName, role, data.is_active !== false ? 1 : 0,
        bcrypt.hashSync(String(data.password), 10), nowIso(), id
      ]);
    } else {
      dbRun(`UPDATE comm_portal_users SET username=?, full_name=?, role=?, is_active=?, updated_at=? WHERE id=?`, params);
    }
    require('./communication-centre').audit(actor, 'portal_user_updated', 'comm_portal_user', id, { username });
    return dbGet('SELECT id, username, full_name, role, is_active, last_login_at FROM comm_portal_users WHERE id = ?', [id]);
  }

  const clash = dbGet('SELECT id FROM comm_portal_users WHERE lower(username) = lower(?)', [username]);
  if (clash) throw new Error('Username already taken');
  const shopClash = dbGet('SELECT id FROM users WHERE lower(username) = lower(?)', [username]);
  if (shopClash) throw new Error('Username already used by a shop account — choose another');
  const password = String(data.password || '');
  if (password.length < 4) throw new Error('Password must be at least 4 characters');

  const r = dbRun(`INSERT INTO comm_portal_users (username, password_hash, full_name, role, is_active, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?)`, [
    username, bcrypt.hashSync(password, 10), fullName, role, 1,
    actor?.id || null, actor?.username || null
  ]);
  require('./communication-centre').audit(actor, 'portal_user_created', 'comm_portal_user', r.lastInsertRowid, { username, role });
  return dbGet('SELECT id, username, full_name, role, is_active, last_login_at FROM comm_portal_users WHERE id = ?', [r.lastInsertRowid]);
}

function setPortalUserActive(id, active, actor) {
  requirePortalAdmin(actor);
  dbRun('UPDATE comm_portal_users SET is_active = ?, updated_at = ? WHERE id = ?',
    [active ? 1 : 0, nowIso(), Number(id)]);
  require('./communication-centre').audit(actor, active ? 'portal_user_enabled' : 'portal_user_disabled', 'comm_portal_user', Number(id), {});
  return true;
}

module.exports = {
  ensurePortalSchema,
  login,
  logout,
  profile,
  resolveSession,
  listPortalUsers,
  savePortalUser,
  setPortalUserActive
};
