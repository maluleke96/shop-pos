/** Shared RPC client for Kitchen Display + Customer Order Display device mode. */
const OpsDisplayClient = {
  storageKey: 'shoppos_ops_display_token',
  deviceType: 'cds',

  rpcUrl() {
    return (window.__OPS_DISPLAY_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, '');
  },

  getToken() {
    try { return localStorage.getItem(this.storageKey) || ''; } catch (_) { return ''; }
  },

  setToken(tok) {
    try {
      if (tok) localStorage.setItem(this.storageKey, tok);
      else localStorage.removeItem(this.storageKey);
    } catch (_) { /* */ }
  },

  async call(method, args = [], timeoutMs = 20000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(this.rpcUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args }),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      const err = new Error(e?.name === 'AbortError' ? 'Server timeout' : 'Cannot reach server');
      err.network = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || 'Request failed');
    return json.data != null ? json.data : json;
  },

  requestPairing(type) {
    const t = type || this.deviceType;
    return this.call('opsDisplay:requestPairing', [t, { platform: navigator.platform, ua: navigator.userAgent }]);
  },

  pairingStatus(code) {
    return this.call('opsDisplay:pairingStatus', [code]);
  },

  heartbeat(payload) {
    const tok = this.getToken();
    if (!tok) return Promise.resolve(null);
    return this.call('opsDisplay:heartbeat', [tok, payload || {}]);
  },

  loadConfig() {
    const tok = this.getToken();
    if (!tok) return Promise.resolve(null);
    return this.call('opsDisplay:config', [tok]);
  },

  loadOrders(status) {
    const tok = this.getToken();
    if (!tok) throw new Error('Device not paired');
    return this.call('opsDisplay:orders', [tok, status || 'pending,preparing,ready,collection']);
  }
};

window.OpsDisplayClient = OpsDisplayClient;
