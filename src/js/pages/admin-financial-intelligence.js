/**
 * Admin → Financial Intelligence
 * Every figure comes from the fin:* RPC layer, which aggregates the existing sales, sale items,
 * payments, returns, expenses, products, branches and employees on the server. When there is no
 * data the page shows the server's "NO DATA" / "INSUFFICIENT DATA" explanation instead of numbers.
 */
window.AdminFinancialIntelligencePage = {
  el: null,
  admin: null,
  tab: 'dashboard',
  meta: null,
  f: { preset: 'this_month', from: '', to: '', branch_id: '' },
  dayF: { preset: 'today', date: '' },
  mon: null,
  year: null,
  beMonths: '',
  aiLast: null,
  reportLast: null,
  scenario: null,
  editCat: null,

  TABS: [
    ['dashboard', 'Dashboard'],
    ['daily', 'Daily Performance'],
    ['monthly', 'Monthly Performance'],
    ['annual', 'Annual Performance'],
    ['allocation', 'Cost Allocation'],
    ['expenses', 'Expense Categories'],
    ['employees', 'Employees & Salaries'],
    ['products', 'Product Profitability'],
    ['breakeven', 'Break-Even Analysis'],
    ['branches', 'Branch Performance'],
    ['reports', 'Reports'],
    ['ai', 'AI Financial Advisor'],
    ['settings', 'Settings']
  ],
  PRESETS: [
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'],
    ['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'], ['last_year', 'Last year'], ['custom', 'Custom range']
  ],
  KIND_LABELS: {
    stock: 'Stock / ingredients', salary: 'Salaries', rent: 'Rent', utilities: 'Utilities', operating: 'Operating', marketing: 'Marketing',
    transport: 'Transport', maintenance: 'Maintenance', tax: 'Tax provision', owner: 'Owner allocation', savings: 'Savings / reserve', other: 'Other'
  },
  MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v)
      : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  toast(msg, type) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info'); },
  R(v) { return v == null || v === '' ? '—' : `R${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; },
  n(v) { return v == null || v === '' ? '—' : Number(v).toLocaleString('en-ZA'); },
  pct(v) { return v == null ? '—' : `${v}%`; },
  can(k) { return !!this.meta?.permissions?.[k]; },

  async api(promise, errMsg) {
    let r;
    try { r = await promise; } catch (e) { this.toast(e?.message || errMsg || 'Request failed', 'error'); return null; }
    if (!r || r.success === false) { this.toast((r && r.error) || errMsg || 'Request failed', 'error'); return null; }
    return r.data !== undefined ? r.data : r;
  },

  ensureCss() {
    if (document.getElementById('fic-css')) return;
    const s = document.createElement('style');
    s.id = 'fic-css';
    s.textContent = `
      .fic-root{padding:14px;color:var(--text,#0f172a)}
      .fic-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}
      .fic-head h2{margin:0;font-size:1.35rem}
      .fic-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--border,#e2e8f0);margin-bottom:12px}
      .fic-tab{border:0;background:none;padding:8px 10px;border-radius:8px 8px 0 0;cursor:pointer;font-weight:600;color:var(--muted,#64748b)}
      .fic-tab.active{background:#059669;color:#fff}
      .fic-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:12px}
      .fic-kpi{background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:10px}
      .fic-kpi .l{font-size:.75rem;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:.03em}
      .fic-kpi .v{font-size:1.25rem;font-weight:700;margin-top:2px}
      .fic-kpi .s{font-size:.75rem;color:var(--muted,#64748b)}
      .fic-kpi.bad .v{color:#b91c1c}.fic-kpi.good .v{color:#047857}
      .fic-card{background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:12px;margin-bottom:12px;overflow-x:auto}
      .fic-card h3,.fic-card h4{margin:0 0 8px}
      .fic-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
      .fic-tag{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:999px;margin-right:4px}
      .fic-tag.fact{background:#dbeafe;color:#1e3a8a}.fic-tag.an{background:#fef3c7;color:#92400e}.fic-tag.rec{background:#dcfce7;color:#166534}
      .fic-muted{color:var(--muted,#64748b);font-size:.85rem}
      .fic-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:.85rem}
      .fic-err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:.85rem;font-weight:600}
      .fic-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:.85rem}
      .fic-empty{text-align:center;padding:18px;color:var(--muted,#64748b);font-weight:700;letter-spacing:.03em}
      .fic-table{width:100%;border-collapse:collapse;font-size:.84rem}
      .fic-table th,.fic-table td{padding:6px 8px;border-bottom:1px solid var(--border,#e2e8f0);text-align:left;vertical-align:top;white-space:nowrap}
      .fic-table th{font-size:.72rem;text-transform:uppercase;color:var(--muted,#64748b)}
      .fic-table td.num,.fic-table th.num{text-align:right}
      .fic-table tr.click{cursor:pointer}.fic-table tr.click:hover{background:#ecfdf5}
      .fic-table tr.none td{color:var(--muted,#94a3b8)}
      .fic-table tr.total td{font-weight:800;border-top:2px solid #059669;background:#f0fdf4}
      .fic-row{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:8px}
      .fic-row label{display:flex;flex-direction:column;font-size:.78rem;gap:3px;color:var(--muted,#64748b)}
      .fic-row input,.fic-row select,.fic-row textarea{padding:6px 8px;border:1px solid var(--border,#cbd5e1);border-radius:8px;font-size:.9rem;background:var(--input-bg,#fff);color:inherit}
      .fic-btn{padding:6px 12px;border-radius:8px;border:1px solid var(--border,#cbd5e1);background:var(--card,#fff);cursor:pointer;font-weight:600;font-size:.85rem;color:inherit}
      .fic-btn.p{background:#059669;border-color:#059669;color:#fff}
      .fic-btn.sm{padding:3px 8px;font-size:.78rem}
      .fic-btn:disabled{opacity:.5;cursor:not-allowed}
      .fic-chip{display:inline-block;border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;border-radius:999px;padding:3px 10px;margin:3px;font-size:.8rem;cursor:pointer}
      .fic-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:40px 12px;overflow:auto}
      .fic-modal>div{background:var(--card,#fff);color:var(--text,#0f172a);border-radius:12px;max-width:900px;width:100%;padding:16px}
      .fic-pill{font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px;background:#e2e8f0}
      .fic-pill.on{background:#dcfce7;color:#166534}.fic-pill.off{background:#fee2e2;color:#991b1b}
    `;
    document.head.appendChild(s);
  },

  async render(el, adminPage) {
    this.el = el;
    this.admin = adminPage;
    this.ensureCss();
    el.innerHTML = `<div class="fic-root">
      <div class="fic-head">
        <div><h2>💰 Financial Intelligence</h2><div class="fic-muted">Calculated from your recorded sales, refunds, expenses, products, branches and employees. Nothing is changed without your approval.</div></div>
        <div class="fic-row" style="margin:0">
          <label>Branch<select id="fic-branch"><option value="">All branches</option></select></label>
          <button type="button" class="fic-btn" id="fic-refresh">↻ Refresh</button>
        </div>
      </div>
      <div class="fic-tabs" id="fic-tabs">${this.TABS.map(([id, l]) => `<button type="button" class="fic-tab${id === this.tab ? ' active' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>
      <div id="fic-body"><p class="fic-muted">Loading…</p></div>
    </div>`;
    el.querySelector('#fic-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.go(b.dataset.tab);
    });
    el.querySelector('#fic-refresh').onclick = () => this.loadMeta().then(() => this.renderTab());
    el.querySelector('#fic-branch').onchange = (e) => { this.f.branch_id = e.target.value; this.renderTab(); };
    const body = el.querySelector('#fic-body');
    body.addEventListener('click', (e) => this.onClick(e));
    body.addEventListener('change', (e) => this.onChange(e));
    await this.loadMeta();
    await this.renderTab();
  },

  async loadMeta() {
    const m = await this.api(API.finMeta(), 'Could not load Financial Intelligence');
    if (!m) { this.body().innerHTML = '<div class="fic-err">Financial Intelligence is not available for your account (permission "Financial — View Financial Intelligence" is required).</div>'; return; }
    this.meta = m;
    const [y, mo] = m.today.split('-').map(Number);
    if (!this.mon) this.mon = { year: y, month: mo };
    if (!this.year) this.year = y;
    const sel = this.el.querySelector('#fic-branch');
    sel.innerHTML = `<option value="">All branches</option>${(m.branches || []).map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('')}`;
    if (m.locked_branch_id) { this.f.branch_id = String(m.locked_branch_id); sel.disabled = true; }
    sel.value = this.f.branch_id;
  },

  body() { return this.el.querySelector('#fic-body'); },

  go(tab) {
    this.tab = tab;
    this.el.querySelectorAll('.fic-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    return this.renderTab();
  },

  async renderTab() {
    if (!this.meta) return;
    const body = this.body();
    body.innerHTML = '<p class="fic-muted">Loading…</p>';
    const fn = {
      dashboard: this.tDashboard, daily: this.tDaily, monthly: this.tMonthly, annual: this.tAnnual, allocation: this.tAllocation,
      expenses: this.tExpenses, employees: this.tEmployees, products: this.tProducts, breakeven: this.tBreakEven, branches: this.tBranches,
      reports: this.tReports, ai: this.tAi, settings: this.tSettings
    }[this.tab];
    try { body.innerHTML = await fn.call(this); } catch (err) {
      console.error('Financial Intelligence tab failed', err);
      body.innerHTML = `<div class="fic-err">${this.esc(err?.message || 'Failed to load')}</div>`;
    }
  },

  /* ─────────── shared building blocks ─────────── */

  qf() {
    const f = { branch_id: this.f.branch_id || '' };
    if (this.f.preset === 'custom') { f.from = this.f.from; f.to = this.f.to || this.f.from; } else f.preset = this.f.preset;
    return f;
  },

  rangeBar(range) {
    const today = this.meta.today;
    return `<div class="fic-row">
      <label>Period<select data-f="preset">${this.PRESETS.map(([v, l]) => `<option value="${v}"${v === this.f.preset ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${this.f.preset === 'custom' ? `<label>From<input type="date" data-f="from" value="${this.esc(this.f.from || today)}" max="${today}"></label>
      <label>To<input type="date" data-f="to" value="${this.esc(this.f.to || this.f.from || today)}" max="${today}"></label>
      <button type="button" class="fic-btn" data-act="apply-range">Apply</button>` : ''}
      ${range ? `<span class="fic-muted">${this.esc(range.label || '')} · ${this.esc(range.from)} to ${this.esc(range.to)}</span>` : ''}
    </div>`;
  },

  kpi(label, value, sub, cls) {
    return `<div class="fic-kpi${cls ? ` ${cls}` : ''}"><div class="l">${this.esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  },

  table(head, rows, opts = {}) {
    if (!rows.length) return `<div class="fic-empty">${this.esc(opts.empty || 'NO DATA AVAILABLE FOR THIS PERIOD')}</div>`;
    const numCols = new Set(opts.num || []);
    return `<table class="fic-table"><thead><tr>${head.map((h, i) => `<th${numCols.has(i) ? ' class="num"' : ''}>${this.esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => {
      const cells = Array.isArray(r) ? r : r.cells;
      const attrs = Array.isArray(r) ? '' : (r.attrs || '');
      return `<tr ${attrs}>${cells.map((c, i) => `<td${numCols.has(i) ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table>`;
  },

  validation(list) {
    return (list || []).map((v) => (v.exceeds
      ? `<div class="fic-err">⚠ ${this.esc(v.scope)}: ${this.esc(v.message)} (total ${v.total_pct}%)</div>`
      : `<div class="fic-muted">${this.esc(v.scope)}: allocations total ${v.total_pct}%. ${this.esc(v.message)}</div>`)).join('');
  },

  allocBlock(s, title = 'Allocation of revenue') {
    if (!s) return '';
    const rows = (s.allocations || []).map((a) => [this.esc(a.name), this.esc(this.KIND_LABELS[a.kind] || a.kind), this.pct(a.effective_pct), this.R(a.amount)]);
    return `<div class="fic-card"><h4>${this.esc(title)}</h4>
      <div class="fic-grid">
        ${this.kpi('Allocation base', this.R(s.allocation_base), this.meta.settings.exclude_tax || this.meta.settings.exclude_delivery_fees ? 'Net sales less excluded tax / delivery fees' : 'Net sales (gross − refunds)')}
        ${this.kpi('Allocated costs', this.R(s.allocated_costs))}
        ${this.kpi('Operating contribution', this.R(s.operating_contribution), 'Base − allocated costs', s.operating_contribution < 0 ? 'bad' : '')}
        ${this.kpi('Owner allocation', this.R(s.owner_allocation))}
        ${this.kpi('Savings / reserve', this.R(s.savings_allocation))}
        ${this.kpi('Unallocated Amount', this.R(s.unallocated), 'Base not assigned to any category', s.unallocated < 0 ? 'bad' : '')}
      </div>
      ${this.table(['Category', 'Type', 'Effective %', 'Amount'], rows, { num: [2, 3], empty: 'No allocation categories configured — set them up under Cost Allocation.' })}
    </div>`;
  },

  salesKpis(s) {
    return `<div class="fic-grid">
      ${this.kpi('Orders', this.n(s.orders))}
      ${this.kpi('Items sold', this.n(s.quantity))}
      ${this.kpi('Gross sales', this.R(s.gross_sales))}
      ${this.kpi('Discounts', this.R(s.discounts))}
      ${this.kpi('Refunds', this.R(s.refunds), s.refund_count ? `${s.refund_count} return(s)` : '')}
      ${this.kpi('Net sales', this.R(s.net_sales), 'Gross − refunds')}
      ${this.kpi('VAT / tax', this.R(s.tax))}
      ${this.kpi('Delivery fees', this.R(s.delivery_fees))}
      ${this.kpi('Average order', this.R(s.average_order))}
      ${this.kpi('Recorded stock cost', this.R(s.actual?.recorded_stock_cost), s.actual?.stock_cost_coverage_pct == null ? '' : `Buying price captured on ${s.actual.stock_cost_coverage_pct}% of item revenue`)}
      ${this.kpi('Recorded expenses', this.R(s.actual?.expenses))}
      ${this.kpi('Net sales − recorded costs', this.R(s.actual?.net_sales_less_recorded_costs), 'Not an accounting profit figure', (s.actual?.net_sales_less_recorded_costs || 0) < 0 ? 'bad' : '')}
    </div>`;
  },

  periodHead() { return ['Orders', 'Items', 'Gross', 'Refunds', 'Net sales', 'Allocated costs', 'Contribution', 'Unallocated', 'Stock cost', 'Expenses']; },
  periodCells(r) {
    return [this.n(r.orders), this.n(r.quantity), this.R(r.gross_sales), this.R(r.refunds), this.R(r.net_sales), this.R(r.allocated_costs),
      this.R(r.operating_contribution), this.R(r.unallocated), this.R(r.recorded_stock_cost), this.R(r.expenses)];
  },
  pickTotal(t) {
    return { ...t, recorded_stock_cost: t.actual?.recorded_stock_cost, expenses: t.actual?.expenses };
  },

  modal(title, html) {
    const m = document.createElement('div');
    m.className = 'fic-modal';
    m.innerHTML = `<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">${this.esc(title)}</h3><button type="button" class="fic-btn sm" data-close>✕ Close</button></div>${html}</div>`;
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
    document.body.appendChild(m);
    return m;
  },

  /* ─────────── events ─────────── */

  onChange(e) {
    const t = e.target;
    if (t.dataset.f) {
      this.f[t.dataset.f] = t.value;
      if (t.dataset.f === 'preset') this.renderTab();
      return;
    }
    if (t.id === 'fic-day-preset') { this.dayF.preset = t.value; this.renderTab(); return; }
    if (t.id === 'fic-day-date') { this.dayF.date = t.value; this.renderTab(); return; }
    if (t.id === 'fic-mon-y' || t.id === 'fic-mon-m') {
      this.mon = { year: Number(this.el.querySelector('#fic-mon-y').value), month: Number(this.el.querySelector('#fic-mon-m').value) };
      this.renderTab(); return;
    }
    if (t.id === 'fic-year') { this.year = Number(t.value); this.renderTab(); return; }
    if (t.id === 'fic-be-months') { this.beMonths = t.value; this.renderTab(); return; }
    if (t.id === 'fic-rep-type') { this.repType = t.value; this.renderTab(); return; }
    if (t.dataset.act === 'emp-include') { this.toggleEmployee(Number(t.dataset.id), t.checked); return; }
    if (t.dataset.act === 'fixed-cat') { this.toggleFixed(t.dataset.cat, t.checked); }
  },

  async onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    if (b.tagName === 'A') e.preventDefault();
    const a = b.dataset.act;
    const id = Number(b.dataset.id);
    switch (a) {
      case 'apply-range': this.renderTab(); break;
      case 'day': this.dayF = { preset: 'custom', date: b.dataset.date }; this.go('daily'); break;
      case 'month': this.mon = { year: Number(b.dataset.y), month: Number(b.dataset.m) }; this.go('monthly'); break;
      case 'year': this.year = Number(b.dataset.y); this.go('annual'); break;
      case 'sales': this.showSales(b.dataset.from, b.dataset.to); break;
      case 'sale': this.showSale(id); break;
      case 'cat-new': this.openCategoryForm({}); break;
      case 'cat-edit': { const c = (this._cats || []).find((x) => x.id === id); if (c) this.openCategoryForm(c); break; }
      case 'cat-rate': this.changeRate(id); break;
      case 'cat-toggle': this.toggleCategory(id, b.dataset.on === '1'); break;
      case 'cat-history': this.showRateHistory(id); break;
      case 'pw-save': this.savePlanned(); break;
      case 'pw-del': this.deletePlanned(id); break;
      case 'scenario': this.runScenario(); break;
      case 'scenario-clear': this.scenario = null; this.renderTab(); break;
      case 'rep-gen': this.generateReport(); break;
      case 'rep-open': this.openReport(id); break;
      case 'rep-pdf': this.download(id, 'pdf'); break;
      case 'rep-xlsx': this.download(id, 'xlsx'); break;
      case 'rep-print': this.printReport(id); break;
      case 'rep-wa': this.shareWhatsApp(id); break;
      case 'ai-ask': this.askAi(); break;
      case 'ai-q': { const ta = this.el.querySelector('#fic-ai-q'); if (ta) ta.value = b.dataset.q; this.askAi(); break; }
      case 'ai-approve': this.approveAi(Number(b.dataset.log), Number(b.dataset.idx), b.dataset.text); break;
      case 'settings-save': this.saveSettings(); break;
      default: break;
    }
  },

  /* ─────────── Dashboard ─────────── */

  async tDashboard() {
    const d = await this.api(API.finDashboard({ branch_id: this.f.branch_id }));
    if (!d) return '<div class="fic-err">Could not load the dashboard.</div>';
    const t = d.today_summary; const m = d.month; const y = d.year;
    const sal = d.salary; const be = d.break_even;
    const best = (d.best_sellers || []).map((p) => [this.esc(p.name), this.n(p.quantity), this.R(p.revenue), this.R(p.contribution)]);
    const br = (d.branches || []).map((b) => [this.esc(b.branch), this.n(b.orders), this.n(b.quantity), this.R(b.net_sales), this.R(b.operating_contribution)]);
    return `${d.has_data ? '' : '<div class="fic-empty">NO DATA AVAILABLE FOR THIS PERIOD — no sales, refunds or expenses recorded this year.</div>'}
      ${(d.validation || []).some((v) => v.exceeds) ? this.validation(d.validation.filter((v) => v.exceeds)) : ''}
      <div class="fic-card"><h4>Today (${this.esc(d.today)})</h4><div class="fic-grid">
        ${this.kpi('Net sales', this.R(t.net_sales), `<a href="#" data-act="day" data-date="${d.today}">Open daily performance →</a>`)}
        ${this.kpi('Orders', this.n(t.orders))}
        ${this.kpi('Items sold', this.n(t.quantity))}
        ${this.kpi('Allocated costs', this.R(t.allocated_costs))}
        ${this.kpi('Operating contribution', this.R(t.operating_contribution), '', t.operating_contribution < 0 ? 'bad' : '')}
      </div></div>
      <div class="fic-card"><h4>This month (${this.esc(m.from)} to ${this.esc(m.to)})</h4><div class="fic-grid">
        ${this.kpi('Net sales', this.R(m.net_sales))}
        ${this.kpi('Orders', this.n(m.orders))}
        ${this.kpi('Allocated costs', this.R(m.allocated_costs))}
        ${this.kpi('Operating contribution', this.R(m.operating_contribution), '', m.operating_contribution < 0 ? 'bad' : '')}
        ${this.kpi('Owner allocation', this.R(m.owner_allocation))}
        ${this.kpi('Unallocated Amount', this.R(m.unallocated))}
        ${this.kpi('Recorded stock cost', this.R(m.recorded_stock_cost))}
        ${this.kpi('Recorded expenses', this.R(m.expenses))}
      </div></div>
      <div class="fic-card"><h4>This year (${this.esc(y.from)} to ${this.esc(y.to)})</h4><div class="fic-grid">
        ${this.kpi('Net sales', this.R(y.net_sales))}
        ${this.kpi('Orders', this.n(y.orders))}
        ${this.kpi('Allocated costs', this.R(y.allocated_costs))}
        ${this.kpi('Operating contribution', this.R(y.operating_contribution))}
      </div></div>
      <div class="fic-cards">
        <div class="fic-card"><h4>Salary coverage (this month)</h4>${sal
          ? `<div class="fic-grid">${this.kpi('Coverage', this.pct(sal.coverage_pct), sal.status === 'shortfall' ? 'Shortfall' : sal.status === 'covered' ? 'Covered' : 'No salary requirement', sal.status === 'shortfall' ? 'bad' : sal.status === 'covered' ? 'good' : '')}
             ${this.kpi('Required', this.R(sal.required))}${this.kpi('Allocated', this.R(sal.allocated))}</div>`
          : '<div class="fic-muted">Requires the "Financial — Employees & salaries" permission.</div>'}</div>
        <div class="fic-card"><h4>Break-even (monthly revenue needed)</h4>${be
          ? `<div class="fic-grid">${this.kpi('Actual cost basis', this.R(be.actual))}${this.kpi('Allocation basis', this.R(be.allocation))}</div>${(be.insufficient || []).map((x) => `<div class="fic-warn">${this.esc(x)}</div>`).join('')}`
          : '<div class="fic-muted">Not available.</div>'}</div>
      </div>
      <div class="fic-cards">
        <div class="fic-card"><h4>Best sellers this month</h4>${this.table(['Product', 'Qty', 'Revenue', 'Contribution'], best, { num: [1, 2, 3] })}</div>
        <div class="fic-card"><h4>Branches this year</h4>${this.table(['Branch', 'Orders', 'Items', 'Net sales', 'Contribution'], br, { num: [1, 2, 3, 4] })}</div>
      </div>`;
  },

  /* ─────────── Daily ─────────── */

  async tDaily() {
    const q = { branch_id: this.f.branch_id };
    if (this.dayF.preset === 'custom') q.date = this.dayF.date || this.meta.today; else q.preset = this.dayF.preset;
    const d = await this.api(API.finDaily(q));
    if (!d) return '<div class="fic-err">Could not load daily performance.</div>';
    const s = d.summary;
    const bar = `<div class="fic-row">
      <label>Day<select id="fic-day-preset">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['custom', 'Custom date']].map(([v, l]) => `<option value="${v}"${v === this.dayF.preset ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${this.dayF.preset === 'custom' ? `<label>Date<input type="date" id="fic-day-date" value="${this.esc(this.dayF.date || this.meta.today)}" max="${this.meta.today}"></label>` : ''}
      <span class="fic-muted">${this.esc(d.range.from)}</span>
      <button type="button" class="fic-btn" data-act="sales" data-from="${d.range.from}" data-to="${d.range.to}">🔎 View individual sales</button>
    </div>`;
    if (d.empty_message && !s.has_data) return `${bar}<div class="fic-empty">${this.esc(d.empty_message)}</div>`;
    const prods = d.products.map((p) => [this.esc(p.name), this.n(p.quantity), this.R(p.revenue), this.R(p.allocated_costs), this.R(p.contribution)]);
    const pays = d.payments.map((p) => [this.esc(p.method), this.n(p.orders), this.R(p.amount)]);
    const brs = d.branches.map((b) => [this.esc(b.branch), this.n(b.orders), this.n(b.quantity), this.R(b.net_sales), this.R(b.operating_contribution)]);
    return `${bar}${d.empty_message ? `<div class="fic-warn">${this.esc(d.empty_message)}</div>` : ''}
      ${this.salesKpis(s)}${this.allocBlock(s)}
      <div class="fic-cards">
        <div class="fic-card"><h4>Products sold</h4>${this.table(['Product', 'Qty', 'Revenue', 'Allocated costs', 'Contribution'], prods, { num: [1, 2, 3, 4] })}</div>
        <div class="fic-card"><h4>Payment methods</h4>${this.table(['Method', 'Orders', 'Amount'], pays, { num: [1, 2] })}</div>
        <div class="fic-card"><h4>Branches</h4>${this.table(['Branch', 'Orders', 'Items', 'Net sales', 'Contribution'], brs, { num: [1, 2, 3, 4] })}</div>
      </div>`;
  },

  async showSales(from, to) {
    const d = await this.api(API.finSales({ from, to, branch_id: this.f.branch_id }));
    if (!d) return;
    const rows = d.sales.map((s) => ({ attrs: `class="click" data-act="sale" data-id="${s.id}"`, cells: [this.esc(s.receipt_number || `#${s.id}`), this.esc(String(s.sold_at).replace('T', ' ').slice(0, 19)), this.esc(s.branch), this.n(s.quantity), this.R(s.discount), this.R(s.total), this.esc(s.status)] }));
    const m = this.modal(`Sales ${from === to ? from : `${from} to ${to}`}`, `${d.truncated ? '<div class="fic-warn">Showing the first 500 sales.</div>' : ''}
      ${this.table(['Receipt', 'Time', 'Branch', 'Items', 'Discount', 'Total', 'Status'], rows, { num: [3, 4, 5], empty: 'No sales on this day.' })}`);
    m.addEventListener('click', (e) => { const r = e.target.closest('[data-act="sale"]'); if (r) this.showSale(Number(r.dataset.id)); });
  },

  async showSale(id) {
    const s = await this.api(API.finSaleDetail(id));
    if (!s) return;
    this.modal(`Sale ${s.receipt_number || `#${s.id}`}`, `<div class="fic-muted">${this.esc(String(s.sold_at).replace('T', ' ').slice(0, 19))} · ${this.esc(s.status)}</div>
      ${this.table(['Item', 'Qty', 'Unit price', 'Total'], s.items.map((i) => [this.esc(i.product_name), this.n(i.quantity), this.R(i.unit_price), this.R(i.total)]), { num: [1, 2, 3], empty: 'No items' })}
      <div class="fic-grid" style="margin-top:8px">${this.kpi('Discount', this.R(s.discount))}${this.kpi('Tax', this.R(s.tax_amount))}${this.kpi('Total', this.R(s.total))}</div>
      ${this.table(['Payment method', 'Amount'], s.payments.map((p) => [this.esc(p.method), this.R(p.amount)]), { num: [1], empty: 'No payment lines recorded' })}`);
  },

  /* ─────────── Monthly ─────────── */

  yearOptions(selected) {
    const ty = Number(this.meta.today.slice(0, 4));
    const years = [...new Set([...(this.meta.years || []), ty])].sort((a, b) => b - a);
    return years.map((y) => `<option value="${y}"${y === selected ? ' selected' : ''}>${y}</option>`).join('');
  },

  async tMonthly() {
    const m = await this.api(API.finMonthly({ year: this.mon.year, month: this.mon.month, branch_id: this.f.branch_id }));
    if (!m) return '<div class="fic-err">Could not load the month.</div>';
    const rows = m.days.map((d) => (d.no_sales
      ? { attrs: `class="click none" data-act="day" data-date="${d.date}"`, cells: [this.esc(d.date), this.esc(d.day_name), '0 sales / No sales', '', '', d.refunds ? this.R(d.refunds) : '', '', '', '', '', '', d.expenses ? this.R(d.expenses) : ''] }
      : { attrs: `class="click" data-act="day" data-date="${d.date}"`, cells: [this.esc(d.date), this.esc(d.day_name), ...this.periodCells(d)] }));
    rows.push({ attrs: 'class="total"', cells: ['MONTH TOTAL', `${m.days_in_month} days`, ...this.periodCells(this.pickTotal(m.total))] });
    return `<div class="fic-row">
        <label>Year<select id="fic-mon-y">${this.yearOptions(m.year)}</select></label>
        <label>Month<select id="fic-mon-m">${this.MONTHS.map((n, i) => `<option value="${i + 1}"${i + 1 === m.month ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="fic-muted">${this.esc(m.month_name)} ${m.year} · ${m.days_in_month} days · click a day to drill down</span>
      </div>
      ${(m.validation || []).some((v) => v.exceeds) ? this.validation(m.validation.filter((v) => v.exceeds)) : ''}
      ${m.total.has_data ? '' : '<div class="fic-empty">NO DATA AVAILABLE FOR THIS PERIOD</div>'}
      <div class="fic-card">${this.table(['Date', 'Day', ...this.periodHead()], rows, { num: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })}</div>
      ${this.allocBlock(m.total, `Allocation for ${m.month_name} ${m.year}`)}`;
  },

  /* ─────────── Annual + multi-year ─────────── */

  async tAnnual() {
    const [a, h] = await Promise.all([
      this.api(API.finAnnual({ year: this.year, branch_id: this.f.branch_id })),
      this.api(API.finHistory({ branch_id: this.f.branch_id }))
    ]);
    if (!a) return '<div class="fic-err">Could not load the year.</div>';
    const rows = a.months.map((m) => (m.no_data
      ? { attrs: `class="click none" data-act="month" data-y="${a.year}" data-m="${m.month}"`, cells: [this.esc(m.month_name), 'NO DATA', '', '', '', '', '', '', '', '', ''] }
      : { attrs: `class="click" data-act="month" data-y="${a.year}" data-m="${m.month}"`, cells: [this.esc(m.month_name), ...this.periodCells(m)] }));
    rows.push({ attrs: 'class="total"', cells: ['YEAR TOTAL', ...this.periodCells(this.pickTotal(a.total))] });
    let hist = '';
    if (h) {
      if (!h.years.length) hist = `<div class="fic-empty">${this.esc(h.empty_message || 'NO DATA AVAILABLE')}</div>`;
      else {
        const hr = h.years.map((y) => (y.no_data
          ? { attrs: `class="click none" data-act="year" data-y="${y.year}"`, cells: [String(y.year), 'NO DATA', '', '', '', '', '', '', '', '', ''] }
          : { attrs: `class="click" data-act="year" data-y="${y.year}"`, cells: [String(y.year), ...this.periodCells(y)] }));
        hr.push({ attrs: 'class="total"', cells: ['ALL YEARS TOTAL', ...this.periodCells(this.pickTotal(h.total))] });
        hist = this.table(['Year', ...this.periodHead()], hr, { num: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
      }
    }
    return `<div class="fic-row">
        <label>Year<select id="fic-year">${this.yearOptions(a.year)}</select></label>
        <span class="fic-muted">January – December ${a.year} · click a month to drill down (Year → Month → Day → Sale)</span>
      </div>
      ${a.total.has_data ? '' : '<div class="fic-empty">NO DATA AVAILABLE FOR THIS PERIOD</div>'}
      <div class="fic-card">${this.table(['Month', ...this.periodHead()], rows, { num: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })}</div>
      ${this.allocBlock(a.total, `Allocation for ${a.year}`)}
      <div class="fic-card"><h4>Multi-year history</h4><div class="fic-muted" style="margin-bottom:6px">Every year from the first recorded sale. Click a year to open it.</div>${hist}</div>`;
  },

  /* ─────────── Cost allocation ─────────── */

  branchName(id) {
    if (id == null) return 'All branches';
    return this.meta.branches.find((b) => b.id === Number(id))?.name || `Branch #${id}`;
  },

  async tAllocation() {
    const o = await this.api(API.finAllocation(this.qf()));
    if (!o) return '<div class="fic-err">Could not load the allocation.</div>';
    this._cats = o.categories;
    const manage = this.can('fin_manage');
    const amounts = new Map((o.summary.allocations || []).map((a) => [a.id, a]));
    const rows = o.categories.map((c) => [
      `<b>${this.esc(c.name)}</b>${c.description ? `<div class="fic-muted">${this.esc(c.description)}</div>` : ''}`,
      this.esc(this.KIND_LABELS[c.kind] || c.kind), this.esc(this.branchName(c.branch_id)),
      `${c.current_pct}%`, this.esc(c.current_effective_from || '—'),
      c.upcoming.length ? c.upcoming.map((u) => `${u.pct}% from ${this.esc(u.effective_from)}`).join('<br>') : '—',
      `<span class="fic-pill ${c.is_active ? 'on' : 'off'}">${c.is_active ? 'Active' : 'Inactive'}</span>`,
      this.R(amounts.get(c.id)?.amount ?? 0),
      `<button type="button" class="fic-btn sm" data-act="cat-history" data-id="${c.id}">History</button>${manage ? ` <button type="button" class="fic-btn sm" data-act="cat-edit" data-id="${c.id}">Edit</button> <button type="button" class="fic-btn sm" data-act="cat-rate" data-id="${c.id}">Change %</button> <button type="button" class="fic-btn sm" data-act="cat-toggle" data-id="${c.id}" data-on="${c.is_active ? '0' : '1'}">${c.is_active ? 'Deactivate' : 'Activate'}</button>` : ''}`
    ]);
    return `${this.rangeBar(o.range)}
      ${this.validation(o.validation)}
      <div class="fic-card"><div style="display:flex;justify-content:space-between;align-items:center"><h4>Allocation categories</h4>${manage ? '<button type="button" class="fic-btn p" data-act="cat-new">+ Add category</button>' : '<span class="fic-muted">View only — managing allocations needs "Financial — Manage allocations".</span>'}</div>
        <div class="fic-muted" style="margin-bottom:6px">Each category takes a percentage of the allocation base (net sales). Percentage changes apply from their effective date, so earlier periods keep the rate that applied then. "Owner" and "Savings" are distributions and are not counted as operating costs.</div>
        ${this.table(['Category', 'Type', 'Branch', 'Current %', 'Since', 'Scheduled', 'Status', 'Amount (period)', ''], rows, { num: [3, 7], empty: 'No allocation categories yet. Add your first category (for example Stock 40%, Salaries 25%, Rent 10%).' })}
      </div>
      ${this.allocBlock(o.summary, `Allocation result · ${o.range.label}`)}`;
  },

  /** Dialog with its own Save/Cancel; the allocation tab is only reloaded after a successful save. */
  formModal(title, html, onSave, saveLabel = 'Save') {
    const m = this.modal(title, `<form data-fic-form>${html}<div class="fic-row" style="margin-top:10px"><button type="submit" class="fic-btn p">${this.esc(saveLabel)}</button><button type="button" class="fic-btn" data-close>Cancel</button></div><div class="fic-err" data-form-err style="display:none"></div></form>`);
    const form = m.querySelector('[data-fic-form]');
    const errBox = m.querySelector('[data-form-err]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      errBox.style.display = 'none';
      try {
        const err = await onSave((sel) => m.querySelector(sel)?.value ?? '');
        if (err) { errBox.textContent = err; errBox.style.display = ''; return; }
        m.remove();
        await this.renderTab();
      } catch (ex) {
        errBox.textContent = ex?.message || 'Save failed';
        errBox.style.display = '';
      } finally { btn.disabled = false; }
    });
    setTimeout(() => form.querySelector('input, select')?.focus(), 30);
    return m;
  },

  /** Returns an error message, or null after a successful call. */
  async callFin(promise) {
    let r;
    try { r = await promise; } catch (e) { return e?.message || 'Request failed'; }
    if (!r || r.success === false) return (r && r.error) || 'Request failed';
    return null;
  },

  openCategoryForm(c) {
    const isNew = !c.id;
    this.formModal(isNew ? 'New allocation category' : `Edit ${c.name}`, this.categoryForm(c), async (v) => {
      const d = { id: c.id || undefined, name: v('#fc-name').trim(), kind: v('#fc-kind'), description: v('#fc-desc'), notes: v('#fc-notes'), branch_id: v('#fc-branch'), effective_from: v('#fc-eff') };
      if (!d.name) return 'Category name is required';
      const pct = v('#fc-pct');
      if (isNew && pct === '') return 'Enter a percentage';
      if (pct !== '' && (!(Number(pct) >= 0) || Number(pct) > 100)) return 'Percentage must be between 0 and 100';
      if (isNew || (pct !== '' && Number(pct) !== Number(c.current_pct))) d.pct = pct;
      const err = await this.callFin(API.finSaveCategory(d));
      if (!err) this.toast(isNew ? 'Allocation category added' : 'Allocation category saved', 'success');
      return err;
    });
  },

  categoryForm(c) {
    const isNew = !c.id;
    return `<div>
      <div class="fic-row">
        <label>Name<input id="fc-name" value="${this.esc(c.name || '')}" maxlength="80"></label>
        <label>Type<select id="fc-kind">${(this.meta.kinds || []).map((k) => `<option value="${k}"${k === (c.kind || 'other') ? ' selected' : ''}>${this.esc(this.KIND_LABELS[k] || k)}</option>`).join('')}</select></label>
        <label>Percentage %<input id="fc-pct" type="number" min="0" max="100" step="0.01" value="${isNew ? '' : this.esc(c.current_pct)}"></label>
        <label>Effective from<input id="fc-eff" type="date" value="${this.meta.today}"></label>
        <label>Branch<select id="fc-branch"><option value="">All branches</option>${this.meta.branches.map((b) => `<option value="${b.id}"${b.id === c.branch_id ? ' selected' : ''}>${this.esc(b.name)}</option>`).join('')}</select></label>
      </div>
      <div class="fic-row">
        <label style="flex:1">Description<input id="fc-desc" value="${this.esc(c.description || '')}" maxlength="300"></label>
        <label style="flex:1">Notes<input id="fc-notes" value="${this.esc(c.notes || '')}" maxlength="500"></label>
      </div>
      ${isNew ? '' : '<div class="fic-muted">Changing the percentage here records a new rate from the effective date; earlier dates keep their previous rate.</div>'}
    </div>`;
  },

  changeRate(id) {
    const c = (this._cats || []).find((x) => x.id === id);
    if (!c) return;
    this.formModal(`Change % — ${c.name}`, `<div class="fic-row">
        <label>New percentage %<input id="fr-pct" type="number" min="0" max="100" step="0.01" value="${this.esc(c.current_pct)}" required></label>
        <label>Effective from<input id="fr-eff" type="date" value="${this.meta.today}" required></label>
        <label style="flex:1">Reason / note<input id="fr-note" maxlength="200"></label>
      </div><div class="fic-muted">Currently ${this.esc(c.current_pct)}%. Earlier dates keep the old percentage.</div>`, async (v) => {
      const pct = v('#fr-pct');
      const eff = v('#fr-eff') || this.meta.today;
      if (pct === '' || !(Number(pct) >= 0) || Number(pct) > 100) return 'Percentage must be between 0 and 100';
      const err = await this.callFin(API.finSetRate(id, { pct, effective_from: eff, note: v('#fr-note') }));
      if (!err) this.toast(`${c.name}: ${pct}% from ${eff}`, 'success');
      return err;
    }, 'Save percentage');
  },

  toggleCategory(id, on) {
    const c = (this._cats || []).find((x) => x.id === id);
    if (!c) return;
    this.formModal(`${on ? 'Activate' : 'Deactivate'} — ${c.name}`, `<div class="fic-row">
        <label>Effective from<input id="ft-eff" type="date" value="${this.meta.today}" required></label>
      </div><div class="fic-muted">${on ? 'The category will be included in allocations' : 'The category will no longer take a share of the allocation base'} from this date. Earlier periods are not affected.</div>`, async (v) => {
      const eff = v('#ft-eff') || this.meta.today;
      const err = await this.callFin(API.finSetCategoryActive(id, on, eff));
      if (!err) this.toast(`${c.name} ${on ? 'activated' : 'deactivated'} from ${eff}`, 'success');
      return err;
    }, on ? 'Activate' : 'Deactivate');
  },

  showRateHistory(id) {
    const c = (this._cats || []).find((x) => x.id === id);
    if (!c) return;
    const manage = this.can('fin_manage');
    const m = this.modal(`Rate history — ${c.name}`, this.table(['Effective from', 'Percentage', 'Status', 'Note', 'Recorded', ''], c.history.map((h) => [
      this.esc(h.effective_from), `${h.pct}%`, h.is_active ? 'Active' : 'Inactive', this.esc(h.note || ''), this.esc(String(h.created_at || '').slice(0, 16)),
      manage && h.effective_from > this.meta.today ? `<button type="button" class="fic-btn sm" data-del-rate="${h.id}">Remove</button>` : ''
    ]), { empty: 'No rates recorded' }));
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del-rate]');
      if (!b || !window.confirm('Remove this scheduled rate change?')) return;
      if (await this.api(API.finDeleteRate(Number(b.dataset.delRate)))) { m.remove(); this.renderTab(); }
    });
  },

  /* ─────────── Expense categories ─────────── */

  async tExpenses() {
    const o = await this.api(API.finAllocation(this.qf()));
    if (!o) return '<div class="fic-err">Could not load expenses.</div>';
    const a = o.summary.actual;
    const fixed = new Set((this.meta.settings.fixed_expense_categories || []).map((x) => String(x).toLowerCase()));
    const manage = this.can('fin_manage');
    const rows = a.expenses_by_category.map((e) => [
      this.esc(e.category), this.R(e.amount), a.expenses > 0 ? this.pct(Math.round((e.amount / a.expenses) * 1000) / 10) : '—',
      o.summary.net_sales > 0 ? this.pct(Math.round((e.amount / o.summary.net_sales) * 1000) / 10) : '—',
      `<input type="checkbox" data-act="fixed-cat" data-cat="${this.esc(e.category)}"${fixed.has(e.category) ? ' checked' : ''}${manage ? '' : ' disabled'}>`
    ]);
    const known = new Set(a.expenses_by_category.map((e) => e.category));
    const otherCats = (this.meta.expense_categories || []).filter((c) => !known.has(c));
    return `${this.rangeBar(o.range)}
      <div class="fic-grid">
        ${this.kpi('Net sales', this.R(o.summary.net_sales))}
        ${this.kpi('Recorded expenses', this.R(a.expenses))}
        ${this.kpi('Recorded stock cost', this.R(a.recorded_stock_cost), a.stock_cost_coverage_pct == null ? '' : `Buying price on ${a.stock_cost_coverage_pct}% of item revenue`)}
        ${this.kpi('Net sales − recorded costs', this.R(a.net_sales_less_recorded_costs), 'Not an accounting profit figure', a.net_sales_less_recorded_costs < 0 ? 'bad' : '')}
      </div>
      <div class="fic-card"><h4>Actual expenses by category</h4>
        <div class="fic-muted" style="margin-bottom:6px">From the existing Expenses records. Tick "Fixed" for categories that are fixed monthly costs (used by Break-Even Analysis).</div>
        ${this.table(['Category', 'Amount', '% of expenses', '% of net sales', 'Fixed'], rows, { num: [1, 2, 3] })}
        ${otherCats.length ? `<div class="fic-muted" style="margin-top:6px">Categories with no expenses in this period: ${otherCats.map((c) => `${this.esc(c)}${fixed.has(c) ? ' (fixed)' : ''}`).join(', ')}</div>` : ''}
      </div>
      <div class="fic-card"><h4>Planned allocation vs actual</h4>
        ${this.table(['Allocation category', 'Type', 'Allocated', 'Matching actual expenses'], (o.summary.allocations || []).map((x) => {
          const match = a.expenses_by_category.find((e) => e.category === String(x.name).toLowerCase() || e.category === x.kind);
          const actual = x.kind === 'stock' ? a.recorded_stock_cost : (match ? match.amount : null);
          return [this.esc(x.name), this.esc(this.KIND_LABELS[x.kind] || x.kind), this.R(x.amount), actual == null ? '<span class="fic-muted">No matching expense category</span>' : this.R(actual)];
        }), { num: [2, 3], empty: 'No allocation categories configured.' })}
      </div>`;
  },

  async toggleFixed(cat, on) {
    const set = new Set((this.meta.settings.fixed_expense_categories || []).map((x) => String(x).toLowerCase()));
    if (on) set.add(cat); else set.delete(cat);
    const r = await this.api(API.finSaveSettings({ fixed_expense_categories: [...set] }));
    if (r) { this.meta.settings = r; this.toast('Fixed cost categories updated', 'success'); }
  },

  /* ─────────── Employees & salaries ─────────── */

  async tEmployees() {
    if (!this.can('fin_salaries')) return '<div class="fic-warn">Salary information needs the "Financial — Employees & salaries" permission.</div>';
    const e = await this.api(API.finEmployees(this.qf()));
    if (!e) return '<div class="fic-err">Could not load employees.</div>';
    const manage = this.can('fin_manage');
    const emp = e.employees.map((w) => [
      this.esc(w.name), this.esc(w.role), this.esc(w.branch || 'All'), this.esc(w.status), this.esc(w.frequency), this.R(w.salary), this.R(w.allowances),
      `${this.R(w.monthly_cost)}${w.frequency_known ? '' : ' <span class="fic-muted">(frequency unknown — treated as monthly)</span>'}`,
      w.active ? `<input type="checkbox" data-act="emp-include" data-id="${w.id}"${w.included ? ' checked' : ''}${manage ? '' : ' disabled'}>` : '<span class="fic-muted">Inactive</span>'
    ]);
    const planned = e.planned.map((w) => [this.esc(w.name), this.esc(w.role), this.esc(w.branch || 'All'), this.esc(w.frequency), this.R(w.salary), this.R(w.monthly_cost),
      w.active ? 'Yes' : 'No', manage ? `<button type="button" class="fic-btn sm" data-act="pw-del" data-id="${w.id}">Remove</button>` : '']);
    return `${this.rangeBar(e.affordability.range)}
      <div class="fic-grid">
        ${this.kpi('Included workers', this.n(e.included_count))}
        ${this.kpi('Monthly salary total', this.R(e.monthly_total))}
        ${this.kpi('Cost per employee', this.R(e.cost_per_employee), 'per month')}
      </div>
      ${e.unknown_frequency.length ? `<div class="fic-warn">Pay frequency not recognised for: ${e.unknown_frequency.map((x) => this.esc(x)).join(', ')} — treated as monthly.</div>` : ''}
      ${this.affordCard(this.scenario || e.affordability, !!this.scenario)}
      <div class="fic-card"><h4>Can I afford my workers? — scenario</h4>
        <div class="fic-muted" style="margin-bottom:6px">Calculates the requirement for a number of workers at a salary, against the salary allocation of the selected period. Nothing is saved.</div>
        <div class="fic-row">
          <label>Workers<input id="fs-workers" type="number" min="0" step="1" value="${this.esc(this.scenario?.scenario?.workers ?? '')}"></label>
          <label>Salary per worker (R)<input id="fs-salary" type="number" min="0" step="0.01" value="${this.esc(this.scenario?.scenario?.salary ?? '')}"></label>
          <label>Frequency<select id="fs-freq">${(this.meta.frequencies || []).map((f) => `<option value="${f}"${f === (this.scenario?.scenario?.frequency || 'monthly') ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
          <button type="button" class="fic-btn p" data-act="scenario">Calculate</button>
          ${this.scenario ? '<button type="button" class="fic-btn" data-act="scenario-clear">Back to actual staff</button>' : ''}
        </div>
      </div>
      <div class="fic-card"><h4>Employees (Staff & HR records)</h4>
        ${this.table(['Name', 'Position', 'Branch', 'Status', 'Pay type', 'Basic', 'Allowances', 'Monthly cost', 'Included'], emp, { num: [5, 6, 7], empty: 'No employees recorded in Staff & HR.' })}
      </div>
      <div class="fic-card"><h4>Planned positions</h4>
        <div class="fic-muted" style="margin-bottom:6px">Positions you plan to fill. These are planning entries only and are not employee records.</div>
        ${this.table(['Name / title', 'Role', 'Branch', 'Frequency', 'Salary', 'Monthly cost', 'Included', ''], planned, { num: [4, 5], empty: 'No planned positions.' })}
        ${manage ? `<div class="fic-row" style="margin-top:8px">
          <label>Name / title<input id="pw-name" maxlength="80"></label>
          <label>Role<input id="pw-role" maxlength="80"></label>
          <label>Salary (R)<input id="pw-salary" type="number" min="0" step="0.01"></label>
          <label>Frequency<select id="pw-freq">${(this.meta.frequencies || []).map((f) => `<option value="${f}">${f}</option>`).join('')}</select></label>
          <label>Branch<select id="pw-branch"><option value="">All branches</option>${this.meta.branches.map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('')}</select></label>
          <button type="button" class="fic-btn p" data-act="pw-save">Add planned position</button>
        </div>` : ''}
      </div>`;
  },

  affordCard(a, isScenario) {
    const status = a.status === 'covered' ? '<div class="fic-ok">✔ The salary allocation covers the salary requirement for this period.</div>'
      : a.status === 'shortfall' ? '<div class="fic-err">✖ The salary allocation does not cover the salary requirement for this period.</div>'
        : '<div class="fic-muted">No salary requirement to compare.</div>';
    const prods = (a.by_product || []).map((p) => [this.esc(p.name), this.R(p.price), this.n(p.units_needed)]);
    return `<div class="fic-card"><h4>${isScenario ? `Scenario: ${a.scenario.workers} worker(s) at ${this.R(a.scenario.salary)} ${this.esc(a.scenario.frequency)}` : 'Salary coverage'} · ${this.esc(a.range.from)} to ${this.esc(a.range.to)}</h4>
      ${status}
      <div class="fic-grid">
        ${this.kpi('Required salary amount', this.R(a.required_for_period), `${this.R(a.monthly_salary_requirement)} per month × ${a.months_in_period} month(s)`)}
        ${this.kpi('Salary allocation', this.R(a.salary_allocation), a.salary_allocation_pct == null ? '' : `${a.salary_allocation_pct}% of ${this.R(a.revenue)}`)}
        ${this.kpi('Difference', this.R(a.difference), '', a.difference < 0 ? 'bad' : 'good')}
        ${this.kpi('Coverage', this.pct(a.coverage_pct), '', a.coverage_pct != null && a.coverage_pct < 100 ? 'bad' : 'good')}
        ${this.kpi('Additional revenue needed', this.R(a.additional_revenue_needed))}
        ${this.kpi('Additional units / plates needed', this.n(a.additional_units_needed), a.average_item_price ? `at average item price ${this.R(a.average_item_price)}` : '')}
        ${this.kpi('Revenue needed to cover salaries', this.R(a.revenue_needed_to_cover))}
      </div>
      ${(a.insufficient || []).map((x) => `<div class="fic-warn">${this.esc(x)}</div>`).join('')}
      ${prods.length ? `<h4 style="margin-top:8px">Or sell more of a top product</h4>${this.table(['Product', 'Price', 'Extra units needed'], prods, { num: [1, 2] })}` : ''}
      <div class="fic-muted">${this.esc(a.note || '')}</div>
    </div>`;
  },

  async runScenario() {
    const v = (id) => this.el.querySelector(id)?.value ?? '';
    const workers = v('#fs-workers'); const salary = v('#fs-salary');
    if (workers === '' || salary === '') { this.toast('Enter the number of workers and the salary', 'error'); return; }
    const r = await this.api(API.finAffordability({ ...this.qf(), workers, salary, frequency: v('#fs-freq') }));
    if (r) { this.scenario = r; this.renderTab(); }
  },

  async toggleEmployee(id, included) {
    const r = await this.api(API.finSetEmployeeIncluded(id, included));
    if (r) { await this.loadMeta(); this.renderTab(); }
  },

  async savePlanned() {
    const v = (id) => this.el.querySelector(id)?.value ?? '';
    const r = await this.api(API.finSavePlannedWorker({ name: v('#pw-name'), role: v('#pw-role'), salary: v('#pw-salary'), frequency: v('#pw-freq'), branch_id: v('#pw-branch') }));
    if (r) { this.toast('Planned position added', 'success'); this.renderTab(); }
  },

  async deletePlanned(id) {
    if (!window.confirm('Remove this planned position?')) return;
    if (await this.api(API.finDeletePlannedWorker(id))) this.renderTab();
  },

  /* ─────────── Products ─────────── */

  async tProducts() {
    const p = await this.api(API.finProducts(this.qf()));
    if (!p) return '<div class="fic-err">Could not load products.</div>';
    const rows = p.products.map((x) => [
      this.esc(x.name), `${this.R(x.price)}${x.price_source === 'average sold' ? ' <span class="fic-muted">(avg)</span>' : ''}`, this.n(x.quantity), this.R(x.revenue), this.pct(x.revenue_share_pct),
      this.R(x.allocated_stock), this.R(x.allocated_salary), this.R(x.allocated_rent), this.R(x.allocated_other), this.R(x.contribution),
      x.recorded_stock_cost == null ? `<span class="fic-muted" title="${this.esc(x.cost_note || '')}">Insufficient data</span>` : this.R(x.recorded_stock_cost),
      x.gross_margin == null ? '—' : this.R(x.gross_margin),
      x.recipe_cost === undefined ? '—' : (x.recipe_cost == null ? `<span class="fic-muted" title="${this.esc(x.recipe_cost_basis || '')}">Insufficient data</span>` : `<span title="${this.esc(x.recipe_cost_basis || '')}">${this.R(x.recipe_cost)}</span>`),
      x.recipe_contribution == null ? '—' : this.R(x.recipe_contribution)
    ]);
    return `${this.rangeBar(p.range)}
      <div class="fic-grid">${this.kpi('Net sales', this.R(p.summary.net_sales))}${this.kpi('Items sold', this.n(p.summary.quantity))}${this.kpi('Products sold', this.n(p.products.length))}${this.kpi('Active products not sold', this.n(p.not_sold.length))}</div>
      <div class="fic-card"><h4>Product profitability</h4><div class="fic-muted" style="margin-bottom:6px">${this.esc(p.note)}</div>
        ${this.table(['Product', 'Price', 'Qty', 'Revenue', 'Share', 'Stock alloc.', 'Salary alloc.', 'Rent alloc.', 'Other alloc.', 'Contribution', 'Recorded cost', 'Gross margin', 'Recipe cost', 'Recipe contribution'], rows, { num: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] })}
        <div class="fic-muted" style="margin-top:6px">Recipe cost and recipe contribution come from Recipe &amp; Production (recipe ingredients × purchase cost on each sale day). Recipe contribution is before allocations and operating expenses.</div>
      </div>
      ${p.not_sold.length ? `<div class="fic-card"><h4>Active products with no sales in this period</h4>${this.table(['Product', 'Price'], p.not_sold.map((x) => [this.esc(x.name), this.R(x.price)]), { num: [1] })}</div>` : ''}`;
  },

  /* ─────────── Break-even ─────────── */

  async tBreakEven() {
    const b = await this.api(API.finBreakEven({ branch_id: this.f.branch_id, months: this.beMonths || undefined }));
    if (!b) return '<div class="fic-err">Could not load break-even.</div>';
    const fc = b.fixed_costs; const ab = b.actual_basis; const al = b.allocation_basis;
    const months = this.beMonths || this.meta.settings.break_even_months;
    return `<div class="fic-row">
        <label>Based on the last<select id="fic-be-months">${[1, 2, 3, 6, 12].map((n) => `<option value="${n}"${Number(months) === n ? ' selected' : ''}>${n} full month${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <span class="fic-muted">${this.esc(b.window.from)} to ${this.esc(b.window.to)}</span>
      </div>
      ${(b.insufficient || []).map((x) => `<div class="fic-warn">${this.esc(x)}</div>`).join('')}
      <div class="fic-card"><h4>Fixed costs per month</h4><div class="fic-grid">
        ${this.kpi('Total fixed costs', this.R(fc.monthly_total))}
        ${this.kpi('Salaries', this.R(fc.salaries_monthly), 'Employees + planned positions')}
        ${this.kpi('Fixed expenses', this.R(fc.fixed_expenses_monthly), 'Average of recorded fixed-category expenses')}
        ${this.kpi('Average selling price', this.R(b.average_selling_price), 'per item')}
        ${this.kpi('Stock cost coverage', this.pct(b.stock_cost_coverage_pct), 'Item revenue with a recorded buying price')}
      </div>
      ${this.table(['Fixed expense category', 'Monthly average'], fc.fixed_expense_categories.map((e) => [this.esc(e.category), this.R(e.monthly)]), { num: [1], empty: 'No fixed-category expenses recorded in this window.' })}
      </div>
      <div class="fic-card"><h4>Break-even — actual cost basis</h4>${ab ? `<div class="fic-grid">
        ${this.kpi('Variable cost ratio', this.pct(ab.variable_cost_ratio_pct), 'Recorded stock cost ÷ costed revenue')}
        ${this.kpi('Required monthly revenue', this.R(ab.required_monthly_revenue))}
        ${this.kpi('Required weekly revenue', this.R(ab.required_weekly_revenue))}
        ${this.kpi('Required daily revenue', this.R(ab.required_daily_revenue), `Per trading day: ${this.R(ab.required_trading_day_revenue)}`)}
        ${this.kpi('Required monthly units', this.n(ab.required_monthly_units))}
        ${this.kpi('Required daily units', this.n(ab.required_daily_units))}
        ${this.kpi('Current monthly revenue', this.R(ab.current_monthly_revenue))}
        ${this.kpi('Monthly gap', this.R(ab.gap_monthly), ab.gap_monthly > 0 ? 'Below break-even' : 'At or above break-even', ab.gap_monthly > 0 ? 'bad' : 'good')}
      </div>` : '<div class="fic-empty">INSUFFICIENT DATA — see the notes above.</div>'}</div>
      <div class="fic-card"><h4>Break-even — allocation basis</h4>
        <div class="fic-muted" style="margin-bottom:6px">Revenue at which each allocation percentage covers its matching monthly cost.</div>
        ${this.table(['Category', '%', 'Monthly cost', 'Cost source', 'Revenue needed / month'], al.rows.map((r) => [this.esc(r.name), `${r.pct}%`, this.R(r.monthly_cost), this.esc(r.cost_source), this.R(r.required_monthly_revenue)]), { num: [1, 2, 4], empty: 'INSUFFICIENT DATA — no allocation category has a matching cost (salaries or recorded expenses).' })}
        ${al.required_monthly_revenue ? `<div class="fic-grid" style="margin-top:8px">${this.kpi('Required monthly revenue', this.R(al.required_monthly_revenue))}${this.kpi('Weekly', this.R(al.required_weekly_revenue))}${this.kpi('Daily', this.R(al.required_daily_revenue))}${this.kpi('Monthly units', this.n(al.required_monthly_units))}</div>` : ''}
      </div>
      <div class="fic-card"><h4>Product-level break-even</h4>
        ${b.product_level_message ? `<div class="fic-warn">${this.esc(b.product_level_message)}</div>` : ''}
        ${this.table(['Product', 'Price', 'Unit cost', 'Cost source', 'Unit margin', 'Units to cover fixed costs', 'Note'], b.products.map((p) => [this.esc(p.name), this.R(p.price), this.R(p.unit_cost), this.esc(p.cost_source || '—'), this.R(p.unit_margin), this.n(p.units_to_cover_fixed), this.esc(p.note || '')]), { num: [1, 2, 4, 5], empty: 'No active products.' })}
      </div>`;
  },

  /* ─────────── Branches ─────────── */

  async tBranches() {
    const b = await this.api(API.finBranches(this.qf()));
    if (!b) return '<div class="fic-err">Could not load branches.</div>';
    const rows = b.branches.map((x) => [this.esc(x.branch), ...this.periodCells(this.pickTotal(x)), x.average_order == null ? '—' : this.R(x.average_order)]);
    rows.push({ attrs: 'class="total"', cells: ['ALL BRANCHES', ...this.periodCells(this.pickTotal(b.total)), b.total.average_order == null ? '—' : this.R(b.total.average_order)] });
    return `${this.rangeBar(b.range)}
      ${b.total.has_data ? '' : '<div class="fic-empty">NO DATA AVAILABLE FOR THIS PERIOD</div>'}
      <div class="fic-card"><h4>Branch performance</h4>${this.table(['Branch', ...this.periodHead(), 'Avg order'], rows, { num: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })}
      ${b.unassigned_expenses ? `<div class="fic-muted" style="margin-top:6px">Expenses not linked to a branch: ${this.R(b.unassigned_expenses)} (included in the all-branches total only).</div>` : ''}
      <div class="fic-muted">Branch-specific allocation categories apply only to their branch; "All branches" categories apply to every branch.</div></div>`;
  },

  /* ─────────── Reports ─────────── */

  async tReports() {
    if (!this.can('fin_reports')) return '<div class="fic-warn">Reports need the "Financial — Generate, export & share reports" permission.</div>';
    const list = await this.api(API.finReports(100)) || [];
    const type = this.repType || 'daily';
    const types = Object.entries(this.meta.report_types || {}).filter(([k]) => (k !== 'salary' || this.can('fin_salaries')) && (k !== 'ai' || this.can('fin_ai')));
    const extra = type === 'monthly'
      ? `<label>Month<input type="month" id="fr-month" value="${this.mon.year}-${String(this.mon.month).padStart(2, '0')}" max="${this.meta.today.slice(0, 7)}"></label>`
      : type === 'annual' ? `<label>Year<select id="fr-year">${this.yearOptions(this.year)}</select></label>`
        : type === 'daily' ? `<label>Date<input type="date" id="fr-date" value="${this.meta.today}" max="${this.meta.today}"></label>`
          : type === 'breakeven' ? `<label>Months<select id="fr-months">${[1, 2, 3, 6, 12].map((n) => `<option value="${n}"${n === Number(this.meta.settings.break_even_months) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
            : type === 'ai' ? '<label style="flex:1">Question<input id="fr-q" value="What should I review this month?" maxlength="500"></label>'
              : type === 'historical' ? '' : '';
    const usesRange = ['branch', 'product', 'allocation', 'salary'].includes(type);
    const rows = list.map((r) => [
      this.esc(r.reference), this.esc(r.title), this.esc(r.period_from ? `${r.period_from} to ${r.period_to}` : '—'), this.esc(r.branch), this.esc(r.generated_by_name || ''), this.esc(String(r.created_at || '').slice(0, 16)), this.n(r.export_count),
      `<button type="button" class="fic-btn sm" data-act="rep-open" data-id="${r.id}">Open</button> <button type="button" class="fic-btn sm" data-act="rep-pdf" data-id="${r.id}">PDF</button> <button type="button" class="fic-btn sm" data-act="rep-xlsx" data-id="${r.id}">Excel</button> <button type="button" class="fic-btn sm" data-act="rep-print" data-id="${r.id}">Print</button> <button type="button" class="fic-btn sm" data-act="rep-wa" data-id="${r.id}">WhatsApp</button>`
    ]);
    return `<div class="fic-card"><h4>Generate a report</h4>
        <div class="fic-muted" style="margin-bottom:6px">Reports carry your company and branch details from Settings and are saved in the history below. WhatsApp sharing opens WhatsApp for you to choose the recipient — nothing is sent automatically.</div>
        <div class="fic-row">
          <label>Report<select id="fic-rep-type">${types.map(([k, l]) => `<option value="${k}"${k === type ? ' selected' : ''}>${this.esc(l)}</option>`).join('')}</select></label>
          ${extra}
          <button type="button" class="fic-btn p" data-act="rep-gen">Generate</button>
        </div>
        ${usesRange ? this.rangeBar(null) : ''}
      </div>
      <div id="fic-rep-preview">${this.reportLast ? this.reportPreview(this.reportLast) : ''}</div>
      <div class="fic-card"><h4>Report history</h4>${this.table(['Reference', 'Report', 'Period', 'Branch', 'Generated by', 'Created', 'Exports', ''], rows, { num: [6], empty: 'No reports generated yet.' })}</div>`;
  },

  async generateReport() {
    const type = this.el.querySelector('#fic-rep-type')?.value || 'daily';
    const v = (id) => this.el.querySelector(id)?.value ?? '';
    const f = { branch_id: this.f.branch_id };
    if (type === 'daily') { f.preset = 'custom'; f.date = v('#fr-date') || this.meta.today; }
    else if (type === 'monthly') { const [y, m] = (v('#fr-month') || '').split('-').map(Number); f.year = y; f.month = m; }
    else if (type === 'annual') f.year = Number(v('#fr-year'));
    else if (type === 'breakeven') f.months = Number(v('#fr-months'));
    else if (type === 'ai') f.question = v('#fr-q');
    else if (type !== 'historical') Object.assign(f, this.qf());
    const btn = this.el.querySelector('[data-act="rep-gen"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    const r = await this.api(API.finGenerateReport(type, f));
    if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
    if (!r) return;
    this.reportLast = r;
    this.toast(`Report ${r.reference} generated`, 'success');
    await this.renderTab();
  },

  async openReport(id) {
    const r = await this.api(API.finReport(id));
    if (!r) return;
    this.reportLast = r;
    const p = this.el.querySelector('#fic-rep-preview');
    if (p) { p.innerHTML = this.reportPreview(r); p.scrollIntoView({ behavior: 'smooth' }); }
  },

  snapshotHtml(snap) {
    const c = snap.company || {};
    const logo = /^(https?:|data:image\/)/i.test(c.logo_path || '') ? `<img src="${this.esc(c.logo_path)}" alt="" style="max-height:60px;max-width:120px;margin-right:12px">` : '';
    const head = `<div style="display:flex;align-items:center;margin-bottom:8px">${logo}<div>
      <div style="font-size:1.1rem;font-weight:800">${this.esc(c.name || '')}</div>
      <div class="fic-muted">${[c.address, c.phone, c.email, c.website].filter(Boolean).map((x) => this.esc(x)).join(' · ')}</div>
      <div class="fic-muted">${[c.vat_number ? `VAT: ${this.esc(c.vat_number)}` : '', c.registration_number ? `Reg: ${this.esc(c.registration_number)}` : ''].filter(Boolean).join(' · ')}</div>
      <div class="fic-muted">${c.branch ? `Branch: ${this.esc(c.branch.name)}${c.branch.address ? ` — ${this.esc(c.branch.address)}` : ''}` : 'Branch: All branches'}</div>
    </div></div>
    <h3 style="margin:4px 0">${this.esc(snap.title)}</h3>
    <div class="fic-muted">Period: ${this.esc(snap.period?.label || '')} · Reference ${this.esc(snap.reference)} · Generated ${this.esc(String(snap.generated_at || '').replace('T', ' ').slice(0, 19))} UTC by ${this.esc(snap.generated_by || '')}</div>`;
    const sections = (snap.sections || []).map((s) => `<div style="margin-top:12px"><h4 style="margin:0 0 6px">${this.esc(s.title)}</h4>
      ${s.kpis?.length ? `<table class="fic-table" style="max-width:520px"><tbody>${s.kpis.map(([k, v]) => `<tr><td>${this.esc(k)}</td><td class="num"><b>${this.esc(v)}</b></td></tr>`).join('')}</tbody></table>` : ''}
      ${s.table ? (s.table.rows.length ? `<table class="fic-table"><thead><tr>${s.table.head.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map((r) => `<tr${/TOTAL$/.test(String(r[0])) ? ' class="total"' : ''}>${r.map((x) => `<td>${this.esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="fic-empty">NO DATA AVAILABLE FOR THIS PERIOD</div>') : ''}
      ${(s.notes || []).filter(Boolean).map((n) => `<div class="fic-muted">${this.esc(n)}</div>`).join('')}
    </div>`).join('');
    return `${head}${sections}<div class="fic-muted" style="margin-top:12px;font-size:.75rem">${this.esc(snap.definitions || '')}</div>`;
  },

  reportPreview(snap) {
    return `<div class="fic-card">
      <div class="fic-row" style="justify-content:flex-end">
        <button type="button" class="fic-btn" data-act="rep-pdf" data-id="${snap.id}">⬇ PDF</button>
        <button type="button" class="fic-btn" data-act="rep-xlsx" data-id="${snap.id}">⬇ Excel</button>
        <button type="button" class="fic-btn" data-act="rep-print" data-id="${snap.id}">🖨 Print</button>
        <button type="button" class="fic-btn p" data-act="rep-wa" data-id="${snap.id}">WhatsApp</button>
      </div>
      ${this.snapshotHtml(snap)}
    </div>`;
  },

  b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  },

  async download(id, format) {
    const r = await this.api(API.finExportReport(id, format), 'Export failed');
    if (!r) return;
    const url = URL.createObjectURL(this.b64ToBlob(r.base64, r.mime));
    const a = document.createElement('a');
    a.href = url; a.download = r.filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    this.toast(`${r.filename} downloaded`, 'success');
  },

  async printReport(id) {
    const snap = this.reportLast && this.reportLast.id === id ? this.reportLast : await this.api(API.finReport(id));
    if (!snap) return;
    const w = window.open('', '_blank');
    if (!w) { this.toast('Allow pop-ups to print the report', 'error'); return; }
    const css = (document.getElementById('fic-css')?.textContent || '');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${this.esc(snap.reference)} — ${this.esc(snap.title)}</title>
      <style>${css} body{font-family:system-ui,Segoe UI,Arial,sans-serif;padding:18px;color:#0f172a} .fic-table td,.fic-table th{white-space:normal} @media print{button{display:none}}</style></head>
      <body>${this.snapshotHtml(snap)}<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`);
    w.document.close();
  },

  async shareWhatsApp(id) {
    const sum = await this.api(API.finReportSummary(id));
    if (!sum) return;
    try {
      const probe = typeof File !== 'undefined' ? new File([new Blob(['x'])], 'probe.pdf', { type: 'application/pdf' }) : null;
      if (probe && navigator.canShare && navigator.canShare({ files: [probe] })) {
        const ex = await this.api(API.finExportReport(id, 'pdf'));
        if (ex) {
          const file = new File([this.b64ToBlob(ex.base64, ex.mime)], ex.filename, { type: ex.mime });
          await navigator.share({ files: [file], title: ex.filename, text: sum.text });
          return;
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const phone = window.prompt('WhatsApp number to share with (leave blank to pick the contact in WhatsApp):', '');
    if (phone == null) return;
    if (phone.trim() && typeof Utils !== 'undefined' && Utils.openWhatsApp) Utils.openWhatsApp(phone.trim(), sum.text);
    else if (typeof Utils !== 'undefined' && Utils.openWhatsAppUrl) Utils.openWhatsAppUrl(`https://wa.me/?text=${encodeURIComponent(sum.text)}`);
    else window.open(`https://wa.me/?text=${encodeURIComponent(sum.text)}`, '_blank');
  },

  /* ─────────── AI advisor ─────────── */

  async tAi() {
    if (!this.can('fin_ai')) return '<div class="fic-warn">The AI Financial Advisor needs the "Financial — Use AI Financial Advisor" permission.</div>';
    const hist = await this.api(API.finAiHistory(20)) || [];
    const examples = ['How much did I make this month?', 'Can I afford two workers at R2500?', 'Which products sell poorly?', 'Which days perform best?',
      'Why is this month different from last month?', 'Which cost category consumes the most money?', 'What happens if I change my salary allocation from 20% to 25%?', 'What should I review?'];
    return `<div class="fic-card"><h4>Ask about your finances</h4>
        <div class="fic-muted" style="margin-bottom:6px">Answers are built from your recorded data and split into FACT (from the database), ANALYSIS and RECOMMENDATION. The advisor never invents figures and never changes anything — proposed configuration changes need your approval.</div>
        <div class="fic-row"><label style="flex:1">Question<textarea id="fic-ai-q" rows="2" maxlength="500" style="width:100%">${this.esc(this.aiLast?.question || '')}</textarea></label><button type="button" class="fic-btn p" data-act="ai-ask">Ask</button></div>
        <div>${examples.map((q) => `<span class="fic-chip" data-act="ai-q" data-q="${this.esc(q)}">${this.esc(q)}</span>`).join('')}</div>
      </div>
      <div id="fic-ai-out">${this.aiLast ? this.aiAnswer(this.aiLast) : ''}</div>
      <div class="fic-card"><h4>Previous questions</h4>${this.table(['Asked', 'Question', 'Engine', 'Status'], hist.map((h) => [this.esc(String(h.created_at || '').slice(0, 16)), this.esc(h.question), this.esc(h.engine), this.esc(h.status)]), { empty: 'No questions yet.' })}</div>`;
  },

  aiAnswer(a) {
    const manage = this.can('fin_manage');
    return `<div class="fic-card">
      <div class="fic-muted">${this.esc(a.engine_note || '')}</div>
      ${(a.insufficient || []).map((x) => `<div class="fic-warn">${this.esc(x)}</div>`).join('')}
      <h4 style="margin-top:8px"><span class="fic-tag fact">FACT</span></h4>
      ${a.facts.length ? `<ul>${a.facts.map((f) => `<li>${this.esc(f.text)}</li>`).join('')}</ul>` : '<div class="fic-empty">INSUFFICIENT DATA</div>'}
      <h4><span class="fic-tag an">ANALYSIS</span></h4>
      ${a.analysis.length ? `<ul>${a.analysis.map((x) => `<li>${this.esc(x)}</li>`).join('')}</ul>` : '<div class="fic-muted">No analysis — not enough data.</div>'}
      <h4><span class="fic-tag rec">RECOMMENDATION</span></h4>
      ${a.recommendations.length ? `<ul>${a.recommendations.map((r, i) => `<li>${this.esc(r.text)}${r.action ? (r.applied_at ? ' <span class="fic-pill on">Applied</span>'
        : manage ? ` <button type="button" class="fic-btn sm p" data-act="ai-approve" data-log="${a.id}" data-idx="${i}" data-text="${this.esc(r.text)}">Approve change</button>` : ' <span class="fic-muted">(an administrator with "Manage allocations" can approve this)</span>') : ''}</li>`).join('')}</ul>` : '<div class="fic-muted">No recommendations.</div>'}
      <div class="fic-ok">${this.esc(a.approval_note || 'Nothing has been changed.')}</div>
    </div>`;
  },

  async askAi() {
    const q = (this.el.querySelector('#fic-ai-q')?.value || '').trim();
    if (!q) { this.toast('Type a question', 'error'); return; }
    const out = this.el.querySelector('#fic-ai-out');
    if (out) out.innerHTML = '<p class="fic-muted">Analysing your data…</p>';
    const a = await this.api(API.finAiAsk(q, { branch_id: this.f.branch_id }));
    if (!a) { if (out) out.innerHTML = ''; return; }
    this.aiLast = a;
    if (out) out.innerHTML = this.aiAnswer(a);
  },

  async approveAi(logId, idx, text) {
    if (!window.confirm(`Apply this change?\n\n${text}\n\nThe change takes effect from today and is recorded in the audit log.`)) return;
    const r = await this.api(API.finAiApprove(logId, idx));
    if (!r) return;
    this.toast('Change applied', 'success');
    if (this.aiLast && this.aiLast.id === logId) {
      this.aiLast.recommendations[idx] = { ...this.aiLast.recommendations[idx], applied_at: new Date().toISOString() };
      const out = this.el.querySelector('#fic-ai-out');
      if (out) out.innerHTML = this.aiAnswer(this.aiLast);
    }
  },

  /* ─────────── Settings ─────────── */

  async tSettings() {
    const s = this.meta.settings;
    const manage = this.can('fin_manage');
    const audit = await this.api(API.finAudit(100)) || [];
    const dis = manage ? '' : ' disabled';
    const permLabels = { fin_view: 'View Financial Intelligence', fin_manage: 'Manage allocations, planned positions & settings', fin_salaries: 'Employees & salaries', fin_reports: 'Generate, export & share reports', fin_ai: 'Use AI Financial Advisor' };
    return `<div class="fic-card"><h4>Calculation settings</h4>
        <div class="fic-row">
          <label><span><input type="checkbox" id="fs-ex-tax"${s.exclude_tax ? ' checked' : ''}${dis}> Exclude VAT/tax from the allocation base</span></label>
          <label><span><input type="checkbox" id="fs-ex-del"${s.exclude_delivery_fees ? ' checked' : ''}${dis}> Exclude delivery fees from the allocation base</span></label>
        </div>
        <div class="fic-row">
          <label>Working days per month<input type="number" id="fs-wd" min="1" max="31" value="${this.esc(s.work_days_per_month)}"${dis}></label>
          <label>Working hours per month<input type="number" id="fs-hm" min="1" max="744" value="${this.esc(s.hours_per_month)}"${dis}></label>
          <label>Minimum stock-cost coverage % (break-even)<input type="number" id="fs-cov" min="0" max="100" value="${this.esc(s.min_cost_coverage_pct)}"${dis}></label>
          <label>Break-even history (months)<input type="number" id="fs-bem" min="1" max="12" value="${this.esc(s.break_even_months)}"${dis}></label>
        </div>
        <div class="fic-row"><label style="flex:1">Fixed-cost expense categories (comma separated)<input id="fs-fixed" value="${this.esc((s.fixed_expense_categories || []).join(', '))}"${dis}></label></div>
        ${manage ? '<button type="button" class="fic-btn p" data-act="settings-save">Save settings</button>' : '<div class="fic-muted">View only.</div>'}
      </div>
      <div class="fic-card"><h4>Company details on reports</h4>
        <div class="fic-muted">Read from Admin → Receipt / Shop settings and Branches: ${this.esc(this.meta.company?.name || '(no shop name set)')}${this.meta.company?.vat_number ? ` · VAT ${this.esc(this.meta.company.vat_number)}` : ''}. Update them there.</div>
      </div>
      <div class="fic-card"><h4>Your permissions</h4>
        ${this.table(['Permission', 'Granted'], Object.entries(permLabels).map(([k, l]) => [this.esc(l), this.can(k) ? '<span class="fic-pill on">Yes</span>' : '<span class="fic-pill off">No</span>']))}
        <div class="fic-muted" style="margin-top:6px">Granted per user under Admin → Users & Permissions. Owners have all permissions.</div>
      </div>
      <div class="fic-card"><h4>Audit log</h4>${this.table(['When', 'User', 'Action', 'Details'], audit.map((a) => [this.esc(String(a.created_at || '').slice(0, 19)), this.esc(a.username || ''), this.esc(a.action), `<span class="fic-muted">${this.esc(JSON.stringify(a.details || {}).slice(0, 180))}</span>`]), { empty: 'No financial changes recorded yet.' })}</div>`;
  },

  async saveSettings() {
    const v = (id) => this.el.querySelector(id);
    const r = await this.api(API.finSaveSettings({
      exclude_tax: v('#fs-ex-tax').checked, exclude_delivery_fees: v('#fs-ex-del').checked,
      work_days_per_month: v('#fs-wd').value, hours_per_month: v('#fs-hm').value, min_cost_coverage_pct: v('#fs-cov').value, break_even_months: v('#fs-bem').value,
      fixed_expense_categories: v('#fs-fixed').value.split(',').map((x) => x.trim()).filter(Boolean)
    }));
    if (r) { this.meta.settings = r; this.toast('Settings saved', 'success'); this.renderTab(); }
  }
};
