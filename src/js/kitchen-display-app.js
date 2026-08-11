const KDS = {
  orders: [],
  knownIds: new Set(),
  audio: null,

  async init() {
    document.getElementById('mobile-loading')?.remove();
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
    try {
      const bc = new BroadcastChannel('shoppos-kitchen');
      bc.onmessage = (e) => { if (e.data?.type === 'refresh') this.load(); };
    } catch (_) {}
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'kitchen:refresh') this.load();
    });
    await this.load();
    setInterval(() => this.load(), 5000);
    if (window.posAPI?.onKitchenRefresh) {
      window.posAPI.onKitchenRefresh(() => this.load());
    }
  },

  tickClock() {
    const el = document.getElementById('kds-clock');
    if (el) el.textContent = new Date().toLocaleString('en-ZA');
  },

  async playNewOrderSound() {
    try {
      const settings = await API.getSettingsParsed();
      const path = settings.data?.kds_notification_sound
        || settings.data?.notification_settings?.sound_path;
      if (path) {
        const r = await API.getAudioDataUrl(path);
        const url = r?.success ? r.dataUrl : Utils.fileUrl(path);
        if (!this.audio) this.audio = new Audio();
        this.audio.src = url;
        this.audio.volume = 0.85;
        await this.audio.play();
        return;
      }
    } catch (_) { /* fallback beep */ }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.value = 0.25;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { try { osc.stop(); } catch { /* ignore */ } }, 400);
    } catch (_) {}
  },

  async load() {
    try {
      const res = await API.getKitchenOrders('pending,preparing,ready,collection');
      const incoming = res.data || res || [];
      const active = incoming.filter(o => !['done', 'completed', 'cancelled'].includes(o.status));
      const newOnes = active.filter(o => !this.knownIds.has(o.id));
      if (newOnes.length && this.knownIds.size) await this.playNewOrderSound();
      this.orders = active;
      this.knownIds = new Set(active.map(o => o.id));
      this.render();
    } catch (_) {}
  },

  elapsed(createdAt) {
    if (!createdAt) return '';
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  },

  render() {
    const el = document.getElementById('orders');
    if (!el) return;
    if (!this.orders.length) {
      el.innerHTML = '<div class="empty">No active kitchen orders</div>';
      return;
    }
    el.innerHTML = this.orders.map(o => `
      <article class="order-card ${o.status || 'pending'}" data-id="${o.id}">
        <header class="order-head">
          <div class="order-num">${o.order_number}</div>
          <span class="order-badge ${o.status || 'pending'}">${(o.status || 'pending').toUpperCase()}</span>
        </header>
        <div class="order-meta">${this.elapsed(o.created_at)} · ${o.station || 'kitchen'}${o.table_number ? ` · Table ${o.table_number}` : ''}</div>
        <ul class="order-items">${(o.items || []).map(i =>
          `<li><span class="qty">${i.quantity}×</span> ${i.product_name}${i.modifiers ? ` <em>(${i.modifiers})</em>` : ''}</li>`).join('')}</ul>
        <footer class="order-actions">
          ${o.status === 'pending' ? `<button class="btn btn-start" data-id="${o.id}" data-action="preparing">Start</button>` : ''}
          ${o.status === 'preparing' ? `<button class="btn btn-ready" data-id="${o.id}" data-action="ready">Ready</button>` : ''}
          ${o.status === 'ready' ? `<button class="btn btn-ready" data-id="${o.id}" data-action="collection">Collection</button>` : ''}
          <button class="btn btn-done" data-id="${o.id}" data-action="completed">Done ✓</button>
        </footer>
      </article>`).join('');

    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const action = btn.dataset.action;
        const r = await API.updateKitchenStatus(id, action, window.App?.user || null);
        if (r && r.success === false) {
          console.warn('Kitchen status update failed', r.error);
          await this.load();
          return;
        }
        if (action === 'completed' || action === 'done') {
          this.orders = this.orders.filter(o => o.id !== id);
          this.knownIds.delete(id);
          btn.closest('.order-card')?.remove();
          if (!this.orders.length) el.innerHTML = '<div class="empty">No active kitchen orders</div>';
          try {
            const bc = new BroadcastChannel('shoppos-kitchen');
            bc.postMessage({ type: 'refresh' });
            bc.close();
          } catch (_) {}
          return;
        }
        await this.load();
      });
    });
  }
};

document.addEventListener('DOMContentLoaded', () => KDS.init());
