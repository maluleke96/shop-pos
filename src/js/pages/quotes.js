const QuotesPage = {
  tab: 'open',

  async render(el, app) {
    this.app = app;
    const currency = app.settings?.currency || 'R';
    const res = await API.getQuotes({ limit: 200 });
    const allQuotes = res.data || [];
    const quotes = this.tab === 'history'
      ? allQuotes.filter(q => q.status !== 'open')
      : allQuotes.filter(q => q.status === 'open');

    el.innerHTML = `<div class="page-toolbar"><h3>Quotations & Proforma</h3>
      <button class="btn btn-primary" id="new-quote">+ New Quote</button></div>
      <div class="form-tabs" id="quotes-tabs" style="margin-bottom:16px">
        <button type="button" class="form-tab ${this.tab === 'open' ? 'active' : ''}" data-tab="open">Open Quotes</button>
        <button type="button" class="form-tab ${this.tab === 'history' ? 'active' : ''}" data-tab="history">History</button>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Quote #</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${quotes.map(q => `<tr>
          <td>${q.quote_number}</td><td>${q.customer_name || '—'}</td>
          <td>${Utils.formatMoney(q.total, currency)}</td>
          <td><span class="tag">${q.status}</span></td>
          <td>${Utils.formatDateTime(q.created_at)}</td>
          <td>
            ${q.status === 'open' ? `<button class="btn btn-sm btn-primary load-q-pos" data-id="${q.id}">Load in POS</button>
            <button class="btn btn-sm btn-success convert-q" data-id="${q.id}">Convert to Sale</button>` : ''}
            <button class="btn btn-sm btn-ghost view-q" data-id="${q.id}">View</button>
            <button class="btn btn-sm btn-ghost print-q-pdf" data-id="${q.id}">Print PDF</button>
            <button class="btn btn-sm btn-ghost reprint-q" data-id="${q.id}">Thermal</button>
            ${q.customer_phone ? `<button class="btn btn-sm btn-success wa-q" data-id="${q.id}">WhatsApp</button>` : ''}
          </td></tr>`).join('') || `<tr><td colspan="6" class="muted">No ${this.tab === 'history' ? 'historical' : 'open'} quotes</td></tr>`}
        </tbody></table></div></div>`;

    el.querySelector('#quotes-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this.tab = btn.dataset.tab;
      this.render(el, app);
    });

    document.getElementById('new-quote').addEventListener('click', () => this.showQuoteForm());
    el.querySelectorAll('.load-q-pos').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (!r.success || !r.data) return Utils.toast(r.error || 'Quote not found', 'error');
      if (r.data.status !== 'open') return Utils.toast('Only open quotes can be loaded', 'error');
      app.pendingQuote = r.data;
      app.navigate('pos');
    }));
    el.querySelectorAll('.convert-q').forEach(b => b.addEventListener('click', async () => {
      const r = await API.convertQuote(parseInt(b.dataset.id, 10), app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Quote converted to sale!', 'success');
      this.render(el, app);
    }));
    el.querySelectorAll('.view-q').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      this.showQuoteDetail(r.data, currency, app);
    }));
    el.querySelectorAll('.reprint-q').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (r.data) await Receipt.printQuote(r.data, app.settings, 'thermal');
    }));
    el.querySelectorAll('.print-q-pdf').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (r.data) await Receipt.downloadQuotePdf(r.data, app.settings);
    }));
    el.querySelectorAll('.wa-q').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (!r.data) return Utils.toast(r.error || 'Quote not found', 'error');
      const waRes = await Utils.sendQuoteWhatsApp(app, r.data);
      if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
    }));
  },

  showQuoteDetail(q, currency, app) {
    if (!q) return;
    Utils.showModal(`Quote ${q.quote_number}`, `
      <p><strong>Customer:</strong> ${q.customer_name || '—'}</p>
      <p><strong>Status:</strong> ${q.status}</p>
      <p><strong>Total:</strong> ${Utils.formatMoney(q.total, currency)}</p>
      <table style="width:100%;margin-top:12px"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      ${(q.items||[]).map(i => `<tr><td>${i.product_name}</td><td>${i.quantity}</td><td>${Utils.formatMoney(i.unit_price,currency)}</td><td>${Utils.formatMoney(i.total,currency)}</td></tr>`).join('')}
      </table>`,
      `<button class="btn btn-primary" id="print-quote-a4">Print A4</button>
       <button class="btn btn-ghost" id="print-quote-pdf">Save PDF</button>
       <button class="btn btn-ghost" id="print-quote-thermal">Print Thermal</button>
       ${q.customer_phone ? `<button class="btn btn-success" id="wa-quote">WhatsApp</button>` : ''}
       ${q.status === 'open' ? `<button class="btn btn-success" id="load-quote-pos">Load in POS</button>` : ''}`);
    document.getElementById('print-quote-a4').addEventListener('click', () => Receipt.printQuote(q, app.settings, 'a4'));
    document.getElementById('print-quote-pdf')?.addEventListener('click', () => Receipt.downloadQuotePdf(q, app.settings));
    document.getElementById('print-quote-thermal')?.addEventListener('click', () => Receipt.printQuote(q, app.settings, 'thermal'));
    document.getElementById('wa-quote')?.addEventListener('click', async () => {
      const waRes = await Utils.sendQuoteWhatsApp(app, q);
      if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
    });
    document.getElementById('load-quote-pos')?.addEventListener('click', () => {
      app.pendingQuote = q;
      Utils.hideModal();
      app.navigate('pos');
    });
  },

  async showQuoteForm() {
    const [custRes, prodRes] = await Promise.all([API.getCustomers(), API.getProducts()]);
    const customers = custRes.data || [];
    const products = prodRes.data || [];
    Utils.showModal('New Quotation', `
      <div class="field"><label>Customer</label><select id="q-customer"><option value="">Walk-in</option>
        ${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
      <div class="field"><label>Product</label><select id="q-product">${products.map(p => `<option value="${p.id}" data-price="${p.selling_price}" data-name="${p.name}">${p.name} — ${p.selling_price}</option>`).join('')}</select></div>
      <div class="field"><label>Quantity</label><input type="number" id="q-qty" value="1" min="1"></div>`,
      '<button class="btn btn-primary" id="save-quote">Save Quote</button>');
    document.getElementById('save-quote').addEventListener('click', async () => {
      const sel = document.getElementById('q-product');
      const opt = sel.selectedOptions[0];
      const qty = parseFloat(document.getElementById('q-qty').value) || 1;
      const price = parseFloat(opt.dataset.price);
      const total = price * qty;
      const taxEnabled = !!this.app.settings?.tax_enabled;
      const totals = Utils.calcTaxInclusive(total, 0, this.app.settings?.tax_rate || 0, taxEnabled);
      const data = {
        customer_id: parseInt(document.getElementById('q-customer').value) || null,
        items: [{ product_id: parseInt(sel.value), product_name: opt.dataset.name, quantity: qty, unit_price: price, total }],
        subtotal: totals.subtotal, discount: 0, tax_amount: totals.tax_amount, total: totals.total
      };
      const r = await API.saveQuote(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Quote created', 'success');
      this.render(document.getElementById('page-content'), this.app);
    });
  }
};
window.QuotesPage = QuotesPage;
