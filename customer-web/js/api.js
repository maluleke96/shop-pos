const OrderAPI = {
  rpcUrl: (() => {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const cfg = window.__ORDER_CONFIG__ || {};
    return cfg.rpcUrl || 'https://chisafood.up.railway.app/rpc';
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
  getHoursStatus: () => OrderAPI.call('web:getHoursStatus'),
  getBranches: () => OrderAPI.call('web:getBranches'),
  getMenu: (branchId, filters) => OrderAPI.call('web:getMenu', [branchId, filters || {}]),
  getProduct: (branchId, productId) => OrderAPI.call('web:getProduct', [branchId, productId]),
  checkRegistration: (data) => OrderAPI.call('web:checkRegistration', [data]),
  sendRegistrationCode: (data) => OrderAPI.call('web:sendRegistrationCode', [data]),
  register: (data) => OrderAPI.call('web:register', [data]),
  login: (login, password) => OrderAPI.call('web:login', [login, password]),
  sendPasswordReset: (data) => OrderAPI.call('web:sendPasswordReset', [data || {}]),
  resetPassword: (data) => OrderAPI.call('web:resetPassword', [data || {}]),
  account: (token) => OrderAPI.call('web:account', [token]),
  validateCart: (branchId, cart) => OrderAPI.call('web:validateCart', [branchId, cart]),
  validateCoupon: (code, branchId, cart, customerId) => OrderAPI.call('web:validateCoupon', [code, branchId, cart, customerId]),
  initiateCardPayment: (branchId, amount, token, method) => OrderAPI.call('web:initiateCardPayment', [branchId, amount, token, method || 'card']),
  confirmCardPayment: (intentToken, reference) => OrderAPI.call('web:confirmCardPayment', [intentToken, reference]),
  startOnlinePayment: (orderId, token, opts) => OrderAPI.call('web:startOnlinePayment', [orderId, token, opts || {}]),
  getPaymentStatus: (orderRef, token) => OrderAPI.call('web:getPaymentStatus', [orderRef, token]),
  submitOrder: (branchId, payload, token, idem) => OrderAPI.call('web:submitOrder', [branchId, payload, token, idem]),
  getOrder: (orderId, token) => OrderAPI.call('web:getOrder', [orderId, token]),
  listOrders: (token, limit) => OrderAPI.call('web:listOrders', [token, limit || 50]),
  toggleFavorite: (token, productId, branchId) => OrderAPI.call('web:toggleFavorite', [token, productId, branchId]),
  checkGiftCard: (code, token) => OrderAPI.call('web:checkGiftCard', [code, token]),
  deleteAccount: (token, password) => OrderAPI.call('web:deleteAccount', [token, password]),
  listPublicJobs: () => OrderAPI.call('jobs:listPublicPostings'),
  getPublicJob: (token) => OrderAPI.call('jobs:getPublicPosting', [token]),
  submitPublicJob: (token, data) => OrderAPI.call('jobs:submitPublicApplication', [token, data]),
  submitIssue: (data, token) => OrderAPI.call('web:submitIssue', [data, token]),
  listMyIssues: (token) => OrderAPI.call('web:listMyIssues', [token]),
  trackEvents: (payload) => OrderAPI.call('web:trackEvents', [payload || {}])
};

window.OrderAPI = OrderAPI;
