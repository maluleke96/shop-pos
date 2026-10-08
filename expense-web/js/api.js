/** Writes that may be queued offline; each carries a client_request_id so the server never records them twice. */
const EXPENSE_WRITE_RE = /^expenseApp:(save|recordOwnerFunding|recordWithdrawal|wasteRecord|stockBatchCreate)$/i;

const ExpenseAPI = {
  _queue: null,
  _legacyQueue: null,

  /** Each queued row stores the token of the user who captured it, so it syncs under that user. */
  queue() {
    if (!this._queue && typeof PortalOfflineQueue !== 'undefined') {
      this._queue = new PortalOfflineQueue({
        dbName: 'expense-offline-queue',
        namespace: 'expense-v2',
        isWrite: (m) => EXPENSE_WRITE_RE.test(String(m || ''))
      });
      this._queue.bind((method, args) => this._flushCall(method, args));
      this._legacyQueue = new PortalOfflineQueue({ dbName: 'expense-offline-queue', namespace: 'expense', isWrite: () => false });
      this._legacyQueue.bind((method, args) => this._callDirect(method, args));
    }
    return this._queue;
  },

  async pendingCount() {
    const q = this.queue();
    if (!q) return 0;
    try { return await q.pendingCount(); } catch (_) { return 0; }
  },

  async flushQueue() {
    const q = this.queue();
    if (!q || !navigator.onLine) return { flushed: 0 };
    return q.flush((method, args) => this._flushCall(method, args));
  },

  /** Network problems keep the item queued; a server rejection is moved to the failed list so it can't block the queue. */
  async _flushCall(method, args) {
    try {
      return await this._callDirect(method, args, { tokenIncluded: true });
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/reach server|network|failed to fetch/i.test(msg)) throw err;
      try {
        const failed = JSON.parse(localStorage.getItem('expense_sync_failed') || '[]');
        const data = (args || [])[1] && typeof args[1] === 'object' ? args[1] : {};
        failed.unshift({
          method,
          error: msg.slice(0, 200),
          amount: data.amount || null,
          summary: String(data.description || data.notes || data.purpose || data.reason || '').slice(0, 80),
          at: new Date().toISOString()
        });
        localStorage.setItem('expense_sync_failed', JSON.stringify(failed.slice(0, 30)));
        window.dispatchEvent(new CustomEvent('expense-sync-failed', { detail: { method, error: msg } }));
      } catch (_) { /* */ }
      return { __syncFailed: true };
    }
  },

  syncFailures() {
    try { return JSON.parse(localStorage.getItem('expense_sync_failed') || '[]'); } catch (_) { return []; }
  },

  clearSyncFailures() {
    localStorage.removeItem('expense_sync_failed');
  },

  setSession(token, user) {
    sessionStorage.setItem('expense_token', token || '');
    sessionStorage.setItem('expense_user', JSON.stringify(user || null));
    localStorage.removeItem('expense_token');
    localStorage.removeItem('expense_user');
  },

  clearSession() {
    sessionStorage.removeItem('expense_token');
    sessionStorage.removeItem('expense_user');
    localStorage.removeItem('expense_token');
    localStorage.removeItem('expense_user');
  },

  sessionUser() {
    try { return JSON.parse(sessionStorage.getItem('expense_user') || 'null'); } catch (_) { return null; }
  },

  /** Bundled Android app serves pages from https://localhost, so the server URL must come from config. */
  isBundledApp() {
    return typeof window !== 'undefined' && !!window.Capacitor
      && typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname || '');
  },

  rpcUrl() {
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:') && !this.isBundledApp()) {
      return `${location.origin.replace(/\/$/, '')}/rpc`;
    }
    const c = window.__EXPENSE_CONFIG__ || {};
    return (c.rpcUrl || 'https://chisafood.up.railway.app/rpc').replace(/\/$/, '');
  },

  token() {
    return sessionStorage.getItem('expense_token') || '';
  },

  async _callDirect(method, args = [], opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const callArgs = [...(args || [])];
    if (!opts.tokenIncluded) {
      const tok = this.token();
      if (tok && method !== 'expenseApp:login') callArgs.unshift(tok);
    }
    let res;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), EXPENSE_WRITE_RE.test(method) ? 90000 : 30000) : null;
    try {
      res = await fetch(this.rpcUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args: callArgs }),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (_) {
      throw new Error('Cannot reach server. Check your connection and try again.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status >= 502 && res.status <= 504) {
      throw new Error('Cannot reach server (gateway busy). Check your connection and try again.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.error || `Request failed (${res.status})`;
      if (!opts.tokenIncluded && /session|expired|not authenticated|deactivated/i.test(msg)) {
        this.clearSession();
      }
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    return json.data != null ? json.data : json;
  },

  async call(method, args = []) {
    const q = this.queue();
    if (q && EXPENSE_WRITE_RE.test(String(method || ''))) {
      const tok = this.token();
      const stamped = [...(args || [])];
      if (stamped[0] && typeof stamped[0] === 'object' && !Array.isArray(stamped[0]) && !stamped[0].client_request_id) {
        stamped[0] = { ...stamped[0], client_request_id: this.newRequestId() };
      }
      const withTok = [tok, ...stamped];
      const out = await q.wrapCall((m, a) => this._callDirect(m, a, { tokenIncluded: true }), method, withTok);
      if (out && out.__offlineQueued) {
        return { __offlineQueued: true, queued: true, message: 'Saved offline — will sync when online' };
      }
      return out;
    }
    return this._callDirect(method, args);
  },

  newRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  },

  origin() {
    if (typeof location !== 'undefined' && location.origin && !String(location.origin).startsWith('file:') && !this.isBundledApp()) {
      return location.origin.replace(/\/$/, '');
    }
    const c = window.__EXPENSE_CONFIG__ || {};
    return String(c.apiBase || 'https://chisafood.up.railway.app').replace(/\/$/, '');
  },

  invoiceUrl(id) {
    if (!id) return '';
    return `${this.origin()}/api/expense-invoice/${id}`;
  },

  login: (u, p, d) => ExpenseAPI.call('expenseApp:login', [u, p, d || {}]),
  logout: () => ExpenseAPI.call('expenseApp:logout', []),
  profile: () => ExpenseAPI.call('expenseApp:profile', []),
  list: (f) => ExpenseAPI.call('expenseApp:list', [f || {}]),
  get: (id) => ExpenseAPI.call('expenseApp:get', [id]),
  save: (d) => ExpenseAPI.call('expenseApp:save', [d || {}]),
  categories: () => ExpenseAPI.call('expenseApp:categories', []),
  settings: () => ExpenseAPI.call('expenseApp:settings', []),
  grantAccess: (d) => ExpenseAPI.call('expenseApp:grantAccess', [d || {}]),
  unitsList: () => ExpenseAPI.call('expenseApp:unitsList', []),
  searchIngredients: (q, limit) => ExpenseAPI.call('expenseApp:searchIngredients', [q, limit || 25]),
  wasteProducts: () => ExpenseAPI.call('expenseApp:wasteProducts', []),
  wasteList: (f) => ExpenseAPI.call('expenseApp:wasteList', [f || {}]),
  wasteRecord: (d) => ExpenseAPI.call('expenseApp:wasteRecord', [d || {}]),
  ownerFundings: (f) => ExpenseAPI.call('expenseApp:ownerFundings', [f || {}]),
  recordOwnerFunding: (d) => ExpenseAPI.call('expenseApp:recordOwnerFunding', [d || {}]),
  recordWithdrawal: (d) => ExpenseAPI.call('expenseApp:recordWithdrawal', [d || {}]),
  withdrawals: (f) => ExpenseAPI.call('expenseApp:withdrawals', [f || {}]),
  dailyMoney: (f) => ExpenseAPI.call('expenseApp:dailyMoney', [f || {}]),
  dailyMoneyPdf: (f) => ExpenseAPI.call('expenseApp:dailyMoneyPdf', [f || {}]),
  branches: () => ExpenseAPI.call('expenseApp:branches', []),
  stockBatchProducts: () => ExpenseAPI.call('expenseApp:stockBatchProducts', []),
  stockBatchDashboard: (f) => ExpenseAPI.call('expenseApp:stockBatchDashboard', [f || {}]),
  stockBatchList: (f) => ExpenseAPI.call('expenseApp:stockBatchList', [f || {}]),
  stockBatchGet: (id) => ExpenseAPI.call('expenseApp:stockBatchGet', [id]),
  stockBatchCreate: (d) => ExpenseAPI.call('expenseApp:stockBatchCreate', [d || {}]),
  stockBatchUpdate: (id, d) => ExpenseAPI.call('expenseApp:stockBatchUpdate', [id, d || {}]),
  stockBatchWaste: (id, d) => ExpenseAPI.call('expenseApp:stockBatchWaste', [id, d || {}]),
  stockBatchSetActualYield: (id, y) => ExpenseAPI.call('expenseApp:stockBatchSetActualYield', [id, y]),
  stockBatchClose: (id, reason) => ExpenseAPI.call('expenseApp:stockBatchClose', [id, reason || '']),
  stockBatchReopen: (id) => ExpenseAPI.call('expenseApp:stockBatchReopen', [id]),
  stockBatchCancel: (id, reason) => ExpenseAPI.call('expenseApp:stockBatchCancel', [id, reason || '']),
  stockBatchEvents: (id, limit) => ExpenseAPI.call('expenseApp:stockBatchEvents', [id, limit || 40]),
  stockBatchMealsUsing: (stockProductId) => ExpenseAPI.call('expenseApp:stockBatchMealsUsing', [stockProductId])
};

window.ExpenseAPI = ExpenseAPI;
