/**
 * Windows / Android installers: local SQLite first.
 * If login fails locally, authenticate against the Railway shop (Supabase Postgres)
 * and seed the local account so the same username/password works offline next time.
 * Recovery phrase also falls back to the online shop.
 */
(function () {
  const DEFAULT_CLOUD = 'https://peaceful-motivation-production-7dd2.up.railway.app';
  const TOKEN_KEY = 'shoppos_sync_session';
  const WRITE_RE = /^(auth_|sales_|stock_|products_|categories_|customers_|suppliers_|po_|returns_|expenses_|shifts_|staff_|recipe_|hr_|payroll_|held_|quotes_|layby_|giftcards_|waste_|cashup_|combos_|settings_save|settings_saveJson|ops_|salaryClaims_)/;

  function isBrowserCloud() {
    return !!(window.__SHOP_POS_CLOUD__);
  }

  function isInstaller() {
    if (isBrowserCloud()) return false;
    try {
      if (window.__SHOP_POS_MOBILE__ || window.Capacitor?.isNativePlatform?.()) return true;
    } catch (_) { /* ignore */ }
    if (window.__SHOP_POS_LOCAL_INSTALLER__) return true;
    try {
      if (location.protocol === 'file:') return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  if (!isInstaller()) return;

  function syncBase() {
    const e = window.__SHOP_POS_ENV__ || {};
    const raw = e.SHOP_POS_SYNC_URL || e.SHOP_POS_CLOUD_URL || DEFAULT_CLOUD;
    return String(raw).replace(/\/$/, '');
  }

  function rpcUrl() {
    return syncBase() + '/rpc';
  }

  let sessionToken = '';
  try { sessionToken = localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { /* ignore */ }

  function setConn(state, detail) {
    try { window.ShopPosConnection?.set?.(state, detail); } catch (_) { /* ignore */ }
  }

  async function sendRpc(method, args) {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    const r = await fetch(rpcUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args: args || [] })
    });
    const tok = r.headers.get('X-Session-Token');
    if (tok) {
      sessionToken = tok;
      try { localStorage.setItem(TOKEN_KEY, tok); } catch (_) { /* ignore */ }
    }
    return r.json();
  }

  function unwrap(res) {
    if (!res || typeof res !== 'object') return { success: false, error: 'No response from online shop' };
    if (res.success === false) return res;
    if (res.user) return res;
    if (res.data && typeof res.data === 'object' && Object.prototype.hasOwnProperty.call(res.data, 'success')) {
      return res.data;
    }
    return res;
  }

  function loginOk(res) {
    const u = unwrap(res);
    return !!(u && u.success !== false && (u.user || u.data?.user));
  }

  function loginUser(res) {
    const u = unwrap(res);
    return u.user || u.data?.user || null;
  }

  async function seedLocalFromCloud(username, password, pin, cloudUser) {
    let settings = {};
    let categories = [];
    let products = [];
    try {
      const sRes = unwrap(await sendRpc('settings_getParsed', []));
      if (sRes && sRes.success !== false) settings = sRes.data || sRes || {};
    } catch (_) { /* ignore */ }
    try {
      const cRes = unwrap(await sendRpc('categories_get', [{}]));
      if (Array.isArray(cRes)) categories = cRes;
      else if (Array.isArray(cRes?.data)) categories = cRes.data;
    } catch (_) { /* ignore */ }
    try {
      const pRes = unwrap(await sendRpc('products_get', [{}]));
      if (Array.isArray(pRes)) products = pRes;
      else if (Array.isArray(pRes?.data)) products = pRes.data;
    } catch (_) { /* ignore */ }
    const api = window.posAPI;
    if (!api || typeof api.auth_seedInstallerAccount !== 'function') return false;
    const seed = await api.auth_seedInstallerAccount({
      username,
      password,
      pin: pin || null,
      cloudUser: cloudUser || {},
      settings,
      categories,
      products
    });
    return seed && seed.success !== false;
  }

  async function flushQueue() {
    const q = window.ShopPosOfflineQueue;
    if (!q || navigator.onLine === false) return;
    if (flushQueue._busy) return;
    flushQueue._busy = true;
    try {
      let pending = 0;
      try { pending = await q.pendingCount(); } catch (_) { pending = 0; }
      if (!pending) {
        setConn('online', 'Online');
        return;
      }
      setConn('syncing', `Syncing ${pending}…`);
      try {
        await q.flush(async (method, args, opts) => sendRpc(method, args, opts));
        setConn('online', 'Synced');
        setTimeout(() => setConn('online', 'Online'), 2500);
      } catch (e) {
        console.warn('[installer-sync] flush', e);
        setConn('online', 'Sync paused');
      }
    } finally {
      flushQueue._busy = false;
    }
  }

  let flushTimer = null;
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flushQueue(); }, 400);
  }

  function wrapPosApi() {
    const api = window.posAPI;
    if (!api || api._installerSyncWrapped) return;
    api._installerSyncWrapped = true;
    const names = Object.keys(api);
    names.forEach((prop) => {
      const orig = api[prop];
      if (typeof orig !== 'function') return;
      const key = String(prop).replace(/[:.]/g, '_');

      if (key === 'auth_login') {
        api[prop] = async function (...args) {
          const [username, password, pin] = args;
          // Cloud-first when online — same credentials must open the online shop
          if (navigator.onLine !== false) {
            setConn('syncing', 'Signing in to online shop…');
            try {
              const cloudRaw = await sendRpc(key, args);
              const cloud = unwrap(cloudRaw);
              if (loginOk(cloud)) {
                const user = loginUser(cloud);
                await seedLocalFromCloud(username, password, pin, user);
                const again = await orig.apply(this, args);
                setConn('online', 'Online');
                if (loginOk(again)) return { ...again, cloudLinked: true };
                return { success: true, user, cloudLinked: true };
              }
              // Online rejected credentials — try local only (pure offline shop)
              setConn('online', 'Online');
              const localFail = await orig.apply(this, args);
              return cloud.error ? cloud : localFail;
            } catch (e) {
              setConn(navigator.onLine === false ? 'offline' : 'online');
              // Network error — fall back to local
              const local = await orig.apply(this, args);
              if (loginOk(local)) return local;
              return local.error
                ? local
                : { success: false, error: e.message || 'Could not reach online shop' };
            }
          }
          return orig.apply(this, args);
        };
        return;
      }

      if (key === 'auth_hasRecovery') {
        api[prop] = async function (...args) {
          const local = await orig.apply(this, args);
          const localOn = local && local.success !== false && (local.data === true || local === true);
          if (localOn) return local;
          if (navigator.onLine === false) return local;
          try {
            const cloud = unwrap(await sendRpc(key, args));
            if (cloud && cloud.success !== false && (cloud.data === true || cloud === true)) {
              return { success: true, data: true, fromCloud: true };
            }
          } catch (_) { /* ignore */ }
          return local;
        };
        return;
      }

      if (key === 'auth_recoverVerify') {
        api[prop] = async function (...args) {
          const local = await orig.apply(this, args);
          if (local && local.success !== false && (local.data || Array.isArray(local))) return local;
          if (navigator.onLine === false) return local;
          try {
            const cloud = unwrap(await sendRpc(key, args));
            if (cloud && cloud.success !== false) {
              return cloud.data != null ? { success: true, data: cloud.data, fromCloud: true } : cloud;
            }
            return cloud;
          } catch (e) {
            return local.error ? local : { success: false, error: e.message || 'Recovery failed' };
          }
        };
        return;
      }

      if (key === 'auth_recoverReset') {
        api[prop] = async function (...args) {
          const [secret, username, newPassword] = args;
          const local = await orig.apply(this, args);
          if (local && local.success !== false) return local;
          if (navigator.onLine === false) return local;
          try {
            const cloud = unwrap(await sendRpc(key, args));
            if (cloud && cloud.success !== false) {
              try {
                await seedLocalFromCloud(username, newPassword, null, { username, role: 'owner', full_name: username });
              } catch (_) { /* ignore */ }
              return cloud.data != null ? { success: true, data: cloud.data, fromCloud: true } : cloud;
            }
            return cloud;
          } catch (e) {
            return local.error ? local : { success: false, error: e.message || 'Password reset failed' };
          }
        };
        return;
      }

      if (!WRITE_RE.test(key)) return;
      api[prop] = async function (...args) {
        const res = await orig.apply(this, args);
        if (res && res.success !== false && window.ShopPosOfflineQueue) {
          try {
            await window.ShopPosOfflineQueue.enqueue(key, args);
            if (navigator.onLine !== false) scheduleFlush();
          } catch (_) { /* ignore */ }
        }
        return res;
      };
    });
  }

  window.addEventListener('online', () => {
    setConn('online', 'Back online');
    flushQueue();
  });
  window.addEventListener('offline', () => setConn('offline', 'Offline'));
  window.addEventListener('posAPIReady', () => {
    wrapPosApi();
    setConn(navigator.onLine === false ? 'offline' : 'online');
    setTimeout(() => flushQueue(), 1500);
  });
  if (window.posAPI) wrapPosApi();
  setConn(navigator.onLine === false ? 'offline' : 'online');
})();
