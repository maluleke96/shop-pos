/**
 * Menu & Promo Studio — secure Windows/Android app sessions.
 * Reuses existing users table + permissions JSON. No separate auth DB.
 */
const bcrypt = require('bcryptjs');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, hashToken, newToken
} = require('./biz-modules-common');
const { hasUserPermission, loadUserById } = require('./authz');
const session = require('./session');

const PERM_MENU = 'studio_menu_builder';
const PERM_VIDEO = 'studio_promo_video';

const MSG = {
  badCreds: 'Login unsuccessful. The details entered are incorrect. Please check your credentials and try again.',
  noAccess: 'Access not granted. Your account does not currently have permission to use this application. Please contact your administrator.',
  inactive: 'Account access unavailable. Your staff account is no longer active. Please contact your administrator for assistance.',
  revoked: 'Access has been updated. Please sign in again.',
  sessionGone: 'Your session has ended. Please sign in again.'
};

function ensureSchema() {
  try {
    dbGet('SELECT 1 FROM studio_app_sessions LIMIT 1');
  } catch (_) {
    try {
      const fs = require('fs');
      const path = require('path');
      const p = path.join(__dirname, '../database/migrations-v116-studio-app.sql');
      if (!fs.existsSync(p)) return;
      const sql = fs.readFileSync(p, 'utf8');
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { require('../database/db').getDb().exec(`${stmt};`); } catch (e) {
          if (!/already exists|duplicate column/i.test(String(e.message))) { /* */ }
        }
      }
    } catch (_) { /* */ }
  }
}

function parsePermissions(user) {
  let perms = user?.permissions;
  if (typeof perms === 'string') {
    try { perms = JSON.parse(perms); } catch { perms = {}; }
  }
  return perms && typeof perms === 'object' ? perms : {};
}

function userIsActive(user) {
  if (!user) return false;
  if (String(user.role || '') === 'owner') return true;
  const v = user.is_active;
  if (v === false || v === 0 || v === '0' || v === 'f' || v === 'false' || v === 'n') return false;
  return true;
}

function studioFlags(user) {
  if (!user) return { menu: false, video: false, any: false };
  if (user.role === 'owner') return { menu: true, video: true, any: true };
  const menu = hasUserPermission(user, PERM_MENU);
  const video = hasUserPermission(user, PERM_VIDEO);
  return { menu: !!menu, video: !!video, any: !!(menu || video) };
}

function safeUser(user, flags) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    branch_id: user.branch_id || null,
    permissions: {
      studio_menu_builder: !!flags.menu,
      studio_promo_video: !!flags.video
    }
  };
}

function revokeUserSessions(userId) {
  ensureSchema();
  if (userId == null) return;
  dbRun('DELETE FROM studio_app_sessions WHERE user_id = ?', [userId]);
}

function resolveSession(token) {
  ensureSchema();
  if (!token) {
    const err = new Error(MSG.sessionGone);
    err.code = 'STUDIO_SESSION';
    throw err;
  }
  const row = dbGet(`
    SELECT s.id AS session_id, s.expires_at, u.*
    FROM studio_app_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, [hashToken(token), nowIso()]);
  if (!row) {
    const err = new Error(MSG.sessionGone);
    err.code = 'STUDIO_SESSION';
    throw err;
  }
  if (!userIsActive(row)) {
    dbRun('DELETE FROM studio_app_sessions WHERE id = ?', [row.session_id]);
    const err = new Error(MSG.inactive);
    err.code = 'STUDIO_INACTIVE';
    throw err;
  }
  const flags = studioFlags(row);
  if (!flags.any) {
    dbRun('DELETE FROM studio_app_sessions WHERE id = ?', [row.session_id]);
    const err = new Error(MSG.revoked);
    err.code = 'STUDIO_REVOKED';
    throw err;
  }
  return { row, flags };
}

function studioLogin(username, password, device = {}) {
  ensureSchema();
  const u = String(username || '').trim();
  const pass = String(password || '');
  const pin = device?.pin != null ? String(device.pin) : (device?.pin_code != null ? String(device.pin_code) : '');

  let user = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [u]);
  if (!user) {
    try {
      user = dbGet('SELECT * FROM users WHERE username = ?', [u]);
    } catch (_) { /* */ }
  }
  if (!user) {
    const err = new Error(MSG.badCreds);
    err.code = 'STUDIO_BAD_CREDS';
    throw err;
  }
  if (!userIsActive(user)) {
    const err = new Error(MSG.inactive);
    err.code = 'STUDIO_INACTIVE';
    throw err;
  }

  let passOk = false;
  try {
    passOk = !!(user.password_hash && bcrypt.compareSync(pass, user.password_hash));
  } catch (_) {
    passOk = false;
  }
  // Allow PIN-as-password when the account uses a POS PIN (common staff habit)
  if (!passOk && user.pin && pass) {
    try {
      const { verifyPinWithUpgrade } = require('./pin');
      const check = verifyPinWithUpgrade(user.pin, pass);
      passOk = !!check?.ok;
    } catch (_) {
      try {
        passOk = bcrypt.compareSync(pass, user.pin);
      } catch { /* */ }
    }
  }
  // If password matched but account also has a PIN, accept optional PIN when provided
  if (passOk && user.pin && pin) {
    try {
      const { verifyPinWithUpgrade } = require('./pin');
      const check = verifyPinWithUpgrade(user.pin, pin);
      if (!check?.ok) {
        const err = new Error('Invalid PIN. Enter the same PIN you use on Admin / POS.');
        err.code = 'STUDIO_BAD_PIN';
        throw err;
      }
    } catch (e) {
      if (e.code === 'STUDIO_BAD_PIN') throw e;
    }
  }
  if (!passOk) {
    const err = new Error(MSG.badCreds);
    err.code = 'STUDIO_BAD_CREDS';
    throw err;
  }

  const flags = studioFlags(user);
  if (!flags.any) {
    const err = new Error(MSG.noAccess);
    err.code = 'STUDIO_NO_ACCESS';
    throw err;
  }
  const token = newToken();
  const exp = nowPlusDays(14);
  dbRun(`
    INSERT INTO studio_app_sessions (user_id, token_hash, device_name, platform, expires_at)
    VALUES (?,?,?,?,?)
  `, [user.id, hashToken(token), device.device_name || null, device.platform || 'web', exp]);

  const { password_hash, pin: _pin, ...safe } = user;
  session.setUserSession(safe);

  return {
    token,
    user: safeUser(user, flags),
    access: flags
  };
}

function studioLogout(token) {
  ensureSchema();
  if (token) dbRun('DELETE FROM studio_app_sessions WHERE token_hash = ?', [hashToken(token)]);
  return { success: true };
}

function studioProfile(token) {
  const { row, flags } = resolveSession(token);
  return {
    user: safeUser(row, flags),
    access: flags,
    shop: studioShopSettings()
  };
}

function studioCheck(token) {
  const { row, flags } = resolveSession(token);
  return {
    ok: true,
    access: flags,
    user: safeUser(row, flags)
  };
}

function studioBeginModule(token, moduleId) {
  const { row, flags } = resolveSession(token);
  const mod = String(moduleId || '').toLowerCase();
  if (mod === 'menu' || mod === 'menu-builder' || mod === 'studio_menu_builder') {
    if (!flags.menu) {
      const err = new Error(MSG.noAccess);
      err.code = 'STUDIO_NO_ACCESS';
      throw err;
    }
    const { password_hash, pin, ...safe } = row;
    session.setUserSession(safe);
    return {
      module: 'menu-builder',
      section: 'menu-builder',
      user: safeUser(row, flags),
      access: flags
    };
  }
  if (mod === 'video' || mod === 'promo-video' || mod === 'promo-video-builder' || mod === 'studio_promo_video') {
    if (!flags.video) {
      const err = new Error(MSG.noAccess);
      err.code = 'STUDIO_NO_ACCESS';
      throw err;
    }
    const { password_hash, pin, ...safe } = row;
    session.setUserSession(safe);
    return {
      module: 'promo-video-builder',
      section: 'promo-video-builder',
      user: safeUser(row, flags),
      access: flags
    };
  }
  const err = new Error(MSG.noAccess);
  err.code = 'STUDIO_NO_ACCESS';
  throw err;
}

function studioShopSettings() {
  try {
    const store = require('./store');
    const s = store.getSettingsParsed?.() || {};
    return {
      shop_name: s.shop_name || s.business_name || 'Shop',
      currency: s.currency || 'R',
      logo_url: s.logo_url || s.logo || null
    };
  } catch (_) {
    return { shop_name: 'Shop', currency: 'R', logo_url: null };
  }
}

/** Called when Admin saves user permissions — drop studio sessions if access removed. */
function onUserPermissionsChanged(userId, permissionsObj) {
  ensureSchema();
  const user = loadUserById(userId);
  if (!user) {
    revokeUserSessions(userId);
    return;
  }
  const merged = { ...user, permissions: permissionsObj != null ? permissionsObj : user.permissions };
  if (!userIsActive(merged) || !studioFlags(merged).any) {
    revokeUserSessions(userId);
  }
}

module.exports = {
  PERM_MENU,
  PERM_VIDEO,
  MSG,
  ensureSchema,
  studioFlags,
  studioLogin,
  studioLogout,
  studioProfile,
  studioCheck,
  studioBeginModule,
  studioShopSettings,
  revokeUserSessions,
  onUserPermissionsChanged,
  resolveSession,
  userIsActive
};
