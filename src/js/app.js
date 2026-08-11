const App = {
  user: null,
  settings: null,
  currentPage: 'dashboard',

  navItems: [
    { id: 'dashboard', label: '📊 Dashboard', roles: ['owner', 'manager'] },
    { id: 'admin', label: '⚙️ Admin Panel', roles: ['owner', 'manager', 'supervisor'] },
    { id: 'pos', label: '💳 POS', roles: ['owner', 'manager', 'cashier', 'assistant_manager', 'supervisor'] },
    { id: 'staff', label: '👷 Staff', roles: ['owner', 'manager', 'cashier', 'assistant_manager', 'supervisor'] },
    { id: 'products', label: '📦 Products', roles: ['owner', 'manager'] },
    { id: 'categories', label: '🏷️ Categories', roles: ['owner', 'manager'] },
    { id: 'stock', label: '📋 Stock', roles: ['owner', 'manager'] },
    { id: 'customers', label: '👥 Customers', roles: ['owner', 'manager'] },
    { id: 'suppliers', label: '🚚 Suppliers', roles: ['owner', 'manager'] },
    { id: 'expenses', label: '💸 Expenses', roles: ['owner', 'manager'] },
    { id: 'quotes', label: '📝 Quotes', roles: ['owner', 'manager', 'supervisor'] },
    { id: 'returns', label: '↩️ Returns', roles: ['owner', 'manager', 'cashier', 'assistant_manager', 'supervisor'] },
    { id: 'layby', label: '📋 Lay-Bye', roles: ['owner', 'manager', 'supervisor'] },
    { id: 'giftcards', label: '🎁 Gift Cards', roles: ['owner', 'manager', 'supervisor'] },
    { id: 'marketing', label: '📣 Marketing', roles: ['owner', 'manager', 'marketing_agent'] },
    { id: 'document-hub', label: '📁 Document Hub', roles: ['owner', 'manager', 'assistant_manager', 'marketing_agent'] },
    { id: 'whatsapp', label: '💬 WhatsApp', roles: ['owner', 'manager', 'assistant_manager'] },
    { id: 'operations', label: '💰 Cash-Up & Ops', roles: ['owner', 'manager', 'assistant_manager', 'supervisor'] },
    { id: 'restaurant', label: '🍽️ Restaurant', roles: ['owner', 'manager'] },
    { id: 'recipe', label: '🍳 Recipe & Production', roles: ['owner', 'manager'] },
    { id: 'purchase-orders', label: '📝 Purchase Orders', roles: ['owner', 'manager'] },
    { id: 'reports', label: '📈 Reports', roles: ['owner', 'manager'] },
    { id: 'bookkeeping', label: '📒 Bookkeeping', roles: ['owner', 'manager'] },
    { id: 'users', label: '👤 Users', roles: ['owner'] },
    { id: 'audit', label: '🔍 Audit Log', roles: ['owner', 'manager'] }
  ],

  pages: {},
  /** Page script bundles — Android loads these on first open (Windows index still preloads most). */
  _pageBundles: {
    dashboard: ['js/pages/dashboard.js'],
    pos: ['js/pages/pos.js'],
    staff: ['js/pages/staff.js', 'js/pages/staff-owner-salary.js'],
    products: ['js/pages/products.js'],
    categories: ['js/pages/categories.js'],
    stock: ['js/pages/stock.js'],
    customers: ['js/pages/customers.js'],
    suppliers: ['js/pages/suppliers.js'],
    expenses: ['js/pages/expenses.js'],
    returns: ['js/pages/returns.js'],
    quotes: ['js/pages/quotes.js'],
    layby: ['js/pages/layby.js'],
    giftcards: ['js/pages/giftcards.js'],
    marketing: ['js/pages/marketing-flyers.js', 'js/pages/marketing-flyers-studio.js'],
    'document-hub': ['js/pages/document-hub.js'],
    whatsapp: ['js/pages/whatsapp.js'],
    operations: ['js/pages/operations.js'],
    restaurant: ['js/pages/restaurant.js'],
    'purchase-orders': ['js/pages/purchase-orders.js'],
    reports: ['js/pages/reports.js'],
    bookkeeping: ['js/pages/bookkeeping.js'],
    users: ['js/pages/users.js'],
    audit: ['js/pages/audit.js'],
    settings: ['js/pages/settings.js'],
    admin: [
      'js/pages/admin.js',
      'js/pages/admin-pro.js',
      'js/pages/admin-audit.js',
      'js/pages/admin-staff.js',
      'js/pages/admin-hr.js',
      'js/pages/admin-operations.js',
      'js/pages/admin-combos.js',
      'js/pages/admin-quotes.js',
      'js/pages/admin-payroll.js',
      'js/pages/admin-employee-month.js',
      'js/pages/admin-recruitment.js',
      'js/pages/admin-marketing.js'
    ]
  },
  _pageGlobals: {
    dashboard: 'DashboardPage',
    admin: 'AdminPage',
    pos: 'POSPage',
    staff: 'StaffPage',
    products: 'ProductsPage',
    categories: 'CategoriesPage',
    stock: 'StockPage',
    customers: 'CustomersPage',
    suppliers: 'SuppliersPage',
    expenses: 'ExpensesPage',
    returns: 'ReturnsPage',
    quotes: 'QuotesPage',
    layby: 'LaybyPage',
    giftcards: 'GiftCardsPage',
    marketing: 'MarketingFlyersPage',
    'document-hub': 'DocumentHubPage',
    whatsapp: 'WhatsAppPage',
    operations: 'OperationsPage',
    restaurant: 'RestaurantPage',
    'purchase-orders': 'PurchaseOrdersPage',
    reports: 'ReportsPage',
    bookkeeping: 'BookkeepingPage',
    users: 'UsersPage',
    audit: 'AuditPage',
    settings: 'SettingsPage'
  },
  _lazyScripts: {
    marketing: ['js/pages/marketing-flyers-studio.js']
  },
  _scheduledDocInterval: null,

  async init() {
    try {
      this.registerPages();
      this.bindEvents();
      API.onAppCloseBlocked?.(() => {
        if (App.user) Utils.toast('Use Logout to exit Shop POS', 'error');
      });
      const res = await API.getSettingsParsed();
      if (!res.success) {
        Utils.toast('Could not load settings: ' + (res.error || 'Unknown error'), 'error');
        this.showScreen('setup');
        this.hideMobileLoading();
        return;
      }
      this.settings = res.data;
      this.applyTheme();
      await this.syncDeviceSettings();

      if (!Number(this.settings?.setup_complete)) {
        this.showScreen('setup');
        this.hideMobileLoading();
        return;
      }
      this.updateBranding();
      this.showScreen('login');
      this.startLoginOperatingTimer();
      this.hideMobileLoading();
    } catch (err) {
      console.error('App init failed:', err);
      this.showMobileError(err.message || 'Could not start Shop POS');
    }
  },

  hideMobileLoading() {
    const el = document.getElementById('mobile-loading');
    if (el) el.style.display = 'none';
  },

  showMobileError(message) {
    const el = document.getElementById('mobile-loading');
    if (el) {
      el.style.display = 'flex';
      el.innerHTML = `<p style="color:red;padding:20px;text-align:center">Failed to start: ${message}</p>`;
    } else {
      Utils.toast(message, 'error');
    }
  },

  registerPages() {
    this.pages = {};
    // Bind whatever is already on window (Windows preloads all; Android lazy-loads)
    Object.keys(this._pageGlobals).forEach((id) => {
      const g = window[this._pageGlobals[id]];
      if (g) this.pages[id] = g;
    });
  },

  bindPageModule(page) {
    const name = this._pageGlobals[page];
    if (name && window[name]) this.pages[page] = window[name];
    return this.pages[page] || null;
  },

  bindEvents() {
    document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
    document.getElementById('login-staff-portal')?.addEventListener('click', () => this.openStaffPortal());
    document.getElementById('login-marketing-agent')?.addEventListener('click', () => this.openMarketingAgentLogin());
    document.getElementById('login-recipe-production')?.addEventListener('click', () => this.openRecipeProduction());
    document.getElementById('login-forgot')?.addEventListener('click', () => this.showRecoveryModal());
    document.getElementById('login-reset-business')?.addEventListener('click', () => this.showFactoryResetModal());
    document.getElementById('setup-form').addEventListener('submit', (e) => this.handleSetup(e));
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());
    document.getElementById('btn-sidebar-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSidebar();
    });
    document.getElementById('sidebar-backdrop')?.addEventListener('click', () => this.closeSidebar());
    document.getElementById('global-search').addEventListener('input', (e) => this.handleSearch(e.target.value));
    document.getElementById('btn-notifications').addEventListener('click', () => this.showNotifications());

    document.getElementById('sidebar-nav').addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-btn');
      if (!btn?.dataset.page) return;
      this.closeSidebar();
      if (btn.dataset.page === 'recipe') {
        this.openRecipeProduction({ fromApp: true });
        return;
      }
      this.navigate(btn.dataset.page);
    });
    document.querySelector('.sidebar-footer').addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-btn');
      if (btn?.dataset.page) {
        this.closeSidebar();
        this.navigate(btn.dataset.page);
      }
    });
  },

  toggleSidebar() {
    const side = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!side) return;
    const open = !side.classList.contains('open');
    side.classList.toggle('open', open);
    backdrop?.classList.toggle('visible', open);
    document.body.classList.toggle('sidebar-open', open);
  },

  closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-backdrop')?.classList.remove('visible');
    document.body.classList.remove('sidebar-open');
  },

  openSidebar() {
    document.getElementById('sidebar')?.classList.add('open');
    document.getElementById('sidebar-backdrop')?.classList.add('visible');
    document.body.classList.add('sidebar-open');
  },

  showScreen(name) {
    ['login', 'setup', 'app', 'staff-portal', 'recipe-production', 'marketing-agent'].forEach(s =>
      document.getElementById(`screen-${s}`)?.classList.toggle('hidden', s !== name));
  },

  async openStaffPortal() {
    this.stopLoginOperatingTimer();
    // Android lazy-loads page scripts — StaffPage must be available for the portal
    await this.ensurePageScripts('staff');
    await this.ensureFeatureScript('js/staff-selfie-ui.js');
    await this.ensureFeatureScript('js/staff-portal-standalone.js');
    const portal = window.StaffPortalStandalone
      || (typeof StaffPortalStandalone !== 'undefined' ? StaffPortalStandalone : null);
    if (!portal?.render) {
      Utils.toast('Staff portal failed to load', 'error');
      return;
    }
    if (!window.StaffPage?.renderWorkerPanel) {
      Utils.toast('Staff portal modules failed to load', 'error');
      return;
    }
    window.StaffPortalStandalone = portal;
    this.showScreen('staff-portal');
    portal.step = 'login';
    portal.employee = null;
    const root = document.getElementById('staff-portal-root');
    portal.render(root, this);
  },

  closeStaffPortal() {
    StaffSelfieCapture?.stopCamera?.();
    this.showScreen('login');
    this.startLoginOperatingTimer();
  },

  /** Open standalone Marketing Agent System (own login, like Recipe & Staff Portal) */
  async openMarketingAgentLogin() {
    await this.openMarketingAgent({ fromLogin: true });
  },

  async openMarketingAgent(opts = {}) {
    this.stopLoginOperatingTimer();
    await this.ensureFeatureScript('js/marketing-agent-app.js');
    await this.ensureFeatureScript('js/pages/marketing-flyers.js');
    await this.ensureFeatureScript('js/pages/marketing-flyers-studio.js');
    const appMod = window.MarketingAgentApp;
    if (!appMod?.render) {
      Utils.toast('Marketing Agent System failed to load', 'error');
      return;
    }
    this._marketingFromLogin = !!opts.fromLogin || !opts.fromApp;
    this.showScreen('marketing-agent');
    const root = document.getElementById('marketing-agent-root');
    appMod.view = 'dashboard';
    await appMod.render(root, this);
  },

  closeMarketingAgent() {
    if (this._marketingFromLogin || this.user?.role === 'marketing_agent') {
      this._marketingFromLogin = false;
      try { API.logout?.(); } catch (_) { /* ignore */ }
      this.user = null;
      this.showScreen('login');
      this.startLoginOperatingTimer();
      return;
    }
    if (this.user) {
      this.showScreen('app');
      return;
    }
    this.showScreen('login');
    this.startLoginOperatingTimer();
  },

  async openRecipeProduction(opts = {}) {
    this._recipeReturnToApp = !!(opts.fromApp && this.user);
    this.stopLoginOperatingTimer();
    await this.ensureFeatureScript('js/recipe-production/app.js');
    if (!window.RecipeProductionApp) {
      Utils.toast('Recipe & Production failed to load', 'error');
      return;
    }
    this.showScreen('recipe-production');
    RecipeProductionApp.open(this, { fromApp: this._recipeReturnToApp, posUser: this.user });
  },

  closeRecipeProduction() {
    if (this._recipeReturnToApp && this.user) {
      this._recipeReturnToApp = false;
      this.showScreen('app');
      return;
    }
    this._recipeReturnToApp = false;
    this.showScreen('login');
    this.startLoginOperatingTimer();
  },

  updateBranding() {
    const appName = (this.settings?.app_display_name || this.settings?.shop_name || 'Shop POS').trim();
    const shopName = this.settings?.shop_name || appName;
    const logo = this.settings?.logo_path;
    const loginNameEl = document.getElementById('login-shop-name');
    if (loginNameEl) loginNameEl.textContent = appName;
    const sideNameEl = document.getElementById('sidebar-shop-name');
    if (sideNameEl) sideNameEl.textContent = shopName;
    document.title = appName;

    const applyLogo = async (elId, fallback = '🏪') => {
      const el = document.getElementById(elId);
      if (!el) return;
      if (logo) {
        const img = await API.getImageDataUrl(logo);
        if (img?.success && (img.dataUrl || img.data)) {
          el.innerHTML = `<img src="${img.dataUrl || img.data}" alt="${appName}" class="brand-logo-img">`;
        } else {
          el.innerHTML = `<img src="${Utils.fileUrl(logo)}" alt="${appName}" class="brand-logo-img">`;
        }
      } else {
        el.textContent = fallback;
      }
    };
    applyLogo('sidebar-logo');
    applyLogo('login-logo');
  },

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.settings?.theme || 'light');
  },

  async syncDeviceSettings() {
    try {
      const res = await API.getDeviceSettings();
      const backend = res.success ? (res.data || {}) : {};
      const local = Utils.getLocalDeviceSettings();
      const merged = { ...local, ...backend, device_id: Utils.getDeviceId() };
      localStorage.setItem('shoppos_device_settings', JSON.stringify(merged));
      if (Object.keys(local).length && !Object.keys(backend).length) {
        await API.saveDeviceSettings(merged);
      }
    } catch { /* offline */ }
  },

  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const pin = document.getElementById('login-pin').value || null;
    const errEl = document.getElementById('login-error');
    const btn = e.target?.querySelector?.('button[type="submit"]') || document.querySelector('#login-form button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.prev = btn.textContent; btn.textContent = 'Signing in…'; }

    try {
      const result = await API.login(username, password, pin);
      if (!result.success) {
        errEl.textContent = result.error;
        errEl.classList.remove('hidden');
        return;
      }
      errEl.classList.add('hidden');
      this.user = result.user;
      this.user.is_active = 1;
      // Immediate UI — enterApp continues without waiting on non-critical work
      this.showScreen('app');
      document.getElementById('sidebar-user-role').textContent =
        (this.user.full_name || '') + ' · ' + (this.user.role || '');
      this.renderNav();
      await this.enterApp();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.prev || 'Sign In'; }
    }
  },

  async showRecoveryModal() {
    const hasRes = await API.hasRecoverySecret();
    if (!hasRes.success || !hasRes.data) {
      Utils.showModal('Account Recovery', `
        <p>Private recovery has not been set up on this system yet.</p>
        <p class="muted">The shop owner must sign in and go to <strong>Admin → Security</strong> to create a Private Recovery Phrase. Without it, only someone who already knows the login can help.</p>`,
        '<button class="btn btn-primary" id="recovery-close">OK</button>');
      document.getElementById('recovery-close')?.addEventListener('click', Utils.hideModal);
      return;
    }

    let verifiedSecret = '';
    let users = [];

    const showStep1 = () => {
      Utils.showModal('Recover Account', `
        <p class="muted">Enter your <strong>Private Recovery Phrase</strong> — the secret sentence only you chose during setup. No one else can use this.</p>
        <div class="field"><label>Private Recovery Phrase</label>
          <input type="password" id="recovery-secret" autocomplete="off" placeholder="Your secret phrase"></div>
        <p id="recovery-error" class="error-msg hidden"></p>`,
        '<button class="btn btn-primary" id="recovery-verify">Continue</button><button class="btn btn-ghost" id="recovery-cancel">Cancel</button>');

      document.getElementById('recovery-cancel')?.addEventListener('click', Utils.hideModal);
      document.getElementById('recovery-verify')?.addEventListener('click', async () => {
        const secret = document.getElementById('recovery-secret').value;
        const errEl = document.getElementById('recovery-error');
        errEl.classList.add('hidden');
        const res = await API.verifyRecoveryPhrase(secret);
        if (!res.success) {
          errEl.textContent = res.error || 'Verification failed';
          errEl.classList.remove('hidden');
          return;
        }
        verifiedSecret = secret;
        users = res.data || [];
        showStep2();
      });
    };

    const showStep2 = () => {
      const userOpts = users.map(u =>
        `<option value="${u.username}">${u.username} — ${u.full_name} (${u.role})</option>`
      ).join('');
      Utils.showModal('Reset Your Login', `
        <p class="muted">Your identity was verified. Select your account and set a new password.</p>
        <div class="field"><label>Your Username</label>
          <select id="recovery-username">${userOpts}</select></div>
        <div class="field"><label>New Password</label>
          <input type="password" id="recovery-new-pass" minlength="6" autocomplete="new-password"></div>
        <div class="field"><label>Confirm New Password</label>
          <input type="password" id="recovery-new-pass2" minlength="6" autocomplete="new-password"></div>
        <p id="recovery-error2" class="error-msg hidden"></p>`,
        '<button class="btn btn-success" id="recovery-reset">Save & Sign In</button><button class="btn btn-ghost" id="recovery-back">Back</button>');

      document.getElementById('recovery-back')?.addEventListener('click', showStep1);
      document.getElementById('recovery-reset')?.addEventListener('click', async () => {
        const username = document.getElementById('recovery-username').value;
        const pass = document.getElementById('recovery-new-pass').value;
        const pass2 = document.getElementById('recovery-new-pass2').value;
        const errEl = document.getElementById('recovery-error2');
        errEl.classList.add('hidden');
        if (pass.length < 4) {
          errEl.textContent = 'Password must be at least 4 characters';
          errEl.classList.remove('hidden');
          return;
        }
        if (pass !== pass2) {
          errEl.textContent = 'Passwords do not match';
          errEl.classList.remove('hidden');
          return;
        }
        const res = await API.resetPasswordViaRecovery(verifiedSecret, username, pass);
        if (!res.success) {
          errEl.textContent = res.error || 'Reset failed';
          errEl.classList.remove('hidden');
          return;
        }
        Utils.hideModal();
        document.getElementById('login-username').value = username;
        document.getElementById('login-password').value = pass;
        Utils.toast(`Password reset for "${username}". You can sign in now.`, 'success');
      });
    };

    showStep1();
  },

  async showFactoryResetModal(fromAdmin = false) {
    const shopName = this.settings?.shop_name || '';
    const hasRes = await API.hasRecoverySecret();
    if (!hasRes.success || !hasRes.data) {
      Utils.showModal('Delete Business', `
        <p>Factory reset requires a Private Recovery Phrase.</p>
        <p class="muted">${fromAdmin ? 'Set one in Admin → Security first, then try again.' : 'Recovery is not configured on this system.'}</p>`,
        '<button class="btn btn-primary" id="fr-close">OK</button>');
      document.getElementById('fr-close')?.addEventListener('click', Utils.hideModal);
      return;
    }

    Utils.showModal('Delete Business & Start Over', `
      <p style="color:var(--danger);font-weight:600">This permanently deletes ALL business data:</p>
      <ul class="muted" style="font-size:13px;margin:8px 0 12px;padding-left:18px">
        <li>All users and passwords</li>
        <li>Products, sales, customers, reports</li>
        <li>Shop settings and logo</li>
      </ul>
      <p class="muted">You will return to the setup wizard to register a new business. This cannot be undone.</p>
      <div class="field"><label>Private Recovery Phrase *</label>
        <input type="password" id="fr-secret" autocomplete="off"></div>
      <div class="field"><label>Type <strong>DELETE</strong> or your shop name <strong>${shopName || '(shop name)'}</strong> to confirm</label>
        <input type="text" id="fr-confirm" autocomplete="off" placeholder="DELETE"></div>
      <p id="fr-error" class="error-msg hidden"></p>`,
      `<button class="btn btn-danger" id="fr-do">Erase Everything & Register Again</button>
       <button class="btn btn-ghost" id="fr-cancel">Cancel</button>`);

    document.getElementById('fr-cancel')?.addEventListener('click', Utils.hideModal);
    document.getElementById('fr-do')?.addEventListener('click', async () => {
      const secret = document.getElementById('fr-secret').value;
      const confirmText = document.getElementById('fr-confirm').value.trim();
      const errEl = document.getElementById('fr-error');
      errEl.classList.add('hidden');
      const r = await API.factoryResetBusiness(secret, confirmText);
      if (!r.success) {
        errEl.textContent = r.error || 'Reset failed';
        errEl.classList.remove('hidden');
        return;
      }
      Utils.hideModal();
      localStorage.removeItem('shoppos_device_settings');
      Utils.toast('Business deleted. Register your new shop…', 'success');
      setTimeout(() => location.reload(), 800);
    });
  },

  async handleSetup(e) {
    e.preventDefault();
    const btn = document.querySelector('#setup-form button[type=submit]');
    const errEl = document.getElementById('setup-error');
    errEl.classList.add('hidden');

    const data = {
      shop_name: document.getElementById('setup-shop-name').value.trim(),
      phone: document.getElementById('setup-phone').value.trim(),
      address: document.getElementById('setup-address').value.trim(),
      currency: document.getElementById('setup-currency').value,
      tax_rate: parseFloat(document.getElementById('setup-tax').value) || 0,
      tax_enabled: parseFloat(document.getElementById('setup-tax').value) > 0 ? 1 : 0,
      receipt_footer: document.getElementById('setup-footer').value.trim(),
      owner_name: document.getElementById('setup-owner-name').value.trim(),
      owner_username: document.getElementById('setup-owner-username').value.trim(),
      owner_password: document.getElementById('setup-owner-password').value,
      owner_pin: document.getElementById('setup-owner-pin').value || null,
      recovery_secret: document.getElementById('setup-recovery').value,
      recovery_secret_confirm: document.getElementById('setup-recovery-confirm').value
    };

    btn.disabled = true;
    btn.textContent = 'Setting up…';

    try {
      const result = await API.completeSetup(data);
      if (!result?.success) {
        throw new Error(result?.error || 'Setup failed');
      }
      const res = await API.getSettingsParsed();
      if (!res.success) throw new Error(res.error || 'Could not load settings');
      this.settings = res.data;
      this.updateBranding();
      Utils.toast('Setup complete! Please sign in.', 'success');
      this.showScreen('login');
    } catch (err) {
      errEl.textContent = err.message || 'Setup failed. Please try again.';
      errEl.classList.remove('hidden');
      Utils.toast(err.message || 'Setup failed', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Complete Setup';
    }
  },

  async ensurePageScripts(page) {
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    const scripts = [
      ...(this._pageBundles[page] || []),
      ...(this._lazyScripts[page] || [])
    ];
    // On desktop Electron, pages are usually already in index.html — loadScript no-ops via cache
    for (const src of scripts) {
      try { await Utils.loadScript(src); } catch (err) {
        if (isMobile) console.warn('Lazy script load failed:', src, err);
      }
    }
    this.bindPageModule(page);
  },

  async ensureFeatureScript(src) {
    try { await Utils.loadScript(src); } catch (err) {
      console.warn('Feature script load failed:', src, err);
    }
  },

  async enterApp() {
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    this.stopLoginOperatingTimer();

    // Settings first (needed for branding)
    const settingsRes = await API.getSettingsParsed();
    if (settingsRes.success) this.settings = settingsRes.data;
    this.updateBranding();
    this.applyTheme();

    // Marketing agents work in the standalone Marketing Agent System
    if (this.user?.role === 'marketing_agent') {
      await this.openMarketingAgent({ fromLogin: true });
      return;
    }

    this.showScreen('app');
    this.renderNav();
    document.getElementById('sidebar-user-role').textContent =
      (this.user?.full_name || '') + ' · ' + (this.user?.role || '');

    const startPage = this.user.role === 'cashier' ? 'pos'
      : this.user.role === 'supervisor' ? 'pos'
      : 'dashboard';
    // Navigate ASAP — do not wait for timers / sync / notifications
    await this.navigate(startPage);

    // Background startup (never block UI)
    const bg = async () => {
      try {
        const br = await API.getActiveBranch();
        if (br.success && br.data) {
          this.activeBranch = br.data;
          document.getElementById('sidebar-user-role').textContent =
            this.user.full_name + ' · ' + this.user.role + ' · ' + this.activeBranch.name;
        }
      } catch { /* ignore */ }
      try { await API.logOperatingEvent('open', this.user); } catch { /* ignore */ }
      try { await API.ensureDemoNotificationSound(); } catch { /* ignore */ }
      this.startOperatingTimer();
      this.startAutoLogoutTimer();
      this.startNotificationSoundMonitor();
      this.startSyncMonitor();
      this.startSessionMonitor();
      this.startNotificationRefresh();
      this.startScheduledDocMonitor();
      this.loadNotifications();
      this.runDeferredStartup();
    };
    if (isMobile) setTimeout(bg, 0);
    else requestIdleCallback?.(() => bg(), { timeout: 1500 }) || setTimeout(bg, 100);
  },

  async runDeferredStartup() {
    try { await API.runStartupTasks(); } catch { /* offline */ }
    try {
      if (this.user?.role === 'owner' || this.user?.role === 'manager') {
        await API.refreshPaymentDueNotifications();
        await this.loadNotifications();
      }
    } catch { /* offline */ }
  },

  startScheduledDocMonitor() {
    this.stopScheduledDocMonitor();
    if (!this.user) return;
    this._scheduledDocInterval = setInterval(async () => {
      try {
        await API.processScheduledDocuments();
        await this.loadNotifications();
      } catch { /* offline */ }
    }, 60000);
  },

  stopScheduledDocMonitor() {
    if (this._scheduledDocInterval) clearInterval(this._scheduledDocInterval);
    this._scheduledDocInterval = null;
  },

  renderNav() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = this.navItems
      .filter(item => Utils.canAccess(this.user, item.id))
      .map(item => `<button class="nav-btn" data-page="${item.id}">${item.label}</button>`)
      .join('');
  },

  async navigate(page) {
    // Immediate UI feedback — do not wait on session check for nav highlight
    this.closeSidebar();
    if (page === 'settings') {
      if (!this.user) return;
    } else if (!Utils.canAccess(this.user, page)) {
      return;
    }
    this.currentPage = page;
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.page === page));
    const titles = {
      dashboard: 'Dashboard', admin: 'Admin Panel', pos: 'Point of Sale', staff: 'Staff Portal', products: 'Products', categories: 'Categories',
      stock: 'Stock Management', customers: 'Customers', suppliers: 'Suppliers', expenses: 'Expenses',
      returns: 'Returns', quotes: 'Quotations', layby: 'Lay-Bye', giftcards: 'Gift Cards', marketing: 'Marketing & Flyers',
      'document-hub': 'Document Hub', whatsapp: 'WhatsApp',
      operations: 'Cash-Up & Operations', restaurant: 'Restaurant', recipe: 'Recipe & Production',
      'purchase-orders': 'Purchase Orders', reports: 'Reports', bookkeeping: 'Bookkeeping & Finance', users: 'User Management',
      audit: 'Audit Log', settings: 'Settings'
    };
    document.getElementById('page-title').textContent = titles[page] || page;

    const content = document.getElementById('page-content');
    if (!content) return;

    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    content.dataset.page = page;
    if (!isMobile) {
      content.innerHTML = Utils.pageSkeleton();
    } else {
      content.innerHTML = '<p class="muted" style="padding:12px;margin:0">Opening…</p>';
    }
    content.dataset.loading = '1';

    // Mobile: never block navigation on session check
    if (!isMobile) {
      if (!(await this.ensureSessionActive())) return;
    } else {
      this.ensureSessionActive().catch(() => {});
    }

    await this.ensurePageScripts(page);
    const pageModule = this.bindPageModule(page) || this.pages[page];
    if (!pageModule?.render) {
      content.innerHTML = '<p class="error-msg">This page failed to load. Restart Shop POS.</p>';
      content.dataset.loading = '0';
      return;
    }
    if (page === 'admin' && typeof AdminPage !== 'undefined' && typeof AdminPage.refreshAdminNav === 'function') {
      AdminPage.refreshAdminNav();
    }
    await pageModule.render(content, this);
    content.dataset.loading = '0';

    // Android: warm next likely pages in background (cashier → POS already open)
    if (isMobile && page === 'pos') {
      setTimeout(() => this.ensurePageScripts('products').catch(() => {}), 2000);
    }
  },

  logout() {
    if (!confirm('Logout and return to sign in?')) return;
    this.doLogout();
  },

  async doLogout() {
    try {
      if (this.user) {
        await API.logOperatingEvent('close', this.user);
        try { await API.recordLogout(this.user); } catch { /* ignore */ }
      }
      if (typeof API.logout === 'function') {
        try { await API.logout(); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    this.stopOperatingTimer();
    this.stopAutoLogoutTimer();
    this.stopNotificationSoundMonitor();
    this.stopSyncMonitor();
    this.stopSessionMonitor();
    this.stopNotificationRefresh();
    this.stopScheduledDocMonitor();
    SoundService?.stopAlert();
    Utils.forceHideModal();
    this.user = null;
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-pin').value = '';
    document.getElementById('login-error')?.classList.add('hidden');
    document.getElementById('operating-banner')?.classList.add('hidden');
    this.showScreen('login');
    this.startLoginOperatingTimer();
    requestAnimationFrame(() => {
      const userEl = document.getElementById('login-username');
      userEl?.removeAttribute('readonly');
      userEl?.focus();
    });
  },

  getTodayOperatingHours() {
    const oh = this.getOperatingSettings();
    const weekly = oh.weekly;
    if (weekly?.length) {
      const day = weekly.find(d => d.day === new Date().getDay()) || weekly[new Date().getDay()];
      if (day?.closed) return { ...oh, closed_today: true, open_time: day.open, close_time: day.close };
      return { ...oh, open_time: day?.open || oh.open_time, close_time: day?.close || oh.close_time };
    }
    return oh;
  },

  getOperatingSettings() {
    return this.settings?.operating_hours_settings || {
      enabled: false, close_time: '18:00', open_time: '08:00', warn_minutes: 15, alert_at_close: true
    };
  },

  parseTimeToday(timeStr) {
    const [h, m] = (timeStr || '18:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d;
  },

  formatCountdown(ms) {
    if (ms <= 0) return '00:00:00';
    const total = Math.floor(ms / 1000);
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    return [hh, mm, ss].map(n => String(n).padStart(2, '0')).join(':');
  },

  startOperatingTimer() {
    this.stopOperatingTimer();
    const banner = document.getElementById('operating-banner');
    if (!banner) return;
    const oh = this.getOperatingSettings();
    if (!oh.enabled) {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    this._closeAlertShown = false;
    this._operatingTick = () => this.updateOperatingBanner();
    this._operatingTick();
    this._operatingInterval = setInterval(this._operatingTick, 1000);
  },

  stopOperatingTimer() {
    if (this._operatingInterval) clearInterval(this._operatingInterval);
    this._operatingInterval = null;
  },

  startLoginOperatingTimer() {
    this.stopLoginOperatingTimer();
    const el = document.getElementById('login-operating-timer');
    if (!el) return;
    el.classList.remove('hidden');
    this._loginOperatingTick = () => this.updateLoginOperatingTimer();
    this._loginOperatingTick();
    this._loginOperatingInterval = setInterval(this._loginOperatingTick, 1000);
  },

  stopLoginOperatingTimer() {
    if (this._loginOperatingInterval) clearInterval(this._loginOperatingInterval);
    this._loginOperatingInterval = null;
  },

  updateLoginOperatingTimer() {
    const el = document.getElementById('login-operating-timer');
    const label = document.getElementById('login-operating-text');
    if (!el || !label) return;
    const oh = this.getTodayOperatingHours();
    const hasSchedule = oh.open_time && oh.close_time;
    if (!oh.enabled && !hasSchedule) {
      label.textContent = 'Operating hours not configured — set in Admin → Operating Hours';
      el.classList.remove('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (oh.closed_today) {
      label.textContent = 'Shop is closed today per weekly schedule.';
      return;
    }
    const openTime = oh.open_time || '08:00';
    const closeTime = oh.close_time || '18:00';
    const now = new Date();
    const openAt = this.parseTimeToday(openTime);
    const closeAt = this.parseTimeToday(closeTime);
    if (now < openAt) {
      label.textContent = `Opens at ${openTime} — ${this.formatCountdown(openAt - now)} until open`;
    } else if (now >= closeAt) {
      label.textContent = `Closed — was open until ${closeTime}`;
    } else {
      label.textContent = `Open until ${closeTime} — ${this.formatCountdown(closeAt - now)} remaining`;
    }
  },

  startAutoLogoutTimer() {
    this.stopAutoLogoutTimer();
    const mins = parseInt(this.settings?.security_settings?.auto_logout_minutes, 10);
    if (!mins || mins <= 0 || !this.user) return;
    this._lastActivity = Date.now();
    this._autoLogoutReset = () => { this._lastActivity = Date.now(); };
    this._autoLogoutEvents = ['click', 'keydown', 'touchstart', 'mousemove'];
    this._autoLogoutEvents.forEach(ev => document.addEventListener(ev, this._autoLogoutReset, { passive: true }));
    this._autoLogoutInterval = setInterval(() => {
      if (Date.now() - this._lastActivity >= mins * 60000) {
        Utils.toast('Session timed out — please sign in again', 'error');
        this.doLogout();
      }
    }, 30000);
  },

  stopAutoLogoutTimer() {
    if (this._autoLogoutInterval) clearInterval(this._autoLogoutInterval);
    this._autoLogoutInterval = null;
    if (this._autoLogoutEvents && this._autoLogoutReset) {
      this._autoLogoutEvents.forEach(ev => document.removeEventListener(ev, this._autoLogoutReset));
    }
    this._autoLogoutEvents = null;
    this._autoLogoutReset = null;
  },

  updateOperatingBanner() {
    const banner = document.getElementById('operating-banner');
    const label = document.getElementById('operating-banner-text');
    if (!banner || !label) return;
    const oh = this.getTodayOperatingHours();
    if (!oh.enabled || !this.user) {
      banner.classList.add('hidden');
      return;
    }
    if (oh.closed_today) {
      banner.className = 'operating-banner operating-banner--closed';
      label.textContent = 'Shop is closed today per weekly schedule.';
      return;
    }
    banner.classList.remove('hidden');
    const closeAt = this.parseTimeToday(oh.close_time);
    const diff = closeAt - new Date();
    const warnMins = oh.warn_minutes || 15;

    if (diff <= 0) {
      banner.className = 'operating-banner operating-banner--closed';
      label.textContent = `Closing time reached (${oh.close_time}). Please finish sales and logout when done.`;
      if (oh.alert_at_close && !this._closeAlertShown) {
        this._closeAlertShown = true;
        Utils.toast('Closing time reached! Please wrap up and logout.', 'error');
        SoundService?.startAlert(this.settings);
        if (this.user.role === 'cashier') {
          Utils.showModal('Closing Time',
            '<p>The scheduled shop closing time has been reached. Please complete any open sales and use <strong>Logout</strong> when finished.</p>',
            '<button class="btn btn-primary" id="close-time-ok">OK</button>');
          document.getElementById('close-time-ok')?.addEventListener('click', () => {
            Utils.hideModal();
            SoundService?.stopAlert();
          });
        }
      }
      return;
    }

    banner.className = 'operating-banner' + (diff / 60000 <= warnMins ? ' operating-banner--warn' : '');
    label.textContent = `Closes at ${oh.close_time} — ${this.formatCountdown(diff)} remaining`;
  },

  async checkNotificationSounds() {
    if (!this.user || !['owner', 'manager'].includes(this.user.role)) {
      SoundService?.stopAlert();
      return;
    }
    let shouldAlert = false;
    try {
      const { alerts } = await this.fetchNotificationBuckets();
      if (alerts.length) shouldAlert = true;
    } catch { /* offline */ }
    if (shouldAlert && this.settings?.notification_settings?.loop_until_read !== false) {
      await SoundService.startAlert(this.settings);
    } else {
      SoundService.stopAlert();
    }
  },

  startNotificationSoundMonitor() {
    this.stopNotificationSoundMonitor();
    if (!this.user || !['owner', 'manager'].includes(this.user.role)) return;
    this.checkNotificationSounds();
    this._notifSoundInterval = setInterval(() => this.checkNotificationSounds(), 15000);
  },

  stopNotificationSoundMonitor() {
    if (this._notifSoundInterval) clearInterval(this._notifSoundInterval);
    this._notifSoundInterval = null;
  },

  async runBackgroundSync() {
    // Hub sync / online ordering removed — all clients use Supabase directly.
  },

  startNotificationRefresh() {
    this.stopNotificationRefresh();
    if (!this.user) return;
    this._notifRefreshInterval = setInterval(() => {
      this.loadNotifications();
      if (this.user?.role === 'owner' || this.user?.role === 'manager') {
        this.checkNotificationSounds();
      }
    }, 60000);
  },

  stopNotificationRefresh() {
    if (this._notifRefreshInterval) clearInterval(this._notifRefreshInterval);
    this._notifRefreshInterval = null;
  },

  startSessionMonitor() {
    this.stopSessionMonitor();
    if (!this.user?.id) return;
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    // Android: less frequent — avoid freezing taps every 15s
    const every = isMobile ? 60000 : 15000;
    if (!isMobile) this.ensureSessionActive();
    else setTimeout(() => this.ensureSessionActive().catch(() => {}), 8000);
    this._sessionCheckInterval = setInterval(() => this.ensureSessionActive().catch(() => {}), every);
  },

  async ensureSessionActive() {
    if (!this.user?.id) return true;
    try {
      const v = await API.verifyUserSession(this.user.id);
      if (v.success && v.data?.active === false) {
        Utils.toast(v.data?.error || 'Account deactivated — system access is frozen.', 'error');
        document.body.classList.add('system-frozen');
        await this.doLogout();
        return false;
      }
      if (v.success && v.data?.active) {
        this.user.is_active = 1;
        document.body.classList.remove('system-frozen');
        return true;
      }
    } catch {
      if (this.user.is_active === 0 || this.user.is_active === false) {
        Utils.toast('Account deactivated — system access is frozen.', 'error');
        document.body.classList.add('system-frozen');
        await this.doLogout();
        return false;
      }
    }
    return true;
  },

  _getDismissedPending() {
    try { return JSON.parse(sessionStorage.getItem('shoppos_dismissed_pending') || '[]'); } catch { return []; }
  },

  _dismissPending(pendingKey) {
    const id = String(pendingKey).replace('pending-', '');
    const ids = this._getDismissedPending();
    if (!ids.includes(id)) ids.push(id);
    sessionStorage.setItem('shoppos_dismissed_pending', JSON.stringify(ids.slice(-100)));
  },

  _getDismissedReminders() {
    try {
      const raw = JSON.parse(localStorage.getItem('shoppos_dismissed_reminders') || '{}');
      if (raw.date !== Utils.today()) return [];
      return raw.ids || [];
    } catch { return []; }
  },

  _dismissReminder(reminderId) {
    const ids = this._getDismissedReminders();
    if (!ids.includes(reminderId)) ids.push(reminderId);
    localStorage.setItem('shoppos_dismissed_reminders', JSON.stringify({ date: Utils.today(), ids: ids.slice(-50) }));
  },

  _isNotifToday(createdAt) {
    if (!createdAt) return false;
    return new Date(createdAt).toLocaleDateString('en-CA') === Utils.today();
  },

  _matchesNotifFilter(createdAt, filter) {
    if (filter === 'all') return true;
    const d = createdAt ? new Date(createdAt).toLocaleDateString('en-CA') : Utils.today();
    if (filter === 'today') return d === Utils.today();
    if (filter === 'week') return d >= Utils.weekStart() && d <= Utils.today();
    return true;
  },

  navigateToAdminSection(sectionId, tabId = null) {
    if (sectionId === 'combos' && tabId && window.AdminCombosPage) {
      AdminCombosPage.tab = tabId;
    }
    if (sectionId === 'staffhr' && tabId && window.AdminPage) {
      AdminPage.staffTab = tabId;
    }
    this.navigate('admin');
    setTimeout(() => {
      const btn = document.querySelector(`.admin-nav-btn[data-section="${sectionId}"]`)
        || document.querySelector(`.admin-quick[data-section="${sectionId}"]`);
      if (btn) btn.click();
      else if (window.AdminPage) {
        AdminPage.section = sectionId;
        AdminPage.renderSection(document.getElementById('admin-content'));
      }
    }, 300);
  },

  navigateToBookkeepingTab(tabId) {
    if (window.BookkeepingPage) BookkeepingPage.tab = tabId;
    this.navigate('bookkeeping');
  },

  navigateToStaffTab(tabId) {
    if (window.StaffPage) StaffPage.staffTab = tabId;
    this.navigate('staff');
  },

  navigateToOperationsTab(tabId, entityId) {
    if (window.OperationsPage) {
      OperationsPage.tab = tabId;
      if (entityId != null) OperationsPage.pendingOpenId = entityId;
    }
    this.navigate('operations');
  },

  navigateToStockTab(tabId) {
    if (window.StockPage) StockPage.tab = tabId;
    this.navigate('stock');
  },

  notificationConcernsUser(n) {
    const role = this.user?.role;
    if (!role) return false;
    if (n.audience_roles) {
      const roles = String(n.audience_roles).split(',').map(s => s.trim()).filter(Boolean);
      if (roles.length && !roles.includes(role)) return false;
    }
    const page = String(n.action_page || '').toLowerCase();
    const t = String(n.type || '').toLowerCase();
    if (page.startsWith('operations:') && !Utils.canAccess(this.user, 'operations')) {
      if (!(role === 'cashier' && ['cashup', 'cashout', 'target_met', 'target_missed'].includes(t))) return false;
    }
    if (page.startsWith('admin:') && !Utils.canAccessAdmin(this.user)) return false;
    if (page === 'staff' && !Utils.canAccess(this.user, 'staff')) return false;
    if ((page.startsWith('bookkeeping') || ['low_cash', 'ar', 'ap', 'budget'].includes(t))
      && !Utils.canAccess(this.user, 'bookkeeping')) return false;
    if (['low_stock', 'out_of_stock', 'reorder'].includes(t) && role === 'cashier') return false;
    if (t.startsWith('recruitment') && !['owner', 'manager', 'supervisor', 'assistant_manager'].includes(role)) return false;
    return true;
  },

  navigateToNotificationTarget(type, kind, actionPage) {
    const page = String(actionPage || '').toLowerCase();
    if (page.startsWith('document-hub:share:')) {
      const docId = parseInt(page.split(':')[2], 10);
      if (window.DocumentHubPage) DocumentHubPage.pendingShareId = docId;
      this.navigate('document-hub');
      return;
    }
    if (page === 'operations:cashup' || page.startsWith('operations:cashup')) {
      this.navigateToOperationsTab('cashup');
      return;
    }
    if (page === 'operations:stockcount' || page.startsWith('operations:stockcount')) {
      const parts = page.split(':');
      const countId = parts[2] ? parseInt(parts[2], 10) : null;
      this.navigateToOperationsTab('stockcount', Number.isFinite(countId) ? countId : null);
      return;
    }
    if (page === 'admin:recruitment' || page.startsWith('admin:recruitment') || page === 'staffhr:recruitment') {
      if (Utils.canAccessAdminSection?.(this.user, 'staffhr') || Utils.canAccessAdmin(this.user)) {
        if (window.AdminPage) AdminPage.staffTab = 'recruitment';
        this.navigateToAdminSection('staffhr');
      } else {
        this.navigateToAdminSection('recruitment');
      }
      return;
    }
    if (page === 'admin:combos' || page.startsWith('admin:combos:')) {
      const tab = page.split(':')[2] || 'list';
      this.navigateToAdminSection('combos', tab);
      return;
    }
    if (page === 'admin:approvals') {
      this.navigateToAdminSection('approvals');
      return;
    }
    if (page === 'admin:security') {
      this.navigateToAdminSection('security');
      return;
    }
    if (page === 'admin:onaccount') {
      this.navigateToAdminSection('onaccount');
      return;
    }
    if (page === 'admin:opscompliance') {
      this.navigateToAdminSection('opscompliance');
      return;
    }
    if (page === 'operations:non-selling' || page === 'stock:nonselling') {
      this.navigateToStockTab('nonselling');
      return;
    }
    const t = String(type || '').toLowerCase();
    if (kind === 'pending') {
      this.navigateToAdminSection('approvals');
      return;
    }
    const inventory = ['low_stock', 'out_of_stock', 'reorder'];
    const payroll = ['payroll_due', 'uif', 'paye', 'sdl', 'coida', 'cert', 'salary'];
    const ownerSalary = ['owner_salary_due', 'owner_salary_overdue', 'owner_salary'];
    const bookkeeping = ['low_cash', 'ar', 'ap', 'budget'];
    if (inventory.includes(t)) this.navigateToAdminSection('inventory');
    else if (payroll.includes(t)) this.navigateToAdminSection('payroll');
    else if (ownerSalary.includes(t)) {
      if (this.user?.role === 'owner' || this.user?.role === 'manager') this.navigateToStaffTab('owner-salary');
      else this.navigateToAdminSection('payroll');
    } else if (t === 'donation') this.navigateToBookkeepingTab('donations');
    else if (t.startsWith('probation_')) this.navigateToAdminSection('hrcontracts');
    else if (t === 'compliance' || t === 'checklist_reminder' || t === 'checklist_overdue') {
      if (Utils.canAccess(this.user, 'staff')) this.navigate('staff');
      else this.navigateToAdminSection('opscompliance');
    }
    else if (t === 'promo_approval_pending' || t === 'combo_approval_pending') {
      this.navigateToAdminSection('combos', t === 'promo_approval_pending' ? 'promos' : 'approvals');
    }
    else if (t === 'customer_overdue') this.navigate('customers');
    else if (['cashout', 'cashup', 'target_met', 'target_missed', 'cash_drop'].includes(t)) this.navigateToOperationsTab('cashup');
    else if (t === 'stock_count') this.navigateToOperationsTab('stockcount');
    else if (t.startsWith('recruitment')) {
      if (Utils.canAccessAdminSection?.(this.user, 'staffhr')) this.navigateToAdminSection('staffhr', 'recruitment');
      else this.navigateToAdminSection('recruitment');
    }
    else if (t === 'document_share') {
      if (actionPage?.startsWith('document-hub:share:')) {
        const docId = parseInt(String(actionPage).split(':')[2], 10);
        if (window.DocumentHubPage) DocumentHubPage.pendingShareId = docId;
      }
      this.navigate('document-hub');
    }
    else if (bookkeeping.includes(t)) {
      const tab = { low_cash: 'dashboard', ar: 'dashboard', ap: 'dashboard', budget: 'budgets' }[t] || 'dashboard';
      this.navigateToBookkeepingTab(tab);
    } else if (t === 'test') { /* no navigation */ }
    else if (Utils.canAccess(this.user, 'dashboard')) this.navigate('dashboard');
    else if (Utils.canAccess(this.user, 'pos')) this.navigate('pos');
    else if (Utils.canAccess(this.user, 'staff')) this.navigate('staff');
  },

  stopSessionMonitor() {
    if (this._sessionCheckInterval) clearInterval(this._sessionCheckInterval);
    this._sessionCheckInterval = null;
  },

  startSyncMonitor() {
    this.stopSyncMonitor();
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    // Never block UI — sync after first paint; longer interval on Android
    const kick = () => { this.runBackgroundSync().catch(() => {}); };
    if (isMobile) {
      setTimeout(kick, 2500);
      this._syncInterval = setInterval(kick, 120000);
    } else {
      kick();
      this._syncInterval = setInterval(kick, 60000);
    }
  },

  stopSyncMonitor() {
    if (this._syncInterval) clearInterval(this._syncInterval);
    this._syncInterval = null;
  },

  async handleSearch(query) {
    const dropdown = document.getElementById('search-results');
    if (!query || query.length < 2) { dropdown.classList.add('hidden'); return; }
    const q = query.toLowerCase();
    const res = await API.globalSearch(query);
    const data = res.data || {};
    const currency = this.settings?.currency;
    const user = this.user;
    const canAdmin = Utils.canAccessAdmin(user);
    let html = '';

    // Features / panels the current role can open
    const featureHits = this.navItems.filter(item => {
      const label = item.label.replace(/^[^\w]+/, '').toLowerCase();
      const id = item.id.toLowerCase();
      if (!(label.includes(q) || id.includes(q) || q.split(/\s+/).some(w => w.length > 1 && (label.includes(w) || id.includes(w))))) return false;
      return item.id === 'admin' ? canAdmin : Utils.canAccess(user, item.id);
    });
    const adminSections = (typeof AdminPage !== 'undefined' && AdminPage.sections) || [];
    const adminHits = canAdmin ? adminSections.filter(s =>
      s.label.toLowerCase().includes(q) && Utils.canAccessAdminSection(user, s.id)
    ).slice(0, 12) : [];
    if (featureHits.length || adminHits.length) {
      html += '<div class="search-group"><h4>Features</h4>';
      html += featureHits.map(f =>
        `<div class="search-item" data-action="page" data-page="${f.id}">${f.label}</div>`).join('');
      html += adminHits.map(s =>
        `<div class="search-item" data-action="setting" data-section="${s.id}">Admin · ${s.label}</div>`).join('');
      html += '</div>';
    }

    if (data.products?.length && (Utils.canAccess(user, 'products') || Utils.canAccess(user, 'pos'))) {
      html += '<div class="search-group"><h4>Products</h4>' +
        data.products.map(p => `<div class="search-item" data-action="product" data-id="${p.id}">${p.name} — ${Utils.formatMoney(p.selling_price, currency)}</div>`).join('') + '</div>';
    }
    if (data.categories?.length && Utils.canAccess(user, 'categories')) {
      html += '<div class="search-group"><h4>Categories</h4>' +
        data.categories.map(c => `<div class="search-item" data-action="page" data-page="categories">${c.name}</div>`).join('') + '</div>';
    }
    if (data.employees?.length && (Utils.canAccess(user, 'staff') || canAdmin)) {
      html += '<div class="search-group"><h4>Employees</h4>' +
        data.employees.map(e => `<div class="search-item" data-action="employee">${e.full_name}${e.employee_code ? ` (${e.employee_code})` : ''}${e.position ? ` — ${e.position}` : ''}</div>`).join('') + '</div>';
    }
    if (data.combos?.length && (Utils.canAccess(user, 'pos') || (canAdmin && Utils.canAccessAdminSection(user, 'combos')))) {
      html += '<div class="search-group"><h4>Combos</h4>' +
        data.combos.map(c => `<div class="search-item" data-action="combo">${c.name} — ${Utils.formatMoney(c.selling_price, currency)}</div>`).join('') + '</div>';
    }
    if (data.giftcards?.length && Utils.canAccess(user, 'giftcards')) {
      html += '<div class="search-group"><h4>Gift Cards</h4>' +
        data.giftcards.map(g => `<div class="search-item" data-action="page" data-page="giftcards"><code>${g.code}</code> — ${g.customer_name || '—'} · ${Utils.formatMoney(g.balance, currency)}</div>`).join('') + '</div>';
    }
    if (data.laybyes?.length && Utils.canAccess(user, 'layby')) {
      html += '<div class="search-group"><h4>Lay-Bye</h4>' +
        data.laybyes.map(l => `<div class="search-item" data-action="page" data-page="layby">${l.layby_number || 'Layby'} — ${l.customer_name || '—'} · ${l.status}</div>`).join('') + '</div>';
    }
    if (data.quotes?.length && Utils.canAccess(user, 'quotes')) {
      html += '<div class="search-group"><h4>Quotations</h4>' +
        data.quotes.map(qt => `<div class="search-item" data-action="page" data-page="quotes">${qt.quote_number} — ${Utils.formatMoney(qt.total, currency)}</div>`).join('') + '</div>';
    }
    if (data.expenses?.length && Utils.canAccess(user, 'expenses')) {
      html += '<div class="search-group"><h4>Expenses</h4>' +
        data.expenses.map(e => `<div class="search-item" data-action="page" data-page="expenses">${e.description} — ${Utils.formatMoney(e.amount, currency)}</div>`).join('') + '</div>';
    }
    if (data.donations?.length && Utils.canAccess(user, 'bookkeeping')) {
      html += '<div class="search-group"><h4>Donations</h4>' +
        data.donations.map(d => `<div class="search-item" data-action="donation">${d.donation_number || 'Donation'} — ${d.recipient_org || 'Unknown'}</div>`).join('') + '</div>';
    }
    if (data.customers?.length && Utils.canAccess(user, 'customers')) {
      html += '<div class="search-group"><h4>Customers</h4>' +
        data.customers.map(c => `<div class="search-item" data-action="customer" data-id="${c.id}">${c.name} — ${c.phone || ''}</div>`).join('') + '</div>';
    }
    if (data.suppliers?.length && Utils.canAccess(user, 'suppliers')) {
      html += '<div class="search-group"><h4>Suppliers</h4>' +
        data.suppliers.map(s => `<div class="search-item" data-action="supplier">${s.name}${s.phone ? ` — ${s.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.receipts?.length && Utils.canAccess(user, 'pos')) {
      html += '<div class="search-group"><h4>Receipts / Orders</h4>' +
        data.receipts.map(r => `<div class="search-item" data-action="receipt" data-id="${r.receipt_number}">${r.order_number ? `Order ${r.order_number} · ` : ''}${r.receipt_number} — ${Utils.formatMoney(r.total, currency)}</div>`).join('') + '</div>';
    }
    if (data.users?.length && Utils.canAccess(user, 'users')) {
      html += '<div class="search-group"><h4>Users</h4>' +
        data.users.map(u => `<div class="search-item" data-action="page" data-page="users">${u.full_name || u.username} · ${u.role}</div>`).join('') + '</div>';
    }
    if (data.settings?.length && canAdmin) {
      html += '<div class="search-group"><h4>Settings</h4>' +
        data.settings.filter(s => Utils.canAccessAdminSection(user, s.section)).map(s =>
          `<div class="search-item" data-action="setting" data-section="${s.section}">${s.label}: ${s.value}</div>`).join('') + '</div>';
    }
    dropdown.innerHTML = html || '<div class="search-group"><p class="muted">No results</p></div>';
    dropdown.classList.remove('hidden');
    dropdown.querySelectorAll('[data-action="page"]').forEach(el => {
      el.addEventListener('click', () => { dropdown.classList.add('hidden'); this.navigate(el.dataset.page); });
    });
    dropdown.querySelectorAll('[data-action="product"]').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        if (Utils.canAccess(user, 'products')) this.navigate('products');
        else this.navigate('pos');
      });
    });
    dropdown.querySelectorAll('[data-action="employee"]').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        if (canAdmin && Utils.canAccessAdminSection(this.user, 'staffhr')) this.navigateToAdminSection('staffhr');
        else if (Utils.canAccess(this.user, 'staff')) this.navigate('staff');
      });
    });
    dropdown.querySelectorAll('[data-action="combo"]').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        if (canAdmin && Utils.canAccessAdminSection(this.user, 'combos')) this.navigateToAdminSection('combos');
        else if (Utils.canAccess(this.user, 'pos')) this.navigate('pos');
      });
    });
    dropdown.querySelectorAll('[data-action="donation"]').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        if (Utils.canAccess(this.user, 'bookkeeping')) this.navigateToBookkeepingTab('donations');
      });
    });
    dropdown.querySelectorAll('[data-action="supplier"]').forEach(el => {
      el.addEventListener('click', () => { dropdown.classList.add('hidden'); this.navigate('suppliers'); });
    });
    dropdown.querySelectorAll('[data-action="setting"]').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        if (Utils.canAccessAdminSection(this.user, el.dataset.section)) {
          this.navigateToAdminSection(el.dataset.section);
        }
      });
    });
    dropdown.querySelectorAll('[data-action="receipt"]').forEach(el => {
      el.addEventListener('click', async () => {
        dropdown.classList.add('hidden');
        const saleRes = await API.getSaleByReceipt(el.dataset.id);
        if (saleRes.success && saleRes.data) {
          Utils.showModal(`Receipt ${saleRes.data.receipt_number}`, `
            <p><strong>Total:</strong> ${Utils.formatMoney(saleRes.data.total, currency)}</p>
            <p><strong>Date:</strong> ${Utils.formatDateTime(saleRes.data.created_at)}</p>
            <p><strong>Cashier:</strong> ${saleRes.data.cashier_name || '—'}</p>
            <p><strong>Payments:</strong> ${(saleRes.data.payments||[]).map(p => `${p.payment_type} ${Utils.formatMoney(p.amount, currency)}`).join(', ') || '—'}</p>`,
            '<button class="btn btn-primary" id="search-receipt-close">Close</button>');
          document.getElementById('search-receipt-close')?.addEventListener('click', Utils.hideModal);
        } else Utils.toast('Receipt not found', 'error');
      });
    });
    dropdown.querySelectorAll('[data-action="customer"]').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        this.navigate('customers');
      });
    });
  },

  async fetchNotificationBuckets() {
    const res = await API.getNotifications(this.user);
    const alerts = (res.data || [])
      .map(n => ({ ...n, kind: 'alert' }))
      .filter(n => this.notificationConcernsUser(n));
    let pending = [];
    try {
      // Settings approvals — owner/manager only
      if (['owner', 'manager'].includes(this.user?.role)) {
        const pr = await API.getPendingSettingsRequests();
        pending = (pr.data || []).map(p => ({
          id: `pending-${p.id}`,
          pendingId: p.id,
          type: 'pending',
          title: 'Settings approval needed',
          message: p.description || p.setting_key || 'Pending settings change',
          created_at: p.created_at || new Date().toISOString(),
          kind: 'pending',
          action_page: 'admin:approvals',
          audience_roles: 'owner,manager'
        })).filter(p => !this._getDismissedPending().includes(String(p.pendingId)));
      }
    } catch { /* offline */ }

    const reminders = [];
    if (this.user && (this.user.role === 'owner' || this.user.role === 'manager')) {
      try {
        const dismissed = this._getDismissedReminders();
        const comp = await API.getComplianceReminders();
        (comp.data || []).forEach((n, i) => {
          const id = `comp-${n.type || i}`;
          if (dismissed.includes(id)) return;
          reminders.push({ id, type: n.type || 'compliance', title: n.title, message: n.message, created_at: new Date().toISOString(), kind: 'reminder' });
        });
        const fin = await API.getFinancialNotifications();
        (fin.data || []).forEach((n, i) => {
          const id = `fin-${n.type || i}`;
          if (dismissed.includes(id)) return;
          reminders.push({ id, type: n.type || 'compliance', title: n.title, message: n.message, created_at: new Date().toISOString(), kind: 'reminder' });
        });
      } catch { /* offline */ }
    }

    // Online ordering removed — do not surface hub online-order alerts.

    return { alerts, pending, reminders };
  },

  async loadNotifications() {
    const { alerts, pending } = await this.fetchNotificationBuckets();
    const count = alerts.length + pending.length;
    const badge = document.getElementById('notif-badge');
    if (count) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  _renderNotifRow(n) {
    const isNew = this._isNotifToday(n.created_at);
    const newBadge = isNew ? ' <span class="notif-new-badge">New</span>' : '';
    const rowCls = `notif-row notif-row--clickable${isNew ? ' notif-row--new' : ''}`;
    const actions = n.kind === 'alert'
      ? `<button class="btn btn-sm btn-ghost notif-mark-read" data-id="${n.id}">Mark read</button>`
      : n.kind === 'pending'
        ? `<button class="btn btn-sm btn-ghost notif-dismiss-pending" data-id="${n.id}">Dismiss</button>`
        : `<button class="btn btn-sm btn-ghost notif-dismiss-reminder" data-id="${n.id}">Dismiss</button>`;
    return `<div class="${rowCls}" data-kind="${n.kind}" data-type="${n.type || ''}" data-action-page="${n.action_page || ''}" data-id="${n.id}">
      <div class="notif-row-body">
        <strong>${n.title}</strong>${newBadge}<br><small>${n.message}</small>
        ${n.created_at ? `<br><small class="muted">${Utils.formatDateTime(n.created_at)}</small>` : ''}
      </div>
      <div class="notif-row-actions">${actions}</div>
    </div>`;
  },

  async showNotifications(filter) {
    if (filter) this._notifFilter = filter;
    if (!this._notifFilter) this._notifFilter = 'today';
    const { alerts, pending, reminders } = await this.fetchNotificationBuckets();
    const f = this._notifFilter;
    const filteredAlerts = alerts.filter(n => this._matchesNotifFilter(n.created_at, f));
    const filteredPending = pending.filter(n => this._matchesNotifFilter(n.created_at, f));
    const filteredReminders = reminders.filter(n => this._matchesNotifFilter(n.created_at, f));

    const filterBar = `<div class="notif-filter-bar">
      ${['today', 'week', 'all'].map(id => `<button type="button" class="btn btn-sm ${f === id ? 'btn-primary' : 'btn-ghost'} notif-filter-btn" data-filter="${id}">${id === 'today' ? 'Today' : id === 'week' ? 'This week' : 'All'}</button>`).join('')}
    </div>`;

    let html = filterBar;
    const badgeCount = alerts.length + pending.length;
    if (badgeCount) {
      html += `<p class="muted" style="font-size:12px;margin:0 0 12px">${badgeCount} actionable item${badgeCount === 1 ? '' : 's'} (alerts + approvals)</p>`;
    }

    if (filteredAlerts.length) {
      html += `<h4 style="margin:0 0 8px">Alerts</h4>${filteredAlerts.map(n => this._renderNotifRow(n)).join('')}`;
    } else if (f === 'all' || alerts.length === 0) {
      html += '<p class="muted">No unread alerts</p>';
    } else {
      html += '<p class="muted">No alerts for this period</p>';
    }

    if (filteredPending.length) {
      html += `<h4 style="margin:16px 0 8px">Approvals needed</h4>
        <p class="muted" style="font-size:12px;margin-bottom:8px">These do not trigger the alert sound. Click a row to open Approvals.</p>
        ${filteredPending.map(n => this._renderNotifRow(n)).join('')}`;
    }

    if (reminders.length) {
      html += `<h4 style="margin:16px 0 8px">Business reminders (${reminders.length})</h4>
        <p class="muted" style="font-size:12px;margin-bottom:8px">Informational only — click to go to the relevant screen.</p>`;
      if (filteredReminders.length) {
        html += filteredReminders.map(n => this._renderNotifRow(n)).join('');
      } else {
        html += '<p class="muted">No reminders for this period</p>';
      }
    }

    const footer = [
      this.user?.role === 'owner' ? '<button class="btn btn-warning" id="notif-test-sound">Test Sound</button>' : '',
      alerts.length ? '<button class="btn btn-primary" id="mark-all-read">Mark All Read</button>' : '',
      '<button class="btn btn-ghost" id="notif-close">Close</button>'
    ].filter(Boolean).join(' ');
    Utils.showModal('Notifications', html, footer);

    document.querySelectorAll('.notif-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showNotifications(btn.dataset.filter));
    });

    document.getElementById('notif-test-sound')?.addEventListener('click', async () => {
      try {
        await API.ensureDemoNotificationSound();
        const fresh = await API.getSettingsParsed();
        if (fresh.success) this.settings = fresh.data;
        await SoundService.testAlert(this.settings);
        Utils.toast('Playing test sound for 8 seconds…', 'success');
      } catch (err) {
        Utils.toast(err.message || 'Could not play sound', 'error');
      }
    });

    document.getElementById('mark-all-read')?.addEventListener('click', async () => {
      await API.markAllNotificationsRead();
      Utils.hideModal();
      SoundService?.stopAlert();
      await this.loadNotifications();
      this.checkNotificationSounds();
      Utils.toast('Alerts marked as read', 'success');
    });

    document.querySelectorAll('.notif-row--clickable').forEach(row => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return;
        const kind = row.dataset.kind;
        const type = row.dataset.type;
        Utils.hideModal();
        if (kind === 'alert') {
          await API.markNotificationRead(parseInt(row.dataset.id, 10));
          await this.loadNotifications();
          this.checkNotificationSounds();
        }
        this.navigateToNotificationTarget(type, kind, row.dataset.actionPage);
      });
    });

    document.querySelectorAll('.notif-mark-read').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await API.markNotificationRead(parseInt(btn.dataset.id, 10));
        await this.loadNotifications();
        const { alerts: remaining } = await this.fetchNotificationBuckets();
        if (!remaining.length) {
          Utils.hideModal();
          SoundService?.stopAlert();
          Utils.toast('All alerts attended', 'success');
        } else {
          this.showNotifications();
        }
        this.checkNotificationSounds();
      });
    });

    document.querySelectorAll('.notif-dismiss-pending').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._dismissPending(btn.dataset.id);
        await this.loadNotifications();
        this.showNotifications();
      });
    });

    document.querySelectorAll('.notif-dismiss-reminder').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._dismissReminder(btn.dataset.id);
        this.showNotifications();
      });
    });

    document.getElementById('notif-close')?.addEventListener('click', () => {
      Utils.hideModal();
      this.checkNotificationSounds();
    });
  }
};

function bootApp() {
  App.init().catch(err => App.showMobileError?.(err.message) || console.error(err));
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
