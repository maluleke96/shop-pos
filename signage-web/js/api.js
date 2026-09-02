const SignageAPI = {
  rpcUrl() { return (window.__SIGNAGE_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''); },
  token() { return localStorage.getItem('signage_token') || ''; },
  async call(method, args = []) {
    const tok = this.token();
    if (tok && method !== 'signage:login' && method !== 'signage:requestPairing' && method !== 'signage:pairingStatus') {
      args = [tok, ...args];
    }
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated/i.test(msg)) localStorage.removeItem('signage_token');
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },
  login: (u, p) => SignageAPI.call('signage:login', [u, p]),
  logout: () => SignageAPI.call('signage:logout', []),
  dashboard: () => SignageAPI.call('signage:dashboard', []),
  pendingPairings: () => SignageAPI.call('signage:pendingPairings', []),
  approvePairing: (code, data) => SignageAPI.call('signage:approvePairing', [code, data]),
  rejectPairing: (code) => SignageAPI.call('signage:rejectPairing', [code]),
  listMedia: (f) => SignageAPI.call('signage:listMedia', [f || {}]),
  uploadMedia: (d) => SignageAPI.call('signage:uploadMedia', [d]),
  listPlaylists: () => SignageAPI.call('signage:listPlaylists', []),
  savePlaylist: (d) => SignageAPI.call('signage:savePlaylist', [d]),
  listMenus: () => SignageAPI.call('signage:listMenus', []),
  saveMenu: (d) => SignageAPI.call('signage:saveMenu', [d]),
  syncMenuFromProducts: (id) => SignageAPI.call('signage:syncMenuFromProducts', [id]),
  publish: (d) => SignageAPI.call('signage:publish', [d]),
  remoteCommand: (deviceId, cmd, payload) => SignageAPI.call('signage:remoteCommand', [deviceId, cmd, payload || {}]),
  playNowAnnouncement: (id) => SignageAPI.call('signage:playNowAnnouncement', [id]),
  generateAiVoice: (text) => SignageAPI.call('signage:generateAiVoice', [text]),
  saveAnnouncement: (d) => SignageAPI.call('signage:saveAnnouncement', [d]),
  saveScreenGroup: (d) => SignageAPI.call('signage:saveScreenGroup', [d]),
  revokeDevice: (id) => SignageAPI.call('signage:revokeDevice', [id])
};
window.SignageAPI = SignageAPI;
