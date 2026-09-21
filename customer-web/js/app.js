/* Customer online ordering — branch-scoped PWA */
const OrderApp = {
  view: 'splash',
  branch: null,
  settings: null,
  menu: null,
  categoryId: null,
  search: '',
  cart: [],
  token: (typeof localStorage !== 'undefined' && localStorage.getItem('order_token')) || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('order_token')) || '',
  customer: null,
  product: null,
  checkout: { fulfillment_type: 'collection', payment_method: 'card', coupon_code: '', loyalty_points_used: 0, notes: '', delivery_address: '', delivery_place_id: '', delivery_place: '' },
  lastOrder: null,
  selectedOrder: null,
  quote: null,
  loyaltyAccount: null,
  giftWallet: [],
  regLink: null,
  editingCartKey: null,
  _closedTimer: null,
  _orderPollTimer: null,
  _menuFull: null,
  _menuBranchId: null,
  _menuLoadPromise: null,
  _searchTimer: null,
  openJobs: [],
  myIssues: [],
  _accountCache: null,
  _ordersCache: null,
  _pendingSaveCreds: null,

  isAuthView(view = this.view) {
    return ['login', 'register', 'register-verify', 'forgot', 'forgot-verify'].includes(view);
  },

  findMenuProduct(productId) {
    const id = String(productId || '');
    if (!id || !this._menuFull) return null;
    const cats = this._menuFull.categories || this.menu?.categories || [];
    for (const c of cats) {
      for (const p of (c.products || [])) {
        if (String(p.id) === id || String(p.product_id) === id) return { ...p };
      }
    }
    for (const p of (this._menuFull.specials || this.menu?.specials || [])) {
      if (String(p.id) === id || String(p.product_id) === id) return { ...p };
    }
    return null;
  },

  rememberAskSaveLater(loginId, password) {
    this._pendingSaveCreds = loginId && password ? { loginId, password } : null;
    try {
      localStorage.setItem('order_ask_save_on_order', '1');
      if (loginId) localStorage.setItem('order_saved_login_id', String(loginId));
    } catch (_) { /* */ }
  },

  clearAskSaveLater() {
    this._pendingSaveCreds = null;
    try { localStorage.removeItem('order_ask_save_on_order'); } catch (_) { /* */ }
  },

  shouldAskSaveOnOrder() {
    try {
      return localStorage.getItem('order_ask_save_on_order') === '1'
        && localStorage.getItem('order_stay_signed_in') !== '1'
        && !!this.token;
    } catch (_) { return false; }
  },

  async maybeAskSavePasswordOnOrder() {
    if (!this.shouldAskSaveOnOrder()) return;
    const creds = this._pendingSaveCreds || {};
    const loginId = creds.loginId || (() => {
      try { return localStorage.getItem('order_saved_login_id') || ''; } catch (_) { return ''; }
    })();
    const password = creds.password || '';
    let stay = false;
    try {
      stay = await Promise.race([
        this.askStaySignedIn(loginId || this.customer?.email || this.customer?.phone || 'account', password || ' '),
        new Promise((resolve) => setTimeout(() => resolve(false), 15000))
      ]);
    } catch (_) { stay = false; }
    if (stay) {
      this.persistSession(this.token, true);
      if (loginId && password && password !== ' ') {
        await this.storeBrowserPassword(loginId, password, this.customer?.first_name);
      }
      this.clearAskSaveLater();
      this.toast('Password saved — you stay signed in on this phone', 'success');
    } else {
      this.rememberAskSaveLater(loginId, password);
    }
  },

  async pollPaymentReturn(orderNumber) {
    if (!orderNumber || !this.token) return;
    if (this._payPollTimer) clearInterval(this._payPollTimer);
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const statusEl = document.getElementById('pay-pending-status');
      try {
        const st = await OrderAPI.getPaymentStatus(orderNumber, this.token);
        const paid = st?.paid || String(st?.payment_status || '').toUpperCase() === 'PAID';
        if (statusEl) {
          statusEl.textContent = paid
            ? 'Payment confirmed!'
            : `Status: ${st?.payment_status || 'PENDING'} (waiting for bank confirmation…)`;
        }
        if (paid) {
          clearInterval(this._payPollTimer);
          this._payPollTimer = null;
          try {
            const orders = await OrderAPI.listOrders(this.token);
            this.lastOrder = (orders || []).find((o) => o.order_number === orderNumber) || this.lastOrder;
          } catch (_) { /* */ }
          this.view = 'confirmed';
          this.paymentReturn = null;
          this.render();
          return;
        }
        if (String(st?.payment_status || '').toUpperCase() === 'FAILED') {
          clearInterval(this._payPollTimer);
          this._payPollTimer = null;
          if (statusEl) statusEl.textContent = st.failure_reason || 'Payment failed';
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message || 'Could not check payment status';
      }
      if (tries >= 60) {
        clearInterval(this._payPollTimer);
        this._payPollTimer = null;
        if (statusEl) statusEl.textContent = 'Still confirming — check My orders shortly. Payment is only confirmed after bank verification.';
      }
    };
    await tick();
    this._payPollTimer = setInterval(tick, 2500);
  },

  parseTimeToday(timeStr) {
    const [h, m] = String(timeStr || '18:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d;
  },

  formatCountdown(ms) {
    if (ms <= 0) return '00:00:00';
    const total = Math.floor(ms / 1000);
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
  },

  getOperatingSettings() {
    return this.settings?.operating_hours || { enabled: false, weekly: [] };
  },

  isShopOpenNow() {
    const oh = this.getOperatingSettings();
    if (oh.force_online === 'open') return true;
    if (oh.force_online === 'closed') return false;
    if (oh.apply_to_online === false || oh.apply_to_online === 0 || oh.apply_to_online === '0') return true;
    const weekly = Array.isArray(oh.weekly) ? oh.weekly : [];
    const now = new Date();
    const day = weekly.find((w) => Number(w.day) === now.getDay())
      || { open: oh.open_time || '08:00', close: oh.close_time || '18:00', closed: false };
    if (day.closed) return false;
    const openAt = this.parseTimeToday(day.open || oh.open_time || '08:00');
    const closeAt = this.parseTimeToday(day.close || oh.close_time || '18:00');
    if (closeAt.getTime() <= openAt.getTime()) {
      return now >= openAt || now < closeAt;
    }
    return now >= openAt && now < closeAt;
  },

  getNextOpenInfo() {
    const oh = this.getOperatingSettings();
    const weekly = oh.weekly || [];
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const day = weekly.find((w) => Number(w.day) === d.getDay())
        || { open: oh.open_time || '08:00', close: oh.close_time || '18:00', closed: false, name: d.toLocaleDateString(undefined, { weekday: 'long' }) };
      if (day.closed) continue;
      const openAt = this.parseTimeToday(day.open || oh.open_time || '08:00');
      openAt.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      if (openAt > now) {
        return { at: openAt, label: day.name || openAt.toLocaleDateString(undefined, { weekday: 'long' }) };
      }
    }
    return null;
  },

  applyHoursStatus(status) {
    const oh = status?.operating_hours || status;
    if (!oh || typeof oh !== 'object') return;
    const prevForce = this.settings?.operating_hours?.force_online;
    const prevRev = this.settings?.operating_hours?.hours_revision;
    const wasOpen = this.isShopOpenNow();
    this.settings = {
      ...(this.settings || {}),
      operating_hours: { ...(this.settings?.operating_hours || {}), ...oh }
    };
    const isOpen = this.isShopOpenNow();
    this.mountClosedOverlay();
    if (wasOpen !== isOpen || prevForce !== oh.force_online || prevRev !== oh.hours_revision) {
      this.render();
    }
  },

  startHoursWatch() {
    if (this._hoursWatch) return;
    const tick = async () => {
      try {
        const status = OrderAPI.getHoursStatus
          ? await OrderAPI.getHoursStatus()
          : await OrderAPI.getSettings();
        this.applyHoursStatus(status?.operating_hours ? status : { operating_hours: status?.operating_hours || status });
      } catch (_) {
        try {
          const next = await OrderAPI.getSettings();
          this.applyHoursStatus({ operating_hours: next?.operating_hours });
        } catch (__) { /* keep last settings */ }
      }
    };
    this._hoursWatch = setInterval(tick, 2000);
    tick();
    try {
      this._hoursBc = new BroadcastChannel('shop-pos-hours');
      this._hoursBc.onmessage = (ev) => {
        if (ev.data) this.applyHoursStatus({ operating_hours: ev.data });
      };
    } catch (_) { /* */ }
  },

  startClosedCountdown() {
    if (this._closedTimer) clearInterval(this._closedTimer);
    this._closedTimer = setInterval(() => {
      if (this.isShopOpenNow()) {
        clearInterval(this._closedTimer);
        this._closedTimer = null;
        const overlay = document.getElementById('order-closed-overlay');
        if (overlay) overlay.remove();
        this.render();
        return;
      }
      const el = document.getElementById('closed-countdown');
      const next = this.getNextOpenInfo();
      if (el && next) el.textContent = this.formatCountdown(next.at - Date.now());
    }, 1000);
  },

  renderClosedOverlay() {
    setTimeout(() => this.mountClosedOverlay(), 0);
    return '';
  },

  mountClosedOverlay() {
    const existing = document.getElementById('order-closed-overlay');
    if (this.isShopOpenNow()) {
      existing?.remove();
      return;
    }
    const shop = this.settings?.shop_name || 'Our shop';
    const next = this.getNextOpenInfo();
    const forced = this.getOperatingSettings().force_online === 'closed';
    const wa = (this.settings?.whatsapp_number || this.settings?.phone || '').replace(/\D/g, '');
    const waLink = wa ? `https://wa.me/${wa.startsWith('27') ? wa : '27' + wa.replace(/^0/, '')}?text=${encodeURIComponent('Hi, I tried to order online while you were closed.')}` : '';
    const html = `<div class="closed-card closed-card-xl">
        ${this.settings?.logo_path ? `<img class="closed-logo" src="/api/logo" alt="" onerror="this.style.display='none'">` : '<div class="closed-logo-placeholder">🛍️</div>'}
        <div class="closed-kicker">Closed for online orders</div>
        <h2>${this.esc(shop)}</h2>
        <p class="closed-lead">${forced ? 'Online ordering is closed right now.' : 'We are closed for online orders.'}</p>
        <p class="muted">${forced ? 'The shop closed online orders.' : `Opens ${next ? `${next.label} at ${next.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'soon'}`}</p>
        <div class="closed-countdown-wrap">${forced ? 'Closed now' : `Opens in <strong id="closed-countdown">${next ? this.formatCountdown(next.at - Date.now()) : '—'}</strong>`}</div>
        <p class="closed-note">Online ordering, job applications, and customer reports are closed until we open.</p>
        ${waLink ? `<a class="btn-primary btn-block closed-wa" href="${waLink}" target="_blank" rel="noopener">Message us on WhatsApp</a>` : ''}
      </div>`;
    if (existing) {
      existing.innerHTML = html;
    } else {
      const overlay = document.createElement('div');
      overlay.id = 'order-closed-overlay';
      overlay.className = 'closed-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
    }
    this.startClosedCountdown();
  },

  goBack() {
    if (this.view === 'order-detail') { this.stopOrderPolling(); this.view = 'orders'; this.selectedOrder = null; }
    else if (this.view === 'forgot-verify') { this.view = 'forgot'; }
    else if (this.view === 'forgot') { this.view = 'login'; }
    else if (this.view === 'product') { this.view = 'menu'; this.editingCartKey = null; }
    else if (this.view === 'cart') { this.view = 'menu'; }
    else if (this.view === 'checkout') { this.view = 'cart'; }
    else if (this.view === 'menu') { this.view = 'home'; }
    this.render();
  },

  money(n) {
    const c = this.settings?.currency || 'R';
    return `${c}${(Number(n) || 0).toFixed(2)}`;
  },

  /** Fast DOM update for checkout totals without full re-render (delivery place pick). */
  updateCheckoutTotalsDom() {
    const q = this.quote || {};
    const fulfillment = this.checkout?.fulfillment_type || 'collection';
    const ptsUsed = Number(this.checkout?.loyalty_points_used) || 0;
    const el = document.getElementById('checkout-totals');
    if (el) {
      el.innerHTML = `
        <div>Subtotal <span>${this.money(q.subtotal)}</span></div>
        ${q.discount ? `<div>Discount${q.coupon?.code ? ` (${this.esc(q.coupon.code)})` : ''}${q.loyalty_discount ? ` · Loyalty ${ptsUsed} pts` : ''} <span>-${this.money(q.discount)}</span></div>` : ''}
        ${q.gift_card_amount ? `<div>Gift card <span>-${this.money(q.gift_card_amount)}</span></div>` : ''}
        ${q.delivery_fee != null && fulfillment === 'delivery' ? `<div>Delivery${q.delivery_place ? ` (${this.esc(q.delivery_place)})` : ''} <span>${this.money(q.delivery_fee)}</span></div>` : ''}
        ${q.service_fee != null && Number(q.service_fee) > 0
          ? `<div>${this.esc(q.service_fee_label || 'Service Fee')} <span>${this.money(q.service_fee)}</span></div>`
          : (q.service_fee_config?.enabled
            ? `<div>${this.esc(q.service_fee_label || 'Service Fee')} <span>${this.money(0)}</span></div>`
            : '')}
        ${q.tax_amount ? `<div>Tax <span>${this.money(q.tax_amount)}</span></div>` : ''}
        <div class="total-line">Total <strong>${this.money(q.total)}</strong></div>`;
    }
    const btn = document.getElementById('checkout-place-btn')
      || document.querySelector('[data-act="place-order"]');
    if (btn) btn.textContent = `Place order · ${this.money(q.total)}`;
  },

  calcPromoUnitPrice(product, mods) {
    const promoActive = !!product.on_sale;
    const normal = Number(product.price) || 0;
    const sale = Number(product.sale_price ?? product.price) || normal;
    const extraTotal = (mods || []).reduce((s, m) => s + (Number(m.extra_price) || 0), 0);
    const hasRemoval = (mods || []).some((m) =>
      m.modifier_type === 'removal' || (Number(m.extra_price) < 0 && m.modifier_type !== 'extra'));
    if (promoActive && hasRemoval) return Math.round((normal + extraTotal) * 100) / 100;
    if (promoActive) return Math.round((sale + extraTotal) * 100) / 100;
    return Math.round((sale + extraTotal) * 100) / 100;
  },

  calcComboUnitPrice(combo, comboComponents) {
    const normal = Number(combo.price) || 0;
    const sale = Number(combo.sale_price ?? combo.price) || normal;
    const hasRemoval = (comboComponents || []).some((c) =>
      (c.modifiers || []).some((m) =>
        m.modifier_type === 'removal' || (Number(m.extra_price) < 0 && m.modifier_type !== 'extra')));
    if (hasRemoval) return Math.round(normal * 100) / 100;
    return Math.round((combo.on_sale ? sale : normal) * 100) / 100;
  },

  confirmWithoutOptionPrice(opts = {}) {
    const optionName = opts.optionName || 'Without pap';
    const salePrice = Number(opts.salePrice) || 0;
    const normalPrice = Number(opts.normalPrice) || salePrice;
    const isCombo = !!opts.isCombo;
    const saleLabel = isCombo ? 'Combo deal price' : 'Sale price';
    const normalLabel = isCombo ? 'Standard combo price' : 'Normal price';
    const saleHint = isCombo ? 'Keep the combo as advertised (with pap)' : 'Keep the promotional sale price';
    const normalHint = isCombo ? 'Without pap — charged at the regular combo total' : 'Without pap — charged at the regular menu price';
    return new Promise((resolve) => {
      const host = document.getElementById('app');
      if (!host) return resolve(null);
      const overlay = document.createElement('div');
      overlay.className = 'order-price-confirm-overlay';
      overlay.innerHTML = `
        <div class="order-price-confirm-panel" role="dialog" aria-modal="true">
          <div class="order-price-confirm-badge">Price confirmation required</div>
          <h4>Confirm pricing choice</h4>
          <p>You selected <strong>${this.esc(optionName)}</strong>.</p>
          <p class="muted">Please confirm how this item should be priced before continuing.</p>
          <div class="order-price-confirm-cards">
            <button type="button" class="order-price-confirm-card" data-choice="sale">
              <span class="label">${saleLabel}</span>
              <span class="price">${this.money(salePrice)}</span>
              <span class="hint">${saleHint}</span>
            </button>
            <button type="button" class="order-price-confirm-card alt" data-choice="normal">
              <span class="label">${normalLabel}</span>
              <span class="price">${this.money(normalPrice)}</span>
              <span class="hint">${normalHint}</span>
            </button>
          </div>
          <p class="muted foot">You must choose one option to continue.</p>
        </div>`;
      host.style.position = 'relative';
      host.appendChild(overlay);
      const finish = (choice) => {
        overlay.remove();
        if (!host.querySelector('.order-price-confirm-overlay')) host.style.position = '';
        resolve(choice);
      };
      overlay.querySelector('[data-choice="sale"]')?.addEventListener('click', () => finish('sale'));
      overlay.querySelector('[data-choice="normal"]')?.addEventListener('click', () => finish('normal'));
    });
  },

  collectModifiersFromDom(scope = document) {
    const mods = [];
    (scope.querySelectorAll ? scope : document).querySelectorAll('[data-mod-group]').forEach((g) => {
      const required = g.dataset.required === '1';
      const type = g.dataset.type || 'radio';
      if (type === 'radio' || type === 'radio-optional') {
        const sel = g.querySelector('input:checked');
        if (sel) {
          g.classList.remove('mod-group-missing');
          mods.push({
            id: Number.isFinite(Number(sel.value)) ? Number(sel.value) : sel.value,
            name: sel.dataset.name,
            extra_price: Number(sel.dataset.extra || 0),
            modifier_type: sel.dataset.modType || 'option'
          });
        } else if (required) {
          g.classList.add('mod-group-missing');
          g.scrollIntoView({ behavior: 'smooth', block: 'center' });
          throw new Error(`Please choose ${g.dataset.modGroup}`);
        } else {
          g.classList.remove('mod-group-missing');
        }
      } else {
        g.querySelectorAll('input:checked').forEach((cb) => {
          mods.push({
            id: Number.isFinite(Number(cb.value)) ? Number(cb.value) : cb.value,
            name: cb.dataset.name,
            extra_price: Number(cb.dataset.extra || 0),
            modifier_type: cb.dataset.modType || 'extra'
          });
        });
      }
    });
    return mods;
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },

  isDeliveryOrder(o) {
    return (o?.fulfillment_type || o?.fulfillment) === 'delivery';
  },

  handoffCodeHtml(o, { copy = false } = {}) {
    if (!this.isDeliveryOrder(o)) return '';
    const code = o.confirmation_code || o.order_number;
    if (!code) return '';
    return `<div class="confirmation-code-box">
      <span class="muted">Your delivery handoff code</span>
      <strong class="handoff-code">${this.esc(code)}</strong>
      <p class="muted" style="margin:8px 0 0;font-size:13px">Give this code to your driver when they arrive — not your order number (${this.esc(o.order_number || '')}).</p>
      ${copy ? `<button type="button" class="btn-sm" data-act="copy-code" data-code="${this.esc(code)}" style="margin-top:8px">Copy code</button>` : ''}
    </div>`;
  },

  driverCardHtml(driver) {
    if (!driver?.name) return '';
    const wa = driver.phone ? String(driver.phone).replace(/\D/g, '').replace(/^0/, '27') : '';
    return `<div class="checkout-card driver-card">
      <h3>Your driver</h3>
      <div style="display:flex;gap:12px;align-items:flex-start">
        ${driver.photo_url ? `<img src="${this.esc(driver.photo_url)}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;flex-shrink:0">` : '<div style="width:72px;height:72px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:28px">🚚</div>'}
        <div>
          <p style="margin:0"><strong>${this.esc(driver.name)}</strong></p>
          ${driver.vehicle_registration ? `<p style="margin:6px 0 0"><strong>Vehicle reg:</strong> ${this.esc(driver.vehicle_registration)}</p>` : ''}
          ${driver.vehicle_info ? `<p class="muted" style="margin:4px 0 0">${this.esc(driver.vehicle_info)}</p>` : ''}
          ${driver.phone ? `<p style="margin:8px 0 0"><a href="tel:${this.esc(driver.phone.replace(/\s/g, ''))}">📞 ${this.esc(driver.phone)}</a>
            ${wa ? ` · <a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p>` : ''}
        </div>
      </div>
    </div>`;
  },

  startOrderPolling() {
    this.stopOrderPolling();
    if (!this.token || this.view !== 'order-detail' || !this.selectedOrder?.id) return;
    this._lastOrderStatus = this.selectedOrder?.status || this.selectedOrder?.status_label;
    this._orderPollTimer = setInterval(async () => {
      if (this.view !== 'order-detail' || !this.selectedOrder?.id) return;
      try {
        const fresh = await OrderAPI.getOrder(this.selectedOrder.id, this.token);
        const prev = this._lastOrderStatus;
        const next = fresh?.status || fresh?.status_label;
        if (prev && next && prev !== next) {
          const key = `order_track:${this.selectedOrder.id}:${next}`;
          if (!window.PanelNotify?.isAcked(key)) {
            this.toast(`Order update: ${next}`, 'success');
            PanelSound?.setPanel('online');
            if (window.PanelSound) PanelSound.playOnce();
            PanelNotify?.notifyBrowser('Order update', String(next), `order-${this.selectedOrder.id}`);
            PanelNotify?.ack(key, 'seen');
          }
        }
        this._lastOrderStatus = next;
        this.selectedOrder = fresh;
        this.render();
      } catch (_) { /* ignore */ }
    }, 12000);
  },

  stopOrderPolling() {
    if (this._orderPollTimer) { clearInterval(this._orderPollTimer); this._orderPollTimer = null; }
  },

  toast(msg, type = 'info', ms = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), ms);
  },

  openWhatsApp(url) {
    if (!url) return false;
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (_) {
      try { window.open(url, '_blank', 'noopener,noreferrer'); return true; } catch (__) { return false; }
    }
  },

  applyCodeSend(sent) {
    if (!sent) return;
    if (this.regLink) this.regLink.whatsapp_url = sent.whatsapp_url || this.regLink.whatsapp_url || '';
    if (sent.whatsapp_url) this.openWhatsApp(sent.whatsapp_url);
    this.toast(sent.message || 'WhatsApp is ready with your verification code', 'success');
  },

  bindModal() {
    const root = document.getElementById('modal-root');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'stay-yes') {
        if (this._stayResolve) this._stayResolve(true);
        return;
      }
      if (act === 'stay-no' || act === 'modal-close') {
        if (this._stayResolve) this._stayResolve(false);
        else {
          this._deletePending = false;
          this.hideAuthModal();
        }
        return;
      }
      if (act === 'delete-account-confirm') {
        await this.confirmDeleteAccount();
      }
    });
  },

  async confirmDeleteAccount() {
    const pass = document.getElementById('del-pass')?.value || '';
    if (!pass) { this.toast('Enter your password first', 'error'); return; }
    const btn = document.querySelector('#modal-root [data-act="delete-account-confirm"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
    try {
      await OrderAPI.deleteAccount(this.token, pass);
      this._deletePending = false;
      this.hideAuthModal();
      this.clearSession();
      this.view = 'login';
      this.toast('Account deleted', 'success');
      this.render();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
      this.toast(err.message || 'Could not delete account', 'error');
    }
  },

  hideAuthModal() {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const foot = document.getElementById('modal-foot');
    if (title) title.textContent = '';
    if (body) body.innerHTML = '';
    if (foot) foot.innerHTML = '';
  },

  showPopup({ title, body, footer }) {
    const root = document.getElementById('modal-root');
    if (!root) return false;
    const t = document.getElementById('modal-title');
    const b = document.getElementById('modal-body');
    const f = document.getElementById('modal-foot');
    if (t) t.textContent = title || '';
    if (b) b.innerHTML = body || '';
    if (f) f.innerHTML = footer || '';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    return true;
  },

  persistSession(token, staySignedIn) {
    this.token = token || '';
    try { sessionStorage.setItem('order_token', this.token); } catch (_) { /* */ }
    try {
      if (staySignedIn && this.token) {
        localStorage.setItem('order_token', this.token);
        localStorage.setItem('order_stay_signed_in', '1');
        if (this.branch?.id) localStorage.setItem('order_branch', String(this.branch.id));
      } else {
        localStorage.removeItem('order_token');
        localStorage.removeItem('order_stay_signed_in');
      }
    } catch (_) { /* */ }
  },

  clearSession() {
    this.token = '';
    this.customer = null;
    this.loyaltyAccount = null;
    this._accountCache = null;
    this._ordersCache = null;
    try {
      sessionStorage.removeItem('order_token');
      localStorage.removeItem('order_token');
      localStorage.removeItem('order_stay_signed_in');
    } catch (_) { /* */ }
  },

  async tryAutofillLogin() {
    try {
      const savedId = localStorage.getItem('order_saved_login_id') || '';
      const idEl = document.getElementById('login-id');
      if (idEl && savedId && !idEl.value) idEl.value = savedId;
    } catch (_) { /* */ }
    if (!navigator.credentials?.get) return;
    try {
      const cred = await navigator.credentials.get({ password: true, mediation: 'optional' });
      if (!cred) return;
      const idEl = document.getElementById('login-id');
      const passEl = document.getElementById('login-pass');
      if (idEl && cred.id) idEl.value = cred.id;
      if (passEl && cred.password) passEl.value = cred.password;
    } catch (_) { /* */ }
  },

  async storeBrowserPassword(loginId, password, name) {
    if (!loginId || !password || !navigator.credentials || !window.PasswordCredential) return;
    try {
      await navigator.credentials.store(new PasswordCredential({
        id: String(loginId),
        password: String(password),
        name: name || 'Order Online'
      }));
    } catch (_) { /* browser declined */ }
  },

  askStaySignedIn(loginId, password) {
    return new Promise((resolve) => {
      this._stayResolve = (stay) => {
        this._stayResolve = null;
        this.hideAuthModal();
        resolve(!!stay);
      };
      const opened = this.showPopup({
        title: 'Save password?',
        body: `<p>Stay signed in on this phone so you can open Order Online without signing in again.</p>
          <p class="muted">Choose <strong>Save password</strong> to remember this login, or <strong>Not now</strong> if this is a shared phone (we’ll ask again next time you place an order).</p>`,
        footer: `<button type="button" class="btn-outline" data-act="stay-no">Not now</button>
          <button type="button" class="btn-primary" data-act="stay-yes">Save password</button>`
      });
      if (!opened) resolve(false);
      this._pendingCreds = { loginId, password };
    });
  },

  async finishSignIn({ token, customer, loginId, password, nextView }) {
    this.customer = customer || this.customer;
    this.token = token || '';
    try { sessionStorage.setItem('order_token', this.token); } catch (_) { /* */ }
    let stay = false;
    try {
      stay = await Promise.race([
        this.askStaySignedIn(loginId, password),
        new Promise((resolve) => setTimeout(() => resolve(false), 12000))
      ]);
    } catch (_) { stay = false; }
    this.persistSession(token, stay);
    if (stay) {
      try { localStorage.setItem('order_saved_login_id', String(loginId || '')); } catch (_) { /* */ }
      await this.storeBrowserPassword(loginId, password, customer?.first_name);
      this.clearAskSaveLater();
    } else {
      this.rememberAskSaveLater(loginId, password);
    }
    await this.refreshLoyaltyAccount();
    this.authReturn = null;
    if (!this.branch) {
      try { sessionStorage.removeItem('order_branch'); } catch (_) { /* */ }
      this.view = 'branches';
    } else {
      this.view = nextView || 'home';
    }
    this.toast(stay ? 'You are signed in — you won’t need to log in again on this phone' : 'You are signed in', 'success');
    this.render();
  },

  async refreshLoyaltyAccount() {
    if (!this.token) { this.loyaltyAccount = null; this.giftWallet = []; return; }
    try {
      const acct = await OrderAPI.account(this.token);
      const loyalty = acct?.loyalty || null;
      this.loyaltyAccount = {
        balance: Math.max(0, Math.floor(Number(loyalty?.balance) || 0)),
        value: Number(loyalty?.value) >= 0 ? Number(loyalty.value) : 0
      };
      // Recompute value if API omitted it
      if (!loyalty?.value && this.loyaltyAccount.balance) {
        const pv = this.loyaltySettings().point_value || 1;
        this.loyaltyAccount.value = this.loyaltyAccount.balance * pv;
      }
      this.giftWallet = acct?.wallet || [];
      this.customer = acct?.profile || this.customer;
    } catch (_) {
      if (!this.loyaltyAccount) this.loyaltyAccount = { balance: 0, value: 0 };
    }
  },

  loyaltySettings() {
    const ls = this.settings?.loyalty || {};
    const online = this.settings?.online || {};
    const onlineLoyaltyOff = online.loyalty_enabled === false || online.loyalty_enabled === 0 || online.loyalty_enabled === '0';
    return {
      enabled: ls.enabled !== false && !onlineLoyaltyOff,
      spend_amount: Number(ls.spend_amount) > 0 ? Number(ls.spend_amount) : 10,
      points_earned: Number(ls.points_earned) > 0 ? Number(ls.points_earned) : 1,
      point_value: Number(ls.point_value) > 0 ? Number(ls.point_value) : 1,
      min_sale_total: Number(ls.min_sale_total) || 0
    };
  },

  previewEarnPoints(total) {
    const ls = this.loyaltySettings();
    if (!ls.enabled) return 0;
    const t = Number(total) || 0;
    if (t < ls.min_sale_total) return 0;
    return Math.floor((t / ls.spend_amount) * ls.points_earned);
  },

  maxRedeemPoints(subtotal) {
    const ls = this.loyaltySettings();
    const bal = Math.floor(this.loyaltyAccount?.balance || 0);
    const preTax = Math.max(0, Number(subtotal) || 0);
    const maxByTotal = Math.floor(preTax / ls.point_value);
    return Math.min(bal, maxByTotal);
  },

  async loadApplyScript() {
    if (window.ApplyJobPage) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `/js/pages/apply-job.js?v=${Date.now()}`;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the job application form'));
      document.head.appendChild(s);
    });
  },

  openJobApplyPopup() {
    let overlay = document.getElementById('order-job-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'order-job-overlay';
      document.body.appendChild(overlay);
    }
    overlay.className = 'job-apply-overlay';
    overlay.innerHTML = `<div class="job-apply-sheet">
      <header class="job-apply-head">
        <button type="button" class="job-apply-cancel" id="order-job-cancel">Cancel</button>
        <strong>Apply for a job</strong>
        <span></span>
      </header>
      <div id="order-job-body" class="job-apply-body"><p class="muted">Loading application…</p></div>
    </div>`;
    document.body.classList.add('job-apply-open');
    overlay.querySelector('#order-job-cancel')?.addEventListener('click', () => this.closeJobApplyPopup());
    this.loadApplyScript().then(() => {
      window.ApplyJobPage.renderInto(document.getElementById('order-job-body'), {
        embedded: true,
        standalone: false,
        onSubmitted: () => this.closeJobApplyPopup(),
        onDeleted: () => this.closeJobApplyPopup()
      });
    }).catch((err) => {
      const body = document.getElementById('order-job-body');
      if (body) body.innerHTML = `<p class="muted">${this.esc(err.message)}</p>`;
    });
  },

  closeJobApplyPopup() {
    document.getElementById('order-job-overlay')?.remove();
    document.body.classList.remove('job-apply-open');
  },

  closeIssuePopup() {
    this.stopIssueCamera();
    document.getElementById('order-issue-overlay')?.remove();
    document.body.classList.remove('job-apply-open');
  },

  stopIssueCamera() {
    if (this._issueStream) {
      this._issueStream.getTracks().forEach((t) => t.stop());
      this._issueStream = null;
    }
  },

  async openIssueBackCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera is not available on this device');
    }
    const attempts = [
      { video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false }
    ];
    let lastErr;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Could not open the back camera');
  },

  compressIssuePhoto(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        let w = img.width || max;
        let h = img.height || max;
        if (w > max || h > max) {
          const scale = Math.min(max / w, max / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  },

  async openIssuePopup(opts = {}) {
    let overlay = document.getElementById('order-issue-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'order-issue-overlay';
      document.body.appendChild(overlay);
    }
    overlay.className = 'job-apply-overlay';
    const cachedOrders = this._ordersCache || [];
    const cachedReplies = (this.myIssues || []).filter((i) => i.admin_reply);
    const buildHtml = (orders, replies) => `<div class="job-apply-sheet">
      <header class="job-apply-head">
        <button type="button" class="job-apply-cancel" id="order-issue-cancel">Cancel</button>
        <strong>Report a problem</strong>
        <span></span>
      </header>
      <div class="job-apply-body">
        <p class="muted">Tell us what went wrong with an order or the app. You can attach a photo. If this is about an order, we will show which cashier took it on the POS.</p>
        <div class="field"><label>Your name *</label><input id="iss-name" value="${this.esc(this.customer?.first_name || '')}"></div>
        <div class="field"><label>Phone</label><input id="iss-phone" value="${this.esc(this.customer?.phone || '')}" placeholder="082…"></div>
        <div class="field"><label>Related order</label>
          <select id="iss-order"><option value="">${orders.length ? 'Latest / not sure' : 'Loading orders…'}</option>
          ${orders.map((o) => `<option value="${this.esc(o.id)}">#${this.esc(o.order_number || o.id)} · ${this.esc(o.status || '')}${o.cashier || o.accepted_by ? ` · POS: ${this.esc(o.cashier || o.accepted_by)}` : ''}</option>`).join('')}
          </select></div>
        <div class="field"><label>What was the problem? *</label><textarea id="iss-msg" rows="4" placeholder="Describe what happened…"></textarea></div>
        <div class="field"><label>Photo (optional)</label>
          <p class="muted" style="margin:0 0 8px">Upload a picture, or take one with the back camera.</p>
          <div class="issue-photo-actions">
            <button type="button" class="btn-primary" id="iss-take-photo">📷 Take photo</button>
            <button type="button" class="btn-ghost" id="iss-upload-photo">📁 Upload photo</button>
            <button type="button" class="btn-ghost hidden" id="iss-clear-photo">Remove photo</button>
          </div>
          <input type="file" id="iss-photo" accept="image/*" hidden>
          <div id="iss-camera-wrap" class="issue-camera-wrap hidden">
            <video id="iss-video" autoplay playsinline muted></video>
            <div class="issue-photo-actions" style="margin-top:8px">
              <button type="button" class="btn-primary" id="iss-snap">Capture photo</button>
              <button type="button" class="btn-ghost" id="iss-cancel-cam">Cancel camera</button>
            </div>
          </div>
          <img id="iss-preview" class="issue-photo-preview hidden" alt="Attached photo">
          <small class="muted" id="iss-photo-label"></small>
        </div>
        <button type="button" class="btn-primary" id="iss-send">Send to the shop</button>
        <p class="muted" id="iss-status"></p>
        ${replies.length ? `<h3 style="margin-top:24px">Replies from the shop</h3>
          ${replies.map((i) => `<div class="checkout-card" style="margin-bottom:10px">
            <p>${this.esc(i.message)}</p>
            ${i.pos_cashier_name ? `<p class="muted">POS cashier: ${this.esc(i.pos_cashier_name)}</p>` : ''}
            <p><strong>Shop reply:</strong> ${this.esc(i.admin_reply)}</p>
          </div>`).join('')}` : ''}
      </div>
    </div>`;

    // Open instantly with cache, then refresh order list
    overlay.innerHTML = buildHtml(cachedOrders, cachedReplies);
    document.body.classList.add('job-apply-open');

    overlay.querySelector('#order-issue-cancel')?.addEventListener('click', () => this.closeIssuePopup());
    let photoData = '';
    let photoName = '';
    const fileInput = overlay.querySelector('#iss-photo');
    const preview = overlay.querySelector('#iss-preview');
    const label = overlay.querySelector('#iss-photo-label');
    const camWrap = overlay.querySelector('#iss-camera-wrap');
    const video = overlay.querySelector('#iss-video');
    const clearBtn = overlay.querySelector('#iss-clear-photo');
    const showPreview = (dataUrl, name) => {
      photoData = dataUrl;
      photoName = name;
      if (preview) {
        preview.src = dataUrl;
        preview.classList.remove('hidden');
      }
      if (label) label.textContent = name || 'Photo attached';
      clearBtn?.classList.remove('hidden');
    };
    const hideCamera = () => {
      this.stopIssueCamera();
      camWrap?.classList.add('hidden');
      if (video) video.srcObject = null;
    };
    // Background refresh so the report form opens immediately
    if (this.token) {
      Promise.all([
        OrderAPI.listOrders(this.token, 20).catch(() => cachedOrders),
        OrderAPI.listMyIssues(this.token).catch(() => this.myIssues || [])
      ]).then(([orders, issues]) => {
        if (Array.isArray(orders)) this._ordersCache = orders;
        if (Array.isArray(issues)) this.myIssues = issues;
        const sel = overlay.querySelector('#iss-order');
        if (sel && Array.isArray(orders)) {
          sel.innerHTML = `<option value="">Latest / not sure</option>${orders.map((o) => `<option value="${this.esc(o.id)}">#${this.esc(o.order_number || o.id)} · ${this.esc(o.status || '')}${o.cashier || o.accepted_by ? ` · POS: ${this.esc(o.cashier || o.accepted_by)}` : ''}</option>`).join('')}`;
        }
      });
    }
    overlay.querySelector('#iss-upload-photo')?.addEventListener('click', () => {
      hideCamera();
      if (!fileInput) return;
      fileInput.removeAttribute('capture');
      fileInput.value = '';
      fileInput.click();
    });
    overlay.querySelector('#iss-take-photo')?.addEventListener('click', async () => {
      overlay.querySelector('#iss-status').textContent = '';
      try {
        this.stopIssueCamera();
        this._issueStream = await this.openIssueBackCamera();
        if (video) {
          video.srcObject = this._issueStream;
          await video.play();
        }
        camWrap?.classList.remove('hidden');
        preview?.classList.add('hidden');
      } catch (err) {
        hideCamera();
        if (fileInput) {
          fileInput.setAttribute('capture', 'environment');
          fileInput.value = '';
          fileInput.click();
        }
        overlay.querySelector('#iss-status').textContent = err.message || 'Could not open the back camera. Choose a photo instead.';
      }
    });
    overlay.querySelector('#iss-snap')?.addEventListener('click', async () => {
      if (!video?.videoWidth) {
        overlay.querySelector('#iss-status').textContent = 'Wait for the camera to open, then capture.';
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const raw = canvas.toDataURL('image/jpeg', 0.86);
      hideCamera();
      showPreview(await this.compressIssuePhoto(raw), `camera-${Date.now()}.jpg`);
    });
    overlay.querySelector('#iss-cancel-cam')?.addEventListener('click', hideCamera);
    overlay.querySelector('#iss-clear-photo')?.addEventListener('click', () => {
      photoData = '';
      photoName = '';
      if (fileInput) fileInput.value = '';
      if (preview) {
        preview.removeAttribute('src');
        preview.classList.add('hidden');
      }
      if (label) label.textContent = '';
      clearBtn?.classList.add('hidden');
      hideCamera();
    });
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        overlay.querySelector('#iss-status').textContent = 'Photo must be under 8MB.';
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        showPreview(await this.compressIssuePhoto(String(reader.result || '')), file.name);
      };
      reader.readAsDataURL(file);
    });
    overlay.querySelector('#iss-send')?.addEventListener('click', async () => {
      const name = overlay.querySelector('#iss-name').value.trim();
      const message = overlay.querySelector('#iss-msg').value.trim();
      const status = overlay.querySelector('#iss-status');
      if (!name || !message) {
        status.textContent = 'Name and the problem description are required.';
        return;
      }
      const btn = overlay.querySelector('#iss-send');
      btn.disabled = true;
      status.textContent = 'Sending…';
      try {
        const saved = await OrderAPI.submitIssue({
          name,
          phone: overlay.querySelector('#iss-phone').value.trim(),
          message,
          order_id: overlay.querySelector('#iss-order')?.value || '',
          photo_data: photoData || undefined,
          photo_name: photoName || undefined
        }, this.token || null);
        const cashier = saved?.pos_cashier_name;
        this.stopIssueCamera();
        overlay.querySelector('.job-apply-body').innerHTML = `<div style="background:#fff;border-radius:16px;padding:28px;text-align:center">
          <h2 style="margin:0 0 8px">Report sent</h2>
          <p class="muted">Thank you. The shop has your report${cashier ? ` and can see that <strong>${this.esc(cashier)}</strong> took the order on the POS` : ''}.</p>
        </div>`;
        setTimeout(() => this.closeIssuePopup(), 1800);
      } catch (err) {
        btn.disabled = false;
        status.textContent = err.message || 'Could not send.';
      }
    });
  },

  phoneLink(phone) {
    const p = String(phone || '').replace(/\D/g, '');
    return p ? `tel:${p}` : '#';
  },

  whatsappLink(phone, text) {
    const p = String(phone || '').replace(/\D/g, '');
    if (!p) return '#';
    const wa = p.startsWith('27') ? p : (p.startsWith('0') ? `27${p.slice(1)}` : p);
    const q = text ? `?text=${encodeURIComponent(text)}` : '';
    return `https://wa.me/${wa}${q}`;
  },

  contactHeaderHtml() {
    const phone = this.branch?.phone || this.settings?.phone;
    const wa = this.branch?.whatsapp || this.settings?.whatsapp_number || phone;
    const address = this.branch?.address || this.settings?.address;
    const branchName = this.branch?.name || this.settings?.shop_name;
    if (!branchName && !phone && !wa && !address) return '';
    return `<div class="shop-contact-bar">
      <img src="/api/logo" alt="" class="shop-contact-logo" onerror="this.style.display='none'">
      <div class="shop-contact-details">
        ${branchName ? `<strong>${this.esc(branchName)}</strong>` : ''}
        ${address ? `<span class="contact-addr">${this.esc(address)}</span>` : ''}
        ${phone ? `<span class="contact-phone">${this.esc(phone)}</span>` : ''}
      </div>
      <div class="shop-contact-actions">
        ${phone ? `<a href="${this.phoneLink(phone)}" class="contact-icon" aria-label="Call">📞</a>` : ''}
        ${wa ? `<a href="${this.whatsappLink(wa)}" target="_blank" rel="noopener" class="contact-icon" aria-label="WhatsApp">💬</a>` : ''}
      </div>
    </div>`;
  },

  firstOnlineGiftHtml(gift) {
    if (!gift?.gift_card_code) return '';
    return `<div class="first-gift-banner">
      <h2>🎉 Congratulations!</h2>
      <p>You are one of today's first online customers!</p>
      <p>You've received a <strong>${this.money(gift.amount)}</strong> Gift Card${gift.position ? ` · Winner #${gift.position}` : ''}.</p>
      <p class="muted" style="margin:8px 0 4px">Your Gift Card Code:</p>
      <code class="gift-code first-gift-code">${this.esc(gift.gift_card_code)}</code>
      <button type="button" class="btn-primary" data-act="copy-gift" data-code="${this.esc(gift.gift_card_code)}" style="margin-top:12px">Copy Gift Card</button>
      <p class="muted" style="margin:10px 0 0">Use this gift card during your next checkout. It is also saved under My Gift Cards.</p>
    </div>`;
  },

  giftWalletHtml() {
    if (!this.token) return '';
    if (!this.giftWallet?.length) {
      return `<div class="loyalty-card gift-wallet-card"><h3>🎁 My Gift Cards</h3><p class="muted" style="margin:0">No gift cards yet. Apply a code at checkout.</p></div>`;
    }
    return `<div class="loyalty-card gift-wallet-card">
      <h3>🎁 My Gift Cards</h3>
      ${this.giftWallet.map((g) => `<div class="gift-wallet-row">
        <div><code class="gift-code" data-gift-code="${this.esc(g.code)}">${this.esc(g.code)}</code>
        <button type="button" class="btn-sm" data-act="copy-gift" data-code="${this.esc(g.code)}">Copy</button></div>
        <strong>${this.money(g.balance)}</strong>
        ${g.expires_at ? `<div class="muted" style="font-size:12px">Expires ${this.esc(String(g.expires_at).slice(0, 10))}</div>` : ''}
      </div>`).join('')}
    </div>`;
  },

  trackingTimelineHtml(steps) {
    if (!steps?.length) return '';
    return `<ul class="track-timeline">${steps.map((s) =>
      `<li class="${s.done ? 'done' : ''} ${s.active ? 'active' : ''}"><strong>${this.esc(s.label)}</strong></li>`
    ).join('')}</ul>`;
  },

  checkoutCartHtml() {
    if (!this.cart.length) return '<p class="muted">Your cart is empty.</p>';
    return this.cart.map((c) => {
      const compText = (c.combo_components || []).map((ci) => {
        const base = `${ci.product_name || 'Item'}`;
        return ci.modifiers_text ? `${base} (${ci.modifiers_text})` : base;
      }).join('; ');
      const modLine = compText || (c.modifiers?.length ? c.modifiers.map((m) => m.name).join(', ') : '');
      return `<div class="cart-line">
          <div><strong>${this.esc(c.name)}</strong><div class="muted">× ${c.quantity}${modLine ? ` · ${this.esc(modLine)}` : ''} · ${this.money((c.unit_price || 0) * c.quantity)}</div></div>
          <div class="cart-actions">
            <button type="button" data-act="cart-dec" data-key="${c._key}">−</button>
            <span>${c.quantity}</span>
            <button type="button" data-act="cart-inc" data-key="${c._key}">+</button>
            <button type="button" class="link-btn" data-act="cart-edit" data-key="${c._key}">Edit</button>
            <button type="button" class="link-btn" data-act="cart-remove" data-key="${c._key}">Remove</button>
          </div></div>`;
    }).join('');
  },

  saveCart() {
    try { localStorage.setItem('order_cart', JSON.stringify(this.cart)); } catch (_) { /* ignore */ }
  },

  loadCart() {
    try {
      const raw = localStorage.getItem('order_cart');
      if (raw) this.cart = JSON.parse(raw) || [];
    } catch (_) { this.cart = []; }
  },

  async init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    this.hideAuthModal();
    this.bindModal();
    try {
      this.token = localStorage.getItem('order_token') || sessionStorage.getItem('order_token') || '';
    } catch (_) {
      this.token = sessionStorage.getItem('order_token') || '';
    }
    const savedCat = sessionStorage.getItem('order_category');
    if (savedCat != null && savedCat !== '') this.categoryId = savedCat;
    const savedSearch = sessionStorage.getItem('order_search');
    if (savedSearch) this.search = savedSearch;
    try {
      this.settings = await OrderAPI.getSettings();
      const shopName = String(this.settings?.shop_name || '').trim() || 'Order Online';
      document.title = `${shopName} | Online Ordering`;
      try {
        let link = document.querySelector('link[rel="icon"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = '/api/logo';
      } catch (_) { /* */ }
      this.startHoursWatch();
      if (window.PanelNotify && !this._notifyReady) {
        this._notifyReady = true;
        PanelNotify.init({
          panel: 'online',
          loggedIn: () => !!this.token,
          rpc: (method, args) => OrderAPI.call(method, args)
        });
      }
      if (this.token) {
        try {
          const acct = await OrderAPI.account(this.token);
          this.customer = acct.profile;
          this.loyaltyAccount = acct.loyalty || null;
        } catch (_) { this.clearSession(); }
      }
      const savedBranch = localStorage.getItem('order_branch') || sessionStorage.getItem('order_branch');
      if (savedBranch) {
        const branches = await OrderAPI.getBranches();
        this.branch = branches.find((b) => String(b.id) === savedBranch) || null;
        if (!this.branch) sessionStorage.removeItem('order_branch');
      }
      if (this.branch) this.loadCart();
      if (!this.token) {
        this.view = 'login';
      } else if (!this.branch) {
        this.view = 'branches';
      } else {
        const savedView = sessionStorage.getItem('order_view');
        const safeViews = ['home', 'menu', 'account', 'orders', 'checkout', 'branches'];
        if (savedView === 'product') {
          const savedPid = sessionStorage.getItem('order_product_id');
          if (savedPid) {
            try {
              this.product = await OrderAPI.getProduct(this.branch.id, savedPid);
              this.view = 'product';
            } catch (_) {
              sessionStorage.removeItem('order_product_id');
              this.view = 'menu';
            }
          } else {
            this.view = 'menu';
          }
        } else {
          this.view = savedView && safeViews.includes(savedView) ? savedView : 'home';
        }
      }
      try {
        this.openJobs = await OrderAPI.listPublicJobs() || [];
      } catch (_) {
        this.openJobs = [];
      }
      if (this.token) {
        try { this.myIssues = await OrderAPI.listMyIssues(this.token) || []; } catch (_) { this.myIssues = []; }
      }

      // Return from hosted payment gateway — never trust success URL alone; poll server
      try {
        const params = new URLSearchParams(window.location.search || '');
        const ref = (params.get('ref') || '').trim();
        if (ref) {
          try {
            localStorage.setItem('order_ref', ref);
            sessionStorage.setItem('order_ref', ref);
          } catch (_) { /* ignore */ }
          this.referralCode = ref.toUpperCase();
          try { OrderAPI.recordReferralClick?.(ref); } catch (_) { /* optional */ }
          try { fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'referral:recordClick', params: [ref, {}] }) }).catch(() => {}); } catch (_) { /* ignore */ }
        } else {
          try {
            this.referralCode = (sessionStorage.getItem('order_ref') || localStorage.getItem('order_ref') || '').toUpperCase() || null;
          } catch (_) { this.referralCode = null; }
        }
        if (params.get('payment') === 'return' && params.get('order')) {
          this.paymentReturn = {
            orderNumber: params.get('order'),
            returnStatus: params.get('status') || 'success'
          };
          this.view = 'payment-pending';
          history.replaceState({}, '', window.location.pathname + (window.location.hash || ''));
        }
      } catch (_) { /* */ }

      await this.render();
      if (this.branch) {
        this.loadMenu();
        this.startMenuLiveSync();
      }
    } catch (err) {
      document.getElementById('app').innerHTML = `<div class="empty-state"><h2>Unable to connect</h2><p>${this.esc(err.message)}</p><button type="button" class="btn-primary" onclick="location.reload()">Retry</button></div>`;
    }
  },

  startMenuLiveSync() {
    if (this._menuLiveSyncStarted) return;
    this._menuLiveSyncStarted = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.branch) return;
      if (!['home', 'menu', 'product'].includes(this.view)) return;
      this.loadMenu({ force: true, preserveScroll: true });
    });
    this._menuLiveTimer = setInterval(() => {
      if (!this.branch) return;
      if (!['home', 'menu', 'product'].includes(this.view)) return;
      this.loadMenu({ force: true, preserveScroll: true });
    }, 4000);
    window.addEventListener('storage', (e) => {
      if (e.key !== 'shop-pos-catalog-ts' || !e.newValue) return;
      if (!this.branch) return;
      if (!['home', 'menu', 'product'].includes(this.view)) return;
      this.loadMenu({ force: true, preserveScroll: true });
    });
  },

  async loadMenu(opts = {}) {
    if (!this.branch) return;
    const force = !!opts.force;
    const scrollEl = document.querySelector('.category-scroll');
    const scrollLeft = opts.preserveScroll !== false && scrollEl ? scrollEl.scrollLeft : null;
    const branchChanged = this._menuBranchId !== this.branch.id;
    if (!force && !branchChanged && this._menuFull && !this.search) {
      this.applyMenuFilter();
      this.updateMenuDom(scrollLeft);
      return;
    }
    if (this._menuLoadPromise && !force && !branchChanged) {
      await this._menuLoadPromise;
      this.applyMenuFilter();
      this.updateMenuDom(scrollLeft);
      return;
    }
    this._menuLoadPromise = OrderAPI.getMenu(this.branch.id, this.search ? { q: this.search } : {})
      .then((menu) => {
        this._menuFull = menu;
        this._menuBranchId = this.branch.id;
        this.applyMenuFilter();
      })
      .finally(() => { this._menuLoadPromise = null; });
    try {
      await this._menuLoadPromise;
      this.updateMenuDom(scrollLeft);
      this.prefetchMenuImages(this.menu?.products || []);
    } catch (err) { this.toast(err.message, 'error'); }
  },

  prefetchMenuImages(products, limit = 80) {
    const urls = [];
    for (const p of products || []) {
      if (p.image) urls.push(p.image);
      if (p.combo_thumbs?.length) urls.push(...p.combo_thumbs);
      if (urls.length >= limit) break;
    }
    const unique = [...new Set(urls)].slice(0, limit);
    unique.forEach((url, i) => {
      if (i < 12 && !document.querySelector(`link[rel="preload"][href="${CSS.escape ? CSS.escape(url) : url}"]`)) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = url;
        document.head.appendChild(link);
      }
      const img = new Image();
      img.decoding = 'async';
      img.fetchPriority = i < 16 ? 'high' : 'low';
      img.src = url;
    });
  },

  filterMenuProducts(allProducts, categoryId, search) {
    let list = allProducts || [];
    const cat = categoryId != null && categoryId !== '' ? String(categoryId) : '';
    const today = new Date().toLocaleDateString('en-CA');
    if (cat === 'combos') {
      list = list.filter((p) => p.is_combo);
    } else if (cat.startsWith('__')) {
      if (cat === '__available_today') list = list.filter((p) => p.available_today);
      else if (cat === '__new_arrival') list = list.filter((p) => p.is_new_arrival && (!p.new_arrival_until || p.new_arrival_until >= today));
      else if (cat === '__best_seller') list = list.filter((p) => p.is_best_seller);
      else if (cat === '__today_special') list = list.filter((p) => p.on_sale);
    } else if (cat) {
      list = list.filter((p) => String(p.category_id) === cat && !p.is_combo);
    }
    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  },

  applyMenuFilter() {
    if (!this._menuFull) return;
    this._sanitizeCategoryFilter();
    const products = this.filterMenuProducts(this._menuFull.products || [], this.categoryId, this.search);
    const categories = (this._menuFull.categories || []).length
      ? this._menuFull.categories
      : this._categoriesFromProducts(this._menuFull.products || []);
    this.menu = { ...this._menuFull, products, categories };
  },

  _sanitizeCategoryFilter() {
    const cat = this.categoryId != null ? String(this.categoryId) : '';
    if (!cat.startsWith('__')) return;
    const tabIds = new Set((this._menuFull?.menu_tabs || []).map((t) => String(t.id)));
    if (!tabIds.has(cat)) {
      this.categoryId = null;
      try { sessionStorage.removeItem('order_category'); } catch (_) { /* ignore */ }
    }
  },

  _categoriesFromProducts(products) {
    const seen = new Map();
    for (const p of products || []) {
      if (p.is_combo) continue;
      const id = p.category_id;
      if (id == null || id === '') continue;
      const key = String(id);
      if (!seen.has(key)) seen.set(key, { id: p.category_id, name: p.category_name || `Category ${key}` });
    }
    return [...seen.values()];
  },

  updateMenuDom(scrollLeft) {
    if (this.view !== 'home' && this.view !== 'menu') return;
    if (this.view === 'menu') {
      const grid = document.querySelector('.product-grid');
      if (grid) {
        const products = this.menu?.products || [];
        grid.innerHTML = products.map((p, idx) => this.productCard(p, idx)).join('') || '<p class="muted">No products found.</p>';
        this.syncCategoryChips();
        requestAnimationFrame(() => this.restoreCategoryScroll(scrollLeft));
        return;
      }
    }
    this.render();
  },

  syncCategoryChips() {
    const activeCat = this.categoryId != null ? String(this.categoryId) : '';
    document.querySelectorAll('[data-cat-id]').forEach((el) => {
      const id = el.dataset.catId != null ? String(el.dataset.catId) : '';
      el.classList.toggle('active', id === activeCat);
    });
  },

  restoreCategoryScroll(scrollLeft) {
    const el = document.querySelector('.category-scroll');
    if (!el) return;
    if (scrollLeft != null) el.scrollLeft = scrollLeft;
    const active = el.querySelector('.cat-chip.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
  },

  updateCartUi() {
    const count = this.cartCount();
    document.querySelectorAll('.cart-fab').forEach((fab) => {
      let badge = fab.querySelector('.cart-badge');
      if (count) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'cart-badge';
          fab.insertBefore(badge, fab.firstChild);
        }
        badge.textContent = String(count);
      } else if (badge) badge.remove();
    });
  },

  cartCount() { return this.cart.reduce((s, i) => s + i.quantity, 0); },

  addToCart(item) {
    const key = item.combo_id
      ? `combo:${item.combo_id}:${JSON.stringify(item.combo_components || [])}`
      : `${item.product_id}:${JSON.stringify(item.modifiers || [])}`;
    const existing = this.cart.find((c) => c._key === key);
    if (existing) existing.quantity += item.quantity || 1;
    else this.cart.push({ ...item, _key: key });
    this.saveCart();
    try {
      window.WebTracker?.track?.('add_to_cart', {
        page: 'menu',
        page_label: 'Menu',
        product_id: item.product_id || item.combo_id,
        product_name: item.name
      });
    } catch (_) { /* */ }
    this.toast('Added to cart', 'success');
    if (this.view === 'menu' || this.view === 'home') this.updateCartUi();
    else this.render();
  },

  updateCartQty(key, delta) {
    const item = this.cart.find((c) => c._key === key);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) this.cart = this.cart.filter((c) => c._key !== key);
    this.saveCart();
    if (this.view === 'cart') this.render();
    else this.updateCartUi();
  },

  async validateCurrentCart() {
    if (!this.branch || !this.cart.length) return null;
    return OrderAPI.validateCart(this.branch.id, {
      items: this.cart.map((c) => ({
        product_id: c.combo_id ? `combo-${c.combo_id}` : c.product_id,
        combo_id: c.combo_id || undefined,
        quantity: c.quantity,
        modifiers: c.modifiers,
        combo_components: c.combo_components || undefined
      })),
      fulfillment_type: this.checkout.fulfillment_type,
      delivery_place_id: this.checkout.delivery_place_id || undefined,
      delivery_place: this.checkout.delivery_place || undefined,
      coupon_code: this.checkout.coupon_code || undefined,
      loyalty_points_used: this.checkout.loyalty_points_used || 0,
      gift_card_code: this.checkout.gift_card_code || undefined,
      web_customer_id: this.customer?.id
    });
  },

  bindModifierInputs() {
    document.querySelectorAll('[data-type="radio-optional"] input[type="radio"]').forEach((input) => {
      input.addEventListener('mousedown', function () {
        this._prevChecked = this.checked;
      });
      input.addEventListener('click', function (e) {
        if (this._prevChecked) {
          this.checked = false;
          this._prevChecked = false;
          e.preventDefault();
        } else {
          this._prevChecked = true;
        }
      });
    });
    const p = this.product;
    if (p?.on_sale && !p?.is_combo) {
      document.querySelectorAll('input[data-mod-type="removal"]').forEach((input) => {
        input.addEventListener('change', async () => {
          if (!input.checked) return;
          input.checked = false;
          const choice = await this.confirmWithoutOptionPrice({
            optionName: input.dataset.name || 'Without pap',
            salePrice: Number(p.sale_price ?? p.price) || 0,
            normalPrice: Number(p.price) || 0,
            isCombo: false
          });
          if (choice === 'normal') input.checked = true;
          this.updateProductPricePreview();
        });
      });
    }
    if (p?.is_combo) {
      document.querySelectorAll('[data-combo-item] input[data-mod-type="removal"]').forEach((input) => {
        input.addEventListener('change', async () => {
          if (!input.checked) {
            delete input.dataset.priceConfirmed;
            this.updateComboPricePreview();
            return;
          }
          input.checked = false;
          const choice = await this.confirmWithoutOptionPrice({
            optionName: input.dataset.name || 'Without pap',
            salePrice: Number(p.sale_price ?? p.price) || 0,
            normalPrice: Number(p.price) || 0,
            isCombo: true
          });
          if (choice === 'normal') {
            input.checked = true;
            input.dataset.priceConfirmed = '1';
          } else {
            input.checked = false;
            delete input.dataset.priceConfirmed;
          }
          this.updateComboPricePreview();
        });
      });
    }
    document.querySelectorAll('[data-mod-group] input').forEach((input) => {
      input.addEventListener('change', () => {
        if (p?.is_combo) this.updateComboPricePreview();
        else this.updateProductPricePreview();
      });
    });
  },

  updateComboPricePreview() {
    const el = document.getElementById('live-prod-price');
    if (!el || !this.product?.is_combo) return;
    try {
      const comboComponents = [];
      document.querySelectorAll('[data-combo-item]').forEach((section) => {
        comboComponents.push({ modifiers: this.collectModifiersFromDom(section) });
      });
      el.textContent = this.money(this.calcComboUnitPrice(this.product, comboComponents));
    } catch (_) { /* ignore */ }
  },

  updateProductPricePreview() {
    const el = document.getElementById('live-prod-price');
    if (!el || !this.product || this.product.is_combo) return;
    try {
      const mods = this.collectModifiersFromDom(document.getElementById('app'));
      const price = this.calcPromoUnitPrice(this.product, mods);
      el.textContent = this.money(price);
    } catch (_) { /* ignore */ }
  },

  bind() {
    try {
      const special = !!(this.product?.on_sale || this.product?.is_special);
      window.WebTracker?.trackView?.(this.view, {
        page_label: this.view === 'product' ? (this.product?.name || 'Product') : this.view,
        product_id: this.product?.id || this.product?.product_id,
        product_name: this.product?.name,
        special
      });
    } catch (_) { /* analytics optional */ }
    const app = document.getElementById('app');
    app.onclick = async (e) => {
      const actBtn = e.target.closest('[data-act="add-cart"], [data-act="quick-add"]');
      const productCard = e.target.closest('.product-card[data-product-id]');
      if (productCard && !actBtn) {
        const pid = productCard.dataset.productId;
        this.editingCartKey = null;
        const cached = this.findMenuProduct(pid);
        if (cached) {
          this.product = cached;
          this.view = 'product';
          this.render();
          OrderAPI.getProduct(this.branch.id, pid).then((full) => {
            if (this.view === 'product' && String(this.product?.id || this.product?.product_id) === String(pid)) {
              this.product = full;
              this.render();
            }
          }).catch(() => { /* keep cached product */ });
          return;
        }
        productCard.classList.add('is-loading');
        try {
          this.product = await OrderAPI.getProduct(this.branch.id, pid);
          this.view = 'product';
          this.render();
        } catch (err) {
          this.toast(err.message || 'Could not open product', 'error');
        } finally {
          productCard.classList.remove('is-loading');
        }
        return;
      }
      const catChip = e.target.closest('[data-cat-id]');
      if (catChip) {
        this.categoryId = catChip.dataset.catId || null;
        try { sessionStorage.setItem('order_category', this.categoryId || ''); } catch (_) { /* */ }
        document.querySelectorAll('[data-cat-id]').forEach((el) => el.classList.toggle('active', el === catChip));
        this.applyMenuFilter();
        this.updateMenuDom(catChip.closest('.category-scroll')?.scrollLeft ?? null);
        return;
      }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'nav') {
        const next = btn.dataset.view;
        if (!this.token && !this.isAuthView(next)) {
          this.view = 'login';
          this.authReturn = next;
          this.render();
          return;
        }
        this.view = next;
        // Instant tab paint for Orders / Account (far-right) — use cache then refresh
        if (this.view === 'orders' || this.view === 'account') {
          this.render();
          return;
        }
        if (this.view === 'menu') {
          if (this._menuFull && this._menuBranchId === this.branch?.id) {
            this.applyMenuFilter();
            this.render();
          } else {
            this.render();
            this.loadMenu();
          }
        } else this.render();
        return;
      }
      if (act === 'job-apply') {
        if (!this.isShopOpenNow()) { this.toast('Hiring is closed while the shop is closed for online orders', 'error'); return; }
        this.openJobApplyPopup();
        return;
      }
      if (act === 'job-apply-close') { this.closeJobApplyPopup(); return; }
      if (act === 'issue-report') {
        if (!this.isShopOpenNow()) { this.toast('Customer reports are closed while the shop is closed for online orders', 'error'); return; }
        // Open immediately — load order list inside without blocking the first paint
        this.openIssuePopup({ fast: true });
        return;
      }
      if (act === 'back') { this.goBack(); return; }
      if (act === 'view-order') {
        const orderId = btn.dataset.id;
        if (!orderId || !this.token) return;
        btn.disabled = true;
        try {
          this.selectedOrder = await OrderAPI.getOrder(orderId, this.token);
          this.view = 'order-detail';
          this.render();
          this.startOrderPolling();
        } catch (err) {
          this.toast(err.message, 'error');
        } finally {
          btn.disabled = false;
        }
        return;
      }
      if (act === 'cart-edit') {
        const key = btn.dataset.key;
        const line = this.cart.find((c) => c._key === key);
        if (!line) return;
        this.editingCartKey = key;
        const ref = line.combo_id ? `combo-${line.combo_id}` : line.product_id;
        this.product = await OrderAPI.getProduct(this.branch.id, ref);
        this.view = 'product';
        this.render();
        return;
      }
      if (act === 'pick-branch') {
        const id = btn.dataset.id;
        if (this.cart.length) {
          if (!confirm('Changing branch may remove unavailable items. Continue?')) return;
          this.cart = [];
        }
        const branches = await OrderAPI.getBranches();
        this.branch = branches.find((b) => String(b.id) === id);
        sessionStorage.setItem('order_branch', id);
        try {
          if (localStorage.getItem('order_stay_signed_in') === '1') localStorage.setItem('order_branch', id);
        } catch (_) { /* */ }
        this._menuFull = null;
        this._menuBranchId = null;
        this.view = 'home';
        await this.loadMenu();
        this.render();
        return;
      }
      if (act === 'open-product') {
        const pid = btn.dataset.id;
        this.product = await OrderAPI.getProduct(this.branch.id, pid);
        this.editingCartKey = null;
        this.view = 'product';
        try { sessionStorage.setItem('order_product_id', String(pid)); } catch (_) { /* ignore */ }
        this.render();
        return;
      }
      if (act === 'quick-add') {
        const pid = btn.dataset.id;
        const isCombo = btn.dataset.combo === '1';
        const p = isCombo
          ? await OrderAPI.getProduct(this.branch.id, pid)
          : (this.menu?.products || []).find((x) => String(x.id) === String(pid));
        if (!p?.available) return;
        if (p.has_modifiers && !p.is_combo) {
          this.product = p.is_combo ? p : await OrderAPI.getProduct(this.branch.id, pid);
          this.view = 'product';
          this.render();
          return;
        }
        const price = p.sale_price ?? p.price;
        this.addToCart({
          product_id: p.is_combo ? null : p.id,
          combo_id: p.is_combo ? p.combo_id : null,
          name: p.name,
          quantity: 1,
          modifiers: [],
          unit_price: price
        });
        return;
      }
      if (act === 'add-cart') {
        const pid = Number(btn.dataset.id);
        const qty = Number(document.getElementById('prod-qty')?.value || 1);
        try {
          if (this.editingCartKey) {
            this.cart = this.cart.filter((c) => c._key !== this.editingCartKey);
            this.editingCartKey = null;
          }
          if (this.product.is_combo) {
            if (!this.product.available) throw new Error('This combo is not available');
            for (const section of document.querySelectorAll('[data-combo-item]')) {
              for (const input of section.querySelectorAll('input[data-mod-type="removal"]:checked')) {
                if (input.dataset.priceConfirmed !== '1') {
                  const choice = await this.confirmWithoutOptionPrice({
                    optionName: input.dataset.name || 'Without pap',
                    salePrice: Number(this.product.sale_price ?? this.product.price) || 0,
                    normalPrice: Number(this.product.price) || 0,
                    isCombo: true
                  });
                  if (choice === 'normal') {
                    input.checked = true;
                    input.dataset.priceConfirmed = '1';
                  } else if (choice === 'sale') {
                    input.checked = false;
                    delete input.dataset.priceConfirmed;
                  } else {
                    throw new Error('Confirm the pap price to add this combo');
                  }
                }
              }
            }
            const finalComponents = (this.product.combo_items || []).map((ci, idx) => {
              const section = document.querySelector(`[data-combo-item="${ci.product_id}"]`)
                || document.querySelector(`[data-combo-item="idx-${idx}"]`);
              const mods = section ? this.collectModifiersFromDom(section) : [];
              return {
                product_id: ci.product_id,
                product_name: ci.product_name || 'Item',
                quantity: Number(ci.quantity) || 1,
                modifiers: mods,
                modifiers_text: mods.map((m) => m.name).join(', ')
              };
            });
            this.addToCart({
              product_id: null,
              combo_id: this.product.combo_id,
              name: this.product.name,
              quantity: qty,
              modifiers: [],
              combo_components: finalComponents,
              unit_price: this.calcComboUnitPrice(this.product, finalComponents)
            });
          } else {
            const mods = this.collectModifiersFromDom(document.getElementById('app'));
            const unitPrice = this.calcPromoUnitPrice(this.product, mods);
            this.addToCart({
              product_id: pid,
              combo_id: null,
              name: this.product.name,
              quantity: qty,
              modifiers: mods,
              unit_price: unitPrice
            });
          }
          this.view = 'menu';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
        return;
      }
      if (act === 'cart-inc') {
        e.preventDefault();
        this.updateCartQty(btn.dataset.key, 1);
        if (this.view === 'checkout') {
          this.quote = await this.validateCurrentCart();
          this.render();
        }
        return;
      }
      if (act === 'cart-dec') {
        e.preventDefault();
        this.updateCartQty(btn.dataset.key, -1);
        if (this.view === 'checkout') {
          this.quote = await this.validateCurrentCart();
          this.render();
        }
        return;
      }
      if (act === 'cart-remove') {
        e.preventDefault();
        this.cart = this.cart.filter((c) => c._key !== btn.dataset.key);
        this.saveCart();
        if (this.view === 'checkout') {
          this.quote = await this.validateCurrentCart();
        }
        this.render();
        return;
      }
      if (act === 'checkout') {
        if (!this.isShopOpenNow()) { this.toast('We are closed for online orders right now', 'error'); this.render(); return; }
        if (!this.token) { this.view = 'register'; this.authReturn = 'checkout'; this.render(); return; }
        // Instant navigation — validate in background so checkout feels immediate
        this.view = 'checkout';
        this.render();
        this.validateCurrentCart().then((q) => {
          this.quote = q;
          if (this.quote && !this.quote.valid) {
            const gcIssue = (this.quote.errors || []).some((msg) => /gift card/i.test(msg));
            if (gcIssue && this.checkout.gift_card_code) {
              this.checkout.gift_card_code = '';
              this.toast('Gift card removed — no balance remaining on that code', 'warning');
              return this.validateCurrentCart().then((q2) => { this.quote = q2; });
            }
          }
        }).then(() => {
          if (this.view !== 'checkout') return;
          if (this.quote && !this.quote.valid) {
            this.toast((this.quote.errors || []).join('; ') || 'Cart needs attention', 'error');
            this.view = 'cart';
            this.render();
            return;
          }
          this.refreshLoyaltyAccount().catch(() => {});
          this.render();
        }).catch(() => {});
        return;
      }
      if (act === 'copy-gift' || act === 'copy-code') {
        const code = btn.dataset.code || '';
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          this.toast(act === 'copy-code' ? 'Handoff code copied' : 'Gift card code copied', 'success');
        } catch (_) {
          this.toast(code, 'info');
        }
        return;
      }
      if (act === 'apply-gift-card') {
        const code = document.getElementById('gift-card-code')?.value.trim().toUpperCase() || '';
        if (!code) {
          this.checkout.gift_card_code = '';
          this.quote = await this.validateCurrentCart();
          this.render();
          return;
        }
        try {
          const card = await OrderAPI.checkGiftCard(code, this.token);
          this.checkout.gift_card_code = card.code || code;
          this.quote = await this.validateCurrentCart();
          if (this.quote?.errors?.length) {
            this.toast(this.quote.errors.join('; '), 'error');
            this.checkout.gift_card_code = '';
            this.quote = await this.validateCurrentCart();
          } else {
            this.toast(`Gift card ${card.code} — ${this.money(card.balance)} available`, 'success');
          }
        } catch (err) {
          this.checkout.gift_card_code = '';
          this.toast(err.message || 'Invalid gift card', 'error');
        }
        this.render();
        return;
      }
      if (act === 'apply-coupon') {
        const code = document.getElementById('coupon-code')?.value.trim().toUpperCase() || '';
        this.checkout.coupon_code = code;
        if (code) {
          this.referralCode = code;
          try {
            localStorage.setItem('order_ref', code);
            sessionStorage.setItem('order_ref', code);
          } catch (_) { /* */ }
        }
        this.quote = await this.validateCurrentCart();
        this.render();
        return;
      }
      if (act === 'apply-loyalty') {
        const max = this.maxRedeemPoints(this.quote?.subtotal || 0);
        const val = Math.min(max, Math.max(0, parseInt(document.getElementById('loyalty-points')?.value || '0', 10) || 0));
        this.checkout.loyalty_points_used = val;
        this.quote = await this.validateCurrentCart();
        this.render();
        return;
      }
      if (act === 'loyalty-max') {
        this.checkout.loyalty_points_used = this.maxRedeemPoints(this.quote?.subtotal || 0);
        this.quote = await this.validateCurrentCart();
        this.render();
        return;
      }
      if (act === 'place-order') {
        if (!this.isShopOpenNow()) { this.toast('We are closed for online orders right now', 'error'); return; }
        const btn2 = btn;
        btn2.disabled = true;
        const prevLabel = btn2.textContent;
        btn2.textContent = 'Placing order…';
        try {
          if (!this.cart.length) { this.toast('Your cart is empty', 'error'); return; }
          await this.maybeAskSavePasswordOnOrder();
          this.checkout.loyalty_points_used = parseInt(document.getElementById('loyalty-points')?.value || String(this.checkout.loyalty_points_used || 0), 10) || 0;
          const idem = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          this.checkout.fulfillment_type = document.querySelector('input[name=fulfillment]:checked')?.value || 'collection';
          this.checkout.payment_method = document.querySelector('input[name=payment_method]:checked')?.value || 'card';
          this.checkout.delivery_address = document.getElementById('delivery-address')?.value || '';
          const placeRadio = document.querySelector('input[name=delivery_place]:checked');
          if (placeRadio) {
            this.checkout.delivery_place_id = placeRadio.value;
            this.checkout.delivery_place = placeRadio.dataset.name || '';
          }
          this.checkout.notes = document.getElementById('order-notes')?.value || '';
          this.checkout.gift_card_code = document.getElementById('gift-card-code')?.value.trim().toUpperCase() || this.checkout.gift_card_code || '';
          const enteredCode = (document.getElementById('coupon-code')?.value || this.checkout.coupon_code || this.referralCode || '').trim().toUpperCase();
          if (enteredCode) {
            this.checkout.coupon_code = enteredCode;
            this.referralCode = enteredCode;
            try {
              localStorage.setItem('order_ref', enteredCode);
              sessionStorage.setItem('order_ref', enteredCode);
            } catch (_) { /* */ }
          }
          const orderPayload = {
            ...this.checkout,
            coupon_code: enteredCode || this.checkout.coupon_code || null,
            referral_code: enteredCode || this.referralCode || null,
            items: this.cart.map((c) => ({
              product_id: c.combo_id ? `combo-${c.combo_id}` : c.product_id,
              combo_id: c.combo_id || undefined,
              quantity: c.quantity,
              modifiers: c.modifiers || []
            }))
          };
          const payMethod = String(this.checkout.payment_method || 'card').toLowerCase();
          const gatewayPay = payMethod === 'pay_online' || payMethod === 'yoco';
          const cardLike = !gatewayPay && ['card', 'snapscan', 'mobile'].includes(payMethod);
          if (cardLike) {
            this.quote = this.quote || await this.validateCurrentCart();
            const total = Number(this.quote?.total || 0);
            const intent = await OrderAPI.initiateCardPayment(this.branch.id, total, this.token, payMethod);
            const ref = `TEST-${intent.intent_token.slice(0, 12)}`;
            await OrderAPI.confirmCardPayment(intent.intent_token, ref);
            orderPayload.payment_intent_token = intent.intent_token;
            orderPayload.expected_total = total;
          }
          this.lastOrder = await OrderAPI.submitOrder(this.branch.id, orderPayload, this.token, idem);
          if (gatewayPay) {
            const pay = await OrderAPI.startOnlinePayment(this.lastOrder.id, this.token);
            const redirect = pay?.redirect_url || pay?.data?.redirect_url;
            if (!redirect) throw new Error('Could not start online payment');
            this.cart = [];
            this.saveCart();
            window.location.href = redirect;
            return;
          }
          this.cart = [];
          this.saveCart();
          try { await this.refreshLoyaltyAccount(); } catch (_) { /* */ }
          try {
            window.WebTracker?.track?.('complete_order', {
              page: 'checkout',
              page_label: 'Checkout',
              order_id: this.lastOrder?.id || this.lastOrder?.order_id
            });
          } catch (_) { /* */ }
          this.view = 'confirmed';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn2.disabled = false; btn2.textContent = prevLabel; }
        return;
      }
      if (act === 'login-submit') {
        const loginId = document.getElementById('login-id')?.value.trim() || '';
        const loginPass = document.getElementById('login-pass')?.value || '';
        if (!loginId) { this.toast('Enter your email or phone', 'error'); return; }
        if (!loginPass) { this.toast('Enter your password', 'error'); return; }
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Signing in…';
        try {
          const r = await OrderAPI.login(loginId, loginPass);
          const ret = this.authReturn;
          const ok = ['home', 'menu', 'account', 'orders', 'checkout'].includes(ret);
          await this.finishSignIn({
            token: r.token,
            customer: r.customer,
            loginId,
            password: loginPass,
            nextView: ok ? ret : 'home'
          });
        } catch (err) {
          this.hideAuthModal();
          this.toast(err.message || 'Could not sign in — try again', 'error');
        }
        finally { btn.disabled = false; btn.textContent = prev; }
        return;
      }
      if (act === 'register-submit') {
        const first = document.getElementById('reg-first')?.value.trim() || '';
        const last = document.getElementById('reg-last')?.value.trim() || '';
        const email = document.getElementById('reg-email')?.value.trim() || '';
        const phone = document.getElementById('reg-phone')?.value.trim() || '';
        const pass = document.getElementById('reg-pass')?.value || '';
        if (!first) { this.toast('First name is required', 'error'); return; }
        if (!email && !phone) { this.toast('Email or mobile number is required', 'error'); return; }
        if (pass.length < 6) { this.toast('Password must be at least 6 characters', 'error'); return; }
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Checking…';
        try {
          const check = await OrderAPI.checkRegistration({ first_name: first, last_name: last, email, phone });
          if (check.status === 'already_online') {
            this.toast(check.message || 'Account exists — please sign in', 'error');
            this.view = 'login';
            this.render();
            return;
          }
          if (check.status === 'pos_no_phone') {
            this.toast(check.message, 'error');
            return;
          }
          if (check.status === 'link_existing') {
            this.regLink = { check, form: { first_name: first, last_name: last, email, phone, password: pass } };
            this.view = 'register-verify';
            this.render();
            try {
              const sent = await OrderAPI.sendRegistrationCode({ email, phone });
              this.applyCodeSend(sent);
              if (this.view === 'register-verify') this.render();
            } catch (err) { this.toast(err.message || 'Could not send code', 'error'); }
            return;
          }
          btn.textContent = 'Creating account…';
          const r = await OrderAPI.register({
            first_name: first,
            last_name: last,
            email,
            phone,
            password: pass,
            referral_code: this.referralCode || sessionStorage.getItem('order_ref') || localStorage.getItem('order_ref') || null
          });
          this.regLink = null;
          await this.finishSignIn({
            token: r.token,
            customer: r.customer,
            loginId: email || phone,
            password: pass,
            nextView: 'branches'
          });
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = prev; }
        return;
      }
      if (act === 'register-verify-submit') {
        const code = document.getElementById('reg-code')?.value.trim() || '';
        const pass = document.getElementById('reg-verify-pass')?.value || this.regLink?.form?.password || '';
        const form = this.regLink?.form;
        if (!form) { this.view = 'register'; this.render(); return; }
        if (!code || code.length < 4) { this.toast('Enter the WhatsApp verification code', 'error'); return; }
        if (pass.length < 6) { this.toast('Password must be at least 6 characters', 'error'); return; }
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Activating…';
        try {
          const r = await OrderAPI.register({
            ...form,
            password: pass,
            verification_code: code,
            referral_code: this.referralCode || sessionStorage.getItem('order_ref') || localStorage.getItem('order_ref') || null
          });
          this.regLink = null;
          await this.finishSignIn({
            token: r.token,
            customer: r.customer,
            loginId: form.email || form.phone,
            password: pass,
            nextView: 'branches'
          });
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = prev; }
        return;
      }
      if (act === 'open-wa-code') {
        const url = this.regLink?.whatsapp_url;
        if (!url) { this.toast('Request the WhatsApp code first', 'error'); return; }
        this.openWhatsApp(url);
        this.toast('WhatsApp opened — tap Send, then enter the code here', 'success');
        return;
      }
      if (act === 'resend-reg-code') {
        const form = this.regLink?.form;
        if (!form) return;
        btn.disabled = true;
        try {
          const sent = await OrderAPI.sendRegistrationCode({ email: form.email, phone: form.phone });
          this.applyCodeSend(sent);
          if (this.view === 'register-verify') this.render();
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn.disabled = false; }
        return;
      }
      if (act === 'delete-account') {
        this._deletePending = true;
        this.showPopup({
          title: 'Delete online account',
          body: `<p>Enter the password you use to sign in. Your in-store profile stays linked to your phone number.</p>
            <label>Password<input type="password" id="del-pass" autocomplete="current-password" required></label>`,
          footer: `<button type="button" class="btn-outline" data-act="modal-close">Cancel</button>
            <button type="button" class="btn-danger" data-act="delete-account-confirm">Delete</button>`
        });
        setTimeout(() => document.getElementById('del-pass')?.focus(), 50);
        return;
      }
      if (act === 'logout') {
        this.clearSession();
        this.view = 'login';
        this.render();
        return;
      }
      if (act === 'forgot-send') {
        const loginId = document.getElementById('forgot-id')?.value.trim() || '';
        if (!loginId) { this.toast('Enter your email or phone', 'error'); return; }
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Sending code…';
        try {
          const payload = loginId.includes('@') ? { email: loginId } : { phone: loginId };
          const sent = await OrderAPI.sendPasswordReset(payload);
          this.resetLink = { login: loginId, ...sent };
          this.view = 'forgot-verify';
          this.render();
          if (sent.whatsapp_url) this.openWhatsApp(sent.whatsapp_url);
          else if (sent.email_url) this.openWhatsApp(sent.email_url);
          this.toast(sent.message || 'Reset code is ready', 'success');
        } catch (err) { this.toast(err.message || 'Could not send reset code', 'error'); }
        finally { btn.disabled = false; btn.textContent = prev; }
        return;
      }
      if (act === 'forgot-reset') {
        const loginId = this.resetLink?.login || document.getElementById('forgot-id')?.value.trim() || '';
        const code = document.getElementById('forgot-code')?.value.trim() || '';
        const pass = document.getElementById('forgot-pass')?.value || '';
        const confirmPass = document.getElementById('forgot-pass-2')?.value || '';
        if (!code) { this.toast('Enter the reset code', 'error'); return; }
        if (pass.length < 6) { this.toast('New password must be at least 6 characters', 'error'); return; }
        if (pass !== confirmPass) { this.toast('The two passwords do not match', 'error'); return; }
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Saving…';
        try {
          const payload = loginId.includes('@')
            ? { email: loginId, code, password: pass }
            : { phone: loginId, code, password: pass };
          const r = await OrderAPI.resetPassword(payload);
          this.resetLink = null;
          this.view = 'login';
          this.render();
          this.toast(r.message || 'Password updated — sign in with your new password', 'success');
        } catch (err) { this.toast(err.message || 'Could not reset password', 'error'); }
        finally { btn.disabled = false; btn.textContent = prev; }
        return;
      }
      if (act === 'open-reset-wa') {
        const url = this.resetLink?.whatsapp_url;
        if (!url) { this.toast('Request the WhatsApp code first', 'error'); return; }
        this.openWhatsApp(url);
        return;
      }
      if (act === 'open-reset-email') {
        const url = this.resetLink?.email_url;
        if (!url) { this.toast('Request the email code first', 'error'); return; }
        this.openWhatsApp(url);
        return;
      }
      if (act === 'resend-reset-code') {
        const loginId = this.resetLink?.login || '';
        if (!loginId) return;
        btn.disabled = true;
        try {
          const payload = loginId.includes('@') ? { email: loginId } : { phone: loginId };
          const sent = await OrderAPI.sendPasswordReset(payload);
          this.resetLink = { login: loginId, ...sent };
          if (this.view === 'forgot-verify') this.render();
          if (sent.whatsapp_url) this.openWhatsApp(sent.whatsapp_url);
          else if (sent.email_url) this.openWhatsApp(sent.email_url);
          this.toast(sent.message || 'Reset code sent again', 'success');
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn.disabled = false; }
        return;
      }
      if (act === 'modal-close') {
        if (this._stayResolve) this._stayResolve(false);
        else {
          this._deletePending = false;
          this.hideAuthModal();
        }
        return;
      }
    };
    app.onsubmit = (e) => {
      const form = e.target.closest('form[data-form]');
      if (!form) return;
      e.preventDefault();
      const submit = form.querySelector('[data-act="login-submit"], [data-act="register-submit"], [data-act="register-verify-submit"], [data-act="forgot-send"], [data-act="forgot-reset"]');
      submit?.click();
    };
    app.oninput = (e) => {
      if (e.target.id !== 'menu-search') return;
      this.search = e.target.value;
      try { sessionStorage.setItem('order_search', this.search); } catch (_) { /* ignore */ }
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        if (this._menuFull && this._menuBranchId === this.branch?.id) {
          this.applyMenuFilter();
          this.updateMenuDom();
        } else {
          this.loadMenu();
        }
      }, 180);
    };
    app.onchange = async (e) => {
      if (e.target.name === 'fulfillment') {
        this.checkout.fulfillment_type = e.target.value;
        const firstPay = (this.settings?.online?.payment_methods || []).find((m) => m.enabled !== false && (!m.fulfillment || m.fulfillment === 'any' || m.fulfillment === e.target.value));
        if (firstPay) this.checkout.payment_method = firstPay.id;
        // Show delivery places immediately — don't wait on validate
        this.render();
        const reqId = (this._fulfillQuoteSeq = (this._fulfillQuoteSeq || 0) + 1);
        this.validateCurrentCart().then((q) => {
          if (reqId !== this._fulfillQuoteSeq) return;
          this.quote = q;
          this.updateCheckoutTotalsDom?.();
        }).catch(() => { /* ignore */ });
      }
      if (e.target.name === 'delivery_place') {
        this.checkout.delivery_place_id = e.target.value;
        this.checkout.delivery_place = e.target.dataset.name || '';
        // Instant optimistic fee from branch places — no full page wait
        const place = (this.branch?.delivery_places || []).find((p) => String(p.id) === String(e.target.value));
        const sub = Number(this.quote?.subtotal) || 0;
        let fee = 0;
        if (place) {
          const freeAbove = Number(place.free_delivery_above) || 0;
          const baseFee = Number(place.delivery_fee) || 0;
          fee = freeAbove > 0 && sub >= freeAbove ? 0 : baseFee;
        }
        const prevFee = Number(this.quote?.delivery_fee) || 0;
        const prevTotal = Number(this.quote?.total) || 0;
        this.quote = {
          ...(this.quote || {}),
          delivery_fee: fee,
          delivery_place: this.checkout.delivery_place,
          delivery_place_id: this.checkout.delivery_place_id,
          total: Math.max(0, prevTotal - prevFee + fee)
        };
        this.updateCheckoutTotalsDom?.();
        // Confirm with server in background (no full re-render)
        const reqId = (this._placeQuoteSeq = (this._placeQuoteSeq || 0) + 1);
        this.validateCurrentCart().then((q) => {
          if (reqId !== this._placeQuoteSeq) return;
          this.quote = q;
          this.updateCheckoutTotalsDom?.();
        }).catch(() => { /* keep optimistic totals */ });
      }
      if (e.target.id === 'loyalty-points') {
        this.checkout.loyalty_points_used = parseInt(e.target.value, 10) || 0;
      }
      if (e.target.name === 'payment_method') this.checkout.payment_method = e.target.value;
    };
  },

  shell(body, title = '') {
    if (this.isAuthView()) {
      return `<div class="order-app order-app--auth">
        <main class="main main-auth">${body}</main>
      </div>`;
    }
    const showBack = ['product', 'cart', 'checkout'].includes(this.view);
    const branchChip = this.branch ? `<div class="branch-banner">
      <span>📍 Ordering from <strong>${this.esc(this.branch.name)}</strong></span>
      <button type="button" data-act="nav" data-view="branches" class="link-btn branch-change-btn">Change branch</button>
    </div>` : '';
    const cartBtn = `<button type="button" class="cart-fab" data-act="nav" data-view="cart">${this.cartCount() ? `<span class="cart-badge">${this.cartCount()}</span>` : ''}🛒</button>`;
    const profileName = this.customer
      ? (this.customer.first_name || this.customer.full_name || this.customer.phone || 'Account')
      : '';
    return `<div class="order-app">
      <header class="topbar">${showBack ? `<button type="button" class="back-btn" data-act="back" aria-label="Back">←</button>` : ''}
        <div class="brand"><img src="/api/logo" alt="" class="brand-logo" onerror="this.style.display='none'"><span class="brand-name">${this.esc(this.settings?.shop_name || 'Order Online')}</span></div>
        <div class="top-actions">
          ${this.isShopOpenNow() ? `<button type="button" class="job-icon-btn${this.openJobs.length ? ' job-icon-btn--open' : ''}" data-act="job-apply" aria-label="${this.openJobs.length ? 'Hiring now — apply for a job' : 'Apply for a job'}" title="${this.openJobs.length ? 'Hiring now — tap to apply' : 'Apply for a job'}">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 4h4a2 2 0 0 1 2 2v1h4a2 2 0 0 1 2 2v3H2V9a2 2 0 0 1 2-2h4V6a2 2 0 0 1 2-2Zm0 3h4V6h-4v1ZM2 13h20v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/></svg>
            ${this.openJobs.length ? `<span class="job-badge">${this.openJobs.length > 1 ? `${this.openJobs.length}` : 'Hire'}</span>` : ''}
          </button>
          <button type="button" class="report-problem-btn${this.myIssues.some((i) => i.admin_reply) ? ' report-problem-btn--reply' : ''}" data-act="issue-report" aria-label="Report a problem" title="Report a problem with an order or the app">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 15h-2v-2h2Zm0-4h-2V7h2Z"/></svg>
            <span class="report-problem-text"><span>Report a</span><span>problem</span></span>
          </button>` : ''}
          ${profileName
            ? `<button type="button" class="ghost-btn profile-chip" data-act="nav" data-view="account"><span class="profile-chip-name">${this.esc(profileName)}</span></button>`
            : ''}
        </div></header>
      ${this.contactHeaderHtml()}
      ${branchChip}
      <main class="main">${body}</main>
      ${this.renderClosedOverlay()}
      ${this.view !== 'cart' && this.view !== 'checkout' && this.isShopOpenNow() ? cartBtn : ''}
      <nav class="bottom-nav">
        <button type="button" data-act="nav" data-view="home" class="${this.view === 'home' ? 'active' : ''}">Home</button>
        <button type="button" data-act="nav" data-view="menu" class="${this.view === 'menu' ? 'active' : ''}">Menu</button>
        <button type="button" data-act="nav" data-view="orders" class="${this.view === 'orders' || this.view === 'order-detail' ? 'active' : ''}">Orders</button>
        <button type="button" data-act="nav" data-view="account" class="${this.view === 'account' ? 'active' : ''}">Account</button>
      </nav></div>`;
  },

  async render() {
    if (!this._stayResolve && !this._deletePending) this.hideAuthModal();
    if (!this.token && !this.isAuthView() && this.view !== 'branches') {
      this.view = 'login';
    }
    try { sessionStorage.setItem('order_view', this.view); } catch (_) { /* ignore */ }
    const app = document.getElementById('app');
    if (this.view === 'branches') {
      if (!this.token) { this.view = 'login'; return this.render(); }
      const branches = await OrderAPI.getBranches();
      app.innerHTML = this.shell(`<section class="page branch-step">
        <div class="branch-step-icon">📍</div>
        <h1>Select your closest branch</h1>
        <p class="lead">Choose the branch nearest to you — your menu, stock, and delivery options depend on this.</p>
        <div class="branch-list">${branches.map((b) => {
          const st = b.is_open ? 'open' : (b.status === 'busy' ? 'busy' : 'closed');
          return `<button type="button" class="branch-card" data-act="pick-branch" data-id="${b.id}">
          <strong>${this.esc(b.name)}</strong>
          <span class="muted">${this.esc(b.address || 'Address on file')}</span>
          ${b.phone ? `<span class="muted">📞 ${this.esc(b.phone)}</span>` : ''}
          <div class="branch-meta">
            <span class="status-pill ${st}">${b.is_open ? '● Open now' : (b.status === 'busy' ? 'Busy' : 'Closed')}</span>
            ${b.delivery_enabled ? '<span class="tag">Delivery</span>' : ''}
            ${b.collection_enabled !== false ? '<span class="tag">Collection</span>' : ''}
            ${b.prep_minutes ? `<span class="tag">~${b.prep_minutes} min</span>` : ''}
          </div>
        </button>`;
        }).join('') || '<p class="muted">No branches available for online ordering.</p>'}</div>
      </section>`, 'Branches');
      this.bind();
      return;
    }
    if (this.view === 'welcome') {
      this.view = 'login';
      return this.render();
    }
    if (this.view === 'home') {
      const specials = this.menu?.specials || [];
      app.innerHTML = this.shell(`<section class="page">
        <div class="hero-card">
          <h1>Hello${this.customer ? `, ${this.esc(this.customer.first_name)}` : ''} 👋</h1>
          <p class="lead">Fresh food from <strong>${this.esc(this.branch?.name)}</strong> — delivery or collection</p>
          <button type="button" class="btn-primary btn-block" data-act="nav" data-view="menu">Browse menu</button>
        </div>
        ${this.token && this.loyaltySettings().enabled ? `<div class="loyalty-card">
          <h3>⭐ Your loyalty points</h3>
          <div class="loyalty-balance">${Math.floor(Number(this.loyaltyAccount?.balance) || 0)} pts</div>
          <div class="muted">Worth ${this.money(this.loyaltyAccount?.value || 0)} at checkout</div>
        </div>` : (this.token ? `<div class="loyalty-card"><h3>⭐ Loyalty points</h3><p class="muted" style="margin:0">Earn points on every order you place.</p></div>` : `<div class="checkout-card"><p class="muted" style="margin:0 0 10px">Register to earn points on every order.</p>
          <button type="button" class="btn-primary btn-sm" data-act="nav" data-view="register">Register now</button></div>`)}
        ${this.giftWalletHtml()}
        ${specials.length ? `<h2>Today's specials</h2><div class="product-grid">${specials.slice(0, 6).map((p) => this.productCard(p)).join('')}</div>` : ''}
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'menu') {
      const cats = (this.menu?.categories || this._categoriesFromProducts(this._menuFull?.products || []))
        .filter((c) => String(c.id) !== 'combos');
      const menuTabs = this.menu?.menu_tabs || [];
      const products = this.menu?.products || [];
      const activeCat = this.categoryId != null ? String(this.categoryId) : '';
      app.innerHTML = this.shell(`<section class="page">
        <div class="menu-search-wrap"><input type="search" id="menu-search" placeholder="Search menu…" value="${this.esc(this.search)}"></div>
        ${menuTabs.length ? `<div class="category-scroll menu-tabs-scroll" role="tablist" aria-label="Highlights">
          ${menuTabs.map((t) => {
            const comboCls = t.id === 'combos' ? ' highlight-tab-combo' : '';
            const saleCls = t.saleStyle ? ' highlight-tab-sale' : '';
            const badge = t.count ? `<span class="menu-tab-count${t.saleStyle || t.id === 'combos' ? ' sale' : ''}">${t.count}</span>` : '';
            return `<button type="button" class="cat-chip highlight-tab${saleCls}${comboCls} ${activeCat === String(t.id) ? 'active' : ''}" data-cat-id="${this.esc(t.id)}" style="border-color:${t.color || '#64748b'}">${this.esc(t.name)}${badge}</button>`;
          }).join('')}
        </div>` : ''}
        <div class="category-scroll" role="tablist" aria-label="Categories">
          <button type="button" class="cat-chip ${!activeCat ? 'active' : ''}" data-cat-id="">All</button>
          ${cats.map((c) => `<button type="button" class="cat-chip ${activeCat === String(c.id) ? 'active' : ''}" data-cat-id="${this.esc(c.id)}">${this.esc(c.name)}</button>`).join('')}
        </div>
        <div class="product-grid">${products.map((p, idx) => this.productCard(p, idx)).join('') || '<p class="muted">No products found.</p>'}</div>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'product' && this.product) {
      const p = this.product;
      const groups = p.modifier_groups || [];
      const editLine = this.editingCartKey ? this.cart.find((c) => c._key === this.editingCartKey) : null;
      const selectedModIds = new Set((editLine?.modifiers || []).map((m) => String(m.id)));
      const isChecked = (id) => selectedModIds.has(String(id)) ? 'checked' : '';
      const qtyVal = editLine?.quantity || 1;
      const modInput = (o, type, name, checked) =>
        `<input type="${type}" name="${name}" value="${o.id}" data-name="${this.esc(o.name)}" data-extra="${o.extra_price || 0}" data-mod-type="${this.esc(o.modifier_type || (o.extra_price < 0 ? 'removal' : 'option'))}" ${checked} ${o.out_of_stock ? 'disabled' : ''}${o.modifier_type === 'removal' ? ' data-mod-type="removal"' : ''}>`;
      const renderModGroups = (modGroups, prefix = '') => (modGroups || []).map((g) => {
        const gType = g.type || (g.required ? 'radio' : 'radio-optional');
        if (gType === 'checkbox') {
          return `<fieldset class="mod-group" data-mod-group="${this.esc(prefix + g.name)}" data-required="0" data-type="checkbox">
          <legend>${this.esc(g.name)}</legend>
          ${g.options.map((o) => `<label class="mod-opt ${o.out_of_stock ? 'disabled' : ''}">${modInput(o, 'checkbox', `mod-${this.esc(prefix + g.name)}`, isChecked(o.id))}
            ${this.esc(o.name)}${o.extra_price ? ` ${o.extra_price < 0 ? '' : '+'}${this.money(o.extra_price)}` : ''}${o.out_of_stock ? ' (Out of stock)' : ''}</label>`).join('')}
        </fieldset>`;
        }
        return `<fieldset class="mod-group" data-mod-group="${this.esc(prefix + g.name)}" data-required="${g.required ? '1' : '0'}" data-type="${gType}">
          <legend>${this.esc(g.name)}${g.required ? ' *' : ' <small class="muted">(optional)</small>'}</legend>
          ${g.options.map((o) => `<label class="mod-opt ${o.out_of_stock ? 'disabled' : ''}">${modInput(o, 'radio', `mod-${this.esc(prefix + g.name)}`, isChecked(o.id))}
            ${this.esc(o.name)}${o.extra_price ? ` ${o.extra_price < 0 ? '' : '+'}${this.money(o.extra_price)}` : ''}${o.out_of_stock ? ' (Out of stock)' : ''}</label>`).join('')}
        </fieldset>`;
      }).join('');
      const comboIncludes = p.is_combo && (p.combo_items || []).length
        ? `<div class="checkout-card"><h3>Includes</h3>
            <div class="combo-includes-grid">${p.combo_items.map((ci) => `
              <div class="combo-include-item">
                ${ci.image ? `<img src="${this.esc(ci.image)}" alt="">` : '<div class="combo-include-ph">🍽️</div>'}
                <span>${this.esc(ci.product_name || 'Item')} × ${ci.quantity || 1}</span>
              </div>`).join('')}
            </div></div>`
        : '';
      const comboModSections = p.is_combo
        ? (p.combo_items || []).filter((ci) => ci.modifier_groups?.length || ci.allow_pap_choice).map((ci, idx) => `
        <div class="checkout-card combo-item-options" data-combo-item="${ci.product_id || `idx-${idx}`}">
          <h3>${this.esc(ci.product_name || 'Item')} × ${ci.quantity || 1}</h3>
          ${ci.image ? `<img src="${this.esc(ci.image)}" alt="" style="max-height:72px;border-radius:8px;margin-bottom:8px">` : ''}
          ${renderModGroups(ci.modifier_groups, `ci${ci.product_id}-`)}
        </div>`).join('')
        : '';
      app.innerHTML = this.shell(`<section class="page product-detail">
        ${p.image ? `<img class="prod-img" src="${this.esc(p.image)}" alt="" fetchpriority="high">` : '<div class="prod-img placeholder">🍽️</div>'}
        ${p.is_combo && p.combo_thumbs?.length ? `<div class="combo-thumb-row">${p.combo_thumbs.map((u) => `<img src="${this.esc(u)}" alt="" loading="eager">`).join('')}</div>` : ''}
        <h1>${p.is_combo ? '🎁 ' : ''}${this.esc(p.name)}</h1>
        <p class="muted">${this.esc(p.description)}</p>
        ${comboIncludes}
        ${comboModSections}
        <div class="price-row">${p.is_combo
          ? (p.on_sale ? `<s>${this.money(p.price)}</s> <strong class="sale" id="live-prod-price">${this.money(p.sale_price)}</strong>` : `<strong id="live-prod-price">${this.money(p.price)}</strong>`)
          : (p.on_sale ? `<s>${this.money(p.price)}</s> <strong class="sale" id="live-prod-price">${this.money(p.sale_price)}</strong>` : `<strong id="live-prod-price">${this.money(p.price)}</strong>`)}
        <span class="stock ${p.available ? 'ok' : 'out'}">${p.available ? '● Available' : 'Out of stock'}</span></div>
        ${!p.is_combo ? renderModGroups(groups) : ''}
        <div class="qty-row"><label>Qty</label><input type="number" id="prod-qty" min="1" value="${qtyVal}" class="qty-input"></div>
        <button type="button" class="btn-primary btn-block" data-act="add-cart" data-id="${p.id}" ${p.available ? '' : 'disabled'}>${editLine ? 'Update item' : 'Add to cart'}</button>
        ${!this.isShopOpenNow() ? '<p class="muted" style="text-align:center;margin-top:8px">Ordering is closed right now — you can still choose options.</p>' : ''}
      </section>`);
      this.bind();
      this.bindModifierInputs();
      return;
    }
    if (this.view === 'cart') {
      app.innerHTML = this.shell(`<section class="page"><h1>Your order</h1>
        ${this.cart.length ? this.cart.map((c) => `<div class="cart-line">
          <div><strong>${this.esc(c.name)}</strong><div class="muted">× ${c.quantity}${c.modifiers?.length ? ` · ${c.modifiers.map((m) => m.name).join(', ')}` : ''}</div></div>
          <div class="cart-actions">
            <button type="button" data-act="cart-dec" data-key="${c._key}">−</button>
            <span>${c.quantity}</span>
            <button type="button" data-act="cart-inc" data-key="${c._key}">+</button>
            <button type="button" class="link-btn" data-act="cart-edit" data-key="${c._key}">Edit</button>
            <button type="button" class="link-btn" data-act="cart-remove" data-key="${c._key}">Remove</button>
          </div></div>`).join('') : '<p class="muted">Your cart is empty.</p>'}
        <button type="button" class="btn-primary btn-block" data-act="checkout" ${this.cart.length ? '' : 'disabled'}>Checkout</button>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'checkout') {
      const q = this.quote || {};
      const fulfillment = this.checkout.fulfillment_type || 'collection';
      const ls = this.loyaltySettings();
      const maxPts = this.maxRedeemPoints(q.subtotal);
      const ptsUsed = this.checkout.loyalty_points_used || 0;
      const earnPts = this.previewEarnPoints(q.total);
      const giftCardsOn = this.settings?.online?.gift_cards_enabled !== false;
      const payMethods = (this.settings?.online?.payment_methods || []).filter((m) => m.enabled !== false).filter((m) => {
        const mf = String(m.fulfillment || 'any').toLowerCase();
        return mf === 'any' || mf === fulfillment;
      });
      const methods = payMethods.length ? payMethods : [
        { id: 'card', label: 'Card (pay now)' },
        { id: 'eft', label: 'EFT / Bank transfer' },
        { id: 'cash_on_collection', label: 'Cash on collection', fulfillment: 'collection' },
        { id: 'cash_on_delivery', label: 'Cash on delivery', fulfillment: 'delivery' }
      ].filter((m) => !m.fulfillment || m.fulfillment === fulfillment);
      app.innerHTML = this.shell(`<section class="page"><h1>Checkout</h1>
        <p class="muted">Review your order from <strong>${this.esc(this.branch?.name)}</strong></p>
        <div class="checkout-card"><h3>Your order</h3>
          ${this.checkoutCartHtml()}
        </div>
        <div class="checkout-card"><h3>Order type</h3>
          <label><input type="radio" name="fulfillment" value="collection" ${fulfillment === 'collection' ? 'checked' : ''}> 🏪 Collection — pick up at branch</label>
          <label><input type="radio" name="fulfillment" value="delivery" ${fulfillment === 'delivery' ? 'checked' : ''}> 🚚 Delivery</label>
        </div>
        <div id="delivery-fields" class="checkout-card ${fulfillment === 'delivery' ? '' : 'hidden'}">
          <h3>Delivery place</h3>
          <p class="muted" style="margin:0 0 8px;font-size:13px">Choose your area — the delivery fee is added to your total.</p>
          <div id="delivery-places-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
            ${(this.branch?.delivery_places || []).length
              ? (this.branch.delivery_places || []).map((p) => {
                  const freeAbove = Number(p.free_delivery_above) || 0;
                  const fee = Number(p.delivery_fee) || 0;
                  const sub = Number(q.subtotal) || 0;
                  const due = freeAbove > 0 && sub >= freeAbove ? 0 : fee;
                  const selected = String(this.checkout.delivery_place_id || '') === String(p.id)
                    || String(this.checkout.delivery_place || '').toLowerCase() === String(p.name || '').toLowerCase();
                  return `<label style="border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:10px;cursor:pointer">
                    <input type="radio" name="delivery_place" value="${this.esc(p.id)}" data-name="${this.esc(p.name)}" ${selected ? 'checked' : ''}>
                    <strong>${this.esc(p.name)}</strong>
                    <div class="muted" style="font-size:12px;margin-top:4px">Delivery fee: <strong>${this.money(due)}</strong>${freeAbove > 0 ? ` · free above ${this.money(freeAbove)}` : ''}${Number(p.min_order) > 0 ? ` · min ${this.money(p.min_order)}` : ''}</div>
                  </label>`;
                }).join('')
              : '<p class="muted" style="margin:0;font-size:13px">Flat branch delivery fee applies.</p>'}
          </div>
          <h3>Delivery address</h3>
          <textarea id="delivery-address" rows="3" placeholder="Street, suburb, city…">${this.esc(this.checkout.delivery_address)}</textarea>
        </div>
        <div class="checkout-card"><h3>Payment</h3>
          ${methods.map((m) => `<label><input type="radio" name="payment_method" value="${this.esc(m.id)}" ${(this.checkout.payment_method || methods[0]?.id) === m.id ? 'checked' : ''}> ${this.esc(m.label || m.id)}</label>`).join('')}
        </div>
        ${ls.enabled && this.token ? `<div class="loyalty-card">
          <h3>⭐ Use loyalty points</h3>
          <div class="loyalty-balance">${Math.floor(Number(this.loyaltyAccount?.balance) || 0)} pts available · ${this.money(this.loyaltyAccount?.value || 0)}</div>
          <div class="loyalty-redeem">
            <label>Points to redeem (max ${maxPts})</label>
            <input type="range" id="loyalty-points" min="0" max="${maxPts}" value="${ptsUsed}" step="1">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
              <strong>${ptsUsed} pts = ${this.money(ptsUsed * ls.point_value)} off</strong>
              <button type="button" class="btn-sm" data-act="loyalty-max">Use max</button>
            </div>
          </div>
          ${earnPts ? `<div class="loyalty-earn">You'll earn <strong>${earnPts} points</strong> on this order</div>` : ''}
          <button type="button" class="btn-outline btn-block" data-act="apply-loyalty" style="margin-top:10px">Apply points</button>
        </div>` : ''}
        ${this.giftWalletHtml()}
        <div class="checkout-card">
          <h3>Referral code</h3>
          <p class="muted" style="margin:0 0 8px;font-size:13px">Enter your agent’s referral code so they earn commission on this order (as set by the shop).</p>
          ${this.referralCode ? `<p class="muted" style="margin:0 0 8px;font-size:13px">Linked code: <strong>${this.esc(this.referralCode)}</strong></p>` : ''}
          <div style="display:flex;gap:8px"><input id="coupon-code" value="${this.esc(this.checkout.coupon_code || this.referralCode || '')}" placeholder="e.g. HAPPY41" autocomplete="off"><button type="button" class="btn-sm" data-act="apply-coupon">Apply</button></div>
          ${q.coupon?.type === 'referral' ? `<p class="muted" style="margin:8px 0 0;color:var(--success,#059669)">${this.esc(q.coupon.message || `Referral code ${q.coupon.code} applied`)}</p>` : ''}
        </div>
        ${giftCardsOn ? `<div class="checkout-card">
          <h3>🎁 Gift card</h3>
          <div style="display:flex;gap:8px"><input id="gift-card-code" value="${this.esc(this.checkout.gift_card_code || '')}" placeholder="Enter gift card code"><button type="button" class="btn-sm" data-act="apply-gift-card">Apply</button></div>
          ${q.gift_card_amount ? `<p class="muted" style="margin:8px 0 0">Gift card applied: -${this.money(q.gift_card_amount)}</p>` : ''}
        </div>` : ''}
        <div class="checkout-card">
          <h3>Special instructions</h3>
          <textarea id="order-notes" rows="2" placeholder="Allergies, gate code, etc.">${this.esc(this.checkout.notes)}</textarea>
        </div>
        <div class="totals" id="checkout-totals">
          <div>Subtotal <span>${this.money(q.subtotal)}</span></div>
          ${q.discount ? `<div>Discount${q.coupon?.code ? ` (${this.esc(q.coupon.code)}${q.coupon.discount_type ? ` · ${this.esc(q.coupon.discount_type)}` : ''})` : ''}${q.loyalty_discount ? ` · Loyalty ${ptsUsed} pts` : ''} <span>-${this.money(q.discount)}</span></div>` : ''}
          ${q.gift_card_amount ? `<div>Gift card <span>-${this.money(q.gift_card_amount)}</span></div>` : ''}
          ${q.delivery_fee != null && fulfillment === 'delivery' ? `<div>Delivery${q.delivery_place ? ` (${this.esc(q.delivery_place)})` : ''} <span>${this.money(q.delivery_fee)}</span></div>` : ''}
          ${q.tax_amount ? `<div>Tax${this.settings?.tax_enabled && this.settings?.tax_rate ? ` (${this.settings.tax_rate}%)` : ''} <span>${this.money(q.tax_amount)}</span></div>` : (this.settings?.tax_enabled && this.settings?.tax_rate ? `<div class="muted" style="font-size:13px">Tax (${this.settings.tax_rate}%) calculated at checkout</div>` : '')}
          <div class="total-line">Total <strong>${this.money(q.total)}</strong></div>
        </div>
        <button type="button" class="btn-primary btn-block" data-act="place-order" id="checkout-place-btn">Place order · ${this.money(q.total)}</button>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'payment-pending') {
      const orderNum = this.paymentReturn?.orderNumber || this.lastOrder?.order_number;
      const ret = this.paymentReturn?.returnStatus || 'success';
      const headline = ret === 'cancel' ? 'Payment cancelled' : (ret === 'failure' ? 'Payment unsuccessful' : 'Confirming payment…');
      const detail = ret === 'cancel' || ret === 'failure'
        ? 'You can try again from your cart or choose another payment method.'
        : 'Please wait while we confirm your payment with the bank. Do not close this page.';
      app.innerHTML = this.shell(`<section class="page confirmed">
        <h1>${this.esc(headline)}</h1>
        ${orderNum ? `<p class="order-num">Order ${this.esc(orderNum)}</p>` : ''}
        <p class="muted">${this.esc(detail)}</p>
        <p id="pay-pending-status" class="muted">Checking payment status…</p>
        <button type="button" class="btn-outline btn-block" data-act="nav" data-view="orders" style="margin-top:16px">My orders</button>
        <button type="button" class="link-btn" data-act="nav" data-view="menu">Back to menu</button>
      </section>`);
      this.bind();
      this.pollPaymentReturn(orderNum);
      return;
    }
    if (this.view === 'confirmed' && this.lastOrder) {
      const o = this.lastOrder;
      const isDelivery = this.isDeliveryOrder(o);
      app.innerHTML = this.shell(`<section class="page confirmed">
        <div class="success-icon">✓</div>
        <h1>Order confirmed</h1>
        <p class="order-num">Order ${this.esc(o.order_number)}</p>
        ${isDelivery ? this.handoffCodeHtml(o, { copy: true }) : ''}
        ${this.firstOnlineGiftHtml(o.first_online_gift)}
        <p><strong>${this.esc(this.branch?.name)}</strong> · ${this.money(o.total)}</p>
        ${o.accepted_by || o.cashier ? `<p class="muted">Accepted by <strong>${this.esc(o.accepted_by || o.cashier)}</strong></p>` : '<p class="muted">We\'ll notify you when the branch accepts your order.</p>'}
        ${this.driverCardHtml(o.driver)}
        ${isDelivery && !o.driver?.name ? `<p class="muted" style="font-size:13px">Your driver details will appear here once assigned.</p>` : ''}
        <button type="button" class="btn-primary btn-block" data-act="view-order" data-id="${o.id}">Track this order</button>
        <button type="button" class="btn-outline btn-block" data-act="nav" data-view="menu" style="margin-top:10px">Order again</button>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'orders') {
      if (!this.token) { this.view = 'login'; this.authReturn = 'orders'; return this.render(); }
      const ordersHtml = (orders) => `${orders.length ? orders.map((o) => {
          const items = Array.isArray(o.items) ? o.items : [];
          const preview = items.slice(0, 2).map((i) => `${i.name} ×${i.quantity}`).join(', ');
          const more = items.length > 2 ? ` +${items.length - 2} more` : '';
          const isDelivery = this.isDeliveryOrder(o);
          const code = isDelivery ? (o.confirmation_code || o.order_number) : null;
          return `<button type="button" class="order-card order-card-btn" data-act="view-order" data-id="${o.id}">
            <div class="order-card-main">
              <strong>${this.esc(o.order_number)}</strong>
              <span class="order-status">${this.esc(String(o.status_label || o.status || 'pending').toUpperCase())}</span>
              ${code && isDelivery ? `<span class="order-code-tag" title="Delivery handoff code">Code: ${this.esc(code)}</span>` : ''}
              ${o.driver?.name ? `<span class="muted" style="display:block;font-size:12px;margin-top:4px">🚚 ${this.esc(o.driver.name)}${o.driver.vehicle_registration ? ` · ${this.esc(o.driver.vehicle_registration)}` : ''}</span>` : ''}
              ${o.accepted_by || o.cashier ? `<span class="muted" style="display:block;font-size:12px">Accepted by ${this.esc(o.accepted_by || o.cashier)}</span>` : ''}
              <span class="muted order-preview">${this.esc(preview)}${more}</span>
              <span class="muted">${this.esc(String(o.created_at).slice(0, 16))}</span>
            </div>
            <div class="order-card-side">
              <strong>${this.money(o.total)}</strong>
              <span class="muted">View details →</span>
            </div>
          </button>`;
        }).join('') : '<p class="muted">No orders yet.</p>'}`;

      // Instant paint from cache
      const cached = this._ordersCache;
      app.innerHTML = this.shell(`<section class="page"><h1>My orders</h1>
        <div id="orders-list">${cached ? ordersHtml(cached) : '<p class="muted">Loading…</p>'}</div>
      </section>`);
      this.bind();

      try {
        const orders = await OrderAPI.listOrders(this.token);
        this._ordersCache = orders || [];
        const list = document.getElementById('orders-list');
        if (list && this.view === 'orders') list.innerHTML = ordersHtml(this._ordersCache);
        this.bind();
      } catch (err) {
        if (/invalid|expired|session/i.test(err.message)) {
          this.clearSession();
          this.view = 'login'; this.authReturn = 'orders'; return this.render();
        }
        if (!cached) this.toast(err.message, 'error');
      }
      return;
    }
    if (this.view === 'order-detail') {
      if (!this.token) { this.view = 'login'; this.authReturn = 'orders'; return this.render(); }
      const o = this.selectedOrder;
      if (!o) { this.view = 'orders'; return this.render(); }
      const items = Array.isArray(o.items) ? o.items : [];
      const fulfillment = o.fulfillment_type || o.fulfillment || 'collection';
      const events = Array.isArray(o.events) ? o.events : [];
      const steps = o.tracking_steps || [];
      app.innerHTML = this.shell(`<section class="page">
        <button type="button" class="link-btn" data-act="nav" data-view="orders">← Back to orders</button>
        <h1>${this.esc(o.order_number || 'Order')}</h1>
        <p><span class="order-status">${this.esc(String(o.status_label || o.status || 'pending').toUpperCase())}</span>
          · ${this.esc(String(o.created_at).slice(0, 16))}</p>
        ${this.isDeliveryOrder(o) ? this.handoffCodeHtml(o, { copy: true }) : ''}
        ${this.firstOnlineGiftHtml(o.first_online_gift)}
        ${o.accepted_by || o.cashier ? `<div class="checkout-card"><h3>Shop accepted your order</h3><p><strong>${this.esc(o.accepted_by || o.cashier)}</strong> is handling your order.</p></div>` : ''}
          ${steps.length ? `<div class="checkout-card"><h3>Track order</h3>${this.trackingTimelineHtml(steps)}</div>` : ''}
          ${this.driverCardHtml(o.driver)}
          ${this.isDeliveryOrder(o) && !o.driver?.name ? `<div class="checkout-card"><p class="muted" style="margin:0">Your driver will appear here once assigned — you'll see their photo, vehicle registration, and contact details.</p></div>` : ''}
        <div class="checkout-card">
          <h3>Items</h3>
          ${items.length ? items.map((i) => {
            const mods = i.modifiers_text || (Array.isArray(i.modifiers) ? i.modifiers.map((m) => m.name || m).join(', ') : '');
            return `<div class="cart-line" style="margin-bottom:8px">
              <div><strong>${this.esc(i.name)}</strong> × ${i.quantity}
              ${mods ? `<br><span class="muted">${this.esc(mods)}</span>` : ''}</div>
              <div>${this.money((Number(i.unit_price) || 0) * (Number(i.quantity) || 1))}</div>
            </div>`;
          }).join('') : '<p class="muted">No line items</p>'}
          <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
            ${Number(o.subtotal) > 0 ? `<div class="row"><span>Subtotal</span><span>${this.money(o.subtotal)}</span></div>` : ''}
            ${Number(o.discount) > 0 ? `<div class="row"><span>Discount</span><span>-${this.money(o.discount)}</span></div>` : ''}
            ${Number(o.delivery_fee) > 0 ? `<div class="row"><span>Delivery</span><span>${this.money(o.delivery_fee)}</span></div>` : ''}
            ${Number(o.tax_amount) > 0 ? `<div class="row"><span>Tax</span><span>${this.money(o.tax_amount)}</span></div>` : ''}
            <div class="row" style="font-weight:700"><span>Total</span><span>${this.money(o.total)}</span></div>
          </div>
        </div>
        <div class="checkout-card">
          <h3>Details</h3>
          <p><strong>Fulfillment:</strong> ${this.esc(fulfillment)}</p>
          ${fulfillment === 'delivery' && o.delivery_address ? `<p><strong>Address:</strong> ${this.esc(o.delivery_address)}</p>` : ''}
          <p><strong>Payment:</strong> ${this.esc(o.payment_method || 'online')} · ${this.esc(o.payment_status || '—')}</p>
          ${o.notes ? `<p><strong>Note:</strong> ${this.esc(o.notes)}</p>` : ''}
          ${o.reject_reason ? `<p><strong>Rejection reason:</strong> ${this.esc(o.reject_reason)}</p>` : ''}
        </div>
        ${events.length ? `<div class="checkout-card"><h3>Updates</h3>
          ${events.map((ev) => `<p class="muted">${this.esc(String(ev.created_at || '').slice(0, 16))} — ${this.esc(ev.event_type || ev.status || 'update')}${ev.note ? `: ${this.esc(ev.note)}` : ''}</p>`).join('')}
        </div>` : ''}
      </section>`);
      this.bind();
      this.startOrderPolling();
      return;
    }
    if (this.view === 'login') {
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card" data-form="login" novalidate>
        <h1>Sign in</h1>
        <p class="muted auth-lead">Sign in with your email, or your full phone number (082… or +27…), then your password.</p>
        <label>Email or full phone number<input id="login-id" type="text" autocomplete="username" required placeholder="you@email.com or 082 123 4567"></label>
        <label>Password<input type="password" id="login-pass" autocomplete="current-password" required placeholder="Your password"></label>
        <button type="submit" class="btn-primary btn-block" data-act="login-submit">Sign in</button>
        <button type="button" class="link-btn" data-act="nav" data-view="forgot">Forgot password?</button>
        <button type="button" class="link-btn" data-act="nav" data-view="register">Create account</button>
      </form></div>`);
      this.bind();
      document.getElementById('login-id')?.focus();
      this.tryAutofillLogin();
      return;
    }
    if (this.view === 'forgot') {
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card" data-form="forgot" novalidate>
        <h1>Forgot password</h1>
        <p class="muted auth-lead">Enter the email or the full phone number on your account. We send a reset code, then you set a new password on the next screen.</p>
        <label>Email or full phone number<input id="forgot-id" type="text" autocomplete="username" required placeholder="you@email.com or 082 123 4567"></label>
        <button type="submit" class="btn-primary btn-block" data-act="forgot-send">Send reset code</button>
        <button type="button" class="link-btn" data-act="nav" data-view="login">Back to sign in</button>
      </form></div>`);
      this.bind();
      document.getElementById('forgot-id')?.focus();
      return;
    }
    if (this.view === 'forgot-verify') {
      const link = this.resetLink || {};
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card" data-form="forgot-verify" novalidate>
        <h1>Set a new password</h1>
        <p class="muted auth-lead">${this.esc(link.message || 'Enter the 6-digit code, then type the password you will use next time.')}</p>
        <label>Reset code<input id="forgot-code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required></label>
        <label>New password<input type="password" id="forgot-pass" autocomplete="new-password" minlength="6" required></label>
        <label>Rewrite new password<input type="password" id="forgot-pass-2" autocomplete="new-password" minlength="6" required></label>
        <button type="submit" class="btn-primary btn-block" data-act="forgot-reset">Save new password</button>
        ${link.whatsapp_url ? `<button type="button" class="btn-block" data-act="open-reset-wa">Open WhatsApp code</button>` : ''}
        ${link.email_url ? `<button type="button" class="btn-block" data-act="open-reset-email">Open email with code</button>` : ''}
        <button type="button" class="link-btn" data-act="resend-reset-code">Resend code</button>
        <button type="button" class="link-btn" data-act="nav" data-view="login">Back to sign in</button>
      </form></div>`);
      this.bind();
      document.getElementById('forgot-code')?.focus();
      return;
    }
    if (this.view === 'register') {
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card" data-form="register" novalidate>
        <h1>Create account</h1>
        <p class="muted auth-lead">Register once — order faster next time. If you already shop with us in-store, we will link your loyalty points after WhatsApp verification.</p>
        <label>First name<input id="reg-first" autocomplete="given-name" required></label>
        <label>Last name<input id="reg-last" autocomplete="family-name"></label>
        <label>Email<input id="reg-email" type="email" autocomplete="email" placeholder="you@email.com"></label>
        <label>Mobile<input id="reg-phone" type="tel" autocomplete="tel" placeholder="082 123 4567"></label>
        <label>Password (min 6 characters)<input type="password" id="reg-pass" autocomplete="new-password" required minlength="6"></label>
        <button type="submit" class="btn-primary btn-block" data-act="register-submit">Create account</button>
        <button type="button" class="link-btn" data-act="nav" data-view="login">Already have an account?</button>
      </form></div>`);
      this.bind();
      document.getElementById('reg-first')?.focus();
      return;
    }
    if (this.view === 'register-verify') {
      const link = this.regLink?.check || {};
      const form = this.regLink?.form || {};
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card" data-form="register-verify" novalidate>
        <h1>Verify your account</h1>
        <p class="muted auth-lead">${this.esc(link.message || 'We found your in-store profile. Enter the WhatsApp code to activate online ordering.')}</p>
        ${link.points ? `<div class="loyalty-card" style="margin-bottom:12px"><strong>${link.points} loyalty points</strong> will be linked to your online account.</div>` : ''}
        <label>WhatsApp verification code<input id="reg-code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required></label>
        <label>Choose password<input type="password" id="reg-verify-pass" autocomplete="new-password" minlength="6" value="${this.esc(form.password || '')}" required></label>
        <button type="submit" class="btn-primary btn-block" data-act="register-verify-submit">Activate account</button>
        ${this.regLink?.whatsapp_url ? `<button type="button" class="btn-block" data-act="open-wa-code">Open WhatsApp code</button>` : ''}
        <button type="button" class="link-btn" data-act="resend-reg-code">Resend WhatsApp code</button>
        <button type="button" class="link-btn" data-act="nav" data-view="register">Back</button>
      </form></div>`);
      this.bind();
      document.getElementById('reg-code')?.focus();
      return;
    }
    if (this.view === 'account') {
      if (!this.token) { this.view = 'login'; this.authReturn = 'account'; return this.render(); }
      const accountHtml = (acct) => `<section class="page"><h1>My account</h1>
        <p><strong>${this.esc(acct.profile.first_name)} ${this.esc(acct.profile.last_name || '')}</strong></p>
        <p class="muted">${this.esc(acct.profile.email || acct.profile.phone)}</p>
        ${acct.pos_profile ? `<div class="checkout-card"><h3>Unified profile</h3>
          <p class="muted" style="margin:0">Linked to in-store customer <strong>${this.esc(acct.pos_profile.name || '')}</strong>${acct.pos_profile.phone ? ` · ${this.esc(acct.pos_profile.phone)}` : ''}</p></div>` : ''}
        <div class="loyalty-card"><h3>Loyalty</h3><strong>${acct.loyalty?.balance ?? 0} points</strong> · ${this.money(acct.loyalty?.value)} value</div>
        ${acct.wallet?.length ? `<div class="checkout-card gift-wallet-card"><h3>🎁 My Gift Cards</h3>
          ${acct.wallet.map((g) => `<div class="gift-wallet-row">
            <div><code class="gift-code">${this.esc(g.code)}</code>
            <button type="button" class="btn-sm" data-act="copy-gift" data-code="${this.esc(g.code)}">Copy</button></div>
            <strong>${this.money(g.balance)}</strong>
            ${g.expires_at ? `<div class="muted" style="font-size:12px">Expires ${this.esc(String(g.expires_at).slice(0, 10))}</div>` : ''}
          </div>`).join('')}
        </div>` : ''}
        <div class="checkout-card"><h3>Notifications</h3>
          <p class="muted" style="margin:0 0 8px">Get a sound and pop-up when your order status changes (even when this tab is in the background).</p>
          ${window.PanelNotify ? PanelNotify.soundToggleHtml('online', { id: 'order-notify-sound', label: 'Order update alerts' }) : ''}
        </div>
        <div class="account-actions">
          <button type="button" class="btn-outline btn-block" data-act="logout">Logout</button>
          <button type="button" class="btn-danger btn-block" data-act="delete-account">Delete online account</button>
        </div>
      </section>`;

      const cached = this._accountCache || (this.customer ? {
        profile: this.customer,
        loyalty: this.loyaltyAccount || { balance: 0, value: 0 },
        wallet: this.giftWallet || [],
        pos_profile: null
      } : null);
      if (cached) {
        app.innerHTML = this.shell(accountHtml(cached));
        const orderNotify = document.getElementById('order-notify-sound');
        if (orderNotify && window.PanelNotify) PanelNotify.bindSoundToggle(orderNotify, 'online');
        this.bind();
      } else {
        app.innerHTML = this.shell(`<section class="page"><h1>My account</h1><p class="muted">Loading…</p></section>`);
        this.bind();
      }
      try {
        const acct = await OrderAPI.account(this.token);
        this._accountCache = acct;
        this.customer = acct.profile || this.customer;
        this.loyaltyAccount = acct.loyalty || this.loyaltyAccount;
        this.giftWallet = acct.wallet || [];
        if (this.view === 'account') {
          app.innerHTML = this.shell(accountHtml(acct));
          const orderNotify2 = document.getElementById('order-notify-sound');
          if (orderNotify2 && window.PanelNotify) PanelNotify.bindSoundToggle(orderNotify2, 'online');
          this.bind();
        }
      } catch (err) {
        if (!cached) {
          this.clearSession();
          this.view = 'login'; this.authReturn = 'account'; return this.render();
        }
      }
      return;
    }
    if (this.view === 'product' && !this.product) {
      this.view = 'menu';
      return this.render();
    }
    console.warn('[OrderApp] Unknown view:', this.view);
    this.view = this.token && this.branch ? 'home' : 'login';
    return this.render();
  },

  productCard(p, idx = 0) {
    const btnLabel = p.is_combo ? 'View combo' : (p.has_modifiers ? 'Choose options' : 'Add');
    const btnAct = p.has_modifiers && !p.is_combo ? 'open-product' : (p.is_combo ? 'open-product' : 'quick-add');
    const badges = (p.badges || []).map((b) => `<span class="pc-badge" style="background:${b.color || '#64748b'}">${this.esc(b.label)}</span>`).join('');
    const imgTag = p.image
      ? `<img src="${this.esc(p.image)}" alt="" decoding="async" ${idx < 24 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}>`
      : `<div class="thumb">${p.is_combo ? '🎁' : '🍽️'}</div>`;
    const comboThumbs = p.is_combo && p.combo_thumbs?.length
      ? `<div class="combo-mini-thumbs">${p.combo_thumbs.map((u) => `<img src="${this.esc(u)}" alt="" decoding="async" loading="eager">`).join('')}</div>`
      : '';
    return `<article class="product-card ${p.available ? '' : 'unavailable'} ${p.is_combo ? 'combo-card' : ''}" data-product-id="${this.esc(p.id)}" role="button" tabindex="0">
      ${imgTag}
      ${comboThumbs}
      <div class="pc-body">
        ${badges ? `<div class="pc-badges">${badges}</div>` : ''}
        <h3>${p.is_combo ? '🎁 ' : ''}${this.esc(p.name)}</h3>
        <div class="pc-price">${p.on_sale ? `<s>${this.money(p.price)}</s> <span class="sale">${this.money(p.sale_price)}</span>` : this.money(p.price)}</div>
        <span class="stock ${p.available ? 'ok' : 'out'}">${p.available ? 'Available' : 'Out of stock'}</span>
        <button type="button" class="btn-sm" data-act="${btnAct}" data-id="${p.id}" data-combo="${p.is_combo ? '1' : '0'}" ${p.available ? '' : 'disabled'}>${btnLabel}</button>
      </div></article>`;
  }
};

document.addEventListener('DOMContentLoaded', () => OrderApp.init());
