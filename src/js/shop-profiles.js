/**
 * Multi-shop profiles — for Windows/Android installers that manage several cloud shops.
 *
 * CRITICAL: On a hosted SaaS customer URL (Railway shop), NEVER apply a default
 * Chisa Food cloud profile. The browser origin IS the customer environment.
 * Chisanyama remains a separate environment and must not leak into other shops.
 */
(function (global) {
  const STORAGE_KEY = 'shoppos_shop_profiles';
  const ACTIVE_KEY = 'shoppos_active_shop_profile';
  // Installer-only fallback when no profile exists yet. Prefer empty so users
  // must enter their own shop URL — never silently bind SaaS customers to Chisa.
  const DEFAULT_CLOUD = '';

  function isHostedCustomerApp() {
    try {
      if (global.__SHOP_POS_LOCAL_INSTALLER__) return false;
      if (String(location.protocol || '') === 'file:') return false;
      const host = String(location.hostname || '');
      if (!host || host === 'localhost' || host === '127.0.0.1') return false;
      // Chisa Food's own hosted app may keep multi-shop profiles for branches.
      if (/chisafood|chisanyama/i.test(host)) return false;
      const proto = String(location.protocol || '');
      return proto === 'http:' || proto === 'https:';
    } catch (_) {
      return false;
    }
  }

  function currentOriginBase() {
    try {
      if (location.origin && !String(location.origin).startsWith('file:')) {
        return String(location.origin).replace(/\/$/, '');
      }
    } catch (_) { /* */ }
    return '';
  }

  function readProfiles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function writeProfiles(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 20)));
  }

  function ensureDefault() {
    // Hosted SaaS customer apps: no Chisa default profile — origin is the shop.
    if (isHostedCustomerApp()) return [];
    let list = readProfiles();
    if (!list.length) {
      // Empty installer profile list — do not seed Chisa Food.
      return [];
    }
    return list;
  }

  function getActiveId() {
    const list = ensureDefault();
    if (!list.length) return '';
    return localStorage.getItem(ACTIVE_KEY) || list[0]?.id || '';
  }

  function getActiveProfile() {
    if (isHostedCustomerApp()) {
      const base = currentOriginBase();
      return base ? { id: 'origin', name: 'This shop', cloudUrl: base } : null;
    }
    const list = ensureDefault();
    if (!list.length) return null;
    const id = getActiveId();
    return list.find((p) => p.id === id) || list[0] || null;
  }

  function setActive(id) {
    if (isHostedCustomerApp()) return getActiveProfile();
    const list = ensureDefault();
    if (!list.some((p) => p.id === id)) return null;
    localStorage.setItem(ACTIVE_KEY, id);
    try {
      const profile = list.find((p) => p.id === id);
      if (profile?.cloudUrl && global.__SHOP_POS_ENV__) {
        global.__SHOP_POS_ENV__.SHOP_POS_SYNC_URL = profile.cloudUrl;
        global.__SHOP_POS_ENV__.SHOP_POS_CLOUD_URL = profile.cloudUrl;
        global.__SHOP_POS_ENV__.RPC_URL = profile.cloudUrl.replace(/\/$/, '') + '/rpc';
        global.__SHOP_POS_ENV__.SHOP_POS_RPC_URL = global.__SHOP_POS_ENV__.RPC_URL;
      }
    } catch (_) { /* ignore */ }
    return getActiveProfile();
  }

  function saveProfile(data) {
    if (isHostedCustomerApp()) return null;
    const list = ensureDefault();
    const id = data.id || `shop-${Date.now()}`;
    const cloudUrl = String(data.cloudUrl || DEFAULT_CLOUD || currentOriginBase()).replace(/\/$/, '');
    if (!cloudUrl) throw new Error('Cloud URL is required');
    if (/chisafood\.up\.railway\.app/i.test(cloudUrl) && !/chisa/i.test(String(data.name || ''))) {
      // Allow explicit Chisa only when named as such — never accidental default for other shops
    }
    const entry = {
      id,
      name: String(data.name || 'My Shop').trim() || 'My Shop',
      cloudUrl,
      updated_at: new Date().toISOString()
    };
    const idx = list.findIndex((p) => p.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.push({ ...entry, created_at: entry.updated_at });
    writeProfiles(list);
    return entry;
  }

  function deleteProfile(id) {
    if (isHostedCustomerApp()) return false;
    let list = readProfiles().filter((p) => p.id !== id);
    writeProfiles(list);
    if (getActiveId() === id) {
      if (list[0]) setActive(list[0].id);
      else localStorage.removeItem(ACTIVE_KEY);
    }
    return true;
  }

  function sessionKey(panel) {
    const pid = getActiveId() || 'origin';
    const panelId = String(panel || 'main').toLowerCase();
    return `shoppos_${pid}_${panelId}_session`;
  }

  function clearPanelSessions() {
    const pid = getActiveId() || 'origin';
    const prefix = `shoppos_${pid}_`;
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith(prefix) && k.endsWith('_session')) localStorage.removeItem(k);
      });
      Object.keys(sessionStorage).forEach((k) => {
        if (k.startsWith(prefix) || k === 'order_token' || k === 'order_branch') sessionStorage.removeItem(k);
      });
    } catch (_) { /* ignore */ }
  }

  function applyToEnv() {
    if (!global.__SHOP_POS_ENV__) global.__SHOP_POS_ENV__ = {};

    // Hosted SaaS customer: always bind RPC to this origin — never Chisa Food.
    if (isHostedCustomerApp()) {
      const base = currentOriginBase();
      if (base) {
        global.__SHOP_POS_ENV__.SHOP_POS_SYNC_URL = base;
        global.__SHOP_POS_ENV__.SHOP_POS_CLOUD_URL = base;
        global.__SHOP_POS_ENV__.SHOP_POS_PUBLIC_URL = base;
        global.__SHOP_POS_ENV__.RPC_URL = base + '/rpc';
        global.__SHOP_POS_ENV__.SHOP_POS_RPC_URL = base + '/rpc';
      }
      return getActiveProfile();
    }

    const p = getActiveProfile();
    if (!p?.cloudUrl) return p;
    const base = p.cloudUrl.replace(/\/$/, '');
    global.__SHOP_POS_ENV__.SHOP_POS_SYNC_URL = base;
    global.__SHOP_POS_ENV__.SHOP_POS_CLOUD_URL = base;
    global.__SHOP_POS_ENV__.RPC_URL = base + '/rpc';
    global.__SHOP_POS_ENV__.SHOP_POS_RPC_URL = base + '/rpc';
    return p;
  }

  const ShopProfiles = {
    DEFAULT_CLOUD,
    isHostedCustomerApp,
    list: ensureDefault,
    getActive: getActiveProfile,
    getActiveId,
    setActive,
    save: saveProfile,
    remove: deleteProfile,
    sessionKey,
    clearPanelSessions,
    applyToEnv
  };

  applyToEnv();
  global.ShopProfiles = ShopProfiles;
})(typeof window !== 'undefined' ? window : global);
