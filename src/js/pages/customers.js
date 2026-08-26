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

  showForm(c = null) {
    Utils.showModal(c ? 'Edit Customer' : 'Add Customer', `
      <div class="form-grid">
        <div class="field"><label>Name *</label><input id="cu-name" value="${c?.name || ''}"></div>
        <div class="field"><label>Phone</label><input id="cu-phone" value="${c?.phone || ''}"></div>
        <div class="field"><label>Email</label><input id="cu-email" value="${c?.email || ''}"></div>
        <div class="field"><label>Balance</label><input type="number" id="cu-balance" step="0.01" value="${c?.balance || 0}"></div>
        <div class="field"><label>Credit Limit (${this.app.settings?.currency || 'R'})</label><input type="number" id="cu-credit-limit" step="0.01" min="0" placeholder="Use shop default" value="${c?.credit_limit ?? ''}"></div>
        <div class="field full"><label><input type="checkbox" id="cu-on-account" ${c?.allow_on_account ? 'checked' : ''}> Approved for On Account purchases</label></div>
        <div class="field full"><label>Address</label><input id="cu-address" value="${c?.address || ''}"></div>
      </div>`,
      '<button class="btn btn-primary" id="save-cust">Save</button>');
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
