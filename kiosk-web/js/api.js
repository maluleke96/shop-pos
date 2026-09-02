const KioskAPI = {
  rpcUrl: () => (window.__KIOSK_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''),
  async call(method, args = []) {
    const res = await fetch(this.rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || 'Request failed');
    return json.data != null ? json.data : json;
  },
  requestPairing: (meta) => KioskAPI.call('kiosk:requestPairing', [meta]),
  pairingStatus: (code) => KioskAPI.call('kiosk:pairingStatus', [code]),
  catalog: (tok) => KioskAPI.call('kiosk:catalog', [tok]),
  placeOrder: (tok, data) => KioskAPI.call('kiosk:placeOrder', [tok, data]),
  heartbeat: (tok, payload) => KioskAPI.call('kiosk:heartbeat', [tok, payload || {}])
};
