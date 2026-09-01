/* Customer online ordering — branch-scoped PWA */
const OrderApp = {
  view: 'splash',
  branch: null,
  settings: null,
  menu: null,
  categoryId: null,
  search: '',
  cart: [],
  token: localStorage.getItem('order_token') || '',
  customer: null,
  product: null,
  checkout: { fulfillment_type: 'collection', payment_method: 'card', coupon_code: '', loyalty_points_used: 0, notes: '', delivery_address: '' },
  lastOrder: null,
  quote: null,
  loyaltyAccount: null,

  money(n) {
    const c = this.settings?.currency || 'R';
    return `${c}${(Number(n) || 0).toFixed(2)}`;
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },

  toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  async refreshLoyaltyAccount() {
    if (!this.token) { this.loyaltyAccount = null; return; }
    try {
      const acct = await OrderAPI.account(this.token);
      this.loyaltyAccount = acct.loyalty || null;
      this.customer = acct.profile || this.customer;
    } catch (_) { this.loyaltyAccount = null; }
  },

  loyaltySettings() {
    const ls = this.settings?.loyalty || {};
    return {
      enabled: ls.enabled !== false && this.settings?.online?.loyalty_enabled !== false,
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

  async init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    try {
      this.settings = await OrderAPI.getSettings();
      if (this.token) {
        try {
          const acct = await OrderAPI.account(this.token);
          this.customer = acct.profile;
          this.loyaltyAccount = acct.loyalty || null;
        } catch (_) { this.token = ''; localStorage.removeItem('order_token'); }
      }
      const savedBranch = localStorage.getItem('order_branch');
      if (savedBranch) {
        const branches = await OrderAPI.getBranches();
        this.branch = branches.find((b) => String(b.id) === savedBranch) || null;
      }
      this.view = this.branch ? (this.token ? 'home' : 'welcome') : 'branches';
      this.render();
      if (this.branch) this.loadMenu();
    } catch (err) {
      document.getElementById('app').innerHTML = `<div class="empty-state"><h2>Unable to connect</h2><p>${this.esc(err.message)}</p></div>`;
    }
  },

  async loadMenu() {
    if (!this.branch) return;
    try {
      this.menu = await OrderAPI.getMenu(this.branch.id, { q: this.search || undefined, category_id: this.categoryId || undefined });
      if (this.view === 'home' || this.view === 'menu') this.render();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  cartCount() { return this.cart.reduce((s, i) => s + i.quantity, 0); },

  addToCart(item) {
    const key = `${item.product_id}:${JSON.stringify(item.modifiers || [])}`;
    const existing = this.cart.find((c) => c._key === key);
    if (existing) existing.quantity += item.quantity || 1;
    else this.cart.push({ ...item, _key: key });
    this.toast('Added to cart', 'success');
    this.render();
  },

  updateCartQty(key, delta) {
    const item = this.cart.find((c) => c._key === key);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) this.cart = this.cart.filter((c) => c._key !== key);
    this.render();
  },

  async validateCurrentCart() {
    if (!this.branch || !this.cart.length) return null;
    return OrderAPI.validateCart(this.branch.id, {
      items: this.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, modifiers: c.modifiers })),
      fulfillment_type: this.checkout.fulfillment_type,
      coupon_code: this.checkout.coupon_code || undefined,
      loyalty_points_used: this.checkout.loyalty_points_used || 0,
      web_customer_id: this.customer?.id
    });
  },

  bind() {
    const app = document.getElementById('app');
    app.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'nav') {
        const next = btn.dataset.view;
        if ((next === 'account' || next === 'orders') && !this.token) {
          this.view = 'login';
          this.authReturn = next;
        } else {
          this.view = next;
        }
        if (this.view === 'menu') this.loadMenu();
        else this.render();
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
        localStorage.setItem('order_branch', id);
        this.view = this.token ? 'home' : 'welcome';
        await this.loadMenu();
        this.render();
        return;
      }
      if (act === 'open-product') {
        const pid = btn.dataset.id;
        this.product = await OrderAPI.getProduct(this.branch.id, pid);
        this.view = 'product';
        this.render();
        return;
      }
      if (act === 'add-cart') {
        const pid = Number(btn.dataset.id);
        const qty = Number(document.getElementById('prod-qty')?.value || 1);
        const mods = [];
        document.querySelectorAll('[data-mod-group]').forEach((g) => {
          const gid = g.dataset.modGroup;
          const required = g.dataset.required === '1';
          const type = g.dataset.type || 'radio';
          if (type === 'radio') {
            const sel = g.querySelector('input:checked');
            if (sel) mods.push({ id: Number(sel.value), name: sel.dataset.name });
            else if (required) throw new Error(`Please choose ${gid}`);
          } else {
            g.querySelectorAll('input:checked').forEach((cb) => mods.push({ id: Number(cb.value), name: cb.dataset.name }));
          }
        });
        try {
          this.addToCart({ product_id: pid, name: this.product.name, quantity: qty, modifiers: mods, unit_price: this.product.sale_price ?? this.product.price });
          this.view = 'menu';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
        return;
      }
      if (act === 'cart-inc') { this.updateCartQty(btn.dataset.key, 1); return; }
      if (act === 'cart-dec') { this.updateCartQty(btn.dataset.key, -1); return; }
      if (act === 'cart-remove') { this.cart = this.cart.filter((c) => c._key !== btn.dataset.key); this.render(); return; }
      if (act === 'checkout') {
        if (!this.token) { this.view = 'register'; this.authReturn = 'checkout'; this.render(); return; }
        this.quote = await this.validateCurrentCart();
        if (this.quote && !this.quote.valid) { this.toast(this.quote.errors.join('; '), 'error'); return; }
        await this.refreshLoyaltyAccount();
        this.view = 'checkout';
        this.render();
        return;
      }
      if (act === 'apply-coupon') {
        this.checkout.coupon_code = document.getElementById('coupon-code')?.value.trim() || '';
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
        const btn2 = btn;
        btn2.disabled = true;
        try {
          if (!this.cart.length) { this.toast('Your cart is empty', 'error'); return; }
          this.checkout.loyalty_points_used = parseInt(document.getElementById('loyalty-points')?.value || String(this.checkout.loyalty_points_used || 0), 10) || 0;
          const idem = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          this.checkout.fulfillment_type = document.querySelector('input[name=fulfillment]:checked')?.value || 'collection';
          this.checkout.payment_method = document.querySelector('input[name=payment_method]:checked')?.value || 'card';
          this.checkout.delivery_address = document.getElementById('delivery-address')?.value || '';
          this.checkout.notes = document.getElementById('order-notes')?.value || '';
          const orderPayload = {
            ...this.checkout,
            items: this.cart.map((c) => ({
              product_id: c.product_id,
              quantity: c.quantity,
              modifiers: c.modifiers || []
            }))
          };
          this.lastOrder = await OrderAPI.submitOrder(this.branch.id, orderPayload, this.token, idem);
          this.cart = [];
          this.view = 'confirmed';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn2.disabled = false; }
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
          this.token = r.token;
          localStorage.setItem('order_token', this.token);
          this.customer = r.customer;
          await this.refreshLoyaltyAccount();
          const dest = this.authReturn || (this.branch ? 'home' : 'branches');
          this.authReturn = null;
          this.view = dest;
          this.toast('Welcome back!', 'success');
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
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
        btn.textContent = 'Creating account…';
        try {
          const r = await OrderAPI.register({ first_name: first, last_name: last, email, phone, password: pass });
          this.token = r.token;
          localStorage.setItem('order_token', this.token);
          this.customer = r.customer;
          await this.refreshLoyaltyAccount();
          this.authReturn = null;
          this.view = this.branch ? 'home' : 'branches';
          this.toast('Account created', 'success');
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = prev; }
        return;
      }
      if (act === 'logout') {
        this.token = '';
        this.customer = null;
        localStorage.removeItem('order_token');
        this.view = 'home';
        this.render();
        return;
      }
      if (act === 'modal-close') {
        document.getElementById('modal-root').classList.add('hidden');
        return;
      }
    };
    app.onsubmit = (e) => {
      const form = e.target.closest('form[data-form]');
      if (!form) return;
      e.preventDefault();
      const submit = form.querySelector('[data-act="login-submit"], [data-act="register-submit"]');
      submit?.click();
    };
    app.onchange = async (e) => {
      if (e.target.id === 'menu-search') { this.search = e.target.value; await this.loadMenu(); }
      if (e.target.dataset.cat != null) { this.categoryId = e.target.value || null; await this.loadMenu(); }
      if (e.target.name === 'fulfillment') {
        this.checkout.fulfillment_type = e.target.value;
        const firstPay = (this.settings?.online?.payment_methods || []).find((m) => m.enabled !== false && (!m.fulfillment || m.fulfillment === 'any' || m.fulfillment === e.target.value));
        if (firstPay) this.checkout.payment_method = firstPay.id;
        this.quote = await this.validateCurrentCart();
        this.render();
      }
      if (e.target.id === 'loyalty-points') {
        this.checkout.loyalty_points_used = parseInt(e.target.value, 10) || 0;
      }
      if (e.target.name === 'payment_method') this.checkout.payment_method = e.target.value;
    };
  },

  shell(body, title = '') {
    const branchChip = this.branch ? `<div class="branch-banner">
      <span>📍 Ordering from <strong>${this.esc(this.branch.name)}</strong></span>
      <button type="button" data-act="nav" data-view="branches" class="link-btn">Change branch</button>
    </div>` : '';
    const cartBtn = `<button type="button" class="cart-fab" data-act="nav" data-view="cart">${this.cartCount() ? `<span class="cart-badge">${this.cartCount()}</span>` : ''}🛒</button>`;
    return `<div class="order-app">
      <header class="topbar"><div class="brand">${this.esc(this.settings?.shop_name || 'Order Online')}</div>
        <div class="top-actions">
          ${this.customer
            ? `<button type="button" class="ghost-btn" data-act="nav" data-view="account">${this.esc(this.customer.first_name)}</button>`
            : `<button type="button" class="ghost-btn" data-act="nav" data-view="register">Register</button>
               <button type="button" class="ghost-btn" data-act="nav" data-view="login" style="margin-left:6px">Sign in</button>`}
        </div></header>
      ${branchChip}
      <main class="main">${body}</main>
      ${this.view !== 'cart' && this.view !== 'checkout' ? cartBtn : ''}
      <nav class="bottom-nav">
        <button type="button" data-act="nav" data-view="home" class="${this.view === 'home' ? 'active' : ''}">Home</button>
        <button type="button" data-act="nav" data-view="menu" class="${this.view === 'menu' ? 'active' : ''}">Menu</button>
        <button type="button" data-act="nav" data-view="orders" class="${this.view === 'orders' ? 'active' : ''}">Orders</button>
        <button type="button" data-act="nav" data-view="account" class="${this.view === 'account' ? 'active' : ''}">Account</button>
      </nav></div>`;
  },

  async render() {
    const app = document.getElementById('app');
    if (this.view === 'branches') {
      const branches = await OrderAPI.getBranches();
      app.innerHTML = this.shell(`<section class="page branch-step">
        <div class="branch-step-icon">📍</div>
        <h1>Select your closest branch</h1>
        <p class="lead">Choose the branch nearest to you — your menu, stock, and delivery options depend on this.</p>
        ${!this.token ? `<div class="checkout-card" style="text-align:center;margin-bottom:20px">
          <p style="margin:0 0 12px"><strong>Create an account</strong> to earn loyalty points and checkout faster.</p>
          <button type="button" class="btn-primary" data-act="nav" data-view="register" style="margin-right:8px">Register free</button>
          <button type="button" class="btn-outline" data-act="nav" data-view="login">Sign in</button>
        </div>` : ''}
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
      app.innerHTML = this.shell(`<section class="page">
        <div class="hero-card">
          <h1>Welcome to ${this.esc(this.settings?.shop_name || 'our shop')}</h1>
          <p class="lead">Order for collection or delivery from <strong>${this.esc(this.branch?.name)}</strong></p>
          <button type="button" class="btn-primary btn-block" data-act="nav" data-view="register" style="margin-bottom:10px">Create account &amp; earn points</button>
          <button type="button" class="btn-outline btn-block" data-act="nav" data-view="login" style="border-color:#fff;color:#fff">I already have an account</button>
        </div>
        <button type="button" class="link-btn" data-act="nav" data-view="home">Continue as guest →</button>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'home') {
      const specials = this.menu?.specials || [];
      app.innerHTML = this.shell(`<section class="page">
        <div class="hero-card">
          <h1>Hello${this.customer ? `, ${this.esc(this.customer.first_name)}` : ''} 👋</h1>
          <p class="lead">Fresh food from <strong>${this.esc(this.branch?.name)}</strong> — delivery or collection</p>
          <button type="button" class="btn-primary btn-block" data-act="nav" data-view="menu">Browse menu</button>
        </div>
        ${this.loyaltyAccount && this.loyaltySettings().enabled ? `<div class="loyalty-card">
          <h3>⭐ Your loyalty points</h3>
          <div class="loyalty-balance">${this.loyaltyAccount.balance} pts</div>
          <div class="muted">Worth ${this.money(this.loyaltyAccount.value)} at checkout</div>
        </div>` : (!this.token ? `<div class="checkout-card"><p class="muted" style="margin:0 0 10px">Register to earn points on every order.</p>
          <button type="button" class="btn-primary btn-sm" data-act="nav" data-view="register">Register now</button></div>` : '')}
        ${specials.length ? `<h2>Today's specials</h2><div class="product-grid">${specials.slice(0, 6).map((p) => this.productCard(p)).join('')}</div>` : ''}
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'menu') {
      const cats = this.menu?.categories || [];
      const products = this.menu?.products || [];
      app.innerHTML = this.shell(`<section class="page">
        <div class="toolbar"><input type="search" id="menu-search" placeholder="Search menu…" value="${this.esc(this.search)}">
        <select data-cat><option value="">All</option>${cats.map((c) => `<option value="${c.id}" ${String(this.categoryId) === String(c.id) ? 'selected' : ''}>${this.esc(c.name)}</option>`).join('')}</select></div>
        <div class="product-grid">${products.map((p) => this.productCard(p)).join('') || '<p class="muted">No products found.</p>'}</div>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'product' && this.product) {
      const p = this.product;
      const groups = p.modifier_groups || [];
      app.innerHTML = this.shell(`<section class="page product-detail">
        <button type="button" class="back-btn" data-act="nav" data-view="menu">← Back</button>
        ${p.image ? `<img class="prod-img" src="${this.esc(p.image)}" alt="">` : '<div class="prod-img placeholder">🍽️</div>'}
        <h1>${this.esc(p.name)}</h1>
        <p class="muted">${this.esc(p.description)}</p>
        <div class="price-row">${p.on_sale ? `<s>${this.money(p.price)}</s> <strong class="sale">${this.money(p.sale_price)}</strong>` : `<strong>${this.money(p.price)}</strong>`}
        <span class="stock ${p.available ? 'ok' : 'out'}">${p.available ? '● Available' : 'Out of stock'}</span></div>
        ${groups.map((g) => `<fieldset class="mod-group" data-mod-group="${this.esc(g.name)}" data-required="${g.required ? '1' : '0'}" data-type="radio">
          <legend>${this.esc(g.name)}${g.required ? ' *' : ''}</legend>
          ${g.options.map((o) => `<label class="mod-opt ${o.out_of_stock ? 'disabled' : ''}"><input type="radio" name="mod-${this.esc(g.name)}" value="${o.id}" data-name="${this.esc(o.name)}" ${o.out_of_stock ? 'disabled' : ''}>
            ${this.esc(o.name)}${o.extra_price ? ` +${this.money(o.extra_price)}` : ''}${o.out_of_stock ? ' (Out of stock)' : ''}</label>`).join('')}
        </fieldset>`).join('')}
        <div class="qty-row"><label>Qty</label><input type="number" id="prod-qty" min="1" value="1" class="qty-input"></div>
        <button type="button" class="btn-primary btn-block" data-act="add-cart" data-id="${p.id}" ${p.available ? '' : 'disabled'}>Add to cart</button>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'cart') {
      app.innerHTML = this.shell(`<section class="page"><h1>Your order</h1>
        ${this.cart.length ? this.cart.map((c) => `<div class="cart-line">
          <div><strong>${this.esc(c.name)}</strong><div class="muted">× ${c.quantity}</div></div>
          <div class="cart-actions">
            <button type="button" data-act="cart-dec" data-key="${c._key}">−</button>
            <span>${c.quantity}</span>
            <button type="button" data-act="cart-inc" data-key="${c._key}">+</button>
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
        <div class="checkout-card"><h3>Order type</h3>
          <label><input type="radio" name="fulfillment" value="collection" ${fulfillment === 'collection' ? 'checked' : ''}> 🏪 Collection — pick up at branch</label>
          <label><input type="radio" name="fulfillment" value="delivery" ${fulfillment === 'delivery' ? 'checked' : ''}> 🚚 Delivery</label>
        </div>
        <div id="delivery-fields" class="checkout-card ${fulfillment === 'delivery' ? '' : 'hidden'}">
          <h3>Delivery address</h3>
          <textarea id="delivery-address" rows="3" placeholder="Street, suburb, city…">${this.esc(this.checkout.delivery_address)}</textarea>
        </div>
        <div class="checkout-card"><h3>Payment</h3>
          ${methods.map((m) => `<label><input type="radio" name="payment_method" value="${this.esc(m.id)}" ${(this.checkout.payment_method || methods[0]?.id) === m.id ? 'checked' : ''}> ${this.esc(m.label || m.id)}</label>`).join('')}
        </div>
        ${ls.enabled && this.loyaltyAccount ? `<div class="loyalty-card">
          <h3>⭐ Use loyalty points</h3>
          <div class="loyalty-balance">${this.loyaltyAccount.balance} pts available · ${this.money(this.loyaltyAccount.value)}</div>
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
        <div class="checkout-card">
          <h3>Coupon code</h3>
          <div style="display:flex;gap:8px"><input id="coupon-code" value="${this.esc(this.checkout.coupon_code)}" placeholder="Enter code"><button type="button" class="btn-sm" data-act="apply-coupon">Apply</button></div>
        </div>
        <div class="checkout-card">
          <h3>Special instructions</h3>
          <textarea id="order-notes" rows="2" placeholder="Allergies, gate code, etc.">${this.esc(this.checkout.notes)}</textarea>
        </div>
        <div class="totals">
          <div>Subtotal <span>${this.money(q.subtotal)}</span></div>
          ${q.loyalty_discount ? `<div>Loyalty <span>-${this.money(q.loyalty_discount)}</span></div>` : ''}
          ${q.discount && !q.loyalty_discount ? `<div>Discount <span>-${this.money(q.discount)}</span></div>` : ''}
          ${q.discount && q.loyalty_discount ? `<div>Other discount <span>-${this.money(Math.max(0, (q.discount || 0) - (q.loyalty_discount || 0)))}</span></div>` : ''}
          ${q.delivery_fee ? `<div>Delivery <span>${this.money(q.delivery_fee)}</span></div>` : ''}
          ${q.tax_amount ? `<div>Tax <span>${this.money(q.tax_amount)}</span></div>` : ''}
          <div class="total-line">Total <strong>${this.money(q.total)}</strong></div>
        </div>
        <button type="button" class="btn-primary btn-block" data-act="place-order">Place order · ${this.money(q.total)}</button>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'confirmed' && this.lastOrder) {
      app.innerHTML = this.shell(`<section class="page confirmed">
        <div class="success-icon">✓</div>
        <h1>Order confirmed</h1>
        <p class="order-num">${this.esc(this.lastOrder.order_number)}</p>
        <p><strong>${this.esc(this.branch?.name)}</strong> · ${this.money(this.lastOrder.total)}</p>
        <p class="muted">We'll notify you when the branch accepts your order.</p>
        <button type="button" class="btn-primary btn-block" data-act="nav" data-view="orders">Track my order</button>
        <button type="button" class="btn-outline btn-block" data-act="nav" data-view="menu" style="margin-top:10px">Order again</button>
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'orders') {
      if (!this.token) { this.view = 'login'; this.authReturn = 'orders'; return this.render(); }
      let orders = [];
      try { orders = await OrderAPI.listOrders(this.token); } catch (err) {
        if (/invalid|expired|session/i.test(err.message)) {
          this.token = ''; localStorage.removeItem('order_token'); this.customer = null;
          this.view = 'login'; this.authReturn = 'orders'; this.toast('Please sign in again', 'error'); return this.render();
        }
        this.toast(err.message, 'error');
      }
      app.innerHTML = this.shell(`<section class="page"><h1>My orders</h1>
        ${orders.length ? orders.map((o) => `<div class="order-card"><strong>${this.esc(o.order_number)}</strong>
          <span>${this.money(o.total)} · ${this.esc(o.status)}</span>
          <span class="muted">${this.esc(String(o.created_at).slice(0, 16))}</span></div>`).join('') : '<p class="muted">No orders yet.</p>'}
      </section>`);
      this.bind();
      return;
    }
    if (this.view === 'login') {
      app.innerHTML = `<div class="auth-page"><form class="auth-card" data-form="login" novalidate>
        <h1>Sign in</h1>
        <p class="muted auth-lead">Sign in to checkout, track orders, and earn loyalty points.</p>
        <label>Email or phone<input id="login-id" type="text" autocomplete="username" required placeholder="you@email.com or 082…"></label>
        <label>Password<input type="password" id="login-pass" autocomplete="current-password" required placeholder="Your password"></label>
        <button type="submit" class="btn-primary btn-block" data-act="login-submit">Sign in</button>
        <button type="button" class="link-btn" data-act="nav" data-view="register">Create account</button>
        <button type="button" class="link-btn" data-act="nav" data-view="home">← Back to menu</button>
      </form></div>`;
      this.bind();
      document.getElementById('login-id')?.focus();
      return;
    }
    if (this.view === 'register') {
      app.innerHTML = `<div class="auth-page"><form class="auth-card" data-form="register" novalidate>
        <h1>Create account</h1>
        <p class="muted auth-lead">Register once — order faster next time.</p>
        <label>First name<input id="reg-first" autocomplete="given-name" required></label>
        <label>Last name<input id="reg-last" autocomplete="family-name"></label>
        <label>Email<input id="reg-email" type="email" autocomplete="email" placeholder="you@email.com"></label>
        <label>Mobile<input id="reg-phone" type="tel" autocomplete="tel" placeholder="082 123 4567"></label>
        <label>Password (min 6 characters)<input type="password" id="reg-pass" autocomplete="new-password" required minlength="6"></label>
        <button type="submit" class="btn-primary btn-block" data-act="register-submit">Create account</button>
        <button type="button" class="link-btn" data-act="nav" data-view="login">Already have an account?</button>
      </form></div>`;
      this.bind();
      document.getElementById('reg-first')?.focus();
      return;
    }
    if (this.view === 'account') {
      if (!this.token) { this.view = 'login'; this.authReturn = 'account'; return this.render(); }
      let acct = null;
      try { acct = await OrderAPI.account(this.token); } catch (err) {
        this.token = ''; localStorage.removeItem('order_token'); this.customer = null;
        this.toast(err.message || 'Session expired — please sign in again', 'error');
        this.view = 'login'; this.authReturn = 'account'; return this.render();
      }
      app.innerHTML = this.shell(`<section class="page"><h1>My account</h1>
        <p><strong>${this.esc(acct.profile.first_name)} ${this.esc(acct.profile.last_name || '')}</strong></p>
        <p class="muted">${this.esc(acct.profile.email || acct.profile.phone)}</p>
        <div class="loyalty-card"><h3>Loyalty</h3><strong>${acct.loyalty.balance} points</strong> · ${this.money(acct.loyalty.value)} value</div>
        <button type="button" class="link-btn" data-act="logout">Logout</button>
      </section>`);
      this.bind();
      return;
    }
    this.render();
  },

  productCard(p) {
    return `<article class="product-card ${p.available ? '' : 'unavailable'}">
      ${p.image ? `<img src="${this.esc(p.image)}" alt="" loading="lazy">` : '<div class="thumb">🍽️</div>'}
      <div class="pc-body">
        <h3>${this.esc(p.name)}</h3>
        <div class="pc-price">${p.on_sale ? `<s>${this.money(p.price)}</s> <span class="sale">${this.money(p.sale_price)}</span>` : this.money(p.price)}</div>
        <span class="stock ${p.available ? 'ok' : 'out'}">${p.available ? 'Available' : 'Out of stock'}</span>
        <button type="button" class="btn-sm" data-act="open-product" data-id="${p.id}" ${p.available ? '' : 'disabled'}>${p.has_modifiers ? 'Choose options' : 'Add'}</button>
      </div></article>`;
  }
};

document.addEventListener('DOMContentLoaded', () => OrderApp.init());
