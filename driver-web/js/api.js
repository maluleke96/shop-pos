const DriverAPI = {
  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__DRIVER_CONFIG__ || {};
    return (c.rpcUrl || 'https://chisafood.up.railway.app/rpc').replace(/\/$/, '');
  },
  token() { return localStorage.getItem('driver_token') || ''; },
  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = this.token();
    if (tok && !method.startsWith('driver:login') && method !== 'delivery:registerDriver') {
      args = [tok, ...args];
    }
    let res;
    try {
      res = await fetch(this.rpcUrl(), { method: 'POST', headers, body: JSON.stringify({ method, args }) });
    } catch (_) {
      throw new Error('Cannot reach server. Check your connection and try again.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated/i.test(msg)) {
        localStorage.removeItem('driver_token');
      }
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },
  login: (u, p, d) => DriverAPI.call('driver:login', [u, p, d || {}]),
  logout: () => DriverAPI.call('driver:logout', []),
  dashboard: () => DriverAPI.call('driver:dashboard', []),
  orders: (f) => DriverAPI.call('driver:orders', [f || {}]),
  accept: (id) => DriverAPI.call('driver:accept', [id]),
  reject: (id, reason) => DriverAPI.call('driver:reject', [id, reason || '']),
  updateStatus: (id, status, notes) => DriverAPI.call('driver:updateStatus', [id, status, notes || '']),
  availability: (a) => DriverAPI.call('driver:availability', [a]),
  register: (d) => DriverAPI.call('delivery:registerDriver', [d]),
  history: (limit) => DriverAPI.call('driver:history', [limit || 50]),
  tracking: (token) => DriverAPI.call('delivery:tracking', [token])
};
window.DriverAPI = DriverAPI;
