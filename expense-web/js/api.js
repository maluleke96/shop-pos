const ExpenseAPI = {
  _queue: null,

  queue() {
    if (!this._queue && typeof PortalOfflineQueue !== 'undefined') {
      this._queue = new PortalOfflineQueue({
        dbName: 'expense-offline-queue',
        namespace: 'expense',
        isWrite: (m) => /^expenseApp:save$/i.test(String(m || ''))
      });
      this._queue.bind((method, args) => this._callDirect(method, args));
    }
    return this._queue;
  },

  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__EXPENSE_CONFIG__ || {};
    return (c.rpcUrl || 'https://chisafood.up.railway.app/rpc').replace(/\/$/, '');
  },

  token() {
    return localStorage.getItem('expense_token') || sessionStorage.getItem('expense_token') || '';
  },

  async _callDirect(method, args = []) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = this.token();
    const callArgs = [...(args || [])];
    if (tok && method !== 'expenseApp:login') callArgs.unshift(tok);
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
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (/session|expired|not authenticated|permission|deactivated/i.test(msg)) {
        localStorage.removeItem('expense_token');
        sessionStorage.removeItem('expense_token');
        localStorage.removeItem('expense_user');
      }
      throw new Error(msg);
    }
    return json.data != null ? json.data : json;
  },

  async call(method, args = []) {
    const q = this.queue();
    if (q) {
      const out = await q.wrapCall((m, a) => this._callDirect(m, a), method, args);
      if (out && out.__offlineQueued) {
        return { __offlineQueued: true, queued: true, message: 'Saved offline — will sync when online' };
      }
      return out;
    }
    return this._callDirect(method, args);
  },

  login: (u, p, d) => ExpenseAPI.call('expenseApp:login', [u, p, d || {}]),
  logout: () => ExpenseAPI.call('expenseApp:logout', []),
  profile: () => ExpenseAPI.call('expenseApp:profile', []),
  list: (f) => ExpenseAPI.call('expenseApp:list', [f || {}]),
  get: (id) => ExpenseAPI.call('expenseApp:get', [id]),
  save: (d) => ExpenseAPI.call('expenseApp:save', [d || {}]),
  categories: () => ExpenseAPI.call('expenseApp:categories', []),
  settings: () => ExpenseAPI.call('expenseApp:settings', []),
  grantAccess: (d) => ExpenseAPI.call('expenseApp:grantAccess', [d || {}])
};

window.ExpenseAPI = ExpenseAPI;
