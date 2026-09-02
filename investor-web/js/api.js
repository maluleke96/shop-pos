const InvestorAPI = {
  rpcUrl() {
    const c = window.__INVESTOR_CONFIG__ || {};
    return (c.rpcUrl || '/rpc').replace(/\/$/, '');
  },
  token() { return localStorage.getItem('investor_token') || ''; },
  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = this.token();
    if (tok && method !== 'investor:login') args = [tok, ...args];
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated/i.test(msg)) localStorage.removeItem('investor_token');
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },
  login: (u, p) => InvestorAPI.call('investor:login', [u, p]),
  logout: () => InvestorAPI.call('investor:logout', []),
  dashboard: () => InvestorAPI.call('investor:dashboard', [])
};
window.InvestorAPI = InvestorAPI;
