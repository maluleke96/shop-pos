const DriverApp = {
  view: 'login',
  tab: 'home',
  token: localStorage.getItem('driver_token') || '',
  dash: null,
  orders: [],
  available: [],
  history: [],
  earnings: null,
  payments: null,
  historyDays: 7,
  earningsDays: 7,
  historyDetail: null,
  _pollTimer: null,
  _loggedIn: false,

  money(n) { return `R${(Number(n) || 0).toFixed(2)}`; },
  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  toast(msg, type) {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  dateRange(days) {
    const to = new Date();
    const from = new Date(Date.now() - (Number(days) || 7) * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
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
      if (!this.token || this.view !== 'main' || this.historyDetail) return;
      try {
        await this.refresh();
        this.renderBody();
      } catch (_) { /* */ }
    }, 12000);
  },

  stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  },

  async init() {
    if (location.pathname.includes('register')) return;
    document.getElementById('driver-nav')?.addEventListener('click', (e) => this.onNavClick(e));
    if (this.token) {
      try {
        await this.refresh();
        this.view = 'main';
        this._loggedIn = true;
        this.bindExitGuard();
        this.startPolling();
      } catch (_) {
        this.token = '';
        localStorage.removeItem('driver_token');
        this.view = 'login';
      }
    }
    this.render();
  },

  async doLogout() {
    await DriverAPI.logout().catch(() => {});
    this.token = '';
    this._loggedIn = false;
    localStorage.removeItem('driver_token');
    this.stopPolling();
    this.view = 'login';
    this.render();
  },

  async onNavClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'tab') {
      this.tab = btn.dataset.tab || 'home';
      this.historyDetail = null;
      await this.refresh();
      this.renderBody();
      this.updateNav();
      return;
    }
    if (act === 'logout') this.doLogout();
  },

  async refresh() {
    if (!this.token) return;
    this.dash = await DriverAPI.dashboard();
    this.orders = this.dash.assigned || [];
    this.available = this.dash.available || [];
    const range = this.dateRange(this.tab === 'earnings' ? this.earningsDays : this.historyDays);
    if (this.tab === 'history') {
      this.history = await DriverAPI.history({ ...range, limit: 120 }).catch(() => []);
    }
    if (this.tab === 'earnings') {
      this.earnings = await DriverAPI.earnings(range).catch(() => null);
    }
    if (this.tab === 'payments') {
      this.payments = await DriverAPI.payments().catch(() => null);
    }
  },

  filterBar(kind) {
    const days = kind === 'earnings' ? this.earningsDays : this.historyDays;
    return `<div class="filter-bar">
      <label>Period</label>
      <select data-filter-days="${kind}">
        <option value="1" ${days === 1 ? 'selected' : ''}>Today</option>
        <option value="3" ${days === 3 ? 'selected' : ''}>3 days</option>
        <option value="7" ${days === 7 ? 'selected' : ''}>7 days</option>
        <option value="14" ${days === 14 ? 'selected' : ''}>14 days</option>
        <option value="30" ${days === 30 ? 'selected' : ''}>30 days</option>
        <option value="custom" ${days === 'custom' ? 'selected' : ''}>Custom</option>
      </select>
      <div id="custom-range-${kind}" class="${days === 'custom' ? '' : 'hidden'}" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <input type="date" id="filter-from-${kind}">
        <input type="date" id="filter-to-${kind}">
        <button type="button" class="drv-btn secondary" style="width:auto;padding:8px 12px;margin:0" data-act="apply-custom-${kind}">Apply</button>
      </div>
    </div>`;
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
        <p class="muted" style="margin-top:12px"><a href="register.html">Register as driver</a></p>
      </div>`;
      this.updateNav();
      this.bindLogin();
      window.PanelBrand?.apply?.();
      return;
    }
    this.renderBody();
    this.updateNav();
    this.bindMain();
  },

  logoHtml() {
    const url = this.dash?.shop_logo || '/api/logo';
    return `<img class="hdr-logo" src="${this.esc(url)}" alt="" onerror="this.style.display='none'">`;
  },

  renderBody() {
    const app = document.getElementById('app');
    if (!app || this.view !== 'main') return;

    if (this.historyDetail) {
      const o = this.historyDetail;
      app.innerHTML = `<div class="drv-body">
        <button type="button" class="link-btn" data-act="history-back">← Back</button>
        <div class="order-card">
          <h3>${this.esc(o.delivery_number || o.confirmation_code || 'Delivery')}</h3>
          <p><strong>Delivered:</strong> ${this.esc(String(o.delivered_at || o.updated_at || '').slice(0, 16))}</p>
          <p><strong>Address:</strong> ${this.esc(o.delivery_address || '—')}</p>
          <p><strong>Your fee:</strong> ${this.money(o.delivery_fee)}</p>
          <p class="muted">Customer contact is hidden after delivery for privacy.</p>
        </div>
      </div>`;
      this.bindMain();
      return;
    }

    const d = this.dash?.driver || {};
    const stats = this.dash || {};
    const avail = d.availability || 'offline';
    let body = '';

    if (this.tab === 'payments') {
      const p = this.payments || {};
      body = `<h2 style="font-size:1rem">Payments from admin</h2>
        <div class="stat-grid">
          <div class="stat"><span class="muted">Owing you</span><b>${this.money(p.owed_amount ?? stats.owed_amount)}</b></div>
          <div class="stat"><span class="muted">Period</span><b style="font-size:.85rem">${this.esc(p.owed_from || stats.owed_from || '—')} → ${this.esc(p.owed_to || stats.owed_to || '—')}</b></div>
        </div>
        <p class="muted" style="font-size:13px">When admin pays you, it appears below with the date range it covers.</p>
        ${(p.payouts || []).length ? p.payouts.map((pay) => `<div class="order-card muted-card">
          <strong>${this.money(pay.amount)}</strong>
          <p class="muted">${this.esc(String(pay.period_from || '').slice(0, 10))} → ${this.esc(String(pay.period_to || '').slice(0, 10))}</p>
          <p class="muted">Paid ${this.esc(String(pay.paid_at || '').slice(0, 16))}${pay.paid_by_name ? ` · ${this.esc(pay.paid_by_name)}` : ''}</p>
          ${pay.notes ? `<p class="muted">${this.esc(pay.notes)}</p>` : ''}
        </div>`).join('') : '<p class="muted">No payments recorded yet.</p>'}`;
    } else if (this.tab === 'earnings') {
      const e = this.earnings || {};
      body = `${this.filterBar('earnings')}
        <div class="stat-grid">
          <div class="stat"><span class="muted">Deliveries</span><b>${e.count || 0}</b></div>
          <div class="stat"><span class="muted">Fees earned</span><b>${this.money(e.total)}</b></div>
          <div class="stat"><span class="muted">Still owing</span><b>${this.money(e.owed_amount ?? stats.owed_amount)}</b></div>
        </div>
        <p class="muted" style="margin-top:8px;font-size:13px">${this.esc(e.from || '')} → ${this.esc(e.to || '')}</p>`;
    } else if (this.tab === 'history') {
      body = `${this.filterBar('history')}
        <h2 style="font-size:1rem">Completed deliveries — tap for details</h2>
        ${(this.history || []).length ? this.history.map((o) => this.historyCard(o)).join('') : '<p class="muted">No history in this period.</p>'}`;
    } else {
      body = `<div class="stat-grid">
          <div class="stat"><span class="muted">Active now</span><b>${stats.assigned_count || 0}</b></div>
          <div class="stat"><span class="muted">Done today</span><b>${stats.completed_today || 0}</b></div>
          <div class="stat"><span class="muted">Fees today</span><b>${this.money(stats.fees_today)}</b></div>
          <div class="stat"><span class="muted">Owing you</span><b>${this.money(stats.owed_amount)}</b></div>
        </div>
        ${(this.available || []).length ? `<h2 style="font-size:1rem">Available — accept to claim</h2>
          ${this.available.map((o) => this.orderCard(o, { pool: true })).join('')}` : ''}
        <h2 style="font-size:1rem">Your active deliveries</h2>
        ${(this.orders || []).length ? this.orders.map((o) => this.orderCard(o)).join('') : '<p class="muted">No active deliveries — new assignments appear here automatically.</p>'}`;
    }

    app.innerHTML = `<div class="hdr">
        <div class="hdr-left">${this.logoHtml()}<div>${this.availDot(avail)}<strong>${this.esc(d.full_name || 'Driver')}</strong><br>
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
        const customEl = document.getElementById(`custom-range-${kind}`);
        if (val === 'custom') {
          customEl?.classList.remove('hidden');
          return;
        }
        customEl?.classList.add('hidden');
        if (kind === 'earnings') this.earningsDays = Number(val);
        else this.historyDays = Number(val);
        await this.refresh();
        this.renderBody();
      };
    });
    ['history', 'earnings'].forEach((kind) => {
      document.querySelector(`[data-act="apply-custom-${kind}"]`)?.addEventListener('click', async () => {
        const from = document.getElementById(`filter-from-${kind}`)?.value;
        const to = document.getElementById(`filter-to-${kind}`)?.value;
        if (!from || !to) return this.toast('Pick from and to dates', 'error');
        if (kind === 'earnings') {
          this.earningsDays = 'custom';
          this.earnings = await DriverAPI.earnings({ from, to });
        } else {
          this.historyDays = 'custom';
          this.history = await DriverAPI.history({ from, to, limit: 200 });
        }
        this.renderBody();
      });
    });
  },

  historyCard(o) {
    const addr = o.delivery_address ? this.esc(o.delivery_address) : '—';
    return `<button type="button" class="order-card muted-card history-btn" data-history-id="${o.id}">
      <strong>${this.esc(o.delivery_number || o.confirmation_code || 'Delivery')}</strong>
      <p class="muted">${addr}</p>
      <p class="muted">${this.esc(String(o.delivered_at || o.updated_at || '').slice(0, 16))} · Fee: ${this.money(o.delivery_fee)}</p>
    </button>`;
  },

  orderCard(o, opts = {}) {
    const items = (o.items || []).slice(0, 6).map((i) => `${i.quantity || 1}× ${i.name || i.product_name}`).join(', ');
    const delNum = o.delivery_number || o.confirmation_code || 'Delivery';
    const code = o.confirmation_code || o.delivery_number || '';
    const phone = o.customer_phone || '';
    const name = o.customer_name || 'Customer';
    const pool = opts.pool;
    return `<div class="order-card" data-id="${o.id}">
      <h3>${this.esc(delNum)} — ${this.esc(o.status)}</h3>
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
        ${pool || o.status === 'awaiting_driver' ? '<button class="drv-btn" data-act="accept">Accept delivery</button>' : ''}
        ${o.status === 'assigned' ? '<button class="drv-btn" data-act="accept">Accept</button><button class="drv-btn warn secondary" data-act="reject">Reject (pickup at store)</button>' : ''}
        ${['driver_accepted','assigned','picking_up'].includes(o.status) ? '<button class="drv-btn" data-act="picked_up">Picked up</button>' : ''}
        ${['picked_up','on_way'].includes(o.status) ? '<button class="drv-btn" data-act="on_way">On the way</button>' : ''}
        ${o.status === 'on_way' || o.status === 'picked_up' ? '<button class="drv-btn" data-act="delivered">Delivered</button>' : ''}
        ${!pool && !['delivered','failed','cancelled'].includes(o.status) ? '<button class="drv-btn warn secondary" data-act="failed">Unable to deliver</button>' : ''}
      </div>
    </div>`;
  },

  bindLogin() {
    document.getElementById('app').onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn?.dataset.act !== 'login') return;
      try {
        const r = await DriverAPI.login(document.getElementById('drv-user').value.trim(), document.getElementById('drv-pass').value, this.deviceInfo());
        this.token = r.token;
        localStorage.setItem('driver_token', r.token);
        await this.refresh();
        this.view = 'main';
        this.tab = 'home';
        this._loggedIn = true;
        this.bindExitGuard();
        this.startPolling();
        this.render();
      } catch (err) { this.toast(err.message, 'error'); }
    };
  },

  bindMain() {
    const app = document.getElementById('app');
    app.onclick = async (e) => {
      if (e.target.closest('a.contact-btn')) return;
      const histBtn = e.target.closest('[data-history-id]');
      if (histBtn) {
        const id = Number(histBtn.dataset.historyId);
        this.historyDetail = (this.history || []).find((o) => Number(o.id) === id) || null;
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
      if (!act) return;
      if (act === 'avail-toggle') {
        const next = this.dash?.driver?.availability === 'online' ? 'offline' : 'online';
        await DriverAPI.availability(next);
        await this.refresh();
        this.renderBody();
        return;
      }
      if (act === 'accept' && id) { await DriverAPI.accept(id); this.toast('Delivery accepted'); await this.refresh(); this.renderBody(); }
      if (act === 'reject' && id) { const reason = prompt('Reason?') || 'Unavailable'; await DriverAPI.reject(id, reason); await this.refresh(); this.renderBody(); }
      if (act === 'picked_up' && id) { await DriverAPI.updateStatus(id, 'picked_up'); await this.refresh(); this.renderBody(); }
      if (act === 'on_way' && id) { await DriverAPI.updateStatus(id, 'on_way'); await this.refresh(); this.renderBody(); }
      if (act === 'delivered' && id) { await DriverAPI.updateStatus(id, 'delivered'); this.toast('Marked delivered', 'success'); await this.refresh(); this.renderBody(); }
      if (act === 'failed' && id) { const reason = prompt('Reason?') || 'Failed'; await DriverAPI.updateStatus(id, 'failed', reason); await this.refresh(); this.renderBody(); }
    };
  }
};

DriverApp.init();
