/**
 * Multi-shop profiles — run several shops on one computer without mixing sessions.
 * Each profile stores its own cloud URL; panel apps use separate session keys per profile.
 */
(function (global) {
  const STORAGE_KEY = 'shoppos_shop_profiles';
  const ACTIVE_KEY = 'shoppos_active_shop_profile';
  const DEFAULT_CLOUD = 'https://chisafood.up.railway.app';

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
    let list = readProfiles();
    if (!list.length) {
      list = [{
        id: 'default',
        name: 'Chisa Food',
        cloudUrl: DEFAULT_CLOUD,
        created_at: new Date().toISOString()
      }];
      writeProfiles(list);
      localStorage.setItem(ACTIVE_KEY, 'default');
    }
    return list;
  }

  function getActiveId() {
    ensureDefault();
    return localStorage.getItem(ACTIVE_KEY) || readProfiles()[0]?.id || 'default';
  }

  function getActiveProfile() {
    const list = ensureDefault();
    const id = getActiveId();
    return list.find((p) => p.id === id) || list[0];
  }

  function setActive(id) {
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
    const list = ensureDefault();
    const id = data.id || `shop-${Date.now()}`;
    const cloudUrl = String(data.cloudUrl || DEFAULT_CLOUD).replace(/\/$/, '');
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
    if (id === 'default') return false;
    let list = readProfiles().filter((p) => p.id !== id);
    if (!list.length) list = ensureDefault();
    writeProfiles(list);
    if (getActiveId() === id) setActive(list[0].id);
    return true;
  }

  /** Session keys scoped per shop + panel so admin/POS/driver don't clash on one PC. */
  function sessionKey(panel) {
    const pid = getActiveId();
    const panelId = String(panel || 'main').toLowerCase();
    return `shoppos_${pid}_${panelId}_session`;
  }

  function clearPanelSessions() {
    const pid = getActiveId();
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
    const p = getActiveProfile();
    if (!p?.cloudUrl) return p;
    const base = p.cloudUrl.replace(/\/$/, '');
    if (!global.__SHOP_POS_ENV__) global.__SHOP_POS_ENV__ = {};
    global.__SHOP_POS_ENV__.SHOP_POS_SYNC_URL = base;
    global.__SHOP_POS_ENV__.SHOP_POS_CLOUD_URL = base;
    global.__SHOP_POS_ENV__.RPC_URL = base + '/rpc';
    global.__SHOP_POS_ENV__.SHOP_POS_RPC_URL = base + '/rpc';
    return p;
  }

  const ShopProfiles = {
    DEFAULT_CLOUD,
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
