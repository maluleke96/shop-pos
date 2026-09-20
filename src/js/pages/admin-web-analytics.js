Object.assign(window.AdminPage || (window.AdminPage = {}), {
  onlineOrdersTabsHtml(active) {
    const tab = (id, label) =>
      `<button type="button" class="btn btn-ghost btn-sm oo-tab ${active === id ? 'active' : ''}" data-oo-tab="${id}">${label}</button>`;
    return `<div class="page-toolbar" style="gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0">
      ${tab('orders', 'Orders')}
      ${tab('customers', 'Customers')}
      ${tab('visitors', 'Website Visitor Analysis')}
      ${tab('rejected', 'Rejected')}
    </div>`;
  },

  bindOnlineOrderTabs(el) {
    el.querySelectorAll('[data-oo-tab]').forEach((btn) => btn.addEventListener('click', () => {
      this._ooTab = btn.dataset.ooTab;
      this.renderOnlineOrders(el);
    }));
  },

  visitorRangeFromPreset(preset, customFrom, customTo) {
    const today = Utils.today();
    if (preset === 'yesterday') {
      const y = Utils.daysAgo(1);
      return { from: y, to: y };
    }
    if (preset === '7d') return { from: Utils.daysAgo(6), to: today };
    if (preset === '30d') return { from: Utils.daysAgo(29), to: today };
    if (preset === 'custom') return { from: customFrom || Utils.daysAgo(6), to: customTo || today };
    return { from: today, to: today };
  },

  formatSecs(sec) {
    const n = Math.max(0, Number(sec) || 0);
    if (n < 60) return `${n}s`;
    const m = Math.floor(n / 60);
    const s = n % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  },

  actionLabel(action) {
    return ({
      page_view: 'Viewed page',
      view_menu: 'Viewed menu',
      view_product: 'Viewed product',
      view_special: 'Viewed special',
      add_to_cart: 'Added to cart',
      start_checkout: 'Started checkout',
      complete_order: 'Completed order',
      abandon_cart: 'Abandoned cart'
    })[action] || action;
  },

  async renderOnlineCustomers(el) {
    const currency = this.settings?.currency || 'R';
    const res = await API.webOnlineCustomers?.({}, this.app?.user).catch(() => ({ data: [] }));
    const rows = res?.data || res || [];
    const list = Array.isArray(rows) ? rows : [];
    el.innerHTML = `<div class="admin-section"><h3>Online Orders</h3>
      <p class="muted">Existing website customer accounts — not a second customer database.</p>
      ${this.onlineOrdersTabsHtml('customers')}
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Spent</th><th>Marketing</th><th>Joined</th></tr></thead>
        <tbody>${list.map((c) => `<tr>
          <td>${Utils.escHtml([c.first_name, c.last_name].filter(Boolean).join(' ') || '—')}</td>
          <td>${Utils.escHtml(c.email || c.phone || '—')}</td>
          <td>${c.orders || 0}</td>
          <td>${Utils.formatMoney(c.spent || 0, currency)}</td>
          <td>${c.marketing_opt_in ? 'Consent on' : 'No consent'}</td>
          <td>${Utils.formatDateTime(c.created_at)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No website customers yet</td></tr>'}
        </tbody></table></div></div>`;
    this.bindOnlineOrderTabs(el);
  },

  async renderWebsiteVisitorAnalysis(el) {
    const currency = this.settings?.currency || 'R';
    const preset = this._waPreset || '7d';
    const range = this.visitorRangeFromPreset(preset, this._waFrom, this._waTo);
    this._waFrom = range.from;
    this._waTo = range.to;
    let dash = {};
    try {
      const res = await API.webVisitorDashboard({ from: range.from, to: range.to }, this.app?.user);
      dash = res?.data || res || {};
    } catch (err) {
      dash = { error: err?.message || 'Could not load visitor analysis' };
    }
    const ov = dash.overview || {};
    const sales = dash.sales || {};
    const funnel = dash.funnel || [];
    const devices = dash.devices?.devices || [];
    const pages = dash.pages || [];
    const sources = dash.sources || [];
    const live = dash.live || [];
    const activity = dash.activity || [];
    const opp = dash.opportunities || {};
    const insights = dash.insights || [];
    const mobileShare = devices.find((d) => d.device === 'mobile')?.pct || 0;
    const card = (label, value, note) =>
      `<div class="card"><div class="card-body"><div class="muted">${label}</div><strong style="font-size:1.25rem">${value}</strong>${note ? `<div class="muted" style="font-size:12px">${note}</div>` : ''}</div></div>`;
    const presetBtn = (id, label) =>
      `<button type="button" class="btn btn-ghost btn-sm wa-preset ${preset === id ? 'active' : ''}" data-preset="${id}">${label}</button>`;

    el.innerHTML = `<div class="admin-section wa-dash"><h3>Online Orders</h3>
      <p class="muted">Live website visitor analysis from Order Online. Anonymous visitors stay anonymous (POPIA). Customer names appear only after sign-in.</p>
      ${this.onlineOrdersTabsHtml('visitors')}
      <div class="page-toolbar" style="gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px">
        ${presetBtn('today', 'Today')}
        ${presetBtn('yesterday', 'Yesterday')}
        ${presetBtn('7d', 'Last 7 days')}
        ${presetBtn('30d', 'Last 30 days')}
        ${presetBtn('custom', 'Custom')}
        <input type="date" id="wa-from" value="${range.from}" ${preset !== 'custom' ? 'disabled' : ''}>
        <input type="date" id="wa-to" value="${range.to}" ${preset !== 'custom' ? 'disabled' : ''}>
        <button type="button" class="btn btn-primary btn-sm" id="wa-apply">Apply</button>
      </div>
      ${dash.error ? `<div class="card"><div class="card-body" style="color:var(--danger)">${Utils.escHtml(dash.error)}</div></div>` : ''}
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0">
        ${card('Visitors today', ov.visitors_today || 0)}
        ${card('Unique today', ov.unique_today || 0)}
        ${card('Returning', ov.returning_visitors || 0)}
        ${card('This week', ov.visitors_week || 0)}
        ${card('This month', ov.visitors_month || 0)}
        ${card('Active now', ov.active_now || 0, 'Last 2 minutes')}
        ${card('Total visits', ov.total_visits || 0)}
        ${card('Avg session', this.formatSecs(ov.avg_session_sec))}
        ${card('Bounce / exit', `${ov.bounce_rate || 0}%`)}
      </div>

      ${(insights || []).map((t) => `<div class="card" style="margin:10px 0;border-color:#f59e0b"><div class="card-body"><strong>💡 Insight</strong><p style="margin:6px 0 0">${Utils.escHtml(t)}</p></div></div>`).join('')}

      <div class="card" style="margin:12px 0"><div class="card-body">
        <h4 style="margin:0 0 8px">Sales comparison</h4>
        <p class="muted" style="margin:0 0 10px">Website traffic vs online orders vs revenue for ${range.from} to ${range.to}. Previous period: ${sales.previous?.from || '—'} to ${sales.previous?.to || '—'}.</p>
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
          ${card('Visitors', sales.visitors || 0, `${sales.traffic_change || 0}% vs previous`)}
          ${card('Online orders', sales.online_orders || 0)}
          ${card('Conversion', `${sales.conversion || 0}%`, `${sales.conversion_change || 0} pts vs previous`)}
          ${card('Online revenue', Utils.formatMoney(sales.revenue || 0, currency))}
          ${card('Avg online order', Utils.formatMoney(sales.avg_order || 0, currency))}
        </div>
      </div>

      <div class="card" style="margin:12px 0"><div class="card-body">
        <h4 style="margin:0 0 8px">Customer / visitor funnel</h4>
        <div class="wa-funnel">${funnel.map((s) => `<div class="wa-funnel-step">
          <div class="wa-funnel-bar" style="width:${Math.max(8, s.pct_of_visitors || 0)}%"></div>
          <strong>${Utils.escHtml(s.label)}</strong>
          <span>${s.count || 0} · ${s.pct_of_visitors || 0}% of visitors${s.drop_from_prev ? ` · ${s.drop_from_prev}% drop` : ''}</span>
        </div>`).join('') || '<p class="muted">No visitor sessions in this range yet. Open Order Online and accept analytics to start collecting real data.</p>'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
        <div class="card"><div class="card-body">
          <h4 style="margin:0 0 8px">Traffic sources</h4>
          <table class="table"><tr><th>Source</th><th>Visitors</th><th>Orders</th><th>Conv.</th></tr>
          ${sources.map((s) => `<tr><td>${Utils.escHtml(s.source)}</td><td>${s.visitors}</td><td>${s.orders}</td><td>${s.conversion}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No source data yet</td></tr>'}
          </table>
        </div></div>
        <div class="card"><div class="card-body">
          <h4 style="margin:0 0 8px">Device analysis</h4>
          <p class="muted">${mobileShare >= 50 ? `Most customers are on phones (${mobileShare}%).` : 'Watch this to see whether most customers use phones.'}</p>
          <table class="table"><tr><th>Device</th><th>Visitors</th><th>%</th></tr>
          ${devices.map((d) => `<tr><td>${Utils.escHtml(d.device)}</td><td>${d.visitors}</td><td>${d.pct}%</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No device data yet</td></tr>'}
          </table>
          ${(dash.devices?.browsers || []).length ? `<table class="table"><tr><th>Browser</th><th>Platform</th><th>Visitors</th></tr>
            ${dash.devices.browsers.map((b) => `<tr><td>${Utils.escHtml(b.browser)}</td><td>${Utils.escHtml(b.platform)}</td><td>${b.visitors}</td></tr>`).join('')}
          </table>` : ''}
        </div></div>
      </div>

      <div class="card" style="margin:12px 0"><div class="card-body">
        <h4 style="margin:0 0 8px">Website pages</h4>
        <div class="table-wrap"><table class="table"><tr><th>Page</th><th>Page views</th><th>Unique visitors</th><th>Avg time</th><th>Conversion</th></tr>
        ${pages.map((p) => `<tr><td>${Utils.escHtml(p.page)}</td><td>${p.views}</td><td>${p.unique_visitors}</td><td>${this.formatSecs(p.avg_time_sec)}</td><td>${p.conversion}%</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No page views in this range</td></tr>'}
        </table></div>
      </div>

      <div class="card" style="margin:12px 0;border-color:#f97316"><div class="card-body">
        <h4 style="margin:0 0 8px">🔥 Purchase opportunities</h4>
        <p class="muted">People who showed interest but did not complete an order. Identifiable names are only shown when the visitor signed in and marketing consent exists.</p>
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
          ${card('Viewed products', opp.viewed_products_no_order || 0, 'No order')}
          ${card('Viewed specials', opp.viewed_specials_no_order || 0, 'No order')}
          ${card('Added to cart', opp.added_cart_no_order || 0, 'No order')}
          ${card('Started checkout', opp.started_checkout_no_order || 0, 'No order')}
        </div>
        ${(opp.identifiable_followup || []).length ? `<div class="table-wrap" style="margin-top:12px"><table class="table"><tr><th>Customer</th><th>Marketing consent</th></tr>
          ${opp.identifiable_followup.map((c) => `<tr><td>${Utils.escHtml(c.name)}</td><td>Consent on</td></tr>`).join('')}
        </table></div>` : '<p class="muted" style="margin-top:10px">No signed-in customers with marketing consent in this range.</p>'}
      </div></div>

      <div class="card" style="margin:12px 0"><div class="card-body">
        <h4 style="margin:0 0 8px">Live website activity</h4>
        <ul class="wa-live">${live.map((r) => `<li><strong>${Utils.formatDateTime(r.created_at)}</strong> — ${Utils.escHtml(r.kind)} (${Utils.escHtml(r.who)}) — ${Utils.escHtml(r.page)} — ${Utils.escHtml(this.actionLabel(r.action))}${r.product ? ` — ${Utils.escHtml(r.product)}` : ''}</li>`).join('') || '<li class="muted">No live activity yet</li>'}</ul>
      </div></div>

      <div class="card" style="margin:12px 0"><div class="card-body">
        <h4 style="margin:0 0 8px">Visitor activity</h4>
        <div class="table-wrap"><table class="table">
          <tr><th>Date / time</th><th>Visitor</th><th>Page</th><th>Product</th><th>Device</th><th>Source</th><th>Action</th><th>Session</th></tr>
          ${activity.map((r) => `<tr>
            <td>${Utils.formatDateTime(r.created_at)}</td>
            <td>${Utils.escHtml(r.visitor)}</td>
            <td>${Utils.escHtml(r.page)}</td>
            <td>${Utils.escHtml(r.product || '—')}</td>
            <td>${Utils.escHtml(r.device)}</td>
            <td>${Utils.escHtml(r.source)}</td>
            <td>${Utils.escHtml(this.actionLabel(r.action))}</td>
            <td>${this.formatSecs(r.duration_sec)}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted">No activity in this range</td></tr>'}
        </table></div>
        <p class="muted" style="font-size:12px;margin-top:8px">Guest labels use a short privacy-safe session code. We do not store IP addresses or extra personal information for anonymous visitors.</p>
      </div></div>
    </div>`;

    this.bindOnlineOrderTabs(el);
    el.querySelectorAll('.wa-preset').forEach((btn) => btn.addEventListener('click', () => {
      this._waPreset = btn.dataset.preset;
      this.renderWebsiteVisitorAnalysis(el);
    }));
    document.getElementById('wa-apply')?.addEventListener('click', () => {
      this._waPreset = 'custom';
      this._waFrom = document.getElementById('wa-from')?.value;
      this._waTo = document.getElementById('wa-to')?.value;
      this.renderWebsiteVisitorAnalysis(el);
    });
  }
});
