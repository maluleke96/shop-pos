const KioskApp = {
  deviceToken: localStorage.getItem('kiosk_device_token') || '',
  catalog: null, cart: [], view: 'browse', categoryId: null,
  idleTimer: null, idleSec: 120, selectedProduct: null, selectedMods: [], qty: 1, paymentMethod: 'card',

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  money(n) { return `R${Number(n || 0).toFixed(2)}`; },

  productImageUrl(p) {
    if (!p?.has_image || !p?.image_url || !this.deviceToken) return null;
    return `${p.image_url}?token=${encodeURIComponent(this.deviceToken)}`;
  },

  productMediaHtml(p, cls = 'product-img') {
    const src = this.productImageUrl(p);
    if (!src) return '<div class="product-img-fallback" aria-hidden="true">🍽️</div>';
    return `<img class="${cls}" src="${this.esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.classList.add('img-fail')">` +
      '<div class="product-img-fallback" aria-hidden="true">🍽️</div>';
  },

  async init() {
    if (this.deviceToken) {
      try { await this.loadCatalog(); this.showApp(); this.startHeartbeat(); return; } catch (_) {}
    }
    await this.startPairing();
  },

  closeModals() {
    document.querySelectorAll('.modal').forEach((m) => m.remove());
  },

  resetIdle() {
    clearTimeout(this.idleTimer);
    document.getElementById('idle-overlay')?.classList.add('hidden');
    const sec = Math.max(30, Number(this.idleSec) || 120);
    this.idleTimer = setTimeout(() => {
      if (this.view === 'confirm') return;
      this.closeModals();
      document.getElementById('idle-overlay')?.classList.remove('hidden');
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
    setInterval(() => KioskAPI.heartbeat(this.deviceToken, { online: navigator.onLine }).catch(() => {}), 30000);
  },

  async loadCatalog() {
    this.catalog = await KioskAPI.catalog(this.deviceToken);
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
      this.cart = []; this.view = 'browse'; this.resetIdle(); this.render();
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
        <p class="muted">Please collect your order when ready</p>
        <button class="btn-primary" onclick="KioskApp.newOrder()" style="margin-top:40px;padding:20px 40px;font-size:20px">New Order</button></div>`;
      return;
    }
    if (this.view === 'checkout') return this.renderCheckout(app);
    if (this.view === 'cart') return this.renderCart(app);
    app.innerHTML = `<div class="kiosk-header"><h1>${this.esc(this.catalog?.settings?.welcome_message || 'Order Here')}</h1>
      <span class="muted">${this.esc(this.catalog?.device?.name || '')}</span></div>
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
    };
  },

  openProduct(pid) {
    this.selectedProduct = (this.catalog.products || []).find((p) => p.id === pid);
    if (!this.selectedProduct?.available) return;
    this.selectedMods = []; this.qty = 1;
    const p = this.selectedProduct;
    // Prefer full modifiers list; options/extras are subsets and must not be concatenated (duplicates).
    const mods = (p.modifiers && p.modifiers.length)
      ? p.modifiers
      : [...(p.options || []), ...(p.extras || []), ...(p.removals || [])];
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-inner">${this.productMediaHtml(p, 'modal-product-img')}
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
        this.cart.push({ product_id: p.id, product_name: p.name, quantity: this.qty, unit_price: unitPrice, modifiers: selected });
        modal.remove(); this.render();
      }
    };
  },

  renderCart(app) {
    app.innerHTML = `<div class="kiosk-header"><h1>Your Cart</h1><button class="btn-secondary" data-act="back">← Back</button></div>
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
    const methods = this.catalog?.settings?.payment_methods || ['card', 'cash'];
    app.innerHTML = `<div class="kiosk-header"><h1>Payment</h1></div>
      <div style="flex:1;padding:40px;max-width:500px;margin:0 auto;width:100%">
        <p style="font-size:32px;margin-bottom:24px">Total: <strong>${this.money(this.cartTotal())}</strong></p>
        <p class="muted" style="margin-bottom:12px">Select payment method</p>
        ${methods.map((m) => `<button class="pay-btn ${this.paymentMethod === m ? 'selected' : ''}" data-pay="${m}">${this.esc(m.toUpperCase())}</button>`).join('')}
        <button class="btn-primary" style="width:100%;padding:20px;margin-top:24px;font-size:22px" data-act="confirm">Confirm Order</button>
        <button class="btn-secondary" style="width:100%;padding:14px;margin-top:8px" data-act="back">Back</button>
        <p id="checkout-err" style="color:#f87171;margin-top:12px"></p></div>`;
    app.onclick = async (e) => {
      if (e.target.closest('[data-pay]')) { this.paymentMethod = e.target.closest('[data-pay]').dataset.pay; this.render(); }
      if (e.target.closest('[data-act="back"]')) { this.view = 'cart'; this.render(); }
      if (e.target.closest('[data-act="confirm"]')) {
        const err = document.getElementById('checkout-err');
        try {
          const r = await KioskAPI.placeOrder(this.deviceToken, {
            items: this.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, modifiers: c.modifiers })),
            payment_method: this.paymentMethod,
            client_request_id: `kiosk-${Date.now()}-${Math.random().toString(36).slice(2)}`
          });
          this.lastOrderNumber = r.order_number;
          this.cart = []; this.view = 'confirm'; this.render();
        } catch (ex) { if (err) err.textContent = ex.message; }
      }
    };
  },

  newOrder() { this.view = 'browse'; this.render(); this.resetIdle(); }
};

KioskApp.init();
