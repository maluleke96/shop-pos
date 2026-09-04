/* Business Manager — owner/manager monitoring app */
const ManagerApp = {
  view: 'splash',
  tab: 'home',
  token: localStorage.getItem('manager_token') || '',
  user: null,
  period: 'today',
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

  money(n) { return `R${(Number(n) || 0).toFixed(2)}`; },
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
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('order/')) this._deepOrder = hash.split('/')[1];
    const hashParams = new URLSearchParams(hash.includes('=') ? hash : '');
    const hashToken = hashParams.get('token');
    if (hashToken) {
      this.token = hashToken;
      localStorage.setItem('manager_token', hashToken);
      history.replaceState(null, '', location.pathname + location.search);
    }
    this.view = this.token ? 'splash' : 'login';
    this.render();
    if (this.token) {
      try {
        const p = await ManagerAPI.profile();
        this.user = p.user;
        this.prefs = p.notification_prefs;
        this.view = 'main';
        await this.refresh();
        if (this._deepOrder) { this.tab = 'orders'; await this.openOrder(this._deepOrder); }
        else {
          const savedTab = localStorage.getItem('manager_tab');
          if (savedTab) this.tab = savedTab;
        }
      } catch (_) {
        this.token = '';
        localStorage.removeItem('manager_token');
        this.view = 'login';
      }
    } else {
      this.view = 'login';
    }
    this.render();
    this.startPolling();
    window.addEventListener('online', () => this.refresh());
  },

  startPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this.pollAlerts(), 15000);
  },

  async pollAlerts() {
    if (!this.token) return;
    try {
      const fresh = await ManagerAPI.poll(this.lastAlertId);
      if (fresh?.length) {
        this.lastAlertId = Math.max(...fresh.map((a) => a.id));
        const latest = fresh[fresh.length - 1];
        if (latest.type === 'new_order' || latest.type === 'large_order') {
          this.playAlertSound();
          this.toast(`${latest.title}: ${latest.body?.split('\n')[0] || ''}`, 'success');
          if (Notification.permission === 'granted') {
            new Notification(latest.title, { body: latest.body, tag: `order-${latest.id}` });
          }
        }
        if (this.tab === 'home' || this.tab === 'alerts') await this.refresh();
      }
    } catch (_) { /* ignore */ }
  },

  async refresh() {
    if (!this.token) return;
    try {
      const filters = this.branchFilters();
      const [dash, alerts, pos] = await Promise.all([
        ManagerAPI.dashboard(filters),
        ManagerAPI.alerts(30),
        ManagerAPI.posStatus()
      ]);
      this.dashboard = dash;
      this.alerts = alerts;
      this.posStatus = pos;
      this.lastUpdated = new Date();
      if (alerts.length) this.lastAlertId = Math.max(this.lastAlertId, ...alerts.map((a) => a.id));
      if (this.tab === 'orders') await this.loadOrders();
      if (this.tab === 'online') await this.loadOnlineOrders();
      if (this.view === 'main') this.render();
    } catch (err) {
      if (/session|revoked|not authenticated/i.test(err.message)) {
        this.token = '';
        this.view = 'login';
        this.render();
      }
    }
  },

  async loadOrders() {
    this.orders = await ManagerAPI.orders({ ...this.branchFilters(), limit: 50 });
  },

  async loadOnlineOrders() {
    this.onlineOrders = await ManagerAPI.onlineOrders({ ...this.branchFilters(), status: this.onlineTab, limit: 50 });
  },

  orderIdFromAlert(a) {
    const p = a?.payload || {};
    if (p.sale_id) return String(p.sale_id);
    if (p.online_order_id) return `online:${p.online_order_id}`;
    return '';
  },

  periodToolbarHtml() {
    return `${this.branchSelectorHtml()}<div class="toolbar">
      <select id="period-select" class="filter-select">
        <option value="today" ${this.period === 'today' ? 'selected' : ''}>Today</option>
        <option value="yesterday" ${this.period === 'yesterday' ? 'selected' : ''}>Yesterday</option>
        <option value="week" ${this.period === 'week' ? 'selected' : ''}>This week</option>
        <option value="month" ${this.period === 'month' ? 'selected' : ''}>This month</option>
        <option value="custom" ${this.period === 'custom' ? 'selected' : ''}>Custom range</option>
      </select>
      ${this.period === 'custom' ? `<input type="date" id="custom-from" value="${this.esc(this.customFrom)}" style="margin-left:8px;padding:8px;border-radius:8px;border:1px solid var(--border)">
        <input type="date" id="custom-to" value="${this.esc(this.customTo)}" style="margin-left:4px;padding:8px;border-radius:8px;border:1px solid var(--border)">
        <button type="button" class="btn-primary btn-sm" data-act="apply-custom" style="margin-left:8px">Apply</button>` : ''}
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
    const multi = this.user?.branches?.length > 1;
    const tabs = [
      { id: 'home', icon: '🏠', label: 'Home' },
      { id: 'orders', icon: '📋', label: 'Orders' },
      { id: 'online', icon: '🛒', label: 'POS Online' },
      ...(multi ? [{ id: 'branches', icon: '🏢', label: 'Branches' }] : []),
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
        try { localStorage.setItem('manager_tab', this.tab); } catch (_) { /* ignore */ }
        if (this.tab === 'orders') this.orders = [];
        if (this.tab === 'online') this.onlineOrders = [];
        await this.refresh();
        return;
      }
      if (act === 'login') {
        btn.disabled = true;
        try {
          const r = await ManagerAPI.login(
            document.getElementById('login-user').value.trim(),
            document.getElementById('login-pass').value,
            this.deviceInfo()
          );
          this.token = r.token;
          localStorage.setItem('manager_token', this.token);
          this.user = r.user;
          this.view = 'main';
          if (Notification.permission === 'default') Notification.requestPermission();
          await this.refresh();
          this.toast('Welcome back!', 'success');
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn.disabled = false; }
        return;
      }
      if (act === 'logout') {
        try { await ManagerAPI.logout(); } catch (_) {}
        this.token = '';
        localStorage.removeItem('manager_token');
        this.user = null;
        this.view = 'login';
        this.render();
        return;
      }
      if (act === 'order') { await this.openOrder(btn.dataset.id); return; }
      if (act === 'back') { this.view = 'main'; this.orderDetail = null; this.render(); return; }
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
        if (this.period !== 'custom') {
          this.orders = [];
          await this.refresh();
        } else {
          this.render();
        }
      }
    };
  },

  shell(body) {
    const tabs = this.navTabs();
    const unread = this.alerts.filter((a) => !a.read).length;
    return `<div class="mgr-app">${body}
      <nav class="bottom-nav">${tabs.map((t) =>
        `<button type="button" data-act="tab" data-tab="${t.id}" class="${this.tab === t.id && this.view === 'main' ? 'active' : ''}">
          <span class="icon">${t.icon}${t.id === 'alerts' && unread ? ' •' : ''}</span>${t.label}</button>`).join('')}
      </nav></div>`;
  },

  render() {
    const app = document.getElementById('app');
    if (this.view === 'login') {
      app.innerHTML = `<div class="auth-page"><form class="auth-card" onsubmit="return false">
        <h1>Business Manager</h1>
        <p class="sub" style="color:var(--muted);margin:0 0 16px">Monitor sales, orders & alerts from your phone</p>
        <label>Username<input id="login-user" autocomplete="username" required></label>
        <label>Password<input type="password" id="login-pass" autocomplete="current-password" required></label>
        <button type="button" class="btn-primary" data-act="login">Sign in</button>
      </form></div>`;
      this.bind();
      return;
    }
    if (this.view === 'order' && this.orderDetail) {
      const o = this.orderDetail;
      const hasCustomer = o.customer_name || o.customer_phone || o.customer_email;
      app.innerHTML = this.shell(`<div class="mgr-main">
        <button type="button" class="back-btn" data-act="back">← Back</button>
        <div class="order-detail">
          <h2>Order ${this.esc(o.order_number || o.receipt_number)}</h2>
          <div class="row"><span>Branch</span><span>${this.esc(o.branch_name)}</span></div>
          <div class="row"><span>Time</span><span>${this.esc(String(o.time).slice(0, 16))}</span></div>
          <div class="row"><span>Cashier</span><span>${this.esc(o.cashier || '—')}</span></div>
          <div class="row"><span>Status</span><span>${this.esc(o.status)}</span></div>
          ${o.order_source ? `<div class="row"><span>Source</span><span>${this.esc(o.order_source)}${o.is_online_pending ? ' (web — not on POS yet)' : ''}</span></div>` : ''}
          ${hasCustomer ? `<div class="customer-card">
            <div class="row" style="align-items:flex-start"><span>Customer</span>
              <div style="text-align:right">
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
      return;
    }
    if (this.view === 'main' && this.tab === 'home') {
      const d = this.dashboard || {};
      app.innerHTML = this.shell(`<div class="mgr-header">
        <h1>${this.esc(d.greeting || 'Hello')}, ${this.esc(d.user_name || this.user?.full_name || '')}</h1>
        <div class="sub">${d.multi_branch ? 'All branches' : (this.user?.branches?.[0]?.name || 'Your branch')} · ${this.esc(d.period || 'Today')}</div>
      </div><div class="mgr-main">
        ${this.periodToolbarHtml()}
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Orders</div><div class="value">${d.orders ?? '—'}</div></div>
          <div class="stat-card"><div class="label">Sales</div><div class="value">${this.money(d.sales)}</div></div>
          <div class="stat-card wide"><div class="label">Average order</div><div class="value">${this.money(d.average_order)}</div></div>
        </div>
        <div class="stat-grid">
          <div class="stat-card"><div class="label">POS online</div><div class="value">${d.branches_online ?? 0}/${d.branches_total ?? 0}</div></div>
          <div class="stat-card"><div class="label">Alerts</div><div class="value">${d.alerts_count ?? 0}</div></div>
        </div>
        <div class="list-card"><h3>Recent orders</h3>
          ${(d.recent_orders || []).map((o) =>
            `<div class="list-row" data-act="order" data-id="${o.id}">
              <div><strong>#${this.esc(o.number)}</strong>${o.order_source && o.order_source !== 'POS' ? ` <small>(${this.esc(o.order_source)})</small>` : ''}
              <div class="meta">${this.esc(String(o.time).slice(11, 16))}${o.status ? ` · ${this.esc(o.status)}` : ''}</div></div>
              <strong>${this.money(o.total)}</strong></div>`).join('') || '<div class="empty">No orders yet</div>'}
        </div>
        ${this.lastUpdated ? `<div class="updated">Last updated: ${this.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
      </div>`);
      this.bind();
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
                <div class="meta">${this.esc(o.branch_name)} · ${this.esc(String(o.time).slice(11, 16))} · ${this.esc(o.payment)} · ${this.esc(o.status || '')}</div>
                ${o.customer_name ? `<div class="meta">${this.esc(o.customer_name)}${o.customer_phone ? ` · ${this.esc(o.customer_phone)}` : ''}</div>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${this.contactActionsHtml(o.customer_phone, o.customer_email)}
                <strong>${this.money(o.total)}</strong>
              </div></div>`).join('') || '<div class="empty">No orders for this period</div>'}
          </div></div>`);
        this.bind();
      };
      if (!this.orders.length) {
        app.innerHTML = this.shell(`<div class="mgr-header"><h1>Orders</h1></div><div class="mgr-main"><p class="muted">Loading orders…</p></div>`);
        this.loadOrders().then(renderOrders).catch((err) => {
          this.toast(err.message, 'error');
          renderOrders();
        });
      } else {
        renderOrders();
      }
      return;
    }
    if (this.tab === 'online') {
      const renderOnline = () => {
        const pending = this.onlineOrders.filter((o) => String(o.status).toLowerCase() === 'pending').length;
        app.innerHTML = this.shell(`<div class="mgr-header"><h1>POS Online</h1>
          <div class="sub">Live online orders · ${pending} pending</div></div><div class="mgr-main">
          ${this.branchSelectorHtml()}
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
      if (!this.onlineOrders.length) {
        app.innerHTML = this.shell(`<div class="mgr-header"><h1>POS Online</h1></div><div class="mgr-main"><p class="muted">Loading online orders…</p></div>`);
        this.loadOnlineOrders().then(renderOnline).catch((err) => {
          this.toast(err.message, 'error');
          renderOnline();
        });
      } else {
        renderOnline();
      }
      return;
    }
    if (this.tab === 'branches') {
      const branches = this.dashboard?.branches || [];
      app.innerHTML = this.shell(`<div class="mgr-header"><h1>Branches</h1></div><div class="mgr-main">
        ${branches.map((b) => {
          const pos = (this.posStatus || []).find((p) => p.branch_id === b.id);
          return `<div class="list-card" style="margin-bottom:12px;padding:14px">
            <strong>${this.esc(b.name)}</strong>
            <div class="meta" style="margin-top:8px">Orders: ${b.orders} · Sales: ${this.money(b.sales)}</div>
            <div style="margin-top:8px"><span class="pill ${pos?.status === 'online' ? 'ok' : 'off'}">POS ${pos?.status || 'unknown'}</span>
            ${pos?.last_seen ? `<span class="meta"> Last seen ${this.esc(String(pos.last_seen).slice(11, 16))}</span>` : ''}</div>
          </div>`;
        }).join('') || '<div class="empty">No branches</div>'}
      </div>`);
      this.bind();
      return;
    }
    if (this.tab === 'alerts') {
      app.innerHTML = this.shell(`<div class="mgr-header"><h1>Alerts</h1>
        <button type="button" class="btn-ghost" data-act="mark-read" style="margin-top:8px">Mark all read</button></div><div class="mgr-main">
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
          ${['new_orders', 'large_orders', 'low_stock', 'pos_offline', 'cashup_alerts', 'system_alerts'].map((k) =>
            `<div class="toggle-row"><span>${k.replace(/_/g, ' ')}</span>
              <input type="checkbox" data-pref="${k}" ${p[k] !== false ? 'checked' : ''}></div>`).join('')}
          <label style="display:block;margin-top:12px">Large order threshold (R)
            <input type="number" data-pref="large_order_threshold" value="${p.large_order_threshold || 1000}" style="width:100%;margin-top:6px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
          </label>
          <button type="button" class="btn-primary" data-act="save-prefs" style="margin-top:16px">Save</button>
        </div>`);
      } else if (screen === 'profile') {
        app.innerHTML = this.shell(`<div class="mgr-main">
          <button type="button" class="back-btn" data-act="more-nav" data-screen="more">← Back</button>
          <h2>Profile</h2>
          <p><strong>${this.esc(this.user?.full_name)}</strong></p>
          <p class="meta">@${this.esc(this.user?.username)} · ${this.esc(this.user?.role)}</p>
          <p class="meta">Branches: ${(this.user?.branches || []).map((b) => this.esc(b.name)).join(', ') || 'All'}</p>
        </div>`);
      } else {
        app.innerHTML = this.shell(`<div class="mgr-header"><h1>More</h1></div><div class="mgr-main">
          <div class="list-card">
            <div class="list-row" data-act="more-nav" data-screen="profile"><strong>Profile</strong></div>
            <div class="list-row" data-act="more-nav" data-screen="prefs"><strong>Notification settings</strong></div>
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
