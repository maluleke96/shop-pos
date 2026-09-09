const DriverAPI = {
  _queue: null,

  queue() {
    if (!this._queue && typeof PortalOfflineQueue !== 'undefined') {
      this._queue = new PortalOfflineQueue({
        dbName: 'driver-offline-queue',
        namespace: 'driver',
        isWrite: (m) => /^driver:(accept|reject|release|updateStatus|availability|submitClaim|updateProfile)$/i.test(String(m || ''))
      });
      this._queue.bind((method, args) => this._callDirect(method, args));
    }
    return this._queue;
  },

  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__DRIVER_CONFIG__ || {};
    return (c.rpcUrl || 'https://chisafood.up.railway.app/rpc').replace(/\/$/, '');
  },

  token() { return localStorage.getItem('driver_token') || ''; },

  async _callDirect(method, args = []) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = this.token();
    const callArgs = [...(args || [])];
    if (tok && !method.startsWith('driver:login') && method !== 'delivery:registerDriver') {
      callArgs.unshift(tok);
    }
    let res;
    try {
      res = await fetch(this.rpcUrl(), { method: 'POST', headers, body: JSON.stringify({ method, args: callArgs }) });
    } catch (_) {
      throw new Error('Cannot reach server. Check your connection and try again.');
    }
    const json = await res.json().catch(() => {});
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated/i.test(msg)) {
        localStorage.removeItem('driver_token');
      }
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },

  async call(method, args = []) {
    const q = this.queue();
    if (q) {
      const out = await q.wrapCall((m, a) => this._callDirect(m, a), method, args);
      if (out && out.__offlineQueued) {
        return { __offlineQueued: true, queued: true, message: 'Saved offline — will sync when online' };
      }
      return out;
    }
    return this._callDirect(method, args);
  },

  login: (u, p, d) => DriverAPI.call('driver:login', [u, p, d || {}]),
  recoverPassword: (identifier) => DriverAPI.call('auth:recoverDriverPassword', [identifier]),
  logout: () => DriverAPI.call('driver:logout', []),
  dashboard: () => DriverAPI.call('driver:dashboard', []),
  orders: (f) => DriverAPI.call('driver:orders', [f || {}]),
  accept: (id) => DriverAPI.call('driver:accept', [id]),
  reject: (id, reason) => DriverAPI.call('driver:reject', [id, reason || '']),
  release: (id, reason) => DriverAPI.call('driver:release', [id, reason || '']),
  updateStatus: (id, status, notes) => DriverAPI.call('driver:updateStatus', [id, status, notes || '']),
  availability: (a) => DriverAPI.call('driver:availability', [a]),
  register: (d) => DriverAPI.call('delivery:registerDriver', [d]),
  submitClaim: () => DriverAPI.call('driver:submitClaim', []),
  history: (filters) => DriverAPI.call('driver:history', [filters || {}]),
  earnings: (filters) => DriverAPI.call('driver:earnings', [filters || {}]),
  payments: (f) => DriverAPI.call('driver:payments', [f || {}]),
  payoutDetail: (id) => DriverAPI.call('driver:payoutDetail', [id]),
  payoutPdf: (id) => DriverAPI.call('driver:payoutPdf', [id]),
  profile: () => DriverAPI.call('driver:profile', []),
  updateProfile: (data) => DriverAPI.call('driver:updateProfile', [data || {}]),
  tracking: (token) => DriverAPI.call('delivery:tracking', [token])
};
window.DriverAPI = DriverAPI;
