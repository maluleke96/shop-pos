/**
 * Standalone Marketing Agent application (shell + functional views).
 * Export: window.MarketingAgentApp
 */
const MarketingAgentApp = {
  view: 'dashboard',
  data: {},
  container: null,
  app: null,

  actor() {
    return (this.app && this.app.user) || (typeof App !== 'undefined' && App.user) || null;
  },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${Number(n || 0).toFixed(2)}`;
  },

  toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info');
    else alert(msg);
  },

  async apiOk(promise, fallbackMsg) {
    const r = await promise;
    if (!r || r.success === false) {
      this.toast((r && r.error) || fallbackMsg || 'Request failed', 'error');
      return null;
    }
    return r.data !== undefined ? r.data : r;
  },

  NAV_GROUPS: [
    {
      title: 'Overview',
      items: [
        ['dashboard', 'Dashboard', 'DB'],
        ['performance', 'My Performance', 'KP'],
        ['tasks', 'Tasks', 'TK'],
        ['notifications', 'Notifications', 'NT']
      ]
    },
    {
      title: 'Create',
      items: [
        ['design-studio', 'Design Studio', 'DS'],
        ['menu-builder', 'Menu Builder', 'MB'],
        ['flyer-poster', 'Flyer & Poster', 'FP'],
        ['campaign-studio', 'Campaign Studio', 'CS'],
        ['media', 'Media Library', 'ML']
      ]
    },
    {
      title: 'Grow',
      items: [
        ['customers', 'Customers', 'CU'],
        ['recruitment', 'Recruitment', 'RC'],
        ['referrals', 'Referrals', 'RF'],
        ['messaging', 'Messaging', 'MS'],
        ['campaigns', 'Campaigns', 'CA'],
        ['feedback', 'Customer Feedback', 'FB']
      ]
    },
    {
      title: 'Account',
      items: [
        ['reports', 'Reports', 'RP'],
        ['settings', 'Settings', 'ST']
      ]
    }
  ],

  FLYER_SPECIALS: [
    ['weekly', 'Weekly Special', 'a4_portrait'],
    ['weekend', 'Weekend Special', 'a4_portrait'],
    ['payday', 'Payday Special', 'a4_portrait'],
    ['bogo', 'Buy 1 Get 1 Free', 'a4_portrait'],
    ['btgt', 'Buy This Get This Free', 'a4_portrait'],
    ['combo', 'Combo Special', 'a4_portrait'],
    ['chicken', 'Chicken Special', 'a4_portrait'],
    ['fish', 'Fish Special', 'a4_portrait'],
    ['burger', 'Burger Special', 'a4_portrait'],
    ['kota', 'Kota Special', 'a4_portrait'],
    ['chips', 'Chips Special', 'a4_portrait'],
    ['delivery', 'Delivery Special', 'a4_portrait'],
    ['flash', 'Flash Sale', 'a4_portrait'],
    ['loyalty', 'Loyalty Promotion', 'a4_portrait'],
    ['referral', 'Referral Promotion', 'a4_portrait'],
    ['branch', 'Branch Promotion', 'a4_portrait'],
    ['poster', 'Poster', 'poster'],
    ['social', 'Social Post', 'social_square']
  ],

  VIEW_TITLES: {
    dashboard: 'Dashboard',
    performance: 'My Performance',
    tasks: 'Tasks',
    notifications: 'Notifications',
    'design-studio': 'Design Studio',
    'menu-builder': 'Menu Builder',
    'flyer-poster': 'Flyer & Poster',
    'campaign-studio': 'Campaign Studio',
    media: 'Media Library',
    customers: 'Customers',
    recruitment: 'Recruitment',
    referrals: 'Referrals',
    messaging: 'Messaging',
    campaigns: 'Campaigns',
    feedback: 'Customer Feedback',
    reports: 'Reports',
    settings: 'Settings'
  },

  MENU_TYPES: [
    'main', 'breakfast', 'lunch', 'dinner', 'chicken', 'braai', 'steak', 'wors', 'fish',
    'kota', 'burger', 'chips', 'drinks', 'combo', 'delivery', 'weekly_special', 'branch',
    'digital', 'printable'
  ],

  GROUP_TAGS: [
    'New Customers', 'Regular', 'Inactive', 'Delivery', 'Loyalty', 'Referral', 'Branch', 'Students'
  ],

  exit() {
    try {
      if (window.MarketingFlyersPage) MarketingFlyersPage.hostEl = null;
    } catch (_) { /* ignore */ }
    if (typeof App !== 'undefined' && typeof App.closeMarketingAgent === 'function') {
      App.closeMarketingAgent();
    } else if (typeof App !== 'undefined' && typeof App.navigate === 'function') {
      App.navigate('dashboard');
    }
  },

  askText(title, label, def = '') {
    return new Promise((resolve) => {
      if (typeof Utils?.showModal !== 'function') {
        resolve(window.prompt(label || title, def) || '');
        return;
      }
      Utils.showModal(title, `
        <div class="field"><label>${this.esc(label || 'Value')}</label>
          <input id="mkt-ask-input" value="${this.esc(def)}" autofocus></div>`,
        `<button type="button" class="btn btn-ghost" id="mkt-ask-cancel">Cancel</button>
         <button type="button" class="btn btn-primary" id="mkt-ask-ok">OK</button>`);
      const done = (v) => { Utils.hideModal(); resolve(v); };
      document.getElementById('mkt-ask-cancel')?.addEventListener('click', () => done(null));
      document.getElementById('mkt-ask-ok')?.addEventListener('click', () => {
        done(document.getElementById('mkt-ask-input')?.value ?? '');
      });
      document.getElementById('mkt-ask-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('mkt-ask-ok')?.click();
      });
    });
  },

  askNumber(title, label, def = '0') {
    return this.askText(title, label, String(def)).then((v) => {
      if (v == null) return null;
      const n = parseFloat(String(v).replace(/,/g, ''));
      return Number.isFinite(n) ? n : 0;
    });
  },

  renderLogin(root) {
    const shop = this.app?.settings?.app_display_name
      || this.app?.settings?.shop_name
      || 'Shop POS';
    root.innerHTML = `
      <div class="mkt-login-wrap">
        <div class="mkt-login-card">
          <div class="mkt-brand-mark">MA</div>
          <h1>Marketing Agent System</h1>
          <p class="mkt-login-sub">Sign in with a Marketing Agent account. Owners and managers can preview. · ${this.esc(shop)}</p>
          <div class="field"><label>Username</label><input type="text" id="mkt-login-user" autocomplete="username" autofocus></div>
          <div class="field"><label>Password</label><input type="password" id="mkt-login-pass" autocomplete="current-password"></div>
          <div class="field"><label>PIN <span class="muted">(optional)</span></label><input type="password" id="mkt-login-pin" maxlength="6" inputmode="numeric"></div>
          <hr style="border:0;border-top:1px solid #e2e8f0;margin:16px 0">
          <div class="field"><label>Or temporary access token</label><input type="password" id="mkt-login-token" placeholder="Paste Admin-issued token" autocomplete="off"></div>
          <p id="mkt-login-err" class="error-msg hidden"></p>
          <button type="button" class="btn btn-primary btn-lg btn-block" id="mkt-login-btn" style="background:#0f766e;border-color:#0f766e">Sign In</button>
          <button type="button" class="btn btn-ghost btn-block" id="mkt-login-token-btn" style="margin-top:8px">Sign in with token</button>
          <button type="button" class="btn btn-ghost btn-block" id="mkt-login-back" style="margin-top:10px">← Back to POS Login</button>
        </div>
      </div>`;
    document.getElementById('mkt-login-back')?.addEventListener('click', () => this.exit());
    document.getElementById('mkt-login-btn')?.addEventListener('click', () => this.doLogin());
    document.getElementById('mkt-login-token-btn')?.addEventListener('click', () => this.doTokenLogin());
    document.getElementById('mkt-login-pass')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doLogin();
    });
    document.getElementById('mkt-login-pin')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doLogin();
    });
  },

  deviceId() {
    try {
      let id = localStorage.getItem('shoppos_mkt_device_id');
      if (!id) {
        id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem('shoppos_mkt_device_id', id);
      }
      return id;
    } catch {
      return null;
    }
  },

  async doTokenLogin() {
    const token = document.getElementById('mkt-login-token')?.value.trim();
    const err = document.getElementById('mkt-login-err');
    if (!err) return;
    if (!token) {
      err.textContent = 'Paste the temporary token from Admin';
      err.classList.remove('hidden');
      return;
    }
    const res = await API.mktLoginToken(token, this.deviceId());
    if (!res.success) {
      err.textContent = res.error || 'Token login failed';
      err.classList.remove('hidden');
      return;
    }
    const user = res.data?.user || res.user;
    if (!user) {
      err.textContent = 'Token login failed';
      err.classList.remove('hidden');
      return;
    }
    user.is_active = 1;
    if (this.app) this.app.user = user;
    if (typeof App !== 'undefined') App.user = user;
    this.view = 'dashboard';
    await this.render(this.container, this.app);
  },

  async doLogin() {
    const username = document.getElementById('mkt-login-user')?.value.trim();
    const password = document.getElementById('mkt-login-pass')?.value || '';
    const pin = document.getElementById('mkt-login-pin')?.value || '';
    const err = document.getElementById('mkt-login-err');
    const btn = document.getElementById('mkt-login-btn');
    if (!err) return;
    if (!username || !password) {
      err.textContent = 'Username and password required';
      err.classList.remove('hidden');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    try {
      const res = await API.login(username, password, pin || null);
      if (!res.success) {
        err.textContent = res.error || 'Login failed';
        err.classList.remove('hidden');
        return;
      }
      const user = res.user || res.data;
      if (!user) {
        err.textContent = 'Login failed';
        err.classList.remove('hidden');
        return;
      }
      if (user.role !== 'marketing_agent' && !['owner', 'manager'].includes(user.role)) {
        err.textContent = 'This login is for Marketing Agents (or Admin preview)';
        err.classList.remove('hidden');
        try { await API.logout(); } catch (_) { /* ignore */ }
        return;
      }
      user.is_active = 1;
      if (this.app) this.app.user = user;
      if (typeof App !== 'undefined') App.user = user;
      this.view = 'dashboard';
      await this.render(this.container, this.app);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
    }
  },

  async navigate(view) {
    this.view = view || 'dashboard';
    if (!this.container?.querySelector?.('.mkt-shell')) {
      await this.render(this.container, this.app);
      return;
    }
    this.updateShellChrome();
    this.closeNav();
    await this.renderContent();
  },

  closeNav() {
    this.container?.querySelector?.('.mkt-shell')?.classList.remove('mkt-nav-open');
  },

  updateShellChrome() {
    const title = this.VIEW_TITLES[this.view] || 'Marketing Agent';
    const titleEl = document.getElementById('mkt-view-title');
    if (titleEl) titleEl.textContent = title;
    this.container?.querySelectorAll?.('[data-mkt-view]')?.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mktView === this.view);
    });
  },

  ensureDraftDefaults() {
    if (!this.data) this.data = {};
    if (!this.data.menuDraft) {
      this.data.menuDraft = {
        id: null,
        title: '',
        menu_type: 'main',
        page_size: 'A4',
        products: [],
        pages: [
          { id: 'p1', title: 'Cover', layout: 'cover' },
          { id: 'p2', title: 'Items', layout: 'grid' }
        ],
        price_alerts: [],
        qr_payload: null,
        digital_slug: null,
        approval_status: 'draft'
      };
    }
    if (!this.data.reportAttachments) this.data.reportAttachments = [];
  },

  renderShell() {
    const user = this.actor();
    const name = this.esc(user?.full_name || user?.username || 'Agent');
    const role = this.esc(user?.role || 'agent');
    const navHtml = this.NAV_GROUPS.map((group) => `
      <div class="mkt-nav-section">${this.esc(group.title)}</div>
      ${group.items.map(([id, label, ico]) => `
        <button type="button" class="mkt-nav-btn ${this.view === id ? 'active' : ''}" data-mkt-view="${id}">
          <span class="mkt-nav-ico">${this.esc(ico)}</span>
          <span>${this.esc(label)}</span>
        </button>`).join('')}
    `).join('');

    this.container.innerHTML = `
      <div class="mkt-shell">
        <div class="mkt-sidebar-backdrop" id="mkt-sidebar-backdrop" aria-hidden="true"></div>
        <aside class="mkt-sidebar" id="mkt-sidebar">
          <div class="mkt-brand">
            <div class="mkt-brand-mark">MA</div>
            <strong>Marketing Agent</strong>
            <small>${name} · ${role}</small>
          </div>
          <nav class="mkt-nav">${navHtml}</nav>
          <div class="mkt-side-foot">
            <button type="button" class="mkt-nav-btn" id="mkt-exit">Exit to POS Login</button>
          </div>
        </aside>
        <main class="mkt-main">
          <div class="mkt-topbar">
            <button type="button" class="btn-icon mkt-menu-toggle" id="mkt-menu-toggle" aria-label="Open menu">☰</button>
            <h2 id="mkt-view-title">${this.esc(this.VIEW_TITLES[this.view] || 'Dashboard')}</h2>
            <div class="mkt-topbar-actions">
              <span class="mkt-user-chip"><span class="mkt-user-dot"></span>${name}</span>
              <button type="button" class="btn btn-ghost btn-sm" id="mkt-exit-top">Exit</button>
            </div>
          </div>
          <div id="mkt-content"><p class="muted">Loading…</p></div>
        </main>
      </div>`;

    document.getElementById('mkt-menu-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.container.querySelector('.mkt-shell')?.classList.toggle('mkt-nav-open');
    });
    document.getElementById('mkt-sidebar-backdrop')?.addEventListener('click', () => this.closeNav());
    this.container.querySelectorAll('[data-mkt-view]').forEach((btn) => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.mktView));
    });
    document.getElementById('mkt-exit')?.addEventListener('click', () => this.exit());
    document.getElementById('mkt-exit-top')?.addEventListener('click', () => this.exit());
  },

  async render(container, app) {
    this.container = container || this.container;
    this.app = app || this.app;
    if (!this.container) return;
    this.ensureDraftDefaults();

    const user = this.actor();
    if (!user) {
      this.renderLogin(this.container);
      return;
    }

    this.renderShell();
    await this.renderContent();
  },

  async renderContent() {
    const el = document.getElementById('mkt-content');
    if (!el) return;
    el.innerHTML = '<p class="muted">Loading…</p>';
    try {
      await this.renderView(el);
    } catch (err) {
      el.innerHTML = `<p class="error-msg">${this.esc(err.message || 'Failed to load view')}</p>`;
    }
  },

  async renderView(el) {
    if (this.view !== 'campaign-studio' && window.MarketingFlyersPage) {
      MarketingFlyersPage.hostEl = null;
    }
    const map = {
      dashboard: () => this.renderDashboard(el),
      'design-studio': () => this.renderDesignStudio(el),
      'menu-builder': () => this.renderMenuBuilder(el),
      'flyer-poster': () => this.renderFlyerPoster(el),
      'campaign-studio': () => this.renderCampaignStudio(el),
      customers: () => this.renderCustomers(el),
      recruitment: () => this.renderRecruitment(el),
      messaging: () => this.renderMessaging(el),
      campaigns: () => this.renderCampaigns(el),
      feedback: () => this.renderFeedback(el),
      referrals: () => this.renderReferrals(el),
      tasks: () => this.renderTasks(el),
      media: () => this.renderMedia(el),
      performance: () => this.renderPerformance(el),
      reports: () => this.renderReports(el),
      notifications: () => this.renderNotifications(el),
      settings: () => this.renderSettings(el)
    };
    const fn = map[this.view] || map.dashboard;
    await fn();
  },

  /* ─── Dashboard ─── */
  async renderDashboard(el) {
    const data = await this.apiOk(API.mktDashboard(this.actor()), 'Could not load dashboard');
    if (!data) {
      el.innerHTML = '<p class="error-msg">Dashboard unavailable</p>';
      return;
    }
    this.data.dashboard = data;
    const sync = data.sync || {};
    const summary = data.summary || {};
    const kpis = data.kpis || [];
    const tasks = data.today_tasks || [];

    el.innerHTML = `
      <div class="mkt-hero">
        <div>
          <h3>${this.esc(data.agent?.full_name || this.actor()?.full_name || 'Agent')}</h3>
          <p>Referral code <code>${this.esc(data.agent?.referral_code || '—')}</code>
            · Sync <span class="mkt-tag">${this.esc(sync.status || 'idle')}</span>
            · Pending ${Number(sync.pending) || 0} · Failed ${Number(sync.failed) || 0}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" data-goto="design-studio">Create asset</button>
          <button type="button" class="btn btn-ghost" data-goto="tasks">View tasks</button>
          <button type="button" class="btn btn-ghost" data-goto="recruitment">Recruit</button>
        </div>
      </div>
      <div class="mkt-kpi-grid">
        <div class="mkt-kpi"><div class="label">Recruited</div><div class="value">${summary.customers_recruited || 0}</div></div>
        <div class="mkt-kpi"><div class="label">Converted</div><div class="value">${summary.customers_converted || 0}</div></div>
        <div class="mkt-kpi"><div class="label">Referrals</div><div class="value">${summary.referrals || 0}</div></div>
        <div class="mkt-kpi"><div class="label">Attributed sales</div><div class="value">${this.money(summary.attributed_sales)}</div></div>
        <div class="mkt-kpi"><div class="label">Campaigns</div><div class="value">${summary.campaigns || 0}</div></div>
        <div class="mkt-kpi"><div class="label">Open tasks</div><div class="value">${summary.tasks_open || 0}</div></div>
        <div class="mkt-kpi"><div class="label">Pending approvals</div><div class="value">${summary.pending_approvals || 0}</div></div>
        <div class="mkt-kpi"><div class="label">Messages</div><div class="value">${summary.messages || 0}</div></div>
      </div>
      <div class="mkt-panel">
        <div class="mkt-panel-h"><h3>KPI scorecard</h3><button type="button" class="btn btn-ghost btn-sm" data-goto="performance">Full scorecard</button></div>
        <div class="mkt-panel-b">
          <div class="table-wrap"><table>
            <thead><tr><th>KPI</th><th>Target</th><th>Actual</th><th>Achievement %</th></tr></thead>
            <tbody>
              ${kpis.map(k => `<tr>
                <td>${this.esc(k.label)}</td>
                <td>${this.esc(k.target)}</td>
                <td>${this.esc(k.actual)}</td>
                <td><strong>${this.esc(k.achievement)}%</strong></td>
              </tr>`).join('') || '<tr><td colspan="4" class="muted">No KPIs yet — Admin can set targets</td></tr>'}
            </tbody>
          </table></div>
        </div>
      </div>
      <div class="mkt-panel">
        <div class="mkt-panel-h"><h3>Today's tasks</h3><button type="button" class="btn btn-ghost btn-sm" data-goto="tasks">All tasks</button></div>
        <div class="mkt-panel-b">
          <div class="table-wrap"><table>
            <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Due</th></tr></thead>
            <tbody>
              ${tasks.map(t => `<tr>
                <td>${this.esc(t.title)}</td>
                <td>${this.esc(t.task_type || '—')}</td>
                <td><span class="mkt-tag">${this.esc(t.status)}</span></td>
                <td>${this.esc(t.due_date || '—')}</td>
              </tr>`).join('') || '<tr><td colspan="4" class="muted">No open tasks</td></tr>'}
            </tbody>
          </table></div>
        </div>
      </div>`;

    el.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.goto));
    });
  },

  /* ─── Design Studio ─── */
  async renderDesignStudio(el) {
    const cards = [
      ['menu', 'Create Menu', 'Build a printable or branch menu with live POS products and approval.'],
      ['digital', 'Digital Menu', 'Create a digital menu ready for QR and online sharing.'],
      ['flyer', 'Create Flyer', 'Start a flyer draft and open Campaign Studio to design it.'],
      ['poster', 'Create Poster', 'Large-format poster draft linked to the design studio.'],
      ['social', 'Create Social', 'Square social post draft for WhatsApp, Instagram, and more.']
    ];
    el.innerHTML = `
      <div class="mkt-hero">
        <div>
          <h3>Design Studio</h3>
          <p>Choose what to create. Each action opens its own working page inside Marketing Agent.</p>
        </div>
        <button type="button" class="btn btn-ghost" id="mkt-open-marketing">Open Campaign Studio</button>
      </div>
      <div class="mkt-action-grid">
        ${cards.map(([id, title, desc]) => `
          <button type="button" class="mkt-action-card" data-create="${id}">
            <strong>${this.esc(title)}</strong>
            <span>${this.esc(desc)}</span>
          </button>`).join('')}
      </div>
      <div class="mkt-panel">
        <div class="mkt-panel-h"><h3>Ready-made specials</h3></div>
        <div class="mkt-panel-b">
          <div class="mkt-action-grid">
            ${this.FLYER_SPECIALS.map(([id, title, size]) => `
              <button type="button" class="mkt-action-card" data-special="${id}" data-size="${size}">
                <strong>${this.esc(title)}</strong>
                <span>Starts a draft titled “${this.esc(title)}” then opens Campaign Studio.</span>
              </button>`).join('')}
          </div>
        </div>
      </div>
      <div class="mkt-panel">
        <div class="mkt-panel-h"><h3>Also available</h3></div>
        <div class="mkt-panel-b" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost" data-goto="menu-builder">Menu Builder</button>
          <button type="button" class="btn btn-ghost" data-goto="flyer-poster">Flyer &amp; Poster list</button>
          <button type="button" class="btn btn-ghost" data-goto="media">Media Library</button>
          <button type="button" class="btn btn-ghost" data-goto="campaigns">Campaigns</button>
        </div>
      </div>`;

    el.querySelectorAll('[data-create]').forEach((btn) => {
      btn.addEventListener('click', () => this.createFromStudio(btn.dataset.create));
    });
    el.querySelectorAll('[data-special]').forEach((btn) => {
      btn.addEventListener('click', () => this.createSpecialFlyer(btn.dataset.special, btn.dataset.size));
    });
    el.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.goto));
    });
    document.getElementById('mkt-open-marketing')?.addEventListener('click', () => this.openMarketingPage());
  },

  async createSpecialFlyer(specialKey, size) {
    const found = this.FLYER_SPECIALS.find(s => s[0] === specialKey);
    const title = found ? found[1] : 'New Special';
    const draft = await this.apiOk(API.saveFlyer({
      title,
      flyer_size: size || 'a4_portrait',
      status: 'draft',
      approval_status: 'draft',
      promotion_name: title,
      canvas_json: { headline: title, background: '#0f766e', terms: 'While stocks last. Prices include VAT where applicable.' },
      products_json: [],
      pages_json: [{ id: 'p1', title: 'Page 1', elements: [] }]
    }, this.actor()), 'Could not create special draft');
    if (!draft) return;
    const id = draft.id || draft.data?.id;
    this.toast(`${title} draft created`, 'success');
    await this.openMarketingPage({ flyerId: id, step: 2 });
  },

  async ensureMarketingScripts() {
    if (typeof App?.ensureFeatureScript === 'function') {
      try {
        await App.ensureFeatureScript('js/pages/marketing-flyers.js');
        await App.ensureFeatureScript('js/pages/marketing-flyers-studio.js');
      } catch (_) { /* ignore */ }
    }
    if (typeof App?.ensurePageScripts === 'function') {
      try { await App.ensurePageScripts('marketing'); } catch (_) { /* ignore */ }
    }
    if (typeof Utils?.loadScript === 'function') {
      try {
        await Utils.loadScript('js/pages/marketing-flyers.js');
        await Utils.loadScript('js/pages/marketing-flyers-studio.js');
      } catch (_) { /* ignore */ }
    }
  },

  async openMarketingPage(opts = {}) {
    this.data.pendingFlyerOpen = opts.flyerId || null;
    this.data.pendingFlyerStep = opts.step || 2;
    await this.navigate('campaign-studio');
  },

  async renderCampaignStudio(el) {
    await this.ensureMarketingScripts();
    const page = window.MarketingFlyersPage;
    if (!page?.render) {
      el.innerHTML = `<div class="mkt-panel"><div class="mkt-panel-b">
        <p class="error-msg">Campaign Studio failed to load.</p>
        <button type="button" class="btn btn-ghost" id="mkt-studio-back">← Back to Flyer list</button>
      </div></div>`;
      document.getElementById('mkt-studio-back')?.addEventListener('click', () => this.navigate('flyer-poster'));
      return;
    }
    el.innerHTML = `
      <div class="mkt-hero" style="margin-bottom:12px">
        <div>
          <h3>Campaign Studio</h3>
          <p>Full flyer / poster / social designer — stays inside Marketing Agent.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="mkt-studio-back">← Flyer list</button>
      </div>
      <div id="mkt-studio-host"></div>`;
    document.getElementById('mkt-studio-back')?.addEventListener('click', () => {
      page.hostEl = null;
      this.navigate('flyer-poster');
    });
    const host = document.getElementById('mkt-studio-host');
    page.hostEl = host;
    page.app = this.app;
    page.view = 'list';
    page.tab = 'campaigns';
    await page.render(host, this.app);
    const flyerId = this.data.pendingFlyerOpen;
    if (flyerId) {
      this.data.pendingFlyerOpen = null;
      await page.openFlyer(flyerId, host, this.data.pendingFlyerStep || 2);
    }
  },

  async createFromStudio(kind) {
    if (kind === 'menu' || kind === 'digital') {
      this.data.menuDraft = {
        id: null,
        title: kind === 'digital' ? 'Digital Menu' : 'New Menu',
        menu_type: kind === 'digital' ? 'digital' : 'main',
        products: [],
        pages: [
          { id: 'p1', title: 'Cover', layout: 'cover' },
          { id: 'p2', title: 'Items', layout: 'grid' }
        ],
        price_alerts: [],
        qr_payload: null,
        approval_status: 'draft'
      };
      return this.navigate('menu-builder');
    }
    const titles = { flyer: 'New Flyer', poster: 'New Poster', social: 'Social Post' };
    const sizes = {
      flyer: 'a4_portrait',
      poster: 'poster',
      social: 'social_square'
    };
    const draft = await this.apiOk(API.saveFlyer({
      title: titles[kind] || 'New Flyer',
      flyer_size: sizes[kind] || 'a4_portrait',
      status: 'draft',
      approval_status: 'draft',
      canvas_json: {},
      products_json: [],
      pages_json: [{ id: 'p1', title: 'Page 1', elements: [] }]
    }, this.actor()), 'Could not create flyer draft');
    if (!draft) return;
    const id = draft.id || draft.data?.id;
    this.toast('Draft created — opening Campaign Studio', 'success');
    await this.openMarketingPage({ flyerId: id, step: 2 });
  },

  /* ─── Menu Builder ─── */
  async renderMenuBuilder(el) {
    const draft = this.data.menuDraft;
    const menus = (await this.apiOk(API.mktMenus({}, this.actor()), 'Could not load menus')) || [];
    const typeOpts = this.MENU_TYPES.map(t =>
      `<option value="${t}" ${draft.menu_type === t ? 'selected' : ''}>${this.esc(t)}</option>`
    ).join('');

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>Your menus</h3>
          <button type="button" class="btn btn-ghost btn-sm" id="mkt-menu-new">New blank menu</button>
        </div>
        <div class="card-body">
          <div class="table-wrap"><table>
            <thead><tr><th>Title</th><th>Type</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${menus.map(m => `<tr>
                <td>${this.esc(m.title)}</td>
                <td>${this.esc(m.menu_type)}</td>
                <td><span class="tag">${this.esc(m.approval_status || m.status)}</span></td>
                <td><button type="button" class="btn btn-sm btn-ghost mkt-load-menu" data-id="${m.id}">Edit</button></td>
              </tr>`).join('') || '<tr><td colspan="4" class="muted">No menus yet</td></tr>'}
            </tbody>
          </table></div>
        </div>
      </div>
      <div class="card"><div class="card-body">
        <div class="form-grid">
          <div class="field"><label>Title</label><input id="mkt-menu-title" value="${this.esc(draft.title || '')}"></div>
          <div class="field"><label>Menu type</label><select id="mkt-menu-type">${typeOpts}</select></div>
          <div class="field"><label>Page size</label>
            <select id="mkt-menu-size">
              ${['A4', 'A5', 'A3', 'Letter', 'Square'].map(s =>
                `<option value="${s}" ${draft.page_size === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field" style="margin-top:12px">
          <label>Product search</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="mkt-prod-q" placeholder="Search POS products…" style="flex:1;min-width:160px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="mkt-prod-stock"> In stock only</label>
            <button type="button" class="btn btn-ghost" id="mkt-prod-search">Search</button>
          </div>
          <div id="mkt-prod-results" style="margin-top:8px"></div>
        </div>
        <h4 style="margin:16px 0 8px">Products on menu</h4>
        <div id="mkt-menu-products" class="table-wrap"></div>
        <h4 style="margin:16px 0 8px">Pages</h4>
        <div id="mkt-menu-pages"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button type="button" class="btn btn-ghost btn-sm" id="mkt-page-add">Add page</button>
        </div>
        <div id="mkt-price-alerts" style="margin-top:12px"></div>
        <div id="mkt-qr-box" style="margin-top:12px"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
          <button type="button" class="btn btn-primary" id="mkt-menu-save">Save draft</button>
          <button type="button" class="btn btn-success" id="mkt-menu-submit">Submit for approval</button>
          <button type="button" class="btn btn-ghost" id="mkt-menu-prices">Update prices from POS</button>
          <button type="button" class="btn btn-ghost" id="mkt-menu-template">Save as template</button>
          <button type="button" class="btn btn-ghost" id="mkt-menu-print">Print / PDF</button>
          <button type="button" class="btn btn-ghost" id="mkt-menu-digital">Digital menu &amp; QR</button>
        </div>
      </div></div>`;

    const paintProducts = () => {
      const wrap = document.getElementById('mkt-menu-products');
      const list = draft.products || [];
      wrap.innerHTML = `<table><thead><tr><th>Name</th><th>Price</th><th>Description</th><th></th></tr></thead><tbody>
        ${list.map((p, i) => `<tr>
          <td>${this.esc(p.name)}</td>
          <td>${this.money(p.selling_price)}</td>
          <td class="muted">${this.esc((p.description || '').slice(0, 80))}</td>
          <td><button type="button" class="btn btn-sm btn-danger mkt-rm-prod" data-i="${i}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No products added</td></tr>'}
      </tbody></table>`;
      wrap.querySelectorAll('.mkt-rm-prod').forEach((b) => {
        b.addEventListener('click', () => {
          draft.products.splice(parseInt(b.dataset.i, 10), 1);
          paintProducts();
        });
      });
    };

    const paintPages = () => {
      const box = document.getElementById('mkt-menu-pages');
      box.innerHTML = (draft.pages || []).map((p, i) => `
        <div class="field" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px">
          <div style="flex:1;min-width:160px"><label>Page ${i + 1}</label>
            <input class="mkt-page-title" data-i="${i}" value="${this.esc(p.title || '')}"></div>
          <button type="button" class="btn btn-sm btn-ghost mkt-page-up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-sm btn-ghost mkt-page-dn" data-i="${i}" ${i >= draft.pages.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn btn-sm btn-ghost mkt-page-dup" data-i="${i}">Duplicate</button>
          <button type="button" class="btn btn-sm btn-danger mkt-page-del" data-i="${i}">Delete</button>
        </div>`).join('') || '<p class="muted">No pages</p>';
      box.querySelectorAll('.mkt-page-title').forEach((inp) => {
        inp.addEventListener('change', () => {
          draft.pages[parseInt(inp.dataset.i, 10)].title = inp.value.trim();
        });
      });
      box.querySelectorAll('.mkt-page-up').forEach((b) => {
        b.addEventListener('click', () => {
          const i = parseInt(b.dataset.i, 10);
          if (i <= 0) return;
          const tmp = draft.pages[i - 1];
          draft.pages[i - 1] = draft.pages[i];
          draft.pages[i] = tmp;
          paintPages();
        });
      });
      box.querySelectorAll('.mkt-page-dn').forEach((b) => {
        b.addEventListener('click', () => {
          const i = parseInt(b.dataset.i, 10);
          if (i >= draft.pages.length - 1) return;
          const tmp = draft.pages[i + 1];
          draft.pages[i + 1] = draft.pages[i];
          draft.pages[i] = tmp;
          paintPages();
        });
      });
      box.querySelectorAll('.mkt-page-dup').forEach((b) => {
        b.addEventListener('click', () => {
          const i = parseInt(b.dataset.i, 10);
          const src = draft.pages[i];
          draft.pages.splice(i + 1, 0, {
            id: `p${Date.now()}`,
            title: `${src.title || 'Page'} (copy)`,
            layout: src.layout || 'grid',
            elements: Array.isArray(src.elements) ? JSON.parse(JSON.stringify(src.elements)) : []
          });
          paintPages();
        });
      });
      box.querySelectorAll('.mkt-page-del').forEach((b) => {
        b.addEventListener('click', () => {
          if (draft.pages.length <= 1) return this.toast('Keep at least one page', 'error');
          draft.pages.splice(parseInt(b.dataset.i, 10), 1);
          paintPages();
        });
      });
    };

    const paintAlerts = () => {
      const box = document.getElementById('mkt-price-alerts');
      const alerts = draft.price_alerts || [];
      if (!alerts.length) {
        box.innerHTML = '';
        return;
      }
      box.innerHTML = `<div class="card" style="border-color:var(--warning)"><div class="card-body">
        <strong>Price alerts</strong>
        <ul>${alerts.map(a => `<li>${this.esc(a.name)}: ${this.money(a.old_price)} → ${this.money(a.new_price)}</li>`).join('')}</ul>
      </div></div>`;
    };

    const paintQr = () => {
      const box = document.getElementById('mkt-qr-box');
      if (draft.approval_status === 'approved' && (draft.qr_payload || draft.digital_slug)) {
        const slug = draft.digital_slug || '';
        const url = `shoppos://digital-menu/${slug || draft.id}`;
        const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
        box.innerHTML = `<div class="mkt-panel"><div class="mkt-panel-b" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
          <img src="${qrImg}" alt="Digital menu QR" width="180" height="180" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff"
            onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')">
          <div>
            <strong>Digital menu QR</strong>
            <p class="muted" style="margin:6px 0">Slug: <code>${this.esc(slug || String(draft.id))}</code></p>
            <p class="muted hidden">Offline: use code <code>${this.esc(slug || String(draft.id))}</code></p>
            <pre style="white-space:pre-wrap;font-size:11px;max-width:360px">${this.esc(typeof draft.qr_payload === 'string' ? draft.qr_payload : JSON.stringify(draft.qr_payload || { slug }))}</pre>
          </div>
        </div></div>`;
      } else {
        box.innerHTML = '<p class="muted">Digital QR appears after Admin approval.</p>';
      }
    };

    paintProducts();
    paintPages();
    paintAlerts();
    paintQr();

    document.getElementById('mkt-menu-new')?.addEventListener('click', () => {
      this.data.menuDraft = {
        id: null, title: 'New Menu', menu_type: 'main', page_size: 'A4', products: [],
        pages: [{ id: 'p1', title: 'Cover', layout: 'cover' }, { id: 'p2', title: 'Items', layout: 'grid' }],
        price_alerts: [], qr_payload: null, digital_slug: null, approval_status: 'draft'
      };
      this.renderMenuBuilder(el);
    });

    const parseJsonSafe = (v) => {
      try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; }
    };

    el.querySelectorAll('.mkt-load-menu').forEach((b) => {
      b.addEventListener('click', async () => {
        const row = await this.apiOk(API.mktGetMenu(parseInt(b.dataset.id, 10), this.actor()), 'Could not load menu');
        if (!row) return;
        let products = [];
        let pages = [];
        try { products = typeof row.products_json === 'string' ? JSON.parse(row.products_json) : (row.products_json || []); } catch { products = []; }
        try { pages = typeof row.pages_json === 'string' ? JSON.parse(row.pages_json) : (row.pages_json || []); } catch { pages = []; }
        const branding = parseJsonSafe(row.branding_json);
        this.data.menuDraft = {
          id: row.id,
          title: row.title || '',
          menu_type: row.menu_type || 'main',
          page_size: branding.page_size || 'A4',
          products,
          pages: pages.length ? pages : [{ id: 'p1', title: 'Cover' }],
          price_alerts: [],
          qr_payload: row.qr_payload || null,
          digital_slug: row.digital_slug || null,
          approval_status: row.approval_status || row.status
        };
        this.renderMenuBuilder(el);
      });
    });

    document.getElementById('mkt-prod-search')?.addEventListener('click', async () => {
      const q = document.getElementById('mkt-prod-q').value.trim();
      const inStock = !!document.getElementById('mkt-prod-stock')?.checked;
      const products = (await this.apiOk(API.mktProducts({ search: q, in_stock: inStock }, this.actor()), 'Product search failed')) || [];
      const box = document.getElementById('mkt-prod-results');
      box.innerHTML = products.slice(0, 30).map(p => `
        <button type="button" class="btn btn-sm btn-ghost mkt-add-prod" data-id="${p.id}"
          style="margin:2px">${this.esc(p.name)} · ${this.money(p.selling_price)}</button>`).join('') || '<span class="muted">No products</span>';
      box.querySelectorAll('.mkt-add-prod').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = parseInt(btn.dataset.id, 10);
          if (draft.products.some(x => (x.product_id || x.id) === id)) {
            return this.toast('Already on menu', 'info');
          }
          const cards = (await this.apiOk(API.mktProductCards([id]), 'Could not build card')) || [];
          const card = cards[0] || products.find(p => p.id === id);
          if (!card) return;
          draft.products.push({
            product_id: card.product_id || card.id,
            name: card.name,
            selling_price: card.selling_price,
            description: card.description || ''
          });
          paintProducts();
        });
      });
    });

    document.getElementById('mkt-page-add')?.addEventListener('click', () => {
      draft.pages.push({ id: `p${Date.now()}`, title: `Page ${draft.pages.length + 1}`, layout: 'grid', elements: [] });
      paintPages();
    });

    const collectForm = () => {
      draft.title = document.getElementById('mkt-menu-title').value.trim();
      draft.menu_type = document.getElementById('mkt-menu-type').value;
      draft.page_size = document.getElementById('mkt-menu-size')?.value || 'A4';
      return {
        id: draft.id || undefined,
        title: draft.title || 'New Menu',
        menu_type: draft.menu_type,
        products: draft.products,
        pages: draft.pages,
        branding: { page_size: draft.page_size }
      };
    };

    document.getElementById('mkt-menu-save')?.addEventListener('click', async () => {
      const payload = collectForm();
      if (!payload.title) return this.toast('Title required', 'error');
      const saved = await this.apiOk(API.mktSaveMenu(payload, this.actor()), 'Save failed');
      if (!saved) return;
      draft.id = saved.id;
      draft.price_alerts = saved.price_alerts || [];
      draft.approval_status = saved.approval_status || saved.status;
      draft.qr_payload = saved.qr_payload || null;
      paintAlerts();
      paintQr();
      this.toast('Menu draft saved', 'success');
    });

    document.getElementById('mkt-menu-submit')?.addEventListener('click', async () => {
      let id = draft.id;
      if (!id) {
        const saved = await this.apiOk(API.mktSaveMenu(collectForm(), this.actor()), 'Save failed');
        if (!saved) return;
        id = saved.id;
        draft.id = id;
      } else {
        await this.apiOk(API.mktSaveMenu(collectForm(), this.actor()), 'Save failed');
      }
      const sub = await this.apiOk(API.mktSubmitMenu(id, this.actor()), 'Submit failed');
      if (!sub) return;
      draft.approval_status = sub.approval_status || 'pending';
      draft.price_alerts = sub.price_alerts || [];
      paintAlerts();
      this.toast('Submitted for approval', 'success');
    });

    document.getElementById('mkt-menu-prices')?.addEventListener('click', async () => {
      if (!draft.id) return this.toast('Save the menu first', 'error');
      const updated = await this.apiOk(API.mktUpdateMenuPrices(draft.id, this.actor()), 'Price update failed');
      if (!updated) return;
      try {
        draft.products = typeof updated.products_json === 'string' ? JSON.parse(updated.products_json) : (updated.products_json || []);
      } catch { /* keep */ }
      paintProducts();
      this.toast('Prices updated from POS', 'success');
    });

    document.getElementById('mkt-menu-template')?.addEventListener('click', async () => {
      const payload = collectForm();
      const r = await this.apiOk(API.mktSaveMenuTemplate({
        title: `${payload.title} Template`,
        menu_type: payload.menu_type,
        pages: payload.pages,
        products: payload.products,
        page_size: draft.page_size || 'A4',
        branding: payload.branding
      }, this.actor()), 'Template save failed');
      if (!r) return;
      this.toast('Menu template saved', 'success');
    });

    document.getElementById('mkt-menu-print')?.addEventListener('click', async () => {
      if (!draft.id) return this.toast('Save the menu first', 'error');
      const html = await this.apiOk(API.mktMenuPrintHtml(draft.id, this.actor()), 'Print failed');
      if (!html) return;
      const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
      if (!w) return this.toast('Pop-up blocked — allow pop-ups to print', 'error');
      w.document.write(typeof html === 'string' ? html : String(html));
      w.document.close();
    });

    document.getElementById('mkt-menu-digital')?.addEventListener('click', async () => {
      if (!draft.id) return this.toast('Save the menu first', 'error');
      const dig = await this.apiOk(API.mktDigitalMenu(draft.id, this.actor()), 'Digital menu unavailable');
      if (!dig) return;
      draft.digital_slug = dig.digital_slug;
      draft.qr_payload = dig.qr_payload;
      draft.approval_status = dig.approval_status;
      paintQr();
      this.toast(dig.approval_status === 'approved' ? 'Digital menu ready' : 'Menu not approved yet — Admin must approve for QR', 'info');
    });
  },

  /* ─── Flyer & Poster ─── */
  async renderFlyerPoster(el) {
    const user = this.actor();
    const all = (await this.apiOk(API.getFlyers({}), 'Could not load flyers')) || [];
    const mine = all.filter(f => !user?.id || f.created_by === user.id);
    const list = mine.length ? mine : all;

    el.innerHTML = `
      <div class="mkt-hero">
        <div>
          <h3>Flyer &amp; Poster</h3>
          <p>Showing ${mine.length ? 'your' : 'all'} assets (${list.length}). Design opens Campaign Studio in this app.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="mkt-flyer-new">New flyer</button>
          <button type="button" class="btn btn-ghost" id="mkt-flyer-open-mkt">Campaign Studio</button>
        </div>
      </div>
      <div class="mkt-panel"><div class="mkt-panel-b">
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Size</th><th>Status</th><th>Approval</th><th></th></tr></thead>
        <tbody>
          ${list.map(f => `<tr>
            <td>${this.esc(f.title)}</td>
            <td>${this.esc(f.flyer_size || '—')}</td>
            <td>${this.esc(f.status || '—')}</td>
            <td><span class="mkt-tag">${this.esc(f.approval_status || 'draft')}</span></td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-sm btn-primary mkt-flyer-design" data-id="${f.id}">Design</button>
              <button type="button" class="btn btn-sm btn-ghost mkt-flyer-pdf" data-id="${f.id}">PDF</button>
              ${(f.approval_status === 'draft' || f.approval_status === 'rejected' || !f.approval_status)
                ? `<button type="button" class="btn btn-sm btn-success mkt-flyer-submit" data-id="${f.id}">Submit</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No flyers yet — create one above</td></tr>'}
        </tbody>
      </table></div>
      </div></div>`;

    document.getElementById('mkt-flyer-new')?.addEventListener('click', async () => {
      const draft = await this.apiOk(API.saveFlyer({
        title: 'New Flyer',
        flyer_size: 'a4_portrait',
        status: 'draft',
        approval_status: 'draft',
        canvas_json: {},
        products_json: [],
        pages_json: [{ id: 'p1', title: 'Page 1', elements: [] }]
      }, this.actor()), 'Could not create flyer');
      if (!draft) return;
      const id = draft.id || draft.data?.id;
      this.toast('Flyer draft created', 'success');
      if (id) await this.openMarketingPage({ flyerId: id, step: 2 });
      else this.renderFlyerPoster(el);
    });

    document.getElementById('mkt-flyer-open-mkt')?.addEventListener('click', () => this.openMarketingPage());

    el.querySelectorAll('.mkt-flyer-design').forEach((b) => {
      b.addEventListener('click', () => this.openMarketingPage({
        flyerId: parseInt(b.dataset.id, 10),
        step: 2
      }));
    });

    el.querySelectorAll('.mkt-flyer-submit').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await this.apiOk(API.submitFlyerApproval(parseInt(b.dataset.id, 10), this.actor()), 'Submit failed');
        if (!r) return;
        this.toast('Flyer submitted for approval', 'success');
        this.renderFlyerPoster(el);
      });
    });

    el.querySelectorAll('.mkt-flyer-pdf').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await API.getFlyerPdf(parseInt(b.dataset.id, 10));
        if (!r?.success) return this.toast(r?.error || 'PDF failed', 'error');
        this.toast('PDF generated', 'success');
      });
    });
  },

  /* ─── Customers ─── */
  async renderCustomers(el) {
    const customers = (await this.apiOk(API.mktCustomers({}, this.actor()), 'Could not load customers')) || [];
    const groupOpts = this.GROUP_TAGS.map(g => `<option value="${this.esc(g)}">${this.esc(g)}</option>`).join('');

    el.innerHTML = `
      <div class="mkt-hero">
        <div><h3>Customers</h3><p>Capture and tag customers for messaging, campaigns, and recruitment.</p></div>
        <span class="mkt-tag">${customers.length} records</span>
      </div>
      <div class="mkt-panel"><div class="mkt-panel-h"><h4>Add customer</h4></div><div class="mkt-panel-b">
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="mkt-cust-name"></div>
          <div class="field"><label>Phone</label><input id="mkt-cust-phone"></div>
          <div class="field"><label>Source</label><input id="mkt-cust-source" value="agent_recruit"></div>
          <div class="field"><label>Group</label><select id="mkt-cust-group">${groupOpts}</select></div>
          <div class="field"><label><input type="checkbox" id="mkt-cust-consent" checked> Marketing consent</label></div>
        </div>
        <button type="button" class="btn btn-primary" id="mkt-cust-save" style="margin-top:12px">Save customer</button>
      </div></div>
      <div class="mkt-panel"><div class="mkt-panel-b">
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Group</th><th>Source</th><th>Status</th><th>Consent</th></tr></thead>
        <tbody>
          ${customers.map(c => `<tr>
            <td>${this.esc(c.full_name)}</td>
            <td>${this.esc(c.phone || '—')}</td>
            <td>${this.esc(c.group_tag || '—')}</td>
            <td>${this.esc(c.source || '—')}</td>
            <td><span class="mkt-tag">${this.esc(c.conversion_status || '—')}</span></td>
            <td>${c.marketing_consent ? 'Yes' : 'No'}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">No customers</td></tr>'}
        </tbody>
      </table></div></div></div>`;

    document.getElementById('mkt-cust-save')?.addEventListener('click', async () => {
      const full_name = document.getElementById('mkt-cust-name').value.trim();
      if (!full_name) return this.toast('Name required', 'error');
      const r = await this.apiOk(API.mktSaveCustomer({
        full_name,
        phone: document.getElementById('mkt-cust-phone').value.trim(),
        source: document.getElementById('mkt-cust-source').value.trim() || 'agent_recruit',
        group_tag: document.getElementById('mkt-cust-group').value,
        marketing_consent: document.getElementById('mkt-cust-consent').checked ? 1 : 0
      }, this.actor()), 'Save failed');
      if (!r) return;
      this.toast('Customer saved', 'success');
      this.renderCustomers(el);
    });
  },

  /* ─── Recruitment ─── */
  async renderRecruitment(el) {
    const [stats, customers] = await Promise.all([
      this.apiOk(API.mktRecruitmentStats({}, this.actor()), 'Stats failed'),
      this.apiOk(API.mktCustomers({ conversion_status: 'recruited' }, this.actor()), 'Customers failed')
    ]);
    const s = stats || {};
    const list = customers || [];

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Recruited</div><div class="value">${s.customers_recruited || 0}</div></div>
        <div class="stat-card"><div class="label">Converted</div><div class="value">${s.customers_converted || 0}</div></div>
        <div class="stat-card"><div class="label">Conversion %</div><div class="value">${s.conversion_rate || 0}%</div></div>
        <div class="stat-card"><div class="label">Revenue</div><div class="value">${this.money(s.revenue_attributed)}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin-top:0">Recruit customer</h4>
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="mkt-rec-name"></div>
          <div class="field"><label>Phone</label><input id="mkt-rec-phone"></div>
          <div class="field"><label>Source</label><input id="mkt-rec-source" value="referral_recruit"></div>
        </div>
        <button type="button" class="btn btn-primary" id="mkt-rec-save" style="margin-top:12px">Recruit</button>
      </div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${list.map(c => `<tr>
            <td>${this.esc(c.full_name)}</td>
            <td>${this.esc(c.phone || '—')}</td>
            <td><span class="tag">${this.esc(c.conversion_status)}</span></td>
            <td>${c.conversion_status !== 'converted'
              ? `<button type="button" class="btn btn-sm btn-success mkt-convert" data-id="${c.id}">Mark converted</button>` : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No recruited customers awaiting conversion</td></tr>'}
        </tbody>
      </table></div>`;

    document.getElementById('mkt-rec-save')?.addEventListener('click', async () => {
      const full_name = document.getElementById('mkt-rec-name').value.trim();
      if (!full_name) return this.toast('Name required', 'error');
      const r = await this.apiOk(API.mktSaveCustomer({
        full_name,
        phone: document.getElementById('mkt-rec-phone').value.trim(),
        source: document.getElementById('mkt-rec-source').value.trim() || 'referral_recruit',
        group_tag: 'Referral',
        marketing_consent: 1
      }, this.actor()), 'Recruit failed');
      if (!r) return;
      this.toast('Customer recruited', 'success');
      this.renderRecruitment(el);
    });

    el.querySelectorAll('.mkt-convert').forEach((b) => {
      b.addEventListener('click', async () => {
        const total = await this.askNumber('Mark converted', 'First purchase total (optional)', '0');
        if (total == null) return;
        const r = await this.apiOk(API.mktConvertCustomer(parseInt(b.dataset.id, 10), total, this.actor()), 'Convert failed');
        if (!r) return;
        this.toast('Marked converted', 'success');
        this.renderRecruitment(el);
      });
    });
  },

  /* ─── Messaging ─── */
  async renderMessaging(el) {
    const [templates, messages] = await Promise.all([
      this.apiOk(API.mktMsgTemplates(), 'Templates failed'),
      this.apiOk(API.mktMessages({}, this.actor()), 'Messages failed')
    ]);
    const tpls = templates || [];
    const msgs = messages || [];
    const groupOpts = this.GROUP_TAGS.map(g => `<option value="${this.esc(g)}">${this.esc(g)}</option>`).join('');

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <div class="form-grid">
          <div class="field"><label>Template</label>
            <select id="mkt-msg-tpl">
              <option value="">— Custom —</option>
              ${tpls.map(t => `<option value="${this.esc(t.template_key || t.id)}" data-body="${this.esc(t.body || t.message_body || '')}">${this.esc(t.title || t.template_key)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Audience group</label>
            <select id="mkt-msg-group"><option value="">All consented</option>${groupOpts}</select>
          </div>
          <div class="field full"><label>Message body</label><textarea id="mkt-msg-body" rows="4"></textarea></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="mkt-msg-draft">Save draft</button>
          <button type="button" class="btn btn-success" id="mkt-msg-queue">Save &amp; queue</button>
        </div>
      </div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Body</th><th>Recipients</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          ${msgs.map(m => `<tr>
            <td>${this.esc((m.message_body || '').slice(0, 80))}</td>
            <td>${this.esc(m.recipient_count)}</td>
            <td><span class="tag">${this.esc(m.status)}</span></td>
            <td>${this.esc(m.created_at || '')}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No messages</td></tr>'}
        </tbody>
      </table></div>`;

    document.getElementById('mkt-msg-tpl')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      if (opt?.dataset?.body) document.getElementById('mkt-msg-body').value = opt.dataset.body;
    });

    const saveMsg = async (queued) => {
      const body = document.getElementById('mkt-msg-body').value.trim();
      if (!body) return this.toast('Message body required', 'error');
      const group = document.getElementById('mkt-msg-group').value;
      const tpl = document.getElementById('mkt-msg-tpl').value;
      const r = await this.apiOk(API.mktSaveMessage({
        message_body: body,
        template_key: tpl || null,
        audience: group ? { group_tag: group } : {},
        status: queued ? 'queued' : 'draft'
      }, this.actor()), 'Save message failed');
      if (!r) return;
      this.toast(queued ? `Queued for ${r.recipients?.length || r.recipient_count || 0} recipients` : 'Draft saved', 'success');
      this.renderMessaging(el);
    };

    document.getElementById('mkt-msg-draft')?.addEventListener('click', () => saveMsg(false));
    document.getElementById('mkt-msg-queue')?.addEventListener('click', () => saveMsg(true));
  },

  /* ─── Campaigns ─── */
  async renderCampaigns(el) {
    const [campaigns, flyers, menus] = await Promise.all([
      this.apiOk(API.mktCampaigns({}, this.actor()), 'Campaigns failed'),
      this.apiOk(API.getFlyers({}), 'Flyers failed'),
      this.apiOk(API.mktMenus({}, this.actor()), 'Menus failed')
    ]);
    const campList = campaigns || [];
    const flyerOpts = (flyers || []).map(f => `<option value="${f.id}">${this.esc(f.title)} (#${f.id})</option>`).join('');
    const menuOpts = (menus || []).map(m => `<option value="${m.id}">${this.esc(m.title)} (#${m.id})</option>`).join('');

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin-top:0">Create campaign</h4>
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="mkt-camp-name"></div>
          <div class="field"><label>Objective</label><input id="mkt-camp-obj"></div>
          <div class="field"><label>Start date</label><input type="date" id="mkt-camp-start"></div>
          <div class="field"><label>End date</label><input type="date" id="mkt-camp-end"></div>
          <div class="field"><label>Linked flyer</label>
            <select id="mkt-camp-flyer"><option value="">— None —</option>${flyerOpts}</select></div>
          <div class="field"><label>Linked menu</label>
            <select id="mkt-camp-menu"><option value="">— None —</option>${menuOpts}</select></div>
          <div class="field full"><label>Offer</label><input id="mkt-camp-offer"></div>
          <div class="field"><label>Target group</label>
            <select id="mkt-camp-group"><option value="">—</option>
              ${this.GROUP_TAGS.map(g => `<option value="${this.esc(g)}">${this.esc(g)}</option>`).join('')}
            </select>
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="mkt-camp-save" style="margin-top:12px">Save draft</button>
      </div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Objective</th><th>Flyer</th><th>Menu</th><th>Dates</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${campList.map(c => `<tr>
            <td>${this.esc(c.name)}</td>
            <td>${this.esc(c.objective || '—')}</td>
            <td>${c.flyer_id ? '#' + c.flyer_id : '—'}</td>
            <td>${c.menu_id ? '#' + c.menu_id : '—'}</td>
            <td>${this.esc(c.start_date || '—')} → ${this.esc(c.end_date || '—')}</td>
            <td><span class="tag">${this.esc(c.status)}</span></td>
            <td>${c.status === 'draft'
              ? `<button type="button" class="btn btn-sm btn-success mkt-camp-submit" data-id="${c.id}">Submit for approval</button>` : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No campaigns</td></tr>'}
        </tbody>
      </table></div>`;

    document.getElementById('mkt-camp-save')?.addEventListener('click', async () => {
      const name = document.getElementById('mkt-camp-name').value.trim();
      if (!name) return this.toast('Name required', 'error');
      const flyerVal = document.getElementById('mkt-camp-flyer').value;
      const menuVal = document.getElementById('mkt-camp-menu').value;
      const r = await this.apiOk(API.mktSaveCampaign({
        name,
        objective: document.getElementById('mkt-camp-obj').value.trim(),
        start_date: document.getElementById('mkt-camp-start').value || null,
        end_date: document.getElementById('mkt-camp-end').value || null,
        offer_text: document.getElementById('mkt-camp-offer').value.trim(),
        target_group: document.getElementById('mkt-camp-group').value || null,
        flyer_id: flyerVal ? parseInt(flyerVal, 10) : null,
        menu_id: menuVal ? parseInt(menuVal, 10) : null,
        status: 'draft'
      }, this.actor()), 'Save failed');
      if (!r) return;
      this.toast('Campaign draft saved', 'success');
      this.renderCampaigns(el);
    });

    el.querySelectorAll('.mkt-camp-submit').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await this.apiOk(API.mktSubmitCampaign(parseInt(b.dataset.id, 10), this.actor()), 'Submit failed');
        if (!r) return;
        this.toast('Campaign submitted', 'success');
        this.renderCampaigns(el);
      });
    });
  },

  /* ─── Customer Feedback ─── */
  async renderFeedback(el) {
    const rows = (await this.apiOk(API.mktFeedback({}, this.actor()), 'Feedback failed')) || [];
    el.innerHTML = `
      <div class="mkt-hero">
        <div><h3>Customer feedback</h3><p>Record complaints, compliments, suggestions, reviews, and product requests for Admin.</p></div>
      </div>
      <div class="mkt-panel"><div class="mkt-panel-h"><h4>Log feedback</h4></div><div class="mkt-panel-b">
        <div class="form-grid">
          <div class="field"><label>Type</label>
            <select id="mkt-fb-type">
              <option value="complaint">Complaint</option>
              <option value="compliment">Compliment</option>
              <option value="suggestion">Suggestion</option>
              <option value="review">Review</option>
              <option value="product_request">Product request</option>
            </select>
          </div>
          <div class="field"><label>Customer name</label><input id="mkt-fb-name"></div>
          <div class="field"><label>Phone</label><input id="mkt-fb-phone"></div>
          <div class="field"><label>Product request</label><input id="mkt-fb-product"></div>
          <div class="field full"><label>Notes</label><textarea id="mkt-fb-notes" rows="3"></textarea></div>
        </div>
        <button type="button" class="btn btn-primary" id="mkt-fb-save" style="margin-top:12px">Save feedback</button>
      </div></div>
      <div class="mkt-panel"><div class="mkt-panel-b">
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Notes</th><th>Product</th></tr></thead>
        <tbody>
          ${rows.map(f => `<tr>
            <td>${this.esc(f.created_at || '')}</td>
            <td><span class="mkt-tag">${this.esc(f.feedback_type)}</span></td>
            <td>${this.esc(f.customer_name || '—')} ${f.phone ? '· ' + this.esc(f.phone) : ''}</td>
            <td>${this.esc(f.notes || '')}</td>
            <td>${this.esc(f.product_request || '—')}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No feedback yet</td></tr>'}
        </tbody>
      </table></div></div></div>`;

    document.getElementById('mkt-fb-save')?.addEventListener('click', async () => {
      const notes = document.getElementById('mkt-fb-notes').value.trim();
      if (!notes && !document.getElementById('mkt-fb-product').value.trim()) {
        return this.toast('Add notes or a product request', 'error');
      }
      const r = await this.apiOk(API.mktSaveFeedback({
        feedback_type: document.getElementById('mkt-fb-type').value,
        customer_name: document.getElementById('mkt-fb-name').value.trim(),
        phone: document.getElementById('mkt-fb-phone').value.trim(),
        product_request: document.getElementById('mkt-fb-product').value.trim(),
        notes
      }, this.actor()), 'Save failed');
      if (!r) return;
      this.toast('Feedback saved', 'success');
      this.renderFeedback(el);
    });
  },

  /* ─── Referrals ─── */
  async renderReferrals(el) {
    let dash = this.data.dashboard;
    if (!dash) dash = await this.apiOk(API.mktDashboard(this.actor()), 'Dashboard failed');
    const code = dash?.agent?.referral_code || '—';
    const customers = (await this.apiOk(API.mktCustomers({}, this.actor()), 'Customers failed')) || [];
    const referred = customers.filter(c => c.referral_code || c.source === 'referral_recruit' || c.group_tag === 'Referral');

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h3 style="margin:0 0 8px">Your referral code</h3>
        <p style="font-size:28px;font-weight:700;letter-spacing:2px;margin:0"><code>${this.esc(code)}</code></p>
        <p class="muted">Share this code when recruiting. New customers are linked automatically.</p>
      </div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Phone</th><th>Referral code</th><th>Status</th></tr></thead>
        <tbody>
          ${referred.map(c => `<tr>
            <td>${this.esc(c.full_name)}</td>
            <td>${this.esc(c.phone || '—')}</td>
            <td>${this.esc(c.referral_code || code)}</td>
            <td><span class="tag">${this.esc(c.conversion_status || '—')}</span></td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No referral recruits yet</td></tr>'}
        </tbody>
      </table></div>`;
  },

  /* ─── Tasks ─── */
  async renderTasks(el) {
    let dash = this.data.dashboard;
    if (!dash?.agent) dash = await this.apiOk(API.mktDashboard(this.actor()), 'Dashboard failed') || {};
    const agentId = dash?.agent?.id;
    const filters = agentId ? { agent_id: agentId } : {};
    const tasks = (await this.apiOk(API.mktTasks(filters, this.actor()), 'Tasks failed')) || [];

    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Type</th><th>Due</th><th>Status</th><th>Update</th></tr></thead>
        <tbody>
          ${tasks.map(t => `<tr>
            <td><strong>${this.esc(t.title)}</strong><br><small class="muted">${this.esc(t.description || '')}</small></td>
            <td>${this.esc(t.task_type || '—')}</td>
            <td>${this.esc(t.due_date || '—')}</td>
            <td><span class="tag">${this.esc(t.status)}</span></td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-sm btn-ghost mkt-task-st" data-id="${t.id}" data-st="not_started">Not started</button>
              <button type="button" class="btn btn-sm btn-ghost mkt-task-st" data-id="${t.id}" data-st="in_progress">In progress</button>
              <button type="button" class="btn btn-sm btn-success mkt-task-st" data-id="${t.id}" data-st="completed">Completed</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No tasks assigned</td></tr>'}
        </tbody>
      </table></div>`;

    el.querySelectorAll('.mkt-task-st').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        const task = tasks.find(t => t.id === id);
        const r = await this.apiOk(API.mktSaveTask({
          id,
          title: task?.title,
          status: b.dataset.st
        }, this.actor()), 'Update failed');
        if (!r) return;
        this.toast(`Task → ${b.dataset.st}`, 'success');
        this.renderTasks(el);
      });
    });
  },

  /* ─── Media Library ─── */
  async renderMedia(el) {
    const media = (await this.apiOk(API.mktMedia(this.actor()), 'Media failed')) || [];

    el.innerHTML = `
      <div class="page-toolbar">
        <p class="muted" style="margin:0">${media.length} item(s)</p>
        <button type="button" class="btn btn-primary" id="mkt-media-upload">Upload image</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Type</th><th>Path</th><th>Approval</th><th>Created</th></tr></thead>
        <tbody>
          ${media.map(m => `<tr>
            <td>${this.esc(m.title)}</td>
            <td>${this.esc(m.media_type || 'image')}</td>
            <td class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${this.esc(m.file_path)}</td>
            <td><span class="tag">${this.esc(m.approval_status || '—')}</span></td>
            <td>${this.esc(m.created_at || '')}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No media yet</td></tr>'}
        </tbody>
      </table></div>`;

    document.getElementById('mkt-media-upload')?.addEventListener('click', async () => {
      if (typeof API.selectImage !== 'function') {
        return this.toast('Image picker not available', 'error');
      }
      const picked = await API.selectImage('mkt');
      if (!picked?.success && !picked?.data && !picked?.path) {
        if (picked?.cancelled) return;
        return this.toast(picked?.error || 'No image selected', 'error');
      }
      const path = picked.data?.path || picked.data?.filePath || picked.path || picked.filePath || picked.data;
      if (!path || typeof path !== 'string') return this.toast('Invalid image path', 'error');
      const title = await this.askText('Media title', 'Title for this image', 'Upload');
      if (title == null) return;
      const r = await this.apiOk(API.mktSaveMedia({
        title: String(title).trim() || 'Upload',
        file_path: path,
        media_type: 'image'
      }, this.actor()), 'Upload failed');
      if (!r) return;
      this.toast('Media saved', 'success');
      this.renderMedia(el);
    });
  },

  /* ─── Performance ─── */
  async renderPerformance(el) {
    const card = await this.apiOk(API.mktScorecard(null, this.actor()), 'Scorecard failed');
    if (!card) {
      el.innerHTML = '<p class="error-msg">Scorecard unavailable</p>';
      return;
    }
    const kpis = card.kpis || [];
    const rec = card.recruitment || {};

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Recruited</div><div class="value">${rec.customers_recruited || 0}</div></div>
        <div class="stat-card"><div class="label">Converted</div><div class="value">${rec.customers_converted || 0}</div></div>
        <div class="stat-card"><div class="label">Conversion %</div><div class="value">${rec.conversion_rate || 0}%</div></div>
        <div class="stat-card"><div class="label">Revenue</div><div class="value">${this.money(rec.revenue_attributed)}</div></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>KPI</th><th>Target</th><th>Actual</th><th>Achievement %</th></tr></thead>
        <tbody>
          ${kpis.map(k => `<tr>
            <td>${this.esc(k.label)}</td>
            <td>${this.esc(k.target)}</td>
            <td>${this.esc(k.actual)}</td>
            <td><strong>${this.esc(k.achievement)}%</strong></td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No KPIs</td></tr>'}
        </tbody>
      </table></div>`;
  },

  /* ─── Reports ─── */
  async renderReports(el) {
    const reports = (await this.apiOk(API.mktReports({}, this.actor()), 'Reports failed')) || [];
    if (!this.data.reportAttachments) this.data.reportAttachments = [];
    const atts = this.data.reportAttachments;

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin-top:0">Progress report</h4>
        <div class="form-grid">
          <div class="field"><label>Period label</label><input id="mkt-rep-period" placeholder="Week of …"></div>
          <div class="field"><label>Customers recruited</label><input type="number" id="mkt-rep-cust" value="0"></div>
          <div class="field"><label>Campaigns</label><input type="number" id="mkt-rep-camp" value="0"></div>
          <div class="field"><label>Flyers</label><input type="number" id="mkt-rep-fly" value="0"></div>
          <div class="field"><label>Menus</label><input type="number" id="mkt-rep-menus" value="0"></div>
          <div class="field"><label>Messages</label><input type="number" id="mkt-rep-msg" value="0"></div>
          <div class="field"><label>Referrals</label><input type="number" id="mkt-rep-ref" value="0"></div>
          <div class="field full"><label>Work completed</label><textarea id="mkt-rep-work" rows="3"></textarea></div>
          <div class="field full"><label>Customer feedback summary</label><textarea id="mkt-rep-fb" rows="2"></textarea></div>
          <div class="field full"><label>Problems</label><textarea id="mkt-rep-prob" rows="2"></textarea></div>
          <div class="field full"><label>Recommendations</label><textarea id="mkt-rep-rec" rows="2"></textarea></div>
          <div class="field full"><label>Next steps</label><textarea id="mkt-rep-next" rows="2"></textarea></div>
        </div>
        <div style="margin-top:12px">
          <button type="button" class="btn btn-ghost btn-sm" id="mkt-rep-attach">Attach photo / evidence</button>
          <ul id="mkt-rep-att-list" style="margin:8px 0 0;padding-left:18px">
            ${atts.map((a, i) => `<li>${this.esc(a.title || a.path)} <button type="button" class="btn btn-sm btn-ghost mkt-rep-att-rm" data-i="${i}">Remove</button></li>`).join('') || '<li class="muted">No attachments</li>'}
          </ul>
        </div>
        <button type="button" class="btn btn-primary" id="mkt-rep-save" style="margin-top:12px">Submit report</button>
      </div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Period</th><th>Status</th><th>Work</th><th>Attachments</th><th>Admin response</th><th>Created</th></tr></thead>
        <tbody>
          ${reports.map(r => {
            let a = [];
            try { a = typeof r.attachments_json === 'string' ? JSON.parse(r.attachments_json) : (r.attachments_json || []); } catch { a = []; }
            return `<tr>
            <td>${this.esc(r.period_label)}</td>
            <td><span class="tag">${this.esc(r.status)}</span></td>
            <td>${this.esc((r.work_completed || '').slice(0, 60))}</td>
            <td>${a.length || 0}</td>
            <td>${this.esc(r.admin_response || '—')}</td>
            <td>${this.esc(r.created_at || '')}</td>
          </tr>`;
          }).join('') || '<tr><td colspan="6" class="muted">No reports</td></tr>'}
        </tbody>
      </table></div>`;

    document.getElementById('mkt-rep-attach')?.addEventListener('click', async () => {
      if (typeof API.selectImage !== 'function') return this.toast('Image picker not available', 'error');
      const picked = await API.selectImage('mkt-report');
      if (!picked?.success && !picked?.data && !picked?.path) {
        if (picked?.cancelled) return;
        return this.toast(picked?.error || 'No file selected', 'error');
      }
      const path = picked.data?.path || picked.data?.filePath || picked.path || picked.filePath || picked.data;
      if (!path || typeof path !== 'string') return this.toast('Invalid path', 'error');
      const title = await this.askText('Attachment title', 'Label', 'Evidence');
      if (title == null) return;
      this.data.reportAttachments.push({ title: String(title).trim() || 'Evidence', path });
      this.renderReports(el);
    });
    el.querySelectorAll('.mkt-rep-att-rm').forEach((b) => {
      b.addEventListener('click', () => {
        this.data.reportAttachments.splice(parseInt(b.dataset.i, 10), 1);
        this.renderReports(el);
      });
    });

    document.getElementById('mkt-rep-save')?.addEventListener('click', async () => {
      const r = await this.apiOk(API.mktSaveReport({
        period_label: document.getElementById('mkt-rep-period').value.trim() || undefined,
        work_completed: document.getElementById('mkt-rep-work').value.trim(),
        customers_recruited: parseInt(document.getElementById('mkt-rep-cust').value, 10) || 0,
        campaigns_count: parseInt(document.getElementById('mkt-rep-camp').value, 10) || 0,
        flyers_count: parseInt(document.getElementById('mkt-rep-fly').value, 10) || 0,
        menus_count: parseInt(document.getElementById('mkt-rep-menus').value, 10) || 0,
        messages_count: parseInt(document.getElementById('mkt-rep-msg').value, 10) || 0,
        referrals_count: parseInt(document.getElementById('mkt-rep-ref').value, 10) || 0,
        customer_feedback: document.getElementById('mkt-rep-fb').value.trim(),
        problems: document.getElementById('mkt-rep-prob').value.trim(),
        recommendations: document.getElementById('mkt-rep-rec').value.trim(),
        next_steps: document.getElementById('mkt-rep-next').value.trim(),
        attachments: this.data.reportAttachments || []
      }, this.actor()), 'Report save failed');
      if (!r) return;
      this.data.reportAttachments = [];
      this.toast('Report submitted', 'success');
      this.renderReports(el);
    });
  },

  /* ─── Notifications ─── */
  async renderNotifications(el) {
    const notes = (await this.apiOk(API.mktNotifications(this.actor()), 'Notifications failed')) || [];

    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Body</th><th>Kind</th><th>When</th><th></th></tr></thead>
        <tbody>
          ${notes.map(n => `<tr style="${n.is_read ? '' : 'font-weight:600'}">
            <td>${this.esc(n.title)}</td>
            <td>${this.esc(n.body || '')}</td>
            <td>${this.esc(n.kind || '')}</td>
            <td>${this.esc(n.created_at || '')}</td>
            <td>${!n.is_read
              ? `<button type="button" class="btn btn-sm btn-ghost mkt-note-read" data-id="${n.id}">Mark read</button>`
              : '<span class="muted">Read</span>'}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No notifications</td></tr>'}
        </tbody>
      </table></div>`;

    el.querySelectorAll('.mkt-note-read').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await this.apiOk(API.mktReadNotification(parseInt(b.dataset.id, 10), this.actor()), 'Failed');
        if (r === null) return;
        this.renderNotifications(el);
      });
    });
  },

  /* ─── Settings ─── */
  async renderSettings(el) {
    const [brand, sync] = await Promise.all([
      this.apiOk(API.mktBrandKit(this.actor()), 'Brand kit failed'),
      this.apiOk(API.mktSyncStatus(), 'Sync status failed')
    ]);
    const b = brand || {};
    const s = sync || {};

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>Brand kit (read-only)</h3></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label>Shop name</label><input readonly value="${this.esc(b.shop_name || b.business_name || '')}"></div>
            <div class="field"><label>Phone</label><input readonly value="${this.esc(b.phone || '')}"></div>
            <div class="field"><label>Primary colour</label><input readonly value="${this.esc(b.primary_color || b.primaryColour || '')}"></div>
            <div class="field"><label>Secondary colour</label><input readonly value="${this.esc(b.secondary_color || b.secondaryColour || '')}"></div>
            <div class="field full"><label>Address</label><input readonly value="${this.esc(b.address || '')}"></div>
            <div class="field full"><label>Logo path</label><input readonly value="${this.esc(b.logo_path || b.logoPath || '')}"></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Sync</h3></div>
        <div class="card-body">
          <p><span class="tag">${this.esc(s.status || '—')}</span>
            <span class="muted"> Pending: ${Number(s.pending) || 0} · Failed: ${Number(s.failed) || 0}
            · Last: ${this.esc(s.last_sync || 'never')}</span></p>
          <button type="button" class="btn btn-primary" id="mkt-sync-run">Process sync queue</button>
          <button type="button" class="btn btn-ghost" id="mkt-sync-refresh" style="margin-left:8px">Refresh status</button>
        </div>
      </div>
      <div style="margin-top:16px">
        <button type="button" class="btn btn-ghost" id="mkt-settings-exit">Exit to POS Login</button>
      </div>`;

    document.getElementById('mkt-sync-run')?.addEventListener('click', async () => {
      const r = await this.apiOk(API.mktProcessSync(this.actor()), 'Sync failed');
      if (!r) return;
      this.toast(`Synced ${r.synced || 0} item(s)`, 'success');
      this.renderSettings(el);
    });
    document.getElementById('mkt-sync-refresh')?.addEventListener('click', () => this.renderSettings(el));
    document.getElementById('mkt-settings-exit')?.addEventListener('click', () => this.exit());
  }
};

window.MarketingAgentApp = MarketingAgentApp;
