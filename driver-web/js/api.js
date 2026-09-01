const DriverAPI = {
  rpcUrl() {
    const c = window.__DRIVER_CONFIG__ || {};
    return (c.rpcUrl || '/rpc').replace(/\/$/, '');
  },
  token() { return localStorage.getItem('driver_token') || ''; },
  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = this.token();
    if (tok && !method.startsWith('driver:login') && method !== 'delivery:registerDriver') {
      args = [tok, ...args];
    }
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers, body: JSON.stringify({ method, args }) });
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
  tracking: (token) => DriverAPI.call('delivery:tracking', [token])
};
window.DriverAPI = DriverAPI;
