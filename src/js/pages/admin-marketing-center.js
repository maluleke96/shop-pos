/**
 * Admin → Marketing Center
 * Database-backed marketing workspace. Every figure comes from the mkt:* RPC layer;
 * when data is missing the page shows the server's "Insufficient data" explanation.
 */
window.AdminMarketingCenterPage = {
  el: null,
  admin: null,
  tab: 'dashboard',
  filters: { days: '', branch_id: '' },
  meta: null,
  branches: [],
  products: null,
  selected: new Set(),
  wiz: null,
  aiLast: null,
  contentLast: null,

  TABS: [
    ['dashboard', 'Dashboard'],
    ['decisions', 'Decision Center'],
    ['campaigns', 'Campaigns'],
    ['promotions', 'Promotions'],
    ['customers', 'Customers'],
    ['segments', 'Customer Segments'],
    ['loyalty', 'Loyalty'],
    ['referrals', 'Referrals'],
    ['opportunities', 'Opportunities'],
    ['calendar', 'Calendar'],
    ['content', 'Content Studio'],
    ['communication', 'Communication'],
    ['analytics', 'Analytics'],
    ['budget', 'Budget'],
    ['ai', 'AI Assistant'],
    ['audit', 'Audit'],
    ['settings', 'Settings']
  ],
  oppView: 'customers',

  PROMO_LABELS: {
    voucher: 'Discount voucher (% or fixed)',
    free_delivery: 'Free delivery voucher',
    bundle: 'Bundle / combo price',
    bogo: 'Buy X get X free',
    buy_x_get_y: 'Buy X get Y (free or discounted)',
    time_based: 'Time-based offer (happy hour)',
    referral_code: 'Existing referral code',
    loyalty: 'Loyalty reminder (no price change)',
    none: 'No offer (message only)'
  },

  WIZ_STEPS: ['Goal', 'Audience', 'Offer', 'Content', 'Channel', 'Schedule', 'Financial preview', 'Approval', 'Launch'],

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v)
      : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  toast(msg, type) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info'); },
  R(v) { return v == null || v === '' ? '—' : `R${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; },
  n(v) { return v == null || v === '' ? '—' : Number(v).toLocaleString('en-ZA'); },
  pct(v) { return v == null ? '—' : `${v}%`; },

  async api(promise, errMsg) {
    let r;
    try { r = await promise; } catch (e) { this.toast(e?.message || errMsg || 'Request failed', 'error'); return null; }
    if (!r || r.success === false) { this.toast((r && r.error) || errMsg || 'Request failed', 'error'); return null; }
    return r.data !== undefined ? r.data : r;
  },

  ensureCss() {
    if (document.getElementById('mkt-css')) return;
    const s = document.createElement('style');
    s.id = 'mkt-css';
    s.textContent = `
      .mkt-root{padding:14px;color:var(--text,#0f172a)}
      .mkt-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}
      .mkt-head h2{margin:0;font-size:1.35rem}
      .mkt-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--border,#e2e8f0);margin-bottom:12px}
      .mkt-tab{border:0;background:none;padding:8px 10px;border-radius:8px 8px 0 0;cursor:pointer;font-weight:600;color:var(--muted,#64748b)}
      .mkt-tab.active{background:#e11d48;color:#fff}
      .mkt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:12px}
      .mkt-kpi{background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:10px}
      .mkt-kpi .l{font-size:.75rem;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:.03em}
      .mkt-kpi .v{font-size:1.3rem;font-weight:700;margin-top:2px}
      .mkt-kpi .s{font-size:.75rem;color:var(--muted,#64748b)}
      .mkt-card{background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:12px;margin-bottom:12px}
      .mkt-card h3,.mkt-card h4{margin:0 0 8px}
      .mkt-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
      .mkt-dc{border-left:4px solid #e11d48}
      .mkt-tag{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:999px;background:#fee2e2;color:#9f1239;margin-right:4px}
      .mkt-tag.fact{background:#dbeafe;color:#1e3a8a}.mkt-tag.an{background:#fef3c7;color:#92400e}.mkt-tag.sg{background:#dcfce7;color:#166534}
      .mkt-muted{color:var(--muted,#64748b);font-size:.85rem}
      .mkt-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:.85rem}
      .mkt-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:.85rem}
      .mkt-table{width:100%;border-collapse:collapse;font-size:.85rem}
      .mkt-table th,.mkt-table td{padding:6px 8px;border-bottom:1px solid var(--border,#e2e8f0);text-align:left;vertical-align:top}
      .mkt-table th{font-size:.72rem;text-transform:uppercase;color:var(--muted,#64748b)}
      .mkt-row{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:8px}
      .mkt-row label{display:flex;flex-direction:column;font-size:.78rem;gap:3px;color:var(--muted,#64748b)}
      .mkt-row input,.mkt-row select,.mkt-row textarea{padding:6px 8px;border:1px solid var(--border,#cbd5e1);border-radius:8px;font-size:.9rem;background:var(--input-bg,#fff);color:inherit}
      .mkt-btn{padding:6px 12px;border-radius:8px;border:1px solid var(--border,#cbd5e1);background:var(--card,#fff);cursor:pointer;font-weight:600;font-size:.85rem;color:inherit}
      .mkt-btn.p{background:#e11d48;border-color:#e11d48;color:#fff}
      .mkt-btn.sm{padding:3px 8px;font-size:.78rem}
      .mkt-steps{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
      .mkt-step{font-size:.75rem;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#475569}
      .mkt-step.on{background:#e11d48;color:#fff}.mkt-step.done{background:#fecdd3;color:#9f1239}
      .mkt-status{font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px;background:#e2e8f0}
      .mkt-status.active{background:#dcfce7;color:#166534}.mkt-status.scheduled{background:#dbeafe;color:#1e3a8a}
      .mkt-status.awaiting_approval{background:#fef3c7;color:#92400e}.mkt-status.paused{background:#fde68a}
      .mkt-status.cancelled{background:#fee2e2;color:#991b1b}.mkt-status.completed{background:#e0e7ff;color:#3730a3}
      .mkt-pre{white-space:pre-wrap;background:#f8fafc;border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:8px;font-size:.85rem}
    `;
    document.head.appendChild(s);
  },

  async render(el, adminPage) {
    this.el = el;
    this.admin = adminPage;
    this.ensureCss();
    el.innerHTML = `<div class="mkt-root">
      <div class="mkt-head">
        <div><h2>📈 Marketing Center</h2><div class="mkt-muted">Real sales, customer, product, loyalty and referral data. Nothing is changed without your approval.</div></div>
        <div class="mkt-row" style="margin:0">
          <label>Analysis window<select id="mkt-days"><option value="">Default (Settings)</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">365 days</option></select></label>
          <label>Branch<select id="mkt-branch"><option value="">All branches</option></select></label>
          <button class="mkt-btn" id="mkt-refresh">↻ Refresh</button>
        </div>
      </div>
      <div class="mkt-tabs" id="mkt-tabs">${this.TABS.map(([id, l]) => `<button class="mkt-tab${id === this.tab ? ' active' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>
      <div id="mkt-body"><p class="mkt-muted">Loading…</p></div>
    </div>`;
    el.querySelector('#mkt-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.go(b.dataset.tab);
    });
    el.querySelector('#mkt-days').value = this.filters.days;
    el.querySelector('#mkt-days').onchange = (e) => { this.filters.days = e.target.value; this.renderTab(); };
    el.querySelector('#mkt-branch').onchange = (e) => { this.filters.branch_id = e.target.value; this.renderTab(); };
    el.querySelector('#mkt-refresh').onclick = () => { this.filters.fresh = true; this.renderTab().finally(() => { delete this.filters.fresh; }); };
    const [meta, br] = await Promise.all([this.api(API.mktMeta()), API.getBranches?.().catch(() => null)]);
    if (!meta) {
      el.querySelector('#mkt-body').innerHTML = '<div class="mkt-warn">Marketing Center could not load. You may not have the "Marketing — View" permission.</div>';
      return;
    }
    this.meta = meta;
    const brList = Array.isArray(br) ? br : (br?.data || []);
    this.branches = Array.isArray(brList) ? brList : [];
    const sel = el.querySelector('#mkt-branch');
    sel.innerHTML = '<option value="">All branches</option>' + this.branches.map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('');
    sel.value = this.filters.branch_id;
    await this.renderTab();
  },

  go(tab) {
    this.tab = tab;
    this.el.querySelectorAll('.mkt-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    return this.renderTab();
  },

  body() { return this.el.querySelector('#mkt-body'); },
  f(extra) { const o = { ...this.filters, ...(extra || {}) }; if (!o.days) delete o.days; if (!o.branch_id) delete o.branch_id; return o; },

  async renderTab() {
    const body = this.body();
    if (!body) return;
    body.innerHTML = '<p class="mkt-muted">Loading…</p>';
    const fn = {
      dashboard: this.tDashboard, decisions: this.tDecisions, campaigns: this.tCampaigns, promotions: this.tPromotions,
      customers: this.tCustomers, segments: this.tSegments, loyalty: this.tLoyalty, referrals: this.tReferrals,
      opportunities: this.tOpportunities, 'cust-opps': this.tCustOpps, products: this.tProducts, calendar: this.tCalendar, content: this.tContent,
      communication: this.tCommunication, analytics: this.tAnalytics, budget: this.tBudget, ai: this.tAi, audit: this.tAudit, settings: this.tSettings
    }[this.tab] || this.tDashboard;
    try { await fn.call(this, body); } catch (err) {
      console.error('[marketing]', err);
      body.innerHTML = `<div class="mkt-warn">${this.esc(err.message || err)}</div>`;
    }
  },

  kpi(label, value, sub) {
    return `<div class="mkt-kpi"><div class="l">${this.esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="s">${this.esc(sub)}</div>` : ''}</div>`;
  },

  table(cols, rows, empty) {
    if (!rows || !rows.length) return `<p class="mkt-muted">${this.esc(empty || 'Insufficient data — no records.')}</p>`;
    return `<div style="overflow:auto"><table class="mkt-table"><thead><tr>${cols.map((c) => `<th>${this.esc(c[0])}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  },

  warnList(list) { return (list || []).filter(Boolean).map((w) => `<div class="mkt-warn">${this.esc(w)}</div>`).join(''); },

  channelBlock(chs) {
    if (!chs) return '';
    return ['whatsapp', 'sms', 'email'].map((ch) => {
      const s = chs[ch] || {};
      return s.ready ? `<div class="mkt-ok">${ch.toUpperCase()}: ready</div>` : `<div class="mkt-warn">${ch.toUpperCase()}: ${this.esc(s.message || 'not ready')}</div>`;
    }).join('');
  },

  /* ─────────── Dashboard ─────────── */
  async tDashboard(body) {
    const d = await this.api(API.mktDashboard(this.f()));
    if (!d) { body.innerHTML = '<div class="mkt-warn">Dashboard unavailable.</div>'; return; }
    const c = d.campaigns; const cu = d.customers; const s = d.sales; const fi = d.financial;
    body.innerHTML = `
      <div class="mkt-muted" style="margin-bottom:6px">Window: last ${d.window.days} days (since ${this.esc(d.window.since)})</div>
      <h4>Campaigns</h4>
      <div class="mkt-grid">${this.kpi('Active', this.n(c.active))}${this.kpi('Scheduled', this.n(c.scheduled))}${this.kpi('Awaiting approval', this.n(c.awaiting_approval))}${this.kpi('Draft', this.n(c.draft))}${this.kpi('Completed', this.n(c.completed))}${this.kpi('Paused', this.n(c.paused))}</div>
      <h4>Customers</h4>
      <div class="mkt-grid">${this.kpi('Total customers', this.n(cu.total))}${this.kpi('Purchased in window', this.n(cu.purchasing_in_window))}${this.kpi('New', this.n(cu.new))}${this.kpi('Returning', this.n(cu.returning))}${this.kpi('Inactive', this.n(cu.inactive))}${this.kpi('High-value', this.n(cu.high_value))}${this.kpi('Loyalty members', this.n(cu.loyalty))}${this.kpi('Referral customers', this.n(cu.referral))}${this.kpi('At risk (declining)', this.n(cu.at_risk))}${this.kpi('Overdue', this.n(cu.overdue))}${this.kpi('Approaching reward', cu.approaching_reward == null ? 'Not configured' : this.n(cu.approaching_reward), cu.approaching_reward_note ? 'Set reward target in Settings' : '')}${this.kpi('Anonymous orders', this.n(cu.anonymous_orders), 'no customer linked')}</div>
      <h4>Sales</h4>
      ${s.note ? `<div class="mkt-warn">${this.esc(s.note)}</div>` : ''}
      <div class="mkt-grid">${this.kpi('Orders', this.n(s.orders))}${this.kpi('Revenue (excl. delivery)', this.R(s.revenue))}${this.kpi('Average order', this.R(s.aov))}${this.kpi('Repeat purchases', this.n(s.repeat_purchases))}${this.kpi('Attributed revenue', this.R(s.marketing_attributed_revenue), 'linked by voucher/combo/referral code')}${this.kpi('Orders from campaigns', this.n(s.orders_from_campaigns))}${this.kpi('New customers from campaigns', this.n(s.new_customers_from_campaigns))}</div>
      <h4>Financial</h4>
      <div class="mkt-grid">${this.kpi('Campaign revenue', this.R(fi.campaign_revenue))}${this.kpi('Campaign discounts', this.R(fi.discounts))}${this.kpi('COGS', this.R(fi.cogs), fi.cogs_incomplete ? 'incomplete cost data' : '')}${this.kpi('Gross profit', this.R(fi.gross_profit))}${this.kpi('Campaign costs', this.R(fi.campaign_costs))}${this.kpi('Marketing expenses (window)', this.R(fi.marketing_expenses_in_window))}${this.kpi('Contribution', this.R(fi.contribution))}${this.kpi('ROI', fi.roi_pct == null ? 'Unavailable' : this.pct(fi.roi_pct), fi.roi_note || '')}${this.kpi('All shop discounts (window)', this.R(fi.shop_discounts_in_window))}${this.kpi('ROAS', fi.roas == null ? 'Unavailable' : `${fi.roas}×`, fi.roas == null ? 'needs recorded campaign cost' : 'attributed revenue ÷ cost')}</div>
      ${this.dashExtras(d)}
      <h4>Channels</h4>${this.channelBlock(d.channels)}`;
    body.querySelectorAll('[data-dash-go]').forEach((b) => { b.onclick = () => this.go(b.dataset.dashGo); });
    body.querySelectorAll('[data-dash-camp]').forEach((b) => { b.onclick = async () => { await this.go('campaigns'); this.showCampaign(Number(b.dataset.dashCamp)); }; });
  },

  dashExtras(d) {
    const cv = d.campaign_conversion || {}; const v = d.vouchers || {}; const l = d.loyalty_activity || {}; const rf = d.referrals || {};
    const q = d.quiet || {};
    const link = (tab, label) => `<button class="mkt-btn sm" data-dash-go="${tab}">${label}</button>`;
    return `
      <h4>Promotions, loyalty &amp; referrals</h4>
      <div class="mkt-grid">${this.kpi('Campaign conversion', cv.rate_pct == null ? 'Unavailable' : this.pct(cv.rate_pct), cv.note || '')}${this.kpi('Campaign recipients', this.n(cv.recipients))}${this.kpi('Voucher redemptions (window)', this.n(v.in_window), `${this.n(v.total)} all time`)}${this.kpi('Voucher discount (window)', this.R(v.discount_in_window))}${this.kpi('Points earned (window)', this.n(l.earned))}${this.kpi('Points redeemed (window)', this.n(l.redeemed))}${this.kpi('Points expiring ≤14 days', this.n(l.expiring_14d), 'customers')}${this.kpi('Referral agents', this.n(rf.agents))}${this.kpi('Referral orders (window)', this.n(rf.referral_orders))}${this.kpi('Referral revenue (window)', this.R(rf.referral_revenue))}</div>
      <div class="mkt-cards" style="margin-top:8px">
        <div class="mkt-card"><h4>Top products ${link('opportunities', 'All')}</h4>${this.table([['Product', (p) => this.esc(p.name)], ['Units', (p) => this.n(p.units)], ['Revenue', (p) => this.R(p.revenue)]], d.top_products || [], 'INSUFFICIENT DATA — no product sales in the window.')}</div>
        <div class="mkt-card"><h4>Customer segments ${link('segments', 'Open')}</h4>${this.table([['Segment', (s) => this.esc(s.label || s.key)], ['Customers', (s) => this.n(s.count)]], (d.segments || []).filter((s) => s.count > 0), 'INSUFFICIENT DATA — no customers linked to sales.')}</div>
        <div class="mkt-card"><h4>Branch performance ${link('analytics', 'Compare')}</h4>${this.table([['Branch', (b) => this.esc(b.branch)], ['Revenue', (b) => this.R(b.revenue)], ['Orders', (b) => this.n(b.orders)], ['AOV', (b) => this.R(b.aov)]], d.branches || [], 'INSUFFICIENT DATA — no sales in the window.')}</div>
        <div class="mkt-card"><h4>Quiet periods ${link('analytics', 'Details')}</h4>${q.insufficient ? `<p class="mkt-muted">${this.esc(q.message || 'INSUFFICIENT DATA')}</p>` : this.table([['Window', (x) => this.esc(x.label)], ['Avg revenue/hour', (x) => this.R(x.avg_revenue_per_hour)], ['Below average', (x) => this.pct(x.pct_below_mean)]], q.quiet_periods || [], 'No hour is significantly below average.')}</div>
        <div class="mkt-card"><h4>Upcoming (next 30 days) ${link('calendar', 'Calendar')}</h4>${this.table([['Date', (u) => this.esc(u.date)], ['Item', (u) => (u.type === 'business_event' ? `📌 ${this.esc(u.name)}` : `<a href="#" data-dash-camp="${u.id}">📣 ${this.esc(u.name)}</a>`)], ['Status', (u) => `<span class="mkt-status ${u.status}">${this.esc(String(u.status).replace(/_/g, ' '))}</span>`]], d.upcoming || [], 'Nothing scheduled in the next 30 days.')}</div>
        <div class="mkt-card"><h4>Opportunities</h4><p class="mkt-muted">Evidence-based opportunities from your sales, customers and stock.</p>${link('decisions', 'Open Decision Center')} ${link('opportunities', 'Customer &amp; product opportunities')}</div>
      </div>`;
  },

  /* ─────────── Decision Center ─────────── */
  async tDecisions(body) {
    const d = await this.api(API.mktDecisionCenter(this.f()));
    if (!d) { body.innerHTML = '<div class="mkt-warn">Decision Center unavailable.</div>'; return; }
    this._cards = d.cards;
    const factRows = (facts) => Object.entries(facts || {}).filter(([k, v]) => v != null && v !== '' && !/_id$/.test(k) && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `<div><b>${this.esc(k.replace(/_/g, ' '))}:</b> ${this.esc(Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? Object.values(x).join(' · ') : x)).join('; ') : (typeof v === 'object' ? JSON.stringify(v) : v))}</div>`).join('');
    const actionLabel = {
      view_customers: 'View customers', create_campaign: 'Create campaign', create_promotion: 'Create promotion',
      open_menu_builder: 'Open Menu Builder', open_promo_video_builder: 'Open Promo Video Builder', create_bundle: 'Create bundle',
      create_time_campaign: 'Create time-based campaign', create_loyalty_campaign: 'Create loyalty campaign',
      create_referral_campaign: 'Create referral campaign', create_birthday_offers: 'Create birthday offers'
    };
    body.innerHTML = `
      ${d.insufficient.length ? `<div class="mkt-card"><h4>INSUFFICIENT DATA</h4>${this.warnList(d.insufficient)}</div>` : ''}
      ${d.cards.length ? '' : '<p class="mkt-muted">No opportunities detected in the current data.</p>'}
      <div class="mkt-cards">${d.cards.map((c, i) => `
        <div class="mkt-card mkt-dc">
          <h4>${this.esc(c.title)}</h4>
          <div style="font-weight:600;margin-bottom:6px">${this.esc(c.headline)}</div>
          <div><span class="mkt-tag fact">FACT</span></div><div class="mkt-muted" style="margin:4px 0 6px">${factRows(c.facts)}</div>
          <div><span class="mkt-tag an">WHY</span> <span class="mkt-muted">${this.esc(c.why)}</span></div>
          <div class="mkt-row" style="margin-top:8px">${(c.actions || []).map((a) => `<button class="mkt-btn sm" data-card="${i}" data-act="${a}">${actionLabel[a] || a}</button>`).join('')}</div>
        </div>`).join('')}</div>`;
    body.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => this.cardAction(this._cards[Number(b.dataset.card)], b.dataset.act); });
  },

  cardAction(card, act) {
    if (act === 'view_customers') {
      if (card.audience?.type === 'segment') { this._custSegment = { segment: card.audience.segment, params: card.audience.params || {} }; this._custIds = null; }
      else if (card.audience?.type === 'customers') { this._custIds = card.audience.ids; this._custSegment = null; }
      return this.go('customers');
    }
    if (act === 'open_menu_builder' || act === 'open_promo_video_builder') {
      return this.handoff(act === 'open_menu_builder' ? 'menu-builder' : 'promo-video-builder', { products: card.products || [], title: card.headline });
    }
    if (act === 'create_birthday_offers') { this.oppView = 'customers'; return this.go('opportunities'); }
    const offer = {};
    if (act === 'create_bundle' && card.products?.length) { offer.kind = 'bundle'; offer.items = card.products.map((p) => ({ product_id: p, quantity: 1 })); }
    if (act === 'create_promotion' && card.products?.length) { offer.kind = 'voucher'; offer.product_id = card.products[0]; offer.discount_type = 'percent'; }
    if (act === 'create_time_campaign') { offer.kind = 'time_based'; offer.valid_time_start = card.time_window?.start; offer.valid_time_end = card.time_window?.end; }
    if (act === 'create_referral_campaign') { offer.kind = 'referral_code'; offer.code = card.referral_code; }
    if (act === 'create_loyalty_campaign') offer.kind = 'loyalty';
    this.startWizard({
      name: card.title, objective: card.objective, audience: card.audience || { type: 'segment', segment: 'returning' },
      products: card.products || [], offer, source: { decision_card: card.kind, headline: card.headline }
    });
  },

  handoff(section, payload) {
    const names = (payload.products || []).map((id) => (this.products || []).find((p) => p.product_id === Number(id))).filter(Boolean).map((p) => p.name);
    try { sessionStorage.setItem('shoppos_marketing_handoff', JSON.stringify({ ...payload, names, section, at: Date.now(), from: 'marketing-center' })); } catch (_) { /* */ }
    const a = this.admin;
    if (!a || typeof a.renderSection !== 'function') { this.toast('Open the section from the Admin menu', 'info'); return; }
    a.section = section;
    document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
    const host = document.getElementById('admin-content');
    Promise.resolve(a.renderSection(host)).catch(() => {}).finally(() => {
      // Builders and the Communication Center render their own Marketing banner from the handoff.
      if (['menu-builder', 'promo-video-builder', 'communication-center'].includes(section) || !host) return;
      const banner = document.createElement('div');
      banner.className = 'mkt-handoff';
      banner.style.cssText = 'margin:8px 12px;padding:8px 12px;border-radius:8px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;font-size:.85rem;display:flex;justify-content:space-between;gap:8px';
      banner.innerHTML = `<span>📈 From Marketing Center${payload.title ? `: ${this.esc(payload.title)}` : ''}</span><a href="#" style="color:inherit">← Back to Marketing</a>`;
      banner.querySelector('a').onclick = (e) => {
        e.preventDefault();
        a.section = 'marketing-center';
        document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === 'marketing-center'));
        a.renderSection(host);
      };
      host.prepend(banner);
    });
  },

  /* ─────────── Campaigns + wizard ─────────── */
  async tCampaigns(body) {
    if (this.wiz) return this.renderWizard(body);
    const rows = await this.api(API.mktCampaigns(this.f(this.showArchived ? { include_archived: true } : {})));
    body.innerHTML = `
      <div class="mkt-row"><button class="mkt-btn p" id="mkt-new">＋ New campaign</button>
        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="mkt-show-arch"${this.showArchived ? ' checked' : ''}> Show archived</label></div>
      <div class="mkt-card">${this.table([
        ['#', (r) => r.id], ['Name', (r) => `<b>${this.esc(r.name)}</b><div class="mkt-muted">${this.esc(r.objective_label || '')}</div>`],
        ['Status', (r) => `<span class="mkt-status ${r.status}">${this.esc(r.status.replace(/_/g, ' '))}</span>`],
        ['Offer', (r) => this.esc(r.promotion_type ? `${r.promotion_type}${r.promotion_code ? ` · ${r.promotion_code}` : ''}` : '—')],
        ['Channels', (r) => this.esc((r.channels || []).join(', ') || '—')],
        ['Dates', (r) => this.esc(`${(r.start_at || '').slice(0, 10) || '—'} → ${(r.end_at || '').slice(0, 10) || '—'}`)],
        ['Recipients', (r) => this.n(r.recipients_count)],
        ['', (r) => `<button class="mkt-btn sm" data-open="${r.id}">Open</button>`]
      ], rows || [], 'No campaigns yet.')}</div>
      <div id="mkt-camp-detail"></div>`;
    body.querySelector('#mkt-new').onclick = () => this.startWizard({});
    body.querySelector('#mkt-show-arch').onchange = (e) => { this.showArchived = e.target.checked; this.renderTab(); };
    body.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => this.showCampaign(Number(b.dataset.open)); });
  },

  async showCampaign(id) {
    const host = this.body().querySelector('#mkt-camp-detail') || this.body();
    const c = await this.api(API.mktCampaign(id));
    if (!c) return;
    const res = ['active', 'paused', 'completed', 'scheduled'].includes(c.status) ? await this.api(API.mktCampaignResults(id)) : null;
    const btn = (act, label, cls) => `<button class="mkt-btn sm ${cls || ''}" data-cact="${act}">${label}</button>`;
    const acts = [];
    if (['draft', 'awaiting_approval', 'approved'].includes(c.status)) acts.push(btn('edit', 'Edit in wizard'));
    if (c.status === 'draft') acts.push(btn('submit', 'Submit for approval'));
    if (c.status === 'awaiting_approval') acts.push(btn('approve', 'Approve', 'p'), btn('reject', 'Reject'));
    if (c.status === 'approved') acts.push(btn('launch', 'Launch', 'p'));
    if (['active', 'scheduled'].includes(c.status)) acts.push(btn('pause', 'Pause'));
    if (c.status === 'paused') acts.push(btn('resume', 'Resume'));
    if (!['cancelled', 'completed', 'archived'].includes(c.status)) acts.push(btn('cancel', 'Cancel'));
    if (['draft', 'completed', 'cancelled'].includes(c.status)) acts.push(btn('archive', 'Archive'));
    if (c.status === 'archived') acts.push(btn('unarchive', 'Unarchive'));
    acts.push(btn('duplicate', 'Duplicate'), btn('cost', 'Record cost'), btn('report', 'Learning report'), btn('history', 'History'));
    const del = c.delivery || {};
    host.innerHTML = `<div class="mkt-card">
      <h3>#${c.id} ${this.esc(c.name)} <span class="mkt-status ${c.status}">${this.esc(c.status.replace(/_/g, ' '))}</span></h3>
      <div class="mkt-muted">Goal: ${this.esc(c.objective_label || '—')} · Channels: ${this.esc((c.channels || []).join(', ') || 'none')} · Offer: ${this.esc(c.promotion_type || 'none')} ${this.esc(c.promotion_code || '')}</div>
      <div class="mkt-row" style="margin-top:8px">${acts.join('')}</div>
      <h4>Delivery (Communication Center)</h4>
      <div class="mkt-grid">${this.kpi('Queued', this.n(del.total))}${this.kpi('Sent', this.n(del.sent))}${this.kpi('Delivered', this.n(del.delivered))}${this.kpi('Failed', this.n(del.failed))}${this.kpi('Pending', this.n(del.pending))}</div>
      <div class="mkt-muted">${this.esc(del.note || '')}</div>
      ${res ? this.resultsHtml(res) : ''}
      ${c.content?.body ? `<h4>Message</h4><div class="mkt-pre">${this.esc(c.content.body)}</div>` : ''}
      ${(c.costs || []).length ? `<h4>Recorded costs</h4>${this.table([['Date', (r) => this.esc(String(r.created_at).slice(0, 10))], ['Amount', (r) => this.R(r.amount)], ['Channel', (r) => this.esc(r.channel || '—')], ['Description', (r) => this.esc(r.description)], ['Expense #', (r) => this.esc(r.expense_id || '—')]], c.costs)}` : ''}
      <div id="mkt-camp-extra"></div>
    </div>`;
    host.querySelectorAll('[data-cact]').forEach((b) => { b.onclick = () => this.campaignAction(c, b.dataset.cact); });
    host.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  },

  resultsHtml(r) {
    const a = r.attributed || {};
    const t = r.total_revenue_during_campaign;
    return `<h4>Results</h4>
      <div class="mkt-muted">${this.esc(a.label || '')}</div>
      ${a.note ? `<div class="mkt-warn">${this.esc(a.note)}</div>` : ''}
      <div class="mkt-grid">${this.kpi('Attributed orders', this.n(a.orders))}${this.kpi('Attributed revenue', this.R(a.revenue))}${this.kpi('Discounts given', this.R(a.discount))}${this.kpi('COGS', this.R(a.cogs), a.cogs_incomplete ? 'incomplete' : '')}${this.kpi('Gross profit', this.R(a.gross_profit))}${this.kpi('Marketing cost', this.R(r.marketing_cost))}${this.kpi('Contribution', this.R(r.contribution))}${this.kpi('ROI', r.roi_pct == null ? 'Unavailable' : this.pct(r.roi_pct), r.roi_note || '')}${this.kpi('New customers', this.n(a.new_customers))}${this.kpi('Repeat customers', this.n(a.repeat_customers))}</div>
      ${t ? `<div class="mkt-muted">${this.esc(t.label)}: ${this.R(t.revenue)} from ${this.n(t.orders)} orders (${this.esc(String(t.from).slice(0, 10))} → ${this.esc(String(t.to).slice(0, 10))})</div>` : ''}
      <div class="mkt-muted">Evidence: ${this.esc((a.evidence || []).join('; ') || 'none')}</div>`;
  },

  async campaignAction(c, act) {
    let r = null;
    if (act === 'edit') return this.startWizard(this.wizFromCampaign(c));
    if (act === 'submit') r = await this.api(API.mktSubmitCampaign(c.id));
    if (act === 'approve') r = await this.api(API.mktApproveCampaign(c.id));
    if (act === 'reject') { const note = prompt('Reason for rejection (returned to draft):') ?? null; if (note === null) return; r = await this.api(API.mktRejectCampaign(c.id, note)); }
    if (act === 'launch') {
      if (!confirm(`Launch "${c.name}"? Messages will be queued through the Communication Center (consent and opt-outs apply).`)) return;
      r = await this.api(API.mktLaunchCampaign(c.id));
      if (r?.launch) this.toast(`Launched: ${r.launch.recipients} recipients, ${r.launch.queued} messages queued${r.launch.note ? ' — ' + r.launch.note : ''}`, 'success');
    }
    if (act === 'archive') { if (!confirm(`Archive "${c.name}"? It is hidden from the campaign list but kept with its results and history.`)) return; r = await this.api(API.mktArchiveCampaign(c.id)); }
    if (act === 'unarchive') r = await this.api(API.mktUnarchiveCampaign(c.id));
    if (act === 'history') {
      const h = await this.api(API.mktCampaignHistory(c.id));
      if (!h) return;
      this.el.querySelector('#mkt-camp-extra').innerHTML = `<h4>Audit history</h4>${this.table([['When', (x) => this.esc(String(x.created_at).slice(0, 16))], ['User', (x) => this.esc(x.username || '—')], ['Action', (x) => this.esc(String(x.action).replace(/_/g, ' '))], ['Details', (x) => `<span class="mkt-muted">${this.esc(JSON.stringify(x.details || {}).slice(0, 200))}</span>`]], Array.isArray(h) ? h : (h.history || h.data || []), 'No recorded actions for this campaign.')}`;
      return;
    }
    if (act === 'pause') r = await this.api(API.mktPauseCampaign(c.id));
    if (act === 'resume') r = await this.api(API.mktResumeCampaign(c.id));
    if (act === 'cancel') { if (!confirm('Cancel this campaign? Pending messages are cancelled and its promotion is deactivated.')) return; r = await this.api(API.mktCancelCampaign(c.id)); }
    if (act === 'duplicate') { r = await this.api(API.mktDuplicateCampaign(c.id)); if (r) { this.toast(`Duplicated as #${r.id}`, 'success'); return this.renderTab().then(() => this.showCampaign(r.id)); } return; }
    if (act === 'cost') {
      const amount = prompt('Cost amount (R) — recorded as a Marketing expense in accounting:');
      if (!amount) return;
      const channel = prompt('Channel (whatsapp / sms / email / print / social / other):', 'other') || null;
      const description = prompt('Description:', `Marketing: ${c.name}`) || '';
      r = await this.api(API.mktAddCampaignCost(c.id, { amount, channel, description }));
      if (r) this.toast(r.note, 'success');
    }
    if (act === 'report') {
      const rep = await this.api(API.mktCampaignReport(c.id));
      if (!rep) return;
      this.el.querySelector('#mkt-camp-extra').innerHTML = `<h4>Campaign learning report</h4>
        <div><span class="mkt-tag fact">FACT</span></div><ul>${rep.facts.map((x) => `<li>${this.esc(x)}</li>`).join('')}</ul>
        <div><span class="mkt-tag an">ANALYSIS</span></div><ul>${rep.analysis.map((x) => `<li>${this.esc(x)}</li>`).join('')}</ul>`;
      return;
    }
    if (r) { this.toast('Done', 'success'); await this.renderTab(); this.showCampaign(c.id); }
  },

  wizFromCampaign(c) {
    return {
      id: c.id, name: c.name, objective: c.objective, audience: c.audience, branch_id: c.branch_id || '', products: c.products || [],
      offer: { kind: c.promotion_type || '' }, promotion_ref_id: c.promotion_ref_id, promotion_code: c.promotion_code, promotion_type: c.promotion_type,
      channels: c.channels || [], content: c.content || {}, start_at: (c.start_at || '').slice(0, 10), end_at: (c.end_at || '').slice(0, 10),
      scheduled_at: c.scheduled_at ? c.scheduled_at.slice(0, 16).replace(' ', 'T') : '', budget: c.budget ?? '', estimated_cost: c.estimated_cost ?? '',
      expected_redemptions: c.expected_redemptions ?? '', ab_group: c.ab_group || '', variant_label: c.variant_label || '', status: c.status
    };
  },

  startWizard(seed) {
    this.wiz = {
      step: 0, name: '', objective: 'increase_sales', audience: { type: 'segment', segment: 'returning' }, branch_id: this.filters.branch_id || '',
      products: [], offer: {}, channels: [], content: { body: '', subject: '' }, start_at: '', end_at: '', scheduled_at: '',
      budget: '', estimated_cost: '', expected_redemptions: '', ab_group: '', variant_label: '', ...seed
    };
    this.wiz.offer = { ...(seed.offer || {}) };
    if (this.tab !== 'campaigns') return this.go('campaigns');
    return this.renderTab();
  },

  async loadProducts() {
    if (this.products) return this.products;
    const p = await this.api(API.mktProducts(this.f()));
    this.products = (p?.all || []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return this.products;
  },

  productOptions(sel) {
    return `<option value="">— choose —</option>` + (this.products || []).map((p) => `<option value="${p.product_id}"${Number(sel) === p.product_id ? ' selected' : ''}>${this.esc(p.name)} (${this.R(p.price)})</option>`).join('');
  },

  readWizard() {
    const w = this.wiz; const b = this.body();
    const v = (id) => b.querySelector(`#w-${id}`)?.value;
    const has = (id) => !!b.querySelector(`#w-${id}`);
    if (has('name')) w.name = v('name');
    if (has('objective')) w.objective = v('objective');
    if (has('aud-type')) {
      const type = v('aud-type');
      if (type === 'segment') {
        const params = {};
        if (has('aud-days') && v('aud-days')) params.days = Number(v('aud-days'));
        if (has('aud-product') && v('aud-product')) params.product_id = Number(v('aud-product'));
        if (has('aud-branch') && v('aud-branch')) params.branch_id = Number(v('aud-branch'));
        if (has('aud-min') && v('aud-min') !== '') params.min = Number(v('aud-min'));
        if (has('aud-max') && v('aud-max') !== '') params.max = Number(v('aud-max'));
        w.audience = { type, segment: v('aud-seg'), params };
      } else if (type === 'customers') w.audience = { type, ids: w.audience.type === 'customers' ? (w.audience.ids || []) : [...this.selected] };
      else w.audience = { type };
    }
    if (has('branch')) w.branch_id = v('branch');
    if (has('offer-kind')) {
      const ov = (id) => b.querySelector(`#o-${id}`);
      const prevKind = w.offer.kind;
      const o = { kind: v('offer-kind') };
      if (o.kind === prevKind) {
        ['discount_type', 'discount_value', 'product_id', 'get_product_id', 'buy_qty', 'get_qty', 'get_discount_pct', 'min_order_total', 'max_discount', 'max_uses',
          'final_price', 'pricing_type', 'valid_time_start', 'valid_time_end', 'code'].forEach((k) => { const x = ov(k); o[k] = x ? x.value : w.offer[k]; });
        o.items = w.offer.items;
        if (ov('bundle-a')) {
          o.items = [0, 1, 2].map((i) => ({ product_id: Number(ov(`bundle-${'abc'[i]}`)?.value) || 0, quantity: Number(ov(`bundle-q${i + 1}`)?.value) || 1 })).filter((x) => x.product_id);
        }
      } else if (['bundle', 'time_based'].includes(o.kind) && w.offer.items) o.items = w.offer.items;
      o.proceed_without_stock = !!b.querySelector('#o-proceed')?.checked;
      w.offer = o;
    }
    if (has('body')) { w.content = { ...w.content, body: v('body'), subject: v('subject') || '' }; }
    if (b.querySelector('[data-wch]')) w.channels = [...b.querySelectorAll('[data-wch]:checked')].map((x) => x.value);
    ['start_at', 'end_at', 'scheduled_at', 'budget', 'estimated_cost', 'expected_redemptions', 'ab_group', 'variant_label'].forEach((k) => { if (has(k)) w[k] = v(k); });
  },

  async saveWizardCampaign() {
    const w = this.wiz;
    const payload = {
      id: w.id || undefined, name: w.name, objective: w.objective, audience: w.audience, branch_id: w.branch_id || null, products: w.products,
      promotion_type: w.promotion_type || (w.offer.kind && !['none', ''].includes(w.offer.kind) ? w.offer.kind : null),
      promotion_ref_id: w.promotion_ref_id || null, promotion_code: w.promotion_code || null,
      channels: w.channels, content: w.content, start_at: w.start_at || null, end_at: w.end_at || null,
      scheduled_at: w.scheduled_at ? w.scheduled_at.replace('T', ' ') + ':00' : null, budget: w.budget, estimated_cost: w.estimated_cost,
      expected_redemptions: w.expected_redemptions, ab_group: w.ab_group || null, variant_label: w.variant_label || null, source: w.source || null,
      recommendation_id: w.recommendation_id || undefined
    };
    if (w.offer.kind === 'loyalty' || w.offer.kind === 'none') payload.promotion_type = w.offer.kind;
    const c = await this.api(API.mktSaveCampaign(payload));
    if (!c) return null;
    w.id = c.id; w.status = c.status;
    const needsPromo = ['voucher', 'free_delivery', 'bundle', 'bogo', 'buy_x_get_y', 'time_based', 'referral_code'].includes(w.offer.kind) && !w.promotion_ref_id;
    if (needsPromo) {
      const p = await this.api(API.mktCreatePromotion({
        ...w.offer, campaign_id: c.id, name: w.name, branch_id: w.branch_id || null, start_date: w.start_at || null, end_date: w.end_at || null
      }));
      if (!p) return c;
      w.promotion_ref_id = p.id; w.promotion_code = p.code; w.promotion_type = w.offer.kind;
      this.toast(`Promotion created in ${p.engine === 'combos' ? 'Combos' : p.engine === 'discount_vouchers' ? 'Discount vouchers' : 'Referral'}: ${p.code}${p.approval_status === 'pending' ? ' (pending owner approval)' : ''}`, 'success');
    }
    return c;
  },

  async renderWizard(body) {
    const w = this.wiz;
    const meta = this.meta || {};
    const step = w.step;
    const steps = `<div class="mkt-steps">${this.WIZ_STEPS.map((s, i) => `<span class="mkt-step${i === step ? ' on' : i < step ? ' done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
    let html = '';
    if (step === 0) {
      html = `<div class="mkt-row"><label style="flex:1">Campaign name<input id="w-name" value="${this.esc(w.name)}" style="min-width:280px"></label>
        <label>Goal<select id="w-objective">${Object.entries(meta.objectives || {}).map(([k, l]) => `<option value="${k}"${k === w.objective ? ' selected' : ''}>${this.esc(l)}</option>`).join('')}</select></label>
        <label>Branch<select id="w-branch"><option value="">All branches</option>${this.branches.map((b) => `<option value="${b.id}"${String(b.id) === String(w.branch_id) ? ' selected' : ''}>${this.esc(b.name)}</option>`).join('')}</select></label></div>`;
    } else if (step === 1) {
      await this.loadProducts();
      const a = w.audience || {};
      const segs = (this._segDefs || [
        ['new', 'New customers'], ['returning', 'Returning customers'], ['inactive', 'Inactive customers'], ['high_value', 'High-value customers'], ['loyalty', 'Loyalty members'],
        ['referral', 'Referral customers'], ['online', 'Online customers'], ['pos', 'POS customers'], ['delivery', 'Delivery customers'], ['product', 'Buyers of a product'],
        ['branch', 'Customers of a branch'], ['spend_band', 'Spending band'], ['frequency_band', 'Order frequency band'], ['declining', 'Declining activity'], ['overdue', 'Overdue for usual purchase']]);
      const p = a.params || {};
      html = `<div class="mkt-row">
        <label>Audience<select id="w-aud-type"><option value="segment"${a.type === 'segment' ? ' selected' : ''}>Segment</option><option value="customers"${a.type === 'customers' ? ' selected' : ''}>Selected customers (${a.type === 'customers' ? (a.ids || []).length : this.selected.size})</option><option value="all_customers"${a.type === 'all_customers' ? ' selected' : ''}>All customers</option></select></label>
        <label>Segment<select id="w-aud-seg">${segs.map(([k, l]) => `<option value="${k}"${k === a.segment ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Inactive / new days<select id="w-aud-days"><option value="">Default</option>${[7, 14, 30, 60, 90].map((d) => `<option${Number(p.days) === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
        <label>Product (product segment)<select id="w-aud-product">${this.productOptions(p.product_id)}</select></label>
        <label>Branch (branch segment)<select id="w-aud-branch"><option value="">—</option>${this.branches.map((b) => `<option value="${b.id}"${Number(p.branch_id) === Number(b.id) ? ' selected' : ''}>${this.esc(b.name)}</option>`).join('')}</select></label>
        <label>Min (spend R / orders)<input id="w-aud-min" type="number" value="${p.min ?? ''}" style="width:110px"></label>
        <label>Max<input id="w-aud-max" type="number" value="${p.max ?? ''}" style="width:110px"></label>
        <button class="mkt-btn" id="w-aud-preview">Preview audience</button></div>
        <div id="w-aud-out" class="mkt-muted">Preview shows reachable customers per channel after consent, opt-outs and suppressions.</div>`;
    } else if (step === 2) {
      await this.loadProducts();
      const o = w.offer || {};
      const kind = o.kind || '';
      const field = (id, label, val, type = 'text', extra = '') => `<label>${label}<input id="o-${id}" type="${type}" value="${this.esc(val ?? '')}" ${extra}></label>`;
      let fields = '';
      if (w.promotion_ref_id) fields = `<div class="mkt-ok">Promotion already created: ${this.esc(w.promotion_type)} ${this.esc(w.promotion_code || '')} (#${w.promotion_ref_id}). Duplicate the campaign to use a different offer.</div>`;
      else if (kind === 'voucher') fields = `<label>Type<select id="o-discount_type"><option value="percent"${o.discount_type !== 'amount' ? ' selected' : ''}>Percent</option><option value="amount"${o.discount_type === 'amount' ? ' selected' : ''}>Fixed amount (R)</option></select></label>${field('discount_value', 'Value', o.discount_value, 'number')}<label>Product (optional)<select id="o-product_id">${this.productOptions(o.product_id)}</select></label>${field('min_order_total', 'Min order (R)', o.min_order_total, 'number')}${field('max_discount', 'Max discount (R)', o.max_discount, 'number')}${field('max_uses', 'Max uses', o.max_uses || 1000, 'number')}${field('code', 'Code (optional)', o.code)}`;
      else if (kind === 'free_delivery') fields = `${field('min_order_total', 'Min order (R)', o.min_order_total, 'number')}${field('max_uses', 'Max uses', o.max_uses || 1000, 'number')}${field('code', 'Code (optional)', o.code)}<div class="mkt-muted">Applies to online delivery orders only.</div>`;
      else if (kind === 'bundle' || kind === 'time_based') {
        const items = o.items || [];
        fields = [0, 1, 2].map((i) => `<label>Product ${i + 1}<select id="o-bundle-${'abc'[i]}">${this.productOptions(items[i]?.product_id)}</select></label>${field(`bundle-q${i + 1}`, 'Qty', items[i]?.quantity || 1, 'number', 'style="width:70px"')}`).join('') +
          `<label>Pricing<select id="o-pricing_type"><option value="fixed"${o.pricing_type === 'fixed' || !o.pricing_type ? ' selected' : ''}>Fixed bundle price</option><option value="percent"${o.pricing_type === 'percent' ? ' selected' : ''}>Percent off</option><option value="fixed_discount"${o.pricing_type === 'fixed_discount' ? ' selected' : ''}>Rand off</option></select></label>${field('final_price', 'Bundle price (R)', o.final_price, 'number')}${field('discount_value', 'Discount value', o.discount_value, 'number')}` +
          (kind === 'time_based' ? `${field('valid_time_start', 'From', o.valid_time_start, 'time')}${field('valid_time_end', 'To', o.valid_time_end, 'time')}` : '');
      } else if (kind === 'bogo') fields = `<label>Product<select id="o-product_id">${this.productOptions(o.product_id)}</select></label>${field('buy_qty', 'Buy qty', o.buy_qty || 1, 'number')}${field('get_qty', 'Free qty', o.get_qty || 1, 'number')}`;
      else if (kind === 'buy_x_get_y') fields = `<label>Buy product<select id="o-product_id">${this.productOptions(o.product_id)}</select></label>${field('buy_qty', 'Buy qty', o.buy_qty || 1, 'number')}<label>Get product<select id="o-get_product_id">${this.productOptions(o.get_product_id)}</select></label>${field('get_qty', 'Get qty', o.get_qty || 1, 'number')}${field('get_discount_pct', 'Discount on Y % (100 = free)', o.get_discount_pct ?? 100, 'number')}`;
      else if (kind === 'referral_code') fields = field('code', 'Existing referral code', o.code);
      html = `<div class="mkt-row"><label>Offer<select id="w-offer-kind"><option value="">— choose —</option>${Object.entries(this.PROMO_LABELS).map(([k, l]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="mkt-row">${fields}</div>
        ${kind && !w.promotion_ref_id && !['none', 'loyalty', 'referral_code'].includes(kind) ? `<div class="mkt-row"><button class="mkt-btn" id="w-promo-preview">Financial preview of offer</button><label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="o-proceed"${o.proceed_without_stock ? ' checked' : ''}> Proceed even if out of stock</label></div>` : ''}
        <div id="w-promo-out"></div>
        <div class="mkt-muted">The promotion is created in the existing Combos or Discount Voucher engine when you save at the Financial preview step. Owner-created combos are active immediately; others need approval in Combos & Promos.</div>`;
    } else if (step === 3) {
      await this.loadProducts();
      html = `<div class="mkt-row"><label style="flex:1">Message (WhatsApp/SMS/Email body) — {{customer_name}} and {{code}} are filled per customer<textarea id="w-body" rows="6" style="min-width:420px">${this.esc(w.content.body || '')}</textarea></label></div>
        <div class="mkt-row"><label style="flex:1">Email subject<input id="w-subject" value="${this.esc(w.content.subject || '')}"></label></div>
        <div class="mkt-row"><label>Products to feature<select id="w-feat" multiple size="5" style="min-width:260px">${(this.products || []).map((p) => `<option value="${p.product_id}"${(w.products || []).includes(p.product_id) ? ' selected' : ''}>${this.esc(p.name)} (${this.R(p.price)})</option>`).join('')}</select></label>
        <button class="mkt-btn" id="w-gen">Generate from real prices</button>
        <button class="mkt-btn" id="w-menu">Open Menu Builder</button><button class="mkt-btn" id="w-video">Open Promo Video Builder</button></div>
        <div id="w-gen-out"></div>`;
    } else if (step === 4) {
      const chs = meta.channels || {};
      html = `<div class="mkt-row">${['whatsapp', 'sms', 'email'].map((ch) => `<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-wch value="${ch}"${w.channels.includes(ch) ? ' checked' : ''}> ${ch.toUpperCase()}</label>`).join('')}</div>
        ${this.channelBlock(chs)}<div class="mkt-muted">Leave all unchecked for a promotion-only campaign (no messages). Consent, opt-out, quiet hours and limits are enforced by the Communication Center.</div>`;
    } else if (step === 5) {
      const fld = (id, label, val, type) => `<label>${label}<input id="w-${id}" type="${type}" value="${this.esc(val ?? '')}"></label>`;
      html = `<div class="mkt-row">${fld('start_at', 'Start date', w.start_at, 'date')}${fld('end_at', 'End date', w.end_at, 'date')}${fld('scheduled_at', 'Send messages at (optional)', w.scheduled_at, 'datetime-local')}</div>
        <div class="mkt-row">${fld('budget', 'Budget (R)', w.budget, 'number')}${fld('estimated_cost', 'Estimated cost (R)', w.estimated_cost, 'number')}${fld('expected_redemptions', 'Expected redemptions (your estimate)', w.expected_redemptions, 'number')}</div>
        <div class="mkt-row">${fld('ab_group', 'A/B test group (optional)', w.ab_group, 'text')}${fld('variant_label', 'Variant label (A, B…)', w.variant_label, 'text')}</div>`;
    } else if (step === 6) {
      html = `<div class="mkt-row"><button class="mkt-btn p" id="w-save-preview">Save draft &amp; calculate preview</button></div><div id="w-fin-out">${w._preview ? this.finHtml(w._preview) : '<p class="mkt-muted">Save to create the campaign (and its promotion) and see the financial preview.</p>'}</div>`;
    } else if (step === 7) {
      html = `<p>Campaign #${w.id || '—'} status: <span class="mkt-status ${w.status || ''}">${this.esc(w.status || 'not saved')}</span></p>
        <div class="mkt-row">${w.status === 'draft' ? '<button class="mkt-btn p" id="w-submit">Submit for approval</button>' : ''}${w.status === 'awaiting_approval' ? '<button class="mkt-btn p" id="w-approve">Approve</button><button class="mkt-btn" id="w-reject">Reject</button>' : ''}</div>
        <div class="mkt-muted">Approval requires the "Marketing — Approve campaigns" permission (owners by default). Editing an approved campaign returns it to draft.</div>`;
    } else if (step === 8) {
      const chs = await this.api(API.mktChannelStatus());
      html = `<p>Campaign #${w.id || '—'} status: <span class="mkt-status ${w.status || ''}">${this.esc(w.status || '')}</span></p>
        ${w.channels.length ? w.channels.map((ch) => (chs?.[ch]?.ready ? `<div class="mkt-ok">${ch.toUpperCase()} ready</div>` : `<div class="mkt-warn">${this.esc(chs?.[ch]?.message || ch + ' not ready')}</div>`)).join('') : '<div class="mkt-muted">No message channels — launching activates the promotion period only.</div>'}
        <div class="mkt-row">${w.status === 'approved' ? '<button class="mkt-btn p" id="w-launch">Launch campaign</button>' : '<span class="mkt-muted">Only approved campaigns can be launched.</span>'}</div>`;
    }
    body.innerHTML = `<div class="mkt-card"><h3>${w.id ? `Edit campaign #${w.id}` : 'New campaign'}</h3>${steps}${html}
      <div class="mkt-row" style="margin-top:12px;justify-content:space-between">
        <div><button class="mkt-btn" id="w-close">Close wizard</button>${step < 6 ? ' <button class="mkt-btn" id="w-save">Save draft</button>' : ''}</div>
        <div>${step > 0 ? '<button class="mkt-btn" id="w-back">← Back</button>' : ''} ${step < 8 ? '<button class="mkt-btn p" id="w-next">Next →</button>' : ''}</div>
      </div></div>`;
    this.bindWizard(body);
  },

  finHtml(p) {
    const pr = p.promotion;
    return `<div class="mkt-grid">${this.kpi('Audience', this.n(p.audience_size), `${p.suppressed} suppressed`)}${Object.entries(p.consent || {}).map(([ch, c]) => this.kpi(`${ch} reachable`, this.n(c.reachable), `${c.opted_out} opted out · ${c.no_address} no address`)).join('')}</div>
      ${pr ? (pr.insufficient ? `<div class="mkt-warn">${this.esc(pr.message)}</div>` : `<h4>Offer economics (${this.esc(pr.basis || '')})</h4><div class="mkt-grid">${this.kpi('Normal price', this.R(pr.normal_price))}${this.kpi('Promo price', this.R(pr.promo_price))}${this.kpi('Discount', this.R(pr.discount))}${this.kpi('COGS', this.R(pr.cogs))}${this.kpi('Gross profit', this.R(pr.gross_profit))}${this.kpi('Margin', this.pct(pr.gross_margin_pct))}</div>`) : ''}
      ${p.expected ? `<h4>${this.esc(p.expected.label)}</h4><div class="mkt-grid">${this.kpi('Expected revenue', this.R(p.expected.revenue))}${this.kpi('Expected discount', this.R(p.expected.discount))}${this.kpi('Expected COGS', this.R(p.expected.cogs))}${this.kpi('Expected gross profit', this.R(p.expected.gross_profit))}${this.kpi('Campaign cost', this.R(p.campaign_cost))}${this.kpi('Expected contribution', this.R(p.expected.contribution))}${this.kpi('Expected ROI', p.expected.roi_pct == null ? 'Unavailable' : this.pct(p.expected.roi_pct))}</div>` : ''}
      ${p.historical_response ? `<div class="mkt-muted">Historical response rate: ${p.historical_response.rate_pct}% (${p.historical_response.orders} orders from ${p.historical_response.recipients} recipients over ${p.historical_response.campaigns} completed campaigns)</div>` : '<div class="mkt-muted">No completed campaigns yet — no historical response rate.</div>'}
      ${this.warnList(p.warnings)}`;
  },

  bindWizard(body) {
    const w = this.wiz;
    const $ = (id) => body.querySelector(`#${id}`);
    const rerender = () => this.renderWizard(body);
    $('w-close').onclick = () => { this.wiz = null; this.renderTab(); };
    if ($('w-save')) $('w-save').onclick = async () => { this.readWizard(); const c = await this.saveWizardCampaign(); if (c) this.toast(`Draft #${c.id} saved`, 'success'); };
    if ($('w-back')) $('w-back').onclick = () => { this.readWizard(); w.step -= 1; rerender(); };
    if ($('w-next')) $('w-next').onclick = () => {
      this.readWizard();
      if (w.step === 0 && !String(w.name || '').trim()) return this.toast('Enter a campaign name', 'error');
      if (w.step === 6 && !w.id) return this.toast('Save the draft first', 'error');
      w.step += 1; rerender();
    };
    if ($('w-offer-kind')) $('w-offer-kind').onchange = () => { this.readWizard(); rerender(); };
    if ($('w-aud-preview')) $('w-aud-preview').onclick = async () => {
      this.readWizard();
      const r = await this.api(API.mktPreviewAudience(w.audience, w.branch_id || null, w.channels.length ? w.channels : ['whatsapp', 'sms', 'email']));
      if (!r) return;
      $('w-aud-out').innerHTML = `<div class="mkt-grid">${this.kpi('Customers', this.n(r.count), `${r.suppressed} suppressed`)}${Object.entries(r.consent).map(([ch, c]) => this.kpi(`${ch} reachable`, this.n(c.reachable), `${c.opted_out} opted out · ${c.no_address} no address`)).join('')}</div>
        ${this.table([['Customer', (x) => this.esc(x.name)], ['Phone', (x) => this.esc(x.phone_masked || '—')], ['Email', (x) => (x.has_email ? 'yes' : '—')]], r.sample, 'Audience is empty.')}`;
    };
    if ($('w-promo-preview')) $('w-promo-preview').onclick = async () => {
      this.readWizard();
      const r = await this.api(API.mktPreviewPromotion({ ...w.offer, branch_id: w.branch_id || null }));
      if (!r) return;
      $('w-promo-out').innerHTML = r.insufficient ? `<div class="mkt-warn">${this.esc(r.message)}</div>` : `<div class="mkt-card"><div class="mkt-muted">${this.esc(r.basis || '')}</div>
        <div class="mkt-grid">${this.kpi('Normal price', this.R(r.normal_price))}${this.kpi('Promo price', this.R(r.promo_price))}${this.kpi('Discount', this.R(r.discount), r.discount_pct != null ? `${r.discount_pct}%` : '')}${this.kpi('COGS', this.R(r.cogs))}${this.kpi('Gross profit', this.R(r.gross_profit))}${this.kpi('Margin', this.pct(r.gross_margin_pct))}</div>
        ${r.cost_basis ? `<div class="mkt-muted">${this.esc(r.cost_basis)}</div>` : ''}${r.note ? `<div class="mkt-muted">${this.esc(r.note)}</div>` : ''}${this.warnList(r.warnings)}</div>`;
    };
    if ($('w-gen')) $('w-gen').onclick = async () => {
      w.products = [...$('w-feat').selectedOptions].map((o) => Number(o.value));
      const r = await this.api(API.mktGenerateContent({ product_ids: w.products, campaign_id: w.id || null, branch_id: w.branch_id || null, use_ai: true }));
      if (!r) return;
      if (!r.ok) { $('w-gen-out').innerHTML = this.warnList(r.missing); return; }
      $('w-body').value = r.content.whatsapp;
      if (!$('w-subject').value) $('w-subject').value = r.content.email_subject;
      $('w-gen-out').innerHTML = `<div class="mkt-muted">Generated by ${this.esc(r.engine)} from real product prices${r.promotion ? ' and the linked promotion' : ''}.</div>${this.warnList(r.missing)}`;
    };
    const feat = () => ($('w-feat') ? [...$('w-feat').selectedOptions].map((o) => Number(o.value)) : w.products);
    if ($('w-menu')) $('w-menu').onclick = () => { this.readWizard(); this.handoff('menu-builder', { products: feat(), title: w.name, campaign_id: w.id || null }); };
    if ($('w-video')) $('w-video').onclick = () => { this.readWizard(); this.handoff('promo-video-builder', { products: feat(), title: w.name, campaign_id: w.id || null }); };
    if ($('w-feat')) $('w-feat').onchange = () => { w.products = feat(); };
    if ($('w-save-preview')) $('w-save-preview').onclick = async () => {
      const c = await this.saveWizardCampaign();
      if (!c) return;
      const p = await this.api(API.mktFinancialPreview(c.id));
      if (p) { w._preview = p; $('w-fin-out').innerHTML = this.finHtml(p); }
    };
    const statusAct = async (fn) => { const c = await this.api(fn); if (c) { w.status = c.status; this.toast(`Status: ${c.status.replace(/_/g, ' ')}`, 'success'); rerender(); } };
    if ($('w-submit')) $('w-submit').onclick = () => statusAct(API.mktSubmitCampaign(w.id));
    if ($('w-approve')) $('w-approve').onclick = () => statusAct(API.mktApproveCampaign(w.id));
    if ($('w-reject')) $('w-reject').onclick = () => { const n = prompt('Reason:'); if (n !== null) statusAct(API.mktRejectCampaign(w.id, n)); };
    if ($('w-launch')) $('w-launch').onclick = async () => {
      if (!confirm('Launch now? Messages are queued through the Communication Center (consent and opt-outs apply).')) return;
      const r = await this.api(API.mktLaunchCampaign(w.id));
      if (!r) return;
      this.toast(`Launched: ${r.launch.recipients} recipients, ${r.launch.queued} messages queued`, 'success');
      const id = w.id; this.wiz = null; await this.renderTab(); this.showCampaign(id);
    };
  },

  /* ─────────── Promotions ─────────── */
  async tPromotions(body) {
    const rows = await this.api(API.mktCampaigns(this.f()));
    const withPromo = (rows || []).filter((r) => r.promotion_type && !['none', 'loyalty'].includes(r.promotion_type));
    body.innerHTML = `<div class="mkt-card"><h3>Promotions linked to campaigns</h3>
      <p class="mkt-muted">Promotions are created in the existing engines: Combos &amp; Promos (bundles, buy X get X/Y, time-based) and Discount Vouchers (percent, fixed, free delivery, per-customer codes). Branch limits, minimum order and maximum discount are enforced at checkout.</p>
      <div class="mkt-row"><button class="mkt-btn p" id="mkt-new-promo">＋ New promotion campaign</button><button class="mkt-btn" id="mkt-open-combos">Open Combos &amp; Promos</button></div>
      ${this.table([['Campaign', (r) => `#${r.id} ${this.esc(r.name)}`], ['Type', (r) => this.esc(this.PROMO_LABELS[r.promotion_type] || r.promotion_type)], ['Code', (r) => this.esc(r.promotion_code || '—')], ['Status', (r) => `<span class="mkt-status ${r.status}">${this.esc(r.status)}</span>`], ['Dates', (r) => this.esc(`${(r.start_at || '').slice(0, 10) || '—'} → ${(r.end_at || '').slice(0, 10) || '—'}`)], ['', (r) => `<button class="mkt-btn sm" data-res="${r.id}">Results</button>`]], withPromo, 'No promotions created from Marketing yet.')}
      <div id="mkt-promo-res"></div></div>`;
    body.querySelector('#mkt-new-promo').onclick = () => this.startWizard({ step: 0, offer: { kind: 'voucher' }, objective: 'increase_sales' });
    body.querySelector('#mkt-open-combos').onclick = () => this.handoff('combos', {});
    body.querySelectorAll('[data-res]').forEach((b) => { b.onclick = async () => { const r = await this.api(API.mktCampaignResults(Number(b.dataset.res))); if (r) body.querySelector('#mkt-promo-res').innerHTML = this.resultsHtml(r); }; });
  },

  /* ─────────── Customers ─────────── */
  async tCustomers(body) {
    const f = this.f();
    if (this._custSegment) { f.segment = this._custSegment.segment; f.params = this._custSegment.params; }
    if (this._custIds) f.ids = this._custIds;
    const d = await this.api(API.mktCustomers(f));
    if (!d) { body.innerHTML = '<div class="mkt-warn">Customers unavailable.</div>'; return; }
    const segs = (this.meta && this._segDefs) || null;
    body.innerHTML = `<div class="mkt-card">
      <div class="mkt-row"><label>Segment<select id="mkt-cseg"><option value="">All purchasing customers</option>${['new', 'returning', 'inactive', 'high_value', 'loyalty', 'referral', 'online', 'pos', 'delivery', 'declining', 'overdue'].map((k) => `<option value="${k}"${f.segment === k ? ' selected' : ''}>${k.replace(/_/g, ' ')}</option>`).join('')}</select></label>
      <button class="mkt-btn" id="mkt-csel-all">Select shown</button><button class="mkt-btn" id="mkt-csel-none">Clear selection</button>
      <button class="mkt-btn p" id="mkt-csel-camp">Campaign for selected (<span id="mkt-selc">${this.selected.size}</span>)</button></div>
      <div class="mkt-muted">${d.total} customers${f.ids ? ' (from Decision Center card)' : ''}; showing top ${d.customers.length} by spend in the last ${d.window.days} days. Phones are masked.</div>
      ${this.table([
        ['', (c) => `<input type="checkbox" data-cid="${c.id}"${this.selected.has(c.id) ? ' checked' : ''}>`],
        ['Customer', (c) => `<a href="#" data-cd="${c.id}">${this.esc(c.name)}</a><div class="mkt-muted">${this.esc(c.phone_masked || '')}</div>`],
        ['Orders', (c) => this.n(c.orders)], ['Spend', (c) => this.R(c.spend)], ['AOV', (c) => this.R(c.aov)],
        ['Last purchase', (c) => `${this.esc(c.last_purchase)}<div class="mkt-muted">${c.days_since_last} days ago</div>`],
        ['Usual interval', (c) => (c.avg_interval_days != null ? `${c.avg_interval_days} d` : '—')],
        ['Favourite products', (c) => this.esc((c.top_products || []).map((t) => t.name).join(', '))],
        ['Branch / channel', (c) => this.esc(`${c.branch || '—'} · ${c.preferred_channel || '—'}`)],
        ['Points', (c) => this.n(c.loyalty_points)],
        ['12-mo value', (c) => (c.lifetime?.estimate != null ? `${this.R(c.lifetime.estimate)}<div class="mkt-muted">ESTIMATE</div>` : '<span class="mkt-muted">insufficient data</span>')],
        ['Signals', (c) => [c.overdue ? `<span class="mkt-tag">overdue</span>` : '', c.declining ? `<span class="mkt-tag">declining</span>` : ''].join('')]
      ], d.customers, 'Insufficient data — no customer-linked sales in this window.')}
      <div id="mkt-cdetail"></div></div>`;
    body.querySelector('#mkt-cseg').onchange = (e) => { this._custIds = null; this._custSegment = e.target.value ? { segment: e.target.value, params: {} } : null; this.renderTab(); };
    const upd = () => { const s = body.querySelector('#mkt-selc'); if (s) s.textContent = this.selected.size; };
    body.querySelectorAll('[data-cid]').forEach((cb) => { cb.onchange = () => { const id = Number(cb.dataset.cid); if (cb.checked) this.selected.add(id); else this.selected.delete(id); upd(); }; });
    body.querySelector('#mkt-csel-all').onclick = () => { d.customers.forEach((c) => this.selected.add(c.id)); body.querySelectorAll('[data-cid]').forEach((cb) => { cb.checked = true; }); upd(); };
    body.querySelector('#mkt-csel-none').onclick = () => { this.selected.clear(); body.querySelectorAll('[data-cid]').forEach((cb) => { cb.checked = false; }); upd(); };
    body.querySelector('#mkt-csel-camp').onclick = () => {
      if (!this.selected.size) return this.toast('Select customers first', 'error');
      this.startWizard({ audience: { type: 'customers', ids: [...this.selected] } });
    };
    body.querySelectorAll('[data-cd]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); this.customerDetail(Number(a.dataset.cd)); }; });
    void segs;
  },

  async customerDetail(id) {
    const d = await this.api(API.mktCustomerDetail(id, this.f()));
    if (!d) return;
    const host = this.body().querySelector('#mkt-cdetail');
    const b = d.behaviour || {};
    host.innerHTML = `<div class="mkt-card"><h3>${this.esc(d.name)}</h3>
      <div class="mkt-muted">${this.esc(d.phone_masked || 'no phone')} · email: ${d.has_email ? 'yes' : 'no'} · points ${this.n(d.loyalty_points)} · birthday ${this.esc(d.birthday || '—')} · ${this.esc(d.anniversary_type || 'anniversary')} ${this.esc(d.anniversary_date || '—')}${d.suppressed ? ' · <b>suppressed from marketing</b>' : ''}</div>
      ${d.note ? `<div class="mkt-warn">${this.esc(d.note)}</div>` : ''}
      ${d.behaviour ? `<div class="mkt-grid">${this.kpi('Orders', this.n(b.orders))}${this.kpi('Spend', this.R(b.spend))}${this.kpi('AOV', this.R(b.aov))}${this.kpi('First purchase', this.esc(b.first_purchase))}${this.kpi('Last purchase', this.esc(b.last_purchase))}${this.kpi('Usual interval', b.avg_interval_days != null ? `${b.avg_interval_days} days` : '—')}${this.kpi('Delivery orders', this.n(b.delivery_orders))}${this.kpi('Referral orders', this.n(b.referral_orders))}</div>` : ''}
      <div><b>12-month value:</b> ${d.lifetime?.estimate != null ? `${this.R(d.lifetime.estimate)} — ${this.esc(d.lifetime.note)}` : this.esc(d.lifetime?.note || 'Insufficient data')}</div>
      ${d.overdue ? `<div class="mkt-warn">Overdue: usually buys every ${d.overdue.usual_interval_days} days; last purchase ${d.overdue.days_since_last} days ago (pattern, not a certainty).</div>` : ''}
      ${d.declining ? `<div class="mkt-warn">Declining: ${d.declining.prior_monthly}/month before, ${d.declining.recent_30d} in the last 30 days.</div>` : ''}
      <div><b>Next-purchase pattern:</b> ${b.avg_interval_days && b.orders >= 3 ? `usually every ${b.avg_interval_days} days${(b.top_products || []).length ? `, often ${this.esc(b.top_products.map((t) => t.name).join(', '))}` : ''} — based on previous behaviour.` : 'Insufficient data (needs 3+ orders).'}</div>
      <div><b>Consent:</b> ${d.consent ? this.esc(Object.entries(d.consent).filter(([k]) => /opt|allow|marketing|whatsapp|sms|email/.test(k)).map(([k, v]) => `${k}=${v}`).join(', ')) : 'no saved preferences (defaults apply)'}</div>
      <div><b>Referral:</b> ${d.referral ? this.esc(`${d.referral.referral_code || ''} (${d.referral.source || ''})`) : 'none'}</div>
      <div class="mkt-row" style="margin-top:8px">${d.suppressed ? '' : '<button class="mkt-btn sm" id="mkt-supp">Suppress from marketing</button>'}</div>
      <h4>Loyalty history</h4>${this.table([['Date', (r) => this.esc(String(r.created_at).slice(0, 16))], ['Type', (r) => this.esc(r.type)], ['Points', (r) => this.n(r.points)], ['Sale', (r) => this.esc(r.sale_id || '—')], ['Notes', (r) => this.esc(r.notes || '')]], d.loyalty_history, 'No loyalty transactions.')}</div>`;
    const s = host.querySelector('#mkt-supp');
    if (s) s.onclick = async () => { const reason = prompt('Reason for suppression:'); if (reason === null) return; if (await this.api(API.mktAddSuppression({ customer_id: id, reason }))) { this.toast('Customer suppressed from marketing', 'success'); this.customerDetail(id); } };
  },

  /* ─────────── Segments ─────────── */
  async tSegments(body) {
    const d = await this.api(API.mktSegments(this.f()));
    if (!d) return;
    body.innerHTML = `<div class="mkt-card"><h3>Segments (last ${d.window.days} days)</h3>
      ${this.table([['Segment', (s) => this.esc(s.label)], ['Customers', (s) => this.n(s.count)], ['Share', (s) => this.pct(s.share_pct)], ['Spend', (s) => this.R(s.spend)], ['', (s) => `<button class="mkt-btn sm" data-sv="${s.key}">View</button> <button class="mkt-btn sm" data-sc="${s.key}">Campaign</button>`]], d.segments)}
      <p class="mkt-muted">Product, branch, spending-band and frequency-band segments are built in the campaign wizard (Audience step).</p></div>`;
    body.querySelectorAll('[data-sv]').forEach((b) => { b.onclick = () => { this._custIds = null; this._custSegment = { segment: b.dataset.sv, params: {} }; this.go('customers'); }; });
    body.querySelectorAll('[data-sc]').forEach((b) => { b.onclick = () => this.startWizard({ audience: { type: 'segment', segment: b.dataset.sc, params: {} } }); });
  },

  /* ─────────── Loyalty ─────────── */
  async tLoyalty(body) {
    const d = await this.api(API.mktLoyalty(this.f()));
    if (!d) return;
    body.innerHTML = `<div class="mkt-card"><h3>Loyalty (existing engine — read only)</h3>
      ${d.rules ? `<div class="mkt-muted">Rules: ${this.esc(d.rules.points_earned)} point(s) per R${this.esc(d.rules.spend_amount)} · point value R${this.esc(d.rules.point_value)} · expiry ${d.rules.expiry_enabled ? this.esc(d.rules.expiry) : 'off'}</div><div class="mkt-muted">${this.esc(d.rules.note)}</div>` : '<div class="mkt-warn">Loyalty rules not found.</div>'}
      <div class="mkt-grid">${this.kpi('Members with points', this.n(d.members))}${this.kpi('Points outstanding', this.n(d.points_outstanding))}${this.kpi('Outstanding value', this.R(d.points_outstanding_value))}${this.kpi('Earned (window)', this.n(d.earned_in_window))}${this.kpi('Redeemed (window)', this.n(d.redeemed_in_window))}${this.kpi('Expiring ≤14 days', this.n(d.expiring_14d.length))}</div>
      <h4>Points expiring within 14 days</h4>${this.table([['Customer', (r) => this.esc(r.name)], ['Points', (r) => this.n(r.points)], ['First expiry', (r) => this.esc(r.first_expiry)]], d.expiring_14d, 'No points expiring in the next 14 days.')}
      <h4>Approaching a reward</h4>${d.approaching_reward ? this.table([['Customer', (r) => this.esc(r.name)], ['Points', (r) => this.n(r.points)], ['To target', (r) => this.n(r.points_to_target)]], d.approaching_reward, 'Nobody is close to the target.') : `<div class="mkt-warn">${this.esc(d.approaching_note)}</div>`}
      <div class="mkt-row" style="margin-top:8px"><button class="mkt-btn p" id="mkt-loy-camp">Create loyalty reminder campaign</button></div></div>`;
    body.querySelector('#mkt-loy-camp').onclick = () => this.startWizard({ objective: 'loyalty_engagement', audience: { type: 'segment', segment: 'loyalty', params: {} }, offer: { kind: 'loyalty' } });
  },

  /* ─────────── Referrals ─────────── */
  async tReferrals(body) {
    const d = await this.api(API.mktReferrals(this.f()));
    if (!d) return;
    body.innerHTML = `<div class="mkt-card"><h3>Referrals (existing referral system)</h3>
      ${d.note ? `<div class="mkt-warn">${this.esc(d.note)}</div>` : ''}
      <div class="mkt-muted">Online sign-ups with a referral code: ${this.n(d.online_signups_with_referral_code)}</div>
      ${this.table([['Agent', (a) => this.esc(a.name)], ['Code', (a) => this.esc(a.code || '—')], ['Status', (a) => this.esc(a.status || '')], ['Referred customers', (a) => this.n(a.referred_customers)], ['Orders (window)', (a) => this.n(a.orders_in_window)], ['Revenue (window)', (a) => this.R(a.revenue_in_window)], ['Commissions', (a) => `${this.n(a.commissions)} · ${this.R(a.commission_amount)}`], ['', (a) => (a.code ? `<button class="mkt-btn sm" data-rc="${this.esc(a.code)}">Campaign</button>` : '')]], d.agents, 'No referral agents.')}
      <h4>Codes</h4>${this.table([['Code', (c) => this.esc(c.code)], ['Campaign', (c) => this.esc(c.campaign_name || '—')], ['Uses', (c) => this.n(c.usage_count)], ['Status', (c) => this.esc(c.status || '')]], d.codes, 'No referral codes.')}
      <div class="mkt-row" style="margin-top:8px"><button class="mkt-btn" id="mkt-open-ref">Open Referral department</button></div></div>`;
    body.querySelectorAll('[data-rc]').forEach((b) => { b.onclick = () => this.startWizard({ objective: 'increase_referrals', offer: { kind: 'referral_code', code: b.dataset.rc } }); });
    body.querySelector('#mkt-open-ref').onclick = () => this.handoff('referral-dept', {});
  },

  /* ─────────── Opportunities (customer + product) ─────────── */
  async tOpportunities(body) {
    const v = this.oppView === 'products' ? 'products' : 'customers';
    body.innerHTML = `<div class="mkt-row" style="margin-bottom:8px">
        <button class="mkt-btn${v === 'customers' ? ' p' : ''}" data-opp="customers">Customer opportunities</button>
        <button class="mkt-btn${v === 'products' ? ' p' : ''}" data-opp="products">Product opportunities</button>
        <button class="mkt-btn" data-opp-dc="1">Decision Center</button></div><div id="mkt-opp-body"><p class="mkt-muted">Loading…</p></div>`;
    body.querySelectorAll('[data-opp]').forEach((b) => { b.onclick = () => { this.oppView = b.dataset.opp; this.renderTab(); }; });
    body.querySelector('[data-opp-dc]').onclick = () => this.go('decisions');
    const inner = body.querySelector('#mkt-opp-body');
    return v === 'products' ? this.tProducts(inner) : this.tCustOpps(inner);
  },

  /* ─────────── Audit ─────────── */
  async tAudit(body) {
    const audit = await API.mktAudit(300).catch(() => null);
    const rows = audit?.data || [];
    const actions = [...new Set(rows.map((r) => r.action))].sort();
    body.innerHTML = `<div class="mkt-card"><h3>Marketing audit trail</h3>
      <p class="mkt-muted">Every marketing action (campaigns, approvals, launches, promotions, budgets, costs, content, settings, AI decisions) is recorded with user and time.</p>
      <div class="mkt-row"><label>Action<select id="mkt-au-act"><option value="">All actions</option>${actions.map((a) => `<option value="${this.esc(a)}">${this.esc(a.replace(/_/g, ' '))}</option>`).join('')}</select></label></div>
      <div id="mkt-au-list"></div></div>`;
    const draw = () => {
      const act = body.querySelector('#mkt-au-act').value;
      body.querySelector('#mkt-au-list').innerHTML = audit?.success === false
        ? `<div class="mkt-warn">${this.esc(audit.error)}</div>`
        : this.table([['When', (r) => this.esc(String(r.created_at).slice(0, 16))], ['User', (r) => this.esc(r.username)], ['Action', (r) => this.esc(String(r.action).replace(/_/g, ' '))], ['Entity', (r) => this.esc(`${String(r.entity_type).replace(/^marketing_?/, '') || 'marketing'} #${r.entity_id ?? ''}`)], ['Details', (r) => `<span class="mkt-muted">${this.esc(JSON.stringify(r.details).slice(0, 240))}</span>`]], act ? rows.filter((r) => r.action === act) : rows, 'No marketing actions recorded yet.');
    };
    body.querySelector('#mkt-au-act').onchange = draw;
    draw();
  },

  /* ─────────── Customer opportunities ─────────── */
  async tCustOpps(body) {
    const [dates, dc, pat] = await Promise.all([this.api(API.mktDates(this.f({ days_ahead: 30 }))), this.api(API.mktDecisionCenter(this.f())), this.api(API.mktPatterns(this.f()))]);
    const cards = (dc?.cards || []).filter((c) => ['win_back', 'overdue', 'declining'].includes(c.kind));
    const winback = [7, 14, 30, 60, 90];
    body.innerHTML = `
      <div class="mkt-card"><h3>Win-back windows</h3><div class="mkt-row">${winback.map((d) => `<button class="mkt-btn" data-wb="${d}">Inactive ${d}+ days</button>`).join('')}</div><div id="mkt-wb-out" class="mkt-muted">Choose a window to count customers and start a win-back campaign.</div></div>
      <div class="mkt-card"><h3>Churn &amp; overdue signals</h3>${cards.length ? cards.map((c) => `<div style="margin-bottom:6px"><b>${this.esc(c.title)}:</b> ${this.esc(c.headline)} <span class="mkt-muted">${this.esc(c.why)}</span></div>`).join('') : '<p class="mkt-muted">No declining, overdue or lapsed customers detected.</p>'}</div>
      <div class="mkt-card"><h3>Birthdays &amp; anniversaries (next 30 days)</h3>
        <div class="mkt-muted">Optional dates saved on customer profiles. Offers: birthday ${dates?.offers?.birthday?.enabled ? 'enabled' : 'not enabled'}, anniversary ${dates?.offers?.anniversary?.enabled ? 'enabled' : 'not enabled'} (configure in Settings).</div>
        ${this.table([['Customer', (u) => this.esc(u.name)], ['Occasion', (u) => this.esc(u.type)], ['Date', (u) => this.esc(u.date)], ['In', (u) => `${u.in_days} days`], ['Phone', (u) => this.esc(u.phone_masked || '—')]], dates?.upcoming || [], 'No birthdays or anniversaries saved in the next 30 days.')}
        <div class="mkt-row" style="margin-top:8px"><button class="mkt-btn p" data-do="birthday">Create birthday offers</button><button class="mkt-btn p" data-do="anniversary">Create anniversary offers</button></div>
        <div id="mkt-do-out"></div></div>
      <div class="mkt-card"><h3>Cross-sell (bought together)</h3>
        ${this.table([['If they buy', (p) => this.esc(p.product_a)], ['They also buy', (p) => this.esc(p.product_b)], ['Orders with both', (p) => this.n(p.orders_with_both)], ['% of orders', (p) => this.pct(p.pct_of_a_orders)], ['', (p) => `<button class="mkt-btn sm" data-bundle="${p.product_a_id},${p.product_b_id}">Bundle</button>`]], pat?.cross_sell?.pairs || [], `Insufficient data — no product pair bought together ${pat?.cross_sell?.min_support || 3}+ times.`)}</div>
      <div class="mkt-card"><h3>Upsell (same category, higher price)</h3>
        ${this.table([['From', (u) => `${this.esc(u.from_product)} ${this.R(u.from_price)}`], ['To', (u) => `${this.esc(u.to_product)} ${this.R(u.to_price)}`], ['Customers buying both', (u) => `${u.customers_buying_both} of ${u.customers_buying_from}`], ['Price step', (u) => this.R(u.price_step)]], pat?.upsell?.suggestions || [], 'Insufficient data — no upsell pattern found.')}</div>`;
    body.querySelectorAll('[data-wb]').forEach((b) => {
      b.onclick = async () => {
        const days = Number(b.dataset.wb);
        const r = await this.api(API.mktPreviewAudience({ type: 'segment', segment: 'inactive', params: { days } }, this.filters.branch_id || null, ['whatsapp', 'sms', 'email']));
        if (!r) return;
        body.querySelector('#mkt-wb-out').innerHTML = `<b>${r.count}</b> customers inactive ${days}+ days (${r.suppressed} suppressed). WhatsApp reachable: ${r.consent.whatsapp?.reachable ?? 0}. <button class="mkt-btn sm p" id="mkt-wb-go">Create win-back campaign</button>`;
        body.querySelector('#mkt-wb-go').onclick = () => this.startWizard({ name: `Win-back ${days}+ days`, objective: 'win_back', audience: { type: 'segment', segment: 'inactive', params: { days } } });
      };
    });
    body.querySelectorAll('[data-do]').forEach((b) => {
      b.onclick = async () => {
        const kind = b.dataset.do;
        if (!confirm(`Create one-time ${kind} vouchers for opted-in customers (uses the ${kind} offer in Settings) and a draft campaign for approval?`)) return;
        const body2 = prompt('Message (use {{customer_name}} and {{code}}):', kind === 'birthday' ? 'Happy birthday {{customer_name}}! Enjoy your gift with code {{code}}.' : 'Happy anniversary {{customer_name}}! Celebrate with code {{code}}.');
        if (body2 === null) return;
        const r = await this.api(API.mktCreateDateOffers({ kind, body: body2 }));
        if (!r) return;
        body.querySelector('#mkt-do-out').innerHTML = `<div class="mkt-ok">Draft campaign #${r.campaign.id} with ${r.vouchers.length} personal voucher(s). ${r.skipped_not_opted_in} skipped (not opted in). Submit it for approval in Campaigns.</div>`;
      };
    });
    body.querySelectorAll('[data-bundle]').forEach((b) => { b.onclick = () => { const ids = b.dataset.bundle.split(',').map(Number); this.startWizard({ objective: 'increase_aov', products: ids, offer: { kind: 'bundle', items: ids.map((id) => ({ product_id: id, quantity: 1 })) } }); }; });
  },

  /* ─────────── Product opportunities ─────────── */
  async tProducts(body) {
    const d = await this.api(API.mktProducts(this.f()));
    if (!d) return;
    const cols = [['Product', (p) => this.esc(p.name)], ['Price', (p) => this.R(p.price)], ['Cost', (p) => (p.cost == null ? '<span class="mkt-muted">missing</span>' : this.R(p.cost))], ['Margin', (p) => this.pct(p.margin_pct)], ['Stock', (p) => this.n(p.stock)], ['Sold (window)', (p) => this.n(p.units_sold)], ['Per week (28d)', (p) => this.n(p.weekly_units_28d)], ['Weeks cover', (p) => this.n(p.weeks_of_cover)], ['Revenue', (p) => this.R(p.revenue)],
      ['', (p) => `<button class="mkt-btn sm" data-pp="${p.product_id}">Promote</button> <button class="mkt-btn sm" data-pm="${p.product_id}">Menu</button> <button class="mkt-btn sm" data-pv="${p.product_id}">Video</button>`]];
    const t = d.thresholds;
    body.innerHTML = `${d.note ? `<div class="mkt-warn">${this.esc(d.note)}</div>` : ''}
      <div class="mkt-card"><h3>Best sellers</h3>${this.table(cols, d.best_sellers, 'No sales in the window.')}</div>
      <div class="mkt-card"><h3>Overstock (more than ${t.overstock_weeks} weeks of cover)</h3>${this.table(cols, d.overstock, 'No overstocked products.')}</div>
      <div class="mkt-card"><h3>Slow-moving with stock (below ${t.slow_weekly_units}/week)</h3>${this.table(cols, d.slow_moving, 'No slow-moving stocked products.')}</div>
      <div class="mkt-card"><h3>High margin (≥ ${t.high_margin_pct}%)</h3>${this.table(cols, d.high_margin, 'None — or cost data missing.')}</div>
      <div class="mkt-card"><h3>Low margin (&lt; ${t.low_margin_pct}%)</h3>${this.table(cols, d.low_margin, 'None — or cost data missing.')}</div>
      <div class="mkt-card"><h3>Missing cost data (${d.missing_cost.length})</h3><div class="mkt-muted">Promotion margin cannot be calculated for these products: ${this.esc(d.missing_cost.slice(0, 60).map((p) => p.name).join(', ') || 'none')}</div></div>`;
    body.querySelectorAll('[data-pp]').forEach((b) => { b.onclick = () => this.startWizard({ objective: 'clear_stock', products: [Number(b.dataset.pp)], offer: { kind: 'voucher', product_id: Number(b.dataset.pp), discount_type: 'percent' } }); });
    body.querySelectorAll('[data-pm]').forEach((b) => { b.onclick = () => this.handoff('menu-builder', { products: [Number(b.dataset.pm)] }); });
    body.querySelectorAll('[data-pv]').forEach((b) => { b.onclick = () => this.handoff('promo-video-builder', { products: [Number(b.dataset.pv)] }); });
  },

  /* ─────────── Calendar ─────────── */
  async tCalendar(body) {
    this._month = this._month || new Date().toISOString().slice(0, 7);
    const d = await this.api(API.mktCalendar({ month: this._month }));
    if (!d) return;
    const icon = { campaign: '📣', scheduled_campaign: '⏰', scheduled_message: '✉️', content: '🖼️', promotion: '🎁', voucher_expiry: '⌛', business_event: '📌', birthday: '🎂', anniversary: '💍' };
    const action = (e) => {
      if (e.type === 'campaign' || e.type === 'scheduled_campaign') return `<button class="mkt-btn sm" data-ce="${e.id}">Open</button>${e.undated ? ` <span class="mkt-muted">(no planned date — shown on ${this.esc(e.date_basis)} date)</span>` : ''}`;
      if (e.type === 'business_event') return `<button class="mkt-btn sm" data-de="${e.id}">Delete</button>`;
      if (e.type === 'scheduled_message') return '<button class="mkt-btn sm" data-cal-cc="1">Communication Center</button>';
      if (e.type === 'content') return '<button class="mkt-btn sm" data-dash-go="content">Content Studio</button>';
      return '';
    };
    body.innerHTML = `<div class="mkt-card">
      <div class="mkt-row"><button class="mkt-btn" id="mkt-mprev">←</button><b style="padding:6px">${this.esc(d.period)}</b><button class="mkt-btn" id="mkt-mnext">→</button>
      <label>Event title<input id="mkt-ev-title"></label><label>Date<input id="mkt-ev-date" type="date"></label><label>End<input id="mkt-ev-end" type="date"></label><label>Notes<input id="mkt-ev-notes"></label><button class="mkt-btn p" id="mkt-ev-add">Add business event</button></div>
      ${this.table([['Date', (e) => this.esc(e.start === e.end ? e.start : `${e.start} → ${e.end}`)], ['', (e) => icon[e.type] || ''], ['Item', (e) => this.esc(e.title)], ['Status', (e) => (e.status ? `<span class="mkt-status ${e.status}">${this.esc(e.status)}</span>` : '')],
        ['', action]], d.events, 'Nothing scheduled this month.')}
      <p class="mkt-muted">Campaigns can be edited, paused, cancelled or duplicated from their detail view.</p></div>`;
    const shift = (n) => { const [y, m] = this._month.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + n, 1)); this._month = dt.toISOString().slice(0, 7); this.renderTab(); };
    body.querySelector('#mkt-mprev').onclick = () => shift(-1);
    body.querySelector('#mkt-mnext').onclick = () => shift(1);
    body.querySelector('#mkt-ev-add').onclick = async () => {
      const r = await this.api(API.mktSaveEvent({ title: body.querySelector('#mkt-ev-title').value, event_date: body.querySelector('#mkt-ev-date').value, end_date: body.querySelector('#mkt-ev-end').value || null, notes: body.querySelector('#mkt-ev-notes').value }));
      if (r) this.renderTab();
    };
    body.querySelectorAll('[data-de]').forEach((b) => { b.onclick = async () => { if (confirm('Delete event?') && await this.api(API.mktDeleteEvent(Number(b.dataset.de)))) this.renderTab(); }; });
    body.querySelectorAll('[data-ce]').forEach((b) => { b.onclick = async () => { await this.go('campaigns'); this.showCampaign(Number(b.dataset.ce)); }; });
    body.querySelectorAll('[data-dash-go]').forEach((b) => { b.onclick = () => this.go(b.dataset.dashGo); });
    body.querySelectorAll('[data-cal-cc]').forEach((b) => { b.onclick = () => this.handoff('communication-center', { tab: 'scheduled' }); });
  },

  /* ─────────── Content Studio ─────────── */
  async tContent(body) {
    await this.loadProducts();
    const camps = await this.api(API.mktCampaigns({}));
    body.innerHTML = `<div class="mkt-card"><h3>Content Studio</h3>
      <p class="mkt-muted">Content is generated only from real product names, prices, promotion codes and shop details. Optional AI rewording keeps every price unchanged.</p>
      <div class="mkt-row"><label>Products<select id="cs-prod" multiple size="6" style="min-width:280px">${(this.products || []).map((p) => `<option value="${p.product_id}">${this.esc(p.name)} (${this.R(p.price)})</option>`).join('')}</select></label>
      <label>Campaign (for offer/code)<select id="cs-camp"><option value="">—</option>${(camps || []).map((c) => `<option value="${c.id}">#${c.id} ${this.esc(c.name)}</option>`).join('')}</select></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="cs-ai"> AI wording (if configured)</label>
      <button class="mkt-btn p" id="cs-gen">Generate</button><button class="mkt-btn" id="cs-menu">Open Menu Builder</button><button class="mkt-btn" id="cs-video">Open Promo Video Builder</button></div>
      <div id="cs-out">${this.contentLast ? this.contentHtml(this.contentLast) : ''}</div></div>
      <div class="mkt-card"><h3>Add to content library</h3>
        <div class="mkt-row"><label>Title<input id="cl-title" style="min-width:220px"></label>
          <label>Type<select id="cl-kind">${this.CONTENT_KINDS.map((k) => `<option value="${k}">${k.replace(/_/g, ' ')}</option>`).join('')}</select></label>
          <label>Channel<select id="cl-channel"><option value="">—</option>${this.CONTENT_CHANNELS.map((k) => `<option value="${k}">${k.replace(/_/g, ' ')}</option>`).join('')}</select></label>
          <label>Campaign<select id="cl-camp"><option value="">—</option>${(camps || []).map((c) => `<option value="${c.id}">#${c.id} ${this.esc(c.name)}</option>`).join('')}</select></label>
          <label>Schedule<input id="cl-when" type="datetime-local"></label></div>
        <div class="mkt-row"><label>Subject (email)<input id="cl-subject" style="min-width:220px"></label><label>Media URL (image/video)<input id="cl-media" placeholder="https://… or /uploads/…" style="min-width:280px"></label></div>
        <label style="display:block">Text<textarea id="cl-body" rows="4" style="width:100%"></textarea></label>
        <div class="mkt-row"><button class="mkt-btn p" id="cl-save">Save to library</button></div></div>
      <div class="mkt-card"><h3>Content library</h3><div id="cl-list"><p class="mkt-muted">Loading…</p></div></div>`;
    const sel = () => [...body.querySelector('#cs-prod').selectedOptions].map((o) => Number(o.value));
    const bindSaveGenerated = () => {
      body.querySelectorAll('[data-cs-save]').forEach((b) => {
        b.onclick = () => {
          const k = b.dataset.csSave; const r = this.contentLast; if (!r) return;
          const map = { whatsapp: ['message', 'whatsapp'], sms: ['message', 'sms'], email_body: ['email', 'email'], social_caption: ['caption', 'facebook'], poster_text: ['poster', 'print'], video_script: ['video_script', ''], product_copy: ['product_copy', ''] };
          const [kind, channel] = map[k] || ['message', ''];
          body.querySelector('#cl-kind').value = kind; body.querySelector('#cl-channel').value = channel;
          body.querySelector('#cl-body').value = r.content[k] || '';
          if (k === 'email_body') body.querySelector('#cl-subject').value = r.content.email_subject || '';
          if (!body.querySelector('#cl-title').value) body.querySelector('#cl-title').value = `${k.replace(/_/g, ' ')} — ${new Date().toISOString().slice(0, 10)}`;
          if (body.querySelector('#cs-camp').value) body.querySelector('#cl-camp').value = body.querySelector('#cs-camp').value;
          this._clProducts = sel();
          body.querySelector('#cl-title').scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        };
      });
    };
    body.querySelector('#cs-gen').onclick = async () => {
      const r = await this.api(API.mktGenerateContent({ product_ids: sel(), campaign_id: body.querySelector('#cs-camp').value || null, branch_id: this.filters.branch_id || null, use_ai: body.querySelector('#cs-ai').checked }));
      if (!r) return;
      this.contentLast = r;
      body.querySelector('#cs-out').innerHTML = this.contentHtml(r);
      bindSaveGenerated();
    };
    bindSaveGenerated();
    body.querySelector('#cs-menu').onclick = () => this.handoff('menu-builder', { products: sel() });
    body.querySelector('#cs-video').onclick = () => this.handoff('promo-video-builder', { products: sel() });
    body.querySelector('#cl-save').onclick = async () => {
      const r = await this.api(API.mktSaveContent({
        title: body.querySelector('#cl-title').value, kind: body.querySelector('#cl-kind').value, channel: body.querySelector('#cl-channel').value || null,
        campaign_id: body.querySelector('#cl-camp').value || null, scheduled_at: body.querySelector('#cl-when').value || null,
        subject: body.querySelector('#cl-subject').value || null, media_url: body.querySelector('#cl-media').value || null,
        body: body.querySelector('#cl-body').value, product_ids: this._clProducts || sel(), branch_id: this.filters.branch_id || null,
        source: this._clProducts ? 'content_studio' : 'manual'
      }));
      if (!r) return;
      this._clProducts = null;
      ['#cl-title', '#cl-body', '#cl-subject', '#cl-media', '#cl-when'].forEach((s) => { body.querySelector(s).value = ''; });
      this.toast('Saved to content library', 'success');
      this.loadContentLibrary(body, camps);
    };
    this.loadContentLibrary(body, camps);
  },

  CONTENT_KINDS: ['message', 'caption', 'poster', 'video_script', 'email', 'product_copy', 'image', 'video'],
  CONTENT_CHANNELS: ['whatsapp', 'sms', 'email', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'print', 'in_store'],

  async loadContentLibrary(body, camps) {
    const host = body.querySelector('#cl-list');
    if (!host) return;
    const rows = await this.api(API.mktContent({}));
    const campOpts = (camps || []).filter((c) => ['draft', 'awaiting_approval', 'approved'].includes(c.status));
    host.innerHTML = this.table([
      ['#', (r) => r.id],
      ['Title', (r) => `<b>${this.esc(r.title)}</b><div class="mkt-muted">${this.esc(String(r.body || '').slice(0, 120))}</div>`],
      ['Type', (r) => this.esc(String(r.kind).replace(/_/g, ' '))], ['Channel', (r) => this.esc(r.channel || '—')],
      ['Media', (r) => (r.media_url ? `<a href="${this.esc(r.media_url)}" target="_blank" rel="noopener">${this.esc(r.media_type || 'media')}</a>` : '—')],
      ['Campaign', (r) => (r.campaign_id ? `#${r.campaign_id}` : '—')], ['Scheduled', (r) => this.esc(r.scheduled_at ? String(r.scheduled_at).slice(0, 16) : '—')],
      ['Status', (r) => `<span class="mkt-status ${this.esc(r.status)}">${this.esc(r.status)}</span>`],
      ['', (r) => `<select data-cl-camp="${r.id}" style="max-width:150px"><option value="">Use in campaign…</option>${campOpts.map((c) => `<option value="${c.id}">#${c.id} ${this.esc(c.name)}</option>`).join('')}</select>
        <button class="mkt-btn sm" data-cl-cc="${r.id}" data-ch="${this.esc(r.channel || '')}">To Communication Center</button>
        <button class="mkt-btn sm" data-cl-del="${r.id}">Delete</button>`]
    ], rows || [], 'Content library is empty. Generate content above and save it, or add your own.');
    host.querySelectorAll('[data-cl-camp]').forEach((s) => {
      s.onchange = async () => {
        if (!s.value) return;
        if (!confirm(`Put this content into campaign #${s.value}? The campaign message is replaced (campaign must still be editable).`)) { s.value = ''; return; }
        if (await this.api(API.mktUseContent(Number(s.dataset.clCamp), Number(s.value)))) { this.toast('Campaign message updated', 'success'); this.loadContentLibrary(body, camps); } else s.value = '';
      };
    });
    host.querySelectorAll('[data-cl-cc]').forEach((b) => {
      b.onclick = async () => {
        let ch = b.dataset.ch;
        if (!['whatsapp', 'sms', 'email'].includes(ch)) { ch = prompt('Message channel for the Communication Center draft (whatsapp / sms / email):', 'whatsapp'); if (!ch) return; }
        const r = await this.api(API.mktContentToCommunication(Number(b.dataset.clCc), { channels: [ch.trim().toLowerCase()] }));
        if (r) this.toast(`${r.note}${r.draft_id ? ` (draft #${r.draft_id})` : ''}`, 'success');
      };
    });
    host.querySelectorAll('[data-cl-del]').forEach((b) => { b.onclick = async () => { if (confirm('Delete this content item?') && await this.api(API.mktDeleteContent(Number(b.dataset.clDel)))) this.loadContentLibrary(body, camps); }; });
  },

  contentHtml(r) {
    if (!r.ok) return this.warnList(r.missing);
    const labels = { whatsapp: 'WhatsApp message', sms: 'SMS', email_subject: 'Email subject', email_body: 'Email body', social_caption: 'Social caption', poster_text: 'Poster text', video_script: 'Video script', product_copy: 'Product descriptions' };
    return `<div class="mkt-muted">Engine: ${this.esc(r.engine)}</div>${this.warnList(r.missing)}` +
      Object.entries(r.content).map(([k, v]) => `<h4>${labels[k] || k} ${k === 'email_subject' ? '' : `<button class="mkt-btn sm" data-cs-save="${this.esc(k)}">Save to library</button>`}</h4><div class="mkt-pre">${this.esc(v)}</div>`).join('');
  },

  /* ─────────── Communication ─────────── */
  async tCommunication(body) {
    const chs = await this.api(API.mktChannelStatus());
    const rows = await this.api(API.mktCampaigns({}));
    const launched = (rows || []).filter((r) => r.launched_at);
    body.innerHTML = `<div class="mkt-card"><h3>Channels (via Communication Center)</h3>
      ${chs?._module_enabled === false ? '<div class="mkt-warn">Communication Center is not included in this shop\'s plan — campaign messages cannot be delivered.</div>' : ''}
      ${chs?._emergency_off ? '<div class="mkt-warn">Emergency OFF is active.</div>' : ''}
      ${this.channelBlock(chs)}
      <div class="mkt-row"><button class="mkt-btn" id="mkt-open-cc">Open Communication Center</button></div>
      <p class="mkt-muted">Marketing never sends directly. Every message goes through the Communication Center, which applies consent, opt-out, quiet hours, limits and duplicate protection. Clicks and replies are not tracked.</p></div>
      <div class="mkt-card"><h3>Launched campaigns</h3>${this.table([['Campaign', (r) => `#${r.id} ${this.esc(r.name)}`], ['Status', (r) => `<span class="mkt-status ${r.status}">${this.esc(r.status)}</span>`], ['Channels', (r) => this.esc((r.channels || []).join(', '))], ['Recipients', (r) => this.n(r.recipients_count)], ['Queued', (r) => this.n(r.queued_count)], ['Launched', (r) => this.esc(String(r.launched_at).slice(0, 16))], ['', (r) => `<button class="mkt-btn sm" data-oc="${r.id}">Open</button>`]], launched, 'No campaigns launched yet.')}</div>`;
    body.querySelector('#mkt-open-cc').onclick = () => this.handoff('communication-center', {});
    body.querySelectorAll('[data-oc]').forEach((b) => { b.onclick = async () => { await this.go('campaigns'); this.showCampaign(Number(b.dataset.oc)); }; });
  },

  /* ─────────── Analytics ─────────── */
  async tAnalytics(body) {
    const [rows, br, q] = await Promise.all([this.api(API.mktCampaigns({})), this.api(API.mktBranches(this.f())), this.api(API.mktQuiet(this.f()))]);
    const launched = (rows || []).filter((r) => ['active', 'paused', 'completed', 'scheduled'].includes(r.status));
    const groups = [...new Set((rows || []).map((r) => r.ab_group).filter(Boolean))];
    body.innerHTML = `
      <div class="mkt-card"><h3>Campaign performance</h3><div id="mkt-an-camps"><p class="mkt-muted">Loading…</p></div></div>
      <div class="mkt-card"><h3>A/B tests</h3>${groups.length ? `<div class="mkt-row">${groups.map((g) => `<button class="mkt-btn" data-ab="${this.esc(g)}">${this.esc(g)}</button>`).join('')}</div>` : '<p class="mkt-muted">No A/B groups. Give two or more campaigns the same A/B group in the wizard (Schedule step).</p>'}<div id="mkt-ab-out"></div></div>
      <div class="mkt-card"><h3>Branch comparison</h3>${br ? this.table([['Branch', (b) => this.esc(b.branch)], ['Revenue', (b) => this.R(b.revenue)], ['Orders', (b) => this.n(b.orders)], ['AOV', (b) => this.R(b.aov)], ['Discounts', (b) => this.R(b.discount)], ['Identified customers', (b) => this.n(b.identified_customers)], ['Delivery', (b) => this.n(b.delivery_orders)], ['Online', (b) => this.n(b.online_orders)]], br.branches, 'No sales in the window.') : '<div class="mkt-warn">Branch analytics require the "Marketing — View analytics" permission.</div>'}</div>
      <div class="mkt-card"><h3>Quiet periods</h3>${!q ? '' : q.insufficient ? `<div class="mkt-warn">${this.esc(q.message)}</div>` : `
        <div class="mkt-muted">${this.esc(q.note)} Average per trading hour: ${this.R(q.hourly_mean)} over ${q.trading_days} trading days.</div>
        ${this.table([['Quiet window', (x) => this.esc(x.label)], ['Avg revenue/hour', (x) => this.R(x.avg_revenue_per_hour)], ['Below average', (x) => this.pct(x.pct_below_mean)], ['', (x) => `<button class="mkt-btn sm" data-qt="${x.start_hour}-${x.end_hour}">Time-based campaign</button>`]], q.quiet_periods, `No hour is ${q.threshold_pct}%+ below average.`)}
        <h4>By hour</h4>${this.table([['Hour', (x) => this.esc(x.label)], ['Avg revenue/day', (x) => this.R(x.avg_revenue_per_day)], ['Orders', (x) => this.n(x.orders)]], q.hours)}
        <h4>By day of week</h4>${this.table([['Day', (x) => this.esc(x.day)], ['Avg revenue/trading day', (x) => this.R(x.avg_revenue_per_trading_day)], ['Orders', (x) => this.n(x.orders)]], q.days_of_week)}
        <h4>By month</h4>${this.table([['Month', (x) => this.esc(x.month)], ['Revenue', (x) => this.R(x.revenue)], ['Orders', (x) => this.n(x.orders)]], q.months)}`}</div>`;
    body.querySelectorAll('[data-ab]').forEach((b) => {
      b.onclick = async () => {
        const r = await this.api(API.mktAbReport(b.dataset.ab));
        if (!r) return;
        body.querySelector('#mkt-ab-out').innerHTML = `${this.table([['Variant', (v) => this.esc(v.variant)], ['Campaign', (v) => `#${v.campaign_id} ${this.esc(v.name)}`], ['Orders', (v) => this.n(v.orders)], ['Revenue', (v) => this.R(v.revenue)], ['AOV', (v) => this.R(v.aov)], ['Gross profit', (v) => this.R(v.gross_profit)], ['Repeat', (v) => this.n(v.repeat_customers)]], r.variants)}<div class="${r.winner ? 'mkt-ok' : 'mkt-warn'}">${this.esc(r.conclusion)}</div>`;
      };
    });
    body.querySelectorAll('[data-qt]').forEach((b) => {
      b.onclick = () => { const [s, e] = b.dataset.qt.split('-').map((x) => `${String(x).padStart(2, '0')}:00`); this.startWizard({ objective: 'quiet_period', offer: { kind: 'time_based', valid_time_start: s, valid_time_end: e } }); };
    });
    const host = body.querySelector('#mkt-an-camps');
    if (!launched.length) { host.innerHTML = '<p class="mkt-muted">No launched campaigns yet — nothing to measure.</p>'; return; }
    const results = [];
    for (const c of launched.slice(0, 30)) { const r = await this.api(API.mktCampaignResults(c.id)); if (r) results.push(r); }
    host.innerHTML = this.table([['Campaign', (r) => `#${r.campaign_id} ${this.esc(r.name)}`], ['Status', (r) => this.esc(r.status)], ['Attributed orders', (r) => this.n(r.attributed.orders)], ['Attributed revenue', (r) => this.R(r.attributed.revenue)], ['Discount', (r) => this.R(r.attributed.discount)], ['Gross profit', (r) => `${this.R(r.attributed.gross_profit)}${r.attributed.cogs_incomplete ? ' <span class="mkt-muted">(COGS incomplete)</span>' : ''}`], ['Cost', (r) => this.R(r.marketing_cost)], ['ROI', (r) => (r.roi_pct == null ? `<span class="mkt-muted">${this.esc(r.roi_note)}</span>` : this.pct(r.roi_pct))], ['Total revenue in period', (r) => (r.total_revenue_during_campaign ? `${this.R(r.total_revenue_during_campaign.revenue)} <span class="mkt-muted">(not attributed)</span>` : '—')]], results);
  },

  /* ─────────── Budget ─────────── */
  async tBudget(body) {
    this._period = this._period || new Date().toISOString().slice(0, 7);
    const d = await this.api(API.mktBudgetStatus(this._period));
    if (!d) { body.innerHTML = '<div class="mkt-warn">Budget requires the "Marketing — Manage budget &amp; costs" permission.</div>'; return; }
    body.innerHTML = `<div class="mkt-card"><h3>Marketing budget — ${this.esc(d.period)}</h3>
      <div class="mkt-row"><label>Month<input type="month" id="mkt-bp" value="${this.esc(d.period)}"></label>
        <label>Scope<select id="mkt-bs"><option value="monthly">Monthly total</option><option value="campaign">Campaign</option><option value="branch">Branch</option><option value="channel">Channel</option></select></label>
        <label>Applies to (campaign #, branch id or channel)<input id="mkt-br"></label><label>Amount (R)<input id="mkt-ba" type="number"></label><label>Notes<input id="mkt-bn"></label>
        <button class="mkt-btn p" id="mkt-bsave">Save budget</button></div>
      <div class="mkt-muted">${this.esc(d.note)} Warning at ${d.warn_pct}% used.</div>
      <div class="mkt-grid">${this.kpi('Marketing expenses this month', this.R(d.marketing_expenses.total), `${d.marketing_expenses.count} expense records`)}</div>
      ${d.budgets.map((b) => (b.alert ? `<div class="mkt-warn">${this.esc(b.scope)} ${this.esc(b.scope_ref || '')}: budget ${b.alert} — ${b.used_pct}% used (${this.R(b.actual)} of ${this.R(b.amount)})</div>` : '')).join('')}
      ${this.table([['Scope', (b) => this.esc(b.scope)], ['Applies to', (b) => this.esc(b.scope_ref || 'all')], ['Budget', (b) => this.R(b.amount)], ['Actual', (b) => this.R(b.actual)], ['Remaining', (b) => this.R(b.remaining)], ['Used', (b) => this.pct(b.used_pct)], ['', (b) => `<button class="mkt-btn sm" data-bd="${b.id}">Delete</button>`]], d.budgets, 'No budgets set for this month.')}
      <p class="mkt-muted">Record campaign costs from a campaign's detail view ("Record cost"). They are saved as Marketing expenses and flow into accounting.</p></div>`;
    body.querySelector('#mkt-bp').onchange = (e) => { this._period = e.target.value; this.renderTab(); };
    body.querySelector('#mkt-bsave').onclick = async () => {
      const r = await this.api(API.mktSaveBudget({ period: body.querySelector('#mkt-bp').value, scope: body.querySelector('#mkt-bs').value, scope_ref: body.querySelector('#mkt-br').value, amount: body.querySelector('#mkt-ba').value, notes: body.querySelector('#mkt-bn').value }));
      if (r) this.renderTab();
    };
    body.querySelectorAll('[data-bd]').forEach((b) => { b.onclick = async () => { if (confirm('Delete this budget?') && await this.api(API.mktDeleteBudget(Number(b.dataset.bd)))) this.renderTab(); }; });
  },

  /* ─────────── AI assistant ─────────── */
  async tAi(body) {
    const qs = ['What should I market today?', 'Which products should I promote?', 'Which customers should I target?', 'Which customers are becoming inactive?', 'Which products are usually bought together?', 'How can I increase average order value?', 'When are my quiet periods?', 'Which campaign performed best?', 'Which loyalty customers are close to a reward?', 'Which branch needs marketing support?'];
    body.innerHTML = `<div class="mkt-card"><h3>AI Marketing Assistant</h3>
      <p class="mkt-muted">Answers are split into <span class="mkt-tag fact">FACT</span> (from your database), <span class="mkt-tag an">ANALYSIS</span> and <span class="mkt-tag sg">SUGGESTION</span>. Nothing is changed automatically — suggestions open the normal approval flow.</p>
      <div class="mkt-row">${qs.map((q) => `<button class="mkt-btn sm" data-q="${this.esc(q)}">${this.esc(q)}</button>`).join('')}</div>
      <div class="mkt-row"><input id="ai-q" placeholder="Ask about your marketing…" style="flex:1;min-width:320px"><button class="mkt-btn p" id="ai-ask">Ask</button></div>
      <div id="ai-out">${this.aiLast ? this.aiHtml(this.aiLast) : ''}</div></div>
      <div class="mkt-card"><h3>Recent recommendations</h3><div id="ai-hist"><p class="mkt-muted">Loading…</p></div></div>`;
    const ask = async (q) => {
      body.querySelector('#ai-out').innerHTML = '<p class="mkt-muted">Analysing your data…</p>';
      const r = await this.api(API.mktAiAsk(q, this.f()));
      if (!r) { body.querySelector('#ai-out').innerHTML = ''; return; }
      this.aiLast = r;
      body.querySelector('#ai-out').innerHTML = this.aiHtml(r);
      this.bindAi(body);
      loadHist();
    };
    body.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => ask(b.dataset.q); });
    body.querySelector('#ai-ask').onclick = () => ask(body.querySelector('#ai-q').value);
    this.bindAi(body);
    const loadHist = async () => {
      const h = await this.api(API.mktRecommendations(20));
      const host = body.querySelector('#ai-hist');
      if (host) host.innerHTML = this.table([['When', (r) => this.esc(String(r.created_at).slice(0, 16))], ['Question', (r) => this.esc(r.question)], ['Engine', (r) => this.esc(r.engine)], ['Status', (r) => this.esc(r.status)], ['Suggestions', (r) => this.n((r.suggestions || []).length)]], h || [], 'No recommendations yet.');
    };
    loadHist();
  },

  aiHtml(r) {
    return `<div class="mkt-card" style="background:#f8fafc">
      <div class="mkt-muted">Q: ${this.esc(r.question)} · ${this.esc(r.engine_note)}</div>
      <h4><span class="mkt-tag fact">FACT</span></h4><ul>${r.facts.map((x) => `<li>${this.esc(x.text)}</li>`).join('')}</ul>
      <h4><span class="mkt-tag an">ANALYSIS</span></h4><ul>${r.analysis.map((x) => `<li>${this.esc(x)}</li>`).join('')}</ul>
      <h4><span class="mkt-tag sg">SUGGESTION</span></h4>${r.suggestions.length ? `<ul>${r.suggestions.map((s, i) => `<li>${this.esc(s.text)} ${s.action && s.action !== 'none' ? `<button class="mkt-btn sm" data-sug="${i}">Start</button>` : ''}</li>`).join('')}</ul>` : '<p class="mkt-muted">No suggestion — insufficient evidence.</p>'}
      ${r.insufficient?.length ? `<h4>INSUFFICIENT DATA</h4>${this.warnList(r.insufficient)}` : ''}
      <div class="mkt-muted">${this.esc(r.approval_note)}</div>
      <div class="mkt-row" style="margin-top:6px"><button class="mkt-btn sm" data-dec="accepted">Mark accepted</button><button class="mkt-btn sm" data-dec="rejected">Reject</button></div></div>`;
  },

  bindAi(body) {
    const r = this.aiLast;
    if (!r) return;
    body.querySelectorAll('[data-sug]').forEach((b) => {
      b.onclick = () => {
        const s = r.suggestions[Number(b.dataset.sug)];
        const offer = {};
        if (s.action === 'create_bundle' && s.products?.length) { offer.kind = 'bundle'; offer.items = s.products.map((p) => ({ product_id: p, quantity: 1 })); }
        if (s.action === 'create_promotion' && s.products?.length) { offer.kind = 'voucher'; offer.product_id = s.products[0]; }
        if (s.action === 'create_time_campaign') { offer.kind = 'time_based'; offer.valid_time_start = s.time_window?.start; offer.valid_time_end = s.time_window?.end; }
        if (s.action === 'create_referral_campaign') { offer.kind = 'referral_code'; offer.code = s.referral_code; }
        if (s.action === 'create_loyalty_campaign') offer.kind = 'loyalty';
        this.api(API.mktDecideRecommendation(r.id, 'accepted', s.text)).catch(() => {});
        this.startWizard({ name: s.text.slice(0, 80), objective: s.objective || 'increase_sales', audience: s.audience || { type: 'segment', segment: 'returning' }, products: s.products || [], offer, source: { recommendation_id: r.id }, recommendation_id: r.id });
      };
    });
    body.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = async () => { if (await this.api(API.mktDecideRecommendation(r.id, b.dataset.dec, ''))) this.toast(`Recommendation ${b.dataset.dec}`, 'success'); }; });
  },

  /* ─────────── Settings ─────────── */
  async tSettings(body) {
    const s = await this.api(API.mktSettings());
    if (!s) return;
    const num = (k, label, help) => `<label title="${this.esc(help || '')}">${label}<input id="st-${k}" type="number" value="${this.esc(s[k] ?? '')}" style="width:120px"></label>`;
    const offer = (k, o) => `<div class="mkt-card"><h4>${k === 'birthday_offer' ? 'Birthday' : 'Anniversary'} offer</h4><div class="mkt-row">
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="st-${k}-enabled"${o.enabled ? ' checked' : ''}> Enabled</label>
      <label>Type<select id="st-${k}-discount_type">${['percent', 'amount', 'free_delivery'].map((t) => `<option${o.discount_type === t ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Value<input id="st-${k}-discount_value" type="number" value="${this.esc(o.discount_value ?? '')}" style="width:90px"></label>
      <label>Min order<input id="st-${k}-min_order_total" type="number" value="${this.esc(o.min_order_total ?? '')}" style="width:90px"></label>
      <label>Days ahead<input id="st-${k}-days_ahead" type="number" value="${this.esc(o.days_ahead ?? 7)}" style="width:70px"></label>
      <label>Valid days<input id="st-${k}-valid_days" type="number" value="${this.esc(o.valid_days ?? 7)}" style="width:70px"></label></div></div>`;
    body.innerHTML = `<div class="mkt-card"><h3>Marketing settings</h3>
      <div class="mkt-row">${num('analysis_days', 'Analysis window (days)')}${num('new_customer_days', 'New customer (days)')}${num('inactivity_days', 'Inactive after (days)')}${num('high_value_top_pct', 'High-value top %')}</div>
      <div class="mkt-row">${num('slow_weekly_units', 'Slow-moving below units/week')}${num('overstock_weeks', 'Overstock above weeks cover')}${num('high_margin_pct', 'High margin %')}${num('low_margin_pct', 'Low margin %')}</div>
      <div class="mkt-row">${num('min_pair_support', 'Min orders for bought-together')}${num('quiet_threshold_pct', 'Quiet period % below average')}${num('hour_offset', 'Hour offset (recorded time → local)')}${num('reward_points_target', 'Reward points target (optional)')}${num('near_reward_points', 'Near reward within points')}</div>
      <div class="mkt-row">${num('ab_min_orders', 'A/B min orders per variant')}${num('budget_warn_pct', 'Budget warning at %')}</div>
      ${offer('birthday_offer', s.birthday_offer || {})}${offer('anniversary_offer', s.anniversary_offer || {})}
      <button class="mkt-btn p" id="st-save">Save settings</button></div>
      <div class="mkt-card"><h3>Marketing suppression list</h3><div id="st-supp"></div></div>
      <div class="mkt-card"><h3>Audit trail</h3><p class="mkt-muted">All marketing actions are listed in the Audit tab.</p><button class="mkt-btn" id="st-audit-go">Open Audit</button></div>`;
    body.querySelector('#st-audit-go').onclick = () => this.go('audit');
    body.querySelector('#st-save').onclick = async () => {
      const d = {};
      ['analysis_days', 'new_customer_days', 'inactivity_days', 'high_value_top_pct', 'slow_weekly_units', 'overstock_weeks', 'high_margin_pct', 'low_margin_pct', 'min_pair_support', 'quiet_threshold_pct', 'hour_offset', 'reward_points_target', 'near_reward_points', 'ab_min_orders', 'budget_warn_pct']
        .forEach((k) => { d[k] = body.querySelector(`#st-${k}`).value; });
      for (const k of ['birthday_offer', 'anniversary_offer']) {
        d[k] = { enabled: body.querySelector(`#st-${k}-enabled`).checked };
        ['discount_type', 'discount_value', 'min_order_total', 'days_ahead', 'valid_days'].forEach((f) => { d[k][f] = body.querySelector(`#st-${k}-${f}`).value; });
      }
      if (await this.api(API.mktSaveSettings(d))) { this.toast('Settings saved', 'success'); this.meta = await this.api(API.mktMeta()) || this.meta; }
    };
    const supp = await this.api(API.mktSuppressions());
    body.querySelector('#st-supp').innerHTML = this.table([['Customer', (r) => this.esc(r.name || `#${r.customer_id}`)], ['Reason', (r) => this.esc(r.reason || '')], ['Added', (r) => this.esc(String(r.created_at).slice(0, 16))], ['', (r) => `<button class="mkt-btn sm" data-rs="${r.id}">Remove</button>`]], supp || [], 'Nobody is suppressed. Suppress customers from their profile in the Customers tab.');
    body.querySelectorAll('[data-rs]').forEach((b) => { b.onclick = async () => { if (await this.api(API.mktRemoveSuppression(Number(b.dataset.rs)))) this.renderTab(); }; });
  }
};
