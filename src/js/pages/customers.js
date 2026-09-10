const CustomersPage = {
  async render(el, app) {
    this.app = app;
    this._host = el;
    const peek = window.DataCache?.peek?.('customers', ['']);
    if (peek?.data) {
      this.customers = peek.data || [];
      this.paint(el);
    } else {
      el.innerHTML = `<div class="page-toolbar"><h3>Customers</h3></div><div class="card">${Utils.pageSkeleton(4)}</div>`;
    }
    try {
      const res = await API.getCustomers();
      this.customers = res.data || [];
      this.paint(el);
      window.DataCache?.clearStaleBanner?.(el);
    } catch (err) {
      if (!this.customers?.length) throw err;
      window.DataCache?.showStaleBanner?.(el, 'Unable to refresh. Showing last updated data.');
    }
  },

  paint(el) {
    el.innerHTML = `
      <div class="page-toolbar">
        <input type="search" id="cust-search" placeholder="Search customers…" style="padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;width:260px">
        <button class="btn btn-primary" id="add-cust">+ Add Customer</button>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Balance</th><th>Points</th><th></th></tr></thead>
        <tbody id="cust-table">${this.renderRows()}</tbody>
      </table></div></div>`;

    document.getElementById('add-cust').addEventListener('click', () => this.showForm());
    document.getElementById('cust-search').addEventListener('input', async (e) => {
      const res = await API.getCustomers(e.target.value);
      this.customers = res.data || [];
      document.getElementById('cust-table').innerHTML = this.renderRows();
      this.bindEvents();
    });
    this.bindEvents();
  },

  async activate(el, app) {
    return this.render(el, app);
  },

  renderRows() {
    const currency = this.app.settings?.currency || 'R';
    return this.customers.map(c => `<tr>
      <td><strong>${c.name}</strong></td><td>${c.phone || '—'}</td><td>${c.email || '—'}</td>
      <td>${Utils.formatMoney(c.balance, currency)}</td>
      <td>${Math.floor(c.loyalty_points || 0)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-ghost edit-cust" data-id="${c.id}">Edit</button>
        <button class="btn btn-sm btn-ghost hist-cust" data-id="${c.id}">History</button>
        <button class="btn btn-sm btn-danger del-cust" data-id="${c.id}">Delete</button>
        ${c.balance > 0 ? `<button class="btn btn-sm btn-success pay-cust" data-id="${c.id}">Pay Balance</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No customers</td></tr>';
  },

  bindEvents() {
    document.querySelectorAll('.edit-cust').forEach(b => b.addEventListener('click', () =>
      this.showForm(this.customers.find(c => c.id == b.dataset.id))));
    document.querySelectorAll('.hist-cust').forEach(b => b.addEventListener('click', () =>
      this.showHistory(parseInt(b.dataset.id))));
    document.querySelectorAll('.pay-cust').forEach(b => b.addEventListener('click', () =>
      this.showPayBalance(parseInt(b.dataset.id))));
    document.querySelectorAll('.del-cust').forEach(b => b.addEventListener('click', async () => {
      const c = this.customers.find(x => x.id == b.dataset.id);
      if (!confirm(`Delete customer "${c?.name}"? This cannot be undone if they have no purchase history.`)) return;
      const r = await API.deleteCustomer(parseInt(b.dataset.id), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Customer deleted', 'success');
      CustomersPage.render(document.getElementById('page-content'), this.app);
    }));
  },

  async showHistory(customerId) {
    const customer = this.customers.find(c => c.id === customerId);
    const [summaryRes, ledgerRes, loyaltyRes] = await Promise.all([
      API.getCustomerPurchaseSummary(customerId),
      API.getCreditLedger(customerId),
      API.getLoyaltyHistory(customerId)
    ]);
    const s = summaryRes.data || {};
    const currency = this.app.settings?.currency || 'R';
    const sales = s.sales || [];
    const ledger = ledgerRes.data || [];
    const loyalty = loyaltyRes.data || [];
    Utils.showModal(`Customer: ${customer?.name || ''}`, `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="label">Total Spent</div><div class="value">${Utils.formatMoney(s.totalSpent || 0, currency)}</div></div>
        <div class="stat-card"><div class="label">Orders</div><div class="value">${s.orderCount || 0}</div></div>
        <div class="stat-card"><div class="label">Avg Purchase</div><div class="value">${Utils.formatMoney(s.avgPurchase || 0, currency)}</div></div>
        <div class="stat-card"><div class="label">Favourite Product</div><div class="value" style="font-size:14px">${s.favouriteProduct || '—'}</div></div>
        <div class="stat-card"><div class="label">Last Visit</div><div class="value" style="font-size:14px">${s.lastVisit ? Utils.formatDateTime(s.lastVisit) : '—'}</div></div>
        <div class="stat-card"><div class="label">Balance Owed</div><div class="value">${Utils.formatMoney(customer?.balance || 0, currency)}</div></div>
      </div>
      <h4>Purchase History</h4>
      ${sales.length ? `<table style="width:100%"><tr><th>Receipt</th><th>Total</th><th>Date</th></tr>
        ${sales.map(x => `<tr><td>${x.receipt_number}</td><td>${Utils.formatMoney(x.total, currency)}</td><td>${Utils.formatDateTime(x.created_at)}</td></tr>`).join('')}</table>`
        : '<p class="muted">No purchases yet</p>'}
      ${ledger.length ? `<h4 style="margin-top:16px">Credit Ledger</h4>
        ${ledger.map(l => `<div style="padding:4px 0">${Utils.formatDateTime(l.created_at)} — ${l.type}: ${Utils.formatMoney(l.amount, currency)} ${l.notes || ''}</div>`).join('')}` : ''}
      ${loyalty.length ? `<h4 style="margin-top:16px">Loyalty Points</h4>
        <table style="width:100%"><tr><th>Date</th><th>Type</th><th>Points</th></tr>
          ${loyalty.map(l => `<tr><td>${Utils.formatDateTime(l.created_at)}</td><td>${l.type || '—'}</td><td>${l.points}</td></tr>`).join('')}</table>` : ''}`,
      '<button class="btn btn-ghost" id="close-hist">Close</button>');
    document.getElementById('close-hist')?.addEventListener('click', Utils.hideModal);
  },

  showPayBalance(customerId) {
    const customer = this.customers.find(c => c.id === customerId);
    const currency = this.app.settings?.currency || 'R';
    const gcRef = {};
    PaymentUI.open({
      total: customer.balance,
      currency,
      settings: this.app.settings,
      customer,
      title: `Pay Balance — ${customer.name}`,
      confirmLabel: 'Record Payment',
      allowMixed: true,
      gcBalancesRef: gcRef,
      onConfirm: async ({ payments, paid }) => {
        if (paid > customer.balance + 0.01) throw new Error('Payment exceeds balance owed');
        for (const p of payments) {
          await API.payCustomerCredit(customerId, p.amount, `Payment via ${p.type}`, this.app.user);
        }
        Utils.hideModal();
        CustomersPage.render(document.getElementById('page-content'), this.app);
        Utils.toast('Payment recorded', 'success');
      }
    });
  },

  loyaltySettings() {
    try {
      const raw = this.app.settings?.loyalty_settings;
      const ls = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      return { point_value: Number(ls.point_value) > 0 ? Number(ls.point_value) : 1 };
    } catch (_) {
      return { point_value: 1 };
    }
  },

  pointsValue(points) {
    const pv = this.loyaltySettings().point_value;
    return Utils.formatMoney((Number(points) || 0) * pv, this.app.settings?.currency || 'R');
  },

  giftPointsMessage(customer, delta, balance) {
    const shop = this.app.settings?.shop_name || 'Our shop';
    const name = (customer?.name || 'Customer').split(' ')[0];
    const absDelta = Math.abs(Number(delta) || 0);
    const bal = Math.floor(Number(balance) || customer?.loyalty_points || 0);
    if (delta > 0) {
      return `Hi ${name},\n\n${shop} has gifted you ${absDelta} loyalty points (worth ${this.pointsValue(absDelta)}).\n\nYour new balance is ${bal} points (${this.pointsValue(bal)}).\n\nUse them in-store or when ordering online.\n\nThank you!`;
    }
    return `Hi ${name},\n\nYour loyalty points at ${shop} have been updated.\n\nCurrent balance: ${bal} points (${this.pointsValue(bal)}).\n\nThank you!`;
  },

  async notifyPointsWhatsApp(customer, delta, balance) {
    const phone = String(customer?.phone || '').trim();
    if (!phone) return Utils.toast('Add a phone number first', 'error');
    const body = this.giftPointsMessage(customer, delta, balance);
    try {
      const wa = await API.sendWhatsAppMessage({
        phone,
        body,
        message_type: 'loyalty_gift',
        customer_id: customer.id,
        recipient_type: 'customer'
      }, this.app.user);
      await Utils.deliverWhatsApp(wa, phone, body);
    } catch (err) {
      Utils.toast(err.message || 'WhatsApp failed', 'error');
    }
  },

  notifyPointsEmail(customer, delta, balance) {
    const email = String(customer?.email || '').trim();
    if (!email) return Utils.toast('Add an email address first', 'error');
    const shop = this.app.settings?.shop_name || 'Our shop';
    const subject = encodeURIComponent(`${shop} — your loyalty points`);
    const body = encodeURIComponent(this.giftPointsMessage(customer, delta, balance));
    const url = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
    if (window.API?.openExternal) API.openExternal(url);
    else window.open(url, '_blank');
    Utils.toast('Email opened — review and send', 'success');
  },

  showForm(c = null) {
    const currency = this.app.settings?.currency || 'R';
    const points = Math.floor(c?.loyalty_points || 0);
    const pointsBlock = c ? `
      <div class="field full" style="margin-top:8px;padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--bg-secondary,#f8fafc)">
        <label style="font-weight:700;margin-bottom:8px;display:block">Loyalty points</label>
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:10px">
          <div><span class="muted">Current balance</span><br><strong style="font-size:1.25rem">${points}</strong> pts · ${this.pointsValue(points)}</div>
        </div>
        <div class="form-grid" style="margin-bottom:10px">
          <div class="field"><label>Add points</label><input type="number" id="cu-pts-add" min="0" step="1" placeholder="e.g. 50"></div>
          <div class="field"><label>Remove points</label><input type="number" id="cu-pts-remove" min="0" step="1" placeholder="e.g. 20"></div>
          <div class="field full"><label>Note (optional)</label><input id="cu-pts-note" placeholder="Birthday gift, correction…"></div>
        </div>
        <button type="button" class="btn btn-sm btn-primary" id="cu-pts-apply">Apply points change</button>
        <div id="cu-pts-notify" style="margin-top:12px;display:none">
          <p class="muted" style="margin:0 0 8px">Notify customer about this points update:</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" class="btn btn-sm btn-success" id="cu-wa-gift">💬 WhatsApp</button>
            <button type="button" class="btn btn-sm btn-ghost" id="cu-em-gift">✉️ Email</button>
          </div>
        </div>
      </div>` : '';

    Utils.showModal(c ? 'Edit Customer' : 'Add Customer', `
      <div class="form-grid">
        <div class="field"><label>Name *</label><input id="cu-name" value="${Utils.escHtml(c?.name || '')}"></div>
        <div class="field"><label>Phone</label><input id="cu-phone" value="${Utils.escHtml(c?.phone || '')}"></div>
        <div class="field"><label>Email</label><input id="cu-email" value="${Utils.escHtml(c?.email || '')}"></div>
        <div class="field"><label>Balance (${currency})</label><input type="number" id="cu-balance" step="0.01" value="${c?.balance || 0}"></div>
        <div class="field"><label>Credit Limit (${currency})</label><input type="number" id="cu-credit-limit" step="0.01" min="0" placeholder="Use shop default" value="${c?.credit_limit ?? ''}"></div>
        <div class="field full"><label><input type="checkbox" id="cu-on-account" ${c?.allow_on_account ? 'checked' : ''}> Approved for On Account purchases</label></div>
        <div class="field full"><label>Address</label><input id="cu-address" value="${Utils.escHtml(c?.address || '')}"></div>
        ${pointsBlock}
      </div>`,
      '<button class="btn btn-primary" id="save-cust">Save</button>');

    let lastPointChange = null;

    document.getElementById('cu-pts-apply')?.addEventListener('click', async () => {
      const add = parseInt(document.getElementById('cu-pts-add')?.value, 10) || 0;
      const remove = parseInt(document.getElementById('cu-pts-remove')?.value, 10) || 0;
      if (add && remove) return Utils.toast('Use either Add or Remove, not both', 'error');
      const delta = add || (remove ? -remove : 0);
      if (!delta) return Utils.toast('Enter points to add or remove', 'error');
      const note = document.getElementById('cu-pts-note')?.value.trim() || '';
      const r = await API.adjustLoyaltyPoints(c.id, delta, note, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not update points', 'error');
      const data = r.data || r;
      lastPointChange = { delta: data.delta, balance: data.balance };
      c.loyalty_points = data.balance;
      const notify = document.getElementById('cu-pts-notify');
      if (notify) notify.style.display = 'block';
      document.getElementById('cu-pts-add').value = '';
      document.getElementById('cu-pts-remove').value = '';
      Utils.toast(`${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} points — new balance: ${data.balance}`, 'success');
    });

    document.getElementById('cu-wa-gift')?.addEventListener('click', () => {
      const ch = lastPointChange || { delta: 0, balance: c.loyalty_points };
      this.notifyPointsWhatsApp({ ...c, phone: document.getElementById('cu-phone')?.value.trim() || c.phone }, ch.delta, ch.balance);
    });

    document.getElementById('cu-em-gift')?.addEventListener('click', () => {
      const ch = lastPointChange || { delta: 0, balance: c.loyalty_points };
      this.notifyPointsEmail({ ...c, email: document.getElementById('cu-email')?.value.trim() || c.email }, ch.delta, ch.balance);
    });

    document.getElementById('save-cust').addEventListener('click', async () => {
      const limitVal = document.getElementById('cu-credit-limit').value;
      const r = await API.saveCustomer({
        id: c?.id, name: document.getElementById('cu-name').value.trim(),
        phone: document.getElementById('cu-phone').value.trim(),
        email: document.getElementById('cu-email').value.trim(),
        address: document.getElementById('cu-address').value.trim(),
        balance: parseFloat(document.getElementById('cu-balance').value) || 0,
        allow_on_account: document.getElementById('cu-on-account').checked,
        credit_limit: limitVal !== '' ? parseFloat(limitVal) : null
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save customer', 'error');
      Utils.hideModal();
      CustomersPage.render(document.getElementById('page-content'), this.app);
      Utils.toast('Customer saved', 'success');
    });
  }
};
window.CustomersPage = CustomersPage;
