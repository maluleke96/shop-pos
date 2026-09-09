/** Delivery Department — Admin Panel */
window.AdminDeliveryPage = {
  tab: 'dashboard',
  _tabKey: 'delivery_dept_tab',
  dash: null,
  orders: [],
  orderHistory: [],
  drivers: [],
  settings: null,
  branches: [],
  branchFees: [],
  actor: null,
  _loadedTabs: {},
  _refreshTimer: null,
  _lastRefresh: null,
  _payHistoryDriverId: null,
  _payFrom: null,
  _payTo: null,

  _paymentRows() {
    const s = this.paymentSummary;
    if (Array.isArray(s)) return s;
    if (Array.isArray(s?.data)) return s.data;
    return [];
  },

  TABS: ['dashboard', 'pool', 'orders', 'drivers', 'pending', 'payments', 'settings', 'reports'],

  stopAutoRefresh() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => {
      if (document.hidden) return;
      const tab = this.tab;
      const preserve = {
        payHistoryDriverId: this._payHistoryDriverId,
        payFrom: this._payFrom,
        payTo: this._payTo
      };
      this.ensureTabData(tab).then(() => this.paintTab({ silent: true, preserve })).catch(() => {});
    }, 30000);
  },

  poolOrders() {
    return (this.orders || []).filter((o) => String(o.status || '').toLowerCase() === 'awaiting_driver');
  },

  onlineDrivers() {
    return (this.drivers || []).filter((d) => d.status === 'active' && String(d.availability || '').toLowerCase() === 'online');
  },

  pendingClaimsCount() {
    return (this.payoutClaims || []).filter((c) => String(c.status || '').toLowerCase() === 'pending').length;
  },

  tabBadge(tab) {
    if (tab === 'pending') {
      const n = this.pendingDriverCount();
      return n ? `<span class="dd-tab-badge">${n}</span>` : '';
    }
    if (tab === 'pool') {
      const n = this.poolOrders().length;
      return n ? `<span class="dd-tab-badge">${n}</span>` : '';
    }
    if (tab === 'payments') {
      const n = this.pendingClaimsCount();
      return n ? `<span class="dd-tab-badge">${n}</span>` : '';
    }
    return '';
  },

  claimWindowText() {
    const s = this.settings || {};
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const d = s.payout_day_of_week;
    if (d == null || d === '') return 'Default: drivers can claim anytime unless a driver has their own payout day set';
    const dayName = days[Number(d)] || 'scheduled day';
    return `Default claim window opens the day before ${dayName}. Each driver can have their own payout day in Edit driver`;
  },

  payoutDayLabel(value) {
    if (value == null || value === '') return 'Use department default';
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[Number(value)] || 'Use department default';
  },

  statusBadge(status) {
    const s = String(status || 'unknown').toLowerCase().replace(/\s+/g, '_');
    const label = String(status || '—').replace(/_/g, ' ');
    return `<span class="dd-status ${s}">${this.esc(label)}</span>`;
  },

  trackUrl(token) {
    if (!token) return '';
    const base = this.baseUrl();
    return `${base}/driver/track.html?token=${encodeURIComponent(token)}`;
  },

  baseUrl() {
    return (window.__SHOP_POS_ENV__?.RPC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_RPC_URL || window.location.origin || '')
      .replace(/\/rpc\/?$/i, '').replace(/\/$/, '') || 'https://chisafood.up.railway.app';
  },

  whatsappLink(phone, text) {
    const p = String(phone || '').replace(/\D/g, '');
    if (!p) return '#';
    const wa = p.startsWith('27') ? p : (p.startsWith('0') ? `27${p.slice(1)}` : p);
    const q = text ? `?text=${encodeURIComponent(text)}` : '';
    return `https://wa.me/${wa}${q}`;
  },

  bindNotifyToggle(root) {
    const cb = root?.querySelector('#dd-notify-sound');
    if (cb && window.PanelNotify) PanelNotify.bindSoundToggle(cb, 'delivery');
  },

  async render(el, admin) {
    this.el = el;
    this.admin = admin;
    this.actor = admin?.app?.user || admin?.user;
    if (window.App?.ensureFeatureCss) await App.ensureFeatureCss('css/delivery-dept.css').catch(() => {});
    this._loadedTabs = {};
    if (this.standalone) {
      try {
        const saved = sessionStorage.getItem(this._tabKey);
        if (saved && this.TABS.includes(saved)) this.tab = saved;
      } catch (_) { /* ignore */ }
    }
    await this.ensureTabData('dashboard').catch(() => {});
    this._lastRefresh = new Date();
    el.innerHTML = `<div class="admin-section dd-console">
      <div class="dd-hero">
        <div>
          <h2>Delivery Operations</h2>
          <p>Manage drivers, live pool, payouts, and delivery settings — synced with the driver app in real time.</p>
          <div class="dd-live"><span class="dd-live-dot"></span> Live sync · refreshes every 30s</div>
        </div>
        <div class="dd-hero-actions">
          ${window.PanelNotify ? PanelNotify.soundToggleHtml('delivery', { id: 'dd-notify-sound', label: 'Alert sounds' }) : ''}
          <a class="btn btn-sm" href="${this.driverAppUrl()}" target="_blank" rel="noopener">Driver app ↗</a>
          <button type="button" class="btn btn-sm" id="dd-open-register">Register driver</button>
          <button type="button" class="btn btn-primary btn-sm" id="dd-refresh-all">Refresh now</button>
        </div>
      </div>
      <div class="dd-links" style="margin-bottom:18px">
        <a class="dd-link-card" href="${this.driverAppUrl()}" target="_blank" rel="noopener">
          <strong>📱 Driver app</strong><span>What drivers see — pool, accept, navigate, earnings</span>
        </a>
        <button type="button" class="dd-link-card" id="dd-hero-register" style="border:none;cursor:pointer;text-align:left">
          <strong>📝 Register driver</strong><span>Same form as driver self-signup — stays in this department</span>
        </button>
        <a class="dd-link-card" href="${this.deliveryPortalUrl()}" target="_blank" rel="noopener">
          <strong>🏢 Staff portal login</strong><span>Delivery department staff sign-in</span>
        </a>
      </div>
      ${this.standalone ? '' : `<div class="dd-section" style="background:#ecfdf5;border-color:#99f6e4;padding:12px 16px">
        <strong>Staff access:</strong> Create users with role <strong>Delivery Department</strong> in Admin → Users.
        Portal: <a href="${this.deliveryPortalUrl()}" target="_blank" rel="noopener">${this.deliveryPortalUrl()}</a>
      </div>`}
      <div class="dd-tabs" id="del-tabs">
        ${this.TABS.map((t) =>
          `<button type="button" class="admin-tab dd-tab ${this.tab === t ? 'active' : ''}" data-tab="${t}">${this.tabLabel(t)}${this.tabBadge(t)}</button>`).join('')}
      </div>
      <div id="del-body"><p class="muted">Loading…</p></div>
    </div>`;
    this.bindNotifyToggle(el);
    el.querySelector('#dd-refresh-all')?.addEventListener('click', async () => {
      this._loadedTabs = {};
      await this.load(true);
      this.renderTab();
      Utils.toast('Delivery data refreshed', 'success');
    });
    el.querySelector('#dd-open-register')?.addEventListener('click', () => {
      this.tab = 'pending';
      try { sessionStorage.setItem(this._tabKey, 'pending'); } catch (_) { /* */ }
      el.querySelectorAll('.dd-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'pending'));
      this.renderTab();
      setTimeout(() => this.showDriverRegistrationModal(), 200);
    });
    el.querySelector('#dd-hero-register')?.addEventListener('click', () => this.showDriverRegistrationModal());
    el.querySelector('#del-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      try { sessionStorage.setItem(this._tabKey, this.tab); } catch (_) { /* ignore */ }
      el.querySelectorAll('.admin-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === this.tab));
      this.renderTab({ silent: !!this._loadedTabs[this.tab] });
    };
    await this.ensureTabData(this.tab);
    this.renderTab();
    this.startAutoRefresh();
  },

  registrationUrl() {
    return `${this.baseUrl()}/driver/register.html`;
  },

  deliveryPortalUrl() {
    return `${this.baseUrl()}/delivery-app.html`;
  },

  driverAppUrl() {
    return `${this.baseUrl()}/driver/`;
  },

  pendingDriverCount() {
    return (this.drivers || []).filter((d) => d.status === 'pending').length;
  },

  tabLabel(t) {
    const labels = {
      dashboard: 'Dashboard',
      pool: 'Driver pool',
      orders: 'Orders',
      drivers: 'Drivers',
      pending: 'Applications',
      payments: 'Payments',
      settings: 'Settings',
      reports: 'Reports'
    };
    if (t === 'pending') {
      const n = this.pendingDriverCount();
      return n ? `Applications (${n})` : (labels.pending || 'Applications');
    }
    if (t === 'pool') {
      const n = this.poolOrders().length;
      return n ? `Driver pool (${n})` : (labels.pool || 'Driver pool');
    }
    return labels[t] || t.charAt(0).toUpperCase() + t.slice(1);
  },

  async ensureTabData(tab) {
    if (this._loadedTabs[tab]) return;
    try {
      if (tab === 'dashboard' || tab === 'pool') {
        const [dash, orders, driversRes] = await Promise.all([
          API.deliveryDashboard({}, this.actor),
          API.listDeliveries({ active: true, limit: 100 }, this.actor),
          API.listDeliveryDrivers({}, this.actor).catch(() => [])
        ]);
        this.dash = dash;
        this.orders = orders?.data || orders || [];
        this.drivers = driversRes?.data || driversRes || [];
        if (!this.settings) this.settings = await API.getDeliverySettings(this.actor).catch(() => ({}));
      } else if (tab === 'orders') {
        const [orders, history, settings] = await Promise.all([
          API.listDeliveries({ active: true, limit: 100 }, this.actor),
          API.listDeliveries({ history: true, limit: 100 }, this.actor),
          API.getDeliverySettings(this.actor).catch(() => ({}))
        ]);
        this.orders = orders?.data || orders || [];
        this.orderHistory = history?.data || history || [];
        this.settings = settings;
      }
      if (tab === 'drivers' || tab === 'pending' || tab === 'orders') {
        const drivers = await API.listDeliveryDrivers({}, this.actor);
        this.drivers = drivers?.data || drivers || [];
      }
      if (tab === 'drivers' || tab === 'pending') {
        const branchesRes = await API.getBranches?.().catch(() => ({ data: [] }));
        this.branches = branchesRes?.data || branchesRes || [];
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
      if (tab === 'payments') {
        const [summary, claims] = await Promise.all([
          API.deliveryDriverPaymentSummary(this.actor).catch(() => []),
          API.listPayoutClaims({ status: 'pending' }, this.actor).catch(() => [])
        ]);
        this.paymentSummary = summary;
        this.payoutClaims = claims?.data || claims || [];
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
  localTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  localWeekAgoStr() {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  downloadPdfBase64(base64, filename) {
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'driver-payment.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      Utils.toast(e.message || 'PDF download failed', 'error');
    }
  },
  payoutDeliveriesTableHtml(deliveries) {
    const rows = (deliveries || []);
    if (!rows.length) return '<p class="muted">No completed deliveries in this period.</p>';
    return `<div style="max-height:42vh;overflow:auto;margin-top:12px"><table class="data-table"><thead><tr>
      <th>#</th><th>Code</th><th>Completed</th><th>Branch</th><th>Customer</th><th>Address</th><th>Items</th><th>Fee</th>
    </tr></thead><tbody>${rows.map((d, i) => {
      const items = (d.items || []).map((it) => `${it.quantity}× ${it.name}`).join(', ') || '—';
      return `<tr><td>${i + 1}</td><td>${this.esc(d.confirmation_code || d.order_number || '—')}</td>
        <td>${this.esc(String(d.delivered_at || '').slice(0, 16))}</td><td>${this.esc(d.branch_name || '—')}</td>
        <td>${this.esc(d.customer_name || '—')}</td><td>${this.esc(d.delivery_address || '—')}</td>
        <td>${this.esc(items)}</td><td><strong>${this.money(d.delivery_fee)}</strong></td></tr>`;
    }).join('')}</tbody></table></div>`;
  },
  async sendPayoutWhatsApp(payout, driver) {
    if (!driver?.phone) return Utils.toast('Driver has no phone number', 'error');
    const detail = payout?.deliveries ? payout : (await API.deliveryDriverPayoutDetail(payout.id, this.actor).catch(() => null))?.payout || payout;
    const lines = [
      `${this.app?.settings?.shop_name || 'Payment'} — delivery fees paid`,
      `Driver: ${driver.full_name}`,
      `Amount: ${this.money(detail.amount)}`,
      `Period: ${detail.period_from} → ${detail.period_to}`,
      ...(detail.deliveries || []).map((d, i) => `${i + 1}. ${d.confirmation_code || d.order_number} · ${this.money(d.delivery_fee)} · ${d.delivery_address || ''}`)
    ];
    const msg = lines.join('\n');
    try {
      const wa = await API.sendWhatsAppMessage({
        phone: driver.phone,
        recipient_name: driver.full_name,
        message_type: 'delivery_payout',
        body: msg
      }, this.actor);
      await Utils.deliverWhatsApp(wa, driver.phone, msg);
    } catch (_) {
      window.open(`https://wa.me/${String(driver.phone).replace(/\D/g, '').replace(/^0/, '27')}?text=${encodeURIComponent(msg)}`, '_blank');
    }
  },
  async showSavedPayoutModal(payout, driver) {
    const p = payout?.deliveries ? payout : (await API.deliveryDriverPayoutDetail(payout.id, this.actor).catch(() => ({ payout })))?.payout || payout;
    Utils.showModal(
      `Payment saved — ${this.esc(driver?.full_name || 'Driver')}`,
      `<p><strong>${this.money(p.amount)}</strong> · ${p.delivery_count || (p.deliveries || []).length || 0} deliveries<br>
      <span class="muted">${this.esc(p.period_from)} → ${this.esc(p.period_to)}</span></p>
      ${this.payoutDeliveriesTableHtml(p.deliveries)}`,
      `<button class="btn btn-ghost" id="payout-modal-close">Close</button>
       <button class="btn btn-ghost" id="payout-modal-pdf">Download PDF</button>
       ${driver?.phone ? '<button class="btn btn-primary" id="payout-modal-wa">Send WhatsApp</button>' : ''}`
    );
    document.getElementById('payout-modal-close').onclick = () => Utils.hideModal();
    document.getElementById('payout-modal-pdf').onclick = async () => {
      try {
        const r = await API.deliveryDriverPayoutPdf(p.id, this.actor);
        const data = r?.data || r;
        this.downloadPdfBase64(data.pdf, data.filename || `payment-${p.id}.pdf`);
      } catch (e) { Utils.toast(e.message || 'PDF failed', 'error'); }
    };
    document.getElementById('payout-modal-wa')?.addEventListener('click', () => this.sendPayoutWhatsApp(p, driver));
  },
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

  renderTab(opts = {}) {
    this.paintTab(opts);
  },

  paintTab(opts = {}) {
    const body = this.el?.querySelector('#del-body');
    if (!body) return;
    const alreadyLoaded = !!this._loadedTabs[this.tab];
    if (!opts.silent && !alreadyLoaded) body.innerHTML = '<p class="muted">Loading…</p>';
    const render = () => {
      if (this.tab === 'dashboard') this.renderDashboard(body);
      else if (this.tab === 'pool') this.renderPool(body);
      else if (this.tab === 'orders') this.renderOrders(body);
      else if (this.tab === 'drivers') this.renderDrivers(body);
      else if (this.tab === 'pending') this.renderPending(body);
      else if (this.tab === 'payments') {
        this.renderPayments(body);
        if (opts.preserve?.payHistoryDriverId) {
          this.loadPaymentHistoryPanel(body, opts.preserve.payHistoryDriverId, opts.preserve.payFrom, opts.preserve.payTo);
        }
      }
      else if (this.tab === 'settings') this.renderSettings(body);
      else if (this.tab === 'reports') this.renderReports(body);
    };
    if (opts.silent && this._loadedTabs[this.tab]) {
      render();
      return;
    }
    this.ensureTabData(this.tab).then(render);
  },

  renderDashboard(body) {
    const s = this.dash?.stats || {};
    const online = this.onlineDrivers();
    const pool = this.poolOrders();
    body.innerHTML = `
    <div class="dd-kpi-grid">
      <div class="dd-kpi"><div class="dd-kpi-label">Waiting driver</div><div class="dd-kpi-value warn">${s.waiting || pool.length || 0}</div></div>
      <div class="dd-kpi"><div class="dd-kpi-label">Active deliveries</div><div class="dd-kpi-value accent">${s.active || 0}</div></div>
      <div class="dd-kpi"><div class="dd-kpi-label">Delivered today</div><div class="dd-kpi-value">${s.delivered_today || 0}</div></div>
      <div class="dd-kpi"><div class="dd-kpi-label">Fees today</div><div class="dd-kpi-value">${this.money(s.fees_today)}</div></div>
      <p class="muted" style="grid-column:1/-1;margin:0">Delivered today and fees today reset at midnight. Fees use branch settings and any per-order override.</p>
      <div class="dd-kpi"><div class="dd-kpi-label">Drivers online</div><div class="dd-kpi-value accent">${this.dash?.drivers_online || online.length} / ${this.dash?.drivers_total || (this.drivers || []).filter((d) => d.status === 'active').length}</div></div>
      <div class="dd-kpi"><div class="dd-kpi-label">Pending applications</div><div class="dd-kpi-value">${this.pendingDriverCount()}</div></div>
    </div>
    <div class="dd-section">
      <h3>Drivers online now</h3>
      <p class="muted">Same availability shown in the driver app — only online drivers receive pool alerts.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${online.length ? online.map((d) => `<span class="dd-driver-chip online"><span class="dot"></span><strong>${this.esc(d.full_name)}</strong> · ${this.esc(d.driver_code || d.phone || '')}</span>`).join('')
          : '<span class="muted">No drivers online — ask drivers to toggle Online in their app.</span>'}
      </div>
    </div>
    <div class="dd-section">
      <h3>Driver pool (${pool.length})</h3>
      <p class="muted">Orders released for drivers to accept — matches the driver app home screen.</p>
      ${pool.length ? this.ordersTable(pool, { showReceipt: true, poolView: true }) : '<div class="dd-empty"><div class="dd-empty-icon">📭</div><p>No deliveries in the pool right now.</p></div>'}
    </div>
    <div class="dd-section">
      <h3>Recent deliveries</h3>
      ${this.orders.slice(0, 12).length ? this.ordersTable(this.orders.slice(0, 12), { showReceipt: true }) : '<p class="muted">No recent deliveries.</p>'}
    </div>`;
    this.bindOrderActions(body);
  },

  renderPool(body) {
    const pool = this.poolOrders();
    const online = this.onlineDrivers();
    const mode = this.settings?.default_assignment_mode === 'auto' ? 'Automatic — first driver to accept wins' : 'Manual — assign or release from Orders tab';
    body.innerHTML = `
    <div class="dd-section">
      <h3>Live driver pool</h3>
      <p class="muted">These deliveries appear in the driver app for online drivers. Online orders only enter the pool after POS accepts them.</p>
      <p class="muted"><strong>Assignment mode:</strong> ${mode} · <strong>${online.length}</strong> driver(s) online</p>
      <div class="dd-toolbar">
        <button type="button" class="btn btn-primary" id="del-pool-refresh">Refresh pool</button>
        <button type="button" class="btn btn-ghost" id="del-go-orders">Manage all orders</button>
      </div>
      ${pool.length ? this.ordersTable(pool, { showReceipt: true, poolView: true }) : `<div class="dd-empty"><div class="dd-empty-icon">✓</div><p>Pool is empty — new deliveries will appear here when released.</p></div>`}
    </div>
    <div class="dd-section">
      <h3>Online drivers (${online.length})</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${online.length ? online.map((d) => `<div class="dd-driver-chip online">
          <span class="dot"></span>
          <div><strong>${this.esc(d.full_name)}</strong><br><small class="muted">${this.esc(d.phone || '')} · ${this.esc(d.vehicle_info || '—')}</small></div>
          ${d.phone ? `<a href="${this.whatsappLink(d.phone)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">WhatsApp</a>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-view-driver="${d.id}">Profile</button>
        </div>`).join('') : '<p class="muted">No drivers online.</p>'}
      </div>
    </div>`;
    body.querySelector('#del-pool-refresh')?.addEventListener('click', async () => {
      this._loadedTabs.pool = false;
      await this.load(true);
      this.renderTab();
    });
    body.querySelector('#del-go-orders')?.addEventListener('click', () => {
      this.tab = 'orders';
      try { sessionStorage.setItem(this._tabKey, 'orders'); } catch (_) { /* */ }
      this.el.querySelectorAll('.dd-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'orders'));
      this.renderTab();
    });
    body.querySelectorAll('[data-view-driver]').forEach((b) => {
      b.onclick = () => this.showDriverProfile(Number(b.dataset.viewDriver));
    });
    this.bindOrderActions(body);
  },

  renderOrders(body) {
    const statuses = ['', 'pending', 'awaiting_driver', 'assigned', 'driver_accepted', 'picked_up', 'on_way', 'delivered', 'failed', 'cancelled'];
    body.innerHTML = `<div class="dd-section">
    <div class="dd-toolbar">
      <select id="del-filter-status"><option value="">All statuses</option>${statuses.filter(Boolean).map((s) => `<option value="${s}">${s.replace(/_/g, ' ')}</option>`).join('')}</select>
      <button type="button" class="btn btn-primary" id="del-refresh">Refresh</button>
      <span class="muted">Bulk-assign or release to driver pool (same as driver app)</span>
    </div>
    <div id="del-orders-list">${this.ordersTable(this.orders, { selectable: true, showReceipt: true })}</div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <select id="del-bulk-driver"><option value="">Assign selected to driver…</option>
        ${(this.drivers || []).filter((d) => d.status === 'active').map((d) => `<option value="${d.id}">${this.esc(d.full_name)}</option>`).join('')}
      </select>
      <button class="btn btn-primary" id="del-bulk-assign">Assign selected</button>
    </div>
    <h3 style="margin-top:28px">Delivery history</h3>
    <p class="muted">Completed, failed, or cancelled deliveries — tap View for full details, edit, or delete.</p>
    <div id="del-history-list">${this.ordersTable(this.orderHistory || [], { history: true, showReceipt: true })}</div>
    </div>`;
    body.querySelector('#del-refresh').onclick = async () => {
      const st = body.querySelector('#del-filter-status').value;
      const filters = st ? { status: st } : { active: true, limit: 100 };
      this.orders = await API.listDeliveries(filters, this.actor);
      this.orders = this.orders?.data || this.orders || [];
      this.orderHistory = await API.listDeliveries({ history: true, limit: 100 }, this.actor);
      this.orderHistory = this.orderHistory?.data || this.orderHistory || [];
      body.querySelector('#del-orders-list').innerHTML = this.ordersTable(this.orders, { selectable: true, showReceipt: true });
      body.querySelector('#del-history-list').innerHTML = this.ordersTable(this.orderHistory, { history: true, showReceipt: true });
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
    const sourceLabel = (o) => {
      const s = String(o.source_label || o.source_type || '').toLowerCase();
      if (s.includes('online')) return 'Online';
      if (s.includes('pos') || s === 'sale') return 'POS';
      return o.source_label || o.source_type || '—';
    };
    return `<table class="data-table"><thead><tr>
      ${opts.selectable ? '<th></th>' : ''}
      <th>Order</th>${opts.showReceipt ? '<th>Receipt</th>' : ''}<th>Source</th><th>Delivery #</th><th>Customer</th><th>Address</th><th>Branch</th><th>Fee</th><th>Driver</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>${rows.map((o) => `<tr data-oid="${o.id}">
      ${opts.selectable ? `<td><input type="checkbox" class="del-pick" value="${o.id}"></td>` : ''}
      <td>${this.esc(o.order_number)}</td>
      ${opts.showReceipt ? `<td>${this.esc(o.receipt_number || '—')}</td>` : ''}
      <td><span class="badge">${this.esc(sourceLabel(o))}</span></td>
      <td><strong>${this.esc(o.confirmation_code || '—')}</strong></td>
      <td>${this.esc(o.customer_name)}<br><small>${this.esc(o.customer_phone)}</small></td>
      <td>${this.esc(o.delivery_address)}</td>
      <td>${this.esc(o.branch_name || o.branch_id || '')}</td>
      <td>${this.money(o.delivery_fee)}</td>
      <td>${this.esc(o.driver_name || '—')}</td>
      <td>${this.statusBadge(o.status)}</td>
      <td class="del-actions" data-oid="${o.id}">
        <button type="button" class="btn btn-ghost btn-sm" data-act="view" data-oid="${o.id}">View</button>
        ${opts.history ? `<button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-oid="${o.id}">Edit</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-oid="${o.id}">Delete</button>` : ''}
        ${o.tracking_token ? `<a href="${this.trackUrl(o.tracking_token)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Track ↗</a>` : ''}
        ${!opts.history ? `<select class="del-assign-driver" data-oid="${o.id}" data-fee="${o.delivery_fee || 0}"><option value="">Switch driver…</option>
          ${this.driversForOrder(o).map((d) => `<option value="${d.id}" ${o.driver_id == d.id ? 'selected' : ''}>${this.esc(d.full_name)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" data-act="auto-assign" data-oid="${o.id}">${o.driver_id ? 'Release to pool' : ((this.settings?.default_assignment_mode === 'auto') ? 'Release to pool' : 'Send to drivers')}</button>` : ''}
      </td>
    </tr>`).join('')}</tbody></table>`;
  },

  bindOrderActions(body) {
    body.querySelectorAll('[data-act="view"]').forEach((btn) => {
      btn.onclick = () => this.showOrder(Number(btn.dataset.oid));
    });
    body.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.onclick = () => this.showEditOrder(Number(btn.dataset.oid));
    });
    body.querySelectorAll('[data-act="delete"]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Cancel/delete this delivery? The driver will no longer see it.')) return;
        try {
          await API.cancelDelivery(Number(btn.dataset.oid), this.actor);
          Utils.toast('Delivery cancelled', 'info');
          this._loadedTabs.orders = false;
          await this.load(true);
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
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
          await API.releaseDeliveryToPool(btn.dataset.oid, this.actor);
          Utils.toast('Released to driver pool — any online driver can accept', 'success');
          this._loadedTabs.orders = false;
          this._loadedTabs.pool = false;
          await this.load(true);
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
    });
  },

  async showEditOrder(id) {
    try {
      const o = await API.getDelivery(id, this.actor);
      Utils.showModal(`Edit delivery ${this.esc(o.confirmation_code || o.order_number)}`, `
        <p class="muted">Changes sync to the driver app immediately (fee updates affect what they earn).</p>
        <label class="field full">Delivery fee (R)
          <input type="number" id="del-edit-fee" min="0" step="0.01" value="${Number(o.delivery_fee) || 0}"></label>
        <label class="field full">Customer name
          <input type="text" id="del-edit-name" value="${this.esc(o.customer_name || '')}"></label>
        <label class="field full">Customer phone
          <input type="text" id="del-edit-phone" value="${this.esc(o.customer_phone || '')}"></label>
        <label class="field full">Delivery address
          <input type="text" id="del-edit-addr" value="${this.esc(o.delivery_address || '')}"></label>
        <label class="field full">Notes
          <input type="text" id="del-edit-notes" value="${this.esc(o.special_instructions || '')}"></label>`,
        `<button class="btn btn-ghost" id="del-edit-cancel">Cancel</button>
         <button class="btn btn-primary" id="del-edit-save">Save changes</button>`);
      document.getElementById('del-edit-cancel').onclick = () => Utils.hideModal();
      document.getElementById('del-edit-save').onclick = async () => {
        try {
          await API.updateDelivery(id, {
            delivery_fee: Number(document.getElementById('del-edit-fee').value),
            customer_name: document.getElementById('del-edit-name').value.trim(),
            customer_phone: document.getElementById('del-edit-phone').value.trim(),
            delivery_address: document.getElementById('del-edit-addr').value.trim(),
            notes: document.getElementById('del-edit-notes').value.trim()
          }, this.actor);
          Utils.hideModal();
          Utils.toast('Delivery updated — synced to driver', 'success');
          this._loadedTabs.orders = false;
          await this.load(true);
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
    } catch (e) {
      Utils.toast(e.message || 'Could not load order', 'error');
    }
  },

  async showOrder(id) {
    try {
      const o = await API.getDelivery(id, this.actor);
      const items = (o.items || []).map((i) => `<li>${i.quantity || 1}× ${this.esc(i.name || i.product_name)}</li>`).join('') || '<li class="muted">No items</li>';
      Utils.showModal(`Delivery order ${this.esc(o.confirmation_code || o.order_number)}`, `
        <div style="display:grid;gap:8px;font-size:14px">
          <div><strong>Status:</strong> ${this.esc(o.status)}</div>
          <div><strong>Delivery number:</strong> ${this.esc(o.confirmation_code)}</div>
          ${o.receipt_number ? `<div><strong>Receipt:</strong> ${this.esc(o.receipt_number)}</div>` : ''}
          <div><strong>Customer:</strong> ${this.esc(o.customer_name)} · ${this.esc(o.customer_phone)}</div>
          <div><strong>Address:</strong> ${this.esc(o.delivery_address)}</div>
          <div><strong>Branch:</strong> ${this.esc(o.branch_name || o.branch_id)}</div>
          <div><strong>Delivery fee:</strong> ${this.money(o.delivery_fee)}</div>
          <div><strong>Order total:</strong> ${this.money(o.total)}</div>
          <div><strong>Driver:</strong> ${this.esc(o.driver_name || 'Not assigned')}</div>
          <div><strong>Source:</strong> ${this.esc(o.source_label || o.source_type)}</div>
          <div><strong>Items:</strong><ul style="margin:4px 0 0 16px">${items}</ul></div>
          ${o.special_instructions ? `<div><strong>Notes:</strong> ${this.esc(o.special_instructions)}</div>` : ''}
          ${o.tracking_token ? `<div><strong>Customer track:</strong> <a href="${this.trackUrl(o.tracking_token)}" target="_blank" rel="noopener">${this.trackUrl(o.tracking_token)}</a></div>` : ''}
        </div>`,
        `<button class="btn btn-ghost" id="del-view-edit">Edit</button>
         <button class="btn btn-primary" id="del-view-close">Close</button>`);
      document.getElementById('del-view-close').onclick = () => Utils.hideModal();
      document.getElementById('del-view-edit').onclick = () => { Utils.hideModal(); this.showEditOrder(id); };
    } catch (e) {
      Utils.toast(e.message || 'Could not load order', 'error');
    }
  },

  renderDrivers(body) {
    const all = this.drivers || [];
    body.innerHTML = `<div class="dd-section">
    <div class="dd-toolbar">
      <button type="button" class="btn btn-primary" id="del-add-driver">Register / add driver</button>
      <button type="button" class="btn btn-ghost" id="del-add-driver-quick">Quick add (no documents)</button>
    </div>
    <table class="data-table"><thead><tr><th></th><th>Name</th><th>Phone</th><th>Code</th><th>Status</th><th>App availability</th><th>Branches</th><th>Deliveries</th><th>Actions</th></tr></thead>
    <tbody>${all.length ? all.map((d) => `<tr>
      <td>${d.profile_photo_url ? `<img src="${this.esc(d.profile_photo_url)}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover">` : '<span style="display:inline-flex;width:44px;height:44px;border-radius:50%;background:var(--border);align-items:center;justify-content:center">👤</span>'}</td>
      <td><strong>${this.esc(d.full_name)}</strong>${d.vehicle_registration ? `<br><small class="muted">${this.esc(d.vehicle_registration)}</small>` : ''}</td>
      <td>${d.phone ? `<a href="tel:${this.esc(d.phone)}">${this.esc(d.phone)}</a>` : '—'}</td>
      <td><code>${this.esc(d.driver_code || '—')}</code></td>
      <td>${this.statusBadge(d.status)}</td>
      <td><span class="dd-driver-chip ${d.availability === 'online' ? 'online' : ''}" style="padding:4px 10px"><span class="dot"></span>${this.esc(d.availability || 'offline')}</span></td>
      <td>${d.all_branches ? 'All branches' : this.esc((d.branches || []).join(', ') || '—')}</td>
      <td>${d.total_deliveries || 0}</td>
      <td style="white-space:nowrap">
        <button type="button" class="btn btn-ghost btn-sm" data-view-driver="${d.id}">Profile</button>
        <button type="button" class="btn btn-ghost btn-sm" data-edit-driver="${d.id}">Edit</button>
        ${d.phone ? `<a href="${this.whatsappLink(d.phone)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">WhatsApp</a>` : ''}
        ${d.status === 'active' ? `<button type="button" class="btn btn-ghost btn-sm" data-suspend-driver="${d.id}">Suspend</button>` : ''}
        ${d.status === 'suspended' ? `<button type="button" class="btn btn-ghost btn-sm" data-activate-driver="${d.id}">Reactivate</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-delete-driver="${d.id}">Delete</button>
      </td></tr>`).join('') : '<tr><td colspan="9" class="muted">No drivers yet — share the registration link or add manually.</td></tr>'}
    </tbody></table></div>`;
    body.querySelector('#del-add-driver').onclick = () => this.showDriverRegistrationModal();
    body.querySelector('#del-add-driver-quick')?.addEventListener('click', () => this.showDriverRegistrationModal({ quick: true }));
    body.querySelectorAll('[data-view-driver]').forEach((b) => b.onclick = () => this.showDriverProfile(Number(b.dataset.viewDriver)));
    body.querySelectorAll('[data-edit-driver]').forEach((b) => b.onclick = () => this.showDriverRegistrationModal({ id: Number(b.dataset.editDriver) }));
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
    const rejected = this.drivers.filter((d) => d.status === 'rejected');
    body.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-body">
      <h4 style="margin-top:0">Driver registration</h4>
      <p class="muted">Register drivers here with the same form they use on their phone — ID, selfie, vehicle photos, and bank details. You can also share the public link.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <button type="button" class="btn btn-primary btn-sm" id="del-register-here">Register driver here</button>
        <button type="button" class="btn btn-ghost btn-sm" id="del-copy-reg">Copy public link</button>
        <code style="flex:1;min-width:200px;padding:8px;background:var(--bg);border-radius:6px;word-break:break-all;font-size:12px">${this.esc(this.registrationUrl())}</code>
      </div>
    </div></div>
    ${pending.length ? `<h3>Pending applications (${pending.length})</h3>
      <p class="muted">Review each application — check ID, selfie, vehicle photos, and bank details before approving.</p>
      <table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>ID</th><th>Vehicle</th><th>Reg</th><th>Actions</th></tr></thead>
      <tbody>${pending.map((d) => `<tr><td>${this.esc(d.full_name)}</td><td>${this.esc(d.phone)}</td><td>${this.esc(d.id_number || '—')}</td>
        <td>${this.esc(d.vehicle_info)}</td><td>${this.esc(d.vehicle_registration || '—')}</td>
        <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-view-pending="${d.id}">View all details</button>
        <button class="btn btn-primary btn-sm" data-approve="${d.id}">Approve</button>
        <button class="btn btn-ghost btn-sm" data-reject="${d.id}">Reject</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No pending applications.</p>'}
    ${rejected.length ? `<h3 style="margin-top:24px">Rejected / re-registration (${rejected.length})</h3>
      <table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Notes</th><th>Actions</th></tr></thead>
      <tbody>${rejected.map((d) => `<tr><td>${this.esc(d.full_name)}</td><td>${this.esc(d.phone)}</td>
        <td>${this.esc(d.notes || '—')}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-view-pending="${d.id}">View</button>
          <button class="btn btn-primary btn-sm" data-reregister="${d.id}">Re-register here</button>
        </td></tr>`).join('')}</tbody></table>` : ''}`;
    body.querySelector('#del-register-here')?.addEventListener('click', () => this.showDriverRegistrationModal());
    body.querySelector('#del-copy-reg')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.registrationUrl());
        Utils.toast('Registration link copied', 'success');
      } catch (_) {
        Utils.toast(this.registrationUrl(), 'info');
      }
    });
    body.querySelectorAll('[data-view-pending]').forEach((b) => {
      b.onclick = () => this.showDriverProfile(Number(b.dataset.viewPending));
    });
    body.querySelectorAll('[data-approve]').forEach((b) => b.onclick = async () => {
      await API.approveDeliveryDriver(b.dataset.approve, this.actor);
      window.PanelNotifyHub?.ackDeliveryDriver(b.dataset.approve);
      Utils.toast('Driver approved', 'success');
      this._loadedTabs.pending = false;
      this._loadedTabs.drivers = false;
      await this.load(true);
      this.renderTab();
    });
    body.querySelectorAll('[data-reregister]').forEach((b) => {
      b.onclick = () => this.showDriverRegistrationModal({ reapplyId: Number(b.dataset.reregister) });
    });
    body.querySelectorAll('[data-reject]').forEach((b) => b.onclick = async () => {
      const reason = prompt('Rejection reason?') || 'Rejected';
      await API.rejectDeliveryDriver(b.dataset.reject, reason, this.actor);
      this._loadedTabs.pending = false;
      this._loadedTabs.drivers = false;
      await this.load(true);
      this.renderTab();
    });
  },

  showDriverProfile(driverId) {
    const d = this.drivers.find((x) => x.id === driverId) || null;
    if (!d) return API.getDeliveryDriver(driverId, this.actor).then((drv) => this.showDriverProfileModal(drv?.data || drv)).catch((e) => Utils.toast(e.message, 'error'));
    return this.showDriverProfileModal(d);
  },

  showDriverProfileModal(d) {
    if (!d) return;
    const urls = d.document_urls || {};
    const photos = [
      urls.selfie ? `<div><small>Selfie</small><br><img src="${urls.selfie}" style="max-width:140px;border-radius:8px;margin:4px"></div>` : '',
      urls.id_photo ? `<div><small>ID document</small><br><img src="${urls.id_photo}" style="max-width:140px;border-radius:8px;margin:4px"></div>` : '',
      ...(urls.vehicle_photos || []).map((u, i) => `<div><small>Vehicle ${i + 1}</small><br><img src="${u}" style="max-width:140px;border-radius:8px;margin:4px"></div>`)
    ].filter(Boolean).join('');
    const branchLabel = d.all_branches ? 'All branches' : (d.branches || []).map((b) => this.esc(String(b))).join(', ') || '—';
    Utils.showModal(`Driver — ${this.esc(d.full_name)}`, `
      <div style="display:grid;gap:8px;font-size:14px;max-height:70vh;overflow:auto">
        ${d.profile_photo_url ? `<img src="${d.profile_photo_url}" style="width:88px;height:88px;border-radius:50%;object-fit:cover">` : ''}
        <div><strong>Status:</strong> ${this.statusBadge(d.status)} · <strong>Availability:</strong> ${this.esc(d.availability || 'offline')}</div>
        <div><strong>Driver code:</strong> <code>${this.esc(d.driver_code || '—')}</code></div>
        <div><strong>Phone:</strong> ${this.esc(d.phone)}${d.phone ? ` · <a href="${this.whatsappLink(d.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
        <div><strong>Email:</strong> ${this.esc(d.email || '—')}</div>
        <div><strong>ID number:</strong> ${this.esc(d.id_number || '—')}</div>
        <div><strong>Home address:</strong> ${this.esc(d.address || '—')}</div>
        <div><strong>Vehicle:</strong> ${this.esc(d.vehicle_info || '—')}</div>
        <div><strong>Registration plate:</strong> ${this.esc(d.vehicle_registration || '—')}</div>
        <div><strong>Bank:</strong> ${this.esc(d.bank_name || '—')}</div>
        <div><strong>Account:</strong> ${this.esc(d.bank_account || '—')}${d.bank_branch_code ? ` · Branch ${this.esc(d.bank_branch_code)}` : ''}</div>
        <div><strong>Branches:</strong> ${branchLabel}</div>
        <div><strong>Payout day:</strong> ${this.esc(this.payoutDayLabel(d.payout_day_of_week))}</div>
        <div><strong>Total deliveries:</strong> ${d.total_deliveries || 0}</div>
        ${d.notes ? `<div><strong>Notes:</strong> ${this.esc(d.notes)}</div>` : ''}
        ${photos ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${photos}</div>` : '<p class="muted">No documents uploaded</p>'}
      </div>`,
      d.status === 'pending'
        ? `<button class="btn btn-ghost" id="del-prof-close">Close</button>
           <button class="btn btn-ghost" id="del-prof-edit">Edit</button>
           <button class="btn btn-primary" id="del-prof-approve">Approve</button>`
        : `<button class="btn btn-ghost" id="del-prof-close">Close</button>
           <button class="btn btn-primary" id="del-prof-edit">Edit driver</button>`);
    document.getElementById('del-prof-close').onclick = () => Utils.hideModal();
    document.getElementById('del-prof-edit')?.addEventListener('click', () => {
      Utils.hideModal();
      this.showDriverRegistrationModal({ id: d.id });
    });
    document.getElementById('del-prof-approve')?.addEventListener('click', async () => {
      await API.approveDeliveryDriver(d.id, this.actor);
      Utils.hideModal();
      Utils.toast('Driver approved', 'success');
      this._loadedTabs.pending = false;
      this._loadedTabs.drivers = false;
      await this.load(true);
      this.renderTab();
    });
  },

  renderSettings(body) {
    const s = this.settings || {};
    const branchOpts = (this.branches || []).map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('');
    body.innerHTML = `
    <div class="dd-settings-card">
      <h4>Notifications on this device</h4>
      <p class="muted" style="margin:0 0 10px">Play alert sounds for pending applications and pool deliveries (uses Admin → Security custom sound or demo tone).</p>
      ${window.PanelNotify ? PanelNotify.soundToggleHtml('delivery', { id: 'dd-settings-notify', label: 'Enable delivery department alerts' }) : ''}
    </div>
    <div class="dd-settings-card">
      <h4>Payout claim window</h4>
      <p class="muted" style="margin:0">${this.claimWindowText()}. Drivers submit claims from the Payments tab in their app.</p>
    </div>
    <div class="dd-settings-card">
      <h4>Current settings (live)</h4>
      <p class="muted" style="margin:0;font-size:13px">
        Department: <strong>${s.department_mode === 'central' ? 'Central' : 'Per branch'}</strong> ·
        Assignment: <strong>${s.default_assignment_mode === 'auto' ? 'Automatic' : 'Manual'}</strong> ·
        Payout cycle: <strong>${s.payout_cycle_days ?? 7} days</strong> ·
        Payout day: <strong>${s.payout_day_of_week == null || s.payout_day_of_week === '' ? 'Any day' : this.payoutDayLabel(s.payout_day_of_week)}</strong>
      </p>
    </div>
    <form id="del-settings-form" class="form-grid" style="max-width:520px">
      <label class="field full">Department mode
        <select name="department_mode"><option value="per_branch" ${s.department_mode === 'per_branch' ? 'selected' : ''}>Per branch</option>
        <option value="central" ${s.department_mode === 'central' ? 'selected' : ''}>Central delivery department</option></select>
      </label>
      <label class="field full">Default assignment
        <select name="default_assignment_mode"><option value="manual" ${s.default_assignment_mode === 'manual' ? 'selected' : ''}>Manual — admin assigns driver</option>
        <option value="auto" ${s.default_assignment_mode === 'auto' ? 'selected' : ''}>Automatic — drivers accept (first accept wins)</option></select>
      </label>
      <label class="field full">Driver payout cycle (days)
        <input name="payout_cycle_days" type="number" min="1" max="90" value="${s.payout_cycle_days ?? 7}" placeholder="7">
        <span class="muted" style="font-size:12px">How often drivers are typically paid (e.g. 7 = weekly)</span></label>
      <label class="field full">Payout day of week (optional)
        <select name="payout_day_of_week">
          <option value="">Any day</option>
          ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) =>
            `<option value="${i}" ${Number(s.payout_day_of_week) === i ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
        <span class="muted" style="font-size:12px">Default for all drivers. Override per driver in Edit driver.</span></label>
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
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center">
      <select id="del-branch-pick"><option value="">— Select branch —</option>${branchOpts}</select>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="del-all-branches"> Apply to all branches</label>
      <button class="btn btn-ghost" id="del-branch-load">Load branch</button>
    </div>
    <form id="del-branch-fee-form" class="form-grid" style="max-width:420px;display:none">
      <label class="field full">Delivery fee (R)<input name="delivery_fee" type="number" min="0" step="0.01"></label>
      <label class="field full">Free delivery above (R)<input name="free_delivery_above" type="number" min="0" step="0.01" placeholder="0 = always charge fee"></label>
      <label class="field full">Minimum order (R)<input name="min_order" type="number" min="0" step="0.01"></label>
      <button type="submit" class="btn btn-primary">Save branch fee</button>
    </form>`;
    const settingsNotify = body.querySelector('#dd-settings-notify');
    if (settingsNotify && window.PanelNotify) PanelNotify.bindSoundToggle(settingsNotify, 'delivery');
    body.querySelector('#del-settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      if (payload.payout_day_of_week === '') payload.payout_day_of_week = null;
      try {
        const saved = await API.saveDeliverySettings(payload, this.actor);
        this.settings = saved?.data || saved || await API.getDeliverySettings(this.actor);
        this._loadedTabs.settings = false;
        this._loadedTabs.dashboard = false;
        this._loadedTabs.pool = false;
        Utils.toast('Settings saved — driver app will use these on next refresh', 'success');
        this.renderTab();
      } catch (err) {
        Utils.toast(err.message || 'Could not save settings', 'error');
      }
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
      const fd = new FormData(branchForm);
      const payload = Object.fromEntries(fd.entries());
      const allBranches = body.querySelector('#del-all-branches')?.checked;
      if (allBranches) {
        const branches = this.branches?.length ? this.branches : (await API.getBranches?.().catch(() => ({ data: [] })))?.data || [];
        for (const b of branches) {
          await API.saveDeliveryBranchSettings(b.id, payload, this.actor);
        }
        Utils.toast(`Delivery fees saved for ${branches.length} branch(es) — synced to POS & online`, 'success');
      } else {
        const bid = branchForm.dataset.branchId || body.querySelector('#del-branch-pick')?.value;
        if (!bid) return Utils.toast('Select a branch first', 'error');
        await API.saveDeliveryBranchSettings(bid, payload, this.actor);
        Utils.toast('Branch delivery fee saved — synced to POS & online', 'success');
      }
      this._loadedTabs.settings = false;
      await this.load(true);
      this.renderTab();
    };
  },

  renderPayments(body) {
    const rows = this._paymentRows();
    const claims = this.payoutClaims || [];
    const today = this.localTodayStr();
    const weekAgo = this.localWeekAgoStr();
    const totalOwed = rows.reduce((s, d) => s + (Number(d.owed_amount) || 0), 0);
    const totalDeliveries = rows.reduce((s, d) => s + (Number(d.delivered_count) || 0), 0);
    body.innerHTML = `
    <div class="dd-kpi-grid" style="margin-bottom:16px">
      <div class="dd-kpi"><div class="dd-kpi-label">Active drivers</div><div class="dd-kpi-value">${rows.length}</div></div>
      <div class="dd-kpi"><div class="dd-kpi-label">Pending claims</div><div class="dd-kpi-value warn">${claims.length}</div></div>
      <div class="dd-kpi"><div class="dd-kpi-label">Deliveries (period)</div><div class="dd-kpi-value">${totalDeliveries}</div></div>
      <div class="dd-kpi"><div class="dd-kpi-label">Total owed</div><div class="dd-kpi-value accent">${this.money(totalOwed)}</div></div>
    </div>
    ${claims.length ? `<h3>Driver payment claims — awaiting approval</h3>
    <table class="data-table" style="margin-bottom:24px"><thead><tr>
      <th>Driver</th><th>Amount</th><th>Deliveries</th><th>Period</th><th>Claimed</th><th></th>
    </tr></thead><tbody>${claims.map((c) => `<tr>
      <td>${this.esc(c.driver?.full_name || c.driver_name)}</td>
      <td><strong>${this.money(c.amount)}</strong></td>
      <td>${c.delivery_count || 0}</td>
      <td><small>${this.esc(c.period_from)} → ${this.esc(c.period_to)}</small></td>
      <td>${this.esc(String(c.claimed_at || '').slice(0, 16))}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-review-claim="${c.id}">Review</button>
        <button class="btn btn-primary btn-sm" data-approve-claim="${c.id}">Approve & pay</button>
        <button class="btn btn-ghost btn-sm" data-reject-claim="${c.id}">Reject</button>
      </td></tr>`).join('')}</tbody></table>` : ''}
    <h3>Driver balances</h3>
    <p class="muted">Choose a date range to calculate what you owe each driver. Payment history appears below.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center">
      <label>From <input type="date" id="del-pay-from" value="${weekAgo}"></label>
      <label>To <input type="date" id="del-pay-to" value="${today}"></label>
      <button class="btn btn-primary" id="del-pay-recalc">Recalculate</button>
    </div>
    <table class="data-table"><thead><tr>
      <th>Driver</th><th>Phone</th><th>Bank</th><th>Account</th><th>Deliveries</th><th>Owed</th><th>Period</th><th></th>
    </tr></thead><tbody id="del-pay-rows">
      ${rows.length ? rows.map((d) => `<tr>
        <td>${this.esc(d.full_name)}</td>
        <td>${this.esc(d.phone)}</td>
        <td>${this.esc(d.bank_name || '—')}</td>
        <td>${this.esc(d.bank_account || '—')}${d.bank_branch_code ? `<br><small>${this.esc(d.bank_branch_code)}</small>` : ''}</td>
        <td>${d.delivered_count || 0}</td>
        <td><strong>${this.money(d.owed_amount)}</strong></td>
        <td><small>${this.esc(d.owed_from || '—')} → ${this.esc(d.owed_to || '—')}</small></td>
        <td style="white-space:nowrap">
          ${Number(d.owed_amount) > 0
            ? `<button class="btn btn-primary btn-sm" data-pay-driver="${d.id}" data-amount="${d.owed_amount || 0}"
            data-from="${this.esc(d.owed_from || '')}" data-to="${this.esc(d.owed_to || '')}">Mark paid</button>`
            : `<span class="muted" style="font-size:12px">Paid up</span>`}
          <button class="btn btn-ghost btn-sm" data-pay-history="${d.id}">History</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="8" class="muted">No active drivers or nothing owed.</td></tr>'}
    </tbody></table>
    <div id="del-pay-history-out"></div>`;
    body.querySelector('#del-pay-recalc').onclick = () => this.recalcPayments(body);
    body.querySelectorAll('[data-review-claim]').forEach((b) => {
      b.onclick = () => {
        const c = claims.find((x) => x.id === Number(b.dataset.reviewClaim));
        if (c?.driver) this.showDriverProfileModal(c.driver);
      };
    });
    body.querySelectorAll('[data-approve-claim]').forEach((b) => {
      b.onclick = async () => {
        const c = claims.find((x) => x.id === Number(b.dataset.approveClaim));
        if (!c) return;
        const notes = prompt(`Approve claim of ${this.money(c.amount)}?\nOptional note:`) ?? '';
        if (notes === null) return;
        try {
          await API.approvePayoutClaim(c.id, notes, this.actor);
          Utils.toast('Claim approved and payment recorded', 'success');
          this._loadedTabs.payments = false;
          await this.load(true);
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
    });
    body.querySelectorAll('[data-reject-claim]').forEach((b) => {
      b.onclick = async () => {
        const reason = prompt('Rejection reason?') || 'Rejected';
        try {
          await API.rejectPayoutClaim(Number(b.dataset.rejectClaim), reason, this.actor);
          Utils.toast('Claim rejected', 'info');
          this._loadedTabs.payments = false;
          await this.load(true);
          this.renderTab();
        } catch (e) { Utils.toast(e.message, 'error'); }
      };
    });
    this.bindPaymentActions(body);
  },

  async recalcPayments(body) {
    const from = body.querySelector('#del-pay-from').value;
    const to = body.querySelector('#del-pay-to').value;
    if (!from || !to) return Utils.toast('Select from and to dates', 'error');
    const rows = this._paymentRows();
    const tbody = body.querySelector('#del-pay-rows');
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Calculating…</td></tr>';
    const updated = await Promise.all(rows.map(async (d) => {
      try {
        const owed = await API.deliveryDriverOwed(d.id, { from, to }, this.actor);
        return { ...d, owed_amount: owed.amount, owed_from: from, owed_to: to, delivered_count: owed.count };
      } catch (_) { return { ...d, owed_from: from, owed_to: to }; }
    }));
    tbody.innerHTML = updated.map((d) => `<tr>
      <td>${this.esc(d.full_name)}</td>
      <td>${this.esc(d.phone)}</td>
      <td>${this.esc(d.bank_name || '—')}</td>
      <td>${this.esc(d.bank_account || '—')}</td>
      <td>${d.delivered_count || 0}</td>
      <td><strong>${this.money(d.owed_amount)}</strong></td>
      <td><small>${this.esc(d.owed_from)} → ${this.esc(d.owed_to)}</small></td>
      <td style="white-space:nowrap">
        ${Number(d.owed_amount) > 0
          ? `<button class="btn btn-primary btn-sm" data-pay-driver="${d.id}" data-amount="${d.owed_amount || 0}"
          data-from="${this.esc(d.owed_from)}" data-to="${this.esc(d.owed_to)}">Mark paid</button>`
          : `<span class="muted" style="font-size:12px">Paid up</span>`}
        <button class="btn btn-ghost btn-sm" data-pay-history="${d.id}">History</button>
      </td>
    </tr>`).join('');
    this.bindPaymentActions(body);
  },

  bindPaymentActions(body) {
    body.querySelectorAll('[data-pay-driver]').forEach((btn) => {
      btn.onclick = async () => {
        const driverId = Number(btn.dataset.payDriver);
        const amount = Number(btn.dataset.amount);
        const from = btn.dataset.from;
        const to = btn.dataset.to;
        if (!amount || amount <= 0) return Utils.toast('This driver has nothing owed for the selected period — view History for past payments.', 'info');
        try {
          const preview = await API.previewDriverPayout(driverId, { period_from: from, period_to: to }, this.actor);
          const data = preview?.data || preview;
          const driver = data.driver || this._paymentRows().find((d) => d.id === driverId);
          Utils.showModal(
            `Confirm payment — ${this.esc(driver?.full_name || 'Driver')}`,
            `<p>Pay <strong>${this.money(data.total ?? amount)}</strong> for ${data.count || 0} completed deliveries<br>
            <span class="muted">${this.esc(from)} → ${this.esc(to)}</span></p>
            <label class="field full">Note (optional)<input id="payout-note-input" placeholder="e.g. Weekly payout"></label>
            ${this.payoutDeliveriesTableHtml(data.deliveries)}`,
            `<button class="btn btn-ghost" id="payout-preview-cancel">Cancel</button>
             <button class="btn btn-primary" id="payout-preview-save">Save payment</button>`
          );
          document.getElementById('payout-preview-cancel').onclick = () => Utils.hideModal();
          document.getElementById('payout-preview-save').onclick = async () => {
            const notes = document.getElementById('payout-note-input')?.value?.trim() || null;
            try {
              const payout = await API.recordDriverPayout(driverId, {
                amount: data.total ?? amount, period_from: from, period_to: to, notes
              }, this.actor);
              Utils.hideModal();
              Utils.toast('Payment saved with full delivery details', 'success');
              await this.showSavedPayoutModal(payout?.data || payout, driver);
              this._loadedTabs.payments = false;
              await this.load(true);
              this.renderTab({ preserve: { payHistoryDriverId: this._payHistoryDriverId, payFrom: from, payTo: to } });
            } catch (e) { Utils.toast(e.message || 'Payment failed', 'error'); }
          };
        } catch (e) { Utils.toast(e.message || 'Could not load payment preview', 'error'); }
      };
    });
    body.querySelectorAll('[data-pay-history]').forEach((btn) => {
      btn.onclick = async () => {
        const driverId = Number(btn.dataset.payHistory);
        const from = body.querySelector('#del-pay-from')?.value;
        const to = body.querySelector('#del-pay-to')?.value;
        this._payHistoryDriverId = driverId;
        this._payFrom = from;
        this._payTo = to;
        await this.loadPaymentHistoryPanel(body, driverId, from, to);
      };
    });
  },

  async loadPaymentHistoryPanel(body, driverId, from, to) {
    const out = body.querySelector('#del-pay-history-out');
    if (!out) return;
    out.innerHTML = '<p class="muted">Loading payment history…</p>';
    try {
      const rows = await API.deliveryDriverPayoutHistory(driverId, { from, to }, this.actor);
      const histRows = Array.isArray(rows?.data) ? rows.data : (Array.isArray(rows) ? rows : []);
      const driver = this._paymentRows().find((d) => d.id === driverId)
        || (await API.getDeliveryDriver(driverId, this.actor).catch(() => null))?.data
        || (await API.getDeliveryDriver(driverId, this.actor).catch(() => null));
      const totalPaid = histRows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      out.innerHTML = `<div class="dd-section" style="margin-top:20px;border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">Payment history — ${this.esc(driver?.full_name || 'Driver')}</h3>
          <button type="button" class="btn btn-ghost btn-sm" id="del-pay-hist-close">Close</button>
        </div>
        <p class="muted">${this.esc(from || '')} → ${this.esc(to || '')} · ${histRows.length} payment(s) · Total ${this.money(totalPaid)}</p>
        <table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Period</th><th>Paid by</th><th>Note</th><th></th></tr></thead>
        <tbody>${histRows.length ? histRows.map((p) => `<tr>
          <td>${this.esc(String(p.paid_at || '').slice(0, 16))}</td>
          <td><strong>${this.money(p.amount)}</strong><br><small class="muted">${p.delivery_count || (p.deliveries || []).length || 0} deliveries</small></td>
          <td>${this.esc(String(p.period_from || '').slice(0, 10))} → ${this.esc(String(p.period_to || '').slice(0, 10))}</td>
          <td>${this.esc(p.paid_by_name || '—')}</td>
          <td>${this.esc(p.notes || '—')}</td>
          <td style="white-space:nowrap">
            <button type="button" class="btn btn-ghost btn-sm" data-view-payout="${p.id}">Details</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pdf-payout="${p.id}">PDF</button>
            ${driver?.phone ? `<button type="button" class="btn btn-ghost btn-sm" data-wa-payout="${p.id}">WhatsApp</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="6" class="muted">No payments in this period</td></tr>'}
        </tbody></table></div>`;
      out.querySelector('#del-pay-hist-close')?.addEventListener('click', () => {
        this._payHistoryDriverId = null;
        out.innerHTML = '';
      });
      out.querySelectorAll('[data-view-payout]').forEach((b) => {
        b.onclick = async () => {
          const payout = histRows.find((x) => x.id === Number(b.dataset.viewPayout));
          if (payout) await this.showSavedPayoutModal(payout, driver);
        };
      });
      out.querySelectorAll('[data-pdf-payout]').forEach((b) => {
        b.onclick = async () => {
          try {
            const r = await API.deliveryDriverPayoutPdf(Number(b.dataset.pdfPayout), this.actor);
            const data = r?.data || r;
            this.downloadPdfBase64(data.pdf, data.filename || 'payment.pdf');
          } catch (e) { Utils.toast(e.message || 'PDF failed', 'error'); }
        };
      });
      out.querySelectorAll('[data-wa-payout]').forEach((b) => {
        b.onclick = async () => {
          const payout = histRows.find((x) => x.id === Number(b.dataset.waPayout));
          if (payout) await this.sendPayoutWhatsApp(payout, driver);
        };
      });
    } catch (e) { out.innerHTML = `<p class="muted">${this.esc(e.message)}</p>`; }
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
      const colCount = driver ? 6 : 7;
      out.innerHTML = `<h3>${this.esc(title)}</h3>
        ${shop.shop_name ? `<p class="muted">${this.esc(shop.shop_name)}${shop.phone ? ` · ${this.esc(shop.phone)}` : ''}${shop.address ? ` · ${this.esc(shop.address)}` : ''}</p>` : ''}
        <div class="dd-kpi-grid" style="margin:12px 0">
          ${driver ? `<div class="dd-kpi"><div class="dd-kpi-label">Total earned</div><div class="dd-kpi-value accent">${this.money(r.total)}</div></div>
          <div class="dd-kpi"><div class="dd-kpi-label">Deliveries</div><div class="dd-kpi-value">${rows.length}</div></div>` :
          `<div class="dd-kpi"><div class="dd-kpi-label">Total orders</div><div class="dd-kpi-value">${r.summary?.total || 0}</div></div>
          <div class="dd-kpi"><div class="dd-kpi-label">Delivered</div><div class="dd-kpi-value accent">${r.summary?.delivered || 0}</div></div>
          <div class="dd-kpi"><div class="dd-kpi-label">Driver fees</div><div class="dd-kpi-value">${this.money(r.summary?.fees)}</div></div>`}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          ${driver?.phone ? `<button class="btn btn-primary" id="del-rep-wa">Send via WhatsApp</button>` : ''}
          <button class="btn btn-ghost" id="del-rep-print">Print / Save PDF</button>
          <button class="btn btn-ghost" id="del-rep-download">Download HTML report</button>
        </div>
        <table class="data-table" id="del-rep-table"><thead><tr>
          <th>Date</th><th>Delivery #</th><th>Customer</th>${driver ? '<th>Address</th>' : '<th>Branch</th><th>Driver</th>'}<th>Fee</th><th>Status</th>
        </tr></thead><tbody>
          ${rows.length ? rows.map((row) => `<tr>
            <td>${this.esc((row.delivered_at || row.created_at || '').slice(0, 10) || '—')}</td>
            <td>${this.esc(row.confirmation_code || row.order_number)}</td>
            <td>${this.esc(row.customer_name)}</td>
            ${driver
              ? `<td>${this.esc(row.delivery_address || '—')}</td>`
              : `<td>${this.esc(row.branch_name || '—')}</td><td>${this.esc(row.driver_name || '—')}</td>`}
            <td>${this.money(row.delivery_fee)}</td>
            <td>${this.esc(row.status)}</td>
          </tr>`).join('') : `<tr><td colspan="${colCount}" class="muted">No deliveries in this period</td></tr>`}
        </tbody></table>`;
      body.querySelector('#del-rep-print')?.addEventListener('click', () => {
        const w = window.open('', '_blank');
        const stats = driver
          ? `<p><strong>Total earned:</strong> ${this.money(r.total)} · <strong>Deliveries:</strong> ${rows.length}</p>`
          : `<p><strong>Total orders:</strong> ${r.summary?.total || 0} · <strong>Delivered:</strong> ${r.summary?.delivered || 0} · <strong>Driver fees:</strong> ${this.money(r.summary?.fees)}</p>`;
        w.document.write(`<html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f5}</style></head><body>
          <h1>${shop.shop_name || 'Delivery Report'}</h1>
          <p>${shop.address || ''} ${shop.phone || ''}</p>
          <h2>${title}</h2>
          <p>${from} → ${to}</p>
          ${stats}
          ${out.querySelector('#del-rep-table').outerHTML}
          <script>window.onload=function(){window.print();}</script></body></html>`);
        w.document.close();
      });
      body.querySelector('#del-rep-download')?.addEventListener('click', () => {
        const html = out.querySelector('#del-rep-table')?.outerHTML || '';
        const blob = new Blob([`<html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${html}</body></html>`], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `delivery-report-${from}-${to}.html`;
        a.click();
        URL.revokeObjectURL(a.href);
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

  async fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  },

  async showDriverRegistrationModal(opts = {}) {
    const id = opts.id || null;
    const reapplyId = opts.reapplyId || null;
    const quick = !!opts.quick;
    let d = {};
    if (id) {
      d = this.drivers.find((x) => x.id === id) || {};
      if (!d.id) {
        try {
          const drv = await API.getDeliveryDriver(id, this.actor);
          d = drv?.data || drv || {};
        } catch (_) { /* ignore */ }
      }
    } else if (reapplyId) {
      d = this.drivers.find((x) => x.id === reapplyId) || {};
      if (!d.id) {
        try {
          const drv = await API.getDeliveryDriver(reapplyId, this.actor);
          d = drv?.data || drv || {};
        } catch (_) { /* ignore */ }
      }
    }
    const isEdit = !!id;
    const branchChecks = (this.branches || []).map((b) => {
      const checked = d.all_branches || (d.branches || []).includes(Number(b.id));
      return `<label style="display:block;margin:4px 0"><input type="checkbox" class="drv-branch" value="${b.id}" ${checked ? 'checked' : ''}> ${this.esc(b.name)}</label>`;
    }).join('');
    const docSection = quick ? '<p class="muted">Quick add — no documents. Use full registration to upload ID and vehicle photos.</p>' : `
      <label class="field full">Selfie (profile photo)<input type="file" id="drv-selfie" accept="image/*"${isEdit ? '' : ' required'}></label>
      <label class="field full">Photo of ID document<input type="file" id="drv-id-photo" accept="image/*"${isEdit ? '' : ' required'}></label>
      <label class="field full">Vehicle photos (5 required for new drivers)<input type="file" id="drv-vehicle-photos" accept="image/*" multiple${isEdit ? '' : ' required'}></label>
      <p class="muted" id="drv-vehicle-count">Front, back, sides, and registration plate.</p>`;
    Utils.showModal(
      isEdit ? `Edit driver — ${this.esc(d.full_name || '')}` : (reapplyId ? 'Re-register driver' : 'Register driver'),
      `<div class="form-grid" style="max-height:62vh;overflow:auto;padding-right:6px">
        <p class="muted" style="margin:0">Same fields as driver self-registration on their phone.</p>
        <label class="field full">Full name<input id="drv-name" value="${this.esc(d.full_name || '')}" required></label>
        <label class="field full">Phone<input id="drv-phone" value="${this.esc(d.phone || '')}" required></label>
        <label class="field full">Email<input id="drv-email" type="email" value="${this.esc(d.email || '')}"></label>
        <label class="field full">ID number<input id="drv-id-number" value="${this.esc(d.id_number || '')}" ${quick ? '' : 'required'}></label>
        <label class="field full">Home address<textarea id="drv-address" rows="2" ${quick ? '' : 'required'}>${this.esc(d.address || '')}</textarea></label>
        <label class="field full">Vehicle type & colour<input id="drv-vehicle" value="${this.esc(d.vehicle_info || '')}" placeholder="e.g. White Honda bike" ${quick ? '' : 'required'}></label>
        <label class="field full">Vehicle registration<input id="drv-vehicle-reg" value="${this.esc(d.vehicle_registration || '')}" placeholder="ABC123GP" ${quick ? '' : 'required'}></label>
        <label class="field full">Bank name<input id="drv-bank" value="${this.esc(d.bank_name || '')}"></label>
        <label class="field full">Account number<input id="drv-account" value="${this.esc(d.bank_account || '')}"></label>
        <label class="field full">Branch code<input id="drv-branch-code" value="${this.esc(d.bank_branch_code || '')}"></label>
        ${isEdit ? `<label class="field full">Scheduled payout day
          <select id="drv-payout-day">
            <option value="">Use department default (${this.esc(this.payoutDayLabel(this.settings?.payout_day_of_week))})</option>
            ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) =>
              `<option value="${i}" ${Number(d.payout_day_of_week) === i ? 'selected' : ''}>${day}</option>`).join('')}
          </select>
          <span class="muted" style="font-size:12px">Claim window opens the day before this day in the driver app.</span>
        </label>` : ''}
        ${docSection}
        <label class="field full">Password ${isEdit ? '(leave blank to keep)' : '(min 6 characters)'}<input id="drv-pass" type="password" ${isEdit || quick ? '' : 'required minlength="6"'}></label>
        <label class="field full"><input type="checkbox" id="drv-all-branches" ${d.all_branches ? 'checked' : ''}> All branches</label>
        <div class="field full"><span class="muted">Branches</span>${branchChecks || '<p class="muted">No branches</p>'}</div>
        ${!isEdit ? `<label class="field full"><input type="checkbox" id="drv-auto-approve" ${quick ? 'checked' : ''}> Approve immediately (active driver — skip applications queue)</label>` : ''}
      </div>`,
      '<button class="btn btn-ghost" id="drv-cancel">Cancel</button><button class="btn btn-primary" id="drv-save">Save</button>'
    );
    document.getElementById('drv-vehicle-photos')?.addEventListener('change', (e) => {
      const n = e.target.files?.length || 0;
      const el = document.getElementById('drv-vehicle-count');
      if (!el) return;
      el.textContent = n ? `${n} photo(s) selected${n < 5 ? ` — add ${5 - n} more` : ' ✓'}` : 'Front, back, sides, and registration plate.';
    });
    document.getElementById('drv-cancel').onclick = () => Utils.hideModal();
    document.getElementById('drv-save').onclick = async () => {
      const btn = document.getElementById('drv-save');
      btn.disabled = true;
      try {
        const branches = [...document.querySelectorAll('.drv-branch:checked')].map((x) => Number(x.value));
        const payload = {
          full_name: document.getElementById('drv-name').value.trim(),
          phone: document.getElementById('drv-phone').value.trim(),
          email: document.getElementById('drv-email').value.trim(),
          id_number: document.getElementById('drv-id-number').value.trim(),
          address: document.getElementById('drv-address').value.trim(),
          vehicle_info: document.getElementById('drv-vehicle').value.trim(),
          vehicle_registration: document.getElementById('drv-vehicle-reg').value.trim(),
          bank_name: document.getElementById('drv-bank').value.trim(),
          bank_account: document.getElementById('drv-account').value.trim(),
          bank_branch_code: document.getElementById('drv-branch-code').value.trim(),
          all_branches: document.getElementById('drv-all-branches').checked,
          branches,
          password: document.getElementById('drv-pass').value || undefined
        };
        if (!payload.full_name || !payload.phone) throw new Error('Full name and phone are required');
        if (!quick && !isEdit) {
          if (!payload.id_number || !payload.address || !payload.vehicle_info || !payload.vehicle_registration) {
            throw new Error('ID number, address, and vehicle details are required');
          }
          if (!payload.password || payload.password.length < 6) throw new Error('Password must be at least 6 characters');
        }
        const selfieFile = document.getElementById('drv-selfie')?.files?.[0];
        const idFile = document.getElementById('drv-id-photo')?.files?.[0];
        const vehicleFiles = [...(document.getElementById('drv-vehicle-photos')?.files || [])];
        if (!quick && !isEdit) {
          if (!selfieFile || !idFile) throw new Error('Selfie and ID photo are required');
          if (vehicleFiles.length < 5) throw new Error('Upload 5 vehicle photos');
        }
        if (selfieFile) payload.selfie = await this.fileToDataUrl(selfieFile);
        if (idFile) payload.id_photo = await this.fileToDataUrl(idFile);
        if (vehicleFiles.length) payload.vehicle_photos = await Promise.all(vehicleFiles.slice(0, 5).map((f) => this.fileToDataUrl(f)));
        if (isEdit) {
          payload.id = id;
          payload.status = d.status || 'active';
          const payoutSel = document.getElementById('drv-payout-day');
          if (payoutSel) payload.payout_day_of_week = payoutSel.value === '' ? null : Number(payoutSel.value);
          await API.saveDeliveryDriver(payload, this.actor);
        } else if (quick) {
          payload.status = document.getElementById('drv-auto-approve')?.checked !== false ? 'active' : 'pending';
          await API.saveDeliveryDriver(payload, this.actor);
        } else {
          payload.auto_approve = document.getElementById('drv-auto-approve')?.checked !== false;
          await API.adminRegisterDeliveryDriver(payload, this.actor);
        }
        Utils.hideModal();
        Utils.toast(isEdit ? 'Driver updated' : 'Driver saved', 'success');
        this._loadedTabs.drivers = false;
        this._loadedTabs.pending = false;
        await this.load(true);
        this.renderTab();
      } catch (err) {
        Utils.toast(err.message || 'Save failed', 'error');
      } finally {
        btn.disabled = false;
      }
    };
  },

  showDriverForm(id) {
    this.showDriverRegistrationModal({ id, quick: true });
  }
};
