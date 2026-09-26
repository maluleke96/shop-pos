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

  async activate(el, app) {
    this.app = app;
    this._host = el;
    if (el?.querySelector?.('#exp-content')) {
      if (this.tab === 'dashboard') this.loadDashboard();
      else if (this.tab === 'waste') this.renderWastePanel();
      else if (this.tab === 'tools') this.renderToolsPanel();
      else if (this.tab === 'funding') this.renderFundingPanel();
      else this.load(this._from || Utils.monthStart(), this._to || Utils.today());
      return;
    }
    return this.render(el, app);
  },

  async render(el, app) {
    this.app = app;
    this._host = el;
    this.tab = this.tab || 'list';
    this.categories = this.categories || app.settings?.expense_categories || Utils.expenseCategories;
    this.loadCategories().catch(() => {});
    el.innerHTML = `<div class="page-toolbar">
        <h3>Expenses</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn btn-primary" id="exp-goto-stock-batch" title="Stock Batch &amp; Yield">📦 Stock Batch &amp; Yield</button>
          <div class="admin-tabs" id="exp-tabs" style="display:flex;flex-wrap:wrap;gap:4px;max-width:100%">
            <button type="button" class="admin-tab ${this.tab === 'list' ? 'active' : ''}" data-exp-tab="list">Expenses</button>
            <button type="button" class="admin-tab ${this.tab === 'dashboard' ? 'active' : ''}" data-exp-tab="dashboard">Dashboard</button>
            <button type="button" class="admin-tab ${this.tab === 'stock-batch' ? 'active' : ''}" data-exp-tab="stock-batch">Stock Batch &amp; Yield</button>
            <button type="button" class="admin-tab ${this.tab === 'tools' ? 'active' : ''}" data-exp-tab="tools">Budgets</button>
            <button type="button" class="admin-tab ${this.tab === 'funding' ? 'active' : ''}" data-exp-tab="funding">Owner funding</button>
            <button type="button" class="admin-tab ${this.tab === 'waste' ? 'active' : ''}" data-exp-tab="waste">Waste / Damage</button>
          </div>
          <button class="btn btn-ghost" id="exp-manage-cats" ${['waste', 'tools', 'funding', 'stock-batch'].includes(this.tab) ? 'style="display:none"' : ''}>Manage categories</button>
          <button class="btn btn-primary" id="add-exp" ${['waste', 'tools', 'funding', 'stock-batch'].includes(this.tab) ? 'style="display:none"' : ''}>+ Add Expense</button>
        </div>
      </div>
      <div id="exp-panel-list" class="${this.tab === 'list' ? '' : 'hidden'}">
        <div class="card" style="margin-bottom:12px;border:1px solid rgba(5,150,105,.35);background:linear-gradient(180deg,rgba(16,185,129,.08),transparent)">
          <div class="card-body" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
            <div>
              <strong>Stock Batch &amp; Yield</strong>
              <p class="muted" style="margin:4px 0 0">Track purchases → plates sold on POS → revenue, cost, profit, waste.</p>
            </div>
            <button type="button" class="btn btn-primary" id="exp-open-sby">Open Stock Batch &amp; Yield</button>
          </div>
        </div>
        ${Utils.dateFilterHTML('exp-filter')}
        <div id="exp-content"></div>
      </div>
      <div id="exp-panel-dashboard" class="${this.tab === 'dashboard' ? '' : 'hidden'}"></div>
      <div id="exp-panel-tools" class="${this.tab === 'tools' ? '' : 'hidden'}"></div>
      <div id="exp-panel-funding" class="${this.tab === 'funding' ? '' : 'hidden'}"></div>
      <div id="exp-panel-stock-batch" class="${this.tab === 'stock-batch' ? '' : 'hidden'}"></div>
      <div id="exp-panel-waste" class="${this.tab === 'waste' ? '' : 'hidden'}"></div>
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
        .exp-budget-ok{color:#15803d}.exp-budget-warn{color:#b45309}.exp-budget-over{color:#b91c1c}
        .exp-fund-owner{background:#fef3c7;color:#92400e;font-size:11px;padding:2px 6px;border-radius:4px}
        .exp-fund-biz{background:#e0e7ff;color:#3730a3;font-size:11px;padding:2px 6px;border-radius:4px}
      </style>`;

    document.getElementById('add-exp')?.addEventListener('click', () => this.showForm());
    document.getElementById('exp-manage-cats')?.addEventListener('click', () => this.showCategoryManager());
    const goStockBatch = () => {
      this.tab = 'stock-batch';
      document.querySelectorAll('[data-exp-tab]').forEach((b) => b.classList.toggle('active', b.dataset.expTab === 'stock-batch'));
      document.getElementById('exp-panel-list')?.classList.add('hidden');
      document.getElementById('exp-panel-dashboard')?.classList.add('hidden');
      document.getElementById('exp-panel-tools')?.classList.add('hidden');
      document.getElementById('exp-panel-funding')?.classList.add('hidden');
      document.getElementById('exp-panel-waste')?.classList.add('hidden');
      document.getElementById('exp-panel-stock-batch')?.classList.remove('hidden');
      document.getElementById('add-exp')?.style.setProperty('display', 'none');
      document.getElementById('exp-manage-cats')?.style.setProperty('display', 'none');
      this.renderStockBatchPanel();
    };
    document.getElementById('exp-goto-stock-batch')?.addEventListener('click', goStockBatch);
    document.getElementById('exp-open-sby')?.addEventListener('click', goStockBatch);
    document.querySelectorAll('[data-exp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.expTab;
        document.querySelectorAll('[data-exp-tab]').forEach((b) => b.classList.toggle('active', b.dataset.expTab === this.tab));
        document.getElementById('exp-panel-list')?.classList.toggle('hidden', this.tab !== 'list');
        document.getElementById('exp-panel-dashboard')?.classList.toggle('hidden', this.tab !== 'dashboard');
        document.getElementById('exp-panel-tools')?.classList.toggle('hidden', this.tab !== 'tools');
        document.getElementById('exp-panel-funding')?.classList.toggle('hidden', this.tab !== 'funding');
        document.getElementById('exp-panel-stock-batch')?.classList.toggle('hidden', this.tab !== 'stock-batch');
        document.getElementById('exp-panel-waste')?.classList.toggle('hidden', this.tab !== 'waste');
        const hidePrimary = ['waste', 'tools', 'funding', 'stock-batch'].includes(this.tab);
        document.getElementById('add-exp')?.style.setProperty('display', hidePrimary ? 'none' : '');
        document.getElementById('exp-manage-cats')?.style.setProperty('display', hidePrimary ? 'none' : '');
        if (this.tab === 'dashboard') this.loadDashboard();
        else if (this.tab === 'waste') this.renderWastePanel();
        else if (this.tab === 'tools') this.renderToolsPanel();
        else if (this.tab === 'funding') this.renderFundingPanel();
        else if (this.tab === 'stock-batch') this.renderStockBatchPanel();
        else this.load(this._from || Utils.monthStart(), this._to || Utils.today());
      });
    });

    Utils.bindDateFilter('exp-filter', (from, to) => this.load(from, to));
    if (this.tab === 'dashboard') this.loadDashboard();
    else if (this.tab === 'waste') this.renderWastePanel();
    else if (this.tab === 'tools') this.renderToolsPanel();
    else if (this.tab === 'funding') this.renderFundingPanel();
    else if (this.tab === 'stock-batch') this.renderStockBatchPanel();
    else this.load(Utils.monthStart(), Utils.today());
  },

  async renderStockBatchPanel() {
    const panel = document.getElementById('exp-panel-stock-batch') || this._host?.querySelector?.('#exp-panel-stock-batch');
    if (!panel) return;
    panel.innerHTML = '<p class="muted" style="padding:16px">Loading Stock Batch &amp; Yield…</p>';
    try {
      if (typeof Utils.reloadScript === 'function') {
        await Utils.reloadScript('js/pages/stock-batch-yield.js');
      } else {
        await Utils.loadScript('js/pages/stock-batch-yield.js');
      }
    } catch (err) {
      console.warn('[expenses] stock-batch script', err);
    }
    if (window.StockBatchYieldPage?.render) {
      return window.StockBatchYieldPage.render(panel, this.app);
    }
    panel.innerHTML = `<div class="card"><div class="card-body">
      <p class="error-msg">Stock Batch &amp; Yield could not load.</p>
      <p class="muted">Hard-refresh the page (Ctrl+F5), then open Expenses again.</p>
      <button type="button" class="btn btn-primary" id="sby-retry-load">Retry</button>
    </div></div>`;
    panel.querySelector('#sby-retry-load')?.addEventListener('click', () => this.renderStockBatchPanel());
  },

  async renderWastePanel() {
    const panel = document.getElementById('exp-panel-waste') || this._host?.querySelector?.('#exp-panel-waste');
    if (!panel) return;
    panel.innerHTML = '<p class="muted" style="padding:16px">Loading…</p>';
    this._expWastePhotos = this._expWastePhotos || [];
    const [prodRes, pendingRes] = await Promise.all([
      API.getStockReport().catch(() => API.getProducts({ include_ingredients: true }).catch(() => ({ data: [] }))),
      API.getWasteRecords(Utils.monthStart(), Utils.today(), { status: 'pending' }).catch(() => ({ data: [] }))
    ]);
    const products = (prodRes.data || []).filter(p => p.name !== '__Property Damage__');
    this._expWasteProducts = products;
    this._expWasteSelected = this._expWasteSelected || null;
    const pending = pendingRes.data || [];
    const selLabel = this._expWasteSelected
      ? `${Utils.escHtml(this._expWasteSelected.name)} (${this._expWasteSelected.stock_quantity ?? 0} ${this._expWasteSelected.unit || ''})`
      : 'Search & select product / ingredient…';
    panel.innerHTML = `<div class="card"><div class="card-body">
      <h4>Waste / Damage report</h4>
      <p class="muted">Select a product/ingredient or describe company property, attach a photo, and submit for admin approval. Stock deducts only after approval.</p>
      <div class="form-grid">
        <div class="field full"><label>Type</label>
          <select id="exp-w-kind">
            <option value="ingredient">Product / Ingredient</option>
            <option value="property">Company property</option>
          </select></div>
        <div class="field full" id="exp-w-prod-wrap"><label>Product / Ingredient</label>
          <input type="hidden" id="exp-w-prod" value="${this._expWasteSelected?.id || ''}">
          <button type="button" class="btn btn-ghost" id="exp-w-pick" style="width:100%;justify-content:space-between;text-align:left">
            <span id="exp-w-pick-lbl">${selLabel}</span>
            <span>🔍</span>
          </button>
          <p class="muted" style="margin:6px 0 0;font-size:12px">${products.length} items available — tap to search</p>
        </div>
        <div class="field full hidden" id="exp-w-prop-wrap"><label>Property description</label>
          <input id="exp-w-prop" placeholder="e.g. Broken chair, damaged door…"></div>
        <div class="field"><label>Quantity</label><input type="number" id="exp-w-qty" step="0.001" min="0" value="1"></div>
        <div class="field"><label>Reason</label>
          <select id="exp-w-reason"><option>Damaged</option><option>Spoiled</option><option>Expired</option><option>Broken</option><option>Lost</option><option>Other</option></select></div>
        <div class="field full"><label>Notes</label><input id="exp-w-notes"></div>
        <div class="field full"><label>Photo (required)</label>
          <button type="button" class="btn btn-ghost btn-sm" id="exp-w-photo">📷 Take / upload photo</button>
          <span id="exp-w-photo-lbl" class="muted" style="margin-left:8px">${this._expWastePhotos.length ? 'Photo ready' : 'None'}</span>
        </div>
      </div>
      <button type="button" class="btn btn-danger" id="exp-w-save" style="margin-top:12px">Submit for admin approval</button>
    </div></div>
    <div class="card" style="margin-top:16px"><div class="card-body">
      <h4>Pending (${pending.length})</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Reason</th><th>Status</th></tr></thead>
        <tbody>${pending.map(w => `<tr>
          <td>${Utils.formatDateTime(w.created_at)}</td>
          <td>${Utils.escHtml(w.product_name || w.property_name || '—')}</td>
          <td>${w.quantity}</td><td>${Utils.escHtml(w.reason || '')}</td>
          <td><span class="tag" style="background:var(--warning)">Pending</span></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No pending submissions</td></tr>'}
      </tbody></table></div>
    </div></div>`;

    const sync = () => {
      const kind = document.getElementById('exp-w-kind')?.value;
      document.getElementById('exp-w-prod-wrap')?.classList.toggle('hidden', kind === 'property');
      document.getElementById('exp-w-prop-wrap')?.classList.toggle('hidden', kind !== 'property');
    };
    document.getElementById('exp-w-kind')?.addEventListener('change', sync);
    sync();
    document.getElementById('exp-w-pick')?.addEventListener('click', () => {
      Utils.openProductSearchPicker({
        items: this._expWasteProducts || [],
        title: 'Select product / ingredient',
        hint: 'Search by name — then tap to select. Stock deducts after admin approval.',
        onPick: (row) => {
          this._expWasteSelected = row;
          const hid = document.getElementById('exp-w-prod');
          const lbl = document.getElementById('exp-w-pick-lbl');
          if (hid) hid.value = row.id;
          if (lbl) lbl.textContent = `${row.name} (${row.stock_quantity ?? 0} ${row.unit || ''})`;
        }
      });
    });
    document.getElementById('exp-w-photo')?.addEventListener('click', async () => {
      const r = await API.selectImage('waste');
      if (!r.success) {
        if (!r.cancelled) Utils.toast(r.error || 'Could not add photo', 'error');
        return;
      }
      this._expWastePhotos = [r.path || r.dataUrl || r.data].filter(Boolean);
      const lbl = document.getElementById('exp-w-photo-lbl');
      if (lbl) lbl.textContent = this._expWastePhotos.length ? 'Photo ready' : 'None';
    });
    document.getElementById('exp-w-save')?.addEventListener('click', async () => {
      const kind = document.getElementById('exp-w-kind')?.value || 'ingredient';
      if (!this._expWastePhotos?.length) return Utils.toast('Add a photo first', 'error');
      const payload = {
        damage_kind: kind,
        reason: document.getElementById('exp-w-reason')?.value || 'Damaged',
        notes: document.getElementById('exp-w-notes')?.value || '',
        quantity: parseFloat(document.getElementById('exp-w-qty')?.value) || 0,
        photo_path_1: this._expWastePhotos[0],
        photo_image: this._expWastePhotos[0]
      };
      if (kind === 'property') {
        payload.property_name = document.getElementById('exp-w-prop')?.value.trim();
        if (!payload.property_name) return Utils.toast('Describe the property', 'error');
        payload.quantity = payload.quantity > 0 ? payload.quantity : 1;
      } else {
        payload.product_id = parseInt(document.getElementById('exp-w-prod')?.value, 10);
        if (!payload.product_id || !(payload.quantity > 0)) return Utils.toast('Select product and quantity', 'error');
      }
      const r = await API.recordWaste(payload, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Submit failed', 'error');
      this._expWastePhotos = [];
      this._expWasteSelected = null;
      Utils.toast('Submitted — waiting for admin approval', 'success');
      this.renderWastePanel();
    });
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

      <div class="card" style="margin-top:12px;border-color:var(--primary)"><div class="card-body">
        <h4 style="margin:0 0 8px">Insights for this shop</h4>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.55">
          ${(ov.weekChangePct ?? 0) > 15
            ? `<li>Week spend is <strong>up ${ov.weekChangePct}%</strong> vs last week — review top categories below.</li>`
            : (ov.weekChangePct ?? 0) < -10
              ? `<li>Week spend is <strong>down ${Math.abs(ov.weekChangePct)}%</strong> vs last week — good control.</li>`
              : `<li>Week spend is steady vs last week (${ov.weekChangePct ?? 0}%).</li>`}
          ${topCat ? `<li>Biggest category this week: <strong>${Utils.escHtml(this.catLabel(topCat.name || topCat.label))}</strong> (${topCat.pct ?? 0}%).</li>` : ''}
          ${topShop ? `<li>Highest branch share: <strong>${Utils.escHtml(topShop.name)}</strong> (${topShop.pct ?? 0}%).</li>` : ''}
          <li>Tip: capture invoice photos on every expense — audits and tax claims get easier.</li>
          <li>Use <strong>Waste / Damage</strong> for spoiled stock so inventory and approvals stay linked.</li>
        </ul>
      </div></div>

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
      </div></div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:16px">
        <div class="card"><div class="card-body">
          <h4 class="exp-section-title" style="margin-top:0">💳 Cash vs card vs EFT</h4>
          <p class="muted" style="font-size:13px;margin:0 0 10px">Uses Admin payment methods on each expense.</p>
          ${this.renderBarRows((d.byPaymentMethod || []).map((p) => ({
            name: (Utils.paymentLabels && Utils.paymentLabels[p.name]) || p.label || p.name,
            amount: p.amount
          })), 'amount', 'name', currency)}
        </div></div>
        <div class="card"><div class="card-body">
          <h4 class="exp-section-title" style="margin-top:0">🏪 Vendor spend ranking</h4>
          <div class="table-wrap"><table class="table-compact">
            <thead><tr><th>Vendor</th><th>Trips</th><th>Total</th><th>%</th></tr></thead>
            <tbody>${(d.topVendors || []).slice(0, 10).map((v) => `
              <tr><td>${Utils.escHtml(v.name)}</td><td>${v.count || 0}</td>
              <td>${fmt(v.amount)}</td><td>${v.pct ?? 0}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Add vendor names on expenses</td></tr>'}
            </tbody></table></div>
        </div></div>
      </div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">⚠️ Spike / anomaly alerts</h4>
        ${(d.spikes?.spikes || []).length ? (d.spikes.spikes).map((s) => `
          <div class="exp-advice-card" style="border-color:#fca5a5">
            <strong>⚠️ ${Utils.escHtml(s.date)} — ${s.multiple}× normal</strong>
            <span>${Utils.escHtml(s.message)}</span>
          </div>`).join('') : `<p class="muted">No unusual spend days this week${d.spikes?.avgDaily ? ` (avg ~${fmt(d.spikes.avgDaily)}/day)` : ''}.</p>`}
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">📊 Profit impact</h4>
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          <div><div class="label muted">Week revenue</div><strong>${fmt(d.profitImpact?.week?.revenue)}</strong></div>
          <div><div class="label muted">Week expenses</div><strong>${fmt(d.profitImpact?.week?.expenses)}</strong></div>
          <div><div class="label muted">Expense % of sales</div><strong>${d.profitImpact?.week?.expensePctOfRevenue != null ? `${d.profitImpact.week.expensePctOfRevenue}%` : '—'}</strong></div>
          <div><div class="label muted">Week net after expenses</div><strong>${fmt(d.profitImpact?.week?.netAfterExpenses)}</strong></div>
          <div><div class="label muted">Month revenue</div><strong>${fmt(d.profitImpact?.month?.revenue)}</strong></div>
          <div><div class="label muted">Month expenses</div><strong>${fmt(d.profitImpact?.month?.expenses)}</strong></div>
          <div><div class="label muted">Month expense %</div><strong>${d.profitImpact?.month?.expensePctOfRevenue != null ? `${d.profitImpact.month.expensePctOfRevenue}%` : '—'}</strong></div>
          <div><div class="label muted">Month net after expenses</div><strong>${fmt(d.profitImpact?.month?.netAfterExpenses)}</strong></div>
        </div>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">🎯 Category budgets (this month)</h4>
        ${(d.budgets || []).length ? `<div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Category</th><th>Budget</th><th>Spent</th><th>Left</th><th>%</th></tr></thead>
          <tbody>${(d.budgets || []).map((b) => `
            <tr><td>${Utils.escHtml(b.category)}</td><td>${fmt(b.amount)}</td><td>${fmt(b.spent)}</td>
            <td class="exp-budget-${b.status}">${fmt(b.remaining)}</td>
            <td class="exp-budget-${b.status}">${b.pct}%</td></tr>`).join('')}
          </tbody></table></div>
          <p class="muted" style="margin:8px 0 0;font-size:13px">Manage budgets on the <button type="button" class="btn btn-ghost btn-sm" id="exp-goto-tools">Budgets &amp; Recurring</button> tab.</p>`
          : `<p class="muted">No budgets set yet. <button type="button" class="btn btn-ghost btn-sm" id="exp-goto-tools">Set category budgets</button></p>`}
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4 class="exp-section-title" style="margin-top:0">💼 Owner pocket funding (this month)</h4>
        <p style="margin:0 0 8px">Owner-funded purchases: <strong>${fmt(d.funding?.owner || 0)}</strong>
          · Business-paid: <strong>${fmt(d.funding?.business || 0)}</strong>
          · Recorded injections: <strong>${fmt(d.ownerFundingTotal || 0)}</strong></p>
        <button type="button" class="btn btn-ghost btn-sm" id="exp-goto-funding">Open Owner funding</button>
      </div></div>`;

    document.getElementById('exp-export-pdf')?.addEventListener('click', () => this.exportDashboardPdf());
    document.getElementById('exp-print-report')?.addEventListener('click', () => this.printDashboard());
    document.getElementById('exp-goto-tools')?.addEventListener('click', () => {
      document.querySelector('[data-exp-tab="tools"]')?.click();
    });
    document.getElementById('exp-goto-funding')?.addEventListener('click', () => {
      document.querySelector('[data-exp-tab="funding"]')?.click();
    });
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
        <thead><tr><th>Date</th><th>Category</th><th>Items</th><th>Total</th><th>Pay</th><th>Funded by</th><th>Shop</th><th>By</th><th>Invoice</th><th></th></tr></thead>
        <tbody>${this.expenses.map(e => {
          const inv = (e.invoice_path || e.invoice_url || e.has_invoice)
            ? `<img src="/api/expense-invoice/${e.id}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`
            : '<span class="muted">—</span>';
          const fund = String(e.funding_source || 'business').toLowerCase() === 'owner'
            ? '<span class="exp-fund-owner">Owner pocket</span>'
            : '<span class="exp-fund-biz">Business</span>';
          const pay = Utils.paymentLabels?.[e.payment_method] || e.payment_method || '—';
          return `<tr>
          <td>${Utils.formatDate(e.expense_date)}</td>
          <td><span class="tag">${Utils.escHtml(e.category)}</span>${e.vendor_name ? `<div class="muted" style="font-size:11px">${Utils.escHtml(e.vendor_name)}</div>` : ''}${e.purchase_order_id ? `<div class="muted" style="font-size:11px">PO #${e.purchase_order_id}</div>` : ''}</td>
          <td style="max-width:220px">${this.formatLineItemsBrief(e, currency)}</td>
          <td><strong>${Utils.formatMoney(Number(e.amount) || 0, currency)}</strong></td>
          <td>${Utils.escHtml(pay)}</td>
          <td>${fund}</td>
          <td>${Utils.escHtml(e.branch_name || '—')}</td>
          <td>${Utils.escHtml(e.user_name || '—')}</td>
          <td>${inv}</td>
          <td class="actions" style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost view-exp" data-id="${e.id}">View</button>
            <button class="btn btn-sm btn-danger del-exp" data-id="${e.id}">Delete</button>
          </td></tr>`;
        }).join('') || '<tr><td colspan="10" class="muted">No expenses in this period</td></tr>'}
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

    const invoiceHtml = (exp.invoice_path || exp.invoice_url || exp.has_invoice)
      ? `<div style="margin-top:16px"><p style="font-weight:600;margin-bottom:8px">Invoice photo</p>
         <a href="/api/expense-invoice/${exp.id}" target="_blank" rel="noopener">
           <img src="/api/expense-invoice/${exp.id}" alt="Invoice" style="max-width:100%;max-height:360px;border-radius:8px;border:1px solid var(--border)">
         </a></div>`
      : '<p class="muted" style="margin-top:12px">No invoice photo attached.</p>';

    Utils.showModal(`Expense — ${Utils.formatDate(exp.expense_date)}`, `
      <div style="font-size:14px;line-height:1.5">
        <p><strong>Category:</strong> ${Utils.escHtml(exp.category)}</p>
        <p><strong>Shop / branch:</strong> ${Utils.escHtml(exp.branch_name || '—')}</p>
        <p><strong>Payment:</strong> ${Utils.escHtml(Utils.paymentLabels?.[exp.payment_method] || exp.payment_method || '—')}</p>
        <p><strong>Funded by:</strong> ${String(exp.funding_source || 'business').toLowerCase() === 'owner' ? 'Owner pocket (personal money)' : 'Business'}</p>
        ${exp.vendor_name ? `<p><strong>Vendor:</strong> ${Utils.escHtml(exp.vendor_name)}</p>` : ''}
        ${exp.purchase_order_id ? `<p><strong>Purchase order:</strong> #${exp.purchase_order_id}</p>` : ''}
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
    const pm = this.app.settings?.payment_settings || {};
    const enabled = (pm.enabled_methods || Utils.paymentTypes || ['cash', 'card', 'eft']).filter(Boolean);
    const payOptions = enabled.length ? enabled : ['cash', 'card', 'eft'];
    const state = {
      lineSeq: 2,
      lineItems: [{ _id: 1, name: '', qty: '1', price: '' }],
      category: cats[0] || 'other',
      invoicePreview: '',
      invoiceDataUrl: '',
      funding_source: 'business',
      payment_method: payOptions.includes('cash') ? 'cash' : payOptions[0],
      purchaseOrders: [],
      catalog: this._expCatalog || []
    };

    // Load products + ingredients for search picker (non-blocking)
    if (!state.catalog.length) {
      Promise.all([
        API.getStockReport?.().catch(() => ({ data: [] })),
        API.getProducts({ include_ingredients: true }).catch(() => ({ data: [] }))
      ]).then(([stockRes, prodRes]) => {
        const fromStock = stockRes?.success !== false ? (stockRes?.data || []) : [];
        const fromProd = prodRes?.success !== false ? (prodRes?.data || []) : [];
        const map = new Map();
        for (const p of [...fromStock, ...fromProd]) {
          if (!p?.id || p.name === '__Property Damage__') continue;
          map.set(String(p.id), p);
        }
        state.catalog = [...map.values()];
        this._expCatalog = state.catalog;
      }).catch(() => {});
    }

    const validLineItems = () => state.lineItems.map((row) => {
      const name = String(row.name || '').trim();
      const quantity = Math.max(this._parseExpensePrice(row.qty) || 1, 0.001);
      const unit_price = this._parseExpensePrice(row.price);
      const amount = Math.round(quantity * unit_price * 100) / 100;
      return { name, quantity, unit_price, amount, product_id: row.product_id || null };
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

    const openLineProductPicker = (lineId) => {
      const catalog = state.catalog?.length ? state.catalog : (this._expCatalog || []);
      if (!catalog.length) {
        Utils.toast('Loading products… try again in a moment', 'error');
        API.getProducts({ include_ingredients: true }).then((res) => {
          state.catalog = (res.data || []).filter((p) => p.name !== '__Property Damage__');
          this._expCatalog = state.catalog;
          if (state.catalog.length) openLineProductPicker(lineId);
        }).catch(() => {});
        return;
      }
      Utils.openProductSearchPicker({
        items: catalog,
        title: 'Search product / ingredient',
        hint: 'Type to search, then tap an item to fill this line.',
        onPick: (row) => {
          syncLinesFromDom();
          const item = state.lineItems.find((r) => String(r._id) === String(lineId));
          if (!item) return;
          item.name = row.name || '';
          item.product_id = row.id;
          const cost = Number(row.buying_price ?? row.cost_price ?? row.unit_cost ?? row.price);
          if (Number.isFinite(cost) && cost > 0 && !this._parseExpensePrice(item.price)) {
            item.price = String(cost);
          }
          if (!item.qty) item.qty = '1';
          refreshForm();
        }
      });
    };

    const renderLines = () => state.lineItems.map((row, idx) => `
      <div class="line-item-row" data-id="${row._id}" style="display:grid;grid-template-columns:24px 1fr 36px;gap:8px;align-items:center;margin-bottom:8px">
        <span class="muted" style="font-size:12px">${idx + 1}</span>
        <div style="display:grid;grid-template-columns:1fr auto 56px 80px;gap:8px;align-items:center">
          <input type="text" class="line-item-name" placeholder="Item or ingredient name" value="${Utils.escHtml(row.name)}">
          <button type="button" class="btn btn-ghost btn-sm line-item-search" data-search-id="${row._id}" title="Search product / ingredient" style="white-space:nowrap">🔍</button>
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
          : `<label class="btn btn-ghost btn-sm" style="margin-top:8px;cursor:pointer">Upload invoice / till slip photo<input type="file" id="admin-ex-invoice-file" accept="image/*" capture="environment" hidden></label>`;
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
      document.querySelectorAll('[data-ex-fund]').forEach((btn) => {
        btn.classList.toggle('btn-primary', btn.dataset.exFund === state.funding_source);
        btn.classList.toggle('btn-ghost', btn.dataset.exFund !== state.funding_source);
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

    const applyOcrParse = async () => {
      const text = document.getElementById('ex-ocr-text')?.value || '';
      if (!text.trim()) return Utils.toast('Paste till slip text first', 'error');
      const r = await API.parseExpenseReceipt(text);
      if (!r.success) return Utils.toast(r.error || 'Could not parse', 'error');
      const p = r.data || {};
      if (p.vendor_name && document.getElementById('ex-vendor')) document.getElementById('ex-vendor').value = p.vendor_name;
      if (p.expense_date && document.getElementById('ex-date')) document.getElementById('ex-date').value = p.expense_date;
      if (p.amount > 0 && state.lineItems.length) {
        syncLinesFromDom();
        const first = state.lineItems[0];
        if (!String(first.name || '').trim()) first.name = p.vendor_name || 'Receipt total';
        first.qty = '1';
        first.price = String(p.amount);
        refreshForm();
      }
      if (document.getElementById('ex-desc') && p.vendor_name && !document.getElementById('ex-desc').value) {
        document.getElementById('ex-desc').value = p.vendor_name;
      }
      Utils.toast(p.hints?.length ? `Parsed: ${p.hints.join(', ')}` : 'Parsed receipt text', 'success');
    };

    Utils.showModal('Add Expense', `
      <div class="form-grid" style="gap:12px">
        <div class="field full" style="background:var(--bg-secondary,#f8fafc);padding:10px;border-radius:8px;border:1px solid var(--border)">
          <label>📸 Receipt capture + OCR</label>
          <p class="muted" style="margin:4px 0 8px;font-size:12px">Upload a till slip photo, then paste OCR / till text (or type key lines) to auto-fill amount, date and vendor.</p>
          <textarea id="ex-ocr-text" rows="3" placeholder="Paste till slip text here…" style="width:100%"></textarea>
          <button type="button" class="btn btn-ghost btn-sm" id="ex-ocr-parse" style="margin-top:8px">Extract amount &amp; vendor</button>
        </div>
        <div class="field full">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label style="margin:0">Invoice line items</label>
            <span class="muted" id="admin-ex-line-count">Add items below</span>
          </div>
          <p class="muted" style="margin:0 0 8px;font-size:12px">Type a name or tap 🔍 to search products / ingredients and click to fill the line.</p>
          <div id="admin-ex-lines">${renderLines()}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="admin-ex-add-line" style="margin-top:8px">+ Add another item</button>
        </div>
        <div class="field full" style="text-align:center;padding:12px;background:var(--card);border-radius:10px;border:1px solid var(--border)">
          <label class="muted" style="display:block;margin-bottom:4px">Invoice total</label>
          <div id="admin-ex-total" style="font-size:1.5rem;font-weight:700">${Utils.formatMoney(0, currency)}</div>
        </div>
        <div class="field full">
          <label>Category</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" id="admin-ex-cats">${renderCatChips()}</div>
        </div>
        <div class="field full">
          <label>Who paid? (funding source)</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
            <button type="button" class="btn btn-sm btn-primary" data-ex-fund="business">Business money</button>
            <button type="button" class="btn btn-sm btn-ghost" data-ex-fund="owner">My pocket (owner funded)</button>
          </div>
          <p class="muted" style="font-size:12px;margin:6px 0 0">Choose <strong>My pocket</strong> when you buy stock/ingredients/renovations with your personal money so Admin records it as owner funding.</p>
        </div>
        <div class="field"><label>Date</label><input type="date" id="ex-date" value="${Utils.today()}"></div>
        <div class="field"><label>Payment method</label>
          <select id="ex-pay">${payOptions.map((t) =>
            `<option value="${Utils.escHtml(t)}" ${t === state.payment_method ? 'selected' : ''}>${Utils.escHtml(Utils.paymentLabels?.[t] || t)}</option>`
          ).join('')}</select>
        </div>
        <div class="field"><label>Vendor / supplier</label><input id="ex-vendor" placeholder="e.g. Makro, Builders…"></div>
        <div class="field"><label>Note</label><input id="ex-desc" placeholder="Optional note"></div>
        <div class="field full"><label>Link to Purchase Order (optional)</label>
          <select id="ex-po"><option value="">— None —</option></select>
        </div>
        <div class="field full" id="admin-ex-invoice-preview">
          <label>Invoice / till slip photo</label>
          <label class="btn btn-ghost btn-sm" style="margin-top:8px;cursor:pointer">Upload photo<input type="file" id="admin-ex-invoice-file" accept="image/*" capture="environment" hidden></label>
        </div>
      </div>`,
      '<button type="button" class="btn btn-primary" id="save-exp">Save Expense</button>');

    API.getPurchaseOrders().then((res) => {
      const list = res.success ? (res.data || []) : [];
      state.purchaseOrders = list.filter((p) => !['cancelled', 'void'].includes(String(p.status || '').toLowerCase()));
      const sel = document.getElementById('ex-po');
      if (!sel) return;
      for (const po of state.purchaseOrders.slice(0, 80)) {
        const opt = document.createElement('option');
        opt.value = String(po.id);
        opt.textContent = `${po.po_number || ('PO#' + po.id)} — ${po.supplier_name || ''} (${po.status || ''})`;
        sel.appendChild(opt);
      }
    }).catch(() => {});

    document.getElementById('admin-ex-lines')?.addEventListener('input', () => refreshTotals());
    document.getElementById('admin-ex-lines')?.addEventListener('click', (e) => {
      const searchBtn = e.target.closest('[data-search-id]');
      if (searchBtn) {
        e.preventDefault();
        openLineProductPicker(searchBtn.dataset.searchId);
        return;
      }
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
    document.getElementById('admin-ex-add-line')?.addEventListener('click', () => {
      syncLinesFromDom();
      state.lineItems.push({ _id: state.lineSeq++, name: '', qty: '1', price: '' });
      refreshForm();
    });
    document.getElementById('admin-ex-cats')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-ex-cat]');
      if (!chip) return;
      state.category = chip.dataset.exCat;
      refreshForm();
    });
    document.querySelectorAll('[data-ex-fund]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.funding_source = btn.dataset.exFund;
        refreshForm();
      });
    });
    document.getElementById('ex-ocr-parse')?.addEventListener('click', () => applyOcrParse());
    document.getElementById('admin-ex-invoice-file')?.addEventListener('change', onInvoicePick);

    document.getElementById('save-exp').addEventListener('click', async () => {
      syncLinesFromDom();
      const line_items = validLineItems();
      if (!line_items.length) return Utils.toast('Add at least one item with a name and price', 'error');
      const amount = calcTotal();
      const poVal = document.getElementById('ex-po')?.value;
      const r = await API.saveExpense({
        category: state.category,
        amount,
        expense_date: document.getElementById('ex-date').value,
        description: document.getElementById('ex-desc').value.trim() || document.getElementById('ex-vendor')?.value.trim(),
        notes: document.getElementById('ex-desc').value.trim(),
        vendor_name: document.getElementById('ex-vendor')?.value.trim() || null,
        payment_method: document.getElementById('ex-pay')?.value || state.payment_method,
        funding_source: state.funding_source,
        purchase_order_id: poVal ? Number(poVal) : null,
        receipt_ocr_text: document.getElementById('ex-ocr-text')?.value || null,
        line_items,
        invoice_image: state.invoiceDataUrl || null
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      if (this.tab === 'dashboard') this.loadDashboard();
      else if (this.tab === 'funding') this.renderFundingPanel();
      else this.load(this._from || Utils.monthStart(), this._to || Utils.today());
      Utils.toast(state.funding_source === 'owner' ? 'Expense saved — recorded as owner-funded' : 'Expense saved', 'success');
    });
  },

  async renderToolsPanel() {
    const panel = document.getElementById('exp-panel-tools') || this._host?.querySelector?.('#exp-panel-tools');
    if (!panel) return;
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);
    panel.innerHTML = '<p class="muted">Loading budgets &amp; recurring…</p>';
    const [budRes, recRes] = await Promise.all([
      API.getExpenseBudgetStatus().catch(() => ({ success: false })),
      API.getExpenseRecurring().catch(() => ({ success: false }))
    ]);
    const budgets = budRes.success ? (budRes.data || []) : [];
    const recurring = recRes.success ? (recRes.data || []) : [];
    const cats = this.categories || Utils.expenseCategories;

    panel.innerHTML = `
      <div class="card"><div class="card-body">
        <h4 style="margin:0 0 8px">🎯 Category budgets</h4>
        <p class="muted" style="font-size:13px">Set a monthly cap per category. Dashboard warns at 80% and 100%.</p>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="field"><label>Category</label>
            <select id="exp-bud-cat">${cats.map((c) => `<option value="${Utils.escHtml(c)}">${Utils.escHtml(this.catLabel(c))}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Monthly budget</label><input type="number" id="exp-bud-amt" step="0.01" min="0" placeholder="0.00"></div>
          <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-primary" id="exp-bud-save">Save budget</button></div>
        </div>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Category</th><th>Budget</th><th>Spent</th><th>Left</th><th>%</th><th></th></tr></thead>
          <tbody>${budgets.map((b) => `
            <tr><td>${Utils.escHtml(b.category)}</td><td>${fmt(b.amount)}</td><td>${fmt(b.spent)}</td>
            <td class="exp-budget-${b.status}">${fmt(b.remaining)}</td>
            <td class="exp-budget-${b.status}">${b.pct}%</td>
            <td><button type="button" class="btn btn-sm btn-danger exp-bud-del" data-id="${b.id}">×</button></td></tr>`
          ).join('') || '<tr><td colspan="6" class="muted">No budgets yet</td></tr>'}
        </tbody></table></div>
      </div></div>

      <div class="card" style="margin-top:16px"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <h4 style="margin:0">📅 Recurring expenses</h4>
          <button type="button" class="btn btn-ghost btn-sm" id="exp-rec-post">Post due now</button>
        </div>
        <p class="muted" style="font-size:13px">Rent, security, airtime — schedule once; post monthly automatically.</p>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="field"><label>Name</label><input id="exp-rec-name" placeholder="Shop rent"></div>
          <div class="field"><label>Category</label>
            <select id="exp-rec-cat">${cats.map((c) => `<option value="${Utils.escHtml(c)}">${Utils.escHtml(this.catLabel(c))}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Amount</label><input type="number" id="exp-rec-amt" step="0.01" min="0"></div>
          <div class="field"><label>Day of month</label><input type="number" id="exp-rec-day" min="1" max="28" value="1"></div>
          <div class="field"><label>Vendor</label><input id="exp-rec-vendor" placeholder="Optional"></div>
          <div class="field"><label>Payment</label>
            <select id="exp-rec-pay">
              ${(this.app.settings?.payment_settings?.enabled_methods || Utils.paymentTypes || ['eft']).map((t) =>
                `<option value="${Utils.escHtml(t)}">${Utils.escHtml(Utils.paymentLabels?.[t] || t)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="field"><label>Funded by</label>
            <select id="exp-rec-fund"><option value="business">Business</option><option value="owner">Owner pocket</option></select>
          </div>
          <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-primary" id="exp-rec-save">Add recurring</button></div>
        </div>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Name</th><th>Category</th><th>Amount</th><th>Next due</th><th>Active</th><th></th></tr></thead>
          <tbody>${recurring.map((r) => `
            <tr><td>${Utils.escHtml(r.name)}</td><td>${Utils.escHtml(r.category)}</td>
            <td>${fmt(r.amount)}</td><td>${Utils.formatDate(r.next_due)}</td>
            <td>${r.is_active ? 'Yes' : 'No'}</td>
            <td><button type="button" class="btn btn-sm btn-danger exp-rec-del" data-id="${r.id}">×</button></td></tr>`
          ).join('') || '<tr><td colspan="6" class="muted">No recurring expenses</td></tr>'}
        </tbody></table></div>
      </div></div>`;

    document.getElementById('exp-bud-save')?.addEventListener('click', async () => {
      const category = document.getElementById('exp-bud-cat')?.value;
      const amount = parseFloat(document.getElementById('exp-bud-amt')?.value || '0');
      if (!(amount >= 0)) return Utils.toast('Enter a budget amount', 'error');
      const r = await API.saveExpenseBudget({ category, amount }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
      Utils.toast('Budget saved', 'success');
      this.renderToolsPanel();
    });
    panel.querySelectorAll('.exp-bud-del').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this budget?')) return;
      await API.deleteExpenseBudget(Number(b.dataset.id), this.app.user);
      this.renderToolsPanel();
    }));
    document.getElementById('exp-rec-save')?.addEventListener('click', async () => {
      const r = await API.saveExpenseRecurring({
        name: document.getElementById('exp-rec-name')?.value.trim(),
        category: document.getElementById('exp-rec-cat')?.value,
        amount: parseFloat(document.getElementById('exp-rec-amt')?.value || '0'),
        day_of_month: parseInt(document.getElementById('exp-rec-day')?.value || '1', 10),
        vendor_name: document.getElementById('exp-rec-vendor')?.value.trim() || null,
        payment_method: document.getElementById('exp-rec-pay')?.value || 'eft',
        funding_source: document.getElementById('exp-rec-fund')?.value || 'business'
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
      Utils.toast('Recurring expense added', 'success');
      this.renderToolsPanel();
    });
    panel.querySelectorAll('.exp-rec-del').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this recurring expense?')) return;
      await API.deleteExpenseRecurring(Number(b.dataset.id), this.app.user);
      this.renderToolsPanel();
    }));
    document.getElementById('exp-rec-post')?.addEventListener('click', async () => {
      const r = await API.postExpenseRecurring(this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Post failed', 'error');
      const n = r.data?.count || 0;
      Utils.toast(n ? `Posted ${n} recurring expense(s)` : 'Nothing due today', 'success');
      this.renderToolsPanel();
    });
  },

  async renderFundingPanel() {
    const panel = document.getElementById('exp-panel-funding') || this._host?.querySelector?.('#exp-panel-funding');
    if (!panel) return;
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);
    panel.innerHTML = '<p class="muted">Loading owner funding…</p>';
    const from = Utils.monthStart();
    const to = Utils.today();
    const [fundRes, expRes] = await Promise.all([
      API.getOwnerFundings({ from, to }).catch(() => ({ success: false })),
      API.getExpenses({ from, to }).catch(() => ({ success: false }))
    ]);
    const funds = fundRes.success ? (fundRes.data || []) : [];
    const ownerExps = (expRes.success ? (expRes.data || []) : []).filter(
      (e) => String(e.funding_source || '').toLowerCase() === 'owner'
    );
    const totalFund = funds.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const totalOwnerExp = ownerExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    panel.innerHTML = `
      <div class="card"><div class="card-body">
        <h4 style="margin:0 0 8px">💼 Owner pocket funding</h4>
        <p style="margin:0 0 12px;line-height:1.5">When you buy cement, chickens, ingredients or renovations with <strong>your own money</strong> (not from the till or business account), mark the expense as <em>My pocket</em>. That records the spend as an expense <strong>and</strong> as owner funding so Admin can see what you put into the business.</p>
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:16px">
          <div><div class="label muted">Owner-funded purchases (month)</div><strong>${fmt(totalOwnerExp)}</strong></div>
          <div><div class="label muted">Funding records (month)</div><strong>${fmt(totalFund)}</strong></div>
        </div>
        <h5 style="margin:0 0 8px">Record cash you put into the business</h5>
        <p class="muted" style="font-size:13px">Use this when you give cash to the till / bank — not for purchases (those use Add Expense → My pocket).</p>
        <div class="form-grid" style="margin-bottom:16px">
          <div class="field"><label>Date</label><input type="date" id="exp-of-date" value="${Utils.today()}"></div>
          <div class="field"><label>Amount</label><input type="number" id="exp-of-amt" step="0.01" min="0"></div>
          <div class="field"><label>Description</label><input id="exp-of-desc" placeholder="Cash into till / bank deposit"></div>
          <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-primary" id="exp-of-save">Record cash injection</button></div>
        </div>
        <h5 style="margin:16px 0 8px">This month’s funding ledger</h5>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>By</th></tr></thead>
          <tbody>${funds.map((f) => `
            <tr><td>${Utils.formatDate(f.funding_date)}</td>
            <td>${f.funding_type === 'cash_injection' ? 'Cash in' : 'Purchase'}</td>
            <td>${Utils.escHtml(f.description || '—')}${f.expense_id ? ` <span class="muted">#${f.expense_id}</span>` : ''}</td>
            <td><strong>${fmt(f.amount)}</strong></td>
            <td>${Utils.escHtml(f.created_by_name || '—')}</td></tr>`
          ).join('') || '<tr><td colspan="5" class="muted">No owner funding this month</td></tr>'}
        </tbody></table></div>
        <h5 style="margin:16px 0 8px">Owner-funded expenses</h5>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Amount</th></tr></thead>
          <tbody>${ownerExps.map((e) => `
            <tr><td>${Utils.formatDate(e.expense_date)}</td>
            <td>${Utils.escHtml(e.category)}</td>
            <td>${Utils.escHtml(e.vendor_name || e.description || '—')}</td>
            <td><strong>${fmt(e.amount)}</strong></td></tr>`
          ).join('') || '<tr><td colspan="4" class="muted">None yet — add an expense and choose My pocket</td></tr>'}
        </tbody></table></div>
        <button type="button" class="btn btn-primary" id="exp-of-add-exp" style="margin-top:12px">+ Add owner-funded expense</button>
      </div></div>`;

    document.getElementById('exp-of-save')?.addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('exp-of-amt')?.value || '0');
      if (!(amount > 0)) return Utils.toast('Enter an amount', 'error');
      const r = await API.recordOwnerFunding({
        funding_date: document.getElementById('exp-of-date')?.value || Utils.today(),
        amount,
        funding_type: 'cash_injection',
        description: document.getElementById('exp-of-desc')?.value.trim() || 'Owner cash into business'
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
      // Also mirror cash injection into accounting when available
      try {
        if (typeof API.accSaveOwnerTxn === 'function') {
          await API.accSaveOwnerTxn({
            txn_date: document.getElementById('exp-of-date')?.value,
            txn_type: 'capital',
            amount,
            description: document.getElementById('exp-of-desc')?.value.trim() || 'Owner cash into business',
            payment_method: 'cash'
          }, this.app.user).catch(() => {});
        }
      } catch (_) { /* optional */ }
      Utils.toast('Owner cash injection recorded', 'success');
      this.renderFundingPanel();
    });
    document.getElementById('exp-of-add-exp')?.addEventListener('click', () => this.showForm());
  }
};
window.ExpensesPage = ExpensesPage;
