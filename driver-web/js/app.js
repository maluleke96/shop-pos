const DriverApp = {
  view: 'login',
  tab: 'home',
  token: localStorage.getItem('driver_token') || '',
  dash: null,
  orders: [],
  available: [],
  history: [],

  money(n) { return `R${(Number(n) || 0).toFixed(2)}`; },
  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  toast(msg, type) {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3500);
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
    const wa = p.startsWith('0') ? `27${p.slice(1)}` : p;
    return `https://wa.me/${wa}`;
  },

  availDot(avail) {
    const on = avail === 'online';
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${on ? '#22c55e' : '#94a3b8'};margin-right:6px"></span>`;
  },

  bottomNav() {
    return `<div class="nav">
      <button class="${this.tab === 'home' ? 'active' : ''}" data-act="tab" data-tab="home">Home</button>
      <button class="${this.tab === 'earnings' ? 'active' : ''}" data-act="tab" data-tab="earnings">Earnings</button>
      <button class="${this.tab === 'history' ? 'active' : ''}" data-act="tab" data-tab="history">History</button>
      <button data-act="logout">Logout</button>
    </div>`;
  },

  async init() {
    if (location.pathname.includes('register')) return;
    if (this.token) {
      try {
        await this.refresh();
        this.view = 'main';
      } catch (_) {
        this.token = '';
        localStorage.removeItem('driver_token');
        this.view = 'login';
      }
    }
    this.render();
  },

  async refresh() {
    if (!this.token) return;
    this.dash = await DriverAPI.dashboard();
    this.orders = this.dash.assigned || [];
    this.available = this.dash.available || [];
    if (this.tab === 'history') {
      this.history = await DriverAPI.history(80).catch(() => []);
    }
  },

  render() {
    const app = document.getElementById('app');
    if (!app) return;
    if (this.view === 'login') {
      app.innerHTML = `<div class="drv-card">
        <h1>Driver Sign In</h1>
        <label>Phone / email / code<input id="drv-user"></label>
        <label>Password<input id="drv-pass" type="password"></label>
        <button class="drv-btn" data-act="login">Sign in</button>
        <p class="muted" style="margin-top:12px"><a href="register.html">Register as driver</a></p>
      </div>`;
    } else {
      const d = this.dash?.driver || {};
      const stats = this.dash || {};
      const avail = d.availability || 'offline';
      let body = '';
      if (this.tab === 'earnings') {
        body = `<div class="stat-grid">
          <div class="stat"><span class="muted">Today</span><b>${this.money(stats.fees_today)}</b></div>
          <div class="stat"><span class="muted">Delivered today</span><b>${stats.completed_today || 0}</b></div>
          <div class="stat"><span class="muted">All time</span><b>${this.money(stats.earnings_total)}</b></div>
        </div>
        <p class="muted" style="margin-top:12px;font-size:13px">You only see delivery fees — not product prices. Earnings count after delivery is marked delivered.</p>`;
      } else if (this.tab === 'history') {
        body = `<h2 style="font-size:1rem">Completed deliveries</h2>
        ${(this.history || []).length ? this.history.map((o) => this.historyCard(o)).join('') : '<p class="muted">No history yet</p>'}`;
      } else {
        body = `<div class="stat-grid">
          <div class="stat"><span class="muted">Assigned</span><b>${stats.assigned_count || 0}</b></div>
          <div class="stat"><span class="muted">Done today</span><b>${stats.completed_today || 0}</b></div>
          <div class="stat"><span class="muted">Fees today</span><b>${this.money(stats.fees_today)}</b></div>
        </div>
        ${(this.available || []).length ? `<h2 style="font-size:1rem">Available — accept to claim</h2>
          ${this.available.map((o) => this.orderCard(o, { pool: true })).join('')}` : ''}
        <h2 style="font-size:1rem">Your active deliveries</h2>
        ${(this.orders || []).length ? this.orders.map((o) => this.orderCard(o)).join('') : '<p class="muted">No active deliveries</p>'}`;
      }
      app.innerHTML = `<div class="hdr">
        <div>${this.availDot(avail)}<strong>${this.esc(d.full_name || 'Driver')}</strong><br>
        <span class="muted" style="${avail === 'online' ? 'color:#16a34a;font-weight:600' : ''}">${avail === 'online' ? 'Online' : 'Offline'}</span></div>
        <button class="btn secondary" style="width:auto;padding:8px 12px" data-act="avail-toggle">${avail === 'online' ? 'Go offline' : 'Go online'}</button>
      </div>
      <div class="drv-body">${body}</div>
      ${this.bottomNav()}`;
    }
    this.bind();
  },

  historyCard(o) {
    return `<div class="order-card muted-card">
      <strong>${this.esc(o.delivery_number || o.confirmation_code || 'Delivery')}</strong>
      <p class="muted">${this.esc(o.status)} · Your fee: ${this.money(o.delivery_fee)}</p>
    </div>`;
  },

  orderCard(o, opts = {}) {
    const items = (o.items || []).slice(0, 6).map((i) => `${i.quantity || 1}× ${i.name || i.product_name}`).join(', ');
    const delNum = o.delivery_number || o.confirmation_code || 'Delivery';
    const phone = o.customer_phone || '';
    const pool = opts.pool;
    return `<div class="order-card" data-id="${o.id}">
      <h3>${this.esc(delNum)} — ${this.esc(o.status)}</h3>
      <p class="muted">${this.esc(o.customer_name)}</p>
      <p>${this.esc(o.delivery_address)}</p>
      <p>${this.esc(items)}</p>
      <p><strong>Your fee: ${this.money(o.delivery_fee)}</strong></p>
      <div class="order-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
        ${phone ? `<a class="drv-btn secondary" href="${this.phoneLink(phone)}" style="text-decoration:none;text-align:center">📞 Call</a>` : ''}
        ${phone ? `<a class="drv-btn secondary" href="${this.whatsappLink(phone)}" target="_blank" rel="noopener" style="text-decoration:none;text-align:center">WhatsApp</a>` : ''}
      </div>
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

  bind() {
    const app = document.getElementById('app');
    app.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('[data-id]');
      const id = card?.dataset?.id;
      const act = btn?.dataset?.act;
      if (!act) return;
      if (act === 'tab') {
        this.tab = btn.dataset.tab || 'home';
        if (this.tab === 'history') await this.refresh();
        this.render();
        return;
      }
      if (act === 'login') {
        try {
          const r = await DriverAPI.login(document.getElementById('drv-user').value.trim(), document.getElementById('drv-pass').value, this.deviceInfo());
          this.token = r.token;
          localStorage.setItem('driver_token', r.token);
          await this.refresh();
          this.view = 'main';
          this.tab = 'home';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'logout') { await DriverAPI.logout().catch(() => {}); this.token = ''; localStorage.removeItem('driver_token'); this.view = 'login'; this.render(); }
      if (act === 'avail-toggle') {
        const next = this.dash?.driver?.availability === 'online' ? 'offline' : 'online';
        await DriverAPI.availability(next);
        await this.refresh();
        this.render();
      }
      if (act === 'accept' && id) { await DriverAPI.accept(id); this.toast('Delivery accepted'); await this.refresh(); this.render(); }
      if (act === 'reject' && id) { const reason = prompt('Reason?') || 'Unavailable'; await DriverAPI.reject(id, reason); await this.refresh(); this.render(); }
      if (act === 'picked_up' && id) { await DriverAPI.updateStatus(id, 'picked_up'); await this.refresh(); this.render(); }
      if (act === 'on_way' && id) { await DriverAPI.updateStatus(id, 'on_way'); await this.refresh(); this.render(); }
      if (act === 'delivered' && id) { await DriverAPI.updateStatus(id, 'delivered'); this.toast('Marked delivered', 'success'); await this.refresh(); this.render(); }
      if (act === 'failed' && id) { const reason = prompt('Reason?') || 'Failed'; await DriverAPI.updateStatus(id, 'failed', reason); await this.refresh(); this.render(); }
    };
  }
};

DriverApp.init();
