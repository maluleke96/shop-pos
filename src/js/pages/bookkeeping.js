const BookkeepingPage = {
  tab: 'dashboard',
  from: null,
  to: null,
  branches: [],
  categories: { expense: [], income: [] },
  unlocked: false,

  branchFilterId() {
    if (this.app?.user?.role !== 'owner') return this.app.user?.branch_id || null;
    const v = document.getElementById('bk-branch-filter')?.value;
    return v && v !== 'all' ? v : null;
  },

  async render(el, app) {
    this.app = app;
    this.el = el;
    const sec = app.settings?.security_settings || {};
    if (sec.bookkeeping_password_configured && !this.unlocked) {
      return this.renderPasswordGate(el);
    }
    this.from = this.from || Utils.monthStart();
    this.to = this.to || Utils.today();
    try {
      const catRes = await API.getBookkeepingCategories();
      if (!catRes.success) throw new Error(catRes.error || 'API error');
      this.categories = catRes.data || { expense: [], income: [] };
    } catch (err) {
      el.innerHTML = `<div class="card" style="padding:20px"><p style="color:var(--danger)">Could not load Bookkeeping: ${err.message || 'Unknown error'}</p>
        <p class="muted">Restart the app to pick up the latest update, then try again.</p></div>`;
      return;
    }

    try {
      const brRes = await API.getBranches();
      this.branches = brRes.data || [];
    } catch (_) {
      this.branches = [];
    }
    const branchFilter = this.app.user?.role === 'owner' && this.branches.length
      ? `<select id="bk-branch-filter" style="margin-left:8px;padding:6px 10px;border-radius:8px;border:1.5px solid var(--border)">
          <option value="all">All branches</option>
          ${this.branches.map((b) => `<option value="${b.id}">${Utils.escHtml(b.name)}</option>`).join('')}
        </select>`
      : (this.app.user?.branch_id
        ? `<span class="muted" style="margin-left:8px">Branch: <strong>${Utils.escHtml(this.branches.find((b) => b.id === this.app.user.branch_id)?.name || 'Your branch')}</strong></span>`
        : '');

    const tabs = [
      ['dashboard', 'Dashboard'], ['ledger', 'Auto Ledger'], ['income', 'Income'], ['expenses', 'Expenses'],
      ['cashbook', 'Cash Book'], ['bankbook', 'Bank Book'], ['payroll', 'Payroll'], ['tax', 'Tax'],
      ['donations', 'Donations'], ['reports', 'Reports'], ['performance', 'Performance'], ['documents', 'Documents'],
      ['audit', 'Audit Trail'], ['budgets', 'Budgets'], ['alerts', 'Alerts'], ['settings', 'Settings']
    ];

    el.innerHTML = `<div class="page-toolbar"><h3>Bookkeeping & Financial Management</h3>
      ${branchFilter}
      <button class="btn btn-sm btn-primary" id="bk-sync">Sync Ledger</button></div>
      ${Utils.extendedDateFilterHTML('bk-date-filter', this.from, this.to)}
      <div class="form-tabs" id="bk-tabs" style="flex-wrap:wrap;margin:12px 0">${tabs.map(([id, label]) =>
        `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div id="bk-content"><p class="muted">Loading…</p></div>`;

    Utils.bindDateFilter('bk-date-filter', (from, to) => {
      this.from = from; this.to = to;
      this.renderTab();
    });
    el.querySelector('#bk-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this.tab = btn.dataset.tab;
      el.querySelectorAll('#bk-tabs .form-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === this.tab));
      this.renderTab();
    });
    document.getElementById('bk-sync').addEventListener('click', async () => {
      await API.syncBookkeeping(this.from, this.to);
      Utils.toast('Ledger synced from sales, expenses, payroll & more', 'success');
      this.renderTab();
    });
    document.getElementById('bk-branch-filter')?.addEventListener('change', () => this.renderTab());
    await this.renderTab();
  },

  renderPasswordGate(el) {
    el.innerHTML = `<div class="card" style="max-width:420px;margin:60px auto;padding:32px;text-align:center">
      <h3>Bookkeeping Access</h3>
      <p class="muted">Enter the bookkeeping password set in Admin → Security</p>
      <div class="field"><label>Password</label><input type="password" id="bk-gate-pass" autofocus></div>
      <p id="bk-gate-error" class="error-msg hidden"></p>
      <button class="btn btn-primary btn-lg" id="bk-gate-unlock" style="width:100%;margin-top:12px">Unlock Bookkeeping</button>
    </div>`;
    const tryUnlock = async () => {
      const pass = document.getElementById('bk-gate-pass').value;
      const errEl = document.getElementById('bk-gate-error');
      const r = await API.verifyBookkeepingPassword(pass);
      if (!r.success) {
        errEl.textContent = r.error || 'Incorrect password';
        errEl.classList.remove('hidden');
        return;
      }
      this.unlocked = true;
      this.render(el, this.app);
    };
    document.getElementById('bk-gate-unlock').addEventListener('click', tryUnlock);
    document.getElementById('bk-gate-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
  },

  currency() { return this.app.settings?.currency || 'R'; },

  async renderTab() {
    const content = document.getElementById('bk-content');
    if (!content) return;
    content.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const map = {
        dashboard: () => this.renderDashboard(content),
        ledger: () => this.renderLedger(content),
        income: () => this.renderIncome(content),
        expenses: () => this.renderExpenses(content),
        cashbook: () => this.renderCashBook(content),
        bankbook: () => this.renderBankBook(content),
        payroll: () => this.renderPayroll(content),
        tax: () => this.renderTax(content),
        donations: () => this.renderDonations(content),
        reports: () => this.renderReports(content),
        performance: () => this.renderPerformance(content),
        documents: () => this.renderDocuments(content),
        audit: () => this.renderAudit(content),
        budgets: () => this.renderBudgets(content),
        alerts: () => this.renderAlerts(content),
        settings: () => this.renderSettings(content)
      };
      await (map[this.tab] || map.dashboard)();
    } catch (err) {
      content.innerHTML = `<p style="color:var(--danger)">Error loading tab: ${err.message || 'Unknown error'}</p>`;
    }
  },

  statCard(label, value, sub = '') {
    return `<div class="card" style="padding:16px"><div class="muted" style="font-size:12px">${label}</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`;
  },

  exportBar(title, headers, rows, filename) {
    return `<div style="display:flex;gap:6px;margin-bottom:12px">
      <button class="btn btn-sm btn-ghost bk-export-pdf" data-title="${title}" data-file="${filename}">PDF</button>
      <button class="btn btn-sm btn-ghost bk-export-xlsx" data-title="${title}" data-file="${filename.replace('.pdf', '.xlsx')}">Excel</button>
      <button class="btn btn-sm btn-ghost bk-export-csv" data-title="${title}" data-file="${filename.replace('.pdf', '.csv')}">CSV</button>
      <button class="btn btn-sm btn-primary bk-export-print" data-title="${title}">Print</button>
    </div>`;
  },

  bindExport(container, title, headers, rows, filename) {
    const company = { ...Utils.companyInfo(this.app.settings), dateRange: `${Utils.formatDate(this.from)} — ${Utils.formatDate(this.to)}` };
    container.querySelector('.bk-export-pdf')?.addEventListener('click', () => Export.toPDF(filename, title, headers, rows.map(r => r.map(String)), company));
    container.querySelector('.bk-export-xlsx')?.addEventListener('click', () => Export.toExcel(filename.replace('.pdf', '.xlsx'), [{ name: title, data: rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))) }]));
    container.querySelector('.bk-export-csv')?.addEventListener('click', async () => {
      const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
      const csvName = filename.replace('.pdf', '.csv');
      const bytes = new TextEncoder().encode(csv);
      const r = await API.saveFile(csvName, [{ name: 'CSV', extensions: ['csv'] }], bytes);
      if (r.success) Utils.toast('CSV saved', 'success');
      else if (!r.cancelled) Utils.toast(r.error || 'CSV export failed', 'error');
    });
    container.querySelector('.bk-export-print')?.addEventListener('click', () => Export.print(title, headers, rows.map(r => r.map(String)), company));
  },

  async renderDashboard(el) {
    const branchId = this.branchFilterId();
    const res = await API.getFinancialDashboard(this.from, this.to, branchId);
    if (!res.success) {
      el.innerHTML = `<p style="color:var(--danger)">${res.error || 'Failed to load dashboard'}</p>`;
      return;
    }
    const d = res.data || {};
    const c = this.currency();
    const branchNote = d.branch_label && d.branch_label !== 'All branches'
      ? `<p class="muted" style="margin-bottom:12px">Showing: <strong>${Utils.escHtml(d.branch_label)}</strong></p>` : '';
    el.innerHTML = `${branchNote}<div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
      ${this.statCard('Total Revenue', Utils.formatMoney(d.revenue, c))}
      ${this.statCard('Total Income', Utils.formatMoney(d.totalIncome, c))}
      ${this.statCard('Total Expenses', Utils.formatMoney(d.totalExpenses, c))}
      ${this.statCard('Gross Profit', Utils.formatMoney(d.grossProfit, c), `${(d.grossMargin || 0).toFixed(1)}% margin`)}
      ${this.statCard('Net Profit', Utils.formatMoney(d.netProfit, c), `${(d.netMargin || 0).toFixed(1)}% margin`)}
      ${this.statCard('Cash Balance', Utils.formatMoney(d.cashBalance, c))}
      ${this.statCard('Bank Balance', Utils.formatMoney(d.bankBalance, c))}
      ${this.statCard('Outstanding Payments', Utils.formatMoney(d.outstandingPayments, c))}
      ${this.statCard('Accounts Receivable', Utils.formatMoney(d.accountsReceivable, c))}
      ${this.statCard('Accounts Payable', Utils.formatMoney(d.accountsPayable, c))}
      ${this.statCard('Inventory Value', Utils.formatMoney(d.inventoryValue, c))}
    </div>
    <div class="card" style="margin-top:16px"><div class="card-body">
      <p class="muted">Automatic bookkeeping records sales, refunds, expenses, purchases, payroll, owner salary, advances, loans, damage costs, customer credit payments, and supplier payments.</p>
      <button class="btn btn-primary" id="bk-sync-now">Sync Now</button></div></div>`;
    document.getElementById('bk-sync-now')?.addEventListener('click', () => document.getElementById('bk-sync')?.click());
  },

  async renderLedger(el) {
    const q = document.getElementById('bk-ledger-q')?.value || '';
    const res = await API.searchLedger({ from: this.from, to: this.to, q });
    const rows = res.data || [];
    const c = this.currency();
    const totalIn = rows.filter(r => r.direction === 'in').reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalOut = rows.filter(r => r.direction === 'out').reduce((s, r) => s + Number(r.amount || 0), 0);
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input id="bk-ledger-q" placeholder="Search txn, category, employee…" value="${q}" style="flex:1;min-width:200px">
      <select id="bk-ledger-type"><option value="">All types</option>
        ${['sale','return','expense','purchase','payroll','owner_salary','supplier_payment','income','customer_credit','salary_advance'].map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-primary" id="bk-ledger-search">Search</button>
    </div>
    ${this.exportBar('Financial Ledger', ['Date','Txn#','Type','Category','Description','In','Out','Method'], rows.map(r => [
      r.txn_date, r.txn_number, r.txn_type, r.category || '—', r.description || '—',
      r.direction === 'in' ? Utils.formatMoney(r.amount, c) : '—',
      r.direction === 'out' ? Utils.formatMoney(r.amount, c) : '—', r.payment_method || '—'
    ]), `ledger-${this.from}.pdf`)}
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Txn#</th><th>Type</th><th>Category</th><th>Description</th><th>In</th><th>Out</th><th>Method</th><th>Auto</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.txn_date}</td><td>${r.txn_number}</td><td>${r.txn_type}</td><td>${r.category || '—'}</td>
      <td>${r.description || '—'}</td><td>${r.direction === 'in' ? Utils.formatMoney(r.amount, c) : '—'}</td>
      <td>${r.direction === 'out' ? Utils.formatMoney(r.amount, c) : '—'}</td><td>${r.payment_method || '—'}</td>
      <td>${r.is_auto ? '✓' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No transactions</td></tr>'}
    ${rows.length ? `<tfoot><tr style="font-weight:700"><td colspan="5">Totals</td>
      <td>${Utils.formatMoney(totalIn, c)}</td><td>${Utils.formatMoney(totalOut, c)}</td><td colspan="2"></td></tr></tfoot>` : ''}</tbody></table></div>`;
    const headers = ['Date','Txn#','Type','Category','Description','In','Out','Method'];
    const exportRows = rows.map(r => [r.txn_date, r.txn_number, r.txn_type, r.category || '—', r.description || '—',
      r.direction === 'in' ? r.amount : '', r.direction === 'out' ? r.amount : '', r.payment_method || '—']);
    this.bindExport(el, 'Financial Ledger', headers, exportRows, `ledger-${this.from}.pdf`);
    document.getElementById('bk-ledger-search')?.addEventListener('click', () => this.renderLedger(el));
  },

  async renderIncome(el) {
    const res = await API.getBookkeepingIncome({ from: this.from, to: this.to });
    const rows = res.data || [];
    const c = this.currency();
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    el.innerHTML = `<div style="margin-bottom:12px"><button class="btn btn-primary" id="bk-add-income">+ Add Income</button></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>Method</th><th></th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.income_date}</td><td>${r.income_type}</td><td>${r.description || '—'}</td>
      <td>${Utils.formatMoney(r.amount, c)}</td><td>${r.payment_method}</td>
      <td><button class="btn btn-sm btn-danger bk-del-income" data-id="${r.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No income entries</td></tr>'}
    ${rows.length ? `<tfoot><tr style="font-weight:700"><td colspan="3">Total</td><td>${Utils.formatMoney(total, c)}</td><td colspan="2"></td></tr></tfoot>` : ''}</tbody></table></div>`;
    document.getElementById('bk-add-income')?.addEventListener('click', () => this.showIncomeModal());
    el.querySelectorAll('.bk-del-income').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this income entry?')) return;
      await API.deleteBookkeepingIncome(parseInt(b.dataset.id), this.app.user);
      this.renderIncome(el);
    }));
  },

  showIncomeModal() {
    const types = this.categories.income || [];
    Utils.showModal('Add Income', `<div class="form-grid">
      <div class="field"><label>Type</label><select id="inc-type">${types.map(t => `<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Date</label><input type="date" id="inc-date" value="${Utils.today()}"></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="inc-amt"></div>
      <div class="field"><label>Payment Method</label><select id="inc-method">${Utils.paymentTypes.map(p => `<option value="${p}">${Utils.paymentLabels[p]}</option>`).join('')}</select></div>
      <div class="field"><label>Account</label><select id="inc-acct"><option value="cash">Cash</option><option value="bank">Bank</option></select></div>
      <div class="field full"><label>Description</label><input id="inc-desc"></div>
    </div>`, '<button class="btn btn-primary" id="inc-save">Save</button>');
    document.getElementById('inc-save').addEventListener('click', async () => {
      await API.saveBookkeepingIncome({
        income_type: document.getElementById('inc-type').value,
        income_date: document.getElementById('inc-date').value,
        amount: parseFloat(document.getElementById('inc-amt').value),
        payment_method: document.getElementById('inc-method').value,
        account_type: document.getElementById('inc-acct').value,
        description: document.getElementById('inc-desc').value.trim()
      }, this.app.user);
      Utils.hideModal();
      Utils.toast('Income recorded', 'success');
      this.renderTab();
    });
  },

  async renderExpenses(el) {
    const res = await API.getExpenses({
      from: this.from,
      to: this.to,
      actor: this.app.user,
      branch_id: this.branchFilterId()
    });
    const rows = res.data || [];
    const c = this.currency();
    const cats = this.categories.expense || Utils.expenseCategories;
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    el.innerHTML = `<p class="muted">Expenses from POS are auto-synced to the ledger. Categories: ${cats.join(', ')}</p>
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>By</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.expense_date}</td><td>${r.category}</td><td>${r.description || '—'}</td>
      <td>${Utils.formatMoney(r.amount, c)}</td><td>${r.user_name || '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No expenses</td></tr>'}
    ${rows.length ? `<tfoot><tr style="font-weight:700"><td colspan="3">Total</td><td>${Utils.formatMoney(total, c)}</td><td></td></tr></tfoot>` : ''}</tbody></table></div>
    <button class="btn btn-ghost" style="margin-top:12px" onclick="App.navigate('expenses')">Manage Expenses →</button>`;
  },

  async renderCashBook(el) {
    const res = await API.getCashBook(this.from, this.to);
    const d = res.data || {};
    const c = this.currency();
    el.innerHTML = `<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${this.statCard('Opening Balance', Utils.formatMoney(d.openingBalance, c))}
      ${this.statCard('Cash In', Utils.formatMoney(d.totalIn, c))}
      ${this.statCard('Cash Out', Utils.formatMoney(d.totalOut, c))}
      ${this.statCard('Closing Balance', Utils.formatMoney(d.closingBalance, c))}
    </div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Opening</th><th>Cash In</th><th>Cash Out</th><th>Closing</th></tr></thead>
    <tbody>${(d.days || []).map(r => `<tr><td>${r.day}</td><td>${Utils.formatMoney(r.opening_balance, c)}</td>
      <td>${Utils.formatMoney(r.cash_in, c)}</td><td>${Utils.formatMoney(r.cash_out, c)}</td><td>${Utils.formatMoney(r.closing_balance, c)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No cash activity</td></tr>'}</tbody></table></div>`;
  },

  async renderBankBook(el) {
    const res = await API.getBankBook(this.from, this.to);
    const d = res.data || {};
    const c = this.currency();
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div><strong>${d.bankName || 'Bank Account'}</strong> ${d.accountNumber ? `· ${d.accountNumber}` : ''}</div>
      <button class="btn btn-primary" id="bk-add-bank">+ Bank Transaction</button></div>
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${this.statCard('Opening', Utils.formatMoney(d.openingBalance, c))}
      ${this.statCard('Deposits', Utils.formatMoney(d.deposits, c))}
      ${this.statCard('Withdrawals', Utils.formatMoney(d.withdrawals, c))}
      ${this.statCard('Closing', Utils.formatMoney(d.closingBalance, c))}
    </div>
    <p class="muted">${d.unreconciled || 0} unreconciled transaction(s)</p>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>In</th><th>Out</th><th>Reconciled</th></tr></thead>
    <tbody>${(d.transactions || []).map(t => `<tr><td>${t.txn_date}</td><td>${t.txn_type}</td><td>${t.description || '—'}</td>
      <td>${t.direction === 'in' ? Utils.formatMoney(t.amount, c) : '—'}</td>
      <td>${t.direction === 'out' ? Utils.formatMoney(t.amount, c) : '—'}</td><td>${t.reconciled ? '✓' : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No bank transactions</td></tr>'}</tbody></table></div>`;
    document.getElementById('bk-add-bank')?.addEventListener('click', () => this.showBankModal());
  },

  showBankModal() {
    Utils.showModal('Bank Transaction', `<div class="form-grid">
      <div class="field"><label>Date</label><input type="date" id="bnk-date" value="${Utils.today()}"></div>
      <div class="field"><label>Type</label><select id="bnk-type"><option>Deposit</option><option>Withdrawal</option><option>Transfer</option><option>Bank Charge</option><option>Interest</option></select></div>
      <div class="field"><label>Direction</label><select id="bnk-dir"><option value="in">In (Deposit)</option><option value="out">Out (Withdrawal)</option></select></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="bnk-amt"></div>
      <div class="field full"><label>Description</label><input id="bnk-desc"></div>
      <div class="field"><label>Bank Reference</label><input id="bnk-ref"></div>
      <div class="field"><label><input type="checkbox" id="bnk-recon"> Reconciled</label></div>
    </div>`, '<button class="btn btn-primary" id="bnk-save">Save</button>');
    document.getElementById('bnk-save').addEventListener('click', async () => {
      await API.saveBankTransaction({
        txn_date: document.getElementById('bnk-date').value,
        txn_type: document.getElementById('bnk-type').value,
        direction: document.getElementById('bnk-dir').value,
        amount: parseFloat(document.getElementById('bnk-amt').value),
        description: document.getElementById('bnk-desc').value.trim(),
        bank_reference: document.getElementById('bnk-ref').value.trim(),
        reconciled: document.getElementById('bnk-recon').checked
      }, this.app.user);
      Utils.hideModal();
      Utils.toast('Bank transaction saved', 'success');
      this.renderTab();
    });
  },

  async renderPayroll(el) {
    const res = await API.getPayrollAccounting(this.from, this.to);
    const p = res.data || {};
    const c = this.currency();
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody>
      ${[
        ['Employee Salaries (Net)', p.net], ['Basic Salaries', p.basic], ['PAYE', p.paye],
        ['UIF (Employee)', p.uif_emp], ['UIF (Employer)', p.uif_er], ['SDL', p.sdl], ['COIDA', p.coida],
        ['Salary Advances Recovered', p.advances], ['Loan Recoveries', p.loans], ['Damage Deductions', p.damage],
        ['Pension', p.pension], ['Medical Aid', p.medical], ['Owner Salary Paid', p.ownerSalary]
      ].map(([label, val]) => `<tr><td>${label}</td><td>${Utils.formatMoney(val || 0, c)}</td></tr>`).join('')}
    </tbody></table></div>`;
  },

  async renderTax(el) {
    const res = await API.getTaxSummary(this.from, this.to);
    const t = res.data || {};
    const c = this.currency();
    el.innerHTML = `<div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">
      ${this.statCard('VAT (' + (t.vatRate || 15) + '%)', Utils.formatMoney(t.vat, c), t.vatRegistered ? 'Registered' : 'Not registered')}
      ${this.statCard('PAYE', Utils.formatMoney(t.paye, c))}
      ${this.statCard('UIF', Utils.formatMoney(t.uif, c))}
      ${this.statCard('SDL', Utils.formatMoney(t.sdl, c))}
      ${this.statCard('COIDA', Utils.formatMoney(t.coida, c))}
      ${this.statCard('Taxable Sales', Utils.formatMoney(t.taxableSales, c))}
    </div>`;
  },

  async renderReports(el) {
    const reportTypes = [
      ['profit_loss', 'Profit & Loss'], ['income_statement', 'Income Statement'], ['balance_sheet', 'Balance Sheet'],
      ['cash_flow', 'Cash Flow'], ['trial_balance', 'Trial Balance'], ['general_ledger', 'General Ledger'],
      ['expense_report', 'Expense Report'], ['income_report', 'Income Report'], ['payroll_report', 'Payroll Report'],
      ['tax_report', 'Tax Report'], ['supplier_report', 'Supplier Report'], ['customer_report', 'Customer Report']
    ];
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${reportTypes.map(([id, label]) => `<button class="btn btn-ghost bk-rpt" data-type="${id}">${label}</button>`).join('')}
    </div><div id="bk-rpt-out"><p class="muted">Select a report above</p></div>`;
    el.querySelectorAll('.bk-rpt').forEach(b => b.addEventListener('click', () => this.runReport(b.dataset.type)));
  },

  async runReport(type) {
    const out = document.getElementById('bk-rpt-out');
    out.innerHTML = '<p class="muted">Loading…</p>';
    const res = await API.getFinancialReport(type, this.from, this.to);
    const data = res.data;
    const c = this.currency();
    let html = `<div class="card"><div class="card-header"><h3>${type.replace(/_/g, ' ').toUpperCase()}</h3>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-ghost" id="bk-rpt-pdf">PDF</button>
        <button class="btn btn-sm btn-primary" id="bk-rpt-print">Print</button>
      </div></div><div class="card-body">`;

    if (type === 'balance_sheet') {
      html += `<h4>Assets</h4><ul><li>Cash: ${Utils.formatMoney(data.assets?.cash, c)}</li>
        <li>Bank: ${Utils.formatMoney(data.assets?.bank, c)}</li><li>Inventory: ${Utils.formatMoney(data.assets?.inventory, c)}</li>
        <li>Receivable: ${Utils.formatMoney(data.assets?.receivable, c)}</li></ul>
        <h4>Liabilities</h4><ul><li>Payable: ${Utils.formatMoney(data.liabilities?.payable, c)}</li>
        <li>Payroll Pending: ${Utils.formatMoney(data.liabilities?.payrollPending, c)}</li></ul>`;
    } else if (type === 'cash_flow') {
      html += `<p>Cash closing: ${Utils.formatMoney(data.cash?.closingBalance, c)} · Bank closing: ${Utils.formatMoney(data.bank?.closingBalance, c)}</p>`;
    } else if (type === 'payroll_report') {
      html += `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } else if (type === 'tax_report') {
      html += `<p>VAT: ${Utils.formatMoney(data.vat, c)} · PAYE: ${Utils.formatMoney(data.paye, c)} · UIF: ${Utils.formatMoney(data.uif, c)}</p>`;
    } else if (Array.isArray(data)) {
      html += `<div class="table-wrap"><table><tbody>${data.map(r => `<tr>${Object.values(r).map(v => `<td>${typeof v === 'number' ? Utils.formatMoney(v, c) : v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else if (data?.lines) {
      html += `<div class="table-wrap"><table><thead><tr><th>Category</th><th>Direction</th><th>Total</th></tr></thead>
        <tbody>${data.lines.map(l => `<tr><td>${l.category}</td><td>${l.direction}</td><td>${Utils.formatMoney(l.total, c)}</td></tr>`).join('')}</tbody></table></div>`;
    } else if (type === 'general_ledger') {
      html += `<p>${(data || []).length} ledger entries — see Auto Ledger tab for full list.</p>`;
    } else {
      html += `<p>Net profit: ${Utils.formatMoney(data.summary?.netProfit || 0, c)}</p>`;
    }
    html += '</div></div>';
    out.innerHTML = html;
    document.getElementById('bk-rpt-pdf')?.addEventListener('click', async () => {
      await Utils.savePdfBuffer(`${type}-${this.from}.pdf`, await API.getFinancialReportPdf(type, this.from, this.to));
    });
    document.getElementById('bk-rpt-print')?.addEventListener('click', async () => {
      await Utils.printToA4(await API.getFinancialReportPdf(type, this.from, this.to), `${type}-${this.from}.pdf`);
    });
  },

  async renderPerformance(el) {
    const res = await API.getBusinessPerformance(this.from, this.to);
    const d = res.data || {};
    const c = this.currency();
    el.innerHTML = `<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${this.statCard('Revenue', Utils.formatMoney(d.revenue, c))}
      ${this.statCard('Gross Margin', (d.grossMargin || 0).toFixed(1) + '%')}
      ${this.statCard('Net Margin', (d.netMargin || 0).toFixed(1) + '%')}
      ${this.statCard('Inventory', Utils.formatMoney(d.inventoryValue, c))}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card"><div class="card-header"><h3>Best Selling Products</h3></div><div class="card-body table-wrap">
        <table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
        <tbody>${(d.bestProducts || []).map(p => `<tr><td>${p.product_name}</td><td>${p.qty}</td><td>${Utils.formatMoney(p.revenue, c)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No data</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="card-header"><h3>Highest Expenses</h3></div><div class="card-body table-wrap">
        <table><thead><tr><th>Category</th><th>Total</th></tr></thead>
        <tbody>${(d.highestExpenses || []).map(e => `<tr><td>${e.category}</td><td>${Utils.formatMoney(e.total, c)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No data</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-header"><h3>Employee Cost Analysis</h3></div><div class="card-body table-wrap">
      <table><thead><tr><th>Employee</th><th>Payroll Cost</th></tr></thead>
      <tbody>${(d.employeeCosts || []).map(e => `<tr><td>${e.full_name}</td><td>${Utils.formatMoney(e.cost, c)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No data</td></tr>'}</tbody></table></div></div>`;
  },

  async renderDocuments(el) {
    const res = await API.getFinancialDocuments({});
    const docs = res.data || [];
    el.innerHTML = `<div style="margin-bottom:12px"><button class="btn btn-primary" id="bk-add-doc">+ Archive Document</button></div>
    <div class="table-wrap"><table><thead><tr><th>Type</th><th>Title</th><th>Date</th><th>Amount</th><th>File</th><th></th></tr></thead>
    <tbody>${docs.map(d => `<tr><td>${d.doc_type}</td><td>${d.title || '—'}</td><td>${d.doc_date || '—'}</td>
      <td>${d.amount != null ? Utils.formatMoney(d.amount, this.currency()) : '—'}</td><td>${d.file_name || '—'}</td>
      <td><button class="btn btn-sm btn-danger bk-del-doc" data-id="${d.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No documents archived</td></tr>'}</tbody></table></div>`;
    document.getElementById('bk-add-doc')?.addEventListener('click', () => this.showDocModal());
    el.querySelectorAll('.bk-del-doc').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete document record?')) return;
      await API.deleteFinancialDocument(parseInt(b.dataset.id), this.app.user);
      this.renderDocuments(el);
    }));
  },

  showDocModal() {
    Utils.showModal('Archive Document', `<div class="form-grid">
      <div class="field"><label>Document Type</label><select id="doc-type">
        <option>Expense Receipt</option><option>Supplier Invoice</option><option>Customer Invoice</option>
        <option>Payroll Record</option><option>Payslip</option><option>Proof of Payment</option></select></div>
      <div class="field"><label>Date</label><input type="date" id="doc-date" value="${Utils.today()}"></div>
      <div class="field"><label>Title</label><input id="doc-title"></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="doc-amt"></div>
      <div class="field full"><label>Attach File</label><button type="button" class="btn btn-ghost" id="doc-pick">Choose file</button><span id="doc-file-label" class="muted"></span></div>
      <div class="field full"><label>Notes</label><input id="doc-notes"></div>
    </div>`, '<button class="btn btn-primary" id="doc-save">Save</button>');
    let file = null;
    document.getElementById('doc-pick').addEventListener('click', async () => {
      const r = await API.selectImage('doc');
      if (r.success) { file = r; document.getElementById('doc-file-label').textContent = r.fileName || r.path; }
    });
    document.getElementById('doc-save').addEventListener('click', async () => {
      await API.saveFinancialDocument({
        doc_type: document.getElementById('doc-type').value,
        doc_date: document.getElementById('doc-date').value,
        title: document.getElementById('doc-title').value.trim(),
        amount: parseFloat(document.getElementById('doc-amt').value) || null,
        file_path: file?.path, file_name: file?.fileName,
        notes: document.getElementById('doc-notes').value.trim()
      }, this.app.user);
      Utils.hideModal();
      Utils.toast('Document archived', 'success');
      this.renderTab();
    });
  },

  async renderAudit(el) {
    const res = await API.getFinancialAuditTrail({ from: this.from, to: this.to });
    const rows = res.data || [];
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date/Time</th><th>Entity</th><th>Action</th><th>Field</th><th>Previous</th><th>New</th><th>By</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${Utils.formatDateTime(r.created_at)}</td><td>${r.entity_type} #${r.entity_id || '—'}</td>
      <td>${r.action}</td><td>${r.field_name || '—'}</td><td>${r.previous_value || '—'}</td><td>${r.new_value || '—'}</td>
      <td>${r.user_name || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No audit entries</td></tr>'}</tbody></table></div>`;
  },

  async renderBudgets(el) {
    const month = this.from.slice(0, 7);
    const res = await API.getBudgetVsActual(month);
    const rows = res.data || [];
    const c = this.currency();
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
      <label>Month</label><input type="month" id="bk-budget-month" value="${month}">
      <button class="btn btn-primary" id="bk-add-budget">+ Add Budget</button></div>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th>Department</th><th>Budget</th><th>Actual</th><th>Variance</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(r => `<tr style="${r.overspent ? 'background:rgba(239,68,68,.08)' : ''}"><td>${r.category}</td><td>${r.department}</td>
      <td>${Utils.formatMoney(r.amount, c)}</td><td>${Utils.formatMoney(r.actual, c)}</td>
      <td>${Utils.formatMoney(r.variance, c)}</td><td>${r.overspent ? '⚠ Overspent' : 'OK'}</td>
      <td><button class="btn btn-sm btn-danger bk-del-budget" data-id="${r.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No budgets for this month</td></tr>'}</tbody></table></div>`;
    document.getElementById('bk-budget-month')?.addEventListener('change', async (e) => {
      this.from = e.target.value + '-01';
      this.to = e.target.value + '-28';
      this.renderBudgets(el);
    });
    document.getElementById('bk-add-budget')?.addEventListener('click', () => this.showBudgetModal(month));
    el.querySelectorAll('.bk-del-budget').forEach(b => b.addEventListener('click', async () => {
      await API.deleteBudget(parseInt(b.dataset.id), this.app.user);
      this.renderBudgets(el);
    }));
  },

  showBudgetModal(month) {
    const cats = this.categories.expense || [];
    Utils.showModal('Add Budget', `<div class="form-grid">
      <div class="field"><label>Month</label><input type="month" id="bdg-month" value="${month}"></div>
      <div class="field"><label>Category</label><select id="bdg-cat">${cats.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Department</label><input id="bdg-dept" value="general"></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="bdg-amt"></div>
    </div>`, '<button class="btn btn-primary" id="bdg-save">Save</button>');
    document.getElementById('bdg-save').addEventListener('click', async () => {
      await API.saveBudget({
        budget_month: document.getElementById('bdg-month').value,
        category: document.getElementById('bdg-cat').value,
        department: document.getElementById('bdg-dept').value.trim(),
        amount: parseFloat(document.getElementById('bdg-amt').value)
      }, this.app.user);
      Utils.hideModal();
      Utils.toast('Budget saved', 'success');
      this.renderTab();
    });
  },

  async renderAlerts(el) {
    const res = await API.getFinancialNotifications();
    const notes = res.data || [];
    el.innerHTML = notes.length
      ? notes.map(n => `<div class="card" style="margin-bottom:8px;padding:12px;border-left:4px solid ${n.type.includes('over') || n.type === 'low_cash' ? 'var(--danger)' : 'var(--warning)'}">
        <strong>${n.title}</strong><br><small>${n.message}</small></div>`).join('')
      : '<p class="muted">No financial alerts right now</p>';
  },

  async renderSettings(el) {
    const res = await API.getBookkeepingSettings();
    const s = res.data || {};
    el.innerHTML = `<div class="card"><div class="card-body form-grid">
      <div class="field"><label>Cash Opening Balance</label><input type="number" step="0.01" id="bk-cash-open" value="${s.cash_opening_balance || 0}"></div>
      <div class="field"><label>Bank Opening Balance</label><input type="number" step="0.01" id="bk-bank-open" value="${s.bank_opening_balance || 0}"></div>
      <div class="field"><label>Bank Name</label><input id="bk-bank-name" value="${s.bank_name || ''}"></div>
      <div class="field"><label>Account Number</label><input id="bk-bank-acct" value="${s.bank_account_number || ''}"></div>
      <div class="field"><label>VAT Rate (%)</label><input type="number" step="0.1" id="bk-vat-rate" value="${s.vat_rate || 15}"></div>
      <div class="field"><label><input type="checkbox" id="bk-vat-reg" ${s.vat_registered ? 'checked' : ''}> VAT Registered</label></div>
      <div class="field"><label>Low Cash Alert Threshold</label><input type="number" step="0.01" id="bk-low-cash" value="${s.low_cash_threshold || 500}"></div>
      <div class="field full"><button class="btn btn-primary" id="bk-save-settings">Save Settings</button></div>
    </div></div>`;
    document.getElementById('bk-save-settings').addEventListener('click', async () => {
      await API.saveBookkeepingSettings({
        cash_opening_balance: parseFloat(document.getElementById('bk-cash-open').value),
        bank_opening_balance: parseFloat(document.getElementById('bk-bank-open').value),
        bank_name: document.getElementById('bk-bank-name').value.trim(),
        bank_account_number: document.getElementById('bk-bank-acct').value.trim(),
        vat_rate: parseFloat(document.getElementById('bk-vat-rate').value),
        vat_registered: document.getElementById('bk-vat-reg').checked,
        low_cash_threshold: parseFloat(document.getElementById('bk-low-cash').value)
      }, this.app.user);
      Utils.toast('Bookkeeping settings saved', 'success');
    });
  },

  async renderDonations(el) {
    const currency = this.currency();
    const role = this.app.user?.role;
    const [dashRes, listRes, typesRes] = await Promise.all([
      API.getDonationsDashboard({ from: this.from, to: this.to }),
      API.getDonations({ from: this.from, to: this.to }),
      API.getDonationTypes()
    ]);
    const dash = dashRes.data || {};
    const donations = listRes.data || [];
    const types = typesRes.data || {};
    el.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        ${this.statCard('Approved Total', Utils.formatMoney(dash.total?.total || 0, currency), `${dash.total?.count || 0} donations`)}
        ${this.statCard('Pending Approval', dash.pending || 0)}
        ${this.statCard('Tax Eligible', Utils.formatMoney(dash.taxEligible?.total || 0, currency), `${dash.taxEligible?.count || 0} with tax ref`)}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="don-new">+ New Donation</button>
        <button class="btn btn-ghost" id="don-export-pdf">Export PDF</button>
        <button class="btn btn-ghost" id="don-export-xlsx">Export Excel</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Number</th><th>Date</th><th>Type</th><th>Recipient</th><th>Amount</th><th>Tax Ref</th><th>Status</th><th></th></tr></thead>
        <tbody>${donations.map(d => `<tr>
          <td>${d.donation_number}</td><td>${d.donation_date}</td><td>${d.donation_type}</td>
          <td>${d.recipient_org || '—'}</td><td>${Utils.formatMoney(d.amount, currency)}</td>
          <td>${d.tax_ref_number || '—'}</td><td>${d.status}</td>
          <td>
            <button class="btn btn-sm btn-ghost don-view" data-id="${d.id}">View</button>
            ${['draft', 'rejected'].includes(d.status) ? `<button class="btn btn-sm btn-danger don-del" data-id="${d.id}">Delete</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted">No donations recorded</td></tr>'}
        </tbody></table></div>`;

    document.getElementById('don-new').addEventListener('click', () => this.showDonationForm(types));
    document.getElementById('don-export-pdf').addEventListener('click', async () => {
      await Utils.savePdfBuffer(`donations-${this.from}-${this.to}.pdf`, await API.getDonationsReportPdf({ from: this.from, to: this.to }));
    });
    document.getElementById('don-export-xlsx').addEventListener('click', async () => {
      const r = await API.getDonationsReportExcel({ from: this.from, to: this.to });
      if (r.success) await API.saveFile(`donations-${this.from}-${this.to}.xlsx`, [{ name: 'Excel', extensions: ['xlsx'] }], r.data);
    });
    el.querySelectorAll('.don-view').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getDonation(parseInt(b.dataset.id, 10));
      if (r.success) this.showDonationForm(types, r.data, role);
    }));
    el.querySelectorAll('.don-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this draft/rejected donation?')) return;
      const r = await API.deleteDonation(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not delete', 'error');
      Utils.toast('Donation deleted', 'success');
      this.renderTab();
    }));
  },

  showDonationForm(types, donation = null, role) {
    const d = donation || {};
    const currency = this.currency();
    const canManager = ['owner', 'manager'].includes(role);
    const canAdmin = role === 'owner';
    Utils.showModal(donation ? `Donation ${d.donation_number}` : 'New Donation', `
      <div class="form-grid">
        <div class="field"><label>Date</label><input type="date" id="don-date" value="${d.donation_date || Utils.today()}"></div>
        <div class="field"><label>Amount (${currency})</label><input type="number" step="0.01" id="don-amount" value="${d.amount || 0}"></div>
        <div class="field"><label>Type</label><select id="don-type">${(types.types || []).map(t =>
          `<option ${d.donation_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Payment Method</label><select id="don-pay">${(types.payments || []).map(t =>
          `<option ${d.payment_method === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field full"><label>Recipient Organisation</label><input id="don-org" value="${d.recipient_org || ''}"></div>
        <div class="field"><label>Org Reg Number</label><input id="don-org-reg" value="${d.org_reg_number || ''}"></div>
        <div class="field"><label>SARS Tax Ref (Section 18A)</label><input id="don-tax-ref" value="${d.tax_ref_number || ''}"></div>
        <div class="field full"><label>Purpose</label><input id="don-purpose" value="${d.purpose || ''}"></div>
        <div class="field full"><label>Notes</label><textarea id="don-notes" rows="2">${d.notes || ''}</textarea></div>
        ${donation ? `<div class="field full"><label>Upload Document (PDF/JPG/PNG)</label><input type="file" id="don-file" accept=".pdf,.jpg,.jpeg,.png"></div>` : ''}
        ${donation && d.documents?.length ? `<div class="field full"><small class="muted">${d.documents.length} document(s) attached</small></div>` : ''}
      </div>`,
      `<button class="btn btn-primary" id="don-save">${donation ? 'Update' : 'Create'}</button>
       ${donation && d.status === 'draft' ? '<button class="btn btn-ghost" id="don-submit">Submit for Approval</button>' : ''}
       ${donation && d.status === 'pending_manager' && canManager ? '<button class="btn btn-success" id="don-mgr-approve">Manager Approve</button><button class="btn btn-danger" id="don-mgr-reject">Reject</button>' : ''}
       ${donation && d.status === 'pending_admin' && canAdmin ? '<button class="btn btn-success" id="don-adm-approve">Admin Approve</button><button class="btn btn-danger" id="don-adm-reject">Reject</button>' : ''}`
    );
    document.getElementById('don-save').addEventListener('click', async () => {
      const data = {
        id: d.id,
        donation_date: document.getElementById('don-date').value,
        amount: parseFloat(document.getElementById('don-amount').value) || 0,
        donation_type: document.getElementById('don-type').value,
        payment_method: document.getElementById('don-pay').value,
        recipient_org: document.getElementById('don-org').value.trim(),
        org_reg_number: document.getElementById('don-org-reg').value.trim(),
        tax_ref_number: document.getElementById('don-tax-ref').value.trim(),
        purpose: document.getElementById('don-purpose').value.trim(),
        notes: document.getElementById('don-notes').value.trim()
      };
      const r = await API.saveDonation(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      const donId = r.data?.id || d.id;
      const fileInput = document.getElementById('don-file');
      if (fileInput?.files?.[0]) {
        const file = fileInput.files[0];
        await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async () => {
            const b64 = String(reader.result).split(',')[1] || reader.result;
            await API.uploadDonationDoc(donId, { file_name: file.name, file_data: b64, mime_type: file.type, doc_type: 'receipt' }, this.app.user);
            resolve();
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      Utils.hideModal();
      Utils.toast('Donation saved', 'success');
      this.renderTab();
    });
    document.getElementById('don-submit')?.addEventListener('click', async () => {
      await API.submitDonation(d.id, this.app.user);
      Utils.hideModal(); Utils.toast('Submitted for manager approval', 'success'); this.renderTab();
    });
    document.getElementById('don-mgr-approve')?.addEventListener('click', async () => {
      await API.approveDonation(d.id, { approved: true, comments: '' }, this.app.user);
      Utils.hideModal(); Utils.toast('Approved — sent to admin', 'success'); this.renderTab();
    });
    document.getElementById('don-mgr-reject')?.addEventListener('click', async () => {
      await API.approveDonation(d.id, { approved: false, comments: 'Rejected by manager' }, this.app.user);
      Utils.hideModal(); Utils.toast('Donation rejected', 'success'); this.renderTab();
    });
    document.getElementById('don-adm-approve')?.addEventListener('click', async () => {
      await API.approveDonation(d.id, { approved: true, comments: '' }, this.app.user);
      Utils.hideModal(); Utils.toast('Donation fully approved', 'success'); this.renderTab();
    });
    document.getElementById('don-adm-reject')?.addEventListener('click', async () => {
      await API.approveDonation(d.id, { approved: false, comments: 'Rejected by admin' }, this.app.user);
      Utils.hideModal(); Utils.toast('Donation rejected', 'success'); this.renderTab();
    });
  }
};
window.BookkeepingPage = BookkeepingPage;
