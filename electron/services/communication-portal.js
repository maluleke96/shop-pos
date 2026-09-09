/**
 * Communication Centre — standalone portal authentication.
 * Portal users (created by admin) OR shop owner/manager can sign in.
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');
const { hashToken, newToken, nowIso, nowPlusDays } = require('./biz-modules-common');
const comm = require('./communication-centre');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }

function ensurePortalSchema() {
  comm.ensureSchema();
  const fs = require('fs');
  const path = require('path');
  const pgDb = require('../database/pg-db');
  if (pgDb.isPgMode()) {
    const mig = path.join(__dirname, '../../supabase/migrations/20260909_comm_portal_auth.sql');
    if (fs.existsSync(mig)) {
      try {
        const { splitSqlStatements } = require('../database/ensure-pg-schema');
        for (const stmt of splitSqlStatements(fs.readFileSync(mig, 'utf8'))) {
          try { getDb().exec(stmt); } catch (_) { /* exists */ }
        }
      } catch (_) { /* ignore */ }
    }
  } else {
    const mig = path.join(__dirname, '../database/migrations-v104-comm-portal-auth.sql');
    if (fs.existsSync(mig)) {
      try { getDb().exec(fs.readFileSync(mig, 'utf8')); } catch (_) { /* exists */ }
    }
  }
}

function portalActorFromPortalUser(u) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name || u.username,
    role: u.role === 'administrator' ? 'manager' : (u.role === 'marketing' ? 'marketing_agent' : 'supervisor'),
    portal_role: u.role,
    is_portal_user: true
  };
}

function portalActorFromShopUser(u) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name || u.username,
    role: u.role,
    is_portal_user: false
  };
}

function shopUserCanAccessComm(user) {
  if (!user || user.is_active === 0 || user.is_active === false) return false;
  return ['owner', 'manager', 'assistant_manager', 'marketing_agent'].includes(user.role);
}

function commPortalLogin(username, password, device = {}) {
  ensurePortalSchema();
  const uname = String(username || '').trim();
  const pwd = String(password || '');
  if (!uname || !pwd) throw new Error('Username and password required');

  const portalUser = dbGet('SELECT * FROM comm_portal_users WHERE lower(username) = lower(?) AND is_active = 1', [uname]);
  if (portalUser && bcrypt.compareSync(pwd, portalUser.password_hash)) {
    const token = newToken();
    const exp = nowPlusDays(14);
    dbRun(`INSERT INTO comm_portal_sessions (portal_user_id, token_hash, expires_at) VALUES (?,?,?)`,
      [portalUser.id, hashToken(token), exp]);
    dbRun('UPDATE comm_portal_users SET last_login_at = ? WHERE id = ?', [nowIso(), portalUser.id]);
    comm.audit(portalActorFromPortalUser(portalUser), 'portal_login', 'comm_portal', portalUser.id, { device: device.platform || 'web' });
    return {
      token,
      user: {
        id: portalUser.id,
        username: portalUser.username,
        full_name: portalUser.full_name || portalUser.username,
        role: portalUser.role,
        login_type: 'portal'
      }
    };
  }

  const shopUser = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [uname]);
  if (shopUser && shopUser.password_hash && bcrypt.compareSync(pwd, shopUser.password_hash)) {
    if (!shopUserCanAccessComm(shopUser)) {
      throw new Error('Your account does not have access to Communication Centre.');
    }
    const token = newToken();
    const exp = nowPlusDays(14);
    dbRun(`INSERT INTO comm_portal_sessions (shop_user_id, token_hash, expires_at) VALUES (?,?,?)`,
      [shopUser.id, hashToken(token), exp]);
    comm.audit(portalActorFromShopUser(shopUser), 'portal_login', 'comm_portal', shopUser.id, { device: device.platform || 'web', login_type: 'shop_admin' });
    return {
      token,
      user: {
        id: shopUser.id,
        username: shopUser.username,
        full_name: shopUser.full_name || shopUser.username,
        role: shopUser.role,
        login_type: 'shop_admin'
      }
    };
  }

  throw new Error('Invalid username or password');
}

function commPortalLogout(token) {
  ensurePortalSchema();
  dbRun('DELETE FROM comm_portal_sessions WHERE token_hash = ?', [hashToken(token)]);
  return { success: true };
}

function resolveCommPortalSession(token) {
  ensurePortalSchema();
  if (!token) throw new Error('Sign in required');
  const row = dbGet(`
    SELECT s.*, pu.username AS portal_username, pu.full_name AS portal_full_name, pu.role AS portal_role,
           u.username AS shop_username, u.full_name AS shop_full_name, u.role AS shop_role, u.is_active AS shop_active
    FROM comm_portal_sessions s
    LEFT JOIN comm_portal_users pu ON pu.id = s.portal_user_id
    LEFT JOIN users u ON u.id = s.shop_user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, [hashToken(token), nowIso()]);
  if (!row) throw new Error('Session expired — please sign in again');
  if (row.portal_user_id) {
    return { actor: portalActorFromPortalUser({
      id: row.portal_user_id,
      username: row.portal_username,
      full_name: row.portal_full_name,
      role: row.portal_role
    }), token };
  }
  if (row.shop_user_id) {
    if (row.shop_active === 0 || row.shop_active === false) throw new Error('Account deactivated');
    if (!shopUserCanAccessComm({ role: row.shop_role, is_active: row.shop_active })) {
      throw new Error('Access revoked');
    }
    return { actor: portalActorFromShopUser({
      id: row.shop_user_id,
      username: row.shop_username,
      full_name: row.shop_full_name,
      role: row.shop_role
    }), token };
  }
  throw new Error('Invalid session');
}

function commPortalProfile(token) {
  const { actor } = resolveCommPortalSession(token);
  const shop = dbGet('SELECT shop_name, phone, address FROM shop_settings WHERE id = 1') || {};
  return {
    user: actor,
    shop: { name: shop.shop_name || 'Shop POS', phone: shop.phone, address: shop.address }
  };
}

function listPortalUsers(actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensurePortalSchema();
  return dbAll(`
    SELECT id, username, full_name, role, is_active, last_login_at, created_at, created_by_name
    FROM comm_portal_users ORDER BY username
  `);
}

function savePortalUser(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensurePortalSchema();
  const id = data.id ? Number(data.id) : null;
  const username = String(data.username || '').trim();
  const fullName = String(data.full_name || data.fullName || '').trim() || username;
  const role = data.role || 'marketing';
  if (!username) throw new Error('Username required');

  if (id) {
    const existing = dbGet('SELECT * FROM comm_portal_users WHERE id = ?', [id]);
    if (!existing) throw new Error('User not found');
    const fields = ['full_name = ?', 'role = ?', 'is_active = ?', 'updated_at = ?'];
    const vals = [fullName, role, data.is_active !== false ? 1 : 0, nowIso()];
    if (data.password && String(data.password).length >= 4) {
      fields.push('password_hash = ?');
      vals.push(bcrypt.hashSync(String(data.password), 10));
    }
    vals.push(id);
    dbRun(`UPDATE comm_portal_users SET ${fields.join(', ')} WHERE id = ?`, vals);
    comm.audit(actor, 'portal_user_updated', 'comm_portal_user', id, { username });
    return dbGet('SELECT id, username, full_name, role, is_active, last_login_at FROM comm_portal_users WHERE id = ?', [id]);
  }

  const dup = dbGet('SELECT id FROM comm_portal_users WHERE lower(username) = lower(?)', [username]);
  if (dup) throw new Error('Username already exists');
  const pwd = String(data.password || '');
  if (pwd.length < 4) throw new Error('Password must be at least 4 characters');
  const r = dbRun(`INSERT INTO comm_portal_users (username, password_hash, full_name, role, is_active, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?)`, [
    username, bcrypt.hashSync(pwd, 10), fullName, role, data.is_active !== false ? 1 : 0,
    actor?.id || null, actor?.username || null
  ]);
  comm.audit(actor, 'portal_user_created', 'comm_portal_user', r.lastInsertRowid, { username, role });
  return dbGet('SELECT id, username, full_name, role, is_active, last_login_at FROM comm_portal_users WHERE id = ?', [r.lastInsertRowid]);
}

function deletePortalUser(id, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensurePortalSchema();
  dbRun('UPDATE comm_portal_users SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), Number(id)]);
  dbRun('DELETE FROM comm_portal_sessions WHERE portal_user_id = ?', [Number(id)]);
  comm.audit(actor, 'portal_user_disabled', 'comm_portal_user', Number(id), {});
  return true;
}

module.exports = {
  ensurePortalSchema,
  commPortalLogin,
  commPortalLogout,
  resolveCommPortalSession,
  commPortalProfile,
  listPortalUsers,
  savePortalUser,
  deletePortalUser
};
