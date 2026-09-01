const ReferralAPI = {
  rpcUrl() {
    const c = window.__REFERRAL_CONFIG__ || {};
    return (c.rpcUrl || '/rpc').replace(/\/$/, '');
  },

  async rpc(method, args = []) {
    const r = await fetch(`${this.rpcUrl()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args })
    });
    return r.json();
  },

  getPublicAgent(code) {
    return this.rpc('mktp:publicAgent', [code]);
  },

  recordClick(code, meta = {}) {
    return this.rpc('mktp:recordClick', [code, meta]);
  }
};
