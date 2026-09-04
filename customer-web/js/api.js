const OrderAPI = {
  rpcUrl: (() => {
    const cfg = window.__ORDER_CONFIG__ || {};
    if (cfg.rpcUrl) return cfg.rpcUrl;
    // Same Railway host when served from /order/
    if (location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    return 'https://chisafood.up.railway.app/rpc';
  })(),

  async call(method, args = []) {
    let res;
    try {
      res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shop-Source': 'customer-web'
        },
        body: JSON.stringify({ method, args })
      });
    } catch (err) {
      throw new Error('Cannot reach ordering server. Check your connection and try again.');
    }
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) { /* */ }
    if (!res.ok || !json.success) {
      const msg = json.error || (res.status === 404 ? 'Ordering service is updating — please try again shortly.' : `Request failed (${res.status})`);
      throw new Error(msg);
    }
    return json.data;
  },

  getSettings: () => OrderAPI.call('web:getSettings'),
  getBranches: () => OrderAPI.call('web:getBranches'),
  getMenu: (branchId, filters) => OrderAPI.call('web:getMenu', [branchId, filters || {}]),
  getProduct: (branchId, productId) => OrderAPI.call('web:getProduct', [branchId, productId]),
  register: (data) => OrderAPI.call('web:register', [data]),
  login: (login, password) => OrderAPI.call('web:login', [login, password]),
  account: (token) => OrderAPI.call('web:account', [token]),
  validateCart: (branchId, cart) => OrderAPI.call('web:validateCart', [branchId, cart]),
  validateCoupon: (code, branchId, cart, customerId) => OrderAPI.call('web:validateCoupon', [code, branchId, cart, customerId]),
  submitOrder: (branchId, payload, token, idem) => OrderAPI.call('web:submitOrder', [branchId, payload, token, idem]),
  getOrder: (orderId, token) => OrderAPI.call('web:getOrder', [orderId, token]),
  listOrders: (token, limit) => OrderAPI.call('web:listOrders', [token, limit || 50]),
  toggleFavorite: (token, productId, branchId) => OrderAPI.call('web:toggleFavorite', [token, productId, branchId]),
  checkGiftCard: (code) => OrderAPI.call('web:checkGiftCard', [code]),
  deleteAccount: (token) => OrderAPI.call('web:deleteAccount', [token])
};

window.OrderAPI = OrderAPI;
