const POSPage = {
  cart: [],
  discount: 0,
  discountApprover: null,
  discountManagerPin: null,
  selectedCategory: null,
  products: [],
  combos: [],
  categories: [],
  lastSale: null,
  selectedCustomer: null,
  openShift: null,
  shiftSettings: null,
  salesTargets: null,
  scanMode: false,
  quoteTab: 'current',
  quoteSearch: '',
  savedQuotes: [],
  loadedQuoteId: null,
  selectedTable: null,
  orderType: null,

  activeDailyTargetAmount() {
    const d = this.salesTargets?.daily;
    if (d != null && typeof d === 'object') return d.active !== false ? (Number(d.amount) || 0) : 0;
    return Number(d) || 0;
  },

  topSellerPeriod: 'today',

  async render(el, app) {
    this.app = app;
    this._host = el;
    const pendingQuote = app.pendingQuote;
    app.pendingQuote = null;
    // Only reset cart on a true first mount / explicit new sale flow — not on keep-alive revisit
    if (!this._posMounted) {
      this.cart = [];
      this.discount = 0;
      this._posMounted = true;
    }
    this.app.settings = {
      ...this.app.settings,
      device_settings: Utils.mergeDeviceSettings(this.app.settings)
    };
    const branchId = app.user?.branch_id || undefined;
    const isKiosk = !!(window.__SHOP_POS_APP_MODE__ === 'pos' || app.isPosKiosk?.());

    this.shiftSettings = app.settings?.shift_settings || this.shiftSettings || {
      required_roles: ['cashier', 'manager', 'assistant_manager', 'owner']
    };

    // Paint till immediately — never block on "Checking your shift…"
    this.categories = this.categories || [];
    this.products = this.products || [];
    this.combos = this.combos || [];
    this.salesTargets = this.salesTargets || { daily: { amount: 0, active: false } };
    this.activeCampaigns = this.activeCampaigns || [];
    this.renderLayout(el);
    this.bindEvents(el);
    this._stockRefreshHandler = () => this.reloadCatalog?.();
    window.addEventListener('shop-pos-stock-updated', this._stockRefreshHandler);
    if (isKiosk) this.ensureKioskLogout(el);

    const filters = { for_pos: true, actor: app.user };
    const shiftP = Promise.all([
      API.getShiftSettings().catch(() => ({ success: false })),
      API.getOpenShift(app.user).catch(() => ({ success: false, data: null }))
    ]);
    const catalogP = Promise.all([
      API.getCategories(filters),
      API.getProducts(filters)
    ]);

    const [[shiftSettingsRes, shiftRes], [catRes, prodRes]] = await Promise.all([shiftP, catalogP]);
    if (shiftSettingsRes.success) {
      this.shiftSettings = shiftSettingsRes.data || this.shiftSettings;
    }
    this.openShift = shiftRes?.data || null;
    this.categories = catRes.data || [];
    this.products = prodRes.data || [];
    this.rebuildProductLookups();

    // Refresh product grid with real catalog
    const tabs = document.getElementById('pos-categories');
    if (tabs) {
      tabs.innerHTML = `
        <button class="cat-tab active" data-cat="">All</button>
        <button class="cat-tab" data-cat="__available_today" style="border-color:#2dd4bf">Available Today</button>
        <button class="cat-tab" data-cat="__new_arrival" style="border-color:#38bdf8">New Arrival</button>
        <button class="cat-tab" data-cat="__best_seller" style="border-color:#fbbf24">Best Seller</button>
        ${this.categories.map(c => `<button class="cat-tab" data-cat="${c.id}" style="border-color:${c.color}">
          ${c.image_path ? `<img ${Utils.cachedImageAttr(c.image_path)} class="cat-tab-img" alt="">` : ''}${c.name}</button>`).join('')}`;
    }
    this.renderProducts(document.getElementById('pos-search')?.value || '');
    this.renderCart?.();

    setTimeout(() => {
      API.enforceCashoutDeadlines().then(async (enforced) => {
        if (enforced.success && enforced.data?.closed > 0) {
          const refreshed = await API.getOpenShift(app.user);
          this.openShift = refreshed.data || null;
          Utils.toast(`Auto-closed ${enforced.data.closed} shift(s) past cash-out deadline`, 'info');
          this.updateShiftGate();
        }
      }).catch(() => {});
    }, 0);

    this._shiftFlowComplete = false;
    if (this.requiresShift()) {
      if (this.openShift) {
        await this.promptResumeShift();
      } else {
        await this.ensureShift();
      }
    }
    this._shiftFlowComplete = true;
    this.updateShiftGate();
    this._startOnlineOrdersWidget();

    // Secondary data — don't block selling
    Promise.all([
      API.getActiveCombos(branchId ? { branch_id: branchId } : {}).catch(() => ({ success: false, data: [] })),
      API.getSalesTargets().catch(() => ({ success: false })),
      API.getActiveCampaigns(app.user?.branch_id).catch(() => ({ success: false }))
    ]).then(([comboRes, targetsRes, campRes]) => {
      this.combos = comboRes.data || [];
      this.salesTargets = targetsRes.success ? (targetsRes.data || { daily: { amount: 0, active: false } }) : { daily: { amount: 0, active: false } };
      this.activeCampaigns = campRes.success ? (campRes.data || []) : [];
      const catTabs = document.getElementById('pos-categories');
      if (catTabs && this.combos.length && !catTabs.querySelector('[data-cat="combos"]')) {
        const best = catTabs.querySelector('[data-cat="__best_seller"]');
        best?.insertAdjacentHTML('afterend', '<button class="cat-tab" data-cat="combos" style="border-color:#e11d48">🎁 COMBOS</button>');
      }
    });

    if (pendingQuote?.status === 'open' && pendingQuote.items?.length) {
      this.loadQuoteIntoCart(pendingQuote);
      Utils.toast(`Quote ${pendingQuote.quote_number} loaded into cart`, 'success');
    }
    const ds = Utils.mergeDeviceSettings(this.app.settings);
    const ss = this.app.settings?.scanner_settings || {};
    const scanEnabled = ss.enabled !== false;
    if (scanEnabled && ds.scanner_auto_mode !== false) this.toggleScanMode(true);
    if (ss.type === 'camera') this._preferCameraScan = true;
    await this.updateShiftBar();
  },

  _shiftFlowComplete: false,

  canShowOnlineOrders() {
    if (!this._shiftFlowComplete) return false;
    if (this.requiresShift() && !this.hasOpenShift()) return false;
    const overlay = document.getElementById('modal-overlay');
    if (overlay && !overlay.classList.contains('hidden') && overlay.dataset.noDismiss === '1') return false;
    return true;
  },

  _startOnlineOrdersWidget() {
    if (!this.canShowOnlineOrders()) return;
    this.app?.ensureFeatureScript?.('js/online-orders-widget.js').then(() => {
      if (!this.canShowOnlineOrders()) return;
      window.OnlineOrdersWidget?.bind?.(this.app);
      window.OnlineOrdersWidget?.startPolling?.();
    }).catch(() => {});
  },

  _syncOnlineOrdersWidget() {
    if (this.canShowOnlineOrders()) {
      window.OnlineOrdersWidget?.startPolling?.();
    } else {
      window.OnlineOrdersWidget?.stopPolling?.();
    }
  },

  async openOnlineOrdersPanel(tab = 'pending') {
    if (!this.canShowOnlineOrders()) {
      Utils.toast('Open your shift first — online orders come after that', 'error');
      await this.ensureShift();
      if (!this.canShowOnlineOrders()) return;
    }
    try {
      await this.app?.ensureFeatureScript?.('js/online-orders-widget.js');
      window.OnlineOrdersWidget?.bind?.(this.app);
      await window.OnlineOrdersWidget?.openPanel?.(tab);
    } catch (err) {
      Utils.toast(err?.message || 'Could not open online orders', 'error');
    }
  },

  ensureKioskLogout(el) {
    if (window.__SHOP_POS_APP_MODE__ !== 'pos') return;
    const bar = el.querySelector('.pos-toolbar') || el.querySelector('#pos-shift-bar');
    if (!bar || el.querySelector('#pos-kiosk-logout')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pos-kiosk-logout';
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Logout';
    btn.title = 'Sign out';
    btn.addEventListener('click', () => this.app?.logout?.());
    (el.querySelector('.pos-toolbar') || bar).appendChild(btn);
  },

  /** Keep-alive revisit: preserve cart, refresh catalog/shift in background. */
  async activate(el, app) {
    this.app = app;
    this._host = el;
    try {
      const [catRes, prodRes, shiftRes] = await Promise.all([
        API.getCategories({ for_pos: true }),
        API.getProducts({ for_pos: true }),
        API.getOpenShift(app.user)
      ]);
      this.categories = catRes.data || [];
      this.products = prodRes.data || [];
      this.openShift = shiftRes.data || null;
      this.rebuildProductLookups();
      this.renderProducts(document.getElementById('pos-search')?.value || '');
      this.updateShiftGate?.();
      if (typeof this.renderCart === 'function') this.renderCart();
      window.DataCache?.clearStaleBanner?.(el);
    } catch (err) {
      window.DataCache?.showStaleBanner?.(el, 'Unable to refresh. Showing last updated data.');
    }
  },

  requiresShift() {
    const roles = this.shiftSettings?.required_roles
      || this.app.settings?.shift_settings?.required_roles
      || ['cashier', 'manager', 'assistant_manager', 'owner'];
    return roles.includes(this.app.user?.role);
  },

  hasOpenShift() {
    return !!this.openShift;
  },

  requireShift(actionLabel) {
    if (!this.requiresShift() || this.hasOpenShift()) return true;
    Utils.toast(`Open your shift before ${actionLabel || 'using POS'}`, 'error');
    this.ensureShift();
    return false;
  },

  updateShiftGate() {
    const layout = document.querySelector('.pos-layout');
    if (layout) layout.classList.toggle('pos-shift-blocked', this.requiresShift() && !this.hasOpenShift());
    this._syncOnlineOrdersWidget();
  },

  async ensureShift() {
    if (!this.requiresShift() || this.openShift) return;
    if (document.getElementById('modal-overlay')?.dataset.noDismiss === '1') {
      // Wait until the existing blocking modal is dismissed
      await new Promise((resolve) => {
        const t = setInterval(() => {
          if (document.getElementById('modal-overlay')?.dataset.noDismiss !== '1') {
            clearInterval(t);
            resolve();
          }
        }, 200);
      });
      if (this.openShift) return;
    }
    const currency = this.app.settings?.currency || 'R';
    const dailyTarget = this.activeDailyTargetAmount();
    const targetLine = dailyTarget > 0
      ? `<p style="margin-top:8px;padding:8px;background:var(--bg-secondary);border-radius:8px"><strong>Today's sales target:</strong> ${Utils.formatMoney(dailyTarget, currency)}</p>`
      : '';
    await new Promise((resolve) => {
      Utils.showModal('Open Shift Required', `
        <p><strong>Your role requires an open shift before taking sales.</strong></p>
        <p class="muted">Enter the opening cash float in your drawer, then tap Open Shift to continue.</p>
        ${targetLine}
        <div class="field"><label>Opening Float (${currency})</label>
          <input type="number" id="pos-shift-float" step="0.01" min="0" value="0" autofocus></div>`,
        '<button class="btn btn-success" id="pos-open-shift">Open Shift & Start Selling</button>',
        { noDismiss: true });
      document.getElementById('pos-open-shift').addEventListener('click', async () => {
        const btn = document.getElementById('pos-open-shift');
        btn.disabled = true;
        btn.textContent = 'Opening…';
        const r = await API.openShift(parseFloat(document.getElementById('pos-shift-float').value) || 0, this.app.user);
        if (!r.success) {
          Utils.toast(r.error, 'error');
          btn.disabled = false;
          btn.textContent = 'Open Shift & Start Selling';
          return;
        }
        this.openShift = r.data;
        document.getElementById('modal-overlay').dataset.noDismiss = '0';
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) closeBtn.style.display = '';
        Utils.hideModal();
        Utils.toast('Shift opened — you can now take sales', 'success');
        this.updateShiftGate();
        this._startOnlineOrdersWidget();
        resolve();
      });
    });
  },

  async promptResumeShift() {
    if (!this.openShift || !this.requiresShift()) return;
    const currency = this.app.settings?.currency || 'R';
    let shiftSales = 0;
    let saleCount = 0;
    try {
      const preview = await API.getShiftClosePreview(this.openShift.id, this.app.user);
      if (preview.success) {
        shiftSales = preview.data?.shiftSales ?? preview.data?.totalSales ?? 0;
        saleCount = preview.data?.saleCount ?? 0;
      }
    } catch { /* optional */ }
    const salesLine = saleCount > 0
      ? `${Utils.formatMoney(shiftSales, currency)} (${saleCount} sale${saleCount === 1 ? '' : 's'})`
      : Utils.formatMoney(shiftSales, currency);

    const choice = await new Promise((resolve) => {
      Utils.showModal('Continue Your Shift?', `
        <p>You have an open shift from a previous session.</p>
        <p><strong>Opened:</strong> ${Utils.formatDateTime(this.openShift.opened_at)}</p>
        <p><strong>Opening float:</strong> ${Utils.formatMoney(this.openShift.opening_float, currency)}</p>
        <p><strong>Sales this shift:</strong> ${salesLine}</p>
        <p class="muted">Continue working this shift, or close it now if you are done for the day.</p>`,
        `<button class="btn btn-secondary" id="pos-close-resume-shift">Close Shift</button>
         <button class="btn btn-success" id="pos-continue-shift">Continue Shift</button>`,
        { noDismiss: true });
      document.getElementById('pos-continue-shift').addEventListener('click', () => {
        document.getElementById('modal-overlay').dataset.noDismiss = '0';
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) closeBtn.style.display = '';
        Utils.hideModal();
        this.updateShiftGate();
        this._startOnlineOrdersWidget();
        resolve('continue');
      });
      document.getElementById('pos-close-resume-shift').addEventListener('click', () => {
        document.getElementById('modal-overlay').dataset.noDismiss = '0';
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) closeBtn.style.display = '';
        Utils.hideModal();
        resolve('close');
      });
    });

    if (choice === 'close') {
      await this.showCashOut();
      try {
        const refreshed = await API.getOpenShift(this.app.user);
        this.openShift = refreshed.data || null;
      } catch (_) {
        this.openShift = null;
      }
      if (!this.openShift && this.requiresShift()) {
        await this.ensureShift();
      } else {
        this.updateShiftGate();
        this._startOnlineOrdersWidget();
      }
    }
  },

  async updateShiftBar() {
    const bar = document.getElementById('pos-shift-bar');
    const main = document.getElementById('pos-shift-bar-main');
    const targetBanner = document.getElementById('pos-target-banner');
    if (!bar || !main) return;
    const currency = this.app.settings?.currency || 'R';
    const dailyTarget = this.activeDailyTargetAmount();
    let todaySales = 0;
    if (this.openShift && dailyTarget > 0) {
      try {
        const preview = await API.getShiftClosePreview(this.openShift.id, this.app.user);
        if (preview.success) todaySales = preview.data?.todaySales || 0;
      } catch { /* optional */ }
    }
    if (targetBanner) {
      if (dailyTarget > 0) {
        const pct = Math.min(100, Math.round((todaySales / dailyTarget) * 100));
        const met = todaySales >= dailyTarget;
        targetBanner.style.display = 'block';
        targetBanner.classList.remove('hidden');
        targetBanner.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <span>🎯 Today's sales target: <strong style="font-size:18px">${Utils.formatMoney(todaySales, currency)}</strong>
            / ${Utils.formatMoney(dailyTarget, currency)}
            <span style="margin-left:8px;padding:2px 10px;border-radius:6px;background:${met ? 'var(--success)' : 'var(--bg)'};color:${met ? '#fff' : 'inherit'}">${pct}%${met ? ' ✓ Met' : ''}</span>
          </span>
          <div style="flex:1;min-width:120px;max-width:280px;height:10px;background:var(--bg-secondary);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${met ? 'var(--success)' : 'var(--primary)'};transition:width .3s"></div>
          </div>
        </div>`;
      } else {
        targetBanner.style.display = 'none';
        targetBanner.classList.add('hidden');
        targetBanner.innerHTML = '';
      }
    }
    if (!this.openShift) {
      main.innerHTML = `<span style="color:var(--warning)">No shift open</span>`;
      await this.updateTopSellerBar();
      return;
    }
    let progressHtml = '';
    if (dailyTarget > 0) {
      const pct = Math.min(100, Math.round((todaySales / dailyTarget) * 100));
      const met = todaySales >= dailyTarget;
      progressHtml = ` · Target: ${Utils.formatMoney(todaySales, currency)} / ${Utils.formatMoney(dailyTarget, currency)} (${pct}%)${met ? ' ✓' : ''}`;
    }
    main.innerHTML = `<span>Shift open · Float: ${Utils.formatMoney(this.openShift.opening_float, currency)} · ${Utils.formatDateTime(this.openShift.opened_at)}${progressHtml}</span>
      <button class="btn btn-ghost btn-sm" id="pos-cashout-history-inline" style="margin-left:8px;padding:2px 8px;font-size:11px">Cashout History</button>`;
    document.getElementById('pos-cashout-history-inline')?.addEventListener('click', () => this.showCashOutHistory());
    await this.updateTopSellerBar();
  },

  topSellerDateRange() {
    const today = Utils.today();
    if (this.topSellerPeriod === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { from: d.toLocaleDateString('en-CA'), to: today };
    }
    if (this.topSellerPeriod === 'month') return { from: Utils.monthStart(), to: today };
    return { from: today, to: today };
  },

  async updateTopSellerBar() {
    const wrap = document.getElementById('pos-top-seller-bar');
    const el = document.getElementById('pos-top-seller');
    if (!wrap || !el) return;
    const currency = this.app.settings?.currency || 'R';
    const { from, to } = this.topSellerDateRange();
    const res = await API.getEmployeeReport(from, to).catch(() => ({ success: false }));
    const rows = res.data || [];
    const top = rows[0];
    el.innerHTML = top
      ? `<strong>${top.full_name || '—'}</strong> · ${Utils.formatMoney(top.revenue, currency)} · ${top.sales_count || 0} sales`
      : '<span class="muted">No sales in period</span>';
    wrap.querySelectorAll('[data-top-period]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.topPeriod === this.topSellerPeriod);
    });
  },

  renderLayout(el) {
    const currency = this.app.settings?.currency || 'R';
    const campaignBanner = (this.activeCampaigns || []).slice(0, 2).map(c =>
      `<div class="pos-campaign-banner">🔥 ${c.title}${c.end_date ? ` — ends ${c.end_date}` : ''}</div>`
    ).join('');
    el.innerHTML = `
      <div class="pos-layout">
        ${campaignBanner ? `<div class="pos-campaign-banners">${campaignBanner}</div>` : ''}
        <div class="pos-products">
          <div class="pos-toolbar">
            <input type="search" id="pos-search" placeholder="Search or scan barcode…" autofocus>
            <button class="btn btn-primary btn-sm" id="pos-scan-toggle" title="Barcode scanner mode">📷 Scan</button>
            <div class="pos-customer-wrap" style="position:relative;min-width:200px">
              <input type="search" id="pos-customer-search" placeholder="Search customer name or phone…" autocomplete="off"
                style="padding:8px;border-radius:8px;border:1.5px solid var(--border);width:100%">
              <div id="pos-customer-dropdown" class="search-dropdown hidden" style="position:absolute;top:100%;left:0;right:0;z-index:50;max-height:220px;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:8px"></div>
            </div>
            <input type="text" id="pos-referral-code" placeholder="Referral code" autocomplete="off" title="Agent referral code"
              style="padding:8px;border-radius:8px;border:1.5px solid var(--border);width:120px;max-width:28vw">
            <input type="text" id="pos-coupon-code" placeholder="Coupon" autocomplete="off" title="Marketing coupon"
              style="padding:8px;border-radius:8px;border:1.5px solid var(--border);width:110px;max-width:24vw">
            <button class="btn btn-ghost btn-sm" id="pos-clear-customer" title="Clear customer" style="display:none">✕</button>
            <button class="btn btn-ghost btn-sm" id="pos-add-customer" title="Add customer">+ Customer</button>
            <button class="btn btn-primary btn-sm" id="pos-other-item" title="Sell other item">+ Other Item</button>
            <button class="btn btn-ghost btn-sm" id="pos-free-tables" title="Mark sit-in tables available">🪑 Free Table</button>
            <span id="pos-table-label" class="muted" style="font-size:12px;display:none"></span>
            <button class="btn btn-ghost" id="pos-held">📋 Held <span id="pos-held-count" class="tag tag-warn hidden" style="margin-left:4px;font-size:11px">0</span></button>
            <button class="btn btn-ghost" id="pos-online-orders" title="Online orders">🛒 Online <span id="pos-online-orders-count" class="tag tag-warn hidden" style="margin-left:4px;font-size:11px">0</span></button>
            <button class="btn btn-ghost" id="pos-quote" title="Save cart as quote">📄 Quote</button>
            <button class="btn btn-ghost" id="pos-scanner" title="USB/Bluetooth barcode scanner">📡 Scanner</button>
            <button class="btn btn-ghost" id="pos-printers" title="This computer's printers">🖨️ Printers</button>
            <button class="btn btn-ghost" id="pos-kitchen-display" title="Open kitchen screen on second monitor">🍳 Kitchen</button>
            <button class="btn btn-ghost" id="pos-customer-display" title="Open customer order board on second monitor">📺 Customer Board</button>
            <button class="btn btn-ghost" id="pos-reprint">🖨️ Reprint</button>
            <button class="btn btn-ghost" id="pos-sales-history" title="Today's POS sales — reprint receipts">📜 Sales</button>
            <button class="btn btn-danger btn-sm" id="pos-void">Void Sale</button>
            <button class="btn btn-warning btn-sm" id="pos-refund">Refund</button>
            <button class="btn btn-warning" id="pos-cashout">💰 Cash Out</button>
            <button class="btn btn-ghost btn-sm" id="pos-cash-drop" title="Send cash to admin during shift">💵 Cash Drop</button>
            <button class="btn btn-ghost btn-sm" id="pos-cashout-history">📜 History</button>
          </div>
          <div id="pos-scan-banner" class="pos-scan-banner hidden">📷 Scanner ready — scan barcode or type code and press Enter</div>
          <div id="pos-target-banner" class="pos-target-banner hidden" style="display:none;padding:10px 14px;margin:0;background:linear-gradient(90deg,rgba(16,185,129,0.18),rgba(59,130,246,0.12));border-bottom:2px solid var(--primary);font-size:15px;font-weight:600"></div>
          <div id="pos-shift-bar" class="muted" style="padding:4px 12px;font-size:12px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <span id="pos-conn-badge" class="pos-conn-badge" role="status" aria-live="polite"></span>
            <span id="pos-shift-bar-main"></span>
            <div id="pos-top-seller-bar" style="display:flex;align-items:center;gap:6px;font-size:11px">
              <span>🏆</span>
              <span id="pos-top-seller" class="muted">Loading…</span>
              <button type="button" class="btn btn-ghost btn-sm ${this.topSellerPeriod === 'today' ? 'active' : ''}" data-top-period="today" style="padding:2px 6px;font-size:10px">Today</button>
              <button type="button" class="btn btn-ghost btn-sm ${this.topSellerPeriod === 'week' ? 'active' : ''}" data-top-period="week" style="padding:2px 6px;font-size:10px">Week</button>
              <button type="button" class="btn btn-ghost btn-sm ${this.topSellerPeriod === 'month' ? 'active' : ''}" data-top-period="month" style="padding:2px 6px;font-size:10px">Month</button>
            </div>
          </div>
          <div class="category-tabs" id="pos-categories">
            <button class="cat-tab active" data-cat="">All</button>
            <button class="cat-tab" data-cat="__available_today" style="border-color:#2dd4bf">Available Today</button>
            <button class="cat-tab" data-cat="__new_arrival" style="border-color:#38bdf8">New Arrival</button>
            <button class="cat-tab" data-cat="__best_seller" style="border-color:#fbbf24">Best Seller</button>
            ${this.combos.length ? '<button class="cat-tab" data-cat="combos" style="border-color:#e11d48">🎁 COMBOS</button>' : ''}
            ${this.categories.map(c => `<button class="cat-tab" data-cat="${c.id}" style="border-color:${c.color}">
              ${c.image_path ? `<img ${Utils.cachedImageAttr(c.image_path)} class="cat-tab-img" alt="">` : ''}${c.name}</button>`).join('')}
          </div>
          <div class="product-grid" id="pos-grid"></div>
        </div>
        <div class="pos-cart">
          <div class="form-tabs" id="pos-quote-tabs" style="margin:0;border-bottom:1px solid var(--border)">
            <button type="button" class="form-tab active" data-qtab="current">Current Quote</button>
            <button type="button" class="form-tab" data-qtab="saved">Saved Quotes <span id="pos-saved-quotes-count" class="tag tag-warn hidden" style="margin-left:4px;font-size:11px">0</span></button>
            <button type="button" class="form-tab" data-qtab="history">History</button>
          </div>
          <div id="pos-quote-panel-current">
            <div class="cart-header"><h3>Current Order</h3></div>
            <div class="cart-items" id="pos-cart-items"><p class="muted" style="padding:20px;text-align:center">Tap a product to add</p></div>
            <div class="cart-summary">
              <div class="summary-row hidden" id="cart-subtotal-excl-row"><span id="cart-subtotal-excl-label">Subtotal (excl. tax)</span><span id="cart-subtotal-excl">${currency}0.00</span></div>
              <div class="summary-row"><span>Subtotal</span><span id="cart-subtotal">${currency}0.00</span></div>
              <div class="summary-row"><span>Discount</span><span id="cart-discount">${currency}0.00</span></div>
              <div class="summary-row hidden" id="cart-tax-row"><span id="cart-tax-label">Tax</span><span id="cart-tax">${currency}0.00</span></div>
              <div class="summary-row hidden" id="pos-loyalty-row"><span id="pos-loyalty-label">Customer points</span><span id="pos-loyalty-value">0</span></div>
              <div class="summary-row total"><span>Total</span><span id="cart-total">${currency}0.00</span></div>
              <div class="cart-actions">
                <button class="btn btn-ghost" id="pos-discount">Discount</button>
                <button class="btn btn-ghost" id="pos-hold">Hold</button>
                <button class="btn btn-ghost" id="pos-save-quote">Save Quote</button>
                <button class="btn btn-warning" id="pos-laybuy" title="Create lay-bye from cart">📋 Lay-Bye</button>
                <button class="btn btn-ghost" id="pos-laybuy-pay" title="Take lay-bye payment">💰 Pay Lay-Bye</button>
                <button class="btn btn-danger" id="pos-cancel">Cancel</button>
                <button class="btn btn-success btn-pay" id="pos-pay">💳 Pay</button>
              </div>
            </div>
          </div>
          <div id="pos-quote-panel-saved" class="hidden" style="padding:12px;max-height:calc(100vh - 200px);overflow:auto"></div>
          <div id="pos-quote-panel-history" class="hidden" style="padding:12px;max-height:calc(100vh - 200px);overflow:auto"></div>
        </div>
      </div>
      <div id="pos-success-screen" class="pos-success-screen hidden">
        <div class="pos-success-card">
          <div class="pos-success-icon">✓</div>
          <h2>Order Successful!</h2>
          <p id="pos-success-receipt" class="muted"></p>
          <p id="pos-success-total" style="font-size:28px;font-weight:700;margin:12px 0"></p>
          <p id="pos-success-change" class="muted"></p>
          <p id="pos-success-loyalty" class="muted" style="font-size:15px"></p>
          <p id="pos-success-payments" style="margin:12px 0;font-size:14px"></p>
          <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap">
            <button class="btn btn-primary btn-lg" id="pos-success-print">🖨️ Print Receipt</button>
            <button class="btn btn-ghost btn-lg" id="pos-success-wa">💬 Send Receipt on WhatsApp</button>
            <button class="btn btn-ghost btn-lg hidden" id="pos-success-review">⭐ Request Review</button>
            <button class="btn btn-success btn-lg" id="pos-success-new">New Sale</button>
          </div>
        </div>
      </div>`;
    this.renderProducts();
    this.renderCart();
    this.initCustomerSearch();
    this.updateShiftBar();
    this.bindQuoteTabs();
    Utils.hydrateImages(el);
    this.updatePosBadges();
    try { window.ShopPosConnection?.refreshPosBadge?.(); } catch (_) { /* ignore */ }
  },

  async updatePosBadges() {
    try {
      const [quotesRes, heldRes] = await Promise.all([
        API.getQuotes({ pos_open: true, limit: 500 }),
        API.getHeldOrders()
      ]);
      const quoteCount = (quotesRes.data || []).length;
      const heldCount = (heldRes.data || []).length;
      const heldBadge = document.getElementById('pos-held-count');
      const savedBadge = document.getElementById('pos-saved-quotes-count');
      if (heldBadge) {
        heldBadge.textContent = heldCount;
        heldBadge.classList.toggle('hidden', heldCount === 0);
      }
      if (savedBadge) {
        savedBadge.textContent = quoteCount;
        savedBadge.classList.toggle('hidden', quoteCount === 0);
      }
    } catch (_) { /* optional */ }
  },

  showAddCustomerModal(onSaved) {
    Utils.showModal('Add Customer', `
      <div class="form-grid">
        <div class="field"><label>Name *</label><input id="pc-name"></div>
        <div class="field"><label>Phone</label><input id="pc-phone"></div>
        <div class="field"><label>Email</label><input id="pc-email"></div>
        <div class="field full"><label>Address</label><input id="pc-address"></div>
      </div>
      <div id="pc-dup-warning" class="hidden" style="margin-top:12px;padding:10px;background:#fef3c7;border-radius:8px;font-size:13px"></div>`,
      '<button class="btn btn-primary" id="pc-save">Save & Select</button>');
    document.getElementById('pc-save').addEventListener('click', async () => {
      const name = document.getElementById('pc-name').value.trim();
      const phone = document.getElementById('pc-phone').value.trim();
      if (!name) return Utils.toast('Name required', 'error');
      if (phone) {
        const existing = (this.customers || []).find(c => Utils.phonesMatch(phone, c.phone));
        if (existing) {
          const dupEl = document.getElementById('pc-dup-warning');
          dupEl.classList.remove('hidden');
          dupEl.innerHTML = `<strong>Duplicate phone:</strong> ${existing.name}${existing.phone ? ` (${existing.phone})` : ''} already exists.
            <div style="margin-top:8px"><button type="button" class="btn btn-sm btn-primary" id="pc-use-existing">Use existing customer</button></div>`;
          document.getElementById('pc-use-existing')?.addEventListener('click', () => {
            Utils.hideModal();
            this.selectCustomer(existing);
            if (onSaved) onSaved(existing);
          });
          return Utils.toast('A customer with this phone number already exists', 'error');
        }
      }
      const r = await API.saveCustomer({
        name, phone,
        email: document.getElementById('pc-email').value.trim(),
        address: document.getElementById('pc-address').value.trim(), balance: 0
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      const customer = r.data || {};
      Utils.showModal('✅ Customer Added', `
        <div style="text-align:center;padding:12px 0">
          <div style="font-size:48px;margin-bottom:8px">✓</div>
          <h3 style="margin:0 0 8px">${customer.name || name}</h3>
          ${customer.phone ? `<p>Phone: <strong>${customer.phone}</strong></p>` : ''}
          ${customer.email ? `<p>Email: <strong>${customer.email}</strong></p>` : ''}
          <p class="muted">Customer saved and selected for this sale.</p>
        </div>`,
        '<button class="btn btn-primary" id="pc-done">Continue</button>');
      document.getElementById('pc-done').addEventListener('click', Utils.hideModal);
      await this.initCustomerSearch();
      if (customer.id) this.selectCustomer(customer);
      if (onSaved) onSaved(customer);
    });
  },

  async initCustomerSearch() {
    this.customers = this.customers || [];
    const input = document.getElementById('pos-customer-search');
    const dropdown = document.getElementById('pos-customer-dropdown');
    const clearBtn = document.getElementById('pos-clear-customer');
    if (!input || !dropdown) return;

    if (this.selectedCustomer) {
      input.value = `${this.selectedCustomer.name}${this.selectedCustomer.phone ? ` (${this.selectedCustomer.phone})` : ''}`;
      if (clearBtn) clearBtn.style.display = '';
    }

    const showResults = (list) => {
      if (!list.length) {
        dropdown.innerHTML = '<div class="search-item muted" style="padding:10px">No customers found</div>';
      } else {
        dropdown.innerHTML = list.slice(0, 12).map(c =>
          `<div class="search-item" data-id="${c.id}" style="padding:10px;cursor:pointer;border-bottom:1px solid var(--border)">
            <strong>${Utils.escHtml(c.name)}</strong>${c.phone ? `<br><small>${Utils.escHtml(c.phone)}</small>` : ''}
            ${c.loyalty_points > 0 ? `<br><small style="color:var(--primary)">⭐ ${c.loyalty_points} points</small>` : ''}
            ${c.balance > 0 ? `<br><small class="muted">Owes ${Utils.formatMoney(c.balance, this.app.settings?.currency)}</small>` : ''}
          </div>`).join('');
        dropdown.querySelectorAll('[data-id]').forEach(el => {
          el.addEventListener('click', () => {
            const c = this.customers.find(x => x.id == el.dataset.id);
            if (c) this.selectCustomer(c);
            dropdown.classList.add('hidden');
          });
        });
      }
      dropdown.classList.remove('hidden');
    };

    const runSearch = async (q) => {
      const res = await API.getCustomers(q);
      this.customers = res.data || [];
      showResults(this.customers);
    };

    if (this._customerSearchTimer) clearTimeout(this._customerSearchTimer);
    input.oninput = () => {
      if (this._customerSearchTimer) clearTimeout(this._customerSearchTimer);
      const q = input.value.trim();
      if (!q) {
        dropdown.classList.add('hidden');
        return;
      }
      if (this.selectedCustomer && q === `${this.selectedCustomer.name}${this.selectedCustomer.phone ? ` (${this.selectedCustomer.phone})` : ''}`) {
        dropdown.classList.add('hidden');
        return;
      }
      this._customerSearchTimer = setTimeout(() => runSearch(q), 250);
    };

    input.onfocus = () => {
      const q = input.value.trim();
      if (q && !this.selectedCustomer) input.oninput();
    };

    clearBtn?.addEventListener('click', () => this.clearCustomer());
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.pos-customer-wrap')) dropdown.classList.add('hidden');
    });
  },

  selectCustomer(customer) {
    this.selectedCustomer = customer;
    const input = document.getElementById('pos-customer-search');
    const clearBtn = document.getElementById('pos-clear-customer');
    const currency = this.app.settings?.currency || 'R';
    const pts = Math.floor(customer.loyalty_points || 0);
    const worth = Utils.loyaltyPointsValue(pts, this.app.settings, currency);
    if (input) {
      input.value = `${customer.name}${customer.phone ? ` (${customer.phone})` : ''}`;
      input.title = pts > 0 ? `${pts} points = ${worth.formatted}` : 'No loyalty points yet';
    }
    if (clearBtn) clearBtn.style.display = '';
    this.renderCart();
  },

  clearCustomer() {
    this.selectedCustomer = null;
    const input = document.getElementById('pos-customer-search');
    const clearBtn = document.getElementById('pos-clear-customer');
    if (input) { input.value = ''; input.title = ''; }
    if (clearBtn) clearBtn.style.display = 'none';
    this.renderCart();
  },

  async loadCustomers() {
    await this.initCustomerSearch();
  },

  getStockInfo(product) {
    // Recipe meals: Production Availability Engine (meals that can be made), not raw stock
    const isMeal = !!(product.has_recipe && product.production_mode !== 'make_to_stock');
    const total = isMeal
      ? Math.max(0, Math.floor(Number(product.available_meals ?? product.production_capacity ?? product.stock_quantity) || 0))
      : (product.stock_quantity || 0);
    const inCart = this.cart.filter(i => i.product_id === product.id).reduce((s, i) => s + i.quantity, 0);
    const left = Math.max(0, total - inCart);
    return {
      total,
      inCart,
      left,
      isMeal,
      unit: isMeal ? 'meals' : (product.stock_unit || product.unit || ''),
      limiting: product.limiting_ingredient_name || product.limiting_ingredient || null,
      oosReason: product.out_of_stock_reason || null
    };
  },

  /** Patch in-memory product stock/capacity after a committed sale (no RPC). */
  applyLocalSaleStockDeduction(cartLines) {
    if (!Array.isArray(cartLines) || !this.products?.length) return;
    for (const line of cartLines) {
      const qty = Number(line.quantity) || 0;
      if (!(qty > 0)) continue;

      if (line.combo_id) {
        const combo = (this.combos || []).find((c) => Number(c.id) === Number(line.combo_id));
        const components = combo?.items || line.combo_items || [];
        for (const ci of components) {
          const pid = ci.product_id || ci.id;
          if (!pid) continue;
          const product = this.products.find((p) => Number(p.id) === Number(pid));
          if (!product) continue;
          const need = qty * (Number(ci.quantity) || 1);
          const isMeal = !!(product.has_recipe && product.production_mode !== 'make_to_stock');
          if (isMeal) {
            const cap = Math.max(0, Math.floor(Number(product.available_meals ?? product.production_capacity) || 0) - need);
            product.available_meals = cap;
            product.production_capacity = cap;
          } else {
            product.stock_quantity = Math.max(0, (Number(product.stock_quantity) || 0) - need);
          }
        }
        continue;
      }

      if (!line?.product_id) continue;
      const product = this.products.find((p) => Number(p.id) === Number(line.product_id));
      if (!product) continue;
      const isMeal = !!(product.has_recipe && product.production_mode !== 'make_to_stock');
      if (isMeal) {
        const cap = Math.max(0, Math.floor(Number(product.available_meals ?? product.production_capacity) || 0) - qty);
        product.available_meals = cap;
        product.production_capacity = cap;
      } else {
        product.stock_quantity = Math.max(0, (Number(product.stock_quantity) || 0) - qty);
      }
    }
  },

  allowOversell() {
    return this.app.settings?.security_settings?.allow_oversell === true;
  },

  groupProductOptions(product) {
    let meta = [];
    try { meta = JSON.parse(product.option_groups_meta || '[]'); } catch { meta = []; }
    const groups = {};
    for (const o of product.options || []) {
      const g = o.option_group || 'Choose one';
      if (!groups[g]) groups[g] = [];
      groups[g].push(o);
    }
    return Object.entries(groups).map(([name, choices]) => {
      const m = meta.find(x => x.name === name) || {};
      return {
        name, choices,
        min_select: m.min_select ?? 0,
        max_select: Math.max(1, m.max_select ?? 1),
        is_required: !!m.is_required
      };
    });
  },

  productNeedsDialog(product) {
    return (product.options?.length || product.extras?.length || product.removals?.length || product.requires_options);
  },

  comboMatchesCategory(combo, categoryKey) {
    if (!categoryKey || categoryKey === 'combos') return true;
    const cat = this.categories.find(c => String(c.id) === String(categoryKey));
    if (!cat) return false;
    const label = (combo.category || 'COMBOS').trim().toLowerCase();
    return label === cat.name.trim().toLowerCase() || label === 'combos';
  },

  combosForView(categoryKey, filter = '') {
    let list = this.combos || [];
    if (categoryKey && categoryKey !== 'combos') {
      list = list.filter(c => this.comboMatchesCategory(c, categoryKey));
    }
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.combo_code?.toLowerCase().includes(q));
    }
    return list;
  },

  rebuildProductLookups() {
    this._categoryById = new Map((this.categories || []).map(c => [String(c.id), c]));
    this._productsNeedingOptions = new Set();
    for (const p of this.products || []) {
      if (this.productNeedsDialog(p)) this._productsNeedingOptions.add(String(p.id));
    }
  },

  async reloadCatalog() {
    if (!this.app?.user) return;
    try {
      const filters = { for_pos: true, actor: this.app.user };
      const prodRes = await API.getProducts._uncached
        ? API.getProducts._uncached(filters)
        : API.getProducts(filters);
      this.products = prodRes?.data || prodRes || [];
      this.rebuildProductLookups();
      this.renderProducts(document.getElementById('pos-search')?.value || '');
    } catch (_) { /* ignore */ }
  },

  comboNeedsOptions(combo) {
    const set = this._productsNeedingOptions;
    if (!set) return (combo.items || []).some(i => {
      const p = this.products.find(x => x.id == i.product_id);
      return p && this.productNeedsDialog(p);
    });
    return (combo.items || []).some(i => set.has(String(i.product_id)));
  },

  comboCardHtml(c, currency) {
    const items = c.items || [];
    const components = items.map(i => `${i.quantity}× ${i.product_name}`).join(', ');
    const needsOpts = this.comboNeedsOptions(c);
    const thumbs = items.filter(i => i.picture_path).slice(0, 4);
    let media;
    if (c.image_path) {
      media = `<img ${Utils.cachedImageAttr(c.image_path)} alt="">`;
    } else if (thumbs.length) {
      media = `<div class="combo-item-thumbs" style="display:grid;grid-template-columns:repeat(${Math.min(thumbs.length, 2)},1fr);gap:2px;width:100%;height:100%">
        ${thumbs.map(i => `<img ${Utils.cachedImageAttr(i.picture_path)} alt="" style="width:100%;height:100%;object-fit:cover;min-height:36px">`).join('')}
      </div>`;
    } else {
      media = `<span class="product-card-placeholder">🎁</span>`;
    }
    return `<button class="product-card ${needsOpts ? 'has-options' : ''}" data-combo-id="${c.id}">
      <div class="product-card-media">${media}</div>
      <div class="product-card-body">
        <span class="product-card-cat">COMBO</span>
        <span class="product-card-name">${c.name}</span>
        <span class="product-card-price">${Utils.formatMoney(c.final_price, currency)}</span>
        <span class="product-card-meta">${components || 'Bundle deal'}</span>
        <span class="product-card-badge">Combo</span>
        ${needsOpts ? '<span class="product-card-badge">Options first</span>' : ''}
      </div>
    </button>`;
  },

  scheduleRenderProducts(filter = '') {
    this._pendingProductFilter = filter;
    if (this._renderProductsRaf) return;
    this._renderProductsRaf = requestAnimationFrame(() => {
      this._renderProductsRaf = null;
      this.renderProducts(this._pendingProductFilter || '');
    });
  },

  bindComboGridClicks(grid) {
    grid.querySelectorAll('[data-combo-id]').forEach(btn => btn.addEventListener('click', () => {
      const combo = this.combos.find(x => x.id == btn.dataset.comboId);
      if (combo) this.configureAndAddCombo(combo);
    }));
  },

  async resolveComboProduct(item) {
    let product = this.products.find(p => p.id == item.product_id);
    if (!product || ((product.requires_options || product.options?.length) && !product.options)) {
      const r = await API.getProduct(item.product_id);
      if (r.success && r.data) {
        product = r.data;
        const idx = this.products.findIndex(p => p.id == product.id);
        if (idx >= 0) this.products[idx] = product;
        else this.products.push(product);
      }
    }
    return product || null;
  },

  /** Collect options/extras for a product. Returns config or null if cancelled. */
  collectProductOptions(product, ui = {}) {
    const optionGroups = this.groupProductOptions(product);
    const extras = product.extras || [];
    const removals = product.removals || [];
    if (!optionGroups.length && !extras.length && !removals.length && !product.requires_options) {
      return Promise.resolve({ selectedOptions: [], selectedExtras: [] });
    }
    const currency = this.app.settings?.currency || 'R';
    const style = product.options_style || 'radio';
    const priceLabel = (p) => Utils.formatPriceAdjustment(p, currency);
    const title = ui.title || product.name;
    const submitLabel = ui.submitLabel || 'Add to Order';
    const groupHtml = optionGroups.map((g, gi) => {
      const multi = g.max_select > 1;
      const reqLabel = g.is_required ? ' <span class="muted">(required)</span>' : '';
      const hint = g.max_select > 1 ? ` <small class="muted">Pick ${g.min_select || 0}–${g.max_select}</small>` : '';
      if (multi) {
        return `<div class="option-group-block"><h4>${g.name}${reqLabel}${hint}</h4>
          ${g.choices.map((o, i) =>
            `<label class="option-choice"><input type="checkbox" class="pos-opt-multi" data-gi="${gi}" value="${i}">
              <span>${o.name} ${priceLabel(o.extra_price)}</span></label>`).join('')}</div>`;
      }
      if (style === 'dropdown') {
        return `<div class="option-group-block"><h4>${g.name}${reqLabel}${hint}</h4>
          <select class="pos-opt-dropdown" data-gi="${gi}">
            ${!g.is_required ? '<option value="">— Select —</option>' : ''}
            ${g.choices.map((o, i) => `<option value="${i}">${o.name} ${priceLabel(o.extra_price)}</option>`).join('')}
          </select></div>`;
      }
      return `<div class="option-group-block"><h4>${g.name}${reqLabel}${hint}</h4>
        ${g.choices.map((o, i) =>
          `<label class="option-choice"><input type="radio" name="pos-opt-${gi}" value="${i}">
            <span>${o.name} ${priceLabel(o.extra_price)}</span></label>`).join('')}</div>`;
    }).join('');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        Utils.forceHideModal();
        resolve(value);
      };
      Utils.showModal(title, `
        ${ui.subtitle ? `<p class="muted" style="margin-bottom:10px">${ui.subtitle}</p>` : ''}
        ${product.picture_path ? `<div style="text-align:center;margin-bottom:12px"><img data-image-path="${product.picture_path}" style="max-height:80px;border-radius:8px"></div>` : ''}
        ${product.description ? `<p class="muted">${product.description}</p>` : ''}
        <p class="muted">Base price: <strong>${Utils.formatMoney(product.selling_price, currency)}</strong></p>
        ${groupHtml || '<p class="muted">Select required options to continue.</p>'}
        ${removals.length ? `<h4 style="margin-top:16px">Without / Remove</h4>${removals.map((e, i) =>
          `<label class="option-choice"><input type="checkbox" class="pos-removal" data-i="${i}">
            <span>${e.name} ${priceLabel(e.extra_price)}</span></label>`).join('')}` : ''}
        ${extras.length ? `<h4 style="margin-top:16px">Extras</h4>${extras.map((e, i) =>
          `<label class="option-choice"><input type="checkbox" class="pos-extra" data-i="${i}">
            <span>${e.name} ${priceLabel(e.extra_price)}</span></label>`).join('')}` : ''}`,
        `<button class="btn btn-ghost" id="pos-opt-cancel">Cancel</button>
         <button class="btn btn-primary" id="pos-add-configured">${submitLabel}</button>`,
        { noDismiss: true });
      Utils.hydrateImages(document.getElementById('modal-body'));
      document.getElementById('pos-opt-cancel')?.addEventListener('click', () => finish(null));
      document.getElementById('pos-add-configured')?.addEventListener('click', () => {
        const selectedOptions = [];
        for (let gi = 0; gi < optionGroups.length; gi++) {
          const g = optionGroups[gi];
          let picked = [];
          if (g.max_select > 1) {
            picked = [...document.querySelectorAll(`.pos-opt-multi[data-gi="${gi}"]:checked`)].map(cb => g.choices[parseInt(cb.value, 10)]).filter(Boolean);
          } else if (style === 'dropdown') {
            const sel = document.querySelector(`.pos-opt-dropdown[data-gi="${gi}"]`);
            const idx = sel?.value === '' ? -1 : parseInt(sel?.value, 10);
            if (idx >= 0 && g.choices[idx]) picked = [g.choices[idx]];
          } else {
            const radio = document.querySelector(`input[name="pos-opt-${gi}"]:checked`);
            const idx = radio ? parseInt(radio.value, 10) : -1;
            if (idx >= 0 && g.choices[idx]) picked = [g.choices[idx]];
          }
          const minNeed = g.is_required ? Math.max(1, g.min_select || 1) : (g.min_select || 0);
          if (picked.length < minNeed) {
            return Utils.toast(`Choose at least ${minNeed} option(s) for "${g.name}"`, 'error');
          }
          if (picked.length > g.max_select) {
            return Utils.toast(`Choose at most ${g.max_select} option(s) for "${g.name}"`, 'error');
          }
          selectedOptions.push(...picked);
        }
        if (product.requires_options && !selectedOptions.length && optionGroups.length) {
          return Utils.toast('Select required options before continuing', 'error');
        }
        const selectedRemovals = [...document.querySelectorAll('.pos-removal:checked')].map(cb => removals[parseInt(cb.dataset.i, 10)]).filter(Boolean);
        const selectedExtras = [...document.querySelectorAll('.pos-extra:checked')].map(cb => extras[parseInt(cb.dataset.i, 10)]).filter(Boolean);
        finish({ selectedOptions, selectedExtras: [...selectedRemovals, ...selectedExtras] });
      });
    });
  },

  async configureAndAddCombo(combo) {
    if (!this.requireShift('adding items')) return;
    const items = combo.items || [];
    if (!items.length) return Utils.toast('This combo has no items', 'error');

    // First pass: resolve products and count how many need options
    const resolved = [];
    for (const item of items) {
      const product = await this.resolveComboProduct(item);
      if (!product) {
        return Utils.toast(`Combo item missing from products (id ${item.product_id})`, 'error');
      }
      resolved.push({ item, product, needsOptions: this.productNeedsDialog(product) });
    }
    const optionSteps = resolved.filter(r => r.needsOptions).length;
    let optionStep = 0;
    const configured = [];

    for (const row of resolved) {
      const { item, product, needsOptions } = row;
      if (needsOptions) {
        optionStep += 1;
        const config = await this.collectProductOptions(product, {
          title: `${combo.name} — ${product.name}`,
          subtitle: `Fill options for this combo item first (${optionStep} of ${optionSteps}), then continue.`,
          submitLabel: optionStep < optionSteps ? 'Next item →' : 'Add Combo to Order'
        });
        if (!config) {
          Utils.toast('Combo cancelled — options must be filled before adding to order', 'error');
          return;
        }
        const modText = [...config.selectedOptions, ...config.selectedExtras].map(m => m.name).join(', ');
        configured.push({
          product_id: product.id,
          product_name: product.name,
          quantity: Number(item.quantity) || 1,
          modifiers: [...config.selectedOptions, ...config.selectedExtras],
          modifiers_text: modText || null
        });
      } else {
        configured.push({
          product_id: product.id,
          product_name: product.name,
          quantity: Number(item.quantity) || 1,
          modifiers: [],
          modifiers_text: null
        });
      }
    }
    this.addComboToCart(combo, configured);
    Utils.toast(`Added ${combo.name}`, 'success');
  },

  renderProducts(filter = '') {
    const grid = document.getElementById('pos-grid');
    if (!grid) return;
    if (!this._categoryById || !this._productsNeedingOptions) this.rebuildProductLookups();
    const currency = this.app.settings?.currency || 'R';
    const catKey = this.selectedCategory;
    const combosOnly = catKey === 'combos';
    const combos = this.combosForView(combosOnly ? 'combos' : catKey, filter);
    if (combosOnly) {
      grid.innerHTML = combos.map(c => this.comboCardHtml(c, currency)).join('')
        || '<p class="muted" style="padding:24px;text-align:center">No active combos</p>';
      Utils.hydrateImages(grid);
      this.bindComboGridClicks(grid);
      return;
    }
    let items = this.products;
    if (catKey === '__available_today') {
      items = items.filter(p => Number(p.available_today) === 1);
    } else if (catKey === '__new_arrival') {
      const today = new Date().toLocaleDateString('en-CA');
      items = items.filter(p => Number(p.is_new_arrival) === 1 && (!p.new_arrival_until || p.new_arrival_until >= today));
    } else if (catKey === '__best_seller') {
      const flagged = items.filter(p => Number(p.is_best_seller) === 1);
      items = flagged.length
        ? flagged
        : [...items].filter(p => p.has_recipe || p.item_type === 'restaurant')
          .sort((a, b) => String(b.last_sale_date || '').localeCompare(String(a.last_sale_date || '')))
          .slice(0, 40);
    } else if (catKey) {
      items = items.filter(p => String(p.category_id) === String(catKey));
    }
    if (filter) {
      const q = filter.toLowerCase();
      items = items.filter(p => p.name.toLowerCase().includes(q) || p.barcode?.includes(q) || p.sku?.toLowerCase().includes(q));
    }
    const comboHtml = combos.map(c => this.comboCardHtml(c, currency)).join('');
    const productHtml = items.map(p => {
      const st = this.getStockInfo(p);
      const hasOpts = this._productsNeedingOptions.has(String(p.id));
      const stockClass = st.left <= 0 ? 'out-of-stock' : st.left <= (st.isMeal ? 5 : (p.min_stock || 5)) ? 'low-stock' : '';
      const availLabel = st.left <= 0
        ? (st.isMeal
          ? `OUT OF STOCK${st.limiting ? ` · ${st.limiting}` : ''}`
          : 'Out of stock')
        : (st.isMeal
          ? `${st.left} meals left${st.limiting ? ` · limited by ${st.limiting}` : ''}`
          : `${st.left} ${st.unit || 'each'} left`);
      const cat = this._categoryById.get(String(p.category_id));
      const promoBadge = p.promo_active
        ? `<span class="product-card-badge promo">PROMO${p.original_price ? ` · was ${Utils.formatMoney(p.original_price, currency)}` : ''}</span>`
        : '';
      const mealBadge = st.isMeal && st.left > 0
        ? `<span class="product-card-badge">${st.left} meals</span>`
        : '';
      return `<button class="product-card ${stockClass} ${hasOpts ? 'has-options' : ''} ${p.promo_active ? 'promo-active' : ''}" data-id="${p.id}" title="${st.oosReason || (st.limiting ? `Limited by ${st.limiting}` : '')}">
        <div class="product-card-media">${p.picture_path
          ? `<img ${Utils.cachedImageAttr(p.picture_path)} alt="">`
          : `<span class="product-card-placeholder">${(p.name || '?').charAt(0).toUpperCase()}</span>`}</div>
        <div class="product-card-body">
          ${cat ? `<span class="product-card-cat">${cat.name}</span>` : ''}
          <span class="product-card-name">${p.name}</span>
          <span class="product-card-price">${Utils.formatMoney(p.selling_price, currency)}</span>
          <span class="product-card-meta">${availLabel}${p.sku && !st.isMeal ? ` · ${p.sku}` : ''}</span>
          ${promoBadge}${mealBadge}
          ${hasOpts ? '<span class="product-card-badge">Customise</span>' : ''}
        </div>
      </button>`;
    }).join('');
    grid.innerHTML = (comboHtml + productHtml) || '<p class="muted" style="padding:24px;text-align:center">No products found</p>';
    Utils.hydrateImages(grid);
    this.bindComboGridClicks(grid);
  },

  updateProductStockDisplay() {
    document.querySelectorAll('.product-card').forEach(card => {
      const product = this.products.find(p => p.id == card.dataset.id);
      if (!product) return;
      const st = this.getStockInfo(product);
      const meta = card.querySelector('.product-card-meta');
      if (meta) {
        meta.textContent = st.left <= 0
          ? (st.isMeal ? `OUT OF STOCK${st.limiting ? ` · ${st.limiting}` : ''}` : 'Out of stock')
          : (st.isMeal ? `${st.left} meals left${st.limiting ? ` · limited by ${st.limiting}` : ''}` : `${st.left} ${st.unit || 'each'} left`);
      }
      card.title = st.oosReason || (st.limiting ? `Limited by ${st.limiting}` : '');
      card.classList.toggle('out-of-stock', st.left <= 0);
      card.classList.toggle('low-stock', st.left > 0 && st.left <= (st.isMeal ? 5 : (product.min_stock || 5)));
    });
  },

  bindQuoteTabs() {
    document.getElementById('pos-quote-tabs')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-qtab]');
      if (!btn) return;
      this.quoteTab = btn.dataset.qtab;
      document.querySelectorAll('#pos-quote-tabs .form-tab').forEach(t => t.classList.toggle('active', t.dataset.qtab === this.quoteTab));
      document.getElementById('pos-quote-panel-current')?.classList.toggle('hidden', this.quoteTab !== 'current');
      document.getElementById('pos-quote-panel-saved')?.classList.toggle('hidden', this.quoteTab !== 'saved');
      document.getElementById('pos-quote-panel-history')?.classList.toggle('hidden', this.quoteTab !== 'history');
      if (this.quoteTab === 'saved') await this.renderSavedQuotesPanel(false);
      if (this.quoteTab === 'history') await this.renderSavedQuotesPanel(true);
    });
  },

  async renderSavedQuotesPanel(historyOnly) {
    const panelId = historyOnly ? 'pos-quote-panel-history' : 'pos-quote-panel-saved';
    const panel = document.getElementById(panelId);
    if (!panel) return;
    if (!historyOnly) {
      panel.innerHTML = `<div style="margin-bottom:8px">
        <input type="search" id="pos-quote-search" placeholder="Search quotes…" value="${Utils.escHtml(this.quoteSearch || '')}" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border)">
      </div><div id="pos-quote-list"><p class="muted">Loading…</p></div>`;
      document.getElementById('pos-quote-search')?.addEventListener('input', (e) => {
        clearTimeout(this._quoteSearchTimer);
        this._quoteSearchTimer = setTimeout(() => {
          this.quoteSearch = e.target.value.trim();
          this.renderSavedQuotesPanel(false);
        }, 250);
      });
    } else {
      panel.innerHTML = '<p class="muted">Loading…</p>';
    }
    const listEl = historyOnly ? panel : document.getElementById('pos-quote-list');
    const filters = historyOnly
      ? { limit: 100 }
      : { pos_open: true, search: this.quoteSearch || undefined, limit: 100 };
    const res = await API.getQuotes(filters);
    const quotes = historyOnly ? (res.data || []).filter(q => q.status !== 'open') : (res.data || []);
    const currency = this.app.settings?.currency || 'R';
    if (!quotes.length) {
      const emptyMsg = historyOnly ? 'No quote history yet' : (this.quoteSearch ? 'No matching open quotes' : 'No saved open quotes');
      if (listEl) listEl.innerHTML = `<p class="muted">${emptyMsg}</p>`;
      if (!historyOnly) this.updatePosBadges();
      return;
    }
    const html = quotes.map(q => `
      <div class="card" style="margin-bottom:8px;padding:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div><strong>${q.quote_number}</strong><br>
            <small class="muted">${q.customer_name || 'Walk-in'}${q.customer_phone ? ` · ${q.customer_phone}` : ''} · ${Utils.formatDateTime(q.created_at)}</small><br>
            ${q.items_summary ? `<small>${q.items_summary}</small><br>` : ''}
            <span class="tag">${q.status}</span>${q.expires_at ? `<br><small class="muted">Expires ${Utils.formatDateTime(q.expires_at)}</small>` : ''}</div>
          <strong>${Utils.formatMoney(q.total, currency)}</strong>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          ${q.status === 'open' ? `<button class="btn btn-sm btn-primary load-pos-quote" data-id="${q.id}">Load</button>
            <button class="btn btn-sm btn-success convert-pos-quote" data-id="${q.id}">Sell</button>` : ''}
          <button class="btn btn-sm btn-ghost view-pos-quote" data-id="${q.id}">View</button>
          <button class="btn btn-sm btn-ghost print-pos-quote" data-id="${q.id}" title="Thermal quote receipt">Print</button>
          <button class="btn btn-sm btn-ghost pdf-pos-quote" data-id="${q.id}" title="Save full quote PDF">PDF</button>
          ${q.customer_phone ? `<button class="btn btn-sm btn-success wa-pos-quote" data-id="${q.id}" title="Share via WhatsApp">WhatsApp</button>` : ''}
        </div>
      </div>`).join('');
    if (listEl) listEl.innerHTML = html;
    if (!historyOnly) this.updatePosBadges();
    panel.querySelectorAll('.load-pos-quote').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (!r.success || !r.data) return Utils.toast(r.error || 'Quote not found', 'error');
      if (r.data.status !== 'open') return Utils.toast('Only open quotes can be loaded', 'error');
      this.loadQuoteIntoCart(r.data);
      this.quoteTab = 'current';
      document.querySelector('#pos-quote-tabs [data-qtab="current"]')?.click();
      Utils.toast(`Quote ${r.data.quote_number} loaded — quote # on receipt for search`, 'success');
    }));
    panel.querySelectorAll('.convert-pos-quote').forEach(b => b.addEventListener('click', () => this.convertQuoteToSaleOnPos(parseInt(b.dataset.id, 10))));
    panel.querySelectorAll('.view-pos-quote').forEach(b => b.addEventListener('click', () => this.viewQuoteDetail(parseInt(b.dataset.id, 10))));
    panel.querySelectorAll('.print-pos-quote').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (!r.data) return Utils.toast(r.error || 'Quote not found', 'error');
      try {
        await Receipt.printQuote(r.data, this.app.settings, 'thermal');
        Utils.toast('Quote receipt sent to printer', 'success');
      } catch (e) { Utils.toast(e.message || 'Print failed', 'error'); }
    }));
    panel.querySelectorAll('.pdf-pos-quote').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (!r.data) return Utils.toast(r.error || 'Quote not found', 'error');
      await Receipt.downloadQuotePdf(r.data, this.app.settings);
    }));
    panel.querySelectorAll('.wa-pos-quote').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getQuote(parseInt(b.dataset.id, 10));
      if (!r.data) return Utils.toast(r.error || 'Quote not found', 'error');
      const waRes = await Utils.sendQuoteWhatsApp(this.app, r.data);
      if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
    }));
  },

  async convertQuoteToSaleOnPos(quoteId) {
    if (!this.requireShift('converting a quote')) return;
    const payType = await new Promise((resolve) => {
      Utils.showModal(
        'Convert quote to sale',
        `<p>How did the customer pay?</p>
         <div class="field"><label>Payment type</label>
           <select id="cq-paytype">
             <option value="cash">Cash</option>
             <option value="card">Card</option>
             <option value="eft">EFT</option>
             <option value="mobile">Mobile</option>
             <option value="other">Other</option>
           </select>
         </div>
         <p class="muted">Tip: use <strong>Load</strong> then Pay if you need split tenders / account.</p>`,
        '<button class="btn btn-secondary" id="cq-cancel">Cancel</button><button class="btn btn-success" id="cq-ok">Complete sale</button>'
      );
      document.getElementById('cq-cancel')?.addEventListener('click', () => {
        Utils.forceHideModal();
        resolve(null);
      });
      document.getElementById('cq-ok')?.addEventListener('click', () => {
        const v = document.getElementById('cq-paytype')?.value || 'cash';
        Utils.forceHideModal();
        resolve(v);
      });
    });
    if (!payType) return;
    const r = await API.convertQuote(quoteId, this.app.user, { type: payType });
    if (!r.success) return Utils.toast(r.error || 'Could not convert quote', 'error');
    const sale = r.data?.sale || r.data;
    Utils.toast(`Sold (${payType}) — Order ${sale?.order_number || ''} · Receipt ${sale?.receipt_number || ''}`, 'success');
    if (sale) {
      try { await this.printReceiptSafe(sale); } catch (_) {}
      try { await this.printKitchenSafe(sale); } catch (_) {}
    }
    await this.renderSavedQuotesPanel(false);
    this.updatePosBadges();
  },

  async viewQuoteDetail(quoteId) {
    const r = await API.getQuote(quoteId);
    const q = r.data;
    if (!q) return Utils.toast('Quote not found', 'error');
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal(`Quote ${q.quote_number}`, `
      <p><strong>Customer:</strong> ${q.customer_name || '—'}</p>
      <p><strong>Status:</strong> ${q.status}</p>
      <table style="width:100%;margin-top:12px"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      ${(q.items || []).map(i => `<tr><td>${i.product_name}</td><td>${i.quantity}</td>
        <td>${Utils.formatMoney(i.unit_price, currency)}</td><td>${Utils.formatMoney(i.total, currency)}</td></tr>`).join('')}
      </table>
      <p style="margin-top:12px"><strong>Total:</strong> ${Utils.formatMoney(q.total, currency)}</p>`,
      '<button class="btn btn-primary" id="vq-print">Print PDF</button>' +
      (q.customer_phone ? '<button class="btn btn-success" id="vq-wa">WhatsApp</button>' : ''));
    document.getElementById('vq-print')?.addEventListener('click', () => Receipt.downloadQuotePdf(q, this.app.settings));
    document.getElementById('vq-wa')?.addEventListener('click', async () => {
      const waRes = await Utils.sendQuoteWhatsApp(this.app, q);
      if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
    });
  },

  renderCart() {
    const container = document.getElementById('pos-cart-items');
    const currency = this.app.settings?.currency || 'R';
    if (!this.cart.length) {
      container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">Tap a product to add</p>';
    } else {
      container.innerHTML = this.cart.map((item, i) => `
        <div class="cart-item">
          <div><div class="item-name">${item.product_name}</div>
            ${item.modifiers_text ? `<div class="muted" style="font-size:11px">${item.modifiers_text}</div>` : ''}
            <div class="item-price">${Utils.formatMoney(item.unit_price, currency)} each</div></div>
          <div class="qty-control">
            <button data-action="minus" data-idx="${i}">−</button>
            <span>${item.quantity}</span>
            <button data-action="plus" data-idx="${i}">+</button>
          </div>
          <div><strong>${Utils.formatMoney(item.total, currency)}</strong>
            <button class="btn-icon" data-action="remove" data-idx="${i}" style="font-size:14px">✕</button></div>
        </div>`).join('');
    }
    const grossSubtotal = this.cart.reduce((s, i) => s + i.total, 0);
    const totals = Utils.calcTaxTotals(grossSubtotal, this.app.settings, this.discount);
    const taxEnabled = !!this.app.settings?.tax_enabled &&
      this.app.settings?.tax_show_on_pos !== 0 &&
      this.app.settings?.tax_show_on_pos !== false &&
      this.app.settings?.tax_show_on_pos !== '0' &&
      totals.tax > 0;
    const taxRatePct = totals.taxRate || 0;

    const subtotalRow = document.getElementById('cart-subtotal');
    const subtotalExclRow = document.getElementById('cart-subtotal-excl-row');
    const subtotalExclEl = document.getElementById('cart-subtotal-excl');
    const taxRow = document.getElementById('cart-tax-row');
    const taxLabel = document.getElementById('cart-tax-label');
    const taxEl = document.getElementById('cart-tax');

    if (taxEnabled) {
      subtotalRow?.closest('.summary-row')?.classList.add('hidden');
      subtotalExclRow?.classList.remove('hidden');
      if (subtotalExclEl) subtotalExclEl.textContent = Utils.formatMoney(totals.subtotalExcl, currency);
      taxRow?.classList.remove('hidden');
      if (taxLabel) taxLabel.textContent = `Tax (${taxRatePct}%)`;
      if (taxEl) taxEl.textContent = Utils.formatMoney(totals.tax, currency);
    } else {
      subtotalExclRow?.classList.add('hidden');
      taxRow?.classList.add('hidden');
      subtotalRow?.closest('.summary-row')?.classList.remove('hidden');
      if (subtotalRow) subtotalRow.textContent = Utils.formatMoney(grossSubtotal, currency);
    }

    document.getElementById('cart-discount').textContent = Utils.formatMoney(this.discount, currency);
    document.getElementById('cart-total').textContent = Utils.formatMoney(totals.total, currency);
    this.totals = { subtotal: totals.subtotalExcl, grossSubtotal, discount: this.discount, tax_amount: totals.tax, total: totals.total };
    this.broadcastCartToDisplays(totals.total, currency);
    this.updateLoyaltyDisplay(totals.total);
    this.updateProductStockDisplay();
  },

  broadcastCartToDisplays(total, currency) {
    const payload = {
      type: 'cart:update',
      items: (this.cart || []).map((i) => ({
        product_name: i.product_name,
        quantity: i.quantity,
        total: i.total
      })),
      discount: this.discount || 0,
      total: total || 0,
      currency: currency || this.app?.settings?.currency || 'R',
      customer: this.selectedCustomer?.name || null
    };
    try {
      const bc = new BroadcastChannel('shoppos-kitchen');
      bc.postMessage(payload);
      bc.close();
    } catch (_) { /* ignore */ }
    try {
      window.postMessage(payload, '*');
      document.querySelectorAll('iframe').forEach((f) => {
        try { f.contentWindow?.postMessage(payload, '*'); } catch (_) { /* ignore */ }
      });
    } catch (_) { /* ignore */ }
  },

  updateLoyaltyDisplay(total) {
    const row = document.getElementById('pos-loyalty-row');
    const val = document.getElementById('pos-loyalty-label');
    const valueEl = document.getElementById('pos-loyalty-value');
    if (!row || !valueEl) return;
    const currency = this.app.settings?.currency || 'R';
    const ls = this.app.settings?.loyalty_settings || {};
    if (!this.selectedCustomer || ls.enabled === false) {
      row.classList.add('hidden');
      return;
    }
    const pts = Utils.loyaltyPreviewPoints(total, this.app.settings);
    const balance = Math.floor(this.selectedCustomer.loyalty_points || 0);
    const worth = Utils.loyaltyPointsValue(balance, this.app.settings, currency);
    const maxRedeem = Utils.loyaltyMaxRedeemPoints(total, balance, this.app.settings);
    row.classList.remove('hidden');
    if (val) {
      val.textContent = `${this.selectedCustomer.name} · ${balance} pts (${worth.formatted})`;
    }
    valueEl.innerHTML = maxRedeem > 0
      ? `Earn +${pts} · redeem up to ${maxRedeem} pts`
      : `Earn +${pts}`;
    valueEl.style.color = 'var(--primary)';
  },

  toggleScanMode(force) {
    this.scanMode = typeof force === 'boolean' ? force : !this.scanMode;
    const btn = document.getElementById('pos-scan-toggle');
    const banner = document.getElementById('pos-scan-banner');
    const search = document.getElementById('pos-search');
    if (btn) {
      btn.classList.toggle('active', this.scanMode);
      btn.textContent = this.scanMode ? '📷 Scanning…' : '📷 Scan';
    }
    banner?.classList.toggle('hidden', !this.scanMode);
    if (this.scanMode && search) {
      search.placeholder = this._preferCameraScan ? 'Camera scan or type barcode…' : 'Scan barcode now…';
      search.focus();
      search.select();
      if (this._preferCameraScan) this.startCameraBarcodeScan();
    } else if (search) {
      search.placeholder = 'Search or scan barcode…';
      this.stopCameraBarcodeScan();
    }
  },

  stopCameraBarcodeScan() {
    try { this._scanStream?.getTracks()?.forEach(t => t.stop()); } catch (_) {}
    this._scanStream = null;
    this._scanDetecting = false;
    document.getElementById('pos-cam-scan')?.remove();
  },

  async startCameraBarcodeScan() {
    if (this._scanDetecting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      return Utils.toast('Camera scan not available on this device — type or use a USB scanner', 'error');
    }
    this.stopCameraBarcodeScan();
    let wrap = document.getElementById('pos-cam-scan');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'pos-cam-scan';
      wrap.style.cssText = 'position:relative;margin:8px 12px;max-width:420px';
      wrap.innerHTML = '<video id="pos-cam-video" autoplay playsinline muted style="width:100%;border-radius:8px;background:#000"></video>';
      document.getElementById('pos-scan-banner')?.after(wrap);
    }
    try {
      this._scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.getElementById('pos-cam-video');
      if (video) video.srcObject = this._scanStream;
    } catch (err) {
      this.stopCameraBarcodeScan();
      return Utils.toast(err.message || 'Camera permission denied', 'error');
    }
    const Detector = window.BarcodeDetector;
    if (!Detector) {
      Utils.toast('Live barcode camera not supported here — type the code or use USB scanner', 'warning');
      return;
    }
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code', 'upc_a', 'upc_e'] });
    this._scanDetecting = true;
    const tick = async () => {
      if (!this._scanDetecting || !this.scanMode) return;
      try {
        const video = document.getElementById('pos-cam-video');
        if (video && video.readyState >= 2) {
          const codes = await detector.detect(video);
          if (codes?.[0]?.rawValue) {
            await this.handleBarcodeScan(codes[0].rawValue);
            this.toggleScanMode(false);
            return;
          }
        }
      } catch (_) { /* keep scanning */ }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  flashScanBanner(type) {
    const banner = document.getElementById('pos-scan-banner');
    if (!banner) return;
    banner.classList.remove('scan-ok', 'scan-err');
    banner.classList.add(type === 'success' ? 'scan-ok' : 'scan-err');
    setTimeout(() => banner.classList.remove('scan-ok', 'scan-err'), 600);
  },

  normalizeScanCode(rawCode) {
    let code = String(rawCode || '').trim();
    const ss = this.app.settings?.scanner_settings || {};
    const prefix = String(ss.prefix || '').trim();
    if (prefix && code.startsWith(prefix)) code = code.slice(prefix.length);
    return code.trim();
  },

  async handleBarcodeScan(rawCode) {
    const code = this.normalizeScanCode(rawCode);
    if (!code) return;
    if (!this.requireShift('scanning barcodes')) return;

    let product = null;
    const res = await API.getProductByBarcode(code);
    if (res?.data) product = res.data;
    if (!product) {
      product = this.products.find(p =>
        p.is_active !== 0 && (p.barcode === code || (p.sku && p.sku.toLowerCase() === code.toLowerCase()))
      );
    }
    // Prefer capacity/promo-enriched catalog copy when barcode RPC returns a bare row
    if (product?.id) {
      const enriched = this.products.find((p) => Number(p.id) === Number(product.id));
      if (enriched) {
        product = {
          ...enriched,
          ...product,
          selling_price: enriched.selling_price ?? product.selling_price,
          available_meals: enriched.available_meals ?? product.available_meals,
          production_capacity: enriched.production_capacity ?? product.production_capacity,
          has_recipe: enriched.has_recipe ?? product.has_recipe,
          production_mode: enriched.production_mode ?? product.production_mode,
          promo_active: enriched.promo_active ?? product.promo_active,
          original_price: enriched.original_price ?? product.original_price,
          promo_request_id: enriched.promo_request_id ?? product.promo_request_id,
          limiting_ingredient_name: enriched.limiting_ingredient_name ?? product.limiting_ingredient_name,
          out_of_stock_reason: enriched.out_of_stock_reason ?? product.out_of_stock_reason
        };
      }
    }
    if (!product) {
      Utils.toast(`No product found: ${code}`, 'error');
      this.flashScanBanner('error');
      return;
    }
    if (this.productNeedsDialog(product)) {
      this.promptProductOptions(product);
    } else {
      this.addToCart(product);
      Utils.toast(`Added ${product.name}`, 'success');
    }
    this.flashScanBanner('success');
    if (this.app.settings?.scanner_settings?.beep_on_scan !== false && !this.app.isPosKiosk?.()) {
      SoundService?.playScanBeep?.();
    }
    const searchInput = document.getElementById('pos-search');
    if (searchInput) {
      searchInput.value = '';
      this.renderProducts();
      if (this.scanMode) searchInput.focus();
    }
  },

  mealOosMessage(product, st) {
    const reason = st?.oosReason || (st?.limiting ? `${st.limiting} is unavailable` : null);
    if (st?.isMeal && reason) return `OUT OF STOCK — ${reason}`;
    if (st?.isMeal) return `${product.name}: no meals can be produced`;
    return `${product.name} is out of stock`;
  },

  async offerIngredientSubstitution(product, st) {
    const limitingId = product.limiting_ingredient_id;
    if (!limitingId || !this.app?.user) return null;
    const res = await API.recipePosSubs(limitingId, this.app.user);
    const subs = res.success ? (res.data || []) : [];
    if (!subs.length) return null;
    return new Promise((resolve) => {
      Utils.showModal(
        `Substitute for ${st.limiting || 'ingredient'}`,
        `<p class="muted">${product.name} is out because <strong>${st.limiting || 'an ingredient'}</strong> is unavailable.</p>
         <p>Choose an approved substitute to sell this meal (stock deducts the substitute instead):</p>
         <div class="field"><label>Substitute</label>
           <select id="pos-sub-pick">${subs.map(s =>
             `<option value="${s.to_product_id}">${s.to_name} (${s.to_stock} in stock)</option>`
           ).join('')}</select></div>`,
        `<button class="btn btn-ghost" id="pos-sub-cancel">Cancel</button>
         <button class="btn btn-primary" id="pos-sub-ok">Use substitute & add</button>`
      );
      document.getElementById('pos-sub-cancel')?.addEventListener('click', () => {
        Utils.forceHideModal();
        resolve(null);
      });
      document.getElementById('pos-sub-ok')?.addEventListener('click', () => {
        const toId = parseInt(document.getElementById('pos-sub-pick')?.value, 10);
        Utils.forceHideModal();
        resolve(toId ? { [String(limitingId)]: toId } : null);
      });
    });
  },

  async addToCart(product, config = {}) {
    if (!this.requireShift('adding items')) return;
    let substitutions = config.substitutions || null;
    if (!this.allowOversell()) {
      const st = this.getStockInfo(product);
      if (st.left <= 0) {
        if (st.isMeal && product.limiting_ingredient_id) {
          const sub = await this.offerIngredientSubstitution(product, st);
          if (!sub) return Utils.toast(this.mealOosMessage(product, st), 'error');
          substitutions = sub;
        } else {
          return Utils.toast(this.mealOosMessage(product, st), 'error');
        }
      }
    }
    const opts = config.selectedOptions || [];
    const extras = config.selectedExtras || [];
    const extraTotal = [...opts, ...extras].reduce((s, m) => s + (Number(m.extra_price) || 0), 0);
    const modText = [...opts, ...extras].map(m => m.name).join(', ');
    // Postgres NUMERIC arrives as strings — never use + or JS will concat ("50"+0 => "500")
    const unitPrice = Math.round(((Number(product.selling_price) || 0) + extraTotal) * 100) / 100;
    const subKey = substitutions ? JSON.stringify(substitutions) : '';
    const cartKey = `${product.id}:${modText}:${subKey}`;

    const existing = this.cart.find(i => i.cart_key === cartKey);
    if (existing) {
      if (!this.allowOversell() && !substitutions) {
        const st = this.getStockInfo(product);
        if (st.left <= 0) {
          return Utils.toast(
            st.isMeal
              ? `Only ${st.total} meals available for ${product.name}${st.limiting ? ` (limited by ${st.limiting})` : ''}`
              : `Only ${product.stock_quantity || 0} in stock for ${product.name}`,
            'error'
          );
        }
      }
      existing.quantity++;
      existing.unit_price = Number(existing.unit_price) || unitPrice;
      existing.total = Math.round(existing.quantity * existing.unit_price * 100) / 100;
    } else {
      this.cart.push({
        cart_key: cartKey,
        product_id: product.id, product_name: product.name,
        quantity: 1, unit_price: unitPrice,
        buying_price: Number(product.buying_price) || 0, discount: 0,
        total: unitPrice,
        item_type: product.item_type || 'retail',
        modifiers_text: modText || null,
        modifiers: [...opts, ...extras],
        substitutions: substitutions || null,
        promo_request_id: product.promo_request_id || null,
        original_unit_price: product.promo_active
          ? (Number(product.original_price ?? product.selling_price) || 0)
          : null
      });
    }
    this.renderCart();
  },

  addComboToCart(combo, configuredComponents = null) {
    if (!this.requireShift('adding items')) return;
    const components = configuredComponents || (combo.items || []).map(i => ({
      product_id: i.product_id,
      product_name: i.product_name,
      quantity: Number(i.quantity) || 1,
      modifiers: [],
      modifiers_text: null
    }));
    const componentsLabel = components.map(i => {
      const base = `${i.quantity}× ${i.product_name}`;
      return i.modifiers_text ? `${base} (${i.modifiers_text})` : base;
    }).join(', ');
    const modKey = components.map(i => `${i.product_id}:${i.modifiers_text || ''}`).join('|');
    const cartKey = `combo:${combo.id}:${modKey}`;
    const allMods = components.flatMap(i => i.modifiers || []);
    const unitPrice = Number(combo.final_price) || 0;
    const normalPrice = Number(combo.normal_price) || 0;
    const existing = this.cart.find(i => i.cart_key === cartKey);
    if (existing) {
      existing.quantity++;
      existing.unit_price = Number(existing.unit_price) || unitPrice;
      existing.total = Math.round(existing.quantity * existing.unit_price * 100) / 100;
    } else {
      this.cart.push({
        cart_key: cartKey,
        combo_id: combo.id,
        product_id: null,
        product_name: combo.name,
        quantity: 1,
        unit_price: unitPrice,
        buying_price: 0,
        discount: Math.max(0, normalPrice - unitPrice),
        total: unitPrice,
        item_type: 'combo',
        modifiers_text: componentsLabel || null,
        modifiers: allMods.length ? allMods : null,
        combo_components: components
      });
    }
    this.renderCart();
  },

  async promptProductOptions(product) {
    const config = await this.collectProductOptions(product);
    if (!config) return;
    this.addToCart(product, config);
  },

  bindEvents(el) {
    document.getElementById('pos-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('.product-card');
      if (!btn) return;
      const product = this.products.find(p => p.id == btn.dataset.id);
      if (!product) return;
      if (this.productNeedsDialog(product)) this.promptProductOptions(product);
      else this.addToCart(product);
    });

    document.getElementById('pos-categories').addEventListener('click', (e) => {
      const tab = e.target.closest('.cat-tab');
      if (!tab) return;
      document.querySelectorAll('#pos-categories .cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      this.selectedCategory = tab.dataset.cat || null;
      // Paint tab active state first, then rebuild grid on next frame
      this.scheduleRenderProducts(document.getElementById('pos-search')?.value || '');
    });

    const searchInput = document.getElementById('pos-search');
    searchInput.addEventListener('input', (e) => {
      clearTimeout(this._productSearchTimer);
      this._productSearchTimer = setTimeout(() => this.scheduleRenderProducts(e.target.value), 180);
    });
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await this.handleBarcodeScan(searchInput.value);
      }
    });

    document.getElementById('pos-scan-toggle')?.addEventListener('click', () => this.toggleScanMode());

    if (this._posScanListener) {
      document.removeEventListener('keydown', this._posScanListener);
    }
    document.addEventListener('keydown', this._posScanListener = (e) => {
      if (!this.scanMode || e.key === 'Enter') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') && t.id !== 'pos-search') return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        searchInput?.focus();
      }
    });

    document.getElementById('pos-cart-items').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx);
      const cartItem = this.cart[idx];
      if (btn.dataset.action === 'plus') {
        if (!this.allowOversell() && cartItem?.product_id) {
          const product = this.products.find(p => p.id === cartItem.product_id);
          if (product) {
            const st = this.getStockInfo(product);
            if (st.left <= 0) {
              return Utils.toast(
                st.isMeal
                  ? `Only ${st.total} meals available${st.limiting ? ` (limited by ${st.limiting})` : ''}`
                  : `Only ${product.stock_quantity || 0} in stock`,
                'error'
              );
            }
          }
        }
        this.cart[idx].quantity++;
        this.cart[idx].unit_price = Number(this.cart[idx].unit_price) || 0;
        this.cart[idx].total = Math.round(this.cart[idx].quantity * this.cart[idx].unit_price * 100) / 100;
      }
      if (btn.dataset.action === 'minus') {
        this.cart[idx].quantity = Math.max(1, this.cart[idx].quantity - 1);
        this.cart[idx].unit_price = Number(this.cart[idx].unit_price) || 0;
        this.cart[idx].total = Math.round(this.cart[idx].quantity * this.cart[idx].unit_price * 100) / 100;
      }
      if (btn.dataset.action === 'remove') this.cart.splice(idx, 1);
      this.renderCart();
    });

    document.getElementById('pos-cancel').addEventListener('click', () => {
      this.cart = []; this.discount = 0; this.loadedQuoteId = null; this.renderCart();
    });
    document.getElementById('pos-discount').addEventListener('click', () => this.showDiscountModal());
    document.getElementById('pos-hold').addEventListener('click', () => this.holdOrder());
    document.getElementById('pos-held').addEventListener('click', () => this.showHeldOrders());
    document.getElementById('pos-online-orders')?.addEventListener('click', () => this.openOnlineOrdersPanel('pending'));
    document.getElementById('pos-quote')?.addEventListener('click', () => this.saveCartAsQuote());
    document.getElementById('pos-save-quote')?.addEventListener('click', () => this.saveCartAsQuote());
    document.getElementById('pos-scanner')?.addEventListener('click', () => this.showScannerSettings());
    document.getElementById('pos-reprint').addEventListener('click', () => this.showReprint());
    document.getElementById('pos-sales-history')?.addEventListener('click', () => this.showPosSalesHistory());
    document.getElementById('pos-printers').addEventListener('click', () => this.showPrinterSetup());
    document.getElementById('pos-kitchen-display').addEventListener('click', () => this.openKitchenDisplay());
    document.getElementById('pos-customer-display')?.addEventListener('click', () => this.openCustomerDisplay());
    document.getElementById('pos-void').addEventListener('click', () => this.showVoidSale());
    document.getElementById('pos-refund')?.addEventListener('click', () => {
      const receipt = this.lastSale?.receipt_number || '';
      if (window.ReturnsPage?.showReturnForm) {
        ReturnsPage.app = this.app;
        ReturnsPage.showReturnForm(receipt, this.app);
      } else {
        this.app.navigate('returns');
      }
    });
    document.getElementById('pos-add-customer').addEventListener('click', () => this.showAddCustomerModal());
    document.getElementById('pos-other-item')?.addEventListener('click', () => this.showOtherItemModal());
    document.getElementById('pos-cashout').addEventListener('click', () => this.showCashOut());
    document.getElementById('pos-cash-drop')?.addEventListener('click', () => this.showCashDrop());
    document.getElementById('pos-cashout-history')?.addEventListener('click', () => this.showCashOutHistory());
    document.getElementById('pos-top-seller-bar')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-top-period]');
      if (!btn) return;
      this.topSellerPeriod = btn.dataset.topPeriod;
      this.updateTopSellerBar();
    });
    document.getElementById('pos-pay').addEventListener('click', () => this.showPaymentModal());
    document.getElementById('pos-laybuy')?.addEventListener('click', () => this.showLaybuyFromCart());
    document.getElementById('pos-laybuy-pay')?.addEventListener('click', () => this.showPayLaybuyOnPos());
    document.getElementById('pos-free-tables')?.addEventListener('click', () => this.showFreeTablePicker());
  },

  async showLaybuyFromCart() {
    if (!this.requireShift('creating lay-bye')) return;
    if (!this.cart.length) return Utils.toast('Cart is empty', 'error');
    if (!this.selectedCustomer?.id) return Utils.toast('Select a customer for lay-bye first', 'error');
    if (this.cart.some(i => i.combo_id || i.item_type === 'combo')) {
      return Utils.toast('Remove combos before creating a lay-bye (products only)', 'error');
    }
    if (!this.totals?.total && this.totals?.total !== 0) this.renderCart();
    const currency = this.app.settings?.currency || 'R';
    const total = Number(this.totals?.total) || 0;
    const itemsHtml = this.cart.map(i =>
      `<div style="padding:4px 0;border-bottom:1px solid var(--border)">${i.quantity}× ${Utils.escHtml(i.product_name)} — ${Utils.formatMoney(i.total, currency)}</div>`
    ).join('');
    Utils.showModal('Create Lay-Bye from Cart', `
      <p><strong>Customer:</strong> ${Utils.escHtml(this.selectedCustomer.name)}
        ${this.selectedCustomer.phone ? ` · ${Utils.escHtml(this.selectedCustomer.phone)}` : ''}</p>
      <div style="max-height:180px;overflow:auto;margin:8px 0">${itemsHtml}</div>
      <p><strong>Total:</strong> ${Utils.formatMoney(total, currency)}</p>
      <div class="field"><label>Deposit now</label>
        <input type="number" id="pos-lb-deposit" step="0.01" min="0" max="${total}" value="0"></div>
      <div class="field"><label>Deposit payment method</label>
        <select id="pos-lb-paytype"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="mobile">Mobile</option></select></div>
      <p class="muted">Remaining balance will appear under Lay-Bye. Products and payments are saved for the backend.</p>`,
      '<button class="btn btn-ghost" id="pos-lb-cancel">Cancel</button><button class="btn btn-warning" id="pos-lb-save">Create Lay-Bye</button>');
    document.getElementById('pos-lb-cancel')?.addEventListener('click', Utils.hideModal);
    document.getElementById('pos-lb-save')?.addEventListener('click', async () => {
      const deposit = parseFloat(document.getElementById('pos-lb-deposit').value) || 0;
      if (deposit > total) return Utils.toast('Deposit cannot exceed total', 'error');
      const r = await API.createLayby({
        customer_id: this.selectedCustomer.id,
        items: this.cart.map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.total
        })),
        total,
        deposit,
        payment_type: document.getElementById('pos-lb-paytype').value || 'cash',
        notes: 'Created from POS'
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Lay-bye failed', 'error');
      Utils.hideModal();
      this.cart = [];
      this.discount = 0;
      this.renderCart();
      Utils.toast(`Lay-bye ${r.data.laybyNumber} created — due ${r.data.expires_at || ''}`, 'success');
      if (r.data?.id) {
        try {
          const full = await API.getLayby(r.data.id);
          if (full.data) {
            const html = Receipt.buildLayby(full.data, this.app.settings);
            await API.printReceipt(html, Receipt._devicePrintOpts(this.app.settings));
            if (full.data.customer_phone) {
              const msg = Receipt.buildLaybyWhatsApp(full.data, this.app.settings);
              const wa = await API.sendWhatsAppMessage({
                phone: full.data.customer_phone,
                recipient_name: full.data.customer_name || 'Customer',
                message_type: 'layby',
                body: msg
              }, this.app.user);
              await Utils.deliverWhatsApp(wa, full.data.customer_phone, msg);
            }
          }
        } catch (_) {}
      }
    });
  },

  async showPayLaybuyOnPos() {
    if (!this.requireShift('lay-bye payment')) return;
    const res = await API.getLaybyes({ status: 'active', limit: 200 });
    const list = res.data || [];
    if (!list.length) return Utils.toast('No active lay-byes', 'error');
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal('Pay Lay-Bye', `
      <p class="muted">Select a lay-bye and enter any payment amount (partial allowed).</p>
      <div class="field"><label>Lay-Bye</label>
        <select id="pos-lb-pick">${list.map(l =>
          `<option value="${l.id}" data-bal="${l.balance}">${l.layby_number} — ${Utils.escHtml(l.customer_name || '')} · bal ${Utils.formatMoney(l.balance, currency)}</option>`
        ).join('')}</select></div>
      <div class="field"><label>Amount</label><input type="number" id="pos-lb-amt" step="0.01" min="0.01"></div>
      <div class="field"><label>Method</label>
        <select id="pos-lb-method"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="mobile">Mobile</option></select></div>`,
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Cancel</button><button class="btn btn-success" id="pos-lb-pay-go">Pay & Receipt</button>');
    const syncAmt = () => {
      const opt = document.getElementById('pos-lb-pick')?.selectedOptions?.[0];
      const inp = document.getElementById('pos-lb-amt');
      if (opt && inp && !inp.value) inp.value = opt.dataset.bal || '';
    };
    syncAmt();
    document.getElementById('pos-lb-pick')?.addEventListener('change', () => {
      const opt = document.getElementById('pos-lb-pick').selectedOptions[0];
      document.getElementById('pos-lb-amt').value = opt?.dataset.bal || '';
    });
    document.getElementById('pos-lb-pay-go')?.addEventListener('click', async () => {
      const id = parseInt(document.getElementById('pos-lb-pick').value, 10);
      const amount = parseFloat(document.getElementById('pos-lb-amt').value) || 0;
      const type = document.getElementById('pos-lb-method').value || 'cash';
      if (amount <= 0) return Utils.toast('Enter an amount', 'error');
      const r = await API.payLayby(id, amount, type, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast(`Paid — balance ${Utils.formatMoney(r.data?.balance, currency)}`, 'success');
      const full = await API.getLayby(id);
      if (full.data) {
        try {
          await API.printReceipt(Receipt.buildLayby(full.data, this.app.settings), Receipt._devicePrintOpts(this.app.settings));
        } catch (_) {}
        if (full.data.customer_phone) {
          const laybyMsg = Receipt.buildLaybyWhatsApp(full.data, this.app.settings);
          const wa = await API.sendWhatsAppMessage({
            phone: full.data.customer_phone,
            recipient_name: full.data.customer_name || 'Customer',
            message_type: 'layby',
            body: laybyMsg
          }, this.app.user);
          await Utils.deliverWhatsApp(wa, full.data.customer_phone, laybyMsg);
        }
      }
    });
  },

  async shareCashOutWhatsApp(cashup) {
    const adminPhone = Utils.getCashoutWhatsAppPhone(this.app.settings);
    if (!adminPhone) return Utils.toast('Cashout WhatsApp number not configured — set it in Admin → Shift Management', 'error');
    const currency = this.app.settings?.currency || 'R';
    const msg = `Shift cash-out — ${cashup.user_name || 'Cashier'}\nExpected: ${Utils.formatMoney(cashup.expected_cash, currency)}\nActual: ${Utils.formatMoney(cashup.actual_cash, currency)}\nDifference: ${Utils.formatMoney(cashup.difference, currency)}\n${cashup.notes ? `Notes: ${cashup.notes}` : ''}`;
    const r = await API.sendWhatsAppMessage({
      phone: adminPhone,
      recipient_name: 'Admin',
      message_type: 'cashout',
      body: msg
    }, this.app.user);
    await Utils.deliverWhatsApp(r, adminPhone, msg);
  },

  async showCashOutHistory() {
    const currency = this.app.settings?.currency || 'R';
    const res = await API.getCashUps({ limit: 50 });
    const rows = res.data || [];
    Utils.showModal('Cashout History', `
      <p class="muted">Cash-ups save automatically when you close a shift. Admin/manager/supervisor must approve them in Operations → Cash-Up.</p>
      <div class="table-wrap" style="max-height:360px;overflow:auto"><table>
        <thead><tr><th>Date</th><th>Cashier</th><th>Expected</th><th>Actual</th><th>Diff</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(c => `<tr>
          <td>${Utils.formatDateTime(c.created_at)}</td>
          <td>${c.user_name || '—'}</td>
          <td>${Utils.formatMoney(c.expected_cash, currency)}</td>
          <td>${Utils.formatMoney(c.actual_cash, currency)}</td>
          <td style="color:${(c.difference||0)===0?'var(--success)':'var(--danger)'}">${Utils.formatMoney(c.difference, currency)}</td>
          <td>${c.manager_approved ? 'Approved' : 'Pending'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost co-pdf" data-id="${c.id}">PDF</button>
            <button class="btn btn-sm btn-ghost co-print" data-id="${c.id}">Print</button>
            <button class="btn btn-sm btn-ghost co-wa" data-id="${c.id}">WhatsApp</button>
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No cash-outs yet</td></tr>'}
        </tbody></table></div>`,
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    const modal = document.getElementById('modal-body') || document.querySelector('.modal-body');
    const root = modal || document;
    root.querySelectorAll('.co-pdf').forEach(b => b.addEventListener('click', async () => {
      await Utils.savePdfBuffer(`cashout-${b.dataset.id}.pdf`, await API.getCashUpPdf(parseInt(b.dataset.id, 10)));
    }));
    root.querySelectorAll('.co-print').forEach(b => b.addEventListener('click', async () => {
      await Utils.printToA4(await API.getCashUpPdf(parseInt(b.dataset.id, 10)), `cashout-${b.dataset.id}.pdf`);
    }));
    root.querySelectorAll('.co-wa').forEach(b => b.addEventListener('click', async () => {
      const c = rows.find(x => x.id === parseInt(b.dataset.id, 10));
      if (c) await this.shareCashOutWhatsApp(c);
    }));
  },

  async showVoidSale() {
    if (!Utils.hasPermission(this.app.user, 'void_sales') && !['cashier', 'manager', 'owner'].includes(this.app.user?.role)) {
      return Utils.toast('You do not have permission to void sales', 'error');
    }
    const needCode = this.app.user.role === 'cashier';
    Utils.showModal('Void Sale', `
      <p class="muted">${needCode ? 'Enter receipt number and today\'s supervisor code from your manager.' : 'Enter receipt number and reason to void a sale. Stock will be restored.'}</p>
      <div class="field"><label>Receipt Number</label><input id="void-receipt" placeholder="RCP-..." value="${this.lastSale?.receipt_number || ''}"></div>
      <div class="field"><label>Reason</label><input id="void-reason" placeholder="Wrong item, duplicate, etc."></div>
      ${needCode ? `<div class="field"><label>Supervisor Code *</label><input type="password" id="void-super-code" maxlength="6" placeholder="Daily code from admin"></div>` : ''}`,
      '<button class="btn btn-danger" id="void-confirm">Void Sale</button>');
    document.getElementById('void-confirm').addEventListener('click', async () => {
      const receipt = document.getElementById('void-receipt').value.trim();
      const reason = document.getElementById('void-reason').value.trim();
      const code = document.getElementById('void-super-code')?.value.trim();
      if (!receipt || !reason) return Utils.toast('Receipt and reason required', 'error');
      if (needCode && !code) return Utils.toast('Supervisor code required', 'error');
      const saleRes = await API.getSaleByReceipt(receipt);
      if (!saleRes.success || !saleRes.data) return Utils.toast('Receipt not found', 'error');
      const r = await API.voidSale(saleRes.data.id, reason, this.app.user, code || null);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Sale voided — stock restored', 'success');
      const prodRes = await API.getProducts();
      this.products = prodRes.data || [];
      this.rebuildProductLookups();
      this.renderProducts();
    });
  },

  async showCashOut() {
    if (!this.openShift) return Utils.toast('No open shift', 'error');
    const existing = await API.getCashUpByShift(this.openShift.id);
    if (existing.success && existing.data) {
      return Utils.toast('This shift has already been cashed out', 'error');
    }
    const currency = this.app.settings?.currency || 'R';
    const previewRes = await API.getShiftClosePreview(this.openShift.id, this.app.user);
    if (!previewRes.success) return Utils.toast(previewRes.error || 'Could not load shift preview', 'error');
    const preview = previewRes.data;
    const labels = Utils.paymentLabels;
    const methods = ['cash', 'card', 'eft', 'mobile', 'account', 'giftcard', 'other'];

    const paymentRows = methods.map(m => {
      const expected = preview.expectedPayments[m] || 0;
      const cashExpected = m === 'cash' ? preview.expectedCash : expected;
      return `<div class="field"><label>${labels[m] || m} — expected ${Utils.formatMoney(cashExpected, currency)}</label>
        <input type="number" class="co-actual" data-method="${m}" step="0.01" min="0" placeholder="Actual counted"></div>`;
    }).join('');
    const targetHtml = preview.dailyTarget > 0 ? `
      <div style="margin:12px 0;padding:10px;background:var(--bg-secondary);border-radius:8px;font-size:13px">
        <strong>Daily target:</strong> ${Utils.formatMoney(preview.dailyTarget, currency)} ·
        <strong>Today:</strong> ${Utils.formatMoney(preview.todaySales, currency)} ·
        <strong>Remaining:</strong> ${Utils.formatMoney(preview.targetRemaining, currency)}
        ${preview.targetMet ? '<span class="tag tag-ok">Target reached</span>' : ''}
      </div>` : '';
    const dropsHtml = (preview.cashDrops || []).length
      ? `<div style="margin:10px 0;padding:10px;background:var(--bg-secondary);border-radius:8px;font-size:13px">
          <strong>Cash sent to admin this shift:</strong> ${Utils.formatMoney(preview.cashDropsTotal || 0, currency)}
          <ul style="margin:6px 0 0;padding-left:18px">${preview.cashDrops.map(d =>
            `<li>${Utils.formatMoney(d.amount, currency)} · ${d.status}${d.proof_path ? ' · proof attached' : ''}</li>`
          ).join('')}</ul>
          <small class="muted">Expected drawer cash already subtracts these drops.</small>
        </div>`
      : '';
    Utils.showModal('Cash Out & End Shift', `
      <p class="muted">Count each payment method and close your shift. Cash-out is saved as <strong>Pending</strong> for manager/admin approval in Operations → Cash-Up. Closing routines are done in the Staff Portal.</p>
      ${targetHtml}
      ${dropsHtml}
      <p><strong>Shift sales:</strong> ${Utils.formatMoney(preview.totalSales, currency)} (${preview.saleCount || 0} orders)</p>
      <div class="form-grid">${paymentRows}</div>
      <div id="co-summary" class="muted" style="margin-top:8px;font-size:13px"></div>
      <div class="field"><label>Notes (optional)</label><input id="co-notes"></div>`,
      '<button class="btn btn-warning" id="co-confirm">Cash Out & Logout</button>');
    const updateSummary = () => {
      const actual = {};
      let totalActual = 0;
      let totalExpected = preview.totalSales;
      document.querySelectorAll('.co-actual').forEach(inp => {
        const m = inp.dataset.method;
        const val = parseFloat(inp.value) || 0;
        actual[m] = val;
        totalActual += val;
      });
      const shortage = totalActual - totalExpected;
      const el = document.getElementById('co-summary');
      if (el) el.innerHTML = `Total counted: <strong>${Utils.formatMoney(totalActual, currency)}</strong> · Expected sales: ${Utils.formatMoney(totalExpected, currency)} · Difference: <strong style="color:${shortage < 0 ? 'var(--danger)' : 'inherit'}">${Utils.formatMoney(shortage, currency)}</strong>`;
    };
    document.querySelectorAll('.co-actual').forEach(inp => inp.addEventListener('input', updateSummary));
    document.getElementById('co-confirm').addEventListener('click', async () => {
      const actualPayments = {};
      document.querySelectorAll('.co-actual').forEach(inp => {
        actualPayments[inp.dataset.method] = parseFloat(inp.value) || 0;
      });
      const shortages = {};
      for (const m of methods) {
        const expected = m === 'cash' ? preview.expectedCash : (preview.expectedPayments[m] || 0);
        shortages[m] = (actualPayments[m] || 0) - expected;
      }
      const r = await API.closeShift(this.openShift.id, {
        cash_counted: actualPayments.cash || 0,
        closing_balance: actualPayments.cash || 0,
        actual_payments: actualPayments,
        payment_shortages: shortages,
        notes: document.getElementById('co-notes').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Shift closed — cash-out pending approval. Goodbye!', 'success');
      this.openShift = null;
      this.app.logout();
    });
  },

  async showCashDrop() {
    if (!this.requireShift('sending cash to admin')) return;
    const currency = this.app.settings?.currency || 'R';
    const listRes = await API.getCashDrops({ shift_id: this.openShift.id });
    const drops = listRes.data || [];
    let proofImage = null;
    Utils.showModal('Send Cash to Admin', `
      <p class="muted">Send small cash amounts to admin/safe during the shift. Attach photo proof each time. Keep sending until cash-out.</p>
      <div class="field"><label>Amount (${currency})</label><input type="number" id="cd-amount" min="0.01" step="0.01" autofocus></div>
      <div class="field"><label>Notes (optional)</label><input id="cd-notes" placeholder="e.g. Safe drop #2"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
        <button type="button" class="btn btn-ghost btn-sm" id="cd-photo">📷 Take photo proof</button>
        <button type="button" class="btn btn-ghost btn-sm" id="cd-upload">🖼 Upload proof</button>
        <span id="cd-proof-status" class="muted">No proof yet</span>
      </div>
      ${drops.length ? `<h4 style="margin-top:12px">This shift</h4>
        <ul style="padding-left:18px;margin:0">${drops.map(d =>
          `<li>${Utils.formatMoney(d.amount, currency)} · ${d.status}${d.proof_path ? ' · proof' : ''} · ${Utils.formatDateTime(d.created_at)}</li>`
        ).join('')}</ul>` : ''}`,
      '<button class="btn btn-primary" id="cd-save">Record &amp; Send</button>');
    document.getElementById('cd-photo')?.addEventListener('click', async () => {
      try {
        proofImage = await Utils.captureProofPhoto();
        if (proofImage) document.getElementById('cd-proof-status').textContent = 'Photo attached';
      } catch (err) {
        Utils.toast(err.message || 'Camera unavailable', 'error');
      }
    });
    document.getElementById('cd-upload')?.addEventListener('click', async () => {
      try {
        proofImage = await Utils.pickProofImage();
        if (proofImage) document.getElementById('cd-proof-status').textContent = 'Image attached';
      } catch (err) {
        Utils.toast(err.message || 'Upload cancelled', 'error');
      }
    });
    document.getElementById('cd-save')?.addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('cd-amount')?.value);
      if (!(amount > 0)) return Utils.toast('Enter amount', 'error');
      const r = await API.recordCashDrop({
        shift_id: this.openShift.id,
        amount,
        notes: document.getElementById('cd-notes')?.value.trim() || '',
        proof_image: proofImage
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not record', 'error');
      Utils.hideModal();
      Utils.toast(`Sent ${Utils.formatMoney(amount, currency)} to admin`, 'success');
    });
  },

  async showPosSalesHistory() {
    const today = Utils.today();
    const res = await API.getSalesList({ from: today, to: today, limit: 40, pos_only: true });
    const rows = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal('POS Sales Today', `
      <p class="muted" style="margin:0 0 12px">Counter sales only (excludes web online orders). Tap Reprint to send to your receipt printer.</p>
      <div style="max-height:420px;overflow:auto">
        ${rows.length ? rows.map((s) => `<div class="list-row" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0">
            <strong>${Utils.escHtml(s.receipt_number || s.order_number || `#${s.id}`)}</strong>
            <div class="muted" style="font-size:12px">${Utils.escHtml(String(s.created_at || '').slice(11, 16))} · ${Utils.escHtml(s.cashier_name || '—')}</div>
            <div class="muted" style="font-size:12px">${Utils.escHtml(s.item_summary || '')}</div>
          </div>
          <div style="text-align:right;white-space:nowrap">
            <div style="font-weight:700">${Utils.formatMoney(s.total, currency)}</div>
            <button type="button" class="btn btn-primary btn-sm pos-reprint-sale" data-id="${s.id}" style="margin-top:6px">Reprint</button>
          </div>
        </div>`).join('') : '<p class="muted">No POS sales recorded today yet.</p>'}
      </div>`,
      '<button class="btn btn-ghost" id="pos-sales-history-close">Close</button>');
    document.getElementById('pos-sales-history-close')?.addEventListener('click', () => Utils.hideModal());
    document.querySelectorAll('.pos-reprint-sale').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const saleRes = await API.getSale(parseInt(btn.dataset.id, 10));
          const sale = saleRes?.data || saleRes?.sale || saleRes;
          if (!sale?.id) throw new Error('Sale not found');
          await Receipt.print(sale, this.app.settings);
          Utils.toast('Sent to printer', 'success');
        } catch (err) {
          Utils.toast(err.message || 'Reprint failed', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  },

  async showReprint() {
    Utils.showModal('Reprint Receipt', `
      <div class="field"><label>Receipt Number</label><input id="reprint-num" placeholder="RCP-..."></div>`,
      '<button class="btn btn-primary" id="do-reprint">Reprint</button><button class="btn btn-ghost" id="reprint-last">Last Receipt</button>');
    document.getElementById('reprint-last')?.addEventListener('click', async () => {
      if (!this.lastSale) return Utils.toast('No recent sale', 'error');
      await Receipt.print(this.lastSale, this.app.settings);
      Utils.hideModal();
    });
    document.getElementById('do-reprint')?.addEventListener('click', async () => {
      const num = document.getElementById('reprint-num').value.trim();
      if (!num) return;
      const res = await API.getSaleByReceipt(num);
      if (!res.success || !res.data) return Utils.toast('Receipt not found', 'error');
      await Receipt.print(res.data, this.app.settings);
      Utils.hideModal();
    });
  },

  async openKitchenDisplay() {
    const native = !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
    if (native && window.App?.openInAppDisplay) {
      window.App.openInAppDisplay('kitchen');
      return;
    }
    const r = await API.openKitchenDisplay();
    if (r.success) Utils.toast('Kitchen display opened — drag to your side screen', 'success');
    else Utils.toast(r.error || 'Could not open kitchen display', 'error');
  },

  async openCustomerDisplay() {
    const native = !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
    if (native && window.App?.openInAppDisplay) {
      window.App.openInAppDisplay('customer');
      return;
    }
    const r = await API.openCustomerDisplay();
    if (r.success) Utils.toast('Customer board opened — drag to the customer screen', 'success');
    else Utils.toast(r.error || 'Could not open customer display', 'error');
  },

  async showPrinterSetup() {
    const ps = this.app.settings?.printer_settings || {};
    const ds = Utils.mergeDeviceSettings(this.app.settings);
    let printers = [];
    try { const pr = await API.getPrinters(); printers = pr.data || pr || []; } catch { printers = []; }
    const connOpts = (sel) => ['usb', 'bluetooth', 'network'].map(c =>
      `<option value="${c}" ${sel === c ? 'selected' : ''}>${c === 'usb' ? 'USB' : c === 'bluetooth' ? 'Bluetooth' : 'Network'}</option>`
    ).join('');
    const opts = (sel, fallback) => {
      const names = printers.map(p => p.name).filter(Boolean);
      const list = names.length ? names : [''];
      return list.map(n => `<option value="${n}" ${(sel || fallback) === n ? 'selected' : ''}>${n || 'No printer detected'}</option>`).join('');
    };

    const isAndroid = !!(window.Capacitor?.isNativePlatform?.() || window.__SHOP_POS_MOBILE__);
    Utils.showModal('Receipt Printer', `
      <p class="muted">${isAndroid
        ? 'Android uses the <strong>system print dialog</strong> (not silent Windows ESC/POS). After a sale, pick a printer in that dialog.'
        : 'Uses the receipt printer from <strong>Admin → Printer Setup</strong>. Connect your thermal printer below if needed.'}</p>
      <div class="form-grid">
        <div class="field"><label>Receipt Printer (58/80mm)</label>
          <select id="pos-pr-receipt">${opts(ds.receipt_printer || ps.receipt_printer, ps.receipt_printer)}</select></div>
        <div class="field"><label>Connection</label>
          <select id="pos-pr-receipt-conn">${connOpts(ds.receipt_connection || ps.receipt_connection || 'usb')}</select></div>
        <div class="field full"><div id="pos-pr-conn-panel"></div></div>
        <div class="field"><label>Paper Size</label>
          <select id="pos-pr-paper">
            <option value="58mm" ${(ds.paper_size || ps.paper_size) === '58mm' ? 'selected' : ''}>58mm</option>
            <option value="80mm" ${(ds.paper_size || ps.paper_size || '80mm') === '80mm' ? 'selected' : ''}>80mm</option>
          </select></div>
      </div>
      <div id="pos-pr-status" style="margin-top:12px"></div>`,
      `<button class="btn btn-primary" id="pos-pr-save">Save Printer</button>
       <button class="btn btn-ghost" id="pos-pr-test-receipt">Test Receipt</button>`);

    const onSelected = (name) => {
      const el = document.getElementById('pos-pr-receipt');
      if (el && name) el.value = name;
    };
    await PrinterUI.bindConnectionFilter('pos-pr-receipt-conn', 'pos-pr-receipt', ds.receipt_printer || ps.receipt_printer, { panelContainerId: 'pos-pr-conn-panel', statusElId: 'pos-pr-status-conn', onSelected });

    document.getElementById('pos-pr-save').addEventListener('click', async () => {
      const patch = {
        receipt_printer: document.getElementById('pos-pr-receipt').value,
        receipt_connection: document.getElementById('pos-pr-receipt-conn').value,
        paper_size: document.getElementById('pos-pr-paper').value
      };
      Utils.saveLocalDeviceSettings(patch);
      if (['owner', 'manager'].includes(this.app.user?.role)) {
        await API.saveJsonSetting('printer_settings', { ...ps, ...patch }, this.app.user);
        this.app.settings.printer_settings = { ...ps, ...patch };
      }
      Utils.toast('This till’s receipt printer saved', 'success');
    });

    const printOpts = () => Receipt._devicePrintOpts(this.app.settings);

    document.getElementById('pos-pr-test-receipt').addEventListener('click', async () => {
      const html = Receipt.build({
        receipt_number: 'TEST', created_at: new Date().toISOString(),
        cashier_name: this.app.user.full_name,
        items: [{ product_name: 'Test Item', quantity: 1, unit_price: 10, total: 10 }],
        payments: [{ payment_type: 'cash', amount: 10 }],
        subtotal: 10, total: 10, change_amount: 0
      }, this.app.settings);
      const r = await API.printReceipt(html, printOpts());
      Utils.toast(r.success ? 'Test sent' : r.error, r.success ? 'success' : 'error');
    });
  },

  async printKitchenSafe(sale) {
    const ps = this.app.settings?.printer_settings || {};
    if (ps.kitchen_enabled === false) return;
    const kitchenItems = (sale.items || []).filter(i => Receipt.isKitchenItem(i));
    if (!kitchenItems.length) return;
    try {
      await API.createKitchenOrder({
        sale_id: sale.id,
        order_number: sale.order_number || null,
        table_id: sale.table_id || this.selectedTable?.id || null,
        items: kitchenItems.map(i => ({
          product_name: Receipt.itemLabel(i),
          quantity: i.quantity,
          modifiers: i.modifiers_text || null,
          notes: i.allergens ? `Allergens: ${i.allergens}` : null
        }))
      }, this.app.user);
      await API.refreshKitchenDisplay();
      try { await API.refreshCustomerDisplay(); } catch (_) {}
    } catch (_) { /* KDS optional */ }
    if (ps.kitchen_auto === false) return;
    try {
      await Receipt.printKitchen(sale, kitchenItems, this.app.settings);
    } catch (_) { /* print optional */ }
  },

  async printReceiptSafe(sale) {
    const ps = this.app.settings?.printer_settings || {};
    if (ps.auto_print === false) return;
    const printOpts = Receipt._devicePrintOpts(this.app.settings);
    const hasCash = (sale.payments || []).some(p => (p.type || p.payment_type) === 'cash');
    try {
      const html = Receipt.build(sale, this.app.settings);
      const r = await API.printReceipt(html, {
        silent: true,
        ...printOpts
      });
      if (ps.open_drawer && hasCash) {
        await API.openCashDrawer().catch(() => {});
      }
      if (!r.success) {
        Utils.toast(`Receipt print failed: ${r.error || 'Check printer in Admin → Printer Setup'}`, 'error');
      }
    } catch (err) {
      Utils.toast(`Receipt print failed: ${err.message || 'Printer error'}`, 'error');
    }
  },

  promptSaleManagerPin(message) {
    return new Promise((resolve) => {
      Utils.showModal('Manager Authorization', `
        <p class="muted">${message || 'A sale rule requires manager approval.'}</p>
        <div class="field"><label>Manager PIN</label>
          <input type="password" id="sale-mgr-pin" maxlength="12" inputmode="numeric" autofocus></div>`,
        '<button class="btn btn-primary" id="sale-mgr-ok">Approve</button><button class="btn btn-ghost" id="sale-mgr-cancel">Cancel</button>');
      const done = (val) => { Utils.hideModal(); resolve(val); };
      document.getElementById('sale-mgr-ok')?.addEventListener('click', async () => {
        const pin = document.getElementById('sale-mgr-pin')?.value?.trim();
        if (!pin) return Utils.toast('Enter manager PIN', 'error');
        const r = await API.verifyManagerPin(pin);
        if (!r.success) return Utils.toast(r.error || 'Invalid manager PIN', 'error');
        done(pin);
      });
      document.getElementById('sale-mgr-cancel')?.addEventListener('click', () => done(null));
      document.getElementById('sale-mgr-pin')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('sale-mgr-ok')?.click();
      });
    });
  },

  showDiscountModal() {
    const ds = this.app.settings?.discount_settings || {};
    const needPin = this.app.settings?.security_settings?.require_approval_discounts !== false
      && !['owner', 'manager'].includes(this.app.user?.role);
    if (!ds.happy_hour && !ds.coupon_codes && !ds.loyalty_discounts && !ds.employee_discounts && ds.max_percent === 0) {
      return Utils.toast('Discounts are disabled in Admin → Discounts', 'error');
    }
    if (!needPin) return this.showDiscountAmountModal(this.app.user);
    Utils.showModal('Manager Authorization', `
      <p class="muted">A manager PIN is required before applying any discount.</p>
      <div class="field"><label>Manager PIN</label>
        <input type="password" id="disc-mgr-pin" maxlength="12" inputmode="numeric" autofocus></div>`,
      '<button class="btn btn-primary" id="disc-mgr-ok">Continue</button>');
    document.getElementById('disc-mgr-ok').addEventListener('click', async () => {
      const pin = document.getElementById('disc-mgr-pin').value.trim();
      if (!pin) return Utils.toast('Enter manager PIN', 'error');
      const r = await API.verifyManagerPin(pin);
      if (!r.success) return Utils.toast(r.error || 'Invalid manager PIN', 'error');
      Utils.hideModal();
      this.discountManagerPin = pin;
      this.showDiscountAmountModal(r.data);
    });
    document.getElementById('disc-mgr-pin')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('disc-mgr-ok')?.click();
    });
  },

  showDiscountAmountModal(approver) {
    const maxPct = this.app.settings?.discount_settings?.max_percent;
    const currency = this.app.settings?.currency || 'R';
    const subtotal = this.cart.reduce((s, i) => s + i.total, 0);
    const costFloor = this.cart.reduce((s, i) => {
      const p = this.products.find(x => x.id === i.product_id);
      const unitCost = Number(p?.recipe_cost || p?.buying_price || i.buying_price || 0);
      return s + unitCost * (Number(i.quantity) || 0);
    }, 0);
    const maxDiscByProfit = Math.max(0, Math.round((subtotal - costFloor) * 100) / 100);
    Utils.showModal('Apply Discount', `
      ${approver ? `<p class="muted">Approved by ${approver.full_name}</p>` : ''}
      <div class="field"><label>Discount Amount (${currency})</label>
      <input type="number" id="discount-amount" min="0" step="0.01" value="${this.discount}"></div>
      <p class="muted" style="font-size:12px">Discount cannot go below profit (max ${Utils.formatMoney(maxDiscByProfit, currency)} so sale stays above cost).</p>
      ${maxPct ? `<p class="muted" style="font-size:12px">Admin max: ${maxPct}% of subtotal</p>` : ''}`,
      '<button class="btn btn-primary" id="apply-discount">Apply</button>');
    document.getElementById('apply-discount').addEventListener('click', () => {
      const amount = parseFloat(document.getElementById('discount-amount').value) || 0;
      if (maxPct && subtotal > 0 && amount > subtotal * maxPct / 100) {
        return Utils.toast(`Discount cannot exceed ${maxPct}%`, 'error');
      }
      if (amount > maxDiscByProfit + 0.02) {
        return Utils.toast(`Discount would sell below cost. Max allowed: ${Utils.formatMoney(maxDiscByProfit, currency)}`, 'error');
      }
      this.discount = amount;
      this.discountApprover = approver || null;
      this.renderCart();
      Utils.hideModal();
    });
  },

  showOtherItemModal() {
    if (!this.requireShift('selling other items')) return;
    const currency = this.app.settings?.currency || 'R';
    const targetProfit = Number(this.app.settings?.default_profit_pct) || 40;
    Utils.showModal('Other Item (Sell)', `
      <p class="muted">Adds to the <strong>Other Items</strong> POS category and records in sales. Suggests a price that protects profit.</p>
      <div class="field"><label>Item name *</label><input id="oi-name" placeholder="e.g. Plastic bag, Delivery fee" autofocus></div>
      <div class="field"><label>Cost / buying price (${currency})</label><input type="number" id="oi-cost" min="0" step="0.01" value="0"></div>
      <div class="field"><label>Target profit %</label><input type="number" id="oi-profit" min="0" max="95" step="1" value="${targetProfit}"></div>
      <div class="field"><label>Selling price (${currency}) *</label><input type="number" id="oi-sell" min="0" step="0.01" value="0"></div>
      <p class="muted" id="oi-hint">Enter cost to see suggested best price</p>
      <div class="field"><label>Qty</label><input type="number" id="oi-qty" min="1" step="1" value="1"></div>`,
      '<button class="btn btn-ghost" id="oi-cancel">Cancel</button><button class="btn btn-primary" id="oi-suggest">Suggest price</button><button class="btn btn-success" id="oi-add">Add to cart</button>');
    const syncSuggest = async () => {
      const cost = parseFloat(document.getElementById('oi-cost').value) || 0;
      const pct = parseFloat(document.getElementById('oi-profit').value) || 40;
      const r = await API.suggestSellPrice(cost, pct);
      const suggested = r.success ? (r.data || 0) : 0;
      const hint = document.getElementById('oi-hint');
      if (hint) {
        hint.textContent = cost > 0
          ? `Suggested best price for ${pct}% profit: ${Utils.formatMoney(suggested, currency)}`
          : 'Enter cost to see suggested best price';
      }
      return suggested;
    };
    document.getElementById('oi-cancel')?.addEventListener('click', Utils.hideModal);
    document.getElementById('oi-suggest')?.addEventListener('click', async () => {
      const suggested = await syncSuggest();
      if (suggested > 0) document.getElementById('oi-sell').value = suggested;
    });
    document.getElementById('oi-cost')?.addEventListener('change', syncSuggest);
    document.getElementById('oi-profit')?.addEventListener('change', syncSuggest);
    document.getElementById('oi-add')?.addEventListener('click', async () => {
      const name = document.getElementById('oi-name').value.trim();
      const cost = parseFloat(document.getElementById('oi-cost').value) || 0;
      const sell = parseFloat(document.getElementById('oi-sell').value) || 0;
      const qty = Math.max(1, parseInt(document.getElementById('oi-qty').value, 10) || 1);
      const pct = parseFloat(document.getElementById('oi-profit').value) || 40;
      if (!name) return Utils.toast('Item name required', 'error');
      if (!(sell > 0)) return Utils.toast('Selling price required', 'error');
      let payload = { name, buying_price: cost, selling_price: sell, target_profit_pct: pct };
      let r = await API.saveOtherSellItem(payload, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save item', 'error');
      if (r.data?.needs_confirm) {
        const apply = confirm(`${r.data.error}\n\nApply suggested price ${Utils.formatMoney(r.data.suggested_price, currency)}?`);
        if (!apply) return;
        payload = { ...payload, selling_price: r.data.suggested_price, force_below_profit: false };
        r = await API.saveOtherSellItem(payload, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not save item', 'error');
        if (r.data?.needs_confirm) return Utils.toast(r.data.error, 'error');
      }
      const product = r.data;
      if (!product?.id) return Utils.toast('Could not create other item', 'error');
      if (!this.products.find(p => p.id === product.id)) this.products.push(product);
      this.rebuildProductLookups();
      // Ensure Other Items category tab exists
      if (product.category_id && !this.categories.find(c => c.id === product.category_id)) {
        const cats = await API.getCategories({ for_pos: true });
        this.categories = cats.data || this.categories;
        const tabs = document.getElementById('pos-categories');
        if (tabs && !tabs.querySelector(`[data-cat="${product.category_id}"]`)) {
          const cat = this.categories.find(c => c.id === product.category_id);
          if (cat) tabs.insertAdjacentHTML('beforeend', `<button class="cat-tab" data-cat="${cat.id}" style="border-color:${cat.color || '#64748b'}">${cat.name}</button>`);
        }
      }
      await this.addToCart(product);
      if (qty > 1) {
        const line = this.cart.find(i => i.product_id === product.id && !i.combo_id);
        if (line) {
          line.quantity = qty;
          line.total = line.quantity * line.unit_price;
          this.renderCart();
        }
      }
      Utils.hideModal();
      Utils.toast(`Added ${qty}× ${product.name} to cart`, 'success');
      this.selectedCategory = String(product.category_id || '');
      document.querySelectorAll('#pos-categories .cat-tab').forEach(b =>
        b.classList.toggle('active', String(b.dataset.cat) === String(this.selectedCategory)));
      this.renderProducts();
    });
  },

  async holdOrder() {
    if (!this.requireShift('holding orders')) return;
    if (!this.cart.length) return Utils.toast('Cart is empty', 'error');
    await API.holdOrder(null, {
      items: this.cart,
      discount: this.discount,
      customer: this.selectedCustomer,
      table: this.selectedTable,
      orderType: this.orderType,
      deliveryAddress: this.deliveryAddress
    }, this.app.user);
    this.cart = []; this.discount = 0; this.selectedTable = null;
    this.renderCart();
    Utils.toast('Order held', 'success');
    this.updatePosBadges();
  },

  loadQuoteIntoCart(quote) {
    this.cart = (quote.items || []).map(i => ({
      product_id: i.product_id,
      product_name: i.product_name || i.name || 'Item',
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      discount: Number(i.discount) || 0,
      total: Number(i.total) || (Number(i.unit_price) * Number(i.quantity))
    }));
    this.discount = Number(quote.discount) || 0;
    this.loadedQuoteId = quote.status === 'open' ? quote.id : null;
    if (quote.customer_id) {
      this.selectedCustomer = {
        id: quote.customer_id,
        name: quote.customer_name || 'Customer',
        phone: quote.customer_phone || null
      };
      this.selectCustomer(this.selectedCustomer);
    }
    this.renderCart();
  },

  async saveCartAsQuote() {
    if (!this.cart.length) return Utils.toast('Add items to cart first', 'error');
    if (!this.totals?.total && this.totals?.total !== 0) this.renderCart();
    const grossSubtotal = this.cart.reduce((s, i) => s + i.total, 0);
    const taxEnabled = !!this.app.settings?.tax_enabled;
    const taxRatePct = taxEnabled ? (this.app.settings?.tax_rate || 0) : 0;
    const totals = Utils.calcTaxInclusive(grossSubtotal, this.discount, taxRatePct, taxEnabled);
    const data = {
      customer_id: this.selectedCustomer?.id || null,
      items: this.cart.map(i => ({
        product_id: i.product_id, product_name: i.product_name || i.name, quantity: i.quantity,
        unit_price: i.unit_price, discount: i.discount || 0, total: i.total
      })),
      subtotal: totals.subtotal, discount: this.discount || 0, tax_amount: totals.tax_amount, total: totals.total,
      notes: 'Created from POS'
    };
    const r = await API.saveQuote(data, this.app.user);
    if (!r.success) return Utils.toast(r.error, 'error');
    const quote = r.data?.quote_number ? r.data : (await API.getQuote(typeof r.data === 'number' ? r.data : r.data?.id))?.data;
    if (quote) {
      quote.user_name = quote.user_name || this.app.user.full_name;
      if (this.selectedCustomer?.name) quote.customer_name = this.selectedCustomer.name;
      if (this.selectedCustomer?.phone) quote.customer_phone = this.selectedCustomer.phone;
      try {
        await Receipt.printQuote(quote, this.app.settings, 'thermal');
        Utils.toast(`Quote ${quote.quote_number} saved & printed`, 'success');
      } catch {
        Utils.toast(`Quote ${quote.quote_number} saved — printer unavailable`, 'success');
      }
      if (quote.customer_phone) {
        const wa = await Utils.sendQuoteWhatsApp(this.app, quote);
        if (!wa.success) Utils.toast(wa.error || 'Quote WhatsApp failed', 'error');
      }
    } else {
      Utils.toast('Quote saved — view in Saved Quotes tab', 'success');
    }
    this.cart = [];
    this.discount = 0;
    this.loadedQuoteId = null;
    this.renderCart();
    if (this.quoteTab === 'saved') {
      await this.renderSavedQuotesPanel(false);
    } else if (this.quoteTab === 'history') {
      await this.renderSavedQuotesPanel(true);
    }
    this.updatePosBadges();
  },

  showScannerSettings() {
    const ds = Utils.mergeDeviceSettings(this.app.settings);
    Utils.showModal('Barcode Scanner (USB / Bluetooth)', `
      <p class="muted">USB and Bluetooth scanners type into the search box. Shop-wide beep / camera / prefix is in <strong>Admin → Device Settings → Barcode Scanner</strong>.</p>
      <div class="form-grid">
        <div class="field"><label>Scanner Type</label>
          <select id="sc-type">
            <option value="usb_hid" ${ds.scanner_type === 'usb_hid' || !ds.scanner_type ? 'selected' : ''}>USB (keyboard wedge)</option>
            <option value="bluetooth_hid" ${ds.scanner_type === 'bluetooth_hid' ? 'selected' : ''}>Bluetooth (keyboard wedge)</option>
          </select></div>
        <div class="field full"><label><input type="checkbox" id="sc-auto" ${ds.scanner_auto_mode !== false ? 'checked' : ''}> Auto-enable scan mode on POS open</label></div>
        <div class="field full"><label><input type="checkbox" id="sc-enter" ${ds.scanner_enter_submit !== false ? 'checked' : ''}> Treat Enter key as end of scan</label></div>
      </div>`,
      '<button class="btn btn-primary" id="sc-save">Save & Enable Scan Mode</button>');
    document.getElementById('sc-save').addEventListener('click', () => {
      const data = {
        scanner_type: document.getElementById('sc-type').value,
        scanner_auto_mode: document.getElementById('sc-auto').checked,
        scanner_enter_submit: document.getElementById('sc-enter').checked
      };
      Utils.saveLocalDeviceSettings(data);
      Utils.hideModal();
      if (data.scanner_auto_mode) this.toggleScanMode(true);
      Utils.toast('Scanner settings saved', 'success');
    });
  },

  async showHeldOrders() {
    const res = await API.getHeldOrders();
    const orders = res.data || [];
    const html = orders.length ? orders.map(o =>
      `<div style="padding:10px;border-bottom:1px solid var(--border);cursor:pointer" data-hold-id="${o.id}">
        ${o.name} — ${(Array.isArray(o.cart_data) ? o.cart_data : o.cart_data?.items || []).length} items — ${Utils.formatDateTime(o.created_at)}
      </div>`).join('') : '<p class="muted">No held orders</p>';
    Utils.showModal('Held Orders', html);
    document.getElementById('modal-body').addEventListener('click', async (e) => {
      const el = e.target.closest('[data-hold-id]');
      if (!el) return;
      const order = orders.find(o => o.id == el.dataset.holdId);
      if (order) {
        const data = order.cart_data;
        if (Array.isArray(data)) this.cart = data;
        else {
          this.cart = data.items || [];
          this.discount = Number(data.discount) || 0;
          if (data.customer) this.selectCustomer(data.customer);
          this.selectedTable = data.table || null;
          if (data.orderType) this.orderType = data.orderType;
          if (data.deliveryAddress) this.deliveryAddress = data.deliveryAddress;
        }
        this.renderCart();
        await API.deleteHeldOrder(order.id, this.app.user);
        Utils.hideModal();
      }
    });
  },

  showPaymentModal() {
    if (this._checkoutBusy) return;
    if (!this.requireShift('completing sales')) return;
    if (!this.cart.length) return Utils.toast('Cart is empty', 'error');
    for (const item of this.cart) {
      if (!item.product_name?.trim()) return Utils.toast('Cart has an invalid item — remove and re-add it', 'error');
      const qty = Number(item.quantity);
      const total = Number(item.total);
      if (!qty || qty <= 0 || Number.isNaN(total) || total < 0) {
        return Utils.toast(`Invalid quantity or price for ${item.product_name}`, 'error');
      }
    }
    if (!this.totals?.total && this.totals?.total !== 0) this.renderCart();
    const saleTotal = Number(this.totals?.total);
    if (Number.isNaN(saleTotal) || saleTotal < 0) {
      return Utils.toast('Cart total is invalid — please review items', 'error');
    }
    this.promptOrderType(() => this.openPaymentFlow(saleTotal));
  },

  promptOrderType(onContinue) {
    const selected = this.orderType || '';
    const prefAddr = this.deliveryAddress
      || this.selectedCustomer?.address
      || this.selectedCustomer?.delivery_address
      || '';
    Utils.showModal('Order Type *', `
      <p class="muted" style="margin-bottom:12px">Select how this order will be fulfilled before payment.</p>
      <div class="form-grid">
        <label class="field full"><input type="radio" name="pos-order-type" value="delivery" ${selected === 'delivery' ? 'checked' : ''}> 🚚 Delivery</label>
        <label class="field full"><input type="radio" name="pos-order-type" value="takeaway" ${selected === 'takeaway' ? 'checked' : ''}> 🥡 Takeaway</label>
        <label class="field full"><input type="radio" name="pos-order-type" value="sit_in" ${selected === 'sit_in' ? 'checked' : ''}> 🍽️ Sit-in</label>
        <div class="field full" id="ot-addr-wrap" style="display:${selected === 'delivery' ? '' : 'none'}">
          <label>Delivery address *</label>
          <textarea id="ot-delivery-address" rows="2" placeholder="Street, suburb, city, landmarks…">${String(prefAddr || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}</textarea>
          <small class="muted">Shown on receipt, WhatsApp receipt, and Admin sales.</small>
        </div>
      </div>`,
      '<button class="btn btn-ghost" id="ot-cancel">Cancel</button><button class="btn btn-primary" id="ot-continue">Continue</button>');
    const syncAddr = () => {
      const isDel = document.querySelector('input[name="pos-order-type"]:checked')?.value === 'delivery';
      const wrap = document.getElementById('ot-addr-wrap');
      if (wrap) wrap.style.display = isDel ? '' : 'none';
    };
    document.querySelectorAll('input[name="pos-order-type"]').forEach(r => r.addEventListener('change', syncAddr));
    document.getElementById('ot-cancel')?.addEventListener('click', () => {
      Utils.hideModal();
      this._checkoutBusy = false;
      const payBtn = document.getElementById('pos-pay');
      if (payBtn) payBtn.disabled = false;
    });
    document.getElementById('ot-continue')?.addEventListener('click', () => {
      const picked = document.querySelector('input[name="pos-order-type"]:checked')?.value;
      if (!picked) return Utils.toast('Order type is required', 'error');
      if (picked === 'delivery') {
        const addr = document.getElementById('ot-delivery-address')?.value.trim() || '';
        if (!addr) {
          document.getElementById('ot-delivery-address')?.focus();
          return Utils.toast('Enter the delivery address', 'error');
        }
        this.deliveryAddress = addr;
      } else {
        this.deliveryAddress = null;
      }
      this.orderType = picked;
      Utils.hideModal();
      if (picked === 'sit_in') {
        this.showTablePicker({ required: true, onSelected: onContinue });
        return;
      }
      this.selectedTable = null;
      this.updateTableLabel();
      onContinue();
    });
  },

  async showTablePicker(opts = {}) {
    const required = !!opts.required;
    const onSelected = typeof opts.onSelected === 'function' ? opts.onSelected : null;
    const res = await API.getTables();
    const tables = res.data || [];
    if (!tables.length) {
      Utils.toast('No tables configured — add in Restaurant', 'error');
      return;
    }
    Utils.showModal(required ? 'Select Sit-in Table *' : 'Select Table', `
      <p class="muted" style="margin-bottom:10px">${required
        ? 'Choose a table for this sit-in order. The table stays occupied until you mark it available.'
        : 'Pick a table for this order.'}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px">
        ${tables.map(t => {
          const occ = !!t.is_occupied;
          return `<button type="button" class="btn ${occ ? 'btn-ghost' : 'btn-primary'} pos-table-opt" data-id="${t.id}" data-name="${t.table_number}"
            data-occupied="${occ ? '1' : '0'}"
            style="padding:12px;${occ ? 'opacity:0.45;border-color:var(--warning);cursor:not-allowed' : ''}"
            ${occ ? 'disabled title="Occupied — free the table first"' : ''}>
            ${t.table_number}<br><small>${occ ? 'occupied' : t.seats + ' seats'}</small></button>`;
        }).join('')}
      </div>
      ${!tables.some(t => !t.is_occupied) ? '<p class="muted" style="margin-top:12px;color:var(--warning)">No available tables. Use Free Table when guests leave.</p>' : ''}`,
      required
        ? '<button class="btn btn-ghost" id="table-cancel">Cancel</button>'
        : '<button class="btn btn-ghost" id="table-close">Close</button>');
    document.getElementById('table-close')?.addEventListener('click', Utils.hideModal);
    document.getElementById('table-cancel')?.addEventListener('click', () => {
      Utils.hideModal();
      if (required) {
        this.orderType = null;
        this.selectedTable = null;
        this.updateTableLabel();
      }
    });
    document.querySelectorAll('.pos-table-opt').forEach(btn => btn.addEventListener('click', () => {
      if (btn.disabled || btn.dataset.occupied === '1') {
        return Utils.toast('That table is occupied — choose an available table', 'error');
      }
      this.selectedTable = { id: parseInt(btn.dataset.id, 10), name: btn.dataset.name };
      this.orderType = 'sit_in';
      this.updateTableLabel();
      Utils.hideModal();
      if (onSelected) onSelected();
    }));
  },

  async showFreeTablePicker() {
    const res = await API.getTables();
    const tables = (res.data || []).filter(t => t.is_occupied || t.status === 'occupied');
    if (!tables.length) return Utils.toast('No occupied tables', 'success');
    Utils.showModal('Mark Table Available', `
      <p class="muted" style="margin-bottom:10px">When guests leave, mark the table available for the next sit-in.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
        ${tables.map(t => `<button type="button" class="btn btn-warning pos-free-opt" data-id="${t.id}" data-name="${t.table_number}"
          style="padding:14px">
          ${t.table_number}<br><small>occupied — free now</small></button>`).join('')}
      </div>`,
      '<button class="btn btn-ghost" id="free-table-close">Close</button>');
    document.getElementById('free-table-close')?.addEventListener('click', Utils.hideModal);
    document.querySelectorAll('.pos-free-opt').forEach(btn => btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const name = btn.dataset.name;
      const t = tables.find(x => x.id === id);
      if (!t) return;
      const r = await API.saveTable({
        id: t.id,
        table_number: t.table_number,
        seats: t.seats,
        status: 'available',
        waiter_id: t.waiter_id || null,
        notes: t.notes || null
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not free table', 'error');
      if (this.selectedTable?.id === id) {
        this.selectedTable = null;
        this.updateTableLabel();
      }
      Utils.hideModal();
      Utils.toast(`Table ${name} is now available`, 'success');
    }));
  },

  updateTableLabel() {
    const el = document.getElementById('pos-table-label');
    if (!el) return;
    if (this.selectedTable) {
      el.textContent = `Sit-in · Table ${this.selectedTable.name}`;
      el.style.display = 'inline';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  },

  openPaymentFlow(saleTotal) {
    if (this._checkoutBusy) return;
    this._checkoutBusy = true;
    const payBtn = document.getElementById('pos-pay');
    if (payBtn) payBtn.disabled = true;
    const releaseCheckout = () => {
      this._checkoutBusy = false;
      if (payBtn) payBtn.disabled = false;
    };
    const currency = this.app.settings?.currency || 'R';
    const total = saleTotal;
    this._gcBalances = {};

    PaymentUI.open({
      total,
      currency,
      settings: this.app.settings,
      customer: this.selectedCustomer,
      title: 'Complete Payment',
      confirmLabel: 'Complete Sale',
      gcBalancesRef: this._gcBalances,
      onAddCustomer: () => this.showAddCustomerModal(),
      onDismiss: releaseCheckout,
      onConfirm: async ({ payments, paid, change, loyaltyRedeem, loyaltyDiscount }) => {
        try {
        const saleData = {
          items: this.cart.map(i => ({
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            buying_price: i.buying_price || 0,
            discount: i.discount || 0,
            total: i.total,
            item_type: i.item_type || null,
            combo_id: i.combo_id || null,
            modifiers_text: i.modifiers_text || null,
            modifiers: i.modifiers || null,
            substitutions: i.substitutions || null,
            combo_components: i.combo_components || null
          })),
          customer_id: this.selectedCustomer?.id || null,
          loyalty_redeem: loyaltyRedeem || 0,
          subtotal: this.totals.subtotal,
          discount: this.totals.discount,
          discount_authorized: !!(this.discountApprover || (this.totals.discount > 0 && ['owner', 'manager'].includes(this.app.user?.role))),
          discount_approver_id: this.discountApprover?.id || null,
          discount_manager_pin: this.totals.discount > 0.02 ? this.discountManagerPin : null,
          tax_amount: this.totals.tax_amount,
          total: this.totals.total,
          amount_paid: paid,
          change_amount: change,
          payments,
          order_type: this.orderType,
          table_id: this.selectedTable?.id || null,
          table_name: this.selectedTable?.name || null,
          delivery_address: this.orderType === 'delivery' ? (this.deliveryAddress || null) : null,
          referral_code: (document.getElementById('pos-referral-code')?.value || '').trim() || null,
          mkt_coupon_code: (document.getElementById('pos-coupon-code')?.value || '').trim() || null,
          notes: [
            this.orderType ? `Order: ${({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in' })[this.orderType] || this.orderType}` : null,
            this.orderType === 'delivery' && this.deliveryAddress ? `Deliver to: ${this.deliveryAddress}` : null,
            this.selectedTable ? `Table ${this.selectedTable.name}` : null,
            payments.length > 1 ? 'Mixed payment' : null,
            loyaltyRedeem > 0 ? `Loyalty: ${loyaltyRedeem} pts (−${Utils.formatMoney(loyaltyDiscount || 0, currency)})` : null
          ].filter(Boolean).join(' · ') || null
        };
        if (saleData.order_type === 'sit_in' && !saleData.table_id) {
          throw new Error('Sit-in orders require a table');
        }
        if (saleData.order_type === 'delivery' && !saleData.delivery_address) {
          throw new Error('Delivery address is required');
        }
        const sitInTableName = this.selectedTable?.name;
        let res = await API.completeSale(saleData, this.app.user);
        if (!res.success && /Manager PIN required/i.test(res.error || '')) {
          const pin = await this.promptSaleManagerPin(res.error);
          if (!pin) throw new Error(res.error || 'Manager PIN required for this sale');
          saleData.manager_pin = pin;
          res = await API.completeSale(saleData, this.app.user);
        }
        if (res.offlineQueued) {
          // Treat as accepted till-side: cart must clear so cashier cannot Pay again (duplicate).
          Utils.forceHideModal();
          this.applyLocalSaleStockDeduction(this.cart);
        this.cart = [];
        this.discount = 0;
        this.discountApprover = null;
        this.discountManagerPin = null;
        this.orderType = null;
        this.selectedTable = null;
        this.updateTableLabel?.();
        this.selectedCustomer = null;
        this.clearCustomer?.();
        const refEl = document.getElementById('pos-referral-code');
        const couponEl = document.getElementById('pos-coupon-code');
        if (refEl) refEl.value = '';
        if (couponEl) couponEl.value = '';
        this.loadedQuoteId = null;
          this.renderCart?.();
          this.renderProducts?.();
          Utils.toast(
            res.message || 'Sale saved offline — it will sync when internet returns (no duplicate).',
            'warning'
          );
          return;
        }
        if (!res.success) throw new Error(res.error || 'Sale failed');
        const sale = res.data?.sale || res.data;
        const saleId = res.data?.saleId || sale?.id;
        const loyaltyPointsEarned = res.data?.loyaltyPointsEarned || 0;
        const loyaltyPointsRedeemed = res.data?.loyaltyPointsRedeemed || loyaltyRedeem || 0;
        const customerReward = res.data?.customerReward || null;
        if (!sale || !sale.receipt_number) throw new Error('Sale completed but receipt data missing');
        if (this.loadedQuoteId) {
          const qid = this.loadedQuoteId;
          let marked = false;
          for (let attempt = 0; attempt < 3 && !marked; attempt++) {
            try {
              const m = await API.markQuoteConverted(qid, saleId, this.app.user);
              marked = !!(m && m.success !== false);
            } catch (_) { /* retry */ }
          }
          if (!marked) {
            Utils.toast('Sale saved, but quote was not marked sold — check Quotes', 'warning');
          }
          this.loadedQuoteId = null;
          if (this.quoteTab === 'saved' || this.quoteTab === 'history') {
            await this.renderSavedQuotesPanel(this.quoteTab === 'history');
          }
          this.updatePosBadges();
        }
        Utils.forceHideModal();
        this.lastSale = sale;
        this.lastSaleCustomer = this.selectedCustomer ? { ...this.selectedCustomer } : null;
        const giftCardPayment = (payments || []).find(p => (p.type || p.payment_type) === 'giftcard' && p.gift_card_code);
        this.lastSaleGiftCardCode = giftCardPayment?.gift_card_code || null;

        // Optimistic local stock patch so cart/grid stay accurate without blocking on getProducts
        this.applyLocalSaleStockDeduction(this.cart);

        this.cart = [];
        this.discount = 0;
        this.discountApprover = null;
        this.discountManagerPin = null;
        this.orderType = null;
        this.selectedTable = null;
        this.updateTableLabel();
        this.selectedCustomer = null;
        this.clearCustomer();
        // Keep deliveryAddress until success screen WhatsApp uses sale.delivery_address from DB
        this.deliveryAddress = null;
        const refOk = document.getElementById('pos-referral-code');
        const couponOk = document.getElementById('pos-coupon-code');
        if (refOk) refOk.value = '';
        if (couponOk) couponOk.value = '';
        this.renderCart();
        this.renderProducts();
        this.showOrderSuccess(sale, change, payments, loyaltyPointsEarned, loyaltyPointsRedeemed, loyaltyDiscount, this.lastSaleCustomer);
        if (customerReward?.grants?.length && !this.app.isPosKiosk?.()) {
          this.handleCustomerRewardNotifications(customerReward, currency);
        }
        if (!this.app.isPosKiosk?.()) {
          Utils.toast(
            sitInTableName
              ? `Sale completed — ${sale.receipt_number}. Table ${sitInTableName} stays occupied until Free Table.`
              : `Sale completed — ${sale.receipt_number}`,
            'success'
          );
        }

        // Non-critical: refresh products, print, kitchen, notifications — never block success UI
        const postSaleWork = async () => {
          try {
            if (this.lastSaleCustomer?.id) {
              const cr = await API.getCustomer(this.lastSaleCustomer.id);
              if (cr.success && cr.data) this.lastSaleCustomer = cr.data;
            }
          } catch (_) { /* use snapshot */ }
          try {
            if (this.lastSaleCustomer?.id && !this.lastSaleGiftCardCode) {
              const gcRes = await API.getGiftCards({});
              const cards = (gcRes.data || []).filter(c =>
                c.customer_id == this.lastSaleCustomer.id && c.status === 'active' && Number(c.balance) > 0
              );
              if (cards.length) {
                this.lastSaleGiftCardCode = cards.map(c => `${c.code} (${Utils.formatMoney(c.balance, currency)})`).join(', ');
              }
            }
          } catch (_) { /* optional */ }
          try {
            const prodRes = await API.getProducts({ for_pos: true });
            if (prodRes?.success !== false) {
              this.products = prodRes.data || [];
              this.rebuildProductLookups();
              this.renderProducts();
            }
          } catch (_) { /* keep optimistic stock */ }
          try { await this.printReceiptSafe(sale); } catch (_) { /* receipt optional */ }
          try { await this.printKitchenSafe(sale); } catch (_) { /* kitchen optional */ }
          if (!this.app.isPosKiosk?.()) {
            try { await this.app.loadNotifications(); } catch (_) { /* ignore */ }
          }
        };
        postSaleWork();
        } finally {
          releaseCheckout();
        }
      }
    });
  },

  resolveWhatsAppCustomer(sale, customer = null) {
    const cust = customer || this.lastSaleCustomer || {};
    const phone = String(cust.phone || sale?.customer_phone || '').trim();
    const name = cust.name || sale?.customer_name || 'Customer';
    const id = cust.id || sale?.customer_id || null;
    return { phone, name, id, loyalty_points: cust.loyalty_points };
  },

  async promptWhatsAppPhone(defaultName = 'Customer') {
    return new Promise((resolve) => {
      Utils.showModal('Customer WhatsApp Number', `
        <p class="muted">Enter the customer's mobile number to send the receipt via WhatsApp.</p>
        <div class="field"><label>Phone *</label><input id="wa-prompt-phone" placeholder="071 234 5678" autofocus></div>
        <div class="field"><label>Name</label><input id="wa-prompt-name" value="${Utils.escHtml?.(defaultName) || defaultName}"></div>`,
        '<button class="btn btn-ghost" id="wa-prompt-cancel">Cancel</button><button class="btn btn-success" id="wa-prompt-send">Send WhatsApp</button>');
      document.getElementById('wa-prompt-cancel')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve(null);
      });
      document.getElementById('wa-prompt-send')?.addEventListener('click', () => {
        const phone = document.getElementById('wa-prompt-phone')?.value.trim();
        const name = document.getElementById('wa-prompt-name')?.value.trim() || defaultName;
        if (!phone) return Utils.toast('Phone number required', 'error');
        Utils.hideModal();
        resolve({ phone, name });
      });
    });
  },

  showOrderSuccess(sale, change, payments, loyaltyPointsEarned = 0, loyaltyPointsRedeemed = 0, loyaltyDiscount = 0, customer = null) {
    const currency = this.app.settings?.currency || 'R';
    const labels = PaymentUI.labels(this.app.settings);
    document.querySelector('.pos-layout')?.classList.add('hidden');
    const screen = document.getElementById('pos-success-screen');
    screen.classList.remove('hidden');
    document.getElementById('pos-success-receipt').textContent = `Receipt #${sale.receipt_number}`;
    document.getElementById('pos-success-total').textContent = Utils.formatMoney(sale.total, currency);
    document.getElementById('pos-success-change').textContent = change > 0
      ? `Change: ${Utils.formatMoney(change, currency)}` : '';
    const loyaltyEl = document.getElementById('pos-success-loyalty');
    if (loyaltyEl) {
      const parts = [];
      const cust = customer || this.lastSaleCustomer;
      const balance = Math.floor(cust?.loyalty_points || 0);
      const balanceWorth = Utils.loyaltyPointsValue(balance, this.app.settings, currency);
      if (loyaltyPointsRedeemed > 0) {
        parts.push(`Redeemed ${loyaltyPointsRedeemed} pts (−${Utils.formatMoney(loyaltyDiscount, currency)})`);
      }
      if (loyaltyPointsEarned > 0) {
        const earnedWorth = Utils.loyaltyPointsValue(loyaltyPointsEarned, this.app.settings, currency);
        parts.push(`Earned ${loyaltyPointsEarned} pts (= ${earnedWorth.formatted})`);
      }
      if (balance > 0) {
        parts.push(`Balance ${balance} pts (= ${balanceWorth.formatted})`);
      }
      if (this.lastSaleGiftCardCode) {
        parts.push(`Gift card: ${this.lastSaleGiftCardCode}`);
      }
      loyaltyEl.textContent = parts.length ? `⭐ ${parts.join(' · ')}` : '';
    }
    document.getElementById('pos-success-payments').innerHTML = (payments || sale.payments || []).map(p =>
      `${labels[p.type || p.payment_type] || p.type || p.payment_type}: ${Utils.formatMoney(p.amount, currency)}`
    ).join(' · ');

    const waRecipient = this.resolveWhatsAppCustomer(sale, customer);
    const waBtn = document.getElementById('pos-success-wa');
    const reviewBtn = document.getElementById('pos-success-review');
    if (waRecipient.phone) reviewBtn?.classList.remove('hidden');
    else reviewBtn?.classList.add('hidden');

    const sendReceiptWhatsApp = async () => {
      let recipient = { ...waRecipient };
      if (!recipient.phone) {
        const prompted = await this.promptWhatsAppPhone(recipient.name);
        if (!prompted) return;
        recipient = { ...recipient, phone: prompted.phone, name: prompted.name };
      }
      const currency = this.app.settings?.currency || 'R';
      const balance = Math.floor(recipient.loyalty_points || loyaltyPointsEarned || 0);
      const balanceWorth = Utils.loyaltyPointsValue(balance, this.app.settings, currency);
      const receiptLines = Receipt.buildWhatsAppLines(sale, this.app.settings);
      const giftLine = this.lastSaleGiftCardCode ? `🎁 Gift card: ${this.lastSaleGiftCardCode}` : '';
      const earnedWorth = Utils.loyaltyPointsValue(loyaltyPointsEarned, this.app.settings, currency);
      const deliveryAddr = sale.delivery_address || this.deliveryAddress || '';
      const r = await API.sendWhatsAppMessage({
        phone: recipient.phone,
        customer_id: recipient.id,
        recipient_type: 'customer',
        recipient_name: recipient.name,
        customer_name: recipient.name,
        loyalty_points: balance,
        points_earned: loyaltyPointsEarned,
        points_earned_value: earnedWorth.formatted,
        loyalty_points_value: balanceWorth.formatted,
        receipt_lines: receiptLines,
        gift_card_code: this.lastSaleGiftCardCode || '',
        gift_card_line: giftLine,
        delivery_address: deliveryAddr,
        delivery_address_line: deliveryAddr ? `📍 Deliver to: ${deliveryAddr}` : '',
        branch: this.activeBranch?.name || this.app.settings?.shop_name,
        phone_shop: this.app.settings?.phone,
        order_number: sale.order_number || sale.receipt_number,
        receipt_number: sale.receipt_number,
        total_purchase: sale.total,
        sale_id: sale.id,
        message_type: 'sale_receipt',
        template_slug: 'sale_receipt'
      }, this.app.user);
      try { await Receipt.downloadPdf(sale, this.app.settings); } catch (_) { /* PDF optional */ }
      await Utils.deliverWhatsApp(r, recipient.phone, receiptLines);
    };

    waBtn.onclick = () => sendReceiptWhatsApp();
    if (waRecipient.phone) {
      reviewBtn.onclick = async () => {
        const r = await API.sendWhatsAppMessage({
          phone: waRecipient.phone,
          customer_id: waRecipient.id,
          recipient_type: 'customer',
          recipient_name: waRecipient.name,
          customer_name: waRecipient.name,
          branch: this.activeBranch?.name || this.app.settings?.shop_name,
          order_number: sale.order_number || sale.receipt_number,
          receipt_number: sale.receipt_number,
          total_purchase: sale.total,
          sale_id: sale.id,
          message_type: 'review_request',
          template_slug: 'review_request'
        }, this.app.user);
        await Utils.deliverWhatsApp(r, waRecipient.phone);
      };
    } else {
      reviewBtn.onclick = null;
    }

    document.getElementById('pos-success-print').onclick = async () => {
      try {
        await Receipt.print(sale, this.app.settings);
        Utils.toast('Receipt sent to printer', 'success');
      } catch (err) {
        Utils.toast(err.message || 'Print failed', 'error');
      }
    };
    document.getElementById('pos-success-new').onclick = () => {
      screen.classList.add('hidden');
      document.querySelector('.pos-layout')?.classList.remove('hidden');
    };
  },

  handleCustomerRewardNotifications(reward, currency) {
    const grants = reward.grants || [];
    if (!grants.length) return;
    const first = grants[0];
    const code = first.gift_card?.code;
    const amount = first.gift_card?.balance;
    Utils.toast(`🎁 Auto gift card created: ${code} (${Utils.formatMoney(amount, currency)})`, 'success');
    if (first.customer_whatsapp_url) {
      setTimeout(() => {
        if (confirm(`Customer qualified for a gift reward (${Utils.formatMoney(amount, currency)}).\n\nOpen WhatsApp to send the gift card to ${reward.customer_name || 'customer'}?`)) {
          if (window.API?.openExternal) API.openExternal(first.customer_whatsapp_url);
          else window.open(first.customer_whatsapp_url, '_blank', 'noopener,noreferrer');
        }
      }, 400);
    }
    const staffWithPhone = (first.staff_notifications || []).filter(s => s.whatsapp_url);
    if (staffWithPhone.length && ['owner', 'manager', 'assistant_manager'].includes(this.app.user?.role)) {
      const mine = staffWithPhone.find(s => s.user_id === this.app.user?.id);
      if (mine?.whatsapp_url) {
        setTimeout(() => {
          if (confirm('Notify management about this auto gift reward via WhatsApp?')) {
            if (window.API?.openExternal) API.openExternal(mine.whatsapp_url);
            else window.open(mine.whatsapp_url, '_blank', 'noopener,noreferrer');
          }
        }, 800);
      }
    }
  }
};
window.POSPage = POSPage;
