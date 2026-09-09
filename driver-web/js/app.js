const DriverApp = {
  view: 'login',
  tab: 'home',
  token: localStorage.getItem('driver_token') || sessionStorage.getItem('driver_token') || '',
  _stateKey: 'driver_app_state',
  dash: null,
  orders: [],
  available: [],
  history: [],
  earnings: null,
  payments: null,
  profile: null,
  profileEditing: false,
  historyDays: 7,
  earningsDays: 7,
  paymentsDays: 30,
  historyCustomFrom: null,
  historyCustomTo: null,
  earningsCustomFrom: null,
  earningsCustomTo: null,
  paymentsCustomFrom: null,
  paymentsCustomTo: null,
  historyDetail: null,
  _pollTimer: null,
  _loggedIn: false,
  _knownAvailableIds: new Set(),
  _seenToastIds: new Set(),
  _acceptingIds: new Set(),
  _mainBound: false,
  _refreshing: false,
  _lastKnownPayoutId: 0,
  _payoutBaselineSet: false,

  _seenToastKey: 'driver_seen_pool_toast',

  _loadSeenToastIds() {
    try {
      const raw = JSON.parse(localStorage.getItem(this._seenToastKey) || '[]');
      (raw || []).forEach((id) => this._seenToastIds.add(String(id)));
    } catch (_) { /* ignore */ }
  },

  _saveSeenToastIds() {
    try {
      localStorage.setItem(this._seenToastKey, JSON.stringify([...this._seenToastIds].slice(-200)));
    } catch (_) { /* ignore */ }
  },

  _notifyRpc(method, args) {
    if (String(method || '').startsWith('notifications:')) {
      return fetch(DriverAPI.rpcUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args: args || [] })
      }).then((r) => r.json()).then((j) => {
        if (j.success === false) return [];
        return j.data != null ? j.data : j;
      }).catch(() => []);
    }
    return DriverAPI.call(method, args);
  },

  _normalizeOrderLists() {
    const assigned = [];
    const assignedIds = new Set();
    for (const o of this.orders || []) {
      const id = String(o.id);
      if (!id || assignedIds.has(id)) continue;
      assignedIds.add(id);
      assigned.push(o);
    }
    const available = [];
    const availIds = new Set();
    for (const o of this.available || []) {
      const id = String(o.id);
      if (!id || assignedIds.has(id) || availIds.has(id)) continue;
      availIds.add(id);
      available.push(o);
    }
    this.orders = assigned;
    this.available = available;
  },

  _poolKey(id) {
    return `delivery_pool:${id}`;
  },

  _dataSignature() {
    return JSON.stringify({
      tab: this.tab,
      avail: (this.dash?.driver?.availability),
      orders: (this.orders || []).map((o) => `${o.id}:${o.status}`),
      available: (this.available || []).map((o) => o.id),
      hist: this.tab === 'history' ? (this.history || []).length : 0
    });
  },

  async refreshTabBackground() {
    const tab = this.tab;
    const before = this._dataSignature();
    try {
      await this.refresh();
      if (this.tab !== tab || this.view !== 'main' || this.historyDetail) return;
      if (this._dataSignature() !== before) this.renderBody();
    } catch (_) { /* ignore */ }
  },

  _saveState() {
    try {
      const data = {
        tab: this.tab,
        view: this.view,
        historyDays: this.historyDays,
        earningsDays: this.earningsDays,
        paymentsDays: this.paymentsDays,
        profileEditing: this.profileEditing
      };
      if (window.PanelState) PanelState.save(this._stateKey, data);
      else sessionStorage.setItem(this._stateKey, JSON.stringify(data));
    } catch (_) { /* ignore */ }
  },

  _loadState() {
    try {
      const o = window.PanelState ? PanelState.load(this._stateKey) : JSON.parse(sessionStorage.getItem(this._stateKey) || 'null');
      if (!o) return;
      if (o.tab) this.tab = o.tab;
      if (o.view && ['login', 'main'].includes(o.view)) this.view = o.view;
      if (o.historyDays) this.historyDays = o.historyDays;
      if (o.earningsDays) this.earningsDays = o.earningsDays;
      if (o.paymentsDays) this.paymentsDays = o.paymentsDays;
      if (o.profileEditing != null) this.profileEditing = o.profileEditing;
    } catch (_) { /* ignore */ }
  },

  notificationsEnabled() {
    return window.PanelNotify ? PanelNotify.isSoundEnabled('driver') : localStorage.getItem('driver_sound_off') !== '1';
  },

  syncDeliveryAlert() {
    if (!window.PanelNotify) return;
    const mode = this.dash?.assignment_mode || this.dash?.delivery_settings?.assignment_mode || 'manual';
    if (mode !== 'auto') return;
    if ((this.dash?.driver?.availability || 'offline') !== 'online') return;
    PanelSound?.setPanel('driver');
    PanelSound?.setEnabled(this.notificationsEnabled());
    const avail = (this.available || []).filter((o) => String(o.status || '').toLowerCase() === 'awaiting_driver');
    const unacked = avail.filter((o) => !PanelNotify.isAcked(this._poolKey(o.id)));
    for (const o of unacked) {
      const id = String(o.id);
      if (!this._seenToastIds.has(id)) {
        this._seenToastIds.add(id);
        this._saveSeenToastIds();
        this.toast('New delivery available — tap Accept delivery', 'info');
        PanelNotify.notifyBrowser('New delivery', 'Tap Accept delivery to claim this order', `driver-pool-${id}`);
      }
    }
    PanelNotify.syncPendingAlert(unacked, (o) => this._poolKey(o.id), this.notificationsEnabled());
  },

  syncAssignedAlert() {
    if (!window.PanelNotify || !this.notificationsEnabled()) return;
    const assigned = (this.orders || []).filter((o) => String(o.status || '').toLowerCase() === 'assigned');
    const unacked = assigned.filter((o) => !PanelNotify.isAcked(`delivery_assigned:${o.id}`));
    for (const o of unacked) {
      const id = String(o.id);
      if (!this._seenToastIds.has(`a${id}`)) {
        this._seenToastIds.add(`a${id}`);
        this._saveSeenToastIds();
        this.toast('New delivery assigned to you — open to accept', 'info');
        PanelNotify.notifyBrowser('Delivery assigned', 'Admin assigned you a delivery', `driver-assigned-${id}`);
      }
    }
    if (unacked.length) PanelNotify.syncPendingAlert(unacked, (o) => `delivery_assigned:${o.id}`, this.notificationsEnabled());
  },

  syncOrderAlerts() {
    this.syncAssignedAlert();
    this.syncDeliveryAlert();
  },

  initPayoutTracking() {
    const payouts = this.payments?.payouts || [];
    if (!this._payoutBaselineSet) {
      this._lastKnownPayoutId = Number(payouts[0]?.id) || 0;
      this._payoutBaselineSet = true;
    }
  },

  checkNewPaymentPopup() {
    this.checkNewPaymentPopupFrom(this.payments?.payouts || []);
  },

  checkNewPaymentPopupFrom(payouts) {
    if (!this._payoutBaselineSet || !payouts.length) return;
    const latest = payouts[0];
    const id = Number(latest.id);
    if (id > this._lastKnownPayoutId) {
      this._lastKnownPayoutId = id;
      this.showPaymentReceivedModal(latest);
    }
  },

  downloadPdfBase64(base64, filename) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'payment.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
  },

  payoutDeliveriesHtml(deliveries) {
    const rows = deliveries || [];
    if (!rows.length) return '<p class="muted">No delivery lines saved.</p>';
    return rows.map((d, i) => {
      const items = (d.items || []).map((it) => `${it.quantity}× ${it.name}`).join(', ');
      return `<div class="order-card" style="margin-top:8px">
        <strong>${i + 1}. ${this.esc(d.confirmation_code || d.order_number || 'Delivery')}</strong> · ${this.money(d.delivery_fee)}
        <p class="muted" style="margin:4px 0;font-size:13px">${this.formatDateTimeLabel(d.delivered_at)} · ${this.esc(d.branch_name || '')}</p>
        <p class="muted" style="margin:0;font-size:13px">${this.esc(d.customer_name || '')} · ${this.esc(d.delivery_address || '')}</p>
        ${items ? `<p class="muted" style="margin:4px 0 0;font-size:12px">${this.esc(items)}</p>` : ''}
      </div>`;
    }).join('');
  },

  async showPaymentReceivedModal(payout) {
    let p = payout;
    try {
      const detail = await DriverAPI.payoutDetail(payout.id);
      p = detail?.payout || detail || payout;
    } catch (_) { /* use summary */ }
    this.showModal({
      title: 'Payment received',
      body: `<p class="pay-amount" style="font-size:1.4rem;margin:0">${this.money(p.amount)}</p>
        <p class="muted">${this.formatDateLabel(p.period_from)} → ${this.formatDateLabel(p.period_to)} · ${p.delivery_count || (p.deliveries || []).length || 0} deliveries</p>
        <p class="muted" style="font-size:13px">Paid ${this.formatDateTimeLabel(p.paid_at)}</p>
        <div class="section-title" style="margin-top:12px">Your deliveries</div>
        ${this.payoutDeliveriesHtml(p.deliveries)}`,
      actions: `<button type="button" class="drv-btn secondary" data-act="payment-modal-close">Close</button>
        <button type="button" class="drv-btn" data-act="payment-modal-pdf">Download PDF</button>`
    });
    document.querySelector('[data-act="payment-modal-close"]')?.addEventListener('click', () => {
      document.getElementById('drv-modal')?.remove();
    });
    document.querySelector('[data-act="payment-modal-pdf"]')?.addEventListener('click', async () => {
      try {
        const r = await DriverAPI.payoutPdf(p.id);
        const data = r?.pdf ? r : (r?.data || r);
        this.downloadPdfBase64(data.pdf, data.filename || `payment-${p.id}.pdf`);
      } catch (e) { this.toast(e.message || 'PDF failed', 'error'); }
    });
  },

  initNotify() {
    if (!window.PanelNotify || this._notifyReady) return;
    this._notifyReady = true;
    this._loadSeenToastIds();
    PanelNotify.init({
      panel: 'driver',
      loggedIn: () => !!this.token,
      rpc: (method, args) => this._notifyRpc(method, args)
    });
  },

  stopDeliveryAlert() {
    window.PanelSound?.stop();
  },

  money(n) { return `R${(Number(n) || 0).toFixed(2)}`; },
  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  },
  toast(msg, type) {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  todayStr() { return this.localDateStr(new Date()); },

  localDateStr(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  },

  formatDateLabel(iso) {
    if (!iso) return '—';
    const s = String(iso).slice(0, 10);
    try {
      return new Date(s + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) { return s; }
  },

  formatDateTimeLabel(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return String(iso).slice(0, 16); }
  },

  statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const cls = ['delivered', 'failed', 'cancelled'].includes(s) ? s : 'cancelled';
    return `<span class="status-badge ${cls}">${this.esc(s || '—')}</span>`;
  },

  dateRange(days) {
    const n = Math.max(1, Number(days) || 7);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (n - 1));
    return { from: this.localDateStr(from), to: this.localDateStr(to) };
  },

  filterRange(kind) {
    const days = kind === 'earnings' ? this.earningsDays : kind === 'payments' ? this.paymentsDays : this.historyDays;
    if (days === 'custom') {
      const fromKey = kind === 'earnings' ? 'earningsCustomFrom' : kind === 'payments' ? 'paymentsCustomFrom' : 'historyCustomFrom';
      const toKey = kind === 'earnings' ? 'earningsCustomTo' : kind === 'payments' ? 'paymentsCustomTo' : 'historyCustomTo';
      const from = this[fromKey] || this.dateRange(7).from;
      const to = this[toKey] || this.todayStr();
      return { from, to };
    }
    return this.dateRange(days);
  },

  setFilterRange(kind, from, to, days = 'custom') {
    const fromKey = kind === 'earnings' ? 'earningsCustomFrom' : kind === 'payments' ? 'paymentsCustomFrom' : 'historyCustomFrom';
    const toKey = kind === 'earnings' ? 'earningsCustomTo' : kind === 'payments' ? 'paymentsCustomTo' : 'historyCustomTo';
    const daysKey = kind === 'earnings' ? 'earningsDays' : kind === 'payments' ? 'paymentsDays' : 'historyDays';
    this[fromKey] = from;
    this[toKey] = to;
    this[daysKey] = days;
  },


  async showForgotPassword() {
    this.showModal({
      title: 'Password recovery',
      body: `<p class="muted" style="margin:0 0 12px">Enter the phone number or driver code registered on your account. We'll send a temporary password to your WhatsApp.</p>
        <label>Phone or driver code<input id="drv-recover-id" placeholder="e.g. 0821234567"></label>`,
      actions: `<button type="button" class="drv-btn secondary drv-modal-close-btn" style="margin-top:0">Cancel</button>
        <button type="button" class="drv-btn" id="drv-recover-submit" style="margin-top:0">Send via WhatsApp</button>`
    });
    document.querySelector('.drv-modal-close-btn')?.addEventListener('click', () => this.hideModal());
    document.getElementById('drv-recover-submit')?.addEventListener('click', async () => {
      const id = document.getElementById('drv-recover-id')?.value?.trim();
      if (!id) { this.toast('Enter your phone or driver code', 'error'); return; }
      const btn = document.getElementById('drv-recover-submit');
      btn.disabled = true;
      try {
        const r = await DriverAPI.recoverPassword(id);
        this.hideModal();
        this.showRecoveryResult(r);
      } catch (e) {
        this.toast(e.message || 'Recovery failed', 'error');
      } finally {
        btn.disabled = false;
      }
    });
    setTimeout(() => document.getElementById('drv-recover-id')?.focus(), 100);
  },

  showRecoveryResult(result) {
    const sent = /sent to your WhatsApp/i.test(result?.message || '');
    const waIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.75.75 0 0 0 .917.917l4.458-1.495A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.006-1.366l-.357-.212-2.642.886.886-2.642-.212-.357A9.818 9.818 0 1 1 12 21.818z"/></svg>`;
    this.showModal({
      title: sent ? 'Check your WhatsApp' : 'WhatsApp recovery',
      body: `<div style="text-align:center;padding:8px 0">
        <div style="width:64px;height:64px;border-radius:50%;background:#25D366;display:inline-flex;align-items:center;justify-content:center;color:#fff;margin-bottom:12px">${waIcon}</div>
        <p style="margin:0;font-size:15px;line-height:1.5">${this.esc(result?.message || 'If your account exists, a temporary password will be sent to your WhatsApp shortly.')}</p>
        <p class="muted" style="margin:12px 0 0;font-size:13px">Sign in with the temporary password, then change it from your profile.</p>
      </div>`,
      actions: result?.whatsapp_url
        ? `<button type="button" class="drv-modal-wa" id="drv-open-wa">${waIcon} Open WhatsApp</button>
           <button type="button" class="drv-btn secondary drv-modal-close-btn">Close</button>`
        : `<button type="button" class="drv-btn drv-modal-close-btn">Got it</button>`
    });
    document.querySelector('.drv-modal-close-btn')?.addEventListener('click', () => this.hideModal());
    document.getElementById('drv-open-wa')?.addEventListener('click', () => {
      if (result?.whatsapp_url) {
        window.location.href = result.whatsapp_url;
      }
      this.hideModal();
    });
  },

  showModal({ title, body, actions }) {
    this.hideModal();
    const el = document.createElement('div');
    el.className = 'drv-modal-backdrop';
    el.id = 'drv-modal-root';
    el.innerHTML = `<div class="drv-modal" role="dialog" aria-modal="true">
      <h2>${this.esc(title)}</h2>
      ${body}
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">${actions || ''}</div>
    </div>`;
    el.addEventListener('click', (e) => { if (e.target === el) this.hideModal(); });
    document.body.appendChild(el);
  },

  hideModal() {
    document.getElementById('drv-modal-root')?.remove();
  },

  deviceInfo() {
    const uid = localStorage.getItem('driver_device_uid') || `drv-${Date.now()}`;
    localStorage.setItem('driver_device_uid', uid);
    return { device_uid: uid, device_name: 'Driver Device', platform: 'web' };
  },

  phoneLink(phone) {
    const p = String(phone || '').replace(/\D/g, '');
    return p ? `tel:${p}` : '#';
  },

  whatsappLink(phone) {
    const p = String(phone || '').replace(/\D/g, '');
    if (!p) return '#';
    const wa = p.startsWith('0') ? `27${p.slice(1)}` : (p.startsWith('27') ? p : p);
    return `https://wa.me/${wa}`;
  },

  availDot(avail) {
    const on = avail === 'online';
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${on ? '#22c55e' : '#94a3b8'};margin-right:6px"></span>`;
  },

  bindExitGuard() {
    window.addEventListener('beforeunload', (e) => {
      if (this._loggedIn) {
        e.preventDefault();
        e.returnValue = 'Log out to leave the driver app.';
      }
    });
    window.addEventListener('popstate', () => {
      if (!this._loggedIn) return;
      history.pushState({ driver: true }, '', location.href);
      if (confirm('Leave the driver app? You must log out first.')) this.doLogout();
    });
    if (this._loggedIn) history.pushState({ driver: true }, '', location.href);
  },

  updateNav() {
    const nav = document.getElementById('driver-nav');
    if (!nav) return;
    if (this.view !== 'main') {
      nav.classList.add('hidden');
      return;
    }
    nav.classList.remove('hidden');
    nav.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.tab);
    });
  },

  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(async () => {
      if (!this.token || this.view !== 'main' || this.historyDetail || this._refreshing) return;
      const before = this._dataSignature();
      try {
        await this.refresh();
        if (this._dataSignature() !== before) this.renderBody();
      } catch (_) { /* */ }
    }, 12000);
  },

  stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  },

  async init() {
    if (location.pathname.includes('register')) return;
    this._loadState();
    this.bindMainOnce();
    document.getElementById('driver-nav')?.addEventListener('click', (e) => this.onNavClick(e));
    if (this.token) {
      try {
        this.initNotify();
        await this.refresh();
        this.view = 'main';
        this._loggedIn = true;
        this.bindExitGuard();
        this.startPolling();
      } catch (_) {
        this.token = '';
        localStorage.removeItem('driver_token');
        sessionStorage.removeItem('driver_token');
        this.view = 'login';
      }
    }
    this.render();
  },

  async doLogout() {
    window.PanelNotify?.onLogout();
    await DriverAPI.logout().catch(() => {});
    this.token = '';
    this._loggedIn = false;
    localStorage.removeItem('driver_token');
    try { sessionStorage.removeItem('driver_token'); } catch (_) { /* ignore */ }
    this.stopPolling();
    this.view = 'login';
    this._saveState();
    this.render();
  },

  async onNavClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'tab') {
      this.tab = btn.dataset.tab || 'home';
      this.historyDetail = null;
      this.profileEditing = false;
      this._saveState();
      this.updateNav();
      this.renderBody();
      this.refreshTabBackground();
      return;
    }
    if (act === 'logout') this.doLogout();
  },

  async refresh() {
    if (!this.token) return;
    this._refreshing = true;
    try {
      this.dash = await DriverAPI.dashboard();
      this.orders = this.dash.assigned || [];
      this.available = this.dash.available || [];
      this._normalizeOrderLists();
      this.syncOrderAlerts();
      if (this.tab === 'history') {
        const range = this.filterRange('history');
        this.history = await DriverAPI.history({ ...range, limit: 200 }).catch(() => []);
      }
      if (this.tab === 'earnings') {
        const range = this.filterRange('earnings');
        this.earnings = await DriverAPI.earnings(range).catch(() => null);
      }
      if (this.tab === 'payments') {
        const range = this.filterRange('payments');
        this.payments = await DriverAPI.payments(range.from && range.to ? range : {}).catch(() => null);
      }
      const payCheck = this.tab === 'payments' ? this.payments : await DriverAPI.payments({}).catch(() => null);
      if (!this._payoutBaselineSet) {
        this._lastKnownPayoutId = Number(payCheck?.payouts?.[0]?.id) || 0;
        this._payoutBaselineSet = true;
      } else if (payCheck?.payouts?.length) {
        this.checkNewPaymentPopupFrom(payCheck.payouts);
      }
      if (this.tab === 'profile') {
        this.profile = await DriverAPI.profile().catch(() => this.profile || this.dash?.driver);
      }
    } finally {
      this._refreshing = false;
    }
  },

  filterBar(kind) {
    const days = kind === 'earnings' ? this.earningsDays : kind === 'payments' ? this.paymentsDays : this.historyDays;
    const today = this.todayStr();
    const range = this.filterRange(kind);
    return `<div class="filter-bar">
      <label>Date range</label>
      <select data-filter-days="${kind}">
        <option value="1" ${days === 1 ? 'selected' : ''}>Today</option>
        <option value="3" ${days === 3 ? 'selected' : ''}>Last 3 days</option>
        <option value="7" ${days === 7 ? 'selected' : ''}>Last 7 days</option>
        <option value="14" ${days === 14 ? 'selected' : ''}>Last 14 days</option>
        <option value="30" ${days === 30 ? 'selected' : ''}>Last 30 days</option>
        <option value="90" ${days === 90 ? 'selected' : ''}>Last 90 days</option>
        <option value="custom" ${days === 'custom' ? 'selected' : ''}>Pick dates…</option>
      </select>
      <div class="date-row" style="margin-top:10px">
        <label>From<input type="date" id="filter-from-${kind}" max="${today}" value="${range.from}"></label>
        <label>To<input type="date" id="filter-to-${kind}" max="${today}" value="${range.to}"></label>
      </div>
      <button type="button" class="drv-btn secondary sm" style="margin-top:10px" data-act="apply-custom-${kind}">Apply dates</button>
    </div>`;
  },

  paymentRecordHtml(pay) {
    const deliveries = pay.deliveries || [];
    return `<div class="payment-record">
      <div class="pay-amount">${this.money(pay.amount)}</div>
      <p class="muted" style="margin:4px 0 0">Paid ${this.formatDateTimeLabel(pay.paid_at)} · ${pay.delivery_count || deliveries.length || 0} deliveries</p>
      <div class="pay-meta">
        <span class="pay-badge">Paid</span>
        ${pay.paid_by_name ? `<span class="muted">By ${this.esc(pay.paid_by_name)}</span>` : ''}
      </div>
      <div class="detail-grid" style="margin-top:12px">
        <div class="detail-row"><span>Period covered</span><span>${this.formatDateLabel(pay.period_from)} → ${this.formatDateLabel(pay.period_to)}</span></div>
        ${pay.notes ? `<div class="detail-row"><span>Notes</span><span>${this.esc(pay.notes)}</span></div>` : ''}
      </div>
      ${deliveries.length ? `<div class="section-title" style="margin-top:12px;font-size:13px">Deliveries included</div>${this.payoutDeliveriesHtml(deliveries)}` : ''}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="drv-btn secondary sm" data-act="payout-pdf" data-payout-id="${pay.id}">Download PDF</button>
        <button type="button" class="drv-btn secondary sm" data-act="payout-view" data-payout-id="${pay.id}">View details</button>
      </div>
    </div>`;
  },

  deptSettingsHtml() {
    const ds = this.dash?.delivery_settings || {};
    const mode = ds.assignment_mode || this.dash?.assignment_mode || 'manual';
    const dept = ds.department_mode || this.dash?.department_mode || 'per_branch';
    const cycle = ds.payout_cycle_days || this.dash?.payout_cycle_days || 7;
    const payoutDay = ds.payout_day_label || this.dash?.payout_day_label;
    const claimOpen = ds.claim_window_open ?? this.dash?.claim_window_open;
    return `<div class="order-card" style="margin-bottom:12px;font-size:13px">
      <div class="detail-grid">
        <div class="detail-row"><span>Orders</span><span>${mode === 'auto' ? 'Automatic — accept from pool' : 'Manual — admin assigns you'}</span></div>
        <div class="detail-row"><span>Department</span><span>${dept === 'central' ? 'Central (all branches)' : 'Your branches only'}</span></div>
        <div class="detail-row"><span>Payout cycle</span><span>Every ${cycle} day${cycle === 1 ? '' : 's'}</span></div>
        <div class="detail-row"><span>Payout day</span><span>${payoutDay || 'Any day'}</span></div>
        <div class="detail-row"><span>Claim window</span><span>${claimOpen ? 'Open now' : 'Closed — opens day before payout day'}</span></div>
      </div>
    </div>`;
  },

  paymentsTabHtml() {
    const p = this.payments || {};
    const dash = this.dash || {};
    const claim = p.pending_claim || dash.pending_claim;
    const payouts = p.payouts || [];
    const ds = dash.delivery_settings || {};
    const payoutDay = ds.payout_day_label || dash.payout_day_label;
    const claimOpen = p.claim_window_open ?? dash.claim_window_open ?? ds.claim_window_open;
    return `${this.filterBar('payments')}
      ${this.deptSettingsHtml()}
      <div class="payment-summary">
        <span class="muted">Amount owing to you</span>
        <div class="amount">${this.money(p.owed_amount ?? dash.owed_amount)}</div>
        <p class="muted" style="margin:8px 0 0;font-size:13px">Unpaid delivery fees since last payout · ${this.formatDateLabel(p.owed_from || dash.owed_from)} → ${this.formatDateLabel(p.owed_to || dash.owed_to)}</p>
      </div>
      ${(p.can_claim || dash.can_claim) ? `<button type="button" class="drv-btn" data-act="submit-claim">Submit payout claim · ${this.money(p.owed_amount ?? dash.owed_amount)}</button>
        <p class="muted" style="font-size:13px;margin-top:8px">Request admin to review and pay you for this period.</p>` : ''}
      ${claim ? `<div class="claim-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <strong>Your claim</strong>
          <span class="pay-badge ${claim.status === 'pending' ? 'pending' : 'approved'}">${this.esc(claim.status)}</span>
        </div>
        <p class="pay-amount" style="font-size:1.2rem;margin:8px 0">${this.money(claim.amount)}</p>
        <p class="muted">${this.formatDateLabel(claim.period_from)} → ${this.formatDateLabel(claim.period_to)}</p>
        <p class="muted" style="font-size:12px;margin-top:6px">Submitted ${this.formatDateTimeLabel(claim.claimed_at)}${claim.delivery_count ? ` · ${claim.delivery_count} deliveries` : ''}</p>
      </div>` : ''}
      ${!p.can_claim && !dash.can_claim && !claim ? `<p class="muted" style="font-size:13px">Claim window opens the day before your scheduled payout day${payoutDay ? ` (${this.esc(payoutDay)})` : ''}.</p>` : ''}
      <div class="section-title">Payment history <span>${payouts.length} record${payouts.length === 1 ? '' : 's'}</span></div>
      <p class="muted" style="font-size:13px;margin:-4px 0 12px">When admin pays you, each payment appears below with the date range it covers.</p>
      ${payouts.length ? payouts.map((pay) => this.paymentRecordHtml(pay)).join('')
        : `<div class="empty-state"><div class="icon">💳</div><p>No payments in this period yet.</p><p style="font-size:13px">Try selecting a wider date range above.</p></div>`}`;
  },

  historyDetailHtml(o) {
    const items = (o.items || []).map((i) => `${i.quantity || 1}× ${i.name || 'Item'}`).join(', ');
    return `<div class="drv-body">
      <button type="button" class="link-btn" data-act="history-back">← Back to history</button>
      <div class="order-card" style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <h3 style="margin:0">${this.esc(o.delivery_number || o.confirmation_code || 'Delivery')}</h3>
          ${this.statusBadge(o.status)}
        </div>
        ${o.confirmation_code ? `<div class="delivery-code">Handoff code: <strong>${this.esc(o.confirmation_code)}</strong></div>` : ''}
        <div class="detail-grid">
          <div class="detail-row"><span>Completed</span><span>${this.formatDateTimeLabel(o.delivered_at || o.updated_at)}</span></div>
          <div class="detail-row"><span>Your fee</span><span><strong>${this.money(o.delivery_fee)}</strong></span></div>
          <div class="detail-row"><span>Address</span><span style="text-align:right;max-width:60%">${this.esc(o.delivery_address || '—')}</span></div>
          ${items ? `<div class="detail-row"><span>Items</span><span style="text-align:right;max-width:60%">${this.esc(items)}</span></div>` : ''}
          ${o.payment_method ? `<div class="detail-row"><span>Payment</span><span>${this.esc(o.payment_method)}</span></div>` : ''}
        </div>
        <p class="muted" style="font-size:12px;margin:12px 0 0">Customer contact is hidden after delivery for privacy.</p>
      </div>
    </div>`;
  },

  profileDocsHtml(p) {
    const urls = p.document_urls || {};
    const imgs = [];
    if (urls.selfie || p.profile_photo_url) {
      imgs.push({ label: 'Profile selfie', src: urls.selfie || p.profile_photo_url });
    }
    if (urls.id_photo) imgs.push({ label: 'ID document', src: urls.id_photo });
    (urls.vehicle_photos || []).forEach((src, i) => {
      if (src) imgs.push({ label: `Vehicle photo ${i + 1}`, src });
    });
    if (!imgs.length) return '';
    return `<div class="section-title" style="margin-top:12px">Documents &amp; photos</div>
      <div class="doc-grid">${imgs.map((img) =>
        `<figure class="doc-thumb"><img src="${this.esc(img.src)}" alt=""><figcaption>${this.esc(img.label)}</figcaption></figure>`
      ).join('')}</div>`;
  },

  profileTabHtml() {
    const p = this.profile || this.dash?.driver || {};
    if (this.profileEditing) {
      return `<div class="section-title">Edit profile</div>
        <p class="muted" style="font-size:13px;margin-bottom:12px">Same details as registration — update photos anytime.</p>
        <form class="profile-form" id="drv-profile-form">
          <div class="field"><label>Full name<input id="pf-name" value="${this.esc(p.full_name || '')}" required></label></div>
          <div class="field"><label>Phone<input id="pf-phone" value="${this.esc(p.phone || '')}" required></label></div>
          <div class="field"><label>Email<input id="pf-email" type="email" value="${this.esc(p.email || '')}"></label></div>
          <div class="field"><label>ID number<input id="pf-id" value="${this.esc(p.id_number || '')}" required></label></div>
          <div class="field"><label>Home address<textarea id="pf-address" rows="2" required>${this.esc(p.address || '')}</textarea></label></div>
          <div class="field"><label>Vehicle type / description<input id="pf-vehicle" value="${this.esc(p.vehicle_info || '')}" placeholder="e.g. White Honda bike" required></label></div>
          <div class="field"><label>Vehicle registration<input id="pf-reg" value="${this.esc(p.vehicle_registration || '')}" placeholder="e.g. ABC123GP" required></label></div>
          <div class="section-title" style="margin-top:16px">Bank details</div>
          <div class="field"><label>Bank name<input id="pf-bank" value="${this.esc(p.bank_name || '')}"></label></div>
          <div class="field"><label>Account number<input id="pf-account" value="${this.esc(p.bank_account || '')}"></label></div>
          <div class="field"><label>Branch code<input id="pf-branch" value="${this.esc(p.bank_branch_code || '')}"></label></div>
          <div class="section-title" style="margin-top:16px">Photos (leave blank to keep current)</div>
          <div class="field"><label>Profile selfie<input type="file" id="pf-selfie" accept="image/*" capture="user"></label></div>
          <div class="field"><label>ID document photo<input type="file" id="pf-id-photo" accept="image/*" capture="environment"></label></div>
          <div class="field"><label>Vehicle photos (up to 5)<input type="file" id="pf-vehicle-photos" accept="image/*" multiple></label></div>
          <div class="section-title" style="margin-top:16px">Change password</div>
          <div class="field"><label>Current password<input id="pf-current-pass" type="password" autocomplete="current-password"></label></div>
          <div class="field"><label>New password<input id="pf-new-pass" type="password" autocomplete="new-password"></label></div>
          <button type="button" class="drv-btn" data-act="save-profile">Save changes</button>
          <button type="button" class="drv-btn secondary" data-act="cancel-profile-edit">Cancel</button>
        </form>`;
    }
    return `<div class="profile-header">
      ${p.profile_photo_url
        ? `<img class="profile-avatar-lg" src="${this.esc(p.profile_photo_url)}" alt="">`
        : `<div class="profile-avatar-placeholder">👤</div>`}
      <h2 style="margin:0 0 4px">${this.esc(p.full_name || 'Driver')}</h2>
      <p class="muted">${this.esc(p.driver_code || '')}</p>
      <button type="button" class="drv-btn sm" data-act="edit-profile" style="margin:12px auto 0">Edit profile</button>
    </div>
    <div class="order-card">
      <div class="detail-grid">
        <div class="detail-row"><span>Phone</span><span>${this.esc(p.phone || '—')}</span></div>
        <div class="detail-row"><span>Email</span><span>${this.esc(p.email || '—')}</span></div>
        <div class="detail-row"><span>ID number</span><span>${this.esc(p.id_number || '—')}</span></div>
        <div class="detail-row"><span>Address</span><span>${this.esc(p.address || '—')}</span></div>
        <div class="detail-row"><span>Vehicle</span><span>${this.esc(p.vehicle_info || '—')}</span></div>
        <div class="detail-row"><span>Registration</span><span>${this.esc(p.vehicle_registration || '—')}</span></div>
        <div class="detail-row"><span>Bank</span><span>${this.esc(p.bank_name || '—')}</span></div>
        <div class="detail-row"><span>Account</span><span>${this.esc(p.bank_account || '—')}</span></div>
        <div class="detail-row"><span>Branch code</span><span>${this.esc(p.bank_branch_code || '—')}</span></div>
      </div>
      ${this.profileDocsHtml(p)}
    </div>
    <div class="order-card">
      <div class="detail-grid">
        <div class="detail-row"><span>Order alerts</span><span><label><input type="checkbox" id="drv-notify" ${this.notificationsEnabled() ? 'checked' : ''}> Sound &amp; pop-ups</label></span></div>
      </div>
    </div>
    <button type="button" class="drv-btn secondary" data-act="logout">Sign out</button>`;
  },

  render() {
    const app = document.getElementById('app');
    if (!app) return;
    if (this.view === 'login') {
      app.innerHTML = `<div class="drv-card login-card">
        <div data-shop-logo class="drv-logo"></div>
        <h1>Driver Sign In</h1>
        <p class="muted" data-shop-name></p>
        <label>Phone / email / code<input id="drv-user"></label>
        <label>Password<input id="drv-pass" type="password"></label>
        <button class="drv-btn" data-act="login">Sign in</button>
        <button type="button" class="drv-link" data-act="forgot-password" style="margin-top:12px;background:none;border:none;color:#16a34a;text-decoration:underline;cursor:pointer">Forgot password? WhatsApp recovery</button>
        <p class="muted" style="margin-top:12px"><a href="register.html">Register as driver</a></p>
      </div>`;
      this.updateNav();
      this.bindLogin();
      window.PanelBrand?.apply?.();
      return;
    }
    this.renderBody();
    this.updateNav();
  },

  bindMainOnce() {
    if (this._mainBound) return;
    this._mainBound = true;
    this.bindMain();
  },

  logoHtml() {
    const d = this.dash?.driver;
    if (d?.profile_photo_url) {
      return `<img class="hdr-avatar" src="${this.esc(d.profile_photo_url)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #334155" onerror="this.style.display='none'">`;
    }
    const url = this.dash?.shop_logo || '/api/logo';
    return `<img class="hdr-logo" src="${this.esc(url)}" alt="" style="max-height:28px;max-width:56px;width:auto;height:auto;object-fit:contain;border-radius:6px" onerror="this.style.display='none'">`;
  },

  driverCardHtml(driver) {
    if (!driver?.name) return '';
    const tel = driver.phone ? `<a href="${this.phoneLink(driver.phone)}" class="contact-link">📞 Call</a>` : '';
    const wa = driver.phone ? `<a href="${this.whatsappLink(driver.phone)}" target="_blank" class="contact-link">💬 WhatsApp</a>` : '';
    return `<div class="driver-card">
      ${driver.photo_url ? `<img src="${this.esc(driver.photo_url)}" alt="" class="driver-card-photo">` : ''}
      <div><strong>${this.esc(driver.name)}</strong>
      ${driver.vehicle_registration ? `<div class="muted">Reg: ${this.esc(driver.vehicle_registration)}</div>` : ''}
      ${driver.vehicle_info ? `<div class="muted">${this.esc(driver.vehicle_info)}</div>` : ''}
      ${driver.phone ? `<div class="muted">${this.esc(driver.phone)}</div>` : ''}
      <div style="margin-top:8px;display:flex;gap:8px">${tel}${wa}</div></div>
    </div>`;
  },

  buildBodyHtml() {
    if (this.tab === 'payments') return this.paymentsTabHtml();
    if (this.tab === 'profile') return this.profileTabHtml();
    const stats = this.dash || {};
    if (this.tab === 'earnings') {
      const e = this.earnings || {};
      const rows = e.rows || [];
      return `${this.filterBar('earnings')}
        <div class="stat-grid">
          <div class="stat"><span class="muted">Deliveries</span><b>${e.count || 0}</b></div>
          <div class="stat"><span class="muted">Fees earned</span><b>${this.money(e.total)}</b></div>
          <div class="stat"><span class="muted">Still owing</span><b>${this.money(e.owed_amount ?? stats.owed_amount)}</b></div>
        </div>
        <p class="muted" style="margin-top:8px;font-size:13px">Period: ${this.formatDateLabel(e.from)} → ${this.formatDateLabel(e.to)} · Still owing is your full unpaid balance (not limited to this period).</p>
        <div class="section-title">Completed deliveries <span>${rows.length} in period</span></div>
        ${rows.length ? rows.map((o) => this.historyCard(o)).join('')
          : `<div class="empty-state"><div class="icon">📦</div><p>No completed deliveries in this period.</p><p style="font-size:13px">Choose a wider date range above.</p></div>`}`;
    }
    if (this.tab === 'history') {
      return `${this.filterBar('history')}
        <div class="section-title">Completed deliveries <span>tap for details</span></div>
        ${(this.history || []).length ? this.history.map((o) => this.historyCard(o)).join('')
          : `<div class="empty-state"><div class="icon">📦</div><p>No completed deliveries in this period.</p><p style="font-size:13px">Choose a wider date range or pick previous days above.</p></div>`}`;
    }
    return `${this.deptSettingsHtml()}
        <div class="stat-grid">
          <div class="stat"><span class="muted">Active now</span><b>${stats.assigned_count || 0}</b></div>
          <div class="stat"><span class="muted">Done today</span><b>${stats.completed_today || 0}</b></div>
          <div class="stat"><span class="muted">Fees today</span><b>${this.money(stats.fees_today)}</b></div>
          <div class="stat${Number(stats.owed_amount) > 0 ? ' highlight' : ''}"><span class="muted">Owing you</span><b>${this.money(stats.owed_amount)}</b></div>
        </div>
        ${(this.dash?.assignment_mode === 'auto' ? (this.available || []) : []).length ? `<h2 style="font-size:1rem">Available — accept to claim</h2>
          ${this.available.map((o) => this.orderCard(o, { pool: true })).join('')}` : ''}
        <h2 style="font-size:1rem">Your active deliveries</h2>
        ${(this.orders || []).length ? this.orders.map((o) => this.orderCard(o)).join('') : '<p class="muted">No active deliveries — new assignments appear here automatically.</p>'}`;
  },

  renderBody() {
    const app = document.getElementById('app');
    if (!app || this.view !== 'main') return;

    if (this.historyDetail) {
      app.innerHTML = this.historyDetailHtml(this.historyDetail);
      return;
    }

    const d = this.dash?.driver || {};
    const avail = d.availability || 'offline';
    const body = this.buildBodyHtml();
    const bodyEl = app.querySelector('.drv-body');
    if (bodyEl) {
      bodyEl.innerHTML = body;
      const availBtn = app.querySelector('[data-act="avail-toggle"]');
      if (availBtn) availBtn.textContent = avail === 'online' ? 'Go offline' : 'Go online';
      const statusEl = app.querySelector('.hdr-left .muted');
      if (statusEl) {
        statusEl.textContent = avail === 'online' ? 'Online' : 'Offline';
        statusEl.style.color = avail === 'online' ? '#16a34a' : '';
        statusEl.style.fontWeight = avail === 'online' ? '600' : '';
      }
      this.updateNav();
      this.bindFilters();
      return;
    }

    app.innerHTML = `<div class="hdr">
        <div class="hdr-left" data-act="open-profile">
          ${this.logoHtml()}<div>${this.availDot(avail)}<strong>${this.esc(d.full_name || 'Driver')}</strong><br>
        <span class="muted" style="${avail === 'online' ? 'color:#16a34a;font-weight:600' : ''}">${avail === 'online' ? 'Online' : 'Offline'}</span></div></div>
        <button class="btn secondary" style="width:auto;padding:8px 12px" data-act="avail-toggle">${avail === 'online' ? 'Go offline' : 'Go online'}</button>
      </div>
      <div class="drv-body">${body}</div>`;
    this.updateNav();
    this.bindFilters();
  },

  bindFilters() {
    document.querySelectorAll('[data-filter-days]').forEach((sel) => {
      sel.onchange = async () => {
        const kind = sel.dataset.filterDays;
        const val = sel.value;
        if (val === 'custom') {
          this.setFilterRange(kind, document.getElementById(`filter-from-${kind}`)?.value, document.getElementById(`filter-to-${kind}`)?.value, 'custom');
          return;
        }
        const range = this.dateRange(Number(val));
        this.setFilterRange(kind, range.from, range.to, Number(val));
        this.renderBody();
        await this.refresh();
        this.renderBody();
      };
    });
    ['history', 'earnings', 'payments'].forEach((kind) => {
      document.querySelector(`[data-act="apply-custom-${kind}"]`)?.addEventListener('click', async () => {
        const from = document.getElementById(`filter-from-${kind}`)?.value;
        const to = document.getElementById(`filter-to-${kind}`)?.value;
        if (!from || !to) return this.toast('Pick from and to dates', 'error');
        if (from > to) return this.toast('From date must be before To date', 'error');
        this.setFilterRange(kind, from, to, 'custom');
        if (kind === 'earnings') {
          this.earnings = await DriverAPI.earnings({ from, to });
        } else if (kind === 'payments') {
          this.payments = await DriverAPI.payments({ from, to });
        } else {
          this.history = await DriverAPI.history({ from, to, limit: 200 });
        }
        this.renderBody();
      });
    });
  },

  historyCard(o) {
    const title = o.delivery_number || o.confirmation_code || 'Delivery';
    const addr = o.delivery_address ? this.esc(o.delivery_address) : '—';
    return `<button type="button" class="history-card" data-history-id="${o.id}">
      <div class="history-card-top">
        <div>
          <strong>${this.esc(title)}</strong>
          <div style="margin-top:6px">${this.statusBadge(o.status)}</div>
          <p class="muted" style="margin:8px 0 0;font-size:13px">${addr}</p>
          <p class="muted" style="margin:4px 0 0;font-size:12px">${this.formatDateTimeLabel(o.delivered_at || o.updated_at)}</p>
        </div>
        <div style="text-align:right">
          <strong style="color:var(--accent);font-size:1.1rem">${this.money(o.delivery_fee)}</strong>
          <div class="history-chevron">›</div>
        </div>
      </div>
    </button>`;
  },

  orderCard(o, opts = {}) {
    const items = (o.items || []).slice(0, 6).map((i) => `${i.quantity || 1}× ${i.name || i.product_name}`).join(', ');
    const delNum = o.delivery_number || o.confirmation_code || 'Delivery';
    const code = o.confirmation_code || o.delivery_number || '';
    const phone = o.customer_phone || '';
    const name = o.customer_name || 'Customer';
    const pool = opts.pool;
    const st = String(o.status || '').toLowerCase();
    return `<div class="order-card" data-id="${o.id}">
      <h3>${this.esc(delNum)} — ${this.esc(st || '—')}</h3>
      ${code ? `<p class="delivery-code">Handoff code: <strong>${this.esc(code)}</strong></p>` : ''}
      <div class="customer-block">
        <p><strong>${this.esc(name)}</strong></p>
        ${phone ? `<p class="muted">📞 ${this.esc(phone)}</p>` : ''}
        <p>${this.esc(o.delivery_address || '—')}</p>
        <div class="order-actions contact-row">
          ${phone ? `<a class="drv-btn secondary contact-btn" href="${this.phoneLink(phone)}">📞 Call</a>` : ''}
          ${phone ? `<a class="drv-btn secondary contact-btn" href="${this.whatsappLink(phone)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
        </div>
      </div>
      <p class="muted">${this.esc(items)}</p>
      <p><strong>Your fee: ${this.money(o.delivery_fee)}</strong></p>
      <div class="order-actions">
        ${pool || st === 'awaiting_driver' ? '<button class="drv-btn" data-act="accept">Accept delivery</button>' : ''}
        ${st === 'assigned' ? '<button class="drv-btn" data-act="accept">Accept</button><button class="drv-btn warn secondary" data-act="reject">Reject (pickup at store)</button>' : ''}
        ${['driver_accepted', 'assigned', 'picked_up'].includes(st) ? '<button class="drv-btn warn secondary" data-act="release">Release to other drivers</button>' : ''}
        ${['driver_accepted', 'assigned', 'picking_up'].includes(st) ? '<button class="drv-btn" data-act="picked_up">Picked up</button>' : ''}
        ${st === 'picked_up' ? '<button class="drv-btn" data-act="on_way">On the way</button>' : ''}
        ${['picked_up', 'on_way'].includes(st) ? '<button class="drv-btn" data-act="delivered">Delivered</button>' : ''}
        ${!pool && !['delivered', 'failed', 'cancelled'].includes(st) ? '<button class="drv-btn warn secondary" data-act="failed">Unable to deliver</button>' : ''}
      </div>
    </div>`;
  },

  bindLogin() {
    document.getElementById('app').onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn?.dataset.act === 'forgot-password') { await this.showForgotPassword(); return; }
      if (btn?.dataset.act !== 'login') return;
      try {
        const r = await DriverAPI.login(document.getElementById('drv-user').value.trim(), document.getElementById('drv-pass').value, this.deviceInfo());
        this.token = r.token;
        localStorage.setItem('driver_token', r.token);
        sessionStorage.setItem('driver_token', r.token);
        this.initNotify();
        await this.refresh();
        this.view = 'main';
        this.tab = 'home';
        this._loggedIn = true;
        this.bindExitGuard();
        this.startPolling();
        this.render();
      } catch (err) {
        const msg = String(err.message || 'Incorrect username or password');
        this.toast(msg.includes('does not exist') ? 'System updating — try again in a minute.' : msg, 'error');
        if (!msg.includes('does not exist')) {
          window.alert(`Sign in failed\n\n${msg.includes('Invalid') || msg.includes('password') || msg.includes('credentials') ? msg : 'Incorrect username or password. Please try again.'}`);
        }
      }
    };
  },

  bindMain() {
    const app = document.getElementById('app');
    app.onchange = (e) => {
      if (e.target.id === 'drv-notify') {
        const on = e.target.checked;
        window.PanelNotify?.setSoundEnabled('driver', on);
        PanelSound?.setEnabled(on);
        if (!on) this.stopDeliveryAlert();
      }
    };
    app.onclick = async (e) => {
      if (e.target.closest('a.contact-btn')) return;
      const histBtn = e.target.closest('[data-history-id]');
      if (histBtn) {
        const id = Number(histBtn.dataset.historyId);
        this.historyDetail = (this.history || []).find((o) => Number(o.id) === id)
          || (this.earnings?.rows || []).find((o) => Number(o.id) === id)
          || null;
        this.renderBody();
        return;
      }
      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('[data-id]');
      const id = card?.dataset?.id;
      const act = btn?.dataset?.act;
      if (act === 'history-back') {
        this.historyDetail = null;
        this.renderBody();
        return;
      }
      if (act === 'open-profile') {
        this.tab = 'profile';
        this.profileEditing = false;
        this.updateNav();
        this.renderBody();
        this.refreshTabBackground();
        return;
      }
      if (act === 'edit-profile') {
        this.profileEditing = true;
        this.renderBody();
        return;
      }
      if (act === 'toggle-notify') {
        const on = document.getElementById('drv-notify')?.checked !== false;
        window.PanelNotify?.setSoundEnabled('driver', on);
        PanelSound?.setEnabled(on);
        if (!on) this.stopDeliveryAlert();
        this.toast(on ? 'Notifications on' : 'Notifications off', 'success');
        return;
      }
      if (act === 'cancel-profile-edit') {
        this.profileEditing = false;
        this.renderBody();
        return;
      }
      if (act === 'save-profile') {
        try {
          const data = {
            full_name: document.getElementById('pf-name')?.value.trim(),
            phone: document.getElementById('pf-phone')?.value.trim(),
            email: document.getElementById('pf-email')?.value.trim(),
            id_number: document.getElementById('pf-id')?.value.trim(),
            address: document.getElementById('pf-address')?.value.trim(),
            vehicle_info: document.getElementById('pf-vehicle')?.value.trim(),
            vehicle_registration: document.getElementById('pf-reg')?.value.trim(),
            bank_name: document.getElementById('pf-bank')?.value.trim(),
            bank_account: document.getElementById('pf-account')?.value.trim(),
            bank_branch_code: document.getElementById('pf-branch')?.value.trim()
          };
          const selfieFile = document.getElementById('pf-selfie')?.files?.[0];
          const idFile = document.getElementById('pf-id-photo')?.files?.[0];
          const vehicleFiles = [...(document.getElementById('pf-vehicle-photos')?.files || [])];
          if (selfieFile) data.selfie = await this.fileToDataUrl(selfieFile);
          if (idFile) data.id_photo = await this.fileToDataUrl(idFile);
          if (vehicleFiles.length) {
            data.vehicle_photos = await Promise.all(vehicleFiles.slice(0, 5).map((f) => this.fileToDataUrl(f)));
          }
          const newPass = document.getElementById('pf-new-pass')?.value || '';
          if (newPass) {
            data.new_password = newPass;
            data.current_password = document.getElementById('pf-current-pass')?.value || '';
          }
          this.profile = await DriverAPI.updateProfile(data);
          this.profileEditing = false;
          await this.refresh();
          this.toast('Profile updated', 'success');
          this.renderBody();
        } catch (err) { this.toast(err.message, 'error'); }
        return;
      }
      if (!act) return;
      if (act === 'avail-toggle') {
        const next = this.dash?.driver?.availability === 'online' ? 'offline' : 'online';
        if (this.dash?.driver) this.dash.driver.availability = next;
        this.renderBody();
        try {
          await DriverAPI.availability(next);
          await this.refresh();
          this.renderBody();
        } catch (err) {
          this.toast(err.message, 'error');
          await this.refresh();
          this.renderBody();
        }
        return;
      }
      if (act === 'accept' && id) {
        const oid = String(id);
        if (this._acceptingIds.has(oid)) return;
        this._acceptingIds.add(oid);
        const picked = (this.available || []).find((o) => String(o.id) === oid)
          || (this.orders || []).find((o) => String(o.id) === oid);
        if (picked) {
          this.available = (this.available || []).filter((o) => String(o.id) !== oid);
          const without = (this.orders || []).filter((o) => String(o.id) !== oid);
          this.orders = [...without, { ...picked, status: 'driver_accepted' }];
          this._normalizeOrderLists();
          this.renderBody();
        }
        try {
          await DriverAPI.accept(id);
          await PanelNotify?.ack(this._poolKey(id), 'accepted');
          await PanelNotify?.ack(`delivery_assigned:${id}`, 'accepted');
          this.syncOrderAlerts();
          this.toast('Delivery accepted');
          await this.refresh();
          this.renderBody();
        } catch (err) {
          this.toast(err.message, 'error');
          await this.refresh();
          this.renderBody();
        } finally {
          this._acceptingIds.delete(oid);
        }
        return;
      }
      if (act === 'release' && id) {
        const reason = prompt('Release this delivery for another driver? Optional reason:') ?? '';
        if (reason === null) return;
        this.orders = (this.orders || []).filter((o) => String(o.id) !== String(id));
        this._normalizeOrderLists();
        this.renderBody();
        try {
          await DriverAPI.release(id, reason || 'Released for another driver');
          PanelNotify?.ack(this._poolKey(id), 'released');
          this.syncDeliveryAlert();
          this.toast('Delivery released — another driver can accept it', 'success');
          await this.refresh();
          this.renderBody();
        } catch (err) {
          this.toast(err.message, 'error');
          await this.refresh();
          this.renderBody();
        }
        return;
      }
      if (act === 'reject' && id) {
        const reason = prompt('Reason?') || 'Unavailable';
        this.orders = (this.orders || []).filter((o) => String(o.id) !== String(id));
        this.available = (this.available || []).filter((o) => String(o.id) !== String(id));
        this._normalizeOrderLists();
        this.renderBody();
        try {
          await DriverAPI.reject(id, reason);
          this.syncDeliveryAlert();
          await this.refresh();
          this.renderBody();
        } catch (err) {
          this.toast(err.message, 'error');
          await this.refresh();
          this.renderBody();
        }
        return;
      }
      if (act === 'picked_up' && id || act === 'on_way' && id || act === 'delivered' && id || act === 'failed' && id) {
        const statusMap = { picked_up: 'picked_up', on_way: 'on_way', delivered: 'delivered', failed: 'failed' };
        const status = statusMap[act];
        let reason;
        if (act === 'failed') reason = prompt('Reason?') || 'Failed';
        this.orders = (this.orders || []).map((o) => String(o.id) === String(id) ? { ...o, status } : o);
        if (status === 'delivered') this.orders = this.orders.filter((o) => String(o.id) !== String(id));
        this.renderBody();
        try {
          await DriverAPI.updateStatus(id, status, reason);
          if (act === 'delivered') {
            this.showModal({
              title: 'Successfully delivered',
              body: '<p style="text-align:center;font-size:1.05rem;margin:12px 0">✅ Delivery completed!</p><p class="muted" style="text-align:center">The customer has received their order.</p>',
              actions: '<button type="button" class="drv-btn drv-modal-close-btn">OK</button>'
            });
            document.querySelector('.drv-modal-close-btn')?.addEventListener('click', () => this.hideModal());
          } else if (act === 'on_way') {
            this.toast('On the way — customer notified', 'success');
          }
          await this.refresh();
          this.renderBody();
        } catch (err) {
          this.toast(err.message, 'error');
          await this.refresh();
          this.renderBody();
        }
        return;
      }
      if (act === 'payout-pdf') {
        const pid = Number(btn.dataset.payoutId);
        try {
          const r = await DriverAPI.payoutPdf(pid);
          const data = r?.pdf ? r : (r?.data || r);
          this.downloadPdfBase64(data.pdf, data.filename || `payment-${pid}.pdf`);
        } catch (err) { this.toast(err.message || 'PDF failed', 'error'); }
        return;
      }
      if (act === 'payout-view') {
        const pid = Number(btn.dataset.payoutId);
        const pay = (this.payments?.payouts || []).find((p) => Number(p.id) === pid);
        if (pay) await this.showPaymentReceivedModal(pay);
        return;
      }
      if (act === 'submit-claim') {
        try {
          await DriverAPI.submitClaim();
          this.toast('Claim submitted — admin will review and pay you', 'success');
          await this.refresh();
          this.renderBody();
        } catch (err) { this.toast(err.message, 'error'); }
      }
    };
  }
};

DriverApp.init();
