const KioskApp = {
  deviceToken: localStorage.getItem('kiosk_device_token') || '',
  catalog: null, cart: [], view: 'browse', categoryId: null,
  idleTimer: null, idleSec: 120, selectedProduct: null, selectedMods: [], qty: 1, paymentMethod: 'card',

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  money(n) { return `R${Number(n || 0).toFixed(2)}`; },

  APP_VERSION: 'kiosk-web 2026.10.1',
  conn: 'CONNECTING',
  pending: null,
  submitting: false,
  sessionStartedAt: null,
  webCustomer: null,
  webToken: '',
  customerBenefits: null,
  couponCode: '',
  couponDiscount: 0,
  referralCode: '',
  giftCardCode: '',
  giftCardAmount: 0,
  loyaltyPointsUsed: 0,
  confirmTimer: null,
  _retryTimer: null,
  _retryDelay: 5000,

  // ─── Connection state + offline-safe order submission ─────────────────────

  setConn(state, detail) {
    this.conn = state;
    const el = document.getElementById('kiosk-status-pill');
    if (!el) return;
    const colors = { ONLINE: '#16a34a', CONNECTING: '#2563eb', OFFLINE: '#dc2626', SYNCING: '#d97706', SYNCED: '#16a34a', 'SYNC ERROR': '#7f1d1d' };
    el.style.background = colors[state] || '#334155';
    const label = state === 'ONLINE' ? 'Online' : state === 'OFFLINE' ? 'Offline' : state;
    el.textContent = detail ? `${label} · ${detail}` : label;
    el.dataset.state = state;
    if (state === 'SYNCED') setTimeout(() => { if (this.conn === 'SYNCED') this.setConn('ONLINE'); }, 4000);
  },

  newClientRequestId() {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const seq = (Number(localStorage.getItem('kiosk_txn_seq') || 0) % 99999) + 1;
    localStorage.setItem('kiosk_txn_seq', String(seq));
    const rand = Math.random().toString(36).slice(2, 5);
    return `KSK-${ymd}-${String(seq).padStart(5, '0')}-${rand}`;
  },

  orderPayload() {
    return {
      items: this.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, modifiers: c.modifiers })),
      payment_method: this.paymentMethod,
      voucher_code: this.voucherCode || undefined,
      coupon_code: this.couponCode || undefined,
      referral_code: this.referralCode || undefined,
      gift_card_code: this.giftCardCode || undefined,
      loyalty_points_used: this.loyaltyPointsUsed || undefined,
      web_customer_token: this.webToken || undefined
    };
  },

  clearCustomerSession() {
    this.webCustomer = null;
    this.webToken = '';
    this.customerBenefits = null;
    this.couponCode = '';
    this.couponDiscount = 0;
    this.referralCode = '';
    this.giftCardCode = '';
    this.giftCardAmount = 0;
    this.loyaltyPointsUsed = 0;
    try { sessionStorage.removeItem('kiosk_web_token'); } catch (_) { /* */ }
  },

  async refreshCustomerBenefits() {
    if (!this.webToken) return;
    this.customerBenefits = await KioskAPI.customerBenefits(this.deviceToken, this.webToken);
    this.webCustomer = this.customerBenefits?.customer || this.webCustomer;
  },

  savePending() {
    try {
      if (this.pending) {
        localStorage.setItem('kiosk_pending_order', JSON.stringify({ ...this.pending, cart: this.cart, voucherCode: this.voucherCode, voucherDiscount: this.voucherDiscount }));
      } else {
        localStorage.removeItem('kiosk_pending_order');
      }
    } catch (_) { /* storage full — order still submits */ }
  },

  restorePending() {
    try {
      const raw = JSON.parse(localStorage.getItem('kiosk_pending_order') || 'null');
      if (!raw || !raw.client_request_id || !raw.payload || raw.rejected) { localStorage.removeItem('kiosk_pending_order'); return false; }
      if (Date.now() - Date.parse(raw.client_created_at || 0) > 24 * 3600000) { localStorage.removeItem('kiosk_pending_order'); return false; }
      this.pending = { client_request_id: raw.client_request_id, client_created_at: raw.client_created_at, payload: raw.payload, hash: raw.hash, attempts: raw.attempts || 0, network_failed: !!raw.network_failed, txn_seconds: raw.txn_seconds };
      this.cart = Array.isArray(raw.cart) ? raw.cart : [];
      this.voucherCode = raw.voucherCode || '';
      this.voucherDiscount = Number(raw.voucherDiscount) || 0;
      return true;
    } catch (_) { return false; }
  },

  /** Same cart → same transaction ID until the server confirms it, so a retry can never create a second order. */
  preparePending() {
    const payload = this.orderPayload();
    const hash = JSON.stringify(payload);
    if (this.pending && this.pending.hash === hash) { this.pending.rejected = false; return this.pending; }
    this.pending = {
      client_request_id: this.newClientRequestId(),
      client_created_at: new Date().toISOString(),
      payload, hash, attempts: 0, network_failed: false,
      txn_seconds: this.sessionStartedAt ? Math.round((Date.now() - this.sessionStartedAt) / 1000) : null
    };
    this.savePending();
    return this.pending;
  },

  async submitPending() {
    const p = this.pending;
    if (!p || this.submitting) return null;
    this.submitting = true;
    p.attempts += 1;
    this.setConn(p.network_failed ? 'SYNCING' : 'CONNECTING', p.network_failed ? `order ${p.client_request_id}` : '');
    try {
      const r = await KioskAPI.placeOrder(this.deviceToken, {
        ...p.payload,
        client_request_id: p.client_request_id,
        client_created_at: p.client_created_at,
        txn_seconds: p.txn_seconds,
        queued_offline: p.network_failed || undefined
      });
      const wasOffline = p.network_failed;
      this.pending = null;
      this.savePending();
      clearTimeout(this._retryTimer);
      this._retryDelay = 5000;
      this.setConn(wasOffline ? 'SYNCED' : 'ONLINE');
      this.lastOrderNumber = r.order_number;
      this.lastWhatsAppReceipt = !!r.whatsapp_receipt;
      this.cart = []; this.voucherCode = ''; this.voucherDiscount = 0; this.sessionStartedAt = null;
      this.couponCode = ''; this.couponDiscount = 0; this.giftCardAmount = 0; this.loyaltyPointsUsed = 0;
      this.closeModals();
      this.view = 'confirm';
      this.render();
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => {
        this.clearCustomerSession();
        this.newOrder();
      }, Math.max(8000, Number(this.catalog?.settings?.confirm_reset_sec) || 15000));
      return r;
    } catch (ex) {
      if (ex.network) {
        p.network_failed = true;
        this.savePending();
        this.setConn(navigator.onLine === false ? 'OFFLINE' : 'SYNC ERROR', 'order saved — retrying');
        this.logError(ex.timeout ? 'api_timeout' : 'network_failure', ex.message, { client_request_id: p.client_request_id, attempt: p.attempts });
        this.scheduleRetry();
      } else {
        p.rejected = true;
        this.savePending();
        this.setConn('ONLINE');
        this.logError('order_submission_failure', ex.message, { client_request_id: p.client_request_id, total: this.cartTotal() });
      }
      throw ex;
    } finally {
      this.submitting = false;
    }
  },

  scheduleRetry() {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      if (!this.pending) return;
      this.submitPending().catch(() => {});
    }, this._retryDelay);
    this._retryDelay = Math.min(60000, Math.round(this._retryDelay * 1.6));
  },

  showPendingScreen() {
    const app = document.getElementById('app');
    if (!app || !this.pending) return;
    app.innerHTML = `<div class="confirm-screen"><h2>Sending your order…</h2>
      <p>The connection dropped. Your order is saved on this kiosk and will be sent automatically — you will not be charged twice.</p>
      <div class="order-num" style="font-size:22px">${this.esc(this.pending.client_request_id)}</div>
      <p class="muted">Please wait here or ask a staff member for help.</p>
      <button class="btn-primary" data-act="retry-now" style="margin-top:30px;padding:16px 32px;font-size:18px">Try again now</button></div>`;
    app.onclick = (e) => {
      if (e.target.closest('[data-act="retry-now"]')) { this._retryDelay = 5000; this.submitPending().catch(() => this.showPendingScreen()); }
    };
  },

  // ─── Diagnostics ──────────────────────────────────────────────────────────

  logError(type, message, context = {}) {
    try {
      const q = JSON.parse(localStorage.getItem('kiosk_error_queue') || '[]');
      q.push({ type, message: String(message || '').slice(0, 500), context, app_version: this.APP_VERSION, occurred_at: new Date().toISOString() });
      localStorage.setItem('kiosk_error_queue', JSON.stringify(q.slice(-50)));
    } catch (_) { /* */ }
  },

  async flushErrors() {
    let q = [];
    try { q = JSON.parse(localStorage.getItem('kiosk_error_queue') || '[]'); } catch (_) { q = []; }
    if (!q.length || !this.deviceToken) return;
    try {
      await KioskAPI.reportErrors(this.deviceToken, q);
      localStorage.removeItem('kiosk_error_queue');
    } catch (_) { /* keep for next heartbeat */ }
  },

  errorQueueLength() {
    try { return JSON.parse(localStorage.getItem('kiosk_error_queue') || '[]').length; } catch (_) { return 0; }
  },

  async sendHeartbeat() {
    const t0 = performance.now();
    try {
      await KioskAPI.heartbeat(this.deviceToken, {
        online: navigator.onLine,
        latency_ms: this._lastLatency,
        app_version: this.APP_VERSION,
        pending_sync: (this.pending && !this.pending.rejected ? 1 : 0) + this.errorQueueLength(),
        device_status: { screen: `${screen.width}x${screen.height}`, view: this.view, cart_items: this.cart.length }
      });
      this._lastLatency = Math.round(performance.now() - t0);
      if (['OFFLINE', 'SYNC ERROR', 'CONNECTING', 'ONLINE'].includes(this.conn) && !this.submitting) {
        this.setConn('ONLINE', this._lastLatency > 2500 ? 'slow connection' : '');
      }
      await this.flushErrors();
      if (this.pending && !this.pending.rejected && !this.submitting) this.submitPending().catch(() => {});
    } catch (ex) {
      if (ex.network) this.setConn(navigator.onLine === false ? 'OFFLINE' : 'SYNC ERROR', 'server unreachable');
    }
  },

  productImageUrl(p) {
    const hasPic = p?.has_image || p?.has_picture === 1 || p?.has_picture === true;
    const imagePath = p?.image_url || (p?.id && hasPic ? `/api/product-image/${p.id}` : null);
    if (!hasPic && !imagePath) return null;
    const base = (window.__KIOSK_CONFIG__?.apiBase || window.location.origin || '').replace(/\/$/, '');
    const path = String(imagePath).startsWith('http') ? imagePath : `${base}${imagePath}`;
    if (path.includes('/api/product-image/')) return path;
    if (!this.deviceToken) return path;
    return `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.deviceToken)}`;
  },

  paymentLabel(id) {
    const key = String(id || '').toLowerCase();
    return this.catalog?.settings?.payment_method_labels?.[key]
      || this.catalog?.settings?.payment_method_labels?.[id]
      || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  },

  paymentMethods() {
    const opts = this.catalog?.settings?.payment_method_options;
    if (Array.isArray(opts) && opts.length) return opts;
    return (this.catalog?.settings?.payment_methods || ['card', 'cash']).map((id) => ({ id, label: this.paymentLabel(id) }));
  },

  customerBarHtml() {
    if (!this.webCustomer && !this.customerBenefits) return '';
    const c = this.webCustomer || this.customerBenefits?.customer || {};
    const pts = this.customerBenefits?.loyalty_points ?? c.loyalty_points ?? 0;
    const phone = c.phone || '';
    return `<div class="kiosk-customer-bar">
      <strong>${this.esc(c.name || 'Customer')}</strong>
      ${phone ? `<span class="muted">${this.esc(phone)}</span>` : ''}
      <span class="kiosk-pts">${pts} pts</span>
    </div>`;
  },

  headerActionsHtml(extraBack) {
    return `<div class="kiosk-header-actions">
      <span id="kiosk-status-pill" class="kiosk-status-pill" data-state="${this.esc(this.conn)}">${this.esc(this.conn)}</span>
      ${extraBack || ''}
      ${this.webCustomer
        ? `<button type="button" data-act="logout-customer" class="btn-secondary kiosk-header-btn">Sign out</button>`
        : `<button type="button" data-act="login-customer" class="btn-secondary kiosk-header-btn">Sign in</button>`}
      <span class="muted kiosk-device-name">${this.esc(this.catalog?.device?.name || '')}</span>
    </div>`;
  },

  productMediaHtml(p, cls = 'product-img') {
    const src = this.productImageUrl(p);
    const fallback = '<div class="product-img-fallback" aria-hidden="true"><span>No photo</span></div>';
    if (!src) return fallback;
    return `<img class="${cls}" src="${this.esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.classList.add('img-fail')">` + fallback;
  },

  async init() {
    this.setConn('CONNECTING');
    window.addEventListener('offline', () => this.setConn('OFFLINE', this.pending ? 'order saved' : ''));
    window.addEventListener('online', () => { this.setConn('CONNECTING'); this.sendHeartbeat(); });
    window.addEventListener('error', (e) => this.logError('app_crash', e?.message || 'Script error', { src: e?.filename, line: e?.lineno }));
    window.addEventListener('unhandledrejection', (e) => this.logError('app_crash', e?.reason?.message || String(e?.reason || 'Unhandled rejection')));
    const hadPending = this.restorePending();
    if (this.deviceToken) {
      try {
        await this.loadCatalog();
        this.setConn('ONLINE');
        this.showApp();
        this.startHeartbeat();
        if (hadPending) {
          this.showPendingScreen();
          this.submitPending().catch((ex) => {
            if (ex.network) { this.showPendingScreen(); return; }
            this.view = 'checkout';
            this.render();
            const err = document.getElementById('checkout-err');
            if (err) err.textContent = ex.message;
          });
        }
        return;
      } catch (ex) {
        if (ex.network && this.catalog) { this.showApp(); this.startHeartbeat(); return; }
        if (ex.network) {
          this.logError('product_load_failure', ex.message);
          this.setConn('OFFLINE', 'retrying');
          setTimeout(() => this.init(), 10000);
          return;
        }
      }
    }
    await this.startPairing();
  },

  closeModals() {
    document.querySelectorAll('.modal').forEach((m) => m.remove());
  },

  setIdleVisible(show) {
    const el = document.getElementById('idle-overlay');
    if (!el) return;
    if (show) {
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
      el.style.pointerEvents = 'auto';
    } else {
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
      el.style.pointerEvents = 'none';
    }
  },

  resetIdle() {
    clearTimeout(this.idleTimer);
    this.setIdleVisible(false);
    const sec = Math.max(60, Number(this.idleSec) || 120);
    this.idleTimer = setTimeout(() => {
      if (this.view === 'confirm' || (this.pending && !this.pending.rejected)) return;
      if (document.querySelector('.modal')) {
        this.resetIdle();
        return;
      }
      this.closeModals();
      this.setIdleVisible(true);
    }, sec * 1000);
  },

  async startPairing() {
    const meta = { platform: navigator.platform, screen: `${screen.width}x${screen.height}` };
    try {
      const r = await KioskAPI.requestPairing(meta);
      document.getElementById('pair-code').textContent = r.pairing_code;
      const poll = setInterval(async () => {
        try {
          const st = await KioskAPI.pairingStatus(r.pairing_code);
          if (st.status === 'approved' && st.device_token) {
            clearInterval(poll);
            this.deviceToken = st.device_token;
            localStorage.setItem('kiosk_device_token', st.device_token);
            await this.loadCatalog();
            document.getElementById('pair-screen').classList.add('hidden');
            this.showApp();
            this.startHeartbeat();
          } else if (st.status === 'expired' || st.status === 'rejected') {
            clearInterval(poll);
            const msg = document.getElementById('pair-msg');
            if (msg) msg.textContent = `Pairing ${st.status}. Refresh to try again.`;
          }
        } catch (_) { /* */ }
      }, 3000);
    } catch (e) {
      const msg = document.getElementById('pair-msg');
      if (msg) msg.textContent = e.message || 'Pairing request failed';
    }
  },

  startHeartbeat() {
    if (this._hbStarted) return;
    this._hbStarted = true;
    this.sendHeartbeat();
    setInterval(() => this.sendHeartbeat(), 30000);
    setInterval(() => {
      if (document.hidden || this.view !== 'browse' || document.querySelector('.modal') || this.cart.length) return;
      this.loadCatalog().then(() => { if (this.view === 'browse' && !document.querySelector('.modal')) this.render(); }).catch(() => {});
    }, 60000);
  },

  async loadCatalog() {
    try {
      this.catalog = await KioskAPI.catalog(this.deviceToken);
    } catch (ex) {
      this.logError('product_load_failure', ex.message);
      throw ex;
    }
    this.idleSec = this.catalog.settings?.idle_timeout_sec || 120;
    if (!this.categoryId && this.catalog.categories?.length) this.categoryId = this.catalog.categories[0].id;
  },

  showApp() {
    document.getElementById('pair-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    this.render();
    this.resetIdle();
    document.body.addEventListener('click', () => this.resetIdle());
    document.getElementById('idle-overlay')?.addEventListener('click', () => {
      this.closeModals();
      if (this.pending && !this.pending.rejected) { this.setIdleVisible(false); this.showPendingScreen(); return; }
      this.pending = null; this.savePending();
      this.cart = []; this.sessionStartedAt = null; this.view = 'browse'; this.resetIdle(); this.render();
    });
  },

  products() {
    const prods = this.catalog?.products || [];
    if (!this.categoryId) return prods;
    return prods.filter((p) => p.category_id === this.categoryId);
  },

  cartTotal() { return this.cart.reduce((s, i) => s + i.unit_price * i.quantity, 0); },

  render() {
    const app = document.getElementById('app');
    if (this.view === 'confirm') {
      app.innerHTML = `<div class="confirm-screen"><h2>Thank you!</h2><p>Your order number is</p>
        <div class="order-num">${this.esc(this.lastOrderNumber)}</div>
        ${this.lastWhatsAppReceipt ? '<p class="muted">Your receipt slip was sent to your WhatsApp number.</p>' : ''}
        <p class="muted">Please collect your order when ready</p>
        <button class="btn-primary" onclick="KioskApp.newOrder()" style="margin-top:40px;padding:20px 40px;font-size:20px">New Order</button></div>`;
      return;
    }
    if (this.view === 'checkout') return this.renderCheckout(app);
    if (this.view === 'cart') return this.renderCart(app);
    app.innerHTML = `${this.customerBarHtml()}<div class="kiosk-header">
      <h1>${this.esc(this.catalog?.settings?.welcome_message || 'Order Here')}</h1>
      ${this.headerActionsHtml('')}</div>
      <div class="kiosk-body"><div class="cat-list">${(this.catalog?.categories || []).map((c) =>
        `<button class="cat-btn ${c.id === this.categoryId ? 'active' : ''}" data-cat="${c.id}">${this.esc(c.name)}</button>`).join('')}</div>
      <div class="product-grid">${this.products().map((p) =>
        `<div class="product-card ${p.available ? '' : 'unavailable'}" data-pid="${p.id}">
          <div class="product-card-media">${this.productMediaHtml(p)}</div>
          <h3>${this.esc(p.name)}</h3>${p.available ? '' : '<span class="badge-oos">Out of stock</span>'}
          <div class="price">${this.money(p.selling_price)}</div></div>`).join('')}</div></div>
      <div class="cart-bar"><span>${this.cart.length} items · <strong>${this.money(this.cartTotal())}</strong></span>
      <button class="btn-primary" ${this.cart.length ? '' : 'disabled'} data-act="cart">View Cart</button></div>`;
    app.onclick = (e) => {
      const cat = e.target.closest('[data-cat]');
      if (cat) { this.categoryId = Number(cat.dataset.cat); this.render(); return; }
      const card = e.target.closest('[data-pid]');
      if (card) { this.openProduct(Number(card.dataset.pid)); return; }
      if (e.target.closest('[data-act="cart"]')) { this.view = 'cart'; this.render(); }
      if (e.target.closest('[data-act="login-customer"]')) { this.openCustomerLogin(); return; }
      if (e.target.closest('[data-act="logout-customer"]')) { this.clearCustomerSession(); this.render(); return; }
    };
  },

  openCustomerLogin() {
    this.closeModals();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-inner"><h2>Sign in</h2><p class="muted">Use your online account (phone + password)</p>
      <input id="k-login-phone" placeholder="Phone number" style="width:100%;padding:14px;margin:8px 0;font-size:18px">
      <input id="k-login-pass" type="password" placeholder="Password" style="width:100%;padding:14px;margin:8px 0;font-size:18px">
      <p id="k-login-err" style="color:#f87171"></p>
      <button class="btn-primary" data-act="do-login" style="width:100%;padding:14px">Sign in</button>
      <button class="btn-secondary" data-act="close" style="width:100%;padding:12px;margin-top:8px">Cancel</button></div>`;
    document.body.appendChild(modal);
    modal.onclick = async (e) => {
      if (e.target.closest('[data-act="close"]')) return modal.remove();
      if (!e.target.closest('[data-act="do-login"]')) return;
      const phone = document.getElementById('k-login-phone')?.value.trim();
      const pass = document.getElementById('k-login-pass')?.value;
      try {
        const r = await KioskAPI.customerLogin(this.deviceToken, phone, pass);
        this.webToken = r.token;
        this.webCustomer = r.customer;
        try { sessionStorage.setItem('kiosk_web_token', r.token); } catch (_) { /* */ }
        await this.refreshCustomerBenefits();
        modal.remove();
        this.render();
      } catch (ex) {
        const err = document.getElementById('k-login-err');
        if (err) err.textContent = ex.message;
      }
    };
  },

  openProduct(pid) {
    this.resetIdle();
    this.selectedProduct = (this.catalog.products || []).find((p) => p.id === pid);
    if (!this.selectedProduct?.available) return;
    this.selectedMods = []; this.qty = 1;
    const p = this.selectedProduct;
    // Prefer full modifiers list; options/extras are subsets and must not be concatenated (duplicates).
    const mods = (p.modifiers && p.modifiers.length)
      ? p.modifiers
      : [...(p.options || []), ...(p.extras || []), ...(p.removals || [])];
    this.closeModals();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-inner">
      <div class="modal-media">${this.productMediaHtml(p, 'modal-product-img')}</div>
      <h2>${this.esc(p.name)}</h2><p class="price">${this.money(p.selling_price)}</p>
      ${mods.length ? `<div class="mod-group">${mods.map((m, i) =>
        `<label class="mod-opt" data-mod="${i}"><input type="checkbox" style="margin-right:8px">${this.esc(m.name)} ${m.extra_price ? `(+${this.money(m.extra_price)})` : ''}</label>`).join('')}</div>` : ''}
      <div class="qty-row"><button data-q="-1">−</button><span id="qty-val">${this.qty}</span><button data-q="1">+</button></div>
      <button class="btn-primary" style="width:100%;padding:16px;margin-top:12px" data-act="add">Add to Cart</button>
      <button class="btn-secondary" style="width:100%;padding:12px;margin-top:8px" data-act="close">Cancel</button></div>`;
    document.body.appendChild(modal);
    modal.onclick = (e) => {
      if (e.target.closest('[data-q]')) { this.qty = Math.max(1, this.qty + Number(e.target.closest('[data-q]').dataset.q)); document.getElementById('qty-val').textContent = this.qty; }
      if (e.target.closest('[data-mod]')) e.target.closest('[data-mod]').classList.toggle('selected');
      if (e.target.closest('[data-act="close"]')) modal.remove();
      if (e.target.closest('[data-act="add"]')) {
        const selected = [...modal.querySelectorAll('.mod-opt.selected')].map((el) => {
          const idx = Number(el.dataset.mod);
          const m = mods[idx];
          return { name: m.name, extra_price: m.extra_price };
        });
        let unitPrice = Number(p.selling_price) + selected.reduce((s, m) => s + (Number(m.extra_price) || 0), 0);
        if (!this.cart.length) this.sessionStartedAt = Date.now();
        this.cart.push({ product_id: p.id, product_name: p.name, quantity: this.qty, unit_price: unitPrice, modifiers: selected });
        modal.remove(); this.render();
      }
    };
  },

  renderCart(app) {
    app.innerHTML = `${this.customerBarHtml()}<div class="kiosk-header"><h1>Your Cart</h1>
      ${this.headerActionsHtml('<button class="btn-secondary kiosk-header-btn" data-act="back">← Back</button>')}</div>
      <div style="flex:1;overflow-y:auto;padding:24px">${this.cart.map((it, i) =>
        `<div style="display:flex;justify-content:space-between;padding:16px 0;border-bottom:1px solid #334155;font-size:20px">
          <span>${it.quantity}× ${this.esc(it.product_name)}</span><span>${this.money(it.unit_price * it.quantity)}</span>
          <button data-rm="${i}" style="background:#dc2626;border:none;color:#fff;padding:8px 12px;border-radius:8px">×</button></div>`).join('') || '<p class="muted">Cart is empty</p>'}
      <div style="font-size:28px;text-align:right;margin-top:20px">Total: <strong>${this.money(this.cartTotal())}</strong></div></div>
      <div class="cart-bar"><button class="btn-primary" ${this.cart.length ? '' : 'disabled'} data-act="checkout">Checkout</button></div>`;
    app.onclick = (e) => {
      if (e.target.closest('[data-act="back"]')) { this.view = 'browse'; this.render(); }
      if (e.target.closest('[data-rm]')) { this.cart.splice(Number(e.target.closest('[data-rm]').dataset.rm), 1); this.render(); }
      if (e.target.closest('[data-act="checkout"]')) { this.view = 'checkout'; this.render(); }
    };
  },

  renderCheckout(app) {
    const methods = this.paymentMethods();
    if (!methods.some((m) => m.id === this.paymentMethod)) this.paymentMethod = methods[0]?.id || 'cash';
    const disc = Number(this.voucherDiscount) + Number(this.couponDiscount) + Number(this.giftCardAmount) + (Number(this.loyaltyPointsUsed) * (Number(this.customerBenefits?.point_value) || 1));
    const total = Math.max(0, this.cartTotal() - disc);
    const b = this.customerBenefits;
    const benefits = b ? `<div style="background:#1e293b;padding:12px;border-radius:10px;margin-bottom:16px;font-size:15px">
      ${b.referral_code ? `Referral: ${this.esc(b.referral_code)}<br>` : ''}
      ${b.gift_card ? `Gift card: ${this.money(b.gift_card.balance)}` : ''}
    </div>` : '';
    app.innerHTML = `${this.customerBarHtml()}<div class="kiosk-header"><h1>Payment</h1>
      ${this.headerActionsHtml('<button class="btn-secondary kiosk-header-btn" data-act="back">← Back</button>')}</div>
      <div class="kiosk-checkout-body">
        ${benefits}
        <p style="font-size:32px;margin-bottom:12px">Total: <strong>${this.money(total)}</strong></p>
        ${disc > 0 ? `<p class="muted" style="margin-bottom:16px">Discounts applied: −${this.money(disc)}</p>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input id="kiosk-coupon" value="${this.esc(this.couponCode || '')}" placeholder="Coupon / referral" style="flex:1;padding:14px;font-size:18px;text-transform:uppercase">
          <button class="btn-secondary" data-act="apply-coupon" style="padding:14px 18px">Apply</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input id="kiosk-gift" value="${this.esc(this.giftCardCode || '')}" placeholder="Gift card code" style="flex:1;padding:14px;font-size:18px">
          <button class="btn-secondary" data-act="apply-gift" style="padding:14px 18px">Check</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px">
          <input id="kiosk-voucher" value="${this.esc(this.voucherCode || '')}" placeholder="Voucher code" style="flex:1;padding:14px;font-size:18px;text-transform:uppercase">
          <button class="btn-secondary" data-act="apply-voucher" style="padding:14px 18px">Apply</button>
        </div>
        <p class="muted" style="margin-bottom:12px">Select payment method</p>
        <div class="pay-methods-grid">${methods.map((m) => `<button type="button" class="pay-btn ${this.paymentMethod === m.id ? 'selected' : ''}" data-pay="${this.esc(m.id)}">${this.esc(m.label || this.paymentLabel(m.id))}</button>`).join('')}</div>
        <button class="btn-primary kiosk-checkout-confirm" data-act="confirm">Confirm Order</button>
        <p id="checkout-err" style="color:#f87171;margin-top:12px"></p></div>`;
    app.onclick = async (e) => {
      if (e.target.closest('[data-pay]')) { this.paymentMethod = e.target.closest('[data-pay]').dataset.pay; this.render(); }
      if (e.target.closest('[data-act="back"]')) { this.view = 'cart'; this.render(); }
      if (e.target.closest('[data-act="apply-coupon"]')) {
        const code = document.getElementById('kiosk-coupon')?.value.trim();
        const err = document.getElementById('checkout-err');
        if (!code) { if (err) err.textContent = 'Enter a coupon code'; return; }
        try {
          const r = await KioskAPI.validateCoupon(this.deviceToken, code, {
            subtotal: this.cartTotal(),
            items: this.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, price: c.unit_price }))
          }, this.webToken);
          if (r?.error) { if (err) err.textContent = r.error; return; }
          this.couponCode = r.code || code;
          this.couponDiscount = Number(r.discount) || 0;
          if (r.type === 'referral') this.referralCode = this.couponCode;
          if (err) err.textContent = '';
          this.render();
        } catch (ex) { if (err) err.textContent = ex.message; }
      }
      if (e.target.closest('[data-act="apply-gift"]')) {
        const code = document.getElementById('kiosk-gift')?.value.trim();
        const err = document.getElementById('checkout-err');
        try {
          const r = await KioskAPI.checkGiftCard(this.deviceToken, code);
          this.giftCardCode = code.toUpperCase();
          this.giftCardAmount = Math.min(Number(r.balance) || 0, this.cartTotal());
          if (err) err.textContent = '';
          this.render();
        } catch (ex) { if (err) err.textContent = ex.message; }
      }
      if (e.target.closest('[data-act="apply-voucher"]')) {
        const code = document.getElementById('kiosk-voucher')?.value.trim();
        const err = document.getElementById('checkout-err');
        if (!code) { if (err) err.textContent = 'Enter a voucher code'; return; }
        try {
          const r = await KioskAPI.validateVoucher(this.deviceToken, code, {
            subtotal: this.cartTotal(),
            items: this.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, price: c.price || c.unit_price }))
          });
          if (r?.error || !r?.ok) {
            this.voucherCode = ''; this.voucherDiscount = 0;
            if (err) err.textContent = r?.error || 'Invalid voucher';
            return;
          }
          this.voucherCode = r.code;
          this.voucherDiscount = Number(r.discount) || 0;
          if (err) err.textContent = '';
          this.render();
        } catch (ex) { if (err) err.textContent = ex.message; }
      }
      if (e.target.closest('[data-act="confirm"]')) {
        const err = document.getElementById('checkout-err');
        if (this.submitting) return;
        const btn = e.target.closest('[data-act="confirm"]');
        btn.disabled = true;
        btn.textContent = 'Sending order…';
        this.preparePending();
        try {
          await this.submitPending();
        } catch (ex) {
          if (ex.network) { this.showPendingScreen(); return; }
          btn.disabled = false;
          btn.textContent = 'Confirm Order';
          if (err) err.textContent = ex.message;
        }
      }
    };
  },

  newOrder() {
    clearTimeout(this.confirmTimer);
    this.clearCustomerSession();
    this.view = 'browse';
    this.render();
    this.resetIdle();
  }
};

try {
  const savedTok = sessionStorage.getItem('kiosk_web_token');
  if (savedTok) KioskApp.webToken = savedTok;
} catch (_) { /* */ }

KioskApp.init();
