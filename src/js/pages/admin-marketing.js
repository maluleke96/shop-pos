/**
 * Marketing Command Centre
 * Multi-business marketing, promotions, referral agents, commissions & payouts.
 * Backed by the mktp:* platform APIs (API.mktp…).
 */
const AdminMarketingPage = {
  section: 'dashboard',
  app: null,
  el: null,
  filters: { businessId: '', branchId: '', from: '', to: '' },
  counts: { applications: 0, notifications: 0 },
  /** Per-section list filters — survive data refreshes */
  ui: {},
  _cache: {},
  _delegated: false,

  /* ─── Infrastructure ──────────────────────────────────────────────────── */

  ensureCss() {
    const href = 'css/marketing-command.css';
    if (typeof Utils !== 'undefined' && typeof Utils.loadStylesheet === 'function') {
      Utils.loadStylesheet(href).catch(() => { /* non-fatal */ });
      return;
    }
    if (document.querySelector(`link[href="${href}"]`) || document.querySelector(`link[href$="/${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  },

  actor() {
    return this.app?.user || (typeof App !== 'undefined' && App.user) || null;
  },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${(Number(n) || 0).toFixed(2)}`;
  },

  referralPageUrl(code, link) {
    if (link && /^https?:\/\//i.test(String(link))) return link;
    const base = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
    return `${base}/r/${encodeURIComponent(code || '')}`;
  },

  toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info');
    else console.log(msg);
  },

  async apiOk(promise, fallbackMsg) {
    let r;
    try {
      r = await promise;
    } catch (err) {
      this.toast(err?.message || fallbackMsg || 'Request failed', 'error');
      return null;
    }
    if (!r || r.success === false) {
      this.toast((r && r.error) || fallbackMsg || 'Request failed', 'error');
      return null;
    }
    return r.data !== undefined ? r.data : r;
  },

  async list(promise, fallbackMsg) {
    const d = await this.apiOk(promise, fallbackMsg);
    return Array.isArray(d) ? d : [];
  },

  filterScope() {
    const f = {};
    if (this.filters.businessId) f.business_id = parseInt(this.filters.businessId, 10);
    if (this.filters.branchId) f.branch_id = parseInt(this.filters.branchId, 10);
    if (this.filters.from) f.from = this.filters.from;
    if (this.filters.to) f.to = this.filters.to;
    return f;
  },

  bizScope() {
    const f = {};
    if (this.filters.businessId) f.business_id = parseInt(this.filters.businessId, 10);
    if (this.filters.branchId) f.branch_id = parseInt(this.filters.branchId, 10);
    return f;
  },

  today() {
    return (typeof Utils !== 'undefined' && Utils.today) ? Utils.today() : new Date().toLocaleDateString('en-CA');
  },

  monthStart() {
    if (typeof Utils !== 'undefined' && Utils.monthStart) return Utils.monthStart();
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  },

  /* ─── Small view helpers ──────────────────────────────────────────────── */

  tag(text, cls) {
    return `<span class="mktp-tag ${cls || ''}">${this.esc(text ?? '—')}</span>`;
  },

  statusTag(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      active: 'ok', approved: 'ok', accepted: 'ok', paid: 'ok', converted: 'ok', completed: 'ok', redeemed: 'ok',
      pending: 'warn', awaiting_acceptance: 'warn', scheduled: 'info', payable: 'info', generated: 'info',
      issued: 'info', draft: 'muted', inactive: 'muted', ended: 'muted', expired: 'muted', paused: 'warn',
      rejected: 'bad', suspended: 'bad', terminated: 'bad', cancelled: 'bad', reversed: 'bad', disputed: 'bad', refunded: 'bad'
    };
    return this.tag(status || '—', map[s] || 'muted');
  },

  kpi(label, value, sub, cls) {
    return `<div class="mktp-kpi ${cls || ''}">
      <span class="mktp-kpi-label">${this.esc(label)}</span>
      <span class="mktp-kpi-value">${this.esc(value)}</span>
      ${sub ? `<span class="mktp-kpi-sub">${this.esc(sub)}</span>` : ''}
    </div>`;
  },

  head(title, sub, actionsHtml) {
    return `<div class="mktp-section-head">
      <div>
        <h3 class="mktp-page-title">${this.esc(title)}</h3>
        ${sub ? `<p class="mktp-page-sub">${this.esc(sub)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="mktp-actions">${actionsHtml}</div>` : ''}
    </div>`;
  },

  panel(title, bodyHtml, actionsHtml, flush) {
    return `<div class="mktp-panel">
      ${title ? `<div class="mktp-panel-h"><h4>${this.esc(title)}</h4>${actionsHtml ? `<div class="mktp-actions">${actionsHtml}</div>` : ''}</div>` : ''}
      <div class="mktp-panel-b${flush ? ' flush' : ''}">${bodyHtml}</div>
    </div>`;
  },

  table(headers, rowsHtml, emptyMsg) {
    if (!rowsHtml) return `<div class="mktp-empty">${this.esc(emptyMsg || 'Nothing here yet')}</div>`;
    return `<div class="table-wrap"><table>
      <thead><tr>${headers.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`;
  },

  btn(label, act, data, cls) {
    const attrs = Object.entries(data || {})
      .map(([k, v]) => `data-${k}="${this.esc(v)}"`).join(' ');
    return `<button type="button" class="btn btn-sm ${cls || 'btn-ghost'}" data-mktp-act="${this.esc(act)}" ${attrs}>${this.esc(label)}</button>`;
  },

  rowBtns(html) {
    return `<div class="mktp-rowbtns">${html}</div>`;
  },

  shortNum(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v * 100) / 100);
  },

  chart(rows, labelFn, valueFn) {
    if (!rows.length) return '<div class="mktp-empty">No data for this period</div>';
    const vals = rows.map((r) => Number(valueFn(r)) || 0);
    const max = Math.max(...vals, 1);
    return `<div class="mktp-chart">${rows.map((r, i) => `
      <div class="mktp-bar-col">
        <span class="mktp-bar-val">${this.esc(this.shortNum(vals[i]))}</span>
        <div class="mktp-bar" style="height:${Math.max(2, Math.round((vals[i] / max) * 100))}%"></div>
        <span class="mktp-bar-label">${this.esc(labelFn(r))}</span>
      </div>`).join('')}</div>`;
  },

  /* ─── Form builder ────────────────────────────────────────────────────── */

  fld(id, label, opts = {}) {
    const { type = 'text', value = '', options = null, rows = 0, full = false, attrs = '', placeholder = '', hint = '' } = opts;
    const cls = `field${full ? ' full' : ''}`;
    let input;
    if (options) {
      input = `<select id="${id}" ${attrs}>${options.map(([v, l]) =>
        `<option value="${this.esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${this.esc(l)}</option>`).join('')}</select>`;
    } else if (rows) {
      input = `<textarea id="${id}" rows="${rows}" placeholder="${this.esc(placeholder)}" ${attrs}>${this.esc(value)}</textarea>`;
    } else if (type === 'checkbox') {
      return `<div class="${cls}"><label><input type="checkbox" id="${id}" ${value ? 'checked' : ''} ${attrs}> ${this.esc(label)}</label></div>`;
    } else {
      input = `<input type="${type}" id="${id}" value="${this.esc(value)}" placeholder="${this.esc(placeholder)}" ${attrs}>`;
    }
    return `<div class="${cls}"><label>${this.esc(label)}</label>${input}${hint ? `<small class="muted">${this.esc(hint)}</small>` : ''}</div>`;
  },

  grid(fields) {
    return `<div class="form-grid">${fields.join('')}</div>`;
  },

  val(id) {
    return (document.getElementById(id)?.value ?? '').trim();
  },

  numVal(id, fallback = 0) {
    const n = parseFloat(document.getElementById(id)?.value);
    return Number.isFinite(n) ? n : fallback;
  },

  intVal(id) {
    const n = parseInt(document.getElementById(id)?.value, 10);
    return Number.isFinite(n) ? n : null;
  },

  chk(id) {
    return !!document.getElementById(id)?.checked;
  },

  openForm(title, bodyHtml, onSave, saveLabel = 'Save') {
    if (typeof Utils?.showModal !== 'function') return;
    Utils.showModal(title, bodyHtml, `
      <button type="button" class="btn btn-ghost" id="mktp-modal-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="mktp-modal-save">${this.esc(saveLabel)}</button>`);
    document.getElementById('mktp-modal-cancel')?.addEventListener('click', () => Utils.hideModal());
    const btn = document.getElementById('mktp-modal-save');
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const ok = await onSave();
        if (ok === false) return;
        Utils.hideModal();
        await this.refresh();
      } catch (err) {
        this.toast(err?.message || 'Save failed', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  },

  openInfo(title, bodyHtml) {
    if (typeof Utils?.showModal !== 'function') return;
    Utils.showModal(title, bodyHtml, '<button type="button" class="btn btn-primary" id="mktp-modal-close">Close</button>');
    document.getElementById('mktp-modal-close')?.addEventListener('click', () => Utils.hideModal());
  },

  async copy(text) {
    const str = String(text ?? '');
    try {
      await navigator.clipboard.writeText(str);
      this.toast('Copied to clipboard', 'success');
      return;
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      this.toast('Copied to clipboard', 'success');
    } catch (_) {
      this.toast('Copy not available — select the text manually', 'error');
    }
  },

  downloadCsv(filename, headers, rows) {
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
    try {
      const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.toast(`${filename} downloaded (${rows.length} rows)`, 'success');
    } catch (err) {
      this.toast(err?.message || 'CSV export failed', 'error');
    }
  },

  /* ─── Lookups (cached per render pass) ────────────────────────────────── */

  async businesses() {
    if (!this._cache.businesses) {
      this._cache.businesses = await this.list(API.mktpBusinesses({}), 'Could not load businesses');
    }
    return this._cache.businesses;
  },

  async branches() {
    if (!this._cache.branches) {
      this._cache.branches = await this.list(API.mktpBranches({}), 'Could not load branches');
    }
    return this._cache.branches;
  },

  async agentList() {
    if (!this._cache.agents) {
      this._cache.agents = await this.list(API.mktpAgents({}, this.actor()), 'Could not load agents');
    }
    return this._cache.agents;
  },

  async campaignList() {
    if (!this._cache.campaigns) {
      this._cache.campaigns = await this.list(API.mktpCampaigns({}, this.actor()), 'Could not load campaigns');
    }
    return this._cache.campaigns;
  },

  async promotionList() {
    if (!this._cache.promotions) {
      this._cache.promotions = await this.list(API.mktpPromotions({}, this.actor()), 'Could not load promotions');
    }
    return this._cache.promotions;
  },

  async commissionRuleList() {
    if (!this._cache.rules) {
      this._cache.rules = await this.list(API.mktpCommissionRules({}, this.actor()), 'Could not load commission rules');
    }
    return this._cache.rules;
  },

  clearCache() {
    this._cache = {};
  },

  bizOptions(businesses, includeBlank = true) {
    const opts = businesses.map((b) => [b.id, b.name]);
    return includeBlank ? [['', '— None —'], ...opts] : opts;
  },

  branchOptions(branches, includeBlank = true) {
    const opts = branches.map((b) => [b.id, b.business_name ? `${b.name} · ${b.business_name}` : b.name]);
    return includeBlank ? [['', '— All / None —'], ...opts] : opts;
  },

  agentOptions(agents, includeBlank = true) {
    const opts = agents.map((a) => [a.id, `${a.full_name}${a.agent_code ? ` (${a.agent_code})` : ''}`]);
    return includeBlank ? [['', '— Select agent —'], ...opts] : opts;
  },

  /* ─── Navigation ──────────────────────────────────────────────────────── */

  NAV: [
    ['Overview', [
      ['dashboard', 'Dashboard'],
      ['calendar', 'Calendar'],
      ['notifications', 'Notifications']
    ]],
    ['Structure', [
      ['businesses', 'Businesses'],
      ['branches', 'Branches']
    ]],
    ['Marketing', [
      ['campaigns', 'Campaigns'],
      ['promotions', 'Promotions'],
      ['flyer-designer', 'Flyer Designer'],
      ['social', 'Social Posts'],
      ['whatsapp', 'WhatsApp Blasts'],
      ['coupons', 'Coupons'],
      ['qr-codes', 'QR Codes']
    ]],
    ['Customers', [
      ['customers', 'Customers'],
      ['segments', 'Segments'],
      ['loyalty', 'Loyalty']
    ]],
    ['Referral Agents', [
      ['agents', 'Agents'],
      ['applications', 'Applications'],
      ['contracts', 'Contracts'],
      ['referral-codes', 'Referral Codes'],
      ['performance', 'Performance']
    ]],
    ['Finance', [
      ['commissions', 'Commissions'],
      ['payments', 'Payments']
    ]],
    ['Insights', [
      ['analytics', 'Analytics'],
      ['reports', 'Reports'],
      ['audit', 'Audit Trail']
    ]],
    ['Administration', [
      ['users', 'Users & Access'],
      ['settings', 'Settings']
    ]]
  ],

  SECTION_META: {
    dashboard: ['Dashboard', 'Live marketing, referral and commission performance across every business.'],
    calendar: ['Marketing Calendar', 'Campaign windows, promotions and custom marketing events.'],
    notifications: ['Notifications', 'Applications, commissions, contracts and campaign alerts.'],
    businesses: ['Businesses', 'Every business trading on this platform, with branding and contact details.'],
    branches: ['Branches', 'Link POS branches to the business that owns them.'],
    campaigns: ['Campaigns', 'Plan, schedule and run multi-channel campaigns with commission rules.'],
    promotions: ['Promotions', 'Discounts, BOGO and bundle offers that campaigns and coupons attach to.'],
    'flyer-designer': ['Flyer Designer', 'Approve marketing artwork and open the full Flyer Studio designer.'],
    social: ['Social Posts', 'Draft, schedule and publish campaign posts per platform.'],
    whatsapp: ['WhatsApp Blasts', 'Segment-targeted WhatsApp broadcasts with audience preview.'],
    coupons: ['Coupons', 'Issue, track and redeem discount codes.'],
    'qr-codes': ['QR Codes', 'Scannable payloads for campaigns, agents, branches and menus.'],
    customers: ['Customers', 'Customer base with spend, orders and referral attribution.'],
    segments: ['Segments', 'Rule-based customer groups for targeting.'],
    loyalty: ['Loyalty', 'Points earning, reward thresholds and referral bonuses.'],
    agents: ['Referral Agents', 'Active agent register, wallets, tiers and account status.'],
    applications: ['Agent Applications', 'Review, approve or reject new referral agent applications.'],
    contracts: ['Contracts', 'Agent agreements and reusable contract templates.'],
    'referral-codes': ['Referral Codes', 'Codes, share links and QR payloads issued to agents.'],
    performance: ['Performance', 'Agent leaderboard and incentive programmes.'],
    commissions: ['Commissions', 'Approve, make payable and settle agent commissions.'],
    payments: ['Payments', 'Agent payouts — automatically settles the oldest payable commissions.'],
    analytics: ['Analytics', 'Campaign ROI: revenue, costs, contribution, clicks and scans.'],
    reports: ['Reports', 'Download any dataset as CSV for accounting or review.'],
    audit: ['Audit Trail', 'Every privileged marketing action, with before and after values.'],
    users: ['Users & Access', 'Link POS user accounts to referral agents so they can sign in.'],
    settings: ['Settings', 'Commission defaults, public applications and referral link base.']
  },

  navHtml() {
    return this.NAV.map(([group, items]) => `
      <div class="mktp-nav-group">${this.esc(group)}</div>
      ${items.map(([id, label]) => {
        const count = id === 'applications' ? this.counts.applications
          : id === 'notifications' ? this.counts.notifications : 0;
        return `<button type="button" class="mktp-nav-btn ${this.section === id ? 'active' : ''}"
          data-mktp-act="nav" data-section="${id}">
          <span class="mktp-nav-dot"></span>
          <span>${this.esc(label)}</span>
          ${count ? `<span class="mktp-nav-count">${count}</span>` : ''}
        </button>`;
      }).join('')}`).join('');
  },

  async refreshCounts() {
    try {
      const [agents, notes] = await Promise.all([
        API.mktpAgents({ status: 'pending' }, this.actor()),
        API.mktpNotifications({ audience: 'admin', unread_only: true }, this.actor())
      ]);
      this.counts.applications = (agents?.data || []).length;
      this.counts.notifications = (notes?.data || []).length;
    } catch (_) { /* counts are cosmetic */ }
  },

  /* ─── Render shell ────────────────────────────────────────────────────── */

  async render(el, app) {
    this.el = el;
    this.app = app || this.app;
    this.ensureCss();
    if (!this.filters.from) this.filters.from = this.monthStart();
    if (!this.filters.to) this.filters.to = this.today();
    this.clearCache();

    el.innerHTML = `<div class="mktp-root"><div class="mktp-layout">
      <aside class="mktp-sidebar">
        <div class="mktp-brand">
          <div class="mktp-brand-mark">MC</div>
          <div class="mktp-brand-text">
            <strong>Command Centre</strong>
            <small>Marketing &amp; Referrals</small>
          </div>
        </div>
        <nav class="mktp-nav" id="mktp-nav"><p class="muted" style="padding:8px">Loading…</p></nav>
      </aside>
      <main class="mktp-main" id="mktp-main">
        <div class="mktp-topbar" id="mktp-topbar"></div>
        <div id="mktp-body"><p class="muted">Loading…</p></div>
      </main>
    </div></div>`;

    await Promise.all([this.refreshCounts(), this.renderTopbar()]);
    const nav = document.getElementById('mktp-nav');
    if (nav) nav.innerHTML = this.navHtml();
    this.bindActions();
    await this.renderSection();
  },

  async renderTopbar() {
    const bar = document.getElementById('mktp-topbar');
    if (!bar) return;
    const [businesses, branches] = await Promise.all([this.businesses(), this.branches()]);
    const scoped = this.filters.businessId
      ? branches.filter((b) => String(b.business_id) === String(this.filters.businessId))
      : branches;
    bar.innerHTML = `
      ${this.fld('mktp-f-biz', 'Business', {
        value: this.filters.businessId,
        options: [['', 'All businesses'], ...businesses.map((b) => [b.id, b.name])]
      })}
      ${this.fld('mktp-f-branch', 'Branch', {
        value: this.filters.branchId,
        options: [['', 'All branches'], ...scoped.map((b) => [b.id, b.name])]
      })}
      ${this.fld('mktp-f-from', 'From', { type: 'date', value: this.filters.from })}
      ${this.fld('mktp-f-to', 'To', { type: 'date', value: this.filters.to })}
      <div class="mktp-topbar-spacer"></div>
      <div class="mktp-actions">
        ${this.btn('Apply', 'apply-filters', {}, 'btn-primary')}
        ${this.btn('This month', 'range-month')}
        ${this.btn('Today', 'range-today')}
        ${this.btn('Reset', 'reset-filters')}
      </div>`;
  },

  bindActions() {
    if (this._delegated) return;
    this._delegated = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('[data-mktp-act]');
      if (!btn) return;
      const inRoot = !!btn.closest('.mktp-root');
      const inModal = !!btn.closest('#modal-overlay');
      if (!inRoot && !inModal) return;
      if (!document.querySelector('.mktp-root')) return;
      const fn = this.ACT[btn.dataset.mktpAct];
      if (!fn) return;
      e.preventDefault();
      const wasDisabled = btn.disabled;
      btn.disabled = true;
      try {
        await fn.call(this, { ...btn.dataset }, btn);
      } catch (err) {
        this.toast(err?.message || 'Action failed', 'error');
      } finally {
        if (!wasDisabled && btn.isConnected) btn.disabled = false;
      }
    });
  },

  async refresh() {
    this.clearCache();
    await this.renderSection();
  },

  async hardRefresh() {
    await this.render(this.el, this.app);
  },

  async renderSection() {
    const body = document.getElementById('mktp-body');
    if (!body) return;
    const meta = this.SECTION_META[this.section] || ['Marketing', ''];
    body.innerHTML = `<p class="muted">Loading ${this.esc(meta[0])}…</p>`;
    const map = {
      dashboard: 'renderDashboard',
      calendar: 'renderCalendar',
      notifications: 'renderNotifications',
      businesses: 'renderBusinesses',
      branches: 'renderBranches',
      campaigns: 'renderCampaigns',
      promotions: 'renderPromotions',
      'flyer-designer': 'renderFlyerDesigner',
      social: 'renderSocial',
      whatsapp: 'renderWhatsapp',
      coupons: 'renderCoupons',
      'qr-codes': 'renderQrCodes',
      customers: 'renderCustomers',
      segments: 'renderSegments',
      loyalty: 'renderLoyalty',
      agents: 'renderAgents',
      applications: 'renderApplications',
      contracts: 'renderContracts',
      'referral-codes': 'renderReferralCodes',
      performance: 'renderPerformance',
      commissions: 'renderCommissions',
      payments: 'renderPayments',
      analytics: 'renderAnalytics',
      reports: 'renderReports',
      audit: 'renderAudit',
      users: 'renderUsers',
      settings: 'renderSettings'
    };
    const fn = this[map[this.section]] || this.renderDashboard;
    try {
      await fn.call(this, body);
    } catch (err) {
      body.innerHTML = `${this.head(meta[0], meta[1])}<p class="error-msg">${this.esc(err?.message || 'Failed to load section')}</p>`;
    }
  },

  sectionHead(actionsHtml) {
    const [title, sub] = this.SECTION_META[this.section] || ['Marketing', ''];
    return this.head(title, sub, actionsHtml);
  },

  /* ─── Dashboard ───────────────────────────────────────────────────────── */

  /** Render a backend dashboard card using its own `format` hint. */
  cardValue(card) {
    if (card.format === 'money') return this.money(card.value);
    if (card.format === 'percent') return `${Number(card.value) || 0}%`;
    return (Number(card.value) || 0).toLocaleString();
  },

  cardTone(card) {
    return ({ positive: 'good', warning: 'warn', negative: 'bad' })[card.tone] || 'accent';
  },

  /** Dashboard alert `action` keys → Command Centre sections. */
  ALERT_SECTION: {
    referral_agents: 'applications',
    commissions: 'commissions',
    payments: 'payments',
    promotions: 'promotions',
    contracts: 'contracts',
    campaigns: 'campaigns'
  },

  async renderDashboard(el) {
    const d = (await this.apiOk(API.mktpDashboard(this.filterScope(), this.actor()), 'Could not load dashboard'));
    if (!d) {
      el.innerHTML = `${this.sectionHead('')}
        <p class="error-msg">Could not load marketing dashboard. Check that you are signed in as owner/manager, then retry.</p>
        ${this.btn('Retry', 'nav', { section: 'dashboard' }, 'btn-primary')}`;
      return;
    }
    const range = d.range || {};
    const cards = d.cards || [];
    const alerts = d.alerts || [];
    const commissions = d.commissions || {};
    const topCampaigns = d.top_campaigns || [];
    const topAgents = d.top_agents || [];
    const events = d.upcoming_events || [];
    const activity = d.recent_activity || [];

    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New campaign', 'campaign-new', {}, 'btn-primary')}
        ${this.btn('Review applications', 'nav', { section: 'applications' })}
        ${this.btn('Export summary', 'export-dashboard')}
      `)}
      <div class="mktp-note">Reporting period <strong>${this.esc(range.from || this.filters.from)}</strong> to <strong>${this.esc(range.to || this.filters.to)}</strong>${this.filters.businessId ? ' · filtered by business' : ''}${this.filters.branchId ? ' · filtered by branch' : ''}.</div>
      ${alerts.length ? `<div class="mktp-panel"><div class="mktp-panel-b">
        ${alerts.map((a) => `<div class="mktp-alert ${this.esc(a.level || 'info')}">
          <span>${this.esc(a.message)}</span>
          ${this.ALERT_SECTION[a.action] ? this.btn('Open', 'nav', { section: this.ALERT_SECTION[a.action] }) : ''}
        </div>`).join('')}
      </div></div>` : ''}
      <div class="mktp-kpis">
        ${cards.map((c) => this.kpi(c.label, this.cardValue(c), c.hint, this.cardTone(c))).join('')}
      </div>
      ${this.panel('Revenue by campaign', this.chart(
        topCampaigns.filter((c) => Number(c.revenue) > 0),
        (c) => String(c.name || '').slice(0, 12),
        (c) => c.revenue
      ))}
      ${this.panel('Commission pipeline', this.chart(
        [
          ['Pending', commissions.pending], ['Approved', commissions.approved], ['Payable', commissions.payable],
          ['Paid', commissions.paid], ['Reversed', commissions.reversed]
        ].filter(([, v]) => Number(v) > 0),
        (r) => r[0],
        (r) => r[1]
      ))}
      <div class="mktp-grid-2">
        ${this.panel('Top campaigns', this.table(
          ['Campaign', 'Status', 'Referrals', 'Revenue', ''],
          topCampaigns.map((c) => `<tr>
            <td><strong>${this.esc(c.name)}</strong><br><small class="muted">${this.esc(c.start_date || '')}${c.end_date ? ` → ${this.esc(c.end_date)}` : ''}</small></td>
            <td>${this.statusTag(c.status)}</td>
            <td>${this.esc(c.referrals || 0)}</td>
            <td>${this.money(c.revenue)}<br><small class="muted">${this.money(c.commission)} commission</small></td>
            <td>${this.btn('Analytics', 'campaign-analytics', { id: c.id })}</td>
          </tr>`).join(''),
          'No campaign activity in this period'
        ), '', true)}
        ${this.panel('Top agents', this.table(
          ['#', 'Agent', 'Sales', 'Commission'],
          topAgents.map((a, i) => `<tr>
            <td><span class="mktp-lb-rank ${i === 0 ? 'top' : ''}">${this.esc(a.rank || i + 1)}</span></td>
            <td>${this.esc(a.full_name)}<br><small class="muted">${this.esc(a.referral_code || a.agent_code || '')}</small></td>
            <td>${this.money(a.revenue)}<br><small class="muted">${this.esc(a.orders || 0)} orders</small></td>
            <td>${this.money(a.commission)}</td>
          </tr>`).join(''),
          'No agent sales in this period'
        ), '', true)}
      </div>
      <div class="mktp-grid-2">
        ${this.panel('Coming up (next 30 days)', this.table(
          ['Date', 'Event', 'Type'],
          events.map((e) => `<tr>
            <td>${this.esc(e.event_date || e.start_date || '')}</td>
            <td>${this.esc(e.title)}</td>
            <td>${this.tag(e.event_type || 'event', 'info')}</td>
          </tr>`).join(''),
          'Nothing scheduled in the next 30 days'
        ), this.btn('Open calendar', 'nav', { section: 'calendar' }), true)}
        ${this.panel('Recent activity', this.table(
          ['When', 'Who', 'Action'],
          activity.map((a) => `<tr>
            <td>${this.esc(String(a.created_at || '').slice(0, 16).replace('T', ' '))}</td>
            <td>${this.esc(a.user_name || a.actor_name || '—')}</td>
            <td>${this.esc(String(a.action || '').replace(/_/g, ' '))} <small class="muted">${this.esc(a.entity_type || '')}</small></td>
          </tr>`).join(''),
          'No activity logged yet'
        ), this.btn('Audit log', 'nav', { section: 'audit' }), true)}
      </div>`;
    this._cache.dashboard = d;
  },

  /* ─── Businesses ──────────────────────────────────────────────────────── */

  async renderBusinesses(el) {
    const rows = await this.list(API.mktpBusinesses({}), 'Could not load businesses');
    this._cache.businesses = rows;
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('Add business', 'business-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-businesses')}
      `)}
      ${this.panel('', this.table(
        ['Business', 'Code', 'Contact', 'Branches', 'Status', ''],
        rows.map((b) => `<tr>
          <td><strong>${this.esc(b.name)}</strong>${b.address ? `<br><small class="muted mktp-truncate">${this.esc(b.address)}</small>` : ''}</td>
          <td>${b.code ? `<span class="mktp-code">${this.esc(b.code)}</span>` : '—'}</td>
          <td>${this.esc(b.contact_phone || '—')}<br><small class="muted">${this.esc(b.contact_email || '')}</small></td>
          <td>${this.esc(b.branch_count || 0)}</td>
          <td>${this.statusTag(b.is_active ? 'active' : 'inactive')}</td>
          <td>${this.rowBtns(`
            ${this.btn('Edit', 'business-edit', { id: b.id })}
            ${b.is_active
              ? this.btn('Deactivate', 'business-toggle', { id: b.id, active: '0' }, 'btn-warning')
              : this.btn('Activate', 'business-toggle', { id: b.id, active: '1' }, 'btn-success')}
          `)}</td>
        </tr>`).join(''),
        'No businesses yet — add your first business'
      ), '', true)}`;
  },

  async businessForm(existing) {
    const b = existing || {};
    const social = b.social || {};
    this.openForm(b.id ? `Edit ${b.name}` : 'Add business', `
      ${this.grid([
        this.fld('mktp-b-name', 'Business name *', { value: b.name || '' }),
        this.fld('mktp-b-code', 'Short code', { value: b.code || '', placeholder: 'MAIN' }),
        this.fld('mktp-b-phone', 'Contact phone', { value: b.contact_phone || '' }),
        this.fld('mktp-b-email', 'Contact email', { value: b.contact_email || '' }),
        this.fld('mktp-b-wa', 'WhatsApp number', { value: b.whatsapp_number || '' }),
        this.fld('mktp-b-logo', 'Logo path', { value: b.logo_path || '' }),
        this.fld('mktp-b-fb', 'Facebook', { value: social.facebook || '' }),
        this.fld('mktp-b-ig', 'Instagram', { value: social.instagram || '' }),
        this.fld('mktp-b-tt', 'TikTok', { value: social.tiktok || '' }),
        this.fld('mktp-b-web', 'Website', { value: social.website || '' }),
        this.fld('mktp-b-addr', 'Address', { value: b.address || '', full: true }),
        this.fld('mktp-b-desc', 'Description', { value: b.description || '', rows: 2, full: true }),
        this.fld('mktp-b-active', 'Active', { type: 'checkbox', value: b.id ? b.is_active : 1 })
      ])}`, async () => {
      const name = this.val('mktp-b-name');
      if (!name) {
        this.toast('Business name is required', 'error');
        return false;
      }
      const saved = await this.apiOk(API.mktpSaveBusiness({
        id: b.id || undefined,
        name,
        code: this.val('mktp-b-code'),
        contact_phone: this.val('mktp-b-phone') || null,
        contact_email: this.val('mktp-b-email') || null,
        whatsapp_number: this.val('mktp-b-wa') || null,
        logo_path: this.val('mktp-b-logo') || null,
        address: this.val('mktp-b-addr') || null,
        description: this.val('mktp-b-desc') || null,
        social: {
          facebook: this.val('mktp-b-fb'),
          instagram: this.val('mktp-b-ig'),
          tiktok: this.val('mktp-b-tt'),
          website: this.val('mktp-b-web')
        },
        is_active: this.chk('mktp-b-active') ? 1 : 0
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Business saved', 'success');
      return true;
    }, 'Save business');
  },

  /* ─── Branches ────────────────────────────────────────────────────────── */

  async renderBranches(el) {
    const [rows, businesses] = await Promise.all([
      this.list(API.mktpBranches(this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {}), 'Could not load branches'),
      this.businesses()
    ]);
    const unlinked = rows.filter((b) => !b.business_id).length;
    el.innerHTML = `
      ${this.sectionHead(this.btn('Export CSV', 'export-branches'))}
      ${unlinked ? `<div class="mktp-note">${unlinked} branch(es) are not linked to a business. Link them so campaigns, promotions and commissions scope correctly.</div>` : ''}
      ${this.panel('', this.table(
        ['Branch', 'Business', 'Phone', 'Status', ''],
        rows.map((b) => `<tr>
          <td><strong>${this.esc(b.name)}</strong>${b.address ? `<br><small class="muted mktp-truncate">${this.esc(b.address)}</small>` : ''}</td>
          <td>${b.business_name ? this.esc(b.business_name) : this.tag('Unlinked', 'warn')}</td>
          <td>${this.esc(b.phone || '—')}</td>
          <td>${this.statusTag((b.is_active ?? 1) ? 'active' : 'inactive')}</td>
          <td>${this.btn('Link business', 'branch-link', { id: b.id, business: b.business_id || '' })}</td>
        </tr>`).join(''),
        'No branches found'
      ), '', true)}
      ${businesses.length ? '' : '<div class="mktp-note">Create a business first, then link branches to it.</div>'}`;
  },

  async branchLinkForm(branchId, currentBusiness) {
    const businesses = await this.businesses();
    this.openForm('Link branch to business', `
      ${this.grid([
        this.fld('mktp-bl-biz', 'Business', {
          value: currentBusiness || '',
          options: [['', '— Unlinked —'], ...businesses.map((b) => [b.id, b.name])],
          full: true
        })
      ])}
      <p class="muted">Commissions, promotions and campaigns for this branch will roll up to the selected business.</p>`,
      async () => {
        const bizId = this.val('mktp-bl-biz');
        const saved = await this.apiOk(API.mktpLinkBranch(parseInt(branchId, 10), bizId ? parseInt(bizId, 10) : null, this.actor()), 'Link failed');
        if (!saved) return false;
        this.toast('Branch updated', 'success');
        return true;
      }, 'Save link');
  },

  /* ─── Campaigns ───────────────────────────────────────────────────────── */

  CAMPAIGN_STATUSES: ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'],
  CHANNELS: ['facebook', 'instagram', 'tiktok', 'whatsapp', 'sms', 'email', 'print', 'in_store'],

  async renderCampaigns(el) {
    const rows = await this.list(API.mktpCampaigns(this.bizScope(), this.actor()), 'Could not load campaigns');
    this._cache.campaigns = rows;
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New campaign', 'campaign-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-campaigns')}
      `)}
      ${this.panel('', this.table(
        ['Campaign', 'Promotion', 'Scope', 'Window', 'Channels', 'Budget', 'Status', ''],
        rows.map((c) => `<tr>
          <td><strong>${this.esc(c.name)}</strong>${c.description ? `<br><small class="muted mktp-truncate">${this.esc(c.description)}</small>` : ''}</td>
          <td>${this.esc(c.promotion_name || '—')}</td>
          <td>${this.esc(c.business_name || 'All')}${c.branch_name ? `<br><small class="muted">${this.esc(c.branch_name)}</small>` : ''}</td>
          <td>${this.esc(c.start_date || '—')}<br><small class="muted">to ${this.esc(c.end_date || '—')}</small></td>
          <td>${(c.channels || []).length ? (c.channels || []).map((ch) => this.tag(ch, 'info')).join(' ') : '—'}</td>
          <td>${this.money(c.budget)}<br><small class="muted">cost ${this.money(c.marketing_cost)}</small></td>
          <td>${this.statusTag(c.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('Edit', 'campaign-edit', { id: c.id })}
            ${c.status !== 'active' ? this.btn('Activate', 'campaign-status', { id: c.id, status: 'active' }, 'btn-success') : this.btn('Pause', 'campaign-status', { id: c.id, status: 'paused' }, 'btn-warning')}
            ${this.btn('Assets', 'campaign-assets', { id: c.id })}
            ${this.btn('Analytics', 'campaign-analytics', { id: c.id })}
            ${this.btn('Duplicate', 'campaign-duplicate', { id: c.id })}
            ${this.btn('Status…', 'campaign-status-pick', { id: c.id, current: c.status })}
          `)}</td>
        </tr>`).join(''),
        'No campaigns yet — create your first campaign'
      ), '', true)}`;
  },

  async campaignForm(existing) {
    const c = existing || {};
    const [businesses, branches, promotions, rules] = await Promise.all([
      this.businesses(), this.branches(), this.promotionList(), this.commissionRuleList()
    ]);
    const channels = c.channels || [];
    this.openForm(c.id ? `Edit ${c.name}` : 'New campaign', `
      ${this.grid([
        this.fld('mktp-c-name', 'Campaign name *', { value: c.name || '' }),
        this.fld('mktp-c-status', 'Status', { value: c.status || 'draft', options: this.CAMPAIGN_STATUSES.map((s) => [s, s]) }),
        this.fld('mktp-c-biz', 'Business', { value: c.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-c-branch', 'Branch', { value: c.branch_id || '', options: this.branchOptions(branches) }),
        this.fld('mktp-c-promo', 'Promotion', { value: c.promotion_id || '', options: [['', '— None —'], ...promotions.map((p) => [p.id, p.name])] }),
        this.fld('mktp-c-audience', 'Target audience', { value: c.target_audience || '', placeholder: 'e.g. Payday shoppers' }),
        this.fld('mktp-c-start', 'Start date', { type: 'date', value: c.start_date || this.today() }),
        this.fld('mktp-c-end', 'End date', { type: 'date', value: c.end_date || '' }),
        this.fld('mktp-c-budget', 'Budget', { type: 'number', value: c.budget ?? 0, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-c-cost', 'Marketing cost', { type: 'number', value: c.marketing_cost ?? 0, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-c-rule', 'Commission rule', { value: c.commission_rule_id || '', options: [['', '— Default rule —'], ...rules.map((r) => [r.id, r.name])] }),
        this.fld('mktp-c-rate', 'Commission % override', { type: 'number', value: c.commission_rate ?? '', attrs: 'step="0.01" min="0"', placeholder: 'Blank = use rule' }),
        this.fld('mktp-c-fixed', 'Fixed commission override', { type: 'number', value: c.commission_fixed ?? '', attrs: 'step="0.01" min="0"', placeholder: 'Blank = use rule' }),
        this.fld('mktp-c-desc', 'Description', { value: c.description || '', rows: 3, full: true })
      ])}
      <div class="field full"><label>Channels</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${this.CHANNELS.map((ch) => `<label style="display:flex;align-items:center;gap:5px;font-size:13px">
            <input type="checkbox" class="mktp-c-ch" value="${ch}" ${channels.includes(ch) ? 'checked' : ''}> ${this.esc(ch)}
          </label>`).join('')}
        </div>
      </div>`, async () => {
      const name = this.val('mktp-c-name');
      if (!name) {
        this.toast('Campaign name is required', 'error');
        return false;
      }
      const picked = Array.from(document.querySelectorAll('.mktp-c-ch:checked')).map((i) => i.value);
      const rateRaw = this.val('mktp-c-rate');
      const fixedRaw = this.val('mktp-c-fixed');
      const saved = await this.apiOk(API.mktpSaveCampaign({
        id: c.id || undefined,
        name,
        description: this.val('mktp-c-desc') || null,
        business_id: this.intVal('mktp-c-biz'),
        branch_id: this.intVal('mktp-c-branch'),
        promotion_id: this.intVal('mktp-c-promo'),
        target_audience: this.val('mktp-c-audience') || null,
        budget: this.numVal('mktp-c-budget'),
        marketing_cost: this.numVal('mktp-c-cost'),
        commission_rule_id: this.intVal('mktp-c-rule'),
        commission_rate: rateRaw === '' ? null : this.numVal('mktp-c-rate'),
        commission_fixed: fixedRaw === '' ? null : this.numVal('mktp-c-fixed'),
        start_date: this.val('mktp-c-start') || null,
        end_date: this.val('mktp-c-end') || null,
        status: this.val('mktp-c-status') || 'draft',
        channels: picked
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Campaign saved', 'success');
      return true;
    }, 'Save campaign');
  },

  async campaignAnalyticsModal(id) {
    const a = await this.apiOk(API.mktpCampaignAnalytics(parseInt(id, 10), this.actor()), 'Analytics unavailable');
    if (!a) return;
    this.openInfo(`Analytics — ${a.campaign_name || `Campaign #${id}`}`, `
      <div class="mktp-kpis">
        ${this.kpi('Revenue', this.money(a.revenue), `${a.orders || 0} orders`, 'good')}
        ${this.kpi('Total spend', this.money(a.spend), `${this.money(a.marketing_cost)} cost + ${this.money(a.commission)} commission`, 'warn')}
        ${this.kpi('Profit', this.money(a.profit), `ROI ${a.roi_percent || 0}%`, Number(a.profit) >= 0 ? 'good' : 'bad')}
        ${this.kpi('Budget used', `${a.budget_used_percent || 0}%`, `of ${this.money(a.budget)}`, 'slate')}
        ${this.kpi('Referrals', a.referrals || 0, `${a.conversions || 0} converted · ${a.conversion_rate || 0}%`)}
        ${this.kpi('Link clicks', a.clicks || 0, `${a.qr_scans || 0} QR scans`)}
        ${this.kpi('Coupons', a.coupons_redeemed || 0, `of ${a.coupons_issued || 0} issued`)}
        ${this.kpi('Avg order', this.money(a.average_order_value), `CPA ${this.money(a.cost_per_acquisition)}`)}
      </div>
      ${this.panel('Revenue by day', this.chart(a.daily || [], (r) => String(r.day || '').slice(5), (r) => r.revenue))}
      ${this.panel('By agent', this.table(
        ['Agent', 'Orders', 'Revenue', 'Commission'],
        (a.by_agent || []).map((r) => `<tr>
          <td>${this.esc(r.agent_name || '—')}<br><small class="muted">${this.esc(r.agent_code || '')}</small></td>
          <td>${this.esc(r.orders || 0)}</td>
          <td>${this.money(r.revenue)}</td>
          <td>${this.money(r.commission)}</td>
        </tr>`).join(''),
        'No attributed sales for this campaign yet'
      ), '', true)}
      <p class="muted">Attribution uses referral codes, coupons and campaign-tagged sales. Figures are indicative where a sale matched more than one source.</p>`);
  },

  /* ─── Promotions ──────────────────────────────────────────────────────── */

  PROMO_TYPES: [
    ['percent', 'Percentage off'],
    ['fixed', 'Fixed amount off'],
    ['bogo', 'Buy X get Y free'],
    ['bundle', 'Bundle price'],
    ['free_delivery', 'Free delivery']
  ],
  PROMO_STATUSES: ['draft', 'active', 'paused', 'expired', 'cancelled'],

  async renderPromotions(el) {
    const rows = await this.list(API.mktpPromotions(this.bizScope(), this.actor()), 'Could not load promotions');
    this._cache.promotions = rows;
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New promotion', 'promo-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-promotions')}
      `)}
      ${this.panel('', this.table(
        ['Promotion', 'Type', 'Value', 'Rules', 'Window', 'Status', ''],
        rows.map((p) => `<tr>
          <td><strong>${this.esc(p.name)}</strong>${p.notes ? `<br><small class="muted mktp-truncate">${this.esc(p.notes)}</small>` : ''}</td>
          <td>${this.esc((this.PROMO_TYPES.find((t) => t[0] === p.promo_type) || [null, p.promo_type])[1])}</td>
          <td>${p.promo_type === 'percent' ? `${this.esc(p.discount_value)}%` : p.promo_type === 'bogo' ? `Buy ${this.esc(p.buy_qty)} get ${this.esc(p.get_qty)}` : this.money(p.discount_value)}</td>
          <td><small class="muted">
            ${p.min_purchase ? `Min ${this.money(p.min_purchase)}<br>` : ''}
            ${p.max_discount != null ? `Cap ${this.money(p.max_discount)}<br>` : ''}
            ${p.usage_limit != null ? `Limit ${this.esc(p.usage_limit)}<br>` : ''}
            ${p.requires_referral ? 'Referral required<br>' : ''}
            ${p.requires_coupon ? 'Coupon required' : ''}
          </small></td>
          <td>${this.esc(p.start_date || '—')}<br><small class="muted">to ${this.esc(p.end_date || '—')}</small></td>
          <td>${this.statusTag(p.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('Edit', 'promo-edit', { id: p.id })}
            ${p.status === 'active'
              ? this.btn('Pause', 'promo-status', { id: p.id, status: 'paused' }, 'btn-warning')
              : this.btn('Activate', 'promo-status', { id: p.id, status: 'active' }, 'btn-success')}
            ${this.btn('Expire', 'promo-status', { id: p.id, status: 'expired' })}
          `)}</td>
        </tr>`).join(''),
        'No promotions yet — create your first offer'
      ), '', true)}`;
  },

  async promoForm(existing) {
    const p = existing || {};
    const [businesses, branches] = await Promise.all([this.businesses(), this.branches()]);
    this.openForm(p.id ? `Edit ${p.name}` : 'New promotion', `
      ${this.grid([
        this.fld('mktp-p-name', 'Promotion name *', { value: p.name || '' }),
        this.fld('mktp-p-type', 'Promotion type', { value: p.promo_type || 'percent', options: this.PROMO_TYPES }),
        this.fld('mktp-p-value', 'Discount value', { type: 'number', value: p.discount_value ?? 0, attrs: 'step="0.01" min="0"', hint: 'Percent for % off, amount for fixed' }),
        this.fld('mktp-p-status', 'Status', { value: p.status || 'draft', options: this.PROMO_STATUSES.map((s) => [s, s]) }),
        this.fld('mktp-p-biz', 'Business', { value: p.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-p-branch', 'Branch', { value: p.branch_id || '', options: this.branchOptions(branches) }),
        this.fld('mktp-p-buy', 'Buy quantity', { type: 'number', value: p.buy_qty ?? 1, attrs: 'min="1"' }),
        this.fld('mktp-p-get', 'Get quantity', { type: 'number', value: p.get_qty ?? 1, attrs: 'min="1"' }),
        this.fld('mktp-p-min', 'Minimum purchase', { type: 'number', value: p.min_purchase ?? 0, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-p-max', 'Maximum discount', { type: 'number', value: p.max_discount ?? '', attrs: 'step="0.01" min="0"', placeholder: 'No cap' }),
        this.fld('mktp-p-limit', 'Total usage limit', { type: 'number', value: p.usage_limit ?? '', attrs: 'min="0"', placeholder: 'Unlimited' }),
        this.fld('mktp-p-percust', 'Uses per customer', { type: 'number', value: p.usage_per_customer ?? '', attrs: 'min="0"', placeholder: 'Unlimited' }),
        this.fld('mktp-p-start', 'Start date', { type: 'date', value: p.start_date || this.today() }),
        this.fld('mktp-p-end', 'End date', { type: 'date', value: p.end_date || '' }),
        this.fld('mktp-p-ref', 'Requires referral code', { type: 'checkbox', value: p.requires_referral }),
        this.fld('mktp-p-coupon', 'Requires coupon', { type: 'checkbox', value: p.requires_coupon }),
        this.fld('mktp-p-notes', 'Notes / terms', { value: p.notes || '', rows: 2, full: true })
      ])}`, async () => {
      const name = this.val('mktp-p-name');
      if (!name) {
        this.toast('Promotion name is required', 'error');
        return false;
      }
      const maxRaw = this.val('mktp-p-max');
      const limitRaw = this.val('mktp-p-limit');
      const perCustRaw = this.val('mktp-p-percust');
      const saved = await this.apiOk(API.mktpSavePromotion({
        id: p.id || undefined,
        name,
        promo_type: this.val('mktp-p-type') || 'percent',
        discount_value: this.numVal('mktp-p-value'),
        business_id: this.intVal('mktp-p-biz'),
        branch_id: this.intVal('mktp-p-branch'),
        buy_qty: this.numVal('mktp-p-buy', 1),
        get_qty: this.numVal('mktp-p-get', 1),
        min_purchase: this.numVal('mktp-p-min'),
        max_discount: maxRaw === '' ? null : this.numVal('mktp-p-max'),
        usage_limit: limitRaw === '' ? null : this.numVal('mktp-p-limit'),
        usage_per_customer: perCustRaw === '' ? null : this.numVal('mktp-p-percust'),
        requires_referral: this.chk('mktp-p-ref') ? 1 : 0,
        requires_coupon: this.chk('mktp-p-coupon') ? 1 : 0,
        start_date: this.val('mktp-p-start') || null,
        end_date: this.val('mktp-p-end') || null,
        status: this.val('mktp-p-status') || 'draft',
        notes: this.val('mktp-p-notes') || null
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Promotion saved', 'success');
      return true;
    }, 'Save promotion');
  },

  /* ─── Flyer designer ──────────────────────────────────────────────────── */

  async renderFlyerDesigner(el) {
    const flyers = await this.list(API.getFlyers({}), 'Could not load flyers');
    const pending = flyers.filter((f) => (f.approval_status || 'draft') === 'pending');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('Open Flyer Studio', 'open-flyer-studio', {}, 'btn-primary')}
        ${this.btn('AI Generate Flyer', 'open-flyer-ai', {}, 'btn-ghost')}
        ${this.btn('Export CSV', 'export-flyers')}
      `)}
      <div class="mktp-note">The full designer — templates, product cards, print and social export — lives in Flyer Studio. Approvals and the artwork register stay here.</div>
      <div class="mktp-kpis">
        ${this.kpi('Total artwork', flyers.length, 'Flyers, posters, social', 'accent')}
        ${this.kpi('Awaiting approval', pending.length, 'Needs a decision', pending.length ? 'warn' : 'good')}
        ${this.kpi('Approved', flyers.filter((f) => f.approval_status === 'approved').length, 'Ready to publish', 'good')}
        ${this.kpi('Live', flyers.filter((f) => (f.display_status || f.status) === 'live').length, 'Running now')}
      </div>
      ${this.panel('Awaiting approval', this.table(
        ['Title', 'Size', 'Created', ''],
        pending.map((f) => `<tr>
          <td><strong>${this.esc(f.title || 'Untitled')}</strong>${f.promotion_name ? `<br><small class="muted">${this.esc(f.promotion_name)}</small>` : ''}</td>
          <td>${this.esc(f.flyer_size || '—')}</td>
          <td>${this.esc(f.created_at || '')}</td>
          <td>${this.rowBtns(`
            ${this.btn('Approve', 'flyer-approve', { id: f.id }, 'btn-success')}
            ${this.btn('Reject', 'flyer-reject', { id: f.id }, 'btn-danger')}
            ${this.btn('Design', 'open-flyer-studio', { id: f.id })}
          `)}</td>
        </tr>`).join(''),
        'Nothing awaiting approval'
      ), '', true)}
      ${this.panel('All artwork', this.table(
        ['Title', 'Size', 'Status', 'Approval', ''],
        flyers.map((f) => `<tr>
          <td>${this.esc(f.title || 'Untitled')}</td>
          <td>${this.esc(f.flyer_size || '—')}</td>
          <td>${this.statusTag(f.display_status || f.status || 'draft')}</td>
          <td>${this.statusTag(f.approval_status || 'draft')}</td>
          <td>${this.btn('Design', 'open-flyer-studio', { id: f.id })}</td>
        </tr>`).join(''),
        'No artwork yet — open Flyer Studio to create the first one'
      ), '', true)}`;
  },

  async openFlyerStudio(flyerId) {
    if (typeof App === 'undefined' || typeof App.navigate !== 'function') {
      this.toast('Flyer Studio is not available here', 'error');
      return;
    }
    if (window.MarketingFlyersPage) {
      MarketingFlyersPage.topTab = 'flyers';
      MarketingFlyersPage.view = 'list';
      MarketingFlyersPage.tab = 'campaigns';
      MarketingFlyersPage.pendingOpenFlyerId = flyerId ? parseInt(flyerId, 10) : null;
    } else {
      this._pendingFlyerId = flyerId || null;
    }
    await App.navigate('marketing');
    if (window.MarketingFlyersPage && this._pendingFlyerId) {
      MarketingFlyersPage.topTab = 'flyers';
      MarketingFlyersPage.pendingOpenFlyerId = parseInt(this._pendingFlyerId, 10);
      this._pendingFlyerId = null;
      await App.navigate('marketing');
    }
  },

  /* ─── Social posts ────────────────────────────────────────────────────── */

  PLATFORMS: ['facebook', 'instagram', 'tiktok', 'whatsapp', 'sms', 'x', 'youtube'],
  POST_STATUSES: ['draft', 'scheduled', 'published', 'cancelled'],

  async renderSocial(el) {
    const scope = this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {};
    const rows = await this.list(API.mktpSocialPosts(scope, this.actor()), 'Could not load social posts');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New post', 'social-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-social')}
      `)}
      ${this.panel('', this.table(
        ['Platform', 'Caption', 'Campaign', 'Scheduled', 'Status', ''],
        rows.map((s) => `<tr>
          <td>${this.tag(s.platform, 'info')}</td>
          <td><div class="mktp-truncate">${this.esc(s.caption || '—')}</div></td>
          <td>${s.campaign_id ? `#${this.esc(s.campaign_id)}` : '—'}</td>
          <td>${this.esc(s.scheduled_at || '—')}${s.published_at ? `<br><small class="muted">published ${this.esc(s.published_at)}</small>` : ''}</td>
          <td>${this.statusTag(s.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('Edit', 'social-edit', { id: s.id })}
            ${this.btn('Copy caption', 'copy-text', { text: s.caption || '' })}
            ${s.status !== 'published' ? this.btn('Publish live', 'social-publish', { id: s.id }, 'btn-success') : ''}
          `)}</td>
        </tr>`).join(''),
        'No social posts yet — draft one, or generate assets from a campaign'
      ), '', true)}`;
    this._cache.social = rows;
  },

  async socialForm(existing) {
    const s = existing || {};
    const [businesses, campaigns] = await Promise.all([this.businesses(), this.campaignList()]);
    this.openForm(s.id ? 'Edit social post' : 'New social post', `
      ${this.grid([
        this.fld('mktp-s-platform', 'Platform *', { value: s.platform || 'facebook', options: this.PLATFORMS.map((p) => [p, p]) }),
        this.fld('mktp-s-status', 'Status', { value: s.status || 'draft', options: this.POST_STATUSES.map((p) => [p, p]) }),
        this.fld('mktp-s-biz', 'Business', { value: s.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-s-camp', 'Campaign', { value: s.campaign_id || '', options: [['', '— None —'], ...campaigns.map((c) => [c.id, c.name])] }),
        this.fld('mktp-s-sched', 'Schedule for', { type: 'datetime-local', value: (s.scheduled_at || '').replace(' ', 'T').slice(0, 16) }),
        this.fld('mktp-s-media', 'Media path', { value: s.media_path || '', placeholder: 'Image or video file path' }),
        this.fld('mktp-s-caption', 'Caption', { value: s.caption || '', rows: 5, full: true, placeholder: 'Write the post copy, including hashtags' })
      ])}`, async () => {
      const saved = await this.apiOk(API.mktpSaveSocialPost({
        id: s.id || undefined,
        platform: this.val('mktp-s-platform') || 'facebook',
        status: this.val('mktp-s-status') || 'draft',
        business_id: this.intVal('mktp-s-biz'),
        campaign_id: this.intVal('mktp-s-camp'),
        scheduled_at: this.val('mktp-s-sched') ? this.val('mktp-s-sched').replace('T', ' ') : null,
        media_path: this.val('mktp-s-media') || null,
        caption: this.val('mktp-s-caption') || null,
        published_at: s.published_at || null
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Social post saved', 'success');
      return true;
    }, 'Save post');
  },

  /* ─── WhatsApp blasts ─────────────────────────────────────────────────── */

  SEGMENT_KEYS: [
    ['all_customers', 'All customers'],
    ['new_customers', 'New (last 30 days)'],
    ['inactive_customers', 'Inactive (30+ days)']
  ],
  BLAST_STATUSES: ['draft', 'scheduled', 'sending', 'sent', 'cancelled'],

  async renderWhatsapp(el) {
    const scope = this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {};
    const rows = await this.list(API.mktpWhatsappBlasts(scope, this.actor()), 'Could not load WhatsApp blasts');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New blast', 'wa-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-whatsapp')}
      `)}
      <div class="mktp-note">Blasts respect customer consent. Preview the audience before sending, and always include an opt-out line.</div>
      ${this.panel('', this.table(
        ['Blast', 'Segment', 'Message', 'Scheduled', 'Status', ''],
        rows.map((b) => `<tr>
          <td><strong>${this.esc(b.name || 'Untitled')}</strong>${b.campaign_id ? `<br><small class="muted">Campaign #${this.esc(b.campaign_id)}</small>` : ''}</td>
          <td>${this.tag((this.SEGMENT_KEYS.find((s) => s[0] === b.segment_key) || [null, b.segment_key])[1], 'info')}</td>
          <td><div class="mktp-truncate">${this.esc(b.message || '')}</div></td>
          <td>${this.esc(b.scheduled_at || '—')}</td>
          <td>${this.statusTag(b.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('Edit', 'wa-edit', { id: b.id })}
            ${this.btn('Preview audience', 'wa-audience', { segment: b.segment_key || 'all_customers', business: b.business_id || '' })}
            ${this.btn('Copy message', 'copy-text', { text: b.message || '' })}
            ${b.status !== 'sent' ? this.btn('Mark sent', 'wa-sent', { id: b.id }, 'btn-success') : ''}
          `)}</td>
        </tr>`).join(''),
        'No WhatsApp blasts yet'
      ), '', true)}`;
    this._cache.blasts = rows;
  },

  async whatsappForm(existing) {
    const b = existing || {};
    const [businesses, campaigns] = await Promise.all([this.businesses(), this.campaignList()]);
    this.openForm(b.id ? 'Edit WhatsApp blast' : 'New WhatsApp blast', `
      ${this.grid([
        this.fld('mktp-w-name', 'Blast name *', { value: b.name || '' }),
        this.fld('mktp-w-segment', 'Audience segment', { value: b.segment_key || 'all_customers', options: this.SEGMENT_KEYS }),
        this.fld('mktp-w-biz', 'Business', { value: b.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-w-camp', 'Campaign', { value: b.campaign_id || '', options: [['', '— None —'], ...campaigns.map((c) => [c.id, c.name])] }),
        this.fld('mktp-w-sched', 'Schedule for', { type: 'datetime-local', value: (b.scheduled_at || '').replace(' ', 'T').slice(0, 16) }),
        this.fld('mktp-w-status', 'Status', { value: b.status || 'draft', options: this.BLAST_STATUSES.map((s) => [s, s]) }),
        this.fld('mktp-w-msg', 'Message *', {
          value: b.message || '',
          rows: 5,
          full: true,
          placeholder: 'Hi! This week only… Reply STOP to opt out.'
        })
      ])}`, async () => {
      const message = this.val('mktp-w-msg');
      if (!message) {
        this.toast('Message is required', 'error');
        return false;
      }
      const saved = await this.apiOk(API.mktpSaveWhatsappBlast({
        id: b.id || undefined,
        name: this.val('mktp-w-name') || 'WhatsApp campaign',
        segment_key: this.val('mktp-w-segment') || 'all_customers',
        business_id: this.intVal('mktp-w-biz'),
        campaign_id: this.intVal('mktp-w-camp'),
        scheduled_at: this.val('mktp-w-sched') ? this.val('mktp-w-sched').replace('T', ' ') : null,
        status: this.val('mktp-w-status') || 'draft',
        message
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Blast saved', 'success');
      return true;
    }, 'Save blast');
  },

  async whatsappAudienceModal(segment, businessId) {
    const rows = await this.list(
      API.mktpWhatsappAudience(segment || 'all_customers', businessId ? parseInt(businessId, 10) : null, this.intVal('mktp-f-branch')),
      'Could not load audience'
    );
    this.openInfo(`Audience preview — ${segment || 'all customers'}`, `
      <p class="muted">${rows.length} recipient(s) match this segment.</p>
      ${this.table(['Customer', 'Phone'], rows.slice(0, 200).map((c) => `<tr>
        <td>${this.esc(c.full_name || '—')}</td>
        <td>${this.esc(c.phone || '—')}</td>
      </tr>`).join(''), 'No customers match this segment')}
      ${rows.length > 200 ? '<p class="muted">Showing the first 200 recipients.</p>' : ''}`);
  },

  /* ─── Calendar ────────────────────────────────────────────────────────── */

  EVENT_TYPES: ['campaign', 'promotion', 'launch', 'blast', 'deadline', 'custom'],

  async renderCalendar(el) {
    const rows = await this.list(API.mktpCalendar(this.filterScope(), this.actor()), 'Could not load calendar');
    const byDay = {};
    rows.forEach((r) => {
      const day = String(r.start_at || '').slice(0, 10) || 'Unscheduled';
      (byDay[day] = byDay[day] || []).push(r);
    });
    const daysHtml = Object.keys(byDay).sort().map((day) => `
      <div class="mktp-cal-day">
        <div class="mktp-cal-date">${this.esc(day)}</div>
        <div class="mktp-cal-items">
          ${byDay[day].map((e) => `<div style="margin-bottom:4px">
            ${this.tag(e.event_type || 'custom', 'info')}
            <strong>${this.esc(e.title)}</strong>
            ${e.end_at ? `<small class="muted"> until ${this.esc(String(e.end_at).slice(0, 10))}</small>` : ''}
            ${this.btn('Edit', 'cal-edit', { id: e.id })}
          </div>`).join('')}
        </div>
      </div>`).join('');

    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('Add event', 'cal-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-calendar')}
      `)}
      ${this.panel(`${rows.length} event(s) between ${this.filters.from} and ${this.filters.to}`,
        daysHtml || '<div class="mktp-empty">No marketing events in this period. Campaigns with a start date appear here automatically.</div>')}`;
    this._cache.calendar = rows;
  },

  async calendarForm(existing) {
    const e = existing || {};
    const [businesses, branches] = await Promise.all([this.businesses(), this.branches()]);
    this.openForm(e.id ? 'Edit event' : 'Add marketing event', `
      ${this.grid([
        this.fld('mktp-e-title', 'Title *', { value: e.title || '' }),
        this.fld('mktp-e-type', 'Event type', { value: e.event_type || 'custom', options: this.EVENT_TYPES.map((t) => [t, t]) }),
        this.fld('mktp-e-start', 'Start', { type: 'date', value: String(e.start_at || this.today()).slice(0, 10) }),
        this.fld('mktp-e-end', 'End', { type: 'date', value: String(e.end_at || '').slice(0, 10) }),
        this.fld('mktp-e-biz', 'Business', { value: e.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-e-branch', 'Branch', { value: e.branch_id || '', options: this.branchOptions(branches) }),
        this.fld('mktp-e-color', 'Colour', { type: 'color', value: e.color || '#0f766e' })
      ])}`, async () => {
      const title = this.val('mktp-e-title');
      const start = this.val('mktp-e-start');
      if (!title || !start) {
        this.toast('Title and start date are required', 'error');
        return false;
      }
      const saved = await this.apiOk(API.mktpSaveCalendar({
        id: e.id || undefined,
        title,
        event_type: this.val('mktp-e-type') || 'custom',
        start_at: start,
        end_at: this.val('mktp-e-end') || null,
        business_id: this.intVal('mktp-e-biz'),
        branch_id: this.intVal('mktp-e-branch'),
        color: this.val('mktp-e-color') || null
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Event saved', 'success');
      return true;
    }, 'Save event');
  },

  /* ─── Customers ───────────────────────────────────────────────────────── */

  async renderCustomers(el) {
    const search = this.ui.customerSearch || '';
    const f = { ...this.bizScope() };
    if (search) f.search = search;
    const rows = await this.list(API.mktpCustomers(f, this.actor()), 'Could not load customers');
    el.innerHTML = `
      ${this.sectionHead(this.btn('Export CSV', 'export-customers'))}
      ${this.panel('Search', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${this.fld('mktp-cust-q', 'Name, phone or email', { value: search })}
          ${this.btn('Search', 'customer-search', {}, 'btn-primary')}
          ${this.btn('Clear', 'customer-search-clear')}
        </div>`)}
      ${this.panel(`${rows.length} customer(s)`, this.table(
        ['Customer', 'Phone', 'Email', 'Orders', 'Total spent', 'Joined', ''],
        rows.map((c) => `<tr>
          <td><strong>${this.esc(c.full_name || '—')}</strong></td>
          <td>${this.esc(c.phone || '—')}</td>
          <td>${this.esc(c.email || '—')}</td>
          <td>${this.esc(c.order_count || 0)}</td>
          <td>${this.money(c.total_spent)}</td>
          <td>${this.esc(String(c.created_at || '').slice(0, 10))}</td>
          <td>${this.btn('Attribute referral', 'customer-attribute', { id: c.id, name: c.full_name || '' })}</td>
        </tr>`).join(''),
        search ? 'No customers match that search' : 'No customers captured yet'
      ), '', true)}`;
    this._cache.customers = rows;
  },

  async attributeForm(customerId, customerName) {
    const campaigns = await this.campaignList();
    this.openForm(`Attribute ${customerName || 'customer'} to an agent`, `
      ${this.grid([
        this.fld('mktp-at-code', 'Referral code *', { value: '', placeholder: 'e.g. THABO482' }),
        this.fld('mktp-at-camp', 'Campaign', { value: '', options: [['', '— None —'], ...campaigns.map((c) => [c.id, c.name])] })
      ])}
      <p class="muted">Links this customer to the agent that owns the referral code, so future sales earn commission.</p>`,
      async () => {
        const code = this.val('mktp-at-code');
        if (!code) {
          this.toast('Referral code is required', 'error');
          return false;
        }
        const saved = await this.apiOk(API.mktpAttribute({
          code,
          customer_id: parseInt(customerId, 10),
          campaign_id: this.intVal('mktp-at-camp'),
          method: 'admin'
        }, this.actor()), 'Attribution failed');
        if (!saved) return false;
        this.toast('Referral attributed', 'success');
        return true;
      }, 'Attribute');
  },

  /* ─── Segments ────────────────────────────────────────────────────────── */

  async renderSegments(el) {
    const rows = await this.list(API.mktpSegments(this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {}, this.actor()), 'Could not load segments');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New segment', 'segment-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-segments')}
      `)}
      ${this.panel('', this.table(
        ['Segment', 'Rules', 'Auto', ''],
        rows.map((s) => {
          const r = s.rules || {};
          const bits = [];
          if (r.new_days) bits.push(`Joined in last ${r.new_days} days`);
          if (r.inactive_days) bits.push(`Inactive ${r.inactive_days}+ days`);
          if (r.min_spend) bits.push(`Spent ${this.money(r.min_spend)}+`);
          return `<tr>
            <td><strong>${this.esc(s.name)}</strong></td>
            <td><small class="muted">${bits.length ? this.esc(bits.join(' · ')) : 'All customers'}</small></td>
            <td>${s.is_auto ? this.tag('Auto', 'ok') : this.tag('Manual', 'muted')}</td>
            <td>${this.rowBtns(`
              ${this.btn('Edit', 'segment-edit', { id: s.id })}
              ${this.btn('Evaluate', 'segment-evaluate', { id: s.id, name: s.name })}
            `)}</td>
          </tr>`;
        }).join(''),
        'No segments yet — create one to target campaigns'
      ), '', true)}`;
    this._cache.segments = rows;
  },

  async segmentForm(existing) {
    const s = existing || {};
    const r = s.rules || {};
    const businesses = await this.businesses();
    this.openForm(s.id ? `Edit ${s.name}` : 'New segment', `
      ${this.grid([
        this.fld('mktp-sg-name', 'Segment name *', { value: s.name || '' }),
        this.fld('mktp-sg-biz', 'Business', { value: s.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-sg-new', 'New customers within (days)', { type: 'number', value: r.new_days ?? '', attrs: 'min="0"', placeholder: 'Ignore' }),
        this.fld('mktp-sg-inactive', 'Inactive for at least (days)', { type: 'number', value: r.inactive_days ?? '', attrs: 'min="0"', placeholder: 'Ignore' }),
        this.fld('mktp-sg-spend', 'Minimum lifetime spend', { type: 'number', value: r.min_spend ?? '', attrs: 'step="0.01" min="0"', placeholder: 'Ignore' }),
        this.fld('mktp-sg-auto', 'Recalculate automatically', { type: 'checkbox', value: s.id ? s.is_auto : 1 })
      ])}`, async () => {
      const name = this.val('mktp-sg-name');
      if (!name) {
        this.toast('Segment name is required', 'error');
        return false;
      }
      const rules = {};
      if (this.val('mktp-sg-new')) rules.new_days = this.numVal('mktp-sg-new');
      if (this.val('mktp-sg-inactive')) rules.inactive_days = this.numVal('mktp-sg-inactive');
      if (this.val('mktp-sg-spend')) rules.min_spend = this.numVal('mktp-sg-spend');
      const saved = await this.apiOk(API.mktpSaveSegment({
        id: s.id || undefined,
        name,
        business_id: this.intVal('mktp-sg-biz'),
        rules,
        is_auto: this.chk('mktp-sg-auto') ? 1 : 0
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Segment saved', 'success');
      return true;
    }, 'Save segment');
  },

  async segmentEvaluateModal(id, name) {
    const rows = await this.list(API.mktpEvaluateSegment(parseInt(id, 10)), 'Evaluation failed');
    this.openInfo(`Segment — ${name || `#${id}`}`, `
      <p class="muted">${rows.length} customer(s) currently match this segment.</p>
      ${this.table(['Customer', 'Phone', 'Joined'], rows.slice(0, 200).map((c) => `<tr>
        <td>${this.esc(c.full_name || '—')}</td>
        <td>${this.esc(c.phone || '—')}</td>
        <td>${this.esc(String(c.created_at || '').slice(0, 10))}</td>
      </tr>`).join(''), 'No customers match these rules')}`);
  },

  /* ─── Loyalty ─────────────────────────────────────────────────────────── */

  async renderLoyalty(el) {
    const rows = await this.list(API.mktpLoyaltyRules(this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {}, this.actor()), 'Could not load loyalty rules');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New rule', 'loyalty-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-loyalty')}
      `)}
      <div class="mktp-note">Points are awarded automatically on completed referral-attributed sales using the first active rule that matches the business.</div>
      ${this.panel('', this.table(
        ['Rule', 'Type', 'Points per currency', 'Reward threshold', 'Referral bonus', 'Status', ''],
        rows.map((r) => `<tr>
          <td><strong>${this.esc(r.name)}</strong>${r.reward_description ? `<br><small class="muted">${this.esc(r.reward_description)}</small>` : ''}</td>
          <td>${this.esc(r.rule_type || 'points')}</td>
          <td>${this.esc(r.points_per_currency ?? 1)}</td>
          <td>${this.esc(r.reward_threshold ?? 0)}</td>
          <td>${this.esc(r.referral_bonus_points ?? 0)}</td>
          <td>${this.statusTag(r.is_active ? 'active' : 'inactive')}</td>
          <td>${this.rowBtns(`
            ${this.btn('Edit', 'loyalty-edit', { id: r.id })}
            ${this.btn(r.is_active ? 'Deactivate' : 'Activate', 'loyalty-toggle', { id: r.id, active: r.is_active ? '0' : '1' }, r.is_active ? 'btn-warning' : 'btn-success')}
          `)}</td>
        </tr>`).join(''),
        'No loyalty rules yet'
      ), '', true)}`;
    this._cache.loyalty = rows;
  },

  async loyaltyForm(existing) {
    const r = existing || {};
    const businesses = await this.businesses();
    this.openForm(r.id ? `Edit ${r.name}` : 'New loyalty rule', `
      ${this.grid([
        this.fld('mktp-l-name', 'Rule name *', { value: r.name || '' }),
        this.fld('mktp-l-type', 'Rule type', { value: r.rule_type || 'points', options: [['points', 'Points per spend'], ['visits', 'Visit stamps'], ['tier', 'Tiered']] }),
        this.fld('mktp-l-biz', 'Business', { value: r.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-l-ppc', 'Points per currency unit', { type: 'number', value: r.points_per_currency ?? 1, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-l-threshold', 'Reward threshold (points)', { type: 'number', value: r.reward_threshold ?? 0, attrs: 'min="0"' }),
        this.fld('mktp-l-bonus', 'Referral bonus points', { type: 'number', value: r.referral_bonus_points ?? 0, attrs: 'min="0"' }),
        this.fld('mktp-l-birthday', 'Birthday reward', { value: r.birthday_reward || '', placeholder: 'e.g. Free coffee' }),
        this.fld('mktp-l-active', 'Active', { type: 'checkbox', value: r.id ? r.is_active : 1 }),
        this.fld('mktp-l-desc', 'Reward description', { value: r.reward_description || '', rows: 2, full: true })
      ])}`, async () => {
      const name = this.val('mktp-l-name');
      if (!name) {
        this.toast('Rule name is required', 'error');
        return false;
      }
      const saved = await this.apiOk(API.mktpSaveLoyaltyRule({
        id: r.id || undefined,
        name,
        rule_type: this.val('mktp-l-type') || 'points',
        business_id: this.intVal('mktp-l-biz'),
        points_per_currency: this.numVal('mktp-l-ppc', 1),
        reward_threshold: this.numVal('mktp-l-threshold'),
        referral_bonus_points: this.numVal('mktp-l-bonus'),
        birthday_reward: this.val('mktp-l-birthday') || null,
        reward_description: this.val('mktp-l-desc') || null,
        is_active: this.chk('mktp-l-active') ? 1 : 0
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Loyalty rule saved', 'success');
      return true;
    }, 'Save rule');
  },

  /* ─── Agents ──────────────────────────────────────────────────────────── */

  AGENT_STATUSES: ['pending', 'active', 'suspended', 'inactive', 'rejected', 'terminated'],
  TIERS: ['standard', 'bronze', 'silver', 'gold', 'platinum'],

  async renderAgents(el) {
    const f = { ...(this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {}) };
    if (this.ui.agentStatus) f.status = this.ui.agentStatus;
    if (this.ui.agentSearch) f.search = this.ui.agentSearch;
    const rows = await this.list(API.mktpAgents(f, this.actor()), 'Could not load agents');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('Register agent', 'agent-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-agents')}
      `)}
      ${this.panel('Filter', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${this.fld('mktp-ag-status', 'Status', { value: this.ui.agentStatus || '', options: [['', 'All statuses'], ...this.AGENT_STATUSES.map((s) => [s, s])] })}
          ${this.fld('mktp-ag-q', 'Name, phone or code', { value: this.ui.agentSearch || '' })}
          ${this.btn('Apply', 'agent-filter', {}, 'btn-primary')}
          ${this.btn('Clear', 'agent-filter-clear')}
        </div>`)}
      ${this.panel(`${rows.length} agent(s)`, this.table(
        ['Agent', 'Contact', 'Referral code', 'Tier', 'Status', ''],
        rows.map((a) => `<tr>
          <td><strong>${this.esc(a.full_name)}</strong><br><small class="muted">${this.esc(a.agent_code || 'Not yet approved')}</small></td>
          <td>${this.esc(a.phone || '—')}<br><small class="muted">${this.esc(a.email || '')}</small></td>
          <td>${a.referral_code ? `<span class="mktp-code">${this.esc(a.referral_code)}</span>` : '—'}</td>
          <td>${this.esc(a.tier || 'standard')}</td>
          <td>${this.statusTag(a.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('View', 'agent-view', { id: a.id })}
            ${a.status === 'pending' ? this.btn('Approve', 'agent-approve', { id: a.id }, 'btn-success') : ''}
            ${a.status === 'active' ? this.btn('Suspend', 'agent-status', { id: a.id, status: 'suspended' }, 'btn-warning') : ''}
            ${a.status === 'active' ? this.btn(a.user_id ? 'Reset login' : 'Create login', 'agent-create-login', { id: a.id, name: a.full_name }) : ''}
            ${['suspended', 'inactive'].includes(a.status) ? this.btn('Reactivate', 'agent-status', { id: a.id, status: 'active' }, 'btn-success') : ''}
            ${!['terminated', 'rejected'].includes(a.status) ? this.btn('Terminate', 'agent-status', { id: a.id, status: 'terminated' }, 'btn-danger') : ''}
            ${this.btn('Link user', 'agent-link-user', { id: a.id, name: a.full_name })}
          `)}</td>
        </tr>`).join(''),
        'No agents match this filter'
      ), '', true)}`;
    this._cache.agents = rows;
  },

  async agentApplyForm() {
    const [businesses, branches] = await Promise.all([this.businesses(), this.branches()]);
    this.openForm('Register referral agent', `
      ${this.grid([
        this.fld('mktp-ag-name', 'Full name *', { value: '' }),
        this.fld('mktp-ag-phone', 'Phone *', { value: '' }),
        this.fld('mktp-ag-email', 'Email', { value: '' }),
        this.fld('mktp-ag-id', 'ID number', { value: '' }),
        this.fld('mktp-ag-biz', 'Business', { value: this.filters.businessId || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-ag-branch', 'Branch', { value: this.filters.branchId || '', options: this.branchOptions(branches) }),
        this.fld('mktp-ag-bank', 'Bank name', { value: '' }),
        this.fld('mktp-ag-acc', 'Account number', { value: '' }),
        this.fld('mktp-ag-addr', 'Address', { value: '', full: true }),
        this.fld('mktp-ag-agree', 'The agent has accepted the referral agreement', { type: 'checkbox', value: 0 })
      ])}
      <p class="muted">Creates a pending application. Approve it to issue the agent code, referral code, share link and QR payload.</p>`,
      async () => {
        const full_name = this.val('mktp-ag-name');
        const phone = this.val('mktp-ag-phone');
        if (!full_name || !phone) {
          this.toast('Full name and phone are required', 'error');
          return false;
        }
        if (!this.chk('mktp-ag-agree')) {
          this.toast('Agreement acceptance is required', 'error');
          return false;
        }
        const saved = await this.apiOk(API.mktpApplyAgent({
          full_name,
          phone,
          email: this.val('mktp-ag-email') || null,
          id_number: this.val('mktp-ag-id') || null,
          address: this.val('mktp-ag-addr') || null,
          business_id: this.intVal('mktp-ag-biz'),
          branch_id: this.intVal('mktp-ag-branch'),
          bank: { bank_name: this.val('mktp-ag-bank'), account_number: this.val('mktp-ag-acc') },
          agreement_accepted: 1
        }), 'Registration failed');
        if (!saved) return false;
        this.toast('Application created — approve it to activate', 'success');
        await this.refreshCounts();
        return true;
      }, 'Create application');
  },

  async agentViewModal(id) {
    const a = await this.apiOk(API.mktpGetAgent(parseInt(id, 10)), 'Could not load agent');
    if (!a) return;
    const w = a.wallet || {};
    this.openInfo(`${a.full_name} · ${a.agent_code || 'pending'}`, `
      <div class="mktp-kpis">
        ${this.kpi('Lifetime', this.money(w.lifetime), 'All earnings', 'accent')}
        ${this.kpi('Pending', this.money(w.pending), 'Awaiting approval', 'warn')}
        ${this.kpi('Payable', this.money(w.payable), 'Ready to pay', 'info')}
        ${this.kpi('Paid', this.money(w.paid), 'Settled', 'good')}
      </div>
      ${this.grid([
        this.fld('mktp-v-phone', 'Phone', { value: a.phone || '', attrs: 'readonly' }),
        this.fld('mktp-v-email', 'Email', { value: a.email || '', attrs: 'readonly' }),
        this.fld('mktp-v-code', 'Referral code', { value: a.referral_code || '', attrs: 'readonly' }),
        this.fld('mktp-v-link', 'Referral link', { value: a.referral_link || this.referralPageUrl(a.referral_code), attrs: 'readonly' }),
        this.fld('mktp-v-tier', 'Tier', { value: a.tier || 'standard', attrs: 'readonly' }),
        this.fld('mktp-v-status', 'Status', { value: a.status || '', attrs: 'readonly' })
      ])}
      ${this.panel('Contracts', this.table(['Title', 'Effective', 'Status'],
        (a.contracts || []).map((c) => `<tr>
          <td>${this.esc(c.title || '—')}</td>
          <td>${this.esc(c.effective_date || '—')}</td>
          <td>${this.statusTag(c.status)}</td>
        </tr>`).join(''), 'No contracts yet'), '', true)}
      ${this.panel('Status history', this.table(['When', 'From', 'To', 'Reason', 'By'],
        (a.status_history || []).map((h) => `<tr>
          <td>${this.esc(String(h.created_at || '').slice(0, 16))}</td>
          <td>${this.esc(h.from_status || '—')}</td>
          <td>${this.esc(h.to_status)}</td>
          <td>${this.esc(h.reason || '—')}</td>
          <td>${this.esc(h.actor_name || 'system')}</td>
        </tr>`).join(''), 'No status changes'), '', true)}`);
  },

  async agentApproveForm(id) {
    const [agent, businesses, branches, rules] = await Promise.all([
      this.apiOk(API.mktpGetAgent(parseInt(id, 10)), 'Could not load agent'),
      this.businesses(), this.branches(), this.commissionRuleList()
    ]);
    if (!agent) return;
    this.openForm(`Approve ${agent.full_name}`, `
      ${this.grid([
        this.fld('mktp-apv-tier', 'Tier', { value: agent.tier || 'standard', options: this.TIERS.map((t) => [t, t]) }),
        this.fld('mktp-apv-rule', 'Commission rule', { value: agent.commission_rule_id || '', options: [['', '— Default rule —'], ...rules.map((r) => [r.id, `${r.name} (${r.rule_type === 'fixed' ? this.money(r.fixed_amount) : `${r.percent_rate}%`})`])] }),
        this.fld('mktp-apv-biz', 'Business', { value: agent.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-apv-branch', 'Branch', { value: agent.branch_id || '', options: this.branchOptions(branches) }),
        this.fld('mktp-apv-reason', 'Approval note', { value: 'Approved', full: true })
      ])}
      <p class="muted">Approving issues the agent code, a unique referral code, share link, QR payload and a contract from the default template.</p>`,
      async () => {
        const saved = await this.apiOk(API.mktpApproveAgent(parseInt(id, 10), {
          tier: this.val('mktp-apv-tier') || 'standard',
          commission_rule_id: this.intVal('mktp-apv-rule'),
          business_id: this.intVal('mktp-apv-biz'),
          branch_id: this.intVal('mktp-apv-branch'),
          reason: this.val('mktp-apv-reason') || 'Approved'
        }, this.actor()), 'Approval failed');
        if (!saved) return false;
        if (saved.temp_username && saved.temp_password) {
          this.toast(`Approved. Portal login: ${saved.temp_username} / ${saved.temp_password}`, 'success');
          Utils.showModal?.('Agent portal login', `
            <p>Share these credentials with the agent (shown once):</p>
            <div class="field"><label>Username</label><input readonly value="${this.esc(saved.temp_username)}"></div>
            <div class="field"><label>Temporary password</label><input readonly value="${this.esc(saved.temp_password)}"></div>
            <p class="muted">They sign in on the main app Welcome screen → Register as Referral Agent / Marketing Agent mode, or use username/password on the marketing agent portal.</p>`,
            '<button type="button" class="btn btn-primary" id="mktp-login-done">Done</button>');
          document.getElementById('mktp-login-done')?.addEventListener('click', () => Utils.hideModal());
        } else {
          this.toast(`Approved — referral code ${saved.referral_code || ''}`, 'success');
        }
        await this.refreshCounts();
        return true;
      }, 'Approve agent');
  },

  async agentStatusForm(id, status) {
    const labels = { suspended: 'Suspend agent', terminated: 'Terminate agent', active: 'Reactivate agent', rejected: 'Reject application', inactive: 'Deactivate agent' };
    this.openForm(labels[status] || 'Update agent status', `
      ${this.grid([
        this.fld('mktp-as-reason', 'Reason', { value: '', rows: 3, full: true, placeholder: 'Shared with the agent in their notifications' })
      ])}
      ${status === 'terminated' ? '<p class="muted">Termination revokes the agent QR codes and closes active contracts. Earned commissions are preserved.</p>' : ''}`,
      async () => {
        const saved = await this.apiOk(API.mktpSetAgentStatus(parseInt(id, 10), status, this.val('mktp-as-reason') || null, this.actor()), 'Update failed');
        if (!saved) return false;
        this.toast(`Agent ${status}`, 'success');
        await this.refreshCounts();
        return true;
      }, 'Confirm');
  },

  async agentLinkUserForm(agentId, agentName) {
    const users = await this.list(API.getUsers(this.actor()), 'Could not load users');
    this.openForm(`Link a login to ${agentName || 'agent'}`, `
      ${this.grid([
        this.fld('mktp-lu-user', 'POS user account', {
          value: '',
          options: [['', '— Select user —'], ...users.map((u) => [u.id, `${u.full_name || u.username} (${u.role})`])],
          full: true
        })
      ])}
      <p class="muted">The linked user can sign in to the Referral Agent app and see only their own wallet, referrals and contracts.</p>`,
      async () => {
        const userId = this.intVal('mktp-lu-user');
        if (!userId) {
          this.toast('Select a user account', 'error');
          return false;
        }
        const saved = await this.apiOk(API.mktpLinkAgentUser(parseInt(agentId, 10), userId, this.actor()), 'Link failed');
        if (!saved) return false;
        this.toast('Login linked to agent', 'success');
        return true;
      }, 'Link login');
  },

  /* ─── Applications ────────────────────────────────────────────────────── */

  async renderApplications(el) {
    const rows = await this.list(API.mktpAgents({ status: 'pending' }, this.actor()), 'Could not load applications');
    this.counts.applications = rows.length;
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('Register agent', 'agent-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-applications')}
      `)}
      ${rows.length ? '' : '<div class="mktp-note">No applications waiting. New applications arrive from the Referral Agent app and appear here for approval.</div>'}
      ${this.panel(`${rows.length} pending application(s)`, this.table(
        ['Applicant', 'Contact', 'ID number', 'Bank', 'Applied', ''],
        rows.map((a) => `<tr>
          <td><strong>${this.esc(a.full_name)}</strong>${a.address ? `<br><small class="muted mktp-truncate">${this.esc(a.address)}</small>` : ''}</td>
          <td>${this.esc(a.phone || '—')}<br><small class="muted">${this.esc(a.email || '')}</small></td>
          <td>${this.esc(a.id_number || '—')}</td>
          <td><small class="muted">${this.esc(a.bank?.bank_name || '—')}${a.bank?.account_number ? `<br>${this.esc(a.bank.account_number)}` : ''}</small></td>
          <td>${this.esc(a.application_date || String(a.created_at || '').slice(0, 10))}</td>
          <td>${this.rowBtns(`
            ${this.btn('Approve', 'agent-approve', { id: a.id }, 'btn-success')}
            ${this.btn('Reject', 'agent-status', { id: a.id, status: 'rejected' }, 'btn-danger')}
            ${this.btn('View', 'agent-view', { id: a.id })}
          `)}</td>
        </tr>`).join(''),
        'No pending applications'
      ), '', true)}`;
    this._cache.applications = rows;
    const nav = document.getElementById('mktp-nav');
    if (nav) nav.innerHTML = this.navHtml();
  },

  /* ─── Contracts ───────────────────────────────────────────────────────── */

  CONTRACT_STATUSES: ['draft', 'awaiting_acceptance', 'accepted', 'active', 'expired', 'terminated'],

  async renderContracts(el) {
    const [contracts, templates] = await Promise.all([
      this.list(API.mktpContracts({}, this.actor()), 'Could not load contracts'),
      this.list(API.mktpContractTemplates({}, this.actor()), 'Could not load templates')
    ]);
    this._cache.templates = templates;
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('Issue contract', 'contract-new', {}, 'btn-primary')}
        ${this.btn('New template', 'template-new')}
        ${this.btn('Export CSV', 'export-contracts')}
      `)}
      ${this.panel('Agent contracts', this.table(
        ['Agent', 'Contract', 'Effective', 'Accepted', 'Status', ''],
        contracts.map((c) => `<tr>
          <td>${this.esc(c.agent_name || `#${c.agent_id}`)}</td>
          <td>${this.esc(c.title || '—')}<br><small class="muted">${this.esc(c.commission_summary || '')}</small></td>
          <td>${this.esc(c.effective_date || '—')}</td>
          <td>${this.esc(String(c.accepted_at || '').slice(0, 16) || '—')}</td>
          <td>${this.statusTag(c.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('View', 'contract-view', { id: c.id })}
            ${this.btn('Status…', 'contract-status', { id: c.id, current: c.status })}
          `)}</td>
        </tr>`).join(''),
        'No contracts issued yet'
      ), '', true)}
      ${this.panel('Templates', this.table(
        ['Template', 'Type', 'Status', ''],
        templates.map((t) => `<tr>
          <td><strong>${this.esc(t.name)}</strong></td>
          <td>${this.esc(t.template_type || 'general')}</td>
          <td>${this.statusTag(t.is_active ? 'active' : 'inactive')}</td>
          <td>${this.rowBtns(`
            ${this.btn('Edit', 'template-edit', { id: t.id })}
            ${this.btn('Issue to agent', 'contract-new', { template: t.id })}
          `)}</td>
        </tr>`).join(''),
        'No templates yet — create one so approvals can auto-issue contracts'
      ), '', true)}`;
    this._cache.contracts = contracts;
  },

  async templateForm(existing) {
    const t = existing || {};
    const businesses = await this.businesses();
    this.openForm(t.id ? `Edit ${t.name}` : 'New contract template', `
      ${this.grid([
        this.fld('mktp-t-name', 'Template name *', { value: t.name || '' }),
        this.fld('mktp-t-type', 'Template type', { value: t.template_type || 'general', options: [['general', 'General'], ['exclusive', 'Exclusive'], ['seasonal', 'Seasonal'], ['corporate', 'Corporate']] }),
        this.fld('mktp-t-biz', 'Business', { value: t.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-t-active', 'Active', { type: 'checkbox', value: t.id ? t.is_active : 1 }),
        this.fld('mktp-t-body', 'Contract body (HTML)', { value: t.body_html || '', rows: 10, full: true })
      ])}
      <p class="muted">Placeholders: <span class="mktp-code">{{agent_name}}</span> <span class="mktp-code">{{agent_code}}</span> <span class="mktp-code">{{referral_code}}</span> <span class="mktp-code">{{commission_summary}}</span> <span class="mktp-code">{{effective_date}}</span> <span class="mktp-code">{{business_name}}</span></p>`,
      async () => {
        const name = this.val('mktp-t-name');
        if (!name) {
          this.toast('Template name is required', 'error');
          return false;
        }
        const saved = await this.apiOk(API.mktpSaveContractTemplate({
          id: t.id || undefined,
          name,
          template_type: this.val('mktp-t-type') || 'general',
          business_id: this.intVal('mktp-t-biz'),
          body_html: this.val('mktp-t-body'),
          is_active: this.chk('mktp-t-active') ? 1 : 0
        }, this.actor()), 'Save failed');
        if (!saved) return false;
        this.toast('Template saved', 'success');
        return true;
      }, 'Save template');
  },

  async contractIssueForm(templateId) {
    const [agents, templates] = await Promise.all([this.agentList(), this.list(API.mktpContractTemplates({}, this.actor()), 'Could not load templates')]);
    this.openForm('Issue contract to agent', `
      ${this.grid([
        this.fld('mktp-ci-agent', 'Agent *', { value: '', options: this.agentOptions(agents) }),
        this.fld('mktp-ci-tpl', 'Template *', { value: templateId || '', options: [['', '— Select template —'], ...templates.map((t) => [t.id, t.name])] })
      ])}
      <p class="muted">The agent is notified and can accept the agreement from the Referral Agent app.</p>`,
      async () => {
        const agentId = this.intVal('mktp-ci-agent');
        const tplId = this.intVal('mktp-ci-tpl');
        if (!agentId || !tplId) {
          this.toast('Select both an agent and a template', 'error');
          return false;
        }
        const saved = await this.apiOk(API.mktpCreateContract(agentId, tplId, this.actor()), 'Could not issue contract');
        if (!saved) return false;
        this.toast('Contract issued', 'success');
        return true;
      }, 'Issue contract');
  },

  async contractViewModal(id) {
    const contracts = this._cache.contracts || await this.list(API.mktpContracts({}, this.actor()), 'Could not load contracts');
    const c = contracts.find((x) => String(x.id) === String(id));
    if (!c) {
      this.toast('Contract not found', 'error');
      return;
    }
    this.openInfo(`${c.title || 'Contract'} — ${c.agent_name || ''}`, `
      <p class="muted">Status ${this.esc(c.status)} · effective ${this.esc(c.effective_date || '—')}${c.accepted_at ? ` · accepted ${this.esc(String(c.accepted_at).slice(0, 16))}` : ''}</p>
      <div style="border:1px solid var(--mktp-line,#e2e8f0);border-radius:10px;padding:14px;max-height:50vh;overflow:auto">
        ${c.body_html || '<p class="muted">This contract has no body.</p>'}
      </div>`);
  },

  async contractStatusForm(id, current) {
    this.openForm('Update contract status', `
      ${this.grid([
        this.fld('mktp-cs-status', 'Status', { value: current || 'draft', options: this.CONTRACT_STATUSES.map((s) => [s, s]), full: true })
      ])}`, async () => {
      const saved = await this.apiOk(API.mktpSetContractStatus(parseInt(id, 10), this.val('mktp-cs-status'), this.actor()), 'Update failed');
      if (!saved) return false;
      this.toast('Contract updated', 'success');
      return true;
    }, 'Update');
  },

  /* ─── Referral codes ──────────────────────────────────────────────────── */

  async renderReferralCodes(el) {
    const rows = (await this.list(API.mktpAgents(this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {}, this.actor()), 'Could not load agents'))
      .filter((a) => a.referral_code);
    el.innerHTML = `
      ${this.sectionHead(this.btn('Export CSV', 'export-codes'))}
      <div class="mktp-note">Every active agent has a unique code, a share link and a QR payload. Sales tagged with a code earn that agent commission automatically.</div>
      ${this.panel('', this.table(
        ['Agent', 'Code', 'Share link', 'QR payload', 'Status', ''],
        rows.map((a) => `<tr>
          <td>${this.esc(a.full_name)}<br><small class="muted">${this.esc(a.agent_code || '')}</small></td>
          <td><span class="mktp-code">${this.esc(a.referral_code)}</span></td>
          <td><div class="mktp-truncate"><span class="mktp-code">${this.esc(a.referral_link || '—')}</span></div></td>
          <td><div class="mktp-truncate"><small class="muted">${this.esc(a.qr_payload || '—')}</small></div></td>
          <td>${this.statusTag(a.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('Copy code', 'copy-text', { text: a.referral_code })}
            ${a.referral_code ? this.btn('Open page', 'open-referral', { code: a.referral_code, link: a.referral_link || '' }) : ''}
            ${a.referral_link ? this.btn('Copy link', 'copy-text', { text: a.referral_link }) : ''}
            ${a.qr_payload ? this.btn('Copy QR payload', 'copy-text', { text: a.qr_payload }) : ''}
          `)}</td>
        </tr>`).join(''),
        'No referral codes issued yet — approve an agent to issue one'
      ), '', true)}`;
    this._cache.codes = rows;
  },

  /* ─── QR codes ────────────────────────────────────────────────────────── */

  QR_ENTITIES: ['campaign', 'agent', 'branch', 'menu', 'promotion', 'custom'],

  async renderQrCodes(el) {
    const f = { ...(this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {}) };
    if (this.ui.qrType) f.entity_type = this.ui.qrType;
    const rows = await this.list(API.mktpQrCodes(f, this.actor()), 'Could not load QR codes');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New QR code', 'qr-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-qr')}
      `)}
      ${this.panel('Filter', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${this.fld('mktp-qr-type', 'Entity type', { value: this.ui.qrType || '', options: [['', 'All types'], ...this.QR_ENTITIES.map((t) => [t, t])] })}
          ${this.btn('Apply', 'qr-filter', {}, 'btn-primary')}
          ${this.btn('Clear', 'qr-filter-clear')}
        </div>`)}
      ${this.panel(`${rows.length} QR code(s)`, this.table(
        ['Label', 'Type', 'Payload', 'Scans', 'Status', ''],
        rows.map((q) => `<tr>
          <td><strong>${this.esc(q.label || '—')}</strong>${q.entity_id ? `<br><small class="muted">#${this.esc(q.entity_id)}</small>` : ''}</td>
          <td>${this.tag(q.entity_type, 'info')}</td>
          <td><div class="mktp-truncate"><small class="muted">${this.esc(q.payload || '')}</small></div></td>
          <td>${this.esc(q.scan_count || 0)}</td>
          <td>${this.statusTag(q.is_active ? 'active' : 'inactive')}</td>
          <td>${this.rowBtns(`
            ${this.btn('Show QR', 'qr-show', { id: q.id })}
            ${this.btn('Copy payload', 'copy-text', { text: q.payload || '' })}
          `)}</td>
        </tr>`).join(''),
        'No QR codes yet'
      ), '', true)}`;
    this._cache.qrCodes = rows;
  },

  async qrForm() {
    const [businesses, branches] = await Promise.all([this.businesses(), this.branches()]);
    this.openForm('New QR code', `
      ${this.grid([
        this.fld('mktp-q-label', 'Label *', { value: '', placeholder: 'e.g. Front counter — Winter Special' }),
        this.fld('mktp-q-type', 'Entity type', { value: 'campaign', options: this.QR_ENTITIES.map((t) => [t, t]) }),
        this.fld('mktp-q-entity', 'Entity ID', { type: 'number', value: '', attrs: 'min="1"', placeholder: 'Optional' }),
        this.fld('mktp-q-biz', 'Business', { value: this.filters.businessId || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-q-branch', 'Branch', { value: this.filters.branchId || '', options: this.branchOptions(branches) }),
        this.fld('mktp-q-payload', 'Payload *', { value: '', rows: 3, full: true, placeholder: 'URL or JSON, e.g. https://example.com/promo' })
      ])}`, async () => {
      const label = this.val('mktp-q-label');
      const payload = this.val('mktp-q-payload');
      if (!label || !payload) {
        this.toast('Label and payload are required', 'error');
        return false;
      }
      const saved = await this.apiOk(API.mktpCreateQr({
        label,
        payload,
        entity_type: this.val('mktp-q-type') || 'custom',
        entity_id: this.intVal('mktp-q-entity'),
        business_id: this.intVal('mktp-q-biz'),
        branch_id: this.intVal('mktp-q-branch')
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('QR code created', 'success');
      return true;
    }, 'Create QR code');
  },

  qrShowModal(id) {
    const q = (this._cache.qrCodes || []).find((x) => String(x.id) === String(id));
    if (!q) {
      this.toast('QR code not found', 'error');
      return;
    }
    const src = `https://api.qrserver.com/v1/create-qr-code/?size=264x264&data=${encodeURIComponent(q.payload || '')}`;
    this.openInfo(q.label || 'QR code', `
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <img src="${src}" alt="QR code" class="mktp-qr-img" style="width:200px;height:200px"
          onerror="this.style.display='none';this.nextElementSibling.classList.remove('hidden')">
        <div class="hidden mktp-note">QR image needs an internet connection. Print the payload below instead, or generate the code from the receipt printer.</div>
        <div style="flex:1;min-width:200px">
          <p class="muted">Type ${this.esc(q.entity_type)}${q.entity_id ? ` · entity #${this.esc(q.entity_id)}` : ''} · ${this.esc(q.scan_count || 0)} scan(s)</p>
          <p><strong>Payload</strong></p>
          <p><span class="mktp-code">${this.esc(q.payload || '')}</span></p>
          ${this.btn('Copy payload', 'copy-text', { text: q.payload || '' }, 'btn-primary')}
        </div>
      </div>`);
  },

  /* ─── Commissions ─────────────────────────────────────────────────────── */

  COMMISSION_STATUSES: ['pending', 'approved', 'payable', 'paid', 'reversed', 'cancelled', 'refunded', 'disputed'],

  async renderCommissions(el) {
    const f = { ...this.filterScope() };
    delete f.branch_id;
    if (this.ui.commissionStatus) f.status = this.ui.commissionStatus;
    if (this.ui.commissionAgent) f.agent_id = parseInt(this.ui.commissionAgent, 10);
    const [rows, agents, rules] = await Promise.all([
      this.list(API.mktpCommissions(f, this.actor()), 'Could not load commissions'),
      this.agentList(),
      this.commissionRuleList()
    ]);
    const sum = (st) => rows.filter((r) => (Array.isArray(st) ? st.includes(r.status) : r.status === st))
      .reduce((s, r) => s + (Number(r.commission_amount) || 0), 0);

    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New commission rule', 'rule-new', {}, 'btn-primary')}
        ${this.btn('Approve all pending', 'commission-approve-all')}
        ${this.btn('Export CSV', 'export-commissions')}
      `)}
      <div class="mktp-kpis">
        ${this.kpi('Pending', this.money(sum('pending')), `${rows.filter((r) => r.status === 'pending').length} rows`, 'warn')}
        ${this.kpi('Approved', this.money(sum('approved')), 'Awaiting payable', 'info')}
        ${this.kpi('Payable', this.money(sum('payable')), 'Ready to pay', 'accent')}
        ${this.kpi('Paid', this.money(sum('paid')), 'Settled', 'good')}
        ${this.kpi('Reversed', this.money(sum(['reversed', 'cancelled', 'refunded'])), 'Clawed back', 'bad')}
      </div>
      ${this.panel('Filter', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${this.fld('mktp-cm-status', 'Status', { value: this.ui.commissionStatus || '', options: [['', 'All statuses'], ...this.COMMISSION_STATUSES.map((s) => [s, s])] })}
          ${this.fld('mktp-cm-agent', 'Agent', { value: this.ui.commissionAgent || '', options: [['', 'All agents'], ...agents.map((a) => [a.id, a.full_name])] })}
          ${this.btn('Apply', 'commission-filter', {}, 'btn-primary')}
          ${this.btn('Clear', 'commission-filter-clear')}
        </div>`)}
      ${this.panel(`${rows.length} commission row(s)`, this.table(
        ['Agent', 'Sale', 'Rate', 'Commission', 'Created', 'Status', 'Workflow'],
        rows.map((c) => `<tr>
          <td>${this.esc(c.agent_name || `#${c.agent_id}`)}<br><small class="muted">${this.esc(c.referral_code || '')}</small></td>
          <td>${this.money(c.sale_amount)}<br><small class="muted">${c.sale_id ? `sale #${this.esc(c.sale_id)}` : ''}${c.campaign_id ? ` · campaign #${this.esc(c.campaign_id)}` : ''}</small></td>
          <td>${c.rate ? `${this.esc(c.rate)}%` : 'fixed'}</td>
          <td><strong>${this.money(c.commission_amount)}</strong></td>
          <td>${this.esc(String(c.created_at || '').slice(0, 16))}</td>
          <td>${this.statusTag(c.status)}</td>
          <td>${this.rowBtns(`
            ${c.status === 'pending' ? this.btn('Approve', 'commission-status', { id: c.id, status: 'approved' }, 'btn-success') : ''}
            ${c.status === 'approved' ? this.btn('Make payable', 'commission-status', { id: c.id, status: 'payable' }, 'btn-primary') : ''}
            ${['approved', 'payable'].includes(c.status) ? this.btn('Mark paid', 'commission-status', { id: c.id, status: 'paid' }, 'btn-success') : ''}
            ${!['reversed', 'paid'].includes(c.status) ? this.btn('Reverse', 'commission-status', { id: c.id, status: 'reversed' }, 'btn-danger') : ''}
            ${c.status !== 'disputed' ? this.btn('Dispute', 'commission-status', { id: c.id, status: 'disputed' }, 'btn-warning') : ''}
          `)}</td>
        </tr>`).join(''),
        'No commissions in this period — they are created automatically when a referral-tagged sale completes'
      ), '', true)}
      ${this.panel('Commission rules', this.table(
        ['Rule', 'Type', 'Value', 'Tier', 'Default', 'Status', ''],
        rules.map((r) => `<tr>
          <td><strong>${this.esc(r.name)}</strong></td>
          <td>${this.esc(r.rule_type)}</td>
          <td>${r.rule_type === 'fixed' ? this.money(r.fixed_amount) : `${this.esc(r.percent_rate)}%`}</td>
          <td>${this.esc(r.agent_tier || 'any')}</td>
          <td>${r.is_default ? this.tag('Default', 'ok') : '—'}</td>
          <td>${this.statusTag(r.is_active ? 'active' : 'inactive')}</td>
          <td>${this.btn('Edit', 'rule-edit', { id: r.id })}</td>
        </tr>`).join(''),
        'No commission rules — the platform default percentage applies'
      ), '', true)}`;
    this._cache.commissions = rows;
  },

  async commissionRuleForm(existing) {
    const r = existing || {};
    const businesses = await this.businesses();
    this.openForm(r.id ? `Edit ${r.name}` : 'New commission rule', `
      ${this.grid([
        this.fld('mktp-r-name', 'Rule name *', { value: r.name || '' }),
        this.fld('mktp-r-type', 'Rule type', { value: r.rule_type || 'percent', options: [['percent', 'Percentage of sale'], ['fixed', 'Fixed amount per sale']] }),
        this.fld('mktp-r-percent', 'Percentage rate', { type: 'number', value: r.percent_rate ?? 5, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-r-fixed', 'Fixed amount', { type: 'number', value: r.fixed_amount ?? 0, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-r-biz', 'Business', { value: r.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-r-tier', 'Applies to tier', { value: r.agent_tier || '', options: [['', 'Any tier'], ...this.TIERS.map((t) => [t, t])] }),
        this.fld('mktp-r-default', 'Use as default rule', { type: 'checkbox', value: r.is_default }),
        this.fld('mktp-r-active', 'Active', { type: 'checkbox', value: r.id ? r.is_active : 1 })
      ])}`, async () => {
      const name = this.val('mktp-r-name');
      if (!name) {
        this.toast('Rule name is required', 'error');
        return false;
      }
      const saved = await this.apiOk(API.mktpSaveCommissionRule({
        id: r.id || undefined,
        name,
        rule_type: this.val('mktp-r-type') || 'percent',
        percent_rate: this.numVal('mktp-r-percent'),
        fixed_amount: this.numVal('mktp-r-fixed'),
        business_id: this.intVal('mktp-r-biz'),
        agent_tier: this.val('mktp-r-tier') || null,
        is_default: this.chk('mktp-r-default') ? 1 : 0,
        is_active: this.chk('mktp-r-active') ? 1 : 0
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Commission rule saved', 'success');
      return true;
    }, 'Save rule');
  },

  /* ─── Payments ────────────────────────────────────────────────────────── */

  PAYMENT_METHODS: ['eft', 'cash', 'wallet', 'airtime', 'voucher'],

  async renderPayments(el) {
    const f = {};
    if (this.ui.paymentAgent) f.agent_id = parseInt(this.ui.paymentAgent, 10);
    const [rows, agents] = await Promise.all([
      this.list(API.mktpPayments(f, this.actor()), 'Could not load payments'),
      this.agentList()
    ]);
    const total = rows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('Record payment', 'payment-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-payments')}
      `)}
      <div class="mktp-kpis">
        ${this.kpi('Payments recorded', rows.length, 'All time', 'accent')}
        ${this.kpi('Total paid', this.money(total), 'Across all agents', 'good')}
        ${this.kpi('Agents', agents.filter((a) => a.status === 'active').length, 'Active on the platform')}
      </div>
      ${this.panel('Filter', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${this.fld('mktp-pm-agent', 'Agent', { value: this.ui.paymentAgent || '', options: [['', 'All agents'], ...agents.map((a) => [a.id, a.full_name])] })}
          ${this.btn('Apply', 'payment-filter', {}, 'btn-primary')}
          ${this.btn('Clear', 'payment-filter-clear')}
        </div>`)}
      ${this.panel('', this.table(
        ['Agent', 'Amount', 'Date', 'Method', 'Reference', 'Status', 'Recorded by'],
        rows.map((p) => `<tr>
          <td>${this.esc(p.agent_name || `#${p.agent_id}`)}<br><small class="muted">${this.esc(p.agent_code || '')}</small></td>
          <td><strong>${this.money(p.amount)}</strong></td>
          <td>${this.esc(p.payment_date || '—')}</td>
          <td>${this.esc(p.payment_method || '—')}</td>
          <td>${this.esc(p.reference || '—')}${p.notes ? `<br><small class="muted mktp-truncate">${this.esc(p.notes)}</small>` : ''}</td>
          <td>${this.statusTag(p.status)}</td>
          <td><small class="muted">${this.esc(p.admin_name || '')}</small></td>
        </tr>`).join(''),
        'No payments recorded yet'
      ), '', true)}`;
    this._cache.payments = rows;
  },

  async paymentForm() {
    const agents = await this.agentList();
    const active = agents.filter((a) => ['active', 'suspended'].includes(a.status));
    this.openForm('Record agent payment', `
      ${this.grid([
        this.fld('mktp-pay-agent', 'Agent *', { value: '', options: this.agentOptions(active) }),
        this.fld('mktp-pay-amount', 'Amount *', { type: 'number', value: '', attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-pay-date', 'Payment date', { type: 'date', value: this.today() }),
        this.fld('mktp-pay-method', 'Method', { value: 'eft', options: this.PAYMENT_METHODS.map((m) => [m, m]) }),
        this.fld('mktp-pay-ref', 'Reference', { value: '', placeholder: 'Bank reference or receipt' }),
        this.fld('mktp-pay-status', 'Status', { value: 'paid', options: [['paid', 'paid'], ['pending', 'pending'], ['failed', 'failed']] }),
        this.fld('mktp-pay-notes', 'Notes', { value: '', rows: 2, full: true })
      ])}
      <div class="mktp-note">Recording a paid payment automatically settles the agent's oldest approved and payable commissions up to this amount.</div>`,
      async () => {
        const agentId = this.intVal('mktp-pay-agent');
        const amount = this.numVal('mktp-pay-amount');
        if (!agentId || amount <= 0) {
          this.toast('Select an agent and enter a positive amount', 'error');
          return false;
        }
        const saved = await this.apiOk(API.mktpSavePayment({
          agent_id: agentId,
          amount,
          payment_date: this.val('mktp-pay-date') || this.today(),
          payment_method: this.val('mktp-pay-method') || 'eft',
          reference: this.val('mktp-pay-ref') || null,
          status: this.val('mktp-pay-status') || 'paid',
          notes: this.val('mktp-pay-notes') || null
        }, this.actor()), 'Payment failed');
        if (!saved) return false;
        this.toast('Payment recorded', 'success');
        return true;
      }, 'Record payment');
  },

  /* ─── Performance ─────────────────────────────────────────────────────── */

  async renderPerformance(el) {
    const [lb, incentives] = await Promise.all([
      this.apiOk(API.mktpLeaderboard({ ...this.filterScope(), limit: 50 }, this.actor()), 'Could not load leaderboard'),
      this.list(API.mktpIncentives({}, this.actor()), 'Could not load incentives')
    ]);
    const board = lb?.rows || [];
    const totals = lb?.totals || {};
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New incentive', 'incentive-new', {}, 'btn-primary')}
        ${this.btn('Export CSV', 'export-leaderboard')}
      `)}
      <div class="mktp-kpis">
        ${this.kpi('Agents ranked', totals.agents || board.length, 'With activity in range', 'accent')}
        ${this.kpi('Sales', this.money(totals.revenue), `${totals.orders || 0} orders`, 'good')}
        ${this.kpi('Commission', this.money(totals.commission), 'Earned in range', 'slate')}
        ${this.kpi('Referrals', totals.referrals || 0, `${totals.conversion_rate || 0}% converted`)}
        ${this.kpi('Link clicks', totals.clicks || 0, 'Across all agents')}
        ${this.kpi('Average order', this.money(totals.average_order_value), 'Attributed sales')}
      </div>
      ${this.panel('Sales by agent', this.chart(board.slice(0, 12), (r) => String(r.full_name || '').split(' ')[0], (r) => r.revenue))}
      ${this.panel(`Leaderboard · ${this.filters.from} to ${this.filters.to}`, this.table(
        ['#', 'Agent', 'Tier', 'Clicks', 'Referrals', 'Sales', 'Commission', 'Status'],
        board.map((a, i) => `<tr>
          <td><span class="mktp-lb-rank ${i < 3 ? 'top' : ''}">${this.esc(a.rank || i + 1)}</span></td>
          <td><strong>${this.esc(a.full_name)}</strong><br><small class="muted">${this.esc(a.referral_code || a.agent_code || '')}</small></td>
          <td>${this.esc(a.tier || 'standard')}</td>
          <td>${this.esc(a.clicks || 0)}</td>
          <td>${this.esc(a.referrals || 0)}<br><small class="muted">${this.esc(a.conversions || 0)} converted</small></td>
          <td>${this.money(a.revenue)}<br><small class="muted">${this.esc(a.orders || 0)} orders</small></td>
          <td>${this.money(a.commission)}</td>
          <td>${this.statusTag(a.status)}</td>
        </tr>`).join(''),
        'No agent activity in this period'
      ), '', true)}
      ${this.panel('Incentive programmes', this.table(
        ['Incentive', 'Bonus', 'Window', 'Status', ''],
        incentives.map((i) => `<tr>
          <td><strong>${this.esc(i.name)}</strong><br><small class="muted">${this.esc(Object.entries(i.rules || {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</small></td>
          <td>${this.money(i.bonus_amount)}</td>
          <td>${this.esc(i.start_date || '—')} to ${this.esc(i.end_date || '—')}</td>
          <td>${this.statusTag(i.status)}</td>
          <td>${this.btn('Edit', 'incentive-edit', { id: i.id })}</td>
        </tr>`).join(''),
        'No incentives yet — reward agents for hitting targets'
      ), '', true)}`;
    this._cache.leaderboard = board;
    this._cache.incentives = incentives;
  },

  async incentiveForm(existing) {
    const i = existing || {};
    const rules = i.rules || {};
    const businesses = await this.businesses();
    this.openForm(i.id ? `Edit ${i.name}` : 'New incentive', `
      ${this.grid([
        this.fld('mktp-in-name', 'Incentive name *', { value: i.name || '' }),
        this.fld('mktp-in-bonus', 'Bonus amount', { type: 'number', value: i.bonus_amount ?? 0, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-in-biz', 'Business', { value: i.business_id || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-in-status', 'Status', { value: i.status || 'active', options: [['active', 'active'], ['paused', 'paused'], ['ended', 'ended']] }),
        this.fld('mktp-in-start', 'Start date', { type: 'date', value: i.start_date || this.today() }),
        this.fld('mktp-in-end', 'End date', { type: 'date', value: i.end_date || '' }),
        this.fld('mktp-in-sales', 'Target sales value', { type: 'number', value: rules.target_sales ?? '', attrs: 'step="0.01" min="0"', placeholder: 'Optional' }),
        this.fld('mktp-in-refs', 'Target referrals', { type: 'number', value: rules.target_referrals ?? '', attrs: 'min="0"', placeholder: 'Optional' })
      ])}`, async () => {
      const name = this.val('mktp-in-name');
      if (!name) {
        this.toast('Incentive name is required', 'error');
        return false;
      }
      const newRules = {};
      if (this.val('mktp-in-sales')) newRules.target_sales = this.numVal('mktp-in-sales');
      if (this.val('mktp-in-refs')) newRules.target_referrals = this.numVal('mktp-in-refs');
      const saved = await this.apiOk(API.mktpSaveIncentive({
        id: i.id || undefined,
        name,
        bonus_amount: this.numVal('mktp-in-bonus'),
        business_id: this.intVal('mktp-in-biz'),
        status: this.val('mktp-in-status') || 'active',
        start_date: this.val('mktp-in-start') || null,
        end_date: this.val('mktp-in-end') || null,
        rules: newRules
      }, this.actor()), 'Save failed');
      if (!saved) return false;
      this.toast('Incentive saved', 'success');
      return true;
    }, 'Save incentive');
  },

  /* ─── Coupons ─────────────────────────────────────────────────────────── */

  async renderCoupons(el) {
    const f = {};
    if (this.ui.couponStatus) f.status = this.ui.couponStatus;
    if (this.ui.couponSearch) f.search = this.ui.couponSearch;
    const rows = await this.list(API.mktpCoupons(f, this.actor()), 'Could not load coupons');
    el.innerHTML = `
      ${this.sectionHead(`
        ${this.btn('New coupon', 'coupon-new', {}, 'btn-primary')}
        ${this.btn('Redeem coupon', 'coupon-redeem')}
        ${this.btn('Export CSV', 'export-coupons')}
      `)}
      ${this.panel('Filter', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${this.fld('mktp-cp-status', 'Status', { value: this.ui.couponStatus || '', options: [['', 'All statuses'], ...['generated', 'issued', 'redeemed', 'expired', 'cancelled'].map((s) => [s, s])] })}
          ${this.fld('mktp-cp-q', 'Code contains', { value: this.ui.couponSearch || '' })}
          ${this.btn('Apply', 'coupon-filter', {}, 'btn-primary')}
          ${this.btn('Clear', 'coupon-filter-clear')}
        </div>`)}
      ${this.panel(`${rows.length} coupon(s)`, this.table(
        ['Code', 'Discount', 'Uses', 'Valid', 'Links', 'Status', ''],
        rows.map((c) => `<tr>
          <td><span class="mktp-code">${this.esc(c.code)}</span></td>
          <td>${c.discount_type === 'percent' ? `${this.esc(c.discount_value)}%` : this.money(c.discount_value)}</td>
          <td>${this.esc(c.used_count || 0)} / ${this.esc(c.max_uses || 1)}</td>
          <td>${this.esc(c.starts_at || '—')}<br><small class="muted">to ${this.esc(c.expires_at || '—')}</small></td>
          <td><small class="muted">
            ${c.campaign_id ? `Campaign #${this.esc(c.campaign_id)}<br>` : ''}
            ${c.agent_id ? `Agent #${this.esc(c.agent_id)}<br>` : ''}
            ${c.promotion_id ? `Promotion #${this.esc(c.promotion_id)}` : ''}
          </small></td>
          <td>${this.statusTag(c.status)}</td>
          <td>${this.rowBtns(`
            ${this.btn('Copy', 'copy-text', { text: c.code })}
            ${!['redeemed', 'expired', 'cancelled'].includes(c.status) ? this.btn('Redeem', 'coupon-redeem', { code: c.code }, 'btn-success') : ''}
          `)}</td>
        </tr>`).join(''),
        'No coupons yet — create one or generate assets from a campaign'
      ), '', true)}`;
    this._cache.coupons = rows;
  },

  async couponForm() {
    const [businesses, branches, campaigns, promotions, agents] = await Promise.all([
      this.businesses(), this.branches(), this.campaignList(), this.promotionList(), this.agentList()
    ]);
    this.openForm('New coupon', `
      ${this.grid([
        this.fld('mktp-cn-code', 'Code', { value: '', placeholder: 'Blank = auto-generate' }),
        this.fld('mktp-cn-type', 'Discount type', { value: 'percent', options: [['percent', 'Percentage'], ['fixed', 'Fixed amount']] }),
        this.fld('mktp-cn-value', 'Discount value *', { type: 'number', value: 10, attrs: 'step="0.01" min="0"' }),
        this.fld('mktp-cn-uses', 'Maximum uses', { type: 'number', value: 1, attrs: 'min="1"' }),
        this.fld('mktp-cn-biz', 'Business', { value: this.filters.businessId || '', options: this.bizOptions(businesses) }),
        this.fld('mktp-cn-branch', 'Branch', { value: this.filters.branchId || '', options: this.branchOptions(branches) }),
        this.fld('mktp-cn-camp', 'Campaign', { value: '', options: [['', '— None —'], ...campaigns.map((c) => [c.id, c.name])] }),
        this.fld('mktp-cn-promo', 'Promotion', { value: '', options: [['', '— None —'], ...promotions.map((p) => [p.id, p.name])] }),
        this.fld('mktp-cn-agent', 'Agent', { value: '', options: [['', '— None —'], ...agents.map((a) => [a.id, a.full_name])] }),
        this.fld('mktp-cn-start', 'Valid from', { type: 'date', value: this.today() }),
        this.fld('mktp-cn-end', 'Expires', { type: 'date', value: '' })
      ])}`, async () => {
      const saved = await this.apiOk(API.mktpCreateCoupon({
        code: this.val('mktp-cn-code') || undefined,
        discount_type: this.val('mktp-cn-type') || 'percent',
        discount_value: this.numVal('mktp-cn-value'),
        max_uses: this.numVal('mktp-cn-uses', 1),
        business_id: this.intVal('mktp-cn-biz'),
        branch_id: this.intVal('mktp-cn-branch'),
        campaign_id: this.intVal('mktp-cn-camp'),
        promotion_id: this.intVal('mktp-cn-promo'),
        agent_id: this.intVal('mktp-cn-agent'),
        starts_at: this.val('mktp-cn-start') || null,
        expires_at: this.val('mktp-cn-end') || null
      }, this.actor()), 'Could not create coupon');
      if (!saved) return false;
      this.toast(`Coupon ${saved.code || ''} created`, 'success');
      return true;
    }, 'Create coupon');
  },

  async couponRedeemForm(code) {
    this.openForm('Redeem coupon', `
      ${this.grid([
        this.fld('mktp-cr-code', 'Coupon code *', { value: code || '' }),
        this.fld('mktp-cr-sale', 'Sale ID', { type: 'number', value: '', attrs: 'min="1"', placeholder: 'Optional' })
      ])}`, async () => {
      const c = this.val('mktp-cr-code');
      if (!c) {
        this.toast('Coupon code is required', 'error');
        return false;
      }
      const saved = await this.apiOk(API.mktpRedeemCoupon(c, this.intVal('mktp-cr-sale'), this.actor()), 'Redemption failed');
      if (!saved) return false;
      this.toast(`Coupon redeemed — ${saved.used_count}/${saved.max_uses} uses`, 'success');
      return true;
    }, 'Redeem');
  },

  /* ─── Analytics ───────────────────────────────────────────────────────── */

  async renderAnalytics(el) {
    const roi = (await this.apiOk(API.mktpRoi(this.filterScope(), this.actor()), 'Could not load ROI')) || {};
    const rows = roi.by_campaign || [];

    el.innerHTML = `
      ${this.sectionHead(this.btn('Export CSV', 'export-analytics'))}
      <div class="mktp-kpis">
        ${this.kpi('Attributed revenue', this.money(roi.attributed_revenue), `${roi.attributed_orders || 0} attributed orders`, 'good')}
        ${this.kpi('Total sales', this.money(roi.total_revenue), `${roi.attributed_share_percent || 0}% marketing driven`, 'slate')}
        ${this.kpi('Campaign cost', this.money(roi.campaign_cost), `Budget ${this.money(roi.budget)} · ${roi.budget_used_percent || 0}% used`, 'warn')}
        ${this.kpi('Commission cost', this.money(roi.commission_cost), 'Agent earnings', 'warn')}
        ${this.kpi('Profit', this.money(roi.profit), `Total spend ${this.money(roi.total_spend)}`, Number(roi.profit) >= 0 ? 'good' : 'bad')}
        ${this.kpi('ROI', `${roi.roi_percent || 0}%`, `${roi.return_per_rand || 0}x return per unit spent`, 'accent')}
        ${this.kpi('Cost per order', this.money(roi.cost_per_order), 'Spend ÷ attributed orders')}
        ${this.kpi('Average order', this.money(roi.average_order_value), 'Attributed sales')}
      </div>
      ${this.panel('Revenue by campaign', this.chart(rows.slice(0, 12), (r) => String(r.name || '').slice(0, 10), (r) => r.revenue))}
      ${this.panel(`Campaign ROI · ${this.filters.from} to ${this.filters.to}`, this.table(
        ['Campaign', 'Status', 'Window', 'Referrals', 'Revenue', 'Marketing cost', 'Commission', 'Contribution', ''],
        rows.map((r) => {
          const contribution = (Number(r.revenue) || 0) - (Number(r.marketing_cost) || 0) - (Number(r.commission) || 0);
          return `<tr>
            <td><strong>${this.esc(r.name || '—')}</strong></td>
            <td>${this.statusTag(r.status)}</td>
            <td><small class="muted">${this.esc(r.start_date || '—')} → ${this.esc(r.end_date || '—')}</small></td>
            <td>${this.esc(r.referrals || 0)}</td>
            <td>${this.money(r.revenue)}</td>
            <td>${this.money(r.marketing_cost)}</td>
            <td>${this.money(r.commission)}</td>
            <td><strong>${this.money(contribution)}</strong></td>
            <td>${this.btn('Detail', 'campaign-analytics', { id: r.id })}</td>
          </tr>`;
        }).join(''),
        'No campaigns started in this period'
      ), '', true)}
      <p class="muted">Attribution is indicative: a sale may match a referral code, a coupon and a campaign tag at the same time.</p>`;
    this._cache.roi = roi;
  },

  /* ─── Reports ─────────────────────────────────────────────────────────── */

  REPORTS: [
    ['commissions', 'Commissions', 'Every commission row with agent, sale, rate and status.'],
    ['agents', 'Agents', 'Agent register with codes, tier, status and contact details.'],
    ['payments', 'Payments', 'Agent payouts with method, reference and who recorded them.'],
    ['campaigns', 'Campaigns', 'Campaign setup, window, budget and status.'],
    ['promotions', 'Promotions', 'Offer configuration and validity windows.'],
    ['coupons', 'Coupons', 'Codes issued, usage counts and expiry.'],
    ['customers', 'Customers', 'Customer base with orders and lifetime spend.'],
    ['leaderboard', 'Agent performance', 'Referrals, sales and commission per agent for the period.'],
    ['roi', 'Campaign ROI', 'Revenue, costs and contribution per campaign.'],
    ['audit', 'Audit trail', 'Privileged marketing actions with before and after values.']
  ],

  async renderReports(el) {
    el.innerHTML = `
      ${this.sectionHead()}
      <div class="mktp-note">Reports use the business, branch and date filters at the top of the page. Files download as CSV and open in Excel or Google Sheets.</div>
      ${this.panel(`Available reports · ${this.filters.from} to ${this.filters.to}`, this.table(
        ['Report', 'Contents', ''],
        this.REPORTS.map(([id, label, desc]) => `<tr>
          <td><strong>${this.esc(label)}</strong></td>
          <td><small class="muted">${this.esc(desc)}</small></td>
          <td>${this.rowBtns(`
            ${this.btn('Preview', 'report-preview', { report: id }, 'btn-ghost')}
            ${this.btn('Download CSV', 'report-csv', { report: id }, 'btn-primary')}
          `)}</td>
        </tr>`).join(''),
        ''
      ), '', true)}
      <div id="mktp-report-preview"></div>`;
  },

  async reportData(report) {
    const scope = this.filterScope();
    const bizOnly = this.filters.businessId ? { business_id: parseInt(this.filters.businessId, 10) } : {};
    switch (report) {
      case 'commissions': {
        const rows = await this.list(API.mktpCommissions(scope, this.actor()), 'Report failed');
        return {
          title: 'Commissions',
          headers: ['ID', 'Agent', 'Agent code', 'Referral code', 'Sale ID', 'Sale amount', 'Rate %', 'Commission', 'Status', 'Created', 'Approved', 'Paid'],
          rows: rows.map((c) => [c.id, c.agent_name, c.agent_code, c.referral_code, c.sale_id, c.sale_amount, c.rate, c.commission_amount, c.status, c.created_at, c.approved_at, c.paid_at])
        };
      }
      case 'agents': {
        const rows = await this.list(API.mktpAgents(bizOnly, this.actor()), 'Report failed');
        return {
          title: 'Agents',
          headers: ['ID', 'Agent code', 'Name', 'Phone', 'Email', 'Referral code', 'Tier', 'Status', 'Business', 'Branch', 'Approved at'],
          rows: rows.map((a) => [a.id, a.agent_code, a.full_name, a.phone, a.email, a.referral_code, a.tier, a.status, a.business_id, a.branch_id, a.approved_at])
        };
      }
      case 'payments': {
        const rows = await this.list(API.mktpPayments({}, this.actor()), 'Report failed');
        return {
          title: 'Payments',
          headers: ['ID', 'Agent', 'Agent code', 'Amount', 'Date', 'Method', 'Reference', 'Status', 'Recorded by', 'Notes'],
          rows: rows.map((p) => [p.id, p.agent_name, p.agent_code, p.amount, p.payment_date, p.payment_method, p.reference, p.status, p.admin_name, p.notes])
        };
      }
      case 'campaigns': {
        const rows = await this.list(API.mktpCampaigns(bizOnly, this.actor()), 'Report failed');
        return {
          title: 'Campaigns',
          headers: ['ID', 'Name', 'Business', 'Branch', 'Promotion', 'Channels', 'Budget', 'Marketing cost', 'Start', 'End', 'Status'],
          rows: rows.map((c) => [c.id, c.name, c.business_name, c.branch_name, c.promotion_name, (c.channels || []).join('|'), c.budget, c.marketing_cost, c.start_date, c.end_date, c.status])
        };
      }
      case 'promotions': {
        const rows = await this.list(API.mktpPromotions(bizOnly, this.actor()), 'Report failed');
        return {
          title: 'Promotions',
          headers: ['ID', 'Name', 'Type', 'Value', 'Min purchase', 'Max discount', 'Usage limit', 'Start', 'End', 'Status'],
          rows: rows.map((p) => [p.id, p.name, p.promo_type, p.discount_value, p.min_purchase, p.max_discount, p.usage_limit, p.start_date, p.end_date, p.status])
        };
      }
      case 'coupons': {
        const rows = await this.list(API.mktpCoupons({}, this.actor()), 'Report failed');
        return {
          title: 'Coupons',
          headers: ['ID', 'Code', 'Type', 'Value', 'Used', 'Max uses', 'Campaign', 'Agent', 'Starts', 'Expires', 'Status'],
          rows: rows.map((c) => [c.id, c.code, c.discount_type, c.discount_value, c.used_count, c.max_uses, c.campaign_id, c.agent_id, c.starts_at, c.expires_at, c.status])
        };
      }
      case 'customers': {
        const rows = await this.list(API.mktpCustomers(this.bizScope(), this.actor()), 'Report failed');
        return {
          title: 'Customers',
          headers: ['ID', 'Name', 'Phone', 'Email', 'Orders', 'Total spent', 'Joined'],
          rows: rows.map((c) => [c.id, c.full_name, c.phone, c.email, c.order_count, c.total_spent, c.created_at])
        };
      }
      case 'leaderboard': {
        const lb = await this.apiOk(API.mktpLeaderboard({ ...scope, limit: 100 }, this.actor()), 'Report failed');
        return {
          title: 'Agent performance',
          headers: ['Rank', 'Agent', 'Agent code', 'Referral code', 'Tier', 'Clicks', 'Referrals', 'Conversions', 'Orders', 'Sales', 'Commission', 'Status'],
          rows: (lb?.rows || []).map((a, i) => [a.rank || i + 1, a.full_name, a.agent_code, a.referral_code, a.tier,
            a.clicks, a.referrals, a.conversions, a.orders, a.revenue, a.commission, a.status])
        };
      }
      case 'roi': {
        const roi = await this.apiOk(API.mktpRoi(scope, this.actor()), 'Report failed');
        return {
          title: 'Campaign ROI',
          headers: ['Campaign ID', 'Campaign', 'Status', 'Start', 'End', 'Referrals', 'Revenue', 'Budget', 'Marketing cost', 'Commission', 'Contribution'],
          rows: (roi?.by_campaign || []).map((r) => [r.id, r.name, r.status, r.start_date, r.end_date, r.referrals, r.revenue,
            r.budget, r.marketing_cost, r.commission,
            (Number(r.revenue) || 0) - (Number(r.marketing_cost) || 0) - (Number(r.commission) || 0)])
        };
      }
      case 'audit':
      default: {
        const rows = await this.list(API.mktpAudit({}, this.actor()), 'Report failed');
        return {
          title: 'Audit trail',
          headers: ['ID', 'When', 'User', 'Action', 'Entity', 'Entity ID', 'Previous', 'New'],
          rows: rows.map((a) => [a.id, a.created_at, a.user_name, a.action, a.entity_type, a.entity_id, a.previous_value, a.new_value])
        };
      }
    }
  },

  async reportPreview(report) {
    const box = document.getElementById('mktp-report-preview');
    if (box) box.innerHTML = '<p class="muted">Building report…</p>';
    const data = await this.reportData(report);
    if (!box) return;
    box.innerHTML = this.panel(`${data.title} — ${data.rows.length} row(s)`,
      this.table(data.headers, data.rows.slice(0, 50).map((r) => `<tr>${r.map((c) => `<td>${this.esc(c ?? '')}</td>`).join('')}</tr>`).join(''), 'No data for these filters'),
      this.btn('Download CSV', 'report-csv', { report }, 'btn-primary'), true)
      + (data.rows.length > 50 ? '<p class="muted">Preview shows the first 50 rows — the CSV contains all of them.</p>' : '');
  },

  async reportCsv(report) {
    const data = await this.reportData(report);
    const stamp = `${this.filters.from}_${this.filters.to}`;
    this.downloadCsv(`${report}-${stamp}.csv`, data.headers, data.rows);
  },

  /* ─── Notifications ───────────────────────────────────────────────────── */

  async renderNotifications(el) {
    const rows = await this.list(API.mktpNotifications({ audience: 'admin' }, this.actor()), 'Could not load notifications');
    const unread = rows.filter((n) => !n.is_read);
    this.counts.notifications = unread.length;
    el.innerHTML = `
      ${this.sectionHead(`
        ${unread.length ? this.btn('Mark all read', 'notify-read-all', {}, 'btn-primary') : ''}
        ${this.btn('Refresh', 'notify-refresh')}
      `)}
      ${this.panel(`${unread.length} unread of ${rows.length}`, this.table(
        ['When', 'Title', 'Detail', 'Category', ''],
        rows.map((n) => `<tr style="${n.is_read ? '' : 'font-weight:600'}">
          <td>${this.esc(String(n.created_at || '').slice(0, 16))}</td>
          <td>${this.esc(n.title)}</td>
          <td>${this.esc(n.body || '')}</td>
          <td>${this.tag(n.category || 'general', 'info')}</td>
          <td>${n.is_read ? '<span class="muted">Read</span>' : this.btn('Mark read', 'notify-read', { id: n.id })}</td>
        </tr>`).join(''),
        'No notifications'
      ), '', true)}`;
    const nav = document.getElementById('mktp-nav');
    if (nav) nav.innerHTML = this.navHtml();
  },

  /* ─── Users & access ──────────────────────────────────────────────────── */

  async renderUsers(el) {
    const [users, agents] = await Promise.all([
      this.list(API.getUsers(this.actor()), 'Could not load users'),
      this.agentList()
    ]);
    const byUser = {};
    agents.forEach((a) => { if (a.user_id) byUser[a.user_id] = a; });
    const unlinked = agents.filter((a) => !a.user_id && a.status === 'active');
    el.innerHTML = `
      ${this.sectionHead(this.btn('Export CSV', 'export-users'))}
      <div class="mktp-note">Owners and managers reach the Command Centre. A user linked to an agent record sees only their own wallet, referrals and contracts in the Referral Agent app.</div>
      ${unlinked.length ? `<div class="mktp-note">${unlinked.length} active agent(s) have no login yet: ${this.esc(unlinked.map((a) => a.full_name).join(', '))}</div>` : ''}
      ${this.panel('POS users', this.table(
        ['User', 'Role', 'Linked agent', 'Access', ''],
        users.map((u) => {
          const agent = byUser[u.id];
          const access = ['owner', 'manager'].includes(u.role) ? 'Command Centre'
            : agent ? 'Referral Agent app' : 'No marketing access';
          return `<tr>
            <td><strong>${this.esc(u.full_name || u.username)}</strong><br><small class="muted">${this.esc(u.username)}</small></td>
            <td>${this.tag(u.role, ['owner', 'manager'].includes(u.role) ? 'ok' : 'muted')}</td>
            <td>${agent ? `${this.esc(agent.full_name)}<br><small class="muted">${this.esc(agent.referral_code || agent.agent_code || '')}</small>` : '—'}</td>
            <td>${this.tag(access, access === 'No marketing access' ? 'muted' : 'info')}</td>
            <td>${this.btn(agent ? 'Relink agent' : 'Link to agent', 'user-link-agent', { id: u.id, name: u.full_name || u.username })}</td>
          </tr>`;
        }).join(''),
        'No users found'
      ), '', true)}`;
    this._cache.users = users;
  },

  async userLinkAgentForm(userId, userName) {
    const agents = await this.agentList();
    this.openForm(`Link ${userName || 'user'} to an agent`, `
      ${this.grid([
        this.fld('mktp-ua-agent', 'Referral agent', { value: '', options: this.agentOptions(agents), full: true })
      ])}
      <p class="muted">The user signs in with their normal POS credentials and lands in the Referral Agent app.</p>`,
      async () => {
        const agentId = this.intVal('mktp-ua-agent');
        if (!agentId) {
          this.toast('Select an agent', 'error');
          return false;
        }
        const saved = await this.apiOk(API.mktpLinkAgentUser(agentId, parseInt(userId, 10), this.actor()), 'Link failed');
        if (!saved) return false;
        this.toast('Login linked to agent', 'success');
        return true;
      }, 'Link');
  },

  /* ─── Audit ───────────────────────────────────────────────────────────── */

  async renderAudit(el) {
    const f = {};
    if (this.ui.auditEntity) f.entity_type = this.ui.auditEntity;
    if (this.ui.auditAction) f.action = this.ui.auditAction;
    const rows = await this.list(API.mktpAudit(f, this.actor()), 'Could not load audit trail');
    const entities = Array.from(new Set(rows.map((r) => r.entity_type).filter(Boolean)));
    el.innerHTML = `
      ${this.sectionHead(this.btn('Export CSV', 'export-audit'))}
      ${this.panel('Filter', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${this.fld('mktp-au-entity', 'Entity type', { value: this.ui.auditEntity || '', options: [['', 'All entities'], ...entities.map((e) => [e, e])] })}
          ${this.fld('mktp-au-action', 'Action', { value: this.ui.auditAction || '', placeholder: 'e.g. approve_agent' })}
          ${this.btn('Apply', 'audit-filter', {}, 'btn-primary')}
          ${this.btn('Clear', 'audit-filter-clear')}
        </div>`)}
      ${this.panel(`${rows.length} entr(ies)`, this.table(
        ['When', 'User', 'Action', 'Entity', 'Previous', 'New'],
        rows.map((a) => `<tr>
          <td>${this.esc(String(a.created_at || '').slice(0, 16))}</td>
          <td>${this.esc(a.user_name || a.user_id || 'system')}</td>
          <td>${this.tag(a.action, 'info')}</td>
          <td>${this.esc(a.entity_type || '—')}${a.entity_id != null ? ` #${this.esc(a.entity_id)}` : ''}</td>
          <td><div class="mktp-truncate"><small class="muted">${this.esc(a.previous_value || '—')}</small></div></td>
          <td><div class="mktp-truncate"><small class="muted">${this.esc(a.new_value || '—')}</small></div></td>
        </tr>`).join(''),
        'No audit entries yet'
      ), '', true)}`;
    this._cache.audit = rows;
  },

  /* ─── Settings ────────────────────────────────────────────────────────── */

  async renderSettings(el) {
    const s = (await this.apiOk(API.mktpSettings(), 'Could not load settings')) || {};
    const social = s.social || {};
    el.innerHTML = `
      ${this.sectionHead(this.btn('Save settings', 'settings-save', {}, 'btn-primary'))}
      ${this.panel('Commissions', this.grid([
        this.fld('mktp-set-percent', 'Default commission percentage', { type: 'number', value: s.default_commission_percent ?? 5, attrs: 'step="0.01" min="0"', hint: 'Used when no rule matches' }),
        this.fld('mktp-set-auto', 'Approve commissions automatically', { type: 'checkbox', value: s.auto_approve_commissions })
      ]))}
      ${this.panel('Referrals & applications', this.grid([
        this.fld('mktp-set-base', 'Referral link base', { value: s.referral_base_url || '/r/', hint: 'Agent links become base + code' }),
        this.fld('mktp-set-public', 'Allow public agent applications', { type: 'checkbox', value: s.public_apply_enabled ?? 1 })
      ]))}
      ${this.panel('Social media APIs (Meta)', `
        <p class="mktp-note" style="margin-bottom:12px">Connect a Facebook Page token to publish Facebook and Instagram posts for real. Create a Meta app, grant <code>pages_manage_posts</code> and <code>instagram_content_publish</code>, then paste the Page Access Token below.</p>
        ${this.grid([
          this.fld('mktp-set-fb-page', 'Facebook Page ID', { value: social.facebook_page_id || '', hint: 'Numeric Page ID from Meta Business Suite' }),
          this.fld('mktp-set-fb-token', 'Page Access Token', {
            value: '',
            hint: social.facebook_page_token_set ? 'Token is saved — leave blank to keep it' : 'Paste a long-lived Page Access Token'
          }),
          this.fld('mktp-set-ig', 'Instagram Business Account ID', { value: social.instagram_account_id || '', hint: 'Linked IG professional account ID' })
        ])}
        <div class="mktp-kpis" style="margin-top:12px">
          ${this.kpi('Meta publish', social.enabled ? 'Ready' : 'Not configured', social.enabled ? 'Facebook / Instagram live' : 'Add token to go live', social.enabled ? 'good' : 'warn')}
        </div>`)}
      ${this.panel('Platform status', `
        <div class="mktp-kpis">
          ${this.kpi('Pending applications', this.counts.applications, 'Awaiting your decision', this.counts.applications ? 'warn' : 'good')}
          ${this.kpi('Unread notifications', this.counts.notifications, 'Admin audience')}
          ${this.kpi('Last updated', String(s.updated_at || '—').slice(0, 16), 'Settings record')}
        </div>`)}`;
  },

  async saveSettings() {
    const social = {
      facebook_page_id: this.val('mktp-set-fb-page') || '',
      instagram_account_id: this.val('mktp-set-ig') || ''
    };
    const token = this.val('mktp-set-fb-token');
    if (token && token !== '••••••••') social.facebook_page_token = token;
    const saved = await this.apiOk(API.mktpSaveSettings({
      default_commission_percent: this.numVal('mktp-set-percent', 5),
      auto_approve_commissions: this.chk('mktp-set-auto') ? 1 : 0,
      referral_base_url: this.val('mktp-set-base') || '/r/',
      public_apply_enabled: this.chk('mktp-set-public') ? 1 : 0,
      social
    }, this.actor()), 'Save failed');
    if (!saved) return;
    this.toast('Settings saved', 'success');
    await this.refresh();
  },

  /* ─── Action registry ─────────────────────────────────────────────────── */

  ACT: {
    async nav(ds) {
      this.section = ds.section;
      document.querySelectorAll('.mktp-nav-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.section === ds.section);
      });
      await this.refresh();
    },

    async 'apply-filters'() {
      this.filters.businessId = this.val('mktp-f-biz');
      this.filters.branchId = this.val('mktp-f-branch');
      this.filters.from = this.val('mktp-f-from') || this.monthStart();
      this.filters.to = this.val('mktp-f-to') || this.today();
      await this.hardRefresh();
    },

    async 'range-month'() {
      this.filters.from = this.monthStart();
      this.filters.to = this.today();
      await this.hardRefresh();
    },

    async 'range-today'() {
      this.filters.from = this.today();
      this.filters.to = this.today();
      await this.hardRefresh();
    },

    async 'reset-filters'() {
      this.filters = { businessId: '', branchId: '', from: this.monthStart(), to: this.today() };
      await this.hardRefresh();
    },

    async 'copy-text'(ds) {
      await this.copy(ds.text || '');
    },

    'open-referral'(ds) {
      const url = this.referralPageUrl(ds.code, ds.link);
      if (!url) return this.toast('No referral code', 'error');
      window.open(url, '_blank', 'noopener');
    },

    /* Businesses */
    async 'business-new'() {
      await this.businessForm(null);
    },
    async 'business-edit'(ds) {
      const b = await this.apiOk(API.mktpGetBusiness(parseInt(ds.id, 10)), 'Could not load business');
      if (b) await this.businessForm(b);
    },
    async 'business-toggle'(ds) {
      const r = await this.apiOk(API.mktpSetBusinessActive(parseInt(ds.id, 10), ds.active === '1', this.actor()), 'Update failed');
      if (!r) return;
      this.toast(ds.active === '1' ? 'Business activated' : 'Business deactivated', 'success');
      await this.refresh();
    },

    /* Branches */
    async 'branch-link'(ds) {
      await this.branchLinkForm(ds.id, ds.business);
    },

    /* Campaigns */
    async 'campaign-new'() {
      this.section = 'campaigns';
      await this.campaignForm(null);
    },
    async 'campaign-edit'(ds) {
      const c = await this.apiOk(API.mktpGetCampaign(parseInt(ds.id, 10)), 'Could not load campaign');
      if (c) await this.campaignForm(c);
    },
    async 'campaign-status'(ds) {
      const r = await this.apiOk(API.mktpSetCampaignStatus(parseInt(ds.id, 10), ds.status, this.actor()), 'Update failed');
      if (!r) return;
      this.toast(`Campaign ${ds.status}`, 'success');
      await this.refresh();
    },
    async 'campaign-status-pick'(ds) {
      this.openForm('Change campaign status', this.grid([
        this.fld('mktp-cst', 'Status', { value: ds.current || 'draft', options: this.CAMPAIGN_STATUSES.map((s) => [s, s]), full: true })
      ]), async () => {
        const r = await this.apiOk(API.mktpSetCampaignStatus(parseInt(ds.id, 10), this.val('mktp-cst'), this.actor()), 'Update failed');
        if (!r) return false;
        this.toast('Campaign updated', 'success');
        return true;
      }, 'Update');
    },
    async 'campaign-duplicate'(ds) {
      const r = await this.apiOk(API.mktpDuplicateCampaign(parseInt(ds.id, 10), this.actor()), 'Duplicate failed');
      if (!r) return;
      this.toast('Campaign duplicated as a draft', 'success');
      await this.refresh();
    },
    async 'campaign-assets'(ds) {
      const r = await this.apiOk(API.mktpGenerateAssets(parseInt(ds.id, 10), this.actor()), 'Asset generation failed');
      if (!r) return;
      this.toast('Generated social drafts, a WhatsApp blast, a coupon and a QR code', 'success');
      await this.refresh();
    },
    async 'campaign-analytics'(ds) {
      if (ds.id) await this.campaignAnalyticsModal(ds.id);
    },

    /* Promotions */
    async 'promo-new'() {
      await this.promoForm(null);
    },
    async 'promo-edit'(ds) {
      const p = await this.apiOk(API.mktpGetPromotion(parseInt(ds.id, 10)), 'Could not load promotion');
      if (p) await this.promoForm(p);
    },
    async 'promo-status'(ds) {
      const r = await this.apiOk(API.mktpSetPromotionStatus(parseInt(ds.id, 10), ds.status, this.actor()), 'Update failed');
      if (!r) return;
      this.toast(`Promotion ${ds.status}`, 'success');
      await this.refresh();
    },

    /* Flyers */
    async 'open-flyer-studio'(ds) {
      await this.openFlyerStudio(ds.id);
    },
    async 'open-flyer-ai'() {
      if (window.MarketingFlyersPage) MarketingFlyersPage.pendingAiFlyer = true;
      await this.openFlyerStudio();
    },
    async 'flyer-approve'(ds) {
      const r = await this.apiOk(API.approveFlyer(parseInt(ds.id, 10), this.actor()), 'Approve failed');
      if (!r) return;
      this.toast('Artwork approved', 'success');
      await this.refresh();
    },
    async 'flyer-reject'(ds) {
      this.openForm('Reject artwork', this.grid([
        this.fld('mktp-fr-notes', 'Reason', { value: 'Please revise', rows: 3, full: true })
      ]), async () => {
        const r = await this.apiOk(API.rejectFlyer(parseInt(ds.id, 10), this.actor(), this.val('mktp-fr-notes') || 'Please revise'), 'Reject failed');
        if (!r) return false;
        this.toast('Artwork rejected', 'success');
        return true;
      }, 'Reject');
    },

    /* Social */
    async 'social-new'() {
      await this.socialForm(null);
    },
    async 'social-edit'(ds) {
      const s = (this._cache.social || []).find((x) => String(x.id) === String(ds.id));
      await this.socialForm(s || { id: parseInt(ds.id, 10) });
    },
    async 'social-publish'(ds) {
      const r = await this.apiOk(API.mktpPublishSocialPost(parseInt(ds.id, 10), this.actor()), 'Publish failed');
      if (!r) return;
      this.toast(r.publish_note
        ? `Published locally — ${r.publish_note}`
        : (r.publish_remote?.id ? 'Published to Meta' : 'Published'), 'success');
      await this.refresh();
    },

    /* WhatsApp */
    async 'wa-new'() {
      await this.whatsappForm(null);
    },
    async 'wa-edit'(ds) {
      const b = (this._cache.blasts || []).find((x) => String(x.id) === String(ds.id));
      await this.whatsappForm(b || { id: parseInt(ds.id, 10) });
    },
    async 'wa-audience'(ds) {
      await this.whatsappAudienceModal(ds.segment, ds.business);
    },
    async 'wa-sent'(ds) {
      const b = (this._cache.blasts || []).find((x) => String(x.id) === String(ds.id)) || {};
      const r = await this.apiOk(API.mktpSaveWhatsappBlast({ ...b, id: parseInt(ds.id, 10), status: 'sent' }, this.actor()), 'Update failed');
      if (!r) return;
      this.toast('Blast marked sent', 'success');
      await this.refresh();
    },

    /* Calendar */
    async 'cal-new'() {
      await this.calendarForm(null);
    },
    async 'cal-edit'(ds) {
      const e = (this._cache.calendar || []).find((x) => String(x.id) === String(ds.id));
      await this.calendarForm(e || { id: parseInt(ds.id, 10) });
    },

    /* Customers */
    async 'customer-search'() {
      this.ui.customerSearch = this.val('mktp-cust-q');
      await this.refresh();
    },
    async 'customer-search-clear'() {
      this.ui.customerSearch = '';
      await this.refresh();
    },
    async 'customer-attribute'(ds) {
      await this.attributeForm(ds.id, ds.name);
    },

    /* Segments */
    async 'segment-new'() {
      await this.segmentForm(null);
    },
    async 'segment-edit'(ds) {
      const s = (this._cache.segments || []).find((x) => String(x.id) === String(ds.id));
      await this.segmentForm(s || { id: parseInt(ds.id, 10) });
    },
    async 'segment-evaluate'(ds) {
      await this.segmentEvaluateModal(ds.id, ds.name);
    },

    /* Loyalty */
    async 'loyalty-new'() {
      await this.loyaltyForm(null);
    },
    async 'loyalty-edit'(ds) {
      const r = (this._cache.loyalty || []).find((x) => String(x.id) === String(ds.id));
      await this.loyaltyForm(r || { id: parseInt(ds.id, 10) });
    },
    async 'loyalty-toggle'(ds) {
      const r = (this._cache.loyalty || []).find((x) => String(x.id) === String(ds.id)) || {};
      const saved = await this.apiOk(API.mktpSaveLoyaltyRule({ ...r, id: parseInt(ds.id, 10), is_active: ds.active === '1' ? 1 : 0 }, this.actor()), 'Update failed');
      if (!saved) return;
      this.toast('Loyalty rule updated', 'success');
      await this.refresh();
    },

    /* Agents */
    async 'agent-new'() {
      await this.agentApplyForm();
    },
    async 'agent-view'(ds) {
      await this.agentViewModal(ds.id);
    },
    async 'agent-approve'(ds) {
      await this.agentApproveForm(ds.id);
    },
    async 'agent-status'(ds) {
      await this.agentStatusForm(ds.id, ds.status);
    },
    async 'agent-link-user'(ds) {
      await this.agentLinkUserForm(ds.id, ds.name);
    },
    async 'agent-create-login'(ds) {
      const saved = await this.apiOk(API.mktpEnsureAgentLogin(parseInt(ds.id, 10), this.actor()), 'Could not create login');
      if (!saved) return;
      const user = saved._temp_username || saved.temp_username;
      const pass = saved._temp_password || saved.temp_password;
      if (user && pass) {
        Utils.showModal('Agent portal login', `
          <p><strong>${this.esc(ds.name || 'Agent')}</strong></p>
          <div class="field"><label>Username</label><input readonly value="${this.esc(user)}"></div>
          <div class="field"><label>Temporary password</label><input readonly value="${this.esc(pass)}"></div>
          <p class="muted">Share once. Agent signs in with these credentials on the Marketing Agent portal.</p>`,
          '<button type="button" class="btn btn-primary" id="mktp-login-done">Done</button>');
        document.getElementById('mktp-login-done')?.addEventListener('click', () => Utils.hideModal());
        this.toast(`Login ready: ${user}`, 'success');
      } else {
        this.toast('Login linked (no new password returned)', 'success');
      }
      await this.refresh();
    },
    async 'agent-filter'() {
      this.ui.agentStatus = this.val('mktp-ag-status');
      this.ui.agentSearch = this.val('mktp-ag-q');
      await this.refresh();
    },
    async 'agent-filter-clear'() {
      this.ui.agentStatus = '';
      this.ui.agentSearch = '';
      await this.refresh();
    },

    /* Contracts */
    async 'contract-new'(ds) {
      await this.contractIssueForm(ds.template);
    },
    async 'contract-view'(ds) {
      await this.contractViewModal(ds.id);
    },
    async 'contract-status'(ds) {
      await this.contractStatusForm(ds.id, ds.current);
    },
    async 'template-new'() {
      await this.templateForm(null);
    },
    async 'template-edit'(ds) {
      const t = (this._cache.templates || []).find((x) => String(x.id) === String(ds.id));
      await this.templateForm(t || { id: parseInt(ds.id, 10) });
    },

    /* QR */
    async 'qr-new'() {
      await this.qrForm();
    },
    async 'qr-show'(ds) {
      this.qrShowModal(ds.id);
    },
    async 'qr-filter'() {
      this.ui.qrType = this.val('mktp-qr-type');
      await this.refresh();
    },
    async 'qr-filter-clear'() {
      this.ui.qrType = '';
      await this.refresh();
    },

    /* Commissions */
    async 'commission-status'(ds) {
      const r = await this.apiOk(API.mktpSetCommissionStatus(parseInt(ds.id, 10), ds.status, null, this.actor()), 'Update failed');
      if (!r) return;
      this.toast(`Commission ${ds.status}`, 'success');
      await this.refresh();
    },
    async 'commission-approve-all'() {
      const pending = (this._cache.commissions || []).filter((c) => c.status === 'pending');
      if (!pending.length) {
        this.toast('No pending commissions to approve', 'info');
        return;
      }
      let ok = 0;
      for (const c of pending) {
        const r = await this.apiOk(API.mktpSetCommissionStatus(c.id, 'approved', 'Bulk approval', this.actor()), 'Approve failed');
        if (r) ok += 1;
      }
      this.toast(`Approved ${ok} of ${pending.length} commission(s)`, ok ? 'success' : 'error');
      await this.refresh();
    },
    async 'commission-filter'() {
      this.ui.commissionStatus = this.val('mktp-cm-status');
      this.ui.commissionAgent = this.val('mktp-cm-agent');
      await this.refresh();
    },
    async 'commission-filter-clear'() {
      this.ui.commissionStatus = '';
      this.ui.commissionAgent = '';
      await this.refresh();
    },
    async 'rule-new'() {
      await this.commissionRuleForm(null);
    },
    async 'rule-edit'(ds) {
      const r = (this._cache.rules || []).find((x) => String(x.id) === String(ds.id));
      await this.commissionRuleForm(r || { id: parseInt(ds.id, 10) });
    },

    /* Payments */
    async 'payment-new'() {
      await this.paymentForm();
    },
    async 'payment-filter'() {
      this.ui.paymentAgent = this.val('mktp-pm-agent');
      await this.refresh();
    },
    async 'payment-filter-clear'() {
      this.ui.paymentAgent = '';
      await this.refresh();
    },

    /* Performance */
    async 'incentive-new'() {
      await this.incentiveForm(null);
    },
    async 'incentive-edit'(ds) {
      const i = (this._cache.incentives || []).find((x) => String(x.id) === String(ds.id));
      await this.incentiveForm(i || { id: parseInt(ds.id, 10) });
    },

    /* Coupons */
    async 'coupon-new'() {
      await this.couponForm();
    },
    async 'coupon-redeem'(ds) {
      await this.couponRedeemForm(ds.code);
    },
    async 'coupon-filter'() {
      this.ui.couponStatus = this.val('mktp-cp-status');
      this.ui.couponSearch = this.val('mktp-cp-q');
      await this.refresh();
    },
    async 'coupon-filter-clear'() {
      this.ui.couponStatus = '';
      this.ui.couponSearch = '';
      await this.refresh();
    },

    /* Notifications */
    async 'notify-read'(ds) {
      await this.apiOk(API.mktpReadNotification(parseInt(ds.id, 10), this.actor()), 'Update failed');
      await this.refresh();
    },
    async 'notify-read-all'() {
      const unread = (await this.list(API.mktpNotifications({ audience: 'admin', unread_only: true }, this.actor()), 'Failed'));
      for (const n of unread) {
        await this.apiOk(API.mktpReadNotification(n.id, this.actor()), 'Update failed');
      }
      this.toast(`${unread.length} notification(s) marked read`, 'success');
      await this.refresh();
    },
    async 'notify-refresh'() {
      await this.refresh();
    },

    /* Users */
    async 'user-link-agent'(ds) {
      await this.userLinkAgentForm(ds.id, ds.name);
    },

    /* Audit */
    async 'audit-filter'() {
      this.ui.auditEntity = this.val('mktp-au-entity');
      this.ui.auditAction = this.val('mktp-au-action');
      await this.refresh();
    },
    async 'audit-filter-clear'() {
      this.ui.auditEntity = '';
      this.ui.auditAction = '';
      await this.refresh();
    },

    /* Settings */
    async 'settings-save'() {
      await this.saveSettings();
    },

    /* Reports & exports */
    async 'report-preview'(ds) {
      await this.reportPreview(ds.report);
    },
    async 'report-csv'(ds) {
      await this.reportCsv(ds.report);
    },
    async 'export-dashboard'() {
      const d = this._cache.dashboard || {};
      this.downloadCsv(`marketing-summary-${this.filters.from}_${this.filters.to}.csv`,
        ['Metric', 'Value', 'Detail'],
        (d.cards || []).map((c) => [c.label, c.value, c.hint || '']));
    },
    async 'export-businesses'() {
      await this.reportCsvFrom('businesses', ['ID', 'Name', 'Code', 'Phone', 'Email', 'WhatsApp', 'Address', 'Branches', 'Active'],
        (this._cache.businesses || []).map((b) => [b.id, b.name, b.code, b.contact_phone, b.contact_email, b.whatsapp_number, b.address, b.branch_count, b.is_active]));
    },
    async 'export-branches'() {
      const rows = await this.list(API.mktpBranches({}), 'Export failed');
      await this.reportCsvFrom('branches', ['ID', 'Name', 'Business', 'Phone', 'Address', 'Active'],
        rows.map((b) => [b.id, b.name, b.business_name, b.phone, b.address, b.is_active ?? 1]));
    },
    async 'export-campaigns'() {
      await this.reportCsv('campaigns');
    },
    async 'export-promotions'() {
      await this.reportCsv('promotions');
    },
    async 'export-flyers'() {
      const rows = await this.list(API.getFlyers({}), 'Export failed');
      await this.reportCsvFrom('artwork', ['ID', 'Title', 'Size', 'Status', 'Approval', 'Created'],
        rows.map((f) => [f.id, f.title, f.flyer_size, f.display_status || f.status, f.approval_status, f.created_at]));
    },
    async 'export-social'() {
      await this.reportCsvFrom('social-posts', ['ID', 'Platform', 'Caption', 'Campaign', 'Status', 'Scheduled', 'Published'],
        (this._cache.social || []).map((s) => [s.id, s.platform, s.caption, s.campaign_id, s.status, s.scheduled_at, s.published_at]));
    },
    async 'export-whatsapp'() {
      await this.reportCsvFrom('whatsapp-blasts', ['ID', 'Name', 'Segment', 'Message', 'Status', 'Scheduled'],
        (this._cache.blasts || []).map((b) => [b.id, b.name, b.segment_key, b.message, b.status, b.scheduled_at]));
    },
    async 'export-calendar'() {
      await this.reportCsvFrom('marketing-calendar', ['ID', 'Title', 'Type', 'Start', 'End', 'Business', 'Branch'],
        (this._cache.calendar || []).map((e) => [e.id, e.title, e.event_type, e.start_at, e.end_at, e.business_id, e.branch_id]));
    },
    async 'export-customers'() {
      await this.reportCsv('customers');
    },
    async 'export-segments'() {
      await this.reportCsvFrom('segments', ['ID', 'Name', 'Rules', 'Auto'],
        (this._cache.segments || []).map((s) => [s.id, s.name, JSON.stringify(s.rules || {}), s.is_auto]));
    },
    async 'export-loyalty'() {
      await this.reportCsvFrom('loyalty-rules', ['ID', 'Name', 'Type', 'Points per currency', 'Threshold', 'Referral bonus', 'Active'],
        (this._cache.loyalty || []).map((r) => [r.id, r.name, r.rule_type, r.points_per_currency, r.reward_threshold, r.referral_bonus_points, r.is_active]));
    },
    async 'export-agents'() {
      await this.reportCsv('agents');
    },
    async 'export-applications'() {
      await this.reportCsvFrom('agent-applications', ['ID', 'Name', 'Phone', 'Email', 'ID number', 'Applied', 'Business', 'Branch'],
        (this._cache.applications || []).map((a) => [a.id, a.full_name, a.phone, a.email, a.id_number, a.application_date, a.business_id, a.branch_id]));
    },
    async 'export-contracts'() {
      await this.reportCsvFrom('contracts', ['ID', 'Agent', 'Title', 'Effective', 'Accepted', 'Status'],
        (this._cache.contracts || []).map((c) => [c.id, c.agent_name, c.title, c.effective_date, c.accepted_at, c.status]));
    },
    async 'export-codes'() {
      await this.reportCsvFrom('referral-codes', ['Agent', 'Agent code', 'Referral code', 'Link', 'QR payload', 'Status'],
        (this._cache.codes || []).map((a) => [a.full_name, a.agent_code, a.referral_code, a.referral_link, a.qr_payload, a.status]));
    },
    async 'export-qr'() {
      await this.reportCsvFrom('qr-codes', ['ID', 'Label', 'Type', 'Entity', 'Payload', 'Scans', 'Active'],
        (this._cache.qrCodes || []).map((q) => [q.id, q.label, q.entity_type, q.entity_id, q.payload, q.scan_count, q.is_active]));
    },
    async 'export-commissions'() {
      await this.reportCsv('commissions');
    },
    async 'export-payments'() {
      await this.reportCsv('payments');
    },
    async 'export-leaderboard'() {
      await this.reportCsv('leaderboard');
    },
    async 'export-coupons'() {
      await this.reportCsv('coupons');
    },
    async 'export-analytics'() {
      await this.reportCsv('roi');
    },
    async 'export-audit'() {
      await this.reportCsv('audit');
    },
    async 'export-users'() {
      await this.reportCsvFrom('users-access', ['ID', 'Username', 'Name', 'Role'],
        (this._cache.users || []).map((u) => [u.id, u.username, u.full_name, u.role]));
    }
  },

  async reportCsvFrom(name, headers, rows) {
    this.downloadCsv(`${name}-${this.today()}.csv`, headers, rows);
  }
};

window.AdminMarketingPage = AdminMarketingPage;
