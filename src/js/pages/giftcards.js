const GiftCardsPage = {
  customers: [],
  from: null,
  to: null,

  canManage(user, createdBy) {
    return user?.role === 'manager' || user?.role === 'owner' || AdminOverride.canModify(user, createdBy);
  },

  canApprove(user) {
    return ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(user?.role);
  },

  statusTag(card) {
    const status = card.display_status || card.status;
    const cls = {
      active: 'tag-ok', used: 'tag-warn', redeemed: 'tag-warn', expired: 'tag-warn',
      cancelled: 'tag-low', pending: 'tag-warn', rejected: 'tag-low'
    }[status] || '';
    const label = {
      active: 'Active', used: 'Used', redeemed: 'Used', expired: 'Expired',
      cancelled: 'Cancelled', pending: 'Pending approval', rejected: 'Rejected'
    }[status] || status;
    return `<span class="tag ${cls}">${label}</span>`;
  },

  async render(el, app) {
    this.app = app;
    this.from = this.from || Utils.daysAgo(90);
    this.to = this.to || Utils.today();
    const currency = app.settings?.currency || 'R';
    const [res, custRes, settingsRes] = await Promise.all([
      API.getGiftCards({ from: this.from, to: this.to, limit: 500 }),
      API.getCustomers({}),
      API.getGiftCardSettings(app.user).catch(() => ({ success: true, data: { auto_approve: true } }))
    ]);
    const cards = res.data || [];
    this.customers = custRes.data || [];
    const settings = settingsRes.data || { auto_approve: true };
    const canApprove = this.canApprove(app.user);

    el.innerHTML = `<div class="page-toolbar"><h3>Gift Cards</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="search" id="gc-check" placeholder="Check balance by code…">
        <button class="btn btn-ghost" id="gc-check-btn">Check</button>
        <button class="btn btn-primary" id="new-gc">+ Sell Gift Card</button>
      </div></div>
      <div class="card" style="margin-bottom:12px"><div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
          <div class="field" style="margin:0"><label>From</label><input type="date" id="gc-from" value="${this.from}"></div>
          <div class="field" style="margin:0"><label>To</label><input type="date" id="gc-to" value="${this.to}"></div>
          <button class="btn btn-primary btn-sm" id="gc-filter">Filter</button>
          <button class="btn btn-ghost btn-sm" id="gc-pdf">📄 PDF</button>
          <button class="btn btn-ghost btn-sm" id="gc-print">🖨️ Print</button>
          ${['owner', 'manager'].includes(app.user?.role) ? `
          <label style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px">
            <input type="checkbox" id="gc-auto-approve" ${settings.auto_approve !== false ? 'checked' : ''}>
            Auto-approve new gift cards
          </label>` : ''}
        </div>
      </div></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr>
          <th>Code</th><th>Customer</th><th>Balance</th><th>Initial</th><th>Phone</th>
          <th>Created by</th><th>Created</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>${cards.map(c => `<tr>
          <td><code>${Utils.escHtml(c.code)}</code></td>
          <td>${Utils.escHtml(c.customer_name || '—')}</td>
          <td>${Utils.formatMoney(c.balance, currency)}</td>
          <td>${Utils.formatMoney(c.initial_balance, currency)}</td>
          <td>${Utils.escHtml(c.customer_phone || '—')}</td>
          <td>${Utils.escHtml(c.created_by_name || '—')}</td>
          <td>${Utils.formatDateTime(c.created_at)}</td>
          <td>${this.statusTag(c)}</td>
          <td class="actions" style="white-space:nowrap">
            ${canApprove && (c.approval_status || 'approved') === 'pending' ? `
              <button class="btn btn-sm btn-success gc-approve" data-id="${c.id}">Approve</button>
              <button class="btn btn-sm btn-danger gc-reject" data-id="${c.id}">Reject</button>` : ''}
            ${c.customer_phone ? `<button class="btn btn-sm btn-ghost gc-wa" data-id="${c.id}">WhatsApp</button>` : ''}
            ${this.canManage(app.user, c.created_by) ? `<button class="btn btn-sm btn-ghost edit-gc" data-id="${c.id}">Edit</button>` : ''}
            ${this.canManage(app.user, c.created_by) ? `<button class="btn btn-sm btn-danger del-gc" data-id="${c.id}">Delete</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="9" class="muted">No gift cards in this date range</td></tr>'}
        </tbody></table></div></div>`;

    document.getElementById('gc-filter')?.addEventListener('click', () => {
      this.from = document.getElementById('gc-from').value || this.from;
      this.to = document.getElementById('gc-to').value || this.to;
      this.render(el, app);
    });
    document.getElementById('gc-auto-approve')?.addEventListener('change', async (e) => {
      const r = await API.saveGiftCardSettings({ auto_approve: e.target.checked }, app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save setting', 'error');
      Utils.toast(e.target.checked ? 'New gift cards auto-approve' : 'New gift cards need approval', 'success');
    });
    const exportReport = async (mode) => {
      const headers = ['Code', 'Customer', 'Balance', 'Initial', 'Phone', 'Created by', 'Created', 'Status'];
      const rows = cards.map(c => [
        c.code, c.customer_name || '—', Utils.formatMoney(c.balance, currency),
        Utils.formatMoney(c.initial_balance, currency), c.customer_phone || '—',
        c.created_by_name || '—', Utils.formatDateTime(c.created_at), c.display_status || c.status
      ]);
      const title = `Gift Cards ${this.from} – ${this.to}`;
      const company = { ...Utils.companyInfo(app.settings), dateRange: `${this.from} to ${this.to}` };
      if (mode === 'pdf') {
        await Export.toPDF(`gift-cards-${this.from}-${this.to}.pdf`, title, headers, rows, company);
        Utils.toast('PDF ready', 'success');
      } else Export.print(title, headers, rows, company);
    };
    document.getElementById('gc-pdf')?.addEventListener('click', () => exportReport('pdf'));
    document.getElementById('gc-print')?.addEventListener('click', () => exportReport('print'));

    document.getElementById('new-gc').addEventListener('click', () => this.showCreateForm(el, app, settings));
    el.querySelectorAll('.gc-approve').forEach(b => b.addEventListener('click', async () => {
      const r = await API.approveGiftCard(parseInt(b.dataset.id, 10), app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Gift card approved', 'success');
      this.render(el, app);
    }));
    el.querySelectorAll('.gc-reject').forEach(b => b.addEventListener('click', async () => {
      const notes = prompt('Rejection reason:') || '';
      if (!notes.trim()) return Utils.toast('Reason required', 'error');
      const r = await API.rejectGiftCard(parseInt(b.dataset.id, 10), notes, app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Gift card rejected', 'success');
      this.render(el, app);
    }));
    el.querySelectorAll('.gc-wa').forEach(b => b.addEventListener('click', async () => {
      const card = cards.find(c => c.id == b.dataset.id);
      if (!card?.customer_phone) return;
      await this.sendGiftWhatsApp(card, currency, app);
    }));
    document.querySelectorAll('.edit-gc').forEach(b => b.addEventListener('click', () => {
      const card = cards.find(c => c.id == b.dataset.id);
      this.showEditForm(card, el, app);
    }));
    document.querySelectorAll('.del-gc').forEach(b => b.addEventListener('click', async () => {
      const card = cards.find(c => c.id == b.dataset.id);
      if (!card) return;
      let actor = app.user;
      if (AdminOverride.needsOverrideReason(app.user, card.created_by)) {
        const guard = await AdminOverride.guardAction(app.user, 'Delete Gift Card', card.created_by, card.created_by_name);
        if (!guard.ok) return;
        actor = AdminOverride.actorWithOverride(app.user, guard.override_reason);
      }
      if (!confirm(`Delete gift card ${card.code}?`)) return;
      const r = await API.deleteGiftCard(parseInt(b.dataset.id, 10), actor);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Gift card deleted', 'success');
      this.render(el, app);
    }));

    document.getElementById('gc-check-btn').addEventListener('click', async () => {
      const code = document.getElementById('gc-check').value.trim();
      if (!code) return;
      const r = await API.checkGiftCard(code);
      if (!r.success) return Utils.toast(r.error, 'error');
      const status = r.data.display_status || r.data.status;
      Utils.toast(`Balance: ${Utils.formatMoney(r.data.balance, currency)} (${status})`, 'success');
    });
  },

  async sendGiftWhatsApp(card, currency, app) {
    const phone = card.customer_phone;
    const shop = app.settings?.shop_name || 'our store';
    const msg = `🎁 Gift Card from ${shop}\nCode: ${card.code}\nBalance: ${Utils.formatMoney(card.balance, currency)}\n${card.expires_at ? `Expires: ${card.expires_at}` : 'No expiry'}\n${(card.approval_status || 'approved') === 'pending' ? '(Pending activation)' : 'Ready to use!'}`;
    const r = await API.sendWhatsAppMessage({
      phone,
      recipient_name: card.customer_name || 'Customer',
      message_type: 'giftcard',
      body: msg
    }, app.user);
    if (!r.success) return Utils.toast(r.error || 'WhatsApp failed', 'error');
    window.open(r.data.url, '_blank');
    Utils.toast('WhatsApp opened for gift recipient', 'success');
  },

  async showCreateForm(el, app, settings) {
    const currency = app.settings?.currency || 'R';
    Utils.showModal('Sell Gift Card', `
      <div class="field"><label>Amount *</label><input type="number" id="gc-amount" step="0.01" min="1"></div>
      <div class="field"><label>Expiry date (optional)</label><input type="date" id="gc-expiry"></div>
      ${Utils.customerPickerHTML('gc')}
      <div class="field"><label><input type="checkbox" id="gc-send-wa" checked> Send via WhatsApp to recipient</label></div>
      <p class="muted" style="margin:0">${settings?.auto_approve === false
        ? 'This gift card will need admin/manager approval before use.'
        : 'Gift cards are auto-approved (change in Gift Cards settings).'}</p>`,
      '<button class="btn btn-primary" id="save-gc">Create Gift Card</button>');

    const picker = Utils.bindCustomerPicker('gc', this.customers);
    document.getElementById('save-gc').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('gc-amount').value);
      const customer = picker.getSelected();
      if (!amount || amount <= 0) return Utils.toast('Enter a valid amount', 'error');
      const r = await API.createGiftCard({
        amount,
        customer_id: customer?.id || null,
        customer_phone: customer?.phone || null,
        expires_at: document.getElementById('gc-expiry')?.value || null,
        notes: customer ? `Sold to ${customer.name}` : null
      }, app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      const sendWa = document.getElementById('gc-send-wa')?.checked && (customer?.phone || r.data.customer_phone);
      if (sendWa) {
        await this.sendGiftWhatsApp({
          ...r.data,
          customer_name: customer?.name,
          customer_phone: customer?.phone || r.data.customer_phone,
          balance: amount,
          expires_at: document.getElementById('gc-expiry')?.value || null
        }, currency, app);
      }
      Utils.toast(
        r.data.approval_status === 'pending'
          ? `Gift card ${r.data.code} created — pending approval`
          : `Gift card ${r.data.code} created`,
        'success'
      );
      this.render(el, app);
    });
  },

  showEditForm(card, el, app) {
    if (!card) return;
    Utils.showModal('Edit Gift Card', `
      <div class="field"><label>Balance</label><input type="number" id="gc-bal" step="0.01" value="${card.balance}"></div>
      <div class="field"><label>Status</label>
        <select id="gc-status">${['active', 'cancelled', 'redeemed', 'expired'].map(s =>
          `<option value="${s}" ${card.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Phone</label><input id="gc-phone" value="${Utils.escHtml(card.customer_phone || '')}"></div>
      <div class="field"><label>Expires</label><input type="date" id="gc-exp" value="${(card.expires_at || '').slice(0, 10)}"></div>`,
      '<button class="btn btn-primary" id="gc-save-edit">Save</button>');
    document.getElementById('gc-save-edit').addEventListener('click', async () => {
      let actor = app.user;
      if (AdminOverride.needsOverrideReason(app.user, card.created_by)) {
        const guard = await AdminOverride.guardAction(app.user, 'Edit Gift Card', card.created_by, card.created_by_name);
        if (!guard.ok) return;
        actor = AdminOverride.actorWithOverride(app.user, guard.override_reason);
      }
      const r = await API.updateGiftCard(card.id, {
        balance: parseFloat(document.getElementById('gc-bal').value),
        status: document.getElementById('gc-status').value,
        customer_phone: document.getElementById('gc-phone').value.trim() || null,
        expires_at: document.getElementById('gc-exp').value || null
      }, actor);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Updated', 'success');
      this.render(el, app);
    });
  }
};
window.GiftCardsPage = GiftCardsPage;
