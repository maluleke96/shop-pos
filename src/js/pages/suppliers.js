const SuppliersPage = {
  async activate(el, app) {
    this.app = app;
    this._host = el;
    if (el?.querySelector?.('#add-sup') && (this.suppliers || []).length) {
      API.getSuppliers().then((res) => {
        this.suppliers = res.data || [];
        this.paint(el);
      }).catch(() => {});
      return;
    }
    return this.render(el, app);
  },

  async render(el, app) {
    this.app = app;
    this._host = el;
    const peek = window.DataCache?.peek?.('suppliers', ['']);
    if (peek?.data?.length) {
      this.suppliers = peek.data;
      this.paint(el);
    } else {
      el.innerHTML = `<div class="page-toolbar"><h3>Suppliers</h3><button class="btn btn-primary" id="add-sup">+ Add Supplier</button></div>
        <div class="card">${Utils.pageSkeleton ? Utils.pageSkeleton(4) : '<p class="muted">Opening…</p>'}</div>`;
      document.getElementById('add-sup')?.addEventListener('click', () => this.showForm());
    }
    try {
      const res = await API.getSuppliers();
      this.suppliers = res.data || [];
      this.paint(el);
    } catch (err) {
      if (!this.suppliers?.length) throw err;
    }
  },

  paint(el) {
    const app = this.app;
    const currency = app.settings?.currency || 'R';
    const host = el || this._host;
    if (!host) return;
    this._host = host;
    host.innerHTML = `
      <div class="page-toolbar"><h3>Suppliers</h3><button type="button" class="btn btn-primary" id="add-sup">+ Add Supplier</button></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone (WhatsApp)</th><th>Stock brought</th><th>Pay by</th><th>Bank account</th><th>Balance Owed</th><th></th></tr></thead>
        <tbody>${(this.suppliers || []).map(s => {
          const owed = Number(s.balance_owed) || 0;
          return `<tr data-sup-id="${s.id}">
          <td><strong>${this.esc(s.name)}</strong>${s.address ? `<div class="muted" style="font-size:11px">${this.esc(s.address)}</div>` : ''}</td>
          <td>${this.esc(s.phone) || '—'}</td>
          <td>${s.stock_date ? Utils.formatDate?.(s.stock_date) || String(s.stock_date).slice(0, 10) : '—'}</td>
          <td>${s.pay_by_date ? Utils.formatDate?.(s.pay_by_date) || String(s.pay_by_date).slice(0, 10) : '—'}</td>
          <td class="muted" style="font-size:12px">${s.bank_name || s.bank_account_number
            ? `${this.esc(s.bank_name || '')}${s.bank_account_number ? ` · ${this.esc(s.bank_account_number)}` : ''}`
            : '—'}</td>
          <td><strong>${Utils.formatMoney(owed, currency)}</strong></td>
          <td class="actions" style="white-space:nowrap">
            <button type="button" class="btn btn-sm btn-success pay-sup" data-id="${s.id}" title="${owed > 0 ? 'Pay supplier' : 'Record a payment (set balance if needed)'}">Pay</button>
            <button type="button" class="btn btn-sm btn-ghost hist-sup" data-id="${s.id}">History</button>
            <button type="button" class="btn btn-sm btn-ghost edit-sup" data-id="${s.id}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger del-sup" data-id="${s.id}">Delete</button>
          </td></tr>`;
        }).join('') || '<tr><td colspan="7" class="muted">No suppliers</td></tr>'}
        </tbody></table></div></div>`;

    // Event delegation — always works even after re-paint
    if (this._supClickBound) host.removeEventListener('click', this._supClickBound);
    this._supClickBound = (e) => {
      const btn = e.target.closest('button');
      if (!btn || !host.contains(btn)) return;
      if (btn.id === 'add-sup') {
        e.preventDefault();
        this.showForm();
        return;
      }
      const id = parseInt(btn.dataset.id, 10);
      if (btn.classList.contains('pay-sup')) {
        e.preventDefault();
        const supplier = (this.suppliers || []).find((s) => Number(s.id) === id);
        if (!supplier) return Utils.toast('Supplier not found — refresh the page', 'error');
        this.showPayForm(supplier);
        return;
      }
      if (btn.classList.contains('edit-sup')) {
        e.preventDefault();
        this.showForm((this.suppliers || []).find((s) => Number(s.id) === id));
        return;
      }
      if (btn.classList.contains('hist-sup')) {
        e.preventDefault();
        this.showPaymentHistory(id);
        return;
      }
      if (btn.classList.contains('del-sup')) {
        e.preventDefault();
        (async () => {
          const s = (this.suppliers || []).find((x) => Number(x.id) === id);
          if (!s) return;
          if (!confirm(`Delete supplier “${s.name}”?`)) return;
          const r = await API.deleteSupplier(s.id, this.app.user);
          if (!r || r.success === false) return Utils.toast(r?.error || 'Could not delete', 'error');
          Utils.toast('Supplier deleted', 'success');
          SuppliersPage.render(this._host || document.querySelector('.page-host-active'), this.app);
        })();
      }
    };
    host.addEventListener('click', this._supClickBound);
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
        <div class="field"><label>Date stock brought</label><input type="date" id="su-stock-date" value="${this.esc((s?.stock_date || '').toString().slice(0, 10))}"></div>
        <div class="field"><label>Date we must pay</label><input type="date" id="su-pay-by" value="${this.esc((s?.pay_by_date || '').toString().slice(0, 10))}"></div>
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
        stock_date: document.getElementById('su-stock-date').value || null,
        pay_by_date: document.getElementById('su-pay-by').value || null,
        bank_name: document.getElementById('su-bank').value.trim(),
        bank_account_name: document.getElementById('su-acc-name').value.trim(),
        bank_account_number: document.getElementById('su-acc-num').value.trim(),
        bank_branch_code: document.getElementById('su-branch').value.trim(),
        notes: document.getElementById('su-notes').value.trim()
      }, this.app.user);
      Utils.hideModal();
      SuppliersPage.render(this._host || document.querySelector('.page-host-active'), this.app);
      Utils.toast('Supplier saved', 'success');
    });
  },

  showPayForm(supplier) {
    if (!supplier) return Utils.toast('Supplier not found', 'error');
    const currency = this.app.settings?.currency || 'R';
    let maxOwing = Number(supplier.balance_owed) || 0;
    if (maxOwing <= 0) {
      // Allow paying even if balance was never set — ask for amount via PaymentUI with a starter total
      Utils.toast('Balance owed is R0 — set an amount in the payment screen, or Edit the supplier balance first', 'info');
      maxOwing = 0;
    }
    const missingBank = !supplier.bank_name && !supplier.bank_account_number;
    const openAmount = maxOwing > 0 ? maxOwing : 100; // starter so amount field is usable when balance is 0

    const runPayment = (totalDue) => {
      if (typeof PaymentUI === 'undefined' || typeof PaymentUI.open !== 'function') {
        return this.showPayFormFallback(supplier, totalDue);
      }
      const gcRef = {};
      const opened = PaymentUI.open({
        total: totalDue,
        currency,
        settings: this.app.settings,
        title: `Pay Supplier — ${supplier.name}${maxOwing > 0 ? ' (partial OK)' : ''}`,
        confirmLabel: 'Record Payment',
        allowMixed: true,
        allowPartial: true,
        gcBalancesRef: gcRef,
        onConfirm: async ({ payments, paid }) => {
          if (maxOwing > 0 && paid > maxOwing + 0.01) throw new Error('Payment exceeds amount owing');
          if (paid <= 0) throw new Error('Enter an amount to pay');
          let lastPayment = null;
          for (const p of payments) {
            const r = await API.paySupplier(supplier.id, {
              amount: p.amount,
              payment_method: p.type,
              notes: payments.length > 1 ? `Mixed: ${payments.map((x) => x.type).join(' + ')}` : 'Supplier payment'
            }, this.app.user);
            if (!r || r.success === false) throw new Error(r?.error || 'Payment failed');
            lastPayment = r.data;
          }
          Utils.hideModal();
          await SuppliersPage.render(this._host || document.querySelector('.page-host-active'), this.app);
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
      // PaymentUI.open doesn't return showModal result — if modal blocked, fall back
      if (opened === false) this.showPayFormFallback(supplier, totalDue);
    };

    if (maxOwing <= 0) {
      Utils.showModal(`Pay ${supplier.name}`, `
        <p class="muted">No balance is recorded for this supplier yet. Enter how much you are paying now (this will reduce the balance; you can also Edit the supplier to set Balance Owed first).</p>
        <div class="field"><label>Amount to pay *</label>
          <input type="number" id="sup-pay-starter" step="0.01" min="0.01" value="" placeholder="e.g. 500" autofocus></div>
        ${!supplier.phone ? '<p class="muted" style="color:var(--warning)">Tip: add a WhatsApp number on Edit for payment receipts.</p>' : ''}
      `, `<button type="button" class="btn btn-ghost" id="sup-pay-cancel">Cancel</button>
         <button type="button" class="btn btn-success" id="sup-pay-continue">Continue to Pay</button>`);
      document.getElementById('sup-pay-cancel')?.addEventListener('click', Utils.hideModal);
      document.getElementById('sup-pay-continue')?.addEventListener('click', () => {
        const amt = parseFloat(document.getElementById('sup-pay-starter')?.value) || 0;
        if (amt <= 0) return Utils.toast('Enter an amount greater than zero', 'error');
        // Temporarily raise balance so payment can reduce it cleanly
        (async () => {
          try {
            await API.saveSupplier({
              id: supplier.id,
              name: supplier.name,
              phone: supplier.phone || '',
              email: supplier.email || '',
              address: supplier.address || '',
              balance_owed: amt,
              stock_date: supplier.stock_date || null,
              pay_by_date: supplier.pay_by_date || null,
              bank_name: supplier.bank_name || '',
              bank_account_name: supplier.bank_account_name || '',
              bank_account_number: supplier.bank_account_number || '',
              bank_branch_code: supplier.bank_branch_code || '',
              notes: supplier.notes || ''
            }, this.app.user);
            supplier.balance_owed = amt;
            maxOwing = amt;
            Utils.hideModal();
            runPayment(amt);
          } catch (err) {
            Utils.toast(err.message || 'Could not set balance', 'error');
          }
        })();
      });
      return;
    }

    if (!supplier.phone) {
      Utils.toast('Optional: add WhatsApp number on Edit for receipts', 'info');
    }
    runPayment(openAmount);
  },

  showPayFormFallback(supplier, totalDue) {
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal(`Pay Supplier — ${supplier.name}`, `
      <div class="form-grid">
        <div class="field"><label>Amount *</label>
          <input type="number" id="fb-pay-amt" step="0.01" min="0.01" value="${Number(totalDue || 0).toFixed(2)}"></div>
        <div class="field"><label>Method</label>
          <select id="fb-pay-method">
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="eft">EFT</option>
            <option value="mobile">Mobile</option>
          </select></div>
        <div class="field full"><label>Notes</label><input id="fb-pay-notes" placeholder="Optional"></div>
      </div>
    `, `<button type="button" class="btn btn-ghost" id="fb-pay-cancel">Cancel</button>
       <button type="button" class="btn btn-success" id="fb-pay-save">Record Payment</button>`);
    document.getElementById('fb-pay-cancel')?.addEventListener('click', Utils.hideModal);
    document.getElementById('fb-pay-save')?.addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('fb-pay-amt')?.value) || 0;
      if (amount <= 0) return Utils.toast('Enter amount', 'error');
      const r = await API.paySupplier(supplier.id, {
        amount,
        payment_method: document.getElementById('fb-pay-method')?.value || 'cash',
        notes: document.getElementById('fb-pay-notes')?.value || 'Supplier payment'
      }, this.app.user);
      if (!r || r.success === false) return Utils.toast(r?.error || 'Payment failed', 'error');
      Utils.hideModal();
      await SuppliersPage.render(this._host || document.querySelector('.page-host-active'), this.app);
      Utils.toast(`Paid ${Utils.formatMoney(amount, currency)}`, 'success');
      if (r.data) this.showPaymentReceiptActions(r.data, supplier);
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
    await Utils.printToA4(this.buildPaymentHtml(payment, supplier));
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
