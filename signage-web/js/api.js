const SignageAPI = {
  rpcUrl() { return (window.__SIGNAGE_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''); },
  token() { return localStorage.getItem('signage_token') || ''; },
  async call(method, args = []) {
    const tok = this.token();
    const noTok = ['signage:login', 'signage:requestPairing', 'signage:pairingStatus', 'signage:runTests'];
    if (tok && !noTok.includes(method)) args = [tok, ...args];
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
  listDevices: () => SignageAPI.call('signage:listDevices', []),
  saveDevice: (d) => SignageAPI.call('signage:saveDevice', [d]),
  revokeDevice: (id) => SignageAPI.call('signage:revokeDevice', [id]),
  listMedia: (f) => SignageAPI.call('signage:listMedia', [f || {}]),
  uploadMedia: (d) => SignageAPI.call('signage:uploadMedia', [d]),
  deleteMedia: (id) => SignageAPI.call('signage:deleteMedia', [id]),
  tryThumbnail: (id) => SignageAPI.call('signage:tryThumbnail', [id]),
  listPlaylists: () => SignageAPI.call('signage:listPlaylists', []),
  getPlaylist: (id) => SignageAPI.call('signage:getPlaylist', [id]),
  savePlaylist: (d) => SignageAPI.call('signage:savePlaylist', [d]),
  previewPlaylist: (id, audioId) => SignageAPI.call('signage:previewPlaylist', [id, audioId]),
  listMenus: () => SignageAPI.call('signage:listMenus', []),
  getMenu: (id) => SignageAPI.call('signage:getMenu', [id]),
  saveMenu: (d) => SignageAPI.call('signage:saveMenu', [d]),
  syncMenuFromProducts: (id) => SignageAPI.call('signage:syncMenuFromProducts', [id]),
  listAudioPlaylists: () => SignageAPI.call('signage:listAudioPlaylists', []),
  saveAudioPlaylist: (d) => SignageAPI.call('signage:saveAudioPlaylist', [d]),
  listScreenGroups: () => SignageAPI.call('signage:listScreenGroups', []),
  saveScreenGroup: (d) => SignageAPI.call('signage:saveScreenGroup', [d]),
  listSchedules: () => SignageAPI.call('signage:listSchedules', []),
  saveSchedule: (d) => SignageAPI.call('signage:saveSchedule', [d]),
  deleteSchedule: (id) => SignageAPI.call('signage:deleteSchedule', [id]),
  publish: (d) => SignageAPI.call('signage:publish', [d]),
  publicationStatus: (id) => SignageAPI.call('signage:publicationStatus', [id]),
  publishEmergency: (d) => SignageAPI.call('signage:publishEmergency', [d]),
  cancelEmergency: (targetType, targetIds) => SignageAPI.call('signage:cancelEmergency', [targetType, targetIds]),
  remoteCommand: (deviceId, cmd, payload) => SignageAPI.call('signage:remoteCommand', [deviceId, cmd, payload || {}]),
  getDeviceDiagnostics: (id) => SignageAPI.call('signage:getDeviceDiagnostics', [id]),
  playNowAnnouncement: (id) => SignageAPI.call('signage:playNowAnnouncement', [id]),
  generateAiVoice: (text) => SignageAPI.call('signage:generateAiVoice', [text]),
  saveAnnouncement: (d) => SignageAPI.call('signage:saveAnnouncement', [d]),
  listAuditLogs: (limit) => SignageAPI.call('signage:listAuditLogs', [limit || 100]),
  runTests: () => SignageAPI.call('signage:runTests', []),
  settings: () => SignageAPI.call('signage:settings', []),
  saveSettings: (d) => SignageAPI.call('signage:saveSettings', [d])
};
window.SignageAPI = SignageAPI;
