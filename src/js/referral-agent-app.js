/**
 * Referral Agent Portal — separate app for approved agents
 */
window.ReferralAgentApp = {
  view: 'gate',
  data: {},
  container: null,
  app: null,

  NAV: [
    ['home', 'Dashboard'],
    ['code', 'My Code'],
    ['link', 'My Link'],
    ['customers', 'Customers'],
    ['orders', 'Orders'],
    ['commission', 'Commission'],
    ['wallet', 'Wallet'],
    ['payouts', 'Payouts'],
    ['performance', 'Performance'],
    ['notifications', 'Notifications'],
    ['profile', 'My Profile'],
    ['bank', 'Bank Details'],
    ['support', 'Support']
  ],

  actor() { return this.app?.user || (typeof App !== 'undefined' && App.user) || null; },
  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${(Number(n) || 0).toFixed(2)}`;
  },
  toast(m, t) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(m, t || 'info'); },
  async api(p, msg) {
    let r; try { r = await p; } catch (e) { return { __error: e?.message || msg }; }
    if (!r || r.success === false) return { __error: (r && r.error) || msg || 'Failed' };
    return r.data !== undefined ? r.data : r;
  },
  val(id) { return (document.getElementById(id)?.value || '').trim(); },
  chk(id) { return !!document.getElementById(id)?.checked; },
  tag(s) {
    const u = String(s || '').toUpperCase();
    const cls = ['APPROVED', 'PAID', 'AVAILABLE', 'ACTIVE'].includes(u) ? 'ok'
      : ['PENDING', 'PENDING_APPROVAL'].includes(u) ? 'warn'
        : ['PENDING_DELIVERY', 'UNDER_REVIEW'].includes(u) ? 'info'
          : ['REJECTED', 'REVERSED', 'SUSPENDED'].includes(u) ? 'bad' : 'muted';
    return `<span class="ref-tag ${cls}">${this.esc(s || '—')}</span>`;
  },

  ensureCss() {
    if (document.getElementById('ref-dept-css')) return;
    const l = document.createElement('link');
    l.id = 'ref-dept-css'; l.rel = 'stylesheet'; l.href = 'css/referral-dept.css';
    document.head.appendChild(l);
  },

  async open(app, opts = {}) {
    this.app = app || this.app;
    this.view = opts.view || (this.actor() ? 'home' : 'gate');
    this.applyShopBranding();
    await this.render(opts.container || document.getElementById('referral-agent-root'), this.app);
  },

  applyShopBranding() {
    const shop = this.app?.settings?.shop_name || this.app?.settings?.app_display_name || 'Referral Agent';
    try {
      document.title = `${shop} — Referral Agent`;
      let link = document.querySelector("link[rel='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = '/api/logo';
    } catch (_) { /* ignore */ }
    this.shopName = shop;
  },

  close() {
    this.stopPhoneNotifications();
    if (typeof App !== 'undefined' && App.closeReferralAgent) App.closeReferralAgent();
    else if (typeof App !== 'undefined') App.showScreen?.('login');
  },

  goBackInApp() {
    if (this.view && this.view !== 'home' && this.data.dashboard) {
      this.view = 'home'; this.renderShell(); return true;
    }
    return false;
  },

  async render(root, app) {
    this.ensureCss();
    this.container = root || this.container;
    this.app = app || this.app;
    this.applyShopBranding();
    if (!this.container) return;
    if (!this.actor()) {
      if (this.view === 'apply') return this.renderApply();
      return this.renderGate();
    }
    this.container.innerHTML = '<p class="muted" style="padding:24px">Loading your portal…</p>';
    const dash = await this.api(API.referralAgentDashboard(this.actor()), 'Could not load dashboard');
    if (dash?.__error || !dash?.agent) {
      this.container.innerHTML = `<div class="ref-agent-shell">
        <div class="ref-panel"><div class="ref-panel-b">
          <p>${this.esc(dash?.__error || 'No referral agent profile linked to this login')}</p>
          <button type="button" class="btn btn-primary" id="ref-apply-btn">Apply as Referral Agent</button>
          <button type="button" class="btn btn-ghost" id="ref-close-btn">Back to sign in</button>
        </div></div></div>`;
      document.getElementById('ref-apply-btn')?.addEventListener('click', () => { this.view = 'apply'; this.renderApply(); });
      document.getElementById('ref-close-btn')?.addEventListener('click', () => {
        try { API.logout?.(); } catch (_) { /* ignore */ }
        if (typeof App !== 'undefined') App.user = null;
        this.gateTab = 'signin';
        this.view = 'gate';
        this.renderGate();
      });
      return;
    }
    this.data.dashboard = dash;
    if (dash.pending) {
      this.container.innerHTML = `<div class="ref-agent-shell">
        <div class="ref-note">Your application is <strong>${this.esc(dash.agent.status)}</strong>. You will get full portal access once an admin approves you.</div>
        <button type="button" class="btn btn-ghost" id="ref-close-btn">Back to sign in</button></div>`;
      document.getElementById('ref-close-btn')?.addEventListener('click', () => {
        try { API.logout?.(); } catch (_) { /* ignore */ }
        if (typeof App !== 'undefined') App.user = null;
        this.gateTab = 'signin';
        this.view = 'gate';
        this.renderGate();
      });
      return;
    }
    this.view = this.NAV.some(([id]) => id === this.view) ? this.view : 'home';
    this.renderShell();
    this.startPhoneNotifications(this.data.dashboard);
  },

  startPhoneNotifications(dash) {
    if (!window.ReferralNotify) return;
    const actor = this.actor();
    if (!actor) return;
    ReferralNotify.init({ panel: 'referral', audience: 'agent', actor });
    ReferralNotify.start(actor);
    const unread = dash?.unread_notifications || (dash?.notifications || []).filter((n) => !Number(n.is_read));
    if (unread?.length) ReferralNotify.poll().catch(() => {});
  },

  stopPhoneNotifications() {
    window.ReferralNotify?.stop();
  },

  renderShell() {
    const dash = this.data.dashboard || {};
    const agent = dash.agent || {};
    const shop = this.shopName || this.app?.settings?.shop_name || 'Shop';
    const body = ({
      home: () => this.viewHome(dash),
      code: () => this.viewCode(dash),
      link: () => this.viewLink(dash),
      customers: () => this.viewCustomers(dash),
      orders: () => this.viewOrders(dash),
      commission: () => this.viewCommission(dash),
      wallet: () => this.viewWallet(dash),
      payouts: () => this.viewPayouts(dash),
      performance: () => this.viewPerformance(dash),
      notifications: () => this.viewNotes(dash),
      profile: () => this.viewProfile(dash),
      bank: () => this.viewBank(dash),
      support: () => `<div class="ref-panel"><div class="ref-panel-b"><p class="muted">Contact the shop admin for payout or account help.</p></div></div>`
    }[this.view] || (() => this.viewHome(dash)))();

    // Keep horizontal tab scroll position when switching far-right tabs
    if (this.renderShellFast(body)) return;

    this.container.innerHTML = `<div class="ref-root ref-agent-shell">
      <header class="ref-agent-top">
        <div class="ref-agent-top-brand">
          <div class="ref-brand-mark ref-brand-mark-sm">
            <img src="/api/logo" alt="" class="ref-shop-logo" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='flex')">
            <span class="ref-brand-fallback" style="display:none">RA</span>
          </div>
          <div>
            <strong>${this.esc(shop)}</strong>
            <span class="muted">Referral Agent · ${this.esc(agent.full_name || 'Agent')}</span>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="ref-logout">Sign out</button>
      </header>
      <nav class="ref-agent-nav" id="ref-agent-nav">
        ${this.NAV.map(([id, label]) => `<button type="button" class="btn btn-sm ${this.view === id ? 'btn-primary' : 'btn-ghost'}" data-ref-view="${id}">${this.esc(label)}</button>`).join('')}
      </nav>
      <main id="ref-agent-main">${body}</main>
    </div>`;
    document.getElementById('ref-logout')?.addEventListener('click', () => this.close());
    this.bindAgentNavAndActions();
    this.keepAgentNavInView();
  },

  bindAgentNavAndActions() {
    this.container.querySelectorAll('[data-ref-view]').forEach((b) => {
      if (b.dataset.bound === '1') return;
      b.dataset.bound = '1';
      b.addEventListener('click', async () => {
        if (this.view === b.dataset.refView && !b.dataset.forceRefresh) return;
        this.view = b.dataset.refView;
        await this.refreshDashboardAndPaint();
      });
    });
    this.container.querySelectorAll('[data-ref-copy]').forEach((b) => {
      if (b.dataset.bound === '1') return;
      b.dataset.bound = '1';
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.refCopy || ''); this.toast('Copied', 'success'); } catch (_) { this.toast('Copy failed', 'error'); }
      });
    });
    this.container.querySelectorAll('[data-ref-act]').forEach((b) => {
      if (b.dataset.bound === '1') return;
      b.dataset.bound = '1';
      b.addEventListener('click', () => this.onAgentAction(b.dataset.refAct, b.dataset));
    });
  },

  async refreshDashboardAndPaint() {
    const main = this.container?.querySelector('#ref-agent-main');
    if (main) main.innerHTML = '<p class="muted" style="padding:16px">Refreshing…</p>';
    const dash = await this.api(API.referralAgentDashboard(this.actor()), 'Could not refresh');
    if (dash && !dash.__error && dash.agent) this.data.dashboard = dash;
    this.renderShell();
  },

  async onAgentAction(act, ds = {}) {
    if (act === 'claim-wallet') {
      const btn = this.container.querySelector('[data-ref-act="claim-wallet"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
      const r = await this.api(API.referralClaimWallet(this.actor()), 'Could not claim');
      if (r?.__error) {
        this.toast(r.__error, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Claim my money'; }
        return;
      }
      this.data.dashboard = r;
      this.toast('Claim submitted — admin will pay to your bank account', 'success');
      this.view = 'payouts';
      this.renderShell();
      return;
    }
    if (act === 'open-payslip') {
      const id = parseInt(ds.id || ds.payoutItemId, 10);
      if (!id) return;
      const slip = await this.api(API.referralGetPayslip(id, this.actor()), 'Payslip unavailable');
      if (slip?.__error || !slip?.payslip_html) {
        this.toast(slip?.__error || 'Payslip not ready', 'error');
        return;
      }
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(slip.payslip_html);
        w.document.close();
      } else {
        Utils.showModal?.('Commission payslip', slip.payslip_html, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
      }
      return;
    }
    if (act === 'dismiss-notif' || act === 'open-notif') {
      const id = parseInt(ds.id, 10);
      if (!id) return;
      await window.ReferralNotify?.ack(id, act === 'open-notif' ? 'opened' : 'dismissed', { openApp: act === 'open-notif' });
      await this.refreshDashboardAndPaint();
      return;
    }
    if (act === 'dismiss-all-notif') {
      try {
        await API.referralAckAllNotifications({ audience: 'agent' }, this.actor());
      } catch (_) { /* ignore */ }
      window.ReferralNotify?.stop();
      window.ReferralNotify?.start(this.actor());
      this.toast('Notifications dismissed', 'success');
      await this.refreshDashboardAndPaint();
    }
  },

  keepAgentNavInView() {
    const nav = this.container.querySelector('#ref-agent-nav') || this.container.querySelector('.ref-agent-nav');
    if (!nav) return;
    const active = nav.querySelector(`[data-ref-view="${this.view}"]`) || nav.querySelector('.btn-primary');
    if (!active) return;
    try {
      const navRect = nav.getBoundingClientRect();
      const btnRect = active.getBoundingClientRect();
      if (btnRect.left < navRect.left + 4 || btnRect.right > navRect.right - 4) {
        active.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
      }
    } catch (_) {
      try { active.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (__) { /* */ }
    }
  },

  renderShellFast(body) {
    const shell = this.container.querySelector('.ref-agent-shell');
    const nav = this.container.querySelector('#ref-agent-nav');
    const main = this.container.querySelector('#ref-agent-main');
    if (!shell || !nav || !main) return false;
    const scrollLeft = nav.scrollLeft;
    nav.querySelectorAll('[data-ref-view]').forEach((b) => {
      const on = b.dataset.refView === this.view;
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-ghost', !on);
    });
    main.innerHTML = body;
    // Re-bind copy / claim actions on new main content only
    main.querySelectorAll('[data-ref-copy], [data-ref-act]').forEach((b) => {
      b.dataset.bound = '';
    });
    this.bindAgentNavAndActions();
    nav.scrollLeft = scrollLeft;
    requestAnimationFrame(() => {
      nav.scrollLeft = scrollLeft;
      this.keepAgentNavInView();
    });
    return true;
  },

  commissionSaleLabel(c) {
    if (c.entry_type === 'PAYSLIP') return this.esc(c.sale_id || 'Payslip');
    const awarded = Number(c.sale_id) < 0 || /admin\s*award|manual/i.test(String(c.notes || ''));
    if (awarded) {
      return `<strong>Admin awarded</strong>${c.notes ? `<div class="muted" style="font-size:11px">${this.esc(c.notes)}</div>` : ''}`;
    }
    return `#${this.esc(c.sale_id)}`;
  },

  viewHome(dash) {
    const k = dash.kpis || {};
    const w = dash.wallet || {};
    const agent = dash.agent || {};
    const pct = agent.commission_percent || dash.settings?.default_commission_percent || 5;
    return `
      <div class="ref-kpis">
        ${this.kpi('Customers Referred', k.customers_referred || 0)}
        ${this.kpi('Total Orders', k.total_orders || 0)}
        ${this.kpi('Sales Generated', this.money(k.sales_generated))}
        ${this.kpi('Total Commission', this.money(k.total_commission))}
      </div>
      <div class="ref-grid-2">
        <div>
          <div class="ref-panel"><div class="ref-panel-h"><h4>Your referral code</h4></div>
            <div class="ref-panel-b ref-copy-row">
              <span class="ref-code" style="font-size:22px">${this.esc(agent.referral_code || '—')}</span>
              <button type="button" class="btn btn-primary btn-sm" data-ref-copy="${this.esc(agent.referral_code || '')}">Copy</button>
            </div></div>
          <div class="ref-panel"><div class="ref-panel-h"><h4>Your referral link</h4></div>
            <div class="ref-panel-b ref-copy-row">
              <span class="ref-code" style="word-break:break-all">${this.esc(agent.referral_link || '')}</span>
              <button type="button" class="btn btn-primary btn-sm" data-ref-copy="${this.esc(agent.referral_link || '')}">Copy</button>
            </div></div>
          <div class="ref-panel"><div class="ref-panel-h"><h4>Wallet</h4></div>
            <div class="ref-panel-b">
              <p style="font-size:28px;font-weight:800;margin:0 0 8px">${this.money(w.available)}</p>
              <p class="muted" style="margin:0 0 10px">Available balance</p>
              <p>Total earned ${this.money(w.total_earned)} · Pending ${this.money(w.pending)}${w.pending_delivery ? ` · Awaiting delivery ${this.money(w.pending_delivery)}` : ''} · Paid ${this.money(w.paid)}</p>
            </div></div>
          <div class="ref-panel"><div class="ref-panel-h"><h4>Recent commissions</h4></div>
            <div class="ref-panel-b">${this.table(
              ['Date', 'Sale', 'Customer', 'Sale amt', 'Commission', 'Status', ''],
              (dash.recent_commissions || []).slice(0, 10).map((c) => {
                const awarded = Number(c.sale_id) < 0 || /admin\s*award|manual/i.test(String(c.notes || ''));
                return `<tr>
                <td>${this.esc(String(c.created_at || '').slice(0, 10))}</td>
                <td>${this.commissionSaleLabel(c)}</td>
                <td>${awarded ? 'Admin' : this.esc(c.customer_name || '—')}</td>
                <td>${c.entry_type === 'PAYSLIP' || awarded ? '—' : this.money(c.qualifying_amount)}</td>
                <td>${this.money(c.commission_amount)}${c.commission_percent && !awarded ? ` <small>(${this.esc(c.commission_percent)}%)</small>` : ''}</td>
                <td>${this.tag(c.status)}${awarded && c.notes ? `<div class="muted" style="font-size:11px;margin-top:2px">${this.esc(c.notes)}</div>` : ''}</td>
                <td>${c.entry_type === 'PAYSLIP' && c.payout_item_id
                  ? `<button type="button" class="btn btn-sm btn-primary" data-ref-act="open-payslip" data-id="${c.payout_item_id}">Payslip</button>`
                  : ''}</td>
              </tr>`;
              }).join(''),
              'No commissions yet'
            )}</div></div>
        </div>
        <div>
          <div class="ref-earn">
            <h4>Refer &amp; Earn</h4>
            <p>You earn <strong>${this.esc(pct)}%</strong>${agent.category_name ? ` (${this.esc(agent.category_name)})` : ''} on every qualifying purchase by customers you refer — including their future orders. Delivery orders pay only after successful delivery; cancelled, voided, or returned orders reverse commission.</p>
          </div>
          <div class="ref-panel" style="margin-top:14px"><div class="ref-panel-h"><h4>Performance</h4></div>
            <div class="ref-panel-b" style="text-align:center">
              <div style="font-size:42px;font-weight:800;color:var(--ref-accent)">${this.esc(k.conversion_rate || 0)}%</div>
              <p class="muted">Conversion rate</p>
            </div></div>
        </div>
      </div>`;
  },

  kpi(label, value) {
    return `<div class="ref-kpi"><span class="ref-kpi-label">${this.esc(label)}</span><span class="ref-kpi-value">${this.esc(value)}</span></div>`;
  },
  table(headers, rows, empty) {
    if (!rows) return `<div class="ref-empty">${this.esc(empty || 'None')}</div>`;
    return `<div class="table-wrap"><table class="ref-table"><thead><tr>${headers.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  },
  viewCode(dash) {
    const a = dash.agent || {};
    return `<div class="ref-panel"><div class="ref-panel-b" style="text-align:center">
      <p class="muted">Share this code at the till or online checkout</p>
      <p class="ref-code" style="font-size:36px;display:inline-block;margin:12px 0">${this.esc(a.referral_code || '')}</p>
      <div><button type="button" class="btn btn-primary" data-ref-copy="${this.esc(a.referral_code || '')}">Copy code</button></div>
    </div></div>`;
  },
  viewLink(dash) {
    const a = dash.agent || {};
    return `<div class="ref-panel"><div class="ref-panel-b">
      <p class="muted">Customers who open this link are attributed to you when they register or buy.</p>
      <p class="ref-code" style="word-break:break-all">${this.esc(a.referral_link || '')}</p>
      <button type="button" class="btn btn-primary" data-ref-copy="${this.esc(a.referral_link || '')}">Copy link</button>
    </div></div>`;
  },
  viewCustomers(dash) {
    return this.wrapPanel('My customers', this.table(
      ['Customer', 'Orders', 'Sales', 'Commission', 'Last order'],
      (dash.customers || []).map((c) => `<tr>
        <td>${this.esc(c.customer_name || ('#' + (c.customer_id || '—')))}</td>
        <td>${this.esc(c.orders || 0)}</td>
        <td>${this.money(c.sales)}</td>
        <td>${this.money(c.commission)}</td>
        <td>${this.esc(String(c.last_order_at || c.attributed_at || '').slice(0, 10))}</td>
      </tr>`).join(''),
      'No referred customers yet'
    ));
  },
  viewOrders(dash) {
    return this.wrapPanel('Orders from your referrals', this.table(
      ['Date', 'Sale', 'Customer', 'Sale amt', 'Commission', 'Status'],
      (dash.recent_commissions || []).filter((c) => c.entry_type !== 'PAYSLIP').map((c) => {
        const awarded = Number(c.sale_id) < 0 || /admin\s*award|manual/i.test(String(c.notes || ''));
        return `<tr>
        <td>${this.esc(String(c.created_at || '').slice(0, 16))}</td>
        <td>${this.commissionSaleLabel(c)}</td>
        <td>${awarded ? 'Admin' : this.esc(c.customer_name || '—')}</td>
        <td>${awarded ? '—' : this.money(c.qualifying_amount)}</td>
        <td>${this.money(c.commission_amount)}</td>
        <td>${this.tag(c.status)}${awarded && c.notes ? `<div class="muted" style="font-size:11px">${this.esc(c.notes)}</div>` : ''}</td>
      </tr>`;
      }).join(''),
      'No referral orders yet'
    ));
  },
  viewCommission(dash) {
    const k = dash.kpis || {};
    const w = dash.wallet || {};
    return `
      <div class="ref-kpis">
        ${this.kpi('Sales generated', this.money(k.sales_generated))}
        ${this.kpi('Total commission', this.money(k.total_commission))}
        ${this.kpi('Pending', this.money(w.pending))}
        ${this.kpi('Available', this.money(w.available))}
        ${this.kpi('Claimed (awaiting pay)', this.money(w.claimed))}
        ${this.kpi('Paid to date', this.money(w.paid))}
      </div>
      ${this.wrapPanel('Commission ledger & payslips', this.table(
        ['Date', 'Type', 'Detail', 'Amount', 'Status', ''],
        (dash.recent_commissions || []).map((c) => {
          const awarded = c.entry_type !== 'PAYSLIP' && (Number(c.sale_id) < 0 || /admin\s*award|manual/i.test(String(c.notes || '')));
          return `<tr>
          <td>${this.esc(String(c.created_at || '').slice(0, 16))}</td>
          <td>${c.entry_type === 'PAYSLIP' ? 'Payslip' : (awarded ? 'Admin award' : 'Commission')}</td>
          <td>${c.entry_type === 'PAYSLIP'
            ? this.esc(c.sale_id || 'Bank payout')
            : awarded
              ? `<strong>Admin awarded</strong>${c.notes ? `<div class="muted" style="font-size:11px">${this.esc(c.notes)}</div>` : ''}`
              : `#${this.esc(c.sale_id)} · ${this.esc(c.customer_name || '—')}`}</td>
          <td>${this.money(c.commission_amount)}</td>
          <td>${this.tag(c.status)}</td>
          <td>${c.entry_type === 'PAYSLIP' && c.payout_item_id
            ? `<button type="button" class="btn btn-sm btn-primary" data-ref-act="open-payslip" data-id="${c.payout_item_id}">View payslip</button>`
            : ''}</td>
        </tr>`;
        }).join(''),
        'No commission yet'
      ))}`;
  },
  viewWallet(dash) {
    const w = dash.wallet || {};
    const minEnabled = dash.minimum_payout_enabled !== false
      && dash.settings?.minimum_payout_enabled !== false
      && Number(dash.minimum_payout ?? dash.settings?.minimum_payout ?? 0) > 0;
    const minPay = minEnabled ? Number(dash.minimum_payout || dash.settings?.minimum_payout || 0) : 0;
    const avail = Number(w.available || 0);
    const canClaim = avail > 0 && avail >= minPay && !dash.open_claim;
    const bank = dash.bank || {};
    return `<div class="ref-kpis">
      ${this.kpi('Total earned', this.money(w.total_earned))}
      ${this.kpi('Pending', this.money(w.pending))}
      ${this.kpi('Available', this.money(w.available))}
      ${this.kpi('Claimed', this.money(w.claimed))}
      ${this.kpi('Paid to date', this.money(w.paid))}
    </div>
    <div class="ref-panel"><div class="ref-panel-h"><h4>Claim payout</h4></div>
      <div class="ref-panel-b">
        <p class="muted">Claim sends your available commission to admin. When they paste the bank payment reference, a payslip appears under Recent commissions and money is paid to your bank details.</p>
        <p><strong>Payout bank:</strong> ${this.esc(bank.bank_name || '—')} · ${this.esc(bank.account_holder || '')} · ${this.esc(bank.account_number || 'Add bank details')}</p>
        <p>Minimum claim: <strong>${minEnabled ? this.money(minPay) : 'None'}</strong></p>
        ${dash.open_claim
          ? `<div class="ref-note">Claim <strong>${this.esc(dash.open_claim.payout_number)}</strong> for ${this.money(dash.open_claim.amount)} is waiting for admin payment.</div>`
          : canClaim
            ? `<button type="button" class="btn btn-primary btn-lg" data-ref-act="claim-wallet">Claim my money · ${this.money(w.available)}</button>`
            : `<button type="button" class="btn btn-ghost" disabled>Claim my money</button>
               <p class="muted" style="margin-top:8px">${avail <= 0
                 ? 'Nothing available to claim right now.'
                 : (minEnabled && avail < minPay
                   ? `Available balance is below the minimum claim of ${this.money(minPay)}.`
                   : 'Nothing available to claim right now.')}</p>`}
      </div></div>`;
  },
  viewPayouts(dash) {
    return this.wrapPanel('Payouts & claims', this.table(
      ['Payout', 'Amount', 'Status', 'Paid at', ''],
      (dash.payouts || []).map((p) => `<tr>
        <td>${this.esc(p.payout_number)}${Number(p.claimed_by_agent) ? ' <small>(claim)</small>' : ''}</td>
        <td>${this.money(p.amount)}</td>
        <td>${this.tag(p.status || p.payout_status)}</td>
        <td>${this.esc(String(p.paid_at || '—').slice(0, 16))}</td>
        <td>${p.payslip_html && p.payout_item_id
          ? `<button type="button" class="btn btn-sm btn-primary" data-ref-act="open-payslip" data-id="${p.payout_item_id}">Payslip</button>`
          : ''}</td>
      </tr>`).join(''),
      'No payouts yet'
    ));
  },
  viewPerformance(dash) {
    const k = dash.kpis || {};
    return `<div class="ref-panel"><div class="ref-panel-b" style="text-align:center">
      <div style="font-size:56px;font-weight:800;color:var(--ref-accent)">${this.esc(k.conversion_rate || 0)}%</div>
      <p>Conversion rate</p>
      <p class="muted">${this.esc(k.customers_referred || 0)} customers · ${this.esc(k.total_orders || 0)} orders · ${this.money(k.sales_generated)} sales</p>
    </div></div>`;
  },
  viewNotes(dash) {
    const rows = dash.notifications || [];
    return this.wrapPanel('Notifications', rows.length
      ? `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px">${rows.map((n) => `
        <li style="border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:12px;background:${Number(n.is_read) ? 'transparent' : 'rgba(13,148,136,.08)'}">
          <strong>${this.esc(n.title)}</strong>
          <div style="margin:4px 0 8px">${this.esc(n.message)}</div>
          <small class="muted">${this.esc(String(n.created_at || '').slice(0, 16))}${Number(n.is_read) ? '' : ' · New'}</small>
          ${!Number(n.is_read) ? `<div style="margin-top:8px;display:flex;gap:8px">
            <button type="button" class="btn btn-ghost btn-sm" data-ref-act="dismiss-notif" data-id="${n.id}">Dismiss</button>
            <button type="button" class="btn btn-primary btn-sm" data-ref-act="open-notif" data-id="${n.id}">Open</button>
          </div>` : ''}
        </li>`).join('')}</ul>
        <div style="margin-top:12px"><button type="button" class="btn btn-ghost btn-sm" data-ref-act="dismiss-all-notif">Dismiss all</button></div>`
      : '<div class="ref-empty">No notifications</div>');
  },
  viewProfile(dash) {
    const a = dash.agent || {};
    return this.wrapPanel('My profile', `
      <p><strong>${this.esc(a.full_name)}</strong></p>
      <p>${this.esc(a.email || '')}</p>
      <p>${this.esc(a.phone || '')}</p>
      <p>Status ${this.tag(a.status)}</p>`);
  },
  viewBank(dash) {
    const b = dash.bank || {};
    return this.wrapPanel('Bank details (masked)', `
      <p>${this.esc(b.bank_name || '—')} · ${this.esc(b.account_holder || '')}</p>
      <p>Account ${this.esc(b.account_number || '—')} · ${this.esc(b.account_type || '')}</p>
      <div class="ref-note">To change bank details, submit a request — admin must approve before the next payout.</div>
      <div class="ref-form-grid">
        <div class="field"><label>Bank name</label><input id="ref-b-bank"></div>
        <div class="field"><label>Account holder</label><input id="ref-b-holder"></div>
        <div class="field"><label>Account number</label><input id="ref-b-acc"></div>
        <div class="field"><label>Branch code</label><input id="ref-b-branch"></div>
        <div class="field"><label>Account type</label>
          <select id="ref-b-type"><option value="cheque">Cheque</option><option value="savings">Savings</option></select></div>
      </div>
      <button type="button" class="btn btn-primary" id="ref-b-submit" style="margin-top:10px">Request bank change</button>`);
  },
  wrapPanel(title, body) {
    return `<div class="ref-panel"><div class="ref-panel-h"><h4>${this.esc(title)}</h4></div><div class="ref-panel-b">${body}</div></div>`;
  },

  async renderGate() {
    this.gateTab = this.gateTab || 'signin';
    this.applyShopBranding();
    const shop = this.shopName || this.app?.settings?.shop_name || 'Shop';
    const tab = this.gateTab;
    const tabBtn = (id, label) =>
      `<button type="button" class="btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}" data-ref-gate-tab="${id}">${label}</button>`;
    this.container.innerHTML = `<div class="ref-agent-shell ref-gate-shell">
      <div class="ref-gate-brand">
        <p class="muted ref-gate-shop">${this.esc(shop)}</p>
        <h2>Referral Agent</h2>
        <p class="muted ref-gate-sub">Register, sign in, and recover access on this portal.</p>
      </div>
      <div class="ref-gate-tabs">
        ${tabBtn('signin', 'Sign in')}
        ${tabBtn('register', 'Register')}
        ${tabBtn('recover', 'Forgot password')}
      </div>
      <div class="ref-panel"><div class="ref-panel-b" id="ref-gate-body"></div></div>
    </div>`;
    this.container.querySelectorAll('[data-ref-gate-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.gateTab = b.dataset.refGateTab;
        this.renderGate();
      });
    });
    const body = document.getElementById('ref-gate-body');
    if (!body) return;
    if (tab === 'register') {
      this.view = 'apply';
      return this.renderApply();
    }
    if (tab === 'recover') {
      const step = this.recoverStep || 'phone';
      if (step === 'code') {
        body.innerHTML = `
          <p class="muted" style="margin-top:0">1) Open WhatsApp and tap <strong>Send</strong> so the code arrives on your phone.<br>2) Enter that 6-digit code below, then choose a new password.</p>
          <p class="muted" style="font-size:12px">Code for ${this.esc(this.recoverPhoneMasked || 'your WhatsApp')}</p>
          ${this.recoverWhatsAppUrl ? `<button type="button" class="btn btn-primary btn-block" id="ref-rec-open-wa" style="margin-bottom:10px">Open WhatsApp code</button>` : ''}
          <div class="field"><label>Reset code</label><input id="ref-rec-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></div>
          <div class="field"><label>New password</label><input id="ref-rec-pass" type="password" autocomplete="new-password" minlength="6"></div>
          <div class="field"><label>Confirm new password</label><input id="ref-rec-pass2" type="password" autocomplete="new-password" minlength="6"></div>
          <p id="ref-rec-msg" class="muted hidden" style="margin-top:8px"></p>
          <p id="ref-rec-err" class="error-msg hidden"></p>
          <button type="button" class="btn btn-primary btn-lg btn-block" id="ref-rec-reset" style="margin-top:10px">Save new password</button>
          <button type="button" class="btn btn-ghost btn-block" id="ref-rec-resend" style="margin-top:8px">Resend / open WhatsApp again</button>
          <button type="button" class="btn btn-ghost btn-block" id="ref-rec-back-phone" style="margin-top:8px">Back</button>`;
        document.getElementById('ref-rec-reset')?.addEventListener('click', () => this.submitRecoverReset());
        document.getElementById('ref-rec-open-wa')?.addEventListener('click', () => this.openRecoverWhatsApp());
        document.getElementById('ref-rec-resend')?.addEventListener('click', () => this.submitRecover());
        document.getElementById('ref-rec-back-phone')?.addEventListener('click', () => {
          this.recoverStep = 'phone';
          this.renderGate();
        });
        return;
      }
      body.innerHTML = `
        <p class="muted" style="margin-top:0">Enter the WhatsApp / mobile number on your agent account. We prepare a 6-digit code — you open WhatsApp, send it to yourself, then enter the code and a new password.</p>
        <div class="field"><label>WhatsApp / mobile / username</label><input id="ref-rec-id" inputmode="tel" autocomplete="tel" placeholder="e.g. 06… or username AP"></div>
        <p id="ref-rec-msg" class="muted hidden" style="margin-top:8px"></p>
        <p id="ref-rec-err" class="error-msg hidden"></p>
        <button type="button" class="btn btn-primary btn-lg btn-block" id="ref-rec-submit" style="margin-top:10px">Get WhatsApp reset code</button>
        <p class="muted" style="font-size:12px;margin-top:12px;text-align:center">This link is for referral agents only — it is not the Admin login.</p>`;
      document.getElementById('ref-rec-submit')?.addEventListener('click', () => this.submitRecover());
      return;
    }
    body.innerHTML = `
      <div class="field"><label>Username</label><input id="ref-login-user" autocomplete="username" autofocus></div>
      <div class="field"><label>Password</label><input id="ref-login-pass" type="password" autocomplete="current-password"></div>
      <p id="ref-login-err" class="error-msg hidden"></p>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="ref-login-submit" style="margin-top:10px">Sign in</button>
      <p class="muted" style="font-size:12px;margin-top:12px;text-align:center">Approved agents only. After you sign in you can copy your code and shop link from your panel.</p>`;
    document.getElementById('ref-login-submit')?.addEventListener('click', () => this.submitLogin());
    document.getElementById('ref-login-pass')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitLogin();
    });
  },

  async submitLogin() {
    const err = document.getElementById('ref-login-err');
    const show = (m) => { if (err) { err.textContent = m; err.classList.remove('hidden'); } };
    err?.classList.add('hidden');
    const username = this.val('ref-login-user');
    const password = document.getElementById('ref-login-pass')?.value || '';
    if (!username || !password) return show('Enter username and password');
    const btn = document.getElementById('ref-login-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    try {
      if (!window.posAPI) {
        await new Promise((resolve) => {
          if (window.posAPI) return resolve();
          window.addEventListener('posAPIReady', resolve, { once: true });
          setTimeout(resolve, 1200);
        });
      }
      const result = await API.login(username, password, null);
      const user = result?.user || result?.data?.user;
      if (!result?.success || !user) {
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
        return show(result?.error || 'Invalid username or password');
      }
      if (user.role !== 'referral_agent') {
        try { await API.logout(); } catch (_) { /* ignore */ }
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
        return show('This portal is for Referral Agents only.');
      }
      if (typeof App !== 'undefined') {
        App.user = user;
        App.user.is_active = 1;
        try { window.OfflineStore?.saveSession?.(user, App.settings || null); } catch (_) { /* ignore */ }
      }
      this.app = typeof App !== 'undefined' ? App : this.app;
      this.view = 'home';
      this.toast(`Signed in as ${user.full_name || user.username}`, 'success');
      await this.render(this.container, this.app);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
      show(e?.message || 'Sign in failed');
    }
  },

  openRecoverWhatsApp() {
    const wa = this.recoverWhatsAppUrl;
    if (!wa) {
      this.toast('Request a reset code first', 'error');
      return;
    }
    try {
      if (typeof Utils?.openExternal === 'function') Utils.openExternal(wa);
      else window.open(wa, '_blank', 'noopener,noreferrer');
    } catch (_) {
      try { location.href = wa; } catch (__) { /* */ }
    }
  },

  async submitRecover() {
    const err = document.getElementById('ref-rec-err');
    const msg = document.getElementById('ref-rec-msg');
    const showErr = (m) => { if (err) { err.textContent = m; err.classList.remove('hidden'); } msg?.classList.add('hidden'); };
    err?.classList.add('hidden');
    const id = this.val('ref-rec-id') || this.recoverPhone || '';
    if (!id) return showErr('Enter your WhatsApp / mobile number');
    const btn = document.getElementById('ref-rec-submit') || document.getElementById('ref-rec-resend');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const r = await API.recoverReferralAgentPassword(id);
      if (btn) { btn.disabled = false; btn.textContent = btn.id === 'ref-rec-resend' ? 'Resend / open WhatsApp again' : 'Get WhatsApp reset code'; }
      if (!r || r.success === false) return showErr(r?.error || 'Recovery failed');
      const payload = (r.data && typeof r.data === 'object') ? { ...r, ...r.data } : r;
      this.recoverPhone = id;
      this.recoverPhoneMasked = payload.phone_masked || '';
      this.recoverWhatsAppUrl = payload.whatsapp_url || '';
      // Only advance when we actually have a WhatsApp link / masked phone (account found)
      if (!this.recoverWhatsAppUrl && !this.recoverPhoneMasked) {
        if (msg) {
          msg.textContent = payload.message || 'If we find your account, open WhatsApp from here after the next try.';
          msg.classList.remove('hidden');
        }
        this.toast(payload.message || 'Check the number and try again', 'info');
        return;
      }
      this.recoverStep = 'code';
      this.toast(payload.message || 'Open WhatsApp and tap Send to get your code', 'success');
      this.renderGate();
      // Open WhatsApp after paint so the button exists and the user sees the code flow
      setTimeout(() => this.openRecoverWhatsApp(), 120);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = btn.id === 'ref-rec-resend' ? 'Resend / open WhatsApp again' : 'Get WhatsApp reset code'; }
      showErr(e?.message || 'Recovery failed');
    }
  },

  async submitRecoverReset() {
    const err = document.getElementById('ref-rec-err');
    const msg = document.getElementById('ref-rec-msg');
    const showErr = (m) => { if (err) { err.textContent = m; err.classList.remove('hidden'); } msg?.classList.add('hidden'); };
    err?.classList.add('hidden');
    const code = this.val('ref-rec-code');
    const pass = document.getElementById('ref-rec-pass')?.value || '';
    const pass2 = document.getElementById('ref-rec-pass2')?.value || '';
    if (!code) return showErr('Enter the reset code from WhatsApp');
    if (pass.length < 6) return showErr('New password must be at least 6 characters');
    if (pass !== pass2) return showErr('Passwords do not match');
    const btn = document.getElementById('ref-rec-reset');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const r = await API.resetReferralAgentPassword({
        phone: this.recoverPhone,
        code,
        password: pass
      });
      if (btn) { btn.disabled = false; btn.textContent = 'Save new password'; }
      if (!r || r.success === false) return showErr(r?.error || 'Could not reset password');
      const username = r.username || r.data?.username || '';
      this.recoverStep = 'phone';
      this.gateTab = 'signin';
      this.toast(r.message || r.data?.message || 'Password updated — sign in now', 'success');
      await this.renderGate();
      if (username) {
        const u = document.getElementById('ref-login-user');
        if (u) u.value = username;
      }
      if (msg) {
        msg.textContent = username
          ? `Password saved. Sign in with username “${username}” and your new password.`
          : 'Password saved. Sign in with your username and new password.';
        msg.classList.remove('hidden');
      }
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save new password'; }
      showErr(e?.message || 'Could not reset password');
    }
  },

  agreementHtml() {
    return `<div class="ref-agree-box" id="ref-ap-agree-scroll">
      <h3>INDEPENDENT REFERRAL AGENT AGREEMENT &amp; PROGRAM RULES</h3>
      <p><strong>Chisanyama Connection</strong></p>
      <p>By registering as a Referral Agent and selecting “I Accept”, I confirm that I have read, understood and agreed to the following terms.</p>
      <h3>1. NATURE OF THE RELATIONSHIP</h3>
      <p>I understand that I am participating in the Chisanyama Connection Referral Program as an <strong>independent referral agent</strong>. I am not being employed by Chisanyama Connection merely because I participate. The program is based on referring customers and earning commission on qualifying transactions. Participation does not create an employment contract, partnership, joint venture, agency, franchise or entitlement to a salary. Nothing removes rights that may apply under South African law if the relationship is legally determined to be employment.</p>
      <h3>2. NO SALARY OR HOURLY WAGE</h3>
      <ul>
        <li>I do not receive a salary, hourly wage, or payment for time spent promoting.</li>
        <li>I am only eligible for commission on qualifying transactions.</li>
        <li>Commission is not guaranteed and is not earned merely by registering or advertising.</li>
      </ul>
      <h3>3. NO FIXED WORKING HOURS</h3>
      <p>I am not required to work fixed hours, clock in/out, work shifts, report for duty at the restaurant, or ask permission before promoting the business.</p>
      <h3>4. INDEPENDENCE</h3>
      <p>I decide how I conduct referral activities, provided I comply with the law and these rules. I am not under day-to-day supervision. Methods must be lawful, truthful and not damage the brand.</p>
      <h3>5. NO GUARANTEE OF WORK OR INCOME</h3>
      <p>There is no guarantee of customers, orders, commission, monthly income or referrals. Earnings depend on qualifying transactions I generate.</p>
      <h3>6. FREEDOM TO PARTICIPATE</h3>
      <p>Participation is voluntary. I may stop at any time subject to outstanding transactions, commissions, refunds, reversals and fraud investigations. Chisanyama Connection may suspend or terminate access under these rules.</p>
      <h3>7. OTHER BUSINESS ACTIVITIES</h3>
      <p>I remain free to conduct other business activities. Exclusive work for Chisanyama Connection is not required.</p>
      <h3>8. REFERRAL CODE</h3>
      <p>I will receive a unique referral code, link and/or QR code. I must not sell/transfer my code, share my account, create fake customers/orders, refer myself, manipulate the system, use fraudulent payments, misleading advertising, false promises, or claim to be an employee/official representative unless authorised.</p>
      <h3>9. CUSTOMER COMMUNICATION</h3>
      <p>I must communicate honestly and professionally. I may not promise unauthorised discounts, non-existent products, guaranteed delivery/refunds, special prices, or customer rewards unless authorised.</p>
      <h3>10. BRAND AND MARKETING</h3>
      <p>I may use approved materials for legitimate referrals. I must not change prices without permission, create misleading ads, use the brand unlawfully, publish offensive content, make false claims, or pretend to be a manager/employee/owner.</p>
      <h3>11. COMMISSION</h3>
      <p>Commission follows the agent’s approved referral level and program rules (e.g. Basic 5%, Silver 7%, Gold 10%, Special/Custom as configured). The percentage for a transaction is recorded when created; later level changes do not automatically change already recorded commissions.</p>
      <h3>12. COMMISSION IS NOT AUTOMATICALLY PAYABLE</h3>
      <p>A referral may start as <strong>PENDING</strong>. Commission may become payable only after conditions are met (paid, completed, not cancelled/refunded/fraudulent/reversed). Only <strong>APPROVED</strong> commissions may be paid out.</p>
      <h3>13. REFUNDS, CANCELLATIONS AND REVERSALS</h3>
      <p>If a commission-generating transaction is cancelled, refunded, reversed or fraudulent, commission may be cancelled or reversed. If already paid, the amount may be recorded as an adjustment or amount owing, subject to law.</p>
      <h3>14. FRAUD AND ABUSE</h3>
      <p>Prohibited: self-referrals, fake accounts/orders, duplicate accounts for commissions, fraudulent transactions, discount misuse, link manipulation, stolen payment info, artificial transactions. Commissions may be suspended during investigation.</p>
      <h3>15. ACCOUNT SECURITY</h3>
      <p>I must protect login details and code, notify Chisanyama Connection if compromised, and not allow unauthorised use of my account.</p>
      <h3>16. CUSTOMER DATA</h3>
      <p>I may only use customer information available through the program. I must not copy, sell, distribute or misuse it, and must follow privacy/data-protection rules.</p>
      <h3>17. PAYOUTS</h3>
      <p>Minimum payout is set by Chisanyama Connection. Typical flow: Approved Commission → Payout Request → Verification → Payment → PAID. Verification may be required.</p>
      <h3>18. TAX RESPONSIBILITY</h3>
      <p>I am responsible for my own tax obligations. Participation does not automatically determine tax status.</p>
      <h3>19. NO EMPLOYEE BENEFITS</h3>
      <p>Unless required by law because the relationship is employment, there is no entitlement to salary, leave, overtime, pension, medical, allowances or employee bonuses.</p>
      <h3>20. NO AUTHORITY TO BIND THE BUSINESS</h3>
      <p>I may not sign contracts, promise refunds, change prices, employ people, collect money (unless authorised), or represent myself as owner/manager/employee.</p>
      <h3>21. SUSPENSION OR TERMINATION</h3>
      <p>Participation may be suspended/terminated for fraud, abuse, misrepresentation, brand misuse, serious misconduct, manipulation, breach, illegal activity or security concerns. Legitimate approved commission remains subject to program rules and law.</p>
      <h3>22. CHANGES TO THE PROGRAM</h3>
      <p>Levels, rates, thresholds, rules and eligibility may change from the effective date communicated. Previously recorded transactions are not changed retrospectively except for error, fraud or reversal.</p>
      <h3>23. IMPORTANT ACKNOWLEDGEMENT</h3>
      <p>Calling myself an “independent referral agent” does not by itself determine legal status. South African law may consider the actual circumstances. The program is intended as an independent, performance-based referral arrangement without fixed employee duties or hours.</p>
      <h3>24. ACCEPTANCE</h3>
      <p>By selecting “I HAVE READ AND ACCEPT”, I confirm I have read and understand these rules, that commission is performance-based with no guaranteed salary or hours, that participation is voluntary, that I will not commit fraud, and that I agree to processing of information needed to administer my account. Digital acceptance and timestamp are recorded by the system.</p>
    </div>`;
  },

  async renderApply() {
    this.applyShopBranding();
    const shop = this.shopName || this.app?.settings?.shop_name || 'Shop';
    this.container.innerHTML = `<div class="ref-agent-shell ref-gate-shell" style="max-width:640px">
      <div class="ref-gate-brand">
        <div class="ref-brand-mark ref-brand-mark-logo ref-login-logo">
          <img src="/api/logo" alt="" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='flex')">
          <span class="ref-brand-fallback" style="display:none">RA</span>
        </div>
        <p class="muted ref-gate-shop">${this.esc(shop)}</p>
        <h2>Register as Referral Agent</h2>
        <p class="muted ref-gate-sub">Admin approval unlocks your earnings panel.</p>
      </div>
      <div class="ref-note">Applications start as <strong>PENDING_APPROVAL</strong>. After approval, sign in here to see earnings, your code, and your shop link.</div>
      <div class="ref-panel"><div class="ref-panel-b">
        <div class="ref-form-grid">
          <div class="field"><label>Full name *</label><input id="ref-ap-name"></div>
          <div class="field"><label>Mobile *</label><input id="ref-ap-phone"></div>
          <div class="field"><label>Email *</label><input id="ref-ap-email" type="email"></div>
          <div class="field"><label>Preferred contact</label>
            <select id="ref-ap-contact"><option value="whatsapp">WhatsApp</option><option value="phone">Phone</option><option value="email">Email</option></select></div>
          <div class="field full"><label>Address *</label><input id="ref-ap-addr"></div>
          <div class="field"><label>Username *</label><input id="ref-ap-user" autocomplete="username"></div>
          <div class="field"><label>Password * (min 6)</label><input id="ref-ap-pass" type="password" autocomplete="new-password"></div>
          <div class="field"><label>Bank name *</label><input id="ref-ap-bank"></div>
          <div class="field"><label>Account holder *</label><input id="ref-ap-holder"></div>
          <div class="field"><label>Account number *</label><input id="ref-ap-acc"></div>
          <div class="field"><label>Branch code *</label><input id="ref-ap-branch"></div>
          <div class="field"><label>Account type *</label>
            <select id="ref-ap-type"><option value="cheque">Cheque</option><option value="savings">Savings</option></select></div>
          <div class="field full"><label>Other payout info</label><input id="ref-ap-other"></div>
          <div class="field full">
            <label>Independent Referral Agent Agreement</label>
            ${this.agreementHtml()}
            <label style="display:flex;gap:8px;align-items:flex-start">
              <input type="checkbox" id="ref-ap-agree" style="margin-top:3px">
              <span><strong>I HAVE READ AND ACCEPT THE INDEPENDENT REFERRAL AGENT AGREEMENT</strong></span>
            </label>
          </div>
        </div>
        <p id="ref-ap-err" class="error-msg hidden"></p>
        <button type="button" class="btn btn-primary btn-lg btn-block" id="ref-ap-submit" style="margin-top:10px">Submit application</button>
        <button type="button" class="btn btn-ghost btn-block" id="ref-ap-back" style="margin-top:8px">Back to sign in</button>
      </div></div>
    </div>`;
    document.getElementById('ref-ap-back')?.addEventListener('click', () => {
      this.gateTab = 'signin';
      this.view = 'gate';
      this.renderGate();
    });
    document.getElementById('ref-ap-submit')?.addEventListener('click', () => this.submitApply());
  },

  async submitApply() {
    const err = document.getElementById('ref-ap-err');
    const show = (m) => { if (err) { err.textContent = m; err.classList.remove('hidden'); } };
    err?.classList.add('hidden');
    if (!this.val('ref-ap-name') || !this.val('ref-ap-phone')) return show('Name and mobile required');
    if (!this.val('ref-ap-email') || !this.val('ref-ap-addr')) return show('Email and address required');
    if (!this.val('ref-ap-user') || !this.val('ref-ap-pass')) return show('Username and password required');
    if ((this.val('ref-ap-pass') || '').length < 6) return show('Password must be at least 6 characters');
    if (!this.chk('ref-ap-agree')) return show('You must read and accept the Independent Referral Agent Agreement');
    if (!this.val('ref-ap-bank') || !this.val('ref-ap-holder') || !this.val('ref-ap-acc') || !this.val('ref-ap-branch')) return show('Complete bank details');
    const btn = document.getElementById('ref-ap-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    const r = await this.api(API.referralApply({
      full_name: this.val('ref-ap-name'),
      phone: this.val('ref-ap-phone'),
      email: this.val('ref-ap-email'),
      address: this.val('ref-ap-addr'),
      username: this.val('ref-ap-user') || null,
      password: this.val('ref-ap-pass') || null,
      preferred_contact: this.val('ref-ap-contact'),
      other_payout_info: this.val('ref-ap-other') || null,
      terms_accepted: 1,
      agreement_accepted: 1,
      bank: {
        bank_name: this.val('ref-ap-bank'),
        account_holder: this.val('ref-ap-holder'),
        account_number: this.val('ref-ap-acc'),
        account_type: this.val('ref-ap-type'),
        branch_code: this.val('ref-ap-branch')
      }
    }), 'Application failed');
    if (r?.__error) {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit application'; }
      return show(r.__error);
    }
    this.toast('Application submitted — pending approval', 'success');
    this.container.innerHTML = `<div class="ref-agent-shell" style="max-width:480px;margin:40px auto;text-align:center;padding:0 16px">
      <div class="ref-panel"><div class="ref-panel-b">
        <h3>Application received</h3>
        <p class="muted">Status: PENDING_APPROVAL. Come back to this same link to sign in once an admin approves you.</p>
        <button type="button" class="btn btn-primary" id="ref-done">Back to sign in</button>
      </div></div></div>`;
    document.getElementById('ref-done')?.addEventListener('click', () => {
      this.gateTab = 'signin';
      this.view = 'gate';
      this.renderGate();
    });
  },

  async submitBankChange() {
    const r = await this.api(API.referralRequestBankChange({
      bank: {
        bank_name: this.val('ref-b-bank'),
        account_holder: this.val('ref-b-holder'),
        account_number: this.val('ref-b-acc'),
        branch_code: this.val('ref-b-branch'),
        account_type: this.val('ref-b-type')
      }
    }, this.actor()), 'Request failed');
    if (r?.__error) return this.toast(r.__error, 'error');
    this.toast('Bank change requested — awaiting admin approval', 'success');
  }
};

// Re-bind bank submit when shell renders bank view
const _origShell = window.ReferralAgentApp.renderShell.bind(window.ReferralAgentApp);
window.ReferralAgentApp.renderShell = function () {
  _origShell();
  document.getElementById('ref-b-submit')?.addEventListener('click', () => this.submitBankChange());
};
