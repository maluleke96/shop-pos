const ManagerAPI = {
  rpcUrl: (() => {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const cfg = window.__MANAGER_CONFIG__ || {};
    return cfg.rpcUrl || 'https://chisafood.up.railway.app/rpc';
  })(),

  token() { return sessionStorage.getItem('manager_token') || ''; },

  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json', 'X-Shop-Source': 'manager-app' };
    const tok = this.token();
    const skipToken = method === 'mobile:login' || method.startsWith('notifications:') || method === 'web:getSettings';
    if (tok && !skipToken) args = [tok, ...args];
    let res;
    try {
      res = await fetch(this.rpcUrl, { method: 'POST', headers, body: JSON.stringify({ method, args }) });
    } catch (_) {
      throw new Error('Cannot reach server. Check your connection.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|revoked|deactivated|not authenticated/i.test(msg)) {
        sessionStorage.removeItem('manager_token');
        sessionStorage.removeItem('manager_user');
      }
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },

  login: (username, password, device) => ManagerAPI.call('mobile:login', [username, password, device]),
  logout: () => ManagerAPI.call('mobile:logout', []),
  profile: () => ManagerAPI.call('mobile:profile', []),
  dashboard: (filters) => ManagerAPI.call('mobile:dashboard', [filters || {}]),
  orders: (filters) => ManagerAPI.call('mobile:orders', [filters || {}]),
  onlineOrders: (filters) => ManagerAPI.call('mobile:onlineOrders', [filters || {}]),
  order: (id) => ManagerAPI.call('mobile:order', [id]),
  searchOrders: (q) => ManagerAPI.call('mobile:searchOrders', [q || {}]),
  staffActivity: (filters) => ManagerAPI.call('mobile:staffActivity', [filters || {}]),
  posStatus: () => ManagerAPI.call('mobile:posStatus', []),
  alerts: (opts) => ManagerAPI.call('mobile:alerts', [typeof opts === 'object' ? opts : { limit: opts || 50 }]),
  markRead: (ids) => ManagerAPI.call('mobile:markRead', [ids || []]),
  getPrefs: () => ManagerAPI.call('mobile:getPrefs', []),
  savePrefs: (prefs) => ManagerAPI.call('mobile:savePrefs', [prefs]),
  registerPush: (token) => ManagerAPI.call('mobile:registerPush', [token]),
  poll: (sinceId) => ManagerAPI.call('mobile:poll', [sinceId || 0]),
  pendingOnline: (filters) => ManagerAPI.call('mobile:onlineOrders', [{ ...(filters || {}), live_pending: true, limit: 30 }])
};

window.ManagerAPI = ManagerAPI;
