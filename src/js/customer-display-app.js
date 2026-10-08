/**
 * Customer Order Display — public board (order number + status only).
 * Device pairing for branch-scoped boards; same kitchen_orders pipeline as KDS.
 */
const CDS = {
  orders: [],
  readyIds: new Set(),
  deviceMode: false,
  config: { publicMode: true, announceReady: true, branchId: null, shopName: 'Order Status', promo_message: '' },

  async init() {
    document.getElementById('mobile-loading')?.remove();
    if (window.OpsDisplayClient) OpsDisplayClient.deviceType = 'cds';
    this.loadLocalConfig();
    const hasDevice = window.OpsDisplayClient?.getToken?.();
    const q = new URLSearchParams(location.search);
    const staffPreview = q.get('staff_preview') === '1';
    if (!hasDevice && !window.posAPI && !staffPreview) {
      const paired = await this.ensureDevicePairing();
      if (!paired) return;
    }
    this.deviceMode = !!OpsDisplayClient.getToken();
    if (!this.deviceMode && window.DisplayAuth && (staffPreview || !window.posAPI)) {
      try { await DisplayAuth.requireSession('Customer Order Display'); } catch (_) { /* cloud staff */ }
    }
    await this.applyRemoteConfig();
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
    try {
      const bc = new BroadcastChannel('shoppos-kitchen');
      bc.onmessage = (e) => {
        if (e.data?.type === 'cart:update' && !this.config.publicMode) return this.showLiveCart(e.data);
        if (e.data?.type === 'refresh') this.load();
      };
    } catch (_) {}
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'cart:update' && !this.config.publicMode) return this.showLiveCart(e.data);
      if (e.data?.type === 'kitchen:refresh' || e.data?.type === 'customer:refresh') this.load();
    });
    if (window.posAPI?.onKitchenRefresh) window.posAPI.onKitchenRefresh(() => this.load());
    if (this.deviceMode) {
      OpsDisplayClient.heartbeat({ app_version: 'cds-web 2026.10.7' }).catch(() => {});
      setInterval(() => OpsDisplayClient.heartbeat({ app_version: 'cds-web 2026.10.7' }).catch(() => {}), 30000);
    }
    await this.load();
    setInterval(() => this.load(), 3500);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.load();
    });
    try {
      if (screen.orientation?.lock) document.documentElement.requestFullscreen?.().catch(() => {});
    } catch (_) { /* */ }
  },

  async ensureDevicePairing() {
    const host = document.getElementById('cds-pair') || document.body;
    host.innerHTML = `<div class="pair-card"><h2>Customer Order Display</h2>
      <p class="muted">Ask Admin to approve this code under Business Modules → Ops Devices.</p>
      <div class="pair-code" id="cds-pair-code">······</div>
      <p id="cds-pair-msg" class="muted">Requesting code…</p></div>`;
    document.querySelector('.board')?.classList.add('hidden');
    try {
      const r = await OpsDisplayClient.requestPairing('cds');
      document.getElementById('cds-pair-code').textContent = r.pairing_code;
      document.getElementById('cds-pair-msg').textContent = 'Waiting for approval…';
      return await new Promise((resolve) => {
        const poll = setInterval(async () => {
          try {
            const st = await OpsDisplayClient.pairingStatus(r.pairing_code);
            if (st.status === 'approved' && st.device_token) {
              clearInterval(poll);
              OpsDisplayClient.setToken(st.device_token);
              host.innerHTML = '';
              document.querySelector('.board')?.classList.remove('hidden');
              resolve(true);
            } else if (st.status === 'expired' || st.status === 'rejected') {
              clearInterval(poll);
              document.getElementById('cds-pair-msg').textContent = `Pairing ${st.status}. Refresh to retry.`;
              resolve(false);
            }
          } catch (_) { /* retry */ }
        }, 3000);
      });
    } catch (e) {
      document.getElementById('cds-pair-msg').textContent = e.message || 'Could not pair';
      return false;
    }
  },

  loadLocalConfig() {
    try {
      const raw = localStorage.getItem('shoppos_cds_config');
      if (raw) Object.assign(this.config, JSON.parse(raw));
    } catch (_) { /* */ }
    const q = new URLSearchParams(location.search);
    if (q.get('branch_id')) this.config.branchId = Number(q.get('branch_id')) || null;
    if (q.get('staff_preview') === '1') this.config.publicMode = false;
  },

  async applyRemoteConfig() {
    try {
      let s = {};
      if (this.deviceMode) {
        s = await OpsDisplayClient.loadConfig();
        Object.assign(this.config, {
          shopName: s.shop_name || this.config.shopName,
          announceReady: s.announce_ready !== false,
          branchId: s.branch_id ?? this.config.branchId,
          publicMode: s.public_mode !== false,
          promo_message: s.promo_message || '',
          readySound: s.cds_ready_sound
        });
      } else {
        const res = await API.getSettingsParsed?.();
        s = res?.data || res || {};
        this.config.shopName = s.shop_name || this.config.shopName;
        this.config.readySound = s.cds_ready_sound || s.kds_notification_sound;
      }
      const el = document.getElementById('cds-title');
      if (el) el.textContent = this.config.shopName;
      const logo = document.getElementById('cds-logo');
      if (logo && s.logo_path) logo.src = Utils.fileUrl(s.logo_path);
      const promo = document.getElementById('cds-promo');
      if (promo) {
        promo.textContent = this.config.promo_message || '';
        promo.hidden = !this.config.promo_message;
      }
      if (s.font_scale) document.documentElement.style.setProperty('--cds-scale', s.font_scale);
    } catch (_) { /* */ }
  },

  tickClock() {
    const el = document.getElementById('cds-clock');
    if (el) el.textContent = new Date().toLocaleString('en-ZA');
  },

  setConn(ok, detail) {
    const el = document.getElementById('cds-conn');
    if (!el) return;
    el.textContent = ok ? 'Live' : (detail || 'Reconnecting…');
    el.className = ok ? 'conn ok' : 'conn warn';
  },

  showLiveCart(data) {
    const host = document.getElementById('cds-cart');
    const lines = document.getElementById('cds-cart-lines');
    const totalEl = document.getElementById('cds-cart-total');
    if (!host || !lines) return;
    const items = data?.items || [];
    if (!items.length) {
      host.hidden = true;
      lines.innerHTML = '';
      if (totalEl) totalEl.textContent = '';
      return;
    }
    host.hidden = false;
    const money = (n) => (typeof Utils !== 'undefined' && Utils.formatMoney)
      ? Utils.formatMoney(n, data.currency || 'R')
      : `${data.currency || 'R'}${Number(n || 0).toFixed(2)}`;
    lines.innerHTML = items.map((i) => `<div>${i.quantity}× ${i.product_name} <span>${money(i.total)}</span></div>`).join('');
    if (totalEl) totalEl.textContent = `Total ${money(data.total)}`;
  },

  async load() {
    try {
      let list;
      if (this.deviceMode) {
        list = await OpsDisplayClient.loadOrders('pending,preparing,ready,collection');
      } else {
        const res = await API.getKitchenOrders('pending,preparing,ready,collection');
        list = res?.data || res || [];
      }
      list = Array.isArray(list) ? list : [];
      list = list.filter(o => !['completed', 'cancelled', 'done'].includes(o.status));
      const newlyReady = list.filter((o) => (o.status === 'ready' || o.status === 'collection') && !this.readyIds.has(o.id));
      if (newlyReady.length && this.config.announceReady) {
        for (const o of newlyReady) {
          await this.announceReady(o);
          this.readyIds.add(o.id);
        }
      }
      this.orders = list;
      this.setConn(true);
      this.render();
    } catch (err) {
      this.setConn(false, 'Offline — showing last update');
      if (!this.orders.length) {
        for (const st of ['received', 'preparing', 'ready']) {
          const host = document.getElementById(`col-${st}`);
          if (host) host.innerHTML = `<div class="empty">Could not load orders</div>`;
        }
      }
    }
  },

  orderLabel(o) {
    return o.order_number || o.receipt_number || `#${o.id}`;
  },

  async announceReady(o) {
    const num = this.orderLabel(o);
    const path = this.config.readySound;
    try {
      if (path) {
        const r = await API.getAudioDataUrl(path);
        const url = r?.success ? r.dataUrl : Utils.fileUrl(path);
        const a = new Audio(url);
        a.volume = 0.9;
        await a.play();
      }
    } catch (_) { /* */ }
    try {
      if ('speechSynthesis' in window && this.config.announceVoice !== false) {
        const u = new SpeechSynthesisUtterance(`Order ${num} is ready for collection`);
        u.lang = 'en-ZA';
        u.rate = 0.95;
        speechSynthesis.speak(u);
      }
    } catch (_) { /* */ }
  },

  ticketHtml(o) {
    const label = this.orderLabel(o);
    return `<article class="ticket" data-id="${o.id}"><div class="num">${label}</div></article>`;
  },

  render() {
    const map = { received: ['pending'], preparing: ['preparing'], ready: ['ready', 'collection'] };
    for (const [col, statuses] of Object.entries(map)) {
      const host = document.getElementById(`col-${col}`);
      if (!host) continue;
      const list = this.orders.filter(o => statuses.includes(o.status));
      host.innerHTML = list.length ? list.map(o => this.ticketHtml(o)).join('') : '<div class="empty">—</div>';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => CDS.init());
