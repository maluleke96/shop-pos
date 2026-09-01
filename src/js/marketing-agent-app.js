/**
 * Referral Agent — mobile app for referral agents.
 * Apply, track referrals, watch the wallet grow, share codes and accept contracts.
 * Export: window.MarketingAgentApp (entry point: render(root, app))
 */
const MarketingAgentApp = {
  view: 'home',
  data: {},
  container: null,
  app: null,

  NAV: [
    ['home', 'Home'],
    ['referrals', 'Referrals'],
    ['earnings', 'Earnings'],
    ['share', 'Share'],
    ['promos', 'Promos'],
    ['contracts', 'Contracts']
  ],

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

  toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info');
    else console.log(msg);
  },

  async apiOk(promise, fallbackMsg) {
    let r;
    try {
      r = await promise;
    } catch (err) {
      return { __error: err?.message || fallbackMsg || 'Request failed' };
    }
    if (!r || r.success === false) {
      return { __error: (r && r.error) || fallbackMsg || 'Request failed' };
    }
    return r.data !== undefined ? r.data : r;
  },

  failed(v) {
    return !v || !!v.__error;
  },

  /* ─── Lifecycle used by app.js ────────────────────────────────────────── */

  async open(app, opts = {}) {
    this.app = app || this.app || (typeof App !== 'undefined' ? App : null);
    this.view = opts.view || 'home';
    const root = opts.container || document.getElementById('marketing-agent-root') || this.container;
    await this.render(root, this.app);
  },

  close() {
    this.exit();
  },

  isOpen() {
    if (!this.container?.isConnected) return false;
    const screen = document.getElementById('screen-marketing-agent');
    return !!screen && !screen.classList.contains('hidden');
  },

  /** Hardware/UI back: step home before leaving the app. Returns true when handled. */
  goBackInApp() {
    if (!this.isOpen()) return false;
    if (this.view && this.view !== 'home' && this.data.dashboard) {
      this.navigate('home');
      return true;
    }
    return false;
  },

  exit() {
    if (typeof App !== 'undefined' && typeof App.closeMarketingAgent === 'function') {
      App.closeMarketingAgent();
    } else if (typeof App !== 'undefined' && typeof App.navigate === 'function') {
      App.navigate('dashboard');
    }
  },

  async copy(text) {
    const str = String(text ?? '');
    try {
      await navigator.clipboard.writeText(str);
      this.toast('Copied', 'success');
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
      this.toast('Copied', 'success');
    } catch (_) {
      this.toast('Copy not available — select the text manually', 'error');
    }
  },

  val(id) {
    return (document.getElementById(id)?.value ?? '').trim();
  },

  chk(id) {
    return !!document.getElementById(id)?.checked;
  },

  statusTag(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      active: 'ok', approved: 'ok', accepted: 'ok', paid: 'ok', converted: 'ok', registered: 'info',
      pending: 'warn', sent: 'warn', payable: 'info', suspended: 'bad',
      rejected: 'bad', terminated: 'bad', expired: 'bad', reversed: 'bad', cancelled: 'bad', draft: 'muted'
    };
    return `<span class="mktp-tag ${map[s] || 'muted'}">${this.esc(status || '—')}</span>`;
  },

  /** Agreements the agent can still sign. */
  isSignable(contract) {
    return !['accepted', 'cancelled', 'terminated', 'expired'].includes(String(contract?.status || '').toLowerCase());
  },

  isAdminUser() {
    const role = String(this.actor()?.role || '').toLowerCase();
    return ['owner', 'manager', 'admin'].includes(role);
  },

  kpi(label, value, sub, cls) {
    return `<div class="mktp-kpi ${cls || ''}">
      <span class="mktp-kpi-label">${this.esc(label)}</span>
      <span class="mktp-kpi-value">${this.esc(value)}</span>
      ${sub ? `<span class="mktp-kpi-sub">${this.esc(sub)}</span>` : ''}
    </div>`;
  },

  panel(title, bodyHtml, actionsHtml) {
    return `<div class="mktp-panel">
      ${title ? `<div class="mktp-panel-h"><h4>${this.esc(title)}</h4>${actionsHtml || ''}</div>` : ''}
      <div class="mktp-panel-b">${bodyHtml}</div>
    </div>`;
  },

  empty(msg) {
    return `<div class="mktp-empty">${this.esc(msg)}</div>`;
  },

  /* ─── Entry point ─────────────────────────────────────────────────────── */

  async render(root, app) {
    this.container = root || this.container;
    this.app = app || this.app;
    if (!this.container) return;
    if (!this.NAV.some(([id]) => id === this.view)) this.view = 'home';

    if (!this.actor()) {
      await this.renderApply();
      return;
    }

    this.container.innerHTML = this.shellHtml('Loading…', '<p class="muted">Loading your dashboard…</p>', false);
    this.bindShell();

    const dash = await this.apiOk(API.mktpAgentDashboard(this.actor()), 'Could not load your dashboard');

    if (this.failed(dash) || !dash.agent) {
      const msg = dash?.__error || 'No referral agent profile is linked to this account';
      if (this.isAdminUser()) this.renderAdminNotice(msg);
      else this.renderNoAccess(msg);
      return;
    }

    this.data.dashboard = dash;
    this.renderShell();
  },

  /* ─── Shell ───────────────────────────────────────────────────────────── */

  shellHtml(subtitle, bodyHtml, withNav = true) {
    const user = this.actor();
    const name = user?.full_name || user?.username || 'Referral Agent';
    return `<div class="mktp-root" style="padding:12px;max-width:820px;margin:0 auto">
      <header style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div class="mktp-brand-mark" style="width:40px;height:40px;flex:0 0 40px;border-radius:12px;background:var(--mktp-accent,#0f766e);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">RA</div>
        <div style="min-width:0;flex:1">
          <strong style="display:block;font-size:14px;line-height:1.2">${this.esc(name)}</strong>
          <small class="muted" style="display:block;font-size:12px">${this.esc(subtitle)}</small>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="mkt-close">Close</button>
      </header>
      ${withNav ? `<nav id="mkt-nav" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;-webkit-overflow-scrolling:touch">
        ${this.NAV.map(([id, label]) => `<button type="button" class="btn btn-sm ${this.view === id ? 'btn-primary' : 'btn-ghost'}"
          data-mkt-view="${id}" style="flex:0 0 auto;border-radius:999px">${this.esc(label)}</button>`).join('')}
      </nav>` : ''}
      <main id="mkt-content">${bodyHtml}</main>
    </div>`;
  },

  bindShell() {
    document.getElementById('mkt-close')?.addEventListener('click', () => this.exit());
    this.container.querySelectorAll('[data-mkt-view]').forEach((btn) => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.mktView));
    });
    this.container.querySelectorAll('[data-mkt-copy]').forEach((btn) => {
      btn.addEventListener('click', () => this.copy(btn.dataset.mktCopy));
    });
    this.container.querySelectorAll('[data-mkt-accept]').forEach((btn) => {
      btn.addEventListener('click', () => this.acceptContract(btn.dataset.mktAccept));
    });
  },

  async navigate(view) {
    this.view = view || 'home';
    this.renderShell();
  },

  renderShell() {
    const dash = this.data.dashboard || {};
    const agent = dash.agent || {};
    const subtitle = `${agent.agent_code || 'Referral agent'}${agent.referral_code ? ` · ${agent.referral_code}` : ''} · ${agent.status || ''}`;
    const views = {
      home: () => this.viewHome(dash),
      referrals: () => this.viewReferrals(dash),
      earnings: () => this.viewEarnings(dash),
      share: () => this.viewShare(dash),
      promos: () => this.viewPromos(dash),
      contracts: () => this.viewContracts(dash)
    };
    const body = (views[this.view] || views.home)();
    this.container.innerHTML = this.shellHtml(subtitle, body, true);
    this.bindShell();
  },

  /* ─── Home ────────────────────────────────────────────────────────────── */

  viewHome(dash) {
    const agent = dash.agent || {};
    const w = dash.wallet || {};
    const stats = dash.stats || {};
    const recent = (dash.recent_commissions || []).slice(0, 6);
    const pendingContracts = (dash.contracts || []).filter((c) => this.isSignable(c));
    const rank = dash.rank;

    return `
      ${dash.is_admin_view ? '<div class="mktp-note">You are viewing this wallet as an administrator.</div>' : ''}
      ${agent.status && agent.status !== 'active' ? `<div class="mktp-note">Your account is <strong>${this.esc(agent.status)}</strong>. You can still see your history, but new commissions pause until it is active again.</div>` : ''}
      ${pendingContracts.length ? `<div class="mktp-note">You have ${pendingContracts.length} agreement(s) waiting to be signed. Open <strong>Contracts</strong> to review and accept.</div>` : ''}
      <div class="mktp-kpis">
        ${this.kpi('Available', this.money(w.available), 'Approved and payable', 'accent')}
        ${this.kpi('Awaiting approval', this.money(w.pending), 'Under review', 'warn')}
        ${this.kpi('Paid to you', this.money(w.paid), 'Settled', 'good')}
        ${this.kpi('Lifetime earned', this.money(w.lifetime), 'All time', 'slate')}
        ${this.kpi('Referrals this month', stats.referrals || 0, `${stats.conversion_rate || 0}% converted`)}
        ${this.kpi('Sales this month', this.money(stats.revenue), `${stats.orders || 0} orders`)}
      </div>
      ${rank ? `<div class="mktp-note">You are ranked <strong>#${this.esc(rank.position)}</strong> of ${this.esc(rank.of)} agents this month.</div>` : ''}
      ${this.panel('Your referral code', `
        <p style="font-size:26px;font-weight:800;letter-spacing:2px;margin:0 0 8px">
          <span class="mktp-code">${this.esc(agent.referral_code || 'Pending approval')}</span>
        </p>
        <p class="muted" style="margin:0 0 10px">Give this code at the till, or share your link. Every sale that uses it earns you commission.</p>
        <div class="mktp-rowbtns">
          ${agent.referral_code ? `<button type="button" class="btn btn-primary btn-sm" data-mkt-copy="${this.esc(agent.referral_code)}">Copy code</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-mkt-view="share">Share options</button>
        </div>`)}
      ${this.panel('Recent commissions', recent.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Sale</th><th>You earn</th><th>Status</th></tr></thead>
          <tbody>${recent.map((c) => `<tr>
            <td>${this.esc(String(c.sale_date || c.created_at || '').slice(0, 10))}</td>
            <td>${this.money(c.sale_amount)}${c.receipt_number ? `<br><small class="muted">${this.esc(c.receipt_number)}</small>` : ''}</td>
            <td><strong>${this.money(c.commission_amount)}</strong></td>
            <td>${this.statusTag(c.status)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
      : this.empty('No commissions yet — share your code to get started'),
      '<button type="button" class="btn btn-ghost btn-sm" data-mkt-view="earnings">See all</button>')}`;
  },

  /* ─── Referrals ───────────────────────────────────────────────────────── */

  viewReferrals(dash) {
    const rows = dash.recent_referrals || [];
    const stats = dash.stats || {};
    const converted = rows.filter((r) => String(r.status) === 'converted').length;
    return `
      <div class="mktp-kpis">
        ${this.kpi('Lifetime referrals', stats.lifetime_referrals ?? rows.length, 'Registered with your code', 'accent')}
        ${this.kpi('Converted', converted, 'Made a purchase', 'good')}
        ${this.kpi('Clicks this month', stats.clicks || 0, 'On your share link')}
      </div>
      ${this.panel('Your referrals', rows.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Customer</th><th>First order</th><th>Status</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${this.esc(String(r.created_at || '').slice(0, 10))}</td>
            <td>${this.esc(r.customer_name || (r.customer_id ? `Customer #${r.customer_id}` : r.referral_code || '—'))}</td>
            <td>${r.first_order_total ? this.money(r.first_order_total) : '—'}</td>
            <td>${this.statusTag(r.status)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
      : this.empty('No referrals yet — share your code and they will appear here'))}`;
  },

  /* ─── Earnings ────────────────────────────────────────────────────────── */

  viewEarnings(dash) {
    const w = dash.wallet || {};
    const rows = dash.recent_commissions || [];
    const payments = dash.payments || [];
    return `
      <div class="mktp-kpis">
        ${this.kpi('Awaiting approval', this.money(w.pending), 'Under review', 'warn')}
        ${this.kpi('Approved', this.money(w.approved), 'Being processed', 'info')}
        ${this.kpi('Ready to pay', this.money(w.payable), 'Next payout', 'accent')}
        ${this.kpi('Paid', this.money(w.paid), 'Already received', 'good')}
        ${this.kpi('Reversed', this.money(w.reversed), 'Refunds and cancellations', 'bad')}
        ${this.kpi('Lifetime', this.money(w.lifetime), 'Total earned', 'slate')}
      </div>
      <div class="mktp-note">Commissions start as pending, are approved by the business, then become payable and finally paid. Refunded sales are reversed.</div>
      ${this.panel('Commission history', rows.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Sale</th><th>Rate</th><th>You earn</th><th>Status</th></tr></thead>
          <tbody>${rows.map((c) => `<tr>
            <td>${this.esc(String(c.sale_date || c.created_at || '').slice(0, 10))}</td>
            <td>${this.money(c.sale_amount)}${c.campaign_name ? `<br><small class="muted">${this.esc(c.campaign_name)}</small>` : ''}</td>
            <td>${c.rate ? `${this.esc(c.rate)}%` : 'fixed'}</td>
            <td><strong>${this.money(c.commission_amount)}</strong></td>
            <td>${this.statusTag(c.status)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
      : this.empty('No commissions yet'))}
      ${this.panel('Payouts received', payments.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>${payments.map((p) => `<tr>
            <td>${this.esc(String(p.payment_date || p.created_at || '').slice(0, 10))}</td>
            <td><strong>${this.money(p.amount)}</strong> ${this.statusTag(p.status)}</td>
            <td>${this.esc(p.payment_method || '—')}</td>
            <td>${this.esc(p.reference || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
      : this.empty('No payouts yet'))}`;
  },

  /* ─── Share ───────────────────────────────────────────────────────────── */

  viewShare(dash) {
    const agent = dash.agent || {};
    const code = agent.referral_code || '';
    const link = agent.referral_link || '';
    const payload = typeof agent.qr_payload === 'string'
      ? agent.qr_payload
      : (agent.qr_payload ? JSON.stringify(agent.qr_payload) : (agent.qr ? JSON.stringify(agent.qr) : ''));
    if (!code) {
      return this.panel('Not yet active', this.empty('Your referral code appears here once your application is approved.'));
    }
    const message = agent.share_message
      || `Hi! Use my referral code ${code} at ${this.app?.settings?.shop_name || 'our shop'} and we both benefit.${link ? ` ${link}` : ''}`;
    const qrSrc = payload ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}` : '';
    return `
      ${this.panel('Referral code', `
        <p style="font-size:30px;font-weight:800;letter-spacing:3px;margin:0 0 10px">
          <span class="mktp-code">${this.esc(code)}</span>
        </p>
        <button type="button" class="btn btn-primary btn-sm" data-mkt-copy="${this.esc(code)}">Copy code</button>`)}
      ${this.panel('Share link', `
        <p><span class="mktp-code">${this.esc(link || 'No link issued')}</span></p>
        ${link ? `<button type="button" class="btn btn-primary btn-sm" data-mkt-copy="${this.esc(link)}">Copy link</button>` : ''}`)}
      ${this.panel('Ready-made message', `
        <p class="muted">${this.esc(message)}</p>
        <button type="button" class="btn btn-primary btn-sm" data-mkt-copy="${this.esc(message)}">Copy message</button>`)}
      ${this.panel('QR code', `
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
          ${qrSrc ? `<img src="${qrSrc}" alt="Referral QR code" class="mktp-qr-img" style="width:180px;height:180px"
            onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:200px">
            <p class="muted">Let customers scan this at the till, or print it on your flyers.</p>
            <p><small class="muted">${this.esc(payload || 'No QR payload issued')}</small></p>
            ${payload ? `<button type="button" class="btn btn-ghost btn-sm" data-mkt-copy="${this.esc(payload)}">Copy QR payload</button>` : ''}
          </div>
        </div>`)}`;
  },

  /* ─── Promotions ──────────────────────────────────────────────────────── */

  promoValue(p) {
    if (String(p.promo_type) === 'percent') return `${p.discount_value}% off`;
    if (String(p.promo_type) === 'bogo') return 'Buy one get one';
    return `${this.money(p.discount_value)} off`;
  },

  viewPromos(dash) {
    const promos = dash.active_promotions || [];
    const campaigns = dash.active_campaigns || [];
    const incentives = dash.incentives || [];
    return `
      <div class="mktp-note">These offers are live right now. Mention them when you refer someone — they convert best.</div>
      ${promos.length ? promos.map((p) => this.panel(p.name, `
        <p style="margin:0 0 8px">
          <span class="mktp-tag info">${this.esc(p.promo_type || 'offer')}</span>
          <strong style="margin-left:6px">${this.esc(this.promoValue(p))}</strong>
        </p>
        <p class="muted" style="margin:0 0 8px">
          ${p.start_date ? `Runs ${this.esc(p.start_date)}` : 'Running now'}${p.end_date ? ` until ${this.esc(p.end_date)}` : ''}.
        </p>
        <button type="button" class="btn btn-ghost btn-sm" data-mkt-copy="${this.esc(`${p.name} — ${this.promoValue(p)}${p.end_date ? `, until ${p.end_date}` : ''}`)}">Copy offer text</button>`
      )).join('') : this.panel('Promotions', this.empty('No active promotions right now — check back soon'))}
      ${campaigns.length ? this.panel('Campaigns running', `
        <div class="table-wrap"><table>
          <thead><tr><th>Campaign</th><th>Audience</th><th>Ends</th></tr></thead>
          <tbody>${campaigns.map((c) => `<tr>
            <td><strong>${this.esc(c.name)}</strong>${c.description ? `<br><small class="muted">${this.esc(c.description)}</small>` : ''}</td>
            <td>${this.esc(c.target_audience || 'Everyone')}</td>
            <td>${this.esc(c.end_date || 'Open')}</td>
          </tr>`).join('')}</tbody>
        </table></div>`) : ''}
      ${incentives.length ? this.panel('Bonuses you can win', `
        <div class="table-wrap"><table>
          <thead><tr><th>Incentive</th><th>Bonus</th><th>Ends</th></tr></thead>
          <tbody>${incentives.map((i) => `<tr>
            <td><strong>${this.esc(i.name)}</strong>${i.description ? `<br><small class="muted">${this.esc(i.description)}</small>` : ''}</td>
            <td>${this.money(i.bonus_amount)}</td>
            <td>${this.esc(i.end_date || 'Open')}</td>
          </tr>`).join('')}</tbody>
        </table></div>`) : ''}`;
  },

  /* ─── Contracts ───────────────────────────────────────────────────────── */

  viewContracts(dash) {
    const rows = dash.contracts || [];
    return `
      <div class="mktp-note">Your agreements with the business. Accepting records your digital signature and the date.</div>
      ${rows.length ? rows.map((c) => this.panel(c.title || 'Agreement', `
        <p style="margin:0 0 8px">${this.statusTag(c.status)}
          <small class="muted" style="margin-left:6px">Effective ${this.esc(c.effective_date || '—')}${c.accepted_at ? ` · accepted ${this.esc(String(c.accepted_at).slice(0, 10))}` : ''}</small>
        </p>
        ${c.commission_summary ? `<p class="muted" style="margin:0 0 8px">${this.esc(c.commission_summary)}</p>` : ''}
        <div style="border:1px solid var(--mktp-line,#e2e8f0);border-radius:10px;padding:12px;max-height:280px;overflow:auto;font-size:13px">
          ${c.body_html || '<p class="muted">This agreement has no content.</p>'}
        </div>
        ${this.isSignable(c)
          ? `<button type="button" class="btn btn-primary btn-sm" style="margin-top:10px" data-mkt-accept="${c.id}">Accept agreement</button>`
          : ''}`
      )).join('') : this.panel('Agreements', this.empty('No agreements yet — one is issued when your application is approved'))}`;
  },

  async acceptContract(id) {
    const agent = this.data.dashboard?.agent || {};
    const signature = {
      agent_id: agent.id,
      signature_data: `${agent.full_name || this.actor()?.full_name || 'Agent'} accepted on ${new Date().toLocaleString()}`
    };
    const r = await this.apiOk(API.mktpAcceptContract(parseInt(id, 10), signature, this.actor()), 'Could not accept the agreement');
    if (this.failed(r)) {
      this.toast(r?.__error || 'Could not accept the agreement', 'error');
      return;
    }
    this.toast('Agreement accepted', 'success');
    await this.render(this.container, this.app);
  },

  /* ─── Access notices ──────────────────────────────────────────────────── */

  renderAdminNotice(message) {
    const canJump = typeof App !== 'undefined' && !!App.user && !App._marketingFromLogin && typeof App.navigate === 'function';
    this.container.innerHTML = this.shellHtml('Administrator', `
      ${this.panel('Use the Marketing Command Centre', `
        <p class="muted">You are signed in as an owner or manager, so there is no agent wallet on this login.</p>
        <p class="muted">The Command Centre has the full picture: campaigns, promotions, agent approvals, commissions and payouts.</p>
        ${message ? `<p class="muted"><small>${this.esc(message)}</small></p>` : ''}
        <div class="mktp-rowbtns">
          ${canJump ? '<button type="button" class="btn btn-primary" id="mkt-goto-admin">Open Command Centre</button>' : ''}
          <button type="button" class="btn btn-ghost" id="mkt-close-2">Close</button>
        </div>
        ${canJump ? '' : '<p class="muted"><small>Sign in to the main POS and open Marketing to reach the Command Centre.</small></p>'}`)}`, false);
    this.bindShell();
    document.getElementById('mkt-close-2')?.addEventListener('click', () => this.exit());
    document.getElementById('mkt-goto-admin')?.addEventListener('click', async () => {
      if (window.MarketingFlyersPage) MarketingFlyersPage.shellTab = 'command';
      App.showScreen?.('app');
      await App.navigate('marketing');
    });
  },

  renderNoAccess(message) {
    this.container.innerHTML = this.shellHtml('No agent account', `
      ${this.panel('Referral agent access required', `
        <p class="muted">${this.esc(message)}</p>
        <p class="muted">If you have applied already, an owner or manager still needs to approve your application and link it to this login.</p>
        <div class="mktp-rowbtns">
          <button type="button" class="btn btn-primary" id="mkt-apply-now">Apply as a referral agent</button>
          <button type="button" class="btn btn-ghost" id="mkt-close-2">Close</button>
        </div>`)}`, false);
    this.bindShell();
    document.getElementById('mkt-close-2')?.addEventListener('click', () => this.exit());
    document.getElementById('mkt-apply-now')?.addEventListener('click', () => this.renderApply());
  },

  /* ─── Application form (no session) ───────────────────────────────────── */

  async renderApply(prefill = {}) {
    const shop = this.app?.settings?.shop_name || 'our business';
    this.container.innerHTML = this.shellHtml('Referral agent application', `
      <div class="mktp-note">Earn commission every time someone you refer buys from ${this.esc(shop)}. Apply below — approval usually takes a day or two.</div>
      ${this.panel('Your details', `
        <div class="form-grid">
          <div class="field"><label>Full name *</label><input id="mkt-ap-name" value="${this.esc(prefill.full_name || '')}"></div>
          <div class="field"><label>Mobile number *</label><input id="mkt-ap-phone" inputmode="tel" value="${this.esc(prefill.phone || '')}"></div>
          <div class="field"><label>Email</label><input id="mkt-ap-email" type="email" value="${this.esc(prefill.email || '')}"></div>
          <div class="field"><label>ID number</label><input id="mkt-ap-id" value="${this.esc(prefill.id_number || '')}"></div>
          <div class="field"><label>Bank name</label><input id="mkt-ap-bank" value=""></div>
          <div class="field"><label>Account number</label><input id="mkt-ap-acc" inputmode="numeric" value=""></div>
          <div class="field full"><label>Address</label><input id="mkt-ap-addr" value="${this.esc(prefill.address || '')}"></div>
          <div class="field full" id="mkt-ap-biz-wrap"></div>
        </div>
        <div class="field" style="margin-top:6px">
          <label style="display:flex;gap:8px;align-items:flex-start;font-weight:500">
            <input type="checkbox" id="mkt-ap-agree" style="margin-top:3px">
            <span>I accept the referral agent agreement: I will represent the business honestly, commission is paid only on completed sales, and refunded sales are reversed.</span>
          </label>
        </div>
        <p id="mkt-ap-err" class="error-msg hidden"></p>
        <button type="button" class="btn btn-primary btn-lg btn-block" id="mkt-ap-submit" style="margin-top:10px">Submit application</button>`)}
      ${this.panel('Already an agent?', `
        <p class="muted">Sign in on the main login screen with the username and password your manager gave you. Your wallet, referrals and agreements load automatically.</p>
        <button type="button" class="btn btn-ghost btn-block" id="mkt-close-2">Back to login</button>`)}`, false);

    this.bindShell();
    document.getElementById('mkt-close-2')?.addEventListener('click', () => this.exit());

    // Anonymous applicants have no session, so this lookup may be refused — the form still works,
    // and the backend falls back to the default business.
    const bizWrap = document.getElementById('mkt-ap-biz-wrap');
    const businesses = await this.apiOk(API.mktpBusinesses({}), 'Could not load businesses');
    if (bizWrap && Array.isArray(businesses) && businesses.length > 1) {
      bizWrap.innerHTML = `<label>Which business are you applying to?</label>
        <select id="mkt-ap-biz">${businesses.map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('')}</select>`;
    } else if (bizWrap && Array.isArray(businesses) && businesses.length === 1) {
      bizWrap.innerHTML = `<input type="hidden" id="mkt-ap-biz" value="${businesses[0].id}">`;
    }

    document.getElementById('mkt-ap-submit')?.addEventListener('click', () => this.submitApplication());
  },

  async submitApplication() {
    const err = document.getElementById('mkt-ap-err');
    const btn = document.getElementById('mkt-ap-submit');
    const show = (msg) => {
      if (!err) return;
      err.textContent = msg;
      err.classList.remove('hidden');
    };
    err?.classList.add('hidden');

    const full_name = this.val('mkt-ap-name');
    const phone = this.val('mkt-ap-phone');
    if (!full_name || !phone) return show('Your full name and mobile number are required');
    if (!this.chk('mkt-ap-agree')) return show('Please accept the referral agent agreement to apply');

    const bizVal = this.val('mkt-ap-biz');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting…';
    }
    try {
      const r = await this.apiOk(API.mktpApplyAgent({
        full_name,
        phone,
        email: this.val('mkt-ap-email') || null,
        id_number: this.val('mkt-ap-id') || null,
        address: this.val('mkt-ap-addr') || null,
        business_id: bizVal ? parseInt(bizVal, 10) : null,
        bank: { bank_name: this.val('mkt-ap-bank'), account_number: this.val('mkt-ap-acc') },
        agreement_accepted: 1
      }), 'Could not submit your application');
      if (this.failed(r)) return show(r?.__error || 'Could not submit your application');
      this.renderApplied(r);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit application';
      }
    }
  },

  renderApplied(agent) {
    this.container.innerHTML = this.shellHtml('Application received', `
      ${this.panel('Thank you — your application is in', `
        <p class="muted">We have received your application${agent?.full_name ? `, ${this.esc(agent.full_name)}` : ''}. An owner or manager will review it and set you up with a referral code.</p>
        <div class="mktp-kpis">
          ${this.kpi('Status', agent?.status || 'pending', 'Awaiting review', 'warn')}
          ${this.kpi('Applied', agent?.application_date || new Date().toLocaleDateString('en-CA'), 'Date received')}
        </div>
        <p class="muted">Once approved you will receive a referral code, a share link and a QR code. Sign in here with the login your manager creates to track your earnings.</p>
        <button type="button" class="btn btn-primary btn-block" id="mkt-close-2">Back to login</button>`)}`, false);
    this.bindShell();
    document.getElementById('mkt-close-2')?.addEventListener('click', () => this.exit());
  }
};

window.MarketingAgentApp = MarketingAgentApp;
