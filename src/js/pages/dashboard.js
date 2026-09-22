const DashboardPage = {
  async render(el, app) {
    this.app = app;
    this._host = el;
    this._loadGen = (this._loadGen || 0) + 1;
    el.innerHTML = `<div class="page-toolbar"><h3>Dashboard</h3></div>
      ${Utils.dateFilterHTML('dash-filter')}
      <div id="dash-content"></div>`;
    Utils.bindDateFilter('dash-filter', (from, to) => this.load(el, from, to));
    const from = Utils.monthStart();
    const to = Utils.today();
    // Stage 2: paint cached KPIs immediately when available
    const cached = window.DataCache?.peek?.('dashboard', [from, to]);
    if (cached?.success && cached.data) {
      this.paintStats(el, cached.data, from, to);
    }
    this.load(el, from, to);
    window.SaasFeatures?.loadCatalog?.().then(() => {
      // Refresh summary strip once catalog arrives
      const content = el.querySelector('#dash-content');
      if (content && !content.querySelector('.saas-plan-summary') && window.SaasFeatures?.summaryHtml?.()) {
        const host = this._host || el;
        const from2 = Utils.monthStart();
        const to2 = Utils.today();
        const cached = window.DataCache?.peek?.('dashboard', [from2, to2]);
        if (cached?.success && cached.data) this.paintStats(host, cached.data, from2, to2);
      }
    }).catch(() => {});
  },

  async activate(el, app) {
    this.app = app;
    this._host = el;
    this.load(el, Utils.monthStart(), Utils.today());
  },

  paintStats(el, s, from, to) {
    const content = el.querySelector('#dash-content') || document.getElementById('dash-content');
    if (!content) return;
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);
    const maxBar = Math.max(...(s.salesGraph?.map(g => g.total) || [1]), 1);
    const bars = (s.salesGraph || []).map(g => {
      const h = Math.round((g.total / maxBar) * 140);
      const day = new Date(g.day).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
      return `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${h}px" title="${fmt(g.total)}"></div><span class="chart-label">${day}</span></div>`;
    }).join('');
    const planSummary = window.SaasFeatures?.summaryHtml?.() || '';
    content.innerHTML = `
      ${planSummary}
      <div class="stats-grid" id="dash-stats">
        <div class="stat-card primary"><div class="label">Sales (${Utils.formatDate(from)} — ${Utils.formatDate(to)})</div><div class="value">${fmt(s.todaySales ?? 0)}</div><div class="sub">${s.todayCount ?? 0} transactions</div></div>
        <div class="stat-card success"><div class="label">Profit</div><div class="value">${fmt(s.profit ?? 0)}</div></div>
        <div class="stat-card danger"><div class="label">Expenses</div><div class="value">${fmt(s.monthlyExpenses ?? 0)}</div></div>
        <div class="stat-card warning"><div class="label">Low Stock Items</div><div class="value">${s.lowStockCount ?? 0}</div></div>
        <div class="stat-card"><div class="label">Best Seller</div><div class="value" style="font-size:16px">${Utils.escHtml(s.bestSeller || '—')}</div><div class="sub">${s.bestSellerQty ?? 0} sold</div></div>
      </div>
      <div class="card" id="dash-chart-card"><div class="card-header"><h3>Sales Chart</h3></div>
        <div class="card-body"><div class="chart-bars">${bars || '<p class="muted">No sales in this period</p>'}</div></div></div>`;
    content.querySelector('#saas-dash-explore')?.addEventListener('click', () => {
      window.App?.navigate?.('features');
    });
  },

  async load(el, from, to) {
    const gen = ++this._loadGen;
    const content = el?.querySelector?.('#dash-content') || document.getElementById('dash-content');
    if (content && !content.querySelector('#dash-stats')) {
      content.innerHTML = `
        <div class="stats-grid" id="dash-stats"><div class="stat-card"><div class="label">Loading…</div><div class="value">…</div></div></div>
        <div class="card" id="dash-chart-card"><div class="card-header"><h3>Sales Chart</h3></div>
          <div class="card-body"><p class="muted">Loading chart…</p></div></div>`;
    }

    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);

    const res = await API.getDashboardStats(from, to, this.app.user).catch((e) => ({
      success: false,
      error: e?.message || 'Failed'
    }));
    if (gen !== this._loadGen) return;

    const statsEl = (el || document).querySelector?.('#dash-stats') || document.getElementById('dash-stats');
    if (!res.success) {
      const contentEl = el?.querySelector?.('#dash-content') || document.getElementById('dash-content');
      if (contentEl && (!statsEl || statsEl.querySelector('.label')?.textContent === 'Loading…' || !statsEl.querySelector('.value'))) {
        contentEl.innerHTML = `<p style="color:var(--danger)">${Utils.escHtml(res.error || 'Failed to load dashboard stats')}</p>
          <button type="button" class="btn btn-primary" id="dash-stats-retry">Retry</button>`;
        document.getElementById('dash-stats-retry')?.addEventListener('click', () => this.load(el, from, to));
      } else if (statsEl && !statsEl.querySelector('.value')) {
        statsEl.outerHTML = `<p style="color:var(--danger)">${Utils.escHtml(res.error || 'Failed to load dashboard stats')}</p>`;
      } else {
        window.DataCache?.showStaleBanner?.(this._host || el, 'Unable to refresh. Showing last updated data.');
      }
    } else {
      this.paintStats(el || this._host, res.data || {}, from, to);
      window.DataCache?.clearStaleBanner?.(this._host || el);
    }
  }
};
window.DashboardPage = DashboardPage;
