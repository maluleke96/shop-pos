const KioskAPI = {
  rpcUrl: () => (window.__KIOSK_CONFIG__?.rpcUrl || '/rpc').replace(/\/$/, ''),
  async call(method, args = [], timeoutMs = 15000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(this.rpcUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args }), signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      const err = new Error(e?.name === 'AbortError' ? 'The server took too long to answer' : 'Cannot reach the server');
      err.network = true;
      err.timeout = e?.name === 'AbortError';
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const err = new Error(json.error || 'Request failed');
      err.network = res.status >= 502 && res.status <= 504;
      throw err;
    }
    return json.data != null ? json.data : json;
  },
  requestPairing: (meta) => KioskAPI.call('kiosk:requestPairing', [meta]),
  pairingStatus: (code) => KioskAPI.call('kiosk:pairingStatus', [code]),
  catalog: (tok) => KioskAPI.call('kiosk:catalog', [tok]),
  placeOrder: (tok, data) => KioskAPI.call('kiosk:placeOrder', [tok, data], 25000),
  validateVoucher: (tok, code, opts) => KioskAPI.call('kiosk:validateVoucher', [tok, code, opts || {}]),
  heartbeat: (tok, payload) => KioskAPI.call('kiosk:heartbeat', [tok, payload || {}], 10000),
  reportErrors: (tok, errors) => KioskAPI.call('kiosk:reportErrors', [tok, errors || []], 10000),
  customerLogin: (deviceTok, login, password) => KioskAPI.call('kiosk:customerLogin', [deviceTok, login, password]),
  customerBenefits: (deviceTok, webToken) => KioskAPI.call('kiosk:customerBenefits', [deviceTok, webToken]),
  validateCoupon: (deviceTok, code, opts, webToken) => KioskAPI.call('kiosk:validateCoupon', [deviceTok, code, opts || {}, webToken]),
  checkGiftCard: (deviceTok, code) => KioskAPI.call('kiosk:checkGiftCard', [deviceTok, code])
};
