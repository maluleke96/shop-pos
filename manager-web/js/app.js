/* Business Manager — owner/manager monitoring app */
const ManagerApp = {
  view: 'splash',
  tab: 'home',
  token: sessionStorage.getItem('manager_token') || '',
  user: null,
  shop: null,
  period: 'month',
  customFrom: '',
  customTo: '',
  dashboard: null,
  orders: [],
  alerts: [],
  posStatus: [],
  orderDetail: null,
  onlineOrders: [],
  onlineTab: 'pending',
  branchFilter: localStorage.getItem('manager_branch_filter') || 'all',
  prefs: null,
  lastAlertId: 0,
  lastUpdated: null,
  _pollTimer: null,
  _dashTimer: null,
  _midnightTimer: null,
  _pendingOrderAlert: false,
  _pendingOnlineOrders: [],
  _popupOrderId: null,
  _quietUntil: {},
  _knownAvailableIds: new Set(),
  _stateKey: 'manager_app_state',

  localTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  periodSubtitle(d = {}) {
    const branch = this.branchFilter === 'all' ? 'All branches' : (this.selectedBranch()?.name || 'Branch');
    const period = d.period || 'Today';
    if (d.period_from && d.period_to && d.period_from !== d.period_to) {
      return `${branch} · ${period} (${d.period_from} → ${d.period_to})`;
    }
    if (d.period_from) return `${branch} · ${period} (${d.period_from})`;
    return `${branch} · ${period}`;
  },

  orderEventKey(o) {
    const id = o?.online_order_id || (String(o?.id || '').startsWith('online:') ? String(o.id).slice(7) : o?.id);
    return `online_pending:${id}`;
  },

  alertEventKey(alert) {
    const p = alert?.payload || {};
    if (p.online_order_id) return `online_pending:${p.online_order_id}`;
    if (p.sale_id) return `pos_sale:${p.sale_id}`;
    return `mgr_alert:${alert?.id || Date.now()}`;
  },

  isOrderMuted(orderId) {
    const until = this._quietUntil[String(orderId)];
    return until && Date.now() < until;
  },

  snoozeOrderPopup(orderId, minutes = 30) {
    this._quietUntil[String(orderId)] = Date.now() + minutes * 60 * 1000;
    window.PanelSound?.stop();
  },

  soundEnabled() {
    return this.prefs?.new_orders !== false && window.PanelNotify?.isSoundEnabled('manager') !== false;
  },

  _saveState() {
    try {
      const data = {
        tab: this.tab,
        period: this.period,
        onlineTab: this.onlineTab,
        branchFilter: this.branchFilter,
        customFrom: this.customFrom,
        customTo: this.customTo
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
      if (o.period) this.period = o.period;
      if (o.onlineTab) this.onlineTab = o.onlineTab;
      if (o.branchFilter) this.branchFilter = o.branchFilter;
      if (o.customFrom) this.customFrom = o.customFrom;
      if (o.customTo) this.customTo = o.customTo;
    } catch (_) { /* ignore */ }
  },

  money(n) { return `R${(Number(n) || 0).toFixed(2)}`; },
  dailyMoneyRowsHtml(dm) {
    if (!dm) return '';
    return `<div class="daily-money-box">
      <div class="branch-day-date">Today's money</div>
      <div class="row"><span>Money in</span><span>${this.money(dm.money_in)}</span></div>
      <div class="row"><span>Expenses from today's money</span><span>${this.money(dm.expenses_today)}</span></div>
      <div class="row"><span>Withdrawals from today's money</span><span>${this.money(dm.withdrawals_today)}</span></div>
      <div class="row" style="font-weight:800"><span>Net today's money</span><span>${this.money(dm.net_today)}</span></div>
      ${Number(dm.from_previous) ? `<div class="row"><span>Paid from previous money</span><span>${this.money(dm.from_previous)}</span></div>` : ''}
    </div>`;
  },
  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  normalizePhone(phone) {
    const d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('27')) return d;
    if (d.startsWith('0')) return '27' + d.slice(1);
    return d;
  },
  contactActionsHtml(phone, email) {
    const actions = [];
    const tel = String(phone || '').trim();
    const em = String(email || '').trim();
    if (tel) {
      const wa = this.normalizePhone(tel);
      actions.push(`<a href="tel:${encodeURIComponent(tel)}" class="contact-btn" title="Call customer" onclick="event.stopPropagation()">📞</a>`);
      actions.push(`<a href="https://wa.me/${wa}" target="_blank" rel="noopener" class="contact-btn" title="WhatsApp customer" onclick="event.stopPropagation()">💬</a>`);
    }
    if (em) {
      actions.push(`<a href="mailto:${encodeURIComponent(em)}" class="contact-btn" title="Email customer" onclick="event.stopPropagation()">✉️</a>`);
    }
    return actions.length ? `<div class="contact-actions">${actions.join('')}</div>` : '';
  },
  selectedBranch() {
    if (!this.branchFilter || this.branchFilter === 'all') return null;
    return (this.user?.branches || []).find((b) => String(b.id) === String(this.branchFilter));
  },
  shopHeaderHtml() {
    const shop = this.shop || {};
    const branch = this.selectedBranch();
    const phone = branch?.phone || shop.phone || '';
    return `<div class="shop-header">
      <div data-shop-logo class="shop-logo-wrap"></div>
      <div class="shop-info">
        <strong class="shop-name">${this.esc(shop.shop_name || 'Business Manager')}</strong>
        ${shop.address ? `<div class="meta">${this.esc(shop.address)}</div>` : ''}
        ${phone ? `<div class="meta shop-phone">📞 ${this.esc(phone)}</div>` : ''}
        ${branch ? `<div class="meta branch-tag">${this.esc(branch.name)}</div>` : ''}
      </div>
    </div>`;
  },
  branchFilters() {
    const f = { period: this.period };
    if (this.period === 'custom' && this.customFrom && this.customTo) {
      f.from = this.customFrom;
      f.to = this.customTo;
    }
    if (this.branchFilter && this.branchFilter !== 'all') f.branch_id = this.branchFilter;
    return f;
  },
  branchSelectorHtml() {
    const branches = this.user?.branches || [];
    const canPick = branches.length > 1 || this.user?.permissions?.view_all_branches;
    if (!canPick) return '';
    return `<select id="branch-filter" class="filter-select" style="margin-bottom:8px">
      <option value="all" ${this.branchFilter === 'all' ? 'selected' : ''}>All branches</option>
      ${branches.map((b) => `<option value="${b.id}" ${String(this.branchFilter) === String(b.id) ? 'selected' : ''}>${this.esc(b.name)}</option>`).join('')}
    </select>`;
  },
  orderFinancialHtml(o) {
    const rows = [];
    if (o.subtotal != null) rows.push(`<div class="row"><span>Subtotal</span><span>${this.money(o.subtotal)}</span></div>`);
    if (Number(o.discount) > 0) {
      rows.push(`<div class="row"><span>Discount${o.discount_type ? ` (${this.esc(o.discount_type)})` : ''}</span><span>-${this.money(o.discount)}</span></div>`);
    }
    if (Number(o.gift_card_amount) > 0 && o.gift_card_code) {
      rows.push(`<div class="row"><span>Gift card <code>${this.esc(o.gift_card_code)}</code></span><span>-${this.money(o.gift_card_amount)}</span></div>`);
    }
    if (Number(o.delivery_fee) > 0) rows.push(`<div class="row"><span>Delivery fee</span><span>${this.money(o.delivery_fee)}</span></div>`);
    if (Number(o.tax_amount) > 0) rows.push(`<div class="row"><span>Tax (VAT)</span><span>${this.money(o.tax_amount)}</span></div>`);
    if (o.coupon_code) rows.push(`<div class="row"><span>Coupon</span><span>${this.esc(o.coupon_code)}</span></div>`);
    if (Number(o.loyalty_points_used) > 0) rows.push(`<div class="row"><span>Loyalty points</span><span>${o.loyalty_points_used} pts</span></div>`);
    rows.push(`<div class="row" style="font-weight:800;font-size:1.1rem"><span>Total</span><span>${this.money(o.total)}</span></div>`);
    if (o.payments_detail?.length) {
      rows.push(`<div class="row" style="flex-direction:column;align-items:flex-start;gap:4px"><span>Payments</span>
        ${o.payments_detail.map((p) => `<div class="meta">${this.esc(p.type)}${p.gift_card_code ? ` (${this.esc(p.gift_card_code)})` : ''}: ${this.money(p.amount)}</div>`).join('')}</div>`);
    } else if (o.payment) {
      rows.push(`<div class="row"><span>Payment</span><span>${this.esc(o.payment)}${o.payment_status ? ` · ${this.esc(o.payment_status)}` : ''}</span></div>`);
    }
    if (Number(o.amount_paid) > 0) rows.push(`<div class="row"><span>Amount paid</span><span>${this.money(o.amount_paid)}</span></div>`);
    if (Number(o.change_amount) > 0) rows.push(`<div class="row"><span>Change</span><span>${this.money(o.change_amount)}</span></div>`);
    return rows.join('');
  },
  playAlertSound() {
    if (this.prefs?.new_orders === false) return;
    if (window.PanelNotify && !PanelNotify.isSoundEnabled('manager')) return;
    if (window.PanelSound) PanelSound.playOnce();
    else this._synthBeep();
  },
  _synthBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const play = (freq, delay) => {
        setTimeout(() => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value = freq;
          g.gain.value = 0.1;
          o.start();
          setTimeout(() => { o.stop(); }, 200);
        }, delay);
      };
      play(880, 0); play(1100, 250);
    } catch (_) { /* no audio */ }
  },
  toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  async loadLoginBranding() {
    try {
      const res = await fetch(`${ManagerAPI.rpcUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'web:getSettings', args: [] })
      });
      const json = await res.json();
      const s = json.data || json;
      const meta = document.getElementById('login-shop-meta');
      if (meta) {
        const parts = [s.address, s.phone].filter(Boolean);
        meta.textContent = parts.join(' · ');
      }
      if (window.PanelBrand) window.PanelBrand.apply();
    } catch (_) { if (window.PanelBrand) window.PanelBrand.apply(); }
  },

  initNotify() {
    if (!window.PanelNotify || this._notifyReady) return;
    this._notifyReady = true;
    PanelNotify.init({
      panel: 'manager',
      loggedIn: () => !!this.token,
      rpc: (method, args) => ManagerAPI.call(method, args)
    });
    const saved = localStorage.getItem('mgr_last_alert_id');
    if (saved) this.lastAlertId = Number(saved) || 0;
  },

  saveAlertCursor() {
    try { localStorage.setItem('mgr_last_alert_id', String(this.lastAlertId || 0)); } catch (_) { /* */ }
  },

  deviceInfo() {
    const uid = localStorage.getItem('manager_device_uid') || `mgr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('manager_device_uid', uid);
    return {
      device_uid: uid,
      device_name: navigator.userAgent.includes('Android') ? 'Android Device' : 'Mobile Device',
      platform: /android/i.test(navigator.userAgent) ? 'android' : 'web'
    };
  },

  async init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    this._loadState();
    try { localStorage.removeItem('manager_token'); } catch (_) { /* migrate to sessionStorage */ }
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('order/')) this._deepOrder = hash.split('/')[1];
    const hashParams = new URLSearchParams(hash.includes('=') ? hash : '');
    const hashToken = hashParams.get('token');
    if (hashToken) {
      this.token = hashToken;
      sessionStorage.setItem('manager_token', hashToken);
      history.replaceState(null, '', location.pathname + location.search);
    }
    this.view = this.token ? 'splash' : 'login';
    this.render();
    if (this.token) {
      try {
        const p = await ManagerAPI.profile();
        this.user = p.user;
        this.shop = p.shop || null;
        this.prefs = p.notification_prefs;
        this.initNotify();
        PanelNotify?.requestPermission?.();
        PanelSound?.setPanel('manager');
        PanelSound?.setEnabled(PanelNotify?.isSoundEnabled('manager') !== false);
        this.view = 'main';
        await this.refresh();
        if (this._deepOrder) { this.tab = 'orders'; await this.openOrder(this._deepOrder); }
        this._saveState();
      } catch (_) {
        this.token = '';
        sessionStorage.removeItem('manager_token');
        this.view = 'login';
      }
    } else {
      this.view = 'login';
    }
    this.render();
    if (window.PanelBrand) window.PanelBrand.apply();
    this.startPolling();
    this.scheduleMidnightRefresh();
    this.bindVisibilityAlerts();
    window.addEventListener('online', () => this.refresh());
    const unlock = () => { try { window.PanelSound?.startLoop?.(); window.PanelSound?.stop?.(); } catch (_) { /* */ } };
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
  },

  isForeground() {
    return document.visibilityState === 'visible' && this.view === 'main';
  },

  bindVisibilityAlerts() {
    if (this._visBound) return;
    this._visBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.pollAlerts();
        if (this._popupOrderId) this.startAlertRing();
      }
    });
    try {
      window.Capacitor?.Plugins?.App?.addListener?.('appStateChange', (state) => {
        if (state?.isActive) {
          this.pollAlerts();
          if (this._popupOrderId) this.startAlertRing();
        }
      });
      window.Capacitor?.Plugins?.LocalNotifications?.addListener?.('localNotificationActionPerformed', () => {
        try { window.focus(); } catch (_) { /* */ }
      });
    } catch (_) { /* web */ }
  },

  startAlertRing() {
    if (!this.soundEnabled()) return;
    if (this._popupOrderId && this.isOrderMuted(this._popupOrderId)) return;
    if (window.PanelSound) {
      PanelSound.setPanel('manager');
      PanelSound.setEnabled(true);
      PanelSound.syncPending(true);
    } else {
      this.playAlertSound();
    }
  },

  showHeadsUp(title, body, onTap) {
    let el = document.getElementById('mgr-heads-up');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mgr-heads-up';
      el.className = 'mgr-heads-up';
      document.body.appendChild(el);
    }
    el.innerHTML = `<strong>${this.esc(title || 'New order')}</strong>
      <span>${this.esc(String(body || '').split('\n')[0] || '')}</span>
      <small>Tap to open</small>`;
    el.classList.remove('hidden');
    el.onclick = () => {
      el.classList.add('hidden');
      this.startAlertRing();
      if (typeof onTap === 'function') onTap();
    };
    this.startAlertRing();
    if (navigator.vibrate) {
      try { navigator.vibrate([180, 80, 180, 80, 180]); } catch (_) { /* */ }
    }
  },

  notifySystem(title, body, tag) {
    const url = `${location.origin}/manager/`;
    PanelNotify?.notifyBrowser(title, body, tag, { url });
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN) return;
    const id = Math.abs(String(tag || title || Date.now()).split('').reduce((s, c) => ((s * 31) + c.charCodeAt(0)) | 0, 0)) || Date.now();
    Promise.resolve(LN.requestPermissions?.())
      .then(() => LN.schedule({
        notifications: [{
          title: title || 'New order',
          body: String(body || '').slice(0, 180),
          id: id % 2147483647,
          extra: { url }
        }]
      }))
      .catch(() => {});
  },

  scheduleMidnightRefresh() {
    if (this._midnightTimer) clearTimeout(this._midnightTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    this._midnightTimer = setTimeout(() => {
      if (this.period === 'today') {
        this.dashboard = null;
        this.orders = [];
        this.alerts = [];
        this.refresh({ silent: true });
      }
      this.scheduleMidnightRefresh();
    }, Math.max(1000, next - now));
  },

  isEditingDates() {
    const ae = document.activeElement;
    return !!(ae && (ae.id === 'custom-from' || ae.id === 'custom-to' || ae.closest?.('.period-toolbar')));
  },

  startDashboardPolling() {
    if (this._dashTimer) clearInterval(this._dashTimer);
    this._dashTimer = setInterval(() => {
      if (!this.token || this.view !== 'main') return;
      if (this.isEditingDates()) return;
      if (this.tab === 'home' || this.tab === 'branches' || this._pendingOnlineOrders?.length) {
        this.refresh({ silent: true });
      }
    }, 8000);
  },

  stopDashboardPolling() {
    if (this._dashTimer) { clearInterval(this._dashTimer); this._dashTimer = null; }
  },

  startPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this.pollAlerts(), 4000);
    this.pollAlerts();
    this.startDashboardPolling();
  },

  async pollAlerts() {
    if (!this.token) return;
    try {
      const fresh = await ManagerAPI.poll(this.lastAlertId);
      if (fresh?.length) {
        this.lastAlertId = Math.max(...fresh.map((a) => a.id));
        this.saveAlertCursor();
        for (const alert of fresh) {
          if (!alert.payload && alert.payload_json) {
            try { alert.payload = JSON.parse(alert.payload_json); } catch (_) { alert.payload = {}; }
          }
          const ackKey = this.alertEventKey(alert);
          if ((alert.type === 'new_order' || alert.type === 'large_order') && !PanelNotify?.isAcked(ackKey)) {
            this.showAlertPopup(alert);
            this.startAlertRing();
            this.showHeadsUp(alert.title || 'New order', alert.body, () => this.showAlertPopup(alert));
            if (!this.isForeground()) {
              this.notifySystem(alert.title || 'New order', alert.body, ackKey);
            }
          }
        }
        await this.refresh({ silent: true });
      }
    } catch (_) { /* ignore */ }
  },

  async refresh(opts = {}) {
    if (!this.token) return;
    const silent = !!opts.silent;
    try {
      const filters = this.branchFilters();
      const branchOnly = this.branchFilter && this.branchFilter !== 'all' ? { branch_id: this.branchFilter } : {};
      const [dashR, alertsR, posR, pendingR, slaR] = await Promise.allSettled([
        ManagerAPI.dashboard(filters),
        ManagerAPI.alerts({ ...filters, limit: 50 }),
        ManagerAPI.posStatus(),
        ManagerAPI.pendingOnline(branchOnly),
        ManagerAPI.slaLive(branchOnly)
      ]);
      const authFail = [dashR, alertsR, posR].find((r) => r.status === 'rejected'
        && /session|revoked|not authenticated/i.test(r.reason?.message || ''));
      if (authFail) throw authFail.reason;
      if (dashR.status === 'fulfilled') {
        this.dashboard = dashR.value;
        this._loadError = '';
      } else {
        this._loadError = dashR.reason?.message || 'Could not load figures';
      }
      const alerts = alertsR.status === 'fulfilled' ? (alertsR.value || []) : (this.alerts || []);
      this.alerts = alerts;
      if (posR.status === 'fulfilled') this.posStatus = posR.value;
      this._pendingOnlineOrders = pendingR.status === 'fulfilled' ? (pendingR.value || []) : [];
      this.slaLive = slaR.status === 'fulfilled' ? slaR.value : null;
      this.lastUpdated = new Date();
      if (alerts.length) this.lastAlertId = Math.max(this.lastAlertId, ...alerts.map((a) => a.id));
      if (this.tab === 'orders') await this.loadOrders();
      if (this.tab === 'online') await this.loadOnlineOrders();
      this.syncOrderPopups();
      const pendingOnline = (this._pendingOnlineOrders || []).filter((o) => {
        const st = String(o.status || '').toLowerCase();
        return st === 'pending' && !o.sale_id && !(window.PanelNotify?.isAcked(this.orderEventKey(o)));
      });
      this._pendingOrderAlert = pendingOnline.length > 0;
      if (window.PanelNotify) {
        PanelNotify.syncPendingAlert(
          pendingOnline.filter((o) => !this.isOrderMuted(o.online_order_id || o.id)),
          (o) => this.orderEventKey(o),
          this.soundEnabled()
        );
      } else if (window.PanelSound) {
        PanelSound.syncPending(this._pendingOrderAlert && this.soundEnabled());
      }
      if (this.tab === 'staff') await this.loadStaffActivity();
      if (this.view === 'main') {
        // Silent polls must not wipe the logo or mid-edit date pickers
        if (silent && this.isEditingDates()) return;
        if (silent) {
          const logoHtml = document.querySelector('.shop-header [data-shop-logo]')?.innerHTML || '';
          this.render();
          const slot = document.querySelector('.shop-header [data-shop-logo]');
          if (slot && logoHtml) slot.innerHTML = logoHtml;
          else if (window.PanelBrand?.refreshSlots) PanelBrand.refreshSlots();
          return;
        }
        this.render();
      }
    } catch (err) {
      if (/session|revoked|not authenticated/i.test(err.message)) {
        this.token = '';
        this.view = 'login';
        if (!silent) this.render();
        return;
      }
      this._loadError = err.message || 'Could not load data';
      if (!silent && this.view === 'main') this.render();
    }
  },

  syncOrderPopups() {
    const pending = (this._pendingOnlineOrders || []).filter((o) => {
      const st = String(o.status || '').toLowerCase();
      return st === 'pending' && !o.sale_id;
    });
    pending.forEach((o) => {
      const oid = String(o.online_order_id || o.id);
      if (window.PanelNotify?.isAcked(this.orderEventKey(o))) return;
      if (this._popupOrderId === oid) return;
      if (this._popupOrderId) return;
      this.showOrderPopup(o);
      this.startAlertRing();
      this.showHeadsUp('New online order', `${o.order_number || ''} · ${this.money(o.total)}`, () => this.showOrderPopup(o));
      if (!this.isForeground()) {
        this.notifySystem(`New online order`, `${o.order_number || ''} · ${this.money(o.total)}`, this.orderEventKey(o));
      }
    });
  },

  showAlertPopup(alert) {
    if (!alert) return;
    const p = alert.payload || {};
    if (p.online_order_id) {
      const order = (this._pendingOnlineOrders || []).find((o) =>
        String(o.online_order_id || o.id) === String(p.online_order_id));
      if (order) {
        this.showOrderPopup(order, alert);
        return;
      }
    }
    this.showGenericAlertPopup(alert);
  },

  showGenericAlertPopup(alert) {
    const p = alert.payload || {};
    const ackKey = this.alertEventKey(alert);
    this._popupOrderId = ackKey;
    let root = document.getElementById('mgr-order-popup');
    if (!root) {
      root = document.createElement('div');
      root.id = 'mgr-order-popup';
      root.className = 'mgr-order-popup';
      document.body.appendChild(root);
    }
    const lines = String(alert.body || '').split('\n').filter(Boolean);
    const isPos = !!p.sale_id;
    root.innerHTML = `<div class="mgr-popup-card" role="dialog" aria-live="assertive">
      <div class="mgr-popup-head">
        <strong>${isPos ? '🛒 New POS sale' : '🛒 New order'}</strong>
        <span class="pill unread">${this.esc(alert.title || 'Alert')}</span>
      </div>
      ${lines.map((line) => `<p style="margin:4px 0">${this.esc(line)}</p>`).join('')}
      <p class="meta" style="margin-top:8px">This stays on screen until you dismiss it.</p>
      <div class="mgr-popup-actions">
        <button type="button" class="btn-sm btn-ghost" data-act="popup-dismiss" data-key="${this.esc(ackKey)}">Dismiss</button>
        <button type="button" class="btn-sm btn-primary" data-act="popup-goto-orders">View orders</button>
      </div>
    </div>`;
    root.classList.remove('hidden');
    root.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'popup-dismiss') {
        window.PanelNotify?.ack(btn.dataset.key, 'dismissed');
        window.PanelSound?.stop();
        this.closeOrderPopup(true);
        return;
      }
      if (btn.dataset.act === 'popup-goto-orders') {
        this.closeOrderPopup();
        this.tab = p.sale_id ? 'orders' : 'online';
        this.view = 'main';
        await this.refresh();
      }
    };
    this.startAlertRing();
  },

  showOrderPopup(order, alert) {
    if (!order) return;
    const oid = String(order.online_order_id || order.id);
    this._popupOrderId = oid;
    let root = document.getElementById('mgr-order-popup');
    if (!root) {
      root = document.createElement('div');
      root.id = 'mgr-order-popup';
      root.className = 'mgr-order-popup';
      document.body.appendChild(root);
    }
    const items = (order.items || []).slice(0, 6);
    const fulfillment = order.fulfillment_type || 'collection';
    root.innerHTML = `<div class="mgr-popup-card" role="dialog" aria-live="assertive">
      <div class="mgr-popup-head">
        <strong>🛒 New online order</strong>
        <span class="pill unread">Awaiting POS</span>
      </div>
      <p><strong>${this.esc(order.order_number)}</strong> · ${this.money(order.total)}</p>
      <p class="meta">${this.esc(order.branch_name || '')}${order.branch_name ? ' · ' : ''}${this.esc(fulfillment)}</p>
      <p><strong>${this.esc(order.customer_name || 'Customer')}</strong>${order.customer_phone ? `<br>${this.esc(order.customer_phone)}` : ''}</p>
      ${order.delivery_address ? `<p class="meta">${this.esc(order.delivery_address)}</p>` : ''}
      <ul class="mgr-popup-items">${items.map((i) =>
        `<li>${this.esc(i.name)} ×${i.quantity || 1}</li>`).join('')}</ul>
      <p class="meta" style="margin:0">This stays on screen until you dismiss it.</p>
      <div class="mgr-popup-actions">
        <button type="button" class="btn-sm btn-ghost" data-act="popup-dismiss" data-id="${this.esc(oid)}">Dismiss</button>
        <button type="button" class="btn-sm btn-ghost" data-act="popup-mute" data-id="${this.esc(oid)}">🔇 Mute sound</button>
        <button type="button" class="btn-sm btn-ghost" data-act="popup-view" data-id="online:${this.esc(oid)}">View order</button>
        <button type="button" class="btn-sm btn-primary" data-act="popup-online">Open POS Online</button>
      </div>
    </div>`;
    root.classList.remove('hidden');
    root.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'popup-dismiss') {
        window.PanelNotify?.ack(this.orderEventKey(order), 'dismissed');
        this.closeOrderPopup();
        return;
      }
      if (act === 'popup-mute') {
        this.snoozeOrderPopup(btn.dataset.id, 60);
        window.PanelSound?.stop();
        this.toast('Sound muted — popup stays until you dismiss it', 'info');
        return;
      }
      if (act === 'popup-view') {
        this.closeOrderPopup();
        await this.openOrder(btn.dataset.id);
        return;
      }
      if (act === 'popup-online') {
        this.closeOrderPopup();
        this.tab = 'online';
        this.onlineTab = 'pending';
        this.view = 'main';
        this.onlineOrders = [];
        await this.refresh();
        return;
      }
    };
    this.startAlertRing();
  },

  closeOrderPopup() {
    this._popupOrderId = null;
    window.PanelSound?.stop();
    document.getElementById('mgr-order-popup')?.classList.add('hidden');
  },

  isVoided(o) {
    return ['void', 'voided'].includes(String(o?.status || '').toLowerCase());
  },

  statusTagHtml(o) {
    const tags = [];
    if (this.isVoided(o)) tags.push('<small style="color:#fff;background:#b91c1c;border-radius:6px;padding:1px 6px;font-weight:700">VOIDED</small>');
    else if (o?.status && !['completed', 'pending', 'accepted'].includes(String(o.status).toLowerCase())) {
      tags.push(`<small style="color:#b45309;font-weight:700">${this.esc(o.status)}</small>`);
    }
    if (o?.edited_at) tags.push(`<small style="color:#1d4ed8;font-weight:700" title="Edited${o.edited_by ? ` by ${this.esc(o.edited_by)}` : ''}">Edited</small>`);
    return tags.length ? ` ${tags.join(' ')}` : '';
  },

  loadErrorHtml() {
    if (!this._loadError) return '';
    return `<div role="alert" style="margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b">
      Could not load the latest figures: ${this.esc(this._loadError)}
      <button type="button" class="btn-sm btn-ghost" data-act="refresh" style="margin-left:8px">Try again</button></div>`;
  },

  slaLiveSummaryHtml() {
    const s = this.slaLive;
    if (!s || s.enabled === false) return '';
    const c = s.counts || {};
    const top = (s.stations || [])[0];
    const late = (c.overdue || 0) + (c.critical || 0);
    if (!(c.active > 0) && !top) return '';
    return `<div class="list-card" style="margin-bottom:12px"><h3>⏱ Live order control</h3>
      <div class="stat-grid" style="margin-bottom:8px">
        <div class="stat-card"><div class="label">Active</div><div class="value">${c.active ?? 0}</div></div>
        <div class="stat-card"><div class="label">🟢 On time</div><div class="value">${c.on_time ?? 0}</div></div>
        <div class="stat-card"><div class="label">🟡 Warning</div><div class="value">${c.warning ?? 0}</div></div>
        <div class="stat-card"><div class="label">🔴 Late</div><div class="value">${late}</div></div>
      </div>
      ${top ? `<p class="meta" style="margin:0">Busiest: ${this.esc(String(top.station || 'kitchen').replace(/_/g, ' '))} (${top.active})</p>` : ''}
      <p class="meta" style="margin:6px 0 0">Full control in Admin → Order SLA & Live Control</p></div>`;
  },

  voidedPeriodLabel() {
    const names = { today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', custom: 'Custom range' };
    const name = names[this.period] || this.dashboard?.period || 'Selected period';
    const from = this.period === 'custom' ? this.customFrom : this.dashboard?.period_from;
    const to = this.period === 'custom' ? this.customTo : this.dashboard?.period_to;
    const range = from && to ? (from === to ? from : `${from} → ${to}`) : '';
    const branch = this.branchFilter && this.branchFilter !== 'all'
      ? (this.user?.branches || []).find((b) => String(b.id) === String(this.branchFilter))?.name
      : '';
    return [name, range, branch].filter(Boolean).join(' · ');
  },

  async showVoidedPopup() {
    this._voidedOrders = null;
    this._voidedError = null;
    this._voidedSearch = '';
    this.renderVoidedPopup();
    try {
      this._voidedOrders = await ManagerAPI.orders({ ...this.branchFilters(), status: 'voided', limit: 500 });
      this._voidedOrders = (this._voidedOrders || []).filter((o) => this.isVoided(o));
    } catch (err) {
      this._voidedOrders = [];
      this._voidedError = err.message || 'Could not load voided orders';
    }
    this.renderVoidedPopup();
  },

  voidedRowsHtml() {
    if (this._voidedOrders == null) return '<div class="empty">Loading voided orders…</div>';
    if (this._voidedError) return `<div class="empty" style="color:#b91c1c">${this.esc(this._voidedError)}</div>`;
    const q = String(this._voidedSearch || '').trim().toLowerCase();
    const list = this._voidedOrders.filter((o) => {
      if (!q) return true;
      const hay = [o.order_number, o.receipt_number, o.customer_name, o.customer_phone, o.cashier, o.void_reason,
        o.branch_name, o.order_type, String(o.total), ...(o.items || []).map((i) => i.product_name || i.name)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (!list.length) return `<div class="empty">${q ? 'No voided orders match your search' : 'No voided orders for this period'}</div>`;
    const sum = list.reduce((a, o) => a + (Number(o.total) || 0), 0);
    return `<p class="meta" style="margin:0 0 6px">${list.length} order${list.length === 1 ? '' : 's'} · ${this.money(sum)}</p>
      ${list.map((o) => `<button type="button" class="list-item" data-vact="open" data-id="${this.esc(o.id)}"
        style="display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--border);padding:10px 2px;color:inherit;cursor:pointer">
        <div style="min-width:0">
          <strong>${this.esc(o.order_number || o.receipt_number || `#${o.id}`)}</strong>
          <div class="meta">${this.esc(new Date(o.time).toLocaleString())}${o.cashier ? ` · ${this.esc(o.cashier)}` : ''}</div>
          ${o.customer_name ? `<div class="meta">${this.esc(o.customer_name)}</div>` : ''}
          ${o.void_reason ? `<div class="meta" style="color:#b91c1c">Reason: ${this.esc(o.void_reason)}</div>` : ''}
        </div>
        <strong style="text-decoration:line-through;color:#b91c1c;white-space:nowrap">${this.money(o.total)}</strong>
      </button>`).join('')}`;
  },

  renderVoidedPopup() {
    let root = document.getElementById('mgr-voided-popup');
    if (!root) {
      root = document.createElement('div');
      root.id = 'mgr-voided-popup';
      root.className = 'mgr-order-popup';
      document.body.appendChild(root);
    }
    root.innerHTML = `<div class="mgr-popup-card" role="dialog" style="max-height:85vh;display:flex;flex-direction:column">
      <div class="mgr-popup-head">
        <strong>🚫 Voided orders</strong>
        <button type="button" class="btn-sm btn-ghost" data-vact="close" aria-label="Close">✕</button>
      </div>
      <p class="meta" style="margin:0 0 8px">📅 ${this.esc(this.voidedPeriodLabel())}</p>
      <input type="search" id="voided-search" placeholder="Search receipt, customer, cashier, reason, product…"
        value="${this.esc(this._voidedSearch || '')}"
        style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);margin-bottom:8px">
      <div id="voided-rows" style="overflow-y:auto;flex:1">${this.voidedRowsHtml()}</div>
    </div>`;
    root.classList.remove('hidden');
    const search = root.querySelector('#voided-search');
    search.oninput = () => {
      this._voidedSearch = search.value;
      root.querySelector('#voided-rows').innerHTML = this.voidedRowsHtml();
    };
    root.onclick = async (e) => {
      if (e.target === root) { this.closeVoidedPopup(); return; }
      const btn = e.target.closest('[data-vact]');
      if (!btn) return;
      if (btn.dataset.vact === 'close') { this.closeVoidedPopup(); return; }
      if (btn.dataset.vact === 'open') {
        this.closeVoidedPopup();
        this._returnToVoided = true;
        await this.openOrder(btn.dataset.id);
      }
    };
  },

  closeVoidedPopup() {
    this._voidedError = null;
    document.getElementById('mgr-voided-popup')?.classList.add('hidden');
  },

  async loadOrders() {
    this.orders = await ManagerAPI.orders({ ...this.branchFilters(), limit: 50 });
  },

  async loadOnlineOrders() {
    this.onlineOrders = await ManagerAPI.onlineOrders({ ...this.branchFilters(), status: this.onlineTab, limit: 50 });
  },

  async loadStaffActivity() {
    this.staffActivity = await ManagerAPI.staffActivity(this.branchFilters()).catch(() => []);
  },

  orderIdFromAlert(a) {
    const p = a?.payload || {};
    if (p.sale_id) return String(p.sale_id);
    if (p.online_order_id) return `online:${p.online_order_id}`;
    return '';
  },

  periodToolbarHtml() {
    const from = this.period === 'custom' && this.customFrom
      ? this.customFrom
      : (this.dashboard?.period_from || this.localTodayStr());
    const to = this.period === 'custom' && this.customTo
      ? this.customTo
      : (this.dashboard?.period_to || this.localTodayStr());
    return `${this.branchSelectorHtml()}<div class="toolbar period-toolbar" style="flex-wrap:wrap">
      <select id="period-select" class="filter-select">
        <option value="today" ${this.period === 'today' ? 'selected' : ''}>Today</option>
        <option value="yesterday" ${this.period === 'yesterday' ? 'selected' : ''}>Yesterday</option>
        <option value="week" ${this.period === 'week' ? 'selected' : ''}>This week</option>
        <option value="month" ${this.period === 'month' ? 'selected' : ''}>This month</option>
        <option value="custom" ${this.period === 'custom' ? 'selected' : ''}>Custom range</option>
      </select>
      <label class="meta" style="display:flex;align-items:center;gap:6px">From
        <input type="date" id="custom-from" value="${this.esc(from)}" style="padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
      </label>
      <label class="meta" style="display:flex;align-items:center;gap:6px">To
        <input type="date" id="custom-to" value="${this.esc(to)}" style="padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
      </label>
      <button type="button" class="btn-primary btn-sm" data-act="apply-custom">Apply dates</button>
    </div>`;
  },

  async openOrder(id) {
    try {
      this.orderDetail = await ManagerAPI.order(id);
      this.view = 'order';
      this.render();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  navTabs() {
    const canStaff = this.user?.permissions?.view_staff_activity !== false
      && ['owner', 'manager', 'assistant_manager'].includes(this.user?.role);
    const tabs = [
      { id: 'home', icon: '🏠', label: 'Home' },
      { id: 'orders', icon: '📋', label: 'Orders' },
      { id: 'online', icon: '🛒', label: 'POS Online' },
      ...(canStaff ? [{ id: 'staff', icon: '👥', label: 'Staff' }] : []),
      { id: 'branches', icon: '🏢', label: 'Branches' },
      { id: 'alerts', icon: '🔔', label: 'Alerts' },
      { id: 'more', icon: '⋯', label: 'More' }
    ];
    return tabs;
  },

  bind() {
    const app = document.getElementById('app');
    app.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'tab') {
        this.tab = btn.dataset.tab;
        this.view = 'main';
        try { sessionStorage.setItem('manager_tab', this.tab); localStorage.setItem('manager_tab', this.tab); } catch (_) { /* ignore */ }
        this._saveState();
        this.render();
        if (this.tab === 'orders') this.orders = [];
        if (this.tab === 'online') this.onlineOrders = [];
        if (this.tab === 'staff') this.staffActivity = [];
        this.refresh();
        return;
      }
      if (act === 'login') {
        e.preventDefault?.();
        if (btn.disabled) return;
        const errEl = document.getElementById('login-error');
        const showErr = (msg) => {
          if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
          this.toast(msg, 'error');
        };
        if (errEl) errEl.style.display = 'none';
        const username = document.getElementById('login-user')?.value.trim() || '';
        const password = document.getElementById('login-pass')?.value || '';
        if (!username || !password) { showErr('Enter your username and password'); return; }
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Signing in…';
        let r;
        try {
          r = await ManagerAPI.login(username, password, this.deviceInfo());
        } catch (err) {
          btn.disabled = false;
          btn.textContent = label;
          showErr(err.message || 'Could not sign in');
          return;
        }
        if (!r?.token) {
          btn.disabled = false;
          btn.textContent = label;
          showErr('Sign-in failed — no session returned. Please try again.');
          return;
        }
        this.token = r.token;
        sessionStorage.setItem('manager_token', this.token);
        this.user = r.user;
        this.view = 'main';
        try { this.initNotify(); } catch (_) { /* optional */ }
        this.render();
        this.toast('Welcome back!', 'success');
        try { window.PanelExitGuard?.bind?.(() => { this.token=''; sessionStorage.removeItem('manager_token'); this.user=null; this.view='login'; window.PanelExitGuard?.unbind?.(); this.render(); }); } catch (_) {}
        try { this._saveState?.(); } catch (_) { /* */ }
        Promise.resolve(window.PanelNotify?.requestPermission?.()).catch(() => {});
        (async () => {
          try {
            const p = await ManagerAPI.profile();
            this.shop = p.shop || null;
            this.prefs = p.prefs || p.notification_prefs || this.prefs;
          } catch (_) { /* optional */ }
          try { await this.refresh(); } catch (err) { this.toast(err.message || 'Could not load dashboard', 'error'); }
        })();
        return;
      }
      if (act === 'logout') {
        try { await ManagerAPI.logout(); } catch (_) {}
        window.PanelNotify?.onLogout();
        this.closeOrderPopup();
        this.stopDashboardPolling();
        if (this._midnightTimer) clearTimeout(this._midnightTimer);
        this.token = '';
        sessionStorage.removeItem('manager_token');
        try { window.PanelExitGuard?.unbind?.(); } catch (_) {}
        this.user = null;
        this.view = 'login';
        this.render();
        return;
      }
      if (act === 'refresh') { await this.refresh(); return; }
      if (act === 'voided-list') { await this.showVoidedPopup(); return; }
      if (act === 'order') { await this.openOrder(btn.dataset.id); return; }
      if (act === 'back') {
        this.view = 'main'; this.orderDetail = null; this.render();
        if (this._returnToVoided) { this._returnToVoided = false; this.renderVoidedPopup(); }
        return;
      }
      if (act === 'period') { this.period = btn.dataset.period; await this.refresh(); return; }
      if (act === 'apply-custom') {
        this.customFrom = document.getElementById('custom-from')?.value || '';
        this.customTo = document.getElementById('custom-to')?.value || '';
        if (!this.customFrom || !this.customTo) { this.toast('Select from and to dates', 'error'); return; }
        this.period = 'custom';
        this.orders = [];
        await this.refresh();
        return;
      }
      if (act === 'mark-read') {
        await ManagerAPI.markRead([]);
        await this.refresh();
        this.toast('All marked as read', 'success');
        return;
      }
      if (act === 'save-prefs') {
        const prefs = { ...this.prefs };
        document.querySelectorAll('[data-pref]').forEach((el) => {
          prefs[el.dataset.pref] = el.type === 'checkbox' ? el.checked : Number(el.value);
        });
        const soundOn = document.getElementById('mgr-sound-enabled')?.checked !== false;
        window.PanelNotify?.setSoundEnabled('manager', soundOn);
        PanelSound?.setEnabled(soundOn);
        this.prefs = await ManagerAPI.savePrefs(prefs);
        this.toast('Settings saved', 'success');
        return;
      }
      if (act === 'online-tab') {
        this.onlineTab = btn.dataset.status || 'pending';
        this.onlineOrders = [];
        await this.loadOnlineOrders();
        this.render();
        return;
      }
      if (act === 'more-nav') { this.tab = 'more'; this.view = btn.dataset.screen || 'more'; this.render(); return; }
    };
    app.onchange = async (e) => {
      if (e.target.id === 'branch-filter') {
        this.branchFilter = e.target.value || 'all';
        try { localStorage.setItem('manager_branch_filter', this.branchFilter); } catch (_) { /* */ }
        this.orders = [];
        this.onlineOrders = [];
        await this.refresh();
      }
      if (e.target.id === 'order-search') {
        const q = e.target.value.trim();
        if (q.length >= 2) {
          this.orders = await ManagerAPI.searchOrders({ q });
          this.render();
        }
      }
      if (e.target.id === 'period-select') {
        this.period = e.target.value;
        if (this.period === 'custom') {
          this.customFrom = document.getElementById('custom-from')?.value || this.customFrom || this.localTodayStr();
          this.customTo = document.getElementById('custom-to')?.value || this.customTo || this.localTodayStr();
          this.render();
        } else {
          this.orders = [];
          this.alerts = [];
          await this.refresh();
        }
      }
    };
    if (window.PanelBrand?.refreshSlots) PanelBrand.refreshSlots();
    else this.afterRenderBrand();
  },

  shell(body) {
    const tabs = this.navTabs();
    const unread = this.alerts.filter((a) => !a.read).length;
    const header = this.view === 'main' ? this.shopHeaderHtml() : '';
    return `<div class="mgr-app">${header}${body}
      <nav class="bottom-nav">${tabs.map((t) =>
        `<button type="button" data-act="tab" data-tab="${t.id}" class="${this.tab === t.id && this.view === 'main' ? 'active' : ''}">
          <span class="icon">${t.icon}${t.id === 'alerts' && unread ? ' •' : ''}</span>${t.label}</button>`).join('')}
      </nav></div>`;
  },

  afterRenderBrand() {
    if (window.PanelBrand) window.PanelBrand.apply();
  },

  render() {
    const app = document.getElementById('app');
    if (this.view === 'login') {
      app.innerHTML = `<div class="auth-page"><form class="auth-card" id="mgr-login-form" novalidate>
        <div data-shop-logo class="login-logo"></div>
        <h1 data-shop-name>Business Manager</h1>
        <p class="sub login-shop-meta" id="login-shop-meta"></p>
        <p class="sub" style="color:var(--muted);margin:0 0 16px">Sign in with the same username and password you use for Admin or POS.</p>
        <label>Username<input id="login-user" autocomplete="username" required></label>
        <label>Password<input type="password" id="login-pass" autocomplete="current-password" required></label>
        <p id="login-error" role="alert" style="display:none;color:#b91c1c;font-weight:600;margin:0 0 10px"></p>
        <button type="submit" class="btn-primary" data-act="login">Sign in</button>
      </form></div>`;
      this.loadLoginBranding();
      this.bind();
      document.getElementById('mgr-login-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        document.querySelector('#mgr-login-form [data-act="login"]')?.click();
      });
      document.getElementById('login-user')?.focus();
      return;
    }
    if (this.view === 'order' && this.orderDetail) {
      const o = this.orderDetail;
      const hasCustomer = o.customer_name || o.customer_phone || o.customer_email;
      app.innerHTML = this.shell(`<div class="mgr-main">
        <button type="button" class="back-btn" data-act="back">← Back</button>
        <div class="order-detail">
          <h2>Order ${this.esc(o.order_number || o.receipt_number)}</h2>
          ${o.receipt_number && o.receipt_number !== o.order_number ? `<div class="row"><span>Receipt</span><span>${this.esc(o.receipt_number)}</span></div>` : ''}
          ${o.confirmation_code ? `<div class="row"><span>Delivery code</span><span><code>${this.esc(o.confirmation_code)}</code></span></div>` : ''}
          <div class="row"><span>Branch</span><span>${this.esc(o.branch_name)}</span></div>
          <div class="row"><span>Time</span><span>${this.esc(String(o.time).slice(0, 16))}</span></div>
          <div class="row"><span>Cashier</span><span>${this.esc(o.cashier || o.accepted_by || '—')}</span></div>
          <div class="row"><span>Status</span><span>${this.statusTagHtml(o) || this.esc(o.status)}</span></div>
          ${this.isVoided(o) && o.void_reason ? `<div class="row"><span>Void reason</span><span>${this.esc(o.void_reason)}</span></div>` : ''}
          ${o.edited_at ? `<div class="row"><span>Edited</span><span>${this.esc(new Date(o.edited_at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' }))}${o.edited_by ? ` by ${this.esc(o.edited_by)}` : ''}</span></div>` : ''}
          ${(o.edit_history || []).length ? `<div style="margin:6px 0 10px;padding:8px 10px;border-radius:8px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.35);font-size:13px">
            <strong style="color:#3b82f6">✎ What was edited</strong>
            ${o.edit_history.map((h) => `<div style="margin-top:6px">
              <div class="meta">${this.esc(String(h.at || '').slice(0, 16).replace('T', ' '))} · ${this.esc(h.by || 'Unknown')}${h.reason ? ` · “${this.esc(h.reason)}”` : ''}</div>
              ${(h.changes || []).length ? h.changes.map((c) => `<div>${this.esc(c)}</div>`).join('') : `<div>${this.esc((h.changed || []).join(', ') || 'Details updated')}</div>`}
            </div>`).join('')}
          </div>` : ''}
          ${o.order_source ? `<div class="row"><span>Source</span><span>${this.esc(o.order_source)}${o.is_online_pending ? ' (web — not on POS yet)' : ''}</span></div>` : ''}
          ${hasCustomer ? `<div class="customer-card">
            <div class="row" style="align-items:flex-start"><span>Customer</span>
              <div style="text-align:right">
                ${o.customer_code ? `<div class="meta">Code: <code>${this.esc(o.customer_code)}</code></div>` : ''}
                <strong>${this.esc(o.customer_name || '—')}</strong>
                ${o.customer_phone ? `<div class="meta">${this.esc(o.customer_phone)}</div>` : ''}
                ${o.customer_email ? `<div class="meta">${this.esc(o.customer_email)}</div>` : ''}
                ${this.contactActionsHtml(o.customer_phone, o.customer_email)}
              </div>
            </div>
          </div>` : ''}
          ${o.fulfillment_type ? `<div class="row"><span>Fulfillment</span><span>${this.esc(o.fulfillment_type)}</span></div>` : ''}
          ${o.delivery_address ? `<div class="row"><span>Delivery</span><span>${this.esc(o.delivery_address)}</span></div>` : ''}
          ${o.notes ? `<div class="row"><span>Notes</span><span>${this.esc(o.notes)}</span></div>` : ''}
          <h3 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase">Items</h3>
          <ul class="order-items">${(o.items || []).map((i) =>
            `<li>${this.esc(i.name)} × ${i.quantity}${i.modifiers_text ? ` <small>(${this.esc(i.modifiers_text)})</small>` : ''} <span style="float:right">${this.money(i.total || i.unit_price * i.quantity)}</span></li>`).join('')}</ul>
          <h3 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase">Financial summary</h3>
          ${this.orderFinancialHtml(o)}
        </div></div>`);
      this.bind();
      this.afterRenderBrand();
      return;
    }
    if (this.view === 'main' && this.tab === 'home') {
      const d = this.dashboard || {};
      app.innerHTML = this.shell(`<div class="mgr-header">
        <h1>${this.esc(d.greeting || 'Hello')}, ${this.esc(d.user_name || this.user?.full_name || '')}</h1>
        <div class="sub">${this.esc(this.periodSubtitle(d))}</div>
      </div><div class="mgr-main">
        ${this.periodToolbarHtml()}
        ${this.loadErrorHtml()}
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Orders</div><div class="value">${d.orders ?? 0}</div></div>
          <div class="stat-card"><div class="label">Sales</div><div class="value">${this.money(d.sales)}</div></div>
          <div class="stat-card wide"><div class="label">Average order</div><div class="value">${this.money(d.average_order)}</div></div>
        </div>
        <div class="stat-grid">
          <div class="stat-card"><div class="label">POS orders</div><div class="value">${d.pos_orders ?? 0}</div><small>${this.money(d.pos_sales)} sales</small></div>
          <div class="stat-card"><div class="label">Online orders</div><div class="value">${d.online_orders ?? 0}</div><small>${d.online_orders_pending ?? 0} pending · ${d.online_orders_accepted ?? 0} accepted</small></div>
        </div>
        <div class="stat-grid">
          <div class="stat-card" data-act="voided-list" role="button" tabindex="0" style="cursor:pointer;border:1px solid #fecaca"><div class="label">Voided ›</div><div class="value" style="color:#b91c1c">${d.voided_orders ?? 0}</div><small>${this.money(d.voided_sales)} not counted in sales · tap to view</small></div>
          <div class="stat-card"><div class="label">Alerts</div><div class="value">${d.alerts_count ?? 0}</div></div>
        </div>
        <div class="stat-grid">
          <div class="stat-card"><div class="label">POS tills online</div><div class="value">${d.tills_online ?? d.branches_online ?? 0}/${d.tills_registered ?? d.branches_total ?? 0}</div><small>${(d.tills_registered ?? 0) > 0 ? `${d.tills_registered} registered till(s)` : `${d.branches_total_count ?? d.branches_total ?? 0} branch(es)`}</small></div>
        </div>
        ${this.slaLiveSummaryHtml()}
        ${this._pendingOnlineOrders?.length ? `<p class="meta" style="margin:0 0 8px;color:var(--warn)">${this._pendingOnlineOrders.length} online order(s) waiting for POS acceptance</p>` : ''}
        <div class="list-card"><h3>Recent orders</h3>
          ${(d.recent_orders || []).map((o) =>
            `<div class="list-row" data-act="order" data-id="${o.id}">
              <div><strong>#${this.esc(o.number)}</strong>${o.order_source && o.order_source !== 'POS' ? ` <small>(${this.esc(o.order_source)})</small>` : ''}${Number(o.is_backdated) ? ' <small class="tag-warn">Backdated</small>' : ''}
              ${this.statusTagHtml(o)}
              <div class="meta">${this.esc(String(o.time).slice(0, 10))} ${this.esc(String(o.time).slice(11, 16))}</div></div>
              <strong style="${this.isVoided(o) ? 'text-decoration:line-through;color:#b91c1c' : ''}">${this.money(o.total)}</strong></div>`).join('') || '<div class="empty">No orders for this period</div>'}
        </div>
        ${this.lastUpdated ? `<div class="updated">Last updated: ${this.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · stats reset at midnight</div>` : ''}
      </div>`);
      this.bind();
      this.afterRenderBrand();
      return;
    }
    if (this.tab === 'orders') {
      const renderOrders = () => {
        app.innerHTML = this.shell(`<div class="mgr-header"><h1>Orders</h1>
          <div class="sub">${this.esc(this.dashboard?.period || 'Today')}</div></div><div class="mgr-main">
          ${this.periodToolbarHtml()}
          <input type="search" id="order-search" class="search-bar" placeholder="Search order number…" style="width:100%;margin-bottom:12px;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
          <div class="list-card">${this.orders.map((o) =>
            `<div class="list-row" data-act="order" data-id="${o.id}">
              <div style="min-width:0;flex:1"><strong>#${this.esc(o.order_number || o.receipt_number)}</strong>
                ${o.order_source && String(o.order_source).toUpperCase() !== 'POS' ? `<small> (${this.esc(o.order_source)})</small>` : ''}
                ${Number(o.is_backdated) ? ' <small style="color:#b45309;font-weight:700">Backdated</small>' : ''}
                ${this.statusTagHtml(o)}
                <div class="meta">${this.esc(o.branch_name)} · ${this.esc(String(o.time).slice(0, 10))} ${this.esc(String(o.time).slice(11, 16))} · ${this.esc(o.payment)}</div>
                ${o.customer_name ? `<div class="meta">${this.esc(o.customer_name)}${o.customer_phone ? ` · ${this.esc(o.customer_phone)}` : ''}</div>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${this.contactActionsHtml(o.customer_phone, o.customer_email)}
                <strong style="${this.isVoided(o) ? 'text-decoration:line-through;color:#b91c1c' : ''}">${this.money(o.total)}</strong>
              </div></div>`).join('') || `<div class="empty">${this._loadError ? this.esc(this._loadError) : 'No orders for this period'}</div>`}
          </div></div>`);
        this.bind();
      };
      if (this.orders.length) renderOrders();
      else {
        renderOrders();
        this.loadOrders().then(renderOrders).catch((err) => {
          this.toast(err.message, 'error');
          renderOrders();
        });
      }
      return;
    }
    if (this.tab === 'online') {
      const renderOnline = () => {
        const pending = this.onlineOrders.filter((o) => String(o.status).toLowerCase() === 'pending').length;
        app.innerHTML = this.shell(`<div class="mgr-header"><h1>POS Online</h1>
          <div class="sub">Live online orders · ${pending} pending · ${this.esc(this.dashboard?.period || 'Today')}</div></div><div class="mgr-main">
          ${this.periodToolbarHtml()}
          <div class="toolbar" style="margin-bottom:12px">
            <button type="button" class="btn-sm ${this.onlineTab === 'pending' ? 'btn-primary' : 'btn-ghost'}" data-act="online-tab" data-status="pending">Pending</button>
            <button type="button" class="btn-sm ${this.onlineTab === 'accepted' ? 'btn-primary' : 'btn-ghost'}" data-act="online-tab" data-status="accepted">Accepted</button>
            <button type="button" class="btn-sm ${this.onlineTab === 'all' ? 'btn-primary' : 'btn-ghost'}" data-act="online-tab" data-status="all">All</button>
          </div>
          <div class="list-card">${this.onlineOrders.map((o) =>
            `<div class="list-row" data-act="order" data-id="${o.id}">
              <div style="min-width:0;flex:1">
                <strong>#${this.esc(o.order_number)}</strong>
                <span class="pill ${String(o.status).toLowerCase() === 'pending' ? 'unread' : 'ok'}" style="margin-left:6px">${this.esc(o.status)}</span>
                ${o.is_online_pending ? '<span class="pill off" style="margin-left:4px">NOT ON POS</span>' : ''}
                <div class="meta">${this.esc(o.branch_name)} · ${this.esc(String(o.time).slice(11, 16))} · ${this.esc(o.fulfillment_type || 'collection')}</div>
                <div class="meta"><strong>${this.esc(o.customer_name || 'Customer')}</strong>${o.customer_phone ? ` · ${this.esc(o.customer_phone)}` : ''}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${this.contactActionsHtml(o.customer_phone, o.customer_email)}
                <strong>${this.money(o.total)}</strong>
              </div></div>`).join('') || '<div class="empty">No online orders for this filter</div>'}
          </div>
          <p class="meta" style="margin-top:12px">Accept/reject orders on the POS till (🛒 Online button).</p>
        </div>`);
        this.bind();
      };
      if (this.onlineOrders.length) renderOnline();
      else {
        renderOnline();
        this.loadOnlineOrders().then(renderOnline).catch((err) => {
          this.toast(err.message, 'error');
          renderOnline();
        });
      }
      return;
    }
    if (this.tab === 'staff') {
      const rows = this.staffActivity || [];
      app.innerHTML = this.shell(`<div class="mgr-header"><h1>Staff activity</h1>
        <div class="sub">${this.esc(this.dashboard?.period || 'Today')}</div></div><div class="mgr-main">
        ${this.periodToolbarHtml()}
        <div class="list-card">${rows.length ? rows.map((r) => `<div class="list-row">
          <div><strong>${this.esc(r.name)}</strong>
            <div class="meta">${r.orders || 0} orders · ${this.money(r.sales)} sales</div></div></div>`).join('')
          : '<div class="empty">No staff sales in this period</div>'}
        </div></div>`);
      this.bind();
      return;
    }
    if (this.tab === 'branches') {
      const branches = this.dashboard?.branches || [];
      const rangeFrom = this.dashboard?.period_from || this.localTodayStr();
      const rangeTo = this.dashboard?.period_to || rangeFrom;
      const rangeLabel = rangeFrom === rangeTo ? rangeFrom : `${rangeFrom} → ${rangeTo}`;
      const totals = branches.reduce((acc, b) => {
        acc.money_in += Number(b.money_in ?? b.sales) || 0;
        acc.money_out += Number(b.money_out ?? b.expenses) || 0;
        acc.orders += Number(b.orders) || 0;
        if (b.daily_money) {
          acc.dm = acc.dm || { money_in: 0, expenses_today: 0, withdrawals_today: 0, out_today: 0, net_today: 0, from_previous: 0 };
          Object.keys(acc.dm).forEach((k) => { acc.dm[k] += Number(b.daily_money[k]) || 0; });
        }
        return acc;
      }, { money_in: 0, money_out: 0, orders: 0, dm: null });
      totals.profit = Math.round((totals.money_in - totals.money_out) * 100) / 100;
      app.innerHTML = this.shell(`<div class="mgr-header"><h1>Branches</h1>
        <div class="sub">${this.esc(rangeLabel)} · live money in, money out and profit</div></div><div class="mgr-main">
        ${this.periodToolbarHtml()}
        ${branches.map((b) => {
          const pos = (this.posStatus || []).find((p) => p.branch_id === b.id);
          const days = b.days || [];
          const showDays = days.length > 1;
          return `<div class="list-card branch-card" style="margin-bottom:12px;padding:14px">
            <strong>${this.esc(b.name)}</strong>
            <div style="margin-top:8px"><span class="pill ${pos?.status === 'online' ? 'ok' : 'off'}">POS ${pos?.status || 'unknown'}</span>
            ${pos?.last_seen ? `<span class="meta"> Last seen ${this.esc(String(pos.last_seen).slice(11, 16))}</span>` : ''}</div>
            ${showDays ? days.map((day) => `
              <div class="branch-day">
                <div class="branch-day-date">${this.esc(day.date)}</div>
                <div class="row"><span>Money in</span><span>${this.money(day.money_in)}</span></div>
                <div class="row"><span>Money out / expenses</span><span>${this.money(day.money_out)}</span></div>
                <div class="row"><span>Profit</span><span>${this.money(day.profit)}</span></div>
                ${this.dailyMoneyRowsHtml(day.daily_money)}
                <div class="meta">${day.orders || 0} orders</div>
              </div>`).join('') : ''}
            <div class="branch-day branch-day-total">
              <div class="branch-day-date">${showDays ? `Total · ${this.esc(rangeLabel)}` : this.esc(rangeLabel)}</div>
              <div class="row"><span>Money in</span><span>${this.money(b.money_in ?? b.sales)}</span></div>
              <div class="row"><span>Money out / expenses</span><span>${this.money(b.money_out ?? b.expenses)}</span></div>
              <div class="row" style="font-weight:800"><span>Profit</span><span>${this.money(b.profit)}</span></div>
              ${this.dailyMoneyRowsHtml(b.daily_money)}
              <div class="meta">${b.orders || 0} orders</div>
            </div>
          </div>`;
        }).join('') || '<div class="empty">No branches</div>'}
        ${branches.length ? `<div class="list-card branch-card" style="padding:14px">
          <strong>All branches · ${this.esc(rangeLabel)}</strong>
          <div class="row" style="margin-top:8px"><span>Total money in</span><span>${this.money(totals.money_in)}</span></div>
          <div class="row"><span>Total money out</span><span>${this.money(totals.money_out)}</span></div>
          <div class="row" style="font-weight:800"><span>Final profit</span><span>${this.money(totals.profit)}</span></div>
          ${this.dailyMoneyRowsHtml(totals.dm)}
          <div class="meta">${totals.orders} orders</div>
        </div>` : ''}
      </div>`);
      this.bind();
      this.afterRenderBrand();
      return;
    }
    if (this.tab === 'alerts') {
      const periodLabel = this.dashboard?.period || (this.period === 'today' ? 'Today' : this.period === 'yesterday' ? 'Yesterday' : this.period === 'week' ? 'This week' : this.period === 'month' ? 'This month' : 'Custom');
      app.innerHTML = this.shell(`<div class="mgr-header"><h1>Alerts</h1>
        <div class="sub">${this.esc(periodLabel)} · ${this.alerts.length} alert${this.alerts.length === 1 ? '' : 's'}</div>
        <button type="button" class="btn-ghost" data-act="mark-read" style="margin-top:8px">Mark all read</button></div><div class="mgr-main">
        ${this.periodToolbarHtml()}
        <div class="list-card">${this.alerts.map((a) => {
          const oid = this.orderIdFromAlert(a);
          return `<div class="list-row" data-act="${oid ? 'order' : ''}" data-id="${oid}">
            <div><strong>${a.read ? '' : '● '}${this.esc(a.title)}</strong>
              <div class="meta">${this.esc(a.body?.replace(/\n/g, ' · '))}</div>
              <div class="meta">${this.esc(String(a.created_at).slice(0, 16))}${oid ? ' · Tap to view order' : ''}</div></div></div>`;
        }).join('') || '<div class="empty">No alerts</div>'}
        </div></div>`);
      this.bind();
      return;
    }
    if (this.tab === 'more' || this.view === 'prefs' || this.view === 'profile') {
      const screen = this.view === 'prefs' ? 'prefs' : this.view === 'profile' ? 'profile' : 'more';
      if (screen === 'prefs') {
        const p = this.prefs || {};
        app.innerHTML = this.shell(`<div class="mgr-main">
          <button type="button" class="back-btn" data-act="more-nav" data-screen="more">← Back</button>
          <h2>Notification settings</h2>
          ${['new_orders', 'large_orders'].map((k) =>
            `<div class="toggle-row"><span>${k.replace(/_/g, ' ')}</span>
              <input type="checkbox" data-pref="${k}" ${p[k] !== false ? 'checked' : ''}></div>`).join('')}
          <div class="toggle-row"><span>Alert sound</span>
            <input type="checkbox" id="mgr-sound-enabled" ${PanelNotify?.isSoundEnabled('manager') !== false ? 'checked' : ''}></div>
          <p class="muted" style="font-size:12px;margin-top:8px">Uses the sound uploaded in Admin → Security. New orders still show alerts when sound is off.</p>
          <label style="display:block;margin-top:12px">Large order threshold (R)
            <input type="number" data-pref="large_order_threshold" value="${p.large_order_threshold || 1000}" style="width:100%;margin-top:6px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
          </label>
          <button type="button" class="btn-primary" data-act="save-prefs" style="margin-top:16px">Save</button>
        </div>`);
      } else if (screen === 'profile') {
        const initials = (this.user?.full_name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        app.innerHTML = this.shell(`<div class="mgr-main">
          <button type="button" class="back-btn" data-act="more-nav" data-screen="more">← Back</button>
          <div class="profile-card">
            <div class="profile-avatar">${initials}</div>
            <h2 style="margin:8px 0 4px">${this.esc(this.user?.full_name)}</h2>
            <p class="meta">@${this.esc(this.user?.username)} · ${this.esc(this.user?.role?.replace(/_/g, ' '))}</p>
            <div class="profile-section">
              <h3>Branches</h3>
              ${(this.user?.branches || []).map((b) =>
                `<div class="profile-row"><strong>${this.esc(b.name)}</strong>
                ${b.phone ? `<span class="meta">📞 ${this.esc(b.phone)}</span>` : ''}
                ${b.address ? `<span class="meta">${this.esc(b.address)}</span>` : ''}</div>`).join('') || '<p class="muted">All branches</p>'}
            </div>
            ${this.shop ? `<div class="profile-section">
              <h3>Company</h3>
              <p><strong>${this.esc(this.shop.shop_name)}</strong></p>
              ${this.shop.address ? `<p class="meta">${this.esc(this.shop.address)}</p>` : ''}
              ${this.shop.phone ? `<p class="meta">📞 ${this.esc(this.shop.phone)}</p>` : ''}
            </div>` : ''}
          </div>
        </div>`);
      } else {
        app.innerHTML = this.shell(`<div class="mgr-header"><h1>More</h1></div><div class="mgr-main">
          <div class="list-card">
            <div class="list-row" data-act="more-nav" data-screen="profile"><strong>Profile</strong></div>
            <div class="list-row" data-act="more-nav" data-screen="prefs"><strong>Notification settings</strong></div>
            ${(['owner', 'manager', 'assistant_manager'].includes(this.user?.role) && this.user?.permissions?.view_staff_activity !== false)
              ? `<div class="list-row" data-act="tab" data-tab="staff"><strong>Staff activity</strong></div>` : ''}
            <div class="list-row" data-act="logout"><strong style="color:var(--danger)">Logout</strong></div>
          </div>
        </div>`);
      }
      this.bind();
      return;
    }
    if (this.view === 'splash') {
      app.innerHTML = `<div class="auth-page"><p class="muted">Loading…</p></div>`;
      return;
    }
    app.innerHTML = `<div class="auth-page"><p class="muted">Something went wrong.</p>
      <button type="button" class="btn-primary" data-act="login" onclick="ManagerApp.view='login';ManagerApp.render()">Sign in</button></div>`;
  }
};

document.addEventListener('DOMContentLoaded', () => ManagerApp.init());
