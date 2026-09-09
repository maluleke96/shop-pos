/**
 * Communication Centre — standalone professional portal
 */
const CommApp = {
  view: 'login',
  page: 'dashboard',
  token: CommAPI.token(),
  user: null,
  shopName: 'Communication Centre',
  filters: { from: '', to: '', status: '', channel: '', q: '' },
  _shellReady: false,
  _loading: false,

  NAV: [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: '📊' },
      { id: 'usage', label: 'Usage & Analytics', icon: '📈' }
    ]},
    { group: 'Messaging', items: [
      { id: 'campaigns', label: 'Campaigns', icon: '📣', send: true },
      { id: 'automations', label: 'Automations', icon: '⚡' },
      { id: 'templates', label: 'Templates', icon: '📝' },
      { id: 'messages', label: 'Message History', icon: '📬' }
    ]},
    { group: 'Audience', items: [
      { id: 'segments', label: 'Segments', icon: '👥', send: true }
    ]},
    { group: 'Configuration', items: [
      { id: 'providers', label: 'Providers', icon: '🔌', admin: true },
      { id: 'settings', label: 'Settings', icon: '⚙️', admin: true },
      { id: 'portal', label: 'Portal Logins', icon: '🔐', admin: true },
      { id: 'logs', label: 'Admin Logs', icon: '📋', admin: true }
    ]}
  ],

  PAGE_TITLES: {
    dashboard: 'Dashboard',
    usage: 'Usage & Analytics',
    campaigns: 'Campaigns',
    automations: 'Automations',
    templates: 'Templates',
    messages: 'Message History',
    segments: 'Customer Segments',
    providers: 'Provider Settings',
    settings: 'Settings',
    portal: 'Portal Logins',
    logs: 'Admin Audit Logs'
  },

  init() {
    try { this.user = JSON.parse(sessionStorage.getItem('comm_user') || 'null'); } catch (_) { this.user = null; }
    const d = new Date();
    this.filters.to = d.toLocaleDateString('en-CA');
    d.setDate(1);
    this.filters.from = d.toLocaleDateString('en-CA');
    if (this.token && this.user) {
      this.view = 'main';
      CommAPI.profile().then((p) => {
        this.user = p.user;
        this.shopName = p.shop_name || this.shopName;
        sessionStorage.setItem('comm_user', JSON.stringify(this.user));
        this.renderShell();
      }).catch(() => this.logout());
    } else {
      this.renderLogin();
    }
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  toast(msg, type) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `cc-toast${type === 'error' ? ' error' : ''}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  isAdmin() {
    return this.user?.comm_role === 'admin' || ['owner', 'manager', 'supervisor'].includes(this.user?.role);
  },

  canSend() {
    return this.isAdmin() || this.user?.comm_role === 'marketing';
  },

  tag(text, cls) {
    return `<span class="cc-tag ${cls || 'muted'}">${this.esc(text || '—')}</span>`;
  },

  statusTag(s) {
    const m = {
      delivered: 'ok', sent: 'ok', completed: 'ok', active: 'ok', running: 'info',
      pending: 'warn', scheduled: 'warn', paused: 'warn', processing: 'warn',
      failed: 'bad', cancelled: 'bad', draft: 'muted'
    };
    return this.tag(s, m[String(s || '').toLowerCase()] || 'muted');
  },

  pct(n, d) {
    if (!d) return '0%';
    return `${Math.round((Number(n) / Number(d)) * 100)}%`;
  },

  dateToolbar(extra = '') {
    return `<div class="cc-toolbar">
      <label class="cc-inline">From <input type="date" id="f-from" value="${this.esc(this.filters.from)}"></label>
      <label class="cc-inline">To <input type="date" id="f-to" value="${this.esc(this.filters.to)}"></label>
      <button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-preset="today">Today</button>
      <button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-preset="7d">7 days</button>
      <button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-preset="30d">30 days</button>
      <button type="button" class="cc-btn cc-btn-primary cc-btn-sm" id="f-apply">Apply</button>
      ${extra}
    </div>`;
  },

  bindDateToolbar(root, cb) {
    const apply = () => {
      this.filters.from = root.querySelector('#f-from')?.value || this.filters.from;
      this.filters.to = root.querySelector('#f-to')?.value || this.filters.to;
      cb();
    };
    root.querySelector('#f-apply')?.addEventListener('click', apply);
    root.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const today = new Date();
        const to = today.toLocaleDateString('en-CA');
        let from = to;
        if (btn.dataset.preset === '7d') {
          const d = new Date(); d.setDate(d.getDate() - 6); from = d.toLocaleDateString('en-CA');
        } else if (btn.dataset.preset === '30d') {
          const d = new Date(); d.setDate(d.getDate() - 29); from = d.toLocaleDateString('en-CA');
        }
        this.filters.from = from;
        this.filters.to = to;
        const fEl = root.querySelector('#f-from');
        const tEl = root.querySelector('#f-to');
        if (fEl) fEl.value = from;
        if (tEl) tEl.value = to;
        cb();
      });
    });
  },

  showModal(title, bodyHtml, actionsHtml) {
    this.closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'cc-modal-backdrop';
    backdrop.id = 'cc-modal';
    backdrop.innerHTML = `<div class="cc-modal" role="dialog">
      <h3>${this.esc(title)}</h3>
      ${bodyHtml}
      <div class="cc-toolbar" style="margin-top:16px;justify-content:flex-end">${actionsHtml || ''}</div>
    </div>`;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeModal(); });
    document.body.appendChild(backdrop);
  },

  closeModal() {
    document.getElementById('cc-modal')?.remove();
  },

  setContent(html) {
    const el = document.getElementById('cc-content');
    if (el) el.innerHTML = html;
  },

  setLoading(msg) {
    this.setContent(`<div class="cc-loading">${this.esc(msg || 'Loading…')}</div>`);
  },

  renderLogin() {
    this._shellReady = false;
    document.getElementById('app').innerHTML = `
      <div class="cc-login-wrap">
        <form class="cc-login-card" onsubmit="return false">
          <img class="cc-logo" data-shop-logo src="/api/logo" alt="" onerror="this.style.display='none'">
          <h1 data-shop-name>Communication Centre</h1>
          <p>Professional multi-channel messaging — SMS, WhatsApp, email &amp; push. Sign in with your portal username or Admin / Manager shop login.</p>
          <label class="cc-field">Username<input id="login-user" autocomplete="username" required></label>
          <label class="cc-field">Password<input type="password" id="login-pass" autocomplete="current-password" required></label>
          <button type="button" class="cc-btn cc-btn-primary" id="login-btn" style="width:100%">Sign in</button>
        </form>
      </div>`;
    window.PanelBrand?.apply?.({ nameSelector: '[data-shop-name]', logoSelector: '[data-shop-logo]' });
    document.getElementById('login-btn')?.addEventListener('click', () => this.doLogin());
    document.getElementById('login-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doLogin(); });
  },

  navHtml() {
    const items = [];
    for (const g of this.NAV) {
      const visible = g.items.filter((it) => !it.admin || this.isAdmin()).filter((it) => !it.send || this.canSend() || it.id === 'automations' || it.id === 'templates' || it.id === 'messages');
      if (!visible.length) continue;
      items.push(`<div class="cc-nav-group">${this.esc(g.group)}</div>`);
      for (const it of visible) {
        items.push(`<button type="button" class="cc-nav-btn${this.page === it.id ? ' active' : ''}" data-page="${it.id}">${it.icon} ${this.esc(it.label)}</button>`);
      }
    }
    return items.join('');
  },

  renderShell() {
    const app = document.getElementById('app');
    app.innerHTML = `<div class="cc-app">
      <aside class="cc-sidebar">
        <div class="cc-brand">
          <img data-shop-logo src="/api/logo" alt="" onerror="this.style.display='none'">
          <div><strong data-shop-name>${this.esc(this.shopName)}</strong><small>Communication Centre</small></div>
        </div>
        <nav class="cc-nav" id="cc-nav">${this.navHtml()}</nav>
        <div style="margin-top:auto;padding:12px 8px 0;border-top:1px solid var(--cc-line)">
          <div class="meta" style="font-size:12px;color:var(--cc-muted);margin-bottom:8px">${this.esc(this.user?.full_name || this.user?.username)}</div>
          <button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" id="logout-btn" style="width:100%">Sign out</button>
        </div>
      </aside>
      <div class="cc-main">
        <header class="cc-topbar">
          <div>
            <h2 id="cc-page-title">${this.esc(this.PAGE_TITLES[this.page] || 'Dashboard')}</h2>
            <div class="meta">Server-side automations run 24/7 — no browser required</div>
          </div>
        </header>
        <main class="cc-content" id="cc-content"><div class="cc-loading">Loading…</div></main>
      </div>
    </div>`;
    window.PanelBrand?.apply?.({ nameSelector: '[data-shop-name]', logoSelector: '[data-shop-logo]' });
    document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
    document.getElementById('cc-nav')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn) return;
      this.switchPage(btn.dataset.page);
    });
    this._shellReady = true;
    this.switchPage(this.page);
  },

  updateNavActive() {
    document.querySelectorAll('.cc-nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === this.page);
    });
    const title = document.getElementById('cc-page-title');
    if (title) title.textContent = this.PAGE_TITLES[this.page] || this.page;
  },

  async switchPage(page) {
    if (this._loading) return;
    this.page = page;
    if (!this._shellReady) return this.renderShell();
    this.updateNavActive();
    this.setLoading();
    const map = {
      dashboard: () => this.pageDashboard(),
      usage: () => this.pageUsage(),
      campaigns: () => this.pageCampaigns(),
      automations: () => this.pageAutomations(),
      templates: () => this.pageTemplates(),
      messages: () => this.pageMessages(),
      segments: () => this.pageSegments(),
      providers: () => this.pageProviders(),
      settings: () => this.pageSettings(),
      portal: () => this.pagePortal(),
      logs: () => this.pageLogs()
    };
    try {
      await (map[page] || map.dashboard)();
    } catch (err) {
      this.setContent(`<div class="cc-error">${this.esc(err.message || 'Failed to load page')}</div>`);
    }
  },

  async doLogin() {
    const u = document.getElementById('login-user')?.value.trim();
    const p = document.getElementById('login-pass')?.value;
    if (!u || !p) return this.toast('Enter username and password', 'error');
    const btn = document.getElementById('login-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    try {
      const r = await CommAPI.login(u, p);
      this.token = r.token;
      this.user = r.user;
      sessionStorage.setItem('comm_token', r.token);
      sessionStorage.setItem('comm_user', JSON.stringify(r.user));
      this.view = 'main';
      const prof = await CommAPI.profile();
      this.shopName = prof.shop_name || this.shopName;
      this.renderShell();
      this.toast('Signed in successfully');
    } catch (err) {
      this.toast(err.message || 'Login failed', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    }
  },

  async logout() {
    try { if (this.token) await CommAPI.logout(); } catch (_) { /* */ }
    sessionStorage.removeItem('comm_token');
    sessionStorage.removeItem('comm_user');
    this.token = '';
    this.user = null;
    this.view = 'login';
    this._shellReady = false;
    this.renderLogin();
  },

  /* ── Dashboard ── */
  async pageDashboard() {
    const data = await CommAPI.dashboard({ from: this.filters.from, to: this.filters.to });
    const s = data.stats || {};
    const total = Number(s.total) || 0;
    const sent = Number(s.sent) || 0;
    const delivered = Number(s.delivered) || 0;
    const failed = Number(s.failed) || 0;
    const pending = Number(s.pending) || 0;
    this.setContent(`
      ${this.dateToolbar()}
      <div class="cc-grid">
        <div class="cc-stat"><small>Total messages</small><strong>${total}</strong></div>
        <div class="cc-stat"><small>Sent</small><strong>${sent}</strong></div>
        <div class="cc-stat"><small>Delivered</small><strong>${delivered}</strong><div class="meta">${this.pct(delivered, sent || total)} rate</div></div>
        <div class="cc-stat"><small>Pending</small><strong>${pending}</strong></div>
        <div class="cc-stat"><small>Failed</small><strong style="color:var(--cc-bad)">${failed}</strong></div>
      </div>
      <div class="cc-split">
        <div class="cc-panel">
          <h3>Messages by channel</h3>
          <div class="cc-table-wrap"><table class="cc-table">
            <tr><th>Channel</th><th>Total</th><th>Sent</th></tr>
            ${(data.byChannel || []).map((c) => `<tr><td>${this.tag(c.channel, 'info')}</td><td>${c.count || 0}</td><td>${c.sent || 0}</td></tr>`).join('') || '<tr><td colspan="3" class="cc-empty">No messages in this period</td></tr>'}
          </table></div>
        </div>
        <div class="cc-panel">
          <h3>Recent campaigns</h3>
          <div class="cc-table-wrap"><table class="cc-table">
            <tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Failed</th></tr>
            ${(data.campaigns || []).map((c) => `<tr><td>${this.esc(c.name)}</td><td>${this.statusTag(c.status)}</td><td>${c.sent_count || 0}</td><td>${c.failed_count || 0}</td></tr>`).join('') || '<tr><td colspan="4" class="cc-empty">No campaigns yet</td></tr>'}
          </table></div>
        </div>
      </div>
      <div class="cc-panel">
        <h3>Automation engine</h3>
        <p class="lead">Automations run on the server every minute. Enable the 7-day loyalty expiry reminder to notify customers automatically.</p>
        <div class="cc-table-wrap"><table class="cc-table">
          <tr><th>Automation</th><th>Status</th><th>Last run</th><th>Next run</th><th>Success</th><th>Failures</th><th></th></tr>
          ${(data.automations || []).map((a) => `<tr>
            <td><strong>${this.esc(a.name)}</strong></td>
            <td>${a.is_active ? this.tag('Active', 'ok') : this.tag('Inactive', 'muted')}</td>
            <td>${this.esc((a.last_run_at || '—').slice(0, 16))}</td>
            <td>${this.esc((a.next_run_at || '—').slice(0, 16))}</td>
            <td>${a.success_count || 0}</td>
            <td>${a.failure_count || 0}</td>
            <td>${this.isAdmin() ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-auto-toggle="${a.id}" data-on="${a.is_active ? 0 : 1}">${a.is_active ? 'Disable' : 'Enable'}</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="cc-empty">No automations configured</td></tr>'}
        </table></div>
      </div>`);
    const root = document.getElementById('cc-content');
    this.bindDateToolbar(root, () => this.pageDashboard());
    root.querySelectorAll('[data-auto-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await CommAPI.setAutomationActive(Number(b.dataset.autoToggle), b.dataset.on === '1');
        this.toast('Automation updated');
        this.pageDashboard();
      } catch (e) { this.toast(e.message, 'error'); }
    }));
  },

  /* ── Usage ── */
  async pageUsage() {
    const data = await CommAPI.usage({ from: this.filters.from, to: this.filters.to });
    const limits = data.limits || {};
    this.setContent(`
      ${this.dateToolbar()}
      <div class="cc-panel">
        <h3>Channel usage (${this.esc(data.period?.from)} → ${this.esc(data.period?.to)})</h3>
        <div class="cc-table-wrap"><table class="cc-table">
          <tr><th>Channel</th><th>Total</th><th>Sent</th><th>Failed</th><th>Limit</th><th>Usage</th></tr>
          ${(data.channels || []).map((c) => {
            const lim = limits[c.channel] || '—';
            const pct = lim && lim !== '—' ? this.pct(c.total, lim) : '—';
            const warn = lim && Number(c.total) / Number(lim) > 0.8;
            return `<tr><td>${this.tag(c.channel, 'info')}</td><td>${c.total || 0}</td><td>${c.sent || 0}</td><td>${c.failed || 0}</td><td>${lim}</td><td>${warn ? `<span style="color:var(--cc-warn)">${pct}</span>` : pct}</td></tr>`;
          }).join('') || '<tr><td colspan="6" class="cc-empty">No usage data</td></tr>'}
        </table></div>
        <p class="lead" style="margin-top:12px">Configure usage limits in Settings to receive warnings when approaching monthly caps.</p>
      </div>`);
    this.bindDateToolbar(document.getElementById('cc-content'), () => this.pageUsage());
  },

  /* ── Campaigns ── */
  async pageCampaigns() {
    if (!this.canSend()) {
      this.setContent('<div class="cc-panel"><p class="lead">You have view-only access. Contact an administrator for campaign permissions.</p></div>');
      return;
    }
    const [rows, templates] = await Promise.all([CommAPI.campaigns(), CommAPI.templates()]);
    this.setContent(`
      <div class="cc-toolbar">
        <button type="button" class="cc-btn cc-btn-primary" id="camp-new">+ New campaign</button>
      </div>
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>Campaign</th><th>Status</th><th>Audience</th><th>Sent</th><th>Delivered</th><th>Failed</th><th>Pending</th><th></th></tr>
        ${rows.map((c) => `<tr>
          <td><strong>${this.esc(c.name)}</strong>${c.description ? `<div class="meta">${this.esc(c.description.slice(0, 60))}</div>` : ''}</td>
          <td>${this.statusTag(c.status)}</td>
          <td>${this.esc(c.audience_type || 'all')}</td>
          <td>${c.sent_count || 0}</td><td>${c.delivered_count || 0}</td><td>${c.failed_count || 0}</td><td>${c.pending_count || 0}</td>
          <td class="cc-actions">
            ${['draft', 'scheduled', 'paused'].includes(c.status) ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-start="${c.id}">Start</button>` : ''}
            ${c.status === 'running' ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-pause="${c.id}">Pause</button>` : ''}
            ${!['completed', 'cancelled'].includes(c.status) ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-cancel="${c.id}">Cancel</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="8" class="cc-empty">No campaigns — create your first campaign</td></tr>'}
      </table></div>`);
    const root = document.getElementById('cc-content');
    root.querySelector('#camp-new')?.addEventListener('click', () => this.showCampaignModal(templates));
    root.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', async () => {
      try { await CommAPI.startCampaign(Number(b.dataset.start)); this.toast('Campaign started'); this.pageCampaigns(); } catch (e) { this.toast(e.message, 'error'); }
    }));
    root.querySelectorAll('[data-pause]').forEach((b) => b.addEventListener('click', async () => {
      try { await CommAPI.pauseCampaign(Number(b.dataset.pause)); this.toast('Campaign paused'); this.pageCampaigns(); } catch (e) { this.toast(e.message, 'error'); }
    }));
    root.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Cancel this campaign?')) return;
      try { await CommAPI.cancelCampaign(Number(b.dataset.cancel)); this.toast('Campaign cancelled'); this.pageCampaigns(); } catch (e) { this.toast(e.message, 'error'); }
    }));
  },

  showCampaignModal(templates) {
    const tplOpts = (templates || []).map((t) => `<option value="${t.id}">${this.esc(t.name)} (${t.channel})</option>`).join('');
    this.showModal('New campaign', `
      <label class="cc-field">Campaign name<input id="m-c-name" placeholder="Weekend promotion"></label>
      <label class="cc-field">Description<textarea id="m-c-desc" placeholder="Optional description"></textarea></label>
      <label class="cc-field">Audience<select id="m-c-audience">
        <option value="all">All customers</option>
        <option value="loyalty">Loyalty customers</option>
        <option value="loyalty_expiring">Points expiring soon</option>
        <option value="inactive">Inactive customers (30+ days)</option>
      </select></label>
      <label class="cc-field">Primary channel<select id="m-c-channel">
        <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option>
        <option value="email">Email</option><option value="push">Push notification</option>
      </select></label>
      <label class="cc-field">Template<select id="m-c-tpl"><option value="">— Select template —</option>${tplOpts}</select></label>
      <label class="cc-field">Schedule<select id="m-c-sched">
        <option value="immediate">Send immediately when started</option>
        <option value="scheduled">Schedule for later</option>
      </select></label>
      <label class="cc-field hidden" id="m-c-date-wrap">Scheduled date &amp; time<input type="datetime-local" id="m-c-date"></label>
    `, `<button type="button" class="cc-btn cc-btn-ghost" id="m-cancel">Cancel</button>
       <button type="button" class="cc-btn cc-btn-primary" id="m-save">Save draft</button>`);
    const modal = document.getElementById('cc-modal');
    modal.querySelector('#m-c-sched')?.addEventListener('change', (e) => {
      modal.querySelector('#m-c-date-wrap')?.classList.toggle('hidden', e.target.value !== 'scheduled');
    });
    modal.querySelector('#m-cancel')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#m-save')?.addEventListener('click', async () => {
      try {
        const sched = modal.querySelector('#m-c-sched')?.value;
        const dt = modal.querySelector('#m-c-date')?.value;
        await CommAPI.saveCampaign({
          name: modal.querySelector('#m-c-name')?.value.trim(),
          description: modal.querySelector('#m-c-desc')?.value.trim(),
          audience_type: modal.querySelector('#m-c-audience')?.value,
          channel_strategy: { channels: [modal.querySelector('#m-c-channel')?.value] },
          template_id: Number(modal.querySelector('#m-c-tpl')?.value) || null,
          schedule_type: sched,
          scheduled_at: sched === 'scheduled' && dt ? dt.replace('T', ' ') + ':00' : null,
          status: 'draft'
        });
        this.closeModal();
        this.toast('Campaign saved');
        this.pageCampaigns();
      } catch (e) { this.toast(e.message, 'error'); }
    });
  },

  /* ── Automations ── */
  async pageAutomations() {
    const rows = await CommAPI.automations();
    this.setContent(`
      <div class="cc-panel">
        <p class="lead">Automations run server-side on a schedule. The <strong>7-Day Loyalty Expiry Reminder</strong> is pre-configured — enable it to send automatic reminders.</p>
      </div>
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>Name</th><th>Trigger</th><th>Schedule</th><th>Status</th><th>Last run</th><th>Next run</th><th>Queued</th><th></th></tr>
        ${rows.map((a) => `<tr>
          <td><strong>${this.esc(a.name)}</strong>${a.description ? `<div class="meta">${this.esc(a.description)}</div>` : ''}</td>
          <td>${this.tag(a.trigger_type, 'info')}</td>
          <td>${this.esc(a.schedule_cron || '—')}</td>
          <td>${a.is_active ? this.tag('Active', 'ok') : this.tag('Inactive', 'muted')}</td>
          <td>${this.esc((a.last_run_at || '—').slice(0, 16))}</td>
          <td>${this.esc((a.next_run_at || '—').slice(0, 16))}</td>
          <td>✓ ${a.success_count || 0} / ✗ ${a.failure_count || 0}</td>
          <td>
            ${this.isAdmin() ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-toggle="${a.id}" data-on="${a.is_active ? 0 : 1}">${a.is_active ? 'Disable' : 'Enable'}</button>` : ''}
            <button class="cc-btn cc-btn-ghost cc-btn-sm" data-run="${a.id}">Run now</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="8" class="cc-empty">No automations</td></tr>'}
      </table></div>`);
    const root = document.getElementById('cc-content');
    root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try { await CommAPI.setAutomationActive(Number(b.dataset.toggle), b.dataset.on === '1'); this.toast('Updated'); this.pageAutomations(); } catch (e) { this.toast(e.message, 'error'); }
    }));
    root.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await CommAPI.runAutomation(Number(b.dataset.run)); this.toast(`Queued ${r.queued || 0} message(s)`); } catch (e) { this.toast(e.message, 'error'); }
    }));
  },

  /* ── Templates ── */
  async pageTemplates() {
    const rows = await CommAPI.templates();
    this.setContent(`
      <div class="cc-toolbar">
        ${this.canSend() ? '<button type="button" class="cc-btn cc-btn-primary" id="tpl-new">+ New template</button>' : ''}
        <button type="button" class="cc-btn cc-btn-ghost" id="tpl-test">Test send</button>
      </div>
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>Name</th><th>Category</th><th>Channel</th><th>Preview</th><th></th></tr>
        ${rows.map((t) => `<tr>
          <td><strong>${this.esc(t.name)}</strong>${t.is_builtin ? ` ${this.tag('Built-in', 'muted')}` : ''}</td>
          <td>${this.esc(t.category)}</td>
          <td>${this.tag(t.channel, 'info')}</td>
          <td><code style="font-size:11px">${this.esc(String(t.body || '').slice(0, 70))}…</code></td>
          <td>
            <button class="cc-btn cc-btn-ghost cc-btn-sm" data-preview="${t.id}">Preview</button>
            ${this.canSend() && !t.is_builtin ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-del="${t.id}">Delete</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="cc-empty">No templates</td></tr>'}
      </table></div>
      <div class="cc-panel"><p class="lead">Variables: <code>{{customer_name}}</code> <code>{{first_name}}</code> <code>{{loyalty_points}}</code> <code>{{points_expiring}}</code> <code>{{expiry_date}}</code> <code>{{business_name}}</code> <code>{{order_number}}</code></p></div>`);
    const root = document.getElementById('cc-content');
    root.querySelector('#tpl-new')?.addEventListener('click', () => this.showTemplateModal());
    root.querySelector('#tpl-test')?.addEventListener('click', () => this.showTestSendModal(rows));
    root.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const p = await CommAPI.preview(Number(b.dataset.preview), {
          first_name: 'Happy', customer_name: 'Happy Customer', loyalty_points: 500,
          points_expiring: 120, expiry_date: '2026-10-20', business_name: this.shopName
        });
        this.showModal('Message preview', `<pre style="white-space:pre-wrap;font-size:13px;background:var(--cc-shell);padding:12px;border-radius:8px">${this.esc(p.body)}</pre>`, '<button class="cc-btn cc-btn-primary" id="m-close">Close</button>');
        document.getElementById('m-close')?.addEventListener('click', () => this.closeModal());
      } catch (e) { this.toast(e.message, 'error'); }
    }));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this template?')) return;
      try { await CommAPI.deleteTemplate(Number(b.dataset.del)); this.toast('Deleted'); this.pageTemplates(); } catch (e) { this.toast(e.message, 'error'); }
    }));
  },

  showTemplateModal(existing) {
    const t = existing || {};
    this.showModal(existing ? 'Edit template' : 'New template', `
      <label class="cc-field">Name<input id="m-t-name" value="${this.esc(t.name || '')}"></label>
      <label class="cc-field">Category<select id="m-t-cat">
        ${['loyalty', 'orders', 'marketing', 'birthday', 'welcome', 'expiry', 'payment', 'general'].map((c) =>
          `<option value="${c}"${t.category === c ? ' selected' : ''}>${c}</option>`).join('')}
      </select></label>
      <label class="cc-field">Channel<select id="m-t-ch">
        ${['sms', 'whatsapp', 'email', 'push'].map((c) => `<option value="${c}"${t.channel === c ? ' selected' : ''}>${c}</option>`).join('')}
      </select></label>
      <label class="cc-field">Subject (email only)<input id="m-t-sub" value="${this.esc(t.subject || '')}"></label>
      <label class="cc-field">Message body<textarea id="m-t-body">${this.esc(t.body || '')}</textarea></label>
    `, `<button class="cc-btn cc-btn-ghost" id="m-cancel">Cancel</button>
       <button class="cc-btn cc-btn-primary" id="m-save">Save</button>`);
    const modal = document.getElementById('cc-modal');
    modal.querySelector('#m-cancel')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#m-save')?.addEventListener('click', async () => {
      try {
        await CommAPI.saveTemplate({
          id: t.id,
          name: modal.querySelector('#m-t-name')?.value.trim(),
          category: modal.querySelector('#m-t-cat')?.value,
          channel: modal.querySelector('#m-t-ch')?.value,
          subject: modal.querySelector('#m-t-sub')?.value.trim() || null,
          body: modal.querySelector('#m-t-body')?.value
        });
        this.closeModal();
        this.toast('Template saved');
        this.pageTemplates();
      } catch (e) { this.toast(e.message, 'error'); }
    });
  },

  showTestSendModal(templates) {
    const opts = (templates || []).map((t) => `<option value="${t.id}">${this.esc(t.name)} (${t.channel})</option>`).join('');
    this.showModal('Test send', `
      <label class="cc-field">Template<select id="m-ts-tpl"><option value="">Custom message</option>${opts}</select></label>
      <label class="cc-field">Channel<select id="m-ts-ch"><option value="push">Push</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></label>
      <label class="cc-field">Phone / email<input id="m-ts-to" placeholder="+27… or email@example.com"></label>
      <label class="cc-field">Custom body (if no template)<textarea id="m-ts-body"></textarea></label>
    `, `<button class="cc-btn cc-btn-ghost" id="m-cancel">Cancel</button>
       <button class="cc-btn cc-btn-primary" id="m-send">Send test</button>`);
    const modal = document.getElementById('cc-modal');
    modal.querySelector('#m-cancel')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#m-send')?.addEventListener('click', async () => {
      try {
        const tplId = modal.querySelector('#m-ts-tpl')?.value;
        const to = modal.querySelector('#m-ts-to')?.value.trim();
        const ch = modal.querySelector('#m-ts-ch')?.value;
        const payload = { channel: ch, vars: { first_name: 'Test', customer_name: 'Test Customer' } };
        if (tplId) payload.template_id = Number(tplId);
        else payload.body = modal.querySelector('#m-ts-body')?.value;
        if (ch === 'email') payload.email = to; else payload.phone = to;
        await CommAPI.sendTest(payload);
        this.closeModal();
        this.toast('Test message queued');
      } catch (e) { this.toast(e.message, 'error'); }
    });
  },

  /* ── Messages ── */
  async pageMessages() {
    const rows = await CommAPI.messages({
      from: this.filters.from, to: this.filters.to,
      status: this.filters.status || undefined,
      channel: this.filters.channel || undefined,
      q: this.filters.q || undefined,
      limit: 200
    });
    this.setContent(`
      ${this.dateToolbar(`<select id="f-status" class="cc-filter"><option value="">All statuses</option>
        <option value="pending">Pending</option><option value="sent">Sent</option>
        <option value="delivered">Delivered</option><option value="failed">Failed</option></select>
        <select id="f-channel" class="cc-filter"><option value="">All channels</option>
        <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
        <option value="email">Email</option><option value="push">Push</option></select>
        <input id="f-q" placeholder="Search recipient…" value="${this.esc(this.filters.q)}" style="padding:8px 10px;border-radius:8px;border:1px solid var(--cc-line);background:var(--cc-shell);color:var(--cc-text)">`)}
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>Time</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Retries</th><th>Message</th><th>Error</th></tr>
        ${rows.map((m) => `<tr>
          <td>${this.esc((m.sent_at || m.created_at || '').slice(0, 16))}</td>
          <td>${this.esc(m.recipient_name || m.recipient_address || '—')}</td>
          <td>${this.tag(m.channel, 'info')}</td>
          <td>${this.statusTag(m.status)}</td>
          <td>${m.retry_count || 0}</td>
          <td><code style="font-size:11px">${this.esc(String(m.body || '').slice(0, 60))}</code></td>
          <td>${m.failure_reason ? `<span style="color:var(--cc-bad);font-size:11px">${this.esc(m.failure_reason.slice(0, 40))}</span>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="cc-empty">No messages in this period</td></tr>'}
      </table></div>`);
    const root = document.getElementById('cc-content');
    const apply = () => {
      this.filters.status = root.querySelector('#f-status')?.value || '';
      this.filters.channel = root.querySelector('#f-channel')?.value || '';
      this.filters.q = root.querySelector('#f-q')?.value.trim() || '';
      this.pageMessages();
    };
    this.bindDateToolbar(root, apply);
    root.querySelector('#f-status')?.addEventListener('change', apply);
    root.querySelector('#f-channel')?.addEventListener('change', apply);
    root.querySelector('#f-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  },

  /* ── Segments ── */
  async pageSegments() {
    if (!this.canSend()) {
      this.setContent('<div class="cc-panel"><p class="lead">View-only access.</p></div>');
      return;
    }
    const rows = await CommAPI.segments();
    this.setContent(`
      <div class="cc-toolbar"><button type="button" class="cc-btn cc-btn-primary" id="seg-new">+ New segment</button></div>
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>Segment</th><th>Description</th><th>Rules</th><th>Members</th><th></th></tr>
        ${rows.map((s) => `<tr>
          <td><strong>${this.esc(s.name)}</strong></td>
          <td>${this.esc(s.description || '—')}</td>
          <td><code style="font-size:11px">${this.esc(JSON.stringify(s.rules || {}))}</code></td>
          <td>${s.member_count != null ? s.member_count : '—'}</td>
          <td><button class="cc-btn cc-btn-ghost cc-btn-sm" data-eval="${s.id}">Evaluate</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="cc-empty">No segments — create one to target specific customers</td></tr>'}
      </table></div>`);
    const root = document.getElementById('cc-content');
    root.querySelector('#seg-new')?.addEventListener('click', () => this.showSegmentModal());
    root.querySelectorAll('[data-eval]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await CommAPI.evaluateSegment(Number(b.dataset.eval));
        const n = Array.isArray(r) ? r.length : (r?.count ?? r?.members ?? 0);
        this.toast(`Segment matches ${n} customer(s)`);
        this.pageSegments();
      } catch (e) { this.toast(e.message, 'error'); }
    }));
  },

  showSegmentModal() {
    this.showModal('New segment', `
      <label class="cc-field">Name<input id="m-s-name" placeholder="High-value loyalty"></label>
      <label class="cc-field">Description<textarea id="m-s-desc"></textarea></label>
      <label class="cc-field">Rule type<select id="m-s-type">
        <option value="loyalty_points">Loyalty points above</option>
        <option value="inactive_days">Inactive for days</option>
        <option value="loyalty_expiring">Points expiring within days</option>
        <option value="all">All customers</option>
      </select></label>
      <label class="cc-field">Value<input type="number" id="m-s-val" value="100"></label>
    `, `<button class="cc-btn cc-btn-ghost" id="m-cancel">Cancel</button>
       <button class="cc-btn cc-btn-primary" id="m-save">Save</button>`);
    const modal = document.getElementById('cc-modal');
    modal.querySelector('#m-cancel')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#m-save')?.addEventListener('click', async () => {
      try {
        const type = modal.querySelector('#m-s-type')?.value;
        const val = Number(modal.querySelector('#m-s-val')?.value);
        let rules = { type: 'all' };
        if (type === 'loyalty_points') rules = { min_points: val };
        else if (type === 'inactive_days') rules = { inactive_days: val };
        else if (type === 'loyalty_expiring') rules = { type: 'loyalty_expiring', days_before: val };
        else if (type !== 'all') rules = { type, value: val };
        await CommAPI.saveSegment({
          name: modal.querySelector('#m-s-name')?.value.trim(),
          description: modal.querySelector('#m-s-desc')?.value.trim(),
          rules
        });
        this.closeModal();
        this.toast('Segment saved');
        this.pageSegments();
      } catch (e) { this.toast(e.message, 'error'); }
    });
  },

  /* ── Providers ── */
  async pageProviders() {
    if (!this.isAdmin()) {
      this.setContent('<div class="cc-panel"><p class="lead">Admin access required.</p></div>');
      return;
    }
    const rows = await CommAPI.providers();
    this.setContent(`
      <div class="cc-panel"><p class="lead">Configure SMS, WhatsApp, email and push providers. API keys are stored securely on the server — never exposed in the browser.</p></div>
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>Channel</th><th>Provider</th><th>Status</th><th>Last test</th><th></th></tr>
        ${rows.map((p) => `<tr>
          <td>${this.tag(p.channel, 'info')}</td>
          <td><strong>${this.esc(p.name)}</strong><div class="meta">${this.esc(p.provider_key)}</div></td>
          <td>${p.is_active ? this.tag('Active', 'ok') : this.tag('Inactive', 'muted')}${p.is_default ? ` ${this.tag('Default', 'info')}` : ''}</td>
          <td>${p.last_test_at ? `${this.esc(p.last_test_at.slice(0, 16))} — ${this.statusTag(p.last_test_status || 'unknown')}` : '—'}</td>
          <td>
            <button class="cc-btn cc-btn-ghost cc-btn-sm" data-test="${p.id}">Test</button>
            <button class="cc-btn cc-btn-ghost cc-btn-sm" data-edit="${p.id}">Configure</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="cc-empty">No providers</td></tr>'}
      </table></div>`);
    const root = document.getElementById('cc-content');
    root.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await CommAPI.testProvider(Number(b.dataset.test));
        this.toast(r.message || 'Connection test completed');
        this.pageProviders();
      } catch (e) { this.toast(e.message, 'error'); }
    }));
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const p = rows.find((x) => String(x.id) === b.dataset.edit);
      if (p) this.showProviderModal(p);
    }));
  },

  showProviderModal(p) {
    const cfg = p.config || {};
    this.showModal(`Configure ${p.name}`, `
      <label class="cc-field">Display name<input id="m-p-name" value="${this.esc(p.name)}"></label>
      <label class="cc-field"><input type="checkbox" id="m-p-active" ${p.is_active ? 'checked' : ''}> Active</label>
      <label class="cc-field"><input type="checkbox" id="m-p-default" ${p.is_default ? 'checked' : ''}> Default for ${this.esc(p.channel)}</label>
      <label class="cc-field">API endpoint<input id="m-p-endpoint" value="${this.esc(cfg.endpoint || cfg.api_url || '')}" placeholder="https://…"></label>
      <label class="cc-field">API key<input id="m-p-key" value="${cfg.api_key ? '••••••••' : ''}" placeholder="Leave blank to keep existing"></label>
      <label class="cc-field">Sender ID / From<input id="m-p-sender" value="${this.esc(cfg.sender_id || cfg.from || '')}"></label>
    `, `<button class="cc-btn cc-btn-ghost" id="m-cancel">Cancel</button>
       <button class="cc-btn cc-btn-primary" id="m-save">Save</button>`);
    const modal = document.getElementById('cc-modal');
    modal.querySelector('#m-cancel')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#m-save')?.addEventListener('click', async () => {
      try {
        await CommAPI.saveProvider({
          id: p.id,
          name: modal.querySelector('#m-p-name')?.value.trim(),
          is_active: modal.querySelector('#m-p-active')?.checked,
          is_default: modal.querySelector('#m-p-default')?.checked,
          config: {
            endpoint: modal.querySelector('#m-p-endpoint')?.value.trim(),
            api_key: modal.querySelector('#m-p-key')?.value,
            sender_id: modal.querySelector('#m-p-sender')?.value.trim()
          }
        });
        this.closeModal();
        this.toast('Provider saved');
        this.pageProviders();
      } catch (e) { this.toast(e.message, 'error'); }
    });
  },

  /* ── Settings ── */
  async pageSettings() {
    if (!this.isAdmin()) {
      this.setContent('<div class="cc-panel"><p class="lead">Admin access required.</p></div>');
      return;
    }
    const s = await CommAPI.settings();
    const lim = s.usage_limits || {};
    this.setContent(`
      <div class="cc-panel">
        <h3>General</h3>
        <label class="cc-field">Loyalty points expiry (days)<input type="number" id="s-expiry" value="${s.loyalty_expiry_days || 365}"></label>
        <label class="cc-field">Timezone<input id="s-tz" value="${this.esc(s.default_timezone || 'Africa/Johannesburg')}"></label>
        <label class="cc-field">Admin log retention (days)<input type="number" id="s-ret" value="${s.log_retention_days || 90}"></label>
      </div>
      <div class="cc-panel">
        <h3>Usage limits (monthly)</h3>
        <div class="cc-grid">
          <label class="cc-field">SMS<input type="number" id="s-sms" value="${lim.sms || 5000}"></label>
          <label class="cc-field">WhatsApp<input type="number" id="s-wa" value="${lim.whatsapp || 5000}"></label>
          <label class="cc-field">Email<input type="number" id="s-em" value="${lim.email || 10000}"></label>
          <label class="cc-field">Push<input type="number" id="s-push" value="${lim.push || 50000}"></label>
        </div>
      </div>
      <div class="cc-panel">
        <h3>Logging</h3>
        <label class="cc-field"><input type="checkbox" id="s-log-admin" ${s.log_admin_actions !== false ? 'checked' : ''}> Log admin actions</label>
        <label class="cc-field"><input type="checkbox" id="s-log-msg" ${s.log_message_events !== false ? 'checked' : ''}> Log message events</label>
      </div>
      <button type="button" class="cc-btn cc-btn-primary" id="s-save">Save settings</button>`);
    document.getElementById('s-save')?.addEventListener('click', async () => {
      try {
        await CommAPI.saveSettings({
          loyalty_expiry_days: Number(document.getElementById('s-expiry')?.value) || 365,
          default_timezone: document.getElementById('s-tz')?.value.trim(),
          log_retention_days: Number(document.getElementById('s-ret')?.value) || 90,
          log_admin_actions: document.getElementById('s-log-admin')?.checked,
          log_message_events: document.getElementById('s-log-msg')?.checked,
          usage_limits: {
            sms: Number(document.getElementById('s-sms')?.value) || 5000,
            whatsapp: Number(document.getElementById('s-wa')?.value) || 5000,
            email: Number(document.getElementById('s-em')?.value) || 10000,
            push: Number(document.getElementById('s-push')?.value) || 50000
          }
        });
        this.toast('Settings saved');
      } catch (e) { this.toast(e.message, 'error'); }
    });
  },

  /* ── Portal users ── */
  async pagePortal() {
    if (!this.isAdmin()) {
      this.setContent('<div class="cc-panel"><p class="lead">Admin access required.</p></div>');
      return;
    }
    const rows = await CommAPI.portalUsers();
    this.setContent(`
      <div class="cc-panel">
        <p class="lead">Create usernames and passwords for staff to sign in at <strong>/communications/</strong>. You can also sign in with your Admin or Manager shop credentials.</p>
        <h3>Create portal login</h3>
        <div class="cc-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
          <label class="cc-field">Username<input id="pu-user"></label>
          <label class="cc-field">Full name<input id="pu-name"></label>
          <label class="cc-field">Password<input type="password" id="pu-pass"></label>
          <label class="cc-field">Role<select id="pu-role">
            <option value="marketing">Marketing — create &amp; send</option>
            <option value="viewer">Viewer — read only</option>
            <option value="admin">Admin — full access</option>
          </select></label>
        </div>
        <button type="button" class="cc-btn cc-btn-primary" id="pu-save">Create login</button>
      </div>
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>Username</th><th>Name</th><th>Role</th><th>Last login</th><th>Status</th><th></th></tr>
        ${rows.map((u) => `<tr>
          <td>${this.esc(u.username)}</td>
          <td>${this.esc(u.full_name)}</td>
          <td>${this.tag(u.role, 'info')}</td>
          <td>${this.esc(u.last_login_at || 'Never')}</td>
          <td>${u.is_active ? this.tag('Active', 'ok') : this.tag('Disabled', 'bad')}</td>
          <td><button class="cc-btn cc-btn-ghost cc-btn-sm" data-toggle="${u.id}" data-on="${u.is_active ? 0 : 1}">${u.is_active ? 'Disable' : 'Enable'}</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="cc-empty">No portal logins yet</td></tr>'}
      </table></div>`);
    const root = document.getElementById('cc-content');
    root.querySelector('#pu-save')?.addEventListener('click', async () => {
      try {
        await CommAPI.savePortalUser({
          username: root.querySelector('#pu-user')?.value.trim(),
          full_name: root.querySelector('#pu-name')?.value.trim(),
          password: root.querySelector('#pu-pass')?.value,
          role: root.querySelector('#pu-role')?.value
        });
        this.toast('Portal login created');
        this.pagePortal();
      } catch (e) { this.toast(e.message, 'error'); }
    });
    root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try { await CommAPI.setPortalUserActive(Number(b.dataset.toggle), b.dataset.on === '1'); this.pagePortal(); } catch (e) { this.toast(e.message, 'error'); }
    }));
  },

  /* ── Admin logs ── */
  async pageLogs() {
    if (!this.isAdmin()) {
      this.setContent('<div class="cc-panel"><p class="lead">Admin access required.</p></div>');
      return;
    }
    const rows = await CommAPI.adminLogs({ from: this.filters.from, to: this.filters.to, limit: 300 });
    this.setContent(`
      ${this.dateToolbar()}
      <div class="cc-panel cc-table-wrap"><table class="cc-table">
        <tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr>
        ${rows.map((l) => `<tr>
          <td>${this.esc(l.created_at)}</td>
          <td>${this.esc(l.username)}</td>
          <td>${this.tag(l.action, 'info')}</td>
          <td>${this.esc(l.entity_type || '—')}${l.entity_id ? ` #${l.entity_id}` : ''}</td>
          <td><code style="font-size:11px">${this.esc(JSON.stringify(l.details || {}))}</code></td>
        </tr>`).join('') || '<tr><td colspan="5" class="cc-empty">No admin logs in this period</td></tr>'}
      </table></div>`);
    this.bindDateToolbar(document.getElementById('cc-content'), () => this.pageLogs());
  }
};

document.addEventListener('DOMContentLoaded', () => CommApp.init());
