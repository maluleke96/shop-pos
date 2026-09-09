const ExpensesPage = {
  tab: 'list',
  dashboard: null,

  parseLineItems(e) {
    try {
      const raw = e.line_items_json;
      const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(j)) return [];
      return j.map((r) => {
        const qty = Number(r.quantity != null ? r.quantity : r.qty) || 1;
        const unit = Number(r.unit_price != null ? r.unit_price : r.price) || 0;
        const amount = Number(r.amount) || (qty * unit);
        return {
          name: r.name || r.description || 'Item',
          quantity: qty,
          unit_price: unit,
          amount: Math.round(amount * 100) / 100
        };
      }).filter((r) => r.name && r.amount > 0);
    } catch (_) {
      return [];
    }
  },

  sumAmount(list) {
    return (list || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  },

  async loadCategories() {
    const res = await API.getExpenseCategories();
    this.categories = res.success ? (res.data || []) : (this.app.settings?.expense_categories || Utils.expenseCategories);
    return this.categories;
  },

  formatLineItemsBrief(e, currency) {
    const items = this.parseLineItems(e);
    if (!items.length) return Utils.escHtml(e.description || '—');
    return items.map((r) => {
      const qty = r.quantity > 1 ? `${r.quantity}× ` : '';
      return `<div style="font-size:12px;padding:1px 0">${Utils.escHtml(r.name)} <span class="muted">${qty}${Utils.formatMoney(r.unit_price, currency)}</span></div>`;
    }).join('');
  },

  catLabel(cat) {
    return String(cat || 'other').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  },

  async render(el, app) {
    this.app = app;
    this.tab = this.tab || 'list';
    await this.loadCategories();
    el.innerHTML = `<div class="page-toolbar">
        <h3>Expenses</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <div class="admin-tabs" id="exp-tabs">
            <button type="button" class="admin-tab ${this.tab === 'list' ? 'active' : ''}" data-exp-tab="list">Expenses</button>
            <button type="button" class="admin-tab ${this.tab === 'dashboard' ? 'active' : ''}" data-exp-tab="dashboard">📊 Dashboard</button>
          </div>
          <button class="btn btn-ghost" id="exp-manage-cats">Manage categories</button>
          <button class="btn btn-primary" id="add-exp">+ Add Expense</button>
        </div>
      </div>
      <div id="exp-panel-list" class="${this.tab === 'list' ? '' : 'hidden'}">
        ${Utils.dateFilterHTML('exp-filter')}
        <div id="exp-content"></div>
      </div>
      <div id="exp-panel-dashboard" class="${this.tab === 'dashboard' ? '' : 'hidden'}"></div>
      <style>
        .exp-dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}
        .exp-chart-row{display:grid;grid-template-columns:minmax(90px,28%) 1fr minmax(72px,auto);gap:10px;align-items:center;margin:8px 0;font-size:13px}
        .exp-chart-bar-wrap{background:var(--border,#eee);border-radius:6px;height:10px;overflow:hidden}
        .exp-chart-bar{height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:6px;min-width:2px}
        .exp-advice-card{background:var(--card,#fff);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px}
        .exp-advice-card strong{display:block;margin-bottom:4px}
        .exp-section-title{margin:24px 0 10px;font-size:1.05rem;font-weight:700}
        .exp-cat-table td,.exp-cat-table th{padding:8px 10px}
        .exp-pct-warn{color:#b45309;font-size:13px;margin-top:8px}
      </style>`;

    document.getElementById('add-exp').addEventListener('click', () => this.showForm());
    document.getElementById('exp-manage-cats').addEventListener('click', () => this.showCategoryManager());
    document.querySelectorAll('[data-exp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.expTab;
        document.querySelectorAll('[data-exp-tab]').forEach((b) => b.classList.toggle('active', b.dataset.expTab === this.tab));
        document.getElementById('exp-panel-list').classList.toggle('hidden', this.tab !== 'list');
        document.getElementById('exp-panel-dashboard').classList.toggle('hidden', this.tab !== 'dashboard');
        if (this.tab === 'dashboard') this.loadDashboard();
        else this.load(this._from || Utils.monthStart(), this._to || Utils.today());
      });
    });

    Utils.bindDateFilter('exp-filter', (from, to) => this.load(from, to));
    if (this.tab === 'dashboard') this.loadDashboard();
    else this.load(Utils.monthStart(), Utils.today());
  },

  renderBarRows(items, valueKey, labelKey, currency) {
    if (!items?.length) return '<p class="muted">No data for this period.</p>';
    const max = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
    return items.map((item) => {
      const val = Number(item[valueKey]) || 0;
      const pct = Math.round((val / max) * 100);
      const label = item[labelKey] || item.name || item.label || '—';
      const display = currency ? Utils.formatMoney(val, currency) : String(val);
      return `<div class="exp-chart-row">
        <span>${Utils.escHtml(label)}</span>
        <div class="exp-chart-bar-wrap"><div class="exp-chart-bar" style="width:${pct}%"></div></div>
        <span style="font-weight:600;text-align:right">${display}</span>
      </div>`;
    }).join('');
  },

  async loadDashboard() {
    const panel = document.getElementById('exp-panel-dashboard');
    if (!panel) return;
    panel.innerHTML = '<p class="muted" style="padding:20px">Loading expense dashboard…</p>';
    const res = await API.getExpenseDashboardStats({}, this.app.user).catch(() => ({ success: false }));
    if (!res.success) {
      panel.innerHTML = `<p class="muted">${Utils.escHtml(res.error || 'Could not load dashboard')}</p>`;
      return;
    }
    this.dashboard = res.data || res;
    const d = this.dashboard;
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);
    const ov = d.overview || {};
    const cards = d.cards || {};
    const topCat = (d.topCategoriesWeek || [])[0];
    const topShop = (d.byShopWeek || [])[0];

    panel.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px">
        <button type="button" class="btn btn-primary" id="exp-export-pdf">📄 Export PDF</button>
        <button type="button" class="btn btn-ghost" id="exp-print-report">🖨️ Print</button>
      </div>
      <div class="exp-dash-grid">
        <div class="stat-card primary"><div class="label">This Week</div><div class="value">${fmt(cards.weekTotal ?? ov.weekTotal ?? 0)}</div></div>
        <div class="stat-card"><div class="label">This Month</div><div class="value">${fmt(cards.monthTotal ?? ov.monthTotal ?? 0)}</div></div>
        <div class="stat-card"><div class="label">Biggest Category</div><div class="value" style="font-size:15px">${Utils.escHtml(cards.biggestCategory || '—')}</div></div>
        <div class="stat-card"><div class="label">Top Product</div><div class="value" style="font-size:15px">${Utils.escHtml(cards.topProduct || '—')}</div></div>
        <div class="stat-card"><div class="label">Highest Spending Shop</div><div class="value" style="font-size:15px">${Utils.escHtml(cards.topShop || '—')}</div></div>
      </div>

      <div class="card" style="margin-top:12px"><div class="card-body">
        <h4 style="margin:0 0 12px">📊 Spending overview</h4>
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          <div><div class="label muted">This week</div><strong>${fmt(ov.weekTotal ?? 0)}</strong></div>
          <div><div class="label muted">This month</div><strong>${fmt(ov.monthTotal ?? 0)}</strong></div>
          <div><div class="label muted">Avg / day (week)</div><strong>${fmt(ov.avgPerDayWeek ?? 0)}</strong></div>
          <div><div class="label muted">Avg / day (month)</div><strong>${fmt(ov.avgPerDayMonth ?? 0)}</strong></div>
          <div><div class="label muted">vs last week</div><strong style="color:${(ov.weekChangePct ?? 0) >= 0 ? 'var(--danger,#c00)' : 'var(--success,#080)'}">${ov.weekChangePct > 0 ? '+' : ''}${ov.weekChangePct ?? 0}%</strong></div>
          <div><div class="label muted">vs last month</div><strong style="color:${(ov.monthChangePct ?? 0) >= 0 ? 'var(--danger,#c00)' : 'var(--success,#080)'}">${ov.monthChangePct > 0 ? '+' : ''}${ov.monthChangePct ?? 0}%</strong></div>
        </div>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">🏷️ Top expense categories (this week)</h4>
        <div class="table-wrap"><table class="table-compact exp-cat-table">
          <thead><tr><th>Category</th><th>This week</th><th>%</th></tr></thead>
          <tbody>${(d.topCategoriesWeek || []).slice(0, 8).map((c) => `
            <tr><td>${Utils.escHtml(c.label || this.catLabel(c.name))}</td>
            <td>${fmt(c.amount)}</td><td>${c.pct ?? 0}%</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No expenses this week</td></tr>'}
          </tbody></table></div>
        ${topCat && topCat.pct >= 30 ? `<p class="exp-pct-warn">⚠️ ${Utils.escHtml(topCat.label || this.catLabel(topCat.name))} is your biggest expense this week — ${topCat.pct}% of total expenses.</p>` : ''}
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">🛒 Most-purchased products (this month)</h4>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Product</th><th>Purchases</th><th>Total cost</th></tr></thead>
          <tbody>${(d.topProductsMonth || []).slice(0, 10).map((p) => `
            <tr><td>${Utils.escHtml(p.emoji || '🛒')} ${Utils.escHtml(p.name)}</td>
            <td>${p.purchaseCount}</td><td><strong>${fmt(p.totalCost)}</strong></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Add line items on expenses to track products</td></tr>'}
          </tbody></table></div>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">🏪 Spending by shop / location (this month)</h4>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Shop / branch</th><th>Amount</th><th>%</th></tr></thead>
          <tbody>${(d.byShopMonth || []).slice(0, 10).map((s) => `
            <tr><td>${Utils.escHtml(s.name)}</td><td>${fmt(s.amount)}</td><td>${s.pct ?? 0}%</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No branch data — expenses use your branch when captured</td></tr>'}
          </tbody></table></div>
        ${topShop && topShop.pct >= 25 ? `<p class="exp-pct-warn">⚠️ ${Utils.escHtml(topShop.name)} is currently responsible for ${topShop.pct}% of your expenses this month.</p>` : ''}
      </div></div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:16px">
        <div class="card"><div class="card-body">
          <h4 style="margin:0 0 12px">📊 Expenses by category</h4>
          ${this.renderBarRows(d.charts?.categories || [], 'amount', 'name', currency)}
        </div></div>
        <div class="card"><div class="card-body">
          <h4 style="margin:0 0 12px">📈 Spending this week (daily)</h4>
          ${this.renderBarRows((d.charts?.timeline || []).filter((x) => x.total > 0), 'total', 'date', currency)}
        </div></div>
        <div class="card"><div class="card-body">
          <h4 style="margin:0 0 12px">🛒 Top products purchased</h4>
          ${this.renderBarRows(d.charts?.products || [], 'total', 'name', currency)}
        </div></div>
      </div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">💡 Expense advice</h4>
        ${(d.advice || []).length ? (d.advice || []).map((a) => `
          <div class="exp-advice-card">
            <strong>${a.icon || '💡'} ${Utils.escHtml(a.title || 'Insight')}</strong>
            <span>${Utils.escHtml(a.message || '')}</span>
          </div>`).join('') : '<p class="muted">Record more expenses to unlock personalised advice.</p>'}
      </div></div>`;

    document.getElementById('exp-export-pdf')?.addEventListener('click', () => this.exportDashboardPdf());
    document.getElementById('exp-print-report')?.addEventListener('click', () => this.printDashboard());
  },

  buildDashboardPdfRows() {
    const d = this.dashboard;
    if (!d) return { headers: ['Item', 'Value'], rows: [] };
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);
    const rows = [];
    const push = (a, b) => rows.push([String(a ?? ''), String(b ?? '')]);

    push('EXPENSE DASHBOARD', '');
    push('Generated', new Date().toLocaleString());
    push('', '');

    push('SUMMARY', '');
    push('This week', fmt(d.cards?.weekTotal));
    push('This month', fmt(d.cards?.monthTotal));
    push('Biggest category', d.cards?.biggestCategory || '—');
    push('Top product', d.cards?.topProduct || '—');
    push('Highest spending shop', d.cards?.topShop || '—');
    push('Avg per day (week)', fmt(d.overview?.avgPerDayWeek));
    push('Avg per day (month)', fmt(d.overview?.avgPerDayMonth));
    push('Change vs last week', `${d.overview?.weekChangePct ?? 0}%`);
    push('Change vs last month', `${d.overview?.monthChangePct ?? 0}%`);
    push('', '');

    push('TOP CATEGORIES (THIS WEEK)', 'Amount');
    for (const c of (d.topCategoriesWeek || []).slice(0, 12)) {
      push(this.catLabel(c.label || c.name), fmt(c.amount));
    }
    push('', '');

    push('TOP PRODUCTS (THIS MONTH)', 'Total cost');
    for (const p of (d.topProductsMonth || []).slice(0, 15)) {
      push(`${p.name} (${p.purchaseCount} purchases)`, fmt(p.totalCost));
    }
    push('', '');

    push('SPENDING BY SHOP (THIS MONTH)', 'Amount');
    for (const s of (d.byShopMonth || []).slice(0, 12)) {
      push(s.name, fmt(s.amount));
    }
    push('', '');

    push('EXPENSE ADVICE', '');
    for (const a of d.advice || []) push(a.title, a.message);
    return { headers: ['Item', 'Value'], rows };
  },

  async buildDashboardPdfRowsFull() {
    const base = this.buildDashboardPdfRows();
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);
    const from = this.dashboard?.ranges?.monthFrom || Utils.monthStart();
    const to = this.dashboard?.ranges?.monthTo || Utils.today();
    const res = await API.getExpenses({ from, to }).catch(() => ({ success: false }));
    const list = res.success ? (res.data || []) : (this.expenses || []);
    base.rows.push('', 'DETAILED EXPENSE LIST', 'Date | Category | Shop | Amount');
    for (const e of list.slice(0, 200)) {
      base.rows.push(
        Utils.formatDate(e.expense_date),
        `${e.category} | ${e.branch_name || '—'} | ${fmt(e.amount)}`
      );
    }
    if (list.length > 200) base.rows.push('…', `${list.length - 200} more expenses not shown`);
    return base;
  },

  async exportDashboardPdf() {
    if (!this.dashboard) return Utils.toast('Load the dashboard first', 'error');
    const { headers, rows } = await this.buildDashboardPdfRowsFull();
    const shop = this.app.settings?.shop_name || 'Shop POS';
    try {
      await Export.toPDF(`expenses-dashboard-${Utils.today()}.pdf`, `${shop} — Expense Dashboard`, headers, rows, {
        shop_name: shop,
        address: this.app.settings?.address || ''
      });
    } catch (_) { /* toast inside Export */ }
  },

  async printDashboard() {
    if (!this.dashboard) return Utils.toast('Load the dashboard first', 'error');
    const { headers, rows } = await this.buildDashboardPdfRowsFull();
    const shop = this.app.settings?.shop_name || 'Shop POS';
    try {
      await Export.print(`${shop} — Expense Dashboard`, headers, rows, { shop_name: shop });
    } catch (_) { /* toast inside Export */ }
  },

  async load(from, to) {
    const res = await API.getExpenses({ from, to });
    if (!res.success) {
      document.getElementById('exp-content').innerHTML = `<p class="muted">${res.error || 'Could not load expenses'}</p>`;
      return;
    }
    this.expenses = res.data || [];
    this._from = from;
    this._to = to;
    const currency = this.app.settings?.currency || 'R';
    const total = this.sumAmount(this.expenses);

    document.getElementById('exp-content').innerHTML = `
      <p style="margin:12px 0;font-weight:600;font-size:1.1rem">Total: ${Utils.formatMoney(total, currency)}</p>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Category</th><th>Items</th><th>Total</th><th>Shop</th><th>By</th><th>Invoice</th><th></th></tr></thead>
        <tbody>${this.expenses.map(e => {
          const inv = e.invoice_path
            ? `<img src="/api/expense-invoice/${e.id}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`
            : '<span class="muted">—</span>';
          return `<tr>
          <td>${Utils.formatDate(e.expense_date)}</td>
          <td><span class="tag">${Utils.escHtml(e.category)}</span></td>
          <td style="max-width:220px">${this.formatLineItemsBrief(e, currency)}</td>
          <td><strong>${Utils.formatMoney(Number(e.amount) || 0, currency)}</strong></td>
          <td>${Utils.escHtml(e.branch_name || '—')}</td>
          <td>${Utils.escHtml(e.user_name || '—')}</td>
          <td>${inv}</td>
          <td class="actions" style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost view-exp" data-id="${e.id}">View</button>
            <button class="btn btn-sm btn-danger del-exp" data-id="${e.id}">Delete</button>
          </td></tr>`;
        }).join('') || '<tr><td colspan="8" class="muted">No expenses in this period</td></tr>'}
        </tbody></table></div></div>`;

    document.querySelectorAll('.view-exp').forEach(b => b.addEventListener('click', () =>
      this.showDetail(this.expenses.find(x => x.id == b.dataset.id))));
    document.querySelectorAll('.del-exp').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Delete expense?')) {
        await API.deleteExpense(parseInt(b.dataset.id, 10), this.app.user);
        this.load(from, to);
        Utils.toast('Expense deleted', 'success');
      }
    }));
  },

  showDetail(exp) {
    if (!exp) return;
    const currency = this.app.settings?.currency || 'R';
    const items = this.parseLineItems(exp);
    const linesHtml = items.length
      ? `<table style="width:100%;border-collapse:collapse;margin:12px 0">
          <thead><tr style="text-align:left;font-size:12px;color:var(--muted)">
            <th style="padding:6px 4px">Item</th><th style="padding:6px 4px">Qty</th><th style="padding:6px 4px">Price</th><th style="padding:6px 4px;text-align:right">Line total</th>
          </tr></thead>
          <tbody>${items.map(r => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:8px 4px">${Utils.escHtml(r.name)}</td>
            <td style="padding:8px 4px">${r.quantity}</td>
            <td style="padding:8px 4px">${Utils.formatMoney(r.unit_price, currency)}</td>
            <td style="padding:8px 4px;text-align:right;font-weight:600">${Utils.formatMoney(r.amount, currency)}</td>
          </tr>`).join('')}
          <tr style="border-top:2px solid var(--border);font-weight:700">
            <td colspan="3" style="padding:10px 4px;text-align:right">Total</td>
            <td style="padding:10px 4px;text-align:right">${Utils.formatMoney(Number(exp.amount) || this.sumAmount(items), currency)}</td>
          </tr></tbody></table>`
      : `<p class="muted">${Utils.escHtml(exp.description || 'No line items')}</p>`;

    const invoiceHtml = exp.invoice_path
      ? `<div style="margin-top:16px"><p style="font-weight:600;margin-bottom:8px">Invoice photo</p>
         <a href="/api/expense-invoice/${exp.id}" target="_blank" rel="noopener">
           <img src="/api/expense-invoice/${exp.id}" alt="Invoice" style="max-width:100%;max-height:360px;border-radius:8px;border:1px solid var(--border)">
         </a></div>`
      : '<p class="muted" style="margin-top:12px">No invoice photo attached.</p>';

    Utils.showModal(`Expense — ${Utils.formatDate(exp.expense_date)}`, `
      <div style="font-size:14px;line-height:1.5">
        <p><strong>Category:</strong> ${Utils.escHtml(exp.category)}</p>
        <p><strong>Shop / branch:</strong> ${Utils.escHtml(exp.branch_name || '—')}</p>
        <p><strong>Recorded by:</strong> ${Utils.escHtml(exp.user_name || '—')}</p>
        ${exp.description ? `<p><strong>Note:</strong> ${Utils.escHtml(exp.description)}</p>` : ''}
        <h4 style="margin:16px 0 4px">Line items</h4>
        ${linesHtml}
        ${invoiceHtml}
      </div>`, '<button type="button" class="btn btn-primary" id="close-exp-detail">Close</button>');
    document.getElementById('close-exp-detail')?.addEventListener('click', () => Utils.hideModal());
  },

  showCategoryManager() {
    const cats = [...(this.categories || Utils.expenseCategories)];
    const listHtml = cats.map((c, i) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input class="exp-cat-input" data-idx="${i}" value="${Utils.escHtml(c)}" style="flex:1">
        <button type="button" class="btn btn-sm btn-danger exp-cat-del" data-idx="${i}">×</button>
      </div>`).join('');

    Utils.showModal('Expense categories', `
      <p class="muted" style="margin:0 0 12px">These categories appear in Admin and on the mobile Expenses app.</p>
      <div id="exp-cat-list">${listHtml}</div>
      <button type="button" class="btn btn-ghost" id="exp-cat-add" style="margin-top:8px">+ Add category</button>`,
      '<button type="button" class="btn btn-primary" id="exp-cat-save">Save categories</button>');

    const rerender = () => {
      const inputs = [...document.querySelectorAll('.exp-cat-input')];
      this.categories = inputs.map(i => i.value.trim()).filter(Boolean);
      document.getElementById('exp-cat-list').innerHTML = this.categories.map((c, i) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input class="exp-cat-input" data-idx="${i}" value="${Utils.escHtml(c)}" style="flex:1">
          <button type="button" class="btn btn-sm btn-danger exp-cat-del" data-idx="${i}">×</button>
        </div>`).join('');
      bindCatEvents();
    };

    const bindCatEvents = () => {
      document.getElementById('exp-cat-add')?.addEventListener('click', () => {
        this.categories.push('');
        rerender();
      });
      document.querySelectorAll('.exp-cat-del').forEach(b => b.addEventListener('click', () => {
        this.categories.splice(Number(b.dataset.idx), 1);
        rerender();
      }));
    };
    bindCatEvents();

    document.getElementById('exp-cat-save')?.addEventListener('click', async () => {
      const inputs = [...document.querySelectorAll('.exp-cat-input')];
      const cats = inputs.map(i => i.value.trim()).filter(Boolean);
      if (!cats.length) return Utils.toast('Add at least one category', 'error');
      const r = await API.saveExpenseCategories(cats, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save', 'error');
      this.categories = cats;
      Utils.hideModal();
      Utils.toast('Categories saved', 'success');
    });
  },

  _expenseCatIcon(cat) {
    return ({ rent: '🏠', transport: '🚗', electricity: '⚡', salary: '💼', fuel: '⛽', maintenance: '🔧', other: '📋' }[cat] || '📋');
  },

  _parseExpensePrice(v) {
    const n = parseFloat(String(v || '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  },

  showForm() {
    const currency = this.app.settings?.currency || 'R';
    const cats = this.categories || Utils.expenseCategories;
    const state = {
      lineSeq: 2,
      lineItems: [{ _id: 1, name: '', qty: '1', price: '' }],
      category: cats[0] || 'other',
      invoicePreview: '',
      invoiceDataUrl: ''
    };

    const validLineItems = () => state.lineItems.map((row) => {
      const name = String(row.name || '').trim();
      const quantity = Math.max(this._parseExpensePrice(row.qty) || 1, 0.001);
      const unit_price = this._parseExpensePrice(row.price);
      const amount = Math.round(quantity * unit_price * 100) / 100;
      return { name, quantity, unit_price, amount };
    }).filter((row) => row.name && row.unit_price > 0 && row.amount > 0);

    const calcTotal = () => Math.round(validLineItems().reduce((s, row) => s + row.amount, 0) * 100) / 100;

    const syncLinesFromDom = () => {
      document.querySelectorAll('#admin-ex-lines .line-item-row').forEach((row) => {
        const id = row.dataset.id;
        const item = state.lineItems.find((r) => String(r._id) === String(id));
        if (!item) return;
        item.name = row.querySelector('.line-item-name')?.value || '';
        item.qty = row.querySelector('.line-item-qty')?.value || '1';
        item.price = row.querySelector('.line-item-price')?.value || '';
      });
    };

    const renderLines = () => state.lineItems.map((row, idx) => `
      <div class="line-item-row" data-id="${row._id}" style="display:grid;grid-template-columns:24px 1fr 36px;gap:8px;align-items:center;margin-bottom:8px">
        <span class="muted" style="font-size:12px">${idx + 1}</span>
        <div style="display:grid;grid-template-columns:1fr 56px 80px;gap:8px">
          <input type="text" class="line-item-name" placeholder="Item name" value="${Utils.escHtml(row.name)}">
          <input type="number" class="line-item-qty" placeholder="Qty" step="any" min="0.001" value="${Utils.escHtml(row.qty != null ? row.qty : '1')}">
          <input type="number" class="line-item-price" placeholder="Price" step="0.01" min="0" value="${Utils.escHtml(row.price)}">
        </div>
        <button type="button" class="btn btn-ghost btn-sm line-item-remove" data-remove-id="${row._id}" aria-label="Remove line">×</button>
      </div>`).join('');

    const renderCatChips = () => cats.map((c) => `
      <button type="button" class="btn btn-sm ${state.category === c ? 'btn-primary' : 'btn-ghost'}" data-ex-cat="${Utils.escHtml(c)}">${this._expenseCatIcon(c)} ${this.catLabel(c)}</button>
    `).join('');

    const refreshTotals = () => {
      syncLinesFromDom();
      const totalEl = document.getElementById('admin-ex-total');
      if (totalEl) totalEl.textContent = Utils.formatMoney(calcTotal(), currency);
      const countEl = document.getElementById('admin-ex-line-count');
      if (countEl) {
        const n = validLineItems().length;
        countEl.textContent = n ? `${n} item${n === 1 ? '' : 's'}` : 'Add items below';
      }
    };

    const refreshForm = () => {
      const linesEl = document.getElementById('admin-ex-lines');
      if (linesEl) linesEl.innerHTML = renderLines();
      refreshTotals();
      const previewEl = document.getElementById('admin-ex-invoice-preview');
      if (previewEl) {
        previewEl.innerHTML = state.invoicePreview
          ? `<img src="${state.invoicePreview}" alt="Invoice" style="max-width:100%;border-radius:8px;margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" id="admin-ex-invoice-clear" style="margin-top:8px">Remove photo</button>`
          : `<label class="btn btn-ghost btn-sm" style="margin-top:8px;cursor:pointer">Upload invoice photo<input type="file" id="admin-ex-invoice-file" accept="image/*" hidden></label>`;
        previewEl.querySelector('#admin-ex-invoice-file')?.addEventListener('change', onInvoicePick);
        previewEl.querySelector('#admin-ex-invoice-clear')?.addEventListener('click', () => {
          state.invoicePreview = '';
          state.invoiceDataUrl = '';
          refreshForm();
        });
      }
      document.querySelectorAll('[data-ex-cat]').forEach((btn) => {
        btn.classList.toggle('btn-primary', btn.dataset.exCat === state.category);
        btn.classList.toggle('btn-ghost', btn.dataset.exCat !== state.category);
      });
    };

    const onInvoicePick = async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      if (!/^image\//.test(file.type || '')) return Utils.toast('Please choose a photo', 'error');
      const reader = new FileReader();
      reader.onload = () => {
        state.invoicePreview = reader.result;
        state.invoiceDataUrl = reader.result;
        refreshForm();
      };
      reader.readAsDataURL(file);
    };

    Utils.showModal('Add Expense', `
      <div class="form-grid" style="gap:12px">
        <div class="field full">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label style="margin:0">Invoice line items</label>
            <span class="muted" id="admin-ex-line-count">Add items below</span>
          </div>
          <div id="admin-ex-lines">${renderLines()}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="admin-ex-add-line" style="margin-top:8px">+ Add another item</button>
        </div>
        <div class="field full" style="text-align:center;padding:12px;background:var(--card);border-radius:10px;border:1px solid var(--border)">
          <label class="muted" style="display:block;margin-bottom:4px">Invoice total</label>
          <div id="admin-ex-total" style="font-size:1.5rem;font-weight:700">${Utils.formatMoney(0, currency)}</div>
          <p class="muted" style="margin:4px 0 0;font-size:12px">Calculated from line items</p>
        </div>
        <div class="field full">
          <label>Category</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" id="admin-ex-cats">${renderCatChips()}</div>
        </div>
        <div class="field"><label>Date</label><input type="date" id="ex-date" value="${Utils.today()}"></div>
        <div class="field"><label>Supplier / note</label><input id="ex-desc" placeholder="e.g. Makro, Shell…"></div>
        <div class="field full" id="admin-ex-invoice-preview">
          <label>Invoice photo</label>
          <label class="btn btn-ghost btn-sm" style="margin-top:8px;cursor:pointer">Upload invoice photo<input type="file" id="admin-ex-invoice-file" accept="image/*" hidden></label>
        </div>
      </div>`,
      '<button type="button" class="btn btn-primary" id="save-exp">Save Expense</button>');

    document.getElementById('admin-ex-lines')?.addEventListener('input', () => refreshTotals());
    document.getElementById('admin-ex-add-line')?.addEventListener('click', () => {
      syncLinesFromDom();
      state.lineItems.push({ _id: state.lineSeq++, name: '', qty: '1', price: '' });
      refreshForm();
    });
    document.getElementById('admin-ex-lines')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-id]');
      if (!btn) return;
      syncLinesFromDom();
      const rid = String(btn.dataset.removeId);
      if (state.lineItems.length <= 1) {
        state.lineItems = [{ _id: state.lineSeq++, name: '', qty: '1', price: '' }];
      } else {
        state.lineItems = state.lineItems.filter((r) => String(r._id) !== rid);
      }
      refreshForm();
    });
    document.getElementById('admin-ex-cats')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-ex-cat]');
      if (!chip) return;
      state.category = chip.dataset.exCat;
      refreshForm();
    });
    document.getElementById('admin-ex-invoice-file')?.addEventListener('change', onInvoicePick);

    document.getElementById('save-exp').addEventListener('click', async () => {
      syncLinesFromDom();
      const line_items = validLineItems();
      if (!line_items.length) return Utils.toast('Add at least one item with a name and price', 'error');
      const amount = calcTotal();
      const r = await API.saveExpense({
        category: state.category,
        amount,
        expense_date: document.getElementById('ex-date').value,
        description: document.getElementById('ex-desc').value.trim(),
        notes: document.getElementById('ex-desc').value.trim(),
        line_items,
        invoice_image: state.invoiceDataUrl || null
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      if (this.tab === 'dashboard') this.loadDashboard();
      else this.load(this._from || Utils.monthStart(), this._to || Utils.today());
      Utils.toast('Expense saved', 'success');
    });
  }
};
window.ExpensesPage = ExpensesPage;
