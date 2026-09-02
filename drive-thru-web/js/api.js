const DriveThruAPI = {
  rpcUrl: () => (window.__DRIVE_THRU_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''),
  portalToken: () => localStorage.getItem('dt_portal_token') || '',
  stationToken: () => localStorage.getItem('dt_station_token') || '',
  async call(method, args = []) {
    const noPortal = ['driveThru:login', 'driveThru:stationHeartbeat', 'driveThru:catalog', 'driveThru:getAudioConfig', 'driveThru:saveAudioConfig', 'driveThru:postAudioSignal', 'driveThru:pollAudioSignals'];
    const tok = this.portalToken();
    if (tok && !noPortal.includes(method)) {
      args = [tok, ...args];
    }
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || 'Request failed');
    return json.data != null ? json.data : json;
  },
  login: (u, p) => DriveThruAPI.call('driveThru:login', [u, p]),
  catalog: () => DriveThruAPI.call('driveThru:catalog', [DriveThruAPI.stationToken()]),
  stationLogin: () => DriveThruAPI.call('driveThru:stationLogin', [DriveThruAPI.stationToken()]),
  stationHeartbeat: (p) => DriveThruAPI.call('driveThru:stationHeartbeat', [DriveThruAPI.stationToken(), p]),
  startOrder: () => DriveThruAPI.call('driveThru:startOrder', [DriveThruAPI.stationToken()]),
  updateOrder: (id, data) => DriveThruAPI.call('driveThru:updateOrder', [id, data]),
  confirmOrder: (id) => DriveThruAPI.call('driveThru:confirmOrder', [id]),
  takePayment: (id, data) => DriveThruAPI.call('driveThru:takePayment', [id, data]),
  markReady: (id) => DriveThruAPI.call('driveThru:markReady', [id]),
  markCollected: (id) => DriveThruAPI.call('driveThru:markCollected', [id]),
  cancelOrder: (id, reason) => DriveThruAPI.call('driveThru:cancelOrder', [id, reason]),
  getAudioConfig: () => DriveThruAPI.call('driveThru:getAudioConfig', [DriveThruAPI.stationToken()]),
  saveAudioConfig: (cfg) => DriveThruAPI.call('driveThru:saveAudioConfig', [DriveThruAPI.stationToken(), cfg]),
  postAudioSignal: (type, payload) => DriveThruAPI.call('driveThru:postAudioSignal', [DriveThruAPI.stationToken(), type, payload])
};
