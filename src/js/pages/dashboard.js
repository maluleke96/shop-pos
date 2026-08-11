const DashboardPage = {
  async render(el, app) {
    this.app = app;
    el.innerHTML = `<div class="page-toolbar"><h3>Dashboard</h3></div>
      ${Utils.dateFilterHTML('dash-filter')}
      <div id="dash-content"></div>`;
    Utils.bindDateFilter('dash-filter', (from, to) => this.load(el, from, to));
    this.load(el, Utils.monthStart(), Utils.today());
  },

  async load(el, from, to) {
    const content = document.getElementById('dash-content');
    if (content) content.innerHTML = '<p class="muted">Loading dashboard…</p>';
    const [res, liveRes] = await Promise.all([
      API.getDashboardStats(from, to, this.app.user),
      ['owner', 'manager', 'marketing_agent'].includes(this.app.user?.role)
        ? API.getActiveCampaigns(this.app.user?.branch_id).catch(() => ({ success: false }))
        : Promise.resolve({ success: false })
    ]);
    if (!res.success) {
      if (content) content.innerHTML = `<p style="color:var(--danger)">${res.error || 'Failed to load dashboard stats'}</p>`;
      return;
    }
    const s = res.data || {};
    const currency = this.app.settings?.currency || 'R';
    const fmt = (n) => Utils.formatMoney(n, currency);
    const liveCampaigns = liveRes.success ? (liveRes.data || []) : [];
    let livePromoHtml = '';
    if (liveCampaigns.length) {
      const analytics = await Promise.all(liveCampaigns.map(c =>
        API.getFlyerAnalytics(c.id).catch(() => ({ success: false }))
      ));
      livePromoHtml = `<div class="card campaign-live-promos-card"><div class="card-header"><h3>Live Promotions</h3></div><div class="card-body">
        ${liveCampaigns.map((c, i) => {
          const rev = analytics[i]?.success ? analytics[i].data?.promo_revenue : null;
          return `<div class="campaign-live-promo-row">
            <div><strong>${Utils.escHtml(c.title)}</strong>${c.promotion_name ? `<br><small class="muted">${Utils.escHtml(c.promotion_name)}</small>` : ''}</div>
            <div style="text-align:right"><small class="muted">Ends ${c.end_date || '—'}</small>${rev != null ? `<br><strong>${fmt(rev)}</strong>` : ''}</div>
          </div>`;
        }).join('')}
      </div></div>`;
    }

    const maxBar = Math.max(...(s.salesGraph?.map(g => g.total) || [1]), 1);
    const bars = (s.salesGraph || []).map(g => {
      const h = Math.round((g.total / maxBar) * 140);
      const day = new Date(g.day).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
      return `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${h}px" title="${fmt(g.total)}"></div><span class="chart-label">${day}</span></div>`;
    }).join('');

    document.getElementById('dash-content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card primary"><div class="label">Sales (${Utils.formatDate(from)} — ${Utils.formatDate(to)})</div><div class="value">${fmt(s.todaySales ?? 0)}</div><div class="sub">${s.todayCount ?? 0} transactions</div></div>
        <div class="stat-card success"><div class="label">Profit</div><div class="value">${fmt(s.profit ?? 0)}</div></div>
        <div class="stat-card danger"><div class="label">Expenses</div><div class="value">${fmt(s.monthlyExpenses ?? 0)}</div></div>
        <div class="stat-card warning"><div class="label">Low Stock Items</div><div class="value">${s.lowStockCount ?? 0}</div></div>
        <div class="stat-card"><div class="label">Best Seller</div><div class="value" style="font-size:16px">${s.bestSeller || '—'}</div><div class="sub">${s.bestSellerQty ?? 0} sold</div></div>
      </div>
      ${livePromoHtml}
      <div class="card"><div class="card-header"><h3>Sales Chart</h3></div><div class="card-body"><div class="chart-bars">${bars || '<p class="muted">No sales in this period</p>'}</div></div></div>`;
  }
};
window.DashboardPage = DashboardPage;
