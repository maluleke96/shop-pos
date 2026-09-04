/** POS online orders — live updates, popups, reminders (after shift is open). */
const OnlineOrdersWidget = {
  _timer: null,
  _app: null,
  _orders: [],
  _panelTab: 'pending',
  _knownIds: new Set(),
  _quietUntil: {},
  _handledIds: new Set(),
  _popupOpen: false,
  _panelOpen: false,
  _pollMs: 8000,

  bind(app) {
    this._app = app;
  },

  isAllowed() {
    const pos = window.POSPage;
    return !!pos?.canShowOnlineOrders?.();
  },

  reminderMinutes() {
    const m = Number(this._app?.settings?.online?.pos_reminder_minutes);
    return m > 0 ? m : 2;
  },

  currency() {
    return this._app?.settings?.currency || 'R';
  },

  esc(s) {
    return Utils.escHtml(s == null ? '' : String(s));
  },

  phoneLink(phone) {
    const p = String(phone || '').replace(/\D/g, '');
    return p ? `tel:${p}` : '#';
  },

  whatsappLink(phone) {
    const p = String(phone || '').replace(/\D/g, '');
    if (!p) return '#';
    const wa = p.startsWith('27') ? p : (p.startsWith('0') ? `27${p.slice(1)}` : p);
    return `https://wa.me/${wa}`;
  },

  customerContactHtml(phone, inline = false) {
    if (!phone) return '';
    const style = inline ? 'display:inline-flex;gap:6px;margin-left:8px;vertical-align:middle' : 'display:flex;gap:8px;margin:8px 0';
    return `<span class="oo-contact" style="${style}">
      <a href="${this.phoneLink(phone)}" title="Call customer" aria-label="Call">📞</a>
      <a href="${this.whatsappLink(phone)}" target="_blank" rel="noopener" title="WhatsApp customer" aria-label="WhatsApp">💬</a>
    </span>`;
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
    this._timer = setInterval(() => this.poll(), this._pollMs);
    this.poll();
  },

  orderAgeMs(order) {
    const raw = order.created_at || order.updated_at;
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? Date.now() - t : 0;
  },

  async poll() {
    if (!this.isAllowed()) return;
    if (typeof API === 'undefined' || !API.getOnlineOrdersLocal) return;
    try {
      const prevPending = this.pendingOrders();
      const prevIds = new Set(prevPending.map((o) => String(o.id)));
      await this.refreshOrders();
      const pending = this.pendingOrders();
      const newOnes = pending.filter((o) => !prevIds.has(String(o.id)) && !this._knownIds.has(String(o.id)));

      for (const o of pending) this._knownIds.add(String(o.id));

      if (newOnes.length) {
        this.playAlert();
        for (const order of newOnes) {
          this.showNewOrderPopup(order);
        }
        Utils.toast(`${newOnes.length} new online order(s)!`, 'info');
      }

      this.checkReminders(pending);
      this.updateBadge(pending.length);

      if (this._panelOpen && document.getElementById('oo-list') && !this._popupOpen) {
        this.refreshPanelList();
      }
    } catch (_) { /* ignore */ }
  },

  stopAlertSound() {
    try {
      if (typeof SoundService !== 'undefined' && SoundService.stopAlert) SoundService.stopAlert();
    } catch (_) { /* */ }
  },

  snoozeOrder(orderId, minutes) {
    const mins = minutes != null ? minutes : this.reminderMinutes();
    this._quietUntil[String(orderId)] = Date.now() + mins * 60 * 1000;
  },

  isQuiet(orderId) {
    const until = this._quietUntil[String(orderId)];
    return until && Date.now() < until;
  },

  markHandled(orderId) {
    const id = String(orderId);
    this._handledIds.add(id);
    delete this._quietUntil[id];
    this.stopAlertSound();
  },
  playAlert() {
    try {
      const ns = this._app?.settings?.notification_settings || {};
      if (ns.sound_enabled === false) return;
      if (typeof SoundService !== 'undefined' && SoundService.playOnlineOrderAlert) {
        SoundService.playOnlineOrderAlert(this._app?.settings || {});
        return;
      }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 180);
    } catch (_) { /* */ }
  },

  checkReminders(pending) {
    const limitMs = this.reminderMinutes() * 60 * 1000;
    for (const order of pending) {
      const id = String(order.id);
      if (this._handledIds.has(id)) continue;
      if (this.isQuiet(id)) continue;
      if (this.orderAgeMs(order) >= limitMs) {
        this.snoozeOrder(id, this.reminderMinutes());
        Utils.toast(`⏰ Reminder: ${order.order_number || 'Online order'} not attended (${this.reminderMinutes()} min)`, 'error');
        this.playAlert();
        if (!this._popupOpen) this.showNewOrderPopup(order, true);
      }
    }
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
      btn.classList.toggle('has-orders', n > 0);
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

  sourceTag(order) {
    const src = String(order.order_source || 'ONLINE').toUpperCase();
    const isWeb = src === 'ONLINE' || src === 'WEB';
    return `<span class="tag ${isWeb ? 'tag-info' : ''}" title="Order channel">${this.esc(isWeb ? 'WEB' : src)}</span>`;
  },

  itemModifiersHtml(item) {
    const parts = [];
    if (item.modifiers_text) parts.push(item.modifiers_text);
    else if (Array.isArray(item.modifiers) && item.modifiers.length) {
      parts.push(item.modifiers.map((m) => m.name || m).join(', '));
    }
    if (item.removals?.length) parts.push(`Without: ${item.removals.map((r) => r.name || r).join(', ')}`);
    if (!parts.length) return '';
    return `<br><small class="muted">${this.esc(parts.join(' · '))}</small>`;
  },

  financialSummaryHtml(order) {
    const sub = Number(order.subtotal);
    const disc = Number(order.discount) || 0;
    const delivery = Number(order.delivery_fee) || 0;
    const tax = Number(order.tax_amount) || 0;
    const loyalty = Number(order.loyalty_points_used) || 0;
    const rows = [];
    if (Number.isFinite(sub) && sub > 0) rows.push(`<div class="row"><span>Subtotal</span><span>${Utils.formatMoney(sub, this.currency())}</span></div>`);
    if (disc > 0) {
      const discLabel = [
        order.coupon_code ? `Coupon: ${order.coupon_code}` : null,
        loyalty > 0 ? `Loyalty: ${loyalty} pts` : null
      ].filter(Boolean).join(' · ') || 'Discount';
      rows.push(`<div class="row"><span>${this.esc(discLabel)}</span><span>-${Utils.formatMoney(disc, this.currency())}</span></div>`);
    }
    if (delivery > 0) rows.push(`<div class="row"><span>Delivery fee</span><span>${Utils.formatMoney(delivery, this.currency())}</span></div>`);
    if (tax > 0) rows.push(`<div class="row"><span>Tax</span><span>${Utils.formatMoney(tax, this.currency())}</span></div>`);
    if (order.coupon_code) rows.push(`<div class="row"><span>Coupon</span><span>${this.esc(order.coupon_code)}</span></div>`);
    if (loyalty > 0) rows.push(`<div class="row"><span>Loyalty points</span><span>${loyalty} pts</span></div>`);
    const giftAmt = Number(order.gift_card_amount) || 0;
    if (giftAmt > 0 && order.gift_card_code) {
      rows.push(`<div class="row"><span>Gift card <code>${this.esc(order.gift_card_code)}</code></span><span>-${Utils.formatMoney(giftAmt, this.currency())}</span></div>`);
    }
    rows.push(`<div class="row" style="font-weight:700"><span>Total</span><span>${Utils.formatMoney(order.total, this.currency())}</span></div>`);
    return rows.join('');
  },

  renderOrderRow(order, opts = {}) {
    const items = this.parseItems(order);
    const itemLine = items.slice(0, 2).map((i) => {
      const mods = i.modifiers_text || (Array.isArray(i.modifiers) ? i.modifiers.map((m) => m.name).join(', ') : '');
      return `${this.esc(i.name)} ×${i.quantity}${mods ? ` (${this.esc(mods)})` : ''}`;
    }).join(', ');
    const more = items.length > 2 ? ` +${items.length - 2} more` : '';
    const fulfillment = order.fulfillment_type || order.fulfillment || 'collection';
    const actions = opts.actions !== false && String(order.status).toLowerCase() === 'pending'
      ? `<button type="button" class="btn btn-primary btn-sm oo-open" data-oo-id="${order.id}">Open</button>`
      : `<button type="button" class="btn btn-ghost btn-sm oo-open" data-oo-id="${order.id}">View</button>`;
    return `<div class="oo-row" style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;flex:1">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <strong>${this.esc(order.order_number || `#${order.id}`)}</strong>
          ${this.statusTag(order)}
          ${this.sourceTag(order)}
          ${order.sale_id ? '<span class="tag tag-ok">ON POS</span>' : '<span class="tag tag-warn">NOT ON POS</span>'}
        </div>
        <div class="muted" style="font-size:12px;margin-top:4px"><strong>${this.esc(order.customer_name || 'Customer')}</strong>${order.customer_email ? ` · ${this.esc(order.customer_email)}` : ''} · ${this.esc(order.customer_phone || '—')}${this.customerContactHtml(order.customer_phone, true)}</div>
        <div class="muted" style="font-size:12px">${this.esc(itemLine)}${more}</div>
        <div style="font-size:12px;margin-top:4px">${this.formatWhen(order)} · ${this.esc(fulfillment)}${fulfillment === 'delivery' && order.delivery_address ? ` · ${this.esc(order.delivery_address)}` : ''}</div>
        ${order.notes ? `<div class="muted" style="font-size:12px;margin-top:2px">Note: ${this.esc(order.notes)}</div>` : ''}
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="font-weight:700">${Utils.formatMoney(order.total, this.currency())}</div>
        ${actions}
      </div>
    </div>`;
  },

  showNewOrderPopup(order, isReminder = false) {
    if (!this.isAllowed() || !order) return;
    this._popupOpen = true;
    const items = this.parseItems(order);
    const title = isReminder ? '⏰ Online order needs attention' : '🛒 New online order';
    const fulfillment = order.fulfillment_type || order.fulfillment || 'collection';
    Utils.showModal(title, `
      <p><strong>${this.esc(order.order_number)}</strong> · ${Utils.formatMoney(order.total, this.currency())} ${this.sourceTag(order)}</p>
      <p><strong>${this.esc(order.customer_name || 'Customer')}</strong>${order.customer_email ? `<br>${this.esc(order.customer_email)}` : ''}<br>
      <strong>Phone:</strong> ${this.esc(order.customer_phone || '—')}${this.customerContactHtml(order.customer_phone, true)}</p>
      <p class="muted">${this.esc(fulfillment)}${fulfillment === 'delivery' && order.delivery_address ? ` · ${this.esc(order.delivery_address)}` : ''} · ${items.length} item(s)</p>
      ${order.notes ? `<p class="muted"><strong>Note:</strong> ${this.esc(order.notes)}</p>` : ''}
      <ul style="margin:8px 0;padding-left:18px;font-size:13px">${items.slice(0, 8).map((i) =>
        `<li>${this.esc(i.name)} ×${i.quantity}${this.itemModifiersHtml(i)}</li>`).join('')}</ul>
      ${this.financialSummaryHtml(order)}`,
      `<button type="button" class="btn btn-ghost" id="oo-popup-later">Later</button>
       <button type="button" class="btn btn-ghost" id="oo-popup-view">View all</button>
       <button type="button" class="btn btn-primary" id="oo-popup-accept">Accept on POS</button>`,
      { noDismiss: true });

    document.getElementById('oo-popup-later')?.addEventListener('click', () => {
      this.snoozeOrder(order.id, this.reminderMinutes());
      this.stopAlertSound();
      this._popupOpen = false;
      Utils.forceHideModal?.() || Utils.hideModal();
    });
    document.getElementById('oo-popup-view')?.addEventListener('click', () => {
      this._popupOpen = false;
      Utils.forceHideModal?.() || Utils.hideModal();
      this.openPanel('pending');
    });
    document.getElementById('oo-popup-accept')?.addEventListener('click', async () => {
      this.markHandled(order.id);
      this.stopAlertSound();
      this._popupOpen = false;
      Utils.hideModal();
      await this.accept(order);
    });
  },

  async openPanel(tab = 'pending') {
    if (!this.isAllowed()) {
      Utils.toast('Open your shift first — online orders will appear after that', 'error');
      window.POSPage?.ensureShift?.();
      return;
    }
    this._panelTab = tab;
    this._panelOpen = true;
    await this.refreshOrders();
    this.renderPanel();
  },

  refreshPanelList() {
    const tab = this._panelTab || 'pending';
    const pending = this.pendingOrders();
    const accepted = this.acceptedOrders();
    const history = this.historyOrders();
    const rows = tab === 'accepted' ? accepted : tab === 'history' ? history : pending;
    const list = document.getElementById('oo-list');
    if (!list) return;
    list.innerHTML = rows.length
      ? rows.map((o) => this.renderOrderRow(o)).join('')
      : `<p class="muted" style="padding:16px 0;text-align:center">No orders in this list.</p>`;
    document.querySelectorAll('#oo-tabs .form-tab').forEach((btn) => {
      const t = btn.dataset.ooTab;
      const count = t === 'accepted' ? accepted.length : t === 'history' ? history.length : pending.length;
      const tag = btn.querySelector('.tag');
      if (tag) tag.textContent = String(count);
    });
  },

  renderPanel() {
    const tab = this._panelTab || 'pending';
    const pending = this.pendingOrders();
    const accepted = this.acceptedOrders();
    const history = this.historyOrders();
    const rows = tab === 'accepted' ? accepted : tab === 'history' ? history : pending;
    const title = tab === 'accepted' ? 'Accepted on POS' : tab === 'history' ? 'Order history' : 'New online orders';

    Utils.showModal('🛒 Online Orders', `
      <p class="muted" style="margin:0 0 10px">Live web orders — updates every few seconds. Reminder after ${this.reminderMinutes()} min unattended.</p>
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
      `<button type="button" class="btn btn-ghost" id="oo-close">Close</button>`);

    document.getElementById('oo-close')?.addEventListener('click', () => {
      this._panelOpen = false;
      Utils.hideModal();
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

    const fulfillment = order.fulfillment_type || order.fulfillment || 'collection';
    Utils.showModal(`Order ${this.esc(order.order_number || order.id)}`, `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${this.statusTag(order)}${this.sourceTag(order)}${order.sale_id ? '<span class="tag tag-ok">Linked to POS sale</span>' : '<span class="tag tag-warn">Awaiting POS accept</span>'}</div>
      <p><strong>Customer:</strong> ${this.esc(order.customer_name || '—')}<br>
      ${order.customer_email ? `<strong>Email:</strong> ${this.esc(order.customer_email)}<br>` : ''}
      <strong>Phone:</strong> ${this.esc(order.customer_phone || '—')}${this.customerContactHtml(order.customer_phone, true)}<br>
      <strong>Source:</strong> ${this.esc(order.order_source || 'ONLINE')} (web order — not placed on POS)<br>
      <strong>Fulfillment:</strong> ${this.esc(fulfillment)}<br>
      ${fulfillment === 'delivery' && order.delivery_address ? `<strong>Delivery address:</strong> ${this.esc(order.delivery_address)}<br>` : ''}
      <strong>Payment:</strong> ${this.esc(order.payment_status || '—')} · ${this.esc(order.payment_method || 'online')}<br>
      <strong>Placed:</strong> ${this.formatWhen(order)}</p>
      ${order.notes ? `<p><strong>Customer note:</strong> ${this.esc(order.notes)}</p>` : ''}
      <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>
      ${items.map((i) => `<tr><td>${this.esc(i.name)}${this.itemModifiersHtml(i)}</td><td>${i.quantity}</td><td>${Utils.formatMoney(i.unit_price, this.currency())}</td></tr>`).join('')}
      </tbody></table>
      <div style="margin-top:10px">${this.financialSummaryHtml(order)}</div>
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
    const btn = document.getElementById('oo-accept') || document.getElementById('oo-popup-accept');
    const prevText = btn?.textContent || 'Accept on POS';
    if (btn) { btn.disabled = true; btn.textContent = 'Accepting…'; }
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Accept timed out — try again')), 45000));
      const r = await Promise.race([
        API.acceptOnlineOrderAsSale(order.id, { fulfillment: order.fulfillment_type || order.fulfillment }, this._app?.user),
        timeout
      ]);
      if (r?.success === false) throw new Error(r.error || 'Accept failed');
      if (r?.error) throw new Error(r.error);
      this.markHandled(order.id);
      this.stopAlertSound();
      Utils.toast(`Online order ${order.order_number} accepted on POS`, 'success');
      try { await API.refreshKitchenDisplay?.(); } catch (_) { /* optional */ }
      try { await API.refreshCustomerDisplay?.(); } catch (_) { /* optional */ }
      await this.refreshOrders();
      this._panelTab = 'accepted';
      this._popupOpen = false;
      Utils.forceHideModal?.() || Utils.hideModal();
      this.renderPanel();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
      Utils.toast(err?.message || 'Accept failed', 'error');
    }
  },

  reject(order) {
    Utils.showModal(`Reject order ${this.esc(order.order_number || order.id)}`, `
      <p class="muted">The customer will be notified. Please give a clear reason.</p>
      <label class="field full">Reason for rejection
        <textarea id="oo-reject-reason" rows="4" placeholder="e.g. Item out of stock, kitchen closed, cannot deliver to this area…"></textarea>
      </label>`,
      `<button type="button" class="btn btn-ghost" id="oo-reject-cancel">Cancel</button>
       <button type="button" class="btn btn-danger" id="oo-reject-confirm">Reject order</button>`);
    document.getElementById('oo-reject-cancel')?.addEventListener('click', () => this.showOrderDetail(order));
    document.getElementById('oo-reject-confirm')?.addEventListener('click', async () => {
      const reason = document.getElementById('oo-reject-reason')?.value.trim();
      if (!reason) return Utils.toast('Please enter a rejection reason', 'error');
      const btn = document.getElementById('oo-reject-confirm');
      btn.disabled = true;
      btn.textContent = 'Rejecting…';
      try {
        const r = await API.rejectOnlineOrder?.(order.id, reason, this._app?.user);
        if (r?.success === false) throw new Error(r.error || 'Reject failed');
        this.markHandled(order.id);
        Utils.toast('Order rejected — customer will be notified', 'info');
        await this.refreshOrders();
        this._panelTab = 'history';
        this.renderPanel();
      } catch (e) {
        Utils.toast(e.message || 'Reject failed', 'error');
        btn.disabled = false;
        btn.textContent = 'Reject order';
      }
    });
  }
};

window.OnlineOrdersWidget = OnlineOrdersWidget;
