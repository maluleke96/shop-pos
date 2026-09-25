/**
 * Referral & Commission — Admin Command Centre department (new)
 */
window.AdminReferralPage = {
  section: 'dashboard',
  el: null,
  app: null,
  counts: { applications: 0, awardApprovals: 0 },

  NAV: [
    ['Overview', [['dashboard', 'Dashboard'], ['applications', 'Applications'], ['agents', 'Agents']]],
    ['Finance', [['award-approvals', 'Award Approvals'], ['commissions', 'Commissions'], ['wallets', 'Agent Wallets'], ['payouts', 'Payouts'], ['schedule', 'Payout Schedule'], ['rules', 'Commission Rules']]],
    ['Insights', [['customers', 'Referred Customers'], ['orders', 'Referral Orders'], ['reports', 'Reports'], ['fraud', 'Fraud & Risk'], ['audit', 'Audit Log']]],
    ['Admin', [['settings', 'Settings']]]
  ],

  actor() { return this.app?.user || (typeof App !== 'undefined' && App.user) || null; },
  canDirectAward() {
    const role = String(this.actor()?.role || '').toLowerCase();
    return role === 'owner' || role === 'admin' || role === 'assistant_manager';
  },
  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${(Number(n) || 0).toFixed(2)}`;
  },
  toast(msg, type) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info'); },
  async api(promise, errMsg) {
    let r;
    try { r = await promise; } catch (e) { this.toast(e?.message || errMsg || 'Request failed', 'error'); return null; }
    if (!r || r.success === false) { this.toast((r && r.error) || errMsg || 'Request failed', 'error'); return null; }
    return r.data !== undefined ? r.data : r;
  },
  tag(status) {
    const s = String(status || '').toUpperCase();
    const map = {
      APPROVED: 'ok', ACTIVE: 'ok', PAID: 'ok', AVAILABLE: 'ok',
      PENDING: 'warn', PENDING_APPROVAL: 'warn', PENDING_DELIVERY: 'info', UNDER_REVIEW: 'info',
      REJECTED: 'bad', SUSPENDED: 'bad', TERMINATED: 'bad', REVERSED: 'bad', DISABLED: 'muted', DRAFT: 'muted'
    };
    const cls = map[s] || (String(status).toLowerCase() === 'active' ? 'ok' : 'muted');
    return `<span class="ref-tag ${cls}">${this.esc(status || '—')}</span>`;
  },
  btn(label, act, ds = {}, cls = 'btn-ghost') {
    const data = Object.entries(ds).map(([k, v]) => `data-${k}="${this.esc(v)}"`).join(' ');
    return `<button type="button" class="btn btn-sm ${cls}" data-ref-act="${act}" ${data}>${this.esc(label)}</button>`;
  },
  kpi(label, value, sub, cls) {
    return `<div class="ref-kpi ${cls || ''}"><span class="ref-kpi-label">${this.esc(label)}</span>
      <span class="ref-kpi-value">${this.esc(value)}</span>
      ${sub ? `<span class="ref-kpi-sub">${this.esc(sub)}</span>` : ''}</div>`;
  },
  panel(title, body, actions) {
    return `<div class="ref-panel"><div class="ref-panel-h"><h4>${this.esc(title)}</h4>${actions || ''}</div>
      <div class="ref-panel-b">${body}</div></div>`;
  },
  table(headers, rowsHtml, empty) {
    if (!rowsHtml) return `<div class="ref-empty">${this.esc(empty || 'No records')}</div>`;
    return `<div class="table-wrap"><table class="ref-table"><thead><tr>${headers.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody></table></div>`;
  },

  ensureCss() {
    if (document.getElementById('ref-dept-css')) return;
    const l = document.createElement('link');
    l.id = 'ref-dept-css'; l.rel = 'stylesheet'; l.href = 'css/referral-dept.css';
    document.head.appendChild(l);
  },

  async render(el, app) {
    this.el = el;
    this.app = app || this.app;
    this.ensureCss();
    const shopName = this.app?.settings?.shop_name || this.app?.settings?.app_display_name || 'Shop';
    const standalone = !!(app?.standalone || this.app?.appMode?.() === 'referral-commission');
    // Text-only brand — no logo image (avoids double/overlapping marks with Admin or POS chrome)
    el.innerHTML = `<div class="ref-root ${standalone ? 'ref-standalone' : 'ref-embedded'}"><div class="ref-layout">
      <aside class="ref-sidebar">
        <div class="ref-brand ref-brand-text-only">
          <div class="ref-brand-text">
            <strong>${this.esc(shopName)}</strong>
            <small>Referral &amp; Commission</small>
          </div>
        </div>
        <nav id="ref-nav" class="ref-nav-scroll" aria-label="Referral & Commission menu"></nav>
        ${standalone ? `<div class="ref-sidebar-foot">
          <button type="button" class="btn btn-ghost btn-sm ref-sidebar-logout" id="ref-commission-logout">Sign out</button>
        </div>` : ''}
      </aside>
      <main class="ref-main">
        <div class="ref-topbar" id="ref-topbar"></div>
        <div id="ref-body"><p class="muted">Loading…</p></div>
      </main>
    </div></div>`;
    try {
      document.title = `${shopName} — Referral & Commission`;
    } catch (_) { /* ignore */ }
    if (standalone) {
      document.getElementById('ref-commission-logout')?.addEventListener('click', () => {
        if (typeof App !== 'undefined' && App.closeReferralCommission) App.closeReferralCommission();
        else if (typeof App !== 'undefined' && App.doLogout) App.doLogout();
      });
    }
    await this.refreshCounts();
    this.paintNav();
    this.bind();
    await this.renderSection();
  },

  paintNav() {
    const nav = document.getElementById('ref-nav');
    if (!nav) return;
    nav.innerHTML = this.NAV.map(([group, items]) => `
      <div class="ref-nav-group">${this.esc(group)}</div>
      ${items.map(([id, label]) => {
        const count = id === 'applications' ? this.counts.applications
          : (id === 'award-approvals' ? this.counts.awardApprovals : 0);
        return `<button type="button" class="ref-nav-btn ${this.section === id ? 'active' : ''}" data-ref-act="nav" data-section="${id}">
          <span>${this.esc(label)}</span>${count ? `<span class="ref-nav-count">${count}</span>` : ''}</button>`;
      }).join('')}`).join('');
  },

  async refreshCounts() {
    const actor = this.actor();
    const [apps, awards] = await Promise.all([
      this.api(API.referralApplications({}, actor), 'Could not load applications'),
      this.api(API.referralListAwardRequests({ status: 'PENDING' }, actor), 'Could not load award approvals')
    ]);
    this.counts.applications = Array.isArray(apps) ? apps.length : 0;
    this.counts.awardApprovals = Array.isArray(awards) ? awards.length : 0;
  },

  bind() {
    this.el?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-ref-act]');
      if (!btn) return;
      const act = btn.dataset.refAct;
      try {
        if (act === 'nav') {
          this.section = btn.dataset.section || 'dashboard';
          this.paintNav();
          await this.renderSection();
          return;
        }
        await this.handleAction(act, btn.dataset);
      } catch (err) {
        this.toast(err?.message || 'Action failed', 'error');
      }
    });
  },

  async renderSection() {
    const body = document.getElementById('ref-body');
    const top = document.getElementById('ref-topbar');
    if (!body) return;
    const titles = {
      dashboard: ['Referral & Commission', 'Manage agents, applications, commissions and payouts'],
      applications: ['Applications', 'Review and approve new referral agents'],
      agents: ['Agents', 'Approved and suspended referral agents'],
      'award-approvals': ['Award Approvals', 'Owner reviews staff award requests before agents are credited'],
      customers: ['Referred Customers', 'Permanent first-referrer attribution'],
      orders: ['Referral Orders', 'Sales that generated commission'],
      commissions: ['Commissions', 'Ledger of pending → approved → available → paid'],
      wallets: ['Agent Wallets', 'Balances calculated from the commission ledger'],
      payouts: ['Payouts', 'Generate, approve and mark batches as paid'],
      schedule: ['Payout Schedule', 'Frequency and minimum payout'],
      rules: ['Commission Rules', 'Default % and qualifying amount basis'],
      reports: ['Reports', 'Top agents and commission summary'],
      fraud: ['Fraud & Risk', 'Under-review items and suspended agents'],
      audit: ['Audit Log', 'Privileged referral actions'],
      settings: ['Settings', 'Commission %, POS referral, applications']
    };
    const [title, sub] = titles[this.section] || ['Referral', ''];
    if (top) top.innerHTML = `<h2>${this.esc(title)}</h2><p>${this.esc(sub)}</p>`;
    body.innerHTML = '<p class="muted">Loading…</p>';
    const map = {
      dashboard: 'viewDashboard', applications: 'viewApplications', agents: 'viewAgents',
      'award-approvals': 'viewAwardApprovals',
      codes: 'viewCodes', links: 'viewLinks', customers: 'viewCustomers', orders: 'viewOrders',
      commissions: 'viewCommissions', wallets: 'viewWallets', payouts: 'viewPayouts',
      schedule: 'viewSchedule', rules: 'viewRules', reports: 'viewReports',
      fraud: 'viewFraud', audit: 'viewAudit', settings: 'viewSettings'
    };
    const fn = this[map[this.section]] || this.viewDashboard;
    await fn.call(this, body);
  },

  async viewDashboard(el) {
    const d = await this.api(API.referralDashboard({}, this.actor()), 'Could not load dashboard');
    if (!d) { el.innerHTML = '<p class="error-msg">Could not load dashboard</p>'; return; }
    const k = d.kpis || {};
    el.innerHTML = `
      <div class="ref-kpis">
        ${this.kpi('Total Agents', k.total_agents || 0)}
        ${this.kpi('Pending Applications', k.pending_applications || 0, null, 'warn')}
        ${this.kpi('Award Approvals', k.pending_award_requests || 0, null, 'warn')}
        ${this.kpi('Active Agents', k.active_agents || 0, null, 'accent')}
        ${this.kpi('Customers Referred', k.customers_referred || 0)}
        ${this.kpi('Referral Sales', this.money(k.sales_generated))}
        ${this.kpi('Commission Generated', this.money(k.commission_generated))}
        ${this.kpi('Pending', this.money(k.commission_pending))}
        ${this.kpi('Available', this.money(k.commission_available))}
        ${this.kpi('Paid', this.money(k.commission_paid))}
      </div>
      <div class="ref-actions" style="margin-bottom:12px">
        ${this.btn('Review applications', 'nav', { section: 'applications' }, 'btn-primary')}
        ${this.btn('Award approvals', 'nav', { section: 'award-approvals' }, 'btn-success')}
        ${this.btn('Generate payout batch', 'gen-payout', {}, 'btn-success')}
        ${this.btn('Settings', 'nav', { section: 'settings' })}
      </div>
      <div class="ref-note" style="margin-bottom:14px">
        Referral agents use their <strong>own</strong> link (not Admin):
        <code style="user-select:all">${this.esc((typeof location !== 'undefined' ? location.origin : '') + '/referral-app.html')}</code>
        — register, sign in, and recover password there. Codes and shop links appear in the agent panel after approval.
      </div>
      <div class="ref-grid-2">
        ${this.panel('Recent Applications', this.table(
          ['ID', 'Name', 'Email', 'Mobile', 'Status', 'Applied', ''],
          (d.applications || []).map((a) => `<tr>
            <td>#${this.esc(a.id)}</td>
            <td><strong>${this.esc(a.full_name)}</strong></td>
            <td>${this.esc(a.email || '—')}</td>
            <td>${this.esc(a.phone || '—')}</td>
            <td>${this.tag(a.status)}</td>
            <td>${this.esc(String(a.created_at || '').slice(0, 16))}</td>
            <td>${this.btn('Review', 'review-agent', { id: a.id }, 'btn-primary')}</td>
          </tr>`).join(''),
          'No pending applications'
        ), this.btn('Open all', 'nav', { section: 'applications' }))}
        ${this.panel('Top Agents', this.table(
          ['#', 'Agent', 'Customers', 'Sales', 'Commission'],
          (d.top_agents || []).map((a) => `<tr>
            <td>${this.esc(a.rank)}</td>
            <td>${this.esc(a.full_name)}<br><span class="ref-code">${this.esc(a.referral_code || '')}</span></td>
            <td>${this.esc(a.customers || 0)}</td>
            <td>${this.money(a.sales)}</td>
            <td>${this.money(a.commission)}</td>
          </tr>`).join(''),
          'No agent sales yet'
        ))}
      </div>
      <div class="ref-grid-2">
        ${this.panel('Commission pipeline', `
          <div class="ref-chart-bars">
            ${[['Pending', k.commission_pending], ['Available', k.commission_available], ['Paid', k.commission_paid]]
              .map(([, v], i, arr) => {
                const max = Math.max(...arr.map((x) => Number(x[1]) || 0), 1);
                const h = Math.max(8, Math.round((Number(v) || 0) / max * 100));
                return `<span title="${this.esc(String(v))}" style="height:${h}%"></span>`;
              }).join('')}
          </div>
          <p class="muted" style="margin:10px 0 0;font-size:12px">Pending ${this.money(k.commission_pending)} · Available ${this.money(k.commission_available)} · Paid ${this.money(k.commission_paid)}</p>`)}
        ${this.panel('Payout schedule', `
          <p><strong>Frequency:</strong> ${this.esc(d.payout_schedule?.frequency || 'monthly')}</p>
          <p><strong>Payout day:</strong> ${this.esc(d.payout_schedule?.payout_day || 15)}</p>
          <p><strong>Minimum payout:</strong> ${d.payout_schedule?.minimum_payout_enabled === false || Number(d.payout_schedule?.minimum_payout) === 0
            ? 'None (cancelled)'
            : this.money(d.payout_schedule?.minimum_payout || 0)}</p>
          ${this.btn('Edit schedule', 'nav', { section: 'schedule' }, 'btn-primary')}`)}
      </div>`;
  },

  async viewApplications(el) {
    const rows = await this.api(API.referralApplications({}, this.actor()), 'Could not load') || [];
    el.innerHTML = this.panel('Applications', this.table(
      ['ID', 'Name', 'Email', 'Mobile', 'Status', 'Applied', ''],
      rows.map((a) => `<tr>
        <td>#${this.esc(a.id)}</td><td><strong>${this.esc(a.full_name)}</strong></td>
        <td>${this.esc(a.email || '—')}</td><td>${this.esc(a.phone || '—')}</td>
        <td>${this.tag(a.status)}</td><td>${this.esc(String(a.created_at || '').slice(0, 16))}</td>
        <td class="ref-actions">${this.btn('Review', 'review-agent', { id: a.id }, 'btn-primary')}
          ${this.btn('Approve', 'approve-agent', { id: a.id }, 'btn-success')}
          ${this.btn('Under review', 'under-review', { id: a.id })}
          ${this.btn('Reject', 'reject-agent', { id: a.id }, 'btn-danger')}</td>
      </tr>`).join(''),
      'No applications waiting'
    ));
  },

  async viewAgents(el) {
    const rows = await this.api(API.referralAgents({}, this.actor()), 'Could not load agents') || [];
    el.innerHTML = this.panel('Agents', this.table(
      ['Agent', 'Code', 'Status', 'Customers', 'Available', ''],
      rows.map((a) => `<tr>
        <td><strong>${this.esc(a.full_name)}</strong><br><small class="muted">${this.esc(a.email || a.phone || '')}</small></td>
        <td><span class="ref-code">${this.esc(a.referral_code || '—')}</span></td>
        <td>${this.tag(a.status)}</td>
        <td>${this.esc(a.customers_count || 0)}</td>
        <td>${this.money(a.wallet?.available)}</td>
        <td class="ref-actions" style="flex-wrap:wrap">
          ${this.btn('Open', 'review-agent', { id: a.id }, 'btn-primary')}
          ${this.btn('Edit', 'edit-agent', { id: a.id })}
          ${this.btn('Award', 'award-agent', { id: a.id }, 'btn-success')}
          ${a.status === 'APPROVED' ? this.btn('Suspend', 'suspend-agent', { id: a.id }, 'btn-warning') : ''}
          ${a.status === 'SUSPENDED' ? this.btn('Unsuspend', 'unsuspend-agent', { id: a.id }, 'btn-success') : ''}
          ${this.btn('Delete', 'delete-agent', { id: a.id }, 'btn-danger')}
        </td>
      </tr>`).join(''),
      'No agents yet'
    ));
  },

  async viewAwardApprovals(el) {
    const status = this._awardFilter || 'PENDING';
    const rows = await this.api(API.referralListAwardRequests({ status }, this.actor()), 'Could not load award requests') || [];
    const canDecide = this.canDirectAward();
    const filters = [
      ['PENDING', 'Pending'],
      ['ALL', 'All'],
      ['APPROVED', 'Approved'],
      ['REJECTED', 'Rejected']
    ].map(([id, label]) =>
      `<button type="button" class="btn btn-sm ${status === id ? 'btn-primary' : 'btn-ghost'}" data-ref-act="award-filter" data-status="${id}">${this.esc(label)}</button>`
    ).join(' ');
    el.innerHTML = `
      <div class="ref-actions" style="margin-bottom:12px">${filters}</div>
      ${!canDecide ? `<div class="ref-note" style="margin-bottom:12px">You can view award requests here. Only the owner/admin can approve, reject, or reduce them.</div>` : ''}
      ${this.panel('Award commission requests', this.table(
        ['ID', 'Agent', 'Requested', 'By', 'Note', 'Status', 'Reviewed', ''],
        rows.map((r) => {
          const pending = String(r.status) === 'PENDING';
          const reviewed = r.reviewed_at
            ? `${this.esc(String(r.reviewed_at).slice(0, 16))}${r.review_decision ? ` · ${this.esc(r.review_decision)}` : ''}${r.final_amount != null ? ` · ${this.money(r.final_amount)}` : ''}`
            : '—';
          const actions = pending
            ? `${this.btn('View', 'view-award-req', { id: r.id }, 'btn-primary')}
               ${canDecide ? this.btn('Approve', 'approve-award-req', { id: r.id }, 'btn-success') : ''}
               ${canDecide ? this.btn('Reduce', 'reduce-award-req', { id: r.id }, 'btn-warning') : ''}
               ${canDecide ? this.btn('Reject', 'reject-award-req', { id: r.id }, 'btn-danger') : ''}`
            : this.btn('View', 'view-award-req', { id: r.id });
          return `<tr>
            <td>#${this.esc(r.id)}</td>
            <td><strong>${this.esc(r.agent_name || `#${r.agent_id}`)}</strong><br><span class="ref-code">${this.esc(r.agent_code || '')}</span></td>
            <td>${this.money(r.requested_amount)}</td>
            <td>${this.esc(r.requested_by_name || '—')}<br><small class="muted">${this.esc(r.requested_by_role || '')}</small></td>
            <td>${this.esc(r.note || '—')}</td>
            <td>${this.tag(r.status)}</td>
            <td><small>${reviewed}${r.review_note ? `<br>${this.esc(r.review_note)}` : ''}</small></td>
            <td class="ref-actions" style="flex-wrap:wrap">${actions}</td>
          </tr>`;
        }).join(''),
        status === 'PENDING' ? 'No award requests waiting for approval' : 'No award requests'
      ))}`;
  },

  async viewCodes(el) {
    const rows = await this.api(API.referralCodes(this.actor()), 'Could not load codes') || [];
    el.innerHTML = this.panel('Referral codes', this.table(
      ['Code', 'Agent', 'Status', 'Uses', 'Commission %'],
      rows.map((c) => `<tr>
        <td><span class="ref-code">${this.esc(c.code)}</span></td>
        <td>${this.esc(c.agent_name)}</td>
        <td>${this.tag(c.status)}</td>
        <td>${this.esc(c.usage_count || 0)}${c.usage_limit != null ? ` / ${this.esc(c.usage_limit)}` : ''}</td>
        <td>${c.commission_percent != null ? this.esc(c.commission_percent) + '%' : 'Default'}</td>
      </tr>`).join(''),
      'No codes issued — approve an agent first'
    ));
  },

  async viewLinks(el) {
    const rows = (await this.api(API.referralAgents({ status: 'APPROVED' }, this.actor()), 'Could not load') || [])
      .filter((a) => a.referral_code);
    el.innerHTML = this.panel('Referral links', this.table(
      ['Agent', 'Code', 'Shop link', ''],
      rows.map((a) => {
        const link = a.referral_link || `${location.origin}/order/?ref=${encodeURIComponent(a.referral_code)}`;
        return `<tr>
          <td>${this.esc(a.full_name)}</td>
          <td><span class="ref-code">${this.esc(a.referral_code)}</span></td>
          <td><div class="mktp-truncate"><span class="ref-code" style="word-break:break-all">${this.esc(link)}</span></div></td>
          <td>${this.btn('Copy', 'copy', { text: link }, 'btn-primary')}</td>
        </tr>`;
      }).join(''),
      'No active links'
    ));
  },

  async viewCustomers(el) {
    const rows = await this.api(API.referralAttributions({}, this.actor()), 'Could not load') || [];
    el.innerHTML = this.panel('Referred customers', this.table(
      ['Customer', 'Agent', 'Code', 'Source', 'Attributed'],
      rows.map((r) => `<tr>
        <td>${this.esc(r.customer_name || ('#' + (r.customer_id || r.web_customer_id || '—')))}<br><small class="muted">${this.esc(r.customer_phone || '')}</small></td>
        <td>${this.esc(r.agent_name)} · <span class="ref-code">${this.esc(r.agent_code || '')}</span></td>
        <td><span class="ref-code">${this.esc(r.referral_code || '')}</span></td>
        <td>${this.esc(r.source || '—')}</td>
        <td>${this.esc(String(r.attributed_at || '').slice(0, 16))}</td>
      </tr>`).join(''),
      'No attributions yet'
    ));
  },

  async viewOrders(el) {
    const rows = await this.api(API.referralCommissions({}, this.actor()), 'Could not load') || [];
    el.innerHTML = this.panel('Referral orders / commissions', this.table(
      ['Sale', 'Agent', 'Code', 'Qualifying', 'Commission', 'Status', 'Date'],
      rows.map((c) => {
        const awarded = Number(c.sale_id) < 0 || /admin\s*award|manual/i.test(String(c.notes || ''));
        const saleCell = awarded
          ? `<strong>Admin awarded</strong>${c.notes ? `<div class="muted" style="font-size:11px">${this.esc(c.notes)}</div>` : ''}`
          : `#${this.esc(c.sale_id)}`;
        return `<tr>
        <td>${saleCell}</td>
        <td>${this.esc(c.agent_name)}</td>
        <td><span class="ref-code">${this.esc(c.referral_code || '')}</span></td>
        <td>${this.money(c.qualifying_amount)}</td>
        <td>${this.money(c.commission_amount)} <small class="muted">(${this.esc(c.commission_percent)}%)</small></td>
        <td>${this.tag(c.status)}</td>
        <td>${this.esc(String(c.created_at || '').slice(0, 16))}</td>
      </tr>`;
      }).join(''),
      'No referral orders yet'
    ));
  },

  async viewCommissions(el) {
    const rows = await this.api(API.referralCommissions({}, this.actor()), 'Could not load') || [];
    el.innerHTML = `
      <div class="ref-actions" style="margin-bottom:12px">
        ${this.btn('Mark approved → available', 'mark-available', {}, 'btn-primary')}
      </div>
      ${this.panel('Commission ledger', this.table(
        ['ID', 'Agent', 'Sale', 'Amount', 'Status', ''],
        rows.map((c) => {
          const awarded = Number(c.sale_id) < 0 || /admin\s*award|manual/i.test(String(c.notes || ''));
          const saleCell = awarded
            ? `<strong>Admin awarded</strong>${c.notes ? `<div class="muted" style="font-size:11px">${this.esc(c.notes)}</div>` : ''}`
            : `#${this.esc(c.sale_id)}`;
          return `<tr>
          <td>#${this.esc(c.id)}</td>
          <td>${this.esc(c.agent_name)}</td>
          <td>${saleCell}</td>
          <td>${this.money(c.commission_amount)}</td>
          <td>${this.tag(c.status)}</td>
          <td>${c.status === 'PENDING' || c.status === 'UNDER_REVIEW'
            ? this.btn('Approve', 'approve-comm', { id: c.id }, 'btn-success') : ''}</td>
        </tr>`;
        }).join(''),
        'No commissions'
      ))}`;
  },

  async viewWallets(el) {
    const agents = await this.api(API.referralAgents({ status: 'APPROVED' }, this.actor()), 'Could not load') || [];
    el.innerHTML = this.panel('Agent wallets', this.table(
      ['Agent', 'Total earned', 'Pending', 'Awaiting delivery', 'Available', 'Paid', 'Reversed'],
      agents.map((a) => {
        const w = a.wallet || {};
        return `<tr>
          <td>${this.esc(a.full_name)}</td>
          <td>${this.money(w.total_earned)}</td>
          <td>${this.money(w.pending)}</td>
          <td>${this.money(w.pending_delivery)}</td>
          <td><strong>${this.money(w.available)}</strong></td>
          <td>${this.money(w.paid)}</td>
          <td>${this.money(w.reversed)}</td>
        </tr>`;
      }).join(''),
      'No wallets'
    ));
  },

  async viewPayouts(el) {
    const rows = await this.api(API.referralPayouts({}, this.actor()), 'Could not load') || [];
    el.innerHTML = `
      <div class="ref-actions" style="margin-bottom:12px">${this.btn('Generate payout batch', 'gen-payout', {}, 'btn-success')}</div>
      <div class="ref-note" style="margin-bottom:12px">Agent wallet claims appear here as DRAFT payouts marked <strong>claim</strong>. When you paste the bank payment reference on <strong>Mark paid</strong>, a payslip is created for the agent under Recent commissions.</div>
      ${this.panel('Payout batches', this.table(
        ['Number', 'Total', 'Status', 'Paid at', ''],
        rows.map((p) => `<tr>
          <td><strong>${this.esc(p.payout_number)}</strong>${Number(p.claimed_by_agent) ? ' <span class="ref-tag warn">claim</span>' : ''}${p.notes ? `<div class="muted" style="font-size:11px">${this.esc(p.notes)}</div>` : ''}</td>
          <td>${this.money(p.total_amount)}</td>
          <td>${this.tag(p.status)}</td>
          <td>${this.esc(String(p.paid_at || '—').slice(0, 16))}</td>
          <td class="ref-actions">
            ${this.btn('Open', 'open-payout', { id: p.id }, 'btn-primary')}
            ${p.status === 'DRAFT' ? this.btn('Approve', 'approve-payout', { id: p.id }, 'btn-success') : ''}
            ${p.status !== 'PAID' ? this.btn('Mark paid', 'pay-payout', { id: p.id }, 'btn-success') : ''}
          </td>
        </tr>`).join(''),
        'No payouts yet'
      ))}`;
  },

  async viewSchedule(el) {
    const s = await this.api(API.referralSettings(this.actor()), 'Could not load settings') || {};
    const freq = String(s.payout_frequency || 'monthly').toLowerCase();
    const freqOpts = [
      ['daily', 'Every 1 day (daily)'],
      ['every_3_days', 'Every 3 days'],
      ['weekly', 'Weekly'],
      ['biweekly', 'Bi-weekly'],
      ['monthly', 'Monthly'],
      ['custom', 'Custom (write my own)']
    ];
    const minOn = s.minimum_payout_enabled !== false && Number(s.minimum_payout) > 0;
    el.innerHTML = this.panel('Payout schedule', `
      <div class="ref-form-grid">
        <div class="field"><label>Frequency</label>
          <select id="ref-pay-freq">
            ${freqOpts.map(([v, label]) => `<option value="${v}" ${freq === v ? 'selected' : ''}>${this.esc(label)}</option>`).join('')}
          </select>
          <p class="muted" style="margin:4px 0 0;font-size:12px">Choose a preset, or Custom to type your own schedule.</p>
        </div>
        <div class="field" id="ref-pay-freq-custom-wrap" style="${freq === 'custom' ? '' : 'display:none'}">
          <label>Custom frequency *</label>
          <input id="ref-pay-freq-custom" type="text" autocomplete="off" placeholder="e.g. Every 10 days, or end of each month"
            value="${this.esc(s.payout_frequency_custom || (freq === 'custom' ? s.payout_frequency_label : '') || '')}">
        </div>
        <div class="field"><label>Payout day</label>
          <input id="ref-pay-day" type="text" autocomplete="off" placeholder="e.g. 1, 15, Monday, or day 3"
            value="${this.esc(s.payout_day_text ?? s.payout_day ?? '')}">
          <p class="muted" style="margin:4px 0 0;font-size:12px">Type your own day — number or wording.</p>
        </div>
        <div class="field full">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">
            <input type="checkbox" id="ref-pay-min-on" ${minOn ? 'checked' : ''}>
            Use a minimum payout
          </label>
          <p class="muted" style="margin:4px 0 8px;font-size:12px">Uncheck to cancel the minimum — agents can claim any available balance.</p>
          <div id="ref-pay-min-wrap" style="${minOn ? '' : 'display:none'}">
            <label>Minimum payout amount</label>
            <input id="ref-pay-min" type="text" autocomplete="off" inputmode="decimal" placeholder="e.g. 50 or 100.00"
              value="${this.esc(minOn ? (s.minimum_payout ?? '') : '')}">
          </div>
        </div>
      </div>
      <div style="margin-top:12px">${this.btn('Save schedule', 'save-schedule', {}, 'btn-primary')}</div>`);
    const freqSel = document.getElementById('ref-pay-freq');
    const customWrap = document.getElementById('ref-pay-freq-custom-wrap');
    freqSel?.addEventListener('change', () => {
      if (customWrap) customWrap.style.display = freqSel.value === 'custom' ? '' : 'none';
    });
    const minOnEl = document.getElementById('ref-pay-min-on');
    const minWrap = document.getElementById('ref-pay-min-wrap');
    minOnEl?.addEventListener('change', () => {
      if (minWrap) minWrap.style.display = minOnEl.checked ? '' : 'none';
    });
  },

  async viewRules(el) {
    const s = await this.api(API.referralSettings(this.actor()), 'Could not load') || {};
    const cats = Array.isArray(s.commission_categories) ? s.commission_categories : [];
    const fixed = cats.filter((c) => !c.is_custom);
    const custom = cats.find((c) => c.is_custom) || { id: 'cat_custom', name: 'Custom', percent: null, is_custom: true };
    el.innerHTML = this.panel('Commission rules', `
      <div class="ref-note">Agents earn commission only on the discounted item amount. Delivery fees, tax and other charges are never included. Delivery orders hold commission until successfully delivered.</div>
      <div class="ref-form-grid">
        <div class="field"><label>Default commission %</label><input id="ref-rule-pct" type="number" step="0.01" min="0" value="${this.esc(s.default_commission_percent ?? 5)}"></div>
        <div class="field"><label>Qualifying amount</label>
          <select id="ref-rule-basis" disabled>
            <option value="after_discount_ex_delivery" selected>Discounted items only (excludes delivery)</option>
          </select>
          <p class="muted" style="margin:4px 0 0;font-size:12px">Locked: commission is always on item price after discounts (combos included), never delivery.</p>
        </div>
        <div class="field full"><label><input type="checkbox" id="ref-rule-auto" ${s.auto_approve_commissions ? 'checked' : ''}> Auto-approve commissions (after delivery when applicable)</label></div>
      </div>
      <h4 style="margin:20px 0 8px">Agent categories (4 tiers + custom)</h4>
      <p class="muted" style="margin:0 0 12px;font-size:13px">Auto mode: agent qualifies for a category when their successful referral sales reach the minimum. Manual: you assign the category on the agent. Custom uses the % you set on that agent.</p>
      <div class="table-wrap"><table class="table-compact"><thead>
        <tr><th>Category</th><th>Commission %</th><th>Qualify from sales (R)</th></tr>
      </thead><tbody>
        ${fixed.map((c, i) => `<tr data-cat-id="${this.esc(c.id)}">
          <td><input class="ref-cat-name" data-i="${i}" value="${this.esc(c.name || `Category ${i + 1}`)}"></td>
          <td><input class="ref-cat-pct" data-i="${i}" type="number" step="0.01" min="0" value="${this.esc(c.percent ?? '')}" style="width:90px"></td>
          <td><input class="ref-cat-min" data-i="${i}" type="number" step="0.01" min="0" value="${this.esc(c.min_sales ?? 0)}" style="width:120px"></td>
        </tr>`).join('')}
        <tr data-cat-id="${this.esc(custom.id || 'cat_custom')}" data-custom="1">
          <td><strong>Custom</strong> <span class="muted">(set % per agent)</span>
            <input type="hidden" class="ref-cat-name" data-i="custom" value="Custom">
          </td>
          <td class="muted">Per agent</td>
          <td class="muted">Assigned manually</td>
        </tr>
      </tbody></table></div>
      <div style="margin-top:12px">${this.btn('Save rules', 'save-rules', {}, 'btn-primary')}</div>`);
  },

  async viewReports(el) {
    const d = await this.api(API.referralDashboard({}, this.actor()), 'Could not load') || {};
    const k = d.kpis || {};
    el.innerHTML = `
      <div class="ref-kpis">
        ${this.kpi('Agents', k.total_agents || 0)}
        ${this.kpi('Active', k.active_agents || 0)}
        ${this.kpi('Customers', k.customers_referred || 0)}
        ${this.kpi('Orders', k.referral_orders || 0)}
        ${this.kpi('Sales', this.money(k.sales_generated))}
        ${this.kpi('Commission', this.money(k.commission_generated))}
      </div>
      ${this.panel('Top agents leaderboard', this.table(
        ['Rank', 'Agent', 'Customers', 'Orders', 'Sales', 'Commission'],
        (d.top_agents || []).map((a) => `<tr>
          <td>${this.esc(a.rank)}</td><td>${this.esc(a.full_name)}</td>
          <td>${this.esc(a.customers)}</td><td>${this.esc(a.orders)}</td>
          <td>${this.money(a.sales)}</td><td>${this.money(a.commission)}</td>
        </tr>`).join(''),
        'No data'
      ))}`;
  },

  async viewFraud(el) {
    const d = await this.api(API.referralFraud(this.actor()), 'Could not load') || {};
    el.innerHTML = `
      <div class="ref-note">${this.esc(d.notes || '')}</div>
      ${this.panel('Commissions under review', this.table(
        ['ID', 'Agent', 'Sale', 'Amount', 'Status'],
        (d.under_review || []).map((c) => `<tr>
          <td>#${this.esc(c.id)}</td><td>${this.esc(c.agent_id)}</td><td>#${this.esc(c.sale_id)}</td>
          <td>${this.money(c.commission_amount)}</td><td>${this.tag(c.status)}</td>
        </tr>`).join(''),
        'Nothing under review'
      ))}
      ${this.panel('Suspended agents', this.table(
        ['Agent', 'Phone', 'Email', 'Suspended'],
        (d.suspended_agents || []).map((a) => `<tr>
          <td>${this.esc(a.full_name)}</td><td>${this.esc(a.phone || '')}</td>
          <td>${this.esc(a.email || '')}</td><td>${this.esc(String(a.suspended_at || '').slice(0, 16))}</td>
        </tr>`).join(''),
        'None'
      ))}`;
  },

  async viewAudit(el) {
    const rows = await this.api(API.referralAudit({}, this.actor()), 'Could not load') || [];
    el.innerHTML = this.panel('Audit log', this.table(
      ['When', 'Who', 'Action', 'Entity'],
      rows.map((r) => `<tr>
        <td>${this.esc(String(r.created_at || '').slice(0, 16))}</td>
        <td>${this.esc(r.actor_name || '—')}</td>
        <td>${this.esc(String(r.action || '').replace(/_/g, ' '))}</td>
        <td>${this.esc(r.entity_type || '')} #${this.esc(r.entity_id || '')}</td>
      </tr>`).join(''),
      'No audit entries'
    ));
  },

  async viewSettings(el) {
    const s = await this.api(API.referralSettings(this.actor()), 'Could not load') || {};
    el.innerHTML = this.panel('Settings', `
      <div class="ref-form-grid">
        <div class="field"><label>Default commission %</label><input id="ref-set-pct" type="number" step="0.01" value="${this.esc(s.default_commission_percent ?? 5)}"></div>
        <div class="field"><label>Commission basis</label>
          <select id="ref-set-basis">
            <option value="after_discount_ex_delivery" ${s.commission_basis === 'after_discount_ex_delivery' ? 'selected' : ''}>After discount, exclude delivery</option>
            <option value="total" ${s.commission_basis === 'total' ? 'selected' : ''}>Order total</option>
          </select></div>
        <div class="field"><label><input type="checkbox" id="ref-set-apply" ${s.public_apply_enabled !== false ? 'checked' : ''}> Public applications enabled</label></div>
        <div class="field"><label><input type="checkbox" id="ref-set-pos" ${s.pos_referral_enabled !== false ? 'checked' : ''}> Allow referral codes on POS</label></div>
        <div class="field"><label><input type="checkbox" id="ref-set-auto" ${s.auto_approve_commissions ? 'checked' : ''}> Auto-approve commissions</label></div>
      </div>
      <div class="ref-note" style="margin-top:16px">
        <strong>Phone notification sounds</strong><br>
        Demo tones play until you upload your own. Upload custom sounds for <strong>Referral Agent</strong> and <strong>Referral Commission</strong> under Admin → Security → Per-panel notification sounds. After upload, the demo tone stops for everyone receiving those alerts.
      </div>
      <div id="ref-commission-sound-toggle" style="margin-top:12px"></div>
      <div style="margin-top:12px">${this.btn('Save settings', 'save-settings', {}, 'btn-primary')}</div>`);
    const host = el.querySelector('#ref-commission-sound-toggle');
    if (host && window.PanelNotify) {
      host.innerHTML = PanelNotify.soundToggleHtml('referral-commission', {
        id: 'ref-comm-sound',
        label: 'Play Referral Commission notification sounds on this device'
      });
      PanelNotify.bindSoundToggle(host.querySelector('#ref-comm-sound'), 'referral-commission');
    }
  },

  async handleAction(act, ds) {
    const actor = this.actor();
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(ds.text || ''); this.toast('Copied', 'success'); } catch (_) { this.toast('Copy failed', 'error'); }
      return;
    }
    if (act === 'approve-agent') {
      await this.api(API.referralApproveAgent(parseInt(ds.id, 10), actor, {}), 'Approve failed');
      this.toast('Agent approved', 'success');
      await this.refreshCounts(); this.paintNav(); await this.renderSection();
      return;
    }
    if (act === 'reject-agent') {
      const reason = prompt('Rejection reason?') || 'Rejected';
      await this.api(API.referralRejectAgent(parseInt(ds.id, 10), reason, actor), 'Reject failed');
      this.toast('Application rejected', 'success');
      await this.refreshCounts(); this.paintNav(); await this.renderSection();
      return;
    }
    if (act === 'under-review') {
      await this.api(API.referralUnderReview(parseInt(ds.id, 10), actor), 'Failed');
      this.toast('Marked under review', 'success');
      await this.renderSection();
      return;
    }
    if (act === 'suspend-agent') {
      if (!confirm('Suspend this agent? They will not be able to log in.')) return;
      await this.api(API.referralSuspendAgent(parseInt(ds.id, 10), actor), 'Failed');
      this.toast('Agent suspended', 'success');
      await this.renderSection();
      return;
    }
    if (act === 'unsuspend-agent') {
      await this.api(API.referralUnsuspendAgent(parseInt(ds.id, 10), actor), 'Failed');
      this.toast('Agent unsuspended', 'success');
      await this.renderSection();
      return;
    }
    if (act === 'delete-agent') {
      if (!confirm('Permanently delete this agent? They will be fully removed — customers and unpaid orders will no longer sit under them. Paid commission history is kept for audit.')) return;
      await this.api(API.referralDeleteAgent(parseInt(ds.id, 10), actor), 'Failed');
      this.toast('Agent deleted and unlinked', 'success');
      await this.renderSection();
      return;
    }
    if (act === 'award-agent') {
      await this.showAwardModal(parseInt(ds.id, 10));
      return;
    }
    if (act === 'award-filter') {
      this._awardFilter = ds.status || 'PENDING';
      await this.renderSection();
      return;
    }
    if (act === 'view-award-req') {
      await this.showAwardRequestModal(parseInt(ds.id, 10));
      return;
    }
    if (act === 'approve-award-req') {
      await this.decideAwardRequest(parseInt(ds.id, 10), 'approve');
      return;
    }
    if (act === 'reject-award-req') {
      await this.decideAwardRequest(parseInt(ds.id, 10), 'reject');
      return;
    }
    if (act === 'reduce-award-req') {
      await this.decideAwardRequest(parseInt(ds.id, 10), 'reduce');
      return;
    }
    if (act === 'edit-agent') {
      await this.showEditAgentModal(parseInt(ds.id, 10));
      return;
    }
    if (act === 'review-agent') {
      const a = await this.api(API.referralGetAgent(parseInt(ds.id, 10), actor, { revealBank: false }), 'Could not load agent');
      if (!a) return;
      const bank = a.bank || {};
      const w = a.wallet || {};
      Utils.showModal(`Agent · ${a.full_name}`, `
        <div class="ref-agent-detail-pro">
          <div class="ref-detail-hero">
            <div style="flex:1;min-width:180px">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
                ${this.tag(a.status)}
                <span class="ref-code">${this.esc(a.referral_code || '—')}</span>
              </div>
              <h3 style="margin:0 0 4px;font-size:20px">${this.esc(a.full_name || '—')}</h3>
              <p class="muted" style="margin:0">Username <strong>${this.esc(a.username || '—')}</strong>
                · Login ${a.user_id ? 'linked' : 'not linked'}</p>
            </div>
            <div style="text-align:right;min-width:120px">
              <div class="muted" style="font-size:11px">Available wallet</div>
              <div style="font-size:22px;font-weight:800">${this.money(w.available)}</div>
              <div class="muted" style="font-size:11px;margin-top:4px">Pending ${this.money(w.pending)}</div>
            </div>
          </div>
          <div class="ref-detail-section">
            <h4>Contact</h4>
            <div class="ref-detail-grid">
              <div class="ref-detail-item"><label>Email</label><strong>${this.esc(a.email || '—')}</strong></div>
              <div class="ref-detail-item"><label>Mobile / WhatsApp</label><strong>${this.esc(a.phone || '—')}</strong></div>
              <div class="ref-detail-item"><label>Preferred contact</label><strong>${this.esc(a.preferred_contact || '—')}</strong></div>
              <div class="ref-detail-item"><label>Commission %</label><strong>${this.esc(a.commission_percent ?? 'default')}</strong></div>
              <div class="ref-detail-item" style="grid-column:1/-1"><label>Address</label><strong>${this.esc(a.address || '—')}</strong></div>
              <div class="ref-detail-item" style="grid-column:1/-1"><label>Referral link</label>
                <strong class="ref-code" style="font-size:12px">${this.esc(a.referral_link || '')}</strong>
                ${a.referral_link ? `<button type="button" class="btn btn-ghost btn-sm" id="ref-m-copy-link" style="margin-top:6px">Copy link</button>` : ''}
              </div>
            </div>
          </div>
          <div class="ref-detail-section">
            <h4>Banking</h4>
            <div class="ref-detail-grid">
              <div class="ref-detail-item"><label>Bank</label><strong>${this.esc(bank.bank_name || '—')}</strong></div>
              <div class="ref-detail-item"><label>Account holder</label><strong>${this.esc(bank.account_holder || '—')}</strong></div>
              <div class="ref-detail-item"><label>Account</label><strong>${this.esc(bank.account_number || '—')}</strong></div>
              <div class="ref-detail-item"><label>Type / Branch</label><strong>${this.esc(bank.account_type || '—')} · ${this.esc(bank.branch_code || '—')}</strong></div>
            </div>
          </div>
          <div class="ref-detail-section">
            <h4>Performance</h4>
            <div class="ref-detail-grid">
              <div class="ref-detail-item"><label>Customers</label><strong>${this.esc(a.customers_count || 0)}</strong></div>
              <div class="ref-detail-item"><label>Orders</label><strong>${this.esc(a.orders_count || 0)}</strong></div>
              <div class="ref-detail-item"><label>Sales</label><strong>${this.money(a.sales_total)}</strong></div>
              <div class="ref-detail-item"><label>Wallet paid</label><strong>${this.money(w.paid)}</strong></div>
              <div class="ref-detail-item"><label>Applied</label><strong>${this.esc(String(a.created_at || '').slice(0, 16))}</strong></div>
              <div class="ref-detail-item"><label>Approved</label><strong>${this.esc(String(a.approved_at || '—').slice(0, 16))}</strong></div>
            </div>
          </div>
        </div>
        <div class="ref-actions" style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px">
          ${a.status === 'PENDING_APPROVAL' || a.status === 'UNDER_REVIEW' ? `
            <button type="button" class="btn btn-success" id="ref-m-approve">Approve Agent</button>
            <button type="button" class="btn btn-ghost" id="ref-m-review">Under Review</button>
            <button type="button" class="btn btn-danger" id="ref-m-reject">Reject</button>` : ''}
          ${a.status === 'APPROVED' ? `
            <button type="button" class="btn btn-primary" id="ref-m-reset-pw">Reset password (WhatsApp)</button>
            <button type="button" class="btn btn-ghost" id="ref-m-fix-login">Fix login account</button>
            <button type="button" class="btn btn-success" id="ref-m-award">Award commission</button>
            <button type="button" class="btn btn-ghost" id="ref-m-edit">Edit details</button>
            <button type="button" class="btn btn-warning" id="ref-m-suspend">Suspend</button>` : ''}
          ${a.status === 'SUSPENDED' ? `
            <button type="button" class="btn btn-success" id="ref-m-unsuspend">Unsuspend</button>
            <button type="button" class="btn btn-success" id="ref-m-award">Award commission</button>
            <button type="button" class="btn btn-ghost" id="ref-m-edit">Edit details</button>` : ''}
          ${['APPROVED', 'SUSPENDED', 'PENDING_APPROVAL', 'UNDER_REVIEW', 'REJECTED'].includes(a.status) ? `
            <button type="button" class="btn btn-danger" id="ref-m-delete">Delete account</button>` : ''}
          <button type="button" class="btn btn-ghost" id="ref-m-reveal">Reveal bank (owner)</button>
          <button type="button" class="btn btn-ghost" id="ref-m-close">Close</button>
        </div>`, '');
      document.getElementById('ref-m-copy-link')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(a.referral_link || ''); this.toast('Link copied', 'success'); } catch (_) { this.toast('Copy failed', 'error'); }
      });
      document.getElementById('ref-m-close')?.addEventListener('click', () => Utils.hideModal?.());
      document.getElementById('ref-m-approve')?.addEventListener('click', async () => {
        await this.api(API.referralApproveAgent(a.id, actor, {}), 'Failed');
        Utils.hideModal?.(); this.toast('Approved', 'success');
        await this.refreshCounts(); this.paintNav(); await this.renderSection();
      });
      document.getElementById('ref-m-reject')?.addEventListener('click', async () => {
        const reason = prompt('Reason?') || 'Rejected';
        await this.api(API.referralRejectAgent(a.id, reason, actor), 'Failed');
        Utils.hideModal?.(); await this.renderSection();
      });
      document.getElementById('ref-m-review')?.addEventListener('click', async () => {
        await this.api(API.referralUnderReview(a.id, actor), 'Failed');
        Utils.hideModal?.(); await this.renderSection();
      });
      document.getElementById('ref-m-suspend')?.addEventListener('click', async () => {
        if (!confirm('Suspend this agent? They will not be able to log in.')) return;
        await this.api(API.referralSuspendAgent(a.id, actor), 'Failed');
        Utils.hideModal?.(); await this.renderSection();
      });
      document.getElementById('ref-m-unsuspend')?.addEventListener('click', async () => {
        await this.api(API.referralUnsuspendAgent(a.id, actor), 'Failed');
        Utils.hideModal?.(); this.toast('Unsuspended', 'success'); await this.renderSection();
      });
      document.getElementById('ref-m-delete')?.addEventListener('click', async () => {
        if (!confirm('Delete this agent account permanently? They cannot sign in again.')) return;
        await this.api(API.referralDeleteAgent(a.id, actor), 'Failed');
        Utils.hideModal?.(); this.toast('Deleted', 'success'); await this.renderSection();
      });
      document.getElementById('ref-m-award')?.addEventListener('click', async () => {
        Utils.hideModal?.();
        await this.showAwardModal(a.id);
      });
      document.getElementById('ref-m-edit')?.addEventListener('click', async () => {
        Utils.hideModal?.();
        await this.showEditAgentModal(a.id);
      });
      document.getElementById('ref-m-reset-pw')?.addEventListener('click', async () => {
        if (!confirm('Send a temporary password to this agent on WhatsApp?')) return;
        const r = await this.api(API.referralResetAgentPassword(a.id, actor, {}), 'Reset failed');
        if (r?.whatsapp_url) { try { window.open(r.whatsapp_url, '_blank'); } catch (_) { /* */ } }
        this.toast(r?.message || 'Password reset sent', 'success');
      });
      document.getElementById('ref-m-fix-login')?.addEventListener('click', async () => {
        const r = await this.api(API.referralEnsureAgentLogin(a.id, actor), 'Could not fix login');
        this.toast(r?.username ? `Login ready for ${r.username}` : 'Login account fixed', 'success');
      });
      document.getElementById('ref-m-reveal')?.addEventListener('click', async () => {
        const full = await this.api(API.referralGetAgent(a.id, actor, { revealBank: true }), 'Failed');
        if (full?.bank) alert(`Account: ${full.bank.account_number}\nBranch: ${full.bank.branch_code}`);
      });
      return;
    }
    if (act === 'approve-comm') {
      await this.api(API.referralApproveCommission(parseInt(ds.id, 10), actor), 'Failed');
      this.toast('Commission approved', 'success');
      await this.renderSection();
      return;
    }
    if (act === 'mark-available') {
      await this.api(API.referralMarkAvailable(actor), 'Failed');
      this.toast('Approved commissions marked available', 'success');
      await this.renderSection();
      return;
    }
    if (act === 'gen-payout') {
      const r = await this.api(API.referralGeneratePayout({}, actor), 'No eligible agents or failed');
      if (r) { this.toast(`Payout ${r.payout_number} created`, 'success'); this.section = 'payouts'; this.paintNav(); await this.renderSection(); }
      return;
    }
    if (act === 'approve-payout') {
      await this.api(API.referralApprovePayout(parseInt(ds.id, 10), actor), 'Failed');
      this.toast('Payout approved', 'success');
      await this.renderSection();
      return;
    }
    if (act === 'pay-payout') {
      const reference = prompt('Paste bank / payment reference (required for payslip)') || '';
      if (!String(reference).trim()) {
        this.toast('Payment reference is required', 'error');
        return;
      }
      const paid = await this.api(API.referralMarkPayoutPaid(parseInt(ds.id, 10), { payment_reference: reference, payment_method: 'bank_transfer' }, actor), 'Failed');
      this.toast('Marked paid — payslips sent to agents', 'success');
      if (paid?.items?.some((i) => i.payslip_html)) {
        const first = paid.items.find((i) => i.payslip_html);
        if (first?.payslip_html) {
          Utils.showModal('Payslip preview', first.payslip_html, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
        }
      }
      await this.renderSection();
      return;
    }
    if (act === 'open-payout') {
      const p = await this.api(API.referralGetPayout(parseInt(ds.id, 10), actor), 'Failed');
      if (!p) return;
      Utils.showModal(p.payout_number, `
        <p>Status ${this.tag(p.status)} · Total ${this.money(p.total_amount)}${Number(p.claimed_by_agent) ? ' · <strong>Agent claim</strong>' : ''}</p>
        ${p.notes ? `<p class="muted">${this.esc(p.notes)}</p>` : ''}
        ${p.payment_reference ? `<p>Payment ref: <strong>${this.esc(p.payment_reference)}</strong></p>` : ''}
        ${this.table(['Agent', 'Amount', 'Bank', 'Status', ''],
          (p.items || []).map((i) => `<tr>
            <td>${this.esc(i.full_name)}</td><td>${this.money(i.amount)}</td>
            <td>${this.esc(i.bank?.bank_name || '')} ${this.esc(i.bank?.account_number || '')} ${this.esc(i.bank?.account_holder || '')}</td>
            <td>${this.tag(i.status)}</td>
            <td>${i.payslip_html ? this.btn('Payslip', 'view-payslip', { id: i.id }, 'btn-sm btn-primary') : ''}</td>
          </tr>`).join(''), 'No items')}`, '');
      document.querySelectorAll('#modal-overlay [data-ref-act="view-payslip"]').forEach((b) => {
        b.addEventListener('click', async () => {
          const slip = await this.api(API.referralGetPayslip(parseInt(b.dataset.id, 10), actor), 'Payslip unavailable');
          if (slip?.payslip_html) {
            const w = window.open('', '_blank');
            if (w) { w.document.write(slip.payslip_html); w.document.close(); }
          } else this.toast(slip?.__error || 'Payslip unavailable', 'error');
        });
      });
      return;
    }
    if (act === 'save-settings' || act === 'save-rules' || act === 'save-schedule') {
      const payload = {};
      if (document.getElementById('ref-set-pct') || document.getElementById('ref-rule-pct')) {
        payload.default_commission_percent = parseFloat(document.getElementById('ref-set-pct')?.value || document.getElementById('ref-rule-pct')?.value || '5');
        payload.commission_basis = document.getElementById('ref-set-basis')?.value || document.getElementById('ref-rule-basis')?.value;
        payload.public_apply_enabled = !!document.getElementById('ref-set-apply')?.checked;
        payload.pos_referral_enabled = !!document.getElementById('ref-set-pos')?.checked;
        payload.auto_approve_commissions = !!(document.getElementById('ref-set-auto')?.checked || document.getElementById('ref-rule-auto')?.checked);
      }
      if (act === 'save-rules' && document.querySelector('.ref-cat-name')) {
        const cats = [];
        document.querySelectorAll('tbody tr[data-cat-id]').forEach((tr) => {
          const isCustom = tr.dataset.custom === '1';
          const id = tr.dataset.catId;
          if (isCustom) {
            cats.push({ id: id || 'cat_custom', name: 'Custom', percent: null, min_sales: null, is_custom: true });
            return;
          }
          const nameInp = tr.querySelector('.ref-cat-name');
          const pctInp = tr.querySelector('.ref-cat-pct');
          const minInp = tr.querySelector('.ref-cat-min');
          cats.push({
            id,
            name: nameInp?.value?.trim() || 'Category',
            percent: parseFloat(pctInp?.value || '0') || 0,
            min_sales: parseFloat(minInp?.value || '0') || 0,
            is_custom: false
          });
        });
        if (cats.length) payload.commission_categories = cats;
      }
      if (document.getElementById('ref-pay-freq')) {
        payload.payout_frequency = document.getElementById('ref-pay-freq').value;
        payload.payout_frequency_custom = String(document.getElementById('ref-pay-freq-custom')?.value || '').trim();
        payload.payout_day_text = String(document.getElementById('ref-pay-day')?.value || '').trim();
        payload.payout_day = payload.payout_day_text;
        const minOn = !!document.getElementById('ref-pay-min-on')?.checked;
        payload.minimum_payout_enabled = minOn;
        if (minOn) {
          const rawMin = String(document.getElementById('ref-pay-min')?.value || '').replace(/,/g, '').trim();
          payload.minimum_payout = parseFloat(rawMin);
          if (!Number.isFinite(payload.minimum_payout) || payload.minimum_payout < 0) {
            return this.toast('Enter your minimum payout amount, or turn minimum off', 'error');
          }
        } else {
          payload.minimum_payout = 0;
        }
        if (payload.payout_frequency === 'custom' && !payload.payout_frequency_custom) {
          return this.toast('Enter your custom frequency', 'error');
        }
        if (!payload.payout_day_text) {
          return this.toast('Enter a payout day', 'error');
        }
      }
      await this.api(API.referralUpdateSettings(payload, actor), 'Save failed');
      this.toast('Saved', 'success');
      await this.renderSection();
    }
  },

  async showAwardModal(agentId) {
    const actor = this.actor();
    const a = await this.api(API.referralGetAgent(agentId, actor, {}), 'Could not load agent');
    if (!a) return;
    const direct = this.canDirectAward();
    Utils.showModal(`Award commission · ${a.full_name}`, `
      <p class="muted">${direct
        ? 'As owner/admin, this amount goes straight into the agent’s available wallet.'
        : 'This award will be sent to the owner/admin for approval first. The referral agent is only credited after approval.'}</p>
      <div class="field"><label>Amount *</label><input type="number" id="ref-award-amt" step="0.01" min="0.01" placeholder="0.00"></div>
      <div class="field"><label>Note / reason *</label><input id="ref-award-note" placeholder="e.g. Missed attribution — customer proof attached"></div>`,
      `<button class="btn btn-ghost" id="ref-award-cancel">Cancel</button><button class="btn btn-success" id="ref-award-go">${direct ? 'Award' : 'Submit for approval'}</button>`);
    document.getElementById('ref-award-cancel')?.addEventListener('click', () => Utils.hideModal?.());
    document.getElementById('ref-award-go')?.addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('ref-award-amt')?.value || '0');
      const note = String(document.getElementById('ref-award-note')?.value || '').trim();
      if (!(amount > 0)) return this.toast('Enter a valid amount', 'error');
      if (!note) return this.toast('Enter a reason / note', 'error');
      const r = await this.api(API.referralAwardCommission(agentId, { amount, note }, actor), 'Award failed');
      if (!r) return;
      Utils.hideModal?.();
      if (r.pending_approval) {
        this.toast(`Submitted ${this.money(amount)} for owner approval — agent not credited yet`, 'success');
        await this.refreshCounts();
        this.paintNav();
      } else {
        this.toast(`Awarded ${this.money(amount)} to ${a.full_name}`, 'success');
      }
      await this.renderSection();
    });
  },

  async showAwardRequestModal(requestId) {
    const actor = this.actor();
    const r = await this.api(API.referralGetAwardRequest(requestId, actor), 'Could not load award request');
    if (!r) return;
    const canDecide = this.canDirectAward() && String(r.status) === 'PENDING';
    Utils.showModal(`Award request #${r.id}`, `
      <div class="ref-detail-grid">
        <div class="ref-detail-item"><label>Agent</label><strong>${this.esc(r.agent_name || `#${r.agent_id}`)}</strong>
          <div class="ref-code">${this.esc(r.agent_code || '')}</div></div>
        <div class="ref-detail-item"><label>Requested amount</label><strong>${this.money(r.requested_amount)}</strong></div>
        <div class="ref-detail-item"><label>Requested by</label><strong>${this.esc(r.requested_by_name || '—')}</strong>
          <div class="muted">${this.esc(r.requested_by_role || '')} · ${this.esc(String(r.created_at || '').slice(0, 16))}</div></div>
        <div class="ref-detail-item"><label>Status</label>${this.tag(r.status)}</div>
        <div class="ref-detail-item" style="grid-column:1/-1"><label>Note / reason</label><strong>${this.esc(r.note || '—')}</strong></div>
        ${r.review_note || r.final_amount != null ? `
          <div class="ref-detail-item"><label>Final amount</label><strong>${r.final_amount != null ? this.money(r.final_amount) : '—'}</strong></div>
          <div class="ref-detail-item"><label>Decision</label><strong>${this.esc(r.review_decision || '—')}</strong>
            <div class="muted">${this.esc(r.reviewed_by_name || '')} · ${this.esc(String(r.reviewed_at || '').slice(0, 16))}</div></div>
          <div class="ref-detail-item" style="grid-column:1/-1"><label>Admin reason</label><strong>${this.esc(r.review_note || '—')}</strong></div>` : ''}
      </div>`,
      canDecide
        ? `<button class="btn btn-ghost" id="ref-ar-close">Close</button>
           <button class="btn btn-danger" id="ref-ar-reject">Reject</button>
           <button class="btn btn-warning" id="ref-ar-reduce">Reduce</button>
           <button class="btn btn-success" id="ref-ar-approve">Approve</button>`
        : `<button class="btn btn-ghost" id="ref-ar-close">Close</button>`);
    document.getElementById('ref-ar-close')?.addEventListener('click', () => Utils.hideModal?.());
    document.getElementById('ref-ar-approve')?.addEventListener('click', async () => {
      Utils.hideModal?.();
      await this.decideAwardRequest(requestId, 'approve');
    });
    document.getElementById('ref-ar-reject')?.addEventListener('click', async () => {
      Utils.hideModal?.();
      await this.decideAwardRequest(requestId, 'reject');
    });
    document.getElementById('ref-ar-reduce')?.addEventListener('click', async () => {
      Utils.hideModal?.();
      await this.decideAwardRequest(requestId, 'reduce', r);
    });
  },

  async decideAwardRequest(requestId, decision, existing) {
    if (!this.canDirectAward()) {
      return this.toast('Only the owner/admin can approve award commissions', 'error');
    }
    const actor = this.actor();
    const row = existing || await this.api(API.referralGetAwardRequest(requestId, actor), 'Could not load award request');
    if (!row) return;

    if (decision === 'approve') {
      if (!confirm(`Approve award of ${this.money(row.requested_amount)} to ${row.agent_name || 'agent'}?`)) return;
      const r = await this.api(API.referralDecideAwardRequest(requestId, { decision: 'approve' }, actor), 'Approve failed');
      if (!r) return;
      this.toast('Award approved — agent credited', 'success');
      await this.refreshCounts(); this.paintNav(); await this.renderSection();
      return;
    }

    if (decision === 'reject') {
      Utils.showModal(`Reject award #${requestId}`, `
        <p class="muted">The agent will not be credited. Your reason is sent to ${this.esc(row.requested_by_name || 'the requester')}.</p>
        <div class="field"><label>Reason *</label><textarea id="ref-ar-reason" rows="3" placeholder="Why is this award rejected?"></textarea></div>`,
        '<button class="btn btn-ghost" id="ref-ar-cancel">Cancel</button><button class="btn btn-danger" id="ref-ar-go">Reject</button>');
      document.getElementById('ref-ar-cancel')?.addEventListener('click', () => Utils.hideModal?.());
      document.getElementById('ref-ar-go')?.addEventListener('click', async () => {
        const reason = String(document.getElementById('ref-ar-reason')?.value || '').trim();
        if (!reason) return this.toast('Enter a rejection reason', 'error');
        const r = await this.api(API.referralDecideAwardRequest(requestId, { decision: 'reject', review_note: reason }, actor), 'Reject failed');
        if (!r) return;
        Utils.hideModal?.();
        this.toast('Award rejected', 'success');
        await this.refreshCounts(); this.paintNav(); await this.renderSection();
      });
      return;
    }

    if (decision === 'reduce') {
      Utils.showModal(`Reduce award #${requestId}`, `
        <p class="muted">Requested: <strong>${this.money(row.requested_amount)}</strong> for ${this.esc(row.agent_name || 'agent')}.
          Enter a lower amount. Your reason is sent to ${this.esc(row.requested_by_name || 'the requester')}, then the agent is credited the reduced amount.</p>
        <div class="field"><label>Reduced amount *</label><input type="number" id="ref-ar-amt" step="0.01" min="0.01" placeholder="0.00"></div>
        <div class="field"><label>Reason *</label><textarea id="ref-ar-reason" rows="3" placeholder="Why was the award reduced?"></textarea></div>`,
        '<button class="btn btn-ghost" id="ref-ar-cancel">Cancel</button><button class="btn btn-warning" id="ref-ar-go">Reduce &amp; approve</button>');
      document.getElementById('ref-ar-cancel')?.addEventListener('click', () => Utils.hideModal?.());
      document.getElementById('ref-ar-go')?.addEventListener('click', async () => {
        const amount = parseFloat(document.getElementById('ref-ar-amt')?.value || '0');
        const reason = String(document.getElementById('ref-ar-reason')?.value || '').trim();
        if (!(amount > 0)) return this.toast('Enter a valid reduced amount', 'error');
        if (amount >= Number(row.requested_amount)) return this.toast('Reduced amount must be less than requested', 'error');
        if (!reason) return this.toast('Enter a reason for the reduction', 'error');
        const r = await this.api(API.referralDecideAwardRequest(requestId, {
          decision: 'reduce', final_amount: amount, review_note: reason
        }, actor), 'Reduce failed');
        if (!r) return;
        Utils.hideModal?.();
        this.toast(`Award reduced to ${this.money(amount)} — agent credited`, 'success');
        await this.refreshCounts(); this.paintNav(); await this.renderSection();
      });
    }
  },

  async showEditAgentModal(agentId) {
    const actor = this.actor();
    const a = await this.api(API.referralGetAgent(agentId, actor, { revealBank: true }), 'Could not load agent');
    if (!a) return;
    const bank = a.bank || {};
    const cats = Array.isArray(a.commission_categories) ? a.commission_categories : [];
    const mode = String(a.commission_category_mode || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto';
    const catOpts = cats.map((c) =>
      `<option value="${this.esc(c.id)}" ${a.commission_category_id === c.id ? 'selected' : ''}>${this.esc(c.name)}${c.is_custom ? ' (set % below)' : ` — ${c.percent}%`}</option>`
    ).join('');
    Utils.showModal(`Edit agent · ${a.full_name}`, `
      <div class="ref-form-grid">
        <div class="field"><label>Full name *</label><input id="ref-ed-name" value="${this.esc(a.full_name || '')}"></div>
        <div class="field"><label>Username</label><input id="ref-ed-user" value="${this.esc(a.username || '')}"></div>
        <div class="field"><label>Phone</label><input id="ref-ed-phone" value="${this.esc(a.phone || '')}"></div>
        <div class="field"><label>Email</label><input id="ref-ed-email" value="${this.esc(a.email || '')}"></div>
        <div class="field full"><label>Address</label><input id="ref-ed-address" value="${this.esc(a.address || '')}"></div>
        <div class="field"><label>Referral code</label><input id="ref-ed-code" value="${this.esc(a.referral_code || '')}" style="text-transform:uppercase"></div>
        <div class="field"><label>Category mode</label>
          <select id="ref-ed-cat-mode">
            <option value="auto" ${mode === 'auto' ? 'selected' : ''}>Auto (by sales threshold)</option>
            <option value="manual" ${mode === 'manual' ? 'selected' : ''}>Manual (I choose)</option>
          </select>
        </div>
        <div class="field"><label>Commission category</label>
          <select id="ref-ed-cat">${catOpts || '<option value="">—</option>'}</select>
          <p class="muted" style="margin:4px 0 0;font-size:11px">Current: ${this.esc(a.resolved_category?.name || '—')} · ${this.esc(a.effective_commission_percent ?? a.commission_percent ?? '')}% · Sales ${this.money(a.lifetime_sales)}</p>
        </div>
        <div class="field"><label>Custom / override %</label><input type="number" step="0.01" id="ref-ed-pct" value="${this.esc(a.commission_percent ?? '')}" placeholder="Required for Custom category">
          <p class="muted" style="margin:4px 0 0;font-size:11px">Used when category is Custom, or as fallback.</p>
        </div>
        <div class="field"><label>Preferred contact</label><input id="ref-ed-contact" value="${this.esc(a.preferred_contact || '')}"></div>
        <div class="field full"><strong>Bank details</strong></div>
        <div class="field"><label>Bank</label><input id="ref-ed-bank" value="${this.esc(bank.bank_name || '')}"></div>
        <div class="field"><label>Account holder</label><input id="ref-ed-holder" value="${this.esc(bank.account_holder || '')}"></div>
        <div class="field"><label>Account number</label><input id="ref-ed-acc" value="${this.esc(bank.account_number || '')}"></div>
        <div class="field"><label>Branch code</label><input id="ref-ed-branch" value="${this.esc(bank.branch_code || '')}"></div>
        <div class="field"><label>Account type</label><input id="ref-ed-atype" value="${this.esc(bank.account_type || 'cheque')}"></div>
      </div>`,
      '<button class="btn btn-ghost" id="ref-ed-cancel">Cancel</button><button class="btn btn-primary" id="ref-ed-save">Save</button>');
    document.getElementById('ref-ed-cancel')?.addEventListener('click', () => Utils.hideModal?.());
    document.getElementById('ref-ed-save')?.addEventListener('click', async () => {
      const payload = {
        full_name: document.getElementById('ref-ed-name')?.value.trim(),
        username: document.getElementById('ref-ed-user')?.value.trim(),
        phone: document.getElementById('ref-ed-phone')?.value.trim(),
        email: document.getElementById('ref-ed-email')?.value.trim(),
        address: document.getElementById('ref-ed-address')?.value.trim(),
        referral_code: document.getElementById('ref-ed-code')?.value.trim().toUpperCase(),
        commission_percent: document.getElementById('ref-ed-pct')?.value,
        commission_category_id: document.getElementById('ref-ed-cat')?.value || null,
        commission_category_mode: document.getElementById('ref-ed-cat-mode')?.value || 'auto',
        preferred_contact: document.getElementById('ref-ed-contact')?.value.trim(),
        bank: {
          bank_name: document.getElementById('ref-ed-bank')?.value.trim(),
          account_holder: document.getElementById('ref-ed-holder')?.value.trim(),
          account_number: document.getElementById('ref-ed-acc')?.value.trim(),
          branch_code: document.getElementById('ref-ed-branch')?.value.trim(),
          account_type: document.getElementById('ref-ed-atype')?.value.trim() || 'cheque'
        }
      };
      if (!payload.full_name) return this.toast('Name is required', 'error');
      const r = await this.api(API.referralUpdateAgent(agentId, payload, actor), 'Save failed');
      if (!r) return;
      Utils.hideModal?.();
      this.toast('Agent updated', 'success');
      await this.renderSection();
    });
  }
};
