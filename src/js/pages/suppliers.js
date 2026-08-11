const SuppliersPage = {
  async render(el, app) {
    this.app = app;
    const res = await API.getSuppliers();
    this.suppliers = res.data || [];
    const currency = app.settings?.currency || 'R';

    el.innerHTML = `
      <div class="page-toolbar"><h3>Suppliers</h3><button class="btn btn-primary" id="add-sup">+ Add Supplier</button></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone (WhatsApp)</th><th>Bank account</th><th>Address</th><th>Balance Owed</th><th></th></tr></thead>
        <tbody>${this.suppliers.map(s => `<tr>
          <td><strong>${s.name}</strong></td>
          <td>${s.phone || '—'}</td>
          <td class="muted" style="font-size:12px">${s.bank_name || s.bank_account_number
            ? `${s.bank_name || ''}${s.bank_account_number ? ` · ${s.bank_account_number}` : ''}`
            : '—'}</td>
          <td>${s.address || '—'}</td>
          <td>${Utils.formatMoney(s.balance_owed, currency)}</td>
          <td class="actions">
            <button class="btn btn-sm btn-success pay-sup" data-id="${s.id}" ${!(s.balance_owed > 0) ? 'disabled' : ''}>Pay</button>
            <button class="btn btn-sm btn-ghost hist-sup" data-id="${s.id}">History</button>
            <button class="btn btn-sm btn-ghost edit-sup" data-id="${s.id}">Edit</button>
          </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No suppliers</td></tr>'}
        </tbody></table></div></div>`;

    document.getElementById('add-sup').addEventListener('click', () => this.showForm());
    document.querySelectorAll('.edit-sup').forEach(b => b.addEventListener('click', () =>
      this.showForm(this.suppliers.find(s => s.id == b.dataset.id))));
    document.querySelectorAll('.pay-sup').forEach(b => b.addEventListener('click', () =>
      this.showPayForm(this.suppliers.find(s => s.id == b.dataset.id))));
    document.querySelectorAll('.hist-sup').forEach(b => b.addEventListener('click', () =>
      this.showPaymentHistory(parseInt(b.dataset.id, 10))));
  },

  esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  },

  showForm(s = null) {
    Utils.showModal(s ? 'Edit Supplier' : 'Add Supplier', `
      <div class="form-grid">
        <div class="field"><label>Name *</label><input id="su-name" value="${this.esc(s?.name)}"></div>
        <div class="field"><label>Phone / WhatsApp *</label><input id="su-phone" value="${this.esc(s?.phone)}" placeholder="e.g. 0821234567"></div>
        <div class="field"><label>Email</label><input id="su-email" value="${this.esc(s?.email)}"></div>
        <div class="field"><label>Balance Owed</label><input type="number" id="su-balance" step="0.01" value="${s?.balance_owed || 0}"></div>
        <div class="field full"><label>Address</label><input id="su-address" value="${this.esc(s?.address)}"></div>
        <div class="field full"><strong>Bank / account details</strong><p class="muted" style="margin:4px 0 0;font-size:12px">Filled on payment receipts (print, PDF, WhatsApp).</p></div>
        <div class="field"><label>Bank name</label><input id="su-bank" value="${this.esc(s?.bank_name)}" placeholder="e.g. FNB, Standard Bank"></div>
        <div class="field"><label>Account name</label><input id="su-acc-name" value="${this.esc(s?.bank_account_name)}" placeholder="Account holder"></div>
        <div class="field"><label>Account number</label><input id="su-acc-num" value="${this.esc(s?.bank_account_number)}"></div>
        <div class="field"><label>Branch code</label><input id="su-branch" value="${this.esc(s?.bank_branch_code)}"></div>
        <div class="field full"><label>Notes</label><input id="su-notes" value="${this.esc(s?.notes)}"></div>
      </div>`,
      '<button class="btn btn-primary" id="save-sup">Save</button>');
    document.getElementById('save-sup').addEventListener('click', async () => {
      const name = document.getElementById('su-name').value.trim();
      const phone = document.getElementById('su-phone').value.trim();
      if (!name) return Utils.toast('Name is required', 'error');
      if (!phone) return Utils.toast('Phone / WhatsApp number is required for payment receipts', 'error');
      await API.saveSupplier({
        id: s?.id,
        name,
        phone,
        email: document.getElementById('su-email').value.trim(),
        address: document.getElementById('su-address').value.trim(),
        balance_owed: parseFloat(document.getElementById('su-balance').value) || 0,
        bank_name: document.getElementById('su-bank').value.trim(),
        bank_account_name: document.getElementById('su-acc-name').value.trim(),
        bank_account_number: document.getElementById('su-acc-num').value.trim(),
        bank_branch_code: document.getElementById('su-branch').value.trim(),
        notes: document.getElementById('su-notes').value.trim()
      }, this.app.user);
      Utils.hideModal();
      SuppliersPage.render(document.getElementById('page-content'), this.app);
      Utils.toast('Supplier saved', 'success');
    });
  },

  showPayForm(supplier) {
    const currency = this.app.settings?.currency || 'R';
    const maxOwing = supplier.balance_owed;
    if (!supplier.phone) {
      Utils.toast('Add the supplier WhatsApp/phone number first (Edit supplier)', 'error');
      return this.showForm(supplier);
    }
    const missingBank = !supplier.bank_name && !supplier.bank_account_number;
    const gcRef = {};
    PaymentUI.open({
      total: maxOwing,
      currency,
      settings: this.app.settings,
      title: `Pay Supplier — ${supplier.name} (partial OK)`,
      confirmLabel: 'Record Partial / Full Payment',
      allowMixed: true,
      allowPartial: true,
      gcBalancesRef: gcRef,
      onConfirm: async ({ payments, paid }) => {
        if (paid > maxOwing + 0.01) throw new Error('Payment exceeds amount owing');
        if (paid <= 0) throw new Error('Enter an amount to pay');
        let lastPayment = null;
        for (const p of payments) {
          const r = await API.paySupplier(supplier.id, {
            amount: p.amount,
            payment_method: p.type,
            notes: payments.length > 1 ? `Mixed: ${payments.map(x => x.type).join(' + ')}` : 'Partial/supplier debt payment'
          }, this.app.user);
          if (!r.success) throw new Error(r.error);
          lastPayment = r.data;
        }
        Utils.hideModal();
        SuppliersPage.render(document.getElementById('page-content'), this.app);
        const remaining = lastPayment?.balance_after ?? Math.max(0, maxOwing - paid);
        Utils.toast(remaining > 0.01
          ? `Paid ${Utils.formatMoney(paid, currency)} — ${Utils.formatMoney(remaining, currency)} still owing`
          : 'Debt settled in full', 'success');
        if (lastPayment) {
          const fresh = { ...supplier, ...(lastPayment.supplier_phone ? { phone: lastPayment.supplier_phone } : {}) };
          this.showPaymentReceiptActions(lastPayment, fresh, { warnBank: missingBank });
        }
      }
    });
  },

  bankDetailsText(payment, supplier) {
    const bank = payment.bank_name || supplier.bank_name;
    const accName = payment.bank_account_name || supplier.bank_account_name;
    const accNum = payment.bank_account_number || supplier.bank_account_number;
    const branch = payment.bank_branch_code || supplier.bank_branch_code;
    const parts = [];
    if (bank) parts.push(`Bank: ${bank}`);
    if (accName) parts.push(`Account name: ${accName}`);
    if (accNum) parts.push(`Account #: ${accNum}`);
    if (branch) parts.push(`Branch: ${branch}`);
    return parts.join('\n');
  },

  buildPaymentHtml(payment, supplier) {
    const s = this.app.settings || {};
    const currency = s.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const bankBlock = this.bankDetailsText(payment, supplier);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;padding:24px;max-width:210mm;margin:0 auto;color:#0f172a}
      h1{text-align:center;font-size:22px;margin:0 0 8px}
      .center{text-align:center}.muted{color:#64748b;font-size:13px}
      table{width:100%;margin:16px 0;border-collapse:collapse}
      td{padding:8px 0;border-bottom:1px solid #e2e8f0}
      .bank{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:12px;white-space:pre-line}
    </style></head><body>
      <h1>SUPPLIER PAYMENT RECEIPT</h1>
      <div class="center"><strong>${s.shop_name || 'Shop POS'}</strong></div>
      ${s.phone ? `<div class="center muted">Tel: ${s.phone}</div>` : ''}
      <p><strong>Payment No:</strong> ${payment.payment_number}</p>
      <p><strong>Date:</strong> ${Utils.formatDateTime(payment.created_at)}</p>
      <p><strong>Supplier:</strong> ${payment.supplier_name || supplier.name}</p>
      ${(payment.supplier_phone || supplier.phone) ? `<p><strong>WhatsApp / Phone:</strong> ${payment.supplier_phone || supplier.phone}</p>` : ''}
      ${(payment.supplier_address || supplier.address) ? `<p><strong>Address:</strong> ${payment.supplier_address || supplier.address}</p>` : ''}
      <table>
        <tr><td>Previous Balance</td><td align="right">${fmt(payment.balance_before)}</td></tr>
        <tr><td><strong>Amount Paid</strong></td><td align="right"><strong>${fmt(payment.amount)}</strong></td></tr>
        <tr><td>Remaining Balance</td><td align="right">${fmt(payment.balance_after)}</td></tr>
        <tr><td>Method</td><td align="right">${payment.payment_method}</td></tr>
      </table>
      ${bankBlock ? `<div class="bank"><strong>Supplier account details</strong>\n${bankBlock}</div>` : '<p class="muted">No bank account details on file for this supplier.</p>'}
      <p class="center" style="margin-top:24px">Thank you for your service.</p>
    </body></html>`;
  },

  showPaymentReceiptActions(payment, supplier, opts = {}) {
    const phone = payment.supplier_phone || supplier.phone || '';
    Utils.showModal('Payment receipt', `
      <p>Payment <strong>${payment.payment_number}</strong> recorded for <strong>${payment.supplier_name || supplier.name}</strong>.</p>
      ${opts.warnBank ? '<p class="muted" style="color:var(--warning)">Bank details are empty — edit the supplier to fill account details for next time.</p>' : ''}
      <p class="muted">Send to WhatsApp (${phone || 'no phone'}), print, or save PDF.</p>
      <div class="field"><label>WhatsApp number</label>
        <input id="sup-pay-phone" value="${this.esc(phone)}" placeholder="Supplier phone"></div>
    `, `
      <button class="btn btn-primary" id="sup-pay-wa">Send WhatsApp</button>
      <button class="btn btn-ghost" id="sup-pay-print">Print</button>
      <button class="btn btn-ghost" id="sup-pay-pdf">Save PDF</button>
      <button class="btn btn-ghost" id="sup-pay-close">Close</button>
    `);
    document.getElementById('sup-pay-close')?.addEventListener('click', Utils.hideModal);
    document.getElementById('sup-pay-print')?.addEventListener('click', async () => {
      await this.printPaymentSlip(payment, supplier);
      Utils.toast('Sent to printer', 'success');
    });
    document.getElementById('sup-pay-pdf')?.addEventListener('click', async () => {
      await this.savePaymentPdf(payment, supplier);
    });
    document.getElementById('sup-pay-wa')?.addEventListener('click', async () => {
      const waPhone = document.getElementById('sup-pay-phone')?.value.trim();
      if (!waPhone) return Utils.toast('Enter supplier WhatsApp number', 'error');
      await this.sendPaymentWhatsApp(payment, supplier, waPhone);
    });
  },

  async printPaymentSlip(payment, supplier) {
    await API.printA4(this.buildPaymentHtml(payment, supplier));
  },

  async savePaymentPdf(payment, supplier) {
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const bank = this.bankDetailsText(payment, supplier);
    const headers = ['Detail', 'Value'];
    const rows = [
      ['Payment No', payment.payment_number],
      ['Supplier', payment.supplier_name || supplier.name],
      ['Phone', payment.supplier_phone || supplier.phone || '—'],
      ['Previous balance', fmt(payment.balance_before)],
      ['Amount paid', fmt(payment.amount)],
      ['Remaining balance', fmt(payment.balance_after)],
      ['Method', payment.payment_method || '—']
    ];
    if (bank) rows.push(['Account details', bank.replace(/\n/g, ' · ')]);
    await Export.toPDF(
      `${payment.payment_number}.pdf`,
      `Supplier Payment ${payment.payment_number}`,
      headers,
      rows,
      Utils.companyInfo(this.app.settings)
    );
    Utils.toast('PDF saved', 'success');
  },

  async sendPaymentWhatsApp(payment, supplier, phone) {
    const currency = this.app.settings?.currency || 'R';
    const bank = this.bankDetailsText(payment, supplier);
    const r = await API.sendWhatsAppMessage({
      phone,
      recipient_type: 'supplier',
      recipient_name: payment.supplier_name || supplier.name,
      supplier_name: payment.supplier_name || supplier.name,
      payment_number: payment.payment_number,
      amount_paid: payment.amount,
      payment_method: payment.payment_method,
      balance_before: payment.balance_before,
      balance_after: payment.balance_after,
      bank_details_line: bank ? `🏦 Account details:\n${bank}` : '',
      branch: this.app.settings?.shop_name,
      phone_shop: this.app.settings?.phone,
      message_type: 'supplier_payment',
      template_slug: 'supplier_payment',
      body: !phone ? null : undefined
    }, this.app.user);
    if (!r.success) return Utils.toast(r.error || 'WhatsApp failed', 'error');
    window.open(r.data.url, '_blank');
    await API.markWhatsAppOpened?.(r.data.id, this.app.user);
    Utils.toast('WhatsApp opened with payment receipt', 'success');
  },

  async showPaymentHistory(supplierId) {
    const supplier = this.suppliers.find(s => s.id === supplierId);
    const r = await API.getSupplierPayments(supplierId);
    const payments = r.data || [];
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal(`Payment History — ${supplier?.name || ''}`, `
      ${payments.length ? `<table style="width:100%"><tr><th>Date</th><th>Ref</th><th>Amount</th><th>Method</th><th>By</th><th></th></tr>
        ${payments.map(p => `<tr><td>${Utils.formatDateTime(p.created_at)}</td><td>${p.payment_number}</td>
          <td>${Utils.formatMoney(p.amount, currency)}</td><td>${p.payment_method}</td><td>${p.user_name || '—'}</td>
          <td><button type="button" class="btn btn-sm btn-ghost hist-reprint" data-ref="${this.esc(p.payment_number)}"
            data-amount="${p.amount}" data-method="${this.esc(p.payment_method)}" data-at="${this.esc(p.created_at)}">Receipt</button></td></tr>`).join('')}</table>`
        : '<p class="muted">No payments recorded yet</p>'}`,
      '<button class="btn btn-ghost" id="close-sup-hist">Close</button>');
    document.getElementById('close-sup-hist')?.addEventListener('click', Utils.hideModal);
    document.querySelectorAll('.hist-reprint').forEach(btn => btn.addEventListener('click', () => {
      const payment = {
        payment_number: btn.dataset.ref,
        amount: parseFloat(btn.dataset.amount) || 0,
        payment_method: btn.dataset.method,
        created_at: btn.dataset.at,
        balance_before: null,
        balance_after: supplier?.balance_owed,
        supplier_name: supplier?.name,
        supplier_phone: supplier?.phone,
        bank_name: supplier?.bank_name,
        bank_account_name: supplier?.bank_account_name,
        bank_account_number: supplier?.bank_account_number,
        bank_branch_code: supplier?.bank_branch_code
      };
      this.showPaymentReceiptActions(payment, supplier || {});
    }));
  }
};
window.SuppliersPage = SuppliersPage;
