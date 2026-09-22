const App = {
  user: null,
  settings: null,
  entitlements: null,
  entitlementsLoaded: false,
  currentPage: 'dashboard',
  navHistory: [],
  _suppressHistory: false,

  navItems: [
    { id: 'dashboard', label: '📊 Dashboard', roles: ['owner', 'manager'] },
    { id: 'admin', label: '⚙️ Admin Panel', roles: ['owner', 'manager', 'supervisor', 'delivery_manager'] },
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
    { id: 'document-hub', label: '📁 Document Hub', roles: ['owner', 'manager', 'assistant_manager'] },
    { id: 'whatsapp', label: '💬 WhatsApp', roles: ['owner', 'manager', 'assistant_manager'] },
    { id: 'operations', label: '💰 Cash-Up & Ops', roles: ['owner', 'manager', 'assistant_manager', 'supervisor'] },
    { id: 'restaurant', label: '🍽️ Restaurant', roles: ['owner', 'manager'] },
    { id: 'recipe', label: '🍳 Recipe & Production', roles: ['owner', 'manager'] },
    { id: 'purchase-orders', label: '📝 Purchase Orders', roles: ['owner', 'manager'] },
    { id: 'reports', label: '📈 Reports', roles: ['owner', 'manager'] },
    { id: 'bookkeeping', label: '📒 Bookkeeping', roles: ['owner', 'manager'] },
    { id: 'users', label: '👤 Users', roles: ['owner', 'manager'] },
    { id: 'audit', label: '🔍 Audit Log', roles: ['owner', 'manager'] },
    { id: 'features', label: '✨ Explore All Features', roles: ['owner', 'manager', 'supervisor'] }
  ],

  /**
   * Far-left sidebar layout only — regroups existing navItems (no feature changes).
   * Settings / Logout stay in the sidebar footer.
   */
  navGroups: [
    { type: 'item', id: 'dashboard' },
    { type: 'group', id: 'sales', label: '💳 SALES', items: ['pos', 'quotes', 'returns', 'layby'] },
    { type: 'group', id: 'products-stock', label: '📦 PRODUCTS & STOCK', items: ['products', 'categories', 'stock', 'purchase-orders'] },
    { type: 'group', id: 'customers', label: '👥 CUSTOMERS', items: ['customers', 'giftcards'] },
    { type: 'group', id: 'suppliers-expenses', label: '🚚 SUPPLIERS & EXPENSES', items: ['suppliers', 'expenses'] },
    { type: 'group', id: 'restaurant', label: '🍽️ RESTAURANT', items: ['restaurant', 'recipe'] },
    { type: 'group', id: 'staff-users', label: '👷 STAFF & USERS', items: ['staff', 'users'] },
    { type: 'group', id: 'finance', label: '💰 FINANCE', items: ['operations', 'bookkeeping'] },
    { type: 'group', id: 'reports', label: '📈 REPORTS', items: ['reports'] },
    { type: 'group', id: 'communication', label: '💬 COMMUNICATION', items: ['whatsapp', 'document-hub'] },
    { type: 'item', id: 'audit' },
    { type: 'item', id: 'features' },
    { type: 'item', id: 'admin' }
  ],

  _navGroupOpen: null,

  _navItemById(id) {
    return this.navItems.find((n) => n.id === id) || null;
  },

  _isNavGroupOpen(groupId) {
    try {
      if (!this._navGroupOpen) {
        const raw = sessionStorage.getItem('shoppos_nav_groups_open');
        this._navGroupOpen = raw ? JSON.parse(raw) : {};
      }
    } catch (_) {
      this._navGroupOpen = {};
    }
    return !!this._navGroupOpen[groupId];
  },

  _setNavGroupOpen(groupId, open) {
    try {
      if (!this._navGroupOpen) this._navGroupOpen = {};
      if (open) this._navGroupOpen[groupId] = true;
      else delete this._navGroupOpen[groupId];
      sessionStorage.setItem('shoppos_nav_groups_open', JSON.stringify(this._navGroupOpen));
    } catch (_) { /* */ }
  },

  _renderNavPageBtn(item) {
    if (!item) return '';
    const enforcement = !!(this.entitlements?.enforcement);
    const entitled = !enforcement || Utils.isPageEntitled(item.id);
    if (entitled) {
      return `<button type="button" class="nav-btn" data-page="${item.id}">${item.label}</button>`;
    }
    const tip = `Upgrade your package to access ${String(item.label).replace(/^[^A-Za-z0-9]+/, '')}.`;
    return `<button type="button" class="nav-btn nav-btn-locked" data-page="${item.id}" data-locked="1" title="${Utils.escHtml(tip)}" aria-label="${Utils.escHtml(tip)}">🔒 ${item.label}</button>`;
  },

  pages: {},
  /** Page script bundles ? Android loads these on first open (Windows index still preloads most). */
  _pageBundles: {
    dashboard: ['js/pages/dashboard.js'],
    pos: ['js/pages/pos.js'],
    staff: ['js/pages/staff.js', 'js/pages/staff-owner-salary.js', 'js/pages/admin-recruitment.js'],
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
      'js/pages/admin.js'
    ]
  },
  _adminSectionScripts: {
    staffhr: ['js/pages/admin-staff.js', 'js/pages/staff.js', 'js/pages/staff-owner-salary.js'],
    staffportal: ['js/pages/staff.js', 'js/pages/staff-owner-salary.js'],
    'hr-workspace': ['js/pages/admin-hr.js', 'js/pages/admin-staff.js'],
    'hr-approvals': ['js/pages/admin-hr.js', 'js/pages/admin-staff.js'],
    hrcontracts: ['js/pages/admin-hr.js'],
    recruitment: ['js/pages/admin-recruitment.js'],
    'employee-of-month': ['js/pages/admin-employee-month.js'],
    payroll: ['js/pages/admin-payroll.js'],
    opscompliance: ['js/pages/admin-operations.js'],
    combos: ['js/pages/admin-combos.js'],
    quotes: ['js/pages/admin-quotes.js'],
    'menu-builder': ['js/pages/admin-menu-builder.js', 'js/promo-poster.js'],
    'promo-video-builder': ['js/pages/admin-promo-video-builder.js', 'js/pages/admin-promo-video-advanced.js'],
    radio: ['js/pages/admin-radio.js'],
    'communication-center': ['js/pages/admin-communication-center.js'],
    'delivery-dept': ['js/pages/admin-delivery.js'],
    'referral-dept': ['js/pages/admin-referral.js'],
    'business-modules': ['js/pages/admin-business-modules.js'],
    salesmgmt: ['js/pages/admin-audit.js'],
    saleexplorer: ['js/pages/admin-audit.js'],
    soldproducts: ['js/pages/admin-audit.js'],
    returnsmgmt: ['js/pages/admin-audit.js'],
    activity: ['js/pages/admin-audit.js'],
    exceptions: ['js/pages/admin-audit.js'],
    alerts: ['js/pages/admin-audit.js'],
    dailyclose: ['js/pages/admin-audit.js'],
    'discount-report': ['js/pages/admin-audit.js'],
    'pos-menu': ['js/pages/admin-audit.js'],
    overview: ['js/pages/admin-audit.js'],
    'taken-orders': ['js/pages/admin-pro.js'],
    onaccount: ['js/pages/admin-pro.js'],
    developer: ['js/pages/admin-pro.js'],
    formats: ['js/pages/admin-pro.js'],
    automation: ['js/pages/admin-pro.js'],
    customfields: ['js/pages/admin-pro.js'],
    database: ['js/pages/admin-pro.js'],
    'system-health': ['js/pages/admin-pro.js'],
    analytics: ['js/pages/admin-web-analytics.js'],
    users: ['js/pages/users.js'],
    permissions: ['js/pages/users.js']
  },
  _adminExtenderAll: [
    'js/promo-poster.js',
    'js/pages/staff.js',
    'js/pages/staff-owner-salary.js',
    'js/pages/admin-pro.js',
    'js/pages/admin-audit.js',
    'js/pages/admin-staff.js',
    'js/pages/admin-hr.js',
    'js/pages/admin-operations.js',
    'js/pages/admin-combos.js',
    'js/pages/admin-menu-builder.js',
    'js/pages/admin-promo-video-builder.js',
    'js/pages/admin-promo-video-advanced.js',
    'js/pages/admin-radio.js',
    'js/pages/admin-communication-center.js',
    'js/pages/admin-quotes.js',
    'js/pages/admin-payroll.js',
    'js/pages/admin-employee-month.js',
    'js/pages/admin-recruitment.js',
    'js/pages/admin-web-analytics.js',
    'js/pages/admin-delivery.js',
    'js/pages/admin-referral.js',
    'js/pages/admin-business-modules.js',
    'js/pages/users.js'
  ],
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
    'document-hub': 'DocumentHubPage',
    whatsapp: 'WhatsAppPage',
    operations: 'OperationsPage',
    restaurant: 'RestaurantPage',
    'purchase-orders': 'PurchaseOrdersPage',
    reports: 'ReportsPage',
    bookkeeping: 'BookkeepingPage',
    users: 'UsersPage',
    audit: 'AuditPage',
    settings: 'SettingsPage',
    features: 'FeaturesPage'
  },
  _lazyScripts: {},
  _scheduledDocInterval: null,

  appMode() {
    return window.__SHOP_POS_APP_MODE__ || 'admin';
  },

  /** Activation / first-run handoff: open setup wizard, not login. */
  _wantsSetupHandoff() {
    try {
      return new URLSearchParams(location.search || '').get('start') === 'setup';
    } catch (_) {
      return false;
    }
  },

  _isHostedCustomerEntry() {
    try {
      return !!window.ShopProfiles?.isHostedCustomerApp?.();
    } catch (_) {
      return false;
    }
  },

  /**
   * SaaS customer URL (or ?start=setup): Setup first if needed, then Login only.
   * Never dump a first-time shop into username/password before setup completes.
   */
  async _bootSetupThenLogin(opts = {}) {
    const forceSetup = !!opts.forceSetup || this._wantsSetupHandoff();
    this.hideMobileLoading();
    this.applyLoginChrome();

    // Do not restore a session into the app when the user is trying to set up.
    if (!forceSetup && await this.tryRestoreSession()) return;

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
      this.showWelcome({
        needsSetup: true,
        status: res.error || 'Could not reach the shop database yet. You can still try Set Up My Shop.'
      });
      if (forceSetup) this.showScreen('setup');
      return;
    }
    this.settings = res.data;
    this.applyTheme();
    this.syncDeviceSettings().catch(() => {});

    const setupDone = !!Number(this.settings?.setup_complete);

    if (!setupDone) {
      this.updateBranding({ page: 'Setup' });
      if (forceSetup) {
        this.showScreen('setup');
        return;
      }
      this.showWelcome({ needsSetup: true });
      return;
    }

    // Setup already done — never show Set Up My Shop again; go to Login.
    this.updateBranding({ page: 'Login' });
    try {
      if (forceSetup) history.replaceState(null, '', location.pathname || '/');
    } catch (_) { /* */ }
    this.showScreen('login');
    this.startLoginOperatingTimer?.();
    this.prefetchLoginScripts();
    this.checkContractReacceptance?.().catch(() => {});
  },

  isPosKiosk() {
    return this.appMode() === 'pos';
  },

  formatSidebarUserRole(user, branchName) {
    const name = user?.full_name || user?.username || '';
    const role = user?.role ? String(user.role).replace(/_/g, ' ') : '';
    return [name, role, branchName].filter(Boolean).join(' · ');
  },

  isDeliveryPortal() {
    return this.appMode() === 'delivery';
  },

  isRecipePortal() {
    return this.appMode() === 'recipe';
  },

  _isPortalEntry() {
    try {
      return new URLSearchParams(location.search).get('entry') === '1';
    } catch (_) { return false; }
  },

  _isStudioHandoff() {
    try {
      return new URLSearchParams(location.search).get('studio') === '1'
        || !!sessionStorage.getItem('shoppos_studio_lock');
    } catch (_) { return false; }
  },

  _clearPortalEntry() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('entry');
      history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
    } catch (_) { /* ignore */ }
  },

  /** Portal entry=1 skips restore (fresh login). Studio handoff must NOT skip. */
  _shouldSkipSessionRestore() {
    if (this._isStudioHandoff()) return false;
    return this._isPortalEntry();
  },

  _navStateKey: 'shoppos_nav_v1',

  _navFromHash() {
    try {
      const raw = String(location.hash || '').replace(/^#/, '');
      if (!raw || raw.startsWith('app=')) {
        const p = new URLSearchParams(raw.includes('=') ? raw : '');
        const page = p.get('page');
        if (page) return { page, adminSection: p.get('section') || null };
      }
      const p = new URLSearchParams(raw.includes('&') || raw.includes('=') ? raw : '');
      const page = p.get('page');
      if (page) return { page, adminSection: p.get('section') || null };
    } catch (_) { /* ignore */ }
    return null;
  },

  _loadNavState() {
    const fromHash = this._navFromHash();
    if (fromHash?.page) return fromHash;
    try {
      const raw = localStorage.getItem(this._navStateKey);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s?.mode && s.mode !== this.appMode()) return null;
      return s;
    } catch (_) {
      return null;
    }
  },

  _saveNavState() {
    if (!this.user) return;
    if (this.isPosKiosk() || this.isDeliveryPortal() || this.isRecipePortal()) return;
    try {
      const state = {
        page: this.currentPage,
        adminSection: (typeof AdminPage !== 'undefined' && AdminPage.section) ? AdminPage.section : null,
        adminLoyaltyTab: (typeof AdminPage !== 'undefined' && AdminPage._loyaltyTab) ? AdminPage._loyaltyTab : null,
        adminComboTab: (typeof AdminCombosPage !== 'undefined' && AdminCombosPage.tab) ? AdminCombosPage.tab : null,
        mode: this.appMode(),
        ts: Date.now()
      };
      localStorage.setItem(this._navStateKey, JSON.stringify(state));
      let hash = `app=${state.mode}`;
      if (state.page) hash += `&page=${encodeURIComponent(state.page)}`;
      if (state.page === 'admin' && state.adminSection) {
        hash += `&section=${encodeURIComponent(state.adminSection)}`;
      }
      const next = `#${hash}`;
      if (location.hash !== next) {
        history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
      }
    } catch (_) { /* ignore */ }
  },

  _clearNavState() {
    try { localStorage.removeItem(this._navStateKey); } catch (_) { /* ignore */ }
    try {
      const mode = this.appMode();
      history.replaceState(null, '', `${location.pathname}${location.search}#app=${mode}`);
    } catch (_) { /* ignore */ }
  },

  async tryRestoreSession() {
    let token = '';
    try {
      const store = (this.appMode?.() === 'admin' || this.appMode?.() === 'studio-builder')
        ? sessionStorage
        : localStorage;
      token = store.getItem('shoppos_rpc_session') || '';
      if (!token && this.appMode?.() === 'studio-builder') {
        token = localStorage.getItem('shoppos_rpc_session') || '';
      }
    } catch (_) { /* ignore */ }
    if (!token) return false;

    const enterRestored = async (offlineMode = false) => {
      this.applyPosKioskChrome();
      this._restoredNav = this._loadNavState();
      const opts = { restored: true, skipPosWelcome: true, offline: offlineMode };
      if (this.appMode() === 'delivery') {
        await this.openDeliveryDepartment();
        return true;
      }
      if (this.appMode() === 'recipe') {
        await this.openRecipeProduction({ fromApp: true });
        return true;
      }
      if (this.isPosKiosk()) {
        await this.enterApp(opts);
        return true;
      }
      await this.enterApp({ restored: true, offline: offlineMode });
      return true;
    };

    try {
      const cachedP = window.OfflineStore?.loadSession?.() || Promise.resolve(null);
      const res = await Promise.race([
        API.getSession(),
        new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 2500))
      ]);
      if (res?.__timeout) {
        const cached = await cachedP;
        const user = cached?.user;
        if (user?.id) {
          this.user = user;
          this.user.is_active = 1;
          if (cached.settings) this.settings = cached.settings;
          API.getSession().then((live) => {
            const liveUser = live?.data || live?.user;
            if (live?.success && liveUser?.id) this.user = liveUser;
          }).catch(() => {});
          return enterRestored(false);
        }
      }
      const user = res?.data || res?.user;
      if (!res?.success || !user?.id) {
        try { localStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
        try { sessionStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
        return false;
      }
      this.user = user;
      this.user.is_active = 1;
      try {
        window.OfflineStore?.saveSession?.(user, this.settings || null);
      } catch (_) { /* ignore */ }
      return enterRestored(false);
    } catch (_) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline && window.OfflineStore?.loadSession) {
        try {
          const cached = await window.OfflineStore.loadSession();
          const user = cached?.user;
          if (user?.id) {
            this.user = user;
            this.user.is_active = 1;
            if (cached.settings) this.settings = cached.settings;
            try { window.ShopPosConnection?.set?.('offline', 'Offline — local till'); } catch (_) { /* ignore */ }
            return enterRestored(true);
          }
        } catch (_) { /* ignore */ }
      }
      if (!offline) {
        try { localStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
        try { sessionStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
      }
      return false;
    }
  },

  applyPosKioskChrome() {
    const on = this.isPosKiosk();
    document.documentElement.classList.toggle('pos-kiosk', on);
    document.body.classList.toggle('pos-kiosk', on);
    if (on) {
      document.getElementById('login-back-welcome')?.classList.add('hidden');
      this.closeSidebar?.();
      SoundService?.stopAlert();
      this.stopNotificationRefresh();
      this.stopNotificationSoundMonitor();
      this.stopScheduledDocMonitor();
      document.getElementById('notif-badge')?.classList.add('hidden');
    }
  },

  /** Warm page scripts while user is still on login (faster after Sign In). */
  prefetchLoginScripts() {
    if (this._loginPrefetchStarted) return;
    this._loginPrefetchStarted = true;
    const mode = this.appMode();
    if (mode === 'referral-commission') {
      const run = () => {
        this.ensureFeatureCss?.('css/referral-dept.css');
        this.ensureFeatureScript?.('js/pages/admin-referral.js').catch(() => {});
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 400 });
      else setTimeout(run, 100);
      return;
    }
    const pages = mode === 'pos'
      ? ['pos', 'returns']
      : mode === 'delivery'
        ? []
        : ['pos', 'dashboard', 'admin', 'products', 'stock', 'customers', 'suppliers', 'expenses', 'quotes', 'returns', 'layby', 'giftcards', 'whatsapp'];
    const run = () => {
      pages.forEach((p, i) => setTimeout(() => this.ensurePageScripts(p).catch(() => {}), i * 50));
    };
    if (mode === 'pos') run();
    else if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 400 });
    else setTimeout(run, 100);
  },

  async ensureSettingsLoaded() {
    if (this.settings && Number(this.settings.setup_complete) !== undefined) return this.settings;
    try {
      const res = await API.getSettingsParsed();
      if (res.success) {
        this.settings = res.data;
        this.applyTheme?.();
        this.updateBranding?.();
        if (this.user?.id) {
          try { window.OfflineStore?.saveSession?.(this.user, this.settings); } catch (_) { /* ignore */ }
        }
      }
    } catch (_) { /* ignore */ }
    if (!this.settings && window.OfflineStore?.loadSession) {
      try {
        const cached = await window.OfflineStore.loadSession();
        if (cached?.settings) {
          this.settings = cached.settings;
          this.applyTheme?.();
          this.updateBranding?.();
        }
      } catch (_) { /* ignore */ }
    }
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
      const forceSetup = this._wantsSetupHandoff();
      const hostedCustomer = this._isHostedCustomerEntry();

      // Dedicated apps: skip admin welcome/setup ? go straight to that app's login
      if (mode === 'apply') {
        this.hideMobileLoading();
        await this.openJobApply();
        return;
      }
      if (mode === 'staff') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        await this.openStaffPortal();
        return;
      }
      if (mode === 'recipe') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) return;
        await this.openRecipeProduction();
        return;
      }
      if (mode === 'accounting') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        await this.openAccountingLogin();
        return;
      }
      if (mode === 'hr') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        await this.openHr({ fromLogin: true });
        return;
      }
      if (mode === 'delivery') {
        this.applyLoginChrome();
        this.hideMobileLoading();
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) return;
        this.showScreen('login');
        const loginSub = document.getElementById('login-sub');
        if (loginSub) {
          loginSub.textContent = 'Delivery Department — sign in with your assigned username and password.';
        }
        const loginName = document.getElementById('login-shop-name');
        if (loginName && !this.settings?.shop_name) loginName.textContent = 'Delivery Department';
        this.startLoginOperatingTimer?.();
        this.prefetchLoginScripts();
        this.ensureSettingsLoaded().then(() => {
          this.applyTheme?.();
          this.updateBranding?.();
        }).catch(() => {});
        return;
      }
      if (mode === 'referral') {
        this.hideMobileLoading();
        this.ensureSettingsLoaded().catch(() => {});
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) return;
        await this.openReferralAgent({ fromLogin: true, view: 'gate' });
        return;
      }
      if (mode === 'referral-commission') {
        this.applyLoginChrome();
        this.hideMobileLoading();
        // Prefetch only the Referral module (not the full Admin bundle — that crashes Android)
        this.ensureFeatureCss?.('css/referral-dept.css');
        this.ensureFeatureScript?.('js/pages/admin-referral.js');
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) {
          if (['owner', 'manager', 'assistant_manager', 'supervisor', 'admin'].includes(this.user?.role)) {
            await this.openReferralCommission({ fromLogin: true });
            return;
          }
        }
        this.showScreen('login');
        const loginSub = document.getElementById('login-sub');
        if (loginSub) {
          loginSub.textContent = 'Referral & Commission — sign in with owner, manager or supervisor credentials. This is not the full Admin app.';
        }
        this.startLoginOperatingTimer?.();
        return;
      }
      if (mode === 'mgr-hr') {
        this.applyLoginChrome();
        this.hideMobileLoading();
        // Prefetch portal assets while user types credentials
        this.ensureFeatureCss?.('css/mgr-hr-portal.css');
        this.ensureFeatureScript?.('js/pages/mgr-hr-portal.js');
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) {
          await this.openMgrHrPortal({ fromLogin: true });
          return;
        }
        this.showScreen('login');
        const loginSub = document.getElementById('login-sub');
        if (loginSub) {
          loginSub.textContent = 'Manager & Supervisor Portal — sign in with your assigned manager/supervisor account (or Admin credentials).';
        }
        this.startLoginOperatingTimer?.();
        return;
      }

      // Hosted SaaS customer URL, or activation "Continue to Set Up My Shop":
      // Setup wizard first — only Login after setup_complete.
      if (hostedCustomer || forceSetup) {
        await this._bootSetupThenLogin({ forceSetup });
        return;
      }

      // POS-only installer: show login immediately (no setup / welcome delay)
      if (mode === 'pos') {
        Utils.purgeLegacyPosMenuSnapshots?.();
        this.applyPosKioskChrome();
        this.hideMobileLoading();
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) return;
        this.showScreen('login');
        this.populateLoginBranchPicker().catch(() => {});
        this.startLoginOperatingTimer?.();
        this.prefetchLoginScripts();
        this.ensureSettingsLoaded().then(() => {
          this.applyTheme?.();
          this.updateBranding?.();
        }).catch(() => {});
        return;
      }

      // Menu & Promo Studio builders — fully standalone (no Admin chrome)
      if (mode === 'studio-builder') {
        this.hideMobileLoading();
        document.documentElement.classList.add('studio-builder-mode');
        document.body?.classList?.add('studio-builder-mode');
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) return;
        // No session → send back to Studio login (never show Admin login)
        const back = sessionStorage.getItem('shoppos_studio_return') || '/studio/';
        location.replace(back);
        return;
      }

      // Admin portal: restore session on refresh (stay signed in + same page)
      if (mode === 'admin') {
        // Legacy Studio handoff URLs used app=admin&studio=1 — send to standalone builders
        try {
          const q = new URLSearchParams(location.search || '');
          if (q.get('studio') === '1') {
            const section = sessionStorage.getItem('shoppos_studio_section')
              || new URLSearchParams(String(location.hash || '').replace(/^#/, '')).get('section')
              || 'menu-builder';
            const moduleQ = /video|promo/.test(section) ? 'video' : 'menu';
            location.replace(`index.html?app=studio-builder&module=${moduleQ}&studio=1`);
            return;
          }
        } catch (_) { /* */ }
        this.applyLoginChrome();
        this.hideMobileLoading();
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) return;
        this.showScreen('login');
        const loginSub = document.getElementById('login-sub');
        if (loginSub) {
          loginSub.textContent = 'Sign in with your shop owner or manager username and password (the username you chose at setup — not "admin" unless you created that user).';
        }
        this.startLoginOperatingTimer?.();
        this.prefetchLoginScripts();
        this.ensureSettingsLoaded().then(() => {
          this.applyTheme?.();
          this.updateBranding?.();
        }).catch(() => {});
        return;
      }

      // Show Sign in ASAP ? load settings in background (don't block login UI)
      this.hideMobileLoading();
      if (await this.tryRestoreSession()) return;
      this.showWelcome({ shopReady: true, status: 'Loading shop?' });
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
            ' ? existing shop detected. Restart Shop POS (do not register a new shop).'
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
      // Device sync can wait ? don't block Sign in
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
        try {
          const start = new URLSearchParams(location.search || '').get('start');
          if (start === 'setup') {
            this.showScreen('setup');
            return;
          }
        } catch (_) { /* */ }
        this.showWelcome({ needsSetup: true });
        return;
      }
      this.updateBranding();
      try {
        const go = new URLSearchParams(location.search || '').get('page');
        if (go === 'pos' && Number(this.settings?.setup_complete)) {
          this.showWelcome({ shopReady: true });
          setTimeout(() => this.navigate?.('pos') || this.showPage?.('pos'), 100);
          return;
        }
      } catch (_) { /* */ }
      this.showWelcome({ shopReady: true });
      this.checkContractReacceptance?.().catch(() => {});
    } catch (err) {
      console.error('App init failed:', err);
      this.showMobileError(err.message || 'Could not start Shop POS');
    }
  },

  async checkContractReacceptance() {
    const shopId = localStorage.getItem('shoppos_shop_id')
      || this.settings?.platform_shop_id
      || this.settings?.shop_id;
    if (!shopId || !window.API?.rpc) return;
    try {
      const r = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'activation:getContext', args: [{ shop_id: shopId }] })
      });
      const json = await r.json().catch(() => ({}));
      const data = json.data || json;
      if (!data?.needs_reacceptance && !data?.reacceptance_message) return;
      let bar = document.getElementById('contract-reaccept-banner');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'contract-reaccept-banner';
        bar.style.cssText = 'position:fixed;z-index:9999;left:12px;right:12px;bottom:12px;padding:14px 16px;background:#0f172a;color:#f8fafc;border:1px solid #38bdf8;border-radius:10px;font:14px/1.4 Georgia,serif;box-shadow:0 8px 24px rgba(0,0,0,.35)';
        document.body.appendChild(bar);
      }
      const msg = data.reacceptance_message
        || 'Your Service Agreement has been updated. Please review and accept the new agreement to continue.';
      bar.innerHTML = `<strong>${msg}</strong><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="/activate?shop=${encodeURIComponent(shopId)}" style="background:#38bdf8;color:#0f172a;padding:8px 12px;border-radius:8px;text-decoration:none;font-weight:700">Review Updated Agreement</a>
        <a href="/activate?shop=${encodeURIComponent(shopId)}" style="background:#334155;color:#f8fafc;padding:8px 12px;border-radius:8px;text-decoration:none">Accept &amp; Sign</a>
      </div>`;
    } catch (_) { /* optional */ }
  },

  showWelcome(opts = {}) {
    const statusEl = document.getElementById('welcome-status');
    const nameEl = document.getElementById('welcome-shop-name');
    const titleEl = document.getElementById('welcome-title');
    const subEl = document.getElementById('welcome-sub');
    const signInBtn = document.getElementById('welcome-signin');
    const setupBtn = document.getElementById('welcome-setup');
    const needsSetup = !!opts.needsSetup || !Number(this.settings?.setup_complete);
    const shopReady = !!opts.shopReady || (!needsSetup && !!Number(this.settings?.setup_complete));
    const rawName = (this.settings?.shop_name || this.settings?.app_display_name || '').trim();
    const shopName = rawName && !/^my shop$/i.test(rawName) ? rawName : (needsSetup ? 'Set Up Your Shop' : 'Shop POS');
    if (nameEl) nameEl.textContent = shopName;
    if (titleEl) titleEl.textContent = `Welcome to ${shopName}`;
    if (subEl) {
      if (needsSetup) {
        subEl.textContent = 'Set up your shop to get started — this is your own shop environment.';
        subEl.classList.remove('hidden');
      } else if (opts.status) {
        subEl.textContent = '';
        subEl.classList.add('hidden');
      } else {
        subEl.textContent = "Don't have your shop set up yet? Use Set Up My Shop below (authorised users only after setup).";
        // Returning customers: hide the helper line once setup is done (setup button also hidden).
        subEl.classList.add('hidden');
      }
    }
    if (signInBtn) {
      signInBtn.textContent = 'Login';
      // First-time: primary CTA is Set Up. Returning: primary is Login.
      signInBtn.style.display = needsSetup && !shopReady ? 'none' : '';
      if (!needsSetup) signInBtn.classList.add('btn-primary');
    }
    if (setupBtn) {
      setupBtn.textContent = 'Set Up My Shop';
      // After setup completes, hide setup for normal visitors (owners can still reach via admin).
      setupBtn.style.display = needsSetup ? '' : 'none';
      if (needsSetup) {
        setupBtn.classList.add('btn-primary');
        signInBtn?.classList.remove('btn-primary');
      }
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
    this.applyLoginChrome();
    this.renderShopProfilePicker();
    this.updateBranding({ page: needsSetup ? 'Setup' : 'Login' });
  },

  renderShopProfilePicker() {
    const picker = document.getElementById('welcome-shop-picker');
    const sel = document.getElementById('welcome-shop-select');
    if (!picker || !sel || !window.ShopProfiles) return;
    // SaaS hosted customer URL: never show Chisa multi-shop switcher.
    if (ShopProfiles.isHostedCustomerApp?.()) {
      picker.style.display = 'none';
      return;
    }
    const list = ShopProfiles.list();
    const active = ShopProfiles.getActive();
    sel.innerHTML = list.map((p) =>
      `<option value="${Utils.escHtml(p.id)}" ${p.id === active?.id ? 'selected' : ''}>${Utils.escHtml(p.name)}</option>`
    ).join('');
    picker.style.display = list.length ? '' : 'none';
  },

  bindShopProfileEvents() {
    document.getElementById('welcome-shop-switch')?.addEventListener('click', () => {
      const sel = document.getElementById('welcome-shop-select');
      const id = sel?.value;
      if (!id || !window.ShopProfiles) return;
      ShopProfiles.setActive(id);
      ShopProfiles.clearPanelSessions();
      Utils.toast(`Switched to ${ShopProfiles.getActive()?.name || 'shop'}`, 'success');
      setTimeout(() => location.reload(), 400);
    });
    document.getElementById('welcome-shop-add')?.addEventListener('click', () => {
      if (window.ShopProfiles?.isHostedCustomerApp?.()) {
        Utils.toast('This shop URL is already your customer environment', 'info');
        return;
      }
      const name = prompt('Shop name')?.trim();
      if (!name) return;
      const url = prompt('Cloud URL (your Railway shop link — not another customer\'s)', ShopProfiles.DEFAULT_CLOUD || '')?.trim();
      if (!url) return;
      try {
        ShopProfiles.save({ name, cloudUrl: url });
        ShopProfiles.setActive(ShopProfiles.list().slice(-1)[0]?.id);
        ShopProfiles.clearPanelSessions();
        Utils.toast('Shop added — reloading', 'success');
        setTimeout(() => location.reload(), 400);
      } catch (e) {
        Utils.toast(e.message || 'Could not add shop', 'error');
      }
    });
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
    this.bindShopProfileEvents();
    document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
    document.querySelector('#login-form button[type="submit"]')?.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const form = document.getElementById('login-form');
      if (form && !e.defaultPrevented) form.requestSubmit?.();
    });
    document.getElementById('welcome-signin')?.addEventListener('click', () => {
      this.showScreen('login');
      this.startLoginOperatingTimer();
      this.prefetchLoginScripts();
    });
    document.getElementById('welcome-setup')?.addEventListener('click', () => {
      this.showScreen('setup');
    });
    document.getElementById('welcome-accounting')?.addEventListener('click', () => {
      this.openAccountingLogin({ fromWelcome: true });
    });
    document.getElementById('welcome-hr')?.addEventListener('click', () => {
      this.openHr({ fromWelcome: true });
    });
    document.getElementById('welcome-staff')?.addEventListener('click', () => {
      this.openStaffPortal();
    });
    document.getElementById('login-back-welcome')?.addEventListener('click', () => {
      this.stopLoginOperatingTimer();
      this.showWelcome({ shopReady: !!Number(this.settings?.setup_complete) });
    });
    document.getElementById('setup-back-welcome')?.addEventListener('click', () => {
      this.showWelcome({ needsSetup: !Number(this.settings?.setup_complete) });
    });
    document.getElementById('login-forgot')?.addEventListener('click', () => {
      this.showRecoveryModal();
    });
    document.getElementById('login-open-accounting')?.addEventListener('click', () => {
      this.openAccountingLogin({ fromLogin: true });
    });
    document.getElementById('login-open-hr')?.addEventListener('click', () => {
      this.openHr({ fromLogin: true });
    });
    document.getElementById('login-open-staff')?.addEventListener('click', () => {
      this.openStaffPortal();
    });
    document.getElementById('setup-form').addEventListener('submit', (e) => this.handleSetup(e));
    document.getElementById('setup-restore-db')?.addEventListener('click', async () => {
      if (!confirm('Restore a .db backup onto this empty device? You will then sign in with that shop?s owner account.')) return;
      const r = await API.backupRestoreSetup();
      if (r.cancelled) return;
      if (!r.success) return Utils.toast(r.error || 'Restore failed', 'error');
      Utils.toast('Shop data restored. Loading?', 'success');
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
    document.getElementById('global-branch-filter')?.addEventListener('change', async (e) => {
      const val = e.target.value;
      const r = await API.setViewBranch(val === 'all' ? null : val, this.user);
      if (r && r.success === false) return Utils.toast(r.error || 'Could not switch branch', 'error');
      this.viewBranchId = val === 'all' ? null : Number(val);
      Utils.toast(val === 'all' ? 'Showing all branches' : 'Branch filter updated', 'success');
      if (this.currentPage) this.navigate(this.currentPage);
    });

    document.getElementById('sidebar-nav').addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-nav-group-toggle]');
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();
        const gid = toggle.getAttribute('data-nav-group-toggle');
        const wrap = toggle.closest('.nav-group');
        const open = !wrap?.classList.contains('is-open');
        this._setNavGroupOpen(gid, open);
        wrap?.classList.toggle('is-open', open);
        const panel = wrap?.querySelector('.nav-group-items');
        if (panel) panel.classList.toggle('hidden', !open);
        const chev = toggle.querySelector('.nav-group-chevron');
        if (chev) chev.textContent = open ? '▾' : '▸';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
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
    ['welcome', 'login', 'setup', 'pos-welcome', 'app', 'staff-portal', 'recipe-production', 'accounting', 'hr', 'display', 'delivery-dept', 'referral-agent', 'referral-commission', 'mgr-hr'].forEach(s =>
      document.getElementById(`screen-${s}`)?.classList.toggle('hidden', s !== name));
    document.body.dataset.activeScreen = name;
    if (name === 'login' || name === 'welcome') this.applyLoginChrome();
    if (name === 'referral-commission' || name === 'referral-agent' || name === 'delivery-dept' || name === 'mgr-hr') {
      this.closeSidebar?.();
      document.body.classList.remove('sidebar-open');
      document.getElementById('sidebar')?.classList.remove('open');
    }
    if (name === 'login' && this.isPosKiosk()) this.populateLoginBranchPicker().catch(() => {});
    const branchWrap = document.getElementById('login-branch-wrap');
    const branchSel = document.getElementById('login-branch');
    if (branchWrap && !this.isPosKiosk()) branchWrap.classList.add('hidden');
    if (branchSel && !this.isPosKiosk()) branchSel.required = false;
  },

  /** Hide cross-app links on dedicated installers (Admin, POS, HR, etc.) */
  applyLoginChrome() {
    const mode = this.appMode();
    const dedicated = new Set(['pos', 'staff', 'recipe', 'accounting', 'hr', 'delivery', 'referral', 'referral-commission', 'mgr-hr', 'admin']);
    const crossIds = [
      'login-open-accounting',
      'login-open-hr',
      'login-open-staff',
      'login-register-agent',
      'welcome-accounting',
      'welcome-hr',
      'welcome-staff',
      'welcome-referral'
    ];
    crossIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      // Always hide these portal shortcuts on Admin login; hide on other dedicated apps too
      el.classList.add('hidden');
      el.style.display = 'none';
    });
    if (mode === 'admin') {
      const loginName = document.getElementById('login-shop-name');
      if (loginName && !this.settings?.shop_name) loginName.textContent = 'Shop POS Admin';
      const welcomeName = document.getElementById('welcome-shop-name');
      if (welcomeName && !this.settings?.shop_name) welcomeName.textContent = 'Shop POS Admin';
      const welcomeTitle = document.getElementById('welcome-title');
      if (welcomeTitle && !this.settings?.shop_name) welcomeTitle.textContent = 'Welcome to Shop POS Admin';
    }
    if (mode === 'delivery') {
      const loginName = document.getElementById('login-shop-name');
      if (loginName) loginName.textContent = this.settings?.shop_name ? `${this.settings.shop_name} — Delivery` : 'Delivery Department';
    }
    if (mode === 'referral-commission') {
      const loginName = document.getElementById('login-shop-name');
      if (loginName) loginName.textContent = this.settings?.shop_name ? `${this.settings.shop_name} — Referral & Commission` : 'Referral & Commission';
      this.ensureFeatureCss?.('css/referral-dept.css');
    }
    if (mode === 'referral') {
      this.ensureFeatureCss?.('css/referral-dept.css');
    }
    if (mode === 'mgr-hr') {
      const loginName = document.getElementById('login-shop-name');
      const shop = this.settings?.shop_name || 'Shop POS';
      if (loginName) loginName.textContent = `${shop}`;
      const loginSub = document.getElementById('login-sub');
      if (loginSub) {
        loginSub.textContent = 'Manager & Supervisor Portal — sign in with your assigned account (or Admin credentials). This portal is for Managers and Supervisors only.';
      }
      this.ensureFeatureCss?.('css/mgr-hr-portal.css');
    }
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

  async closeDeliveryDepartment() {
    document.body.classList.remove('delivery-dept-active');
    window.AdminDeliveryPage?.stopAutoRefresh?.();
    window.PanelNotifyHub?.stop('delivery');
    await this.doLogout();
  },

  initPanelNotify() {
    if (this.isPosKiosk?.()) return;
    const mode = this.appMode();
    if (mode === 'delivery' || mode === 'recipe') return;
    if (!window.PanelNotifyHub) return;
    PanelNotifyHub.initPanel('admin', () => !!this.user);
    PanelNotify?.requestPermission?.();
    if (!this._notifVisBound) {
      this._notifVisBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.user) {
          this.pollNotifications(true).catch(() => {});
        }
      });
      window.addEventListener('focus', () => {
        if (this.user) this.pollNotifications(false).catch(() => {});
      });
    }
  },

  bindGlobalCatalogSync() {
    if (this._globalCatalogSyncBound) return;
    this._globalCatalogSyncBound = true;
    try {
      this._globalCatalogStamp = localStorage.getItem('shop-pos-catalog-ts') || '';
    } catch (_) {
      this._globalCatalogStamp = '';
    }
    const notify = (stamp) => {
      if (!stamp || stamp === this._globalCatalogStamp) return;
      this._globalCatalogStamp = stamp;
      try {
        window.dispatchEvent(new CustomEvent('shop-pos-catalog-updated', { detail: { stamp } }));
      } catch (_) { /* ignore */ }
    };
    window.addEventListener('storage', (e) => {
      if (e.key === 'shop-pos-catalog-ts' && e.newValue) notify(e.newValue);
    });
    window.addEventListener('focus', () => {
      try { notify(localStorage.getItem('shop-pos-catalog-ts') || ''); } catch (_) { /* ignore */ }
    });
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('shop-pos-catalog');
        bc.onmessage = (ev) => { if (ev?.data?.stamp) notify(ev.data.stamp); };
      } catch (_) { /* ignore */ }
    }
    this._globalCatalogPoll = setInterval(() => {
      try { notify(localStorage.getItem('shop-pos-catalog-ts') || ''); } catch (_) { /* ignore */ }
    }, 5000);
  },

  checkPosCatalogStamp() {
    if (!window.POSPage?.reloadCatalog) return;
    let stamp = '';
    try { stamp = localStorage.getItem('shop-pos-catalog-ts') || ''; } catch (_) { /* ignore */ }
    if (!stamp || stamp === POSPage._lastCatalogStamp) return;
    if (document.getElementById('pos-grid') || document.querySelector('.pos-layout')) {
      POSPage._lastCatalogStamp = stamp;
      POSPage.reloadCatalog(true).catch(() => {});
    }
  },

  async openReferralAgent(opts = {}) {
    this.stopLoginOperatingTimer();
    await this.ensureFeatureCss('css/referral-dept.css');
    await this.ensureFeatureScript('js/referral-agent-app.js');
    const appMod = window.ReferralAgentApp;
    if (!appMod?.render) {
      Utils.toast('Referral Agent portal failed to load', 'error');
      return;
    }
    this._referralFromLogin = !!opts.fromLogin || !opts.fromApp;
    this.showScreen('referral-agent');
    // Ask for phone notification permission as soon as the app opens
    try {
      if (window.PanelNotify) {
        PanelNotify.init({ panel: 'referral', loggedIn: () => !!this.user, requestPermission: true });
        await PanelNotify.requestPermission();
      }
    } catch (_) { /* ignore */ }
    const root = document.getElementById('referral-agent-root');
    appMod.view = opts.view || (this.user ? 'home' : 'gate');
    await appMod.render(root, this);
  },

  closeReferralAgent() {
    window.ReferralNotify?.stop();
    const mode = this.appMode();
    const stayOnReferralPortal = mode === 'referral' || this._referralFromLogin || this.user?.role === 'referral_agent';
    this._referralFromLogin = false;
    try { API.logout?.(); } catch (_) { /* ignore */ }
    this.user = null;
    if (stayOnReferralPortal) {
      this.openReferralAgent({ fromLogin: true, view: 'gate' }).catch(() => {
        this.showScreen('referral-agent');
      });
      return;
    }
    this.showScreen('login');
  },

  /** Standalone Referral & Commission module (installer / ?app=referral-commission) — not full Admin. */
  async openReferralCommission(opts = {}) {
    this.stopLoginOperatingTimer();
    this.closeSidebar?.();
    document.body.classList.remove('sidebar-open');
    if (!this.user) {
      this.showScreen('login');
      return;
    }
    const allowed = ['owner', 'manager', 'assistant_manager', 'supervisor', 'admin'];
    if (!allowed.includes(this.user.role)) {
      Utils.toast('Referral & Commission access only for owner, manager, supervisor or admin', 'error');
      await this.doLogout();
      return;
    }
    this._referralCommissionFromLogin = !!opts.fromLogin || this.appMode() === 'referral-commission';
    // Paint shell first so Android / slow networks don't look like a glitch
    this.showScreen('referral-commission');
    try {
      if (window.PanelNotify) {
        PanelNotify.init({ panel: 'referral-commission', loggedIn: () => !!this.user, requestPermission: true });
        // Don't await permission — it hangs/crashes some Android WebViews
        try { PanelNotify.requestPermission?.(); } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
    const root = document.getElementById('referral-commission-root');
    if (!root) return;
    root.innerHTML = '<p class="muted" style="padding:24px;text-align:center">Loading Referral &amp; Commission…</p>';
    try {
      await Promise.all([
        this.ensureFeatureCss('css/referral-dept.css'),
        this.ensureFeatureScript('js/pages/admin-referral.js')
      ]);
      if (!window.AdminReferralPage?.render) {
        throw new Error('Referral & Commission module failed to load');
      }
      if (!this.settings) await this.ensureSettingsLoaded().catch(() => { this.settings = this.settings || {}; });
      const admin = {
        app: this,
        settings: this.settings,
        user: this.user,
        standalone: true,
        renderSection: async () => {}
      };
      await AdminReferralPage.render(root, admin);
      if (window.ReferralNotify) {
        ReferralNotify.init({ panel: 'referral-commission', audience: 'admin', actor: this.user });
        ReferralNotify.start(this.user);
      }
    } catch (err) {
      console.error('[ReferralCommission]', err);
      root.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto;text-align:center">
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not load Referral & Commission')}</p>
        <button type="button" class="btn btn-primary" id="rc-retry">Retry</button></div>`;
      document.getElementById('rc-retry')?.addEventListener('click', () => this.openReferralCommission(opts));
    }
  },

  closeReferralCommission() {
    window.ReferralNotify?.stop();
    const stay = this.appMode() === 'referral-commission' || this._referralCommissionFromLogin;
    this._referralCommissionFromLogin = false;
    try { API.logout?.(); } catch (_) { /* ignore */ }
    this.user = null;
    if (stay) {
      this.showScreen('login');
      const loginSub = document.getElementById('login-sub');
      if (loginSub) {
        loginSub.textContent = 'Referral & Commission — sign in with owner, manager or supervisor credentials. This is not the full Admin app.';
      }
      this.startLoginOperatingTimer?.();
      return;
    }
    this.showScreen('login');
  },

  async openMgrHrPortal(opts = {}) {
    this.stopLoginOperatingTimer();
    this.closeSidebar?.();
    document.body.classList.remove('sidebar-open');
    if (!this.user) {
      this.showScreen('login');
      return;
    }
    this._mgrHrFromLogin = !!opts.fromLogin || this.appMode() === 'mgr-hr';
    this.showScreen('mgr-hr');
    const root = document.getElementById('mgr-hr-root');
    if (!root) return;
    root.innerHTML = '<p class="muted" style="padding:24px;text-align:center">Loading Manager &amp; Supervisor Portal…</p>';
    try {
      await Promise.all([
        this.ensureFeatureCss('css/mgr-hr-portal.css'),
        this.ensureFeatureScript('js/pages/mgr-hr-portal.js')
      ]);
      if (!window.MgrHrPortal?.open) throw new Error('Portal module failed to load');
      await MgrHrPortal.open(this, { container: root, fromAdmin: !!opts.fromAdmin });
    } catch (err) {
      console.error('[MgrHrPortal]', err);
      root.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto;text-align:center">
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not open portal')}</p>
        <button type="button" class="btn btn-primary" id="mgrhr-retry">Retry</button></div>`;
      document.getElementById('mgrhr-retry')?.addEventListener('click', () => this.openMgrHrPortal(opts));
    }
  },

  closeMgrHrPortal() {
    const stay = this.appMode() === 'mgr-hr' || this._mgrHrFromLogin;
    this._mgrHrFromLogin = false;
    if (stay) {
      try { API.logout?.(); } catch (_) { /* ignore */ }
      this.user = null;
      this.showScreen('login');
      const loginSub = document.getElementById('login-sub');
      if (loginSub) {
        loginSub.textContent = 'Manager & Supervisor Portal — sign in with your assigned account.';
      }
      this.startLoginOperatingTimer?.();
      return;
    }
    this.showScreen('app');
    if (typeof AdminPage !== 'undefined' && AdminPage.render) {
      /* return to admin */
    }
  },

  async openDeliveryDepartment() {
    this.stopLoginOperatingTimer();
    document.body.classList.add('delivery-dept-active');
    document.body.classList.remove('sidebar-open');
    // Paint shell immediately so login feels instant
    this.showScreen('delivery-dept');
    const root = document.getElementById('delivery-dept-root');
    const userEl = document.getElementById('delivery-dept-user');
    const titleEl = document.getElementById('delivery-dept-title');
    if (userEl && this.user) userEl.textContent = `${this.user.full_name || this.user.username} · ${this.user.role}`;
    if (titleEl) titleEl.textContent = this.settings?.shop_name ? `${this.settings.shop_name} — Delivery` : 'Delivery Department';
    document.getElementById('delivery-dept-logout')?.addEventListener('click', () => this.closeDeliveryDepartment(), { once: true });
    if (!this.user) {
      this.showScreen('login');
      return;
    }
    const allowed = ['owner', 'manager', 'supervisor', 'delivery_manager'];
    if (!allowed.includes(this.user.role)) {
      Utils.toast('Delivery Department access only', 'error');
      await this.doLogout();
      return;
    }
    if (!root) return;
    if (!root.querySelector('.dd-layout, .dd-root, .admin-delivery')) {
      root.innerHTML = '<p class="muted" style="padding:24px">Loading delivery department…</p>';
    }
    try {
      await Promise.all([
        this.ensureFeatureCss('css/delivery-dept.css'),
        this.settings ? Promise.resolve() : this.ensureSettingsLoaded().catch(() => { this.settings = this.settings || {}; }),
        this.ensureFeatureScript('js/pages/admin-delivery.js')
      ]);
      if (!window.AdminDeliveryPage) throw new Error('Delivery module failed to load');
      if (titleEl) titleEl.textContent = this.settings?.shop_name ? `${this.settings.shop_name} — Delivery` : 'Delivery Department';
      const admin = {
        app: this,
        settings: this.settings,
        user: this.user,
        standalone: true,
        renderSection: async (section, el) => {
          if (section === 'delivery-dept' && window.AdminDeliveryPage) {
            AdminDeliveryPage.standalone = true;
            await AdminDeliveryPage.render(el, admin);
          }
        }
      };
      AdminDeliveryPage.standalone = true;
      await AdminDeliveryPage.render(root, admin);
      if (window.PanelNotifyHub) {
        PanelNotifyHub.initPanel('delivery', () => !!this.user);
        PanelNotifyHub.startPoll('delivery', () => PanelNotifyHub.pollDelivery(this.user), 12000);
      }
    } catch (err) {
      console.error('[DeliveryDepartment]', err);
      root.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto;text-align:center">
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not load Delivery Department')}</p>
        <button type="button" class="btn btn-primary" id="dd-retry">Retry</button></div>`;
      document.getElementById('dd-retry')?.addEventListener('click', () => this.openDeliveryDepartment());
    }
  },

  async openJobApply() {
    this.stopLoginOperatingTimer?.();
    document.body.classList.remove('sidebar-open');
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    document.getElementById('nav')?.style && (document.getElementById('nav').style.display = 'none');
    document.getElementById('mobile-loading')?.style && (document.getElementById('mobile-loading').style.display = 'none');
    try {
      await Utils.loadScript('js/pages/apply-job.js');
    } catch (err) {
      document.body.innerHTML = `<div style="max-width:480px;margin:48px auto;padding:24px;font-family:system-ui">Could not load the application form. Refresh and try again.</div>`;
      return;
    }
    window.ApplyJobPage?.render?.();
  },

  /**
   * Standalone Menu Builder / Promo Video Builder — no Admin sidebar or panels.
   */
  async openStudioBuilder(opts = {}) {
    document.documentElement.classList.add('studio-builder-mode');
    document.body?.classList?.add('studio-builder-mode');
    this.hideMobileLoading?.();

    // Hide all normal POS/Admin screens
    ['screen-welcome', 'screen-login', 'screen-setup', 'screen-app'].forEach((id) => {
      document.getElementById(id)?.classList.add('hidden');
    });

    let moduleKey = opts.module
      || (() => { try { return new URLSearchParams(location.search).get('module'); } catch (_) { return null; } })()
      || sessionStorage.getItem('shoppos_studio_section')
      || 'menu-builder';
    if (moduleKey === 'menu' || moduleKey === 'menu-builder') moduleKey = 'menu-builder';
    else if (/video|promo/.test(String(moduleKey))) moduleKey = 'promo-video-builder';
    else moduleKey = 'menu-builder';

    const canMenu = this.user?.role === 'owner'
      || Utils.hasPermission(this.user, 'studio_menu_builder');
    const canVideo = this.user?.role === 'owner'
      || Utils.hasPermission(this.user, 'studio_promo_video');
    if (moduleKey === 'menu-builder' && !canMenu && canVideo) moduleKey = 'promo-video-builder';
    if (moduleKey === 'promo-video-builder' && !canVideo && canMenu) moduleKey = 'menu-builder';
    if (!canMenu && !canVideo) {
      Utils.toast('Studio Access not granted', 'error');
      location.replace(sessionStorage.getItem('shoppos_studio_return') || '/studio/');
      return;
    }

    sessionStorage.setItem('shoppos_studio_section', moduleKey);
    sessionStorage.setItem('shoppos_studio_lock', [
      canMenu ? 'menu-builder' : '',
      canVideo ? 'promo-video-builder' : ''
    ].filter(Boolean).join(','));

    let shell = document.getElementById('studio-builder-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'studio-builder-shell';
      document.body.appendChild(shell);
    }

    const shop = this.settings?.shop_name || 'Studio';
    const name = this.user?.full_name || this.user?.username || '';
    const isMenu = moduleKey === 'menu-builder';
    const studioHome = sessionStorage.getItem('shoppos_studio_return') || '/studio/';

    shell.innerHTML = `
      <div class="sb-topbar">
        <div class="sb-brand">
          <span class="sb-mark">MP</span>
          <div>
            <strong>Menu &amp; Promo Studio</strong>
            <small>${Utils.escHtml(shop)}${name ? ` · ${Utils.escHtml(name)}` : ''}</small>
          </div>
        </div>
        <div class="sb-switch">
          ${canMenu ? `<button type="button" class="sb-tab ${isMenu ? 'active' : ''}" data-sb="menu-builder">📋 Menu Builder</button>` : ''}
          ${canVideo ? `<button type="button" class="sb-tab ${!isMenu ? 'active' : ''}" data-sb="promo-video-builder">🎬 Promo Video Builder</button>` : ''}
        </div>
        <div class="sb-actions">
          <a class="btn btn-ghost btn-sm" href="${Utils.escHtml(studioHome)}">← Studio home</a>
          <button type="button" class="btn btn-ghost btn-sm" id="sb-logout">Sign out</button>
        </div>
      </div>
      <div class="sb-host" id="studio-builder-host">
        <p class="muted" style="padding:24px;text-align:center">Loading…</p>
      </div>
    `;

    shell.querySelectorAll('[data-sb]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.sb === moduleKey) return;
        const u = new URL(location.href);
        u.searchParams.set('app', 'studio-builder');
        u.searchParams.set('module', btn.dataset.sb === 'menu-builder' ? 'menu' : 'video');
        u.searchParams.set('studio', '1');
        u.hash = '';
        location.href = u.toString();
      });
    });
    document.getElementById('sb-logout')?.addEventListener('click', async () => {
      try { await API.logout?.(this.user); } catch (_) { /* */ }
      try {
        sessionStorage.removeItem('shoppos_rpc_session');
        localStorage.removeItem('shoppos_rpc_session');
        sessionStorage.removeItem('shoppos_studio_lock');
        sessionStorage.removeItem('shoppos_studio_section');
        localStorage.removeItem('studio_token');
        sessionStorage.removeItem('studio_token');
      } catch (_) { /* */ }
      location.replace(studioHome);
    });

    const host = document.getElementById('studio-builder-host');
    await this.ensureSettingsLoaded().catch(() => {});
    const ctx = { app: this };

    try {
      const load = async (src) => {
        if (typeof Utils.reloadScript === 'function') {
          try { await Utils.reloadScript(src); return; } catch (_) { /* */ }
        }
        await Utils.loadScript(src);
      };
      if (isMenu) {
        if (!window.PromoPoster) await this.ensureFeatureScript('js/promo-poster.js');
        await load('js/pages/admin-menu-builder.js');
        if (!window.AdminMenuBuilderPage?.render) throw new Error('Menu Builder failed to load');
        await window.AdminMenuBuilderPage.render(host, ctx);
      } else {
        if (!window.PromoPoster) await this.ensureFeatureScript('js/promo-poster.js');
        await load('js/pages/admin-promo-video-builder.js');
        await load('js/pages/admin-promo-video-advanced.js');
        if (!window.AdminPromoVideoBuilderPage?.render) throw new Error('Promo Video Builder failed to load');
        await window.AdminPromoVideoBuilderPage.render(host, ctx);
      }
    } catch (err) {
      console.error('[StudioBuilder]', err);
      host.innerHTML = `<div style="padding:24px;text-align:center">
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not open builder')}</p>
        <button type="button" class="btn btn-primary" id="sb-retry">Retry</button>
        <a class="btn btn-ghost" href="${Utils.escHtml(studioHome)}" style="margin-left:8px">Studio home</a>
      </div>`;
      document.getElementById('sb-retry')?.addEventListener('click', () => this.openStudioBuilder({ module: moduleKey }));
    }
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
      const loadScripts = Promise.all([
        this.ensureSettingsLoaded().catch(() => { this.settings = this.settings || {}; }),
        Utils.loadScript('js/pages/staff.js'),
        this.ensureFeatureScript('js/staff-selfie-ui.js'),
        this.ensureFeatureScript('js/staff-portal-standalone.js')
      ]);
      try { await Utils.loadScript('js/pages/staff-owner-salary.js'); } catch (_) { /* optional */ }
      await loadScripts;
      this.bindPageModule('staff');
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
    // Restore session after camera/page background — do not force login if still signed in
    const restored = portal.restoreSession?.() || null;
    if (restored?.id) {
      portal.employee = restored;
      portal.step = 'portal';
    } else if (!portal.employee?.id) {
      portal.step = 'login';
      portal.employee = null;
      portal.employeePin = null;
    }
    portal.render(root, this);
  },

  async closeStaffPortal() {
    window.PanelNotifyHub?.stop('staff');
    try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
    try { sessionStorage.removeItem('shoppos_staff_session'); } catch (_) { /* ignore */ }
    StaffSelfieCapture?.stopCamera?.();
    if (window.StaffPortalStandalone) {
      StaffPortalStandalone.employee = null;
      StaffPortalStandalone.employeePin = null;
      StaffPortalStandalone.step = 'login';
      try { StaffPortalStandalone.clearSession?.(); } catch (_) { /* ignore */ }
    }
    if (window.StaffPage) {
      StaffPage.employee = null;
      StaffPage.employeePin = null;
      StaffPage._standalone = false;
    }
    this.showScreen('login');
    this.startLoginOperatingTimer();
  },

  async openAccountingLogin(opts = {}) {
    await this.openAccounting({ fromLogin: true, ...opts });
  },

  async openAccounting(opts = {}) {
    this.stopLoginOperatingTimer?.();
    await this.ensureFeatureCss('css/accounting-command.css');
    await this.ensureFeatureScript('js/accounting-app.js');
    const mod = window.AccountingApp;
    if (!mod?.render) {
      Utils.toast('Accounting Command Centre failed to load', 'error');
      return;
    }
    this._accountingFromLogin = !!opts.fromLogin || !!opts.fromWelcome || !opts.fromApp;
    this.showScreen('accounting');
    const root = document.getElementById('accounting-root');
    if (this.user && (opts.fromApp || opts.skipLogin)) {
      try {
        const r = await API.accSessionFromPos(this.user);
        const user = r?.data || r?.user || r;
        if (user?.id) {
          mod.user = user;
          mod.view = 'app';
          if (opts.section) mod.section = opts.section;
          await mod.render(root, this);
          return;
        }
      } catch (err) {
        Utils.toast(err.message || 'Could not open accounting with Admin login', 'error');
      }
    }
    mod.view = 'login';
    mod.user = null;
    await mod.render(root, this);
  },

  closeAccounting() {
    if (this.appMode() === 'accounting') {
      const root = document.getElementById('accounting-root');
      if (window.AccountingApp) {
        window.AccountingApp.view = 'login';
        window.AccountingApp.user = null;
        window.AccountingApp.render(root, this);
      }
      return;
    }
    if (this._accountingFromLogin || !this.user) {
      this._accountingFromLogin = false;
      this.showScreen('login');
      this.startLoginOperatingTimer?.();
      return;
    }
    this.showScreen('app');
  },

  async openHr(opts = {}) {
    this.stopLoginOperatingTimer?.();
    try {
      if (typeof Utils.reloadStylesheet === 'function') await Utils.reloadStylesheet('css/hr-command.css');
      else await this.ensureFeatureCss('css/hr-command.css');
      if (typeof Utils.reloadScript === 'function') {
        await Utils.reloadScript('js/hr-app.js');
        await Utils.reloadScript('js/hr-parity.js');
      } else {
        await this.ensureFeatureScript('js/hr-app.js');
        await this.ensureFeatureScript('js/hr-parity.js');
      }
    } catch (err) {
      console.warn('[HR] feature load', err);
      await this.ensureFeatureCss('css/hr-command.css');
      await this.ensureFeatureScript('js/hr-app.js');
      await this.ensureFeatureScript('js/hr-parity.js');
    }
    const mod = window.HrApp;
    if (!mod?.render) {
      Utils.toast('HR workspace failed to load', 'error');
      return;
    }
    mod._delegated = false;
    this._hrFromLogin = !!opts.fromLogin || !!opts.fromWelcome || !opts.fromApp;
    this.showScreen('hr');
    const root = document.getElementById('hr-root');
    if (this.user && (opts.fromApp || opts.skipLogin)) {
      mod.user = this.user;
      mod.view = 'app';
    } else {
      mod.view = 'login';
      mod.user = null;
    }
    await mod.render(root, this);
  },

  closeHr() {
    if (this.appMode() === 'hr') {
      const root = document.getElementById('hr-root');
      if (window.HrApp) {
        window.HrApp.view = 'login';
        window.HrApp.user = null;
        window.HrApp.render(root, this);
      }
      return;
    }
    if (this._hrFromLogin || !this.user) {
      this._hrFromLogin = false;
      this.showScreen('login');
      this.startLoginOperatingTimer?.();
      return;
    }
    this.showScreen('app');
  },

  getCloudBaseUrl() {
    try {
      if (window.ShopProfiles?.isHostedCustomerApp?.() && location.origin && !location.origin.startsWith('file:')) {
        return location.origin.replace(/\/$/, '');
      }
    } catch (_) { /* */ }
    const raw = (window.__SHOP_POS_ENV__?.RPC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_RPC_URL || '').replace(/\/rpc\/?$/i, '');
    if (raw) return raw.replace(/\/$/, '');
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return location.origin.replace(/\/$/, '');
    }
    return '';
  },

  async getBusinessManagerUrl() {
    if (!this.user) throw new Error('Sign in to Admin first');
    const allowed = ['owner', 'manager', 'supervisor', 'assistant_manager'];
    if (!allowed.includes(this.user.role)) throw new Error('Business Manager requires admin access');
    const r = await API.mobileBootstrapAdmin(this.user);
    const data = r?.data ?? r;
    const token = data?.token;
    if (!token) throw new Error(r?.error || 'Could not open Business Manager');
    return `${this.getCloudBaseUrl()}/manager/#token=${encodeURIComponent(token)}&from=admin`;
  },

  async openBusinessManager(opts = {}) {
    try {
      const url = await this.getBusinessManagerUrl();
      if (opts.embed && window.AdminPage) {
        AdminPage.section = 'business-manager';
        AdminPage._managerUrl = url;
        document.querySelectorAll('.admin-nav-btn').forEach((b) =>
          b.classList.toggle('active', b.dataset.section === 'business-manager'));
        const el = document.getElementById('admin-content');
        if (el) await AdminPage.renderSection(el);
        return url;
      }
      if (opts.newTab === false) {
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return url;
    } catch (err) {
      Utils.toast(err.message || 'Failed to open Business Manager', 'error');
      return null;
    }
  },

  async openRecipeProduction(opts = {}) {
    this._recipeReturnToApp = !!(opts.fromApp && this.user);
    this.stopLoginOperatingTimer();
    // Paint the screen immediately so the click feels instant; scripts load in parallel.
    this.showScreen('recipe-production');
    const root = document.getElementById('recipe-production-root');
    if (root && !root.querySelector('.rp-shell, .rp-login-wrap') && !window.RecipeProductionApp) {
      root.innerHTML = '<div class="rp-login-wrap"><p class="rp-muted" style="padding:24px;text-align:center">Opening Recipe &amp; Production…</p></div>';
    }
    await Promise.all([
      this.ensureFeatureCss('css/recipe-production.css'),
      this.ensureFeatureScript('js/recipe-production/app.js')
    ]);
    if (!window.RecipeProductionApp) {
      Utils.toast('Recipe & Production failed to load', 'error');
      return;
    }
    RecipeProductionApp.open(this, { fromApp: this._recipeReturnToApp, posUser: this.user });
  },

  closeRecipeProduction() {
    if (this._recipeReturnToApp && this.user && this.appMode() !== 'recipe') {
      this._recipeReturnToApp = false;
      this.showScreen('app');
      return;
    }
    this._recipeReturnToApp = false;
    if (this.appMode() === 'recipe') {
      this.openRecipeProduction();
      return;
    }
    this.showScreen('login');
    this.startLoginOperatingTimer();
  },

  updateBranding(opts = {}) {
    const rawShop = String(this.settings?.shop_name || this.settings?.app_display_name || '').trim();
    const setupDone = !!(this.settings && (this.settings.setup_complete === true || this.settings.setup_complete === 1));
    const shopName = (rawShop && !/^my shop$/i.test(rawShop))
      ? rawShop
      : (setupDone ? 'Shop POS' : 'Set Up Your Shop');
    const appName = String(this.settings?.app_display_name || shopName).trim() || shopName;
    const logo = this.settings?.logo_path;
    const brandTitle = (suffix) => (suffix ? `${shopName} | ${suffix}` : shopName);

    const loginNameEl = document.getElementById('login-shop-name');
    if (loginNameEl) loginNameEl.textContent = shopName;
    const welcomeNameEl = document.getElementById('welcome-shop-name');
    if (welcomeNameEl) welcomeNameEl.textContent = shopName;
    const welcomeTitleEl = document.getElementById('welcome-title');
    if (welcomeTitleEl) welcomeTitleEl.textContent = `Welcome to ${shopName}`;

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

    const path = String(location.pathname || '').toLowerCase();
    const pageHint = String(opts.page || '').trim();
    if (pageHint) document.title = brandTitle(pageHint);
    else if (path.includes('setup')) document.title = brandTitle('Setup');
    else if (path.includes('order') || path.includes('online')) document.title = brandTitle('Online Ordering');
    else if (path.includes('admin') || path.includes('manager')) document.title = brandTitle('Admin');
    else if (document.getElementById('screen-login') && !document.getElementById('screen-login')?.classList.contains('hidden')) {
      document.title = brandTitle('Login');
    } else if (document.getElementById('screen-welcome') && !document.getElementById('screen-welcome')?.classList.contains('hidden')) {
      document.title = brandTitle(setupDone ? 'Login' : 'Setup');
    } else {
      document.title = brandTitle('POS');
    }

    const useCloudLogo = !!(window.__SHOP_POS_CLOUD__ || /^https?:/i.test(String(location.protocol || '')));
    const brandInitials = (shopName || appName || 'POS').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'POS';
    const applyLogo = async (elId, fallback = brandInitials) => {
      const el = document.getElementById(elId);
      if (!el) return;
      if (useCloudLogo) {
        el.innerHTML = `<img src="/api/logo" alt="${shopName}" class="brand-logo-img" onerror="this.parentElement.textContent='${fallback}'">`;
        return;
      }
      if (logo) {
        const img = await API.getImageDataUrl(logo);
        if (img?.success && (img.dataUrl || img.data)) {
          el.innerHTML = `<img src="${img.dataUrl || img.data}" alt="${shopName}" class="brand-logo-img">`;
        } else {
          el.innerHTML = `<img src="${Utils.fileUrl(logo)}" alt="${shopName}" class="brand-logo-img">`;
        }
      } else {
        el.textContent = fallback;
      }
    };
    applyLogo('sidebar-logo');
    applyLogo('login-logo');
    applyLogo('welcome-logo');
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (useCloudLogo) {
      link.href = '/api/logo';
    } else if (logo) {
      API.getImageDataUrl(logo).then((img) => {
        link.href = img?.success && (img.dataUrl || img.data) ? (img.dataUrl || img.data) : Utils.fileUrl(logo);
      }).catch(() => {});
    } else {
      link.href = 'data:image/svg+xml,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1e293b"/><text x="32" y="40" text-anchor="middle" fill="#fff" font-size="22" font-family="sans-serif">${brandInitials}</text></svg>`
      );
    }
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
    if (btn) { btn.disabled = true; btn.dataset.prev = btn.textContent; btn.textContent = 'Signing in?'; }

    try {
      if (!window.posAPI) {
        await new Promise((resolve) => {
          if (window.posAPI) return resolve();
          window.addEventListener('posAPIReady', resolve, { once: true });
          setTimeout(resolve, 1200);
        });
      }
      if (!window.posAPI) {
        errEl.textContent = 'Still connecting to the shop server. Wait a few seconds and try again.';
        errEl.classList.remove('hidden');
        return;
      }
      const result = await API.login(username, password, pin);
      const user = result?.user || result?.data?.user;
      if (!result.success || !user) {
        const errMsg = result.error || 'Invalid username or password';
        if (this.isPosKiosk() && /branch|till/i.test(errMsg)) {
          errEl.classList.add('hidden');
          await this.showPosBranchErrorModal(errMsg);
        } else {
          errEl.textContent = errMsg;
          errEl.classList.remove('hidden');
          Utils.showModal('Sign in failed', `<p>${Utils.escHtml(errMsg)}</p>`, '<button type="button" class="btn btn-primary" id="login-fail-ok">OK</button>');
          document.getElementById('login-fail-ok')?.addEventListener('click', Utils.hideModal);
        }
        return;
      }

      const mode = this.appMode();
      if (mode === 'delivery') {
        const allowed = ['owner', 'manager', 'supervisor', 'delivery_manager'];
        if (!allowed.includes(user.role)) {
          try { await API.logout(); } catch (_) { /* ignore */ }
          errEl.textContent = 'This portal is for Delivery Department staff only. Ask admin to assign you the Delivery Department role.';
          errEl.classList.remove('hidden');
          this.user = null;
          return;
        }
        try { sessionStorage.setItem('delivery_portal_session', '1'); } catch (_) { /* ignore */ }
      }
      if (mode === 'referral') {
        if (user.role !== 'referral_agent') {
          try { await API.logout(); } catch (_) { /* ignore */ }
          errEl.textContent = 'This portal is for Referral Agents only. Use your referral agent username and password.';
          errEl.classList.remove('hidden');
          this.user = null;
          return;
        }
      }
      if (mode === 'referral-commission') {
        const allowed = ['owner', 'manager', 'assistant_manager', 'supervisor'];
        if (!allowed.includes(user.role)) {
          try { await API.logout(); } catch (_) { /* ignore */ }
          errEl.textContent = 'Referral & Commission is for owner, manager or supervisor only.';
          errEl.classList.remove('hidden');
          this.user = null;
          return;
        }
      }

      errEl.classList.add('hidden');
      this.user = user;
      this.user.is_active = 1;
      try { window.OfflineStore?.saveSession?.(user, this.settings || null); } catch (_) { /* ignore */ }
      if (mode === 'admin') {
        try { sessionStorage.setItem('admin_portal_session', '1'); } catch (_) { /* ignore */ }
      }
      Utils.toast(`Signed in as ${user.full_name || user.username}`, 'success');

      if (this.isPosKiosk()) {
        const branchSel = document.getElementById('login-branch');
        const branchId = Number(branchSel?.value || 0);
        const restricted = ['cashier', 'supervisor', 'assistant_manager'].includes(user.role);
        const userBranch = user.branch_id != null ? Number(user.branch_id) : null;
        if (restricted && branchId && userBranch && userBranch !== branchId) {
          try { await API.logout(); } catch (_) { /* ignore */ }
          this.user = null;
          await this.showPosBranchErrorModal(
            'That branch is not assigned to your account. Select the branch you work at, or ask admin to update your user profile.'
          );
          return;
        }
        if (branchId && ['owner', 'manager'].includes(user.role)) {
          API.setActiveBranch(branchId, this.user).catch(() => {});
        }
        try { sessionStorage.setItem('pos_welcome_done', '1'); } catch (_) { /* ignore */ }
      }
      // Keep POS catalog cache warm — only drop session-specific reads
      try {
        window.DataCache?.invalidate?.('openShift', 'notifications', 'dashboard', 'salesReport', 'salesList', 'kitchen');
      } catch (_) { /* ignore */ }
      this.warmPosCatalogCache(user);
      this.prefetchPosCatalog(user);
      this.applyPosKioskChrome();
      this._clearPortalEntry();
      try {
        if (mode === 'delivery') {
          await this.openDeliveryDepartment();
        } else if (mode === 'recipe') {
          await this.openRecipeProduction({ fromApp: true });
        } else if (mode === 'referral-commission') {
          await this.openReferralCommission({ fromLogin: true });
        } else {
          await this.enterApp({ skipPosWelcome: this.isPosKiosk() });
        }
      } catch (err) {
        console.error('[login] enterApp failed:', err);
        errEl.textContent = err?.message || 'Signed in but the dashboard could not load. Please refresh and try again.';
        errEl.classList.remove('hidden');
        this.showScreen('login');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.prev || 'Sign In'; }
    }
  },

  async showRecoveryModal() {
    const hasRes = await API.hasRecoverySecret();
    const hasLocalOrCloud = !!(hasRes && hasRes.success !== false && (hasRes.data === true || hasRes.data?.data === true || hasRes.fromCloud));

    const showChooser = () => {
      Utils.showModal('Account Recovery', `
        <p class="muted">Recover access with the WhatsApp number on your admin account, or with your Private Recovery Phrase.</p>
        <div class="field" style="margin-top:12px">
          <button type="button" class="btn btn-primary btn-block" id="recovery-wa">Recover via WhatsApp</button>
        </div>
        <div class="field">
          <button type="button" class="btn btn-ghost btn-block" id="recovery-phrase" ${hasLocalOrCloud ? '' : 'disabled'}>
            ${hasLocalOrCloud ? 'Use Private Recovery Phrase' : 'Private Recovery Phrase not set up yet'}
          </button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:10px">WhatsApp recovery works for owner, manager, and assistant manager accounts that have a phone number saved in Users.</p>`,
        '<button class="btn btn-ghost" id="recovery-cancel">Cancel</button>');
      document.getElementById('recovery-cancel')?.addEventListener('click', Utils.hideModal);
      document.getElementById('recovery-wa')?.addEventListener('click', showWhatsAppStep);
      document.getElementById('recovery-phrase')?.addEventListener('click', () => {
        if (!hasLocalOrCloud) return;
        showPhraseStep1();
      });
    };

    const showWhatsAppStep = () => {
      Utils.showModal('WhatsApp Recovery', `
        <p class="muted">Enter your admin username, phone, or email. A temporary password is sent to the WhatsApp number on your account.</p>
        <div class="field"><label>Username, phone or email</label>
          <input id="recovery-wa-id" autocomplete="username" placeholder="e.g. your username or 27…"></div>
        <p id="recovery-wa-msg" class="muted hidden" style="margin-top:8px"></p>
        <p id="recovery-wa-err" class="error-msg hidden"></p>`,
        '<button class="btn btn-primary" id="recovery-wa-send">Send temporary password</button><button class="btn btn-ghost" id="recovery-wa-back">Back</button>');
      document.getElementById('recovery-wa-back')?.addEventListener('click', showChooser);
      document.getElementById('recovery-wa-send')?.addEventListener('click', async () => {
        const id = document.getElementById('recovery-wa-id')?.value?.trim() || '';
        const errEl = document.getElementById('recovery-wa-err');
        const msgEl = document.getElementById('recovery-wa-msg');
        errEl?.classList.add('hidden');
        msgEl?.classList.add('hidden');
        if (!id) {
          if (errEl) { errEl.textContent = 'Enter your username, phone, or email'; errEl.classList.remove('hidden'); }
          return;
        }
        const btn = document.getElementById('recovery-wa-send');
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
        try {
          const res = await API.recoverAdminPassword(id);
          if (btn) { btn.disabled = false; btn.textContent = 'Send temporary password'; }
          if (!res || res.success === false) {
            if (errEl) { errEl.textContent = res?.error || 'Recovery failed'; errEl.classList.remove('hidden'); }
            return;
          }
          if (msgEl) {
            msgEl.textContent = res.message || res.data?.message || 'If we find your account, a temporary password will be sent to your WhatsApp.';
            msgEl.classList.remove('hidden');
          }
          const wa = res.whatsapp_url || res.data?.whatsapp_url;
          if (wa) { try { window.open(wa, '_blank'); } catch (_) { /* ignore */ } }
          Utils.toast('Check WhatsApp for your temporary password', 'success');
        } catch (e) {
          if (btn) { btn.disabled = false; btn.textContent = 'Send temporary password'; }
          if (errEl) { errEl.textContent = e?.message || 'Recovery failed'; errEl.classList.remove('hidden'); }
        }
      });
    };

    let verifiedSecret = '';
    let ownerAccount = null;

    const showPhraseStep1 = () => {
      Utils.showModal('Account Recovery', `
        <p class="muted">Enter your <strong>Private Recovery Phrase</strong> (saved in your Supabase shop database) to reset the owner password. This does not delete shop data.</p>
        <div class="field"><label>Private Recovery Phrase</label>
          <input type="password" id="recovery-secret" autocomplete="off" placeholder="Your secret phrase"></div>
        <p id="recovery-error" class="error-msg hidden"></p>`,
        '<button class="btn btn-primary" id="recovery-verify">Continue</button><button class="btn btn-ghost" id="recovery-cancel">Back</button>');

      document.getElementById('recovery-cancel')?.addEventListener('click', showChooser);
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
        showPhraseStep2();
      });
    };

    const showPhraseStep2 = () => {
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

      document.getElementById('recovery-back')?.addEventListener('click', showPhraseStep1);
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

    showChooser();
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
        <p class="muted">${fromAdmin ? 'Set one in Admin ? Security first, then try again.' : 'Recovery is not configured on this system.'}</p>`,
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
      Utils.toast('Business deleted. Register your new shop?', 'success');
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
    btn.textContent = 'Setting up?';

    try {
      const result = await API.completeSetup(data);
      if (!result?.success) {
        throw new Error(result?.error || 'Setup failed');
      }
      const res = await API.getSettingsParsed();
      if (!res.success) throw new Error(res.error || 'Could not load settings');
      this.settings = res.data;
      this.updateBranding();
      Utils.toast('Setup complete! Please sign in with your new username and password.', 'success');
      try {
        history.replaceState(null, '', location.pathname || '/');
      } catch (_) { /* */ }
      this.showScreen('login');
      this.startLoginOperatingTimer?.();
      // Prefill username for convenience
      try {
        const userEl = document.getElementById('login-username');
        if (userEl && data.owner_username) userEl.value = data.owner_username;
      } catch (_) { /* */ }
    } catch (err) {
      errEl.textContent = err.message || 'Setup failed. Please try again.';
      errEl.classList.remove('hidden');
      Utils.toast(err.message || 'Setup failed', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Complete Setup';
    }
  },

  async loadEntitlements() {
    try {
      const res = await API.getEntitlements();
      const data = res?.data || res || null;
      this.entitlements = data;
      this.entitlementsLoaded = true;
      try { window.__SHOP_POS_ENTITLEMENTS__ = data; } catch (_) { /* */ }
      window.SaasFeatures?.invalidate?.();
      window.SaasFeatures?.loadCatalog?.(true).catch?.(() => {});
    } catch (_) {
      this.entitlements = { enforcement: false };
      this.entitlementsLoaded = true;
      try { window.__SHOP_POS_ENTITLEMENTS__ = this.entitlements; } catch (_) { /* */ }
    }
  },

  async ensureAdminSectionScripts(sectionId) {
    const map = this._adminSectionScripts || {};
    const scripts = map[sectionId] || [];
    if (!scripts.length) return;
    await Promise.all(scripts.map(async (src) => {
      try { await Utils.loadScript(src); } catch (err) {
        console.warn('Admin section script failed:', src, err?.message || err);
      }
    }));
  },

  async ensurePageScripts(page) {
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    const scripts = [
      ...(this._pageBundles[page] || []),
      ...(this._lazyScripts[page] || [])
    ];
    const failures = [];
    const loadOne = async (src) => {
      try { await Utils.loadScript(src); }
      catch (err) {
        failures.push(src);
        console.warn('Lazy script load failed:', src, err?.message || err);
      }
    };
    // Admin: load core only here; section extenders load on demand (much faster first paint)
    if (page === 'admin') {
      const core = scripts.find((s) => /\/admin\.js$/i.test(s)) || 'js/pages/admin.js';
      if (!window.AdminPage) await loadOne(core);
      else loadOne(core);
    } else {
      await Promise.all(scripts.map(loadOne));
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

  async enterApp(opts = {}) {
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    this.stopLoginOperatingTimer();
    this.applyPosKioskChrome();

    if (!this.settings) this.ensureSettingsLoaded().catch(() => {});
    this.updateBranding();
    this.applyTheme();

    if (this.appMode() === 'studio-builder') {
      await this.openStudioBuilder(opts);
      return;
    }

    if (this.appMode() === 'delivery') {
      await this.openDeliveryDepartment();
      return;
    }

    if (this.user?.role === 'referral_agent' || this.appMode() === 'referral') {
      await this.openReferralAgent({ fromLogin: true });
      return;
    }

    if (this.appMode() === 'referral-commission') {
      await this.openReferralCommission({ fromLogin: true });
      return;
    }

    if (this.appMode() === 'mgr-hr') {
      await this.openMgrHrPortal({ fromLogin: true });
      return;
    }

    if (this.appMode() === 'recipe') {
      await this.openRecipeProduction({ fromApp: true });
      return;
    }

    if (this.isPosKiosk()) {
      if (!opts.skipPosWelcome) {
        let welcomeDone = false;
        try { welcomeDone = sessionStorage.getItem('pos_welcome_done') === '1'; } catch (_) { /* ignore */ }
        if (!welcomeDone) {
          await this.showPosWelcome();
          return;
        }
      }
      this.showScreen('app');
      SoundService?.stopAlert();
      this.stopNotificationRefresh();
      this.stopNotificationSoundMonitor();
      this.stopScheduledDocMonitor();
      document.getElementById('notif-badge')?.classList.add('hidden');
      try { window.ShopPosConnection?.set?.('hidden'); } catch (_) { /* ignore */ }
      this.warmPosCatalogCache(this.user);
      this.prefetchPosCatalog(this.user);
      if (!window.POSPage?.render) await this.ensurePageScripts('pos');
      else this.ensurePageScripts('pos').catch(() => {});
      await this.navigate('pos');
      const bgPos = async () => {
        try { await API.logOperatingEvent('open', this.user); } catch { /* ignore */ }
        this.startOperatingTimer();
        this.startOperatingHoursWatch();
        this.startAutoLogoutTimer();
        this.startSyncMonitor();
        this.startSessionMonitor();
        try { window.PanelExitGuard?.bind?.(() => this.doLogout()); } catch (_) { /* ignore */ }
      };
      if (isMobile) setTimeout(bgPos, 0);
      else requestIdleCallback?.(() => bgPos(), { timeout: 1500 }) || setTimeout(bgPos, 100);
      return;
    }

    this.showScreen('app');
    if (!this.isPosKiosk()) {
      await this.loadEntitlements();
      this.renderNav();
      document.getElementById('sidebar-user-role').textContent =
        this.formatSidebarUserRole(this.user);
      this.refreshBranchSwitcher().catch(() => {});
    } else {
      this.loadEntitlements().catch(() => {});
    }

    const savedNav = opts.restored ? (this._restoredNav || this._loadNavState()) : null;
    const preferredCustom = this.settings?.customization?.default_home_page;
    const preferred = this.appMode() === 'admin'
      ? 'dashboard'
      : (preferredCustom === 'recipe'
        ? 'dashboard'
        : (preferredCustom
          || (['cashier', 'supervisor', 'assistant_manager'].includes(this.user.role) ? 'pos' : 'dashboard')));
    let startPage = preferred;
    // Studio handoff: always land on Admin builders (menu / promo video)
    const studioHandoff = this._isStudioHandoff();
    if (studioHandoff) {
      startPage = 'admin';
      try {
        const preferredSection = sessionStorage.getItem('shoppos_studio_section')
          || savedNav?.adminSection
          || 'menu-builder';
        if (typeof AdminPage !== 'undefined') {
          AdminPage.section = preferredSection === 'deliveries' ? 'delivery-dept' : preferredSection;
        } else {
          this._pendingAdminSection = preferredSection;
        }
      } catch (_) { /* */ }
    } else if (this.appMode() === 'admin') {
      if (savedNav?.page && Utils.canAccess(this.user, savedNav.page)) {
        startPage = savedNav.page;
      } else {
        startPage = 'dashboard';
      }
    } else if (savedNav?.page && Utils.canAccess(this.user, savedNav.page)) {
      startPage = savedNav.page;
    } else {
      startPage = Utils.canAccess(this.user, preferred)
        ? preferred
        : (this.navItems.map(n => n.id).find(id => Utils.canAccess(this.user, id)) || 'pos');
    }
    if (!studioHandoff && startPage === 'admin' && savedNav?.adminSection && typeof AdminPage !== 'undefined') {
      AdminPage.section = savedNav.adminSection === 'deliveries' ? 'delivery-dept' : savedNav.adminSection;
      if (savedNav.adminLoyaltyTab) AdminPage._loyaltyTab = savedNav.adminLoyaltyTab;
      if (savedNav.adminComboTab && typeof AdminCombosPage !== 'undefined') AdminCombosPage.tab = savedNav.adminComboTab;
    }

    // Navigate ASAP ? do not wait for timers / sync / notifications
    await this.navigate(startPage);
    if (preferredCustom === 'recipe' && Utils.canAccess(this.user, 'recipe')) {
      this.openRecipeProduction({ fromApp: true }).catch(() => {});
    }

    // Background startup (never block UI) ? lighter on POS kiosk
    const bg = async () => {
      if (this.appMode() === 'admin' && Utils.canAccessAdmin?.(this.user)) {
        this.ensurePageScripts('admin').catch(() => {});
        this.ensurePageScripts('products').catch(() => {});
        API.getProducts({ admin_list: true }).catch(() => {});
        API.getCategories({}).catch(() => {});
      }
      if (!this.isPosKiosk()) {
        try {
          const br = await API.getActiveBranch();
          if (br.success && br.data) {
            this.activeBranch = br.data;
            document.getElementById('sidebar-user-role').textContent =
              this.formatSidebarUserRole(this.user, this.activeBranch.name);
          }
        } catch { /* ignore */ }
      }
      try { await API.logOperatingEvent('open', this.user); } catch { /* ignore */ }
      if (!this.isPosKiosk()) {
        try { await API.ensureDemoNotificationSound(); } catch { /* ignore */ }
        this.initPanelNotify();
        this.startOperatingTimer();
        this.startOperatingHoursWatch();
        this.startNotificationSoundMonitor();
        this.startNotificationRefresh();
        this.startScheduledDocMonitor();
        this.loadNotifications();
        this.runDeferredStartup();
      }
      this.startAutoLogoutTimer();
      this.startSyncMonitor();
      this.startSessionMonitor();
      this.bindGlobalCatalogSync();
      try { window.PanelExitGuard?.bind?.(() => this.doLogout()); } catch (_) { /* ignore */ }
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

  async refreshBranchSwitcher() {
    const sel = document.getElementById('global-branch-filter');
    if (!sel) return;
    const isOwner = this.user?.role === 'owner';
    const wrap = sel.closest('.branch-switcher');
    if (!isOwner && this.user?.role !== 'manager') {
      wrap?.classList.add('hidden');
      return;
    }
    wrap?.classList.remove('hidden');
    try {
      const [brRes, viewRes] = await Promise.all([API.getBranches(), API.getViewBranch?.() || Promise.resolve({})]);
      const branches = brRes.data || [];
      const view = viewRes.data || {};
      const current = view.view_branch_id != null ? String(view.view_branch_id) : 'all';
      this.viewBranchId = view.view_branch_id != null ? Number(view.view_branch_id) : null;
      sel.innerHTML = `<option value="all">All branches</option>` +
        branches.map((b) => `<option value="${b.id}">${Utils.escHtml(b.name)} (${Utils.escHtml(b.code || '')})</option>`).join('');
      sel.value = current;
      if (this.user?.role === 'manager' && this.user.branch_id) {
        sel.value = String(this.user.branch_id);
        sel.disabled = true;
      } else {
        sel.disabled = false;
      }
    } catch (_) { /* ignore */ }
  },

  renderNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;
    const byId = (id) => this._navItemById(id);
    const canSee = (id) => {
      const item = byId(id);
      return !!(item && Utils.canAccessByRole(this.user, id));
    };

    // Auto-expand group that contains the active page
    const active = this.currentPage;
    (this.navGroups || []).forEach((g) => {
      if (g.type === 'group' && (g.items || []).includes(active)) this._setNavGroupOpen(g.id, true);
    });

    const placed = new Set();
    let html = '';
    for (const g of (this.navGroups || [])) {
      if (g.type === 'item') {
        if (!canSee(g.id)) continue;
        html += this._renderNavPageBtn(byId(g.id));
        placed.add(g.id);
        continue;
      }
      const kids = (g.items || []).map(byId).filter((it) => it && canSee(it.id));
      if (!kids.length) continue;
      kids.forEach((it) => placed.add(it.id));
      const open = this._isNavGroupOpen(g.id);
      html += `<div class="nav-group${open ? ' is-open' : ''}" data-nav-group="${g.id}">
        <button type="button" class="nav-btn nav-group-toggle" data-nav-group-toggle="${g.id}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="nav-group-label">${g.label}</span>
          <span class="nav-group-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
        </button>
        <div class="nav-group-items"${open ? '' : ' hidden'}>
          ${kids.map((it) => this._renderNavPageBtn(it)).join('')}
        </div>
      </div>`;
    }
    // Safety: any navItems not listed in groups still appear (no feature loss)
    for (const item of this.navItems) {
      if (placed.has(item.id)) continue;
      if (item.id === 'settings') continue; // footer
      if (!canSee(item.id)) continue;
      html += this._renderNavPageBtn(item);
    }

    nav.innerHTML = html;
    const setBtn = document.querySelector('.sidebar-footer [data-page="settings"]');
    if (setBtn) setBtn.classList.toggle('hidden', !Utils.canAccessByRole(this.user, 'settings'));

    // Mark active leaf
    nav.querySelectorAll('.nav-btn[data-page]').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === this.currentPage && !b.dataset.locked);
    });
  },

  async navigate(page) {
    if (page === 'recipe') {
      return this.openRecipeProduction({ fromApp: true });
    }
    const navT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // Immediate UI feedback ? never block navigation on session/network
    this.closeSidebar();
    if (!this.user) return;
    if (!Utils.canAccessByRole(this.user, page)) return;
    if (!Utils.canAccess(this.user, page)) {
      if (!Utils.isPageEntitled(page)) {
        await window.SaasFeatures?.loadCatalog?.();
        if (window.SaasFeatures?.openLockedPage) window.SaasFeatures.openLockedPage(page);
        else Utils.toast('FEATURE_NOT_INCLUDED: this page is not in your plan', 'error');
      }
      return;
    }
    if (!this._suppressHistory && this.currentPage && this.currentPage !== page) {
      this.navHistory.push(this.currentPage);
      if (this.navHistory.length > 40) this.navHistory.shift();
    }
    this.currentPage = page;
    document.body.classList.toggle('pos-till-active', page === 'pos');
    if (page !== 'pos') window.POSPage?.stopAdvertReminderMonitor?.();
    if (page === 'pos') this.ensureFeatureCss('css/pos-till.css').catch(() => {});
    const navGen = (this._navGen = (this._navGen || 0) + 1);
    if (page === 'admin' && !this.isPosKiosk?.()) {
      this.initPanelNotify();
      this.checkNotificationSounds().catch(() => {});
    }
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.page === page && !b.dataset.locked));
    // Keep the active page's far-left group expanded
    (this.navGroups || []).forEach((g) => {
      if (g.type === 'group' && (g.items || []).includes(page)) {
        this._setNavGroupOpen(g.id, true);
        const wrap = document.querySelector(`.nav-group[data-nav-group="${g.id}"]`);
        if (wrap) {
          wrap.classList.add('is-open');
          wrap.querySelector('.nav-group-items')?.classList.remove('hidden');
          const t = wrap.querySelector('[data-nav-group-toggle]');
          if (t) {
            t.setAttribute('aria-expanded', 'true');
            const c = t.querySelector('.nav-group-chevron');
            if (c) c.textContent = '▾';
          }
        }
      }
    });
    const titles = {
      dashboard: 'Dashboard', admin: 'Admin Panel', pos: 'Point of Sale', staff: 'Staff Portal', products: 'Products', categories: 'Categories',
      stock: 'Stock Management', customers: 'Customers', suppliers: 'Suppliers', expenses: 'Expenses',
      returns: 'Returns', quotes: 'Quotations', layby: 'Lay-Bye', giftcards: 'Gift Cards',
      'document-hub': 'Document Hub', whatsapp: 'WhatsApp',
      operations: 'Cash-Up & Operations', restaurant: 'Restaurant', recipe: 'Recipe & Production',
      'purchase-orders': 'Purchase Orders', reports: 'Reports', bookkeeping: 'Bookkeeping & Finance', users: 'User Management',
      audit: 'Audit Log', settings: 'Settings', features: 'Explore All Features'
    };
    document.getElementById('page-title').textContent = titles[page] || page;

    const content = document.getElementById('page-content');
    if (!content) return;
    content.dataset.page = page;

    // Keep page hosts in memory ? show previous DOM instantly on revisit
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
    const hostReady = page === 'pos'
      ? !!(host?.querySelector?.('.pos-layout'))
      : !!(host && host.childNodes.length);
    const reused = hostReady;
    if (!host) {
      host = document.createElement('div');
      host.className = 'page-host';
      host.dataset.page = page;
      hosts.appendChild(host);
    }
    host.hidden = false;
    host.classList.add('page-host-active');

    if (page === 'pos' && !host.querySelector('.pos-layout')) {
      host.innerHTML = '';
    }

    // Session check always in background ? never await on click
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
          if (!pageModule?.render) {
            host.innerHTML = '<p class="error-msg">POS module failed to load. Refresh the page.</p>';
            return;
          }
          if (page === 'pos' && !host.querySelector('.pos-layout')) {
            await pageModule.render(host, this);
          } else if (typeof pageModule.activate === 'function') {
            await pageModule.activate(host, this);
          } else {
            await pageModule.render(host, this);
          }
          if (page === 'pos') this.checkPosCatalogStamp();
          window.DataCache?.clearStaleBanner?.(host);
        } catch (err) {
          window.DataCache?.showStaleBanner?.(host, err?.message || 'Unable to refresh. Showing last updated data.');
        }
      })();
      return;
    }

    // First visit: skip skeleton when we can paint from cache (POS/admin/sidebar)
    const instantPages = new Set([
      'pos', 'admin', 'stock', 'customers', 'suppliers', 'expenses', 'quotes',
      'returns', 'layby', 'giftcards', 'whatsapp', 'categories'
    ]);
    const canPaintNow = instantPages.has(page)
      || (page === 'products' && !!(
        window.DataCache?.peek?.('products', [{ admin_list: true }])?.data?.length
        || Utils.sessionCacheGet?.('products_page')?.products?.length
        || window.__POS_WARM_CATALOG__?.products?.length
      ))
      || (page === 'dashboard' && !!(window.DataCache?.peek?.('dashboard', [Utils.monthStart?.(), Utils.today?.()])?.data));
    if (!canPaintNow) host.innerHTML = Utils.pageSkeleton();
    markVisible(false);
    content.dataset.loading = '1';

    try {
      await this.ensurePageScripts(page);
      if (navGen !== this._navGen) {
        content.dataset.loading = '0';
        return;
      }
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
      if (page === 'pos') this.checkPosCatalogStamp();
    } catch (err) {
      if (navGen !== this._navGen) {
        content.dataset.loading = '0';
        return;
      }
      host.innerHTML = `<p class="error-msg">${Utils.escHtml(err?.message || 'Page failed to load')}</p>`;
    }
    if (navGen !== this._navGen) {
      content.dataset.loading = '0';
      return;
    }
    content.dataset.loading = '0';
    this.schedulePrefetch(page);
    this._saveNavState();
  },

  /** Load last menu from session/IndexedDB into memory — sync, before POS opens. */
  warmPosCatalogCache(user = this.user) {
    if (!user || !window.Utils) return false;
    const branchId = user.branch_id != null ? Number(user.branch_id) : 0;
    const warm = window.__POS_WARM_CATALOG__;
    if (warm?.products?.length && Number(warm.branchId || 0) === branchId) return true;
    const snap = Utils.loadPosMenuSnapshot(user.branch_id);
    if (!snap?.products?.length) return false;
    window.__POS_WARM_CATALOG__ = {
      branchId,
      categories: snap.categories || [],
      products: snap.products,
      combos: snap.combos || [],
      at: Date.now()
    };
    return true;
  },

  /** Warm POS categories/products/combos so the till menu paints instantly. */
  prefetchPosCatalog(user = this.user) {
    if (!window.API || !user) return;
    this.warmPosCatalogCache(user);
    const filters = { for_pos: true, actor: user };
    const branchId = user.branch_id != null ? Number(user.branch_id) : undefined;
    const comboArgs = branchId ? { branch_id: branchId, for_pos: true } : { for_pos: true };
    try {
      this.ensurePageScripts('pos').catch(() => {});
      Promise.all([
        API.getCategories(filters),
        API.getProducts(filters),
        API.getActiveCombos(comboArgs).catch(() => ({ success: false, data: [] }))
      ]).then(([catRes, prodRes, comboRes]) => {
        window.POSPage?.persistMenuSnapshot?.(branchId, catRes, prodRes, comboRes);
      }).catch(async () => {
        const snap = await window.OfflineStore?.loadCatalog?.(branchId);
        if (snap?.products?.length) {
          window.POSPage?.persistMenuSnapshot?.(branchId, { data: snap.categories }, { data: snap.products }, { data: snap.combos });
        }
      });
    } catch (_) { /* ignore */ }
  },

  /** Warm likely next-page reads without flooding the network. */
  schedulePrefetch(page) {
    clearTimeout(this._prefetchTimer);
    const delay = page === 'pos' ? 0 : 350;
    this._prefetchTimer = setTimeout(() => {
      if (!window.API || !this.user) return;
      const from = Utils.monthStart?.() || new Date().toISOString().slice(0, 10);
      const to = Utils.today?.() || new Date().toISOString().slice(0, 10);
      const tasks = [];
      if (page === 'dashboard') {
        tasks.push(() => API.getCategories({ for_pos: true }));
        tasks.push(() => API.getProducts({ for_pos: true }));
        tasks.push(() => API.getSalesReport(from, to));
        this.ensurePageScripts('pos').catch(() => {});
        this.ensurePageScripts('products').catch(() => {});
      }
      if (page === 'products') {
        tasks.push(() => API.getProducts({ admin_list: true }));
        tasks.push(() => API.getCategories({}));
        tasks.push(() => API.getSuppliers());
      }
      if (page === 'stock') {
        tasks.push(() => API.getStockReport());
      }
      if (page === 'admin') {
        tasks.push(() => API.getAdminDashboard(from, to));
        tasks.push(() => API.getCategories({}));
        tasks.push(() => API.getProducts({ admin_list: true }));
        ['stock', 'customers', 'suppliers', 'expenses', 'quotes', 'returns', 'layby', 'giftcards', 'whatsapp']
          .forEach((p) => this.ensurePageScripts(p).catch(() => {}));
      }
      if (page === 'dashboard' || page === 'stock' || page === 'customers') {
        tasks.push(() => API.getSuppliers());
        tasks.push(() => API.getCustomers(''));
        tasks.push(() => API.getQuotes({ limit: 200 }));
        ['suppliers', 'expenses', 'quotes', 'returns', 'layby', 'giftcards', 'whatsapp']
          .forEach((p) => this.ensurePageScripts(p).catch(() => {}));
      }
      if (page === 'suppliers') tasks.push(() => API.getSuppliers());
      if (page === 'quotes') tasks.push(() => API.getQuotes({ limit: 200 }));
      if (page === 'layby') tasks.push(() => API.getLaybyes({ from: Utils.daysAgo?.(90), to }));
      if (page === 'giftcards') tasks.push(() => API.getGiftCards({ from: Utils.daysAgo?.(90), to, limit: 500 }));
      if (page === 'expenses') tasks.push(() => API.getExpenseCategories());
      if (page === 'whatsapp') tasks.push(() => API.getWhatsAppTemplates({}));
      const maxTasks = page === 'admin' ? 4 : 4;
      tasks.slice(0, maxTasks).forEach((fn, i) => {
        setTimeout(() => {
          try { fn()?.catch?.(() => {}); } catch { /* ignore */ }
        }, i * 120);
      });
    }, delay);
  },

  clearPageHosts() {
    const content = document.getElementById('page-content');
    if (content) content.innerHTML = '';
    try { window.DataCache?.invalidate?.(); } catch { /* ignore */ }
  },

  logout() {
    Utils.showModal('Sign out', `
      <p>You will return to the sign-in screen. Any unsaved work on this page may be lost.</p>`,
      `<button class="btn btn-ghost" id="logout-cancel">Stay signed in</button>
       <button class="btn btn-danger" id="logout-confirm">Sign out</button>`);
    document.getElementById('logout-cancel')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('logout-confirm')?.addEventListener('click', () => {
      Utils.hideModal();
      this.doLogout();
    });
  },


  async showPosBranchErrorModal(message) {
    return new Promise((resolve) => {
      Utils.showModal('Wrong branch', `
        <p style="margin:0 0 12px;font-size:16px">Oops — you've chosen the wrong branch, or you are not assigned here.</p>
        <p class="muted" style="margin:0">${Utils.escHtml(message || '')}</p>`,
      '<button class="btn btn-primary" id="pos-branch-err-ok">OK</button>');
      document.getElementById('pos-branch-err-ok')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve();
      });
    });
  },

  async showPosWelcomeSuccessModal(user, branchName) {
    const shop = this.settings?.shop_name || 'Shop POS';
    return new Promise((resolve) => {
      Utils.showModal('Welcome to POS', `
        <div style="text-align:center;padding:8px 0">
          <div style="font-size:48px;margin-bottom:12px">✓</div>
          <p style="margin:0 0 8px;font-size:17px;font-weight:600">You have successfully entered the POS</p>
          <p style="margin:0 0 6px">Welcome, <strong>${Utils.escHtml(user?.full_name || user?.username || 'Cashier')}</strong></p>
          <p class="muted" style="margin:0">${Utils.escHtml(shop)} · ${Utils.escHtml(branchName || 'Branch')}</p>
        </div>`,
      '<button class="btn btn-primary btn-lg" id="pos-welcome-ok" style="min-width:160px">Open POS</button>');
      document.getElementById('pos-welcome-ok')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve();
      });
    });
  },

  async showPosWelcome() {
    this.showScreen('pos-welcome');
    const nameEl = document.getElementById('pos-welcome-cashier');
    const branchSel = document.getElementById('pos-welcome-branch');
    const tillNote = document.getElementById('pos-welcome-till-note');
    const errEl = document.getElementById('pos-welcome-error');
    if (nameEl) nameEl.textContent = this.user?.full_name || this.user?.username || 'Cashier';
    try {
      const [brRes, tillRes] = await Promise.all([API.getBranches(), API.getViewBranch?.().catch(() => API.getActiveBranch())]);
      const branches = brRes?.data || brRes || [];
      const till = tillRes?.data?.till_branch || tillRes?.data || tillRes || {};
      const tillId = Number(till?.id || till?.till_branch_id || 1);
      if (branchSel) {
        branchSel.innerHTML = branches.map((b) => `<option value="${b.id}">${Utils.escHtml(b.name)}</option>`).join('');
        branchSel.value = String(tillId);
        const canChange = ['owner', 'manager'].includes(this.user?.role);
        branchSel.disabled = !canChange;
        document.getElementById('pos-welcome-branch-wrap')?.classList.toggle('hidden', branches.length <= 1 && !canChange);
      }
      if (tillNote) tillNote.textContent = `This computer is connected to: ${till?.name || 'Main branch'}`;
    } catch (_) { /* offline */ }
    document.getElementById('pos-welcome-logout')?.addEventListener('click', () => this.doLogout(), { once: true });
    document.getElementById('pos-welcome-continue')?.addEventListener('click', async () => {
      errEl?.classList.add('hidden');
      const branchId = Number(branchSel?.value || 0);
      if (branchId && ['owner', 'manager'].includes(this.user?.role)) {
        try { await API.setActiveBranch(branchId, this.user); } catch (_) { /* optional */ }
      }
      const tillRes = await API.getActiveBranch().catch(() => null);
      const tillId = Number(tillRes?.data?.id || tillRes?.id || branchId || 1);
      const userBranch = this.user?.branch_id != null ? Number(this.user.branch_id) : null;
      const restricted = ['cashier', 'supervisor', 'assistant_manager'].includes(this.user?.role);
      let branchLabel = tillRes?.data?.name || 'Branch';
      if (restricted && branchId && userBranch && userBranch !== branchId) {
        try {
          const brRes = await API.getBranches();
          const branches = brRes?.data || brRes || [];
          branchLabel = branches.find((b) => Number(b.id) === branchId)?.name || branchLabel;
        } catch (_) { /* ignore */ }
        await this.showPosBranchErrorModal(
          `Oops — you chose ${branchLabel}, but your account is not assigned to that branch.`
        );
        return;
      }
      if (restricted && userBranch && userBranch !== tillId) {
        await this.showPosBranchErrorModal('This till is connected to a different branch than your account.');
        return;
      }
      if (userBranch && userBranch !== tillId && ['owner', 'manager'].includes(this.user?.role)) {
        const tillName = tillRes?.data?.name || 'this branch';
        const ok = confirm(`Your account belongs to a different branch than this till (${tillName}). Continue anyway?`);
        if (!ok) return;
      }
      try { sessionStorage.setItem('pos_welcome_done', '1'); } catch (_) { /* ignore */ }
      await this.showPosWelcomeSuccessModal(this.user, branchLabel);
      await this.enterApp({ skipPosWelcome: true, restored: false });
    }, { once: true });
  },
  async populateLoginBranchPicker() {
    const wrap = document.getElementById('login-branch-wrap');
    const sel = document.getElementById('login-branch');
    if (!wrap || !sel || !this.isPosKiosk()) return;

    let branches = [];
    try {
      const res = await API.getBranches();
      if (Array.isArray(res?.data)) branches = res.data;
      else if (Array.isArray(res)) branches = res;
    } catch (_) { /* offline — use fallback below */ }

    if (!branches.length) {
      branches = [{ id: 1, name: 'Main Branch' }];
    }

    sel.innerHTML = branches.map((b) => {
      const id = Number(b.id);
      return `<option value="${id}">${Utils.escHtml(b.name || 'Branch')}</option>`;
    }).join('');

    let picked = '';
    try {
      const active = await API.getActiveBranch().catch(() => null);
      const activeId = active?.data?.id ?? active?.id;
      if (activeId != null && activeId !== '') picked = String(activeId);
    } catch (_) { /* ignore */ }

    if (picked && [...sel.options].some((o) => o.value === picked)) sel.value = picked;
    else if (sel.options.length) sel.selectedIndex = 0;

    const multi = branches.length > 1;
    sel.required = multi;
    wrap.classList.toggle('hidden', !multi);
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
    this.stopOperatingHoursWatch();
    this.stopAutoLogoutTimer();
    this.stopNotificationSoundMonitor();
    this.stopSyncMonitor();
    this.stopSessionMonitor();
    this.stopNotificationRefresh();
    this.stopScheduledDocMonitor();
    SoundService?.stopAlert();
    window.PanelNotify?.onLogout();
    window.PanelNotifyHub?.stop('admin');
    window.PanelNotifyHub?.stop('delivery');
    Utils.forceHideModal();
    try { window.PanelExitGuard?.unbind?.(); } catch (_) { /* ignore */ }
    try { sessionStorage.removeItem('pos_welcome_done'); } catch (_) { /* ignore */ }
    this.clearPageHosts();
    this._clearNavState();
    this.user = null;
    try {
      if (this.appMode() === 'admin') sessionStorage.removeItem('admin_portal_session');
      sessionStorage.removeItem('shoppos_rpc_session');
    } catch (_) { /* ignore */ }
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-pin').value = '';
    document.getElementById('login-error')?.classList.add('hidden');
    document.getElementById('operating-banner')?.classList.add('hidden');
    if (this.appMode() === 'referral') {
      this.openReferralAgent({ fromLogin: true, view: 'gate' }).catch(() => this.showScreen('login'));
      return;
    }
    this.showScreen('login');
    if (this.appMode() === 'referral-commission') {
      const loginSub = document.getElementById('login-sub');
      if (loginSub) {
        loginSub.textContent = 'Referral & Commission — sign in with owner, manager or supervisor credentials. This is not the full Admin app.';
      }
    }
    this.startLoginOperatingTimer();
    requestAnimationFrame(() => {
      const userEl = document.getElementById('login-username');
      userEl?.removeAttribute('readonly');
      userEl?.focus();
    });
  },

  getShopTimezone() {
    return String(this.settings?.shop_timezone || this.settings?.timezone || 'Africa/Johannesburg').trim() || 'Africa/Johannesburg';
  },

  shopNowUtcMs() {
    const tz = this.getShopTimezone();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date());
    const v = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  },

  shopDayOfWeek() {
    return new Date(this.shopNowUtcMs()).getUTCDay();
  },

  getTodayOperatingHours() {
    const oh = this.getOperatingSettings();
    const weekly = oh.weekly;
    if (weekly?.length) {
      const dayNum = this.shopDayOfWeek();
      const day = weekly.find(d => Number(d.day) === dayNum) || weekly[dayNum];
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
    const tz = this.getShopTimezone();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour12: false
    }).formatToParts(new Date());
    const v = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    const [h, m] = (timeStr || '18:00').split(':').map(Number);
    const shopLocalMs = Date.UTC(v('year'), v('month') - 1, v('day'), h, m || 0, 0);
    const offset = Date.now() - this.shopNowUtcMs();
    return new Date(shopLocalMs + offset);
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
    banner.classList.remove('hidden');
    if (!oh.enabled && oh.force_pos !== 'closed' && oh.force_pos !== 'open') {
      /* still tick so after-hours / force alerts can show */
    }
    this._closeAlertShown = false;
    this._operatingTick = () => this.updateOperatingBanner();
    this._operatingTick();
    this._operatingInterval = setInterval(this._operatingTick, 1000);
  },

  stopOperatingTimer() {
    if (this._operatingInterval) clearInterval(this._operatingInterval);
    this._operatingInterval = null;
  },

  applyOperatingHours(oh) {
    if (!oh || typeof oh !== 'object') return;
    this.settings = { ...(this.settings || {}), operating_hours_settings: { ...(this.settings?.operating_hours_settings || {}), ...oh } };
    this.updateOperatingBanner();
  },

  startOperatingHoursWatch() {
    if (this._hoursWatch) return;
    this.bindHoursBroadcast();
    const tick = async () => {
      try {
        const res = await API.getOperatingHours();
        const oh = res?.success === false ? null : (res?.data || res);
        if (oh) this.applyOperatingHours(oh);
      } catch (_) { /* keep last hours */ }
    };
    this._hoursWatch = setInterval(tick, 2000);
    tick();
  },

  stopOperatingHoursWatch() {
    if (this._hoursWatch) clearInterval(this._hoursWatch);
    this._hoursWatch = null;
    try { this._hoursBc?.close(); } catch (_) { /* */ }
    this._hoursBc = null;
  },

  bindHoursBroadcast() {
    if (this._hoursBc) return;
    try {
      this._hoursBc = new BroadcastChannel('shop-pos-hours');
      this._hoursBc.onmessage = (ev) => {
        if (ev.data) this.applyOperatingHours(ev.data);
      };
    } catch (_) { /* */ }
  },

  startLoginOperatingTimer() {
    this.stopLoginOperatingTimer();
    const el = document.getElementById('login-operating-timer');
    if (!el) return;
    const mode = this.appMode();
    // Dedicated portals / admin must always allow typing & sign-in regardless of shop hours
    if (mode === 'admin' || mode === 'staff' || mode === 'mgr-hr' || mode === 'referral' || mode === 'referral-commission' || mode === 'accounting' || mode === 'hr') {
      el.classList.add('hidden');
      this._ensureLoginFieldsEditable();
      return;
    }
    el.classList.remove('hidden');
    this._loginOperatingTick = () => this.updateLoginOperatingTimer();
    this._loginOperatingTick();
    this._loginOperatingInterval = setInterval(this._loginOperatingTick, 1000);
    this._ensureLoginFieldsEditable();
  },

  /** Shop hours must never block typing on the login form. */
  _ensureLoginFieldsEditable() {
    ['login-username', 'login-password', 'login-pin'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.removeAttribute('readonly');
      el.removeAttribute('disabled');
      el.style.pointerEvents = 'auto';
    });
  },

  stopLoginOperatingTimer() {
    if (this._loginOperatingInterval) clearInterval(this._loginOperatingInterval);
    this._loginOperatingInterval = null;
  },

  updateLoginOperatingTimer() {
    const el = document.getElementById('login-operating-timer');
    const label = document.getElementById('login-operating-text');
    if (!el || !label) return;
    this._ensureLoginFieldsEditable();
    const oh = this.getTodayOperatingHours();
    // Admin override: keep all panel logins available outside hours
    if (oh.force_login === 'open' || oh.force_pos === 'open') {
      label.textContent = 'Admin override — logins stay open (shop hours do not block sign-in).';
      el.classList.remove('hidden');
      return;
    }
    const hasSchedule = oh.open_time && oh.close_time;
    if (!oh.enabled && !hasSchedule) {
      label.textContent = 'Operating hours not configured — set in Admin → Operating Hours';
      el.classList.remove('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (oh.closed_today) {
      label.textContent = 'Shop is closed today per weekly schedule. You can still type and sign in.';
      return;
    }
    const openTime = oh.open_time || '08:00';
    const closeTime = oh.close_time || '18:00';
    const now = new Date();
    const openAt = this.parseTimeToday(openTime);
    const closeAt = this.parseTimeToday(closeTime);
    if (now < openAt) {
      label.textContent = `Opens at ${openTime} · ${this.formatCountdown(openAt - now)} until open — you can still type and sign in`;
    } else if (now >= closeAt) {
      label.textContent = `Closed · was open until ${closeTime} — you can still type and sign in`;
    } else {
      label.textContent = `Open until ${closeTime} · ${this.formatCountdown(closeAt - now)} remaining`;
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
        Utils.toast('Session timed out ? please sign in again', 'error');
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
    if (!this.user) {
      banner.classList.add('hidden');
      return;
    }
    if (oh.force_pos === 'open') {
      banner.classList.remove('hidden');
      banner.className = 'operating-banner';
      label.textContent = 'POS is forced open — tills can sell now.';
      this._closeAlertShown = false;
      return;
    }
    if (oh.closed_today) {
      banner.classList.remove('hidden');
      banner.className = 'operating-banner operating-banner--closed';
      label.textContent = 'The shop is scheduled closed today. POS stays open so you can still sell — please wrap up when you can.';
      return;
    }
    banner.classList.remove('hidden');
    const closeAt = this.parseTimeToday(oh.close_time);
    const diff = closeAt - new Date();
    const warnMins = oh.warn_minutes || 15;

    if (oh.force_pos === 'closed' || diff <= 0) {
      banner.className = 'operating-banner operating-banner--closed';
      const closeLabel = oh.close_time || 'closing time';
      label.textContent = oh.force_pos === 'closed'
        ? `Admin closing alert is on. Scheduled close is ${closeLabel}. You can still sell — please wrap up when you can.`
        : `You are supposed to be closed by ${closeLabel}. POS remains open so you can finish sales. Please wrap up and log out when ready.`;
      if (oh.alert_at_close && !this._closeAlertShown) {
        this._closeAlertShown = true;
        Utils.toast(`You are supposed to be closed by ${closeLabel}. You can still sell — please wrap up when ready.`, 'error');
        SoundService?.startAlert(this.settings);
        if (this.user.role === 'cashier') {
          Utils.showModal('Closing time reminder',
            `<p>Trading hours ended at <strong>${closeLabel}</strong>. The till stays open so you can finish customers. Please complete open sales and log out when you are done.</p>`,
            '<button class="btn btn-primary" id="close-time-ok">OK</button>');
          document.getElementById('close-time-ok')?.addEventListener('click', () => {
            Utils.hideModal();
            SoundService?.stopAlert();
          });
        }
      }
      return;
    }

    if (!oh.enabled) {
      banner.classList.add('hidden');
      return;
    }
    banner.className = 'operating-banner' + (diff / 60000 <= warnMins ? ' operating-banner--warn' : '');
    label.textContent = `Closes at ${oh.close_time} ? ${this.formatCountdown(diff)} remaining`;
  },

  _portalFeatureEnabled(feature) {
    const ps = this.settings?.staff_portal_settings || {};
    if (feature === 'routines') return ps.show_routines !== false;
    if (feature === 'morning_routines') return ps.show_routines !== false && ps.show_morning_routines !== false;
    if (feature === 'closing_routines') return ps.show_routines !== false && ps.show_closing_routines !== false;
    if (feature === 'shifts') return ps.show_shifts !== false;
    return true;
  },

  stopAllNotificationSounds() {
    window.SoundService?.stopAlert();
    window.PanelSound?.stop();
  },

  /** Sound scope matches the default Today filter — older unread alerts stay in the list but do not ring. */
  alertQualifiesForSound(createdAt) {
    return this._isNotifToday(createdAt);
  },

  async checkNotificationSounds(fromCache) {
    if (this.isPosKiosk()) {
      this.stopAllNotificationSounds();
      return;
    }
    if (!this.user || !['owner', 'manager', 'supervisor', 'assistant_manager'].includes(this.user.role)) {
      this.stopAllNotificationSounds();
      window.PanelNotify?.onLogout();
      return;
    }
    if (window.PanelNotifyHub) {
      await PanelNotifyHub.pollAdmin(this);
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
      this.stopAllNotificationSounds();
    }
  },

  _dismissAdminAlertFlash() {
    document.getElementById('admin-alert-flash')?.remove();
  },

  _flashAdminAlert(n) {
    if (!n) return;
    let bar = document.getElementById('admin-alert-flash');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'admin-alert-flash';
      bar.style.cssText = 'position:fixed;top:12px;right:12px;z-index:10050;max-width:min(420px,calc(100vw - 24px));background:#111827;color:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 12px 32px rgba(0,0,0,.35);';
      document.body.appendChild(bar);
    }
    const title = Utils.escHtml(n.title || 'New notification');
    const msg = Utils.escHtml(n.message || n.body || '');
    bar.innerHTML = `<div style="font-weight:700;margin-bottom:4px">${title}</div>
      ${msg ? `<div style="font-size:13px;opacity:.9">${msg}</div>` : ''}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-sm btn-primary" id="admin-alert-open">Open</button>
        <button type="button" class="btn btn-sm btn-ghost" id="admin-alert-dismiss" style="color:#fff">Dismiss</button>
      </div>`;
    bar.hidden = false;
    bar.querySelector('#admin-alert-dismiss')?.addEventListener('click', () => this._dismissAdminAlertFlash());
    bar.querySelector('#admin-alert-open')?.addEventListener('click', () => {
      this._dismissAdminAlertFlash();
      this.showNotifications?.('alerts');
    });
  },

  async pollNotifications(force = false) {
    if (this.isPosKiosk()) return;
    if (!this.user) return;
    try {
      this._seenAdminAlertIds = this._seenAdminAlertIds || new Set();
      const hadSeen = this._seenAdminAlertIds.size > 0;
      const buckets = await this.fetchNotificationBuckets(force);
      const fresh = (buckets.alerts || []).filter((n) => !this._seenAdminAlertIds.has(String(n.id)));
      (buckets.alerts || []).forEach((n) => this._seenAdminAlertIds.add(String(n.id)));
      if (hadSeen && fresh.length) {
        const first = fresh[0];
        this._flashAdminAlert(first);
        if (document.hidden) {
          PanelNotify?.notifyBrowser(first.title || 'New notification', first.message || first.body, `admin-${first.id}`);
        }
      }
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
      if (this.user?.role === 'owner' || this.user?.role === 'manager' || this.user?.role === 'supervisor' || this.user?.role === 'assistant_manager') {
        await this.checkNotificationSounds(true);
      }
    } catch { /* offline */ }
  },

  startNotificationSoundMonitor() {
    this.stopNotificationSoundMonitor();
    if (!this.user || !['owner', 'manager'].includes(this.user.role)) return;
    // Sound is driven by pollNotifications ? no separate interval
  },

  stopNotificationSoundMonitor() {
    if (this._notifSoundInterval) clearInterval(this._notifSoundInterval);
    this._notifSoundInterval = null;
  },

  async runBackgroundSync() {
    if (!this.user) return;
    try {
      if (window.ShopPosCloudBridge?.pullOnlineOrders) {
        await window.ShopPosCloudBridge.pullOnlineOrders(this.user);
      } else if (API.syncNow) {
        await API.syncNow();
      }
      if (window.ShopPosCloudBridge?.heartbeat) {
        await window.ShopPosCloudBridge.heartbeat(this.user);
      } else if (API.posHeartbeat) {
        const branchId = await API.getTillBranchId?.().catch(() => null) || 1;
        const ds = Utils.mergeDeviceSettings?.(this.settings) || {};
        await API.posHeartbeat(branchId, Utils.getDeviceId?.() || 'pos', ds.device_name || 'POS Till');
      }
    } catch (_) { /* offline or sync paused */ }
  },

  startNotificationRefresh() {
    this.stopNotificationRefresh();
    if (!this.user) return;
    this.pollNotifications(true);
    this._notifRefreshInterval = setInterval(() => this.pollNotifications(false), 4000);
  },

  stopNotificationRefresh() {
    if (this._notifRefreshInterval) clearInterval(this._notifRefreshInterval);
    this._notifRefreshInterval = null;
  },

  startSessionMonitor() {
    this.stopSessionMonitor();
    if (!this.user?.id) return;
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || Utils.isNative?.());
    // Android: less frequent ? avoid freezing taps every 15s
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
        Utils.toast(v.data?.error || 'Account deactivated ? system access is frozen.', 'error');
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
    if (sectionId === 'hrcontracts' && tabId && window.AdminHrPage) {
      AdminHrPage.tab = tabId;
    }
    if (sectionId === 'loyalty' && tabId && window.AdminPage) {
      AdminPage._loyaltyTab = tabId;
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
    }, 50);
  },

  navigateToBookkeepingTab(tabId) {
    if (window.BookkeepingPage) BookkeepingPage.tab = tabId || 'dashboard';
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
    // Cashier: POS + staff-portal checklist only ? never admin/ops/bookkeeping panels
    if (role === 'cashier') {
      if (page.startsWith('admin:') || page.startsWith('operations:') || page.startsWith('bookkeeping')
        || page.startsWith('stock:') || page.includes('inventory')) return false;
      if (['low_stock', 'out_of_stock', 'reorder', 'payroll_due', 'uif', 'paye', 'sdl', 'coida',
        'cashout', 'cashup', 'target_met', 'target_missed', 'cashout_penalty', 'stock_count',
        'salary_claim', 'recruitment', 'document_share'].some(x => t === x || t.startsWith(x))) return false;
      if (t.startsWith('recruitment') || t.startsWith('owner_salary') || t.startsWith('probation_')) return false;
      return page === 'pos' || page === 'staff' || page === ''
        || ['checklist_reminder', 'checklist_overdue', 'compliance', 'pos_alert', 'held_order', 'kitchen', 'order_ready', 'online_order', 'test'].includes(t);
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

  notificationDestinationLabel(n) {
    const page = String(n?.action_page || '').toLowerCase();
    const t = String(n?.type || '').toLowerCase();
    const kind = String(n?.kind || '').toLowerCase();
    if (page.startsWith('loyalty:whatsapp:')) return 'Loyalty WhatsApp reminder';
    if (page === 'admin:loyalty' || t.startsWith('loyalty')) return 'Admin → Loyalty';
    if (page.startsWith('document-hub:share:')) return 'Document Hub → Share';
    if (page.startsWith('operations:cashup') || ['cashout', 'cashup', 'target_met', 'target_missed', 'cash_drop', 'cashout_penalty'].includes(t)) {
      return 'Operations → Cash-Up';
    }
    if (page.startsWith('operations:stockcount') || t === 'stock_count') return 'Operations → Stock Count';
    if (page === 'operations:non-selling' || page === 'stock:nonselling') return 'Stock → Non-selling';
    if (page.startsWith('stock:inventory') || ['low_stock', 'out_of_stock', 'reorder'].includes(t)) return 'Admin → Inventory';
    if (page === 'admin:taken-orders' || t.includes('taken')) return 'Admin → Taken / Unpaid Orders';
    if (page === 'admin:delivery-dept' || t.includes('delivery')) return 'Admin → Deliveries';
    if (page === 'admin:referral-dept' || t === 'referral') return 'Admin → Referral & Commission';
    if (page === 'admin:hr-approvals' || t === 'hr_approval') return 'Admin → HR Approvals';
    if (page === 'admin:online-orders' || t === 'online_order') return 'POS → Online orders';
    if (page === 'admin:payroll' || page === 'staffhr:payroll' || ['payroll_due', 'uif', 'paye', 'sdl', 'coida', 'salary_claim', 'salary_advice'].includes(t)) {
      return 'Admin → Payroll';
    }
    if (page === 'staffhr:attendance' || t.startsWith('attendance')) return 'Admin → Staff & HR → Attendance';
    if (page.includes('recruitment') || t.startsWith('recruitment')) return 'Admin → Recruitment';
    if (page.startsWith('admin:combos') || t.includes('promo') || t.includes('combo')) return 'Admin → Combos & Promos';
    if (page === 'admin:approvals' || kind === 'pending') return 'Admin → Settings Approvals';
    if (page === 'admin:opscompliance' || ['compliance', 'checklist_reminder', 'checklist_overdue'].includes(t)) {
      return 'Admin → Operations & Compliance';
    }
    if (page === 'pos' || t === 'online_order' || t === 'held_order' || t === 'kitchen' || t === 'order_ready') return 'Point of Sale';
    if (page === 'staff') return 'Staff Portal';
    if (page.startsWith('bookkeeping') || ['low_cash', 'ar', 'ap', 'budget', 'donation'].includes(t)) return 'Bookkeeping';
    if (page.startsWith('admin:')) {
      const section = page.split(':')[1] || '';
      return section ? `Admin → ${section.replace(/-/g, ' ')}` : 'Admin';
    }
    if (kind === 'pending') return 'Admin → Approvals';
    return 'Open related screen';
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

    if (page.startsWith('loyalty:whatsapp:')) {
      if (!canAdmin()) return refuse();
      const parts = page.split(':');
      const customerId = parseInt(parts[2], 10);
      const lotId = parseInt(parts[3], 10);
      if (!customerId) return refuse('Invalid loyalty reminder');
      (async () => {
        try {
          const payload = await API.getLoyaltyReminderWhatsApp(customerId, lotId || null);
          const p = payload?.data ?? payload;
          if (!p?.phone) return Utils.toast('Customer has no phone number', 'error');
          const wa = await API.sendWhatsAppMessage({
            phone: p.phone,
            body: p.message,
            message_type: 'loyalty_reminder',
            customer_id: customerId,
            recipient_type: 'customer'
          }, this.user);
          await Utils.deliverWhatsApp(wa, p.phone, p.message);
          if (lotId) await API.markLoyaltyReminderSent(lotId, this.user);
          Utils.toast('WhatsApp opened with reminder message', 'success');
        } catch (err) {
          Utils.toast(err.message || 'Could not open WhatsApp reminder', 'error');
        }
      })();
      return;
    }
    if (page === 'admin:loyalty' || t === 'loyalty_reminder' || t === 'loyalty_reminder_summary') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('loyalty', 'reminders');
      return;
    }
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
    if (page === 'admin:taken-orders') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('taken-orders');
      return;
    }
    if (page === 'admin:delivery-dept') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('delivery-dept');
      return;
    }
    if (page === 'admin:referral-dept' || t === 'referral') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('referral-dept');
      return;
    }
    if (page === 'admin:hr-approvals' || t === 'hr_approval') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('hr-approvals');
      return;
    }
    if (page === 'admin:online-orders') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('online-orders');
      return;
    }
    if (page === 'staffhr:payroll') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('payroll');
      return;
    }
    if (page.startsWith('stock:inventory') || page === 'stock:inventory') {
      if (canAdmin()) {
        this.navigateToAdminSection('inventory');
        return;
      }
      if (!canPage('stock')) return refuse();
      this.navigateToStockTab('inventory');
      return;
    }
    if (page === 'operations:non-selling' || page === 'stock:nonselling') {
      if (!canPage('stock')) return refuse();
      this.navigateToStockTab('nonselling');
      return;
    }
    if (page === 'pos' || t === 'online_order') {
      this.navigate('pos');
      return;
    }
    // Any other admin:section[:tab] deep link
    if (page.startsWith('admin:') && page.split(':').length >= 2) {
      if (!canAdmin()) return refuse();
      const parts = page.split(':');
      const section = parts[1];
      const tab = parts[2] || null;
      if (section) {
        this.navigateToAdminSection(section, tab);
        return;
      }
    }
    if (kind === 'pending') {
      if (!canAdmin()) return refuse();
      this.navigateToAdminSection('approvals');
      return;
    }
    const inventory = ['low_stock', 'out_of_stock', 'reorder'];
    const payroll = ['payroll_due', 'uif', 'paye', 'sdl', 'coida', 'cert', 'salary', 'salary_claim', 'salary_advice'];
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
    // Never block UI ? sync after first paint; longer interval on Android
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
      '<p class="muted" style="padding:8px;font-size:12px">Searching?</p></div>';
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
        `<div class="search-item" data-action="setting" data-section="${s.id}">Admin ? ${s.label}</div>`).join('');
      html += '</div>';
    }

    if (data.products?.length && (Utils.canAccess(user, 'products') || Utils.canAccess(user, 'pos'))) {
      html += '<div class="search-group"><h4>Products</h4>' +
        data.products.map(p => `<div class="search-item" data-action="product" data-id="${p.id}">${p.name} ? ${Utils.formatMoney(p.selling_price, currency)}</div>`).join('') + '</div>';
    }
    if (data.categories?.length && Utils.canAccess(user, 'categories')) {
      html += '<div class="search-group"><h4>Categories</h4>' +
        data.categories.map(c => `<div class="search-item" data-action="page" data-page="categories">${c.name}</div>`).join('') + '</div>';
    }
    if (data.employees?.length && (Utils.canAccess(user, 'staff') || canAdmin)) {
      html += '<div class="search-group"><h4>Employees</h4>' +
        data.employees.map(e => `<div class="search-item" data-action="employee">${e.full_name}${e.employee_code ? ` (${e.employee_code})` : ''}${e.position ? ` ? ${e.position}` : ''}</div>`).join('') + '</div>';
    }
    if (data.combos?.length && (Utils.canAccess(user, 'pos') || (canAdmin && Utils.canAccessAdminSection(user, 'combos')))) {
      html += '<div class="search-group"><h4>Combos</h4>' +
        data.combos.map(c => `<div class="search-item" data-action="combo">${c.name} ? ${Utils.formatMoney(c.selling_price, currency)}</div>`).join('') + '</div>';
    }
    if (data.giftcards?.length && Utils.canAccess(user, 'giftcards')) {
      html += '<div class="search-group"><h4>Gift Cards</h4>' +
        data.giftcards.map(g => `<div class="search-item" data-action="page" data-page="giftcards"><code>${g.code}</code> ? ${g.customer_name || '?'} ? ${Utils.formatMoney(g.balance, currency)}</div>`).join('') + '</div>';
    }
    if (data.laybyes?.length && Utils.canAccess(user, 'layby')) {
      html += '<div class="search-group"><h4>Lay-Bye</h4>' +
        data.laybyes.map(l => `<div class="search-item" data-action="page" data-page="layby">${l.layby_number || 'Layby'} ? ${l.customer_name || '?'} ? ${l.status}</div>`).join('') + '</div>';
    }
    if (data.quotes?.length && Utils.canAccess(user, 'quotes')) {
      html += '<div class="search-group"><h4>Quotations</h4>' +
        data.quotes.map(qt => `<div class="search-item" data-action="page" data-page="quotes">${qt.quote_number} ? ${Utils.formatMoney(qt.total, currency)}</div>`).join('') + '</div>';
    }
    if (data.expenses?.length && Utils.canAccess(user, 'expenses')) {
      html += '<div class="search-group"><h4>Expenses</h4>' +
        data.expenses.map(e => `<div class="search-item" data-action="page" data-page="expenses">${e.description} ? ${Utils.formatMoney(e.amount, currency)}</div>`).join('') + '</div>';
    }
    if (data.donations?.length && Utils.canAccess(user, 'bookkeeping')) {
      html += '<div class="search-group"><h4>Donations</h4>' +
        data.donations.map(d => `<div class="search-item" data-action="donation">${d.donation_number || 'Donation'} ? ${d.recipient_org || 'Unknown'}</div>`).join('') + '</div>';
    }
    if (data.customers?.length && Utils.canAccess(user, 'customers')) {
      html += '<div class="search-group"><h4>Customers</h4>' +
        data.customers.map(c => `<div class="search-item" data-action="customer" data-id="${c.id}">${c.name} ? ${c.phone || ''}</div>`).join('') + '</div>';
    }
    if (data.suppliers?.length && Utils.canAccess(user, 'suppliers')) {
      html += '<div class="search-group"><h4>Suppliers</h4>' +
        data.suppliers.map(s => `<div class="search-item" data-action="supplier">${s.name}${s.phone ? ` ? ${s.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.receipts?.length && Utils.canAccess(user, 'pos')) {
      html += '<div class="search-group"><h4>Receipts / Orders</h4>' +
        data.receipts.map(r => `<div class="search-item" data-action="receipt" data-id="${r.receipt_number}">${r.order_number ? `Order ${r.order_number} ? ` : ''}${r.receipt_number} ? ${Utils.formatMoney(r.total, currency)}</div>`).join('') + '</div>';
    }
    if (data.users?.length && Utils.canAccess(user, 'users')) {
      html += '<div class="search-group"><h4>Users</h4>' +
        data.users.map(u => `<div class="search-item" data-action="page" data-page="users">${u.full_name || u.username} ? ${u.role}</div>`).join('') + '</div>';
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
            <p><strong>Cashier:</strong> ${saleRes.data.cashier_name || '?'}</p>
            <p><strong>Payments:</strong> ${(saleRes.data.payments||[]).map(p => `${p.payment_type} ${Utils.formatMoney(p.amount, currency)}`).join(', ') || '?'}</p>`,
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

  async fetchNotificationBuckets(force = false, opts = {}) {
    const now = Date.now();
    const fastOnly = !!opts.fastOnly;
    if (!force && this._notifCache && now - this._notifCache.at < 2000) {
      return this._notifCache.data;
    }
    const res = await API.getNotifications(this.user);
    const alerts = (res.data || [])
      .map(n => ({ ...n, kind: 'alert' }))
      .filter(n => this.notificationConcernsUser(n));
    let pending = this._notifCache?.data?.pending || [];
    let reminders = this._notifCache?.data?.reminders || [];
    if (['owner', 'manager'].includes(this.user?.role) && !fastOnly) {
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
        reminders = [];
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

    const data = { alerts, pending, reminders };
    this._notifCache = { at: now, data };
    return data;
  },

  async loadNotifications() {
    if (this.isPosKiosk()) return;
    await this.pollNotifications(false);
  },

  _renderNotifRow(n) {
    const isNew = this._isNotifToday(n.created_at);
    const newBadge = isNew ? ' <span class="notif-new-badge">New</span>' : '';
    const dest = this.notificationDestinationLabel(n);
    const rowCls = `notif-row notif-row--clickable${isNew ? ' notif-row--new' : ''}`;
    const actions = n.kind === 'alert'
      ? `<button class="btn btn-sm btn-ghost notif-mark-read" data-id="${n.id}">Mark read</button>`
      : n.kind === 'pending'
        ? `<button class="btn btn-sm btn-ghost notif-dismiss-pending" data-id="${n.id}">Dismiss</button>`
        : `<button class="btn btn-sm btn-ghost notif-dismiss-reminder" data-id="${n.id}">Dismiss</button>`;
    return `<div class="${rowCls}" data-kind="${n.kind}" data-type="${n.type || ''}" data-action-page="${n.action_page || ''}" data-id="${n.id}" title="Go to: ${String(dest).replace(/"/g, '&quot;')}">
      <div class="notif-row-body">
        <strong>${n.title}</strong>${newBadge}<br><small>${n.message}</small>
        <br><small class="notif-dest">→ ${dest}</small>
        ${n.created_at ? `<br><small class="muted">${Utils.formatDateTime(n.created_at)}</small>` : ''}
      </div>
      <div class="notif-row-actions">${actions}</div>
    </div>`;
  },

  async showNotifications(filter) {
    if (this.isPosKiosk()) return;
    if (filter) this._notifFilter = filter;
    if (!this._notifFilter) this._notifFilter = 'today';

    const paint = (buckets) => {
      const { alerts, pending, reminders } = buckets;
      const f = this._notifFilter;
    const filteredAlerts = alerts.filter(n => this._matchesNotifFilter(n.created_at, f));
    const filteredPending = pending.filter(n => this._matchesNotifFilter(n.created_at, f));
    const filteredReminders = reminders.filter(n => this._matchesNotifFilter(n.created_at, f));

    const filterBar = `<div class="notif-filter-bar">
      ${['today', 'week', 'all'].map(id => `<button type="button" class="btn btn-sm ${f === id ? 'btn-primary' : 'btn-ghost'} notif-filter-btn" data-filter="${id}">${id === 'today' ? 'Today' : id === 'week' ? 'This week' : 'All'}</button>`).join('')}
      <p class="muted" style="font-size:11px;margin:8px 0 0;width:100%">Alert sound rings for <strong>today&apos;s</strong> unread alerts only. Use Today / This week / All to browse older items.</p>
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
        <p class="muted" style="font-size:12px;margin-bottom:8px">Informational only ? click to go to the relevant screen.</p>`;
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
        Utils.toast('Playing test sound for 8 seconds?', 'success');
      } catch (err) {
        Utils.toast(err.message || 'Could not play sound', 'error');
      }
    });

    document.getElementById('mark-all-read')?.addEventListener('click', () => {
      (alerts || []).forEach((n) => window.PanelNotifyHub?.ackAdminAlert(n.id));
      if (this._notifCache?.data) this._notifCache.data.alerts = [];
      document.querySelectorAll('.notif-row[data-kind="alert"]').forEach((row) => row.remove());
      const badge = document.getElementById('notif-badge');
      if (badge) {
        const pending = this._notifCache?.data?.pending?.length || 0;
        if (pending) badge.textContent = pending > 99 ? '99+' : pending;
        else badge.classList.add('hidden');
      }
      Utils.hideModal();
      this.stopAllNotificationSounds();
      this._dismissAdminAlertFlash();
      Utils.toast('Your alerts marked as read', 'success');
      API.markAllNotificationsRead(this.user).then(() => {
        this.pollNotifications(true).catch(() => {});
      }).catch((err) => Utils.toast(err?.message || 'Could not mark all read', 'error'));
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
          window.PanelNotifyHub?.ackAdminAlert(id);
          if (this._notifCache?.data) {
            this._notifCache.data.alerts = (this._notifCache.data.alerts || []).filter((n) => n.id !== id);
          }
          API.markNotificationRead(id).then(() => this.loadNotifications()).catch(() => {});
          this.checkNotificationSounds();
        }
      });
    });

    document.querySelectorAll('.notif-mark-read').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const row = btn.closest('.notif-row');
        window.PanelNotifyHub?.ackAdminAlert(id);
        row?.remove();
        if (this._notifCache?.data) {
          this._notifCache.data.alerts = (this._notifCache.data.alerts || []).filter((n) => n.id !== id);
        }
        const remaining = this._notifCache?.data?.alerts?.length || 0;
        const markAll = document.getElementById('mark-all-read');
        if (markAll) markAll.style.display = remaining ? '' : 'none';
        if (!remaining) {
          this.stopAllNotificationSounds();
          Utils.toast('All alerts attended', 'success');
        }
        await this.checkNotificationSounds();
        API.markNotificationRead(id).catch(() => Utils.toast('Could not mark read', 'error'));
      });
    });

    document.querySelectorAll('.notif-dismiss-pending').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.closest('.notif-row')?.remove();
        this._dismissPending(btn.dataset.id);
        window.PanelNotifyHub?.ackAdminPending(btn.dataset.id);
        if (this._notifCache?.data) {
          this._notifCache.data.pending = (this._notifCache.data.pending || []).filter((n) => String(n.id) !== String(btn.dataset.id));
        }
        this.loadNotifications();
      });
    });

    document.querySelectorAll('.notif-dismiss-reminder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.closest('.notif-row')?.remove();
        this._dismissReminder(btn.dataset.id);
        window.PanelNotifyHub?.ackAdminReminder(btn.dataset.id);
        if (this._notifCache?.data) {
          this._notifCache.data.reminders = (this._notifCache.data.reminders || []).filter((n) => String(n.id) !== String(btn.dataset.id));
        }
      });
    });

    document.getElementById('notif-close')?.addEventListener('click', () => {
      Utils.hideModal();
      this.checkNotificationSounds();
    });
    };

    const cached = this._notifCache?.data || { alerts: [], pending: [], reminders: [] };
    paint(cached);
    this.fetchNotificationBuckets(true).then((buckets) => {
      if (document.getElementById('notif-close')) paint(buckets);
    }).catch(() => {});
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
