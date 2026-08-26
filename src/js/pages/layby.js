const LaybyPage = {
  from: null,
  to: null,
  statusFilter: 'all',

  async render(el, app) {
    this.app = app;
    this.from = this.from || Utils.daysAgo(90);
    this.to = this.to || Utils.today();
    const currency = app.settings?.currency || 'R';
    el.innerHTML = `<div class="page-toolbar"><h3>Lay-Bye / Partial Payments</h3>
      <button class="btn btn-primary" id="new-layby">+ New Lay-Bye</button></div>
      <p class="muted">Loading lay-byes…</p>`;
    const filters = { from: this.from, to: this.to };
    if (this.statusFilter && this.statusFilter !== 'all') filters.status = this.statusFilter;
    const [res, settingsRes] = await Promise.all([
      API.getLaybyes(filters),
      API.getLaybySettings(app.user).catch(() => ({ success: true, data: {} }))
    ]);
    const laybyes = res.data || [];
    const settings = settingsRes.data || {};
    const canSettings = ['owner', 'manager'].includes(app.user?.role);
    const canRefund = ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(app.user?.role);

    el.innerHTML = `<div class="page-toolbar"><h3>Lay-Bye / Partial Payments</h3>
      <button class="btn btn-primary" id="new-layby">+ New Lay-Bye</button></div>
      <div class="card" style="margin-bottom:12px"><div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
          <div class="field" style="margin:0"><label>From</label><input type="date" id="lb-from" value="${this.from}"></div>
          <div class="field" style="margin:0"><label>To</label><input type="date" id="lb-to" value="${this.to}"></div>
          <div class="field" style="margin:0"><label>Status</label>
            <select id="lb-status">
              <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>All</option>
              <option value="active" ${this.statusFilter === 'active' ? 'selected' : ''}>Active</option>
              <option value="completed" ${this.statusFilter === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="cancelled" ${this.statusFilter === 'cancelled' ? 'selected' : ''}>Cancelled / Refunded</option>
            </select></div>
          <button class="btn btn-primary btn-sm" id="lb-filter">Filter</button>
          <button class="btn btn-ghost btn-sm" id="lb-pdf">📄 PDF</button>
          <button class="btn btn-ghost btn-sm" id="lb-print">🖨️ Print</button>
        </div>
        ${canSettings ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:10px;align-items:end">
          <div class="field" style="margin:0"><label>Lay-bye duration (days)</label>
            <input type="number" id="lb-set-days" min="1" value="${settings.duration_days || 30}" style="width:90px"></div>
          <div class="field" style="margin:0"><label>Refund fee type</label>
            <select id="lb-set-fee-type">
              <option value="percent" ${settings.refund_fee_type !== 'fixed' ? 'selected' : ''}>Percent of paid</option>
              <option value="fixed" ${settings.refund_fee_type === 'fixed' ? 'selected' : ''}>Fixed amount</option>
            </select></div>
          <div class="field" style="margin:0"><label>Refund fee value</label>
            <input type="number" id="lb-set-fee-val" min="0" step="0.01" value="${settings.refund_fee_value ?? 10}" style="width:100px"></div>
          <button class="btn btn-primary btn-sm" id="lb-save-settings">Save Lay-Bye Rules</button>
          <p class="muted" style="flex-basis:100%;margin:0;font-size:12px">Customers may pay any small amount until the due date. After cancellation, refund = amount paid minus this fee.</p>
        </div>` : `<p class="muted" style="margin-top:10px;font-size:12px">Duration: ${settings.duration_days || 30} days · Refund fee: ${settings.refund_fee_type === 'fixed' ? Utils.formatMoney(settings.refund_fee_value || 0, currency) : `${settings.refund_fee_value || 0}%`}</p>`}
      </div></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Lay-Bye #</th><th>Customer</th><th>Items</th><th>Total</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${laybyes.map(l => `<tr>
          <td>${l.layby_number}</td>
          <td>${Utils.escHtml(l.customer_name || '—')}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.escHtml(l.item_summary || '')}">${Utils.escHtml(l.item_summary || '—')}</td>
          <td>${Utils.formatMoney(l.total, currency)}</td>
          <td>${Utils.formatMoney(l.amount_paid, currency)}</td>
          <td><strong>${Utils.formatMoney(l.balance, currency)}</strong></td>
          <td>${l.expires_at ? String(l.expires_at).slice(0, 10) : '—'}</td>
          <td><span class="tag ${l.status === 'completed' ? 'tag-ok' : l.status === 'cancelled' ? 'tag-low' : ''}">${l.status}</span></td>
          <td>${Utils.formatDateTime(l.created_at)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost lb-view" data-id="${l.id}">View</button>
            ${l.status === 'active' ? `<button class="btn btn-sm btn-success pay-layby" data-id="${l.id}" data-bal="${l.balance}">Pay</button>` : ''}
            ${l.status === 'active' && canRefund ? `<button class="btn btn-sm btn-danger lb-refund" data-id="${l.id}">Refund</button>` : ''}
            <button class="btn btn-sm btn-ghost lb-receipt" data-id="${l.id}">Receipt</button>
            <button class="btn btn-sm btn-ghost lb-wa" data-id="${l.id}">WhatsApp</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="10" class="muted">No lay-byes in this range</td></tr>'}
        </tbody></table></div></div>`;

    document.getElementById('lb-filter')?.addEventListener('click', () => {
      this.from = document.getElementById('lb-from').value || this.from;
      this.to = document.getElementById('lb-to').value || this.to;
      this.statusFilter = document.getElementById('lb-status').value || 'all';
      this.render(el, app);
    });
    document.getElementById('lb-save-settings')?.addEventListener('click', async () => {
      const r = await API.saveLaybySettings({
        duration_days: parseInt(document.getElementById('lb-set-days').value, 10) || 30,
        refund_fee_type: document.getElementById('lb-set-fee-type').value,
        refund_fee_value: parseFloat(document.getElementById('lb-set-fee-val').value) || 0
      }, app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Lay-bye rules saved', 'success');
    });
    const exportReport = async (mode) => {
      const headers = ['Lay-Bye #', 'Customer', 'Items', 'Total', 'Paid', 'Balance', 'Due', 'Status', 'Created'];
      const rows = laybyes.map(l => [
        l.layby_number, l.customer_name || '—', l.item_summary || '—',
        Utils.formatMoney(l.total, currency), Utils.formatMoney(l.amount_paid, currency),
        Utils.formatMoney(l.balance, currency), l.expires_at ? String(l.expires_at).slice(0, 10) : '—',
        l.status, Utils.formatDateTime(l.created_at)
      ]);
      const title = `Lay-Bye Records ${this.from} – ${this.to}`;
      const company = { ...Utils.companyInfo(app.settings), dateRange: `${this.from} to ${this.to}` };
      if (mode === 'pdf') {
        await Export.toPDF(`laybye-${this.from}-${this.to}.pdf`, title, headers, rows, company);
        Utils.toast('PDF ready', 'success');
      } else Export.print(title, headers, rows, company);
    };
    document.getElementById('lb-pdf')?.addEventListener('click', () => exportReport('pdf'));
    document.getElementById('lb-print')?.addEventListener('click', () => exportReport('print'));
    document.getElementById('new-layby').addEventListener('click', () => this.showCreateForm());
    el.querySelectorAll('.pay-layby').forEach(b => b.addEventListener('click', () => this.takePayment(parseInt(b.dataset.id, 10), parseFloat(b.dataset.bal))));
    el.querySelectorAll('.lb-view').forEach(b => b.addEventListener('click', () => this.showDetail(parseInt(b.dataset.id, 10))));
    el.querySelectorAll('.lb-receipt').forEach(b => b.addEventListener('click', () => this.printReceipt(parseInt(b.dataset.id, 10))));
    el.querySelectorAll('.lb-wa').forEach(b => b.addEventListener('click', () => this.sendWhatsApp(parseInt(b.dataset.id, 10))));
    el.querySelectorAll('.lb-refund').forEach(b => b.addEventListener('click', () => this.refundLayby(parseInt(b.dataset.id, 10))));
  },

  async takePayment(id, bal) {
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal('Lay-Bye Payment', `
      <p class="muted">Balance due: <strong>${Utils.formatMoney(bal, currency)}</strong> — enter any amount up to the balance.</p>
      <div class="field"><label>Amount</label><input type="number" id="lb-pay-amt" step="0.01" min="0.01" max="${bal}" value="${bal}"></div>
      <div class="field"><label>Method</label>
        <select id="lb-pay-type"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="mobile">Mobile</option></select></div>`,
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Cancel</button><button class="btn btn-success" id="lb-pay-go">Pay & Receipt</button>');
    document.getElementById('lb-pay-go')?.addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('lb-pay-amt').value) || 0;
      const type = document.getElementById('lb-pay-type').value || 'cash';
      if (amount <= 0) return Utils.toast('Enter an amount', 'error');
      if (amount > bal + 0.02) return Utils.toast('Amount exceeds balance', 'error');
      const r = await API.payLayby(id, amount, type, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast(`Paid — remaining ${Utils.formatMoney(r.data?.balance, currency)}`, 'success');
      await this.printReceipt(id, true);
      await this.sendWhatsApp(id, true);
      this.render(document.getElementById('page-content'), this.app);
    });
  },

  async refundLayby(id) {
    if (!confirm('Cancel this lay-bye and refund the customer (minus admin fee)?')) return;
    const r = await API.refundLayby(id, this.app.user);
    if (!r.success) return Utils.toast(r.error, 'error');
    const l = r.data;
    Utils.toast(`Refunded ${Utils.formatMoney(l.refunded_amount || 0, this.app.settings?.currency)} (fee ${Utils.formatMoney(l.refund_fee || 0, this.app.settings?.currency)})`, 'success');
    await this.printReceipt(id, true);
    await this.sendWhatsApp(id, true);
    this.render(document.getElementById('page-content'), this.app);
  },

  async showDetail(id) {
    const currency = this.app.settings?.currency || 'R';
    const r = await API.getLayby(id);
    if (!r.success || !r.data) return Utils.toast('Lay-bye not found', 'error');
    const l = r.data;
    Utils.showModal(`Lay-Bye ${l.layby_number}`, `
      <p><strong>Customer:</strong> ${Utils.escHtml(l.customer_name || '—')}
      ${l.customer_phone ? ` · ${Utils.escHtml(l.customer_phone)}` : ''}</p>
      <p><strong>Status:</strong> ${l.status}
        ${l.expires_at ? ` · <strong>Pay by:</strong> ${String(l.expires_at).slice(0, 10)}` : ''}</p>
      <p><strong>Total:</strong> ${Utils.formatMoney(l.total, currency)}
        · <strong>Paid:</strong> ${Utils.formatMoney(l.amount_paid, currency)}
        · <strong>Balance:</strong> ${Utils.formatMoney(l.balance, currency)}</p>
      ${l.status === 'cancelled' ? `<p class="muted">Refunded ${Utils.formatMoney(l.refunded_amount || 0, currency)} (fee ${Utils.formatMoney(l.refund_fee || 0, currency)})</p>` : ''}
      <h4 style="margin-top:12px">Products</h4>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${(l.items || []).map(i => `<tr>
          <td>${Utils.escHtml(i.product_name)}</td><td>${i.quantity}</td>
          <td>${Utils.formatMoney(i.unit_price, currency)}</td>
          <td>${Utils.formatMoney(i.total, currency)}</td></tr>`).join('')}</tbody></table></div>
      <h4 style="margin-top:12px">Payments</h4>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
        <tbody>${(l.payments || []).map(p => `<tr>
          <td>${Utils.formatDateTime(p.created_at)}</td>
          <td>${Utils.formatMoney(p.amount, currency)}</td>
          <td>${p.payment_type}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No payments yet</td></tr>'}
        </tbody></table></div>`,
      `<button class="btn btn-ghost" id="lb-detail-receipt">Thermal Receipt</button>
       <button class="btn btn-ghost" id="lb-detail-wa">WhatsApp</button>
       <button class="btn btn-primary" onclick="Utils.hideModal()">Close</button>`);
    document.getElementById('lb-detail-receipt')?.addEventListener('click', () => this.printReceipt(id));
    document.getElementById('lb-detail-wa')?.addEventListener('click', () => this.sendWhatsApp(id));
  },

  async printReceipt(id, quiet) {
    const r = await API.getLayby(id);
    if (!r.success || !r.data) return Utils.toast('Not found', 'error');
    const l = r.data;
    try {
      const html = Receipt.buildLayby(l, this.app.settings);
      const printR = await API.printReceipt(html, Receipt._devicePrintOpts(this.app.settings));
      if (!quiet) Utils.toast(printR.success ? 'Lay-bye receipt sent to printer' : (printR.error || 'Print failed'), printR.success ? 'success' : 'error');
    } catch (e) {
      if (!quiet) Utils.toast(e.message || 'Print failed', 'error');
    }
  },

  async sendWhatsApp(id, quiet) {
    const r = await API.getLayby(id);
    if (!r.success || !r.data) return quiet ? null : Utils.toast('Not found', 'error');
    const l = r.data;
    const phone = l.customer_phone;
    if (!phone) return quiet ? null : Utils.toast('Customer has no phone number', 'error');
    const msg = Receipt.buildLaybyWhatsApp(l, this.app.settings);
    const wa = await API.sendWhatsAppMessage({
      phone,
      recipient_name: l.customer_name || 'Customer',
      message_type: 'layby',
      body: msg
    }, this.app.user);
    if (!wa.success && quiet) return null;
    await Utils.deliverWhatsApp(wa, phone, msg);
  },

  async showCreateForm() {
    const [custRes, prodRes, setRes] = await Promise.all([
      API.getCustomers(), API.getProducts(), API.getLaybySettings(this.app.user).catch(() => ({ data: {} }))
    ]);
    const days = setRes.data?.duration_days || 30;
    Utils.showModal('New Lay-Bye', `
      <div class="field"><label>Customer *</label><select id="lb-customer" required>${(custRes.data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
      <div class="field"><label>Product</label><select id="lb-product">${(prodRes.data || []).map(p => `<option value="${p.id}" data-price="${p.selling_price}" data-name="${p.name}">${p.name}</option>`).join('')}</select></div>
      <div class="field"><label>Quantity</label><input type="number" id="lb-qty" min="0.01" step="0.01" value="1"></div>
      <div class="field"><label>Deposit (any amount)</label><input type="number" id="lb-deposit" step="0.01" value="0"></div>
      <p class="muted">Customer has ${days} days to finish paying (admin setting).</p>`,
      '<button class="btn btn-primary" id="save-layby">Create Lay-Bye</button>');
    document.getElementById('save-layby').addEventListener('click', async () => {
      const sel = document.getElementById('lb-product').selectedOptions[0];
      const qty = parseFloat(document.getElementById('lb-qty').value) || 1;
      const price = parseFloat(sel.dataset.price);
      const total = price * qty;
      const deposit = parseFloat(document.getElementById('lb-deposit').value) || 0;
      const r = await API.createLayby({
        customer_id: parseInt(document.getElementById('lb-customer').value, 10),
        items: [{ product_id: parseInt(sel.value, 10), product_name: sel.dataset.name, quantity: qty, unit_price: price, total }],
        total, deposit, payment_type: 'cash'
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast(`Lay-bye ${r.data.laybyNumber} created`, 'success');
      await this.printReceipt(r.data.id, true);
      this.render(document.getElementById('page-content'), this.app);
    });
  }
};
window.LaybyPage = LaybyPage;
