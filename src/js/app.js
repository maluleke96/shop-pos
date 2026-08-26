const App = {
  user: null,
  settings: null,
  currentPage: 'dashboard',
  navHistory: [],
  _suppressHistory: false,

  navItems: [
    { id: 'dashboard', label: '📊 Dashboard', roles: ['owner', 'manager'] },
    { id: 'admin', label: '⚙️ Admin Panel', roles: ['owner', 'manager', 'supervisor'] },
    { id: 'pos', label: '💳 POS', roles: ['owner', 'manager', 'cashier', 'assistant_manager', 'supervisor'] },
    { id: 'staff', label: '👷 Staff Portal', roles: ['owner', 'manager', 'cashier', 'assistant_manager', 'supervisor'] },
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
    { id: 'users', label: '👤 Users', roles: ['owner', 'manager'] },
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
    recipe: ['js/recipe-production/app.js'],
    'purchase-orders': ['js/pages/purchase-orders.js'],
    reports: ['js/pages/reports.js'],
    bookkeeping: ['js/pages/bookkeeping.js'],
    users: ['js/pages/users.js'],
    audit: ['js/pages/audit.js'],
    settings: ['js/pages/settings.js'],
    admin: [
      'js/pages/staff.js',
      'js/pages/staff-owner-salary.js',
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
      'js/pages/admin-marketing.js',
      'js/pages/users.js'
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

  appMode() {
    return window.__SHOP_POS_APP_MODE__ || 'admin';
  },

  isPosKiosk() {
    return this.appMode() === 'pos';
  },

  applyPosKioskChrome() {
    const on = this.isPosKiosk();
    document.documentElement.classList.toggle('pos-kiosk', on);
    document.body.classList.toggle('pos-kiosk', on);
    if (on) {
      document.getElementById('login-back-welcome')?.classList.add('hidden');
      this.closeSidebar?.();
    }
  },

  /** Warm page scripts while user is still on login (faster after Sign In). */
  prefetchLoginScripts() {
    if (this._loginPrefetchStarted) return;
    this._loginPrefetchStarted = true;
    const mode = this.appMode();
    const pages = mode === 'pos'
      ? ['pos']
      : mode === 'admin'
        ? ['pos', 'dashboard']
        : [];
    const run = () => {
      pages.forEach((p, i) => setTimeout(() => this.ensurePageScripts(p).catch(() => {}), i * 80));
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 200);
  },

  async ensureSettingsLoaded() {
    if (this.settings && Number(this.settings.setup_complete) !== undefined) return this.settings;
    try {
      const res = await API.getSettingsParsed();
      if (res.success) {
        this.settings = res.data;
        this.applyTheme?.();
        this.updateBranding?.();
      }
    } catch (_) { /* ignore */ }
    return this.settings;
  },

  async init() {
    try {
      this.registerPages();
      this.bindEvents();
      API.onAppCloseBlocked?.(() => {
        this.handleHardwareBack();
      });

      const mode = this.appMode();

      // Dedicated apps: skip admin welcome/setup — go straight to that app's login
      if (mode === 'staff') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        await this.openStaffPortal();
        return;
      }
      if (mode === 'marketing') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        await this.openMarketingAgentLogin();
        return;
      }
      if (mode === 'recipe') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        await this.openRecipeProduction();
        return;
      }

      // POS-only installer: show login immediately (no setup / welcome delay)
      if (mode === 'pos') {
        this.applyPosKioskChrome();
        this.hideMobileLoading();
        this.showScreen('login');
        this.startLoginOperatingTimer?.();
        this.prefetchLoginScripts();
        this.ensureSettingsLoaded().then(() => {
          this.applyTheme?.();
          this.updateBranding?.();
        }).catch(() => {});
        return;
      }

      // Show Sign in ASAP — load settings in background (don't block login UI)
      this.hideMobileLoading();
      this.showWelcome({ shopReady: true, status: 'Loading shop…' });
      this.prefetchLoginScripts();

      // Prefer adopting existing business before deciding setup vs login
      try {
        if (typeof API.adoptExistingBusiness === 'function') {
          const adopted = await API.adoptExistingBusiness();
          if (adopted?.success && adopted.data?.adopted) {
            console.info('[App] Adopted existing business', adopted.data.business_id || adopted.data.shop_name);
          }
        }
      } catch (err) {
        console.warn('[App] adoptExistingBusiness', err?.message || err);
      }

      const res = await API.getSettingsParsed();
      if (!res.success) {
        let existing = null;
        try {
          const probe = await API.detectExistingBusiness?.();
          existing = probe?.data || null;
        } catch (_) { /* ignore */ }
        if (existing?.exists) {
          Utils.toast('Could not load settings, but your shop was found. Tap Retry or restart the app.', 'error');
          this.showMobileError(
            (res.error || 'Settings load failed') +
            ' — existing shop detected. Restart Shop POS (do not register a new shop).'
          );
          return;
        }
        this.showWelcome({
          status: res.error || 'Could not reach the shop database yet. You can still try Sign in or Set up.'
        });
        return;
      }
      this.settings = res.data;
      this.applyTheme();
      // Device sync can wait — don't block Sign in
      this.syncDeviceSettings().catch(() => {});

      if (!Number(this.settings?.setup_complete)) {
        let existing = null;
        try {
          const probe = await API.detectExistingBusiness?.();
          existing = probe?.data || null;
        } catch (_) { /* ignore */ }
        if (existing?.exists) {
          try { await API.adoptExistingBusiness?.(); } catch (_) { /* ignore */ }
          const again = await API.getSettingsParsed();
          if (again.success) this.settings = again.data;
          if (Number(this.settings?.setup_complete)) {
            this.updateBranding();
            this.showWelcome({ shopReady: true });
            return;
          }
        }
        this.showWelcome({ needsSetup: true });
        return;
      }
      this.updateBranding();
      this.showWelcome({ shopReady: true });
    } catch (err) {
      console.error('App init failed:', err);
      this.showMobileError(err.message || 'Could not start Shop POS');
    }
  },

  showWelcome(opts = {}) {
    const statusEl = document.getElementById('welcome-status');
    const titleEl = document.getElementById('welcome-title');
    const subEl = document.getElementById('welcome-sub');
    const shopName = this.settings?.shop_name || this.settings?.app_display_name || 'Shop POS';
    if (titleEl) titleEl.textContent = shopName;
    if (subEl) {
      subEl.textContent = opts.needsSetup
        ? 'No shop is set up yet. Create your shop, or sign in if you already have an account on this server.'
        : 'Sign in if you already have an account, or set up your shop to get started.';
    }
    if (statusEl) {
      if (opts.status) {
        statusEl.textContent = opts.status;
        statusEl.classList.remove('hidden');
      } else {
        statusEl.textContent = '';
        statusEl.classList.add('hidden');
      }
    }
    this.showScreen('welcome');
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
    document.getElementById('welcome-signin')?.addEventListener('click', () => {
      this.showScreen('login');
      this.startLoginOperatingTimer();
      this.prefetchLoginScripts();
    });
    document.getElementById('welcome-setup')?.addEventListener('click', () => {
      this.showScreen('setup');
    });
    document.getElementById('login-back-welcome')?.addEventListener('click', () => {
      this.stopLoginOperatingTimer();
      this.showWelcome({ shopReady: !!Number(this.settings?.setup_complete) });
    });
    document.getElementById('setup-back-welcome')?.addEventListener('click', () => {
      this.showWelcome({ needsSetup: !Number(this.settings?.setup_complete) });
    });
    document.getElementById('login-forgot')?.addEventListener('click', () => this.showRecoveryModal());
    document.getElementById('setup-form').addEventListener('submit', (e) => this.handleSetup(e));
    document.getElementById('setup-restore-db')?.addEventListener('click', async () => {
      if (!confirm('Restore a .db backup onto this empty device? You will then sign in with that shop’s owner account.')) return;
      const r = await API.backupRestoreSetup();
      if (r.cancelled) return;
      if (!r.success) return Utils.toast(r.error || 'Restore failed', 'error');
      Utils.toast('Shop data restored. Loading…', 'success');
      setTimeout(() => location.reload(), 900);
    });
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());
    document.getElementById('btn-sidebar-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSidebar();
    });
    document.getElementById('btn-nav-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleHardwareBack();
    });
    document.getElementById('sidebar-backdrop')?.addEventListener('click', () => this.closeSidebar());
    document.getElementById('global-search').addEventListener('input', (e) => this.handleSearchDebounced(e.target.value));
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
    ['welcome', 'login', 'setup', 'app', 'staff-portal', 'recipe-production', 'marketing-agent', 'display'].forEach(s =>
      document.getElementById(`screen-${s}`)?.classList.toggle('hidden', s !== name));
  },

  openInAppDisplay(kind) {
    const titleEl = document.getElementById('display-title');
    const frame = document.getElementById('display-frame');
    const closeBtn = document.getElementById('display-close');
    if (!frame) return false;
    const customer = kind === 'customer';
    if (titleEl) titleEl.textContent = customer ? 'Customer Board' : 'Kitchen Display';
    frame.src = customer ? 'customer-display.html' : 'kitchen-display.html';
    frame.onload = () => {
      try {
        const w = frame.contentWindow;
        if (!w) return;
        if (window.posAPI) w.posAPI = window.posAPI;
        w.__SHOP_POS_MOBILE__ = window.__SHOP_POS_MOBILE__;
        w.App = Object.assign(w.App || {}, { user: this.user, settings: this.settings });
      } catch (_) { /* cross-origin */ }
    };
    this.showScreen('display');
    if (closeBtn) {
      closeBtn.onclick = () => {
        try { frame.src = 'about:blank'; } catch (_) { /* ignore */ }
        this.showScreen(this.user ? 'app' : 'login');
      };
    }
    return true;
  },

  async openStaffPortal() {
    this.stopLoginOperatingTimer();
    document.body.classList.remove('sidebar-open');
    this.showScreen('staff-portal');
    const root = document.getElementById('staff-portal-root');
    const showLoadError = (msg) => {
      if (!root) return;
      root.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto;text-align:center">
        <p class="error-msg">${msg || 'Staff portal failed to load.'}</p>
        <button type="button" class="btn btn-primary" id="sp-open-retry">Retry</button>
        <button type="button" class="btn btn-ghost" id="sp-open-back" style="margin-top:8px">Back to POS Login</button>
      </div>`;
      document.getElementById('sp-open-retry')?.addEventListener('click', () => this.openStaffPortal());
      document.getElementById('sp-open-back')?.addEventListener('click', () => this.closeStaffPortal());
    };
    try {
      // Android lazy-loads page scripts — StaffPage must be available for the portal
      await this.ensurePageScripts('staff');
      await this.ensureFeatureScript('js/staff-selfie-ui.js');
      await this.ensureFeatureScript('js/staff-portal-standalone.js');
    } catch (err) {
      console.error('[StaffPortal] open load failed', err?.message || err);
      showLoadError('Staff portal modules failed to load. Retry.');
      return;
    }
    const portal = window.StaffPortalStandalone
      || (typeof StaffPortalStandalone !== 'undefined' ? StaffPortalStandalone : null);
    if (!portal?.render || !window.StaffPage?.renderWorkerPanel) {
      console.error('[StaffPortal] modules missing after load');
      showLoadError('Staff portal modules failed to load. Retry.');
      return;
    }
    window.StaffPortalStandalone = portal;
    portal.step = 'login';
    portal.employee = null;
    portal.employeePin = null;
    portal.render(root, this);
  },

  async closeStaffPortal() {
    try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
    StaffSelfieCapture?.stopCamera?.();
    if (window.StaffPortalStandalone) {
      StaffPortalStandalone.employee = null;
      StaffPortalStandalone.employeePin = null;
      StaffPortalStandalone.step = 'login';
    }
    if (window.StaffPage) {
      StaffPage.employee = null;
      StaffPage.employeePin = null;
      StaffPage._standalone = false;
    }
    this.showScreen('login');
    this.startLoginOperatingTimer();
  },

  /** Open standalone Marketing Agent System (own login, like Recipe & Staff Portal) */
  async openMarketingAgentLogin() {
    await this.openMarketingAgent({ fromLogin: true });
  },

  async openMarketingAgent(opts = {}) {
    this.stopLoginOperatingTimer();
    await this.ensureFeatureCss('css/marketing-agent.css');
    await this.ensureFeatureCss('css/flyer-studio.css');
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
    await this.ensureFeatureCss('css/recipe-production.css');
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
    let loginMsg = document.getElementById('login-welcome-msg');
    const msgText = (this.settings?.customization?.login_message || '').trim();
    if (loginNameEl && msgText) {
      if (!loginMsg) {
        loginMsg = document.createElement('p');
        loginMsg.id = 'login-welcome-msg';
        loginMsg.className = 'muted';
        loginMsg.style.cssText = 'margin:4px 0 12px;text-align:center';
        loginNameEl.after(loginMsg);
      }
      loginMsg.textContent = msgText;
      loginMsg.classList.remove('hidden');
    } else if (loginMsg) {
      loginMsg.classList.add('hidden');
    }
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
    const cu = this.settings?.customization || {};
    const color = cu.button_color || this.settings?.button_color;
    if (color) document.documentElement.style.setProperty('--primary', color);
    else document.documentElement.style.removeProperty('--primary');
    const accent = cu.accent_color;
    if (accent) document.documentElement.style.setProperty('--accent', accent);
    else document.documentElement.style.removeProperty('--accent');
    const scale = Number(cu.ui_scale) || 1;
    document.documentElement.style.setProperty('--ui-scale', String(Math.min(1.25, Math.max(0.85, scale))));
    document.documentElement.style.fontSize = `${Math.round(16 * Math.min(1.25, Math.max(0.85, scale)))}px`;
    document.body?.classList.toggle('cu-compact-nav', !!cu.compact_nav);
    document.body?.classList.toggle('cu-hide-emojis', !!cu.hide_nav_emojis);
  },

  /** In-app back: stay inside Shop POS. Never exit without Logout. */
  handleHardwareBack() {
    if (!this.user) {
      Utils.toast('Sign in to continue, or close the app from Android Recents', 'info');
      return;
    }
    const modal = document.getElementById('modal-overlay');
    if (modal && !modal.classList.contains('hidden')) {
      Utils.hideModal?.();
      return;
    }
    if (document.getElementById('notif-panel') && !document.getElementById('notif-panel')?.classList.contains('hidden')) {
      document.getElementById('notif-panel')?.classList.add('hidden');
      return;
    }
    const side = document.getElementById('sidebar');
    if (side?.classList.contains('open') || document.body.classList.contains('sidebar-open')) {
      this.closeSidebar();
      return;
    }
    // Recipe & Production overlay
    if (typeof RecipeProductionApp !== 'undefined' && RecipeProductionApp?.isOpen?.()) {
      if (typeof RecipeProductionApp.goBackInApp === 'function' && RecipeProductionApp.goBackInApp()) return;
      this.closeRecipeProduction();
      return;
    }
    // Admin nested sections
    if (this.currentPage === 'admin' && typeof AdminPage !== 'undefined' && AdminPage.section && AdminPage.section !== 'overview') {
      const prev = AdminPage._sectionHistory?.pop();
      if (prev) {
        AdminPage.section = prev;
        AdminPage.renderSection?.(document.getElementById('admin-content') || document.getElementById('page-content'));
        return;
      }
      AdminPage.section = 'overview';
      AdminPage.renderSection?.(document.getElementById('admin-content') || document.getElementById('page-content'));
      return;
    }
    if (this.navHistory.length) {
      const prev = this.navHistory.pop();
      if (prev && prev !== this.currentPage) {
        this._suppressHistory = true;
        this.navigate(prev).finally(() => { this._suppressHistory = false; });
        return;
      }
    }
    const home = this.settings?.customization?.default_home_page
      || (Utils.canAccess(this.user, 'pos') ? 'pos' : 'dashboard');
    if (this.currentPage !== home && Utils.canAccess(this.user, home)) {
      this._suppressHistory = true;
      this.navigate(home).finally(() => { this._suppressHistory = false; });
      return;
    }
    Utils.toast('Use Logout to exit Shop POS', 'info');
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
      const user = result?.user || result?.data?.user;
      if (!result.success || !user) {
        errEl.textContent = result.error || 'Invalid username or password';
        errEl.classList.remove('hidden');
        return;
      }
      errEl.classList.add('hidden');
      this.user = user;
      this.user.is_active = 1;
      // Keep existing settings — do NOT clear (was forcing a slow reload after every login)
      try { window.DataCache?.invalidate?.(); } catch (_) { /* ignore */ }
      this.applyPosKioskChrome();
      this.showScreen('app');
      if (!this.isPosKiosk()) {
        document.getElementById('sidebar-user-role').textContent =
          (this.user.full_name || '') + ' · ' + (this.user.role || '');
        this.renderNav();
      }
      // Enter without blocking the Sign In button on non-critical work
      await this.enterApp();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.prev || 'Sign In'; }
    }
  },

  async showRecoveryModal() {
    const hasRes = await API.hasRecoverySecret();
    const hasLocalOrCloud = !!(hasRes && hasRes.success !== false && (hasRes.data === true || hasRes.data?.data === true || hasRes.fromCloud));
    if (!hasLocalOrCloud) {
      Utils.showModal('Account Recovery', `
        <p>Private recovery has not been set up on this shop yet.</p>
        <p class="muted">Sign in on the online shop (or after first successful login here), then go to <strong>Admin → Security → Account Recovery</strong> and create a Private Recovery Phrase. That phrase is stored in your Supabase shop database and works on the browser URL and on installers when you are online.</p>`,
        '<button class="btn btn-primary" id="recovery-close">OK</button>');
      document.getElementById('recovery-close')?.addEventListener('click', Utils.hideModal);
      return;
    }

    let verifiedSecret = '';
    let ownerAccount = null;

    const showStep1 = () => {
      Utils.showModal('Account Recovery', `
        <p class="muted">Enter your <strong>Private Recovery Phrase</strong> (saved in your Supabase shop database) to reset the owner password. This does not delete shop data.</p>
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
          errEl.textContent = res.error || 'Recovery verification failed. Please try again.';
          errEl.classList.remove('hidden');
          return;
        }
        verifiedSecret = secret;
        ownerAccount = Array.isArray(res.data) ? res.data[0] : res.data;
        showStep2();
      });
    };

    const showStep2 = () => {
      const uname = ownerAccount?.username || '';
      Utils.showModal('Reset Owner Password', `
        <p class="muted">Identity verified. Set a new password for the owner account <strong>${Utils.escHtml(uname)}</strong>. Shop data is not changed.</p>
        <div class="field"><label>Owner Username</label>
          <input id="recovery-username" value="${Utils.escHtml(uname)}" readonly></div>
        <div class="field"><label>New Password</label>
          <input type="password" id="recovery-new-pass" minlength="6" autocomplete="new-password"></div>
        <div class="field"><label>Confirm New Password</label>
          <input type="password" id="recovery-new-pass2" minlength="6" autocomplete="new-password"></div>
        <p id="recovery-error2" class="error-msg hidden"></p>`,
        '<button class="btn btn-success" id="recovery-reset">Save New Password</button><button class="btn btn-ghost" id="recovery-back">Back</button>');

      document.getElementById('recovery-back')?.addEventListener('click', showStep1);
      document.getElementById('recovery-reset')?.addEventListener('click', async () => {
        const username = document.getElementById('recovery-username').value;
        const pass = document.getElementById('recovery-new-pass').value;
        const pass2 = document.getElementById('recovery-new-pass2').value;
        const errEl = document.getElementById('recovery-error2');
        errEl.classList.add('hidden');
        if (pass.length < 6) {
          errEl.textContent = 'Password must be at least 6 characters';
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
          errEl.textContent = res.error || 'Recovery verification failed. Please try again.';
          errEl.classList.remove('hidden');
          return;
        }
        Utils.hideModal();
        document.getElementById('login-username').value = res.data?.username || username;
        document.getElementById('login-password').value = '';
        Utils.toast(`Owner password reset for "${res.data?.username || username}". Sign in with the new password.`, 'success');
      });
    };

    showStep1();
  },

  async showFactoryResetModal(fromAdmin = false) {
    // Never expose factory reset from the public login screen.
    if (!fromAdmin || !this.user || this.user.role !== 'owner') {
      Utils.toast('Only the signed-in owner can delete the business (Admin).', 'error');
      return;
    }
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
      const r = await API.factoryResetBusiness(secret, confirmText, this.user);
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
    const failures = [];
    // Load in order — Admin extenders (admin-audit, admin-pro, …) must run AFTER admin.js
    for (const src of scripts) {
      try {
        await Utils.loadScript(src);
      } catch (err) {
        failures.push(src);
        console.warn('Lazy script load failed:', src, err?.message || err);
      }
    }

    // If Admin extenders ran too early on a previous visit, force-reload them once
    if (page === 'admin' && window.AdminPage && !AdminPage.sections?.some((s) => s.id === 'salesmgmt')) {
      const extenders = scripts.filter((s) => /\/admin-(pro|audit|staff|hr|operations|combos|quotes|payroll|employee-month|recruitment|marketing)\.js$/i.test(s));
      for (const src of extenders) {
        try {
          Utils._loadedScripts?.delete?.(src);
          document.querySelector(`script[src="${src}"]`)?.remove();
          document.querySelector(`script[src$="/${src}"]`)?.remove();
          await Utils.loadScript(src);
        } catch (err) {
          failures.push(src);
          console.warn('Admin extender reload failed:', src, err?.message || err);
        }
      }
    }

    this.bindPageModule(page);
    if (page === 'staff' && failures.length && !window.StaffPage?.renderWorkerPanel) {
      throw new Error('Staff portal modules failed to load');
    }
    if (isMobile && failures.length) {
      console.warn('[ensurePageScripts]', page, 'failed:', failures.join(', '));
    }
  },

  async ensureFeatureScript(src) {
    try { await Utils.loadScript(src); } catch (err) {
      console.warn('Feature script load failed:', src, err);
    }
  },

  async ensureFeatureCss(href) {
    try {
      if (typeof Utils.loadStylesheet === 'function') await Utils.loadStylesheet(href);
      else if (!document.querySelector(`link[href="${href}"]`)) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        document.head.appendChild(l);
      }
    } catch (err) {
      console.warn('Feature CSS load failed:', href, err);
    }
  },

  async enterApp() {
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    this.stopLoginOperatingTimer();
    this.applyPosKioskChrome();

    // Settings: don't block POS/admin entry if we already have them
    if (!this.settings) {
      const settingsP = this.ensureSettingsLoaded();
      // Cap wait so a slow RPC never freezes the till
      await Promise.race([
        settingsP,
        new Promise((r) => setTimeout(r, this.isPosKiosk() ? 400 : 900))
      ]);
    } else {
      this.ensureSettingsLoaded().catch(() => {});
    }
    this.updateBranding();
    this.applyTheme();

    // Marketing agents work in the standalone Marketing Agent System
    if (this.user?.role === 'marketing_agent') {
      await this.openMarketingAgent({ fromLogin: true });
      return;
    }

    this.showScreen('app');
    if (!this.isPosKiosk()) {
      this.renderNav();
      document.getElementById('sidebar-user-role').textContent =
        (this.user?.full_name || '') + ' · ' + (this.user?.role || '');
    }

    const preferredCustom = this.settings?.customization?.default_home_page;
    const preferred = this.isPosKiosk()
      ? 'pos'
      : (preferredCustom
        || (['cashier', 'supervisor', 'assistant_manager'].includes(this.user.role) ? 'pos' : 'dashboard'));
    const startPage = Utils.canAccess(this.user, preferred)
      ? preferred
      : (this.navItems.map(n => n.id).find(id => Utils.canAccess(this.user, id)) || 'pos');

    // Navigate ASAP — do not wait for timers / sync / notifications
    await this.navigate(startPage);

    // Background startup (never block UI) — lighter on POS kiosk
    const bg = async () => {
      if (!this.isPosKiosk()) {
        try {
          const br = await API.getActiveBranch();
          if (br.success && br.data) {
            this.activeBranch = br.data;
            document.getElementById('sidebar-user-role').textContent =
              this.user.full_name + ' · ' + this.user.role + ' · ' + this.activeBranch.name;
          }
        } catch { /* ignore */ }
      }
      try { await API.logOperatingEvent('open', this.user); } catch { /* ignore */ }
      if (!this.isPosKiosk()) {
        try { await API.ensureDemoNotificationSound(); } catch { /* ignore */ }
        this.startOperatingTimer();
        this.startNotificationSoundMonitor();
        this.startNotificationRefresh();
        this.startScheduledDocMonitor();
        this.loadNotifications();
        this.runDeferredStartup();
      }
      this.startAutoLogoutTimer();
      this.startSyncMonitor();
      this.startSessionMonitor();
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
        this._notifCache = null;
        await this.pollNotifications(true);
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
    const setBtn = document.querySelector('.sidebar-footer [data-page="settings"]');
    if (setBtn) setBtn.classList.toggle('hidden', !Utils.canAccess(this.user, 'settings'));
  },

  async navigate(page) {
    const navT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // Immediate UI feedback — never block navigation on session/network
    this.closeSidebar();
    if (!this.user) return;
    if (!Utils.canAccess(this.user, page)) return;
    if (!this._suppressHistory && this.currentPage && this.currentPage !== page) {
      this.navHistory.push(this.currentPage);
      if (this.navHistory.length > 40) this.navHistory.shift();
    }
    this.currentPage = page;
    const navGen = (this._navGen = (this._navGen || 0) + 1);
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
    content.dataset.page = page;

    // Keep page hosts in memory — show previous DOM instantly on revisit
    let hosts = content.querySelector(':scope > .page-hosts');
    if (!hosts) {
      content.innerHTML = '';
      hosts = document.createElement('div');
      hosts.className = 'page-hosts';
      content.appendChild(hosts);
    }
    hosts.querySelectorAll(':scope > .page-host').forEach((h) => {
      h.hidden = true;
      h.classList.remove('page-host-active');
    });

    let host = hosts.querySelector(`:scope > .page-host[data-page="${page}"]`);
    const reused = !!(host && host.childNodes.length);
    if (!host) {
      host = document.createElement('div');
      host.className = 'page-host';
      host.dataset.page = page;
      hosts.appendChild(host);
    }
    host.hidden = false;
    host.classList.add('page-host-active');

    // Session check always in background — never await on click
    this.ensureSessionActive().then((ok) => {
      if (ok) this._lastSessionOkAt = Date.now();
    }).catch(() => {});

    if (navGen !== this._navGen) return;

    const markVisible = (fromCache) => {
      const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - navT0;
      this._navPerf = this._navPerf || {};
      this._navPerf[page] = { ms: Math.round(ms), fromCache: !!fromCache, at: new Date().toISOString() };
      content.dataset.loading = '0';
      content.dataset.navMs = String(Math.round(ms));
    };

    // Revisit: paint immediately, refresh in background
    if (reused) {
      markVisible(true);
      this.schedulePrefetch(page);
      (async () => {
        try {
          await this.ensurePageScripts(page);
          if (navGen !== this._navGen || this.currentPage !== page) return;
          const pageModule = this.bindPageModule(page) || this.pages[page];
          if (!pageModule?.render) return;
          if (typeof pageModule.activate === 'function') {
            await pageModule.activate(host, this);
          } else {
            await pageModule.render(host, this);
          }
          window.DataCache?.clearStaleBanner?.(host);
        } catch (err) {
          window.DataCache?.showStaleBanner?.(host, err?.message || 'Unable to refresh. Showing last updated data.');
        }
      })();
      return;
    }

    // First visit: skeleton shell immediately, then load (POS paints its own shell — skip skeleton)
    if (page !== 'pos') host.innerHTML = Utils.pageSkeleton();
    markVisible(false);
    content.dataset.loading = '1';

    try {
      await this.ensurePageScripts(page);
      if (navGen !== this._navGen) return;
      const pageModule = this.bindPageModule(page) || this.pages[page];
      if (!pageModule?.render) {
        host.innerHTML = '<p class="error-msg">This page failed to load. Restart Shop POS.</p>';
        content.dataset.loading = '0';
        return;
      }
      if (page === 'admin' && typeof AdminPage !== 'undefined' && typeof AdminPage.refreshAdminNav === 'function') {
        AdminPage.refreshAdminNav();
      }
      await pageModule.render(host, this);
      if (page === 'admin' && typeof AdminPage !== 'undefined' && typeof AdminPage.refreshAdminNav === 'function') {
        AdminPage.refreshAdminNav(host);
      }
    } catch (err) {
      if (navGen !== this._navGen) return;
      host.innerHTML = `<p class="error-msg">${Utils.escHtml(err?.message || 'Page failed to load')}</p>`;
    }
    if (navGen !== this._navGen) return;
    content.dataset.loading = '0';
    this.schedulePrefetch(page);
  },

  /** Warm likely next-page reads without flooding the network. */
  schedulePrefetch(page) {
    clearTimeout(this._prefetchTimer);
    this._prefetchTimer = setTimeout(() => {
      if (!window.API || !this.user) return;
      const from = Utils.monthStart?.() || new Date().toISOString().slice(0, 10);
      const to = Utils.today?.() || new Date().toISOString().slice(0, 10);
      const tasks = [];
      if (page === 'dashboard' || page === 'pos') {
        tasks.push(() => API.getCategories({ for_pos: true }));
        tasks.push(() => API.getProducts({ for_pos: true }));
      }
      if (page === 'dashboard') {
        tasks.push(() => API.getSalesReport(from, to));
        this.ensurePageScripts('pos').catch(() => {});
        this.ensurePageScripts('products').catch(() => {});
      }
      if (page === 'products') {
        tasks.push(() => API.getCategories({}));
        tasks.push(() => API.getSuppliers());
      }
      if (page === 'pos') {
        tasks.push(() => API.getProducts({ for_pos: true }));
        this.ensurePageScripts('products').catch(() => {});
      }
      if (page === 'stock') {
        tasks.push(() => API.getStockReport());
      }
      // Run at most 3 prefetches, staggered
      tasks.slice(0, 3).forEach((fn, i) => {
        setTimeout(() => {
          try { fn()?.catch?.(() => {}); } catch { /* ignore */ }
        }, i * 120);
      });
    }, 350);
  },

  clearPageHosts() {
    const content = document.getElementById('page-content');
    if (content) content.innerHTML = '';
    try { window.DataCache?.invalidate?.(); } catch { /* ignore */ }
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
    this.clearPageHosts();
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

  _portalFeatureEnabled(feature) {
    const ps = this.settings?.staff_portal_settings || {};
    if (feature === 'routines') return ps.show_routines !== false;
    if (feature === 'morning_routines') return ps.show_routines !== false && ps.show_morning_routines !== false;
    if (feature === 'closing_routines') return ps.show_routines !== false && ps.show_closing_routines !== false;
    if (feature === 'shifts') return ps.show_shifts !== false;
    return true;
  },

  async checkNotificationSounds(fromCache) {
    if (!this.user || !['owner', 'manager'].includes(this.user.role)) {
      SoundService?.stopAlert();
      return;
    }
    let shouldAlert = false;
    try {
      if (fromCache && this._notifCache?.data) {
        shouldAlert = (this._notifCache.data.alerts || []).length > 0;
      } else {
        const res = await API.getNotifications(this.user);
        const alerts = (res.data || []).filter(n => this.notificationConcernsUser(n));
        if (alerts.length) shouldAlert = true;
      }
    } catch { /* offline */ }
    if (shouldAlert && this.settings?.notification_settings?.loop_until_read !== false) {
      await SoundService.startAlert(this.settings);
    } else {
      SoundService.stopAlert();
    }
  },

  async pollNotifications(force = false) {
    if (!this.user) return;
    try {
      const buckets = await this.fetchNotificationBuckets(force);
      const count = (buckets.alerts?.length || 0) + (buckets.pending?.length || 0);
      const badge = document.getElementById('notif-badge');
      if (badge) {
        if (count) {
          badge.textContent = count > 99 ? '99+' : count;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
      if (this.user?.role === 'owner' || this.user?.role === 'manager') {
        await this.checkNotificationSounds(true);
      }
    } catch { /* offline */ }
  },

  startNotificationSoundMonitor() {
    this.stopNotificationSoundMonitor();
    if (!this.user || !['owner', 'manager'].includes(this.user.role)) return;
    // Sound is driven by pollNotifications — no separate interval
  },

  stopNotificationSoundMonitor() {
    if (this._notifSoundInterval) clearInterval(this._notifSoundInterval);
    this._notifSoundInterval = null;
  },

  async runBackgroundSync() {
    // Hub sync / online ordering removed. Local tills stay local; cloud only when RPC_URL is set.
  },

  startNotificationRefresh() {
    this.stopNotificationRefresh();
    if (!this.user) return;
    this.pollNotifications(true);
    this._notifRefreshInterval = setInterval(() => this.pollNotifications(false), 30000);
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
      // Only freeze when the server explicitly says this account is deactivated.
      // Missing/expired session tokens, Railway restarts, and network errors must never log the admin out.
      if (v.success && v.data?.frozen === true && v.data?.active === false) {
        Utils.toast(v.data?.error || 'Account deactivated — system access is frozen.', 'error');
        document.body.classList.add('system-frozen');
        await this.doLogout();
        return false;
      }
      if (v.success !== false) {
        this.user.is_active = 1;
        document.body.classList.remove('system-frozen');
        return true;
      }
    } catch {
      document.body.classList.remove('system-frozen');
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
    if (role === 'owner') return true;
    if (n.audience_roles) {
      const roles = String(n.audience_roles).split(',').map(s => s.trim()).filter(Boolean);
      if (roles.length && !roles.includes(role)) return false;
    }
    const page = String(n.action_page || '').toLowerCase();
    const t = String(n.type || '').toLowerCase();
    // Cashier: POS + staff-portal checklist only — never admin/ops/bookkeeping panels
    if (role === 'cashier') {
      if (page.startsWith('admin:') || page.startsWith('operations:') || page.startsWith('bookkeeping')
        || page.startsWith('stock:') || page.includes('inventory')) return false;
      if (['low_stock', 'out_of_stock', 'reorder', 'payroll_due', 'uif', 'paye', 'sdl', 'coida',
        'cashout', 'cashup', 'target_met', 'target_missed', 'cashout_penalty', 'stock_count',
        'salary_claim', 'recruitment', 'document_share'].some(x => t === x || t.startsWith(x))) return false;
      if (t.startsWith('recruitment') || t.startsWith('owner_salary') || t.startsWith('probation_')) return false;
      return page === 'pos' || page === 'staff' || page === ''
        || ['checklist_reminder', 'checklist_overdue', 'compliance', 'pos_alert', 'held_order', 'kitchen', 'order_ready', 'test'].includes(t);
    }
    if (page.startsWith('operations:') && !Utils.canAccess(this.user, 'operations')) {
      return false;
    }
    if (page.startsWith('admin:') && !Utils.canAccessAdmin(this.user)) return false;
    if (page === 'staff' && !Utils.canAccess(this.user, 'staff') && role !== 'cashier') return false;
    if ((page.startsWith('bookkeeping') || ['low_cash', 'ar', 'ap', 'budget'].includes(t))
      && !Utils.canAccess(this.user, 'bookkeeping')) return false;
    if (['low_stock', 'out_of_stock', 'reorder'].includes(t) && !['owner', 'manager', 'assistant_manager', 'supervisor'].includes(role)) return false;
    if (['checklist_reminder', 'checklist_overdue', 'compliance'].includes(t)) {
      if (!this._portalFeatureEnabled('routines')) return false;
      if (/morning|opening/i.test(String(n.title || '') + String(n.message || '')) && !this._portalFeatureEnabled('morning_routines')) return false;
      if (/closing|close/i.test(String(n.title || '') + String(n.message || '')) && !this._portalFeatureEnabled('closing_routines')) return false;
    }
    if (t.startsWith('recruitment') && !['owner', 'manager', 'supervisor', 'assistant_manager'].includes(role)) return false;
    return true;
  },

  navigateToNotificationTarget(type, kind, actionPage) {
    const role = this.user?.role;
    const page = String(actionPage || '').toLowerCase();
    const t = String(type || '').toLowerCase();

    // Cashier stays inside POS only
    if (role === 'cashier') {
      if (['checklist_reminder', 'checklist_overdue', 'compliance'].includes(t) || page === 'staff') {
        Utils.toast('Open Staff Portal from the login screen for clock & routines.', 'info');
      }
      this.navigate('pos');
      return;
    }

    const canPage = (p) => Utils.canAccess(this.user, p);
    const canAdmin = () => Utils.canAccessAdmin(this.user);
    const refuse = (msg) => {
      Utils.toast(msg || 'You do not have access to that screen.', 'error');
      if (canPage('pos')) this.navigate('pos');
      else if (canPage('dashboard')) this.navigate('dashboard');
    };

    if (page.startsWith('document-hub:share:')) {
      if (!canPage('document-hub')) return refuse();
      const docId = parseInt(page.split(':')[2], 10);
      if (window.DocumentHubPage) DocumentHubPage.pendingShareId = docId;
      this.navigate('document-hub');
      return;
    }
    if (page === 'operations:cashup' || page.startsWith('operations:cashup')) {
      if (!canPage('operations')) return refuse();
      this.navigateToOperationsTab('cashup');
      return;
    }
    if (page === 'operations:stockcount' || page.startsWith('operations:stockcount')) {
      if (!canPage('operations')) return refuse();
      const parts = page.split(':');
      const countId = parts[2] ? parseInt(parts[2], 10) : null;
      this.navigateToOperationsTab('stockcount', Number.isFinite(countId) ? countId : null);
      return;
    }
    if (page === 'admin:recruitment' || page.startsWith('admin:recruitment') || page === 'staffhr:recruitment') {
      if (!canAdmin()) return refuse();
      if (Utils.canAccessAdminSection?.(this.user, 'staffhr') || Utils.canAccessAdmin(this.user)) {
        if (window.AdminPage) AdminPage.staffTab = 'recruitment';
        this.navigateToAdminSection('staffhr');
      } else {
        this.navigateToAdminSection('recruitment');
      }
      return;
    }
    if (page === 'staffhr:attendance' || page.startsWith('staffhr:attendance')) {
      if (!canAdmin()) return refuse();
      if (window.AdminPage) AdminPage.staffTab = 'attendance';
      this.navigateToAdminSection('staffhr');
      return;
    }
    if (page === 'admin:payroll' || page.startsWith('admin:payroll') || t === 'salary_claim') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('payroll');
      return;
    }
    if (page === 'admin:combos' || page.startsWith('admin:combos:')) {
      if (!canAdmin()) return refuse();
      const tab = page.split(':')[2] || 'list';
      this.navigateToAdminSection('combos', tab);
      return;
    }
    if (page === 'admin:approvals') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('approvals');
      return;
    }
    if (page === 'admin:security') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('security');
      return;
    }
    if (page === 'admin:onaccount') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('onaccount');
      return;
    }
    if (page === 'admin:opscompliance') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('opscompliance');
      return;
    }
    if (page === 'operations:non-selling' || page === 'stock:nonselling') {
      if (!canPage('stock')) return refuse();
      this.navigateToStockTab('nonselling');
      return;
    }
    if (page === 'pos') {
      this.navigate('pos');
      return;
    }
    if (kind === 'pending') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('approvals');
      return;
    }
    const inventory = ['low_stock', 'out_of_stock', 'reorder'];
    const payroll = ['payroll_due', 'uif', 'paye', 'sdl', 'coida', 'cert', 'salary', 'salary_claim'];
    const ownerSalary = ['owner_salary_due', 'owner_salary_overdue', 'owner_salary'];
    const bookkeeping = ['low_cash', 'ar', 'ap', 'budget'];
    if (inventory.includes(t)) {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('inventory');
    } else if (payroll.includes(t)) {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('payroll');
    } else if (ownerSalary.includes(t)) {
      if (role === 'owner' || role === 'manager') this.navigateToStaffTab('owner-salary');
      else if (canAdmin()) this.navigateToAdminSection('payroll');
      else refuse();
    } else if (t === 'donation') {
      if (!canPage('bookkeeping')) return refuse();
      this.navigateToBookkeepingTab('donations');
    } else if (t.startsWith('probation_')) {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('hrcontracts');
    } else if (t === 'compliance' || t === 'checklist_reminder' || t === 'checklist_overdue') {
      if (canPage('staff')) this.navigate('staff');
      else if (canAdmin()) this.navigateToAdminSection('opscompliance');
      else refuse();
    } else if (t === 'promo_approval_pending' || t === 'combo_approval_pending') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('combos', t === 'promo_approval_pending' ? 'promos' : 'approvals');
    } else if (t === 'customer_overdue') {
      if (!canPage('customers')) return refuse();
      this.navigate('customers');
    } else if (['cashout', 'cashup', 'target_met', 'target_missed', 'cash_drop', 'cashout_penalty'].includes(t)) {
      if (!canPage('operations')) return refuse();
      this.navigateToOperationsTab('cashup');
    } else if (t === 'stock_count') {
      if (!canPage('operations')) return refuse();
      this.navigateToOperationsTab('stockcount');
    } else if (t.startsWith('recruitment')) {
      if (!canAdmin()) return refuse();
      if (Utils.canAccessAdminSection?.(this.user, 'staffhr')) this.navigateToAdminSection('staffhr', 'recruitment');
      else this.navigateToAdminSection('recruitment');
    } else if (t === 'document_share') {
      if (!canPage('document-hub')) return refuse();
      if (actionPage?.startsWith('document-hub:share:')) {
        const docId = parseInt(String(actionPage).split(':')[2], 10);
        if (window.DocumentHubPage) DocumentHubPage.pendingShareId = docId;
      }
      this.navigate('document-hub');
    } else if (bookkeeping.includes(t)) {
      if (!canPage('bookkeeping')) return refuse();
      const tab = { low_cash: 'dashboard', ar: 'dashboard', ap: 'dashboard', budget: 'budgets' }[t] || 'dashboard';
      this.navigateToBookkeepingTab(tab);
    } else if (t === 'test') { /* no navigation */ }
    else if (canPage('dashboard')) this.navigate('dashboard');
    else if (canPage('pos')) this.navigate('pos');
    else if (canPage('staff')) this.navigate('staff');
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

  handleSearchDebounced(query) {
    clearTimeout(this._searchDebounce);
    this._searchDebounce = setTimeout(() => this.handleSearch(query), 280);
    if (query && query.length >= 2) this.handleSearchLocal(query);
    else document.getElementById('search-results')?.classList.add('hidden');
  },

  handleSearchLocal(query) {
    const dropdown = document.getElementById('search-results');
    if (!dropdown || !query || query.length < 2) return;
    const q = query.toLowerCase();
    const user = this.user;
    const canAdmin = Utils.canAccessAdmin(user);
    const featureHits = this.navItems.filter(item => {
      const label = item.label.replace(/^[^\w]+/, '').toLowerCase();
      const id = item.id.toLowerCase();
      if (!(label.includes(q) || id.includes(q))) return false;
      return item.id === 'admin' ? canAdmin : Utils.canAccess(user, item.id);
    });
    if (!featureHits.length) return;
    dropdown.innerHTML = '<div class="search-group"><h4>Features</h4>' +
      featureHits.map(f => `<div class="search-item" data-action="page" data-page="${f.id}">${f.label}</div>`).join('') +
      '<p class="muted" style="padding:8px;font-size:12px">Searching…</p></div>';
    dropdown.classList.remove('hidden');
    dropdown.querySelectorAll('[data-action="page"]').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        if (el.dataset.page === 'recipe') return this.openRecipeProduction({ fromApp: true });
        this.navigate(el.dataset.page);
      });
    });
  },

  async handleSearch(query) {
    const seq = ++this._searchSeq;
    const dropdown = document.getElementById('search-results');
    if (!query || query.length < 2) { dropdown.classList.add('hidden'); return; }
    const q = query.toLowerCase();
    const res = await API.globalSearch(query);
    if (seq !== this._searchSeq) return;
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
      el.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        if (el.dataset.page === 'recipe') return this.openRecipeProduction({ fromApp: true });
        this.navigate(el.dataset.page);
      });
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

  async fetchNotificationBuckets(force = false) {
    const now = Date.now();
    if (!force && this._notifCache && now - this._notifCache.at < 8000) {
      return this._notifCache.data;
    }
    const res = await API.getNotifications(this.user);
    const alerts = (res.data || [])
      .map(n => ({ ...n, kind: 'alert' }))
      .filter(n => this.notificationConcernsUser(n));
    let pending = [];
    let reminders = [];
    if (['owner', 'manager'].includes(this.user?.role)) {
      try {
        const dismissedPending = this._getDismissedPending();
        const dismissedRem = this._getDismissedReminders();
        const [pr, comp, fin] = await Promise.all([
          API.getPendingSettingsRequests().catch(() => ({ data: [] })),
          API.getComplianceReminders().catch(() => ({ data: [] })),
          API.getFinancialNotifications().catch(() => ({ data: [] }))
        ]);
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
        })).filter(p => !dismissedPending.includes(String(p.pendingId)));
        (comp.data || []).forEach((n, i) => {
          const id = `comp-${n.type || i}`;
          if (dismissedRem.includes(id)) return;
          reminders.push({ id, type: n.type || 'compliance', title: n.title, message: n.message, created_at: new Date().toISOString(), kind: 'reminder' });
        });
        (fin.data || []).forEach((n, i) => {
          const id = `fin-${n.type || i}`;
          if (dismissedRem.includes(id)) return;
          reminders.push({ id, type: n.type || 'compliance', title: n.title, message: n.message, created_at: new Date().toISOString(), kind: 'reminder' });
        });
      } catch { /* offline */ }
    }

    // Online ordering removed — do not surface hub online-order alerts.

    const data = { alerts, pending, reminders };
    this._notifCache = { at: now, data };
    return data;
  },

  async loadNotifications() {
    await this.pollNotifications(false);
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
    Utils.showModal('Notifications', '<p class="muted">Loading…</p>', '<button class="btn btn-ghost" id="notif-close">Close</button>');
    document.getElementById('notif-close')?.addEventListener('click', () => Utils.hideModal());
    const { alerts, pending, reminders } = await this.fetchNotificationBuckets(true);
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
      const btn = document.getElementById('mark-all-read');
      if (btn) btn.disabled = true;
      try {
        const r = await API.markAllNotificationsRead(this.user);
        if (r && r.success === false) throw new Error(r.error || 'Could not mark all read');
        this._notifCache = null;
        Utils.hideModal();
        SoundService?.stopAlert();
        await this.loadNotifications();
        this.checkNotificationSounds();
        Utils.toast('Your alerts marked as read', 'success');
      } catch (err) {
        if (btn) btn.disabled = false;
        Utils.toast(err.message || 'Could not mark alerts as read', 'error');
      }
    });

    document.querySelectorAll('.notif-row--clickable').forEach(row => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return;
        const kind = row.dataset.kind;
        const type = row.dataset.type;
        const actionPage = row.dataset.actionPage;
        Utils.hideModal();
        this.navigateToNotificationTarget(type, kind, actionPage);
        if (kind === 'alert') {
          const id = parseInt(row.dataset.id, 10);
          this._notifCache = null;
          API.markNotificationRead(id).then(() => this.loadNotifications()).catch(() => {});
          this.checkNotificationSounds();
        }
      });
    });

    document.querySelectorAll('.notif-mark-read').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        const id = parseInt(btn.dataset.id, 10);
        const r = await API.markNotificationRead(id);
        if (r && r.success === false) {
          btn.disabled = false;
          return Utils.toast(r.error || 'Could not mark read', 'error');
        }
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

window.App = App;

function bootApp() {
  const start = () => {
    if (window.__SHOP_POS_BOOTED__) return;
    window.__SHOP_POS_BOOTED__ = true;
    App.init().catch(err => App.showMobileError?.(err.message) || console.error(err));
  };
  // Android: wait for local DB / posAPI before first screen
  const native = !!(window.__SHOP_POS_MOBILE__ || window.__SHOP_POS_LOCAL_INSTALLER__ || window.Capacitor?.isNativePlatform?.());
  if (native && !window.posAPI) {
    window.addEventListener('posAPIReady', start, { once: true });
    setTimeout(start, 8000);
    return;
  }
  start();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
