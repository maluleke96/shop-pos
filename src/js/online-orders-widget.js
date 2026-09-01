/** POS online orders — badge + panel (no popups until shift is open). */
const OnlineOrdersWidget = {
  _timer: null,
  _app: null,
  _orders: [],
  _panelTab: 'pending',
  _lastPendingCount: 0,

  bind(app) {
    this._app = app;
  },

  isAllowed() {
    const pos = window.POSPage;
    return !!pos?.canShowOnlineOrders?.();
  },

  currency() {
    return this._app?.settings?.currency || 'R';
  },

  esc(s) {
    return Utils.escHtml(s == null ? '' : String(s));
  },

  parseItems(order) {
    try { return JSON.parse(order.items_json || '[]'); } catch (_) { return []; }
  },

  stopPolling() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.updateBadge(0);
  },

  startPolling() {
    this.stopPolling();
    if (!this.isAllowed()) return;
    this._timer = setInterval(() => this.poll(), 12000);
    this.poll();
  },

  async poll() {
    if (!this.isAllowed()) return;
    if (typeof API === 'undefined' || !API.getOnlineOrdersLocal) return;
    try {
      await this.refreshOrders();
      const pending = this.pendingOrders().length;
      if (pending > this._lastPendingCount && this._lastPendingCount > 0) {
        Utils.toast(`${pending - this._lastPendingCount} new online order(s) — tap Online Orders`, 'info');
      }
      this._lastPendingCount = pending;
    } catch (_) { /* ignore */ }
  },

  async refreshOrders() {
    const r = await API.getOnlineOrdersLocal();
    const list = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []);
    this._orders = list;
    this.updateBadge(this.pendingOrders().length);
    return this._orders;
  },

  pendingOrders() {
    return (this._orders || []).filter((o) => String(o.status || '').toLowerCase() === 'pending');
  },

  acceptedOrders() {
    return (this._orders || []).filter((o) => {
      const st = String(o.status || '').toLowerCase();
      if (st === 'accepted') return true;
      if (o.sale_id && !['pending', 'rejected', 'cancelled', 'completed'].includes(st)) return true;
      return false;
    });
  },

  historyOrders() {
    return (this._orders || []).filter((o) => {
      const st = String(o.status || '').toLowerCase();
      return ['completed', 'rejected', 'cancelled'].includes(st);
    });
  },

  updateBadge(count) {
    const n = count != null ? count : this.pendingOrders().length;
    const badge = document.getElementById('pos-online-orders-count');
    if (badge) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', !n);
    }
    const btn = document.getElementById('pos-online-orders');
    if (btn) {
      btn.title = this.isAllowed()
        ? (n ? `${n} new online order(s)` : 'View online orders')
        : 'Open your shift first';
    }
  },

  formatWhen(order) {
    const raw = order.created_at || order.updated_at;
    if (!raw) return '—';
    try { return Utils.formatDateTime(raw); } catch (_) { return String(raw); }
  },

  statusTag(order) {
    const st = String(order.status || 'pending').toLowerCase();
    const map = {
      pending: 'tag-warn',
      accepted: 'tag-ok',
      completed: 'tag-ok',
      rejected: 'tag-out',
      cancelled: 'tag-out'
    };
    return `<span class="tag ${map[st] || 'tag-warn'}">${this.esc(st.toUpperCase())}</span>`;
  },

  renderOrderRow(order, opts = {}) {
    const items = this.parseItems(order);
    const itemLine = items.slice(0, 2).map((i) => `${this.esc(i.name)} ×${i.quantity}`).join(', ');
    const more = items.length > 2 ? ` +${items.length - 2} more` : '';
    const actions = opts.actions !== false && String(order.status).toLowerCase() === 'pending'
      ? `<button type="button" class="btn btn-primary btn-sm oo-open" data-oo-id="${order.id}">Open</button>`
      : `<button type="button" class="btn btn-ghost btn-sm oo-open" data-oo-id="${order.id}">View</button>`;
    return `<div class="oo-row" style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;flex:1">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <strong>${this.esc(order.order_number || `#${order.id}`)}</strong>
          ${this.statusTag(order)}
          ${order.sale_id ? '<span class="tag tag-ok">ON POS</span>' : ''}
        </div>
        <div class="muted" style="font-size:12px;margin-top:4px">${this.esc(order.customer_name || 'Customer')} · ${this.esc(order.customer_phone || '—')}</div>
        <div class="muted" style="font-size:12px">${this.esc(itemLine)}${more}</div>
        <div style="font-size:12px;margin-top:4px">${this.formatWhen(order)} · ${this.esc(order.fulfillment_type || order.fulfillment || 'collection')}</div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="font-weight:700">${Utils.formatMoney(order.total, this.currency())}</div>
        ${actions}
      </div>
    </div>`;
  },

  async openPanel(tab = 'pending') {
    if (!this.isAllowed()) {
      Utils.toast('Open your shift first — online orders will appear after that', 'error');
      window.POSPage?.ensureShift?.();
      return;
    }
    this._panelTab = tab;
    await this.refreshOrders();
    this.renderPanel();
  },

  renderPanel() {
    const tab = this._panelTab || 'pending';
    const pending = this.pendingOrders();
    const accepted = this.acceptedOrders();
    const history = this.historyOrders();
    const rows = tab === 'accepted' ? accepted : tab === 'history' ? history : pending;
    const title = tab === 'accepted' ? 'Accepted on POS' : tab === 'history' ? 'Order history' : 'New online orders';

    Utils.showModal('🛒 Online Orders', `
      <p class="muted" style="margin:0 0 10px">Manage web orders for this till. New orders wait here until you accept or reject them.</p>
      <div class="form-tabs" id="oo-tabs" style="margin:0">
        <button type="button" class="form-tab ${tab === 'pending' ? 'active' : ''}" data-oo-tab="pending">New <span class="tag tag-warn" style="margin-left:4px">${pending.length}</span></button>
        <button type="button" class="form-tab ${tab === 'accepted' ? 'active' : ''}" data-oo-tab="accepted">Accepted <span class="tag tag-ok" style="margin-left:4px">${accepted.length}</span></button>
        <button type="button" class="form-tab ${tab === 'history' ? 'active' : ''}" data-oo-tab="history">History <span class="tag" style="margin-left:4px">${history.length}</span></button>
      </div>
      <h4 style="margin:14px 0 8px">${title}</h4>
      <div id="oo-list" style="max-height:420px;overflow:auto">
        ${rows.length
          ? rows.map((o) => this.renderOrderRow(o)).join('')
          : `<p class="muted" style="padding:16px 0;text-align:center">No orders in this list.</p>`}
      </div>`,
      `<button type="button" class="btn btn-ghost" id="oo-refresh">Refresh</button>
       <button type="button" class="btn btn-primary" id="oo-close">Close</button>`);

    document.getElementById('oo-close')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('oo-refresh')?.addEventListener('click', async () => {
      await this.refreshOrders();
      this.renderPanel();
    });
    document.getElementById('oo-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-oo-tab]');
      if (!btn) return;
      this._panelTab = btn.dataset.ooTab;
      this.renderPanel();
    });
    document.getElementById('oo-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.oo-open');
      if (!btn) return;
      const order = (this._orders || []).find((o) => String(o.id) === String(btn.dataset.ooId));
      if (order) this.showOrderDetail(order);
    });
  },

  showOrderDetail(order) {
    const items = this.parseItems(order);
    const isPending = String(order.status).toLowerCase() === 'pending';
    const footer = isPending
      ? `<button type="button" class="btn btn-ghost" id="oo-back">Back to list</button>
         <button type="button" class="btn btn-ghost" id="oo-reject">Reject</button>
         <button type="button" class="btn btn-primary" id="oo-accept">Accept on POS</button>`
      : `<button type="button" class="btn btn-ghost" id="oo-back">Back to list</button>
         ${order.sale_id ? `<button type="button" class="btn btn-primary" id="oo-view-sale">View on POS receipt</button>` : ''}`;

    Utils.showModal(`Order ${this.esc(order.order_number || order.id)}`, `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${this.statusTag(order)}${order.sale_id ? '<span class="tag tag-ok">Linked to POS sale</span>' : ''}</div>
      <p><strong>Customer:</strong> ${this.esc(order.customer_name)}<br>
      <strong>Phone:</strong> ${this.esc(order.customer_phone || '—')}<br>
      <strong>Type:</strong> ${this.esc(order.fulfillment_type || order.fulfillment || 'collection')}<br>
      ${order.delivery_address ? `<strong>Address:</strong> ${this.esc(order.delivery_address)}<br>` : ''}
      <strong>Payment:</strong> ${this.esc(order.payment_status || '—')} · ${this.esc(order.payment_method || 'online')}<br>
      <strong>Placed:</strong> ${this.formatWhen(order)}</p>
      <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>
      ${items.map((i) => `<tr><td>${this.esc(i.name)}${i.modifiers_text ? `<br><small>${this.esc(i.modifiers_text)}</small>` : ''}</td><td>${i.quantity}</td><td>${Utils.formatMoney(i.unit_price, this.currency())}</td></tr>`).join('')}
      </tbody></table>
      <p><strong>Total:</strong> ${Utils.formatMoney(order.total, this.currency())}</p>
      ${order.reject_reason ? `<p class="muted"><strong>Reject reason:</strong> ${this.esc(order.reject_reason)}</p>` : ''}`,
      footer);

    document.getElementById('oo-back')?.addEventListener('click', () => this.renderPanel());
    document.getElementById('oo-accept')?.addEventListener('click', () => this.accept(order));
    document.getElementById('oo-reject')?.addEventListener('click', () => this.reject(order));
    document.getElementById('oo-view-sale')?.addEventListener('click', () => {
      Utils.hideModal();
      Utils.toast(`Sale #${order.sale_id} was created when this order was accepted`, 'info');
    });
  },

  async accept(order) {
    const btn = document.getElementById('oo-accept');
    if (btn) { btn.disabled = true; btn.textContent = 'Accepting…'; }
    try {
      const r = await API.acceptOnlineOrderAsSale(order.id, { fulfillment: order.fulfillment_type || order.fulfillment }, this._app?.user);
      if (r?.success === false) throw new Error(r.error || 'Accept failed');
      if (r?.error) throw new Error(r.error);
      Utils.toast(`Online order ${order.order_number} accepted on POS`, 'success');
      await this.refreshOrders();
      this._panelTab = 'accepted';
      this.renderPanel();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Accept on POS'; }
      Utils.toast(err?.message || 'Accept failed', 'error');
    }
  },

  async reject(order) {
    if (!confirm(`Reject order ${order.order_number || order.id}?`)) return;
    const r = await API.rejectOnlineOrder?.(order.id, 'Item unavailable', this._app?.user);
    if (r?.success === false) return Utils.toast(r.error || 'Reject failed', 'error');
    Utils.toast('Order rejected', 'info');
    await this.refreshOrders();
    this._panelTab = 'history';
    this.renderPanel();
  }
};

window.OnlineOrdersWidget = OnlineOrdersWidget;
