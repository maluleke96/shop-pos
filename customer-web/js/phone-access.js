/**
 * Simple Phone Access Mode (extends OrderApp).
 * Customers identify with their cellphone; the existing email/password
 * sign-in stays available behind "Sign in with password".
 */
(function () {
  const App = window.OrderApp;
  if (!App) return;

  const PHONE_VIEWS = ['phone-entry', 'phone-otp', 'phone-create', 'phone-welcome'];
  const GUEST_VIEWS = ['home', 'menu', 'product', 'branches', 'promotions'];

  App.accessCfg = function () {
    return this.settings?.online?.customer_access || { mode: 'full' };
  };

  App.phoneAccessEnabled = function () {
    const mode = this.accessCfg().mode;
    return mode === 'phone' || mode === 'guest';
  };

  App.guestViewAllowed = function (view = this.view) {
    const cfg = this.accessCfg();
    const browse = cfg.allow_guest_browsing === true || (cfg.mode === 'guest' && cfg.allow_guest_browsing !== false);
    return !!browse && this.phoneAccessEnabled() && GUEST_VIEWS.includes(view);
  };

  const _origIsAuthView = App.isAuthView.bind(App);
  App.isAuthView = function (view = this.view) {
    return PHONE_VIEWS.includes(view) || _origIsAuthView(view);
  };

  function formatLocal(phone) {
    const d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('27') && d.length === 11) return `0${d.slice(2, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
    return phone || '';
  }

  App.phoneAfterSignIn = async function (r) {
    const stay = document.getElementById('pa-stay')?.checked !== false;
    this.customer = r.customer || this.customer;
    this.persistSession(r.token, stay);
    this._paSummary = r.summary || null;
    this._paCreated = !!r.created;
    this._accountCache = null;
    this._appUnreadLoaded = false;
    await this.refreshLoyaltyAccount();
    const ret = this.authReturn;
    this.authReturn = null;
    if (ret === 'checkout' && this.branch) {
      this.toast(`Welcome${r.summary?.first_name ? `, ${r.summary.first_name}` : ''}!`, 'success');
      this.view = 'checkout';
      this.quote = await this.validateCurrentCart?.().catch(() => null) || this.quote;
      return this.render();
    }
    this._paReturn = ['home', 'menu', 'account', 'orders'].includes(ret) ? ret : null;
    this.view = 'phone-welcome';
    return this.render();
  };

  App.phoneHandleResult = async function (r) {
    if (r?.status === 'signed_in' && r.token) return this.phoneAfterSignIn(r);
    if (r?.status === 'otp_sent') {
      this._paOtp = r;
      this.view = 'phone-otp';
      if (r._dev_code) this.toast(`Test code: ${r._dev_code}`, 'info');
      return this.render();
    }
    if (r?.status === 'not_found') {
      this._paNotFound = r;
      this.view = 'phone-create';
      return this.render();
    }
    if (r?.status === 'not_allowed') {
      this.toast(r.message || 'No account found for this number', 'error');
      return null;
    }
    this.toast('Something went wrong — please try again', 'error');
    return null;
  };

  function busy(btn, label) {
    if (!btn) return () => {};
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    return () => { btn.disabled = false; btn.textContent = prev; };
  }

  App.renderPhoneView = function () {
    const app = document.getElementById('app');
    const shop = this.esc(this.settings?.shop_name || 'us');
    const fullLink = `<button type="button" class="link-btn" data-pa="use-password">Sign in with email &amp; password instead</button>`;
    const guestLink = this.guestViewAllowed('home')
      ? `<button type="button" class="link-btn" data-pa="browse">Browse the menu first</button>` : '';

    if (this.view === 'phone-entry') {
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card pa-card" data-pa-form="entry" novalidate>
        <div class="pa-wave">👋</div>
        <h1>Welcome</h1>
        <p class="pa-lead">Enter your cellphone number</p>
        <input id="pa-phone" class="pa-phone-input" type="tel" inputmode="tel" autocomplete="tel"
          placeholder="082 123 4567" value="${this.esc(this._paPhone || '')}" required>
        <label class="pa-stay"><input type="checkbox" id="pa-stay" checked> Keep me signed in on this device</label>
        <button type="submit" class="btn-primary btn-block pa-continue">CONTINUE</button>
        ${guestLink}
        ${fullLink}
      </form></div>`);
    } else if (this.view === 'phone-otp') {
      const o = this._paOtp || {};
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card pa-card" data-pa-form="otp" novalidate>
        <h1>Enter your code</h1>
        <p class="pa-lead">We sent a 4-digit code${o.via === 'sms' ? ' by SMS' : (o.via === 'whatsapp' ? ' on WhatsApp' : '')} to ${this.esc(o.phone_masked || 'your phone')}</p>
        <input id="pa-code" class="pa-phone-input pa-code-input" inputmode="numeric" autocomplete="one-time-code"
          maxlength="4" placeholder="• • • •" required>
        <label class="pa-stay"><input type="checkbox" id="pa-stay" checked> Keep me signed in on this device</label>
        <button type="submit" class="btn-primary btn-block pa-continue">VERIFY</button>
        <button type="button" class="link-btn" data-pa="resend">Send a new code</button>
        <button type="button" class="link-btn" data-pa="change-number">Use a different number</button>
      </form></div>`);
    } else if (this.view === 'phone-create') {
      const n = this._paNotFound || {};
      app.innerHTML = this.shell(`<div class="auth-page"><form class="auth-card pa-card" data-pa-form="create" novalidate>
        <h1>Create your profile</h1>
        <p class="pa-lead">${this.esc(n.message || 'We could not find an account for this number.')}</p>
        <div class="pa-phone-chip">📱 ${this.esc(formatLocal(this._paPhoneNorm || n.phone) || this._paPhone || '')}</div>
        <label>Your name<input id="pa-name" class="pa-phone-input" autocomplete="name" placeholder="e.g. Thabo" required></label>
        <label class="pa-stay"><input type="checkbox" id="pa-stay" checked> Keep me signed in on this device</label>
        <button type="submit" class="btn-primary btn-block pa-continue">CREATE PROFILE</button>
        <button type="button" class="link-btn" data-pa="change-number">Use a different number</button>
      </form></div>`);
    } else if (this.view === 'phone-welcome') {
      const s = this._paSummary || {};
      const name = s.first_name || this.customer?.first_name || '';
      const pts = Math.floor(Number(this.loyaltyAccount?.balance ?? s.loyalty_points) || 0);
      const value = this.loyaltyAccount?.value ?? s.points_value ?? 0;
      const gifts = (this.giftWallet || []).length;
      app.innerHTML = this.shell(`<div class="auth-page"><div class="auth-card pa-card pa-welcome">
        <div class="pa-wave">${this._paCreated ? '🎉' : '👋'}</div>
        <h1>${this._paCreated ? 'Welcome' : 'Welcome back'}${name ? `, ${this.esc(name)}` : ''}!</h1>
        ${this._paCreated ? `<p class="pa-lead">Your profile is ready — you'll earn points on every order at ${shop}.</p>` : ''}
        <div class="pa-stats">
          <div class="pa-stat"><span>⭐</span><strong>${pts}</strong><small>Points${value ? ` · ${this.money(value)}` : ''}</small></div>
          <div class="pa-stat"><span>🎁</span><strong>${gifts}</strong><small>Rewards</small></div>
          <div class="pa-stat"><span>📦</span><strong>${Number(s.orders) || 0}</strong><small>Orders</small></div>
          <div class="pa-stat"><span>🎯</span><strong>${Number(s.promotions) || 0}</strong><small>Promotions</small></div>
        </div>
        <button type="button" class="btn-primary btn-block pa-continue" data-pa="continue">${this.branch ? 'START ORDERING' : 'CHOOSE BRANCH'}</button>
        <button type="button" class="link-btn" data-pa="go" data-view="account">My account</button>
        ${Number(s.promotions) ? '<button type="button" class="link-btn" data-pa="go" data-view="promotions">See promotions</button>' : ''}
      </div></div>`);
    }
    this.bindPhoneView();
  };

  App.bindPhoneView = function () {
    const app = document.getElementById('app');
    this.bind();
    app.querySelector('#pa-phone, #pa-code, #pa-name')?.focus();

    app.querySelector('[data-pa-form="entry"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('pa-phone')?.value.trim() || '';
      if (String(phone).replace(/\D/g, '').length < 9) { this.toast('Enter your full cellphone number', 'error'); return; }
      this._paPhone = phone;
      const done = busy(e.target.querySelector('.pa-continue'), 'Checking…');
      try {
        const r = await OrderAPI.phoneAccessStart(phone);
        this._paPhoneNorm = r?.phone || null;
        done();
        await this.phoneHandleResult(r);
      } catch (err) { done(); this.toast(err.message || 'Could not continue', 'error'); }
    });

    app.querySelector('[data-pa-form="otp"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('pa-code')?.value.trim() || '';
      if (code.replace(/\D/g, '').length !== 4) { this.toast('Enter the 4-digit code', 'error'); return; }
      const done = busy(e.target.querySelector('.pa-continue'), 'Verifying…');
      try {
        const r = await OrderAPI.phoneAccessVerify(this._paPhone, code);
        this._paPhoneNorm = r?.phone || this._paPhoneNorm;
        done();
        await this.phoneHandleResult(r);
      } catch (err) { done(); this.toast(err.message || 'Incorrect code', 'error'); }
    });

    app.querySelector('[data-pa-form="create"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('pa-name')?.value.trim() || '';
      if (!name) { this.toast('Please enter your name', 'error'); return; }
      const done = busy(e.target.querySelector('.pa-continue'), 'Creating…');
      try {
        const r = await OrderAPI.phoneAccessCreateProfile(this._paPhone, name);
        done();
        await this.phoneHandleResult(r);
      } catch (err) { done(); this.toast(err.message || 'Could not create profile', 'error'); }
    });

    app.querySelectorAll('[data-pa]').forEach((btn) => btn.addEventListener('click', async () => {
      const act = btn.dataset.pa;
      if (act === 'use-password') { this._paForceFull = true; this.view = 'login'; return this.render(); }
      if (act === 'browse') { this.view = this.branch ? 'home' : 'branches'; return this.render(); }
      if (act === 'change-number') { this._paOtp = null; this._paNotFound = null; this.view = 'phone-entry'; return this.render(); }
      if (act === 'resend') {
        const done = busy(btn, 'Sending…');
        try {
          const r = await OrderAPI.phoneAccessStart(this._paPhone);
          this._paOtp = r;
          this.toast('New code sent', 'success');
          if (r?._dev_code) this.toast(`Test code: ${r._dev_code}`, 'info');
        } catch (err) { this.toast(err.message || 'Could not send code', 'error'); }
        done();
        return;
      }
      if (act === 'continue') {
        this.view = !this.branch ? 'branches' : (this._paReturn || 'menu');
        this._paReturn = null;
        if (this.view === 'menu') await this.loadMenu?.().catch(() => {});
        return this.render();
      }
      if (act === 'go') { this.view = btn.dataset.view || 'home'; return this.render(); }
      return null;
    }));
  };

  const _origBind = App.bind.bind(App);
  App.bind = function () {
    _origBind();
    const app = document.getElementById('app');
    if (!app) return;
    const prev = app.onclick;
    app.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn?.dataset?.act === 'logout' && this.token) {
        const token = this.token;
        OrderAPI.logout(token).catch(() => {});
        this._paPhone = '';
        this._paSummary = null;
        this._paForceFull = false;
      }
      if (typeof prev === 'function') return prev.call(app, e);
      return undefined;
    };
  };

  const _origRender = App.render.bind(App);
  App.render = async function () {
    if (!this.token && this.phoneAccessEnabled() && !this._paForceFull
      && ['login', 'register', 'welcome'].includes(this.view)) {
      this.view = 'phone-entry';
    }
    if (this.token && ['phone-entry', 'phone-otp', 'phone-create'].includes(this.view)) {
      this.view = this.branch ? 'home' : 'branches';
    }
    if (PHONE_VIEWS.includes(this.view)) {
      if (!this._stayResolve && !this._deletePending) this.hideAuthModal();
      try { sessionStorage.setItem('order_view', this.view === 'phone-welcome' ? 'home' : this.view); } catch (_) { /* */ }
      return this.renderPhoneView();
    }
    await _origRender.call(this);

    if (this.view === 'login' && this.phoneAccessEnabled() && !this.token) {
      const card = document.querySelector('.auth-card[data-form="login"]');
      if (card && !card.querySelector('[data-pa-back]')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'link-btn';
        b.dataset.paBack = '1';
        b.textContent = '📱 Continue with cellphone number';
        b.addEventListener('click', () => { this._paForceFull = false; this.view = 'phone-entry'; this.render(); });
        card.insertBefore(b, card.firstChild?.nextSibling || null);
      }
    }

    if (this.view === 'account' && this.token && this.phoneAccessEnabled()) {
      const page = document.querySelector('.page');
      if (page && !document.getElementById('pa-account-card')) {
        const acct = this._accountCache || {};
        const prof = acct.profile || this.customer || {};
        const pts = Math.floor(Number(acct.loyalty?.balance ?? this.loyaltyAccount?.balance) || 0);
        const favs = acct.favorites || [];
        const card = document.createElement('div');
        card.id = 'pa-account-card';
        card.className = 'checkout-card pa-account';
        card.innerHTML = `
          <div class="pa-account-row"><span>Name</span><strong>${this.esc(`${prof.first_name || ''} ${prof.last_name || ''}`.trim() || '—')}</strong></div>
          <div class="pa-account-row"><span>Phone</span><strong>${this.esc(formatLocal(prof.phone) || '—')}</strong></div>
          <div class="pa-account-row"><span>Points</span><strong>⭐ ${pts}</strong></div>
          <div class="pa-account-row"><span>Rewards</span><strong>🎁 ${(acct.wallet || this.giftWallet || []).length}</strong></div>
          <div class="pa-account-row"><span>Favorites</span><strong>❤️ ${favs.length}</strong></div>
          ${favs.length ? `<div class="muted" style="font-size:12px;margin:4px 0 8px">${favs.slice(0, 6).map((f) => this.esc(f.product_name || '')).join(' · ')}</div>` : ''}
          <div class="pa-account-links">
            <button type="button" class="btn-sm" data-act="nav" data-view="orders">📦 My orders</button>
            <button type="button" class="btn-sm" data-act="app-inbox">🔔 Notifications</button>
          </div>`;
        const h1 = page.querySelector('h1');
        if (h1) h1.insertAdjacentElement('afterend', card);
        else page.prepend(card);
      }
    }
  };
})();
