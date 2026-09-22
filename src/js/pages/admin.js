const AdminPage = {
  section: 'overview',
  settings: null,

  /** Run an admin save API call and only toast success when it actually worked. */
  async awaitSave(promise, okMsg, failMsg) {
    try {
      const r = await promise;
      if (!r || r.success === false) {
        Utils.toast(r?.error || failMsg || 'Save failed', 'error');
        return null;
      }
      if (okMsg) Utils.toast(okMsg, 'success');
      window.DataCache?.invalidate?.('settings', 'products', 'categories', 'customers', 'suppliers', 'dashboard');
      return r;
    } catch (err) {
      Utils.toast(err?.message || failMsg || 'Save failed', 'error');
      return null;
    }
  },

  _adminNavLabel(label) {
    const hide = this.app?.settings?.customization?.hide_nav_emojis;
    if (!hide) return label;
    return String(label || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
  },

  sections: [
    { id: 'overview', label: '🏠 Business Dashboard', icon: 'overview' },
    { id: 'salesmgmt', label: '💰 Sales Management', icon: 'sales' },
    { id: 'pos-menu', label: '🍽️ POS Menu & Promos', icon: 'pos' },
    { id: 'saleexplorer', label: '🔍 Sales Explorer', icon: 'sales' },
    { id: 'soldproducts', label: '📦 Sold Products', icon: 'products' },
    { id: 'returnsmgmt', label: '↩️ Returns', icon: 'returns' },
    { id: 'activity', label: '📋 Activity Log', icon: 'activity' },
    { id: 'exceptions', label: '⚠️ Exceptions', icon: 'exceptions' },
    { id: 'alerts', label: '🔔 Alerts Center', icon: 'alerts' },
    { id: 'dailyclose', label: '📊 Daily Closing', icon: 'close' },
    { id: 'discount-report', label: '💸 Discount Report', icon: 'discounts' },
    { id: 'printer', label: '🖨️ Printer Setup', icon: 'printer' },
    { id: 'payments', label: '💳 Payment Methods', icon: 'payments' },
    { id: 'receipt', label: '🧾 Receipt Designer', icon: 'receipt' },
    { id: 'security', label: '🔒 Security', icon: 'security' },
    { id: 'quotes', label: '📄 Quotes', icon: 'quotes' },
    { id: 'permissions', label: '👥 Permissions', icon: 'permissions' },
    { id: 'sales-targets', label: '🎯 Sales Targets', icon: 'targets' },
    { id: 'top-customers', label: '⭐ Top Customers', icon: 'customers' },
    { id: 'approvals', label: '✅ Settings Approvals', icon: 'approvals' },
    { id: 'tax', label: '💰 Tax & Currency', icon: 'tax' },
    { id: 'tax-hub', label: '📊 Tax Calculations', icon: 'tax' },
    { id: 'cashiers', label: '🧑‍💼 Cashiers & Managers', icon: 'permissions' },
    { id: 'shifts', label: '⏱️ Shift Management', icon: 'shifts' },
    { id: 'operating', label: '🕐 Operating Hours', icon: 'operating' },
    { id: 'cashdrawer', label: '💵 Cash Drawer', icon: 'cashdrawer' },
    { id: 'analytics', label: '📊 Sales Analytics', icon: 'analytics' },
    { id: 'inventory', label: '📦 Inventory', icon: 'inventory' },
    { id: 'discounts', label: '🏷️ Discounts', icon: 'discounts' },
    { id: 'loyalty', label: '⭐ Loyalty & Gift Cards', icon: 'loyalty' },
    { id: 'importexport', label: '📁 Import & Export', icon: 'importexport' },
    { id: 'customize', label: '🎨 Customization', icon: 'customize' },
    { id: 'branches', label: '🏢 Branches', icon: 'branches' },
    { id: 'online-orders', label: '🛒 Online Orders', icon: 'online' },
    { id: 'referral-dept', label: 'Referral & Commission', icon: 'referral' },
    { id: 'customer-reports', label: '📣 Customer Reports', icon: 'online' },
    { id: 'business-modules', label: '🏢 Business Modules', icon: 'business' },
    { id: 'digital-signage', label: '📺 Digital Signage', icon: 'signage' },
    { id: 'mobile-app', label: '📱 Mobile App Users', icon: 'mobile' },
    { id: 'business-manager', label: '📊 Business Manager', icon: 'mobile' },
    { id: 'device', label: '💻 Device Settings', icon: 'device' },
    { id: 'backup', label: '💾 Backup & Restore', icon: 'backup' },
    { id: 'opscompliance', label: '📋 Operations & Compliance', icon: 'opscompliance' },
    { id: 'combos', label: '🎁 Combos & Promos', icon: 'combos' },
    { id: 'menu-builder', label: '📋 Menu Builder', icon: 'menu' },
    { id: 'promo-video-builder', label: '🎬 Promo Video Builder', icon: 'signage' },
    { id: 'communication-center', label: '📣 Communication Center', icon: 'signage' },
    { id: 'radio', label: '📻 Radio', icon: 'signage' },
    { id: 'recipe', label: '🍳 Recipe & Production', icon: 'recipe' },
    { id: 'staffhr', label: '👷 Staff & HR', icon: 'staffhr' },
    { id: 'hr-workspace', label: '📋 HR, Payroll & Documents', icon: 'staffhr' },
    { id: 'hr-approvals', label: '✅ HR Approvals', icon: 'staffhr' },
    { id: 'accounting-workspace', label: '💼 Bookkeeping & Accounting', icon: 'accounting' },
    { id: 'staffportal', label: '👷 Staff Portal', icon: 'staffportal' },
    { id: 'onaccount', label: '📒 On Account', icon: 'onaccount' },
    { id: 'taken-orders', label: '🥡 Taken / Unpaid Orders', icon: 'onaccount' },
    { id: 'hrcontracts', label: '📄 Contracts & Probation', icon: 'hrcontracts' },
    { id: 'recruitment', label: '💼 Recruitment', icon: 'recruitment' },
    { id: 'delivery-dept', label: '🚚 Deliveries', icon: 'delivery' },
    { id: 'payroll', label: '💼 Payroll & Compliance', icon: 'payroll' },
    { id: 'employee-of-month', label: '🏆 Employee of Month', icon: 'employee-of-month' },
    { id: 'database', label: '🗄️ Database Manager', icon: 'database' },
    { id: 'system-health', label: '🩺 System Health · Database & Storage', icon: 'database' },
    { id: 'automation', label: '⚡ Automation Rules', icon: 'automation' },
    { id: 'customfields', label: '📝 Custom Fields', icon: 'customfields' },
    { id: 'formats', label: '📅 Formats & Numbering', icon: 'formats' },
    { id: 'developer', label: '🔧 Developer Mode', icon: 'developer' }
  ],

  /**
   * Admin sidebar layout only — regroups existing sections (no feature/design changes).
   */
  adminNavGroups: [
    {
      id: 'overview-monitoring',
      label: 'Overview & Monitoring',
      icon: '📊',
      accent: '#2563eb',
      items: ['overview', 'analytics', 'sales-targets', 'dailyclose', 'alerts', 'activity', 'exceptions']
    },
    {
      id: 'sales-pos',
      label: 'Sales & POS',
      icon: '💳',
      accent: '#16a34a',
      items: [
        'salesmgmt', 'pos-menu', 'saleexplorer', 'soldproducts', 'returnsmgmt', 'quotes', 'discounts',
        'discount-report', 'printer', 'payments', 'receipt', 'cashiers', 'shifts', 'operating',
        'cashdrawer', 'onaccount', 'taken-orders'
      ]
    },
    {
      id: 'products-inventory',
      label: 'Products & Inventory',
      icon: '📦',
      accent: '#ea580c',
      items: ['inventory', 'combos', 'menu-builder', 'importexport', 'customfields', 'formats']
    },
    {
      id: 'customers-loyalty',
      label: 'Customers & Loyalty',
      icon: '👥',
      accent: '#0d9488',
      items: ['top-customers', 'loyalty', 'customer-reports', 'referral-dept']
    },
    {
      id: 'business-mgmt',
      label: 'Business Management',
      icon: '🏢',
      accent: '#4f46e5',
      items: ['business-manager', 'branches', 'business-modules', 'customize', 'approvals', 'mobile-app']
    },
    {
      id: 'online-digital',
      label: 'Online & Digital',
      icon: '🌐',
      accent: '#0284c7',
      items: ['online-orders', 'digital-signage', 'radio']
    },
    {
      id: 'comm-marketing',
      label: 'Communication & Marketing',
      icon: '📣',
      accent: '#db2777',
      items: ['communication-center', 'promo-video-builder']
    },
    {
      id: 'restaurant-ops',
      label: 'Restaurant & Operations',
      icon: '🍽️',
      accent: '#d97706',
      items: ['recipe', 'delivery-dept', 'opscompliance']
    },
    {
      id: 'staff-hr',
      label: 'Staff & HR',
      icon: '👷',
      accent: '#7c3aed',
      items: [
        'staffhr', 'hr-workspace', 'hr-approvals', 'staffportal', 'hrcontracts',
        'recruitment', 'payroll', 'employee-of-month'
      ]
    },
    {
      id: 'finance-accounting',
      label: 'Finance & Accounting',
      icon: '💰',
      accent: '#059669',
      items: ['accounting-workspace', 'tax', 'tax-hub']
    },
    {
      id: 'security-access',
      label: 'Security & Access',
      icon: '🔐',
      accent: '#dc2626',
      items: ['security', 'permissions', 'device']
    },
    {
      id: 'system-database',
      label: 'System & Database',
      icon: '💾',
      accent: '#475569',
      items: ['backup', 'database', 'system-health', 'automation', 'developer']
    }
  ],

  _adminGroupOpen: null,

  _isAdminGroupOpen(groupId) {
    try {
      if (!this._adminGroupOpen) {
        const raw = sessionStorage.getItem('shoppos_admin_nav_groups_open');
        this._adminGroupOpen = raw ? JSON.parse(raw) : {};
      }
    } catch (_) {
      this._adminGroupOpen = {};
    }
    return !!this._adminGroupOpen[groupId];
  },

  _setAdminGroupOpen(groupId, open) {
    try {
      if (!this._adminGroupOpen) this._adminGroupOpen = {};
      if (open) this._adminGroupOpen[groupId] = true;
      else delete this._adminGroupOpen[groupId];
      sessionStorage.setItem('shoppos_admin_nav_groups_open', JSON.stringify(this._adminGroupOpen));
    } catch (_) { /* */ }
  },

  _adminSectionBtnHtml(s, activeId) {
    const locked = !Utils.canAccessAdminSection(this.app.user, s.id);
    const tip = locked ? `Upgrade your package to access ${String(s.label).replace(/^[^A-Za-z0-9]+/, '')}.` : '';
    const active = s.id === activeId && !locked;
    const label = this._adminNavLabel(String(s.label || '').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\s]+/gu, '').trim() || s.label);
    return `<button type="button" class="admin-nav-btn admin-nav-sub ${active ? 'active' : ''} ${locked ? 'admin-nav-btn-locked' : ''}" data-section="${s.id}" ${locked ? `data-locked="1" title="${Utils.escHtml(tip)}"` : ''}><span class="admin-nav-sub-dot" aria-hidden="true"></span><span class="admin-nav-sub-label">${locked ? '🔒 ' : ''}${label}</span></button>`;
  },

  _renderAdminNavHtml(navSections) {
    const byId = Object.fromEntries((navSections || []).map((s) => [s.id, s]));
    const placed = new Set();
    let html = '';
    // Expand group containing current section
    (this.adminNavGroups || []).forEach((g) => {
      if ((g.items || []).includes(this.section)) this._setAdminGroupOpen(g.id, true);
    });
    for (const g of (this.adminNavGroups || [])) {
      const kids = (g.items || []).map((id) => byId[id]).filter(Boolean);
      if (!kids.length) continue;
      kids.forEach((s) => placed.add(s.id));
      const open = this._isAdminGroupOpen(g.id);
      const accent = g.accent || '#2563eb';
      const icon = g.icon || '📁';
      html += `<div class="admin-nav-group${open ? ' is-open' : ''}" data-admin-nav-group="${g.id}" style="--group-accent:${accent}">
        <button type="button" class="admin-nav-btn admin-nav-group-toggle" data-admin-nav-group-toggle="${g.id}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="admin-nav-group-icon" aria-hidden="true">${icon}</span>
          <span class="admin-nav-group-text">
            <span class="admin-nav-group-label">${this._adminNavLabel(g.label)}</span>
          </span>
          <span class="admin-nav-group-count">${kids.length}</span>
          <span class="admin-nav-group-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
        </button>
        <div class="admin-nav-group-items${open ? '' : ' hidden'}">
          ${kids.map((s) => this._adminSectionBtnHtml(s, this.section)).join('')}
        </div>
      </div>`;
    }
    // Safety: any section not in a group still appears
    for (const s of (navSections || [])) {
      if (placed.has(s.id)) continue;
      html += this._adminSectionBtnHtml(s, this.section);
    }
    return html;
  },

  async render(el, app) {
    this.app = app;
    if (this.section === 'deliveries') this.section = 'delivery-dept';
    // Paint shell immediately from in-memory settings — never blank-wait on RPC
    this.settings = this.settings || app.settings || {};
    this.applyStudioLockSection();

    const studioLock = this.studioLockSections();
    const navSections = this.sections.filter((s) =>
      Utils.canAccessAdminSectionByRole(app.user, s.id) && (!studioLock || studioLock.has(s.id))
    );
    if (!navSections.find((s) => s.id === this.section && Utils.canAccessAdminSection(app.user, s.id)) && navSections.length) {
      const firstOpen = navSections.find((s) => Utils.canAccessAdminSection(app.user, s.id));
      this.section = firstOpen?.id || navSections[0].id;
    }

    el.innerHTML = `<div class="admin-layout${studioLock ? ' is-studio-lock' : ''}">
      <aside class="admin-sidebar-col admin-panel-drawer">
        ${studioLock ? `<div class="studio-lock-bar" style="padding:10px 12px;margin-bottom:8px;border:1px solid rgba(251,191,36,.35);border-radius:10px;background:rgba(251,191,36,.08)">
          <strong style="display:block;font-size:12px;color:#fde68a">Menu &amp; Promo Studio</strong>
          <button type="button" class="btn btn-ghost btn-sm" id="studio-return" style="margin-top:6px">← Back to Studio</button>
        </div>` : ''}
        <div class="admin-panel-head${studioLock ? ' hidden' : ''}">
          <div class="admin-panel-head-text">
            <h2 class="admin-panel-title">Admin Panel</h2>
            <p class="admin-panel-sub">Manage and control your business.</p>
          </div>
        </div>
        <div class="admin-search-bar${studioLock ? ' hidden' : ''}">
          <span class="admin-search-icon" aria-hidden="true">🔍</span>
          <input type="search" id="admin-global-search" placeholder="Search admin features..." autocomplete="off" title="Search admin sections, products, staff — Ctrl+K">
          <div id="admin-search-results" class="search-dropdown hidden"></div>
        </div>
        <nav class="admin-nav" id="admin-nav">${this._renderAdminNavHtml(navSections)}</nav>
        <div class="admin-upgrade-card${studioLock ? ' hidden' : ''}">
          <div class="admin-upgrade-icon" aria-hidden="true">👑</div>
          <div class="admin-upgrade-copy">
            <strong>Upgrade Your Package</strong>
            <span>Unlock more modules for your shop.</span>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="admin-view-packages">View Packages</button>
        </div>
      </aside>
      <div class="admin-content" id="admin-content"></div>
    </div>`;

    document.getElementById('studio-return')?.addEventListener('click', () => {
      const back = sessionStorage.getItem('shoppos_studio_return') || '/studio/';
      location.href = back;
    });
    document.getElementById('admin-view-packages')?.addEventListener('click', () => {
      if (this.app?.navigate) {
        window.SaasFeatures?.loadCatalog?.(true)?.catch?.(() => {});
        this.app.navigate('features');
      } else {
        window.SaasFeatures?.loadCatalog?.(true)?.then?.(() => {
          const host = document.getElementById('page-content');
          if (host) window.SaasFeatures?.renderExplorer?.(host);
        });
      }
    });

    const searchInput = el.querySelector('#admin-global-search');
    searchInput?.addEventListener('input', (e) => this.handleAdminSearchDebounced(e.target.value));
    searchInput?.addEventListener('blur', () => {
      setTimeout(() => el.querySelector('#admin-search-results')?.classList.add('hidden'), 200);
    });
    searchInput?.addEventListener('focus', () => {
      if (searchInput.value.length >= 1) this.handleAdminSearchDebounced(searchInput.value);
    });
    if (!this._adminSearchKeyBound) {
      this._adminSearchKeyBound = true;
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && this.app?.currentPage === 'admin') {
          e.preventDefault();
          searchInput?.focus();
          searchInput?.select();
        }
      });
    }

    el.querySelector('#admin-nav').addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-admin-nav-group-toggle]');
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();
        const gid = toggle.getAttribute('data-admin-nav-group-toggle');
        const wrap = toggle.closest('.admin-nav-group');
        const open = !wrap?.classList.contains('is-open');
        this._setAdminGroupOpen(gid, open);
        wrap?.classList.toggle('is-open', open);
        const panel = wrap?.querySelector('.admin-nav-group-items');
        if (panel) {
          panel.classList.toggle('hidden', !open);
          panel.removeAttribute('hidden');
        }
        const chev = toggle.querySelector('.admin-nav-group-chevron');
        if (chev) chev.textContent = open ? '▾' : '▸';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      const btn = e.target.closest('.admin-nav-btn');
      if (!btn || btn.hasAttribute('data-admin-nav-group-toggle')) return;
      const section = btn.dataset.section;
      if (!section) return;
      if (btn.dataset.locked === '1' || !Utils.canAccessAdminSection(this.app.user, section)) {
        window.SaasFeatures?.loadCatalog?.().then(() => {
          window.SaasFeatures?.openLockedAdminSection?.(section);
        });
        return;
      }
      if (this.section && this.section !== section) {
        this._sectionHistory = this._sectionHistory || [];
        this._sectionHistory.push(this.section);
        if (this._sectionHistory.length > 30) this._sectionHistory.shift();
      }
      this.section = section;
      el.querySelectorAll('.admin-nav-btn[data-section]').forEach(b => b.classList.toggle('active', b.dataset.section === this.section && !b.dataset.locked));
      // Expand owning group
      (this.adminNavGroups || []).forEach((g) => {
        if ((g.items || []).includes(section)) {
          this._setAdminGroupOpen(g.id, true);
          const wrap = el.querySelector(`.admin-nav-group[data-admin-nav-group="${g.id}"]`);
          if (wrap) {
            wrap.classList.add('is-open');
            wrap.querySelector('.admin-nav-group-items')?.classList.remove('hidden');
            const t = wrap.querySelector('[data-admin-nav-group-toggle]');
            if (t) {
              t.setAttribute('aria-expanded', 'true');
              const c = t.querySelector('.admin-nav-group-chevron');
              if (c) c.textContent = '▾';
            }
          }
        }
      });
      this.toggleOpsComplianceLayout(this.section === 'opscompliance');
      this.renderSection(document.getElementById('admin-content'));
      window.App?._saveNavState?.();
    });

    this.toggleOpsComplianceLayout(this.section === 'opscompliance');
    this.renderSection(document.getElementById('admin-content'));

    this._prefetchAdmin();
  },

  toggleOpsComplianceLayout(opsOnly) {
    const layout = document.querySelector('.admin-layout');
    if (layout) layout.classList.toggle('admin-ops-full', !!opsOnly);
  },

  /** Tear down timers/polling when leaving an admin section. */
  _leaveSection(sectionId) {
    if (!sectionId) return;
    if (sectionId === 'overview') {
      clearInterval(this._liveTimer);
      this._liveTimer = null;
    }
    if (sectionId === 'delivery-dept') {
      window.AdminDeliveryPage?.stopAutoRefresh?.();
    }
  },

  /** Keep each admin section in its own host so nav clicks stay instant. */
  _sectionHost(el) {
    if (!el) return null;
    if (el.classList?.contains('admin-section-host')) return el;
    let hosts = el.querySelector(':scope > .admin-section-hosts');
    if (!hosts) {
      hosts = document.createElement('div');
      hosts.className = 'admin-section-hosts';
      el.appendChild(hosts);
    }
    hosts.querySelectorAll(':scope > .admin-section-host').forEach((h) => {
      h.hidden = h.dataset.section !== this.section;
    });
    let host = hosts.querySelector(`:scope > .admin-section-host[data-section="${this.section}"]`);
    if (!host) {
      host = document.createElement('div');
      host.className = 'admin-section-host';
      host.dataset.section = this.section;
      hosts.appendChild(host);
    }
    host.hidden = false;
    return host;
  },

  /** Instant nav feedback + cancel stale section renders. Never wipe a painted section. */
  _beginSectionRender(el) {
    const prev = this._activeSection;
    if (prev && prev !== this.section) this._leaveSection(prev);
    this._activeSection = this.section;
    this._sectionGen = (this._sectionGen || 0) + 1;
    return this._sectionGen;
  },

  _prefetchAdmin() {
    if (this._adminPrefetchStarted) return;
    this._adminPrefetchStarted = true;
    // Load Sales Management / Business Dashboard scripts early so nav + overview work
    const warmAudit = async () => {
      try {
        if (window.App?.ensureAdminSectionScripts) {
          await App.ensureAdminSectionScripts('overview');
          await App.ensureAdminSectionScripts('salesmgmt');
        }
        this.refreshAdminNav();
        if (this.section === 'overview' && typeof this.renderBusinessDashboard === 'function') {
          const host = document.getElementById('admin-content');
          if (host && !host.querySelector('#live-sales-feed')) {
            this.renderSection(host).catch(() => {});
          }
        }
      } catch (_) { /* ignore */ }
    };
    warmAudit();
    if (window.App?.ensurePageScripts) {
      this._adminScriptsP = App.ensurePageScripts('admin').catch(() => {});
    }
    if (!this.settings?.shop_name && !this.app?.settings?.shop_name) {
      API.getSettingsParsed().then((res) => {
        if (res?.data) {
          this.settings = res.data;
          if (this.app) this.app.settings = res.data;
        }
      }).catch(() => {});
    } else if (this.app?.settings && !this.settings?.shop_name) {
      this.settings = this.app.settings;
    }
    const warmIdle = () => {
      const today = Utils.today();
      const dc = window.DataCache;
      dc?.prefetch?.('categories', [{}], () => API.getCategories({}), { ttlMs: 300000 });
      if (this.section === 'overview') {
        dc?.prefetch?.('adminDashboard', [today, today], () => API.getAdminDashboard(today, today), { ttlMs: 45000 });
      }
      // Warm common extenders in the background without blocking first paint
      const rest = window.App?._adminExtenderAll || [];
      let i = 0;
      const tick = () => {
        if (i >= rest.length) return;
        const src = rest[i++];
        Utils.loadScript?.(src).catch(() => {}).finally(() => {
          if (typeof requestIdleCallback === 'function') requestIdleCallback(tick, { timeout: 2000 });
          else setTimeout(tick, 120);
        });
      };
      tick();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warmIdle, { timeout: 2500 });
    else setTimeout(warmIdle, 400);
  },

  async _ensureAdminScripts(checkFn, sectionId) {
    if (checkFn?.()) return;
    const sid = sectionId || this.section;
    if (window.App?.ensureAdminSectionScripts) {
      await App.ensureAdminSectionScripts(sid);
      if (checkFn?.()) return;
    }
    if (!this._adminScriptsP && window.App?.ensurePageScripts) {
      this._adminScriptsP = App.ensurePageScripts('admin').catch(() => {});
    }
    if (this._adminScriptsP) await this._adminScriptsP;
    if (!checkFn?.() && window.App?.ensureAdminSectionScripts) {
      await App.ensureAdminSectionScripts(sid);
    }
  },

  /** Revisit admin page without rebuilding the shell. */
  async activate(el, app) {
    this.app = app;
    if (!el?.querySelector?.('.admin-layout')) return this.render(el, app);
    el.querySelectorAll('.admin-nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.section === this.section);
    });
    this.toggleOpsComplianceLayout(this.section === 'opscompliance');
    this.renderSection(document.getElementById('admin-content'));
  },

  studioLockSections() {
    try {
      const raw = sessionStorage.getItem('shoppos_studio_lock') || '';
      if (!raw) return null;
      const set = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
      return set.size ? set : null;
    } catch (_) {
      return null;
    }
  },

  applyStudioLockSection() {
    const lock = this.studioLockSections();
    if (!lock) return;
    try {
      const pending = window.App?._pendingAdminSection;
      if (pending && lock.has(pending)) {
        this.section = pending;
        try { delete window.App._pendingAdminSection; } catch (_) { /* */ }
        return;
      }
      const preferred = sessionStorage.getItem('shoppos_studio_section');
      if (preferred && lock.has(preferred)) this.section = preferred;
      else if (!lock.has(this.section)) this.section = [...lock][0];
    } catch (_) { /* */ }
  },

  refreshAdminNav(containerEl) {
    const root = containerEl || document.querySelector('.admin-layout');
    const nav = root?.querySelector('#admin-nav');
    if (!nav || !this.app?.user) return;
    const studioLock = this.studioLockSections();
    const visible = this.sections.filter((s) =>
      Utils.canAccessAdminSectionByRole(this.app.user, s.id) && (!studioLock || studioLock.has(s.id))
    );
    nav.innerHTML = this._renderAdminNavHtml(visible);
  },

  async saveWebGlobalSettings(payload) {
    if (typeof API.webSaveGlobalSettings !== 'function') {
      Utils.toast('Online settings are not available on this server — update the app or redeploy', 'error');
      return null;
    }
    const r = await API.webSaveGlobalSettings(payload, this.app?.user);
    if (r?.success === false) {
      Utils.toast(r.error || 'Save failed', 'error');
      return null;
    }
    return r;
  },

  async renderSection(el) {
    if (!el) return;
    this.toggleOpsComplianceLayout?.(this.section === 'opscompliance');
    const host = this._sectionHost(el);
    const reused = !!(host && host.childElementCount);
    const gen = this._beginSectionRender(host || el);
    if (reused) {
      const liveSections = new Set([
        'overview', 'online-orders', 'approvals', 'hr-approvals'
      ]);
      if (!liveSections.has(this.section)) return;
      this._renderSectionCore(host, gen).catch(() => {});
      return;
    }
    await this._renderSectionCore(host || el, gen);
  },

  async _renderSectionCore(el, gen) {
    if (this.section === 'deliveries') this.section = 'delivery-dept';
    const lazySections = new Set([
      'hrcontracts', 'recruitment', 'employee-of-month', 'staffhr', 'hr-workspace', 'hr-approvals', 'staffportal', 'payroll',
      'opscompliance', 'combos', 'recipe', 'quotes', 'menu-builder', 'promo-video-builder', 'radio', 'communication-center',
      'salesmgmt', 'saleexplorer', 'soldproducts', 'returnsmgmt', 'activity',
      'exceptions', 'alerts', 'dailyclose', 'discount-report', 'delivery-dept', 'referral-dept', 'taken-orders'
    ]);
    if (lazySections.has(this.section)) {
      this._prefetchAdmin();
    }

    if (this.section === 'recipe') {
      return this.renderRecipeSection(el);
    }

    const tryModule = async (getPage, renderFn, label) => {
      if (!el.querySelector('h2, h3')) {
        el.innerHTML = `<div class="admin-section"><h3>${label}</h3><p class="muted">Opening…</p></div>`;
      }
      if (getPage()) return renderFn();
      await this._ensureAdminScripts(getPage, this.section);
      if (getPage()) return renderFn();
      el.innerHTML = `<div class="admin-section"><h3>${label}</h3><p class="muted">${label} is ready after a refresh if this stays empty.</p>
        <button type="button" class="btn btn-primary" id="admin-retry-mod">Retry</button></div>`;
      el.querySelector('#admin-retry-mod')?.addEventListener('click', async () => {
        this._adminScriptsP = null;
        if (window.Utils?._loadedScripts) {
          [...Utils._loadedScripts].filter((s) => /admin-/.test(s)).forEach((s) => Utils._loadedScripts.delete(s));
        }
        await this._ensureAdminScripts(getPage, this.section);
        if (getPage()) return renderFn();
        Utils.toast('Hard refresh the page (Ctrl+Shift+R)', 'error');
      });
    };

    const renderers = {
      overview: async () => {
        if (typeof this.renderBusinessDashboard === 'function') {
          const dashResult = await this.renderBusinessDashboard(el);
          let host = el.querySelector('#admin-overview-quick-panel');
          if (!host) {
            host = document.createElement('div');
            host.id = 'admin-overview-quick-panel';
            host.style.marginTop = '16px';
            el.appendChild(host);
          }
          if (typeof this.renderOverviewQuickPanel === 'function') {
            await this.renderOverviewQuickPanel(host, { dashboardRes: dashResult });
          }
          return;
        }
        return this.renderOverview(el);
      },
      salesmgmt: () => tryModule(() => typeof this.renderSalesManagement === 'function', () => this.renderSalesManagement(el), 'Sales Management'),
      saleexplorer: () => tryModule(() => typeof this.renderSalesExplorer === 'function', () => this.renderSalesExplorer(el), 'Sales Explorer'),
      soldproducts: () => tryModule(() => typeof this.renderSoldProducts === 'function', () => this.renderSoldProducts(el), 'Sold Products'),
      returnsmgmt: () => tryModule(() => typeof this.renderReturnsMgmt === 'function', () => this.renderReturnsMgmt(el), 'Returns'),
      activity: () => tryModule(() => typeof this.renderActivityLog === 'function', () => this.renderActivityLog(el), 'Activity Log'),
      exceptions: () => tryModule(() => typeof this.renderExceptions === 'function', () => this.renderExceptions(el), 'Exceptions'),
      alerts: () => tryModule(() => typeof this.renderAlertsCenter === 'function', () => this.renderAlertsCenter(el), 'Alerts Center'),
      dailyclose: () => tryModule(() => typeof this.renderDailyClosing === 'function', () => this.renderDailyClosing(el), 'Daily Closing'),
      'discount-report': () => tryModule(() => typeof this.renderDiscountReport === 'function', () => this.renderDiscountReport(el), 'Discount Report'),
      'pos-menu': () => tryModule(() => typeof this.renderPosMenuPromos === 'function', () => this.renderPosMenuPromos(el), 'POS Menu & Promos'),
      printer: () => this.renderPrinter(el),
      payments: () => this.renderPaymentMethods(el),
      receipt: () => this.renderReceiptDesigner(el),
      security: () => this.renderSecurity(el),
      permissions: () => this.renderPermissions(el),
      'sales-targets': () => this.renderSalesTargets(el),
      'top-customers': () => this.renderTopCustomers(el),
      approvals: () => this.renderSettingsApprovals(el),
      tax: () => this.renderTaxCurrency(el),
      'tax-hub': () => this.renderTaxHub(el),
      cashiers: () => this.renderCashiersPanel(el),
      shifts: () => this.renderShifts(el),
      operating: () => this.renderOperatingHours(el),
      cashdrawer: () => this.renderCashDrawer(el),
      analytics: () => this.renderAnalytics(el),
      inventory: () => this.renderInventory(el),
      discounts: () => this.renderDiscounts(el),
      loyalty: () => this.renderLoyalty(el),
      'customer-rewards': () => { this._loyaltyTab = 'rewards'; return this.renderLoyalty(el); },
      importexport: () => this.renderImportExport(el),
      customize: () => this.renderCustomize(el),
      branches: () => this.renderBranchesSync(el),
      'online-orders': () => this.renderOnlineOrders(el),
      'customer-reports': () => this.renderCustomerReports(el),
      'mobile-app': () => this.renderMobileAppUsers(el),
      'business-modules': async () => tryModule(
        () => window.AdminBusinessModulesPage,
        () => window.AdminBusinessModulesPage.render(el, this),
        'Business Modules'
      ),
      'digital-signage': () => {
        el.innerHTML = `<div class="admin-section">
          <h2>📺 Digital Signage &amp; Shop Media Centre</h2>
          <p class="muted" style="max-width:720px;line-height:1.5">
            <strong>How it works:</strong> Open <em>TV Player</em> on the shop TV — it shows a 6-digit pairing code.
            Approve that code here (or in Signage Centre). After approval the TV plays menus, playlists and music.
            This is <strong>not</strong> a login screen for you — the code is only for linking that TV to your shop.
          </p>
          <div class="card" style="margin-top:12px"><div class="card-body">
            <h4 style="margin:0 0 8px">Sign in to Signage Centre</h4>
            <p style="margin:0 0 8px;line-height:1.5">Use your <strong>Admin username and password</strong> (same as Shop POS),
              or the Signage account: <code>signage</code> / <code>signage123</code>.</p>
            <div class="admin-quick-actions" style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" class="btn btn-primary" id="admin-signage-open-sso">Open Signage Centre (Admin login)</button>
              <a class="btn btn-ghost" href="/signage/" target="_blank" rel="noopener">Open Signage Centre (new tab)</a>
              <a class="btn btn-ghost" href="/signage-player/" target="_blank" rel="noopener">Open TV Player</a>
              <button type="button" class="btn btn-ghost" id="admin-signage-refresh-pair">Refresh pairing codes</button>
            </div>
            <div id="admin-signage-summary" class="muted" style="margin-top:12px">Loading status…</div>
          </div></div>
          <div class="card" style="margin-top:12px"><div class="card-body">
            <h4 style="margin:0 0 8px">TV screens waiting to pair</h4>
            <div id="admin-signage-pending"><p class="muted">Loading…</p></div>
          </div></div>
          <iframe id="admin-signage-frame" class="hidden" style="width:100%;height:80vh;border:1px solid var(--border);border-radius:8px;margin-top:12px" title="Digital Signage"></iframe>
        </div>`;

        const paintSummary = () => {
          API.signageSummary(this.app.user).then((r) => {
            const s = r?.data || r || {};
            const box = el.querySelector('#admin-signage-summary');
            if (box) box.innerHTML = `Screens: <strong>${s.online_screens ?? 0}</strong> online / ${s.total_screens ?? 0} total`;
          }).catch(() => {});
        };

        const paintPending = async () => {
          const box = el.querySelector('#admin-signage-pending');
          if (!box) return;
          try {
            const r = await API.signagePendingPairingsAdmin(this.app.user);
            const list = r?.data || r || [];
            if (!list.length) {
              box.innerHTML = '<p class="muted">No TVs waiting. Open TV Player on a screen to get a code.</p>';
              return;
            }
            box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Expires</th><th></th></tr></thead><tbody>
              ${list.map((p) => `<tr>
                <td style="font-size:1.4rem;font-weight:700;letter-spacing:4px">${Utils.escHtml(p.pairing_code)}</td>
                <td>${Utils.escHtml(p.expires_at || '')}</td>
                <td><button type="button" class="btn btn-primary btn-sm" data-approve-code="${Utils.escHtml(p.pairing_code)}">Approve this TV</button></td>
              </tr>`).join('')}
            </tbody></table></div>`;
            box.querySelectorAll('[data-approve-code]').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const code = btn.dataset.approveCode;
                const name = prompt('Name this screen (e.g. Front TV)', `Screen ${code}`) || `Screen ${code}`;
                const res = await API.signageApprovePairingAdmin(code, { name }, this.app.user);
                if (res?.success === false) return Utils.toast(res.error || 'Approve failed', 'error');
                Utils.toast('TV paired — it should start playing shortly', 'success');
                paintPending();
                paintSummary();
              });
            });
          } catch (err) {
            box.innerHTML = `<p class="muted">${Utils.escHtml(err.message || 'Could not load pairing codes')}</p>`;
          }
        };

        paintSummary();
        paintPending();
        el.querySelector('#admin-signage-refresh-pair')?.addEventListener('click', () => paintPending());
        el.querySelector('#admin-signage-open-sso')?.addEventListener('click', async () => {
          try {
            const r = await API.signageLoginAsAdmin(this.app.user);
            const data = r?.data || r;
            if (!data?.token) throw new Error(r?.error || 'Could not open Signage Centre');
            const url = `/signage/?sso=${encodeURIComponent(data.token)}`;
            window.open(url, '_blank', 'noopener');
          } catch (err) {
            Utils.toast(err.message || 'SSO failed — open Signage Centre and use your Admin password', 'error');
          }
        });
      },
      'business-manager': () => this.renderBusinessManager(el),
      device: () => this.renderDevice(el),
      backup: () => this.renderBackup(el),
      hrcontracts: async () => tryModule(
        () => window.AdminHrPage,
        () => window.AdminHrPage.render(el, this),
        'Contracts & Probation'
      ),
      recruitment: async () => tryModule(
        () => window.AdminRecruitmentPage,
        () => window.AdminRecruitmentPage.render(el, this),
        'Recruitment'
      ),
      'delivery-dept': async () => tryModule(
        () => window.AdminDeliveryPage,
        () => window.AdminDeliveryPage.render(el, this.app || this),
        'Delivery Department'
      ),
      'referral-dept': async () => tryModule(
        () => window.AdminReferralPage,
        () => window.AdminReferralPage.render(el, this.app || this),
        'Referral & Commission'
      ),
      'employee-of-month': async () => tryModule(
        () => window.AdminEmployeeMonthPage,
        () => window.AdminEmployeeMonthPage.render(el, this),
        'Employee of Month'
      ),
      quotes: async () => tryModule(
        () => typeof this.renderQuotesAdmin === 'function',
        () => this.renderQuotesAdmin(el),
        'Quotes'
      ),
      staffportal: () => tryModule(
        () => typeof this.renderStaffPortalHub === 'function',
        () => this.renderStaffPortalHub(el),
        'Staff Portal'
      ),
      staffhr: () => tryModule(
        () => typeof this.renderStaffHR === 'function',
        () => this.renderStaffHR(el),
        'Staff & HR'
      ),
      'hr-workspace': () => {
        el.innerHTML = `<div class="admin-section">
          <h2>HR, Payroll &amp; Documents</h2>
          <p class="muted">Human Resources, Payroll, Employee Records, Contracts &amp; Compliance Management — unified workspace connected to your existing employees, attendance, payroll and accounting.</p>
          <div class="admin-quick-actions" style="margin:16px 0;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary" id="admin-open-hr-workspace">Open HR Workspace</button>
            <button type="button" class="btn btn-ghost" id="admin-open-hr-approvals">HR Approvals</button>
          </div>
          <p class="muted" style="font-size:13px">HR can prepare the same Staff/Payroll work as Admin. Finalizing (pay salary, approve claims, apply employee/salary changes) happens here under <strong>HR Approvals</strong>.</p>
        </div>`;
        el.querySelector('#admin-open-hr-workspace')?.addEventListener('click', () => this.app?.openHr?.({ fromApp: true }));
        el.querySelector('#admin-open-hr-approvals')?.addEventListener('click', () => {
          this.section = 'hr-approvals';
          this.renderSection(document.getElementById('admin-content'));
        });
      },
      'hr-approvals': () => this.renderHrApprovals(el),
      'accounting-workspace': () => {
        el.innerHTML = `<div class="admin-section">
          <h2>Bookkeeping &amp; Accounting</h2>
          <p class="muted">Bookkeeping is your day-to-day cash book, income, expenses, budgets, donations, and reports. Accounting is the full command centre for journals, invoices, bank reconciliation, and trial balance.</p>
          <div class="admin-quick-actions" style="margin:16px 0;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary" id="admin-open-bookkeeping">Open Bookkeeping</button>
            <button type="button" class="btn btn-ghost" id="admin-open-accounting">Open Accounting Command Centre</button>
          </div>
          <p class="muted" style="font-size:13px">Inside Bookkeeping there is also an Accounting tab. POS sales, online orders, expenses, payroll and cash-ups can post to both bookkeeping and the central GL.</p>
        </div>`;
        el.querySelector('#admin-open-bookkeeping')?.addEventListener('click', () => this.app?.navigate('bookkeeping'));
        el.querySelector('#admin-open-accounting')?.addEventListener('click', () => this.app?.openAccounting?.({ fromApp: true, skipLogin: true }));
      },
      onaccount: () => tryModule(
        () => typeof this.renderOnAccount === 'function',
        () => this.renderOnAccount(el),
        'On Account'
      ),
      'taken-orders': () => tryModule(
        () => typeof this.renderTakenOrders === 'function',
        () => this.renderTakenOrders(el),
        'Taken / Unpaid Orders'
      ),
      combos: async () => {
        await this._ensureAdminScripts(() => window.AdminCombosPage);
        if (window.AdminCombosPage) return window.AdminCombosPage.render(el, this);
        el.innerHTML = `<div class="admin-section"><p class="muted">Combos module loading…</p>
          <button type="button" class="btn btn-primary" id="admin-reload-combos">Reload</button></div>`;
        document.getElementById('admin-reload-combos')?.addEventListener('click', async () => {
          await this._ensureAdminScripts(() => window.AdminCombosPage);
          if (window.AdminCombosPage) return window.AdminCombosPage.render(el, this);
          Utils.toast('Could not load combos module — hard refresh the page', 'error');
        });
      },
      'menu-builder': async () => {
        // Paint shell immediately so the section never feels stuck on "Loading…"
        el.innerHTML = `<div class="mb-root" style="padding:16px">
          <h2 style="margin:0 0 6px">Menu Builder</h2>
          <p class="muted" style="margin:0 0 12px">Create professional menus in seconds.</p>
          <div class="mb-skel" style="height:14px;background:var(--border,#e2e8f0);border-radius:6px;margin-bottom:8px;opacity:.6"></div>
          <div class="mb-skel" style="height:14px;background:var(--border,#e2e8f0);border-radius:6px;width:70%;opacity:.5"></div>
        </div>`;
        const ensureMenu = async () => {
          const load = async (src) => {
            if (typeof Utils?.reloadScript === 'function') {
              try { await Utils.reloadScript(src); return; } catch (_) { /* fall through */ }
            }
            if (typeof Utils?.loadScript === 'function') await Utils.loadScript(src);
          };
          try {
            if (!window.PromoPoster) await load('js/promo-poster.js').catch(() => {});
            // Always reload so deploys replace any stale in-memory Menu Builder
            delete window.AdminMenuBuilderPage;
            if (typeof Utils?.reloadScript === 'function') await Utils.reloadScript('js/pages/admin-menu-builder.js');
            else await load('js/pages/admin-menu-builder.js');
          } catch (_) {
            await this._ensureAdminScripts(() => window.AdminMenuBuilderPage);
          }
          return !!window.AdminMenuBuilderPage;
        };
        try {
          if (await ensureMenu()) return window.AdminMenuBuilderPage.render(el, this);
        } catch (err) {
          console.error('Menu Builder failed', err);
        }
        el.innerHTML = `<div class="admin-section"><h3>Menu Builder</h3>
          <p class="muted">Could not open Menu Builder.</p>
          <button type="button" class="btn btn-primary" id="admin-reload-menu">Retry</button></div>`;
        document.getElementById('admin-reload-menu')?.addEventListener('click', async () => {
          try {
            if (await ensureMenu()) return window.AdminMenuBuilderPage.render(el, this);
          } catch (_) { /* */ }
          Utils.toast('Hard refresh the page (Ctrl+Shift+R)', 'error');
        });
      },
      'promo-video-builder': async () => {
        el.innerHTML = `<div class="pvb-root" style="padding:16px">
          <h2 style="margin:0 0 6px">Promo Video Builder</h2>
          <p class="muted" style="margin:0 0 12px">Create promotional videos automatically.</p>
          <div class="pvb-skel"></div><div class="pvb-skel"></div>
        </div>`;
        const ensurePvb = async () => {
          const load = async (src) => {
            if (typeof Utils?.reloadScript === 'function') {
              try { await Utils.reloadScript(src); return; } catch (_) { /* */ }
            }
            if (typeof Utils?.loadScript === 'function') await Utils.loadScript(src);
          };
          try {
            if (!window.PromoPoster) await load('js/promo-poster.js').catch(() => {});
            delete window.AdminPromoVideoBuilderPage;
            if (typeof Utils?.reloadScript === 'function') {
              await Utils.reloadScript('js/pages/admin-promo-video-builder.js');
              await Utils.reloadScript('js/pages/admin-promo-video-advanced.js');
            } else {
              await load('js/pages/admin-promo-video-builder.js');
              await load('js/pages/admin-promo-video-advanced.js');
            }
          } catch (_) {
            await this._ensureAdminScripts(() => window.AdminPromoVideoBuilderPage);
          }
          return !!window.AdminPromoVideoBuilderPage;
        };
        try {
          if (await ensurePvb()) return window.AdminPromoVideoBuilderPage.render(el, this);
        } catch (err) {
          console.error('Promo Video Builder failed', err);
        }
        el.innerHTML = `<div class="admin-section"><h3>Promo Video Builder</h3>
          <p class="muted">Could not open Promo Video Builder.</p>
          <button type="button" class="btn btn-primary" id="admin-reload-pvb">Retry</button></div>`;
        document.getElementById('admin-reload-pvb')?.addEventListener('click', async () => {
          try {
            if (await ensurePvb()) return window.AdminPromoVideoBuilderPage.render(el, this);
          } catch (_) { /* */ }
          Utils.toast('Hard refresh the page (Ctrl+Shift+R)', 'error');
        });
      },
      'radio': async () => {
        try {
          const load = (src) => (typeof Utils?.loadScript === 'function' ? Utils.loadScript(src) : Promise.resolve());
          if (typeof Utils?.reloadScript === 'function') await Utils.reloadScript('js/pages/admin-radio.js');
          else if (!window.AdminRadioPage) await load('js/pages/admin-radio.js');
          if (window.AdminRadioPage?.render) {
            return window.AdminRadioPage.render(el, this.app);
          }
        } catch (err) {
          console.error('Radio admin failed', err);
        }
        el.innerHTML = `<div class="admin-section"><h3>📻 Radio</h3>
          <p class="muted">Could not open Radio. Hard refresh (Ctrl+Shift+R) and try again.</p></div>`;
      },
      'communication-center': async () => {
        try {
          const load = (src) => (typeof Utils?.loadScript === 'function' ? Utils.loadScript(src) : Promise.resolve());
          if (!document.querySelector('link[data-cc-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'css/communication-center.css';
            link.dataset.ccCss = '1';
            document.head.appendChild(link);
          }
          if (typeof Utils?.reloadScript === 'function') await Utils.reloadScript('js/pages/admin-communication-center.js');
          else if (!window.AdminCommunicationCenterPage) await load('js/pages/admin-communication-center.js');
          if (window.AdminCommunicationCenterPage?.render) {
            return window.AdminCommunicationCenterPage.render(el, this.app);
          }
        } catch (err) {
          console.error('Communication Center failed', err);
        }
        el.innerHTML = `<div class="admin-section"><h3>📣 Communication Center</h3>
          <p class="muted">Could not open Communication Center. Hard refresh (Ctrl+Shift+R) and try again.</p></div>`;
      },
      opscompliance: () => tryModule(
        () => typeof this.renderOpsCompliance === 'function',
        () => this.renderOpsCompliance(el),
        'Operations & Compliance'
      ),
      payroll: () => tryModule(
        () => typeof this.renderPayrollCompliance === 'function',
        () => this.renderPayrollCompliance(el),
        'Payroll & Compliance'
      ),
      developer: () => tryModule(
        () => typeof this.renderDeveloper === 'function',
        () => this.renderDeveloper(el),
        'Developer Mode'
      ),
      formats: () => tryModule(
        () => typeof this.renderFormats === 'function',
        () => this.renderFormats(el),
        'Formats & Numbering'
      ),
      automation: () => tryModule(
        () => typeof this.renderAutomation === 'function',
        () => this.renderAutomation(el),
        'Automation Rules'
      ),
      customfields: () => tryModule(
        () => typeof this.renderCustomFields === 'function',
        () => this.renderCustomFields(el),
        'Custom Fields'
      ),
      database: () => tryModule(
        () => typeof this.renderDatabase === 'function',
        () => this.renderDatabase(el),
        'Database Manager'
      ),
      'system-health': () => tryModule(
        () => typeof this.renderSystemHealthStorage === 'function',
        () => this.renderSystemHealthStorage(el),
        'System Health · Database & Storage'
      )
    };
    const renderer = renderers[this.section];
    if (renderer) {
      await Promise.resolve(renderer());
      if (gen !== this._sectionGen) return;
      return;
    }
    await this._ensureAdminScripts(() => false);
    if (gen !== this._sectionGen) return;
    el.innerHTML = `<div class="admin-section"><p class="muted">The "${Utils.escHtml(this.section)}" section could not load. Try reloading admin modules.</p>
        <button type="button" class="btn btn-primary" id="admin-reload-ext">Reload</button></div>`;
    document.getElementById('admin-reload-ext')?.addEventListener('click', async () => {
      await this._ensureAdminScripts(() => false);
      await AdminPage.renderSection(el);
    });
  },

  async renderOverviewQuickPanel(container, opts = {}) {
    const el = container || document.createElement('div');
    if (!container) el.className = 'admin-section';
    const s = this.settings;
    const today = Utils.today();
    let dashRes = opts.dashboardRes || null;
    if (!dashRes?.success) {
      const cached = window.DataCache?.peek?.('adminDashboard', [today, today]);
      if (cached?.data) dashRes = { success: true, data: cached.data };
    }
    const currency = s.currency || 'R';
    const paintOverview = (d, todayStats, dashErr, targetInfo = null) => {
    const todaySalesAmt = Number(d.today?.sales ?? todayStats.todaySales ?? 0) || 0;
    const dailyTarget = Number(targetInfo?.amount || 0) || 0;
    const targetPct = dailyTarget > 0 ? Math.min(100, Math.round((todaySalesAmt / dailyTarget) * 100)) : 0;
    const targetMet = dailyTarget > 0 && todaySalesAmt >= dailyTarget;
    el.innerHTML = `${container ? '' : '<div class="admin-section">'}
      <h4 style="margin-top:0">Quick admin snapshot</h4>
      <p class="muted">Till rules, printers, PINs, loyalty, and staff live here. Shop name / theme / backup is under sidebar <strong>Settings</strong>.</p>
      ${dashErr}
      <div class="stats-grid" style="margin-top:20px">
        <div class="stat-card primary"><div class="label">Today's Sales</div><div class="value">${Utils.formatMoney(todaySalesAmt, currency)}</div><small>${d.today?.orders ?? todayStats.todayCount ?? 0} orders</small></div>
        <div class="stat-card ${targetMet ? 'success' : ''}"><div class="label">Today's Sales Target</div><div class="value">${dailyTarget > 0 ? `${targetPct}%` : '—'}</div><small>${dailyTarget > 0 ? `${Utils.formatMoney(todaySalesAmt, currency)} / ${Utils.formatMoney(dailyTarget, currency)}${targetMet ? ' · Met' : ''}` : 'Set under Sales Targets'}</small></div>
        <div class="stat-card success"><div class="label">Gross Profit Today</div><div class="value">${Utils.formatMoney(d.today?.grossProfit ?? todayStats.profit ?? 0, currency)}</div></div>
        <div class="stat-card"><div class="label">This Month</div><div class="value">${Utils.formatMoney(d.month?.sales ?? 0, currency)}</div></div>
        <div class="stat-card warning"><div class="label">Low Stock</div><div class="value">${d.lowStock?.length ?? todayStats.lowStockCount ?? 0}</div></div>
        <div class="stat-card warning" id="overview-food-alert-stat"><div class="label">Food Cost Alerts</div><div class="value">…</div><small>loading</small></div>
        <div class="stat-card"><div class="label">Shop</div><div class="value" style="font-size:18px">${s.shop_name}</div></div>
        <div class="stat-card"><div class="label">Pending Leave</div><div class="value">${d.pendingLeave ?? 0}</div></div>
      </div>
      <div id="overview-food-alerts-host"></div>
      <div id="overview-biz-modules-host"><p class="muted" style="margin-top:16px">Loading business modules…</p></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Business Manager</h4>
        <p class="muted">Monitor sales, orders, and POS status on your phone or here in Admin — no extra login when you open it from Admin.</p>
        <div class="admin-quick-actions" style="margin-top:12px">
          <button type="button" class="btn btn-primary" id="admin-open-business-manager">Open Business Manager</button>
          <button type="button" class="btn btn-ghost" id="admin-manage-mobile-users">Manage mobile users</button>
          <button type="button" class="btn btn-ghost" id="admin-open-accounting-overview">Accounting &amp; Bookkeeping</button>
        </div>
      </div></div>
    ${container ? '' : '</div>'}`;
    delete el.dataset.ovActionsBound;
    this._bindOverviewQuickActions(el);
    Promise.all([
      API.recipeFoodCostAlerts(this.app.user).catch(() => ({ success: false })),
      API.bizModulesSummary(this.app.user).catch(() => ({ success: false }))
    ]).then(([foodRes, bizRes]) => {
      if (!el.isConnected) return;
      const foodAlerts = foodRes.success ? (foodRes.data || []) : [];
      const biz = bizRes.success ? (bizRes.data || {}) : {};
      const inv = biz.investor || {};
      const rel = biz.release || {};
      const mtg = biz.meeting || {};
      const stat = el.querySelector('#overview-food-alert-stat');
      if (stat) {
        stat.querySelector('.value').textContent = String(foodAlerts.length);
        const sm = stat.querySelector('small');
        if (sm) sm.textContent = 'meals over target';
      }
      const foodHost = el.querySelector('#overview-food-alerts-host');
      if (foodHost && foodAlerts.length) {
        foodHost.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body">
          <h4>Food cost / margin alerts</h4>
          <p class="muted">Meals where food cost is high or profit margin is low after ingredient prices change.</p>
          <div class="table-wrap"><table><thead><tr><th>Meal</th><th>Food cost %</th><th>Margin %</th><th>Cost</th><th>Sell</th></tr></thead>
            <tbody>${foodAlerts.slice(0, 8).map(a => `<tr>
              <td>${a.name}</td><td>${a.food_cost_pct ?? 0}%</td><td>${a.profit_margin ?? 0}%</td>
              <td>${Utils.formatMoney(a.recipe_cost || 0, currency)}</td>
              <td>${Utils.formatMoney(a.selling_price || 0, currency)}</td>
            </tr>`).join('')}</tbody></table></div>
          <button type="button" class="btn btn-primary" id="admin-open-recipe" style="margin-top:10px">Open Recipe & Production</button>
        </div></div>`;
        foodHost.querySelector('#admin-open-recipe')?.addEventListener('click', () => {
          this.app.openRecipeProduction({ fromApp: true });
        });
      }
      const bizHost = el.querySelector('#overview-biz-modules-host');
      if (bizHost) {
        bizHost.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body">
          <h4>Business Modules</h4>
          <p class="muted">Investor Management, App Release Centre, and AI Meeting Centre — each with separate login portals.</p>
          <div class="stats-grid" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            <div class="stat-card" style="cursor:pointer" data-bm-section="business-modules" data-bm-tab="investors">
              <div class="label">Investors</div>
              <div class="value">${inv.active_investors ?? 0}</div>
              <small>${inv.pending_agreements ?? 0} pending agreements</small>
            </div>
            <div class="stat-card" style="cursor:pointer" data-bm-section="business-modules">
              <div class="label">Release Centre</div>
              <div class="value" style="font-size:16px">${Utils.escHtml(rel.current_version || '—')}</div>
              <small>Last test: ${Utils.escHtml(rel.last_test_status || 'NOT_TESTED')}</small>
            </div>
            <div class="stat-card" style="cursor:pointer" data-bm-section="business-modules">
              <div class="label">Meetings</div>
              <div class="value">${mtg.meetings_this_month ?? 0}</div>
              <small>${mtg.outstanding_action_items ?? 0} action items</small>
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="admin-open-business-modules" style="margin-top:12px">Manage Business Modules</button>
        </div></div>`;
        bizHost.querySelector('#admin-open-business-modules')?.addEventListener('click', () => {
          this.section = 'business-modules';
          document.querySelectorAll('.admin-nav-btn').forEach((b) =>
            b.classList.toggle('active', b.dataset.section === 'business-modules'));
          this.renderSection(document.getElementById('admin-content'));
        });
        bizHost.querySelectorAll('[data-bm-section]').forEach((card) => {
          card.addEventListener('click', () => {
            this.section = card.dataset.bmSection;
            document.querySelectorAll('.admin-nav-btn').forEach((b) =>
              b.classList.toggle('active', b.dataset.section === 'business-modules'));
            this.renderSection(document.getElementById('admin-content'));
          });
        });
      }
    }).catch(() => {});
    };
    const d = dashRes?.success ? (dashRes.data || {}) : {};
    const resolveDailyTarget = async () => {
      try {
        const res = await API.getSalesTargets();
        const raw = res?.data || res || {};
        const daily = raw.daily;
        if (daily != null && typeof daily === 'object') {
          const amount = Number(daily.amount) || 0;
          const active = daily.active !== false;
          const expired = daily.expires_at && String(daily.expires_at).slice(0, 10) < today;
          if (active && amount > 0 && !expired) return { amount };
          return { amount: 0 };
        }
        const amount = Number(daily) || 0;
        return { amount: amount > 0 ? amount : 0 };
      } catch (_) {
        return { amount: 0 };
      }
    };
    paintOverview(d, {}, '', null);
    (async () => {
      const targetInfo = await resolveDailyTarget();
      if (!el.isConnected) return;
      if (dashRes?.success) {
        paintOverview(d, {}, '', targetInfo);
        return;
      }
      const nextDash = await API.getAdminDashboard(today, today).catch(() => ({ success: false }));
      let todayRes = { success: false };
      if (!nextDash.success) {
        todayRes = await API.getDashboardStats(today, today, this.app.user).catch(() => ({ success: false }));
      }
      if (!el.isConnected) return;
      const nextData = nextDash.success ? (nextDash.data || {}) : {};
      const todayStats = todayRes.success ? (todayRes.data || {}) : {};
      const dashErr = !nextDash.success && !todayRes.success
        ? `<p class="muted" style="color:var(--danger)">Stats unavailable: ${Utils.escHtml(nextDash.error || todayRes.error || 'error')}</p>`
        : '';
      paintOverview(nextData, todayStats, dashErr, targetInfo);
    })();
    return el;
  },

  _bindOverviewQuickActions(el) {
    if (el.dataset.ovActionsBound === '1') return;
    el.dataset.ovActionsBound = '1';
    const adminContent = () => document.getElementById('admin-content');
    el.querySelector('#admin-open-business-modules')?.addEventListener('click', () => {
      this.section = 'business-modules';
      document.querySelectorAll('.admin-nav-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.section === 'business-modules'));
      this.renderSection(adminContent());
    });
    el.querySelectorAll('[data-bm-section]').forEach((card) => {
      card.addEventListener('click', () => {
        this.section = card.dataset.bmSection;
        document.querySelectorAll('.admin-nav-btn').forEach((b) =>
          b.classList.toggle('active', b.dataset.section === 'business-modules'));
        this.renderSection(adminContent());
      });
    });
    el.querySelector('#admin-open-recipe')?.addEventListener('click', () => {
      this.app.openRecipeProduction({ fromApp: true });
    });
    el.querySelector('#admin-open-business-manager')?.addEventListener('click', () => {
      this.app?.openBusinessManager?.({ embed: true });
    });
    el.querySelector('#admin-manage-mobile-users')?.addEventListener('click', () => {
      this.section = 'mobile-app';
      document.querySelectorAll('.admin-nav-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.section === 'mobile-app'));
      this.renderSection(adminContent());
    });
    el.querySelector('#admin-open-accounting-overview')?.addEventListener('click', () => {
      this.app?.openAccounting?.({ fromApp: true, skipLogin: true });
    });
  },

  async renderOverview(el) {
    return this.renderOverviewQuickPanel(el);
  },

  async renderRecipeSection(el) {
    el.innerHTML = `<div class="admin-section">
      <h3>Recipe & Production</h3>
      <p class="muted">Same module as the kitchen Recipe system — meal recipes, capacity, restock, waste, and promotions. Colours match this Admin Panel.</p>
      <div class="card"><div class="card-body">
        <p>Open the full Recipe & Production workspace (uses your current Admin login — no second password for Owner/Manager).</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
          <button type="button" class="btn btn-primary" id="admin-rp-open">Open Recipe & Production</button>
          <button type="button" class="btn btn-ghost" id="admin-rp-export">Export recipes (branch sync)</button>
          <button type="button" class="btn btn-ghost" id="admin-rp-import">Import recipes…</button>
        </div>
        <input type="file" id="admin-rp-file" accept="application/json,.json" class="hidden">
      </div></div>
    </div>`;
    document.getElementById('admin-rp-open')?.addEventListener('click', () => {
      this.app.openRecipeProduction({ fromApp: true });
    });
    document.getElementById('admin-rp-export')?.addEventListener('click', async () => {
      const r = await API.recipeExportBundle(this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Export failed', 'error');
      const json = JSON.stringify(r.data, null, 2);
      const bytes = Array.from(new TextEncoder().encode(json));
      await API.saveFile(`recipe-bundle-${Utils.today()}.json`, [{ name: 'JSON', extensions: ['json'] }], bytes);
      Utils.toast(`Exported ${(r.data?.meals || []).length} meals`, 'success');
    });
    document.getElementById('admin-rp-import')?.addEventListener('click', () => {
      document.getElementById('admin-rp-file')?.click();
    });
    document.getElementById('admin-rp-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        const r = await API.recipeImportBundle(bundle, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Import failed', 'error');
        Utils.toast(`Imported ${r.data?.imported || 0} of ${r.data?.total || 0} meals`, 'success');
      } catch (err) {
        Utils.toast(err.message || 'Invalid recipe file', 'error');
      }
      e.target.value = '';
    });
  },

  async renderPrinter(el) {
    const ps = this.settings.printer_settings || {};
    let printers = [];
    try { const pr = await API.getPrinters(); printers = pr.data || pr || []; } catch { printers = []; }

    const connOpts = (sel) => ['usb', 'bluetooth', 'network'].map(c =>
      `<option value="${c}" ${sel === c ? 'selected' : ''}>${c === 'usb' ? 'USB' : c === 'bluetooth' ? 'Bluetooth' : 'Network / Wi-Fi'}</option>`
    ).join('');
    const printerOpts = (selected) => (printers.length ? printers : [{ name: '' }]).map(p =>
      `<option value="${p.name}" ${selected === p.name ? 'selected' : ''}>${p.name || 'No printers detected'}</option>`
    ).join('');

    el.innerHTML = `<div class="admin-section"><h3>Printer Setup</h3>
      <p class="muted">Configure thermal printers for POS receipts and kitchen tickets, plus a separate <strong>A4 office printer</strong> for Reports, Bookkeeping, and every admin <strong>Print</strong> button. Connection: USB, Bluetooth, or Network.</p>
      <div class="admin-tabs" id="printer-tabs">
        <button class="admin-tab active" data-tab="receipt">Receipt (58/80mm)</button>
        <button class="admin-tab" data-tab="kitchen">Kitchen</button>
        <button class="admin-tab" data-tab="invoice">A4 Printer (Reports &amp; PDFs)</button>
        <button class="admin-tab" data-tab="barcode">Barcode Labels</button>
      </div>
      <div id="printer-tab-content"></div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="save-printer">Save Printer Settings</button>
        <button class="btn btn-ghost" id="preview-receipt">Preview Receipt</button>
        <button class="btn btn-ghost" id="preview-kitchen">Preview Kitchen</button>
        <button class="btn btn-ghost" id="preview-invoice">Preview A4 Invoice</button>
        <button class="btn btn-ghost" id="test-receipt">Test Receipt</button>
        <button class="btn btn-ghost" id="test-kitchen">Test Kitchen</button>
        <button class="btn btn-ghost" id="test-invoice">Test A4 Invoice</button>
        <button class="btn btn-ghost" id="test-barcode">Test Barcode Label</button>
      </div>
      <div id="printer-status-panel" style="margin-top:16px"></div>
    </div>`;

    const tabHtml = {
      receipt: `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Default Receipt Printer</label>
          <select id="pr-receipt">${printerOpts(ps.receipt_printer)}</select></div>
        <div class="field"><label>Connection</label>
          <select id="pr-receipt-conn">${connOpts(ps.receipt_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
        <div class="field"><label>Paper Size (POS thermal only)</label>
          <select id="pr-paper"><option value="58mm" ${ps.paper_size === '58mm' ? 'selected' : ''}>58mm thermal</option>
          <option value="80mm" ${ps.paper_size === '80mm' || !ps.paper_size ? 'selected' : ''}>80mm thermal</option></select></div>
        <div class="field"><label>Receipt Copies</label><input type="number" id="pr-copies" min="1" max="5" value="${ps.copies || 1}"></div>
        <div class="field"><label><input type="checkbox" id="pr-autoprint" ${ps.auto_print !== false ? 'checked' : ''}> Auto-print after sale</label></div>
        <div class="field"><label><input type="checkbox" id="pr-silent" ${ps.silent_print ? 'checked' : ''}> Silent printing (no preview)</label></div>
        <div class="field"><label><input type="checkbox" id="pr-logo" ${ps.print_logo !== false ? 'checked' : ''}> Print logo</label></div>
        <div class="field"><label><input type="checkbox" id="pr-vat" ${ps.print_vat ? 'checked' : ''}> Print VAT number</label></div>
        <div class="field"><label><input type="checkbox" id="pr-cashier" ${ps.print_cashier !== false ? 'checked' : ''}> Print cashier name</label></div>
        <div class="field"><label><input type="checkbox" id="pr-drawer" ${ps.open_drawer ? 'checked' : ''}> Open cash drawer after sale</label></div>
        <div class="field"><label><input type="checkbox" id="pr-duplicate" ${ps.print_duplicate ? 'checked' : ''}> Print duplicate receipt</label></div>
      </div></div></div>`,
      kitchen: `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label><input type="checkbox" id="pr-kitchen-enabled" ${ps.kitchen_enabled !== false ? 'checked' : ''}> Enable kitchen printing</label></div>
        <div class="field"><label><input type="checkbox" id="pr-kitchen-auto" ${ps.kitchen_auto !== false ? 'checked' : ''}> Auto-print kitchen tickets when receipt prints</label></div>
        <div class="field"><label>Default Kitchen Printer</label>
          <select id="pr-kitchen">${printerOpts(ps.kitchen_printer)}</select></div>
        <div class="field"><label>Connection</label>
          <select id="pr-kitchen-conn">${connOpts(ps.kitchen_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
        <div class="field full"><p class="muted">Kitchen tickets use 58mm or 80mm thermal paper. Food items (food, drink, combo, side) are sent to the kitchen printer automatically.</p></div>
      </div></div></div>`,
      invoice: `<div class="card"><div class="card-body">
        <div style="margin-bottom:16px;padding:16px;border-radius:10px;border:1px solid var(--border);background:var(--bg-secondary)">
          <h4 style="margin:0 0 8px">A4 Office Printer</h4>
          <p class="muted" style="margin:0">Connect a full-page printer by <strong>USB</strong> or <strong>Bluetooth</strong> (or Wi-Fi). After you Save, every <strong>Print</strong> action for Reports, Bookkeeping, invoices, payroll, routines, and admin PDFs is sent to this printer automatically.</p>
          <p class="muted" style="margin:8px 0 0">Thermal receipt and kitchen printers are unchanged — they keep using the Receipt / Kitchen tabs.</p>
        </div>
        <div class="form-grid">
        <div class="field"><label>Connected A4 Printer</label>
          <select id="pr-invoice">${printerOpts(ps.invoice_printer)}</select></div>
        <div class="field"><label>Connection type</label>
          <select id="pr-invoice-conn">${connOpts(ps.invoice_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
        <div class="field full"><p class="muted" style="margin:0">Tip: Plug the USB cable in (or pair Bluetooth), choose the connection type, click Connect, select the printer in the list, then click <strong>Save Printer Settings</strong>.</p></div>
      </div></div></div>`,
      barcode: `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Barcode Label Printer</label>
          <select id="pr-barcode">${printerOpts(ps.barcode_printer)}</select></div>
        <div class="field"><label>Connection</label>
          <select id="pr-barcode-conn">${connOpts(ps.barcode_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
      </div></div></div>`
    };

    let activeTab = 'receipt';
    const syncDevicePrinter = (data) => {
      const patch = {
        receipt_printer: data.receipt_printer,
        receipt_connection: data.receipt_connection,
        kitchen_printer: data.kitchen_printer,
        kitchen_connection: data.kitchen_connection,
        invoice_printer: data.invoice_printer,
        invoice_connection: data.invoice_connection,
        paper_size: data.paper_size
      };
      Utils.saveLocalDeviceSettings(patch);
      API.saveDeviceSettings(patch).catch(() => {});
    };

    const onPrinterSelected = (name, conn) => {
      const map = {
        receipt: 'pr-receipt',
        kitchen: 'pr-kitchen',
        invoice: 'pr-invoice',
        barcode: 'pr-barcode'
      };
      const sel = document.getElementById(map[activeTab]);
      if (sel && name) {
        const exists = [...sel.options].some(o => o.value === name);
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sel.appendChild(opt);
        }
        sel.value = name;
      }
      if (activeTab === 'invoice' && name) {
        Utils.saveLocalDeviceSettings({
          invoice_printer: name,
          invoice_connection: conn || document.getElementById('pr-invoice-conn')?.value || 'usb'
        });
      }
    };

    const bindConnFilters = async () => {
      const configs = {
        receipt: ['pr-receipt-conn', 'pr-receipt', ps.receipt_printer, 'thermal'],
        kitchen: ['pr-kitchen-conn', 'pr-kitchen', ps.kitchen_printer, 'thermal'],
        invoice: ['pr-invoice-conn', 'pr-invoice', ps.invoice_printer, 'a4'],
        barcode: ['pr-barcode-conn', 'pr-barcode', ps.barcode_printer, 'thermal']
      };
      const cfg = configs[activeTab];
      if (cfg) {
        await PrinterUI.bindConnectionFilter(cfg[0], cfg[1], cfg[2], {
          onSelected: onPrinterSelected,
          kind: cfg[3]
        });
      }
    };
    const renderTab = async () => {
      const host = document.getElementById('printer-tab-content');
      if (!host) return;
      const html = tabHtml[activeTab];
      if (!html) return;
      host.innerHTML = html;
      document.querySelectorAll('#printer-tabs .admin-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === activeTab));
      await bindConnFilters();
      refreshStatus();
    };

    const collectData = () => ({
      receipt_printer: document.getElementById('pr-receipt')?.value || ps.receipt_printer || '',
      receipt_connection: document.getElementById('pr-receipt-conn')?.value || ps.receipt_connection || 'usb',
      paper_size: document.getElementById('pr-paper')?.value || ps.paper_size || '80mm',
      copies: parseInt(document.getElementById('pr-copies')?.value) || ps.copies || 1,
      auto_print: document.getElementById('pr-autoprint')?.checked ?? ps.auto_print !== false,
      silent_print: document.getElementById('pr-silent')?.checked ?? ps.silent_print,
      print_logo: document.getElementById('pr-logo')?.checked ?? ps.print_logo !== false,
      print_vat: document.getElementById('pr-vat')?.checked ?? ps.print_vat,
      print_cashier: document.getElementById('pr-cashier')?.checked ?? ps.print_cashier !== false,
      open_drawer: document.getElementById('pr-drawer')?.checked ?? ps.open_drawer,
      print_duplicate: document.getElementById('pr-duplicate')?.checked ?? ps.print_duplicate,
      kitchen_enabled: document.getElementById('pr-kitchen-enabled')?.checked ?? ps.kitchen_enabled !== false,
      kitchen_auto: document.getElementById('pr-kitchen-auto')?.checked ?? ps.kitchen_auto !== false,
      kitchen_printer: document.getElementById('pr-kitchen')?.value || ps.kitchen_printer || '',
      kitchen_connection: document.getElementById('pr-kitchen-conn')?.value || ps.kitchen_connection || 'usb',
      invoice_printer: document.getElementById('pr-invoice')?.value || ps.invoice_printer || '',
      invoice_connection: document.getElementById('pr-invoice-conn')?.value || ps.invoice_connection || 'usb',
      barcode_printer: document.getElementById('pr-barcode')?.value || ps.barcode_printer || '',
      barcode_connection: document.getElementById('pr-barcode-conn')?.value || ps.barcode_connection || 'usb'
    });

    const refreshStatus = async () => {
      const data = collectData();
      const st = await API.getPrinterStatus({
        receipt: data.receipt_printer,
        kitchen: data.kitchen_printer,
        invoice: data.invoice_printer
      });
      document.getElementById('printer-status-panel').innerHTML = `<div class="card"><div class="card-body">
        <h4>Printer Status (this computer)</h4>
        <div style="display:grid;gap:8px;margin-top:8px">
          <div><strong>Receipt:</strong> ${Utils.printerStatusBadge(st.receipt)}</div>
          <div><strong>Kitchen:</strong> ${Utils.printerStatusBadge(st.kitchen)}</div>
          <div><strong>A4 Printer:</strong> ${Utils.printerStatusBadge(st.invoice)}</div>
        </div></div></div>`;
    };

    document.getElementById('printer-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      const prev = collectData();
      Object.assign(ps, prev);
      activeTab = btn.dataset.tab;
      renderTab();
    });

    renderTab();

    document.getElementById('save-printer').addEventListener('click', async () => {
      const data = collectData();
      const r = await this.awaitSave(
        API.saveJsonSetting('printer_settings', data, this.app.user),
        null,
        'Could not save printer settings'
      );
      if (!r) return;
      this.settings.printer_settings = data;
      if (typeof App !== 'undefined' && App.settings) App.settings.printer_settings = data;
      syncDevicePrinter(data);
      const a4 = data.invoice_printer ? ` · A4: ${data.invoice_printer}` : '';
      Utils.toast(`Printer settings saved${a4}`, 'success');
      refreshStatus();
    });

    const testSale = {
      receipt_number: 'TEST-001', created_at: new Date().toISOString(),
      cashier_name: this.app.user.full_name,
      items: [{ product_name: 'Test Burger', quantity: 1, unit_price: 45, total: 45, item_type: 'food' }],
      payments: [{ payment_type: 'cash', amount: 45 }],
      subtotal: 45, discount: 0, tax_amount: 0, total: 45, change_amount: 0
    };

    document.getElementById('test-receipt').addEventListener('click', async () => {
      const html = Receipt.build(testSale, this.settings);
      const data = collectData();
      const r = await API.printReceipt(html, {
        receiptPrinter: data.receipt_printer,
        paperSize: data.paper_size,
        silent: data.silent_print
      });
      Utils.toast(r.success ? 'Test receipt sent' : (r.error || 'Print failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('test-kitchen').addEventListener('click', async () => {
      const html = Receipt.buildKitchenTicket(testSale, testSale.items, this.settings);
      const data = collectData();
      const r = await API.printKitchen(html, { kitchenPrinter: data.kitchen_printer, paperSize: data.paper_size });
      Utils.toast(r.success ? 'Test kitchen ticket sent' : (r.error || 'Print failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('test-invoice').addEventListener('click', async () => {
      const html = Receipt.buildInvoice(testSale, this.settings);
      const data = collectData();
      // Prefer unsaved selection from this form so Connect → Test works before Save
      if (data.invoice_printer) {
        const r = await API.printA4(html, { invoicePrinter: data.invoice_printer, silent: true });
        if (r?.success === false) Utils.toast(r.error || 'Print failed', 'error');
        else if (r?.fallback) Utils.toast('Opened A4 preview — Save printer settings for automatic print', 'info');
        else Utils.toast(`Test sent to A4 printer: ${r.printer || data.invoice_printer}`, 'success');
      } else {
        await Utils.printToA4(html);
      }
    });
    document.getElementById('test-barcode').addEventListener('click', async () => {
      const r = await API.printBarcodeLabel({ name: 'Test Product', barcode: '8001234567890', selling_price: 29.99 });
      Utils.toast(r.success ? 'Test barcode label sent' : (r.error || 'Print failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('preview-receipt').addEventListener('click', async () => {
      await API.printPreview(Receipt.build(testSale, this.settings), 'Receipt Preview');
    });
    document.getElementById('preview-kitchen').addEventListener('click', async () => {
      await API.printPreview(Receipt.buildKitchenTicket(testSale, testSale.items, this.settings), 'Kitchen Ticket Preview');
    });
    document.getElementById('preview-invoice').addEventListener('click', async () => {
      await API.printPreview(Receipt.buildInvoice(testSale, this.settings), 'A4 Invoice Preview');
    });
  },

  renderReceiptDesigner(el) {
    const rd = this.settings.receipt_design || {};
    el.innerHTML = `<div class="admin-section"><h3>Receipt Designer & Numbering</h3>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Receipt Prefix</label><input id="rd-prefix" value="${rd.receipt_prefix || 'RCP'}" placeholder="RCP"></div>
        <div class="field"><label>Receipt Number Padding</label><input type="number" id="rd-pad" min="1" max="10" value="${rd.receipt_number_pad || 5}"></div>
        <div class="field full"><label><input type="checkbox" id="rd-inc-date" ${rd.receipt_include_date !== false ? 'checked' : ''}> Include date in receipt number (e.g. RCP-20260803-00001)</label></div>
        <div class="field"><label>Order Number Prefix</label><input id="rd-order-prefix" value="${rd.order_prefix || 'ORD'}" placeholder="ORD"></div>
        <div class="field"><label>Order Number Padding</label><input type="number" id="rd-order-pad" min="1" max="10" value="${rd.order_number_pad || 4}"></div>
        <div class="field full"><label><input type="checkbox" id="rd-order-date" ${rd.order_include_date !== false ? 'checked' : ''}> Include date in order number (shown on receipts, kitchen & customer display, WhatsApp)</label></div>
        <div class="field full"><label><input type="checkbox" id="rd-item-tax" ${rd.show_item_tax !== false ? 'checked' : ''}> Show per-item excl. tax + tax on receipt when VAT enabled</label></div>
        <div class="field"><label><input type="checkbox" id="rd-logo" ${rd.show_logo!==false?'checked':''}> Show logo</label></div>
        <div class="field"><label><input type="checkbox" id="rd-address" ${rd.show_address!==false?'checked':''}> Show address</label></div>
        <div class="field"><label><input type="checkbox" id="rd-phone" ${rd.show_phone!==false?'checked':''}> Show phone</label></div>
        <div class="field"><label><input type="checkbox" id="rd-email" ${rd.show_email?'checked':''}> Show email</label></div>
        <div class="field"><label><input type="checkbox" id="rd-vat" ${rd.show_vat?'checked':''}> Show VAT number</label></div>
        <div class="field"><label><input type="checkbox" id="rd-cashier" ${rd.show_cashier!==false?'checked':''}> Show cashier</label></div>
        <div class="field full"><label>Thank You Message</label>
          <input id="rd-thanks" value="${rd.thank_you || this.settings.thank_you_message || 'THANK YOU FOR SHOPPING WITH US'}"></div>
        <div class="field full"><label>Footer Message</label>
          <input id="rd-footer" value="${rd.footer_message || this.settings.receipt_footer || 'Please Come Again'}"></div>
        <div class="field full"><label>Return Policy</label>
          <textarea id="rd-return" rows="2">${rd.return_policy || this.settings.return_policy || ''}</textarea></div>
        <div class="field full"><label>Custom Notes</label>
          <textarea id="rd-notes" rows="2">${rd.custom_notes || ''}</textarea></div>
      </div>
      <button class="btn btn-primary" id="save-receipt-design" style="margin-top:16px">Save Receipt Design</button>
      </div></div></div>`;

    document.getElementById('save-receipt-design').addEventListener('click', async () => {
      const rd = {
        receipt_prefix: document.getElementById('rd-prefix').value.trim() || 'RCP',
        receipt_number_pad: parseInt(document.getElementById('rd-pad').value, 10) || 5,
        receipt_include_date: document.getElementById('rd-inc-date').checked,
        order_prefix: document.getElementById('rd-order-prefix').value.trim() || 'ORD',
        order_number_pad: parseInt(document.getElementById('rd-order-pad').value, 10) || 4,
        order_include_date: document.getElementById('rd-order-date').checked,
        show_item_tax: document.getElementById('rd-item-tax').checked,
        show_logo: document.getElementById('rd-logo').checked,
        show_address: document.getElementById('rd-address').checked,
        show_phone: document.getElementById('rd-phone').checked,
        show_email: document.getElementById('rd-email').checked,
        show_vat: document.getElementById('rd-vat').checked,
        show_cashier: document.getElementById('rd-cashier').checked,
        thank_you: document.getElementById('rd-thanks').value.trim(),
        footer_message: document.getElementById('rd-footer').value.trim(),
        return_policy: document.getElementById('rd-return').value.trim(),
        custom_notes: document.getElementById('rd-notes').value.trim()
      };
      const r1 = await this.awaitSave(API.saveJsonSetting('receipt_design', rd, this.app.user), null, 'Could not save receipt design');
      if (!r1) return;
      await API.saveSettings({
        thank_you_message: rd.thank_you,
        receipt_footer: rd.footer_message,
        return_policy: rd.return_policy
      }, this.app.user);
      this.settings.receipt_design = rd;
      if (this.app) this.app.settings = { ...this.app.settings, receipt_design: rd };
      Utils.toast('Receipt design saved', 'success');
    });
  },

  renderSecurity(el) {
    const sec = this.settings.security_settings || {};
    const isOwner = this.app.user?.role === 'owner';
    const canCodes = ['owner', 'manager'].includes(this.app.user?.role);
    el.innerHTML = `<div class="admin-section"><h3>Security Settings</h3>
      <div class="card"><div class="card-body">
        <h4>Notification & Closing Sound</h4>
        <p class="muted">Alert sound loops for unread alerts until marked read. Pending settings approvals appear in the bell but do not trigger the sound.</p>
        ${(() => {
          const ns = this.settings.notification_settings || {};
          return `<div class="form-grid">
            <div class="field full"><label><input type="checkbox" id="ns-enabled" ${ns.sound_enabled!==false?'checked':''}> Enable alert sounds (shop-wide)</label></div>
            <div class="field full">${window.PanelNotify ? PanelNotify.soundToggleHtml('admin', { id: 'ns-admin-device', label: 'This device: admin panel alert sounds' }) : ''}</div>
            <div class="field full"><label><input type="checkbox" id="ns-loop" ${ns.loop_until_read!==false?'checked':''}> Loop sound until attended</label></div>
            <div class="field full"><label>Current sound</label><span class="muted" id="ns-current-label">${ns.sound_path ? ns.sound_path.split(/[/\\]/).pop() : 'Demo sound (built-in)'}</span></div>
          </div>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            <button type="button" class="btn btn-warning" id="ns-test">Test Sound</button>
            <button type="button" class="btn btn-ghost hidden" id="ns-test-stop">Stop Test</button>
            <button type="button" class="btn btn-ghost" id="ns-test-notif">Send Test Notification</button>
            <button type="button" class="btn btn-ghost" id="ns-upload">Upload Custom Sound</button>
            <button type="button" class="btn btn-ghost" id="ns-demo">Use Demo Sound</button>
          </div>
          <p class="muted" style="margin-top:8px;font-size:12px">Test Sound plays an 8-second preview. You can also test from the bell icon (Notifications).</p>
          <button type="button" class="btn btn-primary" id="save-notif-sound" style="margin-top:12px">Save Notification Settings</button>
          <hr style="margin:20px 0;border-color:var(--border)">
          <h4 style="margin:0 0 8px">Alert types (on / off)</h4>
          <p class="muted" style="margin:0 0 12px">Turn each alert type on or off. Off means Admin will not create or show that notification (sound included).</p>
          <div class="form-grid" id="ns-type-toggles">${(() => {
            const toggles = ns.type_toggles || {};
            const catalog = [
              ['low_stock', 'Low stock'],
              ['out_of_stock', 'Out of stock'],
              ['reorder', 'Reorder level'],
              ['loyalty_reminder', 'Loyalty / points reminders'],
              ['loyalty_reminder_summary', 'Loyalty reminder summary'],
              ['taken_unpaid', 'Unpaid / Taken – Pay Later'],
              ['cashout', 'Shift cash-out'],
              ['cashup', 'Cash-up'],
              ['cashout_penalty', 'Late cash-out penalty'],
              ['target_met', 'Daily target met'],
              ['target_missed', 'Daily target missed'],
              ['payroll_due', 'Staff pay day'],
              ['owner_salary_due', 'Owner salary due'],
              ['owner_salary_overdue', 'Owner salary overdue'],
              ['document_share', 'Document hub shares'],
              ['referral', 'Referral & Commission'],
              ['delivery_order', 'Delivery orders'],
              ['compliance', 'Ops compliance'],
              ['checklist_reminder', 'Checklist reminders'],
              ['checklist_overdue', 'Checklist overdue'],
              ['contract_expired', 'Contract expired'],
              ['probation_eval_due', 'Probation evaluation due'],
              ['probation_ending', 'Probation ending'],
              ['attendance_auto_close', 'Missed clock-out'],
              ['attendance_penalty', 'Attendance penalty'],
              ['donation', 'Donations'],
              ['stock_count', 'Stock counts'],
              ['test', 'Test notifications']
            ];
            return catalog.map(([id, label]) => {
              const on = toggles[id] !== false;
              return `<div class="field full"><label><input type="checkbox" class="ns-type-toggle" data-type="${id}" ${on ? 'checked' : ''}> ${Utils.escHtml(label)}</label></div>`;
            }).join('');
          })()}</div>
          <button type="button" class="btn btn-primary" id="save-notif-types" style="margin-top:12px">Save alert type toggles</button>
          <hr style="margin:20px 0;border-color:var(--border)">
          <h4 style="margin:0 0 8px">Per-panel notification sounds</h4>
          <p class="muted" style="margin:0 0 12px">Upload a custom sound for each app. If none is uploaded, a unique demo tone plays for that panel.</p>
          <div class="form-grid" id="panel-sound-grid">${(() => {
            const ps = ns.panel_sounds || {};
            const panels = [
              ['pos', 'POS'], ['admin', 'Admin'], ['driver', 'Driver app'], ['manager', 'Business Manager'],
              ['online', 'Order Online'], ['delivery', 'Delivery dept'], ['staff', 'Staff portal'], ['recipe', 'Recipe & Production'],
              ['referral', 'Referral Agent'], ['referral-commission', 'Referral Commission']
            ];
            return panels.map(([id, label]) => {
              const row = ps[id] || {};
              const file = row.sound_path ? row.sound_path.split(/[/\\\\]/).pop() : 'Demo tone';
              return `<div class="field full" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
                <strong style="min-width:140px">${label}</strong>
                <span class="muted" id="ps-label-${id}">${file}</span>
                <button type="button" class="btn btn-ghost btn-sm" data-ps-upload="${id}">Upload</button>
                <button type="button" class="btn btn-ghost btn-sm" data-ps-demo="${id}">Demo</button>
                <button type="button" class="btn btn-ghost btn-sm" data-ps-test="${id}">Test</button>
              </div>`;
            }).join('');
          })()}</div>`;
        })()}
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>POS WhatsApp Advert Reminders</h4>
        <p class="muted">Schedule times when the POS shows a popup and plays the POS alert sound, reminding staff to advertise on WhatsApp. Reminders only appear on the POS — not in Admin.</p>
        ${(() => {
          const par = (this.settings.notification_settings || {}).pos_advert_reminders || {};
          const times = Array.isArray(par.times) && par.times.length ? par.times : ['12:30'];
          const timesHtml = times.map((t, i) => `
            <div class="field" style="display:flex;gap:8px;align-items:center;margin:0" data-advert-time-row="${i}">
              <input type="time" class="advert-time-input" value="${Utils.escHtml(String(t || '').slice(0, 5))}" style="max-width:140px">
              <button type="button" class="btn btn-ghost btn-sm advert-time-remove" ${times.length <= 1 ? 'disabled' : ''}>Remove</button>
            </div>`).join('');
          return `<div class="form-grid">
            <div class="field full"><label><input type="checkbox" id="par-enabled" ${par.enabled !== false ? 'checked' : ''}> Enable advert reminders on POS</label></div>
            <div class="field full"><label><input type="checkbox" id="par-sound" ${par.sound_enabled !== false ? 'checked' : ''}> Play POS alert sound with reminder</label></div>
            <div class="field full"><label>Reminder message</label>
              <textarea id="par-message" rows="2" placeholder="Time to advertise on WhatsApp!">${Utils.escHtml(par.message || 'Time to advertise on WhatsApp!')}</textarea></div>
            <div class="field full"><label>Reminder times</label>
              <div id="par-times-list" style="display:flex;flex-direction:column;gap:8px;margin-top:6px">${timesHtml}</div>
              <button type="button" class="btn btn-ghost btn-sm" id="par-add-time" style="margin-top:8px">+ Add another time</button>
            </div>
          </div>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" class="btn btn-primary" id="save-advert-reminders">Save Advert Reminders</button>
            <button type="button" class="btn btn-ghost" id="par-test-preview">Preview reminder</button>
          </div>
          <p class="muted" style="margin-top:8px;font-size:12px">Preview plays the POS demo tone only when reminders are enabled. Scheduled reminders fire once per day at each time on open POS tills.</p>`;
        })()}
      </div></div>
      ${['owner', 'manager'].includes(this.app.user?.role) ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Android app installers (remote updates)</h4>
        <p class="muted">When staff tap <strong>Install update</strong> on a tablet, the app downloads from your shop server. Upload each APK here after building a new version — otherwise phones show “APK not uploaded yet”.</p>
        <p class="muted" style="font-size:12px">APK files are usually in <code>Downloads\\ShopPOS-Installers\\Android\\</code> on your PC after a build. Only owner/manager can upload.</p>
        <div id="mobile-apk-status" class="muted" style="margin:12px 0">Loading installer status…</div>
        <div id="mobile-apk-upload-grid" style="display:flex;flex-direction:column;gap:10px"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="mobile-apk-refresh" style="margin-top:12px">Refresh status</button>
      </div></div>` : ''}
      <div class="card" style="margin-top:16px"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Auto Logout (minutes)</label>
          <input type="number" id="sec-logout" min="0" value="${sec.auto_logout_minutes||30}"></div>
        <div class="field"><label><input type="checkbox" id="sec-lock" ${sec.lock_after_inactivity!==false?'checked':''}> Lock after inactivity</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-refund" ${sec.require_approval_refunds!==false?'checked':''}> Require supervisor code for cashier returns</label></div>
        <div class="field"><label>Cashier return limit (R)</label><input type="number" id="sec-ret-cashier" step="0.01" value="${sec.return_cashier_max??100}"></div>
        <div class="field"><label>Manager return limit (R)</label><input type="number" id="sec-ret-manager" step="0.01" value="${sec.return_manager_max??1000}"></div>
        <div class="field full"><label><input type="checkbox" id="sec-discount" ${sec.require_approval_discounts?'checked':''}> Require manager approval for discounts</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-oversell" ${sec.allow_oversell?'checked':''}> Allow oversell (sell when stock is zero)</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-price" ${sec.require_approval_price!==false?'checked':''}> Require manager approval for price changes</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-stock" ${sec.require_approval_stock!==false?'checked':''}> Require manager approval for stock adjustments</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-drawer" ${sec.require_approval_drawer!==false?'checked':''}> Require manager approval to open cash drawer</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-shift-login" ${sec.shift_login_enforcement?'checked':''}> Block POS login for employees not on today's shift (Staff Portal still opens; clock-in still requires a shift. Admin / manager / supervisor always allowed)</label></div>
      </div>
      <button class="btn btn-primary" id="save-security" style="margin-top:16px">Save Security Settings</button>
      </div></div>
      ${isOwner ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Bookkeeping Access Password</h4>
        <p class="muted">Set a separate password required to open the Bookkeeping module. Leave blank to keep current password.</p>
        <div class="form-grid">
          <div class="field"><label>New Bookkeeping Password</label><input type="password" id="sec-bk-pass" autocomplete="new-password"></div>
          <div class="field"><label>Confirm Password</label><input type="password" id="sec-bk-pass2" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-warning" id="save-bk-pass" style="margin-top:8px">Save Bookkeeping Password</button>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Account Recovery</h4>
        <p class="muted">Create a Private Recovery Phrase known only to the shop owner. If you forget the owner password, use Login → Account Recovery. The phrase is stored as a one-way hash — it is never shown again, never logged, and never sent back by the server.</p>
        <p><strong>Status:</strong> ${sec.recovery_configured
          ? '<span class="tag tag-ok">Configured</span>'
          : '<span class="tag tag-warn">Not configured</span>'}</p>
        <p class="muted">Last changed: ${sec.recovery_changed_at ? Utils.formatDateTime(sec.recovery_changed_at) : '—'}</p>
        <div class="form-grid" style="margin-top:12px">
          <div class="field full"><label>${sec.recovery_configured ? 'Change' : 'Create'} Private Recovery Phrase <span class="muted">(min 8 characters)</span></label>
            <input type="password" id="sec-recovery" autocomplete="new-password" placeholder="A sentence only you will remember"></div>
          <div class="field full"><label>Confirm Recovery Phrase</label>
            <input type="password" id="sec-recovery-confirm" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-warning" id="save-recovery" style="margin-top:8px">${sec.recovery_configured ? 'Change Recovery Phrase' : 'Create Private Recovery Phrase'}</button>
      </div></div>` : ''}
      ${canCodes ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Daily Supervisor Code (Void & Returns)</h4>
        <p class="muted">Generate a code each day. Regenerating invalidates the previous code immediately. Send to manager/supervisor WhatsApp.</p>
        <div id="supervisor-code-display" style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">—</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-warning" id="gen-supervisor-code">Generate Today's Code (Void)</button>
          <button class="btn btn-ghost" id="wa-supervisor-code">Send WhatsApp</button>
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
        <h4>Daily Refund Authorization Code</h4>
        <p class="muted">Required for cashier refunds. Regenerating blocks old codes until the new PIN is shared.</p>
        <div id="refund-code-display" style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">—</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-warning" id="gen-refund-code">Generate Today's Refund Code</button>
          <button class="btn btn-ghost" id="wa-refund-code">Send WhatsApp</button>
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
        <h4>Daily Supervisor Code (Staff Portal)</h4>
        <p class="muted">Cashiers need this code to unlock Staff. Regenerating invalidates the previous code.</p>
        <div id="staff-code-display" style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">—</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-warning" id="gen-staff-code">Generate Staff Portal Code</button>
          <button class="btn btn-ghost" id="wa-staff-code">Send WhatsApp</button>
        </div>
        <div class="field" style="margin-top:16px;max-width:320px">
          <label>Manager / Supervisor WhatsApp number</label>
          <input id="sec-code-wa-phone" placeholder="e.g. 0821234567" value="${(sec.code_whatsapp_phone || this.settings.phone || '').replace(/"/g, '')}">
        </div>
      </div></div>` : '<p class="muted" style="margin-top:16px">Daily codes are available to owners and managers.</p>'}
      </div>`;

    const loadCode = async () => {
      if (!canCodes) return;
      const r = await API.getTodaySupervisorCode(this.app.user, 'void');
      const el = document.getElementById('supervisor-code-display');
      if (!el) return;
      if (r.success && r.data?.code) el.textContent = r.data.code;
      else el.textContent = 'No code generated today';
      const rr = await API.getTodaySupervisorCode(this.app.user, 'refund');
      const rel = document.getElementById('refund-code-display');
      if (rel) rel.textContent = rr.success && rr.data?.code ? rr.data.code : 'No code generated today';
      const sr = await API.getTodaySupervisorCode(this.app.user, 'staff');
      const sel = document.getElementById('staff-code-display');
      if (sel) sel.textContent = sr.success && sr.data?.code ? sr.data.code : 'No code generated today';
    };
    loadCode();

    const sendCodeWhatsApp = async (purpose, label) => {
      const phone = document.getElementById('sec-code-wa-phone')?.value.trim() || this.settings.phone;
      if (!phone) return Utils.toast('Enter manager/supervisor WhatsApp number', 'error');
      const codeEl = purpose === 'void' ? 'supervisor-code-display' : purpose === 'refund' ? 'refund-code-display' : 'staff-code-display';
      let code = document.getElementById(codeEl)?.textContent?.trim();
      if (!code || code.includes('No code') || code === '—') {
        const gen = await API.generateSupervisorCode(this.app.user, purpose);
        if (!gen.success) return Utils.toast(gen.error, 'error');
        code = gen.data.code;
        document.getElementById(codeEl).textContent = code;
      }
      const body = `${this.settings.shop_name || 'Shop POS'} — ${label}\nDate: ${Utils.today()}\nPIN: ${code}\n\nPrevious PIN is no longer valid.`;
      const wa = await API.sendWhatsAppMessage({
        phone,
        recipient_name: 'Supervisor',
        message_type: 'supervisor_code',
        body
      }, this.app.user);
      await Utils.deliverWhatsApp(wa, phone, body);
    };

    document.getElementById('gen-supervisor-code')?.addEventListener('click', async () => {
      const r = await API.generateSupervisorCode(this.app.user, 'void');
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('supervisor-code-display').textContent = r.data.code;
      Utils.toast(`New void code generated — old code no longer works`, 'success');
    });

    document.getElementById('gen-refund-code')?.addEventListener('click', async () => {
      const r = await API.generateSupervisorCode(this.app.user, 'refund');
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('refund-code-display').textContent = r.data.code;
      Utils.toast(`New refund code generated — old code no longer works`, 'success');
    });

    document.getElementById('gen-staff-code').addEventListener('click', async () => {
      const r = await API.generateSupervisorCode(this.app.user, 'staff');
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('staff-code-display').textContent = r.data.code;
      Utils.toast(`New staff code generated — old code no longer works`, 'success');
    });
    document.getElementById('wa-supervisor-code')?.addEventListener('click', () => sendCodeWhatsApp('void', 'Daily Void / Returns PIN'));
    document.getElementById('wa-refund-code')?.addEventListener('click', () => sendCodeWhatsApp('refund', 'Daily Refund Authorization PIN'));
    document.getElementById('wa-staff-code')?.addEventListener('click', () => sendCodeWhatsApp('staff', 'Daily Staff Portal PIN'));

    document.getElementById('save-security').addEventListener('click', async () => {
      const existing = this.settings.security_settings || {};
      await API.saveJsonSetting('security_settings', {
        ...existing,
        auto_logout_minutes: parseInt(document.getElementById('sec-logout').value) || 30,
        lock_after_inactivity: document.getElementById('sec-lock').checked,
        require_approval_refunds: document.getElementById('sec-refund').checked,
        return_cashier_max: parseFloat(document.getElementById('sec-ret-cashier').value) || 100,
        return_manager_max: parseFloat(document.getElementById('sec-ret-manager').value) || 1000,
        require_approval_discounts: document.getElementById('sec-discount').checked,
        allow_oversell: !!document.getElementById('sec-oversell')?.checked,
        require_approval_price: document.getElementById('sec-price').checked,
        require_approval_stock: document.getElementById('sec-stock').checked,
        require_approval_drawer: document.getElementById('sec-drawer').checked,
        shift_login_enforcement: document.getElementById('sec-shift-login').checked,
        code_whatsapp_phone: document.getElementById('sec-code-wa-phone')?.value.trim() || ''
      }, this.app.user);
      this.settings.security_settings = {
        ...(this.settings.security_settings || {}),
        require_approval_discounts: document.getElementById('sec-discount').checked,
        allow_oversell: !!document.getElementById('sec-oversell')?.checked,
        require_approval_drawer: document.getElementById('sec-drawer').checked
      };
      if (this.app) this.app.settings = { ...this.app.settings, security_settings: { ...(this.app.settings?.security_settings || {}), ...this.settings.security_settings } };
      Utils.toast('Security settings saved', 'success');
    });

    document.getElementById('save-bk-pass')?.addEventListener('click', async () => {
      const p1 = document.getElementById('sec-bk-pass').value;
      const p2 = document.getElementById('sec-bk-pass2').value;
      if (!p1) return Utils.toast('Enter a bookkeeping password', 'error');
      if (p1 !== p2) return Utils.toast('Passwords do not match', 'error');
      const r = await API.setBookkeepingPassword(p1, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('sec-bk-pass').value = '';
      document.getElementById('sec-bk-pass2').value = '';
      Utils.toast('Bookkeeping password saved', 'success');
    });

    this.bindMobileApkUploads(el);

    document.getElementById('ns-upload')?.addEventListener('click', async () => {
      const r = await API.selectAudio('notification');
      if (r?.cancelled) return;
      if (!r?.success) return Utils.toast(r?.error || 'Upload failed', 'error');
      this._pendingSoundPath = r.path;
      Utils.toast('Sound uploaded — click Save Notification Settings', 'success');
    });

    document.getElementById('ns-demo')?.addEventListener('click', async () => {
      const r = await API.ensureDemoNotificationSound();
      if (!r?.success) return Utils.toast(r?.error || 'Demo sound unavailable', 'error');
      this._pendingSoundPath = r.data?.sound_path;
      Utils.toast('Demo sound selected — click Save Notification Settings', 'success');
    });

    const getNotifTestSettings = () => ({
      ...this.settings,
      notification_settings: {
        ...(this.settings.notification_settings || {}),
        sound_enabled: document.getElementById('ns-enabled').checked,
        loop_until_read: document.getElementById('ns-loop').checked,
        sound_path: this._pendingSoundPath ?? (this.settings.notification_settings || {}).sound_path
      }
    });

    const adminDevNotify = document.getElementById('ns-admin-device');
    if (adminDevNotify && window.PanelNotify) PanelNotify.bindSoundToggle(adminDevNotify, 'admin');

    document.getElementById('ns-test')?.addEventListener('click', async () => {
      const testSettings = getNotifTestSettings();
      if (!SoundService.isEnabled(testSettings)) return Utils.toast('Enable alert sounds first', 'error');
      try {
        await API.ensureDemoNotificationSound();
        const fresh = await API.getSettingsParsed();
        if (fresh.success) {
          this.settings = fresh.data;
          this.app.settings = fresh.data;
        }
        await SoundService.testAlert(getNotifTestSettings());
        document.getElementById('ns-test-stop')?.classList.remove('hidden');
        Utils.toast('Playing test sound for 8 seconds…', 'success');
      } catch (err) {
        Utils.toast(err.message || 'Could not play sound', 'error');
      }
    });

    document.getElementById('ns-test-stop')?.addEventListener('click', () => {
      SoundService.stopAlert();
      document.getElementById('ns-test-stop')?.classList.add('hidden');
      Utils.toast('Test sound stopped', 'success');
    });

    document.getElementById('ns-test-notif')?.addEventListener('click', async () => {
      const r = await API.createTestNotification();
      if (!r?.success) return Utils.toast(r?.error || 'Could not create test notification', 'error');
      Utils.toast('Test notification sent — check the bell icon', 'success');
      this.app.loadNotifications();
      this.app.checkNotificationSounds();
    });

    document.getElementById('save-notif-sound')?.addEventListener('click', async () => {
      const ns = {
        ...(this.settings.notification_settings || {}),
        sound_enabled: document.getElementById('ns-enabled').checked,
        loop_until_read: document.getElementById('ns-loop').checked,
        panel_sounds: { ...(this.settings.notification_settings?.panel_sounds || {}), ...(this._pendingPanelSounds || {}) },
        pos_advert_reminders: (this.settings.notification_settings || {}).pos_advert_reminders,
        type_toggles: (this.settings.notification_settings || {}).type_toggles || {}
      };
      if (this._pendingSoundPath) ns.sound_path = this._pendingSoundPath;
      await API.saveJsonSetting('notification_settings', ns, this.app.user);
      this.settings.notification_settings = ns;
      this.app.settings = { ...this.app.settings, notification_settings: ns };
      this._pendingPanelSounds = {};
      Utils.toast('Notification sound settings saved', 'success');
      this.renderSecurity(el);
    });

    document.getElementById('save-notif-types')?.addEventListener('click', async () => {
      const type_toggles = { ...((this.settings.notification_settings || {}).type_toggles || {}) };
      document.querySelectorAll('.ns-type-toggle').forEach((cb) => {
        const t = cb.dataset.type;
        if (t) type_toggles[t] = !!cb.checked;
      });
      const ns = {
        ...(this.settings.notification_settings || {}),
        type_toggles
      };
      await API.saveJsonSetting('notification_settings', ns, this.app.user);
      this.settings.notification_settings = ns;
      this.app.settings = { ...this.app.settings, notification_settings: ns };
      Utils.toast('Alert type toggles saved', 'success');
      this.app.loadNotifications?.();
      this.renderSecurity(el);
    });

    const collectAdvertTimes = () => [...document.querySelectorAll('#par-times-list .advert-time-input')]
      .map((inp) => String(inp.value || '').trim().slice(0, 5))
      .filter(Boolean);

    document.getElementById('par-add-time')?.addEventListener('click', () => {
      const list = document.getElementById('par-times-list');
      if (!list) return;
      const row = document.createElement('div');
      row.className = 'field';
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:0';
      row.innerHTML = `<input type="time" class="advert-time-input" value="17:00" style="max-width:140px">
        <button type="button" class="btn btn-ghost btn-sm advert-time-remove">Remove</button>`;
      list.appendChild(row);
      list.querySelectorAll('.advert-time-remove').forEach((b) => { b.disabled = list.querySelectorAll('.advert-time-input').length <= 1; });
    });

    document.getElementById('par-times-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.advert-time-remove');
      if (!btn) return;
      const list = document.getElementById('par-times-list');
      const rows = list?.querySelectorAll('.advert-time-input') || [];
      if (rows.length <= 1) return;
      btn.closest('.field')?.remove();
      list.querySelectorAll('.advert-time-remove').forEach((b) => { b.disabled = list.querySelectorAll('.advert-time-input').length <= 1; });
    });

    document.getElementById('save-advert-reminders')?.addEventListener('click', async () => {
      const times = collectAdvertTimes();
      if (!times.length) return Utils.toast('Add at least one reminder time', 'error');
      const par = {
        enabled: !!document.getElementById('par-enabled')?.checked,
        sound_enabled: !!document.getElementById('par-sound')?.checked,
        message: document.getElementById('par-message')?.value?.trim() || 'Time to advertise on WhatsApp!',
        times: [...new Set(times)].sort()
      };
      const ns = {
        ...(this.settings.notification_settings || {}),
        pos_advert_reminders: par
      };
      await API.saveJsonSetting('notification_settings', ns, this.app.user);
      this.settings.notification_settings = ns;
      this.app.settings = { ...this.app.settings, notification_settings: ns };
      Utils.toast('Advert reminder schedule saved', 'success');
      this.renderSecurity(el);
    });

    document.getElementById('par-test-preview')?.addEventListener('click', async () => {
      if (!document.getElementById('par-enabled')?.checked) {
        return Utils.toast('Enable advert reminders first', 'error');
      }
      const msg = document.getElementById('par-message')?.value?.trim() || 'Time to advertise on WhatsApp!';
      if (document.getElementById('par-sound')?.checked !== false) {
        if (window.PanelSound) {
          PanelSound.setPanel('pos');
          PanelSound.setEnabled(true);
          await PanelSound.playOnce();
        } else {
          await SoundService.testAlert(this.settings);
        }
      }
      Utils.showModal('Advertise on WhatsApp', `<p style="font-size:16px;line-height:1.5">${Utils.escHtml(msg)}</p>`,
        '<button type="button" class="btn btn-primary" id="par-preview-ok">OK, I will advertise</button>');
      document.getElementById('par-preview-ok')?.addEventListener('click', () => {
        Utils.hideModal();
        window.PanelSound?.stop?.();
      });
    });

    this._pendingPanelSounds = this._pendingPanelSounds || {};
    document.querySelectorAll('[data-ps-upload]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const panel = btn.dataset.psUpload;
        const r = await API.selectAudio(`notification-${panel}`);
        if (r?.cancelled) return;
        if (!r?.success) return Utils.toast(r?.error || 'Upload failed', 'error');
        this._pendingPanelSounds[panel] = { ...(this.settings.notification_settings?.panel_sounds?.[panel] || {}), sound_path: r.path, enabled: true };
        const lbl = document.getElementById(`ps-label-${panel}`);
        if (lbl) lbl.textContent = r.path.split(/[/\\]/).pop();
        Utils.toast(`${panel} sound uploaded — click Save`, 'success');
      });
    });
    document.querySelectorAll('[data-ps-demo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.psDemo;
        this._pendingPanelSounds[panel] = { ...(this.settings.notification_settings?.panel_sounds?.[panel] || {}), sound_path: null, enabled: true };
        const lbl = document.getElementById(`ps-label-${panel}`);
        if (lbl) lbl.textContent = 'Demo tone';
        Utils.toast(`${panel} will use demo tone`, 'success');
      });
    });
    document.querySelectorAll('[data-ps-test]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const panel = btn.dataset.psTest;
        if (window.PanelSound) {
          PanelSound.setPanel(panel);
          PanelSound.setEnabled(true);
          await PanelSound.playOnce();
        } else {
          Utils.toast('Open a web panel to test panel sounds', 'info');
        }
      });
    });

    document.getElementById('save-recovery')?.addEventListener('click', async () => {
      const phrase = document.getElementById('sec-recovery').value;
      const phrase2 = document.getElementById('sec-recovery-confirm')?.value || document.getElementById('sec-recovery2')?.value;
      if (!phrase || phrase.length < 8) return Utils.toast('Recovery phrase must be at least 8 characters', 'error');
      if (phrase !== phrase2) return Utils.toast('Recovery phrases do not match', 'error');
      const r = await API.setRecoverySecret(phrase, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save recovery phrase', 'error');
      document.getElementById('sec-recovery').value = '';
      const confirmEl = document.getElementById('sec-recovery-confirm') || document.getElementById('sec-recovery2');
      if (confirmEl) confirmEl.value = '';
      const fresh = await API.getSettingsParsed();
      if (fresh?.success && fresh.data) {
        this.settings = fresh.data;
        if (this.app) this.app.settings = fresh.data;
      }
      Utils.toast('Private recovery phrase saved. Keep it secret — write it down somewhere safe. It will not be shown again.', 'success');
      this.renderSecurity(el);
    });
  },

  async refreshMobileApkStatus() {
    const statusEl = document.getElementById('mobile-apk-status');
    const grid = document.getElementById('mobile-apk-upload-grid');
    if (!statusEl || !grid) return;
    statusEl.textContent = 'Loading installer status…';
    const res = await API.getMobileApkStatus();
    const rows = res?.data || [];
    if (!rows.length) {
      statusEl.textContent = 'Could not load installer status.';
      return;
    }
    const uploaded = rows.filter((r) => r.uploaded).length;
    statusEl.innerHTML = uploaded === rows.length
      ? `<span style="color:var(--success,#22c55e)">All ${rows.length} installers are on the server — tablets can download updates.</span>`
      : `<span style="color:var(--warning,#f59e0b)">${uploaded} of ${rows.length} installers uploaded. Upload the missing APK files below.</span>`;
    grid.innerHTML = rows.map((row) => {
      const mb = row.uploaded ? `${(row.size / (1024 * 1024)).toFixed(1)} MB` : 'Missing';
      const when = row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—';
      return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <strong style="min-width:160px">${Utils.escHtml(row.label)}</strong>
        <span class="muted" style="min-width:120px">${row.uploaded ? '✓ Ready' : '✗ Not uploaded'}</span>
        <span class="muted" style="min-width:80px">${mb}</span>
        <span class="muted" style="font-size:12px">${when}</span>
        <label class="btn btn-ghost btn-sm" style="margin:0;cursor:pointer">
          Upload ${Utils.escHtml(row.file.replace('ShopPOS-', '').replace('.apk', ''))}
          <input type="file" accept=".apk,application/vnd.android.package-archive" data-apk-file="${Utils.escHtml(row.file)}" hidden>
        </label>
      </div>`;
    }).join('');
    grid.querySelectorAll('input[data-apk-file]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        const apkFile = input.dataset.apkFile;
        if (!file.name.toLowerCase().endsWith('.apk')) return Utils.toast('Please choose an .apk file', 'error');
        Utils.toast(`Uploading ${file.name}…`, 'info');
        const up = await API.uploadMobileApk(apkFile, file);
        if (!up?.success) return Utils.toast(up?.error || 'Upload failed', 'error');
        Utils.toast(`${apkFile} uploaded — tablets can install updates now`, 'success');
        await this.refreshMobileApkStatus();
      });
    });
  },

  bindMobileApkUploads(el) {
    if (!document.getElementById('mobile-apk-status')) return;
    this.refreshMobileApkStatus().catch(() => {});
    document.getElementById('mobile-apk-refresh')?.addEventListener('click', () => {
      this.refreshMobileApkStatus().catch(() => {});
    });
  },

  async renderSettingsApprovals(el) {
    const canReview = ['owner', 'manager'].includes(this.app.user?.role);
    el.innerHTML = `<div class="admin-section"><h3>Settings Approvals</h3><p class="muted">Loading…</p></div>`;
    const [pendingRes, histRes, wastePendingRes, wasteAllRes, invWastePendingRes, invWasteAllRes] = await Promise.all([
      API.getPendingSettingsRequests(),
      API.getSettingsRequestHistory ? API.getSettingsRequestHistory(40) : Promise.resolve({ success: true, data: [] }),
      API.recipeWasteList ? API.recipeWasteList({ status: 'pending' }, this.app.user) : Promise.resolve({ success: true, data: [] }),
      API.recipeWasteList ? API.recipeWasteList({}, this.app.user) : Promise.resolve({ success: true, data: [] }),
      API.getWasteRecords(null, null, { status: 'pending' }).catch(() => ({ success: true, data: [] })),
      API.getWasteRecords(Utils.monthStart?.() || null, Utils.today?.() || null, {}).catch(() => ({ success: true, data: [] }))
    ]);
    const pending = pendingRes.data || [];
    const allSettingsHist = histRes.data || [];
    const history = allSettingsHist.filter(r => r.status !== 'pending').slice(0, 25);
    const wastePending = (wastePendingRes.success ? (wastePendingRes.data || []) : []).filter(w => w.status === 'pending');
    const wasteHistory = (wasteAllRes.success ? (wasteAllRes.data || []) : []).filter(w => w.status !== 'pending').slice(0, 25);
    const invPendingList = Array.isArray(invWastePendingRes.data) ? invWastePendingRes.data.filter(w => (w.status || 'pending') === 'pending') : [];
    const invHistList = Array.isArray(invWasteAllRes.data)
      ? invWasteAllRes.data.filter(w => (w.status || '') !== 'pending').slice(0, 25)
      : [];
    const parseReq = (r) => {
      try { return typeof r?.settings_json === 'string' ? JSON.parse(r.settings_json || '{}') : (r?.settings_json || {}); }
      catch { return {}; }
    };
    const wasteRow = (w, pendingOnly) => `<tr>
      <td class="adm-waste-thumb" data-path="${Utils.escHtml(w.photo_path || w.photo_path_1 || '')}">${(w.photo_path || w.photo_path_1) ? '…' : '—'}</td>
      <td>${Utils.formatDateTime(w.created_at)}</td>
      <td>${w.recorded_by_name || w.employee_name || '—'}</td>
      <td>${w.waste_type || w.damage_kind || '—'}</td>
      <td>${w.product_name || w.property_name || '—'}</td>
      <td>${w.quantity} ${w.unit || ''}</td>
      <td>${Utils.formatMoney(w.cost != null ? w.cost : w.cost_value)}</td>
      ${pendingOnly ? '' : `<td><span class="tag">${w.status}</span></td>`}
      <td class="actions">
        ${pendingOnly && canReview ? `<button class="btn btn-sm btn-success appr-waste" data-id="${w.id}">Approve</button>
        <button class="btn btn-sm btn-danger rej-waste" data-id="${w.id}">Reject</button>` : ''}
        <button class="btn btn-sm btn-ghost view-waste" data-id="${w.id}" data-scope="${pendingOnly ? 'pending' : 'hist'}">View</button>
        ${canReview ? `<button class="btn btn-sm btn-danger del-waste" data-id="${w.id}">Delete</button>` : ''}
      </td></tr>`;
    const invRow = (w, pendingOnly) => `<tr>
      <td class="adm-inv-waste-thumb" data-path="${Utils.escHtml(w.photo_path_1 || '')}">${w.photo_path_1 ? '…' : '—'}</td>
      <td>${Utils.formatDateTime(w.created_at)}</td>
      <td>${Utils.escHtml(w.employee_name || '—')}</td>
      <td>${Utils.escHtml(w.damage_kind === 'property' ? 'Property' : 'Stock')}</td>
      <td>${Utils.escHtml(w.product_name || w.property_name || '—')}</td>
      <td>${w.quantity}</td>
      <td>${Utils.formatMoney(w.cost_value)}</td>
      ${pendingOnly ? '' : `<td><span class="tag">${w.status}</span></td>`}
      <td class="actions">
        ${pendingOnly && canReview ? `<button class="btn btn-sm btn-success appr-inv-waste" data-id="${w.id}">Approve</button>
        <button class="btn btn-sm btn-danger rej-inv-waste" data-id="${w.id}">Reject</button>` : ''}
        <button class="btn btn-sm btn-ghost view-inv-waste" data-id="${w.id}" data-scope="${pendingOnly ? 'pending' : 'hist'}">View</button>
      </td></tr>`;
    el.innerHTML = `<div class="admin-section"><h3>Settings Change Requests</h3>
      <p class="muted">Staff and managers can propose shop settings from Settings. Approve to apply, or reject.</p>
      ${!canReview ? '<p class="muted" style="color:var(--warning)">Only owner/manager can approve.</p>' : ''}
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Pending (${pending.length})</h4></div><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Requested By</th><th>Changes</th><th></th></tr></thead>
        <tbody>${pending.length ? pending.map(r => {
          const data = parseReq(r);
          const summary = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ').slice(0, 120);
          return `<tr><td>${Utils.formatDateTime(r.created_at)}</td><td>${r.requested_by_name || '—'}</td>
            <td><small>${summary || '—'}</small></td>
            <td class="actions">
              ${canReview ? `<button class="btn btn-sm btn-success appr-req" data-id="${r.id}">Approve</button>
              <button class="btn btn-sm btn-danger rej-req" data-id="${r.id}">Reject</button>
              <button class="btn btn-sm btn-ghost edit-req" data-id="${r.id}">Edit</button>
              <button class="btn btn-sm btn-danger del-req" data-id="${r.id}">Delete</button>` : ''}
              <button class="btn btn-sm btn-ghost view-req" data-id="${r.id}">View</button>
            </td></tr>`;
        }).join('') : '<tr><td colspan="4" class="muted">No pending requests</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Waste / Damage Approvals (${invPendingList.length})</h4></div>
        <p class="muted" style="padding:0 16px">From Expenses / Stock — photo required. Approving stock items deducts inventory.</p>
        <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Date</th><th>By</th><th>Type</th><th>Item</th><th>Qty</th><th>Cost</th><th></th></tr></thead>
        <tbody>${invPendingList.length ? invPendingList.map(w => invRow(w, true)) : '<tr><td colspan="8" class="muted">No pending waste / damage</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Recipe Waste Approvals (${wastePending.length})</h4></div>
        <p class="muted" style="padding:0 16px">Waste from Recipe &amp; Production — photo attaches here for View / Approve.</p>
        <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Date</th><th>By</th><th>Type</th><th>Item</th><th>Qty</th><th>Cost</th><th></th></tr></thead>
        <tbody>${wastePending.length ? wastePending.map(w => wasteRow(w, true)) : '<tr><td colspan="8" class="muted">No pending waste requests</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Settings history (${history.length})</h4></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>By</th><th>Status</th><th>Reviewed</th><th></th></tr></thead>
        <tbody>${history.length ? history.map(r => `<tr>
          <td>${Utils.formatDateTime(r.created_at)}</td><td>${r.requested_by_name || '—'}</td>
          <td><span class="tag">${r.status}</span></td>
          <td>${r.reviewed_by_name || '—'} ${r.reviewed_at ? Utils.formatDateTime(r.reviewed_at) : ''}</td>
          <td class="actions">
            <button class="btn btn-sm btn-ghost view-hist-req" data-id="${r.id}">View</button>
            ${canReview ? `<button class="btn btn-sm btn-danger del-req" data-id="${r.id}">Delete</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">No history yet</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Waste / damage history (${invHistList.length})</h4></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Date</th><th>By</th><th>Type</th><th>Item</th><th>Qty</th><th>Cost</th><th>Status</th><th></th></tr></thead>
        <tbody>${invHistList.length ? invHistList.map(w => invRow(w, false)) : '<tr><td colspan="9" class="muted">No history yet</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Recipe waste history (${wasteHistory.length})</h4></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Date</th><th>By</th><th>Type</th><th>Item</th><th>Qty</th><th>Cost</th><th>Status</th><th></th></tr></thead>
        <tbody>${wasteHistory.length ? wasteHistory.map(w => wasteRow(w, false)) : '<tr><td colspan="9" class="muted">No waste history</td></tr>'}
        </tbody></table></div></div>
      </div>`;

    el.querySelectorAll('.adm-waste-thumb[data-path], .adm-inv-waste-thumb[data-path]').forEach(async (cell) => {
      const path = cell.getAttribute('data-path');
      if (!path) return;
      try {
        const img = await API.getImageDataUrl(path);
        if (img.success && (img.dataUrl || img.data)) {
          cell.innerHTML = `<img src="${img.dataUrl || img.data}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`;
        } else cell.textContent = '📷';
      } catch (_) { cell.textContent = '📷'; }
    });

    el.querySelectorAll('.appr-req').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Apply these settings now?')) return;
      const r = await API.approveSettingsRequest(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Approve failed', 'error');
      Utils.toast('Settings approved and applied', 'success');
      const settingsRes = await API.getSettingsParsed();
      if (settingsRes.success) { this.settings = settingsRes.data; this.app.settings = settingsRes.data; this.app.updateBranding(); this.app.applyTheme(); }
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.rej-req').forEach(b => b.addEventListener('click', async () => {
      const notes = prompt('Reason for rejection (optional):') || '';
      const r = await API.rejectSettingsRequest(parseInt(b.dataset.id, 10), notes, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Reject failed', 'error');
      Utils.toast('Request rejected', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.view-req, .view-hist-req').forEach(b => b.addEventListener('click', () => {
      const req = pending.find(x => x.id == b.dataset.id) || allSettingsHist.find(x => x.id == b.dataset.id);
      const data = parseReq(req);
      Utils.showModal('Requested Changes', `<pre style="white-space:pre-wrap;font-size:13px">${JSON.stringify(data, null, 2)}</pre>`,
        '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    }));
    el.querySelectorAll('.edit-req').forEach(b => b.addEventListener('click', () => {
      const req = pending.find(x => x.id == b.dataset.id);
      if (!req) return;
      const data = parseReq(req);
      Utils.showModal('Edit settings request', `
        <p class="muted">Edit JSON carefully — invalid JSON will not save.</p>
        <textarea id="adm-edit-settings-json" rows="14" style="width:100%;font-family:monospace;font-size:12px">${JSON.stringify(data, null, 2)}</textarea>
      `, '<button class="btn btn-primary" id="adm-save-settings-req">Save</button>');
      document.getElementById('adm-save-settings-req').onclick = async () => {
        let parsed;
        try { parsed = JSON.parse(document.getElementById('adm-edit-settings-json').value); }
        catch { return Utils.toast('Invalid JSON', 'error'); }
        const r = await API.updateSettingsRequest(req.id, parsed, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Update failed', 'error');
        Utils.hideModal();
        Utils.toast('Request updated', 'success');
        this.renderSettingsApprovals(el);
      };
    }));
    el.querySelectorAll('.del-req').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this settings request from history?')) return;
      const r = await API.deleteSettingsRequest(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Delete failed', 'error');
      Utils.toast('Deleted', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.appr-waste').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Approve this waste and deduct stock?')) return;
      const r = await API.recipeWasteApprove(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Approve failed', 'error');
      Utils.toast('Waste approved — stock deducted', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.rej-waste').forEach(b => b.addEventListener('click', async () => {
      const r = await API.recipeWasteReject(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Reject failed', 'error');
      Utils.toast('Waste request rejected', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.del-waste').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this waste record?')) return;
      const r = await API.recipeWasteDelete(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Delete failed', 'error');
      Utils.toast('Waste record deleted', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.appr-inv-waste').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Approve this waste/damage? Stock items will be deducted.')) return;
      const r = await API.approveWaste(parseInt(b.dataset.id, 10), '', this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Approve failed', 'error');
      Utils.toast('Approved', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.rej-inv-waste').forEach(b => b.addEventListener('click', async () => {
      const notes = prompt('Rejection reason (optional):') || '';
      const r = await API.rejectWaste(parseInt(b.dataset.id, 10), notes, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Reject failed', 'error');
      Utils.toast('Rejected', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.view-inv-waste').forEach(b => b.addEventListener('click', async () => {
      const scope = b.dataset.scope === 'hist' ? invHistList : invPendingList;
      const w = scope.find(x => Number(x.id) === Number(b.dataset.id));
      if (!w) return;
      let photoHtml = '<p class="muted">No photo attached</p>';
      if (w.photo_path_1) {
        try {
          const img = await API.getImageDataUrl(w.photo_path_1);
          if (img.success && (img.dataUrl || img.data)) {
            photoHtml = `<img src="${img.dataUrl || img.data}" alt="Waste" style="max-width:100%;max-height:360px;border-radius:8px;border:1px solid var(--border)">`;
          }
        } catch (_) {}
      }
      Utils.showModal('Waste / damage details', `
        <div style="display:grid;gap:8px;font-size:14px">
          <div><strong>Type:</strong> ${w.damage_kind === 'property' ? 'Property' : 'Stock / ingredient'}</div>
          <div><strong>Item:</strong> ${Utils.escHtml(w.product_name || w.property_name || '—')}</div>
          <div><strong>Qty:</strong> ${w.quantity}</div>
          <div><strong>Reason:</strong> ${Utils.escHtml(w.reason || '—')}</div>
          <div><strong>By:</strong> ${Utils.escHtml(w.employee_name || '—')}</div>
          <div><strong>Status:</strong> ${Utils.escHtml(w.status || 'pending')}</div>
          ${photoHtml}
        </div>`, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    }));
    el.querySelectorAll('.view-waste').forEach(b => b.addEventListener('click', async () => {
      const scope = b.dataset.scope === 'hist' ? wasteHistory : wastePending;
      const w = scope.find(x => Number(x.id) === Number(b.dataset.id))
        || wastePending.find(x => Number(x.id) === Number(b.dataset.id))
        || wasteHistory.find(x => Number(x.id) === Number(b.dataset.id));
      if (!w) return;
      let photoHtml = '<p class="muted">No photo attached</p>';
      if (w.photo_path) {
        try {
          const img = await API.getImageDataUrl(w.photo_path);
          if (img.success && (img.dataUrl || img.data)) {
            photoHtml = `<img src="${img.dataUrl || img.data}" alt="Waste" style="max-width:100%;max-height:360px;border-radius:8px;border:1px solid var(--border)">`;
          }
        } catch (_) {}
      }
      Utils.showModal('Waste request details', `
        <div style="display:grid;gap:8px;font-size:14px">
          <div><strong>Type:</strong> ${w.waste_type || '—'}</div>
          <div><strong>Item:</strong> ${w.product_name || '—'}</div>
          <div><strong>Qty:</strong> ${w.quantity} ${w.unit || ''}</div>
          <div><strong>Cost:</strong> ${Utils.formatMoney(w.cost)}</div>
          <div><strong>Reason:</strong> ${Utils.escHtml(w.reason || '—')}</div>
          <div><strong>By:</strong> ${Utils.escHtml(w.recorded_by_name || '—')}</div>
          ${photoHtml}
        </div>`, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    }));
  },

  async renderPermissions(el) {
    const usersRes = await API.getUsers(this.app.user);
    if (!usersRes.success) {
      el.innerHTML = `<div class="admin-section"><p class="error-msg">${Utils.escHtml(usersRes.error || 'Could not load users')}</p></div>`;
      return;
    }
    const users = usersRes.data || [];
    const active = users.filter(u => u.is_active);
    const inactive = users.filter(u => !u.is_active);

    const userRow = (u) => {
      let perms = {};
      try { perms = JSON.parse(u.permissions || '{}'); } catch {}
      const isSelf = u.id === this.app.user?.id;
      return `<tr><td>${u.full_name}</td><td>${u.username}</td><td>${Utils.roleTag(u.role)}</td>
        <td>${u.is_active ? '<span class="tag success">Active</span>' : '<span class="tag">Inactive</span>'}</td>
        <td><small>${Object.keys(perms).filter(k=>perms[k]).join(', ') || 'Default role permissions'}</small></td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-ghost edit-user" data-id="${u.id}">Edit</button>
          ${!isSelf && u.is_active ? `<button class="btn btn-sm btn-warning del-user" data-id="${u.id}">Deactivate</button>` : ''}
          ${!isSelf && !u.is_active ? `<button class="btn btn-sm btn-primary restore-user" data-id="${u.id}">Restore</button>` : ''}
          ${!isSelf ? `<button class="btn btn-sm btn-danger purge-user" data-id="${u.id}">Delete</button>` : ''}
        </td></tr>`;
    };

    el.innerHTML = `<div class="admin-section"><h3>Users & Permissions</h3>
      <div style="margin-bottom:12px"><button class="btn btn-primary" id="admin-add-user">+ Add User</button></div>
      <h4>Active Users</h4>
      <div class="card" style="margin-bottom:16px"><div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th><th>Permissions</th><th></th></tr></thead>
        <tbody>${active.map(userRow).join('') || '<tr><td colspan="6" class="muted">No active users</td></tr>'}</tbody>
      </table></div></div>
      <h4>Inactive Users</h4>
      <div class="card" style="margin-bottom:16px"><div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th><th>Permissions</th><th></th></tr></thead>
        <tbody>${inactive.map(userRow).join('') || '<tr><td colspan="6" class="muted">No inactive users</td></tr>'}</tbody>
      </table></div></div>
      <div class="card"><div class="card-body">
        <h4>Default Role Access</h4>
        <p><strong>Owner:</strong> Full access to everything</p>
        <p><strong>Manager:</strong> Reports, stock, ops — <em>Staff Portal</em> and extra pages need explicit permission. Managers cannot open Payroll, Backup, Analytics, Import/Export, Database, Developer, or Device settings (owner only).</p>
        <p><strong>Supervisor:</strong> Whitelisted admin sections only — no owner-only tools.</p>
        <p><strong>Assistant Manager:</strong> Access granted per permission checkbox only</p>
        <p><strong>Cashier:</strong> POS only by default — grant <em>Process returns</em> for Returns, and <em>Staff Portal</em> for the sidebar Staff Portal</p>
        <p class="muted" style="margin-top:8px">Staff UIF/PAYE/SDL only apply after you enable them under Payroll <strong>and</strong> mark each employee as registered on their HR profile. Owner salary needs both Payroll enable and the Owner Salary checkboxes.</p>
      </div></div></div>`;

    const refresh = () => this.renderPermissions(el);
    document.getElementById('admin-add-user')?.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.showForm(null, refresh);
    });
    el.querySelectorAll('.edit-user').forEach(b => b.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.showForm(users.find(u => u.id == b.dataset.id), refresh);
    }));
    el.querySelectorAll('.del-user').forEach(b => b.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.deactivateUser(users.find(u => u.id == b.dataset.id), refresh);
    }));
    el.querySelectorAll('.purge-user').forEach(b => b.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.permanentlyDeleteUser(users.find(u => u.id == b.dataset.id), refresh);
    }));
    el.querySelectorAll('.restore-user').forEach(b => b.addEventListener('click', async () => {
      const r = await API.updateUser(parseInt(b.dataset.id, 10), { is_active: true }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Restore failed', 'error');
      Utils.toast('User restored', 'success');
      refresh();
    }));
  },

  renderTaxCurrency(el) {
    const s = this.settings;
    const showOnPos = s.tax_show_on_pos !== 0 && s.tax_show_on_pos !== false && s.tax_show_on_pos !== '0';
    el.innerHTML = `<div class="admin-section"><h3>Tax & Currency Settings</h3>
      <p class="muted">Turn tax on for sales and stock purchases. Choose whether it appears on the POS screen and receipts.</p>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label><input type="checkbox" id="tax-enabled" ${s.tax_enabled?'checked':''}> Enable VAT/Tax (calculate on sales &amp; purchases)</label></div>
        <div class="field"><label><input type="checkbox" id="tax-show-pos" ${showOnPos?'checked':''}> Show tax on POS &amp; receipts</label></div>
        <div class="field"><label>VAT Percentage</label><input type="number" id="tax-rate" step="0.1" value="${s.tax_rate||0}"></div>
        <div class="field"><label><input type="checkbox" id="tax-inclusive" ${s.tax_inclusive?'checked':''}> Tax inclusive pricing</label></div>
        <div class="field"><label>VAT Number</label><input id="vat-num" value="${s.vat_number||''}"></div>
        <div class="field"><label>Currency Symbol</label><input id="cur-symbol" value="${s.currency||'R'}"></div>
        <div class="field"><label>Currency Name</label><input id="cur-name" value="${s.currency_name||'Rand'}"></div>
        <div class="field"><label>Decimal Places</label><input type="number" id="cur-dec" min="0" max="4" value="${s.decimal_places??2}"></div>
        <div class="field"><label>Thousands Separator</label>
          <select id="cur-sep"><option value="," ${s.thousands_sep===','?'selected':''}>Comma (,)</option>
          <option value=" " ${s.thousands_sep===' '?'selected':''}>Space</option>
          <option value="." ${s.thousands_sep==='.'?'selected':''}>Period (.)</option></select></div>
      </div>
      <button class="btn btn-primary" id="save-tax" style="margin-top:16px">Save Tax & Currency</button>
      <p class="muted" style="margin-top:12px">See <strong>Tax Calculations</strong> for sales VAT, purchase VAT, and bookkeeping link.</p>
      </div></div></div>`;

    document.getElementById('save-tax').addEventListener('click', async () => {
      const patch = {
        tax_enabled: document.getElementById('tax-enabled').checked ? 1 : 0,
        tax_show_on_pos: document.getElementById('tax-show-pos').checked ? 1 : 0,
        tax_rate: parseFloat(document.getElementById('tax-rate').value) || 0,
        tax_inclusive: document.getElementById('tax-inclusive').checked ? 1 : 0,
        vat_number: document.getElementById('vat-num').value.trim(),
        currency: document.getElementById('cur-symbol').value.trim(),
        currency_name: document.getElementById('cur-name').value.trim(),
        decimal_places: parseInt(document.getElementById('cur-dec').value) || 2,
        thousands_sep: document.getElementById('cur-sep').value
      };
      const r = await this.awaitSave(
        API.saveSettings(patch, this.app.user),
        null,
        'Could not save tax & currency'
      );
      if (!r) return;
      this.settings = { ...this.settings, ...patch };
      if (this.app) this.app.settings = { ...this.app.settings, ...patch };
      Utils.toast('Tax & currency saved', 'success');
    });
  },

  async renderTaxHub(el) {
    const currency = this.settings?.currency || 'R';
    const from = this._taxFrom || Utils.daysAgo(30);
    const to = this._taxTo || Utils.today();
    const branchesRes = await API.getBranches();
    const branches = branchesRes.data || [];
    const viewBranch = this.app?.viewBranchId != null ? String(this.app.viewBranchId) : 'all';
    el.innerHTML = `<div class="admin-section"><h3>Tax Calculations</h3>
      <p class="muted">Per-sale tax breakdown, totals, and PDF download. Filter by branch and date range.</p>
      <div class="page-toolbar" style="gap:8px;flex-wrap:wrap;align-items:center">
        <select id="tax-hub-branch">
          <option value="all">All branches</option>
          ${branches.map((b) => `<option value="${b.id}" ${viewBranch === String(b.id) ? 'selected' : ''}>${Utils.escHtml(b.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-days="0">Today</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-days="7">7 days</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-days="30">30 days</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-months="6">6 months</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-year="1">Year</button>
        <input type="date" id="tax-hub-from" value="${from}">
        <input type="date" id="tax-hub-to" value="${to}">
        <button class="btn btn-ghost" id="tax-hub-refresh">Refresh</button>
        <button class="btn btn-primary" id="tax-hub-pdf">Download PDF</button>
        <button class="btn btn-ghost" id="tax-hub-bookkeeping">Bookkeeping</button>
      </div>
      <div id="tax-hub-body"><p class="muted">Loading…</p></div>
    </div>`;

    const setRange = (fromDate, toDate) => {
      document.getElementById('tax-hub-from').value = fromDate;
      document.getElementById('tax-hub-to').value = toDate;
    };

    el.querySelectorAll('.tax-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const toDate = Utils.today();
        if (btn.dataset.days != null) {
          const d = Number(btn.dataset.days);
          setRange(d === 0 ? toDate : Utils.daysAgo(d), toDate);
        } else if (btn.dataset.months) {
          const d = new Date();
          d.setMonth(d.getMonth() - Number(btn.dataset.months));
          setRange(d.toISOString().slice(0, 10), toDate);
        } else if (btn.dataset.year) {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 1);
          setRange(d.toISOString().slice(0, 10), toDate);
        }
        load();
      });
    });

    const load = async () => {
      this._taxFrom = document.getElementById('tax-hub-from').value;
      this._taxTo = document.getElementById('tax-hub-to').value;
      const branchId = document.getElementById('tax-hub-branch').value;
      const body = document.getElementById('tax-hub-body');
      const taxRes = await API.getTaxSummary(this._taxFrom, this._taxTo, branchId === 'all' ? null : branchId);
      if (!taxRes.success) {
        body.innerHTML = `<p class="error-msg">${Utils.escHtml(taxRes.error || 'Failed to load')}</p>`;
        return;
      }
      const t = taxRes.data || {};
      const sales = t.sales || [];
      this._lastTaxReport = t;
      const isOwner = this.app.user?.role === 'owner';
      body.innerHTML = `
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0">
          <div class="card"><div class="card-body"><div class="muted">Sales count</div><strong>${t.salesCount || sales.length}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Gross sales</div><strong>${Utils.formatMoney(t.taxableSales || 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Excl. tax</div><strong>${Utils.formatMoney(t.salesExcl || 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Tax / VAT</div><strong>${Utils.formatMoney(t.outputVat ?? t.vat ?? 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">After tax</div><strong>${Utils.formatMoney(t.salesAfterTax != null ? t.salesAfterTax : ((t.taxableSales || 0) - (t.outputVat ?? t.vat ?? 0)), currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Input VAT (purchases)</div><strong>${Utils.formatMoney(t.inputVat || 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Net VAT</div><strong>${Utils.formatMoney(t.netVat != null ? t.netVat : 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">VAT rate</div><strong>${t.vatRate || 0}%</strong></div></div>
        </div>
        <p class="muted" style="font-size:13px;margin-bottom:8px">Click a receipt to view full sale details (POS or online).</p>
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Receipt</th><th>Date</th><th>Source</th><th>Branch</th><th>Cashier</th><th>Excl. tax</th><th>Tax</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${sales.map((s) => `<tr>
              <td><button type="button" class="link-btn tax-view-sale" data-id="${s.id}">${Utils.escHtml(s.receipt_number || '—')}</button></td>
              <td>${Utils.formatDateTime(s.created_at)}</td>
              <td>${Utils.escHtml(s.channel || (s.order_type === 'online' ? 'Online' : 'POS'))}</td>
              <td>${Utils.escHtml(s.branch_name || '—')}</td>
              <td>${Utils.escHtml(s.cashier_name || '—')}</td>
              <td>${Utils.formatMoney(s.subtotal || 0, currency)}</td>
              <td>${Utils.formatMoney(s.tax_amount || 0, currency)}</td>
              <td><strong>${Utils.formatMoney(s.total || 0, currency)}</strong></td>
              <td style="white-space:nowrap">
                <button type="button" class="btn btn-sm btn-ghost tax-view-sale" data-id="${s.id}">View</button>
                ${isOwner ? `<button type="button" class="btn btn-sm btn-danger tax-void-sale" data-id="${s.id}">Void</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="9" class="muted">No sales in this period</td></tr>'}
          </tbody>
        </table></div></div>`;
      body.querySelectorAll('.tax-view-sale').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (window.AdminPage?.showSaleDetail) AdminPage.showSaleDetail(Number(btn.dataset.id));
          else Utils.toast('Open from Business Dashboard → Sales Management', 'info');
        });
      });
      body.querySelectorAll('.tax-void-sale').forEach((btn) => {
        btn.addEventListener('click', () => {
          Utils.showModal('Void sale', '<div class="field"><label>Reason (required)</label><textarea id="tax-void-reason" rows="3"></textarea></div>',
            '<button class="btn btn-danger" id="tax-void-confirm">Void receipt</button>');
          document.getElementById('tax-void-confirm')?.addEventListener('click', async () => {
            const reason = document.getElementById('tax-void-reason')?.value?.trim();
            if (!reason) return Utils.toast('Reason required', 'error');
            const r = await API.voidSale(Number(btn.dataset.id), reason, this.app.user);
            if (!r.success) return Utils.toast(r.error || 'Void failed', 'error');
            Utils.hideModal();
            Utils.toast('Sale voided', 'success');
            load();
          });
        });
      });
    };

    document.getElementById('tax-hub-refresh')?.addEventListener('click', load);
    document.getElementById('tax-hub-branch')?.addEventListener('change', load);
    document.getElementById('tax-hub-bookkeeping')?.addEventListener('click', () => this.app?.navigate('bookkeeping'));
    document.getElementById('tax-hub-pdf')?.addEventListener('click', async () => {
      const t = this._lastTaxReport;
      if (!t) return Utils.toast('Refresh the report first', 'error');
      const title = `Tax report ${this._taxFrom} to ${this._taxTo}`;
      const headers = ['Receipt', 'Date', 'Branch', 'Cashier', 'Excl. tax', 'Tax', 'Total'];
      const bodyRows = (t.sales || []).map((s) => [
        s.receipt_number || '',
        Utils.formatDateTime(s.created_at),
        s.branch_name || '',
        s.cashier_name || '',
        Utils.formatMoney(s.subtotal || 0, currency),
        Utils.formatMoney(s.tax_amount || 0, currency),
        Utils.formatMoney(s.total || 0, currency)
      ]);
      bodyRows.push(['TOTALS', '', '', '', Utils.formatMoney(t.salesExcl || 0, currency), Utils.formatMoney(t.outputVat ?? t.vat ?? 0, currency), Utils.formatMoney(t.taxableSales || 0, currency)]);
      bodyRows.push(['Net VAT owed', '', '', '', '', Utils.formatMoney(t.netVat || 0, currency), '']);
      if (typeof Export?.toPDF === 'function') {
        await Export.toPDF(`tax-report-${this._taxFrom}.pdf`, title, headers, bodyRows, { shop_name: this.settings?.shop_name });
      } else if (typeof Export?.print === 'function') {
        await Export.print(title, headers, bodyRows, { shop_name: this.settings?.shop_name });
      } else {
        Utils.toast('PDF export not available on this device', 'error');
      }
    });
    await load();
  },

  async renderCashiersPanel(el) {
    const currency = this.settings?.currency || 'R';
    const from = this._cashierFrom || Utils.daysAgo(7);
    const to = this._cashierTo || Utils.today();
    const usersRes = await API.getUsers(this.app?.user);
    const staffUsers = (usersRes.data || []).filter((u) => ['cashier', 'manager', 'supervisor', 'assistant_manager'].includes(u.role));
    el.innerHTML = `<div class="admin-section"><h3>Cashiers &amp; Managers</h3>
      <p class="muted">Manage cashiers and managers on this page and review each person’s sales for the selected period.</p>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><h4>Team — add or edit</h4></div>
      <div class="card-body"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody id="cash-users-tbody">${staffUsers.map((u) => `<tr>
          <td>${Utils.escHtml(u.full_name || '—')}</td>
          <td>${Utils.escHtml(u.username || '—')}</td>
          <td>${Utils.roleTag?.(u.role) || u.role}</td>
          <td>${u.is_active ? '<span class="tag tag-ok">Active</span>' : '<span class="tag tag-out">Inactive</span>'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost cash-edit-user" data-id="${u.id}">Edit</button>
            ${u.id !== this.app?.user?.id && u.is_active ? `<button class="btn btn-sm btn-warning cash-deact-user" data-id="${u.id}">Deactivate</button>` : ''}
            ${u.id !== this.app?.user?.id && !u.is_active ? `<button class="btn btn-sm btn-primary cash-restore-user" data-id="${u.id}">Restore</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="5" class="muted">No cashiers or managers yet</td></tr>'}
        </tbody></table></div>
        <button class="btn btn-primary" id="cash-add-user" style="margin-top:12px">+ Add cashier / manager</button>
      </div></div>
      <div class="page-toolbar" style="gap:8px;flex-wrap:wrap">
        <input type="date" id="cash-from" value="${from}">
        <input type="date" id="cash-to" value="${to}">
        <button class="btn btn-ghost" id="cash-refresh">Refresh sales</button>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Sales</th><th>Subtotal</th><th>Tax</th><th>Total</th><th></th></tr></thead>
        <tbody id="cash-tbody"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody>
      </table></div></div>
      <div id="cash-detail" style="margin-top:16px"></div>
    </div>`;

    const showUserForm = async (user = null) => {
      const roles = ['cashier', 'supervisor', 'assistant_manager', 'manager'];
      Utils.showModal(user ? `Edit ${user.full_name}` : 'Add cashier / manager', `
        <div class="form-grid">
          <div class="field"><label>Full name *</label><input id="cu-name" value="${Utils.escHtml(user?.full_name || '')}"></div>
          <div class="field"><label>Username *</label><input id="cu-user" value="${Utils.escHtml(user?.username || '')}" ${user ? 'readonly' : ''}></div>
          <div class="field"><label>Role</label><select id="cu-role">${roles.map((r) => `<option value="${r}" ${user?.role === r ? 'selected' : ''}>${r.replace(/_/g, ' ')}</option>`).join('')}</select></div>
          <div class="field"><label>${user ? 'New password (optional)' : 'Password *'}</label><input type="password" id="cu-pass"></div>
        </div>`,
        '<button class="btn btn-primary" id="cu-save">Save</button>');
      document.getElementById('cu-save')?.addEventListener('click', async () => {
        const full_name = document.getElementById('cu-name').value.trim();
        const username = document.getElementById('cu-user').value.trim();
        const role = document.getElementById('cu-role').value;
        const password = document.getElementById('cu-pass').value;
        if (!full_name || !username) return Utils.toast('Name and username required', 'error');
        if (!user && (!password || password.length < 6)) return Utils.toast('Password must be at least 6 characters', 'error');
        const payload = { full_name, username, role, is_active: true };
        if (password) payload.password = password;
        const r = user
          ? await API.updateUser(user.id, payload, this.app?.user)
          : await API.createUser({ ...payload, password }, this.app?.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast(user ? 'User updated' : 'User created', 'success');
        this.renderCashiersPanel(el);
      });
    };

    document.getElementById('cash-add-user')?.addEventListener('click', () => showUserForm());
    el.querySelectorAll('.cash-edit-user').forEach((btn) => btn.addEventListener('click', () => {
      const u = staffUsers.find((x) => String(x.id) === btn.dataset.id);
      if (u) showUserForm(u);
    }));
    el.querySelectorAll('.cash-deact-user').forEach((btn) => btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      if (!confirm('Deactivate this user?')) return;
      const r = await API.updateUser(id, { is_active: false }, this.app?.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('User deactivated', 'success');
      this.renderCashiersPanel(el);
    }));
    el.querySelectorAll('.cash-restore-user').forEach((btn) => btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const r = await API.updateUser(id, { is_active: true }, this.app?.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('User restored', 'success');
      this.renderCashiersPanel(el);
    }));

    const load = async () => {
      this._cashierFrom = document.getElementById('cash-from').value;
      this._cashierTo = document.getElementById('cash-to').value;
      const res = await API.getCashierReport(this._cashierFrom, this._cashierTo);
      const rows = res.data || [];
      document.getElementById('cash-tbody').innerHTML = rows.map(c => `<tr>
        <td>${Utils.escHtml(c.full_name || '—')}</td>
        <td>${Utils.escHtml(c.username || '—')}</td>
        <td>${Utils.roleTag?.(c.role) || c.role || '—'}</td>
        <td>${c.sales_count || 0}</td>
        <td>${Utils.formatMoney(c.subtotal || 0, currency)}</td>
        <td>${Utils.formatMoney(c.tax_total || 0, currency)}</td>
        <td><strong>${Utils.formatMoney(c.total || 0, currency)}</strong></td>
        <td><button class="btn btn-sm btn-ghost cash-drill" data-id="${c.user_id}" data-name="${Utils.escHtml(c.full_name || '')}">Details</button></td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">No cashier sales in this period</td></tr>';

      document.querySelectorAll('.cash-drill').forEach(btn => btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const detail = document.getElementById('cash-detail');
        detail.innerHTML = `<p class="muted">Loading sales for ${btn.dataset.name}…</p>`;
        const dRes = await API.getCashierSalesDetail(this._cashierFrom, this._cashierTo, id);
        const sales = dRes.data || [];
        detail.innerHTML = `<h4>${Utils.escHtml(btn.dataset.name)} — sales</h4>
          <div class="card"><div class="table-wrap"><table>
            <thead><tr><th>Receipt</th><th>Date</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Pay</th></tr></thead>
            <tbody>${sales.map(s => `<tr>
              <td>${Utils.escHtml(s.receipt_number || '—')}</td>
              <td>${Utils.formatDateTime(s.created_at)}</td>
              <td>${Utils.formatMoney(s.subtotal || 0, currency)}</td>
              <td>${Utils.formatMoney(s.tax_amount || 0, currency)}</td>
              <td>${Utils.formatMoney(s.total || 0, currency)}</td>
              <td>${Utils.escHtml(s.payment_method || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">No sales</td></tr>'}</tbody>
          </table></div></div>`;
      }));
    };

    document.getElementById('cash-refresh')?.addEventListener('click', load);
    await load();
  },

  async renderSalesTargets(el) {
    const res = await API.getSalesTargets();
    const raw = res?.data || res || {};
    const periodVal = (p) => {
      const v = raw[p];
      if (v != null && typeof v === 'object') {
        return { amount: Number(v.amount) || 0, active: v.active !== false, expires_at: v.expires_at || '' };
      }
      return { amount: Number(v) || 0, active: p === 'daily' && Number(v) > 0, expires_at: '' };
    };
    const periods = ['daily', 'weekly', 'monthly', 'yearly'];
    const t = Object.fromEntries(periods.map((p) => [p, periodVal(p)]));
    const currency = this.settings.currency || 'R';
    const today = Utils.today();
    const loadTargetProducts = async () => {
      const get = API.getProducts?._uncached || API.getProducts;
      if (typeof get !== 'function') return [];
      const attempts = [
        { admin_list: true, all_branches: true },
        { admin_list: true },
        { admin_list: true, omit_images: true, all_branches: true },
        { omit_images: true, all_branches: true },
        {}
      ];
      for (const filters of attempts) {
        try {
          const pr = await get(filters);
          if (!pr || pr.success === false) continue;
          const rawList = pr.data ?? pr;
          if (!Array.isArray(rawList) || !rawList.length) continue;
          return rawList
            .filter((p) => p && p.id != null
              && (p.is_active === undefined || p.is_active === 1 || p.is_active === true || p.is_active === '1' || p.is_active === 't')
              && String(p.item_type || '') !== 'ingredient')
            .slice(0, 3000);
        } catch (_) { /* try next */ }
      }
      try {
        const search = await API.globalSearch?.('a');
        const hits = search?.data?.products || search?.products || [];
        if (Array.isArray(hits) && hits.length) {
          return hits.map((p) => ({
            id: p.id,
            name: p.name,
            selling_price: p.selling_price,
            sku: p.sku,
            barcode: p.barcode,
            is_active: 1
          }));
        }
      } catch (_) { /* ignore */ }
      return [];
    };

    const [br, dash, productCatalogRaw, progressRes] = await Promise.all([
      API.getBranches?.().catch(() => null),
      API.getDashboardStats(today, today, this.app.user).catch(() => null),
      loadTargetProducts(),
      API.getTodayTargetProgress?.(this._salesTargetBranchId === 'all' ? null : this._salesTargetBranchId).catch(() => null)
    ]);
    let branches = [];
    try { branches = br?.success !== false ? (br?.data || br || []) : []; } catch (_) { branches = []; }
    if (!Array.isArray(branches)) branches = [];
    const branchId = this._salesTargetBranchId != null ? this._salesTargetBranchId : 'all';
    const branchSlice = branchId !== 'all' ? (raw.by_branch?.[String(branchId)] || {}) : null;
    const dailyForEdit = branchSlice?.daily
      ? {
        amount: Number(branchSlice.daily.amount) || 0,
        active: branchSlice.daily.active !== false,
        expires_at: branchSlice.daily.expires_at || ''
      }
      : t.daily;
    let productTargets = Array.isArray(branchSlice?.product_targets)
      ? branchSlice.product_targets
      : (Array.isArray(raw.product_targets) ? raw.product_targets : []);
    productTargets = productTargets.map((p) => ({
      product_id: Number(p.product_id),
      target_qty: Number(p.target_qty) || 0,
      product_name: p.product_name || p.name || '',
      selling_price: Number(p.selling_price) || 0
    })).filter((p) => p.product_id > 0 && p.target_qty > 0);
    const productMetaSrc = branchSlice?.product_targets_meta || raw.product_targets_meta || {};
    const productMeta = {
      active: productMetaSrc.active === true
        || (productTargets.length > 0 && productMetaSrc.active == null),
      expires_at: productMetaSrc.expires_at || ''
    };

    let todaySales = 0;
    try {
      const data = dash?.data ?? dash ?? {};
      todaySales = Number(data.todaySales ?? data.today?.sales ?? 0) || 0;
    } catch (_) { /* */ }
    const progress = progressRes?.success !== false ? (progressRes?.data || progressRes) : null;
    if (progress && Number(progress.sales_achieved) >= 0) {
      todaySales = Number(progress.sales_achieved) || todaySales;
    }
    const dailyAmt = dailyForEdit.active && !(dailyForEdit.expires_at && String(dailyForEdit.expires_at).slice(0, 10) < today)
      ? Number(dailyForEdit.amount) || 0
      : 0;
    const dailyPct = dailyAmt > 0 ? Math.min(100, Math.round((todaySales / dailyAmt) * 100)) : 0;
    const dailyMet = dailyAmt > 0 && todaySales >= dailyAmt;

    let productCatalog = Array.isArray(productCatalogRaw) ? productCatalogRaw : [];

    const productValueTotal = productTargets.reduce(
      (s, p) => s + (Number(p.target_qty) || 0) * (Number(p.selling_price) || 0),
      0
    );
    const productQtyTotal = productTargets.reduce((s, p) => s + (Number(p.target_qty) || 0), 0);
    const prodProgressActive = !!(progress?.product_targets_active && (progress.products || []).length);
    const prodSoldQty = Number(progress?.product_sold_qty) || 0;
    const prodTargetQty = Number(progress?.product_target_qty) || productQtyTotal;
    const prodSoldVal = Number(progress?.product_sold_value) || 0;
    const prodTargetVal = Number(progress?.product_target_value) || productValueTotal;

    const rowHtml = (p) => {
      const lineTotal = (Number(p.target_qty) || 0) * (Number(p.selling_price) || 0);
      return `<tr data-id="${p.product_id}" data-price="${Number(p.selling_price) || 0}" data-name="${Utils.escHtml(p.product_name || '')}">
        <td>${Utils.escHtml(p.product_name || ('#' + p.product_id))}</td>
        <td>${Utils.formatMoney(p.selling_price || 0, currency)}</td>
        <td><input type="number" class="st-pt-qty" min="1" value="${p.target_qty}" style="width:80px"></td>
        <td class="st-pt-line">${Utils.formatMoney(lineTotal, currency)}</td>
        <td><button type="button" class="btn btn-sm btn-ghost st-pt-rm">Remove</button></td>
      </tr>`;
    };

    el.innerHTML = `<div class="admin-section"><h3>Sales Targets</h3>
      <p class="muted">Daily money target and product quantity targets work separately. Enable only what you want POS to show. Set an expiry if the target should end on a date.</p>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <div class="field" style="max-width:280px;margin-bottom:12px">
          <label>Branch</label>
          <select id="st-branch">
            <option value="all" ${branchId === 'all' ? 'selected' : ''}>All / shop default</option>
            ${branches.map((b) => `<option value="${b.id}" ${String(branchId) === String(b.id) ? 'selected' : ''}>${Utils.escHtml(b.name)}</option>`).join('')}
          </select>
        </div>
        <h4 style="margin:0 0 8px">Today's progress</h4>
        <div style="display:grid;gap:12px">
          <div>
            <div class="muted" style="font-size:12px;margin-bottom:4px">Daily money</div>
            ${dailyAmt > 0
              ? `<p style="margin:0 0 8px"><strong>${Utils.formatMoney(todaySales, currency)}</strong> / ${Utils.formatMoney(dailyAmt, currency)}
                  <span style="margin-left:8px">${dailyPct}%${dailyMet ? ' · Met' : ''}</span></p>
                 <div style="height:10px;background:var(--border,#e5e7eb);border-radius:6px;overflow:hidden">
                   <div style="height:100%;width:${dailyPct}%;background:${dailyMet ? 'var(--success,#16a34a)' : 'var(--primary,#2563eb)'}"></div>
                 </div>`
              : `<p class="muted" style="margin:0">Not active — enable Daily money target below.</p>`}
          </div>
          <div>
            <div class="muted" style="font-size:12px;margin-bottom:4px">Product quantity</div>
            ${prodProgressActive
              ? `<p style="margin:0">Qty <strong>${prodSoldQty}</strong> / ${prodTargetQty}
                   · Value <strong>${Utils.formatMoney(prodSoldVal, currency)}</strong> / ${Utils.formatMoney(prodTargetVal, currency)}</p>`
              : `<p class="muted" style="margin:0">Not active — enable Product targets below.</p>`}
          </div>
        </div>
      </div></div>

      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin:0 0 12px">Daily money target</h4>
        <p class="muted" style="margin:0 0 10px">Only this section controls the money target on POS. Product targets do not affect it.</p>
        <div class="form-grid">
          <div class="field">
            <label>Daily Target (${currency})</label>
            <input type="number" id="st-daily" step="0.01" min="0" value="${dailyForEdit.amount}">
            <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:normal">
              <input type="checkbox" id="st-daily-active" ${dailyForEdit.active ? 'checked' : ''}> Active (show on POS)
            </label>
            <label style="margin-top:6px;font-size:12px">Expires until (optional)</label>
            <input type="date" id="st-daily-exp" value="${dailyForEdit.expires_at ? String(dailyForEdit.expires_at).slice(0, 10) : ''}" min="${today}">
          </div>
          ${periods.filter((p) => p !== 'daily').map((p) => `<div class="field">
            <label>${p.charAt(0).toUpperCase() + p.slice(1)} Target (${currency})</label>
            <input type="number" id="st-${p}" step="0.01" min="0" value="${t[p].amount}">
            <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:normal">
              <input type="checkbox" id="st-${p}-active" ${t[p].active ? 'checked' : ''}> Active
            </label>
            <label style="margin-top:6px;font-size:12px">Expires until (optional)</label>
            <input type="date" id="st-${p}-exp" value="${t[p].expires_at ? String(t[p].expires_at).slice(0, 10) : ''}" min="${today}">
          </div>`).join('')}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h4 style="margin:0 0 8px">Product quantity targets</h4>
        <p class="muted" style="margin:0 0 10px">Search and pick catalog products. Target qty × price = line total. Totals update live.</p>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-weight:normal">
          <input type="checkbox" id="st-prod-active" ${productMeta.active ? 'checked' : ''}> Active (show product targets on POS)
        </label>
        <div class="field" style="max-width:280px;margin-bottom:12px">
          <label style="font-size:12px">Expires until (optional)</label>
          <input type="date" id="st-prod-exp" value="${productMeta.expires_at ? String(productMeta.expires_at).slice(0, 10) : ''}" min="${today}">
        </div>
        <div class="form-grid" style="align-items:end;margin-bottom:10px;position:relative">
          <div class="field" style="flex:2;position:relative">
            <label>Search product</label>
            <input type="search" id="st-prod-search" placeholder="${productCatalog.length ? `Type to find a product (${productCatalog.length} available)…` : 'No products found — add products first'}" autocomplete="off" ${productCatalog.length ? '' : 'disabled'}>
            <div id="st-prod-results" class="search-dropdown hidden" style="position:absolute;left:0;right:0;top:100%;z-index:20;max-height:260px;overflow:auto"></div>
            <input type="hidden" id="st-prod-pick-id" value="">
            <input type="hidden" id="st-prod-pick-name" value="">
            <input type="hidden" id="st-prod-pick-price" value="0">
            <p id="st-prod-picked" class="muted" style="margin:6px 0 0;font-size:12px">No product selected</p>
          </div>
          <div class="field"><label>Target qty</label><input type="number" id="st-prod-qty" min="1" step="1" value="1"></div>
          <div class="field"><button type="button" class="btn btn-primary" id="st-prod-add">Add</button></div>
        </div>
        <div class="table-wrap"><table class="table-compact"><thead><tr><th>Product</th><th>Price</th><th>Target qty</th><th>Line total</th><th></th></tr></thead>
          <tbody id="st-prod-rows">${productTargets.map(rowHtml).join('') || '<tr class="st-pt-empty"><td colspan="5" class="muted">No product targets yet</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2"><strong>Totals to target</strong></td>
              <td id="st-prod-qty-total"><strong>${productQtyTotal}</strong></td>
              <td id="st-prod-val-total"><strong>${Utils.formatMoney(productValueTotal, currency)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table></div>
        <button class="btn btn-primary" id="save-targets" style="margin-top:16px">Save Targets</button>
      </div></div>
    </div>`;

    const collectProductTargets = () => [...el.querySelectorAll('#st-prod-rows tr[data-id]')].map((tr) => ({
      product_id: Number(tr.dataset.id),
      target_qty: Number(tr.querySelector('.st-pt-qty')?.value) || 0,
      product_name: tr.dataset.name || tr.querySelector('td')?.textContent?.trim() || '',
      selling_price: Number(tr.dataset.price) || 0
    })).filter((p) => p.product_id > 0 && p.target_qty > 0);

    const refreshProductTotals = () => {
      const rows = collectProductTargets();
      const qty = rows.reduce((s, p) => s + p.target_qty, 0);
      const val = rows.reduce((s, p) => s + p.target_qty * (Number(p.selling_price) || 0), 0);
      const qtyEl = document.getElementById('st-prod-qty-total');
      const valEl = document.getElementById('st-prod-val-total');
      if (qtyEl) qtyEl.innerHTML = `<strong>${qty}</strong>`;
      if (valEl) valEl.innerHTML = `<strong>${Utils.formatMoney(val, currency)}</strong>`;
      el.querySelectorAll('#st-prod-rows tr[data-id]').forEach((tr) => {
        const q = Number(tr.querySelector('.st-pt-qty')?.value) || 0;
        const price = Number(tr.dataset.price) || 0;
        const line = tr.querySelector('.st-pt-line');
        if (line) line.textContent = Utils.formatMoney(q * price, currency);
      });
    };

    const bindRowRemove = (btn) => {
      btn?.addEventListener('click', () => {
        const tbody = document.getElementById('st-prod-rows');
        btn.closest('tr')?.remove();
        if (!tbody.querySelector('tr[data-id]')) {
          tbody.innerHTML = '<tr class="st-pt-empty"><td colspan="5" class="muted">No product targets yet</td></tr>';
        }
        refreshProductTotals();
      });
    };

    document.getElementById('st-branch')?.addEventListener('change', (e) => {
      this._salesTargetBranchId = e.target.value === 'all' ? 'all' : Number(e.target.value);
      this.renderSalesTargets(el);
    });

    const searchInput = document.getElementById('st-prod-search');
    const resultsEl = document.getElementById('st-prod-results');
    const setPicked = (p) => {
      document.getElementById('st-prod-pick-id').value = p?.id || '';
      document.getElementById('st-prod-pick-name').value = p?.name || '';
      document.getElementById('st-prod-pick-price').value = String(p?.selling_price || 0);
      const label = document.getElementById('st-prod-picked');
      if (label) {
        label.textContent = p
          ? `Selected: ${p.name} · ${Utils.formatMoney(p.selling_price || 0, currency)}`
          : 'No product selected';
      }
      if (searchInput && p) searchInput.value = p.name;
      resultsEl?.classList.add('hidden');
    };

    const paintProductResults = (q) => {
      if (!resultsEl) return;
      const query = String(q || '').trim().toLowerCase();
      if (!query) {
        resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
        return;
      }
      const hits = productCatalog.filter((p) => {
        const name = String(p.name || '').toLowerCase();
        const sku = String(p.sku || '').toLowerCase();
        const barcode = String(p.barcode || '').toLowerCase();
        return name.includes(query) || sku.includes(query) || barcode.includes(query);
      }).slice(0, 40);
      if (!hits.length) {
        resultsEl.innerHTML = '<div class="search-group"><p class="muted" style="padding:8px">No matching products</p></div>';
        resultsEl.classList.remove('hidden');
        return;
      }
      resultsEl.innerHTML = '<div class="search-group">' + hits.map((p) =>
        `<div class="search-item st-prod-hit" data-id="${p.id}" data-name="${Utils.escHtml(p.name)}" data-price="${Number(p.selling_price) || 0}">
          ${Utils.escHtml(p.name)} · ${Utils.formatMoney(p.selling_price || 0, currency)}
        </div>`
      ).join('') + '</div>';
      resultsEl.classList.remove('hidden');
      resultsEl.querySelectorAll('.st-prod-hit').forEach((item) => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          setPicked({
            id: Number(item.dataset.id),
            name: item.dataset.name,
            selling_price: Number(item.dataset.price) || 0
          });
        });
      });
    };

    searchInput?.addEventListener('input', (e) => {
      document.getElementById('st-prod-pick-id').value = '';
      paintProductResults(e.target.value);
    });
    searchInput?.addEventListener('focus', () => {
      if (searchInput.value.trim()) paintProductResults(searchInput.value);
    });
    searchInput?.addEventListener('blur', () => {
      setTimeout(() => resultsEl?.classList.add('hidden'), 180);
    });

    document.getElementById('st-prod-add')?.addEventListener('click', () => {
      const id = Number(document.getElementById('st-prod-pick-id')?.value);
      const qty = Number(document.getElementById('st-prod-qty')?.value) || 0;
      if (!id || qty <= 0) return Utils.toast('Search and select a product, then set quantity', 'error');
      const tbody = document.getElementById('st-prod-rows');
      tbody.querySelector('.st-pt-empty')?.remove();
      if (tbody.querySelector(`tr[data-id="${id}"]`)) return Utils.toast('Product already on the list — edit the qty', 'error');
      const name = document.getElementById('st-prod-pick-name')?.value || `#${id}`;
      const price = Number(document.getElementById('st-prod-pick-price')?.value) || 0;
      tbody.insertAdjacentHTML('beforeend', rowHtml({
        product_id: id,
        product_name: name,
        selling_price: price,
        target_qty: qty
      }));
      bindRowRemove(tbody.querySelector(`tr[data-id="${id}"] .st-pt-rm`));
      tbody.querySelector(`tr[data-id="${id}"] .st-pt-qty`)?.addEventListener('input', refreshProductTotals);
      setPicked(null);
      if (searchInput) searchInput.value = '';
      document.getElementById('st-prod-qty').value = '1';
      const activeCb = document.getElementById('st-prod-active');
      if (activeCb) activeCb.checked = true;
      refreshProductTotals();
    });

    el.querySelectorAll('.st-pt-rm').forEach(bindRowRemove);
    el.querySelectorAll('.st-pt-qty').forEach((inp) => inp.addEventListener('input', refreshProductTotals));

    document.getElementById('save-targets').addEventListener('click', async () => {
      const btn = document.getElementById('save-targets');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      const payload = {
        weekly: {
          amount: parseFloat(document.getElementById('st-weekly')?.value) || 0,
          active: !!document.getElementById('st-weekly-active')?.checked,
          expires_at: document.getElementById('st-weekly-exp')?.value || null
        },
        monthly: {
          amount: parseFloat(document.getElementById('st-monthly')?.value) || 0,
          active: !!document.getElementById('st-monthly-active')?.checked,
          expires_at: document.getElementById('st-monthly-exp')?.value || null
        },
        yearly: {
          amount: parseFloat(document.getElementById('st-yearly')?.value) || 0,
          active: !!document.getElementById('st-yearly-active')?.checked,
          expires_at: document.getElementById('st-yearly-exp')?.value || null
        }
      };
      const dailyPayload = {
        amount: parseFloat(document.getElementById('st-daily')?.value) || 0,
        active: !!document.getElementById('st-daily-active')?.checked,
        expires_at: document.getElementById('st-daily-exp')?.value || null
      };
      const pts = collectProductTargets();
      const productMetaPayload = {
        active: !!document.getElementById('st-prod-active')?.checked && pts.length > 0,
        expires_at: document.getElementById('st-prod-exp')?.value || null
      };
      const bid = document.getElementById('st-branch')?.value || 'all';
      if (bid === 'all') {
        payload.daily = dailyPayload;
        payload.product_targets = pts;
        payload.product_targets_meta = productMetaPayload;
      } else {
        payload.daily = t.daily;
        payload.product_targets = raw.product_targets || [];
        payload.product_targets_meta = raw.product_targets_meta || { active: false, expires_at: null };
        payload.by_branch = { ...(raw.by_branch || {}) };
        payload.by_branch[String(bid)] = {
          daily: dailyPayload,
          product_targets: pts,
          product_targets_meta: productMetaPayload
        };
        payload.branch_id = Number(bid);
        payload.branch_daily = dailyPayload;
        payload.branch_product_targets = pts;
        payload.branch_product_targets_meta = productMetaPayload;
      }
      const r = await this.awaitSave(
        API.saveSalesTargets(payload, this.app.user),
        'Sales targets saved',
        'Could not save targets'
      );
      if (btn) { btn.disabled = false; btn.textContent = 'Save Targets'; }
      if (!r) return;
      try { window.dispatchEvent(new CustomEvent('shop-pos-targets-updated')); } catch (_) { /* */ }
      await this.renderSalesTargets(el);
    });
  },

  bindTopCustomerActions(container, onRefresh) {
    if (!container) return;
    container.querySelectorAll('.tc-edit').forEach((b) => b.addEventListener('click', async () => {
      const detail = await API.getCustomer(parseInt(b.dataset.id, 10));
      const c = detail?.data ?? detail;
      if (!c?.id) return Utils.toast('Customer not found', 'error');
      this.showTopCustomerEditModal(c, onRefresh);
    }));
    container.querySelectorAll('.tc-hist').forEach((b) => b.addEventListener('click', () =>
      this.showTopCustomerHistory(parseInt(b.dataset.id, 10))));
    container.querySelectorAll('.tc-del').forEach((b) => b.addEventListener('click', async () => {
      const currency = this.settings?.currency || 'R';
      const bal = Number(b.dataset.balance) || 0;
      const pts = Number(b.dataset.points) || 0;
      let msg = `Permanently delete "${b.dataset.name}"?`;
      if (bal > 0 || pts > 0) {
        msg += `\n\nThis customer has ${bal > 0 ? `balance ${Utils.formatMoney(bal, currency)}` : ''}${bal > 0 && pts > 0 ? ' and ' : ''}${pts > 0 ? `${pts} loyalty points` : ''}. They will be removed from the system. Past sales stay in reports but will no longer be linked to this customer.`;
      } else {
        msg += '\n\nPast sales stay in reports but will no longer be linked to this customer.';
      }
      if (!confirm(msg)) return;
      const r = await API.deleteCustomer(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not delete', 'error');
      Utils.toast('Customer deleted', 'success');
      window.DataCache?.invalidate?.('customers');
      if (onRefresh) await onRefresh();
      const q = document.getElementById('tc-cust-search')?.value?.trim();
      if (q) document.getElementById('tc-cust-search')?.dispatchEvent(new Event('input'));
    }));
  },

  showTopCustomerEditModal(c, onRefresh) {
    const currency = this.settings?.currency || 'R';
    Utils.showModal('Edit Customer', `<div class="form-grid">
      <div class="field"><label>Name *</label><input id="tc-ed-name" value="${Utils.escHtml(c.name || '')}"></div>
      <div class="field"><label>Phone</label><input id="tc-ed-phone" type="tel" value="${Utils.escHtml(c.phone || '')}"></div>
      <div class="field"><label>Email</label><input id="tc-ed-email" type="email" value="${Utils.escHtml(c.email || '')}"></div>
      <div class="field"><label>Birthday</label><input id="tc-ed-birthday" type="date" value="${Utils.escHtml((c.birthday || '').slice(0, 10))}"></div>
      <div class="field"><label>Balance owed (${currency})</label><input type="number" id="tc-ed-balance" step="0.01" value="${c.balance ?? 0}"></div>
      <div class="field"><label>Credit Limit (${currency})</label><input type="number" id="tc-ed-credit-limit" step="0.01" min="0" placeholder="Use shop default" value="${c.credit_limit ?? ''}"></div>
      <div class="field full"><label><input type="checkbox" id="tc-ed-on-account" ${c.allow_on_account ? 'checked' : ''}> Approved for On Account purchases</label></div>
      <div class="field full"><label><input type="checkbox" id="tc-ed-vip" ${c.is_vip ? 'checked' : ''}> VIP customer</label></div>
      <div class="field full"><label>Address</label><input id="tc-ed-address" value="${Utils.escHtml(c.address || '')}"></div>
      <div class="field full"><label>Notes</label><textarea id="tc-ed-notes" rows="2">${Utils.escHtml(c.notes || '')}</textarea></div>
    </div>`, '<button class="btn btn-primary" id="tc-ed-save">Save Customer</button>');
    document.getElementById('tc-ed-save').addEventListener('click', async () => {
      const name = document.getElementById('tc-ed-name')?.value.trim();
      if (!name) return Utils.toast('Name is required', 'error');
      const limitVal = document.getElementById('tc-ed-credit-limit')?.value;
      const r = await API.saveCustomer({
        id: c.id,
        name,
        phone: document.getElementById('tc-ed-phone')?.value.trim(),
        email: document.getElementById('tc-ed-email')?.value.trim(),
        address: document.getElementById('tc-ed-address')?.value.trim(),
        birthday: document.getElementById('tc-ed-birthday')?.value || null,
        notes: document.getElementById('tc-ed-notes')?.value.trim(),
        balance: parseFloat(document.getElementById('tc-ed-balance')?.value) || 0,
        allow_on_account: document.getElementById('tc-ed-on-account')?.checked,
        is_vip: document.getElementById('tc-ed-vip')?.checked,
        credit_limit: limitVal !== '' ? parseFloat(limitVal) : null
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save', 'error');
      Utils.hideModal();
      Utils.toast('Customer updated', 'success');
      window.DataCache?.invalidate?.('customers');
      if (onRefresh) await onRefresh();
    });
  },

  async showTopCustomerHistory(customerId) {
    let customer = null;
    try {
      const r = await API.getCustomer(customerId);
      customer = r?.data ?? r;
    } catch (_) { /* ignore */ }
    try {
      const [summaryRes, ledgerRes, loyaltyRes] = await Promise.all([
        API.getCustomerPurchaseSummary(customerId),
        API.getCreditLedger(customerId),
        API.getLoyaltyHistory(customerId)
      ]);
      const s = summaryRes?.data ?? summaryRes ?? {};
      const currency = this.settings?.currency || 'R';
      const sales = s.sales || [];
      const ledger = ledgerRes?.data ?? ledgerRes ?? [];
      const loyalty = loyaltyRes?.data ?? loyaltyRes ?? [];
      Utils.showModal(`Customer: ${Utils.escHtml(customer?.name || '')}`, `
        <div class="stats-grid" style="margin-bottom:16px">
          <div class="stat-card"><div class="label">Total Spent</div><div class="value">${Utils.formatMoney(s.totalSpent || 0, currency)}</div></div>
          <div class="stat-card"><div class="label">Orders</div><div class="value">${s.orderCount || 0}</div></div>
          <div class="stat-card"><div class="label">Balance Owed</div><div class="value">${Utils.formatMoney(customer?.balance || 0, currency)}</div></div>
          <div class="stat-card"><div class="label">Loyalty Points</div><div class="value">${Math.floor(customer?.loyalty_points || 0)}</div></div>
        </div>
        <h4>Purchase History</h4>
        ${sales.length ? `<div class="table-wrap"><table style="width:100%"><tr><th>Receipt / Order</th><th>Source</th><th>Total</th><th>Status</th><th>Date</th></tr>
          ${sales.map((x) => `<tr><td>${Utils.escHtml(x.receipt_number || x.order_number || '—')}</td><td>${x.source === 'online' ? 'Online' : 'POS'}</td><td>${Utils.formatMoney(x.total, currency)}</td><td>${Utils.escHtml(x.status || 'completed')}</td><td>${Utils.formatDateTime(x.created_at)}</td></tr>`).join('')}</table></div>`
          : '<p class="muted">No purchases yet</p>'}
        ${ledger.length ? `<h4 style="margin-top:16px">Credit Ledger</h4><div class="table-wrap"><table style="width:100%"><tr><th>Date</th><th>Type</th><th>Amount</th></tr>
          ${ledger.map((l) => `<tr><td>${Utils.formatDateTime(l.created_at)}</td><td>${Utils.escHtml(l.type || '—')}</td><td>${Utils.formatMoney(l.amount, currency)}</td></tr>`).join('')}
          </table></div>` : ''}
        ${loyalty.length ? `<h4 style="margin-top:16px">Loyalty Points History (POS &amp; Online)</h4><div class="table-wrap"><table style="width:100%"><tr><th>Date</th><th>Source</th><th>Type</th><th>Points</th></tr>
          ${loyalty.map((l) => `<tr><td>${Utils.formatDateTime(l.created_at)}</td><td>${Utils.escHtml(l.source || '—')}</td><td>${Utils.escHtml(l.type || '—')}</td><td>${l.points > 0 ? '+' : ''}${l.points}</td></tr>`).join('')}
          </table></div>` : ''}`,
        '<button class="btn btn-ghost" id="tc-hist-close">Close</button>');
      document.getElementById('tc-hist-close')?.addEventListener('click', Utils.hideModal);
    } catch (err) {
      Utils.toast(err.message || 'Could not load customer history', 'error');
    }
  },

  async renderTopCustomers(el) {
    if (!['owner', 'manager'].includes(this.app.user?.role)) {
      el.innerHTML = '<div class="admin-section"><p class="muted">Top Customers is available to owner and manager only.</p></div>';
      return;
    }
    const from = this._tcFrom || Utils.monthStart();
    const to = this._tcTo || Utils.today();
    const limit = this._tcLimit || 50;
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>Top Customers</h3>
      <p class="muted">Full admin control — search any customer, edit all details, view history, delete (even with balance or points), reward with gift cards, or message on WhatsApp.</p>
      <div style="margin-bottom:20px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--bg-secondary,#f8fafc)">
        <h4 style="margin:0 0 8px">Search Customers</h4>
        <input type="search" id="tc-cust-search" placeholder="Search by name, phone or email…" style="padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;width:min(100%,360px)">
        <div id="tc-cust-results" style="margin-top:12px"></div>
      </div>
      <div style="display:flex;gap:8px;align-items:end;margin-bottom:12px;flex-wrap:wrap">
        <div class="field"><label>From</label><input type="date" id="tc-from" value="${from}"></div>
        <div class="field"><label>To</label><input type="date" id="tc-to" value="${to}"></div>
        <div class="field"><label>Top N</label><input type="number" id="tc-limit" min="5" max="200" value="${limit}" style="width:80px"></div>
        <button class="btn btn-primary" id="tc-load">Load</button>
        <button class="btn btn-ghost" id="tc-excel">Excel</button>
      </div>
      <div id="tc-table"><p class="muted">Loading…</p></div></div>`;
    let custSearchTimer = null;
    const renderCustSearch = (rows) => {
      const box = document.getElementById('tc-cust-results');
      if (!box) return;
      if (!rows.length) {
        box.innerHTML = '<p class="muted">No customers match your search</p>';
        return;
      }
      box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Balance</th><th>Points</th><th></th></tr></thead><tbody>
        ${rows.map((c) => `<tr>
          <td><strong>${Utils.escHtml(c.name)}</strong></td>
          <td>${Utils.escHtml(c.phone || '—')}</td>
          <td>${Utils.escHtml(c.email || '—')}</td>
          <td>${Utils.formatMoney(c.balance, currency)}</td>
          <td>${Math.floor(c.loyalty_points || 0)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-primary tc-edit" data-id="${c.id}">Edit</button>
            <button class="btn btn-sm btn-ghost tc-hist" data-id="${c.id}">History</button>
            <button class="btn btn-sm btn-danger tc-del" data-id="${c.id}" data-name="${Utils.escHtml(c.name)}" data-balance="${c.balance || 0}" data-points="${Math.floor(c.loyalty_points || 0)}">Delete</button>
          </td></tr>`).join('')}
        </tbody></table></div>`;
      this.bindTopCustomerActions(box, load);
    };
    document.getElementById('tc-cust-search')?.addEventListener('input', (e) => {
      clearTimeout(custSearchTimer);
      const q = e.target.value.trim();
      custSearchTimer = setTimeout(async () => {
        const box = document.getElementById('tc-cust-results');
        if (!q) {
          if (box) box.innerHTML = '';
          return;
        }
        if (box) box.innerHTML = '<p class="muted">Searching…</p>';
        try {
          const res = await API.getCustomers(q);
          renderCustSearch(res?.data ?? (Array.isArray(res) ? res : []));
        } catch (err) {
          if (box) box.innerHTML = `<p class="muted">${Utils.escHtml(err.message || 'Search failed')}</p>`;
        }
      }, 200);
    });
    const load = async () => {
      const f = document.getElementById('tc-from').value;
      const t = document.getElementById('tc-to').value;
      const lim = parseInt(document.getElementById('tc-limit').value, 10) || 50;
      this._tcFrom = f; this._tcTo = t; this._tcLimit = lim;
      const tableEl = document.getElementById('tc-table');
      if (tableEl) tableEl.innerHTML = '<p class="muted">Loading top customers and syncing loyalty points…</p>';
      let rows = [];
      try {
        try { await API.syncMissingLoyaltyPoints(this.app.user); } catch (_) { /* best effort */ }
        const res = await API.getTopCustomers(f, t, lim);
        if (res?.success === false) throw new Error(res.error || 'Could not load top customers');
        rows = Array.isArray(res) ? res : (res?.data || []);
      } catch (err) {
        Utils.toast(err.message || 'Could not load top customers', 'error');
      }
      document.getElementById('tc-table').innerHTML = `
        <h4 style="margin:0 0 12px">Top ${lim} customers — ${f} to ${t}</h4>
        <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Customer</th><th>Phone</th><th>Points</th><th>POS</th><th>Online</th><th>Total Spent</th><th>Visits</th><th></th></tr></thead>
        <tbody>${rows.map((c) => `<tr>
          <td>${c.rank || ''}</td>
          <td><strong>${Utils.escHtml(c.name)}</strong>${Number(c.total_spent) >= lim * 10 ? ' <span class="tag tag-ok">Top</span>' : ''}</td>
          <td>${Utils.escHtml(c.phone || '—')}</td>
          <td><strong>${Math.floor(c.loyalty_points || 0)}</strong></td>
          <td>${Utils.formatMoney(c.pos_spent || 0, currency)}</td>
          <td>${Utils.formatMoney(c.online_spent || 0, currency)}</td>
          <td><strong>${Utils.formatMoney(c.total_spent, currency)}</strong></td><td>${c.visits}</td>
          <td style="white-space:nowrap">
            ${c.id ? `<button class="btn btn-sm btn-primary tc-edit" data-id="${c.id}">Edit</button>` : ''}
            ${c.id ? `<button class="btn btn-sm btn-ghost tc-hist" data-id="${c.id}">History</button>` : ''}
            <button class="btn btn-sm btn-ghost tc-gift" data-id="${c.id || ''}" data-phone="${Utils.escHtml(c.phone || '')}" data-name="${Utils.escHtml(c.name)}">Gift Card</button>
            ${c.phone ? `<button class="btn btn-sm btn-success tc-wa" data-id="${c.id || ''}" data-name="${Utils.escHtml(c.name)}" data-phone="${Utils.escHtml(c.phone)}">WhatsApp</button>` : ''}
            ${c.id ? `<button class="btn btn-sm btn-danger tc-del" data-id="${c.id}" data-name="${Utils.escHtml(c.name)}" data-balance="${c.balance || 0}" data-points="${Math.floor(c.loyalty_points || 0)}">Delete</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="9" class="muted">No customers in this period</td></tr>'}
        </tbody></table></div>
        <p class="muted" style="padding:12px;font-size:13px">Ranked highest to lowest — includes POS sales and online orders. Change Top N and click Load to refresh the list above.</p></div>`;
      this.bindTopCustomerActions(document.getElementById('tc-table'), load);
      document.querySelectorAll('.tc-gift').forEach(b => b.addEventListener('click', async () => {
        const customerId = parseInt(b.dataset.id, 10);
        const customerName = b.dataset.name;
        const customerPhone = b.dataset.phone || '';
        const preset = { id: customerId, name: customerName, phone: customerPhone };
        Utils.showModal(`Gift Card — ${customerName}`, `
          <div class="field"><label>Amount *</label><input type="number" id="tc-gc-amount" step="0.01" min="1" value="100"></div>
          ${Utils.customerPickerHTML('tc-gc')}
          <div class="field"><label><input type="checkbox" id="tc-gc-wa" ${customerPhone ? 'checked' : ''} ${customerPhone ? '' : 'disabled'}> Send via WhatsApp</label></div>`,
          '<button class="btn btn-primary" id="tc-gc-save">Create Gift Card</button>');
        const custRes = await API.getCustomers({});
        const picker = Utils.bindCustomerPicker('tc-gc', custRes.data || [], preset);
        document.getElementById('tc-gc-save').addEventListener('click', async () => {
          const amount = parseFloat(document.getElementById('tc-gc-amount').value);
          const customer = picker.getSelected();
          if (!amount || amount <= 0) return Utils.toast('Enter a valid amount', 'error');
          const r = await API.createGiftCard({
            amount,
            customer_id: customer?.id || customerId,
            customer_phone: customer?.phone || customerPhone || null,
            notes: `Top customer reward — ${customer?.name || customerName}`
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          const code = r.data?.code || '';
          Utils.toast(`Gift card ${code} created`, 'success');
          const sendWa = document.getElementById('tc-gc-wa')?.checked && (customer?.phone || customerPhone);
          if (sendWa) {
            const waRes = await Utils.sendGiftCardWhatsApp(this.app, {
              phone: customer?.phone || customerPhone,
              customerName: customer?.name || customerName,
              customerId: customer?.id || customerId,
              code,
              amount
            });
            if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
          }
        });
      }));
      document.querySelectorAll('.tc-wa').forEach(b => b.addEventListener('click', async () => {
        const r = await API.sendWhatsAppMessage({
          phone: b.dataset.phone, customer_id: parseInt(b.dataset.id, 10),
          recipient_name: b.dataset.name, customer_name: b.dataset.name,
          branch: this.settings.shop_name, message_type: 'thank_you', template_slug: 'thank_you'
        }, this.app.user);
        await Utils.deliverWhatsApp(r, b.dataset.phone);
      }));
      document.getElementById('tc-excel')?.addEventListener('click', async () => {
        await Export.toExcel(`top-customers-${f}-${t}.xlsx`, [{
          name: 'Top Customers',
          data: rows.map((c, i) => ({ Rank: i + 1, Name: c.name, Phone: c.phone || '', Email: c.email || '', Spent: c.total_spent, Visits: c.visits }))
        }]);
      });
    };
    document.getElementById('tc-load').addEventListener('click', load);
    await load();
  },

  async renderShifts(el) {
    const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
    const [shiftsRes, currentRes, shiftSettingsRes, openAllRes] = await Promise.all([
      API.getShifts(50),
      API.getOpenShift(this.app.user),
      API.getShiftSettings(),
      isAdmin ? API.getAllOpenShifts(this.app.user) : Promise.resolve({ data: [] })
    ]);
    const shifts = shiftsRes.data || [];
    const current = currentRes.data;
    const openAll = openAllRes.success ? (openAllRes.data || []) : [];
    const shiftSettings = shiftSettingsRes.success ? (shiftSettingsRes.data || {}) : (this.settings.shift_settings || {});
    const requiredRoles = shiftSettings.required_roles || ['cashier', 'manager', 'assistant_manager', 'owner'];
    const roleOptions = [
      { id: 'owner', label: 'Owner (Admin)' },
      { id: 'manager', label: 'Manager' },
      { id: 'supervisor', label: 'Supervisor' },
      { id: 'assistant_manager', label: 'Assistant Manager' },
      { id: 'cashier', label: 'Cashier' }
    ];
    const currency = this.settings.currency || 'R';

    const cashoutDeadline = shiftSettings.cashout_deadline_time || '22:00';
    const cashoutPenalty = shiftSettings.cashout_late_penalty ?? 0;
    const cashoutEnabled = shiftSettings.cashout_deadline_enabled !== false;
    el.innerHTML = `<div class="admin-section"><h3>Shift Management</h3>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <strong>Shift enforcement by role</strong>
        <p class="muted" style="margin:8px 0">Users with checked roles must open a shift on POS before taking sales. On re-login, they are prompted to continue their open shift.</p>
        <div class="form-grid" style="margin-top:8px">
          ${roleOptions.map(r => `<div class="field"><label><input type="checkbox" class="shift-role-req" data-role="${r.id}" ${requiredRoles.includes(r.id) ? 'checked' : ''}> ${r.label}</label></div>`).join('')}
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
        <strong>Cash-out deadline &amp; late charge</strong>
        <p class="muted" style="margin:8px 0">After this time, any open POS shift is auto-closed. Non-admin users (cashier, etc.) are charged the penalty on their next payroll/payslip. Owner/manager auto-close with no charge.</p>
        <div class="form-grid">
          <div class="field"><label><input type="checkbox" id="cashout-deadline-on" ${cashoutEnabled ? 'checked' : ''}> Enable cash-out deadline</label></div>
          <div class="field"><label>Closing / cash-out time</label><input type="time" id="cashout-deadline" value="${cashoutDeadline}"></div>
          <div class="field"><label>Late cash-out charge (${currency})</label><input type="number" id="cashout-penalty" min="0" step="0.01" value="${cashoutPenalty}"></div>
        </div>
        <button class="btn btn-primary btn-sm" id="save-shift-settings" style="margin-top:12px">Save Shift Settings</button>
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <strong>Cashout WhatsApp notifications</strong>
        <p class="muted" style="margin:8px 0">When cashiers share cash-out reports via WhatsApp (POS or Operations), messages go to this number.</p>
        <div class="field"><label>Admin / Manager WhatsApp Number</label>
          <input id="shift-cashout-wa" value="${this.settings?.whatsapp_settings?.cashout_whatsapp_phone || ''}" placeholder="e.g. 082 123 4567">
          <small class="muted">Falls back to shop phone if empty: ${this.settings?.phone || '—'}</small></div>
        <button class="btn btn-primary btn-sm" id="save-cashout-wa" style="margin-top:12px">Save Cashout WhatsApp Number</button>
      </div></div>
      ${current ? `<div class="card" style="margin-bottom:16px;border-color:var(--success)"><div class="card-body">
        <strong>Your open shift</strong> — Started ${Utils.formatDateTime(current.opened_at)} — Float: ${Utils.formatMoney(current.opening_float, currency)}
        <button class="btn btn-warning btn-sm" id="close-shift" style="margin-left:12px">Close Shift</button>
      </div></div>` : `<div style="margin-bottom:16px">
        <button class="btn btn-success" id="open-shift">Open Shift</button></div>`}
      ${isAdmin && openAll.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><div class="card-body">
        <h4 style="margin-top:0">All open till shifts</h4>
        <div class="table-wrap"><table><thead><tr><th>User</th><th>Opened</th><th>Float</th><th></th></tr></thead>
        <tbody>${openAll.map(sh => `<tr>
          <td>${Utils.escHtml(sh.user_name || '—')}</td>
          <td>${Utils.formatDateTime(sh.opened_at)}</td>
          <td>${Utils.formatMoney(sh.opening_float, currency)}</td>
          <td><button class="btn btn-sm btn-warning sh-force-close" data-id="${sh.id}">Force close</button></td>
        </tr>`).join('')}</tbody></table></div>
      </div></div>` : ''}
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Opened</th><th>Closed</th><th>Sales</th><th>Cash</th><th>Card</th><th>Mobile</th><th>Cash Diff</th><th>Target</th><th>Status</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>${shifts.map(sh => {
          let actual = {};
          try { actual = JSON.parse(sh.actual_payments_json || '{}'); } catch {}
          const targetLabel = sh.daily_target > 0
            ? (sh.target_met ? '<span class="tag tag-ok">Met</span>' : Utils.formatMoney(sh.target_remaining, currency))
            : '—';
          return `<tr><td>${sh.user_name||'—'}</td><td>${Utils.formatDateTime(sh.opened_at)}</td>
          <td>${sh.closed_at ? Utils.formatDateTime(sh.closed_at) : '—'}</td>
          <td>${Utils.formatMoney(sh.total_sales, currency)}</td>
          <td>${Utils.formatMoney(sh.total_cash, currency)}${actual.cash != null ? `<br><small>Counted: ${Utils.formatMoney(actual.cash, currency)}</small>` : ''}</td>
          <td>${Utils.formatMoney(sh.total_card, currency)}</td>
          <td>${Utils.formatMoney(sh.mobile_sales ?? sh.total_mobile, currency)}</td>
          <td>${Utils.formatMoney(sh.cash_difference, currency)}</td>
          <td>${targetLabel}</td>
          <td><span class="tag ${sh.status==='open'?'tag-low':'tag-ok'}">${sh.status}</span></td>
          ${isAdmin ? `<td style="white-space:nowrap">
            ${sh.status === 'open' ? `<button class="btn btn-sm btn-warning sh-force-close" data-id="${sh.id}">Force close</button>` : ''}
            <button class="btn btn-sm btn-ghost sh-edit" data-id="${sh.id}">Edit</button>
            ${sh.status !== 'open' ? `<button class="btn btn-sm btn-danger sh-del" data-id="${sh.id}">Delete</button>` : ''}
          </td>` : ''}
          </tr>`;
        }).join('') || `<tr><td colspan="${isAdmin ? 11 : 10}" class="muted">No shifts yet</td></tr>`}
        </tbody></table></div></div></div>`;

    document.getElementById('save-shift-settings')?.addEventListener('click', async () => {
      const roles = [...document.querySelectorAll('.shift-role-req:checked')].map(cb => cb.dataset.role);
      if (!roles.length) return Utils.toast('Select at least one role', 'error');
      const r = await API.saveShiftSettings({
        required_roles: roles,
        cashout_deadline_enabled: !!document.getElementById('cashout-deadline-on')?.checked,
        cashout_deadline_time: document.getElementById('cashout-deadline')?.value || '22:00',
        cashout_late_penalty: parseFloat(document.getElementById('cashout-penalty')?.value) || 0
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      this.settings.shift_settings = r.data;
      this.app.settings = { ...this.app.settings, shift_settings: r.data };
      Utils.toast('Shift settings saved', 'success');
    });

    document.getElementById('save-cashout-wa')?.addEventListener('click', async () => {
      const phone = document.getElementById('shift-cashout-wa')?.value.trim() || '';
      const current = this.settings?.whatsapp_settings || {};
      const r = await API.saveWhatsAppSettings({ ...current, cashout_whatsapp_phone: phone }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      const merged = r.data || { ...current, cashout_whatsapp_phone: phone };
      this.settings.whatsapp_settings = merged;
      this.app.settings = { ...this.app.settings, whatsapp_settings: merged };
      Utils.toast('Cashout WhatsApp number saved', 'success');
    });

    document.getElementById('open-shift')?.addEventListener('click', () => {
      Utils.showModal('Open Shift', '<div class="field"><label>Opening Float</label><input type="number" id="shift-float" step="0.01" value="0"></div>',
        '<button class="btn btn-success" id="confirm-open-shift">Open Shift</button>');
      document.getElementById('confirm-open-shift').addEventListener('click', async () => {
        const r = await API.openShift(parseFloat(document.getElementById('shift-float').value) || 0, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        this.renderShifts(el);
        Utils.toast('Shift opened', 'success');
      });
    });

    document.getElementById('close-shift')?.addEventListener('click', () => {
      Utils.showModal('Close Shift', `<div class="form-grid">
        <div class="field"><label>Cash Counted</label><input type="number" id="shift-counted" step="0.01"></div>
        <div class="field"><label>Closing Balance</label><input type="number" id="shift-closing" step="0.01"></div>
        <div class="field full"><label>Notes</label><input id="shift-notes"></div></div>`,
        '<button class="btn btn-warning" id="confirm-close-shift">Close Shift</button>');
      document.getElementById('confirm-close-shift').addEventListener('click', async () => {
        const r = await API.closeShift(current.id, {
          cash_counted: parseFloat(document.getElementById('shift-counted').value) || 0,
          closing_balance: parseFloat(document.getElementById('shift-closing').value) || 0,
          notes: document.getElementById('shift-notes').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        const diff = r.data?.difference || 0;
        Utils.toast(`Shift closed. Cash difference: ${Utils.formatMoney(diff, currency)}`, diff === 0 ? 'success' : 'error');
        this.renderShifts(el);
      });
    });

    el.querySelectorAll('.sh-force-close').forEach(b => b.addEventListener('click', () => {
      Utils.showModal('Force close shift', `<p class="muted">Admin force-close for any open till. Leave cash blank to use expected cash (zero difference).</p>
        <div class="form-grid">
          <div class="field"><label>Cash counted (optional)</label><input type="number" id="fc-cash" step="0.01"></div>
          <div class="field"><label>Closing balance (optional)</label><input type="number" id="fc-close" step="0.01"></div>
          <div class="field full"><label>Notes</label><input id="fc-notes"></div>
        </div>`, '<button class="btn btn-warning" id="fc-go">Force close</button>');
      document.getElementById('fc-go').addEventListener('click', async () => {
        const cashVal = document.getElementById('fc-cash').value;
        const closeVal = document.getElementById('fc-close').value;
        const r = await API.forceCloseShift(parseInt(b.dataset.id, 10), {
          cash_counted: cashVal !== '' ? parseFloat(cashVal) : null,
          closing_balance: closeVal !== '' ? parseFloat(closeVal) : null,
          notes: document.getElementById('fc-notes').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not close', 'error');
        Utils.hideModal();
        Utils.toast('Shift force-closed', 'success');
        this.renderShifts(el);
      });
    }));
    el.querySelectorAll('.sh-edit').forEach(b => b.addEventListener('click', () => {
      const sh = shifts.find(x => String(x.id) === b.dataset.id);
      if (!sh) return;
      Utils.showModal('Edit shift', `<div class="form-grid">
        <div class="field"><label>Cash counted</label><input type="number" id="se-cash" step="0.01" value="${sh.cash_counted ?? ''}"></div>
        <div class="field"><label>Closing balance</label><input type="number" id="se-close" step="0.01" value="${sh.closing_balance ?? ''}"></div>
        <div class="field full"><label>Notes</label><textarea id="se-notes" rows="3">${Utils.escHtml(sh.notes || '')}</textarea></div>
      </div>`, '<button class="btn btn-primary" id="se-save">Save</button>');
      document.getElementById('se-save').addEventListener('click', async () => {
        const r = await API.updateShift(parseInt(b.dataset.id, 10), {
          cash_counted: document.getElementById('se-cash').value !== '' ? parseFloat(document.getElementById('se-cash').value) : null,
          closing_balance: document.getElementById('se-close').value !== '' ? parseFloat(document.getElementById('se-close').value) : null,
          notes: document.getElementById('se-notes').value
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not update', 'error');
        Utils.hideModal();
        Utils.toast('Shift updated', 'success');
        this.renderShifts(el);
      });
    }));
    el.querySelectorAll('.sh-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this closed shift record? This cannot be undone.')) return;
      const r = await API.deleteShift(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not delete', 'error');
      Utils.toast('Shift deleted', 'success');
      this.renderShifts(el);
    }));
  },

  renderOperatingHours(el) {
    const oh = this.settings.operating_hours_settings || {};
    const days = oh.weekly || [
      { day: 0, name: 'Sunday', open: '08:00', close: '18:00', closed: false },
      { day: 1, name: 'Monday', open: '08:00', close: '18:00', closed: false },
      { day: 2, name: 'Tuesday', open: '08:00', close: '18:00', closed: false },
      { day: 3, name: 'Wednesday', open: '08:00', close: '18:00', closed: false },
      { day: 4, name: 'Thursday', open: '08:00', close: '18:00', closed: false },
      { day: 5, name: 'Friday', open: '08:00', close: '18:00', closed: false },
      { day: 6, name: 'Saturday', open: '08:00', close: '18:00', closed: false }
    ];
    const forceOnline = oh.force_online || 'auto';
    const forcePos = oh.force_pos || 'auto';
    const forceLogin = oh.force_login || 'auto';
    const onlineLabel = forceOnline === 'open' ? 'forced open' : forceOnline === 'closed' ? 'forced closed' : 'follows schedule (countdown)';
    const posLabel = forcePos === 'open' ? 'forced open' : forcePos === 'closed' ? 'closing alert on' : 'follows schedule (countdown)';
    const loginLabel = forceLogin === 'open' ? 'always allow sign-in' : 'follows schedule (still typeable)';
    const anyForced = forceOnline !== 'auto' || forcePos !== 'auto' || forceLogin !== 'auto';
    el.innerHTML = `<div class="admin-section"><h3>Operating Hours — Weekly Schedule</h3>
      <p class="muted">Save the weekly times to apply them immediately. Order Online closes on schedule. POS stays open and only shows a professional closing alert. Use the force buttons to override right now — they take effect immediately, no refresh. When you want the normal countdown again (open/close by the times below), use <strong>Follow schedule</strong>.</p>
      <div class="card" style="margin-bottom:12px;border-color:var(--warning)"><div class="card-body">
        <h4 style="margin:0 0 8px">Force open / close now</h4>
        <p class="muted" style="margin:0 0 10px;font-size:13px">Current: Order Online <strong>${onlineLabel}</strong>
          · POS <strong>${posLabel}</strong>
          · Logins <strong>${loginLabel}</strong></p>
        ${anyForced ? `<p style="margin:0 0 12px;padding:10px 12px;background:rgba(245,158,11,.12);border-radius:8px;font-size:13px">A force override is active. To go back to the countdown page (system opens/closes by the weekly times), tap <strong>Follow schedule</strong> for that area — or <strong>All follow schedule</strong>.</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button type="button" class="btn btn-success" id="oh-force-open-online">Force open Order Online</button>
          <button type="button" class="btn btn-warning" id="oh-force-close-online">Force close Order Online</button>
          <button type="button" class="btn btn-ghost" id="oh-force-auto-online">Order Online follow schedule</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button type="button" class="btn btn-success" id="oh-force-open-pos">Force open POS</button>
          <button type="button" class="btn btn-warning" id="oh-force-close-pos">Force close POS</button>
          <button type="button" class="btn btn-ghost" id="oh-force-auto-pos">POS follow schedule</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button type="button" class="btn btn-success" id="oh-force-open-login">Allow all logins (override hours)</button>
          <button type="button" class="btn btn-ghost" id="oh-force-auto-login">Logins follow schedule</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border)">
          <button type="button" class="btn btn-primary" id="oh-force-auto-all">All follow schedule (countdown)</button>
        </div>
      </div></div>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field full"><label><input type="checkbox" id="oh-enabled" ${oh.enabled ? 'checked' : ''}> Enable POS closing countdown banner</label></div>
        <div class="field full"><label><input type="checkbox" id="oh-online" ${oh.apply_to_online !== false ? 'checked' : ''}> Close online ordering at these times (customers see a large closed popup with countdown)</label></div>
        <div class="field"><label>Warning Before Close (minutes)</label><input type="number" id="oh-warn" min="1" max="120" value="${oh.warn_minutes ?? 15}"></div>
        <div class="field full"><label><input type="checkbox" id="oh-alert" ${oh.alert_at_close !== false ? 'checked' : ''}> Alert & play sound when closing time is reached</label></div>
      </div>
      <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Day</th><th>Closed</th><th>Open</th><th>Close</th></tr></thead>
        <tbody>${days.map(d => `<tr>
          <td><strong>${d.name}</strong></td>
          <td><input type="checkbox" class="oh-closed" data-day="${d.day}" ${d.closed ? 'checked' : ''}></td>
          <td><input type="time" class="oh-open" data-day="${d.day}" value="${d.open || '08:00'}"></td>
          <td><input type="time" class="oh-close" data-day="${d.day}" value="${d.close || '18:00'}"></td>
        </tr>`).join('')}
        </tbody></table></div>
      <button class="btn btn-primary" id="save-operating" style="margin-top:16px">Save Operating Hours</button>
      </div></div></div>`;

    const collectHours = (overrides = {}) => {
      const weekly = days.map(d => ({
        day: d.day, name: d.name,
        closed: document.querySelector(`.oh-closed[data-day="${d.day}"]`)?.checked || false,
        open: document.querySelector(`.oh-open[data-day="${d.day}"]`)?.value || '08:00',
        close: document.querySelector(`.oh-close[data-day="${d.day}"]`)?.value || '18:00'
      }));
      const today = weekly.find(w => w.day === new Date().getDay()) || weekly[0];
      return {
        enabled: document.getElementById('oh-enabled').checked,
        apply_to_online: document.getElementById('oh-online')?.checked !== false,
        open_time: today.open,
        close_time: today.close,
        warn_minutes: parseInt(document.getElementById('oh-warn').value, 10) || 15,
        alert_at_close: document.getElementById('oh-alert').checked,
        weekly,
        force_online: overrides.force_online != null ? overrides.force_online : (oh.force_online || 'auto'),
        force_pos: overrides.force_pos != null ? overrides.force_pos : (oh.force_pos || 'auto'),
        force_login: overrides.force_login != null ? overrides.force_login : (oh.force_login || 'auto')
      };
    };
    const persistHours = async (data, okMsg) => {
      data.hours_revision = Date.now();
      this.settings.operating_hours_settings = data;
      this.app.settings = { ...(this.app.settings || {}), operating_hours_settings: data };
      try { new BroadcastChannel('shop-pos-hours').postMessage(data); } catch (_) { /* */ }
      this.app.applyOperatingHours?.(data);
      this.app.startOperatingTimer?.();
      this.renderOperatingHours(el);
      const r = await API.saveJsonSetting('operating_hours_settings', data, this.app.user);
      if (!r?.success) return Utils.toast(r?.error || 'Could not save operating hours — sign in again and retry', 'error');
      Utils.toast(okMsg, 'success');
    };

    document.getElementById('save-operating').addEventListener('click', async () => {
      await persistHours(collectHours({}), 'Operating hours saved — the schedule is live now');
    });
    document.getElementById('oh-force-open-online')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_online: 'open' }), 'Order Online is forced open now');
    });
    document.getElementById('oh-force-close-online')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_online: 'closed' }), 'Order Online forced closed — hiring and reports are closed too');
    });
    document.getElementById('oh-force-auto-online')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_online: 'auto' }), 'Order Online follows the weekly schedule again — countdown is back');
    });
    document.getElementById('oh-force-open-pos')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_pos: 'open' }), 'POS is forced open now — tills can sell');
    });
    document.getElementById('oh-force-close-pos')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_pos: 'closed' }), 'POS closing alert is on — tills can still sell');
    });
    document.getElementById('oh-force-auto-pos')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_pos: 'auto' }), 'POS follows the weekly schedule again — countdown banner is back');
    });
    document.getElementById('oh-force-open-login')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_login: 'open', force_pos: 'open' }), 'All panel logins stay open — shop hours will not block sign-in');
    });
    document.getElementById('oh-force-auto-login')?.addEventListener('click', async () => {
      await persistHours(collectHours({ force_login: 'auto' }), 'Login banner follows schedule again (typing still allowed)');
    });
    document.getElementById('oh-force-auto-all')?.addEventListener('click', async () => {
      await persistHours(
        collectHours({ force_online: 'auto', force_pos: 'auto', force_login: 'auto' }),
        'Everything follows the weekly schedule again — open/close by the times you set'
      );
    });
  },

  renderCashDrawer(el) {
    el.innerHTML = `<div class="admin-section"><h3>Cash Drawer Management</h3>
      <div class="card"><div class="card-body">
        <p>Opens the cash drawer via your receipt printer (ESC/POS kick command).</p>
        <p class="muted">Enable <strong>Open cash drawer after sale</strong> in Printer Setup to auto-open on cash payments.</p>
        <button class="btn btn-primary" id="open-drawer" style="margin-top:12px">Open Cash Drawer Now</button>
      </div></div></div>`;
    document.getElementById('open-drawer').addEventListener('click', async () => {
      const r = await API.openCashDrawer();
      Utils.toast(r.success ? 'Cash drawer opened' : (r.error || 'Could not open drawer'), r.success ? 'success' : 'error');
    });
  },

  async renderAnalytics(el) {
    el.innerHTML = `<div class="admin-section"><h3>Sales Analytics</h3>
      ${Utils.dateFilterHTML('admin-analytics-filter')}
      <div id="analytics-content" style="margin-top:16px"></div></div>`;
    const load = async (from, to) => {
      const [res, empRes, orderRes] = await Promise.all([
        API.getSalesAnalytics(from, to),
        API.getEmployeeReport(from, to).catch(() => ({ success: false })),
        API.getOrderTypeReport(from, to).catch(() => ({ success: false }))
      ]);
      const data = res.data || {};
      const staff = empRes.data || [];
      const orderTypes = orderRes.data?.by_type || [];
      const topStaff = staff[0];
      const currency = this.settings.currency || 'R';
      document.getElementById('analytics-content').innerHTML = `
        <div class="stats-grid">
          <div class="stat-card primary"><div class="label">Top Selling Staff</div>
            <div class="value" style="font-size:16px">${topStaff ? topStaff.full_name : '—'}</div>
            <small>${topStaff ? `${Utils.formatMoney(topStaff.revenue, currency)} · ${topStaff.sales_count || 0} sales` : 'No sales'}</small>
            <div style="margin-top:8px;display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" id="top-staff-pdf">PDF</button>
              <button class="btn btn-sm btn-ghost" id="top-staff-print">Print</button>
            </div>
          </div>
          <div class="stat-card"><div class="label">Top Products</div><div class="value" style="font-size:14px">${(data.byProduct||[]).slice(0,3).map(p=>p.product_name).join(', ')||'—'}</div></div>
        </div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Staff Sales Ranking</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Staff</th><th>Sales</th><th>Revenue</th></tr></thead>
        <tbody>${staff.map(s => `<tr><td>${s.full_name || '—'}</td><td>${s.sales_count || 0}</td>
          <td>${Utils.formatMoney(s.revenue, currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No data</td></tr>'}
        </tbody></table></div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Best Sellers</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th><th>Profit</th></tr></thead>
        <tbody>${(data.byProduct||[]).map(p=>`<tr><td>${p.product_name}</td><td>${p.qty}</td>
          <td>${Utils.formatMoney(p.revenue,currency)}</td><td>${Utils.formatMoney(p.profit,currency)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No data</td></tr>'}
        </tbody></table></div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>By Category</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Revenue</th></tr></thead>
        <tbody>${(data.byCategory||[]).map(c=>`<tr><td>${c.category||'Uncategorised'}</td><td>${Utils.formatMoney(c.revenue,currency)}</td></tr>`).join('')||'<tr><td colspan="2" class="muted">No data</td></tr>'}
        </tbody></table></div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Order Types (Delivery / Takeaway / Sit-in)</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Type</th><th>Orders</th><th>Revenue</th></tr></thead>
          <tbody>${orderTypes.map(row => `<tr><td>${({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online Order' }[row.order_type] || row.order_type || 'Unknown')}</td>
          <td>${row.orders}</td><td>${Utils.formatMoney(row.revenue, currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No order type data — enable at POS checkout</td></tr>'}
        </tbody></table></div></div>`;
      document.getElementById('top-staff-pdf')?.addEventListener('click', async () => {
        const headers = ['Staff', 'Sales Count', 'Revenue'];
        const rows = staff.map(s => [s.full_name || '—', String(s.sales_count || 0), Utils.formatMoney(s.revenue, currency)]);
        await Export.toPDF(`top-staff-${from}.pdf`, 'Top Selling Staff', headers, rows, { ...Utils.companyInfo(this.settings), dateRange: `${from} to ${to}` });
      });
      document.getElementById('top-staff-print')?.addEventListener('click', async () => {
        const headers = ['Staff', 'Sales Count', 'Revenue'];
        const rows = staff.map(s => [s.full_name || '—', String(s.sales_count || 0), Utils.formatMoney(s.revenue, currency)]);
        await Export.print('Top Selling Staff', headers, rows, { ...Utils.companyInfo(this.settings), dateRange: `${from} to ${to}` });
      });
    };
    Utils.bindDateFilter('admin-analytics-filter', load);
    load(Utils.monthStart(), Utils.today());
  },

  async renderInventory(el) {
    const branchId = this.app?.viewBranchId;
    const currency = this.settings.currency || 'R';
    const paintInv = (inv) => {
    el.innerHTML = `<div class="admin-section"><h3>Inventory Dashboard</h3>
      <p class="muted" style="margin-bottom:12px">Read-only overview. To adjust stock, receive goods, or record waste, use <strong>Stock Management</strong> in the sidebar.</p>
      <button type="button" class="btn btn-primary btn-sm" id="inv-go-stock" style="margin-bottom:16px">Open Stock Management →</button>
      <div class="stats-grid">
        <div class="stat-card primary"><div class="label">Total Stock Value</div><div class="value">${Utils.formatMoney(inv.totalValue, currency)}</div><small>At buying cost</small></div>
        <div class="stat-card warning"><div class="label">Low Stock</div><div class="value">${inv.lowStock || 0}</div><small>At or below minimum</small></div>
        <div class="stat-card danger"><div class="label">Out of Stock</div><div class="value">${inv.outOfStock || 0}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-header"><h3>Low stock items</h3></div><div class="card-body">
          ${(inv.lowStockItems || []).map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--border);color:var(--warning)">${Utils.escHtml(p.name)} — ${p.stock_quantity} left (min ${p.min_stock ?? 0})</div>`).join('') || '<p class="muted">All good</p>'}
        </div></div>
        <div class="card"><div class="card-header"><h3>Out of stock</h3></div><div class="card-body">
          ${(inv.outOfStockItems || []).map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--border);color:var(--danger)">${Utils.escHtml(p.name)}</div>`).join('') || '<p class="muted">None</p>'}
        </div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-header"><h3>Fast Moving (30 days)</h3></div><div class="card-body">
          ${(inv.fastMoving||[]).map(p=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)">${Utils.escHtml(p.product_name)} — ${p.qty} sold</div>`).join('')||'<p class="muted">No data</p>'}
        </div></div>
        <div class="card"><div class="card-header"><h3>Slow Moving (30+ days)</h3></div><div class="card-body">
          ${(inv.slowMoving||[]).map(p=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)">${Utils.escHtml(p.name)} — ${p.stock_quantity} in stock</div>`).join('')||'<p class="muted">No data</p>'}
        </div></div>
      </div></div>`;
    document.getElementById('inv-go-stock')?.addEventListener('click', () => window.App?.navigate?.('stock'));
    };
    const peek = window.DataCache?.peek?.('inventoryStats', [branchId]);
    if (peek?.data) paintInv(peek.data);
    else el.innerHTML = `<div class="admin-section"><h3>Inventory Dashboard</h3></div>`;
    try {
      const res = await API.getInventoryStats(branchId);
      if (el.isConnected) paintInv(res.data || {});
    } catch (_) { /* keep last paint */ }
  },

  renderDiscounts(el) {
    const ds = this.settings.discount_settings || {};
    el.innerHTML = `<div class="admin-section"><h3>Discount Settings</h3>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Max Discount %</label><input type="number" id="disc-max" value="${ds.max_percent||100}"></div>
        <div class="field"><label><input type="checkbox" id="disc-happy" ${ds.happy_hour?'checked':''}> Enable Happy Hour pricing</label></div>
        <div class="field"><label><input type="checkbox" id="disc-coupon" ${ds.coupon_codes?'checked':''}> Enable coupon codes</label></div>
        <div class="field"><label><input type="checkbox" id="disc-loyalty" ${ds.loyalty_discounts?'checked':''}> Enable loyalty discounts</label></div>
        <div class="field"><label><input type="checkbox" id="disc-employee" ${ds.employee_discounts?'checked':''}> Enable employee discounts</label></div>
      </div>
      <button class="btn btn-primary" id="save-discounts" style="margin-top:16px">Save Discount Settings</button>
      </div></div></div>`;
    document.getElementById('save-discounts').addEventListener('click', async () => {
      const dsSave = {
        max_percent: parseInt(document.getElementById('disc-max').value) || 100,
        happy_hour: document.getElementById('disc-happy').checked,
        coupon_codes: document.getElementById('disc-coupon').checked,
        loyalty_discounts: document.getElementById('disc-loyalty').checked,
        employee_discounts: document.getElementById('disc-employee').checked
      };
      const r = await this.awaitSave(API.saveJsonSetting('discount_settings', dsSave, this.app.user), 'Discount settings saved', 'Could not save discount settings');
      if (!r) return;
      this.settings.discount_settings = dsSave;
      if (this.app) this.app.settings = { ...this.app.settings, discount_settings: dsSave };
    });
  },

  renderLoyalty(el) {
    return this.renderLoyaltyHub(el);
  },

  formatOnlineOrderSavings(o, currency) {
    const parts = [];
    const disc = Number(o.discount) || 0;
    if (disc > 0) {
      let line = `-${Utils.formatMoney(disc, currency)}`;
      if (o.coupon_code) line += ` (${o.coupon_code})`;
      parts.push(line);
    }
    if (Number(o.loyalty_points_used) > 0) parts.push(`Loyalty ${o.loyalty_points_used} pts`);
    return parts.length ? parts.join('<br>') : '—';
  },

  formatOnlineOrderGiftCard(o, currency) {
    const amt = Number(o.gift_card_amount) || 0;
    if (amt <= 0 || !o.gift_card_code) return '—';
    return `<code>${Utils.escHtml(o.gift_card_code)}</code><br><small>-${Utils.formatMoney(amt, currency)}</small>`;
  },

  async showOnlineOrderDetail(orderId, onRefresh) {
    const currency = this.settings?.currency || 'R';
    const r = await API.webAdminOrderDetail?.(orderId, this.app?.user);
    const o = r?.data ?? r;
    if (!o || !o.id) return Utils.toast(r?.error || 'Order not found', 'error');
    const items = Array.isArray(o.items) ? o.items : [];
    const events = Array.isArray(o.events) ? o.events : [];
    Utils.showModal(`Online order — ${Utils.escHtml(o.order_number || '')}`, `
      <div class="stats-grid" style="margin-bottom:12px">
        <div class="stat-card"><div class="label">Total</div><div class="value">${Utils.formatMoney(o.total, currency)}</div></div>
        <div class="stat-card"><div class="label">Status</div><div class="value">${Utils.escHtml(o.status || '—')}</div></div>
        <div class="stat-card"><div class="label">Branch</div><div class="value" style="font-size:14px">${Utils.escHtml(o.branch_name || String(o.branch_id || '—'))}</div></div>
        <div class="stat-card"><div class="label">Payment</div><div class="value" style="font-size:14px">${Utils.escHtml(o.payment_method || '—')}</div></div>
      </div>
      <p><strong>Customer:</strong> ${Utils.escHtml(o.customer_name || '—')}
        ${o.customer_phone ? ` · ${Utils.escHtml(o.customer_phone)}` : ''}
        ${o.customer_email ? `<br><span class="muted">${Utils.escHtml(o.customer_email)}</span>` : ''}</p>
      ${o.delivery_address ? `<p><strong>Delivery:</strong> ${Utils.escHtml(o.delivery_address)}</p>` : ''}
      ${o.notes ? `<p><strong>Notes:</strong> ${Utils.escHtml(o.notes)}</p>` : ''}
      ${o.scheduled_for ? `<p><strong>Scheduled:</strong> ${Utils.formatDateTime(o.scheduled_for)}</p>` : ''}
      <h4>Items</h4>
      <div class="table-wrap"><table class="table"><tr><th>Product</th><th>Qty</th><th>Price</th><th>Line total</th></tr>
        ${items.map((it) => `<tr><td>${Utils.escHtml(it.name || it.product_name || '—')}</td><td>${it.quantity || 1}</td><td>${Utils.formatMoney(it.price || it.unit_price || 0, currency)}</td><td>${Utils.formatMoney((it.line_total != null ? it.line_total : (Number(it.price || it.unit_price || 0) * Number(it.quantity || 1))), currency)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No items</td></tr>'}
      </table></div>
      <p class="muted" style="margin-top:8px">Subtotal ${Utils.formatMoney(o.subtotal || 0, currency)} · Discount ${Utils.formatMoney(o.discount || 0, currency)} · Tax ${Utils.formatMoney(o.tax_amount || 0, currency)}</p>
      ${this.formatOnlineOrderGiftCard(o, currency) !== '—' ? `<p>Gift card: ${this.formatOnlineOrderGiftCard(o, currency)}</p>` : ''}
      ${o.sale_id ? `<p class="muted">Linked POS sale #${o.sale_id}${o.accepted_by ? ` · accepted by ${Utils.escHtml(o.accepted_by)}` : ''}</p>` : ''}
      ${events.length ? `<h4 style="margin-top:16px">History</h4><div class="table-wrap"><table class="table"><tr><th>When</th><th>Status</th><th>Note</th></tr>
        ${events.map((ev) => `<tr><td>${Utils.formatDateTime(ev.created_at)}</td><td>${Utils.escHtml(ev.status || '—')}</td><td>${Utils.escHtml(ev.note || ev.message || '—')}</td></tr>`).join('')}
      </table></div>` : ''}`,
      `<button type="button" class="btn btn-ghost" id="oo-detail-close">Close</button>
       ${['owner', 'manager'].includes(this.app?.user?.role) ? `<button type="button" class="btn btn-primary" id="oo-detail-edit">Edit</button>` : ''}`);
    document.getElementById('oo-detail-close')?.addEventListener('click', Utils.hideModal);
    document.getElementById('oo-detail-edit')?.addEventListener('click', () => {
      Utils.hideModal();
      this.showOnlineOrderEdit(orderId, onRefresh);
    });
  },

  async showOnlineOrderEdit(orderId, onRefresh) {
    const currency = this.settings?.currency || 'R';
    const r = await API.webAdminOrderDetail?.(orderId, this.app?.user);
    const o = r?.data ?? r;
    if (!o || !o.id) return Utils.toast(r?.error || 'Order not found', 'error');
    const statuses = ['pending', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'];
    Utils.showModal(`Edit order — ${Utils.escHtml(o.order_number || '')}`, `
      <div class="form-grid">
        <div class="field"><label>Customer name</label><input id="ooe-name" value="${Utils.escHtml(o.customer_name || '')}"></div>
        <div class="field"><label>Phone</label><input id="ooe-phone" value="${Utils.escHtml(o.customer_phone || '')}"></div>
        <div class="field"><label>Email</label><input id="ooe-email" value="${Utils.escHtml(o.customer_email || '')}"></div>
        <div class="field full"><label>Delivery address</label><input id="ooe-address" value="${Utils.escHtml(o.delivery_address || '')}"></div>
        <div class="field full"><label>Notes</label><textarea id="ooe-notes" rows="2">${Utils.escHtml(o.notes || '')}</textarea></div>
        <div class="field"><label>Status</label><select id="ooe-status">${statuses.map((s) => `<option value="${s}" ${String(o.status).toLowerCase() === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Payment method</label><input id="ooe-payment" value="${Utils.escHtml(o.payment_method || '')}"></div>
        <div class="field"><label>Fulfilment</label><select id="ooe-fulfillment"><option value="pickup" ${(o.fulfillment_type || o.fulfillment) === 'pickup' ? 'selected' : ''}>Pickup</option><option value="delivery" ${(o.fulfillment_type || o.fulfillment) === 'delivery' ? 'selected' : ''}>Delivery</option></select></div>
        <div class="field"><label>Total (${currency})</label><input type="number" step="0.01" id="ooe-total" value="${Number(o.total) || 0}"></div>
        <div class="field"><label>Subtotal</label><input type="number" step="0.01" id="ooe-subtotal" value="${Number(o.subtotal) || 0}"></div>
        <div class="field"><label>Discount</label><input type="number" step="0.01" id="ooe-discount" value="${Number(o.discount) || 0}"></div>
        <div class="field full" id="ooe-reject-wrap" style="display:none"><label>Reject / cancel reason</label><textarea id="ooe-reject-reason" rows="2">${Utils.escHtml(o.reject_reason || '')}</textarea></div>
      </div>
      ${o.sale_id ? '<p class="muted">This order was accepted on POS — status and totals may be limited.</p>' : ''}`,
      '<button type="button" class="btn btn-primary" id="ooe-save">Save changes</button>');
    const statusEl = document.getElementById('ooe-status');
    const rejectWrap = document.getElementById('ooe-reject-wrap');
    const syncReject = () => {
      if (rejectWrap) rejectWrap.style.display = ['rejected', 'cancelled'].includes(statusEl?.value) ? '' : 'none';
    };
    statusEl?.addEventListener('change', syncReject);
    syncReject();
    document.getElementById('ooe-save')?.addEventListener('click', async () => {
      const patch = {
        customer_name: document.getElementById('ooe-name')?.value.trim(),
        customer_phone: document.getElementById('ooe-phone')?.value.trim(),
        customer_email: document.getElementById('ooe-email')?.value.trim(),
        delivery_address: document.getElementById('ooe-address')?.value.trim(),
        notes: document.getElementById('ooe-notes')?.value.trim(),
        status: statusEl?.value,
        payment_method: document.getElementById('ooe-payment')?.value.trim(),
        fulfillment_type: document.getElementById('ooe-fulfillment')?.value,
        total: parseFloat(document.getElementById('ooe-total')?.value) || 0,
        subtotal: parseFloat(document.getElementById('ooe-subtotal')?.value) || 0,
        discount: parseFloat(document.getElementById('ooe-discount')?.value) || 0,
        reject_reason: document.getElementById('ooe-reject-reason')?.value.trim() || null
      };
      const ur = await API.webAdminUpdateOrder?.(orderId, patch, this.app?.user);
      if (ur?.success === false || ur?.error) return Utils.toast(ur?.error || 'Update failed', 'error');
      Utils.hideModal();
      Utils.toast('Order updated — customer history will reflect changes', 'success');
      if (typeof onRefresh === 'function') onRefresh();
    });
  },

  async renderLoyaltyHub(el) {
    const tab = this._loyaltyTab || 'points';
    const isOwner = this.app.user?.role === 'owner';
    const tabs = [
      { id: 'points', label: 'Loyalty Points' },
      ...(isOwner ? [{ id: 'restore', label: 'Restore Points' }] : []),
      { id: 'reminders', label: 'Expiry Reminders' },
      { id: 'giftcards', label: 'Gift Cards' },
      { id: 'first-gift', label: '🎁 First Online Customer Gift' },
      { id: 'rewards', label: 'Auto Gift Rewards' },
      { id: 'online', label: 'Online Store' }
    ];
    if (!this._loyaltyGiftPrefetch) {
      this._loyaltyGiftPrefetch = Promise.all([
        API.getGiftCards({ limit: 15 }).catch(() => ({ data: [] })),
        API.getGiftCardSettings(this.app.user).catch(() => ({ data: { auto_approve: true } }))
      ]);
    }
    if (!this._loyaltyOnlinePrefetch) {
      this._loyaltyOnlinePrefetch = API.webGetSettings?.().catch(() => ({ data: {} }));
    }
    el.innerHTML = `<div class="admin-section">
      <h3>Loyalty & Gift Cards</h3>
      <p class="muted">Manage loyalty points, gift cards, automatic customer rewards, and what customers can use when ordering online.</p>
      <div class="admin-tabs" id="loyalty-tabs">
        ${tabs.map((t) => `<button class="admin-tab ${tab === t.id ? 'active' : ''}" data-loy-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="loyalty-tab-body"><p class="muted">Loading…</p></div>
    </div>`;
    el.querySelector('#loyalty-tabs').onclick = (e) => {
      const b = e.target.closest('[data-loy-tab]');
      if (!b) return;
      this._loyaltyTab = b.dataset.loyTab;
      el.querySelectorAll('#loyalty-tabs .admin-tab').forEach((x) => x.classList.toggle('active', x.dataset.loyTab === this._loyaltyTab));
      this.renderLoyaltyHubTab(el.querySelector('#loyalty-tab-body'), this._loyaltyTab);
    };
    await this.renderLoyaltyHubTab(el.querySelector('#loyalty-tab-body'), tab);
  },

  async renderLoyaltyHubTab(body, tab) {
    if (tab === 'points') return this.renderLoyaltyPoints(body);
    if (tab === 'restore') return this.renderLoyaltyRestore(body);
    if (tab === 'reminders') return this.renderLoyaltyReminders(body);
    if (tab === 'giftcards') return this.renderLoyaltyGiftCards(body);
    if (tab === 'first-gift') return this.renderFirstOnlineGift(body);
    if (tab === 'rewards') return this.renderCustomerRewards(body);
    if (tab === 'online') return this.renderLoyaltyOnline(body);
  },

  renderLoyaltyPoints(el) {
    const ls = this.settings.loyalty_settings || {};
    const spend = ls.spend_amount ?? 10;
    const earned = ls.points_earned ?? 1;
    const minSale = ls.min_sale_total ?? 0;
    const pointValue = ls.point_value ?? 1;
    const expiryUnit = ls.expiry_period_unit === 'months' ? 'months' : 'days';
    const expiryValue = ls.expiry_period_value ?? ls.points_expiry_days ?? 30;
    const reminderDays = ls.reminder_interval_days ?? 3;
    const giftTpl = ls.gift_message_template || '';
    const reminderTpl = ls.reminder_message_template || '';
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field full"><label><input type="checkbox" id="loy-enabled" ${ls.enabled !== false ? 'checked' : ''}> Enable loyalty points</label></div>
        <div class="field"><label>Earn: spend amount (${currency})</label>
          <input type="number" id="loy-spend" step="0.01" min="0.01" value="${spend}"></div>
        <div class="field"><label>Points earned per spend block</label>
          <input type="number" id="loy-earned" step="1" min="1" value="${earned}"></div>
        <div class="field"><label>Point value when redeeming (${currency})</label>
          <input type="number" id="loy-value" step="0.01" min="0.01" value="${pointValue}"></div>
        <div class="field"><label>Minimum sale total (${currency})</label>
          <input type="number" id="loy-min" step="0.01" min="0" value="${minSale}"></div>
        <div class="field full" style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
          <label><input type="checkbox" id="loy-expiry-enabled" ${ls.expiry_enabled !== false ? 'checked' : ''}> Points expire after a set period</label>
          <p class="muted" style="font-size:12px;margin:4px 0 0">The system automatically expires points when the expiry date is reached. You can restore expired points from the Restore Points tab (admin only).</p>
        </div>
        <div class="field"><label>Expiry period</label>
          <input type="number" id="loy-expiry-value" min="1" max="365" value="${expiryValue}" placeholder="e.g. 30, 3, 6"></div>
        <div class="field"><label>Period unit</label>
          <select id="loy-expiry-unit">
            <option value="days" ${expiryUnit === 'days' ? 'selected' : ''}>Days</option>
            <option value="months" ${expiryUnit === 'months' ? 'selected' : ''}>Months</option>
          </select></div>
        <div class="field"><label>Reminder every (days)</label>
          <input type="number" id="loy-reminder-days" min="1" max="30" value="${reminderDays}" title="How often to remind customers before points expire"></div>
        <div class="field full">
          <div class="stat-card" style="margin-top:8px"><div class="label">Expiry example</div>
            <div class="value" style="font-size:16px" id="loy-expiry-preview">—</div></div>
        </div>
        <div class="field full">
          <div class="stat-card" style="margin-top:8px"><div class="label">Earn example</div>
            <div class="value" style="font-size:16px" id="loy-preview">—</div></div>
        </div>
        <div class="field full"><label>Gift / points-added message template</label>
          <textarea id="loy-gift-tpl" rows="6" placeholder="Leave blank for professional default">${Utils.escHtml(giftTpl)}</textarea>
          <p class="muted" style="font-size:12px;margin:4px 0 0">Variables: {{CustomerName}}, {{ShopName}}, {{PointsAdded}}, {{PointsAddedValue}}, {{PointsBalance}}, {{PointsBalanceValue}}, {{ExpiryDate}}, {{DaysRemaining}}, {{OrderOnlineLink}}</p></div>
        <div class="field full"><label>Expiry reminder message template</label>
          <textarea id="loy-reminder-tpl" rows="6" placeholder="Leave blank for professional default">${Utils.escHtml(reminderTpl)}</textarea>
          <p class="muted" style="font-size:12px;margin:4px 0 0">Variables: {{CustomerName}}, {{ShopName}}, {{PointsBalance}}, {{PointsBalanceValue}}, {{PointsExpiring}}, {{ExpiryDate}}, {{DaysRemaining}}, {{OrderOnlineLink}}</p></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="save-loyalty">Save Loyalty Settings</button>
        <button class="btn btn-ghost" id="sync-loyalty-points">Assign missing points from orders</button>
      </div>
      <p class="muted" id="sync-loyalty-result" style="font-size:13px;margin-top:8px"></p>
      </div></div>`;

    const updatePreview = () => {
      const s = parseFloat(document.getElementById('loy-spend').value) || 10;
      const p = parseInt(document.getElementById('loy-earned').value) || 1;
      const pv = parseFloat(document.getElementById('loy-value').value) || 1;
      const exampleTotal = 100;
      const pts = Math.floor((exampleTotal / s) * p);
      document.getElementById('loy-preview').textContent =
        `${currency}${exampleTotal} sale → earn ${pts} pts · 100 pts redeem = ${Utils.formatMoney(100 * pv, currency)}`;
      const ev = parseInt(document.getElementById('loy-expiry-value').value, 10) || 30;
      const eu = document.getElementById('loy-expiry-unit').value;
      const unitLabel = ev === 1 ? eu.slice(0, -1) : eu;
      document.getElementById('loy-expiry-preview').textContent =
        document.getElementById('loy-expiry-enabled').checked
          ? `Points earned today expire after ${ev} ${unitLabel}`
          : 'Expiry is off — points do not expire';
    };
    ['loy-spend', 'loy-earned', 'loy-value', 'loy-expiry-value', 'loy-expiry-unit', 'loy-expiry-enabled'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updatePreview);
      document.getElementById(id)?.addEventListener('change', updatePreview);
    });
    updatePreview();

    document.getElementById('sync-loyalty-points')?.addEventListener('click', async () => {
      const btn = document.getElementById('sync-loyalty-points');
      const out = document.getElementById('sync-loyalty-result');
      if (btn) btn.disabled = true;
      if (out) out.textContent = 'Checking completed POS and online orders…';
      try {
        const r = await API.syncMissingLoyaltyPoints(this.app.user);
        if (r?.success === false) throw new Error(r.error || 'Sync failed');
        const d = r?.data ?? r ?? {};
        if (out) {
          out.textContent = `Done — ${d.synced || 0} sales awarded points, ${d.linked || 0} customers linked, ${d.restored || 0} premature expiries fixed, ${d.reconciled || 0} balances corrected.`;
        }
        Utils.toast('Loyalty points updated from existing orders', 'success');
      } catch (err) {
        if (out) out.textContent = err.message || 'Could not sync loyalty points';
        Utils.toast(err.message || 'Could not sync loyalty points', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById('save-loyalty').addEventListener('click', async () => {
      const giftTpl = document.getElementById('loy-gift-tpl')?.value.trim() || '';
      const reminderTpl = document.getElementById('loy-reminder-tpl')?.value.trim() || '';
      const expiryValue = parseInt(document.getElementById('loy-expiry-value').value, 10) || 30;
      const expiryUnit = document.getElementById('loy-expiry-unit').value === 'months' ? 'months' : 'days';
      const data = {
        enabled: document.getElementById('loy-enabled').checked,
        spend_amount: parseFloat(document.getElementById('loy-spend').value) || 10,
        points_earned: parseInt(document.getElementById('loy-earned').value) || 1,
        point_value: parseFloat(document.getElementById('loy-value').value) || 1,
        min_sale_total: parseFloat(document.getElementById('loy-min').value) || 0,
        expiry_enabled: document.getElementById('loy-expiry-enabled').checked,
        expiry_period_value: expiryValue,
        expiry_period_unit: expiryUnit,
        points_expiry_days: expiryUnit === 'months' ? expiryValue * 30 : expiryValue,
        reminder_interval_days: parseInt(document.getElementById('loy-reminder-days').value, 10) || 3,
        ...(giftTpl ? { gift_message_template: giftTpl } : {}),
        ...(reminderTpl ? { reminder_message_template: reminderTpl } : {})
      };
      const r = await this.awaitSave(API.saveJsonSetting('loyalty_settings', data, this.app.user), 'Loyalty settings saved', 'Could not save loyalty settings');
      if (!r) return;
      this.settings.loyalty_settings = data;
      if (this.app) this.app.settings = { ...this.app.settings, loyalty_settings: data };
    });
  },

  async renderLoyaltyRestore(el) {
    if (this.app.user?.role !== 'owner') {
      el.innerHTML = '<p class="muted">Only the shop owner (admin) can restore expired loyalty points.</p>';
      return;
    }
    el.innerHTML = '<p class="muted">Loading expired points…</p>';
    try {
      const res = await API.listRestorableExpiredPoints({ limit: 200 }, this.app.user);
      const rows = res?.data ?? (Array.isArray(res) ? res : []);
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Restore expired points</h4>
        <p class="muted">When points expire automatically, they appear here. Restoring credits the customer again with a fresh expiry based on your current loyalty settings. Only the admin (owner) can do this.</p>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr>
          <th>Customer</th><th>Phone</th><th>Expired</th><th>When</th><th>Current balance</th><th></th>
        </tr></thead><tbody>
          ${rows.map((r) => `<tr>
            <td><strong>${Utils.escHtml(r.customer_name || '—')}</strong></td>
            <td>${Utils.escHtml(r.phone || '—')}</td>
            <td>${r.points_expired} pts</td>
            <td>${Utils.formatDateTime(r.created_at).slice(0, 16)}</td>
            <td>${Math.floor(Number(r.current_balance) || 0)} pts</td>
            <td><button class="btn btn-sm btn-primary loy-restore-exp" data-id="${r.id}" data-pts="${r.points_expired}" data-name="${Utils.escHtml(r.customer_name || '')}">Restore</button></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No expired points waiting to be restored.</p>'}
        <button class="btn btn-ghost" id="loy-restore-refresh" style="margin-top:12px">Refresh list</button>
      </div></div>`;
      el.querySelector('#loy-restore-refresh')?.addEventListener('click', () => this.renderLoyaltyRestore(el));
      el.querySelectorAll('.loy-restore-exp').forEach((b) => b.addEventListener('click', async () => {
        const pts = parseInt(b.dataset.pts, 10) || 0;
        const name = b.dataset.name || 'customer';
        if (!confirm(`Restore ${pts} expired points for ${name}? They will get a new expiry date from your current settings.`)) return;
        b.disabled = true;
        try {
          const r = await API.restoreExpiredLoyaltyPoints(parseInt(b.dataset.id, 10), this.app.user);
          if (r?.success === false) throw new Error(r.error || 'Restore failed');
          const d = r?.data ?? r ?? {};
          Utils.toast(`Restored ${d.points_restored || pts} points — new balance: ${d.balance ?? '—'}`, 'success');
          window.DataCache?.invalidate?.('customers');
          this.renderLoyaltyRestore(el);
        } catch (err) {
          Utils.toast(err.message || 'Could not restore points', 'error');
          b.disabled = false;
        }
      }));
    } catch (err) {
      el.innerHTML = `<p class="muted">${Utils.escHtml(err.message || 'Could not load expired points')}</p>`;
    }
  },

  async renderLoyaltyReminders(el) {
    el.innerHTML = '<p class="muted">Loading reminders…</p>';
    try {
      const res = await API.getLoyaltyReminders();
      const rows = res?.data ?? (Array.isArray(res) ? res : []);
      el.innerHTML = `<div class="card"><div class="card-body">
        <h4 style="margin-top:0">Customers to remind today</h4>
        <p class="muted">Based on your reminder interval in Loyalty Points settings. Click WhatsApp to open a pre-filled professional message.</p>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Points expiring</th><th>Days left</th><th>Expires</th><th></th></tr></thead><tbody>
          ${rows.map((r) => `<tr>
            <td><strong>${Utils.escHtml(r.name)}</strong></td>
            <td>${Utils.escHtml(r.phone || '—')}</td>
            <td>${r.points_remaining}</td>
            <td>${r.days_remaining}</td>
            <td>${Utils.formatDateTime(r.expires_at).slice(0, 12)}</td>
            <td><button class="btn btn-sm btn-success loy-wa-remind" data-cid="${r.customer_id}" data-lid="${r.lot_id}">WhatsApp</button></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No customers need reminders right now.</p>'}
      </div></div>`;
      el.querySelectorAll('.loy-wa-remind').forEach((b) => b.addEventListener('click', async () => {
        try {
          const payload = await API.getLoyaltyReminderWhatsApp(parseInt(b.dataset.cid, 10), parseInt(b.dataset.lid, 10));
          const p = payload?.data ?? payload;
          if (!p?.phone) return Utils.toast('Customer has no phone number', 'error');
          const wa = await API.sendWhatsAppMessage({
            phone: p.phone,
            body: p.message,
            message_type: 'loyalty_reminder',
            customer_id: parseInt(b.dataset.cid, 10),
            recipient_type: 'customer'
          }, this.app.user);
          await Utils.deliverWhatsApp(wa, p.phone, p.message);
          await API.markLoyaltyReminderSent(parseInt(b.dataset.lid, 10), this.app.user);
          Utils.toast('Reminder sent', 'success');
          this.renderLoyaltyReminders(el);
        } catch (err) {
          Utils.toast(err.message || 'Could not send reminder', 'error');
        }
      }));
    } catch (err) {
      el.innerHTML = `<p class="muted">${Utils.escHtml(err.message || 'Could not load reminders')}</p>`;
    }
  },

  async renderLoyaltyGiftCards(el) {
    const currency = this.settings.currency || 'R';
    const pref = this._loyaltyGiftPrefetch || Promise.all([
      API.getGiftCards({ limit: 15 }).catch(() => ({ data: [] })),
      API.getGiftCardSettings(this.app.user).catch(() => ({ data: { auto_approve: true } }))
    ]);
    this._loyaltyGiftPrefetch = null;
    const [cardsRes, settingsRes] = await pref;
    const cards = cardsRes.data || [];
    const gcSettings = settingsRes.data || { auto_approve: true };
    const active = cards.filter((c) => (c.display_status || c.status) === 'active').length;
    el.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="card-body">
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
        <div>
          <strong>${cards.length}</strong> recent cards · <strong>${active}</strong> active
          <p class="muted" style="margin:4px 0 0">Sell, redeem, and manage gift cards from the main Gift Cards page or POS checkout.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="loy-open-giftcards">Open Gift Cards</button>
          <button type="button" class="btn btn-ghost" id="loy-new-giftcard">+ Sell Gift Card</button>
        </div>
      </div>
      ${['owner', 'manager'].includes(this.app.user?.role) ? `
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px">
        <input type="checkbox" id="loy-gc-auto-approve" ${gcSettings.auto_approve !== false ? 'checked' : ''}>
        Auto-approve new gift cards
      </label>` : ''}
    </div></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Code</th><th>Customer</th><th>Balance</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>${cards.length ? cards.map((c) => `<tr>
        <td><code>${Utils.escHtml(c.code)}</code></td>
        <td>${Utils.escHtml(c.customer_name || '—')}</td>
        <td>${Utils.formatMoney(c.balance, currency)}</td>
        <td><span class="tag">${Utils.escHtml(c.display_status || c.status || '—')}</span></td>
        <td>${Utils.formatDateTime(c.created_at)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="muted">No gift cards yet — use Open Gift Cards to create one</td></tr>'}
      </tbody></table></div>`;
    el.querySelector('#loy-open-giftcards')?.addEventListener('click', () => {
      if (window.App?.navigate) App.navigate('giftcards');
      else Utils.toast('Open Gift Cards from the main sidebar', 'info');
    });
    el.querySelector('#loy-new-giftcard')?.addEventListener('click', () => {
      if (window.App?.navigate) App.navigate('giftcards');
      else Utils.toast('Open Gift Cards from the main sidebar', 'info');
    });
    el.querySelector('#loy-gc-auto-approve')?.addEventListener('change', async (e) => {
      const r = await API.saveGiftCardSettings({ auto_approve: e.target.checked }, this.app.user);
      if (r?.success === false) return Utils.toast(r.error || 'Save failed', 'error');
      Utils.toast('Gift card settings saved', 'success');
    });
  },

  async renderLoyaltyOnline(el) {
    el.innerHTML = `<div class="card"><div class="card-body">
      <h4 style="margin-top:0">Online checkout options</h4>
      <p class="muted">Loyalty points, gift cards, coupons, and online order toggles are managed in one place to avoid conflicting settings.</p>
      <button type="button" class="btn btn-primary" id="loy-on-orders">Open Online Orders settings →</button>
    </div></div>`;
    el.querySelector('#loy-on-orders')?.addEventListener('click', () => {
      this.section = 'online-orders';
      document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === 'online-orders'));
      this.renderSection(document.getElementById('admin-content'));
    });
  },

  async renderFirstOnlineGift(el) {
    const currency = this.settings.currency || 'R';
    const date = this._fogDate || new Date().toLocaleDateString('en-CA');
    const res = await API.getFirstOnlineGiftDashboard({ date }, this.app.user);
    if (!res.success) {
      el.innerHTML = `<p class="muted">${Utils.escHtml(res.error || 'Could not load campaign')}</p>`;
      return;
    }
    const dash = res.data || {};
    const c = dash.campaign || {};
    const p = dash.progress || {};
    const winners = dash.winners || [];
    const money = (n) => Utils.formatMoney(n || 0, currency);
    const on = !!c.enabled;
    const live = !!p.live;
    el.innerHTML = `<div>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center">
          <div>
            <h3 style="margin:0 0 4px">First Online Customer Gift Campaign</h3>
            <p class="muted" style="margin:0">Automatically awards a real gift card to the first qualifying online customers each day.</p>
          </div>
          <button type="button" class="btn ${on ? 'btn-primary' : 'btn-danger'}" id="fog-toggle" style="min-width:120px;font-weight:800">
            ${on ? '🟢 ON' : '🔴 OFF'}
          </button>
        </div>
        <p class="muted" style="margin:10px 0 0">${on
          ? (live ? 'Campaign is live — qualifying online orders receive gift cards until the daily limit is reached.'
            : 'Campaign is ON, but today’s date is outside the start/end period, so no gifts will be issued.')
          : 'Campaign is OFF. No gift cards are issued automatically. Existing gift cards stay valid.'}</p>
      </div></div>

      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin-top:0">Today's Progress</h4>
        <div class="form-grid">
          <div class="field"><strong>🎁 Daily limit:</strong> ${p.daily_limit || 0}</div>
          <div class="field"><strong>👥 Winners:</strong> ${p.winners_awarded || 0} / ${p.daily_limit || 0}</div>
          <div class="field"><strong>💰 Gift value:</strong> ${money(p.gift_amount)} each</div>
          <div class="field"><strong>💰 Today's issued value:</strong> ${money(p.issued_value)}</div>
          <div class="field"><strong>🎯 Remaining winners:</strong> ${p.remaining || 0}</div>
          <div class="field"><strong>Next winner:</strong> #${Math.min((p.next_position || 1), (p.daily_limit || 1))} of ${p.daily_limit || 0}</div>
        </div>
        <p style="margin:12px 0 0">Total campaign liability: <strong>${p.daily_limit || 0} × ${money(c.gift_amount)} = ${money(p.liability)}</strong></p>
        <p class="muted" style="margin:6px 0 0">Shop day uses Africa/Johannesburg. The winner counter resets automatically at midnight — you do not reset it yourself.</p>
      </div></div>

      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin-top:0">Campaign settings</h4>
        <div class="form-grid">
          <div class="field"><label>Gift amount (${currency})</label>
            <input type="number" id="fog-amount" min="0.01" step="0.01" value="${c.gift_amount ?? 10}">
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${[5, 10, 20, 50, 100].map((n) =>
              `<button type="button" class="btn btn-sm btn-ghost fog-amt" data-amt="${n}">${currency}${n}</button>`).join('')}</div></div>
          <div class="field"><label>Daily winner limit</label>
            <input type="number" id="fog-limit" min="1" step="1" value="${c.daily_limit ?? 10}">
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${[1, 5, 10, 20, 50].map((n) =>
              `<button type="button" class="btn btn-sm btn-ghost fog-lim" data-lim="${n}">${n}</button>`).join('')}</div></div>
          <div class="field"><label>Minimum qualifying order (${currency}) — optional</label>
            <input type="number" id="fog-min" min="0" step="0.01" value="${c.min_order_amount ?? 0}"></div>
          <div class="field"><label>Gift expiry (days) — optional</label>
            <input type="number" id="fog-expiry" min="1" step="1" value="${c.expiry_days ?? ''}" placeholder="Leave blank for no expiry"></div>
          <div class="field"><label>Start date</label>
            <input type="date" id="fog-start" value="${c.start_date ? String(c.start_date).slice(0, 10) : ''}">
            <p class="muted" style="font-size:12px;margin:4px 0 0">Leave blank to start immediately while ON.</p></div>
          <div class="field"><label>End date</label>
            <input type="date" id="fog-end" value="${c.end_date ? String(c.end_date).slice(0, 10) : ''}">
            <p class="muted" style="font-size:12px;margin:4px 0 0">Leave blank to keep running until you turn it OFF.</p></div>
          <div class="field"><label>Online orders only</label><input type="text" value="YES" disabled></div>
          <div class="field"><label>One gift per account per campaign</label><input type="text" value="YES" disabled></div>
        </div>
        <button type="button" class="btn btn-primary" id="fog-save" style="margin-top:12px">Save campaign settings</button>
      </div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:end">
          <div>
            <h4 style="margin:0 0 4px">Winners</h4>
            <p class="muted" style="margin:0">Every automatic award is stored with the customer account, order, gift card, and winner number.</p>
          </div>
          <div class="field" style="margin:0"><label>Date</label>
            <input type="date" id="fog-date" value="${date}"></div>
        </div>
        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>Position</th><th>Customer</th><th>Order</th><th>Gift</th><th>Gift card</th><th>Status</th></tr></thead>
          <tbody>${winners.length ? winners.map((w) => `<tr>
            <td>#${w.position}</td>
            <td>${Utils.escHtml(w.customer_name || `Account ${w.web_customer_id}`)}</td>
            <td>${Utils.escHtml(w.order_number || String(w.order_id || '—'))}</td>
            <td>${money(w.amount)}</td>
            <td><code>${Utils.escHtml(w.gift_card_code || '—')}</code></td>
            <td>${w.status === 'issued' ? 'Issued' : Utils.escHtml(String(w.status || '—').replace(/_/g, ' '))}${w.gift_status && w.status === 'issued' ? ` · ${String(w.gift_status).toUpperCase()}` : ''}</td>
          </tr>`).join('') : `<tr><td colspan="6" class="muted">No winners on ${Utils.escHtml(date)}.</td></tr>`}</tbody>
        </table></div>
        ${this.app.user?.role === 'owner' ? `<button type="button" class="btn btn-ghost btn-sm" id="fog-selftest" style="margin-top:12px">Run campaign self-test</button>` : ''}
      </div></div>
    </div>`;

    const reload = () => this.renderLoyaltyHubTab(el, 'first-gift');
    const readForm = (enabled) => ({
      enabled: enabled != null ? enabled : on,
      gift_amount: parseFloat(document.getElementById('fog-amount').value),
      daily_limit: parseInt(document.getElementById('fog-limit').value, 10),
      min_order_amount: parseFloat(document.getElementById('fog-min').value) || 0,
      expiry_days: document.getElementById('fog-expiry').value ? parseInt(document.getElementById('fog-expiry').value, 10) : null,
      start_date: document.getElementById('fog-start').value || null,
      end_date: document.getElementById('fog-end').value || null
    });
    const save = async (data) => {
      const r = await API.saveFirstOnlineGift(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Campaign saved', 'success');
      reload();
    };
    document.getElementById('fog-toggle')?.addEventListener('click', () => save({ ...readForm(!on), enabled: !on }));
    document.getElementById('fog-save')?.addEventListener('click', () => save(readForm()));
    el.querySelectorAll('.fog-amt').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('fog-amount').value = b.dataset.amt;
    }));
    el.querySelectorAll('.fog-lim').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('fog-limit').value = b.dataset.lim;
    }));
    document.getElementById('fog-date')?.addEventListener('change', (e) => {
      this._fogDate = e.target.value;
      reload();
    });
    document.getElementById('fog-selftest')?.addEventListener('click', async () => {
      const r = await API.selfTestFirstOnlineGift(this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      const findings = r.data?.findings || [];
      const failed = findings.filter((f) => !f.ok);
      Utils.toast(failed.length ? `Self-test failed: ${failed.map((f) => f.name).join(', ')}` : 'Self-test passed', failed.length ? 'error' : 'success');
    });
  },

  async renderCustomerRewards(el) {
    const res = await API.getCustomerRewardRules();
    const rules = res.data || [];
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div>
      <p class="muted">When a customer's total spend within a period reaches the threshold, a gift card is created automatically after checkout. Owner, manager, and assistant manager receive WhatsApp links to notify the customer.</p>
      <button class="btn btn-primary" id="reward-add" style="margin-bottom:12px">+ Add Rule</button>
      <div class="table-wrap"><table>
        <thead><tr><th>Enabled</th><th>Spend Threshold</th><th>Period (days)</th><th>Gift Amount</th><th>Card Expiry (days)</th><th>Notes</th><th></th></tr></thead>
        <tbody>${rules.map(r => `<tr>
          <td>${r.enabled ? '✓' : '—'}</td>
          <td>${Utils.formatMoney(r.spend_threshold, currency)}</td>
          <td>${r.period_days}</td>
          <td>${Utils.formatMoney(r.gift_amount, currency)}</td>
          <td>${r.gift_expiry_days || 365}</td>
          <td>${Utils.escHtml(r.notes || '—')}</td>
          <td><button class="btn btn-sm btn-ghost reward-edit" data-id="${r.id}">Edit</button>
            <button class="btn btn-sm btn-danger reward-del" data-id="${r.id}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No reward rules yet</td></tr>'}
        </tbody></table></div></div>`;

    const reload = () => this.renderLoyaltyHubTab(el, 'rewards');
    document.getElementById('reward-add')?.addEventListener('click', () => this.showRewardRuleForm(null, reload));
    el.querySelectorAll('.reward-edit').forEach(b => b.addEventListener('click', () => {
      const rule = rules.find(r => r.id == b.dataset.id);
      if (rule) this.showRewardRuleForm(rule, reload);
    }));
    el.querySelectorAll('.reward-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this reward rule?')) return;
      const r = await API.deleteCustomerRewardRule(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Rule deleted', 'success');
      reload();
    }));
  },

  showRewardRuleForm(rule, onSaved) {
    const currency = this.settings.currency || 'R';
    Utils.showModal(rule ? 'Edit Reward Rule' : 'New Reward Rule', `
      <div class="field"><label><input type="checkbox" id="rr-enabled" ${rule?.enabled !== 0 ? 'checked' : ''}> Rule enabled</label></div>
      <div class="field"><label>Spend threshold (${currency}) *</label>
        <input type="number" id="rr-threshold" step="0.01" min="1" value="${rule?.spend_threshold || 500}"></div>
      <div class="field"><label>Within (days) *</label>
        <input type="number" id="rr-days" min="1" value="${rule?.period_days || 30}"></div>
      <div class="field"><label>Gift card amount (${currency}) *</label>
        <input type="number" id="rr-gift" step="0.01" min="1" value="${rule?.gift_amount || 50}"></div>
      <div class="field"><label>Gift card valid for (days)</label>
        <input type="number" id="rr-expiry" min="1" value="${rule?.gift_expiry_days || 365}"></div>
      <div class="field"><label>Notes</label><textarea id="rr-notes" rows="2">${Utils.escHtml(rule?.notes || '')}</textarea></div>
      <p class="muted">Example: spend ${currency}500 within 30 days → auto ${currency}50 gift card.</p>`,
      '<button class="btn btn-primary" id="rr-save">Save Rule</button>');
    document.getElementById('rr-save')?.addEventListener('click', async () => {
      const data = {
        id: rule?.id,
        enabled: document.getElementById('rr-enabled').checked,
        spend_threshold: parseFloat(document.getElementById('rr-threshold').value),
        period_days: parseInt(document.getElementById('rr-days').value, 10),
        gift_amount: parseFloat(document.getElementById('rr-gift').value),
        gift_expiry_days: parseInt(document.getElementById('rr-expiry').value, 10),
        notes: document.getElementById('rr-notes').value.trim()
      };
      const r = await API.saveCustomerRewardRule(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Reward rule saved', 'success');
      onSaved?.();
    });
  },

  renderImportExport(el) {
    el.innerHTML = `<div class="admin-section"><h3>Import & Export</h3>
      <div class="card"><div class="card-body">
        <h4>Import Products (CSV format: name, price, cost, barcode, sku, stock, unit)</h4>
        <textarea id="import-csv" rows="6" placeholder="Chicken Meal,80,48,123456,SKU001,25,each" style="width:100%;margin:12px 0;font-family:monospace"></textarea>
        <button class="btn btn-primary" id="import-products">Import Products</button>
        <hr style="margin:20px 0;border:none;border-top:1px solid var(--border)">
        <h4>Export</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-ghost" id="export-products">Export Products (Excel)</button>
          <button class="btn btn-ghost" id="export-customers">Export Customers (Excel)</button>
          <button class="btn btn-ghost" id="export-db">Export Database</button>
        </div>
      </div></div></div>`;

    document.getElementById('import-products').addEventListener('click', async () => {
      const text = document.getElementById('import-csv').value.trim();
      if (!text) return Utils.toast('Paste CSV data first', 'error');
      const rows = text.split('\n').map(line => {
        const [name, selling_price, buying_price, barcode, sku, stock_quantity, unit] = line.split(',').map(s => s.trim());
        return { name, selling_price, buying_price, barcode, sku, stock_quantity, unit };
      }).filter(r => r.name);
      const r = await API.importProducts(rows, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      const result = r.data;
      const count = typeof result === 'number' ? result : (result?.count || 0);
      Utils.toast(`Imported ${count} product(s)`, count ? 'success' : 'error');
      if (result?.errors?.length) Utils.toast(`Skipped: ${result.errors.slice(0, 2).join('; ')}`, 'error');
    });

    document.getElementById('export-products').addEventListener('click', async () => {
      const res = await API.getProducts();
      const products = res.data || [];
      Export.toExcel('products.xlsx', [{ name: 'Products', data: products.map(p => ({
        Name: p.name, Category: p.category_name, Price: p.selling_price, Cost: p.buying_price,
        Stock: p.stock_quantity, Barcode: p.barcode, SKU: p.sku, Unit: p.unit
      })) }]);
    });

    document.getElementById('export-customers').addEventListener('click', async () => {
      const res = await API.getCustomers();
      Export.toExcel('customers.xlsx', [{ name: 'Customers', data: (res.data||[]).map(c => ({
        Name: c.name, Phone: c.phone, Email: c.email, Balance: c.balance
      })) }]);
    });

    document.getElementById('export-db').addEventListener('click', () => API.backupExport(this.app.user));
  },

  renderPaymentMethods(el) {
    const tab = this._paymentsTab || 'methods';
    const tabs = [
      { id: 'methods', label: 'POS Methods' },
      { id: 'gateways', label: 'Payment Gateways' },
      { id: 'transactions', label: 'Payment Transactions' }
    ];
    el.innerHTML = `<div class="admin-section">
      <h3>Payment Methods</h3>
      <p class="muted">POS tender types, online payment gateways (Yoco first), and payment transaction history.</p>
      <div class="admin-tabs" id="payments-tabs">
        ${tabs.map((t) => `<button class="admin-tab ${tab === t.id ? 'active' : ''}" data-pay-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="payments-tab-body"></div>
    </div>`;
    el.querySelector('#payments-tabs').onclick = (e) => {
      const b = e.target.closest('[data-pay-tab]');
      if (!b) return;
      this._paymentsTab = b.dataset.payTab;
      el.querySelectorAll('#payments-tabs .admin-tab').forEach((x) => x.classList.toggle('active', x.dataset.payTab === this._paymentsTab));
      this.renderPaymentMethodsTab(el.querySelector('#payments-tab-body'), this._paymentsTab);
    };
    this.renderPaymentMethodsTab(el.querySelector('#payments-tab-body'), tab);
  },

  renderPaymentMethodsTab(body, tab) {
    if (tab === 'gateways') return this.renderPaymentGateways(body);
    if (tab === 'transactions') return this.renderPaymentTransactions(body);
    return this.renderPosPaymentMethods(body);
  },

  renderPosPaymentMethods(el) {
    const pm = this.settings.payment_settings || {};
    const enabled = pm.enabled_methods || Utils.paymentTypes;
    const custom = pm.custom_methods || [];
    el.innerHTML = `<div class="card"><div class="card-body">
        <p class="muted" style="margin-top:0">Enable payment types available at POS checkout. Online “Pay Online” is configured under <strong>Payment Gateways</strong>.</p>
        <div class="form-grid">
          ${Utils.paymentTypes.map(t => `<div class="field"><label>
            <input type="checkbox" class="pm-enable" data-type="${t}" ${enabled.includes(t) ? 'checked' : ''}>
            ${Utils.paymentLabels[t]}</label></div>`).join('')}
          <div class="field full"><label><input type="checkbox" id="pm-mixed" ${pm.allow_mixed !== false ? 'checked' : ''}> Allow mixed payments (Card + Cash + EFT, etc.)</label></div>
          <div class="field full"><label><input type="checkbox" id="pm-giftcard" ${pm.giftcard_enabled !== false ? 'checked' : ''}> Enable Gift Card payments</label></div>
          <div class="field full"><label><input type="checkbox" id="pm-account" ${pm.account_enabled !== false ? 'checked' : ''}> Enable On Account (requires customer)</label></div>
          <div class="field full"><label><input type="checkbox" id="pm-eft" ${pm.eft_enabled !== false ? 'checked' : ''}> Enable EFT / Bank Transfer</label></div>
        </div>
        <h4 style="margin-top:20px">Custom Payment Methods</h4>
        <div id="custom-pm-list">${custom.map((m, i) => `
          <div class="form-grid custom-pm-row" data-i="${i}" style="margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px">
            <div class="field"><label>ID (no spaces)</label><input class="cpm-id" value="${m.id || ''}" placeholder="snapscan"></div>
            <div class="field"><label>Label</label><input class="cpm-label" value="${m.label || ''}" placeholder="SnapScan"></div>
            <div class="field" style="display:flex;align-items:flex-end"><label><input type="checkbox" class="cpm-enabled" ${m.enabled !== false ? 'checked' : ''}> Enabled</label></div>
            <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger cpm-remove">Remove</button></div>
          </div>`).join('') || '<p class="muted" id="custom-pm-empty">No custom methods yet</p>'}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-custom-pm" style="margin-top:8px">+ Add Custom Method</button>
        <button class="btn btn-primary" id="save-payments" style="margin-top:16px">Save Payment Settings</button>
      </div></div>`;

    document.getElementById('add-custom-pm').addEventListener('click', () => {
      const list = document.getElementById('custom-pm-list');
      document.getElementById('custom-pm-empty')?.remove();
      const row = document.createElement('div');
      row.className = 'form-grid custom-pm-row';
      row.style.cssText = 'margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px';
      row.innerHTML = `<div class="field"><label>ID (no spaces)</label><input class="cpm-id" placeholder="snapscan"></div>
        <div class="field"><label>Label</label><input class="cpm-label" placeholder="SnapScan"></div>
        <div class="field" style="display:flex;align-items:flex-end"><label><input type="checkbox" class="cpm-enabled" checked> Enabled</label></div>
        <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger cpm-remove">Remove</button></div>`;
      list.appendChild(row);
      row.querySelector('.cpm-remove').addEventListener('click', () => row.remove());
    });
    el.querySelectorAll('.cpm-remove').forEach(b => b.addEventListener('click', () => b.closest('.custom-pm-row')?.remove()));

    document.getElementById('save-payments').addEventListener('click', async () => {
      const enabled_methods = [...document.querySelectorAll('.pm-enable:checked')].map(cb => cb.dataset.type);
      if (!enabled_methods.length) return Utils.toast('Enable at least one payment method', 'error');
      const custom_methods = [...document.querySelectorAll('.custom-pm-row')].map(row => ({
        id: row.querySelector('.cpm-id')?.value.trim().toLowerCase().replace(/\s+/g, '_'),
        label: row.querySelector('.cpm-label')?.value.trim(),
        enabled: row.querySelector('.cpm-enabled')?.checked !== false
      })).filter(m => m.id && m.label);
      const data = {
        enabled_methods: [...enabled_methods, ...custom_methods.map(m => m.id)],
        custom_methods,
        allow_mixed: document.getElementById('pm-mixed').checked,
        giftcard_enabled: document.getElementById('pm-giftcard').checked,
        account_enabled: document.getElementById('pm-account').checked,
        eft_enabled: document.getElementById('pm-eft').checked
      };
      const r = await this.awaitSave(API.saveJsonSetting('payment_settings', data, this.app.user), 'Payment settings saved', 'Could not save payment settings');
      if (!r) return;
      this.settings.payment_settings = data;
      if (this.app) this.app.settings = { ...this.app.settings, payment_settings: data };
      Utils.toast('Payment settings saved — online checkout updated', 'success');
    });
  },

  async renderPaymentGateways(el) {
    el.innerHTML = `<div class="card"><div class="card-body"><p class="muted">Loading payment gateways…</p></div></div>`;
    let gateways = [];
    try {
      const res = await API.listPaymentGateways(this.app.user);
      gateways = res?.data || res || [];
      if (!Array.isArray(gateways)) gateways = [];
    } catch (err) {
      el.innerHTML = `<div class="card"><div class="card-body"><p class="muted" style="color:var(--danger)">${Utils.escHtml(err.message || 'Could not load gateways')}</p></div></div>`;
      return;
    }

    const g = gateways.find((x) => x.provider === 'yoco') || gateways[0] || {
      provider: 'yoco', name: 'Yoco', enabled: false, test_mode: true, currency: 'ZAR'
    };

    const testBanner = g.test_mode !== false
      ? `<div style="background:#fef3c7;color:#92400e;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-weight:600">TEST MODE — NO REAL MONEY</div>`
      : `<div style="background:#fee2e2;color:#991b1b;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-weight:600">LIVE MODE — REAL MONEY</div>`;

    el.innerHTML = `<div class="card"><div class="card-body">
      <h4 style="margin-top:0">Payment Gateways</h4>
      <p class="muted">Enable and configure online gateways without changing checkout code. Secrets stay on the server and are never sent to customers or cashiers.</p>
      ${testBanner}
      <div class="form-grid" id="gw-form" data-provider="${Utils.escHtml(g.provider)}">
        <div class="field"><label>Gateway name</label><input id="gw-name" value="${Utils.escHtml(g.name || 'Yoco')}"></div>
        <div class="field"><label>Provider</label><input value="${Utils.escHtml(g.provider || 'yoco')}" disabled></div>
        <div class="field full"><label><input type="checkbox" id="gw-enabled" ${g.enabled ? 'checked' : ''}> Enabled (show “Pay Online” at website checkout)</label></div>
        <div class="field full"><label><input type="checkbox" id="gw-test" ${g.test_mode !== false ? 'checked' : ''}> Test Mode</label></div>
        <div class="field"><label>Public / API key</label><input id="gw-public" value="${Utils.escHtml(g.public_key || '')}" placeholder="pk_test_… or pk_live_…" autocomplete="off"></div>
        <div class="field"><label>Currency</label><input id="gw-currency" value="${Utils.escHtml(g.currency || 'ZAR')}"></div>
        <div class="field full"><label>Secret key ${g.has_secret_key ? `<span class="muted">(saved: ${Utils.escHtml(g.secret_key_masked || '••••')})</span>` : ''}</label>
          <input id="gw-secret" type="password" value="" placeholder="${g.has_secret_key ? 'Leave blank to keep existing secret' : 'sk_test_… or sk_live_…'}" autocomplete="new-password"></div>
        <div class="field full"><label>Webhook secret ${g.has_webhook_secret ? `<span class="muted">(saved: ${Utils.escHtml(g.webhook_secret_masked || '••••')})</span>` : ''}</label>
          <input id="gw-webhook-secret" type="password" value="" placeholder="${g.has_webhook_secret ? 'Leave blank to keep existing secret' : 'whsec_…'}" autocomplete="new-password"></div>
        <div class="field full"><label>Webhook URL (register this in Yoco)</label>
          <input id="gw-webhook-url" value="${Utils.escHtml(g.webhook_url || '')}" readonly onclick="this.select()"></div>
      </div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" class="btn btn-primary" id="gw-save">Save configuration</button>
        <button type="button" class="btn btn-ghost" id="gw-test-btn">Test connection</button>
        <button type="button" class="btn btn-ghost" id="gw-register-wh">Register webhook with Yoco</button>
      </div>
      <div style="margin-top:16px;font-size:13px;color:var(--muted)">
        <div><strong>Status:</strong> ${Utils.escHtml(g.status_message || '—')}</div>
        <div><strong>Last successful connection:</strong> ${Utils.escHtml(g.last_successful_connection_at || '—')}</div>
        <div><strong>Last webhook received:</strong> ${Utils.escHtml(g.last_webhook_at || '—')}</div>
        ${g.last_error ? `<div style="color:var(--danger)"><strong>Error:</strong> ${Utils.escHtml(g.last_error)}</div>` : ''}
      </div>
      <p class="muted" style="margin-top:16px;font-size:12px">Configure <strong>TEST</strong> keys first in the Yoco App. After testing, uncheck Test Mode and confirm the live warning. Domain verification is required for live keys.</p>
    </div></div>`;

    const reload = () => this.renderPaymentGateways(el);

    el.querySelector('#gw-save')?.addEventListener('click', async () => {
      const testMode = el.querySelector('#gw-test')?.checked !== false;
      const enabled = el.querySelector('#gw-enabled')?.checked === true;
      let confirmLive = false;
      if (enabled && !testMode) {
        confirmLive = window.confirm(
          'WARNING: You are about to enable LIVE MODE.\n\nReal customer payments will be charged.\n\nOnly continue after successful TEST MODE payments and Yoco domain verification.\n\nEnable LIVE MODE?'
        );
        if (!confirmLive) {
          el.querySelector('#gw-test').checked = true;
          return Utils.toast('Kept TEST MODE — live not enabled', 'info');
        }
      }
      const payload = {
        name: el.querySelector('#gw-name')?.value.trim() || 'Yoco',
        enabled,
        test_mode: testMode,
        public_key: el.querySelector('#gw-public')?.value.trim() || '',
        currency: el.querySelector('#gw-currency')?.value.trim() || 'ZAR',
        confirm_live: confirmLive
      };
      const sk = el.querySelector('#gw-secret')?.value.trim();
      const wh = el.querySelector('#gw-webhook-secret')?.value.trim();
      if (sk) payload.secret_key = sk;
      if (wh) payload.webhook_secret = wh;
      try {
        await API.savePaymentGateway(g.provider || 'yoco', payload, this.app.user);
        Utils.toast('Gateway configuration saved', 'success');
        reload();
      } catch (err) {
        Utils.toast(err.message || 'Could not save gateway', 'error');
      }
    });

    el.querySelector('#gw-test-btn')?.addEventListener('click', async () => {
      try {
        const r = await API.testPaymentGateway(g.provider || 'yoco', this.app.user);
        const data = r?.data || r;
        if (data?.success) Utils.toast(data.message || 'Connection OK', 'success');
        else Utils.toast(data?.error || 'Connection failed', 'error');
        reload();
      } catch (err) {
        Utils.toast(err.message || 'Connection failed', 'error');
      }
    });

    el.querySelector('#gw-register-wh')?.addEventListener('click', async () => {
      try {
        const r = await API.registerPaymentGatewayWebhook(g.provider || 'yoco', this.app.user);
        const data = r?.data || r;
        Utils.toast(data?.note || data?.gateway?.status_message || 'Webhook registered', 'success');
        reload();
      } catch (err) {
        Utils.toast(err.message || 'Could not register webhook', 'error');
      }
    });
  },

  async renderPaymentTransactions(el) {
    el.innerHTML = `<div class="card"><div class="card-body">
      <div class="form-grid" id="ptx-filters" style="margin-bottom:12px">
        <div class="field"><label>Date from</label><input type="date" id="ptx-from"></div>
        <div class="field"><label>Date to</label><input type="date" id="ptx-to"></div>
        <div class="field"><label>Gateway</label>
          <select id="ptx-gateway"><option value="">All</option><option value="yoco">Yoco</option></select></div>
        <div class="field"><label>Status</label>
          <select id="ptx-status">
            <option value="">All</option>
            ${['PENDING','AUTHORIZED','PAID','FAILED','CANCELLED','EXPIRED','REFUNDED','PARTIALLY_REFUNDED']
              .map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select></div>
        <div class="field"><label>Order number</label><input id="ptx-order" placeholder="ONLINE-…"></div>
        <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-primary" id="ptx-refresh">Filter</button></div>
      </div>
      <div id="ptx-table"><p class="muted">Loading…</p></div>
    </div></div>`;

    const load = async () => {
      const filters = {
        date_from: el.querySelector('#ptx-from')?.value || undefined,
        date_to: el.querySelector('#ptx-to')?.value ? `${el.querySelector('#ptx-to').value}T23:59:59` : undefined,
        gateway: el.querySelector('#ptx-gateway')?.value || undefined,
        status: el.querySelector('#ptx-status')?.value || undefined,
        order_number: el.querySelector('#ptx-order')?.value.trim() || undefined,
        limit: 100
      };
      const box = el.querySelector('#ptx-table');
      box.innerHTML = `<p class="muted">Loading…</p>`;
      try {
        const res = await API.listPaymentTransactions(filters, this.app.user);
        const rows = res?.data || res || [];
        if (!rows.length) {
          box.innerHTML = `<p class="muted">No payment transactions yet.</p>`;
          return;
        }
        box.innerHTML = `<div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>Order</th><th>Customer</th><th>Gateway</th><th>Txn ID</th>
            <th>Amount</th><th>Currency</th><th>Status</th>
            <th>Created</th><th>Paid</th><th>Failure</th><th>Refund</th>
          </tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${Utils.escHtml(r.order_number || r.order_id || '—')}</td>
            <td>${Utils.escHtml(r.customer_name || '—')}</td>
            <td>${Utils.escHtml(r.gateway_provider || '—')}</td>
            <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(r.gateway_transaction_id || r.gateway_payment_id || r.gateway_checkout_id || '—')}</td>
            <td>${Utils.formatMoney?.(r.amount, this.settings.currency || 'R') ?? r.amount}</td>
            <td>${Utils.escHtml(r.currency || 'ZAR')}</td>
            <td><span class="tag">${Utils.escHtml(r.status || '—')}</span></td>
            <td>${Utils.escHtml((r.created_at || '').toString().slice(0, 19))}</td>
            <td>${Utils.escHtml((r.paid_at || '').toString().slice(0, 19) || '—')}</td>
            <td style="font-size:11px">${Utils.escHtml(r.failure_reason || '—')}</td>
            <td>${Utils.escHtml(r.refund_status || '—')}</td>
          </tr>`).join('')}</tbody></table></div>`;
      } catch (err) {
        box.innerHTML = `<p class="muted" style="color:var(--danger)">${Utils.escHtml(err.message || 'Failed to load')}</p>`;
      }
    };

    el.querySelector('#ptx-refresh')?.addEventListener('click', load);
    await load();
  },

  renderCustomize(el) {
    const cu = this.settings.customization || {};
    const s = this.settings;
    const homeOpts = [
      ['pos', 'POS'], ['dashboard', 'Dashboard'], ['admin', 'Admin'], ['reports', 'Reports'],
      ['operations', 'Cash-Up & Ops'], ['staff', 'Staff Portal']
    ];
    el.innerHTML = `<div class="admin-section"><h3>Software Customization</h3>
      <p class="muted">Full control of branding, look, login, and day-to-day defaults. Changes apply after Save.</p>
      <div class="card"><div class="card-body">
      <h4 style="margin-top:0">Brand &amp; identity</h4>
      <div class="form-grid">
        <div class="field"><label>Shop / Business Name</label><input id="cu-name" value="${s.shop_name||''}"></div>
        <div class="field"><label>App Display Name <span class="muted">(login &amp; title)</span></label>
          <input id="cu-app-name" value="${s.app_display_name || s.shop_name || ''}" placeholder="Shown on login screen"></div>
        <div class="field"><label>Business Type</label>
          <select id="cu-type">${Utils.businessTypes.map(t =>
            `<option value="${t}" ${s.business_type===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}</select></div>
        <div class="field"><label>Theme</label>
          <select id="cu-theme"><option value="light" ${s.theme==='light'?'selected':''}>Light</option>
          <option value="dark" ${s.theme==='dark'?'selected':''}>Dark</option></select></div>
        <div class="field"><label>Primary Button Color</label><input type="color" id="cu-color" value="${cu.button_color||'#2563eb'}"></div>
        <div class="field"><label>Accent Color</label><input type="color" id="cu-accent" value="${cu.accent_color||'#0ea5e9'}"></div>
        <div class="field"><label>Email</label><input id="cu-email" value="${s.email||''}"></div>
        <div class="field"><label>Website</label><input id="cu-website" value="${s.website||''}"></div>
        <div class="field"><label>Social Media</label><input id="cu-social" value="${s.social_media||''}"></div>
        <div class="field full"><label>Company Logo</label>
          <button class="btn btn-ghost" id="cu-logo-btn">Upload Logo</button>
          <div id="cu-logo-preview">${s.logo_path ? '<span class="muted">Loading logo…</span>' : ''}</div></div>
      </div>
      <h4 style="margin-top:24px">Login &amp; home</h4>
      <div class="form-grid">
        <div class="field full"><label>Login welcome message</label>
          <input id="cu-login-msg" value="${Utils.escHtml(cu.login_message || '')}" placeholder="e.g. Welcome to Happy’s Shop"></div>
        <div class="field"><label>Default page after login</label>
          <select id="cu-home">${homeOpts.map(([id, label]) =>
            `<option value="${id}" ${(cu.default_home_page || 'pos') === id ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="field"><label>UI size scale</label>
          <select id="cu-scale">
            ${[['0.9','Small'],['1','Normal'],['1.1','Large'],['1.2','Extra large']].map(([v,l]) =>
              `<option value="${v}" ${String(cu.ui_scale || '1') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <h4 style="margin-top:24px">Layout &amp; behaviour</h4>
      <div class="form-grid">
        <div class="field full"><label><input type="checkbox" id="cu-compact" ${cu.compact_nav ? 'checked' : ''}> Compact sidebar</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-hide-emoji" ${cu.hide_nav_emojis ? 'checked' : ''}> Hide emojis in menu labels</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-sound" ${cu.sounds_enabled !== false ? 'checked' : ''}> Enable UI / checkout sounds</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-auto-print" ${cu.auto_print_receipt ? 'checked' : ''}> Auto-print receipt after sale</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-confirm-void" ${cu.confirm_void !== false ? 'checked' : ''}> Confirm before void / large discount</label></div>
        <div class="field"><label>POS product grid columns</label>
          <input type="number" id="cu-pos-cols" min="2" max="8" value="${cu.pos_grid_columns || 4}"></div>
        <div class="field"><label>Low stock alert threshold</label>
          <input type="number" id="cu-low-stock" min="0" step="1" value="${cu.low_stock_threshold ?? 5}"></div>
        <div class="field"><label>Idle lock (minutes, 0 = off)</label>
          <input type="number" id="cu-idle" min="0" max="240" value="${cu.idle_lock_minutes ?? 0}"></div>
      </div>
      <button class="btn btn-primary" id="save-customize" style="margin-top:16px">Save Customization</button>
      </div></div></div>`;

    let logoPath = s.logo_path;
    if (logoPath) Utils.setImagePreview('cu-logo-preview', logoPath, 'max-height:60px;margin-top:8px;border-radius:8px');
    document.getElementById('cu-logo-btn').addEventListener('click', async () => {
      const r = await API.selectImage('logo');
      if (r.success) {
        logoPath = r.path;
        await Utils.setImagePreview('cu-logo-preview', logoPath, 'max-height:60px;margin-top:8px;border-radius:8px');
        Utils.toast('Logo uploaded — click Save to apply', 'success');
      }
    });

    document.getElementById('save-customize').addEventListener('click', async () => {
      const bizType = document.getElementById('cu-type').value;
      const settingsPatch = {
        shop_name: document.getElementById('cu-name').value.trim(),
        app_display_name: document.getElementById('cu-app-name').value.trim() || document.getElementById('cu-name').value.trim(),
        business_type: bizType,
        theme: document.getElementById('cu-theme').value,
        email: document.getElementById('cu-email').value.trim(),
        website: document.getElementById('cu-website').value.trim(),
        social_media: document.getElementById('cu-social').value.trim(),
        logo_path: logoPath
      };
      const r1 = await this.awaitSave(API.saveSettings(settingsPatch, this.app.user), null, 'Could not save shop settings');
      if (!r1) return;
      const customization = {
        button_color: document.getElementById('cu-color').value,
        accent_color: document.getElementById('cu-accent').value,
        login_message: document.getElementById('cu-login-msg').value.trim(),
        default_home_page: document.getElementById('cu-home').value,
        ui_scale: parseFloat(document.getElementById('cu-scale').value) || 1,
        compact_nav: document.getElementById('cu-compact').checked,
        hide_nav_emojis: document.getElementById('cu-hide-emoji').checked,
        sounds_enabled: document.getElementById('cu-sound').checked,
        auto_print_receipt: document.getElementById('cu-auto-print').checked,
        confirm_void: document.getElementById('cu-confirm-void').checked,
        pos_grid_columns: parseInt(document.getElementById('cu-pos-cols').value, 10) || 4,
        low_stock_threshold: parseInt(document.getElementById('cu-low-stock').value, 10) || 0,
        idle_lock_minutes: parseInt(document.getElementById('cu-idle').value, 10) || 0
      };
      const r2 = await this.awaitSave(API.saveJsonSetting('customization', customization, this.app.user), null, 'Could not save customization');
      if (!r2) return;
      if (bizType === 'restaurant') {
        const ps = this.settings.printer_settings || {};
        if (ps.kitchen_enabled !== true) {
          await API.saveJsonSetting('printer_settings', { ...ps, kitchen_enabled: true, kitchen_auto: ps.kitchen_auto !== false }, this.app.user);
        }
      }
      window.DataCache?.invalidate?.('settings');
      const settingsRes = API.getSettingsParsed?._uncached
        ? await API.getSettingsParsed._uncached()
        : await API.getSettingsParsed();
      if (settingsRes.success) {
        this.settings = settingsRes.data;
        this.app.settings = settingsRes.data;
        this.app.updateBranding();
        this.app.applyTheme();
        this.app.renderNav?.();
      }
      document.documentElement.setAttribute('data-theme', document.getElementById('cu-theme').value);
      Utils.toast('Customization saved', 'success');
    });
  },

  async renderBranchesSync(el) {
    const [branchesRes, tillsRes] = await Promise.all([
      API.getBranches(),
      API.listBranchTills?.().catch(() => [])
    ]);
    const branches = branchesRes.data || [];
    const allTills = tillsRes?.data ?? tillsRes ?? [];
    const tillsByBranch = {};
    (Array.isArray(allTills) ? allTills : []).forEach((t) => {
      const bid = Number(t.branch_id);
      if (!tillsByBranch[bid]) tillsByBranch[bid] = [];
      tillsByBranch[bid].push(t);
    });
    const activeRes = await API.getActiveBranch?.() || {};
    const active = activeRes.data || branches.find((b) => b.is_active) || branches[0] || { id: 1, name: 'Main Branch', code: 'MAIN' };
    const viewRes = await API.getViewBranch?.() || {};
    const view = viewRes.data || {};
    const currency = this.settings?.currency || 'R';
    const role = this.app?.user?.role;
    const canManage = ['owner', 'manager'].includes(role);
    const canDeleteBranch = role === 'owner';
    const thisDeviceId = Utils.getDeviceId?.() || '';
    const thisDeviceName = Utils.mergeDeviceSettings?.(this.settings)?.device_name
      || this.settings?.device_settings?.device_name || 'This computer';
    const branchOpts = branches.map((b) => `<option value="${b.id}">${Utils.escHtml(b.name)} (${Utils.escHtml(b.code || '')})</option>`).join('');

    el.innerHTML = `<div class="admin-section"><h3>Branches &amp; Tills</h3>
      <p class="muted">Create branches, register POS tills, connect this computer, and manage tax per branch.
        Assign manager, supervisor and cashiers in <strong>Users</strong>.</p>
      <div class="card" style="margin-bottom:12px"><div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
          <div><span class="muted">This till sells as:</span> <strong>${Utils.escHtml(active.name || '—')}</strong> <span class="tag tag-ok">Active branch</span></div>
          <div><span class="muted">Admin viewing:</span> <strong>${view.view_all || view.view_branch_id == null ? 'All branches' : Utils.escHtml(view.branch?.name || '—')}</strong></div>
          <div><span class="muted">Device ID:</span> <code style="font-size:11px">${Utils.escHtml(thisDeviceId)}</code></div>
        </div>
      </div></div>
      ${canManage ? `<div class="card" style="margin-bottom:12px"><div class="card-body">
        <h4 style="margin-top:0">Connect this computer</h4>
        <p class="muted" style="font-size:12px">Registers this device as a till and sets which branch it sells for.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
          <div class="field" style="margin:0;min-width:180px"><label>Till display name</label>
            <input id="br-this-name" value="${Utils.escHtml(thisDeviceName)}"></div>
          <div class="field" style="margin:0;min-width:180px"><label>Branch</label>
            <select id="br-this-branch">${branchOpts}</select></div>
          <button type="button" class="btn btn-primary" id="br-connect-this">Connect this till</button>
        </div>
        <h4 style="margin-top:20px">Register a till</h4>
        <p class="muted" style="font-size:12px">Create a till slot before installing POS on another PC/tablet. Share the device ID with that device or let it auto-register on first connect.</p>
        <div class="form-grid">
          <div class="field"><label>Till name *</label><input id="br-till-name" placeholder="e.g. Front Counter 1"></div>
          <div class="field"><label>Branch *</label><select id="br-till-branch">${branchOpts}</select></div>
          <div class="field"><label>Device ID (optional)</label><input id="br-till-device" placeholder="Auto-generated if blank"></div>
        </div>
        <button type="button" class="btn btn-primary" id="br-register-till" style="margin-top:8px">Create till</button>
        <h4 style="margin-top:20px">All tills (${allTills.length})</h4>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Till name</th><th>Device ID</th><th>Branch</th><th>Status</th><th>Last seen</th><th></th></tr></thead>
          <tbody>${(Array.isArray(allTills) ? allTills : []).map((t) => `<tr>
            <td><strong>${Utils.escHtml(t.device_name || t.device_label || 'Till')}</strong>${t.device_id === thisDeviceId ? ' <span class="tag tag-ok">This device</span>' : ''}</td>
            <td><code style="font-size:11px">${Utils.escHtml(t.device_id || '')}</code></td>
            <td>${Utils.escHtml(t.branch_name || String(t.branch_id))}</td>
            <td><span class="tag">${Utils.escHtml(t.status || 'registered')}</span></td>
            <td class="muted">${Utils.formatDateTime(t.last_seen_at || '')}</td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-sm btn-ghost br-edit-till" data-branch="${t.branch_id}" data-device="${Utils.escHtml(t.device_id || '')}">Edit</button>
              <button type="button" class="btn btn-sm btn-primary br-use-till" data-branch="${t.branch_id}" data-device="${Utils.escHtml(t.device_id || '')}">Use here</button>
              <button type="button" class="btn btn-sm btn-danger br-remove-till" data-branch="${t.branch_id}" data-device="${Utils.escHtml(t.device_id || '')}">Delete</button>
            </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No tills yet — register one above or connect this computer</td></tr>'}
          </tbody></table></div>
      </div></div>` : ''}
      <div class="card"><div class="card-body">
        <h4 style="margin-top:0">Your branches</h4>
        <div id="branch-list">${branches.map((b) => {
          const mgr = b.manager?.full_name || '— none —';
          const sup = b.supervisor?.full_name || '— none —';
          const cashiers = b.cashier_count != null ? b.cashier_count : (b.staff?.cashiers?.length || 0);
          const tills = tillsByBranch[b.id] || [];
          return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
              <div>
                <strong>${Utils.escHtml(b.name)}</strong> <span class="muted">(${Utils.escHtml(b.code || '')})</span>
                ${b.id === active.id ? ' <span class="tag tag-ok">Till active</span>' : ''}
                ${b.is_active === 0 ? ' <span class="tag tag-out">Inactive</span>' : ''}
                <div class="muted" style="font-size:12px;margin-top:4px">
                  Manager: ${Utils.escHtml(mgr)} · Supervisor: ${Utils.escHtml(sup)} · Cashiers: ${cashiers}
                  · Sales today: ${Utils.formatMoney(b.sales_today || 0, currency)}
                  · Stock SKUs: ${b.stock_skus || 0}
                </div>
                ${b.address ? `<div class="muted" style="font-size:12px">${Utils.escHtml(b.address)}${b.phone ? ' · ' + Utils.escHtml(b.phone) : ''}</div>` : ''}
                ${tills.length ? `<div class="muted" style="font-size:12px;margin-top:6px">${tills.length} till(s) registered — see <strong>All tills</strong> table above</div>` : `<div class="muted" style="font-size:12px;margin-top:6px">No tills yet</div>`}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                <button type="button" class="btn btn-sm btn-primary br-activate" data-id="${b.id}">Connect till</button>
                ${canManage ? `<button type="button" class="btn btn-sm btn-ghost br-view" data-id="${b.id}">View data</button>
                <button type="button" class="btn btn-sm btn-ghost br-edit" data-id="${b.id}">Edit</button>` : ''}
                ${canDeleteBranch ? `<button type="button" class="btn btn-sm btn-danger br-delete" data-id="${b.id}">Delete</button>` : ''}
              </div>
            </div>
          </div>`;
        }).join('') || '<p class="muted">No branches yet — add your first shop below.</p>'}</div>
        ${canManage ? `<h4 style="margin-top:16px">Add / connect a branch</h4>
        <div class="form-grid">
          <div class="field"><label>Branch Name *</label><input id="br-name" placeholder="e.g. Sandton Mall"></div>
          <div class="field"><label>Branch Code *</label><input id="br-code" placeholder="e.g. SANDTON"></div>
          <div class="field"><label>Address</label><input id="br-address"></div>
          <div class="field"><label>Phone</label><input id="br-phone"></div>
        </div>
        <button type="button" class="btn btn-primary" id="br-add" style="margin-top:8px">Create Branch</button>
        <p class="muted" style="margin-top:8px;font-size:12px">After creating a branch: assign 1 manager + 1 supervisor + cashiers in <strong>Users</strong> (select that branch). Assign products to the branch on the Products page. Connect each till with <em>Connect till</em>.</p>` : ''}
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Recipe file transfer</h4>
        <p class="muted" style="font-size:12px">Optional file export/import of recipe BOM between shops.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
          <button type="button" class="btn btn-ghost" id="sync-export-recipes">Export Recipes (file)</button>
          <button type="button" class="btn btn-ghost" id="sync-import-recipes">Import Recipes…</button>
        </div>
        <input type="file" id="sync-recipe-file" accept="application/json,.json" class="hidden">
      </div></div></div>`;

    const cloudBase = (window.__SHOP_POS_ENV__?.RPC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_RPC_URL || window.location.origin || '')
      .replace(/\/rpc\/?$/i, '') || '';
    const orderUrl = `${cloudBase.replace(/\/$/, '')}/order/`;
    const orderLink = `<div class="card" style="margin-top:16px"><div class="card-body">
      <h4 style="margin-top:0">Customer ordering website</h4>
      <p class="muted" style="font-size:12px">Connected to Railway + Supabase (same menu &amp; stock as POS). Orders appear in POS and Admin → Online Orders.</p>
      <p><a href="${orderUrl}" target="_blank" rel="noopener">${Utils.escHtml(orderUrl)}</a>
        <button type="button" class="btn btn-sm btn-ghost" id="br-copy-order-link">Copy link</button></p>
      <button type="button" class="btn btn-ghost btn-sm" id="br-open-online-admin">Open Online Orders admin</button>
    </div></div>`;
    el.querySelector('.admin-section')?.insertAdjacentHTML('beforeend', orderLink);
    document.getElementById('br-copy-order-link')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(orderUrl);
      Utils.toast('Order link copied', 'success');
    });
    document.getElementById('br-open-online-admin')?.addEventListener('click', () => {
      this.section = 'online-orders';
      document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === 'online-orders'));
      this.renderSection(document.getElementById('admin-content'));
    });

    const thisBranchSel = document.getElementById('br-this-branch');
    if (thisBranchSel && active?.id) thisBranchSel.value = String(active.id);

    document.getElementById('br-add')?.addEventListener('click', async () => {
      const name = document.getElementById('br-name').value.trim();
      const code = document.getElementById('br-code').value.trim();
      if (!name || !code) return Utils.toast('Name and code required', 'error');
      const r = await API.saveBranch({
        name, code,
        address: document.getElementById('br-address').value.trim(),
        phone: document.getElementById('br-phone').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Branch created — assign manager, supervisor & cashiers next', 'success');
      this.renderBranchesSync(el);
    });

    el.querySelectorAll('.br-activate').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await API.setActiveBranch(parseInt(btn.dataset.id, 10), this.app.user);
        if (r && r.success === false) return Utils.toast(r.error || 'Failed', 'error');
        Utils.toast('This till is now connected to that branch', 'success');
        this.app?.refreshBranchSwitcher?.();
        this.renderBranchesSync(el);
      });
    });

    el.querySelectorAll('.br-view').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await API.setViewBranch(parseInt(btn.dataset.id, 10), this.app.user);
        if (r && r.success === false) return Utils.toast(r.error || 'Failed', 'error');
        Utils.toast('Admin view filtered to this branch', 'success');
        this.app?.refreshBranchSwitcher?.();
        this.renderBranchesSync(el);
      });
    });

    el.querySelectorAll('.br-edit').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const b = branches.find((x) => String(x.id) === String(btn.dataset.id));
        if (!b) return;
        let detail = b;
        try {
          const fresh = await API.getBranches();
          detail = (fresh?.data || fresh || []).find((x) => String(x.id) === String(b.id)) || b;
        } catch (_) { /* use cached */ }
        const st = detail.settings || {};
        const staff = detail.staff || {};
        Utils.showModal(`Edit branch — ${Utils.escHtml(detail.name || '')}`, `
          <h4 style="margin:0 0 8px">Branch details</h4>
          <div class="form-grid">
            <div class="field"><label>Name *</label><input id="be-name" value="${Utils.escHtml(detail.name || '')}"></div>
            <div class="field"><label>Code *</label><input id="be-code" value="${Utils.escHtml(detail.code || '')}"></div>
            <div class="field full"><label>Address</label><input id="be-address" value="${Utils.escHtml(detail.address || '')}"></div>
            <div class="field"><label>Phone</label><input id="be-phone" value="${Utils.escHtml(detail.phone || '')}"></div>
            <div class="field"><label><input type="checkbox" id="be-active" ${detail.is_active !== 0 ? 'checked' : ''}> Branch active</label></div>
          </div>
          <h4 style="margin:16px 0 8px">Tax &amp; VAT (this branch)</h4>
          <div class="form-grid">
            <div class="field"><label><input type="checkbox" id="be-tax-enabled" ${st.tax_enabled ? 'checked' : ''}> Enable tax on this branch</label></div>
            <div class="field"><label>Tax rate %</label><input type="number" step="0.01" id="be-tax-rate" value="${Number(st.tax_rate) || 0}"></div>
            <div class="field"><label>VAT number</label><input id="be-vat" value="${Utils.escHtml(st.vat_number || '')}"></div>
            <div class="field"><label><input type="checkbox" id="be-tax-inclusive" ${st.tax_inclusive !== 0 ? 'checked' : ''}> Prices tax-inclusive</label></div>
            <div class="field"><label><input type="checkbox" id="be-tax-pos" ${st.tax_show_on_pos !== 0 ? 'checked' : ''}> Show tax on POS</label></div>
          </div>
          <h4 style="margin:16px 0 8px">Staff on this branch</h4>
          <p class="muted" style="font-size:12px;margin:0 0 8px">Manager: ${Utils.escHtml(staff.managers?.[0]?.full_name || '—')} · Supervisor: ${Utils.escHtml(staff.supervisors?.[0]?.full_name || '—')} · Cashiers: ${staff.cashiers?.length || 0}. Change assignments in <strong>Users</strong>.</p>`,
          '<button class="btn btn-primary" id="be-save">Save all changes</button>');
        document.getElementById('be-save')?.addEventListener('click', async () => {
          const r = await API.saveBranch({
            id: detail.id,
            name: document.getElementById('be-name').value.trim(),
            code: document.getElementById('be-code').value.trim(),
            address: document.getElementById('be-address').value.trim(),
            phone: document.getElementById('be-phone').value.trim(),
            is_active: document.getElementById('be-active').checked
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
          const r2 = await API.saveBranchSettings(detail.id, {
            tax_enabled: document.getElementById('be-tax-enabled').checked,
            tax_rate: parseFloat(document.getElementById('be-tax-rate').value) || 0,
            vat_number: document.getElementById('be-vat').value.trim(),
            tax_inclusive: document.getElementById('be-tax-inclusive').checked,
            tax_show_on_pos: document.getElementById('be-tax-pos').checked
          }, this.app.user);
          if (r2?.success === false) return Utils.toast(r2.error || 'Tax settings save failed', 'error');
          Utils.hideModal();
          Utils.toast('Branch and tax settings updated', 'success');
          this.renderBranchesSync(el);
        });
      });
    });

    document.getElementById('br-connect-this')?.addEventListener('click', async () => {
      const branchId = parseInt(document.getElementById('br-this-branch')?.value, 10);
      const label = document.getElementById('br-this-name')?.value.trim() || thisDeviceName;
      if (!branchId) return Utils.toast('Select a branch', 'error');
      try { Utils.saveLocalDeviceSettings?.({ device_name: label, branch_id: branchId }); } catch (_) { /* */ }
      const tr = await API.saveBranchTill?.(branchId, { device_id: thisDeviceId, device_label: label }, this.app.user);
      if (tr?.success === false || tr?.error) return Utils.toast(tr?.error || 'Till registration failed', 'error');
      const r = await API.setActiveBranch(branchId, this.app.user);
      if (r && r.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('This computer is now connected as a till', 'success');
      this.app?.refreshBranchSwitcher?.();
      this.renderBranchesSync(el);
    });

    document.getElementById('br-register-till')?.addEventListener('click', async () => {
      const name = document.getElementById('br-till-name')?.value.trim();
      const branchId = parseInt(document.getElementById('br-till-branch')?.value, 10);
      const deviceId = document.getElementById('br-till-device')?.value.trim();
      if (!name || !branchId) return Utils.toast('Till name and branch required', 'error');
      const r = await API.saveBranchTill?.(branchId, { device_label: name, device_id: deviceId || undefined }, this.app.user);
      if (r?.success === false || r?.error) return Utils.toast(r?.error || 'Create failed', 'error');
      Utils.toast(`Till created — Device ID: ${r?.device_id || r?.data?.device_id || deviceId || 'see table'}`, 'success');
      this.renderBranchesSync(el);
    });

    el.querySelectorAll('.br-edit-till').forEach((btn) => {
      btn.addEventListener('click', () => {
        const branchId = parseInt(btn.dataset.branch, 10);
        const deviceId = btn.dataset.device;
        const till = (Array.isArray(allTills) ? allTills : []).find((t) => String(t.device_id) === String(deviceId) && Number(t.branch_id) === branchId);
        Utils.showModal('Edit till', `
          <div class="form-grid">
            <div class="field"><label>Till name</label><input id="bt-name" value="${Utils.escHtml(till?.device_name || till?.device_label || '')}"></div>
            <div class="field"><label>Branch</label><select id="bt-branch">${branches.map((b) => `<option value="${b.id}" ${Number(b.id) === branchId ? 'selected' : ''}>${Utils.escHtml(b.name)}</option>`).join('')}</select></div>
            <div class="field full"><label>Device ID</label><input value="${Utils.escHtml(deviceId)}" readonly></div>
          </div>`,
          '<button class="btn btn-primary" id="bt-save">Save till</button>');
        document.getElementById('bt-save')?.addEventListener('click', async () => {
          const r = await API.updateBranchTill?.(branchId, deviceId, {
            device_label: document.getElementById('bt-name')?.value.trim(),
            branch_id: parseInt(document.getElementById('bt-branch')?.value, 10)
          }, this.app.user);
          if (r?.success === false || r?.error) return Utils.toast(r?.error || 'Update failed', 'error');
          Utils.hideModal();
          Utils.toast('Till updated', 'success');
          this.renderBranchesSync(el);
        });
      });
    });

    el.querySelectorAll('.br-use-till').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const branchId = parseInt(btn.dataset.branch, 10);
        const deviceId = btn.dataset.device;
        if (deviceId !== thisDeviceId && !confirm('This till belongs to another device ID. Connect this computer anyway using its own device ID?')) return;
        const till = (Array.isArray(allTills) ? allTills : []).find((t) => String(t.device_id) === String(deviceId));
        const label = till?.device_name || till?.device_label || thisDeviceName;
        try { Utils.saveLocalDeviceSettings?.({ device_name: label, branch_id: branchId }); } catch (_) { /* */ }
        await API.saveBranchTill?.(branchId, { device_id: thisDeviceId, device_label: label }, this.app.user);
        const r = await API.setActiveBranch(branchId, this.app.user);
        if (r && r.success === false) return Utils.toast(r.error || 'Failed', 'error');
        Utils.toast('Connected to branch', 'success');
        this.app?.refreshBranchSwitcher?.();
        this.renderBranchesSync(el);
      });
    });

    el.querySelectorAll('.br-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const b = branches.find((x) => String(x.id) === String(btn.dataset.id));
        if (!b) return;
        if (!confirm(`Delete branch "${b.name}"? Branches with sales history are deactivated instead of removed.`)) return;
        (async () => {
          const r = await API.deleteBranch?.(b.id, this.app.user);
          if (r?.success === false || r?.error) return Utils.toast(r?.error || 'Delete failed', 'error');
          Utils.toast(r?.message || (r?.deactivated ? 'Branch deactivated (has sales history)' : 'Branch deleted'), 'success');
          this.app?.refreshBranchSwitcher?.();
          this.renderBranchesSync(el);
        })();
      });
    });

    el.querySelectorAll('.br-remove-till').forEach((btn) => {
      btn.addEventListener('click', () => {
        const branchId = parseInt(btn.dataset.branch, 10);
        const deviceId = btn.dataset.device;
        if (!deviceId || !confirm('Delete this till? The device can register again later.')) return;
        (async () => {
          const r = await API.deleteBranchTill?.(branchId, deviceId, this.app.user);
          if (r?.success === false || r?.error) return Utils.toast(r?.error || 'Remove failed', 'error');
          Utils.toast('Till removed', 'success');
          this.renderBranchesSync(el);
        })();
      });
    });

    document.getElementById('sync-export-recipes')?.addEventListener('click', async () => {
      const r = await API.recipeExportBundle(this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Export failed', 'error');
      const bytes = Array.from(new TextEncoder().encode(JSON.stringify(r.data, null, 2)));
      await API.saveFile(`recipe-bundle-${Utils.today()}.json`, [{ name: 'JSON', extensions: ['json'] }], bytes);
      Utils.toast(`Exported ${(r.data?.meals || []).length} meals`, 'success');
    });
    document.getElementById('sync-import-recipes')?.addEventListener('click', () => {
      document.getElementById('sync-recipe-file')?.click();
    });
    document.getElementById('sync-recipe-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const bundle = JSON.parse(await file.text());
        const r = await API.recipeImportBundle(bundle, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Import failed', 'error');
        Utils.toast(`Imported ${r.data?.imported || 0} of ${r.data?.total || 0} meals`, 'success');
      } catch (err) {
        Utils.toast(err.message || 'Invalid recipe file', 'error');
      }
      e.target.value = '';
    });
  },

  renderDevice(el) {
    const ds = this.settings.device_settings || {};
    const ss = this.settings.scanner_settings || {};
    const devId = ds.device_id || Utils.getDeviceId();
    el.innerHTML = `<div class="admin-section"><h3>Device Settings</h3>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Computer / Device Name</label><input id="dev-name" value="${ds.device_name||''}"></div>
        <div class="field"><label>Tablet Name</label><input id="dev-tablet" value="${ds.tablet_name||''}"></div>
        <div class="field"><label>Device ID</label><input id="dev-id" value="${devId}" readonly></div>
        <div class="field"><label>Software Version</label><input value="2.1.8" readonly></div>
        <div class="field full"><label>Backup Location</label><input id="dev-backup" value="${ds.backup_location||'Default (AppData)'}"></div>
        <div class="field"><label><input type="checkbox" id="dev-active" ${ds.activated!==false?'checked':''}> POS Activated</label></div>
      </div>
      <button class="btn btn-primary" id="save-device" style="margin-top:16px">Save Device Settings</button>
      <h4 style="margin-top:28px">Barcode Scanner</h4>
      <div class="form-grid">
        <div class="field"><label>Scanner Type</label>
          <select id="scan-type"><option value="usb" ${ss.type==='usb'||!ss.type?'selected':''}>USB Scanner</option>
          <option value="bluetooth" ${ss.type==='bluetooth'?'selected':''}>Bluetooth Scanner</option>
          <option value="camera" ${ss.type==='camera'?'selected':''}>Camera Scanner (Tablet)</option></select></div>
        <div class="field"><label><input type="checkbox" id="scan-enabled" ${ss.enabled!==false?'checked':''}> Scanner enabled</label></div>
        <div class="field"><label><input type="checkbox" id="scan-beep" ${ss.beep_on_scan!==false?'checked':''}> Beep on scan</label></div>
        <div class="field full"><label>Prefix / Suffix (optional)</label><input id="scan-prefix" value="${ss.prefix||''}" placeholder="e.g. *"></div>
      </div>
      <button class="btn btn-ghost" id="save-scanner" style="margin-top:12px">Save Scanner Settings</button>
      </div></div></div>`;
    document.getElementById('save-scanner')?.addEventListener('click', async () => {
      const r = await this.awaitSave(API.saveJsonSetting('scanner_settings', {
        type: document.getElementById('scan-type').value,
        enabled: document.getElementById('scan-enabled').checked,
        beep_on_scan: document.getElementById('scan-beep').checked,
        prefix: document.getElementById('scan-prefix').value.trim()
      }, this.app.user), 'Scanner settings saved', 'Could not save scanner settings');
      if (r) this.settings.scanner_settings = {
        type: document.getElementById('scan-type').value,
        enabled: document.getElementById('scan-enabled').checked,
        beep_on_scan: document.getElementById('scan-beep').checked,
        prefix: document.getElementById('scan-prefix').value.trim()
      };
    });
    document.getElementById('save-device').addEventListener('click', async () => {
      const deviceId = document.getElementById('dev-id').value || Utils.getDeviceId();
      await API.saveJsonSetting('device_settings', {
        device_name: document.getElementById('dev-name').value.trim(),
        tablet_name: document.getElementById('dev-tablet').value.trim(),
        device_id: deviceId,
        backup_location: document.getElementById('dev-backup').value.trim(),
        activated: document.getElementById('dev-active').checked
      }, this.app.user);
      Utils.saveLocalDeviceSettings({ device_id: deviceId });
      Utils.toast('Device settings saved', 'success');
    });
  },

  renderBackup(el) {
    const bs = this.settings.backup_settings || {};
    const mobileHint = window.__SHOP_POS_MOBILE__
      ? '<p class="muted" id="bk-folder">Backup folder: Documents/ShopPOS/backups/</p>'
      : '';
    el.innerHTML = `<div class="admin-section"><h3>Backup & Restore</h3>
      <div class="card"><div class="card-body">
        <p class="muted">Last backup: ${this.settings.last_backup ? Utils.formatDateTime(this.settings.last_backup) : 'Never'}</p>
        ${mobileHint}
        <p class="muted" style="margin-top:8px">A full <strong>.db backup</strong> includes all products, sales, staff, settings, quotes, payroll, and customer data. Store backups safely off this device.</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;max-width:320px">
          <button class="btn btn-primary" id="adm-backup">Create Backup</button>
          <button class="btn btn-warning" id="adm-restore">Restore Backup</button>
          <button class="btn btn-ghost" id="adm-export">Export Database File</button>
        </div>
        <p class="muted" style="margin-top:12px;font-size:12px;color:var(--danger)"><strong>Restore warning:</strong> Restoring replaces ALL current data with the backup file. Export or backup first if unsure.</p>
        <div class="form-grid" style="margin-top:24px">
          <div class="field"><label><input type="checkbox" id="bk-auto" ${bs.auto_backup?'checked':''}> Automatic daily backup</label></div>
          <div class="field"><label><input type="checkbox" id="bk-remind" ${bs.reminder!==false?'checked':''}> Backup reminder</label></div>
        </div>
        <button class="btn btn-primary" id="save-backup-settings" style="margin-top:12px">Save Backup Settings</button>
      </div></div>
      <div class="card" style="margin-top:16px;border-color:var(--warning)"><div class="card-body">
        <h4 style="color:var(--warning)">Clear Selected Data</h4>
        <p class="muted">Choose what to wipe. <strong>Kept:</strong> products, categories, customers, suppliers, employees, users, and shop settings.</p>
        <p class="muted"><strong>Before clearing:</strong> A safety backup is created automatically. Owner password required.</p>
        <div id="clear-cats" class="form-grid" style="margin-top:12px">
          <div class="field full"><label><input type="checkbox" id="clear-cat-all"> Select all operational data</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="sales_orders"> POS sales &amp; orders</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="returns"> Returns / refunds</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="quotes_layby"> Quotes, lay-bye &amp; gift activity</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="customer_activity"> Loyalty &amp; credit ledger</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="cash_shifts"> Shifts, cash-up &amp; cash drops</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="stock_purchasing"> Stock moves, counts, waste &amp; POs</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="expenses_books"> Expenses &amp; bookkeeping txns</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="attendance_payroll"> Attendance &amp; payroll runs</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="notifications_audit"> Notifications &amp; audit logs</label></div>
        </div>
        <button class="btn btn-warning" id="adm-clear-ops" style="margin-top:12px">Clear Selected Data</button>
      </div></div>
      <div class="card" style="margin-top:16px;border-color:var(--danger)"><div class="card-body">
        <h4 style="color:var(--danger)">Danger Zone — Delete Business</h4>
        <p class="muted">Permanently erase all data and accounts, then register a new business from scratch. Requires your Private Recovery Phrase.</p>
        <p class="muted"><strong>Tip:</strong> Export or backup your database first if you may need this data later.</p>
        <button class="btn btn-danger" id="adm-factory-reset" style="margin-top:12px">Delete Business & Start Over</button>
      </div></div></div>`;

    document.getElementById('adm-backup').addEventListener('click', async () => {
      const r = await API.backupCreate(this.app.user);
      if (r.success) Utils.toast(r.path ? `Backup saved to ${r.path}` : 'Backup saved!', 'success');
      else if (!r.cancelled) Utils.toast(r.error || 'Backup failed', 'error');
    });
    document.getElementById('adm-restore').addEventListener('click', async () => {
      if (!confirm('Restore will replace ALL data (products, sales, staff, settings). Continue?')) return;
      if (!confirm('Are you absolutely sure? This cannot be undone without another backup.')) return;
      const r = await API.backupRestore(this.app.user);
      if (r.success) { Utils.toast('Restored. Restarting…', 'success'); setTimeout(() => location.reload(), 1500); }
      else Utils.toast(r.error || 'Restore failed', 'error');
    });
    document.getElementById('adm-export').addEventListener('click', () => API.backupExport(this.app.user));
    document.getElementById('save-backup-settings').addEventListener('click', async () => {
      await API.saveJsonSetting('backup_settings', {
        auto_backup: document.getElementById('bk-auto').checked,
        reminder: document.getElementById('bk-remind').checked
      }, this.app.user);
      Utils.toast('Backup settings saved', 'success');
    });
    document.getElementById('adm-factory-reset').addEventListener('click', () => {
      this.app.showFactoryResetModal(true);
    });
    if (window.__SHOP_POS_MOBILE__) {
      API.getBackupInfo().then(r => {
        if (r.success && r.data?.folder) {
          const elFolder = document.getElementById('bk-folder');
          if (elFolder) elFolder.textContent = `Backup folder: ${r.data.folder}`;
        }
      }).catch(() => {});
    }
    document.getElementById('clear-cat-all')?.addEventListener('change', (e) => {
      el.querySelectorAll('.clear-cat').forEach((c) => { c.checked = e.target.checked; });
    });
    document.getElementById('adm-clear-ops').addEventListener('click', () => {
      if (this.app.user?.role !== 'owner') {
        Utils.toast('Only the owner can clear operational data', 'error');
        return;
      }
      const selected = [...el.querySelectorAll('.clear-cat:checked')].map((c) => c.value);
      if (!selected.length) {
        Utils.toast('Select at least one data type to clear', 'error');
        return;
      }
      const labels = selected.map((v) => el.querySelector(`.clear-cat[value="${v}"]`)?.parentElement?.textContent?.trim() || v);
      Utils.showModal('Clear Selected Data', `
        <p class="muted" style="margin-bottom:12px"><strong>Warning:</strong> This permanently deletes:</p>
        <ul style="margin:0 0 12px;padding-left:18px">${labels.map((l) => `<li>${Utils.escHtml(l)}</li>`).join('')}</ul>
        <p class="muted" style="margin-bottom:12px">Products, customers, suppliers, employees, users, and settings stay. An automatic backup is created first.</p>
        <div class="field"><label>Owner Password</label><input type="password" id="clear-ops-pw" autocomplete="current-password"></div>
        <div class="field full"><label><input type="checkbox" id="clear-ops-confirm"> I understand this cannot be undone without restoring the auto-backup</label></div>
      `, '<button class="btn btn-warning" id="clear-ops-go">Clear Selected Data</button>');
      document.getElementById('clear-ops-go').addEventListener('click', async () => {
        if (!document.getElementById('clear-ops-confirm').checked) {
          return Utils.toast('Please confirm you understand the consequences', 'error');
        }
        const pw = document.getElementById('clear-ops-pw').value;
        if (!pw) return Utils.toast('Password required', 'error');
        const r = await API.clearOperationalData(pw, this.app.user, selected);
        if (!r.success) return Utils.toast(r.error || 'Clear failed', 'error');
        Utils.hideModal();
        Utils.toast(`Selected data cleared. Backup: ${r.data?.backup_path || 'saved'}`, 'success');
        setTimeout(() => location.reload(), 2000);
      });
    });
  },

  _adminSearchSeq: 0,

  /** Extra keywords so admin search finds every feature by common words. */
  _sectionSearchKeywords(id) {
    const map = {
      receipt: ['slip', 'sleeve', 'receipt design', 'footer', 'till slip'],
      security: ['pin', 'password', 'lock'],
      quotes: ['quotation', 'estimate'],
      permissions: ['roles', 'access', 'users'],
      'sales-targets': ['target', 'targets', 'daily target', 'product target', 'goal', 'sales goal', 'quota', 'quantity target'],
      'top-customers': ['vip', 'customer', 'loyalty customer'],
      approvals: ['approve', 'pending settings'],
      tax: ['vat', 'currency', 'rand'],
      'tax-hub': ['tax calc', 'vat report'],
      cashiers: ['cashier', 'manager', 'till user'],
      shifts: ['shift', 'float', 'cashout', 'till'],
      operating: ['hours', 'open', 'close', 'trading hours'],
      cashdrawer: ['drawer', 'cash drop'],
      analytics: ['report', 'sales report', 'charts'],
      inventory: ['stock', 'restock', 'products stock', 'ingredient'],
      discounts: ['promo', 'markdown', 'coupon'],
      loyalty: ['gift card', 'points', 'rewards'],
      importexport: ['import', 'export', 'csv', 'backup products'],
      customize: ['theme', 'branding', 'logo', 'colour', 'color'],
      branches: ['branch', 'store', 'location'],
      'online-orders': ['online', 'website order', 'delivery order'],
      'referral-dept': ['referral', 'commission', 'agent'],
      'customer-reports': ['complaint', 'issue', 'feedback'],
      'business-modules': ['module', 'business'],
      'digital-signage': ['tv', 'screen', 'display', 'signage'],
      'mobile-app': ['mobile', 'app user'],
      'business-manager': ['kpi', 'manager dashboard'],
      device: ['device', 'tablet', 'kiosk'],
      backup: ['restore', 'backup'],
      opscompliance: ['checklist', 'opening', 'closing', 'rules', 'compliance', 'company rules'],
      combos: ['combo', 'meal deal', 'promo meal'],
      'menu-builder': ['menu', 'menu builder', 'flyer menu', 'print menu', 'restaurant menu', 'generate menu', 'pdf menu'],
      'promo-video-builder': ['video', 'promo video', 'reels', 'tiktok', 'whatsapp status video', 'menu video', 'generate video'],
      'communication-center': ['communication', 'whatsapp', 'sms', 'email', 'notification', 'campaign', 'automation', 'share', 'publish', 'messaging', 'broadcast'],
      radio: ['radio', 'live', 'studio', 'broadcast', 'dj', 'on air'],
      recipe: ['recipe', 'ingredient', 'production', 'kitchen recipe', 'bom', 'meal'],
      staffhr: ['staff', 'employee', 'leave', 'sleeve', 'attendance', 'hr', 'clock', 'shift schedule', 'payslip'],
      'hr-workspace': ['payroll', 'documents', 'hr workspace', 'leave'],
      'hr-approvals': ['leave approve', 'hr approve'],
      'accounting-workspace': ['bookkeeping', 'accounting', 'ledger', 'expenses'],
      staffportal: ['portal', 'staff portal', 'leave request', 'my shifts', 'sign rules'],
      onaccount: ['on account', 'credit', 'debtor'],
      'taken-orders': ['unpaid', 'taken order', 'held account'],
      hrcontracts: ['contract', 'probation', 'employment'],
      recruitment: ['hire', 'recruit', 'cv', 'applicant'],
      'delivery-dept': ['delivery', 'driver', 'dispatch'],
      payroll: ['salary', 'uif', 'paye', 'payslip'],
      'employee-of-month': ['eom', 'award', 'employee of the month'],
      database: ['sql', 'database', 'tables'],
      'system-health': ['health', 'storage', 'disk'],
      automation: ['rule', 'auto', 'automation'],
      customfields: ['custom field', 'extra field'],
      formats: ['date format', 'numbering', 'invoice prefix'],
      developer: ['dev', 'debug', 'developer'],
      printer: ['print', 'receipt printer', 'bluetooth'],
      payments: ['pay', 'card', 'cash', 'eft', 'payment method'],
      overview: ['home', 'dashboard', 'summary']
    };
    return map[id] || [];
  },

  _matchAdminSection(section, q) {
    if (!q) return false;
    const label = this._adminNavLabel(section.label).toLowerCase();
    const raw = String(section.label || '').toLowerCase();
    const id = String(section.id || '').toLowerCase();
    const idSpaced = id.replace(/-/g, ' ');
    const hay = `${label} ${raw} ${id} ${idSpaced}`;
    if (hay.includes(q) || label.includes(q) || raw.includes(q) || id.includes(q) || idSpaced.includes(q)) return true;
    const words = q.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length > 1 && words.every((w) => hay.includes(w))) return true;
    const keywords = this._sectionSearchKeywords(section.id);
    return keywords.some((kw) => {
      const k = String(kw).toLowerCase();
      if (k.includes(q) || q.includes(k)) return true;
      return words.length > 0 && words.every((w) => k.includes(w) || hay.includes(w));
    });
  },

  handleAdminSearchDebounced(query) {
    clearTimeout(this._adminSearchDebounce);
    this._adminSearchDebounce = setTimeout(() => this.handleAdminSearch(query), 220);
    if (query && String(query).trim().length >= 1) {
      this.handleAdminSearchLocal(query);
    }
  },

  handleAdminSearchLocal(query) {
    const dropdown = document.getElementById('admin-search-results');
    if (!dropdown) return;
    if (!query || !String(query).trim()) { dropdown.classList.add('hidden'); return; }
    const q = query.toLowerCase().trim();
    let html = '';
    const sections = (this.sections || []).filter((s) =>
      this._matchAdminSection(s, q) && Utils.canAccessAdminSection(this.app.user, s.id)
    );
    if (sections.length) {
      html += '<div class="search-group"><h4>Features</h4>' +
        sections.map((s) => `<div class="search-item" data-action="admin-section" data-section="${s.id}">${this._adminNavLabel(s.label)}</div>`).join('') + '</div>';
    }
    const navHits = (this.app.navItems || []).filter((item) => {
      const label = String(item.label || '').replace(/^[^\w]+/, '').toLowerCase();
      const id = String(item.id || '').toLowerCase();
      return (label.includes(q) || id.includes(q) || q.includes(id)) && Utils.canAccess(this.app.user, item.id);
    }).slice(0, 12);
    if (navHits.length) {
      html += '<div class="search-group"><h4>App Pages</h4>' +
        navHits.map((f) => `<div class="search-item" data-action="page" data-page="${f.id}">${f.label}</div>`).join('') + '</div>';
    }
    if (html) {
      dropdown.innerHTML = html + (q.length >= 2 ? '<p class="muted" style="padding:8px;font-size:12px">Searching records…</p>' : '');
      dropdown.classList.remove('hidden');
      this._bindAdminSearchResults(dropdown);
    } else {
      dropdown.innerHTML = '<div class="search-group"><p class="muted">No features match — try another word</p></div>';
      dropdown.classList.remove('hidden');
    }
  },

  _bindAdminSearchResults(dropdown, receiptHandler) {
    dropdown.querySelectorAll('[data-action="admin-section"]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        const section = el.dataset.section;
        if (!Utils.canAccessAdminSection(this.app.user, section)) return;
        this.section = section;
        document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.section === section));
        this.toggleOpsComplianceLayout(section === 'opscompliance');
        this.renderSection(document.getElementById('admin-content'));
      });
    });
    dropdown.querySelectorAll('[data-action="page"]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        if (el.dataset.page === 'recipe') return this.app.openRecipeProduction({ fromApp: true });
        if (Utils.canAccess(this.app.user, el.dataset.page)) this.app.navigate(el.dataset.page);
      });
    });
    dropdown.querySelectorAll('[data-action="bookkeeping-tab"]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        this.app.navigateToBookkeepingTab(el.dataset.tab);
      });
    });
    if (typeof receiptHandler === 'function') {
      dropdown.querySelectorAll('[data-action="receipt"]').forEach(el => {
        el.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          dropdown.classList.add('hidden');
          await receiptHandler(el);
        });
      });
    }
  },

  async handleAdminSearch(query) {
    const dropdown = document.getElementById('admin-search-results');
    if (!dropdown) return;
    if (!query || !String(query).trim()) { dropdown.classList.add('hidden'); return; }
    const seq = ++this._adminSearchSeq;
    const q = query.toLowerCase();
    const needRpc = q.length >= 2;
    const currency = this.settings?.currency || 'R';
    let html = '';

    const sections = (this.sections || []).filter((s) =>
      this._matchAdminSection(s, q) && Utils.canAccessAdminSection(this.app.user, s.id)
    );
    if (sections.length) {
      html += '<div class="search-group"><h4>Features</h4>' +
        sections.map((s) => `<div class="search-item" data-action="admin-section" data-section="${s.id}">${this._adminNavLabel(s.label)}</div>`).join('') + '</div>';
    }

    const data = needRpc ? ((await API.globalSearch(query)).data || {}) : {};
    if (seq !== this._adminSearchSeq) return;
    if (data.products?.length && Utils.canAccess(this.app.user, 'products')) {
      html += '<div class="search-group"><h4>Products</h4>' +
        data.products.map(p => `<div class="search-item" data-action="page" data-page="products">${p.name} — ${Utils.formatMoney(p.selling_price, currency)}</div>`).join('') + '</div>';
    }
    if (data.employees?.length && Utils.canAccessAdminSection(this.app.user, 'staffhr')) {
      html += '<div class="search-group"><h4>Employees</h4>' +
        data.employees.map(e => `<div class="search-item" data-action="admin-section" data-section="staffhr">${e.full_name}${e.employee_code ? ` (${e.employee_code})` : ''}${e.phone ? ` — ${e.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.combos?.length && Utils.canAccessAdminSection(this.app.user, 'combos')) {
      html += '<div class="search-group"><h4>Combos</h4>' +
        data.combos.map(c => `<div class="search-item" data-action="admin-section" data-section="combos">${c.name}</div>`).join('') + '</div>';
    }
    if (data.giftcards?.length && Utils.canAccess(this.app.user, 'giftcards')) {
      html += '<div class="search-group"><h4>Gift Cards</h4>' +
        data.giftcards.map(g => `<div class="search-item" data-action="admin-section" data-section="loyalty"><code>${g.code}</code> — ${g.customer_name || '—'} (Loyalty & Gift Cards)</div>`).join('') + '</div>';
    }
    if (data.laybyes?.length && Utils.canAccess(this.app.user, 'layby')) {
      html += '<div class="search-group"><h4>Lay-Bye</h4>' +
        data.laybyes.map(l => `<div class="search-item" data-action="page" data-page="layby">${l.layby_number || 'Layby'} — ${l.customer_name || '—'}</div>`).join('') + '</div>';
    }
    if (data.categories?.length && Utils.canAccess(this.app.user, 'categories')) {
      html += '<div class="search-group"><h4>Categories</h4>' +
        data.categories.map(c => `<div class="search-item" data-action="page" data-page="categories">${c.name}</div>`).join('') + '</div>';
    }
    if (data.quotes?.length && Utils.canAccess(this.app.user, 'quotes')) {
      html += '<div class="search-group"><h4>Quotations</h4>' +
        data.quotes.map(qt => `<div class="search-item" data-action="page" data-page="quotes">${qt.quote_number}</div>`).join('') + '</div>';
    }
    if (data.donations?.length && Utils.canAccess(this.app.user, 'bookkeeping')) {
      html += '<div class="search-group"><h4>Donations</h4>' +
        data.donations.map(d => `<div class="search-item" data-action="bookkeeping-tab" data-tab="donations">${d.donation_number || 'Donation'} — ${d.recipient_org || 'Unknown'}</div>`).join('') + '</div>';
    }
    if (data.customers?.length && Utils.canAccess(this.app.user, 'customers')) {
      html += '<div class="search-group"><h4>Customers</h4>' +
        data.customers.map(c => `<div class="search-item" data-action="page" data-page="customers">${c.name}${c.phone ? ` — ${c.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.suppliers?.length && Utils.canAccess(this.app.user, 'suppliers')) {
      html += '<div class="search-group"><h4>Suppliers</h4>' +
        data.suppliers.map(s => `<div class="search-item" data-action="page" data-page="suppliers">${s.name}${s.phone ? ` — ${s.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.receipts?.length && Utils.canAccess(this.app.user, 'pos')) {
      html += '<div class="search-group"><h4>Receipts</h4>' +
        data.receipts.map(r => `<div class="search-item" data-action="receipt" data-id="${r.receipt_number}">${r.receipt_number} — ${Utils.formatMoney(r.total, currency)}</div>`).join('') + '</div>';
    }
    if (data.settings?.length) {
      html += '<div class="search-group"><h4>Settings</h4>' +
        data.settings.filter(s => Utils.canAccessAdminSection(this.app.user, s.section)).map(s =>
          `<div class="search-item" data-action="admin-section" data-section="${s.section}">${s.label}: ${s.value}</div>`).join('') + '</div>';
    }
    // Also surface main-app panels this role can open (scoped)
    const navHits = (this.app.navItems || []).filter(item => {
      const label = item.label.replace(/^[^\w]+/, '').toLowerCase();
      return (label.includes(q) || item.id.includes(q)) && Utils.canAccess(this.app.user, item.id);
    }).slice(0, 10);
    if (navHits.length) {
      html += '<div class="search-group"><h4>App Pages</h4>' +
        navHits.map(f => `<div class="search-item" data-action="page" data-page="${f.id}">${f.label}</div>`).join('') + '</div>';
    }

    dropdown.innerHTML = html || '<div class="search-group"><p class="muted">No results</p></div>';
    dropdown.classList.remove('hidden');
    const receiptHandler = async (el) => {
      const r = await API.getSaleByReceipt(el.dataset.id);
      if (r.success && r.data) {
        Utils.showModal(`Receipt ${r.data.receipt_number}`, `
          <p><strong>Total:</strong> ${Utils.formatMoney(r.data.total, currency)}</p>
          <p><strong>Date:</strong> ${Utils.formatDateTime(r.data.created_at)}</p>
          <p><strong>Cashier:</strong> ${r.data.cashier_name || '—'}</p>`,
          '<button class="btn btn-primary" id="search-receipt-close">Close</button>');
        document.getElementById('search-receipt-close')?.addEventListener('click', Utils.hideModal);
      } else Utils.toast('Receipt not found', 'error');
    };
    this._bindAdminSearchResults(dropdown, receiptHandler);
  },

  async renderCustomerReports(el) {
    const r = await API.webListIssues({}, this.app.user);
    if (!r.success) {
      el.innerHTML = `<div class="admin-section"><h3>Customer Reports</h3><p class="error-msg">${Utils.escHtml(r.error || 'Could not load reports')}</p></div>`;
      return;
    }
    const rows = r.data || [];
    el.innerHTML = `<div class="admin-section"><h3>Customer Reports</h3>
      <p class="muted">Problems customers send from Order Online, with photos and the POS cashier who took the order.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Customer</th><th>Problem</th><th>POS cashier</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td>${Utils.formatDateTime?.(row.created_at) || row.created_at || '—'}</td>
          <td><strong>${Utils.escHtml(row.name)}</strong><br><small>${Utils.escHtml(row.phone || '')}</small></td>
          <td>${Utils.escHtml((row.message || '').slice(0, 120))}${row.has_photo ? '<br><small>Photo attached</small>' : ''}</td>
          <td>${Utils.escHtml(row.pos_cashier_name || 'Not linked yet')}</td>
          <td><span class="tag">${Utils.escHtml(row.status)}</span></td>
          <td><button class="btn btn-sm btn-primary cr-open" data-id="${row.id}">Open</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No customer reports yet</td></tr>'}
      </tbody></table></div></div>`;
    el.querySelectorAll('.cr-open').forEach((b) => b.addEventListener('click', async () => {
      const one = await API.webGetIssue(parseInt(b.dataset.id, 10), this.app.user);
      if (!one.success) return Utils.toast(one.error || 'Could not open', 'error');
      const d = one.data || {};
      Utils.showModal('Customer report', `
        <p><strong>${Utils.escHtml(d.name)}</strong> · ${Utils.escHtml(d.phone || '')}</p>
        <p class="muted">POS cashier: <strong>${Utils.escHtml(d.pos_cashier_name || 'Not linked yet')}</strong>${d.order_id ? ` · Order #${d.order_id}` : ''}</p>
        <p style="white-space:pre-wrap">${Utils.escHtml(d.message)}</p>
        ${d.photo_data ? `<p><img src="${d.photo_data}" alt="Customer photo" style="max-width:100%;border-radius:12px"></p>` : ''}
        ${d.admin_reply ? `<div class="card" style="margin-top:12px"><div class="card-body"><strong>Your reply</strong><p>${Utils.escHtml(d.admin_reply)}</p></div></div>` : `
          <div class="field"><label>Reply to customer</label><textarea id="cr-reply" rows="4" placeholder="We will make this right…"></textarea></div>`}`,
        d.admin_reply
          ? '<button class="btn btn-ghost" id="cr-close">Close</button>'
          : '<button class="btn btn-primary" id="cr-send">Send reply</button>');
      document.getElementById('cr-close')?.addEventListener('click', () => Utils.hideModal());
      document.getElementById('cr-send')?.addEventListener('click', async () => {
        const reply = document.getElementById('cr-reply')?.value.trim();
        const sr = await API.webReplyIssue(d.id, reply, this.app.user);
        if (!sr.success) return Utils.toast(sr.error || 'Could not reply', 'error');
        Utils.hideModal();
        Utils.toast('Reply sent', 'success');
        this.renderCustomerReports(el);
      });
    }));
  },

  onlineOrdersTabsHtml(active) {
    const tab = (id, label) =>
      `<button type="button" class="btn btn-ghost btn-sm oo-tab ${active === id ? 'active' : ''}" data-oo-tab="${id}">${label}</button>`;
    return `<div class="page-toolbar" style="gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0">
      ${tab('orders', 'Orders')}
      ${tab('customers', 'Customers')}
      ${tab('visitors', 'Website Visitor Analysis')}
      ${tab('rejected', 'Rejected')}
    </div>`;
  },

  async renderOnlineOrders(el) {
    const currency = this.settings?.currency || 'R';
    const from = this._ooFrom || Utils.daysAgo(30);
    const to = this._ooTo || Utils.today();
    const ooTab = this._ooTab === 'all' ? 'orders' : (this._ooTab || 'orders');
    if (ooTab === 'visitors') {
      if (typeof this.renderWebsiteVisitorAnalysis !== 'function') {
        try { await window.App?.ensurePageScripts?.('admin'); } catch (_) { /* */ }
      }
      if (typeof this.renderWebsiteVisitorAnalysis === 'function') return this.renderWebsiteVisitorAnalysis(el);
    }
    if (ooTab === 'customers') {
      if (typeof this.renderOnlineCustomers !== 'function') {
        try { await window.App?.ensurePageScripts?.('admin'); } catch (_) { /* */ }
      }
      if (typeof this.renderOnlineCustomers === 'function') return this.renderOnlineCustomers(el);
    }
    const [ordersRes, analyticsRes, settingsRes, rejectedRes] = await Promise.all([
      API.webAdminOrders?.({ from, to }, this.app?.user) || API.getOnlineOrdersLocal?.(''),
      API.webAdminAnalytics?.({ from, to }, this.app?.user).catch(() => ({ data: {} })),
      API.webGetSettings?.().catch(() => ({ data: {} })),
      API.webRejectedOrdersReport?.({ from, to }, this.app?.user).catch(() => ({ data: {} }))
    ]);
    const orders = ordersRes?.data || ordersRes || [];
    const list = Array.isArray(orders) ? orders : [];
    const canManageOrders = ['owner', 'manager'].includes(this.app?.user?.role);
    const refreshOrders = () => this.renderOnlineOrders(el);
    const stats = analyticsRes?.data || analyticsRes || {};
    const rejectedReport = rejectedRes?.data || rejectedRes || {};
    const global = settingsRes?.data || settingsRes || {};
    const cloudBase = (window.__SHOP_POS_ENV__?.RPC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_RPC_URL || window.location.origin || '')
      .replace(/\/rpc\/?$/i, '') || '';
    const orderUrl = `${cloudBase.replace(/\/$/, '')}/order/`;

    el.innerHTML = `<div class="admin-section"><h3>Online Orders</h3>
      <p class="muted">Customer website orders flow to POS with source <strong>ONLINE</strong>. 
        <a href="${orderUrl}" target="_blank" rel="noopener">Open customer site</a></p>
      ${this.onlineOrdersTabsHtml ? this.onlineOrdersTabsHtml(ooTab) : ''}
      <div class="page-toolbar" style="gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0">
        <input type="date" id="oo-from" value="${from}">
        <input type="date" id="oo-to" value="${to}">
        <button type="button" class="btn btn-ghost btn-sm" id="oo-filter">Filter</button>
        <button type="button" class="btn btn-primary btn-sm" id="oo-pdf">Save PDF</button>
        <button type="button" class="btn btn-ghost btn-sm" id="oo-print">Print</button>
      </div>
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:12px 0">
        <div class="card"><div class="card-body"><div class="muted">Orders</div><strong>${stats.orders || 0}</strong></div></div>
        <div class="card"><div class="card-body"><div class="muted">Revenue</div><strong>${Utils.formatMoney(stats.revenue || 0, currency)}</strong></div></div>
        <div class="card"><div class="card-body"><div class="muted">Rejected</div><strong>${stats.rejected || 0}</strong></div></div>
      </div>
      ${ooTab === 'rejected' ? `<div class="card" style="margin:12px 0"><div class="card-body">
        <h4 style="margin-top:0">Rejected by cashier</h4>
        <table class="table"><tr><th>Cashier</th><th>Count</th><th>Value</th><th>Top reasons</th></tr>
        ${(rejectedReport.by_cashier || []).map(c => `<tr><td>${Utils.escHtml(c.cashier)}</td><td>${c.count}</td><td>${Utils.formatMoney(c.total, currency)}</td><td>${Object.entries(c.reasons || {}).slice(0, 3).map(([r, n]) => `${Utils.escHtml(r)} (${n})`).join(', ') || '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No rejections in this period</td></tr>'}
        </table>
        <h4>Weekly totals</h4>
        <table class="table"><tr><th>Week starting</th><th>Rejected</th><th>Value</th></tr>
        ${(rejectedReport.by_week || []).map(w => `<tr><td>${w.week_start}</td><td>${w.count}</td><td>${Utils.formatMoney(w.total, currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}
        </table>
        <h4>Rejected orders</h4>
        <div class="table-wrap"><table class="table"><tr><th>Order</th><th>Cashier</th><th>Reason</th><th>Total</th><th>Date</th></tr>
        ${(rejectedReport.orders || []).slice(0, 50).map(o => `<tr><td>${Utils.escHtml(o.order_number)}</td><td>${Utils.escHtml(o.rejected_by_name || o.rejected_by_username || '—')}</td><td>${Utils.escHtml(o.reject_reason || '—')}</td><td>${Utils.formatMoney(o.total, currency)}</td><td>${Utils.formatDateTime(o.rejected_at || o.updated_at || o.created_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None</td></tr>'}
        </table></div></div></div>` : ''}
      <div class="card"><div class="card-body">
        <h4 style="margin-top:0">Settings</h4>
        <label><input type="checkbox" id="oo-enabled" ${global.online?.enabled !== false ? 'checked' : ''}> Enable online orders</label><br>
        <label><input type="checkbox" id="oo-coupons" ${global.online?.coupons_enabled !== false ? 'checked' : ''}> Coupons</label>
        <label style="margin-left:12px"><input type="checkbox" id="oo-loyalty" ${global.online?.loyalty_enabled !== false ? 'checked' : ''}> Loyalty points</label>
        <label style="margin-left:12px"><input type="checkbox" id="oo-giftcards" ${global.online?.gift_cards_enabled !== false ? 'checked' : ''}> Gift cards</label>
        <label style="margin-left:12px"><input type="checkbox" id="oo-reviews" ${global.online?.reviews_enabled !== false ? 'checked' : ''}> Reviews</label>
        <label style="margin-left:12px"><input type="checkbox" id="oo-scheduled" ${global.online?.scheduled_enabled !== false ? 'checked' : ''}> Scheduled orders</label>
        <div class="field" style="margin-top:12px">
          <label>POS reminder if order not attended (minutes)</label>
          <input type="number" id="oo-reminder-min" min="1" max="60" value="${Number(global.online?.pos_reminder_minutes) || 2}" style="max-width:120px">
          <p class="muted" style="font-size:12px;margin:4px 0 0">POS will alert cashiers after this many minutes on pending online orders.</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="oo-save-settings" style="margin-top:8px">Save settings</button>
        <button type="button" class="btn btn-ghost btn-sm" id="oo-open-loyalty" style="margin-top:8px;margin-left:8px">Loyalty & Gift Cards</button>
      </div></div>
      <div class="table-wrap" style="margin-top:16px"><table class="table">
        <thead><tr><th>Order</th><th>Branch</th><th>Customer</th><th>Total</th><th>Discount / Loyalty</th><th>Gift Card</th><th>Status</th><th>Source</th><th></th></tr></thead>
        <tbody>${(ooTab === 'rejected' ? (rejectedReport.orders || []) : list).slice(0, 100).map((o) => `<tr>
          <td>${Utils.escHtml(o.order_number)}</td>
          <td>${Utils.escHtml(String(o.branch_id))}</td>
          <td>${Utils.escHtml(o.customer_name || '—')}${o.customer_phone ? `<br><small class="muted">${Utils.escHtml(o.customer_phone)}</small>` : ''}</td>
          <td>${Utils.formatMoney(o.total, currency)}</td>
          <td>${this.formatOnlineOrderSavings(o, currency)}</td>
          <td>${this.formatOnlineOrderGiftCard(o, currency)}</td>
          <td><span class="tag">${Utils.escHtml(o.status)}</span></td>
          <td>${Utils.escHtml(o.order_source || 'ONLINE')}</td>
          <td style="white-space:nowrap">
            <button type="button" class="btn btn-sm btn-ghost oo-view" data-id="${o.id}">View</button>
            ${canManageOrders ? `<button type="button" class="btn btn-sm btn-ghost oo-edit" data-id="${o.id}">Edit</button>` : ''}
            ${o.status === 'pending' ? `<button type="button" class="btn btn-sm btn-primary oo-accept" data-id="${o.id}">Accept</button>` : ''}
            ${canManageOrders ? `<button type="button" class="btn btn-sm btn-danger oo-delete" data-id="${o.id}" data-sale="${o.sale_id || ''}">Delete</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">No online orders yet</td></tr>'}
        </tbody></table></div></div>`;

    el.querySelectorAll('[data-oo-tab]').forEach(btn => btn.addEventListener('click', () => {
      this._ooTab = btn.dataset.ooTab;
      this.renderOnlineOrders(el);
    }));
    document.getElementById('oo-filter')?.addEventListener('click', () => {
      this._ooFrom = document.getElementById('oo-from')?.value;
      this._ooTo = document.getElementById('oo-to')?.value;
      this.renderOnlineOrders(el);
    });
    document.getElementById('oo-pdf')?.addEventListener('click', async () => {
      const headers = ['Order', 'Branch', 'Customer', 'Phone', 'Total', 'Discount/Loyalty', 'Gift Card', 'Tax', 'Status', 'Payment', 'Date'];
      const rows = list.map((o) => [
        o.order_number || '',
        String(o.branch_id || ''),
        o.customer_name || '',
        o.customer_phone || '',
        Utils.formatMoney(o.total, currency),
        [o.discount ? `-${Utils.formatMoney(o.discount, currency)}` : '', o.loyalty_points_used ? `${o.loyalty_points_used} pts` : ''].filter(Boolean).join(' · ') || '',
        o.gift_card_code ? `${o.gift_card_code} (-${Utils.formatMoney(o.gift_card_amount || 0, currency)})` : '',
        o.tax_amount ? Utils.formatMoney(o.tax_amount, currency) : '',
        o.status || '',
        o.payment_method || '',
        Utils.formatDateTime(o.created_at)
      ]);
      rows.push(['TOTALS', '', '', '', Utils.formatMoney(list.reduce((n, o) => n + Number(o.total || 0), 0), currency), '', '', `${list.length} orders`, '', '']);
      const title = `Online Orders ${from} to ${to}`;
      if (typeof Export?.toPDF === 'function') {
        await Export.toPDF(`online-orders-${from}.pdf`, title, headers, rows, { shop_name: this.settings?.shop_name, logo_path: this.settings?.logo_path });
      } else {
        Utils.toast('PDF export not available', 'error');
      }
    });
    document.getElementById('oo-print')?.addEventListener('click', () => {
      const html = `<h2>${this.settings?.shop_name || 'Shop'} — Online Orders</h2>
        <p>${from} to ${to} · ${list.length} orders · Revenue ${Utils.formatMoney(list.reduce((n, o) => n + Number(o.total || 0), 0), currency)}</p>
        <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px">
        <tr><th>Order</th><th>Customer</th><th>Total</th><th>Discount/Loyalty</th><th>Gift Card</th><th>Status</th><th>Date</th></tr>
        ${list.map((o) => `<tr><td>${Utils.escHtml(o.order_number)}</td><td>${Utils.escHtml(o.customer_name || '')}</td><td>${Utils.formatMoney(o.total, currency)}</td><td>${this.formatOnlineOrderSavings(o, currency)}</td><td>${this.formatOnlineOrderGiftCard(o, currency)}</td><td>${Utils.escHtml(o.status)}</td><td>${Utils.formatDateTime(o.created_at)}</td></tr>`).join('')}
        </table>`;
      if (typeof Export?.print === 'function') Export.print(html, 'Online Orders');
      else window.print();
    });
    document.getElementById('oo-save-settings')?.addEventListener('click', async () => {
      const r = await this.saveWebGlobalSettings({
        enabled: document.getElementById('oo-enabled').checked,
        coupons_enabled: document.getElementById('oo-coupons').checked,
        loyalty_enabled: document.getElementById('oo-loyalty').checked,
        gift_cards_enabled: document.getElementById('oo-giftcards').checked,
        reviews_enabled: document.getElementById('oo-reviews').checked,
        scheduled_enabled: document.getElementById('oo-scheduled').checked,
        pos_reminder_minutes: Math.max(1, parseInt(document.getElementById('oo-reminder-min')?.value, 10) || 2)
      });
      if (!r) return;
      Utils.toast('Online settings saved', 'success');
    });
    document.getElementById('oo-open-loyalty')?.addEventListener('click', () => {
      this._loyaltyTab = 'online';
      this.section = 'loyalty';
      document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === 'loyalty'));
      this.renderSection(document.getElementById('admin-content'));
    });
    el.querySelectorAll('.oo-accept').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await API.acceptOnlineOrderAsSale(parseInt(btn.dataset.id, 10), {}, this.app?.user);
        if (r?.success === false) return Utils.toast(r.error, 'error');
        Utils.toast('Order accepted into POS', 'success');
        this.renderOnlineOrders(el);
      });
    });
    el.querySelectorAll('.oo-view').forEach((btn) => {
      btn.addEventListener('click', () => this.showOnlineOrderDetail(parseInt(btn.dataset.id, 10), refreshOrders));
    });
    el.querySelectorAll('.oo-edit').forEach((btn) => {
      btn.addEventListener('click', () => this.showOnlineOrderEdit(parseInt(btn.dataset.id, 10), refreshOrders));
    });
    el.querySelectorAll('.oo-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const orderId = parseInt(btn.dataset.id, 10);
        Utils.showModal('Delete online order', '<p>This permanently removes the order. Loyalty and gift card balances are restored if applicable.</p><div class="field"><label>Reason (required)</label><textarea id="oo-del-reason" rows="3"></textarea></div>',
          '<button type="button" class="btn btn-danger" id="oo-del-confirm">Delete permanently</button>');
        document.getElementById('oo-del-confirm')?.addEventListener('click', async () => {
          const reason = document.getElementById('oo-del-reason')?.value.trim();
          if (!reason) return Utils.toast('Reason required', 'error');
          const r = await API.webAdminDeleteOrder?.(orderId, reason, this.app?.user);
          if (r?.success === false || r?.error) return Utils.toast(r?.error || 'Delete failed', 'error');
          Utils.hideModal();
          Utils.toast('Order deleted', 'success');
          refreshOrders();
        });
      });
    });
  },

  async renderMobileAppUsers(el) {
    const [usersRes, branchesRes] = await Promise.all([
      API.mobileAdminListUsers?.(this.app?.user).catch(() => []),
      API.getBranches?.().catch(() => ({ data: [] }))
    ]);
    const users = usersRes?.data || usersRes || [];
    const list = Array.isArray(users) ? users : [];
    const branches = branchesRes?.data || branchesRes || [];
    const cloudBase = (window.__SHOP_POS_ENV__?.RPC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_RPC_URL || window.location.origin || '')
      .replace(/\/rpc\/?$/i, '') || '';
    const managerUrl = `${cloudBase.replace(/\/$/, '')}/manager/`;

    el.innerHTML = `<div class="admin-section"><h3>Mobile App Users</h3>
      <p class="muted">Create accounts for owners/managers to monitor sales & orders on the 
        <a href="${managerUrl}" target="_blank" rel="noopener">Business Manager app</a>. Permissions are enforced server-side.</p>
      <div class="admin-quick-actions" style="margin:12px 0">
        <button type="button" class="btn btn-primary" id="ma-open-manager">Open Business Manager</button>
        <button type="button" class="btn btn-ghost" id="ma-new-user">+ Create mobile user</button>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Branches</th><th>Last login</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map((u) => `<tr>
          <td>${Utils.escHtml(u.full_name)}</td>
          <td>${Utils.escHtml(u.username)}</td>
          <td>${Utils.escHtml(u.role)}</td>
          <td>${u.all_branches ? 'All' : 'Selected'}</td>
          <td class="muted">${Utils.escHtml(String(u.last_login_at || '—').slice(0, 16))}</td>
          <td><span class="tag ${u.is_active ? 'tag-ok' : 'tag-warn'}">${u.is_active ? 'Active' : 'Disabled'}</span></td>
          <td>
            <button type="button" class="btn btn-ghost btn-sm ma-edit" data-id="${u.id}">Edit</button>
            <button type="button" class="btn btn-ghost btn-sm ma-devices" data-id="${u.id}">Devices</button>
            <button type="button" class="btn btn-ghost btn-sm ma-toggle" data-id="${u.id}" data-active="${u.is_active ? '1' : '0'}">${u.is_active ? 'Disable' : 'Enable'}</button>
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No mobile users yet — create one above</td></tr>'}
        </tbody></table></div>
      <div id="ma-form-host"></div></div>`;

    const showForm = async (userId) => {
      const host = document.getElementById('ma-form-host');
      let u = { role: 'branch_manager', all_branches: 0, branch_ids: [], permissions: {}, is_active: true };
      if (userId) {
        const r = await API.mobileAdminGetUser?.(userId, this.app?.user);
        u = r?.data || r || u;
      }
      const branchChecks = (Array.isArray(branches) ? branches : []).map((b) =>
        `<label style="display:block"><input type="checkbox" class="ma-branch" value="${b.id}" ${u.all_branches || (u.branch_ids || []).includes(b.id) ? 'checked' : ''}> ${Utils.escHtml(b.name)}</label>`).join('');
      host.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>${userId ? 'Edit' : 'Create'} mobile user</h4>
        <div class="form-grid" style="display:grid;gap:10px;max-width:480px">
          <label>Full name<input id="ma-name" value="${Utils.escHtml(u.full_name || '')}"></label>
          <label>Username<input id="ma-username" value="${Utils.escHtml(u.username || '')}" ${userId ? 'readonly' : ''}></label>
          <label>${userId ? 'New password (optional)' : 'Password'}<input type="password" id="ma-pass"></label>
          <label>Role<select id="ma-role">
            <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
            <option value="business_admin" ${u.role === 'business_admin' ? 'selected' : ''}>Business Admin</option>
            <option value="branch_manager" ${u.role === 'branch_manager' ? 'selected' : ''}>Branch Manager</option>
            <option value="custom" ${u.role === 'custom' ? 'selected' : ''}>Custom</option>
          </select></label>
          <label><input type="checkbox" id="ma-all-branches" ${u.all_branches ? 'checked' : ''}> All branches</label>
          <div id="ma-branch-list">${branchChecks}</div>
          <fieldset><legend>Permissions</legend>
            ${['view_orders', 'view_sales', 'receive_order_notifications', 'view_staff_activity', 'manage_orders'].map((p) =>
              `<label><input type="checkbox" class="ma-perm" data-p="${p}" ${u.permissions?.[p] !== false ? 'checked' : ''}> ${p.replace(/_/g, ' ')}</label>`).join('<br>')}
          </fieldset>
          <button type="button" class="btn btn-primary" id="ma-save">Save user</button>
          <button type="button" class="btn btn-ghost" id="ma-cancel">Cancel</button>
        </div></div></div>`;
      document.getElementById('ma-all-branches')?.addEventListener('change', (e) => {
        document.getElementById('ma-branch-list').style.opacity = e.target.checked ? '0.5' : '1';
      });
      document.getElementById('ma-cancel')?.addEventListener('click', () => { host.innerHTML = ''; });
      document.getElementById('ma-save')?.addEventListener('click', async () => {
        const perms = {};
        document.querySelectorAll('.ma-perm').forEach((cb) => { perms[cb.dataset.p] = cb.checked; });
        const data = {
          id: userId || undefined,
          full_name: document.getElementById('ma-name').value.trim(),
          username: document.getElementById('ma-username').value.trim(),
          password: document.getElementById('ma-pass').value,
          role: document.getElementById('ma-role').value,
          all_branches: document.getElementById('ma-all-branches').checked,
          branch_ids: [...document.querySelectorAll('.ma-branch:checked')].map((c) => Number(c.value)),
          permissions: perms,
          is_active: true
        };
        const r = await API.mobileAdminSaveUser?.(data, this.app?.user);
        if (r?.success === false) return Utils.toast(r.error, 'error');
        Utils.toast('Mobile user saved', 'success');
        this.renderMobileAppUsers(el);
      });
    };

    document.getElementById('ma-new-user')?.addEventListener('click', () => showForm(null));
    document.getElementById('ma-open-manager')?.addEventListener('click', () => {
      this.app?.openBusinessManager?.({ embed: true });
    });
    el.querySelectorAll('.ma-edit').forEach((btn) => btn.addEventListener('click', () => showForm(Number(btn.dataset.id))));
    el.querySelectorAll('.ma-toggle').forEach((btn) => btn.addEventListener('click', async () => {
      const active = btn.dataset.active !== '1';
      const r = await API.mobileAdminSetActive?.(Number(btn.dataset.id), active, this.app?.user);
      if (r?.success === false) return Utils.toast(r.error, 'error');
      Utils.toast(active ? 'User enabled' : 'User disabled', 'success');
      this.renderMobileAppUsers(el);
    }));
    el.querySelectorAll('.ma-devices').forEach((btn) => btn.addEventListener('click', async () => {
      const devices = await API.mobileAdminListDevices?.(Number(btn.dataset.id), this.app?.user);
      const rows = (devices?.data || devices || []).map((d) =>
        `<tr><td>${Utils.escHtml(d.device_name)}</td><td>${Utils.escHtml(d.platform)}</td>
          <td>${Utils.escHtml(String(d.last_active_at || '').slice(0, 16))}</td>
          <td>${Utils.escHtml(d.status)}</td>
          <td>${d.status === 'active' ? `<button type="button" class="btn btn-sm btn-danger ma-revoke" data-did="${d.id}">Revoke</button>` : ''}</td></tr>`).join('');
      Utils.showModal('Authorized devices', `<table class="table"><thead><tr><th>Device</th><th>Platform</th><th>Last active</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">No devices</td></tr>'}</tbody></table>`, '');
      document.querySelectorAll('.ma-revoke').forEach((b) => b.addEventListener('click', async () => {
        await API.mobileAdminRevokeDevice?.(Number(b.dataset.did), this.app?.user);
        Utils.forceHideModal?.();
        Utils.toast('Device revoked', 'success');
      }));
    }));
  },

  async renderBusinessManager(el) {
    el.innerHTML = `<div class="admin-section admin-manager-embed"><p class="muted">Loading Business Manager…</p></div>`;
    let url = this._managerUrl;
    if (!url) {
      try {
        url = await this.app?.getBusinessManagerUrl?.();
        this._managerUrl = url;
      } catch (err) {
        el.innerHTML = `<div class="admin-section">
          <h3>Business Manager</h3>
          <p class="muted" style="color:var(--danger)">${Utils.escHtml(err.message || 'Could not open Business Manager')}</p>
          <button type="button" class="btn btn-primary" id="bm-retry">Try again</button>
        </div>`;
        document.getElementById('bm-retry')?.addEventListener('click', () => {
          this._managerUrl = null;
          this.renderBusinessManager(el);
        });
        return;
      }
    }
    const who = Utils.escHtml(this.app?.user?.full_name || this.app?.user?.username || 'Admin');
    el.innerHTML = `<div class="admin-manager-embed">
      <div class="admin-manager-embed-bar">
        <button type="button" class="btn btn-ghost btn-sm" id="bm-back-mobile">← Mobile App Users</button>
        <span class="muted">Signed in as ${who} — no extra password needed</span>
        <button type="button" class="btn btn-ghost btn-sm" id="bm-open-tab">Open in new tab</button>
      </div>
      <iframe id="admin-manager-frame" src="${url}" title="Business Manager" allow="notifications"></iframe>
    </div>`;
    document.getElementById('bm-back-mobile')?.addEventListener('click', () => {
      this.section = 'mobile-app';
      this.renderSection(el);
    });
    document.getElementById('bm-open-tab')?.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));
  },

  async renderHrApprovals(el) {
    el.innerHTML = `<div class="admin-section"><h3>HR Approvals</h3><p class="muted">Loading…</p></div>`;
    const actor = this.app?.user;
    const res = await API.hrApprovals?.({}, actor);
    const items = res?.success === false ? [] : (Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : (res?.data || [])));
    if (res?.success === false) {
      el.innerHTML = `<div class="admin-section"><h3>HR Approvals</h3><p class="muted" style="color:var(--danger)">${Utils.escHtml(res.error || 'Failed to load')}</p></div>`;
      return;
    }
    const currency = this.settings?.currency || this.app?.settings?.currency || 'R';
    el.innerHTML = `<div class="admin-section">
      <div class="page-toolbar" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <h3 style="margin:0">HR Approvals</h3>
          <p class="muted" style="margin:4px 0 0">Approve what HR submitted. Also review staff salary claims before payment.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" id="hra-refresh">Refresh</button>
          <button type="button" class="btn btn-ghost btn-sm" id="hra-open-hr">Open HR Workspace</button>
          <button type="button" class="btn btn-ghost btn-sm" id="hra-open-payroll">Payroll Claims</button>
        </div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Type</th><th>Title</th><th>Employee</th><th>Date</th><th>Status</th><th>Amount</th><th></th></tr></thead>
      <tbody>${(items || []).map((a) => {
        let actions = '';
        if (a.type === 'leave' && a.status === 'pending') {
          actions = `<button class="btn btn-sm btn-primary hra-leave-ok" data-id="${a.id}">Approve</button>
            <button class="btn btn-sm btn-ghost hra-leave-no" data-id="${a.id}">Reject</button>`;
        } else if (a.type === 'hr_action' || a.type === 'request') {
          actions = `<button class="btn btn-sm btn-primary hra-req-ok" data-id="${a.id}">Approve &amp; apply</button>
            <button class="btn btn-sm btn-ghost hra-req-no" data-id="${a.id}">Reject</button>`;
        } else if (a.type === 'payroll' && a.status === 'pending') {
          actions = `<button class="btn btn-sm btn-primary hra-pay" data-id="${a.id}">Mark paid</button>`;
        } else if (a.type === 'salary_claim') {
          actions = `<button class="btn btn-sm btn-primary hra-claim-ok" data-id="${a.id}">Approve claim</button>
            <button class="btn btn-sm btn-ghost hra-claim-no" data-id="${a.id}">Reject</button>`;
        } else if (a.type === 'recruitment') {
          actions = `<button class="btn btn-sm btn-primary hra-recruit-ok" data-id="${a.id}">Approve hire</button>
            <button class="btn btn-sm btn-ghost hra-recruit-no" data-id="${a.id}">Reject</button>`;
        }
        return `<tr>
          <td>${Utils.escHtml(a.type)}${a.request_type ? ` / ${Utils.escHtml(a.request_type)}` : ''}</td>
          <td>${Utils.escHtml(a.title || '')}</td>
          <td>${Utils.escHtml(a.employee || '—')}</td>
          <td>${Utils.escHtml(String(a.date || '').slice(0, 19))}</td>
          <td><span class="tag">${Utils.escHtml(a.status || '')}</span></td>
          <td>${a.amount != null ? Utils.formatMoney(a.amount, currency) : '—'}</td>
          <td class="actions" style="display:flex;gap:4px;flex-wrap:wrap">${actions}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">Nothing waiting for approval</td></tr>'}</tbody></table></div>
    </div>`;

    const reload = () => this.renderHrApprovals(el);
    document.getElementById('hra-refresh')?.addEventListener('click', reload);
    document.getElementById('hra-open-hr')?.addEventListener('click', () => this.app?.openHr?.({ fromApp: true }));
    document.getElementById('hra-open-payroll')?.addEventListener('click', () => {
      this.section = 'payroll';
      this.renderSection(document.getElementById('admin-content'));
    });
    el.querySelectorAll('.hra-leave-ok').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.approveStaffLeave(parseInt(b.dataset.id, 10), actor, true);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Leave approved', 'success'); reload();
    }));
    el.querySelectorAll('.hra-leave-no').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.approveStaffLeave(parseInt(b.dataset.id, 10), actor, false);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Leave rejected', 'info'); reload();
    }));
    el.querySelectorAll('.hra-req-ok').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.hrDecideRequest(parseInt(b.dataset.id, 10), 'approved', '', actor);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Approved and applied', 'success'); reload();
    }));
    el.querySelectorAll('.hra-req-no').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.hrDecideRequest(parseInt(b.dataset.id, 10), 'rejected', 'Rejected by admin', actor);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Rejected', 'info'); reload();
    }));
    el.querySelectorAll('.hra-pay').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.payStaffSalary(parseInt(b.dataset.id, 10), 'eft', actor);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Payroll marked paid', 'success'); reload();
    }));
    el.querySelectorAll('.hra-claim-ok').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.approveSalaryClaim(parseInt(b.dataset.id, 10), '', actor);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Salary claim approved', 'success'); reload();
    }));
    el.querySelectorAll('.hra-claim-no').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.rejectSalaryClaim(parseInt(b.dataset.id, 10), 'Rejected', actor);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Claim rejected', 'info'); reload();
    }));
    el.querySelectorAll('.hra-recruit-ok').forEach((b) => b.addEventListener('click', async () => {
      const r = await API.decideJobCandidate(parseInt(b.dataset.id, 10), 'approved', '', actor);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Candidate approved for employment', 'success'); reload();
    }));
    el.querySelectorAll('.hra-recruit-no').forEach((b) => b.addEventListener('click', async () => {
      const notes = prompt('Rejection notes (optional):') || '';
      const r = await API.decideJobCandidate(parseInt(b.dataset.id, 10), 'rejected', notes, actor);
      if (r?.success === false) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Candidate rejected', 'info'); reload();
    }));
  }
};
window.AdminPage = AdminPage;
