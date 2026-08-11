const CDS = {
  orders: [],

  async init() {
    document.getElementById('mobile-loading')?.remove();
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
    try {
      const bc = new BroadcastChannel('shoppos-kitchen');
      bc.onmessage = (e) => { if (e.data?.type === 'refresh') this.load(); };
    } catch (_) {}
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'kitchen:refresh' || e.data?.type === 'customer:refresh') this.load();
    });
    if (window.posAPI?.onKitchenRefresh) {
      window.posAPI.onKitchenRefresh(() => this.load());
    }
    await this.load();
    setInterval(() => this.load(), 4000);
  },

  tickClock() {
    const el = document.getElementById('cds-clock');
    if (el) el.textContent = new Date().toLocaleString('en-ZA');
  },

  async load() {
    try {
      const res = await API.getKitchenOrders('preparing,ready,collection');
      this.orders = (res.data || res || []).filter(o =>
        ['preparing', 'ready', 'collection'].includes(o.status)
      );
      this.render();
    } catch (_) {}
  },

  ticketHtml(o) {
    const label = o.order_number || o.receipt_number || `#${o.id}`;
    const table = o.table_number ? ` · Table ${o.table_number}` : '';
    return `<article class="ticket" data-id="${o.id}" title="Mark collected / done">
      <div class="num">${label}</div>
      <div class="meta">${(o.items || []).slice(0, 3).map(i => `${i.quantity}× ${i.product_name}`).join(', ') || 'Order'}${table}</div>
      <div class="hint">Tap when collected — removes from board</div>
    </article>`;
  },

  render() {
    for (const st of ['preparing', 'ready', 'collection']) {
      const host = document.getElementById(`col-${st}`);
      if (!host) continue;
      const list = this.orders.filter(o => o.status === st);
      host.innerHTML = list.length
        ? list.map(o => this.ticketHtml(o)).join('')
        : '<div class="empty">—</div>';
      host.querySelectorAll('.ticket').forEach(el => {
        el.addEventListener('click', () => this.markDone(parseInt(el.dataset.id, 10)));
      });
    }
  },

  async markDone(id) {
    const r = await API.updateKitchenStatus(id, 'completed', window.App?.user || null);
    if (r && r.success === false) {
      console.warn('Customer display update failed', r.error);
      await this.load();
      return;
    }
    this.orders = this.orders.filter(o => o.id !== id);
    this.render();
    try {
      const bc = new BroadcastChannel('shoppos-kitchen');
      bc.postMessage({ type: 'refresh' });
      bc.close();
    } catch (_) {}
    try { await API.refreshKitchenDisplay(); } catch (_) {}
    try { await API.refreshCustomerDisplay?.(); } catch (_) {}
  }
};

document.addEventListener('DOMContentLoaded', () => CDS.init());
