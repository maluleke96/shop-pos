const StudioAPI = {
  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__STUDIO_CONFIG__ || {};
    return (c.rpcUrl || 'https://chisafood.up.railway.app/rpc').replace(/\/$/, '');
  },

  token() {
    return localStorage.getItem('studio_token') || sessionStorage.getItem('studio_token') || '';
  },

  setToken(tok) {
    if (tok) {
      localStorage.setItem('studio_token', tok);
      sessionStorage.setItem('studio_token', tok);
    } else {
      localStorage.removeItem('studio_token');
      sessionStorage.removeItem('studio_token');
    }
  },

  async call(method, args = []) {
    const headers = { 'Content-Type': 'application/json', 'X-Shop-Source': 'studio-app' };
    const rpcTok = sessionStorage.getItem('shoppos_rpc_session') || localStorage.getItem('shoppos_rpc_session') || '';
    if (rpcTok) headers['X-Session-Token'] = rpcTok;
    const tok = this.token();
    const callArgs = [...(args || [])];
    if (tok && method !== 'studioApp:login') callArgs.unshift(tok);
    let res;
    try {
      res = await fetch(this.rpcUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args: callArgs })
      });
    } catch (_) {
      throw new Error('Cannot reach server. Check your connection and try again.');
    }
    const sessionTok = res.headers.get('X-Session-Token');
    if (sessionTok) {
      try {
        sessionStorage.setItem('shoppos_rpc_session', sessionTok);
        localStorage.setItem('shoppos_rpc_session', sessionTok);
      } catch (_) { /* */ }
    }
    const json = await res.json().catch(() => ({}));
    if (json && json.sessionToken) {
      try {
        sessionStorage.setItem('shoppos_rpc_session', json.sessionToken);
        localStorage.setItem('shoppos_rpc_session', json.sessionToken);
      } catch (_) { /* */ }
    }
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated|permission|revoked|unavailable|deactivated|access not granted|login unsuccessful/i.test(msg)) {
        if (!/incorrect|credentials/i.test(msg)) {
          this.setToken('');
          localStorage.removeItem('studio_user');
        }
      }
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },

  login: (u, p, d) => StudioAPI.call('studioApp:login', [u, p, d || {}]),
  logout: () => StudioAPI.call('studioApp:logout', []),
  profile: () => StudioAPI.call('studioApp:profile', []),
  check: () => StudioAPI.call('studioApp:check', []),
  beginModule: (mod) => StudioAPI.call('studioApp:beginModule', [mod]),
  settings: () => StudioAPI.call('studioApp:settings', [])
};

window.StudioAPI = StudioAPI;
