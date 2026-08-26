// Admin Quotes Management
(function () {
  if (!window.AdminPage) return;

  if (!AdminPage.sections.some(s => s.id === 'quotes')) {
    AdminPage.sections.splice(6, 0, { id: 'quotes', label: '📄 Quotes', icon: 'quotes' });
  }

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    if (this.section === 'quotes') return this.renderQuotesAdmin(el);
    return origRenderSection(el);
  };

  AdminPage.showQuoteDetailAdmin = async function (quoteId) {
    const r = await API.getQuote(quoteId);
    const q = r.data;
    if (!q) return Utils.toast('Quote not found', 'error');
    const currency = this.settings.currency || 'R';
    Utils.showModal(`Quote ${q.quote_number}`, `
      <p><strong>Customer:</strong> ${q.customer_name || 'Walk-in'}</p>
      <p><strong>Status:</strong> ${q.status} · <strong>Created:</strong> ${Utils.formatDateTime(q.created_at)}</p>
      <p><strong>Prepared by:</strong> ${q.user_name || '—'}</p>
      <table style="width:100%;margin-top:12px"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      ${(q.items || []).map(i => `<tr><td>${i.product_name}</td><td>${i.quantity}</td>
        <td>${Utils.formatMoney(i.unit_price, currency)}</td><td>${Utils.formatMoney(i.total, currency)}</td></tr>`).join('')}
      </table>
      <div style="margin-top:12px">
        <div>Subtotal: ${Utils.formatMoney(q.subtotal, currency)}</div>
        <div>Discount: ${Utils.formatMoney(q.discount || 0, currency)}</div>
        <div>Tax: ${Utils.formatMoney(q.tax_amount || 0, currency)}</div>
        <div><strong>Total: ${Utils.formatMoney(q.total, currency)}</strong></div>
      </div>
      ${q.notes ? `<p class="muted" style="margin-top:8px">${q.notes}</p>` : ''}`,
      `<button class="btn btn-primary" id="aqd-print-thermal">Print Receipt</button>
       <button class="btn btn-ghost" id="aqd-print-a4">Print A4</button>
       ${q.status === 'open' ? `<button class="btn btn-success" id="aqd-load-pos">Load in POS</button>` : ''}`);
    document.getElementById('aqd-print-thermal')?.addEventListener('click', () => Receipt.printQuote(q, this.settings, 'thermal'));
    document.getElementById('aqd-print-a4')?.addEventListener('click', () => Receipt.printQuote(q, this.settings, 'a4'));
    document.getElementById('aqd-load-pos')?.addEventListener('click', () => {
      this.app.pendingQuote = q;
      Utils.hideModal();
      this.app.navigate('pos');
    });
  };

  AdminPage.discountQuoteBeforeConvert = async function (quoteId) {
    const r = await API.getQuote(quoteId);
    const q = r.data;
    if (!q || q.status !== 'open') return Utils.toast('Quote not available', 'error');
    const currency = this.settings.currency || 'R';
    Utils.showModal(`Discount Quote ${q.quote_number}`, `
      <p class="muted">Supervisor/manager can adjust discount before converting to sale.</p>
      <div class="field"><label>Manager PIN</label><input type="password" id="qc-mgr-pin" maxlength="12" inputmode="numeric"></div>
      <div class="field"><label>Discount (${currency})</label><input type="number" id="qc-discount" step="0.01" min="0" value="${q.discount || 0}"></div>`,
      '<button class="btn btn-primary" id="qc-save">Apply & Convert</button><button class="btn btn-ghost" id="qc-convert-only">Convert Without Change</button>');
    document.getElementById('qc-convert-only')?.addEventListener('click', async () => {
      const cr = await API.convertQuote(quoteId, this.app.user);
      if (!cr.success) return Utils.toast(cr.error, 'error');
      Utils.hideModal();
      Utils.toast('Quote converted to sale', 'success');
    });
    document.getElementById('qc-save')?.addEventListener('click', async () => {
      const pin = document.getElementById('qc-mgr-pin').value.trim();
      if (!pin) return Utils.toast('Manager PIN required', 'error');
      const pr = await API.verifyManagerPin(pin);
      if (!pr.success) return Utils.toast(pr.error || 'Invalid PIN', 'error');
      const discount = parseFloat(document.getElementById('qc-discount').value) || 0;
      const gross = (q.items || []).reduce((s, i) => s + Number(i.total || 0), 0);
      const taxEnabled = !!this.settings.tax_enabled;
      const totals = Utils.calcTaxInclusive(gross, discount, this.settings.tax_rate || 0, taxEnabled);
      const sr = await API.saveQuote({
        id: q.id, customer_id: q.customer_id, items: q.items,
        subtotal: totals.subtotal, discount, tax_amount: totals.tax_amount, total: totals.total,
        valid_until: q.valid_until, notes: q.notes, status: 'open'
      }, this.app.user);
      if (!sr.success) return Utils.toast(sr.error, 'error');
      const cr = await API.convertQuote(quoteId, this.app.user);
      if (!cr.success) return Utils.toast(cr.error, 'error');
      Utils.hideModal();
      Utils.toast('Quote discounted and converted', 'success');
    });
  };

  AdminPage.renderQuotesAdmin = async function (el) {
    this.quoteFrom = this.quoteFrom || Utils.monthStart();
    this.quoteTo = this.quoteTo || Utils.today();
    const res = await API.getQuotes({ from: this.quoteFrom, to: this.quoteTo });
    const quotes = res.data || [];
    const currency = this.settings.currency || 'R';
    const expiryHours = this.settings.quote_expiry_hours ?? 168;
    const expiryUnit = this.settings.quote_expiry_unit || 'hours';

    el.innerHTML = `<div class="admin-section"><h3>Quotations</h3>
      <p class="muted">All quotes including expired/converted. POS Saved Quotes tab hides expired quotes automatically.</p>
      <div class="card" style="margin-bottom:16px"><div class="card-body"><h4>Quote Validity (POS Saved Quotes)</h4>
        <div class="form-grid">
          <div class="field"><label>Duration</label><input type="number" id="aq-expiry-val" min="1" step="1" value="${expiryHours}"></div>
          <div class="field"><label>Unit</label><select id="aq-expiry-unit">
            <option value="hours" ${expiryUnit === 'hours' ? 'selected' : ''}>Hours</option>
            <option value="days" ${expiryUnit === 'days' ? 'selected' : ''}>Days</option>
          </select></div>
        </div>
        <button class="btn btn-primary btn-sm" id="aq-expiry-save" style="margin-top:8px">Save Validity Settings</button>
      </div></div>
      ${Utils.dateFilterHTML('admin-quote-filter', this.quoteFrom, this.quoteTo)}
      <div class="card" style="margin-top:16px"><div class="table-wrap"><table>
        <thead><tr><th>Quote #</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Expires</th><th>Date</th><th></th></tr></thead>
        <tbody>${quotes.map(q => `<tr>
          <td><strong>${q.quote_number}</strong></td>
          <td>${q.customer_name || '—'}</td>
          <td><small class="muted">${q.items_summary || '—'}</small></td>
          <td>${Utils.formatMoney(q.total, currency)}</td>
          <td><span class="tag">${q.status}</span></td>
          <td>${q.expires_at ? Utils.formatDateTime(q.expires_at) : '—'}</td>
          <td>${Utils.formatDateTime(q.created_at)}</td>
          <td class="actions">
            <button class="btn btn-sm btn-ghost q-view" data-id="${q.id}">View</button>
            <button class="btn btn-sm btn-primary q-print" data-id="${q.id}" title="Print A4">🖨️ A4</button>
            <button class="btn btn-sm btn-ghost q-receipt" data-id="${q.id}" title="Thermal">🧾</button>
            <button class="btn btn-sm btn-ghost q-edit" data-id="${q.id}">Edit</button>
            <button class="btn btn-sm btn-danger q-del" data-id="${q.id}">Delete</button>
            ${q.status === 'open' ? `<button class="btn btn-sm btn-success q-conv" data-id="${q.id}">Convert</button>` : ''}
            ${['expired', 'converted'].includes(q.status) ? `<button class="btn btn-sm btn-warning q-reactivate" data-id="${q.id}">Return to Saved Quotes</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No quotes in this date range</td></tr>'}
        </tbody></table></div></div></div>`;

    document.getElementById('aq-expiry-save')?.addEventListener('click', async () => {
      const quote_expiry_hours = parseInt(document.getElementById('aq-expiry-val').value, 10) || 168;
      const quote_expiry_unit = document.getElementById('aq-expiry-unit').value;
      const r = await API.saveSettings({ quote_expiry_hours, quote_expiry_unit }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      this.settings.quote_expiry_hours = quote_expiry_hours;
      this.settings.quote_expiry_unit = quote_expiry_unit;
      Utils.toast('Quote validity saved', 'success');
    });

    Utils.bindDateFilter('admin-quote-filter', async (from, to) => {
      this.quoteFrom = from;
      this.quoteTo = to;
      this.renderQuotesAdmin(el);
    });

    el.querySelectorAll('.q-view').forEach(b => b.addEventListener('click', () =>
      this.showQuoteDetailAdmin(parseInt(b.dataset.id, 10))));
    el.querySelectorAll('.q-print').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (r.data) await Receipt.printQuote(r.data, this.settings, 'a4');
    }));
    el.querySelectorAll('.q-receipt').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (r.data) await Receipt.printQuote(r.data, this.settings, 'thermal');
    }));

    el.querySelectorAll('.q-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this quote permanently?')) return;
      const r = await API.deleteQuote(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Quote deleted', 'success');
      this.renderQuotesAdmin(el);
    }));

    el.querySelectorAll('.q-conv').forEach(b => b.addEventListener('click', () =>
      this.discountQuoteBeforeConvert(parseInt(b.dataset.id, 10))));

    el.querySelectorAll('.q-reactivate').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Return this quote to Saved Quotes on POS?')) return;
      const r = await API.reactivateQuote(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Quote reactivated on POS', 'success');
      this.renderQuotesAdmin(el);
    }));

    el.querySelectorAll('.q-edit').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (!r.success || !r.data) return;
      const q = r.data;
      Utils.showModal(`Edit Quote ${q.quote_number}`, `
        <div class="field"><label>Notes</label><textarea id="aq-notes" rows="2">${q.notes || ''}</textarea></div>
        <div class="field"><label>Valid Until</label><input type="date" id="aq-valid" value="${q.valid_until || ''}"></div>
        <div class="field"><label>Discount (${currency})</label><input type="number" id="aq-discount" step="0.01" min="0" value="${q.discount || 0}"></div>
        <div class="field"><label>Status</label>
          <select id="aq-status"><option value="open" ${q.status==='open'?'selected':''}>Open</option>
          <option value="expired" ${q.status==='expired'?'selected':''}>Expired</option></select></div>`,
        '<button class="btn btn-primary" id="aq-print">Print A4</button><button class="btn btn-primary" id="aq-save">Save</button>');
      document.getElementById('aq-print').addEventListener('click', async () => {
        await Receipt.printQuote(q, this.settings, 'a4');
      });
      document.getElementById('aq-save').addEventListener('click', async () => {
        const discount = parseFloat(document.getElementById('aq-discount').value) || 0;
        const gross = (q.items || []).reduce((s, i) => s + Number(i.total || 0), 0);
        const totals = Utils.calcTaxInclusive(gross, discount, this.settings.tax_rate || 0, !!this.settings.tax_enabled);
        const sr = await API.saveQuote({
          id: q.id, customer_id: q.customer_id, items: q.items,
          subtotal: totals.subtotal, discount, tax_amount: totals.tax_amount, total: totals.total,
          valid_until: document.getElementById('aq-valid').value || null,
          notes: document.getElementById('aq-notes').value.trim(),
          status: document.getElementById('aq-status').value
        }, this.app.user);
        if (!sr.success) return Utils.toast(sr.error, 'error');
        Utils.hideModal();
        Utils.toast('Quote updated', 'success');
        this.renderQuotesAdmin(el);
      });
    }));
  };
})();
