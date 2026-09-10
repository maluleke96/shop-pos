const App = {
  user: null,
  settings: null,
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
  /** Page script bundles ? Android loads these on first open (Windows index still preloads most). */
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
      'js/promo-poster.js',
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
      'js/pages/admin-delivery.js',
      'js/pages/admin-business-modules.js',
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
    marketing: ['js/pages/marketing-flyers-studio.js', 'js/pages/admin-marketing.js']
  },
  _scheduledDocInterval: null,

  appMode() {
    return window.__SHOP_POS_APP_MODE__ || 'admin';
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

  _clearPortalEntry() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('entry');
      history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
    } catch (_) { /* ignore */ }
  },

  _shouldSkipSessionRestore() {
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
      const store = this.appMode?.() === 'admin' ? sessionStorage : localStorage;
      token = store.getItem('shoppos_rpc_session') || '';
    } catch (_) { /* ignore */ }
    if (!token) return false;
    try {
      const res = await API.getSession();
      const user = res?.data || res?.user;
      if (!res?.success || !user?.id) {
        try { localStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
        try { sessionStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
        return false;
      }
      this.user = user;
      this.user.is_active = 1;
      this.applyPosKioskChrome();
      this._restoredNav = this._loadNavState();
      if (this.appMode() === 'delivery') {
        await this.openDeliveryDepartment();
        return true;
      }
      if (this.appMode() === 'recipe') {
        await this.openRecipeProduction({ fromApp: true });
        return true;
      }
      if (this.isPosKiosk()) {
        await this.enterApp({ restored: true, skipPosWelcome: true });
        return true;
      }
      await this.enterApp({ restored: true });
      return true;
    } catch (_) {
      try { localStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
      try { sessionStorage.removeItem('shoppos_rpc_session'); } catch (_) { /* ignore */ }
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
    const pages = mode === 'pos'
      ? ['pos']
      : mode === 'delivery'
        ? []
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

      // Dedicated apps: skip admin welcome/setup ? go straight to that app's login
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

      // POS-only installer: show login immediately (no setup / welcome delay)
      if (mode === 'pos') {
        this.applyPosKioskChrome();
        this.hideMobileLoading();
        if (!this._shouldSkipSessionRestore() && await this.tryRestoreSession()) return;
        await this.populateLoginBranchPicker();
        this.showScreen('login');
        this.startLoginOperatingTimer?.();
        this.prefetchLoginScripts();
        this.ensureSettingsLoaded().then(() => {
          this.applyTheme?.();
          this.updateBranding?.();
        }).catch(() => {});
        return;
      }

      // Admin portal: restore session on refresh (stay signed in + same page)
      if (mode === 'admin') {
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
    this.applyLoginChrome();
    this.renderShopProfilePicker();
  },

  renderShopProfilePicker() {
    const picker = document.getElementById('welcome-shop-picker');
    const sel = document.getElementById('welcome-shop-select');
    if (!picker || !sel || !window.ShopProfiles) return;
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
      const name = prompt('Shop name (e.g. Chisa Food Branch 2)')?.trim();
      if (!name) return;
      const url = prompt('Cloud URL (Railway shop link)', ShopProfiles.DEFAULT_CLOUD)?.trim();
      if (!url) return;
      ShopProfiles.save({ name, cloudUrl: url });
      ShopProfiles.setActive(ShopProfiles.list().slice(-1)[0]?.id);
      ShopProfiles.clearPanelSessions();
      Utils.toast('Shop added ? reloading?', 'success');
      setTimeout(() => location.reload(), 400);
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
      if (this.appMode() === 'marketing') this.showMarketingRecoveryModal();
      else this.showRecoveryModal();
    });
    document.getElementById('login-register-agent')?.addEventListener('click', () => {
      this.openMarketingAgentLogin({ fromLogin: true, view: 'apply' });
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
    ['welcome', 'login', 'setup', 'pos-welcome', 'app', 'staff-portal', 'recipe-production', 'marketing-agent', 'accounting', 'hr', 'display', 'delivery-dept'].forEach(s =>
      document.getElementById(`screen-${s}`)?.classList.toggle('hidden', s !== name));
    document.body.dataset.activeScreen = name;
    if (name === 'login' || name === 'welcome') this.applyLoginChrome();
    if (name === 'login' && this.isPosKiosk()) this.populateLoginBranchPicker().catch(() => {});
    const branchWrap = document.getElementById('login-branch-wrap');
    const branchSel = document.getElementById('login-branch');
    if (branchWrap) branchWrap.classList.toggle('hidden', !this.isPosKiosk());
    if (branchSel) branchSel.required = !!this.isPosKiosk();
  },

  /** Hide cross-app links on dedicated installers (Admin, POS, HR, etc.) */
  applyLoginChrome() {
    const mode = this.appMode();
    const dedicated = new Set(['pos', 'staff', 'marketing', 'recipe', 'accounting', 'hr', 'delivery']);
    const crossIds = [
      'login-register-agent',
      'login-open-accounting',
      'login-open-hr',
      'login-open-staff',
      'welcome-accounting',
      'welcome-hr',
      'welcome-staff'
    ];
    crossIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const showMarketingAgent = mode === 'marketing' && id === 'login-register-agent';
      el.classList.toggle('hidden', dedicated.has(mode) && !showMarketingAgent);
    });
    if (mode === 'admin') {
      const loginName = document.getElementById('login-shop-name');
      if (loginName && !this.settings?.shop_name) loginName.textContent = 'Shop POS Admin';
      const welcomeTitle = document.getElementById('welcome-title');
      if (welcomeTitle && !this.settings?.shop_name) welcomeTitle.textContent = 'Shop POS Admin';
    }
    if (mode === 'delivery') {
      const loginName = document.getElementById('login-shop-name');
      if (loginName) loginName.textContent = this.settings?.shop_name ? `${this.settings.shop_name} — Delivery` : 'Delivery Department';
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
  },

  async openDeliveryDepartment() {
    this.stopLoginOperatingTimer();
    await this.ensureFeatureCss('css/delivery-dept.css');
    document.body.classList.remove('sidebar-open');
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
    this.showScreen('delivery-dept');
    const root = document.getElementById('delivery-dept-root');
    const userEl = document.getElementById('delivery-dept-user');
    const titleEl = document.getElementById('delivery-dept-title');
    if (userEl) userEl.textContent = `${this.user.full_name || this.user.username} · ${this.user.role}`;
    if (titleEl) titleEl.textContent = this.settings?.shop_name ? `${this.settings.shop_name} — Delivery` : 'Delivery Department';
    document.getElementById('delivery-dept-logout')?.addEventListener('click', () => this.closeDeliveryDepartment(), { once: true });
    if (!root) return;
    root.innerHTML = '<p class="muted" style="padding:24px">Loading delivery department…</p>';
    try {
      if (!this.settings) await this.ensureSettingsLoaded().catch(() => { this.settings = this.settings || {}; });
      await this.ensureFeatureScript('js/pages/admin-delivery.js');
      if (!window.AdminDeliveryPage) throw new Error('Delivery module failed to load');
      const admin = {
        app: this,
        settings: this.settings,
        user: this.user,
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
        PanelNotifyHub.startPoll('delivery', () => PanelNotifyHub.pollDelivery(this.user), 18000);
      }
    } catch (err) {
      console.error('[DeliveryDepartment]', err);
      root.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto;text-align:center">
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not load Delivery Department')}</p>
        <button type="button" class="btn btn-primary" id="dd-retry">Retry</button></div>`;
      document.getElementById('dd-retry')?.addEventListener('click', () => this.openDeliveryDepartment());
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
    portal.step = 'login';
    portal.employee = null;
    portal.employeePin = null;
    portal.render(root, this);
  },

  async closeStaffPortal() {
    window.PanelNotifyHub?.stop('staff');
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
  async openMarketingAgentLogin(opts = {}) {
    await this.openMarketingAgent({ fromLogin: true, ...opts });
  },

  async openMarketingAgent(opts = {}) {
    this.stopLoginOperatingTimer();
    await this.ensureFeatureCss('css/marketing-agent.css');
    await this.ensureFeatureCss('css/marketing-command.css');
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
    if (opts.view === 'apply') {
      appMod.session = null;
      appMod.view = 'apply';
    } else {
      appMod.view = 'dashboard';
    }
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
    const raw = (window.__SHOP_POS_ENV__?.RPC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_RPC_URL || '').replace(/\/rpc\/?$/i, '');
    if (raw) return raw.replace(/\/$/, '');
    if (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:')) {
      return location.origin.replace(/\/$/, '');
    }
    return 'https://chisafood.up.railway.app';
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

    const useCloudLogo = !!(window.__SHOP_POS_CLOUD__ || /^https?:/i.test(String(location.protocol || '')));
    const brandInitials = (shopName || appName || 'POS').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'POS';
    const applyLogo = async (elId, fallback = brandInitials) => {
      const el = document.getElementById(elId);
      if (!el) return;
      if (useCloudLogo) {
        el.innerHTML = `<img src="/api/logo" alt="${appName}" class="brand-logo-img" onerror="this.parentElement.textContent='${fallback}'">`;
        return;
      }
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
    // Referral Agent overlay
    if (typeof MarketingAgentApp !== 'undefined' && MarketingAgentApp?.isOpen?.()) {
      if (typeof MarketingAgentApp.goBackInApp === 'function' && MarketingAgentApp.goBackInApp()) return;
      this.closeMarketingAgent();
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
          setTimeout(resolve, 8000);
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

      errEl.classList.add('hidden');
      this.user = user;
      this.user.is_active = 1;
      if (mode === 'admin') {
        try { sessionStorage.setItem('admin_portal_session', '1'); } catch (_) { /* ignore */ }
      }
      Utils.toast(`Signed in as ${user.full_name || user.username}`, 'success');

      if (this.isPosKiosk()) {
        const branchSel = document.getElementById('login-branch');
        const branchId = Number(branchSel?.value || 0);
        if (branchId && ['owner', 'manager'].includes(user.role)) {
          try { await API.setActiveBranch(branchId, this.user); } catch (_) { /* optional */ }
        }
        const restricted = ['cashier', 'supervisor', 'assistant_manager'].includes(user.role);
        const userBranch = user.branch_id != null ? Number(user.branch_id) : null;
        if (restricted && branchId && userBranch && userBranch !== branchId) {
          let branchName = 'this branch';
          try {
            const brRes = await API.getBranches();
            const branches = brRes?.data || brRes || [];
            branchName = branches.find((b) => Number(b.id) === branchId)?.name || branchName;
          } catch (_) { /* ignore */ }
          try { await API.logout(); } catch (_) { /* ignore */ }
          this.user = null;
          await this.showPosBranchErrorModal(
            `Oops — you chose ${branchName}, but your account is not assigned to that branch. Select the branch you work at, or ask admin to update your user profile.`
          );
          return;
        }
        if (restricted && userBranch) {
          const tillRes = await API.getActiveBranch().catch(() => null);
          const tillId = Number(tillRes?.data?.id || tillRes?.id || 0);
          if (tillId && userBranch !== tillId) {
            try { await API.logout(); } catch (_) { /* ignore */ }
            this.user = null;
            await this.showPosBranchErrorModal(result.error || 'This till is connected to a different branch than your account. Ask admin to connect this computer to your branch.');
            return;
          }
        }
        let branchLabel = 'your branch';
        try {
          const brRes = await API.getBranches();
          const branches = brRes?.data || brRes || [];
          const pickId = branchId || userBranch;
          branchLabel = branches.find((b) => Number(b.id) === Number(pickId))?.name || branchLabel;
        } catch (_) { /* ignore */ }
        await this.showPosWelcomeSuccessModal(user, branchLabel);
        try { sessionStorage.setItem('pos_welcome_done', '1'); } catch (_) { /* ignore */ }
      }
      // Keep POS catalog cache warm — only drop session-specific reads
      try {
        window.DataCache?.invalidate?.('openShift', 'notifications', 'dashboard', 'salesReport', 'salesList', 'kitchen');
      } catch (_) { /* ignore */ }
      this.prefetchPosCatalog(user);
      this.applyPosKioskChrome();
      this._clearPortalEntry();
      try {
        if (mode === 'delivery') {
          await this.openDeliveryDepartment();
        } else if (mode === 'recipe') {
          await this.openRecipeProduction({ fromApp: true });
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

  async showMarketingRecoveryModal() {
    Utils.showModal('Referral Agent ? Password Recovery', `
      <p class="muted">Enter your username or mobile number. A temporary password will be sent to your WhatsApp.</p>
      <div class="field"><label>Username or mobile</label><input id="mkt-rec-id" autocomplete="username"></div>
      <p id="mkt-rec-err" class="error-msg hidden"></p>`,
      '<button class="btn btn-primary" id="mkt-rec-send">Send via WhatsApp</button><button class="btn btn-ghost" id="mkt-rec-cancel">Cancel</button>');
    document.getElementById('mkt-rec-cancel')?.addEventListener('click', Utils.hideModal);
    document.getElementById('mkt-rec-send')?.addEventListener('click', async () => {
      const id = document.getElementById('mkt-rec-id')?.value?.trim();
      const err = document.getElementById('mkt-rec-err');
      err?.classList.add('hidden');
      if (!id) { err.textContent = 'Enter username or mobile'; err.classList.remove('hidden'); return; }
      try {
        const r = await API.recoverMarketingPassword(id);
        if (r?.whatsapp_url) window.open(r.whatsapp_url, '_blank');
        Utils.hideModal();
        Utils.toast(r?.message || 'Check WhatsApp for your temporary password', 'success');
      } catch (e) {
        err.textContent = e.message || 'Recovery failed';
        err.classList.remove('hidden');
      }
    });
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
    // Load in order ? Admin extenders (admin-audit, admin-pro, ?) must run AFTER admin.js
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

  async enterApp(opts = {}) {
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

    if (this.appMode() === 'delivery') {
      await this.openDeliveryDepartment();
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
      this.prefetchPosCatalog(this.user);
      await this.navigate('pos');
      const bgPos = async () => {
        try { await API.logOperatingEvent('open', this.user); } catch { /* ignore */ }
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
      this.renderNav();
      document.getElementById('sidebar-user-role').textContent =
        this.formatSidebarUserRole(this.user);
      this.refreshBranchSwitcher().catch(() => {});
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
    if (this.appMode() === 'admin') {
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
    if (startPage === 'admin' && savedNav?.adminSection && typeof AdminPage !== 'undefined') {
      AdminPage.section = savedNav.adminSection;
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
        this.startNotificationSoundMonitor();
        this.startNotificationRefresh();
        this.startScheduledDocMonitor();
        this.loadNotifications();
        this.runDeferredStartup();
      }
      this.startAutoLogoutTimer();
      this.startSyncMonitor();
      this.startSessionMonitor();
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
    nav.innerHTML = this.navItems
      .filter(item => Utils.canAccess(this.user, item.id))
      .map(item => `<button class="nav-btn" data-page="${item.id}">${item.label}</button>`)
      .join('');
    const setBtn = document.querySelector('.sidebar-footer [data-page="settings"]');
    if (setBtn) setBtn.classList.toggle('hidden', !Utils.canAccess(this.user, 'settings'));
  },

  async navigate(page) {
    if (page === 'recipe') {
      return this.openRecipeProduction({ fromApp: true });
    }
    if (page === 'bookkeeping') {
      Utils.toast('Opening Accounting Command Centre', 'info');
      return this.openAccounting({ fromApp: true, skipLogin: true });
    }
    const navT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // Immediate UI feedback ? never block navigation on session/network
    this.closeSidebar();
    if (!this.user) return;
    if (!Utils.canAccess(this.user, page)) return;
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
    if (page === 'admin' && !this.isPosKiosk?.()) {
      this.initPanelNotify();
      this.checkNotificationSounds().catch(() => {});
    }
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
      host.innerHTML = '<p class="muted" style="padding:24px">Loading POS…</p>';
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
          window.DataCache?.clearStaleBanner?.(host);
        } catch (err) {
          window.DataCache?.showStaleBanner?.(host, err?.message || 'Unable to refresh. Showing last updated data.');
        }
      })();
      return;
    }

    // First visit: skeleton shell immediately, then load (POS paints its own shell ? skip skeleton)
    if (page !== 'pos') host.innerHTML = Utils.pageSkeleton();
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

  /** Warm POS categories/products/combos so the till menu paints instantly. */
  prefetchPosCatalog(user = this.user) {
    if (!window.API || !user) return;
    const filters = { for_pos: true, actor: user };
    const branchId = user.branch_id != null ? Number(user.branch_id) : undefined;
    const comboArgs = branchId ? { branch_id: branchId, for_pos: true } : { for_pos: true };
    try {
      API.getCategories(filters)?.catch?.(() => {});
      API.getProducts(filters)?.catch?.(() => {});
      API.getActiveCombos(comboArgs)?.catch?.(() => {});
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
        tasks.push(() => API.getActiveCombos({ for_pos: true }));
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
    if (!wrap || !sel) return;
    sel.required = true;
    wrap.classList.remove('hidden');
    try {
      const res = await API.getBranches();
      const branches = res?.data || res || [];
      sel.innerHTML = branches.map((b) => `<option value="${b.id}">${Utils.escHtml(b.name)}</option>`).join('');
      const active = await API.getActiveBranch().catch(() => null);
      const activeId = active?.data?.id || active?.id;
      if (activeId) sel.value = String(activeId);
    } catch (_) {
      sel.innerHTML = '<option value="">Main branch</option>';
    }
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
    if (this.appMode() === 'admin') {
      el.classList.add('hidden');
      return;
    }
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
      label.textContent = 'Operating hours not configured ? set in Admin ? Operating Hours';
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
      label.textContent = `Opens at ${openTime} ? ${this.formatCountdown(openAt - now)} until open`;
    } else if (now >= closeAt) {
      label.textContent = `Closed ? was open until ${closeTime}`;
    } else {
      label.textContent = `Open until ${closeTime} ? ${this.formatCountdown(closeAt - now)} remaining`;
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

  async pollNotifications(force = false) {
    if (this.isPosKiosk()) return;
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
      }
    } catch (_) { /* offline or sync paused */ }
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
    }, 300);
  },

  navigateToBookkeepingTab(tabId) {
    const sectionMap = { donations: 'other-income', income: 'other-income', expenses: 'expenses', ledger: 'general-ledger' };
    this.openAccounting({ fromApp: true, skipLogin: true, section: sectionMap[tabId] || 'dashboard' });
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
    if (!force && this._notifCache && now - this._notifCache.at < 8000) {
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

    document.getElementById('mark-all-read')?.addEventListener('click', async () => {
      const btn = document.getElementById('mark-all-read');
      if (btn) btn.disabled = true;
      try {
        const r = await API.markAllNotificationsRead(this.user);
        if (r && r.success === false) throw new Error(r.error || 'Could not mark all read');
        (alerts || []).forEach((n) => window.PanelNotifyHub?.ackAdminAlert(n.id));
        this._notifCache = null;
        Utils.hideModal();
        this.stopAllNotificationSounds();
        await this.loadNotifications();
        await this.checkNotificationSounds();
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
