/**
 * Shared online-shop login bridge for Windows (Electron) and Android (sql.js) installers.
 * Local login first (fast / offline). If credentials fail locally, authenticate against
 * Railway and seed the local DB (settings + catalog) so the same shop as the browser opens.
 * The renderer installer-sync.js prefers cloud-first when online for identity match.
 */
const DEFAULT_CLOUD = 'https://peaceful-motivation-production-7dd2.up.railway.app';

function syncBase() {
  const raw =
    (typeof process !== 'undefined' &&
      (process.env.SHOP_POS_SYNC_URL || process.env.SHOP_POS_CLOUD_URL)) ||
    DEFAULT_CLOUD;
  return String(raw).replace(/\/$/, '');
}

async function postRpc(method, args, baseUrl) {
  const url = `${(baseUrl || syncBase()).replace(/\/$/, '')}/rpc`;
  const fetchFn = typeof fetch === 'function' ? fetch : null;
  if (!fetchFn) {
    const https = require('https');
    const http = require('http');
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify({ method, args: args || [] });
    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'http:' ? 80 : 443),
          path: u.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(25000, () => {
        req.destroy(new Error('Online shop login timed out'));
      });
      req.write(body);
      req.end();
    });
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 25000) : null;
  try {
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || [] }),
      signal: ctrl ? ctrl.signal : undefined
    });
    return await r.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pickUser(cloud) {
  if (!cloud || typeof cloud !== 'object') return null;
  if (cloud.user) return cloud.user;
  if (cloud.data && cloud.data.user) return cloud.data.user;
  return null;
}

function unwrapList(res) {
  if (!res || typeof res !== 'object') return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (res.data && Array.isArray(res.data.rows)) return res.data.rows;
  return [];
}

async function pullCloudShop(username, password, pin) {
  const cloud = await postRpc('auth_login', [username, password, pin || null]);
  if (!cloud || cloud.success === false) return { ok: false, cloud };
  const user = pickUser(cloud);
  let settings = {};
  try {
    const sRes = await postRpc('settings_getParsed', []);
    if (sRes && sRes.success !== false) settings = sRes.data || sRes || {};
  } catch (_) { /* ignore */ }
  let categories = [];
  let products = [];
  try { categories = unwrapList(await postRpc('categories_get', [{}])); } catch (_) { /* ignore */ }
  try { products = unwrapList(await postRpc('products_get', [{}])); } catch (_) { /* ignore */ }
  return { ok: true, cloud, user, settings, categories, products };
}

function seedFromBundle(store, username, password, pin, bundle) {
  if (typeof store.seedInstallerAccountFromCloud !== 'function') return;
  store.seedInstallerAccountFromCloud({
    username,
    password,
    pin: pin || null,
    cloudUser: bundle.user || { username, role: 'owner', full_name: username },
    settings: bundle.settings || {},
    categories: bundle.categories || [],
    products: bundle.products || []
  });
}

/**
 * @param {object} store store module with login + seedInstallerAccountFromCloud
 */
async function loginWithOnlineFallback(store, username, password, pin) {
  let local;
  try {
    local = store.login(username, password, pin);
  } catch (e) {
    local = { success: false, error: e.message || String(e) };
  }

  const err = String(local?.error || '');
  const tryCloud =
    !(local && local.success) &&
    (/invalid username or password/i.test(err) || /no such user/i.test(err) || !err);

  if (!tryCloud) return local;

  try {
    const bundle = await pullCloudShop(username, password, pin);
    if (!bundle.ok) {
      return bundle.cloud && bundle.cloud.error ? bundle.cloud : local;
    }
    seedFromBundle(store, username, password, pin, bundle);
    const again = store.login(username, password, pin);
    if (again && again.success) {
      return { ...again, cloudLinked: true, shop_name: bundle.settings?.shop_name };
    }
    if (bundle.user) {
      return { success: true, user: bundle.user, cloudLinked: true, shop_name: bundle.settings?.shop_name };
    }
    return again || local;
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Online shop login timed out' : e.message || String(e);
    return {
      success: false,
      error: `${local?.error || 'Invalid username or password'} (online check: ${msg})`
    };
  }
}

async function hasRecoveryWithOnlineFallback(store) {
  try {
    if (store.hasRecoverySecret()) return true;
  } catch (_) { /* ignore */ }
  try {
    const cloud = await postRpc('auth_hasRecovery', []);
    return !!(cloud && cloud.success !== false && (cloud.data === true || cloud === true));
  } catch (_) {
    return false;
  }
}

async function recoverVerifyWithOnlineFallback(store, secret) {
  try {
    return { success: true, data: store.getUsernamesForRecovery(secret) };
  } catch (localErr) {
    try {
      const cloud = await postRpc('auth_recoverVerify', [secret]);
      if (cloud && cloud.success !== false) {
        return cloud.data != null ? { success: true, data: cloud.data, fromCloud: true } : cloud;
      }
      return cloud || { success: false, error: localErr.message };
    } catch (e) {
      return { success: false, error: localErr.message || e.message };
    }
  }
}

async function recoverResetWithOnlineFallback(store, secret, username, newPassword) {
  try {
    return store.resetPasswordViaRecovery(secret, username, newPassword);
  } catch (localErr) {
    try {
      const cloud = await postRpc('auth_recoverReset', [secret, username, newPassword]);
      if (cloud && cloud.success !== false) {
        try {
          store.seedInstallerAccountFromCloud({
            username,
            password: newPassword,
            cloudUser: { username, role: 'owner', full_name: username },
            settings: {}
          });
        } catch (_) { /* ignore */ }
        return cloud;
      }
      return cloud || { success: false, error: localErr.message };
    } catch (e) {
      return { success: false, error: localErr.message || e.message };
    }
  }
}

module.exports = {
  syncBase,
  postRpc,
  loginWithOnlineFallback,
  hasRecoveryWithOnlineFallback,
  recoverVerifyWithOnlineFallback,
  recoverResetWithOnlineFallback,
  DEFAULT_CLOUD
};
