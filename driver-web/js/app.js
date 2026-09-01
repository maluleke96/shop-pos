const DriverApp = {
  view: 'login',
  tab: 'home',
  token: localStorage.getItem('driver_token') || '',
  dash: null,
  orders: [],

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

  async init() {
    if (location.pathname.includes('register')) return;
    if (this.token) {
      try {
        this.dash = await DriverAPI.dashboard();
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
    this.render();
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
      app.innerHTML = `<div class="hdr">
        <div><strong>${this.esc(d.full_name || 'Driver')}</strong><br><span class="muted">${d.availability || 'offline'}</span></div>
        <button class="btn secondary" style="width:auto;padding:8px 12px" data-act="avail-toggle">${d.availability === 'online' ? 'Go offline' : 'Go online'}</button>
      </div>
      <div class="stat-grid">
        <div class="stat"><span class="muted">Assigned</span><b>${stats.assigned_count || 0}</b></div>
        <div class="stat"><span class="muted">Done today</span><b>${stats.completed_today || 0}</b></div>
        <div class="stat"><span class="muted">Fees today</span><b>${this.money(stats.fees_today)}</b></div>
      </div>
      <h2 style="font-size:1rem">Active deliveries</h2>
      ${(this.orders || []).length ? this.orders.map((o) => this.orderCard(o)).join('') : '<p class="muted">No active deliveries</p>'}
      <div class="nav">
        <button class="${this.tab === 'home' ? 'active' : ''}" data-act="tab" data-tab="home">Home</button>
        <button data-act="logout">Logout</button>
      </div>`;
    }
    this.bind();
  },

  orderCard(o) {
    const items = (o.items || []).slice(0, 4).map((i) => `${i.quantity || 1}× ${i.name || i.product_name}`).join(', ');
    return `<div class="order-card" data-id="${o.id}">
      <h3>${this.esc(o.order_number)} — ${this.esc(o.status)}</h3>
      <p class="muted">${this.esc(o.customer_name)} · ${this.esc(o.customer_phone)}</p>
      <p>${this.esc(o.delivery_address)}</p>
      <p>${this.esc(items)}</p>
      <p><strong>${this.money(o.total)}</strong> · Fee ${this.money(o.delivery_fee)} · ${this.esc(o.payment_method || '')}</p>
      <div class="order-actions">
        ${o.status === 'assigned' ? '<button class="drv-btn" data-act="accept">Accept</button><button class="drv-btn warn secondary" data-act="reject">Reject</button>' : ''}
        ${['driver_accepted','assigned','picking_up'].includes(o.status) ? '<button class="drv-btn" data-act="picked_up">Picked up</button>' : ''}
        ${['picked_up','on_way'].includes(o.status) ? '<button class="drv-btn" data-act="on_way">On the way</button>' : ''}
        ${o.status === 'on_way' || o.status === 'picked_up' ? '<button class="drv-btn" data-act="delivered">Delivered</button>' : ''}
        ${!['delivered','failed','cancelled'].includes(o.status) ? '<button class="drv-btn warn secondary" data-act="failed">Unable to deliver</button>' : ''}
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
      if (act === 'login') {
        try {
          const r = await DriverAPI.login(document.getElementById('drv-user').value.trim(), document.getElementById('drv-pass').value, this.deviceInfo());
          this.token = r.token;
          localStorage.setItem('driver_token', r.token);
          await this.refresh();
          this.view = 'main';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'logout') { await DriverAPI.logout().catch(() => {}); this.token = ''; localStorage.removeItem('driver_token'); this.view = 'login'; this.render(); }
      if (act === 'avail-toggle') {
        const next = this.dash?.driver?.availability === 'online' ? 'offline' : 'online';
        await DriverAPI.availability(next); await this.refresh();
      }
      if (act === 'accept' && id) { await DriverAPI.accept(id); this.toast('Delivery accepted'); await this.refresh(); }
      if (act === 'reject' && id) { const reason = prompt('Reason?') || 'Unavailable'; await DriverAPI.reject(id, reason); await this.refresh(); }
      if (act === 'picked_up' && id) { await DriverAPI.updateStatus(id, 'picked_up'); await this.refresh(); }
      if (act === 'on_way' && id) { await DriverAPI.updateStatus(id, 'on_way'); await this.refresh(); }
      if (act === 'delivered' && id) { await DriverAPI.updateStatus(id, 'delivered'); this.toast('Marked delivered', 'success'); await this.refresh(); }
      if (act === 'failed' && id) { const reason = prompt('Reason?') || 'Failed'; await DriverAPI.updateStatus(id, 'failed', reason); await this.refresh(); }
    };
  }
};

DriverApp.init();
