const CustomersPage = {
  _searchQuery: '',
  _searchTimer: null,
  _allCustomers: [],

  async render(el, app) {
    this.app = app;
    this._host = el;
    const peek = window.DataCache?.peek?.('customers', ['']);
    if (peek?.data) {
      this._allCustomers = peek.data || [];
      this.customers = [...this._allCustomers];
      this.paint(el);
    } else {
      el.innerHTML = `<div class="page-toolbar"><h3>Customers</h3></div><div class="card">${Utils.pageSkeleton(4)}</div>`;
    }
    try {
      const res = await API.getCustomers('');
      this._allCustomers = res.data || (Array.isArray(res) ? res : []);
      this.customers = this._searchQuery ? this.filterLocal(this._searchQuery) : [...this._allCustomers];
      if (this._searchQuery) await this.runSearch(false);
      else this.paint(el);
      window.DataCache?.clearStaleBanner?.(el);
    } catch (err) {
      if (!this.customers?.length) throw err;
      window.DataCache?.showStaleBanner?.(el, 'Unable to refresh. Showing last updated data.');
    }
  },

  filterLocal(q) {
    const ql = String(q || '').trim().toLowerCase();
    if (!ql) return [...(this._allCustomers || [])];
    const digits = ql.replace(/\D/g, '');
    return (this._allCustomers || []).filter((c) => {
      const name = String(c.name || '').toLowerCase();
      const email = String(c.email || '').toLowerCase();
      const phone = String(c.phone || '');
      const phoneDigits = phone.replace(/\D/g, '');
      return name.includes(ql)
        || email.includes(ql)
        || phone.toLowerCase().includes(ql)
        || (digits.length >= 2 && phoneDigits.includes(digits));
    });
  },

  async runSearch(repaint = true) {
    const q = (this._searchQuery || '').trim();
    try {
      const res = await API.getCustomers(q);
      const rows = res?.data ?? (Array.isArray(res) ? res : []);
      this.customers = rows.length || !q ? rows : this.filterLocal(q);
    } catch (_) {
      this.customers = this.filterLocal(q);
    }
    if (repaint) {
      const tbody = document.getElementById('cust-table');
      if (tbody) {
        tbody.innerHTML = this.renderRows();
        this.bindEvents();
      } else if (this._host) {
        this.paint(this._host);
      }
    }
  },

  paint(el) {
    el.innerHTML = `
      <div class="page-toolbar">
        <input type="search" id="cust-search" placeholder="Search by name, phone or email…" value="${Utils.escHtml(this._searchQuery || '')}" style="padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;width:min(100%,320px)">
        <button class="btn btn-primary" id="add-cust">+ Add Customer</button>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Balance</th><th>Points</th><th></th></tr></thead>
        <tbody id="cust-table">${this.renderRows()}</tbody>
      </table></div></div>`;

    document.getElementById('add-cust').addEventListener('click', () => this.showForm());
    const searchEl = document.getElementById('cust-search');
    searchEl?.addEventListener('input', (e) => {
      this._searchQuery = e.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.runSearch(), 200);
    });
    searchEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(this._searchTimer);
        this.runSearch();
      }
    });
    this.bindEvents();
  },

  async activate(el, app) {
    return this.render(el, app);
  },

  renderRows() {
    const currency = this.app.settings?.currency || 'R';
    return this.customers.map(c => `<tr>
      <td><strong>${Utils.escHtml(c.name)}</strong></td>
      <td>${Utils.escHtml(c.phone || '—')}</td>
      <td>${Utils.escHtml(c.email || '—')}</td>
      <td>${Utils.formatMoney(c.balance, currency)}</td>
      <td>${Math.floor(c.loyalty_points || 0)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-ghost edit-cust" data-id="${c.id}">Edit</button>
        <button class="btn btn-sm btn-ghost hist-cust" data-id="${c.id}">History</button>
        <button class="btn btn-sm btn-danger del-cust" data-id="${c.id}">Delete</button>
        ${c.balance > 0 ? `<button class="btn btn-sm btn-success pay-cust" data-id="${c.id}">Pay Balance</button>` : ''}
      </td></tr>`).join('') || `<tr><td colspan="6" class="muted">${this._searchQuery ? 'No customers match your search' : 'No customers'}</td></tr>`;
  },

  bindEvents() {
    document.querySelectorAll('.edit-cust').forEach(b => b.addEventListener('click', () =>
      this.showForm(this.customers.find(c => String(c.id) === String(b.dataset.id)))));
    document.querySelectorAll('.hist-cust').forEach(b => b.addEventListener('click', () =>
      this.showHistory(parseInt(b.dataset.id, 10))));
    document.querySelectorAll('.pay-cust').forEach(b => b.addEventListener('click', () =>
      this.showPayBalance(parseInt(b.dataset.id, 10))));
    document.querySelectorAll('.del-cust').forEach(b => b.addEventListener('click', async () => {
      const c = this.customers.find(x => String(x.id) === String(b.dataset.id));
      const bal = Number(c?.balance) || 0;
      const pts = Math.floor(c?.loyalty_points || 0);
      let msg = `Permanently delete "${c?.name}"?`;
      if (bal > 0 || pts > 0) {
        msg += `\n\nThis customer has ${bal > 0 ? `balance ${Utils.formatMoney(bal, this.app.settings?.currency || 'R')}` : ''}${bal > 0 && pts > 0 ? ' and ' : ''}${pts > 0 ? `${pts} loyalty points` : ''}. They will be removed from the system. Past sales stay in reports but will no longer be linked to this customer.`;
      }
      if (!confirm(msg)) return;
      const r = await API.deleteCustomer(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Customer deleted', 'success');
      this._searchQuery = '';
      CustomersPage.render(document.getElementById('page-content'), this.app);
    }));
  },

  async showHistory(customerId) {
    let customer = this.customers.find(c => c.id === customerId);
    if (!customer) {
      try {
        const r = await API.getCustomer(customerId);
        customer = r.data || r;
      } catch (_) { /* ignore */ }
    }
    try {
      const [summaryRes, ledgerRes, loyaltyRes] = await Promise.all([
        API.getCustomerPurchaseSummary(customerId),
        API.getCreditLedger(customerId),
        API.getLoyaltyHistory(customerId)
      ]);
      const s = summaryRes?.data ?? summaryRes ?? {};
      const currency = this.app.settings?.currency || 'R';
      const sales = s.sales || [];
      const ledger = ledgerRes?.data ?? ledgerRes ?? [];
      const loyalty = loyaltyRes?.data ?? loyaltyRes ?? [];
      Utils.showModal(`Customer: ${Utils.escHtml(customer?.name || '')}`, `
        <div class="stats-grid" style="margin-bottom:16px">
          <div class="stat-card"><div class="label">Total Spent</div><div class="value">${Utils.formatMoney(s.totalSpent || 0, currency)}</div></div>
          <div class="stat-card"><div class="label">Orders</div><div class="value">${s.orderCount || 0}</div></div>
          <div class="stat-card"><div class="label">Avg Purchase</div><div class="value">${Utils.formatMoney(s.avgPurchase || 0, currency)}</div></div>
          <div class="stat-card"><div class="label">Favourite Product</div><div class="value" style="font-size:14px">${Utils.escHtml(s.favouriteProduct || '—')}</div></div>
          <div class="stat-card"><div class="label">Last Visit</div><div class="value" style="font-size:14px">${s.lastVisit ? Utils.formatDateTime(s.lastVisit) : '—'}</div></div>
          <div class="stat-card"><div class="label">Balance Owed</div><div class="value">${Utils.formatMoney(customer?.balance || 0, currency)}</div></div>
          <div class="stat-card"><div class="label">Loyalty Points</div><div class="value">${Math.floor(customer?.loyalty_points || 0)}</div></div>
        </div>
        <h4>Purchase History</h4>
        ${sales.length ? `<div class="table-wrap"><table style="width:100%"><tr><th>Receipt</th><th>Total</th><th>Cashier</th><th>Date</th></tr>
          ${sales.map(x => `<tr><td>${Utils.escHtml(x.receipt_number || '—')}</td><td>${Utils.formatMoney(x.total, currency)}</td><td>${Utils.escHtml(x.cashier_name || '—')}</td><td>${Utils.formatDateTime(x.created_at)}</td></tr>`).join('')}</table></div>`
          : '<p class="muted">No purchases yet</p>'}
        ${ledger.length ? `<h4 style="margin-top:16px">Credit Ledger</h4>
          <div class="table-wrap"><table style="width:100%"><tr><th>Date</th><th>Type</th><th>Amount</th><th>Notes</th></tr>
          ${ledger.map(l => `<tr><td>${Utils.formatDateTime(l.created_at)}</td><td>${Utils.escHtml(l.type || '—')}</td><td>${Utils.formatMoney(l.amount, currency)}</td><td>${Utils.escHtml(l.notes || '')}</td></tr>`).join('')}
          </table></div>` : ''}
        ${loyalty.length ? `<h4 style="margin-top:16px">Loyalty Points History</h4>
          <div class="table-wrap"><table style="width:100%"><tr><th>Date</th><th>Type</th><th>Points</th><th>Notes</th></tr>
          ${loyalty.map(l => `<tr><td>${Utils.formatDateTime(l.created_at)}</td><td>${Utils.escHtml(l.type || '—')}</td><td>${l.points > 0 ? '+' : ''}${l.points}</td><td>${Utils.escHtml(l.notes || '')}</td></tr>`).join('')}
          </table></div>` : ''}`,
        '<button class="btn btn-ghost" id="close-hist">Close</button>');
      document.getElementById('close-hist')?.addEventListener('click', Utils.hideModal);
    } catch (err) {
      Utils.toast(err.message || 'Could not load customer history', 'error');
    }
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
        <div class="field"><label>Phone</label><input id="cu-phone" type="tel" value="${Utils.escHtml(c?.phone || '')}"></div>
        <div class="field"><label>Email</label><input id="cu-email" type="email" value="${Utils.escHtml(c?.email || '')}"></div>
        <div class="field"><label>Birthday</label><input id="cu-birthday" type="date" value="${Utils.escHtml((c?.birthday || '').slice(0, 10))}"></div>
        <div class="field"><label>Balance owed (${currency})</label><input type="number" id="cu-balance" step="0.01" value="${c?.balance ?? 0}"></div>
        <div class="field"><label>Credit Limit (${currency})</label><input type="number" id="cu-credit-limit" step="0.01" min="0" placeholder="Use shop default" value="${c?.credit_limit ?? ''}"></div>
        <div class="field full"><label><input type="checkbox" id="cu-on-account" ${c?.allow_on_account ? 'checked' : ''}> Approved for On Account purchases</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-vip" ${c?.is_vip ? 'checked' : ''}> VIP customer</label></div>
        <div class="field full"><label>Address</label><input id="cu-address" value="${Utils.escHtml(c?.address || '')}"></div>
        <div class="field full"><label>Notes</label><textarea id="cu-notes" rows="2" placeholder="Internal notes">${Utils.escHtml(c?.notes || '')}</textarea></div>
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
      const name = document.getElementById('cu-name')?.value.trim();
      if (!name) return Utils.toast('Name is required', 'error');
      const limitVal = document.getElementById('cu-credit-limit')?.value;
      const r = await API.saveCustomer({
        id: c?.id,
        name,
        phone: document.getElementById('cu-phone')?.value.trim(),
        email: document.getElementById('cu-email')?.value.trim(),
        address: document.getElementById('cu-address')?.value.trim(),
        birthday: document.getElementById('cu-birthday')?.value || null,
        notes: document.getElementById('cu-notes')?.value.trim(),
        balance: parseFloat(document.getElementById('cu-balance')?.value) || 0,
        allow_on_account: document.getElementById('cu-on-account')?.checked,
        is_vip: document.getElementById('cu-vip')?.checked,
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
