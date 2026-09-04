/** Delivery Department — Admin Panel */
window.AdminDeliveryPage = {
  tab: 'dashboard',
  dash: null,
  orders: [],
  drivers: [],
  settings: null,
  branches: [],
  branchFees: [],
  actor: null,
  _loadedTabs: {},

  async render(el, admin) {
    this.el = el;
    this.admin = admin;
    this.actor = admin?.app?.user || admin?.user;
    this._loadedTabs = {};
    el.innerHTML = `<div class="admin-section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h2>🚚 Delivery Department</h2>
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
    await this.ensureTabData(this.tab);
    this.renderTab();
  },

  async ensureTabData(tab) {
    if (this._loadedTabs[tab]) return;
    try {
      if (tab === 'dashboard') {
        const [dash, orders] = await Promise.all([
          API.deliveryDashboard({}, this.actor),
          API.listDeliveries({ limit: 15 }, this.actor)
        ]);
        this.dash = dash;
        this.orders = orders?.data || orders || [];
        if (!this.settings) this.settings = await API.getDeliverySettings(this.actor).catch(() => ({}));
      } else if (tab === 'orders') {
        const [orders, settings] = await Promise.all([
          API.listDeliveries({ limit: 100 }, this.actor),
          API.getDeliverySettings(this.actor).catch(() => ({}))
        ]);
        this.orders = orders?.data || orders || [];
        this.settings = settings;
      }
      if (tab === 'drivers' || tab === 'pending' || tab === 'orders') {
        const drivers = await API.listDeliveryDrivers({}, this.actor);
        this.drivers = drivers?.data || drivers || [];
      }
      if (tab === 'settings') {
        const [settings, branchesRes, fees] = await Promise.all([
          API.getDeliverySettings(this.actor),
          API.getBranches?.().catch(() => ({ data: [] })),
          API.listDeliveryBranchSettings?.(this.actor).catch(() => [])
        ]);
        this.settings = settings;
        this.branches = branchesRes?.data || branchesRes || [];
        this.branchFees = Array.isArray(fees) ? fees : (fees?.data || []);
      }
      this._loadedTabs[tab] = true;
    } catch (e) {
      Utils.toast(e.message || 'Failed to load delivery data', 'error');
    }
  },

  async load(force = false) {
    if (force) this._loadedTabs = {};
    await this.ensureTabData(this.tab);
  },

  money(n) { return Utils.formatMoney(n); },
  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },

  driversForOrder(o) {
    const bid = o.branch_id;
    return (this.drivers || []).filter((d) => d.status === 'active' && (
      d.all_branches || !bid || (d.branches || []).includes(Number(bid))
    ));
  },

  renderTab() {
    const body = this.el.querySelector('#del-body');
    body.innerHTML = '<p class="muted">Loading…</p>';
    this.ensureTabData(this.tab).then(() => {
      if (this.tab === 'dashboard') return this.renderDashboard(body);
      if (this.tab === 'orders') return this.renderOrders(body);
      if (this.tab === 'drivers') return this.renderDrivers(body);
      if (this.tab === 'pending') return this.renderPending(body);
      if (this.tab === 'settings') return this.renderSettings(body);
      if (this.tab === 'reports') return this.renderReports(body);
    });
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
    body.innerHTML = `<div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select id="del-filter-status"><option value="">All statuses</option>${statuses.filter(Boolean).map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
      <button class="btn btn-primary" id="del-refresh">Refresh</button>
      <span class="muted">Select orders and assign one driver to multiple deliveries</span>
    </div>
    <div id="del-orders-list">${this.ordersTable(this.orders, { selectable: true })}</div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <select id="del-bulk-driver"><option value="">Assign selected to driver…</option>
        ${(this.drivers || []).filter((d) => d.status === 'active').map((d) => `<option value="${d.id}">${this.esc(d.full_name)}</option>`).join('')}
      </select>
      <button class="btn btn-primary" id="del-bulk-assign">Assign selected</button>
    </div>`;
    body.querySelector('#del-refresh').onclick = async () => {
      const st = body.querySelector('#del-filter-status').value;
      this.orders = await API.listDeliveries(st ? { status: st } : {}, this.actor);
      this.orders = this.orders?.data || this.orders || [];
      body.querySelector('#del-orders-list').innerHTML = this.ordersTable(this.orders, { selectable: true });
      this.bindOrderActions(body);
    };
    body.querySelector('#del-bulk-assign').onclick = () => this.bulkAssign(body);
    this.bindOrderActions(body);
  },

  bulkAssign(body) {
    const driverId = body.querySelector('#del-bulk-driver')?.value;
    const ids = [...body.querySelectorAll('.del-pick:checked')].map((x) => Number(x.value));
    if (!driverId) return Utils.toast('Choose a driver', 'error');
    if (!ids.length) return Utils.toast('Select at least one order', 'error');
    const order = this.orders.find((o) => o.id === ids[0]);
    const defaultFee = Number(order?.delivery_fee) || 0;
    this.showAssignFeeModal(defaultFee, async (fee) => {
      try {
        await API.assignMultipleDeliveries(ids, driverId, this.actor, { delivery_fee: fee });
        Utils.toast(`${ids.length} order(s) assigned`, 'success');
        this._loadedTabs.orders = false;
        await this.load(true);
        this.renderTab();
      } catch (e) { Utils.toast(e.message, 'error'); }
    });
  },

  showAssignFeeModal(defaultFee, onConfirm) {
    Utils.showModal('Assign delivery — fee for driver', `
      <p class="muted">Current branch delivery fee: <strong>${this.money(defaultFee)}</strong></p>
      <label class="field full">Delivery fee for driver (R)
        <input type="number" id="del-assign-fee" min="0" step="0.01" value="${defaultFee}"></label>`,
      `<button class="btn btn-ghost" id="del-assign-cancel">Cancel</button>
       <button class="btn btn-primary" id="del-assign-ok">Assign</button>`);
    document.getElementById('del-assign-cancel').onclick = () => Utils.hideModal();
    document.getElementById('del-assign-ok').onclick = () => {
      const fee = Number(document.getElementById('del-assign-fee').value);
      if (Number.isNaN(fee) || fee < 0) return Utils.toast('Invalid fee', 'error');
      Utils.hideModal();
      onConfirm(fee);
    };
  },

  ordersTable(rows, opts = {}) {
    if (!rows?.length) return '<p class="muted">No delivery orders yet. Delivery orders appear from POS, online, or kiosk when delivery is selected.</p>';
    return `<table class="data-table"><thead><tr>
      ${opts.selectable ? '<th></th>' : ''}
      <th>Order</th><th>Delivery #</th><th>Customer</th><th>Address</th><th>Branch</th><th>Fee</th><th>Driver</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>${rows.map((o) => `<tr data-oid="${o.id}">
      ${opts.selectable ? `<td><input type="checkbox" class="del-pick" value="${o.id}"></td>` : ''}
      <td>${this.esc(o.order_number)}<br><small class="muted">${this.esc(o.source_label || o.source_type || '')}</small></td>
      <td><strong>${this.esc(o.confirmation_code || '—')}</strong></td>
      <td>${this.esc(o.customer_name)}<br><small>${this.esc(o.customer_phone)}</small></td>
      <td>${this.esc(o.delivery_address)}</td>
      <td>${this.esc(o.branch_name || o.branch_id || '')}</td>
      <td>${this.money(o.delivery_fee)}</td>
      <td>${this.esc(o.driver_name || '—')}</td>
      <td><span class="badge">${this.esc(o.status)}</span></td>
      <td class="del-actions" data-oid="${o.id}">
        <button class="btn btn-ghost btn-sm" data-act="view" data-oid="${o.id}">View</button>
        ${o.tracking_token ? `<a href="/track/${o.tracking_token}" target="_blank" class="btn btn-ghost btn-sm">Track</a>` : ''}
        <select class="del-assign-driver" data-oid="${o.id}" data-fee="${o.delivery_fee || 0}"><option value="">Assign driver…</option>
          ${this.driversForOrder(o).map((d) => `<option value="${d.id}" ${o.driver_id == d.id ? 'selected' : ''}>${this.esc(d.full_name)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" data-act="auto-assign" data-oid="${o.id}">${(this.settings?.default_assignment_mode === 'auto') ? 'Release to drivers' : 'Auto'}</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
  },

  bindOrderActions(body) {
    body.querySelectorAll('[data-act="view"]').forEach((btn) => {
      btn.onclick = () => this.showOrder(Number(btn.dataset.oid));
    });
    body.querySelectorAll('.del-assign-driver').forEach((sel) => {
      sel.onchange = async () => {
        if (!sel.value) return;
        const defaultFee = Number(sel.dataset.fee) || 0;
        const driverId = sel.value;
        const orderId = sel.dataset.oid;
        sel.value = '';
        this.showAssignFeeModal(defaultFee, async (fee) => {
          try {
            await API.assignDeliveryDriver(orderId, driverId, this.actor, { delivery_fee: fee });
            Utils.toast('Driver assigned', 'success');
            this._loadedTabs.orders = false;
            await this.load(true);
            this.renderTab();
          } catch (e) { Utils.toast(e.message, 'error'); }
        });
      };
    });
    body.querySelectorAll('[data-act="auto-assign"]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await API.autoAssignDelivery(btn.dataset.oid, this.actor);
          Utils.toast('Sent to drivers — first to accept will deliver', 'success');
          this._loadedTabs.orders = false;
          await this.load(true);
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
    });
  },

  async showOrder(id) {
    try {
      const o = await API.getDelivery(id, this.actor);
      const items = (o.items || []).map((i) => `<li>${i.quantity || 1}× ${this.esc(i.name || i.product_name)}</li>`).join('') || '<li class="muted">No items</li>';
      Utils.showModal(`Delivery order ${this.esc(o.confirmation_code || o.order_number)}`, `
        <div style="display:grid;gap:8px;font-size:14px">
          <div><strong>Status:</strong> ${this.esc(o.status)}</div>
          <div><strong>Delivery number:</strong> ${this.esc(o.confirmation_code)}</div>
          <div><strong>Customer:</strong> ${this.esc(o.customer_name)} · ${this.esc(o.customer_phone)}</div>
          <div><strong>Address:</strong> ${this.esc(o.delivery_address)}</div>
          <div><strong>Branch:</strong> ${this.esc(o.branch_name || o.branch_id)}</div>
          <div><strong>Delivery fee:</strong> ${this.money(o.delivery_fee)}</div>
          <div><strong>Order total:</strong> ${this.money(o.total)}</div>
          <div><strong>Driver:</strong> ${this.esc(o.driver_name || 'Not assigned')}</div>
          <div><strong>Source:</strong> ${this.esc(o.source_label || o.source_type)}</div>
          <div><strong>Items:</strong><ul style="margin:4px 0 0 16px">${items}</ul></div>
          ${o.special_instructions ? `<div><strong>Notes:</strong> ${this.esc(o.special_instructions)}</div>` : ''}
        </div>`, '<button class="btn btn-primary" id="del-view-close">Close</button>');
      document.getElementById('del-view-close').onclick = () => Utils.hideModal();
    } catch (e) {
      Utils.toast(e.message || 'Could not load order', 'error');
    }
  },

  renderDrivers(body) {
    const all = this.drivers || [];
    const availClass = (a) => a === 'online' ? 'color:#16a34a;font-weight:700' : 'color:#64748b';
    body.innerHTML = `<div style="margin:12px 0"><button class="btn btn-primary" id="del-add-driver">Add driver</button></div>
    <table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Code</th><th>Status</th><th>Availability</th><th>Branches</th><th>Deliveries</th><th></th></tr></thead>
    <tbody>${all.length ? all.map((d) => `<tr>
      <td>${this.esc(d.full_name)}</td><td>${this.esc(d.phone)}</td><td>${this.esc(d.driver_code)}</td>
      <td><span class="badge">${this.esc(d.status)}</span></td>
      <td style="${availClass(d.availability)}">${this.esc(d.availability || 'offline')}</td>
      <td>${d.all_branches ? 'All branches' : this.esc((d.branches || []).join(', ') || '—')}</td>
      <td>${d.total_deliveries || 0}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-edit-driver="${d.id}">Edit</button>
        ${d.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-suspend-driver="${d.id}">Suspend</button>` : ''}
        ${d.status === 'suspended' ? `<button class="btn btn-ghost btn-sm" data-activate-driver="${d.id}">Reactivate</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-delete-driver="${d.id}">Delete</button>
      </td></tr>`).join('') : '<tr><td colspan="8" class="muted">No drivers yet</td></tr>'}
    </tbody></table>`;
    body.querySelector('#del-add-driver').onclick = () => this.showDriverForm();
    body.querySelectorAll('[data-edit-driver]').forEach((b) => b.onclick = () => this.showDriverForm(Number(b.dataset.editDriver)));
    body.querySelectorAll('[data-suspend-driver]').forEach((b) => b.onclick = async () => {
      if (!confirm(`Suspend ${this.esc(this.drivers.find((x) => x.id === Number(b.dataset.suspendDriver))?.full_name || 'driver')}? They will not be able to sign in.`)) return;
      await API.suspendDeliveryDriver(Number(b.dataset.suspendDriver), this.actor);
      Utils.toast('Driver suspended', 'info');
      this._loadedTabs.drivers = false;
      await this.load(true);
      this.renderTab();
    });
    body.querySelectorAll('[data-activate-driver]').forEach((b) => b.onclick = async () => {
      await API.saveDeliveryDriver({ id: Number(b.dataset.activateDriver), status: 'active' }, this.actor);
      Utils.toast('Driver reactivated', 'success');
      this._loadedTabs.drivers = false;
      await this.load(true);
      this.renderTab();
    });
    body.querySelectorAll('[data-delete-driver]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this driver permanently?')) return;
      await API.deleteDeliveryDriver(Number(b.dataset.deleteDriver), this.actor);
      Utils.toast('Driver removed', 'info');
      this._loadedTabs.drivers = false;
      await this.load(true);
      this.renderTab();
    });
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
    const branchOpts = (this.branches || []).map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('');
    body.innerHTML = `<form id="del-settings-form" class="form-grid" style="max-width:520px">
      <label class="field full">Department mode
        <select name="department_mode"><option value="per_branch" ${s.department_mode === 'per_branch' ? 'selected' : ''}>Per branch</option>
        <option value="central" ${s.department_mode === 'central' ? 'selected' : ''}>Central delivery department</option></select>
      </label>
      <label class="field full">Default assignment
        <select name="default_assignment_mode"><option value="manual" ${s.default_assignment_mode === 'manual' ? 'selected' : ''}>Manual — admin assigns driver</option>
        <option value="auto" ${s.default_assignment_mode === 'auto' ? 'selected' : ''}>Automatic — drivers accept (first accept wins)</option></select>
      </label>
      <button type="submit" class="btn btn-primary">Save settings</button>
    </form>
    <hr style="margin:24px 0">
    <h3>Saved branch delivery fees</h3>
    <p class="muted">These fees apply on POS and online ordering. Free delivery applies when order subtotal is at or above the threshold.</p>
    <table class="data-table" style="margin:12px 0"><thead><tr><th>Branch</th><th>Fee</th><th>Free above</th><th>Min order</th><th></th></tr></thead>
    <tbody>${(this.branchFees || []).length ? this.branchFees.map((b) => `<tr>
      <td>${this.esc(b.branch_name || b.branch_id)}</td>
      <td>${this.money(b.delivery_fee)}</td>
      <td>${this.money(b.free_delivery_above)}</td>
      <td>${this.money(b.min_order)}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit-fee="${b.branch_id}">Edit</button>
      <button class="btn btn-ghost btn-sm" data-del-fee="${b.branch_id}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">No branch fees saved yet — add one below.</td></tr>'}
    </tbody></table>
    <h3>Add / edit branch fee</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
      <select id="del-branch-pick">${branchOpts}</select>
      <button class="btn btn-ghost" id="del-branch-load">Load branch</button>
    </div>
    <form id="del-branch-fee-form" class="form-grid" style="max-width:420px;display:none">
      <label class="field full">Delivery fee (R)<input name="delivery_fee" type="number" min="0" step="0.01"></label>
      <label class="field full">Free delivery above (R)<input name="free_delivery_above" type="number" min="0" step="0.01" placeholder="0 = always charge fee"></label>
      <label class="field full">Minimum order (R)<input name="min_order" type="number" min="0" step="0.01"></label>
      <button type="submit" class="btn btn-primary">Save branch fee</button>
    </form>`;
    body.querySelector('#del-settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await API.saveDeliverySettings(Object.fromEntries(fd.entries()), this.actor);
      this.settings = await API.getDeliverySettings(this.actor);
      Utils.toast('Settings saved', 'success');
    };
    const branchForm = body.querySelector('#del-branch-fee-form');
    const loadBranchForm = async (bid) => {
      const bs = await API.getDeliveryBranchSettings(bid, this.actor);
      branchForm.style.display = '';
      branchForm.delivery_fee.value = bs.delivery_fee || 0;
      branchForm.free_delivery_above.value = bs.free_delivery_above || 0;
      branchForm.min_order.value = bs.min_order || 0;
      branchForm.dataset.branchId = bid;
    };
    body.querySelector('#del-branch-load').onclick = async () => {
      await loadBranchForm(body.querySelector('#del-branch-pick').value);
    };
    body.querySelectorAll('[data-edit-fee]').forEach((btn) => {
      btn.onclick = () => loadBranchForm(btn.dataset.editFee);
    });
    body.querySelectorAll('[data-del-fee]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Delete this branch fee setting?')) return;
        await API.deleteDeliveryBranchSettings(Number(btn.dataset.delFee), this.actor);
        this._loadedTabs.settings = false;
        await this.load(true);
        this.renderTab();
      };
    });
    branchForm.onsubmit = async (e) => {
      e.preventDefault();
      const bid = branchForm.dataset.branchId;
      const fd = new FormData(branchForm);
      await API.saveDeliveryBranchSettings(bid, Object.fromEntries(fd.entries()), this.actor);
      Utils.toast('Branch delivery fee saved — synced to POS & online', 'success');
      this._loadedTabs.settings = false;
      await this.load(true);
      this.renderTab();
    };
  },

  async renderReports(body) {
    body.innerHTML = '<p class="muted">Loading reports…</p>';
    try {
      if (!this.drivers?.length) {
        const drivers = await API.listDeliveryDrivers({}, this.actor);
        this.drivers = drivers?.data || drivers || [];
      }
      const driverOpts = `<option value="">All drivers</option>${(this.drivers || []).filter((d) => d.status === 'active' || d.status === 'suspended').map((d) =>
        `<option value="${d.id}">${this.esc(d.full_name)}</option>`).join('')}`;
      body.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <label>From <input type="date" id="del-rep-from" value="${new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)}"></label>
        <label>To <input type="date" id="del-rep-to" value="${new Date().toISOString().slice(0, 10)}"></label>
        <select id="del-rep-driver">${driverOpts}</select>
        <button class="btn btn-primary" id="del-rep-run">Run report</button>
      </div>
      <div id="del-rep-out"><p class="muted">Run report to see deliveries.</p></div>`;
      body.querySelector('#del-rep-run').onclick = () => this.runReport(body);
    } catch (e) {
      body.innerHTML = `<p class="muted">${this.esc(e.message)}</p>`;
    }
  },

  async runReport(body) {
    const from = body.querySelector('#del-rep-from').value;
    const to = body.querySelector('#del-rep-to').value;
    const driverId = body.querySelector('#del-rep-driver').value;
    const out = body.querySelector('#del-rep-out');
    out.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const r = driverId
        ? await API.deliveryDriverEarnings(Number(driverId), { from, to }, this.actor)
        : await API.deliveryReports({ from, to }, this.actor);
      const rows = r.rows || [];
      const shop = r.shop || {};
      const driver = r.driver;
      const title = driver ? `Driver earnings — ${driver.full_name}` : `Delivery report (${from} → ${to})`;
      out.innerHTML = `<h3>${this.esc(title)}</h3>
        ${shop.shop_name ? `<p class="muted">${this.esc(shop.shop_name)}${shop.phone ? ` · ${this.esc(shop.phone)}` : ''}</p>` : ''}
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:12px 0">
          ${driver ? `<div class="card"><div class="muted">Total earned</div><strong>${this.money(r.total)}</strong></div>
          <div class="card"><div class="muted">Deliveries</div><strong>${rows.length}</strong></div>` :
          `<div class="card"><div class="muted">Total orders</div><strong>${r.summary?.total || 0}</strong></div>
          <div class="card"><div class="muted">Delivered</div><strong>${r.summary?.delivered || 0}</strong></div>
          <div class="card"><div class="muted">Driver fees</div><strong>${this.money(r.summary?.fees)}</strong></div>`}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          ${driver?.phone ? `<button class="btn btn-primary" id="del-rep-wa">Send via WhatsApp</button>` : ''}
          <button class="btn btn-ghost" id="del-rep-print">Print / Save PDF</button>
        </div>
        <table class="data-table" id="del-rep-table"><thead><tr>
          <th>Date</th><th>Delivery #</th><th>Customer</th>${driver ? '<th>Address</th>' : '<th>Branch</th><th>Driver</th>'}<th>Fee</th><th>Status</th>
        </tr></thead><tbody>
          ${rows.length ? rows.map((row) => `<tr>
            <td>${this.esc((row.delivered_at || row.created_at || '').slice(0, 10) || '—')}</td>
            <td>${this.esc(row.confirmation_code || row.order_number)}</td>
            <td>${this.esc(row.customer_name)}</td>
            <td>${this.esc(driver ? row.delivery_address : (row.branch_name || row.driver_name || '—'))}</td>
            ${driver ? '' : `<td>${this.esc(row.driver_name || '—')}</td>`}
            <td>${this.money(row.delivery_fee)}</td>
            <td>${this.esc(row.status)}</td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted">No deliveries in this period</td></tr>'}
        </tbody></table>`;
      body.querySelector('#del-rep-print')?.addEventListener('click', () => {
        const w = window.open('', '_blank');
        w.document.write(`<html><head><title>${title}</title></head><body>
          <h1>${shop.shop_name || 'Delivery Report'}</h1>
          <p>${shop.address || ''} ${shop.phone || ''}</p>
          <h2>${title}</h2>
          ${out.querySelector('#del-rep-table').outerHTML}
          <script>window.print();</script></body></html>`);
        w.document.close();
      });
      body.querySelector('#del-rep-wa')?.addEventListener('click', () => {
        const phone = String(driver.phone || '').replace(/\D/g, '');
        const wa = phone.startsWith('0') ? `27${phone.slice(1)}` : phone;
        const lines = rows.map((row) => `${(row.delivered_at || '').slice(0, 10)} ${row.confirmation_code || row.order_number}: R${Number(row.delivery_fee || 0).toFixed(2)}`).join('%0A');
        const msg = encodeURIComponent(`${shop.shop_name || 'Shop'} delivery earnings ${from} to ${to}%0ATotal: R${Number(r.total || r.summary?.fees || 0).toFixed(2)}%0A%0A${decodeURIComponent(lines)}`);
        window.open(`https://wa.me/${wa}?text=${msg}`, '_blank');
      });
    } catch (e) {
      out.innerHTML = `<p class="muted">${this.esc(e.message)}</p>`;
    }
  },

  showDriverForm(id) {
    const d = id ? this.drivers.find((x) => x.id === id) : {};
    const branchChecks = (this.branches || []).map((b) => {
      const checked = d?.all_branches || (d?.branches || []).includes(Number(b.id));
      return `<label style="display:block"><input type="checkbox" class="drv-branch" value="${b.id}" ${checked ? 'checked' : ''}> ${this.esc(b.name)}</label>`;
    }).join('');
    Utils.showModal(id ? 'Edit driver' : 'Add driver', `
      <div class="form-grid">
        <label class="field full">Full name<input id="drv-name" value="${this.esc(d?.full_name || '')}"></label>
        <label class="field full">Phone<input id="drv-phone" value="${this.esc(d?.phone || '')}"></label>
        <label class="field full">Email<input id="drv-email" value="${this.esc(d?.email || '')}"></label>
        <label class="field full">Vehicle<input id="drv-vehicle" value="${this.esc(d?.vehicle_info || '')}"></label>
        <label class="field full"><input type="checkbox" id="drv-all-branches" ${d?.all_branches ? 'checked' : ''}> All branches</label>
        <div class="field full"><span class="muted">Branches</span>${branchChecks || '<p class="muted">No branches</p>'}</div>
        <label class="field full">Password ${id ? '(leave blank to keep)' : ''}<input id="drv-pass" type="password"></label>
      </div>`,
      '<button class="btn btn-ghost" id="drv-cancel">Cancel</button><button class="btn btn-primary" id="drv-save">Save</button>');
    document.getElementById('drv-cancel').onclick = () => Utils.hideModal();
    document.getElementById('drv-save').onclick = async () => {
      const branches = [...document.querySelectorAll('.drv-branch:checked')].map((x) => Number(x.value));
      const data = {
        id: id || undefined,
        full_name: document.getElementById('drv-name').value.trim(),
        phone: document.getElementById('drv-phone').value.trim(),
        email: document.getElementById('drv-email').value.trim(),
        vehicle_info: document.getElementById('drv-vehicle').value.trim(),
        all_branches: document.getElementById('drv-all-branches').checked,
        branches,
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
