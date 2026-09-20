/* Privacy-safe Order Online analytics. No tracking until the visitor accepts. */
const WebTracker = {
  consent: null,
  marketingConsent: false,
  sessionId: '',
  visitorKey: '',
  queue: [],
  timer: null,
  lastPage: '',
  lastProduct: '',
  landing: '',
  utm: {},

  boot() {
    this.consent = this.readFlag('order_analytics_consent');
    this.marketingConsent = this.readFlag('order_marketing_consent') === true;
    this.utm = this.readUtm();
    this.landing = this.pageFromView((window.OrderApp && OrderApp.view) || 'home');
    if (this.consent === true) this.ensureIds();
    this.mountBanner();
    this.bindLeave();
    if (this.consent === true) this.startHeartbeat();
  },

  readFlag(key) {
    try {
      const v = localStorage.getItem(key);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (_) { /* */ }
    return null;
  },

  writeFlag(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) { /* */ }
  },

  rand(prefix) {
    const part = Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
    return `${prefix}_${part}`;
  },

  ensureIds() {
    try {
      this.sessionId = sessionStorage.getItem('order_wsid') || this.rand('ws');
      sessionStorage.setItem('order_wsid', this.sessionId);
      this.visitorKey = localStorage.getItem('order_vk') || this.rand('vk');
      localStorage.setItem('order_vk', this.visitorKey);
    } catch (_) {
      this.sessionId = this.sessionId || this.rand('ws');
      this.visitorKey = this.visitorKey || this.rand('vk');
    }
  },

  readUtm() {
    const out = {};
    try {
      const q = new URLSearchParams(location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach((k) => {
        if (q.get(k)) out[k.replace('utm_', '')] = q.get(k);
      });
    } catch (_) { /* */ }
    return out;
  },

  referrerHost() {
    try {
      if (!document.referrer) return '';
      return new URL(document.referrer).hostname || '';
    } catch (_) { return ''; }
  },

  device() {
    const ua = navigator.userAgent || '';
    const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);
    const mobile = /Mobi|iPhone|Android/i.test(ua);
    return {
      type: tablet ? 'tablet' : (mobile ? 'mobile' : 'desktop'),
      browser: /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Other',
      platform: /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : 'Other'
    };
  },

  pageFromView(view) {
    const map = {
      home: 'home', menu: 'menu', product: 'product', cart: 'cart', checkout: 'checkout',
      confirmed: 'checkout', login: 'login', register: 'register', account: 'account',
      orders: 'orders', 'order-detail': 'orders', branches: 'home', welcome: 'home',
      forgot: 'login', 'forgot-verify': 'login', 'register-verify': 'register'
    };
    return map[view] || 'home';
  },

  accept(analytics, marketing) {
    this.consent = !!analytics;
    this.marketingConsent = !!marketing;
    this.writeFlag('order_analytics_consent', this.consent);
    this.writeFlag('order_marketing_consent', this.marketingConsent);
    this.hideBanner();
    if (this.consent) {
      this.ensureIds();
      this.startHeartbeat();
      this.track('page_view', { page: this.landing || 'home', page_label: 'Home' });
    }
  },

  mountBanner() {
    if (this.consent !== null) return;
    if (document.getElementById('web-consent-banner')) return;
    const el = document.createElement('div');
    el.id = 'web-consent-banner';
    el.className = 'web-consent-banner';
    el.innerHTML = `<div class="web-consent-card">
      <p><strong>Privacy on this website</strong></p>
      <p>We use privacy-safe analytics to improve ordering. Anonymous visitors stay anonymous. We only link activity to your account if you sign in, and we do not store unnecessary personal information (POPIA).</p>
      <div class="web-consent-actions">
        <button type="button" class="btn-primary" data-consent="all">Accept analytics</button>
        <button type="button" class="btn-outline" data-consent="essential">Essential only</button>
      </div>
    </div>`;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-consent]');
      if (!btn) return;
      this.accept(btn.dataset.consent === 'all', btn.dataset.consent === 'all');
    });
    document.body.appendChild(el);
  },

  hideBanner() {
    document.getElementById('web-consent-banner')?.remove();
  },

  track(type, extra = {}) {
    if (this.consent !== true) return;
    this.ensureIds();
    const page = extra.page || this.pageFromView(window.OrderApp?.view || 'home');
    this.queue.push({
      type,
      page,
      page_label: extra.page_label || page,
      product_id: extra.product_id || undefined,
      product_name: extra.product_name || undefined,
      order_id: extra.order_id || undefined
    });
    if (this.queue.length >= 8 || type === 'complete_order' || type === 'add_to_cart' || type === 'start_checkout') {
      this.flush();
    } else {
      this.schedule();
    }
  },

  trackView(view, extra = {}) {
    const page = this.pageFromView(view);
    if (page === this.lastPage && extra.product_id === this.lastProduct) return;
    this.lastPage = page;
    this.lastProduct = extra.product_id || '';
    this.track('page_view', { page, page_label: extra.page_label || view, ...extra });
    if (page === 'menu') this.track('view_menu', { page: 'menu', page_label: 'Menu' });
    if (page === 'product') this.track('view_product', { page: 'product', ...extra });
    if (extra.special) this.track('view_special', { page: page === 'product' ? 'product' : 'home', ...extra });
    if (page === 'checkout') this.track('start_checkout', { page: 'checkout', page_label: 'Checkout' });
  },

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 2500);
  },

  async flush() {
    if (this.consent !== true || !this.queue.length || !window.OrderAPI?.trackEvents) return;
    const events = this.queue.splice(0, 40);
    try {
      await OrderAPI.trackEvents({
        session_id: this.sessionId,
        visitor_key: this.visitorKey,
        token: window.OrderApp?.token || '',
        analytics_consent: true,
        marketing_consent: this.marketingConsent || !!window.OrderApp?.customer?.marketing_opt_in,
        device: this.device(),
        utm: this.utm,
        referrer_host: this.referrerHost(),
        landing_page: this.landing || 'home',
        events
      });
    } catch (_) {
      this.queue.unshift(...events);
    }
  },

  startHeartbeat() {
    if (this._beat) return;
    this._beat = setInterval(() => {
      if (document.hidden) return;
      this.track('heartbeat', { page: this.pageFromView(window.OrderApp?.view || 'home') });
    }, 30000);
  },

  bindLeave() {
    const leave = () => {
      if (this.consent !== true) return;
      const cart = window.OrderApp?.cart || [];
      if (cart.length && window.OrderApp?.view !== 'confirmed') {
        this.track('abandon_cart', { page: 'cart', page_label: 'Cart' });
      }
      this.flush();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush();
    });
  }
};

window.WebTracker = WebTracker;
document.addEventListener('DOMContentLoaded', () => WebTracker.boot());
