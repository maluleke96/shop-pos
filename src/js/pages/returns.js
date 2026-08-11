const ReturnsPage = {
  tab: 'refunds',
  from: null,
  to: null,

  async render(el, app) {
    this.app = app;
    this.from = this.from || Utils.daysAgo(30);
    this.to = this.to || Utils.today();
    const currency = app.settings?.currency || 'R';

    el.innerHTML = `
      <div class="page-toolbar">
        <h3>Returns & Voids</h3>
        ${this.tab === 'refunds' ? '<button class="btn btn-primary" id="new-return">+ Process Return</button>' : ''}
      </div>
      <div class="admin-tabs" id="ret-tabs">
        <button type="button" class="admin-tab ${this.tab === 'refunds' ? 'active' : ''}" data-rtab="refunds">Refunds</button>
        <button type="button" class="admin-tab ${this.tab === 'voided' ? 'active' : ''}" data-rtab="voided">Voided</button>
      </div>
      <div class="card" style="margin-top:12px"><div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:12px">
          <div class="field" style="margin:0"><label>From</label><input type="date" id="ret-from" value="${this.from}"></div>
          <div class="field" style="margin:0"><label>To</label><input type="date" id="ret-to" value="${this.to}"></div>
          <button class="btn btn-primary btn-sm" id="ret-filter">Filter</button>
          <button class="btn btn-ghost btn-sm" id="ret-pdf">📄 PDF</button>
          <button class="btn btn-ghost btn-sm" id="ret-print">🖨️ Print</button>
        </div>
        <div id="ret-table-host">${Utils.pageSkeleton(4)}</div>
      </div></div>`;

    el.querySelector('#ret-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rtab]');
      if (!btn) return;
      this.tab = btn.dataset.rtab;
      this.render(el, app);
    });
    document.getElementById('new-return')?.addEventListener('click', () => this.showReturnForm());
    document.getElementById('ret-filter')?.addEventListener('click', () => {
      this.from = document.getElementById('ret-from').value || this.from;
      this.to = document.getElementById('ret-to').value || this.to;
      this.loadTable();
    });
    document.getElementById('ret-pdf')?.addEventListener('click', () => this.exportReport('pdf'));
    document.getElementById('ret-print')?.addEventListener('click', () => this.exportReport('print'));

    await this.loadTable();
  },

  async loadTable() {
    const host = document.getElementById('ret-table-host');
    if (!host) return;
    const currency = this.app.settings?.currency || 'R';
    if (this.tab === 'voided') {
      const [voidedRes, voidRes] = await Promise.all([
        API.getSalesList({ from: this.from, to: this.to, status: 'voided', limit: 500 }),
        API.getSalesList({ from: this.from, to: this.to, status: 'void', limit: 500 })
      ]);
      const byId = new Map();
      for (const r of [...(voidedRes.data || []), ...(voidRes.data || [])]) byId.set(r.id, r);
      const rows = [...byId.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      this._rows = rows;
      this._headers = ['Date', 'Receipt', 'Total', 'Reason', 'Cashier', 'Items'];
      this._exportRows = rows.map(r => [
        Utils.formatDateTime(r.created_at),
        r.receipt_number || '—',
        Utils.formatMoney(r.total, currency),
        r.void_reason || '—',
        r.cashier_name || '—',
        r.item_summary || '—'
      ]);
      host.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Receipt</th><th>Total</th><th>Reason</th><th>Cashier</th><th>Items</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${Utils.formatDateTime(r.created_at)}</td>
          <td>${r.receipt_number || '—'}</td>
          <td>${Utils.formatMoney(r.total, currency)}</td>
          <td>${r.void_reason || '—'}</td>
          <td>${r.cashier_name || '—'}</td>
          <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r.item_summary || '').replace(/"/g, '&quot;')}">${r.item_summary || '—'}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No voided sales in this date range</td></tr>'}
      </tbody></table></div>`;
      return;
    }

    const res = await API.getReturns({ from: this.from, to: this.to });
    const rows = res.data || [];
    this._rows = rows;
    this._headers = ['Date', 'Return #', 'Receipt', 'Type', 'Reason', 'Refund', 'By'];
    this._exportRows = rows.map(r => [
      Utils.formatDateTime(r.created_at),
      r.return_number || '—',
      r.receipt_number || '—',
      r.return_type || '—',
      r.reason || '—',
      Utils.formatMoney(r.total_refund, currency),
      r.user_name || '—'
    ]);
    host.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Return #</th><th>Receipt</th><th>Type</th><th>Reason</th><th>Refund</th><th>By</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${Utils.formatDateTime(r.created_at)}</td>
        <td>${r.return_number || '—'}</td>
        <td>${r.receipt_number || '—'}</td>
        <td>${r.return_type}</td>
        <td>${r.reason || '—'}</td>
        <td>${Utils.formatMoney(r.total_refund, currency)}</td>
        <td>${r.user_name || '—'}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No refunds in this date range</td></tr>'}
    </tbody></table></div>`;
  },

  async exportReport(mode) {
    const title = this.tab === 'voided'
      ? `Voided Sales ${this.from} – ${this.to}`
      : `Refunds ${this.from} – ${this.to}`;
    const headers = this._headers || [];
    const rows = this._exportRows || [];
    const company = { ...Utils.companyInfo(this.app.settings), dateRange: `${this.from} to ${this.to}` };
    if (mode === 'pdf') {
      await Export.toPDF(
        `${this.tab === 'voided' ? 'voided' : 'refunds'}-${this.from}-${this.to}.pdf`,
        title,
        headers,
        rows.map(r => r.map(String)),
        company
      );
      Utils.toast('PDF ready', 'success');
    } else {
      Export.print(title, headers, rows.map(r => r.map(String)), company);
    }
  },

  showReturnForm(prefillReceipt = '', app = null) {
    if (app) this.app = app;
    if (!this.app && window.App) this.app = window.App;
    if (!this.app?.user) {
      Utils.toast('Please open Returns from the menu, then try Refund again', 'error');
      return;
    }
    this.tab = 'refunds';
    const reasonOpts = Utils.returnReasons.map(r => `<option value="${r}">${r}</option>`).join('');
    Utils.showModal('Process Return', `
      <div class="field"><label>Receipt Number</label><input id="ret-receipt" placeholder="RCP-..."><button class="btn btn-sm btn-ghost" id="ret-lookup" style="margin-top:8px">Look Up</button></div>
      <div id="ret-sale-info"></div>
      <div class="field"><label>Return Type</label><select id="ret-type">
        <option value="refund">Refund</option>
        <option value="exchange">Exchange</option>
        <option value="replace">Replace</option>
        <option value="partial">Partial Return</option>
      </select></div>
      <div class="field"><label>Reason</label>
        <select id="ret-reason">${reasonOpts}<option value="custom">Other (type below)</option></select>
        <input id="ret-reason-custom" placeholder="Custom reason" style="margin-top:8px;display:none">
      </div>
      <div class="field"><label>Refund Method</label>
        <select id="ret-refund-method"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="store_credit">Store Credit</option></select>
      </div>
      <div class="field"><label>Return item to stock?</label>
        <select id="ret-to-stock"><option value="yes">Yes</option><option value="no">No</option></select>
      </div>
      <div class="field" id="ret-stock-reason-wrap" style="display:none"><label>If not to stock, reason</label>
        <select id="ret-stock-reason"><option value="Damaged">Damaged</option><option value="Expired">Expired</option><option value="Opened">Opened</option><option value="Destroyed">Destroyed</option><option value="Supplier Return">Supplier Return</option></select>
      </div>
      <div id="ret-exchange-note" style="display:none">
        <div class="field"><label>Exchange for (new product)</label><select id="ret-new-product"><option value="">— Select product —</option></select></div>
        <div class="field"><label>Price difference (+ customer pays, − refund)</label><input type="number" id="ret-price-diff" step="0.01" value="0"></div>
        <div class="field"><label>Exchange notes</label><textarea id="ret-exchange" rows="2"></textarea></div>
      </div>
      <div class="field" id="ret-approval-wrap" style="display:none"><label>Refund Authorization Code *</label><input type="password" id="ret-mgr-pin" maxlength="6" placeholder="Daily refund code from admin/manager"></div>
      <div id="ret-items"></div>`,
      '<button class="btn btn-primary" id="save-ret">Process Return</button>');

    if (this.app.user?.role === 'cashier') {
      setTimeout(() => { document.getElementById('ret-approval-wrap').style.display = 'block'; }, 0);
    }

    if (prefillReceipt) {
      setTimeout(async () => {
        const input = document.getElementById('ret-receipt');
        if (input) {
          input.value = prefillReceipt;
          document.getElementById('ret-lookup')?.click();
        }
      }, 50);
    }

    document.getElementById('ret-reason').addEventListener('change', (e) => {
      document.getElementById('ret-reason-custom').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
    document.getElementById('ret-to-stock').addEventListener('change', (e) => {
      document.getElementById('ret-stock-reason-wrap').style.display = e.target.value === 'no' ? 'block' : 'none';
    });
    document.getElementById('ret-type').addEventListener('change', async (e) => {
      document.getElementById('ret-exchange-note').style.display = e.target.value === 'exchange' ? 'block' : 'none';
      if (e.target.value === 'exchange') {
        const sel = document.getElementById('ret-new-product');
        if (sel.options.length <= 1) {
          const res = await API.getProducts();
          (res.data || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = `${p.name} (${Utils.formatMoney(p.selling_price, this.app.settings?.currency)})`;
            opt.dataset.name = p.name; opt.dataset.price = p.selling_price;
            sel.appendChild(opt);
          });
        }
      }
    });

    const checkApproval = () => {
      const needs = this.app.user?.role === 'cashier';
      document.getElementById('ret-approval-wrap').style.display = needs ? 'block' : 'none';
      return needs;
    };

    let sale = null;
    document.getElementById('ret-lookup').addEventListener('click', async () => {
      const num = document.getElementById('ret-receipt').value.trim();
      const res = await API.getSaleByReceipt(num);
      sale = res.data;
      if (!sale) return Utils.toast('Receipt not found', 'error');
      if (sale.status === 'voided' || sale.status === 'void') {
        return Utils.toast('Cannot refund a voided sale', 'error');
      }
      document.getElementById('ret-sale-info').innerHTML = `<p>Found: ${sale.receipt_number} — ${Utils.formatMoney(sale.total, this.app.settings?.currency)} — ${Utils.formatDateTime(sale.created_at)}${sale.customer_name ? ` — ${sale.customer_name}` : ''}</p>`;
      document.getElementById('ret-items').innerHTML = (sale.items || []).map((item, i) => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0">
          <input type="checkbox" class="ret-item-check" data-idx="${i}" checked>
          ${item.product_name} × ${item.quantity} — ${Utils.formatMoney(item.total, this.app.settings?.currency)}
          <input type="number" class="ret-item-qty" data-idx="${i}" value="${item.quantity}" min="0.01" max="${item.quantity}" step="0.01" style="width:70px;margin-left:auto">
        </label>`).join('') || '<p class="muted">No line items</p>';
      document.querySelectorAll('.ret-item-check, .ret-item-qty').forEach(el => el.addEventListener('change', () => checkApproval()));
      checkApproval();
    });

    document.getElementById('save-ret').addEventListener('click', async () => {
      if (!sale) return Utils.toast('Look up a receipt first', 'error');
      const reasonSel = document.getElementById('ret-reason').value;
      const reason = reasonSel === 'custom' ? document.getElementById('ret-reason-custom').value.trim() : reasonSel;
      if (!reason) return Utils.toast('Select or enter a reason', 'error');
      const returnToStock = document.getElementById('ret-to-stock').value === 'yes';
      const items = sale.items.filter((_, i) => document.querySelector(`.ret-item-check[data-idx="${i}"]`)?.checked)
        .map(item => {
          const idx = sale.items.indexOf(item);
          const qty = parseFloat(document.querySelector(`.ret-item-qty[data-idx="${idx}"]`)?.value) || item.quantity;
          const ratio = qty / item.quantity;
          return {
            sale_item_id: item.id,
            product_id: item.product_id,
            combo_id: item.combo_id || null,
            product_name: item.product_name,
            quantity: qty,
            unit_price: item.unit_price,
            total: item.total * ratio
          };
        });
      if (!items.length) return Utils.toast('Select at least one item', 'error');
      const totalRefund = items.reduce((s, i) => s + i.total, 0);
      const needsApproval = checkApproval();
      let approvedBy = null;
      let approvedByName = null;
      let supervisorCode = null;
      if (needsApproval) {
        supervisorCode = document.getElementById('ret-mgr-pin').value.trim();
        if (!supervisorCode) return Utils.toast('Supervisor code required', 'error');
        let pinRes = await API.verifySupervisorCode(supervisorCode, 'refund');
        if (!pinRes.success) pinRes = await API.verifySupervisorCode(supervisorCode, 'void');
        if (!pinRes.success) return Utils.toast(pinRes.error || 'Invalid refund authorization code', 'error');
        if (pinRes.data?.user) {
          approvedBy = pinRes.data.user.id;
          approvedByName = pinRes.data.user.full_name;
        } else {
          approvedByName = 'Supervisor (daily code)';
        }
      }
      const returnType = document.getElementById('ret-type').value;
      let fullReason = reason;
      let exchange = null;
      if (returnType === 'exchange') {
        const sel = document.getElementById('ret-new-product');
        const opt = sel.selectedOptions[0];
        if (!opt?.value) return Utils.toast('Select exchange product', 'error');
        const orig = items[0];
        exchange = {
          original_product_id: orig?.product_id, original_product_name: orig?.product_name,
          new_product_id: parseInt(opt.value, 10), new_product_name: opt.dataset.name,
          price_difference: parseFloat(document.getElementById('ret-price-diff').value) || 0,
          notes: document.getElementById('ret-exchange').value.trim()
        };
        fullReason += ` | Exchange for ${opt.dataset.name}`;
      }
      const r = await API.processReturn({
        sale_id: sale.id, receipt_number: sale.receipt_number, customer_id: sale.customer_id,
        return_type: returnType, reason: fullReason, total_refund: totalRefund,
        return_to_stock: returnToStock,
        stock_reason: returnToStock ? null : document.getElementById('ret-stock-reason').value,
        refund_method: document.getElementById('ret-refund-method').value,
        approved_by: approvedBy, approved_by_name: approvedByName,
        supervisor_code: supervisorCode,
        exchange, items
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Return failed', 'error');
      Utils.hideModal();
      Utils.toast('Refund processed — see Refunds tab', 'success');
      this.tab = 'refunds';
      const page = document.getElementById('page-content');
      if (page && this.app) this.render(page, this.app);
    });
  }
};

window.ReturnsPage = ReturnsPage;
