const ReleaseAPI = {
  rpcUrl() {
    const c = window.__RELEASE_CONFIG__ || {};
    return (c.rpcUrl || '/rpc').replace(/\/$/, '');
  },
  token() { return localStorage.getItem('release_token') || ''; },
  async call(method, args = []) {
    const tok = this.token();
    if (tok && method !== 'release:login') args = [tok, ...args];
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated/i.test(msg)) localStorage.removeItem('release_token');
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },
  login: (u, p) => ReleaseAPI.call('release:login', [u, p]),
  logout: () => ReleaseAPI.call('release:logout', []),
  dashboard: () => ReleaseAPI.call('release:dashboard', []),
  runTests: (verId) => ReleaseAPI.call('release:runTests', [verId || null]),
  createVersion: (d) => ReleaseAPI.call('release:createVersion', [d]),
  approve: (verId, confirm) => ReleaseAPI.call('release:approve', [verId, !!confirm]),
  publish: (verId, confirm) => ReleaseAPI.call('release:publish', [verId, !!confirm])
};
window.ReleaseAPI = ReleaseAPI;
