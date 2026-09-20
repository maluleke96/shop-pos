const StudioApp = {
  view: 'login',
  token: StudioAPI.token(),
  user: null,
  access: { menu: false, video: false, any: false },
  shop: { shop_name: 'Shop' },
  error: '',
  busy: false,
  _poll: 0,

  init() {
    try {
      this.user = JSON.parse(localStorage.getItem('studio_user') || 'null');
    } catch (_) { this.user = null; }
    this.applyFavicon();
    this.loadShopBranding().then(() => {
      if (this.token && this.user) {
        this.view = 'home';
        this.bootstrap();
      } else {
        this.render();
      }
    });
  },

  applyFavicon() {
    const href = `${this.origin()}/api/logo`;
    const ensure = (rel) => {
      let el = document.querySelector(`link[rel="${rel}"]`);
      if (!el) {
        el = document.createElement('link');
        el.rel = rel;
        document.head.appendChild(el);
      }
      el.href = `${href}?t=${Date.now()}`;
    };
    ensure('icon');
    ensure('apple-touch-icon');
    ensure('shortcut icon');
  },

  async loadShopBranding() {
    try {
      const settings = await StudioAPI.settings();
      if (settings) this.shop = { ...this.shop, ...settings };
      if (settings?.shop_name) document.title = `${settings.shop_name} · Studio`;
    } catch (_) { /* public settings may still work via studioApp:settings */ }
  },

  logoHtml(sizeClass) {
    const src = `${this.origin()}/api/logo`;
    return `<div class="mark ${sizeClass || ''}"><img src="${this.esc(src)}" alt="" onerror="this.remove();this.parentNode.textContent='MP'"></div>`;
  },

  esc(s) {
    return String(s || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  },

  toast(msg, type) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' error' : ''}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  },

  origin() {
    if (typeof location !== 'undefined' && location.origin && !String(location.origin).startsWith('file:')) {
      return location.origin.replace(/\/$/, '');
    }
    const c = window.__STUDIO_CONFIG__ || {};
    return String(c.apiBase || 'https://chisafood.up.railway.app').replace(/\/$/, '');
  },

  async bootstrap() {
    try {
      const data = await StudioAPI.profile();
      this.user = data.user || this.user;
      this.access = data.access || this.access;
      this.shop = data.shop || this.shop;
      localStorage.setItem('studio_user', JSON.stringify(this.user));
      this.view = 'home';
      this.error = '';
      this.startPoll();
      this.render();
    } catch (err) {
      this.forceLogin(err.message || 'Please sign in again.');
    }
  },

  startPoll() {
    if (this._poll) clearInterval(this._poll);
    this._poll = setInterval(() => this.pollAccess(), 20000);
  },

  async pollAccess() {
    if (!StudioAPI.token()) return;
    try {
      const data = await StudioAPI.check();
      this.access = data.access || this.access;
      this.user = data.user || this.user;
      if (this.view === 'home') this.render();
    } catch (err) {
      this.forceLogin(err.message || 'Access has been updated. Please sign in again.');
    }
  },

  forceLogin(message) {
    if (this._poll) clearInterval(this._poll);
    this._poll = 0;
    StudioAPI.setToken('');
    localStorage.removeItem('studio_user');
    try {
      sessionStorage.removeItem('shoppos_rpc_session');
      localStorage.removeItem('shoppos_rpc_session');
      sessionStorage.removeItem('shoppos_studio_lock');
    } catch (_) { /* */ }
    this.token = '';
    this.user = null;
    this.access = { menu: false, video: false, any: false };
    this.view = 'login';
    this.error = message || '';
    this.render();
  },

  render() {
    const root = document.getElementById('app');
    if (!root) return;
    if (this.view === 'login') root.innerHTML = this.loginHtml();
    else root.innerHTML = this.homeHtml();
    this.bind();
  },

  loginHtml() {
    const shopName = this.shop?.shop_name || '';
    return `<div class="login-card">
      <div class="brand">
        ${this.logoHtml()}
        ${shopName ? `<p class="shop-name">${this.esc(shopName)}</p>` : ''}
        <h1>Menu &amp; Promo Studio</h1>
        <p>Use the same username and password as Admin / POS. Staff need Studio Access from Admin → Users.</p>
      </div>
      <form id="studio-login">
        <label>Username<input id="su-user" autocomplete="username" required></label>
        <label>Password<input id="su-pass" type="password" autocomplete="current-password" required></label>
        <label>PIN <span style="font-weight:500;color:var(--muted)">(if your Admin login uses one)</span><input id="su-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="one-time-code"></label>
        <button class="btn btn-primary" id="su-submit" type="submit"${this.busy ? ' disabled' : ''}>${this.busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      ${this.error ? `<div class="error-banner">${this.esc(this.error)}</div>` : ''}
    </div>`;
  },

  homeHtml() {
    const name = this.user?.full_name || this.user?.username || 'Staff';
    const menuOn = !!this.access?.menu;
    const videoOn = !!this.access?.video;
    return `<div class="home-card">
      <div class="brand" style="margin-bottom:16px">${this.logoHtml()}</div>
      <div class="welcome">
        <h2>Welcome, ${this.esc(name)}</h2>
        <p>${this.esc(this.shop?.shop_name || 'Studio')} · access is checked on the server</p>
      </div>
      <button type="button" class="module-btn" data-open="menu" ${menuOn ? '' : 'disabled'}>
        <strong>MENU BUILDER</strong>
        <span>${menuOn ? 'Design printable &amp; digital menus from live products' : 'Access not granted — contact your administrator'}</span>
      </button>
      <button type="button" class="module-btn" data-open="video" ${videoOn ? '' : 'disabled'}>
        <strong>PROMO VIDEO BUILDER</strong>
        <span>${videoOn ? 'Create promotional videos for WhatsApp, Reels &amp; TV' : 'Access not granted — contact your administrator'}</span>
      </button>
      <button type="button" class="btn btn-ghost" id="su-logout">Log out</button>
    </div>`;
  },

  bind() {
    document.getElementById('studio-login')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.doLogin();
    });
    document.getElementById('su-logout')?.addEventListener('click', () => this.doLogout());
    document.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => this.openModule(btn.dataset.open));
    });
  },

  async doLogin() {
    if (this.busy) return;
    const username = document.getElementById('su-user')?.value?.trim() || '';
    const password = document.getElementById('su-pass')?.value || '';
    const pin = document.getElementById('su-pin')?.value || '';
    if (!username || !password) {
      this.error = 'Enter your username and password.';
      this.render();
      return;
    }
    this.busy = true;
    this.error = '';
    this.render();
    try {
      const data = await StudioAPI.login(username, password, {
        device_name: navigator.userAgent?.slice(0, 80) || 'studio',
        platform: /android/i.test(navigator.userAgent) ? 'android' : (/windows/i.test(navigator.userAgent) ? 'windows' : 'web'),
        pin: pin || undefined
      });
      StudioAPI.setToken(data.token);
      this.token = data.token;
      this.user = data.user;
      this.access = data.access || { menu: false, video: false, any: true };
      localStorage.setItem('studio_user', JSON.stringify(this.user));
      this.busy = false;
      this.view = 'home';
      this.startPoll();
      try {
        const settings = await StudioAPI.settings();
        this.shop = settings || this.shop;
      } catch (_) { /* */ }
      this.render();
      this.toast('Signed in', 'ok');
    } catch (err) {
      this.busy = false;
      this.error = err.message || 'Login unsuccessful.';
      this.render();
      const uEl = document.getElementById('su-user');
      if (uEl) uEl.value = username;
    }
  },

  async doLogout() {
    try { await StudioAPI.logout(); } catch (_) { /* */ }
    this.forceLogin('');
  },

  async openModule(mod) {
    try {
      const data = await StudioAPI.beginModule(mod);
      const section = data.section || (mod === 'menu' ? 'menu-builder' : 'promo-video-builder');
      const lock = [];
      if (this.access.menu) lock.push('menu-builder');
      if (this.access.video) lock.push('promo-video-builder');
      sessionStorage.setItem('shoppos_studio_lock', lock.join(','));
      sessionStorage.setItem('shoppos_studio_section', section);
      sessionStorage.setItem('shoppos_studio_return', `${this.origin()}/studio/`);

      const rpcTok = sessionStorage.getItem('shoppos_rpc_session')
        || localStorage.getItem('shoppos_rpc_session')
        || '';
      if (rpcTok) {
        sessionStorage.setItem('shoppos_rpc_session', rpcTok);
        localStorage.setItem('shoppos_rpc_session', rpcTok);
      }

      // Fully standalone builders — no Admin panel
      const moduleQ = section === 'promo-video-builder' ? 'video' : 'menu';
      const url = `${this.origin()}/index.html?app=studio-builder&module=${moduleQ}&studio=1`;
      location.href = url;
    } catch (err) {
      this.toast(err.message || 'Unable to open module', 'error');
      if (/revoked|unavailable|permission|session/i.test(err.message || '')) {
        this.forceLogin(err.message);
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => StudioApp.init());
window.StudioApp = StudioApp;
