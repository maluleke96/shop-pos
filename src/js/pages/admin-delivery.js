/** Delivery Department — Admin Panel */
window.AdminDeliveryPage = {
  tab: 'dashboard',
  dash: null,
  orders: [],
  drivers: [],
  settings: null,
  actor: null,

  async render(el, admin) {
    this.el = el;
    this.admin = admin;
    this.actor = admin?.app?.user || admin?.user;
    el.innerHTML = `<div class="admin-section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h2>🚚 Delivery Department</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-ghost" href="/driver/" target="_blank" rel="noopener">Open Driver App</a>
          <a class="btn btn-ghost" href="/driver/register.html" target="_blank" rel="noopener">Driver Registration</a>
        </div>
      </div>
      <div class="admin-tabs" id="del-tabs">
        ${['dashboard','orders','drivers','pending','settings','reports'].map((t) =>
          `<button class="admin-tab ${this.tab === t ? 'active' : ''}" data-tab="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <div id="del-body"><p class="muted">Loading…</p></div>
    </div>`;
    el.querySelector('#del-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      el.querySelectorAll('.admin-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === this.tab));
      this.renderTab();
    };
    await this.load();
    this.renderTab();
  },

  async load() {
    try {
      const [dash, orders, drivers, settings] = await Promise.all([
        API.deliveryDashboard({}, this.actor),
        API.listDeliveries({ limit: 100 }, this.actor),
        API.listDeliveryDrivers({}, this.actor),
        API.getDeliverySettings(this.actor)
      ]);
      this.dash = dash;
      this.orders = (orders?.data || orders || []);
      this.drivers = (drivers?.data || drivers || []);
      this.settings = settings;
    } catch (e) {
      Utils.toast(e.message || 'Failed to load delivery data', 'error');
    }
  },

  money(n) { return Utils.formatMoney(n); },
  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },

  renderTab() {
    const body = this.el.querySelector('#del-body');
    if (this.tab === 'dashboard') return this.renderDashboard(body);
    if (this.tab === 'orders') return this.renderOrders(body);
    if (this.tab === 'drivers') return this.renderDrivers(body);
    if (this.tab === 'pending') return this.renderPending(body);
    if (this.tab === 'settings') return this.renderSettings(body);
    if (this.tab === 'reports') return this.renderReports(body);
  },

  renderDashboard(body) {
    const s = this.dash?.stats || {};
    body.innerHTML = `<div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0">
      <div class="card"><div class="muted">Pending</div><strong>${s.pending || 0}</strong></div>
      <div class="card"><div class="muted">Waiting driver</div><strong>${s.waiting || 0}</strong></div>
      <div class="card"><div class="muted">Active</div><strong>${s.active || 0}</strong></div>
      <div class="card"><div class="muted">Delivered today</div><strong>${s.delivered_today || 0}</strong></div>
      <div class="card"><div class="muted">Fees today</div><strong>${this.money(s.fees_today)}</strong></div>
      <div class="card"><div class="muted">Drivers online</div><strong>${this.dash?.drivers_online || 0} / ${this.dash?.drivers_total || 0}</strong></div>
    </div>
    <h3>Recent deliveries</h3>
    ${this.ordersTable(this.orders.slice(0, 15))}`;
    this.bindOrderActions(body);
  },

  renderOrders(body) {
    const statuses = ['', 'pending', 'awaiting_driver', 'assigned', 'driver_accepted', 'picked_up', 'on_way', 'delivered', 'failed', 'cancelled'];
    body.innerHTML = `<div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
      <select id="del-filter-status"><option value="">All statuses</option>${statuses.filter(Boolean).map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
      <button class="btn btn-primary" id="del-refresh">Refresh</button>
    </div>
    <div id="del-orders-list">${this.ordersTable(this.orders)}</div>`;
    body.querySelector('#del-refresh').onclick = async () => {
      const st = body.querySelector('#del-filter-status').value;
      this.orders = await API.listDeliveries(st ? { status: st } : {}, this.actor);
      this.orders = this.orders?.data || this.orders || [];
      body.querySelector('#del-orders-list').innerHTML = this.ordersTable(this.orders);
      this.bindOrderActions(body);
    };
    this.bindOrderActions(body);
  },

  ordersTable(rows) {
    if (!rows?.length) return '<p class="muted">No delivery orders yet. Delivery orders are created when a sale or online order uses delivery.</p>';
    return `<table class="data-table"><thead><tr>
      <th>Order</th><th>Customer</th><th>Address</th><th>Branch</th><th>Total</th><th>Driver</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>${rows.map((o) => `<tr data-oid="${o.id}">
      <td>${this.esc(o.order_number)}</td>
      <td>${this.esc(o.customer_name)}<br><small>${this.esc(o.customer_phone)}</small></td>
      <td>${this.esc(o.delivery_address)}</td>
      <td>${this.esc(o.branch_name || o.branch_id || '')}</td>
      <td>${this.money(o.total)}</td>
      <td>${this.esc(o.driver_name || '—')}</td>
      <td><span class="badge">${this.esc(o.status)}</span></td>
      <td class="del-actions" data-oid="${o.id}">
        ${o.tracking_token ? `<a href="/track/${o.tracking_token}" target="_blank" class="btn btn-ghost btn-sm">Track</a>` : ''}
        <select class="del-assign-driver" data-oid="${o.id}"><option value="">Assign driver…</option>
          ${(this.drivers.filter((d) => d.status === 'active') || []).map((d) => `<option value="${d.id}" ${o.driver_id == d.id ? 'selected' : ''}>${this.esc(d.full_name)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" data-act="auto-assign" data-oid="${o.id}">Auto</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
  },

  bindOrderActions(body) {
    body.querySelectorAll('.del-assign-driver').forEach((sel) => {
      sel.onchange = async () => {
        if (!sel.value) return;
        try {
          await API.assignDeliveryDriver(sel.dataset.oid, sel.value, this.actor);
          Utils.toast('Driver assigned', 'success');
          await this.load();
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
    });
    body.querySelectorAll('[data-act="auto-assign"]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await API.autoAssignDelivery(btn.dataset.oid, this.actor);
          Utils.toast('Auto-assigned', 'success');
          await this.load();
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
    });
  },

  renderDrivers(body) {
    const active = this.drivers.filter((d) => d.status === 'active');
    body.innerHTML = `<div style="margin:12px 0"><button class="btn btn-primary" id="del-add-driver">Add driver</button></div>
    <table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Code</th><th>Status</th><th>Availability</th><th>Deliveries</th><th></th></tr></thead>
    <tbody>${active.map((d) => `<tr><td>${this.esc(d.full_name)}</td><td>${this.esc(d.phone)}</td><td>${this.esc(d.driver_code)}</td>
      <td>${this.esc(d.status)}</td><td>${this.esc(d.availability)}</td><td>${d.total_deliveries || 0}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit-driver="${d.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No active drivers</td></tr>'}
    </tbody></table>`;
    body.querySelector('#del-add-driver').onclick = () => this.showDriverForm();
    body.querySelectorAll('[data-edit-driver]').forEach((b) => b.onclick = () => this.showDriverForm(Number(b.dataset.editDriver)));
  },

  renderPending(body) {
    const pending = this.drivers.filter((d) => d.status === 'pending');
    body.innerHTML = pending.length ? `<table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Actions</th></tr></thead>
      <tbody>${pending.map((d) => `<tr><td>${this.esc(d.full_name)}</td><td>${this.esc(d.phone)}</td><td>${this.esc(d.vehicle_info)}</td>
        <td><button class="btn btn-primary btn-sm" data-approve="${d.id}">Approve</button>
        <button class="btn btn-ghost btn-sm" data-reject="${d.id}">Reject</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No pending driver registrations.</p>';
    body.querySelectorAll('[data-approve]').forEach((b) => b.onclick = async () => {
      await API.approveDeliveryDriver(b.dataset.approve, this.actor);
      Utils.toast('Driver approved', 'success');
      await this.load();
      this.renderTab();
    });
    body.querySelectorAll('[data-reject]').forEach((b) => b.onclick = async () => {
      const reason = prompt('Rejection reason?') || 'Rejected';
      await API.rejectDeliveryDriver(b.dataset.reject, reason, this.actor);
      await this.load();
      this.renderTab();
    });
  },

  renderSettings(body) {
    const s = this.settings || {};
    body.innerHTML = `<form id="del-settings-form" class="form-grid" style="max-width:520px">
      <label class="field full">Department mode
        <select name="department_mode"><option value="per_branch" ${s.department_mode === 'per_branch' ? 'selected' : ''}>Per branch</option>
        <option value="central" ${s.department_mode === 'central' ? 'selected' : ''}>Central delivery department</option></select>
      </label>
      <label class="field full">Default assignment
        <select name="default_assignment_mode"><option value="manual" ${s.default_assignment_mode === 'manual' ? 'selected' : ''}>Manual</option>
        <option value="auto" ${s.default_assignment_mode === 'auto' ? 'selected' : ''}>Automatic</option></select>
      </label>
      <button type="submit" class="btn btn-primary">Save settings</button>
    </form>`;
    body.querySelector('#del-settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await API.saveDeliverySettings(Object.fromEntries(fd.entries()), this.actor);
      Utils.toast('Settings saved', 'success');
    };
  },

  async renderReports(body) {
    body.innerHTML = '<p class="muted">Loading reports…</p>';
    try {
      const r = await API.deliveryReports({ period: 'week' }, this.actor);
      body.innerHTML = `<h3>This week</h3>
        <pre style="background:var(--bg-secondary);padding:12px;border-radius:8px;overflow:auto">${this.esc(JSON.stringify(r, null, 2))}</pre>`;
    } catch (e) {
      body.innerHTML = `<p class="muted">${this.esc(e.message)}</p>`;
    }
  },

  showDriverForm(id) {
    const d = id ? this.drivers.find((x) => x.id === id) : {};
    Utils.showModal(id ? 'Edit driver' : 'Add driver', `
      <div class="form-grid">
        <label class="field full">Full name<input id="drv-name" value="${this.esc(d?.full_name || '')}"></label>
        <label class="field full">Phone<input id="drv-phone" value="${this.esc(d?.phone || '')}"></label>
        <label class="field full">Email<input id="drv-email" value="${this.esc(d?.email || '')}"></label>
        <label class="field full">Vehicle<input id="drv-vehicle" value="${this.esc(d?.vehicle_info || '')}"></label>
        <label class="field full">Password ${id ? '(leave blank to keep)' : ''}<input id="drv-pass" type="password"></label>
      </div>`,
      '<button class="btn btn-ghost" id="drv-cancel">Cancel</button><button class="btn btn-primary" id="drv-save">Save</button>');
    document.getElementById('drv-cancel').onclick = () => Utils.hideModal();
    document.getElementById('drv-save').onclick = async () => {
      const data = {
        id: id || undefined,
        full_name: document.getElementById('drv-name').value.trim(),
        phone: document.getElementById('drv-phone').value.trim(),
        email: document.getElementById('drv-email').value.trim(),
        vehicle_info: document.getElementById('drv-vehicle').value.trim(),
        status: 'active',
        password: document.getElementById('drv-pass').value || undefined
      };
      await API.saveDeliveryDriver(data, this.actor);
      Utils.hideModal();
      Utils.toast('Driver saved', 'success');
      await this.load();
      this.renderTab();
    };
  }
};
